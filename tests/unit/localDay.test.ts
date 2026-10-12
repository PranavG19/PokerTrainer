import { describe, expect, it } from 'vitest';
import { careerRecord, type CareerInput } from '../../src/core/career.js';
import { emptyCalibration } from '../../src/core/predict.js';
import { dayKeyAt, fixedOffsetDayKeyOf, systemDayKeyOf } from '../../src/core/localDay.js';

const HOUR = 3_600_000;
/** 2023-11-14 00:00 in UTC−8 (Los Angeles, standard time), as epoch ms. */
const LA_MIDNIGHT = Date.UTC(2023, 10, 14, 8);
const LA_OFFSET_MIN = -480;
/** A learner in UTC−8 with the 4 am boundary. */
const laDay = fixedOffsetDayKeyOf(LA_OFFSET_MIN);

const input = (activityTimestamps: number[]): CareerInput => ({
    decisions: [],
    masteredKcCount: 0,
    puzzleCoverage: 0,
    depthFloor: 0,
    stats: { handsPlayed: 0, vpipHands: 0, pfrHands: 0, evLossBb: 0, leaks: {}, leakCostBb: {} },
    calibration: emptyCalibration(),
    rebuys: 0,
    assessmentsTaken: 0,
    activityTimestamps,
    dayKeyOf: laDay,
});

describe('practice days follow the learner’s local day, not UTC', () => {
  it('a morning and an evening session in UTC−8 are one day, not two', () => {
    // 09:00 and 20:00 local. 20:00 in UTC−8 is 04:00 UTC the next day.
    const stamps = [LA_MIDNIGHT + 9 * HOUR, LA_MIDNIGHT + 20 * HOUR];
    const r = careerRecord(input(stamps), LA_MIDNIGHT + 21 * HOUR);
    expect(r.cadence.distinctDays).toBe(1);
    expect(r.cadence.currentRun).toBe(1);
  });

  it('a 1:30 am session still counts for the evening before (the day turns at 4 am)', () => {
    // 15:00 (23:00 UTC) and 01:30 the next calendar day (09:30 UTC): UTC and plain local midnight both split them.
    const stamps = [LA_MIDNIGHT + 15 * HOUR, LA_MIDNIGHT + 25.5 * HOUR];
    const r = careerRecord(input(stamps), LA_MIDNIGHT + 26 * HOUR);
    expect(r.cadence.distinctDays).toBe(1);
  });
});

describe('dayKeyAt', () => {
  it('turns at 4 am local: 03:59 is yesterday, 04:00 is today', () => {
    const at = (h: number, m: number) => LA_MIDNIGHT + h * HOUR + m * 60_000;
    expect(dayKeyAt(at(3, 59), LA_OFFSET_MIN)).toBe(dayKeyAt(at(-1, 0), LA_OFFSET_MIN));
    expect(dayKeyAt(at(4, 0), LA_OFFSET_MIN)).toBe(dayKeyAt(at(23, 0), LA_OFFSET_MIN));
    expect(dayKeyAt(at(4, 0), LA_OFFSET_MIN) - dayKeyAt(at(3, 59), LA_OFFSET_MIN)).toBe(1);
  });

  it('looks the offset up per timestamp, so both sides of a DST change land on their own local day', () => {
    // US DST ended 2023-11-05 at 02:00 PDT. 20:00 local on Nov 4 (PDT, −420) and on Nov 5 (PST, −480).
    const nov4Evening = Date.UTC(2023, 10, 5, 3); // 20:00 PDT
    const nov5Evening = Date.UTC(2023, 10, 6, 4); // 20:00 PST
    const offsetAt = (ms: number) => (ms < Date.UTC(2023, 10, 5, 9) ? -420 : -480);
    const dst = (ms: number) => dayKeyAt(ms, offsetAt(ms));
    expect(dst(nov5Evening) - dst(nov4Evening)).toBe(1);
  });

  it('the system day function agrees with the machine’s own calendar', () => {
    const ms = Date.UTC(2024, 5, 1, 12);
    const local = new Date(ms);
    const viaDate = dayKeyAt(ms, -local.getTimezoneOffset());
    expect(systemDayKeyOf()(ms)).toBe(viaDate);
  });
});

describe('systemDayKeyOf in a real timezone', () => {
  it('follows America/Los_Angeles across the 2023-11-05 DST change, evening to evening', () => {
    const saved = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      // Skip honestly if this runtime ignores a TZ change after start (then the offset stays put).
      const pdt = new Date(Date.UTC(2023, 10, 5, 3)).getTimezoneOffset();
      const pst = new Date(Date.UTC(2023, 10, 6, 4)).getTimezoneOffset();
      expect([pdt, pst]).toEqual([420, 480]);
      const dayOf = systemDayKeyOf();
      const nov4Evening = Date.UTC(2023, 10, 5, 3); // 20:00 PDT
      const nov5Evening = Date.UTC(2023, 10, 6, 4); // 20:00 PST
      const nov5Early = Date.UTC(2023, 10, 5, 10, 30); // 02:30 PST, before the 4 am turn
      expect(dayOf(nov5Evening) - dayOf(nov4Evening)).toBe(1);
      expect(dayOf(nov5Early)).toBe(dayOf(nov4Evening));
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });
});
