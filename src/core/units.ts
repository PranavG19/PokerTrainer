/**
 * Branded number types, so the three things the app counts can never be mixed up by accident.
 *
 * - **Chips** are the table bankroll (`SessionState.bankroll`). They come from pots and buy nothing.
 * - **Reps** are effort, the XP equivalent. They are never spent.
 * - **Chalk** is the earn-only cosmetic budget.
 *
 * The economy's hard rule is that chips never convert to or from anything. A plain `number` is not
 * assignable to any brand, and one brand is not assignable to another, so `const c: Chalk = bankroll`
 * or `reps(…)` fed a Chips value does not compile (tests/unit/units.test.ts pins this with
 * `@ts-expect-error`). The only way in is the constructor for that unit; there is deliberately no
 * function anywhere that takes Chips and returns Reps or Chalk.
 */

declare const unit: unique symbol;
type Branded<B extends string> = number & { readonly [unit]: B };

export type Chips = Branded<'Chips'>;
export type Reps = Branded<'Reps'>;
export type Chalk = Branded<'Chalk'>;

/** Chips may be any finite amount; a non-finite one is corruption and reads as `fallback`. */
export function chips(value: number, fallback = 0): Chips {
  return (Number.isFinite(value) ? value : fallback) as Chips;
}

/** Reps and Chalk are whole, non-negative counts. Anything else clamps to that, never below 0. */
function count(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function reps(value: number): Reps {
  return count(value) as Reps;
}

export function chalk(value: number): Chalk {
  return count(value) as Chalk;
}
