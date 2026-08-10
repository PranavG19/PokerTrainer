// Invariant 9, follow-up: gradeDecision accepts `betSize` and `stack`. Are they read at all?
// If not, the coach cannot tell a min-bet from a 100bb overbet, and every sizing error is invisible.
import { gradeDecision } from '../../src/core/coach.js';

const base = {
  hole: ['7h', '2d'],
  board: ['As', 'Kd', 'Qc'],
  street: 'flop',
  pot: 200,
  toCall: 0,
  stack: 5000,
  bb: 50,
  opponents: 1,
  seed: 42,
};

console.log('=== does betSize change anything? (7h2d on AsKdQc, pot 200, no bet to call) ===');
for (const betSize of [50, 100, 200, 1000, 5000, 999999, 0, -100, NaN]) {
  const g = gradeDecision({ ...base, chosen: 'bet', betSize });
  console.log(`  betSize=${String(betSize).padStart(7)}  sev=${g.severity.padEnd(8)} ΔEV=${g.evLossBb.toFixed(4)}  principle=${g.principle}  msg=${g.message ?? 'null'}`);
}

console.log('\n=== does stack change anything? ===');
for (const stack of [50, 500, 5000, 1e9]) {
  const g = gradeDecision({ ...base, chosen: 'bet', betSize: 200, stack });
  console.log(`  stack=${String(stack).padStart(10)}  sev=${g.severity.padEnd(8)} ΔEV=${g.evLossBb.toFixed(4)}`);
}

console.log('\n=== do bet / raise / allin differ at all? ===');
for (const chosen of ['bet', 'raise', 'allin'] as const) {
  const g = gradeDecision({ ...base, chosen, betSize: 200 });
  console.log(`  ${chosen.padEnd(6)} sev=${g.severity.padEnd(8)} ΔEV=${g.evLossBb.toFixed(6)} msg=${g.message ?? 'null'}`);
}
console.log('  >>> shoving 5000 and betting the minimum with 7h2d on AsKdQc are graded identically.');

console.log('\n=== the message for a shove says "risks ~X bb" — is X the chips actually risked? ===');
{
  const g = gradeDecision({ ...base, chosen: 'allin', betSize: 5000, toCall: 150, pot: 200 });
  console.log(`  toCall=150 pot=200 allin of a 5000 stack: ΔEV=${g.evLossBb.toFixed(3)} bb (= ${(g.evLossBb * 50).toFixed(0)} chips)`);
  console.log(`  msg: ${g.message}`);
  console.log(`  the seat is actually risking 5000 chips = 100 bb; the coach reports ${g.evLossBb.toFixed(1)} bb.`);
}

console.log('\n=== the "free" silence rule vs an obviously terrible call: is anything ever silent that should not be? ===');
{
  // Calling 20 into a 4000 pot with 7h2d on a AsKdQc board: required 0.5%, equity ~4% -> graded free.
  const g = gradeDecision({ ...base, chosen: 'call', pot: 4000, toCall: 20 });
  console.log(`  call 20 into 4000 with 7h2d: sev=${g.severity} ΔEV=${g.evLossBb.toFixed(4)} msg=${g.message ?? 'null (silent)'}`);
  console.log('  correct — a cheap call with 4% share against 0.5% required is genuinely fine. G3 silence.');
}

console.log('\n=== check on the FLOP with a monster: graded 0 by design (isLateStreet only turn/river) ===');
{
  const monster = { ...base, hole: ['As', 'Ah'], board: ['Ad', 'Ac', 'Kd'], street: 'flop', pot: 600, toCall: 0 };
  const flop = gradeDecision({ ...monster, chosen: 'check' });
  const turn = gradeDecision({ ...monster, street: 'turn', board: ['Ad', 'Ac', 'Kd', '3h'], chosen: 'check' });
  const fold = gradeDecision({ ...monster, chosen: 'fold' });
  console.log(`  quad aces, FLOP,  check -> sev=${flop.severity} ΔEV=${flop.evLossBb.toFixed(3)}`);
  console.log(`  quad aces, TURN,  check -> sev=${turn.severity} ΔEV=${turn.evLossBb.toFixed(3)}`);
  console.log(`  quad aces, FLOP,  fold  -> sev=${fold.severity} ΔEV=${fold.evLossBb.toFixed(3)}  msg=${fold.message ?? 'null'}`);
  console.log(`  >>> on the FLOP, folding quads (${fold.evLossBb.toFixed(2)}bb) is graded WORSE than checking them (${flop.evLossBb.toFixed(2)}bb) — correct ordering.`);
  console.log(`  >>> on the TURN: fold=${gradeDecision({ ...monster, street: 'turn', board: ['Ad','Ac','Kd','3h'], chosen: 'fold' }).evLossBb.toFixed(2)}bb vs check=${turn.evLossBb.toFixed(2)}bb`);
}
