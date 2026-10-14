/**
 * THE LEAK FINDER (Pro, leak-finder): imported hands counted against Offsuit's own preflop charts.
 *
 * Counted, not graded. Each SPOT is a decision hero faced the same way many times (first in from the
 * cutoff; in the big blind against a button open; facing a 3-bet after opening): k of n times hero took
 * the action, and the chart's frequency for it is the share of all dealt hands the chart takes it with.
 * Hero is dealt random hands, so over enough hands the two should agree; how far apart they are, and how
 * sure we can be, is the whole report.
 *
 * NEVER A LEAK ON NOISE. A spot is called a leak only when ALL hold: at least MIN_OBSERVATIONS hands
 * (20), a gap of at least DEVIATION_THRESHOLD_POINTS (15 points), and the exact 90% band (Clopper-
 * Pearson) clear of the chart's number. These are the reads.ts gates, reused, so the leak finder and the
 * live reads cannot disagree about what counts as evidence.
 *
 * NOTHING ABOUT MONEY. Results are not read (handHistory.ts never parses them), so no win rate, no
 * profit, no "costliest" by money: spots are ordered by how far outside the chart they are (D10).
 *
 * POSITIONS count back from the button: BTN, then CO, HJ, UTG; a seat earlier than UTG (7 to 9 handed)
 * reads as UTG, the tightest chart. Heads-up hands count toward the summary only (the charts are 6-max).
 */

import {
  ALL_COMBOS,
  comboWeight,
  defenseAction,
  isInRfiRange,
  rfiWidth,
  threeBetResponseAction,
  TOTAL_COMBINATIONS,
  type DefensePosition,
  type Position,
  type ThreeBetResponsePosition,
} from '../preflop.js';
import { DEVIATION_THRESHOLD_POINTS, MIN_OBSERVATIONS } from '../reads.js';
import { clopperPearson, type Band } from './binomial.js';
import type { ParsedHand } from './handHistory.js';

export const BAND_LEVEL = 0.9;

/**
 * The charts are 100bb cash charts. A chart spot counts only in a cash hand with no ante where hero (and
 * the opener or 3-bettor faced) starts with at least this many big blinds; every hand still counts in the
 * summary. Tournament play at 15-25bb with antes is a different game, not a leak against these charts.
 */
export const MIN_CHART_DEPTH_BB = 60;

export type SpotKind = 'open' | 'bb-defend' | 'fold-to-3bet';

export interface SpotDef {
  readonly id: string;
  readonly kind: SpotKind;
  readonly position: Position;
  /** For bb-defend: the opener's position. */
  readonly versus: Position | null;
  readonly title: string;
  readonly detail: string;
  /** The chart's frequency for the counted action, 0..1. */
  readonly chart: number;
}

export type Reading = 'leak' | 'band-crosses' | 'under-gap' | 'in-line' | 'not-enough';

export interface SpotReport extends SpotDef {
  readonly n: number;
  readonly k: number;
  /** k / n, or null with no hands. */
  readonly you: number | null;
  readonly band: Band;
  /** (you - chart) in percentage points, or null with no hands. */
  readonly gapPoints: number | null;
  readonly reading: Reading;
  /** Hands still needed before the spot can be read at all (0 once it has MIN_OBSERVATIONS). */
  readonly needed: number;
}

export interface Summary {
  readonly hands: number;
  /** k / n pairs: voluntarily put money in, raised preflop, 3-bet when facing one raise, went to showdown having seen a flop. */
  readonly vpip: { k: number; n: number };
  readonly pfr: { k: number; n: number };
  readonly threeBet: { k: number; n: number };
  readonly wtsd: { k: number; n: number };
}

export interface LeakReport {
  readonly summary: Summary;
  /** Hands that count in the summary only: tournament, ante, or hero under MIN_CHART_DEPTH_BB. */
  readonly excluded: number;
  /** Leaks first (largest gap first), then every other spot with hands, then empty ones. */
  readonly spots: readonly SpotReport[];
}

const NAME: Readonly<Record<Position, string>> = { UTG: 'UTG', HJ: 'HJ', CO: 'CO', BTN: 'BTN', SB: 'SB', BB: 'BB' };

function shareOf(pred: (combo: string) => boolean): number {
  return ALL_COMBOS.reduce((s, c) => (pred(c) ? s + comboWeight(c) : s), 0) / TOTAL_COMBINATIONS;
}

/** The fold share of the hands a position opens, facing a 3-bet: folds inside the opening range / the opening range. */
function foldTo3betShare(position: ThreeBetResponsePosition): number {
  const opened = shareOf((c) => isInRfiRange(c, position));
  const folded = shareOf((c) => isInRfiRange(c, position) && threeBetResponseAction(c, position) === 'fold');
  return folded / opened;
}

const DEFENCE: Readonly<Partial<Record<Position, DefensePosition>>> = {
  UTG: 'bb-vs-utg',
  HJ: 'bb-vs-hj',
  CO: 'bb-vs-co',
  BTN: 'bb-vs-btn',
  SB: 'bb-vs-sb',
};

/** Every spot the finder counts, with the chart number it is held to. */
export const SPOTS: readonly SpotDef[] = [
  ...(['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const).map(
    (p): SpotDef => ({ id: `open-${p}`, kind: 'open', position: p, versus: null, title: `${NAME[p]} · open`, detail: 'first in, raise', chart: rfiWidth(p) }),
  ),
  ...(['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const).map(
    (p): SpotDef => ({
      id: `bb-vs-${p}`,
      kind: 'bb-defend',
      position: 'BB',
      versus: p,
      title: `BB · vs ${NAME[p]} open`,
      detail: 'defend: call or 3-bet',
      chart: shareOf((c) => defenseAction(c, DEFENCE[p]!) !== 'fold'),
    }),
  ),
  ...(['UTG', 'HJ', 'CO', 'BTN'] as const).map(
    (p): SpotDef => ({ id: `vs3bet-${p}`, kind: 'fold-to-3bet', position: p, versus: null, title: `${NAME[p]} · vs 3-bet`, detail: 'fold after opening', chart: foldTo3betShare(p) }),
  ),
];

/** Each seat's position (index into hand.seats), counted back from the button. Null heads-up. */
export function positionsOf(hand: ParsedHand): (Position | null)[] | null {
  const n = hand.seats.length;
  if (n < 3) return null;
  const out: (Position | null)[] = new Array(n).fill(null);
  const seat = (d: number): number => (hand.button + d) % n;
  out[seat(0)] = 'BTN';
  out[hand.sbSeat ?? seat(1)] = 'SB';
  out[hand.bbSeat ?? seat(2)] = 'BB';
  // Back from the button: CO, HJ, then UTG for every earlier seat.
  const back: Position[] = ['CO', 'HJ'];
  let k = 0;
  for (let d = n - 1; d >= 1; d--) {
    const i = seat(d);
    if (out[i] !== null) continue;
    out[i] = back[k++] ?? 'UTG';
  }
  return out;
}

interface Tally {
  k: number;
  n: number;
}

/** What one hand contributes: per spot id, whether hero took the counted action; plus summary flags. */
export interface HandFacts {
  readonly spots: readonly { readonly id: string; readonly took: boolean }[];
  readonly vpip: boolean;
  readonly pfr: boolean;
  /** null when hero never faced exactly one raise. */
  readonly threeBet: boolean | null;
  /** null when hero did not see a flop. */
  readonly showdown: boolean | null;
}

export function factsOf(hand: ParsedHand): HandFacts {
  const pos = positionsOf(hand);
  const pre = hand.actions.filter((a) => a.street === 'preflop');
  const spots: { id: string; took: boolean }[] = [];
  let raises = 0;
  let limps = 0;
  // Callers of the first raise before hero acts: a big blind with a cold-caller in front is a squeeze spot, not a defence.
  let coldCalls = 0;
  let opener: number | null = null;
  // The latest raise: who made it, and whether it was all in (an all-in open or 3-bet is not the chart's spot).
  let lastRaiser: number | null = null;
  let lastRaiseAllIn = false;
  // Each spot is held to a 100bb chart, so the players in it must be deep enough for that chart to apply.
  const deep = (seat: number | null): boolean => seat !== null && hand.seats[seat].stack >= MIN_CHART_DEPTH_BB * hand.bb;
  let heroActed = false;
  let heroOpened = false;
  let vpip = false;
  let pfr = false;
  let threeBet: boolean | null = null;
  let heroFoldedPre = false;
  let raisesAtHeroOpen = 0;

  for (const a of pre) {
    if (a.seat === hand.hero) {
      const voluntary = a.kind === 'call' || a.kind === 'raise' || a.kind === 'bet';
      if (voluntary) vpip = true;
      if (a.kind === 'raise' || a.kind === 'bet') pfr = true;
      if (a.kind === 'fold') heroFoldedPre = true;
      if (raises === 1 && threeBet === null) threeBet = a.kind === 'raise';
      if (!heroActed && pos !== null) {
        const p = pos[hand.hero];
        if (raises === 0 && limps === 0 && p !== null && p !== 'BB' && deep(hand.hero)) {
          const took = a.kind === 'raise' || a.kind === 'bet';
          spots.push({ id: `open-${p}`, took });
          if (took) {
            heroOpened = true;
            raisesAtHeroOpen = 1;
          }
        } else if (raises === 1 && limps === 0 && coldCalls === 0 && p === 'BB' && opener !== null && !lastRaiseAllIn && deep(hand.hero) && deep(opener)) {
          const op = pos[opener];
          if (op !== null && op !== 'BB' && DEFENCE[op] !== undefined) spots.push({ id: `bb-vs-${op}`, took: a.kind !== 'fold' });
        }
      } else if (heroOpened && pos !== null && raises === raisesAtHeroOpen + 1) {
        const p = pos[hand.hero];
        // Hero's first decision facing exactly one re-raise of hero's own open: not a squeeze (a caller in
        // between), not an all-in 3-bet, and against a 3-bettor deep enough for the chart.
        const plain = coldCalls === 0 && !lastRaiseAllIn && deep(lastRaiser);
        if (plain && (p === 'UTG' || p === 'HJ' || p === 'CO' || p === 'BTN')) spots.push({ id: `vs3bet-${p}`, took: a.kind === 'fold' });
        heroOpened = false;
      } else {
        heroOpened = false;
      }
      heroActed = true;
    }
    if (a.kind === 'raise' || a.kind === 'bet') {
      raises++;
      if (opener === null) opener = a.seat;
      lastRaiser = a.seat;
      lastRaiseAllIn = a.allIn;
    } else if (a.kind === 'call' && raises === 0) {
      limps++;
    } else if (a.kind === 'call' && raises === 1) {
      coldCalls++;
    }
  }

  const sawFlop = !heroFoldedPre && hand.board.length >= 3;
  return { spots, vpip, pfr, threeBet, showdown: sawFlop ? hand.showdown : null };
}

export function readingOf(n: number, you: number | null, chart: number, band: Band): Reading {
  if (n < MIN_OBSERVATIONS || you === null) return 'not-enough';
  const gap = Math.abs(you - chart) * 100;
  const clear = chart < band.low || chart > band.high;
  // reads.ts compares points with a small epsilon (0.65 - 0.5 lands just above 15); so does this.
  const big = gap >= DEVIATION_THRESHOLD_POINTS - 1e-9;
  if (big) return clear ? 'leak' : 'band-crosses';
  return clear ? 'under-gap' : 'in-line';
}

export function leakReport(hands: readonly ParsedHand[]): LeakReport {
  const tallies = new Map<string, Tally>(SPOTS.map((s) => [s.id, { k: 0, n: 0 }]));
  const vpip = { k: 0, n: 0 };
  const pfr = { k: 0, n: 0 };
  const threeBet = { k: 0, n: 0 };
  const wtsd = { k: 0, n: 0 };
  let excluded = 0;
  for (const hand of hands) {
    const chartable = hand.game === 'cash' && hand.ante === 0 && hand.seats[hand.hero].stack >= MIN_CHART_DEPTH_BB * hand.bb;
    if (!chartable) excluded++;
    const f = factsOf(hand);
    vpip.n++;
    pfr.n++;
    if (f.vpip) vpip.k++;
    if (f.pfr) pfr.k++;
    if (f.threeBet !== null) {
      threeBet.n++;
      if (f.threeBet) threeBet.k++;
    }
    if (f.showdown !== null) {
      wtsd.n++;
      if (f.showdown) wtsd.k++;
    }
    for (const s of chartable ? f.spots : []) {
      const t = tallies.get(s.id);
      if (t === undefined) continue;
      t.n++;
      if (s.took) t.k++;
    }
  }

  const spots: SpotReport[] = SPOTS.map((def) => {
    const { k, n } = tallies.get(def.id)!;
    const you = n > 0 ? k / n : null;
    const band = clopperPearson(k, n, BAND_LEVEL);
    return {
      ...def,
      n,
      k,
      you,
      band,
      gapPoints: you === null ? null : (you - def.chart) * 100,
      reading: readingOf(n, you, def.chart, band),
      needed: Math.max(0, MIN_OBSERVATIONS - n),
    };
  });
  const rank = (s: SpotReport): number => (s.reading === 'leak' ? 0 : s.n >= MIN_OBSERVATIONS ? 1 : s.n > 0 ? 2 : 3);
  spots.sort((a, b) => rank(a) - rank(b) || Math.abs(b.gapPoints ?? 0) - Math.abs(a.gapPoints ?? 0) || b.n - a.n);
  return { summary: { hands: hands.length, vpip, pfr, threeBet, wtsd }, excluded, spots };
}
