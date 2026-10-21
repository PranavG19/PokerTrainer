/**
 * Challenge codes: a short, typeable code for one seeded spot, so a friend plays the same spot you did.
 *
 * Pure. A code is bytes, written in Crockford base32 and grouped in fours after an `OS-` marker:
 *
 *   byte 0       format version (high 3 bits, 1 today) and kind (low 5 bits)
 *   bytes 1..n   the kind's fields, each an unsigned LEB128 varint (puzzle ids are a fixed 4-byte hash)
 *   last 2       CRC-16/CCITT-FALSE over every byte before it
 *
 * The version and the checksum are inside the code itself: a mistyped character fails the checksum (CRC-16
 * catches every error of one or two adjacent characters), and a code from a newer format says so instead
 * of opening the wrong spot. Reading is forgiving of how a person copies a code: case, spaces, dashes and
 * the look-alikes Crockford names (I and L read as 1, O as 0) do not matter.
 *
 * What each kind reproduces:
 * - `hand`: the table deal. The deck is a function of (seed, hand number), the seated archetypes and their
 *   jitter of the seed alone, so the same code deals the same cards, button, opponents and depth. The
 *   villains decide from a stream keyed on the code, so the same actions meet the same replies.
 * - `drill`: one Math problem (core/arithmetic.ts), its kind and its place in the drill's seeded sequence.
 * - `puzzle`: one scenario from the puzzle library, by a hash of its id.
 */

import { DRILL_KINDS, type DrillKind } from './arithmetic.js';
import { SCENARIOS } from './puzzleScenarios.js';

export const CHALLENGE_FORMAT_VERSION = 1;
export const CHALLENGE_PREFIX = 'OS';

export type Challenge =
  | {
      readonly kind: 'hand';
      /** The table seed, a uint32. */
      readonly seed: number;
      /** The hand's number at that seed (1-based): the deck is shuffled from seed + handNumber. */
      readonly handNumber: number;
      /** The seat on the button, 0 = you. */
      readonly button: number;
      readonly seats: number;
      /** Starting stacks, in big blinds. */
      readonly depthBb: number;
    }
  | { readonly kind: 'drill'; readonly drill: DrillKind; readonly index: number }
  | { readonly kind: 'puzzle'; readonly scenarioId: string };

export type ChallengeError =
  | 'empty'
  | 'bad-character'
  | 'too-short'
  | 'checksum'
  | 'newer-version'
  | 'unknown-kind'
  | 'malformed'
  | 'out-of-range'
  | 'unknown-spot'
  | 'club-code';

/** Bounds a code may carry. A decoded value outside them is refused, never clamped. */
export const HAND_LIMITS = {
  handNumber: { min: 1, max: 1_000_000 },
  seats: { min: 2, max: 10 },
  depthBb: { min: 10, max: 1000 },
} as const;
export const MAX_DRILL_INDEX = 1_000_000;

/** Kind numbers are part of the format: append, never renumber. */
const KIND_CODES = { hand: 1, drill: 2, puzzle: 3 } as const;
/**
 * Kinds the LAN Club reads (core/club/codes.ts): a shared spot and a Game Night recap. Taken here so a new
 * challenge kind never reuses their numbers; decodeChallenge answers 'club-code' for them.
 */
export const CLUB_KIND_CODES = { spot: 4, recap: 5 } as const;
/** Drill kinds in format order; a new DrillKind is appended here. */
const DRILL_CODES: readonly DrillKind[] = ['pot-odds', 'alpha', 'mdf', 'spr', 'combos'];

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Longest code accepted, in base32 characters (well above any kind's). */
export const MAX_CHARS = 64;

// ---- checksum and varints ----

/** CRC-16/CCITT-FALSE: polynomial 0x1021, initial 0xFFFF, no reflection, no final XOR. */
export function crc16(bytes: readonly number[]): number {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

export function pushVarint(out: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

/** Reads one varint at `at`; null if it runs off the end, is over-long, or exceeds 2^32 - 1. */
export function readVarint(bytes: readonly number[], at: number): { value: number; next: number } | null {
  let value = 0;
  let scale = 1;
  for (let i = at; i < bytes.length && i < at + 5; i++) {
    const b = bytes[i];
    value += (b & 0x7f) * scale;
    if ((b & 0x80) === 0) {
      // A trailing zero byte would make two spellings of one number (and so two codes for one spot).
      if (b === 0 && i > at) return null;
      return value > 0xffffffff ? null : { value, next: i + 1 };
    }
    scale *= 0x80;
  }
  return null;
}

/** FNV-1a, 32-bit: a puzzle id's fixed-size stand-in. tests/unit/challengeCode.test.ts asserts no collisions. */
export function idHash(id: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(id)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ---- base32 ----

export function toBase32(bytes: readonly number[]): string {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

/** null when the characters cannot be a whole number of bytes, or the padding bits are not zero. */
export function fromBase32(chars: string): number[] | null {
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const c of chars) {
    acc = (acc << 5) | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bytes.push((acc >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
    acc &= (1 << bits) - 1;
  }
  if (bits >= 5 || acc !== 0) return null;
  return bytes;
}

/** Case, whitespace, dashes and the Crockford look-alikes do not matter; the `OS` marker is optional. */
export function normalizeChallengeText(raw: string): string {
  let s = raw.toUpperCase().replace(/[\s\-_.]/g, '');
  if (s.startsWith(CHALLENGE_PREFIX)) s = s.slice(CHALLENGE_PREFIX.length);
  return s.replace(/[IL]/g, '1').replace(/O/g, '0');
}

export function group(chars: string): string {
  return chars.match(/.{1,4}/g)?.join('-') ?? '';
}

// ---- encode / decode ----

export function isValidChallenge(c: Challenge): boolean {
  if (c.kind === 'hand') {
    const int = (v: number, min: number, max: number): boolean => Number.isInteger(v) && v >= min && v <= max;
    return (
      int(c.seed, 0, 0xffffffff) &&
      int(c.handNumber, HAND_LIMITS.handNumber.min, HAND_LIMITS.handNumber.max) &&
      int(c.seats, HAND_LIMITS.seats.min, HAND_LIMITS.seats.max) &&
      int(c.button, 0, c.seats - 1) &&
      int(c.depthBb, HAND_LIMITS.depthBb.min, HAND_LIMITS.depthBb.max)
    );
  }
  if (c.kind === 'drill') return DRILL_CODES.includes(c.drill) && Number.isInteger(c.index) && c.index >= 0 && c.index <= MAX_DRILL_INDEX;
  return SCENARIOS.some((s) => s.id === c.scenarioId);
}

/** The code for a challenge, e.g. `OS-0A1B-…`. Throws on a challenge no build could open (a caller's bug). */
export function encodeChallenge(c: Challenge): string {
  if (!isValidChallenge(c)) throw new RangeError(`not a valid challenge: ${JSON.stringify(c)}`);
  const bytes = [(CHALLENGE_FORMAT_VERSION << 5) | KIND_CODES[c.kind]];
  if (c.kind === 'hand') {
    for (const v of [c.seed, c.handNumber, c.button, c.seats, c.depthBb]) pushVarint(bytes, v);
  } else if (c.kind === 'drill') {
    pushVarint(bytes, DRILL_CODES.indexOf(c.drill));
    pushVarint(bytes, c.index);
  } else {
    const h = idHash(c.scenarioId);
    bytes.push((h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff);
  }
  const crc = crc16(bytes);
  bytes.push(crc >>> 8, crc & 0xff);
  return `${CHALLENGE_PREFIX}-${group(toBase32(bytes))}`;
}

export type DecodeResult = { readonly ok: true; readonly challenge: Challenge } | { readonly ok: false; readonly error: ChallengeError };

const fail = (error: ChallengeError): DecodeResult => ({ ok: false, error });

export function decodeChallenge(raw: string): DecodeResult {
  if (typeof raw !== 'string') return fail('malformed');
  const chars = normalizeChallengeText(raw.slice(0, MAX_CHARS * 2));
  if (chars === '') return fail('empty');
  if (chars.length > MAX_CHARS) return fail('malformed');
  if ([...chars].some((c) => !ALPHABET.includes(c))) return fail('bad-character');
  const bytes = fromBase32(chars);
  if (bytes === null) return fail('checksum');
  if (bytes.length < 4) return fail('too-short');
  const body = bytes.slice(0, -2);
  const crc = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1];
  if (crc16(body) !== crc) return fail('checksum');

  const version = body[0] >>> 5;
  if (version > CHALLENGE_FORMAT_VERSION) return fail('newer-version');
  if (version !== CHALLENGE_FORMAT_VERSION) return fail('malformed');
  const kindCode = body[0] & 31;

  const fields = (n: number): number[] | null => {
    const out: number[] = [];
    let at = 1;
    for (let i = 0; i < n; i++) {
      const v = readVarint(body, at);
      if (v === null) return null;
      out.push(v.value);
      at = v.next;
    }
    return at === body.length ? out : null;
  };

  let challenge: Challenge;
  if (kindCode === KIND_CODES.hand) {
    const f = fields(5);
    if (f === null) return fail('malformed');
    const [seed, handNumber, button, seats, depthBb] = f;
    challenge = { kind: 'hand', seed, handNumber, button, seats, depthBb };
  } else if (kindCode === KIND_CODES.drill) {
    const f = fields(2);
    if (f === null) return fail('malformed');
    if (f[0] >= DRILL_CODES.length) return fail('unknown-spot');
    challenge = { kind: 'drill', drill: DRILL_CODES[f[0]], index: f[1] };
  } else if (kindCode === KIND_CODES.puzzle) {
    if (body.length !== 5) return fail('malformed');
    const h = ((body[1] << 24) | (body[2] << 16) | (body[3] << 8) | body[4]) >>> 0;
    const scenario = SCENARIOS.find((s) => idHash(s.id) === h);
    if (scenario === undefined) return fail('unknown-spot');
    challenge = { kind: 'puzzle', scenarioId: scenario.id };
  } else if (kindCode === CLUB_KIND_CODES.spot || kindCode === CLUB_KIND_CODES.recap) {
    return fail('club-code');
  } else {
    return fail('unknown-kind');
  }
  if (!isValidChallenge(challenge)) return fail('out-of-range');
  return { ok: true, challenge };
}

/** One line a person reads before playing, from the decoded fields only. */
export function describeChallenge(c: Challenge): string {
  if (c.kind === 'hand') {
    const where = c.button === 0 ? 'you on the button' : `seat ${c.button} on the button`;
    return `A ${c.seats}-handed hand at ${c.depthBb} big blinds, ${where}.`;
  }
  if (c.kind === 'drill') return `A Math problem: ${c.drill.replace('-', ' ')}.`;
  const scenario = SCENARIOS.find((s) => s.id === c.scenarioId);
  return `A puzzle: ${scenario?.title ?? c.scenarioId}.`;
}

/** Plain-language reasons, for the code field's notice. */
export const CHALLENGE_ERROR_TEXT: Record<ChallengeError, string> = {
  empty: 'Type or paste a code first.',
  'bad-character': 'That has a character no code uses. Codes are letters and digits.',
  'too-short': 'That code is too short. Check it was copied whole.',
  checksum: 'That code does not check out. A character is probably mistyped.',
  'newer-version': 'That code is from a newer Offsuit. Update to play it.',
  'unknown-kind': 'That code is for a kind of spot this version cannot open.',
  malformed: 'That is not a code this version can read.',
  'out-of-range': 'That code names a spot this version cannot set up.',
  'unknown-spot': 'That spot is not in this version. It may be from a newer Offsuit.',
  'club-code': 'That is a LAN Club code. Open it from Play, LAN Club.',
};

/** Every drill kind has a format number: a new kind without one fails here, not in a friend's hands. */
export const DRILL_KINDS_COVERED = DRILL_KINDS.every((k) => DRILL_CODES.includes(k));
