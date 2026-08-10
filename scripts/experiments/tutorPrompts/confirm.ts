/**
 * Independent confirmation: drive the EXPORTS FROM src/main/tutor/prompts.ts (not the harness
 * variants) against a fresh 30-spot draw, and re-measure. If the recorded rates are real, these
 * land in the same neighbourhood.
 */
import { readFileSync } from 'node:fs';
import { invoke, mapLimit } from './bedrock.js';
import { runGuard } from './guard.js';
import { renderPayload } from './variants.js';
import { EXPLAINER_CORRECTION, INTERROGATOR_QUESTION, SILENCE_RULE, isSilent } from '../../../src/main/tutor/prompts.js';

const s = JSON.parse(readFileSync('scripts/experiments/tutorPrompts/out/sample.json', 'utf8'));
// A disjoint slice: every 5th graded spot, and the T0 set.
const graded = s.graded.filter((_: unknown, i: number) => i % 5 === 2).slice(0, 30);
const silent = s.silent.slice(0, 12);

const exp = await mapLimit(graded, 6, async (item: any) => {
  const out = await invoke({ system: EXPLAINER_CORRECTION, user: renderPayload(item.payload), maxTokens: 300, temperature: 0 });
  return { pass: runGuard(out, 'correction', item.payload.permittedNumerals).pass, out };
});
const q = await mapLimit(graded, 6, async (item: any) => {
  const out = await invoke({ system: INTERROGATOR_QUESTION, user: renderPayload(item.payload, 'it felt like the standard play here'), maxTokens: 120, temperature: 0 });
  return { pass: runGuard(out, 'question', item.payload.permittedNumerals).pass, out };
});
const sil = await mapLimit(silent, 6, async (item: any) => {
  const out = await invoke({ system: EXPLAINER_CORRECTION + '\n' + SILENCE_RULE, user: renderPayload(item.payload), maxTokens: 300, temperature: 0 });
  return { silent: isSilent(out), out };
});

const praise = /\b(nice|good|great|well done|solid|correct|excellent|congrat)\b/i;
console.log(`EXPLAINER_CORRECTION  guard pass ${exp.filter(r=>r.pass).length}/${exp.length}  (recorded 77.2%)`);
console.log(`INTERROGATOR_QUESTION guard pass ${q.filter(r=>r.pass).length}/${q.length}  (recorded 94.6%)`);
console.log(`SILENCE_RULE          silent     ${sil.filter(r=>r.silent).length}/${sil.length}  (recorded 100%)   praise: ${sil.filter(r=>praise.test(r.out)).length}`);
console.log('\nsample explainer output:', JSON.stringify(exp[0].out));
console.log('sample question:', JSON.stringify(q[0].out));
