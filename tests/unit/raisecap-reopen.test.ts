import { describe, it, expect } from 'vitest';
import { applyAction, createTable, legalActions, startHand, type TableState } from '../../src/core/table.js';

/**
 * A FULL raise reopens the betting for everyone.
 *
 * A short all-in — one that lifts currentBet without being a full raise — correctly bars the seats
 * that had already matched the old bet from raising: the action was never reopened for them. But
 * `_raiseCapped` was cleared only in advanceStreet, so that cap outlived the all-in that justified it.
 * When someone then put in a legitimate full raise over the top, the capped seat was still offered
 * only [fold, call] with thousands behind, while an uncapped seat at the same table facing the same
 * raise was offered [fold, call, raise, allin]. Two seats, one action, different rights.
 *
 * Reproduction from scripts/audit-w6/a15-minimal-repro.ts, driven entirely through legalActions.
 */

function raiseCapped(state: TableState): boolean[] {
  return (state as unknown as { _raiseCapped: boolean[] })._raiseCapped;
}

/** 4 seats; seat2 is left short so its all-in cannot be a full raise. */
function shortStackTable(): TableState {
  return startHand(
    createTable({
      seats: [
        { name: 'S0', stack: 5000, isHero: true },
        { name: 'S1', stack: 5000 },
        { name: 'S2', stack: 150 },
        { name: 'S3', stack: 5000 },
      ],
      sb: 25,
      bb: 50,
      seed: 3,
    }),
  );
}

/** Drive the exact preflop-then-flop sequence the probe found, asserting legality at each step. */
function reachStaleCap(): TableState {
  let s = shortStackTable();
  const script: { seat: number; kind: 'call' | 'check' | 'bet' | 'allin'; amount?: number }[] = [
    { seat: 3, kind: 'call' },
    { seat: 0, kind: 'call' },
    { seat: 1, kind: 'call' },
    { seat: 2, kind: 'check' },
    { seat: 1, kind: 'bet', amount: 60 },
    { seat: 2, kind: 'allin' },
  ];

  for (const step of script) {
    expect(s.toAct, `expected seat${step.seat} to act`).toBe(step.seat);
    expect(legalActions(s), `seat${step.seat} ${step.kind}`).toContain(step.kind);
    s = applyAction(s, step.amount === undefined ? { kind: step.kind } : { kind: step.kind, amount: step.amount });
  }
  return s;
}

describe('a short all-in caps, and a full raise uncaps', () => {
  it('caps the seat that had already matched the old bet', () => {
    // The precondition, asserted so the regression cannot pass vacuously by never capping at all.
    const s = reachStaleCap();
    expect(raiseCapped(s)[1]).toBe(true);
    expect(s.toAct).toBe(3);
  });

  it('restores the right to raise once a full raise comes over the top', () => {
    let s = reachStaleCap();

    const before = s.currentBet;
    s = applyAction(s, { kind: 'raise', amount: 160 });
    // Confirm this really was a FULL raise: increment 60 against minRaise 60. A short raise must
    // NOT uncap, so the test is only meaningful if this precondition holds.
    expect(160 - before).toBeGreaterThanOrEqual(50);

    expect(s.toAct).toBe(0);
    expect(legalActions(s)).toContain('raise');

    // Advance to the previously-capped seat and check it has the same rights as everyone else.
    s = applyAction(s, { kind: 'call' });
    expect(s.toAct).toBe(1);
    expect(s.seats[1].stack).toBeGreaterThan(1000);
    expect(legalActions(s)).toContain('raise');
    expect(raiseCapped(s)[1]).toBe(false);
  });

  it('keeps the cap when the raise over the top is NOT full-sized', () => {
    // The guard on the fix. A cap must survive anything that does not reopen the betting, or the
    // short-all-in rule this cap implements is gone.
    let s = reachStaleCap();
    expect(raiseCapped(s)[1]).toBe(true);

    // seat3 merely calls the all-in: no reopening, so seat1 stays capped.
    s = applyAction(s, { kind: 'call' });
    expect(raiseCapped(s)[1]).toBe(true);
    expect(s.toAct).toBe(0);
    s = applyAction(s, { kind: 'call' });
    expect(s.toAct).toBe(1);
    expect(legalActions(s)).not.toContain('raise');
    expect(legalActions(s)).toEqual(['fold', 'call']);
  });

  it('clears every cap on a full-sized all-in too', () => {
    // The same reopening rule, reached by the allin branch rather than the raise branch.
    let s = reachStaleCap();
    expect(raiseCapped(s)[1]).toBe(true);

    // seat3 shoves its whole 5000 — an increment far above minRaise, so the betting reopens.
    expect(legalActions(s)).toContain('allin');
    s = applyAction(s, { kind: 'allin' });
    expect(raiseCapped(s).every((capped) => !capped)).toBe(true);
  });
});
