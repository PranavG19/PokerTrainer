import { expect, test, type Page } from '@playwright/test';
import * as crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeToken, type LicenceClaims } from '../../src/core/entitlements/token.js';
import { createLicenceServer } from '../../src/server/licensing/handler.js';
import { MemoryLicenceStore } from '../../src/server/licensing/store.js';
import { signStripePayload } from '../../src/server/licensing/stripe.js';
import { launchApp } from './helpers.js';

/**
 * Offsuit Pro in the running app: Free copy, the upgrade sheet, activating a key, the deep link, checkout
 * in the system browser, renewal against a real licence server on loopback, and the attacks a learner
 * could try from devtools (forged key, a doctored save). Keys are minted with the committed dev key,
 * which only an unpackaged run (this one) accepts.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEV = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/dev-licence-key.json'), 'utf8')) as { kid: string; x: string; d: string };
const DEV_PRIVATE = crypto.createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', x: DEV.x, d: DEV.d }, format: 'jwk' });
const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);
const SHOTS = path.join(ROOT, 'test-results', 'pro-shots');

function mint(over: Partial<LicenceClaims> = {}, key: crypto.KeyObject = DEV_PRIVATE): string {
  return encodeToken(
    { v: 1, kid: DEV.kid, lid: 'lic_e2e_abc123', tier: 'pro', plan: 'annual', iat: now() - DAY, exp: now() + 300 * DAY, seats: 3, ...over },
    (m) => new Uint8Array(crypto.sign(null, m, key)),
  );
}

async function openSettings(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.locator('[data-testid="tab-settings"]').click();
  await page.locator('[data-testid="pro-settings"]').scrollIntoViewIfNeeded();
}

async function activate(page: Page, key: string): Promise<void> {
  await page.locator('[data-testid="pro-key-input"]').fill(key);
  await page.locator('[data-testid="pro-activate"]').click();
}

function readProfile(dir: string): { progression: { entitlements: Record<string, unknown> } } {
  return JSON.parse(fs.readFileSync(path.join(dir, 'offsuit-state.json'), 'utf8'));
}

test('Free: learning is never locked, and the upgrade sheet is honest', async () => {
  const { page, close } = await launchApp();
  try {
    await openSettings(page);
    const section = page.locator('[data-testid="pro-settings"]');
    await expect(section).toHaveAttribute('data-tier', 'free');
    await expect(page.locator('[data-testid="pro-state-detail"]')).toContainText('Learning is never locked');
    await expect(page.locator('[data-testid="pro-gate"][data-locked="true"]')).toHaveCount(4);

    await page.locator('[data-testid="pro-see"]').click();
    const sheet = page.locator('[data-testid="upgrade-sheet"]');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Learning is never locked');
    await expect(page.locator('[data-testid="upgrade-terms"]')).toContainText('Cancel any time');
    await expect(page.locator('[data-testid="upgrade-free-features"]')).toContainText('Dee');
    // The leak finder and ICM tools have shipped; ranked play and cloud sync say they are coming. Checkout
    // is still closed: this build has no checkout URL or price.
    await expect(page.locator('[data-testid="coming-tag"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="upgrade-checkout"]')).toBeDisabled();
    await expect(page.locator('[data-testid="upgrade-plan-monthly"]')).toHaveAttribute('aria-pressed', 'true');
    // No fake urgency anywhere on it.
    expect(await sheet.innerText()).not.toMatch(/only today|limited|hurry|ends in|last chance|\d+:\d\d/i);

    fs.mkdirSync(SHOTS, { recursive: true });
    for (const [w, h] of [[900, 640], [1100, 760]] as const) {
      await page.setViewportSize({ width: w, height: h });
      const box = await sheet.boundingBox();
      expect(box!.height, `sheet fits ${w}x${h}`).toBeLessThanOrEqual(h);
      await page.screenshot({ path: path.join(SHOTS, `upgrade-sheet-${w}x${h}.png`), animations: 'disabled' });
    }
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    for (const [w, h] of [[900, 640], [1100, 760]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.locator('[data-testid="pro-settings"]').scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
      await page.screenshot({ path: path.join(SHOTS, `settings-pro-free-${w}x${h}.png`) });
    }
  } finally {
    await close();
  }
});

test('activating a key turns Pro on, survives a restart, and survives deleting the profile', async () => {
  const first = await launchApp();
  const key = mint();
  try {
    await openSettings(first.page);
    await activate(first.page, `  ${key.slice(0, 50)}\n${key.slice(50)} `);
    await expect(first.page.locator('[data-testid="pro-settings"]')).toHaveAttribute('data-tier', 'pro');
    await expect(first.page.locator('[data-testid="pro-state"]')).toContainText('Annual Pro, through');
    await expect(first.page.locator('[data-testid="pro-gate"][data-locked="false"]')).toHaveCount(4);
    expect(readProfile(first.userDataDir).progression.entitlements.licence).toBe(key);
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const [w, h] of [[900, 640], [1100, 760]] as const) {
      await first.page.setViewportSize({ width: w, height: h });
      await first.page.locator('[data-testid="pro-settings"]').scrollIntoViewIfNeeded();
      await first.page.screenshot({ path: path.join(SHOTS, `settings-pro-active-${w}x${h}.png`) });
    }
  } finally {
    await first.close();
  }
  const second = await launchApp({ userDataDir: first.userDataDir });
  try {
    await openSettings(second.page);
    await expect(second.page.locator('[data-testid="pro-settings"]')).toHaveAttribute('data-tier', 'pro');
    // Delete the profile (start learning over): the purchase is kept from the settings mirror.
    await second.page.locator('[data-testid="delete-confirm-input"]').fill('DELETE PROFILE');
    await second.page.locator('[data-testid="delete-confirm-button"]').click();
    await expect(second.page.locator('[data-testid="pro-settings"]')).toHaveAttribute('data-tier', 'pro');
  } finally {
    await second.close();
  }
});

test('FORGED KEY and DOCTORED SAVE from devtools: neither grants anything', async () => {
  const { page, userDataDir, close } = await launchApp();
  try {
    await openSettings(page);
    const forged = mint({}, crypto.generateKeyPairSync('ed25519').privateKey);
    await activate(page, forged);
    await expect(page.locator('[data-testid="pro-notice"]')).toHaveAttribute('data-kind', 'error');
    await expect(page.locator('[data-testid="pro-settings"]')).toHaveAttribute('data-tier', 'free');
    // Edit the claims of a real key (a longer expiry): the signature no longer matches.
    const [prefix, , sig] = mint().split('.');
    const longer = Buffer.from(JSON.stringify({ v: 1, kid: DEV.kid, lid: 'lic_e2e_abc123', tier: 'pro', plan: 'annual', iat: now(), exp: now() + 9000 * DAY, seats: 3 })).toString('base64url');
    const result = await page.evaluate((t) => window.offsuit!.licenceActivate!(t), `${prefix}.${longer}.${sig}`);
    expect(result).toMatchObject({ ok: false, reason: 'bad-signature' });

    // Devtools: save a profile that claims Pro. Main overwrites entitlements on the way to disk.
    await page.evaluate(async () => {
      const state = (await window.offsuit!.loadState()) as { progression: { entitlements: Record<string, unknown> } };
      state.progression.entitlements = { tier: 'pro', granted: ['leak-finder', 'ranked-play', 'icm-tools', 'cloud-sync'], licence: 'OFFSUIT1.x.y', highWater: 1 };
      await window.offsuit!.saveState(state);
    });
    const saved = readProfile(userDataDir).progression.entitlements;
    expect(saved).toMatchObject({ tier: 'free', licence: null });
    expect(saved.granted).not.toContain('leak-finder');
    const status = (await page.evaluate(() => window.offsuit!.licenceStatus!())) as { snapshot: { tier: string } };
    expect(status.snapshot.tier).toBe('free');
  } finally {
    await close();
  }
});

test('a deep link only PROPOSES a key: declined, nothing changes; accepted, Pro is on', async () => {
  const { app, page, close } = await launchApp();
  try {
    await openSettings(page);
    const link = `offsuit://activate?key=${encodeURIComponent(mint())}`;
    const emit = (url: string) => app.evaluate(({ app: a }, u) => a.emit('open-url', { preventDefault: () => {} }, u), url);

    await emit(link);
    await expect(page.locator('[data-testid="deeplink-confirm"]')).toBeVisible();
    await expect(page.locator('[data-testid="deeplink-summary"]')).toContainText('ending abc123');
    await page.locator('[data-testid="deeplink-decline"]').click();
    await expect(page.locator('[data-testid="pro-settings"]')).toHaveAttribute('data-tier', 'free');
    // Declining drops it: confirming later has nothing to install.
    expect(await page.evaluate(() => window.offsuit!.licenceDeepLinkConfirm!(true, '0000000000000000'))).toMatchObject({ ok: false });

    // A second link arriving while the first is shown: Add installs neither, because the id no longer matches.
    await emit(link);
    await expect(page.locator('[data-testid="deeplink-confirm"]')).toBeVisible();
    const swapped = mint({ lid: 'lic_e2e_swapped', exp: now() + 2 * DAY });
    await app.evaluate(({ app: a }, u) => a.emit('open-url', { preventDefault: () => {} }, u), `offsuit://activate?key=${encodeURIComponent(swapped)}`);
    // The renderer re-opens the dialog for the new link; answer the stale one through IPC to prove main refuses it.
    const staleId = crypto.createHash('sha256').update(mint(), 'utf8').digest('hex').slice(0, 16);
    expect(await page.evaluate((id) => window.offsuit!.licenceDeepLinkConfirm!(true, id), staleId)).toMatchObject({ ok: false });
    await page.locator('[data-testid="deeplink-decline"]').click();
    await expect(page.locator('[data-testid="pro-settings"]')).toHaveAttribute('data-tier', 'free');

    await emit(link);
    await page.locator('[data-testid="deeplink-accept"]').click();
    await expect(page.locator('[data-testid="pro-settings"]')).toHaveAttribute('data-tier', 'pro');

    // A link with an ENDED key can only be dismissed, and never downgrades the key in place.
    await emit(`offsuit://activate?key=${encodeURIComponent(mint({ lid: 'lic_e2e_ended', iat: now() - 90 * DAY, exp: now() - 60 * DAY }))}`);
    await expect(page.locator('[data-testid="deeplink-summary"]')).toContainText('already ended');
    await expect(page.locator('[data-testid="deeplink-accept"]')).toHaveCount(0);
    await page.locator('[data-testid="deeplink-close"]').click();
    await expect(page.locator('[data-testid="pro-settings"]')).toHaveAttribute('data-tier', 'pro');
  } finally {
    await close();
  }
});

test('with Pro features shipped, checkout still needs both a URL and a price shown before it', async () => {
  // Owner decision: the leak finder and ICM tools are shipped, so "something has shipped" holds. A checkout
  // URL alone still opens nothing: the price must be on the sheet before anyone clicks through.
  const urlOnly = await launchApp({ env: { OFFSUIT_CHECKOUT_MONTHLY: 'https://checkout.example/m' } });
  try {
    await openSettings(urlOnly.page);
    await urlOnly.page.locator('[data-testid="pro-see"]').click();
    await expect(urlOnly.page.locator('[data-testid="upgrade-checkout"]')).toBeDisabled();
    expect(await urlOnly.page.evaluate(() => window.offsuit!.licenceOpenCheckout!('monthly'))).toEqual({ opened: false });
  } finally {
    await urlOnly.close();
  }
  // With a URL and a price (and no dev "sellable" override), checkout is open.
  const priced = await launchApp({ env: { OFFSUIT_CHECKOUT_MONTHLY: 'https://checkout.example/m', OFFSUIT_PRICE_MONTHLY: '$6 a month' } });
  try {
    await openSettings(priced.page);
    await priced.page.locator('[data-testid="pro-see"]').click();
    await expect(priced.page.locator('[data-testid="upgrade-checkout"]')).toBeEnabled();
    await expect(priced.page.locator('[data-testid="upgrade-coming-note"]')).toContainText('later updates');
  } finally {
    await priced.close();
  }
});

test('checkout opens in the system browser (recorded under e2e), never in the app', async () => {
  const url = 'https://checkout.example/offsuit-pro-monthly';
  const { app, page, close } = await launchApp({
    env: { OFFSUIT_CHECKOUT_MONTHLY: url, OFFSUIT_PRICE_MONTHLY: '$6 a month', OFFSUIT_DEV_SELLABLE: '1' },
  });
  try {
    await openSettings(page);
    const windowsBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    await page.locator('[data-testid="pro-see"]').click();
    await expect(page.locator('[data-testid="upgrade-checkout"]')).toBeEnabled();
    await expect(page.locator('[data-testid="upgrade-price"]')).toHaveText('$6 a month');
    // Annual has no URL here: it is not on sale, and says so.
    await page.locator('[data-testid="upgrade-plan-annual"]').click();
    await expect(page.locator('[data-testid="upgrade-checkout"]')).toBeDisabled();
    await page.locator('[data-testid="upgrade-plan-monthly"]').click();
    await page.locator('[data-testid="upgrade-checkout"]').click();
    await expect(page.locator('[data-testid="pro-notice"]')).toContainText('Checkout opened in your browser');
    const opened = await app.evaluate(() => (globalThis as { __offsuitOpenedExternal?: string[] }).__offsuitOpenedExternal ?? []);
    expect(opened).toEqual([url]);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(windowsBefore);
    // The renderer cannot name a URL: an unknown plan opens nothing.
    expect(await page.evaluate(() => window.offsuit!.licenceOpenCheckout!('https://evil.example' as 'monthly'))).toEqual({ opened: false });
  } finally {
    await close();
  }
});

test('Check for renewal fetches the renewed key from a real licence server, only when pressed', async () => {
  // The real handler on loopback, signing with the dev key so this unpackaged app accepts it.
  const store = new MemoryLicenceStore();
  let periodEnd = now() + 30 * DAY;
  const handle = createLicenceServer({
    store,
    stripe: {
      getSubscription: async (id) => ({ id, status: 'active', customerEmail: 'e2e@example.com', currentPeriodEnd: periodEnd, interval: 'month' }),
      getCharge: async () => null,
    },
    webhookSecrets: ['whsec_e2e'],
    signing: { kid: DEV.kid, key: DEV_PRIVATE },
    publicKeys: { [DEV.kid]: DEV.x },
    emailPepper: 'e2e',
    nowSeconds: now,
  });
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      requests.push(`${req.method} ${req.url}`);
      void handle({ method: req.method ?? 'GET', url: req.url ?? '/', headers: req.headers as Record<string, string>, body: Buffer.concat(chunks).toString() }).then((out) =>
        res.writeHead(out.status, { 'content-type': out.contentType }).end(out.body),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const webhook = async (type: string, object: Record<string, unknown>, id: string) => {
    const body = JSON.stringify({ id, object: 'event', type, data: { object } });
    await handle({ method: 'POST', url: '/webhooks/stripe', headers: { 'stripe-signature': signStripePayload(body, 'whsec_e2e', now()) }, body });
  };
  await webhook('checkout.session.completed', { id: 'cs_e2e', object: 'checkout.session', subscription: 'sub_e2e' }, 'evt_1');
  const firstKey = (await store.bySubscription('sub_e2e'))!.token;

  const { page, close } = await launchApp({ env: { OFFSUIT_LICENCE_SERVER: `http://127.0.0.1:${port}` } });
  try {
    await openSettings(page);
    await activate(page, firstKey);
    await expect(page.locator('[data-testid="pro-settings"]')).toHaveAttribute('data-tier', 'pro');
    expect(requests, 'nothing is sent until a button is pressed').toEqual([]);

    periodEnd = now() + 60 * DAY;
    await webhook('invoice.paid', { id: 'in_e2e_2', object: 'invoice', subscription: 'sub_e2e' }, 'evt_2');
    await page.locator('[data-testid="pro-refresh"]').click();
    await expect(page.locator('[data-testid="pro-notice"]')).toContainText('Renewed');
    expect(requests).toEqual(['POST /v1/licence/refresh']);
    const status = (await page.evaluate(() => window.offsuit!.licenceStatus!())) as { snapshot: { paidThrough: number } };
    expect(status.snapshot.paidThrough).toBe(periodEnd);

    // Restore on a "new Mac": order number + email.
    await page.locator('[data-testid="pro-remove"]').click();
    await expect(page.locator('[data-testid="pro-settings"]')).toHaveAttribute('data-tier', 'free');
    await page.locator('[data-testid="pro-restore"] summary').click();
    await page.locator('[data-testid="pro-restore-order"]').fill('cs_e2e');
    await page.locator('[data-testid="pro-restore-email"]').fill('E2E@example.com');
    await page.locator('[data-testid="pro-restore-go"]').click();
    await expect(page.locator('[data-testid="pro-settings"]')).toHaveAttribute('data-tier', 'pro');
    expect(requests).toEqual(['POST /v1/licence/refresh', 'POST /v1/licence/restore']);
  } finally {
    await close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('the dev override shows as such (unpackaged only; the unit tests pin the packaged refusal)', async () => {
  const { page, close } = await launchApp({ env: { OFFSUIT_DEV_TIER: 'pro' } });
  try {
    await openSettings(page);
    await expect(page.locator('[data-testid="pro-settings"]')).toHaveAttribute('data-state', 'dev');
    await expect(page.locator('[data-testid="pro-state"]')).toContainText('Developer override');
  } finally {
    await close();
  }
});
