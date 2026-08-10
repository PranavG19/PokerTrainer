import { describe, it, expect } from 'vitest';
import { createTable, isHandOver, settle, startHand, type TableState } from '../../src/core/table.js';

/**
 * The one-funded-seat table: every villain is busted, so nextFunded returns the hero for BOTH blind
 * positions and one seat posts both blinds to itself.
 *
 * `seat.committed = sbAmount` then `seat.committed = bbAmount` overwrote rather than accumulated, so
 * the small blind vanished from the ledger while its chips had really left the stack. _startStacks is
 * computed as `stack + committed`, so it under-recorded the hero by exactly the small blind and
 * settle() paid back 25 less than it took. This is chip DESTRUCTION — the failure the conservation
 * invariant exists to catch, hiding in the configuration the fuzzer skipped because it required
 * fewer than two funded seats to reach.
 */

function chips(state: TableState): number {
  return state.seats.reduce((sum, seat) => sum + seat.stack, 0) + state.pot;
}

function loneFundedTable(heroStack: number, seed = 7): TableState {
  return createTable({
    seats: [
      { name: 'You', stack: heroStack, isHero: true },
      { name: 'Ada', stack: 0 },
      { name: 'Bo', stack: 0 },
      { name: 'Cy', stack: 0 },
    ],
    sb: 25,
    bb: 50,
    seed,
  });
}

describe('one funded seat posts both blinds', () => {
  it('records both blinds in the ledger, not just the last one', () => {
    const s = startHand(loneFundedTable(12000));
    expect(s.log).toEqual(['You posts SB 25', 'You posts BB 50']);
    expect(s.seats[0].committed).toBe(75);
    expect(s.seats[0].stack).toBe(11925);
    expect(s.pot).toBe(75);
  });

  it('destroys no chips across settle', () => {
    const dealt = startHand(loneFundedTable(12000));
    expect(isHandOver(dealt)).toBe(true);
    const done = settle(dealt);
    expect(chips(done)).toBe(12000);
    expect(done.seats[0].stack).toBe(12000);
  });

  it('destroys no chips over a long run of unplayable hands', () => {
    // The defect compounded: 25 per hand, so at 450 hands an 11250 stack drained to nothing with no
    // losing hand ever played. A single-hand assertion would have missed the compounding, which is
    // the part that actually reaches a learner.
    let state: TableState = loneFundedTable(12000);
    for (let hand = 0; hand < 60; hand++) {
      state = settle(startHand(state));
      expect(chips(state), `chips changed by hand ${hand + 1}`).toBe(12000);
    }
    expect(state.seats[0].stack).toBe(12000);
  });

  it('leaves multi-funded tables alone', () => {
    // The guard on the fix: `+=` must not double-post when the blinds are two different seats. If it
    // did, every normal hand would inflate, so this is the test that keeps the fix honest.
    for (const funded of [2, 3, 4, 6]) {
      const stacks = Array.from({ length: 6 }, (_, i) => (i < funded ? 1000 : 0));
      const table = createTable({
        seats: stacks.map((stack, i) => ({ name: `S${i}`, stack, isHero: i === 0 })),
        sb: 25,
        bb: 50,
        seed: 11,
      });
      const s = startHand(table);
      const posted = s.seats.reduce((sum, seat) => sum + seat.committed, 0);
      expect(posted, `${funded} funded seats`).toBe(75);
      expect(s.seats.filter((seat) => seat.committed > 0), `${funded} funded seats`).toHaveLength(2);
      expect(chips(s), `${funded} funded seats`).toBe(funded * 1000);
    }
  });

  it('pays the lone seat its own blinds back and no more', () => {
    // It is simultaneously the only contributor and the only claimant, so the whole 75 comes back —
    // partly as a win, partly as uncontested chips. What matters is the total, and that no rival
    // (there is none) is credited.
    const done = settle(startHand(loneFundedTable(500)));
    const collectedByHero = (done.winners ?? []).reduce((sum, w) => sum + w.amount, 0);
    expect(done.winners?.every((w) => w.seatId === 0)).toBe(true);
    expect(done.seats[0].stack).toBe(500);
    expect(collectedByHero).toBeLessThanOrEqual(75);
  });
});
