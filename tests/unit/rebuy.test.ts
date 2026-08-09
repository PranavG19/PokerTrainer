import { describe, it, expect } from 'vitest';
import type { HandRecord, SessionState } from '../../src/core/session.js';
import {
  DEFAULT_BANKROLL,
  computeStats,
  deserialize,
  emptySession,
  rebuy,
  recordHand,
  serialize,
} from '../../src/core/session.js';

/**
 * MID-SESSION REBUY — session accounting.
 *
 * The rule under test: a rebuy counts itself and does NOT touch the bankroll. `bankroll` is total
 * net worth (pocket + chips on the table), so moving 5000 from pocket to table is an internal
 * transfer. The 5000 left the bankroll already, hand by hand, as it was lost — that is what emptied
 * the stack. Debiting again would charge the player twice for the same chips.
 *
 * The invariant that must hold: no free value. After N bust-and-rebuy cycles the player is down
 * exactly N * START_STACK, never up. That is asserted directly below rather than argued.
 */

const START_STACK = 5000;

function hand(overrides: Partial<HandRecord> = {}): HandRecord {
  return {
    handNumber: 1,
    hole: ['As', 'Kd'],
    board: ['2c', '7h', 'Ts', '3d', 'Jc'],
    net: 0,
    vpip: false,
    pfr: false,
    grades: [],
    ...overrides,
  };
}

/** One full bust: the hero loses their whole table stack, then tops up. */
function bustAndRebuy(state: SessionState, handNumber: number): SessionState {
  return rebuy(recordHand(state, hand({ handNumber, net: -START_STACK })));
}

describe('rebuy counter', () => {
  it('starts at zero on a fresh session', () => {
    expect(emptySession().rebuys).toBe(0);
  });

  it('increments by one per call', () => {
    expect(rebuy(emptySession()).rebuys).toBe(1);
    expect(rebuy(rebuy(emptySession())).rebuys).toBe(2);
    expect(rebuy(rebuy(rebuy(emptySession()))).rebuys).toBe(3);
  });

  it('is pure: the input state is untouched', () => {
    const before = emptySession();
    const snapshot = JSON.stringify(before);
    rebuy(before);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(before.rebuys).toBe(0);
  });

  it('returns a new object rather than the same reference', () => {
    const before = emptySession();
    expect(rebuy(before)).not.toBe(before);
  });

  it('changes nothing except the counter', () => {
    const played = recordHand(
      emptySession(),
      hand({ net: -START_STACK, grades: [{ severity: 'notable', principle: 'pot odds', evLossBb: 1 }] }),
    );
    expect(rebuy(played)).toEqual({ ...played, rebuys: played.rebuys + 1 });
  });
});

describe('rebuy accounting rule', () => {
  it('leaves the bankroll unchanged', () => {
    const played = recordHand(emptySession(), hand({ net: -START_STACK }));
    expect(played.bankroll).toBe(DEFAULT_BANKROLL - START_STACK);
    expect(rebuy(played).bankroll).toBe(DEFAULT_BANKROLL - START_STACK);
  });

  it('leaves every recorded stat and the hand log unchanged', () => {
    const played = recordHand(
      emptySession(),
      hand({ net: -START_STACK, vpip: true, pfr: true, grades: [{ severity: 'serious', principle: 'pot odds', evLossBb: 4 }] }),
    );
    const after = rebuy(played);
    expect(after.stats).toEqual(played.stats);
    expect(after.hands).toEqual(played.hands);
    expect(computeStats(after)).toEqual(computeStats(played));
  });

  it('a rebuy does not count as a hand played', () => {
    const after = rebuy(rebuy(recordHand(emptySession(), hand({ net: -START_STACK }))));
    expect(after.stats.handsPlayed).toBe(1);
    expect(after.rebuys).toBe(2);
  });

  it('recordHand carries the rebuy count forward', () => {
    const after = recordHand(rebuy(emptySession()), hand({ net: 300 }));
    expect(after.rebuys).toBe(1);
    expect(after.bankroll).toBe(DEFAULT_BANKROLL + 300);
  });
});

describe('no free value invariant', () => {
  it('busting and rebuying N times leaves the player down exactly N stacks', () => {
    let state = emptySession();
    for (let i = 1; i <= 5; i++) {
      state = bustAndRebuy(state, i);
      // Bankroll is net worth: pocket + the 5000 now sitting in front of the hero.
      expect(state.bankroll, `after ${i} bust(s)`).toBe(DEFAULT_BANKROLL - START_STACK * i);
      expect(state.rebuys).toBe(i);
      // The player is never up, and the loss grows monotonically with each cycle.
      expect(state.bankroll).toBeLessThan(DEFAULT_BANKROLL);
    }
    expect(state.bankroll).toBe(DEFAULT_BANKROLL - 5 * START_STACK);
  });

  it('a rebuy cannot conjure bankroll: repeated rebuys with no play change nothing', () => {
    let state = emptySession();
    for (let i = 0; i < 10; i++) state = rebuy(state);
    expect(state.bankroll).toBe(DEFAULT_BANKROLL);
    expect(state.rebuys).toBe(10);
  });

  it('bust, rebuy, then win it all back is break-even — not a profit', () => {
    // Down 5000 on the bust, up 5000 on the recovery. If the rebuy credited the bankroll the
    // player would finish +5000 having created chips out of nothing.
    const busted = bustAndRebuy(emptySession(), 1);
    const recovered = recordHand(busted, hand({ handNumber: 2, net: START_STACK }));
    expect(recovered.bankroll).toBe(DEFAULT_BANKROLL);
    expect(recovered.rebuys).toBe(1);
  });

  it('the bankroll equals the starting bankroll plus the sum of hand nets, rebuys or not', () => {
    // The single accounting identity: rebuys are absent from it by construction.
    const nets = [-START_STACK, 1200, -1200, -START_STACK, 800];
    let state = emptySession();
    nets.forEach((net, i) => {
      state = recordHand(state, hand({ handNumber: i + 1, net }));
      if (net === -START_STACK) state = rebuy(state);
    });
    expect(state.rebuys).toBe(2);
    expect(state.bankroll).toBe(DEFAULT_BANKROLL + nets.reduce((a, b) => a + b, 0));
  });
});

describe('rebuys persistence', () => {
  it('round-trips through serialize / deserialize', () => {
    const state = bustAndRebuy(bustAndRebuy(emptySession(), 1), 2);
    expect(state.rebuys).toBe(2);
    const revived = deserialize(JSON.parse(JSON.stringify(serialize(state))));
    expect(revived.rebuys).toBe(2);
    expect(revived).toEqual(state);
  });

  it('serialize exposes rebuys as a plain number', () => {
    expect(serialize(rebuy(emptySession())).rebuys).toBe(1);
  });

  it('a legacy save with no rebuys field loads as zero, not NaN', () => {
    const legacy = {
      bankroll: 5000,
      hands: [],
      stats: { handsPlayed: 4, vpipHands: 2, pfrHands: 1, evLossBb: 3, leaks: {}, leakCostBb: {} },
    };
    const revived = deserialize(legacy);
    expect(revived.rebuys).toBe(0);
    expect(Number.isNaN(revived.rebuys)).toBe(false);
    expect(revived.bankroll).toBe(5000);
  });

  it('rejects a corrupt rebuys field', () => {
    expect(deserialize({ rebuys: 'many' }).rebuys).toBe(0);
    expect(deserialize({ rebuys: null }).rebuys).toBe(0);
    expect(deserialize({ rebuys: Number.NaN }).rebuys).toBe(0);
    expect(deserialize({ rebuys: -3 }).rebuys).toBe(0);
    expect(deserialize({ rebuys: 2.7 }).rebuys).toBe(2);
  });

  it('a deserialized legacy state is immediately rebuyable', () => {
    const revived = deserialize({ bankroll: 500, hands: [], stats: {} });
    const after = rebuy(revived);
    expect(after.rebuys).toBe(1);
    expect(after.bankroll).toBe(500);
  });
});
