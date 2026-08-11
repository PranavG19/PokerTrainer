import {
  ALL_COMBOS,
  DEFENSE_WIDTH_ORDER,
  classOf,
  defenseAction,
  defenseWidth,
  type Combo,
  type DefenseAction,
  type DefensePosition,
} from '../../core/preflop.js';
import type { Card } from '../../core/cards.js';
import { mulberry32, type Rng } from '../../core/rng.js';
import { renderCard } from '../components/card.js';

/**
 * FACING-A-RAISE DEFENSE DRILL — the second mode of the Charts screen (there is no tab budget for a
 * 14th tab, see the memory note). Given a defense spot (hero position vs a specific opener) it deals a
 * random combo and asks the learner for the GTO action — 3-bet, call, or fold — grading against
 * core/preflop.ts defenseAction. Nothing is computed here: the ranges and the verdict come from core,
 * so this file adds no poker knowledge of its own (mirrors the RFI drill's discipline).
 *
 * Sync for e2e: the root publishes data-spot / data-combo / data-answered / data-verdict every paint.
 */

/** Fixed seed so the drill sequence is identical on every launch, the same as the RFI drill (N3). */
const DRILL_SEED = 11;

/** The 6 spots in a stable teaching order: BB defends widening by opener, then the SB 3-bet-or-fold spot. */
const SPOTS: readonly DefensePosition[] = [...DEFENSE_WIDTH_ORDER, 'sb-vs-btn'];

/** Human labels for each spot — the situation, never the answer. */
const SPOT_LABEL: Record<DefensePosition, string> = {
  'bb-vs-utg': 'BB vs UTG open',
  'bb-vs-hj': 'BB vs HJ open',
  'bb-vs-co': 'BB vs CO open',
  'bb-vs-btn': 'BB vs BTN open',
  'bb-vs-sb': 'BB vs SB open',
  'sb-vs-btn': 'SB vs BTN open',
};

const ACTION_LABEL: Record<DefenseAction, string> = {
  threebet: '3-bet',
  call: 'Call',
  fold: 'Fold',
};

/** One-letter keyboard shortcut per action, shown on the button (T/C/F). */
const ACTION_KEY: Record<DefenseAction, string> = { threebet: 'T', call: 'C', fold: 'F' };

interface Feedback {
  readonly combo: Combo;
  readonly spot: DefensePosition;
  readonly correct: DefenseAction;
  readonly chose: DefenseAction;
}

export function renderDefenseDrill(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'defense-drill';
  root.dataset.testid = 'defense-drill';

  const rng = mulberry32(DRILL_SEED);
  let spot: DefensePosition = SPOTS[0];
  let combo: Combo = nextCombo(rng);
  let feedback: Feedback | null = null;
  let answered = 0;

  function selectSpot(next: DefensePosition): void {
    if (next === spot) return;
    spot = next;
    // A live combo's answer is spot-dependent, so a fresh one is drawn and the verdict dropped.
    combo = nextCombo(rng);
    feedback = null;
    paint();
  }

  function commit(chose: DefenseAction): void {
    const correct = defenseAction(combo, spot);
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
    if (key === 't') commit('threebet');
    else if (key === 'c') commit('call');
    else if (key === 'f') commit('fold');
  }
  document.addEventListener('keydown', onKey);

  function paint(): void {
    root.dataset.spot = spot;
    root.dataset.combo = combo;
    root.dataset.answered = String(answered);
    root.dataset.verdict = feedback === null ? '' : feedback.chose === feedback.correct ? 'right' : 'wrong';
    root.replaceChildren(renderSpotSelector(spot, selectSpot), renderPrompt(combo, commit), renderFeedback(feedback));
  }

  paint();
  return root;
}

function renderSpotSelector(active: DefensePosition, onSelect: (spot: DefensePosition) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'defense-spots';
  wrap.dataset.testid = 'defense-spots';

  for (const s of SPOTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pill defense-spot-btn';
    button.dataset.testid = 'defense-spot-btn';
    button.dataset.spot = s;
    button.dataset.active = String(s === active);
    button.textContent = SPOT_LABEL[s];
    button.addEventListener('click', () => onSelect(s));
    wrap.appendChild(button);
  }

  const width = document.createElement('div');
  width.className = 'defense-width stat-label';
  width.dataset.testid = 'defense-width';
  width.textContent = `${SPOT_LABEL[active]} — defend ${Math.round(defenseWidth(active) * 100)}% of hands`;
  wrap.appendChild(width);

  return wrap;
}

function renderPrompt(combo: Combo, onCommit: (action: DefenseAction) => void): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'defense-prompt';
  panel.dataset.testid = 'defense-prompt';

  const hand = document.createElement('div');
  hand.className = 'defense-hand';
  hand.dataset.testid = 'defense-hand';
  hand.dataset.combo = combo;
  // Real cards, not the "AKs" notation — reading the combo off two cards is half the skill (same as
  // the RFI drill).
  for (const card of cardsFor(combo)) hand.appendChild(renderCard(card, { small: true }));
  panel.appendChild(hand);

  const keys = document.createElement('div');
  keys.className = 'defense-keys';
  for (const action of ['threebet', 'call', 'fold'] as DefenseAction[]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pill defense-key';
    button.dataset.testid = `defense-${action}`;
    button.textContent = `${ACTION_KEY[action]} ${ACTION_LABEL[action]}`;
    button.addEventListener('click', () => onCommit(action));
    keys.appendChild(button);
  }
  panel.appendChild(keys);

  return panel;
}

/**
 * The verdict on the PREVIOUS combo (the next one is already up), told apart by weight and wording
 * rather than colour — the same restraint as the RFI drill. Silence is not praise, so a correct
 * commit gets the combo and the action, nothing more.
 */
function renderFeedback(feedback: Feedback | null): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'defense-feedback';
  wrap.dataset.testid = 'defense-feedback';

  if (feedback === null) {
    wrap.dataset.verdict = 'none';
    wrap.textContent = 'Pick 3-bet, Call or Fold (T / C / F). The answer is not shown until you commit.';
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
  line.dataset.testid = 'defense-verdict';
  line.textContent = right
    ? `${feedback.combo} ${ACTION_LABEL[feedback.correct].toLowerCase()}`
    : `${feedback.combo} is a ${ACTION_LABEL[feedback.correct].toLowerCase()}, not a ${ACTION_LABEL[feedback.chose].toLowerCase()}`;
  wrap.appendChild(line);

  const tag = document.createElement('span');
  tag.className = 'defense-tag';
  tag.dataset.testid = 'defense-tag';
  tag.dataset.class = classOf(feedback.combo);
  tag.textContent = classOf(feedback.combo);
  wrap.appendChild(tag);

  return wrap;
}

/** Two concrete cards for a combo. Suits fixed, so the same combo always looks the same (RFI parity). */
function cardsFor(combo: Combo): Card[] {
  const suited = combo.endsWith('s');
  return [`${combo[0]}s`, `${combo[1]}${suited ? 's' : 'h'}`];
}

/** A uniform random combo over all 169. Uniform is fine here: the drill is about the action, not chunking. */
function nextCombo(rng: Rng): Combo {
  return ALL_COMBOS[Math.floor(rng() * ALL_COMBOS.length)];
}
