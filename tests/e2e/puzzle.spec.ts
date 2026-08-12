import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
const potLine = '[data-testid="puzzle-pot"]';
const oddsLine = '[data-testid="puzzle-odds"]';
const progressLabel = '[data-testid="puzzle-progress-label"]';
const picker = '[data-testid="puzzle-picker"]';

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
      'pot-control-ip': ['raise', 'check'],
      'call-flush-draw-odds': ['call', 'check', 'call'],
      'fold-open-to-3bet': ['raise', 'fold'],
      'barrel-turn-overpair': ['raise', 'bet', 'bet'],
      'call-river-bluffcatch': ['raise', 'check', 'check', 'call'],
      'fold-multiway-ajo': ['fold'],
      'isolate-limper-aqs': ['raise'],
      'squeeze-kk-vs-open-call': ['raise'],
      'checkraise-set-wet': ['call', 'check', 'raise'],
      'fold-flop-airball': ['call', 'check', 'fold'],
      'call-3bet-ip-aqs': ['raise', 'call'],
      '4bet-aa-vs-3bet': ['raise', 'raise'],
      'value-bet-river-flush': ['raise', 'call', 'call', 'bet'],
      'fold-3bet-bluff-to-4bet': ['raise', 'fold'],
      'semibluff-checkraise-draw': ['call', 'check', 'raise'],
      'double-barrel-semibluff': ['raise', 'bet', 'bet'],
      'fold-to-raise-on-cbet': ['raise', 'bet', 'fold'],
      'fold-busted-draw-river': ['raise', 'call', 'call', 'fold'],
      'thin-value-bet-river': ['raise', 'bet', 'check', 'bet'],
      'set-mine-call-22': ['call'],
      'squeeze-fold-weak': ['fold'],
      'call-turn-implied-oesd': ['raise', 'call', 'call'],
      'value-raise-flop-set': ['raise', 'raise'],
      'overpair-fold-river-jam': ['raise', 'bet', 'bet', 'fold'],
      'iso-3bet-vs-limp-reraise': ['raise', 'call'],
      'raise-donk-bet-set': ['raise', 'raise'],
      'overbet-river-nut-flush': ['raise', 'bet', 'bet', 'bet'],
      'checkback-underpair-multiway': ['raise', 'check'],
      'probe-turn-after-checkback': ['call', 'check', 'bet'],
      'blocker-3bet-bluff-a5s': ['raise'],
      'delayed-cbet-turn': ['raise', 'check', 'bet'],
      'trap-flopped-set-dry': ['raise', 'check'],
      'call-3bet-oop-99': ['raise', 'call'],
      'river-bluff-blocker': ['raise', 'bet', 'check', 'bet'],
      'sb-raise-or-fold-ajo': ['raise'],
    };

    await withApp(async (page) => {
      await openPuzzle(page);

      const seen = new Set<string>();
      for (let visited = 0; visited < 41; visited++) {
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

  test('9. the picker jumps directly to any scenario without clicking through the library', async () => {
    await withApp(async (page) => {
      await openPuzzle(page);
      // Opens on the first scenario.
      await expect(page.locator(screen)).toHaveAttribute('data-scenario', 'btn-open-aks');

      const picker = page.locator('[data-testid="puzzle-picker"]');
      // Every scenario is listed, so the whole library is reachable in one hop.
      const optionCount = await picker.locator('option').count();
      expect(optionCount).toBeGreaterThanOrEqual(11);

      // Jump straight to a late scenario by its title — no "Next puzzle" clicking.
      await picker.selectOption({ label: 'Calling a river bluff-catch with second pair' });
      await expect(page.locator(screen)).toHaveAttribute('data-scenario', 'call-river-bluffcatch');
      await expect(page.locator(title)).toHaveText('Calling a river bluff-catch with second pair');
      // Landed fresh at step 0 in the acting phase, no stale progress carried in.
      await expect(page.locator(screen)).toHaveAttribute('data-step', '0');
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'acting');

      // A mid-hand jump elsewhere still resets cleanly.
      await page.locator('[data-testid="puzzle-raise"]').click();
      await expect(page.locator(screen)).toHaveAttribute('data-verdict', 'right');
      await picker.selectOption({ label: 'Opening the button with AKs' });
      await expect(page.locator(screen)).toHaveAttribute('data-scenario', 'btn-open-aks');
      await expect(page.locator(screen)).toHaveAttribute('data-step', '0');
      await expect(page.locator(screen)).toHaveAttribute('data-verdict', '');
    });
  });

  test('10. keyboard shortcuts drill a spot without the mouse, and the rail box is not hijacked', async () => {
    await withApp(async (page) => {
      await openPuzzle(page);
      // First scenario is BTN-open AKs: the taught action is raise, bound to "r".
      await expect(page.locator(screen)).toHaveAttribute('data-scenario', 'btn-open-aks');
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'acting');

      // A letter for an ILLEGAL action does nothing — you cannot check when facing the blinds to open.
      await page.keyboard.press('k');
      await expect(page.locator(screen)).toHaveAttribute('data-verdict', '');

      // "r" raises and is graded right, no click.
      await page.keyboard.press('r');
      await expect(page.locator(screen)).toHaveAttribute('data-verdict', 'right');
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'graded');

      // Enter advances past the verdict; this one-decision puzzle then completes.
      await page.keyboard.press('Enter');
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'complete');

      // Enter again loads the next puzzle from the complete screen.
      await page.keyboard.press('Enter');
      await expect(page.locator(screen)).toHaveAttribute('data-scenario', 'bb-defend-vs-btn');
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'acting');

      // The shortcut must NOT fire while typing into the tutor rail: an "r" in a question is text.
      await page.locator(tutorInput).fill('should i raise or fold');
      await expect(page.locator(screen)).toHaveAttribute('data-verdict', '');
      await expect(page.locator(screen)).toHaveAttribute('data-step', '0');
    });
  });

  test('11. facing a bet, the pot-odds price is shown and its arithmetic is self-consistent', async () => {
    await withApp(async (page) => {
      await openPuzzle(page);

      // Preflop, first to open, there is no bet to call — so no odds line yet.
      await expect(page.locator(screen)).toHaveAttribute('data-scenario', 'btn-open-aks');
      await expect(page.locator(oddsLine)).toHaveCount(0);

      // Jump to the flush-draw scenario and advance to the flop, where the hero faces a c-bet.
      const picker = page.locator('[data-testid="puzzle-picker"]');
      await picker.selectOption({ label: 'Calling a flush draw when the price is right' });
      await expect(page.locator(screen)).toHaveAttribute('data-scenario', 'call-flush-draw-odds');

      // Step 0 (call the preflop open) then check the flop; the villain then c-bets into the hero.
      await page.locator('[data-testid="puzzle-call"]').click();
      await page.locator(continueBtn).click();
      await page.locator('[data-testid="puzzle-check"]').click();
      await page.locator(continueBtn).click();

      // Now the hero faces the flop bet: the odds line is shown and its numbers add up.
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'acting');
      await expect(page.locator(oddsLine)).toHaveCount(1);
      const toCall = Number(await page.locator(oddsLine).getAttribute('data-tocall'));
      const potOdds = Number(await page.locator(oddsLine).getAttribute('data-potodds'));
      // The pot shown on the pot line is the pot BEFORE the hero's call and already includes the bet,
      // so break-even equity = toCall / (pot + toCall). The rendered percentage must match that.
      const potText = (await page.locator(potLine).innerText()).match(/Pot (\d+)/);
      expect(potText, 'pot line missing its number').not.toBeNull();
      const pot = Number(potText?.[1]);
      expect(toCall).toBeGreaterThan(0);
      expect(potOdds).toBe(Math.round((toCall / (pot + toCall)) * 100));
      // And the visible text states the price as a percentage, not just chips.
      expect(await page.locator(oddsLine).innerText()).toContain(`${potOdds}%`);
    });
  });

  test('12. mastering a scenario persists across a restart and shows on the picker', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-puzzle-persist-'));

    // First sitting: solve the opening scenario cleanly (raise AKs), which is a one-decision puzzle.
    const first = await launchApp({ seed: 1, userDataDir: dir });
    try {
      await openPuzzle(first.page);
      await expect(first.page.locator(screen)).toHaveAttribute('data-scenario', 'btn-open-aks');
      // Nothing mastered yet.
      await expect(first.page.locator(progressLabel)).toHaveAttribute('data-mastered', '0');
      await first.page.locator('[data-testid="puzzle-raise"]').click();
      await first.page.locator(continueBtn).click();
      await expect(first.page.locator(screen)).toHaveAttribute('data-phase', 'complete');
      // The mastered count ticked to 1 within this session.
      await expect(first.page.locator(progressLabel)).toHaveAttribute('data-mastered', '1');
    } finally {
      await first.close().catch(() => {});
    }

    // Second sitting, SAME dir: the mastery survived the restart, before touching anything.
    const second = await launchApp({ seed: 1, userDataDir: dir });
    try {
      await openPuzzle(second.page);
      await expect(second.page.locator(progressLabel)).toHaveAttribute('data-mastered', '1');
      // The solved scenario's option carries the ✓ mastered mark.
      const firstOption = second.page.locator(`${picker} option`).first();
      expect(await firstOption.innerText()).toContain('✓');
    } finally {
      await second.close().catch(() => {});
    }
  });

  test('13. the complete screen steers to the next unmastered scenario', async () => {
    await withApp(async (page) => {
      await openPuzzle(page);
      // Master the opener (one raise), so it is no longer a gap.
      await expect(page.locator(screen)).toHaveAttribute('data-scenario', 'btn-open-aks');
      await page.locator('[data-testid="puzzle-raise"]').click();
      await page.locator(continueBtn).click();
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'complete');

      // The steer-to-gap control is offered and jumps to a DIFFERENT, still-unmastered scenario —
      // not back to the one just mastered.
      const toGap = page.locator('[data-testid="puzzle-next-unmastered"]');
      await expect(toGap).toBeVisible();
      await toGap.click();
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'acting');
      await expect(page.locator(screen)).not.toHaveAttribute('data-scenario', 'btn-open-aks');
      await expect(page.locator(screen)).toHaveAttribute('data-step', '0');
    });
  });

  test('14. the complete screen recaps each decision, naming the one that was missed', async () => {
    await withApp(async (page) => {
      await openPuzzle(page);
      // Advance to the two-step BB-defend scenario (same as test 5).
      await page.locator('[data-testid="puzzle-raise"]').click();
      await page.locator(continueBtn).click();
      await page.locator(nextScenario).click();
      await expect(page.locator(title)).toHaveText('Defending the big blind vs a button open');

      // Step 0: play the taught call — a hit. (Folding here would end the hand before step 1, so the
      // miss is placed on the LAST decision, which stays non-terminal until the line completes.)
      await page.locator('[data-testid="puzzle-call"]').click();
      await expect(page.locator(screen)).toHaveAttribute('data-verdict', 'right');
      await page.locator(continueBtn).click();

      // Step 1: deliberately CHECK when the target is to bet — a miss the recap must name.
      await expect(page.locator(screen)).toHaveAttribute('data-step', '1');
      await page.locator('[data-testid="puzzle-check"]').click();
      await expect(page.locator(screen)).toHaveAttribute('data-verdict', 'wrong');
      await page.locator(continueBtn).click();

      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'complete');
      await expect(page.locator(screen)).toHaveAttribute('data-correct', '1');

      // One recap line per decision, in order, correctly attributed.
      const steps = page.locator('[data-testid="puzzle-recap-step"]');
      await expect(steps).toHaveCount(2);
      await expect(steps.nth(0)).toHaveAttribute('data-correct', 'true');
      await expect(steps.nth(1)).toHaveAttribute('data-correct', 'false');
      // The missed decision names both what the learner did and the GTO play — not a bare count.
      const missed = (await steps.nth(1).textContent()) ?? '';
      expect(missed.toLowerCase()).toContain('check');
      expect(missed.toLowerCase()).toContain('bet');
    });
  });
});
