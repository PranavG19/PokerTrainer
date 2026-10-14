/**
 * PRO · ICM: a short-stack spot, first in, priced by ICM (Malmuth-Harville) and in chips, with the shove
 * chart that falls out of it. Every number comes from main (core/pro/analysis.ts, gated, in a worker);
 * this file holds the spot the learner is editing and draws the answer.
 *
 * The callers are always NAMED: the equilibrium's own calling ranges, or a fixed top-N%. The chart says
 * which, so a shove is never read as right "against anyone".
 */

import { RANKS } from '../../core/cards.js';
import { ALL_COMBOS } from '../../core/preflop.js';
import { renderCard } from '../components/card.js';
import { text } from '../components/dom.js';
import { attachThumb } from '../components/thumb.js';

export interface IcmBridge {
  proShove?: (request: unknown) => Promise<unknown>;
}

interface Preset {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly blurb: string;
  readonly stacks: readonly number[];
  readonly button: number;
  readonly hero: number;
  readonly ante: number;
  readonly payouts: readonly number[];
}

const PRESETS: readonly Preset[] = [
  {
    id: 'bubble',
    label: 'Bubble',
    title: 'Final-table bubble',
    blurb: 'Four left, three paid. Ante 1/8 of a big blind. Folded to you on the button.',
    stacks: [27, 13, 6, 14],
    button: 1,
    hero: 1,
    ante: 0.125,
    payouts: [0.5, 0.3, 0.2],
  },
  {
    id: 'three',
    label: 'Three left',
    title: 'Three left, all paid',
    blurb: 'Three left, three paid. Ante 1/8 of a big blind. You are on the button, first in.',
    stacks: [15, 10, 20],
    button: 0,
    hero: 0,
    ante: 0.125,
    payouts: [0.5, 0.3, 0.2],
  },
  {
    id: 'hu',
    label: 'Heads-up',
    title: 'Heads-up for the title',
    blurb: 'Two left, paying 65 / 35. You have the button and post the small blind.',
    stacks: [12, 18],
    button: 0,
    hero: 0,
    ante: 0,
    payouts: [0.65, 0.35],
  },
];

type CallerChoice = 'equilibrium' | 0.1 | 0.25 | 0.4;
const CALLERS: readonly { id: CallerChoice; label: string }[] = [
  { id: 'equilibrium', label: 'Equilibrium' },
  { id: 0.1, label: 'Top 10%' },
  { id: 0.25, label: 'Top 25%' },
  { id: 0.4, label: 'Top 40%' },
];

interface ShoveViewWire {
  push: number[];
  gain: number[];
  pushShare: number;
  callers: { seat: number; callShare: number; equity: number | null }[];
}
interface AnswerWire {
  seats: { seat: number; chipShare: number; icmShare: number | null; bubbleFactor: number | null; needs: number | null }[];
  icm: ShoveViewWire | null;
  chips: ShoveViewWire;
}

/** Kept across re-renders of the tab (the shell rebuilds the DOM on every navigation). */
const state = {
  preset: PRESETS[0],
  stacks: [...PRESETS[0].stacks],
  callers: 'equilibrium' as CallerChoice,
  model: 'icm' as 'icm' | 'chips',
  selected: 'K9o',
};

/** Seat names counted back from the button: BTN, SB, BB, then CO, HJ, UTG. */
function seatNames(n: number, button: number): string[] {
  const names = new Array<string>(n);
  if (n === 2) {
    names[button] = 'BTN';
    names[(button + 1) % 2] = 'BB';
    return names;
  }
  names[button] = 'BTN';
  names[(button + 1) % n] = 'SB';
  names[(button + 2) % n] = 'BB';
  const back = ['CO', 'HJ', 'UTG'];
  let k = 0;
  for (let d = n - 1; d >= 3; d--) names[(button + d) % n] = back[k++] ?? 'UTG';
  return names;
}

const pct1 = (x: number): string => `${(x * 100).toFixed(1)}%`;
const signed = (x: number, digits: number): string => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}`;

/** A representative pair of cards for a hand class, for the mini cards: AKs as A♠K♠, AKo as A♠K♦. */
function cardsOf(combo: string): [string, string] {
  const hi = combo[0];
  const lo = combo[1];
  if (hi === lo) return [`${hi}s`, `${lo}d`];
  return combo[2] === 's' ? [`${hi}s`, `${lo}s`] : [`${hi}s`, `${lo}d`];
}

const RANKS_DESC = [...RANKS].reverse();
const comboAt = (row: number, col: number): string => {
  const a = RANKS_DESC[row];
  const b = RANKS_DESC[col];
  if (row === col) return a + a;
  return row < col ? `${a}${b}s` : `${b}${a}o`;
};

export function renderProIcm(props: { bridge: IcmBridge }): HTMLElement {
  const root = document.createElement('div');
  root.className = 'pro-icm';
  root.dataset.testid = 'pro-icm';

  const side = document.createElement('div');
  side.className = 'pro-side';
  const presetSeg = document.createElement('div');
  presetSeg.className = 'g-seg g-seg-sm';
  presetSeg.setAttribute('role', 'radiogroup');
  presetSeg.setAttribute('aria-label', 'Spot');
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.testid = `pro-preset-${p.id}`;
    b.textContent = p.label;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(p.id === state.preset.id));
    b.addEventListener('click', () => {
      state.preset = p;
      state.stacks = [...p.stacks];
      for (const o of presetSeg.querySelectorAll('button')) o.setAttribute('aria-checked', String(o === b));
      paintSpot();
      void solve();
    });
    presetSeg.appendChild(b);
  }
  const title = text('h2', 't-t2 pro-title', '');
  title.dataset.testid = 'pro-icm-title';
  const blurb = text('p', 'g-sub pro-lede', '');
  const payouts = document.createElement('div');
  payouts.className = 'pro-payouts';

  const seats = document.createElement('div');
  seats.className = 'pro-seats';
  seats.dataset.testid = 'pro-seats';

  const hand = document.createElement('div');
  hand.className = 'pro-hand g-sect';
  hand.dataset.testid = 'pro-hand';

  const callerSeg = document.createElement('div');
  callerSeg.className = 'g-seg g-seg-sm';
  callerSeg.setAttribute('role', 'radiogroup');
  callerSeg.setAttribute('aria-label', 'How the players behind call');
  for (const c of CALLERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.testid = `pro-callers-${String(c.id).replace('0.', 'top')}`;
    b.textContent = c.label;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(c.id === state.callers));
    b.addEventListener('click', () => {
      state.callers = c.id;
      for (const o of callerSeg.querySelectorAll('button')) o.setAttribute('aria-checked', String(o === b));
      void solve();
    });
    callerSeg.appendChild(b);
  }
  const callerRow = document.createElement('div');
  callerRow.className = 'pro-caller-row';
  callerRow.append(text('span', 'g-label', 'Callers'), callerSeg);
  const note = text('p', 'g-sub pro-icm-note', '');
  note.dataset.testid = 'pro-icm-note';

  side.append(presetSeg, title, blurb, payouts, seats, callerRow, hand, note);

  // ── Main: the model switch, the legend and the 13x13 shove chart ──
  const main = document.createElement('div');
  main.className = 'pro-main';
  const bar = document.createElement('div');
  bar.className = 'pro-chart-bar';
  const modelSeg = document.createElement('div');
  modelSeg.className = 'g-seg';
  modelSeg.setAttribute('role', 'radiogroup');
  modelSeg.setAttribute('aria-label', 'Price the shove in');
  for (const [id, label] of [['icm', 'ICM'], ['chips', 'Chip EV']] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.testid = `pro-model-${id}`;
    b.textContent = label;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(id === state.model));
    b.addEventListener('click', () => {
      state.model = id;
      for (const o of modelSeg.querySelectorAll('button')) o.setAttribute('aria-checked', String(o === b));
      paintAnswer();
    });
    modelSeg.appendChild(b);
  }
  const legend = document.createElement('div');
  legend.className = 'pro-legend';
  legend.dataset.testid = 'pro-chart-legend';
  bar.append(modelSeg, legend);

  const grid = document.createElement('div');
  grid.className = 'pro-grid';
  grid.dataset.testid = 'pro-shove-grid';
  const cells = new Map<string, HTMLButtonElement>();
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const combo = comboAt(r, c);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'pro-cell';
      cell.dataset.testid = 'pro-cell';
      cell.dataset.combo = combo;
      cell.textContent = combo;
      cell.addEventListener('click', () => {
        state.selected = combo;
        paintAnswer();
      });
      cells.set(combo, cell);
      grid.appendChild(cell);
    }
  }
  const status = text('p', 'g-caption pro-solving', '');
  status.dataset.testid = 'pro-solving';
  status.setAttribute('role', 'status');
  main.append(bar, grid, status);
  root.append(side, main);

  let answer: AnswerWire | null = null;
  let generation = 0;

  function paintSpot(): void {
    const p = state.preset;
    title.textContent = p.title;
    blurb.textContent = p.blurb;
    payouts.replaceChildren();
    p.payouts.forEach((share, i) => payouts.appendChild(text('span', 'pro-chip g-num', `${['1st', '2nd', '3rd', '4th'][i]} ${Math.round(share * 100)}%`)));
    if (p.payouts.length < p.stacks.length) {
      payouts.appendChild(text('span', 'pro-chip g-num', `${['1st', '2nd', '3rd', '4th'][p.payouts.length]} 0%`));
      payouts.appendChild(text('span', 'g-caption', 'the bubble'));
    }
  }

  function paintSeats(): void {
    const p = state.preset;
    const names = seatNames(p.stacks.length, p.button);
    seats.replaceChildren();
    const head = document.createElement('div');
    head.className = 'pro-seat pro-seat-head g-label';
    head.append(text('span', '', 'Seat'), text('span', 'num', 'Stack, bb'), text('span', 'num', 'Chips · ICM'), text('span', 'num', 'Bubble factor'));
    seats.appendChild(head);
    // In acting order from hero: hero first, then the players behind, then those who folded before.
    const n = p.stacks.length;
    for (let d = 0; d < n; d++) {
      const i = (p.hero + d) % n;
      const row = document.createElement('div');
      row.className = 'pro-seat';
      row.dataset.testid = 'pro-seat';
      row.dataset.hero = String(i === p.hero);
      const label = document.createElement('span');
      label.className = 'pro-seat-name';
      label.append(text('span', '', names[i]), text('span', 'g-caption', i === p.hero ? 'you, to act' : isBehind(i) ? 'to act after you' : 'folded'));
      const stack = document.createElement('input');
      stack.type = 'number';
      stack.className = 'pro-stack g-num';
      stack.dataset.testid = 'pro-stack';
      stack.min = '0.5';
      stack.max = '100';
      stack.step = '0.5';
      stack.value = String(state.stacks[i]);
      stack.setAttribute('aria-label', `${names[i]} stack in big blinds`);
      stack.addEventListener('change', () => {
        const v = Number(stack.value);
        if (Number.isFinite(v) && v >= 0.5 && v <= 100) {
          state.stacks[i] = v;
          void solve();
        } else stack.value = String(state.stacks[i]);
      });
      const seat = answer?.seats[i];
      const shares = document.createElement('span');
      shares.className = 'num g-num';
      shares.textContent = seat ? `${(seat.chipShare * 100).toFixed(1)} · ${seat.icmShare === null ? '—' : pct1(seat.icmShare)}` : '…';
      const bf = document.createElement('span');
      bf.className = 'num pro-bf';
      if (seat?.bubbleFactor != null && seat.needs != null) bf.append(text('b', 'g-num', seat.bubbleFactor.toFixed(2)), text('span', 'g-caption', `needs ${Math.round(seat.needs * 100)}%`));
      else bf.textContent = '—';
      row.append(label, stack, shares, bf);
      seats.appendChild(row);
    }
  }

  function isBehind(i: number): boolean {
    const p = state.preset;
    const n = p.stacks.length;
    const sb = n === 2 ? p.button : (p.button + 1) % n;
    const bb = (sb + 1) % n;
    for (let j = (p.hero + 1) % n; ; j = (j + 1) % n) {
      if (j === i) return true;
      if (j === bb) return false;
    }
  }

  function paintAnswer(): void {
    paintSeats();
    if (answer === null) return;
    const icm = answer.icm;
    const shown = state.model === 'icm' && icm !== null ? icm : answer.chips;
    const chipOnly = state.model === 'icm' && icm !== null;
    let onlyChips = 0;
    ALL_COMBOS.forEach((combo, i) => {
      const cell = cells.get(combo)!;
      const push = shown.push[i] >= 0.5;
      const chipPush = answer!.chips.push[i] >= 0.5;
      const kind = push ? 'push' : chipOnly && chipPush ? 'chip-only' : 'fold';
      if (kind === 'chip-only') onlyChips += combo.length === 2 ? 6 : combo[2] === 's' ? 4 : 12;
      cell.dataset.kind = kind;
      cell.dataset.selected = String(combo === state.selected);
      cell.setAttribute('aria-pressed', String(combo === state.selected));
      cell.title = `${combo}: ${kind === 'push' ? 'shove' : kind === 'chip-only' ? 'shove in chip EV only' : 'fold'}`;
    });
    legend.replaceChildren();
    const sw = (kind: string, label: string): HTMLElement => {
      const s = document.createElement('span');
      const i = document.createElement('i');
      i.className = 'pro-swatch';
      i.dataset.kind = kind;
      s.append(i, label);
      return s;
    };
    legend.append(sw('push', `Shove ${pct1(shown.pushShare)}`));
    if (chipOnly) legend.append(sw('chip-only', `Chip EV only +${pct1(onlyChips / 1326)}`));
    legend.append(sw('fold', 'Fold'));

    // The selected hand: its two EVs, and what the callers do.
    const idx = ALL_COMBOS.indexOf(state.selected);
    hand.replaceChildren();
    const cards = document.createElement('div');
    cards.className = 'g-mini';
    for (const c of cardsOf(state.selected)) cards.appendChild(renderCard(c, { small: true }));
    const ev = (label: string, value: string, positive: boolean, testid: string): HTMLElement => {
      const el = document.createElement('div');
      el.className = 'g-stat';
      el.dataset.testid = testid;
      el.append(text('span', 'g-label', label), text('span', `t-t3 g-num ${positive ? 'g-pos' : 'g-neg'}`, value));
      return el;
    };
    const chipGain = answer.chips.gain[idx];
    hand.append(cards, ev('Chip EV, shove', `${signed(chipGain, 1)} bb`, chipGain >= 0, 'pro-ev-chips'));
    if (icm !== null) {
      const g = icm.gain[idx];
      hand.append(ev('ICM, shove', `${signed(g * 100, 2)}% of pool`, g >= 0, 'pro-ev-icm'));
    }

    const names = seatNames(state.preset.stacks.length, state.preset.button);
    const lines: string[] = [];
    for (const c of shown.callers) {
      const eq = c.equity === null ? '' : `, ${Math.round(c.equity * 100)}% against your shove`;
      lines.push(`${names[c.seat]} calls ${pct1(c.callShare)}${eq}`);
    }
    const who = state.callers === 'equilibrium' ? 'Callers use the equilibrium’s calling ranges' : `Every caller calls with the top ${Math.round(Number(state.callers) * 100)}% of hands`;
    let text1 = `${who}. ${lines.join('; ')}.`;
    if (icm !== null) {
      const worst = answer.seats.filter((s) => s.bubbleFactor !== null && isBehind(s.seat)).sort((a, b) => b.bubbleFactor! - a.bubbleFactor!)[0];
      if (worst) text1 += ` Against the ${names[worst.seat]} your bubble factor is ${worst.bubbleFactor!.toFixed(1)}: a call-off needs ${Math.round(worst.needs! * 100)}%, not 50%.`;
    }
    note.textContent = text1;
  }

  async function solve(): Promise<void> {
    const mine = ++generation;
    status.textContent = 'Working it out…';
    root.dataset.solving = 'true';
    const p = state.preset;
    const raw = await props.bridge
      .proShove?.({
        stacks: state.stacks,
        button: p.button,
        hero: p.hero,
        ante: p.ante,
        payouts: p.payouts,
        callers: state.callers === 'equilibrium' ? { kind: 'equilibrium' } : { kind: 'top', share: state.callers },
      })
      .catch(() => null);
    if (mine !== generation) return;
    const o = (raw ?? {}) as { answer?: AnswerWire; invalid?: boolean; superseded?: boolean };
    if (o.superseded) return; // a newer request is on its way
    root.dataset.solving = 'false';
    if (o.answer) {
      answer = o.answer;
      status.textContent = '';
    } else {
      status.textContent = o.invalid
        ? 'This spot is outside the model: you, or a player ahead of another, are already all in from the blinds. Change the stacks.'
        : 'Could not work this spot out.';
    }
    paintAnswer();
  }

  paintSpot();
  paintSeats();
  attachThumb(presetSeg);
  attachThumb(callerSeg);
  attachThumb(modelSeg);
  void solve();
  return root;
}
