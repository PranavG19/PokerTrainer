import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, sel } from './helpers.js';
import { CATALOGUE } from '../../src/core/cosmetics/catalogue.js';
import { SLOT_ATTRIBUTE } from '../../src/core/cosmetics/locker.js';
import { systemDayKeyOf } from '../../src/core/localDay.js';

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
    // Chalk prices are published, but nothing is for money, on sale or random.
    expect(text).not.toMatch(/\$|\b(usd|purchase|sale|sales|discount|offer|limited|random drop)\b/);
    expect(text).toContain('never bought');

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
 * change re-lays out the SVG (theme.spec caught it on the first Inlaid rim). transform-origin only moves where a
 * moment's transform pivots; it never lays out.
 */
const PAINT = /^(background(-image|-color|-position(-x|-y)?|-size|-repeat|-clip|-origin|-attachment|-blend-mode)?|box-shadow|transform-origin|color|border(-(top|right|bottom|left|block-start|block-end|inline-start|inline-end))?-color|outline-color|fill|stroke|stroke-opacity|text-decoration-color|caret-color|column-rule-color|-webkit-text-(fill|stroke)-color)$/;

test('wearing every non-default item at once changes paint only: a computed-style allowlist and no rect moves', async () => {
  const app = await launchApp({ userDataDir: freshDir() });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="home-screen"]');
    await page.click(sel.newHand);
    await page.waitForSelector('[data-testid="table-screen"][data-awaiting="hero"]');
    // Hold the table still: no clock-driven repaint between the two snapshots.
    await page.waitForTimeout(500);
    const snapshot = (): Promise<Snapshot> =>
      page.evaluate(() => {
        const out: Record<string, { rect: number[]; styles: Record<string, string> }> = {};
        // The perch's Dee blinks on a timer (its lights are redrawn for 120ms), which no cosmetic causes; it is the one
        // element left out. The stage's Dee never blinks, so Dee's finish is still measured there.
        const all = [...document.querySelectorAll('*')].filter((el) => !el.closest('.perch'));
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
    const worn: Record<string, string> = {};
    for (const item of CATALOGUE) if (item.earn.kind !== 'day-one') worn[SLOT_ATTRIBUTE[item.slot]] ??= item.paint;
    // One pass per remaining value too, so every item is checked, not only the first of each slot.
    const passes: Record<string, string>[] = [worn];
    for (const item of CATALOGUE) if (item.earn.kind !== 'day-one' && worn[SLOT_ATTRIBUTE[item.slot]] !== item.paint) passes.push({ [SLOT_ATTRIBUTE[item.slot]]: item.paint });
    const changed = new Set<string>();
    await checkPasses(page, snapshot, passes, changed);
    // The Locker too, swapping on the stage itself (it carries its own attributes, so a swap on the document does
    // not reach it): the stage's Dee finish at 40px and the moment's mark live there.
    await page.locator('[data-testid="tab-you"]').click();
    await page.locator('[data-testid="tab-locker"]').click();
    await page.waitForSelector('[data-testid="locker-stage"]');
    await page.waitForTimeout(300);
    const onStage = new Set<string>();
    await checkPasses(page, snapshot, passes, onStage, '[data-testid="locker-stage"]');
    for (const p of onStage) changed.add(p);
    for (const kind of ['background-image', 'stroke', 'stroke-opacity']) expect([...onStage], `stage ${kind}`).toContain(kind);
    const leaks = [...changed].filter((p) => !p.startsWith('--') && !PAINT.test(p));
    expect(leaks, 'non-paint properties a cosmetic changed').toEqual([]);
    // And the oracle sees each kind of paint change at all.
    for (const kind of ['background-image', 'stroke']) expect([...changed], kind).toContain(kind);
  } finally {
    await app.close();
  }
});

type Snapshot = Record<string, { rect: number[]; styles: Record<string, string> }>;

/** Each pass sets its attributes on `target` (the document by default), compares, then puts them back. */
async function checkPasses(page: Page, snapshot: () => Promise<Snapshot>, passes: Record<string, string>[], changed: Set<string>, target = 'html'): Promise<void> {
  const before = await snapshot();
  {
    for (const attrs of passes) {
      const prior = await page.evaluate(([t, a]) => {
        const el = document.querySelector(t) as HTMLElement;
        const was: Record<string, string | null> = {};
        for (const [k, v] of Object.entries(a)) {
          was[k] = el.getAttribute(`data-${k}`);
          el.setAttribute(`data-${k}`, v);
        }
        return was;
      }, [target, attrs] as const);
      const after = await snapshot();
      expect(Object.keys(after)).toEqual(Object.keys(before));
      for (const [key, b] of Object.entries(before)) {
        const a = after[key];
        expect(a.rect, `${key} moved under ${JSON.stringify(attrs)}`).toEqual(b.rect);
        for (const [prop, v] of Object.entries(b.styles)) if (a.styles[prop] !== v) changed.add(prop);
      }
      await page.evaluate(([t, was]) => {
        const el = document.querySelector(t) as HTMLElement;
        for (const [k, v] of Object.entries(was)) {
          if (v === null) el.removeAttribute(`data-${k}`);
          else el.setAttribute(`data-${k}`, v);
        }
      }, [target, prior] as const);
    }
  }
}

test('keyboard: wearing an item leaves focus on its tile, not on <body>', async () => {
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, STATE), JSON.stringify({ schemaVersion: 2, progression: { milestones: { achieved: { 'depth-40': { day: 20360 } } } } }));
  const app = await launchApp({ userDataDir: dir });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="home-screen"]');
    await openLocker(page);
    await page.locator('[data-testid="locker-item"][data-id="back-the-seal"]').focus();
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="locker-equip"]').focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => htmlAttr(page, 'data-back')).toBe('the-seal');
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.id ?? document.activeElement?.tagName)).toBe('back-the-seal');
  } finally {
    await app.close();
  }
});

test('an item a newer build wore: no tile claims "In use", and the default can be worn to replace it', async () => {
  const dir = freshDir();
  fs.writeFileSync(
    path.join(dir, STATE),
    JSON.stringify({ schemaVersion: 2, progression: { cosmetics: { owned: ['back-from-newer'], equipped: { cardBack: 'back-from-newer' } } } }),
  );
  const app = await launchApp({ userDataDir: dir });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="home-screen"]');
    expect(await htmlAttr(page, 'data-back')).toBeNull();
    await openLocker(page);
    await expect(page.locator('[data-testid="locker-item"][data-equipped="true"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="locker-equip"]')).toBeEnabled();
    await page.locator('[data-testid="locker-equip"]').click();
    await expect.poll(() => readState(dir).progression?.cosmetics?.equipped?.cardBack ?? null).toBeNull();
    await expect(page.locator('[data-testid="locker-item"][data-id="back-graphite"]')).toHaveAttribute('data-equipped', 'true');
  } finally {
    await app.close();
  }
});

test('a preview on the stage paints exactly what wearing it paints, whatever is worn', async () => {
  const app = await launchApp({ userDataDir: freshDir() });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="home-screen"]');
    await openLocker(page);
    // The painted surfaces of every slot on the stage, read as computed styles.
    const read = () =>
      page.evaluate(() => {
        const stage = document.querySelector('[data-testid="locker-stage"]') as HTMLElement;
        const back = getComputedStyle(stage.querySelector('.card-back') as Element);
        const lit = getComputedStyle(stage, '::before');
        const bet = getComputedStyle(stage.querySelector('.locker-bet') as Element);
        const fin = getComputedStyle(stage.querySelector('.dee-finish') as Element);
        const mark = getComputedStyle(stage.querySelector('.locker-moment-mark') as Element);
        return [back.backgroundImage, back.backgroundColor, back.boxShadow, lit.backgroundImage, bet.backgroundColor, bet.borderTopColor, fin.stroke, fin.strokeOpacity, mark.backgroundImage, mark.animationName].join(' | ');
      });
    const set = (el: 'html' | 'stage', attrs: Record<string, string>) =>
      page.evaluate(([el, attrs]) => {
        const t = el === 'html' ? document.documentElement : (document.querySelector('[data-testid="locker-stage"]') as HTMLElement);
        for (const [k, v] of Object.entries(attrs as Record<string, string>)) t.setAttribute(`data-${k}`, v);
      }, [el, attrs] as const);
    const slots = [...new Set(CATALOGUE.map((i) => i.slot))];
    for (const slot of slots) {
      const attr = SLOT_ATTRIBUTE[slot];
      const items = CATALOGUE.filter((i) => i.slot === slot);
      for (const worn of items) {
        for (const shown of items) {
          // Worn on the document, previewed on the stage…
          await set('html', Object.fromEntries(slots.map((s) => [SLOT_ATTRIBUTE[s], CATALOGUE.filter((i) => i.slot === s).at(-1)!.paint])));
          await set('html', { [attr]: worn.paint });
          await set('stage', { [attr]: shown.paint });
          const previewed = await read();
          // …against the same item worn, with nothing else different.
          await set('html', { [attr]: shown.paint });
          expect(await read(), `${shown.id} previewed while ${worn.id} is worn`).toBe(previewed);
        }
      }
    }
  } finally {
    await app.close();
  }
});

test('previewing an earned item does not wear it; leaving the Locker keeps what was worn', async () => {
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, STATE), JSON.stringify({ schemaVersion: 2, progression: { milestones: { achieved: { 'depth-40': { day: 20360 } } } } }));
  const app = await launchApp({ userDataDir: dir });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="home-screen"]');
    await openLocker(page);
    await page.locator('[data-testid="locker-item"][data-id="back-the-seal"]').click();
    await expect(page.locator('[data-testid="locker-stage"]')).toHaveAttribute('data-back', 'the-seal');
    await expect(page.locator('[data-testid="locker-equip"]')).toHaveText('Use this back');
    expect(await htmlAttr(page, 'data-back')).toBeNull();
    await page.locator('[data-testid="tab-home"]').click();
    await page.click(sel.newHand);
    await page.waitForSelector('[data-testid="table-screen"]');
    expect(await htmlAttr(page, 'data-back')).toBeNull();
    expect(readState(dir).progression?.cosmetics?.equipped?.cardBack ?? null).toBeNull();
  } finally {
    await app.close();
  }
});

test('Chalk: the balance and today’s curve show; a priced item takes two presses, spends its fixed price and is saved', async () => {
  const dir = freshDir();
  const NOW = new Date(2026, 9, 20, 20, 0, 0).getTime();
  const today = systemDayKeyOf()(NOW);
  // 600 Chalk on file, and 180 Reps awarded today that the next save pays (150 + 15 = 165 Chalk).
  fs.writeFileSync(
    path.join(dir, STATE),
    JSON.stringify({
      schemaVersion: 2,
      progression: {
        reps: { total: 180, awards: [{ key: 'hand:1', reps: 180, day: today }] },
        cosmetics: { chalk: { balance: 600, day: today - 1, earnedToday: 225 } },
      },
    }),
  );
  const app = await launchApp({ userDataDir: dir, env: { OFFSUIT_NOW: String(NOW) } });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="home-screen"]');
    await openLocker(page);
    // 600 on file plus the 165 today's Reps earn, which the next save files.
    await expect(page.locator('[data-testid="locker-chalk-balance"]')).toHaveText('765 Chalk');
    await expect(page.locator('[data-testid="locker-foot"]')).toContainText('at most 225 a day');
    // Too dear: the button says how far, and is off.
    await page.locator('[data-testid="locker-item"][data-id="back-night-weave"]').click();
    await expect(page.locator('[data-testid="locker-equip"]')).toHaveText('235 more Chalk to go');
    await expect(page.locator('[data-testid="locker-equip"]')).toBeDisabled();
    // Affordable: two presses. Choosing another item in between cancels the first.
    const use = page.locator('[data-testid="locker-equip"]');
    await page.locator('[data-testid="locker-item"][data-id="back-herringbone"]').click();
    await expect(use).toHaveText('Spend 450 Chalk');
    await use.click();
    await expect(use).toHaveText('Confirm: spend 450 Chalk');
    await page.locator('[data-testid="locker-item"][data-id="back-linen"]').click();
    await page.locator('[data-testid="locker-item"][data-id="back-herringbone"]').click();
    await expect(use).toHaveText('Spend 450 Chalk');
    expect(readState(dir).progression?.cosmetics?.owned ?? []).not.toContain('back-herringbone');
    await use.click();
    // The confirm counts only after a pause (a double-click is one press).
    await page.waitForTimeout(600);
    await use.click();
    // 600 + today's 165 - 450.
    await expect(page.locator('[data-testid="locker-chalk-balance"]')).toHaveText('315 Chalk');
    await expect(page.locator('[data-testid="locker-chalk-today"]')).toHaveText('165 of 225 earned today');
    await expect(page.locator('[data-testid="locker-item"][data-id="back-herringbone"]')).toHaveAttribute('data-owned', 'true');
    await expect(use).toHaveText('Use this back');
    await expect.poll(() => readState(dir).progression?.cosmetics?.chalk?.balance).toBe(315);
    const cos = readState(dir).progression.cosmetics;
    expect(cos.owned).toContain('back-herringbone');
    expect(cos.receipts.find((r: { itemId: string }) => r.itemId === 'back-herringbone')).toMatchObject({ chalk: 450, day: today });
    expect(cos.chalk).toMatchObject({ day: today, earnedToday: 165 });
    // The bankroll is untouched by any of it.
    expect(readState(dir).bankroll ?? 10000).toBe(10000);
    await use.click();
    await expect.poll(() => htmlAttr(page, 'data-back')).toBe('herringbone');
    for (const [w, h] of [[900, 640], [1100, 760]]) {
      await size(app, w, h);
      const [sh, ih] = await page.evaluate(() => [document.documentElement.scrollHeight, innerHeight]);
      expect(sh).toBeLessThanOrEqual(ih);
      // The busiest slot (12 backs, three rows) never runs into the footer or out of the column.
      const [gridBottom, footTop, footBottom, colBottom] = await page.evaluate(() => {
        const r = (q: string) => (document.querySelector(q) as HTMLElement).getBoundingClientRect();
        // The lowest tile, not the grid's own box: rows that overflow the grid do not grow its rect.
        const tiles = Math.max(...[...document.querySelectorAll('[data-testid="locker-item"]')].map((t) => t.getBoundingClientRect().bottom));
        return [tiles, r('[data-testid="locker-foot"]').top, r('[data-testid="locker-foot"]').bottom, r('.locker-right').bottom];
      });
      expect(gridBottom, `${w}x${h}: tiles clear the footer`).toBeLessThanOrEqual(footTop);
      expect(footBottom, `${w}x${h}: the footer stays in the column`).toBeLessThanOrEqual(colBottom + 1);
    }
  } finally {
    await app.close();
  }
});

const CHALK_NOW = new Date(2026, 9, 20, 20, 0, 0).getTime();
/** 600 Chalk filed yesterday, and 180 Reps today that the curve turns into 165 more. */
function chalkProfile(extra: Record<string, unknown> = {}): string {
  const today = systemDayKeyOf()(CHALK_NOW);
  const dir = freshDir();
  fs.writeFileSync(
    path.join(dir, STATE),
    JSON.stringify({
      schemaVersion: 2,
      ...extra,
      progression: {
        reps: { total: 180, awards: [{ key: 'hand:1', reps: 180, day: today }] },
        cosmetics: { chalk: { balance: 600, day: today - 1, earnedToday: 225 } },
      },
    }),
  );
  return dir;
}

test('Chalk: the balance includes what today’s Reps earn before any save files it', async () => {
  const app = await launchApp({ userDataDir: chalkProfile(), env: { OFFSUIT_NOW: String(CHALK_NOW) } });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="home-screen"]');
    await openLocker(page);
    await expect(page.locator('[data-testid="locker-chalk-balance"]')).toHaveText('765 Chalk');
    await expect(page.locator('[data-testid="locker-chalk-today"]')).toHaveText('165 of 225 earned today');
    await page.locator('[data-testid="locker-item"][data-id="back-night-weave"]').click();
    await expect(page.locator('[data-testid="locker-equip"]')).toHaveText('235 more Chalk to go');
  } finally {
    await app.close();
  }
});

test('Chalk: a double-click on Spend is one press, never a confirmed purchase', async () => {
  const dir = chalkProfile();
  const app = await launchApp({ userDataDir: dir, env: { OFFSUIT_NOW: String(CHALK_NOW) } });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="home-screen"]');
    await openLocker(page);
    await page.locator('[data-testid="locker-item"][data-id="back-herringbone"]').click();
    await page.locator('[data-testid="locker-equip"]').dblclick();
    await page.waitForTimeout(800);
    await expect(page.locator('[data-testid="locker-item"][data-id="back-herringbone"]')).toHaveAttribute('data-owned', 'false');
    await expect(page.locator('[data-testid="locker-equip"]')).toHaveText('Confirm: spend 450 Chalk');
    expect(readState(dir).progression?.cosmetics?.owned ?? []).not.toContain('back-herringbone');
  } finally {
    await app.close();
  }
});

test('Chalk: a read-only profile (from a newer build) cannot spend', async () => {
  const app = await launchApp({ userDataDir: chalkProfile({ schemaVersion: 99 }), env: { OFFSUIT_NOW: String(CHALK_NOW) } });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="home-screen"]');
    await openLocker(page);
    await page.locator('[data-testid="locker-item"][data-id="back-herringbone"]').click();
    await expect(page.locator('[data-testid="locker-equip"]')).toBeDisabled();
    await expect(page.locator('[data-testid="locker-equip"]')).toHaveText('Read-only profile');
  } finally {
    await app.close();
  }
});
