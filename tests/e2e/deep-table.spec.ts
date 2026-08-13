import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { launchApp, sel } from './helpers.js';
import { tableScreen, waitForIdle } from './flow.js';

/**
 * THE DEPTH CLIMB PAYOFF — a learner's earned STANDING sets the table depth, so a 200bb table is a
 * genuinely different (deeper) game than the default 100bb one. Depth is driven here by a persisted
 * depthFloor (the ratchet floor standing() never drops below), which is the honest, deterministic way
 * to place the learner at a depth without playing a full calibration. Calibrating (no floor) must still
 * deal the classic 100bb table, so nothing changes for a fresh profile.
 *
 * The AI's commitTax (ai.test.ts) is what makes a deep table honest to teach on; this spec only proves
 * the STACK wiring — that the earned depth actually reaches the felt.
 */

const STATE_FILE = 'offsuit-state.json';
const BB = 50; // matches table.ts

function seedDepthFloor(depthFloor: number, bankroll = 10000): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-depth-'));
  fs.writeFileSync(
    path.join(dir, STATE_FILE),
    JSON.stringify({
      bankroll,
      depthFloor,
      hands: [],
      rebuys: 0,
      stats: { handsPlayed: 0, vpipHands: 0, pfrHands: 0, evLossBb: 0, leaks: {}, leakCostBb: {} },
    }),
    'utf-8',
  );
  return dir;
}

/** The four seat stacks plus the pot — chips are conserved, so this equals seats × startStack. */
async function chipsInPlay(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const stacks = [...document.querySelectorAll<HTMLElement>('[data-testid="seat"]')].map((s) =>
      Number(s.querySelector('[data-testid="seat-stack"]')?.textContent ?? 'NaN'),
    );
    const potText = document.querySelector('[data-testid="pot"]')?.textContent ?? '0';
    const pot = Number(potText.replace(/[^0-9-]/g, ''));
    return stacks.reduce((a, b) => a + b, 0) + pot;
  });
}

test.describe('the Depth climb payoff sizes the table', () => {
  test('a Calibrating profile deals the classic 100bb table (4 × 5000 = 20000 chips)', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await page.waitForSelector(sel.newHand);
      await page.click(sel.newHand);
      await page.waitForSelector(tableScreen);
      await waitForIdle(page);
      // No earned depth → the default table. Chips in play is 4 seats × 5000.
      expect(await chipsInPlay(page)).toBe(20_000);
    } finally {
      await close();
    }
  });

  test('a 200bb earned depth deals a deep table (4 × 10000 = 40000 chips)', async () => {
    const userDataDir = seedDepthFloor(200);
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(sel.newHand);
      await page.click(sel.newHand);
      await page.waitForSelector(tableScreen);
      await waitForIdle(page);
      // 200bb × 50 chips/bb = 10000 per seat, four seats. Chips are conserved (stacks + pot), so the
      // total is exactly 40000 — proof the earned depth reached the felt, not just the label.
      expect(await chipsInPlay(page)).toBe(40_000);
    } finally {
      await close();
    }
  });

  test('a 40bb earned depth deals a short table (4 × 2000 = 8000 chips)', async () => {
    const userDataDir = seedDepthFloor(40);
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(sel.newHand);
      await page.click(sel.newHand);
      await page.waitForSelector(tableScreen);
      await waitForIdle(page);
      expect(await chipsInPlay(page)).toBe(8_000);
    } finally {
      await close();
    }
  });

  // ── Affordability bound: you cannot buy in deeper than you can back ──────────

  test('a broke learner with high earned depth still sits at the affordable stack, not the full depth', async () => {
    // 200bb depth would be 10000/seat, but a bankroll of only 3000 can back a shorter table. The hero's
    // buy-in is capped at the standard 5000 floor (max(bankroll, 5000)) so the hero + villains sit at
    // 5000 — the classic table — rather than a table deeper than the learner's net worth.
    const userDataDir = seedDepthFloor(200, 3000);
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(sel.newHand);
      await page.click(sel.newHand);
      await page.waitForSelector(tableScreen);
      await waitForIdle(page);
      // Capped at the 5000 floor → the classic 4 × 5000 = 20000 table, NOT 40000.
      expect(await chipsInPlay(page)).toBe(20_000);
    } finally {
      await close();
    }
  });

  test('an in-between bankroll caps the deep buy-in at what the learner owns', async () => {
    // 200bb depth (10000/seat) but bankroll 8000: the buy-in is min(10000, 8000) = 8000 per seat.
    const userDataDir = seedDepthFloor(200, 8000);
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(sel.newHand);
      await page.click(sel.newHand);
      await page.waitForSelector(tableScreen);
      await waitForIdle(page);
      expect(await chipsInPlay(page)).toBe(32_000); // 4 × 8000
    } finally {
      await close();
    }
  });
});
