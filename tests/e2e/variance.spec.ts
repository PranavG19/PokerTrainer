import { expect, test, type Page } from '@playwright/test';
import { launchApp } from './helpers.js';
import { riskOfLosing } from '../../src/core/arithmetic.js';

/**
 * VARIANCE EXPLAINER — the honest answer to "where is my results graph". Reached from the Progress
 * results-graph refusal's route. The property that matters: the numbers on the page are core's REAL
 * riskOfLosing output, not hand-written prose that could drift — so the test recomputes them from the
 * same function and asserts the page agrees. If someone edits the copy to a rounder, wronger number, this
 * fails.
 */

const screen = '[data-testid="variance-screen"]';
const row = '[data-testid="variance-row"]';

async function openVariance(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.locator('[data-testid="tab-progress"]').click();
  await page.waitForSelector('[data-testid="progress-screen"]');
  await page.locator('[data-testid="graph-alternative"]').click();
  await page.waitForSelector(screen);
}

// The sample sizes the screen renders, mirrored here so the test computes the same expected numbers.
const SAMPLES = [
  { hands: 200, buyIns: 2 },
  { hands: 2_000, buyIns: 5 },
  { hands: 10_000, buyIns: 10 },
] as const;
const WIN_RATE = 5;

test('the refusal route opens the variance explainer', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await openVariance(page);
    await expect(page.locator(screen)).toBeVisible();
    await expect(page.locator('[data-testid="variance-lede"]')).toBeVisible();
    await expect(page.locator(row)).toHaveCount(SAMPLES.length);
  } finally {
    await close();
  }
});

test('each row shows core\'s real riskOfLosing probability, not a hand-written number', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await openVariance(page);
    for (const sample of SAMPLES) {
      const expected = riskOfLosing({
        hands: sample.hands,
        winRateBbPer100: WIN_RATE,
        buyIns: sample.buyIns,
      });
      const rowEl = page.locator(`${row}[data-hands="${sample.hands}"]`);
      await expect(rowEl).toHaveCount(1);
      // The exposed probability equals core's, to 4dp — the page cannot silently drift from the model.
      await expect(rowEl).toHaveAttribute('data-probability', expected.probability.toFixed(4));
      // The prose uses core's natural-frequency text verbatim.
      await expect(rowEl.locator('[data-testid="variance-odds"]')).toHaveAttribute(
        'data-frequency',
        expected.frequency.text,
      );
    }
  } finally {
    await close();
  }
});

test('the explainer routes back to Progress', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await openVariance(page);
    await page.locator('[data-testid="variance-back"]').click();
    await expect(page.locator('[data-testid="tab-progress"]')).toHaveAttribute('data-active', 'true');
    await expect(page.locator('[data-testid="progress-screen"]')).toBeVisible();
  } finally {
    await close();
  }
});
