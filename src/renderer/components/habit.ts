import type { DayKey } from '../../core/localDay.js';
import type { Ring } from '../../core/progression/ring.js';
import type { Greeting } from '../../core/progression/greeting.js';
import type { TicketState } from '../../core/progression/types.js';
import { streakNote } from '../../core/progression/streak.js';
import { ticketMinutes } from '../../core/ticket.js';
import { renderDee } from './dee.js';
import { chevron } from './glyphs.js';

/**
 * The habit loop's Home pieces (VISION §5): Dee's greeting, the streak with today's ring, and the Ticket's row.
 * The streak and the ring are white light on bone, never mint (a kept habit is not "your turn", and mint is never
 * a balance) and never amber (amber is notable and the gate timer). Copy is never loss-framed.
 */

const MS_PER_DAY = 86_400_000;
const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Dee at 32px and one line, the salutation leading. Character off: no mark and no line (Dee's own words hide). */
export function renderGreeting(greeting: Greeting): HTMLElement {
  const root = document.createElement('section');
  root.className = 'home-greeting';
  root.dataset.testid = 'home-greeting';
  root.dataset.lineId = greeting.lineId;
  root.dataset.moment = greeting.moment;
  const text = document.createElement('p');
  text.className = 'home-greeting-line';
  text.dataset.testid = 'home-greeting-line';
  const b = document.createElement('b');
  b.textContent = greeting.salutation;
  text.append(b, ` ${greeting.text}`);
  root.append(renderDee('rest', 32), text);
  return root;
}

export interface StreakView {
  readonly current: number;
  readonly best: number;
  readonly countedToday: boolean;
  readonly countedDays: readonly DayKey[];
  readonly today: DayKey;
  readonly boundaryHour: number;
}

/** The streak (number, label, the last seven days) beside today's ring (three goals). */
export function renderStreakCard(streak: StreakView, ring: Ring): HTMLElement {
  const card = document.createElement('section');
  card.className = 'habit-card';
  card.dataset.testid = 'habit-card';

  const left = document.createElement('div');
  left.className = 'habit-streak';
  left.dataset.testid = 'home-streak';
  left.dataset.current = String(streak.current);
  left.dataset.best = String(streak.best);
  const top = document.createElement('div');
  top.className = 'habit-streak-top';
  const n = document.createElement('span');
  n.className = 'habit-streak-n t-stat g-num';
  n.dataset.testid = 'home-streak-count';
  n.textContent = String(streak.current);
  const label = document.createElement('span');
  label.className = 'habit-streak-label';
  const l1 = document.createElement('span');
  l1.className = 't-head';
  l1.textContent = 'day streak';
  const l2 = document.createElement('span');
  l2.className = 'g-caption';
  l2.dataset.testid = 'home-streak-best';
  l2.textContent =
    streak.best === 0 ? 'No days yet' : streak.current > 0 && streak.current >= streak.best ? 'Your longest yet' : `Best: ${streak.best}`;
  label.append(l1, l2);
  top.append(n, label);

  const week = document.createElement('div');
  week.className = 'habit-week';
  week.dataset.testid = 'home-streak-week';
  const counted = new Set(streak.countedDays);
  for (let i = 6; i >= 0; i--) {
    const d = (streak.today - i) as DayKey;
    const cell = document.createElement('span');
    cell.className = 'habit-day';
    cell.dataset.counted = String(counted.has(d));
    if (i === 0) cell.dataset.today = 'true';
    const dot = document.createElement('span');
    dot.className = 'habit-dot';
    const letter = document.createElement('span');
    letter.className = 'habit-day-letter';
    letter.textContent = WEEKDAY[new Date(d * MS_PER_DAY + MS_PER_DAY / 2).getUTCDay()];
    cell.append(dot, letter);
    week.appendChild(cell);
  }
  left.append(top, week);

  const right = document.createElement('div');
  right.className = 'habit-ring';
  right.dataset.testid = 'home-ring';
  right.dataset.closed = String(ring.closed);
  right.setAttribute('aria-label', `Today's ring: ${ring.closed} of ${ring.goals.length} closed`);
  right.append(ringSvg(ring));
  const goals = document.createElement('ul');
  goals.className = 'habit-goals';
  for (const g of ring.goals) {
    const li = document.createElement('li');
    li.className = 'habit-goal';
    li.dataset.testid = `ring-goal-${g.id}`;
    li.dataset.done = String(g.done);
    const t = document.createElement('span');
    t.className = 'habit-goal-label';
    t.textContent = g.label;
    const d = document.createElement('span');
    d.className = 'habit-goal-detail g-caption';
    d.textContent = g.detail;
    li.append(t, d);
    goals.appendChild(li);
  }
  right.appendChild(goals);

  const note = document.createElement('p');
  note.className = 'habit-note g-caption';
  note.dataset.testid = 'home-streak-note';
  note.textContent = streakNote(streak.current, streak.countedToday, streak.boundaryHour);

  card.append(left, right, note);
  return card;
}

const SVG = 'http://www.w3.org/2000/svg';

/** Three arcs on one track, one per goal, filled when done. aria-hidden: the list beside it carries the words. */
function ringSvg(ring: Ring): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('class', 'habit-ring-svg');
  svg.setAttribute('aria-hidden', 'true');
  const r = 19;
  const c = 2 * Math.PI * r;
  const gap = 4;
  const seg = c / ring.goals.length;
  ring.goals.forEach((g, i) => {
    const arc = document.createElementNS(SVG, 'circle');
    arc.setAttribute('cx', '24');
    arc.setAttribute('cy', '24');
    arc.setAttribute('r', String(r));
    arc.setAttribute('class', g.done ? 'habit-arc habit-arc-done' : 'habit-arc');
    arc.setAttribute('stroke-dasharray', `${seg - gap} ${c - seg + gap}`);
    arc.setAttribute('stroke-dashoffset', String(-i * seg + c / 4));
    svg.appendChild(arc);
  });
  const count = document.createElementNS(SVG, 'text');
  count.setAttribute('x', '24');
  count.setAttribute('y', '28');
  count.setAttribute('text-anchor', 'middle');
  count.setAttribute('class', 'habit-ring-count');
  count.textContent = `${ring.closed}/${ring.goals.length}`;
  svg.appendChild(count);
  return svg;
}

/** The Ticket's launch row: what it holds, how long, how far along. */
export function renderTicketRow(ticket: TicketState, today: DayKey, onOpen: () => void): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'g-row session-card ticket-row';
  row.dataset.testid = 'home-ticket';
  const done = ticket.day === today ? ticket.done.length : 0;
  const finished = ticket.finishedOn === today;
  row.dataset.finished = String(finished);
  const tile = document.createElement('span');
  tile.className = 'g-icon ticket-tile g-num';
  tile.textContent = `${done}/${ticket.items.length}`;
  const text = document.createElement('span');
  text.className = 'session-card-text';
  const t = document.createElement('span');
  t.className = 'session-card-title t-head';
  t.textContent = "Today's Ticket";
  const m = document.createElement('span');
  m.className = 'session-card-meta g-caption';
  m.dataset.testid = 'home-ticket-meta';
  m.textContent = finished
    ? 'Done for today. Anything more is extra.'
    : `${ticket.items.length} items · about ${Math.round(ticketMinutes(ticket.items))} min · review, not a session`;
  text.append(t, m);
  row.append(tile, text, chevron());
  row.addEventListener('click', onOpen);
  return row;
}
