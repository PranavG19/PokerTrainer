import { describe, expect, it } from 'vitest';
import { freshDeck } from '../../src/core/cards.js';
import { evaluate } from '../../src/core/evaluate.js';
import { mulberry32, shuffle } from '../../src/core/rng.js';
import { cardIndex, cardOfIndex, score } from '../../src/core/pro/eval7.js';
import { CLASS_HANDS, CLASS_SIZE, COMPAT, classIndex, liveWeight } from '../../src/core/pro/handClasses.js';

/** The fast evaluator must agree with the engine's to the bit: one score function, two speeds. */
describe('eval7 matches evaluate() exactly', () => {
  it('on 60,000 random 5, 6 and 7 card hands', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 60_000; i++) {
      const n = 5 + (i % 3);
      const cards = shuffle(freshDeck(), rng).slice(0, n);
      expect(score(cards.map(cardIndex))).toBe(evaluate(cards).score);
    }
  });

  it('on the hands most likely to go wrong', () => {
    const cases = [
      ['As', '2s', '3s', '4s', '5s', 'Kd', 'Kh'], // steel wheel over trips-less pair
      ['Ah', 'Kh', 'Qh', 'Jh', 'Th', '9h', '8h'], // royal with extra flush cards
      ['7c', '7d', '7h', '7s', 'Ac', 'Ad', 'Ah'], // quads with a trips kicker
      ['9c', '9d', '9h', '5s', '5c', '5d', '2h'], // two trips: full house, higher trips first
      ['Kc', 'Kd', 'Qh', 'Qs', 'Jc', 'Jd', '2h'], // three pairs: the third pair is the kicker
      ['Ac', '2d', '3h', '4s', '5c', '9d', 'Th'], // wheel straight
      ['Ac', 'Kd', 'Qh', 'Js', 'Tc', '9d', '8h'], // broadway over lower straights
      ['2c', '4c', '6c', '8c', 'Tc', 'Qd', 'Kd'], // flush with no straight
    ];
    for (const hand of cases) expect(score(hand.map(cardIndex))).toBe(evaluate(hand).score);
  });

  it('round-trips card indices', () => {
    for (const c of freshDeck()) expect(cardOfIndex(cardIndex(c))).toBe(c);
    expect(() => cardIndex('Xx')).toThrow();
    expect(() => cardIndex('Ass')).toThrow();
  });
});

describe('hand classes and card removal', () => {
  it('covers all 1326 hands, 6 / 4 / 12 per class', () => {
    expect(CLASS_SIZE.reduce((a, b) => a + b, 0)).toBe(1326);
    expect(CLASS_SIZE[classIndex('AA')]).toBe(6);
    expect(CLASS_SIZE[classIndex('AKs')]).toBe(4);
    expect(CLASS_SIZE[classIndex('AKo')]).toBe(12);
    expect(CLASS_HANDS[classIndex('32o')]).toHaveLength(12);
  });

  it('counts blocked pairs: AA against AKs leaves 12 of 24, against KK all 36', () => {
    // AA (6) x AKs (4): each AKs uses one ace; an AA hand of two aces blocks the AKs of either suit.
    // Each of the 4 AKs is blocked by the 3 AA hands holding its ace, so 24 - 12 = 12 survive.
    expect(COMPAT[classIndex('AA') * 169 + classIndex('AKs')]).toBe(12);
    expect(COMPAT[classIndex('AA') * 169 + classIndex('KK')]).toBe(36);
    // Holding AA, an average of 2 AKs remain (of 4): exactly half the suited aces are dead.
    expect(liveWeight(classIndex('AA'), classIndex('AKs'))).toBe(2);
    // Holding AKo, 3 of the 6 AA hands remain (one ace held: C(3,2) = 3).
    expect(liveWeight(classIndex('AKo'), classIndex('AA'))).toBe(3);
  });
});
