import { app } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  atomicWrite,
  countBackups,
  deleteProfile as deleteProfileFiles,
  loadWithRecovery,
  preMigrationPath,
  saveWithBackup,
  snapshotBeforeMigrate,
  sweepTempFiles,
  type DeleteOutcome,
  type RecoverySource,
} from '../core/backup.js';
import { migrate, SCHEMA_VERSION } from '../core/profileSchema.js';

const STATE_FILE = path.join(app.getPath('userData'), 'offsuit-state.json');

/**
 * The privacy switch lives outside the profile on purpose: deleting the profile
 * destroys the decision log, and a privacy setting silently flipping back on
 * because the log was deleted would be the wrong default in the wrong direction.
 */
const SETTINGS_FILE = path.join(app.getPath('userData'), 'offsuit-settings.json');

const DEFAULT_STATE = { bankroll: 10000, hands: [], stats: {} };

/**
 * How the last load resolved, so settings can say a backup was used rather than
 * letting a recovery look like lost progress.
 */
let lastRecovery: RecoverySource = 'fresh';

/**
 * Why saves are refused, or null when they are not.
 * - `newer-version`: the profile was written by a newer Offsuit (a higher `schemaVersion`). Writing it
 *   back could drop or misread what that build stored, so this build only reads it.
 * - `changed-elsewhere`: the file changed on disk after this build last read or wrote it (another copy
 *   of Offsuit, or an older build without the single-instance lock). Saving now would overwrite that
 *   copy's progress with this one's, so this build stops writing until it is restarted.
 */
export type ReadOnlyReason = 'newer-version' | 'changed-elsewhere';
let readOnly: ReadOnlyReason | null = null;

/** The `schemaVersion` of the profile as it was on disk at load. */
let fileSchemaVersion = SCHEMA_VERSION;
/** The version this load migrated from, or null when no migration ran. Shown in Settings. */
let migratedFrom: number | null = null;
/**
 * A migration whose pre-migration snapshot is not on disk yet (the copy failed at load, say on a full
 * disk). The first save retries it and refuses to write until it succeeds, so a migrated profile never
 * replaces the only copy of the original.
 */
let pendingSnapshot: { source: string; toVersion: number } | null = null;
/** What the live file looked like after this build last read or wrote it; null when it did not exist. */
let lastSeen: FileStamp | null = null;
/**
 * A hash of those bytes. A changed mtime or size alone does not stop saving: the content must differ
 * too, so a touched-but-identical file (a sync tool, a coarse clock) can never silently end all saves.
 */
let lastSeenHash: string | null = null;

function hashOf(file: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * After a write, `written` is the text this build just wrote: hashing that rather than re-reading the
 * file means another writer landing in between is still seen as foreign.
 */
function remember(written?: string): void {
  lastSeen = stampOf(STATE_FILE);
  lastSeenHash =
    written === undefined ? hashOf(STATE_FILE) : crypto.createHash('sha256').update(written, 'utf-8').digest('hex');
}

/** True only when the live file's bytes differ from what this build last read or wrote. */
function changedElsewhere(): boolean {
  const now = stampOf(STATE_FILE);
  if (sameStamp(now, lastSeen)) return false;
  const hash = hashOf(STATE_FILE);
  // Present but unreadable for a moment is not evidence of another writer; stopping all saves on it
  // would be the worse failure. A file that is gone (now === null) still counts as changed.
  if (hash === null && now !== null) return false;
  if (hash !== lastSeenHash) return true;
  lastSeen = now;
  return false;
}

interface FileStamp {
  readonly mtimeMs: number;
  readonly size: number;
}

function stampOf(file: string): FileStamp | null {
  try {
    const st = fs.statSync(file);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

function sameStamp(a: FileStamp | null, b: FileStamp | null): boolean {
  return a === null || b === null ? a === b : a.mtimeMs === b.mtimeMs && a.size === b.size;
}

export function load(): Record<string, unknown> {
  sweepTempFiles(STATE_FILE);
  const recovery = loadWithRecovery(STATE_FILE);
  lastRecovery = recovery.source;
  remember();
  readOnly = null;
  migratedFrom = null;
  pendingSnapshot = null;

  if (recovery.state === null) {
    fileSchemaVersion = SCHEMA_VERSION;
    lastProfile = migrate(structuredClone(DEFAULT_STATE)).state;
    return lastProfile;
  }

  const result = migrate(recovery.state);
  lastProfile = result.state;
  fileSchemaVersion = result.from;
  if (result.tooNew) {
    readOnly = 'newer-version';
    return result.state;
  }
  if (result.from < result.to && recovery.path !== null) {
    migratedFrom = result.from;
    pendingSnapshot = { source: recovery.path, toVersion: result.to };
    try {
      takePendingSnapshot();
    } catch {
      // Still pending: the first save retries it and refuses to write if it fails again. Loading
      // never fails on it, because reading the profile is safe.
    }
  }
  return result.state;
}

/** Throws when the snapshot cannot be written; a no-op once it exists. */
function takePendingSnapshot(): void {
  if (pendingSnapshot === null) return;
  snapshotBeforeMigrate(STATE_FILE, pendingSnapshot.source, pendingSnapshot.toVersion);
  pendingSnapshot = null;
}

export interface SaveOutcome {
  readonly saved: boolean;
  readonly readOnly: ReadOnlyReason | null;
  /**
   * Set when the write itself failed (a full disk, or the pre-migration copy could not be made first).
   * Returned rather than thrown so the renderer can say so: a thrown save would be an unhandled
   * rejection at ~20 call sites, and the learner would play on with nothing saved and nothing shown.
   * Nothing was written; the renderer keeps its session in memory and the next save retries.
   */
  readonly failed?: 'write' | 'pre-migration-copy';
}

/** Write the renderer's profile, unless this build must not. Never throws. */
export function save(obj: Record<string, unknown>): SaveOutcome {
  if (readOnly !== null) return { saved: false, readOnly };
  if (changedElsewhere()) {
    readOnly = 'changed-elsewhere';
    return { saved: false, readOnly };
  }
  try {
    takePendingSnapshot();
  } catch {
    return { saved: false, readOnly: null, failed: 'pre-migration-copy' };
  }
  // Stamped here as well as by serialize, so nothing this build writes can claim another version.
  const text = JSON.stringify({ ...obj, schemaVersion: SCHEMA_VERSION }, null, 2);
  try {
    saveWithBackup(STATE_FILE, text);
  } catch {
    return { saved: false, readOnly: null, failed: 'write' };
  }
  remember(text);
  lastProfile = obj;
  return { saved: true, readOnly: null };
}

export interface ProfileStatus {
  readonly path: string;
  readonly backupCount: number;
  readonly lastRecovery: RecoverySource;
  /** The profile format this build writes. */
  readonly schemaVersion: number;
  /** The format of the file as it was loaded. Above `schemaVersion` means a newer build wrote it. */
  readonly fileSchemaVersion: number;
  readonly migratedFrom: number | null;
  /** The pre-migration copy, when one exists for the version this build writes. */
  readonly preMigrationCopy: string | null;
  readonly readOnly: ReadOnlyReason | null;
}

export function profileStatus(): ProfileStatus {
  const copy = preMigrationPath(STATE_FILE, SCHEMA_VERSION);
  return {
    path: STATE_FILE,
    backupCount: countBackups(STATE_FILE),
    lastRecovery,
    schemaVersion: SCHEMA_VERSION,
    fileSchemaVersion,
    migratedFrom,
    preMigrationCopy: fs.existsSync(copy) ? copy : null,
    readOnly,
  };
}

export function deleteProfile(confirmation: string): DeleteOutcome {
  const outcome = deleteProfileFiles(STATE_FILE, confirmation);
  // A deleted profile is a fresh one; leaving the old label would misreport it.
  if (outcome.deleted) {
    lastRecovery = 'fresh';
    // The learner chose to start over, so the next save writes a fresh current-version profile, whatever
    // the deleted one was. Delete is the one way out of read-only.
    readOnly = null;
    migratedFrom = null;
    pendingSnapshot = null;
    fileSchemaVersion = SCHEMA_VERSION;
    // The deleted profile must never come back through resaveLast (a licence install right after a delete).
    lastProfile = null;
    remember();
  }
  return outcome;
}

/**
 * Only an explicit `false` turns the tutor off. An absent or unreadable file
 * means "never chosen", which is not the same as "chosen off" — and reading a
 * torn file as off would silently disable a tutor the learner had configured.
 * The switch is a no-op anyway without credentials, so the safe direction here
 * is the one that never invents a choice the learner did not make.
 */
export function loadTutorEnabled(): boolean {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    if (typeof parsed !== 'object' || parsed === null) return true;
    return (parsed as { tutorEnabled?: unknown }).tutorEnabled !== false;
  } catch {
    return true;
  }
}

export function saveTutorEnabled(enabled: boolean): void {
  // Atomic, without version history: this file holds one boolean the learner can
  // always re-set, so a rolling backup of it would buy nothing.
  writeSettings({ tutorEnabled: enabled });
}

/**
 * Multiplayer defaults OFF, the OPPOSITE of the tutor. The tutor is a no-op without credentials, so
 * defaulting it on is harmless; multiplayer OPENS A SOCKET, so a fresh profile that never chose it must
 * not be networkable — that is what keeps the network seal intact (and no-network.spec green) with no
 * settings file present. Only an explicit `true` turns it on.
 */
export function loadMultiplayerEnabled(): boolean {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    if (typeof parsed !== 'object' || parsed === null) return false;
    return (parsed as { multiplayerEnabled?: unknown }).multiplayerEnabled === true;
  } catch {
    return false;
  }
}

export function saveMultiplayerEnabled(enabled: boolean): void {
  writeSettings({ multiplayerEnabled: enabled });
}

/**
 * The visual theme is a device/display preference (like the tutor switch), not learner profile state,
 * so it lives in the settings file rather than the profile. Graphite is the default: an absent or
 * unreadable file, or an unknown value, resolves to graphite — the same value :root paints before any
 * JS runs, so a missing choice never flashes the wrong theme. Only a known theme name is honoured.
 */
const THEMES = new Set(['graphite', 'obsidian']);

export function loadTheme(): string {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    const theme = (parsed as { theme?: unknown })?.theme;
    return typeof theme === 'string' && THEMES.has(theme) ? theme : 'graphite';
  } catch {
    return 'graphite';
  }
}

export function saveTheme(theme: string): void {
  if (!THEMES.has(theme)) return;
  writeSettings({ theme });
}

/**
 * The licence mirror (src/main/licence.ts): the token and the clock high-water mark, kept outside the
 * profile so that deleting the profile neither loses a purchase nor resets the rollback guard.
 */
export function loadLicenceMirror(): { token: string | null; highWater: number } {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    const m = (parsed as { licence?: { token?: unknown; highWater?: unknown } })?.licence;
    return {
      token: typeof m?.token === 'string' && m.token.length <= 2048 ? m.token : null,
      highWater: typeof m?.highWater === 'number' && Number.isFinite(m.highWater) ? m.highWater : 0,
    };
  } catch {
    return { token: null, highWater: 0 };
  }
}

export function saveLicenceMirror(mirror: { token: string | null; highWater: number }): void {
  const current = loadLicenceMirror();
  if (current.token === mirror.token && current.highWater === mirror.highWater) return;
  writeSettings({ licence: { token: mirror.token, highWater: mirror.highWater } });
}

/** The profile as last loaded or saved, so main can persist a licence change without the renderer. */
let lastProfile: Record<string, unknown> | null = null;

/** Re-save the last profile through `transform` (main's licence stamp). Same refusals as `save`. */
export function resaveLast(transform: (obj: Record<string, unknown>) => Record<string, unknown>): SaveOutcome {
  if (lastProfile === null) return { saved: false, readOnly };
  return save(transform(lastProfile));
}

/**
 * Merge one or more settings keys into the settings file, preserving the others. Both switches share
 * the file, so writing one must not clobber the other — a naive `atomicWrite({tutorEnabled})` erased a
 * saved multiplayer choice and vice versa.
 */
function writeSettings(patch: Record<string, unknown>): void {
  let current: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    if (typeof parsed === 'object' && parsed !== null) current = parsed as Record<string, unknown>;
  } catch {
    current = {};
  }
  atomicWrite(SETTINGS_FILE, JSON.stringify({ ...current, ...patch }, null, 2));
}
