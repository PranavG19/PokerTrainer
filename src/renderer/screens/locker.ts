import type { DayKey } from '../../core/localDay.js';
import type { CosmeticSlot, CosmeticsState } from '../../core/progression/types.js';
import { itemsFor, type CosmeticItem } from '../../core/cosmetics/catalogue.js';
import { earnStatus, equippedItem, isOwned, receiptFor, SLOT_ATTRIBUTE, type EarnContext } from '../../core/cosmetics/locker.js';
import { renderCard } from '../components/card.js';
import { renderDee } from '../components/dee.js';
import { attachThumb } from '../components/thumb.js';
import { dayLabel } from './you.js';

/**
 * YOU › LOCKER (1.7, 2.13): earn-only, paint-only cosmetics, previewed on a live-looking table before you commit.
 *
 * The left is the preview stage: three villains, a bet, the pot, a board, your plate and Dee on the rail, built from
 * the same card and Dee components the table uses. It carries every slot's attribute itself (`data-back`, `data-felt`
 * …), so its tokens shadow the document's by inheritance: hovering or selecting an item repaints the stage alone,
 * and the table keeps what is equipped until "Use this" is pressed. The right lists one slot at a time, every item
 * shown in advance with the fact that earns it and how close the learner is. Nothing is sold, nothing is random.
 */

export const SLOT_LABEL: Record<CosmeticSlot, string> = {
  cardBack: 'Card backs',
  felt: 'Table',
  chipSet: 'Chips',
  deeRim: 'Dee',
  celebration: 'Moments',
};

const SLOT_NOTE: Record<CosmeticSlot, string> = {
  cardBack: 'The back of every face-down card',
  felt: 'Tints of the lit zone',
  chipSet: 'The bet’s two tones',
  deeRim: 'Dee’s rim only',
  celebration: 'Plays when a session ends',
};

const USE_LABEL: Record<CosmeticSlot, string> = {
  cardBack: 'Use this back',
  felt: 'Use this table',
  chipSet: 'Use these chips',
  deeRim: 'Use this finish',
  celebration: 'Use this moment',
};

const SLOTS: readonly CosmeticSlot[] = ['cardBack', 'felt', 'chipSet', 'deeRim', 'celebration'];

export interface LockerOptions {
  /** The cosmetics as the next save will file them (already synced with what has been earned). */
  readonly cosmetics: CosmeticsState;
  readonly earn: EarnContext;
  readonly slot: CosmeticSlot;
  readonly onSlot: (slot: CosmeticSlot) => void;
  readonly onEquip: (itemId: string) => void;
  /**
   * Spend Chalk on a priced item (economy/chalk.ts `spendItem`); called only after the second, confirming press. False
   * when it declined (nothing to buy, or a purchase still saving), so the button comes back.
   */
  readonly onSpend: (itemId: string) => boolean;
  /** The profile cannot be saved (a newer build's file, or one changed on disk): nothing can be spent or worn. */
  readonly readOnly?: boolean;
  /** Set while the clock is behind the day Chalk was last paid: the day earning resumes. */
  readonly resumesOn?: DayKey | null;
  /** The item to show selected, if it is in this slot (the one just bought); otherwise what is worn. */
  readonly selectedId?: string;
  /** Chalk earned today, of the daily cap. */
  readonly chalkToday: { readonly earned: number; readonly cap: number };
}

const fmt = (n: number): string => n.toLocaleString('en-US');
/** A confirm press within this long of the first press is ignored (a double-click, a held key). */
const CONFIRM_DELAY_MS = 500;
/** An armed confirm lapses back to "Spend" after this long. */
const CONFIRM_TTL_MS = 8000;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Set one slot's attribute on an element (the stage, a swatch). */
function paintSlot(target: HTMLElement, item: CosmeticItem): void {
  target.setAttribute(`data-${SLOT_ATTRIBUTE[item.slot]}`, item.paint);
}

function earnedLine(item: CosmeticItem, opts: LockerOptions): string {
  const s = earnStatus(item, opts.earn);
  if (item.earn.kind === 'day-one') return s.fact;
  const r = receiptFor(opts.cosmetics, item.id);
  if (isOwned(opts.cosmetics, item)) {
    const day = r?.day ?? s.day;
    if (item.earn.kind === 'chalk') return `Yours${day !== null ? ` since ${dayLabel(day as DayKey)}` : ''}, for ${fmt(r?.chalk ?? item.earn.price)} Chalk earned by practice.`;
    return `From ${s.source}${day !== null ? `, ${dayLabel(day as DayKey)}` : ''}: ${r?.fact ?? s.fact}.`;
  }
  const p = s.progress;
  return `${s.fact}.${p ? ` ${p.value} of ${p.target} ${p.unit} so far.` : ''}`;
}

/** The preview: a table built from the real card and Dee components, in the stage's own paint. */
function renderStage(): { root: HTMLElement; moment: HTMLElement } {
  const stage = el('div', 'locker-stage');
  stage.dataset.testid = 'locker-stage';
  stage.setAttribute('aria-hidden', 'true');
  const seat = (name: string, stack: number, slot: string): HTMLElement => {
    const s = el('div', `locker-seat locker-seat-${slot}`);
    const cards = el('div', 'board');
    cards.append(renderCard(null, { faceDown: true, small: true }), renderCard(null, { faceDown: true, small: true }));
    const text = el('div', 'locker-seat-text');
    text.append(el('span', 'locker-seat-name', name), el('span', 'locker-seat-stack g-num', String(stack)));
    s.append(cards, text);
    return s;
  };
  const center = el('div', 'locker-center');
  const bet = el('div', 'locker-bet g-num', '75');
  const pot = el('div', 'locker-pot');
  pot.append(el('span', 'g-caption', 'Pot'), el('span', 'locker-pot-value g-num', '225'));
  const board = el('div', 'board locker-board');
  board.append(renderCard('4s'), renderCard('4d'), renderCard('Kd'), el('div', 'locker-slot'), el('div', 'locker-slot'));
  center.append(bet, pot, board);
  const hero = el('div', 'locker-hero');
  const heroCards = el('div', 'board');
  heroCards.append(renderCard('2d'), renderCard('Kh'));
  const heroText = el('div', 'locker-seat-text');
  heroText.append(el('span', 'locker-seat-name', 'You'), el('span', 'locker-hero-stack g-num', '4950'));
  hero.append(heroCards, heroText);
  const rail = el('div', 'locker-rail');
  rail.append(renderDee('rest', 40));
  const moment = el('div', 'locker-moment');
  moment.dataset.testid = 'locker-moment';
  moment.append(el('span', 'locker-moment-text', 'Session done'), el('span', 'locker-moment-mark'));
  stage.append(seat('Bo', 4875, 'top'), seat('Ada', 4950, 'left'), seat('Cy', 5000, 'right'), center, hero, rail, moment);
  return { root: stage, moment };
}

/** A tile's swatch: the item's own paint on a sample of what it repaints. */
function swatch(item: CosmeticItem): HTMLElement {
  const sw = el('span', `locker-swatch locker-swatch-${item.slot}`);
  sw.setAttribute('aria-hidden', 'true');
  paintSlot(sw, item);
  if (item.slot === 'cardBack') sw.appendChild(renderCard(null, { faceDown: true, small: true }));
  else if (item.slot === 'felt') sw.appendChild(el('span', 'locker-swatch-felt'));
  else if (item.slot === 'chipSet') sw.append(el('span', 'locker-chip locker-chip-a'), el('span', 'locker-chip locker-chip-b'));
  else if (item.slot === 'deeRim') sw.appendChild(renderDee('rest', 36));
  else sw.append(el('span', 'locker-moment-text', 'Done'), el('span', 'locker-moment-mark'));
  return sw;
}

export function renderLocker(opts: LockerOptions): HTMLElement {
  const root = el('div', 'you-screen locker');
  root.dataset.testid = 'you-locker';
  root.dataset.slot = opts.slot;
  const items = itemsFor(opts.slot);
  const equipped = equippedItem(opts.cosmetics, opts.slot);
  // What is worn, by id. An id a newer build wrote paints the default but is not the default: then no tile here is
  // "In use", and the default can be worn to replace it.
  const wornId = opts.cosmetics.equipped[opts.slot] ?? equipped.id;
  const isWorn = (item: CosmeticItem): boolean => item.id === wornId;
  let selected: CosmeticItem = items.find((i) => i.id === opts.selectedId) ?? equipped;

  // ── Left: the stage, then the caption and the one primary action ──
  const left = el('section', 'locker-left');
  const { root: stage, moment } = renderStage();
  for (const slot of SLOTS) paintSlot(stage, equippedItem(opts.cosmetics, slot));
  const caption = el('div', 'locker-caption');
  const capText = el('div', 'locker-cap-text');
  const capName = el('div', 't-t3', '');
  capName.dataset.testid = 'locker-name';
  const capLine = el('div', 'g-caption', '');
  capLine.dataset.testid = 'locker-receipt';
  capText.append(capName, capLine);
  const use = el('button', 'pill primary locker-use');
  use.type = 'button';
  use.dataset.testid = 'locker-equip';
  // A priced item takes two presses: "Spend 450 Chalk", then "Confirm: spend 450 Chalk". Choosing another item, or
  // leaving, cancels the first press. Chalk is never spent by a single click.
  // The confirm counts only after CONFIRM_DELAY_MS, so a double-click or a held Enter (key repeat) is one press.
  // An armed confirm also lapses after CONFIRM_TTL_MS, so a stray press minutes later never completes a purchase.
  let confirming = false;
  let confirmArmedAt = 0;
  let lapse: number | null = null;
  const disarm = (): void => {
    confirming = false;
    if (lapse !== null) window.clearTimeout(lapse);
    lapse = null;
  };
  // A held key repeats keydown, and a focused button turns each into a click: a repeat is never a press.
  use.addEventListener('keydown', (e) => {
    if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
  });
  use.addEventListener('click', () => {
    if (use.disabled || opts.readOnly) return;
    const price = selected.earn.kind === 'chalk' ? selected.earn.price : null;
    if (price !== null && !isOwned(opts.cosmetics, selected)) {
      if (!confirming) {
        confirming = true;
        confirmArmedAt = performance.now();
        lapse = window.setTimeout(() => {
          disarm();
          paintCaption();
        }, CONFIRM_TTL_MS);
        paintCaption();
        return;
      }
      if (performance.now() - confirmArmedAt < CONFIRM_DELAY_MS) return;
      disarm();
      // Off until the save lands and the screen repaints, so a second purchase never starts from a stale balance.
      use.disabled = true;
      if (!opts.onSpend(selected.id)) paintCaption();
      return;
    }
    opts.onEquip(selected.id);
  });
  caption.append(capText, use);
  left.append(stage, caption);

  /** Preview an item on the stage only. A moment replays its look over the stage, once. */
  function preview(item: CosmeticItem): void {
    paintSlot(stage, item);
    stage.dataset.previewing = String(!isWorn(item));
    if (item.slot === 'celebration') {
      moment.classList.remove('is-playing');
      void moment.offsetWidth;
      moment.classList.add('is-playing');
    }
  }

  function paintCaption(): void {
    const owned = isOwned(opts.cosmetics, selected);
    const inUse = isWorn(selected);
    capName.textContent = selected.name;
    capLine.textContent = earnedLine(selected, opts);
    if (opts.readOnly) {
      use.disabled = true;
      use.textContent = 'Read-only profile';
      return;
    }
    const price = selected.earn.kind === 'chalk' && !owned ? selected.earn.price : null;
    if (price !== null) {
      const short = price - opts.cosmetics.chalk.balance;
      use.disabled = short > 0;
      use.textContent = short > 0 ? `${fmt(short)} more Chalk to go` : confirming ? `Confirm: spend ${fmt(price)} Chalk` : `Spend ${fmt(price)} Chalk`;
      use.dataset.confirming = String(confirming);
      return;
    }
    delete use.dataset.confirming;
    use.disabled = inUse || !owned;
    use.textContent = inUse ? 'In use' : owned ? USE_LABEL[opts.slot] : 'Not earned yet';
  }

  // ── Right: the slot picker and its items ──
  const right = el('section', 'locker-right');
  const seg = el('div', 'g-seg g-seg-sm locker-slots');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Locker slots');
  for (const slot of SLOTS) {
    const b = el('button', '', SLOT_LABEL[slot]);
    b.type = 'button';
    b.dataset.testid = `locker-slot-${slot}`;
    b.setAttribute('aria-pressed', String(slot === opts.slot));
    b.addEventListener('click', () => {
      if (slot !== opts.slot) opts.onSlot(slot);
    });
    seg.appendChild(b);
  }
  attachThumb(seg);

  const earnedCount = items.filter((i) => isOwned(opts.cosmetics, i)).length;
  const head = el('div', 'you-head');
  const headText = el('div', 'you-head-text');
  const count = el('span', 'g-caption', `${earnedCount} of ${items.length} earned · ${SLOT_NOTE[opts.slot]}`);
  count.dataset.testid = 'locker-count';
  headText.append(el('span', 't-head', SLOT_LABEL[opts.slot]), count);
  head.appendChild(headText);

  const grid = el('div', `locker-grid locker-grid-${opts.slot}`);
  const tiles: HTMLButtonElement[] = [];
  for (const item of items) {
    const owned = isOwned(opts.cosmetics, item);
    const s = earnStatus(item, opts.earn);
    const tile = el('button', 'locker-item');
    tile.type = 'button';
    tile.dataset.testid = 'locker-item';
    tile.dataset.id = item.id;
    tile.dataset.owned = String(owned);
    tile.dataset.equipped = String(isWorn(item));
    tile.setAttribute('aria-pressed', String(item.id === selected.id));
    const label = el('span', 'locker-item-text');
    label.append(el('span', 'locker-item-name', item.name));
    const sub = el('span', 'g-caption locker-item-sub');
    if (isWorn(item)) sub.append(el('strong', 'locker-in-use', 'In use'), document.createTextNode(` · ${s.source}`));
    else sub.textContent = s.source;
    label.appendChild(sub);
    tile.append(swatch(item), label);
    if (!owned && s.progress) {
      const bar = el('span', 'locker-bar');
      bar.setAttribute('aria-hidden', 'true');
      bar.style.setProperty('--p', String(s.progress.value / s.progress.target));
      tile.appendChild(bar);
    }
    tile.dataset.price = item.earn.kind === 'chalk' ? String(item.earn.price) : '';
    tile.setAttribute('aria-label', `${item.name}: ${owned ? (isWorn(item) ? 'in use' : 'earned') : item.earn.kind === 'chalk' ? `${fmt(item.earn.price)} Chalk` : 'not earned yet'}. ${earnedLine(item, opts)}`);
    tile.addEventListener('mouseenter', () => preview(item));
    tile.addEventListener('focus', () => preview(item));
    tile.addEventListener('mouseleave', () => preview(selected));
    tile.addEventListener('blur', () => preview(selected));
    tile.addEventListener('click', () => {
      if (selected.id !== item.id) disarm();
      selected = item;
      for (const t of tiles) t.setAttribute('aria-pressed', String(t.dataset.id === item.id));
      preview(item);
      paintCaption();
    });
    tiles.push(tile);
    grid.appendChild(tile);
  }

  // The balance in ink, never mint (mint is never a balance), with the day's curve and the fixed prices published.
  const wallet = el('div', 'locker-chalk');
  wallet.dataset.testid = 'locker-chalk';
  const bal = el('span', 't-head g-num', `${fmt(opts.cosmetics.chalk.balance)} Chalk`);
  bal.dataset.testid = 'locker-chalk-balance';
  const today = el(
    'span',
    'g-caption g-num',
    opts.resumesOn != null
      ? `Your clock is behind the last day Chalk was paid; earning resumes on ${dayLabel(opts.resumesOn)}`
      : `${fmt(opts.chalkToday.earned)} of ${fmt(opts.chalkToday.cap)} earned today`,
  );
  today.dataset.testid = 'locker-chalk-today';
  wallet.append(bal, today);

  const foot = el(
    'p',
    'g-caption locker-foot',
    'Chalk comes from practice only: 1 per Rep to 150 a day, ½ to 300, at most 225 a day. Prices are fixed and never discounted; Chalk is never bought and never converts.',
  );
  foot.dataset.testid = 'locker-foot';
  if (opts.slot === 'celebration') foot.textContent = 'Plays once when a session ends, for at most 1.6 seconds, never over a verdict. Chalk comes from practice only and is never bought; prices are fixed.';
  right.append(seg, wallet, head, grid, foot);

  const cols = el('div', 'locker-cols');
  cols.append(left, right);
  root.appendChild(cols);
  paintCaption();
  return root;
}
