import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { shuffledDeck } from '../../src/core/cards.js';
import { decodeChallenge, encodeChallenge } from '../../src/core/challengeCode.js';
import {
  addMember,
  addToNotebook,
  answerNotebook,
  readAnyCode,
  removeMember,
  setTableName,
  startClub,
  tableNameOf,
  together,
  upsertNight,
} from '../../src/core/club/club.js';
import {
  clubName,
  decodeClubCode,
  describeClubCode,
  encodeClubCode,
  nightIdOf,
  type NightRecap,
  type SharedSpot,
} from '../../src/core/club/codes.js';
import {
  addFriendRecap,
  decisionKey,
  endNight,
  gradeShared,
  NIGHT_SEEN,
  NIGHT_SPOTS,
  observeView,
  pool,
  pooledNight,
  recapOf,
  recordDecision,
  spotFromView,
  startNight,
} from '../../src/core/club/gameNight.js';
import type { DayKey } from '../../src/core/localDay.js';
import { createRoom, dealRoomHand, handBase, LAN_TABLE, MAX_SEAT_NAME, playerJoins, viewFor, type RoomState, type RoomView } from '../../src/core/multiplayer.js';
import { bannedPhrasingIn } from '../../src/core/progress.js';
import { defaultProgression, MAX_NIGHT_SEEN, MAX_NIGHT_SPOTS, parseProgression } from '../../src/core/progression/persist.js';
import { encodeQr } from '../../src/core/qr.js';
import { mulberry32 } from '../../src/core/rng.js';

/**
 * LAN CLUB and HOME GAME NIGHT — the codes friends hand each other, the night's own grading, the pooled recap
 * and the club's reducers. Cooperative and decision-scored: nothing here reads chips, and pooling never keeps a
 * per-player number apart.
 */

const DAY = 20_000 as DayKey;

const spot = (over: Partial<SharedSpot> = {}): SharedSpot => ({
  hole: ['Ah', 'Kd'],
  board: ['2c', '7d', 'Jh'],
  bb: 50,
  pot: 300,
  toCall: 100,
  stack: 4700,
  opponents: 1,
  chosen: 'call',
  ...over,
});

const recap = (over: Partial<NightRecap> = {}): NightRecap => ({
  night: '0a1b2c3d',
  day: DAY,
  name: 'Ada',
  hands: 12,
  decisions: 30,
  clean: 24,
  lossCentiBb: 410,
  ...over,
});

describe('club codes', () => {
  it('a spot and a recap decode to exactly what was encoded', () => {
    const cases = [
      spot(),
      spot({ board: [], toCall: 25, pot: 75, chosen: 'fold' }),
      spot({ board: ['2c', '7d', 'Jh', 'Ks'], chosen: null, toCall: 0 }),
      spot({ board: ['2c', '7d', 'Jh', 'Ks', '3s'], chosen: 'allin', opponents: 5, stack: 100_000_000, pot: 100_000_000 }),
    ];
    for (const s of cases) {
      const code = encodeClubCode({ kind: 'spot', spot: s });
      expect(decodeClubCode(code), code).toEqual({ ok: true, code: { kind: 'spot', spot: s } });
    }
    for (const r of [recap(), recap({ name: 'Zoë', hands: 0, decisions: 0, clean: 0, lossCentiBb: 0 })]) {
      const code = encodeClubCode({ kind: 'recap', recap: r });
      expect(decodeClubCode(code), code).toEqual({ ok: true, code: { kind: 'recap', recap: r } });
    }
  });

  it('the longest of each kind fits the reader and a small QR', () => {
    const longest = [
      encodeClubCode({ kind: 'spot', spot: spot({ board: ['2c', '7d', 'Jh', 'Ks', '3s'], bb: 1_000_000, pot: 100_000_000, toCall: 100_000_000, stack: 100_000_000, opponents: 9 }) }),
      encodeClubCode({ kind: 'recap', recap: recap({ name: 'ABCDEFGHIJKLMNOP', day: 0x1fffff as DayKey, hands: 1_000_000, decisions: 1_000_000, clean: 1_000_000, lossCentiBb: 0x0fffffff }) }),
    ];
    for (const code of longest) {
      expect(code.replace(/^OS-/, '').replace(/-/g, '').length).toBeLessThanOrEqual(64);
      expect(decodeClubCode(code).ok).toBe(true);
      expect(encodeQr(code, { ecl: 'L' }).version).toBeLessThanOrEqual(4);
    }
  });

  it('is read as forgivingly as a challenge code: case, spaces and dashes do not matter', () => {
    const code = encodeClubCode({ kind: 'spot', spot: spot() });
    expect(decodeClubCode(` ${code.toLowerCase().replace(/-/g, ' ')} `)).toEqual(decodeClubCode(code));
  });

  it('refuses what it cannot open, with a reason, and never throws', () => {
    const code = encodeClubCode({ kind: 'spot', spot: spot() });
    const typo = code.slice(0, -1) + (code.endsWith('0') ? '1' : '0');
    expect(decodeClubCode(typo)).toEqual({ ok: false, error: 'checksum' });
    expect(decodeClubCode('')).toEqual({ ok: false, error: 'empty' });
    expect(decodeClubCode('OS-!!!!')).toEqual({ ok: false, error: 'bad-character' });
    const hand = encodeChallenge({ kind: 'hand', seed: 1, handNumber: 1, button: 0, seats: 4, depthBb: 100 });
    expect(decodeClubCode(hand)).toEqual({ ok: false, error: 'not-club' });
    expect(() => decodeClubCode(42 as unknown as string)).not.toThrow();
  });

  it('a spot with a repeated card, a bad board or a bad name is a caller bug, not a code', () => {
    expect(() => encodeClubCode({ kind: 'spot', spot: spot({ board: ['Ah', '7d', 'Jh'] }) })).toThrow(RangeError);
    expect(() => encodeClubCode({ kind: 'spot', spot: spot({ board: ['2c', '7d'] }) })).toThrow(RangeError);
    expect(() => encodeClubCode({ kind: 'recap', recap: recap({ clean: 31 }) })).toThrow(RangeError);
    expect(() => encodeClubCode({ kind: 'recap', recap: recap({ name: ' Ada' }) })).toThrow(RangeError);
  });

  it('the challenge reader names a club code instead of calling it an unknown kind', () => {
    const code = encodeClubCode({ kind: 'recap', recap: recap() });
    expect(decodeChallenge(code)).toEqual({ ok: false, error: 'club-code' });
  });

  it('readAnyCode opens both families and explains the rest', () => {
    const code = encodeClubCode({ kind: 'spot', spot: spot() });
    const s = readAnyCode(code.toLowerCase().replace(/-/g, ''));
    expect(s.ok && s.kind).toBe('club');
    expect(s.ok && s.text).toBe(code);
    const c = readAnyCode(encodeChallenge({ kind: 'drill', drill: 'spr', index: 3 }));
    expect(c.ok && c.kind).toBe('challenge');
    const bad = readAnyCode('OS-ZZZZ');
    expect(bad.ok).toBe(false);
  });

  it('table names are trimmed and cut to 16 UTF-8 bytes on a whole character', () => {
    expect(clubName('  Sam   the\tdealer ')).toBe('Sam the dealer');
    expect(new TextEncoder().encode(clubName('ééééééééééé')).length).toBeLessThanOrEqual(16);
    expect(clubName('ééééééééééé')).toBe('éééééééé');
    expect(clubName('\u0000\u0007')).toBe('');
    // A joined emoji is kept or dropped whole, never split into its parts.
    expect(clubName('ab👨‍👩‍👧‍👦cdefgh')).toBe('ab');
  });

  it('the night id is a stable hash of the table fingerprint', () => {
    expect(nightIdOf('abc')).toMatch(/^[0-9a-f]{8}$/);
    expect(nightIdOf('abc')).toBe(nightIdOf('abc'));
    expect(nightIdOf('abc')).not.toBe(nightIdOf('abd'));
  });
});

// A two-seat LAN room dealt from a fixed deck, as the relay deals it (multiplayer.ts).
function lanRoom(): RoomState {
  let room = createRoom({ ...LAN_TABLE, seatCount: 2 });
  for (const [id, name] of [['a', 'Sam'], ['b', 'Ada']] as const) {
    const r = playerJoins(room, id, name);
    if ('error' in r) throw new Error(r.error);
    room = r.room;
  }
  const base = handBase(room);
  if ('error' in base) throw new Error(base.error);
  return dealRoomHand(room, base, shuffledDeck(mulberry32(9)));
}

function viewOf(room: RoomState, id: string): RoomView {
  const v = viewFor(room, id);
  if ('error' in v) throw new Error(v.error);
  return v;
}

describe('a Game Night grades only its own decisions, from its own view', () => {
  const room = lanRoom();
  const toAct = room.players.find((p) => p.seatId === room.table!.toAct)!.playerId;
  const waiting = toAct === 'a' ? 'b' : 'a';

  it('reads the spot from the deciding player’s view: their cards, the board, the price', () => {
    const view = viewOf(room, toAct);
    const s = spotFromView(view, { kind: 'call' })!;
    const me = view.seats.find((x) => x.isYou)!;
    expect(s.hole).toEqual(me.hole);
    expect(s.board).toEqual([]);
    expect(s.bb).toBe(LAN_TABLE.bb);
    expect(s.toCall).toBe(view.currentBet - me.committed);
    expect(s.opponents).toBe(1);
    expect(s.chosen).toBe('call');
  });

  it('is null off-turn, for an illegal action, or once the hand is over', () => {
    expect(spotFromView(viewOf(room, waiting), { kind: 'call' })).toBeNull();
    expect(spotFromView(viewOf(room, toAct), { kind: 'check' })).toBeNull();
    expect(spotFromView({ ...viewOf(room, toAct), winners: [] }, { kind: 'call' })).toBeNull();
  });

  it('a decision is keyed by the view it was made on, so a double click counts once', () => {
    const view = viewOf(room, toAct);
    expect(decisionKey(view)).toBe(decisionKey({ ...view }));
    expect(decisionKey(view)).not.toBe(decisionKey({ ...view, pot: view.pot + 50 }));
  });

  it('grades the same spot the same way every time (the seed is the spot’s)', () => {
    const a = gradeShared(spot(), 'fold');
    expect(gradeShared(spot(), 'fold')).toEqual(a);
    // Folding aces preflop for one big blind more is a cost the grader names.
    const aces = gradeShared(spot({ hole: ['Ah', 'As'], board: [], pot: 75, toCall: 25, stack: 4975 }), 'fold');
    expect(aces.clean).toBe(false);
    expect(aces.lossBb).toBeGreaterThan(0);
  });

  it('counts decisions, clean ones and the loss, and keeps the costliest spots as codes', () => {
    let night = startNight('0a1b2c3d', DAY, 'host', 1);
    const losses = [0, 0.4, 2.5, 1.2, 0.8];
    losses.forEach((lossBb, i) => {
      night = recordDecision(night, spot({ pot: 300 + i }), { lossBb, clean: lossBb === 0, message: null });
    });
    expect(night.decisions).toBe(5);
    expect(night.clean).toBe(1);
    expect(night.lossCentiBb).toBe(490);
    expect(night.spots).toHaveLength(NIGHT_SPOTS);
    expect(night.spots.map((s) => s.lossCentiBb)).toEqual([250, 120, 80]);
    for (const s of night.spots) expect(decodeClubCode(s.code).ok).toBe(true);
  });

  it('counts a hand once when it ends, and remembers the other seats by name', () => {
    const view = viewOf(room, toAct);
    let night = startNight('0a1b2c3d', DAY, 'host', 1);
    night = observeView(night, view);
    expect(night.hands).toBe(0);
    expect(night.seen).toEqual([waiting === 'a' ? 'Sam' : 'Ada']);
    const ended = { ...view, winners: [] };
    night = observeView(observeView(night, ended), ended);
    expect(night.hands).toBe(1);
    expect(night.lastHand).toBe(view.handNumber);
  });

  it('never reads a stack or a pot won: a night with the same decisions is the same night whatever the chips did', () => {
    const view = viewOf(room, toAct);
    const rich = { ...view, seats: view.seats.map((s) => ({ ...s, stack: s.stack * 10 })) };
    const a = observeView(startNight('0a1b2c3d', DAY, 'host', 1), { ...view, winners: [] });
    const b = observeView(startNight('0a1b2c3d', DAY, 'host', 1), { ...rich, winners: [] });
    expect(a).toEqual(b);
  });
});

describe('the shared recap', () => {
  const base = { ...startNight('0a1b2c3d', DAY, 'host', 1), hands: 12, decisions: 20, clean: 15, lossCentiBb: 300 };

  it('your recap carries the four counts, the night and your table name', () => {
    expect(recapOf(base, '  Sam ')).toEqual({ night: '0a1b2c3d', day: DAY, name: 'Sam', hands: 12, decisions: 20, clean: 15, lossCentiBb: 300 });
  });

  it('a friend’s recap joins only its own night, never as you, and once per name', () => {
    expect(addFriendRecap(base, recap({ night: 'ffffffff' }), 'Sam').ok).toBe(false);
    expect(addFriendRecap(base, recap({ name: 'Sam' }), 'Sam').ok).toBe(false);
    const once = addFriendRecap(base, recap(), 'Sam');
    if (!once.ok) throw new Error(once.reason);
    const twice = addFriendRecap(once.night, recap({ decisions: 40, clean: 30 }), 'Sam');
    if (!twice.ok) throw new Error(twice.reason);
    expect(twice.night.friends).toEqual([recap({ decisions: 40, clean: 30 })]);
  });

  it('pools the table: counts summed, hands the longest sitting, rates over everyone', () => {
    const added = addFriendRecap(base, recap(), 'Sam');
    if (!added.ok) throw new Error(added.reason);
    const p = pooledNight(added.night, 'Sam');
    expect(p).toEqual({ players: 2, hands: 12, decisions: 50, clean: 39, cleanRate: 39 / 50, bbPer100: 14.2 });
    expect(pool([])).toEqual({ players: 0, hands: 0, decisions: 0, clean: 0, cleanRate: null, bbPer100: null });
  });

  it('ending a night stamps it once', () => {
    const ended = endNight(base, 5);
    expect(ended.endedAt).toBe(5);
    expect(endNight(ended, 9).endedAt).toBe(5);
  });
});

describe('the club', () => {
  const empty = defaultProgression().club;

  it('starts with a name and keeps its first day', () => {
    expect(startClub(empty, '   ', DAY)).toBe(empty);
    const c = startClub(empty, '  Thursday   table ', DAY);
    expect(c.name).toBe('Thursday table');
    expect(startClub(c, 'Renamed', (DAY + 3) as DayKey).since).toBe(DAY);
  });

  it('members are unique names, and the table name falls back to the onboarding name', () => {
    let c = addMember(addMember(empty, 'Ada', DAY), ' Ada ', DAY);
    expect(c.members).toEqual([{ name: 'Ada', since: DAY }]);
    expect(addMember(c, 'You', DAY)).toBe(c);
    c = removeMember(c, 'Ada');
    expect(c.members).toEqual([]);
    expect(tableNameOf(empty, null)).toBe('Player');
    expect(tableNameOf(empty, 'Robin')).toBe('Robin');
    expect(tableNameOf(setTableName(empty, 'Sam'), 'Robin')).toBe('Sam');
  });

  it('the notebook keeps a code once, and remembers the answer to a spot', () => {
    const code = encodeClubCode({ kind: 'spot', spot: spot() });
    let c = addToNotebook(empty, { code, from: 'Ada', note: 'the turn' }, 100);
    c = addToNotebook(c, { code, from: 'Ada', note: '' }, 100);
    expect(c.notebook).toHaveLength(1);
    expect(c.notebook[0].note).toBe('the turn');
    c = answerNotebook(c, c.notebook[0].at, 'call');
    expect(c.notebook[0].answer).toBe('call');
  });

  it('together sums every night’s table and counts hands once a night', () => {
    const a = { ...startNight('00000001', DAY, 'host', 1), hands: 10, decisions: 20, clean: 10, lossCentiBb: 200, friends: [recap({ night: '00000001', hands: 10, decisions: 10, clean: 10, lossCentiBb: 0 })] };
    const b = { ...startNight('00000002', DAY, 'join', 2), hands: 5, decisions: 10, clean: 5, lossCentiBb: 100 };
    const t = together(upsertNight(upsertNight(empty, a), b), 'Sam');
    expect(t).toMatchObject({ nights: 2, players: 3, hands: 15, decisions: 40, clean: 25, reviewed: 0 });
  });
});

describe('the club persists additively', () => {
  it('a profile without a club reads as no club, and junk never throws', () => {
    expect(parseProgression({}).club).toEqual(defaultProgression().club);
    for (const junk of [null, 7, 'x', [], { members: 'x', notebook: [{}], nights: [{ night: 'nope' }] }]) {
      expect(() => parseProgression({ club: junk })).not.toThrow();
    }
    const c = parseProgression({ club: { name: 'T', members: [{ name: 'Ada', since: DAY }, { name: 'Ada', since: DAY }] } }).club;
    expect(c.members).toHaveLength(1);
  });

  it('a friend’s recap filed under another night is dropped on read', () => {
    const night = { ...startNight('0a1b2c3d', DAY, 'host', 1), friends: [recap(), recap({ night: 'ffffffff', name: 'Bo' })] };
    expect(parseProgression({ club: { nights: [night] } }).club.nights[0].friends).toEqual([recap()]);
  });

  it('persist’s bounds are the night’s own', () => {
    expect(MAX_NIGHT_SPOTS).toBe(NIGHT_SPOTS);
    expect(MAX_NIGHT_SEEN).toBe(NIGHT_SEEN);
    expect(MAX_SEAT_NAME).toBeGreaterThanOrEqual(16);
  });
});

describe('the club’s words', () => {
  it('every line the club and the night show passes the banned-phrasing check', () => {
    const files = ['src/renderer/screens/club.ts', 'src/core/club/codes.ts', 'src/core/club/gameNight.ts', 'src/core/club/club.ts'];
    for (const f of files) {
      const src = fs.readFileSync(path.resolve(import.meta.dirname, '../..', f), 'utf8');
      const strings = [...src.matchAll(/'([^'\\\n]|\\.){8,}'|`([^`\\]|\\.){8,}`/g)].map((m) => m[0]);
      for (const s of strings) expect(bannedPhrasingIn(s), `${f}: ${s}`).toBeNull();
    }
    expect(describeClubCode({ kind: 'recap', recap: recap() })).toBe("Ada's Game Night: 30 decisions graded over 12 hands.");
  });
});

describe('review round 2: an answer this build does not know', () => {
  it('reads as unknown everywhere and is never overwritten', async () => {
    const { effectiveAnswer } = await import('../../src/core/club/club.js');
    const entry = { at: 1, code: 'OS-AAAA', from: 'Ada', note: '', answer: 'jam' };
    expect(effectiveAnswer(entry)).toBe('unknown');
    expect(effectiveAnswer({ ...entry, answer: 'call' })).toBe('call');
    expect(effectiveAnswer({ ...entry, answer: null })).toBeNull();
    const c = { ...defaultProgression().club, notebook: [entry] };
    expect(answerNotebook(c, 1, 'fold').notebook[0].answer).toBe('jam');
  });

  it('a club member list needs a name to sit under before a night: the default is no name', () => {
    expect(tableNameOf(defaultProgression().club, null)).toBe('Player');
  });
});

describe('full-suite triage: the spots to look at are the decisions the grader names', () => {
  it('a clean decision with a small point loss is counted but never offered for review', () => {
    let night = startNight('0a1b2c3d', DAY, 'host', 1);
    night = recordDecision(night, spot({ pot: 301 }), { lossBb: 0.3, clean: true, message: null });
    expect(night.decisions).toBe(1);
    expect(night.lossCentiBb).toBe(30);
    expect(night.spots).toEqual([]);
    night = recordDecision(night, spot({ pot: 302 }), { lossBb: 1.4, clean: false, message: 'x' });
    expect(night.spots.map((s) => s.lossCentiBb)).toEqual([140]);
  });
});
