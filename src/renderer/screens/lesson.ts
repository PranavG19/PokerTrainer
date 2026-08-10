import '../styles-lesson.css';

import type { Lesson, LessonExample, LessonPhase } from '../../core/lessons/index.js';
import { LESSONS, lessonById } from '../../core/lessons/index.js';
import { renderCard, renderCardRow } from '../components/card.js';

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
  const lexicon: LexiconEntry[] = readLexicon();

  let view: 'list' | 'lesson' = 'list';
  let lessonIndex = 0;
  let exampleIndex = 0;
  /** Keyboard highlight in the list. Advice only — it gates nothing. */
  let cursor = 0;
  /** The verdict on the sentence saved during this visit, so the last attempt gets an answer. */
  let lastVerdict: LexiconEntry | null = null;

  const openLesson = (index: number): void => {
    lessonIndex = clamp(index, 0, lessons.length - 1);
    exampleIndex = 0;
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
    root.dataset.view = view;
    if (view === 'list' || lessons.length === 0) {
      delete root.dataset.lessonId;
      delete root.dataset.exampleId;
      delete root.dataset.committed;
      root.dataset.cursor = String(cursor);
      root.replaceChildren(renderList(), railSeam());
      return;
    }

    const lesson = lessons[lessonIndex];
    const example = lesson.examples[exampleIndex] as LessonExample | undefined;
    root.dataset.lessonId = lesson.id;
    root.dataset.cursor = String(lessonIndex);
    if (example) root.dataset.exampleId = example.id;
    else delete root.dataset.exampleId;
    root.dataset.committed = String(example !== undefined && commitments.has(key(lesson, example)));
    root.replaceChildren(renderLessonView(lesson, example), railSeam());
  }

  function renderList(): HTMLElement {
    const list = document.createElement('div');
    list.className = 'lesson-list';

    const heading = document.createElement('div');
    heading.className = 'lesson-list-heading';
    heading.appendChild(text('div', 'lesson-list-title', 'Lessons'));
    heading.appendChild(
      text(
        'div',
        'lesson-hint',
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
        text('div', 'phase-label', `Phase ${phase} · ${PHASE_LABELS[phase]}`),
      );

      for (const lesson of inPhase) {
        section.appendChild(renderRow(lesson));
      }
      list.appendChild(section);
    }

    return list;
  }

  function renderRow(lesson: Lesson): HTMLElement {
    const index = lessons.indexOf(lesson);

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'lesson-row';
    row.dataset.testid = 'lesson-row';
    row.dataset.lessonId = lesson.id;
    row.dataset.cursor = String(index === cursor);
    row.addEventListener('click', () => openLesson(index));

    row.appendChild(text('span', 'lesson-row-title', lesson.title));
    row.appendChild(text('span', 'lesson-row-mechanism', lesson.mechanism));

    const advice = prerequisiteAdvice(lesson);
    if (advice !== null) {
      const line = text('span', 'lesson-advice', advice);
      line.dataset.testid = 'lesson-advice';
      row.appendChild(line);
    }

    const spots = text(
      'span',
      'lesson-row-meta',
      `${lesson.examples.length} position${lesson.examples.length === 1 ? '' : 's'}`,
    );
    row.appendChild(spots);

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

    const back = pill('All lessons', 'lesson-back', showList);
    header.appendChild(back);

    const titles = document.createElement('div');
    titles.className = 'lesson-titles';
    titles.appendChild(
      text('div', 'phase-label', `Phase ${lesson.phase} · ${PHASE_LABELS[lesson.phase]}`),
    );
    const title = text('h1', 'lesson-title', lesson.title);
    title.dataset.testid = 'lesson-title';
    titles.appendChild(title);
    header.appendChild(titles);

    const nav = document.createElement('div');
    nav.className = 'lesson-nav';
    const previous = pill('Previous', 'lesson-prev', () => openLesson(lessonIndex - 1));
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
    next.disabled = lessonIndex === lessons.length - 1;
    nav.appendChild(next);
    header.appendChild(nav);

    return header;
  }

  function renderExample(lesson: Lesson, example: LessonExample): HTMLElement {
    const section = document.createElement('section');
    section.className = 'example';
    section.dataset.testid = 'example';
    section.dataset.exampleId = example.id;

    if (lesson.examples.length > 1) {
      const tabs = document.createElement('div');
      tabs.className = 'example-tabs';
      lesson.examples.forEach((candidate, index) => {
        const tab = pill(String(index + 1), 'example-tab', () => {
          exampleIndex = index;
          render();
        });
        tab.dataset.exampleId = candidate.id;
        tab.dataset.selected = String(index === exampleIndex);
        tabs.appendChild(tab);
      });
      section.appendChild(tabs);
    }

    section.appendChild(renderSpot(example));

    const prompt = text('p', 'example-prompt', example.prompt);
    prompt.dataset.testid = 'lesson-prompt';
    section.appendChild(prompt);

    const answer = commitments.get(key(lesson, example));
    if (answer === undefined) {
      section.appendChild(renderCommit(lesson, example));
      return section;
    }
    // Built only on this branch: before a commit there is no reveal node anywhere in the tree.
    section.appendChild(renderReveal(example, answer));
    return section;
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
      cell.appendChild(text('div', 'spot-fact-value', value));
      cell.appendChild(text('div', 'stat-label', label));
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

    const send = pill('Commit', 'commit-btn', () => {
      const answer = box.value.trim();
      if (answer === '') return;
      commitments.set(key(lesson, example), answer);
      render();
    });
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

    reveal.appendChild(text('div', 'stat-label', 'You committed'));
    const committed = text('p', 'reveal-answer', answer);
    committed.dataset.testid = 'committed-answer';
    reveal.appendChild(committed);

    reveal.appendChild(text('div', 'stat-label', 'The reasoning stored with this position'));
    const reasoning = text('p', 'reveal-reasoning', example.reasoning);
    reasoning.dataset.testid = 'lesson-reasoning';
    reveal.appendChild(reasoning);

    return reveal;
  }

  function renderLexicon(lesson: Lesson): HTMLElement {
    const section = document.createElement('section');
    section.className = 'lexicon';
    section.dataset.testid = 'lexicon';

    section.appendChild(text('div', 'stat-label', 'Your sentence for this mechanism'));

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
    list.className = 'lexicon-history';
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
      item.className = 'list-row lexicon-entry';
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
      else if (key === 'Enter' || key === 'ArrowRight') return openLesson(cursor);
      else return;
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
      render();
      return;
    }
    if (key === 'ArrowUp' && exampleIndex > 0) {
      event.preventDefault();
      exampleIndex -= 1;
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

/** The tutor rail mounts here. This screen never calls a model; the seam is deliberately empty. */
function railSeam(): HTMLElement {
  const rail = document.createElement('aside');
  rail.className = 'lesson-rail';
  rail.dataset.testid = 'lesson-tutor-rail';
  return rail;
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

function key(lesson: Lesson, example: LessonExample): string {
  return `${lesson.id}#${example.id}`;
}

function cardGroup(label: string, cards: HTMLElement): HTMLElement {
  const group = document.createElement('div');
  group.className = 'spot-group';
  group.appendChild(cards);
  group.appendChild(text('div', 'stat-label', label));
  return group;
}

function bb(chips: number, bigBlind: number): string {
  const value = chips / bigBlind;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function text(tag: string, className: string, content: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = content;
  return el;
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
