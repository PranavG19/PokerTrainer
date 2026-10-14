import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp } from './helpers.js';
import { SCENARIOS } from '../../src/core/puzzleScenarios.js';

/**
 * THE HABIT LOOP (MVP B2, PR 1): Home's greeting, the streak and today's ring, Today's Ticket, the Folio and
 * onboarding, driven through the real app on the e2e test clock (OFFSUIT_NOW, core/testHooks.ts). Time travel is
 * a relaunch on the same profile with a later clock.
 */

const STATE = 'offsuit-state.json';
const MS_PER_DAY = 86_400_000;
/** Monday 12 October 2026, 8 pm on this machine's clock (the app reads the same timezone). */
const MON_8PM = new Date(2026, 9, 12, 20, 0, 0).getTime();

const freshDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-habit-'));
const readState = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, STATE), 'utf-8')) as Record<string, any>;

async function open(at: number, dir: string, env: Record<string, string> = {}) {
  const app = await launchApp({ userDataDir: dir, env: { OFFSUIT_NOW: String(at), ...env } });
  await app.page.waitForSelector('[data-testid="home-screen"], [data-testid="onboarding"]');
  return app;
}

async function noPageScroll(page: Page): Promise<void> {
  const [sh, ih, sw, iw] = await page.evaluate(() => [
    document.documentElement.scrollHeight,
    window.innerHeight,
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(sh).toBeLessThanOrEqual(ih);
  expect(sw).toBeLessThanOrEqual(iw);
}

async function size(app: Awaited<ReturnType<typeof launchApp>>, w: number, h: number): Promise<void> {
  await app.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]);
  await app.page.waitForFunction(([w, h]) => window.innerWidth === w && window.innerHeight === h, [w, h]);
}

/** Play one puzzle scenario to its end along its target line (Spots opens on it from the Ticket). */
async function playSpot(page: Page, id: string): Promise<void> {
  const root = page.locator('[data-testid="puzzle-screen"]');
  await expect(root).toHaveAttribute('data-scenario', id);
  const s = SCENARIOS.find((x) => x.id === id)!;
  for (let i = 0; i < s.target.length; i++) {
    if ((await root.getAttribute('data-phase')) === 'classify') {
      await page.locator('[data-testid="puzzle-classify-rfi"]').click();
      await page.locator('[data-testid="puzzle-classify-continue"]').click();
    }
    await expect(root).toHaveAttribute('data-phase', 'acting');
    const action = s.target[i].action === 'allin' ? 'raise' : s.target[i].action;
    await page.locator(`[data-testid="puzzle-${action}"]`).click();
    await expect(root).toHaveAttribute('data-phase', 'graded');
    await page.locator('[data-testid="puzzle-continue"]').click();
  }
  await expect(root).toHaveAttribute('data-phase', 'complete');
}

/** Answer ten perception items in whichever drill the Ticket named. */
async function playDrill(page: Page, ref: string): Promise<void> {
  if (ref === 'board') {
    const drill = page.locator('[data-testid="board-reading-drill"]');
    for (let i = 1; i <= 10; i++) {
      await page.keyboard.press('1');
      await expect(drill).toHaveAttribute('data-answered', String(i));
    }
    return;
  }
  const root = page.locator('[data-testid="anomaly-screen"]');
  for (let i = 0; i < 10; i++) {
    await expect(root).toHaveAttribute('data-phase', 'answer');
    await page.keyboard.press('y');
    await expect(root).toHaveAttribute('data-phase', 'graded');
    await page.keyboard.press('Enter');
  }
}

async function openTicket(page: Page): Promise<void> {
  await page.locator('[data-testid="tab-play"]').click();
  await page.locator('[data-testid="home-ticket"]').click();
  await page.locator('[data-testid="ticket-screen"]').waitFor();
}

test.describe('the habit loop', () => {
  test('1. a fresh profile: Dee greets, the streak is 0, the ring is open, the Ticket is waiting; no page scroll', async () => {
    const dir = freshDir();
    const app = await open(MON_8PM, dir);
    const { page } = app;
    try {
      await expect(page.locator('[data-testid="home-greeting"]')).toHaveAttribute('data-moment', 'first');
      await expect(page.locator('[data-testid="home-greeting-line"]')).toContainText('Evening.');
      await expect(page.locator('[data-testid="home-streak-count"]')).toHaveText('0');
      await expect(page.locator('[data-testid="home-streak-note"]')).toHaveText('Finish one session and your streak starts at 1.');
      await expect(page.locator('[data-testid="home-ring"]')).toHaveAttribute('data-closed', '0');
      await expect(page.locator('[data-testid="home-ticket"]')).toContainText('0/4');
      // The colour role map: the streak and the ring are bone light, never mint.
      const dot = await page.locator('[data-testid="home-streak-week"] .habit-dot').first().evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(dot).not.toBe('rgb(61, 220, 151)');
      for (const [w, h] of [[900, 640], [1100, 760]]) {
        await size(app, w, h);
        await noPageScroll(page);
      }
      // Opening the app wrote nothing: the Ticket is frozen by the first real save, not by a look at Home.
      expect(fs.existsSync(path.join(dir, STATE))).toBe(false);
    } finally {
      await app.close();
    }
  });

  test('2. the Ticket, worked through the real screens, counts the day; time travel carries and resets the streak', async () => {
    test.setTimeout(180_000);
    const dir = freshDir();
    let app = await open(MON_8PM, dir);
    try {
      const { page } = app;
      await openTicket(page);
      const items = page.locator('[data-testid="ticket-item"]');
      await expect(items).toHaveCount(4);
      const refs = await items.evaluateAll((els) => els.map((e) => ({ kind: (e as HTMLElement).dataset.kind!, ref: (e as HTMLElement).dataset.ref! })));
      expect(refs.map((r) => r.kind)).toEqual(['drill', 'spot', 'spot', 'spot']);
      for (const [i, item] of refs.entries()) {
        await openTicket(page);
        await page.locator('[data-testid="ticket-item"]').nth(i).click();
        if (item.kind === 'spot') await playSpot(page, item.ref);
        else await playDrill(page, item.ref);
      }
      await openTicket(page);
      await expect(page.locator('[data-testid="ticket-screen"]')).toHaveAttribute('data-finished', 'true');
      await page.locator('[data-testid="ticket-back"]').click();
      await expect(page.locator('[data-testid="home-streak-count"]')).toHaveText('1');
      await expect(page.locator('[data-testid="home-streak-note"]')).toHaveText('Today counts. Days turn over at 4 am.');
      await expect(page.locator('[data-testid="home-greeting"]')).toHaveAttribute('data-moment', 'done');
      await expect(page.locator('[data-testid="dee-perch"]')).toHaveAttribute('aria-label', /1-day streak/);
      const saved = readState(dir).progression;
      expect(saved.tallies.ticketsFinished).toBe(1);
      expect(saved.reps.total).toBeGreaterThan(0);
      expect(saved.milestones.achieved['ticket-first']).toBeTruthy();
    } finally {
      await app.close();
    }

    // 3 am Tuesday is still Monday's practice day (the day turns at 4 am).
    app = await open(MON_8PM + 7 * 3_600_000, dir);
    try {
      await expect(app.page.locator('[data-testid="home-streak-note"]')).toHaveText('Today counts. Days turn over at 4 am.');
    } finally {
      await app.close();
    }

    // Tuesday evening: yesterday counted, today not yet; the copy says what one session makes it, never a loss.
    app = await open(MON_8PM + MS_PER_DAY, dir);
    try {
      await expect(app.page.locator('[data-testid="home-streak-count"]')).toHaveText('1');
      await expect(app.page.locator('[data-testid="home-streak-note"]')).toHaveText('Finish one session and your streak goes to 2.');
      await expect(app.page.locator('[data-testid="home-ticket"]')).toContainText('0/');
    } finally {
      await app.close();
    }

    // Thursday: Wednesday was missed, so the classic streak reads 0. No freeze covers it; the best is kept.
    app = await open(MON_8PM + 3 * MS_PER_DAY, dir);
    try {
      await expect(app.page.locator('[data-testid="home-streak-count"]')).toHaveText('0');
      await expect(app.page.locator('[data-testid="home-streak-best"]')).toHaveText('Best: 1');
    } finally {
      await app.close();
    }
  });

  test('3. the Folio: a rule written days ago is tarnished; "Still true" re-polishes it, and that survives a relaunch', async () => {
    const dir = freshDir();
    const writtenDay = Math.floor((MON_8PM - 3 * MS_PER_DAY) / MS_PER_DAY);
    fs.writeFileSync(
      path.join(dir, STATE),
      JSON.stringify({
        schemaVersion: 2,
        progression: {
          dee: { ruleSentences: [{ conceptId: 'pot-odds-as-a-price', text: 'the price is the call over the pot after I call', day: writtenDay }] },
        },
      }),
    );
    let app = await open(MON_8PM, dir);
    try {
      const { page } = app;
      await page.locator('[data-testid="tab-learn"]').click();
      await expect(page.locator('[data-testid="open-folio"]')).toContainText('1 to re-polish');
      await page.locator('[data-testid="open-folio"]').click();
      const card = page.locator('[data-testid="folio-card"]');
      await expect(card).toHaveCount(1);
      await expect(card).toHaveAttribute('data-tarnished', 'true');
      await expect(card).toContainText('the price is the call over the pot after I call');
      await page.locator('[data-testid="folio-polish"]').click();
      await expect(card).toHaveAttribute('data-tarnished', 'false');
      await page.locator('[data-testid="folio-sheet-toggle"]').click();
      await expect(page.locator('[data-testid="folio-sheet"]')).toContainText('the price is the call over the pot after I call');
    } finally {
      await app.close();
    }
    app = await open(MON_8PM + 3_600_000, dir);
    try {
      await app.page.locator('[data-testid="tab-learn"]').click();
      await expect(app.page.locator('[data-testid="open-folio"]')).toContainText('Rulebook · 1');
    } finally {
      await app.close();
    }
  });

  test('4. onboarding: five sheets, Skip on each, nothing locked behind it, answers saved once', async () => {
    const dir = freshDir();
    let app = await open(MON_8PM, dir, { OFFSUIT_E2E_ONBOARDING: '1' });
    try {
      const { page } = app;
      await expect(page.locator('[data-testid="onboarding"]')).toBeVisible();
      // Nothing is locked: every tab opens with the sheet up, and Play brings the sheet back.
      await page.locator('[data-testid="tab-learn"]').click();
      await expect(page.locator('[data-testid="lesson-screen"]')).toBeVisible();
      await page.locator('[data-testid="tab-play"]').click();
      await expect(page.locator('[data-testid="onboarding-step"]')).toHaveText('Step 1 of 5');
      for (const [w, h] of [[900, 640], [1100, 760]]) {
        await size(app, w, h);
        await noPageScroll(page);
      }
      await page.locator('[data-testid="onboarding-name"]').fill('Sam');
      await page.locator('[data-testid="onboarding-next"]').click();
      await page.locator('[data-testid="onboarding-format"] [data-value="home"]').click();
      await expect(page.locator('[data-testid="onboarding-format"] [data-value="home"]')).toHaveAttribute('aria-pressed', 'true');
      for (let step = 2; step <= 4; step++) {
        await expect(page.locator('[data-testid="onboarding-skip"]')).toBeVisible();
        await page.locator('[data-testid="onboarding-next"]').click();
      }
      await expect(page.locator('[data-testid="onboarding-step"]')).toHaveText('Step 5 of 5');
      await page.locator('[data-testid="onboarding-tone"] [data-value="dry"]').click();
      expect(fs.existsSync(path.join(dir, STATE))).toBe(false);
      await page.locator('[data-testid="onboarding-skip"]').click();
      await expect(page.locator('[data-testid="home-greeting-line"]')).toContainText('Evening, Sam.');
      const p = readState(dir).progression;
      expect(p.personalization.displayName).toBe('Sam');
      expect(p.personalization.format).toBe('home');
      expect(p.personalization.answeredOn).not.toBeNull();
      expect(p.dee.personality.tone).toBe('dry');
    } finally {
      await app.close();
    }
    // Answered once: it does not come back by itself.
    app = await open(MON_8PM + 3_600_000, dir, { OFFSUIT_E2E_ONBOARDING: '1' });
    try {
      await expect(app.page.locator('[data-testid="home-screen"]')).toBeVisible();
      await expect(app.page.locator('[data-testid="onboarding"]')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
});
