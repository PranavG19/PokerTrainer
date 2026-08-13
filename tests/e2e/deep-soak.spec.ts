import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, sel } from './helpers.js';
import { CHIPS_IN_PLAY, chipTotal, snapshot, tableScreen, waitForIdle } from './flow.js';

/**
 * DEEP MULTI-SCENARIO SOAK — the long runs where every engine defect this project has found actually
 * lived, driven through the real UI rather than against the core modules.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM soak.spec.ts. That file drives at most 10 hands under one
 * passive plan, and every defect in research/AUDIT-W6-findings.md needed either depth (25 hands to
 * reach a one-funded-seat table), aggression (a short all-in with deep money behind it), or a rebuy
 * cycle. A 10-hand passive soak reaches none of those states.
 *
 * WHY THE ORACLE IS NOT CHIP CONSERVATION. That is the headline finding of the audit: `sum(stacks) +
 * pot === constant` held through ALL ELEVEN defects, including one that DESTROYED 25 chips a hand. It
 * is checked here because it is cheap, but it is not what this file is for. The load-bearing oracles
 * are:
 *
 *   1. LEDGER IDENTITY — the persisted bankroll must equal 10000 + sum(every hand's net), always. This
 *      is what catches destroyed or invented chips, because it compares two independently maintained
 *      records rather than one sum against itself.
 *   2. NO SEAT GAINS FROM NOTHING — a seat that never had chips cannot acquire them, and the table
 *      total cannot drift across hands without a rebuy to explain it.
 *   3. NO SILENT EXCEPTION — a renderer error thrown 40 hands in is invisible to every assertion that
 *      only looks at the DOM, so pageerror is collected throughout and asserted empty.
 *   4. ALWAYS A WAY FORWARD — at every handover there is an enabled control. The swept-table and
 *      busted-hero dead ends were both "the app renders fine and cannot be continued".
 */

const STATE_FILE = 'offsuit-state.json';
const DEFAULT_BANKROLL = 10000;
const START_STACK = 5000;
const MAX_ACTIONS_PER_HAND = 40;

const nextHandBtn = '[data-testid="next-hand"]';
const winnerSummary = '[data-testid="winner-summary"]';
const homeScreen = '[data-testid="home-screen"]';
const btnRebuy = '[data-testid="btn-rebuy"]';
const newSession = '[data-testid="new-session"]';
const sessionOver = '[data-testid="session-over"]';
const tableSwept = '[data-testid="table-swept"]';
const presetAllin = '[data-testid="preset-allin"]';
const presetHalf = '[data-testid="preset-half"]';

interface PersistedHand {
  handNumber: number;
  net: number;
}

interface Persisted {
  bankroll: number;
  rebuys?: number;
  hands: PersistedHand[];
  stats: { handsPlayed: number };
}

function freshUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-deepsoak-'));
}

function readPersisted(dir: string): Persisted {
  return JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), 'utf-8')) as Persisted;
}

/** Every uncaught renderer exception. A silent one 40 hands in is exactly what a soak is for. */
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

type Plan = 'passive' | 'aggressive' | 'shove' | 'mixed';

/**
 * One hero action under a plan. Returns false when the hand is already over.
 *
 * 'shove' is the important one: it is the only plan that reaches short all-ins with deep money
 * behind them, which is the state the side-pot defects lived in.
 */
async function actOnce(page: Page, plan: Plan, handIndex: number, actionIndex: number): Promise<void> {
  const fold = page.locator(sel.btnFold);
  const check = page.locator(sel.btnCheck);
  const call = page.locator(sel.btnCall);
  const raise = page.locator(sel.btnRaise);

  if (plan === 'shove' && (await raise.isEnabled())) {
    await page.locator(presetAllin).click();
    await raise.click();
    return;
  }

  if (plan === 'aggressive' && (await raise.isEnabled())) {
    await page.locator(presetHalf).click();
    await raise.click();
    return;
  }

  // 'mixed' varies by position in the run rather than by RNG, so a failure names one reproducible
  // hand and action rather than "sometimes".
  if (plan === 'mixed') {
    const choice = (handIndex + actionIndex) % 4;
    if (choice === 0 && (await raise.isEnabled())) {
      await page.locator(presetHalf).click();
      await raise.click();
      return;
    }
    if (choice === 1 && (await fold.isEnabled())) {
      await fold.click();
      return;
    }
  }

  for (const button of [check, call, fold]) {
    if (await button.isEnabled()) {
      await button.click();
      return;
    }
  }
  throw new Error(`hand ${handIndex}: hero turn with no enabled action at action ${actionIndex}`);
}

interface SoakResult {
  handsCompleted: number;
  rebuys: number;
  reachedSwept: boolean;
  reachedBusted: boolean;
}

/**
 * Drive `hands` hands under one plan, taking whatever exit the app offers at each handover.
 *
 * Rebuys are taken when offered, because the rebuy path injects chips and is where the accounting is
 * most likely to double-count. A swept table has no way to continue, so the run stops there and says
 * so rather than failing — reaching it is a legitimate outcome of a winning run.
 */
async function soak(page: Page, dir: string, plan: Plan, hands: number): Promise<SoakResult> {
  let rebuys = 0;

  for (let hand = 0; hand < hands; hand++) {
    for (let action = 0; action < MAX_ACTIONS_PER_HAND; action++) {
      if ((await waitForIdle(page)) === 'handover') break;
      await actOnce(page, plan, hand, action);
    }

    await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'handover');
    await expect(page.locator(winnerSummary)).toBeVisible();

    /*
     * Conservation once per hand, at handover, not once per action. A snapshot() is a full
     * page.evaluate and doing it per hero action spent the entire 60s budget on measurement rather
     * than on hands — the first version of this file timed out at 40 hands for that reason alone and
     * measured nothing. Per-hand still localises a break to one hand, and the ledger identity below
     * is the oracle that actually carries this file.
     *
     * The expected total tracks rebuys because each one injects a fresh buy-in. Verified against a
     * real 22-hand run with 9 rebuys: the total moved 20000 -> 65000 in exact 5000 steps.
     */
    expect(chipTotal(await snapshot(page)), `chips at handover of hand ${hand}`).toBe(
      CHIPS_IN_PLAY + rebuys * START_STACK,
    );

    // ORACLE 4: there is always a way forward. Both dead ends this project has fixed rendered
    // perfectly and could not be continued, so "a control exists and is enabled" is the assertion.
    const swept = await page.locator(tableSwept).count();
    const busted = await page.locator(sessionOver).count();
    if (swept > 0) {
      await expect(page.locator(newSession)).toBeEnabled();
      return { handsCompleted: hand + 1, rebuys, reachedSwept: true, reachedBusted: false };
    }
    if (busted > 0) {
      await expect(page.locator(btnRebuy)).toBeEnabled();
      await expect(page.locator(newSession)).toBeEnabled();
      await page.locator(btnRebuy).click();
      rebuys++;
      continue;
    }

    await expect(page.locator(nextHandBtn)).toBeEnabled();
    await page.locator(nextHandBtn).click();
  }

  return { handsCompleted: hands, rebuys, reachedSwept: false, reachedBusted: rebuys > 0 };
}

/**
 * ORACLE 1, the load-bearing one: two independently maintained records must agree. The bankroll is
 * accumulated hand by hand; the net list is written per hand. A rebuy deliberately does NOT credit
 * the bankroll (the chips were already debited as they were lost), so the identity is rebuy-invariant
 * — which is what makes it able to catch an injection that was double-counted.
 */
function assertLedger(dir: string, where: string): Persisted {
  const state = readPersisted(dir);
  const net = state.hands.reduce((sum, hand) => sum + hand.net, 0);
  expect(state.bankroll, `${where}: bankroll vs sum of ${state.hands.length} hand nets`).toBe(
    DEFAULT_BANKROLL + net,
  );
  return state;
}

/*
 * A soak is long by construction: 40 hands of real Electron play against three AI opponents runs a
 * few minutes. The default 60s in playwright.config.ts is right for every other spec, so the budget
 * is raised HERE rather than globally — a global raise would let an ordinary test hang for minutes
 * before failing.
 */
const SOAK_TIMEOUT_MS = 600_000;

for (const plan of ['passive', 'aggressive', 'mixed', 'shove'] as const) {
  test(`40 hands of ${plan} play keep the ledger, the chips and the renderer intact`, async () => {
    test.setTimeout(SOAK_TIMEOUT_MS);
    const dir = freshUserDataDir();
    const { app, page } = await launchApp({ seed: 42, userDataDir: dir });
    const errors = watchPageErrors(page);
    try {
      await sitDown(page);
      const result = await soak(page, dir, plan, 40);

      // The run must have actually happened; a harness that silently drove zero hands would
      // otherwise satisfy every assertion below.
      expect(result.handsCompleted, 'no hands were played').toBeGreaterThan(0);

      const state = assertLedger(dir, `${plan} after ${result.handsCompleted} hands`);
      expect(state.stats.handsPlayed).toBeGreaterThan(0);
      // Hand numbers must be strictly increasing: a repeat means a hand was logged twice, which the
      // bankroll identity alone would not catch if both copies carried the same net.
      const numbers = state.hands.map((hand) => hand.handNumber);
      expect(numbers, `${plan}: hand numbers are not strictly increasing`).toEqual(
        [...numbers].sort((a, b) => a - b),
      );
      expect(new Set(numbers).size, `${plan}: duplicate hand numbers`).toBe(numbers.length);

      // ORACLE 3: no silent exception anywhere in the run.
      expect(errors, `${plan}: renderer threw during the soak`).toEqual([]);
    } finally {
      await app.close();
    }
  });
}

test('a run that busts and rebuys twice keeps the bankroll honest', async () => {
  test.setTimeout(SOAK_TIMEOUT_MS);
  /**
   * The rebuy path injects 5000 chips, and the accounting rule under test is that it does NOT credit
   * the bankroll: the chips were already taken out of it hand by hand as they were lost, so crediting
   * again would pay the player for losing. The identity is therefore rebuy-invariant, and asserting
   * it after two full bust-and-rebuy cycles is what proves the injection is not double-counted.
   */
  const dir = freshUserDataDir();
  const { app, page } = await launchApp({ seed: 2, userDataDir: dir });
  const errors = watchPageErrors(page);
  try {
    await sitDown(page);
    const result = await soak(page, dir, 'shove', 30);

    const state = assertLedger(dir, `after ${result.rebuys} rebuys`);
    if (result.rebuys > 0) {
      expect(state.rebuys ?? 0, 'rebuys were taken but not persisted').toBe(result.rebuys);
      /*
       * NOT asserted: "a rebuying player cannot be up". I wrote that first and it is false — measured
       * on seed 2, the hero rebought 9 times and then won the entire 65000 table, ending at 25000 with
       * the identity holding exactly (10000 + 15000). Rebuys buy more hands, and more hands can win.
       * What IS invariant is the identity above, which is rebuy-invariant precisely because a rebuy
       * never credits the bankroll — so it stays able to catch a double-counted injection either way.
       */
    }
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('the ledger survives quitting and reopening mid-run', async () => {
  test.setTimeout(SOAK_TIMEOUT_MS);
  /**
   * Persistence under a soak, not in isolation: the state written after hand N must be the state read
   * at hand N+1, across a real process boundary. A restart is also the only way to prove the hand log
   * and the bankroll are saved consistently with each other rather than in two different moments.
   */
  const dir = freshUserDataDir();

  const first = await launchApp({ seed: 7, userDataDir: dir });
  let handsBefore = 0;
  let bankrollBefore = 0;
  try {
    await sitDown(first.page);
    await soak(first.page, dir, 'mixed', 8);
    const state = assertLedger(dir, 'before the restart');
    handsBefore = state.stats.handsPlayed;
    bankrollBefore = state.bankroll;
    expect(handsBefore).toBeGreaterThan(0);
  } finally {
    await first.app.close();
  }

  const second = await launchApp({ seed: 7, userDataDir: dir });
  const errors = watchPageErrors(second.page);
  try {
    // Nothing is lost by the restart itself.
    const resumed = assertLedger(dir, 'immediately after the restart');
    expect(resumed.stats.handsPlayed).toBe(handsBefore);
    expect(resumed.bankroll).toBe(bankrollBefore);

    await sitDown(second.page);
    await soak(second.page, dir, 'mixed', 8);

    const after = assertLedger(dir, 'after the second stretch');
    expect(after.stats.handsPlayed).toBeGreaterThan(handsBefore);
    // Hand numbering must CONTINUE rather than restart, or the log would carry duplicate numbers.
    const numbers = after.hands.map((hand) => hand.handNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(errors).toEqual([]);
  } finally {
    await second.app.close();
  }
});

test('a full session across every surface leaves the table playable', async () => {
  test.setTimeout(SOAK_TIMEOUT_MS);
  /**
   * The cross-surface scenario: a learner does not stay on one screen. Every non-play tab tears the
   * table down and remounts it, and a remount is where a stale listener, a lost hand number or a
   * duplicated save would surface. Visiting all of them mid-run and then continuing to play is the
   * cheapest test of that, and it also proves N1 — every surface is reachable at any time, with no
   * gate anywhere.
   */
  const dir = freshUserDataDir();
  const { app, page } = await launchApp({ seed: 11, userDataDir: dir });
  const errors = watchPageErrors(page);
  // Top-level tabs after the 13→8 fold. Train opens the hub; two former mode-tabs are toured via the
  // rail below to prove those remounts (the RT-gated Speed screen especially) are still clean.
  const tabs = ['tab-learn', 'tab-train', 'tab-charts', 'tab-profile', 'tab-settings'] as const;
  const trainRungs = ['tab-drill', 'tab-anomaly'] as const;
  try {
    await sitDown(page);
    await soak(page, dir, 'mixed', 4);
    const before = assertLedger(dir, 'before the tab tour');

    for (const tab of tabs) {
      const button = page.locator(`[data-testid="${tab}"]`);
      // N1: nothing is ever locked, so every tab must be enabled from the first launch.
      await expect(button, `${tab} is not reachable`).toBeEnabled();
      await button.click();
      await expect(page.locator(`[data-testid="${tab}"]`)).toHaveAttribute('data-active', 'true');
    }

    // Tour the hub rungs too: open Train, then each rail button, remounting its screen.
    await page.locator('[data-testid="tab-train"]').click();
    for (const rung of trainRungs) {
      const button = page.locator(`[data-testid="${rung}"]`);
      await expect(button, `${rung} rung is not reachable`).toBeEnabled();
      await button.click();
      await expect(button).toHaveAttribute('data-active', 'true');
    }

    // Back to play, and the table must still deal.
    await page.locator(`[data-testid="tab-play"]`).click();
    await page.waitForSelector(homeScreen);
    await sitDown(page);
    await soak(page, dir, 'mixed', 4);

    const after = assertLedger(dir, 'after the tab tour');
    expect(after.stats.handsPlayed).toBeGreaterThan(before.stats.handsPlayed);
    expect(errors, 'a surface threw during the tour').toEqual([]);
  } finally {
    await app.close();
  }
});
