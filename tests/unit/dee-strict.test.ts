import { describe, expect, it } from 'vitest';
import { rephraseProblems, variantProblems } from '../../src/core/dee/strict.js';

/**
 * The research PoC's review probes (vision-tech-research, research/tech-poc/llm/probes.json and probes.out):
 * five meaning inversions and three lossy drops must be rejected, two benign edits must pass. The port in
 * src/core/dee/strict.ts must reproduce every verdict.
 */
const PROBES: { script: string; text: string; pass: boolean }[] = [
  { script: 'The price was low enough. The hand was already paying.', text: 'The price was not low enough. The hand was not paying.', pass: false },
  { script: 'Only better hands call that bet. Worse ones fold.', text: 'Only worse hands call that bet. Better ones fold.', pass: false },
  { script: 'The pot asked 25%; the hand brought 18%.', text: 'The pot asked 18%; the hand brought 25%.', pass: false },
  { script: 'That hand wanted a bet.', text: 'That hand wanted no bet.', pass: false },
  { script: 'Checking was free. Folding gave the pot away.', text: 'Folding was free. Checking gave the pot away.', pass: false },
  { script: "Lamp's only lit when the ship is real.", text: 'Lamp lit when the ship is real.', pass: false },
  { script: 'Most of the cost is in free folds and missed bets. Toll Road?', text: 'Toll Road? Cost is in free folds and missed bets.', pass: false },
  { script: 'Name the mechanism: domination, realisation, or range asymmetry.', text: 'Name the mechanism: range, asymmetry, or domination.', pass: false },
  { script: 'Price first. The pot asked 25%; the hand brought 18%.', text: 'Price first. Pot asked 25%; hand brought 18%.', pass: true },
  { script: "Twelve inlays. The rim's full.", text: 'Twelve inlays. Rim full.', pass: true },
];

describe('STRICT rephrase checks (ported from the research PoC)', () => {
  it.each(PROBES.map((p) => [p.text, p] as const))('%s', (_t, p) => {
    expect(rephraseProblems(p.text, p.script).length === 0).toBe(p.pass);
  });
});

describe('tone variant checks', () => {
  it('keeps polarity and slot order, and allows the variant its own words', () => {
    expect(variantProblems('Asked {reqPct}, brought {sharePct}.', 'The pot asked {reqPct}; the hand brought {sharePct}.')).toEqual([]);
    expect(variantProblems('Brought {sharePct}, asked {reqPct}.', 'The pot asked {reqPct}; the hand brought {sharePct}.')[0]).toMatch(/^slot-order/);
    expect(variantProblems('The price was not low enough.', 'The price was low enough.')[0]).toMatch(/^polarity/);
    expect(variantProblems('Fold that hand.', 'That hand wanted a bet.')).toContain('new-action:fold');
    expect(variantProblems('Who pays.', 'Who pays it off?')).toContain('question-changed');
  });
});
