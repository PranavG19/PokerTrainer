import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { launchApp, shot } from './helpers.js';

/**
 * Schema v2 end to end: a v1 profile is upgraded with a kept original, a newer profile opens read-only
 * and is never written, progression and unknown keys survive a relaunch, and a second copy of the app
 * on the same profile exits instead of racing the first.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STATE = 'offsuit-state.json';
const soundToggle = '[data-testid="sound-cues-toggle"]';
const banner = '[data-testid="read-only-banner"]';

function freshDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-schema-'));
}

const statePath = (dir: string) => path.join(dir, STATE);
const readState = (dir: string) => JSON.parse(fs.readFileSync(statePath(dir), 'utf-8')) as Record<string, unknown>;

/** A profile as a pre-v2 build wrote it, plus one key from "the future". */
function v1Text(): string {
  return JSON.stringify(
    {
      bankroll: 8740,
      hands: [],
      rebuys: 2,
      stats: { handsPlayed: 37, vpipHands: 9, pfrHands: 5, evLossBb: 12.5, leaks: {}, leakCostBb: {} },
      soundCues: false,
      futureFeature: { kept: true },
    },
    null,
    2,
  );
}

/** Flip a setting that the renderer persists, which is the simplest way to make the app save. */
async function causeASave(page: Page): Promise<void> {
  await page.click('[data-testid="tab-settings"]');
  await page.click(soundToggle);
}

async function noPageScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return el.scrollHeight <= window.innerHeight && el.scrollWidth <= window.innerWidth;
  });
}

async function viewport(app: ElectronApplication, page: Page, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height), {
    width,
    height,
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await page.waitForFunction((w) => window.innerWidth === w.width && window.innerHeight === w.height, { width, height });
}

test('a v1 profile is upgraded: original kept as .pre-v2, v1 fields and unknown keys intact', async () => {
  const dir = freshDir();
  const original = v1Text();
  fs.writeFileSync(statePath(dir), original);
  const { app, page, close } = await launchApp({ userDataDir: dir });
  try {
    await expect(page.locator('[data-testid="bankroll"]')).toHaveText('8740');
    expect(fs.readFileSync(path.join(dir, `${STATE}.pre-v2`), 'utf-8')).toBe(original);

    await causeASave(page);
    await expect.poll(() => readState(dir).schemaVersion).toBe(2);
    const saved = readState(dir);
    const before = JSON.parse(original) as Record<string, unknown>;
    expect(saved.bankroll).toBe(before.bankroll);
    expect(saved.rebuys).toBe(before.rebuys);
    expect(saved.stats).toEqual(before.stats);
    expect(saved.futureFeature).toEqual({ kept: true });
    expect(typeof saved.progression).toBe('object');

    await expect(page.locator('[data-testid="migration-notice"]')).toBeVisible();
    await expect(page.locator(banner)).toBeHidden();
    void app;
  } finally {
    await close();
  }
});

test('a newer profile opens read-only with a banner, and nothing is ever written', async () => {
  const dir = freshDir();
  const newer = JSON.stringify({ schemaVersion: 99, bankroll: 5000, hands: [], stats: {}, progression: { v99: true } });
  fs.writeFileSync(statePath(dir), newer);
  const { app, page, close } = await launchApp({ userDataDir: dir });
  try {
    await expect(page.locator(banner)).toBeVisible();
    await expect(page.locator(banner)).toContainText('newer Offsuit');
    await expect(page.locator('[data-testid="bankroll"]')).toHaveText('5000');

    await causeASave(page);
    await expect(page.locator(soundToggle)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-testid="read-only-notice"]')).toContainText('format 99');
    // Give any save a real chance to land, then prove none did.
    await page.click(soundToggle);
    await page.waitForTimeout(1000);
    expect(fs.readFileSync(statePath(dir), 'utf-8')).toBe(newer);
    expect(fs.readdirSync(dir).filter((n) => n.startsWith(STATE))).toEqual([STATE]);

    for (const [w, h] of [
      [900, 640],
      [1100, 760],
    ] as const) {
      await viewport(app, page, w, h);
      await expect(page.locator(banner)).toBeVisible();
      expect(await noPageScroll(page)).toBe(true);
      await shot(page, `profile-read-only-settings-${w}x${h}`);
      await page.click('[data-testid="tab-play"]');
      expect(await noPageScroll(page)).toBe(true);
      await shot(page, `profile-read-only-home-${w}x${h}`);
      await page.click('[data-testid="tab-settings"]');
    }
  } finally {
    await close();
  }
});

test('progression and unknown keys survive a save and a relaunch', async () => {
  const dir = freshDir();
  fs.writeFileSync(
    statePath(dir),
    JSON.stringify({
      schemaVersion: 2,
      bankroll: 9100,
      hands: [],
      stats: {},
      progression: {
        streak: { current: 2, best: 9, lastCountedDay: 20371, countedDays: [20370, 20371] },
        personalization: { displayName: 'Sam', goals: ['home-game'] },
        cosmetics: { owned: ['felt-chalkboard'], equipped: { felt: 'felt-chalkboard' } },
        quests: [{ id: 'from-a-newer-v2-build' }],
      },
    }),
  );
  let launched = await launchApp({ userDataDir: dir });
  try {
    await causeASave(launched.page);
    await expect.poll(() => (readState(dir).soundCues as boolean) === true).toBe(true);
  } finally {
    await launched.close();
  }
  launched = await launchApp({ userDataDir: dir });
  try {
    await causeASave(launched.page);
    await expect.poll(() => readState(dir).soundCues).toBe(false);
    const p = readState(dir).progression as Record<string, Record<string, unknown>>;
    expect(p.streak).toEqual({ boundaryHour: 4, current: 2, best: 9, lastCountedDay: 20371, countedDays: [20370, 20371] });
    expect(p.personalization.displayName).toBe('Sam');
    expect(p.cosmetics.equipped).toEqual({ felt: 'felt-chalkboard' });
    expect(p.quests).toEqual([{ id: 'from-a-newer-v2-build' }]);
  } finally {
    await launched.close();
  }
});

test('a second copy on the same profile exits at once and the first keeps saving', async () => {
  const dir = freshDir();
  const first = await launchApp({ userDataDir: dir });
  try {
    await expect(first.page.locator('[data-testid="bankroll"]')).toBeVisible();
    const env: NodeJS.ProcessEnv = { ...process.env, OFFSUIT_E2E: '1', OFFSUIT_E2E_HIDDEN: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    const second = spawn(
      electronPath as unknown as string,
      [path.join(ROOT, 'dist/main/main.js'), `--user-data-dir=${dir}`, '--no-sandbox'],
      { cwd: ROOT, env, stdio: 'ignore' },
    );
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        second.kill('SIGKILL');
        reject(new Error('the second instance did not exit within 15s'));
      }, 15_000);
      second.on('exit', (c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
    expect(code).toBe(0);

    await causeASave(first.page);
    await expect.poll(() => readState(dir).soundCues).toBe(true);
  } finally {
    await first.close();
  }
});
