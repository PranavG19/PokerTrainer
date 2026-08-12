import { expect, test, type Page } from '@playwright/test';
import { launchApp } from './helpers.js';

/*
 * THE INTERLEAVING VIEW (Q1/Q2/Q3, core/interleave.ts wired through sessionPlan.ts). The session
 * planner has a second view showing which graded RFI spot classes are in play and whether an
 * interleaved block can be assembled yet. The producer is REAL: the chart drill's graded commits feed
 * session.interleavingSpots, so the view moves from an honest empty state to a populated one driven
 * only by the actual grader. Every spot enters at the first-exposure rung, so a populated block
 * honestly REFUSES ("first exposure is blocked, interleaving is earned") — that refusal is the
 * teaching (Q2/Q4), and proving it is reachable is what shows the wiring is real rather than a stub.
 *
 * This file is separate from session-plan.spec.ts on purpose: that suite pins the plan view's
 * data-mode surface, and the interleaving view is additive (data-view), so the two never collide.
 */

const planner = '[data-testid="session-planner"]';
const viewBtn = '[data-testid="view-btn"]';
const interleavingView = '[data-testid="interleaving-view"]';
const preframe = '[data-testid="interleaving-preframe"]';
const emptyState = '[data-testid="interleaving-empty"]';
const spot = '[data-testid="interleaving-spot"]';
const refusal = '[data-testid="interleaving-refusal"]';
const chartsScreen = '[data-testid="charts-screen"]';

/** INTERLEAVING_PREFRAME in core/interleave.ts is three chunks. */
const PREFRAME_LINES = 3;

async function openInterleaving(page: Page): Promise<void> {
  await page.waitForSelector(planner);
  await page.click(`${viewBtn}[data-view="interleaving"]`);
  await expect(page.locator(planner)).toHaveAttribute('data-view', 'interleaving');
  await page.waitForSelector(interleavingView);
}

/** Drive the chart RFI drill for `count` real graded commits at one seat, via the actual O/F keys. */
async function driveDrill(page: Page, count: number): Promise<void> {
  await page.click('[data-testid="tab-charts"]');
  await page.waitForSelector(chartsScreen);
  await page.click('[data-testid="position-btn"][data-position="CO"]');
  await expect(page.locator(chartsScreen)).toHaveAttribute('data-position', 'CO');
  for (let i = 0; i < count; i += 1) {
    const before = Number(await page.getAttribute(chartsScreen, 'data-answered'));
    // The verdict does not matter here — either key is a real graded commit that records the spot.
    await page.keyboard.press('o');
    await page.waitForFunction(
      (want: number) =>
        Number(
          (document.querySelector('[data-testid="charts-screen"]') as HTMLElement | null)?.dataset
            .answered ?? '-1',
        ) === want,
      before + 1,
    );
  }
}

async function backToHome(page: Page): Promise<void> {
  await page.click('[data-testid="tab-play"]');
  await page.waitForSelector(planner);
}

test.describe('the interleaving view (Q1/Q2/Q3)', () => {
  test('I1. the default view is the plan, and its data-mode surface is untouched', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await page.waitForSelector(planner);
      // The additive data-view attribute defaults to plan; data-mode (the session/free-roam axis the
      // existing suite pins) is present and unchanged.
      await expect(page.locator(planner)).toHaveAttribute('data-view', 'plan');
      await expect(page.locator(planner)).toHaveAttribute('data-mode', 'session');
      await expect(page.locator('[data-testid="length-row"]')).toBeVisible();
      await expect(page.locator(interleavingView)).toHaveCount(0);
    } finally {
      await close().catch(() => {});
    }
  });

  test('I2. the empty state is honest: no graded spots yet, pre-frame present', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await openInterleaving(page);
      await expect(page.locator(interleavingView)).toHaveAttribute('data-spot-count', '0');
      await expect(page.locator(interleavingView)).toHaveAttribute('data-status', 'empty');
      await expect(page.locator(emptyState)).toBeVisible();
      // Q3: the written pre-frame is always shown — three chunks.
      await expect(page.locator(`${preframe} li`)).toHaveCount(PREFRAME_LINES);
      await expect(page.locator(spot)).toHaveCount(0);
    } finally {
      await close().catch(() => {});
    }
  });

  test('I3. real grader, two states: driving the drill populates the view and it honestly refuses first-exposure', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      // Empty before.
      await openInterleaving(page);
      await expect(page.locator(interleavingView)).toHaveAttribute('data-spot-count', '0');

      // Drive the actual RFI drill: 12 real graded commits accumulate distinct combo-CO classes.
      await driveDrill(page, 12);
      await backToHome(page);
      await openInterleaving(page);

      // Populated: a distinct, positive spot count (≠ the empty state), one row per class.
      const count = Number(await page.getAttribute(interleavingView, 'data-spot-count'));
      expect(count, 'driving the drill recorded no interleaving spots').toBeGreaterThan(0);
      await expect(page.locator(spot)).toHaveCount(count);

      // Every spot is a first exposure (no fading log promotes any), so core REFUSES the block — and
      // says why, in its own words. This is the reachable refusal that proves the grader is real.
      await expect(page.locator(interleavingView)).toHaveAttribute('data-status', 'first-exposure-rung');
      await expect(page.locator(refusal)).toContainText('first exposure');
    } finally {
      await close().catch(() => {});
    }
  });

  test('I4. the recorded spots survive closing and reopening the app', async () => {
    const dir = (await import('node:fs')).mkdtempSync(
      (await import('node:path')).join((await import('node:os')).tmpdir(), 'offsuit-interleave-'),
    );

    const first = await launchApp({ seed: 42, userDataDir: dir });
    let before = 0;
    try {
      await driveDrill(first.page, 10);
      await backToHome(first.page);
      await openInterleaving(first.page);
      before = Number(await first.page.getAttribute(interleavingView, 'data-spot-count'));
      expect(before).toBeGreaterThan(0);
      await first.page.waitForTimeout(200); // let the async saveState flush
    } finally {
      await first.close().catch(() => {});
    }

    // Second sitting, same profile: the classes come back before any new drilling.
    const second = await launchApp({ seed: 42, userDataDir: dir });
    try {
      await openInterleaving(second.page);
      const after = Number(await second.page.getAttribute(interleavingView, 'data-spot-count'));
      expect(after, 'interleaving spots did not survive the restart').toBe(before);
    } finally {
      await second.close().catch(() => {});
    }
  });
});
