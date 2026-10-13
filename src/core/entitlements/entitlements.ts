/**
 * What this install may use, worked out from a verified licence, a trusted clock and (outside a packaged
 * build only) a developer override. Pure: no clock, no fs, no crypto. Main calls `resolveEntitlements`
 * with a token it verified itself (src/main/licence.ts); the renderer only ever receives the snapshot.
 *
 * States:
 * - free     no licence. The whole trainer.
 * - active   a valid licence inside its paid period (or a perpetual one).
 * - grace    the paid period ended less than OFFLINE_GRACE_DAYS ago. Pro still works, because a renewal
 *            that Offsuit has not been able to fetch yet (offline, or not checked) is the likely case.
 * - expired  past the grace. Back to Free; nothing learned or earned changes.
 * - invalid  a token is stored but does not verify (forged, a dev key in a packaged build, revoked).
 * - dev      the developer override, never honoured in a packaged build (devOverrideFrom).
 */

import { trustedNow, isClockBehind } from './clock.js';
import { featuresOf, FEATURE_INFO, isTier, type Feature, type Tier } from './features.js';
import type { VerifyResult } from './token.js';

export const OFFLINE_GRACE_DAYS = 14;
export const OFFLINE_GRACE_SECONDS = OFFLINE_GRACE_DAYS * 86_400;

export type EntitlementState = 'free' | 'active' | 'grace' | 'expired' | 'invalid' | 'dev';

/** The serialisable answer main hands the renderer. Display data only: no token, no key. */
export interface EntitlementSnapshot {
  readonly tier: Tier;
  readonly state: EntitlementState;
  readonly features: readonly Feature[];
  /** Display: 'monthly' | 'annual' | 'perpetual' | a newer plan name; null without a licence. */
  readonly plan: string | null;
  /** The last 6 characters of the licence id, for support ("ending in …"); never the whole token. */
  readonly licenceHint: string | null;
  /** Unix seconds: paid through, and when Pro stops if no renewal arrives. Null for perpetual / none. */
  readonly paidThrough: number | null;
  readonly graceEndsAt: number | null;
  readonly seats: number | null;
  /** The system clock is well behind the latest time Offsuit has seen; licence time counts from that. */
  readonly clockBehind: boolean;
  /** Why a stored token was refused, when state is 'invalid'. */
  readonly invalidReason: string | null;
}

export interface ResolveInput {
  /** The stored token's verification result (main ran verifyToken), or null when nothing is stored. */
  readonly verified: VerifyResult | null;
  /** System time, unix seconds. */
  readonly now: number;
  /** The latest time this install has trusted (clock.ts). 0 = never. */
  readonly highWater: number;
  /** From devOverrideFrom; always null in a packaged build. */
  readonly devOverride: Tier | null;
}

const FREE: EntitlementSnapshot = {
  tier: 'free',
  state: 'free',
  features: featuresOf('free'),
  plan: null,
  licenceHint: null,
  paidThrough: null,
  graceEndsAt: null,
  seats: null,
  clockBehind: false,
  invalidReason: null,
};

export function freeSnapshot(): EntitlementSnapshot {
  return FREE;
}

export function resolveEntitlements(input: ResolveInput): EntitlementSnapshot {
  if (input.devOverride !== null) {
    return { ...FREE, tier: input.devOverride, state: 'dev', features: featuresOf(input.devOverride) };
  }
  const v = input.verified;
  if (v === null) return { ...FREE, clockBehind: isClockBehind(input.now, input.highWater, null) };
  if (!v.ok) return { ...FREE, state: 'invalid', invalidReason: v.reason };

  const c = v.claims;
  // A tier this build does not know (a newer build's) verifies, but grants only Free here.
  const tier: Tier = isTier(c.tier) ? c.tier : 'free';
  const now = trustedNow(input.now, input.highWater, c.iat);
  const graceEndsAt = c.exp === null ? null : c.exp + OFFLINE_GRACE_SECONDS;
  const state: EntitlementState =
    c.exp === null || now < c.exp ? 'active' : graceEndsAt !== null && now < graceEndsAt ? 'grace' : 'expired';
  const granted = state === 'expired' ? 'free' : tier;
  return {
    tier: granted,
    state,
    features: featuresOf(granted),
    plan: c.plan,
    licenceHint: c.lid.slice(-6),
    paidThrough: c.exp,
    graceEndsAt,
    seats: c.seats,
    clockBehind: isClockBehind(input.now, input.highWater, c.iat),
    invalidReason: null,
  };
}

/**
 * The one check. Free features are true for every snapshot, whatever its state (learning is never
 * locked); a Pro feature needs a snapshot that grants it.
 */
export function can(snapshot: Pick<EntitlementSnapshot, 'features'>, feature: Feature): boolean {
  return FEATURE_INFO[feature].tier === 'free' || snapshot.features.includes(feature);
}

/**
 * The developer override: OFFSUIT_DEV_TIER=pro (or free) in the environment. A packaged build ignores
 * it whatever the environment says, and so does an unknown value. Main passes `app.isPackaged`.
 */
export function devOverrideFrom(env: Readonly<Record<string, string | undefined>>, isPackaged: boolean): Tier | null {
  if (isPackaged) return null;
  const value = env.OFFSUIT_DEV_TIER;
  return isTier(value) ? value : null;
}

/** Re-shape an untrusted snapshot (from IPC) into one the renderer can rely on; anything odd reads as Free. */
export function parseSnapshot(raw: unknown): EntitlementSnapshot {
  if (typeof raw !== 'object' || raw === null) return FREE;
  const o = raw as Record<string, unknown>;
  const tier: Tier = isTier(o.tier) ? o.tier : 'free';
  const states: readonly EntitlementState[] = ['free', 'active', 'grace', 'expired', 'invalid', 'dev'];
  const state = states.includes(o.state as EntitlementState) ? (o.state as EntitlementState) : 'free';
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return {
    tier,
    state,
    features: featuresOf(tier),
    plan: str(o.plan),
    licenceHint: str(o.licenceHint),
    paidThrough: num(o.paidThrough),
    graceEndsAt: num(o.graceEndsAt),
    seats: num(o.seats),
    clockBehind: o.clockBehind === true,
    invalidReason: str(o.invalidReason),
  };
}
