import type { Rng } from './rng.js';
import { shuffle } from './rng.js';

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
export const SUITS = ['s', 'h', 'd', 'c'] as const;

export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];

/** A card is its two-char string, e.g. "As", "Th". Compact, printable, easy to assert in tests. */
export type Card = string;

export const rankOf = (card: Card): Rank => card[0] as Rank;
export const suitOf = (card: Card): Suit => card[1] as Suit;

/** 2 => 0 ... A => 12 */
export const rankValue = (card: Card): number => RANKS.indexOf(rankOf(card));

export const isRed = (card: Card): boolean => suitOf(card) === 'h' || suitOf(card) === 'd';

export const SUIT_PIP: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
}

export function shuffledDeck(rng: Rng): Card[] {
  return shuffle(freshDeck(), rng);
}
