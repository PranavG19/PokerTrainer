import { describe, it, expect } from 'vitest';
import type { Grade } from '../../src/core/coach.js';
import type { HandRecord, SessionState } from '../../src/core/session.js';
import {
  DEFAULT_BANKROLL,
  MAX_HAND_LOG,
  computeStats,
  deserialize,
  emptySession,
  gradeRecordsFrom,
  recordHand,
  serialize,
} from '../../src/core/session.js';

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

function playHands(records: HandRecord[]): SessionState {
  return records.reduce(recordHand, emptySession());
}

describe('emptySession', () => {
  it('starts at the default bankroll with an empty log', () => {
    const s = emptySession();
    expect(s.bankroll).toBe(DEFAULT_BANKROLL);
    expect(s.hands).toEqual([]);
    expect(s.stats).toEqual({
      handsPlayed: 0,
      vpipHands: 0,
      pfrHands: 0,
      evLossBb: 0,
      leaks: {},
      leakCostBb: {},
    });
  });

  it('returns a fresh object each call', () => {
    expect(emptySession()).not.toBe(emptySession());
  });
});

describe('bankroll', () => {
  it('a win adds to the bankroll', () => {
    const s = recordHand(emptySession(), hand({ net: 250 }));
    expect(s.bankroll).toBe(DEFAULT_BANKROLL + 250);
  });

  it('a loss subtracts from the bankroll', () => {
    const s = recordHand(emptySession(), hand({ net: -120 }));
    expect(s.bankroll).toBe(DEFAULT_BANKROLL - 120);
  });

  it('accumulates across a mixed run of wins and losses', () => {
    const s = playHands([
      hand({ handNumber: 1, net: 100 }),
      hand({ handNumber: 2, net: -40 }),
      hand({ handNumber: 3, net: -300 }),
      hand({ handNumber: 4, net: 500 }),
    ]);
    expect(s.bankroll).toBe(DEFAULT_BANKROLL + 260);
    expect(s.hands.map((h) => h.handNumber)).toEqual([1, 2, 3, 4]);
  });

  it('can go to zero and below (no clamping)', () => {
    const s = recordHand(emptySession(), hand({ net: -DEFAULT_BANKROLL - 50 }));
    expect(s.bankroll).toBe(-50);
  });
});

describe('VPIP / PFR', () => {
  it('both zero with no hands played', () => {
    const summary = computeStats(emptySession());
    expect(summary.handsPlayed).toBe(0);
    expect(summary.vpip).toBe(0);
    expect(summary.pfr).toBe(0);
  });

  it('2 of 10 voluntary, 1 of 10 raised => 20% / 10%', () => {
    const records = Array.from({ length: 10 }, (_, i) =>
      hand({ handNumber: i + 1, vpip: i < 2, pfr: i < 1 }),
    );
    const summary = computeStats(playHands(records));
    expect(summary.handsPlayed).toBe(10);
    expect(summary.vpip).toBe(20);
    expect(summary.pfr).toBe(10);
  });

  it('100% VPIP and PFR when every hand is raised', () => {
    const summary = computeStats(
      playHands([hand({ vpip: true, pfr: true }), hand({ handNumber: 2, vpip: true, pfr: true })]),
    );
    expect(summary.vpip).toBe(100);
    expect(summary.pfr).toBe(100);
  });

  it('PFR does not imply VPIP is inferred — counters are independent', () => {
    const s = playHands([hand({ vpip: true, pfr: false }), hand({ handNumber: 2, vpip: true, pfr: true })]);
    expect(s.stats.vpipHands).toBe(2);
    expect(s.stats.pfrHands).toBe(1);
  });

  it('produces a fractional percentage for 1 of 3', () => {
    const records = Array.from({ length: 3 }, (_, i) => hand({ handNumber: i + 1, vpip: i === 0 }));
    expect(computeStats(playHands(records)).vpip).toBeCloseTo(33.333, 3);
  });
});

describe('leak aggregation', () => {
  it('counts one leak per graded mistake, keyed by principle', () => {
    const s = playHands([
      hand({ grades: [{ severity: 'notable', principle: 'pot odds', evLossBb: 1 }] }),
      hand({
        handNumber: 2,
        grades: [
          { severity: 'serious', principle: 'pot odds', evLossBb: 3 },
          { severity: 'notable', principle: 'ranges', evLossBb: 0.75 },
        ],
      }),
    ]);
    expect(s.stats.leaks).toEqual({ 'pot odds': 2, ranges: 1 });
    expect(s.stats.evLossBb).toBeCloseTo(4.75, 10);
  });

  it('computeStats sorts leaks by total cost descending', () => {
    const s = playHands([
      hand({
        grades: [
          { severity: 'notable', principle: 'ranges', evLossBb: 1 },
          { severity: 'notable', principle: 'pot odds', evLossBb: 1 },
          { severity: 'notable', principle: 'pot odds', evLossBb: 1 },
        ],
      }),
    ]);
    expect(computeStats(s).leaks).toEqual([
      { principle: 'pot odds', count: 2, costBb: 2 },
      { principle: 'ranges', count: 1, costBb: 1 },
    ]);
  });

  it('ranks one expensive leak above several cheap ones', () => {
    // The whole point of cost-ranking: five 0.6bb slips are not the priority
    // over a single 20bb blunder, but count-ranking would say they are.
    const s = playHands([
      hand({
        grades: [
          { severity: 'notable', principle: 'pot odds', evLossBb: 0.6 },
          { severity: 'notable', principle: 'pot odds', evLossBb: 0.6 },
          { severity: 'notable', principle: 'pot odds', evLossBb: 0.6 },
          { severity: 'notable', principle: 'pot odds', evLossBb: 0.6 },
          { severity: 'notable', principle: 'pot odds', evLossBb: 0.6 },
          { severity: 'serious', principle: 'value or bluff', evLossBb: 20 },
        ],
      }),
    ]);
    const { leaks } = computeStats(s);
    expect(leaks[0]).toEqual({ principle: 'value or bluff', count: 1, costBb: 20 });
    expect(leaks[1].principle).toBe('pot odds');
    expect(leaks[1].count).toBe(5);
    expect(leaks[1].costBb).toBeCloseTo(3, 5);
  });

  it('leak cost accumulates across hands and survives a round trip', () => {
    const s = playHands([
      hand({ grades: [{ severity: 'notable', principle: 'pot odds', evLossBb: 1.5 }] }),
      hand({ handNumber: 2, grades: [{ severity: 'serious', principle: 'pot odds', evLossBb: 2.5 }] }),
    ]);
    expect(s.stats.leakCostBb).toEqual({ 'pot odds': 4 });
    expect(deserialize(serialize(s)).stats.leakCostBb).toEqual({ 'pot odds': 4 });
  });

  it('a save file predating leakCostBb still loads', () => {
    // Older saves have leaks but no leakCostBb; costs read as 0 rather than NaN.
    const legacy = {
      bankroll: 12000,
      hands: [],
      stats: { handsPlayed: 3, vpipHands: 1, pfrHands: 0, evLossBb: 2, leaks: { 'pot odds': 2 } },
    };
    const s = deserialize(legacy);
    expect(s.stats.leakCostBb).toEqual({});
    expect(computeStats(s).leaks).toEqual([{ principle: 'pot odds', count: 2, costBb: 0 }]);
  });

  it('no grades means no leaks', () => {
    const s = playHands([hand(), hand({ handNumber: 2 })]);
    expect(computeStats(s).leaks).toEqual([]);
    expect(computeStats(s).evLossBb).toBe(0);
  });

  it('leak totals survive the hand log cap', () => {
    const records = Array.from({ length: MAX_HAND_LOG + 20 }, (_, i) =>
      hand({
        handNumber: i + 1,
        grades: [{ severity: 'notable', principle: 'pot odds', evLossBb: 1 }],
      }),
    );
    const s = playHands(records);
    expect(s.hands.length).toBe(MAX_HAND_LOG);
    expect(s.stats.leaks['pot odds']).toBe(MAX_HAND_LOG + 20);
  });
});

describe('gradeRecordsFrom', () => {
  it('keeps graded mistakes and drops silent (principle === null) grades', () => {
    const grades: Grade[] = [
      { severity: 'free', evLossBb: 0.1, message: null, principle: null },
      { severity: 'serious', evLossBb: 4, message: 'too loose', principle: 'pot odds' },
    ];
    expect(gradeRecordsFrom(grades)).toEqual([
      { severity: 'serious', principle: 'pot odds', evLossBb: 4 },
    ]);
  });
});

describe('hand log cap', () => {
  it('keeps only the most recent MAX_HAND_LOG hands', () => {
    const records = Array.from({ length: MAX_HAND_LOG + 3 }, (_, i) => hand({ handNumber: i + 1 }));
    const s = playHands(records);
    expect(s.hands.length).toBe(MAX_HAND_LOG);
    expect(s.hands[0].handNumber).toBe(4);
    expect(s.hands[s.hands.length - 1].handNumber).toBe(MAX_HAND_LOG + 3);
  });

  it('handsPlayed keeps counting past the cap', () => {
    const records = Array.from({ length: MAX_HAND_LOG + 7 }, (_, i) => hand({ handNumber: i + 1 }));
    expect(computeStats(playHands(records)).handsPlayed).toBe(MAX_HAND_LOG + 7);
  });
});

describe('purity', () => {
  it('recordHand does not mutate the input state', () => {
    const before = emptySession();
    const snapshot = JSON.stringify(before);
    recordHand(before, hand({ net: 99, vpip: true, grades: [{ severity: 'notable', principle: 'ranges', evLossBb: 1 }] }));
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('recordHand does not alias the caller record', () => {
    const record = hand({ grades: [{ severity: 'notable', principle: 'ranges', evLossBb: 1 }] });
    const s = recordHand(emptySession(), record);
    record.net = 12345;
    record.grades[0].principle = 'mutated';
    expect(s.hands[0].net).toBe(0);
    expect(s.hands[0].grades[0].principle).toBe('ranges');
  });

  it('successive recordHand calls do not alias earlier hand arrays', () => {
    const first = recordHand(emptySession(), hand());
    recordHand(first, hand({ handNumber: 2 }));
    expect(first.hands.length).toBe(1);
  });

  it('computeStats does not mutate the input state', () => {
    const s = playHands([hand({ grades: [{ severity: 'serious', principle: 'pot odds', evLossBb: 3 }] })]);
    const snapshot = JSON.stringify(s);
    computeStats(s);
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('serialize returns a detached copy', () => {
    const s = playHands([hand()]);
    const out = serialize(s) as { hands: HandRecord[]; stats: { leaks: Record<string, number> } };
    out.hands[0].net = 777;
    out.stats.leaks.injected = 1;
    expect(s.hands[0].net).toBe(0);
    expect(s.stats.leaks).toEqual({});
  });
});

describe('serialize / deserialize round-trip', () => {
  it('is lossless for a populated session', () => {
    const s = playHands([
      hand({ handNumber: 1, net: 300, vpip: true, pfr: true }),
      hand({
        handNumber: 2,
        hole: ['7c', '7d'],
        board: ['Ah', 'Kh', 'Qh'],
        net: -150,
        vpip: true,
        grades: [{ severity: 'serious', principle: 'pot odds', evLossBb: 3.5 }],
      }),
    ]);
    expect(deserialize(JSON.parse(JSON.stringify(serialize(s))))).toEqual(s);
  });

  it('is lossless for an empty session', () => {
    expect(deserialize(serialize(emptySession()))).toEqual(emptySession());
  });

  it('matches the store default shape from src/main/store.ts', () => {
    expect(deserialize({ bankroll: 10000, hands: [], stats: {} })).toEqual(emptySession());
  });
});

describe('deserialize tolerates corrupt input', () => {
  it('survives an empty object', () => {
    expect(deserialize({})).toEqual(emptySession());
  });

  it('survives null and undefined', () => {
    expect(deserialize(null)).toEqual(emptySession());
    expect(deserialize(undefined)).toEqual(emptySession());
  });

  it('survives a non-object (string, number, array)', () => {
    expect(deserialize('{"bankroll":')).toEqual(emptySession());
    expect(deserialize(42)).toEqual(emptySession());
    expect(deserialize([1, 2, 3])).toEqual(emptySession());
  });

  it('keeps a valid bankroll while defaulting missing stats', () => {
    const s = deserialize({ bankroll: 4200 });
    expect(s.bankroll).toBe(4200);
    expect(s.stats.handsPlayed).toBe(0);
    expect(s.hands).toEqual([]);
  });

  it('rejects wrong-typed bankroll and non-finite numbers', () => {
    expect(deserialize({ bankroll: 'lots' }).bankroll).toBe(DEFAULT_BANKROLL);
    expect(deserialize({ bankroll: null }).bankroll).toBe(DEFAULT_BANKROLL);
    expect(deserialize({ bankroll: Number.NaN }).bankroll).toBe(DEFAULT_BANKROLL);
  });

  it('rejects a non-array hands field', () => {
    expect(deserialize({ hands: 'oops' }).hands).toEqual([]);
    expect(deserialize({ hands: { 0: hand() } }).hands).toEqual([]);
  });

  it('fills in missing fields on a truncated hand record', () => {
    const s = deserialize({ hands: [{ handNumber: 9 }] });
    expect(s.hands).toEqual([
      { handNumber: 9, hole: [], board: [], net: 0, vpip: false, pfr: false, grades: [] },
    ]);
  });

  it('drops non-string cards and coerces truthy-but-not-true flags', () => {
    const s = deserialize({ hands: [{ hole: ['As', 7, null], vpip: 1, pfr: 'yes' }] });
    expect(s.hands[0].hole).toEqual(['As']);
    expect(s.hands[0].vpip).toBe(false);
    expect(s.hands[0].pfr).toBe(false);
  });

  it('repairs an unknown severity and a missing principle on a grade', () => {
    const s = deserialize({ hands: [{ grades: [{ severity: 'catastrophic', evLossBb: 'lots' }] }] });
    expect(s.hands[0].grades).toEqual([{ severity: 'free', principle: 'unknown', evLossBb: 0 }]);
  });

  it('drops non-numeric leak counts', () => {
    const s = deserialize({ stats: { leaks: { 'pot odds': 3, ranges: 'many', board: null } } });
    expect(s.stats.leaks).toEqual({ 'pot odds': 3 });
  });

  it('survives stats being an array or a string', () => {
    expect(deserialize({ stats: [] }).stats).toEqual(emptySession().stats);
    expect(deserialize({ stats: 'broken' }).stats).toEqual(emptySession().stats);
  });

  it('truncates an over-long persisted hand log to the cap', () => {
    const hands = Array.from({ length: MAX_HAND_LOG + 5 }, (_, i) => hand({ handNumber: i + 1 }));
    const s = deserialize({ hands });
    expect(s.hands.length).toBe(MAX_HAND_LOG);
    expect(s.hands[0].handNumber).toBe(6);
  });

  it('a deserialized corrupt state is immediately usable by recordHand', () => {
    const recovered = deserialize({ bankroll: 500, hands: 'gone', stats: null });
    const s = recordHand(recovered, hand({ net: 100, vpip: true }));
    expect(s.bankroll).toBe(600);
    expect(computeStats(s)).toMatchObject({ handsPlayed: 1, vpip: 100, pfr: 0 });
  });
});
