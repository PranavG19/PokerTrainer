import type { SessionState } from '../../core/session.js';
import { computeStats } from '../../core/session.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const GRAPH_WIDTH = 320;
const GRAPH_HEIGHT = 120;
const GRAPH_PAD = 6;

export function renderProfile(opts: { session: SessionState }): HTMLElement {
  const summary = computeStats(opts.session);

  const root = document.createElement('div');
  root.className = 'profile-screen';
  root.dataset.testid = 'profile-screen';

  root.appendChild(section('Session', renderGraph(bankrollSeries(opts.session))));
  root.appendChild(section('Leaks by concept', renderLeaks(summary.leaks)));
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

function renderGraph(series: number[]): HTMLElement {
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

  const caption = document.createElement('div');
  caption.className = 'graph-caption';
  const hands = series.length - 1;
  caption.textContent = hands === 0 ? 'No hands played yet' : `${hands} hand${hands === 1 ? '' : 's'}`;
  wrap.appendChild(caption);

  return wrap;
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

function renderLeaks(leaks: { principle: string; count: number }[]): HTMLElement {
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

  const worst = leaks[0].count;
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
    bar.style.width = `${(leak.count / worst) * 100}%`;
    const track = document.createElement('span');
    track.className = 'leak-track';
    track.appendChild(bar);
    item.appendChild(track);

    const count = document.createElement('span');
    count.className = 'leak-count';
    count.textContent = String(leak.count);
    item.appendChild(count);

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
