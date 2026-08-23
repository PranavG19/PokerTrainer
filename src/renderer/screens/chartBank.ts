import '../styles-chart-bank.css';

import { RANKS, type Card, type Rank } from '../../core/cards.js';
import { ALL_COMBOS, type Combo } from '../../core/preflop.js';
import { mulberry32, type Rng } from '../../core/rng.js';
import { renderCard } from '../components/card.js';
import {
  CHART_BANK,
  EMPTY_PROGRESS,
  chartById,
  chartCells,
  chartWidth,
  correctAction,
  gradeChartAnswer,
  recordAnswer,
  type ChartAction,
  type ChartBankProgress,
  type ChartCategory,
  type PreflopChart,
} from '../../core/chartBank.js';

/**
 * PREFLOP CHART BANK — BACKLOG #5, the browse-and-drill surface over core/chartBank.ts.
 *
 * Two panes. LEFT: the catalog — the eleven curated charts grouped into openings (RFI) and
 * facing-a-raise responses; clicking one selects it. RIGHT: the selected chart rendered as the
 * familiar 13x13 grid coloured by its standard action, its published width, an action legend, and a
 * drill that deals a random combo and grades the learner's choice against the chart.
 *
 * Nothing is computed here. Every action, width and cell comes out of core/chartBank.ts (itself a thin
 * surface over the verified core/preflop.ts ranges) — this file only paints and routes keystrokes,
 * mirroring the discipline of the existing Charts and Equity screens.
 */

/** Rows/columns run ace-first, the orientation every published chart uses (same as the Charts screen). */
const RANKS_DESC: readonly Rank[] = [...RANKS].reverse();

/** Fixed seed: the drill sequence is identical on every launch so an e2e can pin it (matches charts.ts). */
const DRILL_SEED = 23;

const CATEGORY_LABEL: Record<ChartCategory, string> = {
  rfi: 'Opening ranges (RFI)',
  defense: 'Facing a raise (vs-RFI)',
};

const ACTION_LABEL: Record<ChartAction, string> = {
  open: 'Open',
  threebet: '3-bet',
  call: 'Call',
  fold: 'Fold',
};

/** One-letter keyboard shortcut per action, shown on the button and honoured by the keydown handler. */
const ACTION_KEY: Record<ChartAction, string> = { open: 'O', threebet: 'T', call: 'C', fold: 'F' };

export interface ChartBankOptions {
  /** Seed the scoreboard + selection from a persisted save. Absent → a fresh, empty progress. */
  readonly progress?: ChartBankProgress;
  /** Persist updated progress after each graded answer or selection. Absent → in-memory only. */
  readonly onProgress?: (progress: ChartBankProgress) => void;
}

export function renderChartBank(options: ChartBankOptions = {}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'chart-bank-screen';
  root.dataset.testid = 'chart-bank-screen';

  // The drill verdict updates in place on commit, so a screen-reader user gets no feedback without a
  // live region. Always-present, kept as the first child in every paint so a repaint never tears it out
  // of the a11y tree. Visually hidden; only the drill fills it.
  const announcer = document.createElement('div');
  announcer.className = 'visually-hidden';
  announcer.dataset.testid = 'chart-bank-announcer';
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-live', 'polite');
  root.appendChild(announcer);

  let progress: ChartBankProgress = options.progress ?? EMPTY_PROGRESS;
  // The persisted selection may name a chart the bank no longer ships; fall back to the first chart.
  let chart: PreflopChart = chartById(progress.selectedId) ?? CHART_BANK[0];

  const rng = mulberry32(DRILL_SEED);
  let spot: Combo = drawSpot(rng);
  let feedback: DrillFeedback | null = null;
  let answered = 0;

  function persist(): void {
    options.onProgress?.(progress);
  }

  function selectChart(next: PreflopChart): void {
    if (next.id === chart.id) return;
    chart = next;
    progress = { selectedId: chart.id, tallies: progress.tallies };
    // A live spot's answer is chart-dependent, so carrying it across a selection would grade the
    // learner against a chart they were not looking at. Draw fresh and drop the feedback.
    spot = drawSpot(rng);
    feedback = null;
    persist();
    paint();
  }

  function commit(action: ChartAction): void {
    // Guard the action against the selected chart: a stray key that is not one this chart offers is
    // not an answer, and grading it would throw (gradeChartAnswer rejects an unoffered action).
    if (!chart.actions.includes(action)) return;
    const grade = gradeChartAnswer(chart, spot, action);
    progress = recordAnswer(progress, grade);
    feedback = {
      combo: grade.combo,
      chartLabel: chart.label,
      correct: grade.correct,
      chose: grade.chose,
      right: grade.right,
    };
    answered += 1;
    persist();
    // Feedback and the next prompt land in the same synchronous paint: no timer, so the learner sees
    // the verdict in the same frame as the keystroke (matches the Charts drill).
    spot = drawSpot(rng);
    paint();
  }

  /**
   * Keyed off `document` so a press works without the screen holding focus, and self-removing once the
   * root detaches: renderTab has no teardown hook, so the listener has to clean itself up or it
   * outlives every visit to this tab (mirrors charts.ts).
   */
  function onKey(event: KeyboardEvent): void {
    if (!root.isConnected) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    // A modifier-held press (Cmd+O, Ctrl+F, OS shortcuts) is not a drill answer.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toUpperCase();
    for (const action of chart.actions) {
      if (ACTION_KEY[action] === key) {
        commit(action);
        return;
      }
    }
  }
  document.addEventListener('keydown', onKey);

  function paint(): void {
    // The screen's sync oracle: every e2e wait keys off these, never a sleep.
    root.dataset.chart = chart.id;
    root.dataset.spot = spot;
    root.dataset.answered = String(answered);
    root.dataset.verdict = feedback === null ? '' : feedback.right ? 'right' : 'wrong';

    announcer.textContent = feedback === null ? '' : drillAnnouncement(feedback);

    root.replaceChildren(
      announcer,
      renderCatalog(chart, progress, selectChart),
      renderDetail(chart, spot, feedback, commit),
    );
  }

  paint();
  return root;
}

// ---------------------------------------------------------------------------
// Catalog (left pane)
// ---------------------------------------------------------------------------

function renderCatalog(
  active: PreflopChart,
  progress: ChartBankProgress,
  onSelect: (chart: PreflopChart) => void,
): HTMLElement {
  const panel = document.createElement('nav');
  panel.className = 'chart-catalog';
  panel.dataset.testid = 'chart-catalog';
  panel.setAttribute('aria-label', 'Preflop charts');

  const heading = document.createElement('h2');
  heading.className = 'catalog-title';
  heading.textContent = 'Chart bank';
  panel.appendChild(heading);

  for (const category of ['rfi', 'defense'] as const) {
    const group = document.createElement('div');
    group.className = 'catalog-group';
    group.dataset.category = category;

    const label = document.createElement('div');
    label.className = 'catalog-group-label';
    label.textContent = CATEGORY_LABEL[category];
    group.appendChild(label);

    for (const chart of CHART_BANK.filter((c) => c.category === category)) {
      group.appendChild(renderCatalogItem(chart, chart.id === active.id, progress, onSelect));
    }
    panel.appendChild(group);
  }

  return panel;
}

function renderCatalogItem(
  chart: PreflopChart,
  isActive: boolean,
  progress: ChartBankProgress,
  onSelect: (chart: PreflopChart) => void,
): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'catalog-item';
  button.dataset.testid = 'catalog-item';
  button.dataset.chart = chart.id;
  button.dataset.active = String(isActive);
  button.setAttribute('aria-pressed', String(isActive));

  const name = document.createElement('span');
  name.className = 'catalog-item-name';
  name.textContent = chart.label;
  button.appendChild(name);

  const width = document.createElement('span');
  width.className = 'catalog-item-width';
  width.textContent = `${Math.round(chartWidth(chart) * 100)}%`;
  button.appendChild(width);

  // The learner's running score on this chart, if they have drilled it. Zeroed charts show nothing —
  // a fresh bank stays bare rather than announcing "0/0" eleven times.
  const tally = progress.tallies[chart.id];
  if (tally && tally.attempts > 0) {
    const score = document.createElement('span');
    score.className = 'catalog-item-score';
    score.dataset.testid = 'catalog-item-score';
    score.dataset.chart = chart.id;
    score.dataset.attempts = String(tally.attempts);
    score.dataset.correct = String(tally.correct);
    score.textContent = `${tally.correct}/${tally.attempts}`;
    button.appendChild(score);
  }

  button.addEventListener('click', () => onSelect(chart));
  return button;
}

// ---------------------------------------------------------------------------
// Detail (right pane): header + grid + drill
// ---------------------------------------------------------------------------

function renderDetail(
  chart: PreflopChart,
  spot: Combo,
  feedback: DrillFeedback | null,
  onCommit: (action: ChartAction) => void,
): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'chart-detail';
  panel.dataset.testid = 'chart-detail';

  panel.appendChild(renderHeader(chart));
  panel.appendChild(renderGrid(chart, feedback?.combo ?? null));
  panel.appendChild(renderDrill(chart, spot, feedback, onCommit));

  return panel;
}

function renderHeader(chart: PreflopChart): HTMLElement {
  const header = document.createElement('div');
  header.className = 'chart-header';

  const title = document.createElement('h3');
  title.className = 'chart-title';
  title.dataset.testid = 'chart-title';
  title.textContent = chart.label;
  header.appendChild(title);

  const width = document.createElement('div');
  width.className = 'chart-width';
  width.dataset.testid = 'chart-width';
  const pct = document.createElement('span');
  pct.className = 'chart-width-value';
  pct.textContent = `${Math.round(chartWidth(chart) * 100)}%`;
  width.appendChild(pct);
  const caption = document.createElement('span');
  caption.className = 'stat-label';
  caption.textContent =
    chart.category === 'rfi' ? 'of hands open first in' : 'of hands continue (call or 3-bet)';
  width.appendChild(caption);
  header.appendChild(width);

  header.appendChild(renderLegend(chart));

  // These are teaching charts, said on screen — a standard published line, not a live solver claim.
  const source = document.createElement('p');
  source.className = 'chart-source';
  source.dataset.testid = 'chart-source';
  source.textContent =
    'Standard published 100bb 6-max ranges, purified to whole-in / whole-out cells. A teaching reference, not a live solve.';
  header.appendChild(source);

  return header;
}

function renderLegend(chart: PreflopChart): HTMLElement {
  const legend = document.createElement('ul');
  legend.className = 'chart-legend';
  legend.dataset.testid = 'chart-legend';

  for (const action of chart.actions) {
    const item = document.createElement('li');
    item.className = 'legend-item';
    item.dataset.action = action;
    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.dataset.action = action;
    item.appendChild(swatch);
    const text = document.createElement('span');
    text.textContent = ACTION_LABEL[action];
    item.appendChild(text);
    legend.appendChild(item);
  }
  return legend;
}

function renderGrid(chart: PreflopChart, revealed: Combo | null): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'chart-grid';
  grid.dataset.testid = 'chart-grid';

  // chartCells is in ALL_COMBOS order; the grid needs row/col placement, so map by combo.
  const actionOf = new Map<Combo, ChartAction>(chartCells(chart).map((c) => [c.combo, c.action]));

  for (const high of RANKS_DESC) {
    for (const low of RANKS_DESC) {
      const combo = comboAt(high, low);
      const el = document.createElement('div');
      el.className = 'chart-cell';
      el.dataset.testid = 'chart-cell';
      el.dataset.combo = combo;
      el.dataset.action = actionOf.get(combo) ?? correctAction(chart, combo);
      el.dataset.revealed = String(combo === revealed);
      el.textContent = combo;
      grid.appendChild(el);
    }
  }

  return grid;
}

/** Upper-right triangle suited, lower-left offsuit, pairs on the diagonal — the usual chart reading. */
function comboAt(rowRank: Rank, colRank: Rank): Combo {
  const row = RANKS.indexOf(rowRank);
  const col = RANKS.indexOf(colRank);
  if (row === col) return `${rowRank}${rowRank}`;
  return row > col ? `${rowRank}${colRank}s` : `${colRank}${rowRank}o`;
}

interface DrillFeedback {
  readonly combo: Combo;
  readonly chartLabel: string;
  readonly correct: ChartAction;
  readonly chose: ChartAction;
  readonly right: boolean;
}

function renderDrill(
  chart: PreflopChart,
  spot: Combo,
  feedback: DrillFeedback | null,
  onCommit: (action: ChartAction) => void,
): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'chart-drill';
  panel.dataset.testid = 'chart-drill';

  const prompt = document.createElement('div');
  prompt.className = 'drill-prompt';

  const hand = document.createElement('div');
  hand.className = 'drill-hand';
  hand.dataset.testid = 'drill-hand';
  hand.dataset.combo = spot;
  // Real cards, not the "AKs" notation: collapsing two cards to a cell is half the skill, and printing
  // the notation next to a grid labelled in notation would turn the drill into a lookup (matches charts.ts).
  for (const card of cardsFor(spot)) hand.appendChild(renderCard(card, { small: true }));
  prompt.appendChild(hand);

  const situation = document.createElement('div');
  situation.className = 'drill-situation';
  situation.dataset.testid = 'drill-situation';
  situation.textContent = chart.label;
  prompt.appendChild(situation);

  const keys = document.createElement('div');
  keys.className = 'drill-keys';
  for (const action of chart.actions) keys.appendChild(drillKey(action, onCommit));
  prompt.appendChild(keys);

  panel.appendChild(prompt);
  panel.appendChild(renderFeedback(feedback));

  return panel;
}

function drillKey(action: ChartAction, onCommit: (action: ChartAction) => void): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pill drill-key';
  button.dataset.testid = `drill-${action}`;
  button.dataset.action = action;
  button.textContent = `${ACTION_KEY[action]} ${ACTION_LABEL[action]}`;
  button.addEventListener('click', () => onCommit(action));
  return button;
}

function renderFeedback(feedback: DrillFeedback | null): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'drill-feedback';
  wrap.dataset.testid = 'drill-feedback';

  if (feedback === null) {
    wrap.dataset.verdict = 'none';
    wrap.textContent = 'Choose an action. The answer is not on screen until you commit.';
    return wrap;
  }

  wrap.dataset.verdict = feedback.right ? 'right' : 'wrong';
  wrap.dataset.combo = feedback.combo;

  // "Last" is load-bearing: the verdict is about the PREVIOUS spot while the next hand is already dealt
  // above it, so unlabelled it reads as a verdict on the cards on screen (matches charts.ts).
  const when = document.createElement('span');
  when.className = 'drill-when';
  when.textContent = 'last';
  wrap.appendChild(when);

  const line = document.createElement('span');
  line.className = 'drill-verdict';
  line.dataset.testid = 'drill-verdict';
  line.textContent = feedback.right
    ? `${feedback.combo} — ${ACTION_LABEL[feedback.correct]}`
    : `${feedback.combo} is ${ACTION_LABEL[feedback.correct]}, not ${ACTION_LABEL[feedback.chose]}`;
  wrap.appendChild(line);

  return wrap;
}

function drillAnnouncement(feedback: DrillFeedback): string {
  return feedback.right
    ? `last ${feedback.combo} ${ACTION_LABEL[feedback.correct]}`
    : `last ${feedback.combo} is ${ACTION_LABEL[feedback.correct]}, not ${ACTION_LABEL[feedback.chose]}`;
}

// ---------------------------------------------------------------------------
// Sampling helpers
// ---------------------------------------------------------------------------

/** One uniform draw over the 169 cells. Uniform per CELL (not combo-weighted) so every chart square recurs. */
function drawSpot(rng: Rng): Combo {
  return ALL_COMBOS[Math.floor(rng() * ALL_COMBOS.length)];
}

/** Two concrete cards for a combo. Suits fixed, so the same spot always looks the same (matches charts.ts). */
function cardsFor(combo: Combo): Card[] {
  const suited = combo.endsWith('s');
  return [`${combo[0]}s`, `${combo[1]}${suited ? 's' : 'h'}`];
}
