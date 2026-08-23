// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeEquity,
  parseCards,
  validateInput,
  renderEquityCalculator,
} from '../../src/renderer/screens/equityCalculator.js';
import { equityVsRandom } from '../../src/core/equity.js';
import { VILLAIN_BETTING_RANGE } from '../../src/core/preflop.js';

/**
 * REAL ORACLES, not self-comparison: the two headline cases are the ones the backlog names, computed by
 * the SAME verified engine the live table grades on (exactEquityHeadsUp), so a broken router or a
 * reimplemented evaluator would move these off their known values.
 */
describe('computeEquity — known equities from the engine', () => {
  it('AA vs KK preflop is ~0.82 (exact heads-up enumeration)', () => {
    const r = computeEquity({
      hero: ['As', 'Ah'],
      board: [],
      villain: { kind: 'hand', cards: ['Ks', 'Kd'] },
    });
    expect(r.exact).toBe(true);
    expect(r.equity).toBeGreaterThanOrEqual(0.78);
    expect(r.equity).toBeLessThanOrEqual(0.84);
  });

  it('AKs vs 22 preflop is the classic coinflip, ~0.50', () => {
    const r = computeEquity({
      hero: ['As', 'Ks'],
      board: [],
      villain: { kind: 'hand', cards: ['2c', '2d'] },
    });
    expect(r.exact).toBe(true);
    expect(r.equity).toBeGreaterThanOrEqual(0.45);
    expect(r.equity).toBeLessThanOrEqual(0.55);
  });

  it('a dominating overpair on a blank river is exactly 1.0', () => {
    // A board that pairs nothing and never gives KK a set: AA is simply the better pair, wins every time.
    const r = computeEquity({
      hero: ['As', 'Ah'],
      board: ['2s', '7d', 'Th', '4c', '9d'],
      villain: { kind: 'hand', cards: ['Ks', 'Kc'] },
    });
    expect(r.exact).toBe(true);
    expect(r.equity).toBe(1);
  });

  it('vs a range routes through equityVsRange: win+tie+lose sums to 1 and it is not exact', () => {
    const r = computeEquity({
      hero: ['9c', '9d'],
      board: ['Ah', 'Kd', '7s'],
      villain: { kind: 'range', combos: VILLAIN_BETTING_RANGE },
      iterations: 2000,
      seed: 1,
    });
    expect(r.exact).toBe(false);
    expect(r.win! + r.tie! + r.lose!).toBeCloseTo(1, 5);
    expect(r.equity).toBeCloseTo(r.win! + r.tie! * 0.5, 10);
  });

  it('vs "any two" reuses equityVsRandom exactly (same seed, same numbers)', () => {
    const hero = ['Ac', 'Kd'];
    const board = ['2c', '7d', 'Ts'];
    const mine = computeEquity({
      hero,
      board,
      villain: { kind: 'random' },
      iterations: 2000,
      seed: 5,
    });
    const engine = equityVsRandom(hero, board, 1, 2000, 5);
    expect(mine.win).toBe(engine.win);
    expect(mine.tie).toBe(engine.tie);
    expect(mine.lose).toBe(engine.lose);
  });
});

describe('parseCards', () => {
  it('reads whitespace- and comma-separated cards, normalising case', () => {
    expect(parseCards('As Kh')).toEqual(['As', 'Kh']);
    expect(parseCards('as,kh')).toEqual(['As', 'Kh']);
    expect(parseCards('Th 9d  8c')).toEqual(['Th', '9d', '8c']);
  });

  it('returns empty for blank input', () => {
    expect(parseCards('')).toEqual([]);
    expect(parseCards('   ')).toEqual([]);
  });

  it('rejects a token that is not a real card', () => {
    expect(() => parseCards('As Xz')).toThrow();
    expect(() => parseCards('A')).toThrow();
  });
});

describe('validateInput', () => {
  it('accepts a legal spot', () => {
    expect(
      validateInput({
        hero: ['As', 'Ah'],
        board: ['Kd', 'Qc', '7h'],
        villain: { kind: 'hand', cards: ['Ks', 'Kc'] },
      }),
    ).toBeNull();
  });

  it('requires exactly two hero cards', () => {
    expect(validateInput({ hero: ['As'], board: [], villain: { kind: 'random' } })).not.toBeNull();
  });

  it('rejects a board that is not 0, 3, 4 or 5 cards', () => {
    expect(
      validateInput({ hero: ['As', 'Ah'], board: ['Kd', 'Qc'], villain: { kind: 'random' } }),
    ).not.toBeNull();
  });

  it('rejects a card used twice across hero, board and villain', () => {
    expect(
      validateInput({
        hero: ['As', 'Ah'],
        board: ['As', 'Qc', '7h'],
        villain: { kind: 'random' },
      }),
    ).not.toBeNull();
  });

  it('requires exactly two villain cards in hand mode', () => {
    expect(
      validateInput({ hero: ['As', 'Ah'], board: [], villain: { kind: 'hand', cards: ['Ks'] } }),
    ).not.toBeNull();
  });
});

describe('renderEquityCalculator — UI wiring', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  function typeInto(root: HTMLElement, testid: string, value: string): void {
    const input = root.querySelector<HTMLInputElement>(`[data-testid="${testid}"]`);
    if (!input) throw new Error(`missing input ${testid}`);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function click(root: HTMLElement, testid: string): void {
    const el = root.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
    if (!el) throw new Error(`missing element ${testid}`);
    el.click();
  }

  it('renders a keyboard-reachable screen with labelled text inputs and a calculate button', () => {
    const root = renderEquityCalculator();
    document.body.appendChild(root);
    expect(root.dataset.testid).toBe('equity-screen');
    // Native focusable controls => keyboard accessible without extra tabindex wiring.
    expect(root.querySelector('[data-testid="equity-hero-input"]')?.tagName).toBe('INPUT');
    expect(root.querySelector('[data-testid="equity-board-input"]')?.tagName).toBe('INPUT');
    const calc = root.querySelector<HTMLButtonElement>('[data-testid="equity-calculate"]');
    expect(calc?.tagName).toBe('BUTTON');
  });

  it('computes and displays a headline equity when the user fills the fields and calculates', () => {
    const root = renderEquityCalculator();
    document.body.appendChild(root);
    // Hero AA dominates KK on a blank locked river: instant exact enumeration (need=0), equity 100%.
    typeInto(root, 'equity-hero-input', 'As Ah');
    typeInto(root, 'equity-board-input', '2s 7d Th 4c 9d');
    click(root, 'equity-mode-hand');
    typeInto(root, 'equity-villain-input', 'Ks Kc');
    click(root, 'equity-calculate');

    const value = root.querySelector<HTMLElement>('[data-testid="equity-value"]');
    expect(value?.textContent).toContain('100%');
  });

  it('surfaces a validation error instead of throwing on bad input', () => {
    const root = renderEquityCalculator();
    document.body.appendChild(root);
    typeInto(root, 'equity-hero-input', 'As'); // only one hero card
    click(root, 'equity-calculate');
    const error = root.querySelector<HTMLElement>('[data-testid="equity-error"]');
    expect((error?.textContent ?? '').length).toBeGreaterThan(0);
  });
});
