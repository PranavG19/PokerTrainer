import { describe, expect, it } from 'vitest';
import type { DayKey } from '../../src/core/localDay.js';
import { defaultProgression, parseProgression, serializeProgression } from '../../src/core/progression/persist.js';
import type { RivalAction, ShowdownRecord } from '../../src/core/progression/types.js';
import { venueById, type Venue } from '../../src/core/story/cast.js';
import { recordStoryHand, rivalRecordOf } from '../../src/core/story/campaign.js';
import {
  READ_MIN,
  capturedAction,
  emptyRivalRecord,
  qualityTrend,
  reads,
  recordRivalHand,
  recordRivalSitting,
  shownStrength,
  signature,
  takeOf,
} from '../../src/core/story/dossier.js';

const day = 20100 as DayKey;
const BOARD = ['2c', '7d', 'Ts', 'Kh', '3s'];
const bet = (street: RivalAction['street'], potShare: number): RivalAction => ({ street, kind: 'bet', facingBet: false, potShare });
const call = (street: RivalAction['street']): RivalAction => ({ street, kind: 'call', facingBet: true, potShare: null });
const sd = (shown: string[], actions: RivalAction[], board = BOARD): ShowdownRecord => ({ day, shown, board, actions });

describe('recording: showdowns only', () => {
  it('a hand that did not reach a showdown adds to the count and nothing else', () => {
    let r = emptyRivalRecord();
    r = recordRivalHand(r, { actions: [bet('river', 1)], shown: null, board: BOARD }, day);
    expect(r).toEqual({ hands: 1, sittings: [], showdowns: [] });
    r = recordRivalHand(r, { actions: [bet('river', 1)], shown: ['Ah', 'Ad'], board: BOARD }, day);
    expect(r.hands).toBe(2);
    expect(r.showdowns).toHaveLength(1);
    expect(r.showdowns[0]).toEqual({ day, shown: ['Ah', 'Ad'], board: BOARD, actions: [bet('river', 1)] });
  });

  it('a hand that ended before the river is never a showdown on file (the board is incomplete)', () => {
    const r = recordRivalHand(emptyRivalRecord(), { actions: [], shown: ['Ah', 'Ad'], board: ['2c', '7d', 'Ts'] }, day);
    expect(r.showdowns).toHaveLength(0);
  });

  it('a story hand lands in the venue rival’s file', () => {
    const library = venueById('library') as Venue;
    const s = recordStoryHand(defaultProgression().story, library, { actions: [call('river')], shown: ['Qh', 'Qd'], board: BOARD }, day);
    expect(rivalRecordOf(s, library).showdowns).toHaveLength(1);
    expect(Object.keys(s.rivals)).toEqual(['percival']);
  });
});

describe('capturing a rival action as the hero saw it', () => {
  const t = { street: 'river' as const, pot: 400, currentBet: 300 };
  it('an all-in that only covers the bet faced is a call for the stack, not a bet', () => {
    expect(capturedAction(t, { committed: 0, stack: 250 }, { kind: 'allin' })).toEqual({ street: 'river', kind: 'call', facingBet: true, potShare: null });
    expect(capturedAction(t, { committed: 0, stack: 300 }, { kind: 'allin' })).toMatchObject({ kind: 'call' });
  });
  it('an all-in over the bet is aggression, sized by the chips added over the pot before it', () => {
    expect(capturedAction(t, { committed: 0, stack: 800 }, { kind: 'allin' })).toEqual({ street: 'river', kind: 'allin', facingBet: true, potShare: 2 });
    expect(capturedAction({ ...t, currentBet: 0 }, { committed: 0, stack: 5000 }, { kind: 'bet', amount: 300 })).toEqual({ street: 'river', kind: 'bet', facingBet: false, potShare: 0.75 });
    expect(capturedAction(t, { committed: 100, stack: 5000 }, { kind: 'raise', amount: 900 })).toMatchObject({ kind: 'raise', potShare: 2 });
    expect(capturedAction(t, { committed: 0, stack: 5000 }, { kind: 'call' })).toEqual({ street: 'river', kind: 'call', facingBet: true, potShare: null });
  });
});

describe('what a shown hand was worth', () => {
  it('nothing of its own, a pair, or better', () => {
    expect(shownStrength(sd(['4h', '5h'], []))).toBe('nothing');
    expect(shownStrength(sd(['Kd', '9c'], []))).toBe('pair');
    expect(shownStrength(sd(['Kd', '7c'], []))).toBe('strong');
    // A paired board: a hand that only plays the board pair held nothing of its own.
    expect(shownStrength(sd(['4h', '5h'], [], ['2c', '2d', 'Ts', 'Kh', '9s']))).toBe('nothing');
    // ...and the board's pair plus one pair of their own is one pair, not "two pair or better".
    expect(shownStrength(sd(['Kd', '5h'], [], ['2c', '2d', 'Ts', 'Kh', '9s']))).toBe('pair');
    expect(shownStrength(sd(['Kd', 'Ks'], [], ['2c', '2d', 'Ts', 'Kh', '9s']))).toBe('strong');
    // Two pairs of their own on a paired board (kings and tens over the deuces) is still better than one pair.
    expect(shownStrength(sd(['Kd', 'Tc'], [], ['2c', '2d', 'Ts', 'Kh', '9s']))).toBe('strong');
  });
});

describe('reads: counted from showdowns, shown only once earned', () => {
  it('below READ_MIN observations a read is not earned, and says how many more it needs', () => {
    const r = reads([sd(['4h', '5h'], [bet('river', 1)])]);
    const big = r.find((x) => x.id === 'big-bets')!;
    expect(READ_MIN).toBe(3);
    expect(big).toMatchObject({ seen: 1, count: 1, earned: false, needs: 2 });
    expect(signature(r)).toBeNull();
    expect(takeOf(r).event).toBe('take-none');
  });

  it('big bets that held nothing are bluffs; a bluff-heavy rival gets the bluff take', () => {
    const log = [
      sd(['4h', '5h'], [bet('river', 1)]),
      sd(['8h', '9h'], [bet('river', 0.75)]),
      sd(['Kd', '7c'], [bet('river', 0.6)]),
      sd(['Ah', '6h'], [bet('river', 0.25)]), // a small bet is not a big bet
    ];
    const r = reads(log);
    expect(r.find((x) => x.id === 'big-bets')).toMatchObject({ seen: 3, count: 2, earned: true, needs: 0 });
    expect(r.find((x) => x.id === 'bets')).toMatchObject({ seen: 4, count: 1 });
    const take = takeOf(r);
    expect(take.event).toBe('take-bluffs-high');
    expect(take.facts).toMatchObject({ bigBets: '3', bluffs: '2' });
  });

  it('late calls with a pair or less read as a caller', () => {
    const r = reads([sd(['Kd', '9c'], [call('river')]), sd(['4h', '5h'], [call('turn')]), sd(['Td', '9c'], [call('river')])]);
    expect(r.find((x) => x.id === 'calls')).toMatchObject({ seen: 3, count: 3, earned: true });
    expect(takeOf(r).event).toBe('take-thin-high');
  });

  it('earned reads near the balanced baseline: the standard line is the read', () => {
    const r = reads([
      sd(['4h', '5h'], [bet('river', 1)]),
      sd(['Kd', '7c'], [bet('river', 1)]),
      sd(['Kc', '7h'], [bet('river', 1)]),
    ]);
    // 1 of 3 bluffs sits on the 1-in-3 baseline; 2 of 3 strong is above its 1/2 baseline by under 0.2.
    expect(takeOf(r).event).toBe('take-strong-high');
    // 1 of 4 bluffs and 2 of 4 strong: both within the margin of their baselines.
    const flat = reads([
      sd(['4h', '5h'], [bet('river', 1)]),
      sd(['Kd', '7c'], [bet('river', 1)]),
      sd(['Kc', '7h'], [bet('river', 1)]),
      sd(['Kc', '9h'], [bet('river', 1)]),
    ]);
    expect(takeOf(flat).event).toBe('take-baseline');
  });
});

describe('decision quality against the rival, over time', () => {
  it('one point per table, oldest first', () => {
    let r = emptyRivalRecord();
    r = recordRivalSitting(r, { day, chapter: 'library', judged: 4, free: 2, serious: 1 });
    r = recordRivalSitting(r, { day: (day + 2) as DayKey, chapter: 'library', judged: 5, free: 5, serious: 0 });
    expect(qualityTrend(r)).toEqual([
      { day, judged: 4, free: 2, share: 0.5 },
      { day: day + 2, judged: 5, free: 5, share: 1 },
    ]);
  });
});

describe('persistence: story in progression (additive, no version bump)', () => {
  it('round-trips, and a bad showdown is dropped rather than read', () => {
    const p = defaultProgression();
    const library = venueById('library') as Venue;
    p.story = recordStoryHand(p.story, library, { actions: [bet('river', 1)], shown: ['4h', '5h'], board: BOARD }, day);
    const raw = serializeProgression(p) as { story: { rivals: { percival: { showdowns: unknown[] } } } };
    expect(parseProgression(raw)).toEqual(p);
    raw.story.rivals.percival.showdowns.push(
      { day, shown: ['4h'], board: BOARD, actions: [] },
      { day, shown: ['4h', '2c'], board: BOARD, actions: [] }, // a card twice
      { day, shown: ['Zz', '5h'], board: BOARD, actions: [] },
    );
    expect(parseProgression(raw).story.rivals.percival.showdowns).toHaveLength(1);
  });

  it('an unknown chapter id and an unknown result are kept, not reset', () => {
    const raw = serializeProgression(defaultProgression()) as Record<string, unknown>;
    raw.story = { chapters: { masquerade: { introSeen: true, tables: 3, lastResult: 'perfect', beatenOn: null } }, rivals: {}, overrides: [] };
    const story = parseProgression(raw).story;
    expect(story.chapters.masquerade).toEqual({ introSeen: true, lessonDone: false, tables: 3, lastResult: 'perfect', beatenOn: null });
  });

  it('a hand count is never below the showdowns on file', () => {
    const raw = serializeProgression(defaultProgression()) as Record<string, unknown>;
    raw.story = { chapters: {}, rivals: { wren: { hands: 0, sittings: [], showdowns: [{ day, shown: ['4h', '5h'], board: BOARD, actions: [] }] } }, overrides: [] };
    expect(parseProgression(raw).story.rivals.wren.hands).toBe(1);
  });
});
