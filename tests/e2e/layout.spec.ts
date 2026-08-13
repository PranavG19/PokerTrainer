import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, sel, shot } from './helpers.js';
import { playToShowdown, tableScreen, waitForIdle } from './flow.js';

/**
 * LAYOUT — the app must be *usable* at the window sizes SPEC.md promises
 * ("Window | 1100x760, non-resizable-min 900x640").
 *
 * Why this file exists: this project has already shipped one layout regression of exactly this
 * class — the stats sheet was a `position: fixed` bottom sheet that covered the action pills,
 * making them unclickable. Nothing in the suite would have caught it, because every other e2e
 * test drives the DOM and never asks where anything actually is. These tests assert *geometry*:
 * each control's bounding rect must lie inside the viewport. No pixel comparisons, no golden
 * images — just "can the player see and reach this".
 */

const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 760;
/** SPEC.md's documented floor, and main.ts's minWidth/minHeight. */
const MIN_WIDTH = 900;
const MIN_HEIGHT = 640;

/** Every control R3 gives the player. If one of these is off-screen the hand cannot be played. */
const CONTROL_IDS = [
  'btn-fold',
  'btn-check',
  'btn-call',
  'btn-raise',
  'raise-slider',
  'preset-half',
  'preset-threequarter',
  'preset-pot',
  'preset-allin',
  'stats-toggle',
] as const;

interface Box {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
  /** null when the element's own centre point hit-tests to itself; otherwise what covers it. */
  coveredBy: string | null;
}

interface Viewport {
  innerWidth: number;
  innerHeight: number;
  scrollX: number;
  scrollY: number;
  scrollHeight: number;
  /**
   * BOTH AXES, because for a long time this file measured only height and a real overflow shipped
   * behind that gap: the tab bar outgrew the documented 900px minimum when the eleventh tab landed —
   * twelve labels needed 968px of bar in a 900px window, so Settings sat off screen — and it stayed
   * green through the whole suite because nothing here read scrollWidth. Width is now part of the
   * shared reading, so every test in this file gets the assertion for free.
   */
  scrollWidth: number;
}

interface Geometry {
  viewport: Viewport;
  boxes: Record<string, Box | null>;
}

/** One evaluate call, so the viewport and every rect describe the same frame. */
async function readGeometry(page: Page, testIds: readonly string[]): Promise<Geometry> {
  return page.evaluate((ids: string[]) => {
    const describe = (el: Element): string =>
      `<${el.tagName.toLowerCase()}${el.className === '' ? '' : ` class="${String(el.className)}"`}>`;

    /**
     * Hit-test the element's own centre. "Inside the viewport" is not enough — the original
     * regression left the pills at valid coordinates with a fixed sheet painted on top of them.
     */
    const occluder = (el: Element, r: DOMRect): string | null => {
      if (r.width === 0 || r.height === 0) return null;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit === null) return 'nothing (point is outside the viewport)';
      if (hit === el || el.contains(hit) || hit.contains(el)) return null;
      return describe(hit);
    };

    const boxes: Record<string, Box | null> = Object.fromEntries(
      ids.map((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (el === null) return [id, null];
        const r = el.getBoundingClientRect();
        return [
          id,
          {
            top: r.top,
            right: r.right,
            bottom: r.bottom,
            left: r.left,
            width: r.width,
            height: r.height,
            coveredBy: occluder(el, r),
          },
        ];
      }),
    );
    return {
      viewport: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight,
        scrollWidth: document.documentElement.scrollWidth,
      },
      boxes,
    };
  }, [...testIds]);
}

/**
 * Assert every named element is fully on screen, one expect per edge per element, so a failure
 * report names the offender instead of saying "something is off-screen".
 */
function expectInsideViewport(label: string, geometry: Geometry): void {
  const { viewport, boxes } = geometry;

  // Rects are viewport-relative; a scrolled page would make them describe a view the player is
  // not looking at when the app opens. Nothing in the app scrolls itself, so this pins the frame.
  expect(viewport.scrollY, `${label}: page was scrolled vertically before measuring`).toBe(0);
  expect(viewport.scrollX, `${label}: page was scrolled horizontally before measuring`).toBe(0);

  for (const [id, box] of Object.entries(boxes)) {
    expect(box, `${label}: "${id}" is not in the DOM at all`).not.toBeNull();
    if (box === null) continue;

    const where = `rect={top:${box.top.toFixed(1)} right:${box.right.toFixed(1)} bottom:${box.bottom.toFixed(1)} left:${box.left.toFixed(1)}} viewport=${viewport.innerWidth}x${viewport.innerHeight}`;

    // A zero-size rect is invisible even when its edges are technically "inside".
    expect(box.width, `${label}: "${id}" has zero width — ${where}`).toBeGreaterThan(0);
    expect(box.height, `${label}: "${id}" has zero height — ${where}`).toBeGreaterThan(0);

    expect(box.top, `${label}: "${id}" is cut off above the viewport — ${where}`).toBeGreaterThanOrEqual(0);
    expect(box.left, `${label}: "${id}" is cut off left of the viewport — ${where}`).toBeGreaterThanOrEqual(0);
    expect(box.bottom, `${label}: "${id}" hangs below the fold — ${where}`).toBeLessThanOrEqual(
      viewport.innerHeight,
    );
    expect(box.right, `${label}: "${id}" hangs past the right edge — ${where}`).toBeLessThanOrEqual(
      viewport.innerWidth,
    );

    expect(
      box.coveredBy,
      `${label}: "${id}" is on screen but something is painted over it: ${String(box.coveredBy)} — ${where}`,
    ).toBeNull();
  }
}

/**
 * Block until the table's box stops changing, by polling the rect across animation frames.
 * A resize is asynchronous (window metrics change, then Blink relayouts, then paints) and a
 * fixed sleep would be either flaky or slow; two identical consecutive reads is the real signal.
 */
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

/**
 * Resize the real BrowserWindow, then pin the render viewport to the same numbers.
 *
 * Both halves are deliberate. setSize() is the honest call — it goes through Electron and is
 * subject to the minWidth/minHeight in main.ts (test 5 leans on exactly that). But a developer
 * machine may run a tiling window manager, and one WILL override an app's chosen bounds moments
 * after the window is shown; this machine runs AeroSpace, which snaps the window to its tile and
 * makes setSize() cosmetic. Pinning the viewport with Emulation.setDeviceMetricsOverride makes
 * the layout assertions describe the size SPEC.md documents regardless of the host WM. It cannot
 * hide a real defect: what is under test is the layout at a 900x640 viewport, and the window's
 * own size clamping is proved separately and without emulation in test 5.
 */
async function useViewport(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  const applied = await app.evaluate(
    async ({ BrowserWindow }, size: { width: number; height: number }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(size.width, size.height);
      return win.getSize();
    },
    { width, height },
  );
  expect(applied, `setSize(${width}, ${height}) was rejected by Electron`).toEqual([width, height]);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await page.waitForFunction(
    (want: { width: number; height: number }) =>
      window.innerWidth === want.width && window.innerHeight === want.height,
    { width, height },
  );
  await settleLayout(page);
}

/**
 * Shut the app down without letting teardown decide the test's fate.
 *
 * app.close() waits for a graceful Electron exit, and roughly one launch in ten on macOS never
 * delivers it — measured 1 hang in 10 full runs of this file, all inside close(), with the
 * assertions already green. That is a shared-helper/Electron issue, not a layout defect, and the
 * helper is off limits to edit, so bound the wait here and SIGKILL the process group as a
 * fallback. A leaked Electron process is the only thing at risk, and this prevents that too.
 */
async function closeApp(app: ElectronApplication, close: () => Promise<void>): Promise<void> {
  const pid = app.process().pid;
  const graceful = await Promise.race([
    close().then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000)),
  ]);
  if (!graceful && pid !== undefined) {
    process.kill(pid, 'SIGKILL');
  }
}

/** Launch, deal a hand, hand the caller a table parked on the hero's decision, always close. */
async function withTable(
  body: (ctx: { app: ElectronApplication; page: Page }) => Promise<void>,
): Promise<void> {
  const { app, page, close } = await launchApp({ seed: 42 });
  try {
    await page.locator(sel.newHand).click();
    await page.locator(tableScreen).waitFor();
    expect(await waitForIdle(page), 'expected the hero to be on turn').toBe('hero');
    await body({ app, page });
  } finally {
    await closeApp(app, close);
  }
}

test.describe('layout', () => {
  test('1. every control is inside the viewport at the default 1100x760', async () => {
    await withTable(async ({ app, page }) => {
      await useViewport(app, page, DEFAULT_WIDTH, DEFAULT_HEIGHT);
      const geometry = await readGeometry(page, CONTROL_IDS);
      expect(geometry.viewport.innerWidth).toBe(DEFAULT_WIDTH);
      expect(geometry.viewport.innerHeight).toBe(DEFAULT_HEIGHT);
      expectInsideViewport(`${DEFAULT_WIDTH}x${DEFAULT_HEIGHT}`, geometry);
    });
  });

  test('2. every control is inside the viewport at the documented minimum 900x640', async () => {
    await withTable(async ({ app, page }) => {
      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT);
      const geometry = await readGeometry(page, CONTROL_IDS);
      expect(geometry.viewport.innerWidth).toBe(MIN_WIDTH);
      expect(geometry.viewport.innerHeight).toBe(MIN_HEIGHT);
      expectInsideViewport(`${MIN_WIDTH}x${MIN_HEIGHT}`, geometry);
    });
  });

  test('3a. the document does not scroll at 1100x760', async () => {
    await withTable(async ({ app, page }) => {
      await useViewport(app, page, DEFAULT_WIDTH, DEFAULT_HEIGHT);
      const { viewport } = await readGeometry(page, []);
      // +1 absorbs sub-pixel rounding in fractional element heights.
      expect(
        viewport.scrollHeight,
        `content is ${viewport.scrollHeight}px tall in a ${viewport.innerHeight}px viewport — a scrollbar means the table overflowed`,
      ).toBeLessThanOrEqual(viewport.innerHeight + 1);
      expect(
        viewport.scrollWidth,
        `content is ${viewport.scrollWidth}px wide in a ${viewport.innerWidth}px viewport`,
      ).toBeLessThanOrEqual(viewport.innerWidth + 1);
    });
  });

  /**
   * Regression guard for a real overflow that shipped once: the vertical stack measured 694px of
   * content in a 640px viewport (770px with the coach panel visible), so the app grew a scrollbar
   * at its own documented minimum and the win% readout fell below the fold. Fixed by trimming the
   * chrome padding, seat pods and hero row — never the controls, which must stay reachable.
   */
  test('3b. the document does not scroll at 900x640', async () => {
    await withTable(async ({ app, page }) => {
      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT);
      const { viewport } = await readGeometry(page, []);
      expect(
        viewport.scrollHeight,
        `content is ${viewport.scrollHeight}px tall in a ${viewport.innerHeight}px viewport — a scrollbar means the table overflowed`,
      ).toBeLessThanOrEqual(viewport.innerHeight + 1);
      expect(
        viewport.scrollWidth,
        `content is ${viewport.scrollWidth}px wide in a ${viewport.innerWidth}px viewport`,
      ).toBeLessThanOrEqual(viewport.innerWidth + 1);
    });
  });

  /**
   * THE TAB BAR, MEASURED AS A WHOLE, at the documented minimum.
   *
   * This is the one piece of chrome that grows every time a feature ships, and no individual
   * feature's tests own it — which is how it came to overflow. Measured at the twelfth tab: 840px of
   * label boxes plus 88px of gap plus 40px of bar padding = 968px in a 900px window, with the last
   * tab ending at 948px. Every other layout test in the app passed throughout.
   *
   * So the assertion is on the LAST TAB'S RIGHT EDGE rather than on the document width. A document
   * assertion can be satisfied by a bar that clips or scrolls internally while a tab is still
   * unreachable; the right edge is the fact that matters, because a tab you cannot see is a tab you
   * cannot click, and N1 forbids the surface being locked away.
   */
  test('3c. every tab is reachable at the documented minimum 900x640', async () => {
    await withTable(async ({ app, page }) => {
      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT);
      const bar = await page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll('.tab')) as HTMLElement[];
        const rects = tabs.map((tab) => tab.getBoundingClientRect());
        return {
          count: tabs.length,
          labels: tabs.map((tab) => tab.textContent ?? ''),
          rightmost: Math.max(...rects.map((r) => r.right)),
          bottommost: Math.max(...rects.map((r) => r.bottom)),
          offscreen: tabs
            .filter((_, i) => rects[i].right > window.innerWidth + 1)
            .map((tab) => tab.textContent ?? ''),
        };
      });

      // A sanity floor: if the bar ever renders no tabs the assertions below would pass vacuously.
      // Lowered from 10 when the 13-tab bar was folded to 8 (Play·Learn·Train·Charts·Dossier·Progress·
      // Profile·Settings) — the six practice/maintenance modes now live behind the Train hub's left rail.
      expect(bar.count, 'no tabs rendered, so this test proves nothing').toBeGreaterThanOrEqual(6);
      expect(
        bar.offscreen,
        `${bar.offscreen.length} of ${bar.count} tabs extend past the ${MIN_WIDTH}px viewport (rightmost edge ${Math.round(bar.rightmost)}px): ${bar.offscreen.join(', ')}`,
      ).toEqual([]);
      // And the bar must not have solved it by growing downward into the screen's budget.
      expect(
        bar.bottommost,
        `the tab bar is ${Math.round(bar.bottommost)}px tall, which it takes out of every screen below it`,
      ).toBeLessThanOrEqual(52);
    });
  });

  test('4. hero hole cards and the board are both visible at showdown at 900x640', async () => {
    await withTable(async ({ app, page }) => {
      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT);
      await playToShowdown(page);
      await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'handover');
      await settleLayout(page);

      // The teaching layer is worthless if the player cannot see the cards it is talking about.
      const geometry = await readGeometry(page, ['hero-cards', 'board']);
      expectInsideViewport(`showdown ${MIN_WIDTH}x${MIN_HEIGHT}`, geometry);

      // Guard against the rects being satisfied by empty containers.
      await expect(page.locator(sel.heroCards).locator(sel.card)).toHaveCount(2);
      await expect(page.locator(sel.board).locator(sel.card)).toHaveCount(5);

      // Each individual card must be on screen too, not just the row's box.
      const cardBoxes = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="hero-cards"] [data-testid="card"], [data-testid="board"] [data-testid="card"]')].map(
          (el) => {
            const r = el.getBoundingClientRect();
            return {
              card: el instanceof HTMLElement ? (el.dataset.card ?? '?') : '?',
              top: r.top,
              right: r.right,
              bottom: r.bottom,
              left: r.left,
            };
          },
        ),
      );
      expect(cardBoxes).toHaveLength(7);
      for (const card of cardBoxes) {
        expect(card.top, `card ${card.card} above the viewport`).toBeGreaterThanOrEqual(0);
        expect(card.left, `card ${card.card} left of the viewport`).toBeGreaterThanOrEqual(0);
        expect(card.bottom, `card ${card.card} below the fold`).toBeLessThanOrEqual(MIN_HEIGHT);
        expect(card.right, `card ${card.card} past the right edge`).toBeLessThanOrEqual(MIN_WIDTH);
      }
    });
  });

  test('5. the window refuses to shrink below its 900x640 minimum', async () => {
    const { app, close } = await launchApp({ seed: 42 });
    try {
      // Read back inside the same evaluate: this is Electron's own clamp, measured before any
      // window manager on the host has a chance to reposition or retile the window.
      const probe = await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        const minimum = win.getMinimumSize();
        win.setSize(400, 300);
        return { minimum, afterTiny: win.getSize() };
      });

      expect(probe.minimum, 'main.ts must declare minWidth 900 / minHeight 640').toEqual([
        MIN_WIDTH,
        MIN_HEIGHT,
      ]);
      const [width, height] = probe.afterTiny;
      expect(width, `setSize(400, 300) let the window shrink to ${width}px wide`).toBeGreaterThanOrEqual(MIN_WIDTH);
      expect(height, `setSize(400, 300) let the window shrink to ${height}px tall`).toBeGreaterThanOrEqual(MIN_HEIGHT);
    } finally {
      await closeApp(app, close);
    }
  });

  test('6. the open stats sheet does not cover the action pills at 900x640', async () => {
    await withTable(async ({ app, page }) => {
      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT);

      const sheet = page.locator(sel.statsSheet);
      await expect(sheet).toHaveAttribute('data-open', 'false');

      // Toggle via the DOM, not a Playwright click. A click auto-waits for the toggle to be
      // hittable, so if the sheet were covering it this test would die of a click timeout —
      // true, but it would report "locator.click timed out" instead of naming the overlay.
      // Dispatching the event unconditionally lets the geometry assertion below be the oracle.
      await page.evaluate(() => {
        const toggle = document.querySelector('[data-testid="stats-toggle"]');
        if (!(toggle instanceof HTMLButtonElement)) throw new Error('stats-toggle missing');
        toggle.click();
      });
      await expect(sheet).toHaveAttribute('data-open', 'true');
      await settleLayout(page);

      // The regression that already happened: the sheet was position:fixed and painted over the
      // controls. readGeometry hit-tests each pill's centre, so "on screen but buried" fails too.
      expectInsideViewport(
        `stats open ${MIN_WIDTH}x${MIN_HEIGHT}`,
        await readGeometry(page, CONTROL_IDS),
      );

      // And prove it for real: Playwright's click does the full visible/stable/hittable check.
      await page.locator(sel.btnFold).click({ trial: true, timeout: 5_000 });
    });
  });

  test('7. screenshots at both documented sizes', async () => {
    await withTable(async ({ app, page }) => {
      await useViewport(app, page, DEFAULT_WIDTH, DEFAULT_HEIGHT);
      await shot(page, 'layout-1100x760');

      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT);
      await shot(page, 'layout-900x640');
    });
  });

  test('8. an OPEN stats sheet does not overflow the documented minimum', async () => {
    await withTable(async ({ app, page }) => {
      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT);
      await page.locator('[data-testid="stats-toggle"]').click();
      await expect(page.locator('[data-testid="stats-sheet"]')).toHaveAttribute('data-open', 'true');

      // The sheet used to push the page to 725px in a 640px viewport, leaving the last of seven
      // made-hand rows 65px below the fold — the coaching readout could not be fully opened at the
      // app's own minimum size. The category list scrolls itself now, so the page never does.
      const geo = await page.evaluate(() => {
        const body = document.querySelector('.stats-body') as HTMLElement;
        const win = document.querySelector('[data-testid="win-pct"]')!.getBoundingClientRect();
        const fold = document.querySelector('[data-testid="btn-fold"]')!.getBoundingClientRect();
        return {
          scrollHeight: document.documentElement.scrollHeight,
          innerHeight: window.innerHeight,
          winBottom: win.bottom,
          foldBottom: fold.bottom,
          rows: document.querySelectorAll('.stats-cat').length,
          bodyClips: body.scrollHeight > body.clientHeight,
        };
      });

      expect(geo.scrollHeight, 'the page must not scroll with the sheet open').toBeLessThanOrEqual(
        geo.innerHeight + 1,
      );
      expect(geo.winBottom, 'the win% headline stays on screen').toBeLessThanOrEqual(geo.innerHeight);
      expect(geo.foldBottom, 'the action pills stay on screen').toBeLessThanOrEqual(geo.innerHeight);
      // All the rows still exist — they are reachable by scrolling the sheet, not deleted.
      expect(geo.rows).toBeGreaterThan(0);
      expect(geo.bodyClips, 'the sheet body is what scrolls').toBe(true);
    });
  });
});
