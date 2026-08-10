import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, sel, shot } from './helpers.js';
import { tableScreen, waitForIdle } from './flow.js';

/**
 * HAND REVIEW MODE — replay a finished hand decision by decision.
 *
 * The claim under test is narrow and it is the only one that matters: the review shows what the hand
 * ACTUALLY DID. So every assertion here is anchored to something observed at play time, not to a
 * fixture. Test 1 records each hero decision as it is made — the street, the pot on screen, the
 * board on screen, the button pressed — and then walks the review demanding that same sequence back.
 * A review screen that renders plausible poker would fail it.
 *
 * The second load-bearing claim is determinism: gradeDecision runs a seeded Monte Carlo, so a review
 * that re-grades would show the learner a verdict they were never given. Test 3 asserts the review's
 * verdict text against the coach panel text captured mid-hand, and test 4 re-opens the same review
 * twice (and after a restart) demanding byte-identical text.
 *
 * Sync rule: never sleep. The table publishes data-awaiting; the review root publishes
 * data-step / data-steps / data-kind. Those are the only sync points used.
 */

const STATE_FILE = 'offsuit-state.json';

const homeScreen = '[data-testid="home-screen"]';
const profileScreen = '[data-testid="profile-screen"]';
const reviewScreen = '[data-testid="review-screen"]';
const reviewPicker = '[data-testid="review-picker"]';
const openReview = '[data-testid="open-review"]';
const reviewList = '[data-testid="review-list"]';
const reviewHandRow = '[data-testid="review-hand-row"]';
const reviewProgress = '[data-testid="review-progress"]';
const reviewStreet = '[data-testid="review-street"]';
const reviewAction = '[data-testid="review-action"]';
const reviewVerdict = '[data-testid="review-verdict"]';
const reviewPot = '[data-testid="review-pot"]';
const reviewHole = '[data-testid="review-hole"]';
const reviewBoard = '[data-testid="review-board"]';
const reviewNet = '[data-testid="review-net"]';
const reviewNext = '[data-testid="review-next"]';
const reviewPrev = '[data-testid="review-prev"]';
const reviewBack = '[data-testid="review-back"]';
const winnerSummary = '[data-testid="winner-summary"]';

/** SPEC.md's documented window: "1100x760, non-resizable-min 900x640". */
const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 760;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 640;

function freshUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-review-'));
}

function seedSave(fixture: Record<string, unknown>): string {
  const userDataDir = freshUserDataDir();
  fs.writeFileSync(path.join(userDataDir, STATE_FILE), JSON.stringify(fixture, null, 2), 'utf-8');
  return userDataDir;
}

function readSaved(userDataDir: string): {
  hands: {
    handNumber: number;
    net: number;
    decisions?: { street: string; pot: number; action: string; board: string[] }[];
  }[];
  stats: { handsPlayed: number };
} {
  const raw = fs.readFileSync(path.join(userDataDir, STATE_FILE), 'utf-8');
  return JSON.parse(raw) as ReturnType<typeof readSaved>;
}

async function withApp(
  opts: { seed?: number; userDataDir?: string },
  body: (ctx: { app: ElectronApplication; page: Page }) => Promise<void>,
): Promise<void> {
  const { app, page, close } = await launchApp(opts);
  try {
    await body({ app, page });
  } finally {
    await close().catch(() => {});
  }
}

async function openTable(page: Page): Promise<void> {
  await page.waitForSelector(homeScreen);
  await page.locator(sel.newHand).click();
  await page.locator(tableScreen).waitFor();
}

async function openProfile(page: Page): Promise<void> {
  await page.locator(sel.tabProfile).click();
  await page.waitForSelector(profileScreen);
}

/** Profile -> the hand picker. The picker is its own view; the profile column has no spare height. */
async function openPicker(page: Page): Promise<void> {
  await openProfile(page);
  await page.locator(openReview).click();
  await page.locator(reviewPicker).waitFor();
}

/** What the hero can see right now, read in one evaluate so every field describes one frame. */
interface Spot {
  pot: number;
  board: string[];
  hole: string[];
  coach: string;
  coachSeverity: string;
  /** What the Call control says it costs to continue, i.e. the to-call the hero was reading. */
  callLabel: string;
}

async function readSpot(page: Page): Promise<Spot> {
  return page.evaluate(() => {
    const cardsIn = (selector: string): string[] =>
      [...document.querySelectorAll<HTMLElement>(`${selector} [data-testid="card"]`)].map(
        (c) => c.dataset.card ?? '',
      );
    const coachRoot = document.querySelector<HTMLElement>('.coach');
    return {
      pot: Number((document.querySelector('[data-testid="pot"]')?.textContent ?? '').replace(/[^0-9-]/g, '')),
      board: cardsIn('[data-testid="board"]'),
      hole: cardsIn('[data-testid="hero-cards"]'),
      coach:
        coachRoot === null || coachRoot.hidden
          ? ''
          : document.querySelector('[data-testid="coach-message"]')?.textContent ?? '',
      coachSeverity: coachRoot?.dataset.severity ?? 'none',
      callLabel: document.querySelector('[data-testid="btn-call"]')?.textContent ?? '',
    };
  });
}

/**
 * The to-call the table showed the hero, read off the Call control. "Call 50" means 50; a bare
 * "Call" means the call is free. This is the independent oracle for the review's "To call" figure,
 * which is otherwise only ever compared against itself.
 */
function toCallFromLabel(callLabel: string): number {
  const match = /Call\s+(\d+)/.exec(callLabel);
  return match === null ? 0 : Number(match[1]);
}

/** One hero decision as it happened, captured from the live table before the button is pressed. */
interface Played {
  pot: number;
  /** The to-call the table displayed for this spot, read off the Call control before pressing. */
  toCall: number;
  board: string[];
  action: 'check' | 'call' | 'fold';
  /** The coach line that appeared as a result of THIS action, '' when the coach stayed silent. */
  coachAfter: string;
  severityAfter: string;
}

/**
 * Play the hand passively (check > call > fold) to completion, recording each decision from the DOM
 * as it is made. This is the oracle: the review is later checked against this list, so the test
 * knows what the hand did independently of anything the review screen claims.
 */
async function playAndRecord(page: Page, maxActions = 40): Promise<Played[]> {
  const played: Played[] = [];
  for (let i = 0; i < maxActions; i++) {
    if ((await waitForIdle(page)) === 'handover') return played;

    const before = await readSpot(page);
    const candidates: { locator: string; action: Played['action'] }[] = [
      { locator: sel.btnCheck, action: 'check' },
      { locator: sel.btnCall, action: 'call' },
      { locator: sel.btnFold, action: 'fold' },
    ];
    let chosen: Played['action'] | null = null;
    for (const candidate of candidates) {
      if (await page.locator(candidate.locator).isEnabled()) {
        await page.locator(candidate.locator).click();
        chosen = candidate.action;
        break;
      }
    }
    if (chosen === null) throw new Error(`hero turn with no enabled action after ${played.length} actions`);

    // The verdict is written synchronously inside the click handler, so it is already on screen.
    const after = await readSpot(page);
    played.push({
      pot: before.pot,
      toCall: toCallFromLabel(before.callLabel),
      board: before.board,
      action: chosen,
      coachAfter: after.coach,
      severityAfter: after.coachSeverity,
    });
  }
  throw new Error(`hand did not settle within ${maxActions} hero actions`);
}

async function waitForPersistedHands(userDataDir: string, handsPlayed: number): Promise<void> {
  await expect
    .poll(() => {
      try {
        return readSaved(userDataDir).stats.handsPlayed;
      } catch {
        return -1;
      }
    })
    .toBe(handsPlayed);
}

/** What the review screen is showing at the current step, in one frame. */
interface StepView {
  step: number;
  steps: number;
  kind: string;
  progress: string;
  street: string;
  streetText: string;
  action: string;
  actionKind: string;
  pot: string;
  toCall: string;
  toCallText: string;
  hole: string[];
  board: string[];
  verdictSeverity: string;
  verdictText: string;
  bodyText: string;
}

async function readStep(page: Page): Promise<StepView> {
  return page.evaluate(() => {
    const el = (testid: string): HTMLElement | null =>
      document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
    const cardsIn = (testid: string): string[] =>
      [...document.querySelectorAll<HTMLElement>(`[data-testid="${testid}"] [data-testid="card"]`)].map(
        (c) => c.dataset.card ?? '',
      );
    const root = el('review-screen');
    return {
      step: Number(root?.dataset.step ?? -1),
      steps: Number(root?.dataset.steps ?? -1),
      kind: root?.dataset.kind ?? '',
      progress: el('review-progress')?.textContent ?? '',
      street: el('review-street')?.dataset.street ?? '',
      streetText: el('review-street')?.textContent ?? '',
      action: el('review-action')?.textContent ?? '',
      actionKind: el('review-action')?.dataset.action ?? '',
      pot: el('review-pot')?.dataset.value ?? '',
      toCall: el('review-tocall')?.dataset.value ?? '',
      toCallText: el('review-tocall')?.textContent ?? '',
      hole: cardsIn('review-hole'),
      board: cardsIn('review-board'),
      verdictSeverity: el('review-verdict')?.dataset.severity ?? '',
      verdictText: el('review-verdict')?.textContent ?? '',
      bodyText: root?.innerText ?? '',
    };
  });
}

/** Step forward, waiting on the published step index rather than on a timer. */
async function stepForward(page: Page, from: number): Promise<void> {
  await page.locator(reviewNext).click();
  await expect(page.locator(reviewScreen)).toHaveAttribute('data-step', String(from + 1));
}

/** Open the newest hand in the history and block until the replay's first render. */
async function openNewestReview(page: Page): Promise<void> {
  await openPicker(page);
  await expect(page.locator(reviewList)).toBeVisible();
  await page.locator(reviewHandRow).first().click();
  await page.locator(reviewScreen).waitFor();
  await expect(page.locator(reviewScreen)).toHaveAttribute('data-step', '0');
}

/**
 * Resize the real BrowserWindow, then pin the render viewport to the same numbers. A tiling window
 * manager on the host retiles moments after the window is shown, which makes setSize() cosmetic;
 * the device-metrics override makes the geometry assertions describe SPEC.md's documented size.
 */
async function useViewport(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
  settleOn: string = reviewScreen,
): Promise<void> {
  await app.evaluate(async ({ BrowserWindow }, size: { width: number; height: number }) => {
    BrowserWindow.getAllWindows()[0].setSize(size.width, size.height);
  }, { width, height });

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

  // Two identical consecutive frames, never a sleep: a resize is window metrics -> relayout -> paint.
  const settled = await page.evaluate(async (selector: string) => {
    const nextFrame = (): Promise<void> =>
      new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    const read = (): string => {
      const r = document.querySelector(selector)?.getBoundingClientRect();
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
  }, settleOn);
  expect(settled, `layout of ${settleOn} never stopped changing`).toBe(true);
}

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
  return errors;
}

test.describe('hand review replays what the hand actually did', () => {
  test('1. every recorded decision comes back in order with its street, pot, board and action', async () => {
    const userDataDir = freshUserDataDir();
    await withApp({ seed: 42, userDataDir }, async ({ page }) => {
      const errors = watchPageErrors(page);
      await openTable(page);
      expect(await waitForIdle(page)).toBe('hero');

      const dealtHole = (await readSpot(page)).hole;
      expect(dealtHole).toHaveLength(2);

      const played = await playAndRecord(page);
      expect(played.length, 'the hero must have made at least one decision to review').toBeGreaterThan(0);
      const finalBoard = (await readSpot(page)).board;

      await waitForPersistedHands(userDataDir, 1);
      // The save is the input the review reads, so pin the contract there too.
      const saved = readSaved(userDataDir).hands[0];
      expect(saved.decisions, 'a played hand must persist a decision list').toBeDefined();
      expect(saved.decisions).toHaveLength(played.length);

      await openNewestReview(page);

      // One decision step per decision, plus the closing result step.
      await expect(page.locator(reviewScreen)).toHaveAttribute(
        'data-steps',
        String(played.length + 1),
      );

      for (let i = 0; i < played.length; i++) {
        const view = await readStep(page);
        const want = played[i];
        expect(view.step, `step index at decision ${i + 1}`).toBe(i);
        expect(view.kind).toBe('decision');
        expect(view.progress).toBe(`Step ${i + 1} of ${played.length + 1}`);

        expect(Number(view.pot), `pot at decision ${i + 1}`).toBe(want.pot);
        // The to-call the table charged the hero, from the Call control's own label — not from the
        // review's number compared against itself. A free spot must say so in words, not print "0".
        expect(Number(view.toCall), `to-call at decision ${i + 1}`).toBe(want.toCall);
        if (want.toCall === 0) {
          expect(view.toCallText.toLowerCase(), `a free spot at decision ${i + 1}`).toContain(
            'nothing',
          );
        } else {
          expect(view.toCallText, `to-call text at decision ${i + 1}`).toContain(String(want.toCall));
        }
        expect(view.board, `board at decision ${i + 1}`).toEqual(want.board);
        expect(view.hole, `hero cards at decision ${i + 1}`).toEqual(dealtHole);
        expect(view.actionKind, `action at decision ${i + 1}`).toBe(want.action);
        // Spelled out for the learner, not just carried in a data attribute.
        expect(view.action.toLowerCase()).toContain(
          { check: 'checked', call: 'called', fold: 'folded' }[want.action],
        );
        // A call quotes its price in the sentence, and it must be the price actually paid.
        if (want.action === 'call' && want.toCall > 0) {
          expect(view.action, `the call sentence at decision ${i + 1}`).toContain(
            `called ${want.toCall}`,
          );
        }
        // The street label must agree with how many board cards were out.
        const expectedStreet = { 0: 'preflop', 3: 'flop', 4: 'turn', 5: 'river' }[want.board.length];
        expect(view.street, `street label with ${want.board.length} board cards`).toBe(expectedStreet);

        expect(view.bodyText).not.toMatch(/NaN|undefined|null/);

        if (i < played.length) await stepForward(page, i);
      }

      // The last step is the outcome, showing the final board and the result the log recorded.
      const last = await readStep(page);
      expect(last.kind).toBe('result');
      expect(last.board, 'the result step shows the final board').toEqual(finalBoard);
      expect(last.hole).toEqual(dealtHole);
      expect(Number(await page.locator(reviewNet).getAttribute('data-value'))).toBe(
        Math.round(saved.net),
      );

      expect(errors, 'the review must not throw while rendering').toEqual([]);
    });
  });

  test('2. forward and back land on the same step, and the ends are not dead controls', async () => {
    const userDataDir = freshUserDataDir();
    await withApp({ seed: 7, userDataDir }, async ({ page }) => {
      await openTable(page);
      const played = await playAndRecord(page);
      await waitForPersistedHands(userDataDir, 1);
      await openNewestReview(page);

      const steps = played.length + 1;
      const first = await readStep(page);

      // Back at step 0 does nothing rather than being disabled: nothing in this app is ever locked.
      await expect(page.locator(reviewPrev)).toBeEnabled();
      await page.locator(reviewPrev).click();
      await expect(page.locator(reviewScreen)).toHaveAttribute('data-step', '0');
      expect(await readStep(page)).toEqual(first);

      // Walk to the end, then walk back, demanding the same view at each index both ways.
      const forward: string[] = [first.bodyText];
      for (let i = 0; i + 1 < steps; i++) {
        await stepForward(page, i);
        forward.push((await readStep(page)).bodyText);
      }

      await expect(page.locator(reviewNext)).toBeEnabled();
      await page.locator(reviewNext).click();
      await expect(page.locator(reviewScreen)).toHaveAttribute('data-step', String(steps - 1));

      for (let i = steps - 1; i > 0; i--) {
        await page.locator(reviewPrev).click();
        await expect(page.locator(reviewScreen)).toHaveAttribute('data-step', String(i - 1));
        expect((await readStep(page)).bodyText, `step ${i - 1} differs going backwards`).toBe(
          forward[i - 1],
        );
      }
    });
  });

  test('3. the verdict shown is the one the coach gave during the hand, not a re-grade', async () => {
    const userDataDir = freshUserDataDir();
    await withApp({ seed: 42, userDataDir }, async ({ page }) => {
      await openTable(page);
      const played = await playAndRecord(page);
      await waitForPersistedHands(userDataDir, 1);
      await openNewestReview(page);

      for (let i = 0; i < played.length; i++) {
        const view = await readStep(page);
        const live = played[i];

        if (live.coachAfter === '') {
          // The coach stayed silent: review must say a verdict exists and was free, never invent one.
          expect(view.verdictSeverity, `decision ${i + 1} graded silent in play`).toBe('free');
          expect(view.verdictText.toLowerCase()).toContain('no leak flagged');
        } else {
          expect(view.verdictSeverity, `decision ${i + 1} severity`).toBe(live.severityAfter);
          // The coach's exact sentence, character for character — a re-grade or a re-worded summary
          // would move the numbers, and the learner would be shown advice they never got.
          expect(
            view.verdictText,
            `decision ${i + 1}: review shows "${view.verdictText}" but the coach said "${live.coachAfter}"`,
          ).toContain(live.coachAfter);
        }
        if (i + 1 < played.length) await stepForward(page, i);
      }

      /**
       * The assertion above is only worth anything if the hand actually produced a graded verdict.
       * Seed 11 gave five silent decisions, so the exact-sentence branch never ran and the test
       * passed a mutation that replaced the coach's message with a generated one. Seed 42's first
       * decision is graded 'notable' ("Calling 50 into a 75 pot needs 40% pot share; you had 20%."),
       * and that is asserted here so the branch cannot go quiet again unnoticed.
       */
      const graded = played.filter((decision) => decision.coachAfter !== '');
      expect(
        graded.length,
        'no decision in this hand was graded, so the exact-sentence check never ran',
      ).toBeGreaterThan(0);
    });
  });

  test('4. the same stored hand renders the same review every time, and across a restart', async () => {
    const userDataDir = freshUserDataDir();
    let firstPass: string[] = [];

    await withApp({ seed: 19, userDataDir }, async ({ page }) => {
      await openTable(page);
      const played = await playAndRecord(page);
      await waitForPersistedHands(userDataDir, 1);

      const collect = async (): Promise<string[]> => {
        const texts: string[] = [];
        await openNewestReview(page);
        for (let i = 0; i <= played.length; i++) {
          texts.push((await readStep(page)).bodyText);
          if (i < played.length) await stepForward(page, i);
        }
        return texts;
      };

      firstPass = await collect();
      expect(firstPass).toHaveLength(played.length + 1);

      // Leave and come back: same hand, same review.
      await page.locator(reviewBack).click();
      await expect(page.locator(reviewList)).toBeVisible();
      const secondPass = await collect();
      expect(secondPass).toEqual(firstPass);
    });

    // And after a full restart, reading the same file off disk.
    await withApp({ seed: 19, userDataDir }, async ({ page }) => {
      await page.waitForSelector(homeScreen);
      await openPicker(page);
      await page.locator(reviewHandRow).first().click();
      await page.locator(reviewScreen).waitFor();

      const texts: string[] = [];
      for (let i = 0; i < firstPass.length; i++) {
        texts.push((await readStep(page)).bodyText);
        if (i + 1 < firstPass.length) await stepForward(page, i);
      }
      expect(texts).toEqual(firstPass);
    });
  });
});

test.describe('review is keyboard navigable and cleans up after itself', () => {
  test('5. arrows step, Home and End jump, Escape returns to the history', async () => {
    const userDataDir = freshUserDataDir();
    await withApp({ seed: 42, userDataDir }, async ({ page }) => {
      await openTable(page);
      const played = await playAndRecord(page);
      await waitForPersistedHands(userDataDir, 1);
      await openNewestReview(page);

      const last = String(played.length);

      await page.keyboard.press('ArrowRight');
      await expect(page.locator(reviewScreen)).toHaveAttribute('data-step', '1');
      await page.keyboard.press('ArrowLeft');
      await expect(page.locator(reviewScreen)).toHaveAttribute('data-step', '0');

      await page.keyboard.press('End');
      await expect(page.locator(reviewScreen)).toHaveAttribute('data-step', last);
      await expect(page.locator(reviewScreen)).toHaveAttribute('data-kind', 'result');

      await page.keyboard.press('Home');
      await expect(page.locator(reviewScreen)).toHaveAttribute('data-step', '0');

      await page.keyboard.press('Escape');
      await expect(page.locator(reviewList)).toBeVisible();
      await expect(page.locator(reviewScreen)).toHaveCount(0);
    });
  });

  test('6. the keydown listener does not survive leaving the screen', async () => {
    const userDataDir = freshUserDataDir();
    await withApp({ seed: 42, userDataDir }, async ({ page }) => {
      await openTable(page);
      await playAndRecord(page);
      await waitForPersistedHands(userDataDir, 1);

      await openNewestReview(page);
      await page.keyboard.press('ArrowRight');
      await expect(page.locator(reviewScreen)).toHaveAttribute('data-step', '1');

      /**
       * A handle to the screen's own root, kept across the teardown. This is what makes the leak
       * OBSERVABLE: a surviving listener mutates the DETACHED root, which no page-level locator can
       * see — the element is out of the document, so `expect(locator).toHaveCount(0)` passes whether
       * the handler was removed or not. Reading data-step off the handle asks the abandoned screen
       * directly whether it is still processing keys.
       */
      const detached = await page.locator(reviewScreen).elementHandle();
      expect(detached, 'no review root to hold on to').not.toBeNull();
      const stepBefore = await detached!.evaluate((el) => (el as HTMLElement).dataset.step);
      expect(stepBefore).toBe('1');

      // Back to the table.
      await page.locator(sel.tabPlay).click();
      await page.waitForSelector(homeScreen);
      await page.locator(sel.newHand).click();
      await page.locator(tableScreen).waitFor();
      expect(await waitForIdle(page)).toBe('hero');
      await expect(page.locator(reviewScreen)).toHaveCount(0);

      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('End');

      const stepAfter = await detached!.evaluate((el) => (el as HTMLElement).dataset.step);
      expect(
        stepAfter,
        `the torn-down review moved from step ${String(stepBefore)} to ${String(stepAfter)} while the player was at the table, so its keydown listener is still live`,
      ).toBe(stepBefore);

      // The table is unharmed and still waiting for the hero.
      await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'hero');

      // Re-entering the review starts at step 0, not wherever the old instance was parked, and the
      // Profile tab is back on the profile rather than on the half-stepped replay.
      await page.locator(sel.tabProfile).click();
      await page.waitForSelector(profileScreen);
      await page.locator(openReview).click();
      await page.locator(reviewHandRow).first().click();
      await expect(page.locator(reviewScreen)).toHaveAttribute('data-step', '0');
    });
  });
});

test.describe('review never fabricates history', () => {
  /**
   * The honest case. Saves written before decision logging existed carry no decision list at all,
   * and inventing a replay for them would be worse than showing none: the learner would be reading
   * a fiction presented as their own play. Review must say, in words, that nothing was recorded.
   */
  test('7. a hand saved before decision logging says so instead of replaying a guess', async () => {
    const userDataDir = seedSave({
      bankroll: 9800,
      hands: [
        {
          handNumber: 1,
          hole: ['Qs', 'Jh'],
          board: ['2s', '5d', '9c', 'Jd', 'Kh'],
          net: -200,
          vpip: true,
          pfr: false,
          grades: [{ severity: 'notable', principle: 'pot odds', evLossBb: 1.1 }],
        },
      ],
      stats: { handsPlayed: 1, vpipHands: 1, pfrHands: 0, evLossBb: 1.1, leaks: { 'pot odds': 1 }, leakCostBb: { 'pot odds': 1.1 } },
    });
    await withApp({ seed: 42, userDataDir }, async ({ page }) => {
      await openPicker(page);

      // The list itself is honest before the learner even clicks.
      await expect(page.locator('[data-testid="review-hand-steps"]').first()).toHaveText(
        /no decisions recorded/i,
      );

      await page.locator(reviewHandRow).first().click();
      await page.locator(reviewScreen).waitFor();

      await expect(page.locator(reviewScreen)).toHaveAttribute('data-decisions', 'unrecorded');
      // One step only: the result. No decision steps, because there are no decisions.
      await expect(page.locator(reviewScreen)).toHaveAttribute('data-steps', '1');
      await expect(page.locator(reviewScreen)).toHaveAttribute('data-kind', 'result');
      await expect(page.locator(reviewAction)).toHaveCount(0);

      const view = await readStep(page);
      expect(view.bodyText).toMatch(/not recorded|predates/i);
      expect(view.bodyText).not.toMatch(/NaN|undefined/);
      // The facts that WERE saved are still shown.
      expect(view.hole).toEqual(['Qs', 'Jh']);
      expect(view.board).toEqual(['2s', '5d', '9c', 'Jd', 'Kh']);
      expect(await page.locator(reviewNet).getAttribute('data-value')).toBe('-200');
    });
  });

  test('8. with no hands played the way in is still open and explains itself', async () => {
    await withApp({ seed: 42, userDataDir: freshUserDataDir() }, async ({ page }) => {
      await openProfile(page);
      // Never hidden and never disabled with an empty log: a missing entry point reads as a lock.
      await expect(page.locator(openReview)).toBeVisible();
      await expect(page.locator(openReview)).toBeEnabled();

      await openPicker(page);
      await expect(page.locator(reviewList)).toBeVisible();
      await expect(page.locator(reviewHandRow)).toHaveCount(0);
      const empty = page.locator('[data-testid="review-list-empty"]');
      await expect(empty).toBeVisible();
      expect(((await empty.textContent()) ?? '').length).toBeGreaterThan(20);

      // And back out again, so the empty state is not a trap.
      await page.locator('[data-testid="review-list-back"]').click();
      await page.waitForSelector(profileScreen);
    });
  });
});

test.describe('review fits the documented window sizes', () => {
  test('9. nothing is clipped or overlapping at 900x640 and 1100x760', async () => {
    const userDataDir = freshUserDataDir();
    await withApp({ seed: 42, userDataDir }, async ({ app, page }) => {
      const errors = watchPageErrors(page);
      await openTable(page);

      // Two hands, so the history has more than one row and the deepest step count is realistic.
      await playAndRecord(page);
      await expect(page.locator(winnerSummary)).toBeVisible();
      await page.locator('[data-testid="next-hand"]').click();
      await playAndRecord(page);
      await waitForPersistedHands(userDataDir, 2);

      for (const [width, height] of [
        [DEFAULT_WIDTH, DEFAULT_HEIGHT],
        [MIN_WIDTH, MIN_HEIGHT],
      ] as const) {
        await openPicker(page);
        await page.locator(reviewHandRow).first().click();
        await page.locator(reviewScreen).waitFor();
        await useViewport(app, page, width, height);

        // MEASURE BEFORE SCREENSHOTTING: page.screenshot() clears the device-metrics override.
        const geo = await page.evaluate(() => {
          const box = (testid: string): { top: number; bottom: number; left: number; right: number } | null => {
            const el = document.querySelector(`[data-testid="${testid}"]`);
            if (el === null) return null;
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
          };
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            scrollY: window.scrollY,
            docScrollHeight: document.documentElement.scrollHeight,
            root: box('review-screen'),
            step: box('review-step'),
            next: box('review-next'),
            prev: box('review-prev'),
            verdict: box('review-verdict'),
          };
        });

        expect(geo.innerWidth).toBe(width);
        expect(geo.innerHeight).toBe(height);
        expect(geo.scrollY, 'the review was scrolled before measuring').toBe(0);
        expect(
          geo.docScrollHeight,
          `review content is ${geo.docScrollHeight}px in a ${height}px viewport, so the page itself scrolls`,
        ).toBeLessThanOrEqual(height + 1);

        // The step controls are the whole feature; below the fold they do not exist.
        expect(geo.next, 'the Next control is missing').not.toBeNull();
        expect(
          geo.next!.bottom,
          `Next ends at ${geo.next!.bottom.toFixed(1)}px in a ${height}px viewport`,
        ).toBeLessThanOrEqual(height);
        expect(geo.next!.right).toBeLessThanOrEqual(width);
        expect(geo.prev!.bottom).toBeLessThanOrEqual(height);

        // And the panel above them must not sit on top of them.
        expect(
          geo.step!.bottom,
          `the step panel ends at ${geo.step!.bottom.toFixed(1)}px, overlapping Next at ${geo.prev!.top.toFixed(1)}px`,
        ).toBeLessThanOrEqual(geo.prev!.top + 1);

        await shot(page, `review-${width}x${height}`);

        // The shot cleared the override; re-apply before anything else measures or shoots.
        await useViewport(app, page, width, height);
        await expect(page.locator(reviewScreen)).toHaveAttribute('data-step', '0');
      }

      // A second shot deep in the replay, at the minimum size, where the verdict text is longest.
      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT);
      await page.keyboard.press('End');
      await expect(page.locator(reviewScreen)).toHaveAttribute('data-kind', 'result');
      const endGeo = await page.evaluate(() => {
        const r = document.querySelector('[data-testid="review-step"]')?.getBoundingClientRect();
        return { bottom: r?.bottom ?? -1, innerHeight: window.innerHeight };
      });
      expect(endGeo.bottom).toBeLessThanOrEqual(endGeo.innerHeight);
      await shot(page, 'review-result-900x640');

      expect(errors, 'no uncaught renderer error while reviewing').toEqual([]);
    });
  });

  /**
   * The regression this layout was reshaped for. The hand picker started life as a five-row section
   * INSIDE the profile column, which squeezed the leak list — the one section that gives up height —
   * from 42.5px (one row) down to 20px, so the last leak could not be scrolled into view at 900x640.
   * The profile now carries a single fixed-height button and the list owns the picker view. Both
   * facts are asserted here, in one place, at the size that broke.
   */
  test('10. the picker does not steal the height the leak list needs at 900x640', async () => {
    const userDataDir = seedSave({
      bankroll: 7400,
      hands: Array.from({ length: 6 }, (_, i) => ({
        handNumber: i + 1,
        hole: ['As', 'Kd'],
        board: ['2s', '5d', '9c', 'Jd', 'Kh'],
        net: 100,
        vpip: true,
        pfr: false,
        grades: [],
        decisions: [],
      })),
      stats: {
        handsPlayed: 240,
        vpipHands: 62,
        pfrHands: 31,
        evLossBb: 61.2,
        leaks: { 'value or bluff': 3, 'pot odds': 9, ranges: 4, position: 6, 'bet sizing': 2, 'fold equity': 5 },
        leakCostBb: { 'value or bluff': 20, 'pot odds': 14.5, ranges: 9.4, position: 8.1, 'bet sizing': 5.2, 'fold equity': 4 },
      },
    });
    await withApp({ seed: 42, userDataDir }, async ({ app, page }) => {
      await openProfile(page);
      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT, profileScreen);

      const profileGeo = await page.evaluate(() => {
        const leakList = document.querySelector('[data-testid="leak-list"]');
        const leakRow = document.querySelector('[data-testid="leak-row"]');
        const counters = document.querySelector('.counter-grid');
        const entry = document.querySelector('[data-testid="open-review"]');
        if (leakList === null || leakRow === null || counters === null || entry === null) {
          throw new Error('profile column is missing a pinned element');
        }
        return {
          innerHeight: window.innerHeight,
          docScrollHeight: document.documentElement.scrollHeight,
          leakListClientHeight: leakList.clientHeight,
          leakRowHeight: leakRow.getBoundingClientRect().height,
          countersBottom: counters.getBoundingClientRect().bottom,
          entryBottom: entry.getBoundingClientRect().bottom,
        };
      });

      // One whole leak row must fit inside the list, or its last row is unreachable.
      expect(
        profileGeo.leakListClientHeight,
        `the leak list is ${profileGeo.leakListClientHeight}px tall against a ${profileGeo.leakRowHeight}px row`,
      ).toBeGreaterThanOrEqual(profileGeo.leakRowHeight);
      // And the pre-existing guarantees still hold.
      expect(profileGeo.countersBottom).toBeLessThanOrEqual(profileGeo.innerHeight);
      expect(profileGeo.docScrollHeight).toBeLessThanOrEqual(profileGeo.innerHeight + 1);
      expect(profileGeo.entryBottom).toBeLessThanOrEqual(profileGeo.innerHeight);

      // The picker itself, which now owns a column, must fit and reach its last row.
      await page.locator(openReview).click();
      await page.locator(reviewPicker).waitFor();
      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT, reviewPicker);

      await page.locator(reviewHandRow).last().scrollIntoViewIfNeeded();
      const pickerGeo = await page.evaluate(() => {
        const list = document.querySelector('[data-testid="review-list"]')!;
        const row = [...document.querySelectorAll('[data-testid="review-hand-row"]')].at(-1)!;
        const listBox = list.getBoundingClientRect();
        const rowBox = row.getBoundingClientRect();
        return {
          innerHeight: window.innerHeight,
          docScrollHeight: document.documentElement.scrollHeight,
          pageScrollY: window.scrollY,
          listBottom: listBox.bottom,
          rowTop: rowBox.top,
          rowBottom: rowBox.bottom,
          listTop: listBox.top,
        };
      });
      expect(pickerGeo.docScrollHeight).toBeLessThanOrEqual(pickerGeo.innerHeight + 1);
      expect(pickerGeo.pageScrollY, 'reaching the oldest hand scrolled the whole page').toBe(0);
      expect(pickerGeo.rowTop).toBeGreaterThanOrEqual(pickerGeo.listTop - 1);
      expect(pickerGeo.rowBottom).toBeLessThanOrEqual(pickerGeo.listBottom + 1);

      await shot(page, 'review-picker-900x640');
    });
  });

  /**
   * Found by looking at the 900x640 picker screenshot: the suit pips sat 2px past the bottom edge of
   * their cards. The cause was this file's own CSS shrinking `.review-hand-cards .card` to 26x36
   * while `.card.small .card-rank` — three classes to two — kept the 20px rank, so the contents no
   * longer fitted the box. Every card on every review surface is checked, because the same override
   * pattern would clip the replay's cards just as quietly.
   */
  test('11. no card renders its rank or pip outside its own box', async () => {
    const userDataDir = freshUserDataDir();
    await withApp({ seed: 42, userDataDir }, async ({ app, page }) => {
      await openTable(page);
      await playAndRecord(page);
      await waitForPersistedHands(userDataDir, 1);

      const overflowing = async (): Promise<string[]> =>
        page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('[data-testid="card"]')].flatMap((card) => {
            const box = card.getBoundingClientRect();
            return [...card.children].flatMap((child) => {
              const inner = child.getBoundingClientRect();
              const over = Math.max(inner.bottom - box.bottom, inner.right - box.right);
              return over > 0.5
                ? [`${card.dataset.card ?? '?'} ${child.className} overflows by ${over.toFixed(1)}px`]
                : [];
            });
          }),
        );

      await openPicker(page);
      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT, reviewPicker);
      expect(await overflowing(), 'cards clipped in the hand picker').toEqual([]);

      await page.locator(reviewHandRow).first().click();
      await page.locator(reviewScreen).waitFor();
      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT);
      expect(await overflowing(), 'cards clipped on the first replay step').toEqual([]);

      await page.keyboard.press('End');
      await expect(page.locator(reviewScreen)).toHaveAttribute('data-kind', 'result');
      expect(await overflowing(), 'cards clipped on the result step').toEqual([]);
    });
  });
});

test.describe('the picker opens the hand that was clicked', () => {
  /** Six hands, each identifiable by its own hole cards and its own recorded pot. */
  function distinctHands(withHandNumbers: boolean): Record<string, unknown>[] {
    const holes = [
      ['As', 'Ad'],
      ['Ks', 'Kd'],
      ['Qs', 'Qd'],
      ['Js', 'Jd'],
      ['Ts', 'Td'],
      ['9s', '9d'],
    ];
    return holes.map((hole, i) => ({
      ...(withHandNumbers ? { handNumber: i + 1 } : {}),
      hole,
      board: ['2s', '5d', '9c', 'Jd', 'Kh'],
      net: (i + 1) * 10,
      vpip: true,
      pfr: false,
      grades: [],
      decisions: [
        {
          street: 'preflop',
          board: [],
          pot: (i + 1) * 100,
          toCall: 50,
          action: 'call',
          amount: null,
          verdict: null,
        },
      ],
    }));
  }

  /**
   * Newest first, and clicking row N opens the hand row N is describing. Both halves matter and
   * neither was pinned: the picker rendered `[...hands].reverse()` and every earlier assertion only
   * ever used `.first()`, so an oldest-first list would have passed the whole suite, and the replay
   * was looked up with `hands.find(h => h.handNumber === wanted)`.
   */
  test('12. every row opens its own hand, newest first', async () => {
    const userDataDir = seedSave({
      bankroll: 9000,
      hands: distinctHands(true),
      stats: { handsPlayed: 6 },
    });
    await withApp({ seed: 42, userDataDir }, async ({ page }) => {
      await openPicker(page);

      // Newest first: the top row is the last hand played, the bottom row the oldest.
      await expect(page.locator(reviewHandRow)).toHaveCount(6);
      expect(
        await page.locator(reviewHandRow).evaluateAll((rows) =>
          rows.map((r) => (r as HTMLElement).dataset.hand ?? ''),
        ),
        'the picker must list the newest hand first',
      ).toEqual(['6', '5', '4', '3', '2', '1']);

      // Every row, not just the first: the one clicked is the one that opens.
      for (let row = 0; row < 6; row++) {
        const expectedHandNumber = 6 - row;
        const expectedHole = [
          ['As', 'Ad'],
          ['Ks', 'Kd'],
          ['Qs', 'Qd'],
          ['Js', 'Jd'],
          ['Ts', 'Td'],
          ['9s', '9d'],
        ][expectedHandNumber - 1];

        await page.locator(reviewHandRow).nth(row).click();
        await page.locator(reviewScreen).waitFor();
        const view = await readStep(page);
        expect(view.hole, `row ${row} opened the wrong hand's cards`).toEqual(expectedHole);
        expect(Number(view.pot), `row ${row} opened the wrong hand's decision`).toBe(
          expectedHandNumber * 100,
        );
        await expect(page.locator(reviewScreen)).toHaveAttribute(
          'data-hand',
          String(expectedHandNumber),
        );

        await page.locator(reviewBack).click();
        await expect(page.locator(reviewList)).toBeVisible();
      }
    });
  });

  /**
   * The same guarantee for a save that predates hand numbering, where `handNumber` is ABSENT and
   * every hand parses to 0. Identifying a hand by a number that is not unique opened the first hand
   * in the log whichever row was clicked — the learner reviewing someone else's decision under their
   * own click, presented as their history. Rows are addressed by log position instead.
   */
  test('13. rows still open their own hand when the save carries no hand numbers', async () => {
    const userDataDir = seedSave({
      bankroll: 9000,
      hands: distinctHands(false),
      stats: { handsPlayed: 6 },
    });
    await withApp({ seed: 42, userDataDir }, async ({ page }) => {
      await openPicker(page);
      await expect(page.locator(reviewHandRow)).toHaveCount(6);

      // Every hand really does carry the same number, so the row identity cannot come from it.
      expect(
        await page.locator(reviewHandRow).evaluateAll((rows) =>
          rows.map((r) => (r as HTMLElement).dataset.hand ?? ''),
        ),
      ).toEqual(['0', '0', '0', '0', '0', '0']);

      // Newest first still, and each row opens the cards and the pot it is showing.
      const newestFirstHoles = [
        ['9s', '9d'],
        ['Ts', 'Td'],
        ['Js', 'Jd'],
        ['Qs', 'Qd'],
        ['Ks', 'Kd'],
        ['As', 'Ad'],
      ];
      for (let row = 0; row < 6; row++) {
        await page.locator(reviewHandRow).nth(row).click();
        await page.locator(reviewScreen).waitFor();
        const view = await readStep(page);
        expect(
          view.hole,
          `row ${row} of a save with no hand numbers opened the wrong hand's cards`,
        ).toEqual(newestFirstHoles[row]);
        expect(Number(view.pot), `row ${row} opened the wrong hand's decision`).toBe(
          (6 - row) * 100,
        );
        await page.locator(reviewBack).click();
        await expect(page.locator(reviewList)).toBeVisible();
      }
    });
  });
});

test.describe('an aggressive decision is replayed with the size it was made for', () => {
  /**
   * Every other test in this file plays the hand passively — check, then call, then fold — so
   * `actionPhrase`'s bet / raise / all-in branches and the recorded `amount` were never executed by
   * any test at all. Replacing all three phrases with placeholder wording left the suite green. This
   * test presses Raise, so the size the hero chose has to come back out of the replay.
   */
  test('14. a raise replays as a raise, quoting the size the hero chose', async () => {
    const userDataDir = freshUserDataDir();
    await withApp({ seed: 42, userDataDir }, async ({ page }) => {
      const errors = watchPageErrors(page);
      await openTable(page);
      expect(await waitForIdle(page)).toBe('hero');

      // Raise the first decision at the slider's own value, whatever the spot offers.
      await expect(page.locator(sel.btnRaise)).toBeEnabled();
      const raiseTo = Number(
        await page.locator('[data-testid="raise-amount"]').textContent(),
      );
      expect(raiseTo, 'the raise control offered no size').toBeGreaterThan(0);
      await page.locator(sel.btnRaise).click();

      // Then out of the way passively, so the hand finishes and gets logged.
      const rest = await playAndRecord(page);
      await waitForPersistedHands(userDataDir, 1);

      const saved = readSaved(userDataDir).hands[0];
      expect(saved.decisions, 'the raise must have been recorded').toBeDefined();
      expect(saved.decisions).toHaveLength(rest.length + 1);

      await openNewestReview(page);
      const first = await readStep(page);

      // The action kind is the aggressive one, and the SIZE is on screen in words.
      expect(first.actionKind, 'the opening decision was a raise').toMatch(/^(raise|bet|allin)$/);
      if (first.actionKind === 'allin') {
        expect(first.action.toLowerCase()).toContain('all-in');
      } else {
        expect(
          first.action,
          `the replay says "${first.action}" but the hero made it ${raiseTo}`,
        ).toContain(String(raiseTo));
        expect(first.action.toLowerCase()).toMatch(/raised to|bet /);
      }
      expect(first.bodyText).not.toMatch(/NaN|undefined|null/);
      expect(errors).toEqual([]);
    });
  });
});
