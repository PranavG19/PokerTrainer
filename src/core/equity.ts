import type { Card } from './cards.js';
import type { Rng } from './rng.js';
import { freshDeck } from './cards.js';
import { mulberry32, shuffle } from './rng.js';
import { evaluate, CATEGORY_NAMES, HandCategory } from './evaluate.js';

export interface EquityResult {
  win: number;
  tie: number;
  lose: number;
  categoryChances: Record<string, number>;
  iterations: number;
}

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
    let tiedWithHero = false;
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
      tiedWithHero = true;
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
