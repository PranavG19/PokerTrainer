import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, sel, shot } from './helpers.js';
import { playToShowdown, tableScreen, waitForIdle } from './flow.js';

/**
 * PREDICT-BEFORE-REVEAL — the commit half of the coaching loop.
 *
 * research/TEACHING-METHOD.md failure mode 2: a graded verdict with no committed prediction to
 * contradict carries no discrepancy signal, and feedback effects collapse when the answer is
 * available pre-response. So the renderer LOCKS the action buttons until the hero has committed
 * both an action and a confidence, and the reveal separates SURE-but-wrong (the correction worth
 * studying) from GUESS-but-wrong (an expected miss).
 *
 * The invariant these tests exist to protect: coached mode is OFF by default and the gate must not
 * leak into default play, because 83 other e2e tests drive the action buttons directly.
 *
 * Seeds are PINNED to spots coach.spec.ts already documents:
 *   seed 8, hand 1 — hero holds QsQh on 8c9h8s. Calling 50 preflop is FREE (66% equity);
 *                    folding for 99 into a 348 pot throws away 3.9bb and grades SERIOUS.
 * So on that hand "call" is the coach-agreed action and "fold" is the graded mistake — which is
 * exactly the lever needed to produce a match, a sure-but-wrong and a guess-but-wrong on demand.
 */

const predictPanel = '[data-testid="predict-panel"]';
const predictResult = '[data-testid="predict-result"]';
const predictSupport = '[data-testid="predict-support"]';
const modeToggle = '[data-testid="coach-mode-toggle"]';
const calibration = '[data-testid="calibration"]';
const nextHand = '[data-testid="next-hand"]';
const profileScreen = '[data-testid="profile-screen"]';
const homeScreen = '[data-testid="home-screen"]';

/** Local to this file: tests/e2e/helpers.ts and flow.ts are shared and off limits. */
function freshUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-predict-'));
}

async function openTable(page: Page): Promise<void> {
  await page.locator(sel.newHand).click();
  await page.locator(tableScreen).waitFor();
}

async function enableCoachedMode(page: Page): Promise<void> {
  await page.locator(modeToggle).click();
  await expect(page.locator(modeToggle)).toHaveAttribute('data-on', 'true');
  await expect(page.locator(predictPanel)).toBeVisible();
}

/** The three pills the hero can always reach on the hero's turn, as a disabled/enabled triple. */
async function actionDisabled(page: Page): Promise<Record<string, boolean>> {
  return page.evaluate(() =>
    Object.fromEntries(
      ['btn-fold', 'btn-check', 'btn-call', 'btn-raise'].map((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return [id, el instanceof HTMLButtonElement ? el.disabled : true];
      }),
    ),
  );
}

async function commit(page: Page, action: string, confidence: 'sure' | 'guess'): Promise<void> {
  await page.locator(`[data-testid="predict-${action}"]`).click();
  await page.locator(`[data-testid="confidence-${confidence}"]`).click();
}

/**
 * A committed T2+ mistake now opens the state-4 GATE (gate.spec.ts owns it), which withholds the
 * verdict and locks the action buttons until a self-explanation is submitted. Tests here that
 * deliberately make mistakes must clear it to reach the reveal / keep the hand moving. Submits a
 * passing (range) reason so the gate resolves on the first attempt. No-op when no gate is open.
 */
async function dismissGateIfOpen(page: Page): Promise<void> {
  if ((await page.getAttribute(tableScreen, 'data-gate')) === 'open') {
    await page.locator('[data-testid="gate-input"]').fill('villain only continues a stronger range here');
    await page.locator('[data-testid="gate-submit"]').click();
    await expect(page.locator(tableScreen)).toHaveAttribute('data-gate', 'closed');
  }
}

/**
 * Local coached-mode showdown driver. flow.ts's playToShowdown cannot be used here and must not be
 * edited: it clicks the first ENABLED action button, and in coached mode every button is disabled
 * until a commitment exists — which is the feature, so its "hero turn with no enabled action
 * button" failure is the gate working, not a defect.
 */
async function playCoachedToShowdown(page: Page): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if ((await waitForIdle(page)) === 'handover') return;
    await commit(page, 'check', 'guess');
    for (const selector of [sel.btnCheck, sel.btnCall, sel.btnFold]) {
      if (await page.locator(selector).isEnabled()) {
        await page.locator(selector).click();
        break;
      }
    }
    // A T2+ mistake among these passive actions opens the gate and locks the buttons; clear it so the
    // next iteration can act. (waitForIdle is blind during a gate, so this must run before it.)
    await dismissGateIfOpen(page);
  }
  throw new Error('coached hand did not settle within 20 hero actions');
}

function readSaved(userDataDir: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(userDataDir, 'offsuit-state.json'), 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

async function withApp(
  opts: { seed: number; userDataDir?: string },
  body: (page: Page) => Promise<void>,
): Promise<void> {
  const launched = await launchApp({
    seed: opts.seed,
    userDataDir: opts.userDataDir ?? freshUserDataDir(),
  });
  try {
    await body(launched.page);
  } finally {
    await launched.close();
  }
}

test.describe('coached mode toggle', () => {
  test('1. defaults OFF: no predict panel exists at all', async () => {
    await withApp({ seed: 8 }, async (page) => {
      await openTable(page);
      expect(await waitForIdle(page)).toBe('hero');

      // Not merely hidden — absent. A hidden panel is a gate waiting to leak.
      await expect(page.locator(predictPanel)).toHaveCount(0);
      await expect(page.locator(predictResult)).toHaveCount(0);
      await expect(page.locator(modeToggle)).toHaveAttribute('data-on', 'false');
      await expect(page.locator(modeToggle)).toHaveText(/off/i);
    });
  });

  test('2. with the toggle OFF the action buttons are live immediately and the hand plays as before', async () => {
    await withApp({ seed: 8 }, async (page) => {
      await openTable(page);
      expect(await waitForIdle(page)).toBe('hero');

      // No commitment was made and none is needed: this is the pre-feature contract.
      const disabled = await actionDisabled(page);
      expect(disabled['btn-call']).toBe(false);
      expect(disabled['btn-fold']).toBe(false);
      expect(disabled['btn-raise']).toBe(false);

      await playToShowdown(page);
      await expect(page.locator('[data-testid="winner-summary"]')).toBeVisible();
      await expect(page.locator(predictPanel)).toHaveCount(0);
    });
  });

  test('3. turning it on mounts the panel with all four actions and both confidences', async () => {
    await withApp({ seed: 8 }, async (page) => {
      await openTable(page);
      expect(await waitForIdle(page)).toBe('hero');
      await enableCoachedMode(page);

      for (const id of [
        'predict-fold',
        'predict-check',
        'predict-call',
        'predict-raise',
        'confidence-sure',
        'confidence-guess',
      ]) {
        await expect(page.locator(`[data-testid="${id}"]`), id).toBeEnabled();
      }
      await shot(page, 'predict-panel');
    });
  });

  test('4. turning it back off removes the panel and re-opens the controls', async () => {
    await withApp({ seed: 8 }, async (page) => {
      await openTable(page);
      expect(await waitForIdle(page)).toBe('hero');
      await enableCoachedMode(page);
      expect((await actionDisabled(page))['btn-call']).toBe(true);

      await page.locator(modeToggle).click();
      await expect(page.locator(modeToggle)).toHaveAttribute('data-on', 'false');
      await expect(page.locator(predictPanel)).toHaveCount(0);
      expect((await actionDisabled(page))['btn-call']).toBe(false);
    });
  });
});

test.describe('the gate', () => {
  test('5. every action button is DISABLED until both halves are committed', async () => {
    await withApp({ seed: 8 }, async (page) => {
      await openTable(page);
      expect(await waitForIdle(page)).toBe('hero');
      await enableCoachedMode(page);

      // Nothing committed.
      let disabled = await actionDisabled(page);
      expect(disabled).toEqual({
        'btn-fold': true,
        'btn-check': true,
        'btn-call': true,
        'btn-raise': true,
      });

      // Action only — half a commitment is not a commitment.
      await page.locator('[data-testid="predict-call"]').click();
      disabled = await actionDisabled(page);
      expect(disabled['btn-call'], 'action alone must not unlock the controls').toBe(true);
      expect(disabled['btn-fold']).toBe(true);
      expect(disabled['btn-raise']).toBe(true);

      // Confidence completes it.
      await page.locator('[data-testid="confidence-sure"]').click();
      expect((await actionDisabled(page))['btn-call']).toBe(false);
    });
  });

  test('6. confidence first, then action, also unlocks — order does not matter', async () => {
    await withApp({ seed: 8 }, async (page) => {
      await openTable(page);
      expect(await waitForIdle(page)).toBe('hero');
      await enableCoachedMode(page);

      await page.locator('[data-testid="confidence-guess"]').click();
      expect((await actionDisabled(page))['btn-call'], 'confidence alone must not unlock').toBe(true);

      await page.locator('[data-testid="predict-fold"]').click();
      expect((await actionDisabled(page))['btn-call']).toBe(false);

      // And the committed choices are the ones shown as selected.
      await expect(page.locator('[data-testid="predict-fold"]')).toHaveAttribute(
        'data-selected',
        'true',
      );
      await expect(page.locator('[data-testid="confidence-guess"]')).toHaveAttribute(
        'data-selected',
        'true',
      );
      await expect(page.locator('[data-testid="predict-call"]')).toHaveAttribute(
        'data-selected',
        'false',
      );
    });
  });

  test('7. the gate is in the action path, not just the button: a forced click and the C key do nothing', async () => {
    await withApp({ seed: 8 }, async (page) => {
      await openTable(page);
      expect(await waitForIdle(page)).toBe('hero');
      await enableCoachedMode(page);

      const potBefore = await page.locator(sel.pot).textContent();

      // Bypass Playwright's hittability checks and fire the DOM event directly, then send the
      // keyboard shortcut, which never went through a disabled button in the first place.
      await page.evaluate(() => {
        document.querySelector<HTMLButtonElement>('[data-testid="btn-call"]')?.click();
      });
      await page.keyboard.press('c');
      await page.keyboard.press('f');

      // Still the hero's turn, still the same pot, still nothing revealed.
      await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'hero');
      await expect(page.locator(sel.pot)).toHaveText(potBefore ?? '');
      await expect(page.locator(predictResult)).toBeHidden();
    });
  });
});

test.describe('the reveal', () => {
  /** Seed 8 hand 1: calling 50 preflop with QQ is free, so a committed 'call' is a match. */
  test('8. a prediction the coach agrees with reveals as a match', async () => {
    await withApp({ seed: 8 }, async (page) => {
      await openTable(page);
      expect(await waitForIdle(page)).toBe('hero');
      await enableCoachedMode(page);

      await commit(page, 'call', 'sure');
      await page.locator(sel.btnCall).click();

      const result = page.locator(predictResult);
      await expect(result).toBeVisible();
      await expect(result).toHaveAttribute('data-outcome', 'match');
      await expect(result).toContainText(/agree/i);
      // The verdict settles in with the panel's rise+fade when [hidden] clears (UI polish).
      expect(await result.evaluate((el) => getComputedStyle(el).animationName)).toBe('offsuit-panel-in');
      await shot(page, 'predict-match');
    });
  });

  /** Same pinned spot: folding QQ for 99 into 348 is a 3.9bb SERIOUS error. */
  test('9. SURE-but-wrong is flagged distinctly from GUESS-but-wrong', async () => {
    const sureText = await (async (): Promise<string> => {
      let text = '';
      await withApp({ seed: 8 }, async (page) => {
        await openTable(page);
        await enableCoachedMode(page);
        await commit(page, 'call', 'sure');
        await page.locator(sel.btnCall).click();

        // Second decision: the graded fold, committed as SURE.
        expect(await waitForIdle(page)).toBe('hero');
        await commit(page, 'fold', 'sure');
        await page.locator(sel.btnFold).click();

        const result = page.locator(predictResult);
        await expect(result).toHaveAttribute('data-outcome', 'sure-wrong');
        await expect(result).toContainText('SURE');
        text = (await result.textContent()) ?? '';
        await shot(page, 'predict-sure-wrong');
      });
      return text;
    })();

    let guessText = '';
    await withApp({ seed: 8 }, async (page) => {
      await openTable(page);
      await enableCoachedMode(page);
      await commit(page, 'call', 'sure');
      await page.locator(sel.btnCall).click();

      // The identical action in the identical spot, committed as a GUESS instead.
      expect(await waitForIdle(page)).toBe('hero');
      await commit(page, 'fold', 'guess');
      await page.locator(sel.btnFold).click();

      const result = page.locator(predictResult);
      await expect(result).toHaveAttribute('data-outcome', 'guess-wrong');
      guessText = (await result.textContent()) ?? '';
      await shot(page, 'predict-guess-wrong');
    });

    // Same action, same grade — only the confidence differed, and the reveal must say so.
    expect(guessText).not.toBe(sureText);
    expect(guessText).not.toContain('SURE');
  });

  /**
   * G8's 2x2: the four cells must carry four DIFFERENT support lines (the differential treatment),
   * and 'deviated' must carry none. Pinned seed 8 hand 1 gives all four on demand — call preflop is
   * free (a match: sure-correct or guess-correct by the confidence), fold the flop is a 3.9bb
   * SERIOUS error (sure-wrong or guess-wrong by the confidence).
   */
  test('9b. the four cells render four different support lines; deviated renders none', async () => {
    const supportOf = async (
      confidenceMatch: 'sure' | 'guess',
      confidenceWrong: 'sure' | 'guess' | null,
    ): Promise<string> => {
      let line = '';
      await withApp({ seed: 8 }, async (page) => {
        await openTable(page);
        await enableCoachedMode(page);
        await commit(page, 'call', confidenceMatch);
        await page.locator(sel.btnCall).click();
        if (confidenceWrong === null) {
          // The match cell itself.
          const support = page.locator(predictSupport);
          await expect(support).toBeVisible();
          line = (await support.textContent()) ?? '';
          return;
        }
        // The wrong cell: fold as the graded mistake. That is a T2+ error, so it now opens the gate;
        // clear it so the withheld verdict + support reveal.
        expect(await waitForIdle(page)).toBe('hero');
        await commit(page, 'fold', confidenceWrong);
        await page.locator(sel.btnFold).click();
        await dismissGateIfOpen(page);
        const support = page.locator(predictSupport);
        await expect(support).toBeVisible();
        line = (await support.textContent()) ?? '';
      });
      return line;
    };

    const sureCorrect = await supportOf('sure', null);
    const guessCorrect = await supportOf('guess', null);
    const sureWrong = await supportOf('sure', 'sure');
    const guessWrong = await supportOf('sure', 'guess');

    const lines = [sureCorrect, guessCorrect, sureWrong, guessWrong];
    for (const line of lines) expect(line.length, 'a routed cell owes a support line').toBeGreaterThan(0);
    // The whole point of G8: four cells, four visibly different treatments.
    expect(new Set(lines).size, `four cells must be four different lines: ${JSON.stringify(lines)}`).toBe(4);

    // The confidence phrases prove they are the cells they claim to be.
    expect(sureCorrect).toContain('principle name only');
    expect(guessCorrect).toContain('full elaboration');
    expect(sureWrong).toContain('the full causal chain');
    expect(guessWrong).toContain('terse correction plus a worked example');

    // Deviated: commit fold, then call — nothing was tested, so no support is owed.
    await withApp({ seed: 8 }, async (page) => {
      await openTable(page);
      await enableCoachedMode(page);
      await commit(page, 'fold', 'sure');
      await page.locator(sel.btnCall).click();
      await expect(page.locator(predictResult)).toHaveAttribute('data-outcome', 'deviated');
      await expect(page.locator(predictSupport)).toBeHidden();
      await expect(page.locator(predictSupport)).toHaveText('');
    });
  });

  test('10. a fresh commitment is required for the next decision on the same hand', async () => {
    await withApp({ seed: 8 }, async (page) => {
      await openTable(page);
      await enableCoachedMode(page);
      await commit(page, 'call', 'sure');
      await page.locator(sel.btnCall).click();

      expect(await waitForIdle(page)).toBe('hero');
      // The reveal line stays up — but the commitment is spent, so the controls re-lock.
      await expect(page.locator(predictResult)).toBeVisible();
      expect((await actionDisabled(page))['btn-fold']).toBe(true);
      await expect(page.locator('[data-testid="predict-call"]')).toHaveAttribute(
        'data-selected',
        'false',
      );

      await commit(page, 'fold', 'guess');
      expect((await actionDisabled(page))['btn-fold']).toBe(false);
    });
  });

  test('11. the panel resets between hands — last hand’s verdict is stale advice', async () => {
    await withApp({ seed: 8 }, async (page) => {
      await openTable(page);
      await enableCoachedMode(page);
      await commit(page, 'call', 'sure');
      await page.locator(sel.btnCall).click();
      await expect(page.locator(predictResult)).toBeVisible();

      await playCoachedToShowdown(page);
      await page.locator(nextHand).click();
      expect(await waitForIdle(page)).toBe('hero');

      // Coached mode survives the new hand; the commitment and the verdict do not.
      await expect(page.locator(predictPanel)).toBeVisible();
      await expect(page.locator(predictResult)).toBeHidden();
      await expect(page.locator(predictResult)).toHaveText('');
      expect((await actionDisabled(page))['btn-fold']).toBe(true);
    });
  });
});

test.describe('calibration', () => {
  test('12. counts accumulate and surface on the profile', async () => {
    const userDataDir = freshUserDataDir();
    await withApp({ seed: 8, userDataDir }, async (page) => {
      // Empty first: the zero state must be a sentence, not NaN.
      await page.locator(sel.tabProfile).click();
      await page.waitForSelector(profileScreen);
      await expect(page.locator(calibration)).toHaveText('No predictions yet');
      await expect(page.locator(calibration)).toHaveAttribute('data-total', '0');

      await page.locator(sel.tabPlay).click();
      await openTable(page);
      await enableCoachedMode(page);

      // One match, then one sure-but-wrong, in the pinned seed-8 spot.
      await commit(page, 'call', 'sure');
      await page.locator(sel.btnCall).click();
      expect(await waitForIdle(page)).toBe('hero');
      await commit(page, 'fold', 'sure');
      await page.locator(sel.btnFold).click();

      await expect
        .poll(() => {
          try {
            return (readSaved(userDataDir).calibration as { total: number }).total;
          } catch {
            return -1;
          }
        })
        .toBe(2);

      await page.locator(sel.tabProfile).click();
      await page.waitForSelector(profileScreen);
      const line = page.locator(calibration);
      await expect(line).toHaveAttribute('data-total', '2');
      await expect(line).toHaveAttribute('data-correct', '1');
      await expect(line).toHaveAttribute('data-sure-wrong', '1');
      await expect(line).toContainText('1/2');
      await expect(line).toContainText('1 sure-but-wrong');
      // The confidence split: both commits were SURE (one match, one wrong), so sure-accuracy is 50%
      // and the guess bucket is untouched — the line must not print a misleading one-sided comparison.
      await expect(line).toHaveAttribute('data-sure-total', '2');
      await expect(line).toHaveAttribute('data-sure-accuracy', '50');
      await expect(line).toHaveAttribute('data-guess-total', '0');
      await expect(line).toHaveAttribute('data-guess-accuracy', '');
      await expect(line, 'a one-sided sample must not print the sure-vs-guess split').not.toContainText(
        'vs guess',
      );
      expect(await page.innerText(profileScreen)).not.toMatch(/NaN|undefined/);
      await shot(page, 'predict-calibration');
    });
  });

  test('12b. sure-accuracy and guess-accuracy are split once both have been tested', async () => {
    /**
     * The calibration mechanic's whole point — is a SURE prediction more accurate than a GUESS? —
     * needs both buckets populated. Commit the first decision SURE (a match) and the second as a GUESS
     * (the graded fold), so the sure bucket is 1/1 and the guess bucket is 0/1, and the profile line
     * prints the comparison.
     */
    const userDataDir = freshUserDataDir();
    await withApp({ seed: 8, userDataDir }, async (page) => {
      await openTable(page);
      await enableCoachedMode(page);

      await commit(page, 'call', 'sure');
      await page.locator(sel.btnCall).click();
      expect(await waitForIdle(page)).toBe('hero');
      await commit(page, 'fold', 'guess');
      await page.locator(sel.btnFold).click();

      await expect
        .poll(() => {
          try {
            return (readSaved(userDataDir).calibration as { total: number }).total;
          } catch {
            return -1;
          }
        })
        .toBe(2);

      await page.locator(sel.tabProfile).click();
      await page.waitForSelector(profileScreen);
      const line = page.locator(calibration);
      // Sure: 1/1 = 100%. Guess: 0/1 = 0%. Read independently off their own buckets.
      await expect(line).toHaveAttribute('data-sure-total', '1');
      await expect(line).toHaveAttribute('data-sure-accuracy', '100');
      await expect(line).toHaveAttribute('data-guess-total', '1');
      await expect(line).toHaveAttribute('data-guess-accuracy', '0');
      // With both sides tested, the rendered line now carries the comparison.
      await expect(line).toContainText('sure 100% vs guess 0%');
      expect(await page.innerText(profileScreen)).not.toMatch(/NaN|undefined/);
    });
  });

  test('13. a deviation is not counted: committing fold and then calling tests nothing', async () => {
    const userDataDir = freshUserDataDir();
    await withApp({ seed: 8, userDataDir }, async (page) => {
      await openTable(page);
      await enableCoachedMode(page);

      await commit(page, 'fold', 'sure');
      await page.locator(sel.btnCall).click();

      const result = page.locator(predictResult);
      await expect(result).toHaveAttribute('data-outcome', 'deviated');
      await expect(result).toContainText(/nothing was tested/i);

      await page.locator(sel.tabProfile).click();
      await page.waitForSelector(profileScreen);
      await expect(page.locator(calibration)).toHaveAttribute('data-total', '0');
      await expect(page.locator(calibration)).toHaveText('No predictions yet');
    });
  });

  test('14. the toggle and the tally survive a restart', async () => {
    const userDataDir = freshUserDataDir();

    await withApp({ seed: 8, userDataDir }, async (page) => {
      await openTable(page);
      await enableCoachedMode(page);
      await commit(page, 'call', 'sure');
      await page.locator(sel.btnCall).click();
      await expect(page.locator(predictResult)).toHaveAttribute('data-outcome', 'match');

      await expect
        .poll(() => {
          try {
            return readSaved(userDataDir).coachedMode;
          } catch {
            return undefined;
          }
        })
        .toBe(true);
    });

    await withApp({ seed: 8, userDataDir }, async (page) => {
      await page.waitForSelector(homeScreen);
      await openTable(page);
      expect(await waitForIdle(page)).toBe('hero');

      // Coached mode came back ON, so the gate is armed before the hero has committed anything.
      await expect(page.locator(modeToggle)).toHaveAttribute('data-on', 'true');
      await expect(page.locator(predictPanel)).toBeVisible();
      expect((await actionDisabled(page))['btn-call']).toBe(true);

      await page.locator(sel.tabProfile).click();
      await page.waitForSelector(profileScreen);
      await expect(page.locator(calibration)).toHaveAttribute('data-total', '1');
      await expect(page.locator(calibration)).toHaveAttribute('data-correct', '1');
    });
  });
});

test.describe('coached mode does not break the table', () => {
  test('15. the panel does not push the controls off screen or cover them', async () => {
    await withApp({ seed: 8 }, async (page) => {
      await openTable(page);
      expect(await waitForIdle(page)).toBe('hero');
      await enableCoachedMode(page);
      await commit(page, 'call', 'sure');

      // Same oracle as layout.spec.ts: on screen AND its own centre hit-tests to itself.
      const geometry = await page.evaluate(() =>
        ['btn-fold', 'btn-call', 'btn-raise', 'coach-mode-toggle', 'predict-call'].map((id) => {
          const el = document.querySelector(`[data-testid="${id}"]`);
          if (el === null) return { id, present: false, ok: false };
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return {
            id,
            present: true,
            ok:
              r.width > 0 &&
              r.height > 0 &&
              r.top >= 0 &&
              r.left >= 0 &&
              r.bottom <= window.innerHeight &&
              r.right <= window.innerWidth &&
              hit !== null &&
              (hit === el || el.contains(hit) || hit.contains(el)),
          };
        }),
      );
      for (const box of geometry) {
        expect(box.present, `${box.id} missing`).toBe(true);
        expect(box.ok, `${box.id} is off screen or covered`).toBe(true);
      }

      // And prove it for real with Playwright's full visible/stable/hittable check.
      await page.locator(sel.btnCall).click({ trial: true, timeout: 5_000 });
    });
  });

  /**
   * REGRESSION GUARD, and it caught a real one. layout.spec.ts pins "the document does not scroll
   * at 900x640", but it never turns coached mode on, so it cannot see this panel. The first
   * version of the panel used two rows of pills and measured 674px of content in the 640px
   * viewport — a scrollbar at the app's own documented minimum, the exact defect class that file
   * exists for. Fixed by collapsing to one row plus compact .table-screen .predict rules.
   */
  test('16. the panel does not make the document scroll at the documented 900x640 minimum', async () => {
    await withApp({ seed: 8 }, async (page) => {
      await openTable(page);
      expect(await waitForIdle(page)).toBe('hero');

      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 900,
        height: 640,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await page.waitForFunction(() => window.innerWidth === 900 && window.innerHeight === 640);

      await enableCoachedMode(page);
      await commit(page, 'call', 'sure');

      const { scrollHeight, innerHeight } = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
      }));
      // +1 absorbs sub-pixel rounding, matching layout.spec.ts's tolerance.
      expect(
        scrollHeight,
        `coached mode makes the table ${scrollHeight}px tall in a ${innerHeight}px viewport`,
      ).toBeLessThanOrEqual(innerHeight + 1);

      // And the controls are still reachable, not merely un-scrolled.
      await page.locator(sel.btnCall).click({ trial: true, timeout: 5_000 });
    });
  });

  test('17. a full coached hand reaches showdown and logs the hand exactly once', async () => {
    const userDataDir = freshUserDataDir();
    await withApp({ seed: 8, userDataDir }, async (page) => {
      await openTable(page);
      await enableCoachedMode(page);

      // Commit before every decision, then take the cheapest legal continue.
      await playCoachedToShowdown(page);

      await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'handover');
      await expect(page.locator('[data-testid="winner-summary"]')).toBeVisible();
      await expect
        .poll(() => {
          try {
            return (readSaved(userDataDir).stats as { handsPlayed: number }).handsPlayed;
          } catch {
            return -1;
          }
        })
        .toBe(1);
    });
  });
});

test.describe('the answer is withheld until the commitment', () => {
  /**
   * The gate is worthless if the answer is on screen while you commit: the win% sheet IS the
   * answer, and feedback effects collapse when it is available pre-response. Found by looking at
   * a screenshot — every prediction test passed while the equity sat visible above the panel.
   */
  const statsSheet = '[data-testid="stats-sheet"]';
  const winPct = '[data-testid="win-pct"]';

  async function readSheet(page: Page): Promise<{ win: string; cats: number; withheld: string }> {
    return page.evaluate(() => ({
      win: document.querySelector('[data-testid="win-pct"]')?.textContent ?? '',
      cats: document.querySelectorAll('.stats-cat').length,
      withheld:
        (document.querySelector('[data-testid="stats-sheet"]') as HTMLElement | null)?.dataset
          .withheld ?? '',
    }));
  }

  test('18. coached mode hides the win% and the category breakdown until both halves are in', async () => {
    const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
    try {
      await openTable(page);
      await waitForIdle(page);
      await enableCoachedMode(page);
      await page.locator('[data-testid="stats-toggle"]').click();
      await expect(page.locator(statsSheet)).toHaveAttribute('data-open', 'true');

      const pending = await readSheet(page);
      expect(pending.withheld, 'withheld while the commitment is pending').toBe('true');
      expect(pending.win).not.toMatch(/\d/);
      expect(pending.cats, 'no made-hand breakdown either — that leaks the answer too').toBe(0);

      // A HALF commitment must not release it: action without confidence is not a commitment.
      await page.locator('[data-testid="predict-call"]').click();
      const half = await readSheet(page);
      expect(half.withheld, 'still withheld after only the action half').toBe('true');
      expect(half.win).not.toMatch(/\d/);

      await page.locator('[data-testid="confidence-sure"]').click();
      const done = await readSheet(page);
      expect(done.withheld, 'released once both halves are committed').toBe('false');
      expect(done.win, 'the win% is a real number after committing').toMatch(/^\d+%$/);
      expect(done.cats).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  test('19. with coached mode OFF the win% is visible immediately, as before', async () => {
    const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
    try {
      await openTable(page);
      await waitForIdle(page);
      await expect(page.locator(winPct)).toHaveText(/^\d+%$/);
      const sheet = await readSheet(page);
      expect(sheet.withheld).toBe('false');
    } finally {
      await close();
    }
  });

  test('20. the answer is withheld again on the next street, not just the first decision', async () => {
    const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
    try {
      await openTable(page);
      await waitForIdle(page);
      await enableCoachedMode(page);

      await page.locator('[data-testid="predict-call"]').click();
      await page.locator('[data-testid="confidence-guess"]').click();
      expect((await readSheet(page)).withheld).toBe('false');

      await page.locator(sel.btnCall).click();
      const awaiting = await waitForIdle(page);
      test.skip(awaiting !== 'hero', 'hand ended before a second hero decision');

      // A fresh decision means a fresh commitment, so the answer goes back behind the gate.
      expect((await readSheet(page)).withheld, 'withheld again on the next decision').toBe('true');
    } finally {
      await close();
    }
  });

  test('21. the answer stays hidden while a villain acts, not just on the hero turn', async () => {
    const { page, close } = await launchApp({ seed: 43, userDataDir: freshUserDataDir() });
    try {
      await openTable(page);
      await waitForIdle(page);
      await enableCoachedMode(page);
      await page.locator('[data-testid="stats-toggle"]').click();

      await page.locator('[data-testid="predict-call"]').click();
      await page.locator('[data-testid="confidence-guess"]').click();

      // Click and sample in one evaluate: the villain timer must not fire between them.
      const during = await page.evaluate(() => {
        (document.querySelector('[data-testid="btn-call"]') as HTMLButtonElement).click();
        const root = document.querySelector('[data-testid="table-screen"]') as HTMLElement;
        return {
          awaiting: root.dataset.awaiting ?? '',
          win: document.querySelector('[data-testid="win-pct"]')?.textContent ?? '',
          withheld:
            (document.querySelector('[data-testid="stats-sheet"]') as HTMLElement | null)?.dataset
              .withheld ?? '',
        };
      });

      // Equity does not change within a street, so a win% left up while a villain thinks is the
      // answer to the decision that is about to come back to the hero.
      expect(during.awaiting, 'the sample must land on a villain turn').toBe('ai');
      expect(during.withheld, 'withheld during the villain turn too').toBe('true');
      expect(during.win).not.toMatch(/\d/);
    } finally {
      await close();
    }
  });
});

/**
 * G4 — the reason is graded SEPARATELY from the action (story 14, PRODUCT-SPEC line 212).
 *
 * Seed 8 hand 1: calling 50 preflop is FREE (66% equity), so the EV grade is silent. The reason box
 * is where the separate verdict lives: a hand-strength or "none" rationale on that correct-but-free
 * call is "right for the wrong reason", and an explicit GUESS escalates it. A proper range/price
 * reason triggers nothing, and an empty box never escalates — that last one is the load-bearing
 * safety property, since an empty reason grades 'none' in the core and must not nag a correct play.
 */
const reasonInput = '[data-testid="reason-input"]';
const reasonNote = '[data-testid="coach-reason-note"]';
const coachPanel = '.coach';

test.describe('G4 — the reason is graded separately from the action', () => {
  /** Commit call/SURE with a reason, play the free call, return the reason-note text ('' if hidden). */
  const noteForReason = async (page: Page, reason: string): Promise<string> => {
    await openTable(page);
    await enableCoachedMode(page);
    await commit(page, 'call', 'sure');
    if (reason !== '') await page.locator(reasonInput).fill(reason);
    await page.locator(sel.btnCall).click();
    const note = page.locator(reasonNote);
    if (await note.isHidden()) return '';
    return (await note.textContent()) ?? '';
  };

  test('1. a hand-strength reason on a correct-but-free call is flagged, not escalated', async () => {
    await withApp({ seed: 8 }, async (page) => {
      const note = await noteForReason(page, 'my hand is strong, top pair plays itself');
      expect(note, 'a hand-strength rationale on a right action is right-for-wrong-reason').toContain(
        'not for the reason given',
      );
      // Not escalated: the EV grade stays silent (free), so the panel severity is not 'serious'.
      await expect(page.locator(coachPanel)).not.toHaveAttribute('data-severity', 'serious');
      // The G4 note rises + fades in as it is revealed (UI polish).
      expect(
        await page.locator(reasonNote).evaluate((el) => getComputedStyle(el).animationName),
      ).toBe('offsuit-panel-in');
    });
  });

  test('2. an explicit-guess reason on the same spot ESCALATES to study-this', async () => {
    await withApp({ seed: 8 }, async (page) => {
      const note = await noteForReason(page, 'idk, just guessing here');
      expect(note, 'an explicit guess must escalate').toContain('study this one');
    });
  });

  test('3. a proper price or range reason triggers no G4 note at all', async () => {
    await withApp({ seed: 8 }, async (page) => {
      expect(await noteForReason(page, 'the price is good, pot odds say call'), 'a price reason is fine').toBe('');
    });
    await withApp({ seed: 8 }, async (page) => {
      expect(
        await noteForReason(page, 'he opens 70% from the button so my range defends wide'),
        'a range reason is fine',
      ).toBe('');
    });
  });

  test('4. an EMPTY reason never escalates and shows no note — the safety property', async () => {
    await withApp({ seed: 8 }, async (page) => {
      expect(await noteForReason(page, ''), 'an empty reason must not be graded').toBe('');
      // And the panel is not screaming at a correct, unexplained free call.
      await expect(page.locator(coachPanel)).not.toHaveAttribute('data-severity', 'serious');
    });
  });

  test('5. the reason box is absent in uncoached play — the G4 path is coached-only', async () => {
    await withApp({ seed: 8 }, async (page) => {
      await openTable(page);
      expect(await waitForIdle(page)).toBe('hero');
      // No predict panel at all uncoached, so no reason input can leak into default play.
      await expect(page.locator(reasonInput)).toHaveCount(0);
    });
  });
});
