import type { Card } from './cards.js';
import type { Grade, Severity } from './coach.js';
import type { ActionKind, Street } from './table.js';
import type { Calibration, PredictOutcome } from './predict.js';
import { emptyCalibration, tally } from './predict.js';
import { SOURCES, emptyRecommender, type RecommenderState, type Source } from './recommend.js';
import type { GiftEntry } from './giftLedger.js';

/** Bound the persisted gift log the same way the hand log is bounded, so the JSON cannot grow forever. */
export const MAX_GIFT_LOG = 200;

/** Guards the persisted preference list: an unrecognised source would weight nothing silently. */
const KNOWN_SOURCES = new Set<string>(SOURCES);

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

/**
 * One hero decision, captured at the moment it was made. Everything here is a reading taken
 * BEFORE the action was applied, which is what makes a replay a replay: `pot` and `board` are what
 * the player was looking at, not what the hand ended up as.
 *
 * `verdict` is the coach's grade verbatim, message included, because the grade is a Monte Carlo
 * estimate — re-grading a stored hand later would produce a different number and present it as the
 * advice the learner was given.
 */
export interface DecisionRecord {
  street: Street;
  /** Board visible when the decision was made — shorter than the hand's final board on early streets. */
  board: Card[];
  /** Chips in the middle before this action went in. */
  pot: number;
  /** What it cost the hero to continue; 0 when checking was free. */
  toCall: number;
  action: ActionKind;
  /** Total chips the bet or raise made it, in chips; null for actions that carry no size. */
  amount: number | null;
  /** null only in a save written before verdicts were stored per decision. */
  verdict: Grade | null;
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
  /**
   * Optional, and absent rather than empty on purpose: a hand saved before decision logging existed
   * has no decisions ON RECORD, which is a different fact from a hand where the hero never acted
   * (blinds all-in, or sitting out). Review must be able to say which, so the two cannot collapse
   * into one representation.
   */
  decisions?: DecisionRecord[];
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
  /**
   * N2/N4. Persisted because the override log is evidence about the learner across sittings — a decline
   * run that reset on every launch could never reach N4's ask-once threshold, and the log the spec asks
   * for would silently be a session-scoped scratchpad.
   */
  recommender: RecommenderState;
  /**
   * O5/story 34: -EV villain calls the learner OBSERVED at showdown, auto-populated so it cannot be
   * inflated. Persisted across sittings because the point of the ledger is a durable, honest record
   * of value handed over; a session-scoped one would forget the evidence every launch.
   */
  gifts: GiftEntry[];
  /**
   * Preflop chart-drill accuracy per hand class, keyed by HandClassId. Persisted for the same reason
   * calibration is: the drill draws the classes the learner keeps missing more often, and that only
   * teaches across sittings if the record survives a restart — a session-scoped one would put every
   * class back to zero every launch and the adaptive draw would never leave its cold start. The key
   * is a bare string so this module stays free of a preflop.ts import; unknown keys parse and are
   * simply never drawn (the drill only reads the six classes it knows).
   */
  chartMastery: Record<string, { attempts: number; correct: number }>;
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
    recommender: emptyRecommender(),
    gifts: [],
    chartMastery: {},
  };
}

/**
 * Record one graded chart-drill answer against its hand class. Pure and cumulative: the class's
 * attempts always tick, correct ticks only on a right answer — the same shape the drill's own
 * scoreboard shows, so the persisted record and the on-screen one never disagree.
 */
export function recordChartAnswer(
  state: SessionState,
  handClass: string,
  correct: boolean,
): SessionState {
  const prior = state.chartMastery[handClass] ?? { attempts: 0, correct: 0 };
  return {
    ...state,
    chartMastery: {
      ...state.chartMastery,
      [handClass]: {
        attempts: prior.attempts + 1,
        correct: prior.correct + (correct ? 1 : 0),
      },
    },
  };
}

/**
 * Append observed gifts from one hand, newest last, bounded to MAX_GIFT_LOG. The entries are already
 * derived from revealed cards by the gift ledger (O5's anti-inflation guarantee); this reducer only
 * stores them. Empty input returns state unchanged so a gift-less hand costs no allocation.
 */
export function recordGifts(state: SessionState, gifts: readonly GiftEntry[]): SessionState {
  if (gifts.length === 0) return state;
  return { ...state, gifts: [...state.gifts, ...gifts].slice(-MAX_GIFT_LOG) };
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
    recommender: {
      overrides: state.recommender.overrides.map((o) => ({ ...o })),
      consecutiveDeclines: state.recommender.consecutiveDeclines,
      preferred: [...state.recommender.preferred],
    },
    gifts: structuredClone(state.gifts),
    chartMastery: structuredClone(state.chartMastery),
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
    // Legacy saves predate the recommender; an empty one is the honest reading of a missing field.
    recommender: parseRecommender(obj.recommender),
    // Legacy saves predate the gift ledger; an empty list is the honest reading of a missing field.
    // Malformed entries are dropped rather than resurrected with fabricated numbers, because a gift
    // that cannot be reconstructed from real fields is not the observed evidence O5 promises.
    gifts: asArray(obj.gifts).map(parseGift).filter((g): g is GiftEntry => g !== null).slice(-MAX_GIFT_LOG),
    // Legacy saves predate the chart-drill record; an empty map is the honest reading of a missing
    // field. Same tolerance as every parser here.
    chartMastery: parseChartMastery(obj.chartMastery),
  };
}

/**
 * Tolerant like every parser here. Each class entry is kept only if both counters are real finite
 * numbers, clamped so a corrupt file cannot inject a negative or a correct count above attempts —
 * either would poison the draw weight the mastery drives.
 */
function parseChartMastery(raw: unknown): Record<string, { attempts: number; correct: number }> {
  const obj = asRecord(raw);
  const out: Record<string, { attempts: number; correct: number }> = {};
  for (const [key, value] of Object.entries(obj)) {
    const entry = asRecord(value);
    const attempts = Math.max(0, Math.floor(asNumber(entry.attempts, 0)));
    // Clamp correct into [0, attempts] BEFORE the empty check: a corrupt {attempts:0, correct:3}
    // clamps to {0,0} and is then dropped rather than kept as a phantom class.
    const correct = Math.min(attempts, Math.max(0, Math.floor(asNumber(entry.correct, 0))));
    if (attempts === 0) continue; // nothing worth carrying (correct is already ≤ attempts)
    out[key] = { attempts, correct };
  }
  return out;
}

/** Tolerant like every parser here. A gift is kept only if every derived number is really present. */
function parseGift(raw: unknown): GiftEntry | null {
  const obj = asRecord(raw);
  const action = obj.action;
  if (action !== 'call' && action !== 'allin') return null;
  const villainHole = asStrings(obj.villainHole);
  const heroHole = asStrings(obj.heroHole);
  if (villainHole.length !== 2 || heroHole.length !== 2) return null;
  const numbers = ['seq', 'handNumber', 'villainSeatId', 'villainEquity', 'breakEven', 'evChips', 'giftChips'] as const;
  for (const key of numbers) {
    if (typeof obj[key] !== 'number' || !Number.isFinite(obj[key])) return null;
  }
  return {
    seq: obj.seq as number,
    handNumber: obj.handNumber as number,
    villainSeatId: obj.villainSeatId as number,
    villainName: typeof obj.villainName === 'string' ? obj.villainName : `Seat ${obj.villainSeatId as number}`,
    villainHole,
    heroHole,
    board: asStrings(obj.board),
    street: STREETS.includes(obj.street as Street) ? (obj.street as Street) : 'river',
    action,
    villainEquity: obj.villainEquity as number,
    breakEven: obj.breakEven as number,
    evChips: obj.evChips as number,
    giftChips: obj.giftChips as number,
  };
}

/**
 * Tolerant like every other parser here, and for the same reason: this file is on disk across versions.
 * An override missing its timestamp is dropped rather than resurrected as NaN, because a log entry that
 * cannot be placed in time is not evidence — N4 names {timestamp, recommended, chosen} and all three
 * have to be real for the entry to mean anything.
 */
function parseRecommender(raw: unknown): RecommenderState {
  const obj = asRecord(raw);
  const overrides = asArray(obj.overrides)
    .map((entry) => asRecord(entry))
    .filter(
      (entry) =>
        typeof entry.timestamp === 'number' &&
        Number.isFinite(entry.timestamp) &&
        typeof entry.recommended === 'string',
    )
    .map((entry) => ({
      timestamp: entry.timestamp as number,
      recommended: entry.recommended as string,
      chosen: typeof entry.chosen === 'string' ? entry.chosen : '',
    }));
  return {
    overrides,
    consecutiveDeclines: Math.max(0, Math.floor(asNumber(obj.consecutiveDeclines, 0))),
    // Only known sources survive: an unknown one would silently weight nothing.
    preferred: asStrings(obj.preferred).filter((v): v is Source => KNOWN_SOURCES.has(v)),
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
  const hand: HandRecord = {
    handNumber: asNumber(obj.handNumber, 0),
    hole: asStrings(obj.hole),
    board: asStrings(obj.board),
    net: asNumber(obj.net, 0),
    vpip: obj.vpip === true,
    pfr: obj.pfr === true,
    grades: asArray(obj.grades).map(parseGrade),
  };
  // The key is only set when the save really has a decision list. Defaulting it to [] would make
  // every pre-review hand claim the hero made no decisions, which is a lie about their history.
  if (Array.isArray(obj.decisions)) hand.decisions = obj.decisions.map(parseDecision);
  return hand;
}

const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];
const ACTION_KINDS: ActionKind[] = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];

function parseDecision(raw: unknown): DecisionRecord {
  const obj = asRecord(raw);
  const amount = obj.amount;
  return {
    street: STREETS.includes(obj.street as Street) ? (obj.street as Street) : 'preflop',
    board: asStrings(obj.board),
    pot: asNumber(obj.pot, 0),
    toCall: asNumber(obj.toCall, 0),
    action: ACTION_KINDS.includes(obj.action as ActionKind) ? (obj.action as ActionKind) : 'check',
    amount: typeof amount === 'number' && Number.isFinite(amount) ? amount : null,
    verdict: parseVerdict(obj.verdict),
  };
}

/** A decision logged without a verdict stays without one: review says so rather than inventing a grade. */
function parseVerdict(raw: unknown): Grade | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  return {
    severity: SEVERITIES.includes(obj.severity as Severity) ? (obj.severity as Severity) : 'free',
    evLossBb: asNumber(obj.evLossBb, 0),
    message: typeof obj.message === 'string' ? obj.message : null,
    principle: typeof obj.principle === 'string' ? obj.principle : null,
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
