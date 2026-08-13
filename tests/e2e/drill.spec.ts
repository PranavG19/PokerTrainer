import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, shot } from './helpers.js';

/**
 * THE DRILL TAB — the arithmetic trainer.
 *
 * Two things in here are load-bearing and easy to get wrong:
 *
 * SYNC ORACLE, NEVER A SLEEP. The drill root republishes data-phase (answer|graded), data-index,
 * data-seed, data-kind, data-commits and data-verdict on every paint, exactly as the table root
 * publishes data-awaiting. Every wait below keys off one of those attributes.
 *
 * THE UNMOUNT TEST IS THE REASON THE STASH EXISTS. Proving a window listener was removed cannot be
 * done by pressing a key and observing nothing: nothing is also what a live-but-harmless listener
 * produces. So the detached root is stashed on window with an answer already typed into its box,
 * and then Enter is pressed on another tab: a listener that outlived the screen would commit that
 * answer on the detached tree and move data-commits, which is observable.
 *
 * The expected numbers below are core's, recomputed by hand from src/core/arithmetic.ts at the
 * pinned seed rather than read back off the screen, so a change in either side shows up here:
 *   seed 101 → potBeforeBet 4.5, bet 4.5, effectiveStack 98
 *     pot-odds: toCall 4.5, potAfterCall 4.5 + 2*4.5 = 13.5, required 4.5/13.5 = 33.33%
 *     alpha / mdf: 4.5 / 9 = 50%, so both are 50%
 *     spr: pot 13.5 after the call, 93.5 behind → 6.93, tolerance max(0.25, 5%) = 0.35
 */

const drillScreen = '[data-testid="drill-screen"]';
const answerBox = '[data-testid="drill-answer"]';
const commitBtn = '[data-testid="drill-commit"]';
const nextBtn = '[data-testid="drill-next"]';
const prompt = '[data-testid="drill-prompt"]';
const method = '[data-testid="drill-method"]';
const step = '[data-testid="drill-step"]';
const verdict = '[data-testid="drill-verdict"]';
const verdictLine = '[data-testid="drill-verdict-line"]';
const yours = '[data-testid="drill-yours"]';
const right = '[data-testid="drill-right"]';
const gapLine = '[data-testid="drill-gap"]';
const kindBtn = '[data-testid="drill-kind-btn"]';
const currentKind = '[data-testid="drill-current-kind"]';
const tally = '[data-testid="drill-tally"]';
const tallyTotal = '[data-testid="drill-tally-total"]';
const unit = '[data-testid="drill-unit"]';
const hint = '[data-testid="drill-hint"]';
const side = '[data-testid="drill-side"]';
const work = '[data-testid="drill-work"]';
const announcer = '[data-testid="drill-announcer"]';

/** DRILL_KINDS in core/arithmetic.ts, mirrored so a silent edit to either side shows up here. */
const KINDS = ['pot-odds', 'alpha', 'mdf', 'spr'] as const;

/** SPEC.md's documented window: "1100x760, non-resizable-min 900x640". */
const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 760;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 640;

/** The first seed the screen serves. BASE_SEED in screens/drill.ts. */
const FIRST_SEED = '101';

async function openDrill(page: Page): Promise<void> {
  // The Math (drill) surface now lives behind the Train hub: open the hub, then its rail button (which
  // keeps the old tab-drill testid).
  await page.click('[data-testid="tab-train"]');
  await page.click('[data-testid="tab-drill"]');
  await page.waitForSelector(drillScreen);
  await expect(page.locator(answerBox)).toBeVisible();
}

async function selectKind(page: Page, kind: string): Promise<void> {
  await page.click(`${kindBtn}[data-kind="${kind}"]`);
  await expect(page.locator(drillScreen)).toHaveAttribute('data-kind', kind);
}

/** Type an answer and commit it with Enter, blocking until the root says it has graded. */
async function answerWithEnter(page: Page, typed: string): Promise<void> {
  await page.fill(answerBox, typed);
  await page.keyboard.press('Enter');
  await expect(page.locator(drillScreen)).toHaveAttribute('data-phase', 'graded');
}

/** Enter on a graded problem advances. Blocks until the index has actually moved. */
async function advanceWithEnter(page: Page): Promise<void> {
  const before = Number(await page.getAttribute(drillScreen, 'data-index'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (want: number) =>
      Number(
        (document.querySelector('[data-testid="drill-screen"]') as HTMLElement | null)?.dataset
          .index ?? '-1',
      ) === want,
    before + 1,
  );
  await expect(page.locator(drillScreen)).toHaveAttribute('data-phase', 'answer');
}

async function readTallies(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>('[data-testid="drill-tally"]')].map((el) => [
        el.dataset.kind ?? '',
        `${el.dataset.correct ?? '?'}/${el.dataset.attempted ?? '?'}`,
      ]),
    ),
  );
}

/**
 * Resize the real BrowserWindow, then pin the render viewport to the same numbers — the technique
 * layout.spec.ts and charts.spec.ts document, and for the reason they document: a tiling window
 * manager on the host retiles the window moments after it is shown, which makes setSize() cosmetic.
 *
 * MEASURE BEFORE SCREENSHOTTING, NEVER AFTER: page.screenshot() clears
 * Emulation.setDeviceMetricsOverride and the viewport snaps back to the host WM's size, so any
 * geometry read after a shot() describes a window nobody configured.
 */
async function useViewport(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await app.evaluate(
    async ({ BrowserWindow }, size: { width: number; height: number }) => {
      BrowserWindow.getAllWindows()[0].setSize(size.width, size.height);
    },
    { width, height },
  );

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await page.waitForFunction(
    (want: { width: number; height: number }) =>
      window.innerWidth === want.width && window.innerHeight === want.height,
    { width, height },
  );
  await settleDrill(page);
}

/** Two identical consecutive frames is the real signal that a resize has finished relayouting. */
async function settleDrill(page: Page): Promise<void> {
  const settled = await page.evaluate(async () => {
    const nextFrame = (): Promise<void> =>
      new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    const read = (): string => {
      const r = document.querySelector('[data-testid="drill-work"]')?.getBoundingClientRect();
      return r === undefined ? 'absent' : `${r.width}x${r.height}@${r.top}`;
    };

    let previous = read();
    for (let i = 0; i < 180; i++) {
      await nextFrame();
      const current = read();
      if (current === previous && current !== 'absent') return true;
      previous = current;
    }
    return false;
  });
  expect(settled, 'the drill work panel never stopped changing size').toBe(true);
}

async function withDrill(
  body: (ctx: { app: ElectronApplication; page: Page }) => Promise<void>,
): Promise<void> {
  const { app, page, close } = await launchApp({ seed: 42 });
  try {
    await openDrill(page);
    await body({ app, page });
  } finally {
    await close().catch(() => {});
  }
}

test.describe('the Drill tab: the arithmetic trainer', () => {
  test('1. the tab renders the drill, not the placeholder', async () => {
    await withDrill(async ({ page }) => {
      await expect(page.locator(drillScreen)).toBeVisible();
      // The placeholder used this same testid, so its wording is what tells them apart.
      await expect(page.locator(drillScreen)).not.toContainText('Not built yet');

      await expect(page.locator(drillScreen)).toHaveAttribute('data-kind', 'pot-odds');
      await expect(page.locator(drillScreen)).toHaveAttribute('data-seed', FIRST_SEED);
      await expect(page.locator(drillScreen)).toHaveAttribute('data-phase', 'answer');
      await expect(page.locator(prompt)).toHaveText(
        '4.5 bb into 4.5 bb. What equity do you need to call?',
      );

      // G5: no answer anywhere in the DOM before a commit — not hidden, absent.
      await expect(page.locator(method)).toHaveCount(0);
      await expect(page.locator(right)).toHaveCount(0);
    });
  });

  test('2. a correct answer is accepted, and the method is shown anyway', async () => {
    await withDrill(async ({ page }) => {
      await answerWithEnter(page, '33.33');

      await expect(page.locator(drillScreen)).toHaveAttribute('data-verdict', 'right');
      await expect(page.locator(verdict)).toHaveAttribute('data-verdict', 'right');
      await expect(page.locator(verdictLine)).toHaveText('Inside the band.');

      // Both numbers, both times: the comparison is the teaching, not the verdict.
      await expect(page.locator(yours)).toHaveText('33.33%');
      await expect(page.locator(right)).toHaveText('33.33%');

      // G3: silence is not praise. Nothing congratulates the learner.
      const body = (await page.locator(drillScreen).textContent()) ?? '';
      expect(body.toLowerCase()).not.toContain('correct!');
      expect(body.toLowerCase()).not.toContain('well done');

      // The worked method appears on a right answer too — that is the point of it.
      await expect(page.locator(method)).toHaveCount(1);
      await expect(page.locator(step)).toHaveCount(5);

      const tallies = await readTallies(page);
      expect(tallies['pot-odds']).toBe('1/1');
      await expect(page.locator(tallyTotal)).toHaveAttribute('data-correct', '1');
      await expect(page.locator(tallyTotal)).toHaveAttribute('data-attempted', '1');
    });
  });

  /**
   * THE TOLERANCE IS CORE'S, NOT THIS SCREEN'S. An exact answer passing proves nothing about which
   * band is in force — a screen that invented a band ten times tighter would still accept 33.33.
   * So the edges are what is pinned: core's PROBABILITY_TOLERANCE is 0.02, so 31.4 points (1.93
   * under) must be accepted and 31.2 (2.13 under) must not. Both are wrong by any reasonable
   * intuition and right or wrong only by core's number, which is the point.
   */
  test('2b. the accepted band is exactly core\'s tolerance, at both edges', async () => {
    await withDrill(async ({ page }) => {
      await answerWithEnter(page, '31.4');
      await expect(
        page.locator(drillScreen),
        '1.93 points under must be inside core\'s 2-point band',
      ).toHaveAttribute('data-verdict', 'right');
      await advanceWithEnter(page);

      // Index 1 (seed 102, answer 28.26%): 2.13 points under is outside the band.
      await expect(page.locator(drillScreen)).toHaveAttribute('data-seed', '102');
      await answerWithEnter(page, '26.13');
      await expect(
        page.locator(drillScreen),
        '2.13 points under must be outside core\'s 2-point band',
      ).toHaveAttribute('data-verdict', 'wrong');

      // And the band is quoted from the problem, so a tighter invented one would show up here too.
      await expect(page.locator(gapLine)).toContainText('within 2 points');
    });
  });

  /** SPR carries a different tolerance — core's sprTolerance, not the probability one. */
  test('2c. SPR is graded on core\'s sprTolerance, which is not the probability band', async () => {
    await withDrill(async ({ page }) => {
      await selectKind(page, 'spr');
      // seed 101: answer 6.926, sprTolerance = max(0.25, 5% of 6.926) = 0.346.
      await expect(page.locator(gapLine)).toHaveCount(0);
      await answerWithEnter(page, '6.6');
      await expect(
        page.locator(drillScreen),
        '0.33 under must be inside core\'s 0.35 SPR band',
      ).toHaveAttribute('data-verdict', 'right');
      // The quoted band is core's, computed for this answer — not a constant typed into the screen.
      await expect(page.locator(gapLine)).toContainText('within 0.35');

      await advanceWithEnter(page);
      // seed 102: answer 2.761, sprTolerance = max(0.25, 0.138) = 0.25.
      await answerWithEnter(page, '3.1');
      await expect(
        page.locator(drillScreen),
        '0.34 under must be OUTSIDE the 0.25 band this smaller answer gets',
      ).toHaveAttribute('data-verdict', 'wrong');
      await expect(page.locator(gapLine)).toContainText('within 0.25');
    });
  });

  /**
   * DISPLAY ROUNDING MAY NOT CONTRADICT THE VERDICT. Both the miss and the band are printed to two
   * decimals, so a miss just outside the band rounds onto it: 31.33 against 33.33% is 2.0033 points
   * out, which core grades wrong, and the panel used to read "Outside the band. You were 2 points
   * under. Anything within 2 points counts." — a self-contradicting sentence a learner can only read
   * as a bug. The SPR path has the same tie from the other side, because the band itself rounds UP
   * (0.3463 printed as 0.35) so a 0.3509 miss prints as 0.35 too.
   *
   * The verdict is core's and is not what is asserted here; what is asserted is that the sentence
   * beside it never claims a miss that the quoted band would have allowed.
   */
  test('2d. a miss that rounds onto the band is not described as inside it', async () => {
    await withDrill(async ({ page }) => {
      // 2.0033 points under: core says wrong, and two-decimal rounding says "2 points".
      await answerWithEnter(page, '31.33');
      await expect(page.locator(drillScreen)).toHaveAttribute('data-verdict', 'wrong');
      await expect(page.locator(verdictLine)).toHaveText('Outside the band.');
      await expect(
        page.locator(gapLine),
        'the gap sentence must not claim a miss the quoted band allows',
      ).toHaveText('You were more than 2 points under. Anything within 2 points counts.');

      // The band is still core's, and an unambiguous miss still gets its exact size.
      await advanceWithEnter(page);
      await answerWithEnter(page, '20');
      await expect(page.locator(gapLine)).toContainText('You were 8.26 points under');
      await expect(page.locator(gapLine)).toContainText('within 2 points');
    });
  });

  /** The same rounding tie on SPR, where the band itself is what rounds up. */
  test('2e. an SPR miss that rounds onto its rounded-up band is not described as inside it', async () => {
    await withDrill(async ({ page }) => {
      await selectKind(page, 'spr');
      // seed 101: answer 6.9259, sprTolerance 0.34630 printed as "0.35". 6.575 is 0.3509 under.
      await answerWithEnter(page, '6.575');
      await expect(page.locator(drillScreen)).toHaveAttribute('data-verdict', 'wrong');
      await expect(page.locator(gapLine)).toHaveText(
        'You were more than 0.35 under. Anything within 0.35 counts.',
      );

      // An SPR miss with no rounding tie still reports its exact size, in SPR units.
      await advanceWithEnter(page);
      await answerWithEnter(page, '1');
      await expect(page.locator(gapLine)).toContainText('You were 1.76 under');
    });
  });

  test('3. a wrong answer teaches: the worked method, the right answer, and the learner\'s own', async () => {
    await withDrill(async ({ page }) => {
      await answerWithEnter(page, '20');

      await expect(page.locator(drillScreen)).toHaveAttribute('data-verdict', 'wrong');
      await expect(page.locator(verdictLine)).toHaveText('Outside the band.');

      // Never a bare "wrong": their number, the right one, and the size of the miss.
      await expect(page.locator(yours)).toHaveText('20%');
      await expect(page.locator(right)).toHaveText('33.33%');
      await expect(page.locator(gapLine)).toContainText('13.33 points under');
      // The band quoted is core's PROBABILITY_TOLERANCE, in the unit the learner typed.
      await expect(page.locator(gapLine)).toContainText('within 2 points');

      /**
       * The steps are the arithmetic, laid out. Each of these substrings is a number core produced
       * (potOdds(4.5, 4.5, 98)), so an off-by-one in the pot convention — the failure mode
       * core/arithmetic.ts's header warns about — shows up right here.
       */
      const steps = await page.locator(step).allTextContents();
      expect(steps).toHaveLength(5);
      expect(steps[1]).toContain('4.5 + 4.5 + 4.5 = 13.5 bb');
      expect(steps[2]).toContain('4.5 / 13.5');
      expect(steps[3]).toContain('33.33%');
      // naturalFrequency(1/3) is 1 time in 3 — the frequency form is a first-class part of core.
      expect(steps[4]).toContain('about 1 time in 3');

      const tallies = await readTallies(page);
      expect(tallies['pot-odds']).toBe('0/1');
    });
  });

  test('4. Enter commits, Enter again advances — and the method leaves the DOM with it', async () => {
    await withDrill(async ({ page }) => {
      await expect(page.locator(drillScreen)).toHaveAttribute('data-index', '0');
      await answerWithEnter(page, '33.33');
      await expect(page.locator(method)).toHaveCount(1);

      await advanceWithEnter(page);

      await expect(page.locator(drillScreen)).toHaveAttribute('data-index', '1');
      await expect(page.locator(drillScreen)).toHaveAttribute('data-seed', '102');
      await expect(page.locator(drillScreen)).toHaveAttribute('data-verdict', '');
      // A new problem, and no answer visible for it.
      await expect(page.locator(method)).toHaveCount(0);
      await expect(page.locator(right)).toHaveCount(0);
      await expect(page.locator(prompt)).toHaveText(
        '13 bb into 20 bb. What equity do you need to call?',
      );

      // The box is focused without a click: keyboard-first means typing the next answer straight on.
      const focused = await page.evaluate(
        () =>
          (document.activeElement as HTMLElement | null)?.dataset.testid ?? 'none',
      );
      expect(focused).toBe('drill-answer');

      // Two commits in a row through the keyboard only.
      await answerWithEnter(page, '28');
      await expect(page.locator(drillScreen)).toHaveAttribute('data-verdict', 'right');
      await expect(page.locator(drillScreen)).toHaveAttribute('data-commits', '2');
    });
  });

  test('5. Enter on a graded problem never re-commits or double-counts', async () => {
    await withDrill(async ({ page }) => {
      await answerWithEnter(page, '33.33');
      await expect(page.locator(drillScreen)).toHaveAttribute('data-commits', '1');

      await advanceWithEnter(page);
      // One commit, one advance: the tally may not have moved twice on a single answer.
      await expect(page.locator(drillScreen)).toHaveAttribute('data-commits', '1');
      const tallies = await readTallies(page);
      expect(tallies['pot-odds']).toBe('1/1');
    });
  });

  test('6. every DrillKind is selectable, renders, and names itself', async () => {
    await withDrill(async ({ page }) => {
      await expect(page.locator(kindBtn)).toHaveCount(KINDS.length);

      const labels: Record<string, string> = {
        'pot-odds': 'Pot odds',
        alpha: 'Alpha',
        mdf: 'MDF',
        spr: 'SPR',
      };

      for (const kind of KINDS) {
        await selectKind(page, kind);

        // The current kind is stated in words, not only marked on a button.
        await expect(page.locator(currentKind)).toHaveText(labels[kind]);
        await expect(page.locator(currentKind)).toHaveAttribute('data-kind', kind);
        await expect(
          page.locator(`${kindBtn}[data-kind="${kind}"]`),
        ).toHaveAttribute('data-active', 'true');

        // Exactly one button is active at a time.
        const active = await page
          .locator(`${kindBtn}[data-active="true"]`)
          .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.kind ?? ''));
        expect(active).toEqual([kind]);

        // The question renders, and it is answerable.
        const text = (await page.locator(prompt).textContent()) ?? '';
        expect(text.length, `${kind}: empty prompt`).toBeGreaterThan(10);
        await expect(page.locator(answerBox)).toBeVisible();
        // SPR is a ratio, the other three are shares: the unit beside the box has to say which.
        await expect(page.locator(unit)).toHaveText(kind === 'spr' ? ': 1' : '%');
      }
    });
  });

  test('7. each kind grades against core and shows its own method', async () => {
    await withDrill(async ({ page }) => {
      // Answers computed from core by hand at seed 101 (pot 4.5, bet 4.5, stack 98).
      const expected = [
        { kind: 'alpha', typed: '50', shown: '50%', mentions: '4.5 / 9 = 50%' },
        { kind: 'mdf', typed: '50', shown: '50%', mentions: '1 - 50% = 50%' },
        { kind: 'spr', typed: '6.93', shown: '6.93', mentions: '93.5 / 13.5 = 6.93' },
      ] as const;

      for (const { kind, typed, shown, mentions } of expected) {
        await selectKind(page, kind);
        await answerWithEnter(page, typed);

        await expect(page.locator(drillScreen), `${kind} should grade correct`).toHaveAttribute(
          'data-verdict',
          'right',
        );
        await expect(page.locator(right)).toHaveText(shown);
        await expect(page.locator(yours)).toHaveText(shown);
        await expect(page.locator(step)).toHaveCount(5);
        await expect(page.locator(method), `${kind}: method must show the division`).toContainText(
          mentions,
        );

        const tallies = await readTallies(page);
        expect(tallies[kind], `${kind} tally`).toBe('1/1');
      }

      // Per-kind, not one lump: three kinds tried once each, pot-odds still untouched.
      const tallies = await readTallies(page);
      expect(tallies['pot-odds']).toBe('0/0');
      await expect(page.locator(tally).filter({ hasText: 'not tried' })).toHaveCount(1);
      await expect(page.locator(tallyTotal)).toHaveAttribute('data-attempted', '3');
      await expect(page.locator(tallyTotal)).toHaveAttribute('data-correct', '3');
    });
  });

  test('8. the same seed replays the same problem', async () => {
    await withDrill(async ({ page }) => {
      await advanceWithEnterAfterAnswer(page, '33.33');
      await advanceWithEnterAfterAnswer(page, '28');
      await expect(page.locator(drillScreen)).toHaveAttribute('data-seed', '103');
      const at103 = await page.locator(prompt).textContent();

      // Leaving the tab and coming back rebuilds from BASE_SEED: seed 101 is seed 101 forever.
      await page.click('[data-testid="tab-charts"]');
      await page.waitForSelector('[data-testid="charts-screen"]');
      await openDrill(page);
      await expect(page.locator(drillScreen)).toHaveAttribute('data-seed', FIRST_SEED);
      await expect(page.locator(prompt)).toHaveText(
        '4.5 bb into 4.5 bb. What equity do you need to call?',
      );

      // And walking forward again reproduces the identical third problem, character for character.
      await advanceWithEnterAfterAnswer(page, '33.33');
      await advanceWithEnterAfterAnswer(page, '28');
      await expect(page.locator(drillScreen)).toHaveAttribute('data-seed', '103');
      expect(await page.locator(prompt).textContent()).toBe(at103);
    });
  });

  test('9. switching kind keeps the seed, so the same spot is asked a different question', async () => {
    await withDrill(async ({ page }) => {
      await expect(page.locator(drillScreen)).toHaveAttribute('data-seed', FIRST_SEED);

      // Seed 101 is pot 4.5 / bet 4.5 whichever kind is asked: one spot, four questions.
      await selectKind(page, 'alpha');
      await expect(page.locator(drillScreen)).toHaveAttribute('data-seed', FIRST_SEED);
      await expect(page.locator(prompt)).toHaveText(
        'You bet 4.5 bb into 4.5 bb. How often do you need a fold?',
      );

      await selectKind(page, 'mdf');
      await expect(page.locator(prompt)).toHaveText(
        'You face 4.5 bb into 4.5 bb. What share must you defend?',
      );

      await selectKind(page, 'pot-odds');
      await expect(page.locator(prompt)).toHaveText(
        '4.5 bb into 4.5 bb. What equity do you need to call?',
      );
    });
  });

  test('10. a graded problem is dropped when the kind changes, not carried across', async () => {
    await withDrill(async ({ page }) => {
      await answerWithEnter(page, '33.33');
      await expect(page.locator(right)).toHaveText('33.33%');

      await selectKind(page, 'mdf');
      // Grading a learner against a question they were not looking at is the bug this prevents.
      await expect(page.locator(drillScreen)).toHaveAttribute('data-phase', 'answer');
      await expect(page.locator(method)).toHaveCount(0);
      await expect(page.locator(right)).toHaveCount(0);
      await expect(page.locator(answerBox)).toHaveValue('');

      // The tally is history and stays: it records the attempt that did happen.
      const tallies = await readTallies(page);
      expect(tallies['pot-odds']).toBe('1/1');
    });
  });

  test('11. an unreadable entry commits nothing and says so, without locking anything', async () => {
    await withDrill(async ({ page }) => {
      await page.fill(answerBox, 'about a third');
      await page.click(commitBtn);
      await expect(page.locator(hint)).toHaveAttribute('data-unreadable', 'true');

      await expect(page.locator(drillScreen)).toHaveAttribute('data-phase', 'answer');
      await expect(page.locator(drillScreen)).toHaveAttribute('data-commits', '0');
      await expect(page.locator(method)).toHaveCount(0);
      const tallies = await readTallies(page);
      expect(tallies['pot-odds']).toBe('0/0');

      // N1: nothing is locked. The same box still takes an answer immediately after.
      await expect(page.locator(answerBox)).toBeEnabled();
      await expect(page.locator(commitBtn)).toBeEnabled();
      await answerWithEnter(page, '33.33');
      await expect(page.locator(drillScreen)).toHaveAttribute('data-verdict', 'right');
    });
  });

  test('12. the buttons do everything the keyboard does', async () => {
    await withDrill(async ({ page }) => {
      await page.fill(answerBox, '20');
      await page.click(commitBtn);
      await expect(page.locator(drillScreen)).toHaveAttribute('data-phase', 'graded');
      await expect(page.locator(drillScreen)).toHaveAttribute('data-verdict', 'wrong');

      await page.click(nextBtn);
      await expect(page.locator(drillScreen)).toHaveAttribute('data-index', '1');
      await expect(page.locator(drillScreen)).toHaveAttribute('data-phase', 'answer');
    });
  });

  /**
   * The unmount contract. The drill binds Enter on the window, and the table screen uses Enter-free
   * keys but shares the window — a listener that outlives this screen is a key thief. Pressing
   * Enter elsewhere and seeing nothing proves nothing, so the detached root is inspected directly:
   * with an answer already sitting in its box, a live listener WOULD commit it.
   */
  test('13. the key handler stops acting and unbinds once the screen unmounts', async () => {
    await withDrill(async ({ page }) => {
      // An answer is in the box but uncommitted, so a surviving listener has something to do.
      await page.fill(answerBox, '33.33');
      await expect(page.locator(drillScreen)).toHaveAttribute('data-commits', '0');

      await page.evaluate(() => {
        const root = document.querySelector('[data-testid="drill-screen"]');
        (window as unknown as { __drillRoot?: Element | null }).__drillRoot = root;
      });

      await page.click('[data-testid="tab-charts"]');
      await page.waitForSelector('[data-testid="charts-screen"]');

      const detached = await page.evaluate(() => {
        const root = (window as unknown as { __drillRoot?: Element | null }).__drillRoot;
        return root instanceof HTMLElement ? { connected: root.isConnected } : null;
      });
      expect(detached).not.toBeNull();
      expect(detached?.connected, 'the drill root should be off the document').toBe(false);

      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');

      const after = await page.evaluate(() => {
        const root = (window as unknown as { __drillRoot?: Element | null }).__drillRoot;
        if (!(root instanceof HTMLElement)) return null;
        return {
          commits: root.dataset.commits ?? '?',
          index: root.dataset.index ?? '?',
          phase: root.dataset.phase ?? '?',
        };
      });
      expect(
        after,
        'the unmounted drill screen reacted to Enter — its window listener is still bound',
      ).toEqual({ commits: '0', index: '0', phase: 'answer' });

      // And the charts screen still owns its own keys: Enter did not disturb it either.
      await expect(page.locator('[data-testid="charts-screen"]')).toHaveAttribute(
        'data-answered',
        '0',
      );
    });
  });

  test('14. the screen fits both documented sizes without clipping', async () => {
    await withDrill(async ({ app, page }) => {
      for (const graded of [false, true]) {
        if (graded) {
          await answerWithEnter(page, '20');
          await expect(page.locator(method)).toHaveCount(1);
        }

        for (const [width, height] of [
          [DEFAULT_WIDTH, DEFAULT_HEIGHT],
          [MIN_WIDTH, MIN_HEIGHT],
        ] as const) {
          await useViewport(app, page, width, height);

          // MEASURE BEFORE ANY SCREENSHOT: page.screenshot() clears the metrics override.
          const geo = await page.evaluate(() => {
            const box = (selector: string) => {
              const el = document.querySelector(selector);
              if (el === null) return null;
              const r = el.getBoundingClientRect();
              return { top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width };
            };
            const clipped = (selector: string) => {
              const el = document.querySelector(selector);
              if (!(el instanceof HTMLElement)) return null;
              // A text node wider or taller than its own box is text nobody can read.
              return {
                overflowX: el.scrollWidth - el.clientWidth,
                overflowY: el.scrollHeight - el.clientHeight,
              };
            };
            return {
              innerWidth: window.innerWidth,
              innerHeight: window.innerHeight,
              scrollWidth: document.documentElement.scrollWidth,
              scrollHeight: document.documentElement.scrollHeight,
              side: box('[data-testid="drill-side"]'),
              work: box('[data-testid="drill-work"]'),
              prompt: box('[data-testid="drill-prompt"]'),
              kinds: box('[data-testid="drill-kinds"]'),
              promptClip: clipped('[data-testid="drill-prompt"]'),
              sideClip: clipped('[data-testid="drill-side"]'),
              workClip: clipped('[data-testid="drill-work"]'),
              stepClips: [...document.querySelectorAll<HTMLElement>('[data-testid="drill-step"]')]
                .map((el) => el.scrollWidth - el.clientWidth),
              panelsOverlap: (() => {
                const a = document.querySelector('[data-testid="drill-side"]');
                const b = document.querySelector('[data-testid="drill-work"]');
                if (a === null || b === null) return true;
                const p = a.getBoundingClientRect();
                const q = b.getBoundingClientRect();
                return (
                  p.right > q.left + 1 &&
                  q.right > p.left + 1 &&
                  p.bottom > q.top + 1 &&
                  q.bottom > p.top + 1
                );
              })(),
            };
          });

          const at = `${width}x${height}${graded ? ' graded' : ''}`;
          expect(geo.innerWidth, `${at}: viewport width`).toBe(width);
          expect(geo.innerHeight, `${at}: viewport height`).toBe(height);

          expect(
            geo.scrollWidth,
            `${at}: content is ${geo.scrollWidth}px wide in a ${width}px viewport`,
          ).toBeLessThanOrEqual(width + 1);
          expect(
            geo.scrollHeight,
            `${at}: content is ${geo.scrollHeight}px tall in a ${height}px viewport`,
          ).toBeLessThanOrEqual(height + 1);

          expect(geo.panelsOverlap, `${at}: the sidebar and the work panel overlap`).toBe(false);

          // The question must never be the thing that gets cut: it is what is being answered.
          expect(geo.promptClip, `${at}: prompt missing`).not.toBeNull();
          expect(
            geo.promptClip?.overflowX ?? 1,
            `${at}: the prompt text is cut off horizontally`,
          ).toBeLessThanOrEqual(1);
          expect(
            geo.promptClip?.overflowY ?? 1,
            `${at}: the prompt text is cut off vertically`,
          ).toBeLessThanOrEqual(1);

          for (const overflow of geo.stepClips) {
            expect(overflow, `${at}: a method step is cut off horizontally`).toBeLessThanOrEqual(1);
          }

          /**
           * Both panels carry a max-height valve, so a page that does not scroll is NOT on its own
           * evidence that everything fits — a panel could be swallowing the overflow into its own
           * scrollbar, which is content the learner has to hunt for. Measured, both panels fit
           * inside the budget at both sizes with zero overflow, so that is what is asserted: the day
           * the content outgrows the window this fails rather than quietly starting to scroll.
           */
          for (const [name, clip] of Object.entries({ side: geo.sideClip, work: geo.workClip })) {
            expect(clip, `${at}: "${name}" missing`).not.toBeNull();
            expect(
              clip?.overflowY ?? 1,
              `${at}: "${name}" is scrolling internally (${clip?.overflowY ?? '?'}px hidden) — content no longer fits`,
            ).toBeLessThanOrEqual(1);
            expect(
              clip?.overflowX ?? 1,
              `${at}: "${name}" overflows horizontally`,
            ).toBeLessThanOrEqual(1);
          }

          for (const [name, box] of Object.entries({
            side: geo.side,
            work: geo.work,
            prompt: geo.prompt,
            kinds: geo.kinds,
          })) {
            expect(box, `${at}: "${name}" missing`).not.toBeNull();
            if (box === null) continue;
            expect(box.left, `${at}: "${name}" cut off on the left`).toBeGreaterThanOrEqual(0);
            expect(
              box.right,
              `${at}: "${name}" hangs past the right edge (${box.right} > ${width})`,
            ).toBeLessThanOrEqual(width + 1);
            expect(box.top, `${at}: "${name}" cut off above`).toBeGreaterThanOrEqual(0);
            expect(
              box.bottom,
              `${at}: "${name}" hangs below the fold (${box.bottom} > ${height})`,
            ).toBeLessThanOrEqual(height + 1);
          }
        }
      }
    });
  });

  test('15. screenshots at both documented sizes, answering and graded', async () => {
    await withDrill(async ({ app, page }) => {
      await useViewport(app, page, DEFAULT_WIDTH, DEFAULT_HEIGHT);
      await shot(page, 'drill-1100x760');

      // Re-apply the override after the shot: screenshotting clears it.
      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT);
      await shot(page, 'drill-900x640');

      await useViewport(app, page, DEFAULT_WIDTH, DEFAULT_HEIGHT);
      await answerWithEnter(page, '20');
      await shot(page, 'drill-1100x760-graded');

      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT);
      await shot(page, 'drill-900x640-graded');

      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT);
      await selectKind(page, 'spr');
      await answerWithEnter(page, '1');
      await shot(page, 'drill-900x640-spr-wrong');
    });
  });
});

/** Answer, then advance. Used where the point is the sequence, not the grading. */
async function advanceWithEnterAfterAnswer(page: Page, typed: string): Promise<void> {
  await answerWithEnter(page, typed);
  await advanceWithEnter(page);
}

/*
 * SCAFFOLDING FADES PER KIND (T6/T7, core/fading.ts wired through drill.ts). A learner who keeps
 * getting a kind right stops seeing the full worked method: the panel contracts a rung at a time, and
 * the fade persists across launches. The root publishes data-rung / data-support for the current kind
 * so these assertions never sleep. pot-odds is DRILL_KINDS[0], so it is what a fresh screen opens on.
 */

/** Correct pot-odds answers at seeds 101,102,103 — computed from core, the same way test 7 does. */
const POT_ODDS_CORRECT = ['33.33', '28.26', '35.71'] as const;

const rungOf = (page: Page): Promise<string | null> =>
  page.getAttribute(drillScreen, 'data-rung');

test.describe('the Drill tab: per-concept scaffolding fades (T6/T7)', () => {
  test('F1. a fresh screen opens at rung 0 with the full method', async () => {
    await withDrill(async ({ page }) => {
      await expect(page.locator(drillScreen)).toHaveAttribute('data-rung', '0');
      await expect(page.locator(drillScreen)).toHaveAttribute('data-support', 'worked-examples');
      // The full method is still there before any fade — the pre-fading behaviour, unchanged.
      await answerWithEnter(page, POT_ODDS_CORRECT[0]);
      await expect(page.locator(method)).toHaveCount(1);
      await expect(page.locator(step)).toHaveCount(5);
    });
  });

  test('F2. three correct in a row fades one rung, and the worked method withdraws', async () => {
    await withDrill(async ({ page }) => {
      // Two correct: still rung 0 (the promotion needs three). The method is still shown.
      await advanceWithEnterAfterAnswer(page, POT_ODDS_CORRECT[0]);
      await advanceWithEnterAfterAnswer(page, POT_ODDS_CORRECT[1]);
      await expect(page.locator(drillScreen)).toHaveAttribute('data-rung', '0');

      // The THIRD consecutive correct earns the fade: rung 0 → 1, method gone, verdict still there.
      await answerWithEnter(page, POT_ODDS_CORRECT[2]);
      await expect(page.locator(drillScreen)).toHaveAttribute('data-rung', '1');
      await expect(page.locator(verdictLine)).toHaveText('Inside the band.');
      await expect(page.locator(method)).toHaveCount(0);
      await expect(page.locator(step)).toHaveCount(0);
      // Rung 1 keeps the figures (the correction), just not the step-by-step.
      await expect(page.locator(right)).toHaveText('35.71%');
    });
  });

  test('F3. a wrong answer resets the streak, so support is not faded by a lucky pair', async () => {
    await withDrill(async ({ page }) => {
      await advanceWithEnterAfterAnswer(page, POT_ODDS_CORRECT[0]); // index 0 → 1
      await advanceWithEnterAfterAnswer(page, POT_ODDS_CORRECT[1]); // index 1 → 2
      // Miss the third (seed 103): the consecutive-correct count returns to zero.
      await advanceWithEnterAfterAnswer(page, '0'); // index 2 → 3
      // A single correct after the miss (seed 104 answers 35.71) is streak 1, not 3 — no fade.
      await answerWithEnter(page, '35.71');
      await expect(page.locator(drillScreen)).toHaveAttribute('data-verdict', 'right');
      await expect(page.locator(drillScreen)).toHaveAttribute('data-rung', '0');
      await expect(page.locator(method)).toHaveCount(1);
    });
  });

  test('F4. the fade is per KIND — mastering pot-odds does not fade SPR', async () => {
    await withDrill(async ({ page }) => {
      await advanceWithEnterAfterAnswer(page, POT_ODDS_CORRECT[0]);
      await advanceWithEnterAfterAnswer(page, POT_ODDS_CORRECT[1]);
      await answerWithEnter(page, POT_ODDS_CORRECT[2]);
      await expect(page.locator(drillScreen)).toHaveAttribute('data-rung', '1'); // pot-odds faded

      await advanceWithEnter(page);
      await selectKind(page, 'spr');
      // SPR was never drilled, so it is still at full support.
      await expect(page.locator(drillScreen)).toHaveAttribute('data-rung', '0');
      await expect(page.locator(drillScreen)).toHaveAttribute('data-support', 'worked-examples');
    });
  });

  test('F5. a faded rung survives closing and reopening the app', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-fading-persist-'));

    const first = await launchApp({ seed: 42, userDataDir: dir });
    try {
      await openDrill(first.page);
      await advanceWithEnterAfterAnswer(first.page, POT_ODDS_CORRECT[0]);
      await advanceWithEnterAfterAnswer(first.page, POT_ODDS_CORRECT[1]);
      await answerWithEnter(first.page, POT_ODDS_CORRECT[2]);
      await expect(first.page.locator(drillScreen)).toHaveAttribute('data-rung', '1');
      // Let the async saveState flush before the window closes.
      await first.page.waitForTimeout(200);
    } finally {
      await first.close().catch(() => {});
    }

    // Second sitting, SAME dir: pot-odds must open already faded, before answering anything.
    const second = await launchApp({ seed: 42, userDataDir: dir });
    try {
      await openDrill(second.page);
      expect(await rungOf(second.page), 'the faded rung did not survive the restart').toBe('1');
    } finally {
      await second.close().catch(() => {});
    }
  });
});

/*
 * VERDICT SETTLE-IN (V2 motion). The graded verdict fades in via the shared opacity-only keyframe, and
 * it must be silenced for a learner who has asked for reduced motion. The oracle is computed style —
 * the suite has no screenshot diffing — matching charts.spec's getComputedStyle idiom.
 */
test.describe('the Drill tab: the verdict settles in, and respects reduced motion', () => {
  test('M1. a graded verdict carries the opacity settle-in animation', async () => {
    await withDrill(async ({ page }) => {
      await answerWithEnter(page, '33.33');
      const name = await page
        .locator(verdict)
        .evaluate((el) => getComputedStyle(el).animationName);
      expect(name).toBe('offsuit-surface-in');
    });
  });

  test('M2. reduced-motion turns the settle-in off', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openDrill(page);
      await answerWithEnter(page, '33.33');
      const name = await page
        .locator(verdict)
        .evaluate((el) => getComputedStyle(el).animationName);
      expect(name, 'reduced-motion must disable the verdict animation').toBe('none');
    } finally {
      await close().catch(() => {});
    }
  });
});

/*
 * ACCESSIBILITY — the graded verdict reaches screen readers. The verdict updates in place on commit,
 * so without a live region an SR learner gets no feedback. An always-present visually-hidden
 * role=status region mirrors the verdict wording at the shown rung. It survives paint()'s
 * replaceChildren, is empty while answering, and clears on the next problem.
 */
test.describe('the Drill tab: the verdict reaches screen readers', () => {
  test('A1. the announcer is a polite live region, empty until a verdict lands', async () => {
    await withDrill(async ({ page }) => {
      const region = page.locator(announcer);
      await expect(region).toHaveAttribute('role', 'status');
      await expect(region).toHaveAttribute('aria-live', 'polite');
      // Answering, nothing graded yet.
      await expect(region).toHaveText('');
    });
  });

  test('A2. a graded verdict is announced, opening with the same verdict line the panel shows', async () => {
    await withDrill(async ({ page }) => {
      await answerWithEnter(page, '33.33');
      await expect(page.locator(drillScreen)).toHaveAttribute('data-verdict', 'right');
      const spoken = (await page.locator(announcer).textContent()) ?? '';
      // Same wording as the visible verdict line, plus the correction the panel shows at rung 0.
      const line = (await page.locator(verdictLine).textContent()) ?? '';
      expect(spoken.startsWith(line)).toBe(true);
      expect(spoken).toContain('You said 33.33%');
      expect(spoken).toContain('The answer 33.33%');
    });
  });

  test('A3. the announcement clears on the next problem, leaving no stale verdict', async () => {
    await withDrill(async ({ page }) => {
      await answerWithEnter(page, '33.33');
      await expect(page.locator(announcer)).not.toHaveText('');
      await advanceWithEnter(page);
      await expect(page.locator(announcer)).toHaveText('');
    });
  });
});
