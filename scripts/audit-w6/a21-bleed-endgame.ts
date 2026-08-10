// Where does the 25-per-hand bleed end, and is the worse "whole stack vanishes" case reachable?
import { settle, startHand, startStacksOf, type TableState } from './lib.js';
import { createTable } from '../../src/core/table.js';

const total = (s: TableState): number => s.seats.reduce((n, x) => n + x.stack, 0) + s.pot;

console.log('=== bleed a lone funded hero from 20000 (the whole 4x5000 table) ===');
{
  let t = createTable({
    seats: ['You', 'Ada', 'Bo', 'Cy'].map((name, i) => ({ name, stack: i === 0 ? 20000 : 0, isHero: i === 0 })),
    sb: 25, bb: 50, seed: 7,
  });
  let hands = 0;
  const marks: string[] = [];
  while (t.seats[0].stack > 0 && hands < 2000) {
    const before = t.seats[0].stack;
    t = settle(startHand(t));
    hands++;
    const after = t.seats[0].stack;
    if (after <= 120 || hands <= 2) marks.push(`  hand ${String(hands).padStart(4)}: ${before} -> ${after} (lost ${before - after})`);
  }
  for (const m of marks) console.log(m);
  console.log(`  hero reaches stack ${t.seats[0].stack} after ${hands} hands. 20000 chips destroyed, no hand lost.`);
  console.log(`  at stack 0 the renderer finally offers a Rebuy / New session, so the app escapes —`);
  console.log(`  after ${hands} silent "Next hand" clicks that each burned the small blind.`);
}

console.log('\n=== the worse sub-case: a lone funded seat with stack <= SB loses EVERYTHING in one hand ===');
{
  for (const stack of [5, 10, 20, 25]) {
    const t = createTable({ seats: [{ name: 'A', stack, isHero: true }, { name: 'B', stack: 0 }], sb: 25, bb: 50, seed: 7 });
    const s = startHand(t);
    console.log(`\n  stack ${stack}: ${s.log.join(' | ')}`);
    console.log(`    seat0 stack=${s.seats[0].stack} committed=${s.seats[0].committed} allIn=${s.seats[0].allIn} pot=${s.pot}`);
    console.log(`    _startStacks=${JSON.stringify(startStacksOf(s))}  <- recorded as stack+committed = ${s.seats[0].stack}+${s.seats[0].committed}`);
    const d = settle(s);
    console.log(`    settle log: ${d.log.slice(2).join(' | ') || '(nothing)'}`);
    console.log(`    winners=${JSON.stringify(d.winners)}`);
    console.log(`    CHIPS ${total(d)} of ${stack}  ->  ${stack - total(d)} DESTROYED (the ENTIRE stack)`);
  }
  console.log('\n  ROOT CAUSE: startHand posts the SB with `committed = sbAmount` then the BB with');
  console.log('  `committed = bbAmount` (src/core/table.ts:216 and :226 — plain assignment, not +=).');
  console.log('  When sbIdx === bbIdx the SB is erased from committed. _startStacks is then computed as');
  console.log('  stack + committed (:242), so it under-records the seat by the SB, and buildSidePots');
  console.log('  derives contributions = startStacks - stack, which comes out short by the same amount.');
  console.log('  settle therefore never pays that money to anyone and zeroes the pot.');
}

console.log('\n=== does the fuzz in a1/a18 miss this? ===');
console.log('  YES, by construction: both loops guard with `if (funded < 2) break;` — the same guard a');
console.log('  reasonable person writes, because one player is not a hand. The app has no such guard, so');
console.log('  it deals the hand anyway. That gap is why 758 green tests never saw 25 chips vanish.');
