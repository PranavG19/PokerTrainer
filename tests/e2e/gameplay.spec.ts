import { expect, test, type Page } from '@playwright/test';
import { launchApp, sel, shot } from './helpers.js';
import {
  CHIPS_IN_PLAY,
  chipTotal,
  playToShowdown,
  snapshot,
  tableScreen,
  waitForIdle,
  type Snapshot,
} from './flow.js';

const FACE_UP_CARD = /^[2-9TJQKA][shdc]$/;
const SEED = 42;
const OTHER_SEED = 1337;

/** Launch, run, and always close — a failed assertion must not leak an Electron process. */
async function withApp<T>(seed: number, body: (page: Page) => Promise<T>): Promise<T> {
  const { page, close } = await launchApp({ seed });
  try {
    return await body(page);
  } finally {
    await close();
  }
}

async function sitDown(page: Page): Promise<void> {
  await page.locator(sel.newHand).click();
  await page.locator(tableScreen).waitFor();
  await waitForIdle(page);
}

/** Hole cards + full board identify the deal; villain hole cards do too but are hidden pre-showdown. */
function deal(snap: Snapshot): string {
  return `${snap.heroCards.join(' ')} | ${snap.board.join(' ')}`;
}

test.describe('gameplay', () => {
  test('home screen shows the starting bankroll and a new-session control', async () => {
    await withApp(SEED, async (page) => {
      await expect(page.locator(sel.bankroll)).toHaveText('10000');
      await expect(page.locator(sel.newHand)).toBeEnabled();
      await expect(page.locator(tableScreen)).toHaveCount(0);
    });
  });

  test('starting a session deals 4 seats, 2 face-up hero cards, villain backs', async () => {
    await withApp(SEED, async (page) => {
      await sitDown(page);

      await expect(page.locator(sel.seat)).toHaveCount(4);
      const snap = await snapshot(page);

      expect(snap.heroCards).toHaveLength(2);
      for (const card of snap.heroCards) expect(card).toMatch(FACE_UP_CARD);
      expect(new Set(snap.heroCards).size).toBe(2);

      expect(snap.villainCards).toHaveLength(3);
      for (const villain of snap.villainCards) {
        expect(villain.cards, `seat ${villain.seatId}`).toEqual(['back', 'back']);
      }
    });
  });

  test('all three archetypes are seated exactly once', async () => {
    await withApp(SEED, async (page) => {
      await sitDown(page);
      const labels = await page.locator('[data-testid="seat-archetype"]').allTextContents();
      expect(labels.slice().sort()).toEqual(['Nit', 'Station', 'TAG']);
    });
  });

  test('blinds are posted before the hero acts', async () => {
    await withApp(SEED, async (page) => {
      await sitDown(page);
      // 25 + 50 posted at minimum; villains may have already put in more.
      expect((await snapshot(page)).pot).toBeGreaterThanOrEqual(75);
    });
  });

  test('a full hand reaches showdown with a 5-card board and a next-hand control', async () => {
    await withApp(SEED, async (page) => {
      await sitDown(page);
      await playToShowdown(page);

      await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'handover');
      await expect(page.locator('[data-testid="winner-summary"]')).toBeVisible();
      await expect(page.locator('[data-testid="next-hand"]')).toBeVisible();

      const snap = await snapshot(page);
      // Passive hero never folds, so a contested pot must run the full board.
      expect(snap.standing).toBeGreaterThanOrEqual(2);
      expect(snap.board).toHaveLength(5);
      for (const card of snap.board) expect(card).toMatch(FACE_UP_CARD);
      await shot(page, 'gameplay-showdown');
    });
  });

  test('villain hole cards are revealed at showdown', async () => {
    await withApp(SEED, async (page) => {
      await sitDown(page);
      await playToShowdown(page);

      const snap = await snapshot(page);
      const folded = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="seat"]')]
          .filter((s) => s.dataset.folded === 'true')
          .map((s) => Number(s.dataset.seatId)),
      );

      const shown = snap.villainCards.filter((v) => !folded.includes(v.seatId));
      if (shown.length === 0) {
        // Everyone folded to the hero: there is nothing to reveal, so assert the opposite.
        expect(snap.villainCards.every((v) => v.cards.every((c) => c === 'back'))).toBe(true);
        return;
      }
      for (const villain of shown) {
        expect(villain.cards, `seat ${villain.seatId}`).toHaveLength(2);
        for (const card of villain.cards) expect(card).toMatch(FACE_UP_CARD);
      }
      // Folded villains keep their cards hidden.
      for (const villain of snap.villainCards.filter((v) => folded.includes(v.seatId))) {
        expect(villain.cards.every((c) => c === 'back'), `seat ${villain.seatId}`).toBe(true);
      }
    });
  });

  test('same seed replays an identical deal, a different seed does not', async () => {
    const play = (seed: number): Promise<string> =>
      withApp(seed, async (page) => {
        await sitDown(page);
        await playToShowdown(page);
        return deal(await snapshot(page));
      });

    const first = await play(SEED);
    const second = await play(SEED);
    const other = await play(OTHER_SEED);

    expect(second).toBe(first);
    expect(first).toMatch(/^[2-9TJQKA][shdc] [2-9TJQKA][shdc] \| /);
    expect(other).not.toBe(first);
  });

  test('the second hand deals cards the first hand did not', async () => {
    await withApp(SEED, async (page) => {
      await sitDown(page);
      await playToShowdown(page);
      const firstHand = await snapshot(page);

      await page.locator('[data-testid="next-hand"]').click();
      await waitForIdle(page);
      const secondHand = await snapshot(page);

      expect(secondHand.heroCards).toHaveLength(2);
      expect(secondHand.heroCards).not.toEqual(firstHand.heroCards);

      // Hero's cards move on dealer rotation even from a static deck, so also require a
      // freshly shuffled board — that is what a per-hand reshuffle actually buys.
      await playToShowdown(page);
      const secondBoard = (await snapshot(page)).board;
      expect(secondBoard).toHaveLength(5);
      expect(secondBoard).not.toEqual(firstHand.board);
    });
  });

  test('chips are conserved across every action of a hand', async () => {
    await withApp(SEED, async (page) => {
      await sitDown(page);

      const samples: number[] = [chipTotal(await snapshot(page))];
      for (let i = 0; i < 40 && (await waitForIdle(page)) === 'hero'; i++) {
        const check = page.locator(sel.btnCheck);
        await ((await check.isEnabled()) ? check : page.locator(sel.btnCall)).click();
        samples.push(chipTotal(await snapshot(page)));
      }
      samples.push(chipTotal(await snapshot(page)));

      expect(samples.length).toBeGreaterThan(2);
      for (const total of samples) expect(total).toBe(CHIPS_IN_PLAY);
      await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'handover');
    });
  });
});
