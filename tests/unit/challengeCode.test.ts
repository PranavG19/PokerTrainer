import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_ERROR_TEXT,
  CHALLENGE_FORMAT_VERSION,
  crc16,
  decodeChallenge,
  describeChallenge,
  DRILL_KINDS_COVERED,
  encodeChallenge,
  idHash,
  normalizeChallengeText,
  type Challenge,
} from '../../src/core/challengeCode.js';
import { DRILL_KINDS } from '../../src/core/arithmetic.js';
import { SCENARIOS } from '../../src/core/puzzleScenarios.js';
import { encodeQr } from '../../src/core/qr.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const hand = (over: Partial<Extract<Challenge, { kind: 'hand' }>> = {}): Challenge => ({
  kind: 'hand',
  seed: 42,
  handNumber: 7,
  button: 2,
  seats: 4,
  depthBb: 100,
  ...over,
});

describe('round trip', () => {
  it('every kind decodes to exactly what was encoded', () => {
    const cases: Challenge[] = [
      hand(),
      hand({ seed: 0, handNumber: 1, button: 0 }),
      hand({ seed: 0xffffffff, handNumber: 1_000_000, button: 9, seats: 10, depthBb: 1000 }),
      hand({ seats: 2, button: 1, depthBb: 10 }),
      ...DRILL_KINDS.map((drill, i): Challenge => ({ kind: 'drill', drill, index: i * 977 })),
      { kind: 'drill', drill: 'spr', index: 1_000_000 },
      ...SCENARIOS.map((s): Challenge => ({ kind: 'puzzle', scenarioId: s.id })),
    ];
    for (const c of cases) {
      const code = encodeChallenge(c);
      expect(decodeChallenge(code), code).toEqual({ ok: true, challenge: c });
    }
  });

  it('round-trips a sweep of random hands', () => {
    let x = 12345;
    const next = () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0);
    for (let i = 0; i < 2000; i++) {
      const seats = 2 + (next() % 9);
      const c = hand({ seed: next(), handNumber: 1 + (next() % 1_000_000), seats, button: next() % seats, depthBb: 10 + (next() % 991) });
      expect(decodeChallenge(encodeChallenge(c))).toEqual({ ok: true, challenge: c });
    }
  });

  it('is short enough to read aloud, and fits a small QR', () => {
    const longest = encodeChallenge(hand({ seed: 0xffffffff, handNumber: 1_000_000, seats: 10, button: 9, depthBb: 1000 }));
    expect(longest.length).toBeLessThanOrEqual(32);
    expect(encodeQr(longest, { ecl: 'M' }).version).toBeLessThanOrEqual(2);
    expect(longest).toMatch(/^OS-[0-9A-Z]{4}(-[0-9A-Z]{1,4})+$/);
  });
});

describe('reading what a person typed', () => {
  it('ignores case, spaces, dashes and the marker, and reads Crockford look-alikes', () => {
    const code = encodeChallenge(hand());
    const body = code.slice(3).replace(/-/g, '');
    for (const typed of [code, code.toLowerCase(), ` ${body} `, body.match(/.{1,3}/g)!.join(' '), `os ${body}`]) {
      expect(decodeChallenge(typed), typed).toEqual({ ok: true, challenge: hand() });
    }
    expect(normalizeChallengeText('os-1il0o')).toBe('11100');
  });
});

describe('the checksum', () => {
  it('catches every single-character substitution', () => {
    const code = encodeChallenge(hand());
    const body = normalizeChallengeText(code);
    for (let i = 0; i < body.length; i++) {
      for (const c of ALPHABET) {
        if (c === body[i]) continue;
        const typo = body.slice(0, i) + c + body.slice(i + 1);
        expect(decodeChallenge(typo).ok, `${typo}`).toBe(false);
      }
    }
  });

  it('catches every adjacent transposition, a dropped character and an added one', () => {
    for (const c of [hand(), hand({ seed: 0xdeadbeef }), { kind: 'drill', drill: 'mdf', index: 31 } as Challenge]) {
      const body = normalizeChallengeText(encodeChallenge(c));
      for (let i = 0; i + 1 < body.length; i++) {
        if (body[i] === body[i + 1]) continue;
        const swapped = body.slice(0, i) + body[i + 1] + body[i] + body.slice(i + 2);
        expect(decodeChallenge(swapped).ok).toBe(false);
      }
      for (let i = 0; i < body.length; i++) expect(decodeChallenge(body.slice(0, i) + body.slice(i + 1)).ok).toBe(false);
      expect(decodeChallenge(body + '0').ok).toBe(false);
    }
  });

  it('is CRC-16/CCITT-FALSE (check value 0x29B1)', () => {
    expect(crc16([...new TextEncoder().encode('123456789')])).toBe(0x29b1);
  });
});

/** Build a code from raw bytes with a valid checksum, to reach the checks behind it. */
function rawCode(bytes: number[]): string {
  const crc = crc16(bytes);
  const all = [...bytes, crc >>> 8, crc & 0xff];
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const b of all) {
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

describe('refusals', () => {
  it('says why, and never opens a different spot', () => {
    expect(decodeChallenge('')).toEqual({ ok: false, error: 'empty' });
    expect(decodeChallenge('OS-')).toEqual({ ok: false, error: 'empty' });
    expect(decodeChallenge('OS-4A!B')).toEqual({ ok: false, error: 'bad-character' });
    expect(decodeChallenge('OS-4AUB')).toEqual({ ok: false, error: 'bad-character' });
    expect(decodeChallenge('4A')).toMatchObject({ ok: false });
    expect(decodeChallenge('Z'.repeat(200))).toEqual({ ok: false, error: 'malformed' });
  });

  it('a newer format version is named as such', () => {
    expect(decodeChallenge(rawCode([((CHALLENGE_FORMAT_VERSION + 1) << 5) | 1, 1, 1, 0, 4, 100]))).toEqual({ ok: false, error: 'newer-version' });
    expect(decodeChallenge(rawCode([(0 << 5) | 1, 1, 1, 0, 4, 100]))).toEqual({ ok: false, error: 'malformed' });
  });

  it('an unknown kind, a bad field list or an out-of-range value is refused, not clamped', () => {
    const v = CHALLENGE_FORMAT_VERSION << 5;
    expect(decodeChallenge(rawCode([v | 9, 1]))).toEqual({ ok: false, error: 'unknown-kind' });
    expect(decodeChallenge(rawCode([v | 1, 1, 1, 0, 4]))).toEqual({ ok: false, error: 'malformed' });
    expect(decodeChallenge(rawCode([v | 1, 1, 1, 0, 4, 100, 7]))).toEqual({ ok: false, error: 'malformed' });
    // A varint with a redundant trailing zero byte (two spellings of one number).
    expect(decodeChallenge(rawCode([v | 1, 0x81, 0x00, 1, 0, 4, 100]))).toEqual({ ok: false, error: 'malformed' });
    // Button 4 at a 4-seat table; hand number 0; depth 5.
    expect(decodeChallenge(rawCode([v | 1, 1, 1, 4, 4, 100]))).toEqual({ ok: false, error: 'out-of-range' });
    expect(decodeChallenge(rawCode([v | 1, 1, 0, 0, 4, 100]))).toEqual({ ok: false, error: 'out-of-range' });
    expect(decodeChallenge(rawCode([v | 1, 1, 1, 0, 4, 5]))).toEqual({ ok: false, error: 'out-of-range' });
    expect(decodeChallenge(rawCode([v | 2, 99, 0]))).toEqual({ ok: false, error: 'unknown-spot' });
    expect(decodeChallenge(rawCode([v | 3, 0, 0, 0, 0]))).toEqual({ ok: false, error: 'unknown-spot' });
  });

  it('encoding refuses a challenge no build could open', () => {
    expect(() => encodeChallenge(hand({ button: 4 }))).toThrow(RangeError);
    expect(() => encodeChallenge(hand({ seed: -1 }))).toThrow(RangeError);
    expect(() => encodeChallenge({ kind: 'puzzle', scenarioId: 'no-such-spot' })).toThrow(RangeError);
  });

  it('every refusal has text', () => {
    for (const text of Object.values(CHALLENGE_ERROR_TEXT)) expect(text.length).toBeGreaterThan(10);
  });
});

describe('the format stays stable', () => {
  it('a code written today still reads the same', () => {
    // Pinned bytes: a change to the layout, the alphabet or the checksum breaks every code already shared.
    expect(encodeChallenge(hand())).toBe('OS-44N0-E0G4-CKQG-J');
    expect(decodeChallenge('OS-44N0-E0G4-CKQG-J')).toEqual({ ok: true, challenge: hand() });
  });

  it('every drill kind has a format number, and puzzle id hashes never collide', () => {
    expect(DRILL_KINDS_COVERED).toBe(true);
    const hashes = SCENARIOS.map((s) => idHash(s.id));
    expect(new Set(hashes).size).toBe(SCENARIOS.length);
  });

  it('describes a spot from its fields alone', () => {
    expect(describeChallenge(hand({ button: 0 }))).toBe('A 4-handed hand at 100 big blinds, you on the button.');
    expect(describeChallenge({ kind: 'drill', drill: 'pot-odds', index: 3 })).toBe('A Math problem: pot odds.');
    expect(describeChallenge({ kind: 'puzzle', scenarioId: SCENARIOS[0].id })).toContain(SCENARIOS[0].title);
  });
});
