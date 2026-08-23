import { describe, it, expect } from 'vitest';
import { equityVsRandom, equityVsRange, exactEquityHeadsUp, DISPLAY_ITERATIONS } from '../../src/core/equity.js';
import { VILLAIN_BETTING_RANGE } from '../../src/core/preflop.js';

describe('equityVsRandom', () => {
  it('AA vs 1 random opponent preflop ~85%', () => {
    const r = equityVsRandom(['As', 'Ah'], [], 1, 5000, 42);
    expect(r.win + r.tie * 0.5).toBeGreaterThanOrEqual(0.80);
    expect(r.win + r.tie * 0.5).toBeLessThanOrEqual(0.90);
  });

  it('72o vs 1 random opponent preflop < 40%', () => {
    const r = equityVsRandom(['7s', '2c'], [], 1, 5000, 7);
    expect(r.win + r.tie * 0.5).toBeLessThan(0.40);
  });

  it('made nut flush on river wins ~1.0', () => {
    // Hero has As Ks on a board with 3 spades + 2 non-spades, making the nut flush
    const r = equityVsRandom(
      ['As', 'Ks'],
      ['Qs', '9s', '3s', '7h', '2d'],
      1,
      2000,
      99,
    );
    // Nut flush loses only to straight flush — near 1.0
    expect(r.win + r.tie * 0.5).toBeGreaterThan(0.95);
  });

  it('determinism: same seed produces identical results', () => {
    const a = equityVsRandom(['Kh', 'Qh'], ['Th', '9h', '2c'], 2, 1000, 123);
    const b = equityVsRandom(['Kh', 'Qh'], ['Th', '9h', '2c'], 2, 1000, 123);
    expect(a.win).toBe(b.win);
    expect(a.tie).toBe(b.tie);
    expect(a.lose).toBe(b.lose);
    expect(a.categoryChances).toEqual(b.categoryChances);
  });

  it('different seeds produce different results', () => {
    const a = equityVsRandom(['Kh', 'Qh'], [], 1, 1000, 1);
    const b = equityVsRandom(['Kh', 'Qh'], [], 1, 1000, 999);
    // Extremely unlikely to be exactly the same
    expect(a.win === b.win && a.tie === b.tie).toBe(false);
  });

  it('win + tie + lose sums to ~1', () => {
    const r = equityVsRandom(['Jd', 'Ts'], ['9h', '8c', '2d'], 3, 2000, 5);
    expect(r.win + r.tie + r.lose).toBeCloseTo(1.0, 5);
  });

  it('categoryChances values sum to ~1', () => {
    const r = equityVsRandom(['Ac', 'Kd'], [], 1, 2000, 11);
    const sum = Object.values(r.categoryChances).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('categoryChances includes expected categories', () => {
    const r = equityVsRandom(['Ac', 'Kd'], [], 1, 2000, 11);
    expect('Pair' in r.categoryChances).toBe(true);
    expect('High Card' in r.categoryChances).toBe(true);
    expect('Straight Flush' in r.categoryChances).toBe(true);
  });

  it('iterations field matches requested', () => {
    const r = equityVsRandom(['5d', '5h'], [], 2, 3000, 1);
    expect(r.iterations).toBe(3000);
  });

  it('more opponents reduces hero equity', () => {
    const one = equityVsRandom(['Ac', 'Kd'], [], 1, 2000, 1);
    const four = equityVsRandom(['Ac', 'Kd'], [], 4, 2000, 1);
    expect(one.win + one.tie * 0.5).toBeGreaterThan(four.win + four.tie * 0.5);
  });

  it('pair vs overcards on paired board is favored', () => {
    // Hero has pocket aces on a low board
    const r = equityVsRandom(['Ah', 'Ad'], ['3c', '5d', '8h'], 1, 2000, 33);
    expect(r.win + r.tie * 0.5).toBeGreaterThan(0.75);
  });

  it('performance: 2000 iterations in under 300ms', () => {
    const start = performance.now();
    equityVsRandom(['Td', '9d'], [], 3, 2000, 1);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(300);
  });
});

describe('equityVsRange', () => {
  /**
   * The honest grader's equity source (CONSOLIDATED #1). Its defining property against equityVsRandom:
   * a real range is stronger than two random cards, so hero equity vs a range must be LOWER than vs
   * random for the same spot — which is exactly why grading on random overstated hero equity in the
   * bet-facing spots the coach scores. These pin the primitive with KNOWN oracles, not self-comparison.
   */
  it('collapses to exact heads-up equity when the range is a single combo (KK vs [AA] ≈ 0.18)', () => {
    // A one-combo range IS a known hand, so equityVsRange must reproduce exactEquityHeadsUp against it.
    // AA beats KK ~81%, so KK holds ~19% — the enumeration oracle equityVsRandom cannot supply.
    const eq = equityVsRange(['Ks', 'Kd'], [], ['AA'], 6000, 3);
    const share = eq.win + eq.tie * 0.5;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.23);
  });

  it('a marginal made hand has strictly LESS equity vs a strong range than vs random', () => {
    // Pocket nines on A-K-7 beat two random cards comfortably, but a value-weighted betting range is
    // full of aces and kings that crush them — the whole reason random overstated hero equity.
    const hole = ['9c', '9d'];
    const board = ['Ah', 'Kd', '7s'];
    const rand = equityVsRandom(hole, board, 1, DISPLAY_ITERATIONS, 1);
    const range = equityVsRange(hole, board, VILLAIN_BETTING_RANGE, DISPLAY_ITERATIONS, 1);
    expect(range.win + range.tie * 0.5).toBeLessThan(rand.win + rand.tie * 0.5 - 0.1);
  });

  it('is deterministic given the seed', () => {
    const a = equityVsRange(['As', 'Ks'], ['Qs', '9s', '3s'], VILLAIN_BETTING_RANGE, 1500, 123);
    const b = equityVsRange(['As', 'Ks'], ['Qs', '9s', '3s'], VILLAIN_BETTING_RANGE, 1500, 123);
    expect(a.win).toBe(b.win);
    expect(a.tie).toBe(b.tie);
    expect(a.lose).toBe(b.lose);
  });

  it('win + tie + lose sums to ~1', () => {
    const r = equityVsRange(['Jd', 'Ts'], ['9h', '8c', '2d'], VILLAIN_BETTING_RANGE, 2000, 5);
    expect(r.win + r.tie + r.lose).toBeCloseTo(1.0, 5);
  });

  it('an empty range falls back to random rather than dividing by zero', () => {
    const seed = 77;
    const fallback = equityVsRange(['Ac', 'Kd'], ['2c', '7d', 'Ts'], [], DISPLAY_ITERATIONS, seed);
    const random = equityVsRandom(['Ac', 'Kd'], ['2c', '7d', 'Ts'], 1, DISPLAY_ITERATIONS, seed);
    expect(fallback.win).toBe(random.win);
    expect(fallback.tie).toBe(random.tie);
    expect(fallback.lose).toBe(random.lose);
  });
});

describe('exactEquityHeadsUp', () => {
  it('AA vs KK preflop ~0.81', () => {
    const eq = exactEquityHeadsUp(['As', 'Ah'], [], ['Kd', 'Kc']);
    expect(eq).toBeGreaterThanOrEqual(0.78);
    expect(eq).toBeLessThanOrEqual(0.84);
  });

  it('same hand vs same hand on river is 0.5', () => {
    // Both have same kicker situation — board plays
    const eq = exactEquityHeadsUp(
      ['2s', '3s'],
      ['Ah', 'Kh', 'Qd', 'Jc', 'Td'],
      ['2c', '3c'],
    );
    expect(eq).toBe(0.5);
  });

  it('nut hand on river is 1.0', () => {
    // Royal flush on board hero holds As, opponent cannot beat it
    const eq = exactEquityHeadsUp(
      ['As', 'Ks'],
      ['Qs', 'Js', 'Ts', '2h', '3d'],
      ['7c', '8c'],
    );
    expect(eq).toBe(1.0);
  });

  it('dominated hand on river is 0.0', () => {
    const eq = exactEquityHeadsUp(
      ['7c', '8c'],
      ['Qs', 'Js', 'Ts', '2h', '3d'],
      ['As', 'Ks'],
    );
    expect(eq).toBe(0.0);
  });
});
