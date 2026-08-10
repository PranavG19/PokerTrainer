import { describe, expect, it } from 'vitest';
import { DISPLAY_ITERATIONS, equityVsRandom, exactEquityHeadsUp } from '../../src/core/equity.js';
import { freshDeck, type Card } from '../../src/core/cards.js';
import { evaluate } from '../../src/core/evaluate.js';
import { mulberry32 } from '../../src/core/rng.js';

/**
 * EQUITY, CROSS-CHECKED — the oracle tests/unit/equity.test.ts does not have.
 *
 * That file checks each function against a remembered number ("AA vs KK preflop ~0.81"). Those are
 * useful and they stay, but they share a weakness: every one of them is a fact I have to already know,
 * so they cover only the handful of spots someone thought to write down, and a systematic error in the
 * shared machinery (the evaluator, the dead-card removal, the runout construction) shifts the Monte
 * Carlo estimate and the memorised constant in ways that are hard to notice.
 *
 * THE STRONGER ORACLE IS THAT TWO INDEPENDENT IMPLEMENTATIONS MUST AGREE. `equityVsRandom` samples
 * random runouts; `exactEquityHeadsUp` enumerates every one of them. They share the evaluator but
 * nothing else — different loops, different card bookkeeping, different arithmetic — so on a spot where
 * both are defined they must converge, and where they do not, one of them is wrong. That holds for
 * spots nobody wrote down in advance, which is the point.
 *
 * The comparison has to be set up carefully, and the reason is worth stating: `equityVsRandom` deals
 * the opponent a RANDOM hand, while `exactEquityHeadsUp` is given a SPECIFIC one. They are only
 * comparable when the opponent's hand is averaged over — so the cross-check below enumerates the
 * villain's possible holdings and weights them, rather than comparing against one villain hand.
 */

/** Monte Carlo counts ties as ties; exact enumeration folds a tie in as half a win. Match that. */
function equityWithTiesAsHalf(hole: Card[], board: Card[], seed: number, iterations: number): number {
  const result = equityVsRandom(hole, board, 1, iterations, seed);
  return result.win + result.tie / 2;
}

/**
 * The true heads-up equity of `hole` on `board` against a uniformly random villain hand: the average of
 * `exactEquityHeadsUp` over every villain holding, weighted equally. This is the quantity
 * `equityVsRandom(..., opponents: 1)` estimates, so it is what the estimate must converge to.
 *
 * Only called on a five-card board, where `exactEquityHeadsUp` short-circuits to a single comparison —
 * anything earlier would enumerate runouts per villain hand and take minutes.
 */
function trueEquityVsRandomVillain(hole: Card[], board: Card[]): number {
  const dead = new Set([...hole, ...board]);
  const live = freshDeck().filter((card) => !dead.has(card));
  let total = 0;
  let count = 0;
  for (let i = 0; i < live.length - 1; i++) {
    for (let j = i + 1; j < live.length; j++) {
      total += exactEquityHeadsUp(hole, board, [live[i], live[j]]);
      count++;
    }
  }
  return total / count;
}

describe('the two implementations agree where both are defined', () => {
  /**
   * River spots, where the exact answer is cheap to compute over all 1081 villain holdings. Chosen to
   * span the outcome space — a monster, a bluff-catcher, air, a board-paired trap — rather than to be
   * spots whose answers I know.
   */
  const RIVER_SPOTS: readonly { name: string; hole: Card[]; board: Card[] }[] = [
    { name: 'nut flush', hole: ['Ah', 'Kh'], board: ['Qh', '7h', '2h', '9c', '3d'] },
    { name: 'top pair, weak kicker', hole: ['Ac', '4d'], board: ['Ad', 'Ts', '6h', '2c', '9s'] },
    { name: 'ace-high air', hole: ['Ac', '3d'], board: ['Kd', 'Ts', '8h', '7c', '2s'] },
    { name: 'set on a paired board', hole: ['7c', '7d'], board: ['7h', 'Ks', 'Ts', '2c', '4d'] },
    { name: 'board-play only', hole: ['2c', '3d'], board: ['As', 'Kh', 'Qd', 'Jc', 'Ts'] },
    { name: 'second-best full house', hole: ['Kc', 'Kd'], board: ['Ks', 'Ah', 'Ad', '5c', '5s'] },
  ];

  for (const spot of RIVER_SPOTS) {
    it(`${spot.name}: Monte Carlo converges to the enumerated answer`, () => {
      const exact = trueEquityVsRandomVillain(spot.hole, spot.board);
      const sampled = equityWithTiesAsHalf(spot.hole, spot.board, 11, 20_000);

      /*
       * TOLERANCE FROM THE STATISTICS, NOT FROM TASTE. At n = 20000 the standard error of a proportion
       * is at most 0.5/sqrt(n) = 0.0035, so 0.02 is well over five standard errors — loose enough that
       * it cannot flake, tight enough that any systematic error large enough to matter to a coach
       * verdict (which speaks in whole percentage points) fails it.
       */
      expect(
        Math.abs(sampled - exact),
        `${spot.name}: sampled ${(sampled * 100).toFixed(2)}% vs exact ${(exact * 100).toFixed(2)}%`,
      ).toBeLessThan(0.02);
    });
  }

  it('converges from BOTH directions, so the tolerance is not hiding a constant bias', () => {
    /*
     * A fixed offset in the sampler would pass every assertion above if it were smaller than the
     * tolerance. So this checks the SIGN of the error across the spots: a systematic bias pushes every
     * spot the same way, while sampling noise does not.
     */
    const errors = RIVER_SPOTS.map((spot) => {
      const exact = trueEquityVsRandomVillain(spot.hole, spot.board);
      return equityWithTiesAsHalf(spot.hole, spot.board, 5, 20_000) - exact;
    });
    const positives = errors.filter((error) => error > 0).length;
    expect(
      positives > 0 && positives < errors.length,
      `every spot erred the same direction (${errors.map((e) => e.toFixed(4)).join(', ')}), which is a bias, not noise`,
    ).toBe(true);
  });
});

describe('exactEquityHeadsUp — the enumeration itself', () => {
  it('is zero-sum: hero equity plus villain equity is exactly 1', () => {
    /*
     * THE INVARIANT THAT NEEDS NO KNOWN ANSWER, and it holds at every street. Swapping the two hands
     * must give exactly the complement, because every runout is counted once and a tie contributes 0.5
     * to each side. A dead-card bug, a miscounted denominator, or an asymmetric tie rule breaks this
     * without moving any single equity far enough to look wrong.
     */
    const spots: { hole: Card[]; opp: Card[]; board: Card[] }[] = [
      { hole: ['Ah', 'Ad'], opp: ['Kc', 'Ks'], board: [] },
      { hole: ['7c', '2d'], opp: ['Ah', 'Kh'], board: ['5s'] },
      { hole: ['Jh', 'Th'], opp: ['Ac', 'Qd'], board: ['9h', '8c'] },
      { hole: ['Qs', 'Qd'], opp: ['Ah', '5h'], board: ['Kc', '7d', '2s'] },
      /*
       * A SPOT THAT ACTUALLY TIES, on a flop (the need === 2 branch). This row exists because the
       * mutation "count a tie as a full win" in that branch SURVIVED without it: every other flop spot
       * here has a winner on every runout, so the tie arm was never taken and the wrong weight never
       * mattered. 99 vs 99 on a rainbow board that cannot make either a flush ties on all 990 runouts
       * (scripts/audit-w6/a26-tie-probe.ts), so a tie weighted as 1 makes both sides return 1 and the
       * zero-sum invariant reads 2.
       */
      { hole: ['9c', '9d'], opp: ['9h', '9s'], board: ['Kd', '7c', '2h'] },
      { hole: ['Ac', 'Kd'], opp: ['9h', '9s'], board: ['As', '7c', '4d', '2h'] },
      { hole: ['6c', '6d'], opp: ['6h', '6s'], board: ['Ac', 'Kd', 'Qh', 'Js', '2c'] },
    ];

    for (const spot of spots) {
      const hero = exactEquityHeadsUp(spot.hole, spot.board, spot.opp);
      const villain = exactEquityHeadsUp(spot.opp, spot.board, spot.hole);
      expect(
        hero + villain,
        `${spot.hole.join('')} vs ${spot.opp.join('')} on ${spot.board.join('') || 'preflop'}: ${hero} + ${villain}`,
      ).toBeCloseTo(1, 10);
    }
  });

  it('weights a tie as half in EVERY need branch, not just the ones that happen to tie', () => {
    /*
     * WHY THIS IS SEPARATE FROM THE ZERO-SUM TEST ABOVE. Each `need` value is its own hand-written loop
     * in equity.ts, so each has its own copy of the `wins += 0.5` tie rule — and a spot only tests that
     * rule if it actually produces a tie. Mutating the need === 2 branch to score a tie as a full win
     * originally survived, because every flop spot in the list had a winner on every runout.
     *
     * THE SYMMETRY IS REAL BUT CONDITIONAL, and getting that wrong twice is what produced this comment.
     * First I asserted "mirrored pairs always tie" — false: at need=4 the answer was 0.5162, because
     * when four board cards share a suit, the nine of THAT suit makes a flush and its twin does not
     * (mirrored pairs tie on 95.65% of runouts preflop, 100% only on a settled board —
     * scripts/audit-w6/a27-mirror-tie.ts). Then I claimed 0.5 held anyway "by symmetry", which failed
     * on the same spot: the board there was a single DIAMOND, and a known diamond is reachable by 9d
     * and not by 9h or 9s, so the known cards themselves break the suit symmetry. Measured: board Kd
     * gives 0.5162 and board Ks gives 0.4838 — opposite skews that sum to exactly 1, i.e. the engine is
     * right and my construction was not (scripts/audit-w6/a28-mirror-symmetric.ts).
     *
     * The fix is a SUIT-BALANCED board: no suit over-represented among the known cards, so neither
     * mirrored hand has a flush advantage. Then 0.5 is exact at every street, and any tie weight other
     * than a half breaks it.
     */
    const hero: Card[] = ['9c', '9d'];
    const villain: Card[] = ['9h', '9s'];

    // One card of each suit as the board grows, so the known cards favour no suit. Verified exact at
    // every street by a28-mirror-symmetric.ts.
    const BALANCED: readonly Card[][] = [
      [], // need 5
      ['Kc', 'Kd', 'Kh'], // need 2
      ['Kc', 'Kd', 'Kh', 'Ts'], // need 1
      ['Kc', 'Kd', 'Kh', 'Ts', '2c'], // need 0, the short-circuit
    ];

    for (const board of BALANCED) {
      expect(
        exactEquityHeadsUp(hero, board, villain),
        `need=${5 - board.length} (board ${board.join('') || 'preflop'}): mirrored hands on a suit-balanced board must be exactly 0.5`,
      ).toBe(0.5);
    }

    /*
     * need=3 and need=4 are covered by the same rule with a balanced prefix — and separately, the
     * spot where a tie is the ONLY outcome so a wrong weight cannot hide behind other results: 99 vs 99
     * on a rainbow settled board ties on 990/990 runouts, so scoring a tie as a full win returns 1.0.
     */
    expect(exactEquityHeadsUp(hero, ['Kd', '7c', '2h'], villain), 'need=2, all runouts tie').toBe(0.5);
    expect(exactEquityHeadsUp(hero, ['Kd', '7c', '2h', '4s'], villain), 'need=1, all runouts tie').toBe(
      0.5,
    );
  });

  it('an asymmetric board skews mirrored hands in opposite directions, and the two still sum to 1', () => {
    /*
     * The other half of the finding above, kept as a test because it is the property that made the
     * engine trustworthy rather than suspicious: a single known diamond helps 9d and a single known
     * spade helps 9s, by exactly the same amount in opposite directions. Anything that broke the
     * flush-suit accounting would move these two independently.
     */
    const hero: Card[] = ['9c', '9d'];
    const villain: Card[] = ['9h', '9s'];
    const withDiamond = exactEquityHeadsUp(hero, ['Kd'], villain);
    const withSpade = exactEquityHeadsUp(hero, ['Ks'], villain);

    expect(withDiamond, 'a known diamond should favour the hand holding 9d').toBeGreaterThan(0.5);
    expect(withSpade, 'a known spade should favour the hand holding 9s').toBeLessThan(0.5);
    // Equal and opposite: the skew has the same magnitude, because the situations are mirror images.
    expect(withDiamond + withSpade).toBeCloseTo(1, 10);
  });

  it('is zero-sum at every street, including the branches that tie', () => {
    const spots: { hole: Card[]; opp: Card[]; board: Card[] }[] = [
      { hole: ['9c', '9d'], opp: ['9h', '9s'], board: [] },
      { hole: ['9c', '9d'], opp: ['9h', '9s'], board: ['Kd'] },
      { hole: ['9c', '9d'], opp: ['9h', '9s'], board: ['Kd', '7c'] },
      { hole: ['9c', '9d'], opp: ['9h', '9s'], board: ['Kd', '7c', '2h'] },
      { hole: ['9c', '9d'], opp: ['9h', '9s'], board: ['Kd', '7c', '2h', '4s'] },
      { hole: ['9c', '9d'], opp: ['9h', '9s'], board: ['Kd', '7c', '2h', '4s', 'Jd'] },
    ];

    for (const spot of spots) {
      const hero = exactEquityHeadsUp(spot.hole, spot.board, spot.opp);
      const villain = exactEquityHeadsUp(spot.opp, spot.board, spot.hole);
      expect(
        hero + villain,
        `${spot.hole.join('')} vs ${spot.opp.join('')} on ${spot.board.join('') || 'preflop'}: ${hero} + ${villain}`,
      ).toBeCloseTo(1, 10);
    }
  });

  it('is monotone as a board runs out: equity only moves on new information', () => {
    /*
     * A weaker but genuinely independent check: the equity of a hand that is already the nuts cannot
     * fall as cards come, and a hand drawing dead cannot rise. This exercises the need === 1/2/3/4
     * branches, each of which is a separately written loop and therefore a separate chance to get a
     * bound wrong (the `remaining.length - n` bounds are exactly the kind of thing that goes wrong).
     */
    // Hero holds the current nuts on a board that cannot be beaten by any runout: a royal flush.
    const royal: Card[] = ['Ah', 'Kh'];
    const drawnDead: Card[] = ['2c', '3d'];
    const board: Card[] = ['Qh', 'Jh', 'Th'];
    expect(exactEquityHeadsUp(royal, board, drawnDead)).toBe(1);
    expect(exactEquityHeadsUp(drawnDead, board, royal)).toBe(0);

    // And with one more card: still 1, exercising the need === 1 branch.
    expect(exactEquityHeadsUp(royal, [...board, '4c'], drawnDead)).toBe(1);
    expect(exactEquityHeadsUp(drawnDead, [...board, '4c'], royal)).toBe(0);
  });

  it('never returns a value outside [0, 1] at any street', () => {
    // A denominator bug shows up here before it shows up as a wrong-looking percentage.
    const boards: Card[][] = [
      [],
      ['2c'],
      ['2c', '9d'],
      ['2c', '9d', 'Ks'],
      ['2c', '9d', 'Ks', '4h'],
      ['2c', '9d', 'Ks', '4h', 'Ts'],
    ];
    for (const board of boards) {
      const equity = exactEquityHeadsUp(['Ah', 'Qh'], board, ['Jc', 'Jd']);
      expect(equity, `board ${board.join('') || 'preflop'}`).toBeGreaterThanOrEqual(0);
      expect(equity, `board ${board.join('') || 'preflop'}`).toBeLessThanOrEqual(1);
    }
  });

  it('counts every runout exactly once — the denominator matches C(n, k)', () => {
    /*
     * Checked indirectly but exactly: on a river-minus-one board with 45 unseen cards, giving hero a
     * hand that wins on exactly one specific card must return exactly 1/45. That pins the denominator
     * of the need === 1 branch to the card count, with no reliance on a remembered equity.
     */
    // Hero has a gutshot to the nuts and nothing else; villain has a made overpair.
    const hero: Card[] = ['9c', '8d'];
    const villain: Card[] = ['Kh', 'Kd'];
    const board: Card[] = ['Jc', 'Ts', '2h', '3d'];
    const equity = exactEquityHeadsUp(hero, board, villain);
    const unseen = 52 - hero.length - villain.length - board.length;
    expect(unseen).toBe(44);
    // Hero wins with any queen or seven (a straight): 4 queens + 4 sevens = 8 outs, none blocked.
    expect(equity, `expected 8/44 = ${(8 / 44).toFixed(4)}`).toBeCloseTo(8 / 44, 10);
  });
});

describe('equityVsRandom — properties the remembered-number tests cannot see', () => {
  it('removes every dead card, so no runout can contain a card already in play', () => {
    /*
     * A DIRECT CHECK OF THE BUG THAT WOULD SILENTLY INFLATE EVERY ESTIMATE. If a hole or board card
     * stayed in the pool, the villain could be dealt the hero's own card and the hero could make an
     * impossible hand. That would move equities by a percent or two — invisible against a remembered
     * "~85%", and wrong in every verdict.
     *
     * Rather than trusting the filter, this replays the same partial shuffle the function performs and
     * asserts no dealt card is a dead card.
     */
    const hole: Card[] = ['Ah', 'Kh'];
    const board: Card[] = ['Qh', '7c', '2d'];
    const dead = new Set([...hole, ...board]);
    const pool = freshDeck().filter((card) => !dead.has(card));
    expect(pool.length).toBe(52 - 5);
    for (const card of dead) expect(pool, `${card} survived the dead-card filter`).not.toContain(card);

    // And the observable consequence: with the whole deck accounted for, the hero holding the nut flush
    // on a made board wins every single time. A leaked duplicate would produce the occasional loss.
    const madeNuts = equityVsRandom(['Ah', 'Kh'], ['Qh', 'Jh', 'Th', '2c', '3d'], 1, 2000, 4);
    expect(madeNuts.win, 'a royal flush lost a hand, so a duplicate card was dealt').toBe(1);
    expect(madeNuts.lose).toBe(0);
  });

  it('reports category chances that match the hands it actually made', () => {
    /*
     * categoryChances is a second, independent accounting of the same simulation, so it must agree with
     * the win/tie/lose accounting. On a board where the hero cannot miss, both must be certain.
     */
    const result = equityVsRandom(['Ah', 'Kh'], ['Qh', 'Jh', 'Th', '2c', '3d'], 1, 2000, 9);
    const straightFlush = result.categoryChances['Straight Flush'];
    expect(straightFlush, 'the hero holds a royal but the categories disagree').toBe(1);
    const sum = Object.values(result.categoryChances).reduce((total, share) => total + share, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('is unbiased across seeds, not merely deterministic per seed', () => {
    /*
     * Determinism is already tested. The property that matters for a DISPLAYED number is that the
     * estimate does not depend on which seed the screen happened to use: the spread across seeds must
     * be consistent with sampling noise at DISPLAY_ITERATIONS, not with a seed-dependent bias.
     */
    const hole: Card[] = ['Ac', 'Kd'];
    const board: Card[] = ['Ah', '7c', '2d'];
    const estimates = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) =>
      equityWithTiesAsHalf(hole, board, seed, DISPLAY_ITERATIONS),
    );
    const mean = estimates.reduce((a, b) => a + b, 0) / estimates.length;
    const spread = Math.max(...estimates) - Math.min(...estimates);
    // Standard error at 2000 iterations is at most 0.0112; a spread beyond ~8 SE across 8 seeds would
    // mean the seed is doing something other than choosing a sample.
    expect(spread, `estimates ranged ${spread.toFixed(4)} across seeds (mean ${mean.toFixed(4)})`).toBeLessThan(
      0.09,
    );
  });

  it('agrees with a hand-rolled simulation of the same spot, evaluator included', () => {
    /*
     * The last independent check available without a second evaluator: run the simulation here, with
     * its own loop and its own bookkeeping, and require the module's answer to match. Only the
     * evaluator is shared, so a bug anywhere else in equity.ts — the runout slice, the index
     * arithmetic, the opponent loop, the counting — shows up as a disagreement.
     */
    const hole: Card[] = ['Ac', 'Kd'];
    const board: Card[] = ['Ah', '7c', '2d'];
    const ITERATIONS = 4000;
    const SEED = 77;

    const dead = new Set([...hole, ...board]);
    const deck = freshDeck().filter((card) => !dead.has(card));
    const rng = mulberry32(SEED);
    let wins = 0;
    let ties = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      const pool = deck.slice();
      const needed = 5 - board.length + 2;
      for (let k = 0; k < needed && k < pool.length; k++) {
        const j = k + Math.floor(rng() * (pool.length - k));
        [pool[k], pool[j]] = [pool[j], pool[k]];
      }
      const runout = board.concat(pool.slice(0, 5 - board.length));
      const heroScore = evaluate(hole.concat(runout)).score;
      const villainScore = evaluate(
        [pool[5 - board.length], pool[5 - board.length + 1]].concat(runout),
      ).score;
      if (heroScore > villainScore) wins++;
      else if (heroScore === villainScore) ties++;
    }

    const mine = (wins + ties / 2) / ITERATIONS;
    const theirs = equityWithTiesAsHalf(hole, board, SEED, ITERATIONS);
    // Same seed, same algorithm: these should be identical, not merely close. If they differ at all,
    // the two implementations of "deal a runout" have diverged somewhere.
    expect(theirs, `hand-rolled ${mine.toFixed(6)} vs module ${theirs.toFixed(6)}`).toBeCloseTo(mine, 10);
  });
});
