/**
 * RELAY SERVER — the transport-agnostic orchestration over a multiplayer room.
 *
 * This is the stateful layer between raw connection events and the pure room reducers (multiplayer.ts).
 * It holds the current RoomState, applies each client message to it, decides when to deal a hand, and
 * — for every change — computes the set of REDACTED broadcasts to send back (one per connected player,
 * each built through viewFor so no client ever receives an opponent's hole). It has NO socket of its
 * own: a transport (relayHost.ts, TLS in main) feeds it connect/disconnect/message and sends the
 * broadcasts it returns. Keeping the routing here means it is unit-testable with no server to run.
 *
 * DEALING is commit-before-reveal (dealCommit.ts): the host seals a CSPRNG-shuffled order and publishes
 * its leaf hashes, every guest commits to entropy, the commitments are published, the guests reveal,
 * and only then is the hand dealt, from the order permuted by the guests' entropy. Every state message
 * carries an opening for each card its view shows. The host's own in-process seat (`dealerPlayerId`)
 * takes no part: it is the dealer, and trusting itself buys nothing.
 *
 * The server never throws on bad input: a malformed or out-of-turn message returns an `error` message
 * addressed only to its sender, and everyone's state is otherwise unchanged — a hostile client cannot
 * crash the room or drive another seat.
 */

import {
  boardIndex,
  deriveSigma,
  engineDeck,
  entropyCommitment,
  expectedDealOrder,
  holeIndex,
  isHex64,
  openCard,
  sealDeck,
  type CardOpening,
  type DealCrypto,
  type SealedDeck,
} from './dealCommit.js';
import { freshDeck } from './cards.js';
import {
  applyPlayerAction,
  createRoom,
  dealRoomHand,
  foldAbsent,
  handBase,
  playerJoins,
  playerLeaves,
  viewFor,
  type ClientMessage,
  type CreateRoomOpts,
  type PlayerId,
  type RoomState,
  type RoomView,
  type ServerMessage,
} from './multiplayer.js';
import { startHand, type TableState } from './table.js';

/** One message the transport must deliver to exactly one connected player. */
export interface Outbound {
  readonly to: PlayerId;
  readonly message: ServerMessage;
  /** Close this player's connection after delivering the message: it failed the deal handshake. */
  readonly close?: true;
}

export interface RelayServerDeps {
  /** CSPRNG + SHA-256. Main injects node:crypto; there is no default, so no path deals without one. */
  readonly crypto: DealCrypto;
  /** The host's own in-process seat: the dealer, which contributes no entropy. */
  readonly dealerPlayerId?: PlayerId;
  /** Clock for the entropy deadline; tick() compares against it. */
  readonly now?: () => number;
  /** How long a guest has to commit, and then to reveal, before it is removed from the table. */
  readonly entropyTimeoutMs?: number;
}

export const ENTROPY_TIMEOUT_MS = 10_000;

/** A deal waiting on guest entropy. */
interface PendingDeal {
  readonly base: TableState;
  readonly sealed: SealedDeck;
  readonly participants: Map<PlayerId, number>; // playerId → seat
  /** Everyone connected when the commitment went out: the only players a hand may be dealt to. */
  readonly recipients: ReadonlySet<PlayerId>;
  /** Seat → player when the deal began; recorded as seatedAt once it is dealt. */
  readonly occupants: ReadonlyMap<number, PlayerId>;
  readonly commitments: Map<PlayerId, string>;
  readonly reveals: Map<PlayerId, string>;
  phase: 'commit' | 'reveal';
  deadline: number;
}

/** The dealt hand's secret, kept to open each card as it is shown. */
interface LiveDeal {
  readonly hand: number;
  readonly sealed: SealedDeck;
  readonly sigma: readonly number[];
}

export class RelayServer {
  private room: RoomState;
  /** Players with a live connection right now — the recipients of every state broadcast. */
  private readonly connected = new Set<PlayerId>();
  private readonly crypto: DealCrypto;
  private readonly dealerPlayerId: PlayerId | undefined;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private pending: PendingDeal | null = null;
  private live: LiveDeal | null = null;
  /** Who sat in each seat when the last hand was dealt, dealt in or not: how a newcomer is told apart. */
  private seatedAt = new Map<number, PlayerId>();

  constructor(opts: CreateRoomOpts, deps: RelayServerDeps) {
    this.room = createRoom(opts);
    this.crypto = deps.crypto;
    this.dealerPlayerId = deps.dealerPlayerId;
    this.now = deps.now ?? Date.now;
    this.timeoutMs = deps.entropyTimeoutMs ?? ENTROPY_TIMEOUT_MS;
  }

  /** The current room (read-only view for tests/host UI); callers must not mutate it. */
  roomState(): RoomState {
    return this.room;
  }

  /** True while a deal waits on guest entropy. */
  dealPending(): boolean {
    return this.pending !== null;
  }

  /** The opening for every card a view shows, from the live deal. Empty when nothing is dealt. */
  private openingsFor(view: RoomView): CardOpening[] {
    const live = this.live;
    if (live === null || view.handNumber !== live.hand) return [];
    const order = live.sealed.commit.dealOrder;
    const ks: number[] = [];
    for (const seat of view.seats) {
      if (seat.hole === null || !order.includes(seat.id)) continue;
      ks.push(holeIndex(order, seat.id, 0), holeIndex(order, seat.id, 1));
    }
    view.board.forEach((_card, b) => ks.push(boardIndex(order, b)));
    return ks.map((k) => openCard(live.sealed, live.sigma, k));
  }

  /** A fresh state broadcast to every connected player — the redacted view each is allowed to see. */
  private broadcastState(): Outbound[] {
    // Every broadcast follows a change; first fold any seat whose absent player holds the turn.
    const present = new Set(this.connected);
    if (this.dealerPlayerId !== undefined) present.add(this.dealerPlayerId);
    this.room = foldAbsent(this.room, present);
    const out: Outbound[] = [];
    for (const playerId of this.connected) {
      const view = viewFor(this.room, playerId);
      // A connected player is always in the room, so viewFor cannot error here; guard defensively.
      if ('error' in view) continue;
      out.push({ to: playerId, message: { type: 'state', view, openings: this.openingsFor(view) } });
    }
    return out;
  }

  private toAll(message: ServerMessage): Outbound[] {
    return [...this.connected].map((to) => ({ to, message }));
  }

  /** An error addressed only to the sender; no state changes and no one else hears it. */
  private errorTo(playerId: PlayerId, reason: string): Outbound[] {
    return [{ to: playerId, message: { type: 'error', reason } }];
  }

  /**
   * A player's socket opened and passed the transport's hello. Seats them, starts the first deal once
   * two players are present and none is in progress, and broadcasts the new state to everyone.
   */
  connect(playerId: PlayerId, name: string): Outbound[] {
    const joined = playerJoins(this.room, playerId, name);
    if ('error' in joined) return this.errorTo(playerId, joined.error);
    this.room = joined.room;
    this.connected.add(playerId);
    const state = this.broadcastState();
    return this.room.table === null && this.pending === null ? [...state, ...this.beginDeal()] : state;
  }

  /** A player's socket closed. Frees their seat and broadcasts to whoever remains. */
  disconnect(playerId: PlayerId): Outbound[] {
    this.room = playerLeaves(this.room, playerId);
    this.connected.delete(playerId);
    const state = this.broadcastState();
    // A participant leaving mid-handshake can never reveal: start the deal again without them.
    if (this.pending?.participants.has(playerId)) return [...state, ...this.restartDeal()];
    return state;
  }

  /**
   * Route one client message. `leave` disconnects; `action` is validated and applied; `deal` asks for
   * the next hand; the entropy messages feed the deal handshake. Any failure returns an error to the
   * sender only.
   */
  message(playerId: PlayerId, msg: ClientMessage): Outbound[] {
    switch (msg.type) {
      case 'leave':
        return this.disconnect(playerId);
      case 'action': {
        if (this.pending !== null) return this.errorTo(playerId, 'the next hand is still being dealt');
        const next = applyPlayerAction(this.room, playerId, msg.action);
        if ('error' in next) return this.errorTo(playerId, next.error);
        this.room = next;
        // The action may have ended and settled the hand; the result (winners, revealed cards) is
        // broadcast now and STAYS on screen until someone deals the next hand — dealing here would
        // wipe the showdown before anyone saw it.
        return this.broadcastState();
      }
      case 'deal':
        // Any seated player may ask for the next hand once the current one is settled; dealNext is a
        // no-op while a hand is still live, so this cannot interrupt play.
        return this.dealNext();
      case 'entropy-commit':
        return this.onCommitment(playerId, msg.hand, msg.nonce, msg.commitment);
      case 'entropy-reveal':
        return this.onReveal(playerId, msg.hand, msg.nonce, msg.entropy);
    }
  }

  /**
   * Start the next deal once two players are present and the last hand is over. Idempotent and safe to
   * call any time: a no-op while a hand is live, a deal is already pending, or fewer than two players
   * are seated. The transport calls this when any player asks for the next hand.
   */
  dealNext(): Outbound[] {
    if (this.room.players.length < 2) return this.broadcastState();
    const handLive = this.room.table !== null && this.room.table.winners === null;
    if (handLive || this.pending !== null) return this.broadcastState();
    return [...this.broadcastState(), ...this.beginDeal()];
  }

  /**
   * Called by the transport on a timer. A guest that has not answered in time is removed from the table
   * (its connection closed), and the deal starts again without it. Dealing around it instead would let
   * a host drop any guest's entropy and choose the shuffle, so a guest treats that as cheating.
   */
  tick(): Outbound[] {
    const pending = this.pending;
    if (pending === null || this.now() < pending.deadline) return [];
    const waitingOn = pending.phase === 'commit' ? pending.commitments : pending.reveals;
    const silent = [...pending.participants.keys()].filter((id) => !waitingOn.has(id));
    return this.removeAndRedeal(silent, 'you did not answer the deal in time');
  }

  /** Remove players that failed the handshake, tell each why, and deal again for the rest. */
  private removeAndRedeal(players: readonly PlayerId[], reason: string): Outbound[] {
    const notices: Outbound[] = players.map((to) => ({ to, message: { type: 'error', reason }, close: true }));
    for (const id of players) {
      this.room = playerLeaves(this.room, id);
      this.connected.delete(id);
    }
    return [...notices, ...this.broadcastState(), ...this.restartDeal()];
  }

  // ── The deal handshake ─────────────────────────────────────────────────────

  /** Seal a fresh order for the next hand and publish its commitment. */
  private beginDeal(): Outbound[] {
    const handed = handBase(this.room);
    if ('error' in handed) return [];
    // Seats follow the people in them. A seat whose player has left sits out: dealt in, nobody could
    // act for it and the table would stall on its turn, so its chips leave with the player. A seat
    // taken by someone new since its last hand (a rejoin, or a late joiner) is bought in afresh; a
    // player who busted and stayed is still the same occupant and stays out.
    const occupant = new Map(this.room.players.map((p) => [p.seatId, p.playerId]));
    const base: TableState = {
      ...handed,
      seats: handed.seats.map((seat) => {
        const who = occupant.get(seat.id);
        if (who === undefined) return { ...seat, stack: 0 };
        const newcomer = handed.handNumber > 0 && this.seatedAt.get(seat.id) !== who;
        return newcomer ? { ...seat, name: this.room.players.find((p) => p.playerId === who)!.name, stack: this.room.startStack } : seat;
      }),
    };
    // Who is dealt in and who has the button do not depend on the cards, so a dry run with any deck
    // tells the host the deal order to commit to before sigma exists.
    const probe = startHand(base, freshDeck());
    const dealOrder = expectedDealOrder(probe.seats.length, probe.dealer, (s) => probe.seats[s].hole.length > 0);
    if (dealOrder.length < 2) return []; // one seat with chips: no hand to deal
    const sealed = sealDeck(this.crypto, probe.handNumber, probe.dealer, dealOrder);
    const participants = new Map<PlayerId, number>();
    for (const p of this.room.players) {
      if (p.playerId !== this.dealerPlayerId && this.connected.has(p.playerId)) {
        participants.set(p.playerId, p.seatId);
      }
    }
    this.pending = {
      base,
      sealed,
      participants,
      recipients: new Set(this.connected),
      occupants: occupant,
      commitments: new Map(),
      reveals: new Map(),
      phase: 'commit',
      deadline: this.now() + this.timeoutMs,
    };
    const out = this.toAll(sealed.commit);
    // No guest to contribute (only the dealer's seat is connected): deal on the host's order alone.
    return participants.size === 0 ? [...out, ...this.finishDeal()] : out;
  }

  private restartDeal(): Outbound[] {
    this.pending = null;
    if (this.room.players.length < 2) return [];
    return this.beginDeal();
  }

  private onCommitment(playerId: PlayerId, hand: number, nonce: string, commitment: string): Outbound[] {
    const pending = this.pending;
    if (pending === null || pending.phase !== 'commit' || !this.matches(pending, hand, nonce)) {
      return this.errorTo(playerId, 'no deal is waiting for that commitment');
    }
    if (!pending.participants.has(playerId)) return [];
    if (!isHex64(commitment) || pending.commitments.has(playerId)) {
      return this.errorTo(playerId, 'malformed or repeated commitment');
    }
    if ([...pending.commitments.values()].includes(commitment)) {
      return this.errorTo(playerId, 'that commitment is already taken');
    }
    pending.commitments.set(playerId, commitment);
    if (pending.commitments.size < pending.participants.size) return [];
    // Everyone has committed: publish the set, so each guest checks its own is in it, then reveal.
    pending.phase = 'reveal';
    pending.deadline = this.now() + this.timeoutMs;
    const commitments = [...pending.commitments].map(([id, c]) => ({ seat: pending.participants.get(id)!, commitment: c }));
    const { hand: h, nonce: n } = pending.sealed.commit;
    return this.toAll({ type: 'entropy-set', hand: h, nonce: n, commitments });
  }

  private onReveal(playerId: PlayerId, hand: number, nonce: string, entropy: string): Outbound[] {
    const pending = this.pending;
    if (pending === null || pending.phase !== 'reveal' || !this.matches(pending, hand, nonce)) {
      return this.errorTo(playerId, 'no deal is waiting for that reveal');
    }
    const commitment = pending.commitments.get(playerId);
    if (commitment === undefined || pending.reveals.has(playerId)) return [];
    if (!isHex64(entropy) || entropyCommitment(this.crypto.sha256, nonce, hand, entropy) !== commitment) {
      // A reveal that does not open its commitment is an abort: remove this guest and deal again.
      return this.removeAndRedeal([playerId], 'your reveal did not match your commitment');
    }
    pending.reveals.set(playerId, entropy);
    return pending.reveals.size < pending.commitments.size ? [] : this.finishDeal();
  }

  private matches(pending: PendingDeal, hand: number, nonce: string): boolean {
    return hand === pending.sealed.commit.hand && nonce === pending.sealed.commit.nonce;
  }

  /** Every reveal is in: derive sigma, deal, and broadcast the reveals and the dealt state. */
  private finishDeal(): Outbound[] {
    const pending = this.pending!;
    const reveals = [...pending.reveals].map(([id, entropy]) => ({ seat: pending.participants.get(id)!, entropy }));
    const sigma = deriveSigma(this.crypto.sha256, pending.sealed.commit, reveals);
    this.room = dealRoomHand(this.room, pending.base, engineDeck(pending.sealed, sigma), pending.recipients);
    this.live = { hand: pending.sealed.commit.hand, sealed: pending.sealed, sigma };
    this.seatedAt = new Map(pending.occupants);
    this.pending = null;
    const { hand, nonce } = pending.sealed.commit;
    return [...this.toAll({ type: 'dealt', hand, nonce, reveals }), ...this.broadcastState()];
  }
}
