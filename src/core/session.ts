import type { Card } from './cards.js';
import type { Grade, Severity } from './coach.js';
import type { Calibration, PredictOutcome } from './predict.js';
import { emptyCalibration, tally } from './predict.js';

/** Bound the log so the on-disk JSON cannot grow without limit. */
export const MAX_HAND_LOG = 500;
export const DEFAULT_BANKROLL = 10000;

const SEVERITIES: Severity[] = ['free', 'notable', 'serious'];

/** A coach grade flattened for storage: only graded mistakes have a principle. */
export interface GradeRecord {
  severity: Severity;
  principle: string;
  evLossBb: number;
}

export interface HandRecord {
  handNumber: number;
  hole: Card[];
  board: Card[];
  /** Hero's chip result for the hand: positive won, negative lost. */
  net: number;
  vpip: boolean;
  pfr: boolean;
  grades: GradeRecord[];
}

/** Lifetime counters. Kept cumulative because the hand log is capped. */
export interface SessionStats {
  handsPlayed: number;
  vpipHands: number;
  pfrHands: number;
  evLossBb: number;
  leaks: Record<string, number>;
  /** Total bb lost per principle. Ranking by count alone buries one 20bb blunder under five 0.6bb ones. */
  leakCostBb: Record<string, number>;
}

export interface SessionState {
  bankroll: number;
  hands: HandRecord[];
  /** How many times the hero has topped their table stack back up after busting. */
  rebuys: number;
  stats: SessionStats;
  /** Prediction accuracy in coached mode. Lives outside `stats` because it counts decisions, not hands. */
  calibration: Calibration;
  /** Persisted so the toggle survives a restart. Default false keeps uncoached play unchanged. */
  coachedMode: boolean;
  /**
   * Read coach verdicts aloud. Default false and it stays false until asked for: unrequested audio
   * out of a poker app is a hostile default, and the verdict is fully readable without it.
   */
  spokenVerdicts: boolean;
}

export interface SessionSummary {
  handsPlayed: number;
  /** Percent, 0–100, unrounded. */
  vpip: number;
  pfr: number;
  evLossBb: number;
  leaks: { principle: string; count: number; costBb: number }[];
}

export function emptySession(): SessionState {
  return {
    bankroll: DEFAULT_BANKROLL,
    hands: [],
    rebuys: 0,
    stats: { handsPlayed: 0, vpipHands: 0, pfrHands: 0, evLossBb: 0, leaks: {}, leakCostBb: {} },
    calibration: emptyCalibration(),
    coachedMode: false,
    spokenVerdicts: false,
  };
}

/** One graded prediction. Per decision, not per hand, so it cannot live in recordHand. */
export function recordPrediction(state: SessionState, outcome: PredictOutcome): SessionState {
  return { ...state, calibration: tally(state.calibration, outcome) };
}

export function setCoachedMode(state: SessionState, on: boolean): SessionState {
  return { ...state, coachedMode: on };
}

export function setSpokenVerdicts(state: SessionState, on: boolean): SessionState {
  return { ...state, spokenVerdicts: on };
}

/**
 * Count a rebuy. The bankroll is deliberately UNCHANGED.
 *
 * `bankroll` here is total net worth — pocket plus the chips sitting on the table — which is why
 * sitting down for 5000 never debited it and why every hand's `net` is applied directly. A rebuy
 * moves 5000 from pocket to table: an internal transfer that leaves net worth alone. The money was
 * already debited hand by hand as it was lost, which is exactly what emptied the stack; debiting
 * again would count the same 5000 twice and destroy value the player still holds.
 *
 * No free value: busting requires `net` totalling -5000, so bankroll after N bust-and-rebuy cycles
 * is DEFAULT_BANKROLL - 5000*N plus whatever is currently on the table. Rebuying can only ever
 * follow a loss that already moved the bankroll down.
 */
export function rebuy(state: SessionState): SessionState {
  return { ...state, rebuys: state.rebuys + 1 };
}

/** Drops silent grades — a grade with no principle is not a leak. */
export function gradeRecordsFrom(grades: Grade[]): GradeRecord[] {
  return grades
    .filter((g) => g.principle !== null)
    .map((g) => ({ severity: g.severity, principle: g.principle as string, evLossBb: g.evLossBb }));
}

export function recordHand(state: SessionState, record: HandRecord): SessionState {
  const leaks = { ...state.stats.leaks };
  const leakCostBb = { ...state.stats.leakCostBb };
  let evLossBb = state.stats.evLossBb;
  for (const grade of record.grades) {
    leaks[grade.principle] = (leaks[grade.principle] ?? 0) + 1;
    leakCostBb[grade.principle] = (leakCostBb[grade.principle] ?? 0) + grade.evLossBb;
    evLossBb += grade.evLossBb;
  }

  return {
    ...state,
    bankroll: state.bankroll + record.net,
    hands: [...state.hands, structuredClone(record)].slice(-MAX_HAND_LOG),
    rebuys: state.rebuys,
    stats: {
      handsPlayed: state.stats.handsPlayed + 1,
      vpipHands: state.stats.vpipHands + (record.vpip ? 1 : 0),
      pfrHands: state.stats.pfrHands + (record.pfr ? 1 : 0),
      evLossBb,
      leaks,
      leakCostBb,
    },
  };
}

export function computeStats(state: SessionState): SessionSummary {
  const { handsPlayed, vpipHands, pfrHands, evLossBb, leaks, leakCostBb } = state.stats;
  return {
    handsPlayed,
    vpip: percent(vpipHands, handsPlayed),
    pfr: percent(pfrHands, handsPlayed),
    evLossBb,
    // Ranked by total cost, not frequency: what to study next is the most expensive
    // leak, not the most common one.
    leaks: Object.entries(leaks)
      .map(([principle, count]) => ({ principle, count, costBb: leakCostBb[principle] ?? 0 }))
      .sort(
        (a, b) => b.costBb - a.costBb || b.count - a.count || a.principle.localeCompare(b.principle),
      ),
  };
}

function percent(part: number, total: number): number {
  if (total === 0) return 0;
  return (part / total) * 100;
}

/** Detached plain object, ready for window.offsuit.saveState. */
export function serialize(state: SessionState): Record<string, unknown> {
  return {
    bankroll: state.bankroll,
    hands: structuredClone(state.hands),
    rebuys: state.rebuys,
    stats: { ...state.stats, leaks: { ...state.stats.leaks }, leakCostBb: { ...state.stats.leakCostBb } },
    calibration: { ...state.calibration },
    coachedMode: state.coachedMode,
    spokenVerdicts: state.spokenVerdicts,
  };
}

/**
 * Tolerant by design: the save file is on disk across app versions, so a truncated
 * or stale file must degrade to defaults rather than brick the app.
 */
export function deserialize(raw: unknown): SessionState {
  const obj = asRecord(raw);
  const stats = asRecord(obj.stats);
  return {
    bankroll: asNumber(obj.bankroll, DEFAULT_BANKROLL),
    hands: asArray(obj.hands).map(parseHand).slice(-MAX_HAND_LOG),
    // Legacy saves predate rebuys; 0 is the honest reading, not a missing field.
    rebuys: Math.max(0, Math.floor(asNumber(obj.rebuys, 0))),
    stats: {
      handsPlayed: asNumber(stats.handsPlayed, 0),
      vpipHands: asNumber(stats.vpipHands, 0),
      pfrHands: asNumber(stats.pfrHands, 0),
      evLossBb: asNumber(stats.evLossBb, 0),
      leaks: parseLeaks(stats.leaks),
      leakCostBb: parseLeaks(stats.leakCostBb),
    },
    calibration: parseCalibration(obj.calibration),
    // Legacy saves predate coached mode, and it must default OFF: an unasked-for gate on the
    // action buttons would look like a broken app.
    coachedMode: obj.coachedMode === true,
    // Same `=== true` shape and the same reason, doubled: a save that says nothing about narration
    // must come back silent, and a truthy non-boolean ("yes", 1) must not switch a voice on.
    spokenVerdicts: obj.spokenVerdicts === true,
  };
}

function parseCalibration(raw: unknown): Calibration {
  const obj = asRecord(raw);
  const count = (value: unknown): number => Math.max(0, Math.floor(asNumber(value, 0)));
  return {
    total: count(obj.total),
    correct: count(obj.correct),
    sureWrong: count(obj.sureWrong),
  };
}

function parseHand(raw: unknown): HandRecord {
  const obj = asRecord(raw);
  return {
    handNumber: asNumber(obj.handNumber, 0),
    hole: asStrings(obj.hole),
    board: asStrings(obj.board),
    net: asNumber(obj.net, 0),
    vpip: obj.vpip === true,
    pfr: obj.pfr === true,
    grades: asArray(obj.grades).map(parseGrade),
  };
}

function parseGrade(raw: unknown): GradeRecord {
  const obj = asRecord(raw);
  const severity = obj.severity;
  return {
    severity: SEVERITIES.includes(severity as Severity) ? (severity as Severity) : 'free',
    principle: typeof obj.principle === 'string' ? obj.principle : 'unknown',
    evLossBb: asNumber(obj.evLossBb, 0),
  };
}

function parseLeaks(raw: unknown): Record<string, number> {
  const leaks: Record<string, number> = {};
  for (const [principle, count] of Object.entries(asRecord(raw))) {
    if (typeof count === 'number' && Number.isFinite(count)) leaks[principle] = count;
  }
  return leaks;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asStrings(value: unknown): string[] {
  return asArray(value).filter((v): v is string => typeof v === 'string');
}
