import '../styles-lesson.css';

import type { Lesson, LessonExample, LessonPhase } from '../../core/lessons/index.js';
import { LESSONS, lessonById } from '../../core/lessons/index.js';
import { renderCard, renderCardRow } from '../components/card.js';
import { text } from '../components/dom.js';
import { chevron } from '../components/glyphs.js';
import { attachThumb } from '../components/thumb.js';
import { beginFocusRestore } from '../focusRestore.js';
import { renderTutorRail, type RailContext, type RailTable } from '../components/tutorRail.js';
import { dialogueFor } from '../../core/dee/dialogues/index.js';
import {
  commitAnswer,
  exampleFacts,
  pendingStep,
  scriptRuns,
  startDialogue,
  type DialogueScript,
  type DialogueState,
  type LessonFacts,
} from '../../core/dee/dialogue.js';
import type { Tone } from '../../core/dee/types.js';
import { renderDee } from '../components/dee.js';

/**
 * LESSON MODE (the 'learn' tab). A reader over src/core/lessons — it adds no content and no
 * grading of its own.
 *
 * Two rules shape the whole file:
 *  - N1: nothing is locked. Prerequisites are printed as advice; every lesson is enterable from
 *    the list and from the keyboard, in any order, on first launch.
 *  - G5 / story 12: the reveal is ABSENT FROM THE DOM until the learner commits. It is built by
 *    renderReveal(), which is only called once an answer for that exact example has been stored,
 *    so there is nothing to read in the DOM — not merely nothing painted. A CSS-hidden reveal
 *    would still be readable, which is the same as no gate at all.
 *
 * Everything the phase list shows is derived from the registry, so a new lesson appears here with
 * no edit to this file.
 */

const PHASES: readonly LessonPhase[] = [0, 1, 2, 3];

const PHASE_LABELS: Record<LessonPhase, string> = {
  0: 'Rules',
  1: 'Eyes',
  2: 'Arithmetic',
  3: 'Principles',
};

/**
 * The learner's own mechanism sentences (L1), append-only (L3).
 *
 * Persisted to localStorage under this key rather than through window.offsuit.saveState: that
 * bridge round-trips ONE object which main.ts overwrites with serialize(session) after every hand,
 * so anything stored beside the session would be dropped on the next hand — and writing the whole
 * object back from here would clobber the bankroll. localStorage lives in the same Electron
 * userData directory, so it is still per-profile and still local-only.
 */
const LEXICON_KEY = 'offsuit-lexicon-v1';

export interface LexiconEntry {
  lessonId: string;
  text: string;
  /** L2's keyword fallback verdict, recorded at the time. Rejected attempts are kept: diagnostic. */
  accepted: boolean;
  at: number;
}

interface LessonScreenOpts {
  /** Injectable so a test can render a stubbed registry (e.g. empty) without touching content. */
  lessons?: readonly Lesson[];
  /**
   * Dee. A lesson with a dialogue script (core/dee/dialogues) runs as a conversation; the tone sets Dee's
   * generic lines, Character off drops the mark and names the speaker "Coach". `onRule` remembers an adopted
   * sentence so Dee can quote it back at the table.
   */
  dee?: { tone: Tone; character: boolean; onRule?: (lessonId: string, text: string) => void };
  /** The Rulebook (Folio): the rules written here, as cards. Absent: no entry. */
  folio?: { readonly count: number; readonly toPolish: number; readonly onOpen: () => void };
}

declare global {
  interface Window {
    /**
     * e2e seam for the degenerate registry cases. Reading it here is the only way the built
     * bundle can be asked to render a registry it does not ship, and deleting real lessons to
     * test an empty list would cost 28 validator tests.
     */
    __offsuitLessonsStub?: readonly Lesson[];
  }
}

export function renderLessonScreen(opts: LessonScreenOpts = {}): HTMLElement {
  const lessons = ordered(opts.lessons ?? window.__offsuitLessonsStub ?? LESSONS);

  const root = document.createElement('div');
  root.className = 'lesson-screen';
  root.dataset.testid = 'lesson-screen';
  root.dataset.lessonCount = String(lessons.length);

  /** Answers already committed, keyed by lesson#example. Presence is what unlocks a reveal. */
  const commitments = new Map<string, string>();
  /** Dialogue lessons: the conversation so far, per lesson#example. */
  const dialogues = new Map<string, DialogueState>();
  /** The option picked (not yet committed) on the open dialogue step. */
  let picked: string | null = null;
  const tone: Tone = opts.dee?.tone ?? 'warm';
  const character = opts.dee?.character ?? true;
  /**
   * The dialogue's announcer: one polite region that lives as long as the screen, so the newest turn is
   * announced once even though the thread itself is rebuilt on every render (the pattern the table uses).
   */
  const dialogueAnnouncer = document.createElement('div');
  dialogueAnnouncer.className = 'visually-hidden';
  dialogueAnnouncer.dataset.testid = 'dialogue-announcer';
  dialogueAnnouncer.setAttribute('role', 'status');
  dialogueAnnouncer.setAttribute('aria-live', 'polite');
  /** Where focus goes after a commit (the first open option, or the reveal), set by the commit handler. */
  let focusAfterCommit = false;
  const lexicon: LexiconEntry[] = readLexicon();

  let view: 'list' | 'lesson' = 'list';
  let lessonIndex = 0;
  let exampleIndex = 0;
  /** Keyboard highlight in the list. Advice only — it gates nothing. */
  let cursor = 0;
  /** The verdict on the sentence saved during this visit, so the last attempt gets an answer. */
  let lastVerdict: LexiconEntry | null = null;
  /**
   * The position the rail is answering about, republished on every render. The rail reads it at
   * send time rather than at mount, so the mute matrix judges the context the learner is actually
   * in when they ask — see components/tutorRail.ts.
   */
  let railExample: LessonExample | undefined;
  let railCommitted = false;
  /** One instance per screen: rebuilding it each render would wipe a question already in flight. */
  let rail: HTMLElement | null = null;

  const openLesson = (index: number): void => {
    lessonIndex = clamp(index, 0, lessons.length - 1);
    exampleIndex = 0;
    picked = null;
    lastVerdict = null;
    view = 'lesson';
    render();
    toTop();
  };

  const showList = (): void => {
    cursor = lessonIndex;
    view = 'list';
    render();
    toTop();
  };

  /**
   * The column is what scrolls, and replaceChildren keeps its scrollTop. Reaching a lesson deep in
   * the list leaves the column scrolled, so the lesson opened 36px up with its own title cut off
   * above the top edge. Changing screen means starting at the top of it.
   */
  const toTop = (): void => {
    root.scrollTop = 0;
  };

  function render(): void {
    // Preserve keyboard focus across the rebuild (both the list and the lesson-view branch replace the
    // whole subtree), so keyboard navigation is not reset to <body> on each step.
    const restoreLessonFocus = beginFocusRestore(root);
    try {
      renderInner();
    } finally {
      restoreLessonFocus();
    }
  }

  /**
   * Repaint the screen's content while the dialogue announcer stays mounted: a live region that is removed
   * and re-inserted on every render is not reliably announced, so it is never detached once in place.
   */
  function paint(...nodes: Node[]): void {
    for (const child of [...root.childNodes]) if (child !== dialogueAnnouncer) child.remove();
    root.prepend(...nodes);
    if (dialogueAnnouncer.parentNode !== root) root.appendChild(dialogueAnnouncer);
  }

  function renderInner(): void {
    root.dataset.view = view;
    if (view === 'list' || lessons.length === 0) {
      delete root.dataset.lessonId;
      delete root.dataset.exampleId;
      delete root.dataset.committed;
      root.dataset.cursor = String(cursor);
      railExample = undefined;
      railCommitted = false;
      paint(renderList(), railSeam());
      return;
    }

    const lesson = lessons[lessonIndex];
    const example = lesson.examples[exampleIndex] as LessonExample | undefined;
    root.dataset.lessonId = lesson.id;
    root.dataset.cursor = String(lessonIndex);
    if (example) root.dataset.exampleId = example.id;
    else delete root.dataset.exampleId;
    const committed = example !== undefined && commitments.has(key(lesson, example));
    root.dataset.committed = String(committed);
    railExample = example;
    railCommitted = committed;
    paint(renderLessonView(lesson, example), railSeam());
    if (focusAfterCommit) {
      focusAfterCommit = false;
      const target =
        root.querySelector<HTMLElement>('[data-testid="dialogue-option"]:not(:disabled)') ??
        root.querySelector<HTMLElement>('[data-testid="lesson-reveal"]');
      target?.focus({ preventScroll: false });
    }
  }

  /**
   * The rail's mount seam. The rail itself is built once and re-appended, so navigating between
   * lessons keeps the transcript and cannot drop an answer that is still in flight.
   */
  function railSeam(): HTMLElement {
    const seam = document.createElement('aside');
    seam.className = 'lesson-rail';
    seam.dataset.testid = 'lesson-tutor-rail';
    rail ??= renderTutorRail({ context: railContext, table: railTable });
    seam.appendChild(rail);
    return seam;
  }

  /**
   * The T5 row this screen sits in.
   *
   * A lesson position is a Spot: pre-commit before the learner commits an answer, post-reveal
   * after. The list has no position under study at all, and 'spot-pre-commit' is the stricter of
   * the two cells there — strategy blocked, rules allowed — so an ungraded browse cannot be used
   * to ask for a play the lesson screens are meant to withhold.
   */
  function railContext(): RailContext {
    return railCommitted ? 'spot-post-reveal' : 'spot-pre-commit';
  }

  /**
   * The visible table, from the example the learner is looking at. Every field is already drawn on
   * screen by renderSpot/renderSpotMeta — the rail is told what the learner can see and nothing
   * else, which is the whole content of VisibleTable.
   */
  function railTable(): RailTable {
    const example = railExample;
    if (example === undefined) {
      return {
        positions: [],
        stacksBb: [],
        potBb: 0,
        board: [],
        heroCards: [],
        toAct: '',
        street: 'preflop',
      };
    }
    const inBb = (chips: number): number => Math.round((chips / example.bb) * 10) / 10;
    return {
      positions: [example.position],
      stacksBb: [inBb(example.heroStack), ...example.villainStacks.map(inBb)],
      potBb: inBb(example.pot),
      board: example.board,
      heroCards: example.hole,
      toAct: example.position,
      // A lesson example is never at showdown (validate.ts rejects it), so the streets align.
      street: example.street === 'showdown' ? 'river' : example.street,
    };
  }

  function renderList(): HTMLElement {
    const list = document.createElement('div');
    list.className = 'lesson-list';

    const heading = document.createElement('div');
    heading.className = 'lesson-list-heading';
    const titleRow = document.createElement('div');
    titleRow.className = 'lesson-list-titlerow';
    titleRow.appendChild(text('div', 'lesson-list-title t-t2', 'Lessons'));
    if (opts.folio) {
      const f = opts.folio;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'pill quiet';
      open.dataset.testid = 'open-folio';
      open.textContent = f.toPolish > 0 ? `Rulebook · ${f.toPolish} to re-polish` : `Rulebook · ${f.count}`;
      open.addEventListener('click', f.onOpen);
      titleRow.appendChild(open);
    }
    heading.appendChild(titleRow);
    heading.appendChild(
      text(
        'div',
        'lesson-hint g-sub',
        'Any lesson, any order. Arrow keys move, Enter opens.',
      ),
    );
    list.appendChild(heading);

    if (lessons.length === 0) {
      list.appendChild(emptyState('No lessons in this build', 'The lesson registry is empty, so there is nothing to read yet. Nothing is locked — the tab stays open.'));
      return list;
    }

    for (const phase of PHASES) {
      const inPhase = lessons.filter((lesson) => lesson.phase === phase);
      if (inPhase.length === 0) continue;

      const section = document.createElement('section');
      section.className = 'phase-section';
      section.dataset.testid = 'phase-section';
      section.dataset.phase = String(phase);
      section.appendChild(
        text('div', 'phase-label g-label', `Phase ${phase} · ${PHASE_LABELS[phase]}`),
      );

      // The lessons are an actionable list (every row opens), so they sit in one inset group.
      const group = document.createElement('div');
      group.className = 'lesson-group g-group';
      for (const lesson of inPhase) {
        group.appendChild(renderRow(lesson));
      }
      section.appendChild(group);
      list.appendChild(section);
    }

    return list;
  }

  function renderRow(lesson: Lesson): HTMLElement {
    const index = lessons.indexOf(lesson);

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'lesson-row g-row';
    row.dataset.testid = 'lesson-row';
    row.dataset.lessonId = lesson.id;
    row.dataset.cursor = String(index === cursor);
    row.addEventListener('click', () => openLesson(index));

    const body = document.createElement('span');
    body.className = 'lesson-row-body';
    body.appendChild(text('span', 'lesson-row-title', lesson.title));
    body.appendChild(text('span', 'lesson-row-mechanism', lesson.mechanism));

    const advice = prerequisiteAdvice(lesson);
    if (advice !== null) {
      const line = text('span', 'lesson-advice', advice);
      line.dataset.testid = 'lesson-advice';
      body.appendChild(line);
    }

    const spots = text(
      'span',
      'lesson-row-meta',
      `${lesson.examples.length} position${lesson.examples.length === 1 ? '' : 's'}`,
    );
    body.appendChild(spots);
    row.appendChild(body);
    row.appendChild(chevron());

    return row;
  }

  function renderLessonView(lesson: Lesson, example: LessonExample | undefined): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'lesson-view';

    wrap.appendChild(renderLessonHeader(lesson));

    const mechanism = text('p', 'lesson-mechanism', lesson.mechanism);
    mechanism.dataset.testid = 'lesson-mechanism';
    wrap.appendChild(mechanism);

    const advice = prerequisiteAdvice(lesson);
    if (advice !== null) {
      const line = text('p', 'lesson-advice', advice);
      line.dataset.testid = 'lesson-advice';
      wrap.appendChild(line);
    }

    if (example === undefined) {
      wrap.appendChild(
        emptyState('No example position', 'This lesson ships its mechanism only. The sentence box below still works.'),
      );
    } else {
      wrap.appendChild(renderExample(lesson, example));
    }

    wrap.appendChild(renderLexicon(lesson));
    return wrap;
  }

  function renderLessonHeader(lesson: Lesson): HTMLElement {
    const header = document.createElement('div');
    header.className = 'lesson-header';

    // One toolbar row: the way back on the left, the lesson stepper on the right.
    const bar = document.createElement('div');
    bar.className = 'lesson-bar';
    const back = pill('All lessons', 'lesson-back', showList);
    back.classList.add('quiet', 'sm');
    bar.appendChild(back);

    const titles = document.createElement('div');
    titles.className = 'lesson-titles';
    titles.appendChild(
      text('div', 'phase-label g-label', `Phase ${lesson.phase} · ${PHASE_LABELS[lesson.phase]}`),
    );
    const title = text('h1', 'lesson-title t-t2', lesson.title);
    title.dataset.testid = 'lesson-title';
    titles.appendChild(title);

    const nav = document.createElement('div');
    nav.className = 'lesson-nav';
    const previous = pill('Previous', 'lesson-prev', () => openLesson(lessonIndex - 1));
    previous.classList.add('sm');
    previous.disabled = lessonIndex === 0;
    nav.appendChild(previous);
    const position = text(
      'span',
      'lesson-position',
      `${lessonIndex + 1} / ${lessons.length}`,
    );
    position.dataset.testid = 'lesson-position';
    nav.appendChild(position);
    const next = pill('Next', 'lesson-next', () => openLesson(lessonIndex + 1));
    next.classList.add('sm');
    next.disabled = lessonIndex === lessons.length - 1;
    nav.appendChild(next);
    bar.appendChild(nav);
    header.appendChild(bar);
    header.appendChild(titles);

    return header;
  }

  function renderExample(lesson: Lesson, example: LessonExample): HTMLElement {
    const section = document.createElement('section');
    section.className = 'example';
    section.dataset.testid = 'example';
    section.dataset.exampleId = example.id;

    if (lesson.examples.length > 1) {
      const tabs = document.createElement('div');
      tabs.className = 'example-tabs g-seg g-seg-sm';
      tabs.setAttribute('role', 'group');
      tabs.setAttribute('aria-label', 'Position');
      lesson.examples.forEach((candidate, index) => {
        const tab = pill(String(index + 1), 'example-tab', () => {
          exampleIndex = index;
          picked = null;
          render();
        });
        tab.dataset.exampleId = candidate.id;
        tab.dataset.selected = String(index === exampleIndex);
        tabs.appendChild(tab);
      });
      section.appendChild(tabs);
      attachThumb(tabs);
    }

    section.appendChild(renderSpot(example));

    const prompt = text('p', 'example-prompt t-t3', example.prompt);
    prompt.dataset.testid = 'lesson-prompt';
    section.appendChild(prompt);

    const script = dialogueFor(lesson.id);
    const facts = exampleFacts(example);
    if (script && scriptRuns(script, facts)) {
      section.appendChild(renderDialogue(lesson, example, script, facts));
      return section;
    }

    const answer = commitments.get(key(lesson, example));
    if (answer === undefined) {
      section.appendChild(renderCommit(lesson, example));
      return section;
    }
    // Built only on this branch: before a commit there is no reveal node anywhere in the tree.
    section.appendChild(renderReveal(example, answer));
    return section;
  }

  /**
   * The lesson as a conversation: Dee asks, the learner picks and commits, a wrong answer gets a question back.
   * Commit before feedback (G5): the reply is computed by the engine only on commit, and the stored reasoning
   * (the reveal) is built only once the last step is answered, exactly like the commit box path.
   */
  function renderDialogue(lesson: Lesson, example: LessonExample, script: DialogueScript, facts: LessonFacts): HTMLElement {
    const k = key(lesson, example);
    const seed = hashString(k);
    let state = dialogues.get(k);
    if (state === undefined) {
      state = startDialogue(script, facts, { tone, seed, character });
      dialogues.set(k, state);
    }
    const wrap = document.createElement('div');
    wrap.className = 'dee-dialogue';
    wrap.dataset.testid = 'dee-dialogue';
    wrap.dataset.step = String(state.stepIndex);
    wrap.dataset.done = String(state.done);

    // The thread is a plain ordered list (rebuilt each render); new turns are announced by dialogueAnnouncer.
    const thread = document.createElement('ol');
    thread.className = 'dee-thread';
    thread.dataset.testid = 'dee-thread';
    thread.setAttribute('aria-label', character ? 'The lesson, with Dee' : 'The lesson');
    let markShown = false;
    for (const turn of state.thread) {
      const li = document.createElement('li');
      li.className = `dee-turn ${turn.who === 'dee' ? 'from-dee' : 'from-you'}`;
      li.dataset.testid = turn.who === 'dee' ? 'dee-turn' : 'you-turn';
      const who = document.createElement('span');
      who.className = 'dee-who g-caption';
      if (turn.who === 'dee') {
        li.dataset.lineId = turn.lineId;
        li.dataset.pose = turn.pose;
        who.textContent = character ? 'Dee' : 'Coach';
        // One mark, beside Dee's newest line, wearing that line's pose.
        if (character && turn === lastDeeTurn(state)) {
          li.appendChild(renderDee(turn.pose, 40));
          markShown = true;
        }
      } else {
        li.dataset.right = String(turn.right);
        who.textContent = turn.right ? 'You' : 'You · not yet';
      }
      const p = document.createElement('p');
      p.className = 'dee-say';
      p.textContent = turn.text;
      const body = document.createElement('div');
      body.className = 'dee-turn-body';
      body.append(who, p);
      li.appendChild(body);
      thread.appendChild(li);
    }
    wrap.dataset.mark = String(markShown);
    wrap.appendChild(thread);

    const pending = pendingStep(script, state, facts);
    if (pending) {
      const ask = document.createElement('div');
      ask.className = 'dee-ask';
      ask.dataset.testid = 'dialogue-ask';
      const opts = document.createElement('div');
      opts.className = 'dee-options';
      opts.setAttribute('role', 'radiogroup');
      opts.setAttribute('aria-label', 'Your answer');
      for (const option of pending.options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pill dee-option';
        b.dataset.testid = 'dialogue-option';
        b.dataset.optionId = option.id;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(picked === option.id));
        b.textContent = option.label;
        b.disabled = option.tried;
        if (option.tried) b.dataset.tried = 'true';
        b.addEventListener('click', () => {
          picked = option.id;
          render();
          root.querySelector<HTMLElement>(`[data-testid="dialogue-option"][data-option-id="${option.id}"]`)?.focus();
        });
        opts.appendChild(b);
      }
      const commit = pill('Commit', 'dialogue-commit', () => {
        if (picked === null) return;
        const before = dialogues.get(k) as DialogueState;
        const next = commitAnswer(script, before, facts, picked, { tone, seed, character });
        picked = null;
        dialogues.set(k, next);
        const said = next.thread.slice(before.thread.length).filter((t) => t.who === 'dee').map((t) => t.text);
        dialogueAnnouncer.textContent = said.join(' ');
        focusAfterCommit = true;
        // The last answer committed is the commitment: the rail moves to post-reveal and the reveal is built.
        if (next.done) commitments.set(k, next.thread.filter((t) => t.who === 'you').map((t) => t.text).join(' · '));
        render();
      });
      commit.classList.add('primary');
      commit.disabled = picked === null;
      ask.append(opts, commit);
      wrap.appendChild(ask);
      wrap.appendChild(text('p', 'g-caption dee-ask-note', 'A wrong answer gets a question back, not a grade.'));
    } else if (state.done) {
      // Built only now: before the last answer there is no reveal node anywhere in the tree.
      const reveal = document.createElement('div');
      reveal.className = 'reveal';
      reveal.dataset.testid = 'lesson-reveal';
      reveal.tabIndex = -1;
      reveal.appendChild(text('div', 'stat-label g-label', 'The reasoning stored with this position'));
      const reasoning = text('p', 'reveal-reasoning', example.reasoning);
      reasoning.dataset.testid = 'lesson-reasoning';
      reveal.appendChild(reasoning);
      wrap.appendChild(reveal);
    }
    return wrap;
  }

  function renderSpot(example: LessonExample): HTMLElement {
    const spot = document.createElement('div');
    spot.className = 'spot';

    const cards = document.createElement('div');
    cards.className = 'spot-cards';

    /**
     * Both groups are labelled. Unlabelled, a gap was the only thing separating two hole cards
     * from a three-card flop, and at a glance the five read as one row — the learner could not
     * tell which two were theirs, which is the whole premise of the question below.
     */
    const hole = document.createElement('div');
    hole.className = 'spot-hole';
    hole.dataset.testid = 'lesson-hole';
    for (const card of example.hole) hole.appendChild(renderCard(card));
    cards.appendChild(cardGroup('Your hand', hole));

    const board = document.createElement('div');
    board.className = 'spot-board';
    board.dataset.testid = 'lesson-board';
    if (example.board.length === 0) {
      // A preflop example has nothing to draw; an empty row would read as a rendering bug.
      board.appendChild(text('span', 'spot-noboard', 'No board yet'));
    } else {
      board.appendChild(renderCardRow(example.board));
    }
    cards.appendChild(cardGroup('Board', board));
    spot.appendChild(cards);

    spot.appendChild(renderSpotMeta(example));
    return spot;
  }

  function renderSpotMeta(example: LessonExample): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'spot-meta';
    grid.dataset.testid = 'example-meta';

    const facts: [string, string][] = [
      ['Seat', example.position],
      ['Street', example.street],
      ['Pot', `${example.pot} · ${bb(example.pot, example.bb)} bb`],
      [
        'To call',
        example.toCall === 0
          ? 'Nothing'
          : `${example.toCall} · ${bb(example.toCall, example.bb)} bb`,
      ],
      ['Your stack', `${bb(example.heroStack, example.bb)} bb`],
      [
        example.villainStacks.length === 1 ? 'Opponent' : 'Opponents',
        example.villainStacks.map((stack) => `${bb(stack, example.bb)} bb`).join(' · '),
      ],
    ];

    for (const [label, value] of facts) {
      const cell = document.createElement('div');
      cell.className = 'spot-fact';
      cell.className = 'spot-fact g-stat';
      cell.appendChild(text('div', 'spot-fact-value g-num', value));
      cell.appendChild(text('div', 'stat-label g-label', label));
      grid.appendChild(cell);
    }
    return grid;
  }

  function renderCommit(lesson: Lesson, example: LessonExample): HTMLElement {
    const form = document.createElement('div');
    form.className = 'commit';
    form.dataset.testid = 'commit';

    const box = document.createElement('textarea');
    box.className = 'lesson-input';
    box.dataset.testid = 'commit-answer';
    box.rows = 2;
    box.placeholder = 'How would you play it, and why?';
    form.appendChild(box);

    // The one committing action on the screen, so it is the bone primary.
    const send = pill('Commit', 'commit-btn', () => {
      const answer = box.value.trim();
      if (answer === '') return;
      commitments.set(key(lesson, example), answer);
      render();
    });
    send.classList.add('primary');
    send.disabled = true;
    box.addEventListener('input', () => {
      send.disabled = box.value.trim() === '';
    });
    form.appendChild(send);

    return form;
  }

  function renderReveal(example: LessonExample, answer: string): HTMLElement {
    const reveal = document.createElement('div');
    reveal.className = 'reveal';
    reveal.dataset.testid = 'lesson-reveal';

    reveal.appendChild(text('div', 'stat-label g-label', 'You committed'));
    const committed = text('p', 'reveal-answer', answer);
    committed.dataset.testid = 'committed-answer';
    reveal.appendChild(committed);

    reveal.appendChild(text('div', 'stat-label g-label', 'The reasoning stored with this position'));
    const reasoning = text('p', 'reveal-reasoning', example.reasoning);
    reasoning.dataset.testid = 'lesson-reasoning';
    reveal.appendChild(reasoning);

    return reveal;
  }

  function renderLexicon(lesson: Lesson): HTMLElement {
    const section = document.createElement('section');
    section.className = 'lexicon';
    section.dataset.testid = 'lexicon';

    section.appendChild(text('div', 'stat-label g-label', 'Your sentence for this mechanism'));

    const mine = lexicon.filter((entry) => entry.lessonId === lesson.id);
    const accepted = mine.filter((entry) => entry.accepted);
    const current = accepted[accepted.length - 1];
    const quote = text(
      'p',
      'lexicon-current',
      current === undefined ? 'Not written yet.' : `“${current.text}”`,
    );
    quote.dataset.testid = 'lexicon-current';
    quote.dataset.present = String(current !== undefined);
    section.appendChild(quote);

    const box = document.createElement('textarea');
    box.className = 'lesson-input';
    box.dataset.testid = 'sentence-input';
    box.rows = 2;
    box.placeholder = 'Say the mechanism in your own words';
    section.appendChild(box);

    const save = pill('Save sentence', 'sentence-save', () => {
      const sentence = box.value.trim();
      if (sentence === '') return;
      const entry: LexiconEntry = {
        lessonId: lesson.id,
        text: sentence,
        accepted: checkSentence(sentence, lesson.acceptanceKeywords),
        at: Date.now(),
      };
      // L3: append. No path in this file edits or drops an entry once it is here.
      lexicon.push(entry);
      persist(lexicon);
      if (entry.accepted) opts.dee?.onRule?.(lesson.id, entry.text);
      lastVerdict = entry;
      render();
    });
    save.disabled = true;
    box.addEventListener('input', () => {
      save.disabled = box.value.trim() === '';
    });
    section.appendChild(save);

    if (lastVerdict !== null && lastVerdict.lessonId === lesson.id) {
      const verdict = text(
        'p',
        'sentence-verdict',
        lastVerdict.accepted
          ? 'Kept as your name for this mechanism.'
          : `Kept in history, not adopted yet: it does not name a mechanism. This one turns on ${lesson.acceptanceKeywords.slice(0, 3).join(' · ')}.`,
      );
      verdict.dataset.testid = 'sentence-verdict';
      verdict.dataset.accepted = String(lastVerdict.accepted);
      section.appendChild(verdict);
    }

    section.appendChild(renderHistory(mine));
    return section;
  }

  function renderHistory(entries: readonly LexiconEntry[]): HTMLElement {
    const list = document.createElement('ol');
    list.className = 'lexicon-history g-flat';
    list.dataset.testid = 'lexicon-history';

    if (entries.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'lexicon-empty';
      empty.textContent = 'Every attempt you save stays here, accepted or not.';
      list.appendChild(empty);
      return list;
    }

    // Newest first, and read-only: L3 keeps the record of how the understanding moved.
    for (const entry of [...entries].reverse()) {
      const item = document.createElement('li');
      item.className = 'lexicon-entry';
      item.dataset.testid = 'lexicon-entry';
      item.dataset.accepted = String(entry.accepted);
      item.appendChild(text('span', 'lexicon-entry-text', entry.text));
      item.appendChild(
        text('span', 'lexicon-entry-tag', entry.accepted ? 'adopted' : 'not adopted'),
      );
      list.appendChild(item);
    }
    return list;
  }

  /**
   * Keyboard nav. Horizontal moves between lessons, vertical between the positions inside one,
   * Escape returns to the list — 17 lessons is too many to reach by clicking.
   *
   * Bound to the window because the screen owns no focus of its own, and self-removing once the
   * root leaves the document: renderTab() drops this element when another tab is chosen, and a
   * listener that outlived it would steal F/C/R/A from the table screen.
   */
  function onKey(event: KeyboardEvent): void {
    if (!root.isConnected) {
      window.removeEventListener('keydown', onKey);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (lessons.length === 0) return;

    /**
     * Escape is handled before the typing guard: it is the only way back to the list, and a
     * learner who has just clicked into the answer box would otherwise be stuck on the lesson
     * with a dead key — a textarea keeps focus after typing, so this is the normal state, not an
     * edge case.
     */
    if (event.key === 'Escape' && view === 'lesson') {
      event.preventDefault();
      showList();
      return;
    }

    // Otherwise the learner is typing their answer or their sentence; those keys are not navigation.
    const target = event.target;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;

    const key = event.key;
    if (view === 'list') {
      if (key === 'ArrowDown' || key === 'j') cursor = clamp(cursor + 1, 0, lessons.length - 1);
      else if (key === 'ArrowUp' || key === 'k') cursor = clamp(cursor - 1, 0, lessons.length - 1);
      else if (key === 'Enter' || key === 'ArrowRight') {
        // preventDefault first: with focus still on the Learn tab (the tab bar keeps a clicked tab
        // focused), Enter's default action re-activates that tab, which re-rendered the list right
        // over the lesson this key had just opened.
        event.preventDefault();
        openLesson(cursor);
        return;
      } else return;
      event.preventDefault();
      render();
      return;
    }

    if (key === 'ArrowRight' || key === 'j') {
      if (lessonIndex === lessons.length - 1) return;
      event.preventDefault();
      openLesson(lessonIndex + 1);
      return;
    }
    if (key === 'ArrowLeft' || key === 'k') {
      if (lessonIndex === 0) return;
      event.preventDefault();
      openLesson(lessonIndex - 1);
      return;
    }
    const count = lessons[lessonIndex].examples.length;
    if (key === 'ArrowDown' && exampleIndex < count - 1) {
      event.preventDefault();
      exampleIndex += 1;
      picked = null;
      render();
      return;
    }
    if (key === 'ArrowUp' && exampleIndex > 0) {
      event.preventDefault();
      exampleIndex -= 1;
      picked = null;
      render();
    }
  }
  window.addEventListener('keydown', onKey);

  render();
  return root;
}

/** Phase order, registry order within a phase. Ordering content is not gating it (N1). */
function ordered(lessons: readonly Lesson[]): readonly Lesson[] {
  return PHASES.flatMap((phase) => lessons.filter((lesson) => lesson.phase === phase));
}

/** Advice, never a gate: an unknown prerequisite id is printed as itself rather than dropped. */
function prerequisiteAdvice(lesson: Lesson): string | null {
  if (lesson.prerequisites.length === 0) return null;
  const names = lesson.prerequisites.map((id) => lessonById(id)?.title ?? id);
  return `Lands sooner after ${names.join(' and ')} — advice, not a gate.`;
}

/**
 * L2's fallback check: with no answer key, a sentence is adopted when it uses one of the lesson's
 * mechanism framings. A lesson that authored no keywords has no criteria to fail, so the learner's
 * own mark stands.
 */
export function checkSentence(sentence: string, keywords: readonly string[]): boolean {
  if (keywords.length === 0) return true;
  const lower = sentence.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

function lastDeeTurn(state: DialogueState): DialogueState['thread'][number] | undefined {
  for (let i = state.thread.length - 1; i >= 0; i--) if (state.thread[i].who === 'dee') return state.thread[i];
  return undefined;
}

/** A stable seed per position, so Dee's generic lines read the same on a revisit. */
function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}

function key(lesson: Lesson, example: LessonExample): string {
  return `${lesson.id}#${example.id}`;
}

function cardGroup(label: string, cards: HTMLElement): HTMLElement {
  const group = document.createElement('div');
  group.className = 'spot-group';
  group.appendChild(cards);
  group.appendChild(text('div', 'stat-label g-label', label));
  return group;
}

function bb(chips: number, bigBlind: number): string {
  const value = chips / bigBlind;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}


function pill(label: string, testid: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pill';
  button.dataset.testid = testid;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function emptyState(title: string, body: string): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.dataset.testid = 'lesson-empty';
  empty.appendChild(text('div', 'empty-state-title', title));
  empty.appendChild(text('div', 'empty-state-body', body));
  return empty;
}

function readLexicon(): LexiconEntry[] {
  try {
    const raw = window.localStorage.getItem(LEXICON_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    // A corrupt or unavailable store degrades to an empty lexicon; it must not blank the screen.
    return [];
  }
}

function persist(entries: readonly LexiconEntry[]): void {
  try {
    window.localStorage.setItem(LEXICON_KEY, JSON.stringify(entries));
  } catch {
    // Nothing to recover: the in-memory list still renders, so the session is not lost.
  }
}

function isEntry(value: unknown): value is LexiconEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.lessonId === 'string' &&
    typeof entry.text === 'string' &&
    typeof entry.accepted === 'boolean' &&
    typeof entry.at === 'number'
  );
}
