// Which settle() exit does the seed-34 hand take? A hand at street 'showdown' can STILL be a fold-out
// if only one seat is unfolded — and the fold-out branch returns before the showdown code runs.
import { createTable, startHand, applyAction, legalActions, minRaiseTo, type TableState } from '../../src/core/table.js';
import { mulberry32 } from '../../src/core/rng.js';

const uneven = (seed: number): TableState =>
  startHand(createTable({ seats: [5000,300,1200,90].map((stack,i)=>({name:`P${i}`,stack,isHero:i===0})), sb:25, bb:50, seed }));

let dirtyAndMultiway = 0, dirtyButFoldOut = 0;
const good: string[] = [];
for (let seed = 1; seed <= 600; seed++) {
  let s = uneven(seed);
  const rng = mulberry32(seed ^ 0x1234);
  let g = 0;
  while (s.street !== 'showdown' && s.seats.filter(x=>!x.folded).length > 1 && g++ < 300) {
    const legal = legalActions(s);
    if (!legal.length) break;
    const r = rng();
    const a = r < 0.35 && legal.includes('raise') ? { kind:'raise' as const, amount: minRaiseTo(s) }
      : r < 0.5 && legal.includes('allin') ? { kind:'allin' as const }
      : legal.includes('call') ? { kind:'call' as const }
      : legal.includes('check') ? { kind:'check' as const } : { kind:'fold' as const };
    if (!legal.includes(a.kind)) break;
    s = applyAction(s, a);
  }
  const dirty = s.currentBet !== 0 || s.seats.some(x=>x.committed!==0);
  const unfolded = s.seats.filter(x=>!x.folded).length;
  if (!dirty) continue;
  if (unfolded > 1) { dirtyAndMultiway++; if (good.length<6) good.push(`seed ${seed}: street=${s.street} unfolded=${unfolded} currentBet=${s.currentBet} committed=[${s.seats.map(x=>x.committed)}]`); }
  else dirtyButFoldOut++;
}
console.log(`dirty AND multiway (takes the SHOWDOWN exit): ${dirtyAndMultiway}`);
console.log(`dirty but only one unfolded (takes the FOLD-OUT exit): ${dirtyButFoldOut}`);
for (const g of good) console.log('  ' + g);
