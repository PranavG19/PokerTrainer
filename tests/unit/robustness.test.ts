import { describe, it, expect } from 'vitest';
import {
  robustnessDrill,
  continuationWeights,
  CONTINUATIONS,
  CONTINUATION_LABELS,
  HEURISTIC_DISCLAIMER,
  type ContinuationId,
  type RobustnessInput,
} from '../../src/core/robustness.js';
import { DISPLAY_ITERATIONS, equityVsRandom } from '../../src/core/equity.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * A deliberately fragile line: 72o with nothing on a board that beats it every way, shoved a full
 * pot. Only an opponent who folds a lot can make it profitable, which is the leak shape O7 names.
 */
const FRAGILE: RobustnessInput = {
  hole: ['7c', '2d'],
  board: ['Ah', 'Kh', 'Qs', 'Js', '9d'],
  pot: 100,
  toCall: 0,
  line: 'bet',
  betSize: 100,
  bb: 10,
  seed: 3,
};

/**
 * A deliberately robust line: a made second-nut hand checked back on a dry river. It collects its
 * share whatever the opponent does, so nothing an opponent leans toward moves it much.
 */
const ROBUST: RobustnessInput = {
  hole: ['Kd', 'Qd'],
  board: ['Kh', '7s', '2c', '9d', '3h'],
  pot: 100,
  toCall: 0,
  line: 'check',
  bb: 10,
  seed: 3,
};

/**
 * A noise-free fixture for exact arithmetic: everyone plays the board on AAAAK, so every runout is a
 * chop and hero equity is exactly 0.5 regardless of seed or iteration count.
 */
const CHOP: RobustnessInput = {
  hole: ['2c', '3d'],
  board: ['Ah', 'Ad', 'As', 'Ac', 'Kd'],
  pot: 100,
  toCall: 0,
  line: 'bet',
  betSize: 400,
  bb: 10,
  seed: 3,
};

function evOf(report: ReturnType<typeof robustnessDrill>, id: ContinuationId): number {
  return report.outcomes.find((o) => o.id === id)!.evBb;
}

// ── The fragile / robust contrast, which is the whole drill ───────────────────

describe('fragile vs robust lines', () => {
  it('a line good against exactly one continuation gives a WIDE spread and reads as a leak', () => {
    const report = robustnessDrill(FRAGILE);

    expect(report.profitableAgainst).toBe(1);
    expect(report.best).toBe('foldBiased');
    expect(report.verdict).toBe('leak');
    // Wide in the units the verdict uses: more than half a pot between best and worst.
    expect(report.spreadPotFraction).toBeGreaterThan(0.6);
    expect(evOf(report, 'foldBiased')).toBeGreaterThan(0);
    for (const id of ['equilibrium', 'callBiased', 'raiseBiased'] as ContinuationId[]) {
      expect(evOf(report, id)).toBeLessThan(0);
    }
  });

  it('a line fine against all four gives a TIGHT spread and reads as robust', () => {
    const report = robustnessDrill(ROBUST);

    expect(report.profitableAgainst).toBe(4);
    expect(report.verdict).toBe('robust');
    expect(report.spreadPotFraction).toBeLessThan(0.3);
    for (const id of CONTINUATIONS) expect(evOf(report, id)).toBeGreaterThan(0);
  });

  it('the fragile line spreads several times wider than the robust one in the same pot', () => {
    const fragile = robustnessDrill(FRAGILE);
    const robust = robustnessDrill(ROBUST);

    expect(FRAGILE.pot).toBe(ROBUST.pot); // same pot, so bb spreads are directly comparable
    expect(fragile.spreadBb).toBeGreaterThan(3 * robust.spreadBb);
  });

  it('G3 silence: the robust line gets no message, and silence is not praise', () => {
    expect(robustnessDrill(ROBUST).message).toBeNull();
    const leak = robustnessDrill(FRAGILE).message;
    expect(leak).toContain('fold-biased');
    expect(leak).toContain('raise-biased');
  });
});

// ── Spread arithmetic against hand-computed values ────────────────────────────

describe('spread arithmetic', () => {
  it('spreadBb is max minus min over the four outcomes', () => {
    const report = robustnessDrill(FRAGILE);
    const evs = report.outcomes.map((o) => o.evBb);
    const expected = Math.max(...evs) - Math.min(...evs);

    expect(report.spreadBb).toBeCloseTo(expected, 12);
    expect(report.spreadBb).toBeCloseTo(evOf(report, 'foldBiased') - evOf(report, 'raiseBiased'), 12);
    // Hand-computed from the four EVs this spot returns: 3.4169 - (-4.5319).
    expect(report.spreadBb).toBeCloseTo(7.9488, 3);
  });

  it('spreadPotFraction is spreadBb divided by the pot in bb', () => {
    const report = robustnessDrill(FRAGILE);
    expect(report.spreadPotFraction).toBeCloseTo(report.spreadBb / (FRAGILE.pot / FRAGILE.bb), 12);
    expect(report.spreadPotFraction).toBeCloseTo(0.79488, 4);
  });

  it('best and worst name the argmax and argmin continuations', () => {
    const report = robustnessDrill(FRAGILE);
    const byEv = [...report.outcomes].sort((a, b) => b.evBb - a.evBb);

    expect(report.best).toBe(byEv[0].id);
    expect(report.worst).toBe(byEv[byEv.length - 1].id);
    expect(evOf(report, report.best) - evOf(report, report.worst)).toBeCloseTo(report.spreadBb, 12);
  });

  it('the aggressive EV matches the response mixture recomputed by hand', () => {
    const report = robustnessDrill(FRAGILE);
    const eq = equityVsRandom(FRAGILE.hole, FRAGILE.board, 1, DISPLAY_ITERATIONS, FRAGILE.seed);
    const equity = eq.win + eq.tie * 0.5;

    for (const outcome of report.outcomes) {
      const w = outcome.weights;
      const contested = equity * (0.5 + 0.5 * (w.call + w.raise));
      const potIfCalled = FRAGILE.pot + 2 * FRAGILE.betSize!;

      // fold and call branches are size-independent, so they pin the mixture exactly; the raise
      // branch is bounded below by losing only the hero's own bet.
      const foldBranch = FRAGILE.pot;
      const callBranch = contested * potIfCalled - FRAGILE.betSize!;
      const raiseBranchFloor = -FRAGILE.betSize!;
      const lowerBound = (w.fold * foldBranch + w.call * callBranch + w.raise * raiseBranchFloor) / FRAGILE.bb;
      const upperBound = (w.fold * foldBranch + w.call * callBranch + w.raise * callBranch) / FRAGILE.bb;

      expect(outcome.evBb).toBeGreaterThanOrEqual(lowerBound - 1e-9);
      expect(outcome.evBb).toBeLessThanOrEqual(upperBound + 1e-9);
    }

    // A spot with no Monte Carlo noise at all pins the whole formula exactly. Everyone plays the
    // board AAAAK, so every runout is a chop and equity is exactly 0.5 by enumeration-free argument.
    const chopEq = equityVsRandom(CHOP.hole, CHOP.board, 1, DISPLAY_ITERATIONS, CHOP.seed);
    expect(chopEq.win).toBe(0);
    expect(chopEq.tie).toBe(1);

    // On CHOP the fold and call branches are exact rational numbers, and the raise branch is pinned
    // between never-worse-than-losing-the-bet and no-better-than-the-call branch (a raise the hero
    // continues against is strictly worse than the same equity for fewer chips). Bracketing the one
    // branch whose size the module chooses keeps this check independent instead of restating it.
    const chop = robustnessDrill(CHOP);
    const potIfCalled = CHOP.pot + 2 * CHOP.betSize! - CHOP.toCall;
    for (const outcome of chop.outcomes) {
      const w = outcome.weights;
      const contested = 0.5 * (0.5 + 0.5 * (w.call + w.raise));
      const callBranch = contested * potIfCalled - CHOP.betSize!;
      const fixedPart = w.fold * CHOP.pot + w.call * callBranch;

      expect(outcome.evBb).toBeGreaterThanOrEqual((fixedPart + w.raise * -CHOP.betSize!) / CHOP.bb - 1e-9);
      expect(outcome.evBb).toBeLessThanOrEqual((fixedPart + w.raise * callBranch) / CHOP.bb + 1e-9);
    }

    // Exact, sizing-free anchor: the hero's own chips are returned when the villain folds, so no
    // continuation can win more than the pot as it stood, and none can lose more than it staked.
    for (const outcome of chop.outcomes) {
      expect(outcome.evBb).toBeLessThanOrEqual(CHOP.pot / CHOP.bb);
      expect(outcome.evBb).toBeGreaterThanOrEqual(-CHOP.betSize! / CHOP.bb);
    }
  });

  it('returns four outcomes in a stable order with matching labels', () => {
    const report = robustnessDrill(ROBUST);
    expect(report.outcomes.map((o) => o.id)).toEqual(CONTINUATIONS);
    for (const outcome of report.outcomes) {
      expect(outcome.label).toBe(CONTINUATION_LABELS[outcome.id]);
    }
  });
});

// ── The four continuations must actually differ ───────────────────────────────

describe('the four continuations are genuinely different re-weightings', () => {
  it('every pair differs in its response weights', () => {
    const weights = CONTINUATIONS.map((id) => continuationWeights(id));

    for (let i = 0; i < weights.length; i++) {
      for (let j = i + 1; j < weights.length; j++) {
        const gap =
          Math.abs(weights[i].fold - weights[j].fold) +
          Math.abs(weights[i].call - weights[j].call) +
          Math.abs(weights[i].raise - weights[j].raise);
        // Four re-weightings that collapsed together would make the drill vacuous while every
        // other assertion in this file still passed.
        expect(gap).toBeGreaterThan(0.1);
      }
    }
  });

  it('each bias leans the way its name claims, relative to equilibrium', () => {
    const eq = continuationWeights('equilibrium');

    expect(continuationWeights('foldBiased').fold).toBeGreaterThan(eq.fold);
    expect(continuationWeights('callBiased').call).toBeGreaterThan(eq.call);
    expect(continuationWeights('raiseBiased').raise).toBeGreaterThan(eq.raise);
    // ...and each is the extreme of its own dimension across all four.
    const folds = CONTINUATIONS.map((id) => continuationWeights(id).fold);
    const calls = CONTINUATIONS.map((id) => continuationWeights(id).call);
    const raises = CONTINUATIONS.map((id) => continuationWeights(id).raise);
    expect(continuationWeights('foldBiased').fold).toBe(Math.max(...folds));
    expect(continuationWeights('callBiased').call).toBe(Math.max(...calls));
    expect(continuationWeights('raiseBiased').raise).toBe(Math.max(...raises));
  });

  it('response weights are a distribution: three non-negative parts summing to 1', () => {
    for (const id of CONTINUATIONS) {
      const w = continuationWeights(id);
      expect(w.fold).toBeGreaterThanOrEqual(0);
      expect(w.call).toBeGreaterThanOrEqual(0);
      expect(w.raise).toBeGreaterThanOrEqual(0);
      expect(w.stab).toBeGreaterThanOrEqual(0);
      expect(w.stab).toBeLessThanOrEqual(1);
      expect(w.fold + w.call + w.raise).toBeCloseTo(1, 9);
    }
  });

  it('the four give four distinct EVs on a spot where the response matters', () => {
    const evs = robustnessDrill(FRAGILE).outcomes.map((o) => o.evBb);
    expect(new Set(evs.map((e) => e.toFixed(4))).size).toBe(4);
  });
});

// ── Determinism ──────────────────────────────────────────────────────────────

describe('determinism', () => {
  it('is byte-identical across repeated runs at a fixed seed', () => {
    const runs = Array.from({ length: 5 }, () => robustnessDrill(FRAGILE));
    for (const run of runs) {
      expect(JSON.stringify(run)).toBe(JSON.stringify(runs[0]));
    }
  });

  it('holds for every line type at a fixed seed', () => {
    const lines: RobustnessInput[] = [
      { ...FRAGILE, line: 'bet', betSize: 60 },
      { ...FRAGILE, line: 'raise', toCall: 40, betSize: 140 },
      { ...FRAGILE, line: 'allin', betSize: 400 },
      { ...FRAGILE, line: 'call', toCall: 40, betSize: undefined },
      { ...FRAGILE, line: 'check', betSize: undefined },
      { ...FRAGILE, line: 'fold', toCall: 40, betSize: undefined },
    ];
    for (const input of lines) {
      expect(robustnessDrill(input)).toEqual(robustnessDrill(input));
    }
  });

  it('the seed actually feeds the estimate, so different seeds may differ', () => {
    const spreads = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => robustnessDrill({ ...FRAGILE, seed }).spreadBb);
    // Not all identical — otherwise the seed parameter is decorative.
    expect(new Set(spreads.map((s) => s.toFixed(6))).size).toBeGreaterThan(1);
    // ...but Monte Carlo noise must not swamp the verdict: every seed still calls this spot a leak.
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(robustnessDrill({ ...FRAGILE, seed }).verdict).toBe('leak');
    }
  });
});

// ── Degenerate and boundary cases ────────────────────────────────────────────

describe('degenerate cases', () => {
  it('a fold has no continuation to be exploited by: flat outcomes, no verdict of robust', () => {
    const report = robustnessDrill({ ...FRAGILE, line: 'fold', toCall: 40, betSize: undefined });

    expect(report.verdict).toBe('no-continuation');
    expect(report.spreadBb).toBe(0);
    expect(report.message).toBeNull(); // flat is not an achievement
    for (const outcome of report.outcomes) expect(outcome.evBb).toBe(0);
  });

  it('folding the nuts is still no-continuation, never praised as robust', () => {
    const report = robustnessDrill({
      hole: ['Ah', 'Ad'],
      board: ['As', 'Ac', '2d', '3h', '4s'],
      pot: 100,
      toCall: 20,
      line: 'fold',
      bb: 10,
      seed: 3,
    });
    expect(report.verdict).toBe('no-continuation');
    expect(report.message).toBeNull();
  });

  it('a zero pot yields a zero spread fraction rather than a division by zero', () => {
    const report = robustnessDrill({ hole: ['Kd', 'Qd'], board: [], pot: 0, toCall: 0, line: 'check', bb: 10, seed: 4 });
    expect(Number.isFinite(report.spreadPotFraction)).toBe(true);
    expect(report.spreadPotFraction).toBe(0);
    expect(report.spreadBb).toBe(0);
  });

  it('zero hero equity never reports a positive spread fraction or a nonsense EV', () => {
    const report = robustnessDrill({
      hole: ['2c', '3d'],
      board: ['Ah', 'Ad', 'As', 'Ac', 'Kd'],
      pot: 100,
      toCall: 100,
      line: 'call',
      bb: 10,
      seed: 4,
    });
    expect(report.profitableAgainst).toBe(0);
    for (const outcome of report.outcomes) {
      // Cannot lose more than the chips put in.
      expect(outcome.evBb).toBeGreaterThanOrEqual(-100 / 10 - 1e-9);
      expect(outcome.evBb).toBeLessThanOrEqual(0);
    }
  });

  it('refuses an aggressive line with no size instead of modelling a zero-chip bet', () => {
    expect(() => robustnessDrill({ ...FRAGILE, betSize: undefined })).toThrow(/betSize/);
    expect(() => robustnessDrill({ ...FRAGILE, betSize: 0 })).toThrow(/betSize/);
    expect(() => robustnessDrill({ ...FRAGILE, line: 'allin', betSize: undefined })).toThrow(/betSize/);
    expect(() => robustnessDrill({ ...FRAGILE, bb: 0 })).toThrow(/bb/);
  });

  it('upside variance is not fragility: betting the nuts is robust and silent despite a wide spread', () => {
    const report = robustnessDrill({
      hole: ['Ah', 'Ad'],
      board: ['As', 'Ac', '2d', '3h', '4s'],
      pot: 100,
      toCall: 0,
      line: 'bet',
      betSize: 60,
      bb: 10,
      seed: 3,
    });
    expect(report.profitableAgainst).toBe(4);
    expect(report.spreadPotFraction).toBeGreaterThan(0.3); // wide by magnitude alone
    expect(report.verdict).toBe('robust');
    expect(report.message).toBeNull();
  });

  it('spread scales with bb: the same spot at bb 20 halves the bb spread and keeps the fraction', () => {
    const atTen = robustnessDrill(FRAGILE);
    const atTwenty = robustnessDrill({ ...FRAGILE, bb: 20 });

    expect(atTwenty.spreadBb).toBeCloseTo(atTen.spreadBb / 2, 9);
    expect(atTwenty.spreadPotFraction).toBeCloseTo(atTen.spreadPotFraction, 9);
    expect(atTwenty.verdict).toBe(atTen.verdict);
  });
});

// ── Heuristic, never a bound ──────────────────────────────────────────────────

describe('heuristic framing', () => {
  it('no output field or copy claims an exploitability bound', () => {
    const report = robustnessDrill(FRAGILE);
    const text = JSON.stringify(report).toLowerCase();

    for (const forbidden of ['exploitab', 'bound', 'guarantee', 'worstcase', 'maxloss', 'optimal', 'gto', 'solve']) {
      expect(text).not.toContain(forbidden);
    }
    expect(Object.keys(report)).not.toContain('exploitability');
    // `worst` is allowed and `worstCase` is not: one names which continuation fared worst, the other
    // asserts a floor on how bad things can get, which is the false claim O7 warns against.
    expect(report.worst).toBe('raiseBiased');
  });

  it('carries no streak, XP, rank or percentile', () => {
    const keys = Object.keys(robustnessDrill(FRAGILE));
    for (const banned of ['streak', 'xp', 'rank', 'percentile', 'score']) {
      expect(keys.map((k) => k.toLowerCase())).not.toContain(banned);
    }
  });

  it('the disclaimer says heuristic, not proof', () => {
    expect(HEURISTIC_DISCLAIMER).toMatch(/not a solve/i);
  });
});
