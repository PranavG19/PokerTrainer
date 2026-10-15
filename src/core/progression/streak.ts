/**
 * What counts a day for the classic daily streak (owner D5; the arithmetic is persist.ts `countSession`).
 *
 * A counted day is a local day with at least one FINISHED SESSION. In this app a session is finished by any one of:
 *  - Today's Ticket, every item done (D16: a review unit, under 30 minutes);
 *  - an assessment block played to the end;
 *  - a story table played to the end (its planned hands, or a bust);
 *  - SESSION_HANDS hands played at a table on that day (the free table has no end of its own, so a count stands in).
 * Nothing else counts: opening the app, a lesson read, a drill rep. There are no rest days and no freezes.
 *
 * Pure: the caller says what finished and on which day.
 */

import type { DayKey } from '../localDay.js';
import { countSession } from './persist.js';
import type { StreakState } from './types.js';

/** Hands at a table in one local day that make a finished session (about 25 minutes at 2 minutes a hand). */
export const SESSION_HANDS = 12;

export type FinishedSession = 'ticket' | 'assessment' | 'story-table' | 'table-hands';

/** Count `day` if `finished` is one of the sessions above. Idempotent per day (countSession is). */
export function countFinished(streak: StreakState, _finished: FinishedSession, day: DayKey): StreakState {
  return countSession(streak, day);
}

/** True when the hands played on one day make a finished session. */
export function handsMakeASession(handsToday: number): boolean {
  return handsToday >= SESSION_HANDS;
}

/** Hands whose `playedAt` falls on `day`. Hands saved before playedAt was recorded never count. */
export function handsOn(hands: readonly { playedAt?: number }[], day: DayKey, dayKeyOf: (ms: number) => DayKey): number {
  let n = 0;
  for (const h of hands) if (typeof h.playedAt === 'number' && dayKeyOf(h.playedAt) === day) n++;
  return n;
}

/**
 * The line under the streak, never loss-framed (VISION §4): what one finished session would make it, or that today
 * already counts. `current` is the run as read today (currentStreakOn).
 */
export function streakNote(current: number, countedToday: boolean, boundaryHour: number): string {
  if (countedToday) return `Today counts. Days turn over at ${hourLabel(boundaryHour)}.`;
  if (current === 0) return 'Finish one session and your streak starts at 1.';
  return `Finish one session and your streak goes to ${current + 1}.`;
}

/** 4 → "4 am", 0 → "midnight", 12 → "noon", 17 → "5 pm". */
export function hourLabel(hour: number): string {
  if (hour === 0) return 'midnight';
  if (hour === 12) return 'noon';
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
}
