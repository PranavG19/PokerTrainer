import { describe, expect, it } from 'vitest';
import type { Card } from '../../src/core/cards.js';
import {
  createGiftLedger,
  describeGift,
  type GiftEntry,
  type ShowdownObservation,
} from '../../src/core/giftLedger.js';

// Fixtures are real showdowns with EXACT, probed heads-up equities, so every assertion is derived
// from the cards, never from a guess about behaviour:
//   - QQ vs AA on 2s7dKc9h3c (a made river) => villain equity 0 (drawing dead) — a clear gift.
//   - trips-KK vs AA on the same river       => villain equity 1 — the villain was ahead, no gift.
//   - 45h vs 23h under a royal on the board   => equity 0.5 — a chop, the break-even boundary.
//   - QQ vs AdKs on Kc7d2s (flop, two to come) => equity 0.0879 (probed) — a partial-equity gift
//     whose WINNING term (equity·potBefore) is nonzero, so it exercises callEvChips's positive side.
const DRAWING_DEAD_RIVER = ['2s', '7d', 'Kc', '9h', '3c'] as const;
const VILLAIN_QQ = ['Qh', 'Qd'] as const;
const VILLAIN_TRIP_K = ['Ks', 'Kd'] as const;
const HERO_AA = ['As', 'Ah'] as const;
const ROYAL_BOARD = ['As', 'Ks', 'Qs', 'Js', 'Ts'] as const;
// Partial-equity gift: QQ facing overcards-with-a-king on a K-high flop, two cards to come.
const KING_HIGH_FLOP = ['Kc', '7d', '2s'] as const;
const HERO_AK = ['Ad', 'Ks'] as const;

const showdown = (overrides: Partial<ShowdownObservation> = {}): ShowdownObservation => ({
  handNumber: 1,
  villainSeatId: 2,
  villainName: 'Bo',
  villainHole: [...VILLAIN_QQ],
  heroHole: [...HERO_AA],
  board: [...DRAWING_DEAD_RIVER],
  street: 'river',
  action: 'call',
  potBefore: 150,
  cost: 50,
  ...overrides,
});

describe('observe scores a -EV call from the revealed cards (O5, action-with-a-holding)', () => {
  it('records a drawing-dead call as a gift with equity, price and value all derived', () => {
    const ledger = createGiftLedger();
    const gift = ledger.observe(showdown());

    expect(gift).not.toBeNull();
    // Every number is computed from the cards and the price, not taken from the observation.
    expect(gift).toMatchObject<Partial<GiftEntry>>({
      seq: 0,
      action: 'call',
      villainHole: ['Qh', 'Qd'],
      heroHole: ['As', 'Ah'],
      villainEquity: 0, // QQ is drawing dead against AA on a made river
      breakEven: 0.25, // cost 50 into a 150 pot: 50 / (150 + 50)
      evChips: -50, // 0·150 − 1·50
      giftChips: 50,
    });
  });

  it('carries the holding and action onto the entry so a stored ledger explains itself', () => {
    const ledger = createGiftLedger();
    const gift = ledger.observe(showdown({ street: 'river', villainName: 'Cy' }))!;
    expect({ name: gift.villainName, street: gift.street, action: gift.action, board: gift.board }).toEqual({
      name: 'Cy',
      street: 'river',
      action: 'call',
      board: ['2s', '7d', 'Kc', '9h', '3c'],
    });
  });

  it('scores a partial-equity gift, exercising the winning term equity·potBefore', () => {
    const ledger = createGiftLedger();
    // QQ vs AdKs on Kc7d2s, cost 100 into a 100 pot. Villain has real but insufficient equity
    // (~8.8%, probed), so the WINNING term equity·potBefore is nonzero — inflating it flips the
    // verdict. evChips = 0.087879·100 − 0.912121·100 = −82.42; giftChips = 82.42.
    const gift = ledger.observe(
      showdown({
        villainHole: [...VILLAIN_QQ],
        heroHole: [...HERO_AK],
        board: [...KING_HIGH_FLOP],
        street: 'flop',
        potBefore: 100,
        cost: 100,
      }),
    );
    expect(gift).not.toBeNull();
    expect(gift!.villainEquity).toBeCloseTo(0.087879, 5);
    expect(gift!.breakEven).toBeCloseTo(0.5, 10);
    expect(gift!.evChips).toBeCloseTo(-82.4242, 3);
    expect(gift!.giftChips).toBeCloseTo(82.4242, 3);
  });

  it('scores an all-in call (a call for the stack) the same way', () => {
    const ledger = createGiftLedger();
    const gift = ledger.observe(showdown({ action: 'allin' }))!;
    expect(gift.action).toBe('allin');
    expect(gift.giftChips).toBe(50);
  });
});

describe('anti-inflation: the learner cannot flag a call that was not -EV', () => {
  it('returns null when the villain was actually ahead (equity 1)', () => {
    const ledger = createGiftLedger();
    const notAGift = ledger.observe(showdown({ villainHole: [...VILLAIN_TRIP_K] }));
    expect(notAGift).toBeNull();
    expect(ledger.entries()).toHaveLength(0);
  });

  it('returns null for an exactly break-even call (a chop at the right price)', () => {
    const ledger = createGiftLedger();
    // 45h vs 23h under a royal on the board is a chop (equity 0.5); at cost === potBefore the
    // break-even equity is also 0.5, so the call is worth exactly 0 chips — not a gift.
    const notAGift = ledger.observe(
      showdown({
        villainHole: ['4h', '5h'],
        heroHole: ['2h', '3h'],
        board: [...ROYAL_BOARD],
        potBefore: 100,
        cost: 100,
      }),
    );
    expect(notAGift).toBeNull();
  });

  it('does not read a -EV magnitude off the observation — there is no field to inflate', () => {
    const ledger = createGiftLedger();
    // The observation carries no evChips/giftChips; the ledger derives them. A learner passing a
    // winning holding gets nothing, whatever else is on the object.
    const spread = ledger.observe(showdown({ villainHole: [...VILLAIN_TRIP_K], cost: 5000 }));
    expect(spread).toBeNull();
  });
});

describe('only calling actions against a live bet are scored', () => {
  it.each(['fold', 'check', 'bet', 'raise'] as const)('returns null for a %s action', (action) => {
    const ledger = createGiftLedger();
    expect(ledger.observe(showdown({ action }))).toBeNull();
  });

  it('returns null for a call with nothing to call (cost 0)', () => {
    const ledger = createGiftLedger();
    expect(ledger.observe(showdown({ cost: 0 }))).toBeNull();
  });
});

describe('append-only structure (O5): the only writer is observe', () => {
  it('exposes no add, edit, delete or set method', () => {
    const ledger = createGiftLedger();
    const keys = Object.keys(ledger).sort();
    expect(keys).toEqual(['entries', 'forVillain', 'observe', 'villains']);
  });

  it('has no callable property beyond the sanctioned four, even a non-enumerable one', () => {
    const ledger = createGiftLedger();
    // Object.keys misses a non-enumerable writer injected via defineProperty. Walk every own
    // property name (enumerable or not, own or inherited) and require the callable set to be exactly
    // the sanctioned four — so a hidden `inject`/`push`/`set` writer is caught, not just an
    // enumerable one.
    const asRecord = ledger as unknown as Record<string, unknown>;
    const callableNames = new Set<string>();
    for (let obj: object | null = ledger; obj && obj !== Object.prototype; obj = Object.getPrototypeOf(obj)) {
      for (const name of Object.getOwnPropertyNames(obj)) {
        if (typeof asRecord[name] === 'function') callableNames.add(name);
      }
    }
    expect([...callableNames].sort()).toEqual(['entries', 'forVillain', 'observe', 'villains']);
  });

  it('freezes each entry, its nested card arrays, and returns a frozen copy of the log', () => {
    const ledger = createGiftLedger();
    const gift = ledger.observe(showdown())!;
    expect(Object.isFrozen(gift)).toBe(true);
    // The card arrays hang off the entry; if they are not frozen too, a caller holding the entry can
    // rewrite the villain's holding or the board after the fact and re-narrate the gift.
    expect(Object.isFrozen(gift.villainHole)).toBe(true);
    expect(Object.isFrozen(gift.heroHole)).toBe(true);
    expect(Object.isFrozen(gift.board)).toBe(true);
    expect(() => (gift.villainHole as Card[]).push('2c')).toThrow();
    expect(() => (gift.heroHole as Card[]).push('2c')).toThrow();
    expect(() => (gift.board as Card[]).push('2c')).toThrow();
    const list = ledger.entries();
    expect(Object.isFrozen(list)).toBe(true);
  });

  it('a mutation of a returned list cannot reach ledger state', () => {
    const ledger = createGiftLedger();
    ledger.observe(showdown());
    const list = ledger.entries() as GiftEntry[];
    expect(() => list.push({} as GiftEntry)).toThrow(); // frozen array rejects the push
    expect(ledger.entries()).toHaveLength(1);
  });

  it('assigns monotonic seq in append order', () => {
    const ledger = createGiftLedger();
    ledger.observe(showdown({ handNumber: 1 }));
    ledger.observe(showdown({ handNumber: 2 }));
    expect(ledger.entries().map((entry) => entry.seq)).toEqual([0, 1]);
  });
});

describe('grouping and rehydration', () => {
  it('filters gifts by villain and lists villains in first-gift order', () => {
    const ledger = createGiftLedger();
    ledger.observe(showdown({ villainSeatId: 5, villainName: 'Ed' }));
    ledger.observe(showdown({ villainSeatId: 2, villainName: 'Bo' }));
    ledger.observe(showdown({ villainSeatId: 5, villainName: 'Ed' }));
    expect(ledger.villains()).toEqual([5, 2]);
    expect(ledger.forVillain(5)).toHaveLength(2);
    expect(ledger.forVillain(2)).toHaveLength(1);
  });

  it('continues seq from a rehydrated prior log without reaching the original', () => {
    const first = createGiftLedger();
    const prior = [first.observe(showdown())!];
    const second = createGiftLedger(prior);
    const next = second.observe(showdown({ handNumber: 2 }))!;
    expect(next.seq).toBe(1);
    // The prior array is copied in, so the rehydrated ledger is independent of the original.
    expect(first.entries()).toHaveLength(1);
    expect(second.entries()).toHaveLength(2);
  });
});

describe('malformed observations are caller bugs, not silent mis-scores', () => {
  it('throws on a villain holding that is not two cards', () => {
    const ledger = createGiftLedger();
    expect(() => ledger.observe(showdown({ villainHole: ['Qh'] }))).toThrow(/villainHole/);
  });

  it('throws on a hero holding that is not two cards', () => {
    const ledger = createGiftLedger();
    // The hero holding is validated too — the gift is measured against it, so a malformed heroHole
    // would silently mis-score rather than being a scored gift.
    expect(() => ledger.observe(showdown({ heroHole: ['As'] }))).toThrow(/heroHole/);
  });

  it('throws on a board of more than five cards', () => {
    const ledger = createGiftLedger();
    // A hold'em board is at most five cards; six is an impossible showdown, not a spot to score.
    expect(() =>
      ledger.observe(showdown({ board: ['2s', '7d', 'Kc', '9h', '3c', '4d'] })),
    ).toThrow(/at most 5|6 cards/);
  });

  it('throws on a card that appears in two places', () => {
    const ledger = createGiftLedger();
    // Villain and hero both holding As is an impossible showdown.
    expect(() => ledger.observe(showdown({ villainHole: ['As', 'Qd'] }))).toThrow(/twice/);
  });
});

describe('describeGift renders action-with-a-holding form', () => {
  it('names the villain, the holding, the board, the price and the value', () => {
    const ledger = createGiftLedger();
    const gift = ledger.observe(showdown())!;
    expect(describeGift(gift)).toBe(
      'Bo called with QhQd on 2s7dKc9h3c vs AsAh — 0% equity, needed 25% (gift 50 chips)',
    );
  });
});
