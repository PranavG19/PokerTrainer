import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, shot } from './helpers.js';
import {
  CONTINUATIONS,
  CONTINUATION_LABELS,
  HEURISTIC_DISCLAIMER,
  robustnessDrill,
  type RobustnessInput,
} from '../../src/core/robustness.js';

/**
 * THE ROBUSTNESS DRILL — PRODUCT-SPEC O7.
 *
 * Three things in here are load-bearing.
 *
 * SYNC ORACLE, NEVER A SLEEP. The screen is synchronous, and its root republishes data-spot,
 * data-verdict, data-profitable, data-best and data-worst on every paint. Every wait below keys off
 * one of those, exactly as the table root publishes data-awaiting.
 *
 * THE EXPECTED NUMBERS ARE CORE'S, TWICE OVER. The literal strings are pinned by hand from
 * src/core/robustness.ts at the fixed seeds each spot carries, so a change on either side shows up
 * here; and `expectMatchesCore` recomputes the whole report in the test process and compares it to
 * the DOM field by field, so a renderer that reads the wrong field of a right report fails too.
 * Both are needed: the literals alone would not notice a column reading `best` instead of its own
 * EV, and the recomputation alone would follow core wherever it moved.
 *
 *   pot-bet-air (7-2 on AKQJ9, bets 100 into 100, bb 10, seed 3)
 *     equilibrium -0.7 · fold-biased +3.4 · call-biased -4.2 · raise-biased -4.5
 *     spread 7.9 bb = 79% of the pot, profitable against 1 → leak
 *   half-pot-bluff (same cards, bets 50) → profitable against 2, spread 6.0 bb / 60% → mixed
 *   check-top-pair (KQ on K7293, checks) → profitable against 4, spread 2.0 bb / 20% → robust
 *   call-drawing-dead (23 on AAAAK, calls 100) → profitable against 0, spread 2.0 bb / 20%
 *     → robust, which is the case that proves `robust` is not `good`
 *   fold-to-a-bet → no-continuation, all four exactly 0.0
 *
 * "LABELLED A HEURISTIC, NEVER A BOUND" IS AN ASSERTION, NOT A NICETY. O7's last sentence is tested
 * two ways: the label and core's own disclaimer must be on screen for EVERY spot, and the screen is
 * scanned for the vocabulary of a bound. The scan cannot simply ban the word "bound" — the label
 * itself says "not a bound" — so what is banned is the phrasing that would make the claim.
 */

const screen = '[data-testid="robust-screen"]';
const spotBtn = '[data-testid="robust-spot-btn"]';
const action = '[data-testid="robust-action"]';
const chips = '[data-testid="robust-chips"]';
const column = '[data-testid="robust-column"]';
const columnName = '[data-testid="robust-column-name"]';
const columnEv = '[data-testid="robust-column-ev"]';
const columnWeights = '[data-testid="robust-column-weights"]';
const verdictWord = '[data-testid="robust-verdict-word"]';
const verdictReason = '[data-testid="robust-verdict-reason"]';
const spread = '[data-testid="robust-spread"]';
const message = '[data-testid="robust-message"]';
const scope = '[data-testid="robust-scope"]';
const heuristic = '[data-testid="robust-heuristic"]';
const side = '[data-testid="robust-side"]';
const work = '[data-testid="robust-work"]';

/** SPEC.md's documented window: "1100x760, non-resizable-min 900x640". */
const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 760;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 640;

/**
 * The five spots the screen serves, mirrored from screens/robustness.ts. Mirrored rather than
 * imported because the screen module imports a CSS file, which a Playwright spec cannot load — and
 * a silent edit to either copy shows up as a failure here, which is the point.
 */
const SPOTS: readonly { id: string; input: RobustnessInput }[] = [
  {
    id: 'pot-bet-air',
    input: { hole: ['7c', '2d'], board: ['Ah', 'Kh', 'Qs', 'Js', '9d'], pot: 100, toCall: 0, line: 'bet', betSize: 100, bb: 10, seed: 3 },
  },
  {
    id: 'half-pot-bluff',
    input: { hole: ['7c', '2d'], board: ['Ah', 'Kh', 'Qs', 'Js', '9d'], pot: 100, toCall: 0, line: 'bet', betSize: 50, bb: 10, seed: 3 },
  },
  {
    id: 'check-top-pair',
    input: { hole: ['Kd', 'Qd'], board: ['Kh', '7s', '2c', '9d', '3h'], pot: 100, toCall: 0, line: 'check', bb: 10, seed: 3 },
  },
  {
    id: 'call-drawing-dead',
    input: { hole: ['2c', '3d'], board: ['Ah', 'Ad', 'As', 'Ac', 'Kd'], pot: 100, toCall: 100, line: 'call', bb: 10, seed: 4 },
  },
  {
    id: 'fold-to-a-bet',
    input: { hole: ['7c', '2d'], board: ['Ah', 'Kh', 'Qs', 'Js', '9d'], pot: 120, toCall: 60, line: 'fold', bb: 10, seed: 3 },
  },
];

function inputFor(id: string): RobustnessInput {
  const spot = SPOTS.find((s) => s.id === id);
  if (spot === undefined) throw new Error(`no such spot: ${id}`);
  return spot.input;
}

async function openRobustness(page: Page): Promise<void> {
  await page.click('[data-testid="tab-robustness"]');
  await page.waitForSelector(screen);
  await expect(page.locator(column)).toHaveCount(CONTINUATIONS.length);
}

async function selectSpot(page: Page, id: string): Promise<void> {
  await page.click(`${spotBtn}[data-spot="${id}"]`);
  await expect(page.locator(screen)).toHaveAttribute('data-spot', id);
}

/** The same rounding the screen prints, so an expectation can be built without restating its code. */
function shownBb(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded > 0 ? `+${rounded.toFixed(1)}` : rounded.toFixed(1);
}

/**
 * Every rendered field against core's report, recomputed here. This is what makes the screen a
 * reader rather than a second model: a dropped call, a swapped continuation or a sign flip fails.
 */
async function expectMatchesCore(page: Page, id: string): Promise<void> {
  const report = robustnessDrill(inputFor(id));

  await expect(page.locator(screen)).toHaveAttribute('data-verdict', report.verdict);
  await expect(page.locator(screen)).toHaveAttribute(
    'data-profitable',
    String(report.profitableAgainst),
  );
  await expect(page.locator(screen)).toHaveAttribute('data-best', report.best);
  await expect(page.locator(screen)).toHaveAttribute('data-worst', report.worst);

  // Four columns, in core's CONTINUATIONS order, each named by core's own label.
  expect(
    await page.locator(column).evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).dataset.continuation ?? ''),
    ),
    `${id}: continuation order`,
  ).toEqual([...CONTINUATIONS]);
  expect(await page.locator(columnName).allTextContents(), `${id}: continuation names`).toEqual(
    CONTINUATIONS.map((c) => CONTINUATION_LABELS[c]),
  );

  for (const outcome of report.outcomes) {
    const cell = page.locator(`${column}[data-continuation="${outcome.id}"]`);
    await expect(cell.locator(columnEv), `${id}/${outcome.id}: EV`).toHaveText(
      `${shownBb(outcome.evBb)} bb`,
    );
    await expect(cell, `${id}/${outcome.id}: profit flag`).toHaveAttribute(
      'data-profit',
      String(outcome.evBb > 0),
    );
    // The re-weighting itself, so "not a new tree" is shown rather than asserted in prose.
    await expect(cell.locator(columnWeights), `${id}/${outcome.id}: weights`).toHaveText(
      `folds ${Math.round(outcome.weights.fold * 100)}% · calls ${Math.round(outcome.weights.call * 100)}% · raises ${Math.round(outcome.weights.raise * 100)}%`,
    );
  }

  await expect(page.locator(spread), `${id}: spread`).toHaveText(
    `${(Math.round(report.spreadBb * 10) / 10).toFixed(1)} bb · ${Math.round(report.spreadPotFraction * 100)}% of the pot`,
  );

  // G3 silence: core returns null on a robust line and on a fold, and nothing is invented in its
  // place — no praise, no "looks fine".
  if (report.message === null) {
    await expect(page.locator(message), `${id}: core said nothing, so nothing is shown`).toHaveCount(0);
  } else {
    await expect(page.locator(message), `${id}: core's own comment`).toHaveText(report.message);
  }
}

/** O7's last sentence, checked on whatever spot is currently shown. */
async function expectHeuristicFraming(page: Page, id: string): Promise<void> {
  await expect(page.locator(heuristic), `${id}: the heuristic label is missing`).toHaveCount(1);
  await expect(page.locator(heuristic)).toContainText('heuristic');
  await expect(page.locator(heuristic), `${id}: core's disclaimer is not on screen`).toContainText(
    HEURISTIC_DISCLAIMER,
  );

  /**
   * innerText, not textContent, and matched on word boundaries — both because a raw substring scan
   * over concatenated text nodes is a broken oracle in both directions. It reported "gto" against a
   * screen that has never said it: the sidebar's "...the same nothing" runs straight into "Top pair
   * checked back", and `nothin-gto-p` matched. innerText puts a break between block elements, and
   * \b stops the remaining joins from inventing a word.
   */
  const body = (await page.locator(screen).innerText()).toLowerCase();
  /**
   * The vocabulary of a bound. "bound" itself is absent from this list on purpose — the label says
   * "not a bound", which is the wording being required, so what is banned is the phrasing that would
   * turn the spread into a claim about the worst that can happen.
   */
  for (const forbidden of [
    /\bexploitab/,
    /\bguarantee/,
    /\bupper bound\b/,
    /\bworst[ -]case\b/,
    /\bat most\b/,
    /\bno worse than\b/,
    /\bmax(imum)? loss\b/,
    /\bgto\b/,
    /\bsolver\b/,
    /\bequilibrium strategy\b/,
  ]) {
    expect(body, `${id}: the screen used bound language: ${forbidden.source}`).not.toMatch(forbidden);
  }
  // The label must say what it is, not only what it is not.
  expect(body).toContain('not a bound');
}

async function withRobustness(
  body: (ctx: { app: ElectronApplication; page: Page }) => Promise<void>,
): Promise<void> {
  const { app, page, close } = await launchApp({ seed: 42 });
  try {
    await openRobustness(page);
    await body({ app, page });
  } finally {
    await close().catch(() => {});
  }
}

/**
 * Resize the real BrowserWindow, then pin the render viewport to the same numbers — the technique
 * layout.spec.ts, charts.spec.ts and drill.spec.ts document, and for the reason they document: a
 * tiling window manager on the host retiles the window moments after it is shown, which makes
 * setSize() cosmetic on its own.
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
  await settle(page);
}

/** Two identical consecutive frames is the real signal that a resize has finished relayouting. */
async function settle(page: Page): Promise<void> {
  const settled = await page.evaluate(async () => {
    const nextFrame = (): Promise<void> =>
      new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    const read = (): string => {
      const r = document.querySelector('[data-testid="robust-work"]')?.getBoundingClientRect();
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
  expect(settled, 'the robustness report panel never stopped changing size').toBe(true);
}

test.describe('the robustness drill: four continuations (O7)', () => {
  test('1. the tab renders the drill, not the placeholder, with all four continuations named', async () => {
    await withRobustness(async ({ page }) => {
      await expect(page.locator(screen)).toBeVisible();
      // The placeholder uses the `<tab>-screen` testid shape, so its wording is what tells them apart.
      await expect(page.locator(screen)).not.toContainText('Not built yet');

      await expect(page.locator(screen)).toHaveAttribute('data-spot', 'pot-bet-air');
      await expect(page.locator(spotBtn)).toHaveCount(SPOTS.length);

      // ALL FOUR, EACH NAMED — O7 does not permit three columns and a summary.
      await expect(page.locator(columnName)).toHaveText([
        'Equilibrium-ish',
        'Fold-biased',
        'Call-biased',
        'Raise-biased',
      ]);

      // The spot itself: seven cards face up (this IS the reveal), and the chips it was played for.
      await expect(page.locator(`${screen} [data-testid="card"]`)).toHaveCount(7);
      await expect(page.locator(action)).toContainText('7-2 offsuit');
      await expect(page.locator(chips)).toHaveText('Pot 100 chips · to call 0 · big blind 10');
    });
  });

  test('2. a line fine against all four reads robust, with the reason, and gets no praise', async () => {
    await withRobustness(async ({ page }) => {
      await selectSpot(page, 'check-top-pair');

      await expect(page.locator(screen)).toHaveAttribute('data-verdict', 'robust');
      await expect(page.locator(screen)).toHaveAttribute('data-profitable', '4');
      await expect(page.locator(verdictWord)).toHaveText('Robust');

      // THE REASON, NOT A BARE SCORE.
      await expect(page.locator(verdictReason)).toHaveText(
        'This line shows a profit against all 4. It swings 2.0 bb, 20% of the pot, between a raise-biased opponent and a fold-biased one.',
      );
      await expect(page.locator(spread)).toHaveText('2.0 bb · 20% of the pot');

      // Every column is in profit, and each says so on its own.
      await expect(page.locator(`${column}[data-profit="true"]`)).toHaveCount(4);
      await expect(page.locator(columnEv)).toHaveText(['+9.2 bb', '+8.5 bb', '+9.3 bb', '+10.5 bb']);

      // G3: silence is not praise. Core returns no message here, and nothing fills the gap.
      await expect(page.locator(message)).toHaveCount(0);
      // innerText and word boundaries, for the reason expectHeuristicFraming documents.
      const body = (await page.locator(screen).innerText()).toLowerCase();
      for (const praise of [/\bwell done\b/, /\bnice\b/, /\bgreat\b/, /\bgood line\b/]) {
        expect(body, `the robust verdict praised the learner: ${praise.source}`).not.toMatch(praise);
      }

      await expectMatchesCore(page, 'check-top-pair');
      await expectHeuristicFraming(page, 'check-top-pair');
    });
  });

  test('3. a line good against exactly one is a leak, and the reason names which one', async () => {
    await withRobustness(async ({ page }) => {
      await selectSpot(page, 'pot-bet-air');

      await expect(page.locator(screen)).toHaveAttribute('data-verdict', 'leak');
      await expect(page.locator(screen)).toHaveAttribute('data-profitable', '1');
      await expect(page.locator(verdictWord)).toHaveText('Leak');

      // "best against call-biased only" in O7's sense: WHICH continuation, and how far the swing is.
      await expect(page.locator(verdictReason)).toHaveText(
        'This line shows a profit against a fold-biased opponent only, and loses against the other 3. It swings 7.9 bb, 79% of the pot, between a fold-biased opponent and a raise-biased one.',
      );
      await expect(page.locator(spread)).toHaveText('7.9 bb · 79% of the pot');

      // Exactly one column in profit, and it is the one the reason named.
      await expect(page.locator(`${column}[data-profit="true"]`)).toHaveCount(1);
      await expect(page.locator(`${column}[data-profit="true"]`)).toHaveAttribute(
        'data-continuation',
        'foldBiased',
      );
      await expect(page.locator(columnEv)).toHaveText(['-0.7 bb', '+3.4 bb', '-4.2 bb', '-4.5 bb']);

      // Core has a comment on a leak, and it is core's wording, not the screen's.
      await expect(page.locator(message)).toHaveText(
        'This line only shows a profit against a fold-biased opponent and swings ~7.9 bb by the time you reach a raise-biased one — it needs the read to be right.',
      );

      await expectMatchesCore(page, 'pot-bet-air');
      await expectHeuristicFraming(page, 'pot-bet-air');
    });
  });

  /**
   * The case that keeps the screen honest. Core's verdict is about the SPREAD only, so a line that
   * loses a little against all four comes back `robust` — and a screen that renders that word alone
   * teaches the learner that drawing dead is fine. The reason has to carry the profit count, and the
   * scope note has to say whose job the money question is.
   */
  test('4. a line bad against all four states that it loses against all four', async () => {
    await withRobustness(async ({ page }) => {
      await selectSpot(page, 'call-drawing-dead');

      await expect(page.locator(screen)).toHaveAttribute('data-profitable', '0');
      await expect(page.locator(`${column}[data-profit="false"]`)).toHaveCount(4);
      await expect(page.locator(`${column}[data-profit="true"]`)).toHaveCount(0);
      await expect(page.locator(columnEv)).toHaveText(['-1.3 bb', '-1.8 bb', '-0.1 bb', '-2.1 bb']);

      await expect(page.locator(verdictReason)).toHaveText(
        'This line loses against all 4, and loses least against a call-biased opponent. It swings 2.0 bb, 20% of the pot, between a call-biased opponent and a raise-biased one.',
      );

      // The verdict word is core's and is tight-spread, so the scope note is what stops it reading
      // as approval of a call that never wins.
      await expect(page.locator(verdictWord)).toHaveText('Robust');
      await expect(page.locator(scope)).toContainText('not that the line makes money');

      await expectMatchesCore(page, 'call-drawing-dead');
      await expectHeuristicFraming(page, 'call-drawing-dead');
    });
  });

  test('5. a line profitable against two of the four is neither, and says how many', async () => {
    await withRobustness(async ({ page }) => {
      await selectSpot(page, 'half-pot-bluff');

      await expect(page.locator(screen)).toHaveAttribute('data-verdict', 'mixed');
      await expect(page.locator(verdictWord)).toHaveText('Mixed');
      await expect(page.locator(verdictReason)).toHaveText(
        'This line shows a profit against 2 of the 4, best against a fold-biased opponent. It swings 6.0 bb, 60% of the pot, between a fold-biased opponent and a call-biased one.',
      );
      await expect(page.locator(`${column}[data-profit="true"]`)).toHaveCount(2);

      await expectMatchesCore(page, 'half-pot-bluff');
      await expectHeuristicFraming(page, 'half-pot-bluff');
    });
  });

  test('6. a fold has no continuation to be exploited by, and is never called robust', async () => {
    await withRobustness(async ({ page }) => {
      await selectSpot(page, 'fold-to-a-bet');

      await expect(page.locator(screen)).toHaveAttribute('data-verdict', 'no-continuation');
      await expect(page.locator(verdictWord)).toHaveText('No continuation');
      await expect(page.locator(verdictWord)).not.toHaveText('Robust');
      await expect(page.locator(verdictReason)).toHaveText(
        'A fold ends the hand, so all four continuations are identical and there is nothing here for an opponent to lean against.',
      );

      // Four flat columns, still all four of them: the shape of the drill does not change.
      await expect(page.locator(columnEv)).toHaveText(['0.0 bb', '0.0 bb', '0.0 bb', '0.0 bb']);
      await expect(page.locator(spread)).toHaveText('0.0 bb · 0% of the pot');
      await expect(page.locator(message)).toHaveCount(0);

      await expectMatchesCore(page, 'fold-to-a-bet');
      await expectHeuristicFraming(page, 'fold-to-a-bet');
    });
  });

  /**
   * O7: "labelled a heuristic, never a bound". Checked on EVERY spot, because a label that is only
   * present on the reassuring ones is worse than no label — the leak is precisely the spot where a
   * learner would read the spread as a limit on how bad the line can be.
   */
  test('7. every spot carries the heuristic label and never claims a bound', async () => {
    await withRobustness(async ({ page }) => {
      for (const { id } of SPOTS) {
        await selectSpot(page, id);
        await expectHeuristicFraming(page, id);
        // The scope note travels with it: `robust` is about agreement, not about money.
        await expect(page.locator(scope), `${id}: the scope note is missing`).toHaveCount(1);
        // And the verdict is never a bare word: the reason is always beside it.
        const reason = (await page.locator(verdictReason).textContent()) ?? '';
        expect(reason.length, `${id}: the verdict has no reason beside it`).toBeGreaterThan(40);
      }
    });
  });

  test('8. every spot renders exactly the report core computes for it', async () => {
    await withRobustness(async ({ page }) => {
      for (const { id } of SPOTS) {
        await selectSpot(page, id);
        await expectMatchesCore(page, id);
      }
    });
  });

  test('9. switching spots replaces every number, carrying nothing across', async () => {
    await withRobustness(async ({ page }) => {
      await selectSpot(page, 'pot-bet-air');
      const leakEvs = await page.locator(columnEv).allTextContents();
      await expect(page.locator(message)).toHaveCount(1);

      await selectSpot(page, 'check-top-pair');
      const robustEvs = await page.locator(columnEv).allTextContents();
      expect(robustEvs).not.toEqual(leakEvs);
      // The leak's message belonged to the leak: showing it beside another spot's numbers would
      // attribute a verdict to a line nobody played.
      await expect(page.locator(message)).toHaveCount(0);
      await expect(page.locator(verdictWord)).toHaveText('Robust');

      // Exactly one spot button is active at a time.
      const active = await page
        .locator(`${spotBtn}[data-active="true"]`)
        .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.spot ?? ''));
      expect(active).toEqual(['check-top-pair']);

      // And going back reproduces the first report exactly — the seeds are fixed, so it must.
      await selectSpot(page, 'pot-bet-air');
      expect(await page.locator(columnEv).allTextContents()).toEqual(leakEvs);
    });
  });

  test('10. the screen fits both documented sizes without clipping', async () => {
    await withRobustness(async ({ app, page }) => {
      // The leak is the tallest state: it is the one with core's message under the verdict.
      for (const id of ['pot-bet-air', 'fold-to-a-bet'] as const) {
        await selectSpot(page, id);

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
              return { top: r.top, right: r.right, bottom: r.bottom, left: r.left };
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
              side: box('[data-testid="robust-side"]'),
              work: box('[data-testid="robust-work"]'),
              heuristic: box('[data-testid="robust-heuristic"]'),
              verdict: box('[data-testid="robust-verdict-reason"]'),
              sideClip: clipped('[data-testid="robust-side"]'),
              workClip: clipped('[data-testid="robust-work"]'),
              columnClips: [
                ...document.querySelectorAll<HTMLElement>('[data-testid="robust-column"]'),
              ].map((el) => el.scrollWidth - el.clientWidth),
              panelsOverlap: (() => {
                const a = document.querySelector('[data-testid="robust-side"]');
                const b = document.querySelector('[data-testid="robust-work"]');
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

          const at = `${id} at ${width}x${height}`;
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

          expect(geo.panelsOverlap, `${at}: the sidebar and the report overlap`).toBe(false);

          /**
           * Both panels carry a max-height valve, so a page that does not scroll is NOT on its own
           * evidence that everything fits — a panel could be swallowing the overflow into its own
           * scrollbar, and the thing at the bottom of the report is the heuristic label. So the day
           * the content outgrows the window this fails rather than quietly hiding O7's own clause.
           */
          for (const [name, clip] of Object.entries({ side: geo.sideClip, work: geo.workClip })) {
            expect(clip, `${at}: "${name}" missing`).not.toBeNull();
            expect(
              clip?.overflowY ?? 1,
              `${at}: "${name}" is scrolling internally (${clip?.overflowY ?? '?'}px hidden)`,
            ).toBeLessThanOrEqual(1);
            expect(clip?.overflowX ?? 1, `${at}: "${name}" overflows horizontally`).toBeLessThanOrEqual(1);
          }

          // Four columns at 900px is the tight case: they must compress, not spill.
          for (const overflow of geo.columnClips) {
            expect(overflow, `${at}: a continuation column is cut off horizontally`).toBeLessThanOrEqual(1);
          }

          for (const [name, boxed] of Object.entries({
            side: geo.side,
            work: geo.work,
            verdict: geo.verdict,
            heuristic: geo.heuristic,
          })) {
            expect(boxed, `${at}: "${name}" missing`).not.toBeNull();
            if (boxed === null) continue;
            expect(boxed.left, `${at}: "${name}" cut off on the left`).toBeGreaterThanOrEqual(0);
            expect(
              boxed.right,
              `${at}: "${name}" hangs past the right edge (${boxed.right} > ${width})`,
            ).toBeLessThanOrEqual(width + 1);
            expect(boxed.top, `${at}: "${name}" cut off above`).toBeGreaterThanOrEqual(0);
            expect(
              boxed.bottom,
              `${at}: "${name}" hangs below the fold (${boxed.bottom} > ${height})`,
            ).toBeLessThanOrEqual(height + 1);
          }
        }
      }
    });
  });

  test('11. screenshots at both documented sizes, leak and robust', async () => {
    await withRobustness(async ({ app, page }) => {
      await useViewport(app, page, DEFAULT_WIDTH, DEFAULT_HEIGHT);
      await shot(page, 'robustness-1100x760-leak');

      // Re-apply the override after the shot: screenshotting clears it.
      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT);
      await shot(page, 'robustness-900x640-leak');

      await useViewport(app, page, DEFAULT_WIDTH, DEFAULT_HEIGHT);
      await selectSpot(page, 'check-top-pair');
      await shot(page, 'robustness-1100x760-robust');

      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT);
      await selectSpot(page, 'call-drawing-dead');
      await shot(page, 'robustness-900x640-losing');
    });
  });
});
