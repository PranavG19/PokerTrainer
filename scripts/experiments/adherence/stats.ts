/** EXPERIMENT 1 — the arithmetic that turns a pile of hand results into a claim with error bars. */

export interface Interval {
  /** bb/100 */
  mean: number;
  /** bb/100 */
  se: number;
  lo95: number;
  hi95: number;
  /** Standard deviation of a single hand's result, in bb. */
  sigmaHandBb: number;
  /**
   * Standard deviation of a 100-hand block's total, in bb — the "σ ≈ 100 bb/100" convention the
   * PRODUCT-SPEC quotes. Independent hands ⇒ σ_100 = σ_hand × √100.
   */
  sigmaPer100Hands: number;
  n: number;
}

const Z95 = 1.959964;

function mean(xs: number[]): number {
  let total = 0;
  for (const x of xs) total += x;
  return total / xs.length;
}

/** Sample standard deviation (n-1). */
function stdev(xs: number[], mu: number): number {
  if (xs.length < 2) return 0;
  let sq = 0;
  for (const x of xs) sq += (x - mu) * (x - mu);
  return Math.sqrt(sq / (xs.length - 1));
}

/** Mean and 95% CI of per-hand bb, expressed in bb/100. */
export function interval(perHandBb: number[]): Interval {
  const mu = mean(perHandBb);
  const sd = stdev(perHandBb, mu);
  const se = sd / Math.sqrt(perHandBb.length);
  return {
    mean: mu * 100,
    se: se * 100,
    lo95: (mu - Z95 * se) * 100,
    hi95: (mu + Z95 * se) * 100,
    sigmaHandBb: sd,
    sigmaPer100Hands: sd * 10,
    n: perHandBb.length,
  };
}

/**
 * Paired difference a − b in bb/100. Valid only because hand i is literally the same deal and the
 * same villain luck for both policies (see harness.ts); the pairing removes the deal variance that
 * dominates the unpaired interval.
 */
export function pairedDifference(a: number[], b: number[]): Interval {
  if (a.length !== b.length) throw new Error(`paired arrays differ in length: ${a.length} vs ${b.length}`);
  const diffs = a.map((x, i) => x - b[i]);
  return interval(diffs);
}

export const fmt = (x: number): string => (x >= 0 ? `+${x.toFixed(1)}` : x.toFixed(1));

export function ciText(iv: Interval): string {
  return `${fmt(iv.mean)} [${fmt(iv.lo95)}, ${fmt(iv.hi95)}]`;
}

/** A difference is inside the noise band when its 95% CI straddles zero. */
export function separates(iv: Interval): boolean {
  return iv.lo95 > 0 || iv.hi95 < 0;
}

/** Hands needed for a two-sided 95% CI of half-width `halfWidthBb100` bb/100 at the observed per-hand σ. */
export function handsForHalfWidth(sigmaHandBb: number, halfWidthBb100: number): number {
  return Math.ceil(((Z95 * sigmaHandBb * 100) / halfWidthBb100) ** 2);
}
