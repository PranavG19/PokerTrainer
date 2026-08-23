/**
 * PREFLOP RANGE MODEL — BACKLOG #6.
 *
 * The pure data layer behind the range editor/trainer screen: a NAMED SET of canonical starting-hand
 * combos, plus the paint/clear/membership/serialise queries the UI and the drill are built on. Like
 * charts.ts it adds NO poker knowledge of its own — every combo it recognises, weighs or orders comes
 * out of core/preflop.ts (`ALL_COMBOS`, `isCombo`, `comboWeight`, `TOTAL_COMBINATIONS`), so the editor
 * and the 13x13 chart grid can never disagree about what the 169 cells are or how wide a range is.
 *
 * Everything here is pure and total. A SavedRange is immutable: paint/clear/toggle return a NEW range
 * rather than mutating, so the reducer discipline in session.ts holds all the way down, and the combo
 * list is kept in the canonical ALL_COMBOS order so a serialise round trip is byte-stable regardless of
 * the order cells were painted in.
 */

import { ALL_COMBOS, TOTAL_COMBINATIONS, comboWeight, isCombo, type Combo } from './preflop.js';

/** A named 13x13 selection. `combos` is always canonical, deduped and in ALL_COMBOS order. */
export interface SavedRange {
  readonly name: string;
  readonly combos: readonly Combo[];
}

/** Bound the persisted library so the on-disk JSON cannot grow without limit (mirrors MAX_HAND_LOG). */
export const MAX_SAVED_RANGES = 100;

/** The learner's answer in the drill: is the shown hand IN the range, or OUT of it. */
export type DrillAnswer = 'in' | 'out';

/** One graded drill spot. `inRange` is the truth; `correct` is whether the learner's answer matched it. */
export interface DrillVerdict {
  readonly combo: Combo;
  readonly inRange: boolean;
  readonly answer: DrillAnswer;
  readonly correct: boolean;
}

/** Canonical position of every combo, so a painted set sorts back into the published grid order. */
const COMBO_ORDER: ReadonlyMap<Combo, number> = new Map(ALL_COMBOS.map((combo, i) => [combo, i]));

/** Sort a bag of combos into canonical (ALL_COMBOS) order. Combos are pre-validated by the callers. */
function canonical(combos: Iterable<Combo>): Combo[] {
  return [...new Set(combos)].sort((a, b) => (COMBO_ORDER.get(a) ?? 0) - (COMBO_ORDER.get(b) ?? 0));
}

/** A fresh empty range under `name` (trimmed). The starting point every new painted range grows from. */
export function emptyRange(name: string): SavedRange {
  return { name: name.trim(), combos: [] };
}

/** Whether `combo` is in the range — the drill's oracle and the grid's per-cell selected state. */
export function hasCombo(range: SavedRange, combo: Combo): boolean {
  return range.combos.includes(combo);
}

/**
 * Add one combo. Idempotent (already-present → the same range unchanged) and total: a non-canonical
 * string is rejected here rather than silently stored, so a range can only ever hold real combos.
 */
export function paintCombo(range: SavedRange, combo: Combo): SavedRange {
  if (!isCombo(combo)) throw new Error(`not a canonical starting hand: ${combo}`);
  if (range.combos.includes(combo)) return range;
  return { name: range.name, combos: canonical([...range.combos, combo]) };
}

/** Remove one combo. Idempotent (absent → the same range unchanged). */
export function clearCombo(range: SavedRange, combo: Combo): SavedRange {
  if (!range.combos.includes(combo)) return range;
  return { name: range.name, combos: range.combos.filter((c) => c !== combo) };
}

/** Paint if absent, clear if present — the single-click grid gesture. */
export function toggleCombo(range: SavedRange, combo: Combo): SavedRange {
  return range.combos.includes(combo) ? clearCombo(range, combo) : paintCombo(range, combo);
}

/** Drop every combo, keeping the name — the "Clear" control. */
export function clearAll(range: SavedRange): SavedRange {
  return range.combos.length === 0 ? range : { name: range.name, combos: [] };
}

/** How many of the 1326 dealt combinations the range covers (pairs 6, suited 4, offsuit 12). */
export function rangeWeight(range: SavedRange): number {
  return range.combos.reduce((sum, combo) => sum + comboWeight(combo), 0);
}

/** Combo-weighted share of all hands — the "18%" a chart prints. Reuses preflop's weighting, verbatim. */
export function rangeWidth(range: SavedRange): number {
  return rangeWeight(range) / TOTAL_COMBINATIONS;
}

/**
 * Grade one drill spot: the learner is shown `combo` and answers whether it is in `range`. Correct when
 * the answer matches real membership. No poker knowledge — it is a set-membership check against a range
 * the learner themselves painted, which is exactly the recall the drill trains.
 */
export function scoreDrill(range: SavedRange, combo: Combo, answer: DrillAnswer): DrillVerdict {
  const inRange = hasCombo(range, combo);
  return { combo, inRange, answer, correct: (answer === 'in') === inRange };
}

/** The persisted shape: a plain object safe for JSON, combos as a bare string array in canonical order. */
export function serializeRange(range: SavedRange): { name: string; combos: string[] } {
  return { name: range.name, combos: [...range.combos] };
}

/**
 * Tolerant by design, matching every session parser: the save file is on disk across app versions, so a
 * stale or truncated entry degrades rather than bricks. The name is trimmed to a string; combos keep only
 * real canonical combos (a stray non-combo string is dropped, never stored), deduped and re-sorted into
 * canonical order. So `deserializeRange(serializeRange(r))` is an exact round trip for any real range, and
 * garbage in yields a clean, canonical range out.
 */
export function deserializeRange(raw: unknown): SavedRange {
  const obj = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  const rawCombos = Array.isArray(obj.combos) ? obj.combos : [];
  const combos = canonical(rawCombos.filter((c): c is Combo => typeof c === 'string' && isCombo(c)));
  return { name, combos };
}
