import { expect, test, type Page } from '@playwright/test';
import { launchApp, sel } from './helpers.js';
import { playToShowdown, tableScreen, waitForIdle } from './flow.js';

/**
 * ACCESSIBILITY — the coach verdict reaches screen readers. The coach PANEL toggles `hidden`, which
 * removes it from the accessibility tree, so an aria-live on the panel would not reliably announce. An
 * always-present visually-hidden role=status region mirrors the verdict text instead. This suite proves
 * it: the region is a polite live region, it is empty until a verdict, it carries the SAME text the
 * panel shows when a verdict lands, and it clears on the next hand (no stale announcement).
 *
 * Seed 8, hand 1 (pinned by coach.spec/voice.spec): QsQh, call preflop (free/silent) then fold for 99
 * into 348 — grades SERIOUS. Exactly one verdict, so the announcer's fill is a real event, not noise.
 */

const announcer = '[data-testid="coach-announcer"]';
const outcomeAnnouncer = '[data-testid="outcome-announcer"]';
const potAnnouncer = '[data-testid="pot-announcer"]';

async function openTable(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.click(sel.newHand);
  await page.waitForSelector(tableScreen);
}

test('the coach announcer is a polite, screen-reader live region and starts empty', async () => {
  const { page, close } = await launchApp({ seed: 8 });
  try {
    await openTable(page);
    const region = page.locator(announcer);
    await expect(region).toHaveAttribute('role', 'status');
    await expect(region).toHaveAttribute('aria-live', 'polite');
    // No verdict yet — nothing to announce.
    await expect(region).toHaveText('');
  } finally {
    await close();
  }
});

test('a graded verdict is mirrored into the announcer, matching the on-screen coach message', async () => {
  const { page, close } = await launchApp({ seed: 8 });
  try {
    await openTable(page);
    expect(await waitForIdle(page)).toBe('hero');
    await page.locator(sel.btnCall).click(); // free/silent — announces nothing
    // The silent decision left the announcer empty.
    await expect(page.locator(announcer)).toHaveText('');

    expect(await waitForIdle(page)).toBe('hero');
    await page.locator(sel.btnFold).click(); // serious — the verdict lands
    await expect(page.locator('.coach')).toHaveAttribute('data-severity', 'serious');

    const panelText = (await page.locator(sel.coach).textContent()) ?? '';
    // The announcer carries the coach's own verdict string verbatim — one source of truth for the
    // visual panel, the voice channel, and the screen reader.
    await expect(page.locator(announcer)).toHaveText(panelText);
    expect(panelText.length).toBeGreaterThan(20);
  } finally {
    await close();
  }
});

test('the announcer clears on the next hand, leaving no stale verdict in the a11y tree', async () => {
  const { page, close } = await launchApp({ seed: 8 });
  try {
    await openTable(page);
    expect(await waitForIdle(page)).toBe('hero');
    await page.locator(sel.btnCall).click();
    expect(await waitForIdle(page)).toBe('hero');
    await page.locator(sel.btnFold).click();
    await expect(page.locator(announcer)).not.toHaveText('');

    // Fold the rest of the hand out to reach handover, then start the next hand.
    for (let i = 0; i < 40; i++) {
      const state = await waitForIdle(page);
      if (state === 'handover') break;
      for (const s of [sel.btnCheck, sel.btnCall, sel.btnFold]) {
        const b = page.locator(s);
        if (await b.isEnabled()) {
          await b.click();
          break;
        }
      }
    }
    await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'handover');
    await page.locator('[data-testid="next-hand"]').click();
    await waitForIdle(page);
    // Fresh hand: the previous verdict must not still be announced.
    await expect(page.locator(announcer)).toHaveText('');
  } finally {
    await close();
  }
});

test('the pot is announced at a street boundary, matching the felt, and is empty preflop', async () => {
  const { page, close } = await launchApp({ seed: 8 });
  try {
    await openTable(page);
    // Preflop, before any street was dealt, the pot announcer has nothing to say (it fires on the flop).
    expect(await waitForIdle(page)).toBe('hero');
    await expect(page.locator(potAnnouncer)).toHaveText('');

    // Play passively (check/call) until the board reaches the flop (3+ cards) or the hand settles.
    let reachedFlop = false;
    for (let i = 0; i < 40; i++) {
      const boardCards = await page.locator('[data-testid="board"] [data-testid="card"]').count();
      if (boardCards >= 3) {
        reachedFlop = true;
        break;
      }
      if ((await waitForIdle(page)) === 'handover') break;
      for (const s of [sel.btnCheck, sel.btnCall]) {
        const b = page.locator(s);
        if (await b.isEnabled()) {
          await b.click();
          break;
        }
      }
    }
    // This seed's line must actually see a flop for the assertion to mean anything.
    expect(reachedFlop, 'the passive line should reach a flop on this seed').toBe(true);

    // The announced pot is the felt's pot verbatim — one polite region, distinct from coach/outcome, so
    // a street deal that coincides with a verdict cannot clobber the teaching output.
    const potText = (await page.locator('[data-testid="pot"]').textContent()) ?? '';
    expect(potText).toMatch(/^Pot \d+$/);
    await expect(page.locator(potAnnouncer)).toHaveText(potText);
  } finally {
    await close();
  }
});

test('the showdown outcome is announced once at settle, matching the winner-summary panel', async () => {
  const { page, close } = await launchApp({ seed: 8 });
  try {
    await openTable(page);
    // Play the hand out passively to settle.
    expect(await playToShowdown(page)).not.toHaveLength(0);
    await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'handover');

    // The visible winner summary and the outcome announcement are one string — the outcome the hand
    // just decided reaches SR users via a dedicated polite region, distinct from the coach verdict.
    const summaryText = (await page.locator('[data-testid="winner-summary"]').textContent()) ?? '';
    expect(summaryText).toMatch(/wins \d+/);
    await expect(page.locator(outcomeAnnouncer)).toHaveText(summaryText);
  } finally {
    await close();
  }
});
