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
  readonly total: number;
}

export interface ProTools {
  importHands(): Promise<ImportSummary>;
  report(): Promise<unknown>;
  shove(request: unknown): Promise<unknown>;
  clear(): { cleared: true; total: 0 };
  stop(): void;
}

export function createProTools(opts: { userData: string; window: () => BrowserWindow | null }): ProTools {
  const dir = path.join(opts.userData, 'hand-histories');
  const store = createHandStore(dir);
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let importing = false;

  const failAll = (error: Error): void => {
    for (const p of pending.values()) p.reject(error);
    pending.clear();
    worker = null;
  };
  const ensure = (): Worker => {
    if (worker !== null) return worker;
    const w = new Worker(new URL('./proWorker.js', import.meta.url));
    w.on('message', (msg: { id: number; ok: boolean; value?: unknown; error?: string }) => {
      const p = pending.get(msg.id);
      if (p === undefined) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.value);
      else p.reject(new Error(msg.error ?? 'worker'));
    });
    w.on('error', (e) => failAll(e instanceof Error ? e : new Error(String(e))));
    w.on('exit', () => failAll(new Error('worker exited')));
    worker = w;
    return w;
  };
  const post = <T>(job: Job): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      ensure().postMessage({ id, job });
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
    total: store.count(),
  });

  return {
    async importHands() {
      if (importing) return empty(false, true);
      importing = true;
      try {
        const win = opts.window();
        const options: Electron.OpenDialogOptions = {
          title: 'Import hand histories',
          buttonLabel: 'Import',
          properties: ['openFile', 'openDirectory', 'multiSelections'],
          filters: [{ name: 'Hand histories (.txt)', extensions: ['txt'] }],
        };
        const picked = win === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(win, options);
        if (picked.canceled || !Array.isArray(picked.filePaths) || picked.filePaths.length === 0) return empty(true);

        const { files, skipped: filesSkipped } = expandPicked(picked.filePaths);
        const texts: string[] = [];
        let bytes = 0;
        let read = 0;
        for (const f of files) {
          if (bytes + f.size > MAX_IMPORT_BYTES) {
            filesSkipped['import-too-large'] = (filesSkipped['import-too-large'] ?? 0) + 1;
            continue;
          }
          const r = readPicked(f);
          if ('skip' in r) {
            filesSkipped[r.skip] = (filesSkipped[r.skip] ?? 0) + 1;
            continue;
          }
          bytes += f.size;
          read++;
          texts.push(r.text);
        }
        const { hands, skipped } = texts.length === 0
          ? { hands: [] as ParsedHand[], skipped: {} as Partial<Record<SkipReason, number>> }
          : await post<{ hands: ParsedHand[]; skipped: Partial<Record<SkipReason, number>> }>({ kind: 'parse', texts });
        const outcome = store.add(hands, { at: new Date().toISOString(), files: read });
        return {
          canceled: false,
          files: read,
          filesSkipped,
          parsed: hands.length,
          handsSkipped: skipped,
          ...outcome,
        };
      } finally {
        importing = false;
      }
    },
    report: () => post({ kind: 'report', dir }),
    shove: (request) => post({ kind: 'shove', request }),
    clear() {
      store.clear();
      return { cleared: true, total: 0 };
    },
    stop() {
      void worker?.terminate();
      worker = null;
    },
  };
}
