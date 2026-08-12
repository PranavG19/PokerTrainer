/**
 * RELAY SERVER — the transport-agnostic orchestration over a multiplayer room.
 *
 * This is the stateful layer between raw connection events and the pure room reducers (multiplayer.ts).
 * It holds the current RoomState, applies each client message to it, decides when to deal a hand, and
 * — for every change — computes the set of REDACTED broadcasts to send back (one per connected player,
 * each built through viewFor so no client ever receives an opponent's hole). It has NO socket of its
 * own: a transport (a main-process WebSocket, Phase 2b) feeds it connect/disconnect/message and sends
 * the broadcasts it returns. Keeping the routing here means it is unit-testable with no server to run.
 *
 * The server never throws on bad input: a malformed or out-of-turn message returns an `error` message
 * addressed only to its sender, and everyone's state is otherwise unchanged — a hostile client cannot
 * crash the room or drive another seat.
 */

import {
  applyPlayerAction,
  createRoom,
  playerJoins,
  playerLeaves,
  startRoomHand,
  viewFor,
  type ClientMessage,
  type CreateRoomOpts,
  type PlayerId,
  type RoomState,
  type ServerMessage,
} from './multiplayer.js';

/** One message the transport must deliver to exactly one connected player. */
export interface Outbound {
  readonly to: PlayerId;
  readonly message: ServerMessage;
}

export class RelayServer {
  private room: RoomState;
  /** Players with a live connection right now — the recipients of every state broadcast. */
  private readonly connected = new Set<PlayerId>();

  constructor(opts: CreateRoomOpts) {
    this.room = createRoom(opts);
  }

  /** The current room (read-only view for tests/host UI); callers must not mutate it. */
  roomState(): RoomState {
    return this.room;
  }

  /** A fresh state broadcast to every connected player — the redacted view each is allowed to see. */
  private broadcastState(): Outbound[] {
    const out: Outbound[] = [];
    for (const playerId of this.connected) {
      const view = viewFor(this.room, playerId);
      // A connected player is always in the room, so viewFor cannot error here; guard defensively.
      if ('error' in view) continue;
      out.push({ to: playerId, message: { type: 'state', view } });
    }
    return out;
  }

  /** An error addressed only to the sender; no state changes and no one else hears it. */
  private errorTo(playerId: PlayerId, reason: string): Outbound[] {
    return [{ to: playerId, message: { type: 'error', reason } }];
  }

  /**
   * A player's socket opened. Seats them (via the join protocol), deals the first hand once two
   * players are present and none is in progress, and broadcasts the new state to everyone.
   */
  connect(playerId: PlayerId, name: string): Outbound[] {
    const joined = playerJoins(this.room, playerId, name);
    if ('error' in joined) return this.errorTo(playerId, joined.error);
    this.room = joined.room;
    this.connected.add(playerId);
    this.maybeDeal();
    return this.broadcastState();
  }

  /** A player's socket closed. Frees their seat and broadcasts to whoever remains. */
  disconnect(playerId: PlayerId): Outbound[] {
    this.room = playerLeaves(this.room, playerId);
    this.connected.delete(playerId);
    return this.broadcastState();
  }

  /**
   * Route one client message. `join` is handled by connect() at the transport layer, so a `join` here
   * (a re-join with a new name mid-session) is treated as a no-op state resend; `leave` disconnects;
   * `action` is validated and applied. Any failure returns an error to the sender only.
   */
  message(playerId: PlayerId, msg: ClientMessage): Outbound[] {
    switch (msg.type) {
      case 'join':
        // The socket is already connected; just resend this player their current state.
        return this.broadcastState();
      case 'leave':
        return this.disconnect(playerId);
      case 'action': {
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
    }
  }

  /**
   * Deal the first hand once two players are present, or the next hand after one is over. Idempotent
   * and safe to call any time: a no-op while a hand is still live or fewer than two players are
   * seated. The transport calls this when the host (or any player) asks for the next hand, mirroring
   * the single-player "Next hand" button.
   */
  dealNext(): Outbound[] {
    if (this.room.players.length < 2) return this.broadcastState();
    const handLive = this.room.table !== null && this.room.table.winners === null;
    if (handLive) return this.broadcastState();
    const dealt = startRoomHand(this.room);
    if (!('error' in dealt)) this.room = dealt;
    return this.broadcastState();
  }

  /** Deal the first hand automatically once enough players are connected (called after a join). */
  private maybeDeal(): void {
    const noHandYet = this.room.table === null;
    if (noHandYet && this.room.players.length >= 2) {
      const dealt = startRoomHand(this.room);
      if (!('error' in dealt)) this.room = dealt;
    }
  }
}
