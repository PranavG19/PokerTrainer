import { describe, it, expect } from 'vitest';
import { careerRecord, type CareerInput } from '../../src/core/career.js';
import { emptyCalibration, type Calibration } from '../../src/core/predict.js';
import type { SessionStats } from '../../src/core/session.js';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000; // fixed epoch ms; tests pass `now` in, never read the clock.

const emptyStats = (): SessionStats => ({
  handsPlayed: 0,
  vpipHands: 0,
  pfrHands: 0,
  evLossBb: 0,
  leaks: {},
  leakCostBb: {},
});

const baseInput = (over: Partial<CareerInput> = {}): CareerInput => ({
  decisions: [],
  masteredKcCount: 0,
  puzzleCoverage: 0,
  depthFloor: 0,
  stats: emptyStats(),
  calibration: emptyCalibration(),
  rebuys: 0,
  assessmentsTaken: 0,
  activityTimestamps: [],
  ...over,
});

describe('careerRecord — honest aggregate, fabricates nothing', () => {
  it('a fresh profile is all zeros / withheld, with no milestone achieved', () => {
    const r = careerRecord(baseInput(), NOW);
    expect(r.handsPlayed).toBe(0);
    expect(r.conceptsMastered).toBe(0);
    expect(r.puzzlesSolvedClean).toBe(0);
    expect(r.standing.depth).toBe(0);
    expect(r.depthLabel).toBe('Calibrating');
    expect(r.form).toBe('settling');
    expect(r.biggestLeak).toBeNull();
    // Untested calibration is WITHHELD, not shown as a fabricated 0%.
    expect(r.sureAccuracy).toBeNull();
    expect(r.guessAccuracy).toBeNull();
    expect(r.milestones.every((m) => !m.achieved)).toBe(true);
    expect(r.cadence.distinctDays).toBe(0);
    expect(r.cadence.currentRun).toBe(0);
    expect(r.cadence.last30).toHaveLength(30);
    expect(r.cadence.last30.every((d) => d === false)).toBe(true);
  });

  it('passes lifetime counts straight through from the derived inputs', () => {
    const r = careerRecord(
      baseInput({
        masteredKcCount: 5,
        puzzleCoverage: 3,
        assessmentsTaken: 2,
        rebuys: 4,
        stats: { ...emptyStats(), handsPlayed: 120 },
      }),
      NOW,
    );
    expect(r.handsPlayed).toBe(120);
    expect(r.conceptsMastered).toBe(5);
    expect(r.puzzlesSolvedClean).toBe(3);
    expect(r.assessmentsTaken).toBe(2);
    expect(r.rebuys).toBe(4);
  });
});

describe('milestones gate on effort/mastery, never on chips', () => {
  it('unlock at their thresholds on mastery counts and clean solves', () => {
    const r = careerRecord(baseInput({ masteredKcCount: 5, puzzleCoverage: 5, assessmentsTaken: 1 }), NOW);
    const by = Object.fromEntries(r.milestones.map((m) => [m.id, m.achieved]));
    expect(by['first-clean-solve']).toBe(true);
    expect(by['first-assessment']).toBe(true);
    expect(by['concepts-2']).toBe(true);
    expect(by['concepts-5']).toBe(true);
    expect(by['concepts-12']).toBe(false);
    expect(by['clean-solves-5']).toBe(true);
  });

  it('depth milestones read the ratcheted floor, so a losing session cannot revoke them', () => {
    // A deep floor with ZERO current decisions (a bad/short run): the milestone stays achieved because
    // the floor never drops — nothing here is tied to chips or recent results.
    const r = careerRecord(baseInput({ depthFloor: 125, decisions: [] }), NOW);
    const by = Object.fromEntries(r.milestones.map((m) => [m.id, m.achieved]));
    expect(by['depth-40']).toBe(true);
    expect(by['depth-75']).toBe(true);
    expect(by['depth-125']).toBe(true);
    expect(by['depth-200']).toBe(false);
    expect(r.standing.floor).toBe(125);
  });

  it('no milestone id references a chip/variance outcome', () => {
    const ids = careerRecord(baseInput(), NOW).milestones.map((m) => m.id).join(' ');
    for (const banned of ['win', 'won', 'profit', 'bankroll', 'downswing', 'lucky']) {
      expect(ids.includes(banned)).toBe(false);
    }
  });
});

describe('practice cadence counts days, and never punishes a gap', () => {
  it('counts DISTINCT days, collapsing many timestamps in one day to one', () => {
    const today = Math.floor(NOW / DAY) * DAY;
    const stamps = [today + 1000, today + 5_000_000, today - DAY + 2000, today - 2 * DAY];
    const r = careerRecord(baseInput({ activityTimestamps: stamps }), NOW);
    expect(r.cadence.distinctDays).toBe(3); // today, yesterday, two days ago — the two same-day stamps merge
  });

  it('currentRun counts consecutive days ending today; a gap ends the run without penalty elsewhere', () => {
    const today = Math.floor(NOW / DAY) * DAY;
    // today, -1, -2 present; -3 missing; -4 present. Run should be 3 (today back to -2), and the older
    // isolated day still counts toward distinctDays — a gap is not a reset-to-zero of the record.
    const stamps = [today, today - DAY, today - 2 * DAY, today - 4 * DAY];
    const r = careerRecord(baseInput({ activityTimestamps: stamps }), NOW);
    expect(r.cadence.currentRun).toBe(3);
    expect(r.cadence.distinctDays).toBe(4);
  });

  it('a run through yesterday (not yet played today) still reads, so mid-day gaps are not punished', () => {
    const today = Math.floor(NOW / DAY) * DAY;
    const stamps = [today - DAY, today - 2 * DAY];
    const r = careerRecord(baseInput({ activityTimestamps: stamps }), NOW);
    expect(r.cadence.currentRun).toBe(2);
  });

  it('ignores legacy/absent (0 or non-finite) timestamps rather than counting them', () => {
    const today = Math.floor(NOW / DAY) * DAY;
    const stamps = [today, 0, Number.NaN, -1];
    const r = careerRecord(baseInput({ activityTimestamps: stamps as number[] }), NOW);
    expect(r.cadence.distinctDays).toBe(1);
  });
});

describe('biggest leak and calibration are read honestly', () => {
  it('picks the single principle with the greatest total bb cost', () => {
    const stats: SessionStats = {
      ...emptyStats(),
      leakCostBb: { 'pot odds': 1.2, ranges: 8.4, 'value or bluff': 3.0 },
    };
    const r = careerRecord(baseInput({ stats }), NOW);
    expect(r.biggestLeak).toEqual({ principle: 'ranges', costBb: 8.4 });
  });

  it('splits sure vs guess accuracy, withholding a bucket that was never tested', () => {
    const cal: Calibration = {
      ...emptyCalibration(),
      total: 4,
      correct: 3,
      sureTotal: 4,
      sureCorrect: 3,
      guessTotal: 0,
      guessCorrect: 0,
    };
    const r = careerRecord(baseInput({ calibration: cal }), NOW);
    expect(r.sureAccuracy).toBeCloseTo(75, 6);
    expect(r.guessAccuracy).toBeNull(); // never guessed → withheld, not 0%
  });
});
