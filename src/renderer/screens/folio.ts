import '../styles-habit.css';
import type { FolioCard } from '../../core/folio.js';
import { folioSheet } from '../../core/folio.js';
import { lessonById } from '../../core/lessons/index.js';
import { CONTRAST_MANIFEST } from '../../core/contrastManifest.js';

/**
 * FOLIO, THE RULEBOOK: the learner's own rule sentences as cards. A card dulls as its next spacing wave comes owed
 * (core/folio.ts, on schedule.ts's waves) and re-polishes when the learner re-reads it and keeps it. The sheet view
 * is the one-page export: every rule on one page, with Copy.
 *
 * The cards are the learner's words, shown verbatim; nothing here grades them.
 */

export function conceptLabel(conceptId: string): string {
  return lessonById(conceptId)?.title ?? CONTRAST_MANIFEST.find((e) => e.conceptId === conceptId)?.title ?? conceptId;
}

export interface FolioProps {
  readonly cards: readonly FolioCard[];
  readonly onPolish: (conceptId: string) => void;
  /** Where a rule is written (Learn's lessons). */
  readonly onWrite: () => void;
  /** Copy the sheet. Absent outside a secure context: the sheet can still be selected by hand. */
  readonly copy?: (text: string) => Promise<void>;
  /** Teach Dee this rule: a contrast set played from it (screens/contrast.ts renderTeachDee). */
  readonly onTeach?: (conceptId: string) => void;
  /** Per card, what its newest Teach Dee set found, as a caption ("Dee found it too broad · rewrite it"). */
  readonly teachNotes?: Readonly<Record<string, string>>;
}

export function renderFolio(props: FolioProps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'folio-screen';
  root.dataset.testid = 'folio-screen';
  let view: 'cards' | 'sheet' = 'cards';

  function paint(): void {
    root.dataset.view = view;
    const head = document.createElement('div');
    head.className = 'habit-head';
    const h = document.createElement('h1');
    h.className = 't-t2';
    h.textContent = 'The Rulebook';
    const tools = document.createElement('div');
    tools.className = 'onboarding-choices';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'pill quiet';
    toggle.dataset.testid = 'folio-sheet-toggle';
    toggle.textContent = view === 'cards' ? 'One page' : 'Cards';
    toggle.disabled = props.cards.length === 0;
    toggle.addEventListener('click', () => {
      view = view === 'cards' ? 'sheet' : 'cards';
      paint();
    });
    tools.appendChild(toggle);
    head.append(h, tools);

    const sub = document.createElement('p');
    sub.className = 'g-sub';
    sub.classList.add('habit-flush');
    const dull = props.cards.filter((c) => c.tarnished).length;
    sub.dataset.testid = 'folio-summary';
    sub.textContent =
      props.cards.length === 0
        ? 'Every rule you write in your own words lands here as a card.'
        : `${props.cards.length} ${props.cards.length === 1 ? 'rule' : 'rules'} in your words${dull > 0 ? ` · ${dull} to re-polish` : ' · all bright'}. A card dulls on the spacing schedule; re-read it and keep it to polish it.`;

    if (view === 'sheet') {
      root.replaceChildren(head, sub, renderSheet());
      return;
    }
    root.replaceChildren(head, sub, props.cards.length === 0 ? renderEmpty() : renderCards());
  }

  function renderEmpty(): HTMLElement {
    const empty = document.createElement('div');
    empty.className = 'empty-state folio-empty';
    empty.dataset.testid = 'folio-empty';
    const t = document.createElement('div');
    t.className = 'empty-state-title';
    t.textContent = 'No rules yet';
    const b = document.createElement('div');
    b.className = 'empty-state-body';
    b.textContent = 'Finish a lesson and write its rule in your own words, or repair a leak in Train.';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'pill';
    go.dataset.testid = 'folio-write';
    go.textContent = 'Open the lessons';
    go.addEventListener('click', props.onWrite);
    empty.append(t, b, go);
    return empty;
  }

  function renderCards(): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'folio-cards';
    for (const c of props.cards) {
      const card = document.createElement('article');
      card.className = 'folio-card';
      card.dataset.testid = 'folio-card';
      card.dataset.concept = c.conceptId;
      card.dataset.tarnished = String(c.tarnished);
      card.dataset.tarnish = String(c.tarnish);
      const text = document.createElement('p');
      text.className = 'folio-text';
      text.textContent = `“${c.text}”`;
      const meta = document.createElement('div');
      meta.className = 'folio-meta';
      const label = document.createElement('span');
      label.className = 'g-caption';
      label.textContent = `${conceptLabel(c.conceptId)} · ${c.source === 'lesson' ? 'from a lesson' : 'from a repair'}`;
      meta.appendChild(label);
      if (c.tarnished) {
        const keep = document.createElement('button');
        keep.type = 'button';
        keep.className = 'pill quiet';
        keep.dataset.testid = 'folio-polish';
        keep.textContent = 'Still true';
        keep.title = 'Re-read it and keep it: this polishes the card for the next spacing wave.';
        keep.addEventListener('click', () => props.onPolish(c.conceptId));
        meta.appendChild(keep);
      } else {
        const when = document.createElement('span');
        when.className = 'g-caption';
        when.dataset.testid = 'folio-next';
        when.textContent = c.dueInDays === null ? 'Polished for good' : c.dueInDays <= 1 ? 'Polish due tomorrow' : `Polish in ${c.dueInDays} days`;
        meta.appendChild(when);
      }
      if (props.onTeach) {
        const teach = document.createElement('button');
        teach.type = 'button';
        teach.className = 'pill quiet';
        teach.dataset.testid = 'folio-teach';
        teach.textContent = 'Teach Dee';
        teach.title = 'Dee plays a contrast set from this rule, and the engine judges every play.';
        teach.addEventListener('click', () => props.onTeach?.(c.conceptId));
        meta.appendChild(teach);
      }
      card.append(text, meta);
      const note = props.teachNotes?.[c.conceptId];
      if (note) {
        const n = document.createElement('span');
        n.className = 'g-caption';
        n.dataset.testid = 'folio-teach-note';
        n.textContent = note;
        card.appendChild(n);
      }
      if (c.earlier.length > 0) {
        const older = document.createElement('span');
        older.className = 'g-caption';
        older.textContent = `${c.earlier.length} earlier ${c.earlier.length === 1 ? 'version' : 'versions'} kept`;
        card.appendChild(older);
      }
      grid.appendChild(card);
    }
    return grid;
  }

  function renderSheet(): HTMLElement {
    const sheet = document.createElement('section');
    sheet.className = 'folio-sheet';
    sheet.dataset.testid = 'folio-sheet';
    const text = folioSheet(props.cards, conceptLabel);
    const h = document.createElement('h2');
    h.textContent = 'The Rulebook';
    sheet.appendChild(h);
    for (const line of text.split('\n').slice(2)) {
      const p = document.createElement('p');
      p.textContent = line;
      sheet.appendChild(p);
    }
    if (props.copy) {
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'pill';
      copy.dataset.testid = 'folio-copy';
      copy.textContent = 'Copy';
      copy.addEventListener('click', () => {
        void props.copy?.(text).then(
          () => (copy.textContent = 'Copied'),
          () => (copy.textContent = 'Select and copy'),
        );
      });
      sheet.appendChild(copy);
    }
    return sheet;
  }

  paint();
  return root;
}
