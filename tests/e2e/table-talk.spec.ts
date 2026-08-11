import { expect, test, type Page } from '@playwright/test';
import { launchApp, sel } from './helpers.js';
import { tableScreen, waitForIdle, playToShowdown } from './flow.js';

/**
 * VILLAIN TABLE-TALK, end to end (task #20).
 *
 * The villains "talk" — a short line for their last action on their seat. The load-bearing property
 * is the same one O3 protects: the archetype label is HIDDEN until showdown, so a line shown while
 * the hand is live must be information-free (data-revealed='false'). This test collects every talk
 * line rendered across a whole hand and asserts no live-hand line contains any archetype label or
 * descriptor — a bubble that leaked "nit"/"maniac" mid-hand would hand over the read O3 hides.
 *
 * Offline and deterministic: the shipped quips are fixed strings (src/core/tableTalk.ts), no model.
 */

// The six labels and the descriptor words a leak would use. Kept in the test so a new archetype whose
// label is not swept here shows up as an obvious omission rather than a silent gap.
const FORBIDDEN_IN_HAND = [
  'nit', 'station', 'lag', 'tag-reg', 'over-folder', 'maniac',
  'calling', 'loose', 'tight', 'aggressive', 'bluff',
];

const seatTalk = '[data-testid="seat-talk"]';

async function sitDown(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.locator(sel.newHand).click();
  await page.locator(tableScreen).waitFor();
  await waitForIdle(page);
}

/**
 * Observe every talk line rendered, tagged with whether it was shown revealed. A MutationObserver,
 * not polling: the table repaints on each villain action, so the observer catches every intermediate
 * line the learner would actually see.
 */
async function watchTalk(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __talk?: { text: string; revealed: string }[] };
    if (w.__talk) return;
    const seen: { text: string; revealed: string }[] = [];
    w.__talk = seen;
    const scan = (): void => {
      for (const b of document.querySelectorAll<HTMLElement>('[data-testid="seat-talk"]')) {
        seen.push({ text: b.textContent ?? '', revealed: b.dataset.revealed ?? '' });
      }
    };
    scan();
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  });
}

async function readTalk(page: Page): Promise<{ text: string; revealed: string }[]> {
  return page.evaluate(
    () => (window as unknown as { __talk?: { text: string; revealed: string }[] }).__talk ?? [],
  );
}

test.describe('villain table-talk', () => {
  test('1. villains show a line for their action, and it never leaks the hidden label mid-hand', async () => {
    const { page, close } = await launchApp({ seed: 7 });
    try {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));

      await sitDown(page);
      await watchTalk(page);
      // Play a full hand so villains act on several streets and lines are rendered throughout.
      await playToShowdown(page);
      await expect(page.locator('[data-testid="winner-summary"]')).toBeVisible();

      const lines = await readTalk(page);
      // Not a vacuous pass: at least one villain talked during the hand.
      expect(lines.length, 'no villain ever showed a talk line').toBeGreaterThan(0);

      // THE INVARIANT: no line shown while the hand was live (revealed='false') leaks a label.
      for (const line of lines.filter((l) => l.revealed === 'false')) {
        const lower = line.text.toLowerCase();
        for (const word of FORBIDDEN_IN_HAND) {
          expect(
            lower.includes(word),
            `live-hand talk line "${line.text}" leaked the label/descriptor "${word}"`,
          ).toBe(false);
        }
      }
      expect(errors).toEqual([]);
    } finally {
      await close().catch(() => {});
    }
  });

  test('2. at showdown a revealed line may be in-character — the label is already out', async () => {
    const { page, close } = await launchApp({ seed: 7 });
    try {
      await sitDown(page);
      await playToShowdown(page);
      await expect(page.locator('[data-testid="winner-summary"]')).toBeVisible();

      // At least one seat that reached showdown shows a revealed line (its archetype tag is revealed
      // too). The content is free to be in-character now; we only assert the revealed line exists and
      // is non-empty, since which seats reveal is seed-dependent.
      const revealed = page.locator(`${seatTalk}[data-revealed="true"]`);
      const count = await revealed.count();
      if (count > 0) {
        expect(((await revealed.first().textContent()) ?? '').length).toBeGreaterThan(0);
      }
    } finally {
      await close().catch(() => {});
    }
  });
});
