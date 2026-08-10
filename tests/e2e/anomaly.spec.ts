import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, shot } from './helpers.js';

/**
 * THE ANOMALY TRIGGER DRILL — PRODUCT-SPEC O8, and gate A of P5.
 *
 * Three things in here are load-bearing and easy to get wrong.
 *
 * SYNC ORACLE, NEVER A SLEEP. The anomaly root republishes data-index, data-seed, data-category,
 * data-phase (answer|graded), data-answered, data-anomalies, data-verdict, data-last-tag,
 * data-last-rt and data-gate on every paint, exactly as the table root publishes data-awaiting.
 * Every wait below keys off one of those.
 *
 * RESPONSE TIME IS MEASURED WITH A CONTROLLED CLOCK, NOT A SLEEP. page.clock.install() +
 * pauseAt() freezes performance.now() in the renderer, so fastForward(2100) makes the screen record
 * exactly 2100 ms — probed, not assumed. That is what makes the P5-gate-A assertions (correct AND
 * fast, with slow-and-correct a fail) deterministic rather than timing-dependent. Under a paused
 * clock the screen must still be driven at least one trial forward after install, because the
 * install resets performance.now()'s origin and the live prompt's start time predates it.
 *
 * THE SEQUENCE IS PINNED, and pinned to core rather than to the screen. BASE_SEED in
 * screens/anomaly.ts is 811 and the category is round-robin over TRIGGER_CATEGORIES, so trial i is
 * drawStimulus(811 + i, TRIGGER_CATEGORIES[i % 4], seenInThatCategory). The prompts and the
 * anomalous positions below were read out of src/core/anomaly.ts at those seeds, so a change to
 * either the screen's seed derivation or core's pool shows up here as a failure rather than as a
 * quietly different drill.
 */

const root = '[data-testid="anomaly-screen"]';
const work = '[data-testid="anomaly-work"]';
const side = '[data-testid="anomaly-side"]';
const prompt = '[data-testid="anomaly-prompt"]';
const yesKey = '[data-testid="anomaly-yes"]';
const noKey = '[data-testid="anomaly-no"]';
const nextBtn = '[data-testid="anomaly-next"]';
const verdict = '[data-testid="anomaly-verdict"]';
const truth = '[data-testid="anomaly-truth"]';
const triggerLine = '[data-testid="anomaly-trigger"]';
const rtLine = '[data-testid="anomaly-rt"]';
const comment = '[data-testid="anomaly-comment"]';
const verdictTag = '[data-testid="anomaly-verdict-tag"]';
const triggerList = '[data-testid="trigger-list"]';
const triggerRow = '[data-testid="trigger-row"]';
const gate = '[data-testid="anomaly-gate"]';
const gateHeadline = '[data-testid="anomaly-gate-headline"]';
const gateReason = '[data-testid="anomaly-gate-reason"]';
const medianRt = '[data-testid="anomaly-median-rt"]';
const rateLine = '[data-testid="anomaly-rate"]';
const tagRow = '[data-testid="tag-row"]';

/** SPEC.md's documented window: "1100x760, non-resizable-min 900x640". */
const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 760;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 640;

/** RT_THRESHOLD_MS in core/anomaly.ts, mirrored so a silent edit to either side shows up here. */
const RT_THRESHOLD_MS = 2000;
/** MIN_TRIALS / MIN_ANOMALY_TRIALS / ANOMALY_RATE, same reason. */
const MIN_TRIALS = 10;
const MIN_ANOMALY_TRIALS = 2;
const ANOMALY_RATE = 0.15;

/** BASE_SEED in screens/anomaly.ts. */
const FIRST_SEED = '811';

/**
 * TRIGGER_CATEGORIES in core/anomaly.ts, in O8's order, with the labels the screen prints. The
 * order is the contract: O8 lists the four triggers in this sequence and the drill round-robins
 * over them, so trial 0 is off-tree-sizing and trial 4 is off-tree-sizing again.
 */
const TRIGGERS = [
  { category: 'off-tree-sizing', label: 'Off-tree sizing' },
  { category: 'unfamiliar-texture', label: 'Unfamiliar texture class' },
  { category: 'stack-depth-outside-range', label: 'Stack depth outside the trained range' },
  { category: 'read-contradicts-frame', label: 'A read that contradicts the frame' },
] as const;

/** The pinned sequence's first prompt, read out of core at seed 811. */
const FIRST_PROMPT = 'UTG vs CO srp · dynamic · 100 bb · 33% pot · no read — standard?';

/**
 * The first six prompts, which is what the reproducibility test compares across two launches.
 * Trials 4 and 5 are the two anomalies in this stretch — one an off-tree 15% sizing, one a
 * four-to-a-straight board — and they are the stimuli the "answered correctly" tests use.
 */
const FIRST_PROMPTS = [
  FIRST_PROMPT,
  'SB vs BB srp · static · 100 bb · 33% pot · no read — standard?',
  'UTG vs CO srp · semi · 200 bb · 33% pot · no read — standard?',
  'CO vs BTN 3bet · dynamic · 100 bb · 75% pot · c-bets flop at a normal clip — standard?',
  'CO vs BTN 3bet · semi · 100 bb · 15% pot · c-bets flop at a normal clip — standard?',
  'BTN vs BB srp · four-to-a-straight · 100 bb · 75% pot · c-bets flop at a normal clip — standard?',
];

/**
 * Which of the first 40 trials are anomalous, read out of core at seeds 811..850. Five in forty is
 * 12.5% against a seeded 15% — one binomial standard error low at n = 40, which is the point of
 * test 9: the rate is a coin, so a pinned sequence is checked both for its exact count (determinism)
 * and for its distance from 15% (the spec's number).
 */
const ANOMALOUS_INDICES = [4, 5, 17, 31, 32];
const RUN_LENGTH = 40;

async function openAnomaly(page: Page): Promise<void> {
  await page.click('[data-testid="tab-anomaly"]');
  await page.waitForSelector(root);
  await expect(page.locator(prompt)).toBeVisible();
}

/** Answer the live slot, blocking until the root says it has graded. */
async function answer(page: Page, standard: boolean): Promise<void> {
  await page.keyboard.press(standard ? 'y' : 'n');
  await expect(page.locator(root)).toHaveAttribute('data-phase', 'graded');
}

/** Enter on a graded slot advances. Blocks until the index has actually moved. */
async function advance(page: Page): Promise<void> {
  const before = Number(await page.getAttribute(root, 'data-index'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (want: number) =>
      Number(
        (document.querySelector('[data-testid="anomaly-screen"]') as HTMLElement | null)?.dataset
          .index ?? '-1',
      ) === want,
    before + 1,
  );
  await expect(page.locator(root)).toHaveAttribute('data-phase', 'answer');
}

/** Walk to a given trial index, answering every slot on the way with the truth core would give. */
async function walkTo(page: Page, target: number): Promise<void> {
  while (Number(await page.getAttribute(root, 'data-index')) < target) {
    const index = Number(await page.getAttribute(root, 'data-index'));
    await answer(page, !ANOMALOUS_INDICES.includes(index));
    await advance(page);
  }
}

async function readTriggerTallies(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>('[data-testid="trigger-row"]')].map((el) => [
        el.dataset.category ?? '',
        `${el.dataset.caught ?? '?'}/${el.dataset.met ?? '?'}`,
      ]),
    ),
  );
}

async function readTagCounts(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>('[data-testid="tag-row"]')].map((el) => [
        el.dataset.tag ?? '',
        el.dataset.count ?? '?',
      ]),
    ),
  );
}

/**
 * Freeze the renderer's clock so response time becomes an input rather than a measurement.
 *
 * install() resets performance.now()'s origin, which would make the live prompt's start time
 * predate the clock — so the caller advances one trial afterwards and only the trials after that
 * carry an exact RT. Probed on this Electron/Playwright pair: after pauseAt + fastForward(2100) the
 * screen records data-last-rt="2100", to the millisecond.
 */
async function freezeClock(page: Page): Promise<void> {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
}

/**
 * Resize the real BrowserWindow, then pin the render viewport to the same numbers — the technique
 * layout.spec.ts, charts.spec.ts and drill.spec.ts document, and for the reason they document: a
 * tiling window manager on the host retiles the window moments after it is shown, which makes
 * setSize() cosmetic.
 *
 * MEASURE BEFORE SCREENSHOTTING, NEVER AFTER: page.screenshot() clears
 * Emulation.setDeviceMetricsOverride and the viewport snaps back to the host WM's size.
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
  await settleAnomaly(page);
}

/** Two identical consecutive frames is the real signal that a resize has finished relayouting. */
async function settleAnomaly(page: Page): Promise<void> {
  const settled = await page.evaluate(async () => {
    const nextFrame = (): Promise<void> =>
      new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    const read = (): string => {
      const r = document.querySelector('[data-testid="anomaly-work"]')?.getBoundingClientRect();
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
  expect(settled, 'anomaly layout never stopped changing').toBe(true);
}

/**
 * app.close() waits for a graceful Electron exit, and roughly one launch in ten on macOS never
 * delivers it — the same hazard layout.spec.ts documents. Bound the wait and SIGKILL as a fallback
 * so teardown cannot decide a test's fate.
 */
async function closeApp(app: ElectronApplication, close: () => Promise<void>): Promise<void> {
  const pid = app.process().pid;
  const graceful = await Promise.race([
    close().then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000)),
  ]);
  if (!graceful && pid !== undefined) process.kill(pid, 'SIGKILL');
}

async function withAnomaly(
  body: (ctx: { app: ElectronApplication; page: Page }) => Promise<void>,
  opts: { seed?: number } = {},
): Promise<void> {
  const { app, page, close } = await launchApp({ seed: opts.seed ?? 42 });
  try {
    await openAnomaly(page);
    await body({ app, page });
  } finally {
    await closeApp(app, close);
  }
}

test.describe('O8 anomaly trigger drill', () => {
  test('1. O8s four triggers are named on screen before anything is answered', async () => {
    await withAnomaly(async ({ page }) => {
      await expect(page.locator(triggerList)).toBeVisible();
      await expect(page.locator(triggerRow)).toHaveCount(TRIGGERS.length);

      // The list is the instructional payload, so both the wording and the ORDER are asserted.
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="trigger-row"]')].map((el) => ({
          category: el.dataset.category ?? '',
          text: el.textContent ?? '',
        })),
      );
      expect(rows.map((r) => r.category)).toEqual(TRIGGERS.map((t) => t.category));
      for (const [i, expected] of TRIGGERS.entries()) {
        expect(rows[i].text, `trigger ${i} must name itself`).toContain(expected.label);
      }

      // Nothing met yet, and no trigger marked as fired.
      expect(await readTriggerTallies(page)).toEqual({
        'off-tree-sizing': '0/0',
        'unfamiliar-texture': '0/0',
        'stack-depth-outside-range': '0/0',
        'read-contradicts-frame': '0/0',
      });
      await expect(page.locator(`${triggerRow}[data-fired="true"]`)).toHaveCount(0);
    });
  });

  test('2. the live slot never carries its own answer, and the seed is the pinned one', async () => {
    await withAnomaly(async ({ page }) => {
      await expect(page.locator(root)).toHaveAttribute('data-seed', FIRST_SEED);
      await expect(page.locator(root)).toHaveAttribute('data-index', '0');
      await expect(page.locator(root)).toHaveAttribute('data-category', 'off-tree-sizing');
      await expect(page.locator(root)).toHaveAttribute('data-phase', 'answer');
      await expect(page.locator(prompt)).toHaveText(FIRST_PROMPT);

      // THE WHOLE DRILL DEPENDS ON THIS: if the truth were in the DOM before the commit, the
      // "perceptual" judgment would be a lookup. Nothing that reveals it exists yet.
      await expect(page.locator(verdict)).toHaveCount(0);
      await expect(page.locator(truth)).toHaveCount(0);
      await expect(page.locator(triggerLine)).toHaveCount(0);
      await expect(page.locator(root)).toHaveAttribute('data-last-anomalous', '');
      await expect(page.locator(root)).toHaveAttribute('data-verdict', '');

      // Both answers are offered, and they are the only two.
      await expect(page.locator(yesKey)).toBeVisible();
      await expect(page.locator(noKey)).toBeVisible();

      // Advancing clears the previous verdict again, so trial n+1 is as blind as trial 0 was.
      await answer(page, true);
      await expect(page.locator(truth)).toHaveCount(1);
      await advance(page);
      await expect(page.locator(truth)).toHaveCount(0);
      await expect(page.locator(root)).toHaveAttribute('data-last-anomalous', '');
      await expect(page.locator(root)).toHaveAttribute('data-seed', '812');
      await expect(page.locator(root)).toHaveAttribute('data-category', 'unfamiliar-texture');
    });
  });

  test('3. a standard slot answered correctly passes, is timed, and is not praised', async () => {
    await withAnomaly(async ({ page }) => {
      await answer(page, true);

      await expect(page.locator(root)).toHaveAttribute('data-verdict', 'pass');
      await expect(page.locator(root)).toHaveAttribute('data-last-anomalous', 'false');
      await expect(page.locator(root)).toHaveAttribute('data-last-tag', '');
      await expect(page.locator(verdict)).toHaveAttribute('data-correct', 'true');
      await expect(page.locator(verdict)).toHaveAttribute('data-fast', 'true');
      await expect(page.locator(truth)).toHaveText('That slot was standard.');
      await expect(page.locator(triggerLine)).toHaveText(
        'Every feature was inside the trained ranges.',
      );

      // G3: a correct, fast answer gets NO comment back. Silence is not praise.
      await expect(page.locator(comment)).toHaveCount(0);
      await expect(page.locator(verdictTag)).toHaveText('no tag');
      const body = (await page.locator(verdict).textContent()) ?? '';
      expect(body.toLowerCase()).not.toContain('correct!');
      expect(body.toLowerCase()).not.toContain('well done');

      // RESPONSE TIME MATTERS, so it is recorded and shown, not merely used.
      const rt = Number(await page.getAttribute(root, 'data-last-rt'));
      expect(rt, 'a response time must be recorded').toBeGreaterThanOrEqual(0);
      expect(rt, 'a scripted keypress cannot take two seconds').toBeLessThan(RT_THRESHOLD_MS);
      await expect(page.locator(rtLine)).toHaveAttribute('data-fast', 'true');
      await expect(page.locator(rtLine)).toContainText(`${(rt / 1000).toFixed(2)} s`);
      await expect(page.locator(medianRt)).toContainText(`${(rt / 1000).toFixed(2)} s`);

      // A standard slot is not an anomaly opportunity, so no trigger's tally moved.
      expect(await readTriggerTallies(page)).toEqual({
        'off-tree-sizing': '0/0',
        'unfamiliar-texture': '0/0',
        'stack-depth-outside-range': '0/0',
        'read-contradicts-frame': '0/0',
      });
      await expect(page.locator(root)).toHaveAttribute('data-anomalies', '0');
    });
  });

  test('4. an anomalous slot answered correctly names the trigger it deviated on', async () => {
    await withAnomaly(async ({ page }) => {
      // Trial 4 is the pinned off-tree-sizing anomaly: 15% pot, off the 33/75/125 tree.
      await walkTo(page, 4);
      await expect(page.locator(prompt)).toHaveText(FIRST_PROMPTS[4]);
      await answer(page, false);

      await expect(page.locator(root)).toHaveAttribute('data-verdict', 'pass');
      await expect(page.locator(root)).toHaveAttribute('data-last-anomalous', 'true');
      await expect(page.locator(root)).toHaveAttribute('data-anomalies', '1');
      await expect(page.locator(truth)).toHaveText('That slot was anomalous.');

      // The trigger is named AFTER the commit, and it is the one core labelled — which is the whole
      // instructional point of core's one-feature-off rule.
      await expect(page.locator(triggerLine)).toHaveAttribute('data-category', 'off-tree-sizing');
      await expect(page.locator(triggerLine)).toContainText('off-tree sizing');
      await expect(page.locator(triggerLine)).toContainText('33%, 75%, 125% of pot');
      await expect(page.locator(comment)).toHaveCount(0);

      // The tally lands on that trigger's row and nowhere else, and that row is the marked one.
      expect(await readTriggerTallies(page)).toEqual({
        'off-tree-sizing': '1/1',
        'unfamiliar-texture': '0/0',
        'stack-depth-outside-range': '0/0',
        'read-contradicts-frame': '0/0',
      });
      await expect(page.locator(`${triggerRow}[data-fired="true"]`)).toHaveCount(1);
      await expect(page.locator(`${triggerRow}[data-fired="true"]`)).toHaveAttribute(
        'data-category',
        'off-tree-sizing',
      );

      // Trial 5's anomaly is a different trigger, so the marking must move with it.
      await advance(page);
      await expect(page.locator(prompt)).toHaveText(FIRST_PROMPTS[5]);
      await answer(page, false);
      await expect(page.locator(triggerLine)).toHaveAttribute('data-category', 'unfamiliar-texture');
      expect(await readTriggerTallies(page)).toEqual({
        'off-tree-sizing': '1/1',
        'unfamiliar-texture': '1/1',
        'stack-depth-outside-range': '0/0',
        'read-contradicts-frame': '0/0',
      });
    });
  });

  test('5. a wrong answer shows the truth, the trigger, the tag and core’s own comment', async () => {
    await withAnomaly(async ({ page }) => {
      // (a) A MISSED ANOMALY: trial 4 is anomalous and is answered "standard".
      await walkTo(page, 4);
      await answer(page, true);

      await expect(page.locator(root)).toHaveAttribute('data-verdict', 'fail');
      await expect(page.locator(root)).toHaveAttribute('data-last-tag', 'missed-anomaly');
      await expect(page.locator(verdict)).toHaveAttribute('data-correct', 'false');
      await expect(page.locator(truth)).toHaveText('That slot was anomalous.');
      await expect(page.locator(triggerLine)).toHaveAttribute('data-category', 'off-tree-sizing');
      // core's wording, verbatim — the screen must not paraphrase the grader.
      await expect(page.locator(comment)).toHaveText(
        'Anomalous slot played as standard — one feature was off the trained tree.',
      );
      await expect(page.locator(verdictTag)).toHaveText('missed anomaly');

      // G7: aggregated by tag, never by trait. The met/caught split records the miss.
      expect(await readTriggerTallies(page)).toMatchObject({ 'off-tree-sizing': '0/1' });
      expect(await readTagCounts(page)).toEqual({
        'missed-anomaly': '1',
        'false-alarm': '0',
        slow: '0',
      });

      // (b) A FALSE ALARM: trial 6 is standard and is answered "anomalous". Trial 5 in between is
      // anomalous, so it is answered correctly — otherwise the tag counts below fold two misses
      // into one and the assertion stops describing what it claims to.
      await advance(page);
      await answer(page, false);
      await advance(page);
      await expect(page.locator(root)).toHaveAttribute('data-index', '6');
      await answer(page, false);

      await expect(page.locator(root)).toHaveAttribute('data-last-tag', 'false-alarm');
      await expect(page.locator(truth)).toHaveText('That slot was standard.');
      await expect(page.locator(comment)).toHaveText(
        'Standard slot flagged as anomalous — every feature was inside the trained ranges.',
      );
      await expect(page.locator(verdictTag)).toHaveText('false alarm');
      expect(await readTagCounts(page)).toEqual({
        'missed-anomaly': '1',
        'false-alarm': '1',
        slow: '0',
      });

      // Neither miss is coloured (V2): the screen carries severity in weight and wording, and the
      // verdict block must not have acquired a colour class of its own.
      const colour = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="anomaly-truth"]');
        return el === null ? '' : getComputedStyle(el).color;
      });
      expect(colour, 'a wrong answer must not be marked in red').not.toContain('240, 72, 60');
    });
  });

  test('6. P5 gate A: correct AND under the RT threshold — slow-and-correct is a fail', async () => {
    await withAnomaly(async ({ page }) => {
      await freezeClock(page);
      // The install reset performance.now()'s origin, so step past the in-flight prompt first.
      await answer(page, true);
      await advance(page);

      // (a) EXACTLY at the threshold is fast: core's boundary, asserted at the boundary.
      await page.clock.fastForward(RT_THRESHOLD_MS);
      await answer(page, true);
      await expect(page.locator(root)).toHaveAttribute('data-last-rt', String(RT_THRESHOLD_MS));
      await expect(page.locator(root)).toHaveAttribute('data-verdict', 'pass');
      await expect(page.locator(root)).toHaveAttribute('data-last-tag', '');
      await expect(page.locator(rtLine)).toHaveAttribute('data-fast', 'true');

      // (b) One millisecond past it is slow, and slow is a FAIL even though the answer is right.
      await advance(page);
      await page.clock.fastForward(RT_THRESHOLD_MS + 1);
      await answer(page, true);

      await expect(page.locator(root)).toHaveAttribute('data-last-rt', String(RT_THRESHOLD_MS + 1));
      await expect(page.locator(root)).toHaveAttribute('data-verdict', 'fail');
      await expect(page.locator(root)).toHaveAttribute('data-last-tag', 'slow');
      await expect(page.locator(verdict)).toHaveAttribute('data-correct', 'true');
      await expect(page.locator(verdict)).toHaveAttribute('data-fast', 'false');
      await expect(page.locator(rtLine)).toHaveAttribute('data-fast', 'false');
      await expect(page.locator(rtLine)).toContainText('2.00 s');
      await expect(page.locator(rtLine)).toContainText('over the 2.00 s gate');
      // core's wording again, and it must NOT say the answer was wrong.
      await expect(page.locator(comment)).toHaveText(
        `Correct at ${RT_THRESHOLD_MS + 1} ms; the trigger has to fire under ${RT_THRESHOLD_MS} ms to be a trigger.`,
      );
      await expect(page.locator(verdictTag)).toHaveText('correct but slow');
      expect(await readTagCounts(page)).toMatchObject({
        slow: '1',
        'missed-anomaly': '0',
        'false-alarm': '0',
      });

      // The gate counts it as a non-pass while still counting it correct.
      await expect(page.locator(gate)).toHaveAttribute('data-attempts', '3');
      await expect(page.locator(gate)).toHaveAttribute('data-correct', '3');
      await expect(page.locator(gate)).toHaveAttribute('data-passes', '2');
    });
  });

  test('7. the gate refuses to certify a short block, and passes a clean ten', async () => {
    await withAnomaly(async ({ page }) => {
      await expect(page.locator(gateHeadline)).toHaveText('—');
      await expect(page.locator(gateReason)).toHaveText(`0 of ${MIN_TRIALS} trials`);
      await expect(page.locator(gate)).toHaveAttribute('data-passed', 'false');

      // Nine trials answered perfectly is still not a pass: the trial floor is a floor.
      await walkTo(page, 9);
      await expect(page.locator(gate)).toHaveAttribute('data-attempts', '9');
      await expect(page.locator(gateReason)).toHaveText(`9 of ${MIN_TRIALS} trials`);
      await expect(page.locator(gate)).toHaveAttribute('data-passed', 'false');
      await expect(page.locator(root)).toHaveAttribute('data-gate', 'fail');

      // The tenth closes it — and only because the block contained the two anomalies the gate needs.
      await answer(page, !ANOMALOUS_INDICES.includes(9));
      await expect(page.locator(gate)).toHaveAttribute('data-attempts', String(MIN_TRIALS));
      await expect(page.locator(gate)).toHaveAttribute('data-anomaly-trials', String(MIN_ANOMALY_TRIALS));
      await expect(page.locator(gate)).toHaveAttribute('data-passed', 'true');
      await expect(page.locator(root)).toHaveAttribute('data-gate', 'pass');
      await expect(page.locator(gateHeadline)).toHaveText(`${MIN_TRIALS} of ${MIN_TRIALS}`);
      await expect(page.locator(gateReason)).toContainText('correct and under 2.0 s');
      expect(await readTagCounts(page)).toEqual({
        'missed-anomaly': '0',
        'false-alarm': '0',
        slow: '0',
      });

      // V2: mint marks a fluency-gate pass, and this is the one place it is allowed on this screen.
      const colour = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="anomaly-gate-headline"]');
        return el === null ? '' : getComputedStyle(el).color;
      });
      expect(colour, 'a passed gate is the one mint on this screen').toContain('61, 220, 151');
    });
  });

  test('8. the seeded sequence is identical across two launches of the app', async () => {
    const readPrompts = async (seed: number): Promise<string[]> => {
      const collected: string[] = [];
      await withAnomaly(
        async ({ page }) => {
          await expect(page.locator(root)).toHaveAttribute('data-seed', FIRST_SEED);
          for (let i = 0; i < FIRST_PROMPTS.length; i++) {
            collected.push((await page.locator(prompt).textContent()) ?? '');
            await answer(page, !ANOMALOUS_INDICES.includes(i));
            if (i < FIRST_PROMPTS.length - 1) await advance(page);
          }
        },
        { seed },
      );
      return collected;
    };

    // Same seed, two separate launches: byte-identical prompts, in the same order.
    const first = await readPrompts(42);
    expect(first, 'the pinned sequence changed').toEqual(FIRST_PROMPTS);
    const second = await readPrompts(42);
    expect(second, 'two launches produced different drills').toEqual(first);

    /**
     * And a launch under a DIFFERENT app seed produces the same drill, because the drill's seed is
     * fixed in the screen rather than taken from the table's RNG. Without this the test above would
     * pass for the wrong reason — a sequence that merely tracks --seed is not reproducible for a
     * learner, whose seed changes between sessions.
     */
    const otherSeed = await readPrompts(7);
    expect(otherSeed, 'the drill sequence must not depend on the app seed').toEqual(first);
  });

  test('9. the anomaly rate over a run of the sequence is close to the seeded 15%', async () => {
    await withAnomaly(async ({ page }) => {
      /**
       * Answered "standard" throughout ON PURPOSE, so the run needs no prior knowledge of the
       * answers: the rate is counted off the screen's own post-commit disclosure. That also
       * demonstrates the base-rate trap the gate exists to catch — a reflexive "standard" scores 35
       * of 40 and still fails.
       */
      const anomalous: number[] = [];
      for (let i = 0; i < RUN_LENGTH; i++) {
        await answer(page, true);
        if ((await page.getAttribute(root, 'data-last-anomalous')) === 'true') anomalous.push(i);
        if (i < RUN_LENGTH - 1) await advance(page);
      }

      // Deterministic: the same trials are anomalous every run, and they are the pinned ones.
      expect(anomalous, 'the seeded anomaly positions moved').toEqual(ANOMALOUS_INDICES);

      // And the count is what the screen reports, independently of the walk above.
      await expect(page.locator(root)).toHaveAttribute('data-answered', String(RUN_LENGTH));
      await expect(page.locator(root)).toHaveAttribute(
        'data-anomalies',
        String(ANOMALOUS_INDICES.length),
      );
      await expect(page.locator(rateLine)).toHaveAttribute(
        'data-anomalies',
        String(ANOMALOUS_INDICES.length),
      );
      await expect(page.locator(rateLine)).toHaveAttribute('data-target', ANOMALY_RATE.toFixed(4));

      /**
       * CLOSE TO 15%, stated as the spec states it. Each draw is one Bernoulli(0.15) trial, so at
       * n = 40 the sample proportion has SE = sqrt(0.15*0.85/40) ~= 0.0565. The observed 5/40 =
       * 12.5% sits 0.44 SE low. A 2.5-SE band (~14 points) is the widest that would still reject a
       * real drift to 0% or 30% while tolerating the coin.
       */
      const observed = Number(await page.getAttribute(rateLine, 'data-observed'));
      expect(observed).toBeCloseTo(ANOMALOUS_INDICES.length / RUN_LENGTH, 4);
      const standardError = Math.sqrt((ANOMALY_RATE * (1 - ANOMALY_RATE)) / RUN_LENGTH);
      expect(
        Math.abs(observed - ANOMALY_RATE),
        `observed ${observed} is too far from the seeded ${ANOMALY_RATE}`,
      ).toBeLessThan(2.5 * standardError);
      // The readout says so on screen too, not only in a data attribute.
      await expect(page.locator(rateLine)).toContainText('against a seeded 15%');

      // The base-rate trap, closed: 35 of 40 correct is 87.5%, under the 90% bar.
      await expect(page.locator(gate)).toHaveAttribute('data-passed', 'false');
      await expect(page.locator(gate)).toHaveAttribute(
        'data-correct',
        String(RUN_LENGTH - ANOMALOUS_INDICES.length),
      );
      expect(await readTagCounts(page)).toMatchObject({
        'missed-anomaly': String(ANOMALOUS_INDICES.length),
        'false-alarm': '0',
      });
    });
  });

  test('10. the keydown listener dies with the screen', async () => {
    await withAnomaly(async ({ page }) => {
      await answer(page, true);
      await advance(page);
      await expect(page.locator(root)).toHaveAttribute('data-answered', '1');

      /**
       * Proving a listener was removed cannot be done by pressing a key and seeing nothing — nothing
       * is also what a live-but-harmless listener produces. So the detached root is stashed and then
       * Y is pressed on another tab: a listener that outlived the screen would grade a slot on the
       * detached tree, which is observable on the stash.
       */
      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="anomaly-screen"]');
        (window as unknown as { stash?: Element | null }).stash = el;
      });
      await page.click('[data-testid="tab-charts"]');
      await expect(page.locator(root)).toHaveCount(0);

      await page.keyboard.press('y');
      await page.keyboard.press('n');
      await page.keyboard.press('Enter');

      const stashed = await page.evaluate(() => {
        const el = (window as unknown as { stash?: HTMLElement | null }).stash;
        return el === null || el === undefined
          ? null
          : { answered: el.dataset.answered ?? '?', index: el.dataset.index ?? '?' };
      });
      expect(stashed, 'the stash went missing').not.toBeNull();
      expect(stashed?.answered, 'a leaked listener graded a slot on a detached screen').toBe('1');
      expect(stashed?.index, 'a leaked listener advanced a detached screen').toBe('1');

      // And the screen is healthy on return: a fresh mount, back at the pinned first trial.
      await page.click('[data-testid="tab-anomaly"]');
      await page.waitForSelector(root);
      await expect(page.locator(root)).toHaveAttribute('data-index', '0');
      await expect(page.locator(root)).toHaveAttribute('data-answered', '0');
      await expect(page.locator(prompt)).toHaveText(FIRST_PROMPT);
      await answer(page, true);
      await expect(page.locator(root)).toHaveAttribute('data-answered', '1');
    });
  });

  test('11. the clicks work as well as the keys', async () => {
    await withAnomaly(async ({ page }) => {
      await page.click(noKey);
      await expect(page.locator(root)).toHaveAttribute('data-phase', 'graded');
      // Trial 0 is standard, so "anomalous" is a false alarm.
      await expect(page.locator(root)).toHaveAttribute('data-last-tag', 'false-alarm');

      await page.click(nextBtn);
      await expect(page.locator(root)).toHaveAttribute('data-index', '1');
      await page.click(yesKey);
      await expect(page.locator(root)).toHaveAttribute('data-verdict', 'pass');

      /**
       * A graded slot takes no second answer. Both halves are asserted: the keys leave the DOM, so
       * there is nothing to click, AND the keystroke is inert, so a learner leaning on Y cannot
       * grade the same slot twice — an RT-measured drill that double-counts would report a second
       * response of ~0 ms.
       */
      await expect(page.locator(yesKey)).toHaveCount(0);
      await expect(page.locator(noKey)).toHaveCount(0);
      await page.keyboard.press('y');
      await page.keyboard.press('n');
      await expect(page.locator(root)).toHaveAttribute('data-answered', '2');
      await expect(page.locator(root)).toHaveAttribute('data-verdict', 'pass');
    });
  });

  test('12. both panels fit the documented window sizes, answering and graded', async () => {
    await withAnomaly(async ({ app, page }) => {
      for (const graded of [false, true]) {
        if (graded) await answer(page, true);

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
              side: box('[data-testid="anomaly-side"]'),
              work: box('[data-testid="anomaly-work"]'),
              prompt: box('[data-testid="anomaly-prompt"]'),
              triggers: box('[data-testid="trigger-list"]'),
              promptClip: clipped('[data-testid="anomaly-prompt"]'),
              workClip: clipped('[data-testid="anomaly-work"]'),
              triggerClips: [
                ...document.querySelectorAll<HTMLElement>('[data-testid="trigger-row"]'),
              ].map((el) => el.scrollWidth - el.clientWidth),
              panelsOverlap: (() => {
                const a = document.querySelector('[data-testid="anomaly-side"]');
                const b = document.querySelector('[data-testid="anomaly-work"]');
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
          expect(geo.panelsOverlap, `${at}: the two panels overlap`).toBe(false);

          // The stimulus must never be the thing that gets cut: reading it IS the task.
          expect(geo.promptClip, `${at}: prompt missing`).not.toBeNull();
          expect(
            geo.promptClip?.overflowX ?? 1,
            `${at}: the stimulus is cut off horizontally`,
          ).toBeLessThanOrEqual(1);
          expect(
            geo.promptClip?.overflowY ?? 1,
            `${at}: the stimulus is cut off vertically`,
          ).toBeLessThanOrEqual(1);

          // The trigger list is the payload, so no row may be clipped either.
          for (const overflow of geo.triggerClips) {
            expect(overflow, `${at}: a trigger row is cut off horizontally`).toBeLessThanOrEqual(1);
          }

          /**
           * The slot panel must not be swallowing overflow into its own scrollbar — the two answer
           * keys are what the learner is aiming at and a hidden one is a broken drill. The trigger
           * list is allowed to scroll (measured: it does not fit at 640px and the CSS says so), and
           * that is deliberate rather than an oversight.
           */
          expect(geo.workClip, `${at}: work panel missing`).not.toBeNull();
          expect(
            geo.workClip?.overflowY ?? 1,
            `${at}: the slot panel is scrolling internally (${geo.workClip?.overflowY ?? '?'}px hidden)`,
          ).toBeLessThanOrEqual(1);
          expect(
            geo.workClip?.overflowX ?? 1,
            `${at}: the slot panel overflows horizontally`,
          ).toBeLessThanOrEqual(1);

          for (const [name, box] of Object.entries({
            side: geo.side,
            work: geo.work,
            prompt: geo.prompt,
            triggers: geo.triggers,
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

  test('13. screenshots at both documented sizes, answering and graded', async () => {
    await withAnomaly(async ({ app, page }) => {
      await useViewport(app, page, DEFAULT_WIDTH, DEFAULT_HEIGHT);
      await shot(page, 'anomaly-1100x760');

      // Re-apply the override after the shot: screenshotting clears it.
      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT);
      await shot(page, 'anomaly-900x640');

      await useViewport(app, page, DEFAULT_WIDTH, DEFAULT_HEIGHT);
      await walkTo(page, 4);
      await answer(page, true);
      await shot(page, 'anomaly-1100x760-missed');

      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT);
      await shot(page, 'anomaly-900x640-missed');
    });
  });
});
