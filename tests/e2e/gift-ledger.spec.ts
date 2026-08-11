import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, sel } from './helpers.js';
import { tableScreen, waitForIdle } from './flow.js';

/**
 * THE GIFT LEDGER, END TO END (O5 / story 34).
 *
 * A gift is a -EV villain call the learner OBSERVED at showdown. It cannot be typed in: the table
 * captures each villain call as it happens, and only a call whose holding the showdown reveals is
 * scored — by exact equity, in core, from the revealed cards. This file proves the whole path runs
 * through the real app: play hands to showdown, then read the PERSISTED state and assert every
 * recorded gift is a genuine losing call, and that the profile screen shows them.
 *
 * The oracle is not "N gifts appeared" (seed-dependent), it is the INVARIANT every gift must satisfy
 * however many there are: villain equity below the price they got, a positive chip gift, revealed
 * two-card holdings. Seed 3 is used because it reliably reaches a revealed losing call within the
 * hand budget, so test 2 also proves the capture path actually fires rather than passing vacuously.
 */

const STATE_FILE = 'offsuit-state.json';
const homeScreen = '[data-testid="home-screen"]';
const nextHandBtn = '[data-testid="next-hand"]';
const giftList = '[data-testid="gift-list"]';
const giftRow = '[data-testid="gift-row"]';
const giftTotal = '[data-testid="gift-total"]';

// Playing to showdown across many hands runs long; borrow the deep-soak budget rather than the
// default 60s so a slow AI-delay run does not flake.
const PLAY_TIMEOUT_MS = 600_000;

interface PersistedGift {
  seq: number;
  villainSeatId: number;
  villainName: string;
  villainHole: string[];
  heroHole: string[];
  board: string[];
  action: 'call' | 'allin';
  villainEquity: number;
  breakEven: number;
  evChips: number;
  giftChips: number;
}

interface Persisted {
  gifts?: PersistedGift[];
}

function freshUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-gift-'));
}

function readGifts(dir: string): PersistedGift[] {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), 'utf-8')) as Persisted;
  return raw.gifts ?? [];
}

/** Passive play: check, else call, else fold. Calling maximises showdowns, where gifts are observed. */
async function playHandPassively(page: Page): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if ((await waitForIdle(page)) === 'handover') return;
    for (const button of [sel.btnCheck, sel.btnCall, sel.btnFold]) {
      const el = page.locator(button);
      if (await el.isEnabled()) {
        await el.click();
        break;
      }
    }
  }
  throw new Error('hand did not settle within 40 hero actions');
}

/**
 * Play up to `hands` hands passively, taking the next-hand control at each handover. Stops early and
 * returns the count actually played if the hero busts out to the home screen — the state is persisted
 * hand by hand, so a short run is still a valid ledger to assert against.
 */
async function playHands(page: Page, hands: number): Promise<number> {
  await page.waitForSelector(homeScreen);
  await page.locator(sel.newHand).click();
  await page.locator(tableScreen).waitFor();

  for (let h = 0; h < hands; h++) {
    // The table can be torn down at a bust (back to home). If it is gone, the run is over.
    if ((await page.locator(tableScreen).count()) === 0) return h;
    await playHandPassively(page);
    if (h === hands - 1) return hands;
    const next = page.locator(nextHandBtn);
    if (await next.isEnabled().catch(() => false)) {
      await next.click();
    } else {
      // No way forward on the table (swept/busted): the run ends here with what was persisted.
      return h + 1;
    }
  }
  return hands;
}

/** Every persisted gift must be a genuine observed losing call — the O5 anti-inflation invariant. */
function assertGiftsAreReal(gifts: PersistedGift[]): void {
  for (const g of gifts) {
    expect(g.villainEquity, `gift seq ${g.seq}: equity below the price it got`).toBeLessThan(g.breakEven);
    expect(g.giftChips, `gift seq ${g.seq}: positive value handed over`).toBeGreaterThan(0);
    expect(g.evChips).toBeLessThan(0);
    expect(g.villainHole).toHaveLength(2);
    expect(g.heroHole).toHaveLength(2);
    expect(['call', 'allin']).toContain(g.action);
  }
}

test.describe('gift ledger from showdowns', () => {
  test('1. a fresh profile shows no gift section before any hand is played', async () => {
    const dir = freshUserDataDir();
    const { page, close } = await launchApp({ seed: 1, userDataDir: dir });
    try {
      await page.waitForSelector(homeScreen);
      await page.locator(sel.tabProfile).click();
      await expect(page.locator('[data-testid="profile-screen"]')).toBeVisible();
      // The section is omitted until the first gift is observed — the pixel-tight profile column has
      // no room for a sixth always-present section, and "nothing observed" is the honest reading of
      // its absence. The other sections still render.
      await expect(page.locator('[data-testid="leak-list"]')).toBeVisible();
      await expect(page.locator(giftList)).toHaveCount(0);
    } finally {
      await close().catch(() => {});
    }
  });

  test('2. real play records genuine losing calls and the profile lists them (capture path fires)', async () => {
    test.setTimeout(PLAY_TIMEOUT_MS);
    const dir = freshUserDataDir();
    const errors: string[] = [];
    const { page, close } = await launchApp({ seed: 3, userDataDir: dir });
    try {
      page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));
      await playHands(page, 25);

      const gifts = readGifts(dir);
      assertGiftsAreReal(gifts);
      // Seed 3 reaches at least one revealed losing call, so this is not a vacuous pass.
      expect(gifts.length, 'seed 3 must observe a gift — the capture path is dead otherwise').toBeGreaterThan(0);

      // If the hero busted to home, get back to a screen with the profile tab.
      if ((await page.locator(sel.tabProfile).count()) === 0) {
        await page.waitForSelector(homeScreen);
      }
      await page.locator(sel.tabProfile).click();
      await expect(page.locator('[data-testid="profile-screen"]')).toBeVisible();

      await expect(page.locator(giftTotal)).toContainText('chips handed over');
      await expect(page.locator(giftRow)).toHaveCount(Math.min(gifts.length, 12));
      // Action-with-a-holding form, not a bare number.
      await expect(page.locator(giftRow).first()).toContainText('called with');
      expect(errors).toEqual([]);
    } finally {
      await close().catch(() => {});
    }
  });

  test('3. observed gifts survive a restart — the ledger is durable, not session-scoped', async () => {
    test.setTimeout(PLAY_TIMEOUT_MS);
    const dir = freshUserDataDir();
    const first = await launchApp({ seed: 3, userDataDir: dir });
    let before: PersistedGift[] = [];
    try {
      await playHands(first.page, 25);
      before = readGifts(dir);
      expect(before.length).toBeGreaterThan(0);
    } finally {
      await first.close().catch(() => {});
    }

    const second = await launchApp({ seed: 3, userDataDir: dir });
    try {
      await second.page.waitForSelector(homeScreen);
      await second.page.locator(sel.tabProfile).click();
      await expect(second.page.locator('[data-testid="profile-screen"]')).toBeVisible();
      await expect(second.page.locator(giftRow)).toHaveCount(Math.min(before.length, 12));
      // The persisted set is unchanged by the reload.
      expect(readGifts(dir)).toEqual(before);
    } finally {
      await second.close().catch(() => {});
    }
  });
});
