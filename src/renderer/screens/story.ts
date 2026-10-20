import '../styles-story.css';

import { text } from '../components/dom.js';
import { renderCard } from '../components/card.js';
import { renderDee } from '../components/dee.js';
import { chevron } from '../components/glyphs.js';
import { rivalMedallion, venueArt } from '../components/storyArt.js';
import { bossBeat, button, deeLine, dialogueBeat, el, hash, heading, type StoryDee } from '../components/storyKit.js';
import { exampleFacts } from '../../core/dee/dialogue.js';
import { DEE_BANK } from '../../core/dee/bank.js';
import { lessonById } from '../../core/lessons/index.js';
import type { ChapterProgress, RivalRecord, ShowdownRecord } from '../../core/progression/types.js';
import { KITCHEN, LEAK_LABELS, MASQUERADE, VENUES, rivalDisplayName, rivalOf, type ChapterId, type Venue } from '../../core/story/cast.js';
import { bossFor } from '../../core/story/boss.js';
import { keepsakeFor } from '../../core/story/keepsakes.js';
import {
  GOAL_FREE_SHARE,
  GOAL_MIN_JUDGED,
  STORY_TABLE_HANDS,
  debriefLine,
  introLines,
  storyLine,
  type Stage,
  type TableJudgement,
} from '../../core/story/campaign.js';
import { qualityTrend, reads, shownStrength, takeOf, type Read } from '../../core/story/dossier.js';
import type { RoutedChapter, StoryRoute, Tailor } from '../../core/story/route.js';
import { CHAPTER_SCRIPTS } from '../../core/story/scripts.js';

/**
 * STORY — the Long Orbit (src/core/story/). Three screens: the map (a table seen from above, six venues around
 * it, each rival masked until beaten), a chapter (intro → lesson → table → debrief), and a rival's file.
 *
 * Nothing is locked (N1): every venue on the map opens, every beat in a chapter can be picked, and the order is
 * only "suggested next". Every personalized element shows its citation (route.ts). The renderer computes no
 * number: counts come from core, Dee's words from the story lines, and the goal from campaign.ts.
 */

export type { StoryDee };

const STAGE_LABEL: Readonly<Record<Stage, string>> = {
  intro: 'Dee’s intro',
  lesson: 'The lesson',
  table: 'The table',
  debrief: 'Debrief',
  boss: 'The last hand',
};

function statusOf(c: RoutedChapter, unmasked: boolean, next: boolean): string {
  if (next) return 'Suggested next';
  if (unmasked) return `Unmasked · ${rivalOf(c.venue).short}`;
  if (c.leak && c.position < c.defaultPosition) return `Up from ${c.defaultPosition}`;
  return c.venue.cluster;
}

// ── the map ────────────────────────────────────────────────────────────────────────────────────────

export function renderStoryMap(opts: {
  route: StoryRoute;
  unmasked: (id: ChapterId) => boolean;
  dee: StoryDee;
  /** Chapter 0 and the epilogue, beside the orbit: what each shows on the map. */
  kitchen: { readonly kept: boolean; readonly started: boolean };
  masquerade: { readonly unmasked: number; readonly seats: number; readonly completed: number };
  onOpenChapter: (id: ChapterId) => void;
  onOpenFile: (id: ChapterId) => void;
  onOpenKitchen: () => void;
  onOpenMasquerade: () => void;
}): HTMLElement {
  const { route } = opts;
  const root = el('div', 'story-map', 'story-map');
  root.dataset.personalized = String(route.personalized);

  const orbit = el('section', 'story-orbit');
  orbit.setAttribute('aria-label', `The Long Orbit: six venues. ${route.why}`);
  orbit.appendChild(el('div', 'story-felt'));
  const hub = el('div', 'story-hub');
  if (opts.dee.character) hub.appendChild(renderDee('rest', 40));
  hub.appendChild(text('div', 't-t3', 'The Long Orbit'));
  hub.appendChild(text('div', 'g-caption story-hub-why', route.why));
  // Chapter 0 sits at the middle of the table, unnumbered: where every orbit starts.
  const kitchen = el('button', 'pill quiet sm story-kitchen-open', 'story-kitchen-open');
  kitchen.type = 'button';
  kitchen.dataset.kept = String(opts.kitchen.kept);
  kitchen.textContent = opts.kitchen.kept ? `✓ ${KITCHEN.name}` : opts.kitchen.started ? `Chapter 0 · ${KITCHEN.name}` : `Start here: ${KITCHEN.name}`;
  kitchen.setAttribute('aria-label', `Chapter 0, ${KITCHEN.name}: the tutorial. ${opts.kitchen.kept ? 'Its keepsake is kept.' : 'Open at any time.'}`);
  kitchen.addEventListener('click', opts.onOpenKitchen);
  hub.appendChild(kitchen);
  orbit.appendChild(hub);

  const list = el('ol', 'story-seats');
  list.setAttribute('aria-label', 'Venues, in suggested order');
  route.chapters.forEach((c, i) => {
    const unmasked = opts.unmasked(c.venue.id);
    const next = c.venue.id === route.next;
    const li = el('li', 'story-seat-slot');
    // Clockwise from the top of the table, in orbit order.
    const angle = (-90 + 60 * i) * (Math.PI / 180);
    li.style.setProperty('--x', `${50 + 39 * Math.cos(angle)}%`);
    li.style.setProperty('--y', `${50 + 37 * Math.sin(angle)}%`);
    const seat = el('button', 'story-seat', 'story-venue');
    seat.type = 'button';
    seat.dataset.venue = c.venue.id;
    seat.dataset.next = String(next);
    seat.dataset.masked = String(!unmasked);
    const status = statusOf(c, unmasked, next);
    seat.setAttribute('aria-label', `Chapter ${c.position}, ${c.venue.name}. ${rivalDisplayName(c.venue, unmasked)}. ${status}.`);
    const art = el('span', 'story-seat-art');
    art.appendChild(venueArt(c.venue.id, next ? 52 : 40));
    const medal = el('span', 'story-seat-medal');
    medal.appendChild(rivalMedallion(rivalOf(c.venue), !unmasked, next ? 26 : 22));
    art.appendChild(medal);
    seat.appendChild(art);
    seat.appendChild(text('b', 'story-seat-name', `${c.position} · ${c.venue.name}`));
    seat.appendChild(text('span', 'story-seat-status', status));
    seat.addEventListener('click', () => opts.onOpenChapter(c.venue.id));
    li.appendChild(seat);
    list.appendChild(li);
  });
  orbit.appendChild(list);
  root.appendChild(orbit);

  // The side: the suggested chapter, why it is first, and the one primary action.
  const nextChapter = route.chapters.find((c) => c.venue.id === route.next) as RoutedChapter;
  const side = el('section', 'story-side');
  side.setAttribute('aria-label', 'Suggested next');
  const v = nextChapter.venue;
  const unmasked = opts.unmasked(v.id);
  side.appendChild(text('span', 'g-label', `Suggested next · Chapter ${nextChapter.position} of ${route.chapters.length}`));
  side.appendChild(text('h2', 't-t2', v.name));
  side.appendChild(citationTag(nextChapter, 'story-next-citation'));
  side.appendChild(text('p', 'g-sub story-side-place', v.place));
  side.appendChild(rivalRow(v, unmasked, () => opts.onOpenFile(v.id)));

  const order = el('div', 'story-order', 'story-order');
  order.appendChild(text('div', 'g-label', 'Why this order'));
  const ol = el('ol', 'g-sect g-flat story-order-list');
  for (const c of route.chapters) {
    const li = el('li', 'story-order-row');
    li.dataset.venue = c.venue.id;
    li.appendChild(text('span', 'story-order-n g-num', String(c.position)));
    li.appendChild(text('span', 'story-order-name', c.venue.name));
    li.appendChild(
      text('span', 'g-caption story-order-why', c.leak ? `${LEAK_LABELS[c.leak.kind]}, ${c.leak.costBb.toFixed(1)} bb` : c.venue.cluster),
    );
    ol.appendChild(li);
  }
  order.appendChild(ol);
  order.appendChild(
    text(
      'p',
      'g-caption',
      route.source.hands === 0
        ? 'Play some hands and this order follows what costs you most.'
        : `Read from your last ${route.source.hands} hands (${route.source.decisions} graded decisions), reach-weighted.`,
    ),
  );
  side.appendChild(order);

  // The epilogue: replayable, open from the first day like everything else (N1).
  const masq = el('button', 'g-row story-rival story-masq-open', 'story-masquerade-open');
  masq.type = 'button';
  masq.appendChild(venueArt(MASQUERADE.id, 32));
  const mt = el('span', 'story-rival-text');
  const m = opts.masquerade;
  mt.append(
    text('span', 'story-rival-name', `Epilogue · ${MASQUERADE.name}`),
    text(
      'span',
      'g-caption',
      m.seats === 0 ? 'Every seat masked. Name them from the reads alone.' : `${m.unmasked} of ${m.seats} masks off${m.completed > 0 ? ` · ${m.completed} finished` : ''}`,
    ),
  );
  masq.append(mt, chevron());
  masq.addEventListener('click', opts.onOpenMasquerade);
  side.appendChild(masq);

  const go = el('div', 'story-go');
  const cont = button(`Continue: ${v.name}`, 'pill primary lg', 'story-continue', () => opts.onOpenChapter(v.id));
  go.appendChild(cont);
  go.appendChild(text('span', 'g-caption', 'Every venue is open'));
  side.appendChild(go);
  root.appendChild(side);
  return root;
}

function citationTag(c: RoutedChapter, testid: string): HTMLElement {
  const tag = el('p', 'story-citation', testid);
  tag.dataset.personalized = String(c.citation !== null);
  if (c.citation && c.leak) {
    tag.appendChild(text('b', '', `Built from your leak: ${LEAK_LABELS[c.leak.kind]}. `));
    tag.appendChild(document.createTextNode(c.citation));
  } else {
    tag.textContent = `On its default place in the orbit: ${c.venue.cluster.toLowerCase()}.`;
  }
  return tag;
}

function rivalRow(venue: Venue, unmasked: boolean, onOpenFile: () => void): HTMLElement {
  const rival = rivalOf(venue);
  const row = el('button', 'g-row story-rival', 'story-open-file');
  row.type = 'button';
  row.dataset.masked = String(!unmasked);
  row.appendChild(rivalMedallion(rival, !unmasked, 32));
  const t = el('span', 'story-rival-text');
  t.appendChild(text('span', 'story-rival-name', unmasked ? `${rival.name}, ${rival.title}` : rivalDisplayName(venue, false)));
  t.appendChild(text('span', 'g-caption', unmasked ? rival.style : 'Masked. Meet the goal at this table to see who it is.'));
  row.appendChild(t);
  row.appendChild(text('span', 'g-caption', 'File'));
  row.appendChild(chevron());
  row.addEventListener('click', onOpenFile);
  return row;
}

// ── a chapter ──────────────────────────────────────────────────────────────────────────────────────

export interface ChapterOpts {
  venue: Venue;
  routed: RoutedChapter;
  total: number;
  progress: ChapterProgress;
  unmasked: boolean;
  stage: Stage;
  /** What the rival leans on at this table, when personalized. */
  tailor: Tailor | null;
  /** The table just played, if the debrief follows one. */
  justPlayed: { judgement: TableJudgement; wasUnmasked: boolean } | null;
  /** The last table on file for this chapter, for a debrief opened later. */
  lastTable: TableJudgement | null;
  dee: StoryDee;
  onStage: (stage: Stage) => void;
  onIntroSeen: () => void;
  onLessonDone: () => void;
  onSitDown: () => void;
  onOpenFile: () => void;
  onBack: () => void;
  /** The room's boss hand: its keepsake is already kept. */
  bossKept: boolean;
  /** A boss hand played to the end. */
  onBossFinish: (clean: boolean) => void;
}

export function renderChapter(opts: ChapterOpts): HTMLElement {
  const { venue } = opts;
  const rival = rivalOf(venue);
  let stage = opts.stage;
  const script = CHAPTER_SCRIPTS[venue.id];
  const example = lessonById(venue.beat.lessonId)?.examples[venue.beat.exampleIndex];
  const facts = example ? exampleFacts(example) : {};
  const seed = hash(venue.id);
  // Dee's intro already opened the chapter, so the beat skips the bank's generic lesson opener.
  const dialogueOpts = { tone: opts.dee.tone, seed, character: opts.dee.character, bank: DEE_BANK.filter((l) => l.event !== 'lesson-open') };
  let lessonDone = opts.progress.lessonDone;
  let introSeen = opts.progress.introSeen;

  const root = el('div', 'story-chapter', 'story-chapter');
  root.dataset.venue = venue.id;
  // One polite region for every new line in the beat (Dee's lines, the dialogue's replies), mounted once.
  const announcer = el('div', 'visually-hidden', 'story-announcer');
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-live', 'polite');

  const file = el('section', 'story-file');
  const beat = el('section', 'story-beat', 'story-beat-panel');
  root.append(file, beat, announcer);
  const host = { announcer, beat, repaint: () => paint() };
  const lesson = dialogueBeat({
    script,
    facts,
    dee: opts.dee,
    seed,
    bank: dialogueOpts.bank,
    done: lessonDone,
    host,
    onDone: () => {
      lessonDone = true;
      opts.onLessonDone();
    },
    next: { label: 'On to the table', testid: 'story-to-table', onClick: () => goto('table') },
  });
  const boss = bossFor(venue.id);
  const keepsake = keepsakeFor(venue.id) ?? null;
  const last = boss
    ? bossBeat({
        boss,
        rivalName: rivalDisplayName(venue, opts.unmasked),
        keepsake,
        kept: opts.bossKept,
        dee: opts.dee,
        host,
        onFinish: opts.onBossFinish,
      })
    : null;

  function goto(next: Stage, focus = true): void {
    stage = next;
    opts.onStage(next);
    paint();
    if (focus) beat.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
  }

  function paint(): void {
    root.dataset.stage = stage;
    file.replaceChildren(...fileNodes());
    beat.replaceChildren(...beatNodes());
  }

  function fileNodes(): Node[] {
    const out: Node[] = [];
    out.push(button('‹ The orbit', 'pill quiet sm story-back', 'story-back', opts.onBack));
    const moved = opts.routed.position < opts.routed.defaultPosition ? ` · moved up from ${opts.routed.defaultPosition}` : '';
    out.push(text('span', 'g-label', `Chapter ${opts.routed.position} of ${opts.total}${moved}`));
    const h2 = text('h2', 't-t2', venue.name);
    out.push(h2);
    out.push(citationTag(opts.routed, 'story-citation'));
    out.push(text('p', 'g-sub story-place', venue.place));
    out.push(rivalRow(venue, opts.unmasked, opts.onOpenFile));

    const beats = el('div', 'g-group story-beats');
    beats.setAttribute('role', 'list');
    const done: Record<Stage, boolean> = {
      intro: introSeen,
      lesson: lessonDone,
      table: opts.progress.tables > 0 || opts.justPlayed !== null,
      debrief: opts.lastTable !== null || opts.justPlayed !== null,
      boss: opts.bossKept,
    };
    const captions: Record<Stage, string> = {
      intro: 'A short scene',
      lesson: lessonById(venue.beat.lessonId)?.title ?? 'A lesson',
      table: `${STORY_TABLE_HANDS} hands, heads-up`,
      debrief: opts.progress.beatenOn !== null ? 'Goal met' : 'Judged on decisions',
      boss: opts.bossKept ? `${keepsake?.name ?? 'Keepsake'} kept` : 'One hand, its exploit the answer',
    };
    (['intro', 'lesson', 'table', 'debrief', 'boss'] as const).forEach((s, i) => {
      const row = el('button', 'g-row story-beat-row', 'story-beat');
      row.type = 'button';
      row.setAttribute('role', 'listitem');
      row.dataset.beat = s;
      row.dataset.done = String(done[s]);
      if (s === stage) row.setAttribute('aria-current', 'step');
      row.appendChild(text('span', 'story-beat-n', done[s] ? '✓' : String(i + 1)));
      const t = el('span', 'story-beat-text');
      t.appendChild(text('span', 'story-beat-title', STAGE_LABEL[s]));
      t.appendChild(text('span', 'g-caption', captions[s]));
      row.appendChild(t);
      row.addEventListener('click', () => goto(s));
      beats.appendChild(row);
    });
    out.push(beats);

    const go = el('div', 'story-go');
    if (stage === 'intro') go.appendChild(button('Continue: the lesson', 'pill primary lg', 'story-primary', () => goto('lesson')));
    else if (stage === 'lesson') go.appendChild(button('Skip to the table', 'pill quiet', 'story-skip', () => goto('table')));
    else if (stage === 'table') go.appendChild(button(`Sit down · ${STORY_TABLE_HANDS} hands`, 'pill primary lg', 'story-sit', opts.onSitDown));
    else if (stage === 'boss') go.appendChild(button('Back to the orbit', 'pill quiet', 'story-back-orbit', opts.onBack));
    else {
      const result = opts.justPlayed?.judgement.result ?? opts.lastTable?.result ?? null;
      if (result === 'met') {
        go.appendChild(button('On to the last hand', 'pill primary lg', 'story-to-boss', () => goto('boss')));
        go.appendChild(button('Back to the orbit', 'pill quiet', 'story-back-orbit', opts.onBack));
      } else {
        go.appendChild(button('Play the table again', 'pill primary lg', 'story-sit', opts.onSitDown));
        go.appendChild(button('Back to the orbit', 'pill quiet', 'story-back-orbit', opts.onBack));
      }
    }
    out.push(go);
    return out;
  }

  function beatNodes(): Node[] {
    if (stage === 'intro') return introNodes();
    if (stage === 'lesson') return lessonNodes();
    if (stage === 'table') return tableNodes();
    if (stage === 'boss') return last ? last.nodes() : [heading('The last hand')];
    return debriefNodes();
  }

  function introNodes(): Node[] {
    const lines = introLines(venue, opts.unmasked, opts.routed.leak?.kind ?? null, opts.routed.leak ? LEAK_LABELS[opts.routed.leak.kind] : null, {
      ...dialogueOpts,
    });
    if (!introSeen) {
      introSeen = true;
      opts.onIntroSeen();
    }
    announcer.textContent = lines.map((l) => `Dee: ${l.text}`).join(' ');
    const out: Node[] = [heading(venue.cluster)];
    const wrap = el('div', 'story-intro', 'story-intro');
    lines.forEach((l, i) => wrap.appendChild(deeLine(l, 'story-intro-line', i === lines.length - 1 ? 64 : 40)));
    if (lines.length === 0) wrap.appendChild(text('p', 'g-sub', venue.place));
    out.push(wrap);
    out.push(text('p', 'g-sub story-lesson-line', venue.lesson));
    return out;
  }

  function lessonNodes(): Node[] {
    return lesson.nodes(lessonById(venue.beat.lessonId)?.title ?? 'The lesson');
  }

  function goalNodes(): HTMLElement {
    const goal = el('div', 'g-sect g-flat story-goal', 'story-goal');
    const rows: [string, string][] = [
      ['Judged', `Your decisions after the flop that face a bet, and every turn and river decision. At least ${GOAL_MIN_JUDGED}.`],
      ['The goal', `${GOAL_FREE_SHARE * 4} in 4 of them cost nothing, and no serious mistake in ${venue.targets.length > 0 ? venue.targets.map((k) => LEAK_LABELS[k]).join(' or ') : 'any spot'}.`],
      ['Never', 'Chips. Winning or losing the pots does not move the goal.'],
    ];
    for (const [k, v] of rows) {
      const row = el('div', 'story-goal-row');
      row.append(text('span', 'g-label', k), text('span', 'g-sub', v));
      goal.appendChild(row);
    }
    return goal;
  }

  function tableNodes(): Node[] {
    const out: Node[] = [heading(`${STORY_TABLE_HANDS} hands against ${rivalDisplayName(venue, opts.unmasked)}`)];
    out.push(goalNodes());
    const lean = el('p', 'story-citation', 'story-tailor');
    lean.dataset.personalized = String(opts.tailor !== null);
    lean.textContent = opts.tailor
      ? opts.tailor.text
      : 'This regular plays their usual style: no leak of yours on record for them to lean on.';
    out.push(lean);
    if (opts.lastTable) out.push(text('p', 'g-caption', `Last table here: ${opts.lastTable.free} of ${opts.lastTable.judged} judged decisions cost nothing.`));
    out.push(text('p', 'g-caption', 'Heads-up, 100 big blinds, the coach as usual. Every hand also lands in your hand log.'));
    return out;
  }

  function debriefNodes(): Node[] {
    const j = opts.justPlayed?.judgement ?? opts.lastTable;
    if (j === null) {
      return [heading('Debrief'), text('p', 'g-sub', 'No table played here yet. The debrief judges the decisions from one.')];
    }
    const out: Node[] = [];
    const titles = { met: 'Goal met', short: 'Not yet', unjudged: 'Not enough to judge' } as const;
    out.push(heading(titles[j.result]));
    const tile = el('div', 'story-debrief', 'story-debrief');
    tile.dataset.result = j.result;
    const score = el('div', 'story-debrief-score');
    score.append(text('span', 't-stat g-num', `${j.free} of ${j.judged}`), text('span', 'g-label', 'judged decisions cost nothing'));
    tile.appendChild(score);
    tile.appendChild(
      text(
        'p',
        'g-caption',
        `The goal: at least ${GOAL_MIN_JUDGED} judged, ${GOAL_FREE_SHARE * 4} in 4 free, no serious mistake of this table’s kind. Serious mistakes: ${j.serious}${j.focusSerious > 0 ? `, ${j.focusSerious} of this table’s kind` : ''}.`,
      ),
    );
    out.push(tile);
    const wasUnmasked = opts.justPlayed?.wasUnmasked ?? true;
    const line = debriefLine(venue, j, wasUnmasked, { ...dialogueOpts, seed: seed + opts.progress.tables });
    if (line) {
      out.push(deeLine(line, 'story-debrief-line', 40));
      announcer.textContent = `Dee: ${line.text}`;
    }
    if (j.result === 'met' && !wasUnmasked) {
      const reveal = el('div', 'story-unmask', 'story-unmask');
      reveal.appendChild(rivalMedallion(rival, false, 56));
      const t = el('div', 'story-unmask-text');
      t.append(text('div', 't-t3', rival.name), text('div', 'g-caption', `${rival.title} · ${rival.style}`), text('q', 'story-unmask-line', rival.unmaskLine));
      reveal.appendChild(t);
      out.push(reveal);
    }
    return out;
  }

  paint();
  return root;
}

// ── a rival's file ─────────────────────────────────────────────────────────────────────────────────

const STREET_SHORT = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' } as const;

function showdownSummary(s: ShowdownRecord): string {
  const aggression = s.actions.filter((a) => a.kind === 'bet' || a.kind === 'raise' || a.kind === 'allin');
  const last = aggression[aggression.length - 1];
  const strength = shownStrength(s);
  const held = strength === 'nothing' ? 'held nothing of their own' : strength === 'pair' ? 'held one pair' : 'held two pair or better';
  if (!last) return `Checked or called down · ${held}`;
  const share = last.potShare === null ? '' : ` ${Math.round(last.potShare * 100)}% of the pot`;
  return `${STREET_SHORT[last.street]} ${last.kind === 'allin' ? 'all-in' : last.kind}${share} · ${held}`;
}

export function renderRivalDossier(opts: {
  venue: Venue;
  unmasked: boolean;
  record: RivalRecord;
  dee: StoryDee;
  onOpenChapter: () => void;
  onBack: () => void;
}): HTMLElement {
  const { venue, record } = opts;
  const rival = rivalOf(venue);
  const name = rivalDisplayName(venue, opts.unmasked);
  const root = el('div', 'rival-dossier', 'rival-dossier');
  root.dataset.rival = rival.id;
  root.dataset.masked = String(!opts.unmasked);
  const all = reads(record.showdowns);

  const left = el('section', 'dossier-file');
  left.setAttribute('aria-label', `${name}: the file`);
  left.appendChild(button('‹ The orbit', 'pill quiet sm story-back', 'story-back', opts.onBack));
  const token = el('div', 'dossier-token');
  token.appendChild(text('span', 'g-caption dossier-stamp', `File · ${venue.name}`));
  token.appendChild(rivalMedallion(rival, !opts.unmasked, 88));
  left.appendChild(token);
  left.appendChild(text('h2', 't-t2', opts.unmasked ? rival.name : name));
  left.appendChild(
    text('p', 'g-caption', opts.unmasked ? `${rival.title}. ${rival.style}.` : 'Masked. The name comes off when you meet the goal at this table.'),
  );

  const rec = el('div', 'g-sect g-flat dossier-record', 'dossier-record');
  const stat = (label: string, value: string, testid: string): HTMLElement => {
    const row = el('div', 'dossier-stat', testid);
    row.append(text('span', 'g-label', label), text('span', 't-head g-num', value));
    return row;
  };
  rec.appendChild(stat('Hands against them', String(record.hands), 'dossier-hands'));
  rec.appendChild(stat('Showdowns seen', String(record.showdowns.length), 'dossier-showdowns'));
  left.appendChild(rec);
  left.appendChild(trendChart(record));
  root.appendChild(left);

  const right = el('section', 'dossier-reads-col');
  right.setAttribute('aria-label', 'What they showed you');
  const head = el('div', 'dossier-sec');
  head.append(text('h3', 't-t3', 'What they showed you'), text('span', 'g-caption', 'Counted only from hands that reached a showdown'));
  right.appendChild(head);
  const grid = el('div', 'dossier-reads');
  for (const r of all) grid.appendChild(readTile(r));
  right.appendChild(grid);

  const take = takeOf(all);
  const line = storyLine(take.event, { ...take.facts, rival: name }, { tone: opts.dee.tone, seed: hash(rival.id) + record.showdowns.length, character: opts.dee.character });
  if (line) right.appendChild(deeLine(line, 'dossier-take', 28, 'Dee · from the showdowns on file'));

  const hands = el('div', 'dossier-hands-list');
  hands.appendChild(text('div', 'g-label', 'Their last hands, shown'));
  const recent = record.showdowns.slice(-3).reverse();
  const list = el('div', 'g-sect g-flat');
  if (recent.length === 0) list.appendChild(text('p', 'g-caption dossier-empty', 'No showdown yet. Folds and uncontested pots show nothing, so they teach nothing here.'));
  for (const s of recent) {
    const row = el('div', 'dossier-hand', 'dossier-hand');
    const cards = el('span', 'g-mini');
    for (const c of s.shown) cards.appendChild(renderCard(c, { small: true }));
    row.append(cards, text('span', 'g-sub', showdownSummary(s)));
    list.appendChild(row);
  }
  hands.appendChild(list);
  right.appendChild(hands);

  const go = el('div', 'story-go');
  go.appendChild(button(`Play ${venue.name}`, 'pill primary lg', 'dossier-chapter', opts.onOpenChapter));
  go.appendChild(text('span', 'g-caption', `${rival.short === name ? rival.short : 'This regular'} sits at ${venue.name} in the Story`));
  right.appendChild(go);
  root.appendChild(right);
  return root;
}

function readTile(r: Read): HTMLElement {
  const tile = el('div', 'dossier-read', 'dossier-read');
  tile.dataset.read = r.id;
  tile.dataset.earned = String(r.earned);
  tile.appendChild(text('span', 'g-label', r.label));
  if (r.earned) {
    const v = el('span', 'dossier-read-v g-num');
    v.append(String(r.count), text('small', '', ` of ${r.seen}`));
    tile.appendChild(v);
    tile.appendChild(text('p', 'g-sub', r.counted));
    const bar = el('span', 'dossier-bar');
    bar.setAttribute('aria-hidden', 'true');
    const fill = el('i', '');
    fill.style.setProperty('--w', `${Math.round((r.share ?? 0) * 100)}%`);
    bar.appendChild(fill);
    tile.appendChild(bar);
  } else {
    tile.appendChild(text('span', 'dossier-read-v dossier-read-locked', 'Not earned'));
    tile.appendChild(text('p', 'g-caption', `${r.needs} more showdown${r.needs === 1 ? '' : 's'} to say anything${r.seen > 0 ? ` (${r.seen} so far)` : ''}.`));
  }
  return tile;
}

/** Decision quality per table: one bar per sitting, the share of judged decisions that cost nothing. */
function trendChart(record: RivalRecord): HTMLElement {
  const wrap = el('figure', 'dossier-trend', 'dossier-trend');
  wrap.appendChild(text('figcaption', 'g-label', 'Your decisions against them, per table'));
  const points = qualityTrend(record).slice(-12);
  if (points.length === 0) {
    wrap.appendChild(text('p', 'g-caption', 'No table yet. Each table adds a bar: the share of judged decisions that cost nothing.'));
    return wrap;
  }
  const chart = el('div', 'dossier-bars');
  chart.setAttribute('role', 'list');
  chart.setAttribute('aria-label', 'Share of judged decisions that cost nothing, per table, oldest first');
  points.forEach((p, i) => {
    const bar = el('span', 'dossier-bars-bar');
    bar.setAttribute('role', 'listitem');
    const label = p.share === null ? `Table ${i + 1}: nothing judged` : `Table ${i + 1}: ${p.free} of ${p.judged} cost nothing`;
    bar.setAttribute('aria-label', label);
    bar.title = label;
    bar.style.setProperty('--h', `${Math.max(4, Math.round((p.share ?? 0) * 100))}%`);
    chart.appendChild(bar);
  });
  const goalLine = el('span', 'dossier-bars-goal');
  goalLine.style.setProperty('--at', `${GOAL_FREE_SHARE * 100}%`);
  goalLine.setAttribute('aria-hidden', 'true');
  chart.appendChild(goalLine);
  wrap.appendChild(chart);
  wrap.appendChild(text('p', 'g-caption', `The line is the goal, ${GOAL_FREE_SHARE * 4} in 4. Chips are not on this chart.`));
  return wrap;
}

/** The Home strip: the orbit's suggested chapter in one row. */
export function renderStoryStrip(opts: { route: StoryRoute; unmasked: (id: ChapterId) => boolean; onOpen: () => void }): HTMLElement {
  const c = opts.route.chapters.find((x) => x.venue.id === opts.route.next) as RoutedChapter;
  const unmasked = opts.unmasked(c.venue.id);
  const row = el('button', 'g-row session-card story-strip', 'story-strip');
  row.type = 'button';
  row.dataset.venue = c.venue.id;
  row.appendChild(rivalMedallion(rivalOf(c.venue), !unmasked, 28));
  const t = el('span', 'session-card-text');
  t.appendChild(text('span', 'session-card-title t-head', 'The Long Orbit'));
  const who = unmasked ? rivalOf(c.venue).short : 'its regular, still masked';
  const meta = c.leak
    ? `Next: ${c.venue.name}, built from your last ${opts.route.source.hands === 1 ? 'hand' : `${opts.route.source.hands} hands`}: ${LEAK_LABELS[c.leak.kind]}, ${c.leak.costBb.toFixed(1)} bb`
    : `Next: ${c.venue.name}, ${who}`;
  if (c.citation) row.title = c.citation;
  t.appendChild(text('span', 'session-card-meta g-caption', meta));
  row.appendChild(t);
  const steps = el('span', 'story-strip-steps');
  steps.setAttribute('aria-hidden', 'true');
  for (const v of VENUES) {
    const i = el('i', '');
    if (opts.unmasked(v.id)) i.dataset.on = 'true';
    steps.appendChild(i);
  }
  row.appendChild(steps);
  row.appendChild(chevron());
  row.setAttribute('aria-label', `The Long Orbit. Chapter ${c.position}, ${c.venue.name}. ${meta}. ${VENUES.filter((v) => opts.unmasked(v.id)).length} of 6 rivals unmasked.`);
  row.addEventListener('click', opts.onOpen);
  return row;
}
