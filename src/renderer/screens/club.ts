import '../styles-club.css';
import type { Challenge } from '../../core/challengeCode.js';
import {
  addMember,
  addToNotebook,
  FROM_YOU,
  MAX_CLUB_NAME,
  MAX_MEMBER_NAME,
  MAX_NOTE,
  readCode,
  removeFromNotebook,
  removeMember,
  startClub,
  together,
} from '../../core/club/club.js';
import type { DayKey } from '../../core/localDay.js';
import type { ClubState, NotebookEntry } from '../../core/progression/types.js';
import { playable } from './challenge.js';
import { dayLabel } from './you.js';

/**
 * LAN CLUB — Play › LAN Club, over `progression.club` (core/club/club.ts). A standing group of friends: who is in
 * it, and the notebook of challenge codes they hand each other (the same hand, Math problem or puzzle for each of
 * them) with a note on what to talk through. A hand code replays the same deal, so the club reviews each other's
 * hands by playing them.
 *
 * Cooperative and local: the numbers are what the club has done together, never a person's score and never chips.
 * Nothing is locked and nothing touches the network; a code travels by hand.
 *
 * Sync for e2e: the root carries data-state ('new' | 'club'); the reader carries data-state ('empty' | 'valid' |
 * 'invalid'); each entry carries data-code and data-played.
 */

export interface ClubScreenOptions {
  readonly club: ClubState;
  readonly today: DayKey;
  readonly now: () => number;
  /** Persist the club (main keeps its session in step). */
  readonly save: (club: ClubState) => void;
  /** Play a notebook code: main marks it played and opens it as the challenge reader would. */
  readonly onPlay: (entry: NotebookEntry, challenge: Challenge) => void;
  /** Make a code to hand over (Play › Challenge a friend). */
  readonly onMakeCode: () => void;
  readonly onExit: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function pill(label: string, testid: string, kind: '' | 'primary' | 'quiet' = '', size: '' | 'sm' = ''): HTMLButtonElement {
  const b = el('button', ['pill', kind, size].filter(Boolean).join(' '), label);
  b.type = 'button';
  b.dataset.testid = testid;
  return b;
}

function input(testid: string, placeholder: string, label: string, maxLength: number): HTMLInputElement {
  const i = el('input', 'club-input');
  i.type = 'text';
  i.dataset.testid = testid;
  i.placeholder = placeholder;
  i.maxLength = maxLength;
  i.spellcheck = false;
  i.autocomplete = 'off';
  i.setAttribute('aria-label', label);
  return i;
}

function stat(value: number, label: string, testid: string): HTMLElement {
  const s = el('div', 'g-stat club-stat');
  s.dataset.testid = testid;
  s.append(el('span', 't-t3 g-num', String(value)), el('span', 'g-label', label));
  return s;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export function renderClubScreen(opts: ClubScreenOptions): HTMLElement {
  let club = opts.club;
  const root = el('div', 'home-screen club-screen');
  root.dataset.testid = 'club-screen';

  const save = (next: ClubState): void => {
    if (next === club) return;
    club = next;
    opts.save(next);
    paint();
  };

  function paint(): void {
    root.dataset.state = club.name === null ? 'new' : 'club';
    root.replaceChildren(...(club.name === null ? setup() : [left(), right()]));
  }

  function back(): HTMLButtonElement {
    const b = pill('Back', 'club-back', 'quiet', 'sm');
    b.classList.add('club-back');
    b.addEventListener('click', opts.onExit);
    return b;
  }

  /** No club yet: name it. */
  function setup(): HTMLElement[] {
    const col = el('div', 'home-col club-col');
    const h = el('h1', 't-t2 habit-flush', 'LAN Club');
    const sub = el(
      'p',
      'g-sub habit-flush',
      'A club is the friends you hand challenge codes to: the same hand, Math problem or puzzle for each of you, and a note on what to talk through. It counts what you do together, never chips. Nothing is locked, and nothing leaves this computer.',
    );
    const form = el('div', 'g-group club-form');
    form.dataset.testid = 'club-setup';
    const nameIn = input('club-name', 'Thursday table', 'Club name', MAX_CLUB_NAME);
    const start = pill('Start the club', 'club-start', 'primary');
    const go = (): void => {
      const next = startClub(club, nameIn.value, opts.today);
      if (next === club) nameIn.focus();
      else save(next);
    };
    start.addEventListener('click', go);
    nameIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
    const row = el('label', 'club-row');
    row.append(el('span', 'club-row-text', 'Club name'), nameIn, start);
    form.appendChild(row);
    col.append(h, sub, form, back());
    return [col];
  }

  function left(): HTMLElement {
    const col = el('div', 'home-col club-col');
    const t = together(club);
    const h = el('h1', 't-t2 habit-flush', club.name ?? 'LAN Club');
    h.dataset.testid = 'club-title';
    const sub = el(
      'p',
      'g-sub habit-flush',
      `Since ${club.since !== null ? dayLabel(club.since) : 'today'}. Hand a friend a code, play theirs, and talk the spot through. Counted together, never chips.`,
    );
    const strip = el('div', 'club-stats');
    strip.dataset.testid = 'club-together';
    strip.append(
      stat(t.members, 'Members', 'club-together-members'),
      stat(t.codes, 'Codes shared', 'club-together-codes'),
      stat(t.fromFriends, 'From friends', 'club-together-friends'),
      stat(t.played, 'Played', 'club-together-played'),
    );
    const togetherSect = el('section', 'club-together');
    togetherSect.append(el('div', 'g-label', 'Together'), strip);
    col.append(h, sub, togetherSect, members(), back());
    return col;
  }

  function members(): HTMLElement {
    const sect = el('section', 'club-members');
    sect.dataset.testid = 'club-members';
    sect.appendChild(el('div', 'g-label', 'Members'));
    const list = el('div', 'club-chips');
    for (const m of club.members) {
      const chip = el('span', 'club-chip');
      chip.dataset.testid = 'club-member';
      chip.dataset.name = m.name;
      const x = el('button', 'club-chip-x', '×');
      x.type = 'button';
      x.setAttribute('aria-label', `Remove ${m.name}`);
      x.addEventListener('click', () => save(removeMember(club, m.name)));
      chip.append(el('span', '', m.name), x);
      list.appendChild(chip);
    }
    const add = input('club-member-name', 'Add a name', 'Add a member', MAX_MEMBER_NAME);
    add.classList.add('club-chip-input');
    add.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save(addMember(club, add.value, opts.today));
    });
    list.appendChild(add);
    sect.appendChild(list);
    return sect;
  }

  function right(): HTMLElement {
    const side = el('div', 'home-side club-side');
    const sect = el('section', 'club-notebook');
    const head = el('div', 'club-head');
    const make = pill('Make a code', 'club-make', 'primary', 'sm');
    make.addEventListener('click', opts.onMakeCode);
    head.append(el('div', 'g-label', 'Notebook'), make);
    sect.append(head, reader(), entries());
    side.appendChild(sect);
    return side;
  }

  function reader(): HTMLElement {
    const box = el('div', 'g-group club-reader');
    box.dataset.testid = 'club-reader';
    box.dataset.state = 'empty';
    const code = input('club-code', 'OS-XXXX-XXXX-XXXX', 'A code from a friend', 96);
    code.classList.add('g-num');
    const from = el('select', 'club-select');
    from.dataset.testid = 'club-code-from';
    from.setAttribute('aria-label', 'From');
    for (const n of [FROM_YOU, ...club.members.map((m) => m.name)]) {
      const o = el('option', '', n);
      o.value = n;
      from.appendChild(o);
    }
    const note = input('club-code-note', 'What to talk through (optional)', 'A note', MAX_NOTE);
    const add = pill('Add', 'club-code-add');
    add.disabled = true;
    const notice = el('p', 'g-caption club-reader-note');
    notice.dataset.testid = 'club-code-notice';
    notice.setAttribute('role', 'status');
    const hint = 'A hand, Math problem or puzzle code a friend handed over.';
    notice.textContent = hint;
    code.addEventListener('input', () => {
      const text = code.value.trim();
      if (text === '') {
        box.dataset.state = 'empty';
        add.disabled = true;
        notice.textContent = hint;
        return;
      }
      const r = readCode(text, playable);
      box.dataset.state = r.ok ? 'valid' : 'invalid';
      add.disabled = !r.ok;
      notice.textContent = r.ok ? r.line : r.reason;
    });
    add.addEventListener('click', () => {
      const r = readCode(code.value, playable);
      if (r.ok) save(addToNotebook(club, { code: r.code, from: from.value, note: note.value }, opts.now()));
    });
    const row1 = el('div', 'club-row');
    row1.append(code, from);
    const row2 = el('div', 'club-row');
    row2.append(note, add);
    box.append(row1, row2, notice);
    return box;
  }

  function entries(): HTMLElement {
    const list = el('div', 'g-group club-entries');
    list.dataset.testid = 'club-entries';
    const all = [...club.notebook].reverse();
    if (all.length === 0) {
      const empty = el('p', 'g-caption club-empty', 'Codes friends hand over land here. Make one of yours with Make a code.');
      empty.dataset.testid = 'club-notebook-empty';
      list.appendChild(empty);
    }
    for (const entry of all) {
      const r = readCode(entry.code, playable);
      const row = el('div', 'club-entry');
      row.dataset.testid = 'club-entry';
      row.dataset.code = entry.code;
      row.dataset.played = String(entry.playedOn !== null);
      const text = el('span', 'club-entry-text');
      const meta = [`From ${entry.from}`, entry.playedOn !== null ? `Played ${dayLabel(entry.playedOn)}` : ''].filter(Boolean).join(' · ');
      text.append(el('span', 'club-entry-line', r.ok ? r.line : 'A code this version cannot open.'), el('span', 'g-caption', meta));
      if (entry.note) text.appendChild(el('span', 'g-caption club-entry-note', `“${entry.note}”`));
      const open = pill('Play', 'club-entry-play', '', 'sm');
      open.disabled = !r.ok;
      open.addEventListener('click', () => {
        if (r.ok) opts.onPlay(entry, r.challenge);
      });
      const x = el('button', 'club-chip-x', '×');
      x.type = 'button';
      x.setAttribute('aria-label', 'Remove from the notebook');
      x.addEventListener('click', () => save(removeFromNotebook(club, entry.at)));
      row.append(text, open, x);
      list.appendChild(row);
    }
    return list;
  }

  paint();
  return root;
}
