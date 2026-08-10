import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, shot } from './helpers.js';
import { WAVES } from '../../src/core/schedule.js';

/**
 * THE SPACING QUEUE — PRODUCT-SPEC Q4 and Q5, over src/core/schedule.ts.
 *
 * Two things make this file testable at all:
 *
 * DETERMINISM WITHOUT WAITING. schedule.ts takes `now` as a parameter on every function, and the
 * screen threads it through from `window.__offsuitSpacing`. So a 45-day timeline is pinned by
 * handing the screen an instant and a set of concept records — no clock faking, no sleeping, and
 * nothing in this file waits on a timer. Every wait is on data-* published by the screen's paint.
 *
 * FLAT GAPS ARE ASSERTED, NOT ASSUMED. The Q4 failure mode is an expanding 1/2/4/8/16 ladder, and a
 * test that only read the shipped wave days would keep passing if the guard rotted. So this file
 * checks three separable things: the shipped gaps, the guard's refusal of the forbidden ladder, and
 * the per-concept gap after each successive decay-probe miss — 7 then 7, which is the one an
 * expanding scheduler would render as 7 then 14.
 */

const spacingTab = '[data-testid="tab-spacing"]';
const spacingScreen = '[data-testid="spacing-screen"]';
const waveRow = '[data-testid="wave-row"]';
const flatCheck = '[data-testid="flat-gap-check"]';
const expandingCheck = '[data-testid="expanding-check"]';
const dueRow = '[data-testid="due-row"]';
const dueEmpty = '[data-testid="due-empty"]';
const conceptRow = '[data-testid="concept-row"]';
const conceptEmpty = '[data-testid="concept-empty"]';
const probeMiss = '[data-testid="probe-miss"]';
const missOutcome = '[data-testid="miss-outcome"]';
const missGapHistory = '[data-testid="miss-gap-history"]';
const embeddingNote = '[data-testid="spacing-embedding-note"]';

/** SPEC.md's documented window: "1100x760, non-resizable-min 900x640". */
const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 760;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 640;

const MS_PER_DAY = 86_400_000;
/** An arbitrary fixed epoch, mirroring tests/unit/schedule.test.ts so failures read the same way. */
const T0 = 1_700_000_000_000;

interface OpportunityFixture {
  at: number;
  correct: boolean;
}

interface ConceptFixture {
  id: string;
  firstSeen: number;
  opportunities: OpportunityFixture[];
  probeMisses: number;
}

const day = (n: number): number => T0 + n * MS_PER_DAY;
const at = (n: number, correct: boolean): OpportunityFixture => ({ at: day(n), correct });

async function withApp(
  body: (ctx: { app: ElectronApplication; page: Page }) => Promise<void>,
): Promise<void> {
  const { app, page, close } = await launchApp({ seed: 42 });
  try {
    await body({ app, page });
  } finally {
    await close().catch(() => {});
  }
}

/**
 * Hand the screen its instant and its ledger, then open the tab. The seam is read at render time, so
 * it must be installed before the click; `Object.assign` because the global is declared readonly.
 */
async function openSpacing(
  page: Page,
  input: { now: number; concepts: ConceptFixture[] },
): Promise<void> {
  await page.evaluate((seam: { now: number; concepts: ConceptFixture[] }) => {
    Object.assign(window, { __offsuitSpacing: seam });
  }, input);
  await page.locator(spacingTab).click();
  await page.locator(spacingScreen).waitFor();
  await expect(page.locator(spacingScreen)).toHaveAttribute('data-now', String(input.now));
}

/** Click a concept's probe-miss button and block until the screen has counted the new miss. */
async function recordMiss(page: Page, conceptId: string): Promise<void> {
  const before = Number(await page.getAttribute(spacingScreen, 'data-misses-recorded'));
  await page.locator(`${probeMiss}[data-concept="${conceptId}"]`).click();
  await expect(page.locator(spacingScreen)).toHaveAttribute(
    'data-misses-recorded',
    String(before + 1),
  );
}

/** The wave ladder as the screen published it: day, reps, mode and the gap to the wave before. */
async function readLadder(
  page: Page,
): Promise<{ day: number; reps: number; mode: string; gap: string }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="wave-row"]')].map((row) => ({
      day: Number(row.dataset.day),
      reps: Number(row.dataset.reps),
      mode: row.dataset.mode ?? '',
      gap: row.dataset.gap ?? '',
    })),
  );
}

async function readDue(
  page: Page,
): Promise<{ concept: string; wave: number; reps: number; mode: string; overdue: number }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="due-row"]')].map((row) => ({
      concept: row.dataset.concept ?? '',
      wave: Number(row.dataset.wave),
      reps: Number(row.dataset.reps),
      mode: row.dataset.mode ?? '',
      overdue: Number(row.dataset.overdue),
    })),
  );
}

/**
 * THE VISIBLE STRINGS, row by row: for each row of `rowTestid`, the text of every labelled cell
 * inside it, keyed by that cell's own testid.
 *
 * Why this exists at all. Every assertion in this file used to read data-* attributes, and a data-*
 * attribute is not what a learner reads. Mutating the renderer so it printed `${wave.reps + 1} reps`
 * beside a correct data-reps, and `7d, 14d` beside a correct data-gaps="7,7" — an EXPANDING schedule
 * on screen, the one thing Q4 forbids — left all 14 tests in this file green. So the numbers below
 * are asserted twice: once as the attribute the screen computes with, and once as the sentence it
 * shows. The two must agree, because a screen that is right in its dataset and wrong in its
 * paragraph is wrong.
 */
async function readRowText(
  page: Page,
  rowTestid: string,
): Promise<Record<string, string>[]> {
  return page.evaluate((testid: string) =>
    [...document.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)].map((row) => {
      const cells: Record<string, string> = {};
      for (const cell of row.querySelectorAll<HTMLElement>('[data-testid]')) {
        const key = cell.dataset.testid;
        if (key !== undefined) cells[key] = (cell.textContent ?? '').trim();
      }
      return cells;
    }),
  rowTestid);
}

/**
 * Resize the real BrowserWindow, then pin the render viewport to the same numbers — the technique
 * layout.spec.ts documents, because a host window manager retiles the window moments after it shows,
 * which makes setSize() alone cosmetic.
 */
async function useViewport(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
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
}

// ---------------------------------------------------------------------------
// Q4 — the schedule, and the flatness of its gaps
// ---------------------------------------------------------------------------

test.describe('Q4 the wave ladder', () => {
  test('1. publishes the spec table: day 0/1/7/21/30 at 10/4/4/3/2 reps, probe last', async () => {
    await withApp(async ({ page }) => {
      await openSpacing(page, { now: day(0), concepts: [] });

      const ladder = await readLadder(page);
      expect(ladder.map((w) => w.day)).toEqual([0, 1, 7, 21, 30]);
      expect(ladder.map((w) => w.reps)).toEqual([10, 4, 4, 3, 2]);
      expect(ladder.map((w) => w.mode)).toEqual([
        'blocked',
        'interleaved',
        'interleaved',
        'interleaved',
        'probe',
      ]);
      await expect(page.locator(waveRow)).toHaveCount(5);

      // AND THE SAME TABLE AS THE LEARNER READS IT. The expected strings are built from core's own
      // WAVES, so this moves with the rule instead of restating it; what it pins is that the printed
      // day, rep count and mode are the ones core holds. A renderer that printed `${wave.reps + 1}
      // reps` beside a correct data-reps passed every attribute assertion above.
      expect(await readRowText(page, 'wave-row')).toEqual(
        WAVES.map((wave) => ({
          'wave-day': `day ${wave.day}`,
          'wave-reps': `${wave.reps} reps`,
          'wave-mode': wave.mode,
          'wave-gap': expect.any(String),
        })),
      );
    });
  });

  test('2. the gaps are flat: none doubles the one before, and 1/2/4/8/16 is refused', async () => {
    await withApp(async ({ page }) => {
      await openSpacing(page, { now: day(0), concepts: [] });

      // The shipped gaps, printed per row. 1, 6, 14, 9 — the day-21 and day-30 waves are the wide
      // ones that carry durable retention, and NONE of them is twice its predecessor.
      const gaps = (await readLadder(page)).map((w) => w.gap);
      expect(gaps).toEqual(['', '1', '6', '14', '9']);
      const numeric = gaps.slice(1).map(Number);
      for (let i = 1; i < numeric.length; i++) {
        expect(
          numeric[i],
          `gap ${numeric[i]} doubles the previous ${numeric[i - 1]} — that is the expanding ladder Q4 forbids`,
        ).not.toBe(numeric[i - 1] * 2);
      }

      // THE PRINTED GAPS, not only the dataset ones. Derived from core's wave days, so the
      // expectation moves with the ladder; the point is that the "+6d" a learner reads is the same 6
      // the data-gap carries. Printing `+${wave.day}d` (0/1/7/21/30 instead of the gaps 1/6/14/9)
      // left every assertion above green, because data-gap stayed correct beside it.
      const printedGaps = (await readRowText(page, 'wave-row')).map((row) => row['wave-gap']);
      expect(printedGaps).toEqual([
        'first exposure',
        ...WAVES.slice(1).map((wave, i) => `+${wave.day - WAVES[i].day}d`),
      ]);

      // The invariant is core's, and the screen reports its verdict rather than restating the rule.
      await expect(page.locator(flatCheck)).toHaveAttribute('data-flat', 'true');
      /*
       * AND IT MUST SAY SO IN WORDS. data-flat alone let the sentence be inverted to "These gaps
       * expand 1/2/4/8/16, doubling each time — the forbidden ladder is what ships" while the
       * attribute stayed 'true' — measured, 14 of 14 green. This file's own header says flat gaps are
       * asserted rather than assumed, and the learner reads the sentence, not the attribute.
       */
      await expect(page.locator(flatCheck), 'the flat-gap verdict is not stated on screen').toHaveText(
        'These gaps are flat: no gap doubles the one before it.',
      );

      // And the guard has teeth: handed the exact ladder the spec names, it refuses it. Without this
      // half, a guard that had quietly stopped throwing would still show "flat" above.
      const expanding = page.locator(expandingCheck);
      await expect(expanding).toHaveAttribute('data-ladder', '1,2,4,8,16');
      await expect(expanding).toHaveAttribute('data-rejected', 'true');
      expect(await expanding.innerText()).toContain('expanding gaps');
    });
  });

  test('3. it is a maintenance readout, not a review session', async () => {
    await withApp(async ({ page }) => {
      await openSpacing(page, { now: day(10), concepts: [stale()] });

      // Q4: "embedded unannounced in the normal queue — never a review session." A page that told the
      // learner to sit down and review would violate the clause the page exists to document, so the
      // vocabulary that would do it must be absent from the whole rendered surface.
      const body = (await page.locator(spacingScreen).innerText()).toLowerCase();
      for (const banned of [
        'review session',
        'time to review',
        'start review',
        'revision session',
        'due today!',
      ]) {
        expect(body, `the queue announces itself with "${banned}"`).not.toContain(banned);
      }

      /**
       * AND THE POSITIVE HALF, because the denylist above is not a guard.
       *
       * Rewriting the note to "Sit down now and work through the concepts listed below — this is your
       * scheduled spacing sitting, and it is unannounced." shipped green past all five banned phrases
       * AND past the `toContain('unannounced')` below: the word was still there, in a sentence that
       * says the opposite of Q4. A denylist only catches vocabulary someone thought of in advance.
       *
       * So the note is pinned as a whole sentence instead. It must make three claims — the work is
       * served inside ordinary practice, it is never gathered into a sitting of its own, and the
       * learner is never told why a spot arrived — and there is no way to reword it into an
       * instruction while still asserting all three.
       */
      const note = await page.locator(embeddingNote).innerText();
      expect(note).toContain('unannounced');
      expect(note, 'the note no longer says the work is served inside ordinary practice').toContain(
        'served inside ordinary practice',
      );
      expect(note, 'the note no longer refuses to assemble a sitting of its own').toContain(
        'never assembled into a sitting of its own',
      );
      expect(
        note,
        'the note no longer promises the learner is not told why a spot arrived',
      ).toContain('never told a spot arrived because it was owed');

      // No button on this surface starts anything: the only control is the diagnostic probe-miss one.
      const buttons = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="spacing-screen"] button')].map(
          (b) => b.dataset.testid ?? '',
        ),
      );
      expect(new Set(buttons)).toEqual(new Set(['probe-miss']));
    });
  });
});

// ---------------------------------------------------------------------------
// The queue itself
// ---------------------------------------------------------------------------

test.describe('the queue', () => {
  test('4. nothing due: the ledger is not empty, and the queue still is', async () => {
    await withApp(async ({ page }) => {
      // One concept, its day-0 wave already done, read on day 0: the day-1 window has not opened, so
      // nothing is owed. The distinction from an empty ledger matters — a screen that showed "nothing
      // due" because it had lost the records would be indistinguishable otherwise.
      await openSpacing(page, {
        now: day(0),
        concepts: [{ id: 'q-quiet', firstSeen: T0, opportunities: [at(0, true)], probeMisses: 0 }],
      });

      await expect(page.locator(spacingScreen)).toHaveAttribute('data-due-count', '0');
      await expect(page.locator(spacingScreen)).toHaveAttribute('data-concept-count', '1');
      await expect(page.locator(dueRow)).toHaveCount(0);
      await expect(page.locator(dueEmpty)).toBeVisible();
      await expect(page.locator(conceptEmpty)).toHaveCount(0);
      await expect(page.locator(`${conceptRow}[data-concept="q-quiet"]`)).toHaveAttribute(
        'data-next-wave',
        '',
      );
      /*
       * AND THE ROW SAYS "nothing owed" rather than naming a wave. With only the attribute asserted,
       * the sentence could read "day 30 wave owed" on a concept that owes nothing — measured green
       * across all 14 tests — which invents a debt the schedule does not hold.
       */
      await expect(
        page.locator(`${conceptRow}[data-concept="q-quiet"] [data-testid="concept-next"]`),
        'a concept owing nothing does not say so',
      ).toHaveText('nothing owed');
    });
  });

  test('5. an empty ledger says so, rather than reading as nothing owed', async () => {
    await withApp(async ({ page }) => {
      await openSpacing(page, { now: day(0), concepts: [] });
      await expect(page.locator(spacingScreen)).toHaveAttribute('data-concept-count', '0');
      await expect(page.locator(conceptEmpty)).toBeVisible();
      await expect(page.locator(conceptRow)).toHaveCount(0);
      // The ladder is still on screen with no concepts: the schedule is a property of the app.
      await expect(page.locator(waveRow)).toHaveCount(5);
    });
  });

  test('6. several concepts due, longest-owed first, each with its wave and rep count', async () => {
    await withApp(async ({ page }) => {
      /**
       * FOUR FIXTURES, AND THE FOURTH IS THE WHOLE POINT.
       *
       * With only a-stale/9, b-mid/4, c-fresh/0 the ids happen to ascend in the same order the
       * overdue days descend, so sorting on id ALONE produces the identical list. Deleting the
       * overdue-first half of core's comparator in dueNow() —
       *   .sort((a, b) => b.overdueDays - a.overdueDays || a.conceptId.localeCompare(b.conceptId))
       *   .sort((a, b) => a.conceptId.localeCompare(b.conceptId))
       * — left all 14 tests here green. A fixture that makes the right answer and the wrong answer
       * the same list is not a test of the ordering.
       *
       * `a-just-opened` breaks the coincidence in both directions at once. Its id sorts FIRST while
       * its 0 overdue days rank it LAST, so:
       *   overdue-then-id (correct): a-stale, b-mid, a-just-opened, c-fresh
       *   id only:                   a-just-opened, a-stale, b-mid, c-fresh   -> different
       * and because it ties c-fresh at 0 overdue days, the id tiebreak is exercised too: dropping
       * `|| localeCompare` leaves those two in input order, which is c-fresh first -> different.
       */
      await openSpacing(page, {
        now: day(10),
        concepts: [fresh(), justOpened(), mid(), stale()],
      });

      await expect(page.locator(spacingScreen)).toHaveAttribute('data-due-count', '4');

      // Ordering is core's — most overdue first, ties broken on id. Passed in deliberately scrambled.
      expect(await readDue(page)).toEqual([
        { concept: 'a-stale', wave: 1, reps: 4, mode: 'interleaved', overdue: 9 },
        { concept: 'b-mid', wave: 1, reps: 4, mode: 'interleaved', overdue: 4 },
        { concept: 'a-just-opened', wave: 0, reps: 10, mode: 'blocked', overdue: 0 },
        { concept: 'c-fresh', wave: 0, reps: 10, mode: 'blocked', overdue: 0 },
      ]);

      // Rank is published so the order can be read off the row rather than off DOM position alone.
      expect(
        await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('[data-testid="due-row"]')].map(
            (r) => `${r.dataset.rank}:${r.dataset.concept}`,
          ),
        ),
      ).toEqual(['0:a-stale', '1:b-mid', '2:a-just-opened', '3:c-fresh']);

      // AND THE QUEUE AS IT READS. The debt a learner sees is the sentence, not data-overdue: the
      // top line must SAY it is 9 days owed, and the concept with no debt must say so in words
      // rather than print "0d owed". Doubling the printed number (`${rep.overdueDays * 2}d owed`)
      // beside a correct data-overdue passed every assertion above.
      expect(await readRowText(page, 'due-row')).toEqual([
        {
          'due-concept': 'a-stale',
          'due-wave': 'day 1 wave',
          'due-reps': '4 reps',
          'due-mode': 'interleaved',
          'due-overdue': '9d owed',
        },
        {
          'due-concept': 'b-mid',
          'due-wave': 'day 1 wave',
          'due-reps': '4 reps',
          'due-mode': 'interleaved',
          'due-overdue': '4d owed',
        },
        {
          'due-concept': 'a-just-opened',
          'due-wave': 'day 0 wave',
          'due-reps': '10 reps',
          'due-mode': 'blocked',
          'due-overdue': 'inside its window',
        },
        {
          'due-concept': 'c-fresh',
          'due-wave': 'day 0 wave',
          'due-reps': '10 reps',
          'due-mode': 'blocked',
          'due-overdue': 'inside its window',
        },
      ]);
    });
  });

  test('7. Q5: a mastered concept is still in the queue', async () => {
    await withApp(async ({ page }) => {
      // A record that clears the gate when read on day 21 and is still owed its day-21 wave. Mastery
      // must not remove it — a mastered concept that vanished from the queue is the Q5 violation.
      await openSpacing(page, { now: day(21), concepts: [mastered()] });

      const row = page.locator(`${conceptRow}[data-concept="z-mastered"]`);
      await expect(row).toHaveAttribute('data-status', 'mastered');
      await expect(row).toHaveAttribute('data-next-wave', '21');
      // The owed branch of the same sentence: the wave it names must be the wave it publishes.
      await expect(
        row.locator('[data-testid="concept-next"]'),
        'the row publishes wave 21 but does not say so',
      ).toHaveText('day 21 wave owed');
      await expect(page.locator(`${dueRow}[data-concept="z-mastered"]`)).toHaveAttribute(
        'data-wave',
        '21',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Q5 — decay-probe misses
// ---------------------------------------------------------------------------

test.describe('Q5 decay-probe misses', () => {
  test('8. one miss reopens the contrast set and resets to a 7-day gap', async () => {
    await withApp(async ({ page }) => {
      await openSpacing(page, { now: day(35), concepts: [probed()] });
      await recordMiss(page, 'p-probed');

      const first = page.locator(`${missOutcome}[data-concept="p-probed"][data-miss="1"]`);
      await expect(first).toHaveAttribute('data-reopen', 'true');
      await expect(first).toHaveAttribute('data-gap-days', '7');
      // One miss is NOT a return to active learning, and carries no opportunity budget.
      await expect(first).toHaveAttribute('data-active-learning', 'false');
      await expect(first).toHaveAttribute('data-remaining', '');
      expect(await first.innerText()).toContain('contrast set reopened');
    });
  });

  test('9. two misses return it to active learning with exactly 6 opportunities', async () => {
    await withApp(async ({ page }) => {
      await openSpacing(page, { now: day(35), concepts: [probed()] });
      await recordMiss(page, 'p-probed');
      await recordMiss(page, 'p-probed');

      await expect(page.locator(`${missOutcome}[data-concept="p-probed"]`)).toHaveCount(2);

      const second = page.locator(`${missOutcome}[data-concept="p-probed"][data-miss="2"]`);
      await expect(second).toHaveAttribute('data-active-learning', 'true');
      await expect(second).toHaveAttribute('data-remaining', '6');
      /*
       * THE NUMBER THE LEARNER READS, not just the one published. Doubling the printed count while
       * leaving data-remaining at 6 passed 14 of 14: the screen said "12 opportunities remaining"
       * beside an attribute reading 6. Q5's budget is the whole point of this row, so both are pinned
       * and they have to agree.
       */
      await expect(
        second,
        'the printed opportunity budget disagrees with data-remaining',
      ).toContainText('6 opportunities remaining');
      await expect(second).toHaveAttribute('data-reopen', 'true');

      // "Not a full reset" is the load-bearing half: the opportunity record survives the second miss.
      // 6 remaining is a budget on top of a kept history, not a cleared one.
      const row = page.locator(`${conceptRow}[data-concept="p-probed"]`);
      await expect(row).toHaveAttribute('data-opportunities', '5');
      await expect(row).toHaveAttribute('data-probe-misses', '2');
      expect(await second.innerText()).toContain('the record is kept, not cleared');
    });
  });

  test('10. the gap after each successive miss is flat: 7 then 7, never 7 then 14', async () => {
    await withApp(async ({ page }) => {
      await openSpacing(page, { now: day(35), concepts: [probed()] });
      await recordMiss(page, 'p-probed');
      await recordMiss(page, 'p-probed');

      // THE Q4 ASSERTION AT CONCEPT LEVEL. Two successive intervals for one concept, and they are
      // equal. An expanding scheduler renders 7,14 here and this is the assertion that tells the two
      // apart — the schedule-wide check above cannot, because it only reads the fixed wave table.
      await expect(page.locator(`${missGapHistory}[data-concept="p-probed"]`)).toHaveAttribute(
        'data-gaps',
        '7,7',
      );

      const gaps = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="miss-outcome"]')].map((el) =>
          Number(el.dataset.gapDays),
        ),
      );
      expect(gaps).toEqual([7, 7]);
      expect(gaps[1], 'the second gap grew — that is an expanding schedule').toBe(gaps[0]);

      // AND THE SENTENCE THE LEARNER READS SAYS 7 TWICE. This is the assertion that catches an
      // expanding schedule on screen: a renderer printing "Gap after each miss: 7d, 14d" beside a
      // correct data-gaps="7,7" satisfied every assertion above, which means the one thing Q4
      // forbids was visible on the page and this file called itself green.
      expect(
        (await page.locator(`${missGapHistory}[data-concept="p-probed"]`).innerText()).trim(),
        'the printed gap history is not two equal 7-day gaps — an expanding schedule is on screen',
      ).toBe('Gap after each miss: 7d, 7d');

      // Per-miss too: both rows must SAY "7-day gap", not merely carry data-gap-days="7".
      expect(
        (await readRowText(page, 'miss-outcome')).map((row) => row['miss-gap']),
      ).toEqual(['7-day gap', '7-day gap']);
    });
  });

  test('11. a third miss does not keep growing the gap either', async () => {
    await withApp(async ({ page }) => {
      // Q5 names one and two misses. Beyond that the reset must stay flat rather than start doubling,
      // which is the shape a "sensible" future edit would reach for.
      await openSpacing(page, { now: day(35), concepts: [probed()] });
      for (let i = 0; i < 3; i++) await recordMiss(page, 'p-probed');

      await expect(page.locator(`${missGapHistory}[data-concept="p-probed"]`)).toHaveAttribute(
        'data-gaps',
        '7,7,7',
      );
      await expect(
        page.locator(`${missOutcome}[data-concept="p-probed"][data-miss="3"]`),
      ).toHaveAttribute('data-remaining', '6');
    });
  });

  test('12. a miss on one concept leaves the others untouched', async () => {
    await withApp(async ({ page }) => {
      await openSpacing(page, { now: day(35), concepts: [probed(), stale()] });
      await recordMiss(page, 'p-probed');

      await expect(page.locator(`${missOutcome}[data-concept="p-probed"]`)).toHaveCount(1);
      await expect(page.locator(`${missOutcome}[data-concept="a-stale"]`)).toHaveCount(0);
      await expect(page.locator(`${conceptRow}[data-concept="a-stale"]`)).toHaveAttribute(
        'data-probe-misses',
        '0',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Layout and hygiene
// ---------------------------------------------------------------------------

test.describe('the surface', () => {
  test('13. fits both documented window sizes without scrolling the document', async () => {
    await withApp(async ({ app, page }) => {
      for (const [width, height] of [
        [DEFAULT_WIDTH, DEFAULT_HEIGHT],
        [MIN_WIDTH, MIN_HEIGHT],
      ]) {
        await useViewport(app, page, width, height);
        await openSpacing(page, { now: day(35), concepts: [probed(), stale(), mastered()] });
        await recordMiss(page, 'p-probed');
        await recordMiss(page, 'p-probed');

        // MEASURE BEFORE SCREENSHOTTING: page.screenshot() drops the device-metrics override.
        const geometry = await page.evaluate(() => {
          const rect = (id: string): { top: number; bottom: number; left: number; right: number } | null => {
            const el = document.querySelector(`[data-testid="${id}"]`);
            if (el === null) return null;
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
          };
          const tabs = [...document.querySelectorAll<HTMLElement>('.tabs .tab')];
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            docScrollHeight: document.documentElement.scrollHeight,
            tabBar: rect('tab-spacing'),
            /**
             * EVERY tab, not only Spacing's. Spacing sits 5th of 12, so a bar that overflows pushes
             * Profile and Settings off the right edge while tab-spacing stays comfortably inside —
             * and `.tabs` is a flex row inside an `overflow-x: hidden` ancestor, so the overflow
             * neither grows scrollHeight nor moves tab-spacing. Nothing measured below would notice.
             */
            tabCount: tabs.length,
            tabsPastRightEdge: tabs
              .map((tab) => ({ label: tab.textContent ?? '', right: tab.getBoundingClientRect().right }))
              .filter((tab) => tab.right > window.innerWidth)
              .map((tab) => `${tab.label}@${tab.right.toFixed(0)}px`),
          };
        });

        expect(geometry.innerWidth).toBe(width);
        expect(geometry.innerHeight).toBe(height);
        expect(
          geometry.docScrollHeight,
          `document is ${geometry.docScrollHeight}px in a ${height}px viewport — the column must scroll, not the page`,
        ).toBeLessThanOrEqual(height + 1);

        const box = geometry.tabBar;
        expect(box, `the Spacing tab is missing at ${width}x${height}`).not.toBeNull();
        if (box === null) continue;
        expect(box.top, 'the tab bar left the top of the viewport').toBeGreaterThanOrEqual(0);
        expect(box.bottom, 'the tab bar fell below the fold').toBeLessThanOrEqual(height);
        expect(box.right, 'the tab bar ran past the right edge').toBeLessThanOrEqual(width);

        // A tab you cannot see is a tab you cannot reach, and that is the failure this file used to
        // be blind to: measuring only tab-spacing (5th of 12) let the bar hang 265px past a 900px
        // viewport with Progress/Profile/Settings unreachable, and test 13 still passed.
        expect(geometry.tabCount, 'the tab bar is empty — nothing to measure').toBeGreaterThan(0);
        expect(
          geometry.tabsPastRightEdge,
          `at ${width}x${height} these tabs hang past the right edge and cannot be clicked: ${geometry.tabsPastRightEdge.join(', ')}`,
        ).toEqual([]);

        await shot(page, `spacing-${width}x${height}`);
      }
    });
  });

  test('14. leaving and returning re-reads the ledger and throws nothing', async () => {
    await withApp(async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));

      await openSpacing(page, { now: day(10), concepts: [stale(), mid(), fresh()] });
      await expect(page.locator(spacingScreen)).toHaveAttribute('data-due-count', '3');

      await page.locator('[data-testid="tab-play"]').click();
      await expect(page.locator(spacingScreen)).toHaveCount(0);

      // A different instant on the way back: the screen must read the seam again rather than keep the
      // queue it computed on the first visit. Day 45 owes the day-30 probe wave, not the day-1 one.
      await openSpacing(page, { now: day(45), concepts: [stale()] });
      expect(await readDue(page)).toEqual([
        { concept: 'a-stale', wave: 1, reps: 4, mode: 'interleaved', overdue: 44 },
      ]);

      // And the in-memory miss log did not survive the remount, which is what "not persisted" means.
      await expect(page.locator(spacingScreen)).toHaveAttribute('data-misses-recorded', '0');
      expect(errors, 'the spacing screen threw').toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// Fixtures. Each is a record a real learner could have; the numbers are checked against
// tests/unit/schedule.test.ts's own arithmetic, not invented here.
// ---------------------------------------------------------------------------

/** Day 0 done and then abandoned: read on day 10 it is 9 days past the day-1 window. */
function stale(): ConceptFixture {
  return { id: 'a-stale', firstSeen: T0, opportunities: [at(0, true)], probeMisses: 0 };
}

/** Opened on day 5, so on day 10 it is 4 days past its day-1 window. */
function mid(): ConceptFixture {
  return {
    id: 'b-mid',
    firstSeen: day(5),
    opportunities: [{ at: day(5), correct: true }],
    probeMisses: 0,
  };
}

/** Opened today with no reps yet: its day-0 block is owed, and owed by nothing. */
function fresh(): ConceptFixture {
  return { id: 'c-fresh', firstSeen: day(10), opportunities: [], probeMisses: 0 };
}

/**
 * Identical in schedule terms to `fresh` — opened today, day-0 block owed, 0 days late — and named
 * so its id sorts FIRST while its debt ranks it LAST. It exists to make overdue-order and id-order
 * two different lists in test 6; with only a-stale/b-mid/c-fresh they are the same list, and an
 * ordering test whose fixture cannot tell the two apart is not testing the ordering.
 */
function justOpened(): ConceptFixture {
  return { id: 'a-just-opened', firstSeen: day(10), opportunities: [], probeMisses: 0 };
}

/**
 * A learner who did the day-0 block and both interleaved waves, with the bulk of the evidence recent
 * enough to survive the decay term. Reads as mastered on day 21 and is still owed its day-21 wave.
 */
function mastered(): ConceptFixture {
  return {
    id: 'z-mastered',
    firstSeen: T0,
    opportunities: [
      at(0, true),
      at(1, true),
      at(7, true),
      ...Array.from({ length: 30 }, () => at(20, true)),
    ],
    probeMisses: 0,
  };
}

/** Through the first four waves and into probe territory: five opportunities, no misses yet. */
function probed(): ConceptFixture {
  return {
    id: 'p-probed',
    firstSeen: T0,
    opportunities: [at(0, true), at(1, true), at(7, true), at(21, true), at(31, true)],
    probeMisses: 0,
  };
}
