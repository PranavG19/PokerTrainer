/**
 * An independent check of core/qr.ts: encode a spread of texts (every mode, every level, versions 1 to 40),
 * write each as a PNG, and have macOS's own QR reader (Core Image's CIDetector, through `swift`) read them
 * back. The run fails unless every symbol decodes to exactly the text it was made from.
 *
 * macOS only, and slow (swift compiles the reader once), so it is a script and not part of `npm test`.
 *   node --import ./scripts/ts-js-resolve.mjs scripts/qr-crosscheck.ts [outDir]
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { encodeQr, type Ecl, type QrCode } from '../src/core/qr.ts';
import { encodeChallenge } from '../src/core/challengeCode.ts';

const SCALE = 6;
const QUIET = 4;

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** An 8-bit greyscale PNG of the symbol, with its quiet zone. */
function png(qr: QrCode): Buffer {
  const side = (qr.size + QUIET * 2) * SCALE;
  const rows: Buffer[] = [];
  for (let py = 0; py < side; py++) {
    const row = Buffer.alloc(side + 1, 255);
    row[0] = 0;
    const y = Math.floor(py / SCALE) - QUIET;
    for (let px = 0; px < side; px++) {
      const x = Math.floor(px / SCALE) - QUIET;
      if (y >= 0 && x >= 0 && y < qr.size && x < qr.size && qr.modules[y][x]) row[px + 1] = 0;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(side, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const READER = `
import Foundation
import CoreImage
let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!
for file in CommandLine.arguments.dropFirst() {
  let image = CIImage(contentsOf: URL(fileURLWithPath: file))!
  let found = detector.features(in: image).compactMap { ($0 as? CIQRCodeFeature)?.messageString }
  let text = found.first ?? "<none>"
  let data = try! JSONSerialization.data(withJSONObject: [file, text], options: [])
  print(String(data: data, encoding: .utf8)!)
}
`;

const out = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-qr-'));
fs.mkdirSync(out, { recursive: true });

const cases: { text: string; ecl: Ecl; mask?: number }[] = [];
for (const ecl of ['L', 'M', 'Q', 'H'] as const) {
  cases.push({ text: '01234567', ecl });
  cases.push({ text: 'HELLO WORLD', ecl });
  cases.push({ text: 'Hello, world! 123', ecl });
  cases.push({ text: 'Offsuit — ♠♥♦♣ ünïcødé', ecl });
}
for (let mask = 0; mask < 8; mask++) cases.push({ text: `MASK ${mask} CHECK`, ecl: 'M', mask });
// Lengths that land on versions across the whole range, in every mode.
for (const n of [40, 90, 150, 260, 400, 640, 900, 1300, 1800, 2300]) {
  cases.push({ text: 'A1-'.repeat(Math.ceil(n / 3)).slice(0, n), ecl: 'M' });
  cases.push({ text: '7'.repeat(n * 2), ecl: n * 2 > 3500 ? 'L' : 'Q' });
  cases.push({ text: 'x'.repeat(n), ecl: 'L' });
}
// The largest symbols: version 40 at L, and high versions at H.
cases.push({ text: 'x'.repeat(2900), ecl: 'L' });
cases.push({ text: 'y'.repeat(1200), ecl: 'H' });
cases.push({ text: 'Z9'.repeat(900), ecl: 'H' });
for (const seed of [0, 1, 42, 0xffffffff]) {
  cases.push({ text: encodeChallenge({ kind: 'hand', seed, handNumber: 7, button: 2, seats: 4, depthBb: 100 }), ecl: 'M' });
}

const files: string[] = [];
const expected = new Map<string, { text: string; qr: QrCode }>();
cases.forEach((c, i) => {
  const qr = encodeQr(c.text, { ecl: c.ecl, mask: c.mask });
  const file = path.join(out, `qr-${String(i).padStart(3, '0')}-v${qr.version}${qr.ecl}m${qr.mask}.png`);
  fs.writeFileSync(file, png(qr));
  files.push(file);
  expected.set(file, { text: c.text, qr });
});

const reader = path.join(out, 'reader.swift');
fs.writeFileSync(reader, READER);
const lines = execFileSync('swift', [reader, ...files], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim().split('\n');
let failed = 0;
const versions = new Set<number>();
for (const line of lines) {
  const [file, text] = JSON.parse(line) as [string, string];
  const want = expected.get(file)!;
  versions.add(want.qr.version);
  const ok = text === want.text;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} v${want.qr.version} ${want.qr.ecl} mask ${want.qr.mask} ${want.qr.mode} (${want.text.length} chars)${ok ? '' : ` read ${JSON.stringify(text.slice(0, 40))}`}`);
}
console.log(`\n${lines.length - failed}/${lines.length} decoded by Core Image; versions covered: ${[...versions].sort((a, b) => a - b).join(' ')}`);
console.log(`PNGs in ${out}`);
if (failed > 0 || lines.length !== cases.length) process.exit(1);
