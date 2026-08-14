import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { launchApp } from './helpers.js';

/**
 * REDESIGN CAPTURE — a screenshot pass over every screen at both documented window sizes, for the UI
 * redesign audit. NOT a behavioural test: it asserts only that each screen mounted, then captures it.
 * Output lands in screenshots/redesign-audit/ so it never mixes with the pinned per-feature shots.
 *
 * Run explicitly: `npx playwright test tests/e2e/redesign-capture.spec.ts`.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'screenshots', 'redesign-audit');

const SIZES = [
  { tag: '1100x760', width: 1100, height: 760 },
  { tag: '900x640', width: 900, height: 640 },
] as const;

/** Resize the real window AND emulate the viewport, then wait for innerWidth/Height to match. */
async function useViewport(app: ElectronApplication, page: Page, width: number, height: number): Promise<void> {
  await app.evaluate(async ({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height);
  }, { width, height });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await page.waitForFunction(
    (want) => window.innerWidth === want.width && window.innerHeight === want.height,
    { width, height },
  );
  // Let any fade/settle finish.
  await page.waitForTimeout(250);
}

async function capture(page: Page, name: string): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}

/** Open a top tab and wait for its screen. */
async function openTab(page: Page, testid: string, screenSelector: string): Promise<void> {
  await page.click(`[data-testid="${testid}"]`);
  await page.waitForSelector(screenSelector, { timeout: 15000 });
  await page.waitForTimeout(150);
}

// Each entry: a top tab, the selector proving it mounted, and a label for the file.
const TABS: { testid: string; sel: string; name: string }[] = [
  { testid: 'tab-play', sel: '[data-testid="home-screen"]', name: 'play-home' },
  { testid: 'tab-learn', sel: '[data-testid="lesson-screen"], [data-testid="learn-screen"]', name: 'learn' },
  { testid: 'tab-train', sel: '[data-testid="train-screen"]', name: 'train-hub' },
  { testid: 'tab-charts', sel: '[data-testid="charts-screen"]', name: 'charts' },
  { testid: 'tab-dossier', sel: '[data-testid="dossier-screen"], [data-testid="dossier"]', name: 'dossier' },
  { testid: 'tab-progress', sel: '[data-testid="progress-screen"]', name: 'progress' },
  { testid: 'tab-profile', sel: '[data-testid="profile-screen"], [data-testid="profile"]', name: 'profile' },
  { testid: 'tab-settings', sel: '[data-testid="settings-screen"], [data-testid="settings"]', name: 'settings' },
];

// Train-hub rungs (rail buttons keep the old tab-* testids), captured on the default size only.
const TRAIN_RUNGS: { testid: string; sel: string; name: string }[] = [
  { testid: 'tab-puzzle', sel: '[data-testid="puzzle-screen"]', name: 'train-spots-puzzle' },
  { testid: 'tab-drill', sel: '[data-testid="drill-screen"]', name: 'train-math-drill' },
  { testid: 'tab-reading', sel: '[data-testid="hand-reading-drill"]', name: 'train-reading' },
  { testid: 'tab-board', sel: '[data-testid="board-reading-drill"]', name: 'train-sight' },
  { testid: 'tab-anomaly', sel: '[data-testid="anomaly-screen"], [data-testid="anomaly-drill"]', name: 'train-speed' },
  { testid: 'tab-robustness', sel: '[data-testid="robustness-screen"], [data-testid="robustness-drill"]', name: 'train-stress' },
  { testid: 'tab-repair', sel: '[data-testid="contrast-screen"], [data-testid="repair-screen"]', name: 'train-leaks' },
  { testid: 'tab-spacing', sel: '[data-testid="spacing-screen"], [data-testid="spacing"]', name: 'train-upkeep' },
];

test('capture every top-level screen at both documented window sizes', async () => {
  const { app, page, close } = await launchApp({ seed: 42 });
  try {
    await page.waitForSelector('[data-testid="home-screen"]');
    for (const size of SIZES) {
      await useViewport(app, page, size.width, size.height);
      for (const tab of TABS) {
        try {
          await openTab(page, tab.testid, tab.sel);
          await capture(page, `${tab.name}-${size.tag}`);
        } catch {
          // Screen selector guess missed — capture whatever is on screen so the audit still sees it.
          await capture(page, `${tab.name}-${size.tag}-FALLBACK`);
        }
      }
    }
    expect(fs.readdirSync(OUT).length).toBeGreaterThan(0);
  } finally {
    await close().catch(() => {});
  }
});

test('capture every Train-hub rung (default size)', async () => {
  const { app, page, close } = await launchApp({ seed: 42 });
  try {
    await page.waitForSelector('[data-testid="home-screen"]');
    await useViewport(app, page, 1100, 760);
    await openTab(page, 'tab-train', '[data-testid="train-screen"]');
    for (const rung of TRAIN_RUNGS) {
      try {
        await page.click(`[data-testid="${rung.testid}"]`);
        await page.waitForSelector(rung.sel, { timeout: 10000 });
        await page.waitForTimeout(150);
        await capture(page, `${rung.name}-1100x760`);
      } catch {
        await capture(page, `${rung.name}-1100x760-FALLBACK`);
      }
    }
  } finally {
    await close().catch(() => {});
  }
});

test('capture the live table: dealt, and a graded coach verdict', async () => {
  const { app, page, close } = await launchApp({ seed: 42 });
  try {
    await page.waitForSelector('[data-testid="home-screen"]');
    await useViewport(app, page, 1100, 760);
    await page.click('[data-testid="new-hand"]');
    await page.waitForSelector('[data-testid="table-screen"]');
    await page.waitForTimeout(300);
    await capture(page, 'table-dealt-1100x760');

    // Provoke a graded verdict: a fold facing no bet is usually flagged, otherwise any action shows the surface.
    const fold = page.locator('[data-testid="btn-fold"]');
    if (await fold.count()) {
      await fold.first().click().catch(() => {});
      await page.waitForTimeout(400);
      await capture(page, 'table-after-action-1100x760');
    }

    await useViewport(app, page, 900, 640);
    await page.waitForTimeout(200);
    await capture(page, 'table-dealt-900x640');
  } finally {
    await close().catch(() => {});
  }
});
