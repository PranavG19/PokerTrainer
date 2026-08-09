import type { Card } from './cards.js';
import type { Grade, Severity } from './coach.js';

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
}

export interface SessionState {
  bankroll: number;
  hands: HandRecord[];
  stats: SessionStats;
}

export interface SessionSummary {
  handsPlayed: number;
  /** Percent, 0–100, unrounded. */
  vpip: number;
  pfr: number;
  evLossBb: number;
  leaks: { principle: string; count: number }[];
}

export function emptySession(): SessionState {
  return {
    bankroll: DEFAULT_BANKROLL,
    hands: [],
    stats: { handsPlayed: 0, vpipHands: 0, pfrHands: 0, evLossBb: 0, leaks: {} },
  };
}

/** Drops silent grades — a grade with no principle is not a leak. */
export function gradeRecordsFrom(grades: Grade[]): GradeRecord[] {
  return grades
    .filter((g) => g.principle !== null)
    .map((g) => ({ severity: g.severity, principle: g.principle as string, evLossBb: g.evLossBb }));
}

export function recordHand(state: SessionState, record: HandRecord): SessionState {
  const leaks = { ...state.stats.leaks };
  let evLossBb = state.stats.evLossBb;
  for (const grade of record.grades) {
    leaks[grade.principle] = (leaks[grade.principle] ?? 0) + 1;
    evLossBb += grade.evLossBb;
  }

  return {
    bankroll: state.bankroll + record.net,
    hands: [...state.hands, structuredClone(record)].slice(-MAX_HAND_LOG),
    stats: {
      handsPlayed: state.stats.handsPlayed + 1,
      vpipHands: state.stats.vpipHands + (record.vpip ? 1 : 0),
      pfrHands: state.stats.pfrHands + (record.pfr ? 1 : 0),
      evLossBb,
      leaks,
    },
  };
}

export function computeStats(state: SessionState): SessionSummary {
  const { handsPlayed, vpipHands, pfrHands, evLossBb, leaks } = state.stats;
  return {
    handsPlayed,
    vpip: percent(vpipHands, handsPlayed),
    pfr: percent(pfrHands, handsPlayed),
    evLossBb,
    leaks: Object.entries(leaks)
      .map(([principle, count]) => ({ principle, count }))
      .sort((a, b) => b.count - a.count || a.principle.localeCompare(b.principle)),
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
    stats: { ...state.stats, leaks: { ...state.stats.leaks } },
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
    stats: {
      handsPlayed: asNumber(stats.handsPlayed, 0),
      vpipHands: asNumber(stats.vpipHands, 0),
      pfrHands: asNumber(stats.pfrHands, 0),
      evLossBb: asNumber(stats.evLossBb, 0),
      leaks: parseLeaks(stats.leaks),
    },
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
