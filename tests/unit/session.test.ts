import { describe, it, expect } from 'vitest';
import type { Grade } from '../../src/core/coach.js';
import type { GiftEntry } from '../../src/core/giftLedger.js';
import type { HandRecord, SessionState } from '../../src/core/session.js';
import {
  DEFAULT_BANKROLL,
  MAX_GIFT_LOG,
  MAX_HAND_LOG,
  computeStats,
  deserialize,
  emptySession,
  gradeRecordsFrom,
  recordChartAnswer,
  recordGifts,
  recordHand,
  recordLexiconAttempt,
  recordPuzzleResult,
  serialize,
} from '../../src/core/session.js';
import { createLexicon } from '../../src/core/lexicon.js';
import { deriveState, type FadingEvent } from '../../src/core/fading.js';
import { recordFadingEvents } from '../../src/core/session.js';

function gift(overrides: Partial<GiftEntry> = {}): GiftEntry {
  return {
    seq: 0,
    handNumber: 1,
    villainSeatId: 2,
    villainName: 'Bo',
    villainHole: ['Qh', 'Qd'],
    heroHole: ['As', 'Ah'],
    board: ['2s', '7d', 'Kc', '9h', '3c'],
    street: 'river',
    action: 'call',
    villainEquity: 0,
    breakEven: 0.25,
    evChips: -50,
    giftChips: 50,
    ...overrides,
  };
}

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

describe('gift ledger persistence (O5)', () => {
  it('recordGifts appends and survives a round trip', () => {
    const s = recordGifts(emptySession(), [gift(), gift({ seq: 1, villainName: 'Cy', giftChips: 120 })]);
    expect(s.gifts.map((g) => g.villainName)).toEqual(['Bo', 'Cy']);
    const round = deserialize(serialize(s));
    expect(round.gifts).toEqual(s.gifts);
  });

  it('recordGifts with nothing observed leaves the state object untouched', () => {
    const s = emptySession();
    expect(recordGifts(s, [])).toBe(s);
  });

  it('bounds the persisted gift log', () => {
    const many = Array.from({ length: MAX_GIFT_LOG + 30 }, (_, i) => gift({ seq: i }));
    const s = recordGifts(emptySession(), many);
    expect(s.gifts.length).toBe(MAX_GIFT_LOG);
    // The newest are kept: slice(-N) drops the oldest, so the last seq must survive.
    expect(s.gifts[s.gifts.length - 1].seq).toBe(MAX_GIFT_LOG + 29);
  });

  it('a save file predating the gift ledger still loads with an empty list', () => {
    const legacy = { bankroll: 12000, hands: [], stats: { handsPlayed: 3 } };
    expect(deserialize(legacy).gifts).toEqual([]);
  });

  it('drops a malformed gift rather than resurrecting fabricated numbers', () => {
    const raw = serialize(recordGifts(emptySession(), [gift()]));
    // Corrupt the one entry: a gift with no equity number cannot be reconstructed from real fields.
    (raw.gifts as Record<string, unknown>[])[0].villainEquity = 'nonsense';
    expect(deserialize(raw).gifts).toEqual([]);
  });
});

describe('chart-drill mastery persistence', () => {
  it('recordChartAnswer ticks attempts always and correct only when right', () => {
    let s = emptySession();
    s = recordChartAnswer(s, 'premium', true);
    s = recordChartAnswer(s, 'premium', false);
    s = recordChartAnswer(s, 'trash', true);
    expect(s.chartMastery).toEqual({
      premium: { attempts: 2, correct: 1 },
      trash: { attempts: 1, correct: 1 },
    });
  });

  it('is pure — the prior state and its map are not mutated', () => {
    const before = recordChartAnswer(emptySession(), 'premium', true);
    const snapshot = JSON.parse(JSON.stringify(before.chartMastery));
    recordChartAnswer(before, 'premium', false);
    expect(before.chartMastery).toEqual(snapshot);
  });

  it('survives a round trip', () => {
    let s = emptySession();
    for (const [klass, right] of [['premium', true], ['broadway', false], ['broadway', false]] as const) {
      s = recordChartAnswer(s, klass, right);
    }
    expect(deserialize(JSON.parse(JSON.stringify(serialize(s))))).toEqual(s);
  });

  it('a save file predating the drill record loads with an empty map', () => {
    const legacy = { bankroll: 12000, hands: [], stats: { handsPlayed: 3 } };
    expect(deserialize(legacy).chartMastery).toEqual({});
  });

  it('clamps a corrupt record so it cannot poison the draw weight', () => {
    const raw = deserialize({
      chartMastery: {
        premium: { attempts: -5, correct: 3 }, // negative attempts → 0, and correct clamped to attempts
        strong: { attempts: 4, correct: 99 }, // correct above attempts → clamped to attempts
        trash: { attempts: 'lots', correct: 2 }, // non-numeric attempts → 0
        broadway: { attempts: 6, correct: 2 }, // clean, kept as-is
      },
    });
    expect(raw.chartMastery).toEqual({
      // premium: attempts 0, correct clamped to 0 → dropped as empty
      strong: { attempts: 4, correct: 4 },
      broadway: { attempts: 6, correct: 2 },
    });
  });
});

describe('puzzle progress persistence', () => {
  it('recordPuzzleResult ticks attempts and keeps the BEST correct count', () => {
    let s = emptySession();
    s = recordPuzzleResult(s, 'btn-open-aks', 1);
    s = recordPuzzleResult(s, 'bb-defend-vs-btn', 2);
    // A sloppier replay must NOT lower the recorded best.
    s = recordPuzzleResult(s, 'bb-defend-vs-btn', 0);
    expect(s.puzzleProgress).toEqual({
      'btn-open-aks': { attempts: 1, bestCorrect: 1 },
      'bb-defend-vs-btn': { attempts: 2, bestCorrect: 2 },
    });
  });

  it('a better replay raises the best', () => {
    let s = recordPuzzleResult(emptySession(), 'cbet-dry-ace', 1);
    s = recordPuzzleResult(s, 'cbet-dry-ace', 2);
    expect(s.puzzleProgress['cbet-dry-ace']).toEqual({ attempts: 2, bestCorrect: 2 });
  });

  it('is pure — the prior state is not mutated', () => {
    const before = recordPuzzleResult(emptySession(), 'btn-open-aks', 1);
    const snapshot = JSON.parse(JSON.stringify(before.puzzleProgress));
    recordPuzzleResult(before, 'btn-open-aks', 0);
    expect(before.puzzleProgress).toEqual(snapshot);
  });

  it('survives a round trip', () => {
    let s = recordPuzzleResult(emptySession(), 'squeeze-kk-vs-open-call', 1);
    s = recordPuzzleResult(s, 'call-flush-draw-odds', 3);
    expect(deserialize(JSON.parse(JSON.stringify(serialize(s))))).toEqual(s);
  });

  it('a save file predating puzzle progress loads with an empty map', () => {
    expect(deserialize({ bankroll: 12000, hands: [], stats: {} }).puzzleProgress).toEqual({});
  });

  it('drops a zero-attempt entry and floors negatives, without clamping bestCorrect to attempts', () => {
    const raw = deserialize({
      puzzleProgress: {
        'a': { attempts: 0, bestCorrect: 3 }, // no attempts → dropped
        'b': { attempts: 1, bestCorrect: 4 }, // one completion of a 4-step scenario — bestCorrect stays 4
        'c': { attempts: -2, bestCorrect: 1 }, // negative attempts → 0 → dropped
        'd': { attempts: 2, bestCorrect: -1 }, // negative best → 0
      },
    });
    expect(raw.puzzleProgress).toEqual({
      'b': { attempts: 1, bestCorrect: 4 },
      'd': { attempts: 2, bestCorrect: 0 },
    });
  });
});

describe('lexicon persistence (L1/L3)', () => {
  // A sentence citing the domination mechanism is accepted by the no-key keyword check; a cached cell
  // ("K7s is a CO open") is rejected. Both are real outcomes of the same classifier.
  const accepted = () =>
    createLexicon().record({
      conceptId: 'c1',
      sentence: 'the worse kicker is dominated when it pairs',
      at: 100,
      flippingAxis: 'kickerGap',
    });
  const rejected = () => createLexicon().record({ conceptId: 'c1', sentence: 'K7s is a CO open', at: 200 });

  it('recordLexiconAttempt appends and is pure', () => {
    const before = emptySession();
    const after = recordLexiconAttempt(before, accepted());
    expect(before.lexicon).toEqual([]); // prior untouched
    expect(after.lexicon).toHaveLength(1);
    expect(after.lexicon[0]).toMatchObject({ outcome: 'accepted', conceptId: 'c1' });
  });

  it('survives a round trip, and the rehydrated log still quotes the accepted sentence', () => {
    let s = emptySession();
    s = recordLexiconAttempt(s, accepted());
    s = recordLexiconAttempt(s, rejected());
    const round = deserialize(JSON.parse(JSON.stringify(serialize(s))));
    expect(round).toEqual(s);
    // The whole point of persisting the log: createLexicon rebuilds a working lexicon from it.
    const quote = createLexicon(round.lexicon).quoteFor('c1');
    expect(quote?.sentence).toBe('the worse kicker is dominated when it pairs');
  });

  it('a save file predating the lexicon loads with an empty log', () => {
    expect(deserialize({ bankroll: 12000, hands: [], stats: {} }).lexicon).toEqual([]);
  });

  it('drops malformed entries and re-derives reasonText rather than trusting the file', () => {
    const raw = deserialize({
      lexicon: [
        // clean accepted → kept
        { seq: 0, conceptId: 'c1', sentence: 'dominated kicker', at: 1, flippingAxis: 'kickerGap', outcome: 'accepted', frame: 'domination-risk', decidedBy: 'keyword-check' },
        { seq: 1, conceptId: 'c1', sentence: '   ', outcome: 'accepted', frame: 'domination-risk', decidedBy: 'keyword-check' }, // blank sentence → dropped
        { seq: 2, conceptId: 'c2', sentence: 'bad frame', outcome: 'accepted', frame: 'nonsense', decidedBy: 'keyword-check' }, // unknown frame → dropped
        { seq: 3, conceptId: 'c2', sentence: 'bad reason', outcome: 'rejected', reason: 'whatever', reasonText: 'x' }, // unknown reason → dropped
        // clean rejected → kept, reasonText re-derived from this build's REJECTION_TEXT (not the stale file value)
        { seq: 4, conceptId: 'c2', sentence: 'K7s is a CO open', at: 5, outcome: 'rejected', reason: 'cached-cell', reasonText: 'STALE WORDING FROM AN OLD BUILD', pushback: true },
        { outcome: 'accepted' }, // no conceptId/sentence → dropped
      ],
    });
    expect(raw.lexicon).toHaveLength(2);
    expect(raw.lexicon[0]).toMatchObject({ outcome: 'accepted', frame: 'domination-risk', sentence: 'dominated kicker' });
    expect(raw.lexicon[1]).toMatchObject({
      outcome: 'rejected',
      reason: 'cached-cell',
      reasonText: 'this states a memorised conclusion rather than a mechanism',
      pushback: true,
    });
  });
});

describe('fading log persistence (T6/T7)', () => {
  const graded = (conceptId: string, correct: boolean, at = 0): FadingEvent => ({ kind: 'graded', conceptId, at, correct });

  it('recordFadingEvents appends in order and is pure', () => {
    const before = emptySession();
    const after = recordFadingEvents(before, [graded('spr', true, 1), graded('spr', false, 2)]);
    expect(before.fadingLog).toEqual([]); // prior untouched
    expect(after.fadingLog).toHaveLength(2);
    expect(after.fadingLog.map((e) => e.at)).toEqual([1, 2]);
  });

  it('an empty batch is a no-op that returns the same state', () => {
    const s = emptySession();
    expect(recordFadingEvents(s, [])).toBe(s);
  });

  it('survives a round trip, and the rehydrated log derives the same rung', () => {
    let s = emptySession();
    // Three correct then a fade event on pot-odds — the drill's own promotion shape.
    s = recordFadingEvents(s, [
      graded('pot-odds', true, 1),
      graded('pot-odds', true, 2),
      graded('pot-odds', true, 3),
      { kind: 'supportFaded', conceptId: 'pot-odds', at: 3 },
    ]);
    const round = deserialize(JSON.parse(JSON.stringify(serialize(s))));
    expect(round).toEqual(s);
    expect(deriveState('pot-odds', round.fadingLog).rung).toBe(1);
  });

  it('a save file predating the fading log loads with an empty log', () => {
    expect(deserialize({ bankroll: 12000, hands: [], stats: {} }).fadingLog).toEqual([]);
  });

  it('drops malformed events but keeps the well-formed ones in order', () => {
    const raw = deserialize({
      fadingLog: [
        { kind: 'graded', conceptId: 'spr', at: 1, correct: true }, // kept
        { kind: 'graded', conceptId: 'spr', at: 2, correct: 'yes' }, // non-boolean correct → dropped
        { kind: 'graded', conceptId: '   ', at: 3, correct: false }, // blank conceptId → dropped
        { kind: 'supportFaded', conceptId: 'spr', at: 4 }, // kept
        { kind: 'hintRequested', conceptId: 'spr', at: 5, quotedRungAfter: 9 }, // out-of-range rung → dropped
        { kind: 'hintRequested', conceptId: 'spr', at: 6, quotedRungAfter: 2 }, // kept
        { kind: 'nonsense', conceptId: 'spr', at: 7 }, // unknown kind → dropped
      ],
    });
    expect(raw.fadingLog.map((e) => [e.kind, e.at])).toEqual([
      ['graded', 1],
      ['supportFaded', 4],
      ['hintRequested', 6],
    ]);
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
