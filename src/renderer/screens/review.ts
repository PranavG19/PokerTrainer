import '../styles-review.css';

import type { Card } from '../../core/cards.js';
import type { Grade } from '../../core/coach.js';
import type { DecisionRecord, HandRecord } from '../../core/session.js';
import { renderCard, renderCardRow } from '../components/card.js';

export interface ReviewHandle {
  root: HTMLElement;
  destroy: () => void;
}

/**
 * One step of the replay. The result step is not decoration: a hand where the hero was all-in from
 * the blinds records no decisions at all, and a replay that renders nothing for it would look
 * broken rather than say what happened.
 */
type Step =
  | { kind: 'decision'; ordinal: number; decision: DecisionRecord }
  | { kind: 'result' };

const STREET_LABELS: Record<string, string> = {
  preflop: 'Preflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'Showdown',
};

const SEVERITY_WORDS: Record<Grade['severity'], string> = {
  free: 'No leak flagged',
  notable: 'Notable mistake',
  serious: 'Serious mistake',
};

/**
 * Replay one finished hand, decision by decision, from what was RECORDED — never re-graded. The
 * coach's verdict is a seeded Monte Carlo estimate, so grading a stored hand again would put a
 * different number in front of the learner and call it the advice they were given.
 *
 * A hand saved before decisions were logged has `decisions` absent (not empty): review says so in
 * words instead of showing an empty replay, which would read as "you made no decisions".
 */
export function renderReview(opts: { hand: HandRecord; onBack: () => void }): ReviewHandle {
  const { hand } = opts;
  const recorded = hand.decisions;
  const steps: Step[] = [
    ...(recorded ?? []).map((decision, ordinal): Step => ({ kind: 'decision', ordinal, decision })),
    { kind: 'result' },
  ];

  let index = 0;

  const root = document.createElement('div');
  root.className = 'review-screen';
  root.dataset.testid = 'review-screen';
  root.dataset.hand = String(hand.handNumber);
  root.dataset.decisions = recorded === undefined ? 'unrecorded' : String(recorded.length);

  const head = document.createElement('div');
  head.className = 'review-head';
  root.appendChild(head);

  const title = document.createElement('div');
  title.className = 'review-title';
  title.textContent = `Hand #${hand.handNumber}`;
  head.appendChild(title);

  const progress = document.createElement('div');
  progress.className = 'review-progress';
  progress.dataset.testid = 'review-progress';
  head.appendChild(progress);

  const back = pill('Back to history', 'review-back', () => opts.onBack());
  back.classList.add('review-back');
  head.appendChild(back);

  const step = document.createElement('div');
  step.className = 'review-step';
  step.dataset.testid = 'review-step';
  root.appendChild(step);

  const nav = document.createElement('div');
  nav.className = 'review-nav';
  root.appendChild(nav);

  // Never disabled: a dead-looking control at either end of the replay reads as a gate. At the ends
  // the press simply stays put, and the progress counter already says where the learner is.
  const prev = pill('Back', 'review-prev', () => go(index - 1));
  const next = pill('Next', 'review-next', () => go(index + 1));
  nav.appendChild(prev);
  nav.appendChild(next);

  const hint = document.createElement('div');
  hint.className = 'review-hint';
  hint.textContent = 'Arrow keys step · Esc returns to history';
  nav.appendChild(hint);

  function go(to: number): void {
    const clamped = Math.min(steps.length - 1, Math.max(0, to));
    if (clamped === index) return;
    index = clamped;
    render();
  }

  function render(): void {
    const current = steps[index];
    root.dataset.step = String(index);
    root.dataset.steps = String(steps.length);
    root.dataset.kind = current.kind;
    progress.textContent = `Step ${index + 1} of ${steps.length}`;

    step.replaceChildren(
      ...(current.kind === 'decision'
        ? decisionStep(current.decision, current.ordinal, hand.hole)
        : resultStep(hand, recorded)),
    );
  }

  function onKey(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key;
    if (key === 'ArrowRight' || key === 'j') go(index + 1);
    else if (key === 'ArrowLeft' || key === 'k') go(index - 1);
    else if (key === 'Home') go(0);
    else if (key === 'End') go(steps.length - 1);
    else if (key === 'Escape') opts.onBack();
    else return;
    event.preventDefault();
  }
  window.addEventListener('keydown', onKey);

  render();

  return {
    root,
    destroy: () => {
      window.removeEventListener('keydown', onKey);
    },
  };
}

function decisionStep(decision: DecisionRecord, ordinal: number, hole: Card[]): HTMLElement[] {
  const street = document.createElement('div');
  street.className = 'review-street';
  street.dataset.testid = 'review-street';
  street.dataset.street = decision.street;
  street.textContent = `Decision ${ordinal + 1} · ${STREET_LABELS[decision.street] ?? decision.street}`;

  const cards = document.createElement('div');
  cards.className = 'review-cards';
  cards.appendChild(cardGroup('Your cards', 'review-hole', hole));
  cards.appendChild(cardGroup('Board', 'review-board', decision.board));

  const numbers = document.createElement('div');
  numbers.className = 'review-numbers';
  numbers.appendChild(numberBlock('Pot', 'review-pot', String(decision.pot), String(decision.pot)));
  numbers.appendChild(
    numberBlock(
      'To call',
      'review-tocall',
      decision.toCall === 0 ? 'nothing' : String(decision.toCall),
      String(decision.toCall),
    ),
  );

  const action = document.createElement('div');
  action.className = 'review-action';
  action.dataset.testid = 'review-action';
  action.dataset.action = decision.action;
  if (decision.amount !== null) action.dataset.amount = String(decision.amount);
  action.textContent = `You ${actionPhrase(decision)}`;

  return [street, cards, numbers, action, verdictBlock(decision.verdict)];
}

/** Past tense throughout: this is a record of what happened, not a prompt to act. */
function actionPhrase(decision: DecisionRecord): string {
  switch (decision.action) {
    case 'fold':
      return 'folded';
    case 'check':
      return 'checked';
    case 'call':
      return decision.toCall > 0 ? `called ${decision.toCall}` : 'called';
    case 'bet':
      return decision.amount === null ? 'bet' : `bet ${decision.amount}`;
    case 'raise':
      return decision.amount === null ? 'raised' : `raised to ${decision.amount}`;
    case 'allin':
      return 'went all-in';
  }
}

/**
 * The verdict, in words before anything else. Three distinct facts have to stay distinguishable:
 * the coach graded this and stayed silent, the coach graded this and flagged it, and no verdict was
 * ever recorded. Collapsing the third into "no leak" would credit the learner with a clean decision
 * nobody ever judged.
 */
function verdictBlock(verdict: Grade | null): HTMLElement {
  const block = document.createElement('div');
  block.className = 'review-verdict';
  block.dataset.testid = 'review-verdict';

  if (verdict === null) {
    block.dataset.severity = 'unrecorded';
    block.appendChild(
      line('review-verdict-severity', 'No verdict recorded'),
    );
    block.appendChild(
      line(
        'review-verdict-message',
        'This hand was saved before the coach kept a verdict per decision, so there is nothing to show here.',
      ),
    );
    return block;
  }

  block.dataset.severity = verdict.severity;
  block.appendChild(
    line(
      'review-verdict-severity',
      `${SEVERITY_WORDS[verdict.severity]} · ${verdict.evLossBb.toFixed(1)} bb${
        verdict.principle === null ? '' : ` · ${verdict.principle}`
      }`,
    ),
  );
  block.appendChild(
    line(
      'review-verdict-message',
      verdict.message ??
        'The coach stayed silent on this one: the cost was under half a big blind.',
    ),
  );
  return block;
}

function resultStep(hand: HandRecord, recorded: DecisionRecord[] | undefined): HTMLElement[] {
  const street = document.createElement('div');
  street.className = 'review-street';
  street.dataset.testid = 'review-street';
  street.dataset.street = 'result';
  street.textContent = 'How it ended';

  const cards = document.createElement('div');
  cards.className = 'review-cards';
  cards.appendChild(cardGroup('Your cards', 'review-hole', hand.hole));
  cards.appendChild(cardGroup('Final board', 'review-board', hand.board));

  const numbers = document.createElement('div');
  numbers.className = 'review-numbers';
  const net = Math.round(hand.net);
  numbers.appendChild(
    numberBlock(
      'Your result',
      'review-net',
      net === 0 ? 'broke even' : net > 0 ? `won ${net}` : `lost ${-net}`,
      String(net),
    ),
  );
  numbers.appendChild(
    numberBlock(
      'Decisions replayed',
      'review-decision-count',
      recorded === undefined ? 'not recorded' : String(recorded.length),
      recorded === undefined ? 'unrecorded' : String(recorded.length),
    ),
  );

  const note = document.createElement('div');
  note.className = 'review-verdict';
  note.dataset.testid = 'review-verdict';
  note.dataset.severity = 'result';
  note.appendChild(line('review-verdict-severity', 'Recorded, not recomputed'));
  note.appendChild(
    line(
      'review-verdict-message',
      recorded === undefined
        ? 'This hand predates decision logging, so only its cards and result were saved.'
        : 'Every step above is what was saved when you played the hand.',
    ),
  );

  return [street, cards, numbers, note];
}

function cardGroup(label: string, testid: string, cards: Card[]): HTMLElement {
  const group = document.createElement('div');
  group.className = 'review-card-group';
  group.appendChild(line('review-number-label', label));

  const row = document.createElement('div');
  row.dataset.testid = testid;
  row.dataset.count = String(cards.length);
  if (cards.length === 0) {
    // Said in words, because an empty row is indistinguishable from a failed render.
    row.appendChild(line('review-empty', 'None yet'));
  } else {
    row.appendChild(renderCardRow(cards, { small: true }));
  }
  group.appendChild(row);

  return group;
}

function numberBlock(label: string, testid: string, text: string, raw: string): HTMLElement {
  const block = document.createElement('div');
  block.appendChild(line('review-number-label', label));

  const value = document.createElement('div');
  value.className = 'review-number-value';
  value.dataset.testid = testid;
  value.dataset.value = raw;
  value.textContent = text;
  block.appendChild(value);

  return block;
}

function line(className: string, text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
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

/**
 * The hand picker: which finished hand to replay. Newest first, because the hand a learner wants to
 * understand is nearly always the one they just played, and it scrolls rather than being capped —
 * the whole logged window is reachable.
 */
export function renderReviewList(opts: {
  hands: HandRecord[];
  /** The hand's INDEX in the log, because handNumber is not unique across legacy saves. */
  onOpen: (index: number) => void;
  onBack: () => void;
}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'review-screen';
  root.dataset.testid = 'review-picker';

  const head = document.createElement('div');
  head.className = 'review-head';
  root.appendChild(head);

  const title = document.createElement('div');
  title.className = 'review-title';
  title.textContent = 'Review a hand';
  head.appendChild(title);

  const count = document.createElement('div');
  count.className = 'review-progress';
  count.dataset.testid = 'review-list-count';
  count.textContent =
    opts.hands.length === 1 ? '1 hand logged' : `${opts.hands.length} hands logged`;
  head.appendChild(count);

  const back = pill('Back to profile', 'review-list-back', () => opts.onBack());
  back.classList.add('review-back');
  head.appendChild(back);

  root.appendChild(handList(opts.hands, opts.onOpen));

  return root;
}

function handList(hands: HandRecord[], onOpen: (index: number) => void): HTMLElement {
  const list = document.createElement('div');
  list.className = 'review-list';
  list.dataset.testid = 'review-list';

  // Newest first for display, but each row keeps the hand's own index in the log so the click opens
  // that hand and not another one that happens to share its number.
  const recent = hands.map((hand, index) => ({ hand, index })).reverse();
  if (recent.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'review-empty';
    empty.dataset.testid = 'review-list-empty';
    empty.textContent = 'Play a hand and it lands here, ready to step through.';
    list.appendChild(empty);
    return list;
  }

  for (const { hand, index } of recent) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'review-hand-row';
    row.dataset.testid = 'review-hand-row';
    row.dataset.hand = String(hand.handNumber);
    row.dataset.index = String(index);
    row.addEventListener('click', () => onOpen(index));

    const number = document.createElement('span');
    number.className = 'review-hand-number';
    number.textContent = `#${hand.handNumber}`;
    row.appendChild(number);

    const cards = document.createElement('span');
    cards.className = 'review-hand-cards';
    for (const card of hand.hole) cards.appendChild(renderCard(card, { small: true }));
    row.appendChild(cards);

    const steps = document.createElement('span');
    steps.className = 'review-hand-steps';
    steps.dataset.testid = 'review-hand-steps';
    steps.textContent =
      hand.decisions === undefined
        ? 'no decisions recorded'
        : `${hand.decisions.length} decision${hand.decisions.length === 1 ? '' : 's'}`;
    row.appendChild(steps);

    list.appendChild(row);
  }

  return list;
}
