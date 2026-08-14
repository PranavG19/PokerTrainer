import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp } from './helpers.js';

/**
 * The Nocturne theme system: graphite is the default (no attribute, painted by :root), a switch sets a
 * single documentElement attribute the bundled CSS keys off, and the choice persists in the settings
 * file (offsuit-settings.json) across a restart. These are the behavioural guarantees the migration
 * plan promises; the colour VALUES themselves are covered by the palette-pinned specs (interaction/
 * gameplay/anomaly), not here.
 *
 * The layout-free guarantee (a theme swap changes paint only, never geometry) is proven with a CDP
 * metrics probe, and that oracle is mutation-checked in-test so a green result means something.
 */

const settingsScreen = '[data-testid="settings-screen"]';
const themeSelect = '[data-testid="theme-select"]';
const optionObsidian = '[data-testid="theme-option-obsidian"]';
const optionGraphite = '[data-testid="theme-option-graphite"]';

function freshUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-theme-'));
}

async function openSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.click('[data-testid="tab-settings"]');
  await page.waitForSelector(settingsScreen);
}

test('graphite is the default: no data-theme attribute on first paint', async () => {
  const { page, close } = await launchApp({ userDataDir: freshUserDataDir() });
  try {
    await page.waitForSelector('[data-testid="home-screen"]');
    const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(attr, 'default graphite paints from :root with no attribute').toBeNull();
    await openSettings(page);
    // The selector reflects graphite as the pressed option.
    expect(await page.getAttribute(optionGraphite, 'aria-pressed')).toBe('true');
    expect(await page.getAttribute(optionObsidian, 'aria-pressed')).toBe('false');
  } finally {
    await close();
  }
});

test('choosing obsidian sets the attribute and updates the pressed state immediately', async () => {
  const { page, close } = await launchApp({ userDataDir: freshUserDataDir() });
  try {
    await page.waitForSelector('[data-testid="home-screen"]');
    await openSettings(page);
    await page.click(optionObsidian);
    await expect.poll(() =>
      page.evaluate(() => document.documentElement.getAttribute('data-theme')),
    ).toBe('obsidian');
    expect(await page.getAttribute(optionObsidian, 'aria-pressed')).toBe('true');
    expect(await page.getAttribute(optionGraphite, 'aria-pressed')).toBe('false');
    expect(await page.getAttribute(themeSelect, 'data-theme')).toBe('obsidian');
  } finally {
    await close();
  }
});

test('the theme choice persists across a restart and is applied before first paint', async () => {
  const userDataDir = freshUserDataDir();
  // First run: choose obsidian.
  {
    const { page, close } = await launchApp({ userDataDir });
    try {
      await page.waitForSelector('[data-testid="home-screen"]');
      await openSettings(page);
      await page.click(optionObsidian);
      await expect.poll(() =>
        page.evaluate(() => document.documentElement.getAttribute('data-theme')),
      ).toBe('obsidian');
      // The settings file records it (a device preference, not profile state).
      await expect.poll(() => {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(userDataDir, 'offsuit-settings.json'), 'utf-8'));
          return raw.theme;
        } catch {
          return undefined;
        }
      }).toBe('obsidian');
    } finally {
      await close();
    }
  }
  // Second run with the same profile: obsidian is applied at boot, before any screen mounts.
  {
    const { page, close } = await launchApp({ userDataDir });
    try {
      await page.waitForSelector('[data-testid="home-screen"]');
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('obsidian');
    } finally {
      await close();
    }
  }
});

test('a theme switch changes paint only — zero layout, at least one style recalc (CDP)', async () => {
  const { page, close } = await launchApp({ userDataDir: freshUserDataDir() });
  try {
    await page.waitForSelector('[data-testid="home-screen"]');
    const client = await page.context().newCDPSession(page);
    await client.send('Performance.enable');
    const metric = (r: { metrics: { name: string; value: number }[] }, k: string) =>
      r.metrics.find((m) => m.name === k)?.value ?? 0;

    // Real theme switch: only colour-family tokens change; geometry tokens are theme-invariant.
    const before = await client.send('Performance.getMetrics');
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'obsidian');
      // Force a synchronous style+layout flush so the metrics settle before we read them.
      void document.body.getBoundingClientRect();
    });
    const after = await client.send('Performance.getMetrics');

    const layoutDelta = metric(after, 'LayoutCount') - metric(before, 'LayoutCount');
    const recalcDelta = metric(after, 'RecalcStyleCount') - metric(before, 'RecalcStyleCount');
    expect(recalcDelta, 'a token swap must recalc style').toBeGreaterThanOrEqual(1);
    expect(layoutDelta, 'a colour-only theme swap must not trigger layout').toBe(0);

    // Mutation-check the oracle: changing a GEOMETRY token forces layout, proving LayoutCount can rise.
    const beforeGeom = await client.send('Performance.getMetrics');
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--radius-lg', '40px');
      document.documentElement.style.fontSize = '20px';
      void document.body.getBoundingClientRect();
    });
    const afterGeom = await client.send('Performance.getMetrics');
    expect(
      metric(afterGeom, 'LayoutCount') - metric(beforeGeom, 'LayoutCount'),
      'oracle sanity: a geometry change DOES trigger layout',
    ).toBeGreaterThanOrEqual(1);
  } finally {
    await close();
  }
});
