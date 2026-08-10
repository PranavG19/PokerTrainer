import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createTable,
  legalActions,
  minRaiseTo,
  settle,
  startHand,
  type TableState,
} from '../../src/core/table.js';
import { mulberry32 } from '../../src/core/rng.js';

/**
 * A SETTLED HAND CARRIES NO LEFTOVER BETTING STATE — the last known-open item in
 * research/AUDIT-W6-findings.md, now closed.
 *
 * THE DEFECT AND WHY IT WAS FILED AS "OPEN" RATHER THAN FIXED. `advanceStreet` zeroes `committed` and
 * `currentBet` between streets, but a hand that ENDS never advances a street — both `settle` exits
 * return directly — so a settled hand kept whatever the last betting round left behind. The audit
 * measured ~0.3% of hands ending with a `currentBet` of up to 200 that no seat's `committed` backed,
 * traced every consumer, and found all of them run either before showdown or immediately after
 * `startHand`. So it was INERT, and I recorded it rather than changing engine code for a number nothing
 * read.
 *
 * WHY IT IS WORTH CLOSING NOW. "Inert" is a property of today's callers, not of the state. New surfaces
 * that read table state at handover are being added, and a reader cannot tell a stale `currentBet` from
 * a live one — it is a plausible number in a valid field. The cost of the fix is four assignments; the
 * cost of the trap is a wrong number on a teaching surface.
 *
 * THE ORACLE IS AGREEMENT, NOT A CONSTANT. Asserting `currentBet === 0` alone would pass on a state
 * where `committed` was left dirty instead. What is asserted is the relationship that must hold of any
 * settled hand: no seat is owed anything and no bet is outstanding, so `currentBet` and every
 * `committed` are zero TOGETHER, and the pot is empty because the money is in stacks.
 */

const SEATS = 4;
const START_STACK = 5000;

/** The real construction: createTable then startHand. Deep enough stacks that folds and raises both fit. */
function freshHand(seed: number): TableState {
  return startHand(
    createTable({
      seats: Array.from({ length: SEATS }, (_, i) => ({
        name: `P${i}`,
        stack: START_STACK,
        isHero: i === 0,
      })),
      sb: 25,
      bb: 50,
      seed,
    }),
  );
}

/**
 * Uneven stacks, which is what produces the case the equal-stack sweep cannot: a short seat all-in for
 * less ends the betting round with the deep seat's commitment still recorded, so the hand reaches
 * showdown with a bet outstanding. Only ~1.25% of showdowns do this (scripts/audit-w6/a29).
 */
function unevenHand(seed: number): TableState {
  return startHand(
    createTable({
      seats: [5000, 300, 1200, 90].map((stack, i) => ({ name: `P${i}`, stack, isHero: i === 0 })),
      sb: 25,
      bb: 50,
      seed,
    }),
  );
}

/** The invariant a settled hand must satisfy, whatever route it took to get there. */
function expectNoLeftoverBets(state: TableState, where: string): void {
  expect(state.currentBet, `${where}: currentBet outlived the hand`).toBe(0);
  for (const seat of state.seats) {
    expect(seat.committed, `${where}: seat${seat.id} still shows a commitment`).toBe(0);
  }
  expect(state.pot, `${where}: the pot was not distributed`).toBe(0);
  expect(state.lastAggressor, `${where}: a settled hand still names an aggressor`).toBe(null);
  expect(state.minRaise, `${where}: minRaise was not reset to one big blind`).toBe(state.bb);

  // The agreement, stated as a relationship rather than as two separate zeroes: a bet nobody has
  // matched is what "currentBet outlives its commitments" MEANS, so this is the defect's own shape.
  const highestCommitment = Math.max(...state.seats.map((seat) => seat.committed));
  expect(
    state.currentBet,
    `${where}: currentBet ${state.currentBet} exceeds the highest commitment ${highestCommitment}`,
  ).toBeLessThanOrEqual(highestCommitment);
}

/** Chips are conserved — kept as a guard metric so the fix cannot pay for tidiness with money. */
function totalChips(state: TableState): number {
  return state.seats.reduce((sum, seat) => sum + seat.stack, 0) + state.pot;
}

describe('the fold-out path', () => {
  it('clears the betting state when everyone folds to one seat', () => {
    /*
     * THE PATH THAT WAS MISSED, and the reason clearBettingState is one function called twice rather
     * than two inlined blocks. A fold-out jumps straight to settle with a live bet on the table — it is
     * the case where `currentBet` is most likely to be non-zero at the end.
     */
    let state = freshHand(5);
    const before = totalChips(state);

    // A raise, then everyone folds to it: currentBet is high and only one seat has matched it.
    if (legalActions(state).includes('raise')) {
      state = applyAction(state, { kind: 'raise', amount: minRaiseTo(state) });
    }
    expect(state.currentBet, 'the setup did not produce a live bet').toBeGreaterThan(0);

    let guard = 0;
    while (state.seats.filter((seat) => !seat.folded).length > 1 && guard++ < 20) {
      if (!legalActions(state).includes('fold')) break;
      state = applyAction(state, { kind: 'fold' });
    }
    expect(state.seats.filter((seat) => !seat.folded).length, 'the setup did not fold down to one').toBe(1);
    // The defect's precondition: a bet is outstanding at the moment settle is called.
    expect(state.currentBet).toBeGreaterThan(0);

    const settled = settle(state);
    expectNoLeftoverBets(settled, 'fold-out');
    expect(totalChips(settled), 'chips were not conserved through settle').toBe(before);
  });
});

describe('a hand that reaches the river with a bet outstanding', () => {
  it('clears the betting state when a short all-in leaves a commitment recorded', () => {
    /*
     * THE SCENARIO THE EQUAL-STACK SWEEP CANNOT PRODUCE. With even stacks, every hand that gets this far
     * has had its betting round close, and advanceStreet already zeroed `committed` on the way in — so
     * there is nothing left for settle to clear and the assertion below would pass either way.
     *
     * UNEVEN STACKS are what produce it: a short seat all-in for less ends the round with the deep
     * seat's commitment still recorded and currentBet still set. Measured with stacks
     * [5000, 300, 1200, 90], 5 of 400 hands arrive that way — seed 34 has currentBet 5000 against
     * committed [5000, 25, 50, 50] (scripts/audit-w6/a29-showdown-leftover.ts), which is why it is the
     * seed used here.
     *
     * IT EXITS THROUGH THE FOLD-OUT BRANCH, not the showdown one, and the distinction matters enough to
     * name: `street === 'showdown'` does NOT mean settle takes the showdown path — the fold-out branch
     * runs first whenever only one seat is unfolded, which is the case here. Across 5810 multiway hands
     * over 8 stack shapes, ZERO reached a genuine multiway showdown with dirty state
     * (a30-which-exit.ts, a31-multiway-dirty.ts), so the clear on the showdown exit is unreachable
     * defence-in-depth and is documented as such in core/table.ts rather than tested here.
     */
    let state = unevenHand(34);
    const before = totalChips(state);
    const rng = mulberry32(34 ^ 0x1234);
    let guard = 0;
    while (state.street !== 'showdown' && state.seats.filter((s) => !s.folded).length > 1 && guard++ < 300) {
      const legal = legalActions(state);
      if (legal.length === 0) break;
      const roll = rng();
      const action =
        roll < 0.35 && legal.includes('raise')
          ? ({ kind: 'raise', amount: minRaiseTo(state) } as const)
          : roll < 0.5 && legal.includes('allin')
            ? ({ kind: 'allin' } as const)
            : legal.includes('call')
              ? ({ kind: 'call' } as const)
              : legal.includes('check')
                ? ({ kind: 'check' } as const)
                : ({ kind: 'fold' } as const);
      if (!legal.includes(action.kind)) break;
      state = applyAction(state, action);
    }

    expect(state.street, 'the setup did not reach the river').toBe('showdown');
    // THE PRECONDITION THAT MAKES THIS TEST MEAN ANYTHING: settle must have something to clear.
    // Without this, the assertion below passes whether or not the clear happens.
    expect(
      state.currentBet !== 0 || state.seats.some((seat) => seat.committed !== 0),
      'this hand arrived clean, so it cannot test the clear — pick another seed (a29)',
    ).toBe(true);

    const settled = settle(state);
    expectNoLeftoverBets(settled, 'river reached with an outstanding bet');
    expect(totalChips(settled), 'chips were not conserved').toBe(before);
  });

  it('clears the betting state when a hand is played passively to the river', () => {
    let state = freshHand(9);
    const before = totalChips(state);

    // Passive to showdown: call or check whoever is to act, until the hand is ready to settle.
    let guard = 0;
    while (state.street !== 'showdown' && guard++ < 200) {
      const legal = legalActions(state);
      if (legal.includes('check')) state = applyAction(state, { kind: 'check' });
      else if (legal.includes('call')) state = applyAction(state, { kind: 'call' });
      else if (legal.includes('allin')) state = applyAction(state, { kind: 'allin' });
      else break;
    }
    expect(state.street, 'the hand did not reach showdown').toBe('showdown');

    const settled = settle(state);
    expectNoLeftoverBets(settled, 'showdown');
    expect(totalChips(settled)).toBe(before);
  });
});

describe('across many seeds and many routes', () => {
  /**
   * THE MEASUREMENT THAT MADE THIS A REAL DEFECT rather than a theoretical one: the audit found ~0.3%
   * of hands leaving a stale currentBet, which is exactly the rate a handful of hand-written spots would
   * miss. So the invariant is checked over a wide sweep of seeds and mixed betting behaviour, which is
   * what found it in the first place.
   */
  it('no settled hand ever carries a leftover bet, over 300 seeds', () => {
    let stale = 0;
    for (let seed = 1; seed <= 300; seed++) {
      let state = unevenHand(seed);
      const before = totalChips(state);
      const rng = mulberry32(seed ^ 0xabcdef);

      let guard = 0;
      while (state.street !== 'showdown' && state.seats.filter((s) => !s.folded).length > 1 && guard++ < 300) {
        const legal = legalActions(state);
        if (legal.length === 0) break;
        // Mixed, seeded behaviour: aggression is what produces uncalled bets, and folds are what
        // produce the fold-out exit. Both routes have to be reached for this sweep to mean anything.
        const roll = rng();
        const preferred =
          roll < 0.25 && legal.includes('raise')
            ? ({ kind: 'raise', amount: minRaiseTo(state) } as const)
            : roll < 0.45 && legal.includes('fold')
              ? ({ kind: 'fold' } as const)
              : legal.includes('check')
                ? ({ kind: 'check' } as const)
                : legal.includes('call')
                  ? ({ kind: 'call' } as const)
                  : legal.includes('allin')
                    ? ({ kind: 'allin' } as const)
                    : ({ kind: 'fold' } as const);
        if (!legal.includes(preferred.kind)) break;
        state = applyAction(state, preferred);
      }

      const settled = settle(state);
      if (settled.currentBet !== 0 || settled.seats.some((seat) => seat.committed !== 0)) stale++;
      expectNoLeftoverBets(settled, `seed ${seed}`);
      expect(totalChips(settled), `seed ${seed}: chips not conserved`).toBe(before);
    }
    expect(stale, `${stale} of 300 settled hands carried leftover betting state`).toBe(0);
  });

  it('the sweep really does reach both exits, or it proves nothing', () => {
    /*
     * The control for the sweep above. If every seed happened to reach showdown, the fold-out branch
     * would be untested and the sweep would look thorough while covering one path — the same blindness
     * that let the original defect sit in the fold-out path specifically.
     */
    let foldOuts = 0;
    let showdowns = 0;
    for (let seed = 1; seed <= 300; seed++) {
      let state = unevenHand(seed);
      const rng = mulberry32(seed ^ 0xabcdef);
      let guard = 0;
      while (state.street !== 'showdown' && state.seats.filter((s) => !s.folded).length > 1 && guard++ < 300) {
        const legal = legalActions(state);
        if (legal.length === 0) break;
        const roll = rng();
        const preferred =
          roll < 0.25 && legal.includes('raise')
            ? ({ kind: 'raise', amount: minRaiseTo(state) } as const)
            : roll < 0.45 && legal.includes('fold')
              ? ({ kind: 'fold' } as const)
              : legal.includes('check')
                ? ({ kind: 'check' } as const)
                : legal.includes('call')
                  ? ({ kind: 'call' } as const)
                  : legal.includes('allin')
                    ? ({ kind: 'allin' } as const)
                    : ({ kind: 'fold' } as const);
        if (!legal.includes(preferred.kind)) break;
        state = applyAction(state, preferred);
      }
      if (state.seats.filter((seat) => !seat.folded).length === 1) foldOuts++;
      else showdowns++;
    }
    expect(foldOuts, 'the sweep never reached a fold-out, so that branch is untested').toBeGreaterThan(10);
    expect(showdowns, 'the sweep never reached a showdown').toBeGreaterThan(10);
  });
});

describe('the fix does not cost anything it should not', () => {
  it('leaves the winners, the log and the stacks untouched', () => {
    /*
     * clearBettingState runs AFTER buildSidePots and payRefunds, both of which read `committed`.
     * Clearing earlier would zero every side pot and every refund — a much worse bug than the one being
     * fixed — so the payout is asserted intact rather than assumed.
     */
    let state = freshHand(21);
    const before = totalChips(state);
    let guard = 0;
    while (state.street !== 'showdown' && guard++ < 200) {
      const legal = legalActions(state);
      if (legal.includes('check')) state = applyAction(state, { kind: 'check' });
      else if (legal.includes('call')) state = applyAction(state, { kind: 'call' });
      else break;
    }
    const settled = settle(state);

    expect(settled.winners, 'the hand settled with no winner').not.toBeNull();
    expect(settled.winners?.length ?? 0, 'nobody was paid').toBeGreaterThan(0);
    const paid = (settled.winners ?? []).reduce((sum, winner) => sum + winner.amount, 0);
    expect(paid, 'the winners were paid nothing').toBeGreaterThan(0);
    expect(totalChips(settled), 'clearing the betting state moved money').toBe(before);
    // Somebody must actually be richer than they started, or the payout went nowhere.
    expect(settled.seats.some((seat) => seat.stack > START_STACK)).toBe(true);
  });

  it('a settled hand can still start the next one', () => {
    // The state is cleared, not corrupted: startHand must accept it and deal again.
    let state = freshHand(33);
    let guard = 0;
    while (state.street !== 'showdown' && guard++ < 200) {
      const legal = legalActions(state);
      if (legal.includes('check')) state = applyAction(state, { kind: 'check' });
      else if (legal.includes('call')) state = applyAction(state, { kind: 'call' });
      else break;
    }
    const settled = settle(state);
    // Carry the settled stacks into a new hand, which is what the app does at handover.
    const next = startHand(
      createTable({
        seats: settled.seats.map((seat) => ({ name: seat.name, stack: seat.stack, isHero: seat.isHero })),
        sb: 25,
        bb: 50,
        seed: 34,
      }),
    );
    // Blinds are posted, so the new hand has live commitments — proving the clear did not stick.
    expect(next.currentBet).toBe(next.bb);
    expect(next.seats.some((seat) => seat.committed > 0)).toBe(true);
  });
});
