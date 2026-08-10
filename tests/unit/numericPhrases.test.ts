import { describe, it, expect } from 'vitest';
import type { GradePayload } from '../../src/main/tutor/types.js';
import {
  checkPhraseUse,
  numericPhrasesFor,
  phraseInstruction,
} from '../../src/main/tutor/numericPhrases.js';

/**
 * The regression corpus is the MEASURED failure set, not invented cases.
 *
 * research/EXPERIMENT-4-tutor-prompts.md ran 447 real Explainer completions and found that 32.2% of
 * the outputs which PASSED the T4 guard stated a false numeric relationship using only permitted
 * numerals. Its four failure classes are each represented below, phrased the way the model actually
 * phrased them. Every one of those outputs passed number provenance — that is the point — so each
 * must now be rejected by the phrase check instead.
 */

const grade: GradePayload = {
  tier: 'T3',
  deltaEvBb: 1.4,
  errorTag: 'PRICE',
  potBeforeActionBb: 75,
  chosenAction: 'call',
  bestAction: 'fold',
  actionEvsBb: { fold: 0, call: -1.4 },
  equityPct: 21,
  principle: 'pot odds',
  boundaryHand: 'KJs',
  flippingVariable: 'suitedness',
  classRwBbPer100: 1.9,
};

const phrases = numericPhrasesFor(grade);
const texts = phrases.map((p) => p.text);

describe('the phrases the engine authors', () => {
  it('renders each quantity from the payload, not from the model', () => {
    expect(texts).toContain('costs 1.4 bb');
    expect(texts).toContain('a 75 bb pot');
    expect(texts).toContain('this hand holds 21% pot share');
    expect(texts).toContain('1.9 bb/100 across this spot class');
  });

  it('names the action inside its own EV phrase', () => {
    // Detaching the number from the action is how it gets attached to the wrong one — the same
    // inversion as the call/pot swap, in a different costume.
    expect(texts).toContain('fold is worth 0.0 bb');
    expect(texts).toContain('call is worth -1.4 bb');
  });

  it('offers no comparison phrase, because comparisons are what inverted', () => {
    // "you had 21% but needed 50%" was the single commonest measured falsehood. There is deliberately
    // no phrase of that shape: a required number must arrive as its own engine-authored phrase rather
    // than as the model's subtraction.
    for (const text of texts) {
      expect(text).not.toMatch(/needs?|required|but only|versus|vs\b/i);
    }
  });
});

describe('the measured failure classes are now rejected', () => {
  /** Class A — the exact inversion PRODUCT-SPEC T4 predicts and declines to close. */
  it('rejects inverting the call and the pot', () => {
    const bad = 'Calling 50 into a 75 pot is the losing line here; folding keeps the stack.';
    const violations = checkPhraseUse(bad, phrases);
    expect(violations.map((v) => v.numeral)).toContain('50');
  });

  /** Class B — a bet size the payload never supported. */
  it('rejects an unsupported bet size', () => {
    const bad = 'Shoving 200 bb over the top costs 1.4 bb of expectation.';
    const violations = checkPhraseUse(bad, phrases);
    expect(violations.map((v) => v.numeral)).toContain('200');
    // The legitimate phrase in the same sentence must NOT excuse the fabricated one.
    expect(violations.map((v) => v.numeral)).not.toContain('1.4');
  });

  /** Class C — a fabricated required-equity percentage. */
  it('rejects a fabricated needs-percentage', () => {
    const bad = 'This spot needs 50% to continue, and this hand holds 21% pot share.';
    const violations = checkPhraseUse(bad, phrases);
    expect(violations.map((v) => v.numeral)).toContain('50%');
  });

  /** Class D — an inverted ratio. */
  it('rejects an inverted risk-to-win ratio', () => {
    const bad = 'Risking 75 to win 50 is the wrong side of the price.';
    const numerals = checkPhraseUse(bad, phrases).map((v) => v.numeral);
    // "75" here is a bare numeral, not the approved "a 75 bb pot" phrase, so both are violations.
    expect(numerals).toContain('50');
    expect(numerals).toContain('75');
  });
});

describe('correct output passes', () => {
  it('accepts prose that quotes the phrases verbatim', () => {
    const good = [
      'The price is wrong here: this hand holds 21% pot share into a 75 bb pot, which leaves the call behind.',
      'Taking it costs 1.4 bb. Fold this holding next time it faces a bet of that size.',
    ].join(' ');
    expect(checkPhraseUse(good, phrases)).toEqual([]);
  });

  it('accepts a phrase quoted more than once', () => {
    const good = 'A 75 bb pot is large; a 75 bb pot rewards patience.';
    expect(checkPhraseUse(good, phrases)).toEqual([]);
  });

  it('accepts numeral-free prose', () => {
    // The commonest correct output shape, and the one G3 wants for a cheap decision.
    expect(checkPhraseUse('Folding this holding to a bet of that size is the cheaper line.', phrases)).toEqual([]);
  });
});

describe('strictness that looks excessive and is not', () => {
  it('rejects a paraphrase of an approved phrase', () => {
    // "needs about 40 percent" for "needs 40%" reads harmless, and a paraphrase is exactly where a
    // relationship flips unnoticed — the model rewrites the sentence and the meaning moves with it.
    // Verbatim quoting is the only version of this check that is actually decidable.
    const bad = 'This line costs about 1.4 big blinds of expectation.';
    expect(checkPhraseUse(bad, phrases).map((v) => v.numeral)).toContain('1.4');
  });

  it('rejects a rounded number', () => {
    const bad = 'This line costs 1 bb.';
    expect(checkPhraseUse(bad, phrases).map((v) => v.numeral)).toContain('1');
  });

  it('rejects a recombination of two approved numerals', () => {
    // Both 21 and 75 are permitted numerals and provenance passes; the relationship is invented.
    const bad = 'With 21 outs in a 75 card deck the call is fine.';
    const numerals = checkPhraseUse(bad, phrases).map((v) => v.numeral);
    expect(numerals).toContain('21');
    expect(numerals).toContain('75');
  });

  it('reports where the numeral appeared, so a failure is diagnosable', () => {
    const violations = checkPhraseUse('Calling 50 into a 75 pot.', phrases);
    expect(violations[0].context).toContain('50');
  });
});

describe('the prompt instruction', () => {
  it('asks for transcription rather than numeric care', () => {
    // The measurement's most important negative result: a prompt that told the model to reason about
    // the numbers raised the guard pass rate to its best score (89.9%) while dropping the joint
    // usable rate from 52.3% to 45.6%. Asking for care produces more claims; asking for
    // transcription produces transcription.
    const instruction = phraseInstruction(phrases);
    expect(instruction).toMatch(/character for\s*\ncharacter|character for character/i);
    expect(instruction).toMatch(/do not recompute/i);
    expect(instruction).not.toMatch(/careful|accurate|double.check/i);
  });

  it('forbids quotation marks, so the correction reads as teaching not machine output', () => {
    // A live run produced corrections studded with quoted fragments — every number technically correct
    // and the whole thing reading like a template. True but unreadable teaches nothing either.
    expect(phraseInstruction(phrases)).toMatch(/quotation marks/i);
  });

  it('lists every approved phrase', () => {
    const instruction = phraseInstruction(phrases);
    for (const text of texts) expect(instruction).toContain(text);
  });
});
