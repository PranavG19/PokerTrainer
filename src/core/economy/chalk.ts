/**
 * CHALK (2.6, owner D4: build it): the earn-only cosmetic budget (VISION §4).
 *
 * - **Earned only from practice, on one daily curve:** 1 Chalk per Rep for the day's first 150 Reps, ½ per Rep from
 *   150 to 300, then nothing; at most CHALK_DAILY_CAP (225) a day. This curve is the one place Reps meet Chalk, and it
 *   runs one way: nothing turns Chalk back into Reps, and nothing turns chips into either (units.ts; the
 *   `economy.test` source scan allowlists every `chalk(` call site).
 * - **Spent only on Locker items, at fixed published prices** (CHALK_PRICES). There are no sales, discounts, bundles,
 *   timers or random drops, and Chalk is never bought: no path takes money, chips or anything else in.
 * - **Idempotent like Reps:** a day's Chalk is a function of the Reps awarded that day, and the ledger keeps how much
 *   of today's curve is paid, so a save that awards nothing pays nothing, and a replayed award pays once.
 * - **A clock moved backwards earns nothing:** a day before the ledger's day is never paid again.
 *
 * Pure: the caller passes the day.
 */

import type { DayKey } from '../localDay.js';
import { chalk, type Chalk, type Reps } from '../units.js';
import { repsOn } from '../progression/reps.js';
import { CHALK_DAILY_CAP, type ChalkLedger, type CosmeticsState, type RepsState } from '../progression/types.js';

/** Reps a day that pay 1 Chalk each. */
export const FULL_RATE_REPS = 150;
/** Reps a day, counted from zero, past which a Rep pays nothing. Between the two, 2 Reps pay 1 Chalk. */
export const HALF_RATE_REPS = 300;

/** The fixed, published prices. A priced Locker item costs exactly one of these, forever. */
export const CHALK_PRICES = [150, 450, 1000, 2400] as const;
export type ChalkPrice = (typeof CHALK_PRICES)[number];

/**
 * The day's curve: the Chalk that `repsToday` Reps earn in one local day. The one deliberate Reps → Chalk step (a Rep is
 * effort; Chalk is what effort buys in the Locker): monotonic, capped, never 1:1 past the first 150.
 */
export function chalkForDay(repsToday: Reps): Chalk {
  const r: number = Math.max(0, repsToday);
  const full = Math.min(r, FULL_RATE_REPS);
  const half = Math.floor((Math.min(r, HALF_RATE_REPS) - Math.min(r, FULL_RATE_REPS)) / 2);
  return chalk(Math.min(CHALK_DAILY_CAP, full + half));
}

/**
 * Pay today's Chalk: whatever today's curve owes beyond what the ledger already paid today. Returns the same object
 * when nothing is owed (no new Reps today, the cap reached, or a clock moved back before the ledger's day).
 */
export function earnChalk(ledger: ChalkLedger, reps: RepsState, today: DayKey): ChalkLedger {
  if (ledger.day !== null && today < ledger.day) return ledger;
  const paidToday = ledger.day === today ? ledger.earnedToday : 0;
  const owed = chalkForDay(repsOn(reps, today)) - paidToday;
  if (owed <= 0) return ledger;
  return { balance: chalk(ledger.balance + owed), day: today, earnedToday: chalk(paidToday + owed) };
}

/** What today's curve still has to give, for the Locker's "today" line. */
export function chalkLeftToday(ledger: ChalkLedger, today: DayKey): Chalk {
  const paid = ledger.day === today ? ledger.earnedToday : 0;
  return chalk(CHALK_DAILY_CAP - paid);
}

export function isPrice(n: number): n is ChalkPrice {
  return (CHALK_PRICES as readonly number[]).includes(n);
}

/**
 * Spend Chalk on an item: the balance must cover the fixed price, and the item must not be owned already. The receipt
 * records the Chalk spent. Refused (the same object back) otherwise. Nothing else changes: no chips, no Reps.
 */
export function spend(state: CosmeticsState, itemId: string, price: ChalkPrice, name: string, today: DayKey): CosmeticsState {
  if (!isPrice(price) || state.owned.includes(itemId) || state.chalk.balance < price) return state;
  return {
    ...state,
    owned: [...state.owned, itemId],
    receipts: [...state.receipts, { itemId, day: today, fact: `${name}, for ${price.toLocaleString('en-US')} Chalk`, chalk: chalk(price) }],
    chalk: { ...state.chalk, balance: chalk(state.chalk.balance - price) },
  };
}
