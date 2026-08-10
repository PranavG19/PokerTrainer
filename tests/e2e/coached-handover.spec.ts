import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, sel, shot } from './helpers.js';
import { tableScreen, waitForIdle } from './flow.js';

/**
 * COACHED HANDOVER GEOMETRY at the documented 900x640 minimum.
 *
 * Found by looking at the screen, not by an assertion. layout.spec.ts pins "every control is
 * inside the viewport", but only mid-hand and only with coached mode OFF; predict.spec.ts test 16
 * pins "no scrollbar at 900x640", but only mid-hand with the coach panel silent. Neither reaches
 * the state a coached learner hits constantly: handover, right after a graded mistake, with the
 * coach line AND the prediction verdict both on screen.
 *
 * In that state the column stacked seats + centre + hero row + coach panel + predict panel +
 * controls and pushed "Next hand" 27px below the fold. It is the ONLY usable control at handover,
 * so the hand could not be continued from what the player could see — the same defect class as the
 * action pills that already shipped below the 760px fold, and the same class as the busted hero
 * who could click "Next hand" forever. Playwright's click auto-scrolls, which is exactly why no
 * existing test noticed.
 *
 * Seed 8 hand 1 is the spot coach.spec.ts and predict.spec.ts already pin: hero holds QsQh,
 * calling 50 preflop is FREE, then folding for 99 into a 348 pot throws away 3.9bb and grades
 * SERIOUS. The fold also ends the hand, so one line reaches handover with the coach speaking.
 */

const MIN_WIDTH = 900;
const MIN_HEIGHT = 640;

const predictPanel = '[data-testid="predict-panel"]';
const predictResult = '[data-testid="predict-result"]';
const modeToggle = '[data-testid="coach-mode-toggle"]';
const nextHand = '[data-testid="next-hand"]';
const coachPanel = '.coach';

/** Local to this file: tests/e2e/helpers.ts and flow.ts are shared and off limits. */
function freshUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-coached-handover-'));
}

/**
 * Resize the real window, then pin the render viewport. Same two-part approach and same reason as
 * layout.spec.ts: a tiling window manager on the host can override setSize() moments after the
 * window is shown, and the assertions must describe the size SPEC.md documents.
 */
async function useViewport(app: ElectronApplication, page: Page): Promise<void> {
  await app.evaluate(async ({ BrowserWindow }, size: { width: number; height: number }) => {
    BrowserWindow.getAllWindows()[0].setSize(size.width, size.height);
  }, { width: MIN_WIDTH, height: MIN_HEIGHT });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: MIN_WIDTH,
    height: MIN_HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.waitForFunction(
    (want: { width: number; height: number }) =>
      window.innerWidth === want.width && window.innerHeight === want.height,
    { width: MIN_WIDTH, height: MIN_HEIGHT },
  );
  await settleLayout(page);
}

/** Two identical consecutive frames is the real signal that a relayout finished. */
async function settleLayout(page: Page): Promise<void> {
  const settled = await page.evaluate(async () => {
    const nextFrame = (): Promise<void> =>
      new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    const read = (): string => {
      const r = document.querySelector('[data-testid="table-screen"]')?.getBoundingClientRect();
      return r === undefined ? 'absent' : `${r.width}x${r.height}@${r.top}`;
    };
    let previous = read();
    for (let i = 0; i < 180; i++) {
      await nextFrame();
      const current = read();
      if (current === previous && current !== 'absent') return true;
      previous = current;
    }
    return false;
  });
  expect(settled, 'table layout never stopped changing').toBe(true);
}

interface Box {
  top: number;
  bottom: number;
  belowFoldBy: number;
  /** null when the element's own centre point hit-tests to itself; otherwise what covers it. */
  coveredBy: string | null;
}

async function boxOf(page: Page, testid: string): Promise<Box> {
  const box = await page.evaluate((id: string) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hit = cy >= 0 && cy <= window.innerHeight ? document.elementFromPoint(cx, cy) : null;
    return {
      top: r.top,
      bottom: r.bottom,
      belowFoldBy: r.bottom - window.innerHeight,
      coveredBy:
        hit === null
          ? 'nothing (centre is outside the viewport)'
          : hit === el || el.contains(hit) || hit.contains(el)
            ? null
            : `<${hit.tagName.toLowerCase()} class="${String(hit.className)}">`,
    };
  }, testid);
  expect(box, `"${testid}" is not in the DOM`).not.toBeNull();
  return box as Box;
}

/** Sit down and park on the hero's first decision. Must happen before useViewport: settleLayout
 * measures the table root, which only exists once a session has started. */
async function sitDown(page: Page): Promise<void> {
  await page.locator(sel.newHand).click();
  await page.locator(tableScreen).waitFor();
  expect(await waitForIdle(page)).toBe('hero');
}

/**
 * Play seed 8 hand 1 in coached mode to a handover that has a SERIOUS coach grade up:
 * commit+call preflop (free, a match), then commit+fold the flop (3.9bb, ends the hand).
 */
async function reachGradedCoachedHandover(page: Page): Promise<void> {
  await page.locator(modeToggle).click();
  await expect(page.locator(modeToggle)).toHaveAttribute('data-on', 'true');
  await expect(page.locator(predictPanel)).toBeVisible();

  await page.locator('[data-testid="predict-call"]').click();
  await page.locator('[data-testid="confidence-sure"]').click();
  await page.locator(sel.btnCall).click();
  expect(await waitForIdle(page), 'seed 8 must give a second hero decision').toBe('hero');

  await page.locator('[data-testid="predict-fold"]').click();
  await page.locator('[data-testid="confidence-sure"]').click();
  await page.locator(sel.btnFold).click();
  expect(await waitForIdle(page)).toBe('handover');

  // The state under test is only interesting if the coach is actually speaking and the verdict
  // is up — that is what makes the column tall.
  await expect(page.locator(coachPanel)).toBeVisible();
  await expect(page.locator(coachPanel)).toHaveAttribute('data-severity', 'serious');
  await expect(page.locator(predictResult)).toBeVisible();
  await expect(page.locator(predictResult)).toHaveAttribute('data-outcome', 'sure-wrong');
}

test.describe('coached handover at the documented minimum size', () => {
  test('1. "Next hand" is on screen and clickable after a graded coached mistake at 900x640', async () => {
    const { app, page, close } = await launchApp({ seed: 8, userDataDir: freshUserDataDir() });
    try {
      await sitDown(page);
      await useViewport(app, page);
      await reachGradedCoachedHandover(page);
      await settleLayout(page);
      await shot(page, 'coached-graded-handover-900x640');

      const viewport = await page.evaluate(() => ({
        innerHeight: window.innerHeight,
        scrollY: window.scrollY,
      }));
      // Rects are viewport-relative, so a scrolled page would describe a view the player never
      // asked for. Nothing in the app scrolls itself; this pins the frame.
      expect(viewport.scrollY, 'the page scrolled itself before measuring').toBe(0);
      expect(viewport.innerHeight).toBe(MIN_HEIGHT);

      const box = await boxOf(page, 'next-hand');
      const where = `rect={top:${box.top.toFixed(1)} bottom:${box.bottom.toFixed(1)}} viewport height ${MIN_HEIGHT}`;

      // The whole point: at handover this is the only control that continues the session.
      expect(
        box.belowFoldBy,
        `"Next hand" hangs ${box.belowFoldBy.toFixed(1)}px below the fold — the only usable control at handover is off screen (${where})`,
      ).toBeLessThanOrEqual(0);
      expect(box.top, `"Next hand" is cut off above the viewport — ${where}`).toBeGreaterThanOrEqual(0);
      expect(
        box.coveredBy,
        `"Next hand" is on screen but painted over by ${String(box.coveredBy)} — ${where}`,
      ).toBeNull();

      // And prove it for real: Playwright's trial click runs the full visible/stable/hittable
      // check. It auto-scrolls first, which is why the geometry assertions above are the oracle.
      await page.locator(nextHand).click({ trial: true, timeout: 5_000 });
    } finally {
      await close();
    }
  });

  /**
   * The commit row is a *control* that at handover cannot do anything: there is no decision to
   * take, and nextHand() wipes any commitment made here. A live-looking dead control is the same
   * class of defect as the busted hero's "Next hand", and its height is what pushed the real
   * control off screen above.
   */
  test('2. the commit prompt and pills are gone at handover, and the verdict remains', async () => {
    const { app, page, close } = await launchApp({ seed: 8, userDataDir: freshUserDataDir() });
    try {
      await sitDown(page);
      await useViewport(app, page);
      await reachGradedCoachedHandover(page);
      await settleLayout(page);

      // The verdict is the one thing still true about the hand, so it stays.
      await expect(page.locator(predictResult)).toBeVisible();
      await expect(page.locator(predictResult)).toContainText('SURE');

      // "Commit first: which action, and how sure are you?" is false when there is no decision.
      await expect(page.locator(`${predictPanel} .predict-prompt`)).toBeHidden();
      for (const id of ['predict-fold', 'predict-check', 'predict-call', 'predict-raise', 'confidence-sure', 'confidence-guess']) {
        await expect(page.locator(`[data-testid="${id}"]`), `${id} must not look live at handover`).toBeHidden();
      }

      // ...and they come back for the next hand's first decision.
      await page.locator(nextHand).click();
      expect(await waitForIdle(page)).toBe('hero');
      await expect(page.locator(`${predictPanel} .predict-prompt`)).toBeVisible();
      await expect(page.locator('[data-testid="predict-fold"]')).toBeVisible();
      await expect(page.locator(predictResult)).toBeHidden();
    } finally {
      await close();
    }
  });
});
