import type { SessionState } from '../../core/session.js';
import { computeStats } from '../../core/session.js';
import { calibrationLine } from '../../core/predict.js';
import { describeGift, type GiftEntry } from '../../core/giftLedger.js';

/** How many gifts to list; the rest are summarised in the count. Newest are the most useful. */
const GIFT_DISPLAY_CAP = 12;

const SVG_NS = 'http://www.w3.org/2000/svg';
const GRAPH_WIDTH = 320;
const GRAPH_HEIGHT = 120;
const GRAPH_PAD = 6;

export function renderProfile(opts: {
  session: SessionState;
  onOpenReview?: () => void;
}): HTMLElement {
  const summary = computeStats(opts.session);

  const root = document.createElement('div');
  root.className = 'profile-screen';
  root.dataset.testid = 'profile-screen';

  root.appendChild(
    section(
      'Session',
      renderGraph(bankrollSeries(opts.session), summary.handsPlayed, opts.onOpenReview),
    ),
  );
  root.appendChild(section('Rebuys', renderRebuys(opts.session.rebuys)));
  root.appendChild(section('Prediction calibration', renderCalibration(opts.session)));

  // The one section allowed to give up height when the column is taller than the window: its list
  // scrolls itself, so the Lifetime counters below stay above the fold. See styles-screens.css.
  const leaks = section('Leaks by concept', renderLeaks(summary.leaks));
  leaks.classList.add('profile-leaks');
  root.appendChild(leaks);

  // The gift section shares the column's one block of flexible height with the leak list (both are
  // variable-length signal lists that shrink-and-scroll). When there are no gifts yet it is omitted
  // rather than shown as an empty slab: the column at the 900x640 minimum is tuned to the pixel and
  // has no room for a sixth always-present section, and "nothing observed" is already the honest
  // reading of its absence. It appears the moment the first gift is recorded.
  if (opts.session.gifts.length > 0) {
    const gifts = section('Gifts received', renderGifts(opts.session.gifts));
    gifts.classList.add('profile-gifts');
    root.appendChild(gifts);
  }

  root.appendChild(
    section(
      'Lifetime',
      renderCounters([
        { label: 'Hands', value: String(summary.handsPlayed) },
        { label: 'VPIP', value: `${summary.vpip.toFixed(0)}%` },
        { label: 'PFR', value: `${summary.pfr.toFixed(0)}%` },
        { label: 'EV lost', value: `${summary.evLossBb.toFixed(1)} bb` },
      ]),
    ),
  );

  return root;
}

/**
 * The way into hand review, sharing the graph's caption row rather than taking a row of its own.
 * Measured: this column has 574px to spend at the documented 900x640 minimum and only ~33px of
 * headroom before the leak list — the one section allowed to shrink — drops below one 42.5px row and
 * its last concept becomes unreachable. A 53.5px card here cost exactly that.
 *
 * Never disabled and never hidden with an empty log (N1): the picker shows its own empty state,
 * which explains where hands come from. A missing or dead control would read as a locked feature.
 */
function renderReviewEntry(onOpenReview: () => void): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'profile-review-entry';
  button.dataset.testid = 'open-review';
  button.textContent = 'Review a hand →';
  button.addEventListener('click', onOpenReview);
  return button;
}

function section(label: string, body: HTMLElement): HTMLElement {
  const el = document.createElement('section');
  el.className = 'profile-section';

  const heading = document.createElement('div');
  heading.className = 'stat-label';
  heading.textContent = label;
  el.appendChild(heading);
  el.appendChild(body);

  return el;
}

/**
 * Bankroll after each logged hand, reconstructed backwards from the current bankroll
 * so the last point always equals the number shown on Home. Length is hands + 1
 * (the starting bankroll is the first point).
 */
function bankrollSeries(session: SessionState): number[] {
  const series = [session.bankroll];
  for (let i = session.hands.length - 1; i >= 0; i--) {
    series.unshift(series[0] - session.hands[i].net);
  }
  return series;
}

function renderGraph(
  series: number[],
  handsPlayed: number,
  onOpenReview?: () => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'graph-wrap';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.dataset.testid = 'session-graph';
  svg.setAttribute('class', 'session-graph');
  svg.setAttribute('viewBox', `0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Bankroll over hands played');

  const polyline = document.createElementNS(SVG_NS, 'polyline');
  polyline.setAttribute('class', 'session-graph-line');
  polyline.setAttribute('points', graphPoints(series));
  svg.appendChild(polyline);

  wrap.appendChild(svg);

  // The caption keeps its own element and its own exact text; the review entry sits beside it rather
  // than inside it, because screens.spec.ts pins that string character for character.
  const footer = document.createElement('div');
  footer.className = 'graph-footer';

  const caption = document.createElement('div');
  caption.className = 'graph-caption';
  caption.dataset.testid = 'graph-caption';
  caption.textContent = graphCaption(series.length - 1, handsPlayed);
  footer.appendChild(caption);

  if (onOpenReview) footer.appendChild(renderReviewEntry(onOpenReview));
  wrap.appendChild(footer);

  return wrap;
}

/**
 * The graph plots the stored hand log, which session.ts caps at MAX_HAND_LOG while `handsPlayed`
 * keeps climbing. Past the cap the screen shows two different hand counts, so say which is which:
 * unlabelled, the smaller number reads as lost progress rather than as a window over the total.
 */
function graphCaption(logged: number, handsPlayed: number): string {
  if (logged === 0) return 'No hands played yet';
  const plural = `${logged} hand${logged === 1 ? '' : 's'}`;
  // Below the cap the two counts agree, and saying so twice would just add noise.
  return logged >= handsPlayed ? plural : `Last ${plural} of ${handsPlayed} played`;
}

/** A single value becomes a flat line: honest, and never an empty `points` attribute. */
function graphPoints(series: number[]): string {
  const values = series.length === 1 ? [series[0], series[0]] : series;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const usableHeight = GRAPH_HEIGHT - GRAPH_PAD * 2;

  return values
    .map((value, i) => {
      const x = (i / (values.length - 1)) * GRAPH_WIDTH;
      const ratio = span === 0 ? 0.5 : (value - min) / span;
      const y = GRAPH_HEIGHT - GRAPH_PAD - ratio * usableHeight;
      return `${round(x)},${round(y)}`;
    })
    .join(' ');
}

const round = (n: number): string => n.toFixed(1);

/**
 * Deliberately not a `.counter` in the Lifetime grid: that grid's exact key set is pinned by
 * screens.spec.ts, and a rebuy is a bankroll event rather than a play statistic.
 */
function renderRebuys(rebuys: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'rebuy-summary';

  const value = document.createElement('div');
  value.className = 'stat-value';
  value.dataset.testid = 'rebuy-count';
  value.textContent = String(rebuys);
  wrap.appendChild(value);

  const caption = document.createElement('div');
  caption.className = 'graph-caption';
  caption.dataset.testid = 'rebuy-caption';
  caption.textContent =
    rebuys === 0 ? 'No rebuys' : `${rebuys} rebuy${rebuys === 1 ? '' : 's'} this session`;
  wrap.appendChild(caption);

  return wrap;
}

/**
 * Not a `.counter` and not a `.graph-caption`: screens.spec.ts pins the exact key set of the
 * Lifetime counter grid and reads the first `.graph-caption` on the page, and prediction accuracy
 * is neither a lifetime play statistic nor a chart label.
 */
function renderCalibration(session: SessionState): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'calibration';
  wrap.dataset.testid = 'calibration';
  wrap.dataset.total = String(session.calibration.total);
  wrap.dataset.correct = String(session.calibration.correct);
  wrap.dataset.sureWrong = String(session.calibration.sureWrong);
  wrap.textContent = calibrationLine(session.calibration);
  return wrap;
}

function renderLeaks(leaks: { principle: string; count: number; costBb: number }[]): HTMLElement {
  const list = document.createElement('ol');
  list.className = 'leak-list';
  list.dataset.testid = 'leak-list';

  if (leaks.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'leak-empty';
    empty.textContent = 'No leaks flagged yet.';
    list.appendChild(empty);
    return list;
  }

  const worst = Math.max(leaks[0].costBb, 0.001);
  for (const leak of leaks) {
    const item = document.createElement('li');
    item.className = 'list-row leak-row';
    item.dataset.testid = 'leak-row';
    item.dataset.principle = leak.principle;

    const name = document.createElement('span');
    name.className = 'leak-principle';
    name.textContent = leak.principle;
    item.appendChild(name);

    const bar = document.createElement('span');
    bar.className = 'leak-bar';
    bar.style.width = `${Math.min(100, (leak.costBb / worst) * 100)}%`;
    const track = document.createElement('span');
    track.className = 'leak-track';
    track.appendChild(bar);
    item.appendChild(track);

    const cost = document.createElement('span');
    cost.className = 'leak-count';
    cost.dataset.testid = 'leak-cost';
    // Cost first: it is what ranks the list and what the student should study next.
    cost.textContent = `${leak.costBb.toFixed(1)} bb · ${leak.count}×`;
    item.appendChild(cost);

    list.appendChild(item);
  }

  return list;
}

/**
 * O5/story 34: the -EV villain calls the learner OBSERVED at showdown, in action-with-a-holding
 * form. Every line is `describeGift`'s sentence — the module owns the wording, so the screen never
 * reassembles the price from parts. Newest first, since a recent gift is the most instructive; the
 * total chips handed over is summarised so the ledger's magnitude is visible without scrolling.
 */
function renderGifts(gifts: readonly GiftEntry[]): HTMLElement {
  const list = document.createElement('ol');
  list.className = 'gift-list';
  list.dataset.testid = 'gift-list';

  if (gifts.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'gift-empty';
    empty.dataset.testid = 'gift-empty';
    empty.textContent = 'No gifts observed yet — they appear when an opponent shows down a losing call.';
    list.appendChild(empty);
    return list;
  }

  const totalChips = gifts.reduce((sum, g) => sum + g.giftChips, 0);
  const total = document.createElement('li');
  total.className = 'gift-total';
  total.dataset.testid = 'gift-total';
  total.textContent = `${gifts.length} observed · ${totalChips} chips handed over`;
  list.appendChild(total);

  // Newest first; only the most recent are drawn, the rest live in the count above.
  for (const gift of [...gifts].reverse().slice(0, GIFT_DISPLAY_CAP)) {
    const item = document.createElement('li');
    item.className = 'list-row gift-row';
    item.dataset.testid = 'gift-row';
    item.dataset.seat = String(gift.villainSeatId);
    item.textContent = describeGift(gift);
    list.appendChild(item);
  }

  return list;
}

function renderCounters(counters: { label: string; value: string }[]): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'counter-grid';

  for (const counter of counters) {
    const cell = document.createElement('div');
    cell.className = 'counter';

    const value = document.createElement('div');
    value.className = 'stat-value';
    value.textContent = counter.value;
    cell.appendChild(value);

    const label = document.createElement('div');
    label.className = 'stat-label';
    label.textContent = counter.label;
    cell.appendChild(label);

    grid.appendChild(cell);
  }

  return grid;
}
