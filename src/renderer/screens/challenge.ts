/**
 * CHALLENGE CODES — Play → Challenge a friend. One screen, two halves:
 * - Play a code: type or paste one (core/challengeCode.ts reads it forgivingly and checks it), see what it
 *   is, and open it: a hand deals at a one-hand table, a Math problem opens in the drill, a puzzle opens in
 *   the puzzle library.
 * - Make a code: a fresh hand deal, a Math problem of a chosen kind, or a chosen puzzle. The code is shown as
 *   text to read out or copy, and as a QR code drawn on this machine (components/qrCode.ts).
 *
 * Nothing here touches the network or the profile: a code is the whole message. A challenge hand is a
 * practice hand, graded but not logged (main.ts `startChallengeTable`).
 *
 * Sync for e2e: the root carries data-made (the code on show) and the reader carries data-state
 * ('empty' | 'valid' | 'invalid') and data-error.
 */

import {
  CHALLENGE_ERROR_TEXT,
  decodeChallenge,
  describeChallenge,
  encodeChallenge,
  type Challenge,
} from '../../core/challengeCode.js';
import { DRILL_KINDS, type DrillKind } from '../../core/arithmetic.js';
import { SCENARIOS } from '../../core/puzzleScenarios.js';
import { renderQrCode } from '../components/qrCode.js';
import { attachThumb } from '../components/thumb.js';

/** The table this build deals: four seats, 100 big blinds (screens/table.ts SEAT_NAMES and START_STACK). */
export const CHALLENGE_TABLE_SEATS = 4;
export const CHALLENGE_DEPTH_BB = 100;

export interface ChallengeOptions {
  readonly onPlay: (challenge: Challenge) => void;
  readonly onExit: () => void;
  /** A uint32 source for new codes; crypto by default, fixed under test. */
  readonly random?: () => number;
  /** Open with this code made and on show (after "Back to challenges"). */
  readonly made?: Challenge | null;
  readonly onMade?: (challenge: Challenge) => void;
}

const DRILL_LABEL: Record<DrillKind, string> = {
  'pot-odds': 'Pot odds',
  alpha: 'Alpha',
  mdf: 'MDF',
  spr: 'SPR',
  combos: 'Combos',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function pill(label: string, testid: string, kind: '' | 'primary' | 'quiet' = ''): HTMLButtonElement {
  const b = el('button', `pill${kind ? ` ${kind}` : ''}`, label);
  b.type = 'button';
  b.dataset.testid = testid;
  return b;
}

function cryptoUint32(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

/** Whether this build can set the spot up, beyond the code being well-formed. */
export function playable(c: Challenge): string | null {
  if (c.kind === 'hand' && c.seats !== CHALLENGE_TABLE_SEATS) return `That hand is ${c.seats}-handed; this version deals ${CHALLENGE_TABLE_SEATS}-handed tables only.`;
  return null;
}

export function renderChallengeScreen(opts: ChallengeOptions): HTMLElement {
  const random = opts.random ?? cryptoUint32;
  const root = el('div', 'home-screen challenge-screen');
  root.dataset.testid = 'challenge-screen';

  // ── Play a code ──
  const col = el('div', 'home-col challenge-col');
  const h = el('h1', 't-t2 habit-flush', 'Challenge a friend');
  const sub = el('p', 'g-sub habit-flush', 'A code is one spot: the same cards, seats and question for whoever types it in. Nothing is sent anywhere.');

  const reader = el('div', 'g-group challenge-reader');
  reader.dataset.testid = 'challenge-reader';
  reader.dataset.state = 'empty';
  const label = el('label', 'g-label challenge-label', 'Play a code');
  const input = el('input', 'challenge-input g-num');
  input.type = 'text';
  input.id = 'challenge-input';
  label.htmlFor = input.id;
  input.dataset.testid = 'challenge-input';
  input.placeholder = 'OS-XXXX-XXXX-XXXX';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.maxLength = 64;
  const notice = el('p', 'g-sub challenge-notice');
  notice.dataset.testid = 'challenge-notice';
  notice.setAttribute('role', 'status');
  const play = pill('Play it', 'challenge-play', 'primary');
  play.disabled = true;
  const readRow = el('div', 'challenge-read-row');
  readRow.append(input, play);
  reader.append(label, readRow, notice);

  let decoded: Challenge | null = null;
  const readCode = (): void => {
    const text = input.value.trim();
    decoded = null;
    delete reader.dataset.error;
    if (text === '') {
      reader.dataset.state = 'empty';
      notice.textContent = 'Codes are letters and digits; case and dashes do not matter.';
    } else {
      const r = decodeChallenge(text);
      const blocked = r.ok ? playable(r.challenge) : null;
      if (r.ok && blocked === null) {
        decoded = r.challenge;
        reader.dataset.state = 'valid';
        reader.dataset.kind = r.challenge.kind;
        notice.textContent = describeChallenge(r.challenge);
      } else {
        reader.dataset.state = 'invalid';
        reader.dataset.error = r.ok ? 'unplayable' : r.error;
        notice.textContent = r.ok ? (blocked as string) : CHALLENGE_ERROR_TEXT[r.error];
      }
    }
    play.disabled = decoded === null;
  };
  input.addEventListener('input', readCode);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && decoded !== null) {
      event.preventDefault();
      // The screen it opens may listen for Enter on the window (the drill commits an answer on it): this
      // keypress was for the code, so it stops here.
      event.stopPropagation();
      opts.onPlay(decoded);
    }
  });
  play.addEventListener('click', () => {
    if (decoded !== null) opts.onPlay(decoded);
  });
  readCode();

  // ── Make a code ──
  const maker = el('div', 'challenge-maker');
  maker.dataset.testid = 'challenge-maker';
  const makeLabel = el('span', 'g-label', 'Make a code');
  const seg = el('div', 'g-seg challenge-kind');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Kind of spot');
  let kind: Challenge['kind'] = opts.made?.kind ?? 'hand';
  const kinds: [Challenge['kind'], string][] = [
    ['hand', 'A hand'],
    ['drill', 'Math'],
    ['puzzle', 'Puzzle'],
  ];
  const segButtons = kinds.map(([id, text]) => {
    const b = el('button', 'pill sm', text);
    b.type = 'button';
    b.dataset.testid = `challenge-kind-${id}`;
    b.dataset.kind = id;
    b.addEventListener('click', () => {
      kind = id;
      paintMaker();
    });
    return b;
  });
  seg.append(...segButtons);
  attachThumb(seg);

  const drillSelect = el('select', 'challenge-select');
  drillSelect.dataset.testid = 'challenge-drill-kind';
  drillSelect.setAttribute('aria-label', 'Math problem kind');
  for (const k of DRILL_KINDS) drillSelect.appendChild(Object.assign(document.createElement('option'), { value: k, textContent: DRILL_LABEL[k] }));
  const puzzleSelect = el('select', 'challenge-select');
  puzzleSelect.dataset.testid = 'challenge-puzzle';
  puzzleSelect.setAttribute('aria-label', 'Puzzle');
  for (const s of SCENARIOS) puzzleSelect.appendChild(Object.assign(document.createElement('option'), { value: s.id, textContent: s.title }));
  if (opts.made?.kind === 'drill') drillSelect.value = opts.made.drill;
  if (opts.made?.kind === 'puzzle') puzzleSelect.value = opts.made.scenarioId;

  const make = pill('New code', 'challenge-make');
  const makeRow = el('div', 'challenge-make-row');
  makeRow.append(seg, drillSelect, puzzleSelect, make);
  maker.append(makeLabel, makeRow);

  function paintMaker(): void {
    for (const b of segButtons) b.setAttribute('aria-pressed', String(b.dataset.kind === kind));
    drillSelect.hidden = kind !== 'drill';
    puzzleSelect.hidden = kind !== 'puzzle';
  }
  paintMaker();

  const back = pill('Back to Play', 'challenge-back', 'quiet');
  back.addEventListener('click', opts.onExit);

  col.append(h, sub, reader, maker, back);

  // ── The code on show ──
  const side = el('div', 'home-side challenge-side');
  const card = el('div', 'g-group challenge-card');
  card.dataset.testid = 'challenge-card';
  side.appendChild(card);

  function show(c: Challenge | null): void {
    card.replaceChildren();
    if (c === null) {
      delete root.dataset.made;
      card.dataset.state = 'none';
      card.appendChild(el('p', 'g-sub challenge-empty', 'Make a code and it shows here, with a QR code a phone can read.'));
      return;
    }
    const code = encodeChallenge(c);
    root.dataset.made = code;
    card.dataset.state = 'made';
    const what = el('p', 'g-sub challenge-what', describeChallenge(c));
    what.dataset.testid = 'challenge-made-what';
    const text = el('output', 'challenge-code g-num', code);
    text.dataset.testid = 'challenge-code';
    const qr = el('div', 'challenge-qr');
    qr.appendChild(renderQrCode(code, { label: `QR code for ${code}`, testid: 'challenge-qr' }));
    const actions = el('div', 'challenge-actions');
    const copy = pill('Copy', 'challenge-copy', 'quiet');
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(code).then(
        () => (copy.textContent = 'Copied'),
        () => (copy.textContent = 'Copy failed'),
      );
    });
    const mine = pill('Play it yourself', 'challenge-play-mine');
    mine.addEventListener('click', () => opts.onPlay(c));
    actions.append(copy, mine);
    card.append(what, qr, text, actions);
  }

  make.addEventListener('click', () => {
    let c: Challenge;
    if (kind === 'hand') {
      c = { kind: 'hand', seed: random() >>> 0, handNumber: 1, button: random() % CHALLENGE_TABLE_SEATS, seats: CHALLENGE_TABLE_SEATS, depthBb: CHALLENGE_DEPTH_BB };
    } else if (kind === 'drill') {
      c = { kind: 'drill', drill: drillSelect.value as DrillKind, index: random() % 10_000 };
    } else {
      c = { kind: 'puzzle', scenarioId: puzzleSelect.value };
    }
    show(c);
    opts.onMade?.(c);
  });
  show(opts.made ?? null);

  root.append(col, side);
  return root;
}
