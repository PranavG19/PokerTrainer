/**
 * LAN CLUB — a standing local group of friends who hand each other challenge codes and talk them through. Pure
 * reducers over `progression.club` (progression/types.ts ClubState).
 *
 * COOPERATIVE AND LOCAL. A code is the whole message (core/challengeCode.ts): the same hand deal, Math problem or
 * puzzle for whoever types it in, read aloud, pasted or scanned. Nothing here touches the network, ranks a member or
 * reads a chip. The club's numbers are what it has done together: members, codes shared, codes played.
 */

import { CHALLENGE_ERROR_TEXT, decodeChallenge, describeChallenge, encodeChallenge, type Challenge } from '../challengeCode.js';
import type { DayKey } from '../localDay.js';
import { MAX_CLUB_MEMBERS, MAX_NOTEBOOK } from '../progression/persist.js';
import type { ClubState, NotebookEntry } from '../progression/types.js';

/** A club name, a member's name, a note. */
export const MAX_CLUB_NAME = 32;
export const MAX_MEMBER_NAME = 24;
export const MAX_NOTE = 140;
/** Who a notebook entry came from when it is this player's own. */
export const FROM_YOU = 'You';

/** Names are trimmed and single-spaced, with no control characters, cut on whole graphemes. */
export function cleanName(raw: string, max: number = MAX_MEMBER_NAME): string {
  const s = raw.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((g) => g.segment);
  return graphemes.slice(0, max).join('').trim();
}

export function startClub(c: ClubState, rawName: string, day: DayKey): ClubState {
  const n = cleanName(rawName, MAX_CLUB_NAME);
  if (n === '') return c;
  return { ...c, name: n, since: c.since ?? day };
}

export function addMember(c: ClubState, raw: string, day: DayKey): ClubState {
  const n = cleanName(raw);
  if (n === '' || n === FROM_YOU || c.members.some((m) => m.name === n) || c.members.length >= MAX_CLUB_MEMBERS) return c;
  return { ...c, members: [...c.members, { name: n, since: day }] };
}

export function removeMember(c: ClubState, n: string): ClubState {
  return { ...c, members: c.members.filter((m) => m.name !== n) };
}

export type ReadCode =
  | { readonly ok: true; readonly challenge: Challenge; readonly code: string; readonly line: string }
  | { readonly ok: false; readonly reason: string };

/** A code a friend handed over, read as the challenge reader reads it; `code` is how this build writes it. */
export function readCode(raw: string): ReadCode {
  const r = decodeChallenge(typeof raw === 'string' ? raw.trim() : '');
  if (!r.ok) return { ok: false, reason: CHALLENGE_ERROR_TEXT[r.error] };
  return { ok: true, challenge: r.challenge, code: encodeChallenge(r.challenge), line: describeChallenge(r.challenge) };
}

/** Add a code to the notebook. The same code twice is one entry: it keeps its place, takes a new note if one is given. */
export function addToNotebook(c: ClubState, entry: { code: string; from: string; note: string }, at: number): ClubState {
  const from = cleanName(entry.from) || FROM_YOU;
  const note = entry.note.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE);
  const prior = c.notebook.find((e) => e.code === entry.code);
  if (prior) return { ...c, notebook: c.notebook.map((e) => (e === prior ? { ...e, note: note || e.note } : e)) };
  const stamp = Math.max(at, ...c.notebook.map((e) => e.at + 1));
  const next: NotebookEntry = { at: stamp, code: entry.code, from, note, playedOn: null };
  return { ...c, notebook: [...c.notebook, next].slice(-MAX_NOTEBOOK) };
}

export function markPlayed(c: ClubState, at: number, day: DayKey): ClubState {
  return { ...c, notebook: c.notebook.map((e) => (e.at === at ? { ...e, playedOn: day } : e)) };
}

export function removeFromNotebook(c: ClubState, at: number): ClubState {
  return { ...c, notebook: c.notebook.filter((e) => e.at !== at) };
}

export interface Together {
  readonly members: number;
  /** Codes in the notebook, and how many came from a friend. */
  readonly codes: number;
  readonly fromFriends: number;
  /** Codes this player has played from the notebook. */
  readonly played: number;
}

/** What the club has done together. Counts only: never a person's score, never chips. */
export function together(c: ClubState): Together {
  return {
    members: c.members.length,
    codes: c.notebook.length,
    fromFriends: c.notebook.filter((e) => e.from !== FROM_YOU).length,
    played: c.notebook.filter((e) => e.playedOn !== null).length,
  };
}
