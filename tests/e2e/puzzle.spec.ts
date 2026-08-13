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

const classify = '[data-testid="puzzle-classify"]';
const classifyContinue = '[data-testid="puzzle-classify-continue"]';

const railSeam = '[data-testid="puzzle-tutor-rail"]';
const rail = '[data-testid="tutor-rail"]';
const tutorInput = '[data-testid="tutor-input"]';
const tutorSend = '[data-testid="tutor-send"]';
const tutorAnswer = '[data-testid="tutor-answer"]';

async function openPuzzle(page: Page): Promise<void> {
  // Spots (puzzle) now lives behind the Train hub; open the hub, then its rail button.
  await page.locator('[data-testid="tab-train"]').click();
  await page.locator(puzzleTab).click();
  await page.locator(screen).waitFor();
}

/**
 * State 1 CLASSIFY fires before the FIRST hero action of every (preflop-opening) scenario: the learner
 * names the spot type, it is graded independently, then a Continue falls through to the action. Most
 * tests below care about the action decision, not the classify sub-skill, so this helper clears the
 * classify step by picking any spot type and continuing. Tests that assert on classify itself (the
 * dedicated ones) do not use this. No-op when the classify picker is not up (e.g. mid-hand, post-flop).
 */
async function passClassify(page: Page): Promise<void> {
  if (await page.locator(screen).getAttribute('data-phase') === 'classify') {
    await page.locator('[data-testid="puzzle-classify-rfi"]').click();
    await page.locator(classifyContinue).click();
    await expect(page.locator(screen)).toHaveAttribute('data-phase', 'acting');
  }
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

      // State 1 CLASSIFY runs first: the spot opens in the classify phase with the hero cards visible
      // but the title BLINDED, so the heading cannot hand over the spot type before the learner names it.
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'classify');
      await expect(page.locator(`${heroCards} [data-testid="card"]`)).toHaveCount(2);
      await expect(page.locator(title)).toHaveAttribute('data-blinded', 'true');
      await passClassify(page);

      // Once classified, the real scenario is revealed: BTN-open AKs, acting phase, step 0 of its line.
      await expect(page.locator(title)).toHaveText('Opening the button with AKs');
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'acting');
      await expect(page.locator(screen)).toHaveAttribute('data-step', '0');
      expect(errors).toEqual([]);
    });
  });

  test('2. the correct action is graded right and shows the explanation', async () => {
    await withApp(async (page) => {
      await openPuzzle(page);
      await passClassify(page);
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
      await passClassify(page);
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
      await passClassify(page);
      await page.locator('[data-testid="puzzle-raise"]').click();
      await page.locator(continueBtn).click();

      // BTN-open AKs is a one-decision puzzle, so after Continue the scenario is complete.
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'complete');
      await expect(page.locator(complete)).toBeVisible();

      // Advancing loads the second scenario, which opens in its own classify step; clear it, then the
      // real title is revealed.
      await page.locator(nextScenario).click();
      await passClassify(page);
      await expect(page.locator(title)).toHaveText('Defending the big blind vs a button open');
      await expect(page.locator(screen)).toHaveAttribute('data-step', '0');
    });
  });

  test('5. a two-step scenario grades each decision in turn to completion', async () => {
    await withApp(async (page) => {
      await openPuzzle(page);
      // Advance to the second scenario (BB defend vs BTN): call, then bet the flop.
      await passClassify(page);
      await page.locator('[data-testid="puzzle-raise"]').click();
      await page.locator(continueBtn).click();
      await page.locator(nextScenario).click();
      await passClassify(page);
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

      // Clear the classify step, then act so the spot flips to post-reveal.
      await passClassify(page);
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
    // This is the one long walk: it plays EVERY scenario's full line, and each now opens with a CLASSIFY
    // round-trip before the action row — ~45 scenarios × (classify + continue + line) is a lot of UI
    // actions, so it runs past the default 60s. Triple the budget rather than trim coverage.
    test.slow();
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
      'fold-tptk-turn-flush-in': ['raise', 'bet', 'fold'],
      'fold-weak-pair-river-overbet': ['raise', 'check', 'check', 'fold'],
      'fold-weak-ace-to-ep-open': ['fold'],
      '3bet-aqs-vs-btn-steal': ['raise'],
      // Stack-depth / SPR module (40bb commit, 200bb pot-control) — added with the depth scenarios.
      'commit-tptk-40bb': ['raise', 'bet'],
      'commit-overpair-40bb': ['raise', 'bet'],
      'commit-flush-draw-jam-40bb': ['raise', 'raise'],
      'deep-fold-tptk-200bb': ['raise', 'bet', 'check', 'fold'],
      'deep-pot-control-overpair-200bb': ['raise', 'bet', 'call'],
      'deep-stack-set-200bb': ['raise'],
      // Multiway-pots module — the field changes the right play (tighten value, cut bluffs, set-mine).
      'multiway-fold-ako-to-3bet-and-call': ['raise', 'fold'],
      'multiway-no-cbet-bluff-air': ['raise', 'check'],
      'multiway-tighten-value-bet': ['call', 'bet'],
      'multiway-set-mine-price': ['call'],
      // Blind-vs-blind module — heads-up ranges explode (steal wide, defend wider, 3-bet value, range c-bet).
      'bvb-sb-open-wide': ['raise'],
      'bvb-bb-defend-wide': ['call'],
      'bvb-bb-3bet-value': ['raise'],
      'bvb-bb-checkraise-semibluff': ['call', 'check', 'raise'],
      'bvb-sb-cbet-dry': ['raise', 'bet'],
      'bvb-sb-double-barrel-value': ['raise', 'bet', 'bet'],
      // Fold-draws-for-wrong-price — mirror of call-flush-draw-odds, module 4.
      'fold-gutshot-to-flop-cbet': ['call', 'check', 'fold'],
      'fold-flush-draw-to-flop-overbet': ['call', 'check', 'fold'],
      // Scare-card shutdown — mirror of barrel-turn-overpair, module 6 (the-turn).
      'shutdown-qq-ace-turn': ['raise', 'bet', 'check'],
      'fold-kk-donk-ace-turn': ['raise', 'bet', 'fold'],
    };

    await withApp(async (page) => {
      await openPuzzle(page);

      const seen = new Set<string>();
      // One iteration per library scenario, plus a small margin so the wrap-detection (not the bound)
      // is what ends the walk. Grows automatically as the library does.
      const walkLimit = Object.keys(lines).length + 5;
      for (let visited = 0; visited < walkLimit; visited++) {
        const id = (await page.locator(screen).getAttribute('data-scenario')) ?? '';
        if (seen.has(id)) break; // wrapped back to the first puzzle — the whole library was walked
        seen.add(id);

        const steps = lines[id];
        expect(steps, `scenario ${id} has no line in the test's map — add its target actions`).toBeDefined();

        // Every scenario opens on the CLASSIFY step (preflop first decision); clear it before playing
        // the taught action line. The classify pick is scored independently and never blocks progress.
        await passClassify(page);

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
      // Opens on the first scenario (its id is published even under the blinded classify header).
      await expect(page.locator(screen)).toHaveAttribute('data-scenario', 'btn-open-aks');
      // The picker lives in the header, which is blinded during CLASSIFY; clear the classify step to
      // reveal it (the labels name the spot, so it stays hidden until the learner has named it).
      await passClassify(page);

      const picker = page.locator('[data-testid="puzzle-picker"]');
      // Every scenario is listed, so the whole library is reachable in one hop.
      const optionCount = await picker.locator('option').count();
      expect(optionCount).toBeGreaterThanOrEqual(11);

      // Jump straight to a late scenario by its title — no "Next puzzle" clicking. The jump lands on
      // that scenario's own classify step; clear it, then the title is revealed.
      await picker.selectOption({ label: 'Calling a river bluff-catch with second pair' });
      await expect(page.locator(screen)).toHaveAttribute('data-scenario', 'call-river-bluffcatch');
      await passClassify(page);
      await expect(page.locator(title)).toHaveText('Calling a river bluff-catch with second pair');
      // Landed fresh at step 0 in the acting phase, no stale progress carried in.
      await expect(page.locator(screen)).toHaveAttribute('data-step', '0');
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'acting');

      // A mid-hand jump elsewhere still resets cleanly. Raising leaves a verdict on screen (a non-classify
      // phase), where the picker is visible again to jump from.
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
      // First scenario is BTN-open AKs: the taught action is raise, bound to "r". Clear the classify
      // step first (action keys are inert during classify — it is picked by clicking a spot type).
      await expect(page.locator(screen)).toHaveAttribute('data-scenario', 'btn-open-aks');
      await passClassify(page);
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

      // Enter again loads the next puzzle from the complete screen — which opens on its classify step.
      await page.keyboard.press('Enter');
      await expect(page.locator(screen)).toHaveAttribute('data-scenario', 'bb-defend-vs-btn');
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'classify');
      await passClassify(page);
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

      // Clear the classify step to reveal the picker (blinded during CLASSIFY).
      await expect(page.locator(screen)).toHaveAttribute('data-scenario', 'btn-open-aks');
      await passClassify(page);

      // Preflop, first to open, there is no bet to call — so no odds line yet.
      await expect(page.locator(oddsLine)).toHaveCount(0);

      // Jump to the flush-draw scenario and advance to the flop, where the hero faces a c-bet.
      const picker = page.locator('[data-testid="puzzle-picker"]');
      await picker.selectOption({ label: 'Calling a flush draw when the price is right' });
      await expect(page.locator(screen)).toHaveAttribute('data-scenario', 'call-flush-draw-odds');
      await passClassify(page);

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
      await passClassify(first.page);
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
      // The progress label and picker live in the header, blinded during CLASSIFY; clear it to read them.
      await passClassify(second.page);
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
      await passClassify(page);
      await page.locator('[data-testid="puzzle-raise"]').click();
      await page.locator(continueBtn).click();
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'complete');

      // The steer-to-gap control is offered and jumps to a DIFFERENT, still-unmastered scenario —
      // not back to the one just mastered. It lands on that scenario's classify step.
      const toGap = page.locator('[data-testid="puzzle-next-unmastered"]');
      await expect(toGap).toBeVisible();
      await toGap.click();
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'classify');
      await expect(page.locator(screen)).not.toHaveAttribute('data-scenario', 'btn-open-aks');
      await passClassify(page);
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'acting');
      await expect(page.locator(screen)).toHaveAttribute('data-step', '0');
    });
  });

  test('14. the complete screen recaps each decision, naming the one that was missed', async () => {
    await withApp(async (page) => {
      await openPuzzle(page);
      // Advance to the two-step BB-defend scenario (same as test 5).
      await passClassify(page);
      await page.locator('[data-testid="puzzle-raise"]').click();
      await page.locator(continueBtn).click();
      await page.locator(nextScenario).click();
      await passClassify(page);
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

  test('15. the picker groups every scenario into an ordered curriculum, and grouping keeps jump-by-index working', async () => {
    /**
     * The curriculum is a VIEW over the flat library: the picker's options are grouped into an
     * <optgroup> per teaching module (preflop → flop → turn → river), but the option VALUE stays the
     * scenario's index in SCENARIOS, so nothing about "Next puzzle" or jump-by-index changes. This
     * test pins three things: the groups exist and are ordered/labelled, EVERY scenario lives in
     * exactly one group (no spot silently dropped from the grouped list), and selecting a grouped
     * option still jumps to its scenario.
     */
    await withApp(async (page) => {
      await openPuzzle(page);
      // The picker lives in the header, blinded during CLASSIFY; clear it to reveal the picker.
      await passClassify(page);
      const select = page.locator(picker);

      // Nine modules, in the taught order, each header carrying a per-module "done/total" count.
      const groups = select.locator('optgroup');
      await expect(groups).toHaveCount(10);
      const labels = await groups.evaluateAll((els) => els.map((el) => (el as HTMLOptGroupElement).label));
      expect(labels[0], 'the first module is preflop fundamentals').toContain('Preflop Fundamentals');
      expect(labels[6], 'the seventh module is the river').toContain('The River');
      expect(labels[7], 'the eighth module is multiway pots').toContain('Multiway Pots');
      expect(labels[8], 'the ninth module is blind vs blind').toContain('Blind vs Blind');
      expect(labels[9], 'the last module is stack depth').toContain('Stack Depth');
      for (const label of labels) {
        // Every header states progress as N/M, and a fresh profile has nothing mastered.
        expect(label, `module header "${label}" carries no done/total count`).toMatch(/— 0\/\d+$/);
      }

      // Every scenario option lives inside a group — the grouped option count equals the flat library,
      // so no scenario was orphaned by the grouping. (The flat count is asserted >= 11 by test 9; here
      // we assert the grouped total matches the ungrouped total exactly.)
      const totalOptions = await select.locator('option').count();
      const groupedOptions = await select.locator('optgroup > option').count();
      expect(groupedOptions, 'some scenarios are not inside any curriculum module').toBe(totalOptions);

      // The sum of the module counts in the headers equals the library size — the partition is total.
      const perModule = labels.map((l) => Number(/\/(\d+)$/.exec(l)?.[1] ?? '0'));
      expect(perModule.reduce((a, b) => a + b, 0)).toBe(totalOptions);

      // Grouping did not break selection: a grouped option still jumps to its scenario at a fresh step.
      // On a fresh profile nothing is attempted or mastered, so the option label is exactly the title.
      await select.selectOption({ label: 'Barrelling the turn with an overpair' });
      await expect(page.locator(screen)).toHaveAttribute('data-scenario', 'barrel-turn-overpair');
      await expect(page.locator(screen)).toHaveAttribute('data-step', '0');
      // The jump lands on that scenario's classify step; clearing it reaches the acting phase.
      await passClassify(page);
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'acting');
    });
  });

  test('16. the spot names its curriculum module, and the module tracks the scenario', async () => {
    /**
     * The module line makes the preflop→river progression legible WHILE playing, not just in the
     * open picker. It is derived from the curriculum (moduleForScenario), so it must name the right
     * module for the current spot and follow a jump to a different module's scenario.
     */
    await withApp(async (page) => {
      await openPuzzle(page);
      // The module caption lives in the header, blinded during CLASSIFY; clear it to read the caption.
      await passClassify(page);
      const moduleLine = page.locator('[data-testid="puzzle-module"]');

      // The first scenario (btn-open-aks) is in module 1, preflop fundamentals.
      await expect(moduleLine).toBeVisible();
      await expect(moduleLine).toHaveAttribute('data-module-key', 'preflop-fundamentals');
      await expect(moduleLine).toContainText('Module 1 of 10');
      await expect(moduleLine).toContainText('Preflop Fundamentals');

      // Jump to a river scenario: the module line follows to module 7. The jump lands on that scenario's
      // classify step; clear it so the (blinded-during-classify) module caption is shown again.
      const select = page.locator(picker);
      await select.selectOption({ label: 'Folding the busted flush draw on the river' });
      await expect(page.locator(screen)).toHaveAttribute('data-scenario', 'fold-busted-draw-river');
      await passClassify(page);
      await expect(moduleLine).toHaveAttribute('data-module-key', 'the-river');
      await expect(moduleLine).toContainText('Module 7 of 10');
    });
  });

  /**
   * State 1 CLASSIFY (PRODUCT-SPEC G5a): the learner NAMES the spot type before acting, the app never
   * labels it, and it is scored INDEPENDENTLY of whether the action is right. These two tests own that
   * contract: (17) the picker offers the closed set with the title blinded and grades the pick, and
   * (18) a WRONG classification does not touch the action grade or the completion score.
   */
  test('17. the classify step names the spot type from a blinded table, and grades the pick', async () => {
    await withApp(async (page) => {
      await openPuzzle(page);

      // Opens in the classify phase: the picker is shown, the title is blinded (no pre-classification),
      // and the four preflop spot types are offered.
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'classify');
      await expect(page.locator(classify)).toBeVisible();
      await expect(page.locator(title)).toHaveAttribute('data-blinded', 'true');
      for (const type of ['rfi', 'defend', '3bet-response', 'squeeze']) {
        await expect(page.locator(`[data-testid="puzzle-classify-${type}"]`)).toBeVisible();
      }

      // btn-open-aks is a first-in open → RFI. Picking it is graded right and published separately from
      // the (still-unset) action verdict.
      await page.locator('[data-testid="puzzle-classify-rfi"]').click();
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'classified');
      await expect(page.locator(screen)).toHaveAttribute('data-classify', 'right');
      await expect(page.locator(screen)).toHaveAttribute('data-verdict', '');
      await expect(page.locator('[data-testid="puzzle-classify-verdict"]')).toHaveAttribute('data-correct', 'true');

      // Continue falls through to the real action decision.
      await page.locator(classifyContinue).click();
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'acting');
    });
  });

  test('18. a wrong classification is scored on its own and does NOT taint the action grade', async () => {
    await withApp(async (page) => {
      await openPuzzle(page);
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'classify');

      // Misname the RFI spot as a defend: graded wrong, but this is a separate sub-skill.
      await page.locator('[data-testid="puzzle-classify-defend"]').click();
      await expect(page.locator(screen)).toHaveAttribute('data-classify', 'wrong');
      await expect(page.locator('[data-testid="puzzle-classify-verdict"]')).toHaveAttribute('data-correct', 'false');
      await page.locator(classifyContinue).click();

      // The action is still played and graded on its own merits: raising AKs is right, and the scenario
      // completes at its full score despite the missed classification — classify never blocks progress.
      await page.locator('[data-testid="puzzle-raise"]').click();
      await expect(page.locator(screen)).toHaveAttribute('data-verdict', 'right');
      await page.locator(continueBtn).click();
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'complete');
      await expect(page.locator(screen)).toHaveAttribute('data-correct', '1');
    });
  });

  /*
   * ACCESSIBILITY — the graded outputs reach screen readers. The classify verdict, the action verdict,
   * and the completion score all update in place, so without a live region an SR learner gets no
   * feedback. An always-present visually-hidden role=status region mirrors whichever verdict the body
   * is showing, and is empty while acting/classifying. This walks all three graded states.
   */
  test('19. the classify, action, and completion verdicts are all announced to screen readers', async () => {
    await withApp(async (page) => {
      const announcer = page.locator('[data-testid="puzzle-announcer"]');
      await openPuzzle(page);

      // Live region, empty while the picker is up (classify phase, nothing graded yet).
      await expect(announcer).toHaveAttribute('role', 'status');
      await expect(announcer).toHaveAttribute('aria-live', 'polite');
      await expect(announcer).toHaveText('');

      // (1) Classify verdict — announcement carries the same head the classify block shows.
      await page.locator('[data-testid="puzzle-classify-rfi"]').click();
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'classified');
      const classifyHead =
        (await page.locator('[data-testid="puzzle-classify-verdict-head"]').textContent()) ?? '';
      expect(classifyHead.length).toBeGreaterThan(0);
      await expect(announcer).toHaveText(classifyHead);

      // Falling through to the action clears the announcement (acting phase, nothing graded).
      await page.locator(classifyContinue).click();
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'acting');
      await expect(announcer).toHaveText('');

      // (2) Action verdict — announcement leads with the verdict head and includes the taught reason.
      await page.locator('[data-testid="puzzle-raise"]').click();
      await expect(page.locator(screen)).toHaveAttribute('data-verdict', 'right');
      const head = (await page.locator(verdictHead).textContent()) ?? '';
      const why = (await page.locator(explanation).textContent()) ?? '';
      const spoken = (await announcer.textContent()) ?? '';
      expect(spoken.startsWith(head)).toBe(true);
      expect(spoken).toContain(why);

      // (3) Completion — the score line is announced, and it is the same line the complete block shows.
      await page.locator(continueBtn).click();
      await expect(page.locator(screen)).toHaveAttribute('data-phase', 'complete');
      const announcedScore = (await announcer.textContent()) ?? '';
      expect(announcedScore).toMatch(/You played \d+ of \d+ decisions the GTO way\./);
      expect((await page.locator(complete).textContent()) ?? '').toContain(announcedScore);
    });
  });
});
