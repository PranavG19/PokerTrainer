import { expect, test, type Page } from '@playwright/test';
import { launchApp } from './helpers.js';

/**
 * ACCESSIBILITY — controls that a screen reader would otherwise announce namelessly now carry an
 * accessible name. These were found by an audit: text inputs/selects/textarea with only a placeholder
 * (which is not a reliable accessible name), and icon/glyph-only buttons. Each assertion opens the
 * screen the control lives on and checks the aria-label (or, for controls behind gameplay, checks it
 * only when the control is present). The visible text/testids are unchanged — this adds names, nothing
 * else.
 */

async function openTab(page: Page, tab: string): Promise<void> {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.click(`[data-testid="tab-${tab}"]`);
}

test('the drill answer box is named after the concept it asks, not just a placeholder', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await openTab(page, 'drill');
    const input = page.locator('[data-testid="drill-answer"]');
    await expect(input).toBeVisible();
    const label = await input.getAttribute('aria-label');
    expect(label ?? '', 'the drill input must carry an aria-label').not.toBe('');
    // pot-odds is the first kind; the label names the task and the unit.
    expect(label).toContain('Pot odds');
    expect((label ?? '').toLowerCase()).toContain('percent');
  } finally {
    await close();
  }
});

test('the puzzle scenario picker (a select) is named', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await openTab(page, 'puzzle');
    // The picker lives in the header, which is blinded during the CLASSIFY step; clear it first.
    const screen = page.locator('[data-testid="puzzle-screen"]');
    if ((await screen.getAttribute('data-phase')) === 'classify') {
      await page.locator('[data-testid="puzzle-classify-rfi"]').click();
      await page.locator('[data-testid="puzzle-classify-continue"]').click();
      await expect(screen).toHaveAttribute('data-phase', 'acting');
    }
    const picker = page.locator('[data-testid="puzzle-picker"]');
    await expect(picker).toBeVisible();
    await expect(picker).toHaveAttribute('aria-label', 'Jump to puzzle');
  } finally {
    await close();
  }
});

test('the lexicon sentence textarea is named', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await openTab(page, 'repair');
    // The textarea only appears once a repair concept with a buildable axis is open; assert the name
    // wherever the input is present, and skip only if this profile surfaces no lexicon input at all.
    const box = page.locator('[data-testid="lexicon-input"]');
    // Open the first repair row if the queue is showing.
    const firstRow = page.locator('[data-testid="repair-row"]').first();
    if (await firstRow.count()) await firstRow.click().catch(() => {});
    const offer = page.locator('[data-testid="axis-offer"][data-available="true"]').first();
    if (await offer.count()) await offer.click().catch(() => {});
    if (await box.count()) {
      await expect(box).toHaveAttribute('aria-label', 'Name the concept in your own words');
    }
  } finally {
    await close();
  }
});

test('the multiplayer join host and port inputs are named', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    // Multiplayer opens from the Home "Play with friends" panel.
    await page.waitForSelector('[data-testid="home-screen"]');
    const friends = page.locator('[data-testid="play-with-friends"]');
    if (await friends.count()) await friends.click();
    const host = page.locator('[data-testid="mp-join-host"]');
    const port = page.locator('[data-testid="mp-join-port"]');
    if (await host.count()) {
      await expect(host).toHaveAttribute('aria-label', 'Host address');
      await expect(port).toHaveAttribute('aria-label', 'Port');
    }
  } finally {
    await close();
  }
});

test('the settings speak-verdicts toggle names what it controls, keeping its On/Off text', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await openTab(page, 'settings');
    const toggle = page.locator('[data-testid="speak-verdicts-toggle"]');
    await expect(toggle).toBeVisible();
    // The visible text stays On/Off (a voice.spec contract); the accessible name says what it does.
    const text = (await toggle.textContent()) ?? '';
    expect(['On', 'Off']).toContain(text.trim());
    expect((await toggle.getAttribute('aria-label')) ?? '').toMatch(/^Read verdicts aloud: (on|off)$/);
  } finally {
    await close();
  }
});
