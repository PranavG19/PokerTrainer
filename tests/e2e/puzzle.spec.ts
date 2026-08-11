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

const railSeam = '[data-testid="puzzle-tutor-rail"]';
const rail = '[data-testid="tutor-rail"]';
const tutorInput = '[data-testid="tutor-input"]';
const tutorSend = '[data-testid="tutor-send"]';
const tutorAnswer = '[data-testid="tutor-answer"]';

async function openPuzzle(page: Page): Promise<void> {
  await page.locator(puzzleTab).click();
  await page.locator(screen).waitFor();
}

/** Ask the puzzle rail a question and block until nothing is in flight. No sleep. */
async function askRail(page: Page, question: string): Promise<void> {
  await page.locator(tutorInput).fill(question);
  await page.locator(tutorSend).click();
  await expect(page.locator(rail)).toHaveAttribute('data-pending', '0');
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

  /**
   * The tutor rail in puzzle mode. Runs with NO credentials (launchApp passes process.env through
   * untouched, so resolveTutor sees no OFFSUIT_BEDROCK_* vars → the null tutor), so every assertion
   * is offline and deterministic. The rail routes through the SAME guarded tutor:ask IPC and mute
   * matrix as the lesson rail — these tests prove the puzzle context is wired to that routing, not
   * that the rail works (tests/e2e/tutor-rail.spec.ts owns that).
   */
  test('6. the tutor rail mounts on the puzzle and answers a mechanics question', async () => {
    await withApp(async (page) => {
      await openPuzzle(page);
      await expect(page.locator(`${railSeam} ${rail}`)).toHaveCount(1);

      // A mechanics question is answered even pre-commit (rules are always allowed).
      await askRail(page, 'which hand beats a flush');
      const first = page.locator(tutorAnswer).first();
      await expect(first).toHaveAttribute('data-state', 'answered');
      const body = (await first.locator('[data-testid="tutor-turn-body"]').textContent()) ?? '';
      expect(body.length).toBeGreaterThan(20);
    });
  });

  test('7. a strategy question is held back before acting and allowed after the verdict', async () => {
    await withApp(async (page) => {
      await openPuzzle(page);

      // BEFORE ACTING: the spot is pre-commit, the strict row — strategy is refused.
      await askRail(page, 'should I raise or fold here');
      await expect(page.locator(tutorAnswer).last()).toHaveAttribute('data-state', 'blocked');

      // Act, so the spot flips to post-reveal.
      await page.locator('[data-testid="puzzle-raise"]').click();
      await expect(page.locator(screen)).toHaveAttribute('data-verdict', 'right');

      // AFTER THE VERDICT: the identical strategy question is now allowed. The rail persisted its
      // transcript across the paint (replaceChildren re-appends the same rail node), so the earlier
      // blocked turn is still there and this one appends to it.
      await askRail(page, 'should I raise or fold here');
      const answers = page.locator(tutorAnswer);
      await expect(answers).toHaveCount(2);
      await expect(answers.last()).toHaveAttribute('data-state', 'answered');
    });
  });

  /**
   * The whole library is reachable and each scenario's taught line grades right when played. This
   * walks every puzzle via "Next puzzle", so a newly-authored scenario that misdeals or whose target
   * line is unreachable through the UI fails here rather than shipping a broken lesson. The correct
   * action per step is looked up by the scenario id the screen publishes, so the walk needs no fixed
   * count and covers scenarios added after this test was written that are listed below.
   */
  test('8. every scenario in the library plays its taught line to completion, graded right', async () => {
    // The target line per scenario, by the id the screen publishes on data-scenario. A scenario not
    // listed here is played by its first legal action, which still exercises the deal and navigation.
    const lines: Record<string, string[]> = {
      'btn-open-aks': ['raise'],
      'bb-defend-vs-btn': ['call', 'bet'],
      'cbet-dry-ace': ['raise', 'bet'],
      'fold-kq-to-utg': ['fold'],
      '3bet-aa-vs-open': ['raise'],
    };

    await withApp(async (page) => {
      await openPuzzle(page);

      const seen = new Set<string>();
      for (let visited = 0; visited < 20; visited++) {
        const id = (await page.locator(screen).getAttribute('data-scenario')) ?? '';
        if (seen.has(id)) break; // wrapped back to the first puzzle — the whole library was walked
        seen.add(id);

        const steps = lines[id];
        expect(steps, `scenario ${id} has no line in the test's map — add its target actions`).toBeDefined();

        for (const action of steps) {
          await expect(page.locator(screen)).toHaveAttribute('data-phase', 'acting');
          await page.locator(`[data-testid="puzzle-${action}"]`).click();
          await expect(page.locator(screen)).toHaveAttribute('data-verdict', 'right');
          await page.locator(continueBtn).click();
        }

        // Every taught decision was correct, so the scenario completes at its full score.
        await expect(page.locator(screen)).toHaveAttribute('data-phase', 'complete');
        await expect(page.locator(screen)).toHaveAttribute('data-correct', String(steps.length));
        await page.locator(nextScenario).click();
      }

      // Proved we walked the whole library, including the scenarios added after test 5. Every id in
      // the map was reachable and each line graded right, or the loop above would have failed.
      expect(seen.size).toBeGreaterThanOrEqual(Object.keys(lines).length);
      expect(seen.has('fold-kq-to-utg')).toBe(true);
      expect(seen.has('3bet-aa-vs-open')).toBe(true);
    });
  });
});
