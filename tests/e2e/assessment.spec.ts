import { expect, test, type Page } from '@playwright/test';
import { launchApp } from './helpers.js';

/**
 * WEEKLY ASSESSMENT BLOCK — the graded, feedback-withheld block driven through the real app.
 *
 * The properties that matter: (1) during play NO verdict is ever shown — the whole point of an
 * assessment is that it measures unaided play; (2) a full block produces a single end-of-block reveal
 * with a real EV-loss number over a real sample; and (3) finishing the block lights up the
 * assessment-EV-loss metric on the Progress screen, which is empty on every other path. The sync oracle
 * is the root's data-phase / data-spot, never a sleep.
 */

const homeScreen = '[data-testid="home-screen"]';
const startButton = '[data-testid="progress-start-assessment"]';
const screen = '[data-testid="assessment-screen"]';
const controls = '[data-testid="assessment-controls"]';
const reveal = '[data-testid="assessment-reveal"]';
const score = '[data-testid="assessment-score"]';
const sample = '[data-testid="assessment-sample"]';
const doneBtn = '[data-testid="assessment-done"]';
const leaks = '[data-testid="assessment-leaks"]';
const leakRow = '[data-testid="assessment-leak"]';
const progressMetric = '[data-testid="progress-metric"]';

/** The block launches from the Progress screen, beside the metric it feeds. */
async function openAssessment(page: Page): Promise<void> {
  await page.locator('[data-testid="tab-progress"]').click();
  await page.waitForSelector('[data-testid="progress-screen"]');
  await page.locator(startButton).click();
  await page.waitForSelector(screen);
}

/** Click the first enabled action button until the block reaches its reveal. Returns decisions played. */
async function playToReveal(page: Page): Promise<number> {
  const root = page.locator(screen);
  let guard = 0;
  while ((await root.getAttribute('data-phase')) !== 'reveal' && guard < 400) {
    // Prefer check, then call, then fold — always a legal, enabled button.
    const order = ['assessment-check', 'assessment-call', 'assessment-fold', 'assessment-bet', 'assessment-raise'];
    let clicked = false;
    for (const id of order) {
      const btn = page.locator(`[data-testid="${id}"]`);
      if ((await btn.count()) > 0 && (await btn.isEnabled())) {
        await btn.click();
        clicked = true;
        break;
      }
    }
    expect(clicked, 'every acting spot must offer at least one legal action').toBe(true);
    guard += 1;
  }
  return Number(await root.getAttribute('data-spot'));
}

test('assessment launches from Progress and shows the play surface with no verdict', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  try {
    await openAssessment(page);
    await expect(page.locator(screen)).toHaveAttribute('data-phase', 'acting');
    await expect(page.locator(controls)).toBeVisible();
    // The withheld-feedback promise: nothing that grades a decision is on screen during play.
    await expect(page.locator(reveal)).toHaveCount(0);
    await expect(page.locator('[data-testid="assessment-note"]')).toBeVisible();
  } finally {
    await close();
  }
});

test('during play no per-decision verdict ever appears', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  try {
    await openAssessment(page);
    const root = page.locator(screen);
    // Play a handful of decisions and assert the reveal never shows mid-block.
    for (let i = 0; i < 6; i += 1) {
      if ((await root.getAttribute('data-phase')) === 'reveal') break;
      const check = page.locator('[data-testid="assessment-check"]');
      const call = page.locator('[data-testid="assessment-call"]');
      if (await check.isEnabled()) await check.click();
      else if (await call.isEnabled()) await call.click();
      else await page.locator('[data-testid="assessment-fold"]').click();
      // No reveal, no score, at any mid-block step.
      await expect(page.locator(reveal)).toHaveCount(0);
    }
  } finally {
    await close();
  }
});

test('a full block ends in one reveal with a real EV-loss over a real sample', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  try {
    await openAssessment(page);
    const decisions = await playToReveal(page);
    await expect(page.locator(reveal)).toBeVisible();
    await expect(page.locator(score)).toBeVisible();

    // The sample count matches the decisions actually played, and is non-zero.
    const count = Number(await page.locator(sample).getAttribute('data-count'));
    expect(count).toBe(decisions);
    expect(count).toBeGreaterThan(0);

    // The score is a finite, non-negative bb/100 number (EV LOST is never negative).
    const bb100 = Number(await page.locator(score).getAttribute('data-bb100'));
    expect(Number.isFinite(bb100)).toBe(true);
    expect(bb100).toBeGreaterThanOrEqual(0);
  } finally {
    await close();
  }
});

test('the reveal delivers the withheld verdicts as a costliest-decisions post-mortem', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  try {
    await openAssessment(page);
    await playToReveal(page);
    await expect(page.locator(reveal)).toBeVisible();

    // The leaks section is always present; it either lists the costliest decisions or says there were
    // none. Never more than the top 3, and every listed leak carries the coach's own (non-empty) message.
    const section = page.locator(leaks);
    await expect(section).toBeVisible();
    const shown = Number(await section.getAttribute('data-count'));
    expect(shown).toBeGreaterThanOrEqual(0);
    expect(shown).toBeLessThanOrEqual(3);

    const rows = page.locator(leakRow);
    await expect(rows).toHaveCount(shown);
    for (let i = 0; i < shown; i++) {
      const msg = (await rows.nth(i).locator('[data-testid="assessment-leak-message"]').textContent()) ?? '';
      expect(msg.trim().length, 'a listed leak must carry the coach message it withheld').toBeGreaterThan(0);
    }
    // The passive check/call/fold policy folds hands with equity, so this block has at least one leak —
    // proving the post-mortem populates, not just that the empty state renders.
    expect(shown, 'a passive block should surface at least one costly decision').toBeGreaterThan(0);
  } finally {
    await close();
  }
});

test('finishing a block lights up the assessment-EV-loss metric on Progress (empty on every other path)', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  try {
    // Baseline: on a fresh profile the assessment metric has recorded nothing.
    await page.locator('[data-testid="tab-progress"]').click();
    const metricSample = page.locator(
      `${progressMetric}[data-metric="assessmentEvLossBb100"] [data-testid="metric-sample"]`,
    );
    await expect(metricSample).toHaveText('no decisions recorded yet');

    // Play a full block and finish it (openAssessment launches from the Progress screen).
    await openAssessment(page);
    const decisions = await playToReveal(page);
    await page.locator(doneBtn).click();
    // Done returns to Home.
    await page.waitForSelector(homeScreen);

    // The metric now reports the block's decisions — the number no other screen can produce.
    await page.locator('[data-testid="tab-progress"]').click();
    const card = page.locator(`${progressMetric}[data-metric="assessmentEvLossBb100"]`);
    await expect(card).toHaveAttribute('data-sample', String(decisions));
  } finally {
    await close();
  }
});

test('the assessment block survives a restart (decisions are persisted)', async () => {
  const dir = undefined;
  const first = await launchApp({ seed: 7, userDataDir: dir });
  let userDataDir = first.userDataDir;
  let decisions = 0;
  try {
    await openAssessment(first.page);
    decisions = await playToReveal(first.page);
    await first.page.locator(doneBtn).click();
    await first.page.waitForSelector(homeScreen);
  } finally {
    await first.close();
  }

  // Relaunch against the SAME profile dir; the persisted assessments must still feed the metric.
  const second = await launchApp({ seed: 7, userDataDir });
  try {
    await second.page.locator('[data-testid="tab-progress"]').click();
    const card = second.page.locator(`${progressMetric}[data-metric="assessmentEvLossBb100"]`);
    await expect(card).toHaveAttribute('data-sample', String(decisions));
  } finally {
    await second.close();
  }
});
