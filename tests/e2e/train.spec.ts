import { expect, test } from '@playwright/test';
import { launchApp } from './helpers.js';

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
  { testid: 'tab-anomaly', label: 'Speed' },
  { testid: 'tab-robustness', label: 'Stress' },
  { testid: 'tab-repair', label: 'Leaks' },
  { testid: 'tab-spacing', label: 'Upkeep' },
];

test.describe('the Train hub', () => {
  test('opens on Spots and lists the six modes in rail order with their old testids', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await page.click(tabTrain);
      await page.waitForSelector(hub);

      // The rail carries all six rungs, in order, each labelled and keyed by its OLD tab testid.
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
});
