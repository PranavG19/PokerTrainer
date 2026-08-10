/**
 * Controls for the metrics code. No test file is authored here (tests/ is not mine to touch), so
 * this is the substitute for a mutation check: prove the scorer can report failure before believing
 * it when it reports success.
 *
 * 1 ORACLE  — predict the gold label. Must be 100% everywhere, or the scorer under-counts.
 * 2 RANDOM  — predict a uniform random label. Must land near 25%, or the scorer over-counts.
 * 3 CONSTANT-POS — always predict hand-strength. G4 precision must fall to the base rate of
 *   {hand-strength, none} (50/100), which is the "G4 interrupts everything" pathology; if the
 *   precision figure does not collapse here, it is not measuring what the gate needs.
 * 4 CONSTANT-NEG — always predict range. G4 recall must be 0 and precision undefined.
 *
 * Usage: node scripts/experiments/reasonGrader/controls.mjs
 */
import { readFileSync } from 'node:fs';
import { LABELS, perClass, g4Binary, pct } from './metrics.mjs';

const corpus = readFileSync(new URL('../../../research/corpus/reasons.jsonl', import.meta.url), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));

// Deterministic so the control numbers are reproducible run to run.
const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rand = mulberry32(1);

const score = (name, predict) => {
  const rows = corpus.map((r) => ({ ...r, got: predict(r), correct: predict(r) === r.label }));
  const g4 = g4Binary(rows);
  const acc = rows.filter((r) => r.correct).length / rows.length;
  console.log(`${name.padEnd(14)} accuracy ${pct(acc).padStart(6)}  G4 precision ${String(pct(g4.precision)).padStart(6)}  G4 recall ${String(pct(g4.recall)).padStart(6)}  tp=${g4.tp} fp=${g4.fp} fn=${g4.fn}`);
  return { acc, g4, perClass: perClass(rows) };
};

const oracle = score('ORACLE', (r) => r.label);
const random = score('RANDOM', () => LABELS[Math.floor(rand() * 4)]);
const alwaysHs = score('CONSTANT-POS', () => 'hand-strength');
const alwaysRange = score('CONSTANT-NEG', () => 'range');

const checks = [
  ['oracle accuracy is 100%', oracle.acc === 1],
  ['oracle G4 precision is 100%', oracle.g4.precision === 1],
  ['random accuracy is within 25% +/- 15pts', Math.abs(random.acc - 0.25) < 0.15],
  ['constant-positive G4 precision equals the base rate 50/100', alwaysHs.g4.precision === 0.5],
  ['constant-positive G4 recall is 100% (it fires on everything)', alwaysHs.g4.recall === 1],
  ['constant-negative G4 recall is 0%', alwaysRange.g4.recall === 0],
  ['constant-negative G4 precision is undefined (nothing predicted positive)', alwaysRange.g4.precision === null],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? '\nall controls pass: the scorer distinguishes a perfect, a chance and a degenerate classifier' : `\n${failed} CONTROL(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
