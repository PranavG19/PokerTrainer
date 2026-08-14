/**
 * THE CAREER RECORD — one honest aggregate of a learner's progress, composed from data the app already
 * logs. Pure: it takes already-derived inputs (the same the Home standing and Progress screen use) and
 * returns a structured record a screen can render. It stores nothing, computes no poker, and — the whole
 * point — fabricates nothing: every field is a count, a ratio, or a ratcheted depth that already exists
 * on SessionState. Nothing here rewards chip variance (the standing is a skill estimate, cadence is a
 * count of days, milestones are effort/mastery thresholds), matching the founding thesis even though the
 * gamification-vocabulary ban was lifted on 2026-08-14.
 *
 * Design-agnostic on purpose: whatever visual direction the UI redesign lands on, the Career screen reads
 * THIS. The renderer's only job is to lay these numbers out.
 */

import type { SessionStats } from './session.js';
import { sureAccuracy, guessAccuracy, type Calibration } from './predict.js';
import {
  standing,
  currentForm,
  depthLabel,
  type Standing,
  type StandingDecision,
  type Depth,
  type FormState,
} from './standing.js';

/** Sure-prediction accuracy, or null when the learner never made a sure prediction (no fabricated 0%). */
const sureAccuracyMaybe = (cal: Calibration): number | null =>
  cal.sureTotal === 0 ? null : sureAccuracy(cal);

/** Guess-prediction accuracy, or null when no guesses were ever made. */
const guessAccuracyMaybe = (cal: Calibration): number | null =>
  cal.guessTotal === 0 ? null : guessAccuracy(cal);

/** Everything the record needs, all of it already derived elsewhere (main.ts computes these today). */
export interface CareerInput {
  /** The eligible graded decisions the standing is computed from (session.assessments). */
  readonly decisions: readonly StandingDecision[];
  /** Concepts whose schedule gate reads 'mastered' (deriveConcepts + gate in main.ts). */
  readonly masteredKcCount: number;
  /** Puzzle scenarios solved fully clean (puzzleCoverage over session.puzzleProgress). */
  readonly puzzleCoverage: number;
  /** The ratcheted depth floor persisted on SessionState. */
  readonly depthFloor: number;
  /** Lifetime aggregate stats (computeStats(session)). */
  readonly stats: SessionStats;
  /** Prediction calibration (session.calibration). */
  readonly calibration: Calibration;
  /** How many times the hero rebought after busting (session.rebuys). */
  readonly rebuys: number;
  /** How many assessment blocks were completed (session.assessments carries per-decision, so pass the count). */
  readonly assessmentsTaken: number;
  /**
   * Epoch-ms timestamps of every graded activity (hand playedAt + assessment.at). Used only to count
   * DISTINCT days practised — never to build a break-on-miss shame counter. Absent/legacy entries the
   * caller simply omits.
   */
  readonly activityTimestamps: readonly number[];
}

/** The biggest single leak by total bb cost, or null when nothing has been graded. */
export interface BiggestLeak {
  readonly principle: string;
  readonly costBb: number;
}

/**
 * Practice cadence — an HONEST progress signal. `distinctDays` is the lifetime count of days with a graded
 * activity; `last30` is a fixed-length array (oldest→newest, index 29 = today) of booleans a UI can render
 * as a dot grid; `currentRun` is the number of consecutive days up to today with activity. A run is shown
 * as information, never as something you "lose" — a gap is not punished (spacing means gaps are correct).
 */
export interface PracticeCadence {
  readonly distinctDays: number;
  readonly last30: readonly boolean[];
  readonly currentRun: number;
}

/** One honest milestone: a fact about effort or mastery, never a chip outcome. */
export interface Milestone {
  readonly id: string;
  readonly label: string;
  readonly achieved: boolean;
}

export interface CareerRecord {
  readonly standing: Standing;
  readonly depthLabel: string;
  readonly form: FormState;
  readonly handsPlayed: number;
  readonly rebuys: number;
  readonly conceptsMastered: number;
  readonly puzzlesSolvedClean: number;
  readonly assessmentsTaken: number;
  /** Prediction accuracy split, null when that bucket was never tested (no fabricated 0%). */
  readonly sureAccuracy: number | null;
  readonly guessAccuracy: number | null;
  readonly biggestLeak: BiggestLeak | null;
  readonly cadence: PracticeCadence;
  readonly milestones: readonly Milestone[];
}

/** UTC day index of an epoch-ms timestamp. Deterministic, timezone-free, no Date needed. */
const dayIndex = (ms: number): number => Math.floor(ms / 86_400_000);

function computeCadence(timestamps: readonly number[], now: number): PracticeCadence {
  const days = new Set<number>();
  for (const ts of timestamps) if (Number.isFinite(ts) && ts > 0) days.add(dayIndex(ts));
  const today = dayIndex(now);
  // last30: index 29 = today, 0 = 29 days ago.
  const last30 = Array.from({ length: 30 }, (_, i) => days.has(today - (29 - i)));
  // currentRun: consecutive days with activity ending today (or yesterday, so a day mid-play still counts).
  let currentRun = 0;
  const start = days.has(today) ? today : days.has(today - 1) ? today - 1 : null;
  if (start !== null) {
    let d = start;
    while (days.has(d)) {
      currentRun += 1;
      d -= 1;
    }
  }
  return { distinctDays: days.size, last30, currentRun };
}

function biggestLeakOf(leakCostBb: Readonly<Record<string, number>>): BiggestLeak | null {
  let best: BiggestLeak | null = null;
  for (const [principle, costBb] of Object.entries(leakCostBb)) {
    if (costBb > 0 && (best === null || costBb > best.costBb)) best = { principle, costBb };
  }
  return best;
}

/**
 * The milestone ladder — effort and mastery only. Each is a threshold on data that cannot be inflated by
 * chip luck: depth earned (ratcheted floor), concepts mastered, puzzles solved clean, assessments taken.
 * Labels are plain facts, not rewards, and carry no banned trait/praise phrasing.
 */
function computeMilestones(record: {
  floor: Depth;
  conceptsMastered: number;
  puzzlesSolvedClean: number;
  assessmentsTaken: number;
}): Milestone[] {
  const depthMilestone = (d: Exclude<Depth, 0>, label: string): Milestone => ({
    id: `depth-${d}`,
    label,
    achieved: record.floor >= d,
  });
  return [
    { id: 'first-clean-solve', label: 'Solved a puzzle with no mistakes', achieved: record.puzzlesSolvedClean >= 1 },
    { id: 'first-assessment', label: 'Completed an assessment block', achieved: record.assessmentsTaken >= 1 },
    { id: 'concepts-2', label: 'Mastered 2 concepts', achieved: record.conceptsMastered >= 2 },
    { id: 'concepts-5', label: 'Mastered 5 concepts', achieved: record.conceptsMastered >= 5 },
    { id: 'concepts-12', label: 'Mastered 12 concepts', achieved: record.conceptsMastered >= 12 },
    { id: 'clean-solves-5', label: 'Solved 5 puzzles clean', achieved: record.puzzlesSolvedClean >= 5 },
    depthMilestone(40, 'Certified the 40bb table'),
    depthMilestone(75, 'Certified the 75bb table'),
    depthMilestone(125, 'Certified the 125bb table'),
    depthMilestone(200, 'Certified the 200bb table'),
  ];
}

/** Compose the full career record from already-derived, honest inputs. Pure; `now` is passed in. */
export function careerRecord(input: CareerInput, now: number): CareerRecord {
  const st = standing(
    {
      decisions: input.decisions,
      masteredKcCount: input.masteredKcCount,
      puzzleCoverage: input.puzzleCoverage,
      depthFloor: input.depthFloor,
    },
    now,
  );
  return {
    standing: st,
    depthLabel: depthLabel(st.depth),
    form: currentForm(input.decisions, now).state,
    handsPlayed: input.stats.handsPlayed,
    rebuys: input.rebuys,
    conceptsMastered: input.masteredKcCount,
    puzzlesSolvedClean: input.puzzleCoverage,
    assessmentsTaken: input.assessmentsTaken,
    sureAccuracy: sureAccuracyMaybe(input.calibration),
    guessAccuracy: guessAccuracyMaybe(input.calibration),
    biggestLeak: biggestLeakOf(input.stats.leakCostBb),
    cadence: computeCadence(input.activityTimestamps, now),
    milestones: computeMilestones({
      floor: st.floor,
      conceptsMastered: input.masteredKcCount,
      puzzlesSolvedClean: input.puzzleCoverage,
      assessmentsTaken: input.assessmentsTaken,
    }),
  };
}
