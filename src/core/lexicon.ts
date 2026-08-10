/**
 * THE LEARNER'S LEXICON — PRODUCT-SPEC L1, L2, L3; user stories 20 and 39.
 *
 * L1: the learner's own sentence IS the concept's name. On resolving a contrast set they answer
 * "which variable flipped the answer, and why?", and an accepted sentence becomes the tag that all
 * later feedback on that concept opens by quoting (`feedbackOpening`).
 *
 * L3 IS STRUCTURAL HERE, NOT MERELY TESTED. There is no exported function that edits, replaces,
 * re-classifies or deletes a recorded attempt: the only writer is `Lexicon.record`, which appends.
 * Every attempt handed out is frozen and every returned list is a frozen copy, so a caller holding
 * an entry holds no handle into this module's state. "What do I quote" is derived from the log
 * (`quoteFor`) rather than stored, so it cannot drift from the history that produced it.
 *
 * ORDER IS INSERTION ORDER, NEVER `at`. Two attempts can share a millisecond and a caller can
 * replay a stored log with clock-skewed timestamps; "the most recent is quoted" must have exactly
 * one answer, so the append order decides and `at` is carried as data only.
 *
 * L2: acceptance is a keyword check over the three mechanism framings — domination risk, equity
 * realisation, range asymmetry — and a cached cell ("K7s is a CO open") is rejected. Rejection is a
 * RECORDED OUTCOME with a reason, because L2 keeps rejected attempts as diagnostic material. The
 * tutor is an injectable seam (`RecordOptions.classifier`): this module never imports it, makes no
 * network call and reads no clock, so the no-key path is fully deterministic and offline.
 */

import type { ContrastAxis } from './contrast.js';

/** L2's three admissible framings, in the order the spec lists them (which is also tie-break order). */
export const MECHANISM_FRAMES = ['domination-risk', 'equity-realisation', 'range-asymmetry'] as const;

export type MechanismFrame = (typeof MECHANISM_FRAMES)[number];

/**
 * Why an attempt was not adopted. Both values are rejections; they differ only in what the learner
 * is told, so a mislabel costs a message and never an acceptance.
 */
export type RejectionReason = 'cached-cell' | 'no-mechanism-frame';

/** Named so a renderer never has to compose the sentence L2's diagnosis turns on. */
export const REJECTION_TEXT: Readonly<Record<RejectionReason, string>> = {
  'cached-cell': 'this states a memorised conclusion rather than a mechanism',
  'no-mechanism-frame':
    'this names no mechanism — say it as domination risk, equity realisation, or range asymmetry',
};

/** Who decided. `learner` is L2's self-mark on the no-key path; `classifier` is the tutor seam. */
export type Decider = 'keyword-check' | 'learner' | 'classifier';

interface AttemptFields {
  /** Monotonic within one lexicon. Makes "the most recent" inspectable rather than positional. */
  readonly seq: number;
  readonly conceptId: string;
  readonly sentence: string;
  /** Caller-supplied epoch ms: core reads no clock. Carried as data — it never sets order. */
  readonly at: number;
  /**
   * The contrast axis whose flip prompted the sentence (L1's "which variable flipped the answer").
   * Null when the sentence came from somewhere other than a resolved contrast set — a lesson, say.
   */
  readonly flippingAxis: ContrastAxis | null;
}

export interface AcceptedSentence extends AttemptFields {
  readonly outcome: 'accepted';
  /** What makes the entry a mechanism sentence rather than a string. */
  readonly frame: MechanismFrame;
  readonly decidedBy: Decider;
}

export interface RejectedSentence extends AttemptFields {
  readonly outcome: 'rejected';
  readonly reason: RejectionReason;
  /** REJECTION_TEXT[reason], carried on the record so a stored log explains itself. */
  readonly reasonText: string;
  /**
   * L2's "pushes back once": true on the first rejection for this concept only. Later rejections
   * are still recorded with their reason — the learner is simply not lectured again.
   */
  readonly pushback: boolean;
}

export type LexiconAttempt = AcceptedSentence | RejectedSentence;

export type SentenceVerdict =
  | { readonly frame: MechanismFrame }
  | { readonly frame: null; readonly reason: RejectionReason };

/**
 * The tutor seam. Synchronous on purpose: a live tutor call happens in main, and the caller hands
 * the resolved verdict in as `() => verdict`. Making `record` async would push a promise into every
 * screen that quotes a sentence, for a path that does not exist without a key.
 */
export type MechanismClassifier = (sentence: string) => SentenceVerdict;

export interface AttemptInput {
  readonly conceptId: string;
  readonly sentence: string;
  readonly at: number;
  readonly flippingAxis?: ContrastAxis;
  /**
   * L2's self-mark: the learner claims a framing the keyword check could not see. It adopts a
   * sentence rejected as `no-mechanism-frame`, and deliberately does NOT override `cached-cell` —
   * cached cells are the one thing L2 states outright must be rejected, so a self-mark that
   * overrode it would make the criterion decorative.
   */
  readonly selfMarkedFrame?: MechanismFrame;
}

export interface RecordOptions {
  readonly classifier?: MechanismClassifier;
}

/** Append-only. There is no editing or deleting member, by construction (L3). */
export interface Lexicon {
  record(input: AttemptInput, opts?: RecordOptions): LexiconAttempt;
  /** L1/L3: the newest accepted sentence for the concept, or null if none was ever accepted. */
  quoteFor(conceptId: string): AcceptedSentence | null;
  /** Accepted sentences, oldest first — L3's "earlier ones are visible". */
  historyFor(conceptId: string): readonly AcceptedSentence[];
  /** Every attempt for the concept, accepted and rejected, in append order (L2 keeps rejections). */
  attemptsFor(conceptId: string): readonly LexiconAttempt[];
  /** The whole log in append order. This is what a caller persists. */
  attempts(): readonly LexiconAttempt[];
  /** Concept ids in first-attempt order. */
  concepts(): readonly string[];
}

// ── The no-key keyword check (L2) ────────────────────────────────────────────
//
// Vocabulary is taken from the lessons' `acceptanceKeywords` (src/core/lessons/content/*) so the
// two checks speak one language. An inner array is a conjunction: every pattern in it must match.

const FRAME_PATTERNS: Readonly<Record<MechanismFrame, readonly (readonly RegExp[])[]>> = {
  'domination-risk': [[/dominat/i], [/\bkickers?\b/i], [/dead equity/i], [/card removal/i], [/out-?kicked/i]],
  'equity-realisation': [
    // "realise" also means "notice", so the stem only counts as a framing alongside equity.
    [/realis|realiz/i, /\bequity\b/i],
    [/positional discount/i],
    [/cards? cheaply/i],
    [/reach(?:es)? showdown/i],
    [/\bfree cards?\b/i],
  ],
  'range-asymmetry': [
    [/asymmetr/i],
    [/range advantage/i],
    [/nut(?:ted)? advantage/i],
    [/stronger range|range is stronger/i],
    [/which range/i],
  ],
};

/**
 * A hand in chart notation: two ranks with an optional suitedness letter — CASE-INSENSITIVELY, because
 * a learner types "k7s is a co open" as readily as "K7s is a CO open" and L2's own canonical bad
 * sentence must be rejected either way. The uppercase-only version let the lowercase spelling of that
 * exact sentence through: it matched no framing AND failed the hand test, so it was filed as
 * `no-mechanism-frame`, which a learner self-mark is allowed to override — the one path L2 forbids for
 * a cached cell.
 *
 * THE COLLISION THIS HAS TO AVOID is why the naive `/i` is wrong: five ordinary English words are
 * spelled entirely from rank letters — at, ta, ka, ja, aa — plus "ats" and "tas" once the optional
 * suitedness letter is allowed. "at" appears in perfectly good mechanism sentences ("worse at
 * realising equity"), so reading it as a hand would reject them. They are excluded by name; every
 * other rank pair is a hand in either case.
 */
const ENGLISH_RANK_COLLISIONS = /^(?:at|ta|ka|ja|aa|ats|tas)$/i;
const HAND_NOTATION_ANYCASE = /\b[AKQJT2-9]{2}[so]?\b/gi;

/** True when the sentence names a hand in chart notation, in any case. */
function namesAHand(sentence: string): boolean {
  const matches = sentence.match(HAND_NOTATION_ANYCASE) ?? [];
  return matches.some((token) => !ENGLISH_RANK_COLLISIONS.test(token));
}

/** The chart's own verdict vocabulary: an action bucket a hand can be filed in. */
const CHART_VERDICT =
  /\b(?:opens?|opening|folds?|calls?|raises?|3-?bets?|limps?|mucks?|standard|in the chart|on the chart|in the range)\b/i;

const matchesFrame = (sentence: string, frame: MechanismFrame): boolean =>
  FRAME_PATTERNS[frame].some((all) => all.every((pattern) => pattern.test(sentence)));

/**
 * THE CACHED-CELL RULE, chosen deliberately: MECHANISM VOCABULARY WINS.
 *
 * A cached cell files a hand into an action bucket and stops ("K7s is a CO open"). A mechanism names
 * the variable that moves the answer, and it is perfectly normal for it to cite a hand as the
 * example ("K7s is dominated by the better sevens in a CO calling range"). So the check is ordered,
 * not conjunctive: a framing match accepts first, and only a sentence with NO framing is then
 * inspected for the cached-cell shape (a hand in chart notation plus a chart verdict). A naive
 * "mentions a hand" rule would reject the second sentence, which is the good one.
 *
 * The cost of this ordering is a sentence that name-drops a framing onto a cached cell ("K7s is a CO
 * open because of range asymmetry"), which the keyword path accepts. L2 already says the keyword
 * check is the degraded no-key path and that only the tutor classifies; that case is what the
 * `classifier` seam is for.
 *
 * Where a rejection is not a cached cell the shape check is only choosing which message the learner
 * sees, since both branches reject; proximity of hand to verdict is therefore not required.
 */
export function classifySentence(sentence: string): SentenceVerdict {
  for (const frame of MECHANISM_FRAMES) {
    if (matchesFrame(sentence, frame)) return { frame };
  }
  if (namesAHand(sentence) && CHART_VERDICT.test(sentence)) {
    return { frame: null, reason: 'cached-cell' };
  }
  return { frame: null, reason: 'no-mechanism-frame' };
}

// ── The store ────────────────────────────────────────────────────────────────

/**
 * `prior` rehydrates a persisted log. It builds a NEW lexicon and cannot reach an existing one, so
 * it is not an editing path: rewriting history still means rewriting the file on disk by hand.
 */
export function createLexicon(prior: readonly LexiconAttempt[] = []): Lexicon {
  const log: LexiconAttempt[] = prior.map((attempt) => Object.freeze({ ...attempt }));
  let nextSeq = log.reduce((max, attempt) => Math.max(max, attempt.seq + 1), 0);

  const forConcept = (conceptId: string): LexiconAttempt[] =>
    log.filter((attempt) => attempt.conceptId === conceptId);

  return {
    record(input, opts = {}) {
      const sentence = input.sentence.trim();
      // Not a rejection: an empty box is a caller bug, and recording it as a diagnostic attempt
      // would put a blank row in the history L3 exists to preserve.
      if (sentence === '') throw new TypeError('lexicon: sentence is empty');
      if (input.conceptId.trim() === '') throw new TypeError('lexicon: conceptId is empty');

      const classify = opts.classifier;
      const verdict = classify === undefined ? classifySentence(sentence) : classify(sentence);
      const fields: AttemptFields = {
        seq: nextSeq++,
        conceptId: input.conceptId,
        sentence,
        at: input.at,
        flippingAxis: input.flippingAxis ?? null,
      };

      const attempt: LexiconAttempt = ((): LexiconAttempt => {
        if (verdict.frame !== null) {
          return {
            ...fields,
            outcome: 'accepted',
            frame: verdict.frame,
            decidedBy: classify === undefined ? 'keyword-check' : 'classifier',
          };
        }
        if (verdict.reason === 'no-mechanism-frame' && input.selfMarkedFrame !== undefined) {
          return { ...fields, outcome: 'accepted', frame: input.selfMarkedFrame, decidedBy: 'learner' };
        }
        const alreadyPushedBack = forConcept(input.conceptId).some(
          (earlier) => earlier.outcome === 'rejected' && earlier.pushback,
        );
        return {
          ...fields,
          outcome: 'rejected',
          reason: verdict.reason,
          reasonText: REJECTION_TEXT[verdict.reason],
          pushback: !alreadyPushedBack,
        };
      })();

      const frozen = Object.freeze(attempt);
      log.push(frozen);
      return frozen;
    },

    quoteFor(conceptId) {
      const accepted = forConcept(conceptId).filter(
        (attempt): attempt is AcceptedSentence => attempt.outcome === 'accepted',
      );
      return accepted.length === 0 ? null : accepted[accepted.length - 1];
    },

    historyFor(conceptId) {
      return Object.freeze(
        forConcept(conceptId).filter(
          (attempt): attempt is AcceptedSentence => attempt.outcome === 'accepted',
        ),
      );
    },

    attemptsFor(conceptId) {
      return Object.freeze(forConcept(conceptId));
    },

    attempts() {
      return Object.freeze([...log]);
    },

    concepts() {
      return Object.freeze([...new Set(log.map((attempt) => attempt.conceptId))]);
    },
  };
}

/**
 * L1's "all future feedback on that concept opens by quoting it", and the line the settings screen
 * already promises the learner. Null when the concept has no accepted sentence yet, so a caller can
 * tell "nothing to quote" from "quoted the empty string".
 */
export function feedbackOpening(lexicon: Lexicon, conceptId: string): string | null {
  const quote = lexicon.quoteFor(conceptId);
  return quote === null ? null : `Your sentence for this: “${quote.sentence}”`;
}
