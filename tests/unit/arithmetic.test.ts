import { describe, it, expect } from 'vitest';
import type { Card } from '../../src/core/cards.js';
import { freshDeck } from '../../src/core/cards.js';
import { mulberry32 } from '../../src/core/rng.js';
import {
  COMMITTED_SPR,
  DEEP_SPR,
  DRILL_KINDS,
  PROBABILITY_TOLERANCE,
  SIGMA_BB_PER_100,
  comboCards,
  comboCount,
  defence,
  generateProblem,
  gradeAnswer,
  naturalFrequency,
  normalCdf,
  parseHolding,
  potOdds,
  riskOfLosing,
  spr,
  sprTolerance,
} from '../../src/core/arithmetic.js';

/**
 * ARITHMETIC — the oracles the task asks for, in order: hand-computed pot odds / MDF / alpha, the
 * mdf + alpha === 1 property over many pairs, combo counting against brute-force enumeration, SPR
 * band boundaries, the variance figure against an independent Monte Carlo, and degenerate inputs.
 *
 * Two of these are genuine independent checks rather than restatements of the implementation: the
 * combo enumeration builds combos out of the real 52-card deck by filtering, and the variance Monte
 * Carlo sums per-hand draws with a seeded RNG and never touches normalCdf.
 */

describe('natural frequencies', () => {
  it('renders the spec\'s teaching example: 28.6% is about 2 times in 7', () => {
    const freq = naturalFrequency(2 / 7);
    expect(freq.times).toBe(2);
    expect(freq.outOf).toBe(7);
    expect(freq.text).toBe('about 2 times in 7');
    expect(freq.error).toBeCloseTo(0, 12);
  });

  it('prefers the smallest denominator on a tie', () => {
    // 1/2 == 2/4 == 3/6; the imageable one is halves.
    expect(naturalFrequency(0.5)).toMatchObject({ times: 1, outOf: 2 });
    expect(naturalFrequency(1 / 3)).toMatchObject({ times: 1, outOf: 3 });
    expect(naturalFrequency(0.25)).toMatchObject({ times: 1, outOf: 4 });
  });

  it('singularises one', () => {
    expect(naturalFrequency(0.2).text).toBe('about 1 time in 5');
  });

  it('never rounds to 0-in-n or n-in-n, and reports the residual error instead', () => {
    const tiny = naturalFrequency(0.01);
    expect(tiny.times).toBe(1);
    expect(tiny.outOf).toBe(12);
    // 1/12 is 7.3 points above the truth. Small probabilities have no honest frequency form.
    expect(tiny.error).toBeCloseTo(1 / 12 - 0.01, 12);

    const huge = naturalFrequency(0.99);
    expect(huge.times).toBe(11);
    expect(huge.outOf).toBe(12);
  });

  it('handles the endpoints and out-of-range inputs as words', () => {
    expect(naturalFrequency(0).text).toBe('never');
    expect(naturalFrequency(-0.5)).toMatchObject({ text: 'never', error: 0.5 });
    expect(naturalFrequency(1).text).toBe('always');
    expect(naturalFrequency(2)).toMatchObject({ text: 'always', error: -1 });
  });

  it('stays within half a denominator step of the truth across the imageable range', () => {
    const rng = mulberry32(4242);
    for (let i = 0; i < 2000; i++) {
      const p = 1 / 12 + rng() * (11 / 12 - 1 / 12);
      const freq = naturalFrequency(p);
      expect(Math.abs(freq.error)).toBeLessThanOrEqual(0.5 / freq.outOf + 1e-12);
      expect(freq.error).toBeCloseTo(freq.times / freq.outOf - p, 12);
    }
  });
});

describe('pot odds', () => {
  it('matches hand computation: 5 into 10 needs 5/20 = 25%', () => {
    const odds = potOdds(10, 5);
    expect(odds.toCall).toBe(5);
    expect(odds.potAfterCall).toBe(20);
    expect(odds.requiredEquity).toBeCloseTo(0.25, 12);
    expect(odds.frequency.text).toBe('about 1 time in 4');
  });

  it('matches hand computation: a pot-sized bet needs 1/3', () => {
    const odds = potOdds(20, 20);
    expect(odds.potAfterCall).toBe(60);
    expect(odds.requiredEquity).toBeCloseTo(1 / 3, 12);
    expect(odds.frequency.text).toBe('about 1 time in 3');
  });

  it('matches hand computation: a half-pot bet needs 1/4, a third-pot bet 1/5', () => {
    // Half pot: 10 into 20 -> 10/(20+10+10) = 25%. Both the bet and the call land in the pot,
    // which is the convention this whole file hangs on.
    expect(potOdds(20, 10).potAfterCall).toBe(40);
    expect(potOdds(20, 10).requiredEquity).toBeCloseTo(0.25, 12);
    // Third pot: 10 into 30 -> 10/50 = 20%.
    expect(potOdds(30, 10).requiredEquity).toBeCloseTo(0.2, 12);
    // Quarter pot: 5 into 20 -> 5/30 = 16.7%.
    expect(potOdds(20, 5).requiredEquity).toBeCloseTo(1 / 6, 12);
  });

  it('a two-thirds pot bet lands at the spec\'s 2-in-7 frequency', () => {
    // 20 into 30 -> 20/70 = 28.57%.
    const odds = potOdds(30, 20);
    expect(odds.requiredEquity).toBeCloseTo(2 / 7, 12);
    expect(odds.frequency).toMatchObject({ times: 2, outOf: 7 });
  });

  it('degenerate: zero bet is a free look, zero pot is 1-in-2', () => {
    const free = potOdds(30, 0);
    expect(free.requiredEquity).toBe(0);
    expect(free.frequency.text).toBe('never');

    const noPot = potOdds(0, 10);
    expect(noPot.requiredEquity).toBeCloseTo(0.5, 12);
    expect(noPot.frequency.text).toBe('about 1 time in 2');
  });

  it('degenerate: zero pot and zero bet does not divide by zero', () => {
    const nothing = potOdds(0, 0);
    expect(nothing.requiredEquity).toBe(0);
    expect(Number.isNaN(nothing.requiredEquity)).toBe(false);
  });

  it('degenerate: a bet larger than the stack is only contested up to the stack', () => {
    // 50 into 20 with 12 behind: you call 12 and the excess 38 comes back, so the price is 12/44.
    const odds = potOdds(20, 50, 12);
    expect(odds.toCall).toBe(12);
    expect(odds.potAfterCall).toBe(44);
    expect(odds.requiredEquity).toBeCloseTo(12 / 44, 12);
    // Cheaper than calling the full 50 would have been, which is the whole point of the cap.
    expect(odds.requiredEquity).toBeLessThan(potOdds(20, 50).requiredEquity);
  });

  it('degenerate: a zero stack cannot call at any price', () => {
    const odds = potOdds(20, 10, 0);
    expect(odds.toCall).toBe(0);
    expect(odds.requiredEquity).toBe(0);
  });
});

describe('MDF and alpha', () => {
  it('matches hand computation at the standard sizings', () => {
    // Half pot: alpha = 0.5/1.5 = 1/3, mdf = 2/3.
    const half = defence(10, 5);
    expect(half.alpha).toBeCloseTo(1 / 3, 12);
    expect(half.mdf).toBeCloseTo(2 / 3, 12);

    // Pot: alpha = 1/2.
    const pot = defence(10, 10);
    expect(pot.alpha).toBeCloseTo(0.5, 12);
    expect(pot.mdf).toBeCloseTo(0.5, 12);

    // Third pot: alpha = 1/4, mdf = 3/4.
    const third = defence(30, 10);
    expect(third.alpha).toBeCloseTo(0.25, 12);
    expect(third.mdf).toBeCloseTo(0.75, 12);

    // Overbet 1.5x pot: alpha = 1.5/2.5 = 0.6.
    const over = defence(20, 30);
    expect(over.alpha).toBeCloseTo(0.6, 12);
    expect(over.mdf).toBeCloseTo(0.4, 12);
  });

  it('mdf + alpha === 1 exactly, over many pot/bet pairs', () => {
    let pairs = 0;
    for (let potBeforeBet = 0; potBeforeBet <= 120; potBeforeBet += 0.5) {
      for (let bet = 0; bet <= 120; bet += 0.5) {
        const { mdf, alpha } = defence(potBeforeBet, bet);
        // Exact equality, not toBeCloseTo: the identity is the lesson.
        expect(mdf + alpha).toBe(1);
        pairs++;
      }
    }
    expect(pairs).toBe(241 * 241);
  });

  it('mdf + alpha === 1 holds on awkward and extreme magnitudes too', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 5000; i++) {
      const potBeforeBet = rng() * 10 ** Math.floor(rng() * 7);
      const bet = rng() * 10 ** Math.floor(rng() * 7);
      const { mdf, alpha } = defence(potBeforeBet, bet);
      expect(mdf + alpha).toBe(1);
      expect(mdf).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(1);
    }
  });

  it('alpha is the same arithmetic as the pot odds the defender faces, one seat over', () => {
    // Both seats are looking at bet/(pot + bet); they just divide by different totals because the
    // caller's own chips join the pot. alpha of a bet equals the pot odds of the same bet doubled
    // in the denominator, so alpha > requiredEquity always.
    for (const [potBeforeBet, bet] of [
      [10, 5],
      [30, 20],
      [8, 8],
      [20, 30],
    ]) {
      const { alpha } = defence(potBeforeBet, bet);
      const { requiredEquity } = potOdds(potBeforeBet, bet);
      expect(alpha).toBeGreaterThan(requiredEquity);
      expect(requiredEquity).toBeCloseTo(bet / (potBeforeBet + 2 * bet), 12);
    }
  });

  it('degenerate: zero bet defends everything, zero pot defends nothing', () => {
    expect(defence(30, 0)).toEqual({ mdf: 1, alpha: 0 });
    expect(defence(0, 30)).toEqual({ mdf: 0, alpha: 1 });
  });

  it('degenerate: an empty pot faced with no bet is not NaN', () => {
    const nothing = defence(0, 0);
    expect(nothing.mdf + nothing.alpha).toBe(1);
    expect(nothing.mdf).toBe(1);
  });
});

describe('combo counting', () => {
  /** Independent oracle: filter the real 52-card deck rather than reasoning about suits. */
  function enumerate(text: string, dead: readonly Card[]): Card[][] {
    const { ranks, suitedness } = parseHolding(text);
    const deck = freshDeck().filter((card) => !dead.includes(card));
    const combos: Card[][] = [];
    for (let i = 0; i < deck.length; i++) {
      for (let j = i + 1; j < deck.length; j++) {
        const a = deck[i];
        const b = deck[j];
        const matches =
          (a[0] === ranks[0] && b[0] === ranks[1]) || (a[0] === ranks[1] && b[0] === ranks[0]);
        if (!matches) continue;
        const isSuited = a[1] === b[1];
        if (suitedness === 'suited' && !isSuited) continue;
        if (suitedness === 'offsuit' && isSuited) continue;
        combos.push([a, b]);
      }
    }
    return combos;
  }

  it('matches the textbook counts on an empty board', () => {
    expect(comboCount(parseHolding('77'))).toBe(6);
    expect(comboCount(parseHolding('AKs'))).toBe(4);
    expect(comboCount(parseHolding('AKo'))).toBe(12);
    expect(comboCount(parseHolding('AK'))).toBe(16);
  });

  it('matches exhaustive enumeration for every holding shape against many dead-card sets', () => {
    const holdings = ['AA', '77', '22', 'AKs', 'AKo', 'AK', 'T9s', 'T9o', 'A5', 'KQo'];
    const boards: Card[][] = [
      [],
      ['Ah'],
      ['Ah', 'Kd'],
      ['Ah', 'As', 'Kd'],
      ['7h', '7s', '7d'],
      ['7h', '7s', '7d', '7c'],
      ['Ah', 'Kh', 'Qh', 'Jh', 'Th'],
      ['Ah', 'Ad', 'Ac', 'Kh', 'Kd', 'Kc'],
      ['Ts', '9s', '2d'],
      ['Ah', 'As', 'Ad', 'Ac', 'Kh', 'Ks', 'Kd', 'Kc'],
    ];
    let checks = 0;
    for (const text of holdings) {
      for (const board of boards) {
        const expected = enumerate(text, board).length;
        expect(comboCount(parseHolding(text), board)).toBe(expected);
        expect(comboCards(parseHolding(text), board)).toHaveLength(expected);
        checks++;
      }
    }
    expect(checks).toBe(100);
  });

  it('degenerate: a fully dead rank leaves zero combos', () => {
    const allAces: Card[] = ['Ah', 'As', 'Ad', 'Ac'];
    expect(comboCount(parseHolding('AA'), allAces)).toBe(0);
    expect(comboCount(parseHolding('AKs'), allAces)).toBe(0);
    expect(comboCount(parseHolding('AK'), allAces)).toBe(0);
    expect(comboCards(parseHolding('AK'), allAces)).toEqual([]);
  });

  it('one dead card removes exactly the expected combos', () => {
    // One ace gone: AA drops 6 -> 3, AKs 4 -> 3, AKo 12 -> 9.
    expect(comboCount(parseHolding('AA'), ['Ah'])).toBe(3);
    expect(comboCount(parseHolding('AKs'), ['Ah'])).toBe(3);
    expect(comboCount(parseHolding('AKo'), ['Ah'])).toBe(9);
    // A card of neither rank changes nothing.
    expect(comboCount(parseHolding('AKo'), ['2c'])).toBe(12);
  });

  it('suited plus offsuit always partitions the unsuited-agnostic count', () => {
    const dead: Card[] = ['Ah', 'Kd', '5c'];
    for (const text of ['AK', 'T9', 'A5', 'Q2']) {
      const any = comboCount(parseHolding(text), dead);
      const suited = comboCount(parseHolding(`${text}s`), dead);
      const offsuit = comboCount(parseHolding(`${text}o`), dead);
      expect(suited + offsuit).toBe(any);
    }
  });

  it('comboCards returns unordered, non-duplicated, dead-free combos', () => {
    const combos = comboCards(parseHolding('AKs'), ['Ah']);
    expect(combos).toHaveLength(3);
    const keys = combos.map(([a, b]) => [a, b].sort().join(''));
    expect(new Set(keys).size).toBe(3);
    expect(combos.flat()).not.toContain('Ah');
  });

  it('rejects malformed holdings, including a suited pair', () => {
    expect(() => parseHolding('XY')).toThrow();
    expect(() => parseHolding('77s')).toThrow();
  });
});

describe('SPR and commitment', () => {
  it('matches hand computation', () => {
    expect(spr(300, 100).spr).toBe(3);
    expect(spr(50, 25).spr).toBe(2);
    expect(spr(1000, 40).spr).toBe(25);
  });

  it('bands are closed at the boundaries: 3 is committed, 6 is medium', () => {
    expect(spr(3 * 10, 10).band).toBe('committed');
    expect(spr(3 * 10 + 0.0001, 10).band).toBe('medium');
    expect(spr(6 * 10, 10).band).toBe('medium');
    expect(spr(6 * 10 + 0.0001, 10).band).toBe('deep');
    expect(COMMITTED_SPR).toBe(3);
    expect(DEEP_SPR).toBe(6);
  });

  it('one pair plays for stacks only inside the committed band', () => {
    expect(spr(29, 10).committedWithOnePair).toBe(true);
    expect(spr(30, 10).committedWithOnePair).toBe(true);
    expect(spr(31, 10).committedWithOnePair).toBe(false);
    expect(spr(1000, 10).committedWithOnePair).toBe(false);
  });

  it('the committed threshold is where two pot-sized bets get it all in', () => {
    // (3^n - 1)/2 = SPR. At SPR 3 that is n = log3(7) ~= 1.77, i.e. inside two bets.
    expect(spr(30, 10).potSizedBetsToAllIn).toBeCloseTo(Math.log(7) / Math.log(3), 10);
    expect(spr(30, 10).potSizedBetsToAllIn).toBeLessThan(2);
    expect(spr(40, 10).potSizedBetsToAllIn).toBeGreaterThan(2);
    // SPR 1 is exactly one pot-sized bet.
    expect(spr(10, 10).potSizedBetsToAllIn).toBeCloseTo(1, 10);
  });

  it('degenerate: zero pot is infinite SPR and never committed', () => {
    const noPot = spr(100, 0);
    expect(noPot.spr).toBe(Infinity);
    expect(noPot.band).toBe('deep');
    expect(noPot.potSizedBetsToAllIn).toBe(Infinity);
    expect(noPot.committedWithOnePair).toBe(false);
  });

  it('degenerate: a zero stack is SPR 0, committed, and needs no bets', () => {
    const broke = spr(0, 40);
    expect(broke.spr).toBe(0);
    expect(broke.band).toBe('committed');
    expect(broke.potSizedBetsToAllIn).toBe(0);
    expect(broke.committedWithOnePair).toBe(true);
  });
});

describe('the variance figure', () => {
  it('normalCdf is accurate to better than 1e-7 at known points', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1)).toBeCloseTo(0.8413447460685429, 7);
    expect(normalCdf(-1)).toBeCloseTo(0.15865525393145707, 7);
    // 7.5e-8 is the published bound of A&S 26.2.17, and z ~= 1.96 is close to where it is tightest
    // against it, so this asserts the documented accuracy rather than a tighter one it cannot meet.
    expect(Math.abs(normalCdf(1.959963984540054) - 0.975)).toBeLessThan(7.5e-8);
    expect(Math.abs(normalCdf(3) - 0.9986501019683699)).toBeLessThan(7.5e-8);
    expect(Math.abs(normalCdf(-3) - 0.0013498980316301)).toBeLessThan(7.5e-8);
    // Symmetry, which the recursion for negative z must not break.
    for (const z of [0.3, 1.1, 2.7, 4.5]) {
      expect(normalCdf(z) + normalCdf(-z)).toBeCloseTo(1, 12);
    }
  });

  /**
   * Independent oracle. Sums per-hand results drawn from a Box-Muller normal with per-hand sigma =
   * sigma_per_100 / 10, counting sessions that finish at or below the threshold. Touches neither
   * normalCdf nor riskOfLosing.
   */
  function simulate(
    hands: number,
    winRateBbPer100: number,
    buyIns: number,
    sessions: number,
    seed: number,
    sigmaBbPer100 = SIGMA_BB_PER_100,
  ): number {
    const rng = mulberry32(seed);
    const perHandMean = winRateBbPer100 / 100;
    const perHandSigma = sigmaBbPer100 / Math.sqrt(100);
    const threshold = -buyIns * 100;
    let losers = 0;
    for (let s = 0; s < sessions; s++) {
      let total = 0;
      for (let h = 0; h < hands; h++) {
        // Box-Muller. u1 is clamped off zero because log(0) is -Infinity.
        const u1 = Math.max(rng(), 1e-12);
        const u2 = rng();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        total += perHandMean + perHandSigma * z;
      }
      if (total <= threshold) losers++;
    }
    return losers / sessions;
  }

  it('reproduces the spec\'s claim: ~8% of 200-hand sessions lose two or more buy-ins at zero error', () => {
    const risk = riskOfLosing({ hands: 200, winRateBbPer100: 0, buyIns: 2 });
    // Analytic: Phi(-200 / (100 * sqrt(2))) = Phi(-1.4142) = 7.86%.
    expect(risk.probability).toBeCloseTo(0.0786, 4);
    expect(risk.expectedBb).toBe(0);
    expect(risk.sigmaBb).toBeCloseTo(141.42, 2);
    expect(risk.thresholdBb).toBe(-200);

    const simulated = simulate(200, 0, 2, 40_000, 12345);
    // 40k sessions: standard error ~0.13 points, so 0.6 points of slack is ~4.5 sigma.
    expect(simulated).toBeCloseTo(risk.probability, 2);
    expect(Math.abs(simulated - risk.probability)).toBeLessThan(0.006);
    // And the spec's headline number itself.
    expect(simulated).toBeGreaterThan(0.06);
    expect(simulated).toBeLessThan(0.1);
  });

  it('agrees with the Monte Carlo across win rates, session lengths and thresholds', () => {
    const cases = [
      { hands: 200, winRateBbPer100: 5, buyIns: 2 },
      { hands: 200, winRateBbPer100: -5, buyIns: 1 },
      { hands: 500, winRateBbPer100: 0, buyIns: 3 },
      { hands: 1000, winRateBbPer100: 10, buyIns: 2 },
      { hands: 100, winRateBbPer100: 0, buyIns: 1 },
    ];
    for (const [index, query] of cases.entries()) {
      const analytic = riskOfLosing(query).probability;
      const simulated = simulate(
        query.hands,
        query.winRateBbPer100,
        query.buyIns,
        20_000,
        1000 + index,
      );
      expect(Math.abs(simulated - analytic)).toBeLessThan(0.012);
    }
  });

  it('a lower sigma shrinks the risk, monotonically', () => {
    const risks = [150, 100, 60, 30].map(
      (sigma) => riskOfLosing({ hands: 200, winRateBbPer100: 0, buyIns: 2, sigmaBbPer100: sigma }).probability,
    );
    for (let i = 1; i < risks.length; i++) expect(risks[i]).toBeLessThan(risks[i - 1]);
    // Cross-check the tightest one against simulation, where the tail is genuinely thin.
    expect(
      simulate(200, 0, 2, 20_000, 777, 60),
    ).toBeCloseTo(risks[2], 2);
  });

  it('a winning player is still exposed over a short session — the lesson of the table', () => {
    const winner = riskOfLosing({ hands: 200, winRateBbPer100: 10, buyIns: 2 });
    const breakEven = riskOfLosing({ hands: 200, winRateBbPer100: 0, buyIns: 2 });
    expect(winner.probability).toBeLessThan(breakEven.probability);
    expect(winner.probability).toBeGreaterThan(0.05);
    expect(winner.frequency.outOf).toBeLessThanOrEqual(12);
  });

  it('the risk of a fixed buy-in loss peaks mid-sample rather than falling monotonically', () => {
    const at = (hands: number) =>
      riskOfLosing({ hands, winRateBbPer100: 5, buyIns: 2 }).probability;

    // Sigma grows as sqrt(hands) while the mean grows linearly, so a fixed -200 bb threshold first
    // gets easier to reach (variance outruns the edge) and only later gets harder. Asserting a
    // monotone decline here would have been wrong; the peak is around a few thousand hands.
    expect(at(2000)).toBeGreaterThan(at(200));
    expect(at(2000)).toBeCloseTo(0.251, 3);
    expect(at(20_000)).toBeLessThan(at(2000));
    // Still ~20% at 20k hands: two buy-ins down is not evidence of a leak even over a long sample.
    expect(at(20_000)).toBeGreaterThan(0.15);
    // Only at a genuinely large sample does the edge dominate.
    expect(at(1_000_000)).toBeLessThan(0.001);
  });

  it('degenerate: zero hands, zero sigma, and a zero threshold', () => {
    // No hands played: you cannot be down two buy-ins.
    expect(riskOfLosing({ hands: 0, winRateBbPer100: 0, buyIns: 2 }).probability).toBe(0);
    // No variance and a winning rate: certainty of not losing.
    expect(
      riskOfLosing({ hands: 200, winRateBbPer100: 5, buyIns: 1, sigmaBbPer100: 0 }).probability,
    ).toBe(0);
    // No variance and a losing rate below the threshold: certainty of losing.
    expect(
      riskOfLosing({ hands: 10_000, winRateBbPer100: -5, buyIns: 2, sigmaBbPer100: 0 }).probability,
    ).toBe(1);
    // Losing anything at all at a zero win rate is a coin flip.
    expect(riskOfLosing({ hands: 200, winRateBbPer100: 0, buyIns: 0 }).probability).toBeCloseTo(
      0.5,
      6,
    );
  });
});

describe('problem generator and grading', () => {
  it('is a pure function of its seed', () => {
    for (const seed of [1, 2, 12345, 0xffff]) {
      expect(generateProblem(seed)).toEqual(generateProblem(seed));
    }
    expect(generateProblem(1)).not.toEqual(generateProblem(2));
  });

  it('produces plausible, mentally tractable figures across 500 seeds', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 500; seed++) {
      const problem = generateProblem(seed);
      kinds.add(problem.kind);
      expect(problem.potBeforeBet).toBeGreaterThan(0);
      expect(problem.bet).toBeGreaterThan(0);
      // Half-bb granularity keeps the arithmetic about poker, not long division.
      expect(problem.bet * 2).toBe(Math.round(problem.bet * 2));
      expect(problem.potBeforeBet * 2).toBe(Math.round(problem.potBeforeBet * 2));
      // Bets stay inside sane sizing bounds and never exceed the stack behind. The +0.25 is the
      // half-bb rounding: on a 3 bb pot a 1.25x bet rounds to 4, which is still a real sizing.
      expect(problem.bet).toBeLessThanOrEqual(problem.potBeforeBet * 1.25 + 0.25);
      expect(problem.effectiveStack).toBeGreaterThanOrEqual(problem.bet);
      expect(problem.prompt.length).toBeGreaterThan(10);
      expect(problem.tolerance).toBeGreaterThan(0);
      expect(Number.isFinite(problem.answer)).toBe(true);
    }
    // Every drill kind is reachable from the default (unspecified) path.
    expect([...kinds].sort()).toEqual([...DRILL_KINDS].sort());
  });

  it('honours a requested kind and answers it consistently with the primitives', () => {
    for (let seed = 1; seed <= 200; seed++) {
      for (const kind of DRILL_KINDS) {
        const problem = generateProblem(seed, kind);
        expect(problem.kind).toBe(kind);
        const { potBeforeBet, bet, effectiveStack } = problem;
        if (kind === 'pot-odds') {
          expect(problem.answer).toBe(potOdds(potBeforeBet, bet, effectiveStack).requiredEquity);
        } else if (kind === 'alpha') {
          expect(problem.answer).toBe(defence(potBeforeBet, bet).alpha);
        } else if (kind === 'mdf') {
          expect(problem.answer).toBe(defence(potBeforeBet, bet).mdf);
        } else {
          expect(problem.answer).toBe(
            spr(effectiveStack - bet, potBeforeBet + 2 * bet).spr,
          );
        }
      }
    }
  });

  it('probability drills use the 2-point band; SPR drills use the looser SPR band', () => {
    for (const kind of ['pot-odds', 'alpha', 'mdf'] as const) {
      expect(generateProblem(7, kind).tolerance).toBe(PROBABILITY_TOLERANCE);
    }
    const sprProblem = generateProblem(7, 'spr');
    expect(sprProblem.tolerance).toBe(sprTolerance(sprProblem.answer));
    // At small SPR the floor binds; at large SPR the 5% term does.
    expect(sprTolerance(1)).toBe(0.25);
    expect(sprTolerance(5)).toBe(0.25);
    expect(sprTolerance(20)).toBeCloseTo(1, 12);
  });

  it('grades inside, exactly on, and outside the band', () => {
    const problem = generateProblem(3, 'pot-odds');
    const { answer, tolerance } = problem;
    expect(gradeAnswer(problem, answer).correct).toBe(true);
    expect(gradeAnswer(problem, answer + tolerance).correct).toBe(true);
    expect(gradeAnswer(problem, answer - tolerance).correct).toBe(true);
    expect(gradeAnswer(problem, answer + tolerance * 1.5).correct).toBe(false);
    expect(gradeAnswer(problem, answer + tolerance * 1.5).error).toBeCloseTo(tolerance * 1.5, 12);
    expect(gradeAnswer(problem, 0).correct).toBe(false);
  });

  it('the band accepts a learner who answered via the taught frequency rendering', () => {
    // The whole point of the tolerance: reasoning "2 in 7" must not be graded wrong.
    for (let seed = 1; seed <= 300; seed++) {
      for (const kind of ['pot-odds', 'alpha', 'mdf'] as const) {
        const problem = generateProblem(seed, kind);
        const freq = naturalFrequency(problem.answer);
        // Only meaningful where a frequency form exists at all (see MAX_FREQUENCY_DENOMINATOR).
        if (Math.abs(freq.error) > PROBABILITY_TOLERANCE) continue;
        expect(gradeAnswer(problem, freq.times / freq.outOf).correct).toBe(true);
      }
    }
  });
});

describe('every generated problem is answerable', () => {
  /**
   * An SPR problem needs chips BEHIND the call, not merely enough to cover it. The generator clamped
   * effectiveStack to `bet` exactly, so `effectiveStack - bet` was 0 and the prompt read
   * "0 bb behind. SPR?" with answer 0 and tolerance 0.25: every guess in [-0.25, 0.25] accepted,
   * nothing to compute, and the drill screen's worked method then explained a ratio for a stack that
   * was already all in. 7.0% of the sequence the screen actually serves, and 6.1% of arbitrary seeds
   * (scripts/audit-w6/a24-spr-degenerate.ts).
   */
  it('leaves something behind the call on every SPR problem', () => {
    const degenerate: string[] = [];
    for (let seed = 1; seed <= 3000; seed++) {
      const problem = generateProblem(seed, 'spr');
      const behind = problem.effectiveStack - problem.bet;
      if (behind <= 0) degenerate.push(`seed ${seed}: "${problem.prompt}" behind=${behind}`);
    }
    expect(degenerate.slice(0, 5)).toEqual([]);
  });

  it('never asks for an SPR whose answer is zero', () => {
    // The user-visible consequence, asserted separately: a zero answer is what makes the tolerance
    // band swallow every guess, so it is worth pinning independently of how the stack is derived.
    for (let seed = 1; seed <= 3000; seed++) {
      const problem = generateProblem(seed, 'spr');
      expect(problem.answer, `seed ${seed}: ${problem.prompt}`).toBeGreaterThan(0);
    }
  });

  it('still produces a solvable problem of every kind', () => {
    // The guard: raising the stack floor must not push any kind into a degenerate or unanswerable
    // shape. A finite, non-negative answer with a positive band is the minimum for every kind.
    for (const kind of DRILL_KINDS) {
      for (let seed = 1; seed <= 300; seed++) {
        const problem = generateProblem(seed, kind);
        const where = `${kind} seed ${seed}`;
        expect(Number.isFinite(problem.answer), where).toBe(true);
        expect(problem.answer, where).toBeGreaterThanOrEqual(0);
        expect(problem.tolerance, where).toBeGreaterThan(0);
        expect(gradeAnswer(problem, problem.answer).correct, where).toBe(true);
      }
    }
  });
});
