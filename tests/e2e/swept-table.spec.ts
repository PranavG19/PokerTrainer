import { expect, test, type Page } from '@playwright/test';
import { launchApp, sel, shot } from './helpers.js';
import { chipTotal, snapshot, tableScreen, waitForIdle, CHIPS_IN_PLAY } from './flow.js';

/**
 * WINNING THE WHOLE TABLE.
 *
 * The busted-hero branch tested the wrong seat's stack. When the HERO holds every chip, each villain
 * sits out, both blinds land on the hero, and the hand is over before it deals — so "Next hand"
 * posted the hero's blinds to itself forever with no decision to make and no way out. "New session"
 * was rendered only when the hero was at zero, so a hero who won everything was the one player with
 * no exit. Measured at 25 hands from the standard table (scripts/audit-w6/a19-lone-seat.ts).
 *
 * That same configuration also destroyed chips: one seat posting both blinds overwrote its own
 * `committed`, so 25 vanished per hand. tests/unit/lone-funded-seat.test.ts owns that; this file owns
 * the UI escape, and asserts the chip total as a second oracle because the two defects met here.
 *
 * Seed 158 is pinned: with the hero shoving every hand it sweeps all 20000 chips in 2 hands, the
 * fastest of the 19 sweeping seeds in a22-sweep.ts's 200-seed scan. The probe seeds its villain
 * stream `seed ^ 0x5eed` from ONE long-lived generator, mirroring table.ts:129 — an earlier version
 * used its own stream, found seed 36, and that seed did not reproduce in the app at all.
 */

const SEED_HERO_SWEEPS = 158;
const homeScreen = '[data-testid="home-screen"]';
const nextHand = '[data-testid="next-hand"]';
const newSession = '[data-testid="new-session"]';
const sessionOver = '[data-testid="session-over"]';
const sweptNotice = '[data-testid="table-swept"]';
const presetAllin = '[data-testid="preset-allin"]';

async function sitDown(page: Page): Promise<void> {
  await page.waitForSelector(homeScreen);
  await page.locator(sel.newHand).click();
  await page.locator(tableScreen).waitFor();
  await waitForIdle(page);
}

/** Put every hero chip at risk whenever the controls allow, else keep the hand moving. */
async function shoveOrKeepMoving(page: Page): Promise<void> {
  const raise = page.locator(sel.btnRaise);
  if (await raise.isEnabled()) {
    await page.locator(presetAllin).click();
    await raise.click();
    return;
  }
  for (const selector of [sel.btnCall, sel.btnCheck, sel.btnFold]) {
    const button = page.locator(selector);
    if (await button.isEnabled()) {
      await button.click();
      return;
    }
  }
  throw new Error('hero turn with no enabled action button');
}

/**
 * Shove until the hero holds every chip. Returns the hands played. Bounded, so a regression that
 * never reaches the swept state fails loudly instead of hanging the runner.
 */
async function sweepTable(page: Page, maxHands = 12): Promise<number> {
  for (let hand = 1; hand <= maxHands; hand++) {
    for (let action = 0; action < 40; action++) {
      if ((await waitForIdle(page)) === 'handover') break;
      await shoveOrKeepMoving(page);
    }
    await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'handover');

    const snap = await snapshot(page);
    const funded = snap.stacks.filter((s) => s > 0).length;
    if (funded < 2 && snap.stacks[0] > 0) return hand;
    if (snap.stacks[0] === 0) throw new Error(`hero busted on hand ${hand}; seed ${SEED_HERO_SWEEPS} should sweep`);

    await page.locator(nextHand).click();
  }
  throw new Error(`hero had not swept the table after ${maxHands} hands`);
}

test.describe('the hero wins every chip at the table', () => {
  test('offers a way out instead of a dealing loop with no decision in it', async () => {
    const { app, page } = await launchApp({ seed: SEED_HERO_SWEEPS });
    try {
      await sitDown(page);
      const hands = await sweepTable(page);
      expect(hands).toBeLessThanOrEqual(12);

      const snap = await snapshot(page);
      expect(snap.stacks.filter((s) => s > 0)).toHaveLength(1);
      expect(snap.stacks[0]).toBeGreaterThan(0);

      // The escape exists and says why, rather than a button that silently does nothing.
      await expect(page.locator(sweptNotice)).toHaveCount(1);
      await expect(page.locator(sweptNotice)).toContainText('nobody is left to play');
      await expect(page.locator(newSession)).toBeEnabled();

      // "Next hand" must be gone: it is what produced the loop. And the rebuy/session-over copy is
      // for a BUSTED hero — offering it to a hero holding every chip would be nonsense.
      await expect(page.locator(nextHand)).toHaveCount(0);
      await expect(page.locator(sessionOver)).toHaveCount(0);

      await shot(page, 'swept-table');

      // The exit actually works, which a rendered-but-dead control would not.
      await page.locator(newSession).click();
      await page.waitForSelector(homeScreen);
    } finally {
      await app.close();
    }
  });

  test('destroys no chips on the way to sweeping the table', async () => {
    // The second oracle. The swept configuration is exactly where one seat posts both blinds, and
    // that path used to overwrite `committed` and lose the small blind every hand. 20000 in, 20000
    // still there — asserted every hand, because the loss compounded rather than appearing at once.
    const { app, page } = await launchApp({ seed: SEED_HERO_SWEEPS });
    try {
      await sitDown(page);

      for (let hand = 1; hand <= 12; hand++) {
        for (let action = 0; action < 40; action++) {
          if ((await waitForIdle(page)) === 'handover') break;
          await shoveOrKeepMoving(page);
        }
        const snap = await snapshot(page);
        expect(chipTotal(snap), `chips at handover of hand ${hand}`).toBe(CHIPS_IN_PLAY);
        if (snap.stacks.filter((s) => s > 0).length < 2) break;
        await page.locator(nextHand).click();
      }

      const swept = await snapshot(page);
      expect(swept.stacks[0]).toBe(CHIPS_IN_PLAY);
    } finally {
      await app.close();
    }
  });
});
