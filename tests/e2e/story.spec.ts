import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp } from './helpers.js';
import { playToShowdown, tableScreen, waitForIdle } from './flow.js';

/**
 * STORY — the Long Orbit, end to end and hidden: the map (default orbit, nothing locked), one full chapter
 * (intro → lesson dialogue → the table → the debrief), and the rival's file gaining a showdown.
 */

const map = '[data-testid="story-map"]';
const chapter = '[data-testid="story-chapter"]';
const dossier = '[data-testid="rival-dossier"]';

function freshDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-story-'));
}

async function withApp(dir: string, body: (page: Page) => Promise<void>): Promise<void> {
  const launched = await launchApp({ seed: 42, userDataDir: dir });
  try {
    await body(launched.page);
  } finally {
    await launched.close();
  }
}

async function openStory(page: Page): Promise<void> {
  await page.click('[data-testid="tab-story"]');
  await page.waitForSelector(map);
}

/** Play the chapter table passively (check, else call) until the planned hands are done. */
async function playTable(page: Page): Promise<void> {
  for (let hand = 0; hand < 12; hand++) {
    await playToShowdown(page);
    if ((await page.locator('[data-testid="story-debrief-go"]').count()) > 0) return;
    await page.click('[data-testid="next-hand"]');
  }
  throw new Error('the chapter table never offered its debrief');
}

async function fitsWithoutScroll(page: Page): Promise<void> {
  const geo = await page.evaluate(() => ({
    sh: document.documentElement.scrollHeight,
    ch: document.documentElement.clientHeight,
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(geo.sh).toBeLessThanOrEqual(geo.ch);
  expect(geo.sw).toBeLessThanOrEqual(geo.cw);
}

test.describe('Story: the Long Orbit', () => {
  test('the map: six venues on the default orbit for a new player, all masked, every one open (N1)', async () => {
    await withApp(freshDir(), async (page) => {
      // Home's strip names the suggested chapter and opens the Story.
      const strip = page.locator('[data-testid="story-strip"]');
      await expect(strip).toHaveAttribute('data-venue', 'lighthouse');
      await strip.click();
      await page.waitForSelector(map);
      await expect(page.locator(`${map}`)).toHaveAttribute('data-personalized', 'false');
      const venues = page.locator('[data-testid="story-venue"]');
      await expect(venues).toHaveCount(6);
      expect(await venues.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.venue))).toEqual([
        'lighthouse', 'diner', 'library', 'night-train', 'pier', 'observatory',
      ]);
      await expect(page.locator('[data-testid="story-venue"][data-masked="true"]')).toHaveCount(6);
      await expect(page.locator('[data-testid="story-venue"][data-next="true"]')).toHaveAttribute('data-venue', 'lighthouse');
      await expect(page.locator('[data-testid="story-next-citation"]')).toHaveAttribute('data-personalized', 'false');
      await fitsWithoutScroll(page);

      // Nothing is locked: the last venue opens straight away, at its intro.
      await page.click('[data-testid="story-venue"][data-venue="observatory"]');
      await expect(page.locator(chapter)).toHaveAttribute('data-venue', 'observatory');
      await expect(page.locator(chapter)).toHaveAttribute('data-stage', 'intro');
      await expect(page.locator('[data-testid="story-intro-line"]').first()).toBeVisible();
      await fitsWithoutScroll(page);
    });
  });

  test('one full chapter: intro, the lesson as dialogue, the table, a debrief judged on decisions', async () => {
    const dir = freshDir();
    await withApp(dir, async (page) => {
      await openStory(page);
      await page.click('[data-testid="story-continue"]');
      await expect(page.locator(chapter)).toHaveAttribute('data-stage', 'intro');
      await expect(page.locator('[data-testid="story-intro-line"]').first()).toHaveAttribute('data-line-id', /^story\.intro\.lighthouse\./);
      await page.click('[data-testid="story-primary"]');
      await expect(page.locator(chapter)).toHaveAttribute('data-stage', 'lesson');

      // A wrong answer gets a question back; the right ones walk the script.
      await page.click('[data-testid="dialogue-option"][data-option-id="with-bet"]');
      await page.click('[data-testid="dialogue-commit"]');
      await expect(page.locator('[data-testid="dee-turn"]').last()).toContainText('?');
      for (const id of ['after', 'price', 'rarely']) {
        await page.click(`[data-testid="dialogue-option"][data-option-id="${id}"]`);
        await page.click('[data-testid="dialogue-commit"]');
      }
      await expect(page.locator('[data-testid="dee-dialogue"]')).toHaveAttribute('data-done', 'true');
      await page.click('[data-testid="story-to-table"]');
      await expect(page.locator(chapter)).toHaveAttribute('data-stage', 'table');
      await expect(page.locator('[data-testid="story-goal"]')).toContainText('Chips');

      await page.click('[data-testid="story-sit"]');
      await page.waitForSelector(`${tableScreen}[data-hand-limit="6"]`);
      // Heads-up against the masked regular: the seat never shows the style label.
      await expect(page.locator('[data-testid="seat"]')).toHaveCount(2);
      await playTable(page);
      await expect(page.locator('[data-testid="seat-archetype"]')).toHaveText('Masked');
      await page.click('[data-testid="story-debrief-go"]');

      await expect(page.locator(chapter)).toHaveAttribute('data-stage', 'debrief');
      const debrief = page.locator('[data-testid="story-debrief"]');
      await expect(debrief).toHaveAttribute('data-result', /^(met|short|unjudged)$/);
      await expect(debrief).toContainText(/\d+ of \d+/);
      const result = await debrief.getAttribute('data-result');
      if (result === 'met') await expect(page.locator('[data-testid="story-unmask"]')).toContainText('Wren Holloway');
      await fitsWithoutScroll(page);
    });

    // The table is on file after a restart: the lesson beat stays done and the debrief reads the last table.
    await withApp(dir, async (page) => {
      await openStory(page);
      await page.click('[data-testid="story-venue"][data-venue="lighthouse"]');
      await expect(page.locator('[data-testid="story-beat"][data-beat="lesson"]')).toHaveAttribute('data-done', 'true');
      await page.click('[data-testid="story-beat"][data-beat="debrief"]');
      await expect(page.locator('[data-testid="story-debrief"]')).toBeVisible();
    });
  });

  test('the rival’s file gains a showdown, and only the reads it has earned', async () => {
    const dir = freshDir();
    let hands = 0;
    await withApp(dir, async (page) => {
      await openStory(page);
      await page.click('[data-testid="story-venue"][data-venue="library"]');
      await page.click('[data-testid="story-open-file"]');
      await expect(page.locator(dossier)).toHaveAttribute('data-masked', 'true');
      await expect(page.locator('[data-testid="dossier-showdowns"]')).toContainText('0');
      await expect(page.locator('[data-testid="dossier-read"][data-earned="true"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="dossier-take"]')).toContainText('Nothing earned yet');
      await fitsWithoutScroll(page);

      // Passive hands until one reaches a showdown (both hands live at the end; a preflop fold shows nothing).
      await page.click('[data-testid="dossier-chapter"]');
      await page.click('[data-testid="story-beat"][data-beat="table"]');
      await page.click('[data-testid="story-sit"]');
      await page.waitForSelector(`${tableScreen}[data-hand-limit="6"]`);
      for (hands = 1; hands <= 5; hands++) {
        await playToShowdown(page);
        expect(await waitForIdle(page)).toBe('handover');
        if ((await page.locator('[data-testid="seat"][data-folded="true"]').count()) === 0) break;
        await page.click('[data-testid="next-hand"]');
      }
      expect(hands).toBeLessThanOrEqual(5);

      // D17: the chapter table never shows under Play. Leaving the Story tab leaves the table; the chapter picks up there.
      // Play is where the tables live since the 7-tab nav, so that is the section D17 must keep it out of.
      await page.click('[data-testid="tab-play"]');
      await expect(page.locator('[data-testid="play-screen"]')).toBeVisible();
      await expect(page.locator(tableScreen)).toHaveCount(0);
      await page.click('[data-testid="tab-story"]');
      await expect(page.locator(chapter)).toHaveAttribute('data-stage', 'table');
    });

    // Leaving mid-table keeps the hand that was played; the file shows it after a restart.
    await withApp(dir, async (page) => {
      await openStory(page);
      await page.click('[data-testid="story-venue"][data-venue="library"]');
      await page.click('[data-testid="story-open-file"]');
      await expect(page.locator('[data-testid="dossier-hands"]')).toContainText(String(hands));
      await expect(page.locator('[data-testid="dossier-showdowns"]')).toContainText('1');
      await expect(page.locator('[data-testid="dossier-hand"]')).toHaveCount(1);
      // One showdown is not a read yet: every tile still says how many more it needs.
      await expect(page.locator('[data-testid="dossier-read"][data-earned="true"]')).toHaveCount(0);
    });
  });
});
