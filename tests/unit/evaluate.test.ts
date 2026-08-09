import { describe, it, expect } from 'vitest';
import { evaluate, compareHands, HandCategory } from '../../src/core/evaluate.js';
import { freshDeck, shuffledDeck } from '../../src/core/cards.js';
import { mulberry32 } from '../../src/core/rng.js';

const cat = (cards: string) => evaluate(cards.split(' ')).category;

describe('hand categories', () => {
  it('identifies a straight flush', () => {
    expect(cat('9s 8s 7s 6s 5s')).toBe(HandCategory.StraightFlush);
  });
  it('identifies the steel wheel as a straight flush', () => {
    expect(cat('As 2s 3s 4s 5s')).toBe(HandCategory.StraightFlush);
  });
  it('identifies quads', () => {
    expect(cat('7s 7h 7d 7c 2s')).toBe(HandCategory.Quads);
  });
  it('identifies a full house', () => {
    expect(cat('7s 7h 7d 2c 2s')).toBe(HandCategory.FullHouse);
  });
  it('identifies a flush', () => {
    expect(cat('As Js 9s 5s 2s')).toBe(HandCategory.Flush);
  });
  it('identifies a straight', () => {
    expect(cat('9s 8h 7d 6c 5s')).toBe(HandCategory.Straight);
  });
  it('identifies the wheel as a straight', () => {
    expect(cat('Ah 2s 3d 4c 5h')).toBe(HandCategory.Straight);
  });
  it('does not read AKQJ9 as a straight', () => {
    expect(cat('Ah Ks Qd Jc 9h')).toBe(HandCategory.HighCard);
  });
  it('identifies trips', () => {
    expect(cat('7s 7h 7d Kc 2s')).toBe(HandCategory.Trips);
  });
  it('identifies two pair', () => {
    expect(cat('7s 7h 2d 2c Ks')).toBe(HandCategory.TwoPair);
  });
  it('identifies a pair', () => {
    expect(cat('7s 7h 9d 2c Ks')).toBe(HandCategory.Pair);
  });
  it('identifies high card', () => {
    expect(cat('As Jh 9d 5c 2s')).toBe(HandCategory.HighCard);
  });
});

describe('best five of seven', () => {
  it('finds a flush inside seven cards', () => {
    expect(cat('As Js 9s 5s 2s Kh Qd')).toBe(HandCategory.Flush);
  });
  it('prefers the full house over trips when both exist', () => {
    expect(cat('7s 7h 7d 2c 2s Ks Qh')).toBe(HandCategory.FullHouse);
  });
  it('finds a straight spanning board and hole cards', () => {
    expect(cat('9s 8h 7d 6c 5s Ks Qh')).toBe(HandCategory.Straight);
  });
  it('picks the higher straight when two are present', () => {
    const v = evaluate('9s 8h 7d 6c 5s 4h 3d'.split(' '));
    expect(v.category).toBe(HandCategory.Straight);
    expect(v.kickers[0]).toBe(7); // 9-high straight => rankValue('9') === 7
  });
});

describe('comparisons', () => {
  const gt = (a: string, b: string) => compareHands(a.split(' '), b.split(' ')) > 0;

  it('ranks categories correctly', () => {
    expect(gt('2s 2h 3d 4c 5s', 'As Ks Qd Jc 9h')).toBe(true); // pair > high card
    expect(gt('9s 8h 7d 6c 5s', 'As Ks 2d 2c 3h')).toBe(true); // straight > pair
    expect(gt('As Js 9s 5s 2s', '9s 8h 7d 6c 5h')).toBe(true); // flush > straight
    expect(gt('7s 7h 7d 2c 2s', 'As Js 9s 5s 2s')).toBe(true); // boat > flush
    expect(gt('7s 7h 7d 7c 2s', '7s 7h 7d 2c 2s')).toBe(true); // quads > boat
  });

  it('breaks ties on kickers', () => {
    expect(gt('As Ah Kd 5c 2s', 'As Ah Qd 5c 2s')).toBe(true);
    expect(gt('Ks Kh 9d 9c As', 'Ks Kh 9d 9c Qs')).toBe(true);
  });

  it('treats identical hands as equal', () => {
    expect(compareHands('As Ah Kd 5c 2s'.split(' '), 'Ad Ac Kh 5s 2h'.split(' '))).toBe(0);
  });

  it('ranks the wheel below a six-high straight', () => {
    expect(gt('6s 5h 4d 3c 2s', 'Ah 2s 3d 4c 5h')).toBe(true);
  });
});

describe('deck integrity', () => {
  it('has 52 unique cards', () => {
    const deck = freshDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
  });

  it('shuffles deterministically for a given seed', () => {
    expect(shuffledDeck(mulberry32(42))).toEqual(shuffledDeck(mulberry32(42)));
  });

  it('produces different orders for different seeds', () => {
    expect(shuffledDeck(mulberry32(1))).not.toEqual(shuffledDeck(mulberry32(2)));
  });

  it('preserves all 52 cards through a shuffle', () => {
    const shuffled = shuffledDeck(mulberry32(7));
    expect(new Set(shuffled).size).toBe(52);
  });
});

describe('exhaustive sanity', () => {
  it('never throws and always returns a valid category across many random 7-card hands', () => {
    const rng = mulberry32(12345);
    for (let i = 0; i < 3000; i++) {
      const hand = shuffledDeck(rng).slice(0, 7);
      const v = evaluate(hand);
      expect(v.category).toBeGreaterThanOrEqual(HandCategory.HighCard);
      expect(v.category).toBeLessThanOrEqual(HandCategory.StraightFlush);
      expect(Number.isFinite(v.score)).toBe(true);
    }
  });
});
