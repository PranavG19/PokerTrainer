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

  // O3: the archetype label is hidden until the hand ends. At sit-down every villain reads 'Unknown'
  // (data-revealed='false'); after one hand plays to handover exactly three villain tags are
  // revealed, all distinct, each a real archetype label — and the hero seat never carries one.
  test('villain archetypes are hidden until handover, then revealed distinct', async () => {
    // The six labels from ARCHETYPE_EXPLOITS; any revealed tag must be one of them.
    const ARCHETYPE_LABELS = ['Nit', 'Station', 'LAG', 'TAG-reg', 'Over-folder', 'Maniac'];
    await withApp(SEED, async (page) => {
      await sitDown(page);

      const atSitDown = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="seat-archetype"]')].map((t) => ({
          text: t.textContent,
          revealed: t.dataset.revealed,
        })),
      );
      expect(atSitDown).toHaveLength(3);
      for (const tag of atSitDown) {
        expect(tag.revealed).toBe('false');
        expect(tag.text).toBe('Unknown');
      }

      await playToShowdown(page);
      await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'handover');

      const atHandover = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="seat"]')]
          .filter((s) => s.dataset.seatId !== '0')
          .map((s) => {
            const tag = s.querySelector<HTMLElement>('[data-testid="seat-archetype"]');
            return { text: tag?.textContent ?? null, revealed: tag?.dataset.revealed ?? null };
          }),
      );
      expect(atHandover).toHaveLength(3);
      for (const tag of atHandover) {
        expect(tag.revealed).toBe('true');
        expect(ARCHETYPE_LABELS, `revealed label "${tag.text}"`).toContain(tag.text);
      }
      // The three seated archetypes are distinct (a seeded 3-of-6 draw with no repeats).
      const revealedLabels = atHandover.map((t) => t.text);
      expect(new Set(revealedLabels).size).toBe(3);

      // The hero carries no archetype tag at any point.
      await expect(
        page.locator('[data-testid="seat"][data-seat-id="0"] [data-testid="seat-archetype"]'),
      ).toHaveCount(0);
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

  test('the winning pod carries the mint winner ring, and no pod is still to-act (UI)', async () => {
    await withApp(SEED, async (page) => {
      await sitDown(page);
      await playToShowdown(page);
      await expect(page.locator('[data-testid="winner-summary"]')).toBeVisible();

      // The ring belongs to whoever the summary names, so derive the expected winners from it rather
      // than from a seat attribute — that is the human-visible claim the ring is decorating.
      const summary = (await page.locator('[data-testid="winner-summary"]').first().textContent()) ?? '';
      const marked = await page.evaluate(() => {
        const seats = [...document.querySelectorAll<HTMLElement>('[data-testid="seat"]')];
        return {
          winners: seats
            .filter((s) => s.dataset.winner === 'true')
            .map((s) => s.querySelector('.seat-name')?.textContent ?? ''),
          toAct: seats.filter((s) => s.dataset.toAct === 'true').length,
          ringHue: seats
            .filter((s) => s.dataset.winner === 'true')
            .map((s) => getComputedStyle(s).borderTopColor),
        };
      });

      // At least one pod won, every marked pod's name appears in the summary, and the ring is never
      // on a pod that is also still to-act (table.ts guards those apart).
      expect(marked.winners.length, 'no pod carries the winner ring at showdown').toBeGreaterThanOrEqual(1);
      for (const name of marked.winners) {
        expect(name, 'a nameless pod is ringed').not.toBe('');
        expect(summary, `winner ring on "${name}" but the summary does not name it`).toContain(name);
      }
      expect(marked.toAct, 'a pod is still marked to-act after the hand resolved').toBe(0);
      // Mint is #3DDC97 → rgb(61, 220, 151). The ring must be that colour, never the blue leak class.
      for (const hue of marked.ringHue) expect(hue).toBe('rgb(61, 220, 151)');
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

  test('10. no win% is shown over a decided hand at showdown', async () => {
    await withApp(42, async (page) => {
      await sitDown(page);
      await page.locator('[data-testid="stats-toggle"]').click();

      // Mid-hand the readout is a real number...
      await expect(page.locator(sel.winPct)).toHaveText(/^\d+%$/);

      await playToShowdown(page);
      await expect(page.locator('[data-testid="winner-summary"]')).toBeVisible();

      // ...but at showdown the board is complete and the contesting hands are face-up, so the
      // hero's chance of winning is 0 or 1. A Monte Carlo estimate over a settled hand ("96%" was
      // shown beside "You wins 150") is simply false, and the winner summary already says who won.
      const shown = await page.locator(sel.winPct).textContent();
      expect(shown ?? '', `showdown showed "${shown}"`).not.toMatch(/\d/);

      // The next hand is live again, so this is a suppression, not a permanent blank.
      await page.locator('[data-testid="next-hand"]').click();
      await waitForIdle(page);
      await expect(page.locator(sel.winPct)).toHaveText(/^\d+%$/);
    });
  });
});
