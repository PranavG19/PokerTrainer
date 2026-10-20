import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, sel } from './helpers.js';
import { CATALOGUE } from '../../src/core/cosmetics/catalogue.js';
import { SLOT_ATTRIBUTE } from '../../src/core/cosmetics/locker.js';

/**
 * YOU › LOCKER (1.7, 2.13): earn-only, paint-only cosmetics, previewed on the stage before they are worn.
 *
 * - Fresh: only the day-one items are earned; every other item is listed with its rule; a locked item previews on the
 *   stage but cannot be worn.
 * - Seeded: an item earned from a milestone on file is worn from the Locker, persisted with its receipt, applied at the
 *   next boot, and shows on the real table.
 * - Paint only, by allowlist: wearing every non-default item at once changes no element's geometry, and every
 *   computed style that changes is a paint property.
 */

const STATE = 'offsuit-state.json';
const freshDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-locker-'));
const readState = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, STATE), 'utf-8')) as Record<string, any>;

async function openLocker(page: Page): Promise<void> {
  await page.locator('[data-testid="tab-you"]').click();
  await page.locator('[data-testid="tab-locker"]').click();
  await expect(page.locator('[data-testid="you-locker"]')).toBeVisible();
}

async function size(app: Awaited<ReturnType<typeof launchApp>>, w: number, h: number): Promise<void> {
  await app.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]);
  await app.page.waitForFunction(([w, h]) => window.innerWidth === w && window.innerHeight === h, [w, h]);
}

const htmlAttr = (page: Page, name: string) => page.evaluate((n) => document.documentElement.getAttribute(n), name);

test('a fresh Locker: day-one items in use, every other item shown with its rule, a locked one previews but cannot be worn', async () => {
  const app = await launchApp({ userDataDir: freshDir() });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="home-screen"]');
    await openLocker(page);
    const items = page.locator('[data-testid="locker-item"]');
    const backs = CATALOGUE.filter((i) => i.slot === 'cardBack');
    await expect(items).toHaveCount(backs.length);
    await expect(page.locator('[data-testid="locker-count"]')).toContainText(`1 of ${backs.length} earned`);
    await expect(page.locator('[data-testid="locker-item"][data-owned="true"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="locker-item"][data-equipped="true"]')).toHaveAttribute('data-id', 'back-graphite');
    await expect(page.locator('[data-testid="locker-equip"]')).toBeDisabled();
    await expect(page.locator('[data-testid="locker-equip"]')).toHaveText('In use');

    // A locked item: the stage shows it, the document does not, and it cannot be worn.
    await page.locator('[data-testid="locker-item"][data-id="back-depth-rings"]').click();
    await expect(page.locator('[data-testid="locker-stage"]')).toHaveAttribute('data-back', 'depth-rings');
    expect(await htmlAttr(page, 'data-back')).toBeNull();
    await expect(page.locator('[data-testid="locker-equip"]')).toBeDisabled();
    await expect(page.locator('[data-testid="locker-equip"]')).toHaveText('Not earned yet');
    await expect(page.locator('[data-testid="locker-receipt"]')).toContainText('Certified the 125bb table');

    // Hover previews too, and leaving puts the selection back.
    await page.locator('[data-testid="locker-item"][data-id="back-the-seal"]').hover();
    await expect(page.locator('[data-testid="locker-stage"]')).toHaveAttribute('data-back', 'the-seal');
    await page.locator('[data-testid="locker-count"]').hover();
    await expect(page.locator('[data-testid="locker-stage"]')).toHaveAttribute('data-back', 'depth-rings');

    // Every slot lists its items; nothing is for sale anywhere on the page.
    for (const slot of ['felt', 'chipSet', 'deeRim', 'celebration'] as const) {
      await page.locator(`[data-testid="locker-slot-${slot}"]`).click();
      await expect(items).toHaveCount(CATALOGUE.filter((i) => i.slot === slot).length);
    }
    const text = (await page.locator('[data-testid="you-locker"]').innerText()).toLowerCase();
    expect(text).not.toMatch(/\b(buy|bought|purchase|sale|cost|costs)\b|\$|\d+\s*chalk\b/);

    for (const [w, h] of [[900, 640], [1100, 760]]) {
      await size(app, w, h);
      const [sh, ih, sw, iw] = await page.evaluate(() => [document.documentElement.scrollHeight, innerHeight, document.documentElement.scrollWidth, innerWidth]);
      expect(sh).toBeLessThanOrEqual(ih);
      expect(sw).toBeLessThanOrEqual(iw);
    }
  } finally {
    await app.close();
  }
});

test('an earned item is worn from the Locker, saved with its receipt, applied at boot and painted on the table', async () => {
  const dir = freshDir();
  fs.writeFileSync(
    path.join(dir, STATE),
    JSON.stringify({ schemaVersion: 2, progression: { milestones: { achieved: { 'depth-75': { day: 20360 } } } } }),
  );
  let app = await launchApp({ userDataDir: dir });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="home-screen"]');
    await openLocker(page);
    await page.locator('[data-testid="locker-slot-felt"]').click();
    const night = page.locator('[data-testid="locker-item"][data-id="felt-night-ink"]');
    await expect(night).toHaveAttribute('data-owned', 'true');
    await night.click();
    await expect(page.locator('[data-testid="locker-receipt"]')).toContainText('Certified the 75bb table');
    expect(await htmlAttr(page, 'data-felt')).toBeNull();
    await page.locator('[data-testid="locker-equip"]').click();
    await expect.poll(() => htmlAttr(page, 'data-felt')).toBe('night-ink');
    await expect(page.locator('[data-testid="locker-item"][data-id="felt-night-ink"]')).toHaveAttribute('data-equipped', 'true');
    await expect.poll(() => readState(dir).progression?.cosmetics?.equipped?.felt).toBe('felt-night-ink');
    const cos = readState(dir).progression.cosmetics;
    expect(cos.owned).toContain('felt-night-ink');
    expect(cos.receipts.find((r: { itemId: string }) => r.itemId === 'felt-night-ink')).toMatchObject({ day: 20360, chalk: 0 });
  } finally {
    await app.close();
  }

  app = await launchApp({ userDataDir: dir });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="home-screen"]');
    expect(await htmlAttr(page, 'data-felt')).toBe('night-ink');
    await page.click(sel.newHand);
    await page.waitForSelector('[data-testid="table-screen"]');
    const lit = await page.evaluate(() => getComputedStyle(document.querySelector('.table-stage') as Element, '::before').backgroundImage);
    expect(lit).toContain('rgba(26, 42, 92, 0.6)');
    // Wearing the day-one item again clears the attribute and the saved slot.
    await openLocker(page);
    await page.locator('[data-testid="locker-slot-felt"]').click();
    await page.locator('[data-testid="locker-item"][data-id="felt-graphite"]').click();
    await page.locator('[data-testid="locker-equip"]').click();
    await expect.poll(() => htmlAttr(page, 'data-felt')).toBeNull();
    await expect.poll(() => readState(dir).progression?.cosmetics?.equipped?.felt ?? null).toBeNull();
  } finally {
    await app.close();
  }
});

/**
 * Paint properties a cosmetic may change; anything else changing is a layout leak. Background longhands count per
 * layer, so a pattern with more layers changes repeat, clip and origin too. Not stroke-dasharray: measured, a dash
 * change re-lays out the SVG (theme.spec caught it on the first Inlaid rim).
 */
const PAINT = /^(background(-image|-color|-position(-x|-y)?|-size|-repeat|-clip|-origin|-attachment|-blend-mode)?|box-shadow|color|border(-(top|right|bottom|left|block-start|block-end|inline-start|inline-end))?-color|outline-color|fill|stroke|stroke-opacity|text-decoration-color|caret-color|column-rule-color|-webkit-text-(fill|stroke)-color)$/;

test('wearing every non-default item at once changes paint only: a computed-style allowlist and no rect moves', async () => {
  const app = await launchApp({ userDataDir: freshDir() });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="home-screen"]');
    await page.click(sel.newHand);
    await page.waitForSelector('[data-testid="table-screen"][data-awaiting="hero"]');
    // Hold the table still: no clock-driven repaint between the two snapshots.
    await page.waitForTimeout(500);
    const snapshot = () =>
      page.evaluate(() => {
        const out: Record<string, { rect: number[]; styles: Record<string, string> }> = {};
        const all = [...document.querySelectorAll('*')];
        all.forEach((el, i) => {
          const r = el.getBoundingClientRect();
          for (const pseudo of [null, '::before', '::after'] as const) {
            const cs = getComputedStyle(el, pseudo);
            if (pseudo && cs.content === 'none') continue;
            const styles: Record<string, string> = {};
            for (let k = 0; k < cs.length; k++) styles[cs[k]] = cs.getPropertyValue(cs[k]);
            out[`${i}:${el.tagName}.${(el as HTMLElement).className?.toString?.() ?? ''}${pseudo ?? ''}`] = {
              rect: pseudo ? [] : [r.x, r.y, r.width, r.height],
              styles,
            };
          }
        });
        return out;
      });
    const before = await snapshot();
    const worn: Record<string, string> = {};
    for (const item of CATALOGUE) if (item.earn.kind !== 'day-one') worn[SLOT_ATTRIBUTE[item.slot]] ??= item.paint;
    // One pass per remaining value too, so every item is checked, not only the first of each slot.
    const passes: Record<string, string>[] = [worn];
    for (const item of CATALOGUE) if (item.earn.kind !== 'day-one' && worn[SLOT_ATTRIBUTE[item.slot]] !== item.paint) passes.push({ [SLOT_ATTRIBUTE[item.slot]]: item.paint });
    const changed = new Set<string>();
    for (const attrs of passes) {
      await page.evaluate((a) => {
        for (const [k, v] of Object.entries(a)) document.documentElement.setAttribute(`data-${k}`, v);
      }, attrs);
      const after = await snapshot();
      expect(Object.keys(after)).toEqual(Object.keys(before));
      for (const [key, b] of Object.entries(before)) {
        const a = after[key];
        expect(a.rect, `${key} moved under ${JSON.stringify(attrs)}`).toEqual(b.rect);
        for (const [prop, v] of Object.entries(b.styles)) if (a.styles[prop] !== v) changed.add(prop);
      }
      await page.evaluate((a) => {
        for (const k of Object.keys(a)) document.documentElement.removeAttribute(`data-${k}`);
      }, attrs);
    }
    const leaks = [...changed].filter((p) => !p.startsWith('--') && !PAINT.test(p));
    expect(leaks, 'non-paint properties a cosmetic changed').toEqual([]);
    // And the oracle can see a change at all.
    expect([...changed].some((p) => p.startsWith('background'))).toBe(true);
  } finally {
    await app.close();
  }
});
