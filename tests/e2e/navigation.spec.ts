import { expect, test, type Page } from '@playwright/test';
import { launchApp, sel } from './helpers.js';

/**
 * THE TAB BAR AS A WHOLE — PRODUCT-SPEC N1 ("Nothing is ever locked") and N5 (the surfaces).
 *
 * WHY A WHOLE-BAR TEST WHEN EVERY SURFACE HAS ITS OWN SPEC. Each screen's spec asserts that screen
 * works when you are on it. None of them asserts a property of the SET: that every tab in the registry
 * is reachable from a cold start with no profile, that none of them is a placeholder pretending to be a
 * feature, that leaving and returning does not break anything, and that no tab is disabled or hidden.
 * Those are the N1 claims, and N1 is the claim most easily broken by accident — a soft lock is one
 * `disabled` attribute away, and hiding a not-yet-built surface reads as a lock too.
 *
 * IT IS ALSO THE REGRESSION NET FOR PARALLEL WORK. Tabs are added to one registry in
 * src/renderer/main.ts by whoever builds a surface. This file derives its expectations FROM THE LIVE
 * BAR rather than from a hardcoded list, so a newly added tab is automatically held to the same
 * standard instead of being exempt from testing until someone remembers it.
 */

const tabBar = 'nav.tabs';
const anyTab = 'nav.tabs button.tab';
const homeScreen = '[data-testid="home-screen"]';

/** The wording renderPlaceholder() uses. A tab showing this is a surface that does not exist yet. */
const PLACEHOLDER_TEXT = 'Not built yet';

interface TabInfo {
  testid: string;
  label: string;
}

/** Read the bar rather than hardcoding it, so a tab added tomorrow is covered today. */
async function tabsInBar(page: Page): Promise<TabInfo[]> {
  return page.locator(anyTab).evaluateAll((nodes) =>
    nodes.map((node) => ({
      testid: (node as HTMLElement).dataset.testid ?? '',
      label: (node.textContent ?? '').trim(),
    })),
  );
}

test('every tab in the bar is enabled and reachable from a cold start (N1)', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await page.waitForSelector(homeScreen);
    const tabs = await tabsInBar(page);

    // A bar with one tab would pass every per-tab assertion below while being obviously wrong.
    expect(tabs.length, 'the tab bar is missing or nearly empty').toBeGreaterThanOrEqual(6);

    for (const tab of tabs) {
      expect(tab.testid, 'a tab has no testid, so no test can reach it').not.toBe('');
      expect(tab.label, `${tab.testid} has no label`).not.toBe('');

      const button = page.locator(`[data-testid="${tab.testid}"]`);
      // N1 in its most literal form: no greyed-out entry, on a profile with no history at all.
      await expect(button, `${tab.testid} is disabled on a fresh profile — that is a soft lock`).toBeEnabled();
      await expect(button, `${tab.testid} is hidden, which reads as a lock`).toBeVisible();
    }
  } finally {
    await close();
  }
});

test('clicking every tab renders a surface, marks itself active, and throws nothing', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
  try {
    await page.waitForSelector(homeScreen);
    const tabs = await tabsInBar(page);
    const screen = page.locator('main.screen');

    for (const tab of tabs) {
      await page.locator(`[data-testid="${tab.testid}"]`).click();

      // Exactly one tab is active — two would mean the active flag is set without being cleared.
      await expect(page.locator(`[data-testid="${tab.testid}"]`)).toHaveAttribute('data-active', 'true');
      expect(
        await page.locator('nav.tabs button.tab[data-active="true"]').count(),
        `${tab.label}: more than one tab is marked active`,
      ).toBe(1);

      // The surface is real content, not an empty container. A blank panel reads as a bug (main.ts
      // says so itself, which is why renderPlaceholder exists at all).
      const text = ((await screen.textContent()) ?? '').trim();
      expect(text.length, `${tab.label} rendered an empty screen`).toBeGreaterThan(0);
      await expect(screen.locator('*').first(), `${tab.label} rendered no elements`).toBeAttached();
    }

    expect(errors, 'a tab threw while rendering').toEqual([]);
  } finally {
    await close();
  }
});

test('no tab is a placeholder — every surface in the bar is actually built', async () => {
  /**
   * THE ROADMAP ASSERTION, and the reason it is phrased against the placeholder rather than against a
   * list of expected screens: main.ts renders "Not built yet" for a tab whose module does not exist,
   * which is the honest behaviour (N1 forbids hiding it). But a placeholder that survives into a
   * release is a tab that promises a feature and delivers a sentence.
   *
   * So this test is the roadmap's completion check. When it fails, the fix is to build the surface, NOT
   * to remove the tab — removing it would hide a surface, which N1 forbids, and would also make this
   * test pass while making the app worse.
   */
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await page.waitForSelector(homeScreen);
    const tabs = await tabsInBar(page);
    const screen = page.locator('main.screen');
    const placeholders: string[] = [];

    for (const tab of tabs) {
      await page.locator(`[data-testid="${tab.testid}"]`).click();
      await expect(page.locator(`[data-testid="${tab.testid}"]`)).toHaveAttribute('data-active', 'true');
      const text = (await screen.textContent()) ?? '';
      if (text.includes(PLACEHOLDER_TEXT)) placeholders.push(tab.label);
    }

    expect(
      placeholders,
      `these tabs are still placeholders and need their surface built: ${placeholders.join(', ')}`,
    ).toEqual([]);
  } finally {
    await close();
  }
});

test('tabs survive being visited twice, and Play still deals afterwards', async () => {
  /**
   * The remount path. Every non-play tab tears the table down and rebuilds the screen, so a second
   * visit runs teardown-then-mount on a screen that has already lived once — where a stale listener, a
   * timer that was not cleared, or a handle that destroy() left half-alive would surface. Ending on a
   * dealt hand proves the teardown did not take the table with it.
   */
  const { page, close } = await launchApp({ seed: 42 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
  try {
    await page.waitForSelector(homeScreen);
    const tabs = await tabsInBar(page);

    for (const pass of [1, 2]) {
      for (const tab of tabs) {
        await page.locator(`[data-testid="${tab.testid}"]`).click();
        await expect(
          page.locator(`[data-testid="${tab.testid}"]`),
          `pass ${pass}: ${tab.label} did not become active`,
        ).toHaveAttribute('data-active', 'true');
      }
    }

    // Back to Play, and the app must still be able to start a hand.
    await page.locator(sel.tabPlay).click();
    await page.waitForSelector(homeScreen);
    await page.locator(sel.newHand).click();
    await expect(page.locator('[data-testid="table-screen"]')).toBeVisible();
    await expect(page.locator(sel.heroCards).locator(sel.card).first()).toBeVisible();

    expect(errors, 'revisiting tabs threw').toEqual([]);
  } finally {
    await close();
  }
});

test('the freshly-mounted surface fades in on a tab switch, and honours reduced motion (UI)', async () => {
  /**
   * The mount fade is a `.screen > *` rule (styles.css): main.ts swaps the single child of main.screen
   * on every tab switch, so the incoming surface gets a one-shot opacity fade to aid orientation across
   * the thirteen-tab bar. Opacity only — layout.spec proves the rect never moves — so the only oracle is
   * the animation name on the mounted child. The second half is the V2 contract: it is switched off for a
   * learner who has asked for reduced motion.
   */
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await page.waitForSelector(homeScreen);
    // Math (drill) lives behind the Train hub now: the top-level tab is Train, and the drill is a rail
    // button inside it. The mount fade is on the top-level surface swap, so open the hub tab.
    await page.locator('[data-testid="tab-train"]').click();
    await expect(page.locator('[data-testid="tab-train"]')).toHaveAttribute('data-active', 'true');

    const mountedChild = page.locator('main.screen > *').first();
    await expect(mountedChild).toBeAttached();
    const animName = await mountedChild.evaluate((el) => getComputedStyle(el).animationName);
    expect(animName, 'the mounted surface does not carry the mount-fade animation').toBe('offsuit-surface-in');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator(sel.tabPlay).click();
    await page.locator('[data-testid="tab-train"]').click();
    const reducedName = await page
      .locator('main.screen > *')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(reducedName, 'the mount fade ignores prefers-reduced-motion').toBe('none');
  } finally {
    await close();
  }
});

test("a table left mid-hand does not keep eating keys on another screen", async () => {
  /**
   * THE ORACLE IS THE KEYBOARD, and it took a measurement to get right. I first asserted "no hands
   * accumulate while you are on another tab", on the strength of main.ts's comment about a surviving AI
   * timer. That oracle is blind: with `teardownTable()` deleted, no hands accumulate over 29 seconds and
   * the table DOM is already gone, because `screen.replaceChildren()` detaches it regardless.
   *
   * Reading screens/table.ts:536 shows what destroy() actually protects — a WINDOW-level keydown
   * listener (plus the timer). A window listener does not care that its DOM was detached: it keeps
   * running, so a leaked table interprets keys pressed on a completely different screen and can act on
   * the hand nobody is looking at. That is observable, and it is what this asserts.
   */
  const { page, close } = await launchApp({ seed: 42 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
  try {
    await page.waitForSelector(homeScreen);
    await page.locator(sel.newHand).click();
    await expect(page.locator('[data-testid="table-screen"]')).toBeVisible();
    // Wait for the hero's turn, so the table is in a state where its shortcuts DO something.
    await expect(page.locator('[data-testid="table-screen"]')).toHaveAttribute('data-awaiting', 'hero');

    // Leave for a surface with its own keyboard handling: the Math (drill) rung of the Train hub.
    await page.locator('[data-testid="tab-train"]').click();
    await page.locator('[data-testid="tab-drill"]').click();
    await expect(page.locator('[data-testid="tab-drill"]')).toHaveAttribute('data-active', 'true');

    // Every shortcut the table binds. If its listener survived, one of these acts on the hidden hand.
    for (const key of ['f', 'c', 'k', 'r', 'ArrowUp', 'ArrowDown', 'Enter', ' ']) {
      await page.keyboard.press(key === ' ' ? 'Space' : key);
    }

    // Still on the drill, and no table appeared: a surviving handler that folded or raised would have
    // driven the hand to a handover, and returning to Play would show a finished hand rather than the
    // one that was live.
    await expect(page.locator('[data-testid="tab-drill"]')).toHaveAttribute('data-active', 'true');
    expect(
      await page.locator('[data-testid="table-screen"]').count(),
      'the table reappeared while the drill was open',
    ).toBe(0);

    // Back to Play: the hand must still be exactly where it was left — awaiting the hero, not resolved
    // by keys pressed somewhere else.
    await page.locator(sel.tabPlay).click();
    await page.waitForSelector(homeScreen);
    await expect(
      page.locator('[data-testid="winner-summary"]'),
      'the hand was decided by keystrokes pressed on another screen',
    ).toHaveCount(0);

    expect(errors, 'a stray key threw on another screen').toEqual([]);
  } finally {
    await close();
  }
});
