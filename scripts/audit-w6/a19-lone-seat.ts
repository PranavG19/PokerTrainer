// Is "one funded seat" reachable in the real app, and what happens then?
// The renderer offers a rebuy only to the HERO (table.ts: `if (heroSeat().stack === 0)`), so
// villains never top up. Play AI-vs-hero until every villain is busted.
import { applyAction, isHandOver, legalActions, settle, startHand, chipsOnTable, type TableState } from './lib.js';
import { createTable } from '../../src/core/table.js';
import { decideAction } from '../../src/core/ai.js';
import { mulberry32 } from '../../src/core/rng.js';

// Mirror renderer/screens/table.ts: 4 seats, hero at 0, 5000 each, 25/50.
function newTable(seed: number): TableState {
  return createTable({
    seats: ['You', 'Ada', 'Bo', 'Cy'].map((name, i) => ({ name, stack: 5000, isHero: i === 0 })),
    sb: 25,
    bb: 50,
    seed,
  });
}

console.log('=== drive hero-as-station (never folds) until villains bust ===');
let reached = 0;
const examples: string[] = [];
for (let seed = 1; seed <= 60; seed++) {
  let t = newTable(seed);
  const aiRng = mulberry32(seed);
  for (let hn = 0; hn < 4000; hn++) {
    const funded = t.seats.filter((x) => x.stack > 0).length;
    if (funded <= 1) {
      reached++;
      if (examples.length < 3) {
        examples.push(`seed=${seed}: reached ONE funded seat after ${hn} hands; stacks=${JSON.stringify(t.seats.map((x) => x.stack))}`);
      }
      break;
    }
    let s = startHand(t);
    if (s.seats[0].stack === 0) s.seats[0].stack = 5000; // hero rebuys, as the UI offers
    let steps = 0;
    while (!isHandOver(s) && steps++ < 400) {
      if (s.toAct === 0) {
        const l = legalActions(s);
        if (l.length === 0) break;
        // Hero shoves whenever it can, to force busts quickly.
        s = applyAction(s, { kind: l.includes('allin') ? 'allin' : l.includes('check') ? 'check' : l[0] });
      } else {
        s = applyAction(s, decideAction(s, s.toAct, aiRng));
      }
    }
    t = settle(s);
  }
}
console.log(`  ${reached} of 60 seeds reached a one-funded-seat table.`);
for (const e of examples) console.log(`    ${e}`);

console.log('\n=== what does a hand look like with exactly one funded seat? ===');
{
  let t = createTable({ seats: ['You', 'Ada', 'Bo', 'Cy'].map((name, i) => ({ name, stack: i === 0 ? 12000 : 0, isHero: i === 0 })), sb: 25, bb: 50, seed: 7 });
  for (let i = 0; i < 4; i++) {
    const s = startHand(t);
    const done = settle(s);
    console.log(`  hand ${i + 1}: ${s.log.join(' | ')}  ->  ${done.log.slice(2).join(' | ')}`);
    console.log(`    isHandOver at deal = ${isHandOver(s)}; hero stack ${s.seats[0].stack} -> ${done.seats[0].stack}; chips ${chipsOnTable(done)}`);
    t = done;
  }
  console.log('  >>> the hero posts BOTH blinds to itself, the hand is over before any action, and it');
  console.log('      wins its own 75 back. Net zero, chips conserved, but "Next hand" produces an');
  console.log('      unplayable hand forever: no villain has chips and none can rebuy. The only exit');
  console.log('      is "New session", which is offered ONLY when the HERO is at 0 (table.ts, the');
  console.log('      `heroSeat().stack === 0` branch), so a winning hero has no way out of the loop.');
}

console.log('\n=== does the hero see anything explaining it? ===');
{
  const t = createTable({ seats: ['You', 'Ada', 'Bo', 'Cy'].map((name, i) => ({ name, stack: i === 0 ? 12000 : 0, isHero: i === 0 })), sb: 25, bb: 50, seed: 7 });
  const s = startHand(t);
  const done = settle(s);
  console.log(`  winner-summary text would read: "${(done.winners ?? []).map((w) => `${done.seats[w.seatId].name} wins ${w.amount} (${w.description})`).join(' · ')}"`);
  console.log(`  hero stack ${done.seats[0].stack} != 0, so the session-over / New session branch is NOT rendered.`);
  console.log(`  the three villain seats render 'Out of chips' (seat.stack === 0 && hole.length === 0).`);
}
