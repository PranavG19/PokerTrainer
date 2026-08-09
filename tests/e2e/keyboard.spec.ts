import { expect, test, type Page } from '@playwright/test';
import { launchApp, sel, shot } from './helpers.js';
import { CHIPS_IN_PLAY, playToShowdown, tableScreen, waitForIdle } from './flow.js';

/**
 * R3 KEYBOARD — the R (raise-to-min) and A (all-in) shortcuts.
 *
 * Why this file exists: interaction.spec.ts covers F and C. R and A had ZERO coverage in unit or
 * e2e, so a broken binding (wrong amount, case-sensitive compare, firing when illegal) would ship
 * silently. SPEC.md R3 promises all four keys.
 *
 * Sync rule: never sleep.
 *  - `[data-testid="table-screen"]` publishes data-awaiting on every render (waitForIdle).
 *  - For "what did this keypress do", a MutationObserver on the table root records one Reading per
 *    render() batch. onKey -> heroAct -> applyAction -> advance() -> render() is synchronous, and
 *    MutationObserver delivers on a microtask, so the first Reading after a press is exactly the
 *    post-keypress render — captured before the 450ms villain timer can fire and overwrite it.
 *  - For "this keypress did NOTHING", the same synchrony makes an immediate read sufficient: an
 *    honoured key would already have re-rendered by the time keyboard.press() resolves. Every such
 *    test pairs the negative with a positive control key, so it cannot pass vacuously (e.g. because
 *    the window lost focus).
 */

const HERO_SEAT = '[data-testid="seat"][data-seat-id="0"]';
const homeScreen = '[data-testid="home-screen"]';
const raiseSlider = '[data-testid="raise-slider"]';
const winnerSummary = '[data-testid="winner-summary"]';
const nextHand = '[data-testid="next-hand"]';

/** Blinds/stacks are fixed in src/renderer/screens/table.ts. */
const BIG_BLIND = 50;
const START_STACK = CHIPS_IN_PLAY / 4;

/** Guard for every search/drive loop in this file. */
const MAX_HERO_TURNS = 12;

/** One render's worth of everything these tests assert on. */
interface Reading {
  pot: number;
  heroCommitted: number;
  heroStack: number;
  heroAllin: boolean;
  heroFolded: boolean;
  awaiting: string | null;
  stacks: number[];
  summary: string | null;
}

async function withApp<T>(seed: number, body: (page: Page) => Promise<T>): Promise<T> {
  const { page, close } = await launchApp({ seed });
  try {
    return await body(page);
  } finally {
    await close();
  }
}

async function sitDown(page: Page): Promise<void> {
  await page.waitForSelector(homeScreen);
  await page.locator(sel.newHand).click();
  await page.locator(tableScreen).waitFor();
  await waitForIdle(page);
}

/**
 * Install the render recorder. Exposes the reader itself on window so direct reads and recorded
 * reads can never disagree about how a Reading is computed.
 */
async function trackRenders(page: Page): Promise<void> {
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="table-screen"]');
    if (!(root instanceof HTMLElement)) throw new Error('table-screen missing');

    const read = (): Reading => {
      const seats = [...document.querySelectorAll<HTMLElement>('[data-testid="seat"]')];
      const hero = seats.find((s) => s.dataset.seatId === '0');
      if (hero === undefined) throw new Error('hero seat missing');
      const committed = hero.querySelector('[data-testid="seat-committed"]');
      const potText = document.querySelector('[data-testid="pot"]')?.textContent ?? '';
      const summaryEl = document.querySelector('[data-testid="winner-summary"]');
      return {
        pot: Number(potText.replace(/[^0-9-]/g, '')),
        heroCommitted: committed === null ? 0 : Number(committed.textContent),
        heroStack: Number(hero.querySelector('[data-testid="seat-stack"]')?.textContent ?? 'NaN'),
        heroAllin: hero.dataset.allin === 'true',
        heroFolded: hero.dataset.folded === 'true',
        awaiting: root.dataset.awaiting ?? null,
        stacks: seats.map((s) =>
          Number(s.querySelector('[data-testid="seat-stack"]')?.textContent ?? 'NaN'),
        ),
        summary: summaryEl === null ? null : summaryEl.textContent,
      };
    };

    const w = window as unknown as { __read: () => Reading; __renders: Reading[] };
    w.__read = read;
    w.__renders = [read()];
    new MutationObserver(() => {
      w.__renders.push(read());
    }).observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
  });
}

async function readNow(page: Page): Promise<Reading> {
  return page.evaluate(() => (window as unknown as { __read: () => Reading }).__read());
}

async function renderCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __renders: Reading[] }).__renders.length);
}

/** The first render recorded after `after` entries already existed. */
async function renderAfter(page: Page, after: number): Promise<Reading> {
  await page.waitForFunction(
    (n: number) => (window as unknown as { __renders: Reading[] }).__renders.length > n,
    after,
    { timeout: 10_000 },
  );
  const reading = await page.evaluate(
    (n: number) => (window as unknown as { __renders: Reading[] }).__renders[n],
    after,
  );
  expect(reading, `no render recorded at index ${after}`).toBeDefined();
  return reading;
}

/** Press a real OS key and return the render it produced. Throws if it produced none. */
async function pressAndCapture(page: Page, key: string): Promise<Reading> {
  const before = await renderCount(page);
  await page.keyboard.press(key);
  return renderAfter(page, before);
}

async function numericAttr(page: Page, selector: string, attr: string): Promise<number> {
  const raw = await page.getAttribute(selector, attr);
  expect(raw, `${selector}[${attr}] missing`).not.toBeNull();
  const value = Number(raw);
  expect(Number.isFinite(value), `${selector}[${attr}] = "${raw}"`).toBe(true);
  return value;
}

/** The renderer sets slider.min to minRaiseTo(state) — the amount R must raise to. */
async function minRaiseTo(page: Page): Promise<number> {
  await expect(page.locator(raiseSlider)).toBeEnabled();
  const min = await numericAttr(page, raiseSlider, 'min');
  const max = await numericAttr(page, raiseSlider, 'max');
  expect(min).toBeGreaterThanOrEqual(BIG_BLIND);
  expect(min).toBeLessThanOrEqual(max);
  return min;
}

/**
 * Reach a hero turn where legalActions() has no 'raise'/'bet'. Constructed, not hoped for: raise to
 * (max - BIG_BLIND) preflop, leaving the hero exactly one big blind behind. From then on every hero
 * turn is un-raiseable — either the stack cannot cover a min-raise, or (unopened pot) stack <= bb
 * bars an opening bet.
 */
async function reachUnraiseableHeroTurn(page: Page): Promise<void> {
  const max = await numericAttr(page, raiseSlider, 'max');
  const min = await minRaiseTo(page);
  const shortRaiseTo = max - BIG_BLIND;
  expect(shortRaiseTo, 'seed 42 must allow a raise that leaves exactly 1bb').toBeGreaterThan(min);

  await page.locator(raiseSlider).fill(String(shortRaiseTo));
  await page.locator(sel.btnRaise).click();

  // Capped: a stuck engine must fail loudly, not hang the runner.
  for (let turn = 0; ; turn++) {
    if (turn >= MAX_HERO_TURNS) {
      throw new Error(`no un-raiseable hero turn within ${MAX_HERO_TURNS} turns`);
    }
    const awaiting = await waitForIdle(page);
    if (awaiting === 'handover') throw new Error('hand settled before the hero acted again');
    if (!(await page.locator(sel.btnRaise).isEnabled())) break;
    // Should not happen on this seed, but keep the hand alive rather than hanging.
    await page.locator(sel.btnFold).click();
  }

  const behind = await page.locator(`${HERO_SEAT} [data-testid="seat-stack"]`).textContent();
  expect(Number(behind), 'hero should be sitting on exactly 1bb').toBe(BIG_BLIND);
}

/**
 * From the 1bb state, keep checking until the hero actually FACES a bet it cannot cover:
 * check illegal, btn-call live (the button shoves), raise dead. There legalActions() is
 * ['fold','allin'] — no 'call' at all.
 */
async function reachShortCallHeroTurn(page: Page): Promise<void> {
  await reachUnraiseableHeroTurn(page);
  for (let turn = 0; ; turn++) {
    if (turn >= MAX_HERO_TURNS) {
      throw new Error(`hero never faced an uncoverable bet within ${MAX_HERO_TURNS} turns`);
    }
    const awaiting = await waitForIdle(page);
    if (awaiting === 'handover') throw new Error('hand settled before the hero faced a bet');
    const facingBet = !(await page.locator(sel.btnCheck).isEnabled());
    if (facingBet && (await page.locator(sel.btnCall).isEnabled())) break;
    if (!facingBet) {
      await page.locator(sel.btnCheck).click();
      continue;
    }
    throw new Error('hero faces a bet with no call/all-in available');
  }
  await expect(page.locator(sel.btnRaise)).toBeDisabled();
}

/** Nothing at all may have moved. */
function expectUnchanged(after: Reading, before: Reading, why: string): void {
  expect(after.heroCommitted, `${why}: hero committed moved`).toBe(before.heroCommitted);
  expect(after.heroStack, `${why}: hero stack moved`).toBe(before.heroStack);
  expect(after.pot, `${why}: pot moved`).toBe(before.pot);
  expect(after.stacks, `${why}: stacks moved`).toEqual(before.stacks);
  expect(after.heroAllin, `${why}: hero went all-in`).toBe(before.heroAllin);
  expect(after.heroFolded, `${why}: hero folded`).toBe(before.heroFolded);
  expect(after.awaiting, `${why}: turn changed`).toBe(before.awaiting);
  expect(after.summary, `${why}: winner summary changed`).toBe(before.summary);
}

test.describe('R3 keyboard shortcuts: R (raise) and A (all-in)', () => {
  test('scenario 1: "r" raises to exactly minRaiseTo and the pot grows by the cost', async () => {
    await withApp(42, async (page) => {
      await sitDown(page);
      const min = await minRaiseTo(page);
      await trackRenders(page);
      const before = await readNow(page);
      expect(before.awaiting).toBe('hero');

      const after = await pressAndCapture(page, 'r');

      // The exact contract: raise TO the slider's min, i.e. minRaiseTo(state).
      expect(after.heroCommitted, `expected a raise to ${min}`).toBe(min);
      const cost = min - before.heroCommitted;
      expect(cost).toBeGreaterThan(0);
      expect(after.pot).toBe(before.pot + cost);
      expect(after.heroStack).toBe(before.heroStack - cost);
      expect(after.heroStack).toBe(START_STACK - min);
      // A raise passes the action on; it does not fold or shove the hero.
      expect(after.heroFolded).toBe(false);
      expect(after.heroAllin).toBe(false);
      expect(after.awaiting).not.toBe('hero');
      expect(after.stacks.reduce((a, b) => a + b, 0) + after.pot).toBe(CHIPS_IN_PLAY);
      await shot(page, 'keyboard-raise-min');
    });
  });

  test('scenario 2: "a" puts the hero all-in — data-allin="true" and seat-stack 0', async () => {
    await withApp(42, async (page) => {
      await sitDown(page);
      await expect(page.locator(HERO_SEAT)).not.toHaveAttribute('data-allin', 'true');
      await trackRenders(page);
      const before = await readNow(page);
      expect(before.heroStack).toBe(START_STACK);

      const after = await pressAndCapture(page, 'a');

      expect(after.heroAllin).toBe(true);
      expect(after.heroStack).toBe(0);
      expect(after.heroCommitted).toBe(START_STACK);
      expect(after.pot).toBe(before.pot + START_STACK - before.heroCommitted);
      expect(after.heroFolded).toBe(false);
      expect(after.awaiting).not.toBe('hero');
      expect(after.stacks.reduce((a, b) => a + b, 0) + after.pot).toBe(CHIPS_IN_PLAY);
      await shot(page, 'keyboard-allin');
    });
  });

  // A case-sensitive `e.key === 'r'` compare is a real bug class: with caps lock or shift held the
  // shortcut would silently die. onKey lowercases e.key; these two prove it.
  test('scenario 3a: Shift+R raises exactly like "r"', async () => {
    await withApp(42, async (page) => {
      await sitDown(page);
      const min = await minRaiseTo(page);
      await trackRenders(page);
      const before = await readNow(page);

      const after = await pressAndCapture(page, 'Shift+R');

      expect(after.heroCommitted, 'uppercase R was ignored').toBe(min);
      expect(after.pot).toBe(before.pot + (min - before.heroCommitted));
      expect(after.awaiting).not.toBe('hero');
    });
  });

  test('scenario 3b: Shift+A shoves exactly like "a"', async () => {
    await withApp(42, async (page) => {
      await sitDown(page);
      await trackRenders(page);
      const before = await readNow(page);

      const after = await pressAndCapture(page, 'Shift+A');

      expect(after.heroAllin, 'uppercase A was ignored').toBe(true);
      expect(after.heroStack).toBe(0);
      expect(after.pot).toBe(before.pot + START_STACK - before.heroCommitted);
    });
  });

  /**
   * Scenario 4. Constructed rather than hoped for: raise to (max - BIG_BLIND) preflop, which leaves
   * the hero exactly one big blind behind. From then on every hero turn is un-raiseable — either
   * the stack cannot cover a min-raise, or (unopened pot) stack <= bb bars an opening bet — so
   * legalActions() contains no 'raise'/'bet' and R must be inert.
   */
  test('scenario 4: "r" is ignored when raising is illegal (hero has 1bb behind)', async () => {
    await withApp(42, async (page) => {
      await sitDown(page);
      await reachUnraiseableHeroTurn(page);

      // btn-raise is disabled iff !heroTurn || !canRaise; awaiting === 'hero' fixes heroTurn true,
      // so this IS the app telling us legalActions() has neither 'raise' nor 'bet'.
      await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'hero');
      await expect(page.locator(sel.btnRaise)).toBeDisabled();
      await expect(page.locator(raiseSlider)).toBeDisabled();

      await trackRenders(page);
      const before = await readNow(page);
      const rendersBefore = await renderCount(page);

      await page.keyboard.press('r');

      // onKey is synchronous, so an honoured 'r' would already have re-rendered.
      expect(await renderCount(page), 'an illegal "r" re-rendered the table').toBe(rendersBefore);
      expectUnchanged(await readNow(page), before, 'illegal r');

      // Vacuity control: the SAME real key mechanism is honoured in this exact state for a legal
      // key. 'fold' is always legal for a seat that can act, so this cannot itself be flaky.
      const folded = await pressAndCapture(page, 'f');
      expect(folded.heroFolded, 'keyboard was dead in this state').toBe(true);
    });
  });

  test('scenario 5: "a" is ignored while data-awaiting="ai"', async () => {
    await withApp(42, async (page) => {
      await sitDown(page);
      await trackRenders(page);

      // Pass the turn and fire the key in the SAME JS turn, so the press provably lands while
      // data-awaiting === 'ai' instead of racing the 450ms villain timer.
      const duringAi = await page.evaluate(() => {
        const call = document.querySelector('[data-testid="btn-call"]');
        if (!(call instanceof HTMLButtonElement)) throw new Error('btn-call missing');
        const read = (window as unknown as { __read: () => Reading }).__read;
        call.click();
        const atPress = read();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
        return { atPress, afterPress: read() };
      });

      expect(duringAi.atPress.awaiting).toBe('ai');
      expect(duringAi.afterPress.heroAllin, 'the hero shoved on a villain\'s turn').toBe(false);
      expectUnchanged(duringAi.afterPress, duringAi.atPress, '"a" during ai');
      expect(duringAi.afterPress.heroStack).toBeGreaterThan(0);

      // Vacuity control: the same synthesised press IS honoured once the turn comes back, so the
      // assertion above is not passing merely because dispatchEvent does nothing here.
      const awaiting = await waitForIdle(page);
      if (awaiting === 'hero') {
        const honoured = await page.evaluate(() => {
          const read = (window as unknown as { __read: () => Reading }).__read;
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
          return read();
        });
        expect(honoured.heroAllin, 'control: "a" on the hero turn must shove').toBe(true);
        expect(honoured.heroStack).toBe(0);
      } else {
        throw new Error(`hand settled before the hero could act again (awaiting=${awaiting})`);
      }
    });
  });

  test('scenario 6: f/c/r/a are all ignored at handover', async () => {
    await withApp(42, async (page) => {
      await sitDown(page);
      await playToShowdown(page);
      await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'handover');
      await expect(page.locator(winnerSummary)).toBeVisible();

      await trackRenders(page);
      const before = await readNow(page);
      const rendersBefore = await renderCount(page);
      expect(before.summary).toMatch(/wins \d+/);
      expect(before.pot, 'a settled pot is fully distributed').toBe(0);
      expect(before.stacks.reduce((a, b) => a + b, 0)).toBe(CHIPS_IN_PLAY);

      // A late keypress must not mutate a finished hand.
      for (const key of ['f', 'c', 'r', 'a']) {
        await page.keyboard.press(key);
        expectUnchanged(await readNow(page), before, `"${key}" at handover`);
      }

      expect(await renderCount(page), 'a key re-rendered a settled hand').toBe(rendersBefore);
      await expect(page.locator(winnerSummary)).toBeVisible();
      expect((await page.textContent(winnerSummary)) ?? '').toBe(before.summary);
      await expect(page.locator(nextHand)).toBeVisible();
      // The settled table is still usable afterwards — the keys were inert, not destructive.
      await page.locator(nextHand).click();
      expect(await waitForIdle(page)).toBe('hero');
    });
  });

  test('scenario 7: unbound keys (x, z, Enter) do nothing', async () => {
    await withApp(42, async (page) => {
      await sitDown(page);
      await trackRenders(page);

      // Enter would "click" a focused button, which is browser behaviour, not the keyboard handler
      // under test. Park focus on <body> so the press can only reach onKey.
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      expect(
        await page.evaluate(() => document.activeElement?.tagName ?? null),
      ).toBe('BODY');

      const before = await readNow(page);
      const rendersBefore = await renderCount(page);
      expect(before.awaiting).toBe('hero');

      for (const key of ['x', 'z', 'Enter']) {
        await page.keyboard.press(key);
        expectUnchanged(await readNow(page), before, `unbound "${key}"`);
        await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'hero');
      }
      expect(await renderCount(page), 'an unbound key re-rendered the table').toBe(rendersBefore);

      // Vacuity control: a bound key in the same state, same mechanism, does act.
      const raised = await pressAndCapture(page, 'r');
      expect(raised.heroCommitted).toBeGreaterThan(before.heroCommitted);
    });
  });

  /**
   * Scenario 8. The shortcut must not be a second, divergent implementation of raising. Same seed,
   * two separate launches (each commits chips, so they cannot share one app): keyboard 'r' vs
   * clicking btn-raise with the slider left at its default, which the renderer sets to min.
   */
  test('scenario 8: "r" and btn-raise at slider-min produce identical results', async () => {
    const viaKeyboard = await withApp(42, async (page) => {
      await sitDown(page);
      const min = await minRaiseTo(page);
      await trackRenders(page);
      const after = await pressAndCapture(page, 'r');
      return { min, after };
    });

    const viaButton = await withApp(42, async (page) => {
      await sitDown(page);
      const min = await minRaiseTo(page);
      await trackRenders(page);
      const before = await renderCount(page);
      // Slider untouched: renderControls() initialises value to min.
      expect(Number(await page.locator(raiseSlider).inputValue())).toBe(min);
      await page.locator(sel.btnRaise).click();
      const after = await renderAfter(page, before);
      return { min, after };
    });

    expect(viaButton.min, 'the two launches must reach the same decision point').toBe(
      viaKeyboard.min,
    );
    expect(viaKeyboard.after.heroCommitted).toBe(viaKeyboard.min);
    expect(viaButton.after.heroCommitted).toBe(viaButton.min);
    expect(viaKeyboard.after.heroCommitted).toBe(viaButton.after.heroCommitted);
    expect(viaKeyboard.after.heroStack).toBe(viaButton.after.heroStack);
    expect(viaKeyboard.after.pot).toBe(viaButton.after.pot);
    expect(viaKeyboard.after.stacks).toEqual(viaButton.after.stacks);
  });

  /**
   * BUG REGRESSION (found by this spec, fixed in src/renderer/screens/table.ts).
   *
   * Facing a bet bigger than the hero's stack, legalActions() returns ['fold','allin'] — there is no
   * 'call', because an all-in IS the call. btn-call already handled that (`kind: legal.includes(
   * 'call') ? 'call' : 'allin'`), but onKey's C branch only tried 'check' then 'call', so the
   * shortcut was silently dead in exactly the spot where a player is most likely to reach for it.
   *
   * Measured on this exact setup BEFORE the fix (seed 42, hero on 1bb facing "Call 50"):
   *   btn-call   -> hero allin=true,  awaiting handover   (the shove was made)
   *   keyboard c -> hero allin=null,  awaiting hero       (nothing happened at all)
   * Same seed, same decision point, two different outcomes — scenario 8's agreement check applied
   * to C. With the fix both paths shove, so the two launches agree on every number.
   */
  test('bug regression: "c" all-ins as the call when the hero cannot cover the bet', async () => {
    const outcome = async (
      act: (page: Page) => Promise<void>,
    ): Promise<{ before: Reading; after: Reading }> =>
      withApp(42, async (page) => {
        await sitDown(page);
        await reachShortCallHeroTurn(page);

        // Pin the state: a live bet the hero cannot cover, so 'call' is not legal but the call
        // button still offers the shove. The amount owed is at least the hero's whole 1bb stack.
        const callLabel = (await page.textContent(sel.btnCall)) ?? '';
        expect(Number(callLabel.replace(/[^0-9]/g, ''))).toBeGreaterThanOrEqual(BIG_BLIND);

        await trackRenders(page);
        const before = await readNow(page);
        expect(before.heroStack).toBe(BIG_BLIND);
        expect(before.heroAllin).toBe(false);
        const renders = await renderCount(page);
        await act(page);
        return { before, after: await renderAfter(page, renders) };
      });

    const viaKeyboard = await outcome((page) => page.keyboard.press('c'));
    const viaButton = await outcome((page) => page.locator(sel.btnCall).click());

    // The bug: viaKeyboard.after was identical to viaKeyboard.before — 1bb still behind, still the
    // hero's turn, never flagged all-in.
    expect(viaKeyboard.after.heroAllin, '"c" did not commit the short stack').toBe(true);
    expect(viaKeyboard.after.heroFolded, '"c" folded instead of calling').toBe(false);
    expect(viaKeyboard.after.awaiting, '"c" left the hero still to act').not.toBe('hero');

    // And it must match the button exactly — one contract, not two code paths.
    expect(viaButton.before.heroStack, 'both launches must reach the same spot').toBe(
      viaKeyboard.before.heroStack,
    );
    expect(viaButton.after.heroAllin).toBe(true);
    expect(viaKeyboard.after.heroCommitted).toBe(viaButton.after.heroCommitted);
    expect(viaKeyboard.after.heroStack).toBe(viaButton.after.heroStack);
    expect(viaKeyboard.after.pot).toBe(viaButton.after.pot);
    expect(viaKeyboard.after.stacks).toEqual(viaButton.after.stacks);
    expect(viaKeyboard.after.awaiting).toBe(viaButton.after.awaiting);
  });
});
