import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { emptySession, serialize } from '../../src/core/session.js';

/**
 * main/profileFile.ts with Electron's dialog and app path faked; the files are real. What the dialog returns
 * is the only path either side handles.
 */
let userData = '';
let picked = { save: '', open: '' };
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  dialog: {
    showSaveDialog: async () => ({ canceled: false, filePath: picked.save }),
    showOpenDialog: async () => ({ canceled: false, filePaths: [picked.open] }),
  },
}));

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

async function setup(dataDirName = 'data'): Promise<{ files: import('../../src/main/profileFile.js').ProfileFiles; root: string }> {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-pf-')));
  dirs.push(root);
  userData = path.join(root, dataDirName);
  fs.mkdirSync(userData);
  vi.resetModules();
  const store = await import('../../src/main/store.js');
  store.load();
  store.save(serialize(emptySession()));
  const { createProfileFiles } = await import('../../src/main/profileFile.js');
  return { files: createProfileFiles({ window: () => null, userData, stamp: (o) => o }), root };
}

describe('export never writes into the app folder', () => {
  it('refuses the live profile path, even spelled in another case', async () => {
    const { files, root } = await setup('CaseDir');
    const live = path.join(userData, 'offsuit-state.json');
    const before = fs.readFileSync(live, 'utf-8');
    picked.save = live;
    expect(await files.exportProfile()).toEqual({ saved: false, failed: 'app-folder' });
    // The folder as the dialog might spell it on a case-insensitive volume.
    const other = path.join(root, 'casedir', 'offsuit-state.json');
    if (fs.existsSync(path.dirname(other))) {
      picked.save = other;
      expect(await files.exportProfile()).toEqual({ saved: false, failed: 'app-folder' });
    }
    expect(fs.readFileSync(live, 'utf-8')).toBe(before);
  });

  it('writes anywhere else', async () => {
    const { files, root } = await setup();
    picked.save = path.join(root, 'out.json');
    expect(await files.exportProfile()).toMatchObject({ saved: true, fileName: 'out.json' });
  });
});

describe('import reads only a bounded regular file', () => {
  it('a FIFO or a directory is unreadable, and never hangs', async () => {
    const { files, root } = await setup();
    const fifo = path.join(root, 'pipe.json');
    execFileSync('mkfifo', [fifo]);
    picked.open = fifo;
    expect(await files.pickImport()).toEqual({ ok: false, reason: 'unreadable' });
    picked.open = root;
    expect(await files.pickImport()).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('a good file previews, and confirm needs that preview’s id', async () => {
    const { files, root } = await setup();
    picked.open = path.join(root, 'in.json');
    fs.writeFileSync(picked.open, JSON.stringify({ ...serialize(emptySession()), bankroll: 321 }));
    const pick = await files.pickImport();
    expect(pick).toMatchObject({ ok: true, fileName: 'in.json', preview: { bankroll: 321 } });
    expect(files.confirmImport('nope', true)).toEqual({ replaced: false, reason: 'stale' });
    if (!pick.ok) return;
    expect(files.confirmImport(pick.id, true)).toMatchObject({ replaced: true });
    expect(files.confirmImport(pick.id, true)).toEqual({ replaced: false, reason: 'stale' });
    expect(JSON.parse(fs.readFileSync(path.join(userData, 'offsuit-state.json'), 'utf-8')).bankroll).toBe(321);
  });
});
