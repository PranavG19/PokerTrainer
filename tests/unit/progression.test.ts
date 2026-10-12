import { describe, expect, it } from 'vitest';
import {
  defaultProgression,
  effectiveFrequency,
  effectiveTier,
  effectiveTone,
  MAX_LAMP_DAYS,
  MAX_REP_AWARDS,
  MAX_SPARE_WICKS,
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
    lamp: {
      boundaryHour: 5,
      litDays: [day(19600), day(19601), day(19603)],
      restedDays: [day(19602)],
      rhythm: { daysPerWeek: 4, weekStartsOn: 0, best: 11 },
      spareWicks: { held: 2, spentOnWeeks: [day(19590)] },
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
      personality: { tone: 'dry', frequency: 'after-hands' },
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
    entitlements: { tier: 'free', granted: [] },
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
    const p = parseProgression({ lamp: { litDays: [19600] }, cosmetics: { owned: ['a'] } });
    expect(p.lamp.litDays).toEqual([19600]);
    expect(p.lamp.rhythm).toEqual(defaultProgression().lamp.rhythm);
    expect(p.cosmetics.owned).toEqual(['a']);
    expect(p.cosmetics.chalk).toEqual(defaultProgression().cosmetics.chalk);
  });
});

describe('corrupt progression falls back without losing anything else', () => {
  it('one corrupt section defaults; the other sections survive', () => {
    const raw = JSON.parse(JSON.stringify(serializeProgression(full()))) as Record<string, unknown>;
    raw.lamp = 'not an object';
    raw.cosmetics = [1, 2, 3];
    const p = parseProgression(raw);
    expect(p.lamp).toEqual(defaultProgression().lamp);
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
      lamp: {
        boundaryHour: 99,
        litDays: [19601, 19600, 19600, 'x', 1.5, null],
        restedDays: [19600, 19605], // 19600 is also lit: lit wins
        rhythm: { daysPerWeek: 9, weekStartsOn: 3, best: -4 },
        spareWicks: { held: 7, spentOnWeeks: [] },
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
    expect(p.lamp.boundaryHour).toBe(4);
    expect(p.lamp.litDays).toEqual([19600, 19601]);
    expect(p.lamp.restedDays).toEqual([19605]);
    expect(p.lamp.rhythm).toEqual({ daysPerWeek: 3, weekStartsOn: 1, best: 0 });
    expect(p.lamp.spareWicks.held).toBe(MAX_SPARE_WICKS);
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
    const litDays = Array.from({ length: MAX_LAMP_DAYS + 10 }, (_, i) => 10_000 + i);
    const awards = Array.from({ length: MAX_REP_AWARDS + 5 }, (_, i) => ({ key: `k${i}`, reps: 1, day: 1 }));
    const p = parseProgression({ lamp: { litDays }, reps: { total: 0, awards } });
    expect(p.lamp.litDays).toHaveLength(MAX_LAMP_DAYS);
    expect(p.lamp.litDays[0]).toBe(10_010);
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
