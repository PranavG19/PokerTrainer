import '../styles-trial.css';

import {
  BLOCK_DAYS,
  KILL_CRITERIA,
  TRIAL_BLOCKS,
  blockOn,
  evaluate,
  evLossPer100,
  outcomeOf,
  phaseOf,
  startRefusal,
  type CriterionStatus,
  type Side,
  type TrialAnswer,
  type TrialPhase,
} from '../../core/trial.js';
import type { DayKey } from '../../core/localDay.js';
import type { TrialState } from '../../core/progression/types.js';
import { text } from '../components/dom.js';
import { attachThumb } from '../components/thumb.js';

/**
 * SETTINGS › THE TRIAL (1.8, D15): set up, run and read the local four-week trial (core/trial.ts).
 *
 * - **Setup** asks for the prediction first and shows the kill criteria as they will be judged; Start stays off
 *   until the prediction is a sentence. After Start neither can be edited: they were written in advance.
 * - **Running** shows the week, whether the layer is on, the optional "wanted to / had to" question, and the
 *   counts so far. Stop keeps the counts.
 * - **Results** (after four weeks) set on weeks beside off weeks, each criterion with its verdict, and the honest
 *   n = 1 caveat. Applying them is the learner's press: a tripped criterion turns Character and Celebrations off.
 *
 * Everything shown is counted from this Mac's own records; the screen sends nothing and has no network path.
 */

export interface TrialHandlers {
  onBack: () => void;
  onStart: (prediction: string, ownCriterion: string) => void;
  onStop: () => void;
  onReport: (answer: TrialAnswer) => void;
  onFinish: () => void;
}

const PHASE_TITLE: Record<TrialPhase, string> = {
  none: 'Set up the trial',
  running: 'The trial is running',
  ready: 'Four weeks are done',
  stopped: 'The trial was stopped',
  finished: 'The trial’s results',
};

const STATUS_LABEL: Record<CriterionStatus, string> = { tripped: 'Tripped', clear: 'Clear', 'too-little': 'Too little to say' };

export function renderTrial(opts: { trial: TrialState; today: DayKey; handlers: TrialHandlers }): HTMLElement {
  const { trial, today, handlers } = opts;
  const phase = phaseOf(trial, today);
  const root = document.createElement('div');
  root.className = 'settings-screen trial-screen';
  root.dataset.testid = 'trial-screen';
  root.dataset.phase = phase;

  const head = document.createElement('div');
  head.className = 'trial-head';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'pill quiet sm';
  back.dataset.testid = 'trial-back';
  back.textContent = '‹ Settings';
  back.addEventListener('click', handlers.onBack);
  head.append(back, text('h1', 'trial-title', PHASE_TITLE[phase]));
  root.appendChild(head);

  root.appendChild(blockStrip(trial, today));
  root.appendChild(text('p', 'settings-note trial-local', 'Everything here is counted from your own records on this Mac. Nothing leaves this machine.'));

  if (phase === 'none') {
    root.appendChild(renderSetup(trial, handlers));
    return root;
  }

  root.appendChild(renderWritten(trial));
  if (phase === 'running') root.appendChild(renderRunning(trial, today, handlers));
  root.appendChild(renderResults(trial, phase));
  if (phase === 'ready') {
    const finish = document.createElement('button');
    finish.type = 'button';
    finish.className = 'pill primary';
    finish.dataset.testid = 'trial-finish';
    finish.textContent = evaluate(trial).tripped ? 'Apply the results: the layer goes off' : 'Apply the results: keep the layer';
    finish.addEventListener('click', handlers.onFinish);
    root.appendChild(finish);
  }
  return root;
}

/** On · Off · On · Off, with the week we are in marked. */
function blockStrip(trial: TrialState, today: DayKey): HTMLElement {
  const strip = document.createElement('ol');
  strip.className = 'trial-strip';
  strip.dataset.testid = 'trial-strip';
  strip.setAttribute('aria-label', 'Four weeks: on, off, on, off');
  const current = blockOn(trial, today);
  TRIAL_BLOCKS.forEach((kind, i) => {
    const li = document.createElement('li');
    li.className = 'trial-week';
    li.dataset.kind = kind;
    if (current === i) {
      li.dataset.current = 'true';
      li.setAttribute('aria-current', 'step');
    }
    li.append(text('span', 'trial-week-n', `Week ${i + 1}`), text('span', 'trial-week-kind', kind === 'on' ? 'Layer on' : 'Layer off'));
    strip.appendChild(li);
  });
  return strip;
}

function renderSetup(trial: TrialState, handlers: TrialHandlers): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'trial-setup';

  wrap.appendChild(
    text(
      'p',
      'settings-copy',
      `Four weeks of ${BLOCK_DAYS} days, starting today. In the off weeks Dee and Celebrations are off whatever their switches say; your switches are never changed. Everything else in the app is the same every week.`,
    ),
  );

  const predictionLabel = document.createElement('label');
  predictionLabel.className = 'settings-confirm-label';
  predictionLabel.append(text('span', '', 'Your prediction, before anything is measured'));
  const prediction = document.createElement('textarea');
  prediction.className = 'settings-confirm-input trial-text';
  prediction.dataset.testid = 'trial-prediction';
  prediction.rows = 2;
  prediction.maxLength = 400;
  prediction.placeholder = 'e.g. With Dee on I practise on more days, and my assessment EV loss does not get worse.';
  predictionLabel.appendChild(prediction);
  wrap.appendChild(predictionLabel);

  const criteria = document.createElement('div');
  criteria.className = 'settings-section';
  criteria.appendChild(text('div', 'stat-label', 'Kill criteria, written in advance'));
  const list = document.createElement('ul');
  list.className = 'settings-list';
  list.dataset.testid = 'trial-criteria';
  for (const k of KILL_CRITERIA) {
    const li = document.createElement('li');
    li.dataset.testid = 'trial-criterion';
    li.textContent = k.text;
    list.appendChild(li);
  }
  criteria.appendChild(list);
  criteria.appendChild(text('p', 'settings-note', 'If any one trips, the layer goes off by default when you apply the results. You can turn it back on.'));
  wrap.appendChild(criteria);

  const ownLabel = document.createElement('label');
  ownLabel.className = 'settings-confirm-label';
  ownLabel.append(text('span', '', 'One of your own (optional, yours to judge at the end)'));
  const own = document.createElement('input');
  own.type = 'text';
  own.className = 'settings-confirm-input';
  own.dataset.testid = 'trial-own-criterion';
  own.maxLength = 400;
  own.placeholder = 'e.g. I start opening the app only to keep the streak.';
  ownLabel.appendChild(own);
  wrap.appendChild(ownLabel);

  const row = document.createElement('div');
  row.className = 'settings-switch';
  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'pill primary';
  start.dataset.testid = 'trial-start';
  start.textContent = 'Start the trial';
  const why = text('span', 'settings-note', '');
  why.dataset.testid = 'trial-start-why';
  why.setAttribute('aria-live', 'polite');
  const paint = (): void => {
    const refusal = startRefusal(trial, prediction.value);
    start.disabled = refusal !== null;
    why.textContent = refusal ?? 'Starts today with an on week. The prediction and criteria are locked from here.';
  };
  prediction.addEventListener('input', paint);
  start.addEventListener('click', () => {
    if (startRefusal(trial, prediction.value) === null) handlers.onStart(prediction.value, own.value);
  });
  row.append(start, why);
  wrap.appendChild(row);
  paint();
  return wrap;
}

/** The prediction and the learner's own criterion, as written, read-only. */
function renderWritten(trial: TrialState): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'settings-section';
  wrap.appendChild(text('div', 'stat-label', 'Written before the start'));
  const q = text('blockquote', 'trial-quote', trial.prediction || '(no prediction on file)');
  q.dataset.testid = 'trial-prediction-locked';
  wrap.appendChild(q);
  if (trial.ownCriterion !== '') {
    const own = text('p', 'settings-note', `Your own criterion: “${trial.ownCriterion}” Yours to judge.`);
    own.dataset.testid = 'trial-own-locked';
    wrap.appendChild(own);
  }
  return wrap;
}

function renderRunning(trial: TrialState, today: DayKey, handlers: TrialHandlers): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'settings-block g-group settings-rows';
  const b = blockOn(trial, today) ?? 0;
  const day = trial.startedOn === null ? 1 : today - trial.startedOn + 1;
  const where = text('div', 'settings-switch', '');
  const whereNote = text(
    'span',
    'settings-note',
    `Day ${day} of 28. Week ${b + 1} is ${TRIAL_BLOCKS[b] === 'on' ? 'an on week: Dee and Celebrations follow their switches.' : 'an off week: Dee and Celebrations are off.'}`,
  );
  whereNote.dataset.testid = 'trial-where';
  where.appendChild(whereNote);
  wrap.appendChild(where);

  // The optional self-report: one answer a day, changeable the same day.
  const answered = trial.reports.find((r) => r.day === today)?.answer ?? null;
  const ask = document.createElement('div');
  ask.className = 'settings-switch';
  const seg = document.createElement('div');
  seg.className = 'g-seg g-seg-sm settings-seg';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Today I opened Offsuit because I');
  seg.dataset.testid = 'trial-report';
  for (const [id, label] of [
    ['wanted', 'Wanted to'],
    ['had', 'Had to'],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.testid = `trial-report-${id}`;
    button.setAttribute('aria-pressed', String(answered === id));
    button.textContent = label;
    button.addEventListener('click', () => handlers.onReport(id));
    seg.appendChild(button);
  }
  const askNote = text('span', 'settings-note', '');
  askNote.append(text('b', 'settings-row-title', 'Today, did you open Offsuit because you wanted to or had to?'), document.createTextNode(' Optional, once a day.'));
  ask.append(seg, askNote);
  attachThumb(seg);
  wrap.appendChild(ask);

  const stopRow = document.createElement('div');
  stopRow.className = 'settings-switch';
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'pill quiet sm';
  stop.dataset.testid = 'trial-stop';
  stop.textContent = 'Stop early…';
  const stopNote = text('span', 'settings-note', 'Stopping keeps what was counted. This profile runs one trial.');
  let armed = false;
  stop.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      stop.textContent = 'Stop the trial';
      stop.dataset.armed = 'true';
      stopNote.textContent = 'Press again to stop. The counts so far stay readable here.';
      return;
    }
    handlers.onStop();
  });
  stopRow.append(stop, stopNote);
  wrap.appendChild(stopRow);
  return wrap;
}

const pct = (n: number, d: number): string => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

/** The on weeks beside the off weeks, then each criterion's verdict. */
function renderResults(trial: TrialState, phase: TrialPhase): HTMLElement {
  const r = evaluate(trial);
  const wrap = document.createElement('div');
  wrap.className = 'settings-section trial-results';
  wrap.dataset.testid = 'trial-results';
  wrap.dataset.tripped = String(r.tripped);
  wrap.appendChild(text('div', 'stat-label', phase === 'running' ? 'So far' : 'On weeks beside off weeks'));

  const table = document.createElement('table');
  table.className = 'trial-table';
  table.dataset.testid = 'trial-table';
  const headRow = document.createElement('tr');
  headRow.append(text('th', '', ''), text('th', '', 'Layer on'), text('th', '', 'Layer off'));
  const thead = document.createElement('thead');
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  const ev = (s: Side): string => {
    const v = evLossPer100(s);
    return v === null ? '—' : `${v} bb/100 (${s.counts.assessed})`;
  };
  const rows: [string, (s: Side) => string][] = [
    ['Weeks with a session', (s) => String(s.blocks)],
    ['Days practised', (s) => String(s.counts.activeDays)],
    ['Sessions', (s) => String(s.counts.sessions)],
    ['Graded decisions', (s) => String(s.counts.decisions)],
    ['Assessment EV loss', ev],
    ['Delayed-review accuracy', (s) => `${pct(s.counts.delayedCorrect, s.counts.delayed)} (${s.counts.delayed})`],
    ['Sure rate', (s) => `${pct(s.sure, s.tested)} (${s.tested})`],
    ['Sure accuracy', (s) => `${pct(s.sureRight, s.sure)} (${s.sure})`],
    ['Reps on mastered concepts', (s) => `${pct(s.counts.repsOnMastered, s.counts.reps)} (${s.counts.reps})`],
    ['Late sessions (23:00–04:00)', (s) => String(s.counts.lateSessions)],
    ['Days with 3+ sessions', (s) => String(s.counts.busyDays)],
    ['“Had to” answers', (s) => `${s.had} of ${s.had + s.wanted}`],
  ];
  for (const [label, cell] of rows) {
    const tr = document.createElement('tr');
    tr.append(text('th', '', label), text('td', '', cell(r.on)), text('td', '', cell(r.off)));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  wrap.appendChild(text('p', 'settings-note', 'In brackets: how many records each number is from.'));

  // The verdicts wait for the four weeks: a "tripped" seen mid-trial would change how the remaining weeks are played,
  // and a stopped trial is never judged.
  if (phase !== 'ready' && phase !== 'finished') {
    const wait = text(
      'p',
      'settings-copy trial-summary',
      phase === 'stopped'
        ? 'Stopped early, so the criteria are not judged and the layer is left as you set it.'
        : 'The criteria are judged after the four weeks, so nothing here hints at a verdict while it runs.',
    );
    wait.dataset.testid = 'trial-summary';
    wrap.appendChild(wait);
    return wrap;
  }
  const list = document.createElement('ul');
  list.className = 'settings-list trial-verdicts';
  for (const c of r.criteria) {
    const li = document.createElement('li');
    li.className = 'trial-verdict';
    li.dataset.testid = 'trial-verdict';
    li.dataset.id = c.id;
    li.dataset.status = c.status;
    li.append(text('span', 'trial-verdict-status', STATUS_LABEL[c.status]), text('span', 'trial-verdict-text', c.text), text('span', 'settings-note trial-verdict-nums', `On ${c.on} · off ${c.off}`));
    list.appendChild(li);
  }
  wrap.appendChild(list);

  const outcome = outcomeOf(trial);
  const summary =
    phase === 'finished' && outcome !== null
      ? outcome === 'off'
        ? 'Applied: a criterion tripped, so Character and Celebrations were turned off. Either can be turned back on in Settings.'
        : 'Applied: no criterion tripped, so the layer stays as you set it.'
      : r.tripped
        ? 'A criterion tripped. When the results are applied, the layer goes off by default.'
        : 'No criterion tripped.';
  const line = text('p', 'settings-copy trial-summary', summary);
  line.dataset.testid = 'trial-summary';
  wrap.appendChild(line);
  wrap.appendChild(
    text(
      'p',
      'settings-note',
      'One person over four weeks can show harm or a change in how you practise. It cannot prove the layer makes you learn faster, and this page does not claim it.',
    ),
  );
  return wrap;
}
