/**
 * REFERENCE REACH — the frozen population rw.ts (G2) reach-weights study priority against, plus the
 * glue that turns graded hero decisions into rw.ts `ClassDecision`s.
 *
 * rw.ts is deliberately data-free: it takes a `ReachTable` and never decides what reach IS. The spec
 * says that table ships in the solver bank against a frozen reference population (rw.ts guarantee 2,
 * bank.ts `NodeProvenance.referencePopId`). No solver bank is built yet (bank.ts:`EMPTY_BANK_INDEX`
 * is honest about that), so this module supplies the reference reach the feature needs to exist at
 * all — as explicitly AUTHORED ordinal estimates, not solver-measured frequencies.
 *
 * WHY AUTHORING THESE IS NOT THE FABRICATION bank.ts REFUSES. bank.ts refuses to fabricate a GRADE,
 * because a made-up grade is false feedback presented in the typography of an intuition (B4, story
 * 27). Reach here NEVER grades a decision and never appears as a per-decision number: it only ORDERS
 * which class the learner studies next. An approximate ordering ("you face flop c-bets far more often
 * than river bluff-catches") is a reasonable study-prioritisation heuristic, not a fabricated
 * measurement of any one spot. The `referencePopId` marks it as v1 authored data so a later
 * solver-derived table is a clean, auditable swap (a bank version bump, G2), not a silent redefinition.
 *
 * The one hard invariant: every (street × coach principle) a decision can carry MUST have a reach
 * here, because `reachWeightedLoss` throws on a decided class with no reach (its "fail loudly"
 * guarantee). The reachRef test pins that coverage against the coach's principle vocabulary.
 */

import { classKey, reachTable, type ClassDecision, type ClassReach, type ReachTable } from './rw.js';
import type { Street } from './table.js';

/** v1 AUTHORED reference reach — see the module header. Swapping in solver-derived reach bumps this. */
export const REFERENCE_POP_ID = 'authored-street-class-v1';

/**
 * P(a decision of this class occurs per hand dealt), authored per (street × coach principle). Two
 * ordinal claims shape the numbers: reach decays down the streets (fewer hands survive to the turn
 * than see a flop), and preflop range decisions are the most frequent class of all (you make a
 * preflop range call every hand you are dealt in). These are estimates, not measurements.
 */
const REACH_ENTRIES: readonly ClassReach[] = [
  { street: 'preflop', actionClass: 'pot odds', reach: 0.6 },
  { street: 'preflop', actionClass: 'ranges', reach: 0.9 },
  { street: 'preflop', actionClass: 'value or bluff', reach: 0.5 },
  { street: 'flop', actionClass: 'pot odds', reach: 0.5 },
  { street: 'flop', actionClass: 'ranges', reach: 0.3 },
  { street: 'flop', actionClass: 'value or bluff', reach: 0.4 },
  { street: 'turn', actionClass: 'pot odds', reach: 0.35 },
  { street: 'turn', actionClass: 'ranges', reach: 0.15 },
  { street: 'turn', actionClass: 'value or bluff', reach: 0.3 },
  { street: 'river', actionClass: 'pot odds', reach: 0.25 },
  { street: 'river', actionClass: 'ranges', reach: 0.1 },
  { street: 'river', actionClass: 'value or bluff', reach: 0.2 },
];

export const REFERENCE_REACH: ReachTable = reachTable(REFERENCE_POP_ID, REACH_ENTRIES);

/**
 * One graded hero decision, reduced to what reach-weighting needs: the street it happened on, the
 * coach principle behind the grade (the action class), and the ΔEV the coach charged. Built in the
 * composition root from persisted `DecisionRecord` verdicts; free spots (principle null) are excluded
 * upstream, exactly as they are for the raw-cost leak tally.
 */
export interface GradedDecision {
  readonly street: Street;
  readonly principle: string;
  readonly deltaEvBb: number;
}

/**
 * Map graded decisions to rw.ts `ClassDecision`s, DROPPING any whose (street × principle) class is not
 * in the reference table. rw.ts throws on a decided class with no reach — the right behaviour for a
 * bank/taxonomy mismatch at build time — but on the live Home path an unexpected class (a legacy
 * `showdown` decision, a principle a future coach adds) must not crash the recommendation. Dropping it
 * only understates that class's study priority to zero, which is recoverable; throwing on Home is not.
 */
export function classDecisionsFor(
  graded: readonly GradedDecision[],
  reach: ReachTable = REFERENCE_REACH,
): ClassDecision[] {
  const decisions: ClassDecision[] = [];
  for (const g of graded) {
    if (!reach.byClass.has(classKey(g.street, g.principle))) continue;
    decisions.push({ street: g.street, actionClass: g.principle, deltaEvBb: g.deltaEvBb });
  }
  return decisions;
}
