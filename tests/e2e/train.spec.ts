import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { launchApp } from './helpers.js';

const STATE_FILE = 'offsuit-state.json';

/**
 * Seed a save whose hands carry a T2 ('notable') leak on the given principle, so the remediation queue
 * the Leaks rung counts actually fires. Mirrors core/session.ts serialize() (the same shape contrast.spec
 * writes). Returns the userDataDir to launch against.
 */
function seedLeakSave(principle: string, count: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-train-'));
  const hands = Array.from({ length: count }, (_, i) => ({
    handNumber: i + 1,
    hole: ['Ah', 'Kd'],
    board: [],
    net: -100,
    vpip: true,
    pfr: false,
    grades: [{ severity: 'notable', principle, evLossBb: 1.2 }],
  }));
  fs.writeFileSync(
    path.join(dir, STATE_FILE),
    JSON.stringify({
      bankroll: 10000,
      hands,
      rebuys: 0,
      stats: {
        handsPlayed: count,
        vpipHands: count,
        pfrHands: 0,
        evLossBb: 1.2 * count,
        leaks: { [principle]: count },
        leakCostBb: { [principle]: 1.2 * count },
      },
    }),
    'utf-8',
  );
  return dir;
}

/**
 * THE TRAIN HUB — the left-rail screen that folded six former tabs (Spots·Math·Speed·Stress·Leaks·Upkeep)
 * behind one Train tab. These tests pin the hub's contract: the rail order and labels, the OLD tab testids
 * preserved on the rail buttons (so every deep-link spec still resolves), the default landing (Spots), the
 * single practice/maintenance divider, the data-active toggle, and — the load-bearing one — that a rail
 * switch FRESH-renders the body rather than caching a detached node (the RT-gated Speed screen would leak).
 */

const hub = '[data-testid="train-screen"]';
const rail = '[data-testid="train-rail"]';
const tabTrain = '[data-testid="tab-train"]';

const RAIL_ORDER: { testid: string; label: string }[] = [
  { testid: 'tab-puzzle', label: 'Spots' },
  { testid: 'tab-drill', label: 'Math' },
  { testid: 'tab-reading', label: 'Reading' },
  { testid: 'tab-anomaly', label: 'Speed' },
  { testid: 'tab-robustness', label: 'Stress' },
  { testid: 'tab-repair', label: 'Leaks' },
  { testid: 'tab-spacing', label: 'Upkeep' },
];

test.describe('the Train hub', () => {
  test('opens on Spots and lists the modes in rail order with their old testids', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await page.click(tabTrain);
      await page.waitForSelector(hub);

      // The rail carries every rung, in order, each labelled and keyed by its OLD tab testid.
      const rungs = await page.$$eval(`${rail} .train-rail-btn`, (btns) =>
        btns.map((b) => ({
          testid: (b as HTMLElement).dataset.testid ?? '',
          label: b.textContent?.trim() ?? '',
          active: (b as HTMLElement).dataset.active ?? '',
        })),
      );
      expect(rungs.map((r) => r.testid)).toEqual(RAIL_ORDER.map((m) => m.testid));
      for (let i = 0; i < RAIL_ORDER.length; i++) {
        expect(rungs[i].label).toContain(RAIL_ORDER[i].label);
      }

      // Default landing is Spots (the one surface usable with zero prior state), and it is the only
      // active rung. The Spots (puzzle) screen is mounted in the body.
      expect(rungs[0].active).toBe('true');
      expect(rungs.filter((r) => r.active === 'true')).toHaveLength(1);
      await expect(page.locator('[data-testid="puzzle-screen"]')).toBeVisible();
      await expect(page.locator(hub)).toHaveAttribute('data-mode', 'puzzle');
    } finally {
      await close();
    }
  });

  test('a single hairline divider separates the practice band from the maintenance band', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await page.click(tabTrain);
      await page.waitForSelector(hub);

      // Exactly one divider, positioned after Stress (the 4th rung) and before Leaks (the 5th).
      const dividers = await page.locator(`${rail} .train-rail-divider`).count();
      expect(dividers, 'the rail must have exactly one band divider').toBe(1);

      const order = await page.$$eval(`${rail} > *`, (els) =>
        els.map((el) =>
          el.classList.contains('train-rail-divider')
            ? 'DIVIDER'
            : ((el as HTMLElement).dataset.testid ?? '?'),
        ),
      );
      const dividerAt = order.indexOf('DIVIDER');
      expect(order[dividerAt - 1]).toBe('tab-robustness'); // Stress ends the practice band
      expect(order[dividerAt + 1]).toBe('tab-repair'); // Leaks opens the maintenance band
    } finally {
      await close();
    }
  });

  test('clicking a rail rung swaps the body and moves the active marker', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await page.click(tabTrain);
      await page.waitForSelector(hub);

      // Switch to Math (drill): the body swaps to the drill screen, data-mode updates, and the active
      // marker moves off Spots onto Math.
      await page.click('[data-testid="tab-drill"]');
      await expect(page.locator('[data-testid="drill-screen"]')).toBeVisible();
      await expect(page.locator(hub)).toHaveAttribute('data-mode', 'drill');
      await expect(page.locator('[data-testid="tab-drill"]')).toHaveAttribute('data-active', 'true');
      await expect(page.locator('[data-testid="tab-puzzle"]')).toHaveAttribute('data-active', 'false');
      // The old surface is gone, not merely hidden — one body child at a time.
      await expect(page.locator('[data-testid="puzzle-screen"]')).toHaveCount(0);
    } finally {
      await close();
    }
  });

  test('switching away from the RT-gated Speed screen tears it down (no cached, key-eating node)', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await page.click(tabTrain);
      await page.waitForSelector(hub);

      // Open Speed (anomaly), then stash its node and switch to another rung.
      await page.click('[data-testid="tab-anomaly"]');
      await expect(page.locator('[data-testid="anomaly-screen"]')).toBeVisible();
      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="anomaly-screen"]');
        (window as unknown as { stash?: Element | null }).stash = el;
      });

      await page.click('[data-testid="tab-drill"]');
      await expect(page.locator('[data-testid="drill-screen"]')).toBeVisible();
      // The Speed screen is detached — a fresh render replaced it rather than parking it in the DOM.
      await expect(page.locator('[data-testid="anomaly-screen"]')).toHaveCount(0);

      // A leaked keydown listener would grade a slot on the stashed (detached) node; press its keys and
      // prove the stash never advanced.
      await page.keyboard.press('y');
      await page.keyboard.press('n');
      await page.keyboard.press('Enter');
      const stashed = await page.evaluate(() => {
        const el = (window as unknown as { stash?: HTMLElement | null }).stash;
        return el == null ? null : { answered: el.dataset.answered ?? '?' };
      });
      expect(stashed, 'the Speed screen node went missing').not.toBeNull();
      expect(stashed?.answered, 'a leaked listener graded a slot on the detached Speed screen').toBe('0');
    } finally {
      await close();
    }
  });

  test('the rail is keyboard navigable: ArrowDown moves and activates the next rung', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await page.click(tabTrain);
      await page.waitForSelector(hub);

      // Focus the active rung (Spots), then ArrowDown → Math.
      await page.locator('[data-testid="tab-puzzle"]').focus();
      await page.keyboard.press('ArrowDown');
      await expect(page.locator(hub)).toHaveAttribute('data-mode', 'drill');
      await expect(page.locator('[data-testid="tab-drill"]')).toHaveAttribute('data-active', 'true');
    } finally {
      await close();
    }
  });

  test('a fresh profile shows NO rung counts — nothing is fabricated', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await page.click(tabTrain);
      await page.waitForSelector(hub);
      // No hands played, nothing due: the maintenance rungs carry no count at all (zero-suppressed).
      await expect(page.locator('[data-testid="train-rail-note"]')).toHaveCount(0);
    } finally {
      await close();
    }
  });

  test('the Leaks rung shows a real "N to fix" count when leaks have actually fired', async () => {
    // Seed hands with T2 ('notable') 'pot odds' leaks so the remediation queue fires. The count is the
    // fired entries, not the whole manifest — a fresh profile (test above) shows nothing.
    const userDataDir = seedLeakSave('pot odds', 3);
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.click(tabTrain);
      await page.waitForSelector(hub);

      // The note rides on the Leaks (repair) rung, and reads as a plain "N to fix" — a count, not a badge.
      const leaksNote = page.locator('[data-testid="tab-repair"] [data-testid="train-rail-note"]');
      await expect(leaksNote).toHaveCount(1);
      const text = (await leaksNote.textContent()) ?? '';
      expect(text).toMatch(/^\d+ to fix$/);
      // At least one entry fired (the exact manifest count for 'pot odds' is core's business, not this test's).
      const n = Number(text.replace(' to fix', ''));
      expect(n).toBeGreaterThan(0);

      // BANNED_PHRASINGS stays clean on the rail: no rank/level/streak/xp leaked into the count.
      const lower = text.toLowerCase();
      for (const banned of ['rank', 'level', 'streak', 'xp', 'badge', 'percentile']) {
        expect(lower, `rail note "${text}" leaked a banned word`).not.toContain(banned);
      }
    } finally {
      await close();
    }
  });
});
