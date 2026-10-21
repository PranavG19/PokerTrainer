/**
 * LAN Club codes: the two things a club passes between its members by hand, in the challenge-code format
 * (core/challengeCode.ts: the `OS-` marker, Crockford base32, a version and kind byte, a CRC-16 at the end).
 *
 *   spot   one decision from a Game Night: your cards, the board, the pot, the price, your stack, how many
 *          were still in, and (optionally) what you chose. A friend plays it and sees the same grade.
 *   recap  your Game Night in four counts (hands, decisions graded, clean decisions, big blinds lost) plus
 *          the night it belongs to and your table name. Friends paste each other's into their recap.
 *
 * Pure. Nothing here travels over the relay: a code is read aloud, pasted or scanned, and the relay protocol
 * is unchanged. A recap is counts only, never cards or chips; a spot is one decision you chose to share.
 */

import { RANKS, SUITS, type Card } from '../cards.js';
import {
  CHALLENGE_FORMAT_VERSION,
  CHALLENGE_PREFIX,
  CLUB_KIND_CODES,
  crc16,
  fromBase32,
  group,
  idHash,
  MAX_CHARS,
  normalizeChallengeText,
  pushVarint,
  readVarint,
  toBase32,
} from '../challengeCode.js';
import type { ActionKind } from '../table.js';
import type { DayKey } from '../localDay.js';
import type { NightRecap } from '../progression/types.js';

/** One shared decision. `street` follows from the board: 0 cards preflop, 3 flop, 4 turn, 5 river. */
export interface SharedSpot {
  readonly hole: readonly [Card, Card];
  readonly board: readonly Card[];
  readonly bb: number;
  readonly pot: number;
  readonly toCall: number;
  readonly stack: number;
  /** Players still in the hand besides the one deciding. */
  readonly opponents: number;
  /** What the sharer chose, or null when they share the spot without their answer. */
  readonly chosen: ActionKind | null;
}

/** One player's Game Night, as counts (the persisted shape). `night` names the table (see nightIdOf). */
export type { NightRecap } from '../progression/types.js';

export type ClubCode = { readonly kind: 'spot'; readonly spot: SharedSpot } | { readonly kind: 'recap'; readonly recap: NightRecap };

export type ClubCodeError = 'empty' | 'bad-character' | 'checksum' | 'newer-version' | 'not-club' | 'malformed' | 'out-of-range';

export const CLUB_CODE_ERROR_TEXT: Record<ClubCodeError, string> = {
  empty: 'Type or paste a code first.',
  'bad-character': 'That has a character no code uses. Codes are letters and digits.',
  checksum: 'That code does not check out. A character is probably mistyped.',
  'newer-version': 'That code is from a newer Offsuit. Update to open it.',
  'not-club': 'That is not a club code.',
  malformed: 'That is not a code this version can read.',
  'out-of-range': 'That code names a spot this version cannot set up.',
};

/** Action kinds in format order: append, never renumber. 0 is "not shared". */
const ACTION_CODES: readonly ActionKind[] = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];

/** The bounds a code may carry; a value outside them is refused, never clamped. */
export const SPOT_LIMITS = { bb: 1_000_000, chips: 100_000_000, opponents: 9 } as const;
export const RECAP_LIMITS = { count: 1_000_000, lossCentiBb: 0x0fffffff, nameBytes: 16 } as const;

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BOARD_SIZES = [0, 3, 4, 5];

/** A card as one byte, rank-major: 2s = 0 … Ac = 51. */
export function cardByte(card: Card): number {
  const r = RANKS.indexOf(card[0] as (typeof RANKS)[number]);
  const s = SUITS.indexOf(card[1] as (typeof SUITS)[number]);
  return card.length === 2 && r >= 0 && s >= 0 ? r * 4 + s : -1;
}

function byteCard(b: number): Card | null {
  return b >= 0 && b < 52 ? `${RANKS[Math.floor(b / 4)]}${SUITS[b % 4]}` : null;
}

/** The night a table belongs to: a 32-bit hash of its certificate fingerprint, which host and guests both know. */
export function nightIdOf(fingerprint: string): string {
  return idHash(fingerprint).toString(16).padStart(8, '0');
}

/** Table names are trimmed, single-spaced and cut to fit a code (16 UTF-8 bytes, whole characters only). */
export function clubName(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const enc = new TextEncoder();
  // Cut on whole graphemes, so a joined emoji is kept or dropped whole, never split.
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((g) => g.segment);
  while (enc.encode(graphemes.join('')).length > RECAP_LIMITS.nameBytes) graphemes.pop();
  return graphemes.join('').trim();
}

export function isValidSpot(s: SharedSpot): boolean {
  const int = (v: number, min: number, max: number): boolean => Number.isInteger(v) && v >= min && v <= max;
  const cards = [...s.hole, ...s.board];
  const bytes = cards.map(cardByte);
  return (
    s.hole.length === 2 &&
    BOARD_SIZES.includes(s.board.length) &&
    bytes.every((b) => b >= 0) &&
    new Set(bytes).size === bytes.length &&
    int(s.bb, 1, SPOT_LIMITS.bb) &&
    int(s.pot, 0, SPOT_LIMITS.chips) &&
    int(s.toCall, 0, SPOT_LIMITS.chips) &&
    int(s.stack, 0, SPOT_LIMITS.chips) &&
    int(s.opponents, 1, SPOT_LIMITS.opponents) &&
    (s.chosen === null || ACTION_CODES.includes(s.chosen))
  );
}

export function isValidRecap(r: NightRecap): boolean {
  const int = (v: number, max: number): boolean => Number.isInteger(v) && v >= 0 && v <= max;
  return (
    /^[0-9a-f]{8}$/.test(r.night) &&
    int(r.day, 0x1fffff) &&
    r.name.length > 0 &&
    clubName(r.name) === r.name &&
    int(r.hands, RECAP_LIMITS.count) &&
    int(r.decisions, RECAP_LIMITS.count) &&
    int(r.clean, r.decisions) &&
    int(r.lossCentiBb, RECAP_LIMITS.lossCentiBb)
  );
}

function finish(bytes: number[]): string {
  const crc = crc16(bytes);
  bytes.push(crc >>> 8, crc & 0xff);
  return `${CHALLENGE_PREFIX}-${group(toBase32(bytes))}`;
}

/** The code for a club item. Throws on one no build could open (a caller's bug). */
export function encodeClubCode(c: ClubCode): string {
  if (c.kind === 'spot') {
    const s = c.spot;
    if (!isValidSpot(s)) throw new RangeError(`not a valid spot: ${JSON.stringify(s)}`);
    const bytes = [(CHALLENGE_FORMAT_VERSION << 5) | CLUB_KIND_CODES.spot];
    bytes.push(...s.hole.map(cardByte), s.board.length, ...s.board.map(cardByte));
    for (const v of [s.bb, s.pot, s.toCall, s.stack, s.opponents]) pushVarint(bytes, v);
    bytes.push(s.chosen === null ? 0 : ACTION_CODES.indexOf(s.chosen) + 1);
    return finish(bytes);
  }
  const r = c.recap;
  if (!isValidRecap(r)) throw new RangeError(`not a valid recap: ${JSON.stringify(r)}`);
  const bytes = [(CHALLENGE_FORMAT_VERSION << 5) | CLUB_KIND_CODES.recap];
  const night = Number.parseInt(r.night, 16);
  bytes.push((night >>> 24) & 0xff, (night >>> 16) & 0xff, (night >>> 8) & 0xff, night & 0xff);
  for (const v of [r.day, r.hands, r.decisions, r.clean, r.lossCentiBb]) pushVarint(bytes, v);
  const name = [...new TextEncoder().encode(r.name)];
  bytes.push(name.length, ...name);
  return finish(bytes);
}

export type ClubDecode = { readonly ok: true; readonly code: ClubCode } | { readonly ok: false; readonly error: ClubCodeError };

const fail = (error: ClubCodeError): ClubDecode => ({ ok: false, error });

export function decodeClubCode(raw: string): ClubDecode {
  if (typeof raw !== 'string') return fail('malformed');
  const chars = normalizeChallengeText(raw.slice(0, MAX_CHARS * 2));
  if (chars === '') return fail('empty');
  if (chars.length > MAX_CHARS) return fail('malformed');
  if ([...chars].some((c) => !ALPHABET.includes(c))) return fail('bad-character');
  const bytes = fromBase32(chars);
  if (bytes === null) return fail('checksum');
  if (bytes.length < 4) return fail('malformed');
  const body = bytes.slice(0, -2);
  if (crc16(body) !== ((bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1])) return fail('checksum');
  const version = body[0] >>> 5;
  if (version > CHALLENGE_FORMAT_VERSION) return fail('newer-version');
  if (version !== CHALLENGE_FORMAT_VERSION) return fail('malformed');
  const kind = body[0] & 31;

  let at = 1;
  const varints = (n: number): number[] | null => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = readVarint(body, at);
      if (v === null) return null;
      out.push(v.value);
      at = v.next;
    }
    return out;
  };

  if (kind === CLUB_KIND_CODES.spot) {
    if (body.length < 4) return fail('malformed');
    const hole = [byteCard(body[1]), byteCard(body[2])];
    const boardLen = body[3];
    if (!BOARD_SIZES.includes(boardLen) || body.length < 4 + boardLen) return fail('malformed');
    const board = body.slice(4, 4 + boardLen).map(byteCard);
    at = 4 + boardLen;
    const f = varints(5);
    if (f === null || at !== body.length - 1) return fail('malformed');
    const chosenCode = body[at];
    if (hole.includes(null) || board.includes(null) || chosenCode > ACTION_CODES.length) return fail('out-of-range');
    const spot: SharedSpot = {
      hole: [hole[0]!, hole[1]!],
      board: board as Card[],
      bb: f[0],
      pot: f[1],
      toCall: f[2],
      stack: f[3],
      opponents: f[4],
      chosen: chosenCode === 0 ? null : ACTION_CODES[chosenCode - 1],
    };
    return isValidSpot(spot) ? { ok: true, code: { kind: 'spot', spot } } : fail('out-of-range');
  }
  if (kind === CLUB_KIND_CODES.recap) {
    if (body.length < 5) return fail('malformed');
    const night = ((body[1] << 24) | (body[2] << 16) | (body[3] << 8) | body[4]) >>> 0;
    at = 5;
    const f = varints(5);
    if (f === null || at >= body.length) return fail('malformed');
    const len = body[at];
    if (len === 0 || len > RECAP_LIMITS.nameBytes || at + 1 + len !== body.length) return fail('malformed');
    let name: string;
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(body.slice(at + 1)));
    } catch {
      return fail('malformed');
    }
    const recap: NightRecap = {
      night: night.toString(16).padStart(8, '0'),
      day: f[0] as DayKey,
      name,
      hands: f[1],
      decisions: f[2],
      clean: f[3],
      lossCentiBb: f[4],
    };
    return isValidRecap(recap) ? { ok: true, code: { kind: 'recap', recap } } : fail('out-of-range');
  }
  return fail('not-club');
}

const STREETS = ['preflop', '', '', 'flop', 'turn', 'river'];

export function streetOf(spot: SharedSpot): string {
  return STREETS[spot.board.length] ?? 'preflop';
}

/** One line a person reads before opening a club code, from the decoded fields only. */
export function describeClubCode(c: ClubCode): string {
  if (c.kind === 'recap') {
    const r = c.recap;
    return `${r.name}'s Game Night: ${r.decisions} decision${r.decisions === 1 ? '' : 's'} graded over ${r.hands} hand${r.hands === 1 ? '' : 's'}.`;
  }
  const s = c.spot;
  const price = s.toCall > 0 ? `${s.toCall} to call into ${s.pot}` : `checked to, ${s.pot} in the pot`;
  return `A ${streetOf(s)} spot: ${price}, ${s.opponents} still in.`;
}
