/**
 * Exact (Clopper-Pearson) binomial confidence bands for a counted frequency: k of n. The band is the set
 * of true rates p under which seeing k would not be in either tail beyond (1 - level) / 2. Conservative:
 * it covers the true rate at least `level` of the time, whatever n is, which is the point at 20 hands.
 *
 * Computed by bisection on the binomial tail, summed in log space (lgamma), so n in the tens of thousands
 * neither overflows nor underflows. Pure.
 */

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** ln Γ(x) for x > 0 (Lanczos, g = 7): good to ~15 digits. */
export function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const z = x - 1;
  let a = 0.99999999999980993;
  const t = z + 7.5;
  for (let i = 0; i < 8; i++) a += LANCZOS[i] / (z + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

function lnChoose(n: number, k: number): number {
  return lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1);
}

/** P(X <= k) for X ~ Binomial(n, p). */
export function binomialCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (p <= 0) return 1;
  if (p >= 1) return 0;
  const lp = Math.log(p);
  const lq = Math.log1p(-p);
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += Math.exp(lnChoose(n, i) + i * lp + (n - i) * lq);
  return Math.min(1, sum);
}

function bisect(f: (p: number) => boolean): number {
  // f is true at 0 and false at 1 (monotone); returns the boundary.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid)) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface Band {
  readonly low: number;
  readonly high: number;
}

/** The exact two-sided `level` band for k successes in n trials. n = 0 is the whole interval. */
export function clopperPearson(k: number, n: number, level = 0.9): Band {
  if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0 || k < 0 || k > n) throw new RangeError(`k ${k} of n ${n}`);
  if (n === 0) return { low: 0, high: 1 };
  const tail = (1 - level) / 2;
  // low: the p where P(X >= k) = tail, i.e. 1 - cdf(k - 1) = tail. P(X >= k) rises with p.
  const low = k === 0 ? 0 : bisect((p) => 1 - binomialCdf(k - 1, n, p) < tail);
  // high: the p where P(X <= k) = tail. P(X <= k) falls with p.
  const high = k === n ? 1 : bisect((p) => binomialCdf(k, n, p) > tail);
  return { low, high };
}
