/**
 * BOARD-READING DRILL (7-cards-to-best-5) — pure question generation + timed grading.
 *
 * The very first perceptual skill the spine names is reading your made hand instantly: PRODUCT-SPEC
 * Phase 1 ("Eyes") sets "7-cards-to-best-5 under 2s" as the fluency floor, and the best-five-from-seven
 * lesson teaches it — but nothing DRILLS it under time pressure. A learner who cannot see "that is a
 * straight, not two pair" at a glance misgrades every downstream equity and price decision, so this is
 * the base the rest of the trainer assumes. This module poses seven cards (the hero's two plus a full
 * five-card board) and asks for the resulting hand category.
 *
 * HONESTY — no fabricated data. The answer key is `evaluate()` (evaluate.ts), the deterministic
 * best-5-of-7 hand-ranker the live engine already uses to settle showdowns. The category is the RULES
 * OF POKER, graded by equality — there is no solver frequency, no equity, no provenance number anywhere
 * here. The stimulus is a uniform random seven-card draw (real card frequencies, no authored bias that
 * would be a judgement call), so the drill is fully determined by the seed.
 *
 * The fluency gate reuses anomaly.ts's RT_THRESHOLD_MS — the same 2s that spec Phase 1 names for this
 * exact skill — so "fast" means one thing across every timed drill and cannot drift.
 */

import type { Card } from './cards.js';
import { shuffledDeck } from './cards.js';
import { evaluate, HandCategory } from './evaluate.js';
import type { Rng } from './rng.js';
import { RT_THRESHOLD_MS } from './anomaly.js';

/** One posed board: the hero's two cards, the five-card board, and the made-hand category (the truth). */
export interface BoardReadingQuestion {
  readonly hole: readonly [Card, Card];
  readonly board: readonly [Card, Card, Card, Card, Card];
  /** The best-5-of-7 category, straight from evaluate() — the rules of poker, never fabricated. */
  readonly category: HandCategory;
}

/**
 * Draw the next question: a uniform seven-card deal off a seeded shuffle, categorised by evaluate().
 * Consumes exactly one shuffle worth of rng() calls, so the sequence stays seed-determined (same
 * contract as the other drills). No bias toward "interesting" hands — the honest distribution is the
 * real one, and biasing it would be an authored judgement call this module refuses to make.
 */
export function nextQuestion(rng: Rng): BoardReadingQuestion {
  const deck = shuffledDeck(rng);
  const hole: [Card, Card] = [deck[0], deck[1]];
  const board: [Card, Card, Card, Card, Card] = [deck[2], deck[3], deck[4], deck[5], deck[6]];
  const category = evaluate([...hole, ...board]).category;
  return { hole, board, category };
}

/** The learner's answer and how it graded, with the truth so the caller can render feedback. */
export interface BoardReadingVerdict {
  /** Named the right category. */
  readonly correct: boolean;
  /** Answered inside the fluency gate. */
  readonly fast: boolean;
  /** A fluency PASS is correct AND fast — both, always (mirrors anomaly.ts scoreResponse). */
  readonly pass: boolean;
  /** What the learner picked. */
  readonly chosen: HandCategory;
  /** The truth, so the caller renders "that was a Straight" without recomputing. */
  readonly category: HandCategory;
}

/**
 * Grade an answer against the question's own truth and the fluency gate. Pure; no state. `rtMs` is the
 * learner's reaction time in milliseconds; `thresholdMs` defaults to the shared 2s Phase-1 gate.
 */
export function grade(
  question: BoardReadingQuestion,
  chosen: HandCategory,
  rtMs: number,
  thresholdMs: number = RT_THRESHOLD_MS,
): BoardReadingVerdict {
  const correct = chosen === question.category;
  const fast = rtMs <= thresholdMs;
  return { correct, fast, pass: correct && fast, chosen, category: question.category };
}
