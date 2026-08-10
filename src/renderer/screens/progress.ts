import '../styles-progress.css';

import {
  RESULTS_GRAPH_MIN_HANDS,
  WEEKLY_DECISION_TARGET,
  WIN_RATE_MIN_HANDS,
  bannedPhrasingIn,
  computeMetrics,
  formatTagAggregate,
  kcBars,
  resultsGraph,
  tagAggregates,
  type KcBar,
  type Metric,
  type ProgressInput,
  type ProgressMetrics,
  type ResultsGraph,
  type WinRateMetric,
} from '../../core/progress.js';

/**
 * THE PROGRESS SURFACE — PRODUCT-SPEC N5's fifth surface, over src/core/progress.ts. P1, P2, P3, P5.
 *
 * A PURE READER. Every number, every caption, every refusal string comes out of core: computeMetrics,
 * kcBars, resultsGraph, tagAggregates, formatTagAggregate. This file holds no arithmetic and no
 * threshold of its own, which matters more here than on most screens because progress numbers are the
 * ones a learner will believe hardest. A figure computed twice — once in core for the test, once in the
 * renderer for the screen — is a figure that can disagree with itself.
 *
 * WHAT THIS SCREEN REFUSES TO DO IS THE POINT.
 *
 *   P1: FIVE numbers and only five, and the fifth is WITHHELD below 2,000 hands. `computeMetrics`
 *   returns `winRateVsBots` as an absent key rather than a zero, so the screen renders the withholding
 *   explicitly — "not shown yet, and why" — instead of a 0.0 bb/100 that reads as a verdict.
 *
 *   P3: NO results graph under 10,000 hands. `resultsGraph` returns a refusal carrying the reason and
 *   a route to the variance module. An empty or short chart is worse than no chart: it reads as a
 *   statement about the player when it is a statement about the sample.
 *
 *   P5 gate B: a FROZEN kc is routed to a worked example and never to another rep, and core's own
 *   caption says so. The screen prints core's caption rather than composing its own, so that promise
 *   cannot drift.
 *
 * THE BANNED-PHRASING GUARD RUNS ON THIS SCREEN'S OWN OUTPUT. core exports `bannedPhrasingIn` and the
 * list it checks — streaks, ranks, percentiles, XP, and trait attribution (G7: a tag describes a
 * decision; an adjective describes a person and cannot be practised). Every string this file renders
 * goes through it, so a well-meaning caption cannot smuggle gamification onto the one screen whose
 * subject is the learner's own progress. A violation is rendered as a visible fault rather than
 * silently swallowed, because a guard that fails quietly is not a guard.
 */

/** Every string that reaches the DOM passes through here first. */
function guarded(text: string): string {
  const violation = bannedPhrasingIn(text);
  if (violation === null) return text;
  // Deliberately loud and deliberately not a throw: a phrasing slip must be visible in a test and in
  // a screenshot, but it must not take the surface down and hide every honest number beside it.
  return `[BANNED PHRASING "${violation}"] ${text}`;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = guarded(text);
  return node;
}

/** Numbers are formatted here and nowhere else, so the same value never renders two ways. */
function shown(metric: Metric | WinRateMetric): string {
  if (metric.unit === 'bb/100') return `${metric.value.toFixed(2)} bb/100`;
  if (metric.unit === 'categories') return String(metric.value);
  return String(metric.value);
}

/**
 * P1's four ungated numbers. Each carries its SAMPLE, because a value computed from nothing is not a
 * measurement and the screen must not let it look like one.
 */
function renderMetric(metric: Metric): HTMLElement {
  const card = el('div', 'progress-metric');
  card.dataset.testid = 'progress-metric';
  card.dataset.metric = metric.key;
  card.dataset.value = String(metric.value);
  card.dataset.sample = String(metric.sample);

  const value = el('div', 'progress-metric-value', shown(metric));
  value.dataset.testid = 'metric-value';
  card.appendChild(value);

  const label = el('div', 'stat-label', metric.label);
  label.dataset.testid = 'metric-label';
  card.appendChild(label);

  /*
   * ONLY EFFORT GETS A TARGET, and core enforces that by carrying null everywhere else. P1 permits a
   * target on graded decisions because effort is the one thing a learner controls directly; a target on
   * EV loss would be a target on an outcome, which is the feedback law this whole app exists to respect.
   */
  if (metric.target !== null) {
    const target = el('div', 'progress-metric-target', `target ${metric.target}`);
    target.dataset.testid = 'metric-target';
    card.appendChild(target);
  }

  // Sample size, always. Zero is stated rather than disguised.
  const sample = el(
    'div',
    'progress-metric-sample',
    metric.sample === 0 ? 'no decisions recorded yet' : `from ${metric.sample} record${metric.sample === 1 ? '' : 's'}`,
  );
  sample.dataset.testid = 'metric-sample';
  card.appendChild(sample);

  return card;
}

/**
 * P1's gated fifth number, in both of its states.
 *
 * The withheld state is the interesting one: it says what is missing and how much, because "win rate:
 * —" invites the reader to assume the app is broken, while a 0.0 invites them to assume they break
 * even. Neither is true, and the honest third option is to name the gate.
 */
function renderWinRate(metric: WinRateMetric | undefined, handsSoFar: number): HTMLElement {
  const card = el('div', 'progress-metric progress-winrate');
  card.dataset.testid = 'progress-metric';
  card.dataset.metric = 'winRateVsBots';

  if (metric === undefined) {
    card.dataset.withheld = 'true';
    const value = el('div', 'progress-metric-value', 'not shown yet');
    value.dataset.testid = 'metric-value';
    card.appendChild(value);

    const label = el('div', 'stat-label', 'win rate vs the bot population');
    label.dataset.testid = 'metric-label';
    card.appendChild(label);

    const why = el(
      'div',
      'progress-metric-sample',
      `${handsSoFar} of ${WIN_RATE_MIN_HANDS} hands against one fixed bot config — below that the number says more about the sample than about the play`,
    );
    why.dataset.testid = 'metric-withheld-reason';
    card.appendChild(why);
    return card;
  }

  card.dataset.withheld = 'false';
  card.dataset.value = String(metric.value);
  card.dataset.sample = String(metric.sample);

  /*
   * THE BAND, NOT THE MIDPOINT, and the band is the value the eye should land on. Core's own note says
   * to read it that way, so the interval is rendered as the headline and the mean sits inside it.
   */
  const value = el(
    'div',
    'progress-metric-value',
    `${metric.ciLowerBb100.toFixed(1)} to ${metric.ciUpperBb100.toFixed(1)} bb/100`,
  );
  value.dataset.testid = 'metric-value';
  card.appendChild(value);

  const label = el('div', 'stat-label', metric.label);
  label.dataset.testid = 'metric-label';
  card.appendChild(label);

  const mid = el('div', 'progress-metric-target', `midpoint ${metric.value.toFixed(2)} bb/100`);
  mid.dataset.testid = 'metric-midpoint';
  card.appendChild(mid);

  // Core's wording, verbatim: "an instrument, not a promise".
  const note = el('div', 'progress-metric-sample', metric.note);
  note.dataset.testid = 'metric-note';
  card.appendChild(note);

  return card;
}

/** P2: the per-KC bars, the primary surface. Every caption is core's. */
function renderKcBar(bar: KcBar): HTMLElement {
  const row = el('div', 'kc-row');
  row.dataset.testid = 'kc-row';
  row.dataset.kc = bar.id;
  row.dataset.status = bar.status;
  row.dataset.fill = bar.fill.toFixed(4);

  const label = el('div', 'kc-label', bar.label);
  label.dataset.testid = 'kc-label';
  row.appendChild(label);

  const track = el('div', 'kc-track');
  track.dataset.testid = 'kc-track';
  const fill = el('span', 'kc-fill');
  fill.dataset.testid = 'kc-fill';
  // The bar is the posterior; the CI is drawn as a separate marker so the two are not confused.
  fill.style.width = `${(bar.fill * 100).toFixed(2)}%`;
  track.appendChild(fill);
  const ci = el('span', 'kc-ci');
  ci.dataset.testid = 'kc-ci';
  ci.style.left = `${(bar.ciLower * 100).toFixed(2)}%`;
  ci.style.width = `${Math.max(0, (bar.ciUpper - bar.ciLower) * 100).toFixed(2)}%`;
  track.appendChild(ci);
  row.appendChild(track);

  const caption = el('div', 'kc-caption', bar.caption);
  caption.dataset.testid = 'kc-caption';
  row.appendChild(caption);

  return row;
}

/**
 * P3, both branches. The refusal is a first-class rendering with its route out, not a hidden section:
 * a learner who wants a graph deserves to know why there isn't one and where the honest treatment of
 * variance lives.
 */
function renderResultsGraph(graph: ResultsGraph, onOpenVariance?: () => void): HTMLElement {
  const panel = el('section', 'progress-graph');
  panel.dataset.testid = 'results-graph';
  panel.dataset.kind = graph.kind;

  if (graph.kind === 'refused') {
    panel.dataset.handsShort = String(graph.handsShort);
    const reason = el('div', 'progress-graph-reason', graph.reason);
    reason.dataset.testid = 'graph-refusal';
    panel.appendChild(reason);

    const route = document.createElement('button');
    route.type = 'button';
    route.className = 'progress-graph-route';
    route.dataset.testid = 'graph-alternative';
    route.dataset.route = graph.alternative;
    route.textContent = guarded('Read the variance module instead');
    // N1: the route is always live. A named alternative you cannot follow is a locked door.
    if (onOpenVariance) route.addEventListener('click', onOpenVariance);
    panel.appendChild(route);
    return panel;
  }

  panel.dataset.hands = String(graph.hands);

  /*
   * BOTH SERIES, ONE VIEWBOX. P3: "the chip graph renders BESIDE the EV graph, and their divergence is
   * the lesson" — so they share a scale, because two charts on separate axes cannot show a divergence.
   */
  const all = [...graph.chipBb, ...graph.evBb];
  const min = Math.min(...all, 0);
  const max = Math.max(...all, 0);
  const span = max - min || 1;
  const points = (series: readonly number[]): string =>
    series
      .map((value, index) => {
        const x = (index / Math.max(1, series.length - 1)) * 100;
        const y = 40 - ((value - min) / span) * 40;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 40');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.classList.add('progress-series');
  svg.dataset.testid = 'graph-series';
  for (const [name, series] of [
    ['chip', graph.chipBb],
    ['ev', graph.evBb],
  ] as const) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', points(series));
    line.classList.add(`progress-line-${name}`);
    line.dataset.testid = `graph-line-${name}`;
    svg.appendChild(line);
  }
  panel.appendChild(svg);

  const lesson = el('div', 'progress-graph-reason', graph.lesson);
  lesson.dataset.testid = 'graph-lesson';
  panel.appendChild(lesson);

  return panel;
}

export function renderProgressScreen(opts: {
  readonly input: ProgressInput;
  readonly kcs?: Parameters<typeof kcBars>[0];
  readonly now: number;
  readonly onOpenVariance?: () => void;
}): HTMLElement {
  const root = el('div', 'progress-screen');
  root.dataset.testid = 'progress-screen';

  const metrics: ProgressMetrics = computeMetrics(opts.input, opts.now);
  const handsForConfig = opts.input.hands.filter((h) => h.botConfigId === opts.input.botConfigId).length;

  /*
   * P2 FIRST. "Per-KC mastery bars are the PRIMARY progress surface" — so they are first in DOM order,
   * ahead of the five numbers. The bars are task-level and carry the instructional payload; the five
   * numbers are a summary, and a summary above the teaching is the wrong emphasis.
   */
  const bars = kcBars(opts.kcs ?? []);
  const kcSection = el('section', 'progress-section');
  kcSection.dataset.testid = 'kc-section';
  kcSection.appendChild(el('div', 'stat-label', 'What you know, concept by concept'));
  if (bars.length === 0) {
    const empty = el(
      'div',
      'progress-empty',
      'No concept has enough evidence yet. Bars appear as decisions accumulate — nothing is hidden and nothing is locked.',
    );
    empty.dataset.testid = 'kc-empty';
    kcSection.appendChild(empty);
  } else {
    for (const bar of bars) kcSection.appendChild(renderKcBar(bar));
  }
  root.appendChild(kcSection);

  // P1: exactly five, in METRIC_KEYS order, with the fifth gated.
  const numbers = el('section', 'progress-section progress-numbers');
  numbers.dataset.testid = 'progress-numbers';
  numbers.appendChild(el('div', 'stat-label', 'Five numbers'));
  numbers.appendChild(renderMetric(metrics.gradedDecisionsThisWeek));
  numbers.appendChild(renderMetric(metrics.assessmentEvLossBb100));
  numbers.appendChild(renderMetric(metrics.fluentCategories));
  numbers.appendChild(renderMetric(metrics.sureWrongThisWeek));
  numbers.appendChild(renderWinRate(metrics.winRateVsBots, handsForConfig));
  root.appendChild(numbers);

  root.appendChild(renderResultsGraph(resultsGraph(opts.input.hands), opts.onOpenVariance));

  /*
   * G7's error tags, in core's sanctioned wording via formatTagAggregate. The wording is the point: a
   * tag names a class of DECISIONS with a bb/100 rate, never a property of the person, and the rate is
   * over ALL graded decisions so the tags are comparable to each other.
   */
  const tags = tagAggregates(opts.input.decisions);
  const tagSection = el('section', 'progress-section');
  tagSection.dataset.testid = 'tag-section';
  tagSection.appendChild(el('div', 'stat-label', 'Where the EV goes'));
  if (tags.length === 0) {
    const empty = el('div', 'progress-empty', 'No graded decision has been tagged yet.');
    empty.dataset.testid = 'tag-empty';
    tagSection.appendChild(empty);
  } else {
    for (const aggregate of tags) {
      const row = el('div', 'tag-row', formatTagAggregate(aggregate));
      row.dataset.testid = 'tag-row';
      row.dataset.tag = aggregate.tag;
      row.dataset.rate = aggregate.evLossBb100.toFixed(4);
      tagSection.appendChild(row);
    }
  }
  root.appendChild(tagSection);

  // The two gates, stated as facts about the sample so neither reads as a broken screen.
  const footer = el(
    'div',
    'progress-footer',
    `Win rate needs ${WIN_RATE_MIN_HANDS} hands; the results graph needs ${RESULTS_GRAPH_MIN_HANDS}. Below those, the honest answer is a smaller one. Weekly decision target is ${WEEKLY_DECISION_TARGET}.`,
  );
  footer.dataset.testid = 'progress-footer';
  root.appendChild(footer);

  return root;
}
