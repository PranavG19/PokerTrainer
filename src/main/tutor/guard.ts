/**
 * T4 — the guard. A pure function over (tutor output, the request that produced
 * it). Four mechanically-decidable checks: word count, ban-list lint, number
 * provenance, no leading second-person pronoun.
 *
 * WHAT THIS GUARD DOES NOT SECURE — stated here because T4 requires it be
 * stated rather than overclaimed:
 *
 * - Number provenance is *string membership*. An output that uses only
 *   permitted numerals but relates them falsely passes: with pot 10 and bet 5
 *   in the payload, "risking 10 to win 5" inverts the relationship and passes.
 * - A false claim containing no numeral passes entirely — "your range is
 *   uncapped here" when it is capped is invisible to every check below.
 * - Check 4 is a *proxy* for the method's "task as grammatical subject". The
 *   full property needs a dependency parse plus semantic classification of the
 *   subject and is not pure-function decidable. The proxy ships; the full
 *   property is a writing rule for the prompt and the fixed string table, not
 *   an enforced invariant.
 *
 * The guard bounds form, not truth. Truth is bounded elsewhere: T2 keeps the
 * tutor downstream of the grader, T3a keeps solver fields off the pre-commit
 * request type, and residually it is not bounded at all.
 */

import type { TutorOutputKind, TutorRequest } from './types.js';

export type GuardCheck = 'word-count' | 'ban-list' | 'number-provenance' | 'leading-pronoun';

export interface GuardViolation {
  readonly check: GuardCheck;
  /** Which ban-list rule or numeral tripped it; the word count when over. */
  readonly detail: string;
}

export interface GuardResult {
  readonly ok: boolean;
  readonly violations: readonly GuardViolation[];
  readonly wordCount: number;
}

/** T4 check 1. */
export const WORD_LIMITS: Readonly<Record<TutorOutputKind, number>> = {
  correction: 60,
  question: 20,
};

interface BanRule {
  readonly name: string;
  readonly pattern: RegExp;
}

/**
 * T4 check 2, grouped by the four forbidden constructions the decision names.
 * "your range" / "your price" are deliberately absent: those are legitimate
 * task-subject phrasings, and T4 uses "your range is uncapped here" as its own
 * example of a falsehood the guard cannot catch — so it must pass the lint.
 */
const BAN_RULES: readonly BanRule[] = [
  // Second-person trait attribution (G7: report by tag, never by trait).
  { name: 'trait:you-are', pattern: /\byou(?:'re|’re|\s+are|\s+were)\b/i },
  { name: 'trait:you-habitually', pattern: /\byou\s+(?:always|never|tend|keep|usually|often)\b/i },
  {
    name: 'trait:your-trait-noun',
    pattern: /\byour\s+(?:tendency|tendencies|leak|leaks|problem|weakness|style|personality|game|instincts|habit|habits)\b/i,
  },
  {
    name: 'trait:player-label',
    pattern: /\b(?:nit|fish|whale|donk|maniac|calling\s+station|reg)\b/i,
  },

  // Praise adjacent to a correction (the "but" clause is the part that drops).
  {
    name: 'praise:phrase',
    pattern:
      /\b(?:nice|great|excellent|perfect|impressive|awesome|beautiful|congrats|congratulations|well\s+(?:done|played)|good\s+(?:job|read|call|fold|bet|instincts|thinking))\b/i,
  },

  // Gamification vocabulary (streak/rank/percentile/XP/badge/leaderboard) was ALLOWED on 2026-08-14 by
  // product decision, so the former rank:streak / rank:ordinal / rank:gamified rules were removed. The
  // trait, praise and fold-reveal rules stay — those are pedagogy guarantees, not gamification bans.

  // Per-hand fold reveal (G10 — prohibited in the string table, permanently).
  { name: 'fold-reveal:you-folded', pattern: /\byou\s+folded\b/i },
  {
    name: 'fold-reveal:counterfactual',
    pattern: /\bwould\s+have\s+(?:flopped|hit|made|rivered|turned|won|scooped|improved|been)\b/i,
  },
  { name: 'fold-reveal:if-you-had', pattern: /\bif\s+you\s+had\s+(?:called|stayed|continued|raised)\b/i },
];

/** T4 check 4 — the checkable proxy, applied to the first word only. */
const LEADING_PRONOUN = /^\s*(?:you|you're|you’re|your|yours|yourself)\b/i;

/**
 * Two regexes, deliberately different.
 *
 * Prose may write a thousands separator, so `1,100` must read as one numeral —
 * hence the strict three-digit group form. The payload is JSON, where a comma
 * separates two *different* numbers: scanning `[100,100]` with the comma-aware
 * form yields the numeral `100100`, which would then reject a legitimate `100`
 * in the output. So payload numerals are plain digit runs only.
 */
const PROSE_NUMERAL = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
const JSON_NUMERAL = /\d+(?:\.\d+)?/g;

function numeralsIn(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((m) => m[0].replace(/,/g, ''));
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/**
 * Every numeral the payload makes available. Serialising the request is exactly
 * the string-membership test T4 specifies — and exactly why it cannot verify a
 * *relationship* between two permitted numerals.
 */
export function allowedNumerals(request: TutorRequest): ReadonlySet<string> {
  return new Set(numeralsIn(JSON.stringify(request), JSON_NUMERAL));
}

/**
 * `skipWordCount` exists for one caller: the agent's tool-result guard. A tool
 * result is context fed BACK to the model, not the final prose shown to the
 * learner, so the T4 word budget does not apply to it — a full principle lookup
 * legitimately runs past 60 words. Provenance and the ban-list still run, so a
 * tool result carrying an off-payload numeral is still rejected. The default is
 * unchanged, so the final-output path keeps its word cap.
 */
export interface GuardOptions {
  readonly skipWordCount?: boolean;
}

export function checkTutorOutput(
  output: { readonly text: string; readonly kind: TutorOutputKind },
  request: TutorRequest,
  options: GuardOptions = {},
): GuardResult {
  const violations: GuardViolation[] = [];
  const wordCount = countWords(output.text);

  const limit = WORD_LIMITS[output.kind];
  if (!options.skipWordCount && wordCount > limit) {
    violations.push({ check: 'word-count', detail: `${wordCount} words, limit ${limit}` });
  }

  for (const rule of BAN_RULES) {
    const hit = rule.pattern.exec(output.text);
    if (hit !== null) {
      violations.push({ check: 'ban-list', detail: `${rule.name}: "${hit[0]}"` });
    }
  }

  const allowed = allowedNumerals(request);
  for (const numeral of numeralsIn(output.text, PROSE_NUMERAL)) {
    if (!allowed.has(numeral)) {
      violations.push({ check: 'number-provenance', detail: numeral });
    }
  }

  if (LEADING_PRONOUN.test(output.text)) {
    violations.push({ check: 'leading-pronoun', detail: output.text.trim().split(/\s+/)[0] });
  }

  return { ok: violations.length === 0, violations, wordCount };
}
