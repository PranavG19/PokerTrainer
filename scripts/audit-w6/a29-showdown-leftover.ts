// Why did "showdown exit does not clear" survive? A showdown is reached only when the betting round
// CLOSED, and advanceStreet zeroes committed on the way in — so at showdown everything is already 0
// unless someone is all-in for less. Measure: which showdown hands actually have dirty state?
import { createTable, startHand, applyAction, legalActions, minRaiseTo, settle, type TableState } from '../../src/core/table.js';
import { mulberry32 } from '../../src/core/rng.js';

const mk = (seed: number, stacks: number[]): TableState =>
  startHand(createTable({ seats: stacks.map((stack, i) => ({ name: `P${i}`, stack, isHero: i === 0 })), sb: 25, bb: 50, seed }));

let showdowns = 0, dirtyAtShowdown = 0, dirtyAfterSettle = 0;
const examples: string[] = [];
for (let seed = 1; seed <= 400; seed++) {
  // Uneven stacks so short all-ins happen: that is what leaves committed set at showdown.
  let s = mk(seed, [5000, 300, 1200, 90]);
  const rng = mulberry32(seed ^ 0x1234);
  let guard = 0;
  while (s.street !== 'showdown' && s.seats.filter(x => !x.folded).length > 1 && guard++ < 300) {
    const legal = legalActions(s);
    if (!legal.length) break;
    const r = rng();
    const a = r < 0.35 && legal.includes('raise') ? { kind: 'raise' as const, amount: minRaiseTo(s) }
      : r < 0.5 && legal.includes('allin') ? { kind: 'allin' as const }
      : legal.includes('call') ? { kind: 'call' as const }
      : legal.includes('check') ? { kind: 'check' as const } : { kind: 'fold' as const };
    if (!legal.includes(a.kind)) break;
    s = applyAction(s, a);
  }
  if (s.street !== 'showdown') continue;
  showdowns++;
  const dirty = s.currentBet !== 0 || s.seats.some(x => x.committed !== 0);
  if (dirty) {
    dirtyAtShowdown++;
    if (examples.length < 4) examples.push(`seed ${seed}: currentBet=${s.currentBet} committed=[${s.seats.map(x=>x.committed).join(',')}]`);
  }
  // NOTE: settle here is the CURRENT (fixed) code, so this only tells us the precondition.
  const settled = settle(s);
  if (settled.currentBet !== 0 || settled.seats.some(x => x.committed !== 0)) dirtyAfterSettle++;
}
console.log(`showdowns reached: ${showdowns}`);
console.log(`  with dirty betting state AT showdown (i.e. settle has something to clear): ${dirtyAtShowdown}`);
console.log(`  still dirty AFTER settle (should be 0 with the fix): ${dirtyAfterSettle}`);
for (const e of examples) console.log(`    ${e}`);
