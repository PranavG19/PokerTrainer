import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, sel } from './helpers.js';
import { tableScreen, waitForIdle } from './flow.js';

/**
 * GATE — state 4 of the five-state protocol (PRODUCT-SPEC G5a), on the live table.
 *
 * When the hero commits a COACHED action whose coach severity is T2+ (notable/serious), the verdict is
 * WITHHELD and the learner must name the mechanism in one line before the reveal (up to two attempts,
 * one 8s budget). The gate ALWAYS reveals — on a passing attempt, on exhausting both, or on expiry —
 * and it never changes the verdict or the severity. It fires on the SOLVER's severity, not on the
 * reason grader, so gating carries no honesty debt; the reason grader only decides whether the first
 * attempt resolves early or buys the second prompt.
 *
 * Pinned seeds (shared with coach.spec.ts / predict.spec.ts, found by replaying the real decision path):
 *   seed 8, hand 1  — QsQh: call preflop is FREE; folding for 99 into a 348 pot is SERIOUS (3.9bb).
 *   seed 1, hand 1  — 8dAd: call preflop free; folding the flop is NOTABLE (1.1bb) — proves T2, not T3-only.
 *   seed 42, hand 1 — call preflop is FREE (0.2bb) — the negative control: it must NOT gate.
 *
 * Sync oracle: the never-replaced table-screen root publishes data-gate ('open'|'closed'). The shared
 * waitForIdle is BLIND during a gate (data-awaiting stays 'hero' while applyAction is deferred), so the
 * gate scenarios wait on data-gate instead.
 */

const modeToggle = '[data-testid="coach-mode-toggle"]';
// The coach panel has no testid; it is the .coach root that carries data-gate / data-severity.
const coachPanel = '.coach';
const coachMsg = '[data-testid="coach-message"]';
const gateBox = '[data-testid="coach-gate"]';
const gatePrompt = '[data-testid="gate-prompt"]';
const gateInput = '[data-testid="gate-input"]';
const gateSubmit = '[data-testid="gate-submit"]';
const gateCount = '[data-testid="gate-count"]';
const gateBudget = '[data-testid="gate-budget"]';
const gateBarFill = '.coach-gate-bar-fill';
const predictResult = '[data-testid="predict-result"]';

/** Local — tests/e2e/helpers.ts and flow.ts are shared and off limits. */
function freshUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-gate-'));
}

async function openTable(page: Page): Promise<void> {
  await page.locator(sel.newHand).click();
  await page.locator(tableScreen).waitFor();
}

async function enableCoachedMode(page: Page): Promise<void> {
  await page.locator(modeToggle).click();
  await expect(page.locator(modeToggle)).toHaveAttribute('data-on', 'true');
}

async function commit(page: Page, action: string, confidence: 'sure' | 'guess'): Promise<void> {
  await page.locator(`[data-testid="predict-${action}"]`).click();
  await page.locator(`[data-testid="confidence-${confidence}"]`).click();
}

/** Commit + play a hero action. Returns once the click is issued (the gate, if any, is now open). */
async function coachedAct(page: Page, action: string, confidence: 'sure' | 'guess', btn: string): Promise<void> {
  await commit(page, action, confidence);
  await page.locator(btn).click();
}

/** Wait until the table root reports an open gate. */
async function waitForGate(page: Page): Promise<void> {
  await expect(page.locator(tableScreen)).toHaveAttribute('data-gate', 'open');
}

function readSaved(userDataDir: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(userDataDir, 'offsuit-state.json'), 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

async function withApp(
  opts: { seed: number; userDataDir?: string },
  body: (page: Page) => Promise<void>,
): Promise<void> {
  const launched = await launchApp({ seed: opts.seed, userDataDir: opts.userDataDir ?? freshUserDataDir() });
  try {
    await body(launched.page);
  } finally {
    await launched.close();
  }
}

/** Drive seed 8, hand 1 to the point where the SERIOUS fold has just been committed and the gate is up. */
async function reachSeed8Gate(page: Page): Promise<void> {
  await openTable(page);
  expect(await waitForIdle(page)).toBe('hero');
  await enableCoachedMode(page);
  // Call the preflop spot: free, so no gate — the verdict (silence) reveals immediately.
  await coachedAct(page, 'call', 'sure', sel.btnCall);
  expect(await waitForIdle(page)).toBe('hero');
  // Fold the huge favourite: SERIOUS, so the gate opens and withholds the verdict.
  await coachedAct(page, 'fold', 'sure', sel.btnFold);
  await waitForGate(page);
}

test.describe('GATE (state 4) — pre-reveal self-explanation', () => {
  test('1. a T2+ mistake FIRES the gate and withholds the verdict', async () => {
    await withApp({ seed: 8 }, async (page) => {
      await reachSeed8Gate(page);

      // The gate box is up with its prompt; attempt counter at the first of two.
      await expect(page.locator(gateBox)).toBeVisible();
      await expect(page.locator(gatePrompt)).not.toHaveText('');
      const prompt = (await page.locator(gatePrompt).textContent()) ?? '';
      expect(prompt.trim().split(/\s+/).length, 'the prompt is one short line').toBeLessThanOrEqual(12);
      await expect(page.locator(gateCount)).toContainText('1 of 2');

      // The tier is NOT leaked before retrieval, and the verdict line is still empty.
      await expect(page.locator(tableScreen)).toHaveAttribute('data-gate', 'open');
      await expect(page.locator(coachPanel)).toHaveAttribute('data-gate-attempts', '0');
      await expect(page.locator(coachPanel)).toHaveAttribute('data-severity', 'none');
      await expect(page.locator(coachMsg)).toHaveText('');

      // The action is NOT applied while the gate is open: still the hero's turn, pot unchanged.
      await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'hero');
      for (const btn of [sel.btnFold, sel.btnCall, sel.btnCheck]) {
        await expect(page.locator(btn)).toBeDisabled();
      }
    });
  });

  test('2. a passing (range/price) reason RESOLVES the gate and reveals the verdict', async () => {
    const dir = freshUserDataDir();
    await withApp({ seed: 8, userDataDir: dir }, async (page) => {
      await reachSeed8Gate(page);

      await page.locator(gateInput).fill('villain only continues a stronger range here');
      await page.locator(gateSubmit).click();

      // Gate closes, the withheld SERIOUS verdict is now revealed unchanged.
      await expect(page.locator(tableScreen)).toHaveAttribute('data-gate', 'closed');
      await expect(page.locator(gateBox)).toBeHidden();
      await expect(page.locator(coachPanel)).toHaveAttribute('data-severity', 'serious');
      await expect(page.locator(coachMsg)).toContainText(/equity|pot|odds|bb/i);
      // A range/price answer resolves on the first attempt.
      await expect(page.locator(coachPanel)).toHaveAttribute('data-gate-attempts', '1');
      // The deferred action ran: the fold advanced the hand.
      await expect(page.locator(predictResult)).toBeVisible();
      expect(await waitForIdle(page)).not.toBe('hero');
    });

    // The fold decision persisted with gateAttempts === 1 alongside its serious verdict.
    const saved = readSaved(dir);
    const hands = (saved.hands ?? []) as Array<{ decisions?: Array<Record<string, unknown>> }>;
    const decisions = hands.flatMap((h) => h.decisions ?? []);
    const gated = decisions.filter((d) => typeof d.gateAttempts === 'number');
    expect(gated.length, 'at least one decision recorded a gate').toBeGreaterThanOrEqual(1);
    const fold = gated.find((d) => d.action === 'fold');
    expect(fold?.gateAttempts).toBe(1);
    // The free preflop call in the same hand never gated — the field is absent, not 0.
    const call = decisions.find((d) => d.action === 'call');
    expect(call && 'gateAttempts' in call).toBe(false);
  });

  test('3. two misses EXHAUST the gate and reveal anyway (never fails the spot)', async () => {
    const dir = freshUserDataDir();
    await withApp({ seed: 8, userDataDir: dir }, async (page) => {
      await reachSeed8Gate(page);

      // Attempt 1: a bare hand-strength claim is a miss — the gate stays open for the last attempt.
      await page.locator(gateInput).fill('my hand is too weak');
      await page.locator(gateSubmit).click();
      await expect(page.locator(tableScreen)).toHaveAttribute('data-gate', 'open');
      await expect(page.locator(coachPanel)).toHaveAttribute('data-gate-attempts', '1');
      await expect(page.locator(gateCount)).toContainText('2 of 2');
      await expect(page.locator(coachMsg)).toHaveText(''); // still withheld

      // Attempt 2: another miss — but exhaustion reveals regardless (spec: expiry/exhaustion advances).
      await page.locator(gateInput).fill('idk');
      await page.locator(gateSubmit).click();
      await expect(page.locator(tableScreen)).toHaveAttribute('data-gate', 'closed');
      await expect(page.locator(coachPanel)).toHaveAttribute('data-severity', 'serious');
      await expect(page.locator(coachPanel)).toHaveAttribute('data-gate-attempts', '2');
    });

    const saved = readSaved(dir);
    const hands = (saved.hands ?? []) as Array<{ decisions?: Array<Record<string, unknown>> }>;
    const fold = hands.flatMap((h) => h.decisions ?? []).find((d) => d.action === 'fold');
    expect(fold?.gateAttempts).toBe(2);
  });

  test('3b. the 8s budget expiring with no answer reveals the verdict, logged as 0 attempts', async () => {
    // A controlled fake clock cannot be used here: reaching the gate requires the villain AI's
    // setTimeout(AI_DELAY_MS) to fire, and freezing the clock before the gate would also freeze those,
    // hanging waitForIdle. So this is the one test that waits real time — the 8s budget is genuinely
    // short — with an expect timeout comfortably past it. No submission is made: expiry must reveal.
    test.slow();
    const dir = freshUserDataDir();
    await withApp({ seed: 8, userDataDir: dir }, async (page) => {
      await reachSeed8Gate(page);

      // Do not submit; let the 8s budget elapse. The gate auto-resolves to the reveal.
      await expect(page.locator(tableScreen)).toHaveAttribute('data-gate', 'closed', { timeout: 15000 });
      await expect(page.locator(coachPanel)).toHaveAttribute('data-severity', 'serious');
      // "I don't know" is a commitment: expiry with no submission reveals and logs 0.
      await expect(page.locator(coachPanel)).toHaveAttribute('data-gate-attempts', '0');
    });

    const saved = readSaved(dir);
    const hands = (saved.hands ?? []) as Array<{ decisions?: Array<Record<string, unknown>> }>;
    const fold = hands.flatMap((h) => h.decisions ?? []).find((d) => d.action === 'fold');
    expect(fold?.gateAttempts).toBe(0);
  });

  test('4. the trigger is severity>=T2: a free decision does NOT gate; a NOTABLE one does', async () => {
    // Negative control: seed 42, hand 1 — calling preflop is free (0.2bb), so the gate never mounts.
    await withApp({ seed: 42 }, async (page) => {
      await openTable(page);
      expect(await waitForIdle(page)).toBe('hero');
      await enableCoachedMode(page);
      await coachedAct(page, 'call', 'guess', sel.btnCall);
      // The free call never gates: the gate stays closed and its box never mounts. (The action is
      // applied normally — whether the hand next lands on hero again on a later street is irrelevant;
      // what matters is that no gate ever intercepted this free decision.)
      await expect(page.locator(tableScreen)).toHaveAttribute('data-gate', 'closed');
      await expect(page.locator(gateBox)).toBeHidden();
    });

    // Positive boundary: seed 42, hand 1 — call preflop + check flop are free, then checking the turn
    // with 95% equity misses value for NOTABLE (0.6bb, T2). This is the exact spot coach.spec.ts pins
    // as 'notable', so it proves the gate fires at T2 and not only on serious/T3.
    await withApp({ seed: 42 }, async (page) => {
      await openTable(page);
      expect(await waitForIdle(page)).toBe('hero');
      await enableCoachedMode(page);
      // Preflop call and flop check are both free — no gate.
      await coachedAct(page, 'call', 'sure', sel.btnCall);
      expect(await waitForIdle(page)).toBe('hero');
      await coachedAct(page, 'check', 'sure', sel.btnCheck);
      expect(await waitForIdle(page)).toBe('hero');
      // Turn check is the NOTABLE miss: the gate fires and withholds the verdict.
      await coachedAct(page, 'check', 'sure', sel.btnCheck);
      await waitForGate(page);
      await expect(page.locator(coachPanel)).toHaveAttribute('data-severity', 'none'); // withheld
      await page.locator(gateInput).fill("the pot odds don't justify it");
      await page.locator(gateSubmit).click();
      // Revealed at notable (T2) — the gate fired at T2 and did not escalate it.
      await expect(page.locator(coachPanel)).toHaveAttribute('data-severity', 'notable');
    });
  });

  test('5. reduced motion still FIRES and LOGS the gate — animation off, behaviour intact', async () => {
    // With motion, the gate box and budget bar carry their animations.
    await withApp({ seed: 8 }, async (page) => {
      await reachSeed8Gate(page);
      const animated = await page.locator(gateBudget).locator(gateBarFill).evaluate(
        (el) => getComputedStyle(el).animationName,
      );
      expect(animated).not.toBe('none');
    });

    // Under reduced motion, the same gate fires and logs; only the animation is gone.
    const dir = freshUserDataDir();
    const launched = await launchApp({ seed: 8, userDataDir: dir });
    try {
      const page = launched.page;
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await reachSeed8Gate(page);
      const boxAnim = await page.locator(gateBox).evaluate((el) => getComputedStyle(el).animationName);
      const barAnim = await page
        .locator(gateBudget)
        .locator(gateBarFill)
        .evaluate((el) => getComputedStyle(el).animationName);
      expect(boxAnim, 'gate box animation off under reduced motion').toBe('none');
      expect(barAnim, 'budget bar animation off under reduced motion').toBe('none');
      // Critically, the gate STILL fires and a passing answer still resolves + reveals + logs.
      await page.locator(gateInput).fill('villain only continues a stronger range here');
      await page.locator(gateSubmit).click();
      await expect(page.locator(tableScreen)).toHaveAttribute('data-gate', 'closed');
      await expect(page.locator(coachPanel)).toHaveAttribute('data-gate-attempts', '1');
      await expect(page.locator(coachPanel)).toHaveAttribute('data-severity', 'serious');
    } finally {
      await launched.close();
    }
  });
});
