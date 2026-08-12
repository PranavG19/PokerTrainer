import { expect, test, type Page } from '@playwright/test';
import { launchApp } from './helpers.js';
import { tableScreen, waitForIdle, snapshot } from './flow.js';
import { sel } from './helpers.js';

/**
 * BOARD DEAL-IN ANIMATION — newly-dealt community cards slide in (opacity + transform, compositor-only,
 * reduced-motion-guarded). The property that matters and is easy to get wrong: the animation must fire
 * ONCE per card as it is dealt, NOT on every render. table.ts re-renders on every state change (pot,
 * seat action, coach reveal), rebuilding the whole board row — so without a board diff every card would
 * re-animate constantly. This suite proves the diff: new cards are tagged data-deal-in; cards already on
 * the board before a same-street re-render are not re-tagged.
 *
 * Sync oracle is data-awaiting (never a sleep). The animation itself is CSS; we assert the data-deal-in
 * flag table.ts sets, which is what triggers it — a behavioural check, not a pixel check.
 */

const board = '[data-testid="board"]';

/** Boot lands on Home; sit down to open a live table (mirrors gameplay.spec's sitDown). */
async function sitDown(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.locator(sel.newHand).click();
  await page.locator(tableScreen).waitFor();
  await waitForIdle(page);
}

/** Board cards that are currently tagged as freshly-dealt. */
async function dealtInCount(page: Page): Promise<number> {
  return page.locator(`${board} [data-testid="card"][data-deal-in="true"]`).count();
}

/** Play the hero passively until the board first reaches `target` cards (a new street was dealt). */
async function playUntilBoard(page: Page, target: number, maxActions = 40): Promise<void> {
  for (let i = 0; i < maxActions; i++) {
    if ((await snapshot(page)).board.length >= target) return;
    const state = await waitForIdle(page);
    if (state === 'handover') throw new Error(`hand ended before the board reached ${target} cards`);
    for (const s of [sel.btnCheck, sel.btnCall, sel.btnFold]) {
      const b = page.locator(s);
      if (await b.isEnabled()) {
        await b.click();
        break;
      }
    }
  }
  throw new Error(`board never reached ${target} cards`);
}

test('the flop cards are tagged as freshly dealt when they first appear', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  try {
    await sitDown(page);
    // Preflop: no board, nothing tagged.
    expect((await snapshot(page)).board).toHaveLength(0);
    expect(await dealtInCount(page)).toBe(0);

    // Drive to the flop; the three new cards are tagged data-deal-in on the render that deals them.
    await playUntilBoard(page, 3);
    const snap = await snapshot(page);
    expect(snap.board.length).toBeGreaterThanOrEqual(3);
    // At the render that first showed the flop, the newly-dealt cards carry the flag. (If the hand ran
    // straight to a later street in one idle step, at least the cards beyond the previous street count.)
    expect(await dealtInCount(page)).toBeGreaterThan(0);
  } finally {
    await close();
  }
});

test('a same-street re-render does not re-tag cards already on the board', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  try {
    await sitDown(page);
    await playUntilBoard(page, 3);

    // Force a full table re-render WITHOUT dealing a new card: toggling the coach mode calls render()
    // (table.ts setCoachedMode), which rebuilds the board row at the same street. The diff must tag
    // NOTHING on that rebuild — board.length is unchanged, so no card re-animates. This is the property
    // that matters: the deal-in fires per new card, never on an incidental re-render.
    const before = (await snapshot(page)).board.length;
    const coachToggle = page.locator('[data-testid="coach-mode-toggle"]');
    await expect(coachToggle).toBeVisible();
    await coachToggle.click();
    const after = (await snapshot(page)).board.length;
    expect(after, 'no new card should have been dealt by a coach-mode toggle').toBe(before);
    // The row was rebuilt but the board did not grow, so nothing is freshly-dealt on this render.
    expect(await dealtInCount(page)).toBe(0);
  } finally {
    await close();
  }
});

test('a new hand resets the board so the next flop deals in again', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  try {
    await sitDown(page);
    await playUntilBoard(page, 3);
    // Finish the hand and start the next.
    for (let i = 0; i < 40; i++) {
      if ((await waitForIdle(page)) === 'handover') break;
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
    // Fresh hand: empty board again, nothing tagged, and the next flop will deal in (prevBoardLen reset).
    expect((await snapshot(page)).board).toHaveLength(0);
    expect(await dealtInCount(page)).toBe(0);
    await playUntilBoard(page, 3);
    expect(await dealtInCount(page)).toBeGreaterThan(0);
  } finally {
    await close();
  }
});
