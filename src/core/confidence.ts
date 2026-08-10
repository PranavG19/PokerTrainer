/**
 * CONFIDENCE ROUTING — PRODUCT-SPEC G8, the full 2x2, plus the latency cross-check.
 *
 * predict.ts already collects the commitment (action + SURE/GUESS) and grades it into a
 * PredictOutcome. What it does NOT do is treat the four cells differently: `predictResultText`
 * returns one line per outcome and every cell gets the same amount of support. G8 says the four
 * cells get four DIFFERENT treatments, and the direction of one pair is counter-intuitive:
 *
 *   SURE-correct  -> principle name only.            LESS support than any other cell.
 *   GUESS-correct -> full elaboration.               MORE support, for a decision that was RIGHT.
 *
 * That asymmetry is the reason this file exists. A lucky guess is a right answer with no rule
 * behind it — "the lucky guess that inflates every metric" — so it is the cell where explanation
 * buys the most, while a SURE-correct answer already has the rule and only needs it named. Getting
 * this backwards would look sensible and would quietly reward being right for no reason, so
 * `SUPPORT_RANK` exists to be asserted rather than trusted.
 *
 * SURE-wrong is the highest-value event in the system and is the only cell that carries a schedule:
 * an immediate re-serve, then day 2 and day 7.
 *
 * Nothing here reads the clock, the RNG, or the network. Latency arrives as measured data and the
 * class-level RW aggregate (G2) arrives as a number, because neither is this module's to compute.
 */

import type { Confidence, PredictOutcome, Prediction } from './predict.js';
import { RT_THRESHOLD_MS } from './anomaly.js';
import { assertFlatGaps, type WaveMode } from './schedule.js';

// ---------------------------------------------------------------------------
// 1. THE 2x2
// ---------------------------------------------------------------------------

export type ConfidenceCell = 'sure-correct' | 'sure-wrong' | 'guess-correct' | 'guess-wrong';

export const CONFIDENCE_CELLS: readonly ConfidenceCell[] = [
  'sure-correct',
  'sure-wrong',
  'guess-correct',
  'guess-wrong',
];

/**
 * G8's four support levels, in G8's own words rather than T7's rung names. They do not line up:
 * T7's ladder is `worked example > full correction > principle name only > bare "incorrect"`, and
 * G8 asks for two distinct kinds of full support ("causal chain", "elaboration") where T7 has one.
 * Mapping them onto T7's rungs would have to invent an ordering between those two, so it is not
 * done here — see the note in the module tests about the tie in SUPPORT_RANK.
 */
export type SupportLevel =
  | 'principle-name-only'
  | 'terse-correction-plus-worked-example'
  | 'full-elaboration'
  | 'full-causal-chain';

/**
 * How much explanation each level carries, so the counter-intuitive asymmetry is checkable.
 *
 * The two "full" levels TIE at 3 on purpose. G8 orders `principle-name-only` below `terse
 * correction` below the full treatments by what it asks each to contain, but it says nothing about
 * whether a causal chain is more or less than an elaboration, and inventing a winner would be
 * asserting something the spec does not say.
 */
export const SUPPORT_RANK: Readonly<Record<SupportLevel, number>> = {
  'principle-name-only': 1,
  'terse-correction-plus-worked-example': 2,
  'full-elaboration': 3,
  'full-causal-chain': 3,
};

export type RepetitionLevel = 'standard' | 'higher';

/** A rep the cell schedules. `day` is an offset from the decision; day 0 IS the immediate re-serve. */
export interface ScheduledRep {
  readonly day: number;
  /** schedule.ts's vocabulary, reused rather than redefined. */
  readonly mode: WaveMode;
}

export interface ConfidenceRoute {
  readonly cell: ConfidenceCell;
  readonly support: SupportLevel;
  /** G8 attaches a worked example to GUESS-wrong and to nothing else. */
  readonly workedExample: boolean;
  /** True exactly when `schedule` opens with a day-0 rep. */
  readonly immediateReserve: boolean;
  /** Empty for three cells: only SURE-wrong is scheduled by G8. */
  readonly schedule: readonly ScheduledRep[];
  /**
   * G8's "difficulty up". Scoped to the concept just missed and never global — T7 forbids a global
   * difficulty level outright ("it strips scaffolding from concepts never learned"), and the
   * non-goals list repeats the ban. A caller that applies this to anything wider is breaking T7.
   */
  readonly difficultyUp: boolean;
  readonly repetition: RepetitionLevel;
  /** G8: "this is the highest-value event in the system". True for exactly one cell. */
  readonly highestValue: boolean;
  /** Why this cell gets this treatment. Task-as-subject (G6), no praise, no trait labels (G7). */
  readonly rationale: string;
}

/**
 * SURE-wrong's chain: immediate re-serve, then day 2 and day 7.
 *
 * Day 2 takes 'interleaved' because that is the mode schedule.ts gives its day-1-to-2 wave; day 0
 * takes 'blocked' for the same reason — a re-serve of the spot just missed is the day-0 wave.
 * `assertSureWrongSpacing` checks the resulting gaps against Q4's flat-gap invariant.
 */
export const SURE_WRONG_SCHEDULE: readonly ScheduledRep[] = [
  { day: 0, mode: 'blocked' },
  { day: 2, mode: 'interleaved' },
  { day: 7, mode: 'interleaved' },
];

export const ROUTES: Readonly<Record<ConfidenceCell, ConfidenceRoute>> = {
  'sure-correct': {
    cell: 'sure-correct',
    support: 'principle-name-only',
    workedExample: false,
    immediateReserve: false,
    schedule: [],
    difficultyUp: false,
    repetition: 'standard',
    highestValue: false,
    rationale: 'The rule was already there and it fired; naming it is the whole of what is owed.',
  },
  'sure-wrong': {
    cell: 'sure-wrong',
    support: 'full-causal-chain',
    workedExample: false,
    immediateReserve: true,
    schedule: SURE_WRONG_SCHEDULE,
    difficultyUp: true,
    repetition: 'standard',
    highestValue: true,
    rationale:
      'A confident error is a rule that is wrong and trusted, so the whole causal chain is owed and the spot returns on day 2 and day 7.',
  },
  'guess-correct': {
    cell: 'guess-correct',
    support: 'full-elaboration',
    workedExample: false,
    immediateReserve: false,
    schedule: [],
    difficultyUp: false,
    repetition: 'standard',
    highestValue: false,
    rationale:
      'A right answer with no rule behind it is the cell that inflates every metric, so it gets the full elaboration the score would otherwise hide.',
  },
  'guess-wrong': {
    cell: 'guess-wrong',
    support: 'terse-correction-plus-worked-example',
    workedExample: true,
    immediateReserve: false,
    schedule: [],
    difficultyUp: false,
    repetition: 'higher',
    highestValue: false,
    rationale:
      'A wrong guess is what a guess is for: the correction stays terse, the worked example supplies the missing rule, and repetition does the rest.',
  },
};

/**
 * Which cell a graded prediction lands in, or null when it lands in none.
 *
 * 'deviated' returns null and that is not an omission: predict.ts drops a deviation from the
 * calibration tally because "a hero who committed to one action and played another never tested the
 * prediction", and G8's 2x2 has no fifth cell for an untested commitment. There is nothing to route.
 *
 * The 'match' outcome does not record confidence, so the prediction is the only source for the
 * correct row; the two wrong outcomes carry it themselves. Disagreement between the two means the
 * caller assembled the pair by hand, and misrouting the highest-value event in the system is worth
 * a throw rather than a silent guess at which one meant it.
 */
export function cellFor(prediction: Prediction, outcome: PredictOutcome): ConfidenceCell | null {
  switch (outcome) {
    case 'deviated':
      return null;
    case 'match':
      return prediction.confidence === 'sure' ? 'sure-correct' : 'guess-correct';
    case 'sure-wrong':
    case 'guess-wrong': {
      const impliedConfidence: Confidence = outcome === 'sure-wrong' ? 'sure' : 'guess';
      if (prediction.confidence !== impliedConfidence) {
        throw new Error(
          `outcome ${outcome} contradicts a ${prediction.confidence} commitment — the cell is unroutable`,
        );
      }
      return outcome;
    }
  }
}

export function route(cell: ConfidenceCell): ConfidenceRoute {
  return ROUTES[cell];
}

/** The route for a graded prediction, or null when nothing was tested (see `cellFor`). */
export function routeFor(prediction: Prediction, outcome: PredictOutcome): ConfidenceRoute | null {
  const cell = cellFor(prediction, outcome);
  return cell === null ? null : ROUTES[cell];
}

export function supportRank(cell: ConfidenceCell): number {
  return SUPPORT_RANK[ROUTES[cell].support];
}

/**
 * Q4's anti-massing invariant applied to G8's own chain, exported so a future edit to
 * SURE_WRONG_SCHEDULE cannot quietly mass the repair. Reuses schedule.ts's `assertFlatGaps` rather
 * than restating the rule: 0, 2, 7 has gaps 2 and 5, which is flat in the sense Q4 means.
 */
export function assertSureWrongSpacing(schedule: readonly ScheduledRep[] = SURE_WRONG_SCHEDULE): void {
  const days = schedule.map((rep) => rep.day);
  if (days[0] !== 0) {
    throw new Error(`SURE-wrong must open with the immediate re-serve, got day ${days[0]}`);
  }
  if (!days.includes(2) || !days.includes(7)) {
    throw new Error(`SURE-wrong must be scheduled day 2 AND day 7, got ${days.join(',')}`);
  }
  assertFlatGaps(days);
}

// ---------------------------------------------------------------------------
// 2. THE REMEDIATION QUEUE — CONFIDENCE x CLASS-LEVEL RW
// ---------------------------------------------------------------------------

/**
 * G8's ranking weight for the confidence half of `confidence x class-level RW`.
 *
 * Two, not some fitted number: G8 gives no coefficient, and the only ordering it states is that the
 * SURE error is the high-value one. Doubling says that and nothing more, and it keeps the product
 * readable — a SURE miss outranks a GUESS miss in the same class, and a GUESS miss in a class
 * costing more than twice as much still outranks it.
 */
export const CONFIDENCE_WEIGHT: Readonly<Record<Confidence, number>> = { sure: 2, guess: 1 };

export interface RemediationCandidate {
  /**
   * G2's granularity: `street x action class` ("faces any flop c-bet"), never a single node. The
   * queue is a list of classes because the RW it ranks by is a class-level aggregate.
   */
  readonly classId: string;
  readonly cell: ConfidenceCell;
  /**
   * The G2 aggregate for this class, in bb/100, as a LOSS MAGNITUDE (larger = more expensive).
   *
   * An input, deliberately. `mean(dEV over decisions in the class) x reach(class) x 100` needs the
   * frozen reference population and the whole decision log; it is computed elsewhere and passed in.
   * G8 is explicit about why it has to be the class aggregate: "a per-decision RW does not exist
   * under G0".
   */
  readonly classRwBbPer100: number;
}

export interface RankedRemediation {
  readonly classId: string;
  readonly cell: ConfidenceCell;
  readonly classRwBbPer100: number;
  readonly confidenceWeight: number;
  /** confidence x class-level RW, which is the whole of G8's ranking rule. */
  readonly score: number;
}

/**
 * G8's remediation queue, most valuable repair first.
 *
 * Only the two wrong cells are queued. A correct decision has no repair to schedule — GUESS-correct
 * is answered with elaboration at the reveal (see ROUTES), which is support, not remediation — so
 * putting it in a repair queue would rank a decision that needs nothing repaired against ones that
 * do. Ties break on classId so the order is deterministic, matching contrastManifest's queue.
 */
export function rankRemediation(
  candidates: readonly RemediationCandidate[],
): readonly RankedRemediation[] {
  return candidates
    .filter((candidate) => isWrongCell(candidate.cell))
    .map((candidate) => {
      const confidenceWeight = CONFIDENCE_WEIGHT[confidenceOf(candidate.cell)];
      return {
        classId: candidate.classId,
        cell: candidate.cell,
        classRwBbPer100: candidate.classRwBbPer100,
        confidenceWeight,
        score: confidenceWeight * candidate.classRwBbPer100,
      };
    })
    .sort((a, b) => b.score - a.score || a.classId.localeCompare(b.classId));
}

export function isWrongCell(cell: ConfidenceCell): boolean {
  return cell === 'sure-wrong' || cell === 'guess-wrong';
}

export function confidenceOf(cell: ConfidenceCell): Confidence {
  return cell === 'sure-correct' || cell === 'sure-wrong' ? 'sure' : 'guess';
}

// ---------------------------------------------------------------------------
// 3. THE LATENCY CROSS-CHECK
// ---------------------------------------------------------------------------

/**
 * "Guess" delivered at recognition speed. RT_THRESHOLD_MS is anomaly.ts's own line between
 * recognising a slot and computing one, and it is imported rather than re-picked so the app has one
 * definition of "fast". A commitment inside it is a trained response, whatever the learner called it.
 *
 * The comparison is `<=`, matching anomaly.ts's `fast = rtMs <= thresholdMs`.
 */
export const GUESS_MIN_MS = RT_THRESHOLD_MS;

/**
 * "Sure" that took most of the COMMIT budget. G5a gives state 2 (action + size + SURE/GUESS) a 20 s
 * budget; spending more than half of it and then reporting SURE is deliberation reported as
 * recognition. Half the budget, not the whole of it, because a commitment made at 19.5 s is not a
 * borderline case of anything.
 */
export const COMMIT_BUDGET_MS = 20_000;
export const SURE_MAX_MS = COMMIT_BUDGET_MS / 2;

/**
 * How many disagreements of the SAME direction inside the window make the pattern persistent.
 *
 * Three, and the floor matters more than the exact number: G8 says flag when the two "disagree
 * PERSISTENTLY", so one fast guess must not flag and neither must two — a learner who happens to
 * know one spot cold and calls it a guess, or who is interrupted mid-commit on one hand, produces
 * one or two of these in a block for reasons that have nothing to do with calibration. Three is the
 * smallest count that cannot be a single incident, and at a 10-decision window it is a 30% rate,
 * which is a habit rather than an accident.
 */
export const PERSISTENT_DISAGREEMENTS = 3;

/**
 * Only the most recent decisions count. Without a window "persistent" would be satisfied for good
 * by three disagreements 400 decisions ago, which describes a learner's past, not their calibration
 * now. Ten is the block size the fluency gate already uses as its minimum sample (anomaly.MIN_TRIALS).
 */
export const LATENCY_WINDOW = 10;

export type LatencyDisagreement = 'sure-but-slow' | 'guess-but-fast';

export interface LatencyCheck {
  readonly confidence: Confidence;
  /** Measured ms from the spot being shown to the commitment landing. Data, never a guess. */
  readonly commitMs: number;
}

export interface LatencyFlag {
  readonly disagreement: LatencyDisagreement;
  readonly count: number;
  /** How many decisions the count is out of — at most LATENCY_WINDOW, fewer early on. */
  readonly window: number;
  readonly message: string;
}

/** One decision's disagreement, or null when the self-report and the clock agree. */
export function latencyDisagreement(check: LatencyCheck): LatencyDisagreement | null {
  if (check.confidence === 'guess' && check.commitMs <= GUESS_MIN_MS) return 'guess-but-fast';
  if (check.confidence === 'sure' && check.commitMs > SURE_MAX_MS) return 'sure-but-slow';
  return null;
}

const FLAG_MESSAGE: Readonly<Record<LatencyDisagreement, string>> = {
  'guess-but-fast': `Commitments marked GUESS keep landing inside ${GUESS_MIN_MS} ms. A decision made at recognition speed is a trained response being logged as a coin flip, which hides the concepts that are already learned.`,
  'sure-but-slow': `Commitments marked SURE keep taking longer than ${SURE_MAX_MS} ms. A decision that needs half the commit budget is being computed, not recognised, and logging it as SURE overstates how settled the rule is.`,
};

/**
 * G8's cross-check. Returns a flag per direction that is persistent inside the window, most
 * frequent first; an empty array is the normal result.
 *
 * The two directions are counted separately because they are different errors with different
 * repairs, and a learner can be at neither, one, or both. Agreeing decisions stay in the window and
 * dilute the count, which is what makes the count a rate rather than a lifetime total.
 */
export function latencyCrossCheck(checks: readonly LatencyCheck[]): readonly LatencyFlag[] {
  const window = checks.slice(-LATENCY_WINDOW);
  const counts: Record<LatencyDisagreement, number> = { 'sure-but-slow': 0, 'guess-but-fast': 0 };
  for (const check of window) {
    const disagreement = latencyDisagreement(check);
    if (disagreement) counts[disagreement] += 1;
  }

  return (Object.entries(counts) as [LatencyDisagreement, number][])
    .filter(([, count]) => count >= PERSISTENT_DISAGREEMENTS)
    .map(([disagreement, count]) => ({
      disagreement,
      count,
      window: window.length,
      message: FLAG_MESSAGE[disagreement],
    }))
    .sort((a, b) => b.count - a.count || a.disagreement.localeCompare(b.disagreement));
}
