import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { launchApp } from './helpers.js';
import { checkOrCall, signedIn, startTestServer, type Player, type TestServer } from '../unit/onlineHarness.js';
import type { RoomInfo } from '../../src/core/online/protocol.js';

/**
 * PLAY ONLINE — the real app against a real Offsuit server on loopback (self-signed, pinned), with a
 * headless opponent running the app's own OnlineSession. The window stays hidden (helpers.ts).
 */

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SHOTS = path.join(ROOT, 'evidence', 'online');

let online: TestServer;
let opponents: Player[] = [];

test.beforeEach(async () => {
  online = await startTestServer({ timing: { turnMs: 30_000, nextHandMs: 1_500 } });
});
test.afterEach(async () => {
  for (const p of opponents) p.close();
  opponents = [];
  await online.close();
});

async function openOnline(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.locator('[data-testid="play-with-friends"]').click();
  await page.locator('[data-testid="mp-play-online"]').click();
  await page.waitForSelector('[data-testid="online-screen"][data-online-phase="setup"]');
}

async function goOnline(page: Page): Promise<void> {
  await page.locator('[data-testid="online-enable"]').click();
  await page.locator('[data-testid="online-server"]').fill(`127.0.0.1:${online.server.port}`);
  await page.locator('[data-testid="online-server"]').blur();
  await page.locator('[data-testid="online-pin"]').fill(online.target.pin!);
  await page.locator('[data-testid="online-pin"]').blur();
  await page.locator('[data-testid="online-name"]').fill('Ada');
  await page.locator('[data-testid="online-adult"]').check();
  await page.locator('[data-testid="online-connect"]').click();
  await page.waitForSelector('[data-testid="online-screen"][data-online-phase="lobby"]', { timeout: 15_000 });
}

async function shoot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const [w, h] of [[900, 640], [1100, 760]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    const scroll = await page.evaluate(() => document.scrollingElement!.scrollHeight - window.innerHeight);
    expect(scroll, `${name} scrolls at ${w}x${h}`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: path.join(SHOTS, `online-${name}-${w}x${h}.png`) });
  }
}

test('setup refuses to go online without the 18+ confirmation, and nothing is contacted', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  try {
    await openOnline(page);
    await shoot(page, 'setup');
    await page.locator('[data-testid="online-enable"]').click();
    await page.locator('[data-testid="online-server"]').fill(`127.0.0.1:${online.server.port}`);
    await page.locator('[data-testid="online-server"]').blur();
    await page.locator('[data-testid="online-pin"]').fill(online.target.pin!);
    await page.locator('[data-testid="online-pin"]').blur();
    await page.locator('[data-testid="online-name"]').fill('Ada');
    await page.locator('[data-testid="online-connect"]').click();
    await expect(page.locator('[data-testid="online-notice"]')).toContainText(/18/);
    expect(online.server.stats().connections).toBe(0);
  } finally {
    await close();
  }
});

test('go online, open a ranked table, an opponent joins by code, and a hand is played with redacted cards', async () => {
  const { page, close } = await launchApp({ seed: 7, env: { OFFSUIT_DEV_TIER: 'pro' } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await openOnline(page);
    await goOnline(page);
    await shoot(page, 'lobby');

    await page.locator('[data-testid="online-ranked"]').click();
    await page.locator('[data-testid="online-create"]').click();
    await page.waitForSelector('[data-testid="online-screen"][data-online-phase="table"]');
    const code = (await page.locator('[data-testid="online-room-code"]').textContent())!.trim();
    expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);

    const bo = await signedIn(online, 'Bo');
    opponents.push(bo);
    const room = (await bo.request('room-join', { code })) as RoomInfo;
    expect(room.ranked).toBe(true);
    bo.strategy = checkOrCall;

    await page.waitForSelector('[data-testid="mp-table"]', { timeout: 15_000 });
    // Own cards face up, the opponent's face down: the server's redaction, made visible.
    const you = page.locator('[data-testid="mp-seat"][data-you="true"]');
    await expect(you.locator('.card')).toHaveCount(2);
    await expect(you.locator('.card-back')).toHaveCount(0);
    const them = page.locator('[data-testid="mp-seat"][data-you="false"]');
    await expect(them.locator('.card-back')).toHaveCount(2);
    await expect(them.locator('.card')).toHaveCount(0);
    await shoot(page, 'table');

    // Play the hand out with check/call.
    for (let i = 0; i < 12; i += 1) {
      const settled = await page.locator('[data-testid="mp-seat"]').first().evaluate(() => document.body.textContent?.includes('Next hand') ?? false);
      if (settled) break;
      for (const kind of ['check', 'call']) {
        const button = page.locator(`[data-testid="mp-${kind}"]`);
        if (await button.isEnabled().catch(() => false)) {
          await button.click();
          break;
        }
      }
      await page.waitForTimeout(300);
    }
    await expect.poll(async () => (await bo.waitView((v) => v.handNumber >= 2, 20_000)).handNumber).toBeGreaterThanOrEqual(2);

    // The ladder and season tabs answer from the server.
    await page.locator('[data-testid="online-leave"]').click();
    await page.waitForSelector('[data-testid="online-screen"][data-online-phase="lobby"]');
    await page.locator('[data-testid="online-tab-season"]').click();
    await expect(page.locator('[data-testid="online-season"]')).toContainText(/Calibrating|decisions/);
    await shoot(page, 'season');
    await page.locator('[data-testid="online-tab-ladder"]').click();
    await expect(page.locator('[data-testid="online-ladder"]')).toContainText(/rated|bb lost/);
    await shoot(page, 'ladder');
    await page.locator('[data-testid="online-tab-leagues"]').click();
    await page.locator('[data-testid="online-league-name"]').fill('Thursday');
    await page.locator('[data-testid="online-league-create"]').click();
    await expect(page.locator('[data-testid="online-league-board"]')).toBeVisible();
    await shoot(page, 'leagues');
    expect(errors).toEqual([]);
  } finally {
    await close();
  }
});

test('without Pro, ranked tables are locked with an honest caption and unranked play still opens', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  try {
    await openOnline(page);
    await goOnline(page);
    await expect(page.locator('[data-testid="online-ranked-pro"]')).toContainText('Ranked play is part of Offsuit Pro');
    await expect(page.locator('[data-testid="online-ranked"]')).toBeDisabled();
    await page.locator('[data-testid="online-create"]').click();
    await page.waitForSelector('[data-testid="online-screen"][data-online-phase="table"]');
    await expect(page.locator('[data-testid="online-room-ranked"]')).toHaveAttribute('data-ranked', 'false');
  } finally {
    await close();
  }
});

