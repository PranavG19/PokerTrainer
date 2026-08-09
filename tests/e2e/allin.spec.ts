import { expect, test, type Page } from '@playwright/test';
import { launchApp, sel, shot } from './helpers.js';
import {
  CHIPS_IN_PLAY,
  chipTotal,
  playToShowdown,
  snapshot,
  tableScreen,
  waitForIdle,
} from './flow.js';

/**
 * GAP 2 — committing an all-in through the UI.
 *
 * Other specs assert what the all-in preset *computes*; nothing ever clicks it through to a
 * showdown, so the engine's shortest-stack / side-pot / run-out-the-board paths were only ever
 * exercised by unit tests. Every test here commits the hero's whole stack with a real click.
 *
 * Sync rule: never sleep. The table root publishes data-awaiting on every render; assertions
 * that must observe the instant *after* the shove click (before the 450ms villain timer can
 * fire) do the click and the read inside one page.evaluate, which cannot be interleaved.
 */

const START_STACK = CHIPS_IN_PLAY / 4;
const HERO_SEAT = '[data-testid="seat"][data-seat-id="0"]';
const presetAllin = '[data-testid="preset-allin"]';
const winnerSummary = '[data-testid="winner-summary"]';
const nextHand = '[data-testid="next-hand"]';
const homeScreen = '[data-testid="home-screen"]';
const profileScreen = '[data-testid="profile-screen"]';
const FACE_UP_CARD = /^[2-9TJQKA][shdc]$/;

/**
 * Seeds pinned from the search in the last test of this file (see there for the method).
 * 42: hero shoves, two villains call all-in, hero wins the whole 20000 — a real 3-way showdown.
 * 2:  hero shoves and busts to 0.
 */
const SEED_HERO_WINS = 42;
const SEED_HERO_BUSTS = 2;

/** Launch, run, always close — a failed assertion must not leak an Electron process. */
async function withApp<T>(seed: number, body: (page: Page) => Promise<T>): Promise<T> {
  const { page, close } = await launchApp({ seed });
  try {
    return await body(page);
  } finally {
    await close();
  }
}

async function sitDown(page: Page): Promise<void> {
  await page.waitForSelector(homeScreen);
  await page.locator(sel.newHand).click();
  await page.locator(tableScreen).waitFor();
  await waitForIdle(page);
}

/** The shove path needs a live raise control: facing a bet bigger than the stack there is none. */
async function canShove(page: Page): Promise<boolean> {
  return (
    (await page.locator(presetAllin).isEnabled()) && (await page.locator(sel.btnRaise).isEnabled())
  );
}

interface ShoveReading {
  awaitingBefore: string | null;
  awaitingAfter: string | null;
  heroAllin: string | null;
  heroStack: number;
  stacks: number[];
  pot: number;
  boardBefore: number;
  raiseTo: number;
}

/**
 * Click preset-allin then btn-raise and read the resulting render in the same JS turn.
 * heroAct -> applyAction -> advance() -> render() is synchronous up to the villain's setTimeout,
 * so these values describe the table immediately after the hero's chips moved — before a
 * showdown can pay the hero back and hide the fact that the stack ever hit 0.
 */
async function shoveAllIn(page: Page): Promise<ShoveReading> {
  return page.evaluate(() => {
    const button = (id: string): HTMLButtonElement => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!(el instanceof HTMLButtonElement)) throw new Error(`${id} is not a button`);
      return el;
    };
    const root = document.querySelector('[data-testid="table-screen"]');
    if (!(root instanceof HTMLElement)) throw new Error('table-screen missing');
    const slider = document.querySelector('[data-testid="raise-slider"]');
    if (!(slider instanceof HTMLInputElement)) throw new Error('raise-slider missing');

    const awaitingBefore = root.dataset.awaiting ?? null;
    const boardBefore = document.querySelectorAll(
      '[data-testid="board"] [data-testid="card"]',
    ).length;

    button('preset-allin').click();
    const raiseTo = Number(slider.value);
    button('btn-raise').click();

    // render() replaced the seats, so these must be queried after the click.
    const seats = [...document.querySelectorAll<HTMLElement>('[data-testid="seat"]')];
    const seat = seats.find((s) => s.dataset.seatId === '0');
    if (seat === undefined) throw new Error('hero seat missing');
    const potText = document.querySelector('[data-testid="pot"]')?.textContent ?? '';

    return {
      awaitingBefore,
      awaitingAfter: root.dataset.awaiting ?? null,
      heroAllin: seat.dataset.allin ?? null,
      heroStack: Number(seat.querySelector('[data-testid="seat-stack"]')?.textContent ?? 'NaN'),
      stacks: seats.map((s) =>
        Number(s.querySelector('[data-testid="seat-stack"]')?.textContent ?? 'NaN'),
      ),
      pot: Number(potText.replace(/[^0-9-]/g, '')),
      boardBefore,
      raiseTo,
    };
  });
}

/** Record every data-awaiting transition on the (never-replaced) table root. */
async function trackAwaiting(page: Page): Promise<void> {
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="table-screen"]');
    if (!(root instanceof HTMLElement)) throw new Error('table-screen missing');
    const log: string[] = [root.dataset.awaiting ?? ''];
    (window as unknown as { __awaitingLog: string[] }).__awaitingLog = log;
    new MutationObserver(() => {
      const now = root.dataset.awaiting ?? '';
      if (log[log.length - 1] !== now) log.push(now);
    }).observe(root, { attributes: true, attributeFilter: ['data-awaiting'] });
  });
}

async function awaitingLog(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __awaitingLog?: string[] }).__awaitingLog ?? [],
  );
}

/** Leaving and re-entering Play tears the settled table down, revealing Home (and the bankroll). */
async function returnHome(page: Page): Promise<void> {
  await page.click(sel.tabProfile);
  await page.waitForSelector(profileScreen);
  await page.click(sel.tabPlay);
  await page.waitForSelector(homeScreen);
}

async function readBankroll(page: Page): Promise<number> {
  await page.waitForSelector(homeScreen);
  const text = (await page.textContent(sel.bankroll)) ?? '';
  const value = Number(text.trim());
  expect(Number.isFinite(value), `bankroll text was "${text}"`).toBe(true);
  return value;
}

async function foldedSeatIds(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="seat"]')]
      .filter((s) => s.dataset.folded === 'true')
      .map((s) => Number(s.dataset.seatId)),
  );
}

async function allInSeatIds(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="seat"]')]
      .filter((s) => s.dataset.allin === 'true')
      .map((s) => Number(s.dataset.seatId)),
  );
}

test.describe('all-in committed through the UI', () => {
  test('scenario 1: preset-allin + btn-raise empties the hero stack and flags the seat all-in', async () => {
    await withApp(SEED_HERO_WINS, async (page) => {
      await sitDown(page);
      expect(await canShove(page), 'hero must have a raise control to shove with').toBe(true);
      await expect(page.locator(HERO_SEAT)).not.toHaveAttribute('data-allin', 'true');

      const shove = await shoveAllIn(page);

      expect(shove.awaitingBefore).toBe('hero');
      // Hero is on the button in hand 1 (blinds sit at seats 1 and 2), so committed is 0 and
      // an all-in raise-TO is exactly the starting stack.
      expect(shove.raiseTo).toBe(START_STACK);
      expect(shove.heroAllin).toBe('true');
      expect(shove.heroStack).toBe(0);
      expect(shove.pot).toBeGreaterThanOrEqual(START_STACK);
      // The turn left the hero: an all-in player is done deciding.
      expect(shove.awaitingAfter).not.toBe('hero');
      await shot(page, 'allin-committed');
    });
  });

  test('scenario 2: the hand runs to handover without asking the all-in hero to act again', async () => {
    await withApp(SEED_HERO_WINS, async (page) => {
      await sitDown(page);
      await trackAwaiting(page);
      await shoveAllIn(page);

      // 'hero' is a terminal state until a click — if the engine asked the hero to act again,
      // waitForIdle would return it rather than eventually reaching handover.
      expect(await waitForIdle(page)).toBe('handover');
      await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'handover');
      await expect(page.locator(winnerSummary)).toBeVisible();
      expect((await page.textContent(winnerSummary)) ?? '').toMatch(/wins \d+/);

      // The full transition history. Requiring 'ai' and a final 'handover' proves the observer
      // actually fired, so the "no second hero turn" assertion below is not vacuous.
      const log = await awaitingLog(page);
      expect(log[0]).toBe('hero');
      expect(log, `awaiting log: ${log.join('>')}`).toContain('ai');
      expect(log[log.length - 1]).toBe('handover');
      expect(log.slice(1), `awaiting log: ${log.join('>')}`).not.toContain('hero');
    });
  });

  test('scenario 3: the board runs out to 5 cards even though betting ended preflop', async () => {
    await withApp(SEED_HERO_WINS, async (page) => {
      await sitDown(page);
      const shove = await shoveAllIn(page);
      expect(shove.boardBefore, 'the shove happened preflop').toBe(0);

      expect(await waitForIdle(page)).toBe('handover');
      const snap = await snapshot(page);

      // Nobody left with chips behind means no street after the flop could have been bet:
      // the five cards can only have come from the engine running the board out.
      const folded = await foldedSeatIds(page);
      const allIn = await allInSeatIds(page);
      expect(snap.standing).toBeGreaterThanOrEqual(2);
      for (let seatId = 0; seatId < 4; seatId++) {
        if (folded.includes(seatId)) continue;
        expect(allIn, `seat ${seatId} contested the pot with chips behind`).toContain(seatId);
      }

      expect(snap.board).toHaveLength(5);
      for (const card of snap.board) expect(card).toMatch(FACE_UP_CARD);
      expect(new Set(snap.board).size).toBe(5);
    });
  });

  test('scenario 4: chips are conserved through an all-in hand (after the shove and after handover)', async () => {
    await withApp(SEED_HERO_WINS, async (page) => {
      await sitDown(page);
      expect(chipTotal(await snapshot(page))).toBe(CHIPS_IN_PLAY);

      // Read in the same JS turn as the click: the villains cannot have acted yet, so this is
      // the exact moment the hero's whole stack sat in the pot.
      const shove = await shoveAllIn(page);
      expect(shove.heroStack).toBe(0);
      expect(
        shove.stacks.reduce((a, b) => a + b, 0) + shove.pot,
        'chips vanished when the hero shoved',
      ).toBe(CHIPS_IN_PLAY);

      const afterShove = await snapshot(page);
      expect(chipTotal(afterShove), 'chips vanished mid-hand').toBe(CHIPS_IN_PLAY);

      expect(await waitForIdle(page)).toBe('handover');
      const afterHandover = await snapshot(page);
      expect(afterHandover.pot, 'a settled pot must be fully distributed').toBe(0);
      expect(chipTotal(afterHandover), 'chips minted or burned at showdown').toBe(CHIPS_IN_PLAY);
      // Redundant with chipTotal, but states the invariant in the settled case explicitly.
      expect(afterHandover.stacks.reduce((a, b) => a + b, 0)).toBe(CHIPS_IN_PLAY);
    });
  });

  test('scenario 5: the bankroll moves in the direction the all-in hand actually went', async () => {
    await withApp(SEED_HERO_WINS, async (page) => {
      const bankrollBefore = await readBankroll(page);
      await sitDown(page);
      await shoveAllIn(page);
      expect(await waitForIdle(page)).toBe('handover');

      const snap = await snapshot(page);
      const summary = (await page.textContent(winnerSummary)) ?? '';
      const heroWonChips = /\bYou wins\b/.test(summary);
      const net = snap.stacks[0] - START_STACK;

      await returnHome(page);
      const bankrollAfter = await readBankroll(page);
      const delta = bankrollAfter - bankrollBefore;

      // Direction, not magnitude: a sign error in net-chip accounting shows up here.
      expect(Math.sign(delta), `net ${net}, summary "${summary}"`).toBe(Math.sign(net));
      expect(delta).toBe(net);
      // On this seed the hero is the sole winner of every pot, so winning chips must mean a
      // positive result; a hero who won nothing back cannot have gained bankroll.
      if (heroWonChips) {
        expect(net).toBeGreaterThan(0);
        expect(bankrollAfter).toBeGreaterThan(bankrollBefore);
      } else {
        expect(bankrollAfter).toBeLessThan(bankrollBefore);
      }
    });
  });

  test('scenario 7: a called shove reaches a real showdown with villain cards revealed', async () => {
    await withApp(SEED_HERO_WINS, async (page) => {
      await sitDown(page);
      await shoveAllIn(page);
      expect(await waitForIdle(page)).toBe('handover');

      const snap = await snapshot(page);
      const folded = await foldedSeatIds(page);
      const allIn = await allInSeatIds(page);

      // At least one villain put their whole stack in against the hero's shove.
      const callers = allIn.filter((seatId) => seatId !== 0 && !folded.includes(seatId));
      expect(callers.length, 'no villain called the shove on this seed').toBeGreaterThanOrEqual(1);
      expect(snap.standing).toBeGreaterThanOrEqual(2);

      for (const seatId of callers) {
        const villain = snap.villainCards.find((v) => v.seatId === seatId);
        expect(villain, `seat ${seatId} missing from the snapshot`).toBeDefined();
        expect(villain?.cards).toHaveLength(2);
        for (const card of villain?.cards ?? []) expect(card).toMatch(FACE_UP_CARD);
      }
      // Folded villains keep their cards face down even at showdown.
      for (const villain of snap.villainCards.filter((v) => folded.includes(v.seatId))) {
        expect(villain.cards.every((c) => c === 'back'), `seat ${villain.seatId}`).toBe(true);
      }
      await shot(page, 'allin-showdown');
    });
  });

  test('scenario 8: next-hand recovers from both a doubled hero and a busted hero', async () => {
    // Both extremes of an all-in result: SEED_HERO_WINS triples the hero's stack,
    // SEED_HERO_BUSTS leaves it at 0.
    for (const seed of [SEED_HERO_WINS, SEED_HERO_BUSTS]) {
      await withApp(seed, async (page) => {
        await sitDown(page);
        await shoveAllIn(page);
        expect(await waitForIdle(page), `seed ${seed}`).toBe('handover');
        const settled = await snapshot(page);

        await page.locator(nextHand).click();
        const awaiting = await waitForIdle(page);

        const fresh = await snapshot(page);
        const heroBusted = settled.stacks[0] === 0;

        if (heroBusted) {
          // A seat with no chips sits out rather than free-rolling: it is dealt no cards and
          // cannot win a pot it put nothing into. (startHand marks stack === 0 as folded.)
          expect(fresh.heroCards, `seed ${seed} busted hero sits out`).toHaveLength(0);
          expect(fresh.stacks[0]).toBe(0);
        } else {
          expect(fresh.heroCards, `seed ${seed} redeal`).toHaveLength(2);
          for (const card of fresh.heroCards) expect(card).toMatch(FACE_UP_CARD);
          expect(fresh.heroCards).not.toEqual(settled.heroCards);
        }
        expect(chipTotal(fresh), `seed ${seed} conservation on the new hand`).toBe(CHIPS_IN_PLAY);

        // A fresh hand, not the old one still on screen.
        if (awaiting === 'hero') {
          await expect(page.locator(winnerSummary)).toHaveCount(0);
          expect(fresh.board.length).toBeLessThanOrEqual(3);
        }

        // And it still runs to completion from either stack size — including with the hero
        // sitting out, where the villains play it out between themselves.
        await playToShowdown(page);
        await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'handover');
        await expect(page.locator(winnerSummary)).toBeVisible();
        expect(chipTotal(await snapshot(page)), `seed ${seed} conservation after hand 2`).toBe(
          CHIPS_IN_PLAY,
        );
      });
    }
  });

  /**
   * Scenario 6. A hero who busts is the branch least likely to happen by accident and most
   * likely to be broken, so it is searched for rather than hoped for. The loop walks seeds
   * 1..MAX_SEARCH_SEED and stops at the first shove that leaves the hero on 0.
   *
   * PINNED: seed 1 wins the shove, seed 2 loses it — so the search terminates on its second
   * launch. The expect on found.seed keeps that pin honest: if AI/deal determinism shifts, this
   * fails loudly instead of silently searching further.
   */
  test('scenario 6: a searched seed where the hero shoves and LOSES busts the stack and the bankroll', async () => {
    const MAX_SEARCH_SEED = 25;
    const skipped: number[] = [];
    let found: {
      seed: number;
      bankrollBefore: number;
      bankrollAfter: number;
      heroStack: number;
      summary: string;
    } | null = null;

    for (let seed = 1; seed <= MAX_SEARCH_SEED && found === null; seed++) {
      const { page, close } = await launchApp({ seed });
      try {
        const bankrollBefore = await readBankroll(page);
        await sitDown(page);
        if (!(await canShove(page))) {
          // Facing a bet larger than the stack there is no raise control; this seed cannot
          // exercise the shove path at all.
          skipped.push(seed);
          continue;
        }
        await shoveAllIn(page);
        expect(await waitForIdle(page), `seed ${seed}`).toBe('handover');

        const snap = await snapshot(page);
        if (snap.stacks[0] !== 0) continue; // hero survived the shove — keep searching
        const summary = (await page.textContent(winnerSummary)) ?? '';

        await returnHome(page);
        found = {
          seed,
          bankrollBefore,
          bankrollAfter: await readBankroll(page),
          heroStack: snap.stacks[0],
          summary,
        };
      } finally {
        await close();
      }
    }

    if (found === null) {
      throw new Error(
        `no losing hero shove in seeds 1..${MAX_SEARCH_SEED} (skipped: ${skipped.join(',') || 'none'})`,
      );
    }

    expect(found.seed).toBe(SEED_HERO_BUSTS);
    expect(found.heroStack).toBe(0);
    expect(found.summary).not.toContain('You wins');
    expect(found.bankrollAfter).toBeLessThan(found.bankrollBefore);
    expect(found.bankrollBefore - found.bankrollAfter).toBe(START_STACK);
  });
});
