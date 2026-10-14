/**
 * TEST HOOKS: what an e2e run may change about the app, read by main from the environment. Pure, so the gate is
 * unit-tested rather than trusted.
 *
 *  - `OFFSUIT_NOW`: the test clock. An epoch-ms integer or an ISO date-time; the renderer runs its progression
 *    clock (streak days, the ring, the Ticket, the greeting) at that instant, ticking forward from it. Time travel
 *    is a relaunch with a later value on the same profile.
 *  - `OFFSUIT_E2E_ONBOARDING=1`: show first-run onboarding. Under e2e it is off by default, because every other
 *    spec starts on a fresh profile and drives Home directly; onboarding.spec turns it on.
 *
 * Both are honoured ONLY under e2e (`OFFSUIT_E2E=1`) and never in a packaged build, whatever the environment says.
 */

export interface TestHooks {
  /** Epoch ms the clock starts at, or null for the real clock. */
  readonly now: number | null;
  /** First-run onboarding may open on a fresh profile. */
  readonly onboarding: boolean;
}

export const REAL: TestHooks = { now: null, onboarding: true };

export function parseTestNow(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const v = value.trim();
  const ms = /^\d+$/.test(v) ? Number(v) : /^\d{4}-\d{2}-\d{2}T/.test(v) ? Date.parse(v) : Number.NaN;
  return Number.isSafeInteger(ms) && ms > 0 ? ms : null;
}

export function testHooksFrom(env: Readonly<Record<string, string | undefined>>, packaged: boolean): TestHooks {
  if (packaged || env.OFFSUIT_E2E !== '1') return REAL;
  return { now: parseTestNow(env.OFFSUIT_NOW), onboarding: env.OFFSUIT_E2E_ONBOARDING === '1' };
}
