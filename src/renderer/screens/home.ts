import type { HandRecord, SessionState } from '../../core/session.js';
import { DEFAULT_BANKROLL } from '../../core/session.js';
import type { Source, Suggestion } from '../../core/recommend.js';
import { renderCard } from '../components/card.js';
import { renderRecommendation, type RecommendationHandlers } from '../components/recommendation.js';
import { renderSessionPlanner } from './sessionPlan.js';

const RECENT_LIMIT = 5;

export function renderHome(opts: {
  session: SessionState;
  /**
   * The learner's STANDING (Depth): the table depth earned from decision quality, never chips
   * (PRODUCT-SPEC v2.1 amendment, scoped to this Play surface). Rendered beside the bankroll as a peer
   * headline so it costs zero net height on the 640px-exact home. Absent when the caller has not wired it.
   * `form` is the SEPARATE live reading (settling/sharp/warming up/rusty) — a bad run shows up here, never
   * as a demotion of the ratcheted depth.
   */
  standing?: { depth: number; label: string; form?: string };
  onNewSession: () => void;
  /** Open the multiplayer (local relay) panel. Absent when the caller has not wired multiplayer. */
  onPlayWithFriends?: () => void;
  onOpenHand?: (handNumber: number) => void;
  /**
   * N2's single suggestion, already computed by core. Home does NOT rank anything — the launcher
   * renders what the recommender decided, so the "never a queue" rule cannot be broken here.
   * Absent (undefined) means the caller has no recommender wired; null means nothing is owed.
   */
  recommendation?: { suggestion: Suggestion | null; askPreference: boolean };
  recommendationHandlers?: RecommendationHandlers;
}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'home-screen';
  root.dataset.testid = 'home-screen';

  root.appendChild(renderHeadline(opts.session.bankroll, opts.standing));

  /*
   * FIRST, ABOVE THE SESSION BUTTON. N5 calls Home "a launcher, not a surface", and the one thing a
   * launcher owes is what to launch — so the suggestion comes before the generic New session card
   * rather than under the hand history where it would be a footnote.
   */
  if (opts.recommendation && opts.recommendationHandlers) {
    root.appendChild(
      renderRecommendation({
        suggestion: opts.recommendation.suggestion,
        askPreference: opts.recommendation.askPreference,
        handlers: opts.recommendationHandlers,
      }),
    );
  }

  // The two launch cards sit side by side rather than stacked: Home is exactly 640px at the minimum
  // window with no spare height (session-plan.spec test 17), so a second stacked card grew a page
  // scrollbar. A row adds the multiplayer entry at zero net height.
  if (opts.onPlayWithFriends) {
    const cards = document.createElement('div');
    cards.className = 'home-session-cards';
    cards.appendChild(renderNewSessionCard(opts.onNewSession));
    cards.appendChild(renderPlayWithFriendsCard(opts.onPlayWithFriends));
    root.appendChild(cards);
  } else {
    root.appendChild(renderNewSessionCard(opts.onNewSession));
  }
  root.appendChild(renderRecentHands(opts.session.hands, opts.onOpenHand));
  /**
   * S1's "Start session" lives here because N5 makes home the launcher: choosing how long you are
   * sitting down for is the launch decision, not a surface to visit. Last in DOM order so the
   * bankroll and the one-click "New session" the rest of the suite drives stay exactly where they
   * were; the planner takes its own column (styles-session-plan.css).
   */
  root.appendChild(
    renderSessionPlanner({
      onStart: () => opts.onNewSession(),
      interleavingSpots: opts.session.interleavingSpots,
    }),
  );

  return root;
}

/**
 * The headline row: bankroll on the left, and (when wired) the earned STANDING beside it. A horizontal
 * row so the standing sits in the column's otherwise-empty right side and adds ZERO vertical height —
 * home is 640px-exact at the minimum window (session-plan.spec test 17), so a stacked block would grow a
 * page scrollbar. The row's height is the taller child (the 64px bankroll), which the standing never
 * exceeds. The standing is deliberately quiet: a small label + depth, NOT a big competing number, and it
 * is never mint (mint stays reserved for win% / gate / winner / pot-odds).
 */
function renderHeadline(bankroll: number, standing?: { depth: number; label: string; form?: string }): HTMLElement {
  const row = document.createElement('div');
  row.className = 'home-headline';
  row.appendChild(renderBankroll(bankroll));
  if (standing) row.appendChild(renderStanding(standing));
  return row;
}

function renderStanding(standing: { depth: number; label: string; form?: string }): HTMLElement {
  const block = document.createElement('div');
  block.className = 'home-standing';
  block.dataset.testid = 'home-standing';
  block.dataset.depth = String(standing.depth);

  const value = document.createElement('div');
  value.className = 'home-standing-value';
  value.dataset.testid = 'home-standing-label';
  value.textContent = standing.label;
  block.appendChild(value);

  const caption = document.createElement('div');
  caption.className = 'stat-label';
  caption.dataset.testid = 'home-standing-caption';
  // The caption carries the SEPARATE live "current form" reading when there is one to show — a bad run
  // surfaces HERE, never as a demotion of the ratcheted depth above. 'settling' means "not enough to say"
  // yet, so it falls back to the neutral "Standing" caption rather than announcing a verdict it lacks.
  // All form words (sharp/warming up/rusty) and "Standing" are BANNED_PHRASINGS-clean — no rank/level word.
  const form = standing.form;
  const showsForm = form != null && form !== 'settling';
  caption.textContent = showsForm ? (form as string) : 'Standing';
  if (showsForm) caption.dataset.form = form as string;
  block.appendChild(caption);

  return block;
}

function renderBankroll(bankroll: number): HTMLElement {
  const block = document.createElement('div');
  block.className = 'home-bankroll';

  const value = document.createElement('div');
  const rounded = Math.round(bankroll);
  // Same win/loss colouring as the hand rows below. Without it the headline number — the most
  // prominent thing on the screen — was the only figure not colour-coded, so a bankroll of -5000
  // (reachable: three busts and rebuys off a 10000 start) read as plain white next to red rows.
  const direction = rounded > DEFAULT_BANKROLL ? 'net-up' : rounded < DEFAULT_BANKROLL ? 'net-down' : 'net-flat';
  value.className = `bankroll ${direction}`;
  value.dataset.testid = 'bankroll';
  value.dataset.direction = direction;
  // Plain digits, no separators: the e2e suite parses this text as a number.
  value.textContent = String(rounded);
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

function renderPlayWithFriendsCard(onPlayWithFriends: () => void): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'session-card';
  card.dataset.testid = 'play-with-friends';
  card.addEventListener('click', onPlayWithFriends);

  const title = document.createElement('span');
  title.className = 'session-card-title';
  title.textContent = 'Play with friends';
  card.appendChild(title);

  const meta = document.createElement('span');
  meta.className = 'session-card-meta';
  meta.textContent = 'Host or join a table on your local network';
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
