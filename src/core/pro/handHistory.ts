/**
 * IMPORTED HAND HISTORIES — the one shape every site parser produces (Pro, D10 and D18).
 *
 * Review-only by design: a hand keeps the seats, the blinds, the betting and hero's cards, and nothing
 * else. No winnings, no rake, no pot totals, no chat. Offsuit never shows profit or loss on real-money
 * hands (D10), so a parser that never reads them cannot leak them into a screen. Opponents are stored by
 * seat, not by screen name: the leak finder reads hero's decisions only, and a stranger's name has no
 * business sitting in a file on this Mac.
 *
 * Amounts are whole HUNDREDTHS of the hand's unit (cents of a cash game's currency, or a hundredth of a
 * tournament chip), so $0.05 and 5 chips are both exact integers and no float ever reaches the maths.
 *
 * Every parser treats its input as hostile: bounded line lengths, anchored regexes with no nested
 * quantifiers, a hand that does not parse is SKIPPED with a reason (never thrown, never half-kept).
 */

import { RANKS, SUITS, type Card } from '../cards.js';

export const SITES = ['pokerstars', 'ggpoker', 'acr'] as const;
export type Site = (typeof SITES)[number];

export const SITE_NAMES: Readonly<Record<Site, string>> = {
  pokerstars: 'PokerStars',
  ggpoker: 'GGPoker',
  acr: 'ACR',
};

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export const STREETS: readonly Street[] = ['preflop', 'flop', 'turn', 'river'];

export type ActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise';

export interface HhAction {
  readonly street: Street;
  /** Index into `seats` (seat order), not the site's seat number. */
  readonly seat: number;
  readonly kind: ActionKind;
  /**
   * In hundredths. A call or bet: the chips it added. A raise: the TOTAL it raised to on this street
   * (every site prints "raises X to Y"; Y is kept). Fold and check: 0.
   */
  readonly amount: number;
  readonly allIn: boolean;
}

export interface HhSeat {
  /** The site's seat number (1-based on every site). */
  readonly seatNo: number;
  /** Starting stack, hundredths. */
  readonly stack: number;
  readonly isHero: boolean;
}

export interface ParsedHand {
  readonly site: Site;
  /** The site's hand number, as printed (digits, or GG's letter prefix and digits). */
  readonly id: string;
  readonly game: 'cash' | 'tournament';
  /** The date and time as printed, normalised to "YYYY-MM-DD HH:MM:SS" (site time zone), or null. */
  readonly playedAt: string | null;
  readonly maxSeats: number;
  /** Index into `seats` of the button. */
  readonly button: number;
  /** Blinds and ante, hundredths. Ante 0 when none was posted. */
  readonly sb: number;
  readonly bb: number;
  readonly ante: number;
  /** The players dealt in, in seat-number order. Sitting-out seats are not here. */
  readonly seats: readonly HhSeat[];
  /** Index into `seats` of hero, the player the site dealt visible cards to. */
  readonly hero: number;
  readonly heroCards: readonly [Card, Card];
  /** Voluntary actions in order (blind and ante posts are not actions; `sb`/`bb`/`ante` carry them). */
  readonly actions: readonly HhAction[];
  /** Index into `seats` of each blind poster (null when nobody posted it, e.g. a dead small blind). */
  readonly sbSeat: number | null;
  readonly bbSeat: number | null;
  /** The board as far as it was dealt (the first board of a run-it-twice). */
  readonly board: readonly Card[];
  /** True when hero's hand went to showdown (hero had cards at the end and the river was dealt with two or more live). */
  readonly showdown: boolean;
}

export type SkipReason =
  | 'not-holdem'
  | 'not-no-limit'
  | 'no-hero-cards'
  | 'malformed'
  | 'too-long'
  /** Cut off before its summary: the file was copied while the site was still writing the hand. */
  | 'partial'
  | 'unknown-site';

export interface ParseResult {
  readonly hands: ParsedHand[];
  /** The first MAX_SKIP_RECORDS hands seen but not kept, with why (a junk file makes millions). */
  readonly skipped: { readonly id: string | null; readonly reason: SkipReason }[];
  /** Every skip, counted by reason. */
  readonly skipCounts: Partial<Record<SkipReason, number>>;
}

export const MAX_SKIP_RECORDS = 1000;

/** The longest line any parser reads; longer ones make the hand malformed (no regex ever sees them). */
export const MAX_LINE = 400;
/** The most lines one hand may have (a real hand is under 100). */
export const MAX_HAND_LINES = 400;

const CARD_RE = /^[2-9TJQKA][shdc]$/;

export function isCard(s: string): s is Card {
  return CARD_RE.test(s) && RANKS.includes(s[0] as never) && SUITS.includes(s[1] as never);
}

/** "[Ah Kd]" or "[  Ah Kd ]" (ACR pads) to cards, or null when any card is not a card or one repeats. */
export function parseCards(bracketed: string): Card[] | null {
  const inner = bracketed.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
  if (inner === '') return [];
  const parts = inner.split(/\s+/);
  if (parts.length > 5 || !parts.every(isCard)) return null;
  if (new Set(parts).size !== parts.length) return null;
  return parts;
}

/**
 * "$1,234.56", "€0.05", "1500", "1,500.00" to hundredths, or null. At most 12 integer digits, so a hostile
 * file cannot push an amount past the integers a double holds exactly.
 */
export function parseAmount(raw: string): number | null {
  const m = /^[$€£]?(\d{1,3}(?:,\d{3}){0,3}|\d{1,12})(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (m === null) return null;
  const whole = Number(m[1].replace(/,/g, ''));
  const frac = m[2] === undefined ? 0 : Number(m[2].padEnd(2, '0'));
  const v = whole * 100 + frac;
  return Number.isSafeInteger(v) ? v : null;
}

/** "2023/03/14 19:42:11" or "2023-03-14 19:42:11" to "2023-03-14 19:42:11"; null when it is not one. */
export function normaliseDate(raw: string): string | null {
  const m = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(raw);
  if (m === null) return null;
  const pad = (s: string): string => s.padStart(2, '0');
  return `${m[1]}-${pad(m[2])}-${pad(m[3])} ${pad(m[4])}:${m[5]}:${m[6]}`;
}

/** The key a hand is stored and de-duplicated under. */
export function handKey(hand: Pick<ParsedHand, 'site' | 'id'>): string {
  return `${hand.site}:${hand.id}`;
}

/**
 * A stored hand read back from disk is untrusted too (the file may have been edited): this checks every
 * field a consumer indexes or does arithmetic on, so a doctored line is dropped rather than crashing the
 * leak finder or pointing an index out of range.
 */
export function isParsedHand(raw: unknown): raw is ParsedHand {
  if (typeof raw !== 'object' || raw === null) return false;
  const h = raw as Record<string, unknown>;
  const int = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): boolean =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
  if (!(SITES as readonly unknown[]).includes(h.site)) return false;
  if (typeof h.id !== 'string' || !/^[A-Za-z0-9-]{1,40}$/.test(h.id)) return false;
  if (h.game !== 'cash' && h.game !== 'tournament') return false;
  if (h.playedAt !== null && (typeof h.playedAt !== 'string' || normaliseDate(h.playedAt) !== h.playedAt)) return false;
  if (!int(h.maxSeats, 2, 10) || !int(h.sb) || !int(h.bb, 1) || !int(h.ante)) return false;
  if (!Array.isArray(h.seats) || h.seats.length < 2 || h.seats.length > 10) return false;
  const n = h.seats.length;
  const seatOk = (s: unknown): boolean => {
    if (typeof s !== 'object' || s === null) return false;
    const o = s as Record<string, unknown>;
    return int(o.seatNo, 1, 10) && int(o.stack) && typeof o.isHero === 'boolean';
  };
  if (!h.seats.every(seatOk)) return false;
  if (!int(h.button, 0, n - 1) || !int(h.hero, 0, n - 1)) return false;
  if ((h.seats as { isHero: boolean }[]).filter((s) => s.isHero).length !== 1) return false;
  if (!(h.seats as { isHero: boolean }[])[h.hero as number].isHero) return false;
  for (const k of ['sbSeat', 'bbSeat'] as const) if (h[k] !== null && !int(h[k], 0, n - 1)) return false;
  const cardsOk = (v: unknown, min: number, max: number): boolean =>
    Array.isArray(v) && v.length >= min && v.length <= max && v.every((c) => typeof c === 'string' && isCard(c));
  if (!cardsOk(h.heroCards, 2, 2) || !cardsOk(h.board, 0, 5)) return false;
  if (new Set([...(h.heroCards as string[]), ...(h.board as string[])]).size !== 2 + (h.board as string[]).length) return false;
  if (typeof h.showdown !== 'boolean') return false;
  if (!Array.isArray(h.actions) || h.actions.length > MAX_HAND_LINES) return false;
  return h.actions.every((a) => {
    if (typeof a !== 'object' || a === null) return false;
    const o = a as Record<string, unknown>;
    return (
      (STREETS as readonly unknown[]).includes(o.street) &&
      int(o.seat, 0, n - 1) &&
      ['fold', 'check', 'call', 'bet', 'raise'].includes(o.kind as string) &&
      int(o.amount) &&
      typeof o.allIn === 'boolean'
    );
  });
}
