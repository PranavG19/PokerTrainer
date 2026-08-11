import { expect, test, type Page } from '@playwright/test';
import { launchApp } from './helpers.js';

/**
 * PUZZLE MODE — deterministic teaching scenarios, played through the real app.
 *
 * Every scenario is pre-dealt and its target line is fixed, so these assertions are fully
 * deterministic with no seed dependence: the same puzzle always presents the same spot and grades
 * the same way. The sync oracle is the root's data-phase / data-step / data-verdict, never a sleep.
 */

const puzzleTab = '[data-testid="tab-puzzle"]';
const screen = '[data-testid="puzzle-screen"]';
const title = '[data-testid="puzzle-title"]';
const heroCards = '[data-testid="puzzle-hero-cards"]';
const verdict = '[data-testid="puzzle-verdict"]';
const verdictHead = '[data-testid="puzzle-verdict-head"]';
const explanation = '[data-testid="puzzle-explanation"]';
const continueBtn = '[data-testid="puzzle-continue"]';
const complete = '[data-testid="puzzle-complete"]';
const nextScenario = '[data-testid="puzzle-next-scenario"]';

async function openPuzzle(page: Page): Promise<void> {
  await page.locator(puzzleTab).click();
  await page.locator(screen).waitFor();
}

async function withApp(body: (page: Page) => Promise<void>): Promise<void> {
  const { page, close } = await launchApp({ seed: 1 });
  try {
    await body(page);
  } finally {
    await close().catch(() => {});
  }
}

test.describe('puzzle mode', () => {
  test('1. it opens on the first scenario with the hero cards and setup shown', async () => {
    await withApp(async (page) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await openPuzzle(page);

      // The first scenario is BTN-open AKs: two hero cards, an acting phase, step 0 of its line.
      await expect(page.locator(title)).toHaveText('Opening the button with AKs');
      await expect(page.locator(`${heroCards} [data-testid="card"]`)).toHaveCount(2);
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'acting');
      await expect(page.locator(screen)).toHaveAttribute('data-step', '0');
      expect(errors).toEqual([]);
    });
  });

  test('2. the correct action is graded right and shows the explanation', async () => {
    await withApp(async (page) => {
      await openPuzzle(page);
      // AKs on the button: the target is to raise.
      await page.locator('[data-testid="puzzle-raise"]').click();

      await expect(page.locator(screen)).toHaveAttribute('data-verdict', 'right');
      await expect(page.locator(verdict)).toHaveAttribute('data-correct', 'true');
      await expect(page.locator(verdictHead)).toContainText('Correct');
      // The reason is always taught.
      const why = (await page.locator(explanation).textContent()) ?? '';
      expect(why.length).toBeGreaterThan(20);
    });
  });

  test('3. a wrong action is graded wrong but STILL teaches the reason', async () => {
    await withApp(async (page) => {
      await openPuzzle(page);
      // Folding AKs on the button is the mistake.
      await page.locator('[data-testid="puzzle-fold"]').click();

      await expect(page.locator(screen)).toHaveAttribute('data-verdict', 'wrong');
      await expect(page.locator(verdict)).toHaveAttribute('data-correct', 'false');
      await expect(page.locator(verdictHead)).toContainText('Not quite');
      const why = (await page.locator(explanation).textContent()) ?? '';
      expect(why.length).toBeGreaterThan(20);
    });
  });

  test('4. a single-step scenario reaches completion and can advance to the next puzzle', async () => {
    await withApp(async (page) => {
      await openPuzzle(page);
      await page.locator('[data-testid="puzzle-raise"]').click();
      await page.locator(continueBtn).click();

      // BTN-open AKs is a one-decision puzzle, so after Continue the scenario is complete.
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'complete');
      await expect(page.locator(complete)).toBeVisible();

      // Advancing loads the second scenario.
      await page.locator(nextScenario).click();
      await expect(page.locator(title)).toHaveText('Defending the big blind vs a button open');
      await expect(page.locator(screen)).toHaveAttribute('data-step', '0');
    });
  });

  test('5. a two-step scenario grades each decision in turn to completion', async () => {
    await withApp(async (page) => {
      await openPuzzle(page);
      // Advance to the second scenario (BB defend vs BTN): call, then bet the flop.
      await page.locator('[data-testid="puzzle-raise"]').click();
      await page.locator(continueBtn).click();
      await page.locator(nextScenario).click();
      await expect(page.locator(title)).toHaveText('Defending the big blind vs a button open');

      // Step 0: the target is to call the button's open.
      await page.locator('[data-testid="puzzle-call"]').click();
      await expect(page.locator(screen)).toHaveAttribute('data-verdict', 'right');
      await page.locator(continueBtn).click();

      // Step 1: on Q-T-4 with top pair, the target is to bet.
      await expect(page.locator(screen)).toHaveAttribute('data-step', '1');
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'acting');
      await page.locator('[data-testid="puzzle-bet"]').click();
      await expect(page.locator(screen)).toHaveAttribute('data-verdict', 'right');
      await page.locator(continueBtn).click();

      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'complete');
      // Both decisions played the GTO way.
      await expect(page.locator(screen)).toHaveAttribute('data-correct', '2');
    });
  });
});
