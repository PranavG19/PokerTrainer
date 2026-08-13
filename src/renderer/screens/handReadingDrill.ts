import { classOf, type Combo } from '../../core/preflop.js';
import { grade, nextQuestion, type HandReadingQuestion, type ReadScenario } from '../../core/handReading.js';
import type { Card } from '../../core/cards.js';
import { mulberry32 } from '../../core/rng.js';
import { renderCard } from '../components/card.js';

/**
 * HAND-READING DRILL — a Train-hub practice mode. An opener raises first-in from a position, and the
 * learner judges whether the shown two cards are IN that opener's range or FOLDED. The grade comes from
 * core/handReading (which reads the app's own rule-stated RFI range) — this file computes no poker of
 * its own, exactly like the defense/3-bet drills it is cloned from.
 *
 * Reuses the .defense-drill CSS classes (no new stylesheet), same as the 3-bet-response drill.
 *
 * Sync for e2e: the root publishes data-position / data-combo / data-answered / data-verdict each paint.
 */

/** Fixed seed so the drill sequence is identical on every launch (parity with the other chart drills). */
const DRILL_SEED = 17;

type Answer = 'in' | 'folded';
const ANSWER_LABEL: Record<Answer, string> = { in: 'In range', folded: 'Folded' };
/** One-letter shortcut per answer, shown on the button (I / O). */
const ANSWER_KEY: Record<Answer, string> = { in: 'I', folded: 'O' };

/** Human labels for the opener seat — the situation, never the answer. */
const POSITION_LABEL: Record<string, string> = {
  UTG: 'UTG',
  HJ: 'the hijack',
  CO: 'the cutoff',
  BTN: 'the button',
  SB: 'the small blind',
};

/**
 * The situation sentence per scenario, given the opener's seat label. Each names the action that shapes
 * the range (and, for the two flat scenarios, the capping action) but never states which hands are in —
 * the read is the learner's to make. The word "3-bet" in the flat-3bet line and "flat-calls" in both flat
 * lines are what the e2e keys on.
 */
const SITUATION: Record<ReadScenario, (seat: string) => string> = {
  open: (seat) => `A player opens from ${seat}. Is this hand in their range?`,
  'flat-3bet': (seat) =>
    `A player opens from ${seat}, then flat-calls your 3-bet. Is this hand still in their range?`,
  'bb-defend': (seat) =>
    `A player opens from ${seat} and the big blind flat-calls. Is this hand in the big blind's calling range?`,
};

interface Feedback {
  readonly question: HandReadingQuestion;
  readonly chose: Answer;
  readonly correct: boolean;
}

export function renderHandReadingDrill(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'defense-drill hand-reading-drill';
  root.dataset.testid = 'hand-reading-drill';

  // Always-present polite region for the verdict, kept as the root's first child so paint()'s
  // replaceChildren never drops it from the a11y tree (the pattern the other drills use).
  const verdictAnnouncer = document.createElement('div');
  verdictAnnouncer.className = 'visually-hidden';
  verdictAnnouncer.dataset.testid = 'hand-reading-announcer';
  verdictAnnouncer.setAttribute('role', 'status');
  verdictAnnouncer.setAttribute('aria-live', 'polite');
  root.appendChild(verdictAnnouncer);

  const rng = mulberry32(DRILL_SEED);
  let question: HandReadingQuestion = nextQuestion(rng);
  let feedback: Feedback | null = null;
  let answered = 0;

  function commit(chose: Answer): void {
    const verdict = grade(question, chose === 'in');
    feedback = { question, chose, correct: verdict.correct };
    answered += 1;
    question = nextQuestion(rng);
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
    const key = event.key.toLowerCase();
    if (key === 'i') commit('in');
    else if (key === 'o') commit('folded');
  }
  document.addEventListener('keydown', onKey);

  function paint(): void {
    root.dataset.position = question.position;
    root.dataset.combo = question.combo;
    root.dataset.scenario = question.scenario;
    root.dataset.answered = String(answered);
    root.dataset.verdict = feedback === null ? '' : feedback.correct ? 'right' : 'wrong';
    verdictAnnouncer.textContent = feedback === null ? '' : verdictAnnouncement(feedback);
    root.replaceChildren(verdictAnnouncer, renderPrompt(question, commit), renderFeedback(feedback));
  }

  paint();
  return root;
}

function renderPrompt(question: HandReadingQuestion, onCommit: (answer: Answer) => void): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'defense-prompt';
  panel.dataset.testid = 'hand-reading-prompt';

  // The situation line: which seat opened. Never states the answer.
  const situation = document.createElement('div');
  situation.className = 'defense-width stat-label';
  situation.dataset.testid = 'hand-reading-situation';
  situation.dataset.scenario = question.scenario;
  const seat = POSITION_LABEL[question.position] ?? question.position;
  // Each line names the situation (and the capping action, for the two flat scenarios) but never the
  // answer — the learner must realise for themselves which hands the action removes from the range.
  situation.textContent = SITUATION[question.scenario](seat);
  panel.appendChild(situation);

  const hand = document.createElement('div');
  hand.className = 'defense-hand';
  hand.dataset.testid = 'hand-reading-hand';
  hand.dataset.combo = question.combo;
  for (const card of cardsFor(question.combo)) hand.appendChild(renderCard(card, { small: true }));
  panel.appendChild(hand);

  const keys = document.createElement('div');
  keys.className = 'defense-keys';
  for (const answer of ['in', 'folded'] as Answer[]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pill defense-key';
    button.dataset.testid = `hand-reading-${answer}`;
    button.textContent = `${ANSWER_KEY[answer]} ${ANSWER_LABEL[answer]}`;
    button.addEventListener('click', () => onCommit(answer));
    keys.appendChild(button);
  }
  panel.appendChild(keys);

  return panel;
}

/** The verdict as one spoken line, mirroring renderFeedback's wording so the two cannot drift. */
function verdictAnnouncement(feedback: Feedback): string {
  const { question } = feedback;
  const truth = question.inRange ? 'in range' : 'a fold';
  const line = feedback.correct
    ? `${question.combo} is ${truth}`
    : `${question.combo} is ${truth}, not ${question.inRange ? 'a fold' : 'in range'}`;
  return `last ${line} ${classOf(question.combo)}`;
}

function renderFeedback(feedback: Feedback | null): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'defense-feedback';
  wrap.dataset.testid = 'hand-reading-feedback';

  if (feedback === null) {
    wrap.dataset.verdict = 'none';
    wrap.textContent = 'Say whether the hand is In range or Folded (I / O). The answer is not shown until you commit.';
    return wrap;
  }

  const { question } = feedback;
  wrap.dataset.verdict = feedback.correct ? 'right' : 'wrong';
  wrap.dataset.combo = question.combo;

  const when = document.createElement('span');
  when.className = 'defense-when';
  when.textContent = 'last';
  wrap.appendChild(when);

  const truth = question.inRange ? 'in range' : 'a fold';
  const line = document.createElement('span');
  line.className = 'defense-verdict';
  line.dataset.testid = 'hand-reading-verdict';
  line.textContent = feedback.correct
    ? `${question.combo} is ${truth}`
    : `${question.combo} is ${truth}, not ${question.inRange ? 'a fold' : 'in range'}`;
  wrap.appendChild(line);

  const tag = document.createElement('span');
  tag.className = 'defense-tag';
  tag.dataset.testid = 'hand-reading-tag';
  tag.dataset.class = classOf(question.combo);
  tag.textContent = classOf(question.combo);
  wrap.appendChild(tag);

  return wrap;
}

/**
 * Two concrete cards for a combo. Suits fixed so the same combo always looks the same. A PAIR ("QQ")
 * must use two DIFFERENT suits — the defense drill's cardsFor would render "QsQs", an impossible card;
 * this drill handles it since a pair is a common in/out boundary hand.
 */
function cardsFor(combo: Combo): Card[] {
  const isPair = combo.length === 2 && combo[0] === combo[1];
  if (isPair) return [`${combo[0]}s`, `${combo[1]}h`];
  const suited = combo.endsWith('s');
  return [`${combo[0]}s`, `${combo[1]}${suited ? 's' : 'h'}`];
}
