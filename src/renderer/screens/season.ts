import '../styles-league.css';
import type { DayKey } from '../../core/localDay.js';
import type { Rating } from '../../core/online/ranked.js';
import { SEASON_WEEKS, TRACK_STEPS, type ArchivedSeason, type Comparison, type SeasonView } from '../../core/progression/season.js';
import { attachThumb } from '../components/thumb.js';
import { RAIL_DAILY_REPS } from '../../core/progression/rail.js';
import { DEFAULT_SIZE as BLOCK_HANDS } from './assessment.js';
import { bbFigure } from './rail.js';
import { dayLabel } from './you.js';

/**
 * YOU › SEASON (2.7): the season's free track, its finale (the delayed test) and the archive, one at a time on a
 * segmented control. Free track only: nothing is sold, and nothing here is locked; the finale opens to everyone in
 * the finale week. Every number on the page is the grader's (the coach's evLossBb through an assessment block) or a
 * count of Reps the ledger paid; nothing is estimated here.
 */

export type SeasonPane = 'track' | 'finale' | 'archive';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const range = (start: DayKey, end: DayKey): string => `${dayLabel(start)} – ${dayLabel(end)}`;

function blockLine(r: Rating): string {
  return `${bbFigure(r.bbPer100)} bb lost per 100 spots · 95% interval ${bbFigure(r.low)}–${bbFigure(r.high)} · ${r.decisions} spots`;
}

/** The comparison in words. A tie is called a tie: two short blocks rarely tell a small change apart. */
export function comparisonLine(c: Comparison): string {
  switch (c.kind) {
    case 'alone':
      return 'No opening block this season, so the finale stands on its own.';
    case 'graders':
      return 'The two blocks were graded by different grader versions, so they are not compared.';
    case 'tie':
      return 'The two intervals overlap, so these blocks cannot tell a change apart from noise.';
    case 'apart':
      return c.change < 0
        ? `${bbFigure(-c.change)} bb per 100 fewer lost at the finale, with the two intervals apart.`
        : `${bbFigure(c.change)} bb per 100 more lost at the finale, with the two intervals apart.`;
  }
}

export interface SeasonScreenOptions {
  readonly view: SeasonView;
  readonly archive: readonly ArchivedSeason[];
  readonly pane: SeasonPane;
  readonly onPane: (pane: SeasonPane) => void;
  /** Open an assessment block (the opening measure in the track weeks, the finale in the finale week). */
  readonly onTakeBlock: () => void;
}

export function renderSeason(opts: SeasonScreenOptions): HTMLElement {
  const v = opts.view;
  const root = el('div', 'you-screen league league-season');
  root.dataset.testid = 'season-screen';
  root.dataset.pane = opts.pane;
  root.dataset.phase = v.clock.phase;

  const bar = el('div', 'league-bar');
  const title = el('div', 'league-title');
  const name = el('span', 't-t3', `Season ${v.clock.season}`);
  name.dataset.testid = 'season-name';
  title.append(
    name,
    el('span', 'g-caption', `${range(v.clock.bounds.start, v.clock.bounds.end)} · week ${v.clock.week} of ${SEASON_WEEKS} · ${v.clock.daysLeft} ${v.clock.daysLeft === 1 ? 'day' : 'days'} left`),
  );
  const seg = el('div', 'g-seg g-seg-sm league-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Season views');
  for (const [pane, label] of [['track', 'Track'], ['finale', 'Finale'], ['archive', 'Archive']] as const) {
    const b = el('button', '', label);
    b.type = 'button';
    b.dataset.testid = `season-pane-${pane}`;
    b.setAttribute('aria-pressed', String(pane === opts.pane));
    b.addEventListener('click', () => {
      if (pane !== opts.pane) opts.onPane(pane);
    });
    seg.appendChild(b);
  }
  attachThumb(seg);
  bar.append(title, seg);
  root.appendChild(bar);

  const body = opts.pane === 'track' ? track(v) : opts.pane === 'finale' ? finale(v, opts.onTakeBlock) : archive(opts.archive);
  root.appendChild(body);
  return root;
}

function track(v: SeasonView): HTMLElement {
  const cols = el('div', 'you-cols');
  const left = el('div', 'you-col');
  const card = el('section', 'you-card league-track');
  card.dataset.testid = 'season-track';
  const reached = v.steps.filter((s) => s.reached).length;
  const fig = el('div', 'league-figure');
  const n = el('span', 't-stat g-num', String(v.reps));
  n.dataset.testid = 'season-reps';
  fig.append(n, el('span', 'g-caption', 'Reps this season'));
  const stamps = el('ol', 'league-stamps');
  stamps.setAttribute('aria-label', `Free track: ${reached} of ${TRACK_STEPS.length} stamps`);
  v.steps.forEach((s, i) => {
    const li = el('li', 'league-stamp');
    li.dataset.testid = 'season-stamp';
    li.dataset.reached = String(s.reached);
    li.append(el('span', 'league-stamp-mark', String(i + 1)), el('span', 'g-caption g-num', String(s.target)));
    stamps.appendChild(li);
  });
  const next = v.steps.find((s) => !s.reached);
  const nextLine = el('div', 'g-caption', next ? `${reached} of ${TRACK_STEPS.length} stamps · the next at ${next.target} Reps, ${next.target - v.reps} to go` : `All ${TRACK_STEPS.length} stamps: the free track is full`);
  nextLine.dataset.testid = 'season-next';
  card.append(fig, stamps, nextLine);
  left.appendChild(card);

  const right = el('div', 'you-col');
  const head = el('div', 'you-head');
  const ht = el('div', 'you-head-text');
  ht.append(el('span', 't-head', 'How a season runs'), el('span', 'g-caption', 'Seven weeks, on this Mac'));
  head.appendChild(ht);
  const rules = el('div', 'g-sect g-flat league-rules');
  for (const [k, t] of [
    ['Weeks 1–6', `The free track. Every Rep the ledger pays counts, up to ${RAIL_DAILY_REPS} a day. Nothing is sold and nothing is locked.`],
    ['Week 7', `The finale: the delayed test. A ${BLOCK_HANDS}-hand assessment block, the coach silent until the end, against the season’s first block.`],
    ['After', 'The season is archived with its track, its finale and your Ghost Rail tier, and the next one opens on Monday.'],
  ]) {
    const row = el('div', 'league-row');
    const text = el('span', 'league-row-text');
    text.append(el('span', 'league-row-name', k), el('span', 'g-caption', t));
    row.appendChild(text);
    rules.appendChild(row);
  }
  right.append(head, rules);
  cols.append(left, right);
  return cols;
}

function finale(v: SeasonView, onTake: () => void): HTMLElement {
  const cols = el('div', 'you-cols');
  const left = el('div', 'you-col');
  const card = el('section', 'you-card league-finale');
  card.dataset.testid = 'season-finale';
  card.appendChild(el('span', 't-head', 'The finale: a delayed test'));
  const open = v.clock.phase === 'finale';
  const when = el('p', 'g-sub habit-flush');
  when.dataset.testid = 'season-finale-when';
  when.textContent = open
    ? v.finale
      ? 'Taken. A later block this week is practice; the first one is the test.'
      : `Open now, for ${v.clock.daysLeft} more ${v.clock.daysLeft === 1 ? 'day' : 'days'}. One ${BLOCK_HANDS}-hand block, graded at the end.`
    : `Opens on ${dayLabel(v.clock.bounds.finale)}. Weeks apart from what was practised is the point: it tests what stayed.`;
  card.appendChild(when);
  const fin = el('div', 'league-figure');
  const fn = el('span', 't-stat g-num', v.finale ? bbFigure(v.finale.bbPer100) : '–');
  fn.dataset.testid = 'season-finale-number';
  fin.append(fn, el('span', 'g-caption', 'bb lost per 100 spots at the finale'));
  card.appendChild(fin);
  if (v.finale) card.appendChild(el('div', 'g-caption', blockLine(v.finale)));
  if (v.comparison) {
    const c = el('p', 'g-sub habit-flush');
    c.dataset.testid = 'season-comparison';
    c.textContent = comparisonLine(v.comparison);
    card.appendChild(c);
  }
  // The one primary action: the block this phase is waiting on (the opening measure, or the finale).
  const wanted = open ? v.finale === null : v.baseline === null;
  if (wanted) {
    const b = el('button', 'pill primary', open ? 'Take the finale' : 'Take the opening block');
    b.type = 'button';
    b.dataset.testid = 'season-take';
    b.addEventListener('click', onTake);
    card.appendChild(b);
  }
  left.appendChild(card);

  const right = el('div', 'you-col');
  const head = el('div', 'you-head');
  const ht = el('div', 'you-head-text');
  ht.append(el('span', 't-head', 'The opening measure'), el('span', 'g-caption', 'The season’s first block, weeks 1–6'));
  head.appendChild(ht);
  const base = el('div', 'g-sect g-flat league-rules');
  base.dataset.testid = 'season-baseline';
  const row = el('div', 'league-row');
  const text = el('span', 'league-row-text');
  text.append(
    el('span', 'league-row-name', v.baseline ? `${bbFigure(v.baseline.bbPer100)} bb per 100 spots` : 'None taken this season'),
    el('span', 'g-caption', v.baseline ? blockLine(v.baseline) : open ? 'The finale then stands on its own.' : 'Any block in weeks 1–6 sets it; the first one counts.'),
  );
  row.appendChild(text);
  base.appendChild(row);
  const note = el('p', 'g-caption habit-flush', `Both are the coach’s own grades (grader v${v.grader}). Two blocks graded by different versions are shown, never compared.`);
  right.append(head, base, note);
  cols.append(left, right);
  return cols;
}

function archive(seasons: readonly ArchivedSeason[]): HTMLElement {
  const wrap = el('div', 'league-archive');
  wrap.dataset.testid = 'season-archive';
  if (seasons.length === 0) {
    wrap.appendChild(el('p', 'g-sub habit-flush league-empty', 'No season has closed yet. Each one is archived the day after its finale week, and kept for good.'));
    return wrap;
  }
  const list = el('div', 'g-sect g-flat');
  for (const s of seasons) {
    const row = el('div', 'league-row');
    row.dataset.testid = 'season-archived';
    row.dataset.season = String(s.season);
    const text = el('span', 'league-row-text');
    const facts = [
      `${s.stamps} of ${TRACK_STEPS.length} stamps`,
      `${s.reps} Reps`,
      s.finale ? `finale ${bbFigure(s.finale.bbPer100)}${s.baseline ? ` (opening ${bbFigure(s.baseline.bbPer100)})` : ''} bb per 100` : 'no finale taken',
      `Ghost Rail ${s.tier.name}`,
      `${s.seals} ${s.seals === 1 ? 'Seal' : 'Seals'}`,
    ];
    text.append(el('span', 'league-row-name', `Season ${s.season} · ${range(s.bounds.start, s.bounds.end)}`), el('span', 'g-caption', facts.join(' · ')));
    row.appendChild(text);
    if (s.comparison) row.appendChild(el('span', 'g-caption league-row-note', comparisonLine(s.comparison)));
    list.appendChild(row);
  }
  wrap.appendChild(list);
  return wrap;
}
