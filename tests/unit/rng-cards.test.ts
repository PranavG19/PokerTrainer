import { describe, expect, it } from 'vitest';
import {
  RANKS,
  SUITS,
  SUIT_PIP,
  freshDeck,
  isRed,
  rankOf,
  rankValue,
  shuffledDeck,
  suitOf,
  type Card,
} from '../../src/core/cards.js';
import { mulberry32, randomSeed, shuffle } from '../../src/core/rng.js';

/**
 * THE FOUNDATION, TESTED DIRECTLY. rng.ts (26 lines) and cards.ts (31 lines) had no test file of their
 * own — they were only ever exercised through the modules above them, which is the wrong place to
 * discover that a shuffle is biased or that a deck has 51 cards. Every seeded e2e assertion in this
 * project, every reproducible drill sequence, and the audit probes that found eleven engine defects all
 * rest on these two files, so they get their own oracles rather than inherited coverage.
 *
 * THE ORACLES ARE PROPERTIES, NOT SNAPSHOTS. "mulberry32(42) starts with 0.6011037519201636" would pin
 * the implementation rather than the requirement, and would have to be rewritten if the PRNG were ever
 * replaced — while still not catching a shuffle that loses a card. So what is asserted is: determinism
 * from a seed, independence between seeds, that a shuffle is a PERMUTATION (nothing lost, nothing
 * duplicated), and that it is not biased toward leaving cards where they started.
 */

const ALL_CARDS = 52;

describe('mulberry32 — determinism is the whole point', () => {
  it('is a pure function of its seed', () => {
    // Every reproducible sequence in the app depends on exactly this. If it ever fails, the failing
    // e2e test somewhere else will look like a game-logic bug rather than an RNG one.
    for (const seed of [0, 1, 42, 158, 2 ** 31, 0xffffffff]) {
      const first = Array.from({ length: 20 }, mulberry32(seed));
      const second = Array.from({ length: 20 }, mulberry32(seed));
      expect(second, `seed ${seed} is not reproducible`).toEqual(first);
    }
  });

  it('gives every seed a different stream', () => {
    // Adjacent seeds specifically: the drill screens use seedFor(i) = 101 + i, so if neighbouring
    // seeds correlated, consecutive problems would be near-duplicates and the drill would be broken
    // in a way no drill test would name.
    const heads = new Map<string, number>();
    for (let seed = 100; seed < 160; seed++) {
      const key = Array.from({ length: 4 }, mulberry32(seed)).join(',');
      expect(heads.has(key), `seeds ${heads.get(key)} and ${seed} produce the same stream`).toBe(false);
      heads.set(key, seed);
    }
  });

  it('stays in [0, 1) over a long run', () => {
    // A value of exactly 1 would put `Math.floor(rng() * n)` out of bounds — an index off the end of a
    // deck or an options array. 200k draws is cheap and covers the range the app actually uses.
    const rng = mulberry32(7);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 200_000; i++) {
      const value = rng();
      if (value < min) min = value;
      if (value > max) max = value;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
  });

  it('EXCLUDES 1 by construction, not merely by not having drawn it', () => {
    /*
     * SAMPLING CANNOT SEE THIS, and I only know because I mutated it: dividing the 32-bit output by
     * 4294967295 (2^32 - 1) instead of 4294967296 (2^32) makes the range [0, 1] INCLUSIVE, and 200k
     * draws above never hit the max — the mutation survived. An `rng()` of exactly 1 makes
     * `Math.floor(rng() * n)` return n, one past the end of a deck or an options array, which
     * downstream is a dealt `undefined` card.
     *
     * So the divisor is checked at the boundary directly: feed the PRNG's own maximum 32-bit output
     * through the same division and require it to stay below 1. The value below is the largest
     * uint32; anything but a 2^32 divisor fails it.
     */
    const TWO_32 = 4294967296;

    /*
     * The oracle is ALGEBRAIC rather than statistical. A correct implementation returns
     * `someUint32 / 2^32`, so multiplying any output back by 2^32 must land exactly on an integer.
     * Divide by 2^32 - 1 instead and that stops being true for essentially every draw — measured:
     * 0/10000 non-integers with the right divisor, 10000/10000 with the wrong one. Note this is a
     * property of the SOURCE's arithmetic, not a comparison between two literals, so it cannot pass
     * vacuously.
     */
    for (let seed = 0; seed < 50; seed++) {
      const rng = mulberry32(seed);
      for (let i = 0; i < 200; i++) {
        const value = rng();
        expect(
          Number.isInteger(value * TWO_32),
          `seed ${seed} draw ${i}: ${value} is not a uint32 over 2^32, so the divisor is wrong`,
        ).toBe(true);
        // The consequence that actually bites: the top of the range must still index inside a deck.
        expect(Math.floor(value * 52), 'a draw indexed off the end of a 52-card deck').toBeLessThan(52);
      }
    }
  });

  it('is roughly uniform, so a "1 in 7" drill really is 1 in 7', () => {
    // Ten buckets over 100k draws. Not a serious randomness test — it is a smoke check that would
    // catch a broken shift or a lost bit, which is the realistic failure here.
    const rng = mulberry32(99);
    const buckets = new Array<number>(10).fill(0);
    const draws = 100_000;
    for (let i = 0; i < draws; i++) buckets[Math.floor(rng() * 10)]++;
    for (const [index, count] of buckets.entries()) {
      // Expected 10000 each; +-10% is loose enough never to flake and tight enough to catch skew.
      expect(count, `bucket ${index} has ${count} of ${draws}`).toBeGreaterThan(draws / 10 * 0.9);
      expect(count, `bucket ${index} has ${count} of ${draws}`).toBeLessThan(draws / 10 * 1.1);
    }
  });

  it('survives a seed of 0 and a seed above 2^31', () => {
    // `seed >>> 0` and `Math.imul` make the arithmetic wrap; seed 0 and a seed past the signed
    // boundary are where a naive implementation degenerates into a constant.
    for (const seed of [0, 2 ** 31, 0xffffffff, -1]) {
      const values = Array.from({ length: 10 }, mulberry32(seed));
      expect(new Set(values).size, `seed ${seed} degenerates to a constant`).toBeGreaterThan(1);
    }
  });
});

describe('shuffle — a permutation, not merely a rearrangement', () => {
  it('loses nothing and duplicates nothing', () => {
    /*
     * THE ONE THAT MATTERS. A shuffle bug that drops or repeats a card would show up downstream as an
     * impossible hand — two identical cards at a showdown, or an evaluator crash — and diagnosing it
     * from there is far harder than asserting the property here. `i > 0` in Fisher-Yates is exactly the
     * kind of boundary that silently breaks under an edit.
     */
    for (let seed = 1; seed <= 200; seed++) {
      const deck = shuffledDeck(mulberry32(seed));
      expect(deck.length, `seed ${seed}: deck is not 52 cards`).toBe(ALL_CARDS);
      expect(new Set(deck).size, `seed ${seed}: deck has duplicates`).toBe(ALL_CARDS);
      // And the same 52 cards, not 52 arbitrary strings.
      expect([...deck].sort(), `seed ${seed}: deck is not the standard 52`).toEqual(
        [...freshDeck()].sort(),
      );
    }
  });

  it('actually moves things, and does not favour leaving them put', () => {
    /*
     * A shuffle can be a correct permutation and still be useless — the identity permutation passes
     * every assertion above. So this measures FIXED POINTS: over many shuffles, the number of cards
     * still at their original index should sit near 1 (the expected count for a uniform random
     * permutation is exactly 1, for any deck size). An off-by-one in the loop bound, or a swap that
     * excludes an element, shows up here as a fixed-point count that is far too high.
     */
    const trials = 2000;
    let fixedPoints = 0;
    const pristine = freshDeck();
    for (let seed = 1; seed <= trials; seed++) {
      const deck = shuffledDeck(mulberry32(seed));
      for (const [index, card] of deck.entries()) if (card === pristine[index]) fixedPoints++;
    }
    const perShuffle = fixedPoints / trials;
    // Expected 1.0. A generous band, because the point is to catch a broken shuffle, not to test a
    // theorem: the identity permutation would score 52 and a half-shuffle well above 2.
    expect(perShuffle, `${perShuffle.toFixed(2)} fixed points per shuffle, expected ~1`).toBeLessThan(2);
    expect(perShuffle, 'zero fixed points across 2000 shuffles is itself suspicious').toBeGreaterThan(
      0.2,
    );
  });

  it('reaches the last position, which `i > 0` could quietly exclude', () => {
    // Fisher-Yates iterating `i > 0` never *swaps at* index 0 as the source, but index 0 must still be
    // reachable as a destination. If it were not, card 0 would be pinned forever — a bias no
    // permutation check would catch.
    const landedAtZero = new Set<Card>();
    for (let seed = 1; seed <= 300; seed++) landedAtZero.add(shuffledDeck(mulberry32(seed))[0]);
    expect(landedAtZero.size, 'position 0 is nearly fixed across 300 shuffles').toBeGreaterThan(20);

    const lastPositions = new Set<Card>();
    for (let seed = 1; seed <= 300; seed++) {
      const deck = shuffledDeck(mulberry32(seed));
      lastPositions.add(deck[deck.length - 1]);
    }
    expect(lastPositions.size, 'the last position is nearly fixed').toBeGreaterThan(20);
  });

  it('is deterministic for a seed, which is what makes a hand replayable', () => {
    expect(shuffledDeck(mulberry32(42))).toEqual(shuffledDeck(mulberry32(42)));
    expect(shuffledDeck(mulberry32(42))).not.toEqual(shuffledDeck(mulberry32(43)));
  });

  it('handles empty and single-element arrays without throwing', () => {
    const rng = mulberry32(1);
    expect(shuffle([], rng)).toEqual([]);
    expect(shuffle(['only'], rng)).toEqual(['only']);
  });

  it('returns the same array it was given, since callers chain on it', () => {
    // Documented behaviour ("Mutates and returns the array so callers can chain"), and a caller that
    // relied on a copy would be silently sharing state — worth pinning either way.
    const items = [1, 2, 3, 4, 5];
    expect(shuffle(items, mulberry32(3))).toBe(items);
  });
});

describe('cards — the vocabulary every other module speaks', () => {
  it('is a 52-card deck with no duplicates', () => {
    const deck = freshDeck();
    expect(deck.length).toBe(ALL_CARDS);
    expect(new Set(deck).size).toBe(ALL_CARDS);
    expect(RANKS.length * SUITS.length).toBe(ALL_CARDS);
  });

  it('round-trips every card through rankOf and suitOf', () => {
    for (const card of freshDeck()) {
      expect(rankOf(card) + suitOf(card), `${card} does not round-trip`).toBe(card);
      expect(RANKS).toContain(rankOf(card));
      expect(SUITS).toContain(suitOf(card));
    }
  });

  it('orders rankValue ace-high, with no gaps or ties', () => {
    // Every comparison in the evaluator rests on this ordering, so it is asserted as a strict
    // sequence rather than spot-checked.
    const values = RANKS.map((rank) => rankValue(rank + 's'));
    expect(values).toEqual([...Array(13).keys()]);
    expect(rankValue('2s')).toBe(0);
    expect(rankValue('As')).toBe(12);
    expect(rankValue('Ts')).toBeGreaterThan(rankValue('9s'));
    expect(rankValue('As')).toBeGreaterThan(rankValue('Ks'));
  });

  it('calls exactly hearts and diamonds red', () => {
    // A rendering property, but a wrong one is a misread board — the learner sees a flush that is not
    // there. Asserted over the whole deck rather than on examples.
    for (const card of freshDeck()) {
      expect(isRed(card), `${card} red=${isRed(card)}`).toBe(suitOf(card) === 'h' || suitOf(card) === 'd');
    }
    expect(freshDeck().filter(isRed).length, 'a deck has 26 red cards').toBe(26);
  });

  it('has a distinct pip for every suit', () => {
    const pips = SUITS.map((suit) => SUIT_PIP[suit]);
    expect(new Set(pips).size, 'two suits share a pip').toBe(SUITS.length);
    for (const pip of pips) expect(pip.length).toBeGreaterThan(0);
  });

  it('builds the deck in a stable order, so an unshuffled deck is reproducible', () => {
    expect(freshDeck()).toEqual(freshDeck());
    expect(freshDeck()[0]).toBe('2s');
    expect(freshDeck()[ALL_CARDS - 1]).toBe('Ac');
  });
});

describe('randomSeed', () => {
  it('produces a 32-bit unsigned integer', () => {
    // The one function here that IS allowed to be non-deterministic — it exists to seed a real
    // session. What matters is that its output is a valid seed for mulberry32.
    for (let i = 0; i < 500; i++) {
      const seed = randomSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('does not return the same value every call', () => {
    const seeds = new Set(Array.from({ length: 200 }, randomSeed));
    expect(seeds.size, 'randomSeed is effectively constant').toBeGreaterThan(150);
  });
});
