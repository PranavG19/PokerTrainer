/**
 * THE CLOSE-SPOT BAND — how sure the grader is before it calls a decision a mistake.
 *
 * The grader compares one Monte Carlo pot share against a line (the price of a call, or a heuristic
 * line on an unpriced spot). Both sides of that comparison are uncertain:
 *
 *  1. SAMPLING ERROR. At DISPLAY_ITERATIONS = 2000 the pot share of a 50% hand has a standard error of
 *     about 1.1 points, so a 95% interval is about ±2.2 points. Re-seeding the same spot moves the
 *     estimate by that much, and a verdict that flips on a re-seed is noise, not advice.
 *  2. MODEL ERROR. The villain is a modelled range (villainRanges.ts) or a random field, never the
 *     villain's real cards, and the unpriced lines (0.35, 0.55) are heuristics. An error of a couple of
 *     points in the range model moves the pot share by about as much as the sampling does.
 *
 * So the band is the sampling half-width at 95% plus a fixed model margin. A decision whose pot share
 * sits inside the band around its line is CLOSE: the grader cannot tell the two actions apart at the
 * precision it has. A close spot is neither a mistake nor praise. It costs nothing (evLossBb 0), never
 * opens the gate, never files a leak, and is exposed on `Grade.close` so later features (the planned
 * "Price held") can tell a close spot played on the right side of the estimate from a clear one.
 *
 * Pure and total: no clock, no randomness.
 */
import type { EquityResult } from './equity.js';

/** Two-sided 95% normal quantile. */
export const CLOSE_Z = 1.96;

/**
 * Pot-share points added for the opponent model. 2.5 points: the order of the shift a one-step change in
 * an archetype's value threshold makes on a typical graded spot, and the domain review's "about 2.5
 * points, widened by a range-model margin". It is a judgement, pinned by a test so it moves on purpose.
 */
export const MODEL_MARGIN = 0.025;

/**
 * The 95% sampling half-width of a Monte Carlo pot share (win + tie/2). Each trial scores 1, 1/2 or 0,
 * so the per-trial variance is E[s^2] - p^2 = win + tie/4 - p^2, exact for the estimator rather than the
 * p(1-p) upper bound. Zero or negative iterations give an infinite band: no sample, no opinion.
 */
export function samplingHalfWidth(eq: EquityResult, z: number = CLOSE_Z): number {
  if (!(eq.iterations > 0)) return Number.POSITIVE_INFINITY;
  const p = eq.win + eq.tie * 0.5;
  const variance = Math.max(0, eq.win + eq.tie * 0.25 - p * p);
  return z * Math.sqrt(variance / eq.iterations);
}

/** The full band: sampling half-width plus the model margin. */
export function closeBand(eq: EquityResult): number {
  return samplingHalfWidth(eq) + MODEL_MARGIN;
}

/** True when `share` is within `band` of `line`. A non-finite input is never close: it is no grade at all. */
export function isClose(share: number, line: number, band: number): boolean {
  if (!Number.isFinite(share) || !Number.isFinite(line) || Number.isNaN(band)) return false;
  return Math.abs(share - line) <= band;
}
