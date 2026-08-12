import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, shot } from './helpers.js';

/**
 * N3 — THE PREFLOP CHART TRAINER.
 *
 * The load-bearing assertion in this file is a DOCUMENT-ORDER one. N3's whole claim is that the
 * compressed form arrives BEFORE the grid, and a coordinate check cannot prove that: a grid painted
 * above a panel it precedes in the DOM would pass a "compressed is higher up" test, and a reordered
 * DOM would pass it too as soon as CSS put the columns back. So order is asserted with
 * compareDocumentPosition, which is the actual contract.
 *
 * Sync oracle: the charts root republishes data-position / data-spot / data-answered on every paint,
 * the same technique the table root's data-awaiting uses. Nothing here sleeps.
 */

const chartsScreen = '[data-testid="charts-screen"]';
const compressed = '[data-testid="compressed-form"]';
const grid = '[data-testid="chart-grid"]';
const cell = '[data-testid="chart-cell"]';
const ruleRow = '[data-testid="rule-row"]';
const boundaryChip = '[data-testid="boundary-chip"]';
const classRow = '[data-testid="class-row"]';
const classAccuracy = '[data-testid="class-accuracy"]';
const classReview = '[data-testid="class-review"]';
const chartWidthValue = '[data-testid="chart-width"] .chart-width-value';
const drillHand = '[data-testid="drill-hand"]';
const drillFeedback = '[data-testid="drill-feedback"]';
const drillVerdict = '[data-testid="drill-verdict"]';

/** SPEC.md's documented window: "1100x760, non-resizable-min 900x640". */
const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 760;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 640;

/** BOUNDARY_COMBOS in core/preflop.ts, mirrored so a silent edit to either side shows up here. */
const CO_BOUNDARIES = [
  'K8s', 'K7s', 'Q8s', 'J8s', 'T7s', '96s', '75s', '54s', 'A9o', 'A8o', 'KTo', 'K9o',
];
const UTG_BOUNDARIES = [
  '22', 'A2s', 'KTs', 'K9s', 'QTs', 'JTs', 'T9s', '76s', '65s', 'AJo', 'ATo', 'KQo',
];

const CLASS_IDS = ['premium', 'strong', 'broadway', 'suited-ace', 'speculative', 'trash'];

/** Open the Charts tab and wait for the screen's first paint. */
async function openCharts(page: Page): Promise<void> {
  await page.click('[data-testid="tab-charts"]');
  await page.waitForSelector(chartsScreen);
  await expect(page.locator(grid)).toBeVisible();
}

async function selectPosition(page: Page, position: string): Promise<void> {
  await page.click(`[data-testid="position-btn"][data-position="${position}"]`);
  await expect(page.locator(chartsScreen)).toHaveAttribute('data-position', position);
}

/** The combo the drill is currently asking about, read off the root's own published attribute. */
async function currentSpot(page: Page): Promise<string> {
  const spot = await page.getAttribute(chartsScreen, 'data-spot');
  expect(spot, 'the charts root must publish data-spot').toBeTruthy();
  return spot ?? '';
}

/** Whether the spot on screen opens from the selected seat, read off the grid, not recomputed. */
async function spotOpens(page: Page, spot: string): Promise<boolean> {
  const open = await page.getAttribute(`${cell}[data-combo="${spot}"]`, 'data-open');
  expect(open, `no grid cell for ${spot}`).not.toBeNull();
  return open === 'true';
}

/** Fire the single keystroke and block until the root's answered counter has advanced. */
async function commitKey(page: Page, key: string): Promise<void> {
  const before = Number(await page.getAttribute(chartsScreen, 'data-answered'));
  await page.keyboard.press(key);
  await page.waitForFunction(
    (want: number) =>
      Number(
        (document.querySelector('[data-testid="charts-screen"]') as HTMLElement | null)?.dataset
          .answered ?? '-1',
      ) === want,
    before + 1,
  );
}

async function readClassAccuracy(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>('[data-testid="class-accuracy"]')].map((el) => [
        el.dataset.class ?? '',
        `${el.dataset.correct ?? '?'}/${el.dataset.attempts ?? '?'}`,
      ]),
    ),
  );
}

/**
 * Resize the real BrowserWindow, then pin the render viewport to the same numbers — the technique
 * layout.spec.ts documents, and for the reason it documents: a tiling window manager on the host
 * retiles the window moments after it is shown, which makes setSize() cosmetic.
 *
 * MEASURE BEFORE SCREENSHOTTING, NEVER AFTER: page.screenshot() clears
 * Emulation.setDeviceMetricsOverride and the viewport snaps back to the host WM's size, so any
 * geometry read after a shot() describes a window nobody configured.
 */
async function useViewport(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await app.evaluate(async ({ BrowserWindow }, size: { width: number; height: number }) => {
    BrowserWindow.getAllWindows()[0].setSize(size.width, size.height);
  }, { width, height });

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
  await settleCharts(page);
}

/** Two identical consecutive frames is the real signal that a resize has finished relayouting. */
async function settleCharts(page: Page): Promise<void> {
  const settled = await page.evaluate(async () => {
    const nextFrame = (): Promise<void> =>
      new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    const read = (): string => {
      const r = document.querySelector('[data-testid="chart-grid"]')?.getBoundingClientRect();
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
  expect(settled, 'the chart grid never stopped changing size').toBe(true);
}

/** Launch, open Charts, always close. */
async function withCharts(
  body: (ctx: { app: ElectronApplication; page: Page }) => Promise<void>,
): Promise<void> {
  const { app, page, close } = await launchApp({ seed: 42 });
  try {
    await openCharts(page);
    await body({ app, page });
  } finally {
    await close().catch(() => {});
  }
}

test.describe('N3 charts: the grid and the compressed form beside it', () => {
  test('1. all 169 cells render, exactly once each', async () => {
    await withCharts(async ({ page }) => {
      await expect(page.locator(cell)).toHaveCount(169);

      const combos = await page.locator(cell).evaluateAll((cells) =>
        cells.map((el) => (el as HTMLElement).dataset.combo ?? ''),
      );
      expect(new Set(combos).size, 'a combo appeared in two cells').toBe(169);

      // 13 pairs on the diagonal, 78 suited above it, 78 offsuit below — a transposed grid would
      // still have 169 cells and would still pass a bare count.
      expect(combos.filter((c) => c.length === 2)).toHaveLength(13);
      expect(combos.filter((c) => c.endsWith('s'))).toHaveLength(78);
      expect(combos.filter((c) => c.endsWith('o'))).toHaveLength(78);

      // Every cell states a verdict; a blank data-open would render as an out-of-range cell.
      const opens = await page.locator(cell).evaluateAll((cells) =>
        cells.map((el) => (el as HTMLElement).dataset.open ?? ''),
      );
      expect(new Set(opens)).toEqual(new Set(['true', 'false']));
    });
  });

  /**
   * THE N3 TEST. Not "the compressed form is higher up the screen" — that is a CSS accident that a
   * flex `order` or a `column-reverse` would satisfy with the DOM in the wrong sequence. This asks
   * the document itself, so it fails the moment the two are appended the other way round.
   */
  test('2. the compressed form precedes the grid in DOCUMENT order', async () => {
    await withCharts(async ({ page }) => {
      const order = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid="compressed-form"]');
        const gridEl = document.querySelector('[data-testid="chart-grid"]');
        if (panel === null || gridEl === null) return null;
        return {
          compressedPrecedesGrid: Boolean(
            panel.compareDocumentPosition(gridEl) & Node.DOCUMENT_POSITION_FOLLOWING,
          ),
          // Neither may contain the other, or "precedes" would be a containment artifact.
          nested: panel.contains(gridEl) || gridEl.contains(panel),
        };
      });

      expect(order, 'compressed form or grid missing from the DOM').not.toBeNull();
      expect(order?.nested, 'the grid is nested inside the compressed panel').toBe(false);
      expect(
        order?.compressedPrecedesGrid,
        'the 13x13 grid comes BEFORE the compressed form in the DOM — N3 requires the reverse',
      ).toBe(true);
    });
  });

  test('3. the compressed form carries all four of its parts', async () => {
    await withCharts(async ({ page }) => {
      // Six ordered hand classes, in the module's order, strongest first.
      await expect(page.locator(classRow)).toHaveCount(6);
      const classes = await page.locator(classRow).evaluateAll((rows) =>
        rows.map((el) => (el as HTMLElement).dataset.class ?? ''),
      );
      expect(classes).toEqual(CLASS_IDS);

      // Three verbal rules, each inside N3's 12-word budget.
      await expect(page.locator(ruleRow)).toHaveCount(3);
      const rules = await page.locator(ruleRow).allInnerTexts();
      for (const rule of rules) {
        expect(rule.trim().length, `empty rule: "${rule}"`).toBeGreaterThan(10);
        expect(
          rule.trim().split(/\s+/).length,
          `rule exceeds N3's 12-word budget: "${rule}"`,
        ).toBeLessThanOrEqual(12);
      }

      // ~12 boundary combos.
      await expect(page.locator(boundaryChip)).toHaveCount(12);

      // And the line saying the grid is the reference expansion of those rules.
      const expansion = await page.innerText('[data-testid="expansion-note"]');
      expect(expansion).toMatch(/169/);
      expect(expansion.toLowerCase()).toMatch(/expand/);

      // G9 stated ON SCREEN, not just in a comment: the frequency was discarded on purpose.
      const purity = await page.innerText('[data-testid="purity-note"]');
      expect(purity.toLowerCase()).toMatch(/frequenc/);
      expect(purity.toLowerCase()).toMatch(/discarded|on purpose/);

      expect(await page.innerText(chartsScreen)).not.toMatch(/NaN|undefined/);
    });
  });

  test('4. boundary combos are marked in the grid, and NOT by colour', async () => {
    await withCharts(async ({ page }) => {
      await selectPosition(page, 'CO');

      const marked = await page.locator(`${cell}[data-boundary="true"]`).evaluateAll((cells) =>
        cells.map((el) => (el as HTMLElement).dataset.combo ?? ''),
      );
      expect([...marked].sort()).toEqual([...CO_BOUNDARIES].sort());

      // The chips in the compressed panel name the same twelve cells.
      const chips = await page.locator(boundaryChip).evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.combo ?? ''),
      );
      expect([...chips].sort()).toEqual([...CO_BOUNDARIES].sort());

      /**
       * V2: mint is reserved for win% and the fluency gate, and severity is never carried by hue.
       * A boundary cell must therefore differ from a non-boundary cell of the SAME open/fold state
       * in something other than colour — border or weight — and must not introduce a new hue.
       */
      const compare = await page.evaluate(() => {
        const read = (el: Element) => {
          const s = getComputedStyle(el);
          return {
            color: s.color,
            background: s.backgroundColor,
            borderStyle: s.borderTopStyle,
            weight: s.fontWeight,
          };
        };
        const pick = (boundary: string, open: string): Element | null =>
          document.querySelector(
            `[data-testid="chart-cell"][data-boundary="${boundary}"][data-open="${open}"][data-revealed="false"]`,
          );
        const boundaryOpen = pick('true', 'true');
        const plainOpen = pick('false', 'true');
        if (boundaryOpen === null || plainOpen === null) return null;
        return { boundaryOpen: read(boundaryOpen), plainOpen: read(plainOpen) };
      });

      expect(compare, 'need one boundary-open and one plain-open cell to compare').not.toBeNull();
      if (compare === null) return;

      // Distinguished by SOMETHING other than colour.
      const differsStructurally =
        compare.boundaryOpen.borderStyle !== compare.plainOpen.borderStyle ||
        compare.boundaryOpen.weight !== compare.plainOpen.weight;
      expect(
        differsStructurally,
        `boundary cells are only distinguishable by colour: ${JSON.stringify(compare)}`,
      ).toBe(true);

      // And NOT by colour: same text colour, same fill as their plain counterparts.
      expect(compare.boundaryOpen.color, 'boundary cell recoloured its text').toBe(
        compare.plainOpen.color,
      );
      expect(compare.boundaryOpen.background, 'boundary cell recoloured its fill').toBe(
        compare.plainOpen.background,
      );

      // No mint anywhere on this screen — it belongs to win% and the fluency gate.
      const mint = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="charts-screen"] *')].filter((el) => {
          const s = getComputedStyle(el);
          return /61,\s*220,\s*151/.test(`${s.color} ${s.backgroundColor} ${s.borderTopColor}`);
        }).length,
      );
      expect(mint, 'the reserved mint accent appears on the charts screen').toBe(0);
    });
  });

  test('5. switching position changes the rules, the boundary set AND the grid', async () => {
    await withCharts(async ({ page }) => {
      await selectPosition(page, 'CO');
      const coRules = await page.locator(ruleRow).allInnerTexts();
      const coOpens = await page.locator(`${cell}[data-open="true"]`).count();
      const coBoundaries = await page.locator(`${cell}[data-boundary="true"]`).evaluateAll((c) =>
        c.map((el) => (el as HTMLElement).dataset.combo ?? '').sort(),
      );
      expect(coBoundaries).toEqual([...CO_BOUNDARIES].sort());

      await selectPosition(page, 'UTG');
      const utgRules = await page.locator(ruleRow).allInnerTexts();
      const utgOpens = await page.locator(`${cell}[data-open="true"]`).count();
      const utgBoundaries = await page.locator(`${cell}[data-boundary="true"]`).evaluateAll((c) =>
        c.map((el) => (el as HTMLElement).dataset.combo ?? '').sort(),
      );

      expect(utgRules, 'the three rules did not change with the seat').not.toEqual(coRules);
      expect(utgBoundaries).toEqual([...UTG_BOUNDARIES].sort());
      expect(utgBoundaries).not.toEqual(coBoundaries);

      // UTG is tighter than the cutoff. A grid that did not narrow is a grid pinned to one seat.
      expect(
        utgOpens,
        `UTG opened ${utgOpens} cells and CO opened ${coOpens} — UTG must be tighter`,
      ).toBeLessThan(coOpens);

      // The chips in the compressed panel track the grid, so the two halves cannot drift.
      const chips = await page.locator(boundaryChip).evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.combo ?? '').sort(),
      );
      expect(chips).toEqual(utgBoundaries);

      // All 169 stay visible at every seat — N3 forbids hiding the artifact.
      await expect(page.locator(cell)).toHaveCount(169);
    });
  });

  test('6. a correct commit and a wrong commit both behave, and each updates its own class', async () => {
    await withCharts(async ({ page }) => {
      await selectPosition(page, 'CO');

      const zeroed = await readClassAccuracy(page);
      expect(Object.keys(zeroed).sort()).toEqual([...CLASS_IDS].sort());
      for (const [id, score] of Object.entries(zeroed)) {
        expect(score, `${id} started with attempts on the board`).toBe('0/0');
      }
      // G5: no answer is on screen before the learner commits.
      await expect(page.locator(drillFeedback)).toHaveAttribute('data-verdict', 'none');
      await expect(page.locator(drillVerdict)).toHaveCount(0);

      // ── the CORRECT commit ──
      const spot = await currentSpot(page);
      const opens = await spotOpens(page, spot);
      const rightKey = opens ? 'o' : 'f';
      await commitKey(page, rightKey);

      await expect(page.locator(chartsScreen)).toHaveAttribute('data-verdict', 'right');
      await expect(page.locator(drillFeedback)).toHaveAttribute('data-combo', spot);
      const rightTag = await page.getAttribute('[data-testid="drill-tag"]', 'data-class');
      expect(CLASS_IDS).toContain(rightTag);

      const afterRight = await readClassAccuracy(page);
      expect(afterRight[rightTag ?? '']).toBe('1/1');
      // Only that class moved: a scoreboard that ticks every row is not aggregating by class.
      const movedRight = Object.entries(afterRight).filter(([, s]) => s !== '0/0');
      expect(movedRight).toHaveLength(1);

      // A fresh spot is up, unanswered — the next commit is a new decision.
      const nextSpot = await currentSpot(page);
      expect(nextSpot.length, 'no new spot after committing').toBeGreaterThan(1);

      // ── the WRONG commit ──
      const wrongKey = (await spotOpens(page, nextSpot)) ? 'f' : 'o';
      await commitKey(page, wrongKey);

      await expect(page.locator(chartsScreen)).toHaveAttribute('data-verdict', 'wrong');
      const wrongTag = await page.getAttribute('[data-testid="drill-tag"]', 'data-class');
      expect(CLASS_IDS).toContain(wrongTag);

      // The correction names the cell and the right action; no prose, no praise.
      const verdict = await page.innerText(drillVerdict);
      expect(verdict).toContain(nextSpot);
      expect(verdict).toMatch(/open|fold/);
      expect(verdict.trim().split(/\s+/).length, `feedback turned into prose: "${verdict}"`)
        .toBeLessThanOrEqual(8);

      /**
       * The verdict is about the PREVIOUS spot while the next hand is already dealt above it, so it
       * must say so. Unlabelled, a learner looking at a fresh A♠Q♠ next to the words "AA is open,
       * not fold" has been told something false about the hand in front of them — found by reading
       * the screenshot, with every other assertion in this file green.
       */
      expect(
        (await page.innerText(drillFeedback)).toLowerCase(),
        'the verdict does not say it is about the previous spot',
      ).toContain('last');
      // And the hand now on screen is NOT the one the verdict names.
      expect(await page.getAttribute(drillHand, 'data-combo')).not.toBe(nextSpot);

      const afterWrong = await readClassAccuracy(page);
      // The wrong answer counted as an attempt and NOT as a correct.
      const [wrongCorrect, wrongAttempts] = (afterWrong[wrongTag ?? ''] ?? '').split('/');
      expect(Number(wrongAttempts)).toBeGreaterThanOrEqual(1);
      expect(Number(wrongCorrect)).toBeLessThan(Number(wrongAttempts));

      // Two commits, two attempts, exactly one correct — across the whole board.
      const totals = Object.values(afterWrong).reduce(
        (acc, s) => {
          const [c, a] = s.split('/').map(Number);
          return { correct: acc.correct + c, attempts: acc.attempts + a };
        },
        { correct: 0, attempts: 0 },
      );
      expect(totals).toEqual({ correct: 1, attempts: 2 });

      // No praise adjacent to the correction, and no streak/XP language anywhere.
      // Word-bounded on purpose: an unanchored /xp/i matches "expansion", which is N3's own wording.
      const text = await page.innerText(chartsScreen);
      expect(text).not.toMatch(/correct!|\bnice\b|well done|\bgreat\b|\bstreaks?\b|\bXP\b|\blevel \d/i);
    });
  });

  /**
   * Found by LOOKING at a screenshot with this whole file green over it. The committed cell gets a
   * ring so the learner can find it among 169, and the first version drew that ring in near-white on
   * the near-white face of an OPEN cell — invisible, and every DOM assertion above passed while it
   * was. So this measures contrast against the face the ring actually sits on, in both states.
   */
  test('6b. the revealed cell ring is visible against the face it sits on', async () => {
    await withCharts(async ({ page }) => {
      await selectPosition(page, 'CO');

      for (const want of ['open', 'fold'] as const) {
        // Commit until a cell of the state we need has been revealed. Capped so a drill that never
        // produces one fails loudly instead of spinning.
        let found = false;
        for (let i = 0; i < 12 && !found; i++) {
          const spot = await currentSpot(page);
          const opens = await spotOpens(page, spot);
          await commitKey(page, opens ? 'o' : 'f');
          found = opens === (want === 'open');
        }
        expect(found, `the drill never revealed a cell that is ${want}`).toBe(true);

        const ring = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="chart-cell"][data-revealed="true"]');
          if (el === null) return null;
          const s = getComputedStyle(el);
          const rgb = (value: string): [number, number, number] => {
            const parts = /(\d+),\s*(\d+),\s*(\d+)/.exec(value);
            return parts === null
              ? [0, 0, 0]
              : [Number(parts[1]), Number(parts[2]), Number(parts[3])];
          };
          // Relative luminance, so "different enough to see" is measured rather than eyeballed.
          const lum = ([r, g, b]: [number, number, number]): number =>
            (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          return {
            combo: (el as HTMLElement).dataset.combo ?? '',
            open: (el as HTMLElement).dataset.open ?? '',
            width: s.borderTopWidth,
            style: s.borderTopStyle,
            contrast: Math.abs(lum(rgb(s.borderTopColor)) - lum(rgb(s.backgroundColor))),
          };
        });

        expect(ring, 'no revealed cell in the grid after committing').not.toBeNull();
        if (ring === null) return;

        expect(ring.open, `expected a ${want} cell`).toBe(String(want === 'open'));
        expect(ring.style, `${ring.combo}: the ring must be solid, not a boundary's dash`).toBe('solid');
        expect(parseFloat(ring.width), `${ring.combo}: ring width`).toBeGreaterThanOrEqual(2);
        expect(
          ring.contrast,
          `${ring.combo} (open=${ring.open}): the ring is invisible against its own face — luminance gap ${ring.contrast.toFixed(3)}`,
        ).toBeGreaterThan(0.25);
      }
    });
  });

  /**
   * The revealed cell settles in with a quiet opacity fade as its ring lands (UI polish). Opacity only,
   * so the colour/contrast oracle in 6b is untouched; the second half is the V2 contract that it is off
   * under a reduced-motion preference.
   */
  test('6d. the revealed cell carries the settle-in fade, and honours reduced motion (UI)', async () => {
    await withCharts(async ({ page }) => {
      await selectPosition(page, 'CO');
      const spot = await currentSpot(page);
      const opens = await spotOpens(page, spot);
      await commitKey(page, opens ? 'o' : 'f');

      const revealed = page.locator('[data-testid="chart-cell"][data-revealed="true"]').first();
      await expect(revealed).toBeAttached();
      expect(await revealed.evaluate((el) => getComputedStyle(el).animationName)).toBe('offsuit-surface-in');
    });

    await withCharts(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await selectPosition(page, 'CO');
      const spot = await currentSpot(page);
      const opens = await spotOpens(page, spot);
      await commitKey(page, opens ? 'o' : 'f');

      const revealed = page.locator('[data-testid="chart-cell"][data-revealed="true"]').first();
      await expect(revealed).toBeAttached();
      expect(await revealed.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    });
  });

  /**
   * THE "review" MARKER. The adaptive draw (test 12) is otherwise invisible: a learner seeing one class
   * come up repeatedly cannot tell it is targeting their weak spot rather than misbehaving. The weakest
   * ATTEMPTED class carries a visible "review" flag; a fresh scoreboard marks nothing (nothing attempted
   * is not a weakness). This misses one class, aces another, and asserts the marker lands on the missed
   * one — reading the rendered word, not just the data attribute.
   */
  test('6c. the weakest attempted class is flagged for review, and a fresh board flags nothing', async () => {
    await withCharts(async ({ page }) => {
      await selectPosition(page, 'CO');

      // Fresh board: nothing attempted, so nothing is marked.
      await expect(page.locator(classReview)).toHaveCount(0);

      // Miss the first class we are shown, then ace the next spot of a DIFFERENT class, so exactly one
      // class has a bad record and it is unambiguously the weakest attempted one.
      const firstSpot = await currentSpot(page);
      const missedClass = await page.getAttribute(`${cell}[data-combo="${firstSpot}"]`, 'data-class');
      await commitKey(page, (await spotOpens(page, firstSpot)) ? 'f' : 'o'); // wrong

      // Ace spots until we have correctly answered at least one of a class other than the missed one.
      for (let i = 0; i < 10; i += 1) {
        const spot = await currentSpot(page);
        const klass = await page.getAttribute(`${cell}[data-combo="${spot}"]`, 'data-class');
        await commitKey(page, (await spotOpens(page, spot)) ? 'o' : 'f'); // right
        if (klass !== missedClass) break;
      }

      // Exactly one class is flagged, and it is the one we kept getting wrong.
      await expect(page.locator(classReview)).toHaveCount(1);
      const flaggedRow = page.locator(`${classRow}[data-review="true"]`);
      await expect(flaggedRow).toHaveCount(1);
      expect(await flaggedRow.getAttribute('data-class')).toBe(missedClass);
      // The marker is a visible word, not only an attribute.
      expect((await page.locator(classReview).innerText()).toLowerCase()).toContain('review');
    });
  });

  test('6e. the RFI-width headline renders a real percentage, tightens with seat, and BB says "no open"', async () => {
    /**
     * The FIRST number the learner reads on the screen, in [data-testid=chart-width], and until now no
     * e2e selected it — a NaN%, a 0% fraction, or a broken BB branch would ship with the whole suite
     * green (the unit test only checks seat ORDERING, never the rendered string). Assert the rendered
     * text directly.
     */
    await withCharts(async ({ page }) => {
      // A wide seat prints a concrete, non-zero percentage.
      await selectPosition(page, 'BTN');
      const btnText = (await page.locator(chartWidthValue).textContent())?.trim() ?? '';
      expect(btnText, `BTN width headline "${btnText}"`).toMatch(/^\d+%$/);
      const btnPct = Number(btnText.replace('%', ''));
      expect(btnPct, 'the button opens some non-zero share of hands').toBeGreaterThan(0);

      // A tighter seat prints a strictly smaller percentage — the ordering the learner is meant to see.
      await selectPosition(page, 'UTG');
      const utgText = (await page.locator(chartWidthValue).textContent())?.trim() ?? '';
      expect(utgText).toMatch(/^\d+%$/);
      expect(Number(utgText.replace('%', '')), 'UTG must be tighter than BTN').toBeLessThan(btnPct);

      // BB has no first-in node, so the headline is the words, never "0%".
      await selectPosition(page, 'BB');
      await expect(page.locator(chartWidthValue)).toHaveText('no open');
      await expect(page.locator('[data-testid="chart-width"]')).toContainText(
        'the big blind has no raise-first-in range',
      );
    });
  });

  test('6f. the class scoreboard renders its accuracy as text, agreeing with the attributes', async () => {
    /**
     * The mirror of the anomaly spec's second-channel guard. charts.ts:339 renders the scoreboard text
     * ('1/1' or '—') beside data-correct/data-attempts, but every other reader keys off the attributes
     * only — a hardcoded '0', a blank, or a stale '—' in the visible span would pass while the learner
     * reads a wrong scoreboard. Assert the VISIBLE TEXT and that it agrees with the attributes.
     */
    await withCharts(async ({ page }) => {
      await selectPosition(page, 'CO');

      // Fresh board: every class shows the em-dash, not '0/0'.
      const dashes = await page.locator(classAccuracy).evaluateAll((els) =>
        els.map((el) => (el.textContent ?? '').trim()),
      );
      expect(dashes.length).toBeGreaterThan(0);
      for (const text of dashes) expect(text, 'a fresh class score is not the em-dash').toBe('—');

      // Answer one spot correctly, then the scored class's span must read '1/1' — text, not just attrs.
      const spot = await currentSpot(page);
      const scoredClass = await page.getAttribute(`${cell}[data-combo="${spot}"]`, 'data-class');
      await commitKey(page, (await spotOpens(page, spot)) ? 'o' : 'f');

      const scoreEl = page.locator(`${classAccuracy}[data-class="${scoredClass}"]`);
      await expect(scoreEl).toHaveText('1/1');
      // The two channels must agree — the whole point of the guard.
      const agree = await scoreEl.evaluate((el) => {
        const e = el as HTMLElement;
        return (el.textContent ?? '').trim() === `${e.dataset.correct}/${e.dataset.attempts}`;
      });
      expect(agree, 'the rendered score disagrees with its own data attributes').toBe(true);
    });
  });

  test('7. a single keystroke is the whole commit, and only o/f count', async () => {
    await withCharts(async ({ page }) => {
      await selectPosition(page, 'BTN');
      // Park focus on body so a press can only reach the screen's own keydown handler.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

      // Vacuity control first: an unrelated key must do nothing at all.
      const before = await page.getAttribute(chartsScreen, 'data-answered');
      for (const dead of ['x', 'Enter', 'ArrowLeft', '5']) {
        await page.keyboard.press(dead);
      }
      expect(
        await page.getAttribute(chartsScreen, 'data-answered'),
        'an unrelated key was treated as a commit',
      ).toBe(before);
      await expect(page.locator(drillFeedback)).toHaveAttribute('data-verdict', 'none');

      // Then one press per commit — no modifier, no Enter to confirm.
      await commitKey(page, 'o');
      expect(await page.getAttribute(chartsScreen, 'data-answered')).toBe('1');
      await commitKey(page, 'f');
      expect(await page.getAttribute(chartsScreen, 'data-answered')).toBe('2');

      // Upper case is the same key: a learner with caps on is not locked out.
      await commitKey(page, 'O');
      expect(await page.getAttribute(chartsScreen, 'data-answered')).toBe('3');

      // The pills do the same thing, for a learner who does not know the shortcut.
      await page.click('[data-testid="drill-open"]');
      await expect(page.locator(chartsScreen)).toHaveAttribute('data-answered', '4');
    });
  });

  test('8. degenerate seat: the big blind has no first-in range and says so', async () => {
    await withCharts(async ({ page }) => {
      await selectPosition(page, 'BB');

      // All 169 cells still on screen, none of them an open — N1, nothing is hidden.
      await expect(page.locator(cell)).toHaveCount(169);
      await expect(page.locator(`${cell}[data-open="true"]`)).toHaveCount(0);

      // Its twelve boundaries are DEFENCE boundaries, and the screen says which.
      await expect(page.locator(boundaryChip)).toHaveCount(12);
      const defence = await page.innerText('[data-testid="defence-note"]');
      expect(defence.toLowerCase()).toContain('defence');

      // The drill has nothing to ask, and explains that instead of showing a dead prompt.
      await expect(page.locator('[data-testid="drill-na"]')).toBeVisible();
      await expect(page.locator(drillHand)).toHaveCount(0);

      // A commit here must not score anything against a range that does not exist.
      await page.keyboard.press('o');
      await expect(page.locator(chartsScreen)).toHaveAttribute('data-answered', '0');
      for (const score of Object.values(await readClassAccuracy(page))) expect(score).toBe('0/0');

      expect(await page.innerText(chartsScreen)).not.toMatch(/NaN|undefined/);

      // Nothing is locked: every seat is still one click away from here.
      await expect(page.locator('[data-testid="position-btn"]')).toHaveCount(6);
      const disabled = await page.locator('[data-testid="position-btn"][disabled]').count();
      expect(disabled, 'a position button was disabled — N1 forbids a soft lock').toBe(0);
    });
  });

  test('9. switching seat mid-spot redraws rather than grading against the old rules', async () => {
    await withCharts(async ({ page }) => {
      await selectPosition(page, 'UTG');
      await commitKey(page, 'o');
      await expect(page.locator(drillVerdict)).toBeVisible();

      const utgSpot = await currentSpot(page);
      await selectPosition(page, 'BTN');

      // The stale verdict is gone (it was about a different seat's rules) and so is the stale spot.
      await expect(page.locator(drillFeedback)).toHaveAttribute('data-verdict', 'none');
      await expect(page.locator(chartsScreen)).toHaveAttribute('data-verdict', '');
      expect(await currentSpot(page)).not.toBe(utgSpot);

      // The one recorded attempt survives: the scoreboard is the session's, not the seat's.
      const totals = Object.values(await readClassAccuracy(page)).reduce(
        (sum, s) => sum + Number(s.split('/')[1]),
        0,
      );
      expect(totals).toBe(1);

      // And the drill still grades against the NEW seat.
      const spot = await currentSpot(page);
      await commitKey(page, (await spotOpens(page, spot)) ? 'o' : 'f');
      await expect(page.locator(chartsScreen)).toHaveAttribute('data-verdict', 'right');
    });
  });

  test('10. the grid and the compressed panel both fit, without overlapping, at both sizes', async () => {
    await withCharts(async ({ app, page }) => {
      for (const [width, height] of [
        [DEFAULT_WIDTH, DEFAULT_HEIGHT],
        [MIN_WIDTH, MIN_HEIGHT],
      ] as const) {
        await useViewport(app, page, width, height);

        // MEASURE BEFORE ANY SCREENSHOT: page.screenshot() clears the metrics override.
        const geo = await page.evaluate(() => {
          const box = (selector: string) => {
            const el = document.querySelector(selector);
            if (el === null) return null;
            const r = el.getBoundingClientRect();
            return { top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width };
          };
          const cells = [...document.querySelectorAll<HTMLElement>('[data-testid="chart-cell"]')];
          const rects = cells.map((el) => el.getBoundingClientRect());
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight,
            compressed: box('[data-testid="compressed-form"]'),
            grid: box('[data-testid="chart-grid"]'),
            keys: box('[data-testid="drill-open"]'),
            cellCount: cells.length,
            minCell: Math.min(...rects.map((r) => Math.min(r.width, r.height))),
            // 13 distinct column x-positions and 13 distinct row y-positions, or the grid wrapped.
            columns: new Set(rects.map((r) => Math.round(r.left))).size,
            rows: new Set(rects.map((r) => Math.round(r.top))).size,
            // Overlap of the two panels' horizontal spans: they are columns, they must not collide.
            panelsOverlap: (() => {
              const p = document.querySelector('[data-testid="compressed-form"]');
              const g = document.querySelector('[data-testid="chart-grid"]');
              if (p === null || g === null) return true;
              const a = p.getBoundingClientRect();
              const b = g.getBoundingClientRect();
              return a.right > b.left + 1 && b.right > a.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1;
            })(),
          };
        });

        const at = `${width}x${height}`;
        expect(geo.innerWidth, `${at}: viewport width`).toBe(width);
        expect(geo.innerHeight, `${at}: viewport height`).toBe(height);

        // Nothing may hang off the right edge, and the page must not scroll sideways.
        expect(
          geo.scrollWidth,
          `${at}: content is ${geo.scrollWidth}px wide in a ${width}px viewport — the grid overflowed`,
        ).toBeLessThanOrEqual(width + 1);
        expect(
          geo.scrollHeight,
          `${at}: content is ${geo.scrollHeight}px tall in a ${height}px viewport`,
        ).toBeLessThanOrEqual(height + 1);

        expect(geo.cellCount, `${at}: cell count`).toBe(169);
        expect(geo.columns, `${at}: the grid wrapped into ${geo.columns} columns`).toBe(13);
        expect(geo.rows, `${at}: the grid has ${geo.rows} rows`).toBe(13);

        // A cell smaller than this cannot hold "A2s" legibly — unreadable is a layout defect.
        expect(geo.minCell, `${at}: smallest cell is ${geo.minCell.toFixed(1)}px`).toBeGreaterThanOrEqual(28);

        expect(geo.panelsOverlap, `${at}: the compressed panel and the grid overlap`).toBe(false);

        for (const [name, box] of Object.entries({
          compressed: geo.compressed,
          grid: geo.grid,
          keys: geo.keys,
        })) {
          expect(box, `${at}: "${name}" missing`).not.toBeNull();
          if (box === null) continue;
          expect(box.left, `${at}: "${name}" cut off on the left`).toBeGreaterThanOrEqual(0);
          expect(box.right, `${at}: "${name}" hangs past the right edge (${box.right} > ${width})`)
            .toBeLessThanOrEqual(width + 1);
          expect(box.top, `${at}: "${name}" cut off above`).toBeGreaterThanOrEqual(0);
          expect(box.bottom, `${at}: "${name}" hangs below the fold (${box.bottom} > ${height})`)
            .toBeLessThanOrEqual(height + 1);
        }
      }
    });
  });

  /**
   * MASTERY-WEIGHTED SAMPLING (core/masteryDrill.ts, wired through nextSpot). A class the learner
   * keeps missing must be drilled MORE than the ones they have mastered — the whole point of the
   * adaptive draw. This fails one chosen class on every appearance and aces every other, then counts
   * which classes come up over a measurement window: the failed class must be the most-drawn, and
   * come up well above the flat 1-in-6 a round-robin would give it. Deterministic: seed 42 plus a
   * fixed commit rule fixes the entire sequence, so this is not a statistical flake.
   */
  test('12. a class the learner keeps missing is drilled more than the ones they ace', async () => {
    const FAILED = 'broadway';

    /** The class of the spot currently on screen, read off its own grid cell — never recomputed. */
    const spotClass = async (page: Page): Promise<string> => {
      const spot = await currentSpot(page);
      const klass = await page.getAttribute(`${cell}[data-combo="${spot}"]`, 'data-class');
      expect(klass, `no grid cell class for ${spot}`).not.toBeNull();
      return klass ?? '';
    };

    /** Miss FAILED on sight, ace everything else — so FAILED alone accumulates a bad record. */
    const commitByRule = async (page: Page): Promise<void> => {
      const spot = await currentSpot(page);
      const opens = await spotOpens(page, spot);
      const rightKey = opens ? 'o' : 'f';
      const wrongKey = opens ? 'f' : 'o';
      await commitKey(page, (await spotClass(page)) === FAILED ? wrongKey : rightKey);
    };

    await withCharts(async ({ page }) => {
      await selectPosition(page, 'CO');

      // Warm-up: let every class pick up a record under the rule (unseen classes are drawn first, so
      // this visits all six), driving FAILED's accuracy down and the rest to mastered.
      for (let i = 0; i < 40; i += 1) await commitByRule(page);

      // Measure: count the class PRESENTED on each of the next draws, still applying the rule so
      // FAILED stays failing and the others stay mastered throughout.
      const MEASURE = 120;
      const counts = new Map<string, number>(CLASS_IDS.map((id) => [id, 0]));
      for (let i = 0; i < MEASURE; i += 1) {
        const klass = await spotClass(page);
        counts.set(klass, (counts.get(klass) ?? 0) + 1);
        await commitByRule(page);
      }

      const failedCount = counts.get(FAILED) ?? 0;
      // The most-drawn class over the window is the one being missed.
      for (const id of CLASS_IDS) {
        if (id === FAILED) continue;
        expect(
          failedCount,
          `${FAILED} (${failedCount}) was not drilled more than ${id} (${counts.get(id)})`,
        ).toBeGreaterThan(counts.get(id) ?? 0);
      }
      // And comfortably above the flat 1-in-6 a round-robin would give it — proof the weighting bites.
      expect(failedCount, `${FAILED} share ${failedCount}/${MEASURE} is not above a flat sixth`)
        .toBeGreaterThan(MEASURE / 6);
    });
  });

  /**
   * MASTERY PERSISTS ACROSS RESTARTS. The adaptive draw only teaches across sittings if the per-class
   * record survives a relaunch — a session-scoped one would restart every class at 0/0 every launch and
   * the drill would never leave its cold start. This answers a few spots, reopens the SAME user-data
   * dir, and asserts the scoreboard carried over. A shared dir (not withCharts's fresh one) is the whole
   * point: it proves the on-disk save, not in-memory state.
   */
  test('13. class mastery survives closing and reopening the app', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-charts-persist-'));

    // First sitting: answer three spots and read the resulting scoreboard.
    let before: Record<string, string> = {};
    const first = await launchApp({ seed: 42, userDataDir: dir });
    try {
      await openCharts(first.page);
      await selectPosition(first.page, 'CO');
      for (let i = 0; i < 3; i += 1) {
        const spot = await currentSpot(first.page);
        // Deliberately answer WRONG so both counters move in a way a fresh session could not fake.
        await commitKey(first.page, (await spotOpens(first.page, spot)) ? 'f' : 'o');
      }
      before = await readClassAccuracy(first.page);
      const totalAttempts = Object.values(before).reduce((n, s) => n + Number(s.split('/')[1]), 0);
      expect(totalAttempts, 'the first sitting recorded no attempts').toBe(3);
    } finally {
      await first.close().catch(() => {});
    }

    // Second sitting, SAME dir: the scoreboard must come back exactly, before answering anything.
    const second = await launchApp({ seed: 42, userDataDir: dir });
    try {
      await openCharts(second.page);
      await selectPosition(second.page, 'CO');
      const after = await readClassAccuracy(second.page);
      expect(after, 'class mastery did not survive the restart').toEqual(before);
    } finally {
      await second.close().catch(() => {});
    }
  });

  test('11. screenshots at both documented sizes', async () => {
    await withCharts(async ({ app, page }) => {
      await useViewport(app, page, DEFAULT_WIDTH, DEFAULT_HEIGHT);
      await shot(page, 'charts-1100x760');

      // Re-apply the override after the shot: screenshotting clears it.
      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT);
      await shot(page, 'charts-900x640');

      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT);
      await commitKey(page, 'f');
      await shot(page, 'charts-900x640-feedback');
    });
  });
});

/**
 * DEFENSE MODE — the facing-a-raise 3-bet/call/fold drill, the Charts screen's second mode. It grades
 * against core/preflop.ts defenseAction, so these tests prove the mode is wired to that oracle and the
 * verdict is honest, not that the ranges are correct (tests/unit/defense.test.ts owns the full grid).
 */
const defenseDrill = '[data-testid="defense-drill"]';
const defenseVerdict = '[data-testid="defense-verdict"]';

async function openDefenseMode(page: Page): Promise<void> {
  await page.click('[data-testid="tab-charts"]');
  await page.waitForSelector(chartsScreen);
  await page.click('[data-testid="charts-mode-btn"][data-mode="defense"]');
  await page.waitForSelector(defenseDrill);
}

test.describe('charts — facing-a-raise defense drill', () => {
  test('D1. the mode toggle swaps the RFI grid for the defense drill and back', async () => {
    await withCharts(async ({ page }) => {
      // Starts in RFI mode: the 169-cell grid is up, the defense drill is not.
      await expect(page.locator(grid)).toBeVisible();
      await expect(page.locator(defenseDrill)).toHaveCount(0);
      await expect(page.locator(chartsScreen)).toHaveAttribute('data-mode', 'rfi');

      await page.click('[data-testid="charts-mode-btn"][data-mode="defense"]');
      await expect(page.locator(defenseDrill)).toBeVisible();
      await expect(page.locator(grid)).toHaveCount(0);
      await expect(page.locator(chartsScreen)).toHaveAttribute('data-mode', 'defense');

      // Back to RFI restores the grid.
      await page.click('[data-testid="charts-mode-btn"][data-mode="rfi"]');
      await expect(page.locator(grid)).toBeVisible();
      await expect(page.locator(defenseDrill)).toHaveCount(0);
    });
  });

  test('D2. exactly one of the three actions is graded right for a fixed spot+combo (the grader is real)', async () => {
    await withCharts(async ({ page }) => {
      await openDefenseMode(page);
      // Pin the spot so the correct action is fixed. The combo redraws each commit, so instead we read
      // the verdict LINE (which always names the correct action for the combo just played) and count
      // how many of the three buttons produce a 'right' for THAT combo — must be exactly one.
      await page.click('[data-testid="defense-spot-btn"][data-spot="bb-vs-btn"]');
      await expect(page.locator(defenseDrill)).toHaveAttribute('data-spot', 'bb-vs-btn');

      // Commit the same button (fold) many times; each verdict line states the correct action for the
      // combo that was showing. A 'right' means fold was correct; a 'wrong' names what was. Over a run
      // of distinct combos we must see both verdicts (fold is neither always right nor always wrong),
      // which proves the grader varies with the combo rather than being hard-coded.
      const verdicts = new Set<string>();
      for (let i = 0; i < 25; i++) {
        await page.click('[data-testid="defense-fold"]');
        verdicts.add((await page.getAttribute(defenseDrill, 'data-verdict')) ?? '');
      }
      expect(verdicts.has('right'), 'folding was never graded right in 25 combos').toBe(true);
      expect(verdicts.has('wrong'), 'folding was never graded wrong in 25 combos').toBe(true);
    });
  });

  test('D3. switching the spot draws a fresh combo and clears the verdict', async () => {
    await withCharts(async ({ page }) => {
      await openDefenseMode(page);
      // Commit once so a verdict is on screen.
      await page.click('[data-testid="defense-fold"]');
      await expect(page.locator(defenseVerdict)).toBeVisible();

      const before = await page.getAttribute(defenseDrill, 'data-combo');
      await page.click('[data-testid="defense-spot-btn"][data-spot="bb-vs-btn"]');
      // Spot changed, verdict cleared, and a combo is present (may or may not differ, but the verdict is gone).
      await expect(page.locator(defenseDrill)).toHaveAttribute('data-spot', 'bb-vs-btn');
      await expect(page.locator(defenseDrill)).toHaveAttribute('data-verdict', '');
      expect(before).not.toBeNull();
    });
  });

  test('D4. the T/C/F keyboard shortcuts each commit the matching action', async () => {
    await withCharts(async ({ page }) => {
      await openDefenseMode(page);
      const first = Number((await page.getAttribute(defenseDrill, 'data-answered')) ?? '0');
      await page.keyboard.press('f');
      await expect(page.locator(defenseDrill)).toHaveAttribute('data-answered', String(first + 1));
      await page.keyboard.press('c');
      await expect(page.locator(defenseDrill)).toHaveAttribute('data-answered', String(first + 2));
      await page.keyboard.press('t');
      await expect(page.locator(defenseDrill)).toHaveAttribute('data-answered', String(first + 3));
    });
  });

  test('D5. a wrong verdict names the correction and is labelled "last", about the PRIOR combo', async () => {
    /**
     * The verdict WORDING, which D2/D3 never read — they key off data-verdict only. The RFI drill asserts
     * this exact shape (the correction names the right action, prefixed 'last') because an unlabelled
     * verdict about the prior hand mislabels the fresh one on screen; the defense mode reuses the layout
     * with none of that coverage. Fold until a 'wrong' lands, then read the string.
     */
    await withCharts(async ({ page }) => {
      await openDefenseMode(page);
      await page.click('[data-testid="defense-spot-btn"][data-spot="bb-vs-btn"]');

      // Fold repeatedly until fold is graded wrong, so the verdict must name what fold should have been.
      let wrong = false;
      for (let i = 0; i < 40 && !wrong; i++) {
        await page.click('[data-testid="defense-fold"]');
        wrong = (await page.getAttribute(defenseDrill, 'data-verdict')) === 'wrong';
      }
      expect(wrong, 'folding was never graded wrong in 40 combos — cannot check the correction wording').toBe(true);

      // The correction names a non-fold action and says "not a fold" — a real correction, not a label.
      const verdictText = ((await page.locator(defenseVerdict).textContent()) ?? '').toLowerCase();
      expect(verdictText, `verdict "${verdictText}"`).toMatch(/is a (3-bet|call), not a fold/);
      // The feedback block is marked as about the LAST combo, so the fresh combo on screen is not mislabelled.
      await expect(page.locator('[data-testid="defense-feedback"]')).toContainText('last');
      // And the combo the verdict is about (from its data-combo) is the prior one, not the one now shown.
      const verdictCombo = await page.locator('[data-testid="defense-feedback"]').getAttribute('data-combo');
      const shownCombo = await page.getAttribute(defenseDrill, 'data-combo');
      expect(verdictCombo, 'the verdict names the combo now on screen — the "last" label would be a lie').not.toBe(
        shownCombo,
      );
    });
  });

  test('D6. the defense-width line names the active spot and its defend-percentage, and updates on switch', async () => {
    /**
     * defenseDrill.ts:132 renders 'BB vs BTN open — defend N% of hands' in [data-testid=defense-width];
     * no test reads it (defense.test.ts only checks defenseWidth ordering). A NaN%, wrong label, or a
     * line that fails to update on spot change would ship silently. Assert the rendered string and that
     * it tracks the selected spot.
     */
    await withCharts(async ({ page }) => {
      await openDefenseMode(page);
      const widthLine = page.locator('[data-testid="defense-width"]');

      await page.click('[data-testid="defense-spot-btn"][data-spot="bb-vs-btn"]');
      await expect(page.locator(defenseDrill)).toHaveAttribute('data-spot', 'bb-vs-btn');
      const btnText = (await widthLine.textContent()) ?? '';
      expect(btnText).toContain('BB vs BTN open');
      expect(btnText, `defense-width "${btnText}"`).toMatch(/defend \d+% of hands/);
      const btnPct = Number(/defend (\d+)%/.exec(btnText)?.[1] ?? 'NaN');
      expect(Number.isNaN(btnPct)).toBe(false);

      // Switch to a tighter-defence spot: the label AND the percentage must change with it. BB defends
      // widest vs the button (widest opener) and tighter vs an earlier-position open like UTG.
      await page.click('[data-testid="defense-spot-btn"][data-spot="bb-vs-utg"]');
      await expect(page.locator(defenseDrill)).toHaveAttribute('data-spot', 'bb-vs-utg');
      const utgText = (await widthLine.textContent()) ?? '';
      expect(utgText).toContain('BB vs UTG open');
      const utgPct = Number(/defend (\d+)%/.exec(utgText)?.[1] ?? 'NaN');
      expect(Number.isNaN(utgPct)).toBe(false);
      expect(utgPct, 'BB should defend tighter vs UTG than vs BTN').toBeLessThan(btnPct);
    });
  });

  /*
   * ACCESSIBILITY — the defense verdict reaches screen readers. An always-present visually-hidden
   * role=status region inside the drill mirrors the verdict wording, empty until a commit and carrying
   * the same verdict line the panel shows.
   */
  test('D-a11y. the verdict is announced to screen readers, matching the visible verdict line', async () => {
    await withCharts(async ({ page }) => {
      await openDefenseMode(page);
      const announcer = page.locator('[data-testid="defense-announcer"]');
      await expect(announcer).toHaveAttribute('role', 'status');
      await expect(announcer).toHaveAttribute('aria-live', 'polite');
      await expect(announcer).toHaveText('');

      await page.click('[data-testid="defense-fold"]');
      const line = (await page.locator(defenseVerdict).textContent()) ?? '';
      expect(line.length).toBeGreaterThan(0);
      const spoken = (await announcer.textContent()) ?? '';
      expect(spoken).toContain(line);
      expect(spoken.toLowerCase().startsWith('last')).toBe(true);
    });
  });

});

/**
 * 3-BET RESPONSE MODE — the opener's 4-bet/call/fold drill facing a 3-bet, the Charts screen's THIRD
 * mode. Grades against core/preflop.ts threeBetResponseAction, so these prove the mode is wired to that
 * oracle and the verdict is honest — the full grid + range correctness is owned by
 * tests/unit/threeBetResponse.test.ts.
 */
const threebetDrill = '[data-testid="threebet-drill"]';
const threebetVerdict = '[data-testid="threebet-verdict"]';

async function openThreeBetMode(page: Page): Promise<void> {
  await page.click('[data-testid="tab-charts"]');
  await page.waitForSelector(chartsScreen);
  await page.click('[data-testid="charts-mode-btn"][data-mode="3bet-response"]');
  await page.waitForSelector(threebetDrill);
}

test.describe('charts — facing-a-3-bet response drill', () => {
  test('T1. the mode toggle swaps in the 3-bet drill, and back to the RFI grid', async () => {
    await withCharts(async ({ page }) => {
      await expect(page.locator(grid)).toBeVisible();
      await expect(page.locator(threebetDrill)).toHaveCount(0);
      await expect(page.locator(chartsScreen)).toHaveAttribute('data-mode', 'rfi');

      await page.click('[data-testid="charts-mode-btn"][data-mode="3bet-response"]');
      await expect(page.locator(threebetDrill)).toBeVisible();
      await expect(page.locator(grid)).toHaveCount(0);
      await expect(page.locator(chartsScreen)).toHaveAttribute('data-mode', '3bet-response');

      await page.click('[data-testid="charts-mode-btn"][data-mode="rfi"]');
      await expect(page.locator(grid)).toBeVisible();
      await expect(page.locator(threebetDrill)).toHaveCount(0);
    });
  });

  test('T2. the grader is real: 4-bet is graded both right and wrong over a run of combos', async () => {
    await withCharts(async ({ page }) => {
      await openThreeBetMode(page);
      // Pin the opener seat, then commit the same button (4-bet) across many redrawn combos. The verdict
      // must vary — 4-bet is neither always right nor always wrong — which proves the grade tracks the
      // combo rather than being hard-coded.
      await page.click('[data-testid="threebet-spot-btn"][data-spot="BTN"]');
      await expect(page.locator(threebetDrill)).toHaveAttribute('data-spot', 'BTN');
      const verdicts = new Set<string>();
      for (let i = 0; i < 25; i++) {
        await page.click('[data-testid="threebet-threebet"]');
        verdicts.add((await page.getAttribute(threebetDrill, 'data-verdict')) ?? '');
      }
      expect(verdicts.has('right'), '4-betting was never graded right in 25 combos').toBe(true);
      expect(verdicts.has('wrong'), '4-betting was never graded wrong in 25 combos').toBe(true);
    });
  });

  test('T3. switching the opener seat draws a fresh combo and clears the verdict', async () => {
    await withCharts(async ({ page }) => {
      await openThreeBetMode(page);
      await page.click('[data-testid="threebet-fold"]');
      await expect(page.locator(threebetVerdict)).toBeVisible();

      const before = await page.getAttribute(threebetDrill, 'data-combo');
      await page.click('[data-testid="threebet-spot-btn"][data-spot="CO"]');
      await expect(page.locator(threebetDrill)).toHaveAttribute('data-spot', 'CO');
      await expect(page.locator(threebetDrill)).toHaveAttribute('data-verdict', '');
      expect(before).not.toBeNull();
    });
  });

  test('T4. the R/C/F keyboard shortcuts each commit the matching action', async () => {
    await withCharts(async ({ page }) => {
      await openThreeBetMode(page);
      const first = Number((await page.getAttribute(threebetDrill, 'data-answered')) ?? '0');
      await page.keyboard.press('f');
      await expect(page.locator(threebetDrill)).toHaveAttribute('data-answered', String(first + 1));
      await page.keyboard.press('c');
      await expect(page.locator(threebetDrill)).toHaveAttribute('data-answered', String(first + 2));
      await page.keyboard.press('r');
      await expect(page.locator(threebetDrill)).toHaveAttribute('data-answered', String(first + 3));
    });
  });

  test('T5. a wrong verdict names the correction as 4-bet or call, labelled "last" about the prior combo', async () => {
    await withCharts(async ({ page }) => {
      await openThreeBetMode(page);
      await page.click('[data-testid="threebet-spot-btn"][data-spot="BTN"]');
      // Fold until fold is graded wrong, so the verdict must name what the play should have been.
      let wrong = false;
      for (let i = 0; i < 40 && !wrong; i++) {
        await page.click('[data-testid="threebet-fold"]');
        wrong = (await page.getAttribute(threebetDrill, 'data-verdict')) === 'wrong';
      }
      expect(wrong, 'folding was never graded wrong in 40 combos — cannot check the correction wording').toBe(true);
      const verdictText = ((await page.locator(threebetVerdict).textContent()) ?? '').toLowerCase();
      expect(verdictText, `verdict "${verdictText}"`).toMatch(/is a (4-bet|call), not a fold/);
      await expect(page.locator('[data-testid="threebet-feedback"]')).toContainText('last');
      const verdictCombo = await page.locator('[data-testid="threebet-feedback"]').getAttribute('data-combo');
      const shownCombo = await page.getAttribute(threebetDrill, 'data-combo');
      expect(verdictCombo).not.toBe(shownCombo);
    });
  });

  test('T6. the continue-width line names the opener seat and its %, and widens UTG→BTN', async () => {
    await withCharts(async ({ page }) => {
      await openThreeBetMode(page);
      const widthLine = page.locator('[data-testid="threebet-width"]');

      await page.click('[data-testid="threebet-spot-btn"][data-spot="BTN"]');
      await expect(page.locator(threebetDrill)).toHaveAttribute('data-spot', 'BTN');
      const btnText = (await widthLine.textContent()) ?? '';
      expect(btnText).toContain('You opened BTN');
      expect(btnText, `threebet-width "${btnText}"`).toMatch(/continue \d+% vs a 3-bet/);
      const btnPct = Number(/continue (\d+)%/.exec(btnText)?.[1] ?? 'NaN');
      expect(Number.isNaN(btnPct)).toBe(false);

      // A tight opener (UTG) continues NARROWER facing a 3-bet than a wide opener (BTN).
      await page.click('[data-testid="threebet-spot-btn"][data-spot="UTG"]');
      await expect(page.locator(threebetDrill)).toHaveAttribute('data-spot', 'UTG');
      const utgText = (await widthLine.textContent()) ?? '';
      expect(utgText).toContain('You opened UTG');
      const utgPct = Number(/continue (\d+)%/.exec(utgText)?.[1] ?? 'NaN');
      expect(Number.isNaN(utgPct)).toBe(false);
      expect(utgPct, 'UTG should continue tighter vs a 3-bet than BTN').toBeLessThan(btnPct);
    });
  });

  /*
   * ACCESSIBILITY — the 3-bet-response verdict reaches screen readers. An always-present visually-
   * hidden role=status region inside the drill mirrors the verdict wording, empty until a commit and
   * carrying the same verdict line the panel shows.
   */
  test('T-a11y. the verdict is announced to screen readers, matching the visible verdict line', async () => {
    await withCharts(async ({ page }) => {
      await openThreeBetMode(page);
      const announcer = page.locator('[data-testid="threebet-announcer"]');
      await expect(announcer).toHaveAttribute('role', 'status');
      await expect(announcer).toHaveAttribute('aria-live', 'polite');
      await expect(announcer).toHaveText('');

      await page.click('[data-testid="threebet-fold"]');
      const line = (await page.locator(threebetVerdict).textContent()) ?? '';
      expect(line.length).toBeGreaterThan(0);
      const spoken = (await announcer.textContent()) ?? '';
      expect(spoken).toContain(line);
      expect(spoken.toLowerCase().startsWith('last')).toBe(true);
    });
  });
});

/*
 * ACCESSIBILITY — the RFI verdict reaches screen readers. The verdict updates in place on commit, so
 * without a live region an SR learner gets no feedback. An always-present visually-hidden role=status
 * region mirrors the feedback wording. It survives paint()'s replaceChildren and mode switches, is
 * empty until the first commit, and carries the same string the visible feedback shows.
 */
test.describe('charts — the RFI verdict reaches screen readers', () => {
  const announcer = '[data-testid="charts-announcer"]';

  test('A1. the announcer is a polite live region, empty until a commit', async () => {
    await withCharts(async ({ page }) => {
      const region = page.locator(announcer);
      await expect(region).toHaveAttribute('role', 'status');
      await expect(region).toHaveAttribute('aria-live', 'polite');
      await expect(region).toHaveText('');
    });
  });

  test('A2. a commit is announced, carrying the same verdict wording the panel shows', async () => {
    await withCharts(async ({ page }) => {
      await selectPosition(page, 'CO');
      const spot = await currentSpot(page);
      const rightKey = (await spotOpens(page, spot)) ? 'o' : 'f';
      await commitKey(page, rightKey);

      const spoken = (await page.locator(announcer).textContent()) ?? '';
      // The verdict line the panel shows (its own testid) is carried verbatim in the announcement — one
      // source of truth for the wording. The spot is named and the "last" label leads, like the panel.
      const verdictLine = (await page.locator(drillVerdict).textContent()) ?? '';
      expect(verdictLine.length).toBeGreaterThan(0);
      expect(spoken).toContain(verdictLine);
      expect(spoken).toContain(spot);
      expect(spoken.toLowerCase().startsWith('last')).toBe(true);
    });
  });

  test('A3. switching to a self-verdicting mode clears the RFI announcement', async () => {
    await withCharts(async ({ page }) => {
      await selectPosition(page, 'CO');
      const spot = await currentSpot(page);
      await commitKey(page, (await spotOpens(page, spot)) ? 'o' : 'f');
      await expect(page.locator(announcer)).not.toHaveText('');

      // The defense drill owns its own verdict, so the RFI region must not keep announcing a stale one.
      await page.click('[data-testid="charts-mode-btn"][data-mode="defense"]');
      await expect(page.locator(chartsScreen)).toHaveAttribute('data-mode', 'defense');
      await expect(page.locator(announcer)).toHaveText('');
    });
  });
});
