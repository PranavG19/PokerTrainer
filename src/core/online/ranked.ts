/**
 * RANKED — the online ladder's score, computed by the server from its own hand state (research §4).
 *
 * THE SCORE IS ABSOLUTE DECISION QUALITY: big blinds lost per 100 graded decisions, each decision graded
 * by the same `gradeDecision` the solo table coaches with, against the grader's model — never against
 * table-mates, never chips, never placement. So an accomplice who throws a game moves nobody's score,
 * and card luck is out by construction (review R8). Nothing a client says enters it: the server grades
 * what its own engine state shows each player held and did.
 *
 * HONESTY ABOUT NOISE. A score is a mean over a sample, so it is shown with its 95% interval, a player is
 * unrated until MIN_DECISIONS, and the ladder orders by the interval's pessimistic end (as Standing reads
 * a thin sample pessimistically), so a short lucky run cannot top it. Rows whose intervals overlap are
 * marked as not told apart.
 *
 * COLLUSION. It cannot be prevented, only made pointless (no prizes, invite-only) and capped: on the
 * season ladder a decision stops counting once a player has PAIR_CAP decisions with the same opponent at
 * the table, and nobody is listed until they have played MIN_OPPONENTS different people. A friends
 * league counts everything, because its members chose each other.
 *
 * Pure: no clock (the caller passes times), no crypto.
 */

import type { Card } from '../cards.js';
import { gradeDecision } from '../coach.js';
import { VILLAIN_BETTING_RANGE } from '../preflop.js';
import type { Action, TableState } from '../table.js';

/** Decisions a player needs in a season before they are rated. */
export const MIN_DECISIONS = 200;
/** On the season ladder, decisions counted per opponent pair. */
export const PAIR_CAP = 300;
/** Different opponents a player must have faced to be listed on the season ladder. */
export const MIN_OPPONENTS = 3;
/** The two-sided 95% normal quantile. */
const Z95 = 1.96;

// ── Seasons ─────────────────────────────────────────────────────────────────

/** A season is a calendar month in UTC: 'YYYY-MM'. */
export function seasonOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The season's first and last instants (ms, UTC). */
export function seasonBounds(season: string): { readonly start: number; readonly end: number } {
  const [y, m] = season.split('-').map(Number);
  return { start: Date.UTC(y, m - 1, 1), end: Date.UTC(y, m, 1) - 1 };
}

// ── The grader, pinned ──────────────────────────────────────────────────────

/**
 * The grader version a season is scored with. A season records the version it opened with and a server
 * whose grader differs refuses ranked play for the rest of it, so one season is never scored by two
 * graders. Bump this whenever `graderFingerprint()` changes (the pin test fails until you do).
 */
export const GRADER_VERSION = 1;

/** The fingerprint each released grader version produces; the server checks its own at startup. */
export const GRADER_FINGERPRINTS: Readonly<Record<number, string>> = { 1: '1bb4447d' };

/** One graded decision's full input, kept in the server's ledger so any grade can be recomputed. */
export interface GradeInput {
  readonly hole: Card[];
  readonly board: Card[];
  readonly street: string;
  readonly pot: number;
  readonly toCall: number;
  readonly stack: number;
  readonly bb: number;
  readonly chosen: Action['kind'];
  readonly betSize?: number;
  readonly opponents: number;
  readonly seed: number;
}

/**
 * What the grader is asked about a seat's action, read from the engine state before it — the same
 * quantities the solo table hands the coach (screens/table.ts computeHeroGrade): the seat's hole, the
 * board, the pot, the price, its stack, and the live opponents.
 */
export function gradeInputFor(before: TableState, seat: number, action: Action, seed: number): GradeInput {
  const hero = before.seats[seat];
  const toCall = Math.max(0, before.currentBet - hero.committed);
  const opponents = before.seats.filter((s) => s.id !== seat && !s.folded && s.hole.length > 0).length;
  return {
    hole: [...hero.hole],
    board: [...before.board],
    street: before.street,
    pot: before.pot,
    toCall,
    stack: hero.stack,
    bb: before.bb,
    chosen: action.kind,
    ...(action.amount !== undefined ? { betSize: action.amount } : {}),
    opponents: Math.max(1, opponents),
    seed,
  };
}

/** Grade one decision: bb lost against the grader's best play. Non-finite losses count as 0 (silence). */
export function gradeInput(input: GradeInput): number {
  const grade = gradeDecision({
    ...input,
    hole: [...input.hole],
    board: [...input.board],
    // Facing a price, the aggressor's modelled range, exactly as the solo table grades.
    villainRange: input.toCall > 0 ? VILLAIN_BETTING_RANGE : undefined,
  });
  return Number.isFinite(grade.evLossBb) ? Math.max(0, grade.evLossBb) : 0;
}

/** A fixed corpus of spots, one per grader branch, so any change to what the grader says changes this. */
const PIN_SPOTS: readonly GradeInput[] = [
  { hole: ['Ah', 'Kd'], board: [], street: 'preflop', pot: 75, toCall: 50, stack: 4950, bb: 50, chosen: 'fold', opponents: 2, seed: 11 },
  { hole: ['7c', '2d'], board: [], street: 'preflop', pot: 75, toCall: 50, stack: 4950, bb: 50, chosen: 'call', opponents: 2, seed: 12 },
  { hole: ['Qs', 'Qh'], board: ['2c', '7d', 'Jh'], street: 'flop', pot: 300, toCall: 0, stack: 4700, bb: 50, chosen: 'fold', opponents: 1, seed: 13 },
  { hole: ['9s', '8s'], board: ['2c', '7d', 'Jh', 'Kc'], street: 'turn', pot: 600, toCall: 400, stack: 4000, bb: 50, chosen: 'call', opponents: 1, seed: 14 },
  { hole: ['As', 'Ad'], board: ['2c', '7d', 'Jh', 'Kc', '3s'], street: 'river', pot: 900, toCall: 0, stack: 3800, bb: 50, chosen: 'check', opponents: 1, seed: 15 },
  { hole: ['4h', '3h'], board: ['Ac', 'Kd', 'Qh'], street: 'flop', pot: 300, toCall: 0, stack: 4700, bb: 50, chosen: 'bet', betSize: 200, opponents: 2, seed: 16 },
  { hole: ['Th', '9h'], board: ['8h', '7c', '2h'], street: 'flop', pot: 400, toCall: 300, stack: 4500, bb: 50, chosen: 'raise', betSize: 1200, opponents: 1, seed: 17 },
  { hole: ['Kh', 'Kc'], board: ['Ks', '7c', '2h', '9d'], street: 'turn', pot: 800, toCall: 600, stack: 3000, bb: 50, chosen: 'fold', opponents: 1, seed: 18 },
  { hole: ['6d', '5d'], board: ['Ac', 'Ad', 'Kh', 'Kd', 'Qs'], street: 'river', pot: 1000, toCall: 1000, stack: 2000, bb: 50, chosen: 'allin', opponents: 1, seed: 19 },
];

/** FNV-1a over the corpus' grades rounded to 1/1000 bb: what GRADER_FINGERPRINTS pins. */
export function graderFingerprint(): string {
  let h = 0x811c9dc5;
  for (const spot of PIN_SPOTS) {
    const text = `${Math.round(gradeInput(spot) * 1000)};`;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}

// ── The rating ──────────────────────────────────────────────────────────────

/** Running sums for one player's decisions: enough for the mean and its interval. */
export interface Tally {
  readonly n: number;
  readonly sum: number;
  readonly sumSq: number;
}

export const EMPTY_TALLY: Tally = { n: 0, sum: 0, sumSq: 0 };

export function addLoss(t: Tally, lossBb: number): Tally {
  return { n: t.n + 1, sum: t.sum + lossBb, sumSq: t.sumSq + lossBb * lossBb };
}

export interface Rating {
  readonly decisions: number;
  /** Big blinds lost per 100 decisions: lower is better, 0 is the grader's own play. */
  readonly bbPer100: number;
  /** The 95% interval of bbPer100 (low clamped at 0: nobody plays better than the grader's best). */
  readonly low: number;
  readonly high: number;
  /** False until MIN_DECISIONS: the number is shown as calibrating, never ranked. */
  readonly rated: boolean;
}

export function rate(t: Tally): Rating {
  if (t.n === 0) return { decisions: 0, bbPer100: 0, low: 0, high: 0, rated: false };
  const mean = t.sum / t.n;
  const variance = t.n > 1 ? Math.max(0, (t.sumSq - t.n * mean * mean) / (t.n - 1)) : 0;
  const half = Z95 * Math.sqrt(variance / t.n);
  const r = (x: number): number => Math.round(x * 10) / 10;
  return {
    decisions: t.n,
    bbPer100: r(100 * mean),
    low: r(Math.max(0, 100 * (mean - half))),
    high: r(100 * (mean + half)),
    rated: t.n >= MIN_DECISIONS,
  };
}

export interface BoardRow {
  readonly keyId: string;
  readonly name: string;
  readonly rating: Rating;
  /** 1-based place among rated rows. */
  readonly place: number;
  /** This row's interval overlaps the row above: the data cannot tell the two apart. */
  readonly tiedAbove: boolean;
  readonly you: boolean;
}

export interface Board {
  readonly rows: readonly BoardRow[];
  /** Players with decisions this season who are not rated yet. */
  readonly calibrating: number;
}

/**
 * Order rated players by the pessimistic end of their interval (lower loss first), then by sample size.
 * `limit` rows are listed; the viewer's own row is always included.
 */
export function buildBoard(
  entries: readonly { readonly keyId: string; readonly name: string; readonly tally: Tally; readonly eligible?: boolean }[],
  viewer: string | null,
  limit = 50,
): Board {
  const rated = entries
    .map((e) => ({ ...e, rating: rate(e.tally) }))
    .filter((e) => e.rating.rated && e.eligible !== false)
    .sort((a, b) => a.rating.high - b.rating.high || b.rating.decisions - a.rating.decisions || a.keyId.localeCompare(b.keyId));
  const rows: BoardRow[] = rated.map((e, i) => ({
    keyId: e.keyId,
    name: e.name,
    rating: e.rating,
    place: i + 1,
    tiedAbove: i > 0 && e.rating.low <= rated[i - 1].rating.high,
    you: e.keyId === viewer,
  }));
  const shown = rows.filter((row, i) => i < limit || row.you);
  return { rows: shown, calibrating: entries.filter((e) => e.tally.n > 0).length - rated.length };
}
