import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES, type ArchetypeName } from '../../src/core/archetypes.js';
import { PROFILES } from '../../src/core/ai.js';
import { gradeDecision } from '../../src/core/coach.js';
import { equityVsRandom, equityVsWeightedRange, scalarEquity } from '../../src/core/equity.js';
import { PREFLOP_STRENGTH } from '../../src/core/preflopStrength.js';
import { ALL_COMBOS, VILLAIN_BETTING_RANGE } from '../../src/core/preflop.js';
import {
  aggressionLikelihood,
  rangeShare,
  strengthTable,
  valueLine,
  villainRange,
} from '../../src/core/villainRanges.js';
import { gradeSpot } from '../../src/core/gradeSpot.js';
import { applyAction, createTable, startHand, type TableState } from '../../src/core/table.js';

/**
 * VILLAIN RANGES BY ARCHETYPE, STREET AND SIZE (Wave 0 package 0.4). One fixed betting range used to
 * stand for every opponent on every street, so the coach charged "call down light" against a maniac (the
 * app's own exploit text) as a pot-odds mistake.
 */
const FLOP = ['Ah', 'Kd', '7s'];
const RIVER = ['Ah', 'Kd', '7s', '2c', '9h'];

describe('strength tables', () => {
  it('reads preflop strength from the generated table, which matches a fresh Monte Carlo', () => {
    expect(Object.keys(PREFLOP_STRENGTH)).toHaveLength(ALL_COMBOS.length);
    for (const [hole, combo] of [[['As', 'Ah'], 'AA'], [['7c', '2d'], '72o'], [['9s', '8s'], '98s']] as const) {
      const mc = scalarEquity(equityVsRandom([...hole], [], 1, 20000, 3));
      expect(Math.abs(PREFLOP_STRENGTH[combo] - mc), combo).toBeLessThan(0.015);
    }
  });

  it('is exact on the river and close to a Monte Carlo before it', () => {
    for (const board of [FLOP, RIVER]) {
      const t = strengthTable(board);
      const i = t.hands.findIndex(([a, b]) => (a === '9c' && b === '9d') || (a === '9d' && b === '9c'));
      const mc = scalarEquity(equityVsRandom(['9c', '9d'], board, 1, 20000, 3));
      expect(Math.abs(t.strength[i] - mc), board.join('')).toBeLessThan(board.length === 5 ? 0.01 : 0.05);
    }
  });

  it('is deterministic: the same board gives the same table', () => {
    const a = Array.from(strengthTable(['Qs', 'Jd', '4h']).strength);
    const b = Array.from(strengthTable(['Qs', 'Jd', '4h']).strength);
    expect(a).toEqual(b);
  });
});

describe('ranges by archetype', () => {
  const share = (name: ArchetypeName, board: string[]): number =>
    rangeShare(villainRange({ model: ARCHETYPE_PROFILES[name], board, facing: 'bet' }));

  it('orders the archetypes by how much they bet, widest first', () => {
    const order = (['maniac', 'lag', 'tag-reg', 'station', 'nit', 'over-folder'] as const).map((n) => share(n, FLOP));
    for (let i = 1; i < order.length; i++) expect(order[i - 1], `rank ${i}`).toBeGreaterThan(order[i]);
  });

  it('a maniac bets most hands; a nit bets a narrow value range', () => {
    expect(share('maniac', FLOP)).toBeGreaterThan(0.7);
    expect(share('nit', FLOP)).toBeLessThan(0.05);
  });

  it('postflop, a selective archetype is narrowed by what it continued with preflop', () => {
    const nit = ARCHETYPE_PROFILES.nit;
    const r = villainRange({ model: nit, board: FLOP, facing: 'bet' });
    const t = strengthTable(FLOP);
    const at = (x: string, y: string): number => r.weights[t.hands.findIndex(([a, b]) => (a === x && b === y) || (a === y && b === x))];
    // Both are trash on this board; the nit never played 32o preflop, but might have played QJs.
    expect(at('3c', '2d')).toBeLessThan(at('Qc', 'Jc'));
  });

  it('a bigger bet narrows the value range, the archetype\'s own size leaves the bot rule exact', () => {
    const tag = ARCHETYPE_PROFILES['tag-reg'];
    expect(valueLine({ model: tag, board: FLOP, facing: 'bet', potFraction: tag.betPotFraction })).toBeCloseTo(tag.raiseStrength, 12);
    expect(valueLine({ model: tag, board: FLOP, facing: 'bet', potFraction: tag.betPotFraction * 2 })).toBeCloseTo(tag.raiseStrength + 0.1, 12);
    expect(valueLine({ model: tag, board: FLOP, facing: 'bet', potFraction: tag.betPotFraction * 8 })).toBeCloseTo(tag.raiseStrength + 0.1, 12);
    const small = villainRange({ model: tag, board: RIVER, facing: 'bet', potFraction: 0.33 });
    const big = villainRange({ model: tag, board: RIVER, facing: 'bet', potFraction: 1.32 });
    const vsSmall = scalarEquity(equityVsWeightedRange(['Ks', 'Qs'], RIVER, small, 4000, 1));
    const vsBig = scalarEquity(equityVsWeightedRange(['Ks', 'Qs'], RIVER, big, 4000, 1));
    expect(vsBig).toBeLessThan(vsSmall);
  });

  it('the likelihood is the bot rule: raiseFreq above the line, the bluff rate below', () => {
    const nit = ARCHETYPE_PROFILES.nit;
    expect(aggressionLikelihood(nit, 0.99, 'bet', 0.8)).toBeCloseTo(nit.raiseFreq, 2);
    expect(aggressionLikelihood(nit, 0.1, 'bet', 0.8)).toBeCloseTo(nit.bluffBetFreq, 2);
    expect(aggressionLikelihood(nit, 0.1, 'raise', 0.8)).toBeCloseTo(nit.bluffRaiseFreq, 2);
  });

  it('takes ai.ts profiles too: they are the same shape', () => {
    expect(rangeShare(villainRange({ model: PROFILES.station, board: FLOP, facing: 'bet' }))).toBeGreaterThan(0);
  });
});

describe('the exploit text and the grade agree', () => {
  // Second pair on a dry river, facing a two-thirds-pot bet: needs 28.6%.
  const spot = {
    hole: ['Kc', 'Qc'],
    board: ['Ks', '8d', '4h', '2c', 'Ah'],
    street: 'river',
    pot: 500,
    toCall: 200,
    stack: 4000,
    bb: 50,
    opponents: 1,
    seed: 3,
  } as const;
  const grade = (name: ArchetypeName, chosen: 'call' | 'fold') =>
    gradeDecision({
      ...spot,
      hole: [...spot.hole],
      board: [...spot.board],
      chosen,
      villainHands: villainRange({ model: ARCHETYPE_PROFILES[name], board: [...spot.board], facing: 'bet', potFraction: 200 / 300 }),
    });

  it('calling down a maniac is not a mistake ("call down light")', () => {
    expect(grade('maniac', 'call').severity).toBe('free');
    expect(grade('maniac', 'fold').severity).not.toBe('free');
  });

  it('folding to a nit is not a mistake ("when a nit bets, it has it")', () => {
    expect(grade('nit', 'fold').severity).toBe('free');
    expect(grade('nit', 'call').severity).not.toBe('free');
  });

  it('the old fixed range could not tell them apart', () => {
    const fixed = (chosen: 'call' | 'fold') =>
      gradeDecision({ ...spot, hole: [...spot.hole], board: [...spot.board], chosen, villainRange: VILLAIN_BETTING_RANGE });
    expect(new Set([fixed('call').severity === 'free', fixed('fold').severity === 'free']).size).toBe(2);
  });
});

describe('gradeSpot models the aggressor from its seat', () => {
  function flopBet(): TableState {
    let s = startHand(
      createTable({
        seats: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, stack: 5000, isHero: i === 0 })),
        sb: 25,
        bb: 50,
        seed: 21,
      }),
    );
    // Seat 3 limps, button (hero, seat 0) calls, blinds complete/check: a four-way limped flop.
    s = applyAction(s, { kind: 'call' });
    s = applyAction(s, { kind: 'call' });
    s = applyAction(s, { kind: 'call' });
    s = applyAction(s, { kind: 'check' });
    expect(s.street).toBe('flop');
    // SB checks, BB bets; seat 3 folds; hero faces the bet.
    s = applyAction(s, { kind: 'check' });
    s = applyAction(s, { kind: 'bet', amount: 130 });
    s = applyAction(s, { kind: 'fold' });
    expect(s.toAct).toBe(0);
    return s;
  }

  it('asks for the aggressor\'s model and grades against it', () => {
    const s = flopBet();
    const asked: number[] = [];
    gradeSpot(s, 'call', {
      seed: 1,
      modelFor: (seat) => {
        asked.push(seat);
        return ARCHETYPE_PROFILES.maniac;
      },
    });
    expect(asked).toEqual([s.lastAggressor]);
  });

  it('falls back to the fixed range when the seat has no model', () => {
    const s = flopBet();
    const hero = s.seats[0];
    const viaSpot = gradeSpot(s, 'call', { seed: 1, modelFor: () => null });
    const direct = gradeDecision({
      hole: hero.hole,
      board: s.board,
      street: s.street,
      pot: s.pot,
      toCall: s.currentBet - hero.committed,
      stack: hero.stack,
      bb: 50,
      chosen: 'call',
      opponents: 2,
      seed: 1,
      villainRange: VILLAIN_BETTING_RANGE,
    });
    expect(viaSpot).toEqual(direct);
  });
});

/**
 * Review fixes (code-review-grader.md, act-on 2 and 3): multiway, a raise over someone else's bet was
 * modelled as a bet because hero had no chips in; and a raise's size was measured as toCall over the
 * pot, which is not how the bots size a raise, so a bot raising at its own size shifted the value line.
 */
describe('bet or raise, and the size read', () => {
  function multiwayRaise(): TableState {
    let s = startHand(
      createTable({
        seats: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, stack: 5000, isHero: i === 0 })),
        sb: 25,
        bb: 50,
        seed: 21,
      }),
    );
    s = applyAction(s, { kind: 'call' }); // seat 3 limps
    s = applyAction(s, { kind: 'call' }); // hero (button) calls
    s = applyAction(s, { kind: 'call' }); // SB completes
    s = applyAction(s, { kind: 'check' }); // BB checks
    s = applyAction(s, { kind: 'bet', amount: 100 }); // SB bets
    s = applyAction(s, { kind: 'raise', amount: 300 }); // BB raises
    s = applyAction(s, { kind: 'fold' }); // seat 3 folds
    expect(s.toAct).toBe(0);
    expect(s.seats[0].committed).toBe(0);
    return s;
  }

  it('grades a multiway raise as a raise, at the archetype\'s own size', () => {
    const s = multiwayRaise();
    const lag = ARCHETYPE_PROFILES.lag;
    const hero = s.seats[0];
    const viaSpot = gradeSpot(s, 'call', { seed: 1, modelFor: () => lag });
    const expected = gradeDecision({
      hole: hero.hole,
      board: s.board,
      street: s.street,
      pot: s.pot,
      toCall: s.currentBet,
      stack: hero.stack,
      bb: 50,
      chosen: 'call',
      opponents: 2,
      seed: 1,
      villainHands: villainRange({ model: lag, board: s.board, facing: 'raise', livePlayers: 3 }),
    });
    expect(viaSpot).toEqual(expected);
  });
});
