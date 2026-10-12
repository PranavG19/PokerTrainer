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
 * - Spelled-out numbers (check `number-words`, kept separate from the digit
 *   check so the agent's post-reveal path, which replaces digit provenance with
 *   phrase checks, still runs it) are read only where they are a quantity: a
 *   compound ("seven fifty", "one hundred"), any tens word ("fifty"), a single
 *   word before a quantity unit ("three big blinds", "nine outs"), or a `k`
 *   amount ("1k"). A lone counting word with no unit ("two hole cards", "one
 *   seat") is prose and passes; ordinals, fractions and "a dozen" ("a third of
 *   the pot", "half the pot") are not read.
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

export type GuardCheck = 'word-count' | 'ban-list' | 'number-provenance' | 'number-words' | 'leading-pronoun';

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

/**
 * Spelled-out numbers. "Seven fifty big blind" carries 750 with no digit in it,
 * so the digit regex alone let any number through as words. The word run is
 * turned into the value a reader hears and that value takes the same
 * membership test as a numeral.
 */
const SMALL: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};
const TENS: Readonly<Record<string, number>> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Readonly<Record<string, number>> = { hundred: 100, thousand: 1000, million: 1_000_000 };
const isNumberWord = (w: string): boolean => w in SMALL || w in TENS || w in SCALES;

/** What makes a lone number word a quantity rather than a count of things in the game. */
const QUANTITY_UNIT = /^\s*(?:%|(?:big\s+blinds?|blinds?|bb|chips?|percent|per\s+cent|outs?|times|to\s+one)\b)/i;

/**
 * The value of a run of number words. Standard English ("seven hundred fifty",
 * "twenty five") composes left to right; two juxtaposed groups that standard
 * grammar cannot join ("seven fifty", "twelve hundred fifty" aside) are read
 * the way poker speech uses them, as hundreds then the rest: 750.
 */
function numberWordValue(words: readonly string[]): number {
  const point = words.indexOf('point');
  const whole = point === -1 ? words : words.slice(0, point);
  const groups: number[] = [];
  let total = 0;
  let current = 0;
  let last: 'small' | 'tens' | 'scale' | null = null;
  const closeGroup = (): void => {
    groups.push(total + current);
    total = 0;
    current = 0;
  };
  for (const w of whole) {
    if (w in SCALES) {
      const scale = SCALES[w];
      if (scale === 100) current = (current || 1) * 100;
      else {
        total += (current || 1) * scale;
        current = 0;
      }
      last = 'scale';
    } else if (w in TENS) {
      if (last === 'small' || last === 'tens') closeGroup();
      current += TENS[w];
      last = 'tens';
    } else {
      // A unit after a ten joins it ("twenty five"); after a unit or a teen it starts a new group.
      if (last === 'small' || (last === 'tens' && (SMALL[w] >= 10 || current % 10 !== 0))) closeGroup();
      current += SMALL[w];
      last = 'small';
    }
  }
  closeGroup();
  let value = groups.reduce((acc, g) => (g < 100 ? acc * 100 + g : acc * 1000 + g), 0);
  if (groups.length === 1) value = groups[0];
  if (point !== -1) {
    const digits = words.slice(point + 1).map((w) => String(SMALL[w] ?? 0)).join('');
    value = Number(`${value}.${digits}`);
  }
  return value;
}

/** Every spelled-out quantity in prose, as its phrase and value. */
function numberWordsIn(text: string): { phrase: string; value: string }[] {
  const out: { phrase: string; value: string }[] = [];
  const tokens = [...text.matchAll(/[A-Za-z]+/g)];
  let i = 0;
  while (i < tokens.length) {
    if (!isNumberWord(tokens[i][0].toLowerCase())) {
      i += 1;
      continue;
    }
    const run: string[] = [];
    let j = i;
    let end = tokens[i].index! + tokens[i][0].length;
    while (j < tokens.length) {
      const word = tokens[j][0].toLowerCase();
      // Only whitespace or a hyphen may join two words of one number; a comma ends it.
      const gap = j === i ? '' : text.slice(end, tokens[j].index);
      if (j > i && !/^[\s-]+$/.test(gap)) break;
      const next = tokens[j + 1]?.[0].toLowerCase();
      const joins = (word === 'and' || word === 'point') && run.length > 0 && next !== undefined && isNumberWord(next);
      if (!isNumberWord(word) && !joins) break;
      run.push(word);
      end = tokens[j].index! + word.length;
      j += 1;
    }
    const words = run.filter((w) => w !== 'and');
    // "fifty-fifty" is an even split, not 5050.
    if (words.length === 2 && words[0] === words[1] && words[0] in TENS) {
      i = j;
      continue;
    }
    // "per hundred" names a rate's denominator, not a quantity.
    const perScale = words.length === 1 && words[0] in SCALES && tokens[i - 1]?.[0].toLowerCase() === 'per';
    const compound = !perScale && (words.length > 1 || words.some((w) => w in SCALES || w in TENS));
    if (compound || QUANTITY_UNIT.test(text.slice(end))) {
      out.push({ phrase: text.slice(tokens[i].index, end).toLowerCase(), value: String(numberWordValue(words)) });
    }
    i = j;
  }
  // "1k", "2.5k": a digit the prose regex reads as 1 or 2.5, meaning a thousand times that. Lowercase,
  // attached and standalone only, so card text ("9 K 2", "3k-high") is not read as thousands.
  for (const m of text.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)k(?![\w-])/g)) {
    out.push({ phrase: m[0].toLowerCase(), value: String(Number(m[1]) * 1000) });
  }
  return out;
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

  for (const { phrase, value } of numberWordsIn(output.text)) {
    if (!allowed.has(value)) {
      violations.push({ check: 'number-words', detail: `${phrase} (${value})` });
    }
  }

  if (LEADING_PRONOUN.test(output.text)) {
    violations.push({ check: 'leading-pronoun', detail: output.text.trim().split(/\s+/)[0] });
  }

  return { ok: violations.length === 0, violations, wordCount };
}
