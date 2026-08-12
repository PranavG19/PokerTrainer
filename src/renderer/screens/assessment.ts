import '../styles-assessment.css';
import { AssessmentBlock, type AssessmentGrade } from '../../core/assessmentBlock.js';
import type { ActionKind, TableState } from '../../core/table.js';
import { renderCardRow } from '../components/card.js';

/**
 * ASSESSMENT screen — the weekly assessment block (P4/G2). The learner plays a fixed run of real hands
 * with the coach GRADING every decision but SAYING NOTHING: no per-spot verdict, no severity colour, no
 * "you lost 3bb" — feedback is withheld until a single end-of-block reveal. That withholding is the whole
 * point of an assessment (it measures unaided play), and it is the ONLY thing this mode changes versus
 * practice: the grades are the coach's real ones (core/assessmentBlock.ts), tagged mode:'assessment' by
 * the caller so they feed the assessment-EV-loss metric alone.
 *
 * This file is a thin renderer over AssessmentBlock — it owns no poker and no grading. Sync for e2e: the
 * root publishes data-phase / data-spot / data-total on every paint, so a test never sleeps.
 */

const HERO = 0;
const DEFAULT_SIZE = 30;
/** The action order shown on the control row, matching the table/puzzle screens. */
const ACTIONS: readonly ActionKind[] = ['fold', 'check', 'call', 'bet', 'raise'];
const ACTION_LABEL: Record<ActionKind, string> = {
  fold: 'Fold',
  check: 'Check',
  call: 'Call',
  bet: 'Bet',
  raise: 'Raise',
  allin: 'All-in',
};

export interface AssessmentOptions {
  /** Seed for the block. The caller passes the session seed so a block is reproducible per profile. */
  readonly seed: number;
  /** How many hands the block runs. Defaults to 30 (the spec's block size). */
  readonly size?: number;
  /** Persist the graded decisions when the learner finishes the reveal. Called once, with every grade. */
  readonly onComplete?: (grades: readonly AssessmentGrade[]) => void;
  /** Leave the assessment and return to where the caller mounted it. */
  readonly onExit?: () => void;
}

export function renderAssessmentScreen(options: AssessmentOptions): HTMLElement {
  const root = document.createElement('div');
  root.className = 'assessment-screen';
  root.dataset.testid = 'assessment-screen';

  const block = new AssessmentBlock({ size: options.size ?? DEFAULT_SIZE, seed: options.seed });
  /** True once the learner has dismissed the reveal, so onComplete fires exactly once. */
  let recorded = false;

  function commit(kind: ActionKind): void {
    if (block.isDone()) return;
    block.commit(kind);
    paint();
  }

  function finish(): void {
    if (!recorded) {
      recorded = true;
      options.onComplete?.(block.grades());
    }
    options.onExit?.();
  }

  function onKey(event: KeyboardEvent): void {
    if (!root.isConnected) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const spot = block.current();
    if (spot === null) return;
    const byKey: Record<string, ActionKind> = { f: 'fold', k: 'check', c: 'call', b: 'bet', r: 'raise' };
    const kind = byKey[event.key.toLowerCase()];
    if (kind && spot.legal.includes(kind)) commit(kind);
  }
  document.addEventListener('keydown', onKey);

  function paint(): void {
    const done = block.isDone();
    root.dataset.phase = done ? 'reveal' : 'acting';
    root.dataset.spot = String(block.count);
    root.dataset.total = String(block.plannedHands);
    root.replaceChildren(done ? revealBlock(block.grades(), finish) : playView(block, commit));
  }

  paint();
  return root;
}

/** The play surface: progress, the hero's view, and the action row — but NEVER a verdict. */
function playView(block: AssessmentBlock, onCommit: (kind: ActionKind) => void): HTMLElement {
  const spot = block.current();
  const el = document.createElement('div');
  el.className = 'assessment-play';

  el.appendChild(renderProgress(block));
  // A quiet reminder that feedback is coming at the end — so the silence reads as "assessment", not
  // "broken". Stated once, in the frame, not after each decision.
  const note = text('p', 'assessment-note', 'Play your best. No feedback until the end.');
  note.dataset.testid = 'assessment-note';
  el.appendChild(note);

  if (spot !== null) {
    el.appendChild(renderTable(spot.table, spot.toCall));
    el.appendChild(renderControls(spot.legal, onCommit));
  }
  return el;
}

function renderProgress(block: AssessmentBlock): HTMLElement {
  const el = document.createElement('div');
  el.className = 'assessment-progress';
  el.dataset.testid = 'assessment-progress';
  const spot = block.current();
  const hand = spot?.hand ?? block.plannedHands;
  el.textContent = `Hand ${hand} of ${block.plannedHands} · ${block.count} decision${block.count === 1 ? '' : 's'} played`;
  el.dataset.hand = String(hand);
  return el;
}

/** The hero's view of the live table. Deliberately spare — the same information the practice table shows,
 *  minus everything that would leak a judgement (no coach panel, no severity, no odds "you need X%"). */
function renderTable(state: TableState, toCall: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'assessment-table';
  el.dataset.testid = 'assessment-table';

  const pot = text('div', 'assessment-pot', `Pot ${state.pot}`);
  pot.dataset.testid = 'assessment-pot';
  el.appendChild(pot);

  const board = document.createElement('div');
  board.className = 'assessment-board';
  board.dataset.testid = 'assessment-board';
  board.appendChild(renderCardRow(state.board.length === 0 ? [] : [...state.board], { small: true }));
  if (state.board.length === 0) board.appendChild(text('span', 'assessment-board-empty', 'Preflop'));
  el.appendChild(board);

  const hero = document.createElement('div');
  hero.className = 'assessment-hero';
  hero.appendChild(text('div', 'assessment-hero-label', 'Your hand'));
  const heroCards = renderCardRow([...state.seats[HERO].hole]);
  heroCards.dataset.testid = 'assessment-hero-cards';
  hero.appendChild(heroCards);
  const stack = state.seats[HERO].stack;
  hero.appendChild(
    text('div', 'assessment-hero-stack', toCall > 0 ? `Stack ${stack} · to call ${toCall}` : `Stack ${stack}`),
  );
  el.appendChild(hero);
  return el;
}

function renderControls(legal: readonly ActionKind[], onCommit: (kind: ActionKind) => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'assessment-controls';
  el.dataset.testid = 'assessment-controls';
  for (const kind of ACTIONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pill';
    b.dataset.testid = `assessment-${kind}`;
    b.appendChild(document.createTextNode(ACTION_LABEL[kind]));
    const hint = document.createElement('span');
    hint.className = 'assessment-key-hint';
    hint.textContent = kind.charAt(0).toUpperCase();
    b.appendChild(hint);
    b.disabled = !legal.includes(kind);
    b.addEventListener('click', () => onCommit(kind));
    el.appendChild(b);
  }
  return el;
}

/**
 * The single end-of-block reveal — the ONLY place the assessment shows a judgement. It reports the block's
 * average EV loss (the metric the block feeds), the sample it was measured over, and a plain severity
 * breakdown, then a Done button that persists the decisions and exits. Reads as a summary, not per-hand
 * coaching: the point is where the learner stands, not a replay of each spot.
 */
function revealBlock(grades: readonly AssessmentGrade[], onDone: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'assessment-reveal';
  el.dataset.testid = 'assessment-reveal';

  el.appendChild(text('h2', 'assessment-reveal-title', 'Assessment complete'));

  const n = grades.length;
  const meanBb100 = n === 0 ? 0 : (grades.reduce((s, g) => s + g.grade.evLossBb, 0) / n) * 100;
  const score = text('div', 'assessment-score', `${meanBb100.toFixed(1)} bb/100 EV lost`);
  score.dataset.testid = 'assessment-score';
  score.dataset.bb100 = meanBb100.toFixed(2);
  el.appendChild(score);

  const sample = text('div', 'assessment-sample stat-label', `over ${n} decision${n === 1 ? '' : 's'}`);
  sample.dataset.testid = 'assessment-sample';
  sample.dataset.count = String(n);
  el.appendChild(sample);

  const counts = { free: 0, notable: 0, serious: 0 };
  for (const g of grades) counts[g.grade.severity] += 1;
  const spread = text(
    'div',
    'assessment-spread',
    `${counts.free} fine · ${counts.notable} notable · ${counts.serious} serious`,
  );
  spread.dataset.testid = 'assessment-spread';
  spread.dataset.free = String(counts.free);
  spread.dataset.notable = String(counts.notable);
  spread.dataset.serious = String(counts.serious);
  el.appendChild(spread);

  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'pill assessment-done';
  done.dataset.testid = 'assessment-done';
  done.textContent = 'Done';
  done.addEventListener('click', onDone);
  el.appendChild(done);
  return el;
}

function text(tag: string, className: string, content: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = content;
  return el;
}
