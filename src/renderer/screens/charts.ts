import '../styles-charts.css';

import { RANKS, type Card, type Rank } from '../../core/cards.js';
import {
  BOUNDARY_COMBOS,
  HAND_CLASSES,
  POSITIONS,
  POSITION_RULES,
  classOf,
  combosInClass,
  isBoundaryCombo,
  isInRfiRange,
  rfiWidth,
  type Combo,
  type HandClassId,
  type Position,
} from '../../core/preflop.js';
import { mulberry32, type Rng } from '../../core/rng.js';
import { pickWeightedClass, weakestAttemptedClass, type ClassTally } from '../../core/masteryDrill.js';
import { renderCard } from '../components/card.js';

/**
 * PREFLOP CHART TRAINER — PRODUCT-SPEC N3.
 *
 * N3 answers "can I see a chart yet" with JUXTAPOSITION rather than refusal. The compressed form
 * comes FIRST in DOM order and the 13x13 grid sits beside it: six ordered hand classes, the three
 * verbal threshold rules for the selected seat, the ~12 boundary combos that actually flip the
 * decision, and one line saying the grid is those rules expanded. All 169 cells stay visible.
 * A bare grid is the failure mode (no organising principle to chunk against) and so is a hidden
 * grid (the artifact the learner came for), so both are on screen, in that order.
 *
 * Nothing is computed here. Every fact rendered comes out of core/preflop.ts — this file is a
 * surface over that module and adds no poker knowledge of its own.
 */

/** Rows and columns run ace-first, the orientation every published chart uses. */
const RANKS_DESC: readonly Rank[] = [...RANKS].reverse();

/** Fixed seed: the drill sequence must be identical on every launch for the e2e suite to pin it. */
const DRILL_SEED = 7;

type Action = 'open' | 'fold';

interface Feedback {
  readonly combo: Combo;
  readonly position: Position;
  readonly handClass: HandClassId;
  readonly correct: Action;
  readonly chose: Action;
}

interface Tally {
  attempts: number;
  correct: number;
}

export interface ChartsOptions {
  /**
   * Per-class accuracy carried in from the persisted session, keyed by HandClassId. Seeds the drill's
   * scoreboard AND its adaptive draw, so a learner returning across sittings keeps being drilled on the
   * classes they were missing rather than restarting cold. Absent/empty → every class starts 0/0.
   */
  readonly mastery?: Record<string, { attempts: number; correct: number }>;
  /** Persist one graded answer. Called once per commit; main.ts folds it into the session and saves. */
  readonly onAnswer?: (handClass: HandClassId, correct: boolean) => void;
}

export function renderCharts(options: ChartsOptions = {}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'charts-screen';
  root.dataset.testid = 'charts-screen';

  const rng = mulberry32(DRILL_SEED);
  const tallies = new Map<HandClassId, Tally>(
    HAND_CLASSES.map((c) => {
      const carried = options.mastery?.[c.id];
      return [c.id, { attempts: carried?.attempts ?? 0, correct: carried?.correct ?? 0 }];
    }),
  );

  let position: Position = 'CO';
  let spot: Combo = nextSpot(rng, tallies);
  let feedback: Feedback | null = null;
  let answered = 0;

  function drawSpot(): void {
    spot = nextSpot(rng, tallies);
  }

  function selectPosition(next: Position): void {
    if (next === position) return;
    position = next;
    // A live spot's answer is position-dependent, so carrying it across a seat change would grade
    // the learner against a rule they were not looking at. Draw a fresh one and drop the feedback.
    drawSpot();
    feedback = null;
    paint();
  }

  function commit(chose: Action): void {
    if (position === 'BB') return;
    const combo = spot;
    const handClass = classOf(combo);
    const correct: Action = isInRfiRange(combo, position) ? 'open' : 'fold';

    const tally = tallies.get(handClass);
    if (tally) {
      tally.attempts += 1;
      if (chose === correct) tally.correct += 1;
    }
    // Persist this answer so the mastery — and the adaptive draw it feeds — survives a restart.
    options.onAnswer?.(handClass, chose === correct);

    feedback = { combo, position, handClass, correct, chose };
    answered += 1;
    // Feedback and the next prompt land in the same synchronous paint: no timer, so the learner
    // sees the verdict in the same frame as the keystroke.
    drawSpot();
    paint();
  }

  /**
   * Keyed off `document` rather than the root element so a press works without the screen having
   * focus, and self-removing once the root is detached: main.ts's renderTab has no teardown hook,
   * so the listener has to clean itself up or it outlives every visit to this tab.
   */
  function onKey(event: KeyboardEvent): void {
    if (!root.isConnected) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'o') commit('open');
    else if (key === 'f') commit('fold');
  }
  document.addEventListener('keydown', onKey);

  function paint(): void {
    // The screen's sync oracle: every e2e wait keys off these, never a sleep.
    root.dataset.position = position;
    root.dataset.spot = spot;
    root.dataset.answered = String(answered);
    root.dataset.verdict = feedback === null ? '' : feedback.chose === feedback.correct ? 'right' : 'wrong';

    root.replaceChildren(
      // DOM ORDER IS THE CONTRACT: the compressed form precedes the grid (N3).
      renderCompressed({ position, tallies, onSelect: selectPosition }),
      renderGridPanel({ position, spot, feedback, onCommit: commit }),
    );
  }

  paint();
  return root;
}

// ---------------------------------------------------------------------------
// Compressed form — first in DOM order
// ---------------------------------------------------------------------------

function renderCompressed(opts: {
  position: Position;
  tallies: ReadonlyMap<HandClassId, Tally>;
  onSelect: (position: Position) => void;
}): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'compressed';
  panel.dataset.testid = 'compressed-form';

  panel.appendChild(renderPositionSelector(opts.position, opts.onSelect));
  panel.appendChild(renderWidth(opts.position));
  panel.appendChild(label('Six classes, strongest first'));
  panel.appendChild(renderClasses(opts.tallies));
  panel.appendChild(label('Three rules for this seat'));
  panel.appendChild(renderRules(opts.position));
  panel.appendChild(label('Boundary combos — the cells that flip'));
  panel.appendChild(renderBoundaries(opts.position));
  panel.appendChild(renderNotes(opts.position));

  return panel;
}

function label(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'stat-label';
  el.textContent = text;
  return el;
}

function renderPositionSelector(
  position: Position,
  onSelect: (position: Position) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'position-row';
  row.dataset.testid = 'position-selector';

  for (const seat of POSITIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pill position-btn';
    button.dataset.testid = 'position-btn';
    button.dataset.position = seat;
    button.dataset.active = String(seat === position);
    button.textContent = seat;
    button.addEventListener('click', () => onSelect(seat));
    row.appendChild(button);
  }

  return row;
}

function renderWidth(position: Position): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'chart-width';
  wrap.dataset.testid = 'chart-width';

  const value = document.createElement('div');
  value.className = 'chart-width-value';
  // BB has no first-in node at all, so a "0% of hands" headline would read as a bug rather than as
  // the structural fact it is.
  value.textContent = position === 'BB' ? 'no open' : `${Math.round(rfiWidth(position) * 100)}%`;
  wrap.appendChild(value);

  wrap.appendChild(
    label(
      position === 'BB'
        ? 'the big blind has no raise-first-in range'
        : 'of all hands open first in from here',
    ),
  );

  return wrap;
}

function renderClasses(tallies: ReadonlyMap<HandClassId, Tally>): HTMLElement {
  const list = document.createElement('ol');
  list.className = 'class-list';
  list.dataset.testid = 'class-list';

  // Which class the drill is drilling hardest among those attempted — the one to review. Same order
  // the sampler uses (HAND_CLASSES), so the marked row matches why that class keeps coming up.
  const ordered: ClassTally[] = HAND_CLASSES.map(
    (c) => tallies.get(c.id) ?? { attempts: 0, correct: 0 },
  );
  const weakest = weakestAttemptedClass(ordered);

  HAND_CLASSES.forEach((handClass, classIndex) => {
    const tally = tallies.get(handClass.id) ?? { attempts: 0, correct: 0 };

    const row = document.createElement('li');
    row.className = 'class-row';
    row.dataset.testid = 'class-row';
    row.dataset.class = handClass.id;
    // Marked only when this class is the weakest ATTEMPTED one; an all-fresh scoreboard marks nothing.
    if (classIndex === weakest) row.dataset.review = 'true';

    const name = document.createElement('span');
    name.className = 'class-label';
    name.textContent = handClass.label;
    row.appendChild(name);

    const cells = document.createElement('span');
    cells.className = 'class-cells';
    cells.textContent = `${combosInClass(handClass.id).length} cells`;
    row.appendChild(cells);

    /**
     * The drill scoreboard lives ON the class rows, not in the drill panel. G7: aggregate by tag,
     * never by trait — and the tag that matters here is the class, because a miss is a class
     * boundary the learner has not drawn yet rather than one of 169 unrelated facts.
     */
    const score = document.createElement('span');
    score.className = 'class-score';
    score.dataset.testid = 'class-accuracy';
    score.dataset.class = handClass.id;
    score.dataset.attempts = String(tally.attempts);
    score.dataset.correct = String(tally.correct);
    score.textContent = tally.attempts === 0 ? '—' : `${tally.correct}/${tally.attempts}`;
    row.appendChild(score);

    // A visible word, not just the data-review attribute, so the learner can SEE why this class keeps
    // coming up rather than reading it as the drill misbehaving. Only the marked row carries it.
    if (classIndex === weakest) {
      const flag = document.createElement('span');
      flag.className = 'class-review';
      flag.dataset.testid = 'class-review';
      flag.textContent = 'review';
      row.appendChild(flag);
    }

    list.appendChild(row);
  });

  return list;
}

function renderRules(position: Position): HTMLElement {
  const list = document.createElement('ol');
  list.className = 'rule-list';
  list.dataset.testid = 'rule-list';

  for (const rule of POSITION_RULES[position]) {
    const item = document.createElement('li');
    item.className = 'rule-row';
    item.dataset.testid = 'rule-row';
    item.textContent = rule;
    list.appendChild(item);
  }

  return list;
}

function renderBoundaries(position: Position): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'boundary-row';
  wrap.dataset.testid = 'boundary-list';

  for (const combo of BOUNDARY_COMBOS[position]) {
    const chip = document.createElement('span');
    chip.className = 'boundary-chip';
    chip.dataset.testid = 'boundary-chip';
    chip.dataset.combo = combo;
    chip.dataset.open = String(isInRfiRange(combo, position));
    chip.textContent = combo;
    wrap.appendChild(chip);
  }

  return wrap;
}

function renderNotes(position: Position): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'chart-notes';

  wrap.appendChild(
    note(
      'expansion-note',
      'The grid beside this is those three rules expanded to all 169 cells. Nothing is in it that is not stated above.',
    ),
  );

  // G9, said on screen rather than buried in a source comment.
  wrap.appendChild(
    note(
      'purity-note',
      'No frequencies anywhere here. Every cell is whole in or whole out: the solver’s mixed frequencies were discarded on purpose, because a "62% open" is the most abstraction-overfit fact it produces.',
    ),
  );

  if (position === 'BB') {
    wrap.appendChild(
      note(
        'defence-note',
        'With no first-in range, these boundaries are defence boundaries against a button open, not opens.',
      ),
    );
  }

  return wrap;
}

function note(testid: string, text: string): HTMLElement {
  const el = document.createElement('p');
  el.className = 'chart-note';
  el.dataset.testid = testid;
  el.textContent = text;
  return el;
}

// ---------------------------------------------------------------------------
// The grid, and the drill over it
// ---------------------------------------------------------------------------

function renderGridPanel(opts: {
  position: Position;
  spot: Combo;
  feedback: Feedback | null;
  onCommit: (action: Action) => void;
}): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'grid-panel';

  panel.appendChild(label('Reference expansion — all 169 cells'));
  panel.appendChild(renderGrid(opts.position, opts.feedback?.combo ?? null));
  panel.appendChild(renderDrill(opts));

  return panel;
}

function renderGrid(position: Position, revealed: Combo | null): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'chart-grid';
  grid.dataset.testid = 'chart-grid';

  for (const high of RANKS_DESC) {
    for (const low of RANKS_DESC) {
      grid.appendChild(cell(comboAt(high, low), position, revealed));
    }
  }

  return grid;
}

/** Upper-right triangle suited, lower-left offsuit, pairs on the diagonal — the usual reading. */
function comboAt(rowRank: Rank, colRank: Rank): Combo {
  const row = RANKS.indexOf(rowRank);
  const col = RANKS.indexOf(colRank);
  if (row === col) return `${rowRank}${rowRank}`;
  return row > col ? `${rowRank}${colRank}s` : `${colRank}${rowRank}o`;
}

function cell(combo: Combo, position: Position, revealed: Combo | null): HTMLElement {
  const el = document.createElement('div');
  el.className = 'chart-cell';
  el.dataset.testid = 'chart-cell';
  el.dataset.combo = combo;
  el.dataset.class = classOf(combo);
  el.dataset.open = String(isInRfiRange(combo, position));
  // V2: mint is reserved, so a boundary cell is marked by weight and a dashed edge (see the CSS),
  // never by hue. The revealed cell uses a solid ring so the two marks cannot be confused.
  el.dataset.boundary = String(isBoundaryCombo(combo, position));
  el.dataset.revealed = String(combo === revealed);
  el.textContent = combo;
  return el;
}

function renderDrill(opts: {
  position: Position;
  spot: Combo;
  feedback: Feedback | null;
  onCommit: (action: Action) => void;
}): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'drill';
  panel.dataset.testid = 'chart-drill';

  if (opts.position === 'BB') {
    panel.appendChild(
      note(
        'drill-na',
        'Nothing to drill in the big blind: there is no first-in decision to make. Every other seat has one.',
      ),
    );
    return panel;
  }

  const prompt = document.createElement('div');
  prompt.className = 'drill-prompt';

  const hand = document.createElement('div');
  hand.className = 'drill-hand';
  hand.dataset.testid = 'drill-hand';
  hand.dataset.combo = opts.spot;
  // Real cards, not the "AKs" notation: collapsing two cards to a cell is half the skill, and
  // printing the notation next to a grid labelled in notation would turn the drill into a lookup.
  for (const card of cardsFor(opts.spot)) hand.appendChild(renderCard(card, { small: true }));
  prompt.appendChild(hand);

  const seat = document.createElement('div');
  seat.className = 'drill-seat';
  seat.dataset.testid = 'drill-seat';
  // Story 12: the seat and the price are facts. The class of the hand is NOT named — the learner
  // must place it themselves, and printing it here would delete the skill the drill trains.
  seat.textContent = `${opts.position}, first in`;
  prompt.appendChild(seat);

  const keys = document.createElement('div');
  keys.className = 'drill-keys';
  keys.appendChild(drillKey('O', 'open', opts.onCommit));
  keys.appendChild(drillKey('F', 'fold', opts.onCommit));
  prompt.appendChild(keys);

  panel.appendChild(prompt);
  panel.appendChild(renderFeedback(opts.feedback));

  return panel;
}

/**
 * The verdict on the PREVIOUS spot, which is why it sits below the live prompt rather than replacing
 * it: G5's commit-before-any-answer means the next hand is already up and unanswered.
 *
 * V2: no colour. A right and a wrong commit are told apart by type weight and by wording, because a
 * red X measures d = 0.05 — indistinguishable from no feedback at all. A correct commit gets the
 * combo and the word, nothing more; G3, silence is not praise, so there is no "correct!" anywhere.
 */
function renderFeedback(feedback: Feedback | null): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'drill-feedback';
  wrap.dataset.testid = 'drill-feedback';

  if (feedback === null) {
    wrap.dataset.verdict = 'none';
    wrap.textContent = 'Commit with O or F. The answer is not on screen until you do.';
    return wrap;
  }

  const right = feedback.chose === feedback.correct;
  wrap.dataset.verdict = right ? 'right' : 'wrong';
  wrap.dataset.combo = feedback.combo;

  /**
   * "Last" is load-bearing, not decoration. The verdict is about the PREVIOUS spot while the next
   * hand is already dealt above it, so unlabelled it read as a verdict on the cards on screen — a
   * learner shown A♠Q♠ and the words "AA is open, not fold" has been told the wrong thing.
   */
  const when = document.createElement('span');
  when.className = 'drill-when';
  when.textContent = 'last';
  wrap.appendChild(when);

  const line = document.createElement('span');
  line.className = 'drill-verdict';
  line.dataset.testid = 'drill-verdict';
  line.textContent = right
    ? `${feedback.combo} ${feedback.correct}`
    : `${feedback.combo} is ${feedback.correct}, not ${feedback.chose}`;
  wrap.appendChild(line);

  // Named only AFTER the commit: the class is the chunk the miss belongs to, and it is what makes
  // the readout above a boundary problem instead of 169 unrelated facts.
  const tag = document.createElement('span');
  tag.className = 'drill-tag';
  tag.dataset.testid = 'drill-tag';
  tag.dataset.class = feedback.handClass;
  tag.textContent = feedback.handClass;
  wrap.appendChild(tag);

  return wrap;
}

function drillKey(
  glyph: string,
  action: Action,
  onCommit: (action: Action) => void,
): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pill drill-key';
  button.dataset.testid = `drill-${action}`;
  button.textContent = `${glyph} ${action}`;
  button.addEventListener('click', () => onCommit(action));
  return button;
}

/** Two concrete cards for a combo. Suits are fixed, so the same spot always looks the same. */
function cardsFor(combo: Combo): Card[] {
  const suited = combo.endsWith('s');
  return [`${combo[0]}s`, `${combo[1]}${suited ? 's' : 'h'}`];
}

/**
 * Draw the next class by MASTERY WEIGHT rather than a fixed round-robin: a class the learner keeps
 * missing (or has never seen) comes up more often, a mastered one still recurs but rarely. Uniform
 * sampling over the 169 cells is over half trash and would starve the small classes where the
 * boundaries live; a round-robin fixes that but spends equal reps on the aced class and the failed
 * one. The weighting — and the guarantee no class is starved — lives in core/masteryDrill.ts; the
 * combo WITHIN the chosen class is still uniform. Two rng() calls per draw (class, then combo).
 */
function nextSpot(rng: Rng, tallies: ReadonlyMap<HandClassId, Tally>): Combo {
  const ordered: ClassTally[] = HAND_CLASSES.map(
    (c) => tallies.get(c.id) ?? { attempts: 0, correct: 0 },
  );
  const handClass = HAND_CLASSES[pickWeightedClass(ordered, rng)];
  const candidates = combosInClass(handClass.id);
  return candidates[Math.floor(rng() * candidates.length)];
}
