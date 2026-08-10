// INVARIANT 1 BROKEN. When one seat posts BOTH blinds, startHand assigns seat.committed with `=`
// twice instead of accumulating, so the small blind disappears from the ledger. 25 chips are
// DESTROYED per hand — the one defect chip conservation was supposed to catch, and it hides in the
// exact configuration my earlier fuzz skipped (fewer than two funded seats).
import { settle, startHand, chipsOnTable, startStacksOf, type TableState } from './lib.js';
import { createTable } from '../../src/core/table.js';

const total = (s: TableState): number => s.seats.reduce((n, x) => n + x.stack, 0) + s.pot;

console.log('=== MINIMAL REPRO ===');
console.log("  createTable({ seats: [{You,12000},{Ada,0},{Bo,0},{Cy,0}], sb: 25, bb: 50, seed: 7 })");
console.log('  startHand()  — no actions at all.\n');

const t = createTable({
  seats: ['You', 'Ada', 'Bo', 'Cy'].map((name, i) => ({ name, stack: i === 0 ? 12000 : 0, isHero: i === 0 })),
  sb: 25,
  bb: 50,
  seed: 7,
});
console.log(`  before startHand: chips = ${total(t)}`);

const s = startHand(t);
console.log(`  log = ${s.log.join(' | ')}`);
console.log(`  seat0.stack     = ${s.seats[0].stack}   (12000 - 25 - 50 = 11925, both blinds really left the stack)`);
console.log(`  seat0.committed = ${s.seats[0].committed}      <<< should be 75; the SB was OVERWRITTEN by the BB`);
console.log(`  pot             = ${s.pot}      (correct: 25 + 50)`);
console.log(`  chips on table  = ${total(s)}   (stacks ${s.seats.reduce((n, x) => n + x.stack, 0)} + pot ${s.pot}) — still 12000 here`);
console.log(`  _startStacks    = ${JSON.stringify(startStacksOf(s))}`);
console.log(`                     seat0 recorded as ${startStacksOf(s)[0]}, not 12000: startHand computes`);
console.log(`                     stack + committed = 11925 + 50 = 11975, losing the 25.`);

const done = settle(s);
console.log(`\n  after settle: log = ${done.log.join(' | ')}`);
console.log(`  seat0.stack = ${done.seats[0].stack}`);
console.log(`  CHIPS = ${total(done)}, started at 12000  ->  ${12000 - total(done)} CHIPS DESTROYED`);

console.log('\n=== it compounds every hand ===');
{
  let cur = createTable({
    seats: ['You', 'Ada', 'Bo', 'Cy'].map((name, i) => ({ name, stack: i === 0 ? 12000 : 0, isHero: i === 0 })),
    sb: 25, bb: 50, seed: 7,
  });
  console.log(`  hand 0 (fresh table): chips ${total(cur)}`);
  for (let i = 1; i <= 10; i++) {
    cur = settle(startHand(cur));
    console.log(`  hand ${String(i).padStart(2)}: chips ${total(cur)}  (lost ${12000 - total(cur)} cumulative)`);
  }
  console.log(`  >>> exactly the small blind, 25, vanishes every hand. At 450 hands the hero's whole`);
  console.log(`      11250 is gone with no losing hand ever played.`);
}

console.log('\n=== the same bug in the HEADS-UP branch? (dealer posts SB, next funded posts BB) ===');
{
  // isHeadsUp requires exactly 2 funded seats, so sbIdx != bbIdx there. Confirm.
  const hu = createTable({ seats: [{ name: 'A', stack: 1000 }, { name: 'B', stack: 1000 }], sb: 25, bb: 50, seed: 7 });
  const h = startHand(hu);
  console.log(`  2 funded: ${h.log.join(' | ')} committed=${JSON.stringify(h.seats.map((x) => x.committed))} chips=${total(h)} of 2000  ${total(h) === 2000 ? 'OK' : 'BROKEN'}`);
  // 3-funded and 4-funded sanity.
  for (const n of [3, 4, 6]) {
    const many = createTable({ seats: Array.from({ length: n }, (_, i) => ({ name: `S${i}`, stack: 1000 })), sb: 25, bb: 50, seed: 7 });
    const m = startHand(many);
    console.log(`  ${n} funded: ${m.log.join(' | ')} chips=${total(m)} of ${n * 1000}  ${total(m) === n * 1000 ? 'OK' : 'BROKEN'}`);
  }
  console.log('  >>> only the ONE-funded-seat case breaks, because nextFunded returns `from` when nobody');
  console.log('      else has chips, making sbIdx === bbIdx === dealer.');
}

console.log('\n=== ONE funded seat with a stack SHORTER than SB+BB ===');
{
  for (const stack of [20, 30, 60, 75, 80]) {
    const one = createTable({ seats: [{ name: 'A', stack }, { name: 'B', stack: 0 }], sb: 25, bb: 50, seed: 7 });
    const s2 = startHand(one);
    const d2 = settle(s2);
    console.log(`  stack ${String(stack).padStart(3)}: ${s2.log.join(' | ')} | committed=${s2.seats[0].committed} allIn=${s2.seats[0].allIn} -> chips ${total(d2)} of ${stack} (lost ${stack - total(d2)})`);
  }
}

console.log('\n=== is it reachable in the shipping app? ===');
console.log('  YES. Verified in a19-lone-seat.ts: 59 of 60 seeds reach a one-funded-seat table when');
console.log('  the hero busts the villains. The renderer offers a rebuy only to the HERO');
console.log('  (renderer/screens/table.ts, the `heroSeat().stack === 0` branch), so busted villains');
console.log('  never top up, and a winning hero is never offered "New session". Pressing "Next hand"');
console.log('  from there burns 25 chips a click, silently, forever.');
