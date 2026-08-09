import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, sel } from './helpers.js';
import { CHIPS_IN_PLAY, chipTotal, snapshot, tableScreen, waitForIdle } from './flow.js';

const STATE_FILE = 'offsuit-state.json';
const DEFAULT_BANKROLL = 10000;
const SB = 25;
const BB = 50;
/** One hand can need many hero decisions across four streets; the cap turns a stuck table into a failure. */
const MAX_ACTIONS_PER_HAND = 40;
const nextHandBtn = '[data-testid="next-hand"]';
const winnerSummary = '[data-testid="winner-summary"]';
const profileScreen = '[data-testid="profile-screen"]';
const homeScreen = '[data-testid="home-screen"]';

interface PersistedHand {
  handNumber: number;
  net: number;
  vpip: boolean;
  pfr: boolean;
}

interface Persisted {
  bankroll: number;
  hands: PersistedHand[];
  stats: { handsPlayed: number; vpipHands: number; pfrHands: number };
}

function freshUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-soak-'));
}

function readPersisted(userDataDir: string): Persisted {
  return JSON.parse(
    fs.readFileSync(path.join(userDataDir, STATE_FILE), 'utf-8'),
  ) as Persisted;
}

/** The save is an async IPC round-trip fired after 'handover' renders, so poll rather than race it. */
async function waitForPersistedHands(userDataDir: string, handsPlayed: number): Promise<Persisted> {
  await expect
    .poll(() => {
      try {
        return readPersisted(userDataDir).stats.handsPlayed;
      } catch {
        return -1;
      }
    })
    .toBe(handsPlayed);
  return readPersisted(userDataDir);
}

/** Collect every uncaught renderer exception; a silent one is exactly what a soak exists to catch. */
function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
  return errors;
}

async function sitDown(page: Page): Promise<void> {
  await page.waitForSelector(homeScreen);
  await page.locator(sel.newHand).click();
  await page.locator(tableScreen).waitFor();
}

async function assertConserved(page: Page, where: string): Promise<void> {
  expect(chipTotal(await snapshot(page)), `chips at ${where}`).toBe(CHIPS_IN_PLAY);
}

type HeroPlan = 'passive' | 'fold' | 'raise-then-passive';

/**
 * Drive one hand to settlement under a fixed plan, asserting conservation after every hero action.
 * 'raise-then-passive' raises once (half pot) and then falls back to check/call, so the hand still ends.
 */
async function playHand(page: Page, plan: HeroPlan): Promise<number> {
  let raised = false;
  let actions = 0;

  for (let i = 0; i < MAX_ACTIONS_PER_HAND; i++) {
    if ((await waitForIdle(page)) === 'handover') {
      await expect(page.locator(winnerSummary)).toBeVisible();
      return actions;
    }

    const fold = page.locator(sel.btnFold);
    const check = page.locator(sel.btnCheck);
    const call = page.locator(sel.btnCall);
    const raise = page.locator(sel.btnRaise);

    if (plan === 'fold') {
      await fold.click();
    } else if (plan === 'raise-then-passive' && !raised && (await raise.isEnabled())) {
      await page.locator('[data-testid="preset-half"]').click();
      await raise.click();
      raised = true;
    } else if (await check.isEnabled()) {
      await check.click();
    } else if (await call.isEnabled()) {
      await call.click();
    } else {
      throw new Error(`hero turn with no check/call available (action ${actions})`);
    }

    actions++;
    await assertConserved(page, `hero action ${actions}`);
  }

  throw new Error(`hand did not settle within ${MAX_ACTIONS_PER_HAND} hero actions`);
}

/** Read a Lifetime counter off the profile screen ("42%" -> 42). */
async function readCounterPercent(page: Page, label: string): Promise<number> {
  const value = await page
    .locator('.counter', { has: page.locator('.stat-label', { hasText: new RegExp(`^${label}$`) }) })
    .locator('.stat-value')
    .innerText();
  const parsed = Number(value.replace('%', ''));
  expect(Number.isFinite(parsed), `${label} counter "${value}" is numeric`).toBe(true);
  return parsed;
}

test.describe('multi-hand soak', () => {
  test('10 consecutive passive hands conserve chips, advance the hand count and never throw', async () => {
    // 10 hands x up to 12 AI turns x 450ms plus per-render equity work: the 60s default is far too tight.
    test.setTimeout(600_000);
    const HANDS = 10;
    const userDataDir = freshUserDataDir();
    const { page, close } = await launchApp({ seed: 7, userDataDir });
    const errors = watchPageErrors(page);

    try {
      await sitDown(page);

      for (let hand = 1; hand <= HANDS; hand++) {
        await playHand(page, 'passive');
        await assertConserved(page, `end of hand ${hand}`);

        const persisted = await waitForPersistedHands(userDataDir, hand);
        expect(persisted.stats.handsPlayed, `handsPlayed after hand ${hand}`).toBe(hand);
        expect(persisted.hands.at(-1)?.handNumber, `hand number of hand ${hand}`).toBe(hand);
        expect(errors, `renderer errors during hand ${hand}`).toEqual([]);

        if (hand < HANDS) await page.locator(nextHandBtn).click();
      }

      // Scenario 2: the ledger must add up exactly — no dropped or double-counted hand.
      const final = readPersisted(userDataDir);
      expect(final.stats.handsPlayed).toBe(HANDS);
      expect(final.hands).toHaveLength(HANDS);
      expect(final.hands.map((h) => h.handNumber)).toEqual(
        Array.from({ length: HANDS }, (_, i) => i + 1),
      );
      const netSum = final.hands.reduce((total, h) => total + h.net, 0);
      expect(final.bankroll).toBe(DEFAULT_BANKROLL + netSum);

      // Scenario 5: VPIP/PFR must stay sane after a long run.
      expect(final.stats.vpipHands).toBeGreaterThanOrEqual(final.stats.pfrHands);
      await page.locator(sel.tabProfile).click();
      await page.waitForSelector(profileScreen);
      const vpip = await readCounterPercent(page, 'VPIP');
      const pfr = await readCounterPercent(page, 'PFR');
      expect(vpip).toBeGreaterThanOrEqual(0);
      expect(vpip).toBeLessThanOrEqual(100);
      expect(pfr).toBeGreaterThanOrEqual(0);
      expect(pfr).toBeLessThanOrEqual(100);
      expect(pfr).toBeLessThanOrEqual(vpip);

      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });

  test('6 hands of mixed fold/call/raise keep chips conserved and never corrupt the next hand', async () => {
    test.setTimeout(600_000);
    const HANDS = 6;
    // Fixed by index, never random: a failure here replays identically.
    const plans: HeroPlan[] = ['fold', 'passive', 'raise-then-passive', 'fold', 'raise-then-passive', 'passive'];
    const userDataDir = freshUserDataDir();
    const { page, close } = await launchApp({ seed: 21, userDataDir });
    const errors = watchPageErrors(page);

    try {
      await sitDown(page);

      for (let hand = 1; hand <= HANDS; hand++) {
        await playHand(page, plans[hand - 1]);
        await assertConserved(page, `end of hand ${hand}`);

        const persisted = await waitForPersistedHands(userDataDir, hand);
        expect(persisted.hands.at(-1)?.handNumber, `hand number of hand ${hand}`).toBe(hand);
        expect(errors, `renderer errors during hand ${hand}`).toEqual([]);

        if (hand < HANDS) {
          await page.locator(nextHandBtn).click();
          // A fresh hand must deal the hero two live cards even when the previous one was folded.
          await waitForIdle(page);
          const snap = await snapshot(page);
          expect(snap.heroCards, `hero cards dealt for hand ${hand + 1}`).toHaveLength(2);
          expect(chipTotal(snap), `chips at start of hand ${hand + 1}`).toBe(CHIPS_IN_PLAY);
        }
      }

      const final = readPersisted(userDataDir);
      expect(final.hands).toHaveLength(HANDS);
      expect(final.bankroll).toBe(
        DEFAULT_BANKROLL + final.hands.reduce((total, h) => total + h.net, 0),
      );
      // Two hands in the plan raise preflop; if the raise path silently no-opped this whole
      // test would degenerate into the passive one.
      expect(final.stats.pfrHands).toBeGreaterThanOrEqual(1);
      expect(final.stats.vpipHands).toBeGreaterThanOrEqual(final.stats.pfrHands);
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });

  test('hand numbering keeps climbing when the table is re-mounted mid-soak', async () => {
    test.setTimeout(600_000);
    const userDataDir = freshUserDataDir();
    const { page, close } = await launchApp({ seed: 7, userDataDir });
    const errors = watchPageErrors(page);

    try {
      await sitDown(page);
      await playHand(page, 'passive');
      await waitForPersistedHands(userDataDir, 1);
      await page.locator(nextHandBtn).click();
      await playHand(page, 'passive');
      await waitForPersistedHands(userDataDir, 2);

      // Tear the table down by leaving the Play tab, then sit down again.
      await page.locator(sel.tabProfile).click();
      await page.waitForSelector(profileScreen);
      await page.locator(sel.tabPlay).click();
      await sitDown(page);
      await playHand(page, 'passive');
      const final = await waitForPersistedHands(userDataDir, 3);

      // A remounted table used to restart at hand 1, duplicating handNumber in the log and
      // re-dealing an already-seen hand (the shuffle is keyed on seed + handNumber).
      expect(final.hands.map((h) => h.handNumber)).toEqual([1, 2, 3]);
      expect(final.bankroll).toBe(
        DEFAULT_BANKROLL + final.hands.reduce((total, h) => total + h.net, 0),
      );
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });

  test('folding 5 hands in a row costs the hero only the blinds it posted', async () => {
    test.setTimeout(600_000);
    const HANDS = 5;
    const userDataDir = freshUserDataDir();
    const { page, close } = await launchApp({ seed: 3, userDataDir });
    const errors = watchPageErrors(page);

    try {
      await sitDown(page);

      for (let hand = 1; hand <= HANDS; hand++) {
        const heroActions = await playHand(page, 'fold');
        await assertConserved(page, `end of hand ${hand}`);
        // With this seed the action never folds around to the hero, so every hand really is a
        // post-and-fold. Asserting it keeps the strictly-negative total below meaningful: a walk
        // would win the hero chips and make the bound vacuous rather than tight.
        expect(heroActions, `hero folded in hand ${hand}`).toBe(1);

        const persisted = await waitForPersistedHands(userDataDir, hand);
        // A folded hand can never be a win, and can never cost more than the big blind posted.
        const net = persisted.hands.at(-1)?.net ?? NaN;
        expect(net, `net of folded hand ${hand}`).toBeLessThanOrEqual(0);
        expect(net, `net of folded hand ${hand}`).toBeGreaterThanOrEqual(-BB);
        expect(errors, `renderer errors during hand ${hand}`).toEqual([]);
        if (hand < HANDS) await page.locator(nextHandBtn).click();
      }

      const final = readPersisted(userDataDir);
      const lost = DEFAULT_BANKROLL - final.bankroll;
      // Over 5 four-handed hands the hero posts SB twice and BB once at most; bound it loosely
      // at 5 x (SB + BB) but require it to be a real loss, so leaking chips can't hide.
      expect(lost).toBeGreaterThan(0);
      expect(lost).toBeLessThanOrEqual(HANDS * (SB + BB));
      // A folding hero never volunteers a chip.
      expect(final.stats.vpipHands).toBe(0);
      expect(final.stats.pfrHands).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });
});
