/**
 * MULTIPLAYER — the pure protocol and room core.
 *
 * This file has NO network and NO IPC. It is the deterministic heart of a multiplayer table: a room
 * that seats players onto the real poker engine (table.ts, unmodified), validates that an action came
 * from the player whose turn it is and is legal, and — critically — REDACTS the state per player so a
 * client is never sent another player's hole cards before showdown. The transport (a main-process
 * WebSocket, gated behind the same opt-in as the tutor) and the renderer wiring are separate layers
 * built on top of this; keeping the rules here means they are unit-testable against the real engine
 * with no server to stand up.
 *
 * WHY REDACTION LIVES HERE, NOT IN THE TRANSPORT. The one unforgivable multiplayer bug is leaking a
 * card. If redaction were a step the network layer remembered to apply, a new code path could forget
 * it. Instead the ONLY state a room hands out is via viewFor(), which cannot return an opponent's
 * hole. A test asserts that directly, so the guarantee is checked rather than trusted.
 */

import type { Card } from './cards.js';
import {
  applyAction,
  createTable,
  isHandOver,
  legalActions,
  settle,
  startHand,
  type Action,
  type Seat,
  type TableState,
} from './table.js';

/** A stable identifier for a connected player, assigned by the transport when it accepts a socket. */
export type PlayerId = string;

/** A seated player: which table seat they own, and their chosen name. */
export interface RoomPlayer {
  readonly playerId: PlayerId;
  readonly seatId: number;
  readonly name: string;
}

/**
 * A room is the table plus the player↔seat mapping and whether a hand is in progress. The engine
 * state is the source of truth for chips/board/turn; the room only adds who is connected to which
 * seat. `null` table means the room exists but no hand has been dealt yet (waiting for players).
 */
export interface RoomState {
  readonly roomId: string;
  readonly players: readonly RoomPlayer[];
  readonly seatCount: number;
  readonly sb: number;
  readonly bb: number;
  readonly startStack: number;
  readonly seed: number;
  /** The live engine state once a hand is dealt; null while waiting to start. */
  readonly table: TableState | null;
}

// ── Messages ─────────────────────────────────────────────────────────────────
// A tiny tagged-union protocol. All plain-serializable so the transport can JSON them unchanged.

/** Client → server. */
export type ClientMessage =
  | { readonly type: 'join'; readonly name: string }
  | { readonly type: 'leave' }
  | { readonly type: 'action'; readonly action: Action }
  // Request the next hand after one has ended. Any seated player may ask — the server only deals when
  // the current hand is settled, so a mid-hand request is a harmless no-op. Lets a joined (non-host)
  // player advance a finished hand instead of waiting on the host.
  | { readonly type: 'deal' };

/** Server → client. `state` is ALWAYS the redacted view for the recipient (see viewFor). */
export type ServerMessage =
  | { readonly type: 'state'; readonly view: RoomView }
  | { readonly type: 'error'; readonly reason: string };

// ── Redacted view ──────────────────────────────────────────────────────────────

/**
 * A seat as one player is allowed to see it. Another player's hole is `null` until showdown reveals
 * it; the viewer always sees their own. Everything else (stack, committed, folded, all-in) is public
 * at a real table and stays visible.
 */
export interface SeatView {
  readonly id: number;
  readonly name: string;
  readonly stack: number;
  readonly committed: number;
  readonly folded: boolean;
  readonly allIn: boolean;
  /** The viewer's own hole, a revealed showdown hand, or null when hidden. */
  readonly hole: readonly Card[] | null;
  /** True when this seat belongs to the player the view was built for. */
  readonly isYou: boolean;
}

/**
 * The whole table as one player may see it. The deck is NEVER included — it is the one piece of state
 * that would let a client compute future cards — and opponents' holes are redacted per SeatView.
 */
export interface RoomView {
  readonly roomId: string;
  readonly you: PlayerId;
  readonly seats: readonly SeatView[];
  readonly board: readonly Card[];
  readonly street: TableState['street'];
  readonly pot: number;
  readonly currentBet: number;
  readonly toAct: number;
  readonly dealer: number;
  readonly handNumber: number;
  readonly winners: TableState['winners'];
  /** The actions legal for the viewer right now, empty when it is not their turn or no hand is live. */
  readonly legal: readonly Action['kind'][];
  /** True when it is this player's turn to act. */
  readonly yourTurn: boolean;
}

// ── Room reducers (pure) ─────────────────────────────────────────────────────

export interface CreateRoomOpts {
  readonly roomId: string;
  readonly seatCount: number;
  readonly sb: number;
  readonly bb: number;
  readonly startStack: number;
  readonly seed: number;
}

/** A fresh, empty room. No hand is dealt until enough players have joined and startRoomHand runs. */
export function createRoom(opts: CreateRoomOpts): RoomState {
  if (opts.seatCount < 2 || opts.seatCount > 6) {
    throw new RangeError(`room ${opts.roomId}: seatCount ${opts.seatCount} out of 2..6`);
  }
  return {
    roomId: opts.roomId,
    players: [],
    seatCount: opts.seatCount,
    sb: opts.sb,
    bb: opts.bb,
    startStack: opts.startStack,
    seed: opts.seed,
    table: null,
  };
}

/** The lowest seat index not already taken, or null when the room is full. */
function freeSeat(room: RoomState): number | null {
  const taken = new Set(room.players.map((p) => p.seatId));
  for (let i = 0; i < room.seatCount; i += 1) {
    if (!taken.has(i)) return i;
  }
  return null;
}

/**
 * Seat a new player. Returns the updated room and the seat they took, or an error reason when the
 * room is full or the player is already seated. Joining does NOT start a hand — the transport decides
 * when to deal (e.g. once two seats are filled) by calling startRoomHand.
 */
export function playerJoins(
  room: RoomState,
  playerId: PlayerId,
  name: string,
): { room: RoomState; seatId: number } | { error: string } {
  if (room.players.some((p) => p.playerId === playerId)) {
    return { error: 'already joined' };
  }
  const seatId = freeSeat(room);
  if (seatId === null) return { error: 'room is full' };
  const player: RoomPlayer = { playerId, seatId, name: name.slice(0, 24) || `Seat ${seatId + 1}` };
  return { room: { ...room, players: [...room.players, player] }, seatId };
}

/** Remove a player from the room. A no-op if they were not seated. Does not alter a live hand's chips. */
export function playerLeaves(room: RoomState, playerId: PlayerId): RoomState {
  return { ...room, players: room.players.filter((p) => p.playerId !== playerId) };
}

/**
 * Deal a hand. On the FIRST hand it builds the engine table from the seated players (a seat with no
 * player is a chipless empty seat the engine sits out); on every SUBSEQUENT hand it calls startHand on
 * the EXISTING table so the engine carries stacks forward, rotates the dealer, advances the hand
 * number and reshuffles (seed + handNumber) — building a fresh createTable each time would reset the
 * seed and stacks and re-deal the identical hand. Requires at least two seated players.
 */
export function startRoomHand(room: RoomState): RoomState | { error: string } {
  if (room.players.length < 2) return { error: 'need at least two players to start' };
  if (room.table !== null) {
    // A table already exists (a prior hand): advance it rather than rebuilding from scratch.
    return { ...room, table: startHand(room.table) };
  }
  const seats = Array.from({ length: room.seatCount }, (_unused, i) => {
    const player = room.players.find((p) => p.seatId === i);
    return {
      name: player?.name ?? `Empty ${i + 1}`,
      // A seat with no player has no chips, so the engine sits it out rather than dealing it in.
      stack: player ? room.startStack : 0,
      isHero: false,
      avatar: player ? player.name.charAt(0).toUpperCase() : '·',
    };
  });
  const table = createTable({ seats, sb: room.sb, bb: room.bb, seed: room.seed });
  return { ...room, table: startHand(table) };
}

/** The seat a player owns, or null if they are not seated. */
function seatOf(room: RoomState, playerId: PlayerId): number | null {
  return room.players.find((p) => p.playerId === playerId)?.seatId ?? null;
}

/**
 * Apply a player's action to the live hand. Validates, in order: a hand is live, the player is
 * seated, it is their turn, and the action kind is currently legal. Only then does it delegate to the
 * engine's applyAction. Any failure returns an error reason and leaves the room unchanged — a client
 * can never drive another seat or make an illegal move, because the check is here, not in the UI.
 */
export function applyPlayerAction(
  room: RoomState,
  playerId: PlayerId,
  action: Action,
): RoomState | { error: string } {
  if (room.table === null) return { error: 'no hand in progress' };
  const seatId = seatOf(room, playerId);
  if (seatId === null) return { error: 'not seated' };
  if (room.table.toAct !== seatId) return { error: 'not your turn' };
  if (!legalActions(room.table).includes(action.kind)) {
    return { error: `illegal action: ${action.kind}` };
  }
  const played = applyAction(room.table, action);
  // If the action ended the hand (a fold-out or the river closing), settle it now so the pot is
  // awarded, winners are populated and showdown cards reveal — the same isHandOver→settle step the
  // single-player table screen runs. applyAction does NOT settle on its own.
  const table = isHandOver(played) ? settle(played) : played;
  return { ...room, table };
}

// ── Redaction (the security boundary) ────────────────────────────────────────

/** Whether a seat's hole may be shown to anyone: only its owner, or at showdown once revealed. */
function holeVisible(seat: Seat, isViewer: boolean, street: TableState['street']): boolean {
  if (isViewer) return true;
  // At showdown, only players still in the hand reveal; folded players' cards stay hidden.
  return street === 'showdown' && !seat.folded;
}

/**
 * The redacted view of the room for one player — the ONLY way state leaves a room. An opponent's hole
 * is null unless showdown has revealed it; the deck is never included at all. Returns an error view
 * when the player is not in the room.
 */
export function viewFor(room: RoomState, playerId: PlayerId): RoomView | { error: string } {
  const seatId = seatOf(room, playerId);
  if (seatId === null) return { error: 'not in room' };
  const table = room.table;

  if (table === null) {
    // No hand yet: seats show who has joined, no cards, no turn.
    return {
      roomId: room.roomId,
      you: playerId,
      seats: room.players
        .slice()
        .sort((a, b) => a.seatId - b.seatId)
        .map((p) => ({
          id: p.seatId,
          name: p.name,
          stack: room.startStack,
          committed: 0,
          folded: false,
          allIn: false,
          hole: null,
          isYou: p.seatId === seatId,
        })),
      board: [],
      street: 'preflop',
      pot: 0,
      currentBet: 0,
      toAct: -1,
      dealer: -1,
      handNumber: 0,
      winners: null,
      legal: [],
      yourTurn: false,
    };
  }

  const seats: SeatView[] = table.seats.map((seat) => {
    const isViewer = seat.id === seatId;
    return {
      id: seat.id,
      name: seat.name,
      stack: seat.stack,
      committed: seat.committed,
      folded: seat.folded,
      allIn: seat.allIn,
      hole: holeVisible(seat, isViewer, table.street) ? [...seat.hole] : null,
      isYou: isViewer,
    };
  });

  const yourTurn = table.toAct === seatId && table.winners === null;
  return {
    roomId: room.roomId,
    you: playerId,
    seats,
    board: [...table.board],
    street: table.street,
    pot: table.pot,
    currentBet: table.currentBet,
    toAct: table.toAct,
    dealer: table.dealer,
    handNumber: table.handNumber,
    winners: table.winners,
    legal: yourTurn ? legalActions(table) : [],
    yourTurn,
  };
}
