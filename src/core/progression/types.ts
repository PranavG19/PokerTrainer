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
  streak: StreakState;
  reps: RepsState;
  seals: SealsState;
  cosmetics: CosmeticsState;
  dee: DeeMemory;
  personalization: Personalization;
  milestones: MilestonesState;
  entitlements: EntitlementsState;
  story: StoryState;
}

/**
 * The classic daily streak (owner D5): consecutive local days with at least one finished session. A missed
 * day resets it; there are no rest days and no freezes. The best run is kept forever. Days are DayKeys, so
 * they turn at the learner's own 4 am (localDay.ts).
 */
export interface StreakState {
  /**
   * The local hour the learner's day turns over (localDay.ts DAY_BOUNDARY_HOUR by default). Stored so a
   * later setting can change it; whoever counts sessions passes it to `systemDayKeyOf(boundaryHour)`.
   */
  boundaryHour: number;
  /** The run as of `lastCountedDay`. Read it through `currentStreakOn`, which applies a missed day. */
  current: number;
  /** The longest run ever. Never below `current`; a reset never costs the record. */
  best: number;
  /** The most recent day that counted (always the newest in `countedDays`); null before the first. */
  lastCountedDay: DayKey | null;
  /** Days that counted, ascending, unique, bounded by MAX_STREAK_DAYS (history for a calendar strip). */
  countedDays: DayKey[];
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
  /** Character on (the default) shows Dee; off hides the mark and Dee's own lines everywhere. */
  character: boolean;
  /** Hands Dee has watched to the end, lifetime: the clock its line cooldowns count in (never wall time). */
  handsWatched: number;
  /** The lines Dee said recently and the hand count each was said at, newest last, bounded by MAX_DEE_SAID. */
  said: DeeSaid[];
}

export interface DeeSaid {
  lineId: string;
  at: number;
}

export interface RememberedSentence {
  conceptId: string;
  text: string;
  day: DayKey;
}

export const DEE_TONES = ['dry', 'warm', 'blunt'] as const;
/**
 * When Dee speaks: 'normal' = After notable hands (the default the v2 placeholder already wrote), 'mistakes' =
 * Mistakes only, 'sessions' = After sessions only. The placeholder's 'after-hands' and 'quiet' were never
 * written by any build and read as the default.
 */
export const DEE_FREQUENCIES = ['normal', 'mistakes', 'sessions'] as const;

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

/** Tier ids this build knows (src/core/entitlements/features.ts TIERS). */
export const KNOWN_TIERS = ['free', 'pro'] as const;

/**
 * The licence, owned by MAIN (src/main/licence.ts): on every save main replaces this whole object with
 * its own, so nothing the renderer writes here is ever persisted or believed. `tier` and `granted` are a
 * cache of the last verified snapshot for display; the signed `licence` token is the only thing that
 * grants anything, and main re-verifies it at every start.
 */
export interface EntitlementsState {
  /** One of KNOWN_TIERS, or a newer build's tier (kept, read as 'free'). A cache, never a grant. */
  tier: string;
  /** Entitlement (feature) ids, unique. A cache, never a grant. */
  granted: string[];
  /** The Ed25519-signed licence token (entitlements/token.ts), or null. Added in v2, no bump: additive. */
  licence: string | null;
  /** The clock high-water mark, unix seconds; 0 = never (entitlements/clock.ts). */
  highWater: number;
}

/**
 * The Long Orbit (story mode, src/core/story/): chapter progress and the rival dossiers. Chapter and rival ids
 * are cast.ts's, persisted as strings; an id this build does not know is kept and never shown, so a newer
 * build's chapter survives an older build's save.
 */
export interface StoryState {
  chapters: Record<string, ChapterProgress>;
  rivals: Record<string, RivalRecord>;
  /** A chapter chosen over the suggested one, newest last, bounded by MAX_STORY_OVERRIDES (N1: logged, never blocked). */
  overrides: StoryOverride[];
}

export const CHAPTER_RESULTS = ['met', 'short', 'unjudged'] as const;
export type ChapterResult = (typeof CHAPTER_RESULTS)[number];

export interface ChapterProgress {
  /** Dee's intro was shown (it can be skipped; it is never required). */
  introSeen: boolean;
  /** The lesson-dialogue beat was answered to the end. */
  lessonDone: boolean;
  /** Tables against the rival played to the end. */
  tables: number;
  /** One of CHAPTER_RESULTS, or a newer build's value (kept, read as null); null before the first table. */
  lastResult: string | null;
  /** The day the goal was first met, which takes the rival's mask off. A ratchet: never cleared. */
  beatenOn: DayKey | null;
}

/**
 * One rival's file. Hands and decision quality are the learner's own graded decisions against them; what
 * the rival did is kept ONLY for hands that reached a showdown, so every read is one the learner saw
 * (round 2: the dossier counts showdowns, never engine truth).
 */
export interface RivalRecord {
  /** Hands dealt against them, lifetime. */
  hands: number;
  /** Decision quality per table against them, newest last, bounded by MAX_RIVAL_SITTINGS. */
  sittings: RivalSitting[];
  /** Hands that reached a showdown with them, newest last, bounded by MAX_RIVAL_SHOWDOWNS. */
  showdowns: ShowdownRecord[];
}

export interface RivalSitting {
  day: DayKey;
  chapter: string;
  /** Decisions the chapter goal judges (story/campaign.ts `isJudged`). */
  judged: number;
  /** Of those, the ones that cost nothing. */
  free: number;
  /** Of those, serious mistakes. */
  serious: number;
}

export interface ShowdownRecord {
  day: DayKey;
  /** The rival's hole cards, as shown at showdown. */
  shown: string[];
  /** The full board. */
  board: string[];
  /** Everything the rival did that hand, in order. */
  actions: RivalAction[];
}

export const RIVAL_ACTION_STREETS = ['preflop', 'flop', 'turn', 'river'] as const;
export const RIVAL_ACTION_KINDS = ['fold', 'check', 'call', 'bet', 'raise', 'allin'] as const;

export interface RivalAction {
  street: (typeof RIVAL_ACTION_STREETS)[number];
  kind: (typeof RIVAL_ACTION_KINDS)[number];
  /** A bet facing it (it called, raised or folded to chips). */
  facingBet: boolean;
  /** For a bet, raise or all-in: the chips added over the pot before them; null otherwise. */
  potShare: number | null;
}

export interface StoryOverride {
  day: DayKey;
  suggested: string;
  chosen: string;
}
