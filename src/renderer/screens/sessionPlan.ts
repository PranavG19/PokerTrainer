import '../styles-session-plan.css';

import { dueNow, type ConceptState } from '../../core/schedule.js';
import {
  BLOCK_KINDS,
  CUT_ORDER,
  DEFAULT_SESSION_MINUTES,
  SESSION_LENGTHS,
  SHARES,
  assemble,
  minutesByKind,
  type BlockKind,
  type CutTarget,
  type SessionMode,
  type SessionPlan,
} from '../../core/sessionPlan.js';

/**
 * THE SESSION PLANNER — PRODUCT-SPEC S1, S2, S2a, S2b, S3.
 *
 * A READER over src/core/sessionPlan.ts. Every minute, spot count, cut and refusal on screen comes
 * back out of `assemble`, and the probe count comes out of `dueNow`; this file contains no share, no
 * floor and no arithmetic of its own beyond formatting a number for display.
 *
 * WHY IT LIVES ON HOME RATHER THAN IN A TAB. N5 says home is a launcher, not a surface, and choosing
 * how long you are sitting down for is the launch decision — a seventh tab would make the sitting a
 * place you visit rather than the thing you start. It is its own module rather than more lines in
 * home.ts because home.ts is shared, and this panel is ~200 lines of it.
 *
 * WHY 15 MINUTES IS ON THE LENGTH ROW AT ALL, given that S2a says no 15-minute session exists. The
 * length row offers SITTING lengths — how much time the learner actually has is a fact about their
 * evening, not about the product — and SESSION_LENGTHS (30, 50) is what a *session* is offered at,
 * which is why the 15 pill is marked `data-session-length="false"`. Asking for a 15-minute session
 * is answered by S2a's refusal WITH ITS REASON and a one-click route into free-roam, which does fit.
 * Hiding the button instead would hide the reason, and a refusal the learner cannot reach is not an
 * explanation — it is the locked door N1 forbids.
 */

/** S1's labels, verbatim from the spec's table so the screen and the spec cannot drift apart. */
const BLOCK_LABELS: Record<BlockKind, string> = {
  'warm-up': 'fluency warm-up (PLM)',
  'decay-probes': 'decay probes',
  'graded-spots': 'graded spots',
  'contrast-remediation': 'contrast remediation',
  'whole-task': 'whole-task live hands',
  scoreboard: 'scoreboard',
};

/** The atom each block is counted in. A block's value is whole atoms, so the count is the unit. */
const UNIT_NOUNS: Record<BlockKind, readonly [string, string]> = {
  'warm-up': ['block', 'blocks'],
  'decay-probes': ['probe', 'probes'],
  'graded-spots': ['spot', 'spots'],
  'contrast-remediation': ['contrast set', 'contrast sets'],
  'whole-task': ['live hand', 'live hands'],
  scoreboard: ['scoreboard', 'scoreboards'],
};

const CUT_LABELS: Record<CutTarget, string> = {
  'whole-task': 'whole-task live hands',
  'warm-up-length': 'warm-up length',
  'graded-spot-count': 'graded spot count',
};

/** Which ingredient a cut target takes its minutes out of, so the row can name its own loss. */
const CUT_AFFECTS: Record<CutTarget, BlockKind> = {
  'whole-task': 'whole-task',
  'warm-up-length': 'warm-up',
  'graded-spot-count': 'graded-spots',
};

/**
 * Sitting lengths on offer. 15 is a sitting, not a session — see the header. Sorted so the row reads
 * shortest first, and derived from SESSION_LENGTHS so a third session length appears here for free.
 */
const SHORT_SITTING_MINUTES = 15;
const SITTING_LENGTHS: readonly number[] = [SHORT_SITTING_MINUTES, ...SESSION_LENGTHS].sort(
  (a, b) => a - b,
);

const MODE_LABELS: Record<SessionMode, string> = {
  session: 'Session',
  'free-roam': 'Free-roam',
};

export interface SessionPlannerOpts {
  /** Sitting the learner committed to. Home hands its own launcher in. */
  onStart?: (minutes: number, mode: SessionMode) => void;
  /**
   * The spacing queue the probe count is read from: `dueProbes` is `dueNow(states, now).length`,
   * which is the module's own documented contract. Empty is the honest default on a fresh profile —
   * nothing has been learned yet, so nothing is owed a probe — and that is the spec's own
   * "empty spacing queue" edge case rather than a placeholder.
   */
  conceptStates?: readonly ConceptState[];
  now?: number;
}

declare global {
  interface Window {
    /**
     * e2e seam for the spacing queue. Nothing persists ConceptStates yet, so this is the only way
     * the built bundle can be asked to plan a sitting that owes probes; the count still comes out of
     * `dueNow`, so what the panel shows is computed by core either way.
     */
    __offsuitProbeQueue?: readonly ConceptState[];
  }
}

export function renderSessionPlanner(opts: SessionPlannerOpts = {}): HTMLElement {
  const root = document.createElement('section');
  root.className = 'session-planner';
  root.dataset.testid = 'session-planner';

  const states = opts.conceptStates ?? window.__offsuitProbeQueue ?? [];
  const dueProbes = dueNow(states, opts.now ?? Date.now()).length;

  let minutes: number = DEFAULT_SESSION_MINUTES;
  let mode: SessionMode = 'session';

  function selectMinutes(next: number): void {
    minutes = next;
    paint();
  }

  function selectMode(next: SessionMode): void {
    mode = next;
    paint();
  }

  function paint(): void {
    const result = assemble({ durationMinutes: minutes, mode, dueProbes });

    // The sync oracle: every e2e wait keys off these, never a sleep.
    root.dataset.minutes = String(minutes);
    root.dataset.mode = mode;
    root.dataset.dueProbes = String(dueProbes);
    root.dataset.status = result.ok ? 'planned' : 'refused';
    root.dataset.total = result.ok ? String(result.plan.totalMinutes) : '';
    root.dataset.cutCount = result.ok ? String(result.plan.cuts.length) : '';
    root.dataset.deferred = result.ok ? String(result.plan.remediationDeferred) : '';

    root.replaceChildren(
      heading('Plan a sitting'),
      renderLengthRow(minutes, selectMinutes),
      renderModeRow(mode, selectMode),
      result.ok
        ? renderPlan(result.plan, () => opts.onStart?.(minutes, mode))
        : renderRefusal(minutes, result.reason, () => selectMode('free-roam')),
    );
  }

  paint();
  return root;
}

function heading(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'stat-label';
  el.textContent = text;
  return el;
}

function renderLengthRow(selected: number, onSelect: (minutes: number) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'planner-row';
  row.dataset.testid = 'length-row';

  for (const length of SITTING_LENGTHS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pill length-btn';
    button.dataset.testid = 'length-btn';
    button.dataset.minutes = String(length);
    button.dataset.active = String(length === selected);
    // S1/S2a, stated on the control itself: 30 and 50 are session lengths and 15 is not one.
    const isSessionLength = (SESSION_LENGTHS as readonly number[]).includes(length);
    button.dataset.sessionLength = String(isSessionLength);
    button.textContent = isSessionLength ? `${length} min` : `${length} min · not a session`;
    button.addEventListener('click', () => onSelect(length));
    row.appendChild(button);
  }

  return row;
}

/** S3: free-roam is a mode you pick, the same size and shape as a session, not a degraded fallback. */
function renderModeRow(selected: SessionMode, onSelect: (mode: SessionMode) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'planner-row';
  row.dataset.testid = 'mode-row';

  for (const mode of ['session', 'free-roam'] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pill mode-btn';
    button.dataset.testid = 'mode-btn';
    button.dataset.mode = mode;
    button.dataset.active = String(mode === selected);
    button.textContent = MODE_LABELS[mode];
    button.addEventListener('click', () => onSelect(mode));
    row.appendChild(button);
  }

  return row;
}

function renderPlan(plan: SessionPlan, onStart: () => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'planner-plan';
  wrap.dataset.testid = 'planner-plan';

  wrap.appendChild(renderTotal(plan));
  wrap.appendChild(renderIngredients(plan));
  wrap.appendChild(renderCuts(plan));
  if (plan.mode === 'free-roam') wrap.appendChild(renderFreeRoamNotes(plan));
  wrap.appendChild(renderStart(plan, onStart));

  return wrap;
}

function renderTotal(plan: SessionPlan): HTMLElement {
  const el = document.createElement('div');
  el.className = 'planner-total';
  el.dataset.testid = 'planner-total';
  el.dataset.total = String(plan.totalMinutes);
  el.dataset.requested = String(plan.requestedMinutes);
  // The leftover is deliberate, not a rounding bug: a block is whole atoms, so the remainder of a
  // proportional budget is simply not spent. Saying so is cheaper than a learner counting it.
  const leftover = plan.requestedMinutes - plan.totalMinutes;
  el.textContent =
    leftover === 0
      ? `${formatMinutes(plan.totalMinutes)} min of blocks`
      : `${formatMinutes(plan.totalMinutes)} min of blocks, ${formatMinutes(leftover)} min unspent — a block is whole units, so the remainder buys nothing`;
  return el;
}

/** S1: all six ingredients, always, in the order they run. A skipped one says so at 0 minutes. */
function renderIngredients(plan: SessionPlan): HTMLElement {
  const list = document.createElement('ol');
  list.className = 'ingredient-list';
  list.dataset.testid = 'ingredient-list';

  const byKind = minutesByKind(plan);
  const units = new Map(plan.blocks.map((block) => [block.kind, block.units]));

  for (const kind of BLOCK_KINDS) {
    const minutes = byKind[kind];
    const count = units.get(kind) ?? 0;

    const row = document.createElement('li');
    row.className = 'ingredient-row';
    row.dataset.testid = 'ingredient-row';
    row.dataset.kind = kind;
    row.dataset.minutes = String(minutes);
    row.dataset.units = String(count);
    row.dataset.skipped = String(count === 0);

    row.appendChild(span('ingredient-label', BLOCK_LABELS[kind]));
    row.appendChild(span('ingredient-share', `${Math.round(SHARES[kind] * 100)}%`));

    const mins = span('ingredient-minutes', `${formatMinutes(minutes)} min`);
    mins.dataset.testid = 'ingredient-minutes';
    row.appendChild(mins);

    const atoms = span('ingredient-units', `${count} ${pluralise(kind, count)}`);
    atoms.dataset.testid = 'ingredient-units';
    row.appendChild(atoms);

    const why = reasonFor(kind, count, plan);
    if (why !== null) {
      const note = span('ingredient-why', why);
      note.dataset.testid = 'ingredient-why';
      row.appendChild(note);
    }

    list.appendChild(row);
  }

  return list;
}

/**
 * Why an ingredient is smaller than its share, said on the row rather than left to be inferred.
 * Every branch is read off the plan — the cut list, the mode, the deferral flag — so a row cannot
 * claim a reason the plan does not carry.
 */
function reasonFor(kind: BlockKind, units: number, plan: SessionPlan): string | null {
  const cut = plan.cuts.find((c) => CUT_AFFECTS[c.target] === kind);
  if (cut !== undefined) {
    const position = CUT_ORDER.indexOf(cut.target) + 1;
    return `cut ${formatMinutes(cut.minutesRemoved)} min — step ${position} of ${CUT_ORDER.length} in the cut order`;
  }
  if (units > 0) return null;
  if (kind === 'decay-probes') {
    return plan.mode === 'free-roam'
      ? 'probes never fire outside a session (S3)'
      : 'nothing is due — the freed time went to graded spots';
  }
  if (kind === 'contrast-remediation' && plan.remediationDeferred) {
    return 'deferred to the next session, not skipped (S3)';
  }
  return null;
}

/** S2: the degradation order is explicit and on screen, along with what it may never touch. */
function renderCuts(plan: SessionPlan): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'cut-panel';
  wrap.dataset.testid = 'cut-panel';
  wrap.dataset.cutCount = String(plan.cuts.length);

  wrap.appendChild(heading('What a shorter sitting gave up'));

  if (plan.cuts.length === 0) {
    const none = span('cut-none', 'Nothing was cut: every block fits at this length.');
    none.dataset.testid = 'cut-none';
    wrap.appendChild(none);
  } else {
    const list = document.createElement('ol');
    list.className = 'cut-list';
    list.dataset.testid = 'cut-list';
    for (const cut of plan.cuts) {
      const row = document.createElement('li');
      row.className = 'cut-row';
      row.dataset.testid = 'cut-row';
      row.dataset.target = cut.target;
      row.dataset.minutes = String(cut.minutesRemoved);
      row.appendChild(span('cut-label', CUT_LABELS[cut.target]));
      row.appendChild(span('cut-minutes', `−${formatMinutes(cut.minutesRemoved)} min`));
      list.appendChild(row);
    }
    wrap.appendChild(list);
  }

  const order = span(
    'cut-order',
    `Cut order: ${CUT_ORDER.map((target) => CUT_LABELS[target]).join(' → ')}.`,
  );
  order.dataset.testid = 'cut-order';
  wrap.appendChild(order);

  const protectedNote = span(
    'cut-protected',
    'Never cut: decay probes, the last contrast set, the first warm-up block.',
  );
  protectedNote.dataset.testid = 'cut-protected';
  wrap.appendChild(protectedNote);

  return wrap;
}

/** S3: a free-roam sitting must read as a deliberate mode, not as a session with holes in it. */
function renderFreeRoamNotes(plan: SessionPlan): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'free-roam-notes';
  wrap.dataset.testid = 'free-roam-notes';

  const first = span(
    'planner-note',
    'Free-roam is practice, not a session: no decay probes fire, so nothing here measures retention.',
  );
  first.dataset.testid = 'free-roam-note';
  wrap.appendChild(first);

  if (plan.remediationDeferred) {
    const deferred = span(
      'planner-note',
      'Remediation is deferred to your next session, not skipped — the repair is still owed.',
    );
    deferred.dataset.testid = 'deferred-note';
    wrap.appendChild(deferred);
  }

  return wrap;
}

function renderStart(plan: SessionPlan, onStart: () => void): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'session-card planner-start';
  button.dataset.testid = 'plan-start';
  button.dataset.minutes = String(plan.requestedMinutes);
  button.dataset.mode = plan.mode;
  button.addEventListener('click', onStart);

  const title = document.createElement('span');
  title.className = 'session-card-title';
  title.textContent =
    plan.mode === 'session'
      ? `Start ${plan.requestedMinutes}-minute session`
      : `Start ${plan.requestedMinutes}-minute free-roam sitting`;
  button.appendChild(title);

  const meta = document.createElement('span');
  meta.className = 'session-card-meta';
  const graded = plan.blocks.find((block) => block.kind === 'graded-spots');
  meta.textContent = `${graded?.units ?? 0} graded spots, sit down at the table`;
  button.appendChild(meta);

  return button;
}

/**
 * S2a. The refusal is shown with its reason and with the route out, because those two things are
 * what separate "no, and here is why, try this" from a door that does not open.
 */
function renderRefusal(minutes: number, reason: string, onFreeRoam: () => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'planner-refusal';
  wrap.dataset.testid = 'plan-refusal';
  wrap.dataset.minutes = String(minutes);

  const title = document.createElement('div');
  title.className = 'refusal-title';
  title.textContent = `There is no ${minutes}-minute session`;
  wrap.appendChild(title);

  // Core's own sentence, not a paraphrase: the arithmetic that refused is the arithmetic shown.
  const why = span('refusal-reason', reason);
  why.dataset.testid = 'refusal-reason';
  wrap.appendChild(why);

  const route = document.createElement('button');
  route.type = 'button';
  route.className = 'pill refusal-route';
  route.dataset.testid = 'refusal-route';
  route.textContent = `Practise free-roam for ${minutes} min instead`;
  route.addEventListener('click', onFreeRoam);
  wrap.appendChild(route);

  return wrap;
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

function pluralise(kind: BlockKind, count: number): string {
  const [singular, plural] = UNIT_NOUNS[kind];
  return count === 1 ? singular : plural;
}

/** Every quantity in core is a multiple of 0.25, so plain digits are exact; 4 must not read "4.00". */
function formatMinutes(minutes: number): string {
  return String(minutes);
}
