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
  ticket: TicketState;
  folio: FolioState;
  tallies: TalliesState;
  rail: RailState;
  seasons: SeasonsState;
  letters: LettersState;
  teachDee: TeachDeeState;
  club: ClubState;
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
  /** Boss hands (story/boss.ts) by boss id. Added without a bump: additive. An id this build does not know is kept. */
  bosses: Record<string, BossRecord>;
  /** The Masquerade epilogue (story/masquerade.ts). Added without a bump: additive. */
  masquerade: MasqueradeState;
}

/** One boss hand's record. Judged on the decisions alone: chips never enter it. */
export interface BossRecord {
  /** Times played to the end. */
  attempts: number;
  /** The first day it was played clean (every decision right at the first answer), which earns the keepsake. A ratchet. */
  cleanOn: DayKey | null;
}

/**
 * The Masquerade: three masked seats, each a rival's style with a jittered profile. What is kept per seat is only what
 * the learner saw it do (its actions, never its cards), counted for reads.ts's gates.
 */
export interface MasqueradeState {
  /** Masquerades begun, lifetime; 0 before the first. The current one's jitter is seeded from it. */
  run: number;
  /** The current one's seats, in seat order; empty before the first. */
  seats: MasqueradeSeat[];
  /** Masquerades with every seat unmasked, lifetime. */
  completed: number;
  /** The first day every seat of a Masquerade was unmasked, which earns the keepsake. A ratchet. */
  completedOn: DayKey | null;
}

export interface MasqueradeSeat {
  /** The rival whose style sits behind the mask (a cast.ts RivalId, or a newer build's id, kept). */
  rival: string;
  /** Hands it acted in before the flop: the observations behind the "plays" read. */
  acted: number;
  /** Of those, the hands it put chips in by choice (a call, bet or raise). */
  played: number;
  /** Bets it faced, on any street. */
  faced: number;
  /** Of those, the ones it folded to. */
  folded: number;
  /** Decisions after the flop with no bet to face. */
  chances: number;
  /** Of those, the ones it bet or raised. */
  bets: number;
  /** Rival ids the learner named for this seat and that did not fit, oldest first, unique. */
  missed: string[];
  /** The day the learner named it right. A ratchet. */
  unmaskedOn: DayKey | null;
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

/**
 * Today's Ticket (D16, src/core/ticket.ts): a review unit under 30 minutes. Frozen at its first build of the day,
 * so it does not shrink under the learner as its items are worked. Item kinds are persisted as strings; a kind this
 * build does not know is kept and shown as done-or-not, never re-planned.
 */
export interface TicketState {
  /** The day `items` were built for; null before the first Ticket. */
  day: DayKey | null;
  items: TicketItemRecord[];
  /** Ids of today's items that are done, unique. */
  done: string[];
  /** The most recent day the whole Ticket was finished; null before the first. */
  finishedOn: DayKey | null;
}

/** Known kinds: 'review' (a due concept), 'drill' (one perception drill), 'spot' (a leak spot), 'teach' (a rule to rewrite). */
export const TICKET_KINDS = ['review', 'drill', 'spot', 'teach'] as const;

export interface TicketItemRecord {
  /** `${kind}:${ref}`, unique within the Ticket. */
  id: string;
  kind: string;
  /** The concept id, the drill mode or the puzzle scenario id. */
  ref: string;
  /** Planned minutes, so the total is checkable against the 30-minute bound. */
  minutes: number;
}

/**
 * Folio, the Rulebook (src/core/folio.ts): when each rule card was last re-polished. The sentences themselves stay
 * where they already live (the lexicon and Dee's remembered rules); only the reviews are new.
 */
export interface FolioState {
  /** Card (concept) id → epoch ms of each re-polish, ascending, bounded by MAX_FOLIO_REVIEWS. */
  polished: Record<string, number[]>;
}

/**
 * Teach Dee (src/core/teachDee.ts): every contrast set played from one of the learner's rules, newest last. The
 * sentences stay where they live (the lexicon and Dee's remembered rules); a rewrite is appended to the lexicon.
 */
export interface TeachDeeState {
  /** Finished sets, ascending by `at`, unique on `at`, bounded by MAX_TAUGHT_SETS. */
  sets: TaughtSet[];
}

/** Known findings (teachDee.ts FINDINGS). A newer build's finding is kept and read as one that asks for no rewrite. */
export const TEACH_FINDINGS = ['holds', 'wrong', 'too-broad', 'too-narrow', 'no-flip', 'other-half', 'untested'] as const;

export interface TaughtSet {
  /** Epoch ms the set was finished. Its Reps key. */
  at: number;
  /** The Folio card (rule) taught. */
  conceptId: string;
  /** The sentence as it read when it was taught. */
  text: string;
  /** The contrast-manifest concept whose spot the set was built around. */
  base: string;
  /** How the learner told Dee to read the rule: the variable, the value it applies at, its play and the other play. */
  axis: string;
  value: string;
  action: string;
  otherwise: string;
  /** One of TEACH_FINDINGS, or a newer build's value. */
  finding: string;
  /** Spots played, and the ones where Dee's play from the rule did not hold up. */
  spots: number;
  misses: number;
}

/** Counts the habit loop keeps that no other record can rebuild (the hand log is capped and drops grades' bands). */
export interface TalliesState {
  /** "Price held" beats: a close-band spot played on the right side, said Sure, with a mechanism reason. */
  priceHeld: number;
  /** Today's Tickets finished, lifetime. */
  ticketsFinished: number;
  /** The day the learner last took the one suggestion (today's ring); null before the first. */
  suggestionTakenOn: DayKey | null;
}

/**
 * A running sum of graded decisions' bb loss: enough for the mean and its 95% interval (online/ranked.ts `Tally`).
 * Only the coach's own `evLossBb` goes in; chips, pots and results never do.
 */
export interface LossTally {
  n: number;
  sum: number;
  sumSq: number;
}

/**
 * The Ghost Rail (owner D18, src/core/progression/rail.ts): a weekly offline league against labelled, fictional bots
 * and the learner's own past weeks, never other people. Scored on decision quality; there is no demotion.
 */
export interface RailState {
  /** One of rail.ts RAIL_TIERS ids, or a newer build's (kept, read as the lowest tier, never moved by this build). A ratchet. */
  tier: string;
  /** One record per local week with Rail activity, ascending by `week`, unique, bounded by MAX_RAIL_WEEKS. */
  weeks: RailWeek[];
  /** Each move up, oldest first, bounded by MAX_RAIL_PROMOTIONS. Never a move down. */
  promotions: RailPromotion[];
}

export interface RailWeek {
  /** The week's Monday (local DayKey). */
  week: DayKey;
  /** Contested, sound-math graded decisions (standing.ts `counts`) from hands whose Reps the Rail counted. */
  loss: LossTally;
  /** Reps counted for the Rail this week: a day's Reps above rail.ts RAIL_DAILY_REPS count 0. */
  reps: number;
  /** The grader version (online/ranked.ts GRADER_VERSION) of the week's first decision. */
  grader: number;
  /** A decision graded by another grader version landed in the same week: the week is shown but never settles up. */
  mixed: boolean;
  /** How the week settled once it ended: 'up' | 'held' | 'unrated' | 'mixed' (or a newer value, kept); null while open. */
  outcome: string | null;
}

export interface RailPromotion {
  /** The week that earned it. */
  week: DayKey;
  /** Tier ids. */
  from: string;
  to: string;
}

/**
 * Offline Seasons (src/core/progression/season.ts): seven local weeks, six of free track and a finale week whose
 * delayed test is an assessment block; then the season is archived. Fully offline and local.
 */
export interface SeasonsState {
  /** One record per season with activity, ascending by `season`, unique, bounded by MAX_SEASON_RECORDS. */
  records: SeasonRecord[];
}

export interface SeasonRecord {
  /** The season's number: Season 1 opened on season.ts SEASON_EPOCH. */
  season: number;
  /** Reps counted for the season (the Rail's daily rule): what fills the free track. */
  reps: number;
  /** The grader version the season opened with. */
  grader: number;
  /** The first assessment block of the track weeks: the opening measure; null if none was taken. */
  baseline: BlockScore | null;
  /** The first assessment block of the finale week: the delayed test; null until taken. */
  finale: BlockScore | null;
}

export interface BlockScore {
  /** The block's timestamp (every spot of a block shares it). */
  at: number;
  loss: LossTally;
  grader: number;
}

/**
 * Dee's letters (src/core/letters.ts): one filed letter per ended week, its numbers and line ids, never its text. Additive
 * (no version bump): an older build carries the key through untouched. Kept: two years of weeks.
 */
export const MAX_LETTERS = 104;

/** The decision the week is remembered by: the biggest pot faced with a bet and answered right. */
export interface HandOfWeek {
  hole: string[];
  /** The board when the decision was made. */
  board: string[];
  street: string;
  action: string;
  toCall: number;
  pot: number;
}

/** One filed letter. Persisted whole in `progression.letters.filed`. */
export interface LetterRecord {
  /** The Monday the week starts. */
  week: DayKey;
  /** 1 for the learner's first week with a letter. */
  n: number;
  /** Line ids from the letter bank, in reading order. An id this build does not know is skipped when read. */
  lines: string[];
  /** The filled slot values, formatted with their nouns. */
  slots: Record<string, string>;
  /** The week's counts, for the figures beside the letter. */
  figures: Record<string, number>;
  /** The style the week's hands read as, or null under the gate. */
  style: string | null;
  hand: HandOfWeek | null;
  /** Milestone ids earned in the week. */
  shelf: string[];
}

export interface LettersState {
  filed: LetterRecord[];
}


/**
 * The LAN Club (src/core/club/): a standing local group, cooperative, scored on decisions and never chips. Local
 * only: members are names this player keeps, the notebook holds codes friends handed over, and each Game Night is
 * this player's own counts plus the recaps friends pasted in. `name` null means no club has been started.
 */
export interface ClubState {
  name: string | null;
  since: DayKey | null;
  /** The name this player sits down under at a Game Night; null reads as the onboarding display name. */
  tableName: string | null;
  /** Unique by name, oldest first, bounded by MAX_CLUB_MEMBERS. */
  members: ClubMember[];
  /** Ascending by `at`, unique on `at`, bounded by MAX_NOTEBOOK. */
  notebook: NotebookEntry[];
  /** Ascending by `startedAt`, unique on `night`, bounded by MAX_NIGHTS. */
  nights: NightRecord[];
}

export interface ClubMember {
  name: string;
  since: DayKey;
}

/** A code in the club's shared notebook: a spot to review, or a challenge code (hand, Math problem, puzzle). */
export interface NotebookEntry {
  /** Epoch ms it was added; its identity. */
  at: number;
  code: string;
  /** Who it came from: a member's name, or "You". */
  from: string;
  note: string;
  /** For a spot: the action this player chose when they played it (a newer build's kind is kept); null before. */
  answer: string | null;
}

/** One player's Game Night as counts: what a recap code carries (core/club/codes.ts). */
export interface NightRecap {
  /** 8 hex digits naming the table (codes.ts nightIdOf). */
  night: string;
  day: DayKey;
  name: string;
  hands: number;
  decisions: number;
  clean: number;
  /** Big blinds lost against the grader's play, in hundredths, summed. */
  lossCentiBb: number;
}

export interface NightSpot {
  /** A spot code, with this player's choice in it. */
  code: string;
  lossCentiBb: number;
}

/** One Game Night as this player saw it. */
export interface NightRecord {
  night: string;
  day: DayKey;
  /** 'host' or 'join'; a newer build's value is kept. */
  role: string;
  startedAt: number;
  /** Null while the night is on (or the app closed before it ended). */
  endedAt: number | null;
  hands: number;
  /** The last hand number counted, so a repeated end-of-hand view never counts twice. */
  lastHand: number;
  decisions: number;
  clean: number;
  lossCentiBb: number;
  /** The costliest few decisions, costliest first, bounded by NIGHT_SPOTS. */
  spots: NightSpot[];
  /** The other seats' names, bounded by NIGHT_SEEN. */
  seen: string[];
  /** Friends' pasted recaps for this night, one per name, by name. */
  friends: NightRecap[];
}
