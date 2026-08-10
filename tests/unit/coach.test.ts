import { describe, it, expect } from 'vitest';
import { DISPLAY_ITERATIONS, equityVsRandom } from '../../src/core/equity.js';
import { gradeDecision, potOddsRequired } from '../../src/core/coach.js';

describe('potOddsRequired', () => {
  it('potOddsRequired(30, 10) === 0.25', () => {
    expect(potOddsRequired(30, 10)).toBe(0.25);
  });

  it('potOddsRequired(0, 0) === 0', () => {
    expect(potOddsRequired(0, 0)).toBe(0);
  });

  it('potOddsRequired(100, 100) === 0.5', () => {
    expect(potOddsRequired(100, 100)).toBe(0.5);
  });
});

describe('gradeDecision', () => {
  it('silence rule: 0.2bb deviation returns free and message === null', () => {
    // AA preflop calling a small bet — equity far exceeds pot odds, no loss
    const g = gradeDecision({
      hole: ['As', 'Ah'],
      board: [],
      street: 'preflop',
      pot: 10,
      toCall: 2,
      stack: 100,
      bb: 2,
      chosen: 'call',
      opponents: 1,
      seed: 42,
    });
    expect(g.severity).toBe('free');
    expect(g.message).toBe(null);
  });

  it('correct call with ample equity returns free', () => {
    // AA on a low flop calling a small bet
    const g = gradeDecision({
      hole: ['Ah', 'Ad'],
      board: ['3c', '5d', '8h'],
      street: 'flop',
      pot: 20,
      toCall: 5,
      stack: 100,
      bb: 2,
      chosen: 'call',
      opponents: 1,
      seed: 1,
    });
    expect(g.severity).toBe('free');
    expect(g.message).toBe(null);
  });

  it('calling 40 into a 20 pot with ~10% equity returns serious with numbers', () => {
    // 72o on a board that doesn't help, facing huge bet
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
    expect(g.severity).toBe('serious');
    expect(g.message).not.toBe(null);
    // Message should contain numbers
    expect(g.message).toMatch(/\d+/);
  });

  it('folding with strong equity returns notable or serious', () => {
    // AA preflop folding to a small raise — clearly wrong
    const g = gradeDecision({
      hole: ['As', 'Ah'],
      board: [],
      street: 'preflop',
      pot: 10,
      toCall: 4,
      stack: 100,
      bb: 2,
      chosen: 'fold',
      opponents: 1,
      seed: 42,
    });
    expect(g.severity === 'notable' || g.severity === 'serious').toBe(true);
    expect(g.message).not.toBe(null);
    expect(g.principle).toBe('pot odds');
  });

  it('correct fold with weak equity returns free', () => {
    // 72o facing a huge bet on a scary board
    const g = gradeDecision({
      hole: ['7c', '2d'],
      board: ['As', 'Kh', 'Qd', 'Jc', '9s'],
      street: 'river',
      pot: 20,
      toCall: 40,
      stack: 100,
      bb: 2,
      chosen: 'fold',
      opponents: 1,
      seed: 5,
    });
    expect(g.severity).toBe('free');
    expect(g.message).toBe(null);
  });

  it('check on flop with marginal equity is free', () => {
    const g = gradeDecision({
      hole: ['9h', '8h'],
      board: ['2c', '5d', 'Ks'],
      street: 'flop',
      pot: 10,
      toCall: 0,
      stack: 100,
      bb: 2,
      chosen: 'check',
      opponents: 1,
      seed: 3,
    });
    expect(g.severity).toBe('free');
    expect(g.message).toBe(null);
  });

  it('principle is one of the allowed values when present', () => {
    const allowed = [
      'pot odds', 'ranges', 'position', 'indifference',
      'polarity', 'board coverage', 'blockers', 'value or bluff',
    ];
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
    if (g.principle !== null) {
      expect(allowed).toContain(g.principle);
    }
  });

  it('evLossBb is non-negative', () => {
    const g = gradeDecision({
      hole: ['Kh', 'Qh'],
      board: ['Th', '9h', '2c'],
      street: 'flop',
      pot: 30,
      toCall: 15,
      stack: 100,
      bb: 2,
      chosen: 'call',
      opponents: 2,
      seed: 1,
    });
    expect(g.evLossBb).toBeGreaterThanOrEqual(0);
  });

  it('raising with low equity facing a bet is penalized', () => {
    const g = gradeDecision({
      hole: ['3c', '2d'],
      board: ['As', 'Kh', 'Qd'],
      street: 'flop',
      pot: 30,
      toCall: 15,
      stack: 100,
      bb: 2,
      chosen: 'raise',
      betSize: 40,
      opponents: 1,
      seed: 1,
    });
    // Low equity raising into strength should be penalized
    expect(g.evLossBb).toBeGreaterThan(0);
  });

  it('severity tiers: evLossBb < 0.5 => free', () => {
    // We craft a situation where calling is slightly suboptimal but < 0.5 bb
    // Using a marginal hand where equity is just barely below pot odds
    const g = gradeDecision({
      hole: ['Th', '9h'],
      board: ['2c', '5s', 'Kd', '7h', 'Jc'],
      street: 'river',
      pot: 50,
      toCall: 5,
      stack: 100,
      bb: 10,
      chosen: 'call',
      opponents: 1,
      seed: 1,
    });
    // With pot=50, toCall=5, required = 5/55 ~= 9%. T9 on this board likely has >9%.
    // So this should be free.
    expect(g.severity).toBe('free');
  });

  it('Grade interface shape is correct', () => {
    const g = gradeDecision({
      hole: ['Ac', 'Kc'],
      board: [],
      street: 'preflop',
      pot: 3,
      toCall: 2,
      stack: 100,
      bb: 2,
      chosen: 'call',
      opponents: 1,
      seed: 1,
    });
    expect(g).toHaveProperty('severity');
    expect(g).toHaveProperty('evLossBb');
    expect(g).toHaveProperty('message');
    expect(g).toHaveProperty('principle');
  });
});

describe('display consistency', () => {
  /**
   * The coach line and the stats sheet both show the hero's equity, from two separate call sites.
   * Monte Carlo at different iteration counts returns different numbers for the same spot, so if
   * they ever diverge the app contradicts itself on screen — measured 70% on the sheet beside
   * "66% equity" in the coach line before both were pinned to DISPLAY_ITERATIONS.
   */
  it('the coach grades at exactly the iteration count the stats sheet displays', () => {
    const hole = ['Qs', 'Qh'];
    const board = ['8c', '9h', '8s', 'Js'];
    const seed = 43;

    // What the sheet renders, and the pot share the coach reasons about.
    const shown = equityVsRandom(hole, board, 3, DISPLAY_ITERATIONS, seed);
    const potShare = shown.win + shown.tie * 0.5;

    // What the coach graded against, recovered from its own message.
    const grade = gradeDecision({
      hole,
      board,
      street: 'turn',
      pot: 300,
      toCall: 100,
      stack: 4000,
      bb: 50,
      chosen: 'fold',
      opponents: 3,
      seed,
    });

    expect(grade.message).not.toBeNull();
    const quoted = Number(/(\d+)% pot share/.exec(grade.message ?? '')?.[1]);
    expect(Number.isFinite(quoted), `no pot share in "${grade.message}"`).toBe(true);
    // Same iteration count AND the same definition, so the two figures are reconcilable.
    expect(quoted).toBe(Math.round(potShare * 100));
    // And the coach must not call it "equity" — that is the sheet's Win% label.
    expect(grade.message).not.toMatch(/% equity/);
  });

  it('a different iteration count really would disagree, so the shared constant is load-bearing', () => {
    const a = equityVsRandom(['Qs', 'Qh'], ['8c', '9h', '8s', 'Js'], 3, 800, 43);
    const b = equityVsRandom(['Qs', 'Qh'], ['8c', '9h', '8s', 'Js'], 3, DISPLAY_ITERATIONS, 43);
    expect(Math.round(a.win * 100)).not.toBe(Math.round(b.win * 100));
  });
});

/**
 * FOLDING FOR FREE — the worst defect an adherence audit of this grader turned up.
 *
 * `fold` is in legalActions at every decision including toCall 0 (table.ts), so folding when
 * checking was free is a spot a real learner reaches. The grader returned 0 unconditionally there,
 * which made it rank FOLDING THE NUTS above CHECKING them: measured on a river with quad aces into
 * a 600 pot, folding graded 0.00bb 'free' while checking the same hand graded 2.70bb 'serious'. A
 * coach that tells a beginner to fold quads is worse than no coach.
 *
 * The charge is against a CHECK rather than against winning the pot outright, because checking does
 * not collect the pot — it sees a free card. Hence the realisation haircut, which also keeps the
 * most common correct beginner play (folding trash preflop) inside the silence threshold.
 */
describe('folding when checking was free', () => {
  const river = {
    street: 'river',
    toCall: 0,
    stack: 5000,
    bb: 50,
    opponents: 1,
    seed: 7,
  };

  it('never ranks folding the nuts above checking them', () => {
    const nuts = { hole: ['As', 'Ac'], board: ['Ah', 'Ad', 'Kc', '7s', '2d'], pot: 600 };
    const fold = gradeDecision({ ...river, ...nuts, chosen: 'fold' });
    const check = gradeDecision({ ...river, ...nuts, chosen: 'check' });
    const bet = gradeDecision({ ...river, ...nuts, chosen: 'bet', betSize: 300 });

    // The whole point: the ordering must be bet cheapest, fold dearest.
    expect(bet.evLossBb).toBeLessThan(check.evLossBb);
    expect(check.evLossBb).toBeLessThan(fold.evLossBb);
    expect(fold.severity).toBe('serious');
  });

  it('still says nothing about folding trash preflop, the commonest correct beginner play', () => {
    // A grader that nags here trains a learner out of the discipline it is supposed to install.
    const grade = gradeDecision({
      hole: ['7c', '2h'],
      board: [],
      street: 'preflop',
      pot: 75,
      toCall: 0,
      stack: 5000,
      bb: 50,
      chosen: 'fold',
      opponents: 1,
      seed: 7,
    });
    expect(grade.severity).toBe('free');
    expect(grade.message).toBeNull();
  });

  it('scales the charge with the pot, so surrendering a big pot costs more', () => {
    const hand = { hole: ['As', 'Ac'], board: ['Ah', 'Ad', 'Kc', '7s', '2d'] };
    const small = gradeDecision({ ...river, ...hand, pot: 100, chosen: 'fold' });
    const big = gradeDecision({ ...river, ...hand, pot: 1200, chosen: 'fold' });
    expect(big.evLossBb).toBeGreaterThan(small.evLossBb);
  });
});
