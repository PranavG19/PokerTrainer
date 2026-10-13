import { describe, expect, it } from 'vitest';
import {
  defaultProgression,
  effectiveFrequency,
  effectiveTier,
  effectiveTone,
  MAX_REP_AWARDS,
  MAX_STREAK_DAYS,
  countSession,
  currentStreakOn,
  parseProgression,
  serializeProgression,
} from '../../src/core/progression/persist.js';
import { CHALK_DAILY_CAP, type ProgressionState } from '../../src/core/progression/types.js';
import type { DayKey } from '../../src/core/localDay.js';
import { chalk, reps } from '../../src/core/units.js';
import { deserialize, serialize } from '../../src/core/session.js';

const day = (n: number) => n as DayKey;

/** Every section populated with valid data. */
function full(): ProgressionState {
  return {
    streak: {
      boundaryHour: 5,
      current: 2,
      best: 11,
      lastCountedDay: day(19603),
      countedDays: [day(19600), day(19602), day(19603)],
    },
    reps: {
      total: reps(1240),
      awards: [
        { key: 'hand:1', reps: reps(10), day: day(19603) },
        { key: 'puzzle:p1:19603', reps: reps(25), day: day(19603) },
      ],
    },
    seals: { earned: { 'pot-odds': { day: day(19590) } } },
    cosmetics: {
      owned: ['felt-chalkboard', 'back-patina'],
      equipped: { felt: 'felt-chalkboard' },
      receipts: [{ itemId: 'felt-chalkboard', day: day(19595), fact: 'Certified the 40bb table', chalk: chalk(0) }],
      chalk: { balance: chalk(310), day: day(19603), earnedToday: chalk(165) },
    },
    dee: {
      ruleSentences: [{ conceptId: 'pot-odds', text: 'the price is the call over the pot after I call', day: day(19598) }],
      keepsakes: ['wren-wick'],
      lastGreeting: { day: day(19603), lineId: 'greet.due.3' },
      personality: { tone: 'dry', frequency: 'mistakes' },
      character: false,
      handsWatched: 412,
      said: [{ lineId: 'ph-1', at: 410 }],
    },
    personalization: {
      answeredOn: day(19560),
      displayName: 'Sam',
      goals: ['home-game', 'understand-losses'],
      format: 'home',
      stakes: 'low',
      experience: 'years-unstudied',
      why: ['friends', 'puzzle'],
      schedule: { days: [1, 2, 3, 4, 5], sessionMinutes: 15 },
    },
    milestones: { achieved: { 'depth-40': { day: day(19570) } } },
    entitlements: { tier: 'free', granted: [], licence: null, highWater: 0 },
  };
}

describe('progression defaults and round trip', () => {
  it('missing or non-object progression reads as the defaults', () => {
    for (const raw of [undefined, null, 'garbage', 42, [], {}]) expect(parseProgression(raw)).toEqual(defaultProgression());
  });

  it('valid data round-trips exactly through JSON', () => {
    const p = full();
    expect(parseProgression(JSON.parse(JSON.stringify(serializeProgression(p))))).toEqual(p);
  });

  it('a partial section keeps what it has and defaults the rest', () => {
    const p = parseProgression({ streak: { countedDays: [19600] }, cosmetics: { owned: ['a'] } });
    expect(p.streak).toEqual({ boundaryHour: 4, current: 1, best: 1, lastCountedDay: 19600, countedDays: [19600] });
    expect(p.cosmetics.owned).toEqual(['a']);
    expect(p.cosmetics.chalk).toEqual(defaultProgression().cosmetics.chalk);
  });
});

describe('corrupt progression falls back without losing anything else', () => {
  it('one corrupt section defaults; the other sections survive', () => {
    const raw = JSON.parse(JSON.stringify(serializeProgression(full()))) as Record<string, unknown>;
    raw.streak = 'not an object';
    raw.cosmetics = [1, 2, 3];
    const p = parseProgression(raw);
    expect(p.streak).toEqual(defaultProgression().streak);
    expect(p.cosmetics).toEqual(defaultProgression().cosmetics);
    expect(p.reps).toEqual(full().reps);
    expect(p.dee).toEqual(full().dee);
    expect(p.personalization).toEqual(full().personalization);
  });

  it('a wholly corrupt progression leaves the rest of the profile intact', () => {
    const s = deserialize({ bankroll: 7300, rebuys: 1, hands: [], stats: { handsPlayed: 9 }, progression: 'x' });
    expect(s.bankroll).toBe(7300);
    expect(s.rebuys).toBe(1);
    expect(s.stats.handsPlayed).toBe(9);
    expect(s.progression).toEqual(defaultProgression());
  });

  it('bad entries are dropped, bad scalars default, counts clamp', () => {
    const p = parseProgression({
      streak: {
        boundaryHour: 99,
        current: -3,
        best: -4,
        lastCountedDay: 19590, // older than the history: the history wins
        countedDays: [19601, 19600, 19600, 'x', 1.5, null],
        // Rest days and freezes are not part of the classic streak; a stray one is carried, never read.
        restedDays: [19602],
      },
      reps: { total: 5, awards: [{ key: 'a', reps: 10, day: 1 }, { key: 'a', reps: 10, day: 1 }, { reps: 3, day: 1 }] },
      cosmetics: {
        owned: ['a', 'a', '', 7, 'b'],
        equipped: { felt: 'b', cardBack: 'not-owned', bogus: 'a' },
        receipts: [{ itemId: 'a', day: 1, fact: '' }],
        chalk: { balance: -50, day: 19603, earnedToday: 10_000 },
      },
      personalization: { goals: ['a', 'b', 'c'], schedule: { days: [5, 1, 1, 9], sessionMinutes: -2 } },
      entitlements: { tier: 'pro-from-the-future', granted: ['x'] },
      dee: { personality: { tone: 'sardonic' } },
    });
    // The run is never below what the history shows, and best is never below the run.
    expect(p.streak).toEqual({ boundaryHour: 4, current: 2, best: 2, lastCountedDay: 19601, countedDays: [19600, 19601] });
    // Duplicate award keys count once; lifetime is never below what the log shows.
    expect(p.reps.awards).toHaveLength(1);
    expect(p.reps.total).toBe(10);
    expect(p.cosmetics.owned).toEqual(['a', 'b']);
    expect(p.cosmetics.equipped).toEqual({ felt: 'b' });
    expect(p.cosmetics.receipts).toEqual([]);
    expect(p.cosmetics.chalk).toEqual({ balance: 0, day: 19603, earnedToday: CHALK_DAILY_CAP });
    expect(p.personalization.goals).toEqual(['a', 'b']);
    expect(p.personalization.schedule).toEqual({ days: [1, 5], sessionMinutes: null });
    // A newer build's value is kept (so this build cannot overwrite it) and reads as the default.
    expect(p.entitlements.tier).toBe('pro-from-the-future');
    expect(effectiveTier(p.entitlements)).toBe('free');
    expect(p.dee.personality.tone).toBe('sardonic');
    expect(effectiveTone(p.dee.personality)).toBe('warm');
    expect(effectiveFrequency(p.dee.personality)).toBe('normal');
  });

  it('bounded lists keep the newest entries', () => {
    const countedDays = Array.from({ length: MAX_STREAK_DAYS + 10 }, (_, i) => 10_000 + i);
    const awards = Array.from({ length: MAX_REP_AWARDS + 5 }, (_, i) => ({ key: `k${i}`, reps: 1, day: 1 }));
    const p = parseProgression({ streak: { countedDays, current: 5000, lastCountedDay: 10_739 }, reps: { total: 0, awards } });
    expect(p.streak.countedDays).toHaveLength(MAX_STREAK_DAYS);
    expect(p.streak.countedDays[0]).toBe(10_010);
    // A run that fills the whole bounded history may really be longer, so the stored count is believed.
    expect(p.streak.current).toBe(5000);
    expect(p.reps.awards).toHaveLength(MAX_REP_AWARDS);
    expect(p.reps.awards[0].key).toBe('k5');
  });

  it('a "__proto__" id in a receipt map is skipped, not turned into a prototype', () => {
    const p = parseProgression(JSON.parse('{"seals":{"earned":{"__proto__":{"day":1},"ok":{"day":2}}}}'));
    expect(Object.keys(p.seals.earned)).toEqual(['ok']);
    expect(Object.getPrototypeOf(p.seals.earned)).toBe(Object.prototype);
  });
});

describe('progression rides in the profile', () => {
  it('survives serialize → JSON → deserialize next to the v1 fields', () => {
    const s = deserialize({ bankroll: 9100, hands: [], stats: {}, progression: serializeProgression(full()) });
    const back = deserialize(JSON.parse(JSON.stringify(serialize(s))));
    expect(back.progression).toEqual(full());
    expect(back.bankroll).toBe(9100);
  });
});

describe('the classic daily streak (owner D5)', () => {
  const start = defaultProgression().streak;

  it('counts consecutive local days, once per day', () => {
    let s = countSession(start, day(100));
    s = countSession(s, day(100)); // a second session the same day
    s = countSession(s, day(101));
    s = countSession(s, day(102));
    expect(s).toMatchObject({ current: 3, best: 3, lastCountedDay: 102, countedDays: [100, 101, 102] });
  });

  it('a missed day resets the run to 1 on the next session; the best is kept; no freeze covers it', () => {
    let s = countSession(countSession(countSession(start, day(100)), day(101)), day(102));
    s = countSession(s, day(104)); // day 103 missed
    expect(s).toMatchObject({ current: 1, best: 3, lastCountedDay: 104 });
  });

  it('reads as 0 once a whole day is missed, and still live on the day after the last one', () => {
    const s = countSession(countSession(start, day(100)), day(101));
    expect(currentStreakOn(s, day(101))).toBe(2);
    expect(currentStreakOn(s, day(102))).toBe(2); // today can still count
    expect(currentStreakOn(s, day(103))).toBe(0);
    expect(s.best).toBe(2);
    expect(currentStreakOn(start, day(5))).toBe(0);
  });

  it('a clock that ran fast cannot freeze the streak: the next real session corrects it', () => {
    // Saved while the clock read day 20000; the real days are 19800 onwards.
    let s = countSession(countSession(start, day(19998)), day(20000));
    s = countSession(s, day(19800));
    expect(s).toMatchObject({ current: 1, lastCountedDay: 19800, countedDays: [19800] });
    expect(currentStreakOn(s, day(19800))).toBe(1);
    for (let d = 19801; d <= 19804; d++) s = countSession(s, day(d));
    expect(s.current).toBe(5);
    s = countSession(s, day(19806)); // a missed day still resets
    expect(s.current).toBe(1);
  });

  it('a clock moved back onto an earlier counted day recomputes the run up to that day', () => {
    let s = start;
    for (const d of [100, 101, 102, 103]) s = countSession(s, day(d));
    s = countSession(s, day(101));
    expect(s).toMatchObject({ current: 2, lastCountedDay: 101, countedDays: [100, 101] });
  });

  it('one day back (a westward flight before 4 am) keeps the run and the counted day', () => {
    let s = start;
    for (const d of [96, 97, 98, 99, 100]) s = countSession(s, day(d));
    expect(countSession(s, day(99))).toBe(s);
    expect(currentStreakOn(s, day(101))).toBe(5);
  });

  it('a last counted day in the future reads as 0, not as a live run', () => {
    const s = countSession(start, day(200));
    expect(currentStreakOn(s, day(150))).toBe(0);
  });

  it('the parser takes the run from the history, never from a count that disagrees with it', () => {
    const parse = (streak: Record<string, unknown>) => parseProgression({ streak }).streak;
    // A run across a gap: the real run ending on 102 is 1.
    expect(parse({ current: 50, lastCountedDay: 102, countedDays: [100, 102] })).toMatchObject({ current: 1, lastCountedDay: 102 });
    // A run with no history behind it: nothing to count.
    expect(parse({ current: 1e9, best: 1e9, lastCountedDay: 5, countedDays: [] })).toMatchObject({ current: 0, lastCountedDay: null });
    expect(parse({ best: 1e9 }).best).toBe(36_500);
    // A run cut short of the history, with a last day the history does not hold.
    expect(parse({ current: 1, lastCountedDay: 104, countedDays: [101, 102, 103] })).toMatchObject({ current: 3, best: 3, lastCountedDay: 103 });
  });

  it('has no rest-day, Rhythm or freeze fields at all', () => {
    expect(Object.keys(start).sort()).toEqual(['best', 'boundaryHour', 'countedDays', 'current', 'lastCountedDay']);
  });
});
