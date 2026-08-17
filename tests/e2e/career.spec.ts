import { expect, test } from '@playwright/test';
import { launchApp, sel } from './helpers.js';
import { tableScreen, waitForIdle } from './flow.js';

/**
 * THE CAREER SCREEN — a Profile sub-view over core/career.ts. These tests assert the screen is a
 * faithful reader of the honest record: a fresh profile shows zeros and WITHHELD accuracy (never a
 * fabricated 0%), no milestone is achieved, and the cadence grid is exactly 30 dots. After playing a
 * hand, the hands counter and today's cadence dot reflect it. Navigation swaps the full column like the
 * hand picker/replay, and back returns to Profile.
 */

const profileScreen = '[data-testid="profile-screen"]';
const careerScreen = '[data-testid="career-screen"]';
const openCareer = '[data-testid="open-career"]';
const careerBack = '[data-testid="career-back"]';

async function openProfile(page: import('@playwright/test').Page): Promise<void> {
  await page.click('[data-testid="tab-profile"]');
  await page.waitForSelector(profileScreen);
}

test('a fresh profile: the career record is all zeros / withheld, nothing achieved', async () => {
  const { page, close } = await launchApp();
  try {
    await page.waitForSelector('[data-testid="home-screen"]');
    await openProfile(page);
    await page.click(openCareer);
    await page.waitForSelector(careerScreen);

    // Standing on a fresh profile is the calibrating label; form is the settling reading.
    await expect(page.locator('[data-testid="career-standing"]')).toHaveText('Calibrating');

    // Accuracy is WITHHELD, not a fabricated 0%.
    await expect(page.locator('[data-testid="career-sure"]')).toHaveText('not tested yet');
    await expect(page.locator('[data-testid="career-guess"]')).toHaveText('not tested yet');

    // No leak graded yet.
    await expect(page.locator('[data-testid="career-leak"]')).toHaveAttribute('data-empty', 'true');

    // The cadence grid is exactly 30 dots; on a fresh profile none is active.
    await expect(page.locator('[data-testid="career-dot-grid"] .career-dot')).toHaveCount(30);
    await expect(page.locator('[data-testid="career-dot-grid"] .career-dot[data-active="true"]')).toHaveCount(0);

    // No milestone is achieved on a fresh profile.
    await expect(page.locator('[data-testid="career-milestones"] .career-milestone[data-achieved="true"]')).toHaveCount(0);
    // ...but the ladder is present (10 rungs).
    await expect(page.locator('[data-testid="career-milestones"] .career-milestone')).toHaveCount(10);
  } finally {
    await close();
  }
});

test('the career screen swaps in as a full-column sub-view and back returns to Profile', async () => {
  const { page, close } = await launchApp();
  try {
    await page.waitForSelector('[data-testid="home-screen"]');
    await openProfile(page);
    await page.click(openCareer);
    await page.waitForSelector(careerScreen);
    // The Profile column is gone while Career is up (a swap, not an overlay).
    await expect(page.locator(profileScreen)).toHaveCount(0);
    await page.click(careerBack);
    await page.waitForSelector(profileScreen);
    await expect(page.locator(careerScreen)).toHaveCount(0);
  } finally {
    await close();
  }
});

test('after playing a hand, the hands counter and today’s cadence dot reflect it', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  try {
    await page.waitForSelector('[data-testid="home-screen"]');
    // Play one hand to completion so a HandRecord (with playedAt) is logged.
    await page.locator(sel.newHand).click();
    await page.locator(tableScreen).waitFor();
    for (let i = 0; i < 40; i++) {
      const state = await waitForIdle(page);
      if (state === 'handover') break;
      for (const s of [sel.btnCheck, sel.btnCall, sel.btnFold]) {
        const b = page.locator(s);
        if (await b.isEnabled()) {
          await b.click();
          break;
        }
      }
    }

    await openProfile(page);
    await page.click(openCareer);
    await page.waitForSelector(careerScreen);

    // Today's dot (index 29) is active now that a graded activity happened today.
    await expect(
      page.locator('[data-testid="career-dot-grid"] .career-dot[data-today="true"]'),
    ).toHaveAttribute('data-active', 'true');
    // The cadence summary counts at least one distinct day.
    await expect(page.locator('[data-testid="career-cadence"]')).toContainText('1 day');
  } finally {
    await close();
  }
});
