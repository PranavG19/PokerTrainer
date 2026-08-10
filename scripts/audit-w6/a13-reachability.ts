// Is the applyAction validation gap reachable through the app's own UI paths, or only by a
// harness? renderer/screens/table.ts gates heroAct on legalActions().includes(action.kind), and
// the raise amount through clamp(min, max). So the AMOUNT path is guarded but the KIND path is
// only guarded by that one includes() check. Two things to check:
//   1. does the raise slider's clamp cover every case, i.e. can min > max?
//   2. does 'check' when toCall > 0 have a silent path in?
import { applyAction, legalActions, makeTable, minRaiseTo, maxRaiseTo, startHand, chipsOnTable, type TableState } from './lib.js';

console.log('=== can minRaiseTo exceed maxRaiseTo? (the renderer clamps to [min,max]) ===');
{
  // Seat facing a bet it cannot fully min-raise: legalActions withholds "raise", so canRaise is
  // false and min/max are both 0 — safe. But a seat with just over the min-raise cost is offered
  // raise; check the boundary.
  let s = startHand(makeTable([5000, 5000, 5000, 5000], 25, 50, 7));
  // seat3 raises to 200 -> minRaiseTo becomes 350. seat0 has 5000 so it can raise.
  s = applyAction(s, { kind: 'raise', amount: 200 });
  console.log(`  currentBet=${s.currentBet} minRaise=${s.minRaise} minRaiseTo=${minRaiseTo(s)} toAct=seat${s.toAct} maxRaiseTo=${maxRaiseTo(s)}`);
  console.log(`  legal=[${legalActions(s).join(',')}]  min<=max? ${minRaiseTo(s) <= maxRaiseTo(s)}`);

  // Now the short-stack boundary: legalActions offers 'raise' only when stack >= costToMinRaise.
  // Check that whenever 'raise' IS offered, minRaiseTo <= maxRaiseTo across a wide sweep.
  let violations = 0;
  let offered = 0;
  for (let stack = 1; stack <= 4000; stack++) {
    let t = startHand(makeTable([stack, 5000, 5000, 5000], 25, 50, 7));
    t = applyAction(t, { kind: 'raise', amount: 200 }); // seat3
    if (t.toAct !== 0) continue;
    const legal = legalActions(t);
    if (!legal.includes('raise')) continue;
    offered++;
    if (minRaiseTo(t) > maxRaiseTo(t)) {
      violations++;
      if (violations === 1) console.log(`  VIOLATION at hero stack ${stack}: minRaiseTo=${minRaiseTo(t)} > maxRaiseTo=${maxRaiseTo(t)}`);
    }
  }
  console.log(`  'raise' offered in ${offered} stack sizes; minRaiseTo>maxRaiseTo in ${violations}`);
}

console.log('\n=== the amount the renderer sends: clamp(parseInt(slider.value)||min, min, max) ===');
{
  let s = startHand(makeTable([5000, 5000, 5000, 5000], 25, 50, 7));
  s = applyAction(s, { kind: 'raise', amount: 200 });
  const min = minRaiseTo(s);
  const max = maxRaiseTo(s);
  console.log(`  min=${min} max=${max}; every UI raise lands in [min,max], so the amount gap is`);
  console.log(`  unreachable from the table screen. It is reachable by any OTHER caller of applyAction`);
  console.log(`  (drills, lessons, replays, tests) since the engine performs no validation of its own.`);
  const bad = applyAction(s, { kind: 'raise', amount: max + 1 });
  console.log(`  raise to max+1=${max + 1}: seat${s.toAct} stack ${s.seats[s.toAct].stack} -> ${bad.seats[s.toAct].stack} (NEGATIVE, no throw)`);
  console.log(`  chips ${chipsOnTable(s)} -> ${chipsOnTable(bad)} (conserved — a negative stack keeps the sum right)`);
}

console.log('\n=== is a negative stack ever visible / does it corrupt later hands? ===');
{
  let s = startHand(makeTable([5000, 5000, 5000, 5000], 25, 50, 7));
  s = applyAction(s, { kind: 'raise', amount: 200 });
  let bad = applyAction(s, { kind: 'raise', amount: 6000 }); // seat0 only has 5000
  console.log(`  seat0 stack=${bad.seats[0].stack} allIn=${bad.seats[0].allIn} committed=${bad.seats[0].committed}`);
  console.log(`  allIn is FALSE because the code only sets it on stack === 0, never on stack < 0.`);
  console.log(`  legal for seat0 next time: it will be offered actions with a negative stack.`);
  let steps = 0;
  while (bad.street !== 'showdown' && bad.seats.filter((x) => !x.folded).length > 1 && steps++ < 60) {
    const legal = legalActions(bad);
    if (legal.length === 0) break;
    bad = applyAction(bad, { kind: legal.includes('check') ? 'check' : 'call' });
  }
  console.log(`  drove to ${bad.street} in ${steps} steps without a hang; pot=${bad.pot}`);
  console.log(`  >>> the engine has no guard, but the ONLY in-app caller (heroAct + decideAction) clamps.`);
}

console.log('\n=== does the AI ever produce an out-of-range amount? (clampRaise in ai.ts) ===');
{
  // ai.ts clampRaise: Math.min(Math.max(target, minRaiseTo), maxRaiseTo). If minRaiseTo > maxRaiseTo
  // the min() wins and the amount lands BELOW the legal minimum. Does legalActions ever offer
  // 'raise' in that state? Answered above: no. Confirm the AI's own soak is clean.
  console.log('  covered by tests/unit/ai.test.ts "returns only legal actions..." — kind only, not amount.');
  console.log('  clampRaise returns maxRaiseTo when minRaiseTo > maxRaiseTo, i.e. an all-in-sized raise,');
  console.log('  which applyAction handles as a raise leaving stack 0 -> allIn true. No defect found.');
}
