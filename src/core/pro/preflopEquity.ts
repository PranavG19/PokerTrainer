/**
 * Preflop all-in equity between starting-hand classes and ranges, read from the generated table
 * (scripts/gen-preflop-equity.ts → preflopEquity.data.ts). A RANGE here is 169 weights in [0, 1], one per
 * class in ALL_COMBOS order: how often that class takes the action. Card removal is exact at the class
 * level: a range's classes count by how many of their hands are still live against the hand held.
 */

import { ALL_COMBOS, type Combo } from '../preflop.js';
import { CLASS_COUNT, CLASS_SIZE, COMPAT, classIndex } from './handClasses.js';
import { decodeTable } from './preflopEquityCodec.js';
import { PREFLOP_EQUITY_DATA } from './preflopEquity.data.js';

export type ClassRange = Float64Array;

let table: Float64Array | null = null;

/** The full 169x169 table, E[a * 169 + b] = equity of a against b. Decoded on first use. */
export function equityTable(): Float64Array {
  if (table !== null) return table;
  const upper = decodeTable(PREFLOP_EQUITY_DATA);
  if (upper.length !== (CLASS_COUNT * (CLASS_COUNT - 1)) / 2) throw new Error('preflop equity table size');
  const t = new Float64Array(CLASS_COUNT * CLASS_COUNT);
  let k = 0;
  for (let a = 0; a < CLASS_COUNT; a++) {
    t[a * CLASS_COUNT + a] = 0.5;
    for (let b = a + 1; b < CLASS_COUNT; b++) {
      const e = upper[k++] / 10000;
      t[a * CLASS_COUNT + b] = e;
      t[b * CLASS_COUNT + a] = 1 - e;
    }
  }
  table = t;
  return t;
}

/** Equity of one class against another, all in preflop. */
export function classEquity(a: Combo, b: Combo): number {
  return equityTable()[classIndex(a) * CLASS_COUNT + classIndex(b)];
}

/**
 * Equity of class `a` against `range`, and the live weight of that range against `a` (the number of
 * concrete hands, weighted, it still holds). Equity is null when nothing in the range is live.
 */
export function handVsRange(a: number, range: ArrayLike<number>): { equity: number | null; live: number } {
  const t = equityTable();
  let w = 0;
  let e = 0;
  for (let b = 0; b < CLASS_COUNT; b++) {
    const r = range[b];
    if (!(r > 0)) continue;
    const x = COMPAT[a * CLASS_COUNT + b] * r;
    w += x;
    e += x * t[a * CLASS_COUNT + b];
  }
  return { equity: w > 0 ? e / w : null, live: w };
}

/** Equity of range `a` against range `b`, every live pair of hands weighted equally. Null if none. */
export function rangeVsRange(a: ArrayLike<number>, b: ArrayLike<number>): number | null {
  const t = equityTable();
  let w = 0;
  let e = 0;
  for (let i = 0; i < CLASS_COUNT; i++) {
    if (!(a[i] > 0)) continue;
    for (let j = 0; j < CLASS_COUNT; j++) {
      if (!(b[j] > 0)) continue;
      const x = COMPAT[i * CLASS_COUNT + j] * a[i] * b[j];
      w += x;
      e += x * t[i * CLASS_COUNT + j];
    }
  }
  return w > 0 ? e / w : null;
}

/** Every class's equity against a random hand (the 100% range): the order "top N%" ranges are cut from. */
export function equityVsAny(): readonly number[] {
  const all = new Float64Array(CLASS_COUNT).fill(1);
  return ALL_COMBOS.map((_, i) => handVsRange(i, all).equity ?? 0.5);
}

let strengthOrder: number[] | null = null;

/** Class indices strongest first by equity against a random hand; ties broken by ALL_COMBOS order. */
export function strengthOrdering(): readonly number[] {
  if (strengthOrder !== null) return strengthOrder;
  const eq = equityVsAny();
  strengthOrder = ALL_COMBOS.map((_, i) => i).sort((x, y) => eq[y] - eq[x] || x - y);
  return strengthOrder;
}

/**
 * The top `share` of all 1326 hands by that ordering, as a 0/1 class range (the class that crosses the
 * line is included in part, so 15% is 15% of hands, not "the classes up to 15%").
 */
export function topRange(share: number): ClassRange {
  const out = new Float64Array(CLASS_COUNT);
  let left = Math.max(0, Math.min(1, share)) * 1326;
  for (const i of strengthOrdering()) {
    if (left <= 0) break;
    const size = CLASS_SIZE[i];
    out[i] = Math.min(1, left / size);
    left -= size;
  }
  return out;
}

/** The share of all 1326 hands a class range holds. */
export function rangeShare(range: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < CLASS_COUNT; i++) n += (range[i] > 0 ? range[i] : 0) * CLASS_SIZE[i];
  return n / 1326;
}
