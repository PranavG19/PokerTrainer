import { describe, expect, it } from 'vitest';
import { emptySession, recordAssessment, type HandRecord, type SessionState } from '../../src/core/session.js';
import { dayKeyAt, fixedOffsetDayKeyOf, type DayKey } from '../../src/core/localDay.js';
import { SCENARIOS } from '../../src/core/puzzleScenarios.js';
import { applyProgress, milestoneFacts, type ApplyContext } from '../../src/core/progression/apply.js';
import { parseProgression, serializeProgression } from '../../src/core/progression/persist.js';
import { syncMilestones } from '../../src/core/progression/milestones.js';
import {
  compareBlocks,
  recordSeasons,
  SEASON_DAYS,
  SEASON_EPOCH,
  seasonArchive,
  seasonBounds,
  seasonClock,
  seasonOf,
  seasonView,
  TRACK_STEPS,
  TRACK_WEEKS,
} from '../../src/core/progression/season.js';
import { testHooksFrom } from '../../src/core/testHooks.js';
import { RAIL_DAILY_REPS } from '../../src/core/progression/rail.js';
import { REPS_ASSESSMENT } from '../../src/core/progression/reps.js';
import { syncCosmetics } from '../../src/core/cosmetics/locker.js';

const dayOf = fixedOffsetDayKeyOf(0);

/**
 * THE TIME-TRAVEL TEST CLOCK. Each "launch" reads its instant the way main does under e2e (OFFSUIT_NOW through
 * testHooksFrom), and a later launch on the same profile is time travel, exactly as the e2e specs relaunch.
 */
function launchAt(iso: string): number {
  const now = testHooksFrom({ OFFSUIT_E2E: '1', OFFSUIT_NOW: iso }, false).now;
  if (now === null) throw new Error(`not a test instant: ${iso}`);
  return now;
}
const ctxAt = (now: number): ApplyContext => ({ now, dayOf, scenarios: SCENARIOS, leakPrinciple: null });

function save(prev: SessionState, next: SessionState, now: number): SessionState {
  return { ...next, progression: applyProgress(prev, next, {}, ctxAt(now)).progression };
}

function hand(at: number, graded: number): HandRecord {
  const decisions = Array.from({ length: graded }, () => ({
    street: 'flop' as const,
    board: [],
    pot: 100,
    toCall: 50,
    action: 'call' as const,
    amount: null,
    verdict: { severity: 'free' as const, evLossBb: 0, message: null, principle: null },
  }));
  return { handNumber: 1, hole: ['As', 'Kd'], board: [], net: 0, vpip: false, pfr: false, grades: [], playedAt: at, decisions };
}

/** A day's play: `hands` hands of 10 decisions (100 Reps each), saved. */
function play(s: SessionState, at: number, hands: number): SessionState {
  const fresh = Array.from({ length: hands }, (_, i) => hand(at + i * 1000, 10));
  return save(s, { ...s, hands: [...s.hands, ...fresh] }, at + hands * 1000);
}

/** A finished 30-spot assessment block at `at`, each spot losing `loss` bb, saved as the host saves it. */
function block(s: SessionState, at: number, loss: number | readonly number[]): SessionState {
  let next = s;
  for (let i = 0; i < 30; i++) {
    const x = typeof loss === 'number' ? loss : loss[i % loss.length];
    next = recordAssessment(next, { at, evLossBb: x, correct: x === 0, principle: null, toCall: 50, street: 'flop' });
  }
  return save(s, next, at + 1000);
}

describe('the season calendar', () => {
  it('Season 1 opens on Monday 5 January 2026; seasons are seven Monday-to-Sunday weeks', () => {
    expect(SEASON_EPOCH).toBe(dayOf(launchAt('2026-01-05T12:00:00Z')));
    expect(seasonOf(SEASON_EPOCH)).toBe(1);
    expect(seasonOf((SEASON_EPOCH + SEASON_DAYS - 1) as DayKey)).toBe(1);
    expect(seasonOf((SEASON_EPOCH + SEASON_DAYS) as DayKey)).toBe(2);
    expect(seasonOf((SEASON_EPOCH - 1) as DayKey)).toBe(0);
    const b = seasonBounds(6);
    expect(new Date(b.start * 86_400_000).toISOString().slice(0, 10)).toBe('2026-09-07');
    expect(new Date(b.finale * 86_400_000).toISOString().slice(0, 10)).toBe('2026-10-19');
    expect(new Date(b.end * 86_400_000).toISOString().slice(0, 10)).toBe('2026-10-25');
  });

  it('six track weeks, then the finale week', () => {
    const start = seasonBounds(3).start;
    expect(seasonClock(start)).toMatchObject({ season: 3, week: 1, phase: 'track', daysLeft: SEASON_DAYS });
    expect(seasonClock((start + TRACK_WEEKS * 7 - 1) as DayKey)).toMatchObject({ week: 6, phase: 'track' });
    expect(seasonClock((start + TRACK_WEEKS * 7) as DayKey)).toMatchObject({ week: 7, phase: 'finale', daysLeft: 7 });
  });

  it('follows the learner’s own night: 3 am local on the first Monday still belongs to the last season', () => {
    // UTC−5: 08:00Z is 3 am local, before the 4 am turn.
    const start = seasonBounds(7).start;
    const ms = start * 86_400_000 + 8 * 3_600_000;
    expect(seasonOf(dayKeyAt(ms, -300))).toBe(6);
    expect(seasonOf(dayKeyAt(ms + 2 * 3_600_000, -300))).toBe(7);
  });
});

describe('a season, travelled through with the test clock', () => {
  it('fills the free track from the Reps ledger, with the Rail’s daily rule', () => {
    let s = emptySession();
    // Week 1 of Season 6: 6 hands a day pays 600 Reps, of which 400 count.
    s = play(s, launchAt('2026-09-07T19:00:00Z'), 6);
    expect(s.progression.reps.total).toBe(600);
    expect(seasonView(s.progression.seasons, dayOf(launchAt('2026-09-07T22:00:00Z'))).reps).toBe(RAIL_DAILY_REPS);
    s = play(s, launchAt('2026-09-08T19:00:00Z'), 2);
    const v = seasonView(s.progression.seasons, dayOf(launchAt('2026-09-08T22:00:00Z')));
    expect(v.reps).toBe(600);
    expect(v.steps.filter((x) => x.reached).map((x) => x.target)).toEqual([150, 400]);
    // A replayed save pays nothing and files nothing.
    expect(save(s, s, launchAt('2026-09-08T23:00:00Z')).progression.seasons).toEqual(s.progression.seasons);
  });

  it('the opening block is the first of the track weeks; the finale is the first block of the finale week', () => {
    let s = emptySession();
    s = block(s, launchAt('2026-09-08T19:00:00Z'), 1.0); // the opening measure
    s = block(s, launchAt('2026-09-20T19:00:00Z'), 3.0); // a later practice block: not the opening
    expect(seasonView(s.progression.seasons, dayOf(launchAt('2026-09-21T10:00:00Z'))).finale).toBeNull();
    // Travel to the finale week (Mon 19 Oct) and take the delayed test.
    s = block(s, launchAt('2026-10-20T19:00:00Z'), 0.5);
    s = block(s, launchAt('2026-10-22T19:00:00Z'), 4.0); // a second finale-week block changes nothing
    const v = seasonView(s.progression.seasons, dayOf(launchAt('2026-10-23T10:00:00Z')));
    expect(v.clock).toMatchObject({ season: 6, phase: 'finale' });
    expect(v.baseline?.bbPer100).toBe(100);
    expect(v.finale?.bbPer100).toBe(50);
    expect(v.comparison).toEqual({ kind: 'apart', change: -50 });
    // The block's own Reps are the ledger's, paid once (no second payment for the finale).
    expect(s.progression.reps.total).toBe(4 * REPS_ASSESSMENT);
  });

  it('a finale with no opening block stands alone; overlapping intervals are a tie', () => {
    const one = { at: 1, loss: { n: 30, sum: 30, sumSq: 30 * 4 }, grader: 1 };
    const two = { at: 2, loss: { n: 30, sum: 27, sumSq: 30 * 4 }, grader: 1 };
    expect(compareBlocks(null, two)).toEqual({ kind: 'alone' });
    expect(compareBlocks(one, two).kind).toBe('tie');
  });

  it('one season, one grader: blocks graded by two versions are shown, never compared', () => {
    const start = seasonBounds(6).start;
    let st = recordSeasons({ records: [] }, [], [{ at: 1, day: start, losses: [1, 1, 1] }], 1);
    st = recordSeasons(st, [], [{ at: 2, day: (start + 43) as DayKey, losses: [0, 0, 0] }], 2);
    expect(seasonView(st, (start + 44) as DayKey).comparison).toEqual({ kind: 'graders' });
  });

  it('is archived the day after its finale week, with the tier held at its close', () => {
    let s = emptySession();
    // Six free hands in Season 6's first week (60 decisions): a judged week, settled up the next Monday.
    for (const d of ['07', '08', '09', '10', '11', '12', '14']) s = play(s, launchAt(`2026-09-${d}T19:00:00Z`), 1);
    s = block(s, launchAt('2026-10-21T19:00:00Z'), 1);
    const lastDay = dayOf(launchAt('2026-10-25T19:00:00Z'));
    expect(seasonArchive(s.progression.seasons, s.progression.rail, [], lastDay)).toEqual([]);
    // Relaunch in Season 7.
    const later = dayOf(launchAt('2026-10-26T19:00:00Z'));
    const archive = seasonArchive(s.progression.seasons, s.progression.rail, [later, (seasonBounds(6).start + 3) as DayKey], later);
    expect(archive).toHaveLength(1);
    expect(archive[0]).toMatchObject({ season: 6, tier: { id: 'three' }, seals: 1, comparison: { kind: 'alone' } });
    // Seven hands of 100 Reps, and the finale block's own 80.
    expect(archive[0].reps).toBe(700 + REPS_ASSESSMENT);
    expect(archive[0].stamps).toBe(TRACK_STEPS.filter((t) => t <= 700 + REPS_ASSESSMENT).length);
  });

  it('a long absence leaves the missed seasons empty, not invented', () => {
    let s = play(emptySession(), launchAt('2026-01-06T19:00:00Z'), 1);
    s = play(s, launchAt('2026-12-01T19:00:00Z'), 1);
    expect(s.progression.seasons.records.map((r) => r.season)).toEqual([1, 7]);
  });

  it('the finale and a filled track are milestones, and the track earns the seasonal rim', () => {
    let s = emptySession();
    const days = ['07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'];
    for (const d of days) s = play(s, launchAt(`2026-09-${d}T19:00:00Z`), 4);
    s = block(s, launchAt('2026-10-21T19:00:00Z'), 1);
    expect(s.progression.seasons.records[0].reps).toBeGreaterThanOrEqual(TRACK_STEPS[TRACK_STEPS.length - 1]);
    expect(s.progression.milestones.achieved['season-track']).toBeDefined();
    expect(s.progression.milestones.achieved['season-finale']).toBeDefined();
    expect(s.progression.cosmetics.owned).toContain('rim-season-stamp');
    // And the Rail's first move (a rated week) earned the Ghost rail felt.
    expect(s.progression.milestones.achieved['rail-first-move']).toBeDefined();
    expect(s.progression.cosmetics.owned).toContain('felt-ghost-rail');
    // The facts are the same ones a fresh sync reads.
    const facts = milestoneFacts(s, s.progression, SCENARIOS, 0);
    expect(syncMilestones(s.progression.milestones, facts, dayOf(Date.now()))).toBe(s.progression.milestones);
    expect(syncCosmetics(s.progression.cosmetics, { milestones: s.progression.milestones, seals: s.progression.seals, story: s.progression.story }, dayOf(Date.now()))).toBe(s.progression.cosmetics);
  });

  it('round-trips, and a corrupt record is dropped or emptied, never invented', () => {
    let s = play(emptySession(), launchAt('2026-09-08T19:00:00Z'), 2);
    s = block(s, launchAt('2026-09-09T19:00:00Z'), 1);
    expect(parseProgression(JSON.parse(JSON.stringify(serializeProgression(s.progression)))).seasons).toEqual(s.progression.seasons);
    const bad = parseProgression({
      seasons: {
        records: [
          { season: 'six', reps: 10 },
          { season: 6, reps: -4, grader: 'x', baseline: { at: -1, loss: { n: 3, sum: 1, sumSq: 1 } }, finale: { at: 5, loss: { n: 1, sum: 9, sumSq: 1 } } },
          { season: 6, reps: 999 },
        ],
      },
    }).seasons;
    expect(bad).toEqual({ records: [{ season: 6, reps: 0, grader: 1, baseline: null, finale: null }] });
  });
});
