// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { withRestoredFocus, beginFocusRestore } from '../../src/renderer/focusRestore.js';

/**
 * REAL ORACLE: the failure the helper exists to prevent is `document.activeElement` collapsing to
 * `<body>` after a subtree is rebuilt with replaceChildren. Every assertion here reads the real
 * activeElement after a real rebuild, so the test fails against the pre-fix behaviour (focus lost) and
 * passes only when the equivalent rebuilt control is re-focused.
 */

function button(testid: string, extra: Record<string, string> = {}): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.testid = testid;
  for (const [k, v] of Object.entries(extra)) b.dataset[k] = v;
  return b;
}

describe('withRestoredFocus', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('restores focus to the equivalent control after a full rebuild', () => {
    const before = button('next-hand');
    container.replaceChildren(before);
    before.focus();
    expect(document.activeElement).toBe(before);

    withRestoredFocus(container, () => {
      // A fresh node with the same identity stands in for the old one — exactly what a repaint does.
      container.replaceChildren(button('coach-mode-toggle'), button('next-hand'));
    });

    const after = container.querySelector<HTMLElement>('[data-testid="next-hand"]');
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(document.activeElement).toBe(after);
  });

  it('reproduces the dropped-focus bug when NOT wrapped (guards the oracle)', () => {
    const before = button('next-hand');
    container.replaceChildren(before);
    before.focus();
    // A bare rebuild, the pre-fix behaviour: focus falls back to <body>.
    container.replaceChildren(button('next-hand'));
    expect(document.activeElement).toBe(document.body);
  });

  it('disambiguates same-testid controls by their other data-* attributes', () => {
    const co = button('position-btn', { position: 'CO' });
    const utg = button('position-btn', { position: 'UTG' });
    container.replaceChildren(co, utg);
    utg.focus();

    withRestoredFocus(container, () => {
      container.replaceChildren(
        button('position-btn', { position: 'CO' }),
        button('position-btn', { position: 'UTG' }),
      );
    });

    const after = document.activeElement as HTMLElement;
    expect(after.dataset.testid).toBe('position-btn');
    expect(after.dataset.position).toBe('UTG');
  });

  it('preserves the text caret of an input across a rebuild', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.dataset.testid = 'delete-confirm-input';
    input.value = 'delete';
    container.replaceChildren(input);
    input.focus();
    input.setSelectionRange(2, 4);

    withRestoredFocus(container, () => {
      const fresh = document.createElement('input');
      fresh.type = 'text';
      fresh.dataset.testid = 'delete-confirm-input';
      fresh.value = 'delete';
      container.replaceChildren(fresh);
    });

    const after = document.activeElement as HTMLInputElement;
    expect(after.dataset.testid).toBe('delete-confirm-input');
    expect(after.selectionStart).toBe(2);
    expect(after.selectionEnd).toBe(4);
  });

  it('does nothing when focus was outside the container', () => {
    const outside = button('tab-play');
    document.body.appendChild(outside);
    container.replaceChildren(button('next-hand'));
    outside.focus();

    withRestoredFocus(container, () => {
      container.replaceChildren(button('next-hand'));
    });

    expect(document.activeElement).toBe(outside);
  });

  it('leaves focus alone when the acted control has no rebuilt equivalent', () => {
    const before = button('gone');
    container.replaceChildren(before);
    before.focus();

    withRestoredFocus(container, () => {
      container.replaceChildren(button('something-else'));
    });

    // No match for [data-testid="gone"] → focus is not guessed at; the browser's fallback stands.
    expect(document.activeElement).toBe(document.body);
  });

  it('beginFocusRestore restores through an early return', () => {
    const before = button('btn-fold');
    container.replaceChildren(before);
    before.focus();

    function repaintWithEarlyReturn(): void {
      const restore = beginFocusRestore(container);
      try {
        container.replaceChildren(button('btn-fold'), button('btn-call'));
        return; // mimic renderControls' early returns
      } finally {
        restore();
      }
    }
    repaintWithEarlyReturn();

    expect((document.activeElement as HTMLElement).dataset.testid).toBe('btn-fold');
  });
});
