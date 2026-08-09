import type { Card } from './cards.js';
import { rankValue, suitOf } from './cards.js';

export enum HandCategory {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}

export const CATEGORY_NAMES: Record<HandCategory, string> = {
  [HandCategory.HighCard]: 'High Card',
  [HandCategory.Pair]: 'Pair',
  [HandCategory.TwoPair]: '2 Pair',
  [HandCategory.Trips]: 'Trips',
  [HandCategory.Straight]: 'Straight',
  [HandCategory.Flush]: 'Flush',
  [HandCategory.FullHouse]: 'Full House',
  [HandCategory.Quads]: 'Quads',
  [HandCategory.StraightFlush]: 'Straight Flush',
};

export interface HandValue {
  category: HandCategory;
  /** Tiebreak ranks, most significant first. Compare lexicographically after category. */
  kickers: number[];
  /** Single sortable integer: category and kickers packed base-16. */
  score: number;
}

function packScore(category: HandCategory, kickers: number[]): number {
  let score = category;
  for (let i = 0; i < 5; i++) score = score * 16 + (kickers[i] ?? 0);
  return score;
}

/** Highest straight's top rank value, or -1. Handles the wheel (A2345 -> top rank 3 i.e. "5"). */
function straightTop(uniqueDesc: number[]): number {
  for (let i = 0; i <= uniqueDesc.length - 5; i++) {
    const top = uniqueDesc[i];
    let ok = true;
    for (let k = 1; k < 5; k++) {
      if (!uniqueDesc.includes(top - k)) {
        ok = false;
        break;
      }
    }
    if (ok) return top;
  }
  // Wheel: A(12) 5(3) 4(2) 3(1) 2(0)
  if ([12, 3, 2, 1, 0].every((v) => uniqueDesc.includes(v))) return 3;
  return -1;
}

/** Evaluate the best 5-card hand from any 5-7 cards. */
export function evaluate(cards: Card[]): HandValue {
  const values = cards.map(rankValue);
  const suits = cards.map(suitOf);

  const countByRank = new Map<number, number>();
  for (const v of values) countByRank.set(v, (countByRank.get(v) ?? 0) + 1);

  const countBySuit = new Map<string, number>();
  for (const s of suits) countBySuit.set(s, (countBySuit.get(s) ?? 0) + 1);

  const flushSuit = [...countBySuit.entries()].find(([, n]) => n >= 5)?.[0];

  if (flushSuit) {
    const flushValues = cards
      .filter((c) => suitOf(c) === flushSuit)
      .map(rankValue)
      .sort((a, b) => b - a);
    const sfTop = straightTop([...new Set(flushValues)].sort((a, b) => b - a));
    if (sfTop >= 0) {
      return { category: HandCategory.StraightFlush, kickers: [sfTop], score: packScore(HandCategory.StraightFlush, [sfTop]) };
    }
  }

  // Group ranks by multiplicity, then by rank — descending on both.
  const groups = [...countByRank.entries()].sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]));
  const uniqueDesc = [...countByRank.keys()].sort((a, b) => b - a);

  const quad = groups.find(([, n]) => n === 4);
  if (quad) {
    const kicker = uniqueDesc.find((v) => v !== quad[0]) ?? 0;
    const k = [quad[0], kicker];
    return { category: HandCategory.Quads, kickers: k, score: packScore(HandCategory.Quads, k) };
  }

  const trips = groups.filter(([, n]) => n === 3).map(([v]) => v);
  const pairs = groups.filter(([, n]) => n === 2).map(([v]) => v);

  if (trips.length >= 2) {
    const k = [trips[0], trips[1]];
    return { category: HandCategory.FullHouse, kickers: k, score: packScore(HandCategory.FullHouse, k) };
  }
  if (trips.length === 1 && pairs.length >= 1) {
    const k = [trips[0], pairs[0]];
    return { category: HandCategory.FullHouse, kickers: k, score: packScore(HandCategory.FullHouse, k) };
  }

  if (flushSuit) {
    const k = cards
      .filter((c) => suitOf(c) === flushSuit)
      .map(rankValue)
      .sort((a, b) => b - a)
      .slice(0, 5);
    return { category: HandCategory.Flush, kickers: k, score: packScore(HandCategory.Flush, k) };
  }

  const sTop = straightTop(uniqueDesc);
  if (sTop >= 0) {
    return { category: HandCategory.Straight, kickers: [sTop], score: packScore(HandCategory.Straight, [sTop]) };
  }

  if (trips.length === 1) {
    const k = [trips[0], ...uniqueDesc.filter((v) => v !== trips[0]).slice(0, 2)];
    return { category: HandCategory.Trips, kickers: k, score: packScore(HandCategory.Trips, k) };
  }
  if (pairs.length >= 2) {
    const [hi, lo] = pairs;
    const kicker = uniqueDesc.find((v) => v !== hi && v !== lo) ?? 0;
    const k = [hi, lo, kicker];
    return { category: HandCategory.TwoPair, kickers: k, score: packScore(HandCategory.TwoPair, k) };
  }
  if (pairs.length === 1) {
    const k = [pairs[0], ...uniqueDesc.filter((v) => v !== pairs[0]).slice(0, 3)];
    return { category: HandCategory.Pair, kickers: k, score: packScore(HandCategory.Pair, k) };
  }

  const k = uniqueDesc.slice(0, 5);
  return { category: HandCategory.HighCard, kickers: k, score: packScore(HandCategory.HighCard, k) };
}

export function compareHands(a: Card[], b: Card[]): number {
  return evaluate(a).score - evaluate(b).score;
}
