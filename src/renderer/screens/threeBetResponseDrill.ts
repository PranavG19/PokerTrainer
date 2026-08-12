import {
  ALL_COMBOS,
  THREEBET_RESPONSE_WIDTH_ORDER,
  classOf,
  threeBetResponseAction,
  threeBetResponseWidth,
  type Combo,
  type DefenseAction,
  type ThreeBetResponsePosition,
} from '../../core/preflop.js';
import type { Card } from '../../core/cards.js';
import { mulberry32, type Rng } from '../../core/rng.js';
import { renderCard } from '../components/card.js';

/**
 * FACING-A-3-BET RESPONSE DRILL — the third mode of the Charts screen (no tab budget for a 14th tab).
 * The learner OPENED from a position and now faces a 3-bet; the drill deals a random combo and asks for
 * the GTO response — 4-bet / call / fold — grading against core/preflop.ts threeBetResponseAction. Like
 * the defense drill, nothing is computed here: the ranges and the verdict come from core, so this file
 * adds no poker knowledge of its own. The 'threebet' action is the opener's 4-bet in this spot, so it
 * is LABELLED "4-bet" throughout while reusing the shared DefenseAction type.
 *
 * Sync for e2e: the root publishes data-spot / data-combo / data-answered / data-verdict every paint.
 */

/** Fixed seed so the drill sequence is identical on every launch, matching the RFI and defense drills. */
const DRILL_SEED = 13;

/** The four opener positions in continue-width order (UTG tightest → BTN widest). */
const SPOTS: readonly ThreeBetResponsePosition[] = [...THREEBET_RESPONSE_WIDTH_ORDER];

/** Human labels for each spot — the situation (which seat you opened from), never the answer. */
const SPOT_LABEL: Record<ThreeBetResponsePosition, string> = {
  UTG: 'You opened UTG',
  HJ: 'You opened HJ',
  CO: 'You opened CO',
  BTN: 'You opened BTN',
};

/** 'threebet' reads as the opener's 4-bet in this spot. */
const ACTION_LABEL: Record<DefenseAction, string> = {
  threebet: '4-bet',
  call: 'Call',
  fold: 'Fold',
};

/** One-letter keyboard shortcut per action, shown on the button (R for 4-bet/Raise, C, F). */
const ACTION_KEY: Record<DefenseAction, string> = { threebet: 'R', call: 'C', fold: 'F' };

interface Feedback {
  readonly combo: Combo;
  readonly spot: ThreeBetResponsePosition;
  readonly correct: DefenseAction;
  readonly chose: DefenseAction;
}

export function renderThreeBetResponseDrill(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'defense-drill threebet-drill';
  root.dataset.testid = 'threebet-drill';

  // The verdict updates in place on commit, so a screen-reader user gets no feedback without a live
  // region. This always-present polite region carries the verdict wording, kept as the root's first
  // child so it survives paint()'s replaceChildren. Visually hidden and absolute-positioned, so it
  // takes no layout space. (This drill mounts inside the Charts screen, which has its own separate
  // announcer for the RFI mode; two distinct polite regions do not collide.)
  const verdictAnnouncer = document.createElement('div');
  verdictAnnouncer.className = 'visually-hidden';
  verdictAnnouncer.dataset.testid = 'threebet-announcer';
  verdictAnnouncer.setAttribute('role', 'status');
  verdictAnnouncer.setAttribute('aria-live', 'polite');
  root.appendChild(verdictAnnouncer);

  const rng = mulberry32(DRILL_SEED);
  let spot: ThreeBetResponsePosition = SPOTS[0];
  let combo: Combo = nextCombo(rng);
  let feedback: Feedback | null = null;
  let answered = 0;

  function selectSpot(next: ThreeBetResponsePosition): void {
    if (next === spot) return;
    spot = next;
    // A live combo's answer is spot-dependent, so a fresh one is drawn and the verdict dropped.
    combo = nextCombo(rng);
    feedback = null;
    paint();
  }

  function commit(chose: DefenseAction): void {
    const correct = threeBetResponseAction(combo, spot);
    feedback = { combo, spot, correct, chose };
    answered += 1;
    combo = nextCombo(rng);
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
    if (key === 'r') commit('threebet');
    else if (key === 'c') commit('call');
    else if (key === 'f') commit('fold');
  }
  document.addEventListener('keydown', onKey);

  function paint(): void {
    root.dataset.spot = spot;
    root.dataset.combo = combo;
    root.dataset.answered = String(answered);
    root.dataset.verdict = feedback === null ? '' : feedback.chose === feedback.correct ? 'right' : 'wrong';
    // Mirror the verdict into the live region — same wording as renderFeedback — so spoken and visual
    // feedback can never disagree. Empty until the first commit.
    verdictAnnouncer.textContent = feedback === null ? '' : verdictAnnouncement(feedback);
    root.replaceChildren(
      verdictAnnouncer,
      renderSpotSelector(spot, selectSpot),
      renderPrompt(combo, commit),
      renderFeedback(feedback),
    );
  }

  paint();
  return root;
}

function renderSpotSelector(
  active: ThreeBetResponsePosition,
  onSelect: (spot: ThreeBetResponsePosition) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'defense-spots';
  wrap.dataset.testid = 'threebet-spots';

  for (const s of SPOTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pill defense-spot-btn';
    button.dataset.testid = 'threebet-spot-btn';
    button.dataset.spot = s;
    button.dataset.active = String(s === active);
    button.textContent = SPOT_LABEL[s];
    button.addEventListener('click', () => onSelect(s));
    wrap.appendChild(button);
  }

  const width = document.createElement('div');
  width.className = 'defense-width stat-label';
  width.dataset.testid = 'threebet-width';
  width.textContent = `${SPOT_LABEL[active]} — continue ${Math.round(threeBetResponseWidth(active) * 100)}% vs a 3-bet`;
  wrap.appendChild(width);

  return wrap;
}

function renderPrompt(combo: Combo, onCommit: (action: DefenseAction) => void): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'defense-prompt';
  panel.dataset.testid = 'threebet-prompt';

  const hand = document.createElement('div');
  hand.className = 'defense-hand';
  hand.dataset.testid = 'threebet-hand';
  hand.dataset.combo = combo;
  // Real cards, not the "AKs" notation — reading the combo off two cards is half the skill.
  for (const card of cardsFor(combo)) hand.appendChild(renderCard(card, { small: true }));
  panel.appendChild(hand);

  const keys = document.createElement('div');
  keys.className = 'defense-keys';
  for (const action of ['threebet', 'call', 'fold'] as DefenseAction[]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pill defense-key';
    button.dataset.testid = `threebet-${action}`;
    button.textContent = `${ACTION_KEY[action]} ${ACTION_LABEL[action]}`;
    button.addEventListener('click', () => onCommit(action));
    keys.appendChild(button);
  }
  panel.appendChild(keys);

  return panel;
}

/**
 * The verdict on the PREVIOUS combo (the next one is already up), told apart by weight and wording
 * rather than colour — the same restraint as the RFI and defense drills. Silence is not praise, so a
 * correct commit gets the combo and the action, nothing more.
 */
/**
 * The verdict as one spoken line for the screen-reader live region, mirroring renderFeedback's
 * wording: the "last" label, the same right/wrong sentence, and the hand class. Same strings as the
 * DOM feedback so the two cannot drift.
 */
function verdictAnnouncement(feedback: Feedback): string {
  const right = feedback.chose === feedback.correct;
  const line = right
    ? `${feedback.combo} ${ACTION_LABEL[feedback.correct].toLowerCase()}`
    : `${feedback.combo} is a ${ACTION_LABEL[feedback.correct].toLowerCase()}, not a ${ACTION_LABEL[feedback.chose].toLowerCase()}`;
  return `last ${line} ${classOf(feedback.combo)}`;
}

function renderFeedback(feedback: Feedback | null): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'defense-feedback';
  wrap.dataset.testid = 'threebet-feedback';

  if (feedback === null) {
    wrap.dataset.verdict = 'none';
    wrap.textContent = 'Pick 4-bet, Call or Fold (R / C / F). The answer is not shown until you commit.';
    return wrap;
  }

  const right = feedback.chose === feedback.correct;
  wrap.dataset.verdict = right ? 'right' : 'wrong';
  wrap.dataset.combo = feedback.combo;

  const when = document.createElement('span');
  when.className = 'defense-when';
  when.textContent = 'last';
  wrap.appendChild(when);

  const line = document.createElement('span');
  line.className = 'defense-verdict';
  line.dataset.testid = 'threebet-verdict';
  line.textContent = right
    ? `${feedback.combo} ${ACTION_LABEL[feedback.correct].toLowerCase()}`
    : `${feedback.combo} is a ${ACTION_LABEL[feedback.correct].toLowerCase()}, not a ${ACTION_LABEL[feedback.chose].toLowerCase()}`;
  wrap.appendChild(line);

  const tag = document.createElement('span');
  tag.className = 'defense-tag';
  tag.dataset.testid = 'threebet-tag';
  tag.dataset.class = classOf(feedback.combo);
  tag.textContent = classOf(feedback.combo);
  wrap.appendChild(tag);

  return wrap;
}

/** Two concrete cards for a combo. Suits fixed, so the same combo always looks the same. */
function cardsFor(combo: Combo): Card[] {
  const suited = combo.endsWith('s');
  return [`${combo[0]}s`, `${combo[1]}${suited ? 's' : 'h'}`];
}

/** A uniform random combo over all 169. Uniform is fine: the drill is about the action, not chunking. */
function nextCombo(rng: Rng): Combo {
  return ALL_COMBOS[Math.floor(rng() * ALL_COMBOS.length)];
}
