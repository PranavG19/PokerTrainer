/**
 * SPOT TYPE — state 1 of the five-state protocol (PRODUCT-SPEC G5a): the learner names the kind of
 * spot before acting, and the app NEVER labels it for them. This module supplies the closed set the
 * learner picks from and the CORRECT answer, derived purely from the betting geometry — so it can be
 * scored independently of whether their action was right (the whole point: classification is its own
 * sub-skill, and lesson headings that pre-classify delete it).
 *
 * v1 is PREFLOP ONLY, on purpose. Preflop spot type is a pure function of what has happened in the
 * betting — how many voluntary raises are in, and whether a cold-caller sits between the last raiser
 * and the hero — with NO hand-strength judgement. That keeps the "correct" answer honest and
 * uncontestable. Postflop types (c-bet / bluff-catch / probe / barrel) depend on hand strength and
 * board texture, where the single correct label is genuinely arguable; classifying those is deferred
 * rather than faked. When the hero faces a postflop spot the type is 'postflop', a single honest
 * bucket, and the classify step is simply not asked (the caller checks isClassifiable).
 */

import type { TableState } from './table.js';

/** The closed set a learner may pick from preflop. Kept small and unambiguous. */
export type SpotType = 'rfi' | 'defend' | '3bet-response' | 'squeeze' | 'postflop';

/** Human labels for the picker — the learner sees these, never the app's own answer beforehand. */
export const SPOT_TYPE_LABELS: Record<SpotType, string> = {
  rfi: 'Open (first in)',
  defend: 'Facing a raise',
  '3bet-response': 'Facing a 3-bet',
  squeeze: 'Raise + caller (squeeze)',
  postflop: 'Postflop',
};

/** The preflop picker set, in teaching order. 'postflop' is excluded — it is not asked postflop. */
export const PREFLOP_SPOT_TYPES: readonly SpotType[] = ['rfi', 'defend', '3bet-response', 'squeeze'];

/**
 * Count the voluntary preflop raises in the log so far. A "raise" here is any `raises to` or `bets`
 * entry — the blinds are posts, not raises, and are never logged as either, so the first raise is the
 * open. Reading the log rather than re-deriving from chips keeps this aligned with what actually
 * happened at the table (applyAction is the single writer of these lines).
 */
function preflopRaiseCount(state: TableState): number {
  let raises = 0;
  for (const line of state.log) {
    if (line.includes(' raises to ') || / bets \d+$/.test(line)) raises += 1;
  }
  return raises;
}

/** Whether at least one player has voluntarily CALLED a raise preflop (a cold-call), = a squeeze spot
 *  when the hero then faces it with a raise still standing. */
function hasColdCaller(state: TableState): boolean {
  // A call logged after the first raise line is a cold-call. Blinds post before any raise, so a "calls"
  // line only appears once there is a bet to call — which preflop means a raise is already in.
  let seenRaise = false;
  for (const line of state.log) {
    if (line.includes(' raises to ') || / bets \d+$/.test(line)) seenRaise = true;
    else if (seenRaise && line.includes(' calls ')) return true;
  }
  return false;
}

/**
 * True when the current spot has a single honest correct classification to ask for — preflop only in
 * v1. Postflop, the caller should skip the classify step rather than ask a question with a debatable
 * answer.
 */
export function isClassifiable(state: TableState): boolean {
  return state.street === 'preflop';
}

/**
 * The correct spot type for the state the hero is about to act in. Derived purely from the betting:
 *  - preflop, no raise yet → RFI (the hero can open first-in)
 *  - preflop, one raise, no cold-caller → DEFEND (facing a single open)
 *  - preflop, one raise WITH a cold-caller → SQUEEZE (raise + caller in front)
 *  - preflop, two or more raises → 3BET-RESPONSE (facing a 3-bet-or-more)
 *  - any postflop street → 'postflop' (the single honest bucket; classify is not asked)
 */
export function correctSpotType(state: TableState): SpotType {
  if (state.street !== 'preflop') return 'postflop';
  const raises = preflopRaiseCount(state);
  if (raises === 0) return 'rfi';
  if (raises === 1) return hasColdCaller(state) ? 'squeeze' : 'defend';
  return '3bet-response';
}

/** A learner's classification, scored independently of their action (G5a). */
export interface SpotTypeVerdict {
  readonly picked: SpotType;
  readonly correct: SpotType;
  readonly right: boolean;
}

export function gradeSpotType(state: TableState, picked: SpotType): SpotTypeVerdict {
  const correct = correctSpotType(state);
  return { picked, correct, right: picked === correct };
}
