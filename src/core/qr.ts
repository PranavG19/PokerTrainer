/**
 * A QR Code encoder (ISO/IEC 18004, model 2), written here so the app draws a challenge code's QR with no
 * dependency and no network. Pure: text in, a square of dark/light modules out; the renderer paints it
 * (components/qrCode.ts).
 *
 * Scope: one segment in numeric, alphanumeric or byte (UTF-8) mode, whichever is smallest for the text;
 * versions 1–40; the four error-correction levels; the mask with the lowest penalty score. No ECI, Kanji or
 * structured append. The steps follow the standard in order: segment bits, terminator and padding, the
 * Reed–Solomon blocks over GF(256) (polynomial 0x11D) interleaved, the function patterns, the zigzag data
 * placement, the mask, and the BCH-coded format and version bits.
 *
 * Checked two ways: tests/unit/qr.test.ts pins the capacity tables, the BCH words and the Reed–Solomon
 * remainders, and scripts/qr-crosscheck.ts has macOS's own QR reader (Core Image) read back generated codes.
 */

export type Ecl = 'L' | 'M' | 'Q' | 'H';

export interface QrCode {
  readonly version: number;
  /** Modules per side: 4 × version + 17. Draw a 4-module light quiet zone around it. */
  readonly size: number;
  readonly ecl: Ecl;
  readonly mask: number;
  readonly mode: 'numeric' | 'alphanumeric' | 'byte';
  /** Row-major: `modules[y][x]` is true for a dark module. */
  readonly modules: readonly (readonly boolean[])[];
}

export const MIN_VERSION = 1;
export const MAX_VERSION = 40;

/** The two format bits of each level (the standard's table, which is not in L-M-Q-H order). */
const FORMAT_BITS: Record<Ecl, number> = { L: 1, M: 0, Q: 3, H: 2 };

/** Error-correction codewords per block, indexed [ecl][version]; index 0 is unused. */
const ECC_PER_BLOCK: Record<Ecl, readonly number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};

/** Error-correction blocks, indexed [ecl][version]; index 0 is unused. */
const ECC_BLOCKS: Record<Ecl, readonly number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

type Mode = QrCode['mode'];
const MODE_INDICATOR: Record<Mode, number> = { numeric: 0x1, alphanumeric: 0x2, byte: 0x4 };
/** Character-count field widths for versions 1–9, 10–26 and 27–40. */
const COUNT_BITS: Record<Mode, readonly [number, number, number]> = {
  numeric: [10, 12, 14],
  alphanumeric: [9, 11, 13],
  byte: [8, 16, 16],
};

/** Modules available for data and error correction (everything but the function patterns), in bits. */
export function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** Data codewords (bytes) a symbol of this version and level holds, after its error correction. */
export function dataCodewords(version: number, ecl: Ecl): number {
  return Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[ecl][version] * ECC_BLOCKS[ecl][version];
}

// ---- segments ----

interface Segment {
  readonly mode: Mode;
  /** Characters for numeric/alphanumeric, bytes for byte mode: the count field's value. */
  readonly count: number;
  readonly bits: readonly number[];
}

function pushBits(out: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i--) out.push((value >>> i) & 1);
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function makeSegment(text: string): Segment {
  const bits: number[] = [];
  if (/^[0-9]*$/.test(text)) {
    for (let i = 0; i < text.length; i += 3) {
      const group = text.slice(i, i + 3);
      pushBits(bits, Number(group), group.length * 3 + 1);
    }
    return { mode: 'numeric', count: text.length, bits };
  }
  if ([...text].every((c) => ALPHANUMERIC.includes(c))) {
    for (let i = 0; i + 1 < text.length; i += 2) {
      pushBits(bits, ALPHANUMERIC.indexOf(text[i]) * 45 + ALPHANUMERIC.indexOf(text[i + 1]), 11);
    }
    if (text.length % 2 === 1) pushBits(bits, ALPHANUMERIC.indexOf(text[text.length - 1]), 6);
    return { mode: 'alphanumeric', count: text.length, bits };
  }
  const bytes = utf8(text);
  for (const b of bytes) pushBits(bits, b, 8);
  return { mode: 'byte', count: bytes.length, bits };
}

function countBitsFor(mode: Mode, version: number): number {
  return COUNT_BITS[mode][version <= 9 ? 0 : version <= 26 ? 1 : 2];
}

/** Header plus payload, or null when the count does not fit its field at this version. */
function segmentBits(seg: Segment, version: number): number | null {
  const cb = countBitsFor(seg.mode, version);
  if (seg.count >= 1 << cb) return null;
  return 4 + cb + seg.bits.length;
}

// ---- GF(256) and Reed–Solomon ----

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** The generator polynomial of this degree, highest coefficient (always 1) dropped. */
export function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

/** The remainder of data × x^degree divided by the generator: the block's error-correction bytes. */
export function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    for (let i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor);
  }
  return result;
}

/** Split into blocks, add each block's error correction, and interleave (data bytes first, then ECC). */
function withErrorCorrection(data: readonly number[], version: number, ecl: Ecl): number[] {
  const numBlocks = ECC_BLOCKS[ecl][version];
  const eccLen = ECC_PER_BLOCK[ecl][version];
  const raw = Math.floor(rawDataModules(version) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortDataLen = Math.floor(raw / numBlocks) - eccLen;
  const divisor = rsDivisor(eccLen);
  const dataBlocks: number[][] = [];
  const eccBlocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortDataLen + (i < numShort ? 0 : 1);
    const block = data.slice(k, k + len);
    k += len;
    dataBlocks.push(block);
    eccBlocks.push(rsRemainder(block, divisor));
  }
  const out: number[] = [];
  for (let i = 0; i <= shortDataLen; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < eccLen; i++) for (const block of eccBlocks) out.push(block[i]);
  return out;
}

// ---- BCH words ----

/** The 15 format bits for a level and mask, already XORed with 0x5412. */
export function formatBits(ecl: Ecl, mask: number): number {
  const data = (FORMAT_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** The 18 version bits (versions 7 and up). */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

// ---- the matrix ----

export function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const num = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (num * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < num; pos -= step) result.splice(1, 0, pos);
  return result;
}

const bit = (value: number, i: number): boolean => ((value >>> i) & 1) !== 0;

class Matrix {
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];
  constructor(size: number) {
    this.size = size;
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }
  setFunction(x: number, y: number, dark: boolean): void {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }
}

function drawFinder(m: Matrix, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= m.size || y >= m.size) continue;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      m.setFunction(x, y, dist !== 2 && dist !== 4);
    }
  }
}

function drawAlignment(m: Matrix, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) m.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
}

function drawFormat(m: Matrix, ecl: Ecl, mask: number): void {
  const bits = formatBits(ecl, mask);
  const s = m.size;
  // Around the top-left finder.
  for (let i = 0; i <= 5; i++) m.setFunction(8, i, bit(bits, i));
  m.setFunction(8, 7, bit(bits, 6));
  m.setFunction(8, 8, bit(bits, 7));
  m.setFunction(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) m.setFunction(14 - i, 8, bit(bits, i));
  // The second copy, split between the top-right and bottom-left finders.
  for (let i = 0; i < 8; i++) m.setFunction(s - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) m.setFunction(8, s - 15 + i, bit(bits, i));
  // The one module that is always dark.
  m.setFunction(8, s - 8, true);
}

function drawVersion(m: Matrix, version: number): void {
  if (version < 7) return;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const a = m.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    m.setFunction(a, b, bit(bits, i));
    m.setFunction(b, a, bit(bits, i));
  }
}

function drawFunctionPatterns(m: Matrix, version: number, ecl: Ecl): void {
  const s = m.size;
  for (let i = 0; i < s; i++) {
    m.setFunction(6, i, i % 2 === 0);
    m.setFunction(i, 6, i % 2 === 0);
  }
  drawFinder(m, 3, 3);
  drawFinder(m, s - 4, 3);
  drawFinder(m, 3, s - 4);
  const align = alignmentPositions(version);
  const last = align.length - 1;
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      // The three corners a finder already holds.
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      drawAlignment(m, align[i], align[j]);
    }
  }
  // Reserve the format area (any mask) and draw the version blocks.
  drawFormat(m, ecl, 0);
  drawVersion(m, version);
}

function drawCodewords(m: Matrix, codewords: readonly number[]): void {
  let i = 0;
  const total = codewords.length * 8;
  for (let right = m.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < m.size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? m.size - 1 - vert : vert;
        if (!m.isFunction[y][x] && i < total) {
          m.modules[y][x] = bit(codewords[i >>> 3], 7 - (i & 7));
          i++;
        }
        // Any remainder bits stay light (false), as the standard asks.
      }
    }
  }
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** XOR a mask over the data area. Applying it twice undoes it. */
function applyMask(m: Matrix, mask: number): void {
  const f = MASKS[mask];
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if (!m.isFunction[y][x] && f(x, y)) m.modules[y][x] = !m.modules[y][x];
    }
  }
}

const FINDER_LIKE = [
  [true, false, true, true, true, false, true, false, false, false, false],
  [false, false, false, false, true, false, true, true, true, false, true],
];

/** The standard's four penalty rules; the mask with the lowest score is used. It never affects decoding. */
export function penalty(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  let score = 0;
  const at = (x: number, y: number, horizontal: boolean): boolean => (horizontal ? modules[y][x] : modules[x][y]);
  for (const horizontal of [true, false]) {
    for (let a = 0; a < size; a++) {
      // Rule 1: runs of five or more of one colour.
      let run = 1;
      for (let b = 1; b < size; b++) {
        if (at(b, a, horizontal) === at(b - 1, a, horizontal)) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else {
          run = 1;
        }
      }
      // Rule 3: a finder-like 1:1:3:1:1 pattern with four light modules on one side.
      for (let b = 0; b + 11 <= size; b++) {
        for (const pattern of FINDER_LIKE) {
          if (pattern.every((dark, k) => at(b + k, a, horizontal) === dark)) score += 40;
        }
      }
    }
  }
  // Rule 2: 2×2 blocks of one colour.
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
    }
  }
  // Rule 4: how far the dark share is from half, in steps of 5%.
  let dark = 0;
  for (const row of modules) for (const m of row) if (m) dark++;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return score + Math.max(0, k) * 10;
}

export class QrTooLong extends Error {
  constructor() {
    super('the text does not fit a version 40 QR code at this level');
  }
}

/**
 * Encode `text` at the smallest version that holds it. `ecl` is the minimum level: the level is raised
 * while the text still fits the same version, which costs nothing. `mask` forces a mask (tests); absent,
 * the lowest-penalty mask is chosen.
 */
export function encodeQr(text: string, opts: { ecl?: Ecl; mask?: number; minVersion?: number } = {}): QrCode {
  const seg = makeSegment(text);
  let ecl: Ecl = opts.ecl ?? 'M';
  let version = Math.max(MIN_VERSION, Math.min(MAX_VERSION, opts.minVersion ?? MIN_VERSION));
  let used: number | null = null;
  for (; version <= MAX_VERSION; version++) {
    used = segmentBits(seg, version);
    if (used !== null && used <= dataCodewords(version, ecl) * 8) break;
  }
  if (version > MAX_VERSION || used === null) throw new QrTooLong();
  for (const higher of ['M', 'Q', 'H'] as const) {
    if (order(higher) > order(ecl) && used <= dataCodewords(version, higher) * 8) ecl = higher;
  }

  const bits: number[] = [];
  pushBits(bits, MODE_INDICATOR[seg.mode], 4);
  pushBits(bits, seg.count, countBitsFor(seg.mode, version));
  bits.push(...seg.bits);
  const capacity = dataCodewords(version, ecl) * 8;
  pushBits(bits, 0, Math.min(4, capacity - bits.length));
  pushBits(bits, 0, (8 - (bits.length % 8)) % 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    data.push(byte);
  }
  for (let pad = 0xec; data.length < capacity / 8; pad ^= 0xec ^ 0x11) data.push(pad);

  const size = version * 4 + 17;
  const m = new Matrix(size);
  drawFunctionPatterns(m, version, ecl);
  drawCodewords(m, withErrorCorrection(data, version, ecl));

  let mask = opts.mask ?? -1;
  if (mask < 0 || mask > 7) {
    let best = Infinity;
    for (let candidate = 0; candidate < 8; candidate++) {
      applyMask(m, candidate);
      drawFormat(m, ecl, candidate);
      const score = penalty(m.modules);
      if (score < best) {
        best = score;
        mask = candidate;
      }
      applyMask(m, candidate);
    }
  }
  applyMask(m, mask);
  drawFormat(m, ecl, mask);
  return { version, size, ecl, mask, mode: seg.mode, modules: m.modules };
}

function order(ecl: Ecl): number {
  return ['L', 'M', 'Q', 'H'].indexOf(ecl);
}
