import { DECAY_HALF_LIFE_DAYS } from './schedule.js';
import type { Street } from './table.js';

/**
 * STANDING ("Depth") — the table depth (effective big blinds) a learner has EARNED, computed from decision
 * QUALITY, never from chips. A correct all-in that busts grades ~0 EV-loss, so variance cannot touch it.
 *
 * This module is pure: it reads already-recorded coach grades (evLossBb + principle) plus already-computed
 * mastery counts, and returns a depth tier. It ratchets — the displayed depth never drops below the floor,
 * so a losing session can never demote it (a separate "current form" reading, not built here, is where a
 * bad night shows up).
 *
 * HONEST CEILING: the score is only as good as coach.gradeDecision, which is a Monte-Carlo-vs-random
 * heuristic (not a solver). Depth is a skill ESTIMATE against the game, never solver-grade — present it so.
 */

/** One graded decision, reduced to exactly what the standing score reads. Both AssessmentDecision and a
 *  played DecisionRecord (with its coach verdict) map onto this shape. Fields are optional because a legacy
 *  save may lack them — and absence is treated as "not eligible", never guessed. */
export interface StandingDecision {
  /** Absolute epoch ms the decision was graded (for recency decay). */
  readonly at: number;
  /** bb lost vs the best action, straight from the coach. >= 0. */
  readonly evLossBb: number;
  /** The coach principle: 'pot odds' | 'ranges' | 'value or bluff' | null. */
  readonly principle?: string | null;
  /** What it cost to continue; > 0 means a real price was faced (a CONTESTED spot). */
  readonly toCall?: number;
  /** The street the decision was made on. */
  readonly street?: Street;
}

export type Depth = 0 | 40 | 75 | 125 | 200;

/** The depth ladder, shallow→deep. 0 = "Calibrating" (not yet certified past the sample floor). */
export const DEPTHS: readonly Depth[] = [0, 40, 75, 125, 200];

/** A calm, non-BANNED label for each depth. Named by the table, never "rank/level/percentile". */
export function depthLabel(depth: Depth): string {
  return depth === 0 ? 'Calibrating' : `${depth}bb table`;
}

/**
 * The starting stack in CHIPS for a given depth, at the table's big blind. Depth 0 (Calibrating) has no
 * earned depth yet, so it plays the classic 100bb table — the caller passes null to mean "use the table
 * default" rather than forcing a number here. A 40bb table is 40×bb chips, a 200bb table 200×bb, which
 * is the whole point of the climb: a deeper table is a genuinely different game (the AI's commitTax now
 * makes villains play it honestly). Pure and unit-tested so main.ts stays a thin assembler.
 */
export function depthToStack(depth: Depth, bb: number): number | null {
  return depth === 0 ? null : depth * bb;
}

/**
 * The coach charges that are SOUND break-even math and safe to rank on. 'pot odds' (call/fold facing a bet)
 * and 'ranges' (raise over a bet) misjudge a real price. EXCLUDED: 'value or bluff' — the coach has NO
 * fold-equity model, so it charges correct semi-bluffs as leaks; ranking on it would train nitty play.
 * A `free` decision (cost 0, principle null) is eligible on its own merit (it was a correct no-cost play).
 */
const SOUND_PRINCIPLES: ReadonlySet<string> = new Set(['pot odds', 'ranges']);

/**
 * PROVISIONAL CONSTANTS — flagged for a spec-literal audit against real decision logs (open question in
 * [[offsuit-ranking-design]]). A wrong ceiling makes a depth trivially or never reachable.
 *
 * Sample floors: you cannot certify any depth until you have faced enough contested decisions, and the
 * deep tiers additionally demand contested POSTFLOP decisions (preflop pot-odds alone must not buy depth).
 */
export const MIN_CONTESTED = 40;
export const MIN_CONTESTED_POSTFLOP_DEEP = 20;

/** EV-loss/decision ceilings (bb) that TIGHTEN with depth: a deeper table demands a smaller proven leak.
 *  The score compared against these is the PESSIMISTIC (CI-upper) bound, so a thin/lucky sample scores
 *  worse and cannot buy a promotion. */
const DEPTH_CEILING: Record<Exclude<Depth, 0>, number> = {
  40: 3.0,
  75: 2.2,
  125: 1.4,
  200: 0.8,
};

/** Deep tiers require a body of contested postflop decisions, not just preflop pot-odds. */
const REQUIRES_POSTFLOP: ReadonlySet<Depth> = new Set<Depth>([125, 200]);

export interface PlayScore {
  readonly status: 'calibrating' | 'scored';
  /** The pessimistic (CI-upper) bound of mean EV-loss per eligible decision, in bb. Lower is better. */
  readonly score: number;
  /** Eligible, contested decisions in the weighted sample. */
  readonly sample: number;
  /** Of those, how many were contested POSTFLOP (the deep-tier gate). */
  readonly contestedPostflop: number;
}

/** A decision counts toward the score iff it is BOTH eligible (sound-math or free) AND contested (real price). */
function counts(d: StandingDecision): boolean {
  const eligible =
    (d.principle != null && SOUND_PRINCIPLES.has(d.principle)) ||
    // A free/no-cost decision has a null principle but was a correct play on its merits.
    (d.principle == null && d.evLossBb === 0);
  const contested = typeof d.toCall === 'number' && d.toCall > 0;
  return eligible && contested;
}

function isPostflop(street: Street | undefined): boolean {
  return street === 'flop' || street === 'turn' || street === 'river';
}

/**
 * The play score: the pessimistic bound of decayed mean EV-loss over eligible, contested decisions.
 *
 * WEIGHTING is recency-decay only (30-day half-life, the app's existing constant). NOT pot-weighted:
 * coach.evLossBb is already `(required − equity) × (pot + toCall) / bb`, so pot size is already embedded in
 * each decision's magnitude — weighting by pot again would double-count leverage.
 *
 * The band mirrors progress.ts winRateBand's normal approximation exactly: score = mean + 1.96·SE, so a
 * small or lucky sample has a wide band and a HIGHER (worse) score. Below MIN_CONTESTED it is 'calibrating'.
 */
export function playScore(decisions: readonly StandingDecision[], now: number): PlayScore {
  const eligible = decisions.filter(counts);
  const contestedPostflop = eligible.filter((d) => isPostflop(d.street)).length;

  if (eligible.length < MIN_CONTESTED) {
    return { status: 'calibrating', score: Infinity, sample: eligible.length, contestedPostflop };
  }

  const MS_PER_DAY = 86_400_000;
  const weightOf = (d: StandingDecision): number => {
    const ageDays = Math.max(0, (now - d.at) / MS_PER_DAY);
    return Math.pow(0.5, ageDays / DECAY_HALF_LIFE_DAYS);
  };

  const weights = eligible.map(weightOf);
  const totalW = weights.reduce((s, w) => s + w, 0);
  if (totalW <= 0) {
    return { status: 'calibrating', score: Infinity, sample: eligible.length, contestedPostflop };
  }

  const mean = eligible.reduce((s, d, i) => s + weights[i] * d.evLossBb, 0) / totalW;
  const variance = eligible.reduce((s, d, i) => s + weights[i] * (d.evLossBb - mean) ** 2, 0) / totalW;
  // Effective sample size for a weighted mean (Kish): (Σw)² / Σw². Falls back to count when weights are equal.
  const sumSqW = weights.reduce((s, w) => s + w * w, 0);
  const nEff = sumSqW > 0 ? (totalW * totalW) / sumSqW : eligible.length;
  const standardError = Math.sqrt(variance / nEff);

  return {
    status: 'scored',
    score: mean + 1.96 * standardError,
    sample: eligible.length,
    contestedPostflop,
  };
}

/** The deepest tier the play score alone allows. Calibrating → 0. */
export function playGate(play: PlayScore): Depth {
  if (play.status === 'calibrating') return 0;
  let earned: Depth = 0;
  for (const depth of DEPTHS) {
    if (depth === 0) continue;
    const ceiling = DEPTH_CEILING[depth as Exclude<Depth, 0>];
    if (play.score > ceiling) break; // tiers ascend by tightening ceiling; once we miss one, stop.
    if (REQUIRES_POSTFLOP.has(depth) && play.contestedPostflop < MIN_CONTESTED_POSTFLOP_DEEP) break;
    earned = depth;
  }
  return earned;
}

/**
 * The mastery KEY: how deep the learner's studied concepts let them sit. Reads counts the caller already
 * computes for the Progress screen (mastered-KC count via schedule.gate, puzzle coverage = scenarios solved
 * clean). Per-tier thresholds so no single easy category carries a depth. PROVISIONAL — audit like the
 * ceilings.
 */
export function masteryGate(masteredKcCount: number, puzzleCoverage: number): Depth {
  // Thresholds pair a mastered-KC count with a puzzle-coverage floor so study and application advance
  // together. Deliberately gentle at the shallow end (a beginner reaches 40bb by learning the basics).
  if (masteredKcCount >= 12 && puzzleCoverage >= 8) return 200;
  if (masteredKcCount >= 8 && puzzleCoverage >= 5) return 125;
  if (masteredKcCount >= 5 && puzzleCoverage >= 3) return 75;
  if (masteredKcCount >= 2 && puzzleCoverage >= 1) return 40;
  return 0;
}

export interface Standing {
  /** The depth to display now — min of the two gates, ratcheted up by the floor, never below it. */
  readonly depth: Depth;
  /** The permanent floor: the deepest depth ever earned. Persisted on SessionState. */
  readonly floor: Depth;
  /** The raw current depth this instant (before the ratchet), for the caller to persist as the new floor. */
  readonly current: Depth;
}

/** The deepest DEPTHS entry that is <= n (used to snap a persisted floor onto the ladder). */
function snapToLadder(n: number): Depth {
  let out: Depth = 0;
  for (const d of DEPTHS) if (d <= n) out = d;
  return out;
}

/**
 * Combine both gates and the persisted floor into the standing to show. The current depth is
 * min(playGate, masteryGate) — you cannot grind hands past the concepts you have, nor claim mastery you
 * cannot execute. The DISPLAYED depth is the max of that and the floor, so it only ever ratchets up.
 */
export function standing(
  input: {
    readonly decisions: readonly StandingDecision[];
    readonly masteredKcCount: number;
    readonly puzzleCoverage: number;
    readonly depthFloor: number;
  },
  now: number,
): Standing {
  const play = playGate(playScore(input.decisions, now));
  const mastery = masteryGate(input.masteredKcCount, input.puzzleCoverage);
  const current = Math.min(play, mastery) as Depth;
  const floor = snapToLadder(input.depthFloor);
  const depth = (Math.max(current, floor) as Depth);
  return { depth, floor, current };
}

/**
 * CURRENT FORM (clause c of the Depth design) — a coarse, three-state reading of how the learner is playing
 * RIGHT NOW, deliberately separate from the ratcheted depth. Depth never drops; a bad night shows up HERE
 * instead. This is a mood, not a gate: it routes into the recommender ("warm up first") and never touches
 * the floor. It reads the same honest evLossBb over the same eligible+contested filter as playScore, but
 * only over the most recent decisions, and uses a PLAIN mean — no CI band — because a short window's band
 * is so wide it would read 'rusty' forever, defeating the point of a live signal.
 *
 * PROVISIONAL CONSTANTS (audit with the ceilings): the window size, the minimum sample to say anything, and
 * the two mean-EV thresholds.
 */
export const FORM_WINDOW = 15;
export const MIN_FORM_SAMPLE = 6;
const FORM_SHARP_CEILING = 1.0;
const FORM_WARMING_CEILING = 2.5;

export type FormState = 'settling' | 'sharp' | 'warming up' | 'rusty';

export interface CurrentForm {
  /** 'settling' when too few recent eligible decisions to read; otherwise the mood. */
  readonly state: FormState;
  /** Plain mean EV-loss (bb) over the recent eligible, contested window. NaN when settling. */
  readonly meanEvLossBb: number;
  /** How many recent eligible, contested decisions the reading is based on. */
  readonly sample: number;
}

/**
 * Read current form over the most recent FORM_WINDOW eligible, contested decisions. `decisions` may be in
 * any order; recency is taken by `at`, so a caller need not pre-sort. Below MIN_FORM_SAMPLE it is 'settling'
 * (honest "not enough to say" — never a fabricated verdict). No decay weighting: the window is already short
 * and every decision in it is recent, so an extra half-life curve would just add noise to a mood reading.
 */
export function currentForm(decisions: readonly StandingDecision[], now: number): CurrentForm {
  void now; // recency comes from ordering by `at`, not a decay curve — kept for signature parity with playScore.
  const recent = decisions
    .filter(counts)
    .slice()
    .sort((a, b) => b.at - a.at)
    .slice(0, FORM_WINDOW);

  if (recent.length < MIN_FORM_SAMPLE) {
    return { state: 'settling', meanEvLossBb: NaN, sample: recent.length };
  }

  const mean = recent.reduce((s, d) => s + d.evLossBb, 0) / recent.length;
  const state: FormState =
    mean < FORM_SHARP_CEILING ? 'sharp' : mean < FORM_WARMING_CEILING ? 'warming up' : 'rusty';
  return { state, meanEvLossBb: mean, sample: recent.length };
}

/**
 * Puzzle coverage = how many scenarios the learner has SOLVED CLEAN (best solve got every decision right,
 * i.e. bestCorrect === the scenario's step count). Pure so main.ts stays a thin assembler and this counting
 * rule is unit-tested rather than hand-inlined at the composition root. A scenario absent from progress, or
 * whose best solve missed a step, does not count. `stepCounts` maps scenarioId → number of target steps
 * (the caller reads it from SCENARIOS.target.length), so this module needs no puzzle import.
 */
export function puzzleCoverage(
  progress: Readonly<Record<string, { readonly bestCorrect: number }>>,
  stepCounts: Readonly<Record<string, number>>,
): number {
  let solved = 0;
  for (const [id, steps] of Object.entries(stepCounts)) {
    if (steps > 0 && progress[id]?.bestCorrect === steps) solved += 1;
  }
  return solved;
}
