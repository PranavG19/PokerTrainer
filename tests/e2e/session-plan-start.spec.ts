import { expect, test, type Page } from '@playwright/test';
import { launchApp, sel } from './helpers.js';

/**
 * BACKLOG #1 — the session planner is wired into session start, not discarded.
 *
 * The planner models a 50-minute session with 3 whole-task LIVE HANDS (14% of 50 = 7 min, 3 hands at
 * 2 min — see session-plan.spec's worked table). Before this feature, Start opened the ordinary
 * unbounded table and the plan was thrown away. These tests prove the launched session HONOURS the
 * planned hand count: the table is bounded at 3 hands and ends with a planned-complete state instead
 * of offering "Next hand" forever, whereas the plain New session path stays the default unbounded
 * table with no hand limit.
 *
 * SYNC ORACLE, NEVER A SLEEP: the table root publishes data-awaiting on every render (the same hook
 * every other table spec waits on), and the planner root publishes data-minutes / data-status.
 */

const planner = '[data-testid="session-planner"]';
const homeScreen = '[data-testid="home-screen"]';
const tableScreen = '[data-testid="table-screen"]';
const planStart = '[data-testid="plan-start"]';
const lengthBtn = '[data-testid="length-btn"]';
const nextHand = '[data-testid="next-hand"]';
const plannedComplete = '[data-testid="session-planned-complete"]';

const PLANNED_HANDS = 3;
const MAX_HERO_TURNS = 40;

async function waitForIdle(page: Page): Promise<string> {
  await page.waitForFunction(() => {
    const a = document.querySelector('[data-testid="table-screen"]')?.getAttribute('data-awaiting');
    return a === 'hero' || a === 'handover';
  });
  return (await page.locator(tableScreen).getAttribute('data-awaiting')) ?? '';
}

/** Fold the hero out at its first turn so the hand settles quickly, then land at handover. */
async function foldOutOneHand(page: Page): Promise<void> {
  for (let turn = 0; turn < MAX_HERO_TURNS; turn++) {
    if ((await waitForIdle(page)) === 'handover') return;
    const fold = page.locator(sel.btnFold);
    if (await fold.isEnabled()) {
      await fold.click();
      continue;
    }
    const check = page.locator(sel.btnCheck);
    const call = page.locator(sel.btnCall);
    if (await check.isEnabled()) await check.click();
    else if (await call.isEnabled()) await call.click();
    else throw new Error(`hero turn with no enabled action after ${turn} turns`);
  }
  throw new Error(`hand did not settle within ${MAX_HERO_TURNS} hero turns`);
}

test.describe('the session planner parameterises the started session', () => {
  test('a planned 50-minute session ends after the planned 3 hands, not forever', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await page.waitForSelector(homeScreen);
      await expect(page.locator(planner)).toBeVisible();

      await page.click(`${lengthBtn}[data-minutes="50"]`);
      await expect(page.locator(planner)).toHaveAttribute('data-minutes', '50');

      await page.click(planStart);
      await page.waitForSelector(tableScreen);

      // The started session carries the plan's live-hand count — the default table has none.
      await expect(page.locator(tableScreen)).toHaveAttribute('data-hand-limit', String(PLANNED_HANDS));

      // Play the first two planned hands; each still offers "Next hand".
      for (let hand = 1; hand < PLANNED_HANDS; hand++) {
        await foldOutOneHand(page);
        await expect(page.locator(nextHand)).toBeVisible();
        await page.locator(nextHand).click();
      }

      // The third (last planned) hand ends the sitting: planned-complete, and NO "Next hand".
      await foldOutOneHand(page);
      await expect(page.locator(plannedComplete)).toBeVisible();
      await expect(page.locator(nextHand)).toHaveCount(0);
    } finally {
      await close();
    }
  });

  test('the plain New session path is the default unbounded table (no hand limit)', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await page.waitForSelector(homeScreen);
      await page.click(sel.newHand);
      await page.waitForSelector(tableScreen);

      // No plan → no bound: the default table never advertises a hand limit and keeps dealing.
      await expect(page.locator(tableScreen)).not.toHaveAttribute('data-hand-limit', /.*/);
      await foldOutOneHand(page);
      await expect(page.locator(nextHand)).toBeVisible();
      await expect(page.locator(plannedComplete)).toHaveCount(0);
    } finally {
      await close();
    }
  });
});
