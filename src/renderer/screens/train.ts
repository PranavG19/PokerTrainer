import '../styles-train.css';

/**
 * THE TRAIN HUB — one screen with a persistent left rail that folds six former tabs (Spots, Math,
 * Speed, Stress, Leaks, Upkeep) into a single nav entry. The tab bar had grown to 13 entries and
 * overran the 900px minimum's width budget; this collapses the six practice/maintenance surfaces
 * behind one "Train" tab (see the IA design of record, memory offsuit-train-hub-ia).
 *
 * WHY A DUMB SHELL. The hub owns layout and which mode is active; it does NOT own the six screens'
 * props. Each mode carries its own `render` thunk, built by main.ts with the exact props it already
 * threads to the old per-tab branches — so the six screen modules change by ZERO lines and their
 * tests keep passing against the same testids, which now ride on the rail buttons.
 *
 * WHY FRESH RENDER ON SWITCH. The body is rebuilt (render() called again) on every rail switch rather
 * than built-once-and-cached. The Speed (anomaly) screen is reaction-time gated and a detached-but-
 * cached node keeps its timers and key listeners alive — the exact leak navigation.spec guards. A
 * discarded half-typed answer on switch is the accepted cost; there is no confirm dialog.
 *
 * NON-GAMIFIED. The active rung carries data-active + aria-current only — no streak/XP/%/badge. The
 * one tolerated status is a muted, zero-suppressed plain-text count on a rung that has one to show.
 */

export interface TrainMode {
  /** Stable id for the rail button's data-mode and the hub's active state. */
  readonly id: string;
  /** The rail label (Spots, Math, …). */
  readonly label: string;
  /** The OLD tab testid (tab-puzzle, tab-drill, …), preserved so deep-link specs keep working. */
  readonly testid: string;
  /** Built fresh each time this mode becomes active — never cached (see file header). */
  readonly render: () => HTMLElement;
  /** Which band the rung sits in; a single hairline divider separates the two. */
  readonly band: 'practice' | 'maintenance';
  /**
   * An optional muted count shown after the label ("3 to fix"). Zero-suppressed by the caller: pass
   * null or 0-worded text to show nothing. Never a badge — plain text, no colour.
   */
  readonly note?: string | null;
}

export interface TrainProps {
  readonly modes: readonly TrainMode[];
  /** The mode to open on. Defaults to the first mode when absent or unknown. */
  readonly initialMode?: string;
}

/**
 * The announcer mirrors the rail switch for screen readers, since the body swaps without a page
 * navigation. Always present, first child, so replaceChildren never drops it (the pattern the coach
 * and outcome announcers use on the table).
 */
function makeAnnouncer(): HTMLElement {
  const region = document.createElement('div');
  region.className = 'visually-hidden';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  return region;
}

export function renderTrainScreen(props: TrainProps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'train-screen';
  root.dataset.testid = 'train-screen';

  if (props.modes.length === 0) {
    // Defensive: the hub is always built with six modes, but an empty list must not throw or render a
    // blank shell — say so plainly rather than paint nothing.
    root.textContent = 'No training modes available.';
    return root;
  }

  const known = new Set(props.modes.map((m) => m.id));
  let active =
    props.initialMode !== undefined && known.has(props.initialMode)
      ? props.initialMode
      : props.modes[0].id;

  const announcer = makeAnnouncer();
  const rail = document.createElement('nav');
  rail.className = 'train-rail';
  rail.dataset.testid = 'train-rail';
  rail.setAttribute('aria-label', 'Training modes');

  const body = document.createElement('div');
  body.className = 'train-body';
  body.dataset.testid = 'train-body';

  function selectMode(next: string): void {
    if (next === active || !known.has(next)) return;
    active = next;
    paintRail();
    paintBody();
    const mode = props.modes.find((m) => m.id === active);
    if (mode) announcer.textContent = `${mode.label} selected`;
  }

  /** The rail buttons. Rebuilt on switch so data-active / aria-current track the active rung. */
  function paintRail(): void {
    const buttons: HTMLElement[] = [];
    let dividerInserted = false;
    for (const mode of props.modes) {
      // One hairline divider between the practice band and the maintenance band. Inserted before the
      // first maintenance rung, aria-hidden because it carries no label — it is a visual grouping only.
      if (mode.band === 'maintenance' && !dividerInserted) {
        const divider = document.createElement('div');
        divider.className = 'train-rail-divider';
        divider.setAttribute('aria-hidden', 'true');
        buttons.push(divider);
        dividerInserted = true;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'train-rail-btn';
      // THE OLD TAB TESTID rides here so every deep-link spec (click tab-drill, click tab-puzzle, …)
      // still resolves — it just needs one prepended click on tab-train to open the hub first.
      button.dataset.testid = mode.testid;
      button.dataset.mode = mode.id;
      const isActive = mode.id === active;
      button.dataset.active = String(isActive);
      if (isActive) button.setAttribute('aria-current', 'true');
      // Roving tabindex: only the active rung is in the tab order; Up/Down move between rungs.
      button.tabIndex = isActive ? 0 : -1;

      const label = document.createElement('span');
      label.className = 'train-rail-label';
      label.textContent = mode.label;
      button.appendChild(label);

      // Zero-suppressed muted count: shown only when the caller passes real text.
      if (mode.note != null && mode.note !== '') {
        const note = document.createElement('span');
        note.className = 'train-rail-note';
        note.dataset.testid = 'train-rail-note';
        note.textContent = mode.note;
        button.appendChild(note);
      }

      button.addEventListener('click', () => selectMode(mode.id));
      buttons.push(button);
    }
    rail.replaceChildren(...buttons);
  }

  function paintBody(): void {
    const mode = props.modes.find((m) => m.id === active);
    if (!mode) return;
    root.dataset.mode = active;
    // FRESH render each switch — never a cached node (see file header: RT-gated Speed screen leaks).
    body.replaceChildren(mode.render());
  }

  /**
   * Vertical roving-tabindex: Up/Down move focus between rungs and activate, Home/End jump to the
   * ends. Enter/Space are the button's native activation, so they need no handling here. Keyed on the
   * rail so it does not fire while the body has focus.
   */
  rail.addEventListener('keydown', (event) => {
    const order = props.modes.map((m) => m.id);
    const current = order.indexOf(active);
    if (current === -1) return;
    let nextIndex = current;
    if (event.key === 'ArrowDown') nextIndex = Math.min(order.length - 1, current + 1);
    else if (event.key === 'ArrowUp') nextIndex = Math.max(0, current - 1);
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = order.length - 1;
    else return;
    event.preventDefault();
    selectMode(order[nextIndex]);
    // Move focus to the newly active rung so keyboard travel is visible.
    const btn = rail.querySelector<HTMLElement>(`[data-mode="${order[nextIndex]}"]`);
    btn?.focus();
  });

  paintRail();
  paintBody();
  root.replaceChildren(announcer, rail, body);
  return root;
}
