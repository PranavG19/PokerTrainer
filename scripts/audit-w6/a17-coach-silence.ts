// coach.ts:56-63 states a design claim in a comment: halving the equity "keeps the most common
// correct beginner play, folding trash preflop for free, inside the silence threshold: raw equity
// charged 0.52bb ('notable') for folding 72o". Check the claim as written, and check whether the
// threshold survives the pot sizes the app actually produces.
import { gradeDecision } from '../../src/core/coach.js';

console.log('=== the comment\'s own example: folding 72o preflop for free ===');
{
  // "for free" preflop means the hero is the BB facing no raise (toCall 0) with the blinds in.
  // 4-handed at 25/50 that pot is 75.
  for (const pot of [75, 100, 150, 200, 400, 1000, 2000]) {
    const g = gradeDecision({ hole: ['7h', '2d'], board: [], street: 'preflop', pot, toCall: 0, stack: 5000, bb: 50, chosen: 'fold', opponents: 3, seed: 1 });
    console.log(`  pot=${String(pot).padStart(4)}  sev=${g.severity.padEnd(8)} ΔEV=${g.evLossBb.toFixed(3)}bb  ${g.message ? 'SPEAKS' : 'silent'}`);
  }
  console.log('  >>> the claim holds only at the real preflop pot (75). It is a pot-size coincidence,');
  console.log('      not a property of the formula: ΔEV scales linearly with pot.');
}

console.log('\n=== a free fold on a LATER street, where pots are large ===');
{
  for (const [street, board] of [['flop', ['As', 'Kh', '7s']], ['turn', ['As', 'Kh', '7s', '2d']], ['river', ['As', 'Kh', '7s', '2d', '4c']]] as const) {
    for (const pot of [200, 600, 2000]) {
      const g = gradeDecision({ hole: ['7h', '2c'], board: [...board], street, pot, toCall: 0, stack: 5000, bb: 50, chosen: 'fold', opponents: 1, seed: 1 });
      console.log(`  ${street.padEnd(6)} pot=${String(pot).padStart(4)} 7h2c on ${board.join('')}  sev=${g.severity.padEnd(8)} ΔEV=${g.evLossBb.toFixed(3)}bb  ${g.message ? 'SPEAKS' : 'silent'}`);
    }
  }
  console.log('  >>> folding a hand with ~7% share on a large pot is graded "serious". Folding is the');
  console.log('      right play against any bet; there just is not one here, so the coach is comparing');
  console.log('      it to a CHECK. That is correct in ordering but the SIZE is the whole pot\'s value,');
  console.log('      so it fires on nearly every free fold. G3 silence says say nothing when a decision');
  console.log('      cost ~nothing; a free fold with 7% share costs about 3.5% of the pot in realised');
  console.log('      equity, not 5bb.');
}

console.log('\n=== calibration: what SHOULD a free fold with equity e into pot P cost? ===');
{
  console.log('  the formula charges e * 0.5 * P. For 7h2c with ~7% share into a 2000 pot that is 70');
  console.log('  chips = 1.4bb. Measured:');
  const g = gradeDecision({ hole: ['7h', '2c'], board: ['As', 'Kh', '7s', '2d'], street: 'turn', pot: 2000, toCall: 0, stack: 5000, bb: 50, chosen: 'fold', opponents: 1, seed: 1 });
  console.log(`  ΔEV=${g.evLossBb.toFixed(3)}bb -> ${(g.evLossBb * 50).toFixed(0)} chips of a 2000 pot = ${((g.evLossBb * 50 / 2000) * 100).toFixed(1)}% of it`);
  console.log('  arithmetically consistent with the stated formula. The defect is the SENTENCE, which');
  console.log('  attributes the number to pot odds ("when only 0% was needed") rather than to the');
  console.log('  forfeited free card. principle is also set to "pot odds", so session.ts aggregates');
  console.log('  every free fold under the pot-odds leak — G7 says aggregate by ERROR TAG, and this');
  console.log('  tags a value/realisation error as an arithmetic one.');
  console.log(`  principle recorded = ${JSON.stringify(g.principle)}`);
}
