import { describe, expect, it } from 'vitest';
import { ALL_COMBOS, type Combo } from '../../src/core/preflop.js';
import { classEquity, equityVsAny, handVsRange, rangeShare, rangeVsRange, strengthOrdering, topRange } from '../../src/core/pro/preflopEquity.js';
import { callGainsFor, shapeOf, solveShove, type ShoveSpot } from '../../src/core/pro/pushFold.js';
import { classIndex } from '../../src/core/pro/handClasses.js';
import { parseShoveRequest } from '../../src/core/pro/analysis.js';
import { equityVsRange } from '../../src/core/equity.js';

const at = (c: Combo): number => ALL_COMBOS.indexOf(c);
const hu = (stack: number, ante = 0): ShoveSpot => ({ stacks: [stack, stack], button: 0, hero: 0, ante, payouts: [] });
const only = (combos: readonly Combo[]): Float64Array => {
  const r = new Float64Array(169);
  for (const c of combos) r[at(c)] = 1;
  return r;
};

describe('the preflop all-in table', () => {
  it('agrees with published preflop equities', () => {
    // Widely published all-in figures (e.g. any equity calculator): AA vs a random hand 85.2%, KK 82.4%,
    // AA vs KK about 82%, AKo vs QQ about 43%, 22 vs AKo about 52%, the worst hand 32o about 32%.
    const any = equityVsAny();
    expect(any[at('AA')]).toBeCloseTo(0.852, 2);
    expect(any[at('KK')]).toBeCloseTo(0.824, 2);
    expect(classEquity('AA', 'KK')).toBeGreaterThan(0.815);
    expect(classEquity('AA', 'KK')).toBeLessThan(0.83);
    expect(classEquity('AKo', 'QQ')).toBeCloseTo(0.434, 2);
    expect(classEquity('22', 'AKo')).toBeCloseTo(0.524, 2);
    expect(ALL_COMBOS[strengthOrdering()[168]]).toBe('32o');
    expect(any[at('32o')]).toBeCloseTo(0.323, 2);
  });

  it('agrees with the existing engine (equity.ts) on hand-vs-range spots', () => {
    // The engine's Monte Carlo at 20,000 runs is within ~1 point (3 standard errors) of the table.
    const spots: [string, string, Combo[]][] = [
      ['Ah', 'Kd', ['QQ', 'JJ', 'TT']],
      ['7s', '7d', ['AKs', 'AKo', 'AQs']],
      ['9c', '8c', ['AA', 'KK', 'AKo']],
    ];
    for (const [a, b, villain] of spots) {
      const engine = equityVsRange([a, b], [], villain, 20_000, 3);
      const mine = handVsRange(classIndex(a[0] === b[0] ? `${a[0]}${b[0]}` : `${a[0]}${b[0]}${a[1] === b[1] ? 's' : 'o'}`), only(villain));
      expect(Math.abs(engine.win + engine.tie / 2 - mine.equity!)).toBeLessThan(0.012);
    }
  });

  it('is antisymmetric, and range vs range follows', () => {
    expect(classEquity('AKs', 'QQ') + classEquity('QQ', 'AKs')).toBeCloseTo(1, 9);
    expect(classEquity('T9s', 'T9s')).toBe(0.5);
    const a = topRange(0.1);
    const b = topRange(0.3);
    expect(rangeVsRange(a, b)! + rangeVsRange(b, a)!).toBeCloseTo(1, 9);
    expect(rangeVsRange(a, b)!).toBeGreaterThan(0.5);
    expect(rangeVsRange(new Float64Array(169), b)).toBeNull();
  });

  it('cuts top-N% ranges to the hand, not the class', () => {
    expect(rangeShare(topRange(0.15))).toBeCloseTo(0.15, 9);
    expect(rangeShare(topRange(1))).toBeCloseTo(1, 9);
    expect(topRange(0.01)[at('AA')]).toBe(1);
    expect(topRange(0)[at('AA')]).toBe(0);
  });
});

describe('heads-up push-fold, chip EV (zero-sum): the Nash equilibrium', () => {
  it('converges: neither side gains a hundredth of a big blind a hand by deviating', () => {
    for (const s of [5, 10, 15, 20]) {
      const r = solveShove(hu(s), 'equilibrium');
      expect(r.exploitability!, `${s}bb`).toBeLessThan(0.003);
    }
  });

  it('matches the published HU Nash reference at 10bb: SB shoves ~58%, BB calls ~37%', () => {
    // Published heads-up push/fold Nash charts (no ante) put the 10bb small-blind shove near 58% of hands
    // and the big-blind call near 37%. Within two points of each.
    const r = solveShove(hu(10), 'equilibrium');
    expect(r.pushShare).toBeGreaterThan(0.56);
    expect(r.pushShare).toBeLessThan(0.6);
    expect(r.callShares[0]).toBeGreaterThan(0.35);
    expect(r.callShares[0]).toBeLessThan(0.39);
  });

  it('narrows as stacks deepen, and an ante widens it', () => {
    const shares = [3, 6, 10, 15, 20].map((s) => solveShove(hu(s), 'equilibrium').pushShare);
    for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeLessThan(shares[i - 1]);
    expect(solveShove(hu(10, 0.1), 'equilibrium').pushShare).toBeGreaterThan(shares[2]);
  });

  it('at 1bb the big blind is already all in, so every hand shoves', () => {
    expect(solveShove(hu(1), 'equilibrium').pushShare).toBeCloseTo(1, 9);
  });

  it('the big blind’s best call against ANY two cards is exactly the pot-odds line, (S - 1) / 2S', () => {
    // SB shoves everything at 10bb: BB risks 9 to win 11 more, needing 9 / 20 = 45% against a random hand.
    const gains = callGainsFor(hu(10), 0, new Float64Array(169).fill(1));
    const any = equityVsAny();
    for (let i = 0; i < 169; i++) {
      if (Math.abs(any[i] - 0.45) < 1e-3) continue;
      expect(gains[i] > 0, ALL_COMBOS[i]).toBe(any[i] > 0.45);
    }
  });

  it('a hand shoved part of the time is (near) indifferent: the mix is the equilibrium, not noise', () => {
    const r = solveShove(hu(12), 'equilibrium');
    for (let i = 0; i < 169; i++) {
      if (r.push[i] > 0.1 && r.push[i] < 0.9) expect(Math.abs(r.gain[i]), ALL_COMBOS[i]).toBeLessThan(0.05);
    }
    expect(r.push[at('AA')]).toBe(1);
    expect(r.push[at('72o')]).toBeLessThan(0.01);
  });
});

describe('against EXPLICIT calling ranges (never a QQ+/AK assumption)', () => {
  it('the caller’s range is the input, and a different range is a different answer', () => {
    // The table grader prices a deep shove against QQ+ and AK. Here that is just one explicit range among
    // many, and against it hero shoves far wider than against a 40% caller.
    const qqAk = only(['AA', 'KK', 'QQ', 'AKs', 'AKo']);
    const tight = solveShove(hu(12), [qqAk]);
    const loose = solveShove(hu(12), [topRange(0.4)]);
    expect(tight.pushShare).toBeGreaterThan(loose.pushShare + 0.2);
    expect(tight.callShares[0]).toBeCloseTo(rangeShare(qqAk), 9);
    const nash = solveShove(hu(12), 'equilibrium');
    expect(Math.abs(nash.callShares[0] - rangeShare(qqAk))).toBeGreaterThan(0.1);
  });

  it('needs one range per player behind', () => {
    const spot: ShoveSpot = { stacks: [20, 15, 10, 12], button: 1, hero: 1, ante: 0, payouts: [] };
    expect(() => solveShove(spot, [topRange(0.2)])).toThrow();
    expect(solveShove(spot, [topRange(0.2), topRange(0.2)]).callers).toEqual([2, 3]);
  });
});

describe('ICM push-fold on a bubble', () => {
  const bubble = (payouts: number[]): ShoveSpot => ({ stacks: [27, 13, 6, 14], button: 1, hero: 1, ante: 0.125, payouts });

  it('ICM makes the callers far tighter than chip EV does', () => {
    const icm = solveShove(bubble([0.5, 0.3, 0.2]), 'equilibrium', 1500);
    const chips = solveShove(bubble([]), 'equilibrium', 1500);
    // The big blind (14bb) risks busting before the 6bb stack: it calls far less under ICM.
    expect(icm.callShares[1]).toBeLessThan(chips.callShares[1] - 0.1);
    expect(icm.callShares[0]).toBeLessThan(chips.callShares[0]);
    // The gains are in different units: share of the pool against big blinds.
    expect(Math.abs(icm.gain[at('AA')])).toBeLessThan(1);
    expect(chips.gain[at('AA')]).toBeGreaterThan(1);
  });

  it('winner-take-all ICM is chip EV, scaled', () => {
    const wta = solveShove(bubble([1]), [topRange(0.15), topRange(0.1)]);
    const chips = solveShove(bubble([]), [topRange(0.15), topRange(0.1)]);
    const total = 27 + 13 + 6 + 14;
    for (const c of ['AA', 'K9o', '72o', 'T8s'] as const) expect(wta.gain[at(c)] * total).toBeCloseTo(chips.gain[at(c)], 9);
    expect(Array.from(wta.push)).toEqual(Array.from(chips.push));
  });
});

describe('spot shape', () => {
  it('heads-up the button posts the small blind; the big blind cannot be first in', () => {
    expect(shapeOf(hu(10))).toMatchObject({ sb: 0, bb: 1, callers: [1] });
    expect(() => shapeOf({ ...hu(10), hero: 1 })).toThrow();
    expect(() => shapeOf({ ...hu(10), stacks: [10, 0] })).toThrow();
    expect(() => shapeOf({ ...hu(10), stacks: [10, 1000] })).toThrow();
    expect(() => shapeOf({ ...hu(10), button: 2 })).toThrow();
  });

  it('a short blind posts what it has', () => {
    const s = shapeOf({ stacks: [10, 10, 0.8], button: 0, hero: 0, ante: 0.1, payouts: [] });
    expect(s.posted.map((x) => Math.round(x * 100) / 100)).toEqual([0.1, 0.6, 0.8]);
    expect(s.forced).toEqual([false, true]);
  });
});

describe('review round 1: players all in from the blinds, and side pots', () => {
  it('M2: a big blind all in from its post is a forced caller, whatever range is named', () => {
    // BTN 10, SB 10, BB 0.8 (all in from the blind). Against "top 10%" callers the BB still calls 100%.
    const spot: ShoveSpot = { stacks: [10, 10, 0.8], button: 0, hero: 0, ante: 0, payouts: [] };
    const fixed = solveShove(spot, [topRange(0.1), topRange(0.1)]);
    expect(fixed.callShares[1]).toBeCloseTo(1, 9);
    const forced = solveShove(spot, [topRange(0.1), topRange(1)]);
    expect(Array.from(fixed.gain)).toEqual(Array.from(forced.gain));
    expect(fixed.pushShare).toBeLessThan(0.6);
  });

  it('M2: a hero all in from the blinds has no decision, so the spot is refused', () => {
    expect(() => shapeOf({ stacks: [10, 0.3, 10], button: 2, hero: 0, ante: 0, payouts: [] })).not.toThrow();
    expect(() => shapeOf({ stacks: [0.4, 10, 10], button: 2, hero: 0, ante: 0, payouts: [] })).toThrow();
  });

  it('m2: a folder’s post above what the all-in can match goes back to the covering player, not to the winner', () => {
    // BTN (hero) 10, SB 10 posts 0.5 and folds, BB 0.3 is all in from its post (a forced caller).
    // Main pot to 0.3 from each of three: 0.9 to the winner. The SB's other 0.2 and hero's other 9.7 are
    // above anything the BB put in, so hero takes them win or lose: hero wins to 10.8, or loses to 9.9
    // (the old flat-dead-money sum gave the BB the SB's whole 0.5, leaving hero 9.7); folding is 10.
    const spot: ShoveSpot = { stacks: [10, 10, 0.3], button: 0, hero: 0, ante: 0, payouts: [] };
    const r = solveShove(spot, [new Float64Array(169), new Float64Array(169)]);
    const eq = handVsRange(classIndex('AA'), new Float64Array(169).fill(1)).equity!;
    expect(r.gain[classIndex('AA')]).toBeCloseTo(eq * 10.8 + (1 - eq) * 9.9 - 10, 9);
  });
});

describe('review round 2: spots the one-caller model cannot price are refused', () => {
  it('N1: a player all in from the blinds AHEAD of a live caller would make it three-way, so it is refused', () => {
    // BTN shoves, SB all in for 0.5, BB 10 deep: the BB's decision would be skipped by a one-caller model.
    expect(() => shapeOf({ stacks: [10, 0.5, 10], button: 0, hero: 0, ante: 0, payouts: [] })).toThrow();
    // The big blind all in from its post is the LAST to act, so it is still priced.
    expect(() => shapeOf({ stacks: [10, 10, 0.8], button: 0, hero: 0, ante: 0, payouts: [] })).not.toThrow();
  });

  it('N1/N2: the request parser refuses both, so the screen says the spot is out of range', () => {
    const req = (stacks: number[]) => ({ stacks, button: 0, hero: 0, ante: 0, payouts: [], callers: { kind: 'equilibrium' } });
    expect(parseShoveRequest(req([10, 0.5, 10]))).toBeNull();
    expect(parseShoveRequest({ ...req([10, 10, 10]), hero: 0, button: 2, stacks: [0.4, 10, 10] })).toBeNull();
    expect(parseShoveRequest(req([10, 10, 0.8]))).not.toBeNull();
  });
});
