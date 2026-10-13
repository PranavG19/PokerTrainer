import { describe, expect, it } from 'vitest';
import { CLOSE_Z, MODEL_MARGIN, closeBand, isClose, samplingHalfWidth } from '../../src/core/closeSpot.js';
import { DISPLAY_ITERATIONS, type EquityResult } from '../../src/core/equity.js';
import { gradeDecision } from '../../src/core/coach.js';

const eq = (win: number, tie: number, iterations = DISPLAY_ITERATIONS): EquityResult => ({
  win,
  tie,
  lose: 1 - win - tie,
  categoryChances: {},
  iterations,
});

/**
 * THE CLOSE-SPOT BAND (Wave 0 package 0.2). The grader used hard bb thresholds on a 2000-iteration Monte
 * Carlo, so in a big pot a call inside the model's own noise graded "serious" and flipped on a re-seed.
 */
describe('the band', () => {
  it('is about ±2.2 pot-share points of sampling error for a coin flip at 2000 iterations', () => {
    expect(samplingHalfWidth(eq(0.5, 0))).toBeCloseTo(CLOSE_Z * Math.sqrt(0.25 / 2000), 10);
    expect(samplingHalfWidth(eq(0.5, 0))).toBeGreaterThan(0.021);
    expect(samplingHalfWidth(eq(0.5, 0))).toBeLessThan(0.023);
  });

  it('uses the exact per-trial variance, so ties shrink it and a lock has none', () => {
    // A trial scores 1, 1/2 or 0: all ties is a certain 1/2, zero variance.
    expect(samplingHalfWidth(eq(0, 1))).toBe(0);
    expect(samplingHalfWidth(eq(1, 0))).toBe(0);
    expect(samplingHalfWidth(eq(0.4, 0.2))).toBeLessThan(samplingHalfWidth(eq(0.5, 0)));
  });

  it('adds the model margin, pinned so it moves only on purpose', () => {
    expect(MODEL_MARGIN).toBe(0.025);
    expect(closeBand(eq(0.5, 0))).toBeCloseTo(samplingHalfWidth(eq(0.5, 0)) + 0.025, 12);
  });

  it('has no sample, so no opinion, at zero iterations', () => {
    expect(samplingHalfWidth(eq(0.5, 0, 0))).toBe(Number.POSITIVE_INFINITY);
  });

  it('treats non-finite inputs as not close (they are no grade at all)', () => {
    expect(isClose(Number.NaN, 0.3, 0.05)).toBe(false);
    expect(isClose(0.3, Number.NaN, 0.05)).toBe(false);
    expect(isClose(0.31, 0.33, 0.05)).toBe(true);
    expect(isClose(0.2, 0.33, 0.05)).toBe(false);
  });
});

/** A river call two points under a one-third price, in an 80bb pot: 2.3bb at the point estimate. */
const BIG_POT_CALL = {
  hole: ['As', 'Tc'],
  board: ['2c', '8d', 'Jc', '5h', '4c'],
  street: 'river',
  pot: 4000,
  toCall: 2000,
  stack: 3000,
  bb: 50,
  opponents: 1,
  seed: 7,
} as const;

describe('a close spot in the grader', () => {
  it('grades a call inside the noise as close, not serious', () => {
    // Before the band: 'serious', 2.3bb, the loudest channel for a decision the model cannot resolve.
    const g = gradeDecision({ ...BIG_POT_CALL, hole: [...BIG_POT_CALL.hole], board: [...BIG_POT_CALL.board], chosen: 'call' });
    expect(g.close).toBe(true);
    expect(g.severity).toBe('free');
    expect(g.evLossBb).toBe(0);
    expect(g.principle).toBeNull();
    expect(g.estimateLossBb).toBeGreaterThan(2);
  });

  it('still speaks when the estimate alone would have, with no bb figure', () => {
    // Silence keeps meaning "under half a big blind": a close spot whose estimate is above that says so.
    const g = gradeDecision({ ...BIG_POT_CALL, hole: [...BIG_POT_CALL.hole], board: [...BIG_POT_CALL.board], chosen: 'call' });
    expect(g.message).toMatch(/^Close spot:/);
    expect(g.message).not.toMatch(/bb/);
    expect(g.message).not.toMatch(/% equity/);
    expect(g.message).toContain('33% pot share');
    expect(g.price).toBeUndefined(); // two near shares would overprint on the meter
  });

  it('marks the other side of the same spot close and played right (estimate 0)', () => {
    const fold = gradeDecision({ ...BIG_POT_CALL, hole: [...BIG_POT_CALL.hole], board: [...BIG_POT_CALL.board], chosen: 'fold' });
    expect(fold.close).toBe(true);
    expect(fold.estimateLossBb).toBe(0);
    expect(fold.message).toBeNull();
  });

  it('does not flip severity when the Monte Carlo is re-seeded', () => {
    const severities = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const g = gradeDecision({ ...BIG_POT_CALL, hole: [...BIG_POT_CALL.hole], board: [...BIG_POT_CALL.board], chosen: 'call', seed });
      severities.add(g.close ? 'close' : g.severity);
    }
    expect([...severities]).toEqual(['close']);
  });

  it('leaves a clear mistake outside the band untouched', () => {
    // 72o with no pair on a broadway river, calling a double-pot bet: nowhere near the 40% price.
    const g = gradeDecision({
      hole: ['7c', '2d'],
      board: ['As', 'Kh', 'Qd', 'Jc', '9s'],
      street: 'river',
      pot: 20,
      toCall: 40,
      stack: 100,
      bb: 2,
      chosen: 'call',
      opponents: 1,
      seed: 5,
    });
    expect(g.close).toBe(false);
    expect(g.severity).toBe('serious');
    expect(g.estimateLossBb).toBe(g.evLossBb);
  });

  it('never makes a free fold close: checking dominates it exactly', () => {
    const g = gradeDecision({
      hole: ['As', 'Ac'],
      board: ['Ah', 'Ad', 'Kc', '7s', '2d'],
      street: 'river',
      pot: 600,
      toCall: 0,
      stack: 5000,
      bb: 50,
      chosen: 'fold',
      opponents: 1,
      seed: 7,
    });
    expect(g.close).toBe(false);
    expect(g.severity).toBe('serious');
  });
});

/** The seam to Dee's "Price held" (owner D6): the band, not a fixed 10-point rule, decides what is close. */
describe('Price held reads the close band', () => {
  it('a close fold on the right side of the price holds; the same spot\'s call does not', async () => {
    const { isPriceHeld } = await import('../../src/core/dee/engine.js');
    const decide = (chosen: 'call' | 'fold') => {
      const grade = gradeDecision({ ...BIG_POT_CALL, hole: [...BIG_POT_CALL.hole], board: [...BIG_POT_CALL.board], chosen });
      return {
        grade,
        d: {
          grade, action: chosen, street: 'river', toCall: BIG_POT_CALL.toCall, pot: BIG_POT_CALL.pot,
          confidence: 'sure' as const, reasonCategory: 'price' as const, rightForWrongReason: false,
        },
      };
    };
    const fold = decide('fold');
    expect(fold.grade.close).toBe(true);
    expect(fold.grade.spot).toBeDefined();
    expect(isPriceHeld(fold.d, fold.grade.close)).toBe(true);
    const call = decide('call');
    expect(isPriceHeld(call.d, call.grade.close)).toBe(false); // close, but short of the price
  });
});
