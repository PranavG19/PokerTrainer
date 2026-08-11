import '../styles-puzzle.css';
// The tutor rail's styles live in styles-lesson.css (where the rail first shipped). Import it here
// too so the rail is styled from this screen independently of whether the lesson screen is built.
import '../styles-lesson.css';
import type { ActionKind, TableState } from '../../core/table.js';
import { applyAction, legalActions, minRaiseTo } from '../../core/table.js';
import {
  buildScenarioTable,
  gradeStep,
  isComplete,
  type Scenario,
  type StepVerdict,
} from '../../core/puzzle.js';
import { SCENARIOS } from '../../core/puzzleScenarios.js';
import { renderCardRow } from '../components/card.js';
import { renderTutorRail, type RailContext, type RailTable } from '../components/tutorRail.js';

/**
 * PUZZLE MODE screen — walk the scenario library, one taught spot at a time.
 *
 * The screen owns a live TableState built from the scenario (buildScenarioTable), advances villains
 * by the scenario's script, and stops on each HERO decision. The learner picks an action; the screen
 * grades that step against the target line (core/puzzle.ts gradeStep) — comparing the action KIND,
 * because a puzzle teaches "raise here", not a size — shows the explanation right or wrong, then plays
 * villains forward to the next hero decision or the end. Nothing here re-implements poker: legality
 * comes from the engine (legalActions), grading from core, so this file has no rule of its own.
 *
 * Sync for e2e: the root publishes data-phase / data-step / data-verdict / data-scenario on every
 * paint, so a test never sleeps.
 */

const HERO = 0;

interface StepRecord {
  readonly verdict: StepVerdict;
}

export function renderPuzzleScreen(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'puzzle-screen';
  root.dataset.testid = 'puzzle-screen';

  let scenarioIndex = 0;
  let state: TableState = buildScenarioTable(SCENARIOS[0]);
  let stepIndex = 0;
  let villainAt = 0;
  let lastVerdict: StepVerdict | null = null;
  const records: StepRecord[] = [];

  const scenario = (): Scenario => SCENARIOS[scenarioIndex];

  /**
   * The tutor rail, built ONCE so its transcript survives every paint (paint replaceChildren's the
   * body, but re-appends this same node — same pattern as lesson.ts). The learner can ask the tutor
   * to go deeper on the spot; the rail routes through the same guarded tutor:ask IPC as everywhere
   * else, so nothing here can leak a solver number the mute matrix would withhold.
   */
  let rail: HTMLElement | null = null;

  /**
   * Which T5 row the rail sits in. A puzzle spot is pre-commit UNTIL the learner has answered this
   * step — then it flips post-reveal, where strategy questions about the graded decision are allowed.
   * A completed scenario is post-reveal too: every decision is made. Before the first answer it is
   * pre-commit, the stricter cell, so a learner cannot ask the tutor for the answer before deciding.
   */
  const railContext = (): RailContext =>
    lastVerdict !== null || isComplete(scenario(), stepIndex) ? 'spot-post-reveal' : 'spot-pre-commit';

  /** The visible table for the current spot — only what the learner can already see on screen. */
  const railTable = (): RailTable => {
    const s = scenario();
    const inBb = (chips: number): number => Math.round((chips / s.bigBlind) * 10) / 10;
    return {
      positions: state.seats.map((seat) => seatName(s, seat.id)),
      stacksBb: state.seats.map((seat) => inBb(seat.stack)),
      potBb: inBb(state.pot),
      board: [...state.board],
      heroCards: [...state.seats[HERO].hole],
      toAct: seatName(s, state.toAct),
      street: state.street === 'showdown' ? 'river' : state.street,
    };
  };

  function railSeam(): HTMLElement {
    const seam = document.createElement('aside');
    seam.className = 'puzzle-rail';
    seam.dataset.testid = 'puzzle-tutor-rail';
    rail ??= renderTutorRail({ context: railContext, table: railTable });
    seam.appendChild(rail);
    return seam;
  }

  /** Advance villains by the script until it is the hero's turn, the hand ends, or the line is done. */
  function advanceToHero(): void {
    for (let guard = 0; guard < 40; guard++) {
      if (state.winners !== null || state.street === 'showdown') return;
      if (isComplete(scenario(), stepIndex)) return;
      const legal = legalActions(state);
      if (legal.length === 0) return;
      if (state.toAct === HERO) return;
      const scripted = scenario().villainScript[villainAt];
      villainAt += 1;
      state = applyAction(state, legalize(state, scripted?.kind ?? 'fold', scripted?.to));
    }
  }

  function loadScenario(index: number): void {
    scenarioIndex = ((index % SCENARIOS.length) + SCENARIOS.length) % SCENARIOS.length;
    state = buildScenarioTable(scenario());
    stepIndex = 0;
    villainAt = 0;
    lastVerdict = null;
    records.length = 0;
    advanceToHero();
    paint();
  }

  function takeAction(kind: ActionKind): void {
    if (state.toAct !== HERO || isComplete(scenario(), stepIndex)) return;
    if (lastVerdict !== null) return; // an ungraded verdict is on screen; the learner must advance first
    const verdict = gradeStep(scenario(), stepIndex, kind);
    records.push({ verdict });
    lastVerdict = verdict;
    // Play the hero's chosen action into the engine so the hand progresses to the next spot.
    state = applyAction(state, legalize(state, kind));
    stepIndex += 1;
    paint();
  }

  /** Dismiss the verdict and move the hand to the next hero decision (or reveal completion). */
  function continueOn(): void {
    lastVerdict = null;
    advanceToHero();
    paint();
  }

  function paint(): void {
    const s = scenario();
    const done = isComplete(s, stepIndex);
    root.dataset.scenario = s.id;
    root.dataset.step = String(stepIndex);
    root.dataset.total = String(s.target.length);
    root.dataset.phase = lastVerdict !== null ? 'graded' : done ? 'complete' : 'acting';
    root.dataset.verdict = lastVerdict === null ? '' : lastVerdict.correct ? 'right' : 'wrong';
    root.dataset.correct = String(records.filter((r) => r.verdict.correct).length);

    root.replaceChildren(
      header(s),
      table(s),
      lastVerdict !== null ? verdictBlock(lastVerdict) : done ? completeBlock(s) : controls(),
      railSeam(),
    );
  }

  // ── rendering ──────────────────────────────────────────────────────────────

  function header(s: Scenario): HTMLElement {
    const el = document.createElement('div');
    el.className = 'puzzle-header';
    el.appendChild(text('div', 'puzzle-picker-label', `Puzzle ${scenarioIndex + 1} of ${SCENARIOS.length}`));
    const title = text('h2', 'puzzle-title', s.title);
    title.dataset.testid = 'puzzle-title';
    el.appendChild(title);
    const setup = text('p', 'puzzle-setup', s.setup);
    setup.dataset.testid = 'puzzle-setup';
    el.appendChild(setup);
    return el;
  }

  function table(s: Scenario): HTMLElement {
    const el = document.createElement('div');
    el.className = 'puzzle-table';

    const potLine = text('div', 'puzzle-pot', `Pot ${state.pot} · to act: ${seatName(s, state.toAct)}`);
    potLine.dataset.testid = 'puzzle-pot';
    el.appendChild(potLine);

    const board = document.createElement('div');
    board.className = 'puzzle-board';
    board.dataset.testid = 'puzzle-board';
    board.appendChild(renderCardRow(state.board.length === 0 ? [] : [...state.board], { small: true }));
    if (state.board.length === 0) board.appendChild(text('span', 'puzzle-board-empty', 'Preflop'));
    el.appendChild(board);

    const hero = document.createElement('div');
    hero.className = 'puzzle-hero';
    hero.appendChild(text('div', 'puzzle-hero-label', `Your hand (${seatName(s, HERO)})`));
    const heroCards = renderCardRow([...state.seats[HERO].hole]);
    heroCards.dataset.testid = 'puzzle-hero-cards';
    hero.appendChild(heroCards);
    hero.appendChild(text('div', 'puzzle-hero-stack', `Stack ${state.seats[HERO].stack} · committed ${state.seats[HERO].committed}`));
    el.appendChild(hero);
    return el;
  }

  function controls(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'puzzle-controls';
    el.dataset.testid = 'puzzle-controls';
    const legal = state.toAct === HERO ? legalActions(state) : [];
    for (const kind of ['fold', 'check', 'call', 'bet', 'raise'] as ActionKind[]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pill';
      b.dataset.testid = `puzzle-${kind}`;
      b.textContent = actionLabel(kind);
      b.disabled = !legal.includes(kind);
      b.addEventListener('click', () => takeAction(kind));
      el.appendChild(b);
    }
    return el;
  }

  function verdictBlock(verdict: StepVerdict): HTMLElement {
    const el = document.createElement('div');
    el.className = 'puzzle-verdict';
    el.dataset.testid = 'puzzle-verdict';
    el.dataset.correct = String(verdict.correct);

    const head = text(
      'div',
      'puzzle-verdict-head',
      verdict.correct
        ? `Correct — ${actionLabel(verdict.expected)} is the play.`
        : `Not quite — you ${actionLabel(verdict.played).toLowerCase()}, the play is ${actionLabel(verdict.expected).toLowerCase()}.`,
    );
    head.dataset.testid = 'puzzle-verdict-head';
    el.appendChild(head);

    const why = text('p', 'puzzle-explanation', verdict.explanation);
    why.dataset.testid = 'puzzle-explanation';
    el.appendChild(why);

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'pill';
    next.dataset.testid = 'puzzle-continue';
    next.textContent = 'Continue';
    next.addEventListener('click', continueOn);
    el.appendChild(next);
    return el;
  }

  function completeBlock(s: Scenario): HTMLElement {
    const el = document.createElement('div');
    el.className = 'puzzle-complete';
    el.dataset.testid = 'puzzle-complete';
    const correct = records.filter((r) => r.verdict.correct).length;
    el.appendChild(
      text('div', 'puzzle-score', `You played ${correct} of ${s.target.length} decisions the GTO way.`),
    );
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'pill';
    next.dataset.testid = 'puzzle-next-scenario';
    next.textContent = scenarioIndex + 1 < SCENARIOS.length ? 'Next puzzle' : 'Back to the first puzzle';
    next.addEventListener('click', () => loadScenario(scenarioIndex + 1));
    el.appendChild(next);

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'pill';
    retry.dataset.testid = 'puzzle-retry';
    retry.textContent = 'Replay this puzzle';
    retry.addEventListener('click', () => loadScenario(scenarioIndex));
    el.appendChild(retry);
    return el;
  }

  // Initial paint (advanceToHero already ran in the closure setup below).
  advanceToHero();
  paint();
  return root;
}

// ── helpers ────────────────────────────────────────────────────────────────

/** Coerce an intended action to a legal engine Action for the seat to act. Mirrors the core test. */
function legalize(state: TableState, kind: ActionKind, to?: number): { kind: ActionKind; amount?: number } {
  const legal = legalActions(state);
  if (kind === 'raise' || kind === 'bet') {
    if (legal.includes('raise')) return { kind: 'raise', amount: to ?? minRaiseTo(state) };
    if (legal.includes('bet')) return { kind: 'bet', amount: to ?? minRaiseTo(state) };
    return { kind: legal.includes('call') ? 'call' : legal.includes('check') ? 'check' : 'fold' };
  }
  if (kind === 'check' && !legal.includes('check')) return { kind: legal.includes('call') ? 'call' : 'fold' };
  if (kind === 'call' && !legal.includes('call')) return { kind: legal.includes('check') ? 'check' : 'fold' };
  return { kind };
}

function seatName(s: Scenario, seat: number): string {
  return seat === HERO ? 'Hero' : `V${seat}`;
}

function actionLabel(kind: ActionKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function text(tag: string, className: string, content: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = content;
  return el;
}
