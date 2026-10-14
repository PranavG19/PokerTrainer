/**
 * The Reps award ledger: effort points for learning actions, never spent (VISION §4).
 *
 * Every award carries a KEY naming the one event it pays for (`hand:<playedAt>`, `puzzle:<id>:<day>` …), and
 * `award` is idempotent on it: the same event delivered twice (a re-render, a retried save, a replayed callback)
 * pays once. The rules below take only the learning facts they pay for. Table stacks, pots, showdowns and a correct
 * verdict are not parameters of any rule, so nothing here can pay for a result (the "stacks earn 0" rule holds by
 * type; habit-core.test pins it).
 *
 * Pure: no clock. The caller passes the day the award belongs to.
 */

import type { DayKey } from '../localDay.js';
import { reps, type Reps } from '../units.js';
import { MAX_REP_AWARDS } from './persist.js';
import type { RepAward, RepsState } from './types.js';

/** A graded decision with a full commit (VISION §4: 10, plus 3 for any reason line, flat). */
export const REPS_PER_DECISION = 10;
export const REPS_PER_REASON = 3;
/** One graded drill rep on a concept that is still being learned, or due. A mastered concept not due pays 0. */
export const REPS_PER_DRILL_REP = 10;
/** One step of a puzzle spot played right. */
export const REPS_PER_SPOT_STEP = 10;
export const REPS_RULE_ACCEPTED = 20;
export const REPS_RULE_ATTEMPTED = 5;
export const REPS_ASSESSMENT = 80;
export const REPS_CONTRAST_SET = 25;
/** One graded perception-drill response (Speed). */
export const REPS_PER_PERCEPTION = 2;

/** The longest key the profile keeps (persist.ts ids are at most 64 characters). */
const MAX_KEY_CHARS = 64;

/**
 * Pay `amount` for the event named `key`, once. A key already in the log changes nothing; a non-positive or
 * non-finite amount records nothing (an award of 0 is no award). The log is bounded, newest last; the lifetime
 * total is kept separately because the log forgets.
 */
export function award(state: RepsState, key: string, amount: number, day: DayKey): RepsState {
  if (key.length === 0 || key.length > MAX_KEY_CHARS) return state;
  if (!(Number.isFinite(amount) && amount > 0)) return state;
  if (state.awards.some((a) => a.key === key)) return state;
  const entry: RepAward = { key, reps: reps(Math.round(amount)), day };
  return {
    total: reps(state.total + entry.reps),
    awards: [...state.awards, entry].slice(-MAX_REP_AWARDS),
  };
}

/** True when the event named `key` has been paid (within the bounded log). */
export function awarded(state: RepsState, key: string): boolean {
  return state.awards.some((a) => a.key === key);
}

/** Reps logged on one day. */
export function repsOn(state: RepsState, day: DayKey): Reps {
  return reps(state.awards.filter((a) => a.day === day).reduce((sum, a) => sum + a.reps, 0));
}

// ── The rules: what each learning action pays ───────────────────────────────────────────────────────

/** A hero decision as a hand records it: graded or not, and whether a reason was written at the gate. */
export interface DecisionEffort {
  /** The coach graded it (a verdict is on record). */
  readonly graded: boolean;
  /** Reason attempts at the gate (absent = the gate never opened). */
  readonly gateAttempts?: 0 | 1 | 2;
}

/** A hand pays for its graded decisions and the reasons written for them, never for the chips. */
export function repsForHand(decisions: readonly DecisionEffort[]): number {
  let total = 0;
  for (const d of decisions) {
    if (!d.graded) continue;
    total += REPS_PER_DECISION;
    if (d.gateAttempts !== undefined && d.gateAttempts > 0) total += REPS_PER_REASON;
  }
  return total;
}

/**
 * One graded drill rep. A concept the scheduler calls mastered and not due pays nothing (VISION §4: "mastered items
 * that aren't due: 0"), so grinding what is already known earns no Reps.
 */
export function repsForDrillRep(conceptMasteredAndNotDue: boolean): number {
  return conceptMasteredAndNotDue ? 0 : REPS_PER_DRILL_REP;
}

/** A finished puzzle spot pays for the steps played right. */
export function repsForSpot(stepsRight: number): number {
  return Math.max(0, Math.floor(stepsRight)) * REPS_PER_SPOT_STEP;
}

/** A rule sentence: accepted pays more than attempted, and an attempt still pays (writing it is the work). */
export function repsForRule(accepted: boolean): number {
  return accepted ? REPS_RULE_ACCEPTED : REPS_RULE_ATTEMPTED;
}

// ── Keys ────────────────────────────────────────────────────────────────────────────────────────────

export const keys = {
  hand: (playedAt: number): string => `hand:${playedAt}`,
  drill: (conceptId: string, at: number): string => `drill:${at}:${conceptId}`.slice(0, MAX_KEY_CHARS),
  spot: (scenarioId: string, day: DayKey): string => `spot:${day}:${scenarioId}`.slice(0, MAX_KEY_CHARS),
  rule: (conceptId: string, at: number): string => `rule:${at}:${conceptId}`.slice(0, MAX_KEY_CHARS),
  assessment: (at: number): string => `assessment:${at}`,
  perception: (day: DayKey, n: number): string => `speed:${day}:${n}`,
} as const;
