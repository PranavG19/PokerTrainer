/**
 * PREFLOP GRADED FROM THE CHARTS — the app's own blueprint (preflop.ts) decides the preflop verdict.
 *
 * Before this, preflop was graded on pot odds against one betting range. An unopened pot has a 25-chip
 * price and a 75-chip pot, so realistic equity gaps fell under the 0.5bb silence line and opening
 * mistakes were almost never graded, while the correct chart for every seat sat unused in preflop.ts.
 *
 * WHICH SPOTS. Three chart families, each only where the betting matches what the chart assumes:
 *  - RFI: nobody has entered voluntarily and hero is not the big blind. The position chart says open or
 *    fold; a limp is never in the chart ("raise or fold only").
 *  - DEFENCE: exactly one raise, no callers, and hero is the big blind (against any opener) or the small
 *    blind against the button. The chart says 3-bet, call or fold.
 *  - 3-BET RESPONSE: hero opened, faces exactly one 3-bet, no callers, from UTG / HJ / CO / BTN.
 * Everything else preflop (limped pots, multiway, squeezes, 4-bets, heads-up) is not a chart spot and is
 * graded by the pot-odds model against the aggressor's archetype range, as before.
 *
 * DIRECTION FROM THE CHART, SIZE FROM HOW FAR OUTSIDE IT. The chart says which action is right; it does
 * not say what a wrong one costs. The cost model, stated so it can be argued with:
 *   - Order all 169 hands by playability: first by the tightest seat whose RFI chart opens them (so every
 *     RFI chart is a prefix of the order), then by the Chen score. Within a spot, hands are ordered by the
 *     spot's own action (strongest action first) and then by that playability order, so every region of
 *     the spot's chart is an interval and its edges are combo-weighted shares.
 *   - TOO LOOSE (an open, call or 3-bet the chart does not make): d is how far the hand sits outside
 *     the region of hero's action, in share of all hands, and loss = K * pot(bb) * d^2. Quadratic because
 *     the published RFI EV curves are flat near the edge (a marginal open is worth hundredths of a big
 *     blind either way). K = 27 per pot-bb. Capped: unopened at 2/3 of the pot (1bb), because fold equity
 *     floors the loss of opening trash; facing a raise at a quarter of the price, because the hand's equity
 *     realises the rest.
 *   - TOO TIGHT (folding, or flatting, what the chart plays): loss = value * share, where value is what
 *     the best hand gives up by folding (2.7 pots unopened, i.e. 4bb, the order of published EVs for
 *     aces; one pot once raised) and share falls exponentially down the order (by e every 4% of hands,
 *     the published drop from aces to AKo) to 0 at the edge of hero's region. Aces therefore cost about
 *     the same from every seat. Flatting a hand the chart re-raises costs a fifth of folding it.
 *   With these, folding aces first in costs ~4bb from any seat, a hand 10% of all hands outside the
 *   cutoff chart ~0.4bb (under the silence line), and opening 72o the 1bb cap.
 * This is a model, not a solve, and it is graded as one: chart verdicts carry no `price` meter.
 *
 * MIXED CELLS ARE CLOSE. The charts are purified: where a published range mixes, preflop.ts rounds the
 * cell to all-in or all-out. So the cells beside a chart edge are graded close, not wrong: in RFI spots,
 * the authored BOUNDARY_COMBOS for the seat; in defence and 3-bet spots, a hand whose neighbour in its
 * row (one kicker up or down, or the next pair) takes a different action one region over (3-bet/call or
 * call/fold), when hero took that action.
 */
import { RANKS, type Card, type Rank } from './cards.js';
import {
  ALL_COMBOS,
  BOUNDARY_COMBOS,
  RFI_WIDTH_ORDER,
  TOTAL_COMBINATIONS,
  comboOf,
  comboWeight,
  defenseAction,
  isInRfiRange,
  threeBetResponseAction,
  type Combo,
  type DefenseAction,
  type DefensePosition,
  type RfiPosition,
  type ThreeBetResponsePosition,
} from './preflop.js';

export type ChartSpot =
  | { readonly kind: 'rfi'; readonly position: RfiPosition }
  | { readonly kind: 'defend'; readonly spot: DefensePosition }
  | { readonly kind: '3bet'; readonly opener: ThreeBetResponsePosition };

/** The hero's action collapsed onto the chart's vocabulary. */
export type ChartMove = 'fold' | 'call' | 'raise';


export function chartMove(action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin'): ChartMove {
  if (action === 'fold') return 'fold';
  if (action === 'call' || action === 'check') return 'call';
  return 'raise';
}

export const CHART_K = 27;
export const CAP_LOOSE_POTS = 2 / 3;
export const CAP_LOOSE_CALL = 0.25;
/** What folding the best hand gives up, in pots: 4bb of an unopened 1.5bb pot; one pot once raised. */
export const TIGHT_VALUE_UNOPENED_POTS = 2.7;
export const TIGHT_VALUE_RAISED_POTS = 1;
/** Flatting a hand the chart re-raises keeps the hand and loses only the extra value: a fifth of a fold. */
export const FLAT_SHARE = 0.2;
/** Share of all hands over which a hand's value falls by a factor e, from the top of the order. */
export const VALUE_DECAY = 0.04;

// ── Playability order ───────────────────────────────────────────────────────

/** Chen formula, a standard closed-form preflop hand score. Used only to break ties within a seat. */
export function chenScore(combo: Combo): number {
  const hi = combo[0] as Rank;
  const lo = combo[1] as Rank;
  const high = (r: Rank): number =>
    r === 'A' ? 10 : r === 'K' ? 8 : r === 'Q' ? 7 : r === 'J' ? 6 : (RANKS.indexOf(r) + 2) / 2;
  if (hi === lo) return Math.max(5, high(hi) * 2);
  let score = high(hi);
  if (combo[2] === 's') score += 2;
  const gap = RANKS.indexOf(hi) - RANKS.indexOf(lo) - 1;
  score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && RANKS.indexOf(hi) < RANKS.indexOf('Q')) score += 1;
  return Math.ceil(score);
}

/** Index in RFI_WIDTH_ORDER of the tightest seat that opens the hand; 5 when no seat does. */
function tightestOpener(combo: Combo): number {
  const i = RFI_WIDTH_ORDER.findIndex((p) => isInRfiRange(combo, p));
  return i === -1 ? RFI_WIDTH_ORDER.length : i;
}

/** All 169 hands, most playable first. */
export const PLAYABILITY_ORDER: readonly Combo[] = [...ALL_COMBOS].sort(
  (a, b) => tightestOpener(a) - tightestOpener(b) || chenScore(b) - chenScore(a),
);
const PLAYABILITY_RANK = new Map(PLAYABILITY_ORDER.map((c, i) => [c, i]));

// ── Spot charts ─────────────────────────────────────────────────────────────

const STRENGTH_OF: Record<ChartMove, number> = { raise: 0, call: 1, fold: 2 };

function toMove(a: DefenseAction): ChartMove {
  return a === 'threebet' ? 'raise' : a;
}

/** The chart's action for a hand in a spot. RFI has no call region: limping is never in the chart. */
export function chartAction(spot: ChartSpot, combo: Combo): ChartMove {
  if (spot.kind === 'rfi') return isInRfiRange(combo, spot.position) ? 'raise' : 'fold';
  if (spot.kind === 'defend') return toMove(defenseAction(combo, spot.spot));
  return toMove(threeBetResponseAction(combo, spot.opener));
}

interface Layout {
  /** Combo-weighted share at each hand's midpoint, in the spot's order. */
  readonly midpoint: ReadonlyMap<Combo, number>;
  /** [start, end) share of each action's region. */
  readonly region: Readonly<Record<ChartMove, readonly [number, number]>>;
}

const layouts = new Map<string, Layout>();

function spotKey(spot: ChartSpot): string {
  return spot.kind === 'rfi' ? `rfi:${spot.position}` : spot.kind === 'defend' ? `def:${spot.spot}` : `3b:${spot.opener}`;
}

function layoutOf(spot: ChartSpot): Layout {
  const key = spotKey(spot);
  const hit = layouts.get(key);
  if (hit) return hit;
  const ordered = [...ALL_COMBOS].sort(
    (a, b) =>
      STRENGTH_OF[chartAction(spot, a)] - STRENGTH_OF[chartAction(spot, b)] ||
      PLAYABILITY_RANK.get(a)! - PLAYABILITY_RANK.get(b)!,
  );
  const midpoint = new Map<Combo, number>();
  const region: Record<ChartMove, [number, number]> = { raise: [0, 0], call: [0, 0], fold: [0, 0] };
  let at = 0;
  let current: ChartMove | null = null;
  for (const combo of ordered) {
    const move = chartAction(spot, combo);
    if (move !== current) {
      region[move] = [at, at];
      current = move;
    }
    const w = comboWeight(combo) / TOTAL_COMBINATIONS;
    midpoint.set(combo, at + w / 2);
    at += w;
    region[move][1] = at;
  }
  // An empty region (RFI has no call region) sits at the edge between its neighbours.
  if (region.call[0] === 0 && region.call[1] === 0) region.call = [region.raise[1], region.raise[1]];
  const layout = { midpoint, region };
  layouts.set(key, layout);
  return layout;
}

/** How far the hand sits from the region of `move`, in share of all hands. 0 when it is in it. */
export function chartDistance(spot: ChartSpot, combo: Combo, move: ChartMove): number {
  const { midpoint, region } = layoutOf(spot);
  const x = midpoint.get(combo)!;
  const [lo, hi] = region[move];
  if (x < lo) return lo - x;
  if (x > hi) return x - hi;
  return 0;
}

// ── Mixed cells ─────────────────────────────────────────────────────────────

/** The hand one step up and one step down its row: kicker for unpaired hands, the next pair for pairs. */
function rowNeighbours(combo: Combo): Combo[] {
  const hi = RANKS.indexOf(combo[0] as Rank);
  const lo = RANKS.indexOf(combo[1] as Rank);
  const out: Combo[] = [];
  if (hi === lo) {
    for (const r of [hi - 1, hi + 1]) if (r >= 0 && r < RANKS.length) out.push(`${RANKS[r]}${RANKS[r]}`);
    return out;
  }
  const suffix = combo[2];
  for (const k of [lo - 1, lo + 1]) if (k >= 0 && k < hi) out.push(`${RANKS[hi]}${RANKS[k]}${suffix}`);
  return out;
}

/** True when hero's move is the purified-away side of a mixed cell at the chart's edge. */
export function isMixedCell(spot: ChartSpot, combo: Combo, move: ChartMove): boolean {
  if (spot.kind === 'rfi') return BOUNDARY_COMBOS[spot.position].includes(combo) && move !== 'call';
  const own = chartAction(spot, combo);
  if (own === move) return false;
  // Only one region over: a published solve mixes 3-bet with call, or call with fold, at an edge. A hand
  // the chart re-raises beside one it folds (AKo beside AQo facing a CO 3-bet) is not a mixed cell, so
  // folding it is a real mistake, not a close one.
  // The small blind against the button is a 3-bet-or-fold chart by design (preflop.ts), so there its
  // edge is 3-bet beside fold and two regions over is still one step.
  const steps = Math.abs(STRENGTH_OF[own] - STRENGTH_OF[move]);
  const threeBetOrFold = spot.kind === 'defend' && spot.spot === 'sb-vs-btn';
  if (steps !== 1 && !(threeBetOrFold && steps === 2)) return false;
  return rowNeighbours(combo).some((n) => chartAction(spot, n) === move);
}

// ── The verdict ─────────────────────────────────────────────────────────────

export interface ChartVerdict {
  readonly combo: Combo;
  readonly chart: ChartMove;
  readonly move: ChartMove;
  /** Point-estimate loss in bb under the cost model. 0 when the move is the chart's. */
  readonly lossBb: number;
  /** A mixed cell played on its other side. */
  readonly close: boolean;
}

export function chartVerdict(
  spot: ChartSpot,
  hole: readonly Card[],
  move: ChartMove,
  potBb: number,
  toCallBb: number = 0,
): ChartVerdict {
  const combo = comboOf(hole[0], hole[1]);
  const chart = chartAction(spot, combo);
  if (chart === move) return { combo, chart, move, lossBb: 0, close: false };
  // A limp is never in an RFI chart, but it is half of each mistake rather than all of either: it keeps a
  // hand the chart opens (giving up the initiative and the steal), or it puts chips behind a hand the
  // chart folds (but only a big blind's worth, not a raise's). So it costs half of the nearer mistake.
  if (spot.kind === 'rfi' && move === 'call') {
    const other = chartVerdict(spot, hole, chart === 'raise' ? 'fold' : 'raise', potBb, toCallBb);
    return { combo, chart, move, lossBb: other.lossBb / 2, close: false };
  }
  const looser = STRENGTH_OF[move] < STRENGTH_OF[chart];
  const pot = Math.max(0, potBb);
  let lossBb: number;
  if (looser) {
    // Facing a raise, a wrong continue loses at most about a quarter of what it puts in (the hand's equity
    // realises the rest); unopened, the open's loss is floored by fold equity at 2/3 of the pot.
    const d = chartDistance(spot, combo, move);
    const cap = spot.kind === 'rfi' ? pot * CAP_LOOSE_POTS : CAP_LOOSE_CALL * Math.max(0, toCallBb);
    lossBb = Math.min(cap, CHART_K * pot * d * d);
  } else {
    // Too tight: a hand's value falls off exponentially down the order from the top (published RFI EVs
    // drop from ~4bb for aces to ~1bb for AKo within the top 4% of hands), normalised to 0 at the edge of
    // hero's (weaker) region, so aces cost about the same from every seat.
    const { midpoint, region } = layoutOf(spot);
    const edge = region[move][0];
    const x = midpoint.get(combo)!;
    const curve = (t: number): number => Math.exp(-t / VALUE_DECAY);
    const share = edge > 0 && x < edge ? (curve(x) - curve(edge)) / (1 - curve(edge)) : 0;
    const value = pot * (spot.kind === 'rfi' ? TIGHT_VALUE_UNOPENED_POTS : TIGHT_VALUE_RAISED_POTS);
    lossBb = value * share * (move === 'fold' ? 1 : FLAT_SHARE);
  }
  return { combo, chart, move, lossBb, close: isMixedCell(spot, combo, move) };
}

/** The position name a learner reads for a spot's seat. */
export function spotLabel(spot: ChartSpot): string {
  if (spot.kind === 'rfi') return spot.position;
  if (spot.kind === '3bet') return spot.opener;
  return spot.spot.startsWith('bb') ? 'BB' : 'SB';
}

// ── Shoves ──────────────────────────────────────────────────────────────────

/**
 * Who calls a deep preflop shove: the value-only 4-bet range of the tightest opener facing a 3-bet
 * (QQ+ and AK). A shove of 40bb or more gets called by little else, so this is the range it runs into.
 */
export const SHOVE_CALL_RANGE: readonly Combo[] = ALL_COMBOS.filter((c) => threeBetResponseAction(c, 'UTG') === 'threebet');

/**
 * A deep preflop shove is not any chart's action, and the chart's standard-raise cost does not price it
 * (the grader never sees a size, Experiment 1 B1). So it is priced on its own, relative to folding now:
 *
 *   EV = P(all fold) * pot + P(called) * (share * (pot + 2 * stack) - stack)
 *
 * where each opponent holds the calling range with its own chance (`shoveCallChance` of what is known
 * of its range: any hand, an opener's chart, a 3-bettor's region), one caller is assumed, and `share` is hero's pot share against that range. loss = max(0, -EV). Against folding,
 * not against the chart's best line, so for a hand the chart plays it is a lower bound.
 */
/** The chance a hand drawn from `range` (all hands when omitted) is in the calling range. */
export function shoveCallChance(range?: readonly Combo[]): number {
  const calls = new Set(SHOVE_CALL_RANGE);
  const pool = range ?? ALL_COMBOS;
  const total = pool.reduce((n, c) => n + comboWeight(c), 0);
  const hit = pool.reduce((n, c) => n + (calls.has(c) ? comboWeight(c) : 0), 0);
  return total > 0 ? hit / total : 0;
}

/**
 * Each opponent's chance of calling, by what is known of its range: a player who has not acted holds any
 * hand; the opener holds its seat's RFI chart; a 3-bettor holds the big blind's 3-bet region against
 * hero's opening seat (the app has no 3-bettor chart by seat, so the defence chart stands in).
 */
export function openerCallChance(position: RfiPosition): number {
  return shoveCallChance(ALL_COMBOS.filter((c) => isInRfiRange(c, position)));
}

export function threeBettorCallChance(heroOpener: ThreeBetResponsePosition): number {
  const spot: DefensePosition = heroOpener === 'UTG' ? 'bb-vs-utg' : heroOpener === 'HJ' ? 'bb-vs-hj' : heroOpener === 'CO' ? 'bb-vs-co' : 'bb-vs-btn';
  return shoveCallChance(ALL_COMBOS.filter((c) => defenseAction(c, spot) === 'threebet'));
}

export function shoveLossBb(potBb: number, stackBb: number, callChances: readonly number[], share: number): number {
  const allFold = callChances.reduce((p, q) => p * (1 - q), 1);
  const called = share * (potBb + 2 * stackBb) - stackBb;
  const ev = allFold * potBb + (1 - allFold) * called;
  return Math.max(0, -ev);
}
