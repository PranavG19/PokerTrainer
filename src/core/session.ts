import type { Card } from './cards.js';
import type { Grade, Severity } from './coach.js';
import type { ActionKind, Street } from './table.js';
import type { Calibration, Confidence, PredictOutcome } from './predict.js';
import { emptyCalibration, tally } from './predict.js';
import { SOURCES, emptyRecommender, type RecommenderState, type Source } from './recommend.js';
import type { GiftEntry } from './giftLedger.js';
import { MECHANISM_FRAMES, REJECTION_TEXT, type Decider, type LexiconAttempt, type RejectionReason } from './lexicon.js';
import type { ContrastAxis } from './contrast.js';
import type { FadingEvent, Rung } from './fading.js';

/** Bound the persisted gift log the same way the hand log is bounded, so the JSON cannot grow forever. */
export const MAX_GIFT_LOG = 200;

/** Guards the persisted preference list: an unrecognised source would weight nothing silently. */
const KNOWN_SOURCES = new Set<string>(SOURCES);

/** Bound the log so the on-disk JSON cannot grow without limit. */
export const MAX_HAND_LOG = 500;
/** Bound the assessment log the same way. One block is 30 spots, so this holds many blocks of history. */
export const MAX_ASSESSMENT_LOG = 500;
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
  /**
   * State-4 GATE (five-state protocol): how many self-explanation attempts the learner made before the
   * verdict was revealed. 0 = the gate fired but its budget expired with no submission ("I don't know"
   * is a commitment, spec G5a); 1 or 2 = attempts made. ABSENT when the gate never fired — the decision
   * was below the T2 severity threshold, or coached mode was off — matching the `playedAt` precedent
   * where absence means "did not apply", never 0.
   */
  gateAttempts?: 0 | 1 | 2;
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
   * Absolute epoch ms the hand was completed. Optional and absent (not zero) on a hand saved before it
   * was recorded: the Progress "graded decisions this week" metric windows on it, and defaulting a
   * legacy hand to 0 would silently place it outside every week rather than counting it wrongly.
   */
  playedAt?: number;
  /**
   * Optional, and absent rather than empty on purpose: a hand saved before decision logging existed
   * has no decisions ON RECORD, which is a different fact from a hand where the hero never acted
   * (blinds all-in, or sitting out). Review must be able to say which, so the two cannot collapse
   * into one representation.
   */
  decisions?: DecisionRecord[];
}

/**
 * P4/G2: one graded spot from an assessment block. The block runs like coached play but withholds the
 * coach's feedback until the end and tags every decision so it feeds the assessment-EV-loss metric
 * ALONE (progress.ts filters `mode === 'assessment'`). Deliberately the honest minimum the metric reads:
 * `evLossBb` is the coach's own grade for the spot (never re-graded here), `at` places it in a week, and
 * `correct` mirrors the practice path (a decision that cost nothing is correct). No `mode` field — it is
 * baked to 'assessment' when these are mapped into the progress input, because that is the only mode an
 * AssessmentDecision can carry.
 */
export interface AssessmentDecision {
  /** Absolute epoch ms the spot was graded. */
  readonly at: number;
  /** bb lost relative to the best action, straight from coach.gradeDecision. Zero cost a free spot. */
  readonly evLossBb: number;
  /** True when the spot cost nothing (severity 'free'), mirroring decisionRecordsFromHands. */
  readonly correct: boolean;
  /**
   * The coach principle behind the grade ('pot odds' | 'ranges' | 'value or bluff' | null), carried so the
   * standing score can filter to the SOUND-math charges. The coach has no fold-equity model, so its
   * 'value or bluff' charges can misgrade correct aggression; standing.ts keeps only 'pot odds'/'ranges'
   * (and free spots) — see [[offsuit-coach-grading-scope]]. Optional: a save written before this field
   * existed has no principle on record, which standing.ts treats as ineligible rather than guessing.
   */
  readonly principle?: string | null;
  /**
   * What it cost the hero to continue at this spot; 0 when checking was free. Carried so standing.ts can
   * apply the CONTESTED filter (toCall>0) — free checks/folds carry near-zero information and would let a
   * player pad the sample. Optional for the same legacy reason as `principle`.
   */
  readonly toCall?: number;
  /** The street the decision was made on, so standing.ts can require contested POSTFLOP decisions. Optional (legacy). */
  readonly street?: Street;
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
  /**
   * The deepest table (effective big blinds) the learner has ever EARNED — the standing ratchet. Once a
   * depth is confirmed it is stored here and never drops, so a losing session can never demote it (the
   * standing is a skill estimate from graded decisions, not chips). standing.ts computes the current depth
   * and folds it in with max(); this field only ever moves up. 0 = never certified past 'Calibrating'.
   */
  depthFloor: number;
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
  /**
   * Per-puzzle-scenario progress, keyed by scenario id: how many times the scenario was completed and
   * the BEST number of decisions played correctly in one completion. Persisted so a learner sees what
   * they have mastered across sittings rather than a library that forgets every launch. `bestCorrect`
   * (not last) because mastery is your ceiling — a later sloppy replay should not erase a clean solve.
   * The key is a bare string; an id no longer in the library simply never renders.
   */
  puzzleProgress: Record<string, { attempts: number; bestCorrect: number }>;
  /**
   * L1/L3: the learner's own mechanism sentences, in append order — the log `createLexicon` rehydrates
   * from. Persisted because L1 promises "all future feedback on that concept opens by quoting it", and a
   * quote that reset every launch could never open the NEXT sitting's feedback. Rejected attempts are
   * kept too (L2's diagnostic material and the pushback-once state). Append-only by construction: the
   * only writer is `recordLexiconAttempt`, mirroring the store's own L3 refusal to edit or delete.
   */
  lexicon: LexiconAttempt[];
  /**
   * T6/T7: the per-concept support-fading event log the drill's scaffolding is derived from. Persisted
   * because the fading ladder only teaches across sittings — a learner who has faded a concept to a
   * lighter rung must not snap back to worked examples every launch, and a bad run's rung drop must
   * survive too. Append-only (the only writer is `recordFadingEvents`), so the log replays to exactly
   * the state that produced it. Each event carries its own conceptId; `deriveState` filters per concept.
   */
  fadingLog: FadingEvent[];
  /**
   * Q1/Q2: the graded RFI spots the learner has attempted, keyed by spot class ("AKs-CO"), each with
   * the content module it belongs to and its attempt tally. The interleaving view reads this to show
   * which classes are in play and to let core decide (honestly) whether an interleaved block can be
   * assembled yet. Persisted for the same reason chart mastery is — the record only teaches across
   * sittings. The key and module are bare strings; an unknown module simply never assembles.
   */
  interleavingSpots: Record<string, { module: string; attempts: number; correct: number }>;
  /**
   * O8: a lifetime tally of anomaly-drill responses, so the drill's real graded outcomes survive a tab
   * switch and a restart instead of being thrown away with the screen's local array every visit. This
   * is a CUMULATIVE record, deliberately separate from the in-sitting fluency gate (which windows over
   * one block's responses and must not): `attempts`/`correct`/`fast` are counts, and the three error
   * tags mirror anomaly.ts's ErrorTag exactly. Mirrors chartMastery/puzzleProgress — the record only
   * teaches across sittings.
   */
  anomalyTally: {
    attempts: number;
    correct: number;
    fast: number;
    missedAnomaly: number;
    falseAlarm: number;
    slow: number;
  };
  /**
   * P4/G2: the graded spots from assessment blocks, newest last. Persisted because the assessment-EV-loss
   * metric is the whole point of the block — a session-scoped log would make the metric forget every
   * launch, and the spec asks for a durable read on how the learner does with feedback withheld. Bounded
   * by MAX_ASSESSMENT_LOG the same way the hand log is. Append-only (the only writer is recordAssessment).
   */
  assessments: AssessmentDecision[];
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
    depthFloor: 0,
    stats: { handsPlayed: 0, vpipHands: 0, pfrHands: 0, evLossBb: 0, leaks: {}, leakCostBb: {} },
    calibration: emptyCalibration(),
    coachedMode: false,
    spokenVerdicts: false,
    recommender: emptyRecommender(),
    gifts: [],
    chartMastery: {},
    puzzleProgress: {},
    lexicon: [],
    fadingLog: [],
    interleavingSpots: {},
    anomalyTally: { attempts: 0, correct: 0, fast: 0, missedAnomaly: 0, falseAlarm: 0, slow: 0 },
    assessments: [],
  };
}

/**
 * Record one graded anomaly-drill response into the lifetime tally. Pure and cumulative. The scored
 * fields come straight from anomaly.ts's ScoredResponse so the persisted record and the on-screen
 * verdict can never disagree — this reducer only counts, it does not re-grade. `tag` is one of the
 * three ErrorTags or null (a correct, fast response has no tag and only ticks attempts/correct/fast).
 */
export function recordAnomalyResponse(
  state: SessionState,
  scored: { correct: boolean; fast: boolean; tag: 'missed-anomaly' | 'false-alarm' | 'slow' | null },
): SessionState {
  const t = state.anomalyTally;
  return {
    ...state,
    anomalyTally: {
      attempts: t.attempts + 1,
      correct: t.correct + (scored.correct ? 1 : 0),
      fast: t.fast + (scored.fast ? 1 : 0),
      missedAnomaly: t.missedAnomaly + (scored.tag === 'missed-anomaly' ? 1 : 0),
      falseAlarm: t.falseAlarm + (scored.tag === 'false-alarm' ? 1 : 0),
      slow: t.slow + (scored.tag === 'slow' ? 1 : 0),
    },
  };
}

/**
 * Append one graded assessment spot, newest last, bounded to MAX_ASSESSMENT_LOG. Pure. The grade comes
 * straight from coach.gradeDecision (the caller has already graded the spot), so this reducer only
 * records — it never re-grades — and the persisted evLossBb can never disagree with the coach's own.
 */
export function recordAssessment(state: SessionState, decision: AssessmentDecision): SessionState {
  return { ...state, assessments: [...state.assessments, { ...decision }].slice(-MAX_ASSESSMENT_LOG) };
}

/**
 * Record one graded RFI spot for the interleaving view. Pure and cumulative, the same shape
 * recordChartAnswer uses: attempts always tick, correct ticks on a right answer, and the module is
 * carried so the reader can tell which content block the class belongs to.
 */
export function recordInterleaveSpot(
  state: SessionState,
  spotClass: string,
  module: string,
  correct: boolean,
): SessionState {
  const prior = state.interleavingSpots[spotClass] ?? { module, attempts: 0, correct: 0 };
  return {
    ...state,
    interleavingSpots: {
      ...state.interleavingSpots,
      [spotClass]: {
        module,
        attempts: prior.attempts + 1,
        correct: prior.correct + (correct ? 1 : 0),
      },
    },
  };
}

/**
 * Append graded/fade events to the fading log. Pure and append-only, matching the lexicon: the log only
 * grows, and replaying it through `deriveState` reproduces every concept's rung. The events are built by
 * the caller (the drill folds a GradedEvent, and the promotion rule a SupportFadedEvent), so this adds
 * no fading logic of its own.
 */
export function recordFadingEvents(state: SessionState, events: readonly FadingEvent[]): SessionState {
  if (events.length === 0) return state;
  return { ...state, fadingLog: [...state.fadingLog, ...events] };
}

/**
 * Append one recorded lexicon attempt (accepted or rejected). Pure and append-only: the log only ever
 * grows, matching the store's L3 refusal to edit or delete history. The attempt is produced by
 * `Lexicon.record` in the caller, so this function adds no classification of its own.
 */
export function recordLexiconAttempt(state: SessionState, attempt: LexiconAttempt): SessionState {
  return { ...state, lexicon: [...state.lexicon, attempt] };
}

/**
 * Record one completed puzzle scenario: its attempts always tick, and bestCorrect keeps the MAX of the
 * prior best and this run's correct count — a clean solve is never erased by a later sloppy replay.
 * Pure and cumulative, the same shape recordChartAnswer uses.
 */
export function recordPuzzleResult(
  state: SessionState,
  scenarioId: string,
  correct: number,
): SessionState {
  const prior = state.puzzleProgress[scenarioId] ?? { attempts: 0, bestCorrect: 0 };
  return {
    ...state,
    puzzleProgress: {
      ...state.puzzleProgress,
      [scenarioId]: {
        attempts: prior.attempts + 1,
        bestCorrect: Math.max(prior.bestCorrect, correct),
      },
    },
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

/**
 * One graded prediction. Per decision, not per hand, so it cannot live in recordHand. The confidence
 * is threaded through because a correct 'sure' and a correct 'guess' are the same outcome but belong
 * in different calibration buckets.
 */
export function recordPrediction(
  state: SessionState,
  outcome: PredictOutcome,
  confidence: Confidence,
): SessionState {
  return { ...state, calibration: tally(state.calibration, outcome, confidence) };
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
    depthFloor: state.depthFloor,
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
    puzzleProgress: structuredClone(state.puzzleProgress),
    lexicon: structuredClone(state.lexicon),
    fadingLog: structuredClone(state.fadingLog),
    interleavingSpots: structuredClone(state.interleavingSpots),
    anomalyTally: { ...state.anomalyTally },
    assessments: state.assessments.map((a) => ({ ...a })),
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
    // Legacy saves predate the standing ratchet; 0 (never certified) is the honest default. Never
    // negative — a corrupt value cannot demote a real learner below Calibrating.
    depthFloor: Math.max(0, asNumber(obj.depthFloor, 0)),
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
    // Legacy saves predate puzzle progress; empty map for a missing field, same tolerance.
    puzzleProgress: parsePuzzleProgress(obj.puzzleProgress),
    // Legacy saves predate the lexicon; an empty log is the honest reading of a missing field.
    lexicon: parseLexicon(obj.lexicon),
    // Legacy saves predate the fading log; an empty log means every concept starts at worked examples.
    fadingLog: parseFadingLog(obj.fadingLog),
    // Legacy saves predate interleaving spots; an empty map is the honest reading of a missing field.
    interleavingSpots: parseInterleavingSpots(obj.interleavingSpots),
    // Legacy saves predate the anomaly tally; zeros are the honest reading of a missing field.
    anomalyTally: parseAnomalyTally(obj.anomalyTally),
    // Legacy saves predate assessment blocks; an empty log is the honest reading of a missing field.
    assessments: asArray(obj.assessments)
      .map(parseAssessment)
      .filter((a): a is AssessmentDecision => a !== null)
      .slice(-MAX_ASSESSMENT_LOG),
  };
}

/**
 * Tolerant like every parser here. Every field is a non-negative count; a corrupt one degrades to 0.
 * `correct` and `fast` are clamped to `attempts`, and the three error tags clamped to the wrong-or-slow
 * remainder, so a garbled save can never make the drill report more right (or more tagged) than played.
 */
function parseAnomalyTally(raw: unknown): SessionState['anomalyTally'] {
  const obj = asRecord(raw);
  const count = (value: unknown): number => Math.max(0, Math.floor(asNumber(value, 0)));
  const attempts = count(obj.attempts);
  const correct = Math.min(count(obj.correct), attempts);
  return {
    attempts,
    correct,
    fast: Math.min(count(obj.fast), attempts),
    // The three tags only attach to a wrong or slow response, so together they cannot exceed attempts.
    missedAnomaly: Math.min(count(obj.missedAnomaly), attempts),
    falseAlarm: Math.min(count(obj.falseAlarm), attempts),
    slow: Math.min(count(obj.slow), attempts),
  };
}

/**
 * Tolerant like every parser here. A spot is kept only with a real, finite timestamp — without one it
 * cannot be placed in a week and pretending it happened now would inflate the metric, so it is dropped
 * rather than resurrected with a fabricated `at`. A negative evLossBb is clamped to 0 (the coach never
 * awards a spot that BEAT the best action; a negative is corruption). `correct` degrades to false.
 */
function parseAssessment(raw: unknown): AssessmentDecision | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.at !== 'number' || !Number.isFinite(obj.at)) return null;
  const base: AssessmentDecision = {
    at: obj.at,
    evLossBb: Math.max(0, asNumber(obj.evLossBb, 0)),
    correct: obj.correct === true,
  };
  // The standing-score fields are optional: a legacy save simply lacks them, and absence is honest
  // (standing.ts treats a decision with no principle/toCall as ineligible rather than guessing). Only
  // carry a value that is actually present and well-typed.
  const principle = typeof obj.principle === 'string' ? obj.principle : obj.principle === null ? null : undefined;
  const toCall = typeof obj.toCall === 'number' && Number.isFinite(obj.toCall) ? Math.max(0, obj.toCall) : undefined;
  const street = STREETS.includes(obj.street as Street) ? (obj.street as Street) : undefined;
  return {
    ...base,
    ...(principle !== undefined ? { principle } : {}),
    ...(toCall !== undefined ? { toCall } : {}),
    ...(street !== undefined ? { street } : {}),
  };
}

/**
 * Tolerant like every parser here. An entry is kept only with a real module string and at least one
 * attempt; correct is clamped to attempts (a record claiming more right than played is corrupt). A
 * zero-attempt or module-less entry is dropped as nothing worth carrying — the reader validates the
 * module against the real ModuleIds, so an unknown one simply never assembles.
 */
function parseInterleavingSpots(raw: unknown): Record<string, { module: string; attempts: number; correct: number }> {
  const obj = asRecord(raw);
  const out: Record<string, { module: string; attempts: number; correct: number }> = {};
  for (const [key, value] of Object.entries(obj)) {
    const entry = asRecord(value);
    const attempts = Math.max(0, Math.floor(asNumber(entry.attempts, 0)));
    const correct = Math.min(attempts, Math.max(0, Math.floor(asNumber(entry.correct, 0))));
    const module = typeof entry.module === 'string' ? entry.module.trim() : '';
    if (attempts === 0 || module === '') continue;
    out[key] = { module, attempts, correct };
  }
  return out;
}

/** Whole rungs 0–4 only; a fade/hint event carrying anything else is a corrupt record and dropped. */
const RUNGS: readonly Rung[] = [0, 1, 2, 3, 4];

/**
 * Tolerant like every parser here. A fading event is kept only when its kind and conceptId are valid and
 * its kind-specific field is well-formed; anything else is DROPPED rather than replayed, because a
 * malformed event fed to `applyEvent` would either be ignored or throw (a bad hint rung is rejected by
 * the module). Append order is preserved — `deriveState` folds the log in order, so order is the truth.
 */
function parseFadingLog(raw: unknown): FadingEvent[] {
  const out: FadingEvent[] = [];
  for (const value of asArray(raw)) {
    const entry = asRecord(value);
    const conceptId = typeof entry.conceptId === 'string' ? entry.conceptId.trim() : '';
    if (conceptId === '') continue;
    const at = asNumber(entry.at, 0);
    if (entry.kind === 'graded') {
      if (typeof entry.correct !== 'boolean') continue;
      out.push({ kind: 'graded', conceptId, at, correct: entry.correct });
    } else if (entry.kind === 'supportFaded') {
      out.push({ kind: 'supportFaded', conceptId, at });
    } else if (entry.kind === 'hintRequested') {
      const rung = RUNGS.find((r) => r === entry.quotedRungAfter);
      if (rung === undefined) continue;
      out.push({ kind: 'hintRequested', conceptId, at, quotedRungAfter: rung });
    }
  }
  return out;
}

/** The two rejection reasons and three deciders, as membership sets for the tolerant parser below. */
const REJECTION_REASONS: readonly RejectionReason[] = ['cached-cell', 'no-mechanism-frame'];
const DECIDERS: readonly Decider[] = ['keyword-check', 'learner', 'classifier'];

/**
 * Tolerant like every parser here, and DROPPING rather than resurrecting a malformed entry — a lexicon
 * attempt that cannot be reconstructed from real fields is not the frozen record L3 promises. Append
 * order is preserved because `quoteFor` ("the most recent accepted") depends on it. `reasonText` is
 * re-derived from `REJECTION_TEXT` rather than trusted from disk, so a stale save cannot show wording
 * this build no longer uses. An accepted entry with an unknown frame/decider, or a rejected one with an
 * unknown reason, is dropped rather than stored with an invalid discriminant.
 */
function parseLexicon(raw: unknown): LexiconAttempt[] {
  const out: LexiconAttempt[] = [];
  for (const value of asArray(raw)) {
    const entry = asRecord(value);
    const conceptId = typeof entry.conceptId === 'string' ? entry.conceptId.trim() : '';
    const sentence = typeof entry.sentence === 'string' ? entry.sentence.trim() : '';
    if (conceptId === '' || sentence === '') continue;
    const base = {
      seq: Math.max(0, Math.floor(asNumber(entry.seq, out.length))),
      conceptId,
      sentence,
      at: asNumber(entry.at, 0),
      flippingAxis: typeof entry.flippingAxis === 'string' ? (entry.flippingAxis as ContrastAxis) : null,
    };
    if (entry.outcome === 'accepted') {
      const frame = MECHANISM_FRAMES.find((f) => f === entry.frame);
      const decidedBy = DECIDERS.find((d) => d === entry.decidedBy);
      if (frame === undefined || decidedBy === undefined) continue;
      out.push({ ...base, outcome: 'accepted', frame, decidedBy });
    } else if (entry.outcome === 'rejected') {
      const reason = REJECTION_REASONS.find((r) => r === entry.reason);
      if (reason === undefined) continue;
      out.push({ ...base, outcome: 'rejected', reason, reasonText: REJECTION_TEXT[reason], pushback: entry.pushback === true });
    }
  }
  return out;
}

/**
 * Tolerant like every parser here. Each scenario entry keeps both counters as real finite non-negative
 * integers. bestCorrect is NOT clamped to attempts — it counts correct DECISIONS within one completion
 * (a 4-step scenario solved once is attempts 1, bestCorrect 4), and the screen caps its display against
 * the scenario's own target length. A zero-attempt entry is dropped as nothing worth carrying.
 */
function parsePuzzleProgress(raw: unknown): Record<string, { attempts: number; bestCorrect: number }> {
  const obj = asRecord(raw);
  const out: Record<string, { attempts: number; bestCorrect: number }> = {};
  for (const [key, value] of Object.entries(obj)) {
    const entry = asRecord(value);
    const attempts = Math.max(0, Math.floor(asNumber(entry.attempts, 0)));
    const bestCorrect = Math.max(0, Math.floor(asNumber(entry.bestCorrect, 0)));
    if (attempts === 0) continue; // nothing worth carrying
    out[key] = { attempts, bestCorrect };
  }
  return out;
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
  // Correct-in-bucket can never exceed the bucket total, so clamp rather than trust a corrupt save —
  // an impossible sureCorrect > sureTotal would print an accuracy over 100%.
  const sureTotal = count(obj.sureTotal);
  const guessTotal = count(obj.guessTotal);
  return {
    total: count(obj.total),
    correct: count(obj.correct),
    sureWrong: count(obj.sureWrong),
    sureTotal,
    sureCorrect: Math.min(count(obj.sureCorrect), sureTotal),
    guessTotal,
    guessCorrect: Math.min(count(obj.guessCorrect), guessTotal),
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
  // Only carried when the save actually has a timestamp — a legacy hand stays undefined, not epoch 0,
  // so the Progress week window omits it rather than counting it in the wrong week.
  if (typeof obj.playedAt === 'number' && Number.isFinite(obj.playedAt)) hand.playedAt = obj.playedAt;
  return hand;
}

const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];
const ACTION_KINDS: ActionKind[] = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];

function parseDecision(raw: unknown): DecisionRecord {
  const obj = asRecord(raw);
  const amount = obj.amount;
  const gate = obj.gateAttempts;
  return {
    street: STREETS.includes(obj.street as Street) ? (obj.street as Street) : 'preflop',
    board: asStrings(obj.board),
    pot: asNumber(obj.pot, 0),
    toCall: asNumber(obj.toCall, 0),
    action: ACTION_KINDS.includes(obj.action as ActionKind) ? (obj.action as ActionKind) : 'check',
    amount: typeof amount === 'number' && Number.isFinite(amount) ? amount : null,
    verdict: parseVerdict(obj.verdict),
    // Absent stays absent (gate never fired); only a literal 0|1|2 is carried through.
    ...(gate === 0 || gate === 1 || gate === 2 ? { gateAttempts: gate } : {}),
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
