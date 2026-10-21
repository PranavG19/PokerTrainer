import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { launchApp, shot, type LaunchedApp } from './helpers.js';
import { encodeChallenge } from '../../src/core/challengeCode.js';
import { readOracle } from '../../src/main/netOracle.js';

/**
 * LAN CLUB — through the real app. A standing group of friends and the notebook of challenge codes they hand each
 * other: a hand code replays the same deal, so the club reviews each other's hands by playing them. Local and
 * cooperative: no socket, no ranking, no chip count, nothing locked.
 */

async function size(app: LaunchedApp, w: number, h: number): Promise<void> {
  await app.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]);
  await app.page.waitForFunction(([w, h]) => window.innerWidth === w && window.innerHeight === h, [w, h]);
}

/** Both documented sizes, no page scroll, `mustSee` fully on screen, and a screenshot at each. */
async function bothSizes(app: LaunchedApp, name: string, mustSee: string): Promise<void> {
  for (const [w, h] of [[900, 640], [1100, 760]] as const) {
    await size(app, w, h);
    const [sh, ih, sw, iw] = await app.page.evaluate(() => [
      document.documentElement.scrollHeight,
      window.innerHeight,
      document.documentElement.scrollWidth,
      window.innerWidth,
    ]);
    expect(sh, `${name} ${w}x${h} height`).toBeLessThanOrEqual(ih);
    expect(sw, `${name} ${w}x${h} width`).toBeLessThanOrEqual(iw);
    await expect(app.page.locator(mustSee).first(), `${name} ${w}x${h}: ${mustSee} on screen`).toBeInViewport({ ratio: 1 });
    await shot(app.page, `${name}-${w}x${h}`);
  }
}

async function openClub(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.locator('[data-testid="tab-play"]').click();
  await page.locator('[data-testid="play-club"]').click();
  await page.waitForSelector('[data-testid="club-screen"]');
}

/** Back to the club through Home and Play, whatever Play shows now (a challenge table may still be up). */
async function backToClub(page: Page): Promise<void> {
  await page.locator('[data-testid="tab-home"]').click();
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.locator('[data-testid="tab-play"]').click();
  if ((await page.locator('[data-testid="play-club"]').count()) === 0) {
    // A challenge table is still up under Play: leave it from Home's launcher first.
    await page.locator('[data-testid="tab-home"]').click();
    await page.locator('[data-testid="tab-play"]').click();
  }
  await page.locator('[data-testid="play-club"]').click();
  await page.waitForSelector('[data-testid="club-screen"]');
}

async function startClub(page: Page, name = 'Thursday table'): Promise<void> {
  if ((await page.locator('[data-testid="club-screen"]').count()) === 0) await openClub(page);
  await page.locator('[data-testid="club-name"]').fill(name);
  await page.locator('[data-testid="club-start"]').click();
  await expect(page.locator('[data-testid="club-title"]')).toHaveText(name);
}

const HAND = encodeChallenge({ kind: 'hand', seed: 7, handNumber: 1, button: 2, seats: 4, depthBb: 100 });
const DRILL = encodeChallenge({ kind: 'drill', drill: 'spr', index: 3 });

test('a club starts from Play with nothing locked, opens no socket, and survives a relaunch', async () => {
  const oracle = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'club-oracle-')), 'net.jsonl');
  const app = await launchApp({ seed: 7, env: { OFFSUIT_NET_ORACLE: oracle } });
  try {
    await openClub(app.page);
    await expect(app.page.locator('[data-testid="club-screen"]')).toHaveAttribute('data-state', 'new');
    await startClub(app.page);
    await expect(app.page.locator('.club-screen .pill.primary')).toHaveCount(1);
    await expect(app.page.locator('[data-testid="club-notebook-empty"]')).toBeVisible();
    // A full roster of long names scrolls inside its column: the page still fits both sizes.
    for (let i = 0; i < 24; i += 1) {
      await app.page.locator('[data-testid="club-member-name"]').fill(`Member number ${String(i).padStart(2, '0')} long`);
      await app.page.locator('[data-testid="club-member-name"]').press('Enter');
    }
    await expect(app.page.locator('[data-testid="club-member"]')).toHaveCount(24);
    for (const [w, h] of [[900, 640], [1100, 760]] as const) {
      await size(app, w, h);
      const [sh, ih] = await app.page.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight]);
      expect(sh, `a full roster at ${w}x${h}`).toBeLessThanOrEqual(ih);
      await expect(app.page.locator('[data-testid="club-back"]')).toBeInViewport({ ratio: 1 });
    }
    // Nothing about a club is network: no listener and no connection.
    const sockets = readOracle(oracle).filter((r) => r.kind === 'listen' || (r.kind === 'connect' && !r.ipc));
    expect(sockets).toEqual([]);
    await app.close();
    const again = await launchApp({ seed: 7, userDataDir: app.userDataDir });
    try {
      await openClub(again.page);
      await expect(again.page.locator('[data-testid="club-title"]')).toHaveText('Thursday table');
    } finally {
      await again.close();
    }
  } finally {
    await app.close();
  }
});

test('a friend’s hand code goes in the notebook with a note, plays the same deal, and is marked played', async () => {
  const app = await launchApp({ seed: 7 });
  const { page } = app;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));
  try {
    await startClub(page);
    await page.locator('[data-testid="club-member-name"]').fill('Ada');
    await page.locator('[data-testid="club-member-name"]').press('Enter');
    await expect(page.locator('[data-testid="club-member"][data-name="Ada"]')).toBeVisible();

    // A mistyped code is refused with the challenge reader's reason.
    await page.locator('[data-testid="club-code"]').fill(HAND.slice(0, -1) + (HAND.endsWith('0') ? '1' : '0'));
    await expect(page.locator('[data-testid="club-reader"]')).toHaveAttribute('data-state', 'invalid');
    await expect(page.locator('[data-testid="club-code-add"]')).toBeDisabled();

    // The real code, typed loosely, from Ada, with what to talk through.
    await page.locator('[data-testid="club-code"]').fill(HAND.toLowerCase().replace(/-/g, ' '));
    await expect(page.locator('[data-testid="club-reader"]')).toHaveAttribute('data-state', 'valid');
    await page.locator('[data-testid="club-code-from"]').selectOption('Ada');
    await page.locator('[data-testid="club-code-note"]').fill('the river call');
    await page.locator('[data-testid="club-code-add"]').click();
    const entry = page.locator(`[data-testid="club-entry"][data-code="${HAND}"]`);
    await expect(entry).toContainText('From Ada');
    await expect(entry).toContainText('the river call');
    await expect(page.locator('[data-testid="club-together-friends"]')).toContainText('1');
    await bothSizes(app, 'club', '[data-testid="club-make"]');

    // Playing it deals the challenge table, as the challenge reader would; the notebook marks it played.
    await entry.locator('[data-testid="club-entry-play"]').click();
    await expect(page.locator('[data-testid="table-screen"]')).toBeVisible();
    // The hand is the challenge table's one hand; at its end, the way back is to the club.
    const done = page.locator('[data-testid="challenge-done"]');
    for (let i = 0; i < 40 && !(await done.isVisible()); i += 1) {
      const fold = page.locator('[data-testid="btn-fold"]');
      if (await fold.isEnabled().catch(() => false)) await fold.click();
      await page.waitForTimeout(150);
    }
    await expect(done).toHaveText('Back to the club');
    await done.click();
    await page.waitForSelector('[data-testid="club-screen"]');
    await expect(page.locator(`[data-testid="club-entry"][data-code="${HAND}"]`)).toHaveAttribute('data-played', 'true');
    await expect(page.locator('[data-testid="club-together-played"]')).toContainText('1');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('Make a code opens the challenge maker, and a made code goes into the club notebook', async () => {
  const app = await launchApp({ seed: 7 });
  const { page } = app;
  try {
    await startClub(page);
    await page.locator('[data-testid="club-make"]').click();
    await page.waitForSelector('[data-testid="challenge-screen"]');
    await page.locator('[data-testid="challenge-make"]').click();
    const made = (await page.locator('[data-testid="challenge-code"]').textContent()) ?? '';
    await page.locator('[data-testid="challenge-to-club"]').click();
    await expect(page.locator('[data-testid="challenge-to-club"]')).toBeDisabled();
    // Back from a code made for the club returns to the club.
    await expect(page.locator('[data-testid="challenge-back"]')).toHaveText('Back to the club');
    await page.locator('[data-testid="challenge-back"]').click();
    await page.waitForSelector('[data-testid="club-screen"]');
    await expect(page.locator(`[data-testid="club-entry"][data-code="${made}"]`)).toContainText('From You');

    await page.locator('[data-testid="club-code"]').fill(DRILL);
    await page.locator('[data-testid="club-code-add"]').click();
    await expect(page.locator('[data-testid="club-entry"]')).toHaveCount(2);
    await app.close();
    const again = await launchApp({ seed: 7, userDataDir: app.userDataDir });
    try {
      await openClub(again.page);
      await expect(again.page.locator('[data-testid="club-entry"]')).toHaveCount(2);
    } finally {
      await again.close();
    }
  } finally {
    await app.close();
  }
});

test('without a club, the challenge maker offers no notebook', async () => {
  const app = await launchApp({ seed: 7 });
  try {
    await app.page.waitForSelector('[data-testid="home-screen"]');
    await app.page.locator('[data-testid="tab-play"]').click();
    await app.page.locator('[data-testid="play-challenge"]').click();
    await app.page.locator('[data-testid="challenge-make"]').click();
    await expect(app.page.locator('[data-testid="challenge-code"]')).toBeVisible();
    await expect(app.page.locator('[data-testid="challenge-to-club"]')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
