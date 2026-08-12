import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import {
  BANNED_PHRASINGS,
  RESULTS_GRAPH_MIN_HANDS,
  WEEKLY_DECISION_TARGET,
  WIN_RATE_MIN_HANDS,
} from '../../src/core/progress.js';
import { launchApp, sel, shot } from './helpers.js';
import { playToShowdown, tableScreen } from './flow.js';

/**
 * THE PROGRESS SURFACE — PRODUCT-SPEC N5's fifth surface, P1/P2/P3/P5 and G7's wording, driven through
 * the real app.
 *
 * WHAT MAKES THIS SCREEN DIFFERENT TO TEST. Most surfaces are judged on what they show. This one is
 * judged mostly on WHAT IT REFUSES TO SHOW: the win rate is withheld below 2,000 hands, the results
 * graph is refused below 10,000, and neither may degrade into a zero or an empty chart. So the oracles
 * here are about absence and about wording — the two things that are easiest to break by accident and
 * hardest to notice by looking.
 *
 * TWO NUMBERS ARE IMPORTED FROM CORE rather than written out: WIN_RATE_MIN_HANDS and
 * RESULTS_GRAPH_MIN_HANDS. If either gate is ever loosened in core, these tests move with it and the
 * loosening shows up as a diff in core, which is where it belongs — not as a silently-still-green suite.
 *
 * DECISION RECORDING IS NOW LIVE: played hands feed the effort metric (graded decisions this week) via
 * decisionRecordsFromHands. What stays refused is the honest boundary — the win rate is still withheld
 * (it needs the all-in-adjusted evBb, which the hand log does not store) and fluency stays empty (no
 * reaction time is recorded). The last test in this file pins exactly that: effort moves, outcomes do not.
 */

const screen = '[data-testid="progress-screen"]';
const metric = '[data-testid="progress-metric"]';
const metricValue = '[data-testid="metric-value"]';
const kcSection = '[data-testid="kc-section"]';
const graph = '[data-testid="results-graph"]';
const footer = '[data-testid="progress-footer"]';

async function openProgress(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.locator('[data-testid="tab-progress"]').click();
  await expect(page.locator('[data-testid="tab-progress"]')).toHaveAttribute('data-active', 'true');
  await page.waitForSelector(screen);
}

async function withProgress(
  body: (ctx: { app: ElectronApplication; page: Page }) => Promise<void>,
): Promise<void> {
  const { app, page, close } = await launchApp({ seed: 42 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
  try {
    await openProgress(page);
    await body({ app, page });
    expect(errors, 'the progress surface threw').toEqual([]);
  } finally {
    await close();
  }
}

test('P1 — exactly five numbers, in order, each carrying its sample', async () => {
  await withProgress(async ({ page }) => {
    /*
     * "Five numbers, and ONLY five." A sixth would be a new claim about the learner with no spec behind
     * it, and a fourth would mean one of the five is missing — so the count is asserted exactly rather
     * than as a minimum.
     */
    const keys = await page
      .locator(metric)
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.metric ?? ''));
    expect(keys, 'the five numbers are not the five P1 names, in order').toEqual([
      'gradedDecisionsThisWeek',
      'assessmentEvLossBb100',
      'fluentCategories',
      'sureWrongThisWeek',
      'winRateVsBots',
    ]);

    // Every number states what it was computed from. A value with no sample is not a measurement.
    for (const key of ['gradedDecisionsThisWeek', 'assessmentEvLossBb100', 'fluentCategories', 'sureWrongThisWeek']) {
      await expect(
        page.locator(`${metric}[data-metric="${key}"] [data-testid="metric-sample"]`),
        `${key} does not state its sample`,
      ).toBeVisible();
    }
  });
});

test('P1 — only effort carries a target, and it is the documented one', async () => {
  await withProgress(async ({ page }) => {
    /*
     * A target on graded decisions is permitted because effort is the one thing a learner controls. A
     * target on EV loss, on fluent categories or on the win rate would be a target on an OUTCOME, which
     * is the feedback law this app exists to respect — so the absence is asserted, not assumed.
     */
    await expect(
      page.locator(`${metric}[data-metric="gradedDecisionsThisWeek"] [data-testid="metric-target"]`),
    ).toContainText(String(WEEKLY_DECISION_TARGET));

    for (const key of ['assessmentEvLossBb100', 'fluentCategories', 'sureWrongThisWeek', 'winRateVsBots']) {
      expect(
        await page.locator(`${metric}[data-metric="${key}"] [data-testid="metric-target"]`).count(),
        `${key} carries a target, which turns an outcome into a goal`,
      ).toBe(0);
    }
  });
});

test('P1 — the win rate is WITHHELD below the hand floor, not shown as zero', async () => {
  await withProgress(async ({ page }) => {
    /**
     * The distinction this test exists for: "not shown yet" and "0.00 bb/100" are different claims. A
     * zero tells the learner they break even against the bots; the withholding tells them the sample is
     * too small to say. Only one of those is true below 2,000 hands.
     */
    const card = page.locator(`${metric}[data-metric="winRateVsBots"]`);
    await expect(card).toHaveAttribute('data-withheld', 'true');
    await expect(card.locator(metricValue)).toContainText('not shown yet');

    // It must NOT print a bb/100 figure at all — not even a zero.
    const text = (await card.textContent()) ?? '';
    expect(text, `a bb/100 value was shown while withheld: "${text}"`).not.toMatch(/-?\d+\.\d+ bb\/100/);

    // And it names the gate, with the real number from core.
    await expect(card.locator('[data-testid="metric-withheld-reason"]')).toContainText(
      String(WIN_RATE_MIN_HANDS),
    );
  });
});

test('P3 — the results graph is refused below 10,000 hands, with a route out', async () => {
  await withProgress(async ({ page }) => {
    /**
     * "Below it, the app refuses and links the variance module." An empty or two-point chart is worse
     * than no chart: it reads as a verdict on the player when it is a statement about the sample. So the
     * refusal must be explicit AND must carry somewhere to go — a refusal with no alternative is the
     * locked door N1 forbids.
     */
    await expect(page.locator(graph)).toHaveAttribute('data-kind', 'refused');
    await expect(page.locator('[data-testid="graph-refusal"]')).toBeVisible();
    await expect(page.locator('[data-testid="graph-refusal"]')).toContainText(
      String(RESULTS_GRAPH_MIN_HANDS),
    );

    // No series is drawn while refused.
    expect(
      await page.locator('[data-testid="graph-series"]').count(),
      'a chart was drawn under the refusal',
    ).toBe(0);

    const route = page.locator('[data-testid="graph-alternative"]');
    await expect(route, 'the refusal offers no way forward').toBeEnabled();
    await expect(route).toHaveAttribute('data-route', 'variance-module');

    // The route is live, not decorative.
    await route.click();
    await expect(page.locator('[data-testid="tab-learn"]')).toHaveAttribute('data-active', 'true');
  });
});

test('P2 — the bars come first, because they are the primary surface', async () => {
  await withProgress(async ({ page }) => {
    /*
     * "Per-KC mastery bars are the PRIMARY progress surface." Primary is a claim about emphasis, and on
     * a scrolling column emphasis is DOM order — so the bars must precede the five numbers. A summary
     * above the teaching is the wrong screen.
     */
    const order = await page.locator(screen).evaluateAll((els) => {
      const root = els[0] as HTMLElement;
      return Array.from(root.children).map((child) => (child as HTMLElement).dataset.testid ?? '');
    });
    const kcIndex = order.indexOf('kc-section');
    const numbersIndex = order.indexOf('progress-numbers');
    expect(kcIndex, 'no KC section').toBeGreaterThanOrEqual(0);
    expect(numbersIndex, 'no numbers section').toBeGreaterThanOrEqual(0);
    expect(kcIndex, 'the five numbers precede the bars, so the bars are not primary').toBeLessThan(
      numbersIndex,
    );
  });
});

test('an empty profile says what is missing rather than showing nothing', async () => {
  await withProgress(async ({ page }) => {
    // N1: an empty state must not read as a lock. It says bars appear as evidence accumulates.
    await expect(page.locator('[data-testid="kc-empty"]')).toBeVisible();
    const text = (await page.locator(kcSection).textContent()) ?? '';
    expect(text.toLowerCase()).toContain('nothing is locked');
    await expect(page.locator('[data-testid="tag-empty"]')).toBeVisible();
  });
});

test('G7 and the gamification ban — no banned phrasing reaches the screen', async () => {
  await withProgress(async ({ page }) => {
    /**
     * The list comes from core, so this test cannot drift from the rule it enforces. Two families are
     * banned: gamification (streaks, ranks, percentiles, XP — all of which reward showing up rather than
     * deciding well) and trait attribution (G7 — a tag describes a decision; an adjective describes a
     * person and cannot be practised).
     *
     * innerText rather than textContent, and word boundaries: a raw substring scan over concatenated
     * text nodes reports matches that are not on screen, as tests/e2e/robustness.spec.ts documents.
     */
    const body = (await page.locator(screen).innerText()).toLowerCase();
    for (const phrase of BANNED_PHRASINGS) {
      expect(body, `a banned phrasing reached the screen: "${phrase}"`).not.toContain(
        phrase.toLowerCase(),
      );
    }
    // The guard's own marker must never appear either — if it does, the screen caught itself and the
    // string that tripped it needs fixing.
    expect(body, 'the screen rendered a BANNED PHRASING marker').not.toContain('banned phrasing');
  });
});

test('the two gates are stated as facts about the sample', async () => {
  await withProgress(async ({ page }) => {
    // Both thresholds on screen, from core's constants, so a learner is never left guessing why a
    // number is absent.
    const text = (await page.locator(footer).textContent()) ?? '';
    expect(text).toContain(String(WIN_RATE_MIN_HANDS));
    expect(text).toContain(String(RESULTS_GRAPH_MIN_HANDS));
    expect(text).toContain(String(WEEKLY_DECISION_TARGET));
  });
});

test('the surface survives being left and re-entered, and the table still deals', async () => {
  await withProgress(async ({ page }) => {
    // The remount path every non-play tab takes. Progress registers no listeners, so the risk is a
    // stale render rather than a leak — but "no listeners" is a claim worth checking rather than
    // asserting in a comment.
    for (let visit = 0; visit < 3; visit++) {
      await page.locator('[data-testid="tab-play"]').click();
      await page.waitForSelector('[data-testid="home-screen"]');
      await page.locator('[data-testid="tab-progress"]').click();
      await page.waitForSelector(screen);
      expect(await page.locator(metric).count(), `visit ${visit}: the five numbers did not re-render`).toBe(
        5,
      );
    }

    await page.locator('[data-testid="tab-play"]').click();
    await page.waitForSelector('[data-testid="home-screen"]');
    await page.locator('[data-testid="new-hand"]').click();
    await expect(page.locator('[data-testid="table-screen"]')).toBeVisible();
  });
});

test('the effort metric counts real played decisions, while the outcome metrics stay honestly withheld', async () => {
  /**
   * THE WIRING CLAIM, and the honesty boundary it must not cross. main.ts now feeds the Progress screen
   * real DecisionRecords derived from the hand log (decisionRecordsFromHands), so playing a hand must
   * move "graded decisions this week" off zero. What must NOT move: the win rate stays withheld (it
   * needs the all-in-adjusted evBb, which the hand log does not store), and the assessment EV-loss and
   * fluent-categories samples stay at zero (no assessment block and no reaction-time recording exist).
   * If wiring the effort metric had also lit up an outcome metric, it would be fabricating data.
   */
  await withProgress(async ({ page }) => {
    // Baseline: a fresh profile has zero graded decisions.
    const effort = page.locator(`${metric}[data-metric="gradedDecisionsThisWeek"] ${metricValue}`);
    await expect(effort).toContainText('0');

    // Play one hand to completion — every hero action is graded and logged with a verdict + timestamp.
    await page.locator('[data-testid="tab-play"]').click();
    await page.waitForSelector('[data-testid="home-screen"]');
    await page.locator(sel.newHand).click();
    await expect(page.locator(tableScreen)).toBeVisible();
    await playToShowdown(page);
    await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'handover');

    // Back to Progress: the effort metric now reports a real record count ("from N records").
    await page.locator('[data-testid="tab-progress"]').click();
    await page.waitForSelector(screen);
    const effortSampleText =
      (await page
        .locator(`${metric}[data-metric="gradedDecisionsThisWeek"] [data-testid="metric-sample"]`)
        .textContent()) ?? '';
    const effortSample = Number(/from (\d+) record/.exec(effortSampleText)?.[1] ?? '0');
    expect(effortSample, `a played hand recorded no graded decisions ("${effortSampleText}")`).toBeGreaterThan(0);

    // The honesty boundary: outcome metrics were NOT fabricated by the same wiring.
    const winRate = page.locator(`${metric}[data-metric="winRateVsBots"]`);
    await expect(winRate).toHaveAttribute('data-withheld', 'true');
    await expect(winRate.locator(metricValue)).toContainText('not shown yet');
    // Assessment EV-loss and fluent categories stay at their empty state — nothing feeds them honestly.
    await expect(
      page.locator(`${metric}[data-metric="assessmentEvLossBb100"] [data-testid="metric-sample"]`),
    ).toContainText('no decisions recorded yet');
    await expect(
      page.locator(`${metric}[data-metric="fluentCategories"] [data-testid="metric-sample"]`),
    ).toContainText('no decisions recorded yet');
  });
});

test('the screen fits both documented window sizes, then screenshots', async () => {
  await withProgress(async ({ app, page }) => {
    for (const [width, height] of [
      [1100, 760],
      [900, 640],
    ] as const) {
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

      // MEASURED BEFORE ANY SCREENSHOT: page.screenshot() clears the metrics override.
      const geo = await page.evaluate(() => ({
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        docScrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
      }));
      const at = `${width}x${height}`;
      expect(geo.innerWidth, `${at}: viewport width`).toBe(width);
      expect(geo.scrollWidth, `${at}: the column overflows horizontally`).toBeLessThanOrEqual(width + 1);
      /*
       * The PAGE must not scroll — the screen's own column may, which is deliberate (the bars are the
       * primary surface and are allowed to take the room and scroll themselves). A page scrollbar means
       * the tab bar can be pushed off, which is a different and worse failure.
       */
      expect(
        geo.docScrollHeight,
        `${at}: the document scrolls (${geo.docScrollHeight}px in ${height}px)`,
      ).toBeLessThanOrEqual(geo.innerHeight + 1);

      // The five numbers must all be reachable, which is what makes them five numbers and not three.
      expect(await page.locator(metric).count(), `${at}: not all five numbers rendered`).toBe(5);
    }
    await shot(page, 'progress-empty');
  });
});
