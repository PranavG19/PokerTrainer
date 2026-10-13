/**
 * A clock that cannot be wound back to stretch a licence.
 *
 * The install keeps a high-water mark: the latest time it has trusted (persisted in the profile AND in
 * the settings file, so deleting the profile does not reset it; src/main/licence.ts). Licence time is
 * `max(system clock, high-water mark, the token's issue time)`: a token cannot be issued in the future,
 * so its `iat` is a lower bound on the true time too. Rolling the clock back therefore never extends a
 * licence; it is simply ignored.
 *
 * Tolerance: nothing is ever taken away for a rollback (licence time just stops going backwards), and
 * the learner is told only when the clock is more than ROLLBACK_TOLERANCE behind, so an NTP correction,
 * a time-zone change or a dual-boot clock never shows a warning.
 *
 * A clock that ran far AHEAD by mistake pushes the mark forward and could end a licence early. Installing
 * a newer token (a higher `iat`, which only the server can sign) resets the mark to the token's issue
 * time or the system time, whichever is later (`highWaterAfterInstall`), so a renewal or a restore is
 * always the way out.
 */

export const ROLLBACK_TOLERANCE_SECONDS = 36 * 3600;

/** Seconds; anything past 2200 is not a clock reading worth trusting (nor recording). */
const MAX_SANE = 7_258_118_400;

export function trustedNow(systemNow: number, highWater: number, iat: number | null): number {
  return Math.max(sane(systemNow), sane(highWater), iat ?? 0);
}

export function isClockBehind(systemNow: number, highWater: number, iat: number | null): boolean {
  return sane(systemNow) < Math.max(sane(highWater), iat ?? 0) - ROLLBACK_TOLERANCE_SECONDS;
}

/** The mark after a reading: never lower. */
export function advanceHighWater(highWater: number, systemNow: number): number {
  return Math.max(sane(highWater), sane(systemNow));
}

/**
 * The mark after installing a token. A NEWER token (iat above the stored one's, or the first token)
 * resets it; re-installing the same or an older token cannot, so replaying an old key never undoes a
 * rollback guard.
 */
export function highWaterAfterInstall(
  highWater: number,
  systemNow: number,
  installedIat: number,
  previousIat: number | null,
): number {
  if (previousIat === null || installedIat > previousIat) return Math.max(sane(systemNow), installedIat);
  return advanceHighWater(highWater, systemNow);
}

function sane(t: number): number {
  return Number.isFinite(t) && t > 0 && t <= MAX_SANE ? Math.floor(t) : 0;
}
