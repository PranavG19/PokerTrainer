import { describe, expect, it } from 'vitest';
import { RelayServer, type Outbound } from '../../src/core/relayServer.js';
import { createTable, startHand } from '../../src/core/table.js';
import type { CreateRoomOpts, RoomView } from '../../src/core/multiplayer.js';

/**
 * DEAL SECRECY — a guest who sees only its own redacted wire view must not be able to predict any card
 * it has not been shown. Redaction (viewFor) is sound; the defect this pins is the DEAL: a hosted room
 * shuffled with `mulberry32(seed + handNumber)` from `seed ?? 1`, so a guest's private replica of the
 * engine recovered every opponent's hole and the future board (research/tech-poc seed-attack).
 *
 * The attacker below knows exactly what a real guest knows: the engine (it is open source), the table
 * shape and join order (public), the hand number and its own two cards (from its view). It searches the
 * whole low seed space (which contains the `?? 1` default) for a seed that reproduces its own hole, then
 * reads the opponents' holes and the board out of the replica.
 */

const SEATS = 3;
const SEARCH = 1 << 14; // covers the 1 default and every small seed a user might type

/** Host a three-seat room the way the app hosts one, with the guest 'g1' and a third player joining. */
function hostRoomAsTheAppDoes(): { server: RelayServer; guestView: RoomView } {
  // main.ts hosts with `seed: seed ?? 1` and no --seed flag in a shipped app.
  const opts = { roomId: 'local', seatCount: SEATS, sb: 25, bb: 50, startStack: 5000, seed: 1 } as CreateRoomOpts;
  const server = new RelayServer(opts);
  const sent: Outbound[] = [];
  sent.push(...server.connect('local', 'Host'));
  sent.push(...server.connect('g1', 'Guest'));
  sent.push(...server.connect('g2', 'Other'));
  const last = sent.filter((o) => o.to === 'g1' && o.message.type === 'state').pop();
  if (last === undefined || last.message.type !== 'state') throw new Error('guest got no view');
  return { server, guestView: last.message.view };
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
    const { server, guestView } = hostRoomAsTheAppDoes();
    const truth = server.roomState().table!;
    const guess = attack(guestView);
    const opponents = truth.seats.filter((s) => s.id !== guestView.seats.find((v) => v.isYou)!.id);
    const recoveredHoles =
      guess !== null && opponents.every((s) => guess.holes[s.id].join(' ') === s.hole.join(' '));
    expect(recoveredHoles, 'the guest predicted every opponent hole from its own view').toBe(false);

    // Play the hand to the river by checking/calling so the real board is dealt, then compare.
    let room = server;
    for (let i = 0; i < 40 && room.roomState().table!.winners === null; i += 1) {
      const t = room.roomState().table!;
      const actor = room.roomState().players.find((p) => p.seatId === t.toAct)!;
      const kind = t.currentBet > t.seats[t.toAct].committed ? 'call' : 'check';
      room.message(actor.playerId, { type: 'action', action: { kind } });
    }
    const realBoard = room.roomState().table!.board.join(' ');
    expect(guess !== null && guess.board.join(' ') === realBoard, 'the guest predicted the board').toBe(false);
  });

  it('nothing a guest receives carries a seed or a deck', () => {
    const { guestView } = hostRoomAsTheAppDoes();
    const wire = JSON.stringify(guestView);
    expect(wire).not.toContain('"seed"');
    expect(wire).not.toContain('"deck"');
  });
});
