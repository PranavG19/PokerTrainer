import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import * as crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeToken } from '../../src/core/entitlements/token.js';
import { launchApp } from './helpers.js';

/**
 * The Pro tab in the running app: the gate (locked without Pro, open with a test licence), an import
 * through the native file dialog (stubbed from this process: product code has no test hook), the leak
 * finder over the imported hands, the ICM / push-fold screen, both screens at both window sizes, and
 * the promise that an import earns nothing: the profile file is byte-for-byte unchanged by it.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURES = path.join(ROOT, 'tests/fixtures/hh');
const DEV = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/dev-licence-key.json'), 'utf8')) as { kid: string; x: string; d: string };
const DEV_PRIVATE = crypto.createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', x: DEV.x, d: DEV.d }, format: 'jwk' });
const SHOTS = path.join(ROOT, 'test-results', 'pro-tools-shots');
const now = () => Math.floor(Date.now() / 1000);

function testKey(): string {
  return encodeToken(
    { v: 1, kid: DEV.kid, lid: 'lic_e2e_protools', tier: 'pro', plan: 'annual', iat: now() - 86_400, exp: now() + 300 * 86_400, seats: 1 },
    (m) => new Uint8Array(crypto.sign(null, m, DEV_PRIVATE)),
  );
}

/** Replace the native dialog in main: it returns `paths` and records each call. */
async function stubDialog(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, picked) => {
    const g = globalThis as { __proDialogCalls?: number };
    g.__proDialogCalls = 0;
    dialog.showOpenDialog = (async () => {
      g.__proDialogCalls = (g.__proDialogCalls ?? 0) + 1;
      return { canceled: false, filePaths: picked };
    }) as typeof dialog.showOpenDialog;
  }, paths);
}
const dialogCalls = (app: ElectronApplication): Promise<number> =>
  app.evaluate(() => (globalThis as { __proDialogCalls?: number }).__proDialogCalls ?? 0);

async function activatePro(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.locator('[data-testid="tab-settings"]').click();
  await page.locator('[data-testid="pro-settings"]').scrollIntoViewIfNeeded();
  await page.locator('[data-testid="pro-key-input"]').fill(testKey());
  await page.locator('[data-testid="pro-activate"]').click();
  await expect(page.locator('[data-testid="pro-settings"]')).toHaveAttribute('data-tier', 'pro');
}

async function noPageScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight && document.body.scrollHeight <= window.innerHeight);
}

/** Every element matching `sel` lies inside the viewport. */
async function inView(page: Page, sel: string): Promise<boolean> {
  return page.evaluate((s) => {
    const els = [...document.querySelectorAll<HTMLElement>(s)];
    return els.length > 0 && els.every((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight + 0.5 && r.right <= window.innerWidth + 0.5;
    });
  }, sel);
}

test('without Pro both tools are locked, in the window AND in main; deleting hands is never locked', async () => {
  const { app, page, close } = await launchApp();
  try {
    await stubDialog(app, [FIXTURES]);
    await page.waitForSelector('[data-testid="home-screen"]');
    await page.locator('[data-testid="tab-pro"]').click();
    const gate = page.locator('[data-testid="pro-gate"]');
    await expect(gate).toHaveAttribute('data-feature', 'leak-finder');
    await expect(gate).toHaveAttribute('data-locked', 'true');
    await expect(page.locator('[data-testid="pro-hands"]')).toHaveCount(0);
    await page.locator('[data-testid="pro-view-icm"]').click();
    await expect(gate).toHaveAttribute('data-feature', 'icm-tools');
    await expect(gate).toHaveAttribute('data-locked', 'true');
    await page.locator('[data-testid="pro-gate-open"]').click();
    await expect(page.locator('[data-testid="upgrade-sheet"]')).toBeVisible();
    await page.keyboard.press('Escape');

    // Devtools: call main directly. It refuses, and never opens the dialog.
    const results = await page.evaluate(async () => ({
      imp: await window.offsuit!.proImportHands!(),
      report: await window.offsuit!.proHandsReport!(),
      shove: await window.offsuit!.proShove!({ stacks: [10, 10], button: 0, hero: 0, ante: 0, payouts: [], callers: { kind: 'equilibrium' } }),
      clear: await window.offsuit!.proClearHands!(),
    }));
    expect(results.imp).toEqual({ locked: 'leak-finder' });
    expect(results.report).toEqual({ locked: 'leak-finder' });
    expect(results.shove).toEqual({ locked: 'icm-tools' });
    expect(results.clear).toEqual({ cleared: true, total: 0 });
    expect(await dialogCalls(app)).toBe(0);
  } finally {
    await close();
  }
});

test('with a test licence: import through the dialog, read the leaks, and the import earns nothing', async () => {
  const { app, page, userDataDir, close } = await launchApp();
  // A folder of fixtures plus a file inside a temp folder that also holds a link and a non-.txt file.
  const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-hh-pick-'));
  fs.copyFileSync(path.join(FIXTURES, 'pokerstars-cash.txt'), path.join(extra, 'again.txt'));
  fs.symlinkSync('/etc/hosts', path.join(extra, 'hosts.txt'));
  fs.writeFileSync(path.join(extra, 'notes.md'), 'not a hand history');
  try {
    await activatePro(page);
    const profile = path.join(userDataDir, 'offsuit-state.json');
    const before = fs.readFileSync(profile);

    await page.locator('[data-testid="tab-pro"]').click();
    await expect(page.locator('[data-testid="pro-empty"]')).toBeVisible();
    await stubDialog(app, [FIXTURES, extra]);
    await page.locator('[data-testid="pro-import"]').click();
    const notice = page.locator('[data-testid="pro-import-notice"]');
    await expect(notice).toContainText('Added');
    await expect(notice).toContainText('already imported'); // again.txt repeats the Stars cash file
    await expect(notice).toContainText('cut off mid-hand'); // the *-partial fixtures
    await expect(notice).toContainText('a link');
    expect(await dialogCalls(app)).toBe(1);

    // The store is outside the profile, in NDJSON, and holds no opponent's name.
    const store = fs.readFileSync(path.join(userDataDir, 'hand-histories', 'hands.ndjson'), 'utf8');
    const lines = store.trim().split('\n');
    expect(lines.length).toBeGreaterThan(20);
    for (const line of lines) JSON.parse(line);
    expect(store).not.toContain('RiverRat77');

    await expect(page.locator('[data-testid="pro-spot"]')).toHaveCount(14);
    await expect(page.locator('[data-testid="pro-lede"]')).toContainText(`counted from ${lines.length} hands`);
    await expect(page.locator('[data-testid="pro-stat-hands"]')).toContainText(String(lines.length));
    // A handful of fixture hands never reaches 20 in one spot: nothing may be called a leak.
    await expect(page.locator('[data-testid="pro-spot"][data-reading="leak"]')).toHaveCount(0);
    await page.locator('[data-testid="pro-spot"]').first().click();
    await expect(page.locator('[data-testid="pro-explain"]')).not.toBeEmpty();
    expect(await page.locator('[data-testid="pro-tools-screen"]').innerText()).not.toMatch(/\$|won|profit|win rate:/i);

    // IMPORTS EARN NOTHING: the profile file is untouched by the import and the report.
    expect(fs.readFileSync(profile).equals(before)).toBe(true);
    const state = JSON.parse(before.toString('utf8')) as Record<string, unknown>;
    expect(JSON.stringify(state)).not.toContain('pokerstars');

    // A second import of the same files adds nothing.
    await page.locator('[data-testid="pro-import"]').click();
    await expect(notice).toContainText('Added 0 hands');
    expect(fs.readFileSync(path.join(userDataDir, 'hand-histories', 'hands.ndjson'), 'utf8').trim().split('\n')).toHaveLength(lines.length);

    fs.mkdirSync(SHOTS, { recursive: true });
    for (const [w, h] of [[900, 640], [1100, 760]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(150);
      expect(await noPageScroll(page), `hands ${w}x${h}: no page scroll`).toBe(true);
      expect(await inView(page, '[data-testid="pro-import"], [data-testid="pro-practise"], [data-testid="pro-spots"]'), `hands ${w}x${h}: controls in view`).toBe(true);
      await page.screenshot({ path: path.join(SHOTS, `pro-hands-${w}x${h}.png`) });
    }

    // Delete: two clicks, then the store is gone and the screen is empty again. The profile is still untouched.
    await page.locator('[data-testid="pro-clear"]').click();
    await page.locator('[data-testid="pro-clear"]').click();
    await expect(page.locator('[data-testid="pro-empty"]')).toBeVisible();
    expect(fs.existsSync(path.join(userDataDir, 'hand-histories', 'hands.ndjson'))).toBe(false);
    expect(fs.readFileSync(profile).equals(before)).toBe(true);
  } finally {
    await close();
    fs.rmSync(extra, { recursive: true, force: true });
  }
});

test('with a test licence: ICM and push-fold, priced against named callers, at both sizes', async () => {
  const { page, close } = await launchApp();
  try {
    await activatePro(page);
    await page.locator('[data-testid="tab-pro"]').click();
    await page.locator('[data-testid="pro-view-icm"]').click();
    const legend = page.locator('[data-testid="pro-chart-legend"]');
    await expect(legend).toContainText('Shove');
    // On this bubble the callers tighten so much under ICM that ICM shoves wider: no chip-EV-only hands.
    await expect(legend).not.toContainText('Chip EV only +0.0%');
    await expect(page.locator('[data-testid="pro-cell"]')).toHaveCount(169);
    await expect(page.locator('[data-testid="pro-cell"][data-combo="AA"]')).toHaveAttribute('data-kind', 'push');
    await expect(page.locator('[data-testid="pro-cell"][data-combo="72o"]')).toHaveAttribute('data-kind', 'fold');
    // Four seats; every opponent has a bubble factor above 1 on the bubble.
    await expect(page.locator('[data-testid="pro-seat"]')).toHaveCount(4);
    await expect(page.locator('[data-testid="pro-icm-note"]')).toContainText('equilibrium');
    await expect(page.locator('[data-testid="pro-icm-note"]')).toContainText('bubble factor');
    await expect(page.locator('[data-testid="pro-ev-icm"]')).toContainText('% of pool');

    // Name a different caller: the chart is recomputed against it.
    const shoveText = async (): Promise<string> => (await legend.innerText()).split('\n')[0];
    const nashShove = await shoveText();
    await page.locator('[data-testid="pro-callers-top4"]').click();
    await expect(page.locator('[data-testid="pro-icm-note"]')).toContainText('top 40%');
    await expect.poll(shoveText).not.toBe(nashShove);
    await page.locator('[data-testid="pro-callers-equilibrium"]').click();
    await expect.poll(shoveText).toBe(nashShove);

    // Chip EV view, a selected hand, a heads-up preset and an edited stack.
    await page.locator('[data-testid="pro-model-chips"]').click();
    await expect(legend).not.toContainText('Chip EV only');
    await page.locator('[data-testid="pro-cell"][data-combo="K9o"]').click();
    await expect(page.locator('[data-testid="pro-cell"][data-combo="K9o"]')).toHaveAttribute('data-selected', 'true');
    await expect(page.locator('[data-testid="pro-ev-chips"]')).toContainText('bb');
    await page.locator('[data-testid="pro-model-icm"]').click();

    fs.mkdirSync(SHOTS, { recursive: true });
    for (const [w, h] of [[900, 640], [1100, 760]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(150);
      expect(await noPageScroll(page), `icm ${w}x${h}: no page scroll`).toBe(true);
      expect(await inView(page, '[data-testid="pro-shove-grid"], [data-testid="pro-seats"], [data-testid="pro-hand"]'), `icm ${w}x${h}: in view`).toBe(true);
      await page.screenshot({ path: path.join(SHOTS, `pro-icm-${w}x${h}.png`) });
    }

    await page.locator('[data-testid="pro-preset-hu"]').click();
    await expect(page.locator('[data-testid="pro-seat"]')).toHaveCount(2);
    await page.locator('[data-testid="pro-stack"]').first().fill('3');
    await page.locator('[data-testid="pro-stack"]').first().press('Enter');
    await page.locator('[data-testid="pro-stack"]').first().blur();
    await expect(page.locator('[data-testid="pro-cell"][data-combo="K2o"]')).toHaveAttribute('data-kind', 'push');

    // Main validates what the renderer sends: a spot that cannot happen is refused, not clamped.
    const bad = await page.evaluate(() => window.offsuit!.proShove!({ stacks: [10, -1], button: 0, hero: 0, ante: 0, payouts: [], callers: { kind: 'equilibrium' } }));
    expect(bad).toEqual({ invalid: true });
  } finally {
    await close();
  }
});
