/**
 * Seals: one per mastered concept, derived live from the schedule gate (schedule.ts `gate() === 'mastered'`).
 *
 * The live set is what the gate says now. The persisted `seals.earned` is only the receipt: the day each Seal was
 * first earned. It is a ratchet: a concept that decays out of mastery keeps its receipt (the day it was earned is a
 * fact), but it does not count as a live Seal until the gate says mastered again. Pure.
 */

import type { DayKey } from '../localDay.js';
import type { SealsState } from './types.js';

/** Add a receipt for every mastered concept that has none. Returns the same object when nothing is new. */
export function syncSeals(seals: SealsState, masteredIds: readonly string[], day: DayKey): SealsState {
  const fresh = masteredIds.filter((id) => !Object.prototype.hasOwnProperty.call(seals.earned, id) && id !== '__proto__');
  if (fresh.length === 0) return seals;
  const earned = { ...seals.earned };
  for (const id of fresh) earned[id] = { day };
  return { earned };
}

export interface SealView {
  readonly conceptId: string;
  /** The gate says mastered right now. */
  readonly live: boolean;
  /** The day it was first earned (the receipt), or null for one mastered but not yet synced. */
  readonly earnedOn: DayKey | null;
}

/** Every concept with a Seal, live or once earned, live first, then by the day earned. */
export function sealViews(seals: SealsState, masteredIds: readonly string[]): SealView[] {
  const live = new Set(masteredIds);
  const ids = new Set([...masteredIds, ...Object.keys(seals.earned)]);
  return [...ids]
    .map((conceptId) => ({ conceptId, live: live.has(conceptId), earnedOn: seals.earned[conceptId]?.day ?? null }))
    .sort((a, b) => Number(b.live) - Number(a.live) || (a.earnedOn ?? 0) - (b.earnedOn ?? 0) || a.conceptId.localeCompare(b.conceptId));
}
