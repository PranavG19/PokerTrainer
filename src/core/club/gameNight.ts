/**
 * HOME GAME NIGHT — a hosted LAN session night, graded on decisions and recapped together. Pure.
 *
 * WHO GRADES WHAT. Each player grades only their OWN decisions, on their own machine, from the redacted view
 * the relay already sends them (their two cards, the board, the pot, the price). The host's relay sees every
 * hole card, but grading anyone else there would tell the host something about a folded hand, so it grades
 * nobody. The grader is the one the online ladder and the solo table use (online/ranked.ts gradeInput's
 * inputs, coach.gradeDecision), and a decision is "clean" when it costs nothing a verdict would name.
 *
 * NEVER CHIPS. Nothing here reads a stack change or a pot won. The night counts hands that ended, decisions
 * graded, clean decisions and big blinds lost against the grader's play; the shared recap pools those four
 * counts across the friends who paste theirs in (codes.ts), and never orders the players.
 */

import { gradeDecision } from '../coach.js';
import { VILLAIN_BETTING_RANGE } from '../preflop.js';
import type { DayKey } from '../localDay.js';
import { LAN_TABLE, type RoomView } from '../multiplayer.js';
import type { Action } from '../table.js';
import type { NightRecap, NightRecord } from '../progression/types.js';
import { clubName, encodeClubCode, type SharedSpot } from './codes.js';

export type { NightRecord, NightSpot } from '../progression/types.js';

/** The spots a night keeps for review: the costliest few, as codes. */
export const NIGHT_SPOTS = 3;
/** Names a night remembers from the table (the other seats; a table is at most six). */
export const NIGHT_SEEN = 5;

export function startNight(night: string, day: DayKey, role: 'host' | 'join', at: number): NightRecord {
  return { night, day, role, startedAt: at, endedAt: null, hands: 0, lastHand: 0, decisions: 0, clean: 0, lossCentiBb: 0, spots: [], seen: [], friends: [] };
}

/** The spot the viewer is deciding, read from their own view; null when it is not their turn or no hand is live. */
export function spotFromView(view: RoomView, action: Action): SharedSpot | null {
  if (!view.yourTurn || view.winners !== null || !view.legal.includes(action.kind)) return null;
  const me = view.seats.find((s) => s.isYou);
  if (me === undefined || me.hole === null || me.hole.length !== 2) return null;
  const opponents = view.seats.filter((s) => !s.isYou && s.inHand && !s.folded).length;
  return {
    hole: [me.hole[0], me.hole[1]],
    board: [...view.board],
    bb: LAN_TABLE.bb,
    pot: view.pot,
    toCall: Math.max(0, view.currentBet - me.committed),
    stack: me.stack,
    opponents: Math.max(1, opponents),
    chosen: action.kind,
  };
}

/**
 * The decision's identity within a night: the same view acted on twice (a double click) is one decision.
 * A turn is told apart by the hand, the street and the betting so far.
 */
export function decisionKey(view: RoomView): string {
  const me = view.seats.find((s) => s.isYou);
  return `${view.handNumber}:${view.street}:${view.pot}:${view.currentBet}:${me?.committed ?? 0}`;
}

/** A stable Monte Carlo seed from the spot itself, so a friend opening its code sees the same grade. */
export function spotSeed(spot: SharedSpot): number {
  let h = 0x811c9dc5;
  const text = `${spot.hole.join('')}|${spot.board.join('')}|${spot.pot}|${spot.toCall}|${spot.stack}|${spot.opponents}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface SpotGrade {
  readonly lossBb: number;
  readonly clean: boolean;
  /** The grader's sentence when it has one (null on a clean or a close spot). */
  readonly message: string | null;
}

const STREETS: Record<number, string> = { 0: 'preflop', 3: 'flop', 4: 'turn', 5: 'river' };

/** Grade one choice at a shared spot, exactly as online/ranked.ts gradeInput asks the coach. */
export function gradeShared(spot: SharedSpot, chosen: Action['kind']): SpotGrade {
  const grade = gradeDecision({
    hole: [...spot.hole],
    board: [...spot.board],
    street: STREETS[spot.board.length] ?? 'preflop',
    pot: spot.pot,
    toCall: spot.toCall,
    stack: spot.stack,
    bb: spot.bb,
    chosen,
    opponents: spot.opponents,
    seed: spotSeed(spot),
    villainRange: spot.toCall > 0 ? VILLAIN_BETTING_RANGE : undefined,
  });
  const lossBb = Number.isFinite(grade.evLossBb) ? Math.max(0, grade.evLossBb) : 0;
  return { lossBb, clean: grade.severity === 'free', message: grade.message };
}

/** Add one graded decision. The costliest NIGHT_SPOTS are kept as codes, costliest first. */
export function recordDecision(night: NightRecord, spot: SharedSpot, grade: SpotGrade): NightRecord {
  const lossCentiBb = Math.round(grade.lossBb * 100);
  const spots = lossCentiBb > 0
    ? [...night.spots, { code: encodeClubCode({ kind: 'spot', spot }), lossCentiBb }]
        .sort((a, b) => b.lossCentiBb - a.lossCentiBb)
        .slice(0, NIGHT_SPOTS)
    : night.spots;
  return {
    ...night,
    decisions: night.decisions + 1,
    clean: night.clean + (grade.clean ? 1 : 0),
    lossCentiBb: night.lossCentiBb + lossCentiBb,
    spots,
  };
}

/** Fold in a fresh view: a hand that just ended counts once, and the other seats' names are remembered. */
export function observeView(night: NightRecord, view: RoomView): NightRecord {
  let next = night;
  const ended = view.winners !== null && view.handNumber > night.lastHand;
  if (ended) next = { ...next, hands: next.hands + 1, lastHand: view.handNumber };
  const names = view.seats.filter((s) => !s.isYou && s.inHand).map((s) => clubName(s.name)).filter((n) => n.length > 0);
  const seen = [...next.seen];
  for (const name of names) if (!seen.includes(name) && seen.length < NIGHT_SEEN) seen.push(name);
  return seen.length === next.seen.length ? next : { ...next, seen };
}

export function endNight(night: NightRecord, at: number): NightRecord {
  return night.endedAt === null ? { ...night, endedAt: at } : night;
}

/** This player's recap, the counts a recap code carries. */
export function recapOf(night: NightRecord, name: string): NightRecap {
  return {
    night: night.night,
    day: night.day,
    name: clubName(name) || 'Player',
    hands: Math.min(night.hands, 1_000_000),
    decisions: Math.min(night.decisions, 1_000_000),
    clean: Math.min(night.clean, night.decisions, 1_000_000),
    lossCentiBb: Math.min(night.lossCentiBb, 0x0fffffff),
  };
}

export type AddRecapResult = { readonly ok: true; readonly night: NightRecord } | { readonly ok: false; readonly reason: string };

/** A friend's recap joins the table only if it is from this night and is not your own. */
export function addFriendRecap(night: NightRecord, recap: NightRecap, yourName: string): AddRecapResult {
  if (recap.night !== night.night) return { ok: false, reason: 'That recap is from a different Game Night.' };
  if (recap.name === clubName(yourName)) return { ok: false, reason: 'That recap carries your own table name.' };
  const friends = [...night.friends.filter((f) => f.name !== recap.name), recap].sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, night: { ...night, friends: friends.slice(0, NIGHT_SEEN) } };
}

/** The table's pooled counts: everyone who shared, summed. Never per player, never ordered. */
export interface Pooled {
  readonly players: number;
  readonly hands: number;
  readonly decisions: number;
  readonly clean: number;
  /** Share of decisions that were clean, 0..1; null with no decisions. */
  readonly cleanRate: number | null;
  /** Big blinds lost per 100 decisions; null with no decisions. */
  readonly bbPer100: number | null;
}

export function pool(recaps: readonly Pick<NightRecap, 'hands' | 'decisions' | 'clean' | 'lossCentiBb'>[]): Pooled {
  const decisions = recaps.reduce((t, r) => t + r.decisions, 0);
  const clean = recaps.reduce((t, r) => t + r.clean, 0);
  const loss = recaps.reduce((t, r) => t + r.lossCentiBb, 0) / 100;
  return {
    players: recaps.length,
    // Everyone at one table sees the same hands; the longest sitting is the night's length.
    hands: recaps.reduce((m, r) => Math.max(m, r.hands), 0),
    decisions,
    clean,
    cleanRate: decisions > 0 ? clean / decisions : null,
    bbPer100: decisions > 0 ? Math.round((100 * loss) / decisions * 10) / 10 : null,
  };
}

/** The night with you and every friend who shared: what the recap's "The table" shows. */
export function pooledNight(night: NightRecord, yourName: string): Pooled {
  return pool([recapOf(night, yourName), ...night.friends]);
}
