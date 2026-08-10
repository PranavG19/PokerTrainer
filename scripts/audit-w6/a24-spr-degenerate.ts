// The verifier's unfixed finding: effectiveStack clamps to `bet`, so `effectiveStack - bet === 0`
// and the SPR problem becomes "0 bb behind. SPR?" with answer 0. Measure how often the sequence the
// drill screen actually serves hits it, before deciding whether it is worth changing core.
import { generateProblem, sprTolerance } from '../../src/core/arithmetic.js';

// The screen's sequence: seedFor(i) = 101 + i (src/renderer/screens/drill.ts).
const FIRST_SEED = 101;
const N = 200;

let degenerate = 0;
const examples: string[] = [];

for (let i = 0; i < N; i++) {
  const p = generateProblem(FIRST_SEED + i, 'spr');
  const behind = p.effectiveStack - p.bet;
  if (behind === 0) {
    degenerate++;
    if (examples.length < 5) {
      examples.push(
        `seed ${FIRST_SEED + i} (position ${i}): "${p.prompt}" answer=${p.answer} tolerance=${p.tolerance}`,
      );
    }
  }
}

console.log(`=== SPR problems with nothing behind, over the ${N} seeds the screen serves ===`);
console.log(`  degenerate: ${degenerate} of ${N} (${((degenerate / N) * 100).toFixed(1)}%)`);
for (const e of examples) console.log(`  ${e}`);

console.log('\n=== what a learner can answer on one of these ===');
{
  const p = generateProblem(FIRST_SEED, 'spr');
  const behind = p.effectiveStack - p.bet;
  if (behind === 0) {
    console.log(`  prompt: "${p.prompt}"`);
    console.log(`  answer ${p.answer}, tolerance ${sprTolerance(p.answer)}`);
    console.log(`  so every guess in [${-sprTolerance(p.answer)}, ${sprTolerance(p.answer)}] is accepted:`);
    console.log('  a learner who types 0, 0.1 or 0.25 is all equally "right", and the question');
    console.log('  taught nothing — there is no ratio to compute when the stack is already in.');
  } else {
    console.log(`  seed ${FIRST_SEED} is not degenerate (${behind} bb behind), see the list above.`);
  }
}

console.log('\n=== is the clamp reachable across the whole parameter space? ===');
{
  let hits = 0;
  for (let seed = 1; seed <= 5000; seed++) {
    const p = generateProblem(seed, 'spr');
    if (p.effectiveStack - p.bet === 0) hits++;
  }
  console.log(`  ${hits} of 5000 arbitrary seeds (${((hits / 5000) * 100).toFixed(1)}%)`);
  console.log('  Cause (src/core/arithmetic.ts:361): effectiveStack = Math.max(bet, ...). When the');
  console.log('  subtraction goes at or below `bet`, the clamp makes them equal and nothing is behind.');
}
