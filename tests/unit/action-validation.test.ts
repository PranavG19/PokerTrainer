import { describe, it, expect } from 'vitest';
import {
  applyAction,
  createTable,
  legalActions,
  maxRaiseTo,
  minRaiseTo,
  startHand,
  type TableState,
} from '../../src/core/table.js';

/**
 * applyAction rejects what the rules do not permit.
 *
 * The engine used to validate nothing, and every arithmetic path in it is a subtraction that trusts
 * its input. Measured by scripts/audit-w6/a2-legality.ts: `raise` to -500 CREDITED the seat 500 chips
 * and left currentBet negative; `raise` to 999999 drove a stack to -994999 with `allIn` still false,
 * because that flag is set only on exactly 0; a folded seat forced to act could bet. Chip
 * conservation held through every one of them — the sums stayed right while the state became
 * nonsense — which is exactly why the conservation fuzzer never flagged any of it.
 *
 * Unreachable from the table screen, which clamps before calling. Reachable by any other caller, and
 * the drill, review and lesson screens are becoming callers.
 */

function table(stacks: number[], seed = 42): TableState {
  return startHand(
    createTable({
      seats: stacks.map((stack, i) => ({ name: `S${i}`, stack, isHero: i === 0 })),
      sb: 25,
      bb: 50,
      seed,
    }),
  );
}

function chips(state: TableState): number {
  return state.seats.reduce((sum, seat) => sum + seat.stack, 0) + state.pot;
}

describe('an amount outside the legal range is refused', () => {
  it('refuses a negative raise, which used to pay the seat', () => {
    const s = table([5000, 5000, 5000, 5000]);
    expect(() => applyAction(s, { kind: 'raise', amount: -500 })).toThrow(/out of range/);
    // And the caller's state is untouched — applyAction clones, so a rejected action cannot
    // half-apply.
    expect(chips(s)).toBe(20_000);
    expect(s.seats.every((seat) => seat.stack >= 0)).toBe(true);
  });

  it('refuses a raise beyond the stack, which used to go negative with allIn false', () => {
    const s = table([5000, 5000, 5000, 5000]);
    expect(() => applyAction(s, { kind: 'raise', amount: 999_999 })).toThrow(/out of range/);
  });

  it('refuses a raise below the minimum', () => {
    const s = table([5000, 5000, 5000, 5000]);
    const floor = minRaiseTo(s);
    expect(() => applyAction(s, { kind: 'raise', amount: floor - 1 })).toThrow(/out of range/);
    // The boundary itself is legal, so the guard is not off by one.
    expect(() => applyAction(s, { kind: 'raise', amount: floor })).not.toThrow();
  });

  it('accepts the whole legal range at both ends', () => {
    const s = table([5000, 5000, 5000, 5000]);
    for (const amount of [minRaiseTo(s), maxRaiseTo(s)]) {
      expect(() => applyAction(s, { kind: 'raise', amount }), `raise to ${amount}`).not.toThrow();
    }
  });

  it('refuses a non-finite amount', () => {
    const s = table([5000, 5000, 5000, 5000]);
    for (const amount of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => applyAction(s, { kind: 'raise', amount })).toThrow();
    }
  });
});

describe('an action of the wrong kind is refused', () => {
  it('refuses check when there is a bet to answer', () => {
    const s = table([5000, 5000, 5000, 5000]);
    expect(legalActions(s)).not.toContain('check');
    expect(() => applyAction(s, { kind: 'check' })).toThrow(/illegal action check/);
  });

  it('refuses any action from a seat that cannot act', () => {
    // legalActions returns [] for a folded seat; every kind must bounce off that.
    const s = table([5000, 5000, 5000, 5000]);
    const forced: TableState = JSON.parse(JSON.stringify(s));
    forced.seats[forced.toAct].folded = true;
    expect(legalActions(forced)).toEqual([]);
    for (const kind of ['fold', 'check', 'call', 'bet', 'raise', 'allin'] as const) {
      expect(() => applyAction(forced, { kind }), kind).toThrow(/illegal action/);
    }
  });
});

describe('the one accepted alias', () => {
  it('lets a call stand in for an all-in when the seat cannot cover the bet', () => {
    /**
     * legalActions offers 'allin' rather than 'call' when the stack will not cover the bet, but the
     * chips are identical — `call` already caps at the stack — and the renderer relies on this
     * equivalence in both directions (btn-call sends 'allin' when 'call' is absent, table.ts:424).
     * Rejecting the reverse would make the engine stricter than its own UI over a naming difference
     * rather than a rules difference.
     */
    let s = table([1000, 1000, 1000, 1000], 3);
    s = applyAction(s, { kind: 'fold' });
    s = applyAction(s, { kind: 'fold' });
    s = applyAction(s, { kind: 'call' });
    s = applyAction(s, { kind: 'check' });
    s = applyAction(s, { kind: 'allin' });

    const facing = s.seats[s.toAct];
    expect(legalActions(s)).toContain('allin');
    expect(legalActions(s)).not.toContain('call');
    expect(s.currentBet).toBeGreaterThan(facing.committed);

    const viaCall = applyAction(s, { kind: 'call' });
    const viaAllIn = applyAction(s, { kind: 'allin' });
    // Same chips, whichever name the caller used.
    expect(viaCall.seats.map((x) => x.stack)).toEqual(viaAllIn.seats.map((x) => x.stack));
    expect(viaCall.pot).toBe(viaAllIn.pot);
  });

  it('still refuses a call when there is nothing to call', () => {
    // The alias must not become a blanket exemption: at toCall 0 there is no bet to be short of, so
    // 'call' is simply wrong and stays refused.
    let s = table([5000, 5000, 5000, 5000]);
    s = applyAction(s, { kind: 'call' });
    s = applyAction(s, { kind: 'call' });
    s = applyAction(s, { kind: 'call' });
    s = applyAction(s, { kind: 'check' });
    expect(s.street).toBe('flop');
    expect(s.currentBet).toBe(0);
    expect(() => applyAction(s, { kind: 'call' })).toThrow(/illegal action call/);
  });
});
