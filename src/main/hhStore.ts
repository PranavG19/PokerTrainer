/**
 * THE IMPORTED HAND STORE (Pro). Kept OUTSIDE the profile on purpose: imported real-money hands are not
 * learning progress, so nothing in offsuit-state.json changes when you import, and no reward, Rep,
 * streak or story path can ever see them. Deleting the profile leaves them; "Delete imported hands"
 * removes them, and is never locked behind Pro (your data stays yours after a subscription ends).
 *
 *   <userData>/hand-histories/hands.ndjson   one parsed hand per line (core/pro/handHistory.ts shape)
 *   <userData>/hand-histories/meta.json      the last import's summary (when, how many files, sites)
 *
 * Every write is whole-file and atomic (write a temp file, rename), so a crash mid-import leaves the
 * previous store. Reading is tolerant: a line that is not a valid hand (a doctored or truncated file)
 * is dropped, never trusted, and the store never grows past MAX_STORED_HANDS.
 *
 * This module also owns WHICH FILES an import may read. The paths come only from the native dialog in
 * main, never from the renderer; a picked folder contributes its top-level .txt files only; symlinks
 * are skipped (a link inside a folder could point anywhere); every file is size-capped before it is read.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWrite } from '../core/backup.js';
import { handKey, isParsedHand, SITES, type ParsedHand, type Site } from '../core/pro/handHistory.js';

export const MAX_STORED_HANDS = 50_000;
/** One imported file. A busy month at one site is a few MB; 25 MB is far past any real export. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Files per import (a folder of daily files for a year is ~365). */
export const MAX_FILES = 400;
/** Bytes read per import across all files. */
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
/**
 * The store file itself. `add` never writes past it (a hand over the budget counts as over the cap), and a
 * file found larger than it is left untouched and read-only, never read as empty and overwritten.
 */
export const MAX_STORE_BYTES = 100 * 1024 * 1024;

export type FileSkip = 'not-a-file' | 'link' | 'too-large' | 'not-text' | 'unreadable' | 'too-many' | 'import-too-large';

export interface PickedFile {
  readonly path: string;
  readonly size: number;
}

export interface Picked {
  readonly files: PickedFile[];
  readonly skipped: Partial<Record<FileSkip, number>>;
}

function bump<K extends string>(counts: Partial<Record<K, number>>, key: K): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** The regular files an import may read, from what the dialog returned. */
export function expandPicked(paths: readonly string[]): Picked {
  const files: PickedFile[] = [];
  const skipped: Partial<Record<FileSkip, number>> = {};
  const seen = new Set<string>();
  const take = (p: string, st: fs.Stats): void => {
    if (st.isSymbolicLink()) return bump(skipped, 'link');
    if (!st.isFile()) return bump(skipped, 'not-a-file');
    if (st.size > MAX_FILE_BYTES) return bump(skipped, 'too-large');
    if (seen.has(p)) return;
    if (files.length >= MAX_FILES) return bump(skipped, 'too-many');
    seen.add(p);
    files.push({ path: p, size: st.size });
  };
  for (const raw of paths) {
    if (typeof raw !== 'string' || !path.isAbsolute(raw)) {
      bump(skipped, 'not-a-file');
      continue;
    }
    const p = path.resolve(raw);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(p);
    } catch {
      bump(skipped, 'unreadable');
      continue;
    }
    if (st.isDirectory()) {
      let names: string[];
      try {
        names = fs.readdirSync(p).sort();
      } catch {
        bump(skipped, 'unreadable');
        continue;
      }
      for (const name of names) {
        if (!name.toLowerCase().endsWith('.txt') || name.startsWith('.')) continue;
        const child = path.join(p, name);
        try {
          take(child, fs.lstatSync(child));
        } catch {
          bump(skipped, 'unreadable');
        }
      }
    } else {
      take(p, st);
    }
  }
  return { files, skipped };
}

/**
 * A picked file's text, or why not. UTF-8 (a BOM is dropped) or UTF-16 with a BOM (some sites export
 * it); a NUL byte in a UTF-8 file means it is not a text export at all. The size is checked again on
 * the open handle (and against what is left of the import's budget), so a file swapped for a bigger one
 * after the dialog is still capped; `bytes` is what was really read. Asynchronous: main's thread is free
 * while it reads.
 */
export async function readPicked(file: PickedFile, maxBytes = MAX_FILE_BYTES): Promise<{ text: string; bytes: number } | { skip: FileSkip }> {
  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(file.path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const st = await handle.stat();
    if (!st.isFile()) return { skip: 'not-a-file' };
    if (st.size > MAX_FILE_BYTES) return { skip: 'too-large' };
    if (st.size > maxBytes) return { skip: 'import-too-large' };
    const buf = Buffer.alloc(st.size);
    let read = 0;
    while (read < st.size) {
      const { bytesRead } = await handle.read(buf, read, st.size - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    const bytes = buf.subarray(0, read);
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: bytes.subarray(2).toString('utf16le'), bytes: read };
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      const swapped = Buffer.from(bytes.subarray(2));
      swapped.swap16();
      return { text: swapped.toString('utf16le'), bytes: read };
    }
    if (bytes.includes(0)) return { skip: 'not-text' };
    const text = bytes.toString('utf8');
    return { text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, bytes: read };
  } catch {
    return { skip: 'unreadable' };
  } finally {
    await handle?.close();
  }
}

export interface ImportMeta {
  /** ISO time of the last import that added anything or found duplicates. */
  readonly at: string;
  readonly files: number;
  readonly sites: readonly Site[];
}

export interface AddOutcome {
  readonly added: number;
  readonly duplicates: number;
  /** Hands not kept because the store is full (by hands or by bytes). */
  readonly overCap: number;
  /** Hands refused because one hand alone is larger than any real hand. */
  readonly tooLarge: number;
  readonly total: number;
  /** Set when nothing could be written: the store on disk could not be read whole, so it is left as it is. */
  readonly refused?: 'store-unreadable';
}

/**
 * 'too-large' / 'unreadable' / 'newer' (written by a newer build: its lines may hold fields this one would
 * drop): the file on disk is kept untouched and every write is refused. Deleting is always allowed.
 */
export type StoreStatus = 'ok' | 'too-large' | 'unreadable' | 'newer';

/** The store's format, written to meta.json. A newer one opens read-only (the profile's rule, kept here). */
export const STORE_VERSION = 1;

export interface HandStore {
  readonly dir: string;
  /** Every stored hand, validated line by line. */
  all(): ParsedHand[];
  count(): number;
  status(): StoreStatus;
  add(hands: readonly ParsedHand[], meta: Omit<ImportMeta, 'sites'>): AddOutcome;
  meta(): ImportMeta | null;
  clear(): void;
}

/** A real hand serialises to 1-4 KB; 16 KB is far past any, and caps what one line can cost. */
export const MAX_HAND_BYTES = 16 * 1024;
const MAX_META_BYTES = 4096;

const HAND_KEYS = ['site', 'id', 'game', 'playedAt', 'maxSeats', 'button', 'sb', 'bb', 'ante', 'seats', 'hero', 'heroCards', 'actions', 'sbSeat', 'bbSeat', 'board', 'showdown'] as const;

/** A validated hand rebuilt from the known keys only, so a hand-edited line cannot carry anything extra. */
function cleanHand(h: ParsedHand): ParsedHand {
  const out: Record<string, unknown> = {};
  for (const k of HAND_KEYS) out[k] = h[k];
  out.seats = h.seats.map((s) => ({ seatNo: s.seatNo, stack: s.stack, isHero: s.isHero }));
  out.actions = h.actions.map((a) => ({ street: a.street, seat: a.seat, kind: a.kind, amount: a.amount, allIn: a.allIn }));
  out.heroCards = [...h.heroCards];
  out.board = [...h.board];
  return out as unknown as ParsedHand;
}

/** Write `lines` to `file` atomically, one write per line (never one giant string), then rename. */
function writeLines(file: string, lines: readonly string[]): void {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    for (const line of lines) fs.writeSync(fd, line + '\n');
    fs.fsyncSync(fd);
  } catch (error) {
    fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
    throw error;
  }
  fs.closeSync(fd);
  fs.renameSync(tmp, file);
}

export function createHandStore(dir: string, opts: { maxStoreBytes?: number } = {}): HandStore {
  const maxStoreBytes = opts.maxStoreBytes ?? MAX_STORE_BYTES;
  const file = path.join(dir, 'hands.ndjson');
  const metaFile = path.join(dir, 'meta.json');
  let cache: { hands: ParsedHand[]; lines: string[]; bytes: number; status: StoreStatus } | null = null;

  /** The version in meta.json; 1 when there is none (this build's first format). */
  const storeVersion = (): number => {
    const o = readMeta();
    const v = o?.storeVersion;
    return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 ? v : 1;
  };
  const readMeta = (): Record<string, unknown> | null => {
    try {
      const st = fs.lstatSync(metaFile);
      if (!st.isFile() || st.size > MAX_META_BYTES) return null;
      const o = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as unknown;
      return typeof o === 'object' && o !== null ? (o as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  const read = (): NonNullable<typeof cache> => {
    if (cache !== null) return cache;
    const hands: ParsedHand[] = [];
    const lines: string[] = [];
    let bytes = 0;
    let status: StoreStatus = 'ok';
    let st: fs.Stats | null = null;
    try {
      st = fs.lstatSync(file);
    } catch {
      st = null; // no store yet: empty
    }
    if (st !== null) {
      if (storeVersion() > STORE_VERSION) status = 'newer';
      else if (!st.isFile()) status = 'unreadable';
      else if (st.size > maxStoreBytes) status = 'too-large';
      else {
        try {
          const seen = new Set<string>();
          for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
            if (line === '' || hands.length >= MAX_STORED_HANDS || line.length > MAX_HAND_BYTES) continue;
            let raw: unknown;
            try {
              raw = JSON.parse(line);
            } catch {
              continue;
            }
            if (!isParsedHand(raw)) continue;
            const key = handKey(raw);
            if (seen.has(key)) continue;
            seen.add(key);
            const clean = cleanHand(raw);
            const text = JSON.stringify(clean);
            hands.push(clean);
            lines.push(text);
            bytes += Buffer.byteLength(text) + 1;
          }
        } catch {
          status = 'unreadable';
        }
      }
    }
    if (status !== 'ok') {
      hands.length = 0;
      lines.length = 0;
    }
    cache = { hands, lines, bytes, status };
    return cache;
  };

  return {
    dir,
    all: () => read().hands.slice(),
    count: () => read().hands.length,
    status: () => read().status,
    add(hands, meta) {
      const current = read();
      if (current.status !== 'ok') {
        return { added: 0, duplicates: 0, overCap: 0, tooLarge: 0, total: 0, refused: 'store-unreadable' };
      }
      const keys = new Set(current.hands.map(handKey));
      const fresh: ParsedHand[] = [];
      const freshLines: string[] = [];
      let bytes = current.bytes;
      let duplicates = 0;
      let overCap = 0;
      let tooLarge = 0;
      for (const h of hands) {
        if (!isParsedHand(h)) continue;
        const key = handKey(h);
        if (keys.has(key)) {
          duplicates++;
          continue;
        }
        const clean = cleanHand(h);
        const text = JSON.stringify(clean);
        const size = Buffer.byteLength(text) + 1;
        if (size > MAX_HAND_BYTES) {
          tooLarge++;
          continue;
        }
        if (current.hands.length + fresh.length >= MAX_STORED_HANDS || bytes + size > maxStoreBytes) {
          overCap++;
          continue;
        }
        keys.add(key);
        fresh.push(clean);
        freshLines.push(text);
        bytes += size;
      }
      const total = current.hands.length + fresh.length;
      if (fresh.length > 0) {
        fs.mkdirSync(dir, { recursive: true });
        const lines = current.lines.concat(freshLines);
        writeLines(file, lines);
        cache = { hands: current.hands.concat(fresh), lines, bytes, status: 'ok' };
      }
      if (fresh.length > 0 || duplicates > 0) {
        fs.mkdirSync(dir, { recursive: true });
        const all = read().hands;
        const sites = SITES.filter((site) => all.some((h) => h.site === site));
        atomicWrite(metaFile, JSON.stringify({ storeVersion: STORE_VERSION, at: meta.at, files: meta.files, sites }));
      }
      return { added: fresh.length, duplicates, overCap, tooLarge, total };
    },
    meta() {
      try {
        const o = readMeta();
        if (o === null) return null;
        const at = typeof o.at === 'string' && !Number.isNaN(Date.parse(o.at)) ? o.at : null;
        const files = typeof o.files === 'number' && Number.isSafeInteger(o.files) && o.files >= 0 ? o.files : null;
        const sites = Array.isArray(o.sites) ? SITES.filter((x) => (o.sites as unknown[]).includes(x)) : [];
        return at === null || files === null ? null : { at, files, sites };
      } catch {
        return null;
      }
    },
    clear() {
      fs.rmSync(file, { force: true });
      fs.rmSync(metaFile, { force: true });
      cache = { hands: [], lines: [], bytes: 0, status: 'ok' };
    },
  };
}
