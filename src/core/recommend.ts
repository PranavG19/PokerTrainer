/**
 * THE RECOMMENDER — PRODUCT-SPEC N2, and N4's override log.
 *
 * N2: "Home shows ONE recommended next action with a one-line reason. Its inputs: unpassed fluency
 * gates in phase order, KC mastery posteriors, spacing debt (concepts past due), and the last
 * session's top error tags. It NEVER shows a ranked list — a list is a queue, and a queue is a soft
 * lock."
 *
 * WHY THE RETURN TYPE IS ONE SUGGESTION AND NOT AN ARRAY. This is the whole design constraint, and it
 * is enforced by the type rather than by remembering: `recommend()` returns a single `Suggestion`, so a
 * renderer literally cannot paginate a queue out of it. Internally it does rank candidates — it has to,
 * to pick — but the ranking is not a return value, and `candidateCount` is exposed as a NUMBER rather
 * than as the list, so a screen can honestly say "3 other things are due" without becoming a queue.
 *
 * N1 IS NOT VIOLATED BY A RECOMMENDATION. Nothing here gates anything: a suggestion is a suggestion,
 * every surface stays reachable, and declining is a first-class action rather than a refusal. That is
 * why `decline()` exists in this module — the override is part of the recommender's contract, not
 * something a screen bolts on.
 *
 * NOTHING READS THE CLOCK. Every function takes `now`, so a recommendation is reproducible from its
 * inputs alone and a test can place the learner at any point in the spacing schedule without waiting.
 */

import { dueNow, gate, posterior, type ConceptState, type DueRep } from './schedule.js';

/** The four input families N2 names, in the order they win ties. */
export const SOURCES = ['spacing-debt', 'fluency-gate', 'mastery', 'error-tag'] as const;
export type Source = (typeof SOURCES)[number];

/**
 * N4: "at which point it asks once what you'd rather work on and adjusts weighting." Five consecutive
 * declines is the trigger, and it is a threshold rather than a ratio so it resets on one acceptance —
 * a learner who takes four suggestions and skips one is not overriding the recommender.
 */
export const CONSECUTIVE_DECLINES_TO_ASK = 5;

/** A concept whose posterior sits below this is still being learned, so reps are the useful action. */
export const LEARNING_POSTERIOR = 0.7;

export interface Suggestion {
  readonly source: Source;
  /** What to do, imperative and short. The screen renders this as the action. */
  readonly action: string;
  /** N2's one-line reason. Carries the numbers, because a reason without them is a slogan. */
  readonly reason: string;
  /** Which concept or tag it is about, for the override log and for routing a click. */
  readonly subject: string;
  /**
   * How many OTHER candidates existed. A count, deliberately not the list: it lets a screen be honest
   * about there being more without rendering the queue N2 forbids.
   */
  readonly otherCandidates: number;
}

/** N4: `{timestamp, recommended, chosen}`, exactly as the spec names the fields. */
export interface Override {
  readonly timestamp: number;
  readonly recommended: string;
  readonly chosen: string;
}

export interface RecommenderState {
  readonly overrides: readonly Override[];
  /** Reset by any acceptance. Only a run of declines counts toward N4's ask-once trigger. */
  readonly consecutiveDeclines: number;
  /** Sources the learner said they would rather work on, after the N4 conversation. */
  readonly preferred: readonly Source[];
}

export function emptyRecommender(): RecommenderState {
  return { overrides: [], consecutiveDeclines: 0, preferred: [] };
}

export interface RecommendInput {
  readonly concepts: readonly ConceptState[];
  /** From SessionSummary.leaks — principle, count, and cost. Ranked by COST, never by count. */
  readonly leaks: readonly { principle: string; count: number; costBb: number }[];
  readonly recommender: RecommenderState;
  readonly now: number;
}

interface Candidate extends Omit<Suggestion, 'otherCandidates'> {
  /** Higher wins. Never returned — the ranking exists to pick one, not to be shown. */
  readonly weight: number;
}

/**
 * Spacing debt first, and this ordering is a claim worth stating: a concept past due is DECAYING, so a
 * rep on it recovers something already paid for, while a rep on a new concept only adds. Q4 calls the
 * spacing schedule the only retention mechanism in the system, so debt outranks novelty.
 */
function spacingCandidates(input: RecommendInput): Candidate[] {
  return dueNow(input.concepts, input.now).map((due: DueRep) => ({
    source: 'spacing-debt' as const,
    subject: due.conceptId,
    action: `${due.reps} rep${due.reps === 1 ? '' : 's'} on ${due.conceptId}`,
    reason:
      due.overdueDays > 0
        ? `${due.conceptId} is ${due.overdueDays} day${due.overdueDays === 1 ? '' : 's'} past its day-${due.waveDay} wave`
        : `${due.conceptId} is due today at its day-${due.waveDay} wave`,
    // Overdue days dominate, so the most decayed concept wins. +100 keeps every debt above every
    // non-debt candidate without needing a second sort key.
    weight: 100 + due.overdueDays,
  }));
}

/**
 * A frozen gate is NOT a candidate for more reps — P5's hard cap says a frozen KC is routed to a worked
 * example and "never another rep", so recommending one would contradict the gate that produced it.
 */
function gateCandidates(input: RecommendInput): Candidate[] {
  const candidates: Candidate[] = [];
  for (const concept of input.concepts) {
    const status = gate(concept, input.now);
    const post = posterior(concept, input.now);
    if (status.status === 'frozen') {
      candidates.push({
        source: 'fluency-gate',
        subject: concept.id,
        action: `Work the ${concept.id} example`,
        reason: `${concept.id} hit its opportunity cap at ${(post.mean * 100).toFixed(0)}% — reps stopped helping, so read the worked example`,
        // Above learning candidates: a frozen KC is a stalled one and the example is the only move.
        weight: 60,
      });
      continue;
    }
    if (status.status === 'learning' && post.mean < LEARNING_POSTERIOR) {
      candidates.push({
        source: 'fluency-gate',
        subject: concept.id,
        action: `Drill ${concept.id}`,
        reason: `${concept.id} sits at ${(post.mean * 100).toFixed(0)}% over ${post.opportunities} opportunit${post.opportunities === 1 ? 'y' : 'ies'}, below the ${(LEARNING_POSTERIOR * 100).toFixed(0)}% a gate needs`,
        // Lower posterior first: the weakest concept is the most useful rep.
        weight: 50 + (1 - post.mean) * 10,
      });
    }
  }
  return candidates;
}

/**
 * Mastery candidates are the concepts CLOSE to passing — the ones where a few reps convert a nearly
 * passed gate into a passed one. Deliberately ranked below still-learning concepts, because a gate
 * almost passed is worth less than a gate not approached.
 */
function masteryCandidates(input: RecommendInput): Candidate[] {
  const candidates: Candidate[] = [];
  for (const concept of input.concepts) {
    const status = gate(concept, input.now);
    const post = posterior(concept, input.now);
    if (status.status !== 'learning' || post.mean < LEARNING_POSTERIOR) continue;
    candidates.push({
      source: 'mastery',
      subject: concept.id,
      action: `Finish ${concept.id}`,
      reason: `${concept.id} is at ${(post.mean * 100).toFixed(0)}% with ${post.opportunities} opportunit${post.opportunities === 1 ? 'y' : 'ies'} — a few more closes the gate`,
      weight: 30 + post.mean * 10,
    });
  }
  return candidates;
}

/**
 * RANKED BY COST, NEVER BY COUNT, and session.ts already learned this lesson the hard way: ranking by
 * frequency buries one 20 bb blunder under five 0.6 bb ones. The expensive leak is the one to fix.
 */
function leakCandidates(input: RecommendInput): Candidate[] {
  return input.leaks
    .filter((leak) => leak.costBb > 0)
    .map((leak) => ({
      source: 'error-tag' as const,
      subject: leak.principle,
      action: `Review ${leak.principle}`,
      reason: `${leak.principle} cost ${leak.costBb.toFixed(1)} bb across ${leak.count} hand${leak.count === 1 ? '' : 's'} — your most expensive leak`,
      weight: 20 + Math.min(9, leak.costBb),
    }));
}

/**
 * The one suggestion. Returns null only when there is genuinely nothing to suggest — a fresh profile
 * with no concepts and no leaks — and the screen must then say so rather than inventing an action.
 *
 * N4's weighting adjustment is applied HERE rather than by re-sorting downstream: a preferred source
 * gets a bonus large enough to outrank a rival family but NOT large enough to beat spacing debt, because
 * a learner's preference may reorder what they work on and may not switch off the only retention
 * mechanism in the system.
 */
export function recommend(input: RecommendInput): Suggestion | null {
  /*
   * THE BONUS IS A BAND PROMOTION, NOT AN INCREMENT, and it took a measurement to get right. The first
   * version added a flat 25, which changed the answer in NONE of eight scenarios: the families sit in
   * bands 100 / 60 / 50 / 30 / 20, so +25 cannot lift `error-tag` (~23) past `fluency-gate` (~57) and
   * N4's promise that the recommender "adjusts weighting" was silently inert
   * (scripts/audit-w6/a33-preference-weights.ts).
   *
   * So a preferred family is promoted to just BELOW the spacing-debt floor of 100 instead, keeping its
   * within-family ordering via the fractional part. That makes the preference actually reorder families
   * — which is the whole point — while still never outranking spacing debt, because a learner may
   * reorder what they work on and may not switch off the only retention mechanism in the system.
   */
  const PREFERRED_BAND = 90;
  const candidates = [
    ...spacingCandidates(input),
    ...gateCandidates(input),
    ...masteryCandidates(input),
    ...leakCandidates(input),
  ].map((candidate) =>
    input.recommender.preferred.includes(candidate.source)
      ? // Keep the fraction so two preferred candidates still rank against each other.
        { ...candidate, weight: PREFERRED_BAND + (candidate.weight % 10) }
      : candidate,
  );

  if (candidates.length === 0) return null;

  // Deterministic: weight, then source order, then subject. Two runs on the same inputs must agree, or
  // the recommendation would flicker between reloads.
  const ranked = [...candidates].sort(
    (a, b) =>
      b.weight - a.weight ||
      SOURCES.indexOf(a.source) - SOURCES.indexOf(b.source) ||
      a.subject.localeCompare(b.subject),
  );

  const { weight: _weight, ...winner } = ranked[0];
  return { ...winner, otherCandidates: ranked.length - 1 };
}

/** Accepting resets the decline run — N4's trigger is about a pattern, not a tally. */
export function accept(state: RecommenderState): RecommenderState {
  return { ...state, consecutiveDeclines: 0 };
}

/**
 * N4: every override is logged as {timestamp, recommended, chosen}. `chosen` is what the learner did
 * instead, which may be nothing in particular — an empty string records the decline honestly rather
 * than inventing an alternative they never named.
 */
export function decline(
  state: RecommenderState,
  suggestion: Suggestion,
  chosen: string,
  timestamp: number,
): RecommenderState {
  return {
    ...state,
    overrides: [...state.overrides, { timestamp, recommended: suggestion.subject, chosen }],
    consecutiveDeclines: state.consecutiveDeclines + 1,
  };
}

/**
 * N4's ask-once trigger. True at exactly the threshold and while it persists; the caller records the
 * answer with `prefer`, which resets the run so the question is not asked again immediately.
 */
export function shouldAskPreference(state: RecommenderState): boolean {
  return state.consecutiveDeclines >= CONSECUTIVE_DECLINES_TO_ASK;
}

/** Records the answer to N4's question and clears the run that triggered it. */
export function prefer(state: RecommenderState, source: Source): RecommenderState {
  const preferred = state.preferred.includes(source) ? state.preferred : [...state.preferred, source];
  return { ...state, preferred, consecutiveDeclines: 0 };
}
