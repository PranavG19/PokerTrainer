import { describe, expect, it } from 'vitest';
import { createTable, startHand } from '../../src/core/table.js';
import type { RoomView } from '../../src/core/multiplayer.js';
import { Table } from './relayHarness.js';

/**
 * DEAL SECRECY — a guest who sees only its own redacted wire view must not be able to predict any card
 * it has not been shown. Redaction (viewFor) is sound; the defect this pins is the DEAL: a hosted room
 * shuffled with `mulberry32(seed + handNumber)` from `seed ?? 1`, so a guest's private replica of the
 * engine recovered every opponent's hole and the future board (research/tech-poc seed-attack).
 *
 * The attacker below knows exactly what a real guest knows: the engine (it is open source), the table
 * shape and join order (public), the hand number and its own two cards (from its view). It searches the
 * whole low seed space (which contains the old `?? 1` default) for a seed that reproduces its own hole,
 * then reads the opponents' holes and the board out of the replica.
 */

const SEATS = 3;
const SEARCH = 1 << 14; // covers the old default of 1 and every small seed a user might type

/** Host a three-seat room the way the app hosts one: the host's own seat, the guest 'g1', then 'g2'. */
function hostRoomAsTheAppDoes(): { server: Table['server']; guestView: RoomView; table: Table } {
  const table = new Table({ roomId: 'local', seatCount: SEATS }, { dealerPlayerId: 'local' });
  table.join('local', 'Host', false);
  table.join('g1', 'Guest');
  table.join('g2', 'Other');
  return { server: table.server, guestView: table.view('g1'), table };
}

/** The attacker: replicate the engine from public knowledge and search for a seed matching its hole. */
function attack(view: RoomView): { holes: string[][]; board: string[] } | null {
  const me = view.seats.find((s) => s.isYou);
  if (!me || me.hole === null) return null;
  const mine = me.hole.join(' ');
  // Who was dealt in is public: a seat with chips in front of it or behind it.
  const seats = Array.from({ length: SEATS }, (_u, i) => {
    const seen = view.seats.find((s) => s.id === i);
    return { name: `s${i}`, stack: seen !== undefined && seen.stack + seen.committed > 0 ? 5000 : 0 };
  });
  for (let seed = 0; seed < SEARCH; seed += 1) {
    let table = createTable({ seats, sb: 25, bb: 50, seed });
    for (let n = 0; n < view.handNumber; n += 1) table = startHand(table);
    if (table.seats[me.id].hole.join(' ') !== mine) continue;
    // Board cards still in the deck, in the order the engine will burn-and-deal them.
    const d = table.deck;
    const board = [d[d.length - 2], d[d.length - 3], d[d.length - 4], d[d.length - 6], d[d.length - 8]];
    return { holes: table.seats.map((s) => [...s.hole]), board };
  }
  return null;
}

describe('a hosted room deals cards a guest cannot predict', () => {
  it('no seed replica built from a guest view recovers the opponents’ holes or the future board', () => {
    const { server, guestView, table: hosted } = hostRoomAsTheAppDoes();
    const truth = server.roomState().table!;
    const guess = attack(guestView);
    const opponents = truth.seats.filter((s) => s.id !== guestView.seats.find((v) => v.isYou)!.id);
    const recoveredHoles =
      guess !== null && opponents.every((s) => guess.holes[s.id].join(' ') === s.hole.join(' '));
    expect(recoveredHoles, 'the guest predicted every opponent hole from its own view').toBe(false);

    // Play the hand to the river by checking/calling so the real board is dealt, then compare.
    hosted.playOut();
    const realBoard = server.roomState().table!.board.join(' ');
    expect(guess !== null && guess.board.join(' ') === realBoard, 'the guest predicted the board').toBe(false);
  });

  it('nothing a guest receives carries a seed or a deck', () => {
    const { table } = hostRoomAsTheAppDoes();
    const wire = JSON.stringify(table.wire.get('g1'));
    expect(wire).not.toContain('"seed"');
    expect(wire).not.toContain('"deck"');
  });

  it('wire property: over many deals, nothing sent to a player before showdown names an unseen card', () => {
    for (let trial = 0; trial < 40; trial += 1) {
      // Four seats dealt in: a silent first guest holds the first deal open while everyone joins, then
      // leaves, so the deal restarts with the whole table.
      const table = new Table({ seatCount: 5 }, { dealerPlayerId: 'host' });
      table.join('host', 'Host', false);
      table.mute.add('z');
      table.join('z');
      for (const id of ['a', 'b', 'c']) table.join(id);
      table.route(table.server.disconnect('z'));
      expect(table.server.roomState().table!.seats.filter((s) => s.hole.length > 0)).toHaveLength(4);

      // Check every street up to the river: whatever has not been shown must not be on the wire.
      for (let street = 0; street < 4; street += 1) {
        const engine = table.server.roomState().table!;
        if (engine.street === 'showdown' || engine.winners !== null) break;
        for (const [id, messages] of table.wire) {
          const player = table.server.roomState().players.find((p) => p.playerId === id);
          if (player === undefined) continue; // z, who left before the deal
          const seat = player.seatId;
          const text = JSON.stringify(messages);
          const unseen = [...engine.seats.filter((s) => s.id !== seat).flatMap((s) => s.hole), ...engine.deck];
          for (const card of unseen) {
            expect(text, `${id} was sent ${card} on ${engine.street}`).not.toContain(`"${card}"`);
          }
        }
        // Advance one street.
        const from = engine.street;
        for (let i = 0; i < 20 && table.server.roomState().table!.street === from; i += 1) {
          const t = table.server.roomState().table!;
          if (t.winners !== null) break;
          const actor = table.server.roomState().players.find((p) => p.seatId === t.toAct)!;
          const kind = t.currentBet > t.seats[t.toAct].committed ? 'call' : 'check';
          table.send(actor.playerId, { type: 'action', action: { kind } });
        }
      }
      expect(table.eventsOf('b', 'violation')).toEqual([]);
    }
  });
});
