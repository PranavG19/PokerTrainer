/**
 * The learner's week: seven local days, Monday to Sunday, on the same 4 am day line as everything else
 * (localDay.ts). The Style trail and Dee's letters bucket by it, so "this week" means the same thing on both pages.
 *
 * DayKey 0 is Thursday 1 January 1970, so a day's offset from its Monday is (day + 3) mod 7.
 */

import type { DayKey } from './localDay.js';

/** The Monday that starts the week holding `day`. */
export function weekOf(day: DayKey): DayKey {
  return (day - ((((day + 3) % 7) + 7) % 7)) as DayKey;
}

/** The Sunday that ends the week starting `week`. */
export function weekEnd(week: DayKey): DayKey {
  return (week + 6) as DayKey;
}

/** True when `day` falls in the week starting `week`. */
export function inWeek(day: DayKey, week: DayKey): boolean {
  return day >= week && day <= week + 6;
}
