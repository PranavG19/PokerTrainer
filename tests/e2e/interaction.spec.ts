import { expect, test, type Page } from '@playwright/test';
import { launchApp, sel, shot, type LaunchedApp } from './helpers.js';

/**
 * R3 INTERACTION — action legality, turn gating, raise slider + presets, keyboard shortcuts.
 *
 * Sync rule: never sleep. `[data-testid="table-screen"]` carries data-awaiting
 * ('hero' | 'ai' | 'handover'); every assertion is gated on that reaching a settled value.
 *
 * Where a test must observe the app *mid-transition* (buttons disabled the instant the hero
 * acts, keys ignored while a villain is thinking) it clicks and reads inside a single
 * page.evaluate. The table's advance() is synchronous up to the setTimeout that runs the
 * villain, so one JS turn cannot be interleaved by the AI timer — that makes those tests
 * exact instead of racing a 450ms delay.
 */

const TABLE = '[data-testid="table-screen"]';
const HERO_SEAT = '[data-testid="seat"][data-seat-id="0"]';
const raiseSlider = '[data-testid="raise-slider"]';
const raiseAmount = '[data-testid="raise-amount"]';

/** Blinds are fixed in src/renderer/screens/table.ts (SB 25 / BB 50 / 5000 stacks). */
const BIG_BLIND = 50;

type Awaiting = 'hero' | 'ai' | 'handover';

async function openTable(page: Page): Promise<void> {
  await page.waitForSelector(sel.newHand);
  await page.click(sel.newHand);
  await page.waitForSelector(TABLE);
}

/** Block until the table settles on one of `want`. Both 'hero' and 'handover' are stable
 *  states — nothing but a click can leave them — so a value read after this is still valid. */
async function waitForAwaiting(page: Page, want: Awaiting[], timeout = 30_000): Promise<Awaiting> {
  await page.waitForFunction(
    (states: string[]) => {
      const root = document.querySelector('[data-testid="table-screen"]');
      if (!(root instanceof HTMLElement)) return false;
      return states.includes(root.dataset.awaiting ?? '');
    },
    want as string[],
    { timeout },
  );
  const now = (await page.getAttribute(TABLE, 'data-awaiting')) as Awaiting | null;
  expect(now).not.toBeNull();
  return now as Awaiting;
}

async function potValue(page: Page): Promise<number> {
  const text = (await page.textContent(sel.pot)) ?? '';
  const digits = text.replace(/[^0-9-]/g, '');
  expect(digits.length, `pot text was "${text}"`).toBeGreaterThan(0);
  return Number(digits);
}

async function numericAttr(page: Page, selector: string, attr: string): Promise<number> {
  const raw = await page.getAttribute(selector, attr);
  expect(raw, `${selector}[${attr}] missing`).not.toBeNull();
  const n = Number(raw);
  expect(Number.isFinite(n), `${selector}[${attr}] = "${raw}" is not a number`).toBe(true);
  return n;
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-only inspection of the hero's first decision point. None of these tests
// commits an action, so they can share one launch: data-awaiting stays 'hero'.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('controls at the hero decision point', () => {
  let launched: LaunchedApp | null = null;

  test.beforeAll(async () => {
    launched = await launchApp({ seed: 42 });
    await openTable(launched.page);
    await waitForAwaiting(launched.page, ['hero']);
  });

  test.afterAll(async () => {
    await launched?.close();
    launched = null;
  });

  const page = (): Page => {
    if (!launched) throw new Error('app not launched');
    return launched.page;
  };

  test('facing the big blind: check is illegal, call is offered', async () => {
    // Hand 1 puts the hero on the button, so their first turn is preflop facing the BB.
    expect(await page().locator(sel.board).locator(sel.card).count()).toBe(0);

    await expect(page().locator(sel.btnCheck)).toBeDisabled();
    await expect(page().locator(sel.btnCall)).toBeEnabled();
    await expect(page().locator(sel.btnFold)).toBeEnabled();

    // The call label carries the amount owed — proof there is a live bet to face.
    const callLabel = (await page().textContent(sel.btnCall)) ?? '';
    expect(callLabel).toMatch(/Call \d+/);
    expect(Number(callLabel.replace(/[^0-9]/g, ''))).toBeGreaterThanOrEqual(BIG_BLIND);

    await shot(page(), 'interaction-hero-controls');
  });

  test('raise slider bounds are sane numbers pinned to the hero stack', async () => {
    await expect(page().locator(raiseSlider)).toBeEnabled();

    const min = await numericAttr(page(), raiseSlider, 'min');
    const max = await numericAttr(page(), raiseSlider, 'max');

    expect(min).toBeLessThanOrEqual(max);
    expect(min).toBeGreaterThanOrEqual(BIG_BLIND);

    // max is a raise-TO, so it equals everything the hero can put in: stack + already committed.
    const stack = Number((await page().locator(`${HERO_SEAT} [data-testid="seat-stack"]`).textContent()) ?? '');
    const committedEl = page().locator(`${HERO_SEAT} [data-testid="seat-committed"]`);
    const committed = (await committedEl.count()) > 0 ? Number(await committedEl.textContent()) : 0;
    expect(max).toBe(stack + committed);
  });

  test('every preset lands inside [min, max]; all-in lands exactly on max', async () => {
    const min = await numericAttr(page(), raiseSlider, 'min');
    const max = await numericAttr(page(), raiseSlider, 'max');

    for (const preset of ['preset-half', 'preset-threequarter', 'preset-pot', 'preset-allin']) {
      const button = page().locator(`[data-testid="${preset}"]`);
      await expect(button).toBeEnabled();
      await button.click();

      const value = Number(await page().locator(raiseSlider).inputValue());
      expect(Number.isInteger(value), `${preset} produced "${value}"`).toBe(true);
      expect(value, `${preset} below min`).toBeGreaterThanOrEqual(min);
      expect(value, `${preset} above max`).toBeLessThanOrEqual(max);

      // The visible amount must agree with the slider it is labelling.
      expect(Number(await page().locator(raiseAmount).textContent())).toBe(value);

      if (preset === 'preset-allin') expect(value).toBe(max);
    }
  });

  test('stats-toggle flips the sheet open and closed', async () => {
    const sheet = page().locator(sel.statsSheet);
    const toggle = page().locator('[data-testid="stats-toggle"]');

    const first = await sheet.getAttribute('data-open');
    expect(first === 'true' || first === 'false').toBe(true);

    await toggle.click();
    await expect(sheet).toHaveAttribute('data-open', first === 'true' ? 'false' : 'true');

    await toggle.click();
    await expect(sheet).toHaveAttribute('data-open', first as string);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests that commit chips or fold get their own app + userData dir.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('committing actions', () => {
  test('all controls go dead the instant the turn passes to a villain', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await openTable(page);
      await waitForAwaiting(page, ['hero']);

      // Click and read in one JS turn: the AI's 450ms timer cannot interleave.
      const snap = await page.evaluate(() => {
        const button = (id: string): HTMLButtonElement => {
          const el = document.querySelector(`[data-testid="${id}"]`);
          if (!(el instanceof HTMLButtonElement)) throw new Error(`${id} is not a button`);
          return el;
        };
        const slider = document.querySelector('[data-testid="raise-slider"]');
        if (!(slider instanceof HTMLInputElement)) throw new Error('raise-slider missing');
        const root = document.querySelector('[data-testid="table-screen"]');
        if (!(root instanceof HTMLElement)) throw new Error('table-screen missing');

        const wasEnabledBefore = !button('btn-call').disabled;
        button('btn-call').click();

        const sliderAfter = document.querySelector('[data-testid="raise-slider"]');
        return {
          wasEnabledBefore,
          awaiting: root.dataset.awaiting,
          fold: button('btn-fold').disabled,
          check: button('btn-check').disabled,
          call: button('btn-call').disabled,
          raise: button('btn-raise').disabled,
          half: button('preset-half').disabled,
          allinPreset: button('preset-allin').disabled,
          slider: sliderAfter instanceof HTMLInputElement ? sliderAfter.disabled : null,
        };
      });

      expect(snap.wasEnabledBefore).toBe(true);
      expect(snap.awaiting).toBe('ai');
      expect(snap.fold).toBe(true);
      expect(snap.check).toBe(true);
      expect(snap.call).toBe(true);
      expect(snap.raise).toBe(true);
      expect(snap.half).toBe(true);
      expect(snap.allinPreset).toBe(true);
      expect(snap.slider).toBe(true);
    } finally {
      await close();
    }
  });

  test('btn-raise moves chips from the hero stack into the pot', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await openTable(page);
      await waitForAwaiting(page, ['hero']);
      await page.locator('[data-testid="preset-pot"]').click();

      const result = await page.evaluate(() => {
        const readPot = (): number => {
          const el = document.querySelector('[data-testid="pot"]');
          return Number((el?.textContent ?? '').replace(/[^0-9-]/g, ''));
        };
        const readHero = (): { committed: number; stack: number } => {
          const seat = document.querySelector('[data-testid="seat"][data-seat-id="0"]');
          if (!seat) throw new Error('hero seat missing');
          const committed = seat.querySelector('[data-testid="seat-committed"]');
          const stack = seat.querySelector('[data-testid="seat-stack"]');
          return {
            committed: committed ? Number(committed.textContent) : 0,
            stack: Number(stack?.textContent ?? 'NaN'),
          };
        };
        const slider = document.querySelector('[data-testid="raise-slider"]');
        if (!(slider instanceof HTMLInputElement)) throw new Error('raise-slider missing');
        const raise = document.querySelector('[data-testid="btn-raise"]');
        if (!(raise instanceof HTMLButtonElement)) throw new Error('btn-raise missing');

        const before = { pot: readPot(), ...readHero() };
        const raiseTo = Number(slider.value);
        raise.click();
        return { before, raiseTo, after: { pot: readPot(), ...readHero() } };
      });

      const cost = result.raiseTo - result.before.committed;
      expect(cost).toBeGreaterThan(0);
      expect(result.after.committed).toBeGreaterThan(result.before.committed);
      expect(result.after.committed).toBe(result.raiseTo);
      expect(result.after.pot).toBe(result.before.pot + cost);
      expect(result.after.stack).toBe(result.before.stack - cost);
    } finally {
      await close();
    }
  });

  test('keyboard F folds and the hand settles without the hero', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await openTable(page);
      await waitForAwaiting(page, ['hero']);
      await expect(page.locator(HERO_SEAT)).not.toHaveAttribute('data-folded', 'true');

      // A real OS-level key press, not a synthesised event: R3 claims the shortcuts work.
      await page.keyboard.press('f');

      // Nothing else in the app can fold the hero, so this can only pass if the key landed.
      await expect(page.locator(HERO_SEAT)).toHaveAttribute('data-folded', 'true');

      // Scenario 9: the hand must reach handover with a winner that is not the hero.
      await waitForAwaiting(page, ['handover']);
      await expect(page.locator('[data-testid="winner-summary"]')).toBeVisible();
      await expect(page.locator('[data-testid="next-hand"]')).toBeVisible();
      const summary = (await page.textContent('[data-testid="winner-summary"]')) ?? '';
      expect(summary).toMatch(/wins \d+/);
      expect(summary, 'a folded hero cannot win the pot').not.toContain('You');
      await expect(page.locator(HERO_SEAT)).toHaveAttribute('data-folded', 'true');
      await shot(page, 'interaction-fold-handover');
    } finally {
      await close();
    }
  });

  test('keyboard C calls when facing a bet and the pot grows by the amount owed', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await openTable(page);
      await waitForAwaiting(page, ['hero']);

      const potBefore = await potValue(page);
      const toCall = Number(((await page.textContent(sel.btnCall)) ?? '').replace(/[^0-9]/g, ''));
      expect(toCall).toBeGreaterThan(0);

      await page.keyboard.press('c');

      // Leaving 'hero' proves the hero acted: while data-awaiting is 'hero' no timer is
      // pending, so an ignored key would leave the table parked here until the wait expires.
      await waitForAwaiting(page, ['ai', 'handover'], 10_000);

      await page.waitForFunction(
        (floor: number) => {
          const el = document.querySelector('[data-testid="pot"]');
          return Number((el?.textContent ?? '').replace(/[^0-9-]/g, '')) >= floor;
        },
        potBefore + toCall,
        { timeout: 10_000 },
      );

      expect(await potValue(page)).toBeGreaterThanOrEqual(potBefore + toCall);
      await expect(page.locator(HERO_SEAT)).not.toHaveAttribute('data-folded', 'true');
    } finally {
      await close();
    }
  });

  test('keyboard shortcuts are ignored while a villain is thinking', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await openTable(page);
      await waitForAwaiting(page, ['hero']);

      // Pass the turn and fire 'f' in the same JS turn, so the press provably lands while
      // data-awaiting === 'ai' instead of hoping to beat a 450ms timer.
      const duringAi = await page.evaluate(() => {
        const call = document.querySelector('[data-testid="btn-call"]');
        if (!(call instanceof HTMLButtonElement)) throw new Error('btn-call missing');
        const root = document.querySelector('[data-testid="table-screen"]');
        if (!(root instanceof HTMLElement)) throw new Error('table-screen missing');

        call.click();
        const awaitingAtPress = root.dataset.awaiting;
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));

        const seat = document.querySelector('[data-testid="seat"][data-seat-id="0"]');
        if (!(seat instanceof HTMLElement)) throw new Error('hero seat missing');
        return { awaitingAtPress, folded: seat.dataset.folded ?? null };
      });

      expect(duringAi.awaitingAtPress).toBe('ai');
      expect(duringAi.folded).toBeNull();

      // Control: the same synthesised press IS honoured once the turn comes back, which rules
      // out the previous assertion passing merely because dispatchEvent does nothing here.
      await waitForAwaiting(page, ['hero']);
      const onHeroTurn = await page.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
        const seat = document.querySelector('[data-testid="seat"][data-seat-id="0"]');
        if (!(seat instanceof HTMLElement)) throw new Error('hero seat missing');
        return seat.dataset.folded ?? null;
      });
      expect(onHeroTurn).toBe('true');
    } finally {
      await close();
    }
  });
});
