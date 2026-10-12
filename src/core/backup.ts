/**
 * Profile durability and the one hard delete.
 *
 * The Security section's Reversibility rule: profile writes are atomic
 * (write-temp-then-rename) and a rolling backup of the last 3 profile versions
 * is kept, because a crash mid-write corrupting the decision log is the failure
 * this prevents — and the log is the only irreplaceable artifact.
 *
 * Node-only (fs): imported by the main process, never by the renderer, which
 * has no filesystem access at all.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** "the last 3 profile versions". */
export const BACKUP_DEPTH = 3;

/**
 * The phrase the human must type to authorise the delete. Lives here so main
 * validates and the settings screen prompts against one string; the screen
 * receives it over IPC rather than importing this module.
 */
export const DELETE_CONFIRM_PHRASE = 'DELETE PROFILE';

export type RecoverySource = 'live' | 'backup-1' | 'backup-2' | 'backup-3' | 'fresh';

/** Slot 1 is the newest backup. */
export function backupPath(file: string, slot: number): string {
  return `${file}.bak${slot}`;
}

/**
 * A profile is usable only if it parses to a plain object. An array or a scalar
 * is corruption, not a profile — which is what makes falling through to a backup
 * the right move rather than silently accepting garbage.
 */
function parseProfile(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readProfile(file: string): Record<string, unknown> | null {
  try {
    return parseProfile(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

export interface Recovery {
  /** null when neither the live file nor any backup could be read. */
  readonly state: Record<string, unknown> | null;
  readonly source: RecoverySource;
  /** The file `state` was read from, so a pre-migration snapshot copies exactly that; null when fresh. */
  readonly path: string | null;
}

/**
 * Newest first: the live file, then each backup. `source` is returned rather
 * than swallowed so settings can warn that a recovery happened — the failure
 * mode to avoid is a silent reset that looks like lost progress.
 */
export function loadWithRecovery(file: string): Recovery {
  const live = readProfile(file);
  if (live !== null) return { state: live, source: 'live', path: file };

  for (let slot = 1; slot <= BACKUP_DEPTH; slot++) {
    const restored = readProfile(backupPath(file, slot));
    if (restored !== null) {
      return { state: restored, source: `backup-${slot}` as RecoverySource, path: backupPath(file, slot) };
    }
  }

  return { state: null, source: 'fresh', path: null };
}

function renameIfPresent(from: string, to: string): void {
  try {
    fs.renameSync(from, to);
  } catch {
    // Nothing there yet — the first few saves have fewer than BACKUP_DEPTH versions.
  }
}

function copyIfPresent(from: string, to: string): void {
  try {
    fs.copyFileSync(from, to);
  } catch {
    // First save: there is no previous version to keep.
  }
}

/**
 * Rotate the backups, then swap the live file.
 *
 * The order is the whole guarantee. The only operation that touches `file` is a
 * rename of an already-complete temp file, so `file` is never absent and never
 * half-written: a reader either sees the previous complete version or the new
 * one. A crash during rotation costs a backup copy, which is reconstructible by
 * definition; a crash during the write costs a temp file nothing reads.
 */
export function saveWithBackup(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  // Oldest first, or each rename would overwrite the slot it is about to read.
  for (let slot = BACKUP_DEPTH - 1; slot >= 1; slot--) {
    renameIfPresent(backupPath(file, slot), backupPath(file, slot + 1));
  }
  copyIfPresent(file, backupPath(file, 1));

  atomicWrite(file, text);
}

/**
 * Write-temp-then-rename. Exported because the settings file needs the same
 * torn-write immunity as the profile without needing the version history.
 */
export function atomicWrite(file: string, text: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmp, text, 'utf-8');
    fs.renameSync(tmp, file);
  } catch (error) {
    // A full disk fails part-way through the temp file. The live file is untouched; the half-written
    // temp would only hold on to the space the next save needs.
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Never created.
    }
    throw error;
  }
}

/**
 * Temp files a crash left behind (a write interrupted before its rename). Nothing reads them; removing
 * them at load gives the space back. Only this file's own temps, by the atomicWrite naming pattern.
 */
export function sweepTempFiles(file: string): number {
  const base = path.basename(file);
  const pattern = new RegExp(`^${escapeRegExp(base)}\\.[0-9a-f-]{36}\\.tmp$`);
  let removed = 0;
  let names: string[] = [];
  try {
    names = fs.readdirSync(path.dirname(file));
  } catch {
    return 0;
  }
  for (const name of names) {
    if (pattern.test(name) && unlinkIfPresent(path.join(path.dirname(file), name))) removed++;
  }
  return removed;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The named copy kept before a schema migration: `offsuit-state.json.pre-v2`. Unlike the rolling
 * backups it is never rotated out (three ordinary saves would push the pre-migration file out of
 * `.bak3` within one sitting) and never overwritten, so it is always the file as it was before this
 * build first touched it. Only deleteProfile removes it.
 */
export function preMigrationPath(file: string, toVersion: number): string {
  return `${file}.pre-v${toVersion}`;
}

/**
 * Copy `source` (the file the profile was actually read from: the live file or the backup recovery
 * used) to the pre-migration path, atomically. Returns false when a snapshot already exists, which is
 * the re-migration case (a downgrade and re-upgrade): the first snapshot is the one worth keeping.
 * Throws on a failed write, so the caller can refuse to save over a profile it could not snapshot.
 */
export function snapshotBeforeMigrate(file: string, source: string, toVersion: number): boolean {
  const target = preMigrationPath(file, toVersion);
  if (fs.existsSync(target)) return false;
  atomicWrite(target, fs.readFileSync(source, 'utf-8'));
  return true;
}

function preMigrationSnapshots(file: string): string[] {
  const base = path.basename(file);
  const pattern = new RegExp(`^${escapeRegExp(base)}\\.pre-v\\d+$`);
  try {
    return fs
      .readdirSync(path.dirname(file))
      .filter((name) => pattern.test(name))
      .map((name) => path.join(path.dirname(file), name));
  } catch {
    return [];
  }
}

/** How many rolling backups exist right now. Shown in settings. */
export function countBackups(file: string): number {
  let present = 0;
  for (let slot = 1; slot <= BACKUP_DEPTH; slot++) {
    if (fs.existsSync(backupPath(file, slot))) present++;
  }
  return present;
}

export interface DeleteOutcome {
  readonly deleted: boolean;
  /** Present only on refusal, so a caller cannot mistake a no-op for success. */
  readonly refusedBecause?: 'not-confirmed';
  readonly removed: readonly string[];
}

function unlinkIfPresent(file: string): boolean {
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * The only hard delete in the app. Refuses without the exact confirmation
 * phrase — the gate lives here and in main, never in the renderer, so a UI bug
 * cannot destroy the decision log.
 *
 * The backups go too: leaving them would make this not a delete.
 */
export function deleteProfile(file: string, confirmation: string): DeleteOutcome {
  if (confirmation !== DELETE_CONFIRM_PHRASE) {
    return { deleted: false, refusedBecause: 'not-confirmed', removed: [] };
  }

  // The pre-migration snapshots are copies of the profile too: leaving them would make this not a delete.
  const targets = [file];
  for (let slot = 1; slot <= BACKUP_DEPTH; slot++) targets.push(backupPath(file, slot));
  targets.push(...preMigrationSnapshots(file));

  return { deleted: true, removed: targets.filter(unlinkIfPresent) };
}
