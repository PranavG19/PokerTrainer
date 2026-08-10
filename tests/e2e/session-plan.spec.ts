import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, shot } from './helpers.js';
import { SHARES } from '../../src/core/sessionPlan.js';

/**
 * THE SESSION PLANNER — PRODUCT-SPEC S1, S2, S2a, S2b, S3.
 *
 * WHERE THE EXPECTED NUMBERS COME FROM. Every minute and every unit asserted below is derived from
 * the SPEC's own table rather than read out of the screen: shares of 8/6/48/20/14/4 % against the
 * requested duration, floored to whole atoms at the atom sizes S2a's arithmetic names (4 min a
 * warm-up block, 0.75 min a probe, 1.25 min a graded spot, 5 min a contrast set, 2 min fixed for the
 * scoreboard). Worked once, here, so the file is checkable by hand:
 *
 *   50-min session, 4 probes due — warm-up floor 4 (8% of 50 is 4, exactly one block); probes
 *   4 x 0.75 = 3; contrast floor(0.2*50/5) = 2 sets = 10; whole-task 14% = 7 (3 hands at 2 min);
 *   graded floor(0.48*50/1.25) = 19 spots = 23.75. Sum 49.75, and the 0.25 left over is deliberately
 *   unspent because half a spot is not a smaller measurement.
 *
 *   30-min session, 4 probes due — warm-up 4 (the S2b floor: 8% of 30 is 2.4, below one block);
 *   probes 3; contrast max(1, floor(0.2*30/5)) = 1 set = 5; scoreboard 2; that is 14 uncuttable.
 *   Graded budget 0.48*30 = 14.4 → 11 spots = 13.75. 14 + 13.75 + whole-task 4.25 = 32 > 30, so S2
 *   cut 1 drops whole-task WHOLE (−4.25) and the plan lands at 27.75 with nothing else cut.
 *
 * SYNC ORACLE, NEVER A SLEEP: the planner root republishes data-minutes / data-mode / data-status /
 * data-total / data-cut-count / data-deferred / data-due-probes on every paint, the same technique
 * the table root's data-awaiting uses. Every wait in this file keys off one of those.
 *
 * ATTRIBUTE AND TEXT MUST AGREE. A data-* attribute is a test hook; the sentence beside it is what
 * the learner actually reads, and the two are written by different lines of the screen. So every row
 * this file checks is checked TWICE — once as a number off the dataset, once as the rendered string
 * — via `readIngredientText` / `readCutText` and `expectRowReads`. Asserting only the attribute lets
 * every visible minute, count, share and label be corrupted while the suite stays green; that was
 * measured, not guessed (minutes*3+1, units*7+2, shares*700, six labels to 'XXX', total*2 — all 18
 * tests passed).
 */

const planner = '[data-testid="session-planner"]';
const lengthBtn = '[data-testid="length-btn"]';
const modeBtn = '[data-testid="mode-btn"]';
const ingredientRow = '[data-testid="ingredient-row"]';
const cutRow = '[data-testid="cut-row"]';
const cutNone = '[data-testid="cut-none"]';
const cutOrder = '[data-testid="cut-order"]';
const cutProtected = '[data-testid="cut-protected"]';
const plannerTotal = '[data-testid="planner-total"]';
const refusal = '[data-testid="plan-refusal"]';
const refusalReason = '[data-testid="refusal-reason"]';
const refusalRoute = '[data-testid="refusal-route"]';
const deferredNote = '[data-testid="deferred-note"]';
const freeRoamNote = '[data-testid="free-roam-note"]';
const planStart = '[data-testid="plan-start"]';
const homeScreen = '[data-testid="home-screen"]';
const tableScreen = '[data-testid="table-screen"]';

/** BLOCK_KINDS in core/sessionPlan.ts, in the order S1 runs them. Mirrored, not imported. */
const BLOCK_KINDS = [
  'warm-up',
  'decay-probes',
  'graded-spots',
  'contrast-remediation',
  'whole-task',
  'scoreboard',
] as const;

/** CUT_ORDER in core/sessionPlan.ts. S2's whole point, mirrored so an edit either side shows up. */
const CUT_ORDER = ['whole-task', 'warm-up-length', 'graded-spot-count'] as const;

/**
 * The name each ingredient must be CALLED on screen, verbatim from PRODUCT-SPEC S1's table, and the
 * atom it must be COUNTED in. Mirrored from the spec rather than from the screen: the screen's
 * BLOCK_LABELS map is the thing under test, so importing it would assert the screen against itself.
 * Labels are pinned per-kind so a swap — warm-up's row named 'graded spots' — is a failure, which a
 * "some label is present somewhere" check is blind to.
 */
const BLOCK_TEXT: Record<
  (typeof BLOCK_KINDS)[number],
  { readonly label: string; readonly unit: readonly [string, string] }
> = {
  'warm-up': { label: 'fluency warm-up (PLM)', unit: ['block', 'blocks'] },
  'decay-probes': { label: 'decay probes', unit: ['probe', 'probes'] },
  'graded-spots': { label: 'graded spots', unit: ['spot', 'spots'] },
  'contrast-remediation': { label: 'contrast remediation', unit: ['contrast set', 'contrast sets'] },
  'whole-task': { label: 'whole-task live hands', unit: ['live hand', 'live hands'] },
  scoreboard: { label: 'scoreboard', unit: ['scoreboard', 'scoreboards'] },
};

/** What each cut target must be CALLED on screen. S2's own words for its own three steps. */
const CUT_TEXT: Record<(typeof CUT_ORDER)[number], string> = {
  'whole-task': 'whole-task live hands',
  'warm-up-length': 'warm-up length',
  'graded-spot-count': 'graded spot count',
};

/** SPEC.md's documented window: "1100x760, non-resizable-min 900x640". */
const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 760;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 640;

interface Ingredient {
  kind: string;
  minutes: number;
  units: number;
  skipped: boolean;
  why: string;
  /** What the row SAYS, in the four spans a learner reads left to right. */
  label: string;
  share: string;
  minutesText: string;
  unitsText: string;
}

/**
 * Put N concepts in the spacing queue, then force home to re-render so the planner re-reads it.
 *
 * The count is NOT handed to the planner: the states are 40 days old with no reps recorded, so
 * core's own dueNow() owes each of them a wave-0 rep, and the panel's probe count is whatever that
 * function returns. Nothing persists ConceptStates yet, which is why the seam exists at all — the
 * alternative is asserting the probe block only in the zero case, which is the case that hides a
 * dropped probe block.
 *
 * The re-render is a Profile → Play round-trip because main.ts calls renderHome() on every visit to
 * the Play tab; that is the app's own re-render path rather than a test-only hook.
 */
async function queueProbes(page: Page, count: number): Promise<void> {
  await seedQueue(page, count, 'overdue');
  await expect(page.locator(planner)).toHaveAttribute('data-due-probes', String(count));
}

/**
 * Seed the spacing queue with `count` concepts and re-render home.
 *
 * 'overdue' concepts were first seen 40 days ago with NO rep recorded, so schedule.ts owes each one
 * its wave-0 rep. 'current' concepts were first seen today and already have today's rep, so nextDue
 * returns null for every one of them — same array length, zero probes owed. That pair is what makes
 * the panel's count checkably `dueNow(states).length` rather than `states.length`.
 */
async function seedQueue(page: Page, count: number, when: 'overdue' | 'current'): Promise<void> {
  await page.evaluate(
    (spec: { count: number; when: string }) => {
      const DAY = 86_400_000;
      const now = Date.now();
      const overdue = spec.when === 'overdue';
      Object.assign(window, {
        __offsuitProbeQueue: Array.from({ length: spec.count }, (_, i) => ({
          id: `concept-${i}`,
          firstSeen: overdue ? now - 40 * DAY : now,
          opportunities: overdue ? [] : [{ at: now, correct: true }],
          probeMisses: 0,
        })),
      });
    },
    { count, when },
  );

  await page.click('[data-testid="tab-profile"]');
  await page.click('[data-testid="tab-play"]');
  await page.waitForSelector(homeScreen);
}

async function selectLength(page: Page, minutes: number): Promise<void> {
  await page.click(`${lengthBtn}[data-minutes="${minutes}"]`);
  await expect(page.locator(planner)).toHaveAttribute('data-minutes', String(minutes));
}

async function selectMode(page: Page, mode: string): Promise<void> {
  await page.click(`${modeBtn}[data-mode="${mode}"]`);
  await expect(page.locator(planner)).toHaveAttribute('data-mode', mode);
}

/**
 * Every ingredient row, in DOM order — the dataset numbers AND the four strings printed beside them.
 * Both, deliberately: the attribute is what the plan computed, the text is what the learner is told,
 * and `expectRowReads` is what refuses to let those two disagree.
 */
async function readIngredients(page: Page): Promise<Ingredient[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="ingredient-row"]')].map((row) => {
      const text = (selector: string): string =>
        row.querySelector<HTMLElement>(selector)?.textContent ?? '';
      return {
        kind: row.dataset.kind ?? '',
        minutes: Number(row.dataset.minutes),
        units: Number(row.dataset.units),
        skipped: row.dataset.skipped === 'true',
        why: text('[data-testid="ingredient-why"]'),
        label: text('.ingredient-label'),
        share: text('.ingredient-share'),
        minutesText: text('[data-testid="ingredient-minutes"]'),
        unitsText: text('[data-testid="ingredient-units"]'),
      };
    }),
  );
}

/**
 * Every claim a single ingredient row makes about itself, checked against the ONE plan number it is
 * allowed to describe.
 *
 * The row prints four things: S1's name for the block, its share of a 50-minute session, its minutes
 * and its whole-atom count. All four are derived here from `minutes`/`units` and from core's own
 * SHARES — not copied off the screen — so a row whose text drifts from its dataset fails, and so does
 * a row that is named after a different block. `expectedMinutes`/`expectedUnits` are passed in from
 * the spec's worked arithmetic, which is what stops the whole row agreeing on a wrong number.
 */
function expectRowReads(
  rows: Ingredient[],
  kind: (typeof BLOCK_KINDS)[number],
  expectedMinutes: number,
  expectedUnits: number,
): void {
  const row = byKind(rows).get(kind);
  expect(row, `no ${kind} row on screen`).toBeDefined();
  if (row === undefined) return;

  expect(row.minutes, `${kind} data-minutes`).toBe(expectedMinutes);
  expect(row.units, `${kind} data-units`).toBe(expectedUnits);

  const { label, unit } = BLOCK_TEXT[kind];
  expect(row.label, `the ${kind} row is not named "${label}" on screen`).toBe(label);
  expect(
    row.minutesText,
    `the ${kind} row shows data-minutes=${expectedMinutes} but PRINTS "${row.minutesText}"`,
  ).toBe(`${expectedMinutes} min`);
  const noun = expectedUnits === 1 ? unit[0] : unit[1];
  expect(
    row.unitsText,
    `the ${kind} row shows data-units=${expectedUnits} but PRINTS "${row.unitsText}"`,
  ).toBe(`${expectedUnits} ${noun}`);
  // S1's share column, from core's SHARES so the test moves with the table rather than duplicating it.
  expect(row.share, `the ${kind} row's share of a 50-minute session`).toBe(
    `${Math.round(SHARES[kind] * 100)}%`,
  );
}

/**
 * The panel's words must agree with the panel's own numbers, on every row, at any length or mode.
 *
 * This does NOT pin the arithmetic — tests 2 and 3 do that from the spec's table. What it pins is
 * that the sentence a learner reads is the same fact as the attribute a test reads: a screen that
 * computes 13.75 min and prints "42.25 min" is lying to exactly one of its two audiences, and it is
 * the audience that matters. Cheap enough to hold everywhere, which is the point — the arithmetic
 * cases are a handful of configurations and this one is all of them.
 */
function expectRowsSelfConsistent(rows: Ingredient[]): void {
  expect(rows.map((row) => row.kind), 'ingredients are not in S1 order').toEqual([...BLOCK_KINDS]);
  for (const row of rows) {
    const kind = row.kind as (typeof BLOCK_KINDS)[number];
    expectRowReads(rows, kind, row.minutes, row.units);
  }
}

interface CutRow {
  target: string;
  minutes: number;
  label: string;
  minutesText: string;
}

async function readCuts(page: Page): Promise<CutRow[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="cut-row"]')].map((row) => ({
      target: row.dataset.target ?? '',
      minutes: Number(row.dataset.minutes),
      label: row.querySelector<HTMLElement>('.cut-label')?.textContent ?? '',
      minutesText: row.querySelector<HTMLElement>('.cut-minutes')?.textContent ?? '',
    })),
  );
}

/** A cut row must NAME the block it took minutes out of and PRINT the minutes it removed. */
function expectCutReads(cut: CutRow, target: (typeof CUT_ORDER)[number], minutes: number): void {
  expect(cut.target, 'cut target').toBe(target);
  expect(cut.minutes, `${target} data-minutes`).toBe(minutes);
  expect(cut.label, `the ${target} cut is not named "${CUT_TEXT[target]}" on screen`).toBe(
    CUT_TEXT[target],
  );
  // The minus sign is the whole point: a cut that prints "4.25 min" reads as an allocation.
  expect(
    cut.minutesText,
    `the ${target} cut removed ${minutes} min but PRINTS "${cut.minutesText}"`,
  ).toBe(`−${minutes} min`);
}

function byKind(rows: Ingredient[]): Map<string, Ingredient> {
  return new Map(rows.map((row) => [row.kind, row]));
}

/** Resize the real window AND pin the render viewport — layout.spec.ts's technique and reason. */
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
  await settlePlanner(page);
}

/** Two identical consecutive frames is the real signal that a resize has finished relayouting. */
async function settlePlanner(page: Page): Promise<void> {
  const settled = await page.evaluate(async () => {
    const nextFrame = (): Promise<void> =>
      new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    const read = (): string => {
      const r = document
        .querySelector('[data-testid="session-planner"]')
        ?.getBoundingClientRect();
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
  expect(settled, 'the planner never stopped changing size').toBe(true);
}

/** Launch, land on home with the planner painted, always close. */
async function withPlanner(
  body: (ctx: { app: ElectronApplication; page: Page }) => Promise<void>,
): Promise<void> {
  const { app, page, close } = await launchApp({ seed: 42 });
  try {
    await page.waitForSelector(homeScreen);
    await expect(page.locator(planner)).toBeVisible();
    await body({ app, page });
  } finally {
    await close().catch(() => {});
  }
}

test.describe('S1 — one button, two lengths, six ingredients', () => {
  test('1. the length row offers 30 and 50 as sessions, defaults to 30, and marks 15 as not one', async () => {
    await withPlanner(async ({ page }) => {
      const lengths = await page.locator(lengthBtn).evaluateAll((buttons) =>
        buttons.map((el) => ({
          minutes: Number((el as HTMLElement).dataset.minutes),
          sessionLength: (el as HTMLElement).dataset.sessionLength,
          active: (el as HTMLElement).dataset.active,
          text: el.textContent ?? '',
        })),
      );

      // Shortest first, and the exact set: asserting it is what stops a fourth length appearing
      // quietly, and S2a is only honest if 15 is reachable and MARKED rather than hidden.
      expect(lengths.map((l) => l.minutes)).toEqual([15, 30, 50]);
      expect(lengths.filter((l) => l.sessionLength === 'true').map((l) => l.minutes)).toEqual([
        30, 50,
      ]);
      expect(
        lengths.find((l) => l.minutes === 15)?.sessionLength,
        '15 minutes is offered as a session length, which S2a forbids',
      ).toBe('false');

      // AND THE PILLS SAY SO IN WORDS, which is the only form of the claim a learner can act on:
      // data-session-language is a hook, "15 min · not a session" is the disclosure S2a is about.
      // Pinned as the whole row so the marking cannot migrate onto 30 and 50 instead.
      expect(lengths.map((l) => l.text), 'the length pills do not mark 15 as not a session').toEqual(
        ['15 min · not a session', '30 min', '50 min'],
      );

      // S1: default 30.
      await expect(page.locator(planner)).toHaveAttribute('data-minutes', '30');
      expect(lengths.filter((l) => l.active === 'true').map((l) => l.minutes)).toEqual([30]);
      await expect(page.locator(planner)).toHaveAttribute('data-mode', 'session');

      // The two modes, named. S3 makes free-roam a mode you pick rather than a fallback, so both
      // pills must be legible as modes — and the label on each must match the mode it selects.
      expect(
        await page.locator(modeBtn).evaluateAll((buttons) =>
          buttons.map((el) => [(el as HTMLElement).dataset.mode, el.textContent ?? '']),
        ),
        'the mode pills are mislabelled',
      ).toEqual([
        ['session', 'Session'],
        ['free-roam', 'Free-roam'],
      ]);
    });
  });

  test('2. a 30-minute session is the S1 table with whole-task cut, to the minute', async () => {
    await withPlanner(async ({ page }) => {
      await queueProbes(page, 4);
      await selectLength(page, 30);
      await expect(page.locator(planner)).toHaveAttribute('data-status', 'planned');
      await expect(page.locator(planner)).toHaveAttribute('data-total', '27.75');

      const rows = await readIngredients(page);
      // All six, always, in the order they run: a skipped block states 0 rather than vanishing.
      expect(rows.map((r) => r.kind), 'ingredients are not in S1 order').toEqual([...BLOCK_KINDS]);

      // Every row: the dataset number, the block's S1 name, its share, and the minutes and atom
      // count it PRINTS. "≈11 spots" is the number S2a itself quotes for a 30-minute session.
      expectRowReads(rows, 'warm-up', 4, 1);
      expectRowReads(rows, 'decay-probes', 3, 4);
      expectRowReads(rows, 'graded-spots', 13.75, 11);
      expectRowReads(rows, 'contrast-remediation', 5, 1);
      expectRowReads(rows, 'scoreboard', 2, 1);
      // S1: whole-task is dropped first below 30 minutes, and the row says so at 0.
      expectRowReads(rows, 'whole-task', 0, 0);
      expect(byKind(rows).get('whole-task')?.skipped).toBe(true);

      // The minutes on screen must add up to the total on screen — a total tracked separately is a
      // total allowed to drift.
      const summed = rows.reduce((sum, row) => sum + row.minutes, 0);
      expect(summed).toBeCloseTo(27.75, 6);

      // THE HEADLINE SENTENCE, in full. 27.75 of the 30 minutes are spent and the remaining 2.25 are
      // deliberately unspent, so the panel must print BOTH numbers and say which is which: a learner
      // who reads "27.75 min of blocks" alone has been handed a plan that looks 2.25 min short.
      const total30 = (await page.textContent(plannerTotal)) ?? '';
      expect(
        total30,
        `the 30-minute plan's headline reads "${total30}" rather than 27.75 spent and 2.25 unspent`,
      ).toBe(
        '27.75 min of blocks, 2.25 min unspent — a block is whole units, so the remainder buys nothing',
      );
      await shot(page, 'session-plan-30');
    });
  });

  test('3. a 50-minute session runs all six ingredients and cuts nothing', async () => {
    await withPlanner(async ({ page }) => {
      await queueProbes(page, 4);
      await selectLength(page, 50);
      await expect(page.locator(planner)).toHaveAttribute('data-status', 'planned');
      await expect(page.locator(planner)).toHaveAttribute('data-total', '49.75');
      await expect(page.locator(planner)).toHaveAttribute('data-cut-count', '0');

      const rows = await readIngredients(page);
      expectRowReads(rows, 'warm-up', 4, 1);
      expectRowReads(rows, 'decay-probes', 3, 4);
      expectRowReads(rows, 'graded-spots', 23.75, 19);
      expectRowReads(rows, 'contrast-remediation', 10, 2);
      expectRowReads(rows, 'whole-task', 7, 3);
      expectRowReads(rows, 'scoreboard', 2, 1);

      // Nothing is skipped at the reference length, which is what makes it the reference length.
      for (const row of rows) {
        expect(row.skipped, `${row.kind} was skipped in a 50-minute session`).toBe(false);
        expect(row.minutes, `${row.kind} has no minutes`).toBeGreaterThan(0);
      }

      // 50 minutes is where the shares were tuned, so every row's printed share is S1's own column,
      // read left to right down the list. Any two of them swapped and the table stops being S1's.
      expect(rows.map((row) => row.share), 'the share column is not S1’s 8/6/48/20/14/4').toEqual(
        BLOCK_KINDS.map((kind) => `${Math.round(SHARES[kind] * 100)}%`),
      );

      await expect(page.locator(cutRow)).toHaveCount(0);
      await expect(page.locator(cutNone)).toBeVisible();
      // S2's zero case, in words: at the reference length the panel must say nothing was GIVEN UP,
      // and the sentence carries the reason (everything fits) rather than an empty list.
      const nothing = (await page.textContent(cutNone)) ?? '';
      expect(nothing, `the no-cuts note reads "${nothing}"`).toBe(
        'Nothing was cut: every block fits at this length.',
      );
      // 49.75 of 50: the leftover sentence at the reference length too, so the wording is not a
      // special case of the short sitting.
      const total50 = (await page.textContent(plannerTotal)) ?? '';
      expect(
        total50,
        `the 50-minute plan's headline reads "${total50}" rather than 49.75 spent and 0.25 unspent`,
      ).toBe(
        '49.75 min of blocks, 0.25 min unspent — a block is whole units, so the remainder buys nothing',
      );
      await shot(page, 'session-plan-50');
    });
  });

  test('4. the start button is the one button, and it seats the learner at a table', async () => {
    await withPlanner(async ({ page }) => {
      await queueProbes(page, 4);
      await selectLength(page, 50);
      await expect(page.locator(planStart)).toHaveAttribute('data-minutes', '50');
      await expect(page.locator(planStart)).toHaveAttribute('data-mode', 'session');

      // THE BUTTON'S OWN WORDS. It is the only control that commits the learner, so it must state
      // which mode it commits them to and how long for — data-mode is a hook, this is the promise —
      // and its subtitle must quote the graded-spot count the plan actually assembled (19 at 50 min
      // with 4 probes owed), because that number is what the learner is agreeing to sit through.
      const title50 = (await page.textContent(`${planStart} .session-card-title`)) ?? '';
      const meta50 = (await page.textContent(`${planStart} .session-card-meta`)) ?? '';
      expect(title50, `the start button reads "${title50}"`).toBe('Start 50-minute session');
      expect(
        meta50,
        `the start button promises "${meta50}" for a plan that assembled 19 graded spots`,
      ).toBe('19 graded spots, sit down at the table');
      expect(byKind(await readIngredients(page)).get('graded-spots')?.units).toBe(19);

      await page.click(planStart);
      await page.waitForSelector(tableScreen);
      await expect(page.locator('[data-testid="hero-cards"] [data-testid="card"]')).toHaveCount(2);
    });
  });
});

test.describe('S2 — the degradation order is visible', () => {
  test('5. the 30-minute plan names what it gave up, and names whole-task first', async () => {
    await withPlanner(async ({ page }) => {
      await queueProbes(page, 4);
      await selectLength(page, 30);
      await expect(page.locator(planner)).toHaveAttribute('data-cut-count', '1');

      const cuts = await readCuts(page);
      expect(cuts.length, 'a 30-minute session records exactly one cut').toBe(1);
      // Named, numbered and signed on the cut row itself: "whole-task live hands  −4.25 min".
      expectCutReads(cuts[0], 'whole-task', 4.25);

      // The cut is attributed to the ingredient it came out of, on that ingredient's own row.
      const rows = await readIngredients(page);
      const whole = byKind(rows).get('whole-task');
      expect(whole?.why, 'the cut whole-task row does not say it was cut').toContain('cut 4.25 min');
      expect(whole?.why).toContain('step 1 of 3');

      // AND ON NO OTHER ROW. One cut happened, so exactly one row may claim to have been cut;
      // without this, the attribution map can blame the loss on a block that kept all its minutes.
      const blaming = rows.filter((row) => row.why.includes('cut '));
      expect(
        blaming.map((row) => row.kind),
        'a row that was not cut says it was cut',
      ).toEqual(['whole-task']);
    });
  });

  test('6. two cuts are listed in CUT_ORDER, not in the order they were found', async () => {
    /*
     * ASSERTED IN FREE-ROAM AT 15 MINUTES, and the choice matters. A 30-minute session records
     * exactly ONE cut, so an ordering assertion there is blind — reversing the list would leave it
     * green, because reversing a one-element list is a no-op. Free-roam at 15 is the shortest
     * sitting the app offers that cuts TWICE (whole-task then graded spot count), so it is the only
     * place on this screen where the ORDER is observable at all.
     */
    await withPlanner(async ({ page }) => {
      await selectLength(page, 15);
      await selectMode(page, 'free-roam');
      await expect(page.locator(planner)).toHaveAttribute('data-status', 'planned');

      const cuts = await readCuts(page);
      expect(cuts.length, '15-minute free-roam must cut twice for this test to mean anything').toBe(
        2,
      );
      expect(cuts.map((cut) => cut.target)).toEqual(['whole-task', 'graded-spot-count']);

      const positions = cuts.map((cut) => CUT_ORDER.indexOf(cut.target as (typeof CUT_ORDER)[number]));
      expect(positions, 'cuts are not shown in CUT_ORDER').toEqual(
        [...positions].sort((a, b) => a - b),
      );
      for (const cut of cuts) {
        expect(cut.minutes, `${cut.target} was shown as a cut of zero minutes`).toBeGreaterThan(0);
      }

      // WHAT THE LEARNER READS, both rows: 2 of the 2.1 whole-task minutes go, then 2 spots' worth
      // of the graded block (2.5 min). The names come from S2's own vocabulary, so a row that
      // reads "MUTANT −11.75 min" or drops the minus sign fails here rather than in the eyeball.
      // (2.5 rather than 3.75 since free-roam stopped assembling a scoreboard: S2a forbids one, and
      // the 2 minutes it used to take are 2 minutes the graded block no longer has to give up.)
      expectCutReads(cuts[0], 'whole-task', 2);
      expectCutReads(cuts[1], 'graded-spot-count', 2.5);

      // AND EACH LOSS IS BLAMED ON THE BLOCK IT CAME OUT OF. This is the only configuration where the
      // graded-spot cut is visible at all, so it is the only place the graded row can be checked to
      // own its own loss — blame it on the scoreboard instead and every other test still passes.
      const rows = await readIngredients(page);
      expect(
        rows.filter((row) => row.why.includes('cut ')).map((row) => `${row.kind}: ${row.why}`),
        'the two cuts are not attributed to whole-task and graded-spots',
      ).toEqual([
        'graded-spots: cut 2.5 min — step 3 of 3 in the cut order',
        'whole-task: cut 2 min — step 1 of 3 in the cut order',
      ]);
    });
  });

  test('7. the order itself and the protected blocks are printed, not left to be inferred', async () => {
    await withPlanner(async ({ page }) => {
      const order = (await page.textContent(cutOrder)) ?? '';
      const positions = [
        order.indexOf('whole-task'),
        order.indexOf('warm-up length'),
        order.indexOf('graded spot count'),
      ];
      for (const [index, at] of positions.entries()) {
        expect(at, `cut target ${index + 1} is missing from the printed order`).toBeGreaterThan(-1);
      }
      expect(positions, 'the printed cut order is not S2 order').toEqual(
        [...positions].sort((a, b) => a - b),
      );

      // The printed order, in full: S2's three steps in S2's words with the arrows between them.
      expect(
        order,
        `the printed cut order reads "${order}" rather than S2's three steps in S2's words`,
      ).toBe('Cut order: whole-task live hands → warm-up length → graded spot count.');

      /*
       * S2 AND S2b'S CENTRAL PROHIBITION, PINNED AS A WHOLE SENTENCE — deliberately not as three
       * noun greps plus a banned-verb list. The three nouns being present says nothing about what the
       * panel claims about them: 'Always cut: decay probes, ...' contains all three and inverts the
       * rule, and so does any reword a denylist did not anticipate. What the learner must be able to
       * read off this line is that these three are the ones the cut order may never reach, so that is
       * what is asserted: the exact string, which fails on ANY change to it and sends whoever
       * reworded it here to decide whether the new wording still forbids cutting.
       */
      const never = (await page.textContent(cutProtected)) ?? '';
      expect(
        never,
        `the protected-blocks note reads "${never}" — it must state that the cut order NEVER reaches the decay probes, the last contrast set or the first warm-up block`,
      ).toBe('Never cut: decay probes, the last contrast set, the first warm-up block.');
    });
  });

  test('8. probes and remediation survive both session lengths', async () => {
    await withPlanner(async ({ page }) => {
      await queueProbes(page, 4);
      for (const minutes of [30, 50]) {
        await selectLength(page, minutes);
        const at = byKind(await readIngredients(page));
        expect(
          at.get('decay-probes')?.minutes ?? 0,
          `${minutes} minutes dropped the decay probes`,
        ).toBeGreaterThan(0);
        expect(
          at.get('contrast-remediation')?.units ?? 0,
          `${minutes} minutes dropped remediation below one contrast set`,
        ).toBeGreaterThanOrEqual(1);
        // S2b: one warm-up block is a floor, so it is present at both lengths.
        expect(at.get('warm-up')?.units ?? 0, `${minutes} minutes has no warm-up`).toBe(1);
      }
    });
  });
});

test.describe('S2a — there is no 15-minute session', () => {
  test('9. asking for one is refused, with core’s own reason on screen', async () => {
    await withPlanner(async ({ page }) => {
      await selectLength(page, 15);
      await expect(page.locator(planner)).toHaveAttribute('data-status', 'refused');
      await expect(page.locator(refusal)).toBeVisible();

      // No plan is offered alongside the refusal: a refusal with a plan under it is not a refusal.
      await expect(page.locator('[data-testid="planner-plan"]')).toHaveCount(0);
      await expect(page.locator(planStart)).toHaveCount(0);

      // THE HEADLINE IS THE REFUSAL. A panel that says "There is a 15-minute session" over a body
      // explaining why there is not one has inverted S2a where the learner reads fastest, so the
      // sentence is pinned rather than the fact that a title element exists.
      const refusalTitle = (await page.textContent(`${refusal} .refusal-title`)) ?? '';
      expect(
        refusalTitle,
        `the refusal is headed "${refusalTitle}", which does not refuse a 15-minute session`,
      ).toBe('There is no 15-minute session');

      const reason = (await page.textContent(refusalReason)) ?? '';
      // The refusal must name the real obstacle — the interleaving floor — and the route out.
      expect(reason, `refusal reason was "${reason}"`).toMatch(/graded spots/);
      expect(reason).toMatch(/free-roam/);

      // The route out must offer the SAME sitting the learner asked for. "Practise free-roam for
      // 60 min instead" is not a route out of a 15-minute evening, it is a different offer, and
      // data-testid alone cannot tell the two apart.
      const routeLabel = (await page.textContent(refusalRoute)) ?? '';
      expect(
        routeLabel,
        `the route out offers "${routeLabel}" to a learner who has 15 minutes`,
      ).toBe('Practise free-roam for 15 min instead');
      await shot(page, 'session-plan-refusal');
    });
  });

  test('10. the refusal routes into free-roam, which fits the same sitting', async () => {
    // N1: a refusal with no alternative is a locked door. Taking the route must produce real work.
    await withPlanner(async ({ page }) => {
      await selectLength(page, 15);
      await expect(page.locator(planner)).toHaveAttribute('data-status', 'refused');

      await page.click(refusalRoute);
      await expect(page.locator(planner)).toHaveAttribute('data-mode', 'free-roam');
      await expect(page.locator(planner)).toHaveAttribute('data-status', 'planned');
      // Still a 15-minute sitting: the route changes the mode, never the time the learner has.
      await expect(page.locator(planner)).toHaveAttribute('data-minutes', '15');
      await expect(page.locator(planner)).toHaveAttribute('data-total', '14');

      const rows = await readIngredients(page);
      expect(byKind(rows).get('graded-spots')?.units, 'free-roam at 15 min assembled no spots').toBe(
        8,
      );
      /*
       * The 8 spots and their 10 minutes, as printed. Q1's interleaving floor is 7 classes, so the
       * count on screen is the claim that the sitting is real practice rather than a warm-up.
       *
       * 8 rather than 7 because free-roam no longer assembles a scoreboard S2a forbids: those 2
       * minutes go where every other freed minute goes, into graded spots. The floor assertion above
       * is what matters here and it is unchanged — this sitting still clears 7.
       */
      expectRowReads(rows, 'graded-spots', 10, 8);

      await expect(page.locator(planStart)).toBeVisible();
      await expect(page.locator(planStart)).toHaveAttribute('data-mode', 'free-roam');
      // AND THE BUTTON CALLS IT WHAT IT IS. S2a's whole point is that a 15-minute sitting is practice,
      // not a session; a button reading "Start 15-minute session" here reinstates the thing refused
      // two clicks ago, and data-mode="free-roam" beside it would still be true.
      const title15 = (await page.textContent(`${planStart} .session-card-title`)) ?? '';
      const meta15 = (await page.textContent(`${planStart} .session-card-meta`)) ?? '';
      expect(
        title15,
        `the button reads "${title15}" for the 15-minute sitting S2a refuses to call a session`,
      ).toBe('Start 15-minute free-roam sitting');
      expect(
        meta15,
        `the button promises "${meta15}" for a plan that assembled 8 graded spots`,
      ).toBe('8 graded spots, sit down at the table');
    });
  });

  test('11. the floor is the interleaving requirement, so 30 assembles and 15 does not', async () => {
    // NOT "anything under 30 refuses": the real floor is 22.75 min, and SESSION_LENGTHS is what the
    // UI offers rather than an engine invariant. What this screen can honestly assert is that of the
    // lengths it OFFERS, 15 is the one refused and both session lengths assemble.
    await withPlanner(async ({ page }) => {
      await queueProbes(page, 4);
      const statuses: Record<number, string | null> = {};
      for (const minutes of [15, 30, 50]) {
        await selectLength(page, minutes);
        statuses[minutes] = await page.getAttribute(planner, 'data-status');
      }
      expect(statuses).toEqual({ 15: 'refused', 30: 'planned', 50: 'planned' });
    });
  });
});

test.describe('S3 — free-roam is first-class', () => {
  test('12. free-roam fires no probes and says why, rather than looking broken', async () => {
    await withPlanner(async ({ page }) => {
      await queueProbes(page, 4);
      await selectMode(page, 'free-roam');
      await expect(page.locator(planner)).toHaveAttribute('data-status', 'planned');
      // Four probes ARE owed — the queue says so — and free-roam still fires none.
      await expect(page.locator(planner)).toHaveAttribute('data-due-probes', '4');

      const rows = await readIngredients(page);
      expect(rows.map((r) => r.kind), 'free-roam hid an ingredient instead of zeroing it').toEqual([
        ...BLOCK_KINDS,
      ]);
      // Every row's label, share, minutes and count agree with its own numbers, in free-roam too.
      expectRowsSelfConsistent(rows);

      const at = byKind(rows);
      expect(at.get('decay-probes')).toMatchObject({ minutes: 0, units: 0, skipped: true });
      expect(at.get('decay-probes')?.why, 'the empty probe row does not explain itself').toMatch(
        /never fire outside a session/,
      );

      /*
       * THE NOTE THAT KEEPS THE ZERO HONEST, pinned whole. Its job is to say the two things a learner
       * would otherwise get wrong: that this is practice rather than a session, and that BECAUSE no
       * probes fired nothing here measures retention. Inverted — "Free-roam is a session: decay
       * probes fire, so this measures retention" — the panel would credit the learner with a
       * retention measurement it did not take, next to a probe row reading 0 probes.
       */
      await expect(page.locator(freeRoamNote)).toBeVisible();
      const note = (await page.textContent(freeRoamNote)) ?? '';
      expect(
        note,
        `the free-roam note reads "${note}" — it must say this is practice rather than a session and that no probes fired, so nothing here measures retention`,
      ).toBe(
        'Free-roam is practice, not a session: no decay probes fire, so nothing here measures retention.',
      );

      // And it is still real practice: the freed probe and remediation minutes become spots.
      expect(at.get('graded-spots')?.units ?? 0).toBeGreaterThan(11);
      await shot(page, 'session-plan-free-roam');
    });
  });

  test('13. remediation is deferred, not skipped, and the screen distinguishes the two', async () => {
    await withPlanner(async ({ page }) => {
      await selectMode(page, 'free-roam');
      await expect(page.locator(planner)).toHaveAttribute('data-deferred', 'true');
      await expect(page.locator(deferredNote)).toBeVisible();
      // Deferred vs skipped is the distinction S3 turns on, so the sentence that draws it is pinned
      // whole rather than grepped for the two words: what the learner must be able to read is that
      // the repair is STILL OWED and lands in the next session, which "deferred" alone does not say.
      const deferred = (await page.textContent(deferredNote)) ?? '';
      expect(
        deferred,
        `the deferral note reads "${deferred}" — it must say the repair is deferred to the next session and still owed, not skipped`,
      ).toBe('Remediation is deferred to your next session, not skipped — the repair is still owed.');

      const at = byKind(await readIngredients(page));
      expect(at.get('contrast-remediation')).toMatchObject({ minutes: 0, units: 0 });
      expect(at.get('contrast-remediation')?.why).toMatch(/deferred/i);

      // A session is the other half of the claim: nothing is deferred there, so the note is gone.
      await selectMode(page, 'session');
      await expect(page.locator(planner)).toHaveAttribute('data-deferred', 'false');
      await expect(page.locator(deferredNote)).toHaveCount(0);
      await expect(page.locator(freeRoamNote)).toHaveCount(0);
    });
  });
});

test.describe('the empty spacing queue', () => {
  test('14. with nothing due the probe block is absent and the time becomes SPOTS', async () => {
    /*
     * The first-three-weeks edge case, and it is measured in spots rather than minutes on purpose:
     * 3 freed probe minutes buy 2 whole graded spots (2.5 min) and the 0.5 min remainder is
     * deliberately unspent, so a minutes comparison reads 27.25 vs 27.75 and looks like a shorter
     * sitting. Spot count is the quantity the reallocation is denominated in.
     */
    await withPlanner(async ({ page }) => {
      // A fresh profile owes nothing: no stub, no queue.
      await expect(page.locator(planner)).toHaveAttribute('data-due-probes', '0');
      await selectLength(page, 30);

      const emptyRows = await readIngredients(page);
      const empty = byKind(emptyRows);
      expect(empty.get('decay-probes')).toMatchObject({ minutes: 0, units: 0, skipped: true });
      expect(empty.get('decay-probes')?.why, 'an empty probe row with no explanation').toMatch(
        /nothing is due/i,
      );
      // 0 probes and 13 spots, as PRINTED. "0 probes" is the row that has to read as a deliberate
      // zero rather than a missing measurement, and 13 is the count the freed minutes bought.
      expectRowReads(emptyRows, 'decay-probes', 0, 0);
      expectRowReads(emptyRows, 'graded-spots', 16.25, 13);

      await queueProbes(page, 4);
      await selectLength(page, 30);
      const owedRows = await readIngredients(page);
      const owed = byKind(owedRows);
      expect(owed.get('decay-probes')).toMatchObject({ minutes: 3, units: 4 });
      expectRowReads(owedRows, 'decay-probes', 3, 4);
      expectRowReads(owedRows, 'graded-spots', 13.75, 11);

      // 13 spots against 11: every probe not owed is time back, in the unit the block is counted in.
      expect(
        (empty.get('graded-spots')?.units ?? 0) - (owed.get('graded-spots')?.units ?? 0),
        'the freed probe minutes did not become graded spots',
      ).toBe(2);
      // And the difference is legible on the screen itself, not only in the attributes this test read.
      expect(
        [empty.get('graded-spots')?.unitsText, owed.get('graded-spots')?.unitsText],
        'the reallocation is invisible in the printed spot counts',
      ).toEqual(['13 spots', '11 spots']);
    });
  });

  test('15a. a queue of concepts that owe nothing fires no probes', async () => {
    /*
     * The difference between "how many concepts exist" and "how many are DUE". Four concepts are in
     * the queue and every one of them had its rep today, so schedule.ts owes nothing — a panel
     * counting the queue instead of asking dueNow() would fire four probes at a learner who is
     * up to date, which is the fabricated measurement the spec's probe rule exists to forbid.
     */
    await withPlanner(async ({ page }) => {
      await seedQueue(page, 4, 'current');
      await expect(page.locator(planner)).toHaveAttribute('data-due-probes', '0');
      await selectLength(page, 30);

      const rows = await readIngredients(page);
      expect(byKind(rows).get('decay-probes')).toMatchObject({
        minutes: 0,
        units: 0,
        skipped: true,
      });
      expectRowReads(rows, 'decay-probes', 0, 0);
      expectRowReads(rows, 'graded-spots', 16.25, 13);
    });
  });

  test('15b. a partial queue fires only the probes that are owed', async () => {
    await withPlanner(async ({ page }) => {
      await queueProbes(page, 2);
      await selectLength(page, 30);
      const rows = await readIngredients(page);
      // "fixed count 4, or fewer if none due" — a probe with nothing to probe is a fabricated
      // measurement, so two owed means two fired, not four. And the row must PRINT "2 probes":
      // a screen that shows the spec's fixed 4 next to a plan that fired 2 has invented two
      // retention measurements, which is exactly what the "or fewer" clause exists to prevent.
      expect(byKind(rows).get('decay-probes')).toMatchObject({ minutes: 1.5, units: 2 });
      expectRowReads(rows, 'decay-probes', 1.5, 2);
      expectRowReads(rows, 'graded-spots', 15, 12);

      // The singular/plural of every atom noun is exercised across this file's cases; here the
      // one-unit rows prove the count and its noun are rendered from the same number.
      expect(byKind(rows).get('contrast-remediation')?.unitsText).toBe('1 contrast set');
      expect(byKind(rows).get('warm-up')?.unitsText).toBe('1 block');
    });
  });
});

test.describe('the planner shares home without breaking it', () => {
  test('16. home still launches a hand the old way, and nothing renders NaN', async () => {
    await withPlanner(async ({ page }) => {
      const text = (await page.innerText(homeScreen)) ?? '';
      expect(text).not.toMatch(/NaN|undefined|null/);

      // The pre-existing launcher is untouched: 39 e2e assertions drive it.
      await page.click('[data-testid="new-hand"]');
      await page.waitForSelector(tableScreen);
    });
  });

  test('17. home fits both documented sizes with the planner on it', async () => {
    await withPlanner(async ({ app, page }) => {
      await queueProbes(page, 4);
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
          const plannerEl = document.querySelector('[data-testid="session-planner"]');
          const launcher = document.querySelector('[data-testid="new-hand"]');
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight,
            planner: box('[data-testid="session-planner"]'),
            start: box('[data-testid="plan-start"]'),
            overlaps: (() => {
              if (plannerEl === null || launcher === null) return true;
              const p = plannerEl.getBoundingClientRect();
              const q = launcher.getBoundingClientRect();
              return (
                p.right > q.left + 1 &&
                q.right > p.left + 1 &&
                p.bottom > q.top + 1 &&
                q.bottom > p.top + 1
              );
            })(),
          };
        });

        const at = `${width}x${height}`;
        expect(geo.innerWidth, `${at}: viewport width`).toBe(width);
        expect(
          geo.scrollHeight,
          `${at}: home is ${geo.scrollHeight}px tall in a ${height}px viewport — the planner grew a page scrollbar`,
        ).toBeLessThanOrEqual(height + 1);
        expect(
          geo.scrollWidth,
          `${at}: home is ${geo.scrollWidth}px wide in a ${width}px viewport`,
        ).toBeLessThanOrEqual(width + 1);

        expect(geo.overlaps, `${at}: the planner overlaps the launcher`).toBe(false);

        // The one button must be reachable without scrolling anything: it is what starts the sitting.
        expect(geo.start, `${at}: no start button`).not.toBeNull();
        expect(geo.start?.bottom ?? Infinity, `${at}: the start button is below the fold`).toBeLessThanOrEqual(
          height,
        );
        expect(geo.start?.top ?? -1, `${at}: the start button is above the viewport`).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
