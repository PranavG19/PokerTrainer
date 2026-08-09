import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertNoNetwork, launchApp, sel, shot } from './helpers.js';

const STATE_FILE = 'offsuit-state.json';
const DEFAULT_BANKROLL = 10000;
const MAX_ACTIONS_PER_HAND = 40;

const tableScreen = '[data-testid="table-screen"]';
const nextHand = '[data-testid="next-hand"]';
const winnerSummary = '[data-testid="winner-summary"]';
const homeScreen = '[data-testid="home-screen"]';
const profileScreen = '[data-testid="profile-screen"]';
const handRow = '[data-testid="hand-row"]';

interface PersistedState {
  bankroll: number;
  hands: unknown[];
  stats: { handsPlayed: number };
}

function freshUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-persist-'));
}

function stateFilePath(userDataDir: string): string {
  return path.join(userDataDir, STATE_FILE);
}

function readPersisted(userDataDir: string): PersistedState {
  const raw = fs.readFileSync(stateFilePath(userDataDir), 'utf-8');
  return JSON.parse(raw) as PersistedState;
}

/**
 * The save is an async IPC round-trip kicked off *after* data-awaiting flips to
 * 'handover', so the file lags the UI by a tick. Poll instead of racing it.
 */
async function waitForPersistedHands(userDataDir: string, handsPlayed: number): Promise<void> {
  await expect
    .poll(() => {
      try {
        return readPersisted(userDataDir).stats.handsPlayed;
      } catch {
        return -1;
      }
    })
    .toBe(handsPlayed);
}

/** The table root publishes whose turn it is; never sleep, always wait for a settled state. */
async function waitForIdle(page: Page): Promise<'hero' | 'handover'> {
  await page.waitForFunction(() => {
    const root = document.querySelector('[data-testid="table-screen"]');
    const awaiting = root instanceof HTMLElement ? root.dataset.awaiting : undefined;
    return awaiting === 'hero' || awaiting === 'handover';
  });
  const awaiting = await page.getAttribute(tableScreen, 'data-awaiting');
  return awaiting === 'handover' ? 'handover' : 'hero';
}

/**
 * Drive the hero passively (check > call > fold) until the hand settles.
 * The iteration cap makes a stuck table fail loudly instead of hanging the runner.
 */
async function playToShowdown(page: Page): Promise<void> {
  for (let i = 0; i < MAX_ACTIONS_PER_HAND; i++) {
    if ((await waitForIdle(page)) === 'handover') {
      await expect(page.locator(nextHand)).toBeVisible();
      return;
    }
    const check = page.locator(sel.btnCheck);
    if (await check.isEnabled()) {
      await check.click();
      continue;
    }
    const call = page.locator(sel.btnCall);
    if (await call.isEnabled()) {
      await call.click();
      continue;
    }
    await page.locator(sel.btnFold).click();
  }
  throw new Error(`hand did not settle within ${MAX_ACTIONS_PER_HAND} hero actions`);
}

async function startFirstHand(page: Page): Promise<void> {
  await page.waitForSelector(homeScreen);
  await page.click(sel.newHand);
  await page.waitForSelector(tableScreen);
}

/** Leaving and re-entering the Play tab tears down the settled table, revealing Home again. */
async function returnHome(page: Page): Promise<void> {
  await page.click(sel.tabProfile);
  await page.waitForSelector(profileScreen);
  await page.click(sel.tabPlay);
  await page.waitForSelector(homeScreen);
}

async function readBankroll(page: Page): Promise<number> {
  const text = await page.textContent(sel.bankroll);
  const value = Number((text ?? '').trim());
  expect(Number.isFinite(value)).toBe(true);
  return value;
}

test.describe('persistence across restart (criterion #5)', () => {
  test('bankroll after a completed hand survives an app restart', async () => {
    const userDataDir = freshUserDataDir();

    let bankrollAfterHand = -1;
    const first = await launchApp({ seed: 42, userDataDir });
    try {
      expect(await readBankroll(first.page)).toBe(DEFAULT_BANKROLL);
      await startFirstHand(first.page);
      await playToShowdown(first.page);
      // The relaunch below can only see what reached disk before the app exited.
      await waitForPersistedHands(userDataDir, 1);
      await returnHome(first.page);
      bankrollAfterHand = await readBankroll(first.page);
    } finally {
      await first.close();
    }

    // A hand that ends level would make the restart assertion vacuous.
    expect(bankrollAfterHand).not.toBe(DEFAULT_BANKROLL);

    const second = await launchApp({ seed: 42, userDataDir });
    try {
      await second.page.waitForSelector(homeScreen);
      expect(await readBankroll(second.page)).toBe(bankrollAfterHand);
      await expect(second.page.locator(handRow)).toHaveCount(1);
    } finally {
      await second.close();
    }
  });

  test('state file on disk is valid JSON with a numeric bankroll and a hands array', async () => {
    const userDataDir = freshUserDataDir();
    const { page, close } = await launchApp({ seed: 11, userDataDir });
    try {
      await startFirstHand(page);
      await playToShowdown(page);
      await returnHome(page);
      const uiBankroll = await readBankroll(page);

      await waitForPersistedHands(userDataDir, 1);
      const persisted = readPersisted(userDataDir);
      expect(typeof persisted.bankroll).toBe('number');
      expect(Array.isArray(persisted.hands)).toBe(true);
      expect(persisted.hands).toHaveLength(1);
      expect(persisted.stats.handsPlayed).toBe(1);
      expect(Math.round(persisted.bankroll)).toBe(uiBankroll);
    } finally {
      await close();
    }
  });

  test('a different userDataDir starts fresh at the default bankroll', async () => {
    const seeded = freshUserDataDir();
    const seededRun = await launchApp({ seed: 5, userDataDir: seeded });
    try {
      await startFirstHand(seededRun.page);
      await playToShowdown(seededRun.page);
      await waitForPersistedHands(seeded, 1);
    } finally {
      await seededRun.close();
    }

    const isolated = await launchApp({ seed: 5, userDataDir: freshUserDataDir() });
    try {
      await isolated.page.waitForSelector(homeScreen);
      expect(await readBankroll(isolated.page)).toBe(DEFAULT_BANKROLL);
      await expect(isolated.page.locator('[data-testid="recent-empty"]')).toBeVisible();
      await expect(isolated.page.locator(handRow)).toHaveCount(0);
    } finally {
      await isolated.close();
    }
  });

  test('three hands accumulate in the persisted log and on the recent-hands list', async () => {
    const userDataDir = freshUserDataDir();
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await startFirstHand(page);
      for (let hand = 1; hand <= 3; hand++) {
        await playToShowdown(page);
        await waitForPersistedHands(userDataDir, hand);
        if (hand < 3) await page.click(nextHand);
      }

      const persisted = readPersisted(userDataDir);
      expect(persisted.hands).toHaveLength(3);

      await returnHome(page);
      await expect(page.locator(handRow)).toHaveCount(3);
      await expect(page.locator(`${handRow}[data-hand="3"]`)).toBeVisible();
    } finally {
      await close();
    }
  });
});

test.describe('corrupt save resilience', () => {
  for (const [label, garbage] of [
    ['truncated json', '{not json'],
    ['wrong-typed bankroll', '{"bankroll":"abc"}'],
    ['array instead of object', '[1,2,3]'],
  ] as const) {
    test(`boots to a usable home screen when the save file is ${label}`, async () => {
      const userDataDir = freshUserDataDir();
      fs.writeFileSync(stateFilePath(userDataDir), garbage, 'utf-8');

      const { page, close } = await launchApp({ seed: 42, userDataDir });
      try {
        await page.waitForSelector(homeScreen);
        expect(await readBankroll(page)).toBe(DEFAULT_BANKROLL);

        // "Usable" means playable, not merely painted.
        await page.click(sel.newHand);
        await page.waitForSelector(tableScreen);
        await expect(page.locator(`${sel.heroCards} ${sel.card}`)).toHaveCount(2);
        await playToShowdown(page);

        await waitForPersistedHands(userDataDir, 1);
      } finally {
        await close();
      }
    });
  }
});

test.describe('zero network (criterion #7)', () => {
  test('playing a hand attempts no non-local request and no http(s) request fails', async () => {
    const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
    try {
      const attempted = await assertNoNetwork(page);
      const routed: string[] = [];
      page.on('request', (request) => routed.push(request.url()));
      const failedHttp: string[] = [];
      page.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url())) failedHttp.push(request.url());
      });

      // Reload through the installed interceptor so an empty `attempted` list proves
      // silence rather than a dead route handler.
      await page.reload();
      await page.waitForSelector(homeScreen);
      expect(routed.some((url) => url.startsWith('file:'))).toBe(true);

      await startFirstHand(page);
      await playToShowdown(page);
      await page.click(sel.tabProfile);
      await page.waitForSelector(profileScreen);

      expect(attempted).toEqual([]);
      expect(failedHttp).toEqual([]);

      // And the main process actively blocks anything non-file, not just this app's code.
      const sentinel = await page.evaluate(() =>
        fetch('http://example.com/offsuit-sentinel')
          .then((response) => `reached ${response.status}`)
          .catch(() => 'blocked'),
      );
      expect(sentinel).toBe('blocked');
      expect(attempted.filter((url) => /^https?:/.test(url))).toEqual([]);
    } finally {
      await close();
    }
  });
});

test.describe('profile screen (R9)', () => {
  test('session graph, leak list and lifetime counters reflect hands played', async () => {
    const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
    try {
      await startFirstHand(page);
      await playToShowdown(page);
      await page.click(nextHand);
      await playToShowdown(page);

      await page.click(sel.tabProfile);
      await page.waitForSelector(profileScreen);

      const graphPoints = await page.getAttribute(
        '[data-testid="session-graph"] polyline',
        'points',
      );
      // hands + 1 points: the starting bankroll plus one per completed hand.
      expect((graphPoints ?? '').trim().split(/\s+/)).toHaveLength(3);

      await expect(page.locator('[data-testid="leak-list"]')).toBeVisible();

      const handsCounter = page
        .locator('.counter', { has: page.locator('.stat-label', { hasText: /^Hands$/ }) })
        .locator('.stat-value');
      expect(Number(await handsCounter.innerText())).toBe(2);
    } finally {
      await close();
    }
  });
});

test.describe('screenshots (criterion #4)', () => {
  test('captures home, table, showdown, stats-open and profile', async () => {
    const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
    try {
      await page.waitForSelector(homeScreen);
      await shot(page, 'home');

      await page.click(sel.newHand);
      await page.waitForSelector(tableScreen);
      await waitForIdle(page);
      await shot(page, 'table');

      // The sheet starts collapsed so the action pills fit in the 760px window. Prove the toggle
      // drives data-open in both directions, then leave it open for the screenshot.
      const sheet = page.locator(sel.statsSheet);
      await expect(sheet).toHaveAttribute('data-open', 'false');
      await page.click('[data-testid="stats-toggle"]');
      await expect(sheet).toHaveAttribute('data-open', 'true');
      await page.click('[data-testid="stats-toggle"]');
      await expect(sheet).toHaveAttribute('data-open', 'false');
      await page.click('[data-testid="stats-toggle"]');
      await expect(sheet).toHaveAttribute('data-open', 'true');
      await expect(page.locator(sel.winPct)).toHaveText(/^\d+%$/);
      await shot(page, 'stats-open');

      await playToShowdown(page);
      await expect(page.locator(winnerSummary)).toBeVisible();
      await shot(page, 'table-showdown');

      await page.click(sel.tabProfile);
      await page.waitForSelector(profileScreen);
      await shot(page, 'profile');
    } finally {
      await close();
    }
  });
});
