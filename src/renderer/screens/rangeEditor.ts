import '../styles-range-editor.css';

import { RANKS, type Card, type Rank } from '../../core/cards.js';
import { ALL_COMBOS, type Combo } from '../../core/preflop.js';
import {
  emptyRange,
  paintCombo,
  rangeWidth,
  scoreDrill,
  type DrillAnswer,
  type SavedRange,
} from '../../core/rangeEditor.js';
import { mulberry32, type Rng } from '../../core/rng.js';
import { renderCard } from '../components/card.js';

/**
 * PREFLOP RANGE EDITOR / TRAINER — BACKLOG #6.
 *
 * The learner paints a 13x13 range grid (the SAME 169 cells and orientation as the Charts screen and the
 * equity calculator, built from ALL_COMBOS), names it, and saves it to their profile. A saved range can
 * be loaded back onto the grid and DRILLED against: the trainer deals a random hand and asks "is this in
 * the range?", grading against the range the learner themselves built. No poker maths lives here — combo
 * facts, membership, width and scoring all come from core/rangeEditor.ts (a surface over core/preflop.ts).
 *
 * State model mirrors the equity calculator: the DOM is built once and mutated in place, so the name
 * input keeps its value and focus across a paint. The grid selection is a live `Set<Combo>`; a range is
 * only crystallised into a SavedRange on Save or when a drill snapshots the current grid.
 */

/** Rows/columns run ace-first, the orientation every published chart (and the Charts grid) uses. */
const RANKS_DESC: readonly Rank[] = [...RANKS].reverse();

/** Fixed default so an e2e run and a first launch draw the same drill sequence, as the Charts drill does. */
const DRILL_SEED = 11;

export interface RangeEditorOptions {
  /** The learner's saved ranges, carried in from the persisted session. Absent → an empty library. */
  readonly ranges?: readonly SavedRange[];
  /** Persist one named range (upsert by name). Fired on Save; main.ts folds it into the session and saves. */
  readonly onSave?: (range: SavedRange) => void;
  /** Delete a saved range by name. Fired on a row's Delete; main.ts folds it into the session and saves. */
  readonly onDelete?: (name: string) => void;
  /** Drill RNG seed; defaults to DRILL_SEED so the sequence is reproducible. Tests pin it. */
  readonly seed?: number;
}

/** Upper-right triangle suited, lower-left offsuit, pairs on the diagonal — the shared grid convention. */
function comboAt(rowRank: Rank, colRank: Rank): Combo {
  const row = RANKS.indexOf(rowRank);
  const col = RANKS.indexOf(colRank);
  if (row === col) return `${rowRank}${rowRank}`;
  return row > col ? `${rowRank}${colRank}s` : `${colRank}${rowRank}o`;
}

/** Two concrete cards for a combo — fixed suits, so the same spot always looks the same (as Charts does). */
function cardsFor(combo: Combo): Card[] {
  const suited = combo.endsWith('s');
  return [`${combo[0]}s`, `${combo[1]}${suited ? 's' : 'h'}`];
}

function text(tag: string, className: string, content: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = content;
  return el;
}

export function renderRangeEditor(options: RangeEditorOptions = {}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'range-editor-screen';
  root.dataset.testid = 'range-editor-screen';

  // Working copies. `selected` is the live grid; `savedRanges` is this screen's mirror of the persisted
  // library, updated locally on save/delete AND reported out via the callbacks (the Charts pattern: own
  // your state, notify main for persistence). A re-render of the tab rebuilds from the fresh session, so
  // the two never drift.
  const selected = new Set<Combo>();
  let savedRanges: SavedRange[] = (options.ranges ?? []).map((r) => ({ name: r.name, combos: [...r.combos] }));
  const rng: Rng = mulberry32(options.seed ?? DRILL_SEED);

  // Drill state. `drillRange` is snapshotted from the grid at Start, so editing after Start cannot move
  // the target under the learner. null → not drilling.
  let drillRange: SavedRange | null = null;
  let drillCombo: Combo | null = null;
  let drillFeedback: ReturnType<typeof scoreDrill> | null = null;
  const drillTally = { attempts: 0, correct: 0 };

  // A polite live region so a screen-reader user hears the drill verdict, which otherwise updates silently
  // in place (mirrors the Charts announcer). Kept as the first child in every paint.
  const announcer = document.createElement('div');
  announcer.className = 'visually-hidden';
  announcer.dataset.testid = 'range-editor-announcer';
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-live', 'polite');
  root.appendChild(announcer);

  root.appendChild(text('h2', 'range-editor-title', 'Range editor'));
  root.appendChild(
    text(
      'p',
      'range-editor-lede',
      'Paint a preflop range on the grid, name it and save it. Load a saved range to drill: the trainer deals a hand and you say whether it is in the range.',
    ),
  );

  // --- Name field -----------------------------------------------------------
  const nameField = document.createElement('div');
  nameField.className = 'range-editor-field';
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Range name';
  nameLabel.htmlFor = 'range-editor-name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.id = 'range-editor-name';
  nameInput.dataset.testid = 'range-editor-name';
  nameInput.placeholder = 'e.g. BTN open';
  nameField.appendChild(nameLabel);
  nameField.appendChild(nameInput);
  root.appendChild(nameField);

  // --- The 13x13 grid -------------------------------------------------------
  const grid = document.createElement('div');
  grid.className = 'range-editor-grid';
  grid.dataset.testid = 'range-editor-grid';
  const cells = new Map<Combo, HTMLButtonElement>();
  for (const high of RANKS_DESC) {
    for (const low of RANKS_DESC) {
      const combo = comboAt(high, low);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'range-editor-cell';
      cell.dataset.testid = 'range-editor-cell';
      cell.dataset.combo = combo;
      cell.dataset.selected = 'false';
      cell.textContent = combo;
      cell.setAttribute('aria-pressed', 'false');
      cell.addEventListener('click', () => {
        // Painting is disabled while drilling: the grid is the answer key and must not move mid-quiz.
        if (drillRange !== null) return;
        if (selected.has(combo)) selected.delete(combo);
        else selected.add(combo);
        syncCell(combo);
        refreshCount();
      });
      cells.set(combo, cell);
      grid.appendChild(cell);
    }
  }
  // ALL_COMBOS is the canonical 169; a missing cell would silently drop a hand from every range.
  if (cells.size !== ALL_COMBOS.length) {
    throw new Error(`range grid built ${cells.size} cells, expected ${ALL_COMBOS.length}`);
  }
  root.appendChild(grid);

  // --- Controls -------------------------------------------------------------
  const controls = document.createElement('div');
  controls.className = 'range-editor-controls';
  const count = text('span', 'range-editor-count', '');
  count.dataset.testid = 'range-editor-count';
  const clearBtn = pill('range-editor-clear', 'Clear');
  const saveBtn = pill('range-editor-save', 'Save');
  controls.appendChild(saveBtn);
  controls.appendChild(clearBtn);
  controls.appendChild(count);
  root.appendChild(controls);

  const error = document.createElement('div');
  error.className = 'range-editor-error';
  error.dataset.testid = 'range-editor-error';
  error.setAttribute('role', 'alert');
  root.appendChild(error);

  // --- Saved library --------------------------------------------------------
  const savedSection = document.createElement('div');
  savedSection.className = 'range-editor-saved';
  savedSection.appendChild(text('div', 'stat-label', 'Saved ranges'));
  const savedList = document.createElement('ul');
  savedList.className = 'range-editor-saved-list';
  savedList.dataset.testid = 'range-editor-saved-list';
  savedSection.appendChild(savedList);
  root.appendChild(savedSection);

  // --- Drill ----------------------------------------------------------------
  const drill = document.createElement('section');
  drill.className = 'range-editor-drill';
  drill.dataset.testid = 'range-editor-drill';
  root.appendChild(drill);

  // -------------------------------------------------------------------------

  function syncCell(combo: Combo): void {
    const cell = cells.get(combo);
    if (!cell) return;
    const on = selected.has(combo);
    cell.dataset.selected = String(on);
    cell.setAttribute('aria-pressed', String(on));
  }

  function refreshCount(): void {
    const n = selected.size;
    count.textContent = `${n} combo${n === 1 ? '' : 's'} · ${Math.round(rangeWidth(currentRange()) * 100)}%`;
    root.dataset.count = String(n);
  }

  /**
   * The current grid contents as a SavedRange. Folding through the model's paintCombo (rather than
   * hand-sorting here) reuses its canonical-order + validation guarantee, so a saved range is byte-stable
   * regardless of the order cells were clicked.
   */
  function currentRange(): SavedRange {
    return [...selected].reduce((range, combo) => paintCombo(range, combo), emptyRange(nameInput.value));
  }

  function loadRange(range: SavedRange): void {
    if (drillRange !== null) stopDrill(); // never load underneath a live quiz
    selected.clear();
    for (const combo of range.combos) selected.add(combo);
    nameInput.value = range.name;
    for (const combo of cells.keys()) syncCell(combo);
    refreshCount();
    error.textContent = '';
  }

  function refreshSavedList(): void {
    savedList.replaceChildren();
    root.dataset.saved = String(savedRanges.length);
    if (savedRanges.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'range-editor-saved-meta';
      empty.dataset.testid = 'range-editor-saved-empty';
      empty.textContent = 'No saved ranges yet.';
      savedList.appendChild(empty);
      return;
    }
    for (const range of savedRanges) {
      const row = document.createElement('li');
      row.className = 'range-editor-saved-row';
      row.dataset.testid = 'range-editor-saved-row';
      row.dataset.name = range.name;

      const name = text('span', 'range-editor-saved-name', range.name);
      const meta = text(
        'span',
        'range-editor-saved-meta',
        `${range.combos.length} combos · ${Math.round(rangeWidth(range) * 100)}%`,
      );
      const loadBtn = pill('range-editor-load', 'Load');
      loadBtn.addEventListener('click', () => loadRange(range));
      const deleteBtn = pill('range-editor-delete', 'Delete');
      deleteBtn.addEventListener('click', () => removeRange(range.name));

      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.flexDirection = 'column';
      left.appendChild(name);
      left.appendChild(meta);
      const right = document.createElement('div');
      right.className = 'range-editor-drill-keys';
      right.appendChild(loadBtn);
      right.appendChild(deleteBtn);

      row.appendChild(left);
      row.appendChild(right);
      savedList.appendChild(row);
    }
  }

  function save(): void {
    const range = currentRange();
    if (range.name === '') {
      error.textContent = 'Give the range a name before saving.';
      return;
    }
    if (range.combos.length === 0) {
      error.textContent = 'Paint at least one hand before saving.';
      return;
    }
    error.textContent = '';
    // Local upsert-by-name, mirroring session.saveRange, so the on-screen list matches the persisted one.
    const existing = savedRanges.findIndex((r) => r.name === range.name);
    if (existing >= 0) savedRanges[existing] = range;
    else savedRanges = [...savedRanges, range];
    refreshSavedList();
    options.onSave?.(range);
  }

  function removeRange(name: string): void {
    savedRanges = savedRanges.filter((r) => r.name !== name);
    refreshSavedList();
    options.onDelete?.(name);
  }

  // --- Drill wiring ---------------------------------------------------------

  function startDrill(): void {
    const range = currentRange();
    if (range.combos.length === 0) {
      error.textContent = 'Paint or load a range first, then drill against it.';
      return;
    }
    error.textContent = '';
    drillRange = range;
    drillFeedback = null;
    drillTally.attempts = 0;
    drillTally.correct = 0;
    drawDrillCombo();
    renderDrill();
  }

  function stopDrill(): void {
    drillRange = null;
    drillCombo = null;
    drillFeedback = null;
    renderDrill();
  }

  function drawDrillCombo(): void {
    drillCombo = ALL_COMBOS[Math.floor(rng() * ALL_COMBOS.length)];
  }

  function answerDrill(answer: DrillAnswer): void {
    if (drillRange === null || drillCombo === null) return;
    const verdict = scoreDrill(drillRange, drillCombo, answer);
    drillTally.attempts += 1;
    if (verdict.correct) drillTally.correct += 1;
    drillFeedback = verdict;
    drawDrillCombo();
    renderDrill();
  }

  function renderDrill(): void {
    drill.replaceChildren();
    root.dataset.mode = drillRange === null ? 'edit' : 'drill';

    if (drillRange === null) {
      announcer.textContent = '';
      const startBtn = pill('range-editor-start-drill', 'Drill this range');
      startBtn.addEventListener('click', startDrill);
      drill.appendChild(text('div', 'stat-label', 'Drill'));
      drill.appendChild(startBtn);
      delete root.dataset.drillCombo;
      root.dataset.drillVerdict = '';
      return;
    }

    drill.appendChild(
      text('div', 'stat-label', `Drilling "${drillRange.name || 'unsaved'}" — is this hand in the range?`),
    );

    if (drillCombo !== null) {
      const hand = document.createElement('div');
      hand.className = 'range-editor-drill-hand';
      hand.dataset.testid = 'range-editor-drill-hand';
      hand.dataset.combo = drillCombo;
      for (const card of cardsFor(drillCombo)) hand.appendChild(renderCard(card, { small: true }));
      drill.appendChild(hand);
      root.dataset.drillCombo = drillCombo;
    }

    const keys = document.createElement('div');
    keys.className = 'range-editor-drill-keys';
    keys.appendChild(drillKey('range-editor-in', 'I — in range', 'in'));
    keys.appendChild(drillKey('range-editor-out', 'O — out', 'out'));
    drill.appendChild(keys);

    // Feedback on the PREVIOUS spot (the next hand is already dealt above), labelled "last" like Charts.
    const feedback = document.createElement('div');
    feedback.className = 'range-editor-drill-feedback';
    feedback.dataset.testid = 'range-editor-drill-feedback';
    if (drillFeedback === null) {
      feedback.dataset.verdict = 'none';
      feedback.textContent = 'Answer with I (in) or O (out).';
      root.dataset.drillVerdict = '';
      announcer.textContent = '';
    } else {
      const right = drillFeedback.correct;
      feedback.dataset.verdict = right ? 'right' : 'wrong';
      const line = right
        ? `last ${drillFeedback.combo} — ${drillFeedback.inRange ? 'in' : 'out'}`
        : `last ${drillFeedback.combo} was ${drillFeedback.inRange ? 'in' : 'out'}, not ${drillFeedback.answer}`;
      feedback.textContent = line;
      root.dataset.drillVerdict = right ? 'right' : 'wrong';
      announcer.textContent = line;
    }
    drill.appendChild(feedback);

    const score = text(
      'div',
      'range-editor-drill-score',
      `${drillTally.correct}/${drillTally.attempts} correct`,
    );
    score.dataset.testid = 'range-editor-drill-score';
    score.dataset.attempts = String(drillTally.attempts);
    score.dataset.correct = String(drillTally.correct);
    drill.appendChild(score);

    const stopBtn = pill('range-editor-stop-drill', 'Stop drill');
    stopBtn.addEventListener('click', stopDrill);
    drill.appendChild(stopBtn);
  }

  function drillKey(testid: string, label: string, answer: DrillAnswer): HTMLButtonElement {
    const btn = pill(testid, label);
    btn.addEventListener('click', () => answerDrill(answer));
    return btn;
  }

  // Keyboard answers for the drill, keyed off document (works without a focused button) and self-removing
  // once the root detaches — main.ts's renderTab has no teardown hook, so the listener cleans itself up.
  function onKey(event: KeyboardEvent): void {
    if (!root.isConnected) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    // Only during a drill, never a modifier chord, and never while the learner is typing the range name.
    if (drillRange === null) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (document.activeElement instanceof HTMLInputElement) return;
    const key = event.key.toLowerCase();
    if (key === 'i') answerDrill('in');
    else if (key === 'o') answerDrill('out');
  }
  document.addEventListener('keydown', onKey);

  clearBtn.addEventListener('click', () => {
    if (drillRange !== null) return;
    selected.clear();
    for (const combo of cells.keys()) syncCell(combo);
    refreshCount();
  });
  saveBtn.addEventListener('click', save);

  refreshCount();
  refreshSavedList();
  renderDrill();

  return root;
}

function pill(testid: string, label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pill';
  btn.dataset.testid = testid;
  btn.textContent = label;
  return btn;
}
