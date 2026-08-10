import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, shot } from './helpers.js';

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
 */

const planner = '[data-testid="session-planner"]';
const lengthBtn = '[data-testid="length-btn"]';
const modeBtn = '[data-testid="mode-btn"]';
const ingredientRow = '[data-testid="ingredient-row"]';
const cutRow = '[data-testid="cut-row"]';
const cutNone = '[data-testid="cut-none"]';
const cutOrder = '[data-testid="cut-order"]';
const cutProtected = '[data-testid="cut-protected"]';
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

/** Every ingredient row, in DOM order, read as numbers rather than as text. */
async function readIngredients(page: Page): Promise<Ingredient[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="ingredient-row"]')].map((row) => ({
      kind: row.dataset.kind ?? '',
      minutes: Number(row.dataset.minutes),
      units: Number(row.dataset.units),
      skipped: row.dataset.skipped === 'true',
      why: row.querySelector<HTMLElement>('[data-testid="ingredient-why"]')?.textContent ?? '',
    })),
  );
}

async function readCuts(page: Page): Promise<{ target: string; minutes: number }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="cut-row"]')].map((row) => ({
      target: row.dataset.target ?? '',
      minutes: Number(row.dataset.minutes),
    })),
  );
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

      // S1: default 30.
      await expect(page.locator(planner)).toHaveAttribute('data-minutes', '30');
      expect(lengths.filter((l) => l.active === 'true').map((l) => l.minutes)).toEqual([30]);
      await expect(page.locator(planner)).toHaveAttribute('data-mode', 'session');
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

      const at = byKind(rows);
      expect(at.get('warm-up')).toMatchObject({ minutes: 4, units: 1 });
      expect(at.get('decay-probes')).toMatchObject({ minutes: 3, units: 4 });
      expect(at.get('graded-spots')).toMatchObject({ minutes: 13.75, units: 11 });
      expect(at.get('contrast-remediation')).toMatchObject({ minutes: 5, units: 1 });
      expect(at.get('scoreboard')).toMatchObject({ minutes: 2, units: 1 });
      // S1: whole-task is dropped first below 30 minutes, and the row says so at 0.
      expect(at.get('whole-task')).toMatchObject({ minutes: 0, units: 0, skipped: true });

      // The minutes on screen must add up to the total on screen — a total tracked separately is a
      // total allowed to drift.
      const summed = rows.reduce((sum, row) => sum + row.minutes, 0);
      expect(summed).toBeCloseTo(27.75, 6);

      // "≈11 spots" is the number S2a itself quotes for a 30-minute session.
      expect(at.get('graded-spots')?.units).toBe(11);
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

      const at = byKind(await readIngredients(page));
      expect(at.get('warm-up')).toMatchObject({ minutes: 4, units: 1 });
      expect(at.get('decay-probes')).toMatchObject({ minutes: 3, units: 4 });
      expect(at.get('graded-spots')).toMatchObject({ minutes: 23.75, units: 19 });
      expect(at.get('contrast-remediation')).toMatchObject({ minutes: 10, units: 2 });
      expect(at.get('whole-task')).toMatchObject({ minutes: 7, units: 3 });
      expect(at.get('scoreboard')).toMatchObject({ minutes: 2, units: 1 });

      // Nothing is skipped at the reference length, which is what makes it the reference length.
      for (const row of await readIngredients(page)) {
        expect(row.skipped, `${row.kind} was skipped in a 50-minute session`).toBe(false);
        expect(row.minutes, `${row.kind} has no minutes`).toBeGreaterThan(0);
      }

      await expect(page.locator(cutRow)).toHaveCount(0);
      await expect(page.locator(cutNone)).toBeVisible();
      await shot(page, 'session-plan-50');
    });
  });

  test('4. the start button is the one button, and it seats the learner at a table', async () => {
    await withPlanner(async ({ page }) => {
      await selectLength(page, 50);
      await expect(page.locator(planStart)).toHaveAttribute('data-minutes', '50');
      await expect(page.locator(planStart)).toHaveAttribute('data-mode', 'session');

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
      expect(cuts).toEqual([{ target: 'whole-task', minutes: 4.25 }]);

      // The cut is attributed to the ingredient it came out of, on that ingredient's own row.
      const whole = byKind(await readIngredients(page)).get('whole-task');
      expect(whole?.why, 'the cut whole-task row does not say it was cut').toContain('cut 4.25 min');
      expect(whole?.why).toContain('step 1 of 3');
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

      // S2 and S2b: the three things the order may never reach are named on screen.
      const never = (await page.textContent(cutProtected)) ?? '';
      expect(never).toContain('decay probes');
      expect(never).toContain('contrast set');
      expect(never).toContain('warm-up block');
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

      const reason = (await page.textContent(refusalReason)) ?? '';
      // The refusal must name the real obstacle — the interleaving floor — and the route out.
      expect(reason, `refusal reason was "${reason}"`).toMatch(/graded spots/);
      expect(reason).toMatch(/free-roam/);
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
      await expect(page.locator(planner)).toHaveAttribute('data-total', '14.75');

      const at = byKind(await readIngredients(page));
      expect(at.get('graded-spots')?.units, 'free-roam at 15 minutes assembled no spots').toBe(7);
      await expect(page.locator(planStart)).toBeVisible();
      await expect(page.locator(planStart)).toHaveAttribute('data-mode', 'free-roam');
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

      const at = byKind(rows);
      expect(at.get('decay-probes')).toMatchObject({ minutes: 0, units: 0, skipped: true });
      expect(at.get('decay-probes')?.why, 'the empty probe row does not explain itself').toMatch(
        /never fire outside a session/,
      );
      await expect(page.locator(freeRoamNote)).toBeVisible();

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
      expect((await page.textContent(deferredNote)) ?? '').toMatch(/deferred/i);
      expect((await page.textContent(deferredNote)) ?? '').toMatch(/not skipped/i);

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

      const empty = byKind(await readIngredients(page));
      expect(empty.get('decay-probes')).toMatchObject({ minutes: 0, units: 0, skipped: true });
      expect(empty.get('decay-probes')?.why, 'an empty probe row with no explanation').toMatch(
        /nothing is due/i,
      );
      expect(empty.get('graded-spots')?.units).toBe(13);

      await queueProbes(page, 4);
      await selectLength(page, 30);
      const owed = byKind(await readIngredients(page));
      expect(owed.get('decay-probes')).toMatchObject({ minutes: 3, units: 4 });
      expect(owed.get('graded-spots')?.units).toBe(11);

      // 13 spots against 11: every probe not owed is time back, in the unit the block is counted in.
      expect(
        (empty.get('graded-spots')?.units ?? 0) - (owed.get('graded-spots')?.units ?? 0),
        'the freed probe minutes did not become graded spots',
      ).toBe(2);
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

      const at = byKind(await readIngredients(page));
      expect(at.get('decay-probes')).toMatchObject({ minutes: 0, units: 0, skipped: true });
      expect(at.get('graded-spots')?.units).toBe(13);
    });
  });

  test('15b. a partial queue fires only the probes that are owed', async () => {
    await withPlanner(async ({ page }) => {
      await queueProbes(page, 2);
      await selectLength(page, 30);
      const at = byKind(await readIngredients(page));
      // "fixed count 4, or fewer if none due" — a probe with nothing to probe is a fabricated
      // measurement, so two owed means two fired, not four.
      expect(at.get('decay-probes')).toMatchObject({ minutes: 1.5, units: 2 });
      expect(at.get('graded-spots')?.units).toBe(12);
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
