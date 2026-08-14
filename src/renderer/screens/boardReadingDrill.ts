import type { Card } from '../../core/cards.js';
import { CATEGORY_NAMES, HandCategory } from '../../core/evaluate.js';
import { RT_THRESHOLD_MS } from '../../core/anomaly.js';
import { grade, nextQuestion, type BoardReadingQuestion, type BoardReadingVerdict } from '../../core/boardReading.js';
import { mulberry32 } from '../../core/rng.js';
import { renderCard } from '../components/card.js';

/**
 * BOARD-READING DRILL — a Train-hub practice mode ("Sight"). Seven cards land; the learner names the
 * made-hand CATEGORY as fast as they can. The grade comes from core/boardReading (whose answer key is
 * evaluate(), the engine's own best-5-of-7 ranker) and the fluency gate is the shared RT_THRESHOLD_MS —
 * this file computes no poker of its own, exactly like the hand-reading drill it is cloned from.
 *
 * Reuses the .defense-drill CSS classes (no new stylesheet), same as the hand-reading and 3-bet drills.
 *
 * Sync for e2e: the root publishes data-answered / data-verdict / data-category / data-fast each paint.
 */

/** Fixed seed so the drill sequence is identical on every launch (parity with the other chart drills). */
const DRILL_SEED = 71;

/** The nine categories in rank order; the array index + 1 is the button's number-key shortcut (1–9). */
const CATEGORY_ORDER: readonly HandCategory[] = [
  HandCategory.HighCard,
  HandCategory.Pair,
  HandCategory.TwoPair,
  HandCategory.Trips,
  HandCategory.Straight,
  HandCategory.Flush,
  HandCategory.FullHouse,
  HandCategory.Quads,
  HandCategory.StraightFlush,
];

const GATE_SECONDS = `${RT_THRESHOLD_MS / 1000}s`;

/** performance.now() where it exists; Date.now() is the fallback and is accurate enough for a 2s gate. */
function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

interface Feedback {
  readonly question: BoardReadingQuestion;
  readonly verdict: BoardReadingVerdict;
  readonly rtMs: number;
}

export function renderBoardReadingDrill(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'defense-drill board-reading-drill';
  root.dataset.testid = 'board-reading-drill';

  // Always-present polite region for the verdict, kept as the root's first child so paint()'s
  // replaceChildren never drops it from the a11y tree (the pattern the other drills use).
  const announcer = document.createElement('div');
  announcer.className = 'visually-hidden';
  announcer.dataset.testid = 'board-reading-announcer';
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-live', 'polite');
  root.appendChild(announcer);

  const rng = mulberry32(DRILL_SEED);
  let question: BoardReadingQuestion = nextQuestion(rng);
  let feedback: Feedback | null = null;
  let answered = 0;
  // When the current unanswered board was shown, so a commit measures reaction time against it. The
  // clock resets for every new question (below), so it never carries a stale start across boards.
  let shownAt = now();

  function commit(chosen: HandCategory): void {
    const rtMs = now() - shownAt;
    const verdict = grade(question, chosen, rtMs);
    feedback = { question, verdict, rtMs };
    answered += 1;
    question = nextQuestion(rng);
    shownAt = now();
    paint();
  }

  function onKey(event: KeyboardEvent): void {
    if (!root.isConnected) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= CATEGORY_ORDER.length) {
      commit(CATEGORY_ORDER[digit - 1]);
    }
  }
  document.addEventListener('keydown', onKey);

  function paint(): void {
    root.dataset.answered = String(answered);
    root.dataset.verdict = feedback === null ? '' : feedback.verdict.correct ? 'right' : 'wrong';
    root.dataset.category = feedback === null ? '' : String(feedback.verdict.category);
    root.dataset.fast = feedback === null ? '' : String(feedback.verdict.fast);
    announcer.textContent = feedback === null ? '' : verdictAnnouncement(feedback);
    root.replaceChildren(announcer, renderPrompt(question, commit), renderFeedback(feedback));
  }

  paint();
  return root;
}

function renderPrompt(question: BoardReadingQuestion, onCommit: (c: HandCategory) => void): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'defense-prompt';
  panel.dataset.testid = 'board-reading-prompt';

  const situation = document.createElement('div');
  situation.className = 'defense-width stat-label';
  situation.dataset.testid = 'board-reading-situation';
  situation.textContent = `Name your best five-card hand — under ${GATE_SECONDS}.`;
  panel.appendChild(situation);

  panel.appendChild(cardRow('Your hand', [...question.hole], 'board-reading-hole'));
  panel.appendChild(cardRow('Board', [...question.board], 'board-reading-board'));

  const keys = document.createElement('div');
  keys.className = 'defense-keys board-reading-keys';
  CATEGORY_ORDER.forEach((category, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pill defense-key';
    button.dataset.testid = `board-reading-cat-${category}`;
    button.textContent = `${i + 1} ${CATEGORY_NAMES[category]}`;
    button.addEventListener('click', () => onCommit(category));
    keys.appendChild(button);
  });
  panel.appendChild(keys);

  return panel;
}

/** A labelled row of cards (the hole pair or the five-card board). */
function cardRow(label: string, cards: Card[], testid: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'board-reading-row';

  const caption = document.createElement('div');
  caption.className = 'stat-label';
  caption.textContent = label;
  row.appendChild(caption);

  const hand = document.createElement('div');
  hand.className = 'defense-hand';
  hand.dataset.testid = testid;
  for (const card of cards) hand.appendChild(renderCard(card, { small: true }));
  row.appendChild(hand);

  return row;
}

/** The verdict as one spoken line, mirroring renderFeedback so the two cannot drift. */
function verdictAnnouncement(feedback: Feedback): string {
  const truth = CATEGORY_NAMES[feedback.verdict.category];
  const speed = feedback.verdict.fast ? `inside the ${GATE_SECONDS} gate` : `over the ${GATE_SECONDS} gate`;
  const line = feedback.verdict.correct
    ? `correct, ${truth}`
    : `it was ${truth}, not ${CATEGORY_NAMES[feedback.verdict.chosen]}`;
  return `last ${line}, ${speed}`;
}

function renderFeedback(feedback: Feedback | null): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'defense-feedback';
  wrap.dataset.testid = 'board-reading-feedback';

  if (feedback === null) {
    wrap.dataset.verdict = 'none';
    wrap.textContent = `Press 1–9 to name the hand. Speed counts: a pass is right AND under ${GATE_SECONDS}.`;
    return wrap;
  }

  const { verdict, rtMs } = feedback;
  wrap.dataset.verdict = verdict.correct ? 'right' : 'wrong';

  const when = document.createElement('span');
  when.className = 'defense-when';
  when.textContent = 'last';
  wrap.appendChild(when);

  const truth = CATEGORY_NAMES[verdict.category];
  const line = document.createElement('span');
  line.className = 'defense-verdict';
  line.dataset.testid = 'board-reading-verdict';
  line.textContent = verdict.correct
    ? `${truth}`
    : `${truth}, not ${CATEGORY_NAMES[verdict.chosen]}`;
  wrap.appendChild(line);

  // The reaction time against the shared fluency gate — the whole point of a Sight drill is speed, so a
  // correct-but-slow answer is shown as not yet fluent rather than a plain tick.
  const timing = document.createElement('span');
  timing.className = 'defense-tag';
  timing.dataset.testid = 'board-reading-timing';
  timing.dataset.fast = String(verdict.fast);
  timing.textContent = `${(rtMs / 1000).toFixed(1)}s — ${verdict.fast ? `inside the ${GATE_SECONDS} gate` : `over the ${GATE_SECONDS} gate`}`;
  wrap.appendChild(timing);

  return wrap;
}
