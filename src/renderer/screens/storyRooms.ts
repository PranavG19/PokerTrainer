import '../styles-story.css';

import { text } from '../components/dom.js';
import { keepsakeMedal, rivalMedallion, venueArt } from '../components/storyArt.js';
import { bossBeat, button, deeLine, dialogueBeat, el, hash, heading, type StoryDee } from '../components/storyKit.js';
import { DEE_BANK } from '../../core/dee/bank.js';
import { exampleFacts } from '../../core/dee/dialogue.js';
import { lessonById } from '../../core/lessons/index.js';
import type { ChapterProgress, MasqueradeState } from '../../core/progression/types.js';
import { bossFor } from '../../core/story/boss.js';
import { storyLine } from '../../core/story/campaign.js';
import { KITCHEN, MASQUERADE, RIVAL_IDS, RIVALS, VENUES, rivalDisplayName, type RivalId } from '../../core/story/cast.js';
import { dayLabel } from './you.js';
import { keepsakeFor } from '../../core/story/keepsakes.js';
import {
  INK_OBSERVATIONS,
  MASKS,
  MASQUERADE_ROUND_HANDS,
  READ_LABELS,
  canName,
  castOf,
  isComplete,
  seatReads,
  type InkRead,
  type NameResult,
} from '../../core/story/masquerade.js';
import { KITCHEN_SCRIPT, STORY_LINES } from '../../core/story/scripts.js';

/**
 * STORY — the two rooms outside the orbit (src/core/story/cast.ts KITCHEN, MASQUERADE).
 *
 * - **The Kitchen Table**, chapter 0: Dee's welcome, the price as a lesson dialogue, and the first hand (a boss hand,
 *   core/story/boss.ts). Unnumbered, rival-free, and open at any time like every room (N1).
 * - **The Masquerade**, the epilogue: three masked seats, the Folio beside them. A read is in pencil until reads.ts's
 *   sample gate (20) passes; then it is inked with its lean, and the seat can be named. The renderer computes no
 *   number: every count and lean comes from core/story/masquerade.ts.
 *
 * The keepsake shelf lives with Profile (screens/you.ts `renderKeepsakeShelf`).
 */

type KitchenStage = 'intro' | 'lesson' | 'boss';

const KITCHEN_LABEL: Readonly<Record<KitchenStage, string>> = { intro: 'Dee’s welcome', lesson: 'The price', boss: 'The first hand' };

export function renderKitchen(opts: {
  progress: ChapterProgress;
  stage: KitchenStage;
  bossKept: boolean;
  dee: StoryDee;
  onStage: (stage: KitchenStage) => void;
  onIntroSeen: () => void;
  onLessonDone: () => void;
  onBossFinish: (clean: boolean) => void;
  onBack: () => void;
}): HTMLElement {
  let stage = opts.stage;
  let introSeen = opts.progress.introSeen;
  let lessonDone = opts.progress.lessonDone;
  let kept = opts.bossKept;
  const example = lessonById(KITCHEN.beat.lessonId)?.examples[KITCHEN.beat.exampleIndex];
  const facts = example ? exampleFacts(example) : {};
  const seed = hash(KITCHEN.id);

  const root = el('div', 'story-chapter story-kitchen', 'story-kitchen');
  const announcer = el('div', 'visually-hidden', 'story-announcer');
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-live', 'polite');
  const file = el('section', 'story-file');
  const beat = el('section', 'story-beat', 'story-beat-panel');
  root.append(file, beat, announcer);
  const host = { announcer, beat, repaint: () => paint() };

  const lesson = dialogueBeat({
    script: KITCHEN_SCRIPT,
    facts,
    dee: opts.dee,
    seed,
    bank: DEE_BANK.filter((l) => l.event !== 'lesson-open'),
    done: lessonDone,
    host,
    onDone: () => {
      lessonDone = true;
      opts.onLessonDone();
    },
    next: { label: 'On to the first hand', testid: 'kitchen-to-hand', onClick: () => goto('boss') },
  });
  const boss = bossFor(KITCHEN.id);
  const keepsake = keepsakeFor(KITCHEN.id) ?? null;
  const hand = boss
    ? bossBeat({
        boss,
        rivalName: 'The other seat',
        keepsake,
        kept,
        dee: opts.dee,
        host,
        onFinish: (clean) => {
          if (clean) kept = true;
          opts.onBossFinish(clean);
        },
      })
    : null;

  function goto(next: KitchenStage): void {
    stage = next;
    opts.onStage(next);
    paint();
    beat.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
  }

  function paint(): void {
    root.dataset.stage = stage;
    file.replaceChildren(...fileNodes());
    beat.replaceChildren(...beatNodes());
  }

  function fileNodes(): Node[] {
    const out: Node[] = [button('‹ The orbit', 'pill quiet sm story-back', 'story-back', opts.onBack)];
    out.push(text('span', 'g-label', 'Chapter 0 · before the orbit'));
    const title = el('div', 'story-room-title');
    const art = el('span', 'story-seat-art');
    art.appendChild(venueArt(KITCHEN.id, 40));
    title.append(art, text('h2', 't-t2', KITCHEN.name));
    out.push(title);
    out.push(text('p', 'g-sub story-place', KITCHEN.place));
    const beats = el('div', 'g-group story-beats');
    beats.setAttribute('role', 'list');
    const done: Record<KitchenStage, boolean> = { intro: introSeen, lesson: lessonDone, boss: kept };
    const captions: Record<KitchenStage, string> = {
      intro: 'How the orbit works',
      lesson: lessonById(KITCHEN.beat.lessonId)?.title ?? 'A lesson',
      boss: kept ? `${keepsake?.name ?? 'Keepsake'} kept` : 'One hand, the price the answer',
    };
    (['intro', 'lesson', 'boss'] as const).forEach((s, i) => {
      const row = el('button', 'g-row story-beat-row', 'story-beat');
      row.type = 'button';
      row.setAttribute('role', 'listitem');
      row.dataset.beat = s;
      row.dataset.done = String(done[s]);
      if (s === stage) row.setAttribute('aria-current', 'step');
      row.appendChild(text('span', 'story-beat-n', done[s] ? '✓' : String(i + 1)));
      const t = el('span', 'story-beat-text');
      t.append(text('span', 'story-beat-title', KITCHEN_LABEL[s]), text('span', 'g-caption', captions[s]));
      row.appendChild(t);
      row.addEventListener('click', () => goto(s));
      beats.appendChild(row);
    });
    out.push(beats);
    const go = el('div', 'story-go');
    if (stage === 'intro') go.appendChild(button('Continue: the price', 'pill primary lg', 'story-primary', () => goto('lesson')));
    else if (stage === 'lesson') go.appendChild(button('Skip to the first hand', 'pill quiet', 'story-skip', () => goto('boss')));
    else go.appendChild(button('Back to the orbit', 'pill quiet', 'story-back-orbit', opts.onBack));
    go.appendChild(text('span', 'g-caption', 'Every room is open'));
    out.push(go);
    return out;
  }

  function beatNodes(): Node[] {
    if (stage === 'lesson') return lesson.nodes(lessonById(KITCHEN.beat.lessonId)?.title ?? 'The price');
    if (stage === 'boss') return hand ? hand.nodes() : [heading('The first hand')];
    if (!introSeen) {
      introSeen = true;
      opts.onIntroSeen();
    }
    const out: Node[] = [heading(KITCHEN.cluster)];
    const wrap = el('div', 'story-intro', 'story-intro');
    // Both welcome lines, in their order: the room, then the rule that nothing is locked.
    const lines = STORY_LINES.filter((l) => l.event === 'kitchen-intro')
      .map((l) => storyLine('kitchen-intro', {}, { tone: opts.dee.tone, seed, character: opts.dee.character }, [l]))
      .filter((l): l is NonNullable<typeof l> => l !== null);
    lines.forEach((l, i) => wrap.appendChild(deeLine(l, 'story-intro-line', i === lines.length - 1 ? 64 : 40)));
    if (lines.length === 0) wrap.appendChild(text('p', 'g-sub', KITCHEN.place));
    announcer.textContent = lines.map((l) => `Dee: ${l.text}`).join(' ');
    out.push(wrap);
    out.push(text('p', 'g-sub story-lesson-line', KITCHEN.lesson));
    return out;
  }

  paint();
  return root;
}

// ── the Masquerade ───────────────────────────────────────────────────────────────────────────────────

const LEAN_WORDS = { more: 'More than the standard seat', fewer: 'Fewer than the standard seat', standard: 'About the standard seat' } as const;

export function renderMasquerade(opts: {
  state: MasqueradeState;
  /** Whether each rival is unmasked in the orbit: the Masquerade never names a rival the orbit has kept masked. */
  unmaskedInOrbit: (rival: RivalId) => boolean;
  dee: StoryDee;
  /** The last naming's result, to say once. */
  said: { seat: number; result: NameResult } | null;
  onName: (seat: number, rival: RivalId) => void;
  onSitDown: () => void;
  onNewMasquerade: () => void;
  onBack: () => void;
}): HTMLElement {
  const m = opts.state;
  const cast = castOf(m);
  let selected = Math.max(0, opts.said?.seat ?? cast.findIndex((c) => !c.unmasked));
  let picked: RivalId | null = null;

  const root = el('div', 'story-chapter story-masquerade', 'story-masquerade');
  root.dataset.run = String(m.run);
  root.dataset.complete = String(isComplete(m));
  const announcer = el('div', 'visually-hidden', 'story-announcer');
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-live', 'polite');
  const file = el('section', 'story-file');
  const folio = el('section', 'story-beat masq-folio', 'masq-folio');
  root.append(file, folio, announcer);

  const nameOf = (rival: RivalId | null): string => {
    if (rival === null) return 'A regular this build does not know';
    const venue = VENUES.find((v) => v.rival === rival);
    return venue ? rivalDisplayName(venue, opts.unmaskedInOrbit(rival)) : RIVALS[rival].short;
  };

  function paint(): void {
    file.replaceChildren(...fileNodes());
    folio.replaceChildren(...folioNodes());
  }

  function fileNodes(): Node[] {
    const out: Node[] = [button('‹ The orbit', 'pill quiet sm story-back', 'story-back', opts.onBack)];
    out.push(text('span', 'g-label', `Epilogue · Masquerade ${m.run}`));
    const title = el('div', 'story-room-title');
    const art = el('span', 'story-seat-art');
    art.appendChild(venueArt(MASQUERADE.id, 40));
    title.append(art, text('h2', 't-t2', MASQUERADE.name));
    out.push(title);
    const intro = storyLine('masq-intro', {}, { tone: opts.dee.tone, seed: hash(`masq${m.run}`), character: opts.dee.character });
    out.push(intro ? deeLine(intro, 'masq-intro', 28) : text('p', 'g-sub story-place', MASQUERADE.place));
    const seats = el('div', 'g-group story-beats masq-seats', 'masq-seats');
    seats.setAttribute('role', 'list');
    cast.forEach((c, i) => {
      const reads = seatReads(m.seats[i]);
      const row = el('button', 'g-row story-beat-row masq-seat', 'masq-seat');
      row.type = 'button';
      row.setAttribute('role', 'listitem');
      row.dataset.seat = String(i);
      row.dataset.unmasked = String(c.unmasked);
      row.dataset.inked = String(canName(reads));
      if (i === selected) row.setAttribute('aria-current', 'true');
      if (c.unmasked && c.rival) row.appendChild(rivalMedallion(RIVALS[c.rival], !opts.unmaskedInOrbit(c.rival), 28));
      else row.appendChild(keepsakeMedal('mask', true, 28));
      const t = el('span', 'story-beat-text');
      const status = c.unmasked
        ? `Unmasked · ${nameOf(c.rival)}`
        : canName(reads)
          ? 'Inked · ready to name'
          : `In pencil · ${reads[0].needs} more ${reads[0].needs === 1 ? 'hand' : 'hands'}`;
      t.append(text('span', 'story-beat-title', `The ${c.mask}`), text('span', 'g-caption', status));
      row.appendChild(t);
      row.addEventListener('click', () => {
        selected = i;
        picked = null;
        paint();
        file.querySelector<HTMLElement>(`[data-seat="${i}"]`)?.focus();
      });
      seats.appendChild(row);
    });
    out.push(seats);
    const go = el('div', 'story-go');
    if (isComplete(m)) {
      go.appendChild(button('Deal a new Masquerade', 'pill primary lg', 'masq-new', opts.onNewMasquerade));
      go.appendChild(text('span', 'g-caption', 'New masks, new styles behind them'));
    } else {
      go.appendChild(button(`Sit down · ${MASQUERADE_ROUND_HANDS} hands`, 'pill primary lg', 'masq-sit', opts.onSitDown));
      go.appendChild(text('span', 'g-caption', `The Folio inks a read at ${INK_OBSERVATIONS}`));
    }
    out.push(go);
    return out;
  }

  function readTile(r: InkRead): HTMLElement {
    const tile = el('div', 'dossier-read masq-read', 'masq-read');
    tile.dataset.read = r.id;
    tile.dataset.inked = String(r.inked);
    tile.dataset.lean = r.lean ?? '';
    const words = READ_LABELS[r.id];
    tile.appendChild(text('span', 'g-label', words.label));
    const v = el('span', 'dossier-read-v g-num');
    v.append(String(r.count), text('small', '', ` of ${r.n}`));
    tile.appendChild(v);
    tile.appendChild(
      text(
        'p',
        r.inked ? 'g-sub' : 'g-caption',
        r.inked ? `Inked · ${LEAN_WORDS[r.lean ?? 'standard']}` : `Pencil · ${r.needs} more ${words.unit} to ink`,
      ),
    );
    return tile;
  }

  function folioNodes(): Node[] {
    const c = cast[selected];
    const seat = m.seats[selected];
    if (!c || !seat) return [heading('The Folio')];
    const reads = seatReads(seat);
    const out: Node[] = [heading(`The Folio · the ${c.mask}`)];
    out.push(text('p', 'g-caption masq-folio-note', 'Counted from what this seat did at the table, never its cards. Ink only past the gate.'));
    const grid = el('div', 'dossier-reads');
    for (const r of reads) grid.appendChild(readTile(r));
    out.push(grid);

    const said = opts.said && opts.said.seat === selected ? opts.said.result : null;
    const facts = { mask: c.mask, rival: nameOf(c.rival), needs: String(reads[0].needs) };
    const lineOpts = { tone: opts.dee.tone, seed: hash(`${m.run}.${selected}`), character: opts.dee.character };
    if (c.unmasked) {
      const reveal = el('div', 'story-unmask', 'masq-unmask');
      if (c.rival) reveal.appendChild(rivalMedallion(RIVALS[c.rival], !opts.unmaskedInOrbit(c.rival), 48));
      const t = el('div', 'story-unmask-text');
      t.append(text('div', 't-t3', nameOf(c.rival)), text('div', 'g-caption', `Behind the ${c.mask} · unmasked ${seat.unmaskedOn !== null ? dayLabel(seat.unmaskedOn) : ''}`));
      if (c.rival) t.appendChild(text('div', 'g-caption', RIVALS[c.rival].style));
      reveal.appendChild(t);
      out.push(reveal);
      const line = storyLine(isComplete(m) ? 'masq-done' : 'masq-fit', facts, lineOpts);
      if (line) out.push(deeLine(line, 'masq-said', 28));
      return out;
    }
    if (!canName(reads)) {
      const line = storyLine('masq-pencil', facts, lineOpts);
      out.push(line ? deeLine(line, 'masq-said', 28) : text('p', 'g-sub', `In pencil for ${reads[0].needs} more hands.`));
      return out;
    }
    if (said === 'not-a-fit') {
      const line = storyLine('masq-not-fit', facts, lineOpts);
      if (line) out.push(deeLine(line, 'masq-said', 28));
    }
    const name = el('div', 'boss-ask masq-name', 'masq-name');
    name.appendChild(text('div', 'g-label', `Name the ${c.mask}: whose style is it?`));
    const group = el('div', 'masq-styles');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', `Whose style is behind the ${c.mask}`);
    for (const id of RIVAL_IDS) {
      const b = button(RIVALS[id].style, 'g-row masq-style', 'masq-style', () => {
        picked = id;
        paint();
        folio.querySelector<HTMLElement>(`[data-rival="${id}"]`)?.focus();
      });
      b.dataset.rival = id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(picked === id));
      b.disabled = seat.missed.includes(id);
      group.appendChild(b);
    }
    const commit = button('Name it', 'pill primary', 'masq-commit', () => {
      if (picked !== null) opts.onName(selected, picked);
    });
    commit.disabled = picked === null;
    name.append(group, commit);
    out.push(name);
    return out;
  }

  if (opts.said) {
    const c = cast[opts.said.seat];
    announcer.textContent = c ? (opts.said.result === 'unmasked' ? `The ${c.mask} is unmasked: ${nameOf(c.rival)}.` : `Not a fit for the ${c.mask}.`) : '';
  }
  paint();
  return root;
}
