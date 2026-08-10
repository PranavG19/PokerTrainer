/**
 * ENGINE-AUTHORED NUMERIC PHRASES — the structural answer to a measured defect.
 *
 * MEASUREMENT (research/EXPERIMENT-4-tutor-prompts.md, 447 real completions): 77.2% of Explainer
 * outputs pass the T4 guard, but **32.2% of the outputs that PASS state a numeric relationship that
 * is false**, using only numerals the payload supplied. The failure classes were inverting which
 * number was the call and which the pot (17), describing an unsupported bet size (16), fabricating a
 * required-equity percentage (6), and inverting a ratio (3).
 *
 * PRODUCT-SPEC T4 predicts this and declines to close it: "number provenance is *string membership*,
 * so it passes output that is false using only permitted numerals ... The guard bounds *form*, not
 * *truth*." Its oracle table adds: "No oracle in this spec closes that gap."
 *
 * WHY NOT A BETTER PROMPT. Because that was measured too, and it made things worse. A round-2 prompt
 * adding explicit number-meaning rules raised the guard pass rate to 89.9% — the best score in the
 * experiment — while dropping the joint usable rate from 52.3% to 45.6%: telling the model to reason
 * about the numbers made it state *more* false numeric claims, confidently. Optimising the guard
 * metric damaged the product. So this file does not ask the model to be more careful with arithmetic.
 *
 * THE APPROACH. The model is reliable at prose and unreliable at arithmetic relationships, so the
 * relationships stop being the model's job. T2 already says the engine computes every quantity; this
 * extends that to *the sentence containing the quantity*. Each phrase below is generated in
 * TypeScript from the same values the grader computed, so it is correct by construction — the code
 * that writes the sentence is the code that did the arithmetic. The model receives finished phrases
 * and writes the prose around them.
 *
 * WHAT THIS DOES NOT SECURE, stated rather than glossed: a numeral-free falsehood. "This range is
 * uncapped here" when it is capped contains no digits, sits inside no phrase, and passes every check
 * in this file. T4 names that residue and this does not close it either. What it does close is the
 * one hole with a measured size.
 */

import type { GradePayload } from './types.js';

/** One phrase the model may quote, and the field it was derived from. */
export interface NumericPhrase {
  /** The exact text the model must reproduce character for character. */
  readonly text: string;
  /** Which payload quantities produced it. For diagnostics, not for the model. */
  readonly derivedFrom: readonly string[];
}

const oneDecimal = (n: number): string => n.toFixed(1);
const whole = (n: number): string => String(Math.round(n));

/**
 * Every numeric sentence-fragment the Explainer is allowed to use for this grade.
 *
 * Deliberately few. Each additional phrase is another way for the model to assemble a true-sounding
 * combination, and the measured failures were all assemblies — so the set is closed and small rather
 * than expressive.
 */
export function numericPhrasesFor(grade: GradePayload): NumericPhrase[] {
  const phrases: NumericPhrase[] = [];

  phrases.push({
    text: `costs ${oneDecimal(grade.deltaEvBb)} bb`,
    derivedFrom: ['deltaEvBb'],
  });

  phrases.push({
    text: `a ${whole(grade.potBeforeActionBb)} bb pot`,
    derivedFrom: ['potBeforeActionBb'],
  });

  // Equity carries its own framing, and that is deliberate. A bare "21% pot share" is verbatim-quotable
  // and still reframeable: a live run produced "requiring roughly 21% pot share to break even", which
  // turns the hand's ACTUAL share into a REQUIRED share. The phrase passed every check because the
  // characters matched while the meaning inverted — the same defect class as round 1, one level down.
  // Naming the owner inside the phrase removes the ambiguity: "this hand holds 21% pot share" cannot
  // be read as a requirement without breaking the quote.
  phrases.push({
    text: `this hand holds ${whole(grade.equityPct)}% pot share`,
    derivedFrom: ['equityPct'],
  });

  // Action EVs, one phrase each. Naming the action inside the phrase stops the model attaching a
  // number to the wrong action, which is the same inversion in a different costume.
  for (const [action, ev] of Object.entries(grade.actionEvsBb)) {
    phrases.push({
      text: `${action} is worth ${oneDecimal(ev)} bb`,
      derivedFrom: [`actionEvsBb.${action}`],
    });
  }

  phrases.push({
    text: `${oneDecimal(grade.classRwBbPer100)} bb/100 across this spot class`,
    derivedFrom: ['classRwBbPer100'],
  });

  return phrases;
}

/**
 * Numerals in prose. Thousands separators count as part of one numeral, so `1,100` is a single token
 * rather than two — the same convention guard.ts uses on its prose side, and for the same reason.
 */
const PROSE_NUMERAL = /\d+(?:,\d{3})*(?:\.\d+)?%?/g;

export interface PhraseViolation {
  /** The numeral that appeared outside every approved phrase. */
  readonly numeral: string;
  /** Enough surrounding text to see what was claimed. */
  readonly context: string;
}

/**
 * The check the existing four cannot make.
 *
 * "Is this numeric relationship true?" is undecidable for a pure function. "Is this numeral inside
 * one of the sentences we wrote?" is string matching. Converting the first question into the second
 * is the whole trick, and it works only because the phrases were authored by the code that did the
 * arithmetic.
 *
 * Matched phrases are blanked before scanning rather than merely searched for, so a numeral cannot
 * be excused by an approved phrase elsewhere in the paragraph: "calling 50 into a 75 pot" does not
 * get to borrow the legitimacy of "a 75 bb pot" three sentences later.
 */
function replaceAllInsensitive(haystack: string, needle: string): string {
  const lowerNeedle = needle.toLowerCase();
  let out = haystack;
  for (;;) {
    const at = out.toLowerCase().indexOf(lowerNeedle);
    if (at === -1) return out;
    out = `${out.slice(0, at)} ${out.slice(at + needle.length)}`;
  }
}

export function checkPhraseUse(text: string, phrases: readonly NumericPhrase[]): PhraseViolation[] {
  let remaining = text;
  for (const phrase of phrases) {
    // Case-insensitive, because a phrase that opens a sentence is legitimately capitalised — "A 75 bb
    // pot rewards patience" is the same phrase as "a 75 bb pot" and rejecting it would force the model
    // into contorted word order. Case is the ONLY latitude given: digits, order and wording must match,
    // since those are what carry the relationship. Every occurrence is blanked, because a phrase may
    // legitimately be quoted twice.
    remaining = replaceAllInsensitive(remaining, phrase.text);
  }

  const violations: PhraseViolation[] = [];
  for (const match of remaining.matchAll(PROSE_NUMERAL)) {
    const at = match.index ?? 0;
    violations.push({
      numeral: match[0],
      context: remaining.slice(Math.max(0, at - 30), at + match[0].length + 30).trim(),
    });
  }
  return violations;
}

/**
 * The instruction block appended to the Explainer prompt.
 *
 * Phrased as "quote these verbatim" rather than "be accurate with numbers": the measurement showed
 * that asking for numeric care produces more numeric claims and therefore more wrong ones. Asking
 * for transcription produces transcription.
 */
export function phraseInstruction(phrases: readonly NumericPhrase[]): string {
  const list = phrases.map((p) => `  - "${p.text}"`).join('\n');
  return [
    'Every number in your reply must appear inside one of these exact phrases, reproduced character for',
    'character. Do not recompute, rearrange, paraphrase, round, or combine them, and do not state any',
    'other number. Do not put quotation marks around them — they must read as part of your own',
    'sentences, because a correction studded with quoted fragments reads as machine output rather than',
    'teaching. Write the teaching around them.',
    '',
    'Approved phrases:',
    list,
  ].join('\n');
}
