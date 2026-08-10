/**
 * EXPERIMENT 4 — re-score stored completions against the current guard, without re-calling the
 * model. The completions are the measurement; the guard regexes went through one refinement pass
 * after the first run (poker's own vocabulary tripped the naive ban list), and every guard change
 * is re-applied to the SAME strings so the two versions are comparable.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { runGuard, failureKeys } from './guard.js';
import { VARIANTS } from './variants.js';

const phase = process.argv[2];
if (phase !== 'explainer' && phase !== 'interrogator') {
  console.error('usage: rescore.ts <explainer|interrogator>');
  process.exit(1);
}
const kind = phase === 'explainer' ? 'correction' : 'question';
const path = `scripts/experiments/tutorPrompts/out/${phase}.json`;
const data = JSON.parse(readFileSync(path, 'utf8')) as {
  modelId: string;
  rows: { variant: string; spotId: string; tier: string; street: string; output: string; payload: { permittedNumerals: string[] }; guard: unknown; failureKeys: string[] }[];
};

for (const r of data.rows) {
  const g = runGuard(r.output, kind as 'correction' | 'question', r.payload.permittedNumerals);
  r.guard = g;
  r.failureKeys = failureKeys(g);
}
writeFileSync(path, JSON.stringify(data, null, 2));

console.log(`=== ${phase.toUpperCase()} (rescored) — model ${data.modelId} ===`);
for (const variant of VARIANTS) {
  const sub = data.rows.filter((r) => r.variant === variant);
  const pass = sub.filter((r) => (r.guard as { pass: boolean }).pass).length;
  const byCheck: Record<string, number> = {};
  for (const r of sub) for (const k of r.failureKeys) byCheck[k] = (byCheck[k] ?? 0) + 1;
  const avgWords = (sub.reduce((a, r) => a + (r.guard as { wordCount: number }).wordCount, 0) / sub.length).toFixed(1);
  console.log(`  ${variant}: ${pass}/${sub.length} (${((pass / sub.length) * 100).toFixed(1)}%)  avg words ${avgWords}  ${JSON.stringify(byCheck)}`);
}
const overall = data.rows.filter((r) => (r.guard as { pass: boolean }).pass).length;
console.log(`  ALL VARIANTS: ${overall}/${data.rows.length} (${((overall / data.rows.length) * 100).toFixed(1)}%)`);

// per-tier and per-street breakdown for the winning variant
for (const variant of VARIANTS) {
  const sub = data.rows.filter((r) => r.variant === variant);
  const byTier: Record<string, [number, number]> = {};
  const byStreet: Record<string, [number, number]> = {};
  for (const r of sub) {
    const p = (r.guard as { pass: boolean }).pass ? 1 : 0;
    byTier[r.tier] = [(byTier[r.tier]?.[0] ?? 0) + p, (byTier[r.tier]?.[1] ?? 0) + 1];
    byStreet[r.street] = [(byStreet[r.street]?.[0] ?? 0) + p, (byStreet[r.street]?.[1] ?? 0) + 1];
  }
  console.log(`  ${variant} by tier:`, Object.entries(byTier).sort().map(([k, [a, b]]) => `${k} ${a}/${b}`).join('  '));
  console.log(`  ${variant} by street:`, Object.entries(byStreet).sort().map(([k, [a, b]]) => `${k} ${a}/${b}`).join('  '));
}

console.log('\nFAILURES:');
for (const r of data.rows.filter((r) => !(r.guard as { pass: boolean }).pass)) {
  console.log(`  [${r.variant}] ${r.spotId} ${r.tier} — ${r.failureKeys.join(', ')}`);
  for (const f of (r.guard as { failures: { check: string; detail: string }[] }).failures) {
    console.log(`      ${f.check}: ${f.detail}`);
  }
  console.log(`      OUTPUT: ${JSON.stringify(r.output)}`);
}
