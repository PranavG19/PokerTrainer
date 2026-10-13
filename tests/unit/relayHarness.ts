import * as crypto from 'node:crypto';
import type { DealCrypto } from '../../src/core/dealCommit.js';
import type { ClientMessage, CreateRoomOpts, PlayerId, RoomView, ServerMessage } from '../../src/core/multiplayer.js';
import { GuestProtocol, type GuestEvent } from '../../src/core/relayGuest.js';
import { RelayServer, type Outbound, type RelayServerDeps } from '../../src/core/relayServer.js';

/** node:crypto behind core's interface, as main injects it. */
export const testCrypto: DealCrypto = {
  random: (n) => crypto.randomBytes(n),
  sha256: (d) => crypto.createHash('sha256').update(d).digest(),
};

export const ROOM: CreateRoomOpts = { roomId: 'r1', seatCount: 3, sb: 25, bb: 50, startStack: 5000 };

/**
 * A RelayServer with real GuestProtocols for its remote players and no sockets: every outbound message
 * goes through the addressed guest's protocol and every reply goes straight back into the server, so a
 * whole deal handshake runs synchronously. `tamper` lets a test play a malicious host by rewriting a
 * message on its way to one guest.
 */
export class Table {
  readonly server: RelayServer;
  readonly guests = new Map<PlayerId, GuestProtocol>();
  /** Every message each player received, in order (the wire). */
  readonly wire = new Map<PlayerId, ServerMessage[]>();
  /** Every event each guest's protocol raised. */
  readonly events = new Map<PlayerId, GuestEvent[]>();
  tamper: (to: PlayerId, message: ServerMessage) => ServerMessage | null = (_to, m) => m;
  /** Players whose replies are held back (a silent or slow guest); release() sends them late. */
  readonly mute = new Set<PlayerId>();
  private readonly held = new Map<PlayerId, ClientMessage[]>();

  constructor(opts: Partial<CreateRoomOpts> = {}, deps: Partial<RelayServerDeps> = {}) {
    this.server = new RelayServer({ ...ROOM, ...opts }, { crypto: testCrypto, ...deps });
  }

  join(playerId: PlayerId, name = playerId, guest = true): void {
    if (guest) this.guests.set(playerId, new GuestProtocol(testCrypto));
    this.route(this.server.connect(playerId, name));
  }

  send(playerId: PlayerId, message: ClientMessage): void {
    this.route(this.server.message(playerId, message));
  }

  route(outbound: Outbound[]): void {
    const queue = [...outbound];
    while (queue.length > 0) {
      const { to, message: original } = queue.shift()!;
      const message = this.tamper(to, original);
      if (message === null) continue;
      if (!this.wire.has(to)) this.wire.set(to, []);
      this.wire.get(to)!.push(message);
      const guest = this.guests.get(to);
      if (guest === undefined) continue;
      const step = guest.receive(message);
      if (!this.events.has(to)) this.events.set(to, []);
      this.events.get(to)!.push(...step.events);
      if (this.mute.has(to)) {
        this.held.set(to, [...(this.held.get(to) ?? []), ...step.send]);
        continue;
      }
      for (const reply of step.send) queue.push(...this.server.message(to, reply));
    }
  }

  /** Unmute a player and send the replies it held back, in order. */
  release(playerId: PlayerId): void {
    this.mute.delete(playerId);
    const replies = this.held.get(playerId) ?? [];
    this.held.delete(playerId);
    for (const reply of replies) this.route(this.server.message(playerId, reply));
  }

  /** The latest state view a player received. */
  view(playerId: PlayerId): RoomView {
    const states = (this.wire.get(playerId) ?? []).filter((m) => m.type === 'state');
    const last = states[states.length - 1];
    if (last === undefined || last.type !== 'state') throw new Error(`${playerId} has no view`);
    return last.view;
  }

  eventsOf(playerId: PlayerId, type: GuestEvent['type']): GuestEvent[] {
    return (this.events.get(playerId) ?? []).filter((e) => e.type === type);
  }

  /** Check or call for whoever is to act until the hand ends. */
  playOut(): void {
    for (let i = 0; i < 60; i += 1) {
      const table = this.server.roomState().table;
      if (table === null || table.winners !== null) return;
      const actor = this.server.roomState().players.find((p) => p.seatId === table.toAct)!;
      const kind = table.currentBet > table.seats[table.toAct].committed ? 'call' : 'check';
      this.send(actor.playerId, { type: 'action', action: { kind } });
    }
  }
}
