import type { HandRecord, SessionState } from '../../core/session.js';
import { DEFAULT_BANKROLL } from '../../core/session.js';
import type { SessionPlan } from '../../core/sessionPlan.js';
import type { Source, Suggestion } from '../../core/recommend.js';
import { renderCard } from '../components/card.js';
import { renderRecommendation, type RecommendationHandlers } from '../components/recommendation.js';
import { renderSessionPlanner } from './sessionPlan.js';
import { chevron, iconTile, peopleIcon, spadeIcon } from '../components/glyphs.js';
import { renderGreeting, renderStreakCard, renderTicketRow, type StreakView } from '../components/habit.js';
import type { Greeting } from '../../core/progression/greeting.js';
import type { Ring } from '../../core/progression/ring.js';
import type { TicketState } from '../../core/progression/types.js';
import type { DayKey } from '../../core/localDay.js';

/** The habit loop on Home (1.5): Dee's greeting, the streak and today's ring, and the Ticket's row. */
export interface HomeHabit {
  /** Null with Character off: Dee's own words hide. */
  readonly greeting: Greeting | null;
  readonly streak: StreakView;
  readonly ring: Ring;
  readonly ticket: TicketState;
  readonly today: DayKey;
  readonly onOpenTicket: () => void;
}

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
  /**
   * The session PLANNER's Start: the learner committed to a specific sitting, so the ASSEMBLED plan
   * (its whole-task live-hand count, mode and mix) is handed to the caller to parameterise the
   * launched session. Absent → the planner's Start falls back to the plain onNewSession, i.e. the
   * default table, so a caller that has not wired the planner yet is unchanged.
   */
  onStartPlanned?: (plan: SessionPlan) => void;
  /** The Long Orbit's suggested chapter, one row in the launch group (screens/story.ts). Absent = none. */
  storyStrip?: HTMLElement;
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
  /** The habit loop. Absent: Home as it was (no greeting, streak, ring or Ticket). */
  habit?: HomeHabit;
  /**
   * The session planner in Home's second column (the default). The 7-tab nav moves it to Play, and Home's second
   * column then carries `side` under the streak card instead.
   */
  planner?: boolean;
  side?: readonly HTMLElement[];
}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'home-screen';
  root.dataset.testid = 'home-screen';

  // The launcher column (headline, suggestion, the two launch rows, recent hands); the planner takes the
  // second column. Order inside the column is the order the rest of the suite drives.
  const col = document.createElement('div');
  col.className = 'home-col';
  root.appendChild(col);

  if (opts.habit?.greeting) col.appendChild(renderGreeting(opts.habit.greeting));
  col.appendChild(renderHeadline(opts.session.bankroll, opts.standing));

  /*
   * FIRST, ABOVE THE SESSION BUTTON. N5 calls Home "a launcher, not a surface", and the one thing a
   * launcher owes is what to launch — so the suggestion comes before the generic New session card
   * rather than under the hand history where it would be a footnote.
   */
  if (opts.recommendation && opts.recommendationHandlers) {
    col.appendChild(
      renderRecommendation({
        suggestion: opts.recommendation.suggestion,
        askPreference: opts.recommendation.askPreference,
        handlers: opts.recommendationHandlers,
      }),
    );
  }

  // One inset group of launch rows (the mock's grouped list): New session, then Play with friends.
  const launch = document.createElement('div');
  launch.className = 'g-group home-launch';
  if (opts.habit) launch.appendChild(renderTicketRow(opts.habit.ticket, opts.habit.today, opts.habit.onOpenTicket));
  launch.appendChild(renderNewSessionCard(opts.onNewSession));
  if (opts.onPlayWithFriends) launch.appendChild(renderPlayWithFriendsCard(opts.onPlayWithFriends));
  if (opts.storyStrip) launch.appendChild(opts.storyStrip);
  col.appendChild(launch);
  col.appendChild(renderRecentHands(opts.session.hands, opts.onOpenHand));
  /**
   * S1's "Start session" lives here because N5 makes home the launcher: choosing how long you are
   * sitting down for is the launch decision, not a surface to visit. Last in DOM order so the
   * bankroll and the one-click "New session" the rest of the suite drives stay exactly where they
   * were; the planner takes its own column (styles-session-plan.css).
   */
  // The second column: the streak and the ring over the planner (the planner keeps its own column order).
  const side = document.createElement('div');
  side.className = 'home-side';
  root.appendChild(side);
  if (opts.habit) side.appendChild(renderStreakCard(opts.habit.streak, opts.habit.ring));
  for (const el of opts.side ?? []) side.appendChild(el);
  if (opts.planner === false) return root;
  side.appendChild(
    renderSessionPlanner({
      // Thread the assembled plan into session start. Before this, Start discarded the plan and
      // opened the ordinary default table (the planner "lied"). When no planned-start handler is
      // wired the plain New session path is the honest fallback, so nothing regresses.
      onStart: (plan) => {
        if (opts.onStartPlanned) opts.onStartPlanned(plan);
        else opts.onNewSession();
      },
      interleavingSpots: opts.session.interleavingSpots,
      defaultMinutes: opts.session.progression.personalization.schedule?.sessionMinutes ?? null,
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
  block.className = 'home-standing g-stat';
  block.dataset.testid = 'home-standing';
  block.dataset.depth = String(standing.depth);

  const value = document.createElement('div');
  value.className = 'home-standing-value t-head';
  value.dataset.testid = 'home-standing-label';
  value.textContent = standing.label;
  block.appendChild(value);

  const caption = document.createElement('div');
  caption.className = 'stat-label g-label';
  caption.dataset.testid = 'home-standing-caption';
  // The caption carries the SEPARATE live "current form" reading when there is one to show — a bad run
  // surfaces HERE, never as a demotion of the ratcheted depth above. 'settling' means "not enough to say"
  // yet, so it falls back to a caption that depends on WHY there is nothing to say:
  //  - Calibrating (depth 0, no earned depth): point the learner at the ONE thing that moves the standing
  //    — an assessment block (both depth and form read only session.assessments). Without this the word
  //    "Calibrating" is a dead end: a casual player never learns how to leave it. The pointer is short
  //    ("Run an assessment", shorter than the "Calibrating" value above it, so it adds no width) and
  //    BANNED_PHRASINGS-clean (no rank/level/percentile word).
  //  - A real depth but a still-settling form: the neutral "Standing".
  // All form words (sharp/warming up/rusty) are also ban-clean.
  const form = standing.form;
  const showsForm = form != null && form !== 'settling';
  const calibrating = standing.depth === 0;
  caption.textContent = showsForm
    ? (form as string)
    : calibrating
      ? 'Run an assessment'
      : 'Standing';
  if (showsForm) caption.dataset.form = form as string;
  if (calibrating && !showsForm) caption.dataset.calibrating = 'true';
  block.appendChild(caption);

  return block;
}

function renderBankroll(bankroll: number): HTMLElement {
  const block = document.createElement('div');
  block.className = 'home-bankroll g-stat';

  const line = document.createElement('div');
  line.className = 'home-bankroll-line';
  const value = document.createElement('span');
  const rounded = Math.round(bankroll);
  // The figure is a balance, so it is neutral ink (colour role map: mint is never a balance). The win/
  // loss reading the headline owes (a -5000 bankroll must not read as plain white next to red rows) is
  // the delta beside it, in the same mint/coral as the hand rows below.
  const direction = rounded > DEFAULT_BANKROLL ? 'net-up' : rounded < DEFAULT_BANKROLL ? 'net-down' : 'net-flat';
  value.className = 'bankroll t-hero';
  value.dataset.testid = 'bankroll';
  value.dataset.direction = direction;
  // Plain digits, no separators: the e2e suite parses this text as a number.
  value.textContent = String(rounded);
  line.appendChild(value);

  const change = rounded - DEFAULT_BANKROLL;
  if (change !== 0) {
    const delta = document.createElement('span');
    delta.className = `bankroll-delta ${direction}`;
    delta.dataset.testid = 'bankroll-delta';
    delta.textContent = formatNet(change);
    delta.setAttribute('aria-label', `${change > 0 ? 'up' : 'down'} ${Math.abs(change)} from the start`);
    line.appendChild(delta);
  }
  block.appendChild(line);

  const label = document.createElement('div');
  label.className = 'stat-label g-label';
  label.textContent = 'Bankroll';
  block.appendChild(label);

  return block;
}

/** A launcher row: icon tile, title over a one-line caption, trailing chevron. */
export function launchRow(testid: string, icon: SVGSVGElement, title: string, meta: string, onClick: () => void): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'g-row session-card';
  row.dataset.testid = testid;
  row.addEventListener('click', onClick);

  const text = document.createElement('span');
  text.className = 'session-card-text';
  const t = document.createElement('span');
  t.className = 'session-card-title t-head';
  t.textContent = title;
  const m = document.createElement('span');
  m.className = 'session-card-meta g-caption';
  m.textContent = meta;
  text.append(t, m);

  row.append(iconTile(icon), text, chevron());
  return row;
}

export function renderNewSessionCard(onNewSession: () => void): HTMLElement {
  return launchRow('new-hand', spadeIcon(), 'New session', 'Sit down and play a hand with the coach watching', onNewSession);
}

export function renderPlayWithFriendsCard(onPlayWithFriends: () => void): HTMLElement {
  return launchRow(
    'play-with-friends',
    peopleIcon(),
    'Play with friends',
    'Host or join a table on your local network',
    onPlayWithFriends,
  );
}

function renderRecentHands(
  hands: HandRecord[],
  onOpenHand?: (handNumber: number) => void,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'home-recent';

  // A title-case section label (not the old uppercase eyebrow), on the shared 12/500 label role.
  const heading = document.createElement('div');
  heading.className = 'stat-label g-label';
  heading.textContent = 'Recent hands';
  section.appendChild(heading);

  const recent = hands.slice(-RECENT_LIMIT).reverse();
  if (recent.length === 0) {
    section.appendChild(renderEmptyState());
    return section;
  }

  const list = document.createElement('div');
  list.className = 'hand-list g-group';
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
  number.className = 'hand-number g-num';
  number.textContent = `#${hand.handNumber}`;
  row.appendChild(number);

  const cards = document.createElement('span');
  cards.className = 'hand-cards g-mini';
  for (const card of hand.hole) {
    cards.appendChild(renderCard(card, { small: true }));
  }
  row.appendChild(cards);

  const net = document.createElement('span');
  net.className = 'hand-net g-num ' + netClass(hand.net);
  net.textContent = formatNet(hand.net);
  row.appendChild(net);

  // Rows that open read as openable.
  if (onOpenHand) row.appendChild(chevron());

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

/** Signed, with the true minus sign (U+2212): it sets at the width of the plus in tabular figures. */
function formatNet(net: number): string {
  const rounded = Math.round(net);
  if (rounded === 0) return '0';
  return rounded < 0 ? `\u2212${-rounded}` : `+${rounded}`;
}
