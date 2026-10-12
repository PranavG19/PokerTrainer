/**
 * EXPERIMENT 1 — the two report sections the Wave 0 exit criterion reads: the grader's marginal value
 * per lineup, and how often the grader has an opinion. Shared by run.ts and analyze.ts so a re-analysis
 * prints exactly what the run printed.
 */
import type { GraderStats, MatchResult, StreetOpinion } from './harness.js';
import { emptyGraderStats } from './harness.js';
import type { PolicyName } from './policies.js';
import { ciText, pairedDifference, separates } from './stats.js';

const pct = (n: number, d: number): string => (d === 0 ? '   -' : `${((n / d) * 100).toFixed(1).padStart(5)}%`);

/** tag-plus-grader minus tag-baseline, pooled and per mix. Positive means the coach adds bb. */
export function marginalReport(results: readonly MatchResult[]): string[] {
  const out = ['\n== GRADER MARGINAL VALUE: tag-plus-grader minus tag-baseline (paired, bb/100) =='];
  const series = (policy: PolicyName, mix?: string): number[] =>
    results.filter((r) => r.policy === policy && (mix === undefined || r.mix === mix)).flatMap((r) => r.perHandBb);
  const mixes = [...new Set(results.map((r) => r.mix))];
  for (const mix of [undefined, ...mixes]) {
    const d = pairedDifference(series('tag-plus-grader', mix), series('tag-baseline', mix));
    const verdict = separates(d) ? (d.mean > 0 ? 'HELPS' : 'HURTS') : 'inside noise';
    out.push(`${(mix ?? 'POOLED').padEnd(12)} ${ciText(d).padEnd(28)} n=${d.n}  ${verdict}`);
  }
  return out;
}

function merge(into: GraderStats, from: GraderStats | undefined): void {
  if (!from) return;
  for (const [street, row] of Object.entries(from.byStreet)) {
    const acc = (into.byStreet[street] ??= { decisions: 0, allFree: 0, silent: 0, close: 0, tied: 0, decisive: 0 });
    for (const k of Object.keys(row) as (keyof StreetOpinion)[]) acc[k] += row[k];
  }
  for (const [v, n] of Object.entries(from.verdictsAllActions)) into.verdictsAllActions[v] = (into.verdictsAllActions[v] ?? 0) + n;
  for (const [v, n] of Object.entries(from.verdictsChosen)) into.verdictsChosen[v] = (into.verdictsChosen[v] ?? 0) + n;
}

const STREETS = ['preflop', 'flop', 'turn', 'river'];
const VERDICTS = ['free', 'close', 'notable', 'serious'];

/** Opinion rates per street and verdict histograms, for the grader-adherent policies. */
export function graderReport(results: readonly MatchResult[]): string[] {
  const out: string[] = ['\n== GRADER OPINION (adherent policies; every legal action graded at every decision) =='];
  out.push('allFree = every action < 0.5bb; silent = allFree and nothing flagged close; close = some action');
  out.push('inside the close band; tied = >1 action at the minimum; decisive = unique minimum and some action charged.');
  for (const policy of ['adherent-passive', 'adherent-aggro'] as PolicyName[]) {
    const stats = emptyGraderStats();
    for (const r of results) if (r.policy === policy) merge(stats, r.graderStats);
    const total: StreetOpinion = { decisions: 0, allFree: 0, silent: 0, close: 0, tied: 0, decisive: 0 };
    out.push(`\n${policy}`);
    out.push(`  ${'street'.padEnd(8)} ${'decisions'.padStart(9)} ${'allFree'.padStart(7)} ${'silent'.padStart(7)} ${'close'.padStart(7)} ${'tied'.padStart(7)} ${'decisive'.padStart(8)}`);
    for (const street of STREETS) {
      const row = stats.byStreet[street];
      if (!row) continue;
      for (const k of Object.keys(total) as (keyof StreetOpinion)[]) total[k] += row[k];
      out.push(
        `  ${street.padEnd(8)} ${String(row.decisions).padStart(9)} ${pct(row.allFree, row.decisions).padStart(7)} ${pct(row.silent, row.decisions).padStart(7)} ` +
          `${pct(row.close, row.decisions).padStart(7)} ${pct(row.tied, row.decisions).padStart(7)} ${pct(row.decisive, row.decisions).padStart(8)}`,
      );
    }
    out.push(
      `  ${'ALL'.padEnd(8)} ${String(total.decisions).padStart(9)} ${pct(total.allFree, total.decisions).padStart(7)} ${pct(total.silent, total.decisions).padStart(7)} ` +
        `${pct(total.close, total.decisions).padStart(7)} ${pct(total.tied, total.decisions).padStart(7)} ${pct(total.decisive, total.decisions).padStart(8)}`,
    );
    const hist = (h: Record<string, number>): string => {
      const n = Object.values(h).reduce((a, b) => a + b, 0);
      return VERDICTS.map((v) => `${v} ${pct(h[v] ?? 0, n).trim()}`).join('  ');
    };
    out.push(`  verdicts, every legal action: ${hist(stats.verdictsAllActions)}`);
    out.push(`  verdicts, action played:      ${hist(stats.verdictsChosen)}`);
  }
  return out;
}
