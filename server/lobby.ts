/**
 * LOBBY — rooms by invite code, the players in them, and every request a signed-in player can make.
 *
 * Each room is an OnlineTable: the LAN relay's RelayServer (the same room reducers, redaction, deal
 * commitment and seat rules as PR #22) plus what a public server needs and a LAN table does not:
 *
 *   - a turn clock: a seat that does not act in time checks if that is free, else folds (graded);
 *   - a grace window: a dropped connection holds its seat for GRACE_MS and resumes with a `resync`;
 *     after that the player has left, exactly as a LAN guest who closes the app;
 *   - automatic dealing a few seconds after each hand, and a rebuy for a busted seat (chips score nothing);
 *   - preset emotes, rate-limited; no free text;
 *   - ranked rooms, whose every decision goes to Rankings to be graded from the server's own state.
 *
 * Who may sit: a key that has set a name and confirmed 18+, holding the room's code. A code is 50 random
 * bits and failed joins are rate-limited per key and per network, so a room cannot be found by guessing.
 * A key sits in one room at a time.
 */

import * as crypto from 'node:crypto';
import { normaliseName } from '../src/core/online/names.js';
import { CODE_ALPHABET, CODE_LENGTH, type EmoteId, type OnlineRequest, type RoomFrame, type RoomInfo } from '../src/core/online/protocol.js';
import type { CreateRoomOpts, ServerMessage } from '../src/core/multiplayer.js';
import { RelayServer, type Outbound } from '../src/core/relayServer.js';
import type { DealCrypto } from '../src/core/dealCommit.js';
import type { Log } from './log.js';
import { pseudonym } from './log.js';
import type { Rankings } from './rankings.js';
import { day, type Store } from './store.js';

/** A signed-in connection, as the lobby sees it. */
export interface Conn {
  readonly key: string;
  /** A salted hash of the remote address, in memory only: used to flag (never refuse) a shared network. */
  readonly netTag: string;
  send(frame: object): void;
}

export interface LobbyTiming {
  /** How long a seat has to act. */
  readonly turnMs: number;
  /** How long a dropped player keeps their seat. */
  readonly graceMs: number;
  /** The pause after a hand settles before the next is dealt, so everyone sees the showdown. */
  readonly nextHandMs: number;
  /** How long a guest has for each step of the deal handshake. */
  readonly entropyMs: number;
  /** A room with fewer than two players for this long is closed. */
  readonly idleRoomMs: number;
}

export const DEFAULT_TIMING: LobbyTiming = { turnMs: 30_000, graceMs: 60_000, nextHandMs: 4_000, entropyMs: 10_000, idleRoomMs: 30 * 60_000 };

export interface LobbyLimits {
  readonly maxRooms: number;
  /** Failed room or league joins one key (or one network) may make per window before it must wait. */
  readonly maxFailedJoins: number;
  readonly failedJoinWindowMs: number;
  /** Rooms one key may create per hour. */
  readonly roomsPerHour: number;
  readonly leaguesOwned: number;
  readonly leaguesJoined: number;
  readonly leagueMembers: number;
  readonly emoteGapMs: number;
}

export const DEFAULT_LIMITS: LobbyLimits = {
  maxRooms: 1000,
  maxFailedJoins: 10,
  failedJoinWindowMs: 10 * 60_000,
  roomsPerHour: 20,
  leaguesOwned: 5,
  leaguesJoined: 20,
  leagueMembers: 50,
  emoteGapMs: 3_000,
};

const ROOM_BLINDS = { sb: 25, bb: 50, startStack: 5000 } as const;

type Reply = { readonly ok: true; readonly data: unknown } | { readonly ok: false; readonly error: string };
const ok = (data: unknown = null): Reply => ({ ok: true, data });
const fail = (error: string): Reply => ({ ok: false, error });

export function randomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return code;
}

const nodeCrypto: DealCrypto = {
  random: (n) => crypto.randomBytes(n),
  sha256: (d) => crypto.createHash('sha256').update(d).digest(),
};

/** A sliding count of events per key, for the failed-join and room-creation limits. */
class Window {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly ms: number) {}
  count(id: string, now: number): number {
    const kept = (this.hits.get(id) ?? []).filter((t) => now - t < this.ms);
    if (kept.length === 0) this.hits.delete(id);
    else this.hits.set(id, kept);
    return kept.length;
  }
  add(id: string, now: number): void {
    this.hits.set(id, [...(this.hits.get(id) ?? []).filter((t) => now - t < this.ms), now]);
  }
}

class OnlineTable {
  readonly relay: RelayServer;
  /** Seated players → their connection, or null while held after a drop. */
  readonly conns = new Map<string, Conn | null>();
  private readonly holdUntil = new Map<string, number>();
  private readonly banned = new Set<string>();
  private readonly lastEmote = new Map<string, number>();
  private readonly netTags = new Map<string, string>();
  private turnKey: string | null = null;
  private turnDeadline = 0;
  private settledAt: number | null = null;
  emptySince: number | null;

  constructor(
    readonly code: string,
    readonly ranked: boolean,
    readonly seats: number,
    readonly creator: string,
    private readonly lobby: Lobby,
  ) {
    const opts: CreateRoomOpts = { roomId: code, seatCount: seats, ...ROOM_BLINDS };
    this.emptySince = lobby.now();
    this.relay = new RelayServer(opts, {
      crypto: nodeCrypto,
      now: lobby.now,
      entropyTimeoutMs: lobby.timing.entropyMs,
      rebuyBusted: true,
      onDecision: ranked
        ? (record) => {
            const dealtTo = this.relay.roomState().dealtTo;
            const opponents = Object.entries(dealtTo).filter(([seat]) => Number(seat) !== record.seat).map(([, key]) => key);
            lobby.rankings.submit({ key: record.playerId, opponents, record });
          }
        : undefined,
      onHandEnd: ranked
        ? (hand) => {
            const players = Object.entries(hand.dealtTo).map(([seat, k]) => ({ k, start: hand.startStacks[Number(seat)], end: hand.endStacks[Number(seat)] }));
            const shared: [string, string][] = [];
            for (let i = 0; i < players.length; i += 1) {
              for (let j = i + 1; j < players.length; j += 1) {
                const a = this.netTags.get(players[i].k);
                if (a !== undefined && a === this.netTags.get(players[j].k)) shared.push([players[i].k, players[j].k]);
              }
            }
            lobby.rankings.recordHand({ h: hand.nonce, day: day(lobby.now()), p: players, shared });
          }
        : undefined,
    });
  }

  info(key: string): RoomInfo {
    return { code: this.code, ranked: this.ranked, seats: this.seats, creator: key === this.creator };
  }

  private seatOf(key: string): number | null {
    return this.relay.roomState().players.find((p) => p.playerId === key)?.seatId ?? null;
  }

  /** Send the relay's output to the seats it names. A relay removal ends that player's seat. */
  deliver(outbound: Outbound[]): void {
    for (const item of outbound) {
      const conn = this.conns.get(item.to);
      if (conn) conn.send(item.message);
      if (item.close) this.unseat(item.to, item.message.type === 'error' ? item.message.reason : 'removed from the table');
    }
  }

  private broadcast(frame: object): void {
    for (const conn of this.conns.values()) conn?.send(frame);
  }

  join(conn: Conn, name: string): string | null {
    if (this.banned.has(conn.key)) return 'You were removed from this table.';
    const out = this.relay.connect(conn.key, name);
    const refused = out.find((o) => o.to === conn.key && o.message.type === 'error' && this.seatOf(conn.key) === null);
    if (refused !== undefined) return (refused.message as Extract<ServerMessage, { type: 'error' }>).reason;
    this.conns.set(conn.key, conn);
    this.netTags.set(conn.key, conn.netTag);
    this.emptySince = this.conns.size >= 2 ? null : this.emptySince;
    conn.send({ type: 'room', room: this.info(conn.key) });
    this.deliver(out);
    return null;
  }

  /** The connection dropped: hold the seat for the grace window. */
  hold(key: string): void {
    if (!this.conns.has(key)) return;
    this.conns.set(key, null);
    this.holdUntil.set(key, this.lobby.now() + this.lobby.timing.graceMs);
    this.deliver(this.relay.hold(key));
    this.lobby.log('room.hold', { room: this.lobby.tag(this.code) });
  }

  /** The same key signed in again within the grace window: give it its seat and the live hand back. */
  resume(conn: Conn): void {
    this.conns.set(conn.key, conn);
    this.netTags.set(conn.key, conn.netTag);
    this.holdUntil.delete(conn.key);
    conn.send({ type: 'room', room: this.info(conn.key) });
    this.deliver(this.relay.resume(conn.key) ?? []);
    const turn = this.relay.turn();
    if (turn !== null) conn.send({ type: 'clock', seat: this.relay.roomState().table!.toAct, ms: Math.max(0, this.turnDeadline - this.lobby.now()) });
  }

  /** The player leaves (or is removed): their seat is freed and a live hand folds for them. */
  unseat(key: string, reason: string | null): void {
    const conn = this.conns.get(key);
    this.conns.delete(key);
    this.holdUntil.delete(key);
    this.netTags.delete(key);
    this.lobby.unseated(key, this);
    if (reason !== null) conn?.send({ type: 'removed', reason });
    conn?.send({ type: 'room', room: null });
    this.deliver(this.relay.disconnect(key));
    if (this.conns.size < 2 && this.emptySince === null) this.emptySince = this.lobby.now();
  }

  kick(by: string, seat: number): Reply {
    if (by !== this.creator) return fail('Only the player who opened this table can remove a seat.');
    // Between hands only: removing a player mid-hand would fold their cards, and a ranked fold is graded.
    if (!this.relay.between()) return fail('Wait for the hand to finish.');
    const target = this.relay.roomState().players.find((p) => p.seatId === seat)?.playerId;
    if (target === undefined || target === by) return fail('No one else is in that seat.');
    this.banned.add(target);
    this.unseat(target, 'The player who opened this table removed you.');
    return ok();
  }

  frame(key: string, frame: RoomFrame): void {
    if (this.conns.get(key) === undefined) return;
    if (frame.type === 'emote') return this.emote(key, frame.emote);
    if (frame.type === 'leave') return this.unseat(key, null);
    // The server deals on its own clock; a client's request for the next hand changes nothing.
    if (frame.type === 'deal') return;
    this.deliver(this.relay.message(key, frame));
  }

  private emote(key: string, emote: EmoteId): void {
    const now = this.lobby.now();
    if (now - (this.lastEmote.get(key) ?? -Infinity) < this.lobby.limits.emoteGapMs) return;
    this.lastEmote.set(key, now);
    const seat = this.seatOf(key);
    if (seat !== null) this.broadcast({ type: 'emote', seat, emote });
  }

  /** The room's clock: deal deadlines, the turn clock, held seats, and dealing the next hand. */
  tick(now: number): void {
    this.deliver(this.relay.tick());
    for (const [key, until] of this.holdUntil) {
      if (now >= until) {
        this.lobby.log('room.hold_expired', { room: this.lobby.tag(this.code) });
        this.unseat(key, null);
      }
    }
    const turn = this.relay.turn();
    if (turn === null) {
      this.turnKey = null;
    } else if (turn.key !== this.turnKey) {
      this.turnKey = turn.key;
      this.turnDeadline = now + this.lobby.timing.turnMs;
      this.broadcast({ type: 'clock', seat: this.relay.roomState().table!.toAct, ms: this.lobby.timing.turnMs });
    } else if (now >= this.turnDeadline) {
      this.turnKey = null;
      this.deliver(this.relay.autoAct());
    }
    const table = this.relay.roomState().table;
    if (table !== null && this.relay.between()) {
      if (this.settledAt === null) this.settledAt = now;
      else if (now - this.settledAt >= this.lobby.timing.nextHandMs) {
        this.settledAt = null;
        this.deliver(this.relay.dealNext());
      }
    } else {
      this.settledAt = null;
    }
  }
}

export class Lobby {
  private readonly rooms = new Map<string, OnlineTable>();
  /** Which room each seated (or held) key is in. */
  private readonly seatedIn = new Map<string, OnlineTable>();
  private readonly failedJoins: Window;
  private readonly created = new Window(60 * 60_000);

  constructor(
    readonly store: Store,
    readonly rankings: Rankings,
    readonly log: Log,
    readonly now: () => number,
    readonly timing: LobbyTiming = DEFAULT_TIMING,
    readonly limits: LobbyLimits = DEFAULT_LIMITS,
  ) {
    this.failedJoins = new Window(limits.failedJoinWindowMs);
  }

  tag(value: string): string {
    return pseudonym(this.store.logSalt, value);
  }

  stats(): { rooms: number; seated: number } {
    return { rooms: this.rooms.size, seated: this.seatedIn.size };
  }

  /** The room a key still holds a seat in, if any. */
  heldRoom(key: string): RoomInfo | null {
    return this.seatedIn.get(key)?.info(key) ?? null;
  }

  /** A signed-in connection: resume a held seat, if it has one. */
  attach(conn: Conn): void {
    this.store.touch(conn.key, this.now());
    this.seatedIn.get(conn.key)?.resume(conn);
  }

  /** A connection closed: hold its seat. */
  detach(conn: Conn): void {
    const table = this.seatedIn.get(conn.key);
    if (table !== undefined && table.conns.get(conn.key) === conn) table.hold(conn.key);
  }

  unseated(key: string, table: OnlineTable): void {
    if (this.seatedIn.get(key) === table) this.seatedIn.delete(key);
  }

  roomFrame(conn: Conn, frame: RoomFrame): void {
    const table = this.seatedIn.get(conn.key);
    if (table === undefined) {
      if (frame.type !== 'leave' && frame.type !== 'emote') conn.send({ type: 'error', reason: 'You are not at a table.' });
      return;
    }
    if (table.conns.get(conn.key) !== conn) return;
    table.frame(conn.key, frame);
  }

  tick(): void {
    const now = this.now();
    for (const [code, table] of this.rooms) {
      table.tick(now);
      if (table.conns.size === 0 || (table.emptySince !== null && now - table.emptySince >= this.timing.idleRoomMs)) {
        for (const key of [...table.conns.keys()]) table.unseat(key, 'This table closed: nobody else was here.');
        this.rooms.delete(code);
        this.log('room.closed', { room: this.tag(code) });
      }
    }
  }

  private tooManyFailures(conn: Conn, now: number): boolean {
    return (
      this.failedJoins.count(`k:${conn.key}`, now) >= this.limits.maxFailedJoins ||
      this.failedJoins.count(`n:${conn.netTag}`, now) >= this.limits.maxFailedJoins
    );
  }

  private failedJoin(conn: Conn, now: number): void {
    this.failedJoins.add(`k:${conn.key}`, now);
    this.failedJoins.add(`n:${conn.netTag}`, now);
  }

  /** Answer one request. The caller wraps the reply with the request's id. */
  request(conn: Conn, req: OnlineRequest): Reply {
    const now = this.now();
    const player = this.store.player(conn.key);
    if (req.type === 'profile') {
      const named = normaliseName(req.name);
      if ('error' in named) return fail(named.error);
      const row = this.store.setProfile(conn.key, named.name, now);
      this.log('player.profile', { who: this.tag(conn.key), first: row.created === day(now) });
      return ok({ name: row.name });
    }
    if (req.type === 'export') return ok(this.store.exportFor(conn.key));
    if (req.type === 'forget') {
      this.seatedIn.get(conn.key)?.unseat(conn.key, null);
      this.store.forget(conn.key);
      this.rankings.forget(conn.key);
      this.log('player.forgotten', {});
      return ok();
    }
    // Everything else needs a name and the 18+ confirmation first.
    if (player === undefined) return fail('Choose a name and confirm you are 18 or over first.');
    const table = this.seatedIn.get(conn.key);
    switch (req.type) {
      case 'room-create': {
        if (table !== undefined) return fail('You are already at a table. Leave it first.');
        if (req.ranked) {
          const closed = this.rankings.closedReason();
          if (closed !== null) return fail(closed);
        }
        if (this.rooms.size >= this.limits.maxRooms) return fail('The server is full right now. Try again soon.');
        if (this.created.count(conn.key, now) >= this.limits.roomsPerHour) return fail('You have opened a lot of tables. Try again later.');
        this.created.add(conn.key, now);
        let code = randomCode();
        while (this.rooms.has(code)) code = randomCode();
        const room = new OnlineTable(code, req.ranked, req.seats, conn.key, this);
        this.rooms.set(code, room);
        room.join(conn, player.name);
        this.seatedIn.set(conn.key, room);
        this.log('room.created', { room: this.tag(code), ranked: req.ranked, seats: req.seats });
        return ok(room.info(conn.key));
      }
      case 'room-join': {
        if (table !== undefined) return table.code === req.code ? ok(table.info(conn.key)) : fail('You are already at a table. Leave it first.');
        if (this.tooManyFailures(conn, now)) return fail('Too many codes that did not match. Wait a few minutes.');
        const room = this.rooms.get(req.code);
        if (room === undefined) {
          this.failedJoin(conn, now);
          return fail('No table has that code. Check it with whoever sent it.');
        }
        if (room.ranked) {
          const closed = this.rankings.closedReason();
          if (closed !== null) return fail(closed);
        }
        const refused = room.join(conn, player.name);
        if (refused !== null) return fail(refused === 'room is full' ? 'That table is full.' : refused);
        this.seatedIn.set(conn.key, room);
        this.log('room.joined', { room: this.tag(room.code), who: this.tag(conn.key) });
        return ok(room.info(conn.key));
      }
      case 'room-leave':
        table?.unseat(conn.key, null);
        return ok();
      case 'kick':
        return table === undefined ? fail('You are not at a table.') : table.kick(conn.key, req.seat);
      case 'ladder':
        return ok(this.rankings.ladder(conn.key));
      case 'season':
        return ok(this.rankings.seasonView(conn.key));
      case 'league-create': {
        const named = normaliseName(req.name);
        if ('error' in named) return fail(named.error);
        const owned = this.store.leaguesOf(conn.key).filter((l) => l.row.owner === conn.key).length;
        if (owned >= this.limits.leaguesOwned) return fail(`You can run up to ${this.limits.leaguesOwned} leagues.`);
        if (this.store.leaguesOf(conn.key).length >= this.limits.leaguesJoined) return fail('You are in as many leagues as one player can be.');
        let code = randomCode();
        while (this.store.league(code) !== undefined) code = randomCode();
        this.store.createLeague(code, named.name, conn.key, now);
        this.log('league.created', { league: this.tag(code) });
        return ok({ code, name: named.name });
      }
      case 'league-join': {
        if (this.tooManyFailures(conn, now)) return fail('Too many codes that did not match. Wait a few minutes.');
        const league = this.store.league(req.code);
        if (league === undefined) {
          this.failedJoin(conn, now);
          return fail('No league has that code.');
        }
        if (!league.members.includes(conn.key)) {
          if (league.members.length >= this.limits.leagueMembers) return fail('That league is full.');
          if (this.store.leaguesOf(conn.key).length >= this.limits.leaguesJoined) return fail('You are in as many leagues as one player can be.');
          this.store.joinLeague(req.code, conn.key);
        }
        return ok({ code: req.code, name: league.name });
      }
      case 'league-leave':
        this.store.leaveLeague(req.code, conn.key);
        return ok();
      case 'league-board': {
        const league = this.store.league(req.code);
        // A non-member is told the same as for a code that does not exist: membership is not probeable.
        if (league === undefined || !league.members.includes(conn.key)) return fail('No league has that code.');
        return ok({ code: req.code, name: league.name, members: league.members.length, ...this.rankings.leagueBoard(league.members, conn.key) });
      }
      case 'leagues':
        return ok(this.store.leaguesOf(conn.key).map(({ code, row }) => ({ code, name: row.name, members: row.members.length, owner: row.owner === conn.key })));
    }
  }
}
