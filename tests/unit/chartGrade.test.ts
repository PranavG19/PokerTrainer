import { describe, expect, it } from 'vitest';
import {
  PLAYABILITY_ORDER,
  chartAction,
  chartDistance,
  chartVerdict,
  chenScore,
  type ChartSpot,
} from '../../src/core/chartGrade.js';
import { gradeDecision } from '../../src/core/coach.js';
import { chartSpotFor, gradeSpot } from '../../src/core/gradeSpot.js';
import { ALL_COMBOS, RFI_POSITIONS, rfiCombos, BOUNDARY_COMBOS } from '../../src/core/preflop.js';
import { applyAction, createTable, startHand, type TableState } from '../../src/core/table.js';

/**
 * PREFLOP GRADED FROM THE CHARTS (Wave 0 package 0.3). Preflop used to be graded on pot odds against one
 * betting range, which put almost every opening mistake under the 0.5bb silence line. The charts in
 * preflop.ts now decide the direction, and the distance outside the chart decides the size.
 */
const rfi = (position: (typeof RFI_POSITIONS)[number]): ChartSpot => ({ kind: 'rfi', position });

describe('the playability order', () => {
  it('makes every RFI chart a prefix, so a chart edge is one number', () => {
    for (const position of RFI_POSITIONS) {
      const width = rfiCombos(position).length;
      const prefix = new Set(PLAYABILITY_ORDER.slice(0, width));
      expect(rfiCombos(position).every((c) => prefix.has(c)), position).toBe(true);
    }
  });

  it('covers all 169 hands once, aces first and 72o among the last', () => {
    expect(new Set(PLAYABILITY_ORDER).size).toBe(ALL_COMBOS.length);
    expect(PLAYABILITY_ORDER[0]).toBe('AA');
    expect(PLAYABILITY_ORDER.indexOf('72o')).toBeGreaterThan(160);
  });

  it('breaks ties with the Chen score', () => {
    expect(chenScore('AA')).toBe(20);
    expect(chenScore('AKs')).toBe(12);
    expect(chenScore('22')).toBe(5);
    expect(chenScore('72o')).toBe(-1);
  });
});

describe('RFI fixtures, per seat', () => {
  const pot = 1.5; // the unopened pot in big blinds
  for (const position of RFI_POSITIONS) {
    it(`${position}: the chart's own action is free, folding aces is serious`, () => {
      for (const combo of rfiCombos(position)) {
        expect(chartAction(rfi(position), combo)).toBe('raise');
      }
      expect(chartVerdict(rfi(position), ['As', 'Ah'], 'raise', pot).lossBb).toBe(0);
      expect(chartVerdict(rfi(position), ['As', 'Ah'], 'fold', pot).lossBb).toBeGreaterThanOrEqual(2);
      expect(chartVerdict(rfi(position), ['7s', '2h'], 'fold', pot).lossBb).toBe(0);
    });
  }

  it('charges an open of trash at the fold-equity cap, notable not serious', () => {
    const v = chartVerdict(rfi('CO'), ['7s', '2h'], 'raise', pot);
    expect(v.lossBb).toBe(1);
  });

  it('grows with distance: a near miss is small, a far one is large', () => {
    expect(chartDistance(rfi('CO'), 'K8o', 'raise')).toBeGreaterThan(chartDistance(rfi('CO'), 'K9o', 'raise'));
    const near = chartVerdict(rfi('CO'), ['Ks', '9h'], 'raise', pot).lossBb;
    const far = chartVerdict(rfi('CO'), ['Ks', '8h'], 'raise', pot).lossBb;
    expect(near).toBeLessThan(0.5);
    expect(far).toBeGreaterThan(near);
  });

  it('treats the authored boundary cells as mixed: close, not wrong', () => {
    for (const position of RFI_POSITIONS) {
      for (const combo of BOUNDARY_COMBOS[position]) {
        const off = chartAction(rfi(position), combo) === 'raise' ? 'fold' : 'raise';
        const hole = [`${combo[0]}s`, combo[2] === 'o' || combo[0] === combo[1] ? `${combo[1]}h` : `${combo[1]}s`];
        expect(chartVerdict(rfi(position), hole, off, pot).close, `${position} ${combo}`).toBe(true);
      }
    }
  });

  it('never puts a limp in the chart, and charges half the nearer mistake', () => {
    const limpTrash = chartVerdict(rfi('CO'), ['7s', '2h'], 'call', pot);
    expect(limpTrash.lossBb).toBeCloseTo(0.5, 10);
    const limpAces = chartVerdict(rfi('CO'), ['As', 'Ah'], 'call', pot);
    expect(limpAces.lossBb).toBeCloseTo(chartVerdict(rfi('CO'), ['As', 'Ah'], 'fold', pot).lossBb / 2, 10);
  });
});

describe('defence and 3-bet fixtures', () => {
  const bbVsBtn: ChartSpot = { kind: 'defend', spot: 'bb-vs-btn' };
  it('the big blind calls a wide button open and 3-bets value', () => {
    expect(chartAction(bbVsBtn, 'K5o')).toBe('call');
    expect(chartAction(bbVsBtn, 'AA')).toBe('raise');
    expect(chartAction(bbVsBtn, '72o')).toBe('fold');
  });

  it('folding aces to an open is serious; a call with trash is capped at a quarter of the price', () => {
    expect(chartVerdict(bbVsBtn, ['As', 'Ah'], 'fold', 3.4, 1.4).lossBb).toBeGreaterThan(2);
    expect(chartVerdict(bbVsBtn, ['7s', '2h'], 'call', 3.4, 1.4).lossBb).toBeCloseTo(0.35, 10);
  });

  it('folding a 4-bet hand beside a fold cell is a mistake, not a mixed cell', () => {
    const v = chartVerdict({ kind: '3bet', opener: 'CO' }, ['As', 'Kh'], 'fold', 11, 5.5);
    expect(v.close).toBe(false);
    expect(v.lossBb).toBeGreaterThan(2);
  });

  it('grades a hand beside the edge of its row as close', () => {
    // K4o folds and K5o calls in this chart: each is one kicker from the other side.
    expect(chartVerdict(bbVsBtn, ['Ks', '4h'], 'call', 3.4, 1.4).close).toBe(true);
    expect(chartVerdict(bbVsBtn, ['Ks', '5h'], 'fold', 3.4, 1.4).close).toBe(true);
  });

  it('the opener facing a 3-bet keeps aces and folds trash', () => {
    const btn: ChartSpot = { kind: '3bet', opener: 'BTN' };
    expect(chartVerdict(btn, ['As', 'Ah'], 'fold', 11, 5.5).lossBb).toBeGreaterThan(2);
    expect(chartVerdict(btn, ['7s', '2h'], 'fold', 11, 5.5).lossBb).toBe(0);
    expect(chartVerdict(btn, ['7s', '2h'], 'call', 11, 5.5).lossBb).toBeGreaterThan(1);
  });
});

describe('the grader reads the chart preflop', () => {
  const base = { board: [], street: 'preflop', stack: 5000, bb: 50, opponents: 3, seed: 7 } as const;

  it('folding aces first in from the cutoff is now graded (it used to be silent)', () => {
    const g = gradeDecision({ ...base, board: [], hole: ['As', 'Ah'], pot: 75, toCall: 50, chosen: 'fold', chart: rfi('CO') });
    expect(g.severity).toBe('serious');
    expect(g.principle).toBe('position');
    expect(g.message).toBe('The CO opening chart raises AA; folding it costs ~3.8 bb.');
    expect(g.price).toBeUndefined();
  });

  it('the boundary cell played either way speaks only if the estimate would have', () => {
    const g = gradeDecision({ ...base, board: [], hole: ['Ks', '7s'], pot: 75, toCall: 50, chosen: 'raise', chart: rfi('CO') });
    expect(g.close).toBe(true);
    expect(g.message).toBeNull();
  });

  it('is ignored after the flop', () => {
    const g = gradeDecision({
      ...base,
      hole: ['As', 'Ah'],
      board: ['2c', '7d', '9h'],
      street: 'flop',
      pot: 300,
      toCall: 0,
      chosen: 'check',
      chart: rfi('CO'),
    });
    expect(g.message).toBeNull();
  });
});

/** A 4-seat table, the button on seat 0: SB 1, BB 2, seat 3 first to act. */
function dealt(): TableState {
  const table = createTable({
    seats: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, stack: 5000, isHero: i === 0 })),
    sb: 25,
    bb: 50,
    seed: 11,
  });
  return startHand(table);
}

describe('chart spots are read from the betting', () => {
  it('first in on the 4-max table opens the cutoff chart, then the button and small blind', () => {
    let s = dealt();
    expect(s.dealer).toBe(0);
    expect(chartSpotFor(s)).toEqual({ kind: 'rfi', position: 'CO' });
    s = applyAction(s, { kind: 'fold' });
    expect(chartSpotFor(s)).toEqual({ kind: 'rfi', position: 'BTN' });
    s = applyAction(s, { kind: 'fold' });
    expect(chartSpotFor(s)).toEqual({ kind: 'rfi', position: 'SB' });
  });

  it('facing one open: the big blind defends, the button has no chart, a limp is no chart', () => {
    let s = dealt();
    s = applyAction(s, { kind: 'raise', amount: 125 }); // CO opens
    expect(chartSpotFor(s)).toBeNull(); // the button vs a cutoff open has no chart
    s = applyAction(s, { kind: 'fold' });
    expect(chartSpotFor(s)).toBeNull(); // nor does the small blind vs a cutoff open
    s = applyAction(s, { kind: 'fold' });
    expect(chartSpotFor(s)).toEqual({ kind: 'defend', spot: 'bb-vs-co' });

    let limped = dealt();
    limped = applyAction(limped, { kind: 'call' });
    expect(chartSpotFor(limped)).toBeNull();
  });

  it('the opener facing one 3-bet reads the 3-bet response chart', () => {
    let s = dealt();
    s = applyAction(s, { kind: 'raise', amount: 125 }); // CO opens
    s = applyAction(s, { kind: 'raise', amount: 400 }); // BTN 3-bets
    s = applyAction(s, { kind: 'fold' });
    s = applyAction(s, { kind: 'fold' });
    expect(s.toAct).toBe(3);
    expect(chartSpotFor(s)).toEqual({ kind: '3bet', opener: 'CO' });
  });

  it('gradeSpot grades the seat to act from its chart', () => {
    const s = dealt();
    const hole = s.seats[3].hole;
    const g = gradeSpot(s, 'fold', { seed: 1, modelFor: () => null });
    const direct = gradeDecision({
      hole,
      board: [],
      street: 'preflop',
      pot: 75,
      toCall: 50,
      stack: s.seats[3].stack,
      bb: 50,
      chosen: 'fold',
      opponents: 3,
      seed: 1,
      chart: { kind: 'rfi', position: 'CO' },
    });
    expect(g).toEqual(direct);
  });
});

/**
 * Review fixes (code-review-grader.md, act-on 1 and 4). The charts are 100bb standard-size ranges, so a
 * shove, an outsized open or a short stack must not be graded from them: facing a CO shove the old code
 * charged calling with aces as "the BB chart raises AA" (18.7bb, serious).
 */
describe('chart spots only where the charts apply', () => {
  it('a shove, an outsized open or a short stack is not a chart spot', () => {
    let shove = dealt();
    shove = applyAction(shove, { kind: 'allin' });
    shove = applyAction(shove, { kind: 'fold' });
    shove = applyAction(shove, { kind: 'fold' });
    expect(chartSpotFor(shove)).toBeNull();

    let big = dealt();
    big = applyAction(big, { kind: 'raise', amount: 1500 }); // a 30bb open
    big = applyAction(big, { kind: 'fold' });
    big = applyAction(big, { kind: 'fold' });
    expect(chartSpotFor(big)).toBeNull();

    const short = dealt();
    short.seats[3].stack = 400; // 8bb behind
    expect(chartSpotFor(short)).toBeNull();
  });

  it('calling a shove with aces is not charged', () => {
    let s = dealt();
    s = applyAction(s, { kind: 'allin' });
    s = applyAction(s, { kind: 'fold' });
    s = applyAction(s, { kind: 'fold' });
    s.seats[s.toAct].hole = ['As', 'Ah'];
    expect(gradeSpot(s, 'call', { seed: 1, modelFor: () => null }).severity).toBe('free');
  });

  it('a close 3-bet-response cell names its chart in plain words', () => {
    const g = gradeDecision({
      hole: ['Js', 'Jh'],
      board: [],
      street: 'preflop',
      pot: 550,
      toCall: 275,
      stack: 4875,
      bb: 50,
      chosen: 'call',
      opponents: 1,
      seed: 1,
      chart: { kind: '3bet', opener: 'CO' },
    });
    expect(g.close).toBe(true);
    expect(g.message).toBe(
      'Close spot: JJ sits on the edge of the chart facing a 3-bet after a CO open, where both choices are played. Either choice holds up.',
    );
  });
});
