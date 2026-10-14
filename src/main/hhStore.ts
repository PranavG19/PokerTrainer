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
/** The store file itself; a larger one is not a file this build wrote. */
export const MAX_STORE_BYTES = 120 * 1024 * 1024;

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
 * the open handle, so a file swapped for a bigger one after the dialog is still capped.
 */
export function readPicked(file: PickedFile): { text: string } | { skip: FileSkip } {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file.path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { skip: 'not-a-file' };
    if (st.size > MAX_FILE_BYTES) return { skip: 'too-large' };
    const buf = Buffer.alloc(st.size);
    let read = 0;
    while (read < st.size) {
      const n = fs.readSync(fd, buf, read, st.size - read, read);
      if (n === 0) break;
      read += n;
    }
    const bytes = buf.subarray(0, read);
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: bytes.subarray(2).toString('utf16le') };
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      const swapped = Buffer.from(bytes.subarray(2));
      swapped.swap16();
      return { text: swapped.toString('utf16le') };
    }
    if (bytes.includes(0)) return { skip: 'not-text' };
    const text = bytes.toString('utf8');
    return { text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text };
  } catch {
    return { skip: 'unreadable' };
  } finally {
    if (fd !== null) fs.closeSync(fd);
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
  /** Hands not kept because the store is full. */
  readonly overCap: number;
  readonly total: number;
}

export interface HandStore {
  readonly dir: string;
  /** Every stored hand, validated line by line. */
  all(): ParsedHand[];
  count(): number;
  add(hands: readonly ParsedHand[], meta: Omit<ImportMeta, 'sites'>): AddOutcome;
  meta(): ImportMeta | null;
  clear(): void;
}

export function createHandStore(dir: string): HandStore {
  const file = path.join(dir, 'hands.ndjson');
  const metaFile = path.join(dir, 'meta.json');
  let cache: ParsedHand[] | null = null;

  const read = (): ParsedHand[] => {
    if (cache !== null) return cache;
    const out: ParsedHand[] = [];
    try {
      const st = fs.lstatSync(file);
      if (st.isFile() && st.size <= MAX_STORE_BYTES) {
        const seen = new Set<string>();
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
          if (line === '' || out.length >= MAX_STORED_HANDS) continue;
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
          out.push(raw);
        }
      }
    } catch {
      // No store yet (or unreadable): empty.
    }
    cache = out;
    return out;
  };

  return {
    dir,
    all: () => read().slice(),
    count: () => read().length,
    add(hands, meta) {
      const current = read();
      const keys = new Set(current.map(handKey));
      const fresh: ParsedHand[] = [];
      let duplicates = 0;
      let overCap = 0;
      for (const h of hands) {
        if (!isParsedHand(h)) continue;
        const key = handKey(h);
        if (keys.has(key)) {
          duplicates++;
          continue;
        }
        if (current.length + fresh.length >= MAX_STORED_HANDS) {
          overCap++;
          continue;
        }
        keys.add(key);
        fresh.push(h);
      }
      const next = current.concat(fresh);
      if (fresh.length > 0) {
        fs.mkdirSync(dir, { recursive: true });
        atomicWrite(file, next.map((h) => JSON.stringify(h)).join('\n') + '\n');
        cache = next;
      }
      if (fresh.length > 0 || duplicates > 0) {
        fs.mkdirSync(dir, { recursive: true });
        const sites = SITES.filter((s) => next.some((h) => h.site === s));
        atomicWrite(metaFile, JSON.stringify({ at: meta.at, files: meta.files, sites }));
      }
      return { added: fresh.length, duplicates, overCap, total: next.length };
    },
    meta() {
      try {
        const o = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as Record<string, unknown>;
        const at = typeof o.at === 'string' && !Number.isNaN(Date.parse(o.at)) ? o.at : null;
        const files = typeof o.files === 'number' && Number.isSafeInteger(o.files) && o.files >= 0 ? o.files : null;
        const sites = Array.isArray(o.sites) ? SITES.filter((s) => (o.sites as unknown[]).includes(s)) : [];
        return at === null || files === null ? null : { at, files, sites };
      } catch {
        return null;
      }
    },
    clear() {
      fs.rmSync(file, { force: true });
      fs.rmSync(metaFile, { force: true });
      cache = [];
    },
  };
}
