/**
 * Profile export and import, main's side: the native dialogs, the read and the write.
 *
 * The renderer never names a path. It asks for "export" or "import" and main opens the system dialog
 * itself; the only path either side ever handles is the one that dialog returns, and the renderer gets back
 * a file name at most. Under e2e a spec stubs `dialog.showSaveDialog` / `dialog.showOpenDialog` from the test
 * process (electronApp.evaluate), as pro-tools.spec does; there is no test hook in this file.
 *
 * An import is two calls, so nothing is replaced without the learner seeing what will replace it:
 * 1. `pick` opens the dialog, reads the file (a regular file under the size cap), checks it strictly
 *    (core/profileTransfer.ts) and holds the result here under a fresh id. The renderer gets a preview.
 * 2. `confirm(id, accept)` writes it, and only the pick the preview came from: a stale or guessed id
 *    does nothing. store.replaceProfile copies the current profile aside first and refuses if it cannot.
 *
 * The Pro hand store (hand-histories/, hhStore.ts) is never read or written here.
 */

import { dialog, type BrowserWindow, type OpenDialogOptions, type SaveDialogOptions } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWrite } from '../core/backup.js';
import { checkImport, exportText, MAX_IMPORT_BYTES, type ImportPreview, type ImportRefusal } from '../core/profileTransfer.js';
import { currentProfile, replaceProfile } from './store.js';

export type ExportResult =
  | { readonly saved: true; readonly fileName: string; readonly hands: number }
  | { readonly saved: false; readonly canceled?: true; readonly failed?: 'nothing' | 'write' | 'app-folder' };

export type PickResult =
  | { readonly ok: true; readonly id: string; readonly fileName: string; readonly preview: ImportPreview }
  | { readonly ok: false; readonly canceled?: true; readonly reason?: ImportRefusal | 'unreadable'; readonly detail?: string };

export type ConfirmResult =
  | { readonly replaced: true; readonly backup: string | null }
  | { readonly replaced: false; readonly reason: 'declined' | 'stale' | 'read-only' | 'pre-migration-copy' | 'backup' | 'write' };

/** A preview not confirmed within this long is dropped; the learner picks the file again. */
const PENDING_TTL_MS = 10 * 60 * 1000;

export interface ProfileFiles {
  exportProfile(): Promise<ExportResult>;
  pickImport(): Promise<PickResult>;
  confirmImport(id: unknown, accept: unknown): ConfirmResult;
}

export function createProfileFiles(opts: {
  window: () => BrowserWindow | null;
  /** The app's own folder (the live profile, its backups, the settings). An export is never written into it. */
  userData: string;
  /** Main's licence stamp: an imported profile carries main's entitlements, never the file's. */
  stamp: (profile: Record<string, unknown>) => Record<string, unknown>;
  now?: () => Date;
}): ProfileFiles {
  const now = opts.now ?? (() => new Date());
  let pending: { id: string; profile: Record<string, unknown>; at: number } | null = null;

  const showSave = (options: SaveDialogOptions) => {
    const win = opts.window();
    return win === null ? dialog.showSaveDialog(options) : dialog.showSaveDialog(win, options);
  };
  const showOpen = (options: OpenDialogOptions) => {
    const win = opts.window();
    return win === null ? dialog.showOpenDialog(options) : dialog.showOpenDialog(win, options);
  };

  return {
    async exportProfile() {
      const profile = currentProfile();
      if (profile === null) return { saved: false, failed: 'nothing' };
      const day = now().toISOString().slice(0, 10);
      const picked = await showSave({
        title: 'Export your profile',
        defaultPath: `offsuit-profile-${day}.json`,
        filters: [{ name: 'Offsuit profile', extensions: ['json'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (picked.canceled || typeof picked.filePath !== 'string' || picked.filePath === '') return { saved: false, canceled: true };
      const target = picked.filePath;
      // Writing into the app's folder could replace the live profile or a backup with an export file.
      if (inside(target, opts.userData)) return { saved: false, failed: 'app-folder' };
      try {
        atomicWrite(target, exportText(profile, now()));
      } catch {
        return { saved: false, failed: 'write' };
      }
      const hands = Array.isArray(profile.hands) ? profile.hands.length : 0;
      return { saved: true, fileName: path.basename(target), hands };
    },

    async pickImport() {
      pending = null;
      const picked = await showOpen({
        title: 'Import a profile',
        filters: [{ name: 'Offsuit profile', extensions: ['json'] }],
        properties: ['openFile'],
      });
      const file = picked.filePaths?.[0];
      if (picked.canceled || typeof file !== 'string' || file === '') return { ok: false, canceled: true };
      let text: string;
      let bytes: number;
      try {
        const read = readBounded(file, MAX_IMPORT_BYTES);
        if (read === 'not-a-file') return { ok: false, reason: 'unreadable' };
        if (read === 'too-large') return { ok: false, reason: 'too-large' };
        bytes = read.length;
        text = read.toString('utf-8');
      } catch {
        return { ok: false, reason: 'unreadable' };
      }
      const checked = checkImport(text, bytes);
      if (!checked.ok) return { ok: false, reason: checked.reason, ...(checked.detail ? { detail: checked.detail } : {}) };
      const id = crypto.randomUUID();
      pending = { id, profile: checked.profile, at: Date.now() };
      return { ok: true, id, fileName: path.basename(file), preview: checked.preview };
    },

    confirmImport(id, accept) {
      const held = pending;
      if (held === null || typeof id !== 'string' || id !== held.id || Date.now() - held.at > PENDING_TTL_MS) {
        return { replaced: false, reason: 'stale' };
      }
      pending = null;
      if (accept !== true) return { replaced: false, reason: 'declined' };
      const outcome = replaceProfile(opts.stamp(held.profile), now());
      if (!outcome.replaced) return { replaced: false, reason: outcome.refused ?? 'write' };
      return { replaced: true, backup: outcome.backup == null ? null : path.basename(outcome.backup) };
    },
  };
}

/**
 * Read a regular file of at most `max` bytes through ONE descriptor: opened non-blocking (a FIFO swapped in
 * cannot hang main), checked with fstat on that descriptor (not the path, which could be swapped between a
 * check and a read), and read with a bound, so a file that grows after the check is still capped.
 */
function readBounded(file: string, max: number): Buffer | 'not-a-file' | 'too-large' {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return 'not-a-file';
    if (st.size > max) return 'too-large';
    const buf = Buffer.alloc(max + 1);
    let n = 0;
    for (;;) {
      const got = fs.readSync(fd, buf, n, buf.length - n, null);
      if (got === 0) break;
      n += got;
      if (n > max) return 'too-large';
    }
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

/** True when `file` would land in `dir` or below it, symlinks resolved as far as they exist. */
function inside(file: string, dir: string): boolean {
  const real = (p: string): string => {
    try {
      // .native: the real case on a case-insensitive volume, so a differently cased path still compares.
      return fs.realpathSync.native(p);
    } catch {
      return path.resolve(p);
    }
  };
  const root = real(dir);
  const parent = real(path.dirname(file));
  const rel = path.relative(root, parent);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
