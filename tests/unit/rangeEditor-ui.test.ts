// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderRangeEditor } from '../../src/renderer/screens/rangeEditor.js';
import type { SavedRange } from '../../src/core/rangeEditor.js';

/**
 * REAL ORACLE: the screen wires the tested range model to the DOM. These jsdom tests drive real clicks
 * and keypresses and assert the persistence callbacks fire with the right range, that a saved range
 * loads back onto the grid, and that the drill grades against the painted range through scoreDrill.
 */

function cell(root: HTMLElement, combo: string): HTMLButtonElement {
  const el = root.querySelector<HTMLButtonElement>(`[data-testid="range-editor-cell"][data-combo="${combo}"]`);
  if (!el) throw new Error(`cell ${combo} missing`);
  return el;
}

function byId(root: HTMLElement, testid: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  if (!el) throw new Error(`element ${testid} missing`);
  return el;
}

function press(key: string, init: KeyboardEventInit = {}): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

describe('range editor — painting and saving', () => {
  let saved: SavedRange[];
  let deleted: string[];
  let root: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    saved = [];
    deleted = [];
    root = renderRangeEditor({
      onSave: (r) => saved.push(r),
      onDelete: (n) => deleted.push(n),
    });
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    press('x'); // let the self-removing keydown listener unregister
  });

  it('starts in edit mode with an empty grid', () => {
    expect(root.dataset.mode).toBe('edit');
    expect(root.dataset.count).toBe('0');
  });

  it('clicking a cell paints it and updates the count', () => {
    cell(root, 'AA').click();
    expect(cell(root, 'AA').dataset.selected).toBe('true');
    expect(cell(root, 'AA').getAttribute('aria-pressed')).toBe('true');
    expect(root.dataset.count).toBe('1');
  });

  it('clicking a painted cell clears it', () => {
    cell(root, 'AA').click();
    cell(root, 'AA').click();
    expect(cell(root, 'AA').dataset.selected).toBe('false');
    expect(root.dataset.count).toBe('0');
  });

  it('refuses to save without a name', () => {
    cell(root, 'AA').click();
    byId(root, 'range-editor-save').click();
    expect(byId(root, 'range-editor-error').textContent).toMatch(/name/i);
    expect(saved).toHaveLength(0);
  });

  it('refuses to save an empty range', () => {
    (byId(root, 'range-editor-name') as HTMLInputElement).value = 'empty';
    byId(root, 'range-editor-save').click();
    expect(byId(root, 'range-editor-error').textContent).toMatch(/at least one/i);
    expect(saved).toHaveLength(0);
  });

  it('saves the painted range in canonical order via onSave', () => {
    cell(root, '72o').click();
    cell(root, 'AA').click();
    cell(root, 'KQs').click();
    (byId(root, 'range-editor-name') as HTMLInputElement).value = '  BTN open  ';
    byId(root, 'range-editor-save').click();
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('BTN open'); // trimmed
    expect(saved[0].combos).toEqual(['AA', 'KQs', '72o']); // canonical order, not click order
    // Appears in the on-screen library.
    expect(byId(root, 'range-editor-saved-row').dataset.name).toBe('BTN open');
    expect(root.dataset.saved).toBe('1');
  });
});

describe('range editor — load and delete', () => {
  let root: HTMLElement;
  let deleted: string[];

  beforeEach(() => {
    document.body.replaceChildren();
    deleted = [];
    root = renderRangeEditor({
      ranges: [{ name: 'UTG', combos: ['AA', 'KK', 'AKs'] }],
      onDelete: (n) => deleted.push(n),
    });
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    press('x');
  });

  it('lists a preloaded saved range', () => {
    expect(byId(root, 'range-editor-saved-row').dataset.name).toBe('UTG');
    expect(root.dataset.saved).toBe('1');
  });

  it('loading a saved range paints its combos onto the grid', () => {
    byId(root, 'range-editor-load').click();
    expect(cell(root, 'AA').dataset.selected).toBe('true');
    expect(cell(root, 'KK').dataset.selected).toBe('true');
    expect(cell(root, 'AKs').dataset.selected).toBe('true');
    expect(cell(root, '72o').dataset.selected).toBe('false');
    expect(root.dataset.count).toBe('3');
    expect((byId(root, 'range-editor-name') as HTMLInputElement).value).toBe('UTG');
  });

  it('deleting a saved range fires onDelete and removes the row', () => {
    byId(root, 'range-editor-delete').click();
    expect(deleted).toEqual(['UTG']);
    expect(root.dataset.saved).toBe('0');
    expect(byId(root, 'range-editor-saved-empty')).toBeTruthy();
  });
});

describe('range editor — drill', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    // A one-combo range makes the correct answer deterministic per shown hand.
    root = renderRangeEditor({ ranges: [{ name: 'aces', combos: ['AA'] }], seed: 3 });
    document.body.appendChild(root);
    byId(root, 'range-editor-load').click(); // load 'aces' onto the grid
  });

  afterEach(() => {
    root.remove();
    press('x');
  });

  it('will not start a drill on an empty grid', () => {
    byId(root, 'range-editor-clear').click();
    byId(root, 'range-editor-start-drill').click();
    expect(root.dataset.mode).toBe('edit');
    expect(byId(root, 'range-editor-error').textContent).toMatch(/paint or load/i);
  });

  it('enters drill mode and shows a hand', () => {
    byId(root, 'range-editor-start-drill').click();
    expect(root.dataset.mode).toBe('drill');
    expect(root.dataset.drillCombo).toBeTruthy();
    expect(byId(root, 'range-editor-drill-hand')).toBeTruthy();
  });

  it('grades an answer against the painted range and tallies it', () => {
    byId(root, 'range-editor-start-drill').click();
    const shown = root.dataset.drillCombo as string;
    const inRange = shown === 'AA';
    // Answer correctly for whatever hand is shown.
    byId(root, inRange ? 'range-editor-in' : 'range-editor-out').click();
    const score = byId(root, 'range-editor-drill-score');
    expect(score.dataset.attempts).toBe('1');
    expect(score.dataset.correct).toBe('1');
    expect(root.dataset.drillVerdict).toBe('right');
  });

  it('records a wrong answer as wrong', () => {
    byId(root, 'range-editor-start-drill').click();
    const shown = root.dataset.drillCombo as string;
    const inRange = shown === 'AA';
    byId(root, inRange ? 'range-editor-out' : 'range-editor-in').click(); // deliberately wrong
    expect(byId(root, 'range-editor-drill-score').dataset.correct).toBe('0');
    expect(root.dataset.drillVerdict).toBe('wrong');
  });

  it('answers via the I / O keys during a drill', () => {
    byId(root, 'range-editor-start-drill').click();
    press('i');
    press('o');
    expect(byId(root, 'range-editor-drill-score').dataset.attempts).toBe('2');
  });

  it('ignores I / O keypresses when not drilling', () => {
    press('i');
    press('o');
    expect(root.dataset.mode).toBe('edit');
    expect(root.querySelector('[data-testid="range-editor-drill-score"]')).toBeNull();
  });

  it('ignores a modifier-held drill keypress', () => {
    byId(root, 'range-editor-start-drill').click();
    press('i', { metaKey: true });
    press('o', { ctrlKey: true });
    expect(byId(root, 'range-editor-drill-score').dataset.attempts).toBe('0');
  });

  it('stops the drill and returns to edit mode', () => {
    byId(root, 'range-editor-start-drill').click();
    byId(root, 'range-editor-stop-drill').click();
    expect(root.dataset.mode).toBe('edit');
    expect(byId(root, 'range-editor-start-drill')).toBeTruthy();
  });
});
