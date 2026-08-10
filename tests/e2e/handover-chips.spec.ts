import { expect, test, type Page } from '@playwright/test';
import { launchApp, sel, shot } from './helpers.js';
import { CHIPS_IN_PLAY, tableScreen, waitForIdle } from './flow.js';

/**
 * HANDOVER — the settled table must not display the same chips twice.
 *
 * The defect this guards: `settle()` moves every chip into a stack and sets `pot = 0`, but on the
 * fold-out path it never clears `seat.committed`. `applyAction` short-circuits to
 * `street = 'showdown'` the moment one player is left, skipping the `advanceStreet()` that zeroes
 * committed, so the winner's whole wager was still rendered as a yellow blind-chip pill under
 * their pod while "Pot 0" sat in the middle and their stack already included it.
 *
 * Measured before the fix (seed 42, hero shoves hand 1 then hand 2, all villains fold):
 *   stacks 15050/0/0/4950 · Pot 0 · pills 15000/0/0/50 · "You wins 15050"
 * i.e. 15050 chips shown on screen twice over — as stack AND as chips still out in front. The
 * suite's conservation checks are stacks+pot only (flow.ts chipTotal), so they read 20000 and
 * passed all the way through.
 *
 * The oracle here is deliberately stronger than "pills are empty": stacks + pills must equal the
 * chips in play, which is the same invariant flow.ts applies to stacks + pot. A settled hand has
 * pot 0, so any non-zero pill total is double-counted money.
 */

const HERO_SEAT = '[data-testid="seat"][data-seat-id="0"]';
const winnerSummary = '[data-testid="winner-summary"]';
const nextHand = '[data-testid="next-hand"]';

interface Handover {
  pot: number;
  stacks: number[];
  /** Per-seat blind-chip pills; the pod omits the element entirely at 0. */
  pills: number[];
  summary: string | null;
  awaiting: string | null;
}

/** One evaluate call, so the pot, the stacks and the pills all describe the same render. */
async function readHandover(page: Page): Promise<Handover> {
  return page.evaluate(() => {
    const seats = [...document.querySelectorAll<HTMLElement>('[data-testid="seat"]')];
    const potText = document.querySelector('[data-testid="pot"]')?.textContent ?? '';
    const root = document.querySelector('[data-testid="table-screen"]');
    return {
      pot: Number(potText.replace(/[^0-9-]/g, '')),
      stacks: seats.map((s) =>
        Number(s.querySelector('[data-testid="seat-stack"]')?.textContent ?? 'NaN'),
      ),
      pills: seats.map((s) => {
        const el = s.querySelector('[data-testid="seat-committed"]');
        return el === null ? 0 : Number(el.textContent);
      }),
      summary: document.querySelector('[data-testid="winner-summary"]')?.textContent ?? null,
      awaiting: root instanceof HTMLElement ? (root.dataset.awaiting ?? null) : null,
    };
  });
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/** Shove whenever the raise control is live, else take the cheapest legal action. */
async function heroActs(page: Page): Promise<void> {
  const allin = page.locator('[data-testid="preset-allin"]');
  const raise = page.locator(sel.btnRaise);
  if ((await allin.isEnabled()) && (await raise.isEnabled())) {
    await allin.click();
    await raise.click();
    return;
  }
  for (const button of [page.locator(sel.btnCheck), page.locator(sel.btnCall), page.locator(sel.btnFold)]) {
    if (await button.isEnabled()) {
      await button.click();
      return;
    }
  }
  throw new Error('hero turn with no enabled action button');
}

/** Play one hand out with the hero shoving, and return the settled render. */
async function playHand(page: Page): Promise<Handover> {
  for (let i = 0; i < 20; i++) {
    if ((await waitForIdle(page)) === 'handover') return readHandover(page);
    await heroActs(page);
  }
  throw new Error('hand did not settle within 20 hero actions');
}

function expectNoDoubleCountedChips(reading: Handover, label: string): void {
  const pills = sum(reading.pills);
  expect(reading.awaiting, `${label}: not at handover`).toBe('handover');
  expect(reading.summary, `${label}: no winner summary`).toMatch(/wins \d+/);
  // A settled pot is fully distributed, so the stacks alone must hold every chip...
  expect(sum(reading.stacks), `${label}: stacks do not hold every chip`).toBe(CHIPS_IN_PLAY);
  expect(reading.pot, `${label}: a settled pot must be empty`).toBe(0);
  // ...which means any chips still rendered out in front of a seat are on screen twice.
  expect(
    pills,
    `${label}: ${pills} chips are shown as blind-chip pills (${reading.pills.join('/')}) while the same chips are already inside stacks (${reading.stacks.join('/')}) and the pot reads ${reading.pot}`,
  ).toBe(0);
}

test.describe('handover shows every chip exactly once', () => {
  /**
   * Seed 42: hand 1 is a 3-way all-in showdown the hero wins (villains 1 and 2 bust to 0), so on
   * hand 2 only Cy has chips and folds out to the hero's shove — the fold-out settle path, with a
   * 15000 wager left in `seat.committed`.
   */
  test('no chips are rendered twice when the hand is won by a fold-out', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await page.locator(sel.newHand).click();
      await page.locator(tableScreen).waitFor();

      const showdownHand = await playHand(page);
      expectNoDoubleCountedChips(showdownHand, 'hand 1 (contested showdown)');

      await page.locator(nextHand).click();
      const foldOutHand = await playHand(page);
      // Guard the scenario itself: this must be the fold-out path, not another showdown.
      expect(foldOutHand.summary, 'hand 2 was expected to end by a fold-out').toContain(
        'Last player standing',
      );
      expectNoDoubleCountedChips(foldOutHand, 'hand 2 (won by a fold-out)');

      await shot(page, 'handover-chips-fold-out');
    } finally {
      await close();
    }
  });

  /** The same invariant for the hero's own pod, on the hand where the hero folds and a villain wins. */
  test('a folded hero leaves no chips out in front once the hand settles', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await page.locator(sel.newHand).click();
      await page.locator(tableScreen).waitFor();
      expect(await waitForIdle(page)).toBe('hero');

      await page.locator(sel.btnCall).click();
      expect(await waitForIdle(page)).toBe('hero');
      await page.locator(sel.btnFold).click();
      await expect(page.locator(HERO_SEAT)).toHaveAttribute('data-folded', 'true');

      expect(await waitForIdle(page)).toBe('handover');
      await expect(page.locator(winnerSummary)).toBeVisible();
      expectNoDoubleCountedChips(await readHandover(page), 'hero folded, villain wins');
    } finally {
      await close();
    }
  });
});
