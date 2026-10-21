import { describe, expect, it } from 'vitest';
import {
  alignmentPositions,
  dataCodewords,
  encodeQr,
  formatBits,
  penalty,
  QrTooLong,
  rsDivisor,
  rsRemainder,
  versionBits,
  type Ecl,
} from '../../src/core/qr.js';

/**
 * core/qr.ts against the standard's published numbers. The end-to-end proof that a phone can read what it
 * draws is scripts/qr-crosscheck.ts (macOS's own reader); this pins the parts that proof depends on.
 */

describe('capacity tables', () => {
  it('match the standard’s data codeword counts', () => {
    // ISO/IEC 18004 Table 7, a spread of versions.
    const table: [number, Ecl, number][] = [
      [1, 'L', 19], [1, 'M', 16], [1, 'Q', 13], [1, 'H', 9],
      [2, 'L', 34], [2, 'M', 28], [2, 'Q', 22], [2, 'H', 16],
      [5, 'Q', 62], [7, 'M', 124], [10, 'M', 216], [10, 'H', 122],
      [40, 'L', 2956], [40, 'M', 2334], [40, 'Q', 1666], [40, 'H', 1276],
    ];
    for (const [v, ecl, n] of table) expect(dataCodewords(v, ecl), `v${v}-${ecl}`).toBe(n);
  });

  it('every version and level leaves room for data', () => {
    for (let v = 1; v <= 40; v++) for (const ecl of ['L', 'M', 'Q', 'H'] as const) expect(dataCodewords(v, ecl)).toBeGreaterThan(0);
  });
});

describe('BCH words', () => {
  it('format bits match the standard’s table', () => {
    expect(formatBits('M', 0)).toBe(0b101010000010010);
    expect(formatBits('L', 0)).toBe(0b111011111000100);
    expect(formatBits('Q', 0)).toBe(0b011010101011111);
    expect(formatBits('H', 0)).toBe(0b001011010001001);
    expect(formatBits('L', 7)).toBe(0b110100101110110);
  });

  it('version bits match the standard’s table', () => {
    expect(versionBits(7)).toBe(0b000111110010010100);
    expect(versionBits(40)).toBe(0b101000110001101001);
  });
});

describe('Reed–Solomon', () => {
  it('reproduces the worked 1-M "HELLO WORLD" error-correction codewords', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsRemainder(data, rsDivisor(10))).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
});

describe('alignment patterns', () => {
  it('sit where the standard puts them', () => {
    expect(alignmentPositions(1)).toEqual([]);
    expect(alignmentPositions(2)).toEqual([6, 18]);
    expect(alignmentPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(alignmentPositions(40)).toEqual([6, 30, 58, 86, 114, 142, 170]);
  });
});

/** Read the first copy of the format bits back out of a drawn symbol. */
function readFormat(m: readonly (readonly boolean[])[]): number {
  let bits = 0;
  const at = (x: number, y: number, i: number) => {
    if (m[y][x]) bits |= 1 << i;
  };
  for (let i = 0; i <= 5; i++) at(8, i, i);
  at(8, 7, 6);
  at(8, 8, 7);
  at(7, 8, 8);
  for (let i = 9; i < 15; i++) at(14 - i, 8, i);
  return bits;
}

function readFormatSecond(m: readonly (readonly boolean[])[]): number {
  const s = m.length;
  let bits = 0;
  for (let i = 0; i < 8; i++) if (m[8][s - 1 - i]) bits |= 1 << i;
  for (let i = 8; i < 15; i++) if (m[s - 15 + i][8]) bits |= 1 << i;
  return bits;
}

describe('a drawn symbol', () => {
  it('has finders, timing, the dark module and both format copies agreeing', () => {
    for (const text of ['OS-4A2B-C3D4-E5F6', 'hello', '0123456789', 'x'.repeat(300)]) {
      const qr = encodeQr(text);
      const m = qr.modules;
      expect(m.length).toBe(qr.size);
      expect(qr.size).toBe(qr.version * 4 + 17);
      for (const [cx, cy] of [[3, 3], [qr.size - 4, 3], [3, qr.size - 4]]) {
        expect(m[cy][cx], 'finder centre').toBe(true);
        expect(m[cy - 2][cx], 'finder light ring').toBe(false);
        expect(m[cy - 3][cx], 'finder dark ring').toBe(true);
      }
      for (let i = 8; i < qr.size - 8; i++) {
        expect(m[6][i]).toBe(i % 2 === 0);
        expect(m[i][6]).toBe(i % 2 === 0);
      }
      expect(m[qr.size - 8][8], 'the dark module').toBe(true);
      expect(readFormat(m)).toBe(formatBits(qr.ecl, qr.mask));
      expect(readFormatSecond(m)).toBe(formatBits(qr.ecl, qr.mask));
    }
  });

  it('picks the smallest version and the most compact mode', () => {
    expect(encodeQr('0123456789').mode).toBe('numeric');
    expect(encodeQr('OS-4A2B-C3D4').mode).toBe('alphanumeric');
    expect(encodeQr('lower case').mode).toBe('byte');
    const code = encodeQr('OS-4A2B-C3D4-E5F6-G7H8', { ecl: 'M' });
    expect(code.version).toBe(2);
    // The level is raised for free while the text still fits the version.
    expect(['M', 'Q', 'H']).toContain(code.ecl);
  });

  it('chooses the lowest-penalty mask unless one is forced', () => {
    const chosen = encodeQr('MASK TEST 123');
    const scores = Array.from({ length: 8 }, (_, mask) => penalty(encodeQr('MASK TEST 123', { mask, ecl: chosen.ecl }).modules));
    expect(scores[chosen.mask]).toBe(Math.min(...scores));
    expect(encodeQr('MASK TEST 123', { mask: 5 }).mask).toBe(5);
  });

  it('is deterministic', () => {
    expect(encodeQr('same text').modules).toEqual(encodeQr('same text').modules);
  });

  it('refuses text past version 40', () => {
    expect(() => encodeQr('x'.repeat(3000), { ecl: 'L' })).toThrow(QrTooLong);
    expect(encodeQr('x'.repeat(2900), { ecl: 'L' }).version).toBe(40);
  });
});
