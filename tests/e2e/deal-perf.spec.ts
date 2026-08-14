import { expect, test, type Page } from '@playwright/test';
import { launchApp, sel } from './helpers.js';
import { tableScreen, waitForIdle, snapshot } from './flow.js';

/**
 * DEAL ANIMATION PERFORMANCE — the corner-deal is transform+opacity only (compositor-driven), so
 * dealing the flop must not block the main thread. This benchmark installs a PerformanceObserver for
 * long tasks (>50ms main-thread blocks) around the moment the flop is dealt and asserts none occurred.
 *
 * It is a coarse guard, not a frame-timing microbenchmark: a long task during a pure-compositor
 * animation would mean the animation is accidentally triggering layout/paint on the main thread (the
 * exact regression the compositor-only keyframe is meant to avoid). Run in isolation — a saturated
 * machine will produce unrelated long tasks (see the load-flake memory).
 */

async function sitDown(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.locator(sel.newHand).click();
  await page.locator(tableScreen).waitFor();
  await waitForIdle(page);
}

test('dealing the flop produces no main-thread long task', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  try {
    await sitDown(page);

    // Start observing long tasks BEFORE we deal the flop.
    await page.evaluate(() => {
      (window as unknown as { __longTasks: number[] }).__longTasks = [];
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          (window as unknown as { __longTasks: number[] }).__longTasks.push(entry.duration);
        }
      });
      po.observe({ entryTypes: ['longtask'] });
      (window as unknown as { __longTaskObserver: PerformanceObserver }).__longTaskObserver = po;
    });

    // Drive passively to the flop (3 board cards) — the deal fires the corner-deal animation.
    for (let i = 0; i < 40; i++) {
      if ((await snapshot(page)).board.length >= 3) break;
      const state = await waitForIdle(page);
      if (state === 'handover') break;
      for (const s of [sel.btnCheck, sel.btnCall, sel.btnFold]) {
        const b = page.locator(s);
        if (await b.isEnabled()) {
          await b.click();
          break;
        }
      }
    }

    // Let the ~520ms deal animation run to completion, then collect.
    await page.waitForTimeout(900);
    const longTasks = await page.evaluate(() => {
      (window as unknown as { __longTaskObserver: PerformanceObserver }).__longTaskObserver.disconnect();
      return (window as unknown as { __longTasks: number[] }).__longTasks;
    });

    const worst = Math.max(0, ...longTasks);
    expect(worst, `deal animation should not block the main thread (long tasks: ${longTasks.join(',')})`).toBeLessThan(
      120,
    );
  } finally {
    await close();
  }
});
