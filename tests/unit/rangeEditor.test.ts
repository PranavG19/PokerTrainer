import { describe, it, expect } from 'vitest';
import {
  clearAll,
  clearCombo,
  deserializeRange,
  emptyRange,
  hasCombo,
  paintCombo,
  rangeWeight,
  rangeWidth,
  scoreDrill,
  serializeRange,
  toggleCombo,
  type SavedRange,
} from '../../src/core/rangeEditor.js';
import { comboWeight } from '../../src/core/preflop.js';

/**
 * REAL ORACLE: the range model is pure set algebra over the canonical 169 combos, reusing preflop.ts for
 * every combo fact. These tests pin paint/clear/toggle membership, the serialise/deserialise round trip
 * (including tolerant recovery of a corrupt save), and drill scoring against a range the learner painted.
 */

function build(...combos: string[]): SavedRange {
  return combos.reduce((r, c) => paintCombo(r, c), emptyRange('test'));
}

describe('paint / clear / membership', () => {
  it('an empty range has no combos', () => {
    const r = emptyRange('  UTG opens  ');
    expect(r.name).toBe('UTG opens'); // trimmed
    expect(r.combos).toEqual([]);
    expect(hasCombo(r, 'AA')).toBe(false);
  });

  it('paint adds a combo and reports membership', () => {
    const r = paintCombo(emptyRange('r'), 'AA');
    expect(hasCombo(r, 'AA')).toBe(true);
    expect(r.combos).toEqual(['AA']);
  });

  it('paint is idempotent and does not mutate the input', () => {
    const before = build('AA', 'KK');
    const after = paintCombo(before, 'AA');
    expect(after.combos).toEqual(['AA', 'KK']);
    expect(before.combos).toEqual(['AA', 'KK']); // unmutated
  });

  it('paint rejects a non-canonical combo rather than storing it', () => {
    expect(() => paintCombo(emptyRange('r'), 'ZZ')).toThrow();
    expect(() => paintCombo(emptyRange('r'), 'AKx')).toThrow();
  });

  it('combos are kept in canonical grid order regardless of paint order', () => {
    const r = build('72o', 'AA', 'KQs', 'AKo');
    // ALL_COMBOS order: AA before AKo before KQs before 72o.
    expect(r.combos).toEqual(['AA', 'AKo', 'KQs', '72o']);
  });

  it('clear removes a combo and is idempotent when absent', () => {
    const r = build('AA', 'KK');
    expect(clearCombo(r, 'AA').combos).toEqual(['KK']);
    expect(clearCombo(r, 'QQ')).toBe(r); // absent → same reference, unchanged
  });

  it('toggle paints when absent and clears when present', () => {
    const painted = toggleCombo(emptyRange('r'), 'JTs');
    expect(hasCombo(painted, 'JTs')).toBe(true);
    expect(hasCombo(toggleCombo(painted, 'JTs'), 'JTs')).toBe(false);
  });

  it('clearAll empties the range but keeps the name', () => {
    const r = build('AA', 'KK', 'QQ');
    const cleared = clearAll(r);
    expect(cleared.combos).toEqual([]);
    expect(cleared.name).toBe('test');
  });
});

describe('range width (reuses preflop combo weighting)', () => {
  it('weight sums the per-combo combinations, width divides by 1326', () => {
    const r = build('AA', 'AKs', 'AKo'); // 6 + 4 + 12 = 22 combinations
    expect(rangeWeight(r)).toBe(comboWeight('AA') + comboWeight('AKs') + comboWeight('AKo'));
    expect(rangeWeight(r)).toBe(22);
    expect(rangeWidth(r)).toBeCloseTo(22 / 1326, 10);
  });

  it('an empty range is 0% wide', () => {
    expect(rangeWidth(emptyRange('r'))).toBe(0);
  });
});

describe('serialize / deserialize round trip', () => {
  it('round-trips an arbitrary painted range exactly', () => {
    const r = build('AA', 'AKo', 'KQs', '72o', '55');
    const round = deserializeRange(serializeRange(r));
    expect(round).toEqual(r);
  });

  it('drops non-canonical combos and dedupes on load (tolerant recovery)', () => {
    const round = deserializeRange({ name: 'saved', combos: ['AA', 'AA', 'garbage', 'KQs', 42, 'zz'] });
    expect(round.name).toBe('saved');
    expect(round.combos).toEqual(['AA', 'KQs']);
  });

  it('re-sorts an out-of-order stored combo list into canonical order', () => {
    const round = deserializeRange({ name: 'x', combos: ['72o', 'AA', 'KQs'] });
    expect(round.combos).toEqual(['AA', 'KQs', '72o']);
  });

  it('a malformed blob degrades to an empty, unnamed range rather than throwing', () => {
    expect(deserializeRange(null)).toEqual({ name: '', combos: [] });
    expect(deserializeRange('nope')).toEqual({ name: '', combos: [] });
    expect(deserializeRange({ combos: 'not-an-array' })).toEqual({ name: '', combos: [] });
  });
});

describe('drill scoring', () => {
  const range = build('AA', 'KK', 'AKs');

  it('answering "in" for an in-range hand is correct', () => {
    const v = scoreDrill(range, 'AA', 'in');
    expect(v).toEqual({ combo: 'AA', inRange: true, answer: 'in', correct: true });
  });

  it('answering "out" for an in-range hand is wrong', () => {
    expect(scoreDrill(range, 'KK', 'out').correct).toBe(false);
  });

  it('answering "out" for an out-of-range hand is correct', () => {
    const v = scoreDrill(range, '72o', 'out');
    expect(v.inRange).toBe(false);
    expect(v.correct).toBe(true);
  });

  it('answering "in" for an out-of-range hand is wrong', () => {
    expect(scoreDrill(range, '72o', 'in').correct).toBe(false);
  });

  it('every hand in an empty range is correctly "out"', () => {
    expect(scoreDrill(emptyRange('r'), 'AA', 'out').correct).toBe(true);
    expect(scoreDrill(emptyRange('r'), 'AA', 'in').correct).toBe(false);
  });
});
