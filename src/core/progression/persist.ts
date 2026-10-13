/**
 * Defaults, validation and (de)serialisation for the `progression` namespace (types.ts).
 *
 * Tolerant like every parser in session.ts, and partitioned: each sub-namespace (streak, reps, …) is
 * parsed on its own, so one corrupt section falls back to its defaults without touching the others or
 * the rest of the profile. Within a section a bad entry is dropped, a bad scalar takes its default,
 * and a count is clamped — never invented.
 */

import { asDayKey, DAY_BOUNDARY_HOUR, type DayKey } from '../localDay.js';
import { chalk, reps } from '../units.js';
import { MAX_TOKEN_CHARS, normalizeToken } from '../entitlements/token.js';
import {
  CHALK_DAILY_CAP,
  COSMETIC_SLOTS,
  DEE_FREQUENCIES,
  DEE_TONES,
  KNOWN_TIERS,
  type ChalkLedger,
  type CosmeticSlot,
  type CosmeticsState,
  type DeeMemory,
  type DeeSaid,
  type EntitlementsState,
  type StreakState,
  type MilestonesState,
  type Personalization,
  type PracticeSchedule,
  type ProgressionState,
  type Receipt,
  type RememberedSentence,
  type RepAward,
  type RepsState,
  type SealsState,
  CHAPTER_RESULTS,
  RIVAL_ACTION_KINDS,
  RIVAL_ACTION_STREETS,
  type ChapterProgress,
  type RivalAction,
  type RivalRecord,
  type RivalSitting,
  type ShowdownRecord,
  type StoryOverride,
  type StoryState,
} from './types.js';

/** Two years of counted days: a calendar strip shows weeks, so this is generous. */
export const MAX_STREAK_DAYS = 730;
export const MAX_REP_AWARDS = 500;
export const MAX_RECEIPTS = 500;
export const MAX_REMEMBERED_SENTENCES = 100;
export const MAX_DEE_SAID = 64;
export const MAX_GOALS = 2;
export const MAX_STORY_OVERRIDES = 100;
export const MAX_RIVAL_SITTINGS = 60;
export const MAX_RIVAL_SHOWDOWNS = 200;
/** A heads-up hand rarely runs past a dozen actions a side; anything longer is corruption. */
const MAX_RIVAL_ACTIONS = 40;
/** Ids and enum-like answers. */
const MAX_ID_CHARS = 64;
/** A rule sentence, a receipt fact. */
const MAX_TEXT_CHARS = 280;
const MAX_LIST = 200;

export function defaultProgression(): ProgressionState {
  return {
    streak: { boundaryHour: DAY_BOUNDARY_HOUR, current: 0, best: 0, lastCountedDay: null, countedDays: [] },
    reps: { total: reps(0), awards: [] },
    seals: { earned: {} },
    cosmetics: {
      owned: [],
      equipped: {},
      receipts: [],
      chalk: { balance: chalk(0), day: null, earnedToday: chalk(0) },
    },
    dee: {
      ruleSentences: [],
      keepsakes: [],
      lastGreeting: null,
      personality: { tone: 'warm', frequency: 'normal' },
      character: true,
      handsWatched: 0,
      said: [],
    },
    personalization: {
      answeredOn: null,
      displayName: null,
      goals: [],
      format: null,
      stakes: null,
      experience: null,
      why: [],
      schedule: null,
    },
    milestones: { achieved: {} },
    entitlements: { tier: 'free', granted: [], licence: null, highWater: 0 },
    story: { chapters: {}, rivals: {}, overrides: [] },
  };
}

/**
 * The key tree of everything this build reads, for profileSchema.ts's unknown-key carry. A nested
 * object here means "a fixed-shape object: keep keys I do not list"; `true` means the value is owned
 * whole by the parser above (scalars, lists and id-keyed maps), so nothing inside it is carried.
 */
export const PROGRESSION_SHAPE = {
  streak: { boundaryHour: true, current: true, best: true, lastCountedDay: true, countedDays: true },
  reps: { total: true, awards: true },
  seals: { earned: true },
  cosmetics: {
    owned: true,
    equipped: true,
    receipts: true,
    chalk: { balance: true, day: true, earnedToday: true },
  },
  dee: {
    ruleSentences: true,
    keepsakes: true,
    lastGreeting: true,
    personality: { tone: true, frequency: true },
    character: true,
    handsWatched: true,
    said: true,
  },
  personalization: {
    answeredOn: true,
    displayName: true,
    goals: true,
    format: true,
    stakes: true,
    experience: true,
    why: true,
    schedule: true,
  },
  milestones: { achieved: true },
  entitlements: { tier: true, granted: true, licence: true, highWater: true },
  story: { chapters: true, rivals: true, overrides: true },
} as const;

export function parseProgression(raw: unknown): ProgressionState {
  const obj = asRecord(raw);
  const d = defaultProgression();
  return {
    streak: section(obj.streak, d.streak, parseStreak),
    reps: section(obj.reps, d.reps, parseReps),
    seals: section(obj.seals, d.seals, parseSeals),
    cosmetics: section(obj.cosmetics, d.cosmetics, parseCosmetics),
    dee: section(obj.dee, d.dee, parseDee),
    personalization: section(obj.personalization, d.personalization, parsePersonalization),
    milestones: section(obj.milestones, d.milestones, parseMilestones),
    entitlements: section(obj.entitlements, d.entitlements, parseEntitlements),
    story: section(obj.story, d.story, parseStory),
  };
}

/** Detached plain JSON. A round trip through parseProgression is the identity on valid data. */
export function serializeProgression(p: ProgressionState): Record<string, unknown> {
  return structuredClone(p) as unknown as Record<string, unknown>;
}

/** A section that is not an object, or whose parser throws on something unforeseen, is its defaults. */
function section<T>(raw: unknown, fallback: T, parse: (obj: Record<string, unknown>, d: T) => T): T {
  if (!isPlainObject(raw)) return fallback;
  try {
    return parse(raw, fallback);
  } catch {
    return fallback;
  }
}

/** No run or record is longer than a century of days; anything above is corruption. */
const MAX_RUN = 36_500;

/**
 * The counted-day history is the source of truth. The last counted day is the newest day in it, and the
 * run is the history's trailing run. A stored `current` is believed only where the history cannot speak:
 * when the run fills the whole bounded history (so it may really be longer) and the stored last day
 * agrees. So a corrupt count can neither invent a run across a gap nor cut a real one short.
 */
function parseStreak(obj: Record<string, unknown>, d: StreakState): StreakState {
  const countedDays = dayList(obj.countedDays, MAX_STREAK_DAYS);
  const lastCountedDay = countedDays.length > 0 ? countedDays[countedDays.length - 1] : null;
  const logged = lastCountedDay === null ? 0 : runEndingOn(countedDays, lastCountedDay);
  const historyIsFullRun = logged === MAX_STREAK_DAYS && asDayKey(obj.lastCountedDay) === lastCountedDay;
  const current = historyIsFullRun ? Math.min(MAX_RUN, Math.max(logged, nonNegativeInt(obj.current))) : logged;
  return {
    boundaryHour: intIn(obj.boundaryHour, 0, 23, d.boundaryHour),
    current,
    // The record may predate the bounded history, so it is kept as stored, but never below the run.
    best: Math.max(current, Math.min(MAX_RUN, nonNegativeInt(obj.best))),
    lastCountedDay,
    countedDays,
  };
}

/** Consecutive days in an ascending, unique list ending exactly on `day` (0 if `day` is not in it). */
function runEndingOn(days: readonly DayKey[], day: DayKey): number {
  let i = days.length - 1;
  while (i >= 0 && days[i] > day) i--;
  let run = 0;
  while (i >= 0 && days[i] === day - run) {
    run++;
    i--;
  }
  return run;
}

/**
 * The streak as the learner should see it on `today`: the stored run if the last counted day was today or
 * yesterday (today can still count), else 0, because a missed day resets it. A last day in the future
 * (a clock that ran fast) reads 0 too, until a session corrects it. The best run is untouched.
 */
export function currentStreakOn(streak: StreakState, today: DayKey): number {
  if (streak.lastCountedDay === null) return 0;
  const gap = today - streak.lastCountedDay;
  return gap === 0 || gap === 1 ? streak.current : 0;
}

/**
 * Count a finished session on `day`. The same day again changes nothing; the next day extends the run;
 * a gap starts a new run at 1. One day back changes nothing (travel or DST around the 4 am turn). More
 * than one day before the last counted one means the clock was wrong (it ran fast, or the day is corrupt): the counted days after `day` are dropped and the run recomputed from the
 * history before `day` counts, so a bad clock can never freeze the streak. The best run is a record and
 * is kept.
 */
export function countSession(streak: StreakState, day: DayKey): StreakState {
  const last = streak.lastCountedDay;
  // One day back is the 4 am turn seen from a westward flight or a DST change, not a wrong clock: the
  // session belongs to a day already counted, so nothing changes.
  if (last !== null && (day === last || day === last - 1)) return streak;
  if (last !== null && day < last) {
    const kept = streak.countedDays.filter((d) => d <= day);
    const newest = kept.length > 0 ? kept[kept.length - 1] : null;
    const corrected: StreakState = {
      ...streak,
      countedDays: kept,
      lastCountedDay: newest,
      current: newest === null ? 0 : runEndingOn(kept, newest),
    };
    return newest === day ? corrected : countSession(corrected, day);
  }
  const current = last !== null && day - last === 1 ? streak.current + 1 : 1;
  return {
    ...streak,
    current,
    best: Math.max(streak.best, current),
    lastCountedDay: day,
    countedDays: [...streak.countedDays, day].slice(-MAX_STREAK_DAYS),
  };
}

function parseReps(obj: Record<string, unknown>): RepsState {
  const seen = new Set<string>();
  const awards: RepAward[] = [];
  for (const value of asArray(obj.awards)) {
    const entry = asRecord(value);
    const key = id(entry.key);
    const day = asDayKey(entry.day);
    if (key === null || day === null || seen.has(key)) continue;
    seen.add(key);
    awards.push({ key, reps: reps(asNumber(entry.reps)), day });
  }
  const kept = awards.slice(-MAX_REP_AWARDS);
  const logged = kept.reduce((sum, a) => sum + a.reps, 0);
  // Lifetime is at least what the log still shows: a corrupt total cannot erase logged effort.
  return { total: reps(Math.max(asNumber(obj.total), logged)), awards: kept };
}

function parseSeals(obj: Record<string, unknown>): SealsState {
  return { earned: dayReceipts(obj.earned) };
}

function parseMilestones(obj: Record<string, unknown>): MilestonesState {
  return { achieved: dayReceipts(obj.achieved) };
}

function parseCosmetics(obj: Record<string, unknown>, d: CosmeticsState): CosmeticsState {
  const owned = idList(obj.owned, MAX_LIST * 5);
  const ownedSet = new Set(owned);
  const equippedRaw = asRecord(obj.equipped);
  const equipped: Partial<Record<CosmeticSlot, string>> = {};
  for (const slot of COSMETIC_SLOTS) {
    const item = id(equippedRaw[slot]);
    // Equipping is only ever of something owned; a dangling equip is dropped, not granted.
    if (item !== null && ownedSet.has(item)) equipped[slot] = item;
  }
  const receipts: Receipt[] = [];
  for (const value of asArray(obj.receipts)) {
    const entry = asRecord(value);
    const itemId = id(entry.itemId);
    const day = asDayKey(entry.day);
    const fact = text(entry.fact);
    if (itemId === null || day === null || fact === null) continue;
    receipts.push({ itemId, day, fact, chalk: chalk(asNumber(entry.chalk)) });
  }
  return {
    owned,
    equipped,
    receipts: receipts.slice(-MAX_RECEIPTS),
    chalk: isPlainObject(obj.chalk) ? parseChalk(obj.chalk) : d.chalk,
  };
}

function parseChalk(obj: Record<string, unknown>): ChalkLedger {
  const day = asDayKey(obj.day);
  return {
    balance: chalk(asNumber(obj.balance)),
    day,
    // Without a day the cap bookkeeping is meaningless; clamp so a corrupt count cannot exceed the cap.
    earnedToday: day === null ? chalk(0) : chalk(Math.min(CHALK_DAILY_CAP, asNumber(obj.earnedToday))),
  };
}

function parseDee(obj: Record<string, unknown>, d: DeeMemory): DeeMemory {
  const sentences: RememberedSentence[] = [];
  for (const value of asArray(obj.ruleSentences)) {
    const entry = asRecord(value);
    const conceptId = id(entry.conceptId);
    const sentence = text(entry.text);
    const day = asDayKey(entry.day);
    if (conceptId === null || sentence === null || day === null) continue;
    sentences.push({ conceptId, text: sentence, day });
  }
  const greeting = asRecord(obj.lastGreeting);
  const greetingDay = asDayKey(greeting.day);
  const lineId = id(greeting.lineId);
  const personality = asRecord(obj.personality);
  return {
    ruleSentences: sentences.slice(-MAX_REMEMBERED_SENTENCES),
    keepsakes: idList(obj.keepsakes, MAX_LIST),
    lastGreeting: greetingDay !== null && lineId !== null ? { day: greetingDay, lineId } : null,
    personality: {
      tone: id(personality.tone) ?? d.personality.tone,
      frequency: id(personality.frequency) ?? d.personality.frequency,
    },
    character: typeof obj.character === 'boolean' ? obj.character : d.character,
    handsWatched: Math.min(MAX_RUN * 1000, nonNegativeInt(obj.handsWatched)),
    said: parseSaid(obj.said),
  };
}

/** Recent lines: a bad entry is dropped; a hand count is clamped to the lifetime count by the reader. */
function parseSaid(raw: unknown): DeeSaid[] {
  const out: DeeSaid[] = [];
  for (const value of asArray(raw)) {
    const entry = asRecord(value);
    const lineId = id(entry.lineId);
    if (lineId === null) continue;
    out.push({ lineId, at: nonNegativeInt(entry.at) });
  }
  return out.slice(-MAX_DEE_SAID);
}

function parsePersonalization(obj: Record<string, unknown>): Personalization {
  return {
    answeredOn: asDayKey(obj.answeredOn),
    displayName: id(obj.displayName),
    goals: idList(obj.goals, MAX_GOALS),
    format: id(obj.format),
    stakes: id(obj.stakes),
    experience: id(obj.experience),
    why: idList(obj.why, MAX_LIST),
    schedule: parseSchedule(obj.schedule),
  };
}

function parseSchedule(raw: unknown): PracticeSchedule | null {
  if (!isPlainObject(raw)) return null;
  const days = [...new Set(asArray(raw.days).filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6))];
  days.sort((a, b) => a - b);
  const minutes = raw.sessionMinutes;
  return {
    days,
    sessionMinutes:
      typeof minutes === 'number' && Number.isInteger(minutes) && minutes > 0 && minutes <= 600 ? minutes : null,
  };
}

function parseEntitlements(obj: Record<string, unknown>, d: EntitlementsState): EntitlementsState {
  return {
    tier: id(obj.tier) ?? d.tier,
    granted: idList(obj.granted, MAX_LIST),
    licence: licenceToken(obj.licence),
    highWater: typeof obj.highWater === 'number' && Number.isInteger(obj.highWater) && obj.highWater > 0 ? obj.highWater : 0,
  };
}

/** A stored token, whitespace-free and bounded; verified by main, not here. Anything else is null. */
function licenceToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const token = normalizeToken(value);
  return token.length > 0 && token.length <= MAX_TOKEN_CHARS ? token : null;
}

/**
 * Story progress. Ids are kept whatever they are (a newer build's chapter survives); within a record a bad
 * entry is dropped and a count is clamped. A showdown without exactly two shown cards and a full board is
 * dropped: it could not have been a showdown, so it cannot be a read.
 */
function parseStory(obj: Record<string, unknown>): StoryState {
  const chapters: Record<string, ChapterProgress> = {};
  for (const [key, value] of Object.entries(asRecord(obj.chapters))) {
    const k = id(key);
    if (k === null || k === '__proto__' || !isPlainObject(value)) continue;
    chapters[k] = {
      introSeen: value.introSeen === true,
      lessonDone: value.lessonDone === true,
      tables: Math.min(MAX_RUN, nonNegativeInt(value.tables)),
      // A newer build's result is kept as written; readers map it through `effectiveResult`.
      lastResult: id(value.lastResult),
      beatenOn: asDayKey(value.beatenOn),
    };
  }
  const rivals: Record<string, RivalRecord> = {};
  for (const [key, value] of Object.entries(asRecord(obj.rivals))) {
    const k = id(key);
    if (k === null || k === '__proto__' || !isPlainObject(value)) continue;
    const showdowns = asArray(value.showdowns).map(parseShowdown).filter((s): s is ShowdownRecord => s !== null);
    rivals[k] = {
      // At least the showdowns on file: a corrupt count cannot fall below what the log shows.
      hands: Math.max(showdowns.length, Math.min(MAX_RUN * 100, nonNegativeInt(value.hands))),
      sittings: asArray(value.sittings).map(parseSitting).filter((s): s is RivalSitting => s !== null).slice(-MAX_RIVAL_SITTINGS),
      showdowns: showdowns.slice(-MAX_RIVAL_SHOWDOWNS),
    };
  }
  const overrides: StoryOverride[] = [];
  for (const value of asArray(obj.overrides)) {
    const entry = asRecord(value);
    const day = asDayKey(entry.day);
    const suggested = id(entry.suggested);
    const chosen = id(entry.chosen);
    if (day !== null && suggested !== null && chosen !== null) overrides.push({ day, suggested, chosen });
  }
  return { chapters, rivals, overrides: overrides.slice(-MAX_STORY_OVERRIDES) };
}

function parseSitting(value: unknown): RivalSitting | null {
  const entry = asRecord(value);
  const day = asDayKey(entry.day);
  const chapter = id(entry.chapter);
  if (day === null || chapter === null) return null;
  const judged = Math.min(MAX_RUN, nonNegativeInt(entry.judged));
  const free = Math.min(judged, nonNegativeInt(entry.free));
  return { day, chapter, judged, free, serious: Math.min(judged - free, nonNegativeInt(entry.serious)) };
}

const CARD = /^[2-9TJQKA][shdc]$/;

function cardList(value: unknown): string[] | null {
  const cards = asArray(value);
  if (!cards.every((c): c is string => typeof c === 'string' && CARD.test(c))) return null;
  return cards as string[];
}

function parseShowdown(value: unknown): ShowdownRecord | null {
  const entry = asRecord(value);
  const day = asDayKey(entry.day);
  const shown = cardList(entry.shown);
  const board = cardList(entry.board);
  if (day === null || shown === null || board === null || shown.length !== 2 || board.length !== 5) return null;
  if (new Set([...shown, ...board]).size !== 7) return null;
  const actions: RivalAction[] = [];
  for (const raw of asArray(entry.actions).slice(0, MAX_RIVAL_ACTIONS)) {
    const a = asRecord(raw);
    const street = RIVAL_ACTION_STREETS.find((s) => s === a.street);
    const kind = RIVAL_ACTION_KINDS.find((k) => k === a.kind);
    if (street === undefined || kind === undefined) continue;
    const share = a.potShare;
    actions.push({
      street,
      kind,
      facingBet: a.facingBet === true,
      potShare: typeof share === 'number' && Number.isFinite(share) && share > 0 && share <= 100 ? share : null,
    });
  }
  return { day, shown, board, actions };
}

/** Read-side helpers: an unknown value (a newer build's) reads as this build's default. */
export function effectiveResult(p: ChapterProgress): (typeof CHAPTER_RESULTS)[number] | null {
  return (CHAPTER_RESULTS as readonly string[]).includes(p.lastResult ?? '') ? (p.lastResult as (typeof CHAPTER_RESULTS)[number]) : null;
}

export function effectiveTier(e: EntitlementsState): (typeof KNOWN_TIERS)[number] {
  return (KNOWN_TIERS as readonly string[]).includes(e.tier) ? (e.tier as (typeof KNOWN_TIERS)[number]) : 'free';
}

export function effectiveTone(p: DeeMemory['personality']): (typeof DEE_TONES)[number] {
  return (DEE_TONES as readonly string[]).includes(p.tone) ? (p.tone as (typeof DEE_TONES)[number]) : 'warm';
}

export function effectiveFrequency(p: DeeMemory['personality']): (typeof DEE_FREQUENCIES)[number] {
  return (DEE_FREQUENCIES as readonly string[]).includes(p.frequency)
    ? (p.frequency as (typeof DEE_FREQUENCIES)[number])
    : 'normal';
}

// ---- primitives ----

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function nonNegativeInt(value: unknown): number {
  return Math.max(0, Math.floor(asNumber(value)));
}

function intIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/** A non-empty, trimmed, bounded id-like string, or null. */
function id(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_ID_CHARS ? trimmed : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, MAX_TEXT_CHARS) : null;
}

/** Unique ids in first-seen order, bounded. */
function idList(value: unknown, max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of asArray(value)) {
    const s = id(v);
    if (s === null || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.slice(0, max);
}

/** Ascending unique day keys, keeping the newest `max`. */
function dayList(value: unknown, max: number): DayKey[] {
  const days = new Set<DayKey>();
  for (const v of asArray(value)) {
    const day = asDayKey(v);
    if (day !== null) days.add(day);
  }
  return [...days].sort((a, b) => a - b).slice(-max);
}

function dayReceipts(value: unknown): Record<string, { day: DayKey }> {
  const out: Record<string, { day: DayKey }> = {};
  for (const [key, entry] of Object.entries(asRecord(value))) {
    const k = id(key);
    // An own "__proto__" key from JSON.parse would set the prototype here, not a receipt.
    if (k === '__proto__') continue;
    const day = asDayKey(asRecord(entry).day);
    if (k !== null && day !== null) out[k] = { day };
  }
  return out;
}
