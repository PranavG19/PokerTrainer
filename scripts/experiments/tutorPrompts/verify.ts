/**
 * Asserts that src/main/tutor/prompts.ts carries the EXACT strings that were measured. A prompt
 * whose recorded pass rate came from a different string is a lie in a comment.
 */
import { EXPLAINER_SYSTEM, INTERROGATOR_SYSTEM } from './variants.js';
import { EXPLAINER_CORRECTION, INTERROGATOR_QUESTION, SILENCE_RULE } from '../../../src/main/tutor/prompts.js';
import { silenceSuffix } from './variants.js';

const checks: [string, string, string][] = [
  ['EXPLAINER_CORRECTION vs variant "terse"', EXPLAINER_CORRECTION, EXPLAINER_SYSTEM.terse],
  ['INTERROGATOR_QUESTION vs variant "banlist2"', INTERROGATOR_QUESTION, INTERROGATOR_SYSTEM.banlist2],
  ['SILENCE_RULE vs sentinel suffix', SILENCE_RULE, silenceSuffix('sentinel')],
];
let bad = 0;
for (const [label, a, b] of checks) {
  const same = a === b;
  if (!same) bad++;
  console.log(`${same ? 'MATCH' : 'DIFFER'}  ${label}`);
  if (!same) {
    console.log('  prompts.ts len', a.length, 'variant len', b.length);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) { console.log(`  first diff at ${i}: ${JSON.stringify(a.slice(i - 60, i + 60))} vs ${JSON.stringify(b.slice(i - 60, i + 60))}`); break; }
    }
  }
}
process.exit(bad === 0 ? 0 : 1);
