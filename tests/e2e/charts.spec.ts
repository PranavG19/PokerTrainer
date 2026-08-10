import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
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
