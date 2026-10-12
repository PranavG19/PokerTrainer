/**
 * Defaults, validation and (de)serialisation for the `progression` namespace (types.ts).
 *
 * Tolerant like every parser in session.ts, and partitioned: each sub-namespace (lamp, reps, …) is
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
  type LampState,
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

/** Two years of days: the Lamp shows 30 and the Rhythm needs weeks, so this is generous. */
export const MAX_LAMP_DAYS = 730;
export const MAX_SPARE_WICKS = 2;
export const MAX_WICK_WEEKS = 104;
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
    lamp: {
      boundaryHour: DAY_BOUNDARY_HOUR,
      litDays: [],
      restedDays: [],
      rhythm: { daysPerWeek: 3, weekStartsOn: 1, best: 0 },
      spareWicks: { held: 0, spentOnWeeks: [] },
    },
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
  lamp: {
    boundaryHour: true,
    litDays: true,
    restedDays: true,
    rhythm: { daysPerWeek: true, weekStartsOn: true, best: true },
    spareWicks: { held: true, spentOnWeeks: true },
  },
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
    lamp: section(obj.lamp, d.lamp, parseLamp),
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

function parseLamp(obj: Record<string, unknown>, d: LampState): LampState {
  const rhythm = asRecord(obj.rhythm);
  const wicks = asRecord(obj.spareWicks);
  const litDays = dayList(obj.litDays, MAX_LAMP_DAYS);
  const lit = new Set<number>(litDays);
  return {
    boundaryHour: intIn(obj.boundaryHour, 0, 23, d.boundaryHour),
    litDays,
    // A day is lit or rested, never both; lit is the stronger fact.
    restedDays: dayList(obj.restedDays, MAX_LAMP_DAYS).filter((day) => !lit.has(day)),
    rhythm: {
      daysPerWeek: intIn(rhythm.daysPerWeek, 2, 6, d.rhythm.daysPerWeek),
      weekStartsOn: rhythm.weekStartsOn === 0 ? 0 : rhythm.weekStartsOn === 1 ? 1 : d.rhythm.weekStartsOn,
      best: nonNegativeInt(rhythm.best),
    },
    spareWicks: {
      held: Math.min(MAX_SPARE_WICKS, nonNegativeInt(wicks.held)),
      spentOnWeeks: dayList(wicks.spentOnWeeks, MAX_WICK_WEEKS),
    },
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
