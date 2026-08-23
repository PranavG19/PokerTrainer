/**
 * KEYBOARD FOCUS ACROSS A REPAINT.
 *
 * Every screen rebuilds its subtree with `replaceChildren(...)` on each state tick. That detaches the
 * node the keyboard is on, so the browser drops focus to `<body>` and a keyboard-only user is thrown
 * back to the top of the tab order after every interaction (a toggle, a forecast click, a "next hand").
 * `train.ts` avoids this by moving focus explicitly after its rebuild; this helper is the general form
 * of that move for the screens that repaint by wholesale replacement.
 *
 * It captures the identity of the focused control inside `container` before the repaint and restores
 * focus — and any text caret — to the equivalent rebuilt control afterwards. Controls are matched by
 * their stable `data-*` attributes (the `data-testid` every control already carries, plus whatever
 * disambiguators the screen sets, e.g. `data-mode`/`data-position`/`data-combo`). Those attributes
 * survive the rebuild because the screen sets them identically each paint, so the new node that stands
 * in for the old one is found by the same selector.
 *
 * If nothing inside `container` was focused, or the focused control carries no `data-*` identity to
 * match on (so it cannot be re-found unambiguously), restoration is skipped and focus is left wherever
 * the browser put it — never guessed at.
 */

interface FocusToken {
  readonly selector: string;
  /** Caret start for text inputs/textareas; null for non-text controls. */
  readonly selectionStart: number | null;
  readonly selectionEnd: number | null;
}

function isTextEntry(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

/** Build a `tag[data-x="v"]...` selector from the element's data-* attributes; null if it has none. */
function selectorFor(el: Element): string | null {
  const parts: string[] = [];
  for (const attr of Array.from(el.attributes)) {
    if (!attr.name.startsWith('data-')) continue;
    // JSON.stringify yields a safely double-quoted, escaped string literal — valid inside an attribute
    // selector for the plain identifier-shaped values these data attributes hold.
    parts.push(`[${attr.name}=${JSON.stringify(attr.value)}]`);
  }
  if (parts.length === 0) return null;
  return `${el.tagName.toLowerCase()}${parts.join('')}`;
}

function captureFocus(container: HTMLElement): FocusToken | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  if (active === container || !container.contains(active)) return null;

  const selector = selectorFor(active);
  if (selector === null) return null;

  const selectionStart = isTextEntry(active) ? active.selectionStart : null;
  const selectionEnd = isTextEntry(active) ? active.selectionEnd : null;
  return { selector, selectionStart, selectionEnd };
}

function restoreFocus(container: HTMLElement, token: FocusToken | null): void {
  if (token === null) return;
  const next = container.querySelector<HTMLElement>(token.selector);
  if (next === null) return;
  next.focus();
  // Only touch the caret when we actually captured one AND the rebuilt control still accepts it, so a
  // control that changed shape across the repaint is left with its own default selection.
  if (token.selectionStart !== null && isTextEntry(next)) {
    try {
      next.setSelectionRange(token.selectionStart, token.selectionEnd ?? token.selectionStart);
    } catch {
      // Some input types (e.g. number) reject setSelectionRange; focus alone is the win, ignore.
    }
  }
}

/**
 * Run `repaint` (typically a `replaceChildren`) with the keyboard focus inside `container` preserved
 * across it. Capture happens before, restore after; both are no-ops when there was nothing to keep.
 */
export function withRestoredFocus(container: HTMLElement, repaint: () => void): void {
  const token = captureFocus(container);
  repaint();
  restoreFocus(container, token);
}

/**
 * The two-step form for a repaint function with early returns (where wrapping the whole body in a
 * callback would be awkward): capture now, and call the returned thunk after the rebuild — ideally in
 * a `finally` so an early return still restores.
 */
export function beginFocusRestore(container: HTMLElement): () => void {
  const token = captureFocus(container);
  return () => restoreFocus(container, token);
}
