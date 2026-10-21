// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderTable, BB } from '../../src/renderer/screens/table.js';

/**
 * A challenge table is one hand (main.ts openChallenge: handLimit 1). Losing it all-in must end the sitting,
 * not offer a rebuy that deals a second hand that is no longer the shared spot.
 */

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

/** One hand at one big blind a seat: the blinds are all-in, so the hand runs itself out. */
function playOut(seed: number, handLimit?: number): HTMLElement {
  vi.useFakeTimers();
  const t = renderTable({ seed, bankroll: 10_000, handNumber: 1, startStack: BB, button: 2, handLimit, onHandComplete: () => undefined });
  document.body.appendChild(t.root);
  for (let i = 0; i < 200 && t.root.querySelector('[data-testid="session-over"], [data-testid="session-planned-complete"], [data-testid="next-hand"], [data-testid="table-swept"]') === null; i++) {
    vi.advanceTimersByTime(500);
  }
  return t.root;
}

describe('a one-hand table the hero busts at', () => {
  it('ends the sitting instead of offering a rebuy', { timeout: 120_000 }, () => {
    let busted: HTMLElement | null = null;
    for (let seed = 1; seed < 200 && busted === null; seed++) {
      const unbounded = playOut(seed);
      if (unbounded.querySelector('[data-testid="btn-rebuy"]') !== null) busted = playOut(seed, 1);
      document.body.replaceChildren();
      vi.useRealTimers();
      if (busted) document.body.appendChild(busted);
    }
    expect(busted, 'a seed where the hero busts').not.toBeNull();
    expect(busted!.querySelector('[data-testid="btn-rebuy"]')).toBeNull();
    expect(busted!.querySelector('[data-testid="session-planned-complete"]')).not.toBeNull();
  });
});
