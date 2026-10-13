/**
 * The rival dossier: only the reads the learner has earned, and only from showdowns.
 *
 * Round 2's rule, made structural: `recordRivalHand` stores what the rival DID only for a hand that reached a
 * showdown, where their cards were turned up. A hand they won uncontested, or folded, adds to the hand count
 * and nothing else, so no read can come from the engine's hidden cards or the archetype's parameters. The
 * reads below are counts over those showdowns, and each one is shown only once it has READ_MIN observations;
 * until then it says how many more it needs.
 *
 * Decision quality against the rival is the learner's own graded decisions, one sitting per table
 * (campaign.ts `judgeTable`), never chips.
 *
 * Pure.
 */

import { evaluate, HandCategory } from '../evaluate.js';
import type { DayKey } from '../localDay.js';
import { MAX_RIVAL_SHOWDOWNS, MAX_RIVAL_SITTINGS } from '../progression/persist.js';
import type { RivalAction, RivalRecord, RivalSitting, ShowdownRecord } from '../progression/types.js';
import type { StoryEvent, StoryFacts } from './scripts.js';

/** A read needs this many observations before the dossier states it. */
export const READ_MIN = 3;
/** A bet of at least this share of the pot before it is a "big bet". */
export const BIG_BET_SHARE = 0.5;
/** How far a read must sit from the balanced baseline before Dee calls it the signature. */
export const SIGNATURE_MARGIN = 0.15;

export function emptyRivalRecord(): RivalRecord {
  return { hands: 0, sittings: [], showdowns: [] };
}

/** One finished hand against the rival, as the table saw it. `shown` is set only at a real showdown. */
export interface RivalHand {
  readonly actions: readonly RivalAction[];
  /** The rival's cards if they were turned up at a showdown (two or more hands still live at the end). */
  readonly shown: readonly string[] | null;
  readonly board: readonly string[];
}

/**
 * One villain action as the hero saw it, before it is applied. An all-in that does not exceed the bet it faces is
 * a call for the stack (the engine offers `allin` instead of `call` to a seat that cannot cover), so it is
 * recorded as a call; only chips added beyond the bet faced make a bet or raise, sized against the pot before it.
 */
export function capturedAction(
  t: { readonly street: RivalAction['street']; readonly pot: number; readonly currentBet: number },
  seat: { readonly committed: number; readonly stack: number },
  action: { readonly kind: RivalAction['kind']; readonly amount?: number },
): RivalAction {
  const facing = t.currentBet - seat.committed;
  const facingBet = facing > 0;
  if (action.kind === 'allin' && seat.committed + seat.stack <= t.currentBet) {
    return { street: t.street, kind: 'call', facingBet, potShare: null };
  }
  const added =
    action.kind === 'allin' ? seat.stack : action.kind === 'bet' || action.kind === 'raise' ? (action.amount ?? 0) - seat.committed : 0;
  return { street: t.street, kind: action.kind, facingBet, potShare: added > 0 && t.pot > 0 ? added / t.pot : null };
}

export function recordRivalHand(record: RivalRecord, hand: RivalHand, day: DayKey): RivalRecord {
  const hands = record.hands + 1;
  if (hand.shown === null || hand.shown.length !== 2 || hand.board.length !== 5) return { ...record, hands };
  const showdown: ShowdownRecord = { day, shown: [...hand.shown], board: [...hand.board], actions: hand.actions.map((a) => ({ ...a })) };
  return { ...record, hands, showdowns: [...record.showdowns, showdown].slice(-MAX_RIVAL_SHOWDOWNS) };
}

export function recordRivalSitting(record: RivalRecord, sitting: RivalSitting): RivalRecord {
  return { ...record, sittings: [...record.sittings, sitting].slice(-MAX_RIVAL_SITTINGS) };
}

/** What the rival's shown hand was worth: nothing beyond the board, one pair of their own, or better. */
export type ShownStrength = 'nothing' | 'pair' | 'strong';

export function shownStrength(s: Pick<ShowdownRecord, 'shown' | 'board'>): ShownStrength {
  const hand = evaluate([...s.shown, ...s.board]);
  const board = evaluate([...s.board]);
  // Playing the board, or improving it only by a kicker, is a hand that held nothing of its own.
  if (hand.category === HandCategory.HighCard || hand.category <= board.category) return 'nothing';
  // On a paired board, "two pair" that uses the board's pair is one pair of their own; two pairs of their own is not.
  const boardPair = board.category === HandCategory.Pair ? board.kickers[0] : null;
  const usesBoardPair = hand.category === HandCategory.TwoPair && boardPair !== null && hand.kickers.slice(0, 2).includes(boardPair);
  if (hand.category === HandCategory.Pair || usesBoardPair) return 'pair';
  return 'strong';
}

const isAggressive = (a: RivalAction): boolean => a.kind === 'bet' || a.kind === 'raise' || a.kind === 'allin';

export interface Read {
  readonly id: 'big-bets' | 'calls' | 'bets';
  /** What is counted, in words. */
  readonly label: string;
  /** Observations so far (the denominator). */
  readonly seen: number;
  /** The counted ones (the numerator). */
  readonly count: number;
  /** Earned once `seen` reaches READ_MIN. */
  readonly earned: boolean;
  /** Observations still needed, 0 once earned. */
  readonly needs: number;
  /** count / seen, or null before the first observation. */
  readonly share: number | null;
  /** The balanced reading this is compared with, for the signature. */
  readonly baseline: number;
  /** How the count reads, in words, e.g. "were bluffs". */
  readonly counted: string;
}

function read(id: Read['id'], label: string, counted: string, count: number, seen: number, baseline: number): Read {
  return {
    id,
    label,
    counted,
    seen,
    count,
    earned: seen >= READ_MIN,
    needs: Math.max(0, READ_MIN - seen),
    share: seen > 0 ? count / seen : null,
    baseline,
  };
}

/**
 * The three reads, over showdowns only:
 * - big bets: of the showdowns where the rival's last bet was at least half the pot, how many held nothing;
 * - calls: of the showdowns where the rival called a bet on the turn or river, how many held a pair or less;
 * - bets: of the showdowns where the rival bet or raised at all, how many held better than one pair.
 */
export function reads(showdowns: readonly ShowdownRecord[]): Read[] {
  let bigBets = 0;
  let bluffs = 0;
  let calls = 0;
  let thin = 0;
  let bets = 0;
  let strong = 0;
  for (const s of showdowns) {
    const strength = shownStrength(s);
    const aggression = s.actions.filter(isAggressive);
    const last = aggression[aggression.length - 1];
    if (last && (last.potShare ?? 0) >= BIG_BET_SHARE) {
      bigBets++;
      if (strength === 'nothing') bluffs++;
    }
    if (s.actions.some((a) => a.kind === 'call' && a.facingBet && (a.street === 'turn' || a.street === 'river'))) {
      calls++;
      if (strength !== 'strong') thin++;
    }
    if (aggression.length > 0) {
      bets++;
      if (strength === 'strong') strong++;
    }
  }
  return [
    read('big-bets', 'Big bets shown down', 'were bluffs', bluffs, bigBets, 1 / 3),
    read('calls', 'Late calls shown down', 'held a pair or less', thin, calls, 1 / 2),
    read('bets', 'Bets shown down', 'held two pair or better', strong, bets, 1 / 2),
  ];
}

/** The earned read furthest from its baseline, if any sits more than SIGNATURE_MARGIN away. */
export function signature(all: readonly Read[]): Read | null {
  let best: Read | null = null;
  let gap = SIGNATURE_MARGIN;
  for (const r of all) {
    if (!r.earned || r.share === null) continue;
    const g = Math.abs(r.share - r.baseline);
    if (g > gap) {
      best = r;
      gap = g;
    }
  }
  return best;
}

/** Dee's one-line take: which line, and the counts it may say. */
export function takeOf(all: readonly Read[]): { event: StoryEvent; facts: StoryFacts } {
  const [big, calls, bets] = all;
  const facts: StoryFacts = {
    bigBets: String(big.seen),
    bluffs: String(big.count),
    calls: String(calls.seen),
    thin: String(calls.count),
    bets: String(bets.seen),
    strong: String(bets.count),
  };
  const sig = signature(all);
  if (sig === null) return { event: all.some((r) => r.earned) ? 'take-baseline' : 'take-none', facts };
  const high = (sig.share ?? 0) > sig.baseline;
  const event: StoryEvent =
    sig.id === 'big-bets'
      ? high
        ? 'take-bluffs-high'
        : 'take-bluffs-low'
      : sig.id === 'calls'
        ? high
          ? 'take-thin-high'
          : 'take-thin-low'
        : high
          ? 'take-strong-high'
          : 'take-strong-low';
  return { event, facts };
}

/** Decision quality per table against the rival, oldest first: what the dossier's trend draws. */
export function qualityTrend(record: RivalRecord): { day: DayKey; judged: number; free: number; share: number | null }[] {
  return record.sittings.map((s) => ({ day: s.day, judged: s.judged, free: s.free, share: s.judged > 0 ? s.free / s.judged : null }));
}
