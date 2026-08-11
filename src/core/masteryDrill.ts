/**
 * MASTERY-WEIGHTED CLASS SAMPLING for the preflop chart drill.
 *
 * The drill teaches by hand class — six chunks a learner recites (premium … trash). A fixed
 * round-robin over the six spends equal reps on the class already aced and the one still being
 * failed. Memorisation wants the opposite: draw the WEAK and the UNSEEN more often, while never
 * STARVING a mastered class (spaced recall needs the occasional rep to keep it fresh). This module
 * turns each class's running tally into a draw weight and picks a class; picking the combo WITHIN a
 * class stays uniform (that is the renderer's job). Everything here is pure and rng-driven, so the
 * drill sequence is still fully determined by the seed plus the learner's keystrokes.
 */

import type { Rng } from './rng.js';

export interface ClassTally {
  readonly attempts: number;
  readonly correct: number;
}

/**
 * The weight knobs, chosen so the three properties the drill needs all hold:
 *  - FLOOR_WEIGHT is the lower bound every seen class keeps, so even a fully mastered class still
 *    recurs rather than dropping out of the rotation.
 *  - UNSEEN_WEIGHT outranks any seen class's weight (its ceiling is FLOOR_WEIGHT + MISS_SCALE), so a
 *    class with no baseline yet is drilled before the drill fine-tunes classes it already has data on.
 *  - MISS_SCALE scales the extra weight a class earns for missing, and PRIOR_ATTEMPTS smooths the
 *    miss rate by that many pseudo-attempts so a lucky 1/1 is not treated as mastered after one rep.
 */
const FLOOR_WEIGHT = 1;
const UNSEEN_WEIGHT = 5;
const MISS_SCALE = 4;
const PRIOR_ATTEMPTS = 2;

/** The draw weight for one class from its tally. Always ≥ FLOOR_WEIGHT, so no class is ever starved. */
export function classDrawWeight(tally: ClassTally): number {
  if (tally.attempts <= 0) return UNSEEN_WEIGHT;
  const misses = Math.max(0, tally.attempts - tally.correct);
  // +1 miss / +PRIOR_ATTEMPTS attempts: Laplace-style smoothing so few-attempt classes stay elevated
  // until enough evidence accrues, and a class with more misses always outweighs one with fewer.
  const smoothedMissRate = (misses + 1) / (tally.attempts + PRIOR_ATTEMPTS);
  return FLOOR_WEIGHT + MISS_SCALE * smoothedMissRate;
}

/**
 * Pick an index into `tallies` with probability proportional to each class's draw weight, consuming
 * exactly one rng() call. Returns 0 for an empty list so the caller never indexes undefined.
 */
export function pickWeightedClass(tallies: readonly ClassTally[], rng: Rng): number {
  if (tallies.length === 0) return 0;
  const weights = tallies.map(classDrawWeight);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let threshold = rng() * total;
  for (let index = 0; index < weights.length; index += 1) {
    threshold -= weights[index];
    if (threshold < 0) return index;
  }
  // rng() at the 1.0 edge, or floating-point drift, lands past the last boundary: fall to the last.
  return weights.length - 1;
}

/**
 * The index of the class the drill is drilling hardest AMONG THOSE ATTEMPTED — the one to review.
 * Ranked by the same draw weight the sampler uses (for an attempted class that is monotonic in miss
 * rate), so the marker matches why the class actually keeps coming up. Unseen classes are excluded:
 * one has the highest weight of all but "you have not tried it yet" is not "you keep missing it", and
 * labelling a "—" row as a weakness would be a lie. Returns null when nothing has been attempted, and
 * on a tie the earlier (stronger-named) class wins so the marker never flickers between equals.
 */
export function weakestAttemptedClass(tallies: readonly ClassTally[]): number | null {
  let best: number | null = null;
  let bestWeight = -Infinity;
  for (let index = 0; index < tallies.length; index += 1) {
    if (tallies[index].attempts <= 0) continue;
    const weight = classDrawWeight(tallies[index]);
    if (weight > bestWeight) {
      bestWeight = weight;
      best = index;
    }
  }
  return best;
}
