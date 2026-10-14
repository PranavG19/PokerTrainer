/**
 * The 169 starting-hand classes as INDICES (ALL_COMBOS order, so index 0 is AA and 168 is 32o), their
 * concrete two-card hands as integer cards (eval7.ts), and the card-removal weight between two classes.
 * Pure data derived once at load; the preflop equity table and push-fold read everything through here.
 */

import { ALL_COMBOS, comboOf, type Combo } from '../preflop.js';
import { cardOfIndex } from './eval7.js';

export const CLASS_COUNT = 169;

export const CLASS_INDEX: ReadonlyMap<Combo, number> = new Map(ALL_COMBOS.map((c, i) => [c, i]));

export function classIndex(combo: Combo): number {
  const i = CLASS_INDEX.get(combo);
  if (i === undefined) throw new Error(`not a canonical starting hand: ${combo}`);
  return i;
}

/** Every concrete hand of each class, as [low card index, high card index]. Pairs 6, suited 4, offsuit 12. */
export const CLASS_HANDS: readonly (readonly (readonly [number, number])[])[] = (() => {
  const out: [number, number][][] = ALL_COMBOS.map(() => []);
  for (let a = 0; a < 52; a++) {
    for (let b = a + 1; b < 52; b++) {
      out[classIndex(comboOf(cardOfIndex(a), cardOfIndex(b)))].push([a, b]);
    }
  }
  return out;
})();

/** How many concrete hands a class stands for (6, 4 or 12). */
export const CLASS_SIZE: readonly number[] = CLASS_HANDS.map((h) => h.length);

/**
 * COMPAT[a * 169 + b]: the number of (hand of a, hand of b) pairs that share no card. Divided by
 * CLASS_SIZE[a] it is the average number of b's hands still possible once you hold a hand of a: the
 * card-removal weight a range of b carries against a. AA against AKs is 6 * 4 - blocked = 12 pairs, not 24.
 */
export const COMPAT: Uint16Array = (() => {
  const out = new Uint16Array(CLASS_COUNT * CLASS_COUNT);
  for (let a = 0; a < CLASS_COUNT; a++) {
    for (let b = 0; b < CLASS_COUNT; b++) {
      let n = 0;
      for (const [x0, x1] of CLASS_HANDS[a]) {
        for (const [y0, y1] of CLASS_HANDS[b]) {
          if (x0 !== y0 && x0 !== y1 && x1 !== y0 && x1 !== y1) n++;
        }
      }
      out[a * CLASS_COUNT + b] = n;
    }
  }
  return out;
})();

/** Average live hands of class b once a hand of class a is held. */
export function liveWeight(a: number, b: number): number {
  return COMPAT[a * CLASS_COUNT + b] / CLASS_SIZE[a];
}
