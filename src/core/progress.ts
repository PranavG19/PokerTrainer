/**
 * PROGRESS DISPLAY — PRODUCT-SPEC P1, P2, P3, P5, and G7.
 *
 * This module's job is HONESTY, so most of it is about what it refuses to emit.
 *
 * FIVE NUMBERS, AND ONLY FIVE (P1). `METRIC_KEYS` is the closed list. A sixth metric is the most
 * likely thing a future change adds — every dashboard grows — so the key list is exported and the
 * returned object is asserted against it, which turns "one more number" into a failing test rather
 * than a quiet ship.
 *
 * THE FIFTH IS ABSENT, NOT ZERO (P1). Win rate vs the bot population is the only outcome number the
 * spec permits, and only because it aggregates over thousands of hands instead of attaching to a
 * decision. Below 2,000 hands the key is missing from the structure entirely: a zero or a
 * "—" placeholder is still a number on a screen, and a number on a screen invites reading it.
 * It carries a confidence band, and it is never a trend line and never a target.
 *
 * NO RESULTS GRAPH UNDER 10,000 HANDS (P3). The refusal is a value, not an empty dataset, because
 * an empty chart reads as "no progress" rather than "this measurement is not yet meaningful"; it
 * names the variance module as the alternative. Above the threshold the chip series and the EV
 * series are returned TOGETHER — their divergence is the lesson, and either one alone is a lie.
 *
 * AGGREGATE BY ERROR TAG, NEVER BY TRAIT (G7). "SIZING: 1.9 bb/100 across 340 decisions" is a fact
 * about a class of decisions. "You're too loose" is a claim about a person, is not actionable, and
 * is what `bannedPhrasingIn` exists to keep out.
 *
 * Every function takes an explicit `now`. Nothing here reads the clock.
 */

/** G7's fixed precedence order, upstream first. One tag per decision. */
export const ERROR_TAGS = [
  'RANGE',
  'TEXTURE',
  'PRICE',
  'BLOCKERS',
  'SIZING',
  'DEPTH-POSITION',
  'PURITY',
] as const;

export type ErrorTag = (typeof ERROR_TAGS)[number];

export const WEEK_MS = 7 * 86_400_000;

/** P1: the win-rate metric is withheld below this many hands. */
export const WIN_RATE_MIN_HANDS = 2000;

/** P3: below this, the results graph is refused outright. */
export const RESULTS_GRAPH_MIN_HANDS = 10_000;

/** P1: 200+ graded decisions a week. A target on effort, which is the only thing effort may target. */
export const WEEKLY_DECISION_TARGET = 200;

export interface DecisionRecord {
  /** Absolute epoch ms, so a week window can be simulated rather than waited out. */
  readonly at: number;
  /** P4 assessment spots are graded separately: only they feed the EV-loss metric. */
  readonly mode: 'practice' | 'assessment';
  /** bb lost relative to the best action. Zero for a decision that cost nothing. */
  readonly evLossBb: number;
  /** G7: at most one tag per decision, upstream wins. null means no error to attribute. */
  readonly tag: ErrorTag | null;
  /** The learner declared certainty before seeing the grade. */
  readonly sure: boolean;
  readonly correct: boolean;
}

export interface HandOutcome {
  readonly at: number;
  /** Hero's chip result in big blinds: positive won, negative lost. */
  readonly netBb: number;
  /** All-in-adjusted / EV result for the same hand. Diverges from netBb by variance alone. */
  readonly evBb: number;
  /** Win rate is only comparable within one bot config, so hands carry theirs. */
  readonly botConfigId: string;
}

/**
 * P5 gate A: perceptual fluency is correct AND under an RT threshold. Whether a category passes is
 * the drill layer's call; this module only counts.
 */
export interface FluencyCategory {
  readonly category: string;
  readonly passing: boolean;
}

export interface ProgressInput {
  readonly decisions: readonly DecisionRecord[];
  readonly hands: readonly HandOutcome[];
  readonly fluency: readonly FluencyCategory[];
  /** P1: "against a fixed bot config". Hands from any other config are not counted. */
  readonly botConfigId: string;
}

export const METRIC_KEYS = [
  'gradedDecisionsThisWeek',
  'assessmentEvLossBb100',
  'fluentCategories',
  'sureWrongThisWeek',
  'winRateVsBots',
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export type MetricUnit = 'decisions' | 'bb/100' | 'categories';

export interface Metric {
  readonly key: MetricKey;
  readonly label: string;
  readonly value: number;
  readonly unit: MetricUnit;
  /** How many records the value was computed from. Zero sample is stated, never disguised. */
  readonly sample: number;
  /** Only effort gets a target; every other metric carries null. */
  readonly target: number | null;
}

export interface WinRateMetric {
  readonly key: 'winRateVsBots';
  readonly label: string;
  readonly value: number;
  readonly unit: 'bb/100';
  readonly sample: number;
  /** Always null: P1 forbids this number ever being a target. */
  readonly target: null;
  readonly ciLowerBb100: number;
  readonly ciUpperBb100: number;
  readonly botConfigId: string;
  readonly note: string;
}

/** The fifth key is optional because below the gate it is genuinely not in the structure. */
export interface ProgressMetrics {
  readonly gradedDecisionsThisWeek: Metric;
  readonly assessmentEvLossBb100: Metric;
  readonly fluentCategories: Metric;
  readonly sureWrongThisWeek: Metric;
  readonly winRateVsBots?: WinRateMetric;
}

/** Inclusive of `now`, exclusive of the far edge. Future-dated records are not "this week". */
function inThisWeek(at: number, now: number): boolean {
  return at > now - WEEK_MS && at <= now;
}

function meanEvLossBb100(decisions: readonly DecisionRecord[]): number {
  if (decisions.length === 0) return 0;
  const total = decisions.reduce((sum, d) => sum + d.evLossBb, 0);
  return (total / decisions.length) * 100;
}

/**
 * bb/100 with a 95% band from the per-hand spread. Normal approximation: at the 2,000-hand floor the
 * gate enforces, the central limit theorem is doing real work and an exact interval would not move
 * the band enough to change how it reads.
 */
function winRateBand(netsBb: readonly number[]): { readonly value: number; readonly lower: number; readonly upper: number } {
  const n = netsBb.length;
  const mean = netsBb.reduce((sum, x) => sum + x, 0) / n;
  const variance = netsBb.reduce((sum, x) => sum + (x - mean) ** 2, 0) / n;
  const standardError = Math.sqrt(variance / n);
  return {
    value: mean * 100,
    lower: (mean - 1.96 * standardError) * 100,
    upper: (mean + 1.96 * standardError) * 100,
  };
}

export function computeMetrics(input: ProgressInput, now: number): ProgressMetrics {
  const thisWeek = input.decisions.filter((d) => inThisWeek(d.at, now));
  const assessment = input.decisions.filter((d) => d.mode === 'assessment');
  const passing = input.fluency.filter((f) => f.passing);
  const sureWrong = thisWeek.filter((d) => d.sure && !d.correct);

  const base: ProgressMetrics = {
    gradedDecisionsThisWeek: {
      key: 'gradedDecisionsThisWeek',
      label: 'graded decisions this week',
      value: thisWeek.length,
      unit: 'decisions',
      sample: thisWeek.length,
      target: WEEKLY_DECISION_TARGET,
    },
    assessmentEvLossBb100: {
      key: 'assessmentEvLossBb100',
      label: 'assessment EV loss',
      value: meanEvLossBb100(assessment),
      unit: 'bb/100',
      sample: assessment.length,
      target: null,
    },
    fluentCategories: {
      key: 'fluentCategories',
      label: 'fluent categories',
      value: passing.length,
      unit: 'categories',
      sample: input.fluency.length,
      target: null,
    },
    sureWrongThisWeek: {
      key: 'sureWrongThisWeek',
      label: 'sure and wrong this week',
      value: sureWrong.length,
      unit: 'decisions',
      sample: thisWeek.length,
      target: null,
    },
  };

  const winRate = winRateMetric(input);
  return winRate === null ? base : { ...base, winRateVsBots: winRate };
}

/**
 * P1's gated fifth number. Returns null — not a zero, not a placeholder — below the hand floor,
 * because the whole reason this number is permitted is the size of the sample behind it.
 */
export function winRateMetric(input: ProgressInput): WinRateMetric | null {
  const hands = input.hands.filter((h) => h.botConfigId === input.botConfigId);
  if (hands.length < WIN_RATE_MIN_HANDS) return null;

  const band = winRateBand(hands.map((h) => h.netBb));
  return {
    key: 'winRateVsBots',
    label: 'win rate vs the bot population',
    value: band.value,
    unit: 'bb/100',
    sample: hands.length,
    target: null,
    ciLowerBb100: band.lower,
    ciUpperBb100: band.upper,
    botConfigId: input.botConfigId,
    note: `an instrument, not a promise: aggregated over ${hands.length} hands against bot config ${input.botConfigId}, and read as the band rather than the midpoint`,
  };
}

/**
 * A hand as the session log stores it, seen structurally so this module needs no dependency on
 * session.ts. Only the fields the decision metric reads are named; a HandRecord is assignable to it.
 */
export interface LoggedHand {
  readonly playedAt?: number;
  readonly decisions?: readonly {
    readonly verdict: { readonly severity: 'free' | 'notable' | 'serious'; readonly evLossBb: number } | null;
  }[];
}

/**
 * Flatten a session's hand log into the decision records the effort metric reasons over. Honest by
 * construction and by omission:
 *  - Every decision maps to `mode: 'practice'` — nothing in the app runs an assessment block, so the
 *    assessment EV-loss metric stays legitimately empty rather than being fed practice spots.
 *  - `correct` is the coach's own silence rule: severity 'free' means it found nothing to fault.
 *  - `tag` is null: the coach grades by `principle` (e.g. "pot odds"), which is NOT one of G7's
 *    ErrorTags, so inventing a mapping would fabricate an attribution the coach never made.
 *  - `sure` is false: whether the hero was sure is the prediction layer's datum (calibration), not a
 *    property of a played decision, and claiming certainty here would double-count it.
 * A hand with no `playedAt` (legacy) or no verdict on a decision is skipped — an undated decision
 * cannot be placed in a week, and pretending it happened now would inflate "this week".
 */
export function decisionRecordsFromHands(hands: readonly LoggedHand[]): DecisionRecord[] {
  const out: DecisionRecord[] = [];
  for (const hand of hands) {
    if (hand.playedAt === undefined || hand.decisions === undefined) continue;
    for (const decision of hand.decisions) {
      if (decision.verdict === null) continue;
      out.push({
        at: hand.playedAt,
        mode: 'practice',
        evLossBb: decision.verdict.evLossBb,
        tag: null,
        sure: false,
        correct: decision.verdict.severity === 'free',
      });
    }
  }
  return out;
}

export type ResultsGraph =
  | {
      readonly kind: 'refused';
      readonly reason: string;
      /** A route id, so the caller links the variance module instead of inventing its own copy. */
      readonly alternative: 'variance-module';
      readonly handsShort: number;
    }
  | {
      readonly kind: 'series';
      /** Cumulative bb, chronological. Returned beside evBb because the pair is the lesson. */
      readonly chipBb: readonly number[];
      readonly evBb: readonly number[];
      readonly hands: number;
      readonly lesson: string;
    };

function cumulative(values: readonly number[]): number[] {
  const out: number[] = [];
  let running = 0;
  for (const value of values) {
    running += value;
    out.push(running);
  }
  return out;
}

/**
 * P3. Under 10,000 hands this refuses and names the alternative. An empty or short chart is worse
 * than no chart: it reads as a verdict on the player when it is a statement about the sample.
 */
export function resultsGraph(hands: readonly HandOutcome[]): ResultsGraph {
  if (hands.length < RESULTS_GRAPH_MIN_HANDS) {
    return {
      kind: 'refused',
      reason: `a results graph over ${hands.length} hands shows variance, not skill; ${RESULTS_GRAPH_MIN_HANDS} hands is the floor where the line means anything. The variance module covers what the graph cannot yet say.`,
      alternative: 'variance-module',
      handsShort: RESULTS_GRAPH_MIN_HANDS - hands.length,
    };
  }

  const chronological = [...hands].sort((a, b) => a.at - b.at);
  return {
    kind: 'series',
    chipBb: cumulative(chronological.map((h) => h.netBb)),
    evBb: cumulative(chronological.map((h) => h.evBb)),
    hands: chronological.length,
    lesson: 'the gap between the two lines is variance; where they part company is the whole point of showing both',
  };
}

/**
 * The minimum a caller must hand over to render a KC bar. Deliberately NOT `schedule.ts`'s
 * `Posterior` and `Gate` — schedule.ts owns the learner-model maths (beta-binomial with decay, P6)
 * and this module owns only the display, so the two compose through a plain shape instead of an
 * import in either direction.
 */
export interface KcEvidence {
  readonly id: string;
  readonly label: string;
  readonly status: 'learning' | 'mastered' | 'frozen';
  readonly posteriorMean: number;
  readonly ciLower: number;
  readonly ciUpper: number;
  readonly opportunities: number;
  /** The dominant error tag on this KC. P5 gate B requires it on anything frozen. */
  readonly errorSignature: ErrorTag | null;
}

export interface KcBar {
  readonly id: string;
  readonly label: string;
  readonly status: KcEvidence['status'];
  /** Posterior mean clamped to [0, 1] so a stray value cannot render as a negative bar. */
  readonly fill: number;
  readonly ciLower: number;
  readonly ciUpper: number;
  readonly opportunities: number;
  readonly errorSignature: ErrorTag | null;
  readonly caption: string;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function kcCaption(kc: KcEvidence): string {
  const posterior = `posterior ${kc.posteriorMean.toFixed(2)} (${kc.ciLower.toFixed(2)}–${kc.ciUpper.toFixed(2)}) over ${kc.opportunities} opportunities`;
  if (kc.status === 'frozen') {
    const signature = kc.errorSignature ?? 'unattributed';
    return `frozen — signature ${signature}; ${posterior}; a worked example is the next step, not another rep`;
  }
  if (kc.status === 'mastered') return `mastered — ${posterior}`;
  return `learning — ${posterior}`;
}

export function kcBar(kc: KcEvidence): KcBar {
  return {
    id: kc.id,
    label: kc.label,
    status: kc.status,
    fill: clamp01(kc.posteriorMean),
    ciLower: kc.ciLower,
    ciUpper: kc.ciUpper,
    opportunities: kc.opportunities,
    errorSignature: kc.errorSignature,
    caption: kcCaption(kc),
  };
}

/**
 * P2's primary progress surface. Nothing is filtered: the Lifecycle rules keep a frozen KC visible
 * with its error signature, so hiding one here — the obvious "clean up the list" change — would
 * quietly delete the only place that error is named.
 */
export function kcBars(kcs: readonly KcEvidence[]): KcBar[] {
  return kcs.map(kcBar);
}

export interface TagAggregate {
  readonly tag: ErrorTag;
  readonly evLossBb100: number;
  /**
   * The scope the rate was computed over — ALL graded decisions, not just the tagged ones. A per-tag
   * denominator would make a rare, expensive tag look like the biggest leak and the rates would not
   * be comparable or additive; against a shared denominator each tag's bb/100 is its actual share of
   * the total leak rate.
   */
  readonly decisions: number;
  readonly occurrences: number;
}

/** G7. Aggregates by tag, largest leak first; ties break on tag order so output is deterministic. */
export function tagAggregates(decisions: readonly DecisionRecord[]): TagAggregate[] {
  const scope = decisions.length;
  if (scope === 0) return [];

  const aggregates = ERROR_TAGS.map((tag) => {
    const tagged = decisions.filter((d) => d.tag === tag);
    const totalLoss = tagged.reduce((sum, d) => sum + d.evLossBb, 0);
    return {
      tag,
      evLossBb100: (totalLoss / scope) * 100,
      decisions: scope,
      occurrences: tagged.length,
    };
  }).filter((a) => a.occurrences > 0);

  return aggregates.sort(
    (a, b) => b.evLossBb100 - a.evLossBb100 || ERROR_TAGS.indexOf(a.tag) - ERROR_TAGS.indexOf(b.tag),
  );
}

/** G7's sanctioned wording, verbatim: a fact about a class of decisions, not a label for a person. */
export function formatTagAggregate(aggregate: TagAggregate): string {
  return `${aggregate.tag}: ${aggregate.evLossBb100.toFixed(1)} bb/100 across ${aggregate.decisions} decisions`;
}

/**
 * Phrasings this module must never emit. Two families: gamification (streaks, ranks, percentiles,
 * XP — all of which reward showing up rather than deciding well) and trait attribution (G7 — a tag
 * describes a decision, an adjective describes a person and cannot be practised).
 */
// The gamification vocabulary (streak/xp/rank/badge/leaderboard/personal best/…) was removed from this
// list on 2026-08-14 by explicit product decision: the app is adding honest progress features (streaks,
// a record screen, milestones) built on real logged data, so those words are now allowed. What REMAINS
// banned is the G7 pedagogy rule that has nothing to do with gamification: never make a TRAIT claim about
// the person ("you are a nit", "too loose") and never praise ("great job") — a verb describes a decision
// the learner can practise, an adjective describes a person and cannot. That principle is unchanged.
export const BANNED_PHRASINGS: readonly string[] = [
  'you are',
  "you're",
  'too loose',
  'too tight',
  'too passive',
  'too aggressive',
  'nit',
  'maniac',
  'fish',
  'keep it up',
  'great job',
  'well done',
];

/**
 * Returns the offending phrase, or null. Matching is on word boundaries, not substrings: "nit" as a
 * substring flags "unit" and "definition", and a check that cries wolf gets deleted.
 *
 * Exported so the ban list can be asserted over every string this module emits rather than trusted
 * — the same reason schedule.ts exports `assertFlatGaps`.
 */
export function bannedPhrasingIn(text: string): string | null {
  return (
    BANNED_PHRASINGS.find((phrase) => {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
    }) ?? null
  );
}
