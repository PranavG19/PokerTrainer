import { describe, expect, it } from 'vitest';
import { RelayServer, type Outbound } from '../../src/core/relayServer.js';
import { ROOM, Table, testCrypto } from './relayHarness.js';

/**
 * RELAY SERVER — the orchestration between connection events and the pure room.
 *
 * These tests use no socket: connect/disconnect/message are plain calls returning the list of redacted
 * broadcasts a transport would send, routed through real GuestProtocols by the Table harness so the
 * deal handshake completes. The security property proven in multiplayer.test.ts (no opponent hole
 * leaks) is re-checked HERE at the broadcast boundary, because this is the layer a real transport
 * actually calls — a regression that leaked through a broadcast would show up here.
 */

/** The state view delivered to one player in an outbound batch, or null if none was sent to them. */
function viewIn(out: Outbound[], playerId: string) {
  const hit = [...out].reverse().find((o) => o.to === playerId && o.message.type === 'state');
  return hit && hit.message.type === 'state' ? hit.message.view : null;
}

/** A table with two connected guests, which deals the first hand once both answer the handshake. */
function twoPlayerTable(): Table {
  const table = new Table();
  table.join('a', 'Alice');
  table.join('b', 'Bob');
  return table;
}

describe('connection lifecycle', () => {
  it('broadcasts to every connected player on each join', () => {
    const server = new RelayServer(ROOM, { crypto: testCrypto });
    const first = server.connect('a', 'Alice');
    expect(first.map((o) => o.to)).toEqual(['a']);

    const second = server.connect('b', 'Bob');
    // Both players now hear the updated state (and the new deal's commitment).
    expect(new Set(second.map((o) => o.to))).toEqual(new Set(['a', 'b']));
  });

  it('a second join starts the deal handshake; the hand is dealt once both guests answer', () => {
    const server = new RelayServer(ROOM, { crypto: testCrypto });
    server.connect('a', 'Alice');
    expect(server.dealPending(), 'one player should not start a deal').toBe(false);
    const out = server.connect('b', 'Bob');
    expect(out.filter((o) => o.message.type === 'commit').map((o) => o.to).sort()).toEqual(['a', 'b']);
    expect(server.roomState().table, 'no cards before the guests commit and reveal').toBeNull();

    const table = twoPlayerTable();
    expect(table.server.roomState().table, 'two answering guests get a hand').not.toBeNull();
  });

  it('a rejected join (duplicate) errors only the sender and changes nothing', () => {
    const table = twoPlayerTable();
    const out = table.server.connect('a', 'Alice again');
    expect(out).toEqual([{ to: 'a', message: { type: 'error', reason: 'already joined' } }]);
    expect(table.server.roomState().players).toHaveLength(2);
  });

  it('disconnect frees the seat and broadcasts to the remainder', () => {
    const table = twoPlayerTable();
    const out = table.server.disconnect('a');
    expect(table.server.roomState().players.map((p) => p.playerId)).toEqual(['b']);
    // Only the still-connected player hears the update.
    expect(out.map((o) => o.to)).toEqual(['b']);
  });
});

describe('redaction carries through the broadcast boundary', () => {
  it('each player’s broadcast shows their own hole and never an opponent’s', () => {
    const table = twoPlayerTable();
    const out = table.server.dealNext(); // a live hand: a plain re-broadcast
    const aView = viewIn(out, 'a');
    expect(aView).not.toBeNull();
    const aOwn = aView!.seats.find((s) => s.isYou);
    expect(aOwn?.hole, 'a player must see their own cards').toHaveLength(2);
    for (const seat of aView!.seats) {
      if (!seat.isYou) expect(seat.hole, 'an opponent hole leaked in a broadcast').toBeNull();
    }
  });

  it('no message anywhere contains the deck or a seed', () => {
    const table = twoPlayerTable();
    table.playOut();
    const wire = JSON.stringify([...table.wire.values()]);
    expect(wire).not.toContain('"deck"');
    expect(wire).not.toContain('"seed"');
  });

  it('a state message opens exactly the cards its view shows: own two holes preflop, nothing else', () => {
    const table = twoPlayerTable();
    const last = [...table.wire.get('a')!].reverse().find((m) => m.type === 'state');
    expect(last?.type === 'state' && last.openings.map((o) => o.card).sort()).toEqual(
      [...table.view('a').seats.find((s) => s.isYou)!.hole!].sort(),
    );
  });
});

describe('actions through the server', () => {
  it('an out-of-turn action errors only the sender and leaves state unchanged', () => {
    const { server } = twoPlayerTable();
    const toAct = server.roomState().table?.toAct ?? -1;
    const offTurn = server.roomState().players.find((p) => p.seatId !== toAct)!;
    const before = JSON.stringify(server.roomState().table);
    const out = server.message(offTurn.playerId, { type: 'action', action: { kind: 'fold' } });
    expect(out).toEqual([{ to: offTurn.playerId, message: { type: 'error', reason: 'not your turn' } }]);
    expect(JSON.stringify(server.roomState().table)).toBe(before);
  });

  it('a legal action from the right player applies and re-broadcasts to all', () => {
    const { server } = twoPlayerTable();
    const toAct = server.roomState().table?.toAct ?? -1;
    const actor = server.roomState().players.find((p) => p.seatId === toAct)!;
    const out = server.message(actor.playerId, { type: 'action', action: { kind: 'fold' } });
    expect(new Set(out.map((o) => o.to))).toEqual(new Set(['a', 'b']));
    expect(server.roomState().table).not.toBeNull();
  });

  it('a fold heads-up settles the hand and the result stays visible until the next deal', () => {
    const { server } = twoPlayerTable();
    const firstHand = server.roomState().table?.handNumber ?? 0;
    const toAct = server.roomState().table?.toAct ?? -1;
    const actor = server.roomState().players.find((p) => p.seatId === toAct)!;
    server.message(actor.playerId, { type: 'action', action: { kind: 'fold' } });

    // The hand ended, so it is SETTLED now (winners populated) — not silently rolled into the next.
    expect(server.roomState().table?.winners, 'a folded-out hand must be settled').not.toBeNull();
    expect(server.roomState().table?.handNumber, 'no new hand dealt yet').toBe(firstHand);
  });

  it('dealNext deals a fresh hand once the previous one is settled, and is a no-op while live', () => {
    const table = twoPlayerTable();
    const { server } = table;
    const firstHand = server.roomState().table?.handNumber ?? 0;

    // While the first hand is live, dealNext must NOT deal over it.
    table.route(server.dealNext());
    expect(server.roomState().table?.handNumber).toBe(firstHand);
    expect(server.dealPending()).toBe(false);

    // End the hand by folding, then a deal request should advance to a fresh, live hand.
    const toAct = server.roomState().table?.toAct ?? -1;
    const actor = server.roomState().players.find((p) => p.seatId === toAct)!;
    table.send(actor.playerId, { type: 'action', action: { kind: 'fold' } });
    table.send('a', { type: 'deal' });
    expect(server.roomState().table?.handNumber, 'the next hand should be dealt').toBeGreaterThan(firstHand);
    expect(server.roomState().table?.winners, 'the fresh hand is live, not settled').toBeNull();
    expect(table.eventsOf('a', 'violation')).toEqual([]);
    expect(table.eventsOf('b', 'violation')).toEqual([]);
  });
});
