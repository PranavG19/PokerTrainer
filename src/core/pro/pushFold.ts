/**
 * PUSH-FOLD (Pro, icm-tools): shove or fold, first in, against EXPLICIT calling ranges.
 *
 * The spot: a table of stacks (big blinds, before posting), the button, the player to act ("hero"),
 * blinds 0.5 / 1 and an ante. Everyone before hero has folded; hero shoves all in or folds; each player
 * behind, in turn, calls or folds. The value of an outcome is hero's final stack (chip EV) or hero's
 * share of the prize pool by Malmuth-Harville ICM over everyone's final stacks (icm.ts).
 *
 * WHO CALLS, AND WITH WHAT. Every caller has a range: 169 class weights, given explicitly. Either a fixed
 * one (`topRange(share)`, or any range the caller passes) or the equilibrium's own: `solveShove` finds
 * the calling ranges that are best responses to hero's shoving range while hero's range is a best
 * response to them (fictitious play). Nothing here assumes a caller holds QQ+ and AK: that is the
 * table grader's model for a DEEP preflop shove (chartGrade.ts SHOVE_CALL_RANGE) and it is wrong at
 * push-fold depths, so it is not reused. A caller with a tighter or looser range is a different spot.
 *
 * MODEL LIMITS, stated so a number is never read as more than it is:
 * - One caller at most. If a player calls, everyone after folds (no overcalls, no isolation). This is the
 *   usual push-fold model; it misprices spots where two players behind both like to call.
 * - Hero folding gives the posted money to the big blind (the rest of the hand is not played out).
 * - A player already all in from the blinds or ante (or whose post covers the shove) is FORCED: it is in
 *   the showdown with any hand. It must be the last to act (the big blind): one all in ahead of a live
 *   player would make the pot three-way, so that spot is refused rather than mispriced. If an earlier player
 *   calls, a forced big blind's money is treated as dead.
 * - Pots are settled in layers (`settle`): a folder's post above what an all-in can match goes back to the
 *   player who covers it, never to a winner who could not have won it.
 * - A caller's fold is valued as hero winning the pot uncontested, which is exact for the last player
 *   to act (the big blind) and an approximation for players with others still behind them.
 * - Equity is the all-in pot share (wins plus half of ties) from the preflop table; card removal between
 *   hero and the caller is exact at the class level, and ignored between two different callers.
 *
 * Heads-up in chips the game is zero-sum, so fictitious play converges to the Nash equilibrium and
 * `exploitability` says how close it got (tests/unit/pro-pushfold.test.ts pins it).
 */

import { icmEquities } from './icm.js';
import { CLASS_COUNT, CLASS_SIZE, COMPAT } from './handClasses.js';
import { equityTable, rangeShare, type ClassRange } from './preflopEquity.js';

export interface ShoveSpot {
  /** Stacks in big blinds BEFORE blinds and antes are posted, in seat order (clockwise). */
  readonly stacks: readonly number[];
  readonly button: number;
  /** The seat to act, first in. Not the big blind (folded to the big blind, the hand is over). */
  readonly hero: number;
  /** Each player's ante in big blinds (0 for none). */
  readonly ante: number;
  /** Prize shares by place, e.g. [0.5, 0.3, 0.2]. Empty: chip EV. */
  readonly payouts: readonly number[];
}

export interface SpotShape {
  readonly n: number;
  readonly sb: number;
  readonly bb: number;
  /** Seats behind hero that can call, in the order they act. */
  readonly callers: readonly number[];
  /** What each seat has put in before hero acts (blinds and ante). */
  readonly posted: readonly number[];
  /**
   * Per caller: already all in for at least hero's shove (its whole stack is posted, or its post covers
   * the shove). Such a player has no decision: it is in the showdown, whatever calling range is named.
   */
  readonly forced: readonly boolean[];
}

export const MAX_SPOT_STACK_BB = 100;

/** Seats, blinds and who is behind hero; throws on a spot that cannot happen. */
export function shapeOf(spot: ShoveSpot): SpotShape {
  const n = spot.stacks.length;
  if (n < 2 || n > 10) throw new RangeError(`players ${n}`);
  for (const s of spot.stacks) if (!(s > 0 && s <= MAX_SPOT_STACK_BB)) throw new RangeError(`stack ${s}`);
  if (!(spot.ante >= 0 && spot.ante <= 1)) throw new RangeError(`ante ${spot.ante}`);
  const seat = (i: number): number => ((i % n) + n) % n;
  if (!Number.isInteger(spot.button) || spot.button < 0 || spot.button >= n) throw new RangeError('button');
  // Heads-up the button posts the small blind.
  const sb = n === 2 ? spot.button : seat(spot.button + 1);
  const bb = seat(sb + 1);
  if (!Number.isInteger(spot.hero) || spot.hero < 0 || spot.hero >= n || spot.hero === bb) throw new RangeError('hero');
  const posted = spot.stacks.map((s, i) => {
    let p = Math.min(s, spot.ante);
    if (i === sb) p += Math.min(s - p, 0.5);
    if (i === bb) p += Math.min(s - p, 1);
    return p;
  });
  // A hero all in from the blinds or the ante has nothing to decide.
  if (!(spot.stacks[spot.hero] - posted[spot.hero] > 1e-9)) throw new RangeError('hero is already all in');
  const callers: number[] = [];
  for (let i = seat(spot.hero + 1); ; i = seat(i + 1)) {
    callers.push(i);
    if (i === bb) break;
  }
  const forced = callers.map((j) => spot.stacks[j] - posted[j] <= 1e-9 || posted[j] >= spot.stacks[spot.hero] - 1e-9);
  // A forced player with someone still to act behind it would make the pot three-way, which this one-caller
  // model cannot price (it would silently skip the later player's decision), so such a spot is refused.
  if (forced.slice(0, -1).some((f) => f)) throw new RangeError('a player all in from the blinds ahead of another: three-way');
  return { n, sb, bb, callers, posted, forced };
}

interface Outcomes {
  /** Final stacks when nobody calls, and per caller when that caller wins / hero wins. */
  readonly noCall: number[];
  readonly heroWins: number[][];
  readonly callerWins: number[][];
  readonly heroFolds: number[];
}

/**
 * Final stacks after the pot is settled: `contrib[k]` is what seat k put in, `live` the players still in
 * (eligible to win), `winner` the live player who has the best hand. The pot is cut into layers at each
 * contribution level; a layer goes to the winner if the winner reached it, else to the other live player
 * who did, else (money above every live player's stake: an uncalled bet, or a folder's post above what an
 * all-in could match) back to whoever put it in.
 */
export function settle(stacks: readonly number[], contrib: readonly number[], live: readonly number[], winner: number): number[] {
  const out = stacks.map((s, k) => s - contrib[k]);
  const levels = [...new Set(contrib.filter((c) => c > 0))].sort((x, y) => x - y);
  let prev = 0;
  for (const level of levels) {
    let layer = 0;
    const share = contrib.map((c) => Math.max(0, Math.min(c, level) - prev));
    for (const x of share) layer += x;
    const eligible = live.filter((k) => contrib[k] >= level - 1e-12);
    if (eligible.includes(winner)) out[winner] += layer;
    else if (eligible.length > 0) out[eligible[0]] += layer;
    else share.forEach((x, k) => (out[k] += x));
    prev = level;
  }
  return out;
}

function outcomes(spot: ShoveSpot, shape: SpotShape): Outcomes {
  const { stacks, hero } = spot;
  const posted = shape.posted;
  const shove = posted.map((p, i) => (i === hero ? stacks[hero] : p));
  const noCall = settle(stacks, shove, [hero], hero);
  const heroFolds = settle(stacks, posted, [shape.bb], shape.bb);
  const heroWins: number[][] = [];
  const callerWins: number[][] = [];
  for (const j of shape.callers) {
    // The caller puts in up to hero's shove (or keeps its post, if that already covers it).
    const contrib = shove.slice();
    contrib[j] = Math.max(posted[j], Math.min(stacks[j], stacks[hero]));
    heroWins.push(settle(stacks, contrib, [hero, j], hero));
    callerWins.push(settle(stacks, contrib, [hero, j], j));
  }
  return { noCall, heroWins, callerWins, heroFolds };
}

/** What a set of final stacks is worth to `seat`: chips, or ICM share of the pool. */
function valuer(payouts: readonly number[]): (finals: readonly number[], seat: number) => number {
  if (payouts.length === 0) return (finals, seat) => finals[seat];
  const cache = new Map<string, number[]>();
  return (finals, seat) => {
    const key = finals.join(',');
    let eq = cache.get(key);
    if (eq === undefined) {
      eq = icmEquities(finals, payouts);
      cache.set(key, eq);
    }
    return eq[seat];
  };
}

/** The values the strategies need, per caller: hero's and the caller's, in each outcome. */
interface Values {
  readonly heroFold: number;
  readonly heroNoCall: number;
  readonly heroWin: readonly number[];
  readonly heroLose: readonly number[];
  readonly callerWin: readonly number[];
  readonly callerLose: readonly number[];
  readonly callerFold: readonly number[];
}

function values(spot: ShoveSpot, shape: SpotShape): Values {
  const o = outcomes(spot, shape);
  const v = valuer(spot.payouts);
  return {
    heroFold: v(o.heroFolds, spot.hero),
    heroNoCall: v(o.noCall, spot.hero),
    heroWin: shape.callers.map((_, k) => v(o.heroWins[k], spot.hero)),
    heroLose: shape.callers.map((_, k) => v(o.callerWins[k], spot.hero)),
    callerWin: shape.callers.map((j, k) => v(o.callerWins[k], j)),
    callerLose: shape.callers.map((j, k) => v(o.heroWins[k], j)),
    callerFold: shape.callers.map((j) => v(o.noCall, j)),
  };
}

const LIVE = 1225; // hands left from 50 cards: what COMPAT row sums average to per held hand

let weights: { w: Float64Array; we: Float64Array } | null = null;

/** COMPAT and COMPAT x equity as doubles, once: the two inner loops below are all multiply-adds over these. */
function pairWeights(): { w: Float64Array; we: Float64Array } {
  if (weights !== null) return weights;
  const t = equityTable();
  const w = Float64Array.from(COMPAT);
  const we = new Float64Array(w.length);
  for (let i = 0; i < w.length; i++) we[i] = w[i] * t[i];
  weights = { w, we };
  return weights;
}

/** Hero's gain from shoving each class over folding, against the callers' ranges. */
function shoveGains(val: Values, calls: readonly Float64Array[]): Float64Array {
  const { w: W, we: WE } = pairWeights();
  const N = CLASS_COUNT;
  const out = new Float64Array(N);
  for (let h = 0; h < N; h++) {
    let reach = 1; // probability everyone so far folded
    let ev = 0;
    const row = h * N;
    for (let k = 0; k < calls.length; k++) {
      const range = calls[k];
      let w = 0;
      let e = 0;
      for (let b = 0; b < N; b++) {
        w += W[row + b] * range[b];
        e += WE[row + b] * range[b];
      }
      const pCall = w / (CLASS_SIZE[h] * LIVE);
      if (w > 0) {
        const eq = e / w;
        ev += reach * pCall * (eq * val.heroWin[k] + (1 - eq) * val.heroLose[k]);
      }
      reach *= 1 - pCall;
    }
    ev += reach * val.heroNoCall;
    out[h] = ev - val.heroFold;
  }
  return out;
}

/** Caller k's gain from calling with each class over folding, against hero's shoving range. */
function callGains(val: Values, k: number, push: Float64Array): Float64Array {
  const { w: W, we: WE } = pairWeights();
  const N = CLASS_COUNT;
  const out = new Float64Array(N);
  for (let b = 0; b < N; b++) {
    let w = 0;
    let e = 0;
    const row = b * N;
    for (let h = 0; h < N; h++) {
      w += W[row + h] * push[h];
      e += WE[row + h] * push[h];
    }
    // Facing no shove range at all there is nothing to call; a caller's EV is then its fold value.
    out[b] = w > 0 ? (e / w) * val.callerWin[k] + (1 - e / w) * val.callerLose[k] - val.callerFold[k] : 0;
  }
  return out;
}

export type CallingRanges = 'equilibrium' | readonly ClassRange[];

export interface ShoveResult {
  /** Per class (ALL_COMBOS order): hero's shove frequency (0 or 1 against fixed ranges). */
  readonly push: Float64Array;
  /** Per class: shove minus fold, in the spot's unit (big blinds, or share of the pool). */
  readonly gain: Float64Array;
  /** Per caller (in acting order): the calling range used. */
  readonly calls: readonly Float64Array[];
  readonly callers: readonly number[];
  readonly pushShare: number;
  readonly callShares: readonly number[];
  /** Equilibrium only: the larger side's best-response gain over its averaged strategy, per hand. */
  readonly exploitability: number | null;
}

export function solveShove(spot: ShoveSpot, ranges: CallingRanges, iterations = 2000): ShoveResult {
  const shape = shapeOf(spot);
  const val = values(spot, shape);
  const m = shape.callers.length;
  if (ranges !== 'equilibrium') {
    if (ranges.length !== m) throw new RangeError(`need ${m} calling ranges`);
    // A forced player calls with everything, whatever range was named for it.
    const calls = ranges.map((r, k) => (shape.forced[k] ? new Float64Array(CLASS_COUNT).fill(1) : Float64Array.from(r)));
    const gain = shoveGains(val, calls);
    const push = gain.map((g) => (g > 0 ? 1 : 0));
    return { push, gain, calls, callers: shape.callers, pushShare: rangeShare(push), callShares: calls.map(rangeShare), exploitability: null };
  }

  const push = new Float64Array(CLASS_COUNT).fill(1);
  const calls = shape.callers.map(() => new Float64Array(CLASS_COUNT).fill(1));
  for (let t = 1; t <= iterations; t++) {
    for (let k = 0; k < m; k++) {
      if (shape.forced[k]) continue; // stays all ones: no decision to learn
      const g = callGains(val, k, push);
      for (let b = 0; b < CLASS_COUNT; b++) calls[k][b] += ((g[b] > 0 ? 1 : 0) - calls[k][b]) / (t + 1);
    }
    const g = shoveGains(val, calls);
    for (let h = 0; h < CLASS_COUNT; h++) push[h] += ((g[h] > 0 ? 1 : 0) - push[h]) / (t + 1);
  }

  const gain = shoveGains(val, calls);
  // Per hand dealt: Σ_class share × (best response − averaged strategy).
  const gap = (g: ArrayLike<number>, f: ArrayLike<number>): number => {
    let s = 0;
    for (let i = 0; i < CLASS_COUNT; i++) s += (CLASS_SIZE[i] / 1326) * (Math.max(0, g[i]) - f[i] * g[i]);
    return s;
  };
  let exploitability = gap(gain, push);
  for (let k = 0; k < m; k++) if (!shape.forced[k]) exploitability = Math.max(exploitability, gap(callGains(val, k, push), calls[k]));
  return { push, gain, calls, callers: shape.callers, pushShare: rangeShare(push), callShares: calls.map(rangeShare), exploitability };
}

/** Caller k's gain from calling with each class against a given shove range (for display). */
export function callGainsFor(spot: ShoveSpot, k: number, push: ArrayLike<number>): Float64Array {
  const shape = shapeOf(spot);
  return callGains(values(spot, shape), k, Float64Array.from(push));
}
