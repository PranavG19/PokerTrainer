import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * THE MAIN/PRELOAD IPC CONTRACT CANNOT DRIFT.
 *
 * The channel strings live in two files: src/main/main.ts registers them with `ipcMain.handle(...)`,
 * and src/main/preload.ts calls them with `ipcRenderer.invoke(...)`. A shared constants module would
 * be the obvious fix, but the two files compile through DIFFERENT module systems — main.ts as ES2022,
 * preload.ts as CommonJS into the same dist/main/ dir (see tsconfig.main.json / tsconfig.preload.json
 * and the `mv preload.js preload.cjs` build step) — so a runtime constant imported by both would be
 * overwritten by the preload build and break main's ESM import. The ESM/CJS seam is exactly why the
 * shared-module route is more trouble than it is worth at this size.
 *
 * So the contract is pinned by a TEST instead: parse both files, and assert the set of channels the
 * main process handles is EXACTLY the set the preload bridge invokes. A renamed channel on one side,
 * or a handler with no bridge (a dead channel with no compile error), or a bridge with no handler (an
 * invoke that will hang), all fail here. This is the drift-detection the shared constant would have
 * given us, without touching the build seam.
 */

const ROOT = path.resolve(import.meta.dirname, '..', '..');

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

/** Every channel string passed to `ipcMain.handle('...')`. */
function handledChannels(mainSource: string): string[] {
  return [...mainSource.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map((m) => m[1]);
}

/** Every channel string passed to `ipcRenderer.invoke('...')`. */
function invokedChannels(preloadSource: string): string[] {
  return [...preloadSource.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map((m) => m[1]);
}

describe('the main/preload IPC channel contract stays in sync', () => {
  const main = readSource('src/main/main.ts');
  const preload = readSource('src/main/preload.ts');
  const handled = handledChannels(main);
  const invoked = invokedChannels(preload);

  it('finds channels on both sides — the parse is not silently empty', () => {
    // A regex that stopped matching would make every set-equality below pass vacuously.
    expect(handled.length).toBeGreaterThan(5);
    expect(invoked.length).toBeGreaterThan(5);
  });

  it('registers each channel exactly once in main — no duplicate handler shadows another', () => {
    expect(handled.length).toBe(new Set(handled).size);
  });

  it('invokes each channel exactly once in preload', () => {
    expect(invoked.length).toBe(new Set(invoked).size);
  });

  it('every handled channel has a preload bridge — no dead channel the renderer can never reach', () => {
    const bridged = new Set(invoked);
    const orphanHandlers = handled.filter((c) => !bridged.has(c));
    expect(orphanHandlers, `main handles channels the preload never invokes: ${orphanHandlers.join(', ')}`).toEqual([]);
  });

  it('every invoked channel has a main handler — no bridge that would hang forever', () => {
    const registered = new Set(handled);
    const orphanInvokes = invoked.filter((c) => !registered.has(c));
    expect(orphanInvokes, `preload invokes channels main never handles: ${orphanInvokes.join(', ')}`).toEqual([]);
  });

  it('the two sides describe the identical channel set', () => {
    expect([...handled].sort()).toEqual([...invoked].sort());
  });
});
