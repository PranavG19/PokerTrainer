/**
 * HAND-READING DRILL (preflop range narrowing) — pure question generation + grading.
 *
 * The first read a player must learn is "given they OPENED from this position, what can they hold?"
 * This drill poses exactly that: an opener raises first-in from a position, and the learner judges
 * whether a shown combo is in that opener's range.
 *
 * HONESTY — no fabricated ranges. The answer key is the app's OWN, already-authored, rule-stated RFI
 * range (`isInRfiRange` / `rfiCombos` in preflop.ts, generated from the thresholds the rules teach).
 * This module invents no solver output and no probabilities: it reuses the same range the Charts RFI
 * drill teaches, so "in range" here and "raise" there are the identical fact. A tight UTG open really
 * does exclude 72o; that exclusion is the rule, not a guess.
 *
 * Everything here is pure and rng-driven, so the drill sequence is fully determined by the seed plus
 * the learner's answers — same contract as the other drills (masteryDrill/defenseDrill).
 */

import type { Rng } from './rng.js';
import {
  ALL_COMBOS,
  RFI_POSITIONS,
  THREEBET_RESPONSE_WIDTH_ORDER,
  defenseAction,
  isInRfiRange,
  threeBetResponseAction,
  type Combo,
  type DefensePosition,
  type RfiPosition,
  type ThreeBetResponsePosition,
} from './preflop.js';

/**
 * Which read the question poses (all keyed on the OPENER's `position`; every key is one of the app's OWN
 * rule-stated ranges — no fabrication, no solver data):
 *  - 'open'       — they OPENED first-in; range = the RFI range (isInRfiRange).
 *  - 'flat-3bet'  — they opened, then FLAT-CALLED a 3-bet; range = the CAPPED continue range, the combos
 *                   whose 3-bet response is 'call' (they'd have 4-bet AA/KK/AK, folded the trash).
 *  - 'bb-defend'  — the BB FLAT-CALLED this opener (rather than 3-betting or folding); range = the combos
 *                   whose defense action is 'call' — the BB's flat range, which excludes the 3-bet hands
 *                   at the top and the folds at the bottom (a different cap than flat-3bet).
 */
export type ReadScenario = 'open' | 'flat-3bet' | 'bb-defend';

/** The BB-defense spot for an opener the BB faces — every RFI seat has a matching bb-vs-{opener} spot. */
const BB_DEFENSE_SPOT: Record<RfiPosition, DefensePosition> = {
  UTG: 'bb-vs-utg',
  HJ: 'bb-vs-hj',
  CO: 'bb-vs-co',
  BTN: 'bb-vs-btn',
  SB: 'bb-vs-sb',
};

/** One posed question: does `combo` belong to the villain's range in this `scenario` from `position`? */
export interface HandReadingQuestion {
  readonly scenario: ReadScenario;
  readonly position: RfiPosition;
  readonly combo: Combo;
  /** The correct answer, derived from the app's own range rule — never fabricated. */
  readonly inRange: boolean;
}

/**
 * Whether `combo` is in the villain's range for a scenario+position, straight from the app's rules.
 * 'open' → the RFI range. 'flat-3bet' → the CAPPED range: exactly the flat-call combos (4-bets and folds
 * are excluded — that is what makes a flat-called range capped, the read the drill teaches).
 */
export function inReadRange(scenario: ReadScenario, combo: Combo, position: RfiPosition): boolean {
  if (scenario === 'open') return isInRfiRange(combo, position);
  if (scenario === 'bb-defend') return defenseAction(combo, BB_DEFENSE_SPOT[position]) === 'call';
  // flat-3bet is only defined for the four opener seats that have a 3-bet-response range.
  if (!THREEBET_RESPONSE_WIDTH_ORDER.includes(position as ThreeBetResponsePosition)) return false;
  return threeBetResponseAction(combo, position as ThreeBetResponsePosition) === 'call';
}

/** The learner's answer and how it graded, plus the truth for the feedback line. */
export interface HandReadingVerdict {
  readonly correct: boolean;
  /** What the learner said. */
  readonly answeredInRange: boolean;
  /** The truth, so the caller can render "AKo IS in a BTN open" without recomputing. */
  readonly inRange: boolean;
}

/**
 * The combos that are ONE rank off the range edge for a position — the honest hard cases. A question
 * drawn only from deep-in-range (AA) or deep-out (72o) hands is a gimme; the teaching value is at the
 * boundary, where a combo's neighbour lands on the other side. We surface those by asking preflop.ts
 * itself: a combo is "near the edge" for a position when it is in the range but at least one of its
 * rank-adjacent combos is out (or vice versa). Kept pure/derived, so it can never drift from the range.
 *
 * We do not hand-list edges (that would be a second source of truth to maintain); instead the sampler
 * biases toward boundary combos: nextQuestion draws from this set with probability edgeBias. This
 * function is exported for the test to pin that edges exist and are a strict subset of all combos.
 */
export function edgeCombos(scenario: ReadScenario, position: RfiPosition): readonly Combo[] {
  const inRange = new Set(ALL_COMBOS.filter((c) => inReadRange(scenario, c, position)));
  return ALL_COMBOS.filter((combo) => {
    const here = inRange.has(combo);
    return neighbours(combo).some((n) => inRange.has(n) !== here);
  });
}

/**
 * Rank-adjacent combos of the same shape (pair/suited/offsuit): the hands one step away on a range
 * chart. A78s's neighbours are A6s/A8s (and the pair/kicker steps), so "is this the edge" means "does
 * a chart-neighbour fall on the other side of the line". Pure string surgery on the two-or-three-char
 * combo id; unknown shapes yield no neighbours (so they are never treated as an edge).
 */
function neighbours(combo: Combo): Combo[] {
  const ranks = 'AKQJT98765432';
  const stepRank = (r: string, by: number): string | null => {
    const i = ranks.indexOf(r);
    if (i < 0) return null;
    const j = i + by;
    return j >= 0 && j < ranks.length ? ranks[j] : null;
  };
  // Pair "QQ": step both ranks together.
  if (combo.length === 2 && combo[0] === combo[1]) {
    return [-1, 1]
      .map((by) => stepRank(combo[0], by))
      .filter((r): r is string => r !== null)
      .map((r) => `${r}${r}`);
  }
  // Suited/offsuit "AKs"/"AKo": step the LOW card (the kicker), keeping hi + suitedness.
  if (combo.length === 3) {
    const [hi, lo, s] = combo;
    return [-1, 1]
      .map((by) => stepRank(lo, by))
      .filter((r): r is string => r !== null && r !== hi) // lo must stay below hi and not equal it
      .map((r) => `${hi}${r}${s}`)
      .filter((c) => ALL_COMBOS.includes(c));
  }
  return [];
}

/**
 * Draw the next question. `edgeBias` in [0,1] is the probability the combo is drawn from the boundary
 * set (the hard cases) rather than the whole range; the position is always uniform over the five RFI
 * seats. Consumes at most three rng() calls (position, edge-or-any, combo index), so the sequence stays
 * seed-determined. Falls back to a uniform combo when a position somehow has no edges (never happens for
 * the real ranges, but keeps the function total).
 */
const SCENARIOS: readonly ReadScenario[] = ['open', 'flat-3bet', 'bb-defend'];

export function nextQuestion(rng: Rng, edgeBias = 0.7): HandReadingQuestion {
  // Rotate evenly over the three reads with one rng() call, so the mix is seed-determined and every
  // concept recurs (open, the capped flat-3bet range, the BB flat-defense range).
  const scenario = SCENARIOS[Math.floor(rng() * SCENARIOS.length)];
  // flat-3bet only applies to the four opener seats with a 3-bet-response range (no SB there); 'open' and
  // 'bb-defend' both use all five RFI seats (every opener has a bb-vs-{opener} defense spot).
  const seats: readonly RfiPosition[] =
    scenario === 'flat-3bet' ? (THREEBET_RESPONSE_WIDTH_ORDER as readonly RfiPosition[]) : RFI_POSITIONS;
  const position = seats[Math.floor(rng() * seats.length)];
  const useEdge = rng() < edgeBias;
  const pool = useEdge ? edgeCombos(scenario, position) : ALL_COMBOS;
  const source = pool.length > 0 ? pool : ALL_COMBOS;
  const combo = source[Math.floor(rng() * source.length)];
  return { scenario, position, combo, inRange: inReadRange(scenario, combo, position) };
}

/** Grade an answer against the question's own truth. Pure; no state. */
export function grade(question: HandReadingQuestion, answeredInRange: boolean): HandReadingVerdict {
  return {
    correct: answeredInRange === question.inRange,
    answeredInRange,
    inRange: question.inRange,
  };
}
