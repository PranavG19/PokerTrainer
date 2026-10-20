import '../styles-you-pages.css';
import type { Card } from '../../core/cards.js';
import { readLetter, weekLabel, letterTitle, PRINCIPLE_PHRASE, type LetterRecord } from '../../core/letters.js';
import { renderCard } from '../components/card.js';
import { chevron } from '../components/glyphs.js';

/**
 * YOU › LETTERS: Dee's weekly letter (demo/vision/letter.html). The sentences are templates from Dee's letter bank,
 * filled from the week's records by the engine (core/letters.ts); this screen only lays them out. Numbers in the prose
 * are set bold, as the mock draws them; the figures beside the letter are the same stored counts.
 */

export interface LettersProps {
  /** This week so far, never stored; null before anything this week was graded. */
  readonly draft: LetterRecord | null;
  /** Filed letters, oldest first. */
  readonly filed: readonly LetterRecord[];
  readonly name: string | null;
  readonly tone: 'dry' | 'warm' | 'blunt';
  /** The career's costliest principle (where today's Ticket starts), or null. */
  readonly leakPrinciple: string | null;
  readonly milestoneName: (id: string) => string | null;
  readonly onOpenTicket: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A sentence with each number in bold. */
function prose(text: string): HTMLElement {
  const p = el('p', '');
  for (const part of text.split(/(\d+(?:\.\d+)?%?)/)) {
    if (part === '') continue;
    p.appendChild(/^\d/.test(part) ? el('b', 'g-num', part) : document.createTextNode(part));
  }
  return p;
}

const STREET: Record<string, string> = { preflop: 'preflop', flop: 'on the flop', turn: 'on the turn', river: 'on the river' };

function handOfWeek(l: LetterRecord): HTMLElement {
  const cell = el('div', 'letter-cell');
  cell.dataset.testid = 'letter-hand';
  cell.appendChild(el('div', 'g-caption', 'Hand of the week'));
  if (!l.hand) {
    cell.appendChild(el('p', 'g-sub habit-flush', 'No bet faced and answered right this week, so no hand to keep.'));
    return cell;
  }
  const h = l.hand;
  const cards = el('div', 'g-mini letter-cards');
  for (const c of h.hole) cards.appendChild(renderCard(c as Card, { small: true }));
  if (h.board.length > 0) {
    cards.appendChild(el('span', 'g-caption', 'on'));
    for (const c of h.board) cards.appendChild(renderCard(c as Card, { small: true }));
  }
  const verb = h.action === 'call' ? 'Called' : 'Folded to';
  cell.append(
    cards,
    el('div', 't-head', h.action === 'call' ? `The ${h.street} call` : `The ${h.street} fold`),
    el('div', 'g-caption g-num', `${verb} a bet of ${h.toCall} into ${h.pot} ${STREET[h.street] ?? ''} · marked right`),
  );
  return cell;
}

function spark(values: readonly number[]): SVGSVGElement | null {
  if (values.length < 2) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 32');
  svg.setAttribute('class', 'letter-spark');
  svg.setAttribute('aria-hidden', 'true');
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 96 + 2, 28 - (max === min ? 12 : ((v - min) / (max - min)) * 24)]);
  const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  pl.setAttribute('points', pts.map(([x, y]) => `${x},${y}`).join(' '));
  pl.setAttribute('class', 'ln');
  svg.appendChild(pl);
  const end = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  const [ex, ey] = pts[pts.length - 1];
  end.setAttribute('cx', String(ex));
  end.setAttribute('cy', String(ey));
  end.setAttribute('r', '2.5');
  end.setAttribute('class', 'pt');
  svg.appendChild(end);
  return svg;
}

function fig(testid: string, label: string, value: string, note: string, caption: string, extra: Element | null): HTMLElement {
  const f = el('div', 'letter-fig');
  f.dataset.testid = testid;
  const v = el('div', 'letter-fig-v g-num', value);
  if (note) v.appendChild(el('small', '', note));
  const text = el('div', 'letter-fig-text');
  text.append(el('div', 'g-caption', label), v, el('div', 'g-caption', caption));
  f.appendChild(text);
  if (extra) f.appendChild(extra);
  return f;
}

function dots(right: number, total: number): HTMLElement {
  const d = el('span', 'letter-dots');
  d.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < Math.min(total, 12); i++) d.appendChild(el('span', i < right ? 'on' : ''));
  return d;
}

export function renderLetters(p: LettersProps): HTMLElement {
  const root = el('div', 'you-screen letters-screen');
  root.dataset.testid = 'you-letters';
  const all = [...p.filed, ...(p.draft ? [p.draft] : [])];
  let selected: LetterRecord | null = all[all.length - 1] ?? null;

  const sheet = el('section', 'letter');
  const side = el('div', 'letters-side');

  function paint(): void {
    if (selected === null) {
      const empty = el('div', 'letter-empty');
      empty.dataset.testid = 'letter-empty';
      empty.append(
        el('div', 't-t3', 'No letter yet'),
        el(
          'p',
          'g-sub habit-flush',
          'Dee writes one each week from that week’s graded decisions: the hands dealt, the river bets faced, what went to the sheet, and your own rules quoted back. Play with the coach on and the first one starts this week.',
        ),
        el('p', 'g-caption', 'Every sentence is a template filled from your numbers. Nothing is generated.'),
      );
      sheet.replaceChildren(empty);
    } else {
      paintLetter(selected);
    }
    paintSide();
  }

  function paintLetter(l: LetterRecord): void {
    const isDraft = l === p.draft;
    const read = readLetter(l, p.tone);
    const head = el('div', 'letter-head');
    const title = el('span', 'g-label', `Week ${l.n} · ${weekLabel(l.week)}`);
    title.dataset.testid = 'letter-week';
    head.append(title, el('span', 'g-caption', isDraft ? 'This week so far · filed when the week ends' : 'Filed when the week ended'));
    const body = el('div', 'letter-prose');
    body.dataset.testid = 'letter-body';
    body.appendChild(el('p', 'letter-hello', `${p.name ?? 'Hello'},`));
    for (const para of read.body) body.appendChild(prose(para.join(' ')));
    const sign = el('div', 'letter-sign', '— Dee');
    body.appendChild(sign);
    if (read.ps) {
      const ps = prose(`P.S. ${read.ps}`);
      ps.className = 'letter-ps';
      ps.dataset.testid = 'letter-ps';
      body.appendChild(ps);
    }
    const foot = el('div', 'letter-foot');
    const next = el('div', 'letter-cell');
    next.dataset.testid = 'letter-next';
    next.appendChild(el('div', 'g-caption', 'Next week starts with'));
    const leak = p.leakPrinciple ? PRINCIPLE_PHRASE[p.leakPrinciple] : undefined;
    if (leak) {
      const go = el('button', 'pill', 'Open today’s Ticket');
      go.type = 'button';
      go.dataset.testid = 'letter-ticket';
      go.addEventListener('click', p.onOpenTicket);
      next.append(el('div', 't-head letter-next-t', leak.charAt(0).toUpperCase() + leak.slice(1)), go);
    } else {
      next.appendChild(el('p', 'g-sub habit-flush', 'No costly spot on file yet. The Ticket starts with what is due.'));
    }
    // Only the newest letter looks ahead: an older one's "next week" has already happened.
    if (l === all[all.length - 1]) foot.append(handOfWeek(l), next);
    else foot.append(handOfWeek(l));
    sheet.replaceChildren(head, body, foot);
    sheet.dataset.week = String(l.week);
  }

  function paintSide(): void {
    const l = selected;
    const head = el('div', 'you-head');
    const ht = el('div', 'you-head-text');
    ht.append(el('span', 't-head', 'The week in numbers'), el('span', 'g-caption', l ? `Week ${l.n}` : 'None yet'));
    head.appendChild(ht);
    const nums = el('div', 'letter-figs');
    const upto = l ? all.filter((x) => x.week <= l.week).slice(-6) : [];
    const f = l?.figures ?? {};
    nums.append(
      fig('letter-fig-graded', 'Decisions graded', String(f.graded ?? 0), ` ${f.sheet ?? 0} to the sheet`, 'From graded decisions only', spark(upto.map((x) => x.figures.graded ?? 0))),
      fig(
        'letter-fig-river',
        'River calls facing a bet',
        (f.riverCalls ?? 0) > 0 ? `${f.riverRight ?? 0} of ${f.riverCalls}` : '—',
        (f.riverCalls ?? 0) > 0 ? ' right' : '',
        (f.riverCalls ?? 0) > 0 ? 'Filled: marked right by the coach' : 'No river call this week',
        (f.riverCalls ?? 0) > 0 ? dots(f.riverRight ?? 0, f.riverCalls ?? 0) : null,
      ),
      fig(
        'letter-fig-assess',
        'Assessment block',
        typeof f.assessBb100 === 'number' ? String(f.assessBb100) : '—',
        typeof f.assessBb100 === 'number' ? ' bb/100' : '',
        typeof f.assessBb100 === 'number' ? 'Lower is better · feedback held back' : 'No block this week',
        spark(upto.map((x) => x.figures.assessBb100).filter((v): v is number => typeof v === 'number')),
      ),
    );

    const lh = el('div', 'you-head');
    const lt = el('div', 'you-head-text');
    lt.append(el('span', 't-head', 'Earlier letters'), el('span', 'g-caption', `${all.length} on file`));
    lh.appendChild(lt);
    const list = el('div', 'g-group letters-list');
    list.dataset.testid = 'letters-list';
    for (const x of [...all].reverse()) {
      const b = el('button', 'g-row letters-row');
      b.type = 'button';
      b.dataset.testid = 'letters-row';
      b.dataset.week = String(x.week);
      b.setAttribute('aria-pressed', String(x === selected));
      const text = el('span', 'session-card-text');
      text.append(el('span', 't-head', letterTitle(x, p.milestoneName)), el('span', 'g-caption', `${weekLabel(x.week)}${x === p.draft ? ' · so far' : ''}`));
      b.append(el('span', 'letters-wk g-num', `Wk ${x.n}`), text, chevron());
      b.addEventListener('click', () => {
        selected = x;
        paint();
      });
      list.appendChild(b);
    }
    if (all.length === 0) list.appendChild(el('p', 'g-caption letters-none', 'Each week’s letter is kept here once the week ends.'));
    const note = el('div', 'g-caption', 'Written from your numbers by templates, not generated.');
    side.replaceChildren(head, nums, lh, list, note);
  }

  paint();
  root.append(sheet, side);
  return root;
}
