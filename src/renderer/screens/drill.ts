import '../styles-drill.css';

import {
  COMMITTED_SPR,
  DEEP_SPR,
  DRILL_KINDS,
  defence,
  generateProblem,
  gradeAnswer,
  naturalFrequency,
  potOdds,
  spr,
  type ArithmeticProblem,
  type DrillKind,
  type Grading,
} from '../../core/arithmetic.js';
import {
  LEAST_SUPPORT_RUNG,
  RESTORE_STREAK,
  applyEvent,
  deriveState,
  initialState,
  supportFor,
  type FadingEvent,
  type FadingState,
  type Rung,
  type SupportLevel,
} from '../../core/fading.js';

/**
 * THE DRILL TAB — the arithmetic trainer. A PURE READER over src/core/arithmetic.ts: every number
 * on screen comes back out of generateProblem / potOdds / defence / spr / naturalFrequency /
 * gradeAnswer, and this file contains no formula of its own. Nothing was added to core for it.
 *
 * Three decisions worth stating, because each looks arbitrary and is not:
 *
 * THE SEED IS THE PROBLEM'S IDENTITY, and it is derived from the position in the sequence alone —
 * not from the kind. So switching kind at the same position keeps the pot and the bet and changes
 * only the question asked about them, which is core's own point about alpha and MDF: one division,
 * two seats. It also makes replay trivially checkable — leave the kind and come back, or leave the
 * tab and come back, and the same seed rebuilds the same problem.
 *
 * THE ANSWER IS TYPED IN THE UNIT THE QUESTION IS ASKED IN: percentage points for the three
 * probability kinds, a bare ratio for SPR. The unit is printed beside the box, and grading divides
 * percentage input by 100 before handing it to gradeAnswer — the tolerance is core's
 * PROBABILITY_TOLERANCE / sprTolerance, carried on the problem, and this file never invents one.
 *
 * A WRONG ANSWER IS NEVER JUST WRONG. The commit always builds the worked method: the same
 * arithmetic laid out line by line, the learner's own number printed beside the right one, and the
 * band core's tolerance actually allows. G3 keeps the mirror image true as well — a correct answer
 * gets no praise, just the method it should have used.
 *
 * SCAFFOLDING FADES PER KIND (T6/T7, core/fading.ts). Each DrillKind is a faded concept. A learner
 * who keeps getting a kind right no longer needs the full worked method every time, so support is
 * withdrawn a rung at a time: rung 0 shows the whole method (the behaviour above, and what a fresh
 * session always starts on), then the method contracts to the answer, then to the principle line,
 * then to a bare verdict. The rungs come from `supportFor` and the promotion — three consecutive
 * correct with no hint owed, per core's own RESTORE_STREAK — is the ONLY upward step; the accuracy
 * rule inside core drops a rung back on a bad run. The fade stops at rung 3: the drill is an
 * immediate-feedback surface, and rung 4 (batched self-marked review) is a different interaction that
 * belongs to a review surface, not here. The event log persists so the ladder is not reset each launch.
 */

/** Fixed base: the sequence must be identical on every launch for the e2e suite to pin it. */
const BASE_SEED = 101;

/**
 * The drill fades no further than rung 3 ("bare incorrect"). Rung 4 is batched self-marked review —
 * a deferred-feedback interaction that contradicts this screen's immediate-verdict contract — so it is
 * left for a review surface. Asserted against core so a change to the ladder is noticed here.
 */
const DRILL_MAX_RUNG: Rung = 3;
if (DRILL_MAX_RUNG >= LEAST_SUPPORT_RUNG) {
  throw new Error('drill fade cap must stay below core LEAST_SUPPORT_RUNG (rung 4 is self-marked review)');
}

const seedFor = (index: number): number => BASE_SEED + index;

/**
 * Display names and answer units, keyed by DrillKind so this fails to compile the day core adds a
 * kind — an unlabelled kind silently rendering as "spr" would be worse than a build error.
 */
const KINDS: Record<DrillKind, { label: string; asks: string; unit: '%' | '' }> = {
  'pot-odds': { label: 'Pot odds', asks: 'the equity a call needs', unit: '%' },
  alpha: { label: 'Alpha', asks: 'how often a bluff needs a fold', unit: '%' },
  mdf: { label: 'MDF', asks: 'the share you must defend', unit: '%' },
  spr: { label: 'SPR', asks: 'stack-to-pot ratio', unit: '' },
};

interface Tally {
  attempted: number;
  correct: number;
}

interface Committed {
  readonly problem: ArithmeticProblem;
  /** Exactly what the learner typed, kept verbatim so it can be shown back to them. */
  readonly typed: string;
  /** The typed value converted into the unit core grades in. */
  readonly given: number;
  readonly grading: Grading;
}

export interface DrillOptions {
  /**
   * The persisted fading event log, rehydrated so a concept faded across sittings stays faded. Absent
   * or empty → every kind starts at rung 0 (worked examples), which is the pre-fading behaviour.
   */
  readonly fadingLog?: readonly FadingEvent[];
  /** Persist newly-appended fading events. Called on each commit; main.ts folds them in and saves. */
  readonly onFadingEvents?: (events: readonly FadingEvent[]) => void;
}

export function renderDrillScreen(options: DrillOptions = {}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'drill-screen';
  root.dataset.testid = 'drill-screen';

  const tallies = new Map<DrillKind, Tally>(
    DRILL_KINDS.map((kind) => [kind, { attempted: 0, correct: 0 }]),
  );

  // Per-kind fading state, derived from the persisted log. The conceptId IS the DrillKind, so a kind's
  // scaffolding is remembered independently of the others — mastering pot-odds does not fade SPR.
  const fadingLog: FadingEvent[] = [...(options.fadingLog ?? [])];
  const fadingState = new Map<DrillKind, FadingState>(
    DRILL_KINDS.map((kind) => [kind, deriveState(kind, fadingLog)]),
  );

  let kind: DrillKind = DRILL_KINDS[0];
  let index = 0;
  let problem = generateProblem(seedFor(index), kind);
  let committed: Committed | null = null;
  /** Set when a commit was attempted with nothing readable in the box. Not an error state. */
  let unreadable = false;
  /** Monotonic commit counter: the e2e sync oracle, so no test ever sleeps. */
  let commits = 0;

  function selectKind(next: DrillKind): void {
    if (next === kind) return;
    kind = next;
    // Same seed, new question. The verdict belongs to the old question, so it goes.
    problem = generateProblem(seedFor(index), kind);
    committed = null;
    unreadable = false;
    paint();
  }

  function commit(): void {
    if (committed !== null) return;
    const typed = box().value.trim();
    const parsed = parseTyped(typed);
    if (parsed === null) {
      unreadable = true;
      paint();
      return;
    }
    const given = KINDS[problem.kind].unit === '%' ? parsed / 100 : parsed;
    const grading = gradeAnswer(problem, given);

    const tally = tallies.get(problem.kind);
    if (tally) {
      tally.attempted += 1;
      if (grading.correct) tally.correct += 1;
    }

    recordFading(problem.kind, grading.correct);

    committed = { problem, typed, given, grading };
    unreadable = false;
    commits += 1;
    paint();
  }

  /**
   * Fold this graded answer into the kind's fading state, then apply the promotion rule: three
   * consecutive correct with no hint debt owed earns one rung of fade (up to rung 3 on this screen).
   * The promotion is the ONLY upward step — core's own accuracy rule handles drops on a bad run. Both
   * the graded event and any earned fade are appended to the log and handed up for persistence, so the
   * ladder survives a restart.
   */
  function recordFading(kind: DrillKind, correct: boolean): void {
    const graded: FadingEvent = { kind: 'graded', conceptId: kind, at: Date.now(), correct };
    const emitted: FadingEvent[] = [graded];
    let next = applyEvent(fadingState.get(kind) ?? initialState(kind), graded);

    if (next.consecutiveCorrect === RESTORE_STREAK && next.hintDebt === 0 && next.rung < DRILL_MAX_RUNG) {
      const faded: FadingEvent = { kind: 'supportFaded', conceptId: kind, at: Date.now() };
      emitted.push(faded);
      next = applyEvent(next, faded);
    }

    fadingState.set(kind, next);
    fadingLog.push(...emitted);
    options.onFadingEvents?.(emitted);
  }

  function next(): void {
    index += 1;
    problem = generateProblem(seedFor(index), kind);
    committed = null;
    unreadable = false;
    paint();
  }

  /** The live answer box, or a detached throwaway if the screen is showing a verdict instead. */
  function box(): HTMLInputElement {
    const el = root.querySelector<HTMLInputElement>('[data-testid="drill-answer"]');
    return el ?? document.createElement('input');
  }

  /**
   * Enter commits, Enter again advances. Bound to the window because the box is the only focusable
   * thing on the screen and the learner may have clicked a kind button instead, and self-removing
   * once the root is detached: main.ts's renderTab has no teardown hook, so a listener that
   * outlived this element would steal Enter from the table screen.
   */
  function onKey(event: KeyboardEvent): void {
    if (!root.isConnected) {
      window.removeEventListener('keydown', onKey);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (committed === null) commit();
    else next();
  }
  window.addEventListener('keydown', onKey);

  function paint(): void {
    const support = supportFor(fadingState.get(kind) ?? initialState(kind));
    // The screen's sync oracle: every e2e wait keys off these attributes, never a sleep.
    root.dataset.kind = kind;
    root.dataset.seed = String(seedFor(index));
    root.dataset.index = String(index);
    root.dataset.phase = committed === null ? 'answer' : 'graded';
    root.dataset.commits = String(commits);
    root.dataset.verdict =
      committed === null ? '' : committed.grading.correct ? 'right' : 'wrong';
    // The current kind's scaffolding rung, so the e2e can assert the fade without reading the log.
    root.dataset.rung = String(support.rung);
    root.dataset.support = support.id;

    root.replaceChildren(
      renderSidebar({ kind, tallies, onSelect: selectKind, support }),
      renderWork({ problem, committed, unreadable, rung: support.rung, onCommit: commit, onNext: next }),
    );

    // Keyboard-first: the box takes focus on every paint that has one, so a learner can type the
    // next answer straight after Enter without reaching for the mouse.
    if (committed === null) box().focus();
  }

  paint();
  return root;
}

// ---------------------------------------------------------------------------
// Sidebar: which kind, and how this session is going
// ---------------------------------------------------------------------------

function renderSidebar(opts: {
  kind: DrillKind;
  tallies: ReadonlyMap<DrillKind, Tally>;
  onSelect: (kind: DrillKind) => void;
  support: SupportLevel;
}): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'drill-side';
  panel.dataset.testid = 'drill-side';

  panel.appendChild(text('div', 'stat-label', 'Drilling'));

  // The current kind is named in words, not only marked on a button: the selector could be
  // scrolled or missed, and "which question am I answering" must never be a guess.
  const now = text('div', 'drill-now', KINDS[opts.kind].label);
  now.dataset.testid = 'drill-current-kind';
  now.dataset.kind = opts.kind;
  panel.appendChild(now);
  panel.appendChild(text('div', 'drill-now-asks', KINDS[opts.kind].asks));

  // T6/T7: the current scaffolding level for this kind, named so the fade is legible rather than a
  // silent shrinking of the panel. Rung 0 says the method is on; higher rungs say it is being withdrawn.
  const support = text(
    'div',
    'drill-support',
    opts.support.rung === 0
      ? 'Full worked method'
      : `Scaffolding faded: ${opts.support.description}`,
  );
  support.dataset.testid = 'drill-support';
  support.dataset.rung = String(opts.support.rung);
  support.dataset.support = opts.support.id;
  panel.appendChild(support);

  panel.appendChild(renderKindSelector(opts.kind, opts.onSelect));

  panel.appendChild(text('div', 'stat-label', 'This session'));
  panel.appendChild(renderTallies(opts.tallies));
  panel.appendChild(
    text(
      'p',
      'drill-note',
      'The tally is this visit only — nothing here is written to disk, and leaving the tab clears it.',
    ),
  );
  panel.appendChild(
    text(
      'p',
      'drill-note',
      'Every problem is built from its seed, so the same seed is always the same problem.',
    ),
  );

  return panel;
}

function renderKindSelector(
  kind: DrillKind,
  onSelect: (kind: DrillKind) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'drill-kinds';
  row.dataset.testid = 'drill-kinds';

  for (const candidate of DRILL_KINDS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pill drill-kind-btn';
    button.dataset.testid = 'drill-kind-btn';
    button.dataset.kind = candidate;
    button.dataset.active = String(candidate === kind);
    button.textContent = KINDS[candidate].label;
    button.addEventListener('click', () => onSelect(candidate));
    row.appendChild(button);
  }

  return row;
}

function renderTallies(tallies: ReadonlyMap<DrillKind, Tally>): HTMLElement {
  const list = document.createElement('ol');
  list.className = 'drill-tallies';

  let attempted = 0;
  let correct = 0;

  for (const kind of DRILL_KINDS) {
    const tally = tallies.get(kind) ?? { attempted: 0, correct: 0 };
    attempted += tally.attempted;
    correct += tally.correct;

    const row = document.createElement('li');
    row.className = 'drill-tally-row';
    row.dataset.testid = 'drill-tally';
    row.dataset.kind = kind;
    row.dataset.attempted = String(tally.attempted);
    row.dataset.correct = String(tally.correct);
    row.appendChild(text('span', 'drill-tally-label', KINDS[kind].label));
    row.appendChild(
      text(
        'span',
        'drill-tally-score',
        tally.attempted === 0 ? 'not tried' : `${tally.correct} of ${tally.attempted}`,
      ),
    );
    list.appendChild(row);
  }

  const total = document.createElement('li');
  total.className = 'drill-tally-row drill-tally-total';
  total.dataset.testid = 'drill-tally-total';
  total.dataset.attempted = String(attempted);
  total.dataset.correct = String(correct);
  total.appendChild(text('span', 'drill-tally-label', 'All kinds'));
  total.appendChild(
    text(
      'span',
      'drill-tally-score',
      attempted === 0 ? 'not tried' : `${correct} of ${attempted}`,
    ),
  );
  list.appendChild(total);

  return list;
}

// ---------------------------------------------------------------------------
// The problem, the box, and the worked method
// ---------------------------------------------------------------------------

/**
 * The one-sentence principle per kind, shown at rung 2 in place of the worked method: the name of the
 * idea the learner is now expected to carry unaided. Read as the last method step's claim, kept here so
 * the principle rung has a source that does not depend on rebuilding the full method.
 */
const PRINCIPLES: Record<DrillKind, string> = {
  'pot-odds': 'Pot odds: your call over the pot it would close, including the call itself.',
  alpha: 'Alpha: the bet over the pot it creates — how often a bluff needs a fold.',
  mdf: 'MDF: everything alpha is not — defend enough that folding more would print a bluff.',
  spr: 'SPR: stack behind over the pot — how many bets stand between here and all-in.',
};

/**
 * T7's ladder decides HOW MUCH of the correction shows, never whether the answer was graded:
 *   rung 0 — the full worked method (the default, and what a fresh session always shows).
 *   rung 1 — the correction: the learner's number beside the right one, but no step-by-step method.
 *   rung 2 — the principle named, without the figures — recall the idea, not the arithmetic.
 *   rung 3 — a bare verdict: inside the band or not, and nothing else.
 * The verdict line itself is shown at every rung, because "was I right" is never the scaffolding.
 */
function renderWork(opts: {
  problem: ArithmeticProblem;
  committed: Committed | null;
  unreadable: boolean;
  rung: Rung;
  onCommit: () => void;
  onNext: () => void;
}): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'drill-work';
  panel.dataset.testid = 'drill-work';

  const prompt = text('p', 'drill-prompt-text', opts.problem.prompt);
  prompt.dataset.testid = 'drill-prompt';
  panel.appendChild(prompt);

  if (opts.committed === null) {
    panel.appendChild(renderAnswerRow(opts.problem, opts.unreadable, opts.onCommit));
    return panel;
  }

  panel.appendChild(renderVerdict(opts.committed, opts.rung));
  if (opts.rung === 0) panel.appendChild(renderMethod(opts.committed.problem));

  const advance = document.createElement('button');
  advance.type = 'button';
  advance.className = 'pill drill-next';
  advance.dataset.testid = 'drill-next';
  advance.textContent = 'Next problem — Enter';
  advance.addEventListener('click', opts.onNext);
  panel.appendChild(advance);

  return panel;
}

function renderAnswerRow(
  problem: ArithmeticProblem,
  unreadable: boolean,
  onCommit: () => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'drill-answer-row';

  const field = document.createElement('div');
  field.className = 'drill-field';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'drill-answer';
  input.dataset.testid = 'drill-answer';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  input.placeholder = KINDS[problem.kind].unit === '%' ? 'e.g. 25' : 'e.g. 2.5';
  field.appendChild(input);

  // The unit is beside the box, not implied: "25" and "0.25" are both plausible answers to a
  // question about a share, and only one of them is what this box wants.
  const unit = text('span', 'drill-unit', KINDS[problem.kind].unit === '%' ? '%' : ': 1');
  unit.dataset.testid = 'drill-unit';
  field.appendChild(unit);
  wrap.appendChild(field);

  const send = document.createElement('button');
  send.type = 'button';
  send.className = 'pill drill-commit';
  send.dataset.testid = 'drill-commit';
  send.textContent = 'Commit — Enter';
  send.addEventListener('click', onCommit);
  wrap.appendChild(send);

  const hint = text(
    'p',
    'drill-hint',
    unreadable
      ? 'That was not a number, so nothing was committed. Type digits — a decimal point is fine.'
      : KINDS[problem.kind].unit === '%'
        ? 'Answer in percentage points. Enter commits; the method appears whether you are right or not.'
        : 'Answer as a ratio of the pot. Enter commits; the method appears whether you are right or not.',
  );
  hint.dataset.testid = 'drill-hint';
  hint.dataset.unreadable = String(unreadable);
  wrap.appendChild(hint);

  return wrap;
}

/**
 * The learner's number beside the right one, and the band core actually allows — SHOWN IN FULL AT
 * RUNG 0-1 ONLY. At rung 2 the figures are withdrawn and the principle is named instead; at rung 3
 * only the bare verdict line remains. The verdict line is present at every rung, because whether the
 * answer was inside the band is the grade, not the scaffolding.
 *
 * V2: no colour and no icon. Right and wrong are told apart by wording and type weight, and the
 * two numbers sit in the same layout either way so a miss is a comparison rather than a rebuke.
 */
function renderVerdict(committed: Committed, rung: Rung): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'drill-verdict';
  wrap.dataset.testid = 'drill-verdict';
  wrap.dataset.verdict = committed.grading.correct ? 'right' : 'wrong';
  wrap.dataset.rung = String(rung);

  const line = text(
    'div',
    'drill-verdict-line',
    committed.grading.correct ? 'Inside the band.' : 'Outside the band.',
  );
  line.dataset.testid = 'drill-verdict-line';
  wrap.appendChild(line);

  // Rung 3: the bare verdict is the whole of it. No figures, no principle.
  if (rung >= 3) return wrap;

  // Rung 2: name the principle, withhold the figures — recall the idea unaided.
  if (rung === 2) {
    const principle = text('p', 'drill-principle', PRINCIPLES[committed.problem.kind]);
    principle.dataset.testid = 'drill-principle';
    wrap.appendChild(principle);
    return wrap;
  }

  // Rung 0-1: the learner's number beside the right one, and the size of the miss.
  const pair = document.createElement('div');
  pair.className = 'drill-pair';

  pair.appendChild(
    figure('drill-yours', 'You said', inUnit(committed.problem.kind, committed.given)),
  );
  pair.appendChild(
    figure('drill-right', 'The answer', inUnit(committed.problem.kind, committed.problem.answer)),
  );
  wrap.appendChild(pair);

  const gap = text('p', 'drill-gap', gapSentence(committed));
  gap.dataset.testid = 'drill-gap';
  wrap.appendChild(gap);

  return wrap;
}

/**
 * The size of the miss beside the band core allowed.
 *
 * BOTH NUMBERS ARE ROUNDED FOR DISPLAY, AND THE ROUNDING MUST NOT INVERT THE VERDICT. 31.33 against
 * 33.33% is 2.0033 points out — outside core's 2-point band — but rounds to "2 points", so the panel
 * read "Outside the band. You were 2 points under. Anything within 2 points counts.", which a
 * learner can only take for a bug. The same tie appears on SPR, where the band itself rounds up
 * (0.3463 shown as 0.35) and a 0.3509 miss also shows as 0.35.
 *
 * A hit cannot produce the mirror of this — rounding is monotonic, so a gap inside the band never
 * rounds above it — so only the miss needs handling, and it is handled by stating the gap as a
 * comparison rather than a figure: true at every precision, and it never understates the band or
 * overstates the miss.
 */
function gapSentence(committed: Committed): string {
  const { problem, grading } = committed;
  const tail = `Anything within ${band(problem)} counts.`;
  if (grading.error === 0) return `Exactly on it. ${tail}`;

  const direction = grading.error > 0 ? 'over' : 'under';
  const shownGap = round2(inUnitValue(problem.kind, Math.abs(grading.error)));
  const shownBand = round2(inUnitValue(problem.kind, problem.tolerance));
  if (!grading.correct && shownGap <= shownBand) {
    return `You were more than ${band(problem)} ${direction}. ${tail}`;
  }
  return `You were ${amount(problem.kind, Math.abs(grading.error))} ${direction}. ${tail}`;
}

function figure(testid: string, label: string, value: string): HTMLElement {
  const cell = document.createElement('div');
  cell.className = 'drill-figure';
  const figureValue = text('div', 'drill-figure-value', value);
  figureValue.dataset.testid = testid;
  cell.appendChild(figureValue);
  cell.appendChild(text('div', 'stat-label', label));
  return cell;
}

/** The tolerance core put on this problem, said in the unit the learner answered in. */
function band(problem: ArithmeticProblem): string {
  return KINDS[problem.kind].unit === '%'
    ? `${trim(problem.tolerance * 100)} points`
    : `${trim(problem.tolerance)}`;
}

function renderMethod(problem: ArithmeticProblem): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'drill-method';
  wrap.dataset.testid = 'drill-method';

  wrap.appendChild(text('div', 'stat-label', 'The method, step by step'));

  const list = document.createElement('ol');
  list.className = 'drill-steps';
  for (const step of methodSteps(problem)) {
    const item = document.createElement('li');
    item.className = 'drill-step';
    item.dataset.testid = 'drill-step';
    item.textContent = step;
    list.appendChild(item);
  }
  wrap.appendChild(list);

  return wrap;
}

/**
 * The worked arithmetic. Every value in every line is read back out of core — potOdds, defence,
 * spr and naturalFrequency — so a change to core's arithmetic changes what is taught here, and
 * this function can never drift into teaching a formula core does not implement.
 */
function methodSteps(problem: ArithmeticProblem): readonly string[] {
  const { potBeforeBet, bet, effectiveStack } = problem;

  if (problem.kind === 'pot-odds') {
    const odds = potOdds(potBeforeBet, bet, effectiveStack);
    return [
      `The pot was ${trim(potBeforeBet)} bb before the bet, and the bet is ${trim(bet)} bb.`,
      `Your call lands in the pot too, so what you are buying is ${trim(potBeforeBet)} + ${trim(bet)} + ${trim(odds.toCall)} = ${trim(odds.potAfterCall)} bb.`,
      `Your share of it is your call over that total: ${trim(odds.toCall)} / ${trim(odds.potAfterCall)}.`,
      `${trim(odds.toCall)} / ${trim(odds.potAfterCall)} = ${pct(odds.requiredEquity)} — that is the equity the call needs.`,
      `As a frequency you can picture: win it ${odds.frequency.text}.`,
    ];
  }

  if (problem.kind === 'spr') {
    const pot = potBeforeBet + 2 * bet;
    const behind = effectiveStack - bet;
    const ratio = spr(behind, pot);
    return [
      `Pot once the bet is called: ${trim(potBeforeBet)} + 2 x ${trim(bet)} = ${trim(pot)} bb.`,
      `Stack still behind: ${trim(effectiveStack)} - ${trim(bet)} = ${trim(behind)} bb.`,
      `SPR is the stack over the pot: ${trim(behind)} / ${trim(pot)} = ${trim(ratio.spr)}.`,
      bandLine(ratio.band, ratio.committedWithOnePair),
      `That is ${trim(ratio.potSizedBetsToAllIn)} pot-sized bet-and-calls before the stack is in.`,
    ];
  }

  const total = potBeforeBet + bet;
  const { mdf, alpha } = defence(potBeforeBet, bet);

  if (problem.kind === 'alpha') {
    return [
      `You bet ${trim(bet)} bb into ${trim(potBeforeBet)} bb, so the pot is now ${trim(potBeforeBet)} + ${trim(bet)} = ${trim(total)} bb.`,
      `A fold hands you that whole pot, and the ${trim(bet)} bb you bet is what you risked to get it.`,
      `Alpha is the bet over the pot it created: ${trim(bet)} / ${trim(total)} = ${pct(alpha)}.`,
      `As a frequency: they must fold ${naturalFrequency(alpha).text}.`,
      `The same division from the other seat is their defence: 1 - ${pct(alpha)} = ${pct(mdf)}.`,
    ];
  }

  return [
    `The bet is ${trim(bet)} bb into ${trim(potBeforeBet)} bb, so the pot is ${trim(potBeforeBet)} + ${trim(bet)} = ${trim(total)} bb.`,
    `The bettor's share of that pot is alpha: ${trim(bet)} / ${trim(total)} = ${pct(alpha)}.`,
    `Your defence is everything alpha is not: 1 - ${pct(alpha)} = ${pct(mdf)}.`,
    `As a frequency: keep defending ${naturalFrequency(mdf).text}.`,
    `MDF and alpha are one division seen from two seats, so they always add to 100%.`,
  ];
}

/** Bands and their thresholds are core's COMMITTED_SPR / DEEP_SPR, not numbers typed in here. */
function bandLine(band: 'committed' | 'medium' | 'deep', committedWithOnePair: boolean): string {
  if (band === 'committed') {
    return `At or under ${COMMITTED_SPR} that is committed${committedWithOnePair ? ': one pair is already playing for the stack' : ''}.`;
  }
  if (band === 'medium') {
    return `Between ${COMMITTED_SPR} and ${DEEP_SPR} the stack takes two big bets, so the commitment decision is still open.`;
  }
  return `Above ${DEEP_SPR} it takes three or more bets to get it in, which is room to fold one pair.`;
}

// ---------------------------------------------------------------------------
// Parsing and formatting
// ---------------------------------------------------------------------------

/** Digits with an optional sign, decimal point and a trailing per-cent sign. Anything else is not a number. */
export function parseTyped(raw: string): number | null {
  const cleaned = raw.trim().replace(/%$/, '').trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** A graded value shown back in the unit it was typed in. */
function inUnit(kind: DrillKind, value: number): string {
  return KINDS[kind].unit === '%' ? pct(value) : trim(value);
}

/** The same conversion as `inUnit`, before it becomes a string: percentage points, or a bare ratio. */
function inUnitValue(kind: DrillKind, value: number): number {
  return KINDS[kind].unit === '%' ? value * 100 : value;
}

/** A difference, in the same unit — signless, because the wording carries over/under. */
function amount(kind: DrillKind, value: number): string {
  return KINDS[kind].unit === '%' ? `${trim(value * 100)} points` : trim(value);
}

function pct(probability: number): string {
  return `${trim(probability * 100)}%`;
}

/** At most two decimals, with trailing zeros dropped: "20", not "20.00". */
function trim(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return String(round2(value));
}

/** The rounding `trim` prints, as a number, so display ties can be detected before they are shown. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function text(tag: string, className: string, content: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = content;
  return el;
}
