import '../styles-club.css';
import type { Challenge } from '../../core/challengeCode.js';
import {
  addMember,
  addToNotebook,
  FROM_YOU,
  readAnyCode,
  removeFromNotebook,
  removeMember,
  setTableName,
  startClub,
  tableNameOf,
  together,
  upsertNight,
} from '../../core/club/club.js';
import { decodeClubCode, describeClubCode, encodeClubCode, nightIdOf, streetOf, type SharedSpot } from '../../core/club/codes.js';
import {
  addFriendRecap,
  decisionKey,
  endNight,
  gradeShared,
  observeView,
  pooledNight,
  recapOf,
  recordDecision,
  spotFromView,
  startNight,
  type NightRecord,
  type Pooled,
} from '../../core/club/gameNight.js';
import type { DayKey } from '../../core/localDay.js';
import type { RoomView } from '../../core/multiplayer.js';
import type { ClubState, NotebookEntry } from '../../core/progression/types.js';
import type { Action, ActionKind } from '../../core/table.js';
import { renderCardRow } from '../components/card.js';
import { renderDee } from '../components/dee.js';
import { renderQrCode } from '../components/qrCode.js';
import type { NightHooks } from './multiplayer.js';
import { dayLabel } from './you.js';

/**
 * LAN CLUB and HOME GAME NIGHT — Play → LAN Club. Four views over `progression.club` (core/club/):
 * - the club: who is in it, the Game Night launcher, the shared notebook of codes, and past nights;
 * - the night bar over the LAN table (screens/multiplayer.ts with NightHooks): the night's counts so far;
 * - the recap: this player's counts, a recap code for the others, the table pooled from the codes pasted
 *   in, the costliest spots to review together, and the people at the table;
 * - a spot from the notebook: commit an answer, then see the grade and what the sharer chose.
 *
 * Cooperative and scored on decisions: every number here is a count of decisions or their quality, pooled
 * when it is more than one person's. No chip count, no ranking, nothing locked. Codes are the only thing that
 * travels, by hand; the relay protocol is the one LAN play already speaks.
 *
 * Sync for e2e: each root has a data-testid; the notebook reader carries data-state ('empty' | 'valid' |
 * 'invalid'), the night bar data-decisions and data-hands, the spot view data-answered.
 */

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

function stat(value: string, label: string, testid: string): HTMLElement {
  const s = el('div', 'g-stat club-stat');
  s.dataset.testid = testid;
  s.append(el('span', 't-t3 g-num', value), el('span', 'g-label', label));
  return s;
}

export const pct = (rate: number | null): string => (rate === null ? '–' : `${Math.round(rate * 100)}%`);
const bb100 = (v: number | null): string => (v === null ? '–' : v.toFixed(1));
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The pooled counts as one stat strip: the same four on the club, the recap's "you" and its "table". */
function statStrip(p: Pick<Pooled, 'hands' | 'decisions' | 'cleanRate' | 'bbPer100'>, testid: string): HTMLElement {
  const strip = el('div', 'club-stats');
  strip.dataset.testid = testid;
  strip.append(
    stat(String(p.hands), 'Hands', `${testid}-hands`),
    stat(String(p.decisions), 'Decisions graded', `${testid}-decisions`),
    stat(pct(p.cleanRate), 'Clean', `${testid}-clean`),
    stat(bb100(p.bbPer100), 'bb lost per 100', `${testid}-bb100`),
  );
  return strip;
}

// ── The club ────────────────────────────────────────────────────────────────

export interface ClubScreenOptions {
  readonly club: ClubState;
  readonly displayName: string | null;
  readonly today: DayKey;
  readonly now: () => number;
  /** Persist the club (main keeps its session in step). */
  readonly save: (club: ClubState) => void;
  readonly onHostNight: (seatCount: number) => void;
  readonly onJoinNight: (invite: string) => void;
  readonly onOpenNight: (night: string) => void;
  readonly onOpenSpot: (entry: NotebookEntry) => void;
  readonly onOpenChallenge: (challenge: Challenge) => void;
  readonly onExit: () => void;
}

export function renderClubScreen(opts: ClubScreenOptions): HTMLElement {
  let club = opts.club;
  const root = el('div', 'home-screen club-screen');
  root.dataset.testid = 'club-screen';

  const save = (next: ClubState): void => {
    club = next;
    opts.save(next);
    paint();
  };

  function paint(): void {
    root.dataset.state = club.name === null ? 'new' : 'club';
    root.replaceChildren(...(club.name === null ? setup() : [left(), right()]));
  }

  /** No club yet: name it and the name you sit down under. */
  function setup(): HTMLElement[] {
    const col = el('div', 'home-col club-col');
    const h = el('h1', 't-t2 habit-flush', 'LAN Club');
    const sub = el(
      'p',
      'g-sub habit-flush',
      'A club is the people who play Game Nights together on your local network. It counts decisions, together, never chips. Nothing is locked, and nothing leaves this computer but the table you host or join.',
    );
    const form = el('div', 'g-group club-form');
    form.dataset.testid = 'club-setup';
    const nameIn = input('club-name', 'Thursday table', 'Club name', 32);
    const tableIn = input('club-table-name', tableNameOf(club, opts.displayName), 'Your name at the table', 16);
    tableIn.value = club.tableName ?? '';
    const start = pill('Start the club', 'club-start', 'primary');
    start.addEventListener('click', () => {
      let next = startClub(club, nameIn.value, opts.today);
      if (next === club) {
        nameIn.focus();
        return;
      }
      if (tableIn.value.trim() !== '') next = setTableName(next, tableIn.value);
      save(next);
    });
    form.append(labelled('Club name', nameIn), labelled('Your name at the table', tableIn), rowOf(start));
    const back = pill('Back', 'club-back', 'quiet', 'sm');
    back.classList.add('club-back');
    back.addEventListener('click', opts.onExit);
    col.append(h, sub, form, back);
    return [col];
  }

  function left(): HTMLElement {
    const col = el('div', 'home-col club-col');
    const you = tableNameOf(club, opts.displayName);
    const t = together(club, you);
    const h = el('h1', 't-t2 habit-flush', club.name ?? 'LAN Club');
    h.dataset.testid = 'club-title';
    const sub = el(
      'p',
      'g-sub habit-flush',
      `${plural(club.members.length, 'member')} · ${plural(t.nights, 'Game Night')} · ${plural(t.reviewed, 'spot')} reviewed together. Counted on decisions, never chips.`,
    );

    // The launcher: host (the one primary on the screen) or join with an invite link.
    const launch = el('div', 'g-group club-launch');
    launch.dataset.testid = 'club-launch';
    const hostRow = el('div', 'club-row');
    const seats = el('select', 'club-select');
    seats.dataset.testid = 'club-seat-count';
    seats.setAttribute('aria-label', 'Players');
    for (const n of [2, 3, 4, 5, 6]) {
      const o = el('option', '', String(n));
      o.value = String(n);
      o.selected = n === Math.min(6, Math.max(2, club.members.length + 1));
      seats.appendChild(o);
    }
    const host = pill('Host a Game Night', 'club-host', 'primary');
    host.addEventListener('click', () => opts.onHostNight(Number(seats.value)));
    hostRow.append(el('span', 'club-row-text', 'Players'), seats, host);
    const joinRow = el('div', 'club-row');
    const invite = input('club-join-invite', 'Invite link (offsuit://join?…)', 'Invite link', 400);
    const join = pill('Join', 'club-join');
    join.addEventListener('click', () => {
      if (invite.value.trim() !== '') opts.onJoinNight(invite.value.trim());
    });
    joinRow.append(invite, join);
    const nameRow = el('div', 'club-row');
    const nameIn = input('club-table-name', 'Your name at the table', 'Your name at the table', 16);
    nameIn.value = you;
    const keep = pill('Keep', 'club-table-name-save', 'quiet', 'sm');
    keep.addEventListener('click', () => save(setTableName(club, nameIn.value)));
    nameRow.append(el('span', 'club-row-text', 'Sit as'), nameIn, keep);
    launch.append(hostRow, joinRow, nameRow);

    const togetherSect = el('section', 'club-together');
    togetherSect.append(el('div', 'g-label', 'Together'), statStrip(t, 'club-together'));

    const back = pill('Back', 'club-back', 'quiet', 'sm');
    back.classList.add('club-back');
    back.addEventListener('click', opts.onExit);
    col.append(h, sub, togetherSect, launch, members(), back);
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
    const add = input('club-member-name', 'Add a name', 'Add a member', 16);
    add.classList.add('club-chip-input');
    add.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      save(addMember(club, add.value, opts.today));
    });
    list.appendChild(add);
    sect.appendChild(list);
    return sect;
  }

  function right(): HTMLElement {
    const side = el('div', 'home-side club-side');
    side.append(notebook(), nights());
    return side;
  }

  function notebook(): HTMLElement {
    const sect = el('section', 'club-notebook');
    sect.appendChild(el('div', 'g-label', 'Notebook'));
    const reader = el('div', 'g-group club-reader');
    reader.dataset.testid = 'club-reader';
    reader.dataset.state = 'empty';
    const code = input('club-code', 'OS-XXXX-XXXX-…', 'A code from a friend', 96);
    code.classList.add('g-num');
    const from = el('select', 'club-select');
    from.dataset.testid = 'club-code-from';
    from.setAttribute('aria-label', 'From');
    for (const n of [FROM_YOU, ...club.members.map((m) => m.name)]) {
      const o = el('option', '', n);
      o.value = n;
      from.appendChild(o);
    }
    const add = pill('Add', 'club-code-add');
    add.disabled = true;
    const note = el('p', 'g-caption club-reader-note');
    note.dataset.testid = 'club-code-notice';
    note.setAttribute('role', 'status');
    note.textContent = 'A spot, a recap or a challenge code a friend handed over.';
    const read = (): void => {
      const text = code.value.trim();
      if (text === '') {
        reader.dataset.state = 'empty';
        add.disabled = true;
        note.textContent = 'A spot, a recap or a challenge code a friend handed over.';
        return;
      }
      const r = readAnyCode(text);
      reader.dataset.state = r.ok ? 'valid' : 'invalid';
      add.disabled = !r.ok;
      note.textContent = r.ok ? r.line : r.reason;
    };
    code.addEventListener('input', read);
    add.addEventListener('click', () => {
      const r = readAnyCode(code.value);
      if (!r.ok) return;
      if (r.kind === 'club' && r.code.kind === 'recap') {
        // A recap belongs to its night, not the notebook.
        const recap = r.code.recap;
        const night = club.nights.find((n) => n.night === recap.night);
        if (night === undefined) {
          reader.dataset.state = 'invalid';
          note.textContent = 'That recap is from a Game Night this computer did not sit in.';
          return;
        }
        const added = addFriendRecap(night, recap, tableNameOf(club, opts.displayName));
        if (!added.ok) {
          reader.dataset.state = 'invalid';
          note.textContent = added.reason;
          return;
        }
        save(upsertNight(club, added.night));
        return;
      }
      save(addToNotebook(club, { code: r.text, from: from.value, note: '' }, opts.now()));
    });
    const row = el('div', 'club-row');
    row.append(code, from, add);
    reader.append(row, note);

    const list = el('div', 'g-group club-entries');
    list.dataset.testid = 'club-entries';
    const entries = [...club.notebook].reverse();
    if (entries.length === 0) {
      const empty = el('p', 'g-caption club-empty', 'Spots from a Game Night recap land here, with any code a friend hands over.');
      empty.dataset.testid = 'club-notebook-empty';
      list.appendChild(empty);
    }
    for (const entry of entries) list.appendChild(entryRow(entry));
    sect.append(reader, list);
    return sect;
  }

  function entryRow(entry: NotebookEntry): HTMLElement {
    const row = el('div', 'club-entry');
    row.dataset.testid = 'club-entry';
    row.dataset.code = entry.code;
    const r = readAnyCode(entry.code);
    const text = el('span', 'club-entry-text');
    text.append(
      el('span', 'club-entry-line', r.ok ? r.line : 'A code this version cannot open.'),
      el('span', 'g-caption', [`From ${entry.from}`, entry.note, entry.answer !== null ? `Played: ${entry.answer}` : ''].filter(Boolean).join(' · ')),
    );
    const open = pill(entry.answer !== null ? 'Review' : 'Play', 'club-entry-open', '', 'sm');
    open.disabled = !r.ok;
    open.addEventListener('click', () => {
      if (!r.ok) return;
      if (r.kind === 'challenge') opts.onOpenChallenge(r.challenge);
      else opts.onOpenSpot(entry);
    });
    const x = el('button', 'club-chip-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Remove from the notebook');
    x.addEventListener('click', () => save(removeFromNotebook(club, entry.at)));
    row.append(text, open, x);
    return row;
  }

  function nights(): HTMLElement {
    const sect = el('section', 'club-nights');
    sect.appendChild(el('div', 'g-label', 'Game Nights'));
    const list = el('div', 'g-group club-night-list');
    list.dataset.testid = 'club-nights';
    const you = tableNameOf(club, opts.displayName);
    const recent = [...club.nights].reverse();
    if (recent.length === 0) list.appendChild(el('p', 'g-caption club-empty', 'Host one, or join a friend’s with their invite link.'));
    for (const n of recent) {
      const p = pooledNight(n, you);
      const row = el('button', 'g-row club-night');
      row.type = 'button';
      row.dataset.testid = 'club-night';
      row.dataset.night = n.night;
      const t = el('span', 'club-entry-text');
      t.append(
        el('span', 'club-entry-line', `${dayLabel(n.day)} · ${n.role === 'host' ? 'hosted' : 'joined'}`),
        el('span', 'g-caption', `${plural(p.players, 'player')} shared · ${plural(p.decisions, 'decision')} · ${pct(p.cleanRate)} clean`),
      );
      row.appendChild(t);
      row.addEventListener('click', () => opts.onOpenNight(n.night));
      list.appendChild(row);
    }
    sect.appendChild(list);
    return sect;
  }

  paint();
  return root;
}

function labelled(text: string, control: HTMLElement): HTMLElement {
  const l = el('label', 'club-row club-labelled');
  l.append(el('span', 'club-row-text', text), control);
  return l;
}

function rowOf(...children: HTMLElement[]): HTMLElement {
  const r = el('div', 'club-row club-row-end');
  r.append(...children);
  return r;
}

// ── The night ───────────────────────────────────────────────────────────────

export interface NightControllerOptions {
  readonly role: 'host' | 'join';
  readonly start: NightHooks['start'];
  readonly name: string;
  readonly clubName: string;
  readonly today: DayKey;
  readonly now: () => number;
  /** Dee's mark on the bar (the character setting). */
  readonly dee: boolean;
  readonly club: () => ClubState;
  readonly save: (club: ClubState) => void;
  /** The night ended: open its recap. */
  readonly onEnded: (night: string) => void;
}

/**
 * One Game Night's bookkeeping over the LAN table. Grades each of this player's own decisions from the view it
 * was made on (after the action has gone, so grading never delays play), counts hands as they end, and saves at
 * each hand's end and when the night ends.
 */
export interface NightController extends NightHooks {
  /** Save the night as it stands. */
  readonly flush: () => void;
  /** The table has been left: the night can only be ended now. */
  readonly stopped: () => boolean;
  /** End the night (once) and save it; the night id, or null when no table was ever reached. */
  readonly end: () => string | null;
  /** The LAN table screen, kept across re-renders so a repaint never restarts the table. */
  mount: HTMLElement | null;
}

export function createNightController(o: NightControllerOptions): NightController {
  let record: NightRecord | null = null;
  let left = false;
  const decided = new Set<string>();
  let bar: HTMLElement | null = null;

  const flush = (): void => {
    if (record !== null) o.save(upsertNight(o.club(), record));
  };

  function refresh(): void {
    if (bar === null) return;
    bar.dataset.decisions = String(record?.decisions ?? 0);
    bar.dataset.hands = String(record?.hands ?? 0);
    const counts = bar.querySelector('[data-testid="night-counts"]');
    if (counts) {
      counts.textContent = record === null
        ? 'Waiting for the table'
        : `${plural(record.hands, 'hand')} · ${plural(record.decisions, 'decision')} graded · ${pct(record.decisions > 0 ? record.clean / record.decisions : null)} clean`;
    }
  }

  function finish(): string | null {
    if (record === null) return null;
    record = endNight(record, o.now());
    flush();
    return record.night;
  }

  return {
    name: o.name,
    start: o.start,
    mount: null,
    stopped: () => left,
    end: finish,
    onStopped(): void {
      left = true;
      flush();
    },
    onTable(fingerprint: string): void {
      const id = nightIdOf(fingerprint);
      // Rejoining the same table carries on the same night.
      record = o.club().nights.find((n) => n.night === id && n.endedAt === null) ?? startNight(id, o.today, o.role, o.now());
      flush();
      refresh();
    },
    onView(view: RoomView): void {
      if (record === null) return;
      const before = record.hands;
      record = observeView(record, view);
      if (record.hands !== before) flush();
      refresh();
    },
    onAction(view: RoomView, action: Action): void {
      if (record === null) return;
      const key = decisionKey(view);
      if (decided.has(key)) return;
      const spot = spotFromView(view, action);
      if (spot === null) return;
      decided.add(key);
      setTimeout(() => {
        if (record === null) return;
        record = recordDecision(record, spot, gradeShared(spot, action.kind));
        refresh();
      }, 0);
    },
    bar(end: () => void): HTMLElement {
      const b = el('div', 'club-night-bar');
      b.dataset.testid = 'night-bar';
      if (o.dee) {
        const mark = renderDee('rest', 28);
        mark.classList.add('club-night-dee');
        b.appendChild(mark);
      }
      const t = el('span', 'club-entry-text');
      const counts = el('span', 'g-caption g-num');
      counts.dataset.testid = 'night-counts';
      t.append(el('span', 'club-entry-line', `${o.clubName} · sitting as ${o.name}`), counts);
      const stop = pill('End the night', 'night-end', '', 'sm');
      stop.addEventListener('click', () => {
        end();
        // A last decision still being graded lands before the night closes.
        setTimeout(() => o.onEnded(finish() ?? ''), 0);
      });
      b.append(t, stop);
      bar = b;
      refresh();
      return b;
    },
    flush,
  };
}

// ── The recap ───────────────────────────────────────────────────────────────

export interface RecapOptions {
  readonly night: NightRecord;
  readonly club: ClubState;
  readonly displayName: string | null;
  readonly now: () => number;
  readonly save: (club: ClubState) => void;
  readonly onReviewSpot: (entry: NotebookEntry) => void;
  readonly onDone: () => void;
}

export function renderNightRecap(opts: RecapOptions): HTMLElement {
  let club = opts.club;
  let night = opts.night;
  const you = tableNameOf(club, opts.displayName);
  const root = el('div', 'home-screen club-screen club-recap');
  root.dataset.testid = 'night-recap';
  let notice = '';
  let noticeBad = false;

  const save = (next: ClubState): void => {
    club = next;
    night = next.nights.find((n) => n.night === night.night) ?? night;
    opts.save(next);
    paint();
  };

  function paint(): void {
    root.replaceChildren(left(), right());
  }

  function left(): HTMLElement {
    const col = el('div', 'home-col club-col');
    const h = el('h1', 't-t2 habit-flush', 'Game Night recap');
    const sub = el('p', 'g-sub habit-flush', `${dayLabel(night.day)} · ${club.name ?? 'LAN Club'} · ${night.role === 'host' ? 'hosted' : 'joined'} as ${you}. Graded on the decisions, never the chips.`);
    const mine = recapOf(night, you);
    const own = el('section', 'club-own');
    own.append(el('div', 'g-label', 'Your night'), statStrip(pooledOf(mine), 'recap-you'));

    const share = el('section', 'g-group club-share');
    share.dataset.testid = 'recap-share';
    const code = encodeClubCode({ kind: 'recap', recap: mine });
    share.dataset.code = code;
    const text = el('div', 'club-share-text');
    const codeEl = el('code', 'club-code g-num', code);
    codeEl.dataset.testid = 'recap-code';
    text.append(el('span', 'g-label', 'Your recap code'), codeEl, el('span', 'g-caption', 'Read it out, or let a friend scan it. It carries these four counts and your table name, nothing else.'));
    const qr = el('div', 'club-qr');
    qr.appendChild(renderQrCode(code, { label: 'Your recap code', ecl: 'L', testid: 'recap-qr' }));
    share.append(text, qr);

    const done = pill('Back to the club', 'recap-done', 'quiet', 'sm');
    done.classList.add('club-back');
    done.addEventListener('click', opts.onDone);
    col.append(h, sub, own, share, done);
    return col;
  }

  function right(): HTMLElement {
    const side = el('div', 'home-side club-side');

    // The table, pooled: you and everyone whose code is in. Never per person.
    const table = el('section', 'club-table');
    table.dataset.testid = 'recap-table';
    const pooled = pooledNight(night, you);
    table.dataset.players = String(pooled.players);
    const who = [you, ...night.friends.map((f) => f.name)].join(', ');
    table.append(el('div', 'g-label', `The table · ${who}`), statStrip(pooled, 'recap-table'));
    const reader = el('div', 'g-group club-reader');
    reader.dataset.testid = 'recap-reader';
    reader.dataset.state = notice === '' ? 'empty' : noticeBad ? 'invalid' : 'valid';
    const codeIn = input('recap-friend-code', 'A friend’s recap code', 'A friend’s recap code', 96);
    codeIn.classList.add('g-num');
    const add = pill('Add', 'recap-friend-add');
    add.addEventListener('click', () => {
      const r = decodeClubCode(codeIn.value);
      if (!r.ok || r.code.kind !== 'recap') {
        notice = r.ok ? 'That is a spot, not a recap. Add it to the notebook from the club.' : 'That code does not check out. A character is probably mistyped.';
        noticeBad = true;
        paint();
        return;
      }
      const added = addFriendRecap(night, r.code.recap, you);
      if (!added.ok) {
        notice = added.reason;
        noticeBad = true;
        paint();
        return;
      }
      notice = `${r.code.recap.name} is in.`;
      noticeBad = false;
      save(upsertNight(club, added.night));
    });
    const row = el('div', 'club-row');
    row.append(codeIn, add);
    const n = el('p', 'g-caption club-reader-note', notice || 'Each friend’s recap code adds their counts to the table’s.');
    n.dataset.testid = 'recap-notice';
    n.setAttribute('role', 'status');
    reader.append(row, n);
    table.appendChild(reader);

    // The costliest spots, to review together.
    const spots = el('section', 'club-spots');
    spots.appendChild(el('div', 'g-label', 'Spots to look at together'));
    const list = el('div', 'g-group club-entries');
    list.dataset.testid = 'recap-spots';
    if (night.spots.length === 0) list.appendChild(el('p', 'g-caption club-empty', 'No decision tonight cost anything the grader would name.'));
    for (const s of night.spots) {
      const decoded = decodeClubCode(s.code);
      const row2 = el('div', 'club-entry');
      row2.dataset.testid = 'recap-spot';
      const t = el('span', 'club-entry-text');
      t.append(el('span', 'club-entry-line', decoded.ok ? describeClubCode(decoded.code) : 'A spot'), el('span', 'g-caption g-num', s.code));
      const inBook = club.notebook.find((e) => e.code === s.code);
      const b = inBook ? pill('Play it', 'recap-spot-play', '', 'sm') : pill('Add to notebook', 'recap-spot-add', '', 'sm');
      b.addEventListener('click', () => {
        if (inBook) opts.onReviewSpot(inBook);
        else save(addToNotebook(club, { code: s.code, from: FROM_YOU, note: '' }, opts.now()));
      });
      row2.append(t, b);
      list.appendChild(row2);
    }
    spots.appendChild(list);

    // The people at the table who are not in the club yet.
    const seen = el('section', 'club-seen');
    seen.dataset.testid = 'recap-seen';
    seen.appendChild(el('div', 'g-label', 'At the table'));
    const chips = el('div', 'club-chips');
    if (night.seen.length === 0) chips.appendChild(el('span', 'g-caption', 'Nobody else sat down.'));
    for (const name of night.seen) {
      const member = club.members.some((m) => m.name === name);
      const chip = el('span', 'club-chip');
      chip.dataset.testid = 'recap-seen-name';
      chip.dataset.name = name;
      chip.appendChild(el('span', '', name));
      if (!member) {
        const plus = el('button', 'club-chip-x', '+');
        plus.type = 'button';
        plus.dataset.testid = 'recap-seen-add';
        plus.setAttribute('aria-label', `Add ${name} to the club`);
        plus.addEventListener('click', () => save(addMember(club, name, night.day)));
        chip.appendChild(plus);
      }
      chips.appendChild(chip);
    }
    seen.appendChild(chips);

    side.append(table, spots, seen);
    return side;
  }

  paint();
  return root;
}

function pooledOf(r: { hands: number; decisions: number; clean: number; lossCentiBb: number }): Pick<Pooled, 'hands' | 'decisions' | 'cleanRate' | 'bbPer100'> {
  return {
    hands: r.hands,
    decisions: r.decisions,
    cleanRate: r.decisions > 0 ? r.clean / r.decisions : null,
    bbPer100: r.decisions > 0 ? Math.round((r.lossCentiBb / r.decisions) * 10) / 10 : null,
  };
}

// ── A spot from the notebook ────────────────────────────────────────────────

export interface SpotOptions {
  readonly entry: NotebookEntry;
  readonly spot: SharedSpot;
  readonly onAnswer: (kind: ActionKind) => void;
  readonly onBack: () => void;
}

const ACTION_LABEL: Record<ActionKind, string> = { fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise', allin: 'All in' };

/** The choices a spot offers: facing a price, fold, call or raise; checked to, check or bet. */
export function spotChoices(spot: SharedSpot): ActionKind[] {
  return spot.toCall > 0 ? ['fold', 'call', 'raise'] : ['check', 'bet'];
}

export function renderClubSpot(opts: SpotOptions): HTMLElement {
  const { spot, entry } = opts;
  let answer: ActionKind | null = (entry.answer as ActionKind | null) ?? null;
  const root = el('div', 'home-screen club-screen club-spot');
  root.dataset.testid = 'club-spot';

  function paint(): void {
    root.dataset.answered = String(answer !== null);
    const col = el('div', 'home-col club-col');
    const from = entry.from === FROM_YOU ? 'A spot of yours' : `A spot from ${entry.from}`;
    col.append(
      el('h1', 't-t2 habit-flush', from),
      el('p', 'g-sub habit-flush', `${streetOf(spot)[0].toUpperCase()}${streetOf(spot).slice(1)}, ${spot.opponents} still in. Your play first, then the grade and what was chosen at the table.`),
    );
    const cards = el('div', 'club-spot-cards');
    const hole = renderCardRow([...spot.hole]);
    hole.dataset.testid = 'club-spot-hole';
    const board = renderCardRow(spot.board.length ? [...spot.board] : [null, null, null], { small: true });
    board.dataset.testid = 'club-spot-board';
    cards.append(hole, board);
    const facts = el('div', 'club-stats');
    facts.append(
      stat(String(spot.pot), 'Pot', 'club-spot-pot'),
      stat(String(spot.toCall), 'To call', 'club-spot-tocall'),
      stat(String(spot.stack), 'Stack', 'club-spot-stack'),
      stat(`${Math.round(spot.bb)}`, 'Big blind', 'club-spot-bb'),
    );
    const actions = el('div', 'club-row club-spot-actions');
    for (const kind of spotChoices(spot)) {
      const b = pill(ACTION_LABEL[kind], `club-spot-${kind}`, '', '');
      b.dataset.selected = String(answer === kind);
      b.addEventListener('click', () => {
        answer = kind;
        opts.onAnswer(kind);
        paint();
      });
      actions.appendChild(b);
    }
    const back = pill('Back to the club', 'club-spot-back', 'quiet', 'sm');
    back.classList.add('club-back');
    back.addEventListener('click', opts.onBack);
    col.append(cards, facts, actions, back);

    const side = el('div', 'home-side club-side');
    const verdict = el('section', 'g-sect club-verdict');
    verdict.dataset.testid = 'club-spot-verdict';
    if (answer === null) {
      verdict.appendChild(el('p', 'g-caption', 'The grade and the table’s choice show once you play.'));
    } else {
      verdict.append(gradeBlock('Your play', answer, spot));
      if (spot.chosen !== null) {
        const theirs = gradeBlock(entry.from === FROM_YOU ? 'At the table' : `${entry.from} at the table`, spot.chosen, spot);
        theirs.dataset.testid = 'club-spot-theirs';
        verdict.append(theirs);
      }
    }
    side.appendChild(verdict);
    root.replaceChildren(col, side);
  }

  paint();
  return root;
}

function gradeBlock(label: string, kind: ActionKind, spot: SharedSpot): HTMLElement {
  const g = gradeShared(spot, kind);
  const b = el('div', 'club-grade');
  b.dataset.clean = String(g.clean);
  b.append(
    el('span', 'g-label', `${label}: ${ACTION_LABEL[kind]}`),
    el('span', `t-head${g.clean ? '' : ' club-cost'}`, g.clean ? 'Clean: nothing the grader would name.' : `${g.lossBb.toFixed(1)} bb against the grader’s play.`),
  );
  if (g.message) b.appendChild(el('span', 'g-caption', g.message));
  return b;
}
