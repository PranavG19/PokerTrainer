import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { backupPath } from '../../src/core/backup.js';
import { deserialize, emptySession, recordHand, serialize, type HandRecord } from '../../src/core/session.js';

/**
 * The main-process store against a real temp directory. Only Electron's `app.getPath` is faked; the
 * file operations are the real ones. Each test imports a fresh store module, which is what a restart is.
 */
let userData = '';
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

const dirs: string[] = [];

async function freshStore(dir?: string): Promise<typeof import('../../src/main/store.js')> {
  userData = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-store-'));
  if (!dirs.includes(userData)) dirs.push(userData);
  vi.resetModules();
  return import('../../src/main/store.js');
}

const stateFile = () => path.join(userData, 'offsuit-state.json');
const snapshotFile = () => `${stateFile()}.pre-v2`;
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;

/** A v1 profile exactly as a pre-v2 build wrote it: no schemaVersion, no progression. */
function writeV1(extra: Record<string, unknown> = {}): string {
  const s = serialize(emptySession());
  delete s.schemaVersion;
  delete s.progression;
  const text = JSON.stringify({ ...s, bankroll: 8740, stats: { ...(s.stats as object), handsPlayed: 37 }, ...extra }, null, 2);
  fs.writeFileSync(stateFile(), text, 'utf-8');
  return text;
}

const hand = (net: number): HandRecord =>
  ({ playedAt: Date.now(), net, vpip: false, pfr: false, grades: [], decisions: [] }) as unknown as HandRecord;

/** What the renderer does: deserialize the load, change something, serialize. */
function playOneHand(loaded: Record<string, unknown>, net = 100): Record<string, unknown> {
  return serialize(recordHand(deserialize(loaded), hand(net)));
}

/** A pre-v2 build's save: it knows only v1 keys, so it drops schemaVersion, progression and anything new. */
function saveAsPreV2Build(obj: Record<string, unknown>): void {
  const { schemaVersion: _v, progression: _p, ...v1 } = obj;
  void _v;
  void _p;
  for (const key of Object.keys(v1)) if (key.startsWith('future')) delete v1[key];
  // Its saveWithBackup: rotate, copy, atomic write.
  fs.writeFileSync(stateFile(), JSON.stringify(v1, null, 2));
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.chmodSync(dir, 0o755);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('upgrading a v1 profile', () => {
  it('migrates on load, snapshots the original byte-for-byte before any save, and keeps every v1 field', async () => {
    const store = await freshStore();
    const original = writeV1();
    const loaded = store.load();
    expect(loaded.schemaVersion).toBe(2);
    expect(fs.readFileSync(snapshotFile(), 'utf-8')).toBe(original);
    // Loading alone writes nothing to the live file.
    expect(fs.readFileSync(stateFile(), 'utf-8')).toBe(original);
    expect(store.profileStatus()).toMatchObject({ migratedFrom: 1, fileSchemaVersion: 1, readOnly: null });

    expect(store.save(playOneHand(loaded))).toEqual({ saved: true, readOnly: null });
    const onDisk = readJson(stateFile());
    expect(onDisk.schemaVersion).toBe(2);
    expect(onDisk.progression).toBeTypeOf('object');
    expect((onDisk.stats as { handsPlayed: number }).handsPlayed).toBe(38);
    // The rolling backup also holds the pre-migration file after the first save.
    expect(fs.readFileSync(backupPath(stateFile(), 1), 'utf-8')).toBe(original);
  });

  it('the snapshot outlives the rolling backups', async () => {
    const store = await freshStore();
    const original = writeV1();
    let state = store.load();
    for (let i = 0; i < 6; i++) {
      state = playOneHand(state);
      store.save(state);
    }
    expect(fs.readFileSync(backupPath(stateFile(), 3), 'utf-8')).not.toBe(original);
    expect(fs.readFileSync(snapshotFile(), 'utf-8')).toBe(original);
  });

  it('a crash after the snapshot but before the first save just migrates again on restart', async () => {
    let store = await freshStore();
    const original = writeV1();
    store.load(); // ... and the process dies here.
    store = await freshStore(userData);
    const loaded = store.load();
    expect(loaded.schemaVersion).toBe(2);
    expect(fs.readFileSync(snapshotFile(), 'utf-8')).toBe(original);
    expect(store.save(playOneHand(loaded)).saved).toBe(true);
  });

  it('a crash mid-write leaves only a temp file, which the next load removes', async () => {
    let store = await freshStore();
    const original = writeV1();
    store.load();
    const torn = `${stateFile()}.0b6d3c8e-2f8e-4c1a-9a51-0e7f3f2b9c11.tmp`;
    fs.writeFileSync(torn, '{"bankroll": 12');
    store = await freshStore(userData);
    store.load();
    expect(fs.existsSync(torn)).toBe(false);
    expect(fs.readFileSync(stateFile(), 'utf-8')).toBe(original);
  });

  it('migrates a profile recovered from a backup, snapshotting the backup it actually read', async () => {
    const store = await freshStore();
    writeV1();
    fs.renameSync(stateFile(), backupPath(stateFile(), 1));
    fs.writeFileSync(stateFile(), '{"bankroll": 1'); // torn live file
    const backupText = fs.readFileSync(backupPath(stateFile(), 1), 'utf-8');
    const loaded = store.load();
    expect(store.profileStatus().lastRecovery).toBe('backup-1');
    expect(loaded.schemaVersion).toBe(2);
    expect(fs.readFileSync(snapshotFile(), 'utf-8')).toBe(backupText);
  });
});

describe('disk full', () => {
  it('a snapshot that cannot be written blocks the save, and the v1 file stays as it was', async () => {
    const store = await freshStore();
    const original = writeV1();
    fs.chmodSync(userData, 0o555); // nothing new can be created in the directory: the snapshot fails
    const loaded = store.load(); // loading still works
    expect(loaded.schemaVersion).toBe(2);
    expect(store.save(playOneHand(loaded))).toEqual({ saved: false, readOnly: null, failed: 'pre-migration-copy' });
    expect(fs.readFileSync(stateFile(), 'utf-8')).toBe(original);
    expect(fs.existsSync(snapshotFile())).toBe(false);

    fs.chmodSync(userData, 0o755); // space again: the next save takes the snapshot first, then writes
    expect(store.save(playOneHand(loaded)).saved).toBe(true);
    expect(fs.readFileSync(snapshotFile(), 'utf-8')).toBe(original);
  });
});

describe('a profile from a newer build', () => {
  it('opens read-only, reports it, and never writes the file, its backups or a snapshot', async () => {
    const store = await freshStore();
    const v3 = JSON.stringify({ schemaVersion: 3, bankroll: 5000, hands: [], stats: {}, progression: { v3: true }, newThing: [1] });
    fs.writeFileSync(stateFile(), v3);
    const loaded = store.load();
    expect(loaded.schemaVersion).toBe(3);
    expect(store.profileStatus()).toMatchObject({ readOnly: 'newer-version', fileSchemaVersion: 3, migratedFrom: null });

    const outcome = store.save(playOneHand(loaded));
    expect(outcome).toEqual({ saved: false, readOnly: 'newer-version' });
    expect(fs.readFileSync(stateFile(), 'utf-8')).toBe(v3);
    expect(fs.readdirSync(userData).sort()).toEqual(['offsuit-state.json']);
  });

  it('delete is the one way out: afterwards a fresh v2 profile saves', async () => {
    const store = await freshStore();
    fs.writeFileSync(stateFile(), JSON.stringify({ schemaVersion: 9, bankroll: 1 }));
    store.load();
    expect(store.deleteProfile('DELETE PROFILE').deleted).toBe(true);
    expect(store.profileStatus().readOnly).toBeNull();
    expect(store.save(serialize(emptySession())).saved).toBe(true);
    expect(readJson(stateFile()).schemaVersion).toBe(2);
  });
});

describe('downgrade and re-upgrade', () => {
  it('a pre-v2 build in between loses only what it never knew; the re-upgrade keeps the first snapshot', async () => {
    let store = await freshStore();
    const original = writeV1();
    let state = store.load();
    state = playOneHand(state);
    store.save(state); // v2 on disk

    // Downgrade: a pre-v2 build loads and saves (it drops schemaVersion and progression).
    saveAsPreV2Build(playOneHand(readJson(stateFile())));
    const afterDowngrade = readJson(stateFile());
    expect(afterDowngrade.schemaVersion).toBeUndefined();

    // Re-upgrade.
    store = await freshStore(userData);
    state = store.load();
    expect(store.profileStatus().migratedFrom).toBe(1);
    expect((state.stats as { handsPlayed: number }).handsPlayed).toBe(39); // the downgraded build's hand is kept
    expect(store.save(playOneHand(state)).saved).toBe(true);
    expect(fs.readFileSync(snapshotFile(), 'utf-8')).toBe(original); // the first snapshot is never overwritten
  });

  it('a v2 build that is older than the data (same version, fewer keys) keeps the newer keys', async () => {
    const store = await freshStore();
    const v2 = serialize(emptySession());
    fs.writeFileSync(stateFile(), JSON.stringify({ ...v2, futureTop: { a: 1 }, progression: { ...(v2.progression as object), quests: [1] } }));
    const loaded = store.load();
    store.save(playOneHand(loaded));
    const onDisk = readJson(stateFile());
    expect(onDisk.futureTop).toEqual({ a: 1 });
    expect((onDisk.progression as Record<string, unknown>).quests).toEqual([1]);
  });
});

describe('a second copy writing the same profile', () => {
  it('stops saving instead of overwriting the other copy’s progress', async () => {
    const store = await freshStore();
    writeV1();
    const loaded = store.load();
    expect(store.save(playOneHand(loaded)).saved).toBe(true);

    // Another instance (or an older build without the lock) writes the file.
    const theirs = { ...readJson(stateFile()), bankroll: 1234 };
    fs.writeFileSync(stateFile(), JSON.stringify(theirs, null, 2) + '\n');

    expect(store.save(playOneHand(loaded))).toEqual({ saved: false, readOnly: 'changed-elsewhere' });
    expect(readJson(stateFile()).bankroll).toBe(1234);
    expect(store.profileStatus().readOnly).toBe('changed-elsewhere');
  });
});

describe('a write that fails', () => {
  it('reports failed instead of throwing, keeps every backup, and the next save lands', async () => {
    const store = await freshStore();
    let state = store.load();
    for (let i = 0; i < 4; i++) {
      state = playOneHand(state);
      store.save(state);
    }
    const backups = [1, 2, 3].map((slot) => fs.readFileSync(backupPath(stateFile(), slot), 'utf-8'));
    const live = fs.readFileSync(stateFile(), 'utf-8');
    fs.chmodSync(userData, 0o555); // no new file can be created: the temp write fails, like a full disk
    for (let i = 0; i < 3; i++) {
      state = playOneHand(state);
      expect(store.save(state)).toEqual({ saved: false, readOnly: null, failed: 'write' });
    }
    expect(fs.readFileSync(stateFile(), 'utf-8')).toBe(live);
    expect([1, 2, 3].map((slot) => fs.readFileSync(backupPath(stateFile(), slot), 'utf-8'))).toEqual(backups);
    fs.chmodSync(userData, 0o755);
    expect(store.save(state).saved).toBe(true);
  });
});

describe('a file touched but not changed', () => {
  it('does not stop saving: only different bytes count as another copy’s write', async () => {
    const store = await freshStore();
    const loaded = store.load();
    store.save(playOneHand(loaded));
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(stateFile(), future, future);
    expect(store.save(playOneHand(loaded)).saved).toBe(true);
  });
});

describe('delete', () => {
  it('removes the pre-migration snapshot with the profile and its backups', async () => {
    const store = await freshStore();
    writeV1();
    const loaded = store.load();
    store.save(playOneHand(loaded));
    expect(fs.existsSync(snapshotFile())).toBe(true);
    const outcome = store.deleteProfile('DELETE PROFILE');
    expect(outcome.removed).toContain(snapshotFile());
    expect(fs.readdirSync(userData).filter((n) => n.startsWith('offsuit-state'))).toEqual([]);
  });
});

describe('a fresh profile', () => {
  it('loads as v2 with no migration and no snapshot', async () => {
    const store = await freshStore();
    const loaded = store.load();
    expect(loaded.schemaVersion).toBe(2);
    expect(store.profileStatus()).toMatchObject({ migratedFrom: null, readOnly: null, preMigrationCopy: null });
    expect(store.save(playOneHand(loaded)).saved).toBe(true);
    expect(fs.existsSync(snapshotFile())).toBe(false);
  });
});

describe('an import replacing the profile', () => {
  const NOW = new Date('2026-10-20T15:30:12.345Z');
  const preImport = () => `${stateFile()}.pre-import-20261020T153012Z`;
  const imported = (): Record<string, unknown> => ({ ...serialize(emptySession()), bankroll: 777 });

  it('copies the live profile aside first, byte for byte, then writes the import', async () => {
    const store = await freshStore();
    const loaded = store.load();
    store.save(playOneHand(loaded));
    const before = fs.readFileSync(stateFile(), 'utf-8');
    const outcome = store.replaceProfile(imported(), NOW);
    expect(outcome).toEqual({ replaced: true, backup: preImport() });
    expect(fs.readFileSync(preImport(), 'utf-8')).toBe(before);
    expect(readJson(stateFile()).bankroll).toBe(777);
    // The rolling backups still hold the replaced profile too.
    expect(fs.readFileSync(backupPath(stateFile(), 1), 'utf-8')).toBe(before);
  });

  it('refuses every save until the renderer reloads, so the old session cannot write itself back', async () => {
    const store = await freshStore();
    const loaded = store.load();
    store.save(playOneHand(loaded));
    store.replaceProfile(imported(), NOW);
    expect(store.save(playOneHand(loaded))).toEqual({ saved: false, readOnly: null, failed: 'reloading' });
    expect(store.resaveLast((o) => o).saved).toBe(false);
    expect(readJson(stateFile()).bankroll).toBe(777);
    const reloaded = store.load();
    expect(reloaded.bankroll).toBe(777);
    expect(store.save(playOneHand(reloaded)).saved).toBe(true);
  });

  it('a second import in the same second keeps both copies', async () => {
    const store = await freshStore();
    store.load();
    store.save(serialize(emptySession()));
    store.replaceProfile(imported(), NOW);
    store.load();
    expect(store.replaceProfile({ ...imported(), bankroll: 888 }, NOW)).toEqual({ replaced: true, backup: `${preImport()}-2` });
    expect(readJson(preImport()).bankroll).toBe(10000);
    expect(readJson(`${preImport()}-2`).bankroll).toBe(777);
  });

  it('with no profile on disk there is nothing to keep, and the import lands', async () => {
    const store = await freshStore();
    store.load();
    expect(store.replaceProfile(imported(), NOW)).toEqual({ replaced: true, backup: null });
    expect(readJson(stateFile()).bankroll).toBe(777);
  });

  it('writes nothing when the copy cannot be made', async () => {
    const store = await freshStore();
    store.load();
    store.save(serialize(emptySession()));
    const before = fs.readFileSync(stateFile(), 'utf-8');
    fs.chmodSync(userData, 0o555);
    expect(store.replaceProfile(imported(), NOW)).toEqual({ replaced: false, refused: 'backup' });
    fs.chmodSync(userData, 0o755);
    expect(fs.readFileSync(stateFile(), 'utf-8')).toBe(before);
    expect(store.save(serialize(emptySession())).saved).toBe(true);
  });

  it('never replaces a profile from a newer build, or one another copy changed', async () => {
    const store = await freshStore();
    const v3 = JSON.stringify({ schemaVersion: 3, bankroll: 5000, hands: [] });
    fs.writeFileSync(stateFile(), v3);
    store.load();
    expect(store.replaceProfile(imported(), NOW)).toEqual({ replaced: false, refused: 'read-only' });
    expect(fs.readFileSync(stateFile(), 'utf-8')).toBe(v3);

    const other = await freshStore();
    other.load();
    other.save(serialize(emptySession()));
    fs.writeFileSync(stateFile(), JSON.stringify({ bankroll: 1, hands: [] }));
    expect(other.replaceProfile(imported(), NOW)).toEqual({ replaced: false, refused: 'read-only' });
    expect(readJson(stateFile()).bankroll).toBe(1);
  });

  it('delete removes the pre-import copies with everything else', async () => {
    const store = await freshStore();
    store.load();
    store.save(serialize(emptySession()));
    store.replaceProfile(imported(), NOW);
    expect(store.deleteProfile('DELETE PROFILE').removed).toContain(preImport());
    expect(fs.readdirSync(userData).filter((n) => n.startsWith('offsuit-state'))).toEqual([]);
  });

  it('currentProfile is a copy of what was last loaded or saved', async () => {
    const store = await freshStore();
    const loaded = store.load();
    const saved = playOneHand(loaded);
    store.save(saved);
    const current = store.currentProfile();
    expect(current).toEqual(saved);
    (current as Record<string, unknown>).bankroll = -1;
    expect(store.currentProfile()?.bankroll).toBe(saved.bankroll);
    store.deleteProfile('DELETE PROFILE');
    expect(store.currentProfile()).toBeNull();
  });
});

describe('an import over a profile recovered from a backup', () => {
  const NOW = new Date('2026-10-20T15:30:12.345Z');
  const preImport = () => `${stateFile()}.pre-import-20261020T153012Z`;
  const recovered = () => JSON.stringify({ ...serialize(emptySession()), bankroll: 4242 });

  it('copies aside the profile the app is running on, not a missing live file', async () => {
    const store = await freshStore();
    fs.writeFileSync(backupPath(stateFile(), 1), recovered());
    expect(store.load().bankroll).toBe(4242);
    const outcome = store.replaceProfile({ ...serialize(emptySession()), bankroll: 1 }, NOW);
    expect(outcome).toEqual({ replaced: true, backup: preImport() });
    expect(readJson(preImport()).bankroll).toBe(4242);
  });

  it('copies aside the profile the app is running on, not a torn live file', async () => {
    const store = await freshStore();
    fs.writeFileSync(backupPath(stateFile(), 1), recovered());
    fs.writeFileSync(stateFile(), '{torn');
    expect(store.load().bankroll).toBe(4242);
    expect(store.replaceProfile({ ...serialize(emptySession()), bankroll: 1 }, NOW).replaced).toBe(true);
    expect(readJson(preImport()).bankroll).toBe(4242);
  });
});
