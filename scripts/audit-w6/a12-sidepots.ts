// Invariant 6, exhaustively: build every reachable contribution profile and check buildSidePots
// distributes exactly, capped per contributor.
import { settle, startStacksOf, type TableState } from './lib.js';
import { createTable, startHand } from '../../src/core/table.js';

/**
 * Construct a settled-shape state directly: contributions and fold flags chosen, board fixed.
 * This reaches profiles the betting rules can't easily produce and isolates buildSidePots.
 */
function synth(contribs: number[], folded: boolean[], seed: number): TableState {
  const start = contribs.map((c) => c + 1000);
  const t = createTable({ seats: start.map((s, i) => ({ name: `S${i}`, stack: s })), sb: 1, bb: 2, seed });
  const s = startHand(t);
  // Overwrite the blind posting entirely with the profile under test.
  for (let i = 0; i < contribs.length; i++) {
    s.seats[i].stack = start[i] - contribs[i];
    s.seats[i].committed = 0;
    s.seats[i].folded = folded[i];
    s.seats[i].allIn = s.seats[i].stack === 0;
  }
  s.pot = contribs.reduce((a, b) => a + b, 0);
  s.street = 'river';
  s.board = s.board.length === 5 ? s.board : ['2c', '7d', '9h', 'Js', '4s'];
  (s as unknown as { _startStacks: number[] })._startStacks = start;
  return s;
}

function cap(pre: TableState, id: number): number {
  const start = startStacksOf(pre);
  const paid = pre.seats.map((x, i) => start[i] - x.stack);
  const mine = paid[id];
  let total = mine;
  for (let i = 0; i < paid.length; i++) if (i !== id) total += Math.min(mine, paid[i]);
  return total;
}

let checked = 0;
const problems: string[] = [];

const LEVELS = [0, 100, 250, 600, 1000];
for (const a of LEVELS) for (const b of LEVELS) for (const c of LEVELS) for (const d of LEVELS) {
  const contribs = [a, b, c, d];
  if (contribs.every((x) => x === 0)) continue;
  for (let mask = 0; mask < 16; mask++) {
    const folded = [0, 1, 2, 3].map((i) => ((mask >> i) & 1) === 1 || contribs[i] === 0);
    if (folded.every((f) => f)) continue; // nobody left to win — settle has no defined answer
    const pre = synth(contribs, folded, 7 + mask);
    const done = settle(pre);
    checked++;
    const total = contribs.reduce((x, y) => x + y, 0);
    const awarded = new Map<number, number>();
    for (const w of done.winners ?? []) awarded.set(w.seatId, (awarded.get(w.seatId) ?? 0) + w.amount);
    const sum = [...awarded.values()].reduce((x, y) => x + y, 0);
    const tag = `contribs=${JSON.stringify(contribs)} folded=${JSON.stringify(folded)}`;
    // settle() now returns uncontested chips to their contributor ("takes back N uncalled"), so the
    // conservation ledger is winners + refunds, not winners alone.
    const refunded = pre.seats.reduce((n, seat, i) => n + (done.seats[i].stack - seat.stack) - (awarded.get(i) ?? 0), 0);
    if (sum + refunded !== total) {
      problems.push(`AWARD-SUM ${tag}: awarded ${sum} + refunded ${refunded} != ${total}  winners=${JSON.stringify(done.winners)} log=${done.log.join(' | ')}`);
    }
    for (const [id, amt] of awarded) {
      if (contribs[id] === 0) problems.push(`PAID-NOTHING ${tag}: seat${id} got ${amt} having contributed 0`);
      if (folded[id]) problems.push(`FOLDED-WINNER ${tag}: seat${id} folded but got ${amt}`);
      if (amt > cap(pre, id)) problems.push(`OVER-CAP ${tag}: seat${id} got ${amt} > cap ${cap(pre, id)}`);
    }
    if (done.pot !== 0) problems.push(`POT-LEFT ${tag}: pot=${done.pot}`);
  }
}

console.log(`=== buildSidePots exhaustive: ${checked} profiles ===`);
const byKind = new Map<string, string[]>();
for (const p of problems) {
  const kind = p.split(' ')[0];
  if (!byKind.has(kind)) byKind.set(kind, []);
  byKind.get(kind)!.push(p);
}
if (problems.length === 0) console.log('  CLEAN — every profile distributed exactly, per-seat capped, no folded winner.');
for (const [kind, list] of byKind) {
  console.log(`\n  ${kind}: ${list.length}`);
  for (const p of list.slice(0, 3)) console.log(`    ${p}`);
}
