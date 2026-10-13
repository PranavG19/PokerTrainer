import * as crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  advanceHighWater,
  highWaterAfterInstall,
  isClockBehind,
  ROLLBACK_TOLERANCE_SECONDS,
  trustedNow,
} from '../../src/core/entitlements/clock.js';
import {
  can,
  devOverrideFrom,
  OFFLINE_GRACE_SECONDS,
  parseSnapshot,
  resolveEntitlements,
} from '../../src/core/entitlements/entitlements.js';
import { FEATURE_INFO, FREE_FEATURES, PRO_FEATURES, type Feature } from '../../src/core/entitlements/features.js';
import {
  base64urlDecode,
  base64urlEncode,
  decodeToken,
  encodeToken,
  verifyToken,
  type LicenceClaims,
  type SignatureCheck,
} from '../../src/core/entitlements/token.js';
import { defaultProgression, parseProgression, PROGRESSION_SHAPE } from '../../src/core/progression/persist.js';
import { unknownKeysOf, withUnknownKeys } from '../../src/core/profileSchema.js';

const NOW = 1_791_000_000; // 2026-10
const DAY = 86_400;

const pair = crypto.generateKeyPairSync('ed25519');
const other = crypto.generateKeyPairSync('ed25519');
const sign = (key: crypto.KeyObject) => (m: Uint8Array) => new Uint8Array(crypto.sign(null, m, key));
const check: SignatureCheck = (kid, m, s) => kid === 'k1' && crypto.verify(null, m, pair.publicKey, s);

function claims(over: Partial<LicenceClaims> = {}): LicenceClaims {
  return { v: 1, kid: 'k1', lid: 'lic_abcdef123456', tier: 'pro', plan: 'annual', iat: NOW - DAY, exp: NOW + 300 * DAY, seats: 3, ...over };
}
const mint = (over: Partial<LicenceClaims> = {}, key = pair.privateKey) => encodeToken(claims(over), sign(key));

describe('licence token', () => {
  it('round-trips and verifies; whitespace from an email paste is ignored', () => {
    const t = mint();
    const r = verifyToken(`  ${t.slice(0, 40)}\n${t.slice(40)}  `, check);
    expect(r).toEqual({ ok: true, claims: claims() });
  });

  it('refuses a forged signature, a key from another pair and an unknown kid', () => {
    expect(verifyToken(mint({}, other.privateKey), check)).toEqual({ ok: false, reason: 'bad-signature' });
    expect(verifyToken(mint({ kid: 'k2' }), check)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('refuses edited claims: a tier or expiry changed after signing', () => {
    const [prefix, , sig] = mint().split('.');
    for (const edit of [{ tier: 'pro', exp: NOW + 9000 * DAY }, { seats: 1000 }, { plan: 'perpetual', exp: null }]) {
      const payload = base64urlEncode(new TextEncoder().encode(JSON.stringify(claims(edit))));
      expect(verifyToken(`${prefix}.${payload}.${sig}`, check).ok).toBe(false);
    }
  });

  it('a signature cannot be lifted onto another prefix (the prefix is signed)', () => {
    const [, payload, sig] = mint().split('.');
    expect(verifyToken(`OFFSUIT2.${payload}.${sig}`, check)).toEqual({ ok: false, reason: 'wrong-format' });
  });

  it('refuses malformed and off-shape tokens without throwing', () => {
    for (const bad of ['', 'x', 'a.b.c', 'OFFSUIT1..', 'OFFSUIT1.e30.' + 'A'.repeat(86), 'x'.repeat(5000)]) {
      expect(verifyToken(bad, check).ok).toBe(false);
    }
    // A check that throws is a failed check.
    expect(verifyToken(mint(), () => { throw new Error('boom'); }).ok).toBe(false);
    for (const c of [{ v: 2 }, { seats: 0 }, { exp: NOW - 2 * DAY }, { iat: 12 }, { lid: 'has space' }]) {
      const payload = base64urlEncode(new TextEncoder().encode(JSON.stringify(claims(c as Partial<LicenceClaims>))));
      const msg = new TextEncoder().encode(`OFFSUIT1.${payload}`);
      expect(decodeToken(`OFFSUIT1.${payload}.${base64urlEncode(sign(pair.privateKey)(msg))}`)).toEqual({ error: 'bad-claims' });
    }
  });

  it('only canonical base64url decodes, so a token has one spelling', () => {
    expect(base64urlDecode('AA==')).toBeNull();
    expect(base64urlDecode('AB')).toBeNull(); // non-zero padding bits
    expect(base64urlDecode('AA')).toEqual(new Uint8Array([0]));
  });

  it('a revoked licence id is refused', () => {
    expect(verifyToken(mint(), check, new Set(['lic_abcdef123456']))).toEqual({ ok: false, reason: 'revoked' });
  });
});

describe('clock', () => {
  it('rolling the clock back never moves licence time back', () => {
    expect(trustedNow(NOW - 400 * DAY, NOW, null)).toBe(NOW);
    expect(trustedNow(NOW - 400 * DAY, 0, NOW - DAY)).toBe(NOW - DAY); // the token's iat bounds it too
  });

  it('warns only beyond the tolerance', () => {
    expect(isClockBehind(NOW - ROLLBACK_TOLERANCE_SECONDS + 1, NOW, null)).toBe(false);
    expect(isClockBehind(NOW - ROLLBACK_TOLERANCE_SECONDS - 1, NOW, null)).toBe(true);
  });

  it('the mark never goes down, and ignores absurd readings', () => {
    expect(advanceHighWater(NOW, NOW - DAY)).toBe(NOW);
    expect(advanceHighWater(NOW, Number.NaN)).toBe(NOW);
    expect(advanceHighWater(NOW, 9e12)).toBe(NOW);
  });

  it('only a NEWER token resets a mark a fast clock pushed ahead', () => {
    const fastMark = NOW + 1000 * DAY;
    expect(highWaterAfterInstall(fastMark, NOW, NOW - DAY, NOW - 2 * DAY)).toBe(NOW);
    // Replaying the same or an older token cannot.
    expect(highWaterAfterInstall(fastMark, NOW, NOW - 2 * DAY, NOW - 2 * DAY)).toBe(fastMark);
  });
});

describe('resolveEntitlements and can()', () => {
  const resolve = (token: string | null, now = NOW, highWater = 0) =>
    resolveEntitlements({ verified: token === null ? null : verifyToken(token, check), now, highWater, devOverride: null });

  it('Free without a licence; Pro inside the paid period', () => {
    expect(resolve(null)).toMatchObject({ tier: 'free', state: 'free' });
    expect(resolve(mint())).toMatchObject({ tier: 'pro', state: 'active', plan: 'annual', licenceHint: '123456' });
  });

  it('grace for OFFLINE_GRACE_DAYS after the period, then Free', () => {
    const exp = NOW + 10 * DAY;
    const t = mint({ exp });
    expect(resolve(t, exp + 1).state).toBe('grace');
    expect(resolve(t, exp + 1).tier).toBe('pro');
    expect(resolve(t, exp + OFFLINE_GRACE_SECONDS - 1).state).toBe('grace');
    expect(resolve(t, exp + OFFLINE_GRACE_SECONDS)).toMatchObject({ state: 'expired', tier: 'free' });
  });

  it('a clock rolled back cannot revive an expired licence', () => {
    const exp = NOW - 30 * DAY;
    const t = mint({ iat: exp - 30 * DAY, exp });
    expect(resolve(t, exp - DAY, NOW)).toMatchObject({ state: 'expired', clockBehind: true });
  });

  it('a perpetual licence never expires; an unknown tier verifies but grants Free', () => {
    expect(resolve(mint({ plan: 'perpetual', exp: null }), NOW + 5000 * DAY).state).toBe('active');
    expect(resolve(mint({ tier: 'platinum' })).tier).toBe('free');
  });

  it('an invalid token is Free with a reason', () => {
    expect(resolve(mint({}, other.privateKey))).toMatchObject({ tier: 'free', state: 'invalid', invalidReason: 'bad-signature' });
  });

  it('LEARNING IS NEVER LOCKED: every Free feature is allowed in every state', () => {
    const states = [null, mint(), mint({ exp: NOW - 400 * DAY, iat: NOW - 500 * DAY }), mint({}, other.privateKey)];
    for (const token of states) {
      const s = resolve(token);
      for (const f of FREE_FEATURES) expect(can(s, f)).toBe(true);
    }
    // Even a hostile snapshot with no features at all.
    for (const f of FREE_FEATURES) expect(can({ features: [] }, f)).toBe(true);
  });

  it('Pro features need Pro', () => {
    for (const f of PRO_FEATURES) {
      expect(can(resolve(null), f)).toBe(false);
      expect(can(resolve(mint()), f)).toBe(true);
    }
  });

  it('every feature has a tier, and nothing cosmetic or currency-like is Pro', () => {
    for (const f of Object.keys(FEATURE_INFO) as Feature[]) {
      expect(['free', 'pro']).toContain(FEATURE_INFO[f].tier);
      if (FEATURE_INFO[f].tier === 'pro') expect(f).not.toMatch(/cosmetic|chalk|streak|boost|freeze/);
    }
  });

  it('parseSnapshot derives features from the tier, so a doctored feature list grants nothing', () => {
    const s = parseSnapshot({ tier: 'free', state: 'active', features: [...PRO_FEATURES] });
    expect(can(s, 'leak-finder')).toBe(false);
    expect(parseSnapshot('junk')).toMatchObject({ tier: 'free', state: 'free' });
  });
});

describe('dev override', () => {
  it('works unpackaged and is impossible in a packaged build', () => {
    expect(devOverrideFrom({ OFFSUIT_DEV_TIER: 'pro' }, false)).toBe('pro');
    expect(devOverrideFrom({ OFFSUIT_DEV_TIER: 'pro' }, true)).toBeNull();
    expect(devOverrideFrom({ OFFSUIT_DEV_TIER: 'gold' }, false)).toBeNull();
    expect(devOverrideFrom({}, false)).toBeNull();
    const s = resolveEntitlements({ verified: null, now: NOW, highWater: 0, devOverride: 'pro' });
    expect(s).toMatchObject({ tier: 'pro', state: 'dev' });
  });
});

describe('persistence in progression (additive, no version bump)', () => {
  it('defaults, and an older v2 entitlements object without the new keys', () => {
    expect(defaultProgression().entitlements).toEqual({ tier: 'free', granted: [], licence: null, highWater: 0 });
    expect(parseProgression({ entitlements: { tier: 'free', granted: [] } }).entitlements).toEqual({
      tier: 'free',
      granted: [],
      licence: null,
      highWater: 0,
    });
  });

  it('tolerant: bad values read as defaults, a pasted token loses its whitespace', () => {
    const p = parseProgression({ entitlements: { licence: 42, highWater: -5 } });
    expect(p.entitlements).toMatchObject({ licence: null, highWater: 0 });
    expect(parseProgression({ entitlements: { licence: ' a b ', highWater: 1.5 } }).entitlements).toMatchObject({
      licence: 'ab',
      highWater: 0,
    });
    expect(parseProgression({ entitlements: { licence: 'x'.repeat(3000) } }).entitlements.licence).toBeNull();
  });

  it('the shape lists the new keys, and a newer build’s extra key inside entitlements is carried', () => {
    expect(PROGRESSION_SHAPE.entitlements).toEqual({ tier: true, granted: true, licence: true, highWater: true });
    const raw = { schemaVersion: 2, progression: { entitlements: { tier: 'pro', granted: [], licence: null, highWater: 0, future: 1 } } };
    const carried = unknownKeysOf(raw);
    const out = withUnknownKeys({ progression: { entitlements: { tier: 'free', granted: [], licence: null, highWater: 0 } } }, carried);
    expect((out.progression as { entitlements: Record<string, unknown> }).entitlements.future).toBe(1);
  });
});
