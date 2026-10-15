import '../styles-habit.css';
import type { DayKey } from '../../core/localDay.js';
import type { Personalization } from '../../core/progression/types.js';
import type { FolioCard } from '../../core/folio.js';
import type { MilestoneView, MilestoneFamily } from '../../core/progression/milestones.js';
import type { WeekPoint } from '../../core/progression/decisions.js';
import { chevron } from '../components/glyphs.js';
import { conceptLabel } from './folio.js';

/**
 * YOU (1.13): Profile and the Trophy room, plus the honest placeholders the owner's sub-nav names.
 *
 * Profile shows DECISIONS, NEVER RESULTS: who the learner said they are, their rules in their own words, the
 * assessment block's EV loss by week, how often Sure was right, and what they have built (concepts, depth, the
 * streak). There is no bankroll, no chip count, no won or lost and no percentile on the page; e2e asserts it. The
 * session record with its bankroll graph lives under Hands.
 *
 * The Trophy room is fixed and shown in advance: every milestone, earned or not, with the fact it records and how
 * close the learner is. Nothing random, nothing bought.
 */

const MS_PER_DAY = 86_400_000;

export function dayLabel(day: DayKey): string {
  return new Date(day * MS_PER_DAY + MS_PER_DAY / 2).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const FORMAT: Record<string, string> = { home: 'Home game', online: 'Online', live: 'Live casino', learning: 'Just learning' };
const STAKES: Record<string, string> = { 'play-money': 'Free', low: '$1/$2', mid: '$2/$5', high: '$5/$10+' };
const EXPERIENCE: Record<string, string> = { new: 'New', 'years-unstudied': 'A few years, never studied', studied: 'Studies the game' };
const GOAL: Record<string, string> = {
  'home-game': 'Win my home game',
  'understand-losses': 'Understand why I lose',
  'move-up': 'Move up stakes',
  puzzle: 'The puzzle',
};
const WHY: Record<string, string> = { friends: 'the friends', puzzle: 'the puzzle', competition: 'the competition', unwind: 'to unwind' };
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface ProfileFacts {
  readonly personalization: Personalization;
  /** The first local day with any graded activity, or null. */
  readonly since: DayKey | null;
  readonly handsPlayed: number;
  readonly gradedDecisions: number;
  readonly cards: readonly FolioCard[];
  readonly weeks: readonly WeekPoint[];
  readonly sureRight: number | null;
  readonly sureTotal: number;
  readonly conceptsMastered: number;
  readonly conceptsTotal: number;
  readonly depthLabel: string;
  readonly streak: { readonly current: number; readonly best: number };
  readonly repsTotal: number;
}

export function renderYouProfile(f: ProfileFacts, on: { onEdit: () => void; onOpenFolio: () => void; onOpenProgress: () => void; onOpenTrophies: () => void }): HTMLElement {
  const root = el('div', 'you-screen you-profile');
  root.dataset.testid = 'you-profile';
  const p = f.personalization;

  // Who: the name the learner chose (or none), the goal, the record in decisions.
  const who = el('section', 'you-who');
  const name = el('div', 'you-name t-t2', p.displayName ?? 'You');
  name.dataset.testid = 'you-name';
  const goal = el('div', 'g-sub habit-flush');
  goal.textContent = p.goals.length > 0 ? `Playing for “${GOAL[p.goals[0]] ?? p.goals[0]}”${p.goals[1] ? ` · also “${GOAL[p.goals[1]] ?? p.goals[1]}”` : ''}` : 'No goal on file yet';
  const record = el('div', 'g-caption');
  record.dataset.testid = 'you-record';
  record.textContent = [
    f.since !== null ? `Since ${dayLabel(f.since)}` : 'Nothing played yet',
    `${f.handsPlayed} ${f.handsPlayed === 1 ? 'hand' : 'hands'}`,
    `${f.gradedDecisions} graded ${f.gradedDecisions === 1 ? 'decision' : 'decisions'}`,
    `${f.repsTotal} Reps`,
  ].join(' · ');
  who.append(name, goal, record);

  const cols = el('div', 'you-cols');
  const left = el('div', 'you-col');
  const right = el('div', 'you-col');
  cols.append(left, right);

  // Your game: the onboarding answers, each editable.
  const game = el('div', 'g-group you-game');
  game.dataset.testid = 'you-game';
  const sched = p.schedule;
  const rows: [string, string][] = [
    ['Where you play', p.format ? FORMAT[p.format] ?? p.format : 'Not said'],
    ['Stakes', p.stakes ? STAKES[p.stakes] ?? p.stakes : 'Not said'],
    ['Schedule', sched ? `${sched.days.length > 0 ? sched.days.map((d) => DAY_NAMES[d]).join(', ') : 'Any day'}${sched.sessionMinutes ? `, ${sched.sessionMinutes} minutes` : ''}` : 'Not said'],
    ['Why you play', [p.why.map((w) => WHY[w] ?? w).join(' and '), p.experience ? EXPERIENCE[p.experience] ?? p.experience : ''].filter(Boolean).join(' · ') || 'Not said'],
  ];
  for (const [k, v] of rows) {
    const row = el('button', 'g-row you-row');
    row.type = 'button';
    row.append(el('span', 'you-row-k g-caption', k), el('span', 'you-row-v', v), el('span', 'g-caption', 'Edit'), chevron());
    row.addEventListener('click', on.onEdit);
    game.appendChild(row);
  }
  left.append(sectionHead('Your game', 'From onboarding · change anything'), game);

  // Rules in your words: the three newest Folio cards.
  const rules = el('div', 'g-sect g-flat you-rules');
  rules.dataset.testid = 'you-rules';
  const newest = [...f.cards].sort((a, b) => b.writtenOn - a.writtenOn).slice(0, 3);
  if (newest.length === 0) rules.appendChild(el('p', 'g-sub habit-flush you-empty', 'No rules yet. A lesson ends by asking for one in your own words.'));
  for (const c of newest) {
    const r = el('div', 'you-rule');
    r.append(el('span', 'you-rule-text', `“${c.text}”`), el('span', 'g-caption', `${conceptLabel(c.conceptId)} · ${dayLabel(c.writtenOn)}`));
    rules.appendChild(r);
  }
  const all = el('button', 'pill quiet', f.cards.length > 0 ? `See all ${f.cards.length}` : 'Open the Rulebook');
  all.type = 'button';
  all.dataset.testid = 'you-open-folio';
  all.addEventListener('click', on.onOpenFolio);
  left.append(sectionHead('Rules in your words', `${Math.min(3, f.cards.length)} of ${f.cards.length}`, all), rules);

  // Decisions, not results.
  const dec = el('section', 'you-card you-decisions');
  dec.dataset.testid = 'you-decisions';
  dec.appendChild(el('div', 't-head', 'Assessment EV loss by week'));
  if (f.weeks.length === 0) {
    dec.appendChild(el('p', 'g-sub habit-flush', 'No assessment block yet. One block of thirty spots, feedback held to the end, starts the line.'));
  } else {
    const first = f.weeks[0];
    const last = f.weeks[f.weeks.length - 1];
    const line = el('div', 'you-trend');
    line.dataset.testid = 'you-trend';
    line.append(
      el('span', 't-stat g-num', f.weeks.length > 1 ? `${first.bbPer100} → ${last.bbPer100}` : String(last.bbPer100)),
      el('span', 'g-caption', ' bb per 100 decisions · lower is better'),
    );
    dec.append(line, weekBars(f.weeks));
  }
  const sure = el('div', 'you-sure');
  sure.dataset.testid = 'you-sure';
  sure.append(
    el('span', 't-head g-num', f.sureRight === null ? '—' : `${f.sureRight}%`),
    el('span', 'g-caption', f.sureRight === null ? ' of Sure calls right: no Sure call tested yet' : ` of ${f.sureTotal} Sure calls right · the mark is 85%`),
  );
  dec.appendChild(sure);
  const prog = el('button', 'pill quiet', 'Progress in full');
  prog.type = 'button';
  prog.dataset.testid = 'tab-progress';
  prog.addEventListener('click', on.onOpenProgress);
  dec.appendChild(prog);
  right.append(sectionHead('Decisions, not results', 'From graded decisions only'), dec);

  // What you've built: concepts, depth, habit.
  const built = el('div', 'you-built');
  built.dataset.testid = 'you-built';
  built.append(
    stat(`${f.conceptsMastered}`, `of ${f.conceptsTotal} concepts mastered`),
    stat(f.depthLabel, 'certified depth'),
    stat(`${f.streak.current}`, f.streak.best === 0 ? 'day streak · none yet' : f.streak.best > f.streak.current ? `day streak · best ${f.streak.best}` : 'day streak, your longest'),
  );
  const trophies = el('button', 'pill quiet', 'Trophy room');
  trophies.type = 'button';
  trophies.addEventListener('click', on.onOpenTrophies);
  right.append(sectionHead('What you have built', 'Concepts, depth, habit', trophies), built);

  root.append(who, cols);
  return root;
}

function sectionHead(title: string, note: string, action?: HTMLElement): HTMLElement {
  const h = el('div', 'you-head');
  const t = el('div', 'you-head-text');
  t.append(el('span', 't-head', title), el('span', 'g-caption', note));
  h.appendChild(t);
  if (action) h.appendChild(action);
  return h;
}

function stat(value: string, label: string): HTMLElement {
  const s = el('div', 'you-stat g-stat');
  s.append(el('span', 't-t3 g-num', value), el('span', 'g-caption', label));
  return s;
}

/** One bar per week with assessment decisions, tallest = the most lost. aria-hidden: the numbers carry the words. */
function weekBars(weeks: readonly WeekPoint[]): HTMLElement {
  const wrap = el('div', 'you-weeks');
  wrap.setAttribute('aria-hidden', 'true');
  const max = Math.max(...weeks.map((w) => w.bbPer100), 0.0001);
  for (const w of weeks) {
    const b = el('span', 'you-week');
    b.style.setProperty('--h', String(Math.max(0.06, w.bbPer100 / max)));
    b.title = `${w.weeksAgo === 0 ? 'This week' : `${w.weeksAgo} weeks ago`}: ${w.bbPer100} bb/100 over ${w.decisions}`;
    wrap.appendChild(b);
  }
  return wrap;
}

const MATERIAL: Record<MilestoneFamily, string> = {
  decision: 'Ceramic bone · a decision you made',
  depth: 'Glass · a depth certified',
  habit: 'Graphite · a habit kept',
};

export function renderTrophies(views: readonly MilestoneView[], next: readonly MilestoneView[]): HTMLElement {
  const root = el('div', 'you-screen you-trophies');
  root.dataset.testid = 'you-trophies';
  const earned = views.filter((v) => v.earnedOn !== null).sort((a, b) => (b.earnedOn as number) - (a.earnedOn as number));
  let selected: MilestoneView | null = earned[0] ?? null;

  const shelf = el('section', 'you-card trophy-shelf');
  const detail = el('section', 'trophy-detail');
  // Informational rows, so a flat hairline list (the kit keeps .g-group for actionable ones).
  const nextList = el('div', 'g-sect g-flat trophy-next');
  nextList.dataset.testid = 'trophy-next';

  function paintShelf(): void {
    const sum = el('div', 'g-caption');
    sum.dataset.testid = 'trophy-count';
    sum.textContent = `${earned.length} of ${views.length} earned · fixed and shown in advance · nothing random, nothing bought`;
    const grid = el('div', 'trophy-grid');
    if (earned.length === 0) grid.appendChild(el('p', 'g-sub habit-flush', 'None yet. Each one below says the decision or the habit that earns it.'));
    for (const v of earned) {
      const b = el('button', 'trophy');
      b.type = 'button';
      b.dataset.testid = 'trophy';
      b.dataset.id = v.def.id;
      b.dataset.family = v.def.family;
      b.setAttribute('aria-pressed', String(selected?.def.id === v.def.id));
      b.append(el('span', 'trophy-mark'), el('span', 'trophy-name', v.def.name), el('span', 'g-caption', dayLabel(v.earnedOn as DayKey)));
      b.addEventListener('click', () => {
        selected = v;
        paintShelf();
        paintDetail();
      });
      grid.appendChild(b);
    }
    shelf.replaceChildren(sum, grid);
  }

  function paintDetail(): void {
    if (selected === null) {
      detail.replaceChildren(el('p', 'g-sub habit-flush', 'Earn one and its record shows here: what it records, and the day.'));
      return;
    }
    const s = selected;
    const t = el('div', 't-t2', s.def.name);
    t.dataset.testid = 'trophy-detail-name';
    detail.replaceChildren(t, el('div', 'g-caption', `${MATERIAL[s.def.family]} · earned ${dayLabel(s.earnedOn as DayKey)}`), el('p', 'g-sub habit-flush', s.def.fact));
  }

  for (const v of next) {
    const row = el('div', 'g-row trophy-next-row');
    row.dataset.id = v.def.id;
    const text = el('span', 'session-card-text');
    text.append(el('span', 't-head', v.def.name), el('span', 'g-caption', v.def.fact));
    const prog = el('span', 'trophy-progress');
    prog.append(el('span', 'g-caption g-num', `${v.value} of ${v.target} ${v.unit}`));
    const bar = el('span', 'trophy-bar');
    bar.style.setProperty('--p', String(Math.min(1, v.value / v.target)));
    prog.appendChild(bar);
    row.append(text, prog);
    nextList.appendChild(row);
  }

  const left = el('div', 'you-col');
  left.appendChild(shelf);
  const right = el('div', 'you-col');
  right.append(detail, sectionHead('Next four', 'What each records, and how close you are'), nextList);
  const cols = el('div', 'you-cols');
  cols.append(left, right);
  root.appendChild(cols);
  paintShelf();
  paintDetail();
  return root;
}

export interface RivalRow {
  readonly id: string;
  readonly venue: string;
  /** The rival's name once unmasked; null while masked. */
  readonly name: string | null;
  readonly style: string | null;
  readonly hands: number;
}

export function renderRivals(rows: readonly RivalRow[], onOpen: (id: string) => void): HTMLElement {
  const root = el('div', 'you-screen you-rivals');
  root.dataset.testid = 'you-rivals';
  root.appendChild(el('p', 'g-sub habit-flush', 'The regulars of the Long Orbit. A rival stays masked until you beat their chapter; every file counts only what you saw.'));
  const list = el('div', 'g-group');
  for (const r of rows) {
    const b = el('button', 'g-row session-card');
    b.type = 'button';
    b.dataset.testid = 'rival-row';
    b.dataset.venue = r.id;
    const text = el('span', 'session-card-text');
    text.append(
      el('span', 'session-card-title t-head', r.name ?? 'A masked regular'),
      el('span', 'g-caption', `${r.venue}${r.style ? ` · ${r.style}` : ''} · ${r.hands} ${r.hands === 1 ? 'hand' : 'hands'}`),
    );
    b.append(text, chevron());
    b.addEventListener('click', () => onOpen(r.id));
    list.appendChild(b);
  }
  root.appendChild(list);
  return root;
}

/** Style, Letters, Locker: listed in the owner's sub-nav, not built in this build. Honest, never locked or hidden. */
export function renderNotYet(which: 'style' | 'letters' | 'locker'): HTMLElement {
  const copy = {
    style: ['Your style', 'One of four neutral styles from how you open and raise, with an eight-week trail. Not built in this build.'],
    letters: ['Dee’s letters', 'A short weekly letter written from your week’s numbers, scripted, never generated. Not built in this build.'],
    locker: ['The Locker', 'Paint-only card backs, felts and Dee finishes, each earned by a fact and none bought. Arrives with the next build.'],
  }[which];
  const root = el('div', 'empty-state you-screen');
  root.dataset.testid = `you-${which}`;
  root.append(el('div', 'empty-state-title', copy[0]), el('div', 'empty-state-body', copy[1]));
  return root;
}
