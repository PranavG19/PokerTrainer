/**
 * Main's side of the Pro tools: the import (native dialog → picked files → worker parse → store), the
 * leak report and the push-fold solves. main.ts registers each IPC channel with `gated()` around these,
 * so none of them runs without Pro; `clear` is the exception, by design (hhStore.ts).
 *
 * The renderer sends nothing an import can be aimed with: no path, no file name. It asks for the dialog
 * and gets counts back. Under e2e a spec stubs `dialog.showOpenDialog` from the test process
 * (electronApp.evaluate); there is no test hook in this file.
 */

import { dialog, type BrowserWindow } from 'electron';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { parseShoveRequest } from '../core/pro/analysis.js';
import type { ParsedHand, SkipReason } from '../core/pro/handHistory.js';
import { createHandStore, expandPicked, MAX_IMPORT_BYTES, readPicked, type FileSkip } from './hhStore.js';
import type { Job } from './proWorker.js';

export interface ImportSummary {
  readonly canceled: boolean;
  readonly busy?: boolean;
  readonly files: number;
  readonly filesSkipped: Partial<Record<FileSkip, number>>;
  readonly parsed: number;
  readonly handsSkipped: Partial<Record<SkipReason, number>>;
  readonly added: number;
  readonly duplicates: number;
  readonly overCap: number;
  readonly tooLarge: number;
  readonly total: number;
  readonly refused?: 'store-unreadable';
}

export interface ProTools {
  importHands(): Promise<ImportSummary>;
  report(): Promise<unknown>;
  shove(request: unknown): Promise<unknown>;
  clear(): { cleared: boolean; busy?: boolean; total: number };
  stop(): void;
}

/** A job that has not answered in this long is a stuck worker: it is ended and the next job gets a new one. */
const JOB_TIMEOUT_MS = 60_000;

export function createProTools(opts: { userData: string; window: () => BrowserWindow | null; platform?: NodeJS.Platform }): ProTools {
  const dir = path.join(opts.userData, 'hand-histories');
  const store = createHandStore(dir);
  let worker: Worker | null = null;
  let nextId = 1;
  /** Pending jobs per worker, so a dead worker fails only its own jobs. */
  const pending = new Map<Worker, Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>>();
  let importing = false;

  const retire = (w: Worker, error: Error): void => {
    const jobs = pending.get(w);
    pending.delete(w);
    if (worker === w) worker = null;
    for (const job of jobs?.values() ?? []) {
      clearTimeout(job.timer);
      job.reject(error);
    }
    void w.terminate().catch(() => undefined);
  };
  const ensure = (): Worker => {
    if (worker !== null) return worker;
    const w = new Worker(new URL('./proWorker.js', import.meta.url));
    pending.set(w, new Map());
    w.on('message', (msg: { id: number; ok: boolean; value?: unknown; error?: string }) => {
      const job = pending.get(w)?.get(msg.id);
      if (job === undefined) return;
      pending.get(w)!.delete(msg.id);
      clearTimeout(job.timer);
      if (msg.ok) job.resolve(msg.value);
      else job.reject(new Error(msg.error ?? 'worker'));
    });
    w.on('error', (e) => retire(w, e instanceof Error ? e : new Error(String(e))));
    w.on('exit', () => retire(w, new Error('worker exited')));
    worker = w;
    return w;
  };
  const post = <T>(job: Job): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const w = ensure();
      const id = nextId++;
      const timer = setTimeout(() => retire(w, new Error('worker timed out')), JOB_TIMEOUT_MS);
      pending.get(w)!.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      w.postMessage({ id, job });
    });

  /**
   * Solves are coalesced: while one runs, only the NEWEST request waits behind it; any request it
   * replaces answers `{ superseded: true }` at once (the screen already ignores stale answers). So ten
   * quick stack edits cost two solves, not ten.
   */
  let solving = false;
  let queued: { request: unknown; resolve: (v: unknown) => void } | null = null;
  const shove = (request: unknown): Promise<unknown> =>
    new Promise((resolve) => {
      // Checked here too, so a malformed request never costs a worker job.
      if (parseShoveRequest(request) === null) {
        resolve({ invalid: true });
        return;
      }
      if (solving) {
        queued?.resolve({ superseded: true });
        queued = { request, resolve };
        return;
      }
      solving = true;
      const run = (req: unknown, done: (v: unknown) => void): void => {
        post({ kind: 'shove', request: req })
          .then(done, () => done({ failed: true }))
          .finally(() => {
            const next = queued;
            queued = null;
            if (next !== null) run(next.request, next.resolve);
            else solving = false;
          });
      };
      run(request, resolve);
    });

  const empty = (canceled: boolean, busy = false): ImportSummary => ({
    canceled,
    busy,
    files: 0,
    filesSkipped: {},
    parsed: 0,
    handsSkipped: {},
    added: 0,
    duplicates: 0,
    overCap: 0,
    tooLarge: 0,
    total: store.count(),
  });

  return {
    async importHands() {
      if (importing) return empty(false, true);
      importing = true;
      try {
        const win = opts.window();
        // A file-or-folder picker exists on macOS only; elsewhere the two together make a folder-only one.
        const both = (opts.platform ?? process.platform) === 'darwin';
        const options: Electron.OpenDialogOptions = {
          title: 'Import hand histories',
          buttonLabel: 'Import',
          properties: both ? ['openFile', 'openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
          filters: [{ name: 'Hand histories (.txt)', extensions: ['txt'] }],
        };
        const picked = win === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(win, options);
        if (picked.canceled || !Array.isArray(picked.filePaths) || picked.filePaths.length === 0) return empty(true);

        const { files, skipped: filesSkipped } = expandPicked(picked.filePaths);
        const texts: string[] = [];
        let bytes = 0;
        for (const f of files) {
          const r = await readPicked(f, MAX_IMPORT_BYTES - bytes);
          if ('skip' in r) {
            filesSkipped[r.skip] = (filesSkipped[r.skip] ?? 0) + 1;
            continue;
          }
          bytes += r.bytes;
          texts.push(r.text);
        }
        const { hands, skipped } =
          texts.length === 0
            ? { hands: [] as ParsedHand[], skipped: {} as Partial<Record<SkipReason, number>> }
            : await post<{ hands: ParsedHand[]; skipped: Partial<Record<SkipReason, number>> }>({ kind: 'parse', texts });
        const outcome = store.add(hands, { at: new Date().toISOString(), files: texts.length });
        return { canceled: false, files: texts.length, filesSkipped, parsed: hands.length, handsSkipped: skipped, ...outcome };
      } finally {
        importing = false;
      }
    },
    report: () => post({ kind: 'report', dir }),
    shove,
    clear() {
      // Not mid-import: the import's hands would land right after "deleted".
      if (importing) return { cleared: false, busy: true, total: store.count() };
      store.clear();
      return { cleared: true, total: 0 };
    },
    stop() {
      if (worker !== null) retire(worker, new Error('stopped'));
    },
  };
}
