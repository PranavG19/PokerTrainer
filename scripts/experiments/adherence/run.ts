/**
 * EXPERIMENT 1 — runner. Fans every (policy, mix, seed) cell out to a child process, then reports.
 *
 * Usage, from the REPO ROOT (/tmp cannot see node_modules):
 *   ./node_modules/.bin/vite-node scripts/experiments/adherence/run.ts <handsPerCell> [seed...]
 *
 * Fanning out is not premature: the adherent policies call gradeDecision once per legal action at
 * 2000 Monte Carlo iterations each, which is ~30x the cost of a bot decision and makes a
 * single-process run of a meaningful sample size take hours.
 *
 * Writes out/results-<hands>.json with every per-hand result, so the report and any re-analysis
 * quote real numbers rather than a summary.
 */
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { promisify } from 'node:util';
import { MIXES } from './harness.js';
import type { MatchResult } from './harness.js';
import { POLICY_NAMES } from './policies.js';
import type { PolicyName } from './policies.js';
import { ciText, handsForHalfWidth, interval, pairedDifference, separates } from './stats.js';

const run = promisify(execFile);

const hands = Number(process.argv[2] ?? 2000);
const seeds = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [20260809, 424242, 8675309];
if (!Number.isFinite(hands) || hands < 1) throw new Error(`bad hands argument: ${process.argv[2]}`);
for (const s of seeds) if (!Number.isFinite(s)) throw new Error(`bad seed: ${s}`);

/**
 * Recorded into every results file. A parallel agent committed a coach fix mid-run once and the
 * saved numbers silently described a version of src/core/coach.ts that no longer existed; only a
 * later reproducibility check caught it. Stamping the dependency bytes makes that failure loud.
 *
 * Only the files the harness actually reads are hashed. Watching all of src/core produced a false alarm: a
 * parallel agent shipped lessons and nav while a run was in flight, which cannot affect a headless
 * table simulation. Hashing the exact dependency set is the claim that matters — "the code that
 * produced these numbers" — and it is what the report cites.
 */
const DEPENDENCIES = [
  'src/core/coach.ts',
  'src/core/ai.ts',
  'src/core/table.ts',
  'src/core/equity.ts',
  'src/core/evaluate.ts',
  'src/core/cards.ts',
  'src/core/rng.ts',
];

function sourceProvenance(): { head: string; dependencyHash: string; dirtyDependencies: string[] } {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  // Hash the working-tree bytes, not the commit: an uncommitted edit changes the result too.
  const hashes = execFileSync('git', ['hash-object', ...DEPENDENCIES], { encoding: 'utf8' }).trim();
  const dependencyHash = createHash('sha256').update(hashes).digest('hex').slice(0, 16);
  const dirtyDependencies = execFileSync('git', ['status', '--porcelain', '--', ...DEPENDENCIES], { encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.trim().length > 0);
  return { head, dependencyHash, dirtyDependencies };
}

const OUT_DIR = 'scripts/experiments/adherence/out';
const CELL_DIR = `${OUT_DIR}/cells-${hands}`;
mkdirSync(CELL_DIR, { recursive: true });

interface Cell {
  policy: PolicyName;
  mix: string;
  seed: number;
  path: string;
}

const cells: Cell[] = [];
for (const mix of MIXES) {
  for (const seed of seeds) {
    for (const policy of POLICY_NAMES) {
      cells.push({ policy, mix: mix.name, seed, path: `${CELL_DIR}/${mix.name}-${seed}-${policy}.json` });
    }
  }
}

const provenanceBefore = sourceProvenance();
process.stderr.write(
  `harness dependencies: hash ${provenanceBefore.dependencyHash} at HEAD ${provenanceBefore.head}` +
    `${provenanceBefore.dirtyDependencies.length ? ' (DIRTY)' : ''}\n`,
);

const startedAt = Date.now();
let done = 0;

async function execCell(cell: Cell): Promise<MatchResult> {
  await run('./node_modules/.bin/vite-node', [
    'scripts/experiments/adherence/cell.ts',
    cell.policy,
    cell.mix,
    String(cell.seed),
    String(hands),
    cell.path,
  ]);
  const result: MatchResult = JSON.parse(readFileSync(cell.path, 'utf8'));
  done++;
  const iv = interval(result.perHandBb);
  process.stderr.write(
    `[${String(done).padStart(2)}/${cells.length}] ${cell.mix.padEnd(12)} seed=${String(cell.seed).padEnd(9)} ` +
      `${cell.policy.padEnd(17)} ${ciText(iv).padEnd(26)} σhand=${iv.sigmaHandBb.toFixed(1).padStart(5)}bb ` +
      `dec=${result.heroDecisions} silent=${result.graderSilentDecisions} tied=${result.graderTiedDecisions} ` +
      `stuck=${result.stuckStates} showdowns=${result.showdownsReached} vpip=${result.vpipHands}\n`,
  );
  return result;
}

/** Bounded concurrency: one core per cell, minus one so the machine stays usable. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

const results = await mapLimit(cells, Math.max(1, cpus().length - 1), execCell);

// ── Pooled per-policy and paired-vs-adherent tables ──────────────────────────

const pooled = new Map<string, number[]>();
for (const r of results) {
  for (const key of [r.policy, `${r.mix}|${r.policy}`]) {
    const arr = pooled.get(key) ?? [];
    arr.push(...r.perHandBb);
    pooled.set(key, arr);
  }
}

const lines: string[] = [];
const say = (s: string): void => {
  lines.push(s);
  process.stdout.write(s + '\n');
};

say(`\n== POOLED (${MIXES.length} mixes x ${seeds.length} seeds x ${hands} hands) ==`);
for (const policy of POLICY_NAMES) {
  const iv = interval(pooled.get(policy)!);
  say(
    `${policy.padEnd(17)} n=${String(iv.n).padStart(6)} ${ciText(iv).padEnd(26)} bb/100  ` +
      `σhand=${iv.sigmaHandBb.toFixed(1)}bb  σ/100hands=${iv.sigmaPer100Hands.toFixed(0)}bb`,
  );
}

const BASELINE: PolicyName = 'adherent-passive';
say(`\n== PAIRED DIFFERENCE, ${BASELINE} minus X (pooled) ==`);
for (const policy of POLICY_NAMES) {
  if (policy === BASELINE) continue;
  const d = pairedDifference(pooled.get(BASELINE)!, pooled.get(policy)!);
  say(`vs ${policy.padEnd(17)} ${ciText(d).padEnd(28)} bb/100  ${separates(d) ? 'SEPARATES' : 'inside noise'}`);
}

say(`\n== PER-MIX paired difference, ${BASELINE} minus X ==`);
for (const mix of MIXES) {
  for (const policy of POLICY_NAMES) {
    if (policy === BASELINE) continue;
    const d = pairedDifference(pooled.get(`${mix.name}|${BASELINE}`)!, pooled.get(`${mix.name}|${policy}`)!);
    say(`${mix.name.padEnd(12)} vs ${policy.padEnd(17)} ${ciText(d).padEnd(28)} ${separates(d) ? 'SEPARATES' : 'inside noise'}`);
  }
}

say('\n== GRADER DIAGNOSTICS (adherent policies only) ==');
for (const policy of ['adherent-passive', 'adherent-aggro'] as PolicyName[]) {
  const rs = results.filter((r) => r.policy === policy);
  const dec = rs.reduce((a, r) => a + r.heroDecisions, 0);
  const silent = rs.reduce((a, r) => a + r.graderSilentDecisions, 0);
  const tied = rs.reduce((a, r) => a + r.graderTiedDecisions, 0);
  say(
    `${policy.padEnd(17)} decisions=${dec} allFree=${silent} (${((silent / dec) * 100).toFixed(1)}%) ` +
      `tiedAtMin=${tied} (${((tied / dec) * 100).toFixed(1)}%)`,
  );
}

say('\n== SAMPLE SIZE: what this run buys ==');
const ivBase = interval(pooled.get(BASELINE)!);
say(`observed per-hand σ for ${BASELINE}: ${ivBase.sigmaHandBb.toFixed(1)}bb → ±${(1.96 * ivBase.se).toFixed(1)} bb/100 at n=${ivBase.n}`);
for (const hw of [50, 20, 10, 5]) {
  say(`  unpaired CI half-width ±${hw} bb/100 needs ~${handsForHalfWidth(ivBase.sigmaHandBb, hw).toLocaleString()} hands`);
}
const dWide = pairedDifference(pooled.get(BASELINE)!, pooled.get('wide-caller')!);
say(`paired σ (${BASELINE} − wide-caller): ${dWide.sigmaHandBb.toFixed(1)}bb → half-width ±${(1.96 * dWide.se).toFixed(1)} bb/100 at n=${dWide.n}`);

const stuck = results.reduce((a, r) => a + r.stuckStates, 0);
say(`\nengine sanity: stuckStates total = ${stuck} (must be 0)`);

const provenanceAfter = sourceProvenance();
const sourceChangedMidRun = provenanceAfter.dependencyHash !== provenanceBefore.dependencyHash;
say(`\nharness dependency hash: ${provenanceBefore.dependencyHash} (HEAD ${provenanceBefore.head.slice(0, 7)} at start)`);
if (sourceChangedMidRun) {
  say(`!! DEPENDENCIES CHANGED MID-RUN (now ${provenanceAfter.dependencyHash}) — these numbers mix two versions. DISCARD.`);
}
if (provenanceBefore.dirtyDependencies.length > 0) {
  say(`!! uncommitted changes in harness dependencies: ${provenanceBefore.dirtyDependencies.join(', ')}`);
}

const outPath = `${OUT_DIR}/results-${hands}-dep${provenanceBefore.dependencyHash}.json`;
writeFileSync(
  outPath,
  JSON.stringify({
    hands,
    seeds,
    mixes: MIXES,
    provenanceBefore,
    provenanceAfter,
    sourceChangedMidRun,
    elapsedSec: (Date.now() - startedAt) / 1000,
    report: lines,
    results,
  }),
);
rmSync(CELL_DIR, { recursive: true, force: true });
process.stdout.write(`\nwrote ${outPath} in ${((Date.now() - startedAt) / 1000).toFixed(0)}s\n`);
