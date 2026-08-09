import type { Page } from '@playwright/test';
import { sel } from './helpers.js';

export const tableScreen = '[data-testid="table-screen"]';

/** Mirrors the table root's data-awaiting contract. */
export type Awaiting = 'hero' | 'ai' | 'handover';

/** Total chips in play: 4 seats x 5000. Nothing may create or destroy chips. */
export const CHIPS_IN_PLAY = 20_000;

/**
 * Block until the table is not mid-AI-think. Never sleep: the renderer publishes
 * data-awaiting on every render, so it is the only sync point we need.
 */
export async function waitForIdle(page: Page): Promise<Awaiting> {
  await page.waitForFunction(() => {
    const root = document.querySelector('[data-testid="table-screen"]');
    const awaiting = root instanceof HTMLElement ? root.dataset.awaiting : undefined;
    return awaiting === 'hero' || awaiting === 'handover';
  });
  const awaiting = await page.getAttribute(tableScreen, 'data-awaiting');
  if (awaiting !== 'hero' && awaiting !== 'handover') {
    throw new Error(`unexpected data-awaiting after idle wait: ${String(awaiting)}`);
  }
  return awaiting;
}

async function clickFirstEnabled(page: Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    const button = page.locator(selector);
    if (await button.isEnabled()) {
      await button.click();
      return selector;
    }
  }
  return null;
}

/**
 * Drive the hero passively (check, else call, else fold) until the hand settles.
 * Capped so a stuck betting engine fails loudly instead of hanging the runner.
 */
export async function playToShowdown(page: Page, maxActions = 40): Promise<string[]> {
  const taken: string[] = [];
  for (let i = 0; i < maxActions; i++) {
    if ((await waitForIdle(page)) === 'handover') return taken;
    const clicked = await clickFirstEnabled(page, [sel.btnCheck, sel.btnCall, sel.btnFold]);
    if (clicked === null) {
      throw new Error(`hero turn with no enabled action button (after ${taken.length} actions)`);
    }
    taken.push(clicked);
  }
  throw new Error(`hand did not settle within ${maxActions} hero actions: ${taken.join(',')}`);
}

export interface Snapshot {
  heroCards: string[];
  board: string[];
  villainCards: { seatId: number; cards: string[] }[];
  stacks: number[];
  pot: number;
  standing: number;
}

/** One evaluate call so every field describes the same render. */
export async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const cardsIn = (root: Element | null): string[] =>
      root === null
        ? []
        : [...root.querySelectorAll<HTMLElement>('[data-testid="card"]')].map(
            (c) => c.dataset.card ?? '',
          );

    const seats = [...document.querySelectorAll<HTMLElement>('[data-testid="seat"]')];
    const potText = document.querySelector('[data-testid="pot"]')?.textContent ?? '';

    return {
      heroCards: cardsIn(document.querySelector('[data-testid="hero-cards"]')),
      board: cardsIn(document.querySelector('[data-testid="board"]')),
      villainCards: seats
        .filter((s) => s.dataset.seatId !== '0')
        .map((s) => ({ seatId: Number(s.dataset.seatId), cards: cardsIn(s) })),
      stacks: seats.map((s) =>
        Number(s.querySelector('[data-testid="seat-stack"]')?.textContent ?? 'NaN'),
      ),
      pot: Number(potText.replace(/[^0-9-]/g, '')),
      standing: seats.filter((s) => s.dataset.folded !== 'true').length,
    };
  });
}

/** Seat stacks exclude committed chips (those already live in the pot), so stacks + pot is the total. */
export function chipTotal(snap: Snapshot): number {
  return snap.stacks.reduce((a, b) => a + b, 0) + snap.pot;
}
