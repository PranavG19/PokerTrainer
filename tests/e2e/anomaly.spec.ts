import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, shot } from './helpers.js';
import {
  DISABLED_MESSAGE,
  EXHAUSTED_MESSAGE,
  TRAINED_DEPTHS_BB,
  TRAINED_SIZINGS_PCT,
  TRAINED_TEXTURES,
  TRIGGER_CATEGORIES,
  stimulusPool,
  transferPool,
} from '../../src/core/anomaly.js';

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
  {
    category: 'off-tree-sizing',
    label: 'Off-tree sizing',
    /**
     * The "what to watch" line is the instructional payload of the row, and each of the four is
     * built out of one of core's trained-range constants — so the expected string is DERIVED from
     * that constant here rather than retyped. A row that stops describing the range it is drawn
     * from, or that gets someone else's range, fails.
     */
    watch: `anything but ${TRAINED_SIZINGS_PCT.join('%, ')}% of pot`,
  },
  {
    category: 'unfamiliar-texture',
    label: 'Unfamiliar texture class',
    watch: `a board outside ${TRAINED_TEXTURES.join(', ')}`,
  },
  {
    category: 'stack-depth-outside-range',
    label: 'Stack depth outside the trained range',
    watch: `a stack that is not ${TRAINED_DEPTHS_BB.join(', ')} bb`,
  },
  {
    category: 'read-contradicts-frame',
    label: 'A read that contradicts the frame',
    watch: 'a read the frame does not already predict',
  },
] as const;

/**
 * PASS_RATE in core/anomaly.ts, as the gate paragraph prints it. Mirrored rather than imported for
 * the same reason as MIN_TRIALS above: the point is that a silent edit to either side shows up.
 */
const PASS_RATE = 0.9;

/**
 * THE SCREEN'S OWN INSTRUCTIONAL COPY, verbatim, as POSITIVE expectations.
 *
 * A denylist of banned wordings ("no 'correct!'", "no red") only catches vocabulary someone thought
 * of in advance; a caption reworded into something equally wrong sails past it. So every paragraph
 * whose CONTENT is the teaching — the two-speed switch, the gate's arithmetic, the clock warning,
 * and the two answer-key labels — is pinned as an exact string, and the numeric ones are
 * interpolated from the constants above so the copy has to move when the rule does.
 */
const COPY = {
  /** O8's claim: the switch is INSTALLED, not explained. */
  speeds:
    'Default: recognise node, texture and role, and play the trained line. Deliberate: engage only when a slot is anomalous. This drill installs the switch — it does not explain it.',
  /** The gate's own arithmetic, including the base-rate trap that justifies the bar's height. */
  gateRule: `The gate needs ${MIN_TRIALS} trials with at least ${MIN_ANOMALY_TRIALS} anomalous ones, and ${Math.round(
    PASS_RATE * 100,
  )}% of them correct and fast. Answering "standard" every time scores about ${Math.round(
    (1 - ANOMALY_RATE) * 100,
  )}% by base rate alone, which is why the bar sits above it.`,
  /** RT is half the grade, so the learner has to be told the clock is already running. */
  hint: 'One judgment, as fast as you can read it. The clock is running from the moment this appeared.',
  /** The two keys must SAY which key does which. An unlabelled pair is an unusable drill. */
  yesKey: 'Y standard',
  noKey: 'N anomalous',
  sectionLabels: [
    'Two speeds',
    'The four triggers',
    `Fluency gate — correct and under ${(RT_THRESHOLD_MS / 1000).toFixed(2)} s`,
  ],
} as const;

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

/**
 * The trigger rows' VISIBLE score text, keyed by category.
 *
 * readTriggerTallies above reads data-caught/data-met, which is a different channel: the readout can
 * say "1 of 0 caught" while both attributes stay right. Both are asserted everywhere a tally moves,
 * and they have to agree.
 */
async function readTriggerScoreText(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>('[data-testid="trigger-score"]')].map((el) => [
        el.dataset.category ?? '',
        (el.textContent ?? '').trim(),
      ]),
    ),
  );
}

/** What the row must say once `caught` of `met` anomalies on that trigger have been seen. */
const scoreText = (caught: number, met: number): string =>
  met === 0 ? 'none met yet' : `${caught} of ${met} caught`;

/**
 * Every colour the verdict block paints, as {r,g,b} — the input to the V2 no-red assertion.
 *
 * NOT A DENYLIST OF ONE RGB. The old assertion excluded the single literal '240, 72, 60', so any
 * other red — #ff0000, crimson, a red background, a red tag pill — reintroduced the
 * severity-by-colour channel V2 forbids while staying green. This collects the resolved colour AND
 * background of every node in the block so the assertion can be "nothing here is reddish", which is
 * a property rather than a vocabulary list.
 */
async function readVerdictPalette(
  page: Page,
): Promise<{ where: string; property: string; value: string }[]> {
  return page.evaluate(() => {
    const block = document.querySelector('[data-testid="anomaly-verdict"]');
    if (block === null) return [];
    const out: { where: string; property: string; value: string }[] = [];
    for (const el of [block, ...block.querySelectorAll('*')]) {
      const style = getComputedStyle(el);
      const where = (el as HTMLElement).dataset.testid ?? (el as HTMLElement).className;
      out.push({ where, property: 'color', value: style.color });
      out.push({ where, property: 'background-color', value: style.backgroundColor });
      out.push({ where, property: 'border-color', value: style.borderTopColor });
    }
    return out;
  });
}

/**
 * "Reddish" as a property, not as a list of hex codes: a mostly-red channel with a visible alpha.
 * The screen's whole palette is greys plus one mint, so every legitimate colour on it is either
 * neutral (r == g == b) or green-dominant — which makes "r clearly exceeds both g and b" a clean
 * separator that no allowed colour trips.
 */
function reddish(value: string): boolean {
  const parts = value.match(/[\d.]+/g);
  if (parts === null || parts.length < 3) return false;
  const [r, g, b] = parts.map(Number);
  const alpha = parts.length > 3 ? Number(parts[3]) : 1;
  if (alpha < 0.1) return false;
  return r > g + 30 && r > b + 30;
}

/**
 * Every tag row's count, read from data-count AND from the text beside it, with the two required to
 * agree before either is returned. Reading only the attribute let a hardcoded '0' in the visible
 * `.tag-count` span pass 16 of 16 while every published number stayed right — the side panel is the
 * only place a learner sees which tag they are missing on, so a zero there hides the whole lesson.
 */
async function readTagCounts(page: Page): Promise<Record<string, string>> {
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="tag-row"]')].map((el) => ({
      tag: el.dataset.tag ?? '',
      published: el.dataset.count ?? '?',
      printed: el.querySelector('.tag-count')?.textContent ?? '?',
      label: el.querySelector('.tag-label')?.textContent ?? '?',
    })),
  );
  for (const row of rows) {
    expect(
      row.printed,
      `tag ${row.tag} publishes ${row.published} but prints "${row.printed}"`,
    ).toBe(row.published);
    // A row whose label is missing or placeholder names nothing the learner can act on.
    expect(row.label.length, `tag ${row.tag} has no label`).toBeGreaterThan(3);
  }
  return Object.fromEntries(rows.map((row) => [row.tag, row.published]));
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

      /**
       * AND WHAT TO WATCH FOR, on all four rows — not just off-tree sizing's.
       *
       * Naming a trigger without saying what makes it fire teaches nothing, so the second line of
       * each row is asserted too. The expected strings are derived from core's own
       * TRAINED_SIZINGS_PCT / TRAINED_TEXTURES / TRAINED_DEPTHS_BB, so widening a trained range in
       * core without re-wording the row it is printed on fails here rather than silently telling
       * the learner to watch for the wrong thing.
       */
      const watches = await page.locator(`${triggerList} .trigger-watch`).allTextContents();
      expect(watches, 'every trigger row must say what makes it fire').toEqual(
        TRIGGERS.map((t) => t.watch),
      );

      // The three section headings, in order: the copy that frames the whole panel.
      expect(
        await page.locator(`${side} .stat-label`).allTextContents(),
        'the side panel must label its three sections',
      ).toEqual([...COPY.sectionLabels]);

      /**
       * O8's two-speed paragraph, verbatim. This is the ONE place the drill states what it is
       * installing; without it the screen is four rows and a stopwatch.
       */
      await expect(page.locator(`${side} .anomaly-speeds`)).toHaveText(COPY.speeds);

      /**
       * The gate's rule, verbatim and with its numbers — MIN_TRIALS, MIN_ANOMALY_TRIALS, the 90%
       * bar, and the 85% base rate that justifies the bar's height. Interpolated above from the
       * same constants the gate is asserted against, so the sentence cannot drift off the rule.
       */
      await expect(
        page.locator(`${gate} p.anomaly-note`).filter({ hasText: 'The gate needs' }),
      ).toHaveText(COPY.gateRule);

      // The clock warning: RT is half the grade, so it must be disclosed before the first keypress.
      await expect(page.locator('[data-testid="anomaly-hint"]')).toHaveText(COPY.hint);

      /**
       * THE TWO KEYS SAY WHICH IS WHICH. Y means standard and N means anomalous; a learner who has
       * to guess the mapping is being timed on a coin flip. Asserted as exact text, because these
       * two labels are the entire control surface of the drill.
       */
      await expect(page.locator(yesKey)).toHaveText(COPY.yesKey);
      await expect(page.locator(noKey)).toHaveText(COPY.noKey);

      // Nothing met yet, and no trigger marked as fired — in the attributes AND on screen.
      expect(await readTriggerTallies(page)).toEqual({
        'off-tree-sizing': '0/0',
        'unfamiliar-texture': '0/0',
        'stack-depth-outside-range': '0/0',
        'read-contradicts-frame': '0/0',
      });
      expect(await readTriggerScoreText(page)).toEqual({
        'off-tree-sizing': scoreText(0, 0),
        'unfamiliar-texture': scoreText(0, 0),
        'stack-depth-outside-range': scoreText(0, 0),
        'read-contradicts-frame': scoreText(0, 0),
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

      /**
       * THE SECOND CHANNEL, AND IT IS A REAL ONE. The verdict block is not the only place the
       * oracle can leak: the trigger list marks the row of the trigger that just fired, and if that
       * marking were computed from the LIVE draw instead of the graded one, an unanswered anomalous
       * slot would light up its own row — visibly, in ink and weight, before the learner has judged
       * anything. Every check above passes under that leak, so it gets its own.
       *
       * Asserted at trial 4, which is the pinned off-tree-sizing ANOMALY: on a standard slot no row
       * would light up either way, so trial 0 cannot tell the two implementations apart.
       */
      await expect(page.locator(`${triggerRow}[data-fired="true"]`)).toHaveCount(0);
      await walkTo(page, 4);
      await expect(page.locator(root)).toHaveAttribute('data-phase', 'answer');
      await expect(page.locator(prompt)).toHaveText(FIRST_PROMPTS[4]);
      await expect(
        page.locator(`${triggerRow}[data-fired="true"]`),
        'an unanswered anomalous slot must not light up the row of the trigger it will turn out to be',
      ).toHaveCount(0);
      // And the marking is invisible in the rendering too, not merely absent from the attribute.
      const preAnswerRows = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="trigger-row"]')].map((el) => {
          const label = el.querySelector('.trigger-label');
          const style = label === null ? null : getComputedStyle(label);
          return `${getComputedStyle(el).backgroundColor}/${style?.fontWeight ?? '?'}`;
        }),
      );
      expect(
        new Set(preAnswerRows).size,
        `one trigger row is styled differently before the answer: ${preAnswerRows.join(' ')}`,
      ).toBe(1);

      // Answering it marks the row; the marking belongs to the GRADED slot, so now it is allowed.
      await answer(page, false);
      await expect(page.locator(`${triggerRow}[data-fired="true"]`)).toHaveCount(1);
      await advance(page);

      // Advancing clears the previous verdict again, so trial n+1 is as blind as trial 0 was.
      await expect(page.locator(root)).toHaveAttribute('data-index', '5');
      await expect(page.locator(truth)).toHaveCount(0);
      await expect(page.locator(root)).toHaveAttribute('data-last-anomalous', '');
      await expect(page.locator(root)).toHaveAttribute('data-verdict', '');
      await expect(
        page.locator(`${triggerRow}[data-fired="true"]`),
        'advancing must clear the fired marking along with the verdict',
      ).toHaveCount(0);
    });
  });

  test('2b. advancing on an ungraded slot is inert, and a modified key never answers', async () => {
    await withAnomaly(async ({ page }) => {
      /**
       * ENTER ON AN UNGRADED SLOT MUST DO NOTHING. Without the `graded === null` guard, Enter walks
       * the index forward without pushing a response — the drill silently loses the trial: the
       * stimulus is never graded, never counted toward the gate, and never added to the seen-set,
       * so it can come back later as a repeat. Nothing in the suite noticed, because every other
       * test only presses Enter after answering.
       */
      await expect(page.locator(root)).toHaveAttribute('data-index', '0');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await expect(
        page.locator(root),
        'Enter on an unanswered slot skipped the trial instead of doing nothing',
      ).toHaveAttribute('data-index', '0');
      await expect(page.locator(root)).toHaveAttribute('data-answered', '0');
      await expect(page.locator(root)).toHaveAttribute('data-phase', 'answer');
      await expect(page.locator(prompt)).toHaveText(FIRST_PROMPT);

      /**
       * AND A MODIFIED KEYPRESS IS NOT AN ANSWER. The listener is on `document`, so Cmd/Ctrl/Alt
       * chords land on it: without the modifier guard, Cmd+Y (or a Ctrl+N new-window reflex) grades
       * the live slot at whatever the clock says — a response the learner never made, timed.
       */
      for (const chord of ['Meta+y', 'Control+y', 'Alt+y', 'Meta+n', 'Control+n', 'Alt+n']) {
        await page.keyboard.press(chord);
        await expect(page.locator(root), `${chord} graded the slot`).toHaveAttribute(
          'data-phase',
          'answer',
        );
        await expect(page.locator(root), `${chord} recorded a response`).toHaveAttribute(
          'data-answered',
          '0',
        );
        await expect(page.locator(root)).toHaveAttribute('data-verdict', '');
      }

      // Modified Enter must not advance either, for the same reason.
      await answer(page, true);
      await expect(page.locator(root)).toHaveAttribute('data-index', '0');
      for (const chord of ['Meta+Enter', 'Control+Enter', 'Alt+Enter']) {
        await page.keyboard.press(chord);
        await expect(page.locator(root), `${chord} advanced the drill`).toHaveAttribute(
          'data-index',
          '0',
        );
      }

      // The unmodified keys still work, so the guard is a filter and not a blanket.
      await advance(page);
      await expect(page.locator(root)).toHaveAttribute('data-index', '1');
      await expect(page.locator(root)).toHaveAttribute('data-answered', '1');
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
      /**
       * AND THE ROW SAYS SO IN WORDS. data-caught/data-met is one channel; the sentence the learner
       * reads is another, and an inverted readout ("1 of 0 caught") is invisible to the first. The
       * two are asserted together everywhere a tally moves, so they cannot disagree.
       */
      expect(await readTriggerScoreText(page)).toEqual({
        'off-tree-sizing': scoreText(1, 1),
        'unfamiliar-texture': scoreText(0, 0),
        'stack-depth-outside-range': scoreText(0, 0),
        'read-contradicts-frame': scoreText(0, 0),
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
      expect(await readTriggerScoreText(page)).toEqual({
        'off-tree-sizing': scoreText(1, 1),
        'unfamiliar-texture': scoreText(1, 1),
        'stack-depth-outside-range': scoreText(0, 0),
        'read-contradicts-frame': scoreText(0, 0),
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
      /**
       * A MISS IS THE CASE THAT SEPARATES THE TWO ORDERINGS. "1 of 1 caught" reads the same forwards
       * and backwards, so a caught anomaly cannot detect an inverted readout; "0 of 1 caught" and
       * "1 of 0 caught" are different sentences and only one of them is true.
       */
      expect(await readTriggerScoreText(page)).toMatchObject({
        'off-tree-sizing': scoreText(0, 1),
      });
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

      /**
       * NEITHER MISS IS COLOURED (V2), stated as a property of the whole block rather than as one
       * banned RGB.
       *
       * The previous form excluded the single literal '240, 72, 60' on one node, which any other red
       * walked straight past — #ff0000 on the truth line, a crimson tag pill, a red border. So every
       * node in the verdict block is collected, in colour, background and border, and none of them
       * may be red-dominant. The screen's palette is greys plus one mint, so nothing legitimate here
       * is even close to the boundary.
       */
      const failPalette = await readVerdictPalette(page);
      expect(failPalette.length, 'the verdict block vanished').toBeGreaterThan(0);
      const reds = failPalette.filter((entry) => reddish(entry.value));
      expect(
        reds,
        `a wrong answer must not be marked in red — severity is carried by wording and weight: ${reds
          .map((entry) => `${entry.where} ${entry.property}=${entry.value}`)
          .join(', ')}`,
      ).toEqual([]);

      /**
       * AND SEVERITY IS STILL CARRIED — by weight, which is what V2 substitutes for hue. Asserting
       * only "no red" would be satisfied by a screen that distinguishes a miss from a pass in no way
       * at all, so the positive half is asserted too: the fail's truth line is heavier and brighter
       * than the pass's. Trial 7 is standard and answered correctly for the comparison.
       */
      const failTruth = await page.evaluate(() => {
        const style = getComputedStyle(
          document.querySelector('[data-testid="anomaly-truth"]') as Element,
        );
        return { weight: Number(style.fontWeight), colour: style.color };
      });
      await advance(page);
      await answer(page, true);
      await expect(page.locator(root)).toHaveAttribute('data-verdict', 'pass');
      const passTruth = await page.evaluate(() => {
        const style = getComputedStyle(
          document.querySelector('[data-testid="anomaly-truth"]') as Element,
        );
        return { weight: Number(style.fontWeight), colour: style.color };
      });
      expect(
        failTruth.weight,
        `a miss must read heavier than a pass (${failTruth.weight} vs ${passTruth.weight})`,
      ).toBeGreaterThan(passTruth.weight);
      expect(
        failTruth.colour,
        'a miss and a pass must not be typeset identically',
      ).not.toBe(passTruth.colour);
      // The pass side is clean of red too, so V2 is not being met by colouring both.
      const passReds = (await readVerdictPalette(page)).filter((entry) => reddish(entry.value));
      expect(passReds, `a pass must not be coloured either: ${JSON.stringify(passReds)}`).toEqual(
        [],
      );
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

      /**
       * THE TWO PUBLISHED AGGREGATES NOBODY WAS READING. data-median-rt and data-pass-rate were
       * absent from this suite entirely, so both could be hardcoded to zero and stay green — and the
       * pass rate is the number the gate's own verdict is computed from.
       *
       * The clock makes both exact rather than approximate: the three RTs are 0, 2000 and 2001 ms, so
       * the median is 2000 and the pass rate is 2/3. Asserted against the attribute AND the rendered
       * median, which have to agree.
       */
      await expect(page.locator(gate)).toHaveAttribute('data-median-rt', String(RT_THRESHOLD_MS));
      await expect(page.locator(gate)).toHaveAttribute('data-pass-rate', (2 / 3).toFixed(4));
      await expect(page.locator(medianRt)).toHaveText(
        `median response time ${(RT_THRESHOLD_MS / 1000).toFixed(2)} s`,
      );
      // Below the 90% bar, which is what the pass rate is for.
      await expect(page.locator(gate)).toHaveAttribute('data-passed', 'false');
      expect(2 / 3, 'this block must sit under the bar for the assertion above to mean anything').toBeLessThan(
        PASS_RATE,
      );
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
      /**
       * A CLEAN TEN IS A PASS RATE OF EXACTLY 1, published as well as rendered. A hardcoded
       * data-pass-rate of 0 satisfied every other assertion in this test, so the one block where the
       * number is unambiguous pins it.
       */
      await expect(page.locator(gate)).toHaveAttribute('data-pass-rate', (1).toFixed(4));
      await expect(page.locator(gate)).toHaveAttribute('data-correct', String(MIN_TRIALS));
      await expect(page.locator(gate)).toHaveAttribute('data-passes', String(MIN_TRIALS));
      /**
       * And the published median agrees with the median the panel prints. The RTs here are real
       * keypress latencies rather than clock-driven, so the value is not pinned — but the two
       * channels must still be the same number, and it must be under the gate the block just passed.
       */
      const publishedMedian = Number(await page.getAttribute(gate, 'data-median-rt'));
      expect(publishedMedian, 'a ten-trial block must have a measured median').toBeGreaterThanOrEqual(0);
      expect(
        publishedMedian,
        `a passed gate cannot have a median of ${publishedMedian} ms`,
      ).toBeLessThanOrEqual(RT_THRESHOLD_MS);
      await expect(page.locator(medianRt)).toHaveText(
        `median response time ${(publishedMedian / 1000).toFixed(2)} s`,
      );
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
      const shown: string[] = [];
      for (let i = 0; i < RUN_LENGTH; i++) {
        // Keyed by CATEGORY + prompt: core's seen-set is per category on purpose, because the same
        // surface legitimately recurs across categories with a different feature deviated.
        shown.push(`${await page.getAttribute(root, 'data-category')} | ${await page.locator(prompt).textContent()}`);
        await answer(page, true);
        if ((await page.getAttribute(root, 'data-last-anomalous')) === 'true') anomalous.push(i);
        if (i < RUN_LENGTH - 1) await advance(page);
      }

      // Deterministic: the same trials are anomalous every run, and they are the pinned ones.
      expect(anomalous, 'the seeded anomaly positions moved').toEqual(ANOMALOUS_INDICES);

      /**
       * NO STIMULUS REPEATS — core's own docstring calls this the invariant that OUTRANKS the 15%
       * rate, because a repeated slot stops measuring the trigger and starts measuring memory of the
       * item. The screen is the only consumer of core's seen-set: it threads a per-category set into
       * drawStimulus, and if it stopped doing so the drill would still look completely normal.
       *
       * Forty trials is enough to catch it: dropping the seen-set first repeats at trial 38, which is
       * inside this run and is NOT one of the pinned anomaly positions — so every other assertion in
       * this test is blind to it. Prompts stand in for ids here because core makes prompts unique
       * within a category (asserted below off the pools themselves).
       */
      for (const category of TRIGGER_CATEGORIES) {
        const prompts = [...stimulusPool(category), ...transferPool(category)].map((s) => s.prompt);
        expect(
          new Set(prompts).size,
          `core's ${category} pool has duplicate prompts, so prompts cannot stand in for ids`,
        ).toBe(prompts.length);
      }
      const repeated = shown.filter((entry, i) => shown.indexOf(entry) !== i);
      expect(
        repeated,
        `a stimulus was shown twice in ${RUN_LENGTH} trials, which measures memory of the item rather than the trigger: ${repeated.join(
          ' ;; ',
        )}`,
      ).toEqual([]);

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
      /*
       * THE READOUT SAYS SO ON SCREEN TOO, in the right order. 'against a seeded 15%' is the one
       * clause a swap of the two counts leaves untouched: printing "40 anomalies in 5" instead of
       * "5 anomalies in 40" passed 16 of 16, which inverts the base rate the whole gate is about. So
       * the counts are pinned as a phrase rather than the tail of the sentence alone.
       */
      await expect(page.locator(rateLine)).toContainText(
        `${ANOMALOUS_INDICES.length} anomalies in ${RUN_LENGTH} —`,
      );
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

  test('9b. the pool runs out on screen: transfer stimuli, then a disabled drill', async () => {
    /**
     * THE EXHAUSTION AND DISABLED PATHS, DRIVEN THROUGH THE UI.
     *
     * Neither had a single assertion, and core's two messages — EXHAUSTED_MESSAGE and
     * DISABLED_MESSAGE — were rendered by nothing under test: deleting the whole notice block from
     * renderWork() left all thirteen tests green.
     *
     * Reaching it needs 288 trials, which sounds prohibitive and is not: each trial is two keypresses
     * against a synchronous renderer with no network and no animation, and the whole walk measures
     * ~5 s. The alternative — asserting the messages at unit level — would not prove the SCREEN
     * renders them, which is the gap.
     *
     * The two boundaries are core's arithmetic, not magic numbers: 4 categories round-robin over a
     * 48-stimulus main pool each, so the main pools are used up after 4 * 48 = 192 trials, and the
     * 24-stimulus transfer pools after a further 4 * 24 = 96, at 288.
     */
    test.setTimeout(300_000);

    const CATEGORY_COUNT = TRIGGER_CATEGORIES.length;
    const MAIN_POOL = stimulusPool(TRIGGER_CATEGORIES[0]).length;
    const TRANSFER_POOL = transferPool(TRIGGER_CATEGORIES[0]).length;
    for (const category of TRIGGER_CATEGORIES) {
      expect(stimulusPool(category).length, `${category} main pool`).toBe(MAIN_POOL);
      expect(transferPool(category).length, `${category} transfer pool`).toBe(TRANSFER_POOL);
    }
    const FIRST_TRANSFER_INDEX = CATEGORY_COUNT * MAIN_POOL;
    const DISABLED_INDEX = CATEGORY_COUNT * (MAIN_POOL + TRANSFER_POOL);

    await withAnomaly(async ({ page }) => {
      const notice = '[data-testid="anomaly-notice"]';

      // Nothing to say while the main pool has stimuli left: the notice is state, not decoration.
      await expect(page.locator(notice)).toHaveCount(0);

      const seenPrompts = new Set<string>();
      let firstTransferIndex = -1;
      let firstTransferPrompt = '';

      for (let step = 0; step <= DISABLED_INDEX; step++) {
        const index = Number(await page.getAttribute(root, 'data-index'));
        if ((await page.getAttribute(root, 'data-disabled')) === 'true') {
          expect(index, 'the drill disabled itself at the wrong trial').toBe(DISABLED_INDEX);
          break;
        }
        if ((await page.locator(notice).count()) > 0 && firstTransferIndex < 0) {
          firstTransferIndex = index;
          firstTransferPrompt = (await page.locator(prompt).textContent()) ?? '';
        }
        const shown = `${await page.getAttribute(root, 'data-category')} | ${await page.locator(prompt).textContent()}`;
        expect(seenPrompts.has(shown), `trial ${index} repeated a stimulus: ${shown}`).toBe(false);
        seenPrompts.add(shown);
        await answer(page, true);
        await advance(page);
      }

      /**
       * (a) THE HANDOVER TO THE HELD-OUT SET, at exactly the trial core's pool sizes predict, and
       * saying what core says. The message matters because the learner is now being measured on
       * transfer rather than on the trained surfaces, and that is a different claim about them.
       */
      expect(
        firstTransferIndex,
        'the transfer notice never appeared before the drill disabled itself',
      ).toBe(FIRST_TRANSFER_INDEX);
      expect(
        firstTransferPrompt,
        `the first transfer stimulus must be at an untrained node, not ${firstTransferPrompt}`,
      ).not.toBe('');

      /**
       * (b) THE DISABLED STATE: core's own sentence, and no slot to answer. A disabled drill that
       * still showed a prompt and two keys would be serving a repeat, which is the exact thing the
       * disabled state exists to refuse.
       */
      await expect(page.locator(root)).toHaveAttribute('data-disabled', 'true');
      await expect(page.locator(root)).toHaveAttribute('data-index', String(DISABLED_INDEX));
      await expect(page.locator(notice)).toHaveCount(1);
      await expect(
        page.locator(notice),
        'a disabled drill must say why, in core’s words',
      ).toHaveText(DISABLED_MESSAGE);
      await expect(page.locator(prompt), 'a disabled drill must not show a slot').toHaveCount(0);
      await expect(page.locator(yesKey)).toHaveCount(0);
      await expect(page.locator(noKey)).toHaveCount(0);

      // And the keys are inert rather than merely absent: Y must not grade a slot that is not there.
      await expect(page.locator(root)).toHaveAttribute('data-answered', String(DISABLED_INDEX));
      await page.keyboard.press('y');
      await page.keyboard.press('n');
      await expect(
        page.locator(root),
        'a keypress graded something on a disabled drill',
      ).toHaveAttribute('data-answered', String(DISABLED_INDEX));

      /**
       * (c) The transfer message is core's too. Asserted here rather than in the loop above because
       * the loop's job is to walk; this pins the string, and it is pinned by IMPORT so a re-wording
       * in core travels with it instead of stranding a stale copy in the test.
       */
      expect(
        EXHAUSTED_MESSAGE,
        'the two notices must be distinguishable, or the handover reads as the shutdown',
      ).not.toBe(DISABLED_MESSAGE);
    });
  });

  test('9c. the transfer handover names itself and moves to untrained nodes', async () => {
    /**
     * The other half of 9b, separated so a failure says which boundary broke. This one walks only as
     * far as the FIRST exhausted category and checks the notice there — 192 trials rather than 288.
     */
    test.setTimeout(300_000);
    const FIRST_TRANSFER_INDEX = TRIGGER_CATEGORIES.length * stimulusPool(TRIGGER_CATEGORIES[0]).length;

    await withAnomaly(async ({ page }) => {
      const notice = '[data-testid="anomaly-notice"]';
      const trainedNodes = new Set<string>();

      while (Number(await page.getAttribute(root, 'data-index')) < FIRST_TRANSFER_INDEX) {
        await expect(
          page.locator(notice),
          `the transfer notice appeared early, at trial ${await page.getAttribute(root, 'data-index')}`,
        ).toHaveCount(0);
        trainedNodes.add(((await page.locator(prompt).textContent()) ?? '').split(' · ')[0]);
        await answer(page, true);
        await advance(page);
      }

      await expect(page.locator(root)).toHaveAttribute('data-index', String(FIRST_TRANSFER_INDEX));
      await expect(
        page.locator(notice),
        'the main pool ran out and the screen said nothing about it',
      ).toHaveText(EXHAUSTED_MESSAGE);

      /**
       * AND THE STIMULUS IS ACTUALLY FROM THE HELD-OUT SET. The message alone could be a label on a
       * repeat; what makes the handover real is that the node is one the learner was never drilled
       * on, which is what "transfer" means. The trained nodes are collected from the 192 trials just
       * walked rather than retyped, so this cannot drift from core's TRAINED_NODES.
       */
      const transferNode = ((await page.locator(prompt).textContent()) ?? '').split(' · ')[0];
      expect(trainedNodes.size, 'the walk saw no nodes at all').toBeGreaterThan(0);
      expect(
        trainedNodes.has(transferNode),
        `the "held-out transfer" stimulus is at ${transferNode}, a node already drilled ${[
          ...trainedNodes,
        ].join(' / ')}`,
      ).toBe(false);

      // The drill is still answerable here — exhausted is not disabled.
      await expect(page.locator(root)).toHaveAttribute('data-disabled', 'false');
      await expect(page.locator(yesKey)).toHaveText(COPY.yesKey);
      await answer(page, true);
      await expect(page.locator(root)).toHaveAttribute('data-phase', 'graded');
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
