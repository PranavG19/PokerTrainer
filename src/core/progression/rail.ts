/**
 * THE GHOST RAIL (BUILD-PLAN 2.5, owner D18): a weekly offline league against labelled, fictional bots and the
 * learner's own past weeks. Never other people: there is no network, no account and no one else's number here.
 *
 * SCORED ON DECISION QUALITY, NEVER CHIPS. A week's number is bb lost per 100 graded decisions, the coach's own
 * `evLossBb`, over exactly the decisions Depth scores (standing.ts `counts`: contested, sound-math or free), so
 * pots, stacks, showdowns and a won hand are not inputs of anything here. It is the online ladder's measure
 * (online/ranked.ts `rate`), read the same honest way: a mean with its 95% interval, and a week too thin to mean
 * anything is shown as calibrating, never scored.
 *
 * TIERS, DEUCE TO ACE, AND NO DEMOTION. Each tier has a pace-setter: a fictional bot whose number is a fixed,
 * published constant (nothing random, nothing simulated). A week settles when it ends; if it was rated and its
 * pessimistic end (the interval's high side) is at or under the pace-setter's number, the learner moves up one
 * tier. A bad week moves nobody down: the tier is a ratchet, like Seals and Depth.
 *
 * COUNTED THROUGH THE REPS LEDGER. Only an event the ledger has just paid (a key new in this save, reps.ts `award`)
 * reaches the Rail, so a replayed or stale save adds nothing twice. Above RAIL_DAILY_REPS in one day, Reps count 0
 * for the Rail (VISION §4). Decisions still count past that line: a week is a fixed count of them, so playing more
 * cannot move its number, and dropping them would leave an ordinary week unrated.
 *
 * Pure: no clock. The caller passes the day.
 */

import type { DayKey } from '../localDay.js';
import { GRADER_VERSION, rate, type Rating } from '../online/ranked.js';
import { MAX_RAIL_PROMOTIONS, MAX_RAIL_WEEKS } from './persist.js';
import type { LossTally, RailState, RailWeek } from './types.js';

/** Above this many Reps in one local day, Reps count 0 for the Rail and for Seasons (VISION §4). */
export const RAIL_DAILY_REPS = 400;
/**
 * A week is judged on exactly its first this-many scored decisions, and is rated only once it has them all. A fixed
 * count, so stopping the week the moment the number looks good cannot buy a move (optional stopping), and practice
 * after the count still pays Reps without moving the number. Depth's own floor (standing.ts MIN_CONTESTED).
 */
export const RAIL_WEEK_DECISIONS = 40;
/** Past weeks shown on the board as ghosts. */
export const GHOST_WEEKS = 4;

export const FICTIONAL_LABEL = 'Fictional practice bot';

export interface RailBot {
  readonly name: string;
  /** Always FICTIONAL_LABEL: every bot is labelled as a made-up character wherever it is shown. */
  readonly label: typeof FICTIONAL_LABEL;
  /** Its fixed number: bb lost per 100 scored decisions. A constant, never simulated. */
  readonly pace: number;
}

export interface RailTier {
  readonly id: string;
  readonly name: string;
  readonly bot: RailBot;
}

const bot = (name: string, pace: number): RailBot => ({ name, label: FICTIONAL_LABEL, pace });

/**
 * Deuce to Ace. The paces tighten up the ladder. They are PROVISIONAL, intuition-set numbers on Depth's scale
 * (standing.ts DEPTH_CEILING: 3.0 bb a decision certifies 40bb, 0.8 certifies 200bb); a test pins that they fall
 * strictly, so a tier can never be easier than the one below it.
 */
export const RAIL_TIERS: readonly RailTier[] = [
  { id: 'deuce', name: 'Deuce', bot: bot('Pip', 400) },
  { id: 'three', name: 'Three', bot: bot('Tally', 360) },
  { id: 'four', name: 'Four', bot: bot('Cobble', 320) },
  { id: 'five', name: 'Five', bot: bot('Fennick', 285) },
  { id: 'six', name: 'Six', bot: bot('Gauge', 250) },
  { id: 'seven', name: 'Seven', bot: bot('Hobb', 220) },
  { id: 'eight', name: 'Eight', bot: bot('Inkwell', 190) },
  { id: 'nine', name: 'Nine', bot: bot('Lumen', 165) },
  { id: 'ten', name: 'Ten', bot: bot('Mosaic', 140) },
  { id: 'jack', name: 'Jack', bot: bot('Nimbus', 120) },
  { id: 'queen', name: 'Queen', bot: bot('Orrery', 100) },
  { id: 'king', name: 'King', bot: bot('Plinth', 85) },
  { id: 'ace', name: 'Ace', bot: bot('Quartz', 70) },
];

export const RAIL_OUTCOMES = ['up', 'held', 'unrated', 'mixed'] as const;
export type RailOutcome = (typeof RAIL_OUTCOMES)[number];

export function defaultRail(): RailState {
  return { tier: RAIL_TIERS[0].id, weeks: [], promotions: [] };
}

/** The tier's index, or null for a newer build's tier this build does not know (kept, never moved here). */
export function tierIndex(id: string): number | null {
  const i = RAIL_TIERS.findIndex((t) => t.id === id);
  return i < 0 ? null : i;
}

/** The tier to show: an unknown (newer) tier reads as the lowest. */
export function effectiveRailTier(state: RailState): RailTier {
  return RAIL_TIERS[tierIndex(state.tier) ?? 0];
}

// ── Weeks ───────────────────────────────────────────────────────────────────────────────────────────

/** The Monday that starts `day`'s week. DayKey 0 is a Thursday (1 Jan 1970). */
export function weekOf(day: DayKey): DayKey {
  return (day - ((((day + 3) % 7) + 7) % 7)) as DayKey;
}

export const EMPTY_LOSS: LossTally = { n: 0, sum: 0, sumSq: 0 };

/** Add losses, at most up to `cap` decisions. A non-finite grade is skipped: a broken grade is no decision. */
export function addLosses(t: LossTally, losses: readonly number[], cap = Number.POSITIVE_INFINITY): LossTally {
  let { n, sum, sumSq } = t;
  for (const raw of losses) {
    if (n >= cap) break;
    if (!Number.isFinite(raw)) continue;
    const x = Math.max(0, raw);
    n += 1;
    sum += x;
    sumSq += x * x;
  }
  return { n, sum, sumSq };
}

/** bb per 100 decisions with its 95% interval (ranked.ts `rate`), rated at RAIL_WEEK_DECISIONS. */
export function railRating(t: LossTally): Rating {
  return { ...rate(t), rated: t.n >= RAIL_WEEK_DECISIONS };
}

// ── The ledger's share ──────────────────────────────────────────────────────────────────────────────

/** One event the ledger has just paid. */
export interface PaidEvent {
  readonly day: DayKey;
  readonly reps: number;
  /** The coach's bb loss for each scored decision the event carries (a hand's); empty for every other event. */
  readonly losses: readonly number[];
}

export interface CountedEvent {
  readonly day: DayKey;
  /** Reps that count for the Rail and Seasons: 0 once the day is past RAIL_DAILY_REPS. */
  readonly reps: number;
  /** The decisions it carries: all of them (the daily line is on Reps only). */
  readonly losses: readonly number[];
}

/**
 * Apply the daily rule to events just paid, in order. `repsBefore(day)` is what the ledger held for that day before
 * them (reps.ts `repsOn`).
 */
export function countForRail(events: readonly PaidEvent[], repsBefore: (day: DayKey) => number): CountedEvent[] {
  const used = new Map<DayKey, number>();
  const out: CountedEvent[] = [];
  for (const e of events) {
    const prior = used.get(e.day) ?? repsBefore(e.day);
    const room = Math.max(0, RAIL_DAILY_REPS - prior);
    out.push({ day: e.day, reps: Math.min(Math.max(0, e.reps), room), losses: e.losses });
    used.set(e.day, prior + Math.max(0, e.reps));
  }
  return out;
}

/** File counted events into their weeks. Weeks stay ascending and unique; an event with nothing to count adds no week. */
export function recordRail(state: RailState, events: readonly CountedEvent[], grader: number = GRADER_VERSION): RailState {
  let weeks = state.weeks;
  for (const e of events) {
    if (e.reps <= 0 && e.losses.length === 0) continue;
    const week = weekOf(e.day);
    const i = weeks.findIndex((w) => w.week === week);
    // A settled week is closed: an event filed under it late (a clock that ran slow) does not reopen its number.
    if (i >= 0 && weeks[i].outcome !== null) continue;
    const was: RailWeek = i >= 0 ? weeks[i] : { week, loss: EMPTY_LOSS, reps: 0, grader, mixed: false, outcome: null };
    const loss = addLosses(was.loss, e.losses, RAIL_WEEK_DECISIONS);
    const added = loss.n > was.loss.n;
    const next: RailWeek = {
      ...was,
      loss,
      reps: was.reps + e.reps,
      // A week begun by one grader and continued by another is shown, never settled up (one week, one grader). Only
      // decisions that entered the count matter: a week already at its count is not mixed by a later hand.
      mixed: was.mixed || (added && was.loss.n > 0 && was.grader !== grader),
      grader: was.loss.n === 0 && added ? grader : was.grader,
    };
    weeks = i >= 0 ? weeks.map((w, j) => (j === i ? next : w)) : [...weeks, next].sort((a, b) => a.week - b.week);
  }
  return weeks === state.weeks ? state : { ...state, weeks: weeks.slice(-MAX_RAIL_WEEKS) };
}

/** How a finished week settles at `tier`. */
export function weekOutcome(w: RailWeek, tier: number | null): RailOutcome {
  if (w.mixed) return 'mixed';
  const r = railRating(w.loss);
  if (!r.rated) return 'unrated';
  if (tier === null || tier >= RAIL_TIERS.length - 1) return 'held';
  return r.high <= RAIL_TIERS[tier].bot.pace ? 'up' : 'held';
}

/**
 * Settle every week that has ended (its Monday is before this week's) and is still open, oldest first: each rated
 * week at or under its pace-setter moves the tier up one. Nothing here ever moves a tier down. Returns the same
 * object when nothing settles.
 */
export function settleRail(state: RailState, today: DayKey): RailState {
  const thisWeek = weekOf(today);
  if (!state.weeks.some((w) => w.outcome === null && w.week < thisWeek)) return state;
  let tier = state.tier;
  const promotions = [...state.promotions];
  const weeks = state.weeks.map((w) => {
    if (w.outcome !== null || w.week >= thisWeek) return w;
    const at = tierIndex(tier);
    // A newer build's tier: this build cannot judge the week against it, so it stays open for that build.
    if (at === null) return w;
    const outcome = weekOutcome(w, at);
    if (outcome === 'up') {
      const to = RAIL_TIERS[at + 1].id;
      promotions.push({ week: w.week, from: tier, to });
      tier = to;
    }
    return { ...w, outcome };
  });
  // In week order, as the parser keeps them: a week filed late (a clock set back) can settle after a newer one.
  promotions.sort((a, b) => a.week - b.week);
  return { tier, weeks, promotions: promotions.slice(-MAX_RAIL_PROMOTIONS) };
}

/**
 * The tier held on `day` (from the promotions on file), for the season archive. A move is dated by the week that
 * earned it and granted when that week ends, so it is held from the next Monday.
 */
export function tierOn(state: RailState, day: DayKey): RailTier {
  let id = RAIL_TIERS[0].id;
  for (const p of state.promotions) if (p.week + 7 <= day) id = p.to;
  return RAIL_TIERS[tierIndex(id) ?? 0];
}

// ── The board ───────────────────────────────────────────────────────────────────────────────────────

export interface RailRow {
  readonly kind: 'you' | 'ghost' | 'bot';
  /** 'You · this week', 'You · week of …' (the caller formats the day), or the bot's name. */
  readonly name: string;
  /** For a ghost, its week; for a bot, its tier. */
  readonly week: DayKey | null;
  readonly tier: RailTier | null;
  /** The number the board orders by: a bot's pace, a week's interval high side. Null while calibrating. */
  readonly orderBy: number | null;
  readonly rating: Rating | null;
}

export interface RailBoard {
  readonly tier: RailTier;
  readonly week: DayKey;
  /** This week's tally (empty before any decision). */
  readonly current: Rating;
  /** The pace to beat this week, read on the interval's high side: null at Ace (nowhere further up). */
  readonly toBeat: number | null;
  /** Rated rows (lower first), then calibrating ones. */
  readonly rows: readonly RailRow[];
}

/**
 * This week's board at the learner's tier: this week, up to GHOST_WEEKS of their own past weeks, and the pace-setters
 * of the tier below, this tier and the tier above. Ordered by the pessimistic end, as the online ladder orders.
 */
export function railBoard(state: RailState, today: DayKey): RailBoard {
  const tier = effectiveRailTier(state);
  const at = RAIL_TIERS.indexOf(tier);
  const week = weekOf(today);
  const current = state.weeks.find((w) => w.week === week);
  const currentRating = railRating(current?.loss ?? EMPTY_LOSS);
  const rows: RailRow[] = [
    { kind: 'you', name: 'You · this week', week, tier: null, orderBy: currentRating.rated ? currentRating.high : null, rating: currentRating },
  ];
  const ghosts = state.weeks.filter((w) => w.week < week && w.loss.n > 0).slice(-GHOST_WEEKS);
  for (const g of ghosts) {
    const r = railRating(g.loss);
    rows.push({ kind: 'ghost', name: 'You', week: g.week, tier: null, orderBy: r.rated ? r.high : null, rating: r });
  }
  for (const i of [at - 1, at, at + 1]) {
    const t = RAIL_TIERS[i];
    if (t) rows.push({ kind: 'bot', name: t.bot.name, week: null, tier: t, orderBy: t.bot.pace, rating: null });
  }
  const rated = rows.filter((r) => r.orderBy !== null).sort((a, b) => (a.orderBy as number) - (b.orderBy as number));
  const calibrating = rows.filter((r) => r.orderBy === null);
  return {
    tier,
    week,
    current: currentRating,
    toBeat: at < RAIL_TIERS.length - 1 ? tier.bot.pace : null,
    rows: [...rated, ...calibrating],
  };
}
