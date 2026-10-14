import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_HAND_LINES,
  isParsedHand,
  type HhAction,
  type ParseResult,
  type ParsedHand,
} from '../../src/core/pro/handHistory.js';
import { detectSite, parseHandHistories } from '../../src/core/pro/parse.js';
import { parseAcr } from '../../src/core/pro/parseAcr.js';
import { isSkip } from '../../src/core/pro/parseCommon.js';
import { parseGGPoker } from '../../src/core/pro/parseGGPoker.js';
import { parsePokerStars } from '../../src/core/pro/parsePokerStars.js';

const FIXTURES = path.resolve(import.meta.dirname, '..', 'fixtures', 'hh');
const read = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const load = (name: string): ParseResult => parseHandHistories(read(name));

function hand(r: ParseResult, id: string): ParsedHand {
  const h = r.hands.find((x) => x.id === id);
  if (h === undefined) throw new Error(`hand ${id} not parsed; skipped: ${JSON.stringify(r.skipped)}`);
  return h;
}

const act = (street: HhAction['street'], seat: number, kind: HhAction['kind'], amount = 0, allIn = false): HhAction => ({
  street,
  seat,
  kind,
  amount,
  allIn,
});

/** The fields every fixture assertion reads, so one toEqual names a hand's whole shape. */
const shape = (h: ParsedHand) => ({
  game: h.game,
  playedAt: h.playedAt,
  maxSeats: h.maxSeats,
  sb: h.sb,
  bb: h.bb,
  ante: h.ante,
  seatNos: h.seats.map((s) => s.seatNo),
  button: h.button,
  hero: h.hero,
  heroCards: h.heroCards,
  sbSeat: h.sbSeat,
  bbSeat: h.bbSeat,
  board: h.board,
  showdown: h.showdown,
});

function expectAllValid(r: ParseResult): void {
  for (const h of r.hands) expect(isParsedHand(h), h.id).toBe(true);
}

/** One small clean Stars hand, the base the hostile tests mutate. */
const STARS_HAND = [
  "PokerStars Hand #111:  Hold'em No Limit ($0.05/$0.10 USD) - 2023/03/14 19:42:11 ET",
  "Table 'Test' 6-max Seat #1 is the button",
  'Seat 1: Alice ($10 in chips)',
  'Seat 2: Bob ($10 in chips)',
  'Seat 3: Hero ($10 in chips)',
  'Bob: posts small blind $0.05',
  'Hero: posts big blind $0.10',
  '*** HOLE CARDS ***',
  'Dealt to Hero [Ah Kd]',
  'Alice: raises $0.20 to $0.30',
  'Bob: folds',
  'Hero: calls $0.20',
  '*** FLOP *** [2c 7d 9s]',
  'Hero: checks',
  'Alice: bets $0.40',
  'Hero: folds',
  'Uncalled bet ($0.40) returned to Alice',
  'Alice collected $0.62 from pot',
  '*** SUMMARY ***',
  'Total pot $0.65 | Rake $0.03',
  'Board [2c 7d 9s]',
  'Seat 1: Alice (button) collected ($0.62)',
];
const starsWith = (edit: (lines: string[]) => string[]): string => edit([...STARS_HAND]).join('\n');
const replaceLine = (from: string, to: string) => (ls: string[]): string[] => ls.map((l) => (l === from ? to : l));

describe('PokerStars cash fixture', () => {
  const r = load('pokerstars-cash.txt');

  it('keeps the five Hold\'em hands and skips Omaha and limit with their reasons', () => {
    expect(r.hands.map((h) => h.id)).toEqual(['243516247135', '243516251902', '243516260044', '243516266710', '243517000001']);
    expect(r.skipped).toEqual([
      { id: '243516270001', reason: 'not-holdem' },
      { id: '243516270002', reason: 'not-no-limit' },
    ]);
    expect(r.hands.every((h) => h.site === 'pokerstars')).toBe(true);
    expectAllValid(r);
  });

  it('a preflop fold: the sitting-out seat is dropped, unicode and dotted names match, chat is ignored', () => {
    const h = hand(r, '243516247135');
    expect(shape(h)).toEqual({
      game: 'cash',
      playedAt: '2023-03-14 19:42:11',
      maxSeats: 6,
      sb: 5,
      bb: 10,
      ante: 0,
      seatNos: [1, 2, 3, 5, 6],
      button: 2,
      hero: 2,
      heroCards: ['7c', '2d'],
      sbSeat: 3,
      bbSeat: 4,
      board: ['Kc', '8h', '3s'],
      showdown: false,
    });
    expect(h.seats.map((s) => s.stack)).toEqual([1000, 985, 1000, 410, 1035]);
    expect(h.actions).toEqual([
      act('preflop', 0, 'fold'),
      act('preflop', 1, 'raise', 30),
      act('preflop', 2, 'fold'),
      act('preflop', 3, 'fold'),
      act('preflop', 4, 'call', 20),
      act('flop', 4, 'check'),
      act('flop', 1, 'bet', 35),
      act('flop', 4, 'fold'),
    ]);
  });

  it('an open and a c-bet: the turn line extends the flop', () => {
    const h = hand(r, '243516251902');
    expect(h.button).toBe(3);
    expect(h.heroCards).toEqual(['Ah', 'Qs']);
    expect(h.board).toEqual(['Qd', '7c', '2h', '5s']);
    expect(h.actions.filter((a) => a.seat === h.hero)).toEqual([
      act('preflop', 2, 'raise', 25),
      act('flop', 2, 'bet', 33),
      act('turn', 2, 'bet', 80),
    ]);
  });

  it('a 3-bet pot all in: raises keep the "to" total, all-in flags, showdown', () => {
    const h = hand(r, '243516260044');
    expect(h.actions).toEqual([
      act('preflop', 2, 'raise', 30),
      act('preflop', 3, 'raise', 100),
      act('preflop', 4, 'fold'),
      act('preflop', 0, 'fold'),
      act('preflop', 1, 'fold'),
      act('preflop', 2, 'raise', 1035, true),
      act('preflop', 3, 'call', 305, true),
    ]);
    expect(h.board).toEqual(['Jh', '9c', '4d', '2s', 'Ac']);
    expect(h.showdown).toBe(true);
  });

  it('hero in the big blind facing an open', () => {
    const h = hand(r, '243516266710');
    expect(h.seats.map((s) => s.seatNo)).toEqual([1, 2, 3, 6]);
    expect([h.button, h.sbSeat, h.bbSeat, h.hero]).toEqual([0, 1, 2, 2]);
    expect(h.actions.slice(0, 4)).toEqual([
      act('preflop', 3, 'raise', 25),
      act('preflop', 0, 'fold'),
      act('preflop', 1, 'fold'),
      act('preflop', 2, 'call', 15),
    ]);
  });

  it('a Zoom walk in euros: hero never acts, no showdown', () => {
    const h = hand(r, '243517000001');
    expect([h.sb, h.bb, h.maxSeats, h.seats.length, h.button, h.hero, h.bbSeat]).toEqual([2, 5, 6, 6, 0, 2, 2]);
    expect(h.heroCards).toEqual(['Jd', '4c']);
    expect(h.actions).toHaveLength(5);
    expect(h.actions.some((a) => a.seat === h.hero)).toBe(false);
    expect(h.board).toEqual([]);
    expect(h.showdown).toBe(false);
  });
});

describe('PokerStars tournament fixture', () => {
  const r = load('pokerstars-tournament.txt');

  it('parses all four hands as tournament hands', () => {
    expect(r.hands.map((h) => h.id)).toEqual(['243520000001', '243520000002', '243520000003', '243520000004']);
    expect(r.skipped).toEqual([]);
    expect(r.hands.every((h) => h.game === 'tournament' && h.maxSeats === 9)).toBe(true);
    expectAllValid(r);
  });

  it('level blinds and the posted ante in hundredths; "out of hand" is not dealt in', () => {
    const h = hand(r, '243520000001');
    expect(shape(h)).toEqual({
      game: 'tournament',
      playedAt: '2023-03-14 20:31:15',
      maxSeats: 9,
      sb: 2500,
      bb: 5000,
      ante: 500,
      seatNos: [1, 2, 3, 5, 6, 8],
      button: 3,
      hero: 1,
      heroCards: ['Qc', '3h'],
      sbSeat: 4,
      bbSeat: 5,
      board: [],
      showdown: false,
    });
    expect(h.actions).toEqual([
      act('preflop', 0, 'fold'),
      act('preflop', 1, 'fold'),
      act('preflop', 2, 'raise', 12500),
      act('preflop', 3, 'fold'),
      act('preflop', 4, 'fold'),
      act('preflop', 5, 'fold'),
    ]);
  });

  it('hero in the big blind re-shoves over an open: a sat-out player posts and auto-folds without becoming a seat', () => {
    const h = hand(r, '243520000003');
    expect([h.sb, h.bb, h.ante]).toEqual([5000, 10000, 1000]);
    expect(h.seats.map((s) => s.seatNo)).toEqual([1, 2, 3, 5, 7, 8]);
    expect([h.button, h.sbSeat, h.bbSeat, h.hero]).toEqual([5, 0, 1, 1]);
    expect(h.actions).toEqual([
      act('preflop', 2, 'fold'),
      act('preflop', 3, 'raise', 25000),
      act('preflop', 4, 'fold'),
      act('preflop', 5, 'fold'),
      act('preflop', 0, 'fold'),
      act('preflop', 1, 'raise', 231800, true),
      act('preflop', 3, 'call', 206800),
    ]);
    expect(h.board).toEqual(['Kd', '9s', '5h', 'Qc', '7d']);
    expect(h.showdown).toBe(true);
  });

  it('an open and c-bet, and a 3-bet from the small blind', () => {
    const cbet = hand(r, '243520000002');
    expect(cbet.actions.filter((a) => a.seat === cbet.hero)).toEqual([act('preflop', 1, 'raise', 12000), act('flop', 1, 'bet', 15000)]);
    const threeBet = hand(r, '243520000004');
    expect([threeBet.button, threeBet.sbSeat, threeBet.bbSeat, threeBet.hero]).toEqual([0, 1, 2, 1]);
    expect(threeBet.actions.filter((a) => a.kind === 'raise').map((a) => [a.seat, a.amount])).toEqual([
      [6, 20000],
      [1, 65000],
    ]);
  });
});

describe('GGPoker cash fixture', () => {
  const r = load('ggpoker-cash.txt');

  it('keeps the letter prefix on ids and parses all four hands', () => {
    expect(r.hands.map((h) => h.id)).toEqual(['RC1234567891', 'HD2100000002', 'RC1234567893', 'HD2100000004']);
    expect(r.skipped).toEqual([]);
    expect(r.hands.every((h) => h.site === 'ggpoker' && h.game === 'cash')).toBe(true);
    expectAllValid(r);
  });

  it('a preflop fold: cardless "Dealt to" lines are not heroes, and GG\'s always-printed SHOWDOWN is no showdown', () => {
    const h = hand(r, 'RC1234567891');
    expect(shape(h)).toEqual({
      game: 'cash',
      playedAt: '2023-03-14 19:42:11',
      maxSeats: 6,
      sb: 2,
      bb: 5,
      ante: 0,
      seatNos: [1, 2, 3, 4, 5, 6],
      button: 0,
      hero: 1,
      heroCards: ['8d', '3c'],
      sbSeat: 1,
      bbSeat: 2,
      board: [],
      showdown: false,
    });
    expect(h.actions.map((a) => [a.seat, a.kind])).toEqual([
      [3, 'fold'],
      [4, 'fold'],
      [5, 'fold'],
      [0, 'fold'],
      [1, 'fold'],
    ]);
  });

  it('an open and c-bet that wins uncontested is not a showdown either', () => {
    const h = hand(r, 'HD2100000002');
    expect(h.actions.filter((a) => a.seat === h.hero)).toEqual([act('preflop', 1, 'raise', 25), act('flop', 1, 'bet', 18)]);
    expect(h.showdown).toBe(false);
  });

  it('a 3-bet pot all in, run twice: the FIRST board is kept', () => {
    const h = hand(r, 'RC1234567893');
    expect([h.button, h.sbSeat, h.bbSeat, h.hero]).toEqual([2, 3, 4, 1]);
    expect(h.heroCards).toEqual(['Qs', 'Qh']);
    expect(h.actions).toEqual([
      act('preflop', 5, 'fold'),
      act('preflop', 0, 'raise', 12),
      act('preflop', 1, 'raise', 40),
      act('preflop', 2, 'fold'),
      act('preflop', 3, 'fold'),
      act('preflop', 4, 'fold'),
      act('preflop', 0, 'raise', 512, true),
      act('preflop', 1, 'call', 460, true),
    ]);
    expect(h.board).toEqual(['7c', '2d', '9h', '3s', 'Kd']);
    expect(h.showdown).toBe(true);
  });

  it('hero in the big blind 3-bets an open', () => {
    const h = hand(r, 'HD2100000004');
    expect([h.sb, h.bb, h.button, h.sbSeat, h.bbSeat, h.hero]).toEqual([5, 10, 5, 0, 1, 1]);
    expect(h.actions.slice(-4)).toEqual([
      act('preflop', 1, 'raise', 90),
      act('preflop', 3, 'call', 65),
      act('flop', 1, 'bet', 60),
      act('flop', 3, 'fold'),
    ]);
  });
});

describe('GGPoker tournament fixture', () => {
  const r = load('ggpoker-tournament.txt');

  it('parses all four hands, with comma amounts and the GG level form', () => {
    expect(r.hands.map((h) => h.id)).toEqual(['TM1450633581', 'TM1450633590', 'TM1450633611', 'TM1450633625']);
    expect(r.skipped).toEqual([]);
    expect(r.hands.every((h) => h.game === 'tournament' && h.maxSeats === 8)).toBe(true);
    expectAllValid(r);
  });

  it('a preflop fold at Level15(1,500/3,000(400))', () => {
    const h = hand(r, 'TM1450633581');
    expect(shape(h)).toEqual({
      game: 'tournament',
      playedAt: '2022-12-04 15:57:21',
      maxSeats: 8,
      sb: 150000,
      bb: 300000,
      ante: 40000,
      seatNos: [1, 2, 3, 4, 5, 6, 8],
      button: 2,
      hero: 1,
      heroCards: ['9s', '4d'],
      sbSeat: 3,
      bbSeat: 4,
      board: [],
      showdown: false,
    });
    expect(h.seats[1].stack).toBe(10240000);
    expect(h.actions[1]).toEqual(act('preflop', 6, 'raise', 660000));
  });

  it('hero in the big blind calls an open shove and goes to showdown', () => {
    const h = hand(r, 'TM1450633611');
    expect([h.sb, h.bb, h.ante, h.button, h.sbSeat, h.bbSeat, h.hero]).toEqual([200000, 400000, 50000, 6, 0, 1, 1]);
    expect(h.actions).toEqual([
      act('preflop', 2, 'fold'),
      act('preflop', 3, 'fold'),
      act('preflop', 4, 'raise', 2840000, true),
      act('preflop', 5, 'fold'),
      act('preflop', 6, 'fold'),
      act('preflop', 0, 'fold'),
      act('preflop', 1, 'call', 2440000),
    ]);
    expect(h.board).toEqual(['Qs', '8h', '3d', '2c', 'Kc']);
    expect(h.showdown).toBe(true);
  });

  it('an open and c-bet, and a 3-bet pot', () => {
    const cbet = hand(r, 'TM1450633590');
    expect(cbet.actions.filter((a) => a.seat === cbet.hero)).toEqual([act('preflop', 1, 'raise', 660000), act('flop', 1, 'bet', 500000)]);
    const tb = hand(r, 'TM1450633625');
    expect(tb.seats).toHaveLength(6);
    expect(tb.actions.filter((a) => a.kind === 'raise').map((a) => [a.seat, a.amount])).toEqual([
      [4, 880000],
      [1, 2800000],
    ]);
  });
});

describe('ACR cash fixture', () => {
  const r = load('acr-cash.txt');

  it('keeps the four Hold\'em hands and skips Omaha', () => {
    expect(r.hands.map((h) => h.id)).toEqual(['2001234567', '2001234568', '2001234569', '2001234570']);
    expect(r.skipped).toEqual([{ id: '2001234571', reason: 'not-holdem' }]);
    expect(r.hands.every((h) => h.site === 'acr' && h.game === 'cash')).toBe(true);
    expectAllValid(r);
  });

  it('a preflop fold: no-colon actions, dash stakes, a sitting-out seat, a table line with no "Table"', () => {
    const h = hand(r, '2001234567');
    expect(shape(h)).toEqual({
      game: 'cash',
      playedAt: '2021-03-03 11:31:56',
      maxSeats: 6,
      sb: 1,
      bb: 2,
      ante: 0,
      seatNos: [1, 2, 3, 5, 6],
      button: 2,
      hero: 1,
      heroCards: ['6d', '2c'],
      sbSeat: 3,
      bbSeat: 4,
      board: ['Ts', '5c', '3h'],
      showdown: false,
    });
    expect(h.actions).toEqual([
      act('preflop', 0, 'fold'),
      act('preflop', 1, 'fold'),
      act('preflop', 2, 'raise', 6),
      act('preflop', 3, 'fold'),
      act('preflop', 4, 'call', 4),
      act('flop', 4, 'check'),
      act('flop', 2, 'bet', 8),
      act('flop', 4, 'fold'),
    ]);
  });

  it('"** Dealing down cards **" and padded hole cards', () => {
    const h = hand(r, '2001234568');
    expect(h.heroCards).toEqual(['8s', '8c']);
    expect(h.actions.filter((a) => a.seat === h.hero)).toEqual([act('preflop', 1, 'raise', 6), act('flop', 1, 'bet', 9)]);
  });

  it('hero in the big blind 3-bets an open, gets it in, showdown', () => {
    const h = hand(r, '2001234569');
    expect([h.button, h.sbSeat, h.bbSeat, h.hero]).toEqual([4, 0, 1, 1]);
    expect(h.actions).toEqual([
      act('preflop', 2, 'raise', 6),
      act('preflop', 3, 'fold'),
      act('preflop', 4, 'fold'),
      act('preflop', 0, 'fold'),
      act('preflop', 1, 'raise', 22),
      act('preflop', 2, 'raise', 205, true),
      act('preflop', 1, 'call', 183),
    ]);
    expect(h.board).toEqual(['Kd', '9h', '4h', 'Js', '2c']);
    expect(h.showdown).toBe(true);
  });

  it('a limped pot checked down is a showdown', () => {
    const h = hand(r, '2001234570');
    expect(h.actions[3]).toEqual(act('preflop', 1, 'call', 1));
    expect(h.actions.filter((a) => a.kind === 'check')).toHaveLength(7);
    expect(h.showdown).toBe(true);
  });
});

describe('ACR tournament fixture', () => {
  const r = load('acr-tournament.txt');

  it('parses all four "Game Hand #" tournament hands', () => {
    expect(r.hands.map((h) => h.id)).toEqual(['2001300001', '2001300009', '2001300017', '2001300025']);
    expect(r.skipped).toEqual([]);
    expect(r.hands.every((h) => h.site === 'acr' && h.game === 'tournament' && h.maxSeats === 9)).toBe(true);
    expectAllValid(r);
  });

  it('decimal level blinds, no ante at level 1', () => {
    const h = hand(r, '2001300001');
    expect(shape(h)).toEqual({
      game: 'tournament',
      playedAt: '2021-03-03 12:00:00',
      maxSeats: 9,
      sb: 1000,
      bb: 2000,
      ante: 0,
      seatNos: [1, 2, 3, 4, 5],
      button: 1,
      hero: 2,
      heroCards: ['Jh', '2s'],
      sbSeat: 2,
      bbSeat: 3,
      board: [],
      showdown: false,
    });
    expect(h.actions.map((a) => [a.seat, a.kind, a.amount])).toEqual([
      [4, 'raise', 6000],
      [0, 'fold', 0],
      [1, 'fold', 0],
      [2, 'fold', 0],
      [3, 'fold', 0],
    ]);
  });

  it('an all-in shove called, with "posts ante"', () => {
    const h = hand(r, '2001300017');
    expect([h.sb, h.bb, h.ante, h.button, h.sbSeat, h.bbSeat, h.hero]).toEqual([2500, 5000, 500, 3, 4, 0, 2]);
    expect(h.actions).toEqual([
      act('preflop', 1, 'fold'),
      act('preflop', 2, 'raise', 97500, true),
      act('preflop', 3, 'fold'),
      act('preflop', 4, 'fold'),
      act('preflop', 0, 'call', 92500),
    ]);
    expect(h.showdown).toBe(true);
  });

  it('hero in the big blind folds to an open; an open and c-bet', () => {
    const bb = hand(r, '2001300025');
    expect([bb.bbSeat, bb.hero]).toEqual([2, 2]);
    expect(bb.actions[bb.actions.length - 1]).toEqual(act('preflop', 2, 'fold'));
    const cbet = hand(r, '2001300009');
    expect(cbet.actions.filter((a) => a.seat === cbet.hero)).toEqual([act('preflop', 2, 'raise', 7500), act('flop', 2, 'bet', 6000)]);
  });
});

describe('detectSite and splitting', () => {
  it('reads the site from the first header, past a BOM and blank lines', () => {
    expect(detectSite(read('pokerstars-cash.txt'))).toBe('pokerstars');
    expect(detectSite('\n\n' + read('ggpoker-tournament.txt'))).toBe('ggpoker');
    expect(detectSite(read('acr-cash.txt'))).toBe('acr');
    expect(detectSite(read('acr-tournament.txt'))).toBe('acr');
    expect(detectSite('PokerStars Zoom Hand #1:  x')).toBe('pokerstars');
    expect(detectSite('hello\nPokerStars Hand #1:')).toBeNull();
    expect(detectSite('')).toBeNull();
  });

  it('splits hands at header lines even with no blank line between them, and mixes sites in one file', () => {
    const text = [STARS_HAND.join('\n'), read('acr-tournament.txt').split('\n\n')[0]].join('\n');
    const r = parseHandHistories(text);
    expect(r.hands.map((h) => `${h.site}:${h.id}`)).toEqual(['pokerstars:111', 'acr:2001300001']);
  });

  it('an unknown block is skipped unknown-site; whitespace-only blocks are not reported', () => {
    const r = parseHandHistories(`   \n\t\n\nsome notes\nmore notes\n\n${STARS_HAND.join('\n')}\n\n \n`);
    expect(r.hands).toHaveLength(1);
    expect(r.skipped).toEqual([{ id: null, reason: 'unknown-site' }]);
  });

  it('CRLF line endings parse exactly like LF', () => {
    for (const f of ['pokerstars-cash.txt', 'ggpoker-cash.txt', 'acr-tournament.txt']) {
      const lf = read(f);
      expect(parseHandHistories(lf.replace(/\n/g, '\r\n'))).toEqual(parseHandHistories(lf));
    }
  });

  it('the single-hand entry points agree with the file parser', () => {
    expect(parsePokerStars(STARS_HAND.join('\n'))).toEqual(parseHandHistories(STARS_HAND.join('\n')).hands[0]);
    const gg = read('ggpoker-cash.txt').split(/\n\n+/)[1];
    expect(isSkip(parseGGPoker(gg))).toBe(false);
    const acr = read('acr-cash.txt').split(/\n\n+/)[0];
    expect(isSkip(parseAcr(acr))).toBe(false);
  });
});

describe('hostile input', () => {
  const skipOf = (text: string): string | null => {
    const r = parsePokerStars(text);
    return isSkip(r) ? r.skip : null;
  };

  it('the clean base hand parses', () => {
    expect(skipOf(STARS_HAND.join('\n'))).toBeNull();
  });

  it('a 10 MB single line: unknown-site alone, malformed inside a hand, and fast', () => {
    const big = 'x'.repeat(10 * 1024 * 1024);
    const t0 = performance.now();
    expect(parseHandHistories(big)).toEqual({ hands: [], skipped: [{ id: null, reason: 'unknown-site' }], skipCounts: { 'unknown-site': 1 } });
    expect(parseHandHistories(starsWith((ls) => [...ls.slice(0, 10), big, ...ls.slice(10)])).skipped).toEqual([
      { id: '111', reason: 'malformed' },
    ]);
    expect(parseHandHistories('PokerStars Hand #9' + big).skipped).toEqual([{ id: null, reason: 'malformed' }]);
    expect(performance.now() - t0).toBeLessThan(3000);
  });

  it('100k "[" and 100k "$" lines are rejected by length, never matched', () => {
    for (const ch of ['[', '$']) {
      const line = ch.repeat(100_000);
      expect(skipOf(starsWith(replaceLine('Dealt to Hero [Ah Kd]', `Dealt to Hero ${line}`)))).toBe('malformed');
      expect(skipOf(starsWith(replaceLine('Hero: calls $0.20', `Hero: calls ${line}`)))).toBe('malformed');
      expect(parseHandHistories(line).skipped).toEqual([{ id: null, reason: 'unknown-site' }]);
    }
  });

  it('nested brackets and junk inside a line under MAX_LINE are malformed, not misread', () => {
    expect(skipOf(starsWith(replaceLine('Dealt to Hero [Ah Kd]', 'Dealt to Hero [[Ah Kd]]')))).toBe('malformed');
    expect(skipOf(starsWith(replaceLine('*** FLOP *** [2c 7d 9s]', '*** FLOP *** [[2c [7d] 9s]]')))).toBe('malformed');
    expect(skipOf(starsWith(replaceLine('Hero: calls $0.20', `Hero: calls ${'[$'.repeat(150)}`)))).toBe('malformed');
  });

  it('a header with a 30-digit amount is malformed', () => {
    const digits = '9'.repeat(30);
    expect(skipOf(starsWith((ls) => [`PokerStars Hand #111:  Hold'em No Limit ($${digits}/$0.10 USD) - 2023/03/14 19:42:11 ET`, ...ls.slice(1)]))).toBe('malformed');
    expect(skipOf(starsWith((ls) => [`PokerStars Hand #111:  Hold'em No Limit ($${'9'.repeat(15)}/$0.10 USD) - 2023/03/14 19:42:11 ET`, ...ls.slice(1)]))).toBe('malformed');
    expect(skipOf(starsWith(replaceLine('Seat 2: Bob ($10 in chips)', `Seat 2: Bob ($${digits} in chips)`)))).toBe('malformed');
  });

  it('NUL bytes never crash and never make a hand', () => {
    expect(skipOf(starsWith(replaceLine('Bob: folds', 'Bob\u0000: folds')))).toBe('malformed');
    expect(skipOf(starsWith((ls) => [ls[0].replace('#111', '#1\u000011'), ...ls.slice(1)]))).toBe('malformed');
    const r = parseHandHistories('\u0000'.repeat(5000) + '\n\n' + STARS_HAND.join('\u0000\n'));
    expect(r.hands).toHaveLength(0);
    expect(r.skipped.length).toBeGreaterThan(0);
  });

  it('two "Dealt to" lines with cards is malformed', () => {
    expect(skipOf(starsWith((ls) => [...ls.slice(0, 9), 'Dealt to Bob [Qs Qd]', ...ls.slice(9)]))).toBe('malformed');
    expect(skipOf(starsWith((ls) => [...ls.slice(0, 9), 'Dealt to Hero [Qs Qd]', ...ls.slice(9)]))).toBe('malformed');
  });

  it('no hero cards is no-hero-cards', () => {
    expect(skipOf(starsWith((ls) => ls.filter((l) => !l.startsWith('Dealt to'))))).toBe('no-hero-cards');
  });

  it('a card on both hero and the board is malformed', () => {
    expect(skipOf(starsWith(replaceLine('*** FLOP *** [2c 7d 9s]', '*** FLOP *** [2c 7d Ah]')))).toBe('malformed');
  });

  it('an action by a player with no seat line is malformed (Stars, GG and ACR)', () => {
    expect(skipOf(starsWith(replaceLine('Bob: folds', 'Mallory: folds')))).toBe('malformed');
    const gg = read('ggpoker-cash.txt').split(/\n\n+/)[1].replace('7f3a9e21: folds', 'deadbeef: folds');
    expect(parseGGPoker(gg)).toEqual({ skip: 'malformed', id: 'HD2100000002' });
    const acr = read('acr-cash.txt').split(/\n\n+/)[0].replace('PlayerAlpha folds', 'Ghost folds');
    expect(parseAcr(acr)).toEqual({ skip: 'malformed', id: '2001234567' });
  });

  it('a sitting-out player who makes a real decision is malformed', () => {
    const t = starsWith((ls) => [...ls.slice(0, 5), 'Seat 4: Carol ($10 in chips) is sitting out', ...ls.slice(5)]);
    expect(skipOf(t)).toBeNull();
    expect(skipOf(t.replace('Bob: folds', 'Bob: folds\nCarol: calls $0.30'))).toBe('malformed');
  });

  it('a betting verb that does not parse is malformed; names are never split on spaces', () => {
    expect(skipOf(starsWith(replaceLine('Hero: calls $0.20', 'Hero: calls lots')))).toBe('malformed');
    expect(skipOf(starsWith(replaceLine('Alice: raises $0.20 to $0.30', 'Alice: raises $0.20')))).toBe('malformed');
    // "Hero" and "Hero: x" are both seated; the longer name owns its lines.
    const t = starsWith((ls) => [...ls.slice(0, 5), 'Seat 4: Hero: x ($10 in chips)', ...ls.slice(5)]).replace(
      'Bob: folds',
      'Bob: folds\nHero: x: folds',
    );
    const h = parsePokerStars(t);
    if (isSkip(h)) throw new Error(h.skip);
    expect(h.actions[2]).toEqual(act('preflop', 3, 'fold'));
    expect(h.hero).toBe(2);
  });

  it('streets out of order are malformed; ACR comma boards parse', () => {
    expect(skipOf(starsWith(replaceLine('*** FLOP *** [2c 7d 9s]', '*** TURN *** [2c 7d 9s] [3h]')))).toBe('malformed');
    const acr = read('acr-cash.txt').split(/\n\n+/)[1].replace('*** FLOP *** [2d 7h Kc]', '** Dealing Flop ** [ 2d, 7h, Kc ]');
    const h = parseAcr(acr);
    if (isSkip(h)) throw new Error(h.skip);
    expect(h.board).toEqual(['2d', '7h', 'Kc']);
  });

  it('a hand over MAX_HAND_LINES is too-long', () => {
    const chat = Array.from({ length: MAX_HAND_LINES }, (_, i) => `Alice said, "line ${i}"`);
    const t = starsWith((ls) => [...ls.slice(0, 12), ...chat, ...ls.slice(12)]);
    expect(parsePokerStars(t)).toEqual({ skip: 'too-long', id: '111' });
    expect(parseHandHistories(t).skipped).toEqual([{ id: '111', reason: 'too-long' }]);
  });

  it('20,000 copies of a hand parse well under a few seconds', () => {
    const one = read('pokerstars-cash.txt').split(/\n\n+/)[2];
    const text = Array.from({ length: 20_000 }, () => one).join('\n\n\n');
    const t0 = performance.now();
    const r = parseHandHistories(text);
    const ms = performance.now() - t0;
    expect(r.hands).toHaveLength(20_000);
    expect(r.skipped).toHaveLength(0);
    expect(ms).toBeLessThan(4000);
  });
});

describe('partial hands (a file copied while the site is still writing it)', () => {
  // Each fixture is one complete hand, then a hand cut off on the turn with no summary. Half a hand
  // would read as hero never reaching showdown, so it is skipped, never half-kept.
  for (const site of ['pokerstars', 'ggpoker', 'acr'] as const) {
    it(`${site}: the complete hand is kept, the cut one is skipped as partial`, () => {
      const r = load(`${site}-partial.txt`);
      expect(r.hands).toHaveLength(1);
      expect(r.skipped).toHaveLength(1);
      expect(r.skipped[0].reason).toBe('partial');
      expect(r.skipped[0].id).not.toBeNull();
    });
  }

  it('a hand cut off before the hole cards is skipped too', () => {
    const cut = STARS_HAND.slice(0, STARS_HAND.findIndex((l) => l.startsWith('*** HOLE CARDS'))).join('\n');
    expect(parseHandHistories(cut).hands).toHaveLength(0);
  });
});

describe('review round 1: hostile input amplification', () => {
  it('m5: a file of junk blocks keeps counts, not one record per block', () => {
    const text = 'x\n\n'.repeat(50_000);
    const r = parseHandHistories(text);
    expect(r.skipped.length).toBeLessThanOrEqual(1000);
    expect(r.skipCounts['unknown-site']).toBe(50_000);
  });
});
