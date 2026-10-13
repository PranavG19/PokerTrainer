/**
 * THE LICENCE AUTHORITY. Main, never the renderer, decides what this install may use.
 *
 * - The token is verified here with node:crypto against the keys embedded in this build
 *   (core/entitlements/config.ts). A packaged build accepts production keys only; the committed dev key
 *   and the OFFSUIT_DEV_TIER override work only in an unpackaged (developer or test) run.
 * - The renderer's copy of `progression.entitlements` is never believed: `stamp()` replaces it on every
 *   save with this module's own state, and installing a key goes through `install()`, which verifies
 *   first. Flipping `tier` to 'pro' in devtools changes a display cache that the next save overwrites.
 * - A Pro feature that does work (ranked play, sync, import, ICM) runs behind an IPC handler wrapped in
 *   `gated()`, which re-checks here, so a renderer that draws a Pro surface it should not still gets
 *   nothing from main.
 * - Verification is fully offline. The only network this module causes is `refresh()` / `restore()`,
 *   both user-initiated, through network.ts's licensing session (one origin, armed per request).
 *
 * The token and the clock high-water mark are kept in the profile (`progression.entitlements`) AND in
 * the settings file, so deleting the profile (starting learning over) does not lose a purchase or reset
 * the rollback guard. Of two stored tokens, the valid one issued later wins.
 */

import * as crypto from 'node:crypto';
import { advanceHighWater, highWaterAfterInstall } from '../core/entitlements/clock.js';
import { DEV_KEYS, PRODUCTION_KEYS, REVOKED_LICENCE_IDS } from '../core/entitlements/config.js';
import { can, freeSnapshot, resolveEntitlements, type EntitlementSnapshot } from '../core/entitlements/entitlements.js';
import { isFeature, type Feature, type Tier } from '../core/entitlements/features.js';
import { decodeToken, normalizeToken, verifyToken, type LicenceClaims, type SignatureCheck, type VerifyResult } from '../core/entitlements/token.js';

export interface LicenceMirror {
  readonly token: string | null;
  readonly highWater: number;
}

export interface LicenceDeps {
  readonly isPackaged: boolean;
  readonly devOverride: Tier | null;
  readonly nowSeconds: () => number;
  readonly loadMirror: () => LicenceMirror;
  readonly saveMirror: (mirror: LicenceMirror) => void;
}

/** kid → public key. A packaged build never sees DEV_KEYS, so a committed private key mints nothing real. */
export function keyring(isPackaged: boolean): ReadonlyMap<string, crypto.KeyObject> {
  const keys = new Map<string, crypto.KeyObject>();
  const add = (source: Readonly<Record<string, string>>): void => {
    for (const [kid, x] of Object.entries(source)) {
      try {
        keys.set(kid, crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' }));
      } catch {
        // A malformed embedded key verifies nothing rather than breaking startup.
      }
    }
  };
  add(PRODUCTION_KEYS);
  if (!isPackaged) {
    for (const kid of Object.keys(DEV_KEYS)) if (keys.has(kid)) throw new Error(`dev kid ${kid} shadows a production key`);
    add(DEV_KEYS);
  }
  return keys;
}

export function signatureCheck(keys: ReadonlyMap<string, crypto.KeyObject>): SignatureCheck {
  return (kid, message, signature) => {
    const key = keys.get(kid);
    return key !== undefined && crypto.verify(null, message, key, signature);
  };
}

export type InstallOutcome =
  | { readonly ok: true; readonly snapshot: EntitlementSnapshot }
  | { readonly ok: false; readonly reason: string };

export interface LicenceAuthority {
  /** Take the profile main just loaded: adopt its token and mark, and return it with main's entitlements. */
  adopt(profile: Record<string, unknown>): Record<string, unknown>;
  /** Overwrite the entitlements of a profile the renderer asked to save. */
  stamp(profile: Record<string, unknown>): Record<string, unknown>;
  snapshot(): EntitlementSnapshot;
  can(feature: Feature): boolean;
  /** Verify and install a pasted (or deep-linked, then confirmed) key. Nothing is stored unless it verifies. */
  install(raw: string): InstallOutcome;
  /** Forget the key on this Mac (the purchase itself is untouched). */
  remove(): EntitlementSnapshot;
  /** The stored token (for refresh), or null. Never sent to the renderer. */
  token(): string | null;
  /** What a token would grant, verified, without installing it: the deep-link confirmation shows this. */
  preview(raw: string): { ok: true; claims: LicenceClaims } | { ok: false; reason: string };
}

export function createLicenceAuthority(deps: LicenceDeps): LicenceAuthority {
  const check = signatureCheck(keyring(deps.isPackaged));
  const verify = (token: string): VerifyResult => verifyToken(token, check, REVOKED_LICENCE_IDS);

  const mirror = deps.loadMirror();
  let token: string | null = mirror.token;
  let highWater = advanceHighWater(mirror.highWater, deps.nowSeconds());

  const current = (): EntitlementSnapshot =>
    resolveEntitlements({
      verified: token === null ? null : verify(token),
      now: deps.nowSeconds(),
      highWater,
      devOverride: deps.devOverride,
    });

  const persistMirror = (): void => {
    try {
      deps.saveMirror({ token, highWater });
    } catch {
      // The profile copy still holds it; a settings write failing must not fail a save or an install.
    }
  };

  const entitlementsObject = (): Record<string, unknown> => {
    const s = current();
    // A dev override is never persisted as a grant: the cache says what the licence alone grants.
    const cached = s.state === 'dev' ? resolveEntitlements({ verified: token === null ? null : verify(token), now: deps.nowSeconds(), highWater, devOverride: null }) : s;
    return { tier: cached.tier, granted: [...cached.features], licence: token, highWater };
  };

  const withEntitlements = (profile: Record<string, unknown>): Record<string, unknown> => {
    const progression = profile.progression;
    if (typeof progression !== 'object' || progression === null || Array.isArray(progression)) return profile;
    const carried = (progression as Record<string, unknown>).entitlements;
    // Unknown keys a newer build of this version put in entitlements are carried, never main's own keys.
    const extra = typeof carried === 'object' && carried !== null && !Array.isArray(carried) ? carried : {};
    return {
      ...profile,
      progression: { ...progression, entitlements: { ...extra, ...entitlementsObject() } },
    };
  };

  return {
    adopt(profile) {
      const stored = readStored(profile);
      if (stored !== null) {
        highWater = Math.max(highWater, stored.highWater);
        if (stored.token !== null) token = better(token, stored.token, verify);
      }
      highWater = advanceHighWater(highWater, deps.nowSeconds());
      persistMirror();
      return withEntitlements(profile);
    },
    stamp(profile) {
      highWater = advanceHighWater(highWater, deps.nowSeconds());
      persistMirror();
      return withEntitlements(profile);
    },
    snapshot: current,
    can: (feature) => can(current(), feature),
    install(raw) {
      if (typeof raw !== 'string') return { ok: false, reason: 'malformed' };
      const candidate = normalizeToken(raw);
      const result = verify(candidate);
      if (!result.ok) return { ok: false, reason: result.reason };
      const previous = token === null ? null : verify(token);
      const previousIat = previous !== null && previous.ok ? previous.claims.iat : null;
      highWater = highWaterAfterInstall(highWater, deps.nowSeconds(), result.claims.iat, previousIat);
      token = candidate;
      persistMirror();
      return { ok: true, snapshot: current() };
    },
    remove() {
      token = null;
      persistMirror();
      return current();
    },
    token: () => token,
    preview(raw) {
      if (typeof raw !== 'string') return { ok: false, reason: 'malformed' };
      const result = verify(normalizeToken(raw));
      return result.ok ? { ok: true, claims: result.claims } : { ok: false, reason: result.reason };
    },
  };
}

/** Of two stored tokens: a valid one beats an invalid one; of two valid ones, the later issue wins. */
function better(a: string | null, b: string, verify: (t: string) => VerifyResult): string {
  if (a === null || a === b) return b;
  const va = verify(a);
  const vb = verify(b);
  if (!va.ok) return vb.ok ? b : a;
  if (!vb.ok) return a;
  return vb.claims.iat > va.claims.iat ? b : a;
}

function readStored(profile: Record<string, unknown>): LicenceMirror | null {
  const progression = profile.progression;
  if (typeof progression !== 'object' || progression === null) return null;
  const e = (progression as Record<string, unknown>).entitlements;
  if (typeof e !== 'object' || e === null) return null;
  const o = e as Record<string, unknown>;
  const raw = typeof o.licence === 'string' ? normalizeToken(o.licence) : '';
  return {
    // Decodable at least; verification decides what it grants.
    token: raw.length > 0 && !('error' in decodeToken(raw)) ? raw : null,
    highWater: typeof o.highWater === 'number' && Number.isFinite(o.highWater) ? o.highWater : 0,
  };
}

/**
 * Wrap an IPC handler for a Pro feature. The check runs in main on every call, so a renderer that was
 * talked into drawing the surface (devtools, a bug) still gets `{ locked: feature }` and nothing else.
 */
export function gated<A extends unknown[], R>(
  authority: Pick<LicenceAuthority, 'can'>,
  feature: Feature,
  handler: (...args: A) => R,
): (...args: A) => R | { locked: Feature } {
  if (!isFeature(feature)) throw new Error(`unknown feature ${String(feature)}`);
  return (...args: A) => (authority.can(feature) ? handler(...args) : { locked: feature });
}

export { freeSnapshot };

export interface LicenceEndpoints {
  readonly checkout: Readonly<Record<'monthly' | 'annual', string | null>>;
  readonly manage: string | null;
  readonly server: string | null;
}

/**
 * The public URLs this build uses: config.ts's values, which an unpackaged run may override from the
 * environment (OFFSUIT_CHECKOUT_MONTHLY, OFFSUIT_CHECKOUT_ANNUAL, OFFSUIT_MANAGE_URL,
 * OFFSUIT_LICENCE_SERVER) so tests can point them at loopback. Only https survives (loopback http too,
 * unpackaged only); anything else reads as not configured.
 */
export function licenceEndpoints(
  config: { checkout: Readonly<Record<'monthly' | 'annual', string>>; manage: string; server: string },
  env: Readonly<Record<string, string | undefined>>,
  isPackaged: boolean,
): LicenceEndpoints {
  const pick = (value: string, override: string | undefined): string | null => {
    const url = !isPackaged && override !== undefined && override !== '' ? override : value;
    return usableUrl(url, isPackaged) ? url : null;
  };
  return {
    checkout: {
      monthly: pick(config.checkout.monthly, env.OFFSUIT_CHECKOUT_MONTHLY),
      annual: pick(config.checkout.annual, env.OFFSUIT_CHECKOUT_ANNUAL),
    },
    manage: pick(config.manage, env.OFFSUIT_MANAGE_URL),
    server: pick(config.server, env.OFFSUIT_LICENCE_SERVER)?.replace(/\/+$/, '') ?? null,
  };
}

function usableUrl(url: string, isPackaged: boolean): boolean {
  if (url === '') return false;
  try {
    const u = new URL(url);
    if (u.username !== '' || u.password !== '') return false;
    if (u.protocol === 'https:') return true;
    return !isPackaged && u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  } catch {
    return false;
  }
}

/** A deep link `offsuit://activate?key=<token>` → the token, or null for anything else. */
export function tokenFromDeepLink(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 4096) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'offsuit:') return null;
    // offsuit://activate?key=… parses with host 'activate'; offsuit:activate?key=… with pathname 'activate'.
    const action = u.host !== '' ? u.host : u.pathname.replace(/^\/+/, '');
    if (action !== 'activate') return null;
    const key = u.searchParams.get('key');
    return key === null || key === '' ? null : normalizeToken(key);
  } catch {
    return null;
  }
}
