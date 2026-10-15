/**
 * The renderer's clock, and the e2e test clock (`OFFSUIT_NOW`, core/testHooks.ts).
 *
 * Under e2e, main may hand over a test instant. The renderer then runs `Date.now()` from that instant, ticking
 * forward in real time, so EVERY timestamp the app writes (a hand's playedAt, a drill rep, a rule sentence, an
 * assessment) and every day the habit loop reads (the streak, the ring, the Ticket, the greeting) agree on one
 * clock. Shifting only the habit loop's reads would put today's hands on another day. Main answers `null` outside
 * e2e and in every packaged build, so a real run never touches `Date.now`.
 */

let offsetMs = 0;

/** Set once at boot from main's test hooks, before anything is rendered. `null` keeps the real clock. */
export function startClockAt(testNow: number | null): void {
  if (testNow === null || offsetMs !== 0) return;
  const real = Date.now.bind(Date);
  offsetMs = testNow - real();
  Date.now = () => real() + offsetMs;
}

export function now(): number {
  return Date.now();
}

/** The local hour at `now()` (0–23), for the greeting. */
export function localHour(): number {
  return new Date(now()).getHours();
}
