import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, shot } from './helpers.js';
import { playToShowdown } from './flow.js';
import { systemDayKeyOf, type DayKey } from '../../src/core/localDay.js';
import { FICTIONAL_LABEL, weekOf } from '../../src/core/progression/rail.js';
import { seasonBounds } from '../../src/core/progression/season.js';

/**
 * THE GHOST RAIL AND SEASONS (2.5, 2.7), driven through the real app on the e2e test clock (OFFSUIT_NOW). Time
 * travel is a relaunch on the same profile with a later instant.
 *
 * - The league week: the board holds only the learner's own weeks and labelled fictional bots, the tier is shown,
 *   and the page carries no chip, pot or bankroll figure. Both documented sizes, no page scroll.
 * - The season: the free track, the archive of a closed season, and the finale taken in the finale week through the
 *   real assessment block, then archived after the week turns.
 */

const STATE = 'offsuit-state.json';
const freshDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-league-'));
const readState = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, STATE), 'utf-8')) as Record<string, any>;
const dayOf = systemDayKeyOf();
const MS_PER_DAY = 86_400_000;

/** Monday 14 September 2026, 8 pm local: Season 6, week 2. */
const TRACK_MON = new Date(2026, 8, 14, 20, 0, 0).getTime();
/** Tuesday 20 October 2026, 8 pm local: Season 6's finale week. */
const FINALE_TUE = new Date(2026, 9, 20, 20, 0, 0).getTime();
/** Monday 26 October 2026, 8 pm local: Season 7 has opened; Season 6 is archived. */
const NEXT_MON = new Date(2026, 9, 26, 20, 0, 0).getTime();

async function open(at: number, dir: string) {
  const app = await launchApp({ userDataDir: dir, env: { OFFSUIT_NOW: String(at) } });
  await app.page.waitForSelector('[data-testid="home-screen"]');
  return app;
}

async function size(app: Awaited<ReturnType<typeof launchApp>>, w: number, h: number): Promise<void> {
  await app.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]);
  await app.page.waitForFunction(([w, h]) => window.innerWidth === w && window.innerHeight === h, [w, h]);
}

async function noPageScroll(page: Page): Promise<void> {
  const [sh, ih, sw, iw] = await page.evaluate(() => [document.documentElement.scrollHeight, innerHeight, document.documentElement.scrollWidth, innerWidth]);
  expect(sh).toBeLessThanOrEqual(ih);
  expect(sw).toBeLessThanOrEqual(iw);
}

/** Both documented sizes: no page scroll, and a screenshot of each. */
async function bothSizes(app: Awaited<ReturnType<typeof launchApp>>, name: string): Promise<void> {
  for (const [w, h] of [[900, 640], [1100, 760]] as const) {
    await size(app, w, h);
    await noPageScroll(app.page);
    await shot(app.page, `${name}-${w}x${h}`);
  }
}

async function openTrophies(page: Page): Promise<void> {
  await page.locator('[data-testid="tab-you"]').click();
  await page.locator('[data-testid="tab-trophies"]').click();
  await expect(page.locator('[data-testid="you-trophies"]')).toBeVisible();
}

const tally = (n: number, mean: number, sd: number) => ({ n, sum: n * mean, sumSq: n * (sd * sd + mean * mean) });

/** A learner seven tiers up, four weeks of history, Seasons 4 and 5 closed and Season 6 under way. */
function seededProfile(): Record<string, unknown> {
  const thisWeek = weekOf(dayOf(TRACK_MON));
  const w = (ago: number) => (thisWeek - 7 * ago) as DayKey;
  const tiers = ['deuce', 'three', 'four', 'five', 'six', 'seven'];
  const block = (season: number, offset: number, n: number, mean: number) => ({
    at: (seasonBounds(season).start + offset) * MS_PER_DAY + 20 * 3_600_000,
    loss: tally(n, mean, 1.6),
    grader: 1,
  });
  return {
    schemaVersion: 2,
    progression: {
      rail: {
        tier: 'seven',
        weeks: [
          { week: w(5), loss: tally(61, 2.2, 1.4), reps: 1320, grader: 1, mixed: false, outcome: 'up' },
          { week: w(4), loss: tally(48, 2.6, 1.9), reps: 980, grader: 1, mixed: false, outcome: 'held' },
          { week: w(3), loss: tally(22, 1.9, 1.2), reps: 410, grader: 1, mixed: false, outcome: 'unrated' },
          { week: w(2), loss: tally(74, 1.7, 1.1), reps: 1650, grader: 1, mixed: false, outcome: 'up' },
          { week: w(1), loss: tally(57, 2.4, 1.6), reps: 1210, grader: 1, mixed: false, outcome: 'held' },
          { week: w(0), loss: tally(46, 1.8, 1.2), reps: 860, grader: 1, mixed: false, outcome: null },
        ],
        promotions: tiers.slice(1).map((to, i) => ({ week: w(12 - 2 * i), from: tiers[i], to })),
      },
      seasons: {
        records: [
          { season: 4, reps: 2950, grader: 1, baseline: block(4, 2, 30, 2.9), finale: block(4, 44, 30, 2.7) },
          { season: 5, reps: 5720, grader: 1, baseline: block(5, 1, 30, 2.8), finale: block(5, 43, 30, 1.4) },
          { season: 6, reps: 1340, grader: 1, baseline: block(6, 1, 30, 2.1), finale: null },
        ],
      },
    },
  };
}

test('the league week: own weeks and labelled fictional bots only, a tier, decisions never chips', async () => {
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, STATE), JSON.stringify(seededProfile()));
  const app = await open(TRACK_MON, dir);
  try {
    const { page } = app;
    await openTrophies(page);
    await expect(page.locator('[data-testid="trophy-rail"]')).toContainText('Seven tier');
    await expect(page.locator('[data-testid="trophy-season"]')).toContainText('Season 6 · week 2 of 7');
    await page.locator('[data-testid="trophy-rail"]').click();
    const screen = page.locator('[data-testid="rail-screen"]');
    await expect(screen).toBeVisible();
    await expect(page.locator('[data-testid="rail-tier"]')).toHaveText('Seven');
    await expect(page.locator('[data-testid="you-nav"] [data-testid="tab-trophies"]')).toHaveAttribute('aria-current', 'page');
    // The board: this week, four ghost weeks, three bots, every bot labelled fictional.
    const rows = page.locator('[data-testid="rail-row"]');
    await expect(rows).toHaveCount(1 + 4 + 3);
    await expect(page.locator('[data-testid="rail-row"][data-kind="ghost"]')).toHaveCount(4);
    const bots = page.locator('[data-testid="rail-row"][data-kind="bot"]');
    await expect(bots).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(bots.nth(i).locator('[data-testid="rail-fictional"]')).toContainText(FICTIONAL_LABEL);
    for (const name of await page.locator('[data-testid="rail-row"]:not([data-kind="bot"]) .league-row-name').allInnerTexts()) expect(name).toMatch(/^You/);
    await expect(page.locator('[data-testid="rail-number"]')).toHaveText('180');
    await expect(page.locator('[data-testid="rail-pace"]')).toContainText('No one moves down');
    await expect(page.locator('[data-testid="rail-ladder"] [aria-current="step"]')).toHaveText('Seven');
    const text = (await screen.innerText()).toLowerCase();
    expect(text).not.toMatch(/bankroll|\bpots?\b|\bwon\b|\$|\d[\d,]*\s*chips/);
    await bothSizes(app, 'league-week');

    // The season: the track, then the archive.
    await openTrophies(page);
    await page.locator('[data-testid="trophy-season"]').click();
    await expect(page.locator('[data-testid="season-screen"]')).toHaveAttribute('data-pane', 'track');
    await expect(page.locator('[data-testid="season-name"]')).toHaveText('Season 6');
    await expect(page.locator('[data-testid="season-reps"]')).toHaveText('1340');
    await expect(page.locator('[data-testid="season-stamp"][data-reached="true"]')).toHaveCount(4);
    await bothSizes(app, 'season-track');
    await page.locator('[data-testid="season-pane-archive"]').click();
    const archived = page.locator('[data-testid="season-archived"]');
    await expect(archived).toHaveCount(2);
    await expect(archived.first()).toHaveAttribute('data-season', '5');
    await expect(archived.first()).toContainText('10 of 10 stamps');
    await expect(archived.first()).toContainText('fewer lost at the finale');
    await bothSizes(app, 'season-archive');
    // Nothing on either page is for sale.
    expect((await page.locator('[data-testid="season-screen"]').innerText()).toLowerCase()).not.toMatch(/\b(buy|bought|purchase|sale|price)\b|\$/);
  } finally {
    await app.close();
  }
});

/** Play the assessment block to its reveal with the first legal action each spot. */
async function playBlock(page: Page): Promise<void> {
  const root = page.locator('[data-testid="assessment-screen"]');
  for (let guard = 0; guard < 400 && (await root.getAttribute('data-phase')) !== 'reveal'; guard++) {
    for (const id of ['assessment-check', 'assessment-call', 'assessment-fold']) {
      const b = page.locator(`[data-testid="${id}"]`);
      if ((await b.count()) > 0 && (await b.isEnabled())) {
        await b.click();
        break;
      }
    }
  }
  await expect(root).toHaveAttribute('data-phase', 'reveal');
}

test('time travel: real hands reach the Rail through the ledger; the finale is taken in its week, then archived', async () => {
  test.setTimeout(180_000);
  const dir = freshDir();
  let app = await open(FINALE_TUE, dir);
  try {
    const { page } = app;
    await openTrophies(page);
    await page.locator('[data-testid="trophy-rail"]').click();
    await expect(page.locator('[data-testid="rail-band"]')).toHaveText('No scored decisions yet this week');
    // A real hand from the Rail's own button.
    await page.locator('[data-testid="rail-play"]').click();
    await page.waitForSelector('[data-testid="table-screen"][data-awaiting="hero"]');
    await playToShowdown(page);
    await expect.poll(() => readState(dir).progression?.rail?.weeks?.[0]?.reps ?? 0).toBeGreaterThan(0);
    const week = readState(dir).progression.rail.weeks[0];
    expect(week.week).toBe(weekOf(dayOf(FINALE_TUE)));
    expect(readState(dir).progression.seasons.records[0]).toMatchObject({ season: 6, reps: week.reps });

    // The finale week: the Season opens on the finale, which is open to take.
    await openTrophies(page);
    await expect(page.locator('[data-testid="trophy-season"]')).toContainText('the finale is open');
    await page.locator('[data-testid="trophy-season"]').click();
    await expect(page.locator('[data-testid="season-screen"]')).toHaveAttribute('data-pane', 'finale');
    await expect(page.locator('[data-testid="season-finale-when"]')).toContainText('Open now');
    await bothSizes(app, 'season-finale-open');
    await page.locator('[data-testid="season-take"]').click();
    await playBlock(page);
    await page.locator('[data-testid="assessment-done"]').click();
    // Done returns to the Season, with the finale on file and nothing left to take.
    await expect(page.locator('[data-testid="season-screen"]')).toHaveAttribute('data-pane', 'finale');
    await expect(page.locator('[data-testid="season-finale-number"]')).not.toHaveText('–');
    await expect(page.locator('[data-testid="season-comparison"]')).toContainText('stands on its own');
    await expect(page.locator('[data-testid="season-take"]')).toHaveCount(0);
    await bothSizes(app, 'season-finale');
    const rec = readState(dir).progression.seasons.records[0];
    expect(rec.finale.loss.n).toBeGreaterThan(0);
    expect(readState(dir).progression.milestones.achieved['season-finale']).toBeDefined();
  } finally {
    await app.close();
  }

  // Relaunch after the week turns: Season 7, Season 6 archived with its finale, the Rail week settled (too thin to rate).
  app = await open(NEXT_MON, dir);
  try {
    const { page } = app;
    await openTrophies(page);
    await page.locator('[data-testid="trophy-season"]').click();
    await expect(page.locator('[data-testid="season-name"]')).toHaveText('Season 7');
    await page.locator('[data-testid="season-pane-archive"]').click();
    await expect(page.locator('[data-testid="season-archived"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="season-archived"]')).toHaveAttribute('data-season', '6');
    await expect(page.locator('[data-testid="season-archived"]')).toContainText('finale');
    await openTrophies(page);
    await page.locator('[data-testid="trophy-rail"]').click();
    await expect(page.locator('[data-testid="rail-past"]')).toContainText('Unrated');
    await expect(page.locator('[data-testid="rail-tier"]')).toHaveText('Deuce');
  } finally {
    await app.close();
  }
});
