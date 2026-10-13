import type { Action } from '../../core/table.js';
import type { RoomView } from '../../core/multiplayer.js';
import { renderCard, renderCardRow } from './card.js';
import { seatPositions } from '../../core/seatPositions.js';

/**
 * The live room table shared by LAN multiplayer (screens/multiplayer.ts) and online play
 * (screens/online.ts): the pot, the board, one row per seat and the action controls, all from the
 * REDACTED RoomView main pushes. An opponent seat shows face-down cards because its hole is null here:
 * there is no card in the view to show. Styled by styles-multiplayer.css (the `mp-` classes).
 */
export interface RoomTableOptions {
  readonly lastError: string | null;
  readonly warnings: readonly string[];
  readonly onAction: (action: Action) => void;
  /** Deal the next hand. Absent where the server deals on its own (online): then `dealNote` shows. */
  readonly onDeal?: () => void;
  /** Shown in place of the Next hand button when there is no onDeal. */
  readonly dealNote?: string;
}

export function renderRoomTable(view: RoomView | null, options: RoomTableOptions): HTMLElement {
  const el = document.createElement('div');
  el.className = 'mp-table';
  el.dataset.testid = 'mp-table';
  if (view === null) {
    el.textContent = 'Waiting for the table…';
    return el;
  }

  if (options.lastError) {
    const err = document.createElement('div');
    err.className = 'mp-notice';
    err.dataset.testid = 'mp-error';
    err.textContent = options.lastError;
    el.appendChild(err);
  }
  // Deal warnings stay until the player leaves the table: they are the visible record of a host that
  // restarted deals after seeing the shuffle.
  for (const warning of options.warnings) {
    const w = document.createElement('div');
    w.className = 'mp-notice';
    w.dataset.testid = 'mp-warning';
    w.textContent = warning;
    el.appendChild(w);
  }

  const potLine = document.createElement('div');
  potLine.className = 'mp-pot';
  potLine.dataset.testid = 'mp-pot';
  potLine.textContent = `Pot ${view.pot}`;
  el.appendChild(potLine);

  const board = renderCardRow(view.board.length ? [...view.board] : [], { small: true });
  board.dataset.testid = 'mp-board';
  el.appendChild(board);

  const seats = document.createElement('div');
  seats.className = 'mp-seats g-group';
  // Position labels (BTN/SB/BB/UTG…) derived once from the same inputs the engine uses: the dealer
  // index and which seats were dealt in (stack + committed > 0; an empty or busted seat is 0). Pure,
  // so the labels always match where the blinds actually posted.
  const funded = view.seats.map((s) => s.stack + s.committed > 0);
  const positions = seatPositions(view.dealer, funded);
  for (const seat of view.seats) {
    seats.appendChild(seatRow(seat, view, positions[seat.id] ?? null));
  }
  el.appendChild(seats);

  el.appendChild(controls(view, options));
  return el;
}

function seatRow(seat: RoomView['seats'][number], view: RoomView, position: string | null): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mp-seat';
  row.dataset.testid = 'mp-seat';
  row.dataset.seatId = String(seat.id);
  row.dataset.you = String(seat.isYou);
  row.dataset.folded = String(seat.folded);
  if (view.toAct === seat.id && view.winners === null) row.dataset.toAct = 'true';

  const name = document.createElement('span');
  name.className = 'mp-seat-name';
  name.textContent = seat.isYou ? `${seat.name} (you)` : seat.name;
  row.appendChild(name);

  // The poker position (BTN/SB/BB/UTG…), derived in core from the dealer + who was dealt in, so it
  // cannot drift from where the blinds posted. Position is the first thing this app teaches; showing
  // it on a live table is where a learner connects the name to the seat.
  if (position !== null) {
    const pos = document.createElement('span');
    pos.className = 'mp-seat-position';
    pos.dataset.testid = 'mp-seat-position';
    pos.dataset.position = position;
    pos.textContent = position;
    row.appendChild(pos);
  }

  // A distinct dealer-button marker from the view's dealer index. Heads-up the button seat is the SB
  // (no 'BTN' position label exists then), so the button is shown as its own chip, not folded into
  // the label — a learner must see "this seat has the button" even when its position reads SB.
  if (view.dealer === seat.id) {
    const btn = document.createElement('span');
    btn.className = 'mp-seat-button';
    btn.dataset.testid = 'mp-dealer-button';
    btn.textContent = 'D';
    row.appendChild(btn);
  }

  // The redaction made visible: the player's own cards face up, everyone else face down (hole===null).
  const cards = document.createElement('span');
  cards.className = 'mp-seat-cards g-mini';
  if (seat.hole !== null) {
    for (const card of seat.hole) cards.appendChild(renderCard(card, { small: true }));
  } else if (!seat.folded) {
    cards.appendChild(renderCard(null, { faceDown: true, small: true }));
    cards.appendChild(renderCard(null, { faceDown: true, small: true }));
  }
  row.appendChild(cards);

  const stack = document.createElement('span');
  stack.className = 'mp-seat-stack';
  stack.textContent = `${seat.stack}`;
  row.appendChild(stack);
  return row;
}

function controls(view: RoomView, options: RoomTableOptions): HTMLElement {
  const el = document.createElement('div');
  el.className = 'mp-controls';
  el.dataset.testid = 'mp-controls';

  if (view.winners !== null) {
    if (options.onDeal) {
      // Hand over: only the host can deal the next one (a joined client's deal is a no-op in main).
      const onDeal = options.onDeal;
      const deal = document.createElement('button');
      deal.type = 'button';
      deal.className = 'pill primary';
      deal.dataset.testid = 'mp-deal';
      deal.textContent = 'Next hand';
      deal.addEventListener('click', () => onDeal());
      el.appendChild(deal);
    } else {
      const note = document.createElement('span');
      note.className = 'mp-deal-note';
      note.dataset.testid = 'mp-deal-note';
      note.textContent = options.dealNote ?? 'Next hand in a few seconds';
      el.appendChild(note);
    }
    return el;
  }

  for (const kind of ['fold', 'check', 'call', 'bet', 'raise'] as Action['kind'][]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pill';
    b.dataset.testid = `mp-${kind}`;
    b.textContent = kind.charAt(0).toUpperCase() + kind.slice(1);
    b.disabled = !view.yourTurn || !view.legal.includes(kind);
    b.addEventListener('click', () => options.onAction({ kind }));
    el.appendChild(b);
  }
  return el;
}
