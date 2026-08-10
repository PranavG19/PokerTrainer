import '../styles-robustness.css';

import { renderCard } from '../components/card.js';
import {
  CONTINUATIONS,
  CONTINUATION_LABELS,
  HEURISTIC_DISCLAIMER,
  robustnessDrill,
  type ContinuationOutcome,
  type RobustnessInput,
  type RobustnessReport,
} from '../../core/robustness.js';

/**
 * THE ROBUSTNESS DRILL — PRODUCT-SPEC O7.
 *
 * A PURE READER over src/core/robustness.ts. Every number, every continuation name, every verdict
 * and the disclaimer come back out of robustnessDrill / CONTINUATION_LABELS / HEURISTIC_DISCLAIMER;
 * this file holds no poker model, no EV formula and no threshold of its own. What it does hold is
 * the SPOTS — the hole cards, board, pot and line of five already-revealed decisions — because core
 * has no spot generator and a graded spot is data, not a computation.
 *
 * WHY A SURFACE OF ITS OWN. O7 places the drill "on a graded spot, after reveal", which is the
 * Table's post-decision moment. The Table is the single most contended file in the app and the
 * drill needs a hero line, a pot, a board and four columns of room; bolting it onto the coach panel
 * would mean rewriting a screen other work is live in. A tab of revealed spots reproduces the same
 * exercise deterministically — the cards are face up, which IS the reveal — and can be pinned by
 * e2e without playing a hand to a specific river. When the Table's reveal grows a slot, the same
 * report renderer moves into it unchanged.
 *
 * THREE THINGS THE SCREEN MUST NOT DO, all of them warned about in core's own header:
 *
 * IT MAY NOT READ `robust` AS `good`. Core's verdict is about the SPREAD across the four
 * continuations and nothing else — a line that loses a little against all four is `robust` and still
 * a bad call, and the coach is what says so. So the scope note is on screen in every state, and the
 * profit clause of the reason states how many of the four the line actually beats.
 *
 * IT MAY NOT PRESENT THE SPREAD AS A BOUND. Four hand-picked tilts are not a best response. The
 * heuristic label is rendered from core's own HEURISTIC_DISCLAIMER plus one line naming it a
 * heuristic, and it is part of the frame rather than a footnote that can be scrolled away.
 *
 * THE VERDICT IS NEVER A BARE WORD. "Leak" alone teaches nothing; "best against fold-biased only,
 * and it swings 7.9 bb by the time you reach a raise-biased one" is the lesson. The reason sentence
 * is assembled from core's `best`, `worst`, `profitableAgainst` and `spreadBb` — so it cannot say
 * something the report does not.
 *
 * No timer and no key listener, so no destroy handle: the screen is a function of the selected spot.
 */

interface Spot {
  readonly id: string;
  readonly title: string;
  /** Restates the fixture — the action and the cards, never a claim about how it fares. */
  readonly action: string;
  readonly input: RobustnessInput;
}

/**
 * Five revealed spots, one per verdict core can return plus the two shapes O7 names by hand: a line
 * good against exactly one continuation, and a line fine against all four. Seeds are fixed because
 * the equity underneath is a seeded Monte Carlo estimate and a drill that reads differently on each
 * visit cannot be checked by anyone, learner or test.
 */
const SPOTS: readonly Spot[] = [
  {
    id: 'pot-bet-air',
    title: 'Full-pot bet with nothing',
    action: 'You bet the whole pot holding 7-2 offsuit on A-K-Q-J-9.',
    input: {
      hole: ['7c', '2d'],
      board: ['Ah', 'Kh', 'Qs', 'Js', '9d'],
      pot: 100,
      toCall: 0,
      line: 'bet',
      betSize: 100,
      bb: 10,
      seed: 3,
    },
  },
  {
    id: 'half-pot-bluff',
    title: 'Half-pot bet with the same nothing',
    action: 'You bet half the pot holding 7-2 offsuit on A-K-Q-J-9.',
    input: {
      hole: ['7c', '2d'],
      board: ['Ah', 'Kh', 'Qs', 'Js', '9d'],
      pot: 100,
      toCall: 0,
      line: 'bet',
      betSize: 50,
      bb: 10,
      seed: 3,
    },
  },
  {
    id: 'check-top-pair',
    title: 'Top pair checked back',
    action: 'You check holding K-Q on K-7-2-9-3.',
    input: {
      hole: ['Kd', 'Qd'],
      board: ['Kh', '7s', '2c', '9d', '3h'],
      pot: 100,
      toCall: 0,
      line: 'check',
      bb: 10,
      seed: 3,
    },
  },
  {
    id: 'call-drawing-dead',
    title: 'Call with a hand that plays the board',
    action: 'You call a pot-sized bet holding 2-3 on A-A-A-A-K.',
    input: {
      hole: ['2c', '3d'],
      board: ['Ah', 'Ad', 'As', 'Ac', 'Kd'],
      pot: 100,
      toCall: 100,
      line: 'call',
      bb: 10,
      seed: 4,
    },
  },
  {
    id: 'fold-to-a-bet',
    title: 'Fold to a bet',
    action: 'You fold 7-2 offsuit on A-K-Q-J-9 facing 60 into 120.',
    input: {
      hole: ['7c', '2d'],
      board: ['Ah', 'Kh', 'Qs', 'Js', '9d'],
      pot: 120,
      toCall: 60,
      line: 'fold',
      bb: 10,
      seed: 3,
    },
  },
];

const VERDICT_HEADLINE: Record<RobustnessReport['verdict'], string> = {
  robust: 'Robust',
  mixed: 'Mixed',
  leak: 'Leak',
  'no-continuation': 'No continuation',
};

/**
 * Said in every state, because core's verdict is narrower than the word "robust" sounds and a
 * learner who reads it as "good line" has learned the opposite of O7.
 */
const SCOPE_NOTE =
  'Robust means the four continuations agree about this line, not that the line makes money — whether it does is the coach\'s verdict, not this one.';

/** O7: "labelled a heuristic, never a bound". The label is the frame, not a footnote. */
const HEURISTIC_LABEL =
  'This is a heuristic, not a bound: nothing here limits how much a line can lose.';

export function renderRobustnessScreen(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'robust-screen';
  root.dataset.testid = 'robust-screen';

  let spot: Spot = SPOTS[0];

  function selectSpot(next: Spot): void {
    if (next.id === spot.id) return;
    spot = next;
    paint();
  }

  function paint(): void {
    const report = robustnessDrill(spot.input);

    // The screen's sync oracle: every e2e wait keys off these, never a sleep.
    root.dataset.spot = spot.id;
    root.dataset.verdict = report.verdict;
    root.dataset.profitable = String(report.profitableAgainst);
    root.dataset.best = report.best;
    root.dataset.worst = report.worst;

    root.replaceChildren(
      renderSpotList(spot, selectSpot),
      renderReport(spot, report),
    );
  }

  paint();
  return root;
}

// ---------------------------------------------------------------------------
// Sidebar: which revealed spot is being stress-tested
// ---------------------------------------------------------------------------

function renderSpotList(current: Spot, onSelect: (spot: Spot) => void): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'robust-side';
  panel.dataset.testid = 'robust-side';

  panel.appendChild(text('div', 'stat-label', 'Revealed spots'));

  for (const candidate of SPOTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'robust-spot-btn';
    button.dataset.testid = 'robust-spot-btn';
    button.dataset.spot = candidate.id;
    button.dataset.active = String(candidate.id === current.id);
    button.textContent = candidate.title;
    button.addEventListener('click', () => onSelect(candidate));
    panel.appendChild(button);
  }

  panel.appendChild(
    text(
      'p',
      'robust-note',
      'The four continuations are re-weightings of the same opponent frequencies, not four new solves.',
    ),
  );

  return panel;
}

// ---------------------------------------------------------------------------
// The report: the spot, four continuations, the verdict and its reason
// ---------------------------------------------------------------------------

function renderReport(spot: Spot, report: RobustnessReport): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'robust-work';
  panel.dataset.testid = 'robust-work';

  panel.appendChild(renderSpot(spot));
  panel.appendChild(renderContinuations(report));
  panel.appendChild(renderVerdict(report));
  panel.appendChild(renderHeuristic());

  return panel;
}

function renderSpot(spot: Spot): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'robust-spot';
  wrap.dataset.testid = 'robust-spot';

  const cards = document.createElement('div');
  cards.className = 'robust-cards';
  for (const card of spot.input.hole) cards.appendChild(renderCard(card, { small: true }));
  const gap = document.createElement('span');
  gap.className = 'robust-card-gap';
  cards.appendChild(gap);
  for (const card of spot.input.board) cards.appendChild(renderCard(card, { small: true }));
  wrap.appendChild(cards);

  const action = text('p', 'robust-action', spot.action);
  action.dataset.testid = 'robust-action';
  wrap.appendChild(action);

  // Chips as given, and the big blind beside them: the four results are quoted in bb, so the unit
  // has to be on screen rather than inferred.
  const chips = text(
    'p',
    'robust-chips',
    `Pot ${spot.input.pot} chips · to call ${spot.input.toCall} · big blind ${spot.input.bb}`,
  );
  chips.dataset.testid = 'robust-chips';
  wrap.appendChild(chips);

  return wrap;
}

/** All four, in core's CONTINUATIONS order, each named and each with this line's result. */
function renderContinuations(report: RobustnessReport): HTMLElement {
  const row = document.createElement('div');
  row.className = 'robust-columns';
  row.dataset.testid = 'robust-columns';

  for (const outcome of report.outcomes) {
    row.appendChild(renderContinuation(outcome, report));
  }

  return row;
}

function renderContinuation(outcome: ContinuationOutcome, report: RobustnessReport): HTMLElement {
  const cell = document.createElement('div');
  cell.className = 'robust-column';
  cell.dataset.testid = 'robust-column';
  cell.dataset.continuation = outcome.id;
  cell.dataset.profit = String(outcome.evBb > 0);
  cell.dataset.extreme =
    outcome.id === report.best ? 'best' : outcome.id === report.worst ? 'worst' : '';

  const name = text('div', 'robust-column-name', outcome.label);
  name.dataset.testid = 'robust-column-name';
  cell.appendChild(name);

  const value = text('div', 'robust-column-ev', `${bb(outcome.evBb)} bb`);
  value.dataset.testid = 'robust-column-ev';
  cell.appendChild(value);

  cell.appendChild(text('div', 'stat-label', 'this line, against them'));

  // The re-weighting itself, so "not a new tree" is visible rather than asserted: these three are
  // core's response distribution for this continuation.
  const weights = text(
    'div',
    'robust-column-weights',
    `folds ${pct(outcome.weights.fold)} · calls ${pct(outcome.weights.call)} · raises ${pct(outcome.weights.raise)}`,
  );
  weights.dataset.testid = 'robust-column-weights';
  cell.appendChild(weights);

  return cell;
}

function renderVerdict(report: RobustnessReport): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'robust-verdict';
  wrap.dataset.testid = 'robust-verdict';
  wrap.dataset.verdict = report.verdict;

  const headline = text('div', 'robust-verdict-word', VERDICT_HEADLINE[report.verdict]);
  headline.dataset.testid = 'robust-verdict-word';
  wrap.appendChild(headline);

  const because = text('p', 'robust-verdict-reason', reason(report));
  because.dataset.testid = 'robust-verdict-reason';
  wrap.appendChild(because);

  const spread = text(
    'div',
    'robust-spread',
    `${magnitude(report.spreadBb)} bb · ${pct(report.spreadPotFraction)} of the pot`,
  );
  spread.dataset.testid = 'robust-spread';
  wrap.appendChild(spread);
  wrap.appendChild(text('div', 'stat-label', 'widest gap between the four'));

  // Core's own comment, when it has one. Null on a robust line and on a fold — G3 silence, so
  // nothing is printed in its place and no praise is invented to fill the gap.
  if (report.message !== null) {
    const message = text('p', 'robust-message', report.message);
    message.dataset.testid = 'robust-message';
    wrap.appendChild(message);
  }

  const scope = text('p', 'robust-scope', SCOPE_NOTE);
  scope.dataset.testid = 'robust-scope';
  wrap.appendChild(scope);

  return wrap;
}

/**
 * The verdict's reason, assembled only out of report fields: how many of the four the line beats,
 * which one it does best against, and the size of the swing to the worst one. A bare "Leak" is what
 * this exists to prevent.
 */
function reason(report: RobustnessReport): string {
  const bestLabel = label(report.best);
  const worstLabel = label(report.worst);

  if (report.verdict === 'no-continuation') {
    return 'A fold ends the hand, so all four continuations are identical and there is nothing here for an opponent to lean against.';
  }

  const swing = `It swings ${magnitude(report.spreadBb)} bb, ${pct(report.spreadPotFraction)} of the pot, between a ${bestLabel} opponent and a ${worstLabel} one.`;
  return `${profitClause(report, bestLabel)}. ${swing}`;
}

function profitClause(report: RobustnessReport, bestLabel: string): string {
  const total = CONTINUATIONS.length;
  if (report.profitableAgainst === total) return `This line shows a profit against all ${total}`;
  if (report.profitableAgainst === 0) {
    return `This line loses against all ${total}, and loses least against a ${bestLabel} opponent`;
  }
  if (report.profitableAgainst === 1) {
    return `This line shows a profit against a ${bestLabel} opponent only, and loses against the other ${total - 1}`;
  }
  return `This line shows a profit against ${report.profitableAgainst} of the ${total}, best against a ${bestLabel} opponent`;
}

function renderHeuristic(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'robust-heuristic';
  wrap.dataset.testid = 'robust-heuristic';
  wrap.appendChild(text('div', 'robust-heuristic-label', HEURISTIC_LABEL));
  wrap.appendChild(text('p', 'robust-heuristic-body', HEURISTIC_DISCLAIMER));
  return wrap;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function label(id: RobustnessReport['best']): string {
  return CONTINUATION_LABELS[id].toLowerCase();
}

/** One decimal, signed: whether a column made money is the first thing read off it. */
function bb(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded > 0 ? `+${rounded.toFixed(1)}` : rounded.toFixed(1);
}

/** A spread is a distance between two results, so it carries no sign. */
function magnitude(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function text(tag: string, className: string, content: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = content;
  return el;
}
