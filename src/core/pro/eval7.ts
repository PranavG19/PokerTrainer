/**
 * A fast seven-card evaluator over integer cards, for the Pro maths that needs millions of showdowns
 * (the preflop all-in table, range-vs-range equity). It returns EXACTLY the score `evaluate()` in
 * core/evaluate.ts packs, so the two can never disagree about who won: tests/unit/pro-eval7.test.ts
 * compares them on random hands. Allocation-free on the hot path (two module-level scratch arrays).
 *
 * A card is `rank * 4 + suit`, rank 0 (deuce) to 12 (ace), suit in SUITS order (s h d c).
 */

import { RANKS, SUITS, type Card } from '../cards.js';

export function cardIndex(card: Card): number {
  const r = RANKS.indexOf(card[0] as (typeof RANKS)[number]);
  const s = SUITS.indexOf(card[1] as (typeof SUITS)[number]);
  if (r < 0 || s < 0 || card.length !== 2) throw new Error(`not a card: ${card}`);
  return r * 4 + s;
}

export function cardOfIndex(i: number): Card {
  return RANKS[i >> 2] + SUITS[i & 3];
}

const counts = new Uint8Array(13);
const suitMasks = new Uint16Array(4);
const suitCounts = new Uint8Array(4);

/** Highest straight's top rank in a 13-bit rank mask, or -1. The wheel's top is the five (3). */
function straightTop(mask: number): number {
  for (let top = 12; top >= 4; top--) {
    const run = 0x1f << (top - 4);
    if ((mask & run) === run) return top;
  }
  return (mask & 0x100f) === 0x100f ? 3 : -1;
}

/** packScore from evaluate.ts: the category, then five kicker nibbles. */
function pack(category: number, k0 = 0, k1 = 0, k2 = 0, k3 = 0, k4 = 0): number {
  return ((((category * 16 + k0) * 16 + k1) * 16 + k2) * 16 + k3) * 16 + k4;
}

/** The top `n` set ranks of `mask`, high first, written into `out`. */
function topRanks(mask: number, n: number, out: number[]): void {
  out.length = 0;
  for (let r = 12; r >= 0 && out.length < n; r--) if (mask & (1 << r)) out.push(r);
}

const scratch: number[] = [];

/** Score 5 to 7 integer cards, identical to `evaluate(cards).score`. */
export function score(cards: ArrayLike<number>, n = cards.length): number {
  counts.fill(0);
  suitMasks.fill(0);
  suitCounts.fill(0);
  let rankMask = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i];
    const r = c >> 2;
    const s = c & 3;
    counts[r]++;
    suitMasks[s] |= 1 << r;
    suitCounts[s]++;
    rankMask |= 1 << r;
  }

  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (suitCounts[s] >= 5) flushSuit = s;
  if (flushSuit >= 0) {
    const sf = straightTop(suitMasks[flushSuit]);
    if (sf >= 0) return pack(8, sf);
  }

  let quad = -1;
  let t0 = -1;
  let t1 = -1;
  let p0 = -1;
  let p1 = -1;
  for (let r = 12; r >= 0; r--) {
    const k = counts[r];
    if (k === 4) quad = r;
    else if (k === 3) {
      if (t0 < 0) t0 = r;
      else if (t1 < 0) t1 = r;
    } else if (k === 2) {
      if (p0 < 0) p0 = r;
      else if (p1 < 0) p1 = r;
    }
  }

  if (quad >= 0) {
    topRanks(rankMask & ~(1 << quad), 1, scratch);
    return pack(7, quad, scratch[0] ?? 0);
  }
  if (t0 >= 0 && t1 >= 0) return pack(6, t0, t1);
  if (t0 >= 0 && p0 >= 0) return pack(6, t0, p0);

  if (flushSuit >= 0) {
    topRanks(suitMasks[flushSuit], 5, scratch);
    return pack(5, scratch[0], scratch[1], scratch[2], scratch[3], scratch[4]);
  }

  const st = straightTop(rankMask);
  if (st >= 0) return pack(4, st);

  if (t0 >= 0) {
    topRanks(rankMask & ~(1 << t0), 2, scratch);
    return pack(3, t0, scratch[0] ?? 0, scratch[1] ?? 0);
  }
  if (p0 >= 0 && p1 >= 0) {
    topRanks(rankMask & ~(1 << p0) & ~(1 << p1), 1, scratch);
    return pack(2, p0, p1, scratch[0] ?? 0);
  }
  if (p0 >= 0) {
    topRanks(rankMask & ~(1 << p0), 3, scratch);
    return pack(1, p0, scratch[0] ?? 0, scratch[1] ?? 0, scratch[2] ?? 0);
  }
  topRanks(rankMask, 5, scratch);
  return pack(0, scratch[0] ?? 0, scratch[1] ?? 0, scratch[2] ?? 0, scratch[3] ?? 0, scratch[4] ?? 0);
}
