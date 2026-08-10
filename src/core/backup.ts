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
}

/**
 * Newest first: the live file, then each backup. `source` is returned rather
 * than swallowed so settings can warn that a recovery happened — the failure
 * mode to avoid is a silent reset that looks like lost progress.
 */
export function loadWithRecovery(file: string): Recovery {
  const live = readProfile(file);
  if (live !== null) return { state: live, source: 'live' };

  for (let slot = 1; slot <= BACKUP_DEPTH; slot++) {
    const restored = readProfile(backupPath(file, slot));
    if (restored !== null) return { state: restored, source: `backup-${slot}` as RecoverySource };
  }

  return { state: null, source: 'fresh' };
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
  fs.writeFileSync(tmp, text, 'utf-8');
  fs.renameSync(tmp, file);
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

  const targets = [file];
  for (let slot = 1; slot <= BACKUP_DEPTH; slot++) targets.push(backupPath(file, slot));

  return { deleted: true, removed: targets.filter(unlinkIfPresent) };
}
