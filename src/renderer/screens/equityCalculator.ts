import '../styles-equity.css';

import { RANKS, freshDeck, type Card, type Rank } from '../../core/cards.js';
import {
  DISPLAY_ITERATIONS,
  equityVsRandom,
  equityVsRange,
  exactEquityHeadsUp,
  type EquityResult,
} from '../../core/equity.js';
import { ALL_COMBOS, type Combo } from '../../core/preflop.js';
import { renderCard } from '../components/card.js';
import { attachThumb } from '../components/thumb.js';

/**
 * STANDALONE EQUITY CALCULATOR — BACKLOG #5.
 *
 * A surface over the VERIFIED equity engine, adding no poker maths of its own. Hero cards, an optional
 * board, and an optional villain (a specific hand, a range of combos, or "any two") route to whichever of
 * the three existing primitives is right for the spot:
 *   - a specific villain hand  -> exactEquityHeadsUp  (full enumeration, exact)
 *   - a range of combos        -> equityVsRange       (Monte Carlo, combo-weighted with card removal)
 *   - "any two" / no villain    -> equityVsRandom      (Monte Carlo vs one uniform opponent)
 * The engine, evaluator and range machinery are reused untouched; this file only parses input, picks the
 * primitive, and paints the result.
 */

/** Who the hero is up against. `random` is a single uniform opponent (any two cards). */
export type VillainSpec =
  | { readonly kind: 'hand'; readonly cards: Card[] }
  | { readonly kind: 'range'; readonly combos: readonly Combo[] }
  | { readonly kind: 'random' };

export interface EquityInput {
  /** Hero's two hole cards. */
  readonly hero: Card[];
  /** 0 (preflop), 3 (flop), 4 (turn) or 5 (river) community cards. */
  readonly board: Card[];
  readonly villain: VillainSpec;
  /** Monte Carlo controls; ignored on the exact (specific-hand) path. */
  readonly iterations?: number;
  readonly seed?: number;
}

export interface CalcResult {
  /** Hero's combined equity share, win + tie/2, in [0, 1]. Always present. */
  readonly equity: number;
  /** True when computed by exact enumeration (a specific villain hand); false for Monte Carlo. */
  readonly exact: boolean;
  /** Present only on the Monte Carlo paths (range / random); null on the exact path. */
  readonly win: number | null;
  readonly tie: number | null;
  readonly lose: number | null;
  readonly categoryChances: Record<string, number> | null;
  readonly iterations: number | null;
  readonly opponent: VillainSpec['kind'];
}

const DECK = new Set(freshDeck());
const VALID_BOARD_LENGTHS = new Set([0, 3, 4, 5]);

/**
 * Parse "As Kh", "as,kh" or "Th 9d 8c" into canonical cards. Rank uppercased, suit lowercased, then
 * checked against the real 52-card deck so a typo ("Xz", "A") is rejected here rather than fed to the
 * engine. Blank input is an empty hand, not an error — an empty board or villain is a legal spot.
 */
export function parseCards(text: string): Card[] {
  const tokens = text.trim().split(/[\s,]+/).filter((t) => t.length > 0);
  return tokens.map((token) => {
    if (token.length !== 2) throw new Error(`not a card: ${token}`);
    const card = token[0].toUpperCase() + token[1].toLowerCase();
    if (!DECK.has(card)) throw new Error(`not a card: ${token}`);
    return card;
  });
}

/**
 * The first reason this spot cannot be computed, or null when it is legal. Ordered so the message names
 * the most basic problem first (hero, then board shape, then villain, then the physical impossibility of
 * a card appearing twice).
 */
export function validateInput(input: EquityInput): string | null {
  if (input.hero.length !== 2) return 'Enter exactly two hero cards, e.g. As Kh.';
  if (!VALID_BOARD_LENGTHS.has(input.board.length)) {
    return 'The board must be empty, or a flop (3), turn (4) or river (5).';
  }
  if (input.villain.kind === 'hand' && input.villain.cards.length !== 2) {
    return 'Enter exactly two villain cards, or pick a range or "any two".';
  }

  const seen: Card[] = [
    ...input.hero,
    ...input.board,
    ...(input.villain.kind === 'hand' ? input.villain.cards : []),
  ];
  const unique = new Set(seen);
  if (unique.size !== seen.length) return 'A card cannot appear twice — check for duplicates.';

  return null;
}

/**
 * Route the spot to the right verified primitive. Assumes `validateInput` already passed; the caller (the
 * UI, and the tests) gate on it. Never reimplements equity — it only chooses which existing function to
 * call and normalises the shape.
 */
export function computeEquity(input: EquityInput): CalcResult {
  const iterations = input.iterations ?? DISPLAY_ITERATIONS;
  const seed = input.seed ?? 1;

  if (input.villain.kind === 'hand') {
    const equity = exactEquityHeadsUp(input.hero, input.board, input.villain.cards);
    return {
      equity,
      exact: true,
      win: null,
      tie: null,
      lose: null,
      categoryChances: null,
      iterations: null,
      opponent: 'hand',
    };
  }

  const result: EquityResult =
    input.villain.kind === 'range'
      ? equityVsRange(input.hero, input.board, input.villain.combos, iterations, seed)
      : equityVsRandom(input.hero, input.board, 1, iterations, seed);

  return {
    equity: result.win + result.tie * 0.5,
    exact: false,
    win: result.win,
    tie: result.tie,
    lose: result.lose,
    categoryChances: result.categoryChances,
    iterations: result.iterations,
    opponent: input.villain.kind,
  };
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

type VillainMode = VillainSpec['kind'];

/** Categories rarer than this are noise, matching the live stats sheet's threshold. */
const MIN_SHOWN_CHANCE = 0.01;

/** Rows/columns run ace-first, the orientation every published chart (and the Charts screen) uses. */
const RANKS_DESC: readonly Rank[] = [...RANKS].reverse();

/** Upper-right triangle suited, lower-left offsuit, pairs on the diagonal — the Charts grid convention. */
function comboAt(rowRank: Rank, colRank: Rank): Combo {
  const row = RANKS.indexOf(rowRank);
  const col = RANKS.indexOf(colRank);
  if (row === col) return `${rowRank}${rowRank}`;
  return row > col ? `${rowRank}${colRank}s` : `${colRank}${rowRank}o`;
}

function text(tag: string, className: string, content: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = content;
  return el;
}

export function renderEquityCalculator(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'equity-screen';
  root.dataset.testid = 'equity-screen';

  // Two columns: the inputs in a side column, the result and the range grid in the main one.
  const side = document.createElement('div');
  side.className = 'equity-side';
  const main = document.createElement('div');
  main.className = 'equity-main';
  root.appendChild(side);
  root.appendChild(main);
  // Before any result and outside range mode the main column would be empty; say what fills it.
  const placeholder = text(
    'p',
    'equity-placeholder g-caption',
    'The result appears here. Pick “Range” to paint the villain’s range on a grid.',
  );

  side.appendChild(text('h2', 'equity-title t-t3', 'Equity calculator'));
  side.appendChild(
    text(
      'p',
      'equity-lede g-caption',
      'Type cards as rank+suit — As, Kh, Td, 9c. Hero is exact against a specific villain hand, and a Monte Carlo estimate against a range or any two cards.',
    ),
  );

  const heroInput = field(side, 'Hero hand', 'equity-hero-input', 'As Ah', 'Two cards.');
  const boardInput = field(side, 'Board', 'equity-board-input', '', 'Empty, or 3 / 4 / 5 cards.');

  // Villain: a mode picker, then the input that mode needs (a hand text field or the range grid).
  const modeWrap = document.createElement('div');
  modeWrap.className = 'equity-field';
  modeWrap.appendChild(text('label', '', 'Villain'));
  // A segmented control over the three radios: each label is a segment, the radio inside it stays the
  // real control (keyboard, a11y, tests), and the shared thumb sits under the checked one.
  const modes = document.createElement('div');
  modes.className = 'equity-modes g-seg';
  modeWrap.appendChild(modes);
  side.appendChild(modeWrap);

  let villainMode: VillainMode = 'random';
  const selectedCombos = new Set<Combo>();

  const villainInput = document.createElement('input');
  villainInput.type = 'text';
  villainInput.dataset.testid = 'equity-villain-input';
  villainInput.placeholder = 'Ks Kd';
  villainInput.setAttribute('aria-label', 'Villain hand');

  const villainHandField = document.createElement('div');
  villainHandField.className = 'equity-field';
  villainHandField.appendChild(villainInput);

  const rangePanel = renderRangePanel(selectedCombos);

  const modeOptions: readonly { readonly value: VillainMode; readonly label: string }[] = [
    { value: 'random', label: 'Any two cards' },
    { value: 'hand', label: 'Specific hand' },
    { value: 'range', label: 'Range' },
  ];
  for (const option of modeOptions) {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'equity-villain-mode';
    radio.value = option.value;
    radio.dataset.testid = `equity-mode-${option.value}`;
    radio.checked = option.value === villainMode;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      villainMode = option.value;
      syncVillainInputs();
    });
    label.className = 'equity-mode';
    label.dataset.selected = String(radio.checked);
    label.appendChild(radio);
    label.appendChild(document.createTextNode(option.label));
    modes.appendChild(label);
  }
  attachThumb(modes, 'label');

  side.appendChild(villainHandField);

  const rangeGrid = rangePanel.querySelector<HTMLElement>('.equity-range-grid');
  function syncVillainInputs(): void {
    villainHandField.hidden = villainMode !== 'hand';
    const wasHidden = rangePanel.hidden;
    rangePanel.hidden = villainMode !== 'range';
    for (const label of modes.querySelectorAll<HTMLElement>('.equity-mode')) {
      label.dataset.selected = String(label.querySelector('input')?.value === villainMode);
    }
    // The grid fades in row by row each time it is revealed (restart the animation by re-adding).
    if (rangeGrid && wasHidden && !rangePanel.hidden) {
      rangeGrid.classList.remove('is-entering');
      void rangeGrid.offsetWidth;
      rangeGrid.classList.add('is-entering');
    }
    if (resultElReady) syncPlaceholder();
  }
  rangePanel.hidden = true;
  let resultElReady = false;
  syncVillainInputs();

  const calculate = document.createElement('button');
  calculate.type = 'button';
  calculate.className = 'pill primary';
  calculate.dataset.testid = 'equity-calculate';
  calculate.textContent = 'Calculate';
  side.appendChild(calculate);

  const errorEl = document.createElement('div');
  errorEl.className = 'equity-error';
  errorEl.dataset.testid = 'equity-error';
  errorEl.setAttribute('role', 'alert');
  side.appendChild(errorEl);

  const resultEl = document.createElement('div');
  resultEl.className = 'equity-result';
  resultEl.dataset.testid = 'equity-result';
  // Announce the fresh number to a screen reader without stealing focus from the Calculate button.
  resultEl.setAttribute('aria-live', 'polite');
  resultEl.hidden = true;
  main.appendChild(resultEl);
  main.appendChild(rangePanel);
  main.appendChild(placeholder);
  resultElReady = true;
  syncPlaceholder();

  function syncPlaceholder(): void {
    placeholder.hidden = !resultEl.hidden || !rangePanel.hidden;
  }

  function villainSpec(): VillainSpec {
    if (villainMode === 'hand') return { kind: 'hand', cards: parseCards(villainInput.value) };
    if (villainMode === 'range') return { kind: 'range', combos: [...selectedCombos] };
    return { kind: 'random' };
  }

  function run(): void {
    errorEl.textContent = '';
    let input: EquityInput;
    try {
      input = {
        hero: parseCards(heroInput.value),
        board: parseCards(boardInput.value),
        villain: villainSpec(),
      };
    } catch (err) {
      resultEl.hidden = true;
      errorEl.textContent = err instanceof Error ? err.message : 'Could not read those cards.';
      return;
    }

    if (villainMode === 'range' && selectedCombos.size === 0) {
      resultEl.hidden = true;
      errorEl.textContent = 'Pick at least one combo for the range, or choose "any two cards".';
      return;
    }

    const problem = validateInput(input);
    if (problem) {
      resultEl.hidden = true;
      errorEl.textContent = problem;
      return;
    }

    paintResult(resultEl, input, computeEquity(input));
  }

  calculate.addEventListener('click', () => {
    run();
    syncPlaceholder();
  });

  return root;
}

/** One labelled text input, appended to `parent`; returns the input so the caller can read it. */
function field(
  parent: HTMLElement,
  labelText: string,
  testid: string,
  placeholder: string,
  hint: string,
): HTMLInputElement {
  const wrap = document.createElement('div');
  wrap.className = 'equity-field';

  const label = document.createElement('label');
  label.textContent = labelText;
  label.htmlFor = testid;
  wrap.appendChild(label);

  const input = document.createElement('input');
  input.type = 'text';
  input.id = testid;
  input.dataset.testid = testid;
  input.placeholder = placeholder;
  wrap.appendChild(input);

  wrap.appendChild(text('span', 'equity-hint', hint));
  parent.appendChild(wrap);
  return input;
}

/** The 13x13 selectable grid of the 169 combos, mirroring the Charts grid layout. Toggling mutates `selected`. */
function renderRangePanel(selected: Set<Combo>): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'equity-field equity-range-panel';

  const controls = document.createElement('div');
  controls.className = 'equity-range-controls';
  const count = text('span', 'equity-range-count g-caption g-num', '0 combos');
  count.dataset.testid = 'equity-range-count';
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'pill sm';
  clear.dataset.testid = 'equity-range-clear';
  clear.textContent = 'Clear';
  controls.appendChild(clear);
  controls.appendChild(count);
  panel.appendChild(controls);

  const grid = document.createElement('div');
  grid.className = 'equity-range-grid';
  grid.dataset.testid = 'equity-range-grid';
  panel.appendChild(grid);

  const cells = new Map<Combo, HTMLButtonElement>();

  const refreshCount = (): void => {
    count.textContent = `${selected.size} combo${selected.size === 1 ? '' : 's'}`;
  };

  RANKS_DESC.forEach((high, row) => {
    for (const low of RANKS_DESC) {
      const combo = comboAt(high, low);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'equity-range-cell';
      cell.style.setProperty('--r', String(row));
      cell.dataset.testid = 'equity-range-cell';
      cell.dataset.combo = combo;
      cell.dataset.selected = 'false';
      cell.textContent = combo;
      cell.setAttribute('aria-pressed', 'false');
      cell.addEventListener('click', () => {
        const now = !selected.has(combo);
        if (now) selected.add(combo);
        else selected.delete(combo);
        cell.dataset.selected = String(now);
        cell.setAttribute('aria-pressed', String(now));
        refreshCount();
      });
      cells.set(combo, cell);
      grid.appendChild(cell);
    }
  });

  clear.addEventListener('click', () => {
    selected.clear();
    for (const cell of cells.values()) {
      cell.dataset.selected = 'false';
      cell.setAttribute('aria-pressed', 'false');
    }
    refreshCount();
  });

  // ALL_COMBOS is the canonical 169; the grid must cover exactly them (a missing cell would silently
  // drop a hand from every range). Cheap assertion at build time, not a runtime cost per click.
  if (cells.size !== ALL_COMBOS.length) {
    throw new Error(`range grid built ${cells.size} cells, expected ${ALL_COMBOS.length}`);
  }

  return panel;
}

/** Paint one computed result: the headline equity, the shown cards, and the breakdown when we have one. */
function paintResult(host: HTMLElement, input: EquityInput, result: CalcResult): void {
  host.hidden = false;
  host.replaceChildren();

  const value = text('div', 'equity-value t-hero g-num', `${Math.round(result.equity * 100)}%`);
  value.dataset.testid = 'equity-value';
  // The headline over its label, the stat grammar every screen uses.
  const stat = document.createElement('div');
  stat.className = 'equity-stat g-stat';
  stat.appendChild(value);
  stat.appendChild(text('div', 'g-label', 'hero equity'));
  const head = document.createElement('div');
  head.className = 'equity-result-head';
  head.appendChild(stat);
  host.appendChild(head);

  // Show the cards the number is about, reusing the shared card renderer.
  const shown = document.createElement('div');
  shown.className = 'equity-shown';
  const heroRow = document.createElement('div');
  heroRow.className = 'board';
  heroRow.dataset.testid = 'equity-hero-cards';
  for (const c of input.hero) heroRow.appendChild(renderCard(c, { small: true }));
  shown.appendChild(heroRow);
  if (input.board.length > 0) {
    const boardRow = document.createElement('div');
    boardRow.className = 'board';
    boardRow.dataset.testid = 'equity-board-cards';
    for (const c of input.board) boardRow.appendChild(renderCard(c, { small: true }));
    shown.appendChild(boardRow);
  }
  head.appendChild(shown);

  if (result.win !== null && result.tie !== null && result.lose !== null) {
    const breakdown = document.createElement('div');
    breakdown.className = 'equity-breakdown g-num';
    breakdown.appendChild(text('span', '', `Win ${Math.round(result.win * 100)}%`));
    breakdown.appendChild(text('span', '', `Tie ${Math.round(result.tie * 100)}%`));
    breakdown.appendChild(text('span', '', `Lose ${Math.round(result.lose * 100)}%`));
    head.appendChild(breakdown);
  }

  if (result.categoryChances) {
    const cats = document.createElement('div');
    cats.className = 'equity-cats g-flat';
    const shownCats = Object.entries(result.categoryChances)
      .filter(([, chance]) => chance >= MIN_SHOWN_CHANCE)
      .sort((a, b) => b[1] - a[1]);
    for (const [name, chance] of shownCats) {
      const row = document.createElement('div');
      row.className = 'equity-cat';
      row.appendChild(text('span', '', name));
      row.appendChild(text('span', 'g-num', `${Math.round(chance * 100)}%`));
      cats.appendChild(row);
    }
    host.appendChild(cats);
  }

  const note = result.exact
    ? 'Exact — full enumeration of every remaining board.'
    : `Monte Carlo estimate over ${result.iterations?.toLocaleString()} runouts.`;
  host.appendChild(text('div', 'equity-note g-caption', note));
}
