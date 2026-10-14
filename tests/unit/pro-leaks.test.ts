import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HhAction, ParsedHand } from '../../src/core/pro/handHistory.js';
import { factsOf, leakReport, positionsOf, readingOf, SPOTS } from '../../src/core/pro/leaks.js';
import { clopperPearson } from '../../src/core/pro/binomial.js';
import { parseHandHistories } from '../../src/core/pro/parse.js';
import { rfiWidth } from '../../src/core/preflop.js';

/** Six-handed, button at index 0: 0 BTN, 1 SB, 2 BB, 3 UTG, 4 HJ, 5 CO. */
const SEAT = { BTN: 0, SB: 1, BB: 2, UTG: 3, HJ: 4, CO: 5 } as const;
type Pos = keyof typeof SEAT;

let nextId = 1;
function hand(hero: Pos, pre: [Pos, HhAction['kind']][], opts: { n?: number; flop?: boolean; showdown?: boolean } = {}): ParsedHand {
  const n = opts.n ?? 6;
  return {
    site: 'pokerstars',
    id: String(nextId++),
    game: 'cash',
    playedAt: null,
    maxSeats: 6,
    button: 0,
    sb: 5,
    bb: 10,
    ante: 0,
    seats: Array.from({ length: n }, (_, i) => ({ seatNo: i + 1, stack: 1000, isHero: i === SEAT[hero] })),
    hero: SEAT[hero],
    heroCards: ['Ah', 'Kd'],
    actions: pre.map(([p, kind]) => ({ street: 'preflop', seat: SEAT[p], kind, amount: kind === 'raise' ? 30 : kind === 'call' ? 30 : 0, allIn: false })),
    sbSeat: n === 2 ? 0 : 1,
    bbSeat: n === 2 ? 1 : 2,
    board: opts.flop ? ['2c', '7d', '9s'] : [],
    showdown: opts.showdown ?? false,
  };
}

const foldsTo = (p: Pos): [Pos, 'fold'][] => {
  const order: Pos[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
  return order.slice(0, order.indexOf(p)).map((q) => [q, 'fold']);
};

describe('positions count back from the button', () => {
  it('six-handed, nine-handed (early seats read as UTG), four-handed, heads-up', () => {
    expect(positionsOf(hand('BTN', []))).toEqual(['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']);
    const nine = { ...hand('BTN', []), seats: Array.from({ length: 9 }, (_, i) => ({ seatNo: i + 1, stack: 1, isHero: i === 0 })) };
    expect(positionsOf(nine)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'UTG', 'UTG', 'UTG', 'HJ', 'CO']);
    const four = { ...hand('BTN', []), seats: nine.seats.slice(0, 4) };
    expect(positionsOf(four)).toEqual(['BTN', 'SB', 'BB', 'CO']);
    expect(positionsOf({ ...hand('BTN', []), seats: nine.seats.slice(0, 2) })).toBeNull();
  });
});

describe('what one hand counts', () => {
  it('first in: a raise is an open, a limp or a fold is not; a limper ahead removes the spot', () => {
    expect(factsOf(hand('CO', [...foldsTo('CO'), ['CO', 'raise']])).spots).toEqual([{ id: 'open-CO', took: true }]);
    expect(factsOf(hand('CO', [...foldsTo('CO'), ['CO', 'fold']])).spots).toEqual([{ id: 'open-CO', took: false }]);
    expect(factsOf(hand('CO', [...foldsTo('CO'), ['CO', 'call']])).spots).toEqual([{ id: 'open-CO', took: false }]);
    expect(factsOf(hand('CO', [['UTG', 'call'], ['HJ', 'fold'], ['CO', 'raise']])).spots).toEqual([]);
  });

  it('the big blind against a single open defends with a call or a raise; a cold-caller removes the spot', () => {
    const vsBtn: [Pos, HhAction['kind']][] = [...foldsTo('BTN'), ['BTN', 'raise'], ['SB', 'fold']];
    expect(factsOf(hand('BB', [...vsBtn, ['BB', 'call']])).spots).toEqual([{ id: 'bb-vs-BTN', took: true }]);
    expect(factsOf(hand('BB', [...vsBtn, ['BB', 'raise']])).spots).toEqual([{ id: 'bb-vs-BTN', took: true }]);
    expect(factsOf(hand('BB', [...vsBtn, ['BB', 'fold']])).spots).toEqual([{ id: 'bb-vs-BTN', took: false }]);
    expect(factsOf(hand('BB', [...foldsTo('BTN'), ['BTN', 'raise'], ['SB', 'call'], ['BB', 'fold']])).spots).toEqual([]);
  });

  it('after opening, facing one 3-bet: fold is the counted action; a 4-bet before hero removes it', () => {
    const open: [Pos, HhAction['kind']][] = [...foldsTo('HJ'), ['HJ', 'raise'], ['CO', 'raise'], ['BTN', 'fold'], ['SB', 'fold'], ['BB', 'fold']];
    const f = factsOf(hand('HJ', [...open, ['HJ', 'fold']]));
    expect(f.spots).toEqual([{ id: 'open-HJ', took: true }, { id: 'vs3bet-HJ', took: true }]);
    expect(factsOf(hand('HJ', [...open, ['HJ', 'call']])).spots[1]).toEqual({ id: 'vs3bet-HJ', took: false });
    const fourBet: [Pos, HhAction['kind']][] = [...foldsTo('HJ'), ['HJ', 'raise'], ['CO', 'raise'], ['BTN', 'raise'], ['SB', 'fold'], ['BB', 'fold'], ['HJ', 'fold']];
    expect(factsOf(hand('HJ', fourBet)).spots).toEqual([{ id: 'open-HJ', took: true }]);
  });

  it('VPIP, PFR, 3-bet and WTSD', () => {
    const threeBet = factsOf(hand('BTN', [...foldsTo('CO'), ['CO', 'raise'], ['BTN', 'raise']]));
    expect(threeBet).toMatchObject({ vpip: true, pfr: true, threeBet: true });
    const walk = factsOf(hand('BB', foldsTo('BB')));
    expect(walk).toMatchObject({ vpip: false, pfr: false, threeBet: null, showdown: null });
    const sd = factsOf(hand('BB', [...foldsTo('BTN'), ['BTN', 'raise'], ['SB', 'fold'], ['BB', 'call']], { flop: true, showdown: true }));
    expect(sd).toMatchObject({ vpip: true, threeBet: false, showdown: true });
  });
});

describe('the reading: never a leak on noise', () => {
  const at = (k: number, n: number, chart: number) => readingOf(n, k / n, chart, clopperPearson(k, n, 0.9));

  it('under 20 hands is never read, whatever the gap', () => {
    expect(at(19, 19, 0.1)).toBe('not-enough');
  });

  it('20 hands, a 15-point gap, and a band clear of the chart: a leak', () => {
    // 101 of 142 folds (71%) against a 52% chart: 90% band about 64-77%, clear of 52, gap 19.
    expect(at(101, 142, 0.52)).toBe('leak');
  });

  it('a 15-point gap whose band still reaches the chart is not a leak', () => {
    // 14 of 20 (70%) against 52%: an 18-point gap, but the 90% band (about 49-86%) still holds 52%.
    expect(clopperPearson(14, 20).low).toBeLessThan(0.52);
    expect(at(14, 20, 0.52)).toBe('band-crosses');
  });

  it('a clear but small gap reads under the gap; a band over the chart reads in line', () => {
    expect(at(1210, 3180, 0.45)).toBe('under-gap');
    expect(at(72, 300, 0.27)).toBe('in-line');
  });
});

describe('the report', () => {
  it('a learner who opens the cutoff every time shows a CO open leak, with the chart as the reference', () => {
    const hands = Array.from({ length: 40 }, () => hand('CO', [...foldsTo('CO'), ['CO', 'raise']]));
    const r = leakReport(hands);
    const co = r.spots.find((s) => s.id === 'open-CO')!;
    expect(co).toMatchObject({ n: 40, k: 40, you: 1, reading: 'leak' });
    expect(co.chart).toBeCloseTo(rfiWidth('CO'), 12);
    expect(r.spots[0].id).toBe('open-CO');
    expect(r.summary).toMatchObject({ hands: 40, vpip: { k: 40, n: 40 }, pfr: { k: 40, n: 40 } });
    expect(r.spots.find((s) => s.id === 'open-UTG')).toMatchObject({ n: 0, reading: 'not-enough', needed: 20 });
  });

  it('every spot has a chart number from Offsuit’s own charts, strictly between 0 and 1', () => {
    expect(SPOTS).toHaveLength(14);
    for (const s of SPOTS) {
      expect(s.chart, s.id).toBeGreaterThan(0);
      expect(s.chart, s.id).toBeLessThan(1);
    }
  });

  it('runs over every fixture, and its output carries counts only: no money, no reward', () => {
    const dir = path.resolve(import.meta.dirname, '..', 'fixtures', 'hh');
    const hands = fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).flatMap((f) => parseHandHistories(fs.readFileSync(path.join(dir, f), 'utf8')).hands);
    expect(hands.length).toBeGreaterThan(20);
    const r = leakReport(hands);
    expect(r.summary.hands).toBe(hands.length);
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/won|profit|winnings|rep|chalk|seal|streak|reward|\$/i);
  });
});

describe('review round 1: what a chart spot may count', () => {
  it('M3: tournament, ante and short-stack hands count in the summary but not against the 100bb charts', () => {
    const open = (): ParsedHand => hand('CO', [...foldsTo('CO'), ['CO', 'raise']]);
    const tourney = { ...open(), game: 'tournament' as const };
    const ante = { ...open(), ante: 1 };
    const short = { ...open(), seats: open().seats.map((s) => ({ ...s, stack: 300 })) }; // 30bb at 10bb blinds
    const r = leakReport([tourney, ante, short, open()]);
    expect(r.summary.hands).toBe(4);
    expect(r.spots.find((s) => s.id === 'open-CO')!.n).toBe(1);
    expect(r.excluded).toBe(3);
  });

  it('m1: fold to a 3-bet skips an all-in 3-bet and a squeeze; big-blind defence skips an open shove', () => {
    const base = (threeBet: HhAction['kind'], allIn: boolean, caller: boolean): ParsedHand => {
      const h = hand('HJ', [...foldsTo('HJ'), ['HJ', 'raise'], ...(caller ? ([['CO', 'call']] as [Pos, HhAction['kind']][]) : []), ['BTN', threeBet], ['SB', 'fold'], ['BB', 'fold'], ['HJ', 'fold']]);
      return { ...h, actions: h.actions.map((a) => (a.seat === SEAT.BTN ? { ...a, allIn } : a)) };
    };
    expect(factsOf(base('raise', false, false)).spots.map((s) => s.id)).toContain('vs3bet-HJ');
    expect(factsOf(base('raise', true, false)).spots.map((s) => s.id)).not.toContain('vs3bet-HJ');
    expect(factsOf(base('raise', false, true)).spots.map((s) => s.id)).not.toContain('vs3bet-HJ');
    const shove = hand('BB', [...foldsTo('BTN'), ['BTN', 'raise'], ['SB', 'fold'], ['BB', 'fold']]);
    const allIn = { ...shove, actions: shove.actions.map((a) => (a.seat === SEAT.BTN ? { ...a, allIn: true } : a)) };
    expect(factsOf(allIn).spots).toEqual([]);
  });
});
