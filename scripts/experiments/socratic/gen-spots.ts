/**
 * Produces graded mistakes from the REAL engine (src/core/coach.ts) and writes them to
 * spots.json. Nothing here invents a number: every quantity in the payload is what
 * gradeDecision() computed. Run with vite-node from the repo root.
 */
import { gradeDecision, potOddsRequired } from '../../../src/core/coach.js';
import { DISPLAY_ITERATIONS, equityVsRandom } from '../../../src/core/equity.js';
import { writeFileSync } from 'node:fs';

interface Candidate {
  id: string;
  hole: string[];
  board: string[];
  street: 'preflop' | 'flop' | 'turn' | 'river';
  pot: number;
  toCall: number;
  stack: number;
  chosen: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';
  opponents: number;
  /** The concept the engine's principle maps to, used only for reporting. */
  errorTag: string;
}

const BB = 2;

const CANDIDATES: Candidate[] = [
  // Calling too wide for the price — PRICE tag.
  { id: 'c1', hole: ['7h', '2c'], board: ['Kd', '9s', '4h'], street: 'flop', pot: 20, toCall: 14, stack: 180, chosen: 'call', opponents: 1, errorTag: 'PRICE' },
  { id: 'c2', hole: ['8d', '3c'], board: ['Ah', 'Kd', 'Qs'], street: 'flop', pot: 30, toCall: 24, stack: 150, chosen: 'call', opponents: 1, errorTag: 'PRICE' },
  { id: 'c3', hole: ['5h', '4d'], board: ['As', 'Kc', '9h', '2d'], street: 'turn', pot: 40, toCall: 34, stack: 120, chosen: 'call', opponents: 1, errorTag: 'PRICE' },
  { id: 'c4', hole: ['Jc', '6s'], board: ['Ad', 'Qh', '8c', '3s', '2h'], street: 'river', pot: 50, toCall: 45, stack: 100, chosen: 'call', opponents: 1, errorTag: 'PRICE' },
  { id: 'c5', hole: ['9c', '4s'], board: ['Ks', 'Qd', 'Jh'], street: 'flop', pot: 24, toCall: 20, stack: 160, chosen: 'call', opponents: 2, errorTag: 'PRICE' },
  // Folding when the price was right — PRICE tag, the other sign.
  { id: 'f1', hole: ['Ah', 'Kh'], board: ['Qh', '7h', '2c'], street: 'flop', pot: 40, toCall: 6, stack: 150, chosen: 'fold', opponents: 1, errorTag: 'PRICE' },
  { id: 'f2', hole: ['Td', 'Ts'], board: ['9c', '4h', '2s'], street: 'flop', pot: 30, toCall: 5, stack: 140, chosen: 'fold', opponents: 1, errorTag: 'PRICE' },
  { id: 'f3', hole: ['Jh', 'Th'], board: ['9h', '8c', '2d'], street: 'flop', pot: 36, toCall: 8, stack: 130, chosen: 'fold', opponents: 1, errorTag: 'PRICE' },
  { id: 'f4', hole: ['Ac', 'Qd'], board: ['Qs', '8h', '3c', '5d'], street: 'turn', pot: 44, toCall: 8, stack: 120, chosen: 'fold', opponents: 1, errorTag: 'PRICE' },
  // Betting/raising with no equity against action — RANGE tag.
  { id: 'b1', hole: ['6c', '3d'], board: ['Ah', 'Kd', 'Qs'], street: 'flop', pot: 30, toCall: 20, stack: 150, chosen: 'raise', opponents: 1, errorTag: 'RANGE' },
  { id: 'b2', hole: ['7s', '2h'], board: ['Ks', 'Kh', '9d', '4c'], street: 'turn', pot: 40, toCall: 30, stack: 140, chosen: 'raise', opponents: 1, errorTag: 'RANGE' },
  { id: 'b3', hole: ['4d', '3h'], board: ['Ac', 'Jd', '8s', '7h', '2c'], street: 'river', pot: 60, toCall: 40, stack: 100, chosen: 'allin', opponents: 1, errorTag: 'RANGE' },
  // Checking back a strong hand on a late street — value tag.
  { id: 'v1', hole: ['Ac', 'Ah'], board: ['Ad', '9s', '4h', '2c'], street: 'turn', pot: 40, toCall: 0, stack: 150, chosen: 'check', opponents: 1, errorTag: 'SIZING' },
  { id: 'v2', hole: ['Ks', 'Kd'], board: ['Kh', '7c', '3s', '8d', '2h'], street: 'river', pot: 56, toCall: 0, stack: 140, chosen: 'check', opponents: 1, errorTag: 'SIZING' },
  { id: 'v3', hole: ['Qh', 'Qs'], board: ['Qd', 'Jc', '5h', '9s'], street: 'turn', pot: 48, toCall: 0, stack: 130, chosen: 'check', opponents: 1, errorTag: 'SIZING' },
];

const graded = CANDIDATES.map((c) => {
  const grade = gradeDecision({
    hole: c.hole,
    board: c.board,
    street: c.street,
    pot: c.pot,
    toCall: c.toCall,
    stack: c.stack,
    bb: BB,
    chosen: c.chosen,
    opponents: c.opponents,
    seed: 7,
  });
  const eq = equityVsRandom(c.hole, c.board, c.opponents, DISPLAY_ITERATIONS, 7);
  const potShare = eq.win + eq.tie * 0.5;
  return {
    ...c,
    bb: BB,
    potSharePct: Math.round(potShare * 100),
    requiredPct: Math.round(potOddsRequired(c.pot, c.toCall) * 100),
    evLossBb: Number(grade.evLossBb.toFixed(1)),
    severity: grade.severity,
    principle: grade.principle,
    engineMessage: grade.message,
  };
});

const usable = graded.filter((g) => g.severity !== 'free');
writeFileSync(
  new URL('./spots.json', import.meta.url),
  JSON.stringify({ bb: BB, generatedFrom: 'src/core/coach.ts gradeDecision, seed 7', spots: usable }, null, 2),
);
console.log(`graded ${graded.length}, non-free ${usable.length}`);
for (const g of usable) {
  console.log(`${g.id} ${g.severity.padEnd(8)} ΔEV=${g.evLossBb}bb share=${g.potSharePct}% req=${g.requiredPct}% tag=${g.errorTag}`);
}
