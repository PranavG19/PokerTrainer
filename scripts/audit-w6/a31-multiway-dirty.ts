// Can a MULTIWAY showdown ever arrive with dirty betting state? Sweep hard: many stack shapes, many
// seeds, aggressive+allin behaviour. If the answer is genuinely never, the showdown exit's clear is
// unreachable and the honest thing is to say so, not to fake a test for it.
import { createTable, startHand, applyAction, legalActions, minRaiseTo, type TableState } from '../../src/core/table.js';
import { mulberry32 } from '../../src/core/rng.js';

const SHAPES: number[][] = [
  [5000,300,1200,90],[100,5000,80,3000],[500,500,60,5000],[90,90,5000,5000],
  [200,150,120,5000],[5000,5000,5000,40],[75,180,260,340],[1000,60,1000,60],
];
let checked=0, dirtyMultiway=0;
const found: string[] = [];
for (const [si, stacks] of SHAPES.entries()) {
  for (let seed=1; seed<=800; seed++) {
    let s = startHand(createTable({ seats: stacks.map((stack,i)=>({name:`P${i}`,stack,isHero:i===0})), sb:25, bb:50, seed }));
    const rng = mulberry32(seed ^ (0x999*(si+1)));
    let g=0;
    while (s.street!=='showdown' && s.seats.filter(x=>!x.folded).length>1 && g++<300) {
      const legal = legalActions(s); if (!legal.length) break;
      const r = rng();
      const a = r<0.45 && legal.includes('allin') ? {kind:'allin' as const}
        : r<0.7 && legal.includes('raise') ? {kind:'raise' as const, amount:minRaiseTo(s)}
        : legal.includes('call') ? {kind:'call' as const}
        : legal.includes('check') ? {kind:'check' as const} : {kind:'fold' as const};
      if (!legal.includes(a.kind)) break;
      s = applyAction(s, a);
    }
    const unfolded = s.seats.filter(x=>!x.folded).length;
    if (unfolded < 2) continue;   // fold-out exit, not what we want
    checked++;
    if (s.currentBet !== 0 || s.seats.some(x=>x.committed!==0)) {
      dirtyMultiway++;
      if (found.length<5) found.push(`shape ${si} ${JSON.stringify(stacks)} seed ${seed}: street=${s.street} unfolded=${unfolded} currentBet=${s.currentBet} committed=[${s.seats.map(x=>x.committed)}]`);
    }
  }
}
console.log(`multiway hands examined: ${checked}`);
console.log(`  arriving with dirty betting state: ${dirtyMultiway}`);
for (const f of found) console.log('  ' + f);
