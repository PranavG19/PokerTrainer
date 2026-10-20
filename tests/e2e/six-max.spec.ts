import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, sel } from './helpers.js';
import { playToShowdown, tableScreen, waitForIdle } from './flow.js';

/**
 * 6-MAX (BUILD-PLAN 2.12) — the table Play opens with five opponents. What it pins: six seats, each wearing one
 * of UTG, HJ, CO, BTN, SB, BB; the button and the positions move one seat a hand; five masked regulars; and the
 * scoreboard layout (seatLayout.ts: two per side, one on top) fits both documented sizes with no seat over a seat,
 * the board, a bet or a table corner, mid-hand and at showdown. Grading by the 6-max charts is pinned in
 * tests/unit/sixMax.test.ts; the theme and cosmetic paint-only check runs on this table in theme.spec.
 */

const SIZES = [
  [900, 640],
  [1100, 760],
] as const;

async function openSixMax(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.click('[data-testid="tab-play"]');
  await page.click('[data-testid="play-six-max"]');
  await page.waitForSelector(`${tableScreen}[data-table-size="6"]`);
  await waitForIdle(page);
}

async function setSize(app: ElectronApplication, page: Page, w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [cw, ch]) => BrowserWindow.getAllWindows()[0].setContentSize(cw, ch), [w, h]);
  await page.waitForFunction(([cw, ch]) => innerWidth === cw && innerHeight === ch, [w, h]);
  // Two frames: the container-query tiers re-resolve on the frame after the resize.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Every pair of table pieces that overlap, plus the page's scroll extent. */
function collisions(page: Page): Promise<{ overlaps: string[]; scrollW: number; scrollH: number }> {
  return page.evaluate(() => {
    const hit = (a: DOMRect, b: DOMRect): boolean =>
      a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    const pieces = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-testid="seat"], [data-testid="board"], [data-testid="pot"], [data-testid="seat-committed"], .table-corner',
      ),
    ];
    const name = (el: HTMLElement): string =>
      el.dataset.testid === 'seat' ? `seat ${el.dataset.seatId}` : (el.dataset.testid ?? el.className);
    const out: string[] = [];
    for (let i = 0; i < pieces.length; i++)
      for (let j = i + 1; j < pieces.length; j++) {
        const [a, b] = [pieces[i], pieces[j]];
        if (a.contains(b) || b.contains(a)) continue;
        if (hit(a.getBoundingClientRect(), b.getBoundingClientRect())) out.push(`${name(a)} x ${name(b)}`);
      }
    return { overlaps: out, scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight };
  });
}

test('Play opens a 6-max table: six seats, each position once, five masked regulars', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await openSixMax(page);
    await expect(page.locator(sel.seat)).toHaveCount(6);
    const positions = await page.locator('[data-testid="seat-position"]').allTextContents();
    expect([...positions].sort()).toEqual(['BB', 'BTN', 'CO', 'HJ', 'SB', 'UTG']);
    // Hand 1: the button is the hero's seat, so the hero is BTN and the blinds sit on its left.
    await expect(page.locator('[data-testid="seat"][data-seat-id="0"]')).toHaveAttribute('data-position', 'BTN');
    await expect(page.locator('[data-testid="seat"][data-seat-id="1"]')).toHaveAttribute('data-position', 'SB');
    await expect(page.locator('[data-testid="seat"][data-seat-id="2"]')).toHaveAttribute('data-position', 'BB');
    await expect(page.locator('.table-corner-l')).toHaveText('6-max · Blinds 25/50');
    // O3: every villain's style is hidden mid-hand.
    await expect(page.locator('[data-testid="seat-archetype"]')).toHaveText(Array(5).fill('Unknown'));
  } finally {
    await close();
  }
});

/** Fold (or check when free) until the hand ends: quick, and the hero never busts. */
async function foldOut(page: Page): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if ((await waitForIdle(page)) === 'handover') return;
    const fold = page.locator(sel.btnFold);
    const check = page.locator(sel.btnCheck);
    await ((await check.isEnabled()) ? check : fold).click();
  }
  throw new Error('the hand did not end');
}

test('the button and every position move one seat a hand, a full orbit', async () => {
  // Six hands with five villains playing each one out after the hero folds: well past one minute under load.
  test.setTimeout(180_000);
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await openSixMax(page);
    let previousButton = -1;
    let sawSixLive = 0;
    for (let hand = 0; hand < 6; hand++) {
      const seats = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="seat"]')]
          .map((el) => ({
            id: Number(el.dataset.seatId),
            out: el.dataset.out === 'true',
            position: el.dataset.position ?? null,
            button: el.querySelector('[data-testid="dealer-button"]') !== null,
          }))
          .sort((x, y) => x.id - y.id),
      );
      const live = seats.filter((x) => !x.out);
      const button = seats.findIndex((x) => x.button);
      // The button moves to the next seat with chips (a villain can bust at this table; it then sits out).
      const expectedButton = hand === 0 ? 0 : [1, 2, 3, 4, 5, 6].map((d) => (previousButton + d) % 6).find((i) => !seats[i].out);
      expect(button, `hand ${hand + 1} button`).toBe(expectedButton);
      previousButton = button;
      // Clockwise from the button: BTN, SB, BB, then the tail of UTG, HJ, CO; a sat-out seat wears nothing.
      const clockwise = [0, 1, 2, 3, 4, 5].map((d) => seats[(button + d) % 6]).filter((x) => !x.out);
      // Heads-up the button posts the small blind, so it reads SB (seatPositions, as the engine posts).
      const expected = live.length === 2 ? ['SB', 'BB'] : ['BTN', 'SB', 'BB', ...['UTG', 'HJ', 'CO'].slice(6 - live.length)];
      expect(clockwise.map((x) => x.position), `hand ${hand + 1} positions`).toEqual(expected);
      for (const x of seats.filter((y) => y.out)) expect(x.position, `seat ${x.id} sits out`).toBeNull();
      if (live.length === 6) sawSixLive++;
      await foldOut(page);
      await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'handover');
      // At hand end the five regulars are revealed, each a different style.
      const labels = await page.locator('[data-testid="seat-archetype"]').allTextContents();
      expect(new Set(labels).size).toBe(5);
      expect(labels).not.toContain('Unknown');
      await page.click('[data-testid="next-hand"]');
      await waitForIdle(page);
    }
    expect(sawSixLive, 'the full six-handed labels were checked at least once').toBeGreaterThan(0);
  } finally {
    await close();
  }
});

test('the 6-max layout fits 900x640 and 1100x760 with nothing overlapping, mid-hand and at showdown', async ({}, testInfo) => {
  const { app, page, close } = await launchApp({ seed: 42 });
  try {
    await openSixMax(page);
    // Mid-hand: the hero to act preflop facing the cutoff's open, the blinds and the open in front of three seats.
    await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'hero');
    for (const [w, h] of SIZES) {
      await setSize(app, page, w, h);
      const g = await collisions(page);
      expect(g.overlaps, `mid-hand ${w}x${h}`).toEqual([]);
      expect([g.scrollW, g.scrollH], `mid-hand ${w}x${h} page scroll`).toEqual([w, h]);
      for (const id of ['btn-fold', 'btn-call', 'btn-raise', 'raise-slider']) {
        const b = await page.locator(`[data-testid="${id}"]`).boundingBox();
        expect(b !== null && b.x >= 0 && b.y >= 0 && b.x + b.width <= w && b.y + b.height <= h, `${id} on screen at ${w}x${h}`).toBe(true);
      }
      await page.screenshot({ path: testInfo.outputPath(`six-max-mid-${w}x${h}.png`) });
    }
    // Showdown: the quips are revealed (the widest a seat gets) and the board is complete.
    await playToShowdown(page);
    await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'handover');
    for (const [w, h] of SIZES) {
      await setSize(app, page, w, h);
      const g = await collisions(page);
      expect(g.overlaps, `showdown ${w}x${h}`).toEqual([]);
      expect([g.scrollW, g.scrollH], `showdown ${w}x${h} page scroll`).toEqual([w, h]);
      await page.screenshot({ path: testInfo.outputPath(`six-max-showdown-${w}x${h}.png`) });
    }
  } finally {
    await close();
  }
});

/**
 * The short stage. At 900x640 the stage shrinks when coached mode, a verdict or the stats sheet take height, and the
 * compact tiers (≤400px, ≤320px) restyle the seats; the 6-max side band has its own ≤320 rule. Each tier is forced
 * here at showdown (the widest seats) rather than reached through a particular verdict, so every tier is measured.
 * At the 236px floor the top seat touches the pot on the 4-max table too (origin/main, measured), so only that one
 * pair is allowed there; it is open in the six-max FINDINGS.
 */
test('the 6-max layout holds on the short stage: coached mode and every compact tier at 900x640', async ({}, testInfo) => {
  const { app, page, close } = await launchApp({ seed: 42 });
  try {
    await openSixMax(page);
    await setSize(app, page, 900, 640);
    await page.click('[data-testid="coach-mode-toggle"]');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const coached = await collisions(page);
    expect(coached.overlaps, 'coached mid-hand 900x640').toEqual([]);
    expect([coached.scrollW, coached.scrollH], 'coached page scroll').toEqual([900, 640]);
    await page.click('[data-testid="coach-mode-toggle"]');
    await playToShowdown(page);
    await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'handover');
    for (const px of [400, 360, 320, 280, 236]) {
      await page.evaluate((h) => {
        const stage = document.querySelector<HTMLElement>('.table-stage');
        stage?.style.setProperty('flex', 'none');
        stage?.style.setProperty('height', `${h}px`);
      }, px);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const g = await collisions(page);
      const allowed = px === 236 ? ['seat 3 x pot'] : [];
      expect(g.overlaps.filter((o) => !allowed.includes(o)), `stage ${px}px`).toEqual([]);
      if (px === 236) await page.screenshot({ path: testInfo.outputPath('six-max-stage-236.png') });
    }
  } finally {
    await close();
  }
});

test('a 6-max hand lands in the hand history like any other', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await openSixMax(page);
    await playToShowdown(page);
    await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'handover');
    await page.click(sel.tabPlay);
    await expect(page.locator('[data-testid="hand-row"]')).toHaveCount(1);
  } finally {
    await close();
  }
});
