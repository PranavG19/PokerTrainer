/**
 * A clock that cannot be wound back to stretch a licence.
 *
 * The install keeps a high-water mark: the latest time it has trusted (persisted in the profile AND in
 * the settings file, so deleting the profile does not reset it; src/main/licence.ts). Licence time is
 * `max(system clock, high-water mark, the token's issue time)`: a token cannot be issued in the future,
 * so its `iat` is a lower bound on the true time too. Rolling the clock back therefore never revives an
 * ended licence and never winds licence time back.
 *
 * Tolerance: nothing is ever taken away for a rollback (licence time just stops going backwards), and
 * the learner is told only when the clock is more than ROLLBACK_TOLERANCE behind, so an NTP correction,
 * a time-zone change or a dual-boot clock never shows a warning.
 *
 * While the clock stays behind, main still advances the mark by the time Offsuit runs (a monotonic clock,
 * src/main/licence.ts), so licence time keeps ticking at the app's own pace.
 *
 * A clock that ran far AHEAD by mistake pushes the mark forward and could end a licence early. Pasting a
 * key never lowers the mark (any key, however old, could be pasted with the clock set back). Only the
 * licence server's own time, in its reply to Check for renewal or Restore, corrects it
 * (`LicenceAuthority.correctClock`), so those buttons are always the way out.
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

function sane(t: number): number {
  return Number.isFinite(t) && t > 0 && t <= MAX_SANE ? Math.floor(t) : 0;
}
