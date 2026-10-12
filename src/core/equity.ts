import type { Card } from './cards.js';
import type { Rng } from './rng.js';
import { freshDeck } from './cards.js';
import { mulberry32, shuffle } from './rng.js';
import { evaluate, CATEGORY_NAMES, HandCategory } from './evaluate.js';
import { comboOf, type Combo } from './preflop.js';

export interface EquityResult {
  win: number;
  tie: number;
  lose: number;
  categoryChances: Record<string, number>;
  iterations: number;
}

/** Collapse an equity split to a single number: win share plus half the tie share. */
export function scalarEquity(eq: EquityResult): number {
  return eq.win + eq.tie * 0.5;
}

/**
 * The iteration count for anything the player SEES. Monte Carlo at two different counts returns two
 * different numbers for the same spot, so the coach line and the stats sheet must share this or they
 * contradict each other on screen — measured 56% vs 55% on one turn spot, and 70% vs 66% on another.
 * The AI deliberately uses fewer (see ai.ts): its estimates are never shown.
 */
export const DISPLAY_ITERATIONS = 2000;

/**
 * Monte Carlo equity vs N random opponents.
 * Deterministic given seed (uses mulberry32, never Math.random).
 */
export function equityVsRandom(
  hole: Card[],
  board: Card[],
  opponents: number,
  iterations = 2000,
  seed = 1,
): EquityResult {
  const rng: Rng = mulberry32(seed);

  const dead = new Set<string>(hole.concat(board));
  const deck = freshDeck().filter((c) => !dead.has(c));

  const cardsNeeded = (5 - board.length) + opponents * 2;

  let wins = 0;
  let ties = 0;
  let losses = 0;

  const catCounts: number[] = new Array(9).fill(0);

  for (let i = 0; i < iterations; i++) {
    // Shuffle only the portion we need (partial Fisher-Yates)
    const pool = deck.slice();
    for (let k = 0; k < cardsNeeded && k < pool.length; k++) {
      const j = k + Math.floor(rng() * (pool.length - k));
      const tmp = pool[k];
      pool[k] = pool[j];
      pool[j] = tmp;
    }

    let idx = 0;
    const runout = board.concat(pool.slice(idx, idx + (5 - board.length)));
    idx += 5 - board.length;

    const heroCards = hole.concat(runout);
    const heroVal = evaluate(heroCards);
    catCounts[heroVal.category]++;

    let bestOpp = -1;
    for (let o = 0; o < opponents; o++) {
      const oppHole = [pool[idx], pool[idx + 1]];
      idx += 2;
      const oppVal = evaluate(oppHole.concat(runout));
      if (oppVal.score > bestOpp) bestOpp = oppVal.score;
    }

    if (heroVal.score > bestOpp) {
      wins++;
    } else if (heroVal.score === bestOpp) {
      ties++;
    } else {
      losses++;
    }
  }

  const categoryChances: Record<string, number> = {};
  for (let c = 0; c <= 8; c++) {
    categoryChances[CATEGORY_NAMES[c as HandCategory]] = catCounts[c] / iterations;
  }

  return {
    win: wins / iterations,
    tie: ties / iterations,
    lose: losses / iterations,
    categoryChances,
    iterations,
  };
}

/**
 * Monte Carlo equity vs a WEIGHTED RANGE of opponent hands, heads-up.
 *
 * This is the honest grader's equity source. `equityVsRandom` deals the villain two uniform cards
 * from the deck — a 100% range — which systematically OVERSTATES hero equity in exactly the spots the
 * coach grades, because a villain who bet or raised holds a range strictly stronger than random (see
 * coach.ts and CONSOLIDATED audit #1). Here the villain's two cards are instead drawn from `range`, the
 * canonical combos (e.g. "AKs", "TT", "QJo") the villain is modelled to hold, so hero equity is measured
 * against what the villain can actually have.
 *
 * The draw is combo-frequency-correct WITHOUT weighting bookkeeping: we enumerate every concrete two-card
 * combination consistent with the range and the dead cards, then sample those uniformly. Because a pair
 * expands to 6 concrete combinations, a suited combo to (up to) 4 and an offsuit combo to (up to) 12,
 * uniform sampling over the concrete list already reproduces the 6/4/12 comboWeight weighting that
 * preflop.comboWeight documents — and card removal (a blocked combo simply contributes fewer concrete
 * pairs) falls out for free.
 *
 * Heads-up by construction: the coach grades the price the AGGRESSOR laid, so the relevant range is that
 * one villain's, not a multiway field. Deterministic given seed (mulberry32, never Math.random), same as
 * equityVsRandom, so a grade is reproducible. If the range is empty or fully blocked by the dead cards
 * (no concrete villain hand remains), it falls back to equityVsRandom heads-up — the honest "no better
 * information than random" answer rather than a divide-by-zero.
 */
export function equityVsRange(
  hole: Card[],
  board: Card[],
  range: readonly Combo[],
  iterations = 2000,
  seed = 1,
): EquityResult {
  const rangeSet = new Set<Combo>(range);
  const dead = new Set<string>(hole.concat(board));
  const deck = freshDeck().filter((c) => !dead.has(c));

  // Every concrete two-card villain hand consistent with the range and the dead cards. Uniform sampling
  // over this list is exactly comboWeight-weighted (pairs 6, suited 4, offsuit 12) with card removal baked in.
  const villainHands: [Card, Card][] = [];
  for (let i = 0; i < deck.length - 1; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      if (rangeSet.has(comboOf(deck[i], deck[j]))) villainHands.push([deck[i], deck[j]]);
    }
  }

  // No villain hand survives the dead cards (empty or fully blocked range): random is the honest floor.
  if (villainHands.length === 0) {
    return equityVsRandom(hole, board, 1, iterations, seed);
  }

  const rng: Rng = mulberry32(seed);
  const need = 5 - board.length;

  let wins = 0;
  let ties = 0;
  let losses = 0;
  const catCounts: number[] = new Array(9).fill(0);

  for (let i = 0; i < iterations; i++) {
    const opp = villainHands[Math.floor(rng() * villainHands.length)];
    // Board runout is drawn from the deck minus the villain's two cards; a partial Fisher-Yates over the
    // portion we need, mirroring equityVsRandom.
    const pool = deck.filter((c) => c !== opp[0] && c !== opp[1]);
    for (let k = 0; k < need && k < pool.length; k++) {
      const jj = k + Math.floor(rng() * (pool.length - k));
      const tmp = pool[k];
      pool[k] = pool[jj];
      pool[jj] = tmp;
    }

    const runout = board.concat(pool.slice(0, need));
    const heroVal = evaluate(hole.concat(runout));
    catCounts[heroVal.category]++;
    const oppVal = evaluate([opp[0], opp[1]].concat(runout));

    if (heroVal.score > oppVal.score) wins++;
    else if (heroVal.score === oppVal.score) ties++;
    else losses++;
  }

  const categoryChances: Record<string, number> = {};
  for (let c = 0; c <= 8; c++) {
    categoryChances[CATEGORY_NAMES[c as HandCategory]] = catCounts[c] / iterations;
  }

  return {
    win: wins / iterations,
    tie: ties / iterations,
    lose: losses / iterations,
    categoryChances,
    iterations,
  };
}

/**
 * A villain range with a weight per concrete two-card hand: the shape `villainRanges.ts` builds from an
 * archetype. A weight is a likelihood (how often this hand takes the action faced), not a 0/1 flag, so a
 * hand the archetype bets one time in five counts one fifth as much as a hand it always bets.
 */
export interface WeightedRange {
  readonly hands: readonly (readonly [Card, Card])[];
  readonly weights: ArrayLike<number>;
}

/**
 * Monte Carlo equity vs a WEIGHTED range, heads-up. The weighted sibling of `equityVsRange`: hands that
 * collide with hero's cards or the board are dropped (card removal), the rest are drawn in proportion to
 * their weight, and the runout is dealt from what remains. Deterministic given seed. An empty or fully
 * blocked range falls back to one random opponent, the same honest floor `equityVsRange` uses.
 */
export function equityVsWeightedRange(
  hole: Card[],
  board: Card[],
  range: WeightedRange,
  iterations = 2000,
  seed = 1,
): EquityResult {
  const dead = new Set<string>(hole.concat(board));
  const live: (readonly [Card, Card])[] = [];
  const cumulative: number[] = [];
  let total = 0;
  for (let i = 0; i < range.hands.length; i++) {
    const w = range.weights[i];
    const hand = range.hands[i];
    if (!(w > 0) || dead.has(hand[0]) || dead.has(hand[1])) continue;
    total += w;
    live.push(hand);
    cumulative.push(total);
  }
  if (live.length === 0) return equityVsRandom(hole, board, 1, iterations, seed);

  const deck = freshDeck().filter((c) => !dead.has(c));
  const rng: Rng = mulberry32(seed);
  const need = 5 - board.length;
  let wins = 0;
  let ties = 0;
  let losses = 0;
  const catCounts: number[] = new Array(9).fill(0);

  for (let i = 0; i < iterations; i++) {
    const target = rng() * total;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] > target) hi = mid;
      else lo = mid + 1;
    }
    const opp = live[lo];
    const pool = deck.filter((c) => c !== opp[0] && c !== opp[1]);
    for (let k = 0; k < need && k < pool.length; k++) {
      const jj = k + Math.floor(rng() * (pool.length - k));
      const tmp = pool[k];
      pool[k] = pool[jj];
      pool[jj] = tmp;
    }
    const runout = board.concat(pool.slice(0, need));
    const heroVal = evaluate(hole.concat(runout));
    catCounts[heroVal.category]++;
    const oppVal = evaluate([opp[0], opp[1]].concat(runout));
    if (heroVal.score > oppVal.score) wins++;
    else if (heroVal.score === oppVal.score) ties++;
    else losses++;
  }

  const categoryChances: Record<string, number> = {};
  for (let c = 0; c <= 8; c++) {
    categoryChances[CATEGORY_NAMES[c as HandCategory]] = catCounts[c] / iterations;
  }
  return { win: wins / iterations, tie: ties / iterations, lose: losses / iterations, categoryChances, iterations };
}

/**
 * Exact heads-up equity via full enumeration of remaining board cards.
 * Both hero and opponent hole cards are known.
 */
export function exactEquityHeadsUp(
  hole: Card[],
  board: Card[],
  oppHole: Card[],
): number {
  const dead = new Set<string>([...hole, ...board, ...oppHole]);
  const remaining = freshDeck().filter((c) => !dead.has(c));
  const need = 5 - board.length;

  if (need === 0) {
    const heroScore = evaluate(hole.concat(board)).score;
    const oppScore = evaluate(oppHole.concat(board)).score;
    if (heroScore > oppScore) return 1;
    if (heroScore === oppScore) return 0.5;
    return 0;
  }

  let wins = 0;
  let total = 0;

  if (need === 1) {
    for (let i = 0; i < remaining.length; i++) {
      const fullBoard = board.concat([remaining[i]]);
      const heroScore = evaluate(hole.concat(fullBoard)).score;
      const oppScore = evaluate(oppHole.concat(fullBoard)).score;
      total++;
      if (heroScore > oppScore) wins++;
      else if (heroScore === oppScore) wins += 0.5;
    }
  } else if (need === 2) {
    for (let i = 0; i < remaining.length - 1; i++) {
      for (let j = i + 1; j < remaining.length; j++) {
        const fullBoard = board.concat([remaining[i], remaining[j]]);
        const heroScore = evaluate(hole.concat(fullBoard)).score;
        const oppScore = evaluate(oppHole.concat(fullBoard)).score;
        total++;
        if (heroScore > oppScore) wins++;
        else if (heroScore === oppScore) wins += 0.5;
      }
    }
  } else if (need === 3) {
    for (let i = 0; i < remaining.length - 2; i++) {
      for (let j = i + 1; j < remaining.length - 1; j++) {
        for (let k = j + 1; k < remaining.length; k++) {
          const fullBoard = board.concat([remaining[i], remaining[j], remaining[k]]);
          const heroScore = evaluate(hole.concat(fullBoard)).score;
          const oppScore = evaluate(oppHole.concat(fullBoard)).score;
          total++;
          if (heroScore > oppScore) wins++;
          else if (heroScore === oppScore) wins += 0.5;
        }
      }
    }
  } else if (need === 4) {
    for (let i = 0; i < remaining.length - 3; i++) {
      for (let j = i + 1; j < remaining.length - 2; j++) {
        for (let k = j + 1; k < remaining.length - 1; k++) {
          for (let l = k + 1; l < remaining.length; l++) {
            const fullBoard = board.concat([remaining[i], remaining[j], remaining[k], remaining[l]]);
            const heroScore = evaluate(hole.concat(fullBoard)).score;
            const oppScore = evaluate(oppHole.concat(fullBoard)).score;
            total++;
            if (heroScore > oppScore) wins++;
            else if (heroScore === oppScore) wins += 0.5;
          }
        }
      }
    }
  } else {
    // need === 5 (preflop, no board)
    for (let i = 0; i < remaining.length - 4; i++) {
      for (let j = i + 1; j < remaining.length - 3; j++) {
        for (let k = j + 1; k < remaining.length - 2; k++) {
          for (let l = k + 1; l < remaining.length - 1; l++) {
            for (let m = l + 1; m < remaining.length; m++) {
              const fullBoard = [remaining[i], remaining[j], remaining[k], remaining[l], remaining[m]];
              const heroScore = evaluate(hole.concat(fullBoard)).score;
              const oppScore = evaluate(oppHole.concat(fullBoard)).score;
              total++;
              if (heroScore > oppScore) wins++;
              else if (heroScore === oppScore) wins += 0.5;
            }
          }
        }
      }
    }
  }

  return wins / total;
}
