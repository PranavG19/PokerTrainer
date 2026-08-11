import { expect, test, type Page } from '@playwright/test';
import { launchApp, sel, shot } from './helpers.js';
import { snapshot, tableScreen, waitForIdle } from './flow.js';

/**
 * BUSTED SEATS — "out of the game" must not render as "folded this hand".
 *
 * A villain whose stack reaches 0 sits out every later hand: the engine folds it at startHand and
 * deals it no cards, so it never acts again. The pod used to render at the same 0.4 opacity as a
 * seat that had merely folded the current hand, with no marker of any kind — the only cues were a
 * stack reading 0 and missing hole cards, and BOTH of those also describe a live player who folded
 * face-down. Two permanently different states looked identical.
 *
 * Sync rule: never sleep. The table root publishes data-awaiting on every render (flow.ts).
 *
 * On seed 42 the hero's preflop shove is called and busts at least one villain in hand 1. WHICH
 * seats bust is read from the actual handover rather than pinned to an index, because the villains
 * play their archetype policies (src/renderer/screens/table.ts) — the test needs a busted villain
 * and a live seat to compare, not one exact stack vector. Nothing here mutates the DOM to reach that
 * state: the seats are busted by playing the hand.
 */

const homeScreen = '[data-testid="home-screen"]';
const presetAllin = '[data-testid="preset-allin"]';
const nextHand = '[data-testid="next-hand"]';
const winnerSummary = '[data-testid="winner-summary"]';

/** On seed 42 the hero's shove is called and busts at least one villain in hand 1. */
const SEED_VILLAINS_BUST = 42;
const CHIPS_IN_PLAY = 20_000;

interface SeatReading {
  seatId: number;
  stack: number;
  /** data-out — the semantic "this player is out of the game" marker. */
  out: boolean;
  /** data-folded — "not contesting the current hand", which a busted seat also is. */
  folded: boolean;
  toAct: boolean;
  /** Computed, not declared: a class that never reaches the pod proves nothing. */
  opacity: number;
  borderStyle: string;
  /** Text of the visible out-of-game label, or null when absent. */
  outLabel: string | null;
  cards: number;
  /** Whole pod text, so "says so in words" can be asserted on what a player actually reads. */
  text: string;
}

/** One evaluate call, so every seat in the array describes the same render. */
async function readSeats(page: Page): Promise<SeatReading[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="seat"]')].map((seat) => {
      const style = getComputedStyle(seat);
      return {
        seatId: Number(seat.dataset.seatId),
        stack: Number(seat.querySelector('[data-testid="seat-stack"]')?.textContent ?? 'NaN'),
        out: seat.dataset.out === 'true',
        folded: seat.dataset.folded === 'true',
        toAct: seat.dataset.toAct === 'true',
        opacity: Number(style.opacity),
        borderStyle: style.borderTopStyle,
        outLabel: seat.querySelector('[data-testid="seat-out"]')?.textContent ?? null,
        cards: seat.querySelectorAll('[data-testid="card"]').length,
        text: (seat.textContent ?? '').replace(/\s+/g, ' '),
      };
    }),
  );
}

function seat(seats: SeatReading[], seatId: number): SeatReading {
  const found = seats.find((s) => s.seatId === seatId);
  if (found === undefined) throw new Error(`seat ${seatId} missing from the render`);
  return found;
}

async function sitDown(page: Page): Promise<void> {
  await page.waitForSelector(homeScreen);
  await page.locator(sel.newHand).click();
  await page.locator(tableScreen).waitFor();
  await waitForIdle(page);
}

/**
 * Commit the hero's whole stack preflop; on seed 42 at least one villain calls it and busts.
 * Returns the busted VILLAIN seat ids, read from the actual handover — the villains play their
 * archetypes, so which ones bust is discovered, not pinned. Asserts the scenario the tests need is
 * actually present (a busted villain AND a live villain) and that no chips were created or destroyed.
 */
async function bustVillains(page: Page): Promise<number[]> {
  await sitDown(page);
  await page.locator(presetAllin).click();
  await page.locator(sel.btnRaise).click();
  expect(await waitForIdle(page), 'the shove must run the hand out to handover').toBe('handover');
  const stacks = (await snapshot(page)).stacks;
  expect(
    stacks.reduce((a, b) => a + b, 0),
    'the shove must conserve every chip',
  ).toBe(CHIPS_IN_PLAY);

  const bustedVillains = stacks
    .map((stack, seatId) => ({ stack, seatId }))
    .filter(({ stack, seatId }) => seatId !== 0 && stack === 0)
    .map(({ seatId }) => seatId);
  expect(bustedVillains.length, 'the shove must bust at least one villain to test the marker').toBeGreaterThan(0);
  expect(stacks[0], 'the hero must survive the shove it won').toBeGreaterThan(0);
  expect(
    stacks.some((stack, seatId) => seatId !== 0 && stack > 0),
    'a live villain must remain, or "busted vs live" has nothing to compare',
  ).toBe(true);
  return bustedVillains;
}

/**
 * Deal the hand after the bust. The seats only START sitting out at the next startHand — during the
 * hand that busted them they are still showing the cards they lost with, which is honest.
 */
async function dealNextHand(page: Page): Promise<void> {
  await page.locator(nextHand).click();
  await waitForIdle(page);
}

test.describe('busted seats are marked out of the game', () => {
  test('1. a busted villain carries data-out and says so in words, while a live seat does not', async () => {
    const { page, close } = await launchApp({ seed: SEED_VILLAINS_BUST });
    try {
      const bustedSeats = await bustVillains(page);
      await dealNextHand(page);

      const seats = await readSeats(page);
      const hero = seat(seats, 0);

      for (const seatId of bustedSeats) {
        const busted = seat(seats, seatId);
        expect(busted.stack, `seat ${seatId} stack`).toBe(0);
        expect(busted.cards, `seat ${seatId} is dealt no cards while sitting out`).toBe(0);
        // The semantic marker a test — or a screen reader — can read.
        expect(busted.out, `seat ${seatId} data-out`).toBe(true);
        // And the visible words, so the cue is not opacity (or colour) alone.
        expect(busted.outLabel, `seat ${seatId} out label`).toBe('Out of chips');
        expect(busted.text, `seat ${seatId} pod text`).toContain('Out of chips');
        // Out of the game means never to act again.
        expect(busted.toAct, `seat ${seatId} data-to-act`).toBe(false);
        // Not hidden: the player can still see who busted.
        expect(busted.text, `seat ${seatId} still names the player`).toMatch(/Ada|Bo|Cy/);
        expect(busted.opacity, `seat ${seatId} is still rendered`).toBeGreaterThan(0);
      }

      // The live hero is untouched by any of it — otherwise "busted" could just be the table style.
      expect(hero.stack).toBeGreaterThan(0);
      expect(hero.out, 'the hero has chips and must not be marked out').toBe(false);
      expect(hero.outLabel).toBeNull();
      expect(hero.opacity, 'a live seat renders at full opacity').toBe(1);

      // The measured visual difference, in the same render.
      for (const seatId of bustedSeats) {
        expect(
          seat(seats, seatId).opacity,
          `seat ${seatId} must be dimmer than the live hero`,
        ).toBeLessThan(hero.opacity);
      }
      await shot(page, 'busted-seats-marked');
    } finally {
      await close();
    }
  });

  test('2. busted does not look like folded — both states in one render, measured', async () => {
    const { page, close } = await launchApp({ seed: SEED_VILLAINS_BUST });
    try {
      const bustedSeats = await bustVillains(page);
      await dealNextHand(page);

      // A seat that folded THIS hand while still holding chips. The hero folds to produce one
      // deterministically rather than waiting on a villain's decision; if the hand ends before the
      // hero is asked, deal on until it is.
      let foldedWithChips: SeatReading | null = null;
      for (let hand = 0; hand < 6 && foldedWithChips === null; hand++) {
        if ((await waitForIdle(page)) === 'hero') {
          await page.locator(sel.btnFold).click();
          const seats = await readSeats(page);
          foldedWithChips = seats.find((s) => s.folded && !s.out && s.stack > 0) ?? null;
          if (foldedWithChips !== null) {
            // Both states are on screen at once, so the comparison below cannot be an artefact
            // of two different renders.
            const busted = bustedSeats.map((id) => seat(seats, id));
            for (const out of busted) {
              expect(out.out, `seat ${out.seatId} data-out`).toBe(true);
              expect(out.folded, `a sat-out seat is also folded by the engine`).toBe(true);
            }

            // The folded seat carries NO out-of-game marker: conflating the two is the defect.
            expect(foldedWithChips.out, 'a seat that merely folded is not out of the game').toBe(
              false,
            );
            expect(foldedWithChips.outLabel, 'no out-of-chips label on a folded live seat').toBeNull();
            expect(foldedWithChips.text).not.toContain('Out of chips');

            // Measured, not asserted by class name: busted is strictly dimmer than folded.
            for (const out of busted) {
              expect(
                out.opacity,
                `busted seat ${out.seatId} (${out.opacity}) vs folded seat ${foldedWithChips.seatId} (${foldedWithChips.opacity})`,
              ).toBeLessThan(foldedWithChips.opacity);
              // A second, non-opacity difference so the distinction does not rest on one property.
              expect(out.borderStyle, `busted seat ${out.seatId} border`).toBe('dashed');
            }
            expect(foldedWithChips.borderStyle, 'a folded live seat keeps a solid edge').not.toBe(
              'dashed',
            );
            await shot(page, 'busted-vs-folded');
            break;
          }
        }
        if ((await waitForIdle(page)) === 'handover') {
          await expect(page.locator(winnerSummary)).toBeVisible();
          await dealNextHand(page);
        }
      }

      expect(
        foldedWithChips,
        'no render contained a folded-but-funded seat, so the distinction was never tested',
      ).not.toBeNull();
    } finally {
      await close();
    }
  });

  test('3. the out marker survives further hands and never lands on a funded seat', async () => {
    test.setTimeout(180_000);
    const { page, close } = await launchApp({ seed: SEED_VILLAINS_BUST });
    try {
      const bustedSeats = await bustVillains(page);

      for (let hand = 0; hand < 4; hand++) {
        await dealNextHand(page);
        const seats = await readSeats(page);

        // The invariant, stated over every seat: marked out if and only if chipless and not dealt in.
        for (const s of seats) {
          expect(s.out, `seat ${s.seatId} out=${String(s.out)} stack=${s.stack} cards=${s.cards}`).toBe(
            s.stack === 0 && s.cards === 0,
          );
          expect(s.outLabel === null, `seat ${s.seatId} label agrees with data-out`).toBe(!s.out);
        }
        for (const seatId of bustedSeats) {
          expect(seat(seats, seatId).out, `seat ${seatId} is still out in hand ${hand + 2}`).toBe(true);
        }

        if ((await waitForIdle(page)) === 'hero') await page.locator(sel.btnFold).click();
        if ((await waitForIdle(page)) !== 'handover') {
          throw new Error(`hand ${hand + 2} did not settle after the hero folded`);
        }
      }
    } finally {
      await close();
    }
  });
});
