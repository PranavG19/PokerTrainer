import '../styles-habit.css';
import type { DayKey } from '../../core/localDay.js';
import type { TicketItemRecord, TicketState } from '../../core/progression/types.js';
import { TICKET_MAX_MINUTES, ticketMinutes } from '../../core/ticket.js';
import { SCENARIOS } from '../../core/puzzleScenarios.js';
import { drillKindLabel } from './drill.js';
import { chevron } from '../components/glyphs.js';
import { conceptLabel } from './folio.js';

/**
 * TODAY'S TICKET (D16): the day's review unit, under 30 minutes. A checklist: each item opens the surface that
 * works it (a due concept in Math, the perception drill in Speed or Sight, a spot in Spots), and ticks itself off
 * when the work is on file. Nothing here is locked or ordered: any item can be opened at any time, and leaving the
 * Ticket half done costs nothing.
 */

export interface TicketProps {
  readonly ticket: TicketState;
  readonly today: DayKey;
  /** A costliest leak is on file (the spots come from it); without one the spots are a starting mix. */
  readonly leakOnFile: boolean;
  readonly onStart: (item: TicketItemRecord) => void;
  readonly onBack: () => void;
}

export function ticketItemTitle(item: TicketItemRecord, leakOnFile = true): { title: string; meta: string } {
  if (item.kind === 'review') return { title: `${drillKindLabel(item.ref)} review`, meta: 'Due on the spacing schedule' };
  if (item.kind === 'drill') {
    return item.ref === 'board'
      ? { title: 'Sight: name the board', meta: 'Perception drill · ten boards in one visit' }
      : { title: 'Speed: spot what is off', meta: 'Perception drill · ten answers today' };
  }
  if (item.kind === 'spot') {
    const s = SCENARIOS.find((x) => x.id === item.ref);
    return { title: s?.title ?? item.ref, meta: leakOnFile ? 'A spot from your costliest leak' : 'A spot to start with: no leak on file yet' };
  }
  if (item.kind === 'teach') {
    return { title: `Teach Dee again: ${conceptLabel(item.ref)}`, meta: 'Its last contrast set found the rule wrong · rewrite it, then teach it' };
  }
  return { title: item.ref, meta: 'From a newer build' };
}

export function renderTicket(props: TicketProps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'ticket-screen';
  root.dataset.testid = 'ticket-screen';
  const t = props.ticket;
  const finished = t.finishedOn === props.today;
  root.dataset.finished = String(finished);

  const head = document.createElement('div');
  head.className = 'habit-head';
  const h = document.createElement('h1');
  h.className = 't-t2';
  h.textContent = "Today's Ticket";
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'pill quiet';
  back.dataset.testid = 'ticket-back';
  back.textContent = 'Home';
  back.addEventListener('click', props.onBack);
  head.append(h, back);

  const sub = document.createElement('p');
  sub.className = 'g-sub';
  sub.dataset.testid = 'ticket-summary';
  sub.classList.add('habit-flush');
  const minutes = Math.round(ticketMinutes(t.items));
  sub.textContent = finished
    ? 'Done for today. It counts for your streak. Anything more is extra.'
    : `What is due, one perception drill and three spots: about ${minutes} minutes, never more than ${TICKET_MAX_MINUTES}. It is review, not a session, and finishing it counts for your streak.`;

  const list = document.createElement('div');
  list.className = 'g-group ticket-items';
  list.dataset.testid = 'ticket-items';
  t.items.forEach((item, i) => {
    const done = t.done.includes(item.id);
    const { title, meta } = ticketItemTitle(item, props.leakOnFile);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'g-row session-card ticket-item';
    row.dataset.testid = 'ticket-item';
    row.dataset.kind = item.kind;
    row.dataset.ref = item.ref;
    row.dataset.done = String(done);
    const step = document.createElement('span');
    step.className = 'ticket-step g-num';
    step.textContent = done ? '✓' : String(i + 1);
    const text = document.createElement('span');
    text.className = 'session-card-text';
    const tt = document.createElement('span');
    tt.className = 'session-card-title t-head';
    tt.textContent = title;
    const mm = document.createElement('span');
    mm.className = 'session-card-meta g-caption';
    mm.textContent = done ? 'Done' : meta;
    text.append(tt, mm);
    const mins = document.createElement('span');
    mins.className = 'ticket-mins g-num';
    mins.textContent = `${Math.round(item.minutes)} min`;
    row.append(step, text, mins, chevron());
    row.addEventListener('click', () => props.onStart(item));
    list.appendChild(row);
  });

  root.append(head, sub, list);
  return root;
}
