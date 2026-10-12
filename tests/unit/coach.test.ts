import { describe, it, expect } from 'vitest';
import { DISPLAY_ITERATIONS, equityVsRandom } from '../../src/core/equity.js';
import { gradeDecision, potOddsRequired } from '../../src/core/coach.js';
import { VILLAIN_BETTING_RANGE, villainBettingWidth } from '../../src/core/preflop.js';

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

  /**
   * The facing-a-bet raise threshold is the SIZE-DERIVED break-even equity, required =
   * toCall/(pot+toCall) = B/(P+2B), not a flat constant. state.pot already contains the villain's
   * bet (table.ts), so this is exactly the price of continuing. The old grader compared against a
   * flat 0.35 with a "free gap" up to 0.55, which mis-graded on both sides. These two spots use the
   * SAME hand and equity (7h6h on 5s4cKd, ~46%, seed 1) and differ ONLY in bet size, so no flat
   * constant can satisfy both — that is what makes the threshold's size-dependence load-bearing.
   */
  it('a raise facing a small bet is free when equity clears the (low) required price', () => {
    // Small bet: required = 20/120 ≈ 17%. 46% clears it comfortably → nothing owed to teach.
    const g = gradeDecision({
      hole: ['7h', '6h'],
      board: ['5s', '4c', 'Kd'],
      street: 'flop',
      pot: 100,
      toCall: 20,
      stack: 500,
      bb: 2,
      chosen: 'raise',
      betSize: 40,
      opponents: 1,
      seed: 1,
    });
    expect(g.severity).toBe('free');
    expect(g.evLossBb).toBe(0);
  });

  it('the SAME raise facing an overbet is penalized — the old flat 0.55 gap missed this', () => {
    // Overbet: required = 200/300 ≈ 67%. 46% falls far short, so committing more chips is a real
    // mistake. Under the old constants 46% sat in the 0.35–0.55 "free" gap and graded free.
    const g = gradeDecision({
      hole: ['7h', '6h'],
      board: ['5s', '4c', 'Kd'],
      street: 'flop',
      pot: 100,
      toCall: 200,
      stack: 500,
      bb: 2,
      chosen: 'raise',
      betSize: 400,
      opponents: 1,
      seed: 1,
    });
    expect(g.severity !== 'free').toBe(true);
    expect(g.evLossBb).toBeGreaterThan(0);
    expect(g.principle).toBe('ranges');
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

/**
 * GRADING VS THE VILLAIN'S RANGE, not vs random — CONSOLIDATED audit #1, the flagship teaching-correctness
 * fix. The coach used to score every bet-facing call/fold/raise on equity-vs-RANDOM (a 100% range), which
 * systematically OVERSTATES hero equity in exactly those spots: a villain who bet holds a range strictly
 * stronger than two random cards. The consequence the audit measured was the two worst teaching errors a
 * trainer can make — excusing loose calls ("call too wide", the commonest losing leak) and charging correct
 * folds as leaks. Passing `villainRange` moves the grade onto equity-vs-range. Each test grades the SAME
 * spot BOTH ways so the vs-random column is the oracle that shows the bug, and the vs-range column the fix.
 */
describe('grading against the villain range (CONSOLIDATED #1)', () => {
  it('the villain betting-range model is stronger than random but not nit-tight (~32%)', () => {
    // The whole fix rests on this range being STRONGER than random (< 100%, so it lowers hero equity in
    // the graded spots) yet not so narrow it merely flips the error and over-charges good calls. Pinned so
    // a careless edit toward random-wide or nit-narrow — either of which resurrects a teaching bug — fails.
    const width = villainBettingWidth();
    expect(width).toBeGreaterThan(0.27); // wider than a pure value range (cutoff RFI ≈ 27%)
    expect(width).toBeLessThan(0.44); //    tighter than a button open (≈ 44%); still far below random 100%
  });

  it('(a) a correct fold vs a strong betting range is no longer penalized', () => {
    // Pocket nines on A-K-7 facing a pot-sized bet. Vs two random cards 99 is ~66% and "ahead", so the old
    // grader CHARGED the fold as a pot-odds leak — teaching a learner that a correct laydown was a mistake.
    // Vs a real betting range (packed with aces and kings) 99 is behind the ~50% price, so folding is right.
    const spot = {
      hole: ['9c', '9d'],
      board: ['Ah', 'Kd', '7s'],
      street: 'flop',
      pot: 100,
      toCall: 100, // required = 100/200 = 50%
      stack: 500,
      bb: 2,
      chosen: 'fold' as const,
      opponents: 1,
      seed: 1,
    };

    // Oracle — the bug: graded vs random, the correct fold is charged as a serious pot-odds leak.
    const vsRandom = gradeDecision(spot);
    expect(vsRandom.severity).not.toBe('free');
    expect(vsRandom.principle).toBe('pot odds');
    expect(vsRandom.evLossBb).toBeGreaterThan(0.5);

    // The fix: graded vs the villain's range, the fold is free — no leak, no message.
    const vsRange = gradeDecision({ ...spot, villainRange: VILLAIN_BETTING_RANGE });
    expect(vsRange.severity).toBe('free');
    expect(vsRange.evLossBb).toBe(0);
    expect(vsRange.message).toBeNull();
  });

  it('(b) a loose call vs a range is now correctly flagged', () => {
    // Ace-high with a gutshot (A5 on K-Q-9) calling 60 into a 140 pot (required = 30%). Vs random A-high is
    // ~44% and clears the price, so the old grader said nothing — excusing a call that is crushed by every
    // value hand the villain bets. Vs the betting range A5 is ~21%, well short of 30%, so the call is a leak.
    const spot = {
      hole: ['Ac', '5d'],
      board: ['Kd', 'Qs', '9h'],
      street: 'flop',
      pot: 140,
      toCall: 60, // required = 60/200 = 30%
      stack: 500,
      bb: 2,
      chosen: 'call' as const,
      opponents: 1,
      seed: 1,
    };

    // Oracle — the bug: graded vs random, the loose call is waved through as free.
    const vsRandom = gradeDecision(spot);
    expect(vsRandom.severity).toBe('free');
    expect(vsRandom.evLossBb).toBe(0);

    // The fix: graded vs the villain's range, the call is charged a pot-odds leak with a real message.
    const vsRange = gradeDecision({ ...spot, villainRange: VILLAIN_BETTING_RANGE });
    expect(vsRange.severity).not.toBe('free');
    expect(vsRange.principle).toBe('pot odds');
    expect(vsRange.evLossBb).toBeGreaterThan(0.5);
    expect(vsRange.message).not.toBeNull();
  });

  it('leaves unpriced spots (toCall 0) on the random model — the range fix is scoped to facing a bet', () => {
    // No bet faced means no aggressor range; passing one must not change the grade. This keeps the fix from
    // leaking into the check/lead heuristics (audit #2), which are out of scope here.
    const spot = {
      hole: ['9h', '8h'],
      board: ['2c', '5d', 'Ks'],
      street: 'flop',
      pot: 10,
      toCall: 0,
      stack: 100,
      bb: 2,
      chosen: 'check' as const,
      opponents: 1,
      seed: 3,
    };
    const withRange = gradeDecision({ ...spot, villainRange: VILLAIN_BETTING_RANGE });
    const without = gradeDecision(spot);
    expect(withRange.evLossBb).toBe(without.evLossBb);
    expect(withRange.severity).toBe(without.severity);
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

describe('gradeDecision price (the coach sheet meter)', () => {
  const base = { board: ['Ks', '4d', '4c'], street: 'flop', stack: 4950, bb: 50, opponents: 1, seed: 7 } as const;

  it('a priced verdict carries the needed and had pot shares the message quotes', () => {
    // Folding a full house to a small bet: a serious, priced mistake.
    const g = gradeDecision({ ...base, hole: ['Kh', 'Kd'], board: [...base.board], pot: 225, toCall: 75, chosen: 'fold' });
    expect(g.severity).not.toBe('free');
    expect(g.price).toBeDefined();
    expect(g.price!.needed).toBeCloseTo(potOddsRequired(225, 75), 10);
    expect(g.price!.had).toBeGreaterThan(g.price!.needed);
    expect(g.message).toContain(`${Math.round(g.price!.needed * 100)}%`);
  });

  it('an unpriced spot or a silent grade has no price', () => {
    const free = gradeDecision({ ...base, hole: ['Kh', 'Kd'], board: [...base.board], pot: 225, toCall: 75, chosen: 'call' });
    expect(free.severity).toBe('free');
    expect(free.price).toBeUndefined();
    const unpriced = gradeDecision({ ...base, hole: ['Kh', 'Kd'], board: [...base.board], pot: 225, toCall: 0, chosen: 'fold' });
    expect(unpriced.price).toBeUndefined();
  });
});
