import '../styles-you-pages.css';
import type { DayKey } from '../../core/localDay.js';
import { HANDS_LINE, LEAD_LINE, STYLES, STYLE_IDS, STYLE_MIN_HANDS, pct, type StyleId, type StyleRead } from '../../core/style.js';
import { dayLabel } from '../../core/letters.js';
import { spadeIcon } from '../components/glyphs.js';

/**
 * YOU › STYLE: the learner's style as a card they would keep, and the map it comes from (demo/vision/style.html).
 * Every number is the engine's count from the hand log (core/style.ts); nothing here is written by the tutor. The four
 * styles are shown in advance, each with what would move you there. Nothing is locked: under the 20-hand gate the card
 * says how many hands are still needed.
 */

export interface StyleProps {
  readonly read: StyleRead;
  readonly name: string | null;
  /** Weeks since the first hand on file (1 = this is the first), or null with none. */
  readonly week: number | null;
  /** Unmasked regulars of the Long Orbit and the style their play reads as. */
  readonly rivals: readonly { readonly name: string; readonly style: StyleId }[];
  /** Saves the card as an image on this Mac; resolves to what happened. */
  readonly onSave: ((card: HTMLElement) => Promise<'saved' | 'cancelled' | 'failed'>) | null;
  readonly onOpenLeakFinder: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const HANDS_PCT = pct(HANDS_LINE);
const LEAD_PCT = pct(LEAD_LINE);

/** The map's x runs from 0 to twice the hands line, so the line sits in the middle; y is the lead share. */
const xOf = (share: number): number => Math.min(1, Math.max(0, share / (2 * HANDS_LINE)));
const yOf = (lead: number): number => Math.min(1, Math.max(0, lead));

function handsMove(to: StyleId): string {
  return STYLES[to].moreHands ? `play over ${HANDS_PCT}% of hands` : `play ${HANDS_PCT}% of hands or fewer`;
}
function leadMove(to: StyleId): string {
  return STYLES[to].leads ? `raise first in at least ${LEAD_PCT}% of the hands you play` : 'call more than you raise first';
}

/** What a tile says: how to get there from where you sit now, or where it sits when no style is read yet. */
export function tileHint(tile: StyleId, now: StyleId | null, start: StyleId | null, startDay: DayKey | null): string {
  if (now === null) {
    const s = STYLES[tile];
    return `${s.moreHands ? `Over ${HANDS_PCT}%` : `Up to ${HANDS_PCT}%`} of hands, ${s.leads ? `raising first in ${LEAD_PCT}% or more` : 'calling more than raising first'}.`;
  }
  if (tile === now) {
    const other = (Object.keys(STYLES) as StyleId[]).find((s) => STYLES[s].moreHands !== STYLES[now].moreHands && STYLES[s].leads === STYLES[now].leads) as StyleId;
    const lead = (Object.keys(STYLES) as StyleId[]).find((s) => STYLES[s].leads !== STYLES[now].leads && STYLES[s].moreHands === STYLES[now].moreHands) as StyleId;
    return `Moves if you ${handsMove(other)}, or ${leadMove(lead)}.`;
  }
  if (tile === start && startDay !== null) return `Where you started, the week of ${dayLabel(startDay)}.`;
  const steps: string[] = [];
  if (STYLES[tile].moreHands !== STYLES[now].moreHands) steps.push(handsMove(tile));
  if (STYLES[tile].leads !== STYLES[now].leads) steps.push(leadMove(tile));
  const text = steps.join(' and ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} to move here.`;
}

function figure(label: string, value: string, unit: string, note?: string): HTMLElement {
  const wrap = el('div', 'style-fig');
  const dd = el('dd', 'g-num', value);
  dd.appendChild(el('small', '', note ? `${unit} · ${note}` : unit));
  wrap.append(el('dt', '', label), dd);
  return wrap;
}

function renderPass(p: StyleProps): HTMLElement {
  const r = p.read;
  const pass = el('div', 'style-pass');
  pass.dataset.testid = 'style-card';
  pass.dataset.style = r.style ?? 'none';

  const top = el('div', 'style-pass-top');
  const brand = el('span', 'style-pass-brand');
  brand.append(spadeIcon(), document.createTextNode('Offsuit'));
  top.append(brand, el('span', '', p.week !== null ? `STYLE · WEEK ${p.week}` : 'STYLE'));

  const emblem = el('div', 'style-emblem');
  emblem.setAttribute('aria-hidden', 'true');
  for (const id of STYLE_IDS) {
    const q = el('span', `style-emblem-q q-${id}`);
    if (id === r.style) q.dataset.on = 'true';
    emblem.appendChild(q);
  }

  const k = el('div', 'style-pass-k', r.style ? 'You play as' : 'Your style');
  const name = el('div', 'style-pass-name', r.style ? STYLES[r.style].name : 'Not read yet');
  name.dataset.testid = 'style-name';
  const sub = el(
    'div',
    'style-pass-sub',
    r.style
      ? `${STYLES[r.style].how}${r.nearHandsLine || r.nearLeadLine ? ' Close to a line, so it can still move.' : ''}`
      : r.vpip.needed > 0
        ? `${r.vpip.needed} more ${r.vpip.needed === 1 ? 'hand' : 'hands'} before a style is named: it is read from ${STYLE_MIN_HANDS} at least.`
        : `${r.lead.needed} more ${r.lead.needed === 1 ? 'hand' : 'hands'} played before a style is named: the lead is read from ${STYLE_MIN_HANDS} played.`,
  );
  sub.dataset.testid = 'style-sub';

  const nums = el('dl', 'style-pass-nums');
  nums.dataset.testid = 'style-numbers';
  const share = (s: number | null, needed: number): [string, string | undefined] =>
    s === null ? ['—', `${STYLE_MIN_HANDS - needed} of ${STYLE_MIN_HANDS}`] : [`${pct(s)}%`, undefined];
  const [vp, vpNote] = share(r.vpip.share, r.vpip.needed);
  const [pf, pfNote] = share(r.pfr.share, r.pfr.needed);
  const af = r.aggression.factor;
  const fr = r.foldToRiverBet;
  nums.append(
    figure('Hands you play', vp, 'VPIP', vpNote),
    figure('You raise first', pf, 'PFR', pfNote),
    figure('Aggression', af === null ? '—' : af.toFixed(1), 'AF', af === null ? `${STYLE_MIN_HANDS - r.aggression.needed} of ${STYLE_MIN_HANDS}` : undefined),
    figure(
      'Fold to a river bet',
      fr.share === null ? '—' : `${pct(fr.share)}%`,
      fr.share === null ? `${fr.n} of ${STYLE_MIN_HANDS}` : r.foldToRiverBetWas !== null ? `was ${pct(r.foldToRiverBetWas)}%` : `of ${fr.n}`,
    ),
  );

  const foot = el('div', 'style-pass-foot');
  const who = el('span', '');
  who.append(el('b', '', p.name ?? 'You'), document.createTextNode(r.since !== null ? ` · since ${dayLabel(r.since)}` : ' · no hands yet'));
  foot.append(who, el('span', 'g-num', `${r.hands} ${r.hands === 1 ? 'hand' : 'hands'}`));

  pass.append(top, emblem, k, name, sub, nums, foot);
  return pass;
}

function renderMap(r: StyleRead): HTMLElement {
  const wrap = el('div', 'style-map-wrap');
  const map = el('div', 'style-map');
  map.dataset.testid = 'style-map';
  for (const id of STYLE_IDS) {
    const q = el('div', `style-q q-${id}`, STYLES[id].name);
    if (id === r.style) q.dataset.on = 'true';
    map.appendChild(q);
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const line = (x1: number, y1: number, x2: number, y2: number): void => {
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', String(x1));
    l.setAttribute('y1', String(y1));
    l.setAttribute('x2', String(x2));
    l.setAttribute('y2', String(y2));
    l.setAttribute('class', 'style-axis');
    svg.appendChild(l);
  };
  line(50, 0, 50, 100);
  line(0, 50, 100, 50);
  const points = r.trail.map((t) => [xOf(t.handsShare) * 100, (1 - yOf(t.lead)) * 100] as const);
  if (r.style !== null && r.vpip.share !== null && r.lead.share !== null) points.push([xOf(r.vpip.share) * 100, (1 - yOf(r.lead.share)) * 100]);
  if (points.length > 1) {
    const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    pl.setAttribute('points', points.map(([x, y]) => `${x},${y}`).join(' '));
    pl.setAttribute('class', 'style-trail');
    svg.appendChild(pl);
  }
  map.appendChild(svg);
  r.trail.forEach((t, i) => {
    const dot = el('span', 'style-w');
    dot.dataset.testid = 'style-trail-point';
    dot.style.left = `${xOf(t.handsShare) * 100}%`;
    dot.style.top = `${(1 - yOf(t.lead)) * 100}%`;
    dot.style.setProperty('--o', String(0.3 + (0.5 * (i + 1)) / r.trail.length));
    dot.title = `Week of ${dayLabel(t.week)}: ${pct(t.handsShare)}% of hands, ${pct(t.lead)}% raised first, ${t.hands} hands`;
    map.appendChild(dot);
  });
  if (r.style !== null && r.vpip.share !== null && r.lead.share !== null) {
    const x = xOf(r.vpip.share);
    const me = el('span', 'style-me');
    me.dataset.testid = 'style-me';
    me.style.left = `${x * 100}%`;
    me.style.top = `${(1 - yOf(r.lead.share)) * 100}%`;
    const label = el('span', `style-me-label${x > 0.6 ? ' left' : ''}`);
    label.append(el('b', '', 'You, now'), el('span', 'g-num', `${pct(r.vpip.share)}% of hands · lead ${pct(r.lead.share)}%`));
    me.appendChild(label);
    map.appendChild(me);
  }
  const yax = el('div', 'style-yax');
  yax.appendChild(el('span', '', 'Take the lead ↑'));
  const xax = el('div', 'style-xax');
  xax.append(el('span', '', 'Fewer hands'), el('b', '', 'Hands you play'), el('span', '', 'More hands'));
  wrap.append(yax, map, xax);
  return wrap;
}

export function renderStyle(p: StyleProps): HTMLElement {
  const r = p.read;
  const root = el('div', 'you-screen style-screen');
  root.dataset.testid = 'you-style';

  // The card on its stage, with the one primary action: keep it.
  const stage = el('section', 'style-stage');
  const pass = renderPass(p);
  const save = el('button', 'pill primary', 'Save card image');
  save.type = 'button';
  save.dataset.testid = 'style-save';
  const saved = el('div', 'g-caption style-saved', 'Saved to this Mac. Nothing is sent anywhere.');
  saved.dataset.testid = 'style-save-note';
  if (p.onSave === null || r.style === null) save.disabled = true;
  save.addEventListener('click', () => {
    if (!p.onSave) return;
    save.disabled = true;
    void p.onSave(pass).then((result) => {
      save.disabled = false;
      saved.textContent =
        result === 'saved' ? 'Saved to this Mac. Nothing is sent anywhere.' : result === 'cancelled' ? 'Not saved.' : 'Could not save the image.';
      saved.dataset.result = result;
    });
  });
  stage.append(pass, save, saved);

  // The map and the four styles.
  const right = el('div', 'style-right');
  const head = el('div', 'you-head');
  const ht = el('div', 'you-head-text');
  ht.append(
    el('span', 't-head', 'Where you sit'),
    el('span', 'g-caption', r.trail.length > 0 ? `${r.trail.length} ${r.trail.length === 1 ? 'week' : 'weeks'} on the trail · it keeps 8` : `A week joins the trail at ${STYLE_MIN_HANDS} hands`),
  );
  head.appendChild(ht);

  const start = r.trail.length > 0 ? r.trail[0] : null;
  const quads = el('div', 'style-quads');
  for (const id of STYLE_IDS) {
    const t = el('div', 'style-tile');
    t.dataset.testid = 'style-tile';
    t.dataset.id = id;
    if (id === r.style) t.dataset.on = 'true';
    const h = el('div', 'style-tile-h', STYLES[id].name);
    if (id === r.style) h.appendChild(el('span', 'style-you', 'You'));
    const here = p.rivals.filter((x) => x.style === id).map((x) => x.name);
    t.append(
      h,
      el('div', 'style-tile-p', STYLES[id].how),
      el('div', 'style-tile-p quiet', tileHint(id, r.style, start?.style ?? null, start?.week ?? null)),
    );
    if (here.length > 0) t.appendChild(el('div', 'style-tile-p quiet', `Also plays this way: ${here.join(', ')}`));
    quads.appendChild(t);
  }

  // What the coach marked, by kind of decision, and the Pro leak finder for hands played elsewhere.
  const coach = el('div', 'style-coach');
  coach.dataset.testid = 'style-coach';
  const label: Record<string, string> = { lead: 'Bets and raises', call: 'Calls facing a bet', fold: 'Folds facing a bet' };
  const marks = el('div', 'style-coach-rows');
  for (const g of r.grader) {
    const row = el('span', 'style-coach-row');
    row.append(el('span', 'g-caption', label[g.kind]), el('span', 'g-num', g.graded === 0 ? '—' : `${g.right} of ${g.graded} right`));
    marks.appendChild(row);
  }
  const leak = el('button', 'pill quiet', 'Leak finder');
  leak.type = 'button';
  leak.dataset.testid = 'style-leak-finder';
  leak.title = 'Hands imported from other sites, against the charts (Pro)';
  leak.addEventListener('click', p.onOpenLeakFinder);
  coach.append(marks, leak);

  right.append(head, renderMap(r), quads, coach);
  root.append(stage, right);
  return root;
}
