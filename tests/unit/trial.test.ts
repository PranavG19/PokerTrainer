import { describe, expect, it } from 'vitest';
import {
  BLOCK_DAYS,
  KILL_CRITERIA,
  TRIAL_DAYS,
  blockOn,
  celebrationGate,
  characterOn,
  countBlock,
  defaultTrial,
  evaluate,
  finishTrial,
  layerOn,
  observeTrial,
  phaseOf,
  reportOn,
  setCelebrations,
  startRefusal,
  startTrial,
  stopTrial,
  type TrialClock,
  type TrialSource,
} from '../../src/core/trial.js';
import { fixedOffsetDayKeyOf, type DayKey } from '../../src/core/localDay.js';
import { defaultProgression, parseProgression, serializeProgression } from '../../src/core/progression/persist.js';
import type { FadingEvent } from '../../src/core/fading.js';
import type { ProgressionState, TrialCounts, TrialState } from '../../src/core/progression/types.js';

/**
 * The local trial (1.8, D15): on/off/on/off weeks, a prediction and criteria written before the start, per-week
 * counts from the learner's own logs, and a verdict that turns the layer off when a criterion trips.
 */

const UTC = fixedOffsetDayKeyOf(0);
const DAY = 86_400_000;
/** Noon UTC on day `d` (well clear of the 4 am turn). */
const noonOf = (d: number): number => d * DAY + 12 * 3_600_000;
const START = 20_000 as DayKey;
const day = (n: number): DayKey => (START + n) as DayKey;
const clockOn = (d: DayKey): TrialClock => ({ today: d, dayOf: UTC, hourOf: (ms) => new Date(ms).getUTCHours() });
const CAL = { total: 0, sureTotal: 0, sureCorrect: 0 };
const PREDICTION = 'With Dee on I practise on more days and my EV loss holds.';

function started(p: ProgressionState = defaultProgression()): ProgressionState {
  return startTrial(p, { prediction: PREDICTION, ownCriterion: 'I start dreading it.', today: START, calibration: CAL });
}

const src = (over: Partial<TrialSource> = {}): TrialSource => ({ hands: [], assessments: [], fadingLog: [], calibration: CAL, ...over });

describe('setup: written in advance, one trial per profile', () => {
  it('Start needs a sentence of prediction first', () => {
    expect(startRefusal(defaultTrial(), '')).toMatch(/prediction/);
    expect(startRefusal(defaultTrial(), 'short')).toMatch(/prediction/);
    expect(startRefusal(defaultTrial(), PREDICTION)).toBeNull();
    const p = defaultProgression();
    expect(startTrial(p, { prediction: 'nope', ownCriterion: '', today: START, calibration: CAL })).toBe(p);
  });

  it('starts running today, with four empty weeks and the Sure tallies as the baseline', () => {
    const p = startTrial(defaultProgression(), { prediction: `  ${PREDICTION}  `, ownCriterion: '', today: START, calibration: { total: 9, sureTotal: 4, sureCorrect: 3 } });
    expect(p.trial).toMatchObject({ status: 'running', startedOn: START, prediction: PREDICTION, baseline: { total: 9, sureTotal: 4, sureCorrect: 3 } });
    expect(p.trial.blocks).toEqual([null, null, null, null]);
  });

  it('a second start never replaces the first: a stopped or finished trial is kept', () => {
    const stopped = stopTrial(started());
    expect(stopped.trial.status).toBe('stopped');
    expect(startRefusal(stopped.trial, PREDICTION)).toMatch(/kept/);
    expect(startTrial(stopped, { prediction: 'Another prediction entirely.', ownCriterion: '', today: day(40), calibration: CAL })).toBe(stopped);
    expect(startTrial(started(), { prediction: 'Another prediction entirely.', ownCriterion: '', today: day(1), calibration: CAL }).trial.prediction).toBe(PREDICTION);
  });

  it('every kill criterion is fixed text, shown before the start', () => {
    expect(KILL_CRITERIA.map((k) => k.id)).toEqual(['ev-loss', 'delayed', 'sure-gaming', 'farming', 'late-night', 'busy-days', 'had-to']);
    for (const k of KILL_CRITERIA) expect(k.text.length).toBeGreaterThan(20);
  });
});

describe('the weeks: on, off, on, off', () => {
  it('blocks follow the start day, and the layer is off only in an off week', () => {
    const t = started().trial;
    expect(TRIAL_DAYS).toBe(4 * BLOCK_DAYS);
    expect([0, 6, 7, 13, 14, 21, 27].map((n) => blockOn(t, day(n)))).toEqual([0, 0, 1, 1, 2, 3, 3]);
    expect(blockOn(t, day(-1))).toBeNull();
    expect(blockOn(t, day(28))).toBeNull();
    expect([0, 7, 14, 21, 28].map((n) => layerOn(t, day(n)))).toEqual([true, false, true, false, true]);
    expect(layerOn(defaultTrial(), day(7))).toBe(true);
    expect(layerOn(stopTrial(started()).trial, day(7))).toBe(true);
  });

  it('phase: running for 28 days, then ready to read', () => {
    const t = started().trial;
    expect(phaseOf(defaultTrial(), START)).toBe('none');
    expect(phaseOf(t, day(27))).toBe('running');
    expect(phaseOf(t, day(28))).toBe('ready');
  });

  it('an off week hides Dee and the moment without changing either switch', () => {
    const p = started();
    expect(characterOn(p, day(8))).toBe(false);
    expect(p.dee.character).toBe(true);
    expect(characterOn(p, day(15))).toBe(true);
    expect(celebrationGate(p, true, day(8)).play).toBe(false);
    expect(p.celebrations.on).toBe(true);
    expect(celebrationGate(p, true, day(15)).play).toBe(true);
  });
});

describe('Celebrations: separate from Character, sound behind the sound switch (D13)', () => {
  it('the clack needs its own switch AND the app sound switch', () => {
    const p = defaultProgression();
    expect(celebrationGate(p, false, START)).toEqual({ play: true, still: false, sound: false });
    expect(celebrationGate(p, true, START)).toEqual({ play: true, still: false, sound: true });
    expect(celebrationGate(setCelebrations(p, { sound: false }), true, START).sound).toBe(false);
    expect(celebrationGate(setCelebrations(p, { on: false }), true, START)).toEqual({ play: false, still: false, sound: false });
  });

  it('reduced motion: "still" always; an unknown value follows the Mac', () => {
    const p = defaultProgression();
    expect(celebrationGate(setCelebrations(p, { motion: 'still' }), false, START).still).toBe(true);
    expect(celebrationGate(setCelebrations(p, { motion: 'from-a-newer-build' }), false, START).still).toBe(false);
  });

  it('Character off leaves Celebrations on, and the other way round', () => {
    const p = { ...defaultProgression(), dee: { ...defaultProgression().dee, character: false } };
    expect(celebrationGate(p, false, START).play).toBe(true);
    expect(characterOn(setCelebrations(defaultProgression(), { on: false }), START)).toBe(true);
  });
});

function graded(conceptId: string, at: number, correct: boolean): FadingEvent {
  return { kind: 'graded', conceptId, at, correct };
}

describe('counting a week from the learner’s own logs', () => {
  const t = started().trial;

  it('sessions split at 30-minute gaps; late ones and busy days are counted', () => {
    const d1 = noonOf(day(1));
    const hands = [d1, d1 + 10 * 60_000, d1 + 60 * 60_000, d1 + 3 * 3_600_000].map((at) => ({ playedAt: at, decisions: [{ verdict: {} }, { verdict: null }] }));
    // 23:30 on day 2 is a late session.
    const late = day(2) * DAY + 23.5 * 3_600_000;
    const c = countBlock(t, 0, src({ hands: [...hands, { playedAt: late, decisions: [] }] }), clockOn(day(3)));
    expect(c.sessions).toBe(4);
    expect(c.decisions).toBe(4);
    expect(c.busyDays).toBe(1);
    expect(c.lateSessions).toBe(1);
    expect(c.activeDays).toBe(2);
  });

  it('only the block’s own days count', () => {
    const c = countBlock(t, 0, src({ hands: [{ playedAt: noonOf(day(-1)) }, { playedAt: noonOf(day(7)) }, { playedAt: noonOf(day(6)) }] }), clockOn(day(6)));
    expect(c.sessions).toBe(1);
  });

  it('assessment EV loss is summed; negative or broken values never lower it', () => {
    const c = countBlock(t, 0, src({ assessments: [{ at: noonOf(day(1)), evLossBb: 1.5 }, { at: noonOf(day(1)) + 1, evLossBb: -3 }, { at: noonOf(day(1)) + 2, evLossBb: Number.NaN }] }), clockOn(day(1)));
    expect(c.assessed).toBe(3);
    expect(c.assessedLossBb).toBe(1.5);
  });

  it('a rep on a concept left 3+ days is a delayed test; a rep on a mastered concept is counted as such', () => {
    const before = Array.from({ length: 60 }, (_, i) => graded('pot-odds', noonOf(day(-10)) + i * 60_000, true));
    const log = [...before, graded('pot-odds', noonOf(day(1)), false), graded('pot-odds', noonOf(day(1)) + 60_000, true), graded('ranges', noonOf(day(2)), true)];
    const c = countBlock(t, 0, src({ fadingLog: log }), clockOn(day(2)));
    expect(c.reps).toBe(3);
    expect(c.delayed).toBe(1);
    expect(c.delayedCorrect).toBe(0);
    expect(c.repsOnMastered).toBeGreaterThanOrEqual(1);
    expect(c.repsOnMastered).toBeLessThanOrEqual(2);
  });

  it('observeTrial files the current week only, and a capped log never lowers it', () => {
    const p = started();
    const hands = [{ playedAt: noonOf(day(1)) }, { playedAt: noonOf(day(1)) + 2 * 3_600_000 }];
    const t1 = observeTrial(p.trial, src({ hands, calibration: { total: 5, sureTotal: 3, sureCorrect: 2 } }), clockOn(day(1)));
    expect(t1.blocks[0]?.counts.sessions).toBe(2);
    expect(t1.blocks[0]?.calibrationEnd).toEqual({ total: 5, sureTotal: 3, sureCorrect: 2 });
    expect(t1.blocks.slice(1)).toEqual([null, null, null]);
    // The hand log dropped the first hand: the week keeps its count.
    const t2 = observeTrial(t1, src({ hands: hands.slice(1), calibration: { total: 5, sureTotal: 3, sureCorrect: 2 } }), clockOn(day(2)));
    expect(t2.blocks[0]?.counts.sessions).toBe(2);
    // Nothing changed: the same object back (no needless save churn).
    expect(observeTrial(t2, src({ hands, calibration: { total: 5, sureTotal: 3, sureCorrect: 2 } }), clockOn(day(2)))).toBe(t2);
    // Week 2 starts from week 1's end tallies.
    const t3 = observeTrial(t2, src({ calibration: { total: 9, sureTotal: 7, sureCorrect: 3 } }), clockOn(day(8)));
    expect(t3.blocks[1]?.calibrationStart).toEqual({ total: 5, sureTotal: 3, sureCorrect: 2 });
    // After the four weeks, or with no trial, nothing is filed.
    expect(observeTrial(t3, src({ hands }), clockOn(day(30)))).toBe(t3);
    expect(observeTrial(defaultTrial(), src({ hands }), clockOn(day(1)))).toEqual(defaultTrial());
  });
});

const counts = (over: Partial<TrialCounts>): TrialCounts => ({
  activeDays: 5, sessions: 6, lateSessions: 0, busyDays: 0, decisions: 100, assessed: 40, assessedLossBb: 4, delayed: 25, delayedCorrect: 20, reps: 40, repsOnMastered: 4, ...over,
});

function withBlocks(on: Partial<TrialCounts>, off: Partial<TrialCounts>, sure?: { on: [number, number, number]; off: [number, number, number] }): TrialState {
  const t = started().trial;
  const cal = (v: [number, number, number] | undefined, base: number) =>
    v === undefined ? { calibrationStart: CAL, calibrationEnd: CAL } : { calibrationStart: { total: base, sureTotal: base, sureCorrect: base }, calibrationEnd: { total: base + v[0], sureTotal: base + v[1], sureCorrect: base + v[2] } };
  return {
    ...t,
    blocks: [
      { ...cal(sure?.on, 0), counts: counts(on) },
      { ...cal(sure?.off, 1000), counts: counts(off) },
      { ...cal(sure?.on, 2000), counts: counts(on) },
      { ...cal(sure?.off, 3000), counts: counts(off) },
    ],
  };
}

const statusOf = (t: TrialState, id: string) => evaluate(t).criteria.find((c) => c.id === id)?.status;

describe('the kill criteria', () => {
  it('equal weeks trip nothing', () => {
    const r = evaluate(withBlocks({}, {}));
    expect(r.tripped).toBe(false);
    expect(r.on.blocks).toBe(2);
    expect(r.on.counts.assessed).toBe(80);
  });

  it('EV loss more than 10% worse with the layer on trips; 10% or less does not; too few decisions cannot judge', () => {
    expect(statusOf(withBlocks({ assessedLossBb: 4.5 }, {}), 'ev-loss')).toBe('tripped');
    expect(statusOf(withBlocks({ assessedLossBb: 4.4 }, {}), 'ev-loss')).toBe('clear');
    expect(statusOf(withBlocks({ assessed: 10 }, {}), 'ev-loss')).toBe('too-little');
  });

  it('delayed-review accuracy 5 points lower trips', () => {
    expect(statusOf(withBlocks({ delayedCorrect: 18 }, {}), 'delayed')).toBe('tripped');
    expect(statusOf(withBlocks({ delayedCorrect: 19 }, {}), 'delayed')).toBe('clear');
    expect(statusOf(withBlocks({ delayed: 5, delayedCorrect: 0 }, {}), 'delayed')).toBe('too-little');
  });

  it('Sure gaming needs both: the rate up 10 and accuracy down 5', () => {
    // On: 60 tested, 45 Sure (75%), 30 right (67%). Off: 60 tested, 30 Sure (50%), 24 right (80%).
    expect(statusOf(withBlocks({}, {}, { on: [30, 22.5, 15], off: [30, 15, 12] }), 'sure-gaming')).toBe('tripped');
    // Rate up, accuracy the same: clear.
    expect(statusOf(withBlocks({}, {}, { on: [30, 22.5, 18], off: [30, 15, 12] }), 'sure-gaming')).toBe('clear');
    expect(statusOf(withBlocks({}, {}), 'sure-gaming')).toBe('too-little');
  });

  it('farming: 10 more points of reps on mastered concepts trips', () => {
    expect(statusOf(withBlocks({ repsOnMastered: 8 }, {}), 'farming')).toBe('tripped');
    expect(statusOf(withBlocks({ repsOnMastered: 7 }, {}), 'farming')).toBe('clear');
  });

  it('late sessions and busy days: more on than off, and at least two', () => {
    expect(statusOf(withBlocks({ lateSessions: 1 }, {}), 'late-night')).toBe('tripped');
    expect(statusOf(withBlocks({ lateSessions: 1 }, { lateSessions: 1 }), 'late-night')).toBe('clear');
    expect(statusOf(withBlocks({ busyDays: 1 }, {}), 'busy-days')).toBe('tripped');
  });

  it('"had to" in more than half the on-week answers trips; the answers are once a day, inside the weeks', () => {
    let p = started();
    p = reportOn(p, day(0), 'had');
    p = reportOn(p, day(1), 'had');
    p = reportOn(p, day(2), 'wanted');
    expect(statusOf(p.trial, 'had-to')).toBe('tripped');
    p = reportOn(p, day(1), 'wanted');
    expect(p.trial.reports).toHaveLength(3);
    expect(statusOf(p.trial, 'had-to')).toBe('clear');
    expect(reportOn(p, day(40), 'had')).toBe(p);
    expect(statusOf(started().trial, 'had-to')).toBe('too-little');
  });
});

describe('reading the results', () => {
  it('only after four weeks; a tripped criterion turns Character and Celebrations off', () => {
    const p = { ...started(), trial: withBlocks({ lateSessions: 3 }, {}) };
    expect(finishTrial(p, day(20))).toBe(p);
    const done = finishTrial(p, day(28));
    expect(done.trial).toMatchObject({ status: 'finished', finishedOn: day(28), outcome: 'off' });
    expect(done.dee.character).toBe(false);
    expect(done.celebrations.on).toBe(false);
    expect(phaseOf(done.trial, day(29))).toBe('finished');
    expect(layerOn(done.trial, day(29))).toBe(true);
  });

  it('nothing tripped: the layer stays as set', () => {
    const p = { ...started(), trial: withBlocks({}, {}) };
    const done = finishTrial(p, day(30));
    expect(done.trial.outcome).toBe('kept');
    expect(done.dee.character).toBe(true);
    expect(done.celebrations.on).toBe(true);
  });
});

describe('persisted: additive, tolerant, round-trips', () => {
  it('a profile without the new keys reads the defaults', () => {
    const p = parseProgression({});
    expect(p.trial).toEqual(defaultTrial());
    expect(p.celebrations).toEqual({ on: true, motion: 'system', sound: true });
    expect(p.dee.personality.quiet).toBe('standard');
  });

  it('a running trial round-trips exactly through JSON', () => {
    let p = started();
    p = { ...p, trial: observeTrial(p.trial, src({ hands: [{ playedAt: noonOf(day(1)) }] }), clockOn(day(1))) };
    p = reportOn(p, day(1), 'wanted');
    expect(parseProgression(JSON.parse(JSON.stringify(serializeProgression(p))))).toEqual(p);
  });

  it('garbage never throws and never invents a running trial', () => {
    for (const trial of [null, 7, 'x', [], { status: 'running' }, { status: 'running', startedOn: 'soon' }]) {
      const p = parseProgression({ trial });
      expect(['none'].includes(p.trial.status) || p.trial.status === 'running').toBe(true);
      expect(p.trial.status === 'running' ? p.trial.startedOn !== null : true).toBe(true);
    }
    const bad = parseProgression({ trial: { status: 'running', startedOn: 20000, blocks: [{ counts: { sessions: -4, assessedLossBb: 'x' } }, 'junk'], reports: [{ day: 20001, answer: 'had' }, { day: 20001, answer: 'wanted' }, { day: 'x' }] } });
    expect(bad.trial.blocks[0]?.counts.sessions).toBe(0);
    expect(bad.trial.blocks[1]).toBeNull();
    expect(bad.trial.reports).toEqual([{ day: 20001, answer: 'had' }]);
  });

  it('a newer build’s status, outcome and answer are kept as stored and read as defaults', () => {
    const p = parseProgression({ trial: { status: 'paused-by-v9', outcome: 'mixed', startedOn: 20000, reports: [{ day: 20001, answer: 'both' }] }, celebrations: { motion: 'gentle' } });
    expect(p.trial.status).toBe('paused-by-v9');
    expect(phaseOf(p.trial, day(1))).toBe('none');
    expect(p.trial.outcome).toBe('mixed');
    expect(evaluate(p.trial).on.had + evaluate(p.trial).on.wanted).toBe(0);
    expect(p.celebrations.motion).toBe('gentle');
  });
});
