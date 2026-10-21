/**
 * LAN CLUB — a standing local group of people who play Game Nights together. Pure reducers over
 * `progression.club` (progression/types.ts ClubState).
 *
 * COOPERATIVE BY CONSTRUCTION. The club's numbers are pooled: decisions graded together, the share that were
 * clean, spots reviewed together. Nothing here ranks a member, reads a chip or keeps anyone's numbers apart
 * from the night they were shared on. Members are names this player keeps; nothing is sent anywhere.
 */

import { CHALLENGE_ERROR_TEXT, decodeChallenge, describeChallenge, encodeChallenge, type Challenge } from '../challengeCode.js';
import type { DayKey } from '../localDay.js';
import type { ActionKind } from '../table.js';
import { MAX_CLUB_MEMBERS, MAX_NIGHTS, MAX_NOTEBOOK } from '../progression/persist.js';
import type { ClubState, NightRecord, NotebookEntry } from '../progression/types.js';
import { CLUB_CODE_ERROR_TEXT, clubName, decodeClubCode, describeClubCode, encodeClubCode, type ClubCode } from './codes.js';
import { pool, recapOf, type Pooled } from './gameNight.js';

/** A club name may be longer than a table name (it never goes into a code). */
export const MAX_CLUB_NAME = 32;
export const MAX_NOTE = 140;
/** Who a notebook entry came from when it is this player's own. */
export const FROM_YOU = 'You';

export function startClub(c: ClubState, rawName: string, day: DayKey): ClubState {
  const n = rawName.replace(/\s+/g, ' ').trim().slice(0, MAX_CLUB_NAME);
  if (n === '') return c;
  return { ...c, name: n, since: c.since ?? day };
}

export function setTableName(c: ClubState, raw: string): ClubState {
  const n = clubName(raw);
  return { ...c, tableName: n === '' ? null : n };
}

/** The name this player sits down under: the club's table name, else the onboarding name, else "Player". */
export function tableNameOf(c: ClubState, displayName: string | null): string {
  return c.tableName ?? (clubName(displayName ?? '') || 'Player');
}

export function addMember(c: ClubState, raw: string, day: DayKey): ClubState {
  const n = clubName(raw);
  if (n === '' || n === FROM_YOU || c.members.some((m) => m.name === n) || c.members.length >= MAX_CLUB_MEMBERS) return c;
  return { ...c, members: [...c.members, { name: n, since: day }] };
}

export function removeMember(c: ClubState, n: string): ClubState {
  return { ...c, members: c.members.filter((m) => m.name !== n) };
}

/** Any code a member hands over: a club spot or recap, or a challenge code (hand, Math problem, puzzle). */
export type AnyCode =
  | { readonly ok: true; readonly kind: 'club'; readonly code: ClubCode; readonly text: string; readonly line: string }
  | { readonly ok: true; readonly kind: 'challenge'; readonly challenge: Challenge; readonly text: string; readonly line: string }
  | { readonly ok: false; readonly reason: string };

export function readAnyCode(raw: string): AnyCode {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const club = decodeClubCode(text);
  // `text` is the code as this build writes it, so the same code typed two ways is one notebook entry.
  if (club.ok) return { ok: true, kind: 'club', code: club.code, text: encodeClubCode(club.code), line: describeClubCode(club.code) };
  const ch = decodeChallenge(text);
  if (ch.ok) return { ok: true, kind: 'challenge', challenge: ch.challenge, text: encodeChallenge(ch.challenge), line: describeChallenge(ch.challenge) };
  // The club reader knows its own kinds; anything else is the challenge reader's to explain.
  if (club.error !== 'not-club') return { ok: false, reason: CLUB_CODE_ERROR_TEXT[club.error] };
  return { ok: false, reason: CHALLENGE_ERROR_TEXT[ch.error] };
}

/** Add a code to the notebook. The same code twice is one entry (the newer note wins). */
export function addToNotebook(c: ClubState, entry: { code: string; from: string; note: string }, at: number): ClubState {
  const from = clubName(entry.from) || FROM_YOU;
  const note = entry.note.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE);
  const kept = c.notebook.filter((e) => e.code !== entry.code);
  const prior = c.notebook.find((e) => e.code === entry.code);
  const stamp = Math.max(at, ...c.notebook.map((e) => e.at + 1));
  const next: NotebookEntry = { at: stamp, code: entry.code, from, note: note || prior?.note || '', answer: prior?.answer ?? null };
  return { ...c, notebook: [...kept, next].sort((a, b) => a.at - b.at).slice(-MAX_NOTEBOOK) };
}

const KNOWN_ANSWERS: readonly string[] = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];

/** A notebook answer as this build reads it: an action, 'unknown' (a newer build's), or null (not played). */
export function effectiveAnswer(e: NotebookEntry): ActionKind | 'unknown' | null {
  if (e.answer === null) return null;
  return KNOWN_ANSWERS.includes(e.answer) ? (e.answer as ActionKind) : 'unknown';
}

/** Record an answer. One a newer build wrote is kept: this build never overwrites what it cannot read. */
export function answerNotebook(c: ClubState, at: number, answer: ActionKind): ClubState {
  return { ...c, notebook: c.notebook.map((e) => (e.at === at && effectiveAnswer(e) !== 'unknown' ? { ...e, answer } : e)) };
}

export function removeFromNotebook(c: ClubState, at: number): ClubState {
  return { ...c, notebook: c.notebook.filter((e) => e.at !== at) };
}

/** Save a night's current state, replacing the record of the same night. */
export function upsertNight(c: ClubState, night: NightRecord): ClubState {
  const others = c.nights.filter((n) => n.night !== night.night);
  return { ...c, nights: [...others, night].sort((a, b) => a.startedAt - b.startedAt).slice(-MAX_NIGHTS) };
}

export interface Together extends Pooled {
  readonly nights: number;
  /** Notebook spots this player has played. */
  readonly reviewed: number;
}

/** The club's pooled record: every night's table (you and the friends who shared), summed. */
export function together(c: ClubState, yourName: string): Together {
  const recaps = c.nights.flatMap((n) => [recapOf(n, yourName), ...n.friends]);
  // A table's hands are counted once a night (pool takes the longest sitting), so the club's are summed by night.
  const hands = c.nights.reduce((t, n) => t + pool([recapOf(n, yourName), ...n.friends]).hands, 0);
  return { ...pool(recaps), hands, nights: c.nights.length, reviewed: c.notebook.filter((e) => e.answer !== null).length };
}
