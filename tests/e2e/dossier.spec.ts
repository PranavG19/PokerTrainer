import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp } from './helpers.js';

/**
 * THE DOSSIER — N5's fifth surface, over core/reads.ts. R1, R2, R3, R4, R6, O4.
 *
 * WHAT THIS FILE IS ACTUALLY FOR. Every load-bearing assertion here is a NEGATIVE one: a licence the
 * screen must refuse to grant. A happy path where the gate opens proves almost nothing, because a
 * screen that licensed everything would pass it. So the shape of the file is one open gate and five
 * refusals — n one short of the sample gate, a frequency inside the threshold band, a third
 * pre-registration, a read with three counter-actions against it, and a read that never got written
 * down at all.
 *
 * THE ONE ASSERTION THIS SCREEN EXISTS FOR is in test 2: at n = 19 the shrinkage weight is 0.655 —
 * large, not small — and the licensed deviation is 0.00 bb at the same instant. A screen where those
 * two numbers move together would have taught the misconception instead of removing it.
 *
 * SYNC ORACLE: the dossier root republishes data-n / data-observations / data-registered /
 * data-licensed / data-forecasts / data-sessions-ended on every paint, the same technique the table
 * root's data-awaiting uses. Nothing in this file sleeps.
 *
 * The expected figures below are the arithmetic of core/reads.ts against the screen's own fixed
 * observation stream, mirrored here on purpose: a silent edit to either side shows up as a failure
 * rather than as two files agreeing about the wrong number.
 */

const dossierScreen = '[data-testid="dossier-screen"]';
const tabDossier = '[data-testid="tab-dossier"]';

const gateSample = '[data-testid="gate-sample"]';
const gateDeviation = '[data-testid="gate-deviation"]';
const gateLicensed = '[data-testid="gate-licensed"]';
const shrinkageWeight = '[data-testid="shrinkage-weight"]';
const appliedDeviation = '[data-testid="applied-deviation"]';
const licensedDeviation = '[data-testid="licensed-deviation"]';
const shrinkageTrap = '[data-testid="shrinkage-trap"]';
const lastObservation = '[data-testid="last-observation"]';
const observationCount = '[data-testid="observation-count"]';
const preregCount = '[data-testid="prereg-count"]';
const preregRefusal = '[data-testid="prereg-refusal"]';
const notebookRow = '[data-testid="notebook-row"]';
const notebookEmpty = '[data-testid="notebook-empty"]';
const revertMultiplier = '[data-testid="revert-multiplier"]';
const revertTrigger = '[data-testid="revert-trigger"]';
const planActiveRow = '[data-testid="plan-active-row"]';
const planActiveEmpty = '[data-testid="plan-active-empty"]';
const planDroppedRow = '[data-testid="plan-dropped-row"]';
const nodeRow = '[data-testid="node-row"]';
const calibrationLock = '[data-testid="calibration-lock"]';
const brier = '[data-testid="brier"]';
const baseRateBrier = '[data-testid="base-rate-brier"]';
const uniformBrier = '[data-testid="uniform-brier"]';
const skillVsBaseRate = '[data-testid="skill-vs-base-rate"]';
const skillVsUniform = '[data-testid="skill-vs-uniform"]';

/** The three tendencies these tests drive. Ids come from screens/dossier.ts. */
const STRONG = 'folds-to-turn-probe';           // true 75% vs a 50% baseline -> +25 points at n=20
const INSIDE_BAND = 'calls-river-overbet';      // true 45% vs a 40% baseline -> +5 points at n=20
const SECOND_STRONG = 'three-bets-blind-vs-blind'; // true 35% vs a 10% baseline -> +25 points

/** R1's constants, mirrored from core/reads.ts. */
const MIN_OBSERVATIONS = 20;
const SHRINKAGE_PRIOR = 10;
const CALIBRATION_RELEASE_FORECASTS = 400;

/** R3's node ledger, ranked by reach x bb per occurrence in core, mirrored here. */
const TOP_TWO_NODES = ['bb-vs-btn-cbet', 'sb-turn-probe'];
const BELOW_THE_CUT = ['co-river-jam', 'utg-open-fold'];

const w = (n: number): number => (n <= 0 ? 0 : n / (n + SHRINKAGE_PRIOR));

async function openDossier(page: Page): Promise<void> {
  await page.click(tabDossier);
  await page.waitForSelector(dossierScreen);
}

/** Select which tendency the stream is observing, and block until the root says so. */
async function track(page: Page, tendencyId: string): Promise<void> {
  await page.click(`[data-testid="track-btn"][data-tendency="${tendencyId}"]`);
  await expect(page.locator(dossierScreen)).toHaveAttribute('data-tendency', tendencyId);
}

async function preRegister(page: Page, tendencyId: string): Promise<void> {
  await page.click(`[data-testid="prereg-btn"][data-tendency="${tendencyId}"]`);
  await expect(
    page.locator(`[data-testid="tendency-row"][data-tendency="${tendencyId}"]`),
  ).toHaveAttribute('data-registered', 'true');
}

/**
 * Draw `count` observations of the tracked tendency at the given forecast, one click each, waiting
 * on the monotonic counter between clicks. R6 delivers the stream one observation at a time and the
 * screen has no bulk control, so this is twenty clicks — deliberately.
 */
async function observe(page: Page, count: number, forecastPercent = 50): Promise<void> {
  for (let i = 0; i < count; i++) {
    const before = Number(await page.getAttribute(dossierScreen, 'data-observations'));
    await page.click(`[data-testid="forecast-btn"][data-p="${forecastPercent}"]`);
    await expect(page.locator(dossierScreen)).toHaveAttribute(
      'data-observations',
      String(before + 1),
    );
  }
}

/** A numeric data-* attribute, read off the element rather than recomputed from its text. */
async function num(page: Page, selector: string, attribute: string): Promise<number> {
  const raw = await page.getAttribute(selector, attribute);
  expect(raw, `${selector} must publish ${attribute}`).not.toBeNull();
  return Number(raw);
}

test.describe('the dossier gates a read on two independent tests (R1)', () => {
  test('1. a 25-point tendency at n=20 opens both gates and licenses a deviation', async () => {
    const { page, close } = await launchApp();
    try {
      await openDossier(page);
      await preRegister(page, STRONG);
      await track(page, STRONG);

      // Before any evidence: no observation, and nothing licensed.
      await expect(page.locator(dossierScreen)).toHaveAttribute('data-n', '0');
      await expect(page.locator(dossierScreen)).toHaveAttribute('data-licensed', 'false');
      await expect(page.locator(lastObservation)).toHaveAttribute('data-index', '0');

      await observe(page, MIN_OBSERVATIONS);

      await expect(page.locator(dossierScreen)).toHaveAttribute('data-n', '20');
      await expect(page.locator(gateSample)).toHaveAttribute('data-pass', 'true');
      await expect(page.locator(gateDeviation)).toHaveAttribute('data-pass', 'true');
      await expect(page.locator(gateLicensed)).toHaveAttribute('data-licensed', 'true');
      await expect(page.locator(dossierScreen)).toHaveAttribute('data-licensed', 'true');

      // 15 hits of 20 at a 50% baseline is +25.0 points, and the row prints the signed distance.
      expect(await num(page, gateDeviation, 'data-points')).toBeCloseTo(25, 6);
      expect(await page.textContent(observationCount)).toContain('20 observations');

      // R6: the stream is felt one observation at a time, so the last one is named and dated.
      await expect(page.locator(lastObservation)).toHaveAttribute('data-index', '20');

      // The licensed deviation is w x full exploit = (20/30) x 2 bb.
      expect(await num(page, licensedDeviation, 'data-bb')).toBeCloseTo(w(20) * 2, 4);
      await expect(page.locator(licensedDeviation)).toHaveAttribute('data-licensed', 'true');

      // R3: it lands on the top two nodes and nowhere else.
      const active = page.locator(`${planActiveRow}[data-read="${STRONG}"]`);
      await expect(active).toHaveCount(1);
      await expect(active).toHaveAttribute('data-nodes', TOP_TWO_NODES.join(','));
      expect(await num(page, `${planActiveRow}[data-read="${STRONG}"]`, 'data-applied-bb')).toBeCloseTo(
        w(20) * 2,
        4,
      );
    } finally {
      await close();
    }
  });

  test('2. n=19 refuses the licence while w is 0.655 — the trap, on one screen', async () => {
    const { page, close } = await launchApp();
    try {
      await openDossier(page);
      await preRegister(page, STRONG);
      await track(page, STRONG);
      await observe(page, MIN_OBSERVATIONS - 1);

      await expect(page.locator(dossierScreen)).toHaveAttribute('data-n', '19');

      // The deviation gate is WIDE open: 14 hits of 19 is 73.7%, 23.7 points off a 50% baseline.
      await expect(page.locator(gateDeviation)).toHaveAttribute('data-pass', 'true');
      expect(await num(page, gateDeviation, 'data-points')).toBeCloseTo((14 / 19 - 0.5) * 100, 6);

      // The sample gate is shut, one observation short, and that alone refuses the licence.
      await expect(page.locator(gateSample)).toHaveAttribute('data-pass', 'false');
      await expect(page.locator(gateLicensed)).toHaveAttribute('data-licensed', 'false');
      await expect(page.locator(dossierScreen)).toHaveAttribute('data-licensed', 'false');

      /**
       * THE LOAD-BEARING PAIR. w = 19/29 = 0.655, which is most of the full exploit, and the applied
       * magnitude w x full exploit is 1.31 bb — yet the deviation the learner may actually make is
       * 0.00 bb. A screen where a large w implied a licence is the misconception R1 names.
       */
      expect(await num(page, shrinkageWeight, 'data-weight')).toBeCloseTo(19 / 29, 6);
      expect(await num(page, shrinkageWeight, 'data-weight')).toBeGreaterThan(0.65);
      expect(await num(page, appliedDeviation, 'data-bb')).toBeCloseTo(w(19) * 2, 4);
      expect(await num(page, licensedDeviation, 'data-bb')).toBe(0);
      await expect(page.locator(shrinkageTrap)).toHaveAttribute('data-licensed', 'false');

      // And it is not in the plan at all: core drops it on the sample gate.
      await expect(page.locator(`${planActiveRow}[data-read="${STRONG}"]`)).toHaveCount(0);
      await expect(page.locator(`${planDroppedRow}[data-read="${STRONG}"]`)).toHaveAttribute(
        'data-reason',
        'sample-gate',
      );

      // One more observation flips it, with nothing else changed — the gate is the only difference.
      await observe(page, 1);
      await expect(page.locator(gateLicensed)).toHaveAttribute('data-licensed', 'true');
      expect(await num(page, licensedDeviation, 'data-bb')).toBeCloseTo(w(20) * 2, 4);
    } finally {
      await close();
    }
  });

  test('3. a frequency inside the 15-point band refuses the licence at any n', async () => {
    const { page, close } = await launchApp();
    try {
      await openDossier(page);
      await preRegister(page, INSIDE_BAND);
      await track(page, INSIDE_BAND);
      await observe(page, MIN_OBSERVATIONS);

      // 9 hits of 20 is 45% against a 40% baseline: 5 points, a third of what R1 requires.
      await expect(page.locator(dossierScreen)).toHaveAttribute('data-n', '20');
      await expect(page.locator(gateSample)).toHaveAttribute('data-pass', 'true');
      await expect(page.locator(gateDeviation)).toHaveAttribute('data-pass', 'false');
      expect(await num(page, gateDeviation, 'data-points')).toBeCloseTo(5, 6);
      await expect(page.locator(gateLicensed)).toHaveAttribute('data-licensed', 'false');

      // The sample is ample, so w is large — and it buys nothing.
      expect(await num(page, shrinkageWeight, 'data-weight')).toBeCloseTo(w(20), 6);
      expect(await num(page, licensedDeviation, 'data-bb')).toBe(0);

      await expect(page.locator(`${planDroppedRow}[data-read="${INSIDE_BAND}"]`)).toHaveAttribute(
        'data-reason',
        'deviation-gate',
      );
      await expect(page.locator(`${planActiveRow}[data-read="${INSIDE_BAND}"]`)).toHaveCount(0);
    } finally {
      await close();
    }
  });
});

test.describe('shrinkage is applied as a magnitude, and only as a magnitude (R1)', () => {
  test('4. w rises with n and scales the deviation without ever opening a gate', async () => {
    const { page, close } = await launchApp();
    try {
      await openDossier(page);
      await preRegister(page, STRONG);
      await track(page, STRONG);

      // n=1: w = 1/11, tiny but NOT zero — so it cannot be acting as a gate.
      await observe(page, 1);
      expect(await num(page, shrinkageWeight, 'data-weight')).toBeCloseTo(1 / 11, 6);
      expect(await num(page, appliedDeviation, 'data-bb')).toBeCloseTo(w(1) * 2, 4);
      expect(await num(page, licensedDeviation, 'data-bb')).toBe(0);

      // n=10: w = 0.5 exactly, and the applied magnitude is half the full 2 bb exploit.
      await observe(page, 9);
      await expect(page.locator(dossierScreen)).toHaveAttribute('data-n', '10');
      expect(await num(page, shrinkageWeight, 'data-weight')).toBeCloseTo(0.5, 6);
      expect(await num(page, appliedDeviation, 'data-bb')).toBeCloseTo(1, 4);
      // Still nothing licensed: half the exploit is not half a licence.
      await expect(page.locator(gateSample)).toHaveAttribute('data-pass', 'false');
      expect(await num(page, licensedDeviation, 'data-bb')).toBe(0);

      // n=20: w = 2/3, and NOW the magnitude is spendable because the gates opened, not because w did.
      await observe(page, 10);
      expect(await num(page, shrinkageWeight, 'data-weight')).toBeCloseTo(2 / 3, 6);
      expect(await num(page, appliedDeviation, 'data-bb')).toBeCloseTo((2 / 3) * 2, 4);
      expect(await num(page, licensedDeviation, 'data-bb')).toBeCloseTo((2 / 3) * 2, 4);

      // w never reaches 1: the full exploit is never available, however long the sample.
      expect(await num(page, shrinkageWeight, 'data-weight')).toBeLessThan(1);
    } finally {
      await close();
    }
  });
});

test.describe('revert triggers fire by counting, not by judgment (R4)', () => {
  test('5. two counter-actions halve w, three drop to baseline, session end expires it', async () => {
    const { page, close } = await launchApp();
    try {
      await openDossier(page);
      await preRegister(page, STRONG);
      await track(page, STRONG);
      await observe(page, MIN_OBSERVATIONS);
      await expect(page.locator(dossierScreen)).toHaveAttribute('data-licensed', 'true');

      // One counter-action is not a trigger. R4's thresholds are 2 and 3, and 1 must do nothing.
      await page.click('[data-testid="counter-action-btn"]');
      await expect(page.locator('[data-testid="counter-count"]')).toHaveAttribute('data-count', '1');
      await expect(page.locator(revertMultiplier)).toHaveAttribute('data-multiplier', '1');
      await expect(page.locator(revertTrigger)).toHaveCount(0);
      expect(await num(page, licensedDeviation, 'data-bb')).toBeCloseTo(w(20) * 2, 4);

      // Two halves it. The read stays ACTIVE — halved is not dropped.
      await page.click('[data-testid="counter-action-btn"]');
      await expect(page.locator(revertMultiplier)).toHaveAttribute('data-multiplier', '0.5');
      await expect(
        page.locator(`${revertTrigger}[data-trigger="counter-actions-halved"]`),
      ).toHaveCount(1);
      expect(await num(page, licensedDeviation, 'data-bb')).toBeCloseTo(w(20) * 0.5 * 2, 4);
      const halved = page.locator(`${planActiveRow}[data-read="${STRONG}"]`);
      await expect(halved).toHaveCount(1);
      expect(await num(page, `${planActiveRow}[data-read="${STRONG}"]`, 'data-applied-bb')).toBeCloseTo(
        w(20) * 0.5 * 2,
        4,
      );

      // Three drops it to baseline, and "halved" must NOT still be showing beside it.
      await page.click('[data-testid="counter-action-btn"]');
      await expect(page.locator(revertMultiplier)).toHaveAttribute('data-multiplier', '0');
      await expect(
        page.locator(`${revertTrigger}[data-trigger="reverted-to-baseline"]`),
      ).toHaveCount(1);
      await expect(
        page.locator(`${revertTrigger}[data-trigger="counter-actions-halved"]`),
      ).toHaveCount(0);
      expect(await num(page, licensedDeviation, 'data-bb')).toBe(0);
      await expect(page.locator(`${planActiveRow}[data-read="${STRONG}"]`)).toHaveCount(0);
      await expect(page.locator(`${planDroppedRow}[data-read="${STRONG}"]`)).toHaveAttribute(
        'data-reason',
        'reverted-to-baseline',
      );

      // The gates themselves never moved: n is still 20 and the frequency is still 25 points off.
      // A revert is a weight, not a re-litigation of the evidence.
      await expect(page.locator(gateSample)).toHaveAttribute('data-pass', 'true');
      await expect(page.locator(gateDeviation)).toHaveAttribute('data-pass', 'true');

      // Session end: the evidence goes, the written hypothesis stays.
      await page.click('[data-testid="end-session-btn"]');
      await expect(page.locator(dossierScreen)).toHaveAttribute('data-sessions-ended', '1');
      await expect(page.locator(dossierScreen)).toHaveAttribute('data-n', '0');
      await expect(page.locator('[data-testid="counter-count"]')).toHaveAttribute('data-count', '0');
      await expect(page.locator(gateSample)).toHaveAttribute('data-pass', 'false');
      await expect(page.locator(gateLicensed)).toHaveAttribute('data-licensed', 'false');
      expect(await num(page, shrinkageWeight, 'data-weight')).toBe(0);
      // Pre-registration survives expiry; only the data it was tested against does not.
      await expect(
        page.locator(`[data-testid="tendency-row"][data-tendency="${STRONG}"]`),
      ).toHaveAttribute('data-registered', 'true');
      await expect(page.locator(`${planDroppedRow}[data-read="${STRONG}"]`)).toHaveAttribute(
        'data-reason',
        'sample-gate',
      );
    } finally {
      await close();
    }
  });

  test('6. six contrary observations re-close an open gate', async () => {
    const { page, close } = await launchApp();
    try {
      await openDossier(page);
      await preRegister(page, STRONG);
      await track(page, STRONG);
      await observe(page, MIN_OBSERVATIONS);

      // Five is short of R4's threshold and must change nothing.
      for (let i = 0; i < 5; i++) await page.click('[data-testid="contrary-btn"]');
      await expect(page.locator('[data-testid="contrary-count"]')).toHaveAttribute('data-count', '5');
      await expect(page.locator(revertMultiplier)).toHaveAttribute('data-multiplier', '1');
      await expect(page.locator(`${planActiveRow}[data-read="${STRONG}"]`)).toHaveCount(1);

      await page.click('[data-testid="contrary-btn"]');
      await expect(page.locator(`${revertTrigger}[data-trigger="gate-re-closed"]`)).toHaveCount(1);
      expect(await num(page, licensedDeviation, 'data-bb')).toBe(0);
      await expect(page.locator(`${planDroppedRow}[data-read="${STRONG}"]`)).toHaveAttribute(
        'data-reason',
        'gate-re-closed',
      );
    } finally {
      await close();
    }
  });
});

test.describe('pre-registration is capped at two and enforced (R2)', () => {
  test('7. the third tendency is refused and lands in the notebook instead', async () => {
    const { page, close } = await launchApp();
    try {
      await openDossier(page);

      await expect(page.locator(preregCount)).toHaveAttribute('data-registered', '0');
      await expect(page.locator(preregCount)).toHaveAttribute('data-cap', '2');
      await expect(page.locator(notebookEmpty)).toHaveCount(1);

      await preRegister(page, STRONG);
      await preRegister(page, SECOND_STRONG);
      await expect(page.locator(preregCount)).toHaveAttribute('data-registered', '2');
      await expect(page.locator(preregRefusal)).toHaveCount(0);

      // The third is REFUSED. It is not silently accepted and it is not silently discarded.
      await page.click(`[data-testid="prereg-btn"][data-tendency="${INSIDE_BAND}"]`);
      await expect(page.locator(preregRefusal)).toHaveAttribute('data-tendency', INSIDE_BAND);
      await expect(page.locator(preregCount)).toHaveAttribute('data-registered', '2');
      await expect(page.locator(dossierScreen)).toHaveAttribute('data-registered', '2');
      await expect(
        page.locator(`[data-testid="tendency-row"][data-tendency="${INSIDE_BAND}"]`),
      ).toHaveAttribute('data-registered', 'false');

      // R2's other half: it becomes next session's hypothesis rather than vanishing.
      await expect(page.locator(`${notebookRow}[data-tendency="${INSIDE_BAND}"]`)).toHaveCount(1);
      await expect(page.locator(notebookEmpty)).toHaveCount(0);

      /**
       * And the refusal has teeth: gather overwhelming evidence for the refused tendency and it is
       * STILL dropped, on pre-registration, not on either gate. This is the assertion that separates
       * an enforced cap from a decorative counter.
       */
      await track(page, INSIDE_BAND);
      await observe(page, MIN_OBSERVATIONS);
      await expect(page.locator(gateSample)).toHaveAttribute('data-pass', 'true');
      await expect(page.locator(`${planDroppedRow}[data-read="${INSIDE_BAND}"]`)).toHaveAttribute(
        'data-reason',
        'not-pre-registered',
      );
      await expect(page.locator(`${planActiveRow}[data-read="${INSIDE_BAND}"]`)).toHaveCount(0);

      // Two pre-registered tendencies, both fully observed, both licensed: that is the whole budget.
      await track(page, STRONG);
      await observe(page, MIN_OBSERVATIONS);
      await track(page, SECOND_STRONG);
      await observe(page, MIN_OBSERVATIONS);
      await expect(page.locator(planActiveRow)).toHaveCount(2);
      await expect(page.locator(planActiveEmpty)).toHaveCount(0);
    } finally {
      await close();
    }
  });
});

test.describe('the plan applies at the top two nodes and grades the forecasts (R3, O4)', () => {
  test('8. nodes rank by reach x bb, and only the top two are selected', async () => {
    const { page, close } = await launchApp();
    try {
      await openDossier(page);

      // Ranked, most valuable first — by the product, not by either factor alone. co-river-jam has
      // the biggest bb per occurrence and utg-open-fold the biggest reach; neither is selected.
      const ranked = await page.$$eval(nodeRow, (rows) =>
        rows.map((row) => (row as HTMLElement).dataset.node ?? ''),
      );
      expect(ranked.slice(0, 2)).toEqual(TOP_TWO_NODES);
      expect(ranked.slice(2)).toEqual(BELOW_THE_CUT);

      for (const node of TOP_TWO_NODES) {
        await expect(page.locator(`${nodeRow}[data-node="${node}"]`)).toHaveAttribute(
          'data-selected',
          'true',
        );
      }
      for (const node of BELOW_THE_CUT) {
        await expect(page.locator(`${nodeRow}[data-node="${node}"]`)).toHaveAttribute(
          'data-selected',
          'false',
        );
      }
      expect(await num(page, `${nodeRow}[data-node="bb-vs-btn-cbet"]`, 'data-value')).toBeCloseTo(
        0.33,
        4,
      );
    } finally {
      await close();
    }
  });

  test('9. forecasts are graded against the node base rate, and calibration is withheld', async () => {
    const { page, close } = await launchApp();
    try {
      await openDossier(page);
      await track(page, STRONG);

      await expect(page.locator(calibrationLock)).toHaveAttribute('data-releasable', 'false');
      await expect(page.locator(calibrationLock)).toHaveAttribute('data-forecasts', '0');
      await expect(page.locator(calibrationLock)).toHaveAttribute(
        'data-required',
        String(CALIBRATION_RELEASE_FORECASTS),
      );

      /**
       * Forecast 50% twenty times at a node whose true frequency is 75%. Fifteen of the twenty
       * happen, so the learner's Brier is 0.25 while the base rate's is 0.1875 and uniform's is also
       * 0.25 — the learner has exactly matched uniform and lost to the base rate.
       *
       * That combination is the whole of O4: a scoring rule against uniform would have called this
       * performance par. Against the base rate it is negative, because quoting 50% at a 75% node is
       * not a read.
       */
      await observe(page, MIN_OBSERVATIONS, 50);

      await expect(page.locator(dossierScreen)).toHaveAttribute('data-forecasts', '20');
      expect(await num(page, brier, 'data-value')).toBeCloseTo(0.25, 6);
      expect(await num(page, baseRateBrier, 'data-value')).toBeCloseTo(0.1875, 6);
      expect(await num(page, uniformBrier, 'data-value')).toBeCloseTo(0.25, 6);
      expect(await num(page, skillVsUniform, 'data-value')).toBeCloseTo(0, 6);
      expect(await num(page, skillVsBaseRate, 'data-value')).toBeLessThan(0);

      // Sharper forecasts at the same node improve the score against the base rate.
      const before = await num(page, skillVsBaseRate, 'data-value');
      await observe(page, 10, 90);
      expect(await num(page, skillVsBaseRate, 'data-value')).toBeGreaterThan(before);

      // 30 forecasts is nowhere near 400, so the curve stays withheld.
      await expect(page.locator(calibrationLock)).toHaveAttribute('data-forecasts', '30');
      await expect(page.locator(calibrationLock)).toHaveAttribute('data-releasable', 'false');
    } finally {
      await close();
    }
  });
});

test.describe('the dossier is a reachable surface that cleans up after itself (N1)', () => {
  test('10. it fits the documented minimum window and round-trips with the table', async () => {
    const { app, page, close } = await launchApp();
    try {
      await useViewport(app, page, 900, 640);
      await openDossier(page);
      await preRegister(page, STRONG);
      await track(page, STRONG);
      await observe(page, 3);

      // A page scrollbar is the failure: each panel scrolls itself instead.
      const geometry = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
      }));
      expect(
        geometry.scrollWidth,
        `content is ${geometry.scrollWidth}px wide in a ${geometry.innerWidth}px viewport`,
      ).toBeLessThanOrEqual(geometry.innerWidth);
      expect(
        geometry.scrollHeight,
        `content is ${geometry.scrollHeight}px tall in a ${geometry.innerHeight}px viewport`,
      ).toBeLessThanOrEqual(geometry.innerHeight);

      // N1: leaving and returning must not throw, and the surface is never locked. Its state is
      // session-scoped by design, so a fresh visit starts from zero observations.
      await page.click('[data-testid="tab-play"]');
      await expect(page.locator(dossierScreen)).toHaveCount(0);
      await openDossier(page);
      await expect(page.locator(dossierScreen)).toHaveAttribute('data-n', '0');
      await expect(page.locator(dossierScreen)).toHaveAttribute('data-observations', '0');
      await expect(page.locator(tabDossier)).toHaveAttribute('data-active', 'true');
    } finally {
      await close();
    }
  });
});

/**
 * Resize the real BrowserWindow, then pin the render viewport to the same numbers — the technique
 * layout.spec.ts and charts.spec.ts document, and for the reason they document: a tiling window
 * manager on the host retiles the window moments after it is shown, which makes setSize() cosmetic.
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
}
