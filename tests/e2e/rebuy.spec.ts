import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, sel, shot } from './helpers.js';
import { chipTotal, playToShowdown, snapshot, tableScreen, waitForIdle } from './flow.js';

/**
 * MID-SESSION REBUY.
 *
 * Busting used to end the table: the hero sat out and the only way on was "New session", which
 * threw away handNumber, the dealer rotation and the table itself. A rebuy tops the hero back to
 * 5000 and deals the next hand at the SAME table.
 *
 * CHIP TOTALS: a rebuy injects 5000 chips, so flow.ts's CHIPS_IN_PLAY no longer describes the
 * table and is deliberately not imported here. Expected totals are computed locally as
 * BASE_CHIPS + START_STACK * rebuys.
 *
 * ACCOUNTING RULE UNDER TEST: a rebuy does NOT debit the bankroll. `bankroll` is total net worth
 * (pocket + chips in front of the hero); sitting down for 5000 never debited it, and the 5000 was
 * already taken out of it hand by hand as it was lost — that loss is what emptied the stack.
 * Debiting again would charge twice for the same chips. The invariant is therefore
 * `bankroll === 10000 + sum(hand nets)` regardless of rebuys, which is asserted arithmetically
 * below: a bust-and-rebuy cycle leaves the player down exactly 5000, never up.
 *
 * Sync rule: never sleep. The table root publishes data-awaiting on every render.
 */

const STATE_FILE = 'offsuit-state.json';
const START_STACK = 5000;
const DEFAULT_BANKROLL = 10000;
/** 4 seats x 5000 before any rebuy. */
const BASE_CHIPS = 20_000;

/** Pinned in allin.spec.ts: on seed 2 the hero's preflop shove loses and busts the stack to 0. */
const SEED_HERO_BUSTS = 2;
/** Pinned in allin.spec.ts: on seed 42 the hero's shove wins, so the hero is never busted. */
const SEED_HERO_WINS = 42;

const btnRebuy = '[data-testid="btn-rebuy"]';
const newSession = '[data-testid="new-session"]';
const sessionOver = '[data-testid="session-over"]';
const nextHand = '[data-testid="next-hand"]';
const winnerSummary = '[data-testid="winner-summary"]';
const homeScreen = '[data-testid="home-screen"]';
const profileScreen = '[data-testid="profile-screen"]';
const rebuyCount = '[data-testid="rebuy-count"]';
const rebuyCaption = '[data-testid="rebuy-caption"]';
const heroSeat = '[data-testid="seat"][data-seat-id="0"]';
const presetAllin = '[data-testid="preset-allin"]';
const FACE_UP_CARD = /^[2-9TJQKA][shdc]$/;

interface PersistedState {
  bankroll: number;
  rebuys?: number;
  hands: { handNumber: number; net: number }[];
  stats: { handsPlayed: number };
}

function freshUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-rebuy-'));
}

function readPersisted(userDataDir: string): PersistedState {
  const raw = fs.readFileSync(path.join(userDataDir, STATE_FILE), 'utf-8');
  return JSON.parse(raw) as PersistedState;
}

/** The save is an async IPC round-trip fired after the render; poll, never race. */
async function waitForPersistedRebuys(userDataDir: string, rebuys: number): Promise<void> {
  await expect
    .poll(() => {
      try {
        return readPersisted(userDataDir).rebuys ?? -1;
      } catch {
        return -1;
      }
    })
    .toBe(rebuys);
}

async function sitDown(page: Page): Promise<void> {
  await page.waitForSelector(homeScreen);
  await page.locator(sel.newHand).click();
  await page.locator(tableScreen).waitFor();
  await waitForIdle(page);
}

/**
 * Commit the hero's whole stack when the controls allow it, else keep the hand moving.
 * btn-call already all-ins when the hero cannot cover the bet, so this always puts the hero's
 * chips at maximum risk — the fastest honest route to a bust.
 */
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
 * Shove every hand until the hero's stack is 0 at handover. Returns the number of hands played.
 * Bounded so a broken bust path fails loudly instead of hanging the runner.
 */
async function bustHero(page: Page, maxHands = 14): Promise<number> {
  for (let hand = 1; hand <= maxHands; hand++) {
    for (let action = 0; action < 40; action++) {
      if ((await waitForIdle(page)) === 'handover') break;
      await shoveOrKeepMoving(page);
    }
    await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'handover');
    if ((await snapshot(page)).stacks[0] === 0) return hand;
    await page.locator(nextHand).click();
  }
  throw new Error(`hero still had chips after ${maxHands} all-in hands`);
}

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

async function dealerSeatId(page: Page): Promise<number> {
  return page.evaluate(() => {
    const seats = [...document.querySelectorAll<HTMLElement>('[data-testid="seat"]')];
    const withButton = seats.find((s) => s.querySelector('[data-testid="dealer-button"]') !== null);
    return withButton === undefined ? -1 : Number(withButton.dataset.seatId);
  });
}

/** Cards rendered inside a seat pod (the hero's own pod, not the big hero-cards row). */
async function heroSeatCardCount(page: Page): Promise<number> {
  return page.locator(`${heroSeat} [data-testid="card"]`).count();
}

/** Chips the hero has already pushed in this street; the pod omits the element at 0. */
async function heroCommitted(page: Page): Promise<number> {
  const chips = page.locator(`${heroSeat} [data-testid="seat-committed"]`);
  if ((await chips.count()) === 0) return 0;
  return Number((await chips.textContent()) ?? '0');
}

test.describe('mid-session rebuy', () => {
  test('1. the rebuy control appears only when the hero is busted at handover', async () => {
    const { page, close } = await launchApp({ seed: SEED_HERO_BUSTS, userDataDir: freshUserDataDir() });
    try {
      await sitDown(page);

      // Mid-hand, hero holding chips: no rebuy offer anywhere.
      await expect(page.locator(btnRebuy)).toHaveCount(0);
      await expect(page.locator(sessionOver)).toHaveCount(0);

      await bustHero(page);
      expect((await snapshot(page)).stacks[0], 'seed 2 is pinned to bust the hero').toBe(0);

      // Busted at handover: rebuy AND new session, and no dead "Next hand".
      await expect(page.locator(btnRebuy)).toBeVisible();
      await expect(page.locator(btnRebuy)).toBeEnabled();
      await expect(page.locator(newSession)).toBeVisible();
      await expect(page.locator(nextHand)).toHaveCount(0);
      const over = (await page.textContent(sessionOver)) ?? '';
      expect(over).toContain('Rebuy');
      expect(over).toContain(String(START_STACK));
      await shot(page, 'rebuy-offered');
    } finally {
      await close();
    }
  });

  test('2. a hero who still has chips at handover gets Next hand, never a rebuy', async () => {
    const { page, close } = await launchApp({ seed: SEED_HERO_WINS, userDataDir: freshUserDataDir() });
    try {
      await sitDown(page);
      await playToShowdown(page);

      const snap = await snapshot(page);
      expect(snap.stacks[0], 'seed 42 must leave the hero with chips').toBeGreaterThan(0);
      await expect(page.locator(winnerSummary)).toBeVisible();
      await expect(page.locator(nextHand)).toBeVisible();
      await expect(page.locator(btnRebuy)).toHaveCount(0);
      await expect(page.locator(sessionOver)).toHaveCount(0);
      await expect(page.locator(newSession)).toHaveCount(0);

      // And it stays that way on a second solvent hand.
      await page.locator(nextHand).click();
      await playToShowdown(page);
      expect((await snapshot(page)).stacks[0]).toBeGreaterThan(0);
      await expect(page.locator(btnRebuy)).toHaveCount(0);
    } finally {
      await close();
    }
  });

  test('3. clicking Rebuy restores 5000 and deals the hero into the next hand', async () => {
    const { page, close } = await launchApp({ seed: SEED_HERO_BUSTS, userDataDir: freshUserDataDir() });
    try {
      await sitDown(page);
      await bustHero(page);
      const busted = await snapshot(page);
      expect(busted.stacks[0]).toBe(0);
      // A busted hero is folded and holds no cards in its pod once the next hand starts.
      const dealerBefore = await dealerSeatId(page);

      await page.locator(btnRebuy).click();
      await waitForIdle(page);

      const fresh = await snapshot(page);
      // Stack + committed: the hero may already have posted a blind on the new hand.
      expect(fresh.stacks[0] + (await heroCommitted(page)), 'rebuy tops the hero up to a full stack').toBe(
        START_STACK,
      );

      // Dealt in, not sitting out.
      await expect(page.locator(heroSeat)).not.toHaveAttribute('data-folded', 'true');
      expect(await heroSeatCardCount(page)).toBe(2);
      expect(fresh.heroCards).toHaveLength(2);
      for (const card of fresh.heroCards) expect(card).toMatch(FACE_UP_CARD);
      expect(fresh.heroCards).not.toEqual(busted.heroCards);
      await expect(page.locator(winnerSummary)).toHaveCount(0);
      await expect(page.locator(btnRebuy)).toHaveCount(0);

      // Same table: the dealer rotated by one seat instead of resetting.
      expect(await dealerSeatId(page)).toBe((dealerBefore + 1) % 4);
      await shot(page, 'rebuy-continued');
    } finally {
      await close();
    }
  });

  test('4. the hand after a rebuy is playable to showdown and keeps the hand numbering', async () => {
    const userDataDir = freshUserDataDir();
    const { page, close } = await launchApp({ seed: SEED_HERO_BUSTS, userDataDir });
    try {
      await sitDown(page);
      const handsToBust = await bustHero(page);
      await page.locator(btnRebuy).click();
      await waitForIdle(page);

      await playToShowdown(page);
      await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'handover');
      await expect(page.locator(winnerSummary)).toBeVisible();
      expect((await page.textContent(winnerSummary)) ?? '').toMatch(/wins \d+/);

      // handNumber continued at the same table rather than restarting at 1.
      await expect
        .poll(() => {
          try {
            return readPersisted(userDataDir).stats.handsPlayed;
          } catch {
            return -1;
          }
        })
        .toBe(handsToBust + 1);
      const persisted = readPersisted(userDataDir);
      expect(persisted.hands.map((h) => h.handNumber)).toEqual(
        Array.from({ length: handsToBust + 1 }, (_, i) => i + 1),
      );
    } finally {
      await close();
    }
  });

  test('5. chips in play rise by exactly 5000 and are conserved thereafter', async () => {
    const { page, close } = await launchApp({ seed: SEED_HERO_BUSTS, userDataDir: freshUserDataDir() });
    try {
      await sitDown(page);
      expect(chipTotal(await snapshot(page)), 'chips before any rebuy').toBe(BASE_CHIPS);

      await bustHero(page);
      expect(chipTotal(await snapshot(page)), 'busting must not create or destroy chips').toBe(
        BASE_CHIPS,
      );

      await page.locator(btnRebuy).click();
      await waitForIdle(page);

      const expected = BASE_CHIPS + START_STACK;
      expect(chipTotal(await snapshot(page)), 'the rebuy injected exactly one stack').toBe(expected);
      expect(chipTotal(await snapshot(page)) - BASE_CHIPS).toBe(START_STACK);

      // Conserved from here on: through the hand, at handover, and into the next deal.
      await playToShowdown(page);
      const settled = await snapshot(page);
      expect(settled.pot, 'a settled pot must be fully distributed').toBe(0);
      expect(chipTotal(settled), 'chips minted or burned at showdown').toBe(expected);
      expect(settled.stacks.reduce((a, b) => a + b, 0)).toBe(expected);

      if ((await page.locator(nextHand).count()) === 1) {
        await page.locator(nextHand).click();
        await waitForIdle(page);
        expect(chipTotal(await snapshot(page)), 'conservation on the next deal').toBe(expected);
      }
    } finally {
      await close();
    }
  });

  test('6. a rebuy does not move the bankroll — the arithmetic, stated', async () => {
    const userDataDir = freshUserDataDir();
    const { page, close } = await launchApp({ seed: SEED_HERO_BUSTS, userDataDir });
    try {
      expect(await readBankroll(page)).toBe(DEFAULT_BANKROLL);
      await sitDown(page);
      const handsToBust = await bustHero(page);
      expect((await snapshot(page)).stacks[0]).toBe(0);

      await expect
        .poll(() => {
          try {
            return readPersisted(userDataDir).stats.handsPlayed;
          } catch {
            return -1;
          }
        })
        .toBe(handsToBust);
      const afterBust = readPersisted(userDataDir);
      const netSum = afterBust.hands.reduce((a, h) => a + h.net, 0);

      // Busting means the hand nets sum to exactly minus one stack.
      expect(netSum).toBe(-START_STACK);
      expect(afterBust.bankroll).toBe(DEFAULT_BANKROLL - START_STACK);
      expect(afterBust.rebuys ?? 0).toBe(0);

      await page.locator(btnRebuy).click();
      await waitForPersistedRebuys(userDataDir, 1);

      const afterRebuy = readPersisted(userDataDir);
      // THE RULE: the rebuy is an internal transfer, so the bankroll delta is zero.
      expect(afterRebuy.bankroll - afterBust.bankroll).toBe(0);
      expect(afterRebuy.bankroll).toBe(DEFAULT_BANKROLL - START_STACK);
      // The single identity: bankroll = start + sum(nets), with rebuys absent from it.
      expect(afterRebuy.bankroll).toBe(DEFAULT_BANKROLL + netSum);
      expect(afterRebuy.stats.handsPlayed, 'a rebuy is not a hand').toBe(handsToBust);
      // No free value: after a bust-and-rebuy cycle the player is down a stack, never up.
      expect(afterRebuy.bankroll).toBeLessThan(DEFAULT_BANKROLL);

      // And the number the UI shows agrees with the file.
      await returnHome(page);
      expect(await readBankroll(page)).toBe(DEFAULT_BANKROLL - START_STACK);
    } finally {
      await close();
    }
  });

  test('7. the rebuy count survives an app restart', async () => {
    const userDataDir = freshUserDataDir();
    let bankrollAfterRebuy = -1;

    const first = await launchApp({ seed: SEED_HERO_BUSTS, userDataDir });
    try {
      await sitDown(first.page);
      await bustHero(first.page);
      await first.page.locator(btnRebuy).click();
      await waitForPersistedRebuys(userDataDir, 1);
      expect(readPersisted(userDataDir).rebuys).toBe(1);
      bankrollAfterRebuy = readPersisted(userDataDir).bankroll;
    } finally {
      await first.close();
    }

    const second = await launchApp({ seed: SEED_HERO_BUSTS, userDataDir });
    try {
      await second.page.waitForSelector(homeScreen);
      expect(await readBankroll(second.page)).toBe(bankrollAfterRebuy);

      await second.page.click(sel.tabProfile);
      await second.page.waitForSelector(profileScreen);
      await expect(second.page.locator(rebuyCount)).toHaveText('1');
    } finally {
      await second.close();
    }
  });

  test('8. the profile screen reports the rebuy count', async () => {
    const { page, close } = await launchApp({ seed: SEED_HERO_BUSTS, userDataDir: freshUserDataDir() });
    try {
      // Before any rebuy: an honest zero, not a blank.
      await page.waitForSelector(homeScreen);
      await page.click(sel.tabProfile);
      await page.waitForSelector(profileScreen);
      await expect(page.locator(rebuyCount)).toHaveText('0');
      await expect(page.locator(rebuyCaption)).toHaveText('No rebuys');

      await page.click(sel.tabPlay);
      await sitDown(page);
      await bustHero(page);
      await page.locator(btnRebuy).click();
      await waitForIdle(page);

      await page.click(sel.tabProfile);
      await page.waitForSelector(profileScreen);
      await expect(page.locator(rebuyCount)).toHaveText('1');
      await expect(page.locator(rebuyCaption)).toHaveText('1 rebuy this session');
      expect(await page.innerText(profileScreen)).not.toMatch(/NaN|undefined/);
      await shot(page, 'rebuy-profile');
    } finally {
      await close();
    }
  });

  test('9. two consecutive rebuys work and each injects one more stack', async () => {
    test.setTimeout(180_000);
    const userDataDir = freshUserDataDir();
    const { page, close } = await launchApp({ seed: SEED_HERO_BUSTS, userDataDir });
    try {
      await sitDown(page);

      let handsPlayed = await bustHero(page);
      await page.locator(btnRebuy).click();
      await waitForIdle(page);
      expect(chipTotal(await snapshot(page))).toBe(BASE_CHIPS + START_STACK);

      handsPlayed += await bustHero(page);
      expect((await snapshot(page)).stacks[0], 'hero must be busted again').toBe(0);
      await expect(page.locator(btnRebuy)).toBeVisible();

      await page.locator(btnRebuy).click();
      await waitForIdle(page);

      expect(chipTotal(await snapshot(page))).toBe(BASE_CHIPS + 2 * START_STACK);
      await expect(page.locator(heroSeat)).not.toHaveAttribute('data-folded', 'true');
      expect(await heroSeatCardCount(page)).toBe(2);

      await waitForPersistedRebuys(userDataDir, 2);
      const persisted = readPersisted(userDataDir);
      expect(persisted.rebuys).toBe(2);
      expect(persisted.stats.handsPlayed, 'rebuys are not hands').toBe(handsPlayed);
      // Two busts, two rebuys: down exactly two stacks and not a chip more.
      expect(persisted.hands.reduce((a, h) => a + h.net, 0)).toBe(-2 * START_STACK);
      expect(persisted.bankroll).toBe(DEFAULT_BANKROLL - 2 * START_STACK);

      await page.click(sel.tabProfile);
      await page.waitForSelector(profileScreen);
      await expect(page.locator(rebuyCount)).toHaveText('2');
      await expect(page.locator(rebuyCaption)).toHaveText('2 rebuys this session');
    } finally {
      await close();
    }
  });

  test('10. New session still works alongside Rebuy and counts no rebuy', async () => {
    const userDataDir = freshUserDataDir();
    const { page, close } = await launchApp({ seed: SEED_HERO_BUSTS, userDataDir });
    try {
      await sitDown(page);
      const handsToBust = await bustHero(page);
      await expect(page.locator(btnRebuy)).toBeVisible();

      await page.locator(newSession).click();
      await page.waitForSelector(homeScreen);
      await page.locator(sel.newHand).click();
      await page.waitForSelector(tableScreen);
      await waitForIdle(page);

      const fresh = await snapshot(page);
      expect(fresh.heroCards).toHaveLength(2);
      // A brand-new table: four full stacks, no injected chips.
      expect(chipTotal(fresh), 'new session must not inherit rebuy chips').toBe(BASE_CHIPS);

      await expect
        .poll(() => {
          try {
            return readPersisted(userDataDir).rebuys ?? -1;
          } catch {
            return -1;
          }
        })
        .toBe(0);
      expect(readPersisted(userDataDir).stats.handsPlayed).toBe(handsToBust);
    } finally {
      await close();
    }
  });

  test('11. a busted hero who does not rebuy stays out, with no dead controls', async () => {
    const { page, close } = await launchApp({ seed: SEED_HERO_BUSTS, userDataDir: freshUserDataDir() });
    try {
      await sitDown(page);
      await bustHero(page);

      const busted = await snapshot(page);
      expect(busted.stacks[0]).toBe(0);

      // The terminal state offers exactly two ways on, and no way to act in a hand.
      await expect(page.locator(nextHand)).toHaveCount(0);
      await expect(page.locator(sel.btnFold)).toHaveCount(0);
      await expect(page.locator(sel.btnCheck)).toHaveCount(0);
      await expect(page.locator(sel.btnCall)).toHaveCount(0);
      await expect(page.locator(sel.btnRaise)).toHaveCount(0);
      await expect(page.locator(btnRebuy)).toHaveCount(1);
      await expect(page.locator(newSession)).toHaveCount(1);

      // Keyboard shortcuts cannot smuggle the busted hero back into the action either.
      for (const key of ['f', 'c', 'r', 'a']) await page.keyboard.press(key);
      await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'handover');
      const still = await snapshot(page);
      expect(still.stacks[0], 'a busted hero cannot act their way to chips').toBe(0);
      expect(chipTotal(still)).toBe(BASE_CHIPS);
      await expect(page.locator(btnRebuy)).toBeVisible();
    } finally {
      await close();
    }
  });
});
