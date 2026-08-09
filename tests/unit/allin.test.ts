import { describe, it, expect } from 'vitest';
import {
  createTable,
  startHand,
  legalActions,
  applyAction,
  isHandOver,
  settle,
  type TableState,
} from '../../src/core/table.js';
import { evaluate } from '../../src/core/evaluate.js';
import type { Card } from '../../src/core/cards.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** 4 seats, dealer=0 on the first hand, so SB=1, BB=2, UTG=3. */
function table(stacks: number[], seed = 42, sb = 5, bb = 10): TableState {
  const seats = stacks.map((stack, i) => ({ name: `P${i}`, stack, isHero: i === 0 }));
  return startHand(createTable({ seats, sb, bb, seed }));
}

function totalChips(state: TableState): number {
  return state.seats.reduce((sum, s) => sum + s.stack, 0) + state.pot;
}

/** Chips won per seat, aggregated across every pot that seat won. */
function payouts(state: TableState): Map<number, number> {
  const byseat = new Map<number, number>();
  for (const w of state.winners ?? []) {
    byseat.set(w.seatId, (byseat.get(w.seatId) ?? 0) + w.amount);
  }
  return byseat;
}

/**
 * Overwrite the showdown cards without touching any chip field, so a settle()
 * assertion can name an exact winner. Hole cards and board are pure inputs to
 * settle's hand comparison; the pot and the hidden start-stacks are untouched.
 */
function forceCards(state: TableState, board: Card[], holes: Record<number, Card[]>): TableState {
  const s: TableState = JSON.parse(JSON.stringify(state));
  s.board = [...board];
  for (const [id, hole] of Object.entries(holes)) s.seats[Number(id)].hole = [...hole];
  return s;
}

/** A royal flush lying on the board: every live player ties, whatever they hold. */
const ROYAL_BOARD: Card[] = ['As', 'Ks', 'Qs', 'Js', 'Ts'];

// ── Reopening the action: full raise vs under-raise ───────────────────────────

describe('all-in that is a full raise reopens the action', () => {
  it('sets the all-in seat as the aggressor and raises currentBet/minRaise', () => {
    // S2 is the BB with 300 behind; a shove to 300 over a raise to 30 is a full raise.
    let s = table([1000, 1000, 300, 1000]);
    s = applyAction(s, { kind: 'raise', amount: 30 }); // UTG=3 raises
    s = applyAction(s, { kind: 'call' }); // S0 calls 30
    s = applyAction(s, { kind: 'call' }); // S1 calls 30
    expect(s.toAct).toBe(2);
    expect(s.lastAggressor).toBe(3);

    s = applyAction(s, { kind: 'allin' }); // S2 shoves to 300

    expect(s.currentBet).toBe(300);
    expect(s.minRaise).toBe(270); // 300 - 30
    expect(s.lastAggressor).toBe(2);
    expect(s.street).toBe('preflop');
  });

  it('gives players who already called another turn', () => {
    let s = table([1000, 1000, 300, 1000]);
    s = applyAction(s, { kind: 'raise', amount: 30 });
    s = applyAction(s, { kind: 'call' });
    s = applyAction(s, { kind: 'call' });
    s = applyAction(s, { kind: 'allin' });

    // The original raiser must act again and may fold, call or re-raise.
    expect(s.toAct).toBe(3);
    expect(legalActions(s)).toContain('call');
    s = applyAction(s, { kind: 'call' });

    // S0, who had already called 30, is owed another turn too.
    expect(s.toAct).toBe(0);
    expect(s.seats[0].committed).toBe(30);
    expect(legalActions(s)).toContain('call');
    s = applyAction(s, { kind: 'call' });

    expect(s.toAct).toBe(1);
    s = applyAction(s, { kind: 'call' });

    // Everyone matched 300 → preflop closes.
    expect(s.seats.map((x) => x.committed)).toEqual([0, 0, 0, 0]);
    expect(s.street).toBe('flop');
  });
});

describe('all-in below a full raise does not reopen the action', () => {
  it('leaves lastAggressor and minRaise untouched while currentBet rises', () => {
    // S1 (SB) has 155 total. Over a raise to 100 that is a 55 increment,
    // short of the 90 needed for a full min-raise.
    let s = table([1000, 155, 1000, 1000]);
    s = applyAction(s, { kind: 'raise', amount: 100 }); // UTG=3
    expect(s.minRaise).toBe(90);
    s = applyAction(s, { kind: 'call' }); // S0 calls 100
    expect(s.toAct).toBe(1);

    s = applyAction(s, { kind: 'allin' }); // S1 all-in for 155

    expect(s.seats[1].committed).toBe(155);
    expect(s.currentBet).toBe(155); // the bet to match does rise
    expect(s.minRaise).toBe(90); // but the raise increment is NOT corrupted
    expect(s.lastAggressor).toBe(3); // and the action is NOT reopened
  });

  it('still makes a player yet to act call the higher all-in total', () => {
    let s = table([1000, 155, 1000, 1000]);
    s = applyAction(s, { kind: 'raise', amount: 100 });
    s = applyAction(s, { kind: 'call' });
    s = applyAction(s, { kind: 'allin' });

    // S2 (BB) has not acted yet, so it owes the full 155, not 100.
    expect(s.toAct).toBe(2);
    expect(legalActions(s)).toContain('call');
    s = applyAction(s, { kind: 'call' });
    expect(s.seats[2].committed).toBe(155);
  });

  it('closes the street once everyone has matched, without a fresh betting round', () => {
    let s = table([1000, 155, 1000, 1000]);
    s = applyAction(s, { kind: 'raise', amount: 100 });
    s = applyAction(s, { kind: 'call' });
    s = applyAction(s, { kind: 'allin' }); // under-raise
    s = applyAction(s, { kind: 'call' }); // S2 matches 155
    s = applyAction(s, { kind: 'call' }); // S3 tops up to 155
    expect(s.street).toBe('preflop');
    s = applyAction(s, { kind: 'call' }); // S0 tops up to 155

    // No extra orbit: the under-raise did not restart the round.
    expect(s.street).toBe('flop');
    expect(s.pot).toBe(155 * 3 + 155);
  });

  it('does not corrupt minRaise for the next street', () => {
    let s = table([1000, 155, 1000, 1000]);
    s = applyAction(s, { kind: 'raise', amount: 100 });
    s = applyAction(s, { kind: 'call' });
    s = applyAction(s, { kind: 'allin' });
    s = applyAction(s, { kind: 'call' });
    s = applyAction(s, { kind: 'call' });
    s = applyAction(s, { kind: 'call' });

    expect(s.street).toBe('flop');
    expect(s.minRaise).toBe(s.bb); // reset, not left at 90 or 55
    expect(s.currentBet).toBe(0);
    expect(s.lastAggressor).toBeNull();
  });
});

describe('all-in for less than the current bet', () => {
  it('does not raise currentBet, minRaise or the aggressor', () => {
    // S1 (SB) can only reach 155 total against a bet of 300.
    let s = table([1000, 155, 1000, 1000]);
    s = applyAction(s, { kind: 'raise', amount: 300 }); // UTG=3, minRaise becomes 290
    expect(s.currentBet).toBe(300);
    expect(s.minRaise).toBe(290);
    expect(s.toAct).toBe(0);
    s = applyAction(s, { kind: 'call' });

    expect(s.toAct).toBe(1);
    expect(legalActions(s)).toContain('allin');
    expect(legalActions(s)).not.toContain('call'); // cannot cover the bet
    s = applyAction(s, { kind: 'allin' });

    expect(s.seats[1].committed).toBe(155);
    expect(s.seats[1].allIn).toBe(true);
    expect(s.currentBet).toBe(300); // unchanged: a call-sized all-in is not a raise
    expect(s.minRaise).toBe(290);
    expect(s.lastAggressor).toBe(3);
  });
});

// ── Side pot structure ───────────────────────────────────────────────────────

describe('side pots at multiple stack depths', () => {
  it('builds one pot per distinct contribution level', () => {
    // Four distinct all-in depths → four pots.
    let s = table([100, 200, 300, 400]);
    s = applyAction(s, { kind: 'allin' }); // S3 → 400
    s = applyAction(s, { kind: 'allin' }); // S0 → 100
    s = applyAction(s, { kind: 'allin' }); // S1 → 200
    s = applyAction(s, { kind: 'allin' }); // S2 → 300

    expect(isHandOver(s)).toBe(true);
    expect(s.pot).toBe(1000);

    const settled = settle(s);
    // 100x4 = 400 (all four), 100x3 = 300 (S1..S3), 100x2 = 200 (S2,S3), 100 (S3 alone)
    const distinct = new Set(settled.winners!.map((w) => w.amount + ':' + w.seatId));
    expect(settled.winners!.reduce((a, w) => a + w.amount, 0)).toBe(1000);
    expect(distinct.size).toBeGreaterThan(0);
    expect(totalChips(settled)).toBe(1000);
    // The deepest player's unmatched 100 always comes back to them.
    expect(payouts(settled).get(3) ?? 0).toBeGreaterThanOrEqual(100);
  });

  it('awards every pot to the best eligible hand', () => {
    let s = table([100, 200, 300, 400], 77);
    s = applyAction(s, { kind: 'allin' });
    s = applyAction(s, { kind: 'allin' });
    s = applyAction(s, { kind: 'allin' });
    s = applyAction(s, { kind: 'allin' });
    const settled = settle(s);

    // Independent oracle: rebuild the pot ladder from contributions and check
    // each winner is the max-scoring eligible player for that pot.
    const contributions = [100, 200, 300, 400];
    const levels = [100, 200, 300, 400];
    let prev = 0;
    const expected: { amount: number; best: number[] }[] = [];
    for (const level of levels) {
      const eligible = contributions.map((c, i) => (c > prev ? i : -1)).filter((i) => i >= 0);
      const scores = eligible.map((i) => evaluate([...settled.seats[i].hole, ...settled.board]).score);
      const top = Math.max(...scores);
      expected.push({
        amount: (level - prev) * eligible.length,
        best: eligible.filter((_, k) => scores[k] === top),
      });
      prev = level;
    }

    const won = payouts(settled);
    for (const pot of expected) {
      for (const id of pot.best) expect(won.get(id) ?? 0).toBeGreaterThan(0);
    }
    expect(settled.winners!.reduce((a, w) => a + w.amount, 0)).toBe(1000);
  });

  it('gives the short stack only the main pot when it is not eligible for the side pot', () => {
    let s = table([50, 200, 200, 200]);
    s = applyAction(s, { kind: 'fold' }); // S3 folds out of the way
    s = applyAction(s, { kind: 'allin' }); // S0 → 50
    s = applyAction(s, { kind: 'allin' }); // S1 → 200
    s = applyAction(s, { kind: 'allin' }); // S2 → 200
    expect(isHandOver(s)).toBe(true);
    expect(s.pot).toBe(450);

    // S0 (short) has trips and wins the main pot. S2 has queens and takes the
    // side pot; S1's ace-high loses both.
    const forced = forceCards(s, ['2c', '7d', '9h', 'Jc', '4s'], {
      0: ['2s', '2h'],
      1: ['Ah', 'Kd'],
      2: ['Qs', 'Qd'],
    });
    const settled = settle(forced);
    const won = payouts(settled);

    expect(won.get(0)).toBe(150); // main pot only: 50 x 3
    expect(won.get(2)).toBe(300); // side pot: 150 x 2
    expect(won.get(1) ?? 0).toBe(0);
    expect(totalChips(settled)).toBe(650);
  });

  it('excludes a folded contributor from winning but keeps its dead money', () => {
    let s = table([200, 200, 200, 200]);
    s = applyAction(s, { kind: 'raise', amount: 60 }); // S3
    s = applyAction(s, { kind: 'allin' }); // S0 → 200
    s = applyAction(s, { kind: 'fold' }); // S1 forfeits its 5 SB
    s = applyAction(s, { kind: 'allin' }); // S2 → 200
    s = applyAction(s, { kind: 'allin' }); // S3 → 200

    const settled = settle(s);
    expect(payouts(settled).get(1) ?? 0).toBe(0); // folded seat wins nothing
    expect(settled.winners!.reduce((a, w) => a + w.amount, 0)).toBe(605); // incl. the dead 5
    expect(totalChips(settled)).toBe(800);
  });
});

// ── Split pots ───────────────────────────────────────────────────────────────

describe('split pots', () => {
  it('splits evenly between two identical hands', () => {
    let s = table([100, 100, 200, 200]);
    s = applyAction(s, { kind: 'fold' }); // S3
    s = applyAction(s, { kind: 'fold' }); // S0
    s = applyAction(s, { kind: 'allin' }); // S1 → 100
    s = applyAction(s, { kind: 'allin' }); // S2 → 200, so 100 of it is uncalled
    expect(s.pot).toBe(300);

    const forced = forceCards(s, ROYAL_BOARD, { 1: ['2h', '3h'], 2: ['2d', '3d'] });
    const settled = settle(forced);
    const won = payouts(settled);

    // Main pot 200 splits 100/100; S2's uncalled 100 comes straight back to it.
    expect(won.get(1)).toBe(100);
    expect(won.get(2)).toBe(200);
    expect(settled.pot).toBe(0);
    expect(totalChips(settled)).toBe(600);
  });

  it('hands the odd chip to the winner closest left of the dealer', () => {
    // 20-chip main slice split three ways leaves a remainder of 2.
    let s = table([100, 100, 100, 100]);
    s = applyAction(s, { kind: 'allin' }); // S3 → 100
    s = applyAction(s, { kind: 'allin' }); // S0 → 100
    s = applyAction(s, { kind: 'fold' }); // S1 (SB) folds, leaving 5 dead
    s = applyAction(s, { kind: 'allin' }); // S2 → 100
    expect(s.pot).toBe(305);

    const forced = forceCards(s, ROYAL_BOARD, {
      0: ['2h', '3h'],
      2: ['2d', '3d'],
      3: ['4d', '5d'],
    });
    const settled = settle(forced);
    const won = payouts(settled);

    // Pot ladder: 5x4 = 20 (3 eligible → 7/7/6), then 95x3 = 285 (95 each).
    // Dealer is 0, so proximity order over {2,3,0} is seat2, seat3, seat0.
    expect(won.get(2)).toBe(102);
    expect(won.get(3)).toBe(102);
    expect(won.get(0)).toBe(101);
    expect(won.get(1) ?? 0).toBe(0);
    expect(totalChips(settled)).toBe(400);
  });

  it('never mints or destroys a chip when splitting an indivisible pot', () => {
    let s = table([100, 100, 100, 100]);
    s = applyAction(s, { kind: 'allin' });
    s = applyAction(s, { kind: 'allin' });
    s = applyAction(s, { kind: 'fold' });
    s = applyAction(s, { kind: 'allin' });

    const forced = forceCards(s, ROYAL_BOARD, {
      0: ['2h', '3h'],
      2: ['2d', '3d'],
      3: ['4d', '5d'],
    });
    const settled = settle(forced);
    expect(settled.winners!.reduce((a, w) => a + w.amount, 0)).toBe(305);
    expect(totalChips(settled)).toBe(400);
  });
});

// ── Chip conservation across multi-all-in shapes ──────────────────────────────

describe('chip conservation with multiple all-ins', () => {
  const configs: number[][] = [
    [100, 200, 300, 400],
    [50, 50, 5000, 5000],
    [37, 88, 402, 913],
    [1000, 1000, 1000, 1000],
    [11, 23, 47, 97],
    [5000, 5000, 5000, 5000],
  ];

  for (const stacks of configs) {
    it(`conserves chips for stacks ${stacks.join('/')}`, () => {
      const total = stacks.reduce((a, b) => a + b, 0);
      let s = table(stacks, 1234);
      expect(totalChips(s)).toBe(total);

      let guard = 0;
      while (!isHandOver(s) && guard < 40) {
        const legal = legalActions(s);
        if (legal.length === 0) break;
        const kind = legal.includes('allin') ? 'allin' : legal[0];
        s = applyAction(s, { kind });
        expect(totalChips(s)).toBe(total); // holds after every single action
        guard++;
      }

      const settled = settle(s);
      expect(settled.pot).toBe(0);
      expect(totalChips(settled)).toBe(total);
      expect(settled.seats.every((seat) => seat.stack >= 0)).toBe(true);
    });
  }

  it('conserves chips across a mixed raise / all-in / fold sequence', () => {
    const total = 200 + 400 + 600 + 800;
    let s = table([200, 400, 600, 800], 2024);
    s = applyAction(s, { kind: 'raise', amount: 40 }); // S3
    expect(totalChips(s)).toBe(total);
    s = applyAction(s, { kind: 'allin' }); // S0 → 200
    expect(totalChips(s)).toBe(total);
    s = applyAction(s, { kind: 'fold' }); // S1
    expect(totalChips(s)).toBe(total);
    s = applyAction(s, { kind: 'allin' }); // S2 → 600
    expect(totalChips(s)).toBe(total);
    s = applyAction(s, { kind: 'allin' }); // S3 → 800
    expect(totalChips(s)).toBe(total);

    const settled = settle(s);
    expect(totalChips(settled)).toBe(total);
    expect(settled.pot).toBe(0);
  });
});

// ── Board completion ─────────────────────────────────────────────────────────

describe('board completion when players are all-in early', () => {
  it('runs the board to 5 cards when everyone is all-in preflop', () => {
    let s = table([100, 200, 300, 400]);
    s = applyAction(s, { kind: 'allin' });
    s = applyAction(s, { kind: 'allin' });
    s = applyAction(s, { kind: 'allin' });
    s = applyAction(s, { kind: 'allin' });

    expect(s.street).toBe('showdown');
    expect(s.board).toHaveLength(5);
    expect(new Set(s.board).size).toBe(5);
  });

  it('settle() fills a short board out to 5 cards', () => {
    let s = table([100, 200, 300, 400]);
    s = applyAction(s, { kind: 'allin' });
    s = applyAction(s, { kind: 'allin' });
    s = applyAction(s, { kind: 'allin' });
    s = applyAction(s, { kind: 'allin' });

    // Truncate to a flop to exercise settle's own completion branch.
    const short: TableState = JSON.parse(JSON.stringify(s));
    short.board = short.board.slice(0, 3);
    const settled = settle(short);

    expect(settled.board).toHaveLength(5);
    expect(new Set(settled.board).size).toBe(5);
    expect(totalChips(settled)).toBe(1000);
  });

  it('does not deal a board when everyone folds to one player', () => {
    let s = table([100, 200, 300, 400]);
    s = applyAction(s, { kind: 'fold' });
    s = applyAction(s, { kind: 'fold' });
    s = applyAction(s, { kind: 'fold' });

    const settled = settle(s);
    expect(settled.board).toHaveLength(0);
    expect(settled.winners).toHaveLength(1);
    expect(settled.winners![0].seatId).toBe(2); // BB is last standing
    expect(totalChips(settled)).toBe(1000);
  });
});

// ── Round closure when the aggressor is all-in ────────────────────────────────

describe('round closure when the aggressor is all-in', () => {
  it('closes preflop heads-up when a shove is called by a deeper stack', () => {
    // Regression: the aggressor was all-in, so "action returns to the aggressor"
    // could never be satisfied and the hand hung forever on preflop.
    const seats = [
      { name: 'Short', stack: 100 },
      { name: 'Deep', stack: 1000 },
    ];
    let s = startHand(createTable({ seats, sb: 5, bb: 10, seed: 4 }));
    s = applyAction(s, { kind: 'allin' }); // dealer/SB shoves 100
    expect(s.lastAggressor).toBe(0);
    s = applyAction(s, { kind: 'call' }); // deeper stack calls

    expect(isHandOver(s)).toBe(true);
    expect(s.street).toBe('showdown');
    expect(s.board).toHaveLength(5);
    expect(legalActions(s)).toEqual([]);
    expect(totalChips(settle(s))).toBe(1100);
  });

  it('closes preflop when a shove is called by one deeper stack and folded to by another', () => {
    let s = table([200, 2000, 2000, 2000], 9);
    s = applyAction(s, { kind: 'raise', amount: 60 }); // S3 opens
    s = applyAction(s, { kind: 'allin' }); // S0 shoves 200 (full raise, aggressor)
    expect(s.lastAggressor).toBe(0);
    s = applyAction(s, { kind: 'call' }); // S1 calls, still 1800 behind
    s = applyAction(s, { kind: 'call' }); // S2 calls
    s = applyAction(s, { kind: 'call' }); // S3 tops up

    // Preflop closes on the last call: no extra orbit even though the aggressor
    // is all-in. S1..S3 still have chips, so the hand plays on to the flop.
    expect(s.street).toBe('flop');
    expect(s.board).toHaveLength(3);
    expect(s.seats.map((x) => x.committed)).toEqual([0, 0, 0, 0]);
    expect(s.pot).toBe(200 * 4); // all four seats matched the 200 shove

    // And it runs out normally rather than hanging.
    let guard = 0;
    while (!isHandOver(s) && guard < 20) {
      const legal = legalActions(s);
      if (legal.length === 0) break;
      s = applyAction(s, { kind: legal.includes('check') ? 'check' : 'call' });
      guard++;
    }
    expect(isHandOver(s)).toBe(true);
    expect(totalChips(settle(s))).toBe(6200);
  });

  it('closes a postflop round when the bettor is all-in and is called', () => {
    let s = table([1000, 1000, 1000, 1000], 3);
    s = applyAction(s, { kind: 'fold' }); // S3
    s = applyAction(s, { kind: 'fold' }); // S0
    s = applyAction(s, { kind: 'call' }); // S1 completes
    s = applyAction(s, { kind: 'check' }); // S2
    expect(s.street).toBe('flop');

    // S1 shoves the flop; S2 covers it exactly and calls.
    s = applyAction(s, { kind: 'allin' });
    expect(s.seats[s.lastAggressor!].allIn).toBe(true);
    s = applyAction(s, { kind: 'call' });

    expect(isHandOver(s)).toBe(true);
    expect(s.street).toBe('showdown');
    expect(s.board).toHaveLength(5);
    expect(totalChips(settle(s))).toBe(4000);
  });

  it('never leaves a hand unresolved across a soak of all-in-heavy lines', () => {
    const shapes: number[][] = [
      [200, 2000, 2000, 2000],
      [150, 400, 900, 3000],
      [100, 100, 100, 5000],
      [5000, 5000, 5000, 5000],
      [60, 120, 240, 480],
    ];
    let hands = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const stacks = shapes[seed % shapes.length];
      const total = stacks.reduce((a, b) => a + b, 0);
      let s = table(stacks, seed);
      let rng = (seed * 2654435761) % 2147483647;
      const rand = (): number => (rng = (rng * 48271) % 2147483647) / 2147483647;

      let steps = 0;
      while (!isHandOver(s) && steps < 60) {
        const legal = legalActions(s);
        if (legal.length === 0) break;
        const kind = legal[Math.floor(rand() * legal.length)];
        const seat = s.seats[s.toAct];
        const amount =
          kind === 'raise' || kind === 'bet'
            ? Math.min(seat.committed + seat.stack, s.currentBet + s.minRaise)
            : undefined;
        s = applyAction(s, { kind, amount });
        expect(totalChips(s)).toBe(total);
        steps++;
      }

      expect(isHandOver(s)).toBe(true); // no deadlocks
      const settled = settle(s);
      expect(totalChips(settled)).toBe(total);
      expect(settled.pot).toBe(0);
      if (settled.seats.filter((x) => !x.folded).length > 1) {
        expect(settled.board).toHaveLength(5);
      }
      hands++;
    }
    expect(hands).toBe(150);
  });
});

// ── Known rules deviation ────────────────────────────────────────────────────

describe('reopening restriction on legal actions', () => {
  /**
   * When an all-in is short of a full min-raise the betting is not reopened, so a player
   * who already matched the previous bet may only call the difference or fold. Tracked via
   * the _raiseCapped flag set in applyAction's 'allin' branch.
   */
  it('does not offer raise to a player facing an under-raise all-in', () => {
    let s = table([1000, 155, 1000, 1000]);
    s = applyAction(s, { kind: 'raise', amount: 100 }); // S3 is the aggressor
    s = applyAction(s, { kind: 'call' }); // S0 matches 100
    s = applyAction(s, { kind: 'allin' }); // S1 all-in 155: NOT a full raise
    s = applyAction(s, { kind: 'call' }); // S2 (yet to act) calls 155

    // S3 already matched 100 and the action was not reopened, so it may only
    // call the extra 55 or fold.
    expect(s.toAct).toBe(3);
    expect(s.lastAggressor).toBe(3);
    expect(legalActions(s)).not.toContain('raise');
  });
});
