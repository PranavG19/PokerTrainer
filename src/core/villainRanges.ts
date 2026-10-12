/**
 * VILLAIN RANGES BY ARCHETYPE, STREET AND BET SIZE — the grader's opponent model.
 *
 * Replaces the single `VILLAIN_BETTING_RANGE` (one position-free "has-a-hand" range used for every
 * street and every opponent). That range contradicted the app's own exploit text: a maniac's river bet
 * was graded as if it came from a value-heavy continuing range, so "call down light" was charged as a
 * pot-odds mistake.
 *
 * THE MODEL IS THE ARCHETYPE'S OWN PARAMETERS, READ AS A RANGE. Every opponent in the app is an
 * archetype profile (archetypes.ts; ai.ts carries three of the same shape), and each profile already
 * states how strong a hand must be to bet for value (`raiseStrength`), how often it then bets
 * (`raiseFreq`) and how often it bets without one (`bluffBetFreq`, or `bluffRaiseFreq` over a bet).
 * Strength is a hand's pot share against one random hand on the current board. So the probability that
 * a given hand made the bet hero faces is
 *
 *   P(bet | hand) = raiseFreq * v(hand) + bluffFreq * (1 - v(hand)),   v = smooth step of strength
 *                   around the value line,
 *
 * and the range is every hand weighted by that likelihood. One source of truth: the bot's play, the
 * exploit text and the grader read the same numbers, so they cannot drift apart.
 *
 *  - STREET. Strength is measured on the board as it stands, so the range re-forms every street: a river
 *    value range is made hands, and a bluff-heavy archetype's river range is polarised (top hands plus
 *    uniform air). Postflop, each hand is also weighted by the chance it continued preflop
 *    (`preflopContinue`), so a river range is narrower than a flop one for a selective archetype.
 *    Earlier postflop streets are not replayed: a one-street memory, stated rather than hidden.
 *  - BET SIZE. A bet larger than the archetype's usual size raises the value line and a smaller one
 *    lowers it, by SIZE_SHIFT per doubling (capped at one doubling). At the archetype's own size the
 *    shift is zero, so the bots, which always use their own size, are modelled exactly.
 *  - THE CROWD. As the bots do, the value line rises 0.03 per extra live opponent.
 *
 * DETERMINISTIC. Strength tables are averaged over a fixed set of runouts drawn from a seed derived from
 * the board itself, so the same board always gives the same range, and nothing reads Math.random.
 *
 * WHAT THIS IS NOT. It is not a solve and not a read of a human: it is the range a known archetype plays
 * by its own rule. The coach never names the archetype in a verdict (the label stays hidden in-hand,
 * archetypes.ts O3), and the copy calls it "this range".
 */
import type { Card } from './cards.js';
import { freshDeck } from './cards.js';
import { evaluate } from './evaluate.js';
import type { WeightedRange } from './equity.js';
import { mulberry32 } from './rng.js';
import { comboOf } from './preflop.js';
import { PREFLOP_STRENGTH } from './preflopStrength.js';

/** The fields of an archetype profile the range reads. Both archetypes.ts and ai.ts profiles satisfy it. */
export interface VillainModel {
  readonly callStrength: number;
  readonly raiseStrength: number;
  readonly raiseFreq: number;
  readonly bluffBetFreq: number;
  readonly bluffRaiseFreq: number;
  readonly loosecallFreq: number;
  readonly betPotFraction: number;
}

/**
 * Width of the smooth step around a strength line. The bots read strength from a 300-iteration Monte
 * Carlo (about ±3 points of noise), so a hand 1 point under the line still bets for value some of the
 * time. A logistic of this scale reproduces that blur instead of pretending the line is sharp.
 */
export const STEP_WIDTH = 0.03;

/** Value-line shift per doubling of bet size relative to the archetype's own size. */
export const SIZE_SHIFT = 0.1;

/** Value-line rise per extra live opponent, matching ai.ts / archetypes.ts `crowdTax`. */
export const CROWD_TAX = 0.03;

/** Runouts averaged per strength table before the river. More is steadier and slower (see BENCHMARKS.md). */
export const STRENGTH_RUNOUTS = 16;

const step = (x: number, line: number): number => 1 / (1 + Math.exp(-(x - line) / STEP_WIDTH));

// ── Strength tables ─────────────────────────────────────────────────────────

export interface StrengthTable {
  readonly hands: readonly (readonly [Card, Card])[];
  /** Pot share of each hand against one random hand on this board, averaged over the runouts. */
  readonly strength: Float64Array;
}

function boardSeed(board: readonly Card[]): number {
  let x = 0x811c9dc5;
  for (const c of board.join('')) x = Math.imul(x ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return x >>> 0;
}

/** Every distinct full board this table averages over: exact on the river, a seeded sample before it. */
function runoutsFor(board: readonly Card[], deck: readonly Card[]): Card[][] {
  const need = 5 - board.length;
  if (need === 0) return [board.slice()];
  const rng = mulberry32(boardSeed(board));
  const out: Card[][] = [];
  const seen = new Set<string>();
  // Distinct runouts only: a repeated runout is weight on one board, not information.
  for (let tries = 0; out.length < STRENGTH_RUNOUTS && tries < STRENGTH_RUNOUTS * 4; tries++) {
    const pool = deck.slice();
    for (let k = 0; k < need; k++) {
      const j = k + Math.floor(rng() * (pool.length - k));
      const tmp = pool[k];
      pool[k] = pool[j];
      pool[j] = tmp;
    }
    const tail = pool.slice(0, need).sort();
    const key = tail.join('');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(board.concat(tail));
  }
  return out;
}

function computeStrengthTable(board: readonly Card[]): StrengthTable {
  const dead = new Set(board);
  const deck = freshDeck().filter((c) => !dead.has(c));
  const hands: [Card, Card][] = [];
  for (let i = 0; i < deck.length - 1; i++) for (let j = i + 1; j < deck.length; j++) hands.push([deck[i], deck[j]]);

  // Preflop strength depends only on the starting hand, so it is read from the generated 169-hand table
  // (100k iterations each) rather than estimated from a couple of dozen boards, which is far too noisy
  // when one board decides whether a pair is good.
  if (board.length === 0) {
    return { hands, strength: Float64Array.from(hands, ([a, b]) => PREFLOP_STRENGTH[comboOf(a, b)]) };
  }

  const sum = new Float64Array(hands.length);
  const count = new Float64Array(hands.length);
  const scores = new Float64Array(hands.length);
  for (const full of runoutsFor(board, deck)) {
    const onBoard = new Set(full);
    const live: number[] = [];
    for (let h = 0; h < hands.length; h++) {
      const [a, b] = hands[h];
      if (onBoard.has(a) || onBoard.has(b)) continue;
      scores[h] = evaluate([a, b, ...full]).score;
      live.push(h);
    }
    // Pot share vs one random live hand = (hands beaten + half the ties) / (other hands). Card removal
    // between the two hands is ignored: it moves a strength by well under the step width.
    const sorted = live.map((h) => scores[h]).sort((x, y) => x - y);
    const n = sorted.length;
    for (const h of live) {
      const s = scores[h];
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < s) lo = mid + 1;
        else hi = mid;
      }
      const below = lo;
      let upper = lo;
      while (upper < n && sorted[upper] === s) upper++;
      const equal = upper - below - 1; // excluding the hand itself
      sum[h] += (below + 0.5 * equal) / (n - 1);
      count[h] += 1;
    }
  }
  const strength = new Float64Array(hands.length);
  for (let h = 0; h < hands.length; h++) strength[h] = count[h] > 0 ? sum[h] / count[h] : 0.5;
  return { hands, strength };
}

const CACHE_LIMIT = 8;
const cache = new Map<string, StrengthTable>();

/** The strength table for a board, cached by board (a hand needs at most four: preflop to river). */
export function strengthTable(board: readonly Card[]): StrengthTable {
  const key = board.join('');
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const table = computeStrengthTable(board);
  cache.set(key, table);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return table;
}

// ── Ranges ──────────────────────────────────────────────────────────────────

/** P(an archetype bets or raises | its strength). */
export function aggressionLikelihood(
  model: VillainModel,
  strength: number,
  facing: 'bet' | 'raise',
  valueLine: number,
): number {
  const v = step(strength, valueLine);
  const bluff = facing === 'raise' ? model.bluffRaiseFreq : model.bluffBetFreq;
  return model.raiseFreq * v + bluff * (1 - v);
}

/**
 * P(an archetype put money in voluntarily preflop | its preflop strength): it raised, or it did not and
 * called. Facing the big blind, so the raise branch bluffs at `bluffRaiseFreq`, exactly as the bots do.
 */
export function preflopContinue(model: VillainModel, preflopStrength: number): number {
  const raise = aggressionLikelihood(model, preflopStrength, 'raise', model.raiseStrength);
  const c = step(preflopStrength, model.callStrength);
  const call = c + model.loosecallFreq * (1 - c);
  return raise + (1 - raise) * call;
}

export interface RangeQuery {
  readonly model: VillainModel;
  readonly board: readonly Card[];
  /** Whether the villain's aggression was a bet into no bet, or a raise over one. */
  readonly facing: 'bet' | 'raise';
  /** The villain's bet as a fraction of the pot before it. Omit for the archetype's own size. */
  readonly potFraction?: number;
  /** Live players including the villain. The value line rises with each beyond two. */
  readonly livePlayers?: number;
}

/** The value line after the crowd and the bet size, in strength units. */
export function valueLine(q: RangeQuery): number {
  const crowd = CROWD_TAX * Math.max(0, (q.livePlayers ?? 2) - 2);
  let size = 0;
  if (q.potFraction !== undefined && q.potFraction > 0 && q.model.betPotFraction > 0) {
    const doublings = Math.log2(q.potFraction / q.model.betPotFraction);
    size = SIZE_SHIFT * Math.max(-1, Math.min(1, doublings));
  }
  return q.model.raiseStrength + crowd + size;
}

/** The weighted range an archetype holds when it makes the bet or raise hero faces. */
export function villainRange(q: RangeQuery): WeightedRange {
  const table = strengthTable(q.board);
  const line = valueLine(q);
  const preflop = q.board.length > 0 ? strengthTable([]) : null;
  const preIndex = preflop ? handIndex(preflop) : null;
  const weights = new Float64Array(table.hands.length);
  for (let h = 0; h < table.hands.length; h++) {
    let w = aggressionLikelihood(q.model, table.strength[h], q.facing, line);
    if (preflop && preIndex) {
      const [a, b] = table.hands[h];
      w *= preflopContinue(q.model, preflop.strength[preIndex.get(a + b)!]);
    }
    weights[h] = w;
  }
  return { hands: table.hands, weights };
}

const indexCache = new WeakMap<StrengthTable, Map<string, number>>();
function handIndex(table: StrengthTable): Map<string, number> {
  let idx = indexCache.get(table);
  if (!idx) {
    idx = new Map();
    for (let h = 0; h < table.hands.length; h++) {
      const [a, b] = table.hands[h];
      idx.set(a + b, h);
      idx.set(b + a, h);
    }
    indexCache.set(table, idx);
  }
  return idx;
}

/** Weight-share of the range: sum of weights over the number of hands. 1 is "bets everything". */
export function rangeShare(range: WeightedRange): number {
  let total = 0;
  for (let i = 0; i < range.weights.length; i++) total += range.weights[i];
  return range.weights.length === 0 ? 0 : total / range.weights.length;
}
