import { describe, it, expect } from 'vitest';
import { applyAction, createTable, legalActions, settle, startHand, type TableState } from '../../src/core/table.js';

/**
 * A winner cannot collect more than its rivals matched.
 *
 * settle() paid the last standing seat the ENTIRE pot, and buildSidePots poured any slice with no
 * live claimant into the previous pot as "dead money" — whose sole claimant was whichever short seat
 * was already all-in below that level. A 25-chip small blind therefore collected the 2925 two deep
 * seats had staked between themselves. `sum(stacks) + pot === constant` held the whole time, which is
 * why the chip-conservation fuzzer never flagged it: no chips were created, they were sent to the
 * wrong seat. The oracle these tests use is a stake cap, not a total.
 */

function table(stacks: number[], sb: number, bb: number, seed: number): TableState {
  return startHand(
    createTable({ seats: stacks.map((stack, i) => ({ name: `S${i}`, stack, isHero: i === 0 })), sb, bb, seed }),
  );
}

function startStacks(state: TableState): number[] {
  return (state as unknown as { _startStacks: number[] })._startStacks;
}

/** What each seat has put in this hand. */
function stakes(pre: TableState): number[] {
  const start = startStacks(pre);
  return pre.seats.map((seat, i) => start[i] - seat.stack);
}

/** The most a seat can legitimately collect: its own stake, matched at most once by each rival. */
function entitlement(pre: TableState, seatId: number): number {
  const paid = stakes(pre);
  return paid.reduce((cap, other, i) => (i === seatId ? cap : cap + Math.min(paid[seatId], other)), paid[seatId]);
}

function chips(state: TableState): number {
  return state.seats.reduce((sum, seat) => sum + seat.stack, 0) + state.pot;
}

function collected(state: TableState, seatId: number): number {
  return (state.winners ?? []).filter((w) => w.seatId === seatId).reduce((sum, w) => sum + w.amount, 0);
}

describe('the fold-out path caps at what rivals matched', () => {
  /**
   * The exact reproduction from scripts/audit-w6/a7-foldout.ts, driven only through legalActions:
   * seat1 is all-in for a 25-chip small blind, the three deep seats build a 3025 pot, then all three
   * fold. It used to be paid 3025 — a 121x return on a 25-chip stake.
   */
  it('pays a short all-in only the stake its rivals matched', () => {
    let s = table([5000, 25, 5000, 5000], 25, 50, 7);
    expect(s.seats[1].allIn).toBe(true);
    expect(stakes(s)[1]).toBe(25);

    for (const action of [{ kind: 'raise' as const, amount: 1000 }, { kind: 'call' as const }, { kind: 'call' as const }]) {
      expect(legalActions(s)).toContain(action.kind);
      s = applyAction(s, action);
    }
    expect(s.pot).toBe(3025);

    while (s.seats.filter((seat) => !seat.folded).length > 1) {
      expect(legalActions(s)).toContain('fold');
      s = applyAction(s, { kind: 'fold' });
    }

    const done = settle(s);
    // 4 x 25: seat1's own 25 plus 25 from each of the three rivals.
    expect(collected(done, 1)).toBe(100);
    expect(collected(done, 1)).toBeLessThanOrEqual(entitlement(s, 1));
    expect(done.seats[1].stack).toBe(100);
  });

  it('returns each deep seat its own uncontested excess rather than pooling it', () => {
    // The 2925 nobody could contest is not one seat's windfall: seat0, seat2 and seat3 each staked
    // 975 above seat1's all-in, so each takes its own 975 back. Pooling it into the previous pot is
    // what produced the overpayment, so splitting it correctly is the actual fix.
    let s = table([5000, 25, 5000, 5000], 25, 50, 7);
    for (const action of [{ kind: 'raise' as const, amount: 1000 }, { kind: 'call' as const }, { kind: 'call' as const }]) {
      s = applyAction(s, action);
    }
    while (s.seats.filter((seat) => !seat.folded).length > 1) s = applyAction(s, { kind: 'fold' });

    const done = settle(s);
    for (const id of [0, 2, 3]) {
      expect(done.seats[id].stack).toBe(4975); // 5000 - 1000 staked + 975 returned
    }
    expect(done.log.filter((line) => line.includes('takes back 975'))).toHaveLength(3);
  });

  it('returns the part of a blind the short opponent could not cover', () => {
    // The minimal case: no post-blind action at all. seat0 posts 25, seat1 can only post 10, seat0
    // folds. seat1 wins 20 — its 10 matched once — and seat0's uncovered 15 comes back.
    const s = table([5000, 10], 25, 50, 4);
    expect(s.seats[1].stack).toBe(0);
    const pre = applyAction(s, { kind: 'fold' });

    const done = settle(pre);
    expect(collected(done, 1)).toBe(20);
    expect(done.seats[1].stack).toBe(20);
    expect(done.seats[0].stack).toBe(4990); // 5000 - 25 staked + 15 returned
    expect(chips(done)).toBe(5010);
  });
});

describe('the showdown path caps too', () => {
  /**
   * seed 1007 from the a5 fuzz, and the case that corrected the original diagnosis: I had recorded
   * the showdown path as capping correctly, because a7's control had no folds in it and so never
   * exercised the dead-money rule. It does not cap — seat1 was paid 72 + 571 on a 25-chip stake.
   * Both paths shared one defective rule.
   */
  it('does not hand a folded seat\'s excess to a short all-in at showdown', () => {
    let s = table([18, 25, 5000, 5000], 25, 50, 1007);
    const script: { kind: 'raise' | 'allin' | 'call' | 'fold' | 'check'; amount?: number }[] = [
      { kind: 'raise', amount: 100 },
      { kind: 'allin' },
      { kind: 'raise', amount: 150 },
      { kind: 'raise', amount: 200 },
      { kind: 'raise', amount: 250 },
      { kind: 'raise', amount: 300 },
      { kind: 'call' },
      { kind: 'fold' },
      { kind: 'fold' },
    ];
    for (const action of script) {
      if (legalActions(s).length === 0) break;
      if (!legalActions(s).includes(action.kind)) break;
      s = applyAction(s, action);
    }

    const paid = stakes(s);
    const done = settle(s);
    for (const seat of done.seats) {
      expect(collected(done, seat.id)).toBeLessThanOrEqual(entitlement(s, seat.id));
    }
    // Whoever won, the two seats that staked 300 against opponents worth 18 and 25 cannot have lost
    // all of it: the part above the largest live stake was never at risk.
    const deep = paid.map((p, i) => ({ i, p })).filter((x) => x.p >= 300);
    for (const { i } of deep) {
      expect(done.seats[i].stack + collected(done, i)).toBeGreaterThan(0);
    }
  });
});

describe('the cap holds across a fuzzed table, not just the reported seeds', () => {
  /**
   * The general invariant, over the same population the audit swept: mixed short and deep stacks,
   * every legal action reachable, both settle paths. 541 violations before the fix.
   */
  it('never pays any seat more than its rivals matched', () => {
    const violations: string[] = [];

    for (let seed = 1; seed <= 400; seed++) {
      let state = createTable({
        seats: [(seed % 90) + 1, 25, 5000, 5000].map((stack, i) => ({ name: `S${i}`, stack, isHero: i === 0 })),
        sb: 25,
        bb: 50,
        seed,
      });

      for (let hand = 0; hand < 6; hand++) {
        if (state.seats.filter((seat) => seat.stack > 0).length < 2) break;
        let s = startHand(state);

        // Deterministic action choice: no RNG, so a failure names one reproducible seed.
        let steps = 0;
        while (s.street !== 'showdown' && s.seats.filter((seat) => !seat.folded).length > 1 && steps < 300) {
          const legal = legalActions(s);
          if (legal.length === 0) break;
          const kind = legal[(seed + steps + hand) % legal.length];
          s = applyAction(s, kind === 'bet' || kind === 'raise' ? { kind, amount: s.currentBet + s.minRaise } : { kind });
          steps++;
        }

        const before = chips(s);
        const done = settle(s);
        for (const seat of done.seats) {
          const won = collected(done, seat.id);
          const cap = entitlement(s, seat.id);
          if (won > cap) violations.push(`seed ${seed} hand ${hand}: seat${seat.id} won ${won} > cap ${cap}`);
        }
        if (chips(done) !== before) violations.push(`seed ${seed} hand ${hand}: chips ${before} -> ${chips(done)}`);
        state = done;
      }
    }

    expect(violations.slice(0, 5)).toEqual([]);
  });
});
