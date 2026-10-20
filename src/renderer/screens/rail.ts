import '../styles-league.css';
import type { DayKey } from '../../core/localDay.js';
import type { Rating } from '../../core/online/ranked.js';
import { FICTIONAL_LABEL, RAIL_DAILY_REPS, RAIL_WEEK_DECISIONS, RAIL_TIERS, railBoard, type RailRow } from '../../core/progression/rail.js';
import type { RailState, RailWeek } from '../../core/progression/types.js';
import { dayLabel } from './you.js';

/**
 * YOU › GHOST RAIL (2.5, owner D18): this week's board against the learner's own past weeks and the fictional
 * pace-setters, the Deuce-to-Ace ladder, and how the last weeks settled. Every bot is labelled as fictional where it
 * is shown; no other person's number exists in the app. The number is decision quality (bb lost per 100 contested
 * decisions, the coach's own grades), never chips, and the page says that no one moves down.
 */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** bb per 100 decisions as the board prints it: whole numbers, one decimal under 10. */
export function bbFigure(x: number): string {
  return x < 10 ? x.toFixed(1) : String(Math.round(x));
}

function ratingLine(r: Rating, min = RAIL_WEEK_DECISIONS): string {
  if (r.decisions === 0) return 'No scored decisions yet this week';
  if (r.decisions < min) return `Calibrating · ${r.decisions} of ${min} decisions to be rated`;
  return `95% interval ${bbFigure(r.low)}–${bbFigure(r.high)} · ${r.decisions} decisions`;
}

const RUNG = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
/** Settled weeks listed: the board already shows the last four as ghosts. */
const PAST_WEEKS = 3;

const OUTCOME: Record<string, (w: RailWeek, to: string | null) => string> = {
  up: (_w, to) => `Moved up${to ? ` to ${to}` : ''}`,
  held: () => 'Held the tier',
  unrated: (w) => `Unrated: ${w.loss.n} of ${RAIL_WEEK_DECISIONS} decisions`,
  mixed: () => 'Graded by two grader versions: not settled',
};

export interface RailScreenOptions {
  readonly rail: RailState;
  readonly today: DayKey;
  readonly onPlay: () => void;
}

export function renderRail(opts: RailScreenOptions): HTMLElement {
  const board = railBoard(opts.rail, opts.today);
  const root = el('div', 'you-screen league league-rail');
  root.dataset.testid = 'rail-screen';
  root.dataset.tier = board.tier.id;

  // ── Left: this week, the pace, the ladder ──
  const left = el('div', 'you-col');
  const card = el('section', 'you-card league-week');
  card.dataset.testid = 'rail-week';
  const top = el('div', 'league-top');
  const title = el('div', 'league-title');
  title.append(el('span', 't-t3', 'Ghost Rail'), el('span', 'g-caption', `Week of ${dayLabel(board.week)} · settles when the week turns, Monday 4 am`));
  const tier = el('span', 'league-tier t-head', board.tier.name);
  tier.dataset.testid = 'rail-tier';
  top.append(title, tier);
  const num = el('div', 'league-figure');
  const fig = el('span', 't-stat g-num', board.current.decisions > 0 ? bbFigure(board.current.bbPer100) : '–');
  fig.dataset.testid = 'rail-number';
  num.append(fig, el('span', 'g-caption', 'bb lost per 100 decisions'));
  const band = el('div', 'g-caption', ratingLine(board.current));
  band.dataset.testid = 'rail-band';
  const pace = el('p', 'g-sub habit-flush league-pace');
  pace.dataset.testid = 'rail-pace';
  pace.textContent =
    board.toBeat === null
      ? `Ace is the top of the Rail. ${board.tier.bot.name} (${FICTIONAL_LABEL.toLowerCase()}) sets its pace: ${board.tier.bot.pace}.`
      : `To move up: a rated week whose interval’s high side is at or under ${board.toBeat}, the pace of ${board.tier.bot.name}. No one moves down.`;
  card.append(top, num, band, pace);

  const ladder = el('ol', 'league-ladder');
  ladder.dataset.testid = 'rail-ladder';
  ladder.setAttribute('aria-label', 'Rail tiers, Deuce to Ace');
  const at = RAIL_TIERS.indexOf(board.tier);
  RAIL_TIERS.forEach((t, i) => {
    // The rung shows the card's rank (2 … A); its full name is the label, so nothing is clipped at 900 px.
    const li = el('li', 'league-rung', RUNG[i]);
    li.setAttribute('aria-label', t.name);
    li.title = t.name;
    li.dataset.state = i < at ? 'passed' : i === at ? 'current' : 'ahead';
    if (i === at) li.setAttribute('aria-current', 'step');
    ladder.appendChild(li);
  });

  const play = el('button', 'pill primary league-play', 'Play a table');
  play.type = 'button';
  play.dataset.testid = 'rail-play';
  play.addEventListener('click', opts.onPlay);
  const foot = el('p', 'g-caption habit-flush', `Scored on decisions, never chips: a week is its first ${RAIL_WEEK_DECISIONS} contested decisions, the ones Depth reads, graded by the coach. Above ${RAIL_DAILY_REPS} Reps a day, play counts 0 for the Rail.`);
  left.append(card, ladder, play, foot);

  // ── Right: the board, then how the last weeks settled ──
  const right = el('div', 'you-col');
  const head = el('div', 'you-head');
  const ht = el('div', 'you-head-text');
  ht.append(el('span', 't-head', 'This week’s board'), el('span', 'g-caption', 'Your own weeks and fictional bots only'));
  head.appendChild(ht);
  const rows = el('div', 'g-sect g-flat league-board');
  rows.dataset.testid = 'rail-board';
  for (const r of board.rows) rows.appendChild(boardRow(r));

  const pastHead = el('div', 'you-head');
  const pt = el('div', 'you-head-text');
  pt.append(el('span', 't-head', 'Past weeks'), el('span', 'g-caption', 'How each one settled'));
  pastHead.appendChild(pt);
  const past = el('div', 'g-sect g-flat league-past');
  past.dataset.testid = 'rail-past';
  const settled = opts.rail.weeks.filter((w) => w.outcome !== null).slice(-PAST_WEEKS).reverse();
  if (settled.length === 0) past.appendChild(el('p', 'g-caption habit-flush league-empty', 'None settled yet. The first settles the Monday after it.'));
  for (const w of settled) {
    const promo = opts.rail.promotions.find((p) => p.week === w.week);
    const to = promo ? RAIL_TIERS.find((t) => t.id === promo.to)?.name ?? null : null;
    const row = el('div', 'league-row');
    row.dataset.outcome = w.outcome ?? '';
    const text = el('span', 'league-row-text');
    text.append(el('span', 'league-row-name', `Week of ${dayLabel(w.week)}`), el('span', 'g-caption', (OUTCOME[w.outcome ?? ''] ?? (() => 'Settled'))(w, to)));
    const r = el('span', 'league-row-num g-num', w.loss.n > 0 ? bbFigure(Math.round((1000 * w.loss.sum) / w.loss.n) / 10) : '–');
    row.append(text, r);
    past.appendChild(row);
  }
  right.append(head, rows, pastHead, past);

  const cols = el('div', 'you-cols');
  cols.append(left, right);
  root.appendChild(cols);
  return root;
}

function boardRow(r: RailRow): HTMLElement {
  const row = el('div', 'league-row');
  row.dataset.testid = 'rail-row';
  row.dataset.kind = r.kind;
  const text = el('span', 'league-row-text');
  const name = el('span', 'league-row-name', r.kind === 'ghost' && r.week !== null ? `You · week of ${dayLabel(r.week)}` : r.name);
  let sub: string;
  if (r.kind === 'bot' && r.tier) sub = `${r.tier.bot.label} · ${r.tier.name}’s pace`;
  else if (r.rating && r.rating.decisions < RAIL_WEEK_DECISIONS) sub = r.rating.decisions === 0 ? 'Nothing scored yet' : `Calibrating · ${r.rating.decisions} of ${RAIL_WEEK_DECISIONS}`;
  else sub = r.kind === 'you' ? 'This week, read on its high side' : 'A past week, read on its high side';
  const subEl = el('span', 'g-caption', sub);
  if (r.kind === 'bot') subEl.dataset.testid = 'rail-fictional';
  text.append(name, subEl);
  const num = el('span', 'league-row-num g-num', r.orderBy === null ? '–' : bbFigure(r.orderBy));
  row.append(text, num);
  return row;
}
