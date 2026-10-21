import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, sel, shot } from './helpers.js';
import { tableScreen, waitForIdle } from './flow.js';
import type { Card } from '../../src/core/cards.js';

/**
 * DEE — the character layer, end to end and hidden. The perch in the title bar, the hand-end beat, Price held,
 * lessons as dialogue, and Dee's settings. Every sync point is a published data attribute; nothing sleeps.
 */

const perch = '[data-testid="dee-perch"]';
const beat = '[data-testid="dee-beat"]';
const modeToggle = '[data-testid="coach-mode-toggle"]';
const gateInput = '[data-testid="gate-input"]';
const gateSubmit = '[data-testid="gate-submit"]';
const coachClose = '[data-testid="coach-close"]';
const lessonScreen = '[data-testid="lesson-screen"]';

function freshDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-dee-'));
}

async function withApp(opts: { seed: number; dir?: string }, body: (page: Page) => Promise<void>): Promise<void> {
  const launched = await launchApp({ seed: opts.seed, userDataDir: opts.dir ?? freshDir() });
  try {
    await body(launched.page);
  } finally {
    await launched.close();
  }
}

async function commit(page: Page, action: string, confidence: 'sure' | 'guess', reason = ''): Promise<void> {
  if (reason !== '') await page.locator('[data-testid="reason-input"]').fill(reason);
  await page.locator(`[data-testid="predict-${action}"]`).click();
  await page.locator(`[data-testid="confidence-${confidence}"]`).click();
}

async function noPageScroll(page: Page): Promise<void> {
  const over = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }));
  expect(over.y, 'no vertical page scroll').toBeLessThanOrEqual(0);
  expect(over.x, 'no horizontal page scroll').toBeLessThanOrEqual(0);
}

async function setSize(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
}

const SIZES: [number, number][] = [
  [1100, 760],
  [900, 640],
];

test.describe('Dee', () => {
  test('1. the perch: Dee and the streak in the title bar, opening Dee chat and through it Dee’s settings; Character off hides Dee everywhere', async () => {
    await withApp({ seed: 42 }, async (page) => {
      const p = page.locator(perch);
      await expect(p).toBeVisible();
      await expect(p).toHaveAttribute('aria-label', /Dee/);
      await expect(p.locator('[data-testid="dee-mark"]')).toHaveAttribute('data-size', '20');
      await expect(p.locator('[data-testid="dee-mark"]')).toHaveAttribute('aria-hidden', 'true');
      // It lives in the title bar, beside the tabs, and it fits at both sizes.
      for (const [w, h] of SIZES) {
        await setSize(page, w, h);
        const box = await p.boundingBox();
        const nav = await page.locator('nav.tabs').boundingBox();
        expect(box && nav && box.y >= nav.y && box.y + box.height <= nav.y + nav.height).toBe(true);
        expect(box && box.x + box.width <= w).toBe(true);
        await noPageScroll(page);
      }
      // The perch opens Dee chat (feat/dee-chat); the chat's Settings button opens Dee's settings.
      await p.click();
      await expect(page.locator('[data-testid="dee-chat"]')).toBeVisible();
      await page.locator('[data-testid="dee-chat-settings"]').click();
      await expect(page.locator('[data-testid="dee-chat"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="dee-settings"]')).toBeVisible();

      // Character off: the perch and every mark go; the setting persists.
      await page.locator('[data-testid="dee-character-toggle"]').click();
      await expect(page.locator('html')).toHaveAttribute('data-character', 'off');
      await expect(p).toBeHidden();
      const visibleMarks = await page.locator('[data-testid="dee-mark"]').evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).length);
      expect(visibleMarks).toBe(0);
      // The way back does not depend on the perch: Settings links to Dee.
      await page.locator('[data-testid="tab-settings"]').click();
      await page.locator('[data-testid="open-dee-settings"]').click();
      await page.locator('[data-testid="dee-character-toggle"]').click();
      await expect(page.locator('html')).toHaveAttribute('data-character', 'on');
      await expect(p).toBeVisible();
    });
  });

  test('2. the hand-end beat: one line after the hand, numbers from the verdict, the contracts intact', async () => {
    // Seed 10, the coach specs' pin (seed 8's first-in QQ limp is a chart mistake since the grader reads
    // the charts preflop): calling the limp is free, folding middle pair to the flop bet is serious.
    await withApp({ seed: 10 }, async (page) => {
      await page.locator(sel.newHand).click();
      await page.locator(tableScreen).waitFor();
      expect(await waitForIdle(page)).toBe('hero');
      await page.locator(modeToggle).click();

      // In-hand Dee says nothing: no beat while the hand is live, and the perch glances at the reason.
      await page.locator('[data-testid="reason-input"]').focus();
      await expect(page.locator(perch)).toHaveAttribute('data-pose', 'glance');
      await commit(page, 'call', 'sure');
      await page.locator(sel.btnCall).click();
      expect(await waitForIdle(page)).toBe('hero');
      await expect(page.locator(beat)).toHaveCount(0);

      // Seed 10: folding middle pair to a cheap flop bet is a serious mistake. Commit-before-feedback and the gate still hold.
      const potBefore = ((await page.locator(sel.pot).textContent()) ?? '').replace(/[^0-9]/g, '');
      await commit(page, 'fold', 'sure');
      await page.locator(sel.btnFold).click();
      await expect(page.locator(tableScreen)).toHaveAttribute('data-gate', 'open');
      await expect(page.locator(perch)).toHaveAttribute('data-pose', 'gate');
      await expect(page.locator(beat)).toHaveCount(0);
      await page.locator(gateInput).fill('my hand is strong');
      await page.locator(gateSubmit).click();
      await page.locator(gateInput).fill('the price is low and my pot share is above it');
      await page.locator(gateSubmit).click();
      await expect(page.locator('[data-testid="coach-panel"], .coach').first()).toHaveAttribute('data-severity', 'serious');
      await expect(page.locator(perch)).toHaveAttribute('data-pose', 'serious');
      const verdict = (await page.locator(sel.coach).textContent()) ?? '';
      await expect(page.locator('[data-testid="coach-announcer"]')).toHaveText(verdict);

      expect(await waitForIdle(page)).toBe('handover');
      await expect(page.locator(beat)).toHaveCount(1);
      await expect(page.locator(beat)).toHaveAttribute('data-event', 'verdict');
      await expect(page.locator(beat)).toHaveAttribute('data-pose', 'serious');
      const line = (await page.locator('[data-testid="dee-beat-line"]').textContent()) ?? '';
      expect(line.trim().split(/\s+/).length).toBeLessThanOrEqual(18 + 11);
      // Every number in Dee's line is one the engine put in the verdict (pot shares, cost, the bet, the pot).
      const engineNumbers = new Set([...verdict.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]));
      const contextText = (await page.locator('[data-testid="coach-context"]').textContent()) ?? '';
      for (const m of contextText.matchAll(/\d+/g)) engineNumbers.add(m[0]);
      engineNumbers.add(potBefore);
      const shares = (await page.locator('[data-testid="coach-meter"]').getAttribute('aria-label')) ?? '';
      for (const m of shares.matchAll(/\d+/g)) engineNumbers.add(m[0]);
      for (const n of line.match(/\d+(?:\.\d+)?/g) ?? []) {
        expect(engineNumbers.has(n), `${n} in "${line}" came from the engine`).toBe(true);
      }
      await expect(page.locator('[data-testid="dee-announcer"]')).toHaveText(`Dee: ${line}`);
      // The verdict's own channels are untouched by Dee.
      await expect(page.locator('[data-testid="coach-announcer"]')).toHaveText(verdict);
      await expect(page.locator('[data-testid="outcome-announcer"]')).not.toHaveText('');

      for (const [w, h] of SIZES) {
        await setSize(page, w, h);
        await noPageScroll(page);
        await boardAtRest(page);
        await shot(page, `dee-beat-${w}x${h}`);
      }
      // Closing the hand-end verdict with Esc puts focus on Next hand, so Enter deals (review item 5: "Ask Dee"
      // sits before it in the dock and must not take the focus).
      await expect(page.locator(coachClose)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="next-hand"]')).toBeFocused();
      // The beat is back in the dock once the sheet is gone, and it is cleared with the hand.
      await expect(page.locator(`.controls ${beat}`)).toHaveCount(1);
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-testid="dee-chat"]')).toHaveCount(0);
      await expect(page.locator(beat)).toHaveCount(0);
      await expect(page.locator('[data-testid="dee-announcer"]')).toHaveText('');
    });
  });

  test('3. Price held: a close spot played right, said Sure with the price as the reason', async () => {
    /**
     * Seed 33, hand 1, found by replaying the renderer path (archetype draw, the villain stream, gradeSpot)
     * through Dee's isPriceHeld: calling preflop is free and not close; the next decision faces a postflop
     * bet that the grader's close band calls close, and folding is the right side of the price. The band
     * decides what is close (Grade.close), not a fixed points rule, so the spec pins a spot rather than
     * re-deriving closeness itself.
     */
    await withApp({ seed: 33 }, async (page) => {
      await page.locator(sel.newHand).click();
      await page.locator(tableScreen).waitFor();
      expect(await waitForIdle(page)).toBe('hero');
      await page.locator(modeToggle).click();

      await commit(page, 'call', 'guess');
      await page.locator(sel.btnCall).click();
      await settleSheets(page);
      expect(await waitForIdle(page)).toBe('hero');
      const spot = await readSpot(page);
      expect(spot.street, 'the close spot is postflop').not.toBe('preflop');
      expect(spot.toCall, 'the close spot faces a bet').toBeGreaterThan(0);
      await commit(page, 'fold', 'sure', 'the price is too high for my pot share and the pot odds decide it');
      await page.locator(sel.btnFold).click();

      expect(await waitForIdle(page)).toBe('handover');
      await expect(page.locator(beat)).toHaveAttribute('data-event', 'price-held');
      await expect(page.locator(beat)).toHaveAttribute('data-pose', 'price-held');
      await expect(page.locator('[data-testid="dee-beat-line"]')).toContainText('Price held');
      // No verdict sheet: the decision cost nothing, so the coach stays silent; only Dee's beat speaks.
      await expect(page.locator('[data-testid="coach-announcer"]')).toHaveText('');
      for (const [w, h] of SIZES) {
        await setSize(page, w, h);
        await noPageScroll(page);
        await boardAtRest(page);
        await shot(page, `dee-price-held-${w}x${h}`);
      }
    });
  });

  test('4. a lesson as dialogue: Dee asks, you commit, a wrong answer gets a question back', async () => {
    await withApp({ seed: 42 }, async (page) => {
      await page.locator('[data-testid="tab-learn"]').click();
      await page.locator(`[data-testid="lesson-row"][data-lesson-id="minimum-defence-frequency"]`).click();
      await expect(page.locator(lessonScreen)).toHaveAttribute('data-lesson-id', 'minimum-defence-frequency');
      const dialogue = page.locator('[data-testid="dee-dialogue"]');
      await expect(dialogue).toBeVisible();
      await expect(page.locator('[data-testid="lesson-prompt"]')).not.toBeEmpty();
      await expect(page.locator('[data-testid="commit-answer"]')).toHaveCount(0);

      // Commit before feedback: no reveal and no reply before a commit; Commit is disabled until a pick.
      await expect(page.locator('[data-testid="lesson-reveal"]')).toHaveCount(0);
      await expect(page.locator(lessonScreen)).toHaveAttribute('data-committed', 'false');
      const commitBtn = page.locator('[data-testid="dialogue-commit"]');
      await expect(commitBtn).toBeDisabled();
      const turnsBefore = await page.locator('[data-testid="dee-turn"]').count();
      const lastDee = page.locator('[data-testid="dee-turn"]').last();
      await expect(lastDee).toContainText('?');

      // The announcer is mounted once: tag the node, and check the same node is still in place after a pick and a commit.
      await page.evaluate(() => {
        (document.querySelector('[data-testid="dialogue-announcer"]') as HTMLElement & { __dee?: boolean }).__dee = true;
      });
      const sameAnnouncer = (): Promise<boolean> =>
        page.evaluate(() => {
          const el = document.querySelector('[data-testid="dialogue-announcer"]') as (HTMLElement & { __dee?: boolean }) | null;
          return el !== null && el.isConnected && el.__dee === true && document.querySelectorAll('[data-testid="dialogue-announcer"]').length === 1;
        });
      // A wrong answer (300, the pot that already holds the bet): a question back, no grade, the option marked tried.
      await page.locator('[data-testid="dialogue-option"]', { hasText: /^300$/ }).click();
      await expect(commitBtn).toBeEnabled();
      await commitBtn.click();
      await expect(page.locator('[data-testid="you-turn"]').last()).toHaveAttribute('data-right', 'false');
      expect(await sameAnnouncer(), 'the announcer survives a pick and a commit').toBe(true);
      const back = (await page.locator('[data-testid="dee-turn"]').last().textContent()) ?? '';
      expect(back.trim().endsWith('?'), back).toBe(true);
      expect(back.toLowerCase()).not.toMatch(/\b(wrong|incorrect|correct|good|nice|great)\b/);
      expect(await page.locator('[data-testid="dee-turn"]').count()).toBe(turnsBefore + 1);
      const backLine = (await page.locator('[data-testid="dee-turn"]').last().locator('.dee-say').textContent()) ?? '';
      await expect(page.locator('[data-testid="dialogue-announcer"]')).toHaveText(backLine);
      // Focus stays in the answer, on the first option still open.
      expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('dialogue-option');
      await expect(page.locator('[data-testid="dialogue-option"]', { hasText: /^300$/ })).toBeDisabled();
      await expect(page.locator('[data-testid="lesson-reveal"]')).toHaveCount(0);

      for (const [w, h] of SIZES) {
        await setSize(page, w, h);
        await noPageScroll(page);
        await page.locator('[data-testid="dialogue-ask"]').scrollIntoViewIfNeeded();
        await shot(page, `dee-lesson-${w}x${h}`);
      }

      // The right answers, step by step: 200, then 1 in 3, then 2 in 3.
      for (const answer of ['200', '1 in 3', '2 in 3']) {
        await page.locator('[data-testid="dialogue-option"]', { hasText: new RegExp(`^${answer}$`) }).click();
        await commitBtn.click();
      }
      await expect(dialogue).toHaveAttribute('data-done', 'true');
      expect(await sameAnnouncer(), 'the announcer survives every step').toBe(true);
      await expect(page.locator(lessonScreen)).toHaveAttribute('data-committed', 'true');
      await expect(page.locator('[data-testid="lesson-reveal"]')).toHaveCount(1);
      await expect(page.locator('[data-testid="lesson-reasoning"]')).toContainText('2 hands in 3');
      await expect(page.locator('[data-testid="dialogue-ask"]')).toHaveCount(0);
      // New turns are announced through one persistent polite region (the thread itself is rebuilt each render).
      await expect(page.locator('[data-testid="dialogue-announcer"]')).toHaveAttribute('aria-live', 'polite');
      await expect(page.locator('[data-testid="dialogue-announcer"]')).not.toHaveText('');
      // Focus lands on the reveal, not <body>.
      expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('lesson-reveal');
      await page.locator('[data-testid="lesson-reveal"]').scrollIntoViewIfNeeded();
      await shot(page, 'dee-lesson-done-900x640');

      // A lesson with no script keeps its commit box (pot odds: the tutor rail specs drive it).
      await page.locator('[data-testid="lesson-back"]').click();
      await page.locator(`[data-testid="lesson-row"][data-lesson-id="pot-odds-as-a-price"]`).click();
      await expect(page.locator('[data-testid="commit-answer"]')).toBeVisible();
      await expect(page.locator('[data-testid="dee-dialogue"]')).toHaveCount(0);
    });
  });

  test('5. Dee’s settings: the dial changes words not numbers; frequency and Character persist', async () => {
    const dir = freshDir();
    await withApp({ seed: 42, dir }, async (page) => {
      await page.locator(perch).click();
      await page.locator('[data-testid="dee-chat-settings"]').click();
      const line = page.locator('[data-testid="dee-preview-line"]');
      const numbers = async (): Promise<string> => ((await line.textContent()) ?? '').match(/\d+%?/g)?.join(' ') ?? '';
      const warm = await line.textContent();
      const warmNumbers = await numbers();
      expect(warmNumbers).not.toBe('');
      await page.locator('[data-testid="dee-tone"] button[data-value="blunt"]').click();
      await expect(line).not.toHaveText(warm ?? '');
      expect(await numbers()).toBe(warmNumbers);
      await page.locator('[data-testid="dee-moment"] button[data-value="mistake"]').click();
      await expect(page.locator('[data-testid="dee-preview-mark"] [data-testid="dee-mark"]')).toHaveAttribute('data-pose', 'serious');
      await page.locator('[data-testid="dee-frequency-mistakes"]').click();
      await expect(page.locator('[data-testid="dee-frequency-mistakes"]')).toHaveAttribute('aria-checked', 'true');
      for (const [w, h] of SIZES) {
        await setSize(page, w, h);
        await noPageScroll(page);
        await shot(page, `dee-settings-${w}x${h}`);
      }
    });
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'offsuit-state.json'), 'utf-8')) as {
      progression: { dee: { personality: { tone: string; frequency: string; quiet: string }; character: boolean } };
    };
    // `quiet` (1.8, the quieter level) is additive and untouched here, so it is the default.
    expect(saved.progression.dee.personality).toEqual({ tone: 'blunt', frequency: 'mistakes', quiet: 'standard' });
    expect(saved.progression.dee.character).toBe(true);
    // After a restart the choices are still there.
    await withApp({ seed: 42, dir }, async (page) => {
      await page.locator(perch).click();
      await page.locator('[data-testid="dee-chat-settings"]').click();
      await expect(page.locator('[data-testid="dee-frequency-mistakes"]')).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator('[data-testid="dee-tone"] button[data-value="blunt"]')).toHaveAttribute('aria-checked', 'true');
    });
  });
});

/**
 * The board's deal-in (520 ms) can still be running when the hand settles: an all-in run-out is dealt in the
 * same render. A screenshot taken then shows the turn and river mid-air (mid-air-cards-probe.txt), so the beat
 * shots wait for every board card to land.
 */
async function boardAtRest(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-testid="board"] [data-testid="card"]')].every((c) => c.getAnimations().every((a) => a.playState !== 'running')),
  );
}

/** If a decision did open a gate or a verdict sheet (it should not: the policy plays the free action), clear it. */
async function settleSheets(page: Page): Promise<void> {
  if ((await page.getAttribute(tableScreen, 'data-gate')) === 'open') {
    for (let i = 0; i < 2; i++) {
      if ((await page.getAttribute(tableScreen, 'data-gate')) !== 'open') break;
      await page.locator(gateInput).fill('the price');
      await page.locator(gateSubmit).click();
    }
  }
  if (await page.locator(coachClose).isVisible()) await page.locator(coachClose).click();
}

interface Spot {
  hole: Card[];
  board: Card[];
  street: string;
  pot: number;
  toCall: number;
  opponents: number;
  canCall: boolean;
}

/** What the hero sees, read off the table in one evaluate. */
async function readSpot(page: Page): Promise<Spot> {
  const raw = await page.evaluate(() => {
    const cards = (s: string): string[] =>
      [...document.querySelectorAll<HTMLElement>(`${s} [data-testid="card"]`)].map((c) => c.dataset.card ?? '');
    const callText = document.querySelector('[data-testid="btn-call"]')?.textContent ?? '';
    const call = document.querySelector<HTMLButtonElement>('[data-testid="btn-call"]');
    const pot = Number((document.querySelector('[data-testid="pot"]')?.textContent ?? '').replace(/[^0-9]/g, ''));
    const opponents = [...document.querySelectorAll<HTMLElement>('[data-testid="seat"]')].filter(
      (s) => s.dataset.seatId !== '0' && s.dataset.folded !== 'true',
    ).length;
    return { hole: cards('[data-testid="hero-cards"]'), board: cards('[data-testid="board"]'), callText, canCall: call !== null, pot, opponents };
  });
  const m = /Call\s+(\d+)/.exec(raw.callText);
  const toCall = m ? Number(m[1]) : 0;
  const street = ['preflop', '', '', 'flop', 'turn', 'river'][raw.board.length] ?? 'river';
  return { hole: raw.hole as Card[], board: raw.board as Card[], street, pot: raw.pot, toCall, opponents: raw.opponents, canCall: raw.canCall };
}
