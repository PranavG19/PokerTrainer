import { describe, expect, it } from 'vitest';
import { predictSupportText } from '../../src/renderer/components/predictPanel.js';
import { ROUTES, type ConfidenceCell } from '../../src/core/confidence.js';

/**
 * predictSupportText is the pure string mapping from a G8 ConfidenceRoute to the differential
 * support line the reveal shows. It has no DOM, so it is unit-testable in node — a cheap,
 * author-independent oracle for the four cells before the e2e proves it renders.
 */
describe('predictSupportText', () => {
  const expected: Readonly<Record<ConfidenceCell, string>> = {
    'sure-correct':
      'Support: principle name only. The rule was already there and it fired; naming it is the whole of what is owed.',
    'sure-wrong':
      'Support: the full causal chain. This spot returns now, then on day 2 and day 7. This is the highest-value miss in the system. A confident error is a rule that is wrong and trusted, so the whole causal chain is owed and the spot returns on day 2 and day 7.',
    'guess-correct':
      'Support: full elaboration. A right answer with no rule behind it is the cell that inflates every metric, so it gets the full elaboration the score would otherwise hide.',
    'guess-wrong':
      'Support: terse correction plus a worked example. A worked example is owed. Repetition steps up. A wrong guess is what a guess is for: the correction stays terse, the worked example supplies the missing rule, and repetition does the rest.',
  };

  it('renders each of the four cells as its exact string', () => {
    for (const cell of Object.keys(expected) as ConfidenceCell[]) {
      expect(predictSupportText(ROUTES[cell]), cell).toBe(expected[cell]);
    }
  });

  it('the four cells are mutually distinct', () => {
    const lines = (Object.keys(expected) as ConfidenceCell[]).map((cell) =>
      predictSupportText(ROUTES[cell]),
    );
    expect(new Set(lines).size).toBe(4);
  });

  it('each line carries its own support phrase', () => {
    expect(predictSupportText(ROUTES['sure-correct'])).toContain('principle name only');
    expect(predictSupportText(ROUTES['sure-wrong'])).toContain('the full causal chain');
    expect(predictSupportText(ROUTES['guess-correct'])).toContain('full elaboration');
    expect(predictSupportText(ROUTES['guess-wrong'])).toContain(
      'terse correction plus a worked example',
    );
  });

  it('the guess-wrong line does not shout SURE — only sure cells carry that word', () => {
    expect(predictSupportText(ROUTES['guess-wrong'])).not.toContain('SURE');
  });
});
