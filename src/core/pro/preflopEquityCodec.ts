/** Three base-64 digits per value (0..10000): the packing the generated preflop equity table uses. */

export const TABLE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function encodeTable(values: readonly number[]): string {
  let s = '';
  for (const v of values) {
    if (!Number.isInteger(v) || v < 0 || v > 10000) throw new RangeError(`table value ${v}`);
    s += TABLE_ALPHABET[(v >> 12) & 63] + TABLE_ALPHABET[(v >> 6) & 63] + TABLE_ALPHABET[v & 63];
  }
  return s;
}

export function decodeTable(s: string): Uint16Array {
  if (s.length % 3 !== 0) throw new Error('table length');
  const out = new Uint16Array(s.length / 3);
  for (let i = 0; i < out.length; i++) {
    const d0 = TABLE_ALPHABET.indexOf(s[3 * i]);
    const d1 = TABLE_ALPHABET.indexOf(s[3 * i + 1]);
    const d2 = TABLE_ALPHABET.indexOf(s[3 * i + 2]);
    if (d0 < 0 || d1 < 0 || d2 < 0) throw new Error('table digit');
    out[i] = (d0 << 12) | (d1 << 6) | d2;
  }
  return out;
}
