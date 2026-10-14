/**
 * The renderer's progression clock. Under e2e, main may hand over a test instant (`OFFSUIT_NOW`, core/testHooks.ts):
 * the clock then starts there and ticks forward in real time, so a spec can stand on any local day and hour.
 * Otherwise it is `Date.now()`. Everything the habit loop dates (the streak day, the ring, the Ticket, the greeting,
 * Reps award days) reads `now()` from here, never `Date.now()` directly.
 */

let offsetMs = 0;

/** Set once at boot from main's test hooks. `null` keeps the real clock. */
export function startClockAt(testNow: number | null): void {
  offsetMs = testNow === null ? 0 : testNow - Date.now();
}

export function now(): number {
  return Date.now() + offsetMs;
}

/** The local hour at `now()` (0–23), for the greeting. */
export function localHour(): number {
  return new Date(now()).getHours();
}
