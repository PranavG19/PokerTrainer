import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  atomicWrite,
  countBackups,
  deleteProfile as deleteProfileFiles,
  loadWithRecovery,
  saveWithBackup,
  type DeleteOutcome,
  type RecoverySource,
} from '../core/backup.js';

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

export function load(): Record<string, unknown> {
  const recovery = loadWithRecovery(STATE_FILE);
  lastRecovery = recovery.source;
  return recovery.state ?? structuredClone(DEFAULT_STATE);
}

export function save(obj: Record<string, unknown>): void {
  saveWithBackup(STATE_FILE, JSON.stringify(obj, null, 2));
}

export interface ProfileStatus {
  readonly path: string;
  readonly backupCount: number;
  readonly lastRecovery: RecoverySource;
}

export function profileStatus(): ProfileStatus {
  return { path: STATE_FILE, backupCount: countBackups(STATE_FILE), lastRecovery };
}

export function deleteProfile(confirmation: string): DeleteOutcome {
  const outcome = deleteProfileFiles(STATE_FILE, confirmation);
  // A deleted profile is a fresh one; leaving the old label would misreport it.
  if (outcome.deleted) lastRecovery = 'fresh';
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
