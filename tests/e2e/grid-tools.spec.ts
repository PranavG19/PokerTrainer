import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, goTo } from './helpers.js';

/**
 * The three grid tools beside Charts — Bank, Equity and Ranges. Their wiring is unit-tested in jsdom
 * (tests/unit/*-ui.test.ts), which computes no CSS; these tests own what only a real renderer shows.
 */

async function withApp(body: (ctx: { app: ElectronApplication; page: Page }) => Promise<void>): Promise<void> {
  const { app, page, close } = await launchApp({ seed: 42 });
  try {
    await body({ app, page });
  } finally {
    await close().catch(() => {});
  }
}

async function useViewport(app: ElectronApplication, page: Page, width: number, height: number): Promise<void> {
  await app.evaluate(async ({ BrowserWindow }, size: { width: number; height: number }) => {
    BrowserWindow.getAllWindows()[0].setSize(size.width, size.height);
  }, { width, height });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await page.waitForFunction(
    (want: { width: number; height: number }) => window.innerWidth === want.width && window.innerHeight === want.height,
    { width, height },
  );
}

test.describe('equity calculator: the villain inputs follow the chosen mode', () => {
  /**
   * BUG (found from a screenshot): `.equity-field { display: flex }` overrode the `hidden` attribute, so
   * the specific-hand input AND the 169-cell range grid were both on screen in "Any two cards" mode,
   * where neither applies. The screen toggled `hidden` correctly; the CSS ignored it.
   */
  test('E1. only the input the selected villain mode needs is visible', async () => {
    await withApp(async ({ page }) => {
      await goTo(page, 'tab-equity');
      await page.waitForSelector('[data-testid="equity-screen"]');
      const hand = page.locator('[data-testid="equity-villain-input"]');
      const grid = page.locator('[data-testid="equity-range-grid"]');

      // Default: any two cards — neither the hand field nor the range grid.
      await expect(hand).toBeHidden();
      await expect(grid).toBeHidden();

      await page.click('[data-testid="equity-mode-hand"]');
      await expect(hand).toBeVisible();
      await expect(grid).toBeHidden();

      await page.click('[data-testid="equity-mode-range"]');
      await expect(hand).toBeHidden();
      await expect(grid).toBeVisible();

      await page.click('[data-testid="equity-mode-random"]');
      await expect(hand).toBeHidden();
      await expect(grid).toBeHidden();
    });
  });
});

test.describe('bank, equity and ranges fit the window', () => {
  /** Each screen at both documented sizes: no page scroll, and the 13x13 grid entirely on screen. */
  test('F1. no page scroll and the whole grid visible at 1100x760 and 900x640', async () => {
    await withApp(async ({ app, page }) => {
      const screens = [
        { tab: 'tab-chart-bank', root: 'chart-bank-screen', grid: 'chart-grid', prep: async () => {} },
        {
          tab: 'tab-equity',
          root: 'equity-screen',
          grid: 'equity-range-grid',
          prep: async () => {
            await page.click('[data-testid="equity-mode-range"]');
          },
        },
        { tab: 'tab-ranges', root: 'range-editor-screen', grid: 'range-editor-grid', prep: async () => {} },
      ];
      for (const s of screens) {
        await goTo(page, s.tab as 'tab-chart-bank' | 'tab-equity' | 'tab-ranges');
        await page.waitForSelector(`[data-testid="${s.root}"]`);
        await s.prep();
        for (const [width, height] of [
          [1100, 760],
          [900, 640],
        ] as const) {
          await useViewport(app, page, width, height);
          const geo = await page.evaluate((gridId: string) => {
            const g = document.querySelector(`[data-testid="${gridId}"]`)?.getBoundingClientRect();
            const cells = [...(document.querySelector(`[data-testid="${gridId}"]`)?.children ?? [])]
              .filter((el) => (el as HTMLElement).dataset.combo !== undefined)
              .map((el) => el.getBoundingClientRect());
            return {
              scrollHeight: document.documentElement.scrollHeight,
              scrollWidth: document.documentElement.scrollWidth,
              grid: g ? { top: g.top, bottom: g.bottom, left: g.left, right: g.right } : null,
              cells: cells.length,
              minCell: Math.min(...cells.map((r) => Math.min(r.width, r.height))),
            };
          }, s.grid);
          const at = `${s.root} ${width}x${height}`;
          expect(geo.scrollHeight, `${at}: page scrolls vertically`).toBeLessThanOrEqual(height + 1);
          expect(geo.scrollWidth, `${at}: page scrolls sideways`).toBeLessThanOrEqual(width + 1);
          expect(geo.grid, `${at}: grid missing`).not.toBeNull();
          expect(geo.cells, `${at}: cell count`).toBe(169);
          expect(geo.grid!.bottom, `${at}: grid hangs below the fold`).toBeLessThanOrEqual(height + 1);
          expect(geo.grid!.right, `${at}: grid hangs past the right edge`).toBeLessThanOrEqual(width + 1);
          // "A2s" stays legible: the same floor charts.spec pins for the Charts grid, less a little for
          // the equity grid, which shares its column with the result.
          expect(geo.minCell, `${at}: smallest cell ${geo.minCell.toFixed(1)}px`).toBeGreaterThanOrEqual(24);
        }
      }
    });
  });
});
