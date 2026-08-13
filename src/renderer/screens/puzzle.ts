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
import { CURRICULUM, moduleForScenario } from '../../core/puzzleCurriculum.js';
import {
  gradeSpotType,
  isClassifiable,
  PREFLOP_SPOT_TYPES,
  SPOT_TYPE_LABELS,
  type SpotType,
  type SpotTypeVerdict,
} from '../../core/spotType.js';
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

export interface PuzzleOptions {
  /**
   * Per-scenario progress carried in from the persisted session, keyed by scenario id. Drives the
   * "mastered" / "N of M" badges on the picker and the library-level count. Absent → nothing mastered yet.
   */
  readonly progress?: Record<string, { attempts: number; bestCorrect: number }>;
  /** Persist one completed scenario. Called once per completion; main.ts folds it in and saves. */
  readonly onComplete?: (scenarioId: string, correct: number) => void;
}

export function renderPuzzleScreen(options: PuzzleOptions = {}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'puzzle-screen';
  root.dataset.testid = 'puzzle-screen';

  // The graded output (classify verdict, action verdict, completion score) updates in place, so a
  // screen-reader user gets no feedback without a live region. This always-present polite region
  // mirrors whichever verdict the body is showing. It is kept as the root's first child in every paint
  // (like the tutor rail) so it survives replaceChildren, and is visually hidden + absolute-positioned
  // so it takes no layout space in the flex column.
  const verdictAnnouncer = document.createElement('div');
  verdictAnnouncer.className = 'visually-hidden';
  verdictAnnouncer.dataset.testid = 'puzzle-announcer';
  verdictAnnouncer.setAttribute('role', 'status');
  verdictAnnouncer.setAttribute('aria-live', 'polite');
  root.appendChild(verdictAnnouncer);

  // A local, live copy of the persisted progress so the picker badges update the moment a scenario is
  // completed this session, without waiting for a re-mount. Seeded from what was saved.
  const progress: Record<string, { attempts: number; bestCorrect: number }> = {
    ...(options.progress ?? {}),
  };

  let scenarioIndex = 0;
  let state: TableState = buildScenarioTable(SCENARIOS[0]);
  let stepIndex = 0;
  let villainAt = 0;
  let lastVerdict: StepVerdict | null = null;
  /** Guards a single onComplete per completion, so re-paints of the complete screen do not re-record. */
  let recordedComplete = false;
  const records: StepRecord[] = [];

  /**
   * State 1 of the five-state protocol (CLASSIFY): before the FIRST action of a classifiable (preflop)
   * spot, the learner names the spot type. Graded independently of the action and NEVER blocks progress
   * (spec: "no skip button — 'I don't know' is a commitment and scores as a miss"), so a wrong or absent
   * classification does not change the action grade or the completion score. `classifyVerdict` holds the
   * scored pick until dismissed; `classifyDone` marks that this spot's classify step is finished (asked
   * or skipped) so it is asked at most once per scenario, before acting.
   */
  let classifyVerdict: SpotTypeVerdict | null = null;
  let classifyDone = false;

  const scenario = (): Scenario => SCENARIOS[scenarioIndex];

  /** Mastered = a past completion got EVERY decision right (bestCorrect reached the target length). */
  const isMastered = (s: Scenario): boolean =>
    (progress[s.id]?.bestCorrect ?? 0) >= s.target.length;

  /**
   * The next not-yet-mastered scenario at or after `from`, wrapping once, or null if the whole library
   * is mastered. Steers a learner grinding toward mastery to their actual gaps rather than a fixed
   * order — the point of tracking progress at all.
   */
  const nextUnmasteredIndex = (from: number): number | null => {
    for (let step = 1; step <= SCENARIOS.length; step += 1) {
      const i = (from + step) % SCENARIOS.length;
      if (!isMastered(SCENARIOS[i])) return i;
    }
    return null;
  };

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
    recordedComplete = false;
    records.length = 0;
    classifyVerdict = null;
    classifyDone = false;
    advanceToHero();
    paint();
  }

  /** True when the learner should be asked to classify the spot RIGHT NOW: it is the hero's first
   *  decision, the spot is classifiable (preflop), and they have not yet classified this scenario. */
  function classifyPending(): boolean {
    return (
      !classifyDone &&
      classifyVerdict === null &&
      stepIndex === 0 &&
      state.toAct === HERO &&
      !isComplete(scenario(), stepIndex) &&
      isClassifiable(state)
    );
  }

  /**
   * The classify phase = the picker is up OR its verdict is on screen. While it is, the header hides
   * everything that would pre-classify the spot (the title, the setup prose, the by-title picker and
   * the module caption all NAME the spot type), so the learner classifies from the table alone. That
   * is the whole point of the step — a heading that says "Opening the button" deletes the sub-skill.
   */
  function inClassifyPhase(): boolean {
    return classifyPending() || classifyVerdict !== null;
  }

  /** Grade the learner's spot-type pick (independent of the action) and show the verdict. */
  function takeClassify(picked: SpotType): void {
    if (!classifyPending()) return;
    classifyVerdict = gradeSpotType(state, picked);
    paint();
  }

  /** Dismiss the classify verdict and fall through to the action controls. Marks classify done so it
   *  is asked once per scenario, whatever the pick was. */
  function continueClassify(): void {
    classifyVerdict = null;
    classifyDone = true;
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
    const correct = records.filter((r) => r.verdict.correct).length;
    root.dataset.scenario = s.id;
    root.dataset.step = String(stepIndex);
    root.dataset.total = String(s.target.length);
    root.dataset.phase =
      lastVerdict !== null
        ? 'graded'
        : done
          ? 'complete'
          : classifyVerdict !== null
            ? 'classified'
            : classifyPending()
              ? 'classify'
              : 'acting';
    root.dataset.verdict = lastVerdict === null ? '' : lastVerdict.correct ? 'right' : 'wrong';
    root.dataset.correct = String(correct);
    // The classify pick's own result, exposed separately so a test can assert it is scored
    // independently of the action verdict.
    root.dataset.classify = classifyVerdict === null ? '' : classifyVerdict.right ? 'right' : 'wrong';

    // The completion screen is shown once the line is done and its last verdict has been dismissed.
    // Record the result exactly once (recordedComplete guards re-paints): update the local badge map
    // for the picker AND persist through the callback so it survives a restart.
    if (done && lastVerdict === null && !recordedComplete) {
      recordedComplete = true;
      const prior = progress[s.id] ?? { attempts: 0, bestCorrect: 0 };
      progress[s.id] = {
        attempts: prior.attempts + 1,
        bestCorrect: Math.max(prior.bestCorrect, correct),
      };
      options.onComplete?.(s.id, correct);
    }

    const body =
      lastVerdict !== null
        ? verdictBlock(lastVerdict)
        : done
          ? completeBlock(s)
          : classifyVerdict !== null
            ? classifyVerdictBlock(classifyVerdict)
            : classifyPending()
              ? classifyControls()
              : controls();

    // Mirror the graded output into the live region — the same wording the body shows — so the spoken
    // and visual feedback can never disagree. Empty while acting/classifying (nothing graded yet).
    verdictAnnouncer.textContent =
      lastVerdict !== null
        ? actionVerdictAnnouncement(lastVerdict)
        : done
          ? completionAnnouncement(s, correct)
          : classifyVerdict !== null
            ? classifyVerdictAnnouncement(classifyVerdict)
            : '';
    root.replaceChildren(verdictAnnouncer, header(s), table(s), body, railSeam());
  }

  // ── rendering ──────────────────────────────────────────────────────────────

  function header(s: Scenario): HTMLElement {
    const el = document.createElement('div');
    el.className = 'puzzle-header';

    // During the classify step the header is blinded: the picker, module caption, title and setup all
    // name the spot type, so showing them while asking "what kind of spot is this?" would hand over the
    // answer. Present a neutral prompt instead until the learner has classified.
    if (inClassifyPhase()) {
      const blind = text('h2', 'puzzle-title', 'Read the table — what kind of spot is this?');
      blind.dataset.testid = 'puzzle-title';
      blind.dataset.blinded = 'true';
      el.appendChild(blind);
      return el;
    }

    // Picker row: the "N of M" label plus a jump-to-any-scenario dropdown. Sequential "Next puzzle"
    // still works at completion, but with a growing library a learner needs to reach a specific spot
    // (revisit the river bluff-catch, drill the multiway fold) without clicking through the whole set.
    // A scenario is "mastered" once its best solve got every decision right. Count them for the label
    // so the learner sees library-wide progress at a glance, across sittings.
    const mastered = SCENARIOS.filter((scen) => isMastered(scen)).length;

    const pickerRow = document.createElement('div');
    pickerRow.className = 'puzzle-picker-row';
    const label = text(
      'div',
      'puzzle-picker-label',
      `Puzzle ${scenarioIndex + 1} of ${SCENARIOS.length} · ${mastered} mastered`,
    );
    label.dataset.testid = 'puzzle-progress-label';
    label.dataset.mastered = String(mastered);
    pickerRow.appendChild(label);

    const select = document.createElement('select');
    select.className = 'puzzle-picker';
    select.dataset.testid = 'puzzle-picker';
    // The visible "Puzzle N of M" label is a sibling div, not associated; name the combobox itself.
    select.setAttribute('aria-label', 'Jump to puzzle');
    // Group the options by curriculum module (an <optgroup> per module) so the dropdown reads as a
    // teaching progression — preflop → flop → turn → river — rather than 44 undifferentiated spots.
    // The option VALUE stays the scenario's index in SCENARIOS, so jump-by-index and "Next puzzle"
    // (which walk the underlying array) are unchanged; only the visual grouping is added.
    const indexById = new Map(SCENARIOS.map((scen, i) => [scen.id, i]));
    const optionFor = (scen: Scenario, i: number): HTMLOptionElement => {
      const option = document.createElement('option');
      option.value = String(i);
      // Prefix a mastery mark so the dropdown shows what is done: ✓ mastered, ◐ attempted-not-yet, none untried.
      const mark = isMastered(scen) ? '✓ ' : progress[scen.id] ? '◐ ' : '';
      option.textContent = `${mark}${scen.title}`;
      option.selected = i === scenarioIndex;
      return option;
    };
    for (const module of CURRICULUM) {
      const group = document.createElement('optgroup');
      // Count mastered spots in the module so the group header shows per-module progress at a glance.
      const total = module.scenarioIds.length;
      const done = module.scenarioIds.filter((id) => {
        const scen = SCENARIOS[indexById.get(id) ?? -1];
        return scen !== undefined && isMastered(scen);
      }).length;
      group.label = `${module.title} — ${done}/${total}`;
      for (const id of module.scenarioIds) {
        const i = indexById.get(id);
        if (i === undefined) continue; // guarded by curriculum's load-time partition assert
        group.appendChild(optionFor(SCENARIOS[i], i));
      }
      select.appendChild(group);
    }
    // Jump straight to the chosen puzzle. loadScenario resets step/verdict/records, so a mid-hand jump
    // cannot carry stale progress into the new spot.
    select.addEventListener('change', () => loadScenario(Number(select.value)));
    pickerRow.appendChild(select);

    el.appendChild(pickerRow);

    // The curriculum module this spot belongs to, shown so the learner sees where the current puzzle
    // sits in the preflop→river progression while playing — not only when the picker is open. Derived
    // from the curriculum (moduleForScenario), so it adds no state and cannot drift from the grouping.
    const module = moduleForScenario(s.id);
    if (module !== undefined) {
      const moduleIndex = CURRICULUM.indexOf(module);
      const moduleLine = text(
        'div',
        'puzzle-module',
        `Module ${moduleIndex + 1} of ${CURRICULUM.length} · ${module.title}`,
      );
      moduleLine.dataset.testid = 'puzzle-module';
      moduleLine.dataset.moduleKey = module.key;
      el.appendChild(moduleLine);
    }

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

    // When the hero faces a genuine bet, show what it costs to call AND the pot odds it lays — the
    // actual percentage behind every "you have a price" explanation, so the learner sees the number,
    // not just the words. state.pot already includes the bet, so break-even equity = toCall/(pot+toCall)
    // (the same formula coach.ts uses). NOT shown for an unopened preflop pot, where the hero merely
    // faces the big blind: that is a raise-or-fold RFI decision, not a pot-odds call, and printing
    // "odds to call the BB" there would teach the wrong frame. So: postflop always, or preflop only
    // once someone has raised past the big blind.
    const facingRealBet = state.board.length > 0 || state.currentBet > state.bb;
    const toCall =
      state.toAct === HERO && facingRealBet ? state.currentBet - state.seats[HERO].committed : 0;
    if (toCall > 0) {
      const potOdds = Math.round((toCall / (state.pot + toCall)) * 100);
      const oddsLine = text(
        'div',
        'puzzle-odds',
        `To call ${toCall} · pot odds ${potOdds}% — you need ${potOdds}% equity to call`,
      );
      oddsLine.dataset.testid = 'puzzle-odds';
      oddsLine.dataset.tocall = String(toCall);
      oddsLine.dataset.potodds = String(potOdds);
      el.appendChild(oddsLine);
    }

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

  /**
   * State 1 CLASSIFY: name the spot before acting. The app shows the closed set but never the answer —
   * that is the sub-skill. A prompt plus one button per preflop spot type; picking grades it.
   */
  function classifyControls(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'puzzle-classify';
    el.dataset.testid = 'puzzle-classify';

    const prompt = text('div', 'puzzle-classify-prompt', 'What kind of spot is this?');
    prompt.dataset.testid = 'puzzle-classify-prompt';
    el.appendChild(prompt);

    const picks = document.createElement('div');
    picks.className = 'puzzle-classify-picks';
    for (const type of PREFLOP_SPOT_TYPES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pill';
      b.dataset.testid = `puzzle-classify-${type}`;
      b.textContent = SPOT_TYPE_LABELS[type];
      b.addEventListener('click', () => takeClassify(type));
      picks.appendChild(b);
    }
    el.appendChild(picks);
    return el;
  }

  /** The classify result — scored on its own, then a Continue that falls through to the action. */
  function classifyVerdictBlock(verdict: SpotTypeVerdict): HTMLElement {
    const el = document.createElement('div');
    el.className = 'puzzle-classify-verdict';
    el.dataset.testid = 'puzzle-classify-verdict';
    el.dataset.correct = String(verdict.right);

    const head = text(
      'div',
      'puzzle-verdict-head',
      verdict.right
        ? `Correct — this is a ${SPOT_TYPE_LABELS[verdict.correct].toLowerCase()} spot.`
        : `Not quite — this is a ${SPOT_TYPE_LABELS[verdict.correct].toLowerCase()} spot, not ${SPOT_TYPE_LABELS[verdict.picked].toLowerCase()}.`,
    );
    head.dataset.testid = 'puzzle-classify-verdict-head';
    el.appendChild(head);

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'pill';
    next.dataset.testid = 'puzzle-classify-continue';
    next.textContent = 'Now play it';
    next.addEventListener('click', continueClassify);
    el.appendChild(next);
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
      b.appendChild(document.createTextNode(actionLabel(kind)));
      // The keyboard shortcut, shown on the button so it is discoverable rather than hidden. The
      // letter is the action's first character (F/K/C/B/R), matching the onKey handler.
      const hint = document.createElement('span');
      hint.className = 'puzzle-key-hint';
      hint.textContent = kind.charAt(0).toUpperCase();
      b.appendChild(hint);
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

    // Per-decision recap: name the play the learner chose and the GTO play for each step, in order,
    // so a bare "1 of 2" ends on WHICH decision was the leak rather than a number. Only shown when the
    // scenario has more than one decision — a single-step recap would just repeat the last verdict.
    if (records.length > 1) {
      const recap = document.createElement('ol');
      recap.className = 'puzzle-recap';
      recap.dataset.testid = 'puzzle-recap';
      records.forEach((record, i) => {
        const { verdict } = record;
        const item = document.createElement('li');
        item.className = 'puzzle-recap-step';
        item.dataset.testid = 'puzzle-recap-step';
        item.dataset.correct = String(verdict.correct);
        item.textContent = verdict.correct
          ? `Decision ${i + 1}: ${actionLabel(verdict.expected)} ✓`
          : `Decision ${i + 1}: you ${actionLabel(verdict.played).toLowerCase()}, the play is ${actionLabel(verdict.expected).toLowerCase()}.`;
        recap.appendChild(item);
      });
      el.appendChild(recap);
    }

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'pill';
    next.dataset.testid = 'puzzle-next-scenario';
    next.textContent = scenarioIndex + 1 < SCENARIOS.length ? 'Next puzzle' : 'Back to the first puzzle';
    next.addEventListener('click', () => loadScenario(scenarioIndex + 1));
    el.appendChild(next);

    // Jump straight to the next spot the learner has NOT yet solved cleanly — the fast path to full
    // mastery. Shown only when such a scenario exists elsewhere; hidden once everything is mastered
    // (then "Next puzzle" is the only forward control and this would just repeat it).
    const gap = nextUnmasteredIndex(scenarioIndex);
    if (gap !== null && gap !== scenarioIndex) {
      const toGap = document.createElement('button');
      toGap.type = 'button';
      toGap.className = 'pill';
      toGap.dataset.testid = 'puzzle-next-unmastered';
      toGap.textContent = 'Next unmastered →';
      toGap.addEventListener('click', () => loadScenario(gap));
      el.appendChild(toGap);
    }

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'pill';
    retry.dataset.testid = 'puzzle-retry';
    retry.textContent = 'Replay this puzzle';
    retry.addEventListener('click', () => loadScenario(scenarioIndex));
    el.appendChild(retry);
    return el;
  }

  /**
   * Keyboard shortcuts, so a learner can drill spots as fast as they read them rather than reaching
   * for the mouse each decision — the charts drill already trains this way (o/f). One letter per
   * action (F/K/C/B/R), and Enter/Space advances past a verdict or to the next puzzle. Bound to the
   * window because the screen owns no focus of its own, and self-removing once the root leaves the
   * document so it never steals keys from another tab (the charts/lesson pattern).
   */
  const ACTION_KEYS: Record<string, ActionKind> = {
    f: 'fold',
    k: 'check',
    c: 'call',
    b: 'bet',
    r: 'raise',
  };

  function onKey(event: KeyboardEvent): void {
    if (!root.isConnected) {
      window.removeEventListener('keydown', onKey);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // The learner may be typing a question into the tutor rail; those keys are not shortcuts.
    const target = event.target;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;

    // Enter or Space advances: dismiss a classify verdict, dismiss an action verdict, or move to the
    // next puzzle once complete.
    if (event.key === 'Enter' || event.key === ' ') {
      if (classifyVerdict !== null) {
        event.preventDefault();
        continueClassify();
      } else if (lastVerdict !== null) {
        event.preventDefault();
        continueOn();
      } else if (isComplete(scenario(), stepIndex)) {
        event.preventDefault();
        loadScenario(scenarioIndex + 1);
      }
      return;
    }

    // While classifying (picker shown, or its verdict up) the action keys are inert — the action
    // controls are not on screen, and classify is picked by clicking a spot-type button.
    if (classifyVerdict !== null || classifyPending()) return;

    const kind = ACTION_KEYS[event.key.toLowerCase()];
    // Only a currently-legal hero action fires — the same set the on-screen buttons enable, so a key
    // can never take an action the learner could not click.
    if (kind === undefined || state.toAct !== HERO || lastVerdict !== null) return;
    if (!legalActions(state).includes(kind)) return;
    event.preventDefault();
    takeAction(kind);
  }
  window.addEventListener('keydown', onKey);

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

// The graded outputs as single spoken lines for the screen-reader live region. Each mirrors the
// wording of the DOM block it corresponds to (classifyVerdictBlock, verdictBlock, completeBlock) so the
// spoken and visible feedback cannot drift.
function classifyVerdictAnnouncement(verdict: SpotTypeVerdict): string {
  return verdict.right
    ? `Correct — this is a ${SPOT_TYPE_LABELS[verdict.correct].toLowerCase()} spot.`
    : `Not quite — this is a ${SPOT_TYPE_LABELS[verdict.correct].toLowerCase()} spot, not ${SPOT_TYPE_LABELS[verdict.picked].toLowerCase()}.`;
}

function actionVerdictAnnouncement(verdict: StepVerdict): string {
  const head = verdict.correct
    ? `Correct — ${actionLabel(verdict.expected)} is the play.`
    : `Not quite — you ${actionLabel(verdict.played).toLowerCase()}, the play is ${actionLabel(verdict.expected).toLowerCase()}.`;
  return `${head} ${verdict.explanation}`;
}

function completionAnnouncement(s: Scenario, correct: number): string {
  return `You played ${correct} of ${s.target.length} decisions the GTO way.`;
}

function text(tag: string, className: string, content: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = content;
  return el;
}
