import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { encodeChallenge } from '../../src/core/challengeCode.js';
import {
  addMember,
  addToNotebook,
  cleanName,
  FROM_YOU,
  markPlayed,
  readCode,
  removeFromNotebook,
  removeMember,
  startClub,
  together,
} from '../../src/core/club/club.js';
import type { DayKey } from '../../src/core/localDay.js';
import { bannedPhrasingIn } from '../../src/core/progress.js';
import { defaultProgression, MAX_CLUB_MEMBERS, MAX_NOTEBOOK, parseProgression } from '../../src/core/progression/persist.js';

/**
 * LAN CLUB — a standing group of friends and the notebook of challenge codes they hand each other. Local and
 * cooperative: nothing here touches the network, ranks a member or reads a chip.
 */

const DAY = 20_000 as DayKey;
const empty = defaultProgression().club;
const hand = encodeChallenge({ kind: 'hand', seed: 7, handNumber: 1, button: 2, seats: 4, depthBb: 100 });
const drill = encodeChallenge({ kind: 'drill', drill: 'spr', index: 3 });

describe('the club', () => {
  it('starts with a name and keeps its first day', () => {
    expect(startClub(empty, '   ', DAY)).toBe(empty);
    const c = startClub(empty, '  Thursday   table ', DAY);
    expect(c.name).toBe('Thursday table');
    expect(startClub(c, 'Renamed', (DAY + 3) as DayKey).since).toBe(DAY);
  });

  it('members are unique, never "You", and bounded', () => {
    let c = addMember(addMember(empty, 'Ada', DAY), ' Ada ', DAY);
    expect(c.members).toEqual([{ name: 'Ada', since: DAY }]);
    expect(addMember(c, FROM_YOU, DAY)).toBe(c);
    for (let i = 0; i < MAX_CLUB_MEMBERS + 5; i++) c = addMember(c, `P${i}`, DAY);
    expect(c.members).toHaveLength(MAX_CLUB_MEMBERS);
    expect(removeMember(c, 'Ada').members.some((m) => m.name === 'Ada')).toBe(false);
  });

  it('names are cleaned and cut on whole graphemes', () => {
    expect(cleanName('  Sam   the\tdealer ')).toBe('Sam the dealer');
    expect(cleanName('\u0000\u0007')).toBe('');
    expect(cleanName('ab👨‍👩‍👧‍👦cd', 3)).toBe('ab👨‍👩‍👧‍👦');
  });
});

describe('the notebook', () => {
  it('reads a code as the challenge reader does, and keeps it as this build writes it', () => {
    const r = readCode(` ${hand.toLowerCase().replace(/-/g, ' ')} `);
    expect(r.ok && r.code).toBe(hand);
    expect(r.ok && r.line).toContain('4-handed');
    expect(readCode('OS-ZZZZ').ok).toBe(false);
    expect(readCode('').ok).toBe(false);
  });

  it('keeps a code once: the same code again takes its new note and keeps its place', () => {
    let c = addToNotebook(empty, { code: hand, from: 'Ada', note: 'the river call' }, 100);
    c = addToNotebook(c, { code: drill, from: 'You', note: '' }, 100);
    c = addToNotebook(c, { code: hand, from: 'Bo', note: '' }, 200);
    expect(c.notebook.map((e) => e.code)).toEqual([hand, drill]);
    expect(c.notebook[0]).toMatchObject({ from: 'Ada', note: 'the river call' });
    expect(new Set(c.notebook.map((e) => e.at)).size).toBe(2);
    c = addToNotebook(c, { code: hand, from: 'Ada', note: 'the turn' }, 300);
    expect(c.notebook[0].note).toBe('the turn');
  });

  it('marks a code played, removes one, and stays bounded', () => {
    let c = addToNotebook(empty, { code: hand, from: 'Ada', note: '' }, 100);
    c = markPlayed(c, c.notebook[0].at, DAY);
    expect(c.notebook[0].playedOn).toBe(DAY);
    expect(removeFromNotebook(c, c.notebook[0].at).notebook).toEqual([]);
    let big = empty;
    for (let i = 0; i < MAX_NOTEBOOK + 3; i++) big = addToNotebook(big, { code: encodeChallenge({ kind: 'drill', drill: 'mdf', index: i }), from: 'You', note: '' }, i + 1);
    expect(big.notebook).toHaveLength(MAX_NOTEBOOK);
  });

  it('together counts what the club did, never a person’s score', () => {
    let c = addMember(startClub(empty, 'T', DAY), 'Ada', DAY);
    c = addToNotebook(c, { code: hand, from: 'Ada', note: '' }, 1);
    c = addToNotebook(c, { code: drill, from: FROM_YOU, note: '' }, 2);
    c = markPlayed(c, c.notebook[0].at, DAY);
    expect(together(c)).toEqual({ members: 1, codes: 2, fromFriends: 1, played: 1 });
  });
});

describe('the club persists additively', () => {
  it('a profile without a club reads as no club, and junk never throws', () => {
    expect(parseProgression({}).club).toEqual(empty);
    for (const junk of [null, 7, 'x', [], { members: 'x', notebook: [{}, { at: 1, code: '<b>', from: 'A' }] }]) {
      expect(() => parseProgression({ club: junk })).not.toThrow();
    }
  });

  it('duplicates are dropped on read: a member name, a notebook time or a code', () => {
    const c = parseProgression({
      club: {
        name: 'T',
        members: [{ name: 'Ada', since: DAY }, { name: 'Ada', since: DAY }],
        notebook: [
          { at: 1, code: hand, from: 'Ada', note: '', playedOn: null },
          { at: 1, code: drill, from: 'Ada', note: '', playedOn: null },
          { at: 2, code: hand, from: 'Bo', note: '', playedOn: 'x' },
        ],
      },
    }).club;
    expect(c.members).toHaveLength(1);
    expect(c.notebook).toEqual([{ at: 1, code: hand, from: 'Ada', note: '', playedOn: null }]);
  });
});

describe('the club’s words', () => {
  it('every line the club shows passes the banned-phrasing check', () => {
    for (const f of ['src/renderer/screens/club.ts', 'src/core/club/club.ts']) {
      const src = fs.readFileSync(path.resolve(import.meta.dirname, '../..', f), 'utf8');
      const strings = [...src.matchAll(/'([^'\\\n]|\\.){8,}'|`([^`\\]|\\.){8,}`/g)].map((m) => m[0]);
      for (const s of strings) expect(bannedPhrasingIn(s), `${f}: ${s}`).toBeNull();
    }
  });
});
