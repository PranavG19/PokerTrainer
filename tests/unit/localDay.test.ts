import { describe, expect, it } from 'vitest';
import { careerRecord, type CareerInput } from '../../src/core/career.js';
import { emptyCalibration } from '../../src/core/predict.js';

const HOUR = 3_600_000;
/** 2023-11-14 00:00 in UTC−8 (Los Angeles, standard time), as epoch ms. */
const LA_MIDNIGHT = Date.UTC(2023, 10, 14, 8);
const LA_OFFSET_MIN = -480;
/** The renderer's real day function for a learner in UTC−8 with the 4 am boundary. */
const laDay = (ms: number): number => Math.floor((ms + LA_OFFSET_MIN * 60_000 - 4 * HOUR) / 86_400_000);

const input = (activityTimestamps: number[]): CareerInput =>
  ({
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
  }) as CareerInput;

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
