/**
 * PER-CONCEPT FADING LADDER — PRODUCT-SPEC T6 (line 328), T7 (line 330), Q2 (line 342),
 * Lifecycle "Reset KC" (line 508), story 22 (line 104).
 *
 * RUNG 0 IS THE MOST SUPPORT, NOT THE LEAST. T7's ordering is worked examples → full correction →
 * principle name only → bare "incorrect" → batched self-marked review. Support is being *faded*
 * away as the ladder is climbed, so rung 4 is the most independent state and rung 0 is the most
 * scaffolded one. "Drops that concept one fading rung" (T6) therefore means moving TOWARD MORE
 * SUPPORT — numerically down, pedagogically backwards, which is exactly what story 22 asks to be
 * shown as a cost. Getting this backwards would make asking "why?" strip scaffolding, i.e. punish
 * the learner with the very failure mode T7's "global difficulty level is forbidden" names.
 * `assertRungZeroIsMostSupport` exists so the direction cannot be quietly inverted.
 *
 * PER CONCEPT, NEVER GLOBAL. There is no writable rung anywhere and no function in this file takes
 * more than one concept. The rung is a fold over events that each carry a `conceptId`, matched by
 * exact string equality — so no event, however crafted (including a `'*'` id), can move a second
 * concept, and a "global difficulty level" is not expressible: it would need an event with no
 * concept, and the event type has no such shape. Callers that want to display many concepts fold
 * many times.
 *
 * RECOMPUTABLE FROM THE LOG. `deriveState` is `events.reduce(applyEvent, initialState(id))`, both
 * halves exported, so an aggregate can be persisted and resumed by replaying only the tail (the
 * Lifecycle rule that aggregates are a cache and never a source of truth). "Reset KC" is not a
 * delete path in this module and there is no delete path in this module: it is
 * `deriveState(id, [])`, i.e. recompute from an empty event list, which is why it is reversible —
 * the decision records it derives from were never touched.
 *
 * ONE DROP PER CROSSING. T7 says "drop exactly one rung ... when accuracy falls under 70%".
 * "Falls" is a transition, so the drop fires on the crossing from at-or-above the floor to below
 * it and not again until accuracy has recovered above the floor. Without that, a bad streak would
 * walk a concept to rung 0 one event at a time.
 *
 * Nothing here reads the clock, does IO, or knows what a renderer is.
 */

/** T7's five support levels, most-supported first. The index IS the rung. */
export const SUPPORT_LEVELS = [
  {
    rung: 0,
    id: 'worked-examples',
    description: 'worked examples',
    feedbackTiming: 'immediate',
    selfMarked: false,
    gridLookupIsLegitimate: false,
  },
  {
    rung: 1,
    id: 'full-correction',
    description: 'full correction',
    feedbackTiming: 'immediate',
    selfMarked: false,
    gridLookupIsLegitimate: false,
  },
  {
    rung: 2,
    id: 'principle-name-only',
    description: 'principle name only',
    feedbackTiming: 'immediate',
    selfMarked: false,
    gridLookupIsLegitimate: false,
  },
  {
    rung: 3,
    id: 'bare-incorrect',
    description: 'bare "incorrect"',
    feedbackTiming: 'immediate',
    selfMarked: false,
    gridLookupIsLegitimate: false,
  },
  {
    // T7: this is the one rung where the 13x13 grid is a legitimate lookup index rather than a
    // crutch, because the learner is marking their own work against it after the fact.
    rung: 4,
    id: 'batched-self-marked-review',
    description: 'batched self-marked review',
    feedbackTiming: 'batched',
    selfMarked: true,
    gridLookupIsLegitimate: true,
  },
] as const;

export type Rung = 0 | 1 | 2 | 3 | 4;
export type SupportLevel = (typeof SUPPORT_LEVELS)[number];
export type SupportId = SupportLevel['id'];

/** The most scaffolding available. Dropping cannot go past it. */
export const MOST_SUPPORT_RUNG: Rung = 0;
/** The least scaffolding available. Fading cannot go past it. */
export const LEAST_SUPPORT_RUNG: Rung = 4;

/** T7's threshold. Accuracy strictly under this drops one rung on that concept alone. */
export const ACCURACY_FLOOR = 0.7;

/**
 * The denominator for "accuracy" is not given anywhere in the spec. A trailing window of the last
 * ten graded attempts on the concept is the reading taken here: ten is the day-0 blocked
 * micro-block's rep count, so the rule arms after roughly one block of evidence, and a trailing
 * window means the number tracks current competence rather than being anchored by ancient history.
 * The rule is not armed at all until the window is full — 0/1 is 0% accuracy and must not cost a
 * rung.
 */
export const ACCURACY_WINDOW = 10;

/** T6: "the next three consecutive correct" clears the rung a hint cost. */
export const RESTORE_STREAK = 3;

/**
 * A graded attempt on one concept. `at` is absolute epoch ms and is carried for the log's benefit,
 * not read by any rule here.
 */
export interface GradedEvent {
  readonly kind: 'graded';
  readonly conceptId: string;
  readonly at: number;
  readonly correct: boolean;
}

/**
 * T6's `hintRequested`. `quotedRungAfter` is the rung the learner was shown BEFORE the answer was
 * revealed. It is part of the record and it is checked against the rung actually charged, so a hint
 * whose price was never quoted — or was quoted against stale state — cannot be recorded at all.
 * That is what makes "cost is shown before the answer" structural rather than a UI convention.
 */
export interface HintRequestedEvent {
  readonly kind: 'hintRequested';
  readonly conceptId: string;
  readonly at: number;
  readonly quotedRungAfter: Rung;
}

/**
 * One rung of support removed after competence was demonstrated. The criterion for emitting this
 * lives OUTSIDE this module (the mastery gate owns it); T6 and T7 specify only the drops and the
 * hint reversal, so inventing a promotion rule here would be inventing spec. It exists because
 * without a recorded upward step the ladder has no upward step at all and rungs 1-4 are
 * unreachable — see the module's findings note in the review.
 */
export interface SupportFadedEvent {
  readonly kind: 'supportFaded';
  readonly conceptId: string;
  readonly at: number;
}

export type FadingEvent = GradedEvent | HintRequestedEvent | SupportFadedEvent;

/**
 * The serialisable per-concept aggregate. JSON round-trips as-is. Every field is derived; none of
 * them is authoritative, and all of them are reproducible by replaying the log.
 */
export interface FadingState {
  readonly conceptId: string;
  /** 0 = worked examples (most support) ... 4 = batched self-marked review (least). */
  readonly rung: Rung;
  /** Total graded attempts ever recorded. Q2's "first exposure" test reads this. */
  readonly attempts: number;
  /** The trailing accuracy window, oldest first, capped at ACCURACY_WINDOW. */
  readonly recentAttempts: readonly boolean[];
  /** True once a crossing has fired; blocks a second drop until accuracy recovers. */
  readonly belowAccuracyFloor: boolean;
  /** Rungs spent on hints and not yet earned back. T6 calls this reversible. */
  readonly hintDebt: number;
  /** Correct answers since the last miss or hint, counting toward RESTORE_STREAK. */
  readonly consecutiveCorrect: number;
}

export function supportLevel(rung: Rung): SupportLevel {
  return SUPPORT_LEVELS[rung];
}

/** What support this concept currently gets. */
export function supportFor(state: FadingState): SupportLevel {
  return supportLevel(state.rung);
}

/** Toward more support, never past worked examples. */
function droppedRung(rung: Rung): Rung {
  return rung === 0 ? 0 : ((rung - 1) as Rung);
}

/** Toward less support, never past batched self-marked review. */
function fadedRung(rung: Rung): Rung {
  return rung === 4 ? 4 : ((rung + 1) as Rung);
}

/**
 * Reset KC, and the only way to make one: recompute from an empty event list. Not a delete — the
 * decision records this state was derived from are untouched and replaying them rebuilds it.
 */
export function initialState(conceptId: string): FadingState {
  if (conceptId.trim() === '') {
    throw new Error('fading state needs a conceptId — a rung with no concept is a global level');
  }
  return {
    conceptId,
    rung: MOST_SUPPORT_RUNG,
    attempts: 0,
    recentAttempts: [],
    belowAccuracyFloor: false,
    hintDebt: 0,
    consecutiveCorrect: 0,
  };
}

/** Accuracy over the trailing window, or null while the window is still filling. */
export function windowAccuracy(state: FadingState): number | null {
  if (state.recentAttempts.length < ACCURACY_WINDOW) return null;
  const correct = state.recentAttempts.filter((c) => c).length;
  return correct / state.recentAttempts.length;
}

/**
 * Q2: blocking is correct, and only correct, on the first exposure to a genuinely new concept at
 * rung 0. Both halves are required here — a concept that has been dropped back to rung 0 after a
 * bad run is not a first exposure, and interleaving is the default everywhere else.
 */
export function blockedPracticeAllowed(state: FadingState): boolean {
  return state.rung === MOST_SUPPORT_RUNG && state.attempts === 0;
}

export interface HintPrice {
  readonly conceptId: string;
  readonly rungBefore: Rung;
  readonly rungAfter: Rung;
  /** False only when the concept is already at worked examples: no rung is left to spend. */
  readonly costsARung: boolean;
  readonly supportBefore: SupportLevel;
  readonly supportAfter: SupportLevel;
  /** Consecutive correct answers on this concept that would clear the rung. Zero if none is spent. */
  readonly correctAnswersToRestore: number;
  /** The sentence T6 requires be visible before the answer is. */
  readonly notice: string;
}

/**
 * T6's price, quoted BEFORE the answer. Pure: quoting is not charging. The quote's `rungAfter` is
 * what a `hintRequested` event must carry, and `applyEvent` rejects the event if the two disagree.
 */
export function hintPrice(state: FadingState): HintPrice {
  const rungAfter = droppedRung(state.rung);
  const costsARung = rungAfter !== state.rung;
  const supportBefore = supportLevel(state.rung);
  const supportAfter = supportLevel(rungAfter);
  const notice = costsARung
    ? `Answering costs one scaffolding rung on ${state.conceptId}: ${supportBefore.description} becomes ${supportAfter.description}. ${RESTORE_STREAK} consecutive correct on this concept clears it.`
    : `Answering costs no rung on ${state.conceptId}: it is already at ${supportBefore.description}, the most support there is.`;
  return {
    conceptId: state.conceptId,
    rungBefore: state.rung,
    rungAfter,
    costsARung,
    supportBefore,
    supportAfter,
    correctAnswersToRestore: costsARung ? RESTORE_STREAK : 0,
    notice,
  };
}

/**
 * Fold one event into one concept's state. Events for any other concept are returned unchanged by
 * exact-id comparison, which is the whole of "per concept, never global": there is no id that
 * matches every concept.
 */
export function applyEvent(state: FadingState, event: FadingEvent): FadingState {
  if (event.conceptId !== state.conceptId) return state;

  switch (event.kind) {
    case 'graded':
      return applyGraded(state, event.correct);
    case 'hintRequested':
      return applyHint(state, event);
    case 'supportFaded':
      return { ...state, rung: fadedRung(state.rung) };
    default: {
      const exhaustive: never = event;
      throw new Error(`unknown fading event: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function applyGraded(state: FadingState, correct: boolean): FadingState {
  const recentAttempts = [...state.recentAttempts, correct].slice(-ACCURACY_WINDOW);
  const consecutiveCorrect = correct ? state.consecutiveCorrect + 1 : 0;

  const afterAttempt: FadingState = {
    ...state,
    attempts: state.attempts + 1,
    recentAttempts,
    consecutiveCorrect,
  };

  const repaid = repayHintDebt(afterAttempt);
  return applyAccuracyRule(repaid);
}

/** T6's reversal: three consecutive correct clears one rung a hint cost. */
function repayHintDebt(state: FadingState): FadingState {
  if (state.hintDebt === 0 || state.consecutiveCorrect < RESTORE_STREAK) return state;
  return {
    ...state,
    rung: fadedRung(state.rung),
    hintDebt: state.hintDebt - 1,
    consecutiveCorrect: 0,
  };
}

/**
 * T7's accuracy rule. One rung on this concept alone, on the crossing only; the flag re-arms when
 * accuracy comes back to the floor, so a long bad run costs one rung and not five.
 */
function applyAccuracyRule(state: FadingState): FadingState {
  const accuracy = windowAccuracy(state);
  if (accuracy === null) return state;

  if (accuracy >= ACCURACY_FLOOR) return { ...state, belowAccuracyFloor: false };
  if (state.belowAccuracyFloor) return state;
  return { ...state, rung: droppedRung(state.rung), belowAccuracyFloor: true };
}

function applyHint(state: FadingState, event: HintRequestedEvent): FadingState {
  const price = hintPrice(state);
  if (event.quotedRungAfter !== price.rungAfter) {
    throw new Error(
      `hint on ${state.conceptId} quoted rung ${event.quotedRungAfter} but costs rung ${price.rungAfter} — T6 requires the price shown before the answer to be the price charged`,
    );
  }
  return {
    ...state,
    rung: price.rungAfter,
    // A hint that spent nothing owes nothing: at worked examples there was no rung to lose, so
    // there is no rung to earn back.
    hintDebt: price.costsARung ? state.hintDebt + 1 : state.hintDebt,
    // "the NEXT three consecutive correct" — correct answers banked before the hint do not pay
    // for it.
    consecutiveCorrect: 0,
  };
}

/**
 * The whole state of one concept, recomputed from the log. Events are applied in list order — the
 * log's own order is the truth — and events belonging to other concepts are ignored, so this can
 * be handed the whole log.
 */
export function deriveState(conceptId: string, events: readonly FadingEvent[]): FadingState {
  return events.reduce(applyEvent, initialState(conceptId));
}

/**
 * The T7 direction invariant, exported so it can be asserted rather than trusted. Inverting the
 * ladder is the single most likely thing a future change gets wrong, because "drop a rung" reads
 * like "less help" to anyone who has not read T7's ordering.
 */
export function assertRungZeroIsMostSupport(
  ladder: readonly { readonly rung: number; readonly id: string }[] = SUPPORT_LEVELS,
): void {
  const order: readonly SupportId[] = [
    'worked-examples',
    'full-correction',
    'principle-name-only',
    'bare-incorrect',
    'batched-self-marked-review',
  ];
  if (ladder.length !== order.length) {
    throw new Error(`support ladder has ${ladder.length} rungs, T7 names ${order.length}`);
  }
  ladder.forEach((level, index) => {
    if (level.rung !== index || level.id !== order[index]) {
      throw new Error(`support ladder out of T7 order at index ${index}: ${level.id}`);
    }
  });
}
