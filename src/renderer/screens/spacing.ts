import '../styles-spacing.css';

import {
  WAVES,
  assertFlatGaps,
  dueNow,
  gate,
  nextDue,
  onProbeMiss,
  type ConceptState,
  type DueRep,
  type ProbeMissOutcome,
} from '../../core/schedule.js';

/**
 * THE SPACING QUEUE — a maintenance readout over src/core/schedule.ts (Q4, Q5, N4's placement).
 *
 * Q4 says the schedule is "embedded unannounced in the normal queue — never a review session", so
 * this surface is deliberately NOT a prompt. It announces nothing, asks for nothing, and the word
 * that would turn it into a sitting of its own does not appear anywhere in it. What is owed per
 * concept is served inside ordinary practice; this page only lets a maintainer see what the
 * scheduler currently believes, which is where the spec puts diagnostics of this kind.
 *
 * Nothing here is computed. Every day, rep count, mode, status, gap and reopening decision comes out
 * of core/schedule.ts. The only arithmetic in this file is subtracting two of core's own wave days to
 * print the gap between them, and even the verdict on those gaps is core's `assertFlatGaps` rather
 * than a rule restated here.
 */

/**
 * The clock is a parameter, exactly as it is in core/schedule.ts, and for the same reason: a queue
 * view that reads the clock internally is a view no test can pin. `window.__offsuitSpacing` is the
 * e2e seam that supplies both the instant and the concept records — nothing in the app writes
 * concept records yet, so without it this screen has an empty ledger and says so.
 */
export interface SpacingInput {
  readonly now: number;
  readonly concepts: readonly ConceptState[];
}

declare global {
  interface Window {
    __offsuitSpacing?: SpacingInput;
  }
}

export interface SpacingOpts {
  readonly concepts?: readonly ConceptState[];
  readonly now?: number;
}

/** The expanding ladder Q4 forbids, kept only so the guard's refusal of it is visible on screen. */
const FORBIDDEN_LADDER = [1, 2, 4, 8, 16];

export function renderSpacing(opts: SpacingOpts = {}): HTMLElement {
  const seam = window.__offsuitSpacing;
  const now = opts.now ?? seam?.now ?? Date.now();

  let concepts: readonly ConceptState[] = opts.concepts ?? seam?.concepts ?? [];
  /**
   * Probe misses recorded in this sitting, per concept, oldest first. Kept in memory rather than
   * persisted: nothing else in the app owns concept records yet, so writing them here would invent a
   * store whose only reader is this page.
   */
  const missOutcomes = new Map<string, ProbeMissOutcome[]>();

  const root = document.createElement('div');
  root.className = 'spacing-screen';
  root.dataset.testid = 'spacing-screen';

  function recordProbeMiss(id: string): void {
    const state = concepts.find((c) => c.id === id);
    if (state === undefined) return;
    // Core decides what a miss means; this only hands it the state and keeps the answer.
    const outcome = onProbeMiss(state);
    concepts = concepts.map((c) => (c.id === id ? { ...c, probeMisses: c.probeMisses + 1 } : c));
    missOutcomes.set(id, [...(missOutcomes.get(id) ?? []), outcome]);
    paint();
  }

  function paint(): void {
    const due = dueNow(concepts, now);
    // The sync oracle: every e2e wait keys off these, never a sleep.
    root.dataset.now = String(now);
    root.dataset.conceptCount = String(concepts.length);
    root.dataset.dueCount = String(due.length);
    root.dataset.missesRecorded = String(
      [...missOutcomes.values()].reduce((total, list) => total + list.length, 0),
    );

    root.replaceChildren(
      renderFraming(),
      renderLadder(),
      renderQueue(due),
      renderConcepts(concepts, now, missOutcomes, recordProbeMiss),
    );
  }

  paint();
  return root;
}

// ---------------------------------------------------------------------------
// Framing — why this is not a prompt
// ---------------------------------------------------------------------------

function renderFraming(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'spacing-framing';

  section.appendChild(label('Maintenance readout — spacing state per concept'));
  section.appendChild(
    note(
      'spacing-embedding-note',
      'What is owed below is served inside ordinary practice, unannounced and mixed in with everything else. It is never assembled into a sitting of its own, and the learner is never told a spot arrived because it was owed.',
    ),
  );

  return section;
}

// ---------------------------------------------------------------------------
// The ladder, and the guard on it
// ---------------------------------------------------------------------------

function renderLadder(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'spacing-ladder';
  section.dataset.testid = 'wave-ladder';

  section.appendChild(label('The waves, and the gap to the one before'));

  const list = document.createElement('ol');
  list.className = 'wave-list';

  WAVES.forEach((wave, index) => {
    const previous = index === 0 ? null : WAVES[index - 1];

    const row = document.createElement('li');
    row.className = 'wave-row';
    row.dataset.testid = 'wave-row';
    row.dataset.day = String(wave.day);
    row.dataset.reps = String(wave.reps);
    row.dataset.mode = wave.mode;
    // Subtraction of two of core's own numbers; the verdict on the sequence is core's, below.
    row.dataset.gap = previous === null ? '' : String(wave.day - previous.day);

    row.appendChild(cell('wave-day', `day ${wave.day}`));
    row.appendChild(cell('wave-reps', `${wave.reps} reps`));
    row.appendChild(cell('wave-mode', wave.mode));
    row.appendChild(cell('wave-gap', previous === null ? 'first exposure' : `+${wave.day - previous.day}d`));

    list.appendChild(row);
  });

  section.appendChild(list);
  section.appendChild(renderFlatCheck());
  section.appendChild(renderExpandingCheck());

  return section;
}

/** Core's own invariant, asserted here rather than described: the gaps do not expand. */
function renderFlatCheck(): HTMLElement {
  const failure = flatGapFailure();

  const el = document.createElement('p');
  el.className = 'spacing-check';
  el.dataset.testid = 'flat-gap-check';
  el.dataset.flat = String(failure === null);
  el.textContent =
    failure === null
      ? 'These gaps are flat: no gap doubles the one before it.'
      : `The shipped ladder no longer holds the flat-gap invariant: ${failure}`;
  return el;
}

/** And the shape it must not become, refused by the same guard so the two can be told apart. */
function renderExpandingCheck(): HTMLElement {
  const failure = flatGapFailure(FORBIDDEN_LADDER);

  const el = document.createElement('p');
  el.className = 'spacing-check';
  el.dataset.testid = 'expanding-check';
  el.dataset.ladder = FORBIDDEN_LADDER.join(',');
  el.dataset.rejected = String(failure !== null);
  el.textContent =
    failure === null
      ? `${FORBIDDEN_LADDER.join('/')} passes the guard — the flat-gap invariant has stopped working.`
      : `${FORBIDDEN_LADDER.join('/')} is refused: ${failure}`;
  return el;
}

function flatGapFailure(days?: readonly number[]): string | null {
  try {
    if (days === undefined) assertFlatGaps();
    else assertFlatGaps(days);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// ---------------------------------------------------------------------------
// What is owed now
// ---------------------------------------------------------------------------

function renderQueue(due: readonly DueRep[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'spacing-queue';
  section.dataset.testid = 'due-list';
  section.dataset.count = String(due.length);

  section.appendChild(label('Owed now, longest-owed first'));

  if (due.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'spacing-empty';
    empty.dataset.testid = 'due-empty';
    empty.textContent = 'Nothing is owed at this instant. Every concept on record is inside its window.';
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement('ol');
  list.className = 'due-rows';

  due.forEach((rep, index) => {
    const row = document.createElement('li');
    row.className = 'due-row';
    row.dataset.testid = 'due-row';
    row.dataset.rank = String(index);
    row.dataset.concept = rep.conceptId;
    row.dataset.wave = String(rep.waveDay);
    row.dataset.reps = String(rep.reps);
    row.dataset.mode = rep.mode;
    row.dataset.overdue = String(rep.overdueDays);

    row.appendChild(cell('due-concept', rep.conceptId));
    row.appendChild(cell('due-wave', `day ${rep.waveDay} wave`));
    row.appendChild(cell('due-reps', `${rep.reps} reps`));
    row.appendChild(cell('due-mode', rep.mode));
    row.appendChild(
      cell('due-overdue', rep.overdueDays === 0 ? 'inside its window' : `${rep.overdueDays}d owed`),
    );

    list.appendChild(row);
  });

  section.appendChild(list);
  return section;
}

// ---------------------------------------------------------------------------
// Per concept: gate status, and what a decay-probe miss did to it
// ---------------------------------------------------------------------------

function renderConcepts(
  concepts: readonly ConceptState[],
  now: number,
  missOutcomes: ReadonlyMap<string, readonly ProbeMissOutcome[]>,
  onProbeMissClick: (id: string) => void,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'spacing-concepts';
  section.dataset.testid = 'concept-list';

  section.appendChild(label('Every concept on record'));

  if (concepts.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'spacing-empty';
    empty.dataset.testid = 'concept-empty';
    empty.textContent = 'No concept has been opened yet, so there is no spacing state to report.';
    section.appendChild(empty);
    return section;
  }

  for (const state of concepts) {
    section.appendChild(
      renderConcept(state, now, missOutcomes.get(state.id) ?? [], onProbeMissClick),
    );
  }

  return section;
}

function renderConcept(
  state: ConceptState,
  now: number,
  outcomes: readonly ProbeMissOutcome[],
  onProbeMissClick: (id: string) => void,
): HTMLElement {
  const status = gate(state, now);
  const owed = nextDue(state, now);

  const row = document.createElement('div');
  row.className = 'concept-row';
  row.dataset.testid = 'concept-row';
  row.dataset.concept = state.id;
  row.dataset.status = status.status;
  row.dataset.opportunities = String(state.opportunities.length);
  row.dataset.probeMisses = String(state.probeMisses);
  row.dataset.nextWave = owed === null ? '' : String(owed.waveDay);

  const head = document.createElement('div');
  head.className = 'concept-head';
  head.appendChild(cell('concept-id', state.id));
  head.appendChild(cell('concept-status', status.status));
  head.appendChild(
    cell('concept-next', owed === null ? 'nothing owed' : `day ${owed.waveDay} wave owed`),
  );
  row.appendChild(head);

  const reason = document.createElement('p');
  reason.className = 'concept-reason';
  reason.dataset.testid = 'concept-reason';
  reason.textContent = status.reason;
  row.appendChild(reason);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pill probe-miss';
  button.dataset.testid = 'probe-miss';
  button.dataset.concept = state.id;
  button.textContent = 'Record a decay-probe miss';
  button.addEventListener('click', () => onProbeMissClick(state.id));
  row.appendChild(button);

  if (outcomes.length > 0) row.appendChild(renderMissOutcomes(state.id, outcomes));

  return row;
}

/**
 * Q5, and the flat gap is visible here rather than only in the ladder: the gap after a miss is 7 days
 * and the gap after the NEXT miss is 7 days again. An expanding scheduler would print 7 then 14, so
 * the history is rendered as a list and not just as its latest value.
 */
function renderMissOutcomes(
  conceptId: string,
  outcomes: readonly ProbeMissOutcome[],
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'miss-outcomes';

  const gaps = document.createElement('p');
  gaps.className = 'miss-gaps';
  gaps.dataset.testid = 'miss-gap-history';
  gaps.dataset.concept = conceptId;
  gaps.dataset.gaps = outcomes.map((o) => o.nextGapDays).join(',');
  gaps.textContent = `Gap after each miss: ${outcomes.map((o) => `${o.nextGapDays}d`).join(', ')}`;
  wrap.appendChild(gaps);

  outcomes.forEach((outcome, index) => {
    const el = document.createElement('div');
    el.className = 'miss-outcome';
    el.dataset.testid = 'miss-outcome';
    el.dataset.concept = conceptId;
    el.dataset.miss = String(index + 1);
    el.dataset.gapDays = String(outcome.nextGapDays);
    el.dataset.reopen = String(outcome.reopenContrastSet);
    el.dataset.activeLearning = String(outcome.returnToActiveLearning);
    el.dataset.remaining =
      outcome.remainingOpportunities === null ? '' : String(outcome.remainingOpportunities);

    el.appendChild(cell('miss-index', `miss ${index + 1}`));
    el.appendChild(
      cell('miss-reopen', outcome.reopenContrastSet ? 'contrast set reopened' : 'contrast set left closed'),
    );
    el.appendChild(cell('miss-gap', `${outcome.nextGapDays}-day gap`));
    el.appendChild(
      cell(
        'miss-return',
        outcome.returnToActiveLearning
          ? `back to active learning, ${outcome.remainingOpportunities} opportunities remaining — the record is kept, not cleared`
          : 'stays where it is; the gap is what changed',
      ),
    );

    wrap.appendChild(el);
  });

  return wrap;
}

// ---------------------------------------------------------------------------

function cell(testid: string, text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = testid;
  el.dataset.testid = testid;
  el.textContent = text;
  return el;
}

function label(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'stat-label';
  el.textContent = text;
  return el;
}

function note(testid: string, text: string): HTMLElement {
  const el = document.createElement('p');
  el.className = 'spacing-note';
  el.dataset.testid = testid;
  el.textContent = text;
  return el;
}
