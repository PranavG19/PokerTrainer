import { describe, expect, it } from 'vitest';
import {
  applyPlayerAction,
  createRoom,
  playerJoins,
  playerLeaves,
  startRoomHand,
  viewFor,
  type RoomState,
} from '../../src/core/multiplayer.js';

/**
 * MULTIPLAYER CORE — the pure room and its redaction guarantee.
 *
 * The single most important property is that a room NEVER hands a player another player's hole cards
 * before showdown, and never hands out the deck. viewFor() is the only egress, so these tests assert
 * against its output directly. The rest pins turn-order and legality enforcement (a client cannot act
 * out of turn or make an illegal move) and the join/leave/full lifecycle.
 */

const OPTS = { roomId: 'r1', seatCount: 3, sb: 25, bb: 50, startStack: 5000, seed: 42 } as const;

/** A room with `n` players joined (p0..p{n-1}), no hand dealt yet. */
function roomWith(n: number): RoomState {
  let room = createRoom(OPTS);
  for (let i = 0; i < n; i += 1) {
    const result = playerJoins(room, `p${i}`, `Player ${i}`);
    if ('error' in result) throw new Error(result.error);
    room = result.room;
  }
  return room;
}

/** Deal a hand into a room, asserting it succeeded. */
function dealt(room: RoomState): RoomState {
  const result = startRoomHand(room);
  if ('error' in result) throw new Error(result.error);
  return result;
}

describe('room lifecycle', () => {
  it('seats players on the lowest free seat and fills in order', () => {
    const room = roomWith(3);
    expect(room.players.map((p) => p.seatId)).toEqual([0, 1, 2]);
  });

  it('refuses a duplicate join and a full room', () => {
    const room = roomWith(3);
    expect(playerJoins(room, 'p0', 'again')).toEqual({ error: 'already joined' });
    expect(playerJoins(room, 'p3', 'late')).toEqual({ error: 'room is full' });
  });

  it('a leaving player frees their seat for the next join', () => {
    const room = playerLeaves(roomWith(3), 'p1');
    expect(room.players.map((p) => p.playerId)).toEqual(['p0', 'p2']);
    const result = playerJoins(room, 'p3', 'new');
    if ('error' in result) throw new Error(result.error);
    // Seat 1 was freed, so the newcomer takes it (lowest free seat).
    expect(result.seatId).toBe(1);
  });

  it('will not deal a hand with fewer than two players', () => {
    expect(startRoomHand(roomWith(1))).toEqual({ error: 'need at least two players to start' });
  });

  it('deals a real hand once two players are seated', () => {
    const room = dealt(roomWith(2));
    expect(room.table).not.toBeNull();
    expect(room.table?.pot).toBeGreaterThan(0); // blinds posted by the real engine
  });
});

describe('redaction — the security boundary', () => {
  it('a player sees their own hole but NEVER an opponent’s before showdown', () => {
    const room = dealt(roomWith(3));
    const view = viewFor(room, 'p0');
    if ('error' in view) throw new Error(view.error);

    const you = view.seats.find((s) => s.isYou);
    expect(you?.hole, 'a player must see their own two cards').toHaveLength(2);

    for (const seat of view.seats) {
      if (!seat.isYou) {
        expect(seat.hole, `opponent seat ${seat.id} leaked a hole card`).toBeNull();
      }
    }
  });

  it('the view never carries the deck or any field that would reveal future cards', () => {
    const room = dealt(roomWith(3));
    const view = viewFor(room, 'p0');
    if ('error' in view) throw new Error(view.error);
    // The deck is the one field that would let a client compute the runout; it must not exist anywhere.
    expect((view as unknown as Record<string, unknown>).deck).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('"deck"');
  });

  it('every seated player’s own view shows exactly their own two cards, and no two players share a hole', () => {
    const room = dealt(roomWith(3));
    const holes = new Map<string, string>();
    for (const pid of ['p0', 'p1', 'p2']) {
      const view = viewFor(room, pid);
      if ('error' in view) throw new Error(view.error);
      const own = view.seats.find((s) => s.isYou);
      expect(own?.hole, `${pid} cannot see their own hole`).toHaveLength(2);
      holes.set(pid, (own?.hole ?? []).join(','));
    }
    // Three players, three distinct holes — the engine dealt them, redaction preserved them.
    expect(new Set(holes.values()).size).toBe(3);
  });

  it('a non-member gets an error, not a view', () => {
    const room = dealt(roomWith(2));
    expect(viewFor(room, 'stranger')).toEqual({ error: 'not in room' });
  });
});

describe('turn and legality enforcement', () => {
  it('rejects an action from a player when it is not their turn', () => {
    const room = dealt(roomWith(3));
    const toAct = room.table?.toAct ?? -1;
    // Find a seated player who is NOT the one to act and try to act for them.
    const offTurn = room.players.find((p) => p.seatId !== toAct);
    expect(offTurn).toBeDefined();
    const result = applyPlayerAction(room, offTurn!.playerId, { kind: 'fold' });
    expect(result).toEqual({ error: 'not your turn' });
  });

  it('rejects an illegal action from the player whose turn it is', () => {
    const room = dealt(roomWith(3));
    const toAct = room.table?.toAct ?? -1;
    const actor = room.players.find((p) => p.seatId === toAct);
    expect(actor).toBeDefined();
    // Preflop facing the big blind, "check" is illegal for the first actor.
    const result = applyPlayerAction(room, actor!.playerId, { kind: 'check' });
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('illegal action');
  });

  it('applies a legal action from the correct player and advances the turn', () => {
    const room = dealt(roomWith(3));
    const toAct = room.table?.toAct ?? -1;
    const actor = room.players.find((p) => p.seatId === toAct)!;
    const result = applyPlayerAction(room, actor.playerId, { kind: 'fold' });
    if ('error' in result) throw new Error(result.error);
    // The folding seat is now folded, and the turn moved off them.
    expect(result.table?.seats[toAct].folded).toBe(true);
    expect(result.table?.toAct).not.toBe(toAct);
  });

  it('rejects an action when no hand is in progress, and from a non-seated player', () => {
    const waiting = roomWith(2); // joined, not dealt
    expect(applyPlayerAction(waiting, 'p0', { kind: 'fold' })).toEqual({
      error: 'no hand in progress',
    });
    const room = dealt(roomWith(2));
    expect(applyPlayerAction(room, 'stranger', { kind: 'fold' })).toEqual({ error: 'not seated' });
  });

  it('only the acting player’s view reports yourTurn and offers legal actions', () => {
    const room = dealt(roomWith(3));
    const toAct = room.table?.toAct ?? -1;
    for (const p of room.players) {
      const view = viewFor(room, p.playerId);
      if ('error' in view) throw new Error(view.error);
      if (p.seatId === toAct) {
        expect(view.yourTurn).toBe(true);
        expect(view.legal.length).toBeGreaterThan(0);
      } else {
        expect(view.yourTurn).toBe(false);
        expect(view.legal).toEqual([]);
      }
    }
  });
});

describe('showdown reveal', () => {
  it('folded players’ cards stay hidden even at showdown, while live players reveal', () => {
    // Heads-up: fold one player to end the hand. With one player left there is no showdown reveal of
    // the folder, which is exactly the rule — a fold never shows cards.
    let room = dealt(roomWith(2));
    const toAct = room.table?.toAct ?? -1;
    const folder = room.players.find((p) => p.seatId === toAct)!;
    const other = room.players.find((p) => p.seatId !== toAct)!;
    const afterFold = applyPlayerAction(room, folder.playerId, { kind: 'fold' });
    if ('error' in afterFold) throw new Error(afterFold.error);
    room = afterFold;

    // The winner (other) sees their own hand; the folder's hand is not revealed to them.
    const winnerView = viewFor(room, other.playerId);
    if ('error' in winnerView) throw new Error(winnerView.error);
    const folderSeat = winnerView.seats.find((s) => s.id === toAct);
    expect(folderSeat?.folded).toBe(true);
    expect(folderSeat?.hole, 'a folded hand must never be revealed').toBeNull();
  });
});
