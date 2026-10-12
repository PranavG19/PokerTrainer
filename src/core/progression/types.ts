/**
 * The persisted `progression` namespace of the profile (schema v2).
 *
 * Shapes only: defaults, validation and (de)serialisation live in `persist.ts`. Nothing here reads a
 * clock; every date is a `DayKey` the caller computed (localDay.ts), so a session is filed under the
 * learner's own day and travel cannot rewrite history.
 *
 * Fields that a later task will define the vocabulary for (cosmetic ids, rival ids, onboarding answers,
 * tiers, entitlements) are persisted as plain strings with their known values listed next to them. A
 * build that meets a value it does not know keeps it, rather than resetting it, so a newer build's
 * choice is never overwritten by an older one. Readers map an unknown value to their own default.
 *
 * Adding a field: see "Profile schema" in AGENTS.md.
 */

import type { DayKey } from '../localDay.js';
import type { Chalk, Reps } from '../units.js';

export interface ProgressionState {
  lamp: LampState;
  reps: RepsState;
  seals: SealsState;
  cosmetics: CosmeticsState;
  dee: DeeMemory;
  personalization: Personalization;
  milestones: MilestonesState;
  entitlements: EntitlementsState;
}

/** The Lamp: the habit loop built around the spacing schedule. Appointments kept, not time spent. */
export interface LampState {
  /** The local hour the learner's day turns over (localDay.ts DAY_BOUNDARY_HOUR by default). */
  boundaryHour: number;
  /** Days with a finished session, ascending, unique, bounded by MAX_LAMP_DAYS. */
  litDays: DayKey[];
  /** Days with nothing due, so a gap holds the run instead of breaking it. Never also lit. */
  restedDays: DayKey[];
  rhythm: RhythmState;
  spareWicks: SpareWicks;
}

/** The weekly Rhythm: how many study days a week count as a kept week, and the best run of kept weeks. */
export interface RhythmState {
  /** 2–6 days a week. */
  daysPerWeek: number;
  /** 0 = Sunday, 1 = Monday. */
  weekStartsOn: 0 | 1;
  /** The longest run of kept weeks ever. Only ever rises: a break never costs the record. */
  best: number;
}

/** Freezes, earned (one per two kept weeks) and spent automatically on a missed week. Never sold. */
export interface SpareWicks {
  /** 0..MAX_SPARE_WICKS. */
  held: number;
  /** The first day of each week a wick covered, ascending, unique, bounded. */
  spentOnWeeks: DayKey[];
}

export interface RepsState {
  /** Lifetime Reps. The award log is bounded, so this cannot be re-derived from it. Never below the log's sum. */
  total: Reps;
  /** Recent awards, newest last, bounded by MAX_REP_AWARDS. `key` makes an award idempotent. */
  awards: RepAward[];
}

export interface RepAward {
  /** e.g. `hand:<playedAt>`, `puzzle:<id>:<day>`. Unique in the log. */
  key: string;
  reps: Reps;
  day: DayKey;
}

/** One Seal per mastered concept, with the day it was first earned. A ratchet: a Seal is never taken back. */
export interface SealsState {
  earned: Record<string, { day: DayKey }>;
}

/** Cosmetic slots. Paint only; card faces, seat layout and stack display are never cosmetic. */
export const COSMETIC_SLOTS = ['cardBack', 'felt', 'chipSet', 'deeRim', 'celebration'] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

/** At most this much Chalk is earned in one local day (VISION §4). */
export const CHALK_DAILY_CAP = 225;

export interface CosmeticsState {
  /** Item ids owned, unique. */
  owned: string[];
  /** Equipped item per slot. Only an owned item can be equipped. */
  equipped: Partial<Record<CosmeticSlot, string>>;
  /** Why each item is owned: the fact that earned it, newest last, bounded by MAX_RECEIPTS. */
  receipts: Receipt[];
  chalk: ChalkLedger;
}

export interface Receipt {
  itemId: string;
  day: DayKey;
  /** The fact, in words: "Certified the 75bb table". */
  fact: string;
  /** Chalk paid; 0 for an item granted by a milestone, Seal or keepsake. */
  chalk: Chalk;
}

/** The balance, and how much of today's cap is used. A new `day` resets `earnedToday`. */
export interface ChalkLedger {
  balance: Chalk;
  /** The day `earnedToday` belongs to; null before the first earn. */
  day: DayKey | null;
  /** 0..CHALK_DAILY_CAP. */
  earnedToday: Chalk;
}

/** What Dee remembers between sittings. Never a trait claim about the learner. */
export interface DeeMemory {
  /** Rule sentences Dee quotes back at the moment they apply, newest last, bounded. */
  ruleSentences: RememberedSentence[];
  /** Rival keepsake ids earned by clean boss hands, unique. */
  keepsakes: string[];
  lastGreeting: { day: DayKey; lineId: string } | null;
  personality: DeePersonality;
}

export interface RememberedSentence {
  conceptId: string;
  text: string;
  day: DayKey;
}

export const DEE_TONES = ['dry', 'warm', 'blunt'] as const;
export const DEE_FREQUENCIES = ['normal', 'after-hands', 'quiet'] as const;

/** The personality dial: the numbers never change, only the words around them. */
export interface DeePersonality {
  /** One of DEE_TONES, or a newer build's value (kept, read as the default). */
  tone: string;
  /** One of DEE_FREQUENCIES, or a newer build's value. */
  frequency: string;
}

/**
 * Onboarding answers, asked once and editable later. Every field is optional: Skip is always allowed,
 * and an unanswered question is null or empty, never a guess.
 */
export interface Personalization {
  /** The day the questions were answered (or skipped); null = never shown. */
  answeredOn: DayKey | null;
  /** What Dee calls the learner. Optional; there is no account and no real-name field. */
  displayName: string | null;
  /** Up to MAX_GOALS goal ids, in the learner's order. */
  goals: string[];
  /** Where they play (format): 'home' | 'live' | 'online' | 'tournament', or a newer value. */
  format: string | null;
  /** e.g. 'micro' | 'low' | 'mid' | 'high' | 'play-money'. */
  stakes: string | null;
  /** e.g. 'new' | 'casual' | 'years-unstudied' | 'studied'. */
  experience: string | null;
  /** Why they play, in their order: 'friends' | 'puzzle' | 'money' | 'competition' …. */
  why: string[];
  schedule: PracticeSchedule | null;
}

export interface PracticeSchedule {
  /** Weekdays they plan to practise, 0 = Sunday, ascending, unique. */
  days: number[];
  /** Planned minutes per session; null = not said. */
  sessionMinutes: number | null;
}

/** First-achieved receipts for milestones (career.ts ids and later ones). A ratchet, like Seals. */
export interface MilestonesState {
  achieved: Record<string, { day: DayKey }>;
}

/** The tier the learner is on and anything it grants. A placeholder for the tiers task. */
export const KNOWN_TIERS = ['free'] as const;

export interface EntitlementsState {
  /** One of KNOWN_TIERS, or a newer build's tier (kept, read as 'free'). */
  tier: string;
  /** Entitlement ids, unique. */
  granted: string[];
}
