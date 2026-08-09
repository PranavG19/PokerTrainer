import { expect, test, type Page } from '@playwright/test';
import { launchApp, sel, shot } from './helpers.js';

/**
 * Success criterion #6 — the coaching layer, and above all the SILENCE RULE.
 *
 * Every seed used here is PINNED and was found by replaying the exact renderer decision path
 * (core/table + core/ai + core/coach with the same `seed + handNumber` grading seed the table
 * screen passes) across seeds 1..30 under several hero policies. The comment above each test
 * records the spot it produces. Monte-Carlo equity is deterministic under mulberry32, so these
 * numbers are reproducible, not lucky.
 */

const TABLE = '[data-testid="table-screen"]';
const COACH_PANEL = '.coach';
const COACH_PRINCIPLE = '.coach-principle';
const NEXT_HAND = '[data-testid="next-hand"]';
const LEAK_LIST = '[data-testid="leak-list"]';
const LEAK_ROW = '[data-testid="leak-row"]';

type Awaiting = 'hero' | 'ai' | 'handover';
type HeroAction = 'fold' | 'check' | 'call' | 'raise';

const BUTTON: Record<HeroAction, string> = {
  fold: sel.btnFold,
  check: sel.btnCheck,
  call: sel.btnCall,
  raise: sel.btnRaise,
};

/**
 * Block until the app is not mid-AI-turn. `data-awaiting` is the app's own readiness flag, so this
 * replaces sleeping: 'ai' means a setTimeout is pending and the DOM is about to change under us.
 */
async function waitIdle(page: Page): Promise<Awaiting> {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="table-screen"]');
      const awaiting = el instanceof HTMLElement ? el.dataset.awaiting : undefined;
      return awaiting === 'hero' || awaiting === 'handover';
    },
    undefined,
    { timeout: 40_000 },
  );
  const awaiting = await page.locator(TABLE).getAttribute('data-awaiting');
  if (awaiting !== 'hero' && awaiting !== 'handover') {
    throw new Error(`unexpected data-awaiting after idle: ${String(awaiting)}`);
  }
  return awaiting;
}

async function openTable(page: Page): Promise<void> {
  await page.locator(sel.newHand).click();
  await page.locator(TABLE).waitFor({ state: 'attached' });
}

/** Take one hero action, failing loudly if the app says it is illegal rather than silently no-oping. */
async function heroAct(page: Page, action: HeroAction): Promise<void> {
  const awaiting = await waitIdle(page);
  if (awaiting !== 'hero') throw new Error(`wanted to ${action} but the hand is in '${awaiting}'`);
  const button = page.locator(BUTTON[action]);
  await expect(button, `${action} must be legal in this spot`).toBeEnabled();
  await button.click();
}

async function heroPlan(page: Page, plan: HeroAction[]): Promise<void> {
  for (const action of plan) await heroAct(page, action);
}

/** Cheapest-legal-continue loop to reach settlement. Capped so a stuck hand fails instead of hanging. */
async function playToShowdown(page: Page): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if ((await waitIdle(page)) === 'handover') return;
    const check = page.locator(sel.btnCheck);
    const call = page.locator(sel.btnCall);
    if (await check.isEnabled()) await check.click();
    else if (await call.isEnabled()) await call.click();
    else await page.locator(sel.btnFold).click();
  }
  throw new Error('playToShowdown hit its 40-action cap without reaching handover');
}

async function expectSilent(page: Page): Promise<void> {
  await expect(page.locator(sel.coach)).toHaveText('');
  await expect(page.locator(COACH_PANEL)).toBeHidden();
  await expect(page.locator(COACH_PANEL)).toHaveAttribute('data-severity', 'none');
}

async function withApp(seed: number, body: (page: Page) => Promise<void>): Promise<void> {
  const launched = await launchApp({ seed });
  try {
    await body(launched.page);
  } finally {
    await launched.close();
  }
}

test.describe('R6 coach layer', () => {
  test('coach message element exists in the DOM from the moment the table mounts', async () => {
    await withApp(42, async (page) => {
      await openTable(page);

      // Queryable before the hero has done anything at all — no conditional rendering to race.
      await expect(page.locator(sel.coach)).toBeAttached();
      await expectSilent(page);

      // Still there once the app has settled into the hero's turn.
      expect(await waitIdle(page)).toBe('hero');
      await expect(page.locator(sel.coach)).toBeAttached();
      await expectSilent(page);
    });
  });

  /**
   * SILENCE RULE. Seed 42, hand 1 — hero holds 2dKh, board runs 4s4dKd / Ks / Qh.
   *   call preflop  -> free (0.2bb)
   *   check flop    -> free
   *   check turn    -> NOTABLE 0.6bb (95% equity, missed value) => panel becomes visible
   *   call 99 river -> free (97.9% equity vs 28.4% required, a clearly correct cheap call)
   * The mistake first is deliberate: it makes the silence assertion non-vacuous. The panel is
   * proven visible, then a correct decision is graded and the panel goes back to hidden/empty.
   */
  test('a clearly correct cheap decision silences the coach again', async () => {
    await withApp(42, async (page) => {
      await openTable(page);

      await heroPlan(page, ['call', 'check']);
      await expectSilent(page); // still nothing to say

      await heroAct(page, 'check');
      // Proof the panel can speak on this very hand, so the silence below means something.
      await expect(page.locator(COACH_PANEL)).toBeVisible();
      await expect(page.locator(COACH_PANEL)).toHaveAttribute('data-severity', 'notable');
      await expect(page.locator(sel.coach)).not.toHaveText('');

      await heroAct(page, 'call');
      await expectSilent(page);
      await shot(page, 'coach-silent');
    });
  });

  /**
   * Seed 1, hand 1 — hero holds 8dAd. Calls 50 into 75 (free), then folds facing 75 into a 225 pot
   * holding 44% equity where only 25% was needed: 1.1bb, NOTABLE.
   */
  test('a deliberate bad fold surfaces a graded message', async () => {
    await withApp(1, async (page) => {
      await openTable(page);

      await heroAct(page, 'call');
      await expectSilent(page);

      await heroAct(page, 'fold');

      const panel = page.locator(COACH_PANEL);
      await expect(panel).toBeVisible();
      await expect(page.locator(sel.coach)).not.toHaveText('');
      await expect(panel).toHaveAttribute('data-severity', /^(notable|serious)$/);
      await shot(page, 'coach-notable');
    });
  });

  /**
   * Seed 8, hand 1 — hero holds QsQh on 8c9h8s. Calling 50 preflop with 66% equity is free; then
   * folding for 99 into a 348 pot (22% required, 66% held) throws away 3.9bb => SERIOUS (>2bb).
   * Folding a huge favourite is the cheapest reliable lever for a serious grade through the UI.
   */
  test('a >2bb error is graded serious', async () => {
    await withApp(8, async (page) => {
      await openTable(page);

      await heroAct(page, 'call');
      await expectSilent(page);

      await heroAct(page, 'fold');
      await expect(page.locator(COACH_PANEL)).toHaveAttribute('data-severity', 'serious');
      await shot(page, 'coach-serious');
    });
  });

  /** Same pinned seed-8 spot: the line must explain WHY, not just print a verdict. */
  test('the coach message names a principle, not just a number', async () => {
    await withApp(8, async (page) => {
      await openTable(page);
      await heroPlan(page, ['call', 'fold']);

      const message = (await page.locator(sel.coach).textContent()) ?? '';
      expect(message.length).toBeGreaterThan(20);
      expect(message).toMatch(/equity|pot|odds|bb/i);
      // The named leak, spelled out for the student and reused as the profile leak key.
      await expect(page.locator(COACH_PRINCIPLE)).toContainText('pot odds');
    });
  });

  /** Stale advice about the previous hand would be actively misleading, so it must be cleared. */
  test('the coach clears between hands', async () => {
    await withApp(8, async (page) => {
      await openTable(page);
      await heroPlan(page, ['call', 'fold']);
      await expect(page.locator(COACH_PANEL)).toHaveAttribute('data-severity', 'serious');

      expect(await waitIdle(page)).toBe('handover');
      await page.locator(NEXT_HAND).click();

      await waitIdle(page);
      await expectSilent(page);
    });
  });

  /** A grade is only useful if it aggregates: one graded mistake must show up as a named leak. */
  test('graded mistakes accumulate into the profile leak list', async () => {
    await withApp(8, async (page) => {
      await openTable(page);
      await heroPlan(page, ['call', 'fold']);
      await expect(page.locator(COACH_PANEL)).toHaveAttribute('data-severity', 'serious');

      await playToShowdown(page);
      await expect(page.locator('[data-testid="winner-summary"]')).toBeVisible();

      await page.locator(sel.tabProfile).click();
      await expect(page.locator('[data-testid="profile-screen"]')).toBeVisible();

      const rows = page.locator(`${LEAK_LIST} ${LEAK_ROW}`);
      await expect(rows).not.toHaveCount(0);
      await expect(rows.first()).toHaveAttribute('data-principle', 'pot odds');
      await expect(rows.first()).toContainText('pot odds');
      await shot(page, 'coach-leaks');
    });
  });
});
