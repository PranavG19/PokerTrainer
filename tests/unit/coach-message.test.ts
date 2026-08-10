import { describe, it, expect } from 'vitest';
import { gradeDecision } from '../../src/core/coach.js';
import type { Card } from '../../src/core/cards.js';

/**
 * Two defects found by scripts/audit-w6/a10-coach.ts, both in what the learner actually reads.
 *
 * 1. Folding at toCall 0 reused the priced-fold sentence, whose `required` is 0 because nothing was
 *    owed. It printed "when only 0% was needed" beside a 7.3 bb charge — wording that says the fold
 *    was free while the number says it was the hand's biggest mistake. 254 of 2234 generated messages.
 *
 * 2. A non-finite ΔEV graded 'serious'. Every `<` against NaN is false, so NaN fell past both bands
 *    into the harshest tier: the loudest channel in the product, fired by a division the grader could
 *    not carry out.
 */

const card = (s: string): Card => s as unknown as Card;
const hand = (...cards: string[]): Card[] => cards.map(card);

describe('folding for free is described as giving up a free check', () => {
  it('never claims 0% was needed', () => {
    const grade = gradeDecision({
      hole: hand('As', 'Ah'),
      board: hand('Ad', 'Ac', 'Kh'),
      street: 'river',
      pot: 2060,
      toCall: 0,
      stack: 5000,
      bb: 50,
      chosen: 'fold',
      opponents: 1,
      seed: 7,
    });

    expect(grade.severity).not.toBe('free');
    expect(grade.message).not.toBeNull();
    expect(grade.message).not.toContain('0% was needed');
    // The words must agree with the number: a charge this size cannot read as costless.
    expect(grade.message).toContain('Checking was free');
    expect(grade.message).toMatch(/costs ~\d+\.\d bb/);
  });

  it('keeps the priced wording when a bet actually has to be called', () => {
    // The guard on the fix: the original sentence is correct whenever something WAS owed, and must
    // survive. Folding quads to a small bet is a real mistake at a real price.
    const grade = gradeDecision({
      hole: hand('As', 'Ah'),
      board: hand('Ad', 'Ac', 'Kh'),
      street: 'river',
      pot: 600,
      toCall: 100,
      stack: 5000,
      bb: 50,
      chosen: 'fold',
      opponents: 1,
      seed: 7,
    });

    expect(grade.message).not.toBeNull();
    expect(grade.message).toContain('was needed');
    expect(grade.message).not.toContain('Checking was free');
  });

  it('sweeps the generated space for the contradictory phrasing', () => {
    // The probe's own method, as a test: a10-coach.ts found this by generating thousands of messages,
    // not by reasoning about one. Any free fold that is charged at all must not call the price 0%.
    const offenders: string[] = [];
    for (let pot = 100; pot <= 3000; pot += 100) {
      for (const seed of [1, 2, 3]) {
        const grade = gradeDecision({
          hole: hand('As', 'Ah'),
          board: hand('Ad', 'Ac', 'Kh'),
          street: 'river',
          pot,
          toCall: 0,
          stack: 5000,
          bb: 50,
          chosen: 'fold',
          opponents: 1,
          seed,
        });
        if (grade.message !== null && grade.message.includes('0% was needed')) {
          offenders.push(`pot ${pot} seed ${seed}: ${grade.message}`);
        }
      }
    }
    expect(offenders.slice(0, 3)).toEqual([]);
  });
});

describe('a non-finite loss is silence, not the harshest tier', () => {
  it('does not grade a NaN charge as serious', () => {
    // bb 0 is the measured trigger: the bb division is what goes non-finite.
    const grade = gradeDecision({
      hole: hand('As', 'Ah'),
      board: hand('Ad', 'Ac', 'Kh'),
      street: 'river',
      pot: 2060,
      toCall: 0,
      stack: 5000,
      bb: 0,
      chosen: 'fold',
      opponents: 1,
      seed: 7,
    });

    expect(grade.severity).toBe('free');
    expect(grade.message).toBeNull();
    expect(grade.principle).toBeNull();
  });

  it('never shows the learner the string NaN or Infinity', () => {
    // The user-visible consequence, asserted directly rather than inferred from the tier. Swept over
    // every action and every degenerate quantity the probe tried.
    const degenerate = [
      { label: 'bb 0', bb: 0, pot: 2060, toCall: 0, stack: 5000 },
      { label: 'pot 0 toCall 0', bb: 50, pot: 0, toCall: 0, stack: 5000 },
      { label: 'negative pot', bb: 50, pot: -100, toCall: 0, stack: 5000 },
      { label: 'toCall over stack', bb: 50, pot: 100, toCall: 100_000, stack: 50 },
    ];
    const actions = ['fold', 'check', 'call', 'bet', 'raise', 'allin'] as const;

    for (const spot of degenerate) {
      for (const chosen of actions) {
        const grade = gradeDecision({
          hole: hand('As', 'Ah'),
          board: hand('Ad', 'Ac', 'Kh'),
          street: 'river',
          pot: spot.pot,
          toCall: spot.toCall,
          stack: spot.stack,
          bb: spot.bb,
          chosen,
          opponents: 1,
          seed: 7,
        });
        const where = `${spot.label} / ${chosen}`;
        expect(grade.message ?? '', where).not.toMatch(/NaN|Infinity/);
        if (!Number.isFinite(grade.evLossBb)) {
          expect(grade.severity, `${where} carried a non-finite charge`).toBe('free');
          expect(grade.message, where).toBeNull();
        }
      }
    }
  });
});
