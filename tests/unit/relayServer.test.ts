import { describe, expect, it } from 'vitest';
import { RelayServer, type Outbound } from '../../src/core/relayServer.js';

/**
 * RELAY SERVER — the orchestration between connection events and the pure room.
 *
 * These tests use no socket: connect/disconnect/message are plain calls returning the list of redacted
 * broadcasts a transport would send. The security property proven in multiplayer.test.ts (no opponent
 * hole leaks) is re-checked HERE at the broadcast boundary, because this is the layer a real transport
 * actually calls — a regression that leaked through a broadcast would show up here.
 */

const OPTS = { roomId: 'r1', seatCount: 3, sb: 25, bb: 50, startStack: 5000, seed: 42 } as const;

/** The state view delivered to one player in an outbound batch, or null if none was sent to them. */
function viewIn(out: Outbound[], playerId: string) {
  const hit = out.find((o) => o.to === playerId && o.message.type === 'state');
  return hit && hit.message.type === 'state' ? hit.message.view : null;
}

/** A server with two connected players, which auto-deals the first hand. */
function twoPlayerServer(): RelayServer {
  const server = new RelayServer(OPTS);
  server.connect('a', 'Alice');
  server.connect('b', 'Bob');
  return server;
}

describe('connection lifecycle', () => {
  it('broadcasts to every connected player on each join', () => {
    const server = new RelayServer(OPTS);
    const first = server.connect('a', 'Alice');
    expect(first.map((o) => o.to)).toEqual(['a']);

    const second = server.connect('b', 'Bob');
    // Both players now hear the updated state.
    expect(new Set(second.map((o) => o.to))).toEqual(new Set(['a', 'b']));
  });

  it('auto-deals a hand once the second player joins', () => {
    const server = new RelayServer(OPTS);
    server.connect('a', 'Alice');
    expect(server.roomState().table, 'one player should not start a hand').toBeNull();
    server.connect('b', 'Bob');
    expect(server.roomState().table, 'two players should trigger a deal').not.toBeNull();
  });

  it('a rejected join (duplicate) errors only the sender and changes nothing', () => {
    const server = twoPlayerServer();
    const out = server.connect('a', 'Alice again');
    expect(out).toEqual([{ to: 'a', message: { type: 'error', reason: 'already joined' } }]);
    expect(server.roomState().players).toHaveLength(2);
  });

  it('disconnect frees the seat and broadcasts to the remainder', () => {
    const server = twoPlayerServer();
    const out = server.disconnect('a');
    expect(server.roomState().players.map((p) => p.playerId)).toEqual(['b']);
    // Only the still-connected player hears the update.
    expect(out.map((o) => o.to)).toEqual(['b']);
  });
});

describe('redaction carries through the broadcast boundary', () => {
  it('each player’s broadcast shows their own hole and never an opponent’s', () => {
    const server = twoPlayerServer();
    // Re-broadcast current state by having a player send a benign join message.
    const out = server.message('a', { type: 'join', name: 'Alice' });

    const aView = viewIn(out, 'a');
    expect(aView).not.toBeNull();
    const aOwn = aView!.seats.find((s) => s.isYou);
    expect(aOwn?.hole, 'a player must see their own cards').toHaveLength(2);
    for (const seat of aView!.seats) {
      if (!seat.isYou) expect(seat.hole, 'an opponent hole leaked in a broadcast').toBeNull();
    }
  });

  it('no broadcast anywhere contains the deck', () => {
    const server = twoPlayerServer();
    const out = server.message('a', { type: 'join', name: 'Alice' });
    expect(JSON.stringify(out)).not.toContain('"deck"');
  });
});

describe('actions through the server', () => {
  it('an out-of-turn action errors only the sender and leaves state unchanged', () => {
    const server = twoPlayerServer();
    const toAct = server.roomState().table?.toAct ?? -1;
    const offTurn = server.roomState().players.find((p) => p.seatId !== toAct)!;
    const before = JSON.stringify(server.roomState().table);
    const out = server.message(offTurn.playerId, { type: 'action', action: { kind: 'fold' } });
    expect(out).toEqual([
      { to: offTurn.playerId, message: { type: 'error', reason: 'not your turn' } },
    ]);
    expect(JSON.stringify(server.roomState().table)).toBe(before);
  });

  it('a legal action from the right player applies and re-broadcasts to all', () => {
    const server = twoPlayerServer();
    const toAct = server.roomState().table?.toAct ?? -1;
    const actor = server.roomState().players.find((p) => p.seatId === toAct)!;
    const out = server.message(actor.playerId, { type: 'action', action: { kind: 'fold' } });
    expect(new Set(out.map((o) => o.to))).toEqual(new Set(['a', 'b']));
    expect(server.roomState().table).not.toBeNull();
  });

  it('a fold heads-up settles the hand and the result stays visible until the next deal', () => {
    const server = twoPlayerServer();
    const firstHand = server.roomState().table?.handNumber ?? 0;
    const toAct = server.roomState().table?.toAct ?? -1;
    const actor = server.roomState().players.find((p) => p.seatId === toAct)!;
    server.message(actor.playerId, { type: 'action', action: { kind: 'fold' } });

    // The hand ended, so it is SETTLED now (winners populated) — not silently rolled into the next.
    expect(server.roomState().table?.winners, 'a folded-out hand must be settled').not.toBeNull();
    expect(server.roomState().table?.handNumber, 'no new hand dealt yet').toBe(firstHand);
  });

  it('dealNext deals a fresh hand once the previous one is settled, and is a no-op while live', () => {
    const server = twoPlayerServer();
    const firstHand = server.roomState().table?.handNumber ?? 0;

    // While the first hand is live, dealNext must NOT deal over it.
    server.dealNext();
    expect(server.roomState().table?.handNumber).toBe(firstHand);

    // End the hand by folding, then dealNext should advance to a fresh, live hand.
    const toAct = server.roomState().table?.toAct ?? -1;
    const actor = server.roomState().players.find((p) => p.seatId === toAct)!;
    server.message(actor.playerId, { type: 'action', action: { kind: 'fold' } });
    const out = server.dealNext();
    expect(server.roomState().table?.handNumber, 'the next hand should be dealt').toBeGreaterThan(
      firstHand,
    );
    expect(server.roomState().table?.winners, 'the fresh hand is live, not settled').toBeNull();
    expect(new Set(out.map((o) => o.to))).toEqual(new Set(['a', 'b']));
  });
});
