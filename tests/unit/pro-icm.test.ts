import { describe, expect, it } from 'vitest';
import { bubbleFactor, icmEquities, requiredEquity } from '../../src/core/pro/icm.js';
import { binomialCdf, clopperPearson, lnGamma } from '../../src/core/pro/binomial.js';

/**
 * ICM against values worked BY HAND (Malmuth-Harville), each derivation in the comment beside it.
 */
describe('icmEquities (Malmuth-Harville), against hand-computed values', () => {
  it('50 / 30 / 20 chips, paying 50 / 30 / 20', () => {
    // P1 first 50/100 = .5. Second: P2 first (.3) then P1 50/70, plus P3 first (.2) then P1 50/80:
    //   .3 x 5/7 + .2 x 5/8 = .2142857 + .125 = .3392857. Third: 1 - .5 - .3392857 = .1607143.
    //   EV1 = .5 x .5 + .3392857 x .3 + .1607143 x .2 = .25 + .1017857 + .0321429 = .3839286.
    // P2 first .3; second .5 x 30/50 + .2 x 30/80 = .3 + .075 = .375; third .325.
    //   EV2 = .15 + .1125 + .065 = .3275.
    // P3 first .2; second .5 x 20/50 + .3 x 20/70 = .2 + .0857143 = .2857143; third .5142857.
    //   EV3 = .1 + .0857143 + .1028571 = .2885714.
    const eq = icmEquities([50, 30, 20], [0.5, 0.3, 0.2]);
    expect(eq[0]).toBeCloseTo(0.3839286, 6);
    expect(eq[1]).toBeCloseTo(0.3275, 6);
    expect(eq[2]).toBeCloseTo(0.2885714, 6);
    expect(eq.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('heads-up 3:1 paying 70 / 30 is .75 x .7 + .25 x .3 = .6', () => {
    const eq = icmEquities([3, 1], [0.7, 0.3]);
    expect(eq[0]).toBeCloseTo(0.6, 12);
    expect(eq[1]).toBeCloseTo(0.4, 12);
  });

  it('winner-take-all is the chip share; equal stacks split evenly; money left unpaid is nobody’s', () => {
    expect(icmEquities([10, 30, 60], [1])).toEqual([0.1, 0.3, 0.6].map((x) => expect.closeTo(x, 12)));
    const even = icmEquities([20, 20, 20, 20], [0.5, 0.3, 0.2]);
    for (const e of even) expect(e).toBeCloseTo(0.25, 12);
  });

  it('a player who just busted takes the place below everyone alive', () => {
    // [70, 30, 0] paying 50/30/20: P3 is third, .2. P1 = .7 x .5 + .3 x .3 = .44; P2 = .3 x .5 + .7 x .3 = .36.
    const eq = icmEquities([70, 30, 0], [0.5, 0.3, 0.2]);
    expect(eq).toEqual([expect.closeTo(0.44, 12), expect.closeTo(0.36, 12), expect.closeTo(0.2, 12)]);
    // Two bust together at four left, paying three: they share third and fourth (.2 + 0) evenly.
    const two = icmEquities([60, 40, 0, 0], [0.5, 0.3, 0.2]);
    expect(two[2]).toBeCloseTo(0.1, 12);
    expect(two[3]).toBeCloseTo(0.1, 12);
  });

  it('refuses what it cannot price', () => {
    expect(() => icmEquities(new Array(11).fill(10), [1])).toThrow();
    expect(() => icmEquities([10, -1], [1])).toThrow();
    expect(() => icmEquities([10, Number.NaN], [1])).toThrow();
    expect(() => icmEquities([10, 10], [Number.POSITIVE_INFINITY])).toThrow();
  });
});

describe('bubble factor', () => {
  it('50 / 30 / 20 paying 50 / 30 / 20: the 20 stack against the 50 stack is 31 / 23', () => {
    // Risk 20. Now: EV3 = .2885714 (above). Lose: [70, 30, 0] → P3 = .2, loss .0885714 = .62 / 7.
    // Win: [30, 30, 40] → P3 first .4; second .3 x 40/70 twice = .3428571; third .2571429;
    //   EV3 = .2 + .1028571 + .0514286 = .3542857, gain .0657143 = .46 / 7. BF = 62 / 46 = 31 / 23.
    expect(bubbleFactor([50, 30, 20], [0.5, 0.3, 0.2], 2, 0)).toBeCloseTo(31 / 23, 9);
    expect(requiredEquity(31 / 23)).toBeCloseTo(31 / 54, 12);
  });

  it('is 1 when prize equity is linear in chips (winner-take-all, or heads-up)', () => {
    expect(bubbleFactor([50, 30, 20], [1], 1, 2)).toBeCloseTo(1, 12);
    expect(bubbleFactor([40, 60], [0.65, 0.35], 0, 1)).toBeCloseTo(1, 12);
  });

  it('is null for a player against themself or with nothing at risk', () => {
    expect(bubbleFactor([10, 10], [1], 0, 0)).toBeNull();
    expect(bubbleFactor([10, 0], [1], 0, 1)).toBeNull();
  });
});

describe('Clopper-Pearson bands', () => {
  it('has the closed forms at the edges: k = 0 and k = n', () => {
    // k = 0: high = 1 - (tail)^(1/n). k = n: low = tail^(1/n). tail = .05 at 90%.
    expect(clopperPearson(0, 10).high).toBeCloseTo(1 - 0.05 ** (1 / 10), 9);
    expect(clopperPearson(0, 10).low).toBe(0);
    expect(clopperPearson(20, 20).low).toBeCloseTo(0.05 ** (1 / 20), 9);
    expect(clopperPearson(20, 20).high).toBe(1);
  });

  it('matches the published 95% band for 5 of 10: 0.1871 to 0.8129', () => {
    const b = clopperPearson(5, 10, 0.95);
    expect(b.low).toBeCloseTo(0.1871, 4);
    expect(b.high).toBeCloseTo(0.8129, 4);
  });

  it('narrows with n and holds up at 50,000 hands', () => {
    const small = clopperPearson(71, 142);
    const big = clopperPearson(25_000, 50_000);
    expect(small.low).toBeLessThan(0.5);
    expect(small.high).toBeGreaterThan(0.5);
    expect(big.high - big.low).toBeLessThan(0.01);
    expect(big.low).toBeLessThan(0.5);
    expect(big.high).toBeGreaterThan(0.5);
  });

  it('refuses impossible counts and gives the whole interval with no hands', () => {
    expect(() => clopperPearson(3, 2)).toThrow();
    expect(() => clopperPearson(-1, 2)).toThrow();
    expect(() => clopperPearson(1.5, 2)).toThrow();
    expect(clopperPearson(0, 0)).toEqual({ low: 0, high: 1 });
  });

  it('builds on a correct lnGamma and binomial tail', () => {
    expect(lnGamma(1)).toBeCloseTo(0, 12);
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 12);
    expect(lnGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12);
    expect(binomialCdf(5, 10, 0.5)).toBeCloseTo(638 / 1024, 12);
  });
});
