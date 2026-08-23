import type { Card } from '../../core/cards.js';
import { rankOf, suitOf, isRed, SUIT_PIP } from '../../core/cards.js';

export interface CardRenderOpts {
  faceDown?: boolean;
  small?: boolean;
}

export function renderCard(card: Card | null, opts?: CardRenderOpts): HTMLElement {
  const faceDown = opts?.faceDown ?? false;
  const small = opts?.small ?? false;

  if (card === null || faceDown) {
    const back = document.createElement('div');
    back.className = 'card-back' + (small ? ' small' : '');
    back.dataset.testid = 'card';
    back.dataset.card = 'back';
    return back;
  }

  const el = document.createElement('div');
  const red = isRed(card);
  el.className = 'card' + (red ? ' red' : '') + (small ? ' small' : '');
  el.dataset.testid = 'card';
  el.dataset.card = card;

  const rank = document.createElement('span');
  rank.className = 'card-rank';
  rank.textContent = rankOf(card);
  el.appendChild(rank);

  const pip = document.createElement('span');
  pip.className = 'card-pip';
  pip.textContent = SUIT_PIP[suitOf(card)];
  el.appendChild(pip);

  return el;
}

export function renderCardRow(cards: (Card | null)[], opts?: CardRenderOpts): HTMLElement {
  const row = document.createElement('div');
  row.className = 'board';
  for (const card of cards) {
    row.appendChild(renderCard(card, opts));
  }
  return row;
}
