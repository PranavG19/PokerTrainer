import '../styles-career.css';
import type { CareerRecord } from '../../core/career.js';

/**
 * THE CAREER SCREEN — a pure reader of core/career.ts's CareerRecord, opened as a full-column sub-view
 * of the Profile tab (Profile is height-tuned to the pixel at 900x640 and the Progress screen's
 * five-numbers contract forbids the cadence/run vocabulary this screen shows, so Career gets its own
 * surface via the same swap Profile uses for the hand picker/replay).
 *
 * Like profile.ts and progress.ts this file holds NO arithmetic and NO threshold of its own: every
 * number, label and withholding comes straight off the record core computed. A field core returns as
 * null (untested prediction accuracy, no leak yet) is rendered as an explicit "not yet" rather than a
 * fabricated zero — the same honesty rule the rest of the app follows.
 */
export function renderCareer(opts: { record: CareerRecord; onBack: () => void }): HTMLElement {
  const { record } = opts;

  const root = document.createElement('div');
  root.className = 'career-screen';
  root.dataset.testid = 'career-screen';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'career-back';
  back.dataset.testid = 'career-back';
  back.textContent = '← Profile';
  back.addEventListener('click', opts.onBack);
  root.appendChild(back);

  root.appendChild(renderStanding(record));
  root.appendChild(section('Record', renderCounters(record)));
  root.appendChild(section('Prediction accuracy', renderAccuracy(record)));
  root.appendChild(section('Biggest leak', renderBiggestLeak(record)));
  root.appendChild(section('Practice cadence', renderCadence(record)));
  root.appendChild(section('Milestones', renderMilestones(record)));

  return root;
}

function section(label: string, body: HTMLElement): HTMLElement {
  const el = document.createElement('section');
  el.className = 'career-section';
  const heading = document.createElement('div');
  heading.className = 'stat-label';
  heading.textContent = label;
  el.appendChild(heading);
  el.appendChild(body);
  return el;
}

/** The headline: earned depth (never chips) + the separate live form reading. */
function renderStanding(record: CareerRecord): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'career-standing';

  const label = document.createElement('div');
  label.className = 'stat-label';
  label.textContent = 'Standing';
  wrap.appendChild(label);

  const value = document.createElement('div');
  value.className = 'career-standing-value';
  value.dataset.testid = 'career-standing';
  value.textContent = record.depthLabel;
  wrap.appendChild(value);

  const form = document.createElement('div');
  form.className = 'career-form';
  form.dataset.testid = 'career-form';
  form.dataset.form = record.form;
  form.textContent = `Current form: ${record.form}`;
  wrap.appendChild(form);

  return wrap;
}

function renderCounters(record: CareerRecord): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'counter-grid';
  const counters: { label: string; value: string }[] = [
    { label: 'Hands', value: String(record.handsPlayed) },
    { label: 'Concepts mastered', value: String(record.conceptsMastered) },
    { label: 'Puzzles clean', value: String(record.puzzlesSolvedClean) },
    { label: 'Assessments', value: String(record.assessmentsTaken) },
    { label: 'Rebuys', value: String(record.rebuys) },
  ];
  for (const counter of counters) {
    const cell = document.createElement('div');
    cell.className = 'counter';
    const v = document.createElement('div');
    v.className = 'stat-value';
    v.textContent = counter.value;
    const l = document.createElement('div');
    l.className = 'stat-label';
    l.textContent = counter.label;
    cell.append(v, l);
    grid.appendChild(cell);
  }
  return grid;
}

/** Sure/guess accuracy, each WITHHELD (not a fabricated 0%) when that bucket was never tested. */
function renderAccuracy(record: CareerRecord): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'career-accuracy';

  wrap.appendChild(accuracyRow('When sure', record.sureAccuracy, 'career-sure'));
  wrap.appendChild(accuracyRow('When guessing', record.guessAccuracy, 'career-guess'));
  return wrap;
}

function accuracyRow(label: string, value: number | null, testid: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'career-row';
  const l = document.createElement('span');
  l.className = 'career-row-label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'career-row-value';
  v.dataset.testid = testid;
  // null = never tested. Say so, rather than printing 0% which reads as a verdict.
  v.textContent = value === null ? 'not tested yet' : `${Math.round(value * 100)}%`;
  row.append(l, v);
  return row;
}

function renderBiggestLeak(record: CareerRecord): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'career-leak';
  wrap.dataset.testid = 'career-leak';
  if (record.biggestLeak === null) {
    wrap.textContent = 'Nothing graded yet.';
    wrap.dataset.empty = 'true';
    return wrap;
  }
  const principle = document.createElement('span');
  principle.className = 'career-leak-principle';
  principle.textContent = record.biggestLeak.principle;
  const cost = document.createElement('span');
  cost.className = 'career-leak-cost';
  cost.textContent = `${record.biggestLeak.costBb.toFixed(1)} bb`;
  wrap.append(principle, cost);
  return wrap;
}

/**
 * The 30-day dot grid: index 29 = today. A run is shown as information, never as something you "lose"
 * — a gap is not styled as a failure (spacing means gaps are correct). last30 is exactly 30 booleans.
 */
function renderCadence(record: CareerRecord): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'career-cadence';

  const grid = document.createElement('div');
  grid.className = 'career-dot-grid';
  grid.dataset.testid = 'career-dot-grid';
  record.cadence.last30.forEach((active, i) => {
    const dot = document.createElement('span');
    dot.className = 'career-dot';
    dot.dataset.active = String(active);
    if (i === 29) dot.dataset.today = 'true';
    grid.appendChild(dot);
  });
  wrap.appendChild(grid);

  const summary = document.createElement('div');
  summary.className = 'career-cadence-summary';
  summary.dataset.testid = 'career-cadence';
  const days = record.cadence.distinctDays;
  const run = record.cadence.currentRun;
  summary.textContent = `${days} ${days === 1 ? 'day' : 'days'} practised · ${run} in a row`;
  wrap.appendChild(summary);

  return wrap;
}

/** The milestone ladder: effort/mastery facts, achieved or not. Achieved ones read louder. */
function renderMilestones(record: CareerRecord): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'career-milestones';
  list.dataset.testid = 'career-milestones';
  for (const milestone of record.milestones) {
    const item = document.createElement('li');
    item.className = 'career-milestone';
    item.dataset.achieved = String(milestone.achieved);
    item.dataset.testid = `career-milestone-${milestone.id}`;

    const mark = document.createElement('span');
    mark.className = 'career-milestone-mark';
    mark.textContent = milestone.achieved ? '✓' : '○';
    const label = document.createElement('span');
    label.className = 'career-milestone-label';
    label.textContent = milestone.label;
    item.append(mark, label);
    list.appendChild(item);
  }
  return list;
}
