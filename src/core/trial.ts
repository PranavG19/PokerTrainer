/**
 * THE LOCAL TRIAL (1.8, owner D15; PITCH §2.2): does the character-and-celebration layer earn its keep?
 *
 * - **Four weeks, on/off/on/off.** Block 1 starts the day the learner presses Start. In an off week Dee and the
 *   session-end moment are off whatever their switches say (`layerOn`); the switches themselves are never changed.
 * - **Written in advance.** The prediction and the kill criteria are fixed at the start: the prediction is the
 *   learner's own sentence, the criteria are KILL_CRITERIA (plus one optional sentence of their own). Neither can be
 *   edited once the trial runs.
 * - **Local metrics from what is already recorded:** the hand log, the assessment log, the drill log (fadingLog) and
 *   the Sure tallies. Each save during a block re-counts that block (`observeTrial`), so a log that is capped later
 *   (500 hands) cannot shrink a week already counted. Nothing is sent anywhere; this module has no I/O at all.
 * - **n = 1.** It can detect harm and a change in engagement, not prove a learning gain, and the results say so.
 *   If any criterion trips, the layer goes off by default when the results are read (`finishTrial`).
 *
 * Pure: every clock reading is the caller's (`today`, `dayOf`, `hourOf`).
 */

import { asDayKey, type DayKey, type DayKeyOf } from './localDay.js';
import { conceptStatesFromLog, gate } from './schedule.js';
import type { FadingEvent } from './fading.js';
import {
  CELEBRATION_MOTIONS,
  TRIAL_ANSWERS,
  TRIAL_OUTCOMES,
  TRIAL_STATUSES,
  type CelebrationsState,
  type ProgressionState,
  type TrialBlock,
  type TrialCalibration,
  type TrialCounts,
  type TrialReport,
  type TrialState,
} from './progression/types.js';

export const TRIAL_BLOCKS = ['on', 'off', 'on', 'off'] as const;
export type BlockKind = (typeof TRIAL_BLOCKS)[number];
export const BLOCK_DAYS = 7;
export const TRIAL_DAYS = TRIAL_BLOCKS.length * BLOCK_DAYS;
/** Activity more than this far apart is two sessions. */
export const SESSION_GAP_MS = 30 * 60_000;
/** A rep on a concept left this long is a delayed test (the app emits no decay probes yet; schedule.ts). */
export const DELAYED_REVIEW_DAYS = 3;
/** A session starting at or after 23:00 or before 04:00 local is a late one. */
export const LATE_FROM_HOUR = 23;
export const LATE_UNTIL_HOUR = 4;
/** More sessions than this in one day is a busy day (PITCH: "more than two sessions a day"). */
export const SESSIONS_PER_DAY = 2;
/** The prediction is a sentence, not a word. */
export const MIN_PREDICTION_CHARS = 12;
export const MAX_TRIAL_TEXT = 400;
const MAX_REPORTS = TRIAL_DAYS * 2;
const MS_PER_DAY = 86_400_000;

export type TrialStatus = (typeof TRIAL_STATUSES)[number];
export type TrialAnswer = (typeof TRIAL_ANSWERS)[number];
/** Where the trial stands today: 'ready' = four weeks are done and the results are waiting to be read. */
export type TrialPhase = 'none' | 'running' | 'ready' | 'stopped' | 'finished';

export function defaultTrial(): TrialState {
  return { status: 'none', startedOn: null, startedAt: null, prediction: '', ownCriterion: '', baseline: null, blocks: [], reports: [], finishedOn: null, outcome: null };
}

export function defaultCelebrations(): CelebrationsState {
  return { on: true, motion: 'system', sound: true };
}

export function emptyCounts(): TrialCounts {
  return { activeDays: 0, sessions: 0, lateSessions: 0, busyDays: 0, decisions: 0, assessed: 0, assessedLossBb: 0, delayed: 0, delayedCorrect: 0, reps: 0, repsOnMastered: 0 };
}

// ── phase ──────────────────────────────────────────────────────────────────────────────────────────

export function statusOf(t: TrialState): TrialStatus {
  return (TRIAL_STATUSES as readonly string[]).includes(t.status) ? (t.status as TrialStatus) : 'none';
}

export function phaseOf(t: TrialState, today: DayKey): TrialPhase {
  const status = statusOf(t);
  if (status !== 'running' || t.startedOn === null) return status === 'running' ? 'none' : status;
  return today - t.startedOn >= TRIAL_DAYS ? 'ready' : 'running';
}

/** The block index `day` falls in (0-based), or null outside the four weeks or with no trial running. */
export function blockOn(t: TrialState, day: DayKey): number | null {
  if (statusOf(t) !== 'running' || t.startedOn === null) return null;
  const offset = day - t.startedOn;
  if (offset < 0 || offset >= TRIAL_DAYS) return null;
  return Math.floor(offset / BLOCK_DAYS);
}

/** The first day of block `i`. */
export function blockStart(t: TrialState, i: number): DayKey | null {
  return t.startedOn === null ? null : ((t.startedOn + i * BLOCK_DAYS) as DayKey);
}

/** Whether the layer (Dee and the moment) may show today: always, except in an off week of a running trial. */
export function layerOn(t: TrialState, today: DayKey): boolean {
  const b = blockOn(t, today);
  return b === null || TRIAL_BLOCKS[b] === 'on';
}

/** The effective Character switch: the learner's setting, and not an off week. */
export function characterOn(p: ProgressionState, today: DayKey): boolean {
  return p.dee.character && layerOn(p.trial, today);
}

export interface CelebrationGate {
  /** Play the moment at all. */
  readonly play: boolean;
  /** Show it without motion even if the Mac allows motion. */
  readonly still: boolean;
  /** The milestone clack may sound: the celebration's own switch AND the app's sound switch (D13). */
  readonly sound: boolean;
}

/** What the session-end moment (1.10) may do today. The one reader of the Celebrations switches. */
export function celebrationGate(p: ProgressionState, soundCues: boolean, today: DayKey): CelebrationGate {
  const play = p.celebrations.on && layerOn(p.trial, today);
  return { play, still: motionOf(p.celebrations) === 'still', sound: play && soundCues && p.celebrations.sound };
}

export function motionOf(c: CelebrationsState): (typeof CELEBRATION_MOTIONS)[number] {
  return (CELEBRATION_MOTIONS as readonly string[]).includes(c.motion) ? (c.motion as (typeof CELEBRATION_MOTIONS)[number]) : 'system';
}

// ── writes ─────────────────────────────────────────────────────────────────────────────────────────

export function setCelebrations(p: ProgressionState, patch: Partial<CelebrationsState>): ProgressionState {
  return { ...p, celebrations: { ...p.celebrations, ...patch } };
}

/** Why Start is refused, or null. One trial per profile: a stopped or finished one is kept, never replaced. */
export function startRefusal(t: TrialState, prediction: string): string | null {
  // The raw status, not statusOf(): a newer build's status reads as 'none' but is a trial, and is never replaced.
  if (t.status !== 'none' || t.startedOn !== null) return 'This profile has had its trial. Its results are kept.';
  if (prediction.trim().length < MIN_PREDICTION_CHARS) return 'Write the prediction first: one sentence, before anything is measured.';
  return null;
}

export function startTrial(
  p: ProgressionState,
  input: {
    readonly prediction: string;
    readonly ownCriterion: string;
    readonly today: DayKey;
    readonly calibration: TrialCalibration;
    /** The instant of the press; activity before it is not counted. Absent = the whole start day counts. */
    readonly at?: number;
  },
): ProgressionState {
  if (startRefusal(p.trial, input.prediction) !== null) return p;
  return {
    ...p,
    trial: {
      ...defaultTrial(),
      status: 'running',
      startedOn: input.today,
      startedAt: input.at ?? null,
      prediction: clip(input.prediction),
      ownCriterion: clip(input.ownCriterion),
      baseline: { total: input.calibration.total, sureTotal: input.calibration.sureTotal, sureCorrect: input.calibration.sureCorrect },
      blocks: TRIAL_BLOCKS.map(() => null),
    },
  };
}

/** Stop early. What was counted is kept and readable; the layer goes back to its switches. */
export function stopTrial(p: ProgressionState): ProgressionState {
  return statusOf(p.trial) === 'running' ? { ...p, trial: { ...p.trial, status: 'stopped' } } : p;
}

/** The optional self-report, once a day, only while the four weeks run. A second answer the same day replaces it. */
export function reportOn(p: ProgressionState, day: DayKey, answer: TrialAnswer): ProgressionState {
  if (blockOn(p.trial, day) === null) return p;
  const reports = [...p.trial.reports.filter((r) => r.day !== day), { day, answer }].sort((a, b) => a.day - b.day);
  return { ...p, trial: { ...p.trial, reports } };
}

/**
 * Read the results and apply them: the four weeks are over, so the trial is finished. If any criterion tripped, the
 * layer goes off by default (Character and Celebrations off); the learner can turn either back on.
 */
export function finishTrial(p: ProgressionState, today: DayKey): ProgressionState {
  if (phaseOf(p.trial, today) !== 'ready') return p;
  const tripped = evaluate(p.trial).tripped;
  const trial: TrialState = { ...p.trial, status: 'finished', finishedOn: today, outcome: tripped ? 'off' : 'kept' };
  if (!tripped) return { ...p, trial };
  return { ...p, trial, dee: { ...p.dee, character: false }, celebrations: { ...p.celebrations, on: false } };
}

export function outcomeOf(t: TrialState): (typeof TRIAL_OUTCOMES)[number] | null {
  return (TRIAL_OUTCOMES as readonly string[]).includes(t.outcome ?? '') ? (t.outcome as (typeof TRIAL_OUTCOMES)[number]) : null;
}

// ── counting ───────────────────────────────────────────────────────────────────────────────────────

/** The parts of the profile a block is counted from. Structural, so this module does not import session.ts. */
export interface TrialSource {
  readonly hands: readonly { readonly playedAt?: number; readonly decisions?: readonly { readonly verdict: unknown }[] }[];
  readonly assessments: readonly { readonly at: number; readonly evLossBb: number }[];
  readonly fadingLog: readonly FadingEvent[];
  readonly calibration: TrialCalibration;
}

export interface TrialClock {
  readonly today: DayKey;
  readonly dayOf: DayKeyOf;
  /** The local hour (0–23) of an instant. */
  readonly hourOf: (ms: number) => number;
}

/**
 * Count what is new in the block that `today` falls in, and file it. Each save counts only activity newer than the
 * block's `through`, so the logs being capped later (500 hands) can neither shrink a counted week nor stop it
 * growing. A save with nothing new and no change in the Sure tallies files nothing.
 */
export function observeTrial(t: TrialState, src: TrialSource, clock: TrialClock): TrialState {
  const b = blockOn(t, clock.today);
  if (b === null) return t;
  const prev = t.blocks[b] ?? null;
  const tally = tallyBlock(t, b, src, clock, prev);
  const start = prev?.calibrationStart ?? latestCalibration(t, b);
  const end = maxCalibration(start, src.calibration);
  const calibrationMoved = JSON.stringify(end) !== JSON.stringify(prev?.calibrationEnd ?? start);
  if (!tally.fresh && !calibrationMoved) return t;
  const block: TrialBlock = { calibrationStart: start, calibrationEnd: end, counts: tally.counts, through: tally.through, sessionsByDay: tally.sessionsByDay };
  const blocks = TRIAL_BLOCKS.map((_, i) => (i === b ? block : (t.blocks[i] ?? null)));
  return { ...t, blocks };
}

/** The Sure tallies at the end of the latest earlier block with a save, else the baseline. */
function latestCalibration(t: TrialState, b: number): TrialCalibration {
  for (let i = b - 1; i >= 0; i--) {
    const blk = t.blocks[i];
    if (blk) return { ...blk.calibrationEnd };
  }
  return t.baseline ? { ...t.baseline } : { total: 0, sureTotal: 0, sureCorrect: 0 };
}

/** The tallies only ever grow; a reset (a profile restore) is clamped to the start so a block never goes negative. */
function maxCalibration(start: TrialCalibration, now: TrialCalibration): TrialCalibration {
  return { total: Math.max(start.total, now.total), sureTotal: Math.max(start.sureTotal, now.sureTotal), sureCorrect: Math.max(start.sureCorrect, now.sureCorrect) };
}

/** Count a whole block from the logs as they stand (no earlier counts). */
export function countBlock(t: TrialState, b: number, src: TrialSource, clock: TrialClock): TrialCounts {
  return tallyBlock(t, b, src, clock, null).counts;
}

type Graded = Extract<FadingEvent, { kind: 'graded' }>;

/** The block's counts: `prev`'s, plus every activity in the block newer than `prev.through` (and than Start). */
function tallyBlock(
  t: TrialState,
  b: number,
  src: TrialSource,
  clock: TrialClock,
  prev: TrialBlock | null,
): { counts: TrialCounts; through: number; sessionsByDay: Record<string, number>; fresh: boolean } {
  const c: TrialCounts = prev ? { ...prev.counts } : emptyCounts();
  const sessionsByDay: Record<string, number> = prev ? { ...prev.sessionsByDay } : {};
  const from = blockStart(t, b);
  const since = Math.max(prev?.through ?? -Infinity, t.startedAt !== null && Number.isFinite(t.startedAt) ? t.startedAt - 1 : -Infinity);
  if (from === null) return { counts: c, through: prev?.through ?? 0, sessionsByDay, fresh: false };
  const isNew = (ms: number): boolean => {
    if (!Number.isFinite(ms) || ms <= since) return false;
    const d = clock.dayOf(ms);
    return d >= from && d < from + BLOCK_DAYS;
  };
  const activity: number[] = [];

  for (const h of src.hands) {
    if (typeof h.playedAt !== 'number' || !isNew(h.playedAt)) continue;
    activity.push(h.playedAt);
    c.decisions += (h.decisions ?? []).filter((d) => d.verdict !== null && d.verdict !== undefined).length;
  }
  for (const a of src.assessments) {
    if (!isNew(a.at)) continue;
    activity.push(a.at);
    c.assessed += 1;
    c.assessedLossBb += Number.isFinite(a.evLossBb) ? Math.max(0, a.evLossBb) : 0;
  }

  // Drill reps: a delayed one tests what was kept; one on a concept already mastered is a sign of farming. Only the
  // concepts with a new rep are looked at, so a long history costs nothing on a save that added nothing.
  const fresh = src.fadingLog.filter((e): e is Graded => e.kind === 'graded' && isNew(e.at));
  const concepts = new Set(fresh.map((e) => e.conceptId));
  const history = new Map<string, Graded[]>();
  for (const e of src.fadingLog) {
    if (e.kind !== 'graded' || !concepts.has(e.conceptId) || !Number.isFinite(e.at)) continue;
    const list = history.get(e.conceptId) ?? [];
    list.push(e);
    history.set(e.conceptId, list);
  }
  for (const events of history.values()) {
    events.sort((x, y) => x.at - y.at);
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (!isNew(e.at)) continue;
      activity.push(e.at);
      c.reps += 1;
      if (i === 0) continue;
      if (e.at - events[i - 1].at >= DELAYED_REVIEW_DAYS * MS_PER_DAY) {
        c.delayed += 1;
        if (e.correct) c.delayedCorrect += 1;
      }
      const [state] = conceptStatesFromLog(events.slice(0, i));
      if (state !== undefined && gate(state, e.at).status === 'mastered') c.repsOnMastered += 1;
    }
  }

  // Sessions: activity split at gaps of more than SESSION_GAP_MS, each filed under the day and hour it started. The
  // newest activity already counted continues a session across saves.
  activity.sort((x, y) => x - y);
  let last = prev?.through ?? -Infinity;
  for (const at of activity) {
    if (at - last > SESSION_GAP_MS) {
      c.sessions += 1;
      const hour = clock.hourOf(at);
      if (hour >= LATE_FROM_HOUR || hour < LATE_UNTIL_HOUR) c.lateSessions += 1;
      const key = String(clock.dayOf(at));
      sessionsByDay[key] = (sessionsByDay[key] ?? 0) + 1;
    }
    last = Math.max(last, at);
  }
  c.activeDays = Object.keys(sessionsByDay).length;
  c.busyDays = Object.values(sessionsByDay).filter((n) => n > SESSIONS_PER_DAY).length;
  c.assessedLossBb = round2(c.assessedLossBb);
  return { counts: c, through: Math.max(prev?.through ?? 0, last === -Infinity ? 0 : last), sessionsByDay, fresh: activity.length > 0 };
}

// ── results ────────────────────────────────────────────────────────────────────────────────────────

/** One side of the comparison: the blocks of one kind, summed. */
export interface Side {
  readonly blocks: number;
  readonly counts: TrialCounts;
  /** Sure-tested predictions, how many were Sure, and how many of those were right. */
  readonly tested: number;
  readonly sure: number;
  readonly sureRight: number;
  /** The self-reports in this side's weeks. */
  readonly wanted: number;
  readonly had: number;
}

export type CriterionStatus = 'tripped' | 'clear' | 'too-little';

export interface CriterionResult {
  readonly id: KillCriterionId;
  readonly text: string;
  readonly status: CriterionStatus;
  /** The two numbers it compared, as plain text ('—' with no data). */
  readonly on: string;
  readonly off: string;
}

export interface TrialResults {
  readonly on: Side;
  readonly off: Side;
  readonly criteria: readonly CriterionResult[];
  /** Any criterion tripped: the layer goes off by default. */
  readonly tripped: boolean;
}

/** Minimum samples per side before a learning or gaming criterion may judge. Below it: too little to say. */
export const MIN_ASSESSED = 30;
export const MIN_DELAYED = 20;
export const MIN_SURE = 20;
export const MIN_REPS = 20;
export const MIN_REPORTS = 2;
export const MIN_SESSIONS = 5;
export const MIN_ACTIVE_DAYS = 3;

export const KILL_CRITERIA = [
  { id: 'ev-loss', text: `Assessment EV loss is more than 10% worse with the layer on (at least ${MIN_ASSESSED} assessed decisions each way).` },
  { id: 'delayed', text: `Delayed-review accuracy is 5 or more points lower with the layer on (at least ${MIN_DELAYED} delayed reps each way).` },
  { id: 'sure-gaming', text: `The Sure rate rises 10 or more points while Sure accuracy falls 5 or more (at least ${MIN_SURE} Sure calls each way).` },
  { id: 'farming', text: `The share of reps on already-mastered concepts rises 10 or more points (at least ${MIN_REPS} reps each way).` },
  { id: 'late-night', text: `The share of sessions started 23:00–04:00 rises 10 or more points, with at least two late (at least ${MIN_SESSIONS} sessions each way).` },
  { id: 'busy-days', text: `The share of practice days with more than two sessions rises 20 or more points, with at least two such days (at least ${MIN_ACTIVE_DAYS} days each way).` },
  { id: 'had-to', text: `More than half the "wanted to / had to" answers in on weeks say "had to" (at least ${MIN_REPORTS} answers).` },
] as const;
export type KillCriterionId = (typeof KILL_CRITERIA)[number]['id'];

export function sideOf(t: TrialState, kind: BlockKind): Side {
  const counts = emptyCounts();
  let blocks = 0;
  let tested = 0;
  let sure = 0;
  let sureRight = 0;
  let wanted = 0;
  let had = 0;
  TRIAL_BLOCKS.forEach((k, i) => {
    if (k !== kind) return;
    const from = blockStart(t, i);
    for (const r of t.reports) {
      if (from === null || r.day < from || r.day >= from + BLOCK_DAYS) continue;
      if (r.answer === 'wanted') wanted += 1;
      else if (r.answer === 'had') had += 1;
    }
    const blk = t.blocks[i];
    if (!blk) return;
    blocks += 1;
    for (const key of Object.keys(counts) as (keyof TrialCounts)[]) counts[key] += blk.counts[key];
    tested += Math.max(0, blk.calibrationEnd.total - blk.calibrationStart.total);
    sure += Math.max(0, blk.calibrationEnd.sureTotal - blk.calibrationStart.sureTotal);
    sureRight += Math.max(0, blk.calibrationEnd.sureCorrect - blk.calibrationStart.sureCorrect);
  });
  counts.assessedLossBb = round2(counts.assessedLossBb);
  return { blocks, counts, tested, sure, sureRight, wanted, had };
}

/** bb lost per 100 assessed decisions, or null with none. */
export function evLossPer100(s: Side): number | null {
  return s.counts.assessed > 0 ? round1((s.counts.assessedLossBb / s.counts.assessed) * 100) : null;
}

const pct = (n: number, d: number): number | null => (d > 0 ? round1((n / d) * 100) : null);
const show = (v: number | null, unit: string): string => (v === null ? '—' : `${v}${unit}`);

export function evaluate(t: TrialState): TrialResults {
  const on = sideOf(t, 'on');
  const off = sideOf(t, 'off');
  const results: CriterionResult[] = [];
  const add = (id: KillCriterionId, status: CriterionStatus, onText: string, offText: string): void => {
    const text = KILL_CRITERIA.find((k) => k.id === id)?.text ?? id;
    results.push({ id, text, status, on: onText, off: offText });
  };

  const evOn = evLossPer100(on);
  const evOff = evLossPer100(off);
  add(
    'ev-loss',
    on.counts.assessed < MIN_ASSESSED || off.counts.assessed < MIN_ASSESSED || evOn === null || evOff === null
      ? 'too-little'
      : evOn > evOff * 1.1 && evOn > evOff
        ? 'tripped'
        : 'clear',
    show(evOn, ' bb/100'),
    show(evOff, ' bb/100'),
  );

  const dOn = pct(on.counts.delayedCorrect, on.counts.delayed);
  const dOff = pct(off.counts.delayedCorrect, off.counts.delayed);
  add('delayed', on.counts.delayed < MIN_DELAYED || off.counts.delayed < MIN_DELAYED || dOn === null || dOff === null ? 'too-little' : dOff - dOn >= 5 ? 'tripped' : 'clear', show(dOn, '%'), show(dOff, '%'));

  const rateOn = pct(on.sure, on.tested);
  const rateOff = pct(off.sure, off.tested);
  const accOn = pct(on.sureRight, on.sure);
  const accOff = pct(off.sureRight, off.sure);
  add(
    'sure-gaming',
    on.sure < MIN_SURE || off.sure < MIN_SURE || rateOn === null || rateOff === null || accOn === null || accOff === null
      ? 'too-little'
      : rateOn - rateOff >= 10 && accOff - accOn >= 5
        ? 'tripped'
        : 'clear',
    `${show(rateOn, '%')} Sure, ${show(accOn, '%')} right`,
    `${show(rateOff, '%')} Sure, ${show(accOff, '%')} right`,
  );

  const fOn = pct(on.counts.repsOnMastered, on.counts.reps);
  const fOff = pct(off.counts.repsOnMastered, off.counts.reps);
  add('farming', on.counts.reps < MIN_REPS || off.counts.reps < MIN_REPS || fOn === null || fOff === null ? 'too-little' : fOn - fOff >= 10 ? 'tripped' : 'clear', show(fOn, '%'), show(fOff, '%'));

  // Rates, not totals: an on week that simply holds more practice must not trip these by volume alone.
  const lateOn = pct(on.counts.lateSessions, on.counts.sessions);
  const lateOff = pct(off.counts.lateSessions, off.counts.sessions);
  add(
    'late-night',
    on.counts.sessions < MIN_SESSIONS || off.counts.sessions < MIN_SESSIONS || lateOn === null || lateOff === null
      ? 'too-little'
      : on.counts.lateSessions >= 2 && lateOn - lateOff >= 10
        ? 'tripped'
        : 'clear',
    `${show(lateOn, '%')} (${on.counts.lateSessions})`,
    `${show(lateOff, '%')} (${off.counts.lateSessions})`,
  );
  const busyOn = pct(on.counts.busyDays, on.counts.activeDays);
  const busyOff = pct(off.counts.busyDays, off.counts.activeDays);
  add(
    'busy-days',
    on.counts.activeDays < MIN_ACTIVE_DAYS || off.counts.activeDays < MIN_ACTIVE_DAYS || busyOn === null || busyOff === null
      ? 'too-little'
      : on.counts.busyDays >= 2 && busyOn - busyOff >= 20
        ? 'tripped'
        : 'clear',
    `${show(busyOn, '%')} (${on.counts.busyDays})`,
    `${show(busyOff, '%')} (${off.counts.busyDays})`,
  );

  const answers = on.wanted + on.had;
  add('had-to', answers < MIN_REPORTS ? 'too-little' : on.had * 2 > answers ? 'tripped' : 'clear', `${on.had} of ${answers} "had to"`, `${off.had} of ${off.wanted + off.had} "had to"`);

  return { on, off, criteria: results, tripped: results.some((r) => r.status === 'tripped') };
}

// ── parsing (persist.ts calls these; tolerant: bad input → default, never throw) ────────────────────

export function parseCelebrations(obj: Record<string, unknown>, d: CelebrationsState): CelebrationsState {
  return {
    on: typeof obj.on === 'boolean' ? obj.on : d.on,
    motion: idOf(obj.motion) ?? d.motion,
    sound: typeof obj.sound === 'boolean' ? obj.sound : d.sound,
  };
}

export function parseTrial(obj: Record<string, unknown>, d: TrialState): TrialState {
  const startedOn = asDayKey(obj.startedOn);
  const status = idOf(obj.status) ?? d.status;
  const blocksRaw = Array.isArray(obj.blocks) ? obj.blocks : [];
  const reports: TrialReport[] = [];
  const seen = new Set<number>();
  for (const v of Array.isArray(obj.reports) ? obj.reports : []) {
    const r = record(v);
    const day = asDayKey(r.day);
    const answer = idOf(r.answer);
    if (day === null || answer === null || seen.has(day)) continue;
    seen.add(day);
    reports.push({ day, answer });
  }
  reports.sort((a, b) => a.day - b.day);
  return {
    // A running trial with no start day is no trial: nothing could place a block.
    status: status === 'running' && startedOn === null ? 'none' : status,
    startedOn,
    startedAt: typeof obj.startedAt === 'number' && Number.isFinite(obj.startedAt) && obj.startedAt > 0 ? obj.startedAt : null,
    prediction: textOf(obj.prediction),
    ownCriterion: textOf(obj.ownCriterion),
    baseline: obj.baseline === null || obj.baseline === undefined ? null : parseCalibration(obj.baseline),
    blocks: TRIAL_BLOCKS.map((_, i) => parseBlock(blocksRaw[i])).slice(0, startedOn === null ? 0 : TRIAL_BLOCKS.length),
    reports: reports.slice(-MAX_REPORTS),
    finishedOn: asDayKey(obj.finishedOn),
    outcome: idOf(obj.outcome),
  };
}

function parseBlock(raw: unknown): TrialBlock | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const counts = emptyCounts();
  const c = record(r.counts);
  for (const k of Object.keys(counts) as (keyof TrialCounts)[]) counts[k] = k === 'assessedLossBb' ? round2(nonNegative(c[k])) : Math.floor(nonNegative(c[k]));
  const start = parseCalibration(r.calibrationStart);
  const end = parseCalibration(r.calibrationEnd);
  const sessionsByDay: Record<string, number> = {};
  for (const [k, v] of Object.entries(record(r.sessionsByDay)).slice(0, BLOCK_DAYS)) {
    if (k === '__proto__' || asDayKey(Number(k)) === null) continue;
    const n = Math.floor(nonNegative(v));
    if (n > 0) sessionsByDay[k] = n;
  }
  return { calibrationStart: start, calibrationEnd: maxCalibration(start, end), counts, through: typeof r.through === 'number' && Number.isFinite(r.through) && r.through > 0 ? r.through : 0, sessionsByDay };
}

function parseCalibration(raw: unknown): TrialCalibration {
  const r = record(raw);
  return { total: Math.floor(nonNegative(r.total)), sureTotal: Math.floor(nonNegative(r.sureTotal)), sureCorrect: Math.floor(nonNegative(r.sureCorrect)) };
}

function record(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function nonNegative(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, 1e9) : 0;
}

function idOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 && s.length <= 64 ? s : null;
}

function textOf(v: unknown): string {
  return typeof v === 'string' ? clip(v) : '';
}

function clip(s: string): string {
  return s.trim().slice(0, MAX_TRIAL_TEXT);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
