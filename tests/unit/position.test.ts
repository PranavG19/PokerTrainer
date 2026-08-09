import { describe, it, expect } from 'vitest';
import {
  createTable,
  startHand,
  legalActions,
  applyAction,
  isHandOver,
  settle,
  type ActionKind,
  type TableState,
} from '../../src/core/table.js';

// ── Local helpers ────────────────────────────────────────────────────────────
//
// Position is defined entirely by `dealer`; the engine never stores sbIdx/bbIdx,
// so these tests read blind positions back off the seats' `committed` values.

const SB = 25;
const BB = 50;
const STACK = 5000;

function table(stacks: number[], seed = 42): TableState {
  const seats = stacks.map((stack, i) => ({ name: `P${i}`, stack, isHero: i === 0 }));
  return createTable({ seats, sb: SB, bb: BB, seed });
}

function evenTable(n: number, seed = 42): TableState {
  return table(Array.from({ length: n }, () => STACK), seed);
}

function chipTotal(state: TableState): number {
  return state.seats.reduce((sum, s) => sum + s.stack, 0) + state.pot;
}

/** Never folds: checks when free, calls when it can, else all-in. */
function alwaysCall(legal: ActionKind[]): ActionKind {
  if (legal.includes('check')) return 'check';
  if (legal.includes('call')) return 'call';
  if (legal.includes('allin')) return 'allin';
  return 'fold';
}

/**
 * Drives an in-progress hand to completion and settles it. Throws rather than
 * breaking out silently, so a hand that cannot terminate fails the test instead
 * of being mistaken for a pass.
 */
function playOut(state: TableState, policy = alwaysCall): TableState {
  let s = state;
  for (let step = 0; step < 400; step++) {
    if (isHandOver(s)) return settle(s);
    const legal = legalActions(s);
    if (legal.length === 0) {
      throw new Error(
        `stuck: street=${s.street} toAct=${s.toAct} has no legal actions but hand is not over`,
      );
    }
    s = applyAction(s, { kind: policy(legal) });
  }
  throw new Error(`hand did not terminate: street=${s.street} toAct=${s.toAct}`);
}

/** Seat index that posted exactly `amount` this hand, or -1. */
function seatCommitting(state: TableState, amount: number): number {
  return state.seats.findIndex((s) => s.committed === amount);
}

// ── 1. Button rotation ───────────────────────────────────────────────────────

describe('dealer button rotation', () => {
  it('advances exactly one seat per hand and wraps (4 seats, 8 hands)', () => {
    let s = evenTable(4);
    const dealers: number[] = [];
    for (let hand = 0; hand < 8; hand++) {
      s = startHand(s);
      dealers.push(s.dealer);
      s = playOut(s);
    }
    expect(dealers).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
  });

  it('starts at seat 0 on the first hand (dealer initialised to -1)', () => {
    const fresh = evenTable(4);
    expect(fresh.dealer).toBe(-1);
    expect(startHand(fresh).dealer).toBe(0);
  });
});

// ── 2. Multiway blind positions ──────────────────────────────────────────────

describe('multiway blind positions (4 seats)', () => {
  it('SB = dealer+1, BB = dealer+2, first to act = dealer+3, for every button', () => {
    let s = evenTable(4);
    for (let hand = 0; hand < 4; hand++) {
      s = startHand(s);
      const d = s.dealer;
      const n = s.seats.length;

      expect(seatCommitting(s, SB)).toBe((d + 1) % n);
      expect(seatCommitting(s, BB)).toBe((d + 2) % n);
      expect(s.toAct).toBe((d + 3) % n);
      // Dealer never posts a blind multiway, and never acts first preflop.
      expect(s.seats[d].committed).toBe(0);
      expect(s.toAct).not.toBe(d);
      // Only the two blinds have money in.
      expect(s.seats.filter((seat) => seat.committed > 0).map((seat) => seat.id)).toEqual(
        [(d + 1) % n, (d + 2) % n].sort((a, b) => a - b),
      );

      s = playOut(s);
    }
  });
});

// ── 3. Heads-up blind positions ──────────────────────────────────────────────

describe('heads-up blind positions (2 seats)', () => {
  it('dealer posts the SMALL blind and acts FIRST preflop, for both buttons', () => {
    let s = evenTable(2);
    for (let hand = 0; hand < 4; hand++) {
      s = startHand(s);
      const d = s.dealer;
      const other = (d + 1) % 2;

      expect(s.seats[d].committed).toBe(SB);
      expect(s.seats[other].committed).toBe(BB);
      expect(s.toAct).toBe(d);

      s = playOut(s);
    }
  });

  it('heads-up postflop action passes to the non-dealer', () => {
    let s = startHand(evenTable(2));
    expect(s.dealer).toBe(0);
    s = applyAction(s, { kind: 'call' }); // SB/dealer completes
    s = applyAction(s, { kind: 'check' }); // BB checks
    expect(s.street).toBe('flop');
    expect(s.toAct).toBe(1);
  });

  it('heads-up SB/BB assignment is the inverse of multiway', () => {
    // Same dealer seat, different table size → different blind seat.
    const hu = startHand(evenTable(2));
    const multi = startHand(evenTable(4));
    expect(hu.dealer).toBe(0);
    expect(multi.dealer).toBe(0);
    expect(hu.seats[0].committed).toBe(SB);
    expect(multi.seats[0].committed).toBe(0);
  });
});

// ── 4. Blind amounts ─────────────────────────────────────────────────────────

describe('blind amounts', () => {
  it('SB commits sb, BB commits bb, stacks drop by exactly that, pot = sb+bb', () => {
    const s = startHand(evenTable(4));
    expect(s.dealer).toBe(0);

    expect(s.seats[1].committed).toBe(SB);
    expect(s.seats[1].stack).toBe(STACK - SB);
    expect(s.seats[2].committed).toBe(BB);
    expect(s.seats[2].stack).toBe(STACK - BB);
    expect(s.seats[0].stack).toBe(STACK);
    expect(s.seats[3].stack).toBe(STACK);

    expect(s.pot).toBe(SB + BB);
    expect(s.currentBet).toBe(BB);
    expect(chipTotal(s)).toBe(4 * STACK);
    expect(s.seats.some((seat) => seat.allIn)).toBe(false);
  });
});

// ── 5. Partial blinds ────────────────────────────────────────────────────────

describe('partial blinds', () => {
  it('SB shorter than sb posts its whole stack, is all-in, pot holds the SHORT amount', () => {
    const start = [STACK, 10, STACK, STACK];
    const s = startHand(table(start));
    expect(s.dealer).toBe(0); // SB = seat 1

    expect(s.seats[1].stack).toBe(0);
    expect(s.seats[1].committed).toBe(10);
    expect(s.seats[1].allIn).toBe(true);
    expect(s.pot).toBe(10 + BB); // not SB + BB
    expect(chipTotal(s)).toBe(start.reduce((a, b) => a + b, 0));
  });

  it('BB shorter than bb posts its whole stack, is all-in, pot holds the SHORT amount', () => {
    const start = [STACK, STACK, 30, STACK];
    const s = startHand(table(start));
    expect(s.dealer).toBe(0); // BB = seat 2

    expect(s.seats[2].stack).toBe(0);
    expect(s.seats[2].committed).toBe(30);
    expect(s.seats[2].allIn).toBe(true);
    expect(s.pot).toBe(SB + 30);
    // Others still owe the full big blind to continue.
    expect(s.currentBet).toBe(BB);
    expect(chipTotal(s)).toBe(start.reduce((a, b) => a + b, 0));
  });

  it('heads-up short dealer posts a partial small blind and is skipped for action', () => {
    const start = [10, STACK];
    const s = startHand(table(start));
    expect(s.dealer).toBe(0);

    expect(s.seats[0].committed).toBe(10);
    expect(s.seats[0].allIn).toBe(true);
    expect(s.pot).toBe(10 + BB);
    // The dealer acts first heads-up, but it is all-in, so action skips to the BB.
    expect(s.toAct).toBe(1);
    expect(chipTotal(s)).toBe(start.reduce((a, b) => a + b, 0));
  });
});

// ── 6. Both blinds short ─────────────────────────────────────────────────────

describe('both blinds shorter than the blinds', () => {
  it('multiway hand still starts and settles', () => {
    const start = [STACK, 10, 30, STACK];
    const total = start.reduce((a, b) => a + b, 0);
    let s = startHand(table(start, 7));

    expect(s.seats[1].allIn).toBe(true);
    expect(s.seats[2].allIn).toBe(true);
    expect(s.pot).toBe(40);
    expect(s.toAct).toBe(3); // dealer+3, the only untouched seats can still act
    expect(chipTotal(s)).toBe(total);

    s = playOut(s);
    expect(s.street).toBe('showdown');
    expect(s.winners).not.toBeNull();
    expect(s.pot).toBe(0);
    expect(chipTotal(s)).toBe(total);
  });

  it('heads-up hand with both stacks short runs out and settles', () => {
    const start = [10, 30];
    const total = start.reduce((a, b) => a + b, 0);
    let s = startHand(table(start, 11));

    // Nobody can act: the engine must run the board out during startHand.
    expect(s.street).toBe('showdown');
    expect(s.board.length).toBe(5);
    expect(chipTotal(s)).toBe(total);

    s = settle(s);
    expect(s.winners).not.toBeNull();
    expect(s.pot).toBe(0);
    expect(chipTotal(s)).toBe(total);
    // The short blind's uncallable excess comes back to it, not to the table.
    expect(s.seats[1].stack).toBeGreaterThanOrEqual(20);
  });
});

// ── 7. Order of action rotates with the button ───────────────────────────────

describe('order of action rotates with the button', () => {
  it('preflop and postflop first actors both advance hand to hand', () => {
    let s = evenTable(4);
    const preflopActors: number[] = [];
    const postflopActors: number[] = [];

    for (let hand = 0; hand < 5; hand++) {
      s = startHand(s);
      preflopActors.push(s.toAct);

      // Everyone limps/checks preflop → four calls-or-checks reaches the flop.
      s = applyAction(s, { kind: 'call' }); // dealer+3
      s = applyAction(s, { kind: 'call' }); // dealer
      s = applyAction(s, { kind: 'call' }); // SB completes
      s = applyAction(s, { kind: 'check' }); // BB option
      expect(s.street).toBe('flop');
      postflopActors.push(s.toAct);

      s = playOut(s);
    }

    expect(preflopActors).toEqual([3, 0, 1, 2, 3]);
    expect(postflopActors).toEqual([1, 2, 3, 0, 1]);
    // Position genuinely changes: no seat is first to act on consecutive hands.
    for (let i = 1; i < preflopActors.length; i++) {
      expect(preflopActors[i]).not.toBe(preflopActors[i - 1]);
    }
  });
});

// ── 8. Chip conservation across many hands ───────────────────────────────────

describe('chip conservation across hands', () => {
  it('total is constant over 20 consecutive always-call hands', () => {
    const total = 4 * STACK;
    let s = evenTable(4, 1234);

    for (let hand = 1; hand <= 20; hand++) {
      s = startHand(s);
      expect(s.handNumber).toBe(hand);
      expect(chipTotal(s)).toBe(total);

      s = playOut(s);
      expect(s.pot).toBe(0);
      expect(chipTotal(s)).toBe(total);
      expect(s.seats.every((seat) => seat.stack >= 0)).toBe(true);
    }
  });
});

// ── APP BUG: busted seats are dealt in and can win without contributing ──────
//
// startHand deals to every seat unconditionally. A seat with stack 0 gets two
// hole cards, is marked allIn with committed 0, and stays "active", so it is
// eligible to win the pot having put in nothing.
//
// Measured on this engine (4 seats, seat 1 stack 0, sb 25 / bb 50, seed 5):
//   startHand → seats = [
//     { id: 0, stack: 5000, committed:  0, allIn: false },
//     { id: 1, stack:    0, committed:  0, allIn: true  },   ← dealt in, no chips
//     { id: 2, stack: 4950, committed: 50, allIn: false },
//     { id: 3, stack: 5000, committed:  0, allIn: false },
//   ]
//   seats 3, 0, 2 fold → settle() → winners = [
//     { seatId: 1, amount: 50, description: 'Last player standing' }
//   ]
//   final stacks = [5000, 50, 4950, 5000]
// Seat 1 turned 0 chips into 50 by folding-around alone. Chip TOTAL is still
// 15000 (nothing is minted), so the conservation tests above cannot catch it —
// the chips are simply awarded to a player who was not in the hand.
//
// Reachable in the app: START_STACK is 5000 with no rebuy and no seat removal
// (grep for rebuy/stack === 0 across src/renderer and src/core/session.ts finds
// nothing), so any villain that busts free-rolls every subsequent hand.
//
// Fixed in startHand: a busted seat is marked folded before the deal, so it is dealt
// no cards and cannot win. It posts Math.min(blind, 0) = 0 if the button reaches it.
it('a seat with 0 chips sits out: not dealt in, not eligible for the pot', () => {
  const s = startHand(table([STACK, 0, STACK, STACK], 5));

  expect(s.seats[1].hole).toEqual([]);
  expect(s.seats[1].folded).toBe(true);

  const done = playOut(s, (legal) => (legal.includes('fold') ? 'fold' : alwaysCall(legal)));
  expect(done.winners!.every((w) => w.seatId !== 1)).toBe(true); // actual: seat 1 wins 50
  expect(done.seats[1].stack).toBe(0); // actual: 50
});

// ── 9. Per-hand state reset ──────────────────────────────────────────────────

describe('startHand resets per-hand state', () => {
  it('clears committed/folded/allIn/board/winners before posting the new blinds', () => {
    // Seat 1 is short so it can be left all-in with a live `committed` on the flop.
    const start = [STACK, 300, STACK, STACK];
    let s = startHand(table(start, 3));
    expect(s.dealer).toBe(0);

    // Preflop limp round.
    s = applyAction(s, { kind: 'call' }); // seat 3
    s = applyAction(s, { kind: 'call' }); // seat 0
    s = applyAction(s, { kind: 'call' }); // seat 1 (SB) completes
    s = applyAction(s, { kind: 'check' }); // seat 2 (BB)
    expect(s.street).toBe('flop');

    // Seat 1 jams the flop, everyone folds.
    expect(s.toAct).toBe(1);
    s = applyAction(s, { kind: 'allin' });
    s = applyAction(s, { kind: 'fold' });
    s = applyAction(s, { kind: 'fold' });
    s = applyAction(s, { kind: 'fold' });
    s = settle(s);

    // Dirty state going in.
    expect(s.board.length).toBe(3);
    expect(s.seats[1].committed).toBe(250);
    expect(s.seats[1].allIn).toBe(true);
    expect(s.seats.filter((seat) => seat.folded).map((seat) => seat.id)).toEqual([0, 2, 3]);
    expect(s.winners).not.toBeNull();

    const next = startHand(s);

    expect(next.handNumber).toBe(2);
    expect(next.dealer).toBe(1);
    expect(next.street).toBe('preflop');
    expect(next.board).toEqual([]);
    expect(next.winners).toBeNull();
    expect(next.lastAggressor).toBeNull();
    expect(next.minRaise).toBe(BB);
    expect(next.seats.every((seat) => !seat.folded)).toBe(true);
    expect(next.seats.every((seat) => !seat.allIn)).toBe(true);
    expect(next.seats.every((seat) => seat.hole.length === 2)).toBe(true);

    // Committed is rebuilt from zero: only the new blinds have chips out, and the
    // seat that had 250 out last hand (now the button) is back to 0.
    expect(next.seats.map((seat) => seat.committed)).toEqual([0, 0, SB, BB]);
    expect(next.pot).toBe(SB + BB);
  });
});
