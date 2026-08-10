/**
 * EXPERIMENT 1 — re-analysis of a saved results file. Kept separate from run.ts so the 22-minute
 * run does not have to be repeated to ask a new question of the same hands.
 *
 *   ./node_modules/.bin/vite-node scripts/experiments/adherence/analyze.ts out/results-2000.json
 */
import { readFileSync } from 'node:fs';
import type { MatchResult } from './harness.js';
import { POLICY_NAMES } from './policies.js';
import type { PolicyName } from './policies.js';
import { ciText, interval, pairedDifference, separates } from './stats.js';

const path = process.argv[2] ?? 'scripts/experiments/adherence/out/results-2000.json';
const file: { hands: number; seeds: number[]; results: MatchResult[] } = JSON.parse(readFileSync(path, 'utf8'));

const pooled = new Map<string, number[]>();
for (const r of file.results) {
  for (const key of [r.policy, `${r.mix}|${r.policy}`]) {
    const arr = pooled.get(key) ?? [];
    arr.push(...r.perHandBb);
    pooled.set(key, arr);
  }
}
const mixes = [...new Set(file.results.map((r) => r.mix))];

/**
 * The question the product actually rests on: a student who already plays TAG and then follows the
 * coach — is that better or worse than the TAG they had? Positive means the grader adds bb.
 */
process.stdout.write('\n== GRADER MARGINAL VALUE: tag-plus-grader minus tag-baseline ==\n');
const marginal = (mix?: string): void => {
  const k = (p: PolicyName): string => (mix ? `${mix}|${p}` : p);
  const d = pairedDifference(pooled.get(k('tag-plus-grader'))!, pooled.get(k('tag-baseline'))!);
  process.stdout.write(
    `${(mix ?? 'POOLED').padEnd(12)} ${ciText(d).padEnd(28)} bb/100  n=${d.n}  ${separates(d) ? (d.mean > 0 ? 'HELPS' : 'HURTS') : 'inside noise'}\n`,
  );
};
marginal();
for (const mix of mixes) marginal(mix);

process.stdout.write('\n== FULL RANKING (pooled, best first) ==\n');
const ranked = [...POLICY_NAMES]
  .map((p) => ({ p, iv: interval(pooled.get(p)!) }))
  .sort((a, b) => b.iv.mean - a.iv.mean);
for (const { p, iv } of ranked) {
  process.stdout.write(`${p.padEnd(17)} ${ciText(iv).padEnd(26)} bb/100\n`);
}

process.stdout.write('\n== EVERY PAIRWISE PAIRED DIFFERENCE (row minus column), pooled bb/100 ==\n');
process.stdout.write('significant at 95% only where marked *\n');
process.stdout.write(''.padEnd(18) + POLICY_NAMES.map((p) => p.slice(0, 9).padStart(11)).join('') + '\n');
for (const a of POLICY_NAMES) {
  let line = a.padEnd(18);
  for (const b of POLICY_NAMES) {
    if (a === b) {
      line += '          .';
      continue;
    }
    const d = pairedDifference(pooled.get(a)!, pooled.get(b)!);
    line += `${d.mean.toFixed(0)}${separates(d) ? '*' : ' '}`.padStart(11);
  }
  process.stdout.write(line + '\n');
}

/** Spearman rank correlation between "grader says this is good" and realised bb/100. */
process.stdout.write('\n== DOES THE GRADER RANK THE POLICIES CORRECTLY? ==\n');
process.stdout.write('The grader has an opinion about actions, not policies, so the honest test is: does the\n');
process.stdout.write('policy the grader itself would play come out on top? Rank of adherent-passive among all\n');
process.stdout.write(`${POLICY_NAMES.length} policies by realised bb/100: ${ranked.findIndex((r) => r.p === 'adherent-passive') + 1} of ${ranked.length}\n`);
process.stdout.write(`Rank of the deliberately-bad never-bluff-nit: ${ranked.findIndex((r) => r.p === 'never-bluff-nit') + 1} of ${ranked.length}\n`);
process.stdout.write(`Rank of the always-fold control:              ${ranked.findIndex((r) => r.p === 'always-fold') + 1} of ${ranked.length}\n`);
