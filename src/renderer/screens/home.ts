import type { HandRecord, SessionState } from '../../core/session.js';
import { renderCard } from '../components/card.js';

const RECENT_LIMIT = 5;

export function renderHome(opts: {
  session: SessionState;
  onNewSession: () => void;
  onOpenHand?: (handNumber: number) => void;
}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'home-screen';
  root.dataset.testid = 'home-screen';

  root.appendChild(renderBankroll(opts.session.bankroll));
  root.appendChild(renderNewSessionCard(opts.onNewSession));
  root.appendChild(renderRecentHands(opts.session.hands, opts.onOpenHand));

  return root;
}

function renderBankroll(bankroll: number): HTMLElement {
  const block = document.createElement('div');
  block.className = 'home-bankroll';

  const value = document.createElement('div');
  value.className = 'bankroll';
  value.dataset.testid = 'bankroll';
  // Plain digits, no separators: the e2e suite parses this text as a number.
  value.textContent = String(Math.round(bankroll));
  block.appendChild(value);

  const label = document.createElement('div');
  label.className = 'stat-label';
  label.textContent = 'Bankroll';
  block.appendChild(label);

  return block;
}

function renderNewSessionCard(onNewSession: () => void): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'session-card';
  card.dataset.testid = 'new-hand';
  card.addEventListener('click', onNewSession);

  const title = document.createElement('span');
  title.className = 'session-card-title';
  title.textContent = 'New session';
  card.appendChild(title);

  const meta = document.createElement('span');
  meta.className = 'session-card-meta';
  meta.textContent = 'Sit down and play a hand with the coach watching';
  card.appendChild(meta);

  return card;
}

function renderRecentHands(
  hands: HandRecord[],
  onOpenHand?: (handNumber: number) => void,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'home-recent';

  const heading = document.createElement('div');
  heading.className = 'stat-label';
  heading.textContent = 'Recent hands';
  section.appendChild(heading);

  const recent = hands.slice(-RECENT_LIMIT).reverse();
  if (recent.length === 0) {
    section.appendChild(renderEmptyState());
    return section;
  }

  const list = document.createElement('div');
  list.className = 'hand-list';
  for (const hand of recent) {
    list.appendChild(renderHandRow(hand, onOpenHand));
  }
  section.appendChild(list);

  return section;
}

function renderEmptyState(): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.dataset.testid = 'recent-empty';

  const title = document.createElement('div');
  title.className = 'empty-state-title';
  title.textContent = 'No hands yet';
  empty.appendChild(title);

  const body = document.createElement('div');
  body.className = 'empty-state-body';
  body.textContent = 'Start a session and every hand you play shows up here.';
  empty.appendChild(body);

  return empty;
}

function renderHandRow(hand: HandRecord, onOpenHand?: (handNumber: number) => void): HTMLElement {
  const row = document.createElement(onOpenHand ? 'button' : 'div');
  row.className = 'list-row hand-row';
  row.dataset.testid = 'hand-row';
  row.dataset.hand = String(hand.handNumber);
  if (row instanceof HTMLButtonElement) {
    row.type = 'button';
    row.addEventListener('click', () => onOpenHand?.(hand.handNumber));
  }

  const number = document.createElement('span');
  number.className = 'hand-number';
  number.textContent = `#${hand.handNumber}`;
  row.appendChild(number);

  const cards = document.createElement('span');
  cards.className = 'hand-cards';
  for (const card of hand.hole) {
    cards.appendChild(renderCard(card, { small: true }));
  }
  row.appendChild(cards);

  const net = document.createElement('span');
  net.className = 'hand-net ' + netClass(hand.net);
  net.textContent = formatNet(hand.net);
  row.appendChild(net);

  return row;
}

/**
 * A break-even hand is neither a win nor a loss. Folding the button preflop nets exactly 0, which
 * is the most common outcome a disciplined beginner produces — rendering it as a mint "+0" told
 * them they had won something, and it is the one number on this list they must read as neutral.
 */
function netClass(net: number): string {
  const rounded = Math.round(net);
  if (rounded < 0) return 'net-down';
  if (rounded === 0) return 'net-flat';
  return 'net-up';
}

function formatNet(net: number): string {
  const rounded = Math.round(net);
  if (rounded === 0) return '0';
  return rounded < 0 ? String(rounded) : `+${rounded}`;
}
