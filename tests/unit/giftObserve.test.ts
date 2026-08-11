import { describe, expect, it } from 'vitest';
import type { Card } from '../../src/core/cards.js';
import type { ActionKind, Seat, TableState } from '../../src/core/table.js';
import { createGiftLedger } from '../../src/core/giftLedger.js';
import { isCallingAction, recordHandGifts, type VillainCall } from '../../src/core/giftObserve.js';

/**
 * recordHandGifts decides OBSERVABILITY — which captured villain calls the showdown actually
 * revealed — and delegates the -EV verdict to giftLedger.observe. The fixtures reuse the ledger
 * test's probed equities so every assertion is derived from the cards:
 *   - QQ vs AA on 2s7dKc9h3c => villain drawing dead (equity 0) — a clear gift when revealed.
 *   - trips-KK vs AA on the same river => villain ahead (equity 1) — never a gift.
 */

const DRAWING_DEAD_RIVER = ['2s', '7d', 'Kc', '9h', '3c'] as const;
const VILLAIN_QQ: readonly Card[] = ['Qh', 'Qd'];
const HERO_AA: readonly Card[] = ['As', 'Ah'];

const seat = (over: Partial<Seat> & Pick<Seat, 'id'>): Seat => ({
  id: over.id,
  name: over.name ?? `S${over.id}`,
  stack: over.stack ?? 1000,
  hole: over.hole ?? [],
  committed: over.committed ?? 0,
  folded: over.folded ?? false,
  allIn: over.allIn ?? false,
  isHero: over.isHero ?? over.id === 0,
  avatar: over.avatar ?? 'S',
});

/** A settled river showdown: hero seat 0 with AA, villain seat 2 with QQ, both revealed. */
const settledShowdown = (overrides: Partial<Seat>[] = []): TableState => {
  const seats: Seat[] = [
    seat({ id: 0, hole: [...HERO_AA], isHero: true }),
    seat({ id: 1, folded: true }),
    seat({ id: 2, name: 'Bo', hole: [...VILLAIN_QQ] }),
    seat({ id: 3, folded: true }),
  ];
  for (const o of overrides) {
    if (o.id !== undefined) seats[o.id] = seat({ ...seats[o.id], ...o, id: o.id });
  }
  return {
    seats,
    board: [...DRAWING_DEAD_RIVER],
    street: 'showdown',
    pot: 0,
    currentBet: 0,
    minRaise: 0,
    toAct: 0,
    dealer: 0,
    sb: 25,
    bb: 50,
    deck: [],
    handNumber: 1,
    lastAggressor: null,
    log: [],
    winners: [{ seatId: 0, amount: 300, description: 'Pair' }],
  };
};

const call = (over: Partial<VillainCall> = {}): VillainCall => ({
  handNumber: 1,
  villainSeatId: 2,
  villainName: 'Bo',
  action: 'call',
  board: [...DRAWING_DEAD_RIVER],
  street: 'river',
  potBefore: 150,
  cost: 50,
  ...over,
});

describe('recordHandGifts — observability, then delegated scoring', () => {
  it('records a revealed drawing-dead call as a gift', () => {
    const ledger = createGiftLedger();
    const added = recordHandGifts(ledger, settledShowdown(), [call()]);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ villainSeatId: 2, villainEquity: 0, giftChips: 50 });
    expect(ledger.entries()).toHaveLength(1);
  });

  it('drops a call by a villain who folded before showdown — the holding was never revealed', () => {
    const ledger = createGiftLedger();
    // Same captured call, but seat 2 folded a later street: its cards were face-down, so O5 says the
    // learner did not observe the mistake and it is not a gift.
    const added = recordHandGifts(ledger, settledShowdown([{ id: 2, folded: true }]), [call()]);
    expect(added).toEqual([]);
    expect(ledger.entries()).toEqual([]);
  });

  it('drops every call when the hand did not reach showdown (winners set by a fold-out is not enough)', () => {
    const ledger = createGiftLedger();
    const foldOut = { ...settledShowdown(), winners: null } as TableState;
    expect(recordHandGifts(ledger, foldOut, [call()])).toEqual([]);
  });

  it('drops every call when the hero folded — the learner saw nothing about the villain vs them', () => {
    const ledger = createGiftLedger();
    const heroFolded = settledShowdown([{ id: 0, folded: true }]);
    expect(recordHandGifts(ledger, heroFolded, [call()])).toEqual([]);
  });

  it('does not score a break-even-or-better revealed call (delegated to the ledger)', () => {
    const ledger = createGiftLedger();
    // Villain seat 2 now holds trip kings, which beat AA on this river: equity 1, no gift.
    const villainAhead = settledShowdown([{ id: 2, hole: ['Ks', 'Kd'] as Card[] }]);
    expect(recordHandGifts(ledger, villainAhead, [call()])).toEqual([]);
  });

  it('scores several calls in one hand independently', () => {
    const ledger = createGiftLedger();
    // Two villains both drawing dead against AA on the same river — seat 3 also revealed.
    const twoLive = settledShowdown([{ id: 3, name: 'Cy', hole: ['Qs', 'Qc'] as Card[], folded: false }]);
    const added = recordHandGifts(ledger, twoLive, [
      call({ villainSeatId: 2, villainName: 'Bo' }),
      call({ villainSeatId: 3, villainName: 'Cy' }),
    ]);
    expect(added).toHaveLength(2);
    expect(added.map((g) => g.villainName)).toEqual(['Bo', 'Cy']);
  });

  it('isCallingAction admits only call and allin', () => {
    expect((['call', 'allin'] as ActionKind[]).map(isCallingAction)).toEqual([true, true]);
    expect((['fold', 'check', 'bet', 'raise'] as ActionKind[]).map(isCallingAction)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});
