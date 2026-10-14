/**
 * Milestones: fixed, fact-labelled and shown in advance (VISION Pillars 3 and 9). Nothing is random and nothing is
 * bought: each one names the decision or the habit that earns it, and how far along the learner is.
 *
 * Three families, one material each in the Trophy room: DECISION (bone: a decision you made), DEPTH (glass: a table
 * certified, career.ts's ids) and HABIT (graphite: the streak and the Ticket). A milestone is a ratchet: once its
 * receipt is written (`milestones.achieved`, the first day it held) it is never taken back, even if the measure
 * later falls (a streak resets; a concept decays).
 *
 * The measures read only process facts. No chips, pots, results or bb won appear in `MilestoneFacts`, so no
 * milestone can be earned by a result (Profile shows decisions, never results).
 *
 * Pure: the caller passes the facts and the day.
 */

import type { DayKey } from '../localDay.js';
import type { Depth } from '../standing.js';
import type { MilestonesState } from './types.js';

export type MilestoneFamily = 'decision' | 'depth' | 'habit';

export interface MilestoneFacts {
  /** The ratcheted certified depth (session.depthFloor). */
  readonly depthFloor: Depth | number;
  readonly conceptsMastered: number;
  readonly puzzlesSolvedClean: number;
  readonly assessmentsTaken: number;
  /** Rule sentences accepted (lexicon) or saved (lessons), distinct concepts. */
  readonly rulesInYourWords: number;
  /** The longest streak ever (streak.best). */
  readonly bestStreak: number;
  /** "Price held" beats, lifetime (tallies.priceHeld): close-band spots played right with a mechanism reason. */
  readonly priceHeld: number;
  readonly ticketsFinished: number;
  /** Sure predictions, lifetime (session.calibration). */
  readonly sureTotal: number;
  readonly sureRight: number;
}

export interface MilestoneDef {
  readonly id: string;
  readonly family: MilestoneFamily;
  /** The keepsake's name. */
  readonly name: string;
  /** The fact it records, in words. */
  readonly fact: string;
  /** Progress toward it: `value` of `target` (both in the same unit). */
  readonly measure: (f: MilestoneFacts) => { value: number; target: number; unit: string };
}

const count = (value: number, target: number, unit: string) => ({ value: Math.min(value, target), target, unit });

/**
 * Sure calls right, in percent, once there are enough to mean anything. Under 100 Sure calls the honest progress is
 * the count toward 100 (a percentage of 12 calls is noise), and the milestone cannot be met.
 */
function sureMeansSure(f: MilestoneFacts): { value: number; target: number; unit: string } {
  if (f.sureTotal < 100) return { value: f.sureTotal, target: 100, unit: 'Sure calls on record' };
  return count(Math.floor((f.sureRight / f.sureTotal) * 100), 85, '% of Sure calls right');
}

export const MILESTONES: readonly MilestoneDef[] = [
  // Decision: bone.
  { id: 'price-held-first', family: 'decision', name: 'Price Held', fact: 'Held the price on a close spot, said Sure, and named the price', measure: (f) => count(f.priceHeld, 1, 'close spot') },
  { id: 'price-held-10', family: 'decision', name: 'Ten Close Calls', fact: 'Held the price on ten close spots', measure: (f) => count(f.priceHeld, 10, 'close spots') },
  { id: 'first-clean-solve', family: 'decision', name: 'Clean Solve', fact: 'Solved a puzzle with no mistakes', measure: (f) => count(f.puzzlesSolvedClean, 1, 'puzzle') },
  { id: 'clean-solves-5', family: 'decision', name: 'Five Clean', fact: 'Solved 5 puzzles clean', measure: (f) => count(f.puzzlesSolvedClean, 5, 'puzzles') },
  { id: 'rules-1', family: 'decision', name: 'First Rule', fact: 'Wrote a rule in your own words', measure: (f) => count(f.rulesInYourWords, 1, 'rule') },
  { id: 'rules-12', family: 'decision', name: 'Twelve Rules', fact: 'Wrote 12 rules in your own words', measure: (f) => count(f.rulesInYourWords, 12, 'rules') },
  { id: 'sure-means-sure', family: 'decision', name: 'Sure Means Sure', fact: '85% of Sure calls right over at least 100', measure: sureMeansSure },
  { id: 'first-assessment', family: 'decision', name: 'Measured', fact: 'Completed an assessment block', measure: (f) => count(f.assessmentsTaken, 1, 'block') },
  // Depth: glass. Career's ids, so career.ts and the Trophy room agree.
  { id: 'concepts-2', family: 'depth', name: 'Two Concepts', fact: 'Mastered 2 concepts', measure: (f) => count(f.conceptsMastered, 2, 'concepts') },
  { id: 'concepts-5', family: 'depth', name: 'Five Concepts', fact: 'Mastered 5 concepts', measure: (f) => count(f.conceptsMastered, 5, 'concepts') },
  { id: 'concepts-12', family: 'depth', name: 'Twelve Concepts', fact: 'Mastered 12 concepts', measure: (f) => count(f.conceptsMastered, 12, 'concepts') },
  { id: 'depth-40', family: 'depth', name: 'Forty Deep', fact: 'Certified the 40bb table', measure: (f) => count(f.depthFloor >= 40 ? 1 : 0, 1, 'table') },
  { id: 'depth-75', family: 'depth', name: 'Seventy-Five Deep', fact: 'Certified the 75bb table', measure: (f) => count(f.depthFloor >= 75 ? 1 : 0, 1, 'table') },
  { id: 'depth-125', family: 'depth', name: 'One-Twenty-Five Deep', fact: 'Certified the 125bb table', measure: (f) => count(f.depthFloor >= 125 ? 1 : 0, 1, 'table') },
  { id: 'depth-200', family: 'depth', name: 'Two Hundred Deep', fact: 'Certified the 200bb table', measure: (f) => count(f.depthFloor >= 200 ? 1 : 0, 1, 'table') },
  // Habit: graphite. Counted on the best run, so a reset never takes one back.
  { id: 'streak-7', family: 'habit', name: 'One Week', fact: 'A 7-day streak', measure: (f) => count(f.bestStreak, 7, 'days') },
  { id: 'streak-21', family: 'habit', name: 'Three Weeks', fact: 'A 21-day streak', measure: (f) => count(f.bestStreak, 21, 'days') },
  { id: 'streak-30', family: 'habit', name: 'Thirty Days', fact: 'A 30-day streak', measure: (f) => count(f.bestStreak, 30, 'days') },
  { id: 'ticket-first', family: 'habit', name: 'First Ticket', fact: 'Finished a Ticket', measure: (f) => count(f.ticketsFinished, 1, 'Ticket') },
  { id: 'tickets-20', family: 'habit', name: 'Twenty Tickets', fact: 'Finished 20 Tickets', measure: (f) => count(f.ticketsFinished, 20, 'Tickets') },
];

export function milestoneById(id: string): MilestoneDef | undefined {
  return MILESTONES.find((m) => m.id === id);
}

export function isMet(def: MilestoneDef, facts: MilestoneFacts): boolean {
  const m = def.measure(facts);
  return m.value >= m.target;
}

/** Write a receipt for every milestone met now and not yet on file. Returns the same object when nothing is new. */
export function syncMilestones(state: MilestonesState, facts: MilestoneFacts, day: DayKey): MilestonesState {
  const fresh = MILESTONES.filter((m) => !Object.prototype.hasOwnProperty.call(state.achieved, m.id) && isMet(m, facts));
  if (fresh.length === 0) return state;
  const achieved = { ...state.achieved };
  for (const m of fresh) achieved[m.id] = { day };
  return { achieved };
}

export interface MilestoneView {
  readonly def: MilestoneDef;
  /** The first day it held; null while not yet earned. */
  readonly earnedOn: DayKey | null;
  readonly value: number;
  readonly target: number;
  readonly unit: string;
}

/** Every milestone this build knows, earned or not, with its progress. Receipts for ids this build does not know are kept on file, not shown. */
export function milestoneViews(state: MilestonesState, facts: MilestoneFacts): MilestoneView[] {
  return MILESTONES.map((def) => {
    const m = def.measure(facts);
    const earnedOn = state.achieved[def.id]?.day ?? null;
    return { def, earnedOn, value: earnedOn !== null ? m.target : m.value, target: m.target, unit: m.unit };
  });
}

/** The earned ones, newest first. */
export function earned(views: readonly MilestoneView[]): MilestoneView[] {
  return views.filter((v) => v.earnedOn !== null).sort((a, b) => (b.earnedOn as number) - (a.earnedOn as number));
}

/** The next `n` not yet earned (and not already met, which the next sync files), closest first (by fraction done), then in catalogue order. */
export function nextUp(views: readonly MilestoneView[], n: number): MilestoneView[] {
  return views
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => v.earnedOn === null && v.value < v.target)
    .sort((a, b) => b.v.value / b.v.target - a.v.value / a.v.target || a.i - b.i)
    .slice(0, n)
    .map(({ v }) => v);
}
