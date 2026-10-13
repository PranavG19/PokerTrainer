import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEV_KEY_ID, DEV_KEYS } from '../../src/core/entitlements/config.js';
import { base64urlEncode, encodeToken, timeMessage, type LicenceClaims } from '../../src/core/entitlements/token.js';
import {
  checkoutPlans,
  createLicenceAuthority,
  gated,
  keyring,
  licenceEndpoints,
  tokenFromDeepLink,
  type LicenceMirror,
} from '../../src/main/licence.js';

vi.mock('electron', () => ({ app: {}, session: {} }));
const { licensingAllows } = await import('../../src/main/network.js');

const DAY = 86_400;
const dev = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../scripts/dev-licence-key.json'), 'utf8')) as {
  kid: string;
  x: string;
  d: string;
};
const devKey = crypto.createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', x: dev.x, d: dev.d }, format: 'jwk' });

function mint(now: number, over: Partial<LicenceClaims> = {}, key: crypto.KeyObject = devKey): string {
  return encodeToken(
    { v: 1, kid: dev.kid, lid: 'lic_unit_000001', tier: 'pro', plan: 'annual', iat: now - DAY, exp: now + 300 * DAY, seats: 3, ...over },
    (m) => new Uint8Array(crypto.sign(null, m, key)),
  );
}

function setup(opts: { isPackaged?: boolean; now?: number; mirror?: LicenceMirror } = {}) {
  let now = opts.now ?? 1_791_000_000;
  let mirror: LicenceMirror = opts.mirror ?? { token: null, highWater: 0 };
  const authority = createLicenceAuthority({
    isPackaged: opts.isPackaged ?? false,
    devOverride: null,
    nowSeconds: () => now,
    loadMirror: () => mirror,
    saveMirror: (m) => {
      mirror = m;
    },
  });
  return {
    authority,
    setNow: (t: number) => {
      now = t;
    },
    now: () => now,
    mirror: () => mirror,
  };
}

const profile = (entitlements: Record<string, unknown> = {}) => ({
  bankroll: 10_000,
  progression: { streak: {}, entitlements: { tier: 'free', granted: [], licence: null, highWater: 0, ...entitlements } },
});
const ent = (p: Record<string, unknown>) => (p.progression as { entitlements: Record<string, unknown> }).entitlements;

describe('the licence authority (main)', () => {
  it('the dev key and its committed private half mint nothing in a packaged build', () => {
    expect(DEV_KEYS[DEV_KEY_ID]).toBe(dev.x);
    expect(keyring(false).has(DEV_KEY_ID)).toBe(true);
    expect(keyring(true).has(DEV_KEY_ID)).toBe(false);
    const packaged = setup({ isPackaged: true });
    expect(packaged.authority.install(mint(packaged.now()))).toEqual({ ok: false, reason: 'bad-signature' });
    expect(packaged.authority.snapshot().tier).toBe('free');
  });

  it('installs a valid key and persists it to the mirror; refuses a forged one and stores nothing', () => {
    const t = setup();
    const forged = mint(t.now(), {}, crypto.generateKeyPairSync('ed25519').privateKey);
    expect(t.authority.install(forged)).toEqual({ ok: false, reason: 'bad-signature' });
    expect(t.mirror().token).toBeNull();
    const ok = t.authority.install(mint(t.now()));
    expect(ok.ok).toBe(true);
    expect(t.authority.snapshot()).toMatchObject({ tier: 'pro', state: 'active' });
    expect(t.mirror().token).toBe(mint(t.now()));
  });

  it('FLIPPING ENTITLEMENTS FROM THE RENDERER: a saved tier, grant list or fake token is overwritten', () => {
    const t = setup();
    t.authority.adopt(profile());
    const hostile = profile({ tier: 'pro', granted: ['leak-finder', 'ranked-play'], licence: 'OFFSUIT1.forged.sig', highWater: 1 });
    const saved = t.authority.stamp(hostile);
    expect(ent(saved)).toMatchObject({ tier: 'free', licence: null });
    expect(ent(saved).granted).not.toContain('leak-finder');
    expect(t.authority.can('leak-finder')).toBe(false);
    // The rest of the profile is untouched.
    expect(saved.bankroll).toBe(10_000);
  });

  it('a renderer save cannot remove an installed licence either', () => {
    const t = setup();
    t.authority.adopt(profile());
    t.authority.install(mint(t.now()));
    expect(ent(t.authority.stamp(profile({ licence: null }))).licence).toBe(mint(t.now()));
  });

  it('adopts a token from the profile on load, and the mirror survives a deleted profile', () => {
    const now = 1_791_000_000;
    const a = setup({ now });
    a.authority.adopt(profile({ licence: mint(now) }));
    expect(a.authority.snapshot().tier).toBe('pro');
    // A fresh profile (deleted, started over) still gets the licence from the settings mirror.
    const b = setup({ now, mirror: a.mirror() });
    expect(ent(b.authority.adopt(profile())).licence).toBe(mint(now));
  });

  it('of two stored tokens the valid, later-issued one wins', () => {
    const now = 1_791_000_000;
    const older = mint(now, { iat: now - 100 * DAY, exp: now + 10 * DAY });
    const newer = mint(now, { iat: now - DAY, exp: now + 300 * DAY });
    const t = setup({ now, mirror: { token: newer, highWater: 0 } });
    t.authority.adopt(profile({ licence: older }));
    expect(t.authority.token()).toBe(newer);
    const u = setup({ now, mirror: { token: older, highWater: 0 } });
    u.authority.adopt(profile({ licence: 'OFFSUIT1.e30.' + 'A'.repeat(86) }));
    expect(u.authority.token()).toBe(older);
  });

  it('ROLLING THE CLOCK BACK: the mark is kept in profile and mirror, so an expired licence stays expired', () => {
    const real = 1_791_000_000;
    const expired = mint(real, { iat: real - 60 * DAY, exp: real - 30 * DAY });
    const t = setup({ now: real - 45 * DAY });
    t.authority.adopt(profile());
    expect(t.authority.install(expired).ok).toBe(true);
    t.setNow(real);
    expect(t.authority.snapshot().state).toBe('expired');
    // Restart with the clock wound back 40 days, from the profile and from the mirror separately.
    const saved = t.authority.stamp(profile());
    const fromProfile = setup({ now: real - 40 * DAY });
    fromProfile.authority.adopt(saved);
    expect(fromProfile.authority.snapshot()).toMatchObject({ state: 'expired', clockBehind: true });
    const fromMirror = setup({ now: real - 40 * DAY, mirror: t.mirror() });
    fromMirror.authority.adopt(profile());
    expect(fromMirror.authority.snapshot().state).toBe('expired');
  });

  it('re-installing the same old key does not reset the rollback guard', () => {
    const real = 1_791_000_000;
    const expired = mint(real, { iat: real - 60 * DAY, exp: real - 30 * DAY });
    const t = setup({ now: real });
    t.authority.adopt(profile());
    t.setNow(real - 40 * DAY);
    expect(t.authority.install(expired)).toEqual({ ok: false, reason: 'already-ended' });
    expect(t.authority.snapshot().state).toBe('free');
  });

  it('remove() forgets the key here and in the mirror', () => {
    const t = setup();
    t.authority.install(mint(t.now()));
    expect(t.authority.remove().tier).toBe('free');
    expect(t.mirror().token).toBeNull();
    expect(ent(t.authority.stamp(profile())).licence).toBeNull();
  });

  it('gated() re-checks in main on every call', () => {
    const t = setup();
    const handler = gated(t.authority, 'leak-finder', (n: number) => n * 2);
    expect(handler(2)).toEqual({ locked: 'leak-finder' });
    t.authority.install(mint(t.now()));
    expect(handler(2)).toBe(4);
  });
});

describe('review fixes: rollback, tampered marks, replacing a key', () => {
  const real = 1_791_000_000;
  const expired = () => mint(real, { iat: real - 60 * DAY, exp: real - 30 * DAY });

  it('clock back, remove the key, paste the same expired key: refused (a paste never lowers the mark)', () => {
    const t = setup({ now: real });
    t.authority.adopt(profile());
    t.authority.install(mint(real, { lid: 'lic_unit_000002' }));
    t.authority.remove();
    t.setNow(real - 40 * DAY);
    const again = t.authority.install(expired());
    expect(again).toEqual({ ok: false, reason: 'already-ended' });
    expect(t.authority.snapshot().tier).toBe('free');
  });

  it('an out-of-range mark in ONE file is ignored, not a reset of the other', () => {
    const t = setup({ now: real });
    t.authority.adopt(profile());
    t.authority.install(mint(real, { iat: real - 60 * DAY, exp: real + DAY }));
    t.setNow(real + 10 * DAY); // licence ended, mark at real + 10d
    t.authority.stamp(profile());
    const mirror = t.mirror();
    for (const bad of [1e20, -5, Number.NaN, 7_258_118_401]) {
      const u = setup({ now: real - 100 * DAY, mirror });
      u.authority.adopt(profile({ licence: mirror.token, highWater: bad }));
      expect(u.authority.snapshot().state, `mark ${bad}`).toBe('grace');
    }
  });

  it('while the clock stays behind, licence time still ticks with the time Offsuit runs', () => {
    let mono = 0;
    let mirror: LicenceMirror = { token: null, highWater: 0 };
    const make = (now: number) =>
      createLicenceAuthority({
        isPackaged: false,
        devOverride: null,
        nowSeconds: () => now,
        monotonicSeconds: () => mono,
        loadMirror: () => mirror,
        saveMirror: (m) => {
          mirror = m;
        },
      });
    const a = make(real);
    a.install(mint(real, { exp: real + 2 * DAY }));
    const b = make(real - 100 * DAY); // set back for good
    expect(b.snapshot().state).toBe('active');
    mono += 3 * DAY; // three days of running with the clock still behind
    expect(b.snapshot().state).toBe('grace');
  });

  it('a newer valid key is never replaced by an older or ended one; a newer one replaces', () => {
    const t = setup({ now: real });
    const current = mint(real, { lid: 'lic_unit_current', iat: real - DAY });
    t.authority.install(current);
    expect(t.authority.install(mint(real, { lid: 'lic_unit_older', iat: real - 10 * DAY }))).toEqual({ ok: false, reason: 'older-than-current' });
    expect(t.authority.install(expired())).toEqual({ ok: false, reason: 'already-ended' });
    expect(t.authority.token()).toBe(current);
    expect(t.authority.install(mint(real, { lid: 'lic_unit_newer', iat: real })).ok).toBe(true);
  });

  it('preview says whether a key has ended and which key it would replace', () => {
    const t = setup({ now: real });
    t.authority.install(mint(real, { lid: 'lic_unit_current' }));
    const p = t.authority.preview(expired());
    expect(p).toMatchObject({ ok: true, ended: true, replaces: 'urrent' });
    const q = t.authority.preview(mint(real, { iat: real }));
    expect(q.ok && q.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('only the server’s SIGNED time lowers a mark a fast clock pushed ahead', () => {
    const t = setup({ now: real + 400 * DAY }); // the clock ran a year ahead once
    t.authority.adopt(profile());
    t.setNow(real);
    const key = mint(real);
    expect(t.authority.install(key)).toEqual({ ok: false, reason: 'already-ended' });
    const signed = (now: number, lid: string, k: crypto.KeyObject = devKey) => ({
      now,
      kid: dev.kid,
      sig: base64urlEncode(new Uint8Array(crypto.sign(null, timeMessage(now, lid), k))),
    });
    // Unsigned, wrongly signed, signed for another licence, or for no licence: all ignored.
    expect(t.authority.correctClock({ now: real }, key)).toBe(false);
    expect(t.authority.correctClock(signed(real, 'lic_unit_000001', crypto.generateKeyPairSync('ed25519').privateKey), key)).toBe(false);
    expect(t.authority.correctClock(signed(real, 'lic_someone_else'), key)).toBe(false);
    expect(t.authority.correctClock(signed(real, 'lic_unit_000001'), null)).toBe(false);
    expect(t.authority.install(key).ok).toBe(false);
    expect(t.authority.correctClock(signed(real, 'lic_unit_000001'), key)).toBe(true);
    expect(t.authority.install(key).ok).toBe(true);
    expect(t.authority.snapshot().state).toBe('active');
  });

  it('a different licence that ends sooner never replaces a longer one', () => {
    const t = setup({ now: real });
    const annual = mint(real, { lid: 'lic_unit_annual', iat: real - DAY, exp: real + 300 * DAY });
    t.authority.install(annual);
    const short = mint(real, { lid: 'lic_unit_short', iat: real, exp: real + 2 * DAY, plan: 'monthly' });
    expect(t.authority.install(short)).toEqual({ ok: false, reason: 'shorter-than-current' });
    expect(t.authority.token()).toBe(annual);
    // A renewal of the same licence, or a longer other one, is fine.
    expect(t.authority.install(mint(real, { lid: 'lic_unit_annual', iat: real, exp: real + 665 * DAY })).ok).toBe(true);
  });
});

describe('deep links and endpoints', () => {
  it('only offsuit://activate?key= yields a token', () => {
    expect(tokenFromDeepLink('offsuit://activate?key=OFFSUIT1.a.b')).toBe('OFFSUIT1.a.b');
    expect(tokenFromDeepLink('offsuit:activate?key=OFFSUIT1.a.b')).toBe('OFFSUIT1.a.b');
    for (const bad of ['https://activate?key=x', 'offsuit://other?key=x', 'offsuit://activate', 42, 'offsuit://activate?key=']) {
      expect(tokenFromDeepLink(bad)).toBeNull();
    }
  });

  const config = { checkout: { monthly: '', annual: 'https://buy.stripe.com/a' }, manage: 'http://evil.example', server: '' };

  it('only https URLs survive; env overrides and loopback http only unpackaged', () => {
    const env = { OFFSUIT_LICENCE_SERVER: 'http://127.0.0.1:9999/', OFFSUIT_CHECKOUT_MONTHLY: 'http://127.0.0.1:1/m' };
    expect(licenceEndpoints(config, env, false)).toEqual({
      checkout: { monthly: 'http://127.0.0.1:1/m', annual: 'https://buy.stripe.com/a' },
      manage: null,
      server: 'http://127.0.0.1:9999',
    });
    expect(licenceEndpoints(config, env, true)).toEqual({
      checkout: { monthly: null, annual: 'https://buy.stripe.com/a' },
      manage: null,
      server: null,
    });
    expect(licenceEndpoints({ ...config, manage: 'https://u:p@x.example' }, {}, true).manage).toBeNull();
  });

  it('checkout opens only with a URL, a price, and something shipped; the dev overrides die when packaged', () => {
    const ep = { checkout: { monthly: 'https://buy.stripe.com/m', annual: null }, manage: null, server: null };
    const prices = { monthly: '$6 a month', annual: '$48 a year' };
    expect(checkoutPlans(ep, prices, false, {}, true)).toEqual({ monthly: null, annual: null });
    expect(checkoutPlans(ep, prices, true, {}, true)).toEqual({ monthly: { url: 'https://buy.stripe.com/m', price: '$6 a month' }, annual: null });
    expect(checkoutPlans(ep, { monthly: '', annual: '' }, true, {}, true).monthly).toBeNull();
    const dev = { OFFSUIT_DEV_SELLABLE: '1', OFFSUIT_PRICE_MONTHLY: '$1' };
    expect(checkoutPlans(ep, { monthly: '', annual: '' }, false, dev, false).monthly).toEqual({ url: 'https://buy.stripe.com/m', price: '$1' });
    expect(checkoutPlans(ep, { monthly: '', annual: '' }, false, dev, true).monthly).toBeNull();
  });

  it('the licensing session admits only the armed origin, and nothing when disarmed', () => {
    expect(licensingAllows('https://licence.example/v1/licence/refresh', 'https://licence.example')).toBe(true);
    expect(licensingAllows('https://evil.example/', 'https://licence.example')).toBe(false);
    expect(licensingAllows('https://licence.example.evil.example/', 'https://licence.example')).toBe(false);
    expect(licensingAllows('https://licence.example/', null)).toBe(false);
    expect(licensingAllows('not a url', 'https://licence.example')).toBe(false);
  });
});
