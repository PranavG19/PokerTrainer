import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp } from './helpers.js';
/**
 * These two are IMPORTED rather than mirrored, unlike the figures below. The threshold is quoted
 * verbatim inside a sentence the learner reads, and the false-read rates are exact binomial
 * arithmetic — a hand-copied "98.5%" would pin last month's rule, so both must move with core.
 */
import { DEVIATION_THRESHOLD_POINTS, falseReadProbability } from '../../src/core/reads.js';

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
/** The denominator the applied deviation is read against; no test read it in either form. */
const fullExploit = '[data-testid="full-exploit"]';
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

/** R3 bans unnamed reads, so the rendered rows carry these labels and not the ids. */
const STRONG_LABEL = 'folds to a turn probe';
const SECOND_STRONG_LABEL = 'three-bets blind versus blind';

/** STRONG's baseline, which is also its honest observed frequency before any evidence arrives. */
const STRONG_BASELINE_PERCENT = '50.0%';

/** R1's constants, mirrored from core/reads.ts. */
const MIN_OBSERVATIONS = 20;
const SHRINKAGE_PRIOR = 10;
const CALIBRATION_RELEASE_FORECASTS = 400;
/** R4's gate-re-close threshold. */
const CONTRARY_OBSERVATIONS_TO_CLOSE = 6;

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

/**
 * A bb figure, asserted TWICE: the data-bb attribute the rest of this file keys off, and the string
 * the learner actually reads beside it. The two are separate code paths in the renderer — one
 * `toFixed(6)` into a dataset, one `toFixed(2)` into a span — so an attribute that agrees with core
 * while the visible number does not is a real and previously invisible failure mode.
 */
async function expectBb(page: Page, selector: string, expected: number): Promise<void> {
  expect(await num(page, selector, 'data-bb'), `${selector} data-bb`).toBeCloseTo(expected, 4);
  const rendered = (await page.textContent(selector)) ?? '';
  expect(rendered, `${selector} must PRINT ${expected.toFixed(2)} bb, not only publish it`).toContain(
    `${expected.toFixed(2)} bb`,
  );
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

      /**
       * AND THE PRE-EVIDENCE FREQUENCY ROW MUST NOT SHOUT. With n = 0 the honest observed frequency
       * is the baseline, so the row reads 50.0% against a 50.0% baseline and +0.0 points — a screen
       * that seeded `observedFrequency: 0` instead would print "0.0% observed against a 50.0%
       * baseline — -50.0 points", the loudest possible lie on a surface whose whole subject is not
       * deviating on noise. The attribute and the sentence are pinned together, because either one
       * alone let that through.
       */
      const preEvidence = (await page.textContent(gateDeviation)) ?? '';
      expect(
        preEvidence,
        'at n=0 the frequency row must read the baseline back, not 0%',
      ).toContain(`${STRONG_BASELINE_PERCENT} observed against a ${STRONG_BASELINE_PERCENT} baseline`);
      expect(preEvidence, 'at n=0 the deviation printed must be exactly 0.0 points').toContain(
        `0.0 points of ${DEVIATION_THRESHOLD_POINTS} needed`,
      );
      expect(await num(page, gateDeviation, 'data-points')).toBeCloseTo(0, 9);

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
      await expect(page.locator(shrinkageTrap)).toHaveAttribute('data-licensed', 'false');
      /**
       * And BOTH numbers are read off the screen, not only off the dataset — the pair only teaches
       * anything if the learner can see 1.31 beside 0.00. `expectBb` asserts the attribute and the
       * printed string together.
       */
      expect(await page.textContent(shrinkageWeight)).toContain('0.655');
      await expectBb(page, appliedDeviation, w(19) * 2);
      await expectBb(page, licensedDeviation, 0);

      // And it is not in the plan at all: core drops it on the sample gate.
      await expect(page.locator(`${planActiveRow}[data-read="${STRONG}"]`)).toHaveCount(0);
      await expect(page.locator(`${planDroppedRow}[data-read="${STRONG}"]`)).toHaveAttribute(
        'data-reason',
        'sample-gate',
      );

      // One more observation flips it, with nothing else changed — the gate is the only difference.
      await observe(page, 1);
      await expect(page.locator(gateLicensed)).toHaveAttribute('data-licensed', 'true');
      await expectBb(page, licensedDeviation, w(20) * 2);
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
      /*
       * AND IT MUST SAY SO. This is the one state where the printed multiplier and a hardcoded "× 1"
       * differ: at every other point in the walk the real multiplier IS 1, so asserting the string
       * anywhere else is satisfied by a constant. Measured — replacing the template with the literal
       * '× 1' passed 17 of 17 until this line existed.
       */
      await expect(
        page.locator(revertMultiplier),
        'the multiplier is halved but the screen does not print × 0.5',
      ).toContainText('× 0.5');
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

      expect(await page.textContent(observationCount)).toContain('0 observations');
      await expect(page.locator(gateDeviation)).toHaveAttribute('data-pass', 'false');

      /**
       * AND THE HITS WENT WITH THE SAMPLE — WHICH ONLY THE NEXT OBSERVATION CAN SHOW.
       *
       * The hit count is a second, independent tally, and at n = 0 the screen honestly reports the
       * BASELINE rather than a ratio, so every figure above is identical whether the 15 hits were
       * cleared or kept. They diverge on the first observation of the new session: a session end that
       * zeroed n while keeping the hits printed "frequency: 1500.0% observed against a 50.0%
       * baseline — +1450.0 points of 15 needed" on the one row this whole screen is about, and it was
       * invisible to data-n, counter-count and data-weight alike.
       *
       * Four fresh observations of a 75% tendency is 3 hits, so the row must read 75.0% and +25.0
       * points — the numbers a first-session n=4 would show, because the stream restarts from the top
       * of its quota. With the hits carried over it reads 450.0% and +400.0 instead.
       */
      await observe(page, 4);
      await expect(page.locator(dossierScreen)).toHaveAttribute('data-n', '4');
      const afterExpiry = (await page.textContent(gateDeviation)) ?? '';
      expect(
        afterExpiry,
        'the first observations of the new session must be counted against a CLEARED hit tally',
      ).toContain(`75.0% observed against a ${STRONG_BASELINE_PERCENT} baseline`);
      expect(afterExpiry, '3 hits of 4 at a 50% baseline is +25.0 points, not +400.0').toContain(
        `+25.0 points of ${DEVIATION_THRESHOLD_POINTS} needed`,
      );
      expect(await num(page, gateDeviation, 'data-points')).toBeCloseTo(25, 6);

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

test.describe('the printed verdict never contradicts the plan it sits beside', () => {
  /**
   * THE DEFECT CLASS THIS FILE PREVIOUSLY MISSED, and it is the one an earlier audit of this codebase
   * caught on another screen: a displayed verdict contradicting its own number. `gates()` answers only
   * R1's two questions. It knows nothing about pre-registration (R2), the breadth cap (R3), or either
   * revert trigger (R4) — so a screen that words its verdict from `gates()` alone announces "may
   * license a deviation" beside a spendable 0.00 bb and a dropped row in the plan.
   *
   * Both tests below therefore assert the SENTENCE and the FIGURE together against core's plan, not
   * just the plan. Asserting the plan alone is what let this through: test 6 already checked that core
   * dropped the read on gate-re-closed, and the prose above it still said the licence was granted.
   */
  test('11. a re-closed gate withdraws the licence in words, not only in the plan', async () => {
    const { page, close } = await launchApp();
    try {
      await openDossier(page);
      await preRegister(page, STRONG);
      await track(page, STRONG);
      await observe(page, MIN_OBSERVATIONS);

      // Granted, and it says so.
      await expect(page.locator(gateLicensed)).toHaveAttribute('data-licensed', 'true');
      expect(await page.textContent(gateLicensed)).toContain('may license a deviation');

      for (let i = 0; i < CONTRARY_OBSERVATIONS_TO_CLOSE; i++) {
        await page.click('[data-testid="contrary-btn"]');
      }

      // Core dropped it. The prose must agree, and must not still be offering the licence.
      await expect(page.locator(`${planDroppedRow}[data-read="${STRONG}"]`)).toHaveAttribute(
        'data-reason',
        'gate-re-closed',
      );
      await expect(page.locator(gateLicensed)).toHaveAttribute('data-licensed', 'false');
      const verdict = (await page.textContent(gateLicensed)) ?? '';
      expect(verdict).not.toContain('may license a deviation');
      expect(verdict).toContain('withdrawn');
      expect(await num(page, licensedDeviation, 'data-bb')).toBe(0);
      await expect(page.locator(licensedDeviation)).toHaveAttribute('data-licensed', 'false');

      /**
       * And R1's own two-gate answer is still published separately and still reads OPEN, because the
       * evidence did not change — only the licence did. Collapsing the two would teach that six
       * contrary observations retroactively shrank the sample.
       */
      await expect(page.locator(gateSample)).toHaveAttribute('data-pass', 'true');
      await expect(page.locator(gateDeviation)).toHaveAttribute('data-pass', 'true');
      await expect(page.locator(gateLicensed)).toHaveAttribute('data-gates', 'true');
    } finally {
      await close();
    }
  });

  test('12. an unregistered read with overwhelming evidence is offered nothing to spend', async () => {
    const { page, close } = await launchApp();
    try {
      await openDossier(page);
      // Deliberately NOT pre-registered: R2 says no evidence can license it this session.
      await track(page, STRONG);
      await observe(page, MIN_OBSERVATIONS);

      await expect(page.locator(preregCount)).toHaveAttribute('data-registered', '0');
      // Both of R1's gates are open, which is exactly what makes this the dangerous case.
      await expect(page.locator(gateSample)).toHaveAttribute('data-pass', 'true');
      await expect(page.locator(gateDeviation)).toHaveAttribute('data-pass', 'true');
      await expect(page.locator(gateLicensed)).toHaveAttribute('data-gates', 'true');

      await expect(page.locator(`${planDroppedRow}[data-read="${STRONG}"]`)).toHaveAttribute(
        'data-reason',
        'not-pre-registered',
      );
      await expect(page.locator(gateLicensed)).toHaveAttribute('data-licensed', 'false');
      expect(await page.textContent(gateLicensed)).toContain('not pre-registered');
      // The load-bearing number: nothing spendable, where the old screen printed w x full exploit.
      expect(await num(page, licensedDeviation, 'data-bb')).toBe(0);
      await expect(page.locator(shrinkageTrap)).toHaveAttribute('data-licensed', 'false');
      // The magnitude figure is unaffected — it is a magnitude, and R1 wants it visible at every n.
      expect(await num(page, appliedDeviation, 'data-bb')).toBeCloseTo(w(MIN_OBSERVATIONS) * 2, 4);
    } finally {
      await close();
    }
  });

  test('13. registering a tendency after the evidence arrived is refused (R2)', async () => {
    /**
     * The cap is not the whole of R2 — "at most two" is a budget, "written at session start" is the
     * epistemics. With only the cap enforced, freeing a slot mid-session laundered 20 observations
     * gathered while the tendency was unregistered straight into an active deviation, which is
     * precisely the opportunistic read R2 sends to the notebook.
     */
    const { page, close } = await launchApp();
    try {
      await openDossier(page);
      await preRegister(page, STRONG);
      await preRegister(page, SECOND_STRONG);

      // Gather overwhelming evidence on a third, unregistered tendency.
      await track(page, INSIDE_BAND);
      await observe(page, MIN_OBSERVATIONS);
      await expect(page.locator(`[data-testid="tendency-row"][data-tendency="${INSIDE_BAND}"]`))
        .toHaveAttribute('data-n', String(MIN_OBSERVATIONS));

      // Free a slot, then try to register the tendency the evidence was gathered on.
      await page.click(`[data-testid="notebook-btn"][data-tendency="${SECOND_STRONG}"]`);
      await expect(page.locator(preregCount)).toHaveAttribute('data-registered', '1');
      expect(await page.textContent(preregCount)).toContain('1 of 2 pre-registered');

      /**
       * THE NOTEBOOK BUTTON MUST FILE, NOT JUST UNREGISTER. This is the only click in the suite that
       * exercises it, and the whole of R2's second half is that a hypothesis leaving the plan is kept
       * rather than dropped: "anything noticed opportunistically goes to a notebook". A button that
       * cleared `preRegistered` and forgot `inNotebook` freed the slot and silently binned the
       * hypothesis — every count on screen agreed, and the notebook stayed empty. So the row is
       * asserted by its NAME, which is also R3's rule that a read is never unnamed.
       */
      const filed = page.locator(`${notebookRow}[data-tendency="${SECOND_STRONG}"]`);
      await expect(
        filed,
        'sending a pre-registration to the notebook must FILE it there, not merely free the slot',
      ).toHaveCount(1);
      await expect(filed).toHaveText(SECOND_STRONG_LABEL);
      await expect(page.locator(notebookEmpty)).toHaveCount(0);
      await expect(
        page.locator(`[data-testid="tendency-row"][data-tendency="${SECOND_STRONG}"]`),
      ).toHaveAttribute('data-registered', 'false');

      await page.click(`[data-testid="prereg-btn"][data-tendency="${INSIDE_BAND}"]`);

      // Refused on provenance, not on the cap — there was a free slot.
      await expect(page.locator(preregRefusal)).toHaveAttribute('data-tendency', INSIDE_BAND);
      expect(await page.textContent(preregRefusal)).toContain('off-plan');
      await expect(page.locator(`[data-testid="tendency-row"][data-tendency="${INSIDE_BAND}"]`))
        .toHaveAttribute('data-registered', 'false');
      await expect(page.locator(preregCount)).toHaveAttribute('data-registered', '1');
      await expect(page.locator(`${planDroppedRow}[data-read="${INSIDE_BAND}"]`)).toHaveAttribute(
        'data-reason',
        'not-pre-registered',
      );
      await expect(page.locator(`${planActiveRow}[data-read="${INSIDE_BAND}"]`)).toHaveCount(0);
      // It is not lost: it is next session's hypothesis, to be tested on fresh data.
      await expect(page.locator(`${notebookRow}[data-tendency="${INSIDE_BAND}"]`)).toHaveCount(1);

      // And after session end, with n back to zero, the same registration is accepted.
      await page.click('[data-testid="end-session-btn"]');
      await expect(page.locator(dossierScreen)).toHaveAttribute('data-sessions-ended', '1');
      await preRegister(page, INSIDE_BAND);
    } finally {
      await close();
    }
  });

  test('14. the surface states that its observations are generated, not played', async () => {
    /**
     * Story 28 heads this surface "what I've actually observed". Nothing in the app persists
     * per-villain action counts, so every count here comes from R6's generated stream — and a screen
     * that showed synthetic data under that heading without saying so would be claiming a history the
     * learner does not have.
     */
    const { page, close } = await launchApp();
    try {
      await openDossier(page);
      const provenance = (await page.textContent('[data-testid="stream-provenance"]')) ?? '';
      expect(provenance.toLowerCase()).toContain('generated');
      expect(provenance.toLowerCase()).toContain('not your own hand history');
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
      // Named, not numbered: R3's ban on "play looser against him" applies to the plan rows too.
      await expect(page.locator(`${planActiveRow}[data-read="${STRONG}"]`)).toContainText(STRONG_LABEL);
      await expect(page.locator(`${planActiveRow}[data-read="${SECOND_STRONG}"]`)).toContainText(
        SECOND_STRONG_LABEL,
      );
    } finally {
      await close();
    }
  });

  test('15. the panel that justifies the cap of two prints core\'s own false-read rates', async () => {
    /**
     * WHY THIS TEST EXISTS. The three rates in `false-read-panel` are the ONLY place R2's headline
     * argument appears to the learner — that a villain with no leak at all looks exploitable on one
     * of ten stats at n=10 almost always, that gating one stat at n=20 cuts that to about a quarter,
     * and that the SECOND pre-registration nearly doubles that quarter, which is why the cap is two
     * and not ten. core/reads.ts unit tests cover the arithmetic; nothing covered its appearance, so
     * a panel rendering 0.0% three times, or the three labels attached to the wrong three numbers,
     * was invisible on this surface.
     *
     * The expectations are COMPUTED by calling core, not copied: `falseReadProbability` is the same
     * function the screen calls, so if R2's threshold or prior moves, this test moves with it rather
     * than pinning a stale percentage.
     */
    const { page, close } = await launchApp();
    try {
      await openDossier(page);

      const scanned = falseReadProbability(10, 10);
      const oneGated = falseReadProbability(1, MIN_OBSERVATIONS);
      const twoGated = falseReadProbability(2, MIN_OBSERVATIONS);

      // Sanity on the claim itself before pinning the pixels: the argument only works if a ten-stat
      // scan is near-certain, a single gated stat is far below it, and the second one costs a lot.
      expect(scanned.atLeastOne).toBeGreaterThan(0.9);
      expect(oneGated.atLeastOne).toBeLessThan(0.5);
      expect(twoGated.atLeastOne).toBeGreaterThan(oneGated.atLeastOne * 1.5);

      const rows: readonly [string, number, string][] = [
        ['false-read-ten-stats', scanned.atLeastOne, '10 stats at n=10, baseline villain'],
        ['false-read-one-gated', oneGated.atLeastOne, `1 pre-registered stat at n=${MIN_OBSERVATIONS}`],
        ['false-read-two-gated', twoGated.atLeastOne, `2 pre-registered stats at n=${MIN_OBSERVATIONS}`],
      ];
      for (const [testid, rate, label] of rows) {
        const row = page.locator(`[data-testid="${testid}"]`);
        expect(await num(page, `[data-testid="${testid}"]`, 'data-rate')).toBeCloseTo(rate, 6);
        // The rendered percentage AND the label it is attached to, so the three cannot swap places.
        await expect(row, `${testid} must print ${(rate * 100).toFixed(1)}%`).toContainText(
          `${(rate * 100).toFixed(1)}%`,
        );
        await expect(row).toContainText(label);
      }

      // And the panel says what the numbers are FOR — the rates alone do not carry R2's conclusion.
      const note = (await page.textContent('[data-testid="false-read-note"]')) ?? '';
      expect(note, 'the note must say these are a villain with NO leak').toContain('no leak at all');
      expect(note, 'and must draw R2\'s conclusion: two rather than ten').toContain(
        'why the cap is two rather than ten',
      );
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
      // The four figures are read off the screen too, not only off the dataset.
      expect(await page.textContent(brier)).toContain('0.2500');
      expect(await page.textContent(baseRateBrier)).toContain('0.1875');
      expect(await page.textContent(uniformBrier)).toContain('0.2500');
      expect(await page.textContent(skillVsUniform)).toContain('0.0%');
      expect(await page.textContent(skillVsBaseRate)).toContain('-33.3%');

      /**
       * THE CLICKED PILL MUST BE THE FORECAST THAT IS GRADED, and this is asserted by ARITHMETIC that
       * only the 90% pill can produce, not by a monotonic drift.
       *
       * The suite previously drew 10 more at 90% and only asserted skillVsBaseRate rose. That is not
       * a fixture, it is a coincidence: baseRateBrier itself wanders as the hit/miss mix changes, so
       * a screen that threw the clicked pill away and recorded every forecast as 50% ALSO made that
       * number rise. 12 more is the count at which the base rate lands back on 0.1875 exactly, so
       * the reference is pinned and every remaining movement belongs to the learner's own forecast.
       *
       * 32 forecasts, 24 of them hits. Twelve at 90% (9 hits, 3 misses) drop the learner's Brier to
       * 0.2350 while the base rate stays at 0.1875 and uniform stays at 0.2500 — so the learner now
       * BEATS uniform by 6.0% and still loses to the base rate by 25.3%. A screen recording every
       * forecast as 50% would print 0.2500 / 0.0% / -33.3% here, unchanged from n=20.
       */
      await observe(page, 12, 90);

      await expect(page.locator(dossierScreen)).toHaveAttribute('data-forecasts', '32');
      expect(await num(page, baseRateBrier, 'data-value')).toBeCloseTo(0.1875, 6);
      expect(await num(page, uniformBrier, 'data-value')).toBeCloseTo(0.25, 6);
      expect(
        await num(page, brier, 'data-value'),
        'the 90% pills must be what is graded, so the Brier must fall to 0.2350',
      ).toBeCloseTo(0.235, 6);
      expect(await page.textContent(brier)).toContain('0.2350');

      // Sharper forecasts at an unchanged reference improve the score against the base rate.
      expect(await num(page, skillVsBaseRate, 'data-value')).toBeCloseTo(-0.235 / 0.1875 + 1, 6);
      expect(
        await page.textContent(skillVsBaseRate),
        'skill vs base rate must PRINT -25.3% once the 90% pills are graded, not -33.3%',
      ).toContain('-25.3%');

      // And the same twelve clicks turn "par against uniform" into a real edge over uniform.
      expect(await num(page, skillVsUniform, 'data-value')).toBeCloseTo(0.06, 6);
      expect(
        await page.textContent(skillVsUniform),
        'skill vs uniform must PRINT 6.0% once the 90% pills are graded, not 0.0%',
      ).toContain('6.0%');

      // 32 forecasts is nowhere near 400, so the curve stays withheld — and it says so, with the count.
      await expect(page.locator(calibrationLock)).toHaveAttribute('data-forecasts', '32');
      await expect(page.locator(calibrationLock)).toHaveAttribute('data-releasable', 'false');
      const withheld = (await page.textContent(calibrationLock)) ?? '';
      expect(withheld, 'the lock must name the threshold it is holding out for').toContain(
        `withheld until ${CALIBRATION_RELEASE_FORECASTS} forecasts`,
      );
      expect(withheld, 'and the progress toward it').toContain('32 so far');
    } finally {
      await close();
    }
  });
});

test.describe('every published attribute agrees with the words printed beside it', () => {
  /**
   * THE RESIDUAL HALF OF THE SAME DEFECT CLASS. `expectBb` above pins a figure's attribute and its
   * rendered string together, and it works — but it was applied to two of the six figures this screen
   * emits through the same two-expression pattern (`figure(testid, printedString)` then
   * `.dataset.x = value`). An adversarial pass then showed the rest are still corruptible with the
   * suite fully green, and I reproduced the worst of them before writing this: tripling the active
   * plan row's printed bb while leaving data-applied-bb correct passed 15 of 15.
   *
   * The five sites below are the ones that survived. They are asserted in ONE test because they share
   * a single cause — a value formatted for the eye in one expression and for the machine in another —
   * so a fix that re-couples them should turn one test green, not five.
   *
   * THE TWO WORD-INVERSIONS ARE THE WORST OF THE FIVE, because a number that is merely wrong invites
   * doubt while a word that is confidently backwards does not: a gate row printing "shut" beside
   * data-pass="true" tells the learner the opposite of what the screen has concluded, on the two rows
   * this entire surface is built around.
   */
  test('15. gate verdicts, observation outcomes and every bb figure read back correctly', async () => {
    const { page, close } = await launchApp();
    try {
      await openDossier(page);
      await preRegister(page, STRONG);
      await track(page, STRONG);

      /*
       * Both gate rows, in the state where they DISAGREE with each other: at n=1 the deviation is
       * already large but the sample gate is shut. A test taken only at n=20 (both open) or n=0 (both
       * shut) cannot tell "prints the verdict" from "prints the same word twice".
       */
      await observe(page, 1);
      const shutSample = await page.getAttribute(gateSample, 'data-pass');
      expect(shutSample, 'the sample gate should still be shut at n=1').toBe('false');
      for (const gate of [gateSample, gateDeviation, gateLicensed]) {
        const pass = (await page.getAttribute(gate, 'data-pass')) === 'true';
        const word = pass ? 'open' : 'shut';
        await expect(
          page.locator(gate),
          `${gate} publishes data-pass=${pass} but does not print "${word}" beside it`,
        ).toContainText(word);
        // And it must not print BOTH words, which a naive fix ("open / shut") would.
        expect(
          (await page.textContent(gate)) ?? '',
          `${gate} prints both verdicts, so the word says nothing`,
        ).not.toContain(pass ? 'shut' : 'open');
      }

      /*
       * The observation sentence. R6's premise is that the stream is felt one observation at a time,
       * so an outcome line that reports the opposite of data-occurred inverts every single one of
       * them. Forecasting 50% keeps the walk deterministic, so both outcomes turn up across a run of
       * observations and the loop below sees each branch of the ternary.
       */
      const seen = new Set<string>();
      for (let step = 0; step < 8; step++) {
        await observe(page, 1);
        const occurred = (await page.getAttribute(lastObservation, 'data-occurred')) === 'true';
        const sentence = occurred ? 'it happened' : 'it did not happen';
        await expect(
          page.locator(lastObservation),
          `data-occurred=${occurred} but the line does not say "${sentence}"`,
        ).toContainText(sentence);
        if (!occurred) {
          // "it happened" is a substring of nothing else, but "it did not happen" CONTAINS the words
          // of neither branch of a swap, so the negative direction needs its own check.
          expect((await page.textContent(lastObservation)) ?? '').not.toMatch(/: it happened/);
        }
        seen.add(String(occurred));
      }
      expect(
        [...seen].sort(),
        'both outcomes must occur for this loop to exercise both branches',
      ).toEqual(['false', 'true']);

      /*
       * The remaining figures. Read the attribute, then require the printed string to be the same
       * number — the exact shape of the `chips / bb` -> `chips * bb` defect this project has already
       * shipped once on another screen, where the attribute stayed right and the caption read 24 bb
       * for a 6 bb pot.
       */
      await expectBb(page, appliedDeviation, await num(page, appliedDeviation, 'data-bb'));
      await expectBb(page, fullExploit, await num(page, fullExploit, 'data-bb'));

      /*
       * The multiplier is asserted in test 5 instead, not here. In THIS state it is always 1, so a
       * hardcoded '× 1' satisfies the check — proven by mutation before this comment was written. The
       * assertion belongs where the value actually varies, which is test 5's 1 -> 0.5 -> 0 walk.
       */
    } finally {
      await close();
    }
  });

  test('16. an active plan row prints the bb it publishes', async () => {
    const { page, close } = await launchApp();
    try {
      /*
       * Reached separately because a row only exists once a read is licensed AND in the plan, which
       * needs the full pre-register -> track -> 20 observations walk. Tests 1 and 5 assert this row's
       * data-applied-bb and test 7 its label; nothing read the number, so tripling it stayed green.
       */
      await openDossier(page);
      await preRegister(page, STRONG);
      await track(page, STRONG);
      await observe(page, 20);

      const rows = page.locator(planActiveRow);
      const count = await rows.count();
      expect(count, 'no active plan row, so this test would prove nothing').toBeGreaterThan(0);
      for (let index = 0; index < count; index++) {
        const row = rows.nth(index);
        const published = Number(await row.getAttribute('data-applied-bb'));
        expect(Number.isFinite(published), `row ${index} publishes no data-applied-bb`).toBe(true);
        await expect(
          row,
          `plan row ${index} publishes ${published} bb but does not print ${published.toFixed(2)} bb`,
        ).toContainText(`${published.toFixed(2)} bb`);
      }
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
