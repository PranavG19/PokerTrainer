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
} from './types.js';

/** Two years of counted days: a calendar strip shows weeks, so this is generous. */
export const MAX_STREAK_DAYS = 730;
export const MAX_REP_AWARDS = 500;
export const MAX_RECEIPTS = 500;
export const MAX_REMEMBERED_SENTENCES = 100;
export const MAX_GOALS = 2;
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
    entitlements: { tier: 'free', granted: [] },
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
  entitlements: { tier: true, granted: true },
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

function parseStreak(obj: Record<string, unknown>, d: StreakState): StreakState {
  const countedDays = dayList(obj.countedDays, MAX_STREAK_DAYS);
  const newestLogged = countedDays.length > 0 ? countedDays[countedDays.length - 1] : null;
  const stated = asDayKey(obj.lastCountedDay);
  // The last counted day is at least the newest one in the history: a corrupt pointer cannot hide a day.
  const lastCountedDay = stated === null ? newestLogged : newestLogged === null ? stated : (Math.max(stated, newestLogged) as DayKey);
  // The run is never below what the history still shows ending on that day, and nothing runs before day one.
  const logged = lastCountedDay === null ? 0 : runEndingOn(countedDays, lastCountedDay);
  const current = lastCountedDay === null ? 0 : Math.max(nonNegativeInt(obj.current), logged, 1);
  return {
    boundaryHour: intIn(obj.boundaryHour, 0, 23, d.boundaryHour),
    current,
    best: Math.max(nonNegativeInt(obj.best), current),
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
 * yesterday (today can still count), else 0, because a missed day resets it. The best run is untouched.
 */
export function currentStreakOn(streak: StreakState, today: DayKey): number {
  if (streak.lastCountedDay === null) return 0;
  return today - streak.lastCountedDay <= 1 ? streak.current : 0;
}

/**
 * Count a finished session on `day`. Idempotent within a day; the next day extends the run; a gap starts a
 * new run at 1. A day older than the last counted one (a clock moved back) changes nothing.
 */
export function countSession(streak: StreakState, day: DayKey): StreakState {
  const last = streak.lastCountedDay;
  if (last !== null && day <= last) return streak;
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
  };
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
  return { tier: id(obj.tier) ?? d.tier, granted: idList(obj.granted, MAX_LIST) };
}

/** Read-side helpers: an unknown value (a newer build's) reads as this build's default. */
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
