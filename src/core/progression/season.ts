/**
 * OFFLINE SEASONS (BUILD-PLAN 2.7, VISION Pillar 3): seven local weeks, a free track, a delayed-test finale, and an
 * archive. Fully offline and local: nothing is fetched, and every install agrees on the calendar because it is
 * arithmetic on the learner's own DayKeys from one fixed epoch.
 *
 *  - THE CALENDAR. Season 1 opened on Monday 5 January 2026 (SEASON_EPOCH). Each season is six track weeks and one
 *    finale week, Monday to Monday at the learner's 4 am turn (localDay.ts), so its weeks are the Ghost Rail's weeks.
 *    The online ladder's seasons are UTC calendar months (online/ranked.ts `seasonOf`); a month does not hold whole
 *    local weeks, so the offline season keeps the Rail's week boundaries and borrows the online season's other rule:
 *    one season, one grader (below).
 *  - THE FREE TRACK. Stamps at fixed Reps, filled by the Reps the ledger pays during the season, counted by the Rail's
 *    daily rule (rail.ts RAIL_DAILY_REPS). There is only a free track: nothing is sold, and nothing is locked by it.
 *  - THE FINALE. The delayed test: an assessment block (assessmentBlock.ts: real random deals, the coach silent until
 *    the end) taken in the finale week, compared with the season's opening measure, the first block of its track
 *    weeks. Both numbers are the grader's (the coach's own evLossBb); the comparison is shown with both intervals and
 *    is called a tie when they overlap. The finale is open to anyone in the finale week, whatever the track says.
 *  - ONE SEASON, ONE GRADER. A season records the grader version (online/ranked.ts GRADER_VERSION) it opened with,
 *    and each block keeps its own. Two blocks graded by different versions are shown, never compared.
 *  - THE ARCHIVE. A season is archived the day after its finale week ends: its track, its finale and the Ghost Rail
 *    tier held at its close, kept for good.
 *
 * Pure: no clock. The caller passes the day; tests travel in time by passing later days.
 */

import type { DayKey } from '../localDay.js';
import { GRADER_VERSION, type Rating } from '../online/ranked.js';
import { MAX_SEASON_RECORDS } from './persist.js';
import { addLosses, EMPTY_LOSS, railRating, tierOn, type CountedEvent, type RailTier } from './rail.js';
import type { BlockScore, RailState, SeasonRecord, SeasonsState } from './types.js';

/** Monday 5 January 2026, as a DayKey: Season 1's first day. */
export const SEASON_EPOCH = 20_458 as DayKey;
export const TRACK_WEEKS = 6;
export const SEASON_WEEKS = TRACK_WEEKS + 1;
export const SEASON_DAYS = SEASON_WEEKS * 7;

/** The free track's stamps, in season Reps. About a 30-minute session's Reps is a stamp early on (VISION §4). */
export const TRACK_STEPS: readonly number[] = [150, 400, 750, 1200, 1700, 2300, 3000, 3800, 4700, 5600];

export function defaultSeasons(): SeasonsState {
  return { records: [] };
}

/** The season `day` falls in. Days before the epoch belong to Season 0 and earlier (a test clock can go there). */
export function seasonOf(day: DayKey): number {
  return Math.floor((day - SEASON_EPOCH) / SEASON_DAYS) + 1;
}

export interface SeasonBounds {
  /** The first day (a Monday). */
  readonly start: DayKey;
  /** The finale week's Monday. */
  readonly finale: DayKey;
  /** The last day (a Sunday). */
  readonly end: DayKey;
}

export function seasonBounds(season: number): SeasonBounds {
  const start = (SEASON_EPOCH + (season - 1) * SEASON_DAYS) as DayKey;
  return { start, finale: (start + TRACK_WEEKS * 7) as DayKey, end: (start + SEASON_DAYS - 1) as DayKey };
}

export type SeasonPhase = 'track' | 'finale';

export interface SeasonClock {
  readonly season: number;
  readonly bounds: SeasonBounds;
  /** 1..SEASON_WEEKS. */
  readonly week: number;
  readonly phase: SeasonPhase;
  /** Days left including today (1 on the last day). */
  readonly daysLeft: number;
}

export function seasonClock(day: DayKey): SeasonClock {
  const season = seasonOf(day);
  const bounds = seasonBounds(season);
  const week = Math.floor((day - bounds.start) / 7) + 1;
  return { season, bounds, week, phase: week > TRACK_WEEKS ? 'finale' : 'track', daysLeft: bounds.end - day + 1 };
}

// ── Recording ───────────────────────────────────────────────────────────────────────────────────────

/** An assessment block the ledger has just paid (its `assessment:<at>` key is new), with every spot's bb loss. */
export interface PaidBlock {
  readonly at: number;
  readonly day: DayKey;
  readonly losses: readonly number[];
}

function blank(season: number, grader: number): SeasonRecord {
  return { season, reps: 0, grader, baseline: null, finale: null };
}

/**
 * File the Reps and assessment blocks just paid into their seasons. The opening measure is the first block of the
 * track weeks and the finale the first block of the finale week; a later block in the same phase is a practice block
 * and changes neither (the first one is the test). Returns the same object when nothing is filed.
 */
export function recordSeasons(
  state: SeasonsState,
  events: readonly CountedEvent[],
  blocks: readonly PaidBlock[],
  grader: number = GRADER_VERSION,
): SeasonsState {
  const byId = new Map(state.records.map((r) => [r.season, r]));
  let changed = false;
  const get = (season: number): SeasonRecord => byId.get(season) ?? blank(season, grader);
  for (const e of events) {
    if (e.reps <= 0) continue;
    const s = seasonOf(e.day);
    const r = get(s);
    byId.set(s, { ...r, reps: r.reps + e.reps });
    changed = true;
  }
  for (const b of blocks) {
    if (b.losses.length === 0) continue;
    const clock = seasonClock(b.day);
    const r = get(clock.season);
    const score: BlockScore = { at: b.at, loss: addLosses(EMPTY_LOSS, b.losses), grader };
    if (clock.phase === 'track' && (r.baseline === null || b.at < r.baseline.at)) byId.set(clock.season, { ...r, baseline: score });
    else if (clock.phase === 'finale' && (r.finale === null || b.at < r.finale.at)) byId.set(clock.season, { ...r, finale: score });
    else continue;
    changed = true;
  }
  if (!changed) return state;
  const records = [...byId.values()].sort((a, b) => a.season - b.season).slice(-MAX_SEASON_RECORDS);
  return { records };
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────────────

export interface TrackStep {
  readonly target: number;
  readonly reached: boolean;
}

export function trackSteps(reps: number): TrackStep[] {
  return TRACK_STEPS.map((target) => ({ target, reached: reps >= target }));
}

export function trackFilled(reps: number): boolean {
  return reps >= TRACK_STEPS[TRACK_STEPS.length - 1];
}

export type Comparison =
  /** No opening measure this season: the finale stands alone. */
  | { readonly kind: 'alone' }
  /** Graded by two grader versions: shown, never compared. */
  | { readonly kind: 'graders' }
  /** The intervals overlap: the data cannot tell the two blocks apart. */
  | { readonly kind: 'tie'; readonly change: number }
  /** Lower loss at the finale (change < 0) or higher (change > 0), with the intervals apart. */
  | { readonly kind: 'apart'; readonly change: number };

export function compareBlocks(baseline: BlockScore | null, finale: BlockScore): Comparison {
  if (baseline === null) return { kind: 'alone' };
  if (baseline.grader !== finale.grader) return { kind: 'graders' };
  const a = railRating(baseline.loss);
  const b = railRating(finale.loss);
  const change = Math.round((b.bbPer100 - a.bbPer100) * 10) / 10;
  const overlap = b.low <= a.high && a.low <= b.high;
  return overlap ? { kind: 'tie', change } : { kind: 'apart', change };
}

export interface SeasonView {
  readonly clock: SeasonClock;
  readonly reps: number;
  readonly steps: readonly TrackStep[];
  readonly baseline: Rating | null;
  readonly finale: Rating | null;
  readonly comparison: Comparison | null;
  readonly grader: number;
}

/** The season `today` falls in, as the season screen shows it. */
export function seasonView(state: SeasonsState, today: DayKey): SeasonView {
  const clock = seasonClock(today);
  const r = state.records.find((x) => x.season === clock.season) ?? blank(clock.season, GRADER_VERSION);
  return {
    clock,
    reps: r.reps,
    steps: trackSteps(r.reps),
    baseline: r.baseline ? railRating(r.baseline.loss) : null,
    finale: r.finale ? railRating(r.finale.loss) : null,
    comparison: r.finale ? compareBlocks(r.baseline, r.finale) : null,
    grader: r.grader,
  };
}

export interface ArchivedSeason {
  readonly season: number;
  readonly bounds: SeasonBounds;
  readonly reps: number;
  readonly stamps: number;
  readonly baseline: Rating | null;
  readonly finale: Rating | null;
  readonly comparison: Comparison | null;
  /** The Ghost Rail tier held when the season closed. */
  readonly tier: RailTier;
  /** Seals (concepts mastered) first earned during the season. */
  readonly seals: number;
}

/** Every season that has ended and has a record, newest first. A season still running is never archived. */
export function seasonArchive(state: SeasonsState, rail: RailState, sealDays: readonly DayKey[], today: DayKey): ArchivedSeason[] {
  return state.records
    .filter((r) => seasonBounds(r.season).end < today)
    .sort((a, b) => b.season - a.season)
    .map((r) => {
      const bounds = seasonBounds(r.season);
      return {
        season: r.season,
        bounds,
        reps: r.reps,
        stamps: trackSteps(r.reps).filter((s) => s.reached).length,
        baseline: r.baseline ? railRating(r.baseline.loss) : null,
        finale: r.finale ? railRating(r.finale.loss) : null,
        comparison: r.finale ? compareBlocks(r.baseline, r.finale) : null,
        tier: tierOn(rail, bounds.end),
        seals: sealDays.filter((d) => d >= bounds.start && d <= bounds.end).length,
      };
    });
}

/** Seasons whose finale was taken, lifetime (a milestone fact). */
export function finalesTaken(state: SeasonsState): number {
  return state.records.filter((r) => r.finale !== null).length;
}

/** Seasons whose free track was filled, lifetime (a milestone fact). */
export function tracksFilled(state: SeasonsState): number {
  return state.records.filter((r) => trackFilled(r.reps)).length;
}
