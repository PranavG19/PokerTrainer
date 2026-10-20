/**
 * Profile export and import: the file format and the strict check an imported file must pass.
 *
 * Pure: no fs, no dialog. The main process owns the file dialog, the read and the write (main/profileFile.ts);
 * this module decides what an export contains and whether a file may replace the profile.
 *
 * AN IMPORTED FILE IS UNTRUSTED. It may be hand-edited, truncated, from a newer build, or not ours at all.
 * The profile's own parser (session.ts `deserialize`) is tolerant on purpose, because the profile on disk
 * must never brick the app; an import has no such excuse. So an import is checked twice:
 * 1. strictly, here: the envelope, a size cap, the schema version, and the JSON type of every top-level
 *    key the parser reads, plus the shape of every hand. Anything off is refused with a reason, never
 *    repaired into a profile the learner did not have.
 * 2. then through the profile parser itself, migrate → deserialize → serialize, so what is written is
 *    exactly what this build would have written. Keys this build does not know are left out (they could
 *    not be checked), and the licence fields are emptied: main stamps its own.
 *
 * The Pro hand-history store (main/hhStore.ts) is not in the profile and never in an export or an import.
 */

import { migrate, PROFILE_SHAPE, SCHEMA_VERSION, schemaVersionOf } from './profileSchema.js';
import { deserialize, MAX_HAND_LOG, serialize, type SessionState } from './session.js';
import { defaultProgression } from './progression/persist.js';

export const EXPORT_FORMAT = 'offsuit-profile';
export const EXPORT_FORMAT_VERSION = 1;
/** Far above any real profile (the hand log is capped at 500); a larger file is refused unread. */
export const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

export interface ExportEnvelope {
  readonly format: typeof EXPORT_FORMAT;
  readonly formatVersion: number;
  /** ISO 8601, when the file was written. */
  readonly exportedAt: string;
  readonly profile: Record<string, unknown>;
}

export type ImportRefusal =
  | 'too-large'
  | 'not-json'
  | 'not-a-profile'
  | 'newer-format'
  | 'newer-version'
  | 'bad-field';

export interface ImportPreview {
  readonly hands: number;
  readonly handsPlayed: number;
  readonly bankroll: number;
  /** The newest hand's time (epoch ms), or null when none carries one. */
  readonly lastPlayedAt: number | null;
  /** From the envelope, or null for a bare profile file. */
  readonly exportedAt: string | null;
  /** The schema version the file declared (1 = before versions existed). */
  readonly fromVersion: number;
  /** Top-level keys this build does not know, left out of the import. */
  readonly droppedKeys: readonly string[];
}

export type ImportCheck =
  | { readonly ok: true; readonly profile: Record<string, unknown>; readonly preview: ImportPreview }
  | { readonly ok: false; readonly reason: ImportRefusal; readonly detail?: string };

/** The licence never travels in a file: main keeps its own and stamps it on every save (main/licence.ts). */
function withoutLicence(profile: Record<string, unknown>): Record<string, unknown> {
  const progression = profile.progression;
  if (!isPlainObject(progression)) return profile;
  return { ...profile, progression: { ...progression, entitlements: { ...defaultProgression().entitlements } } };
}

/** The file an export writes: the profile as main last saved it, without the licence. */
export function exportEnvelope(profile: Record<string, unknown>, now: Date): ExportEnvelope {
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    profile: withoutLicence(structuredClone(profile)),
  };
}

export function exportText(profile: Record<string, unknown>, now: Date): string {
  return JSON.stringify(exportEnvelope(profile, now), null, 2);
}

/**
 * The JSON type each top-level key must have when present. Every key in PROFILE_SHAPE is listed, and
 * tests/unit/profileTransfer.test.ts fails if a new one is added there and not here.
 */
export const FIELD_TYPES: Readonly<Record<string, 'number' | 'boolean' | 'array' | 'object'>> = {
  schemaVersion: 'number',
  bankroll: 'number',
  hands: 'array',
  rebuys: 'number',
  depthFloor: 'number',
  stats: 'object',
  calibration: 'object',
  coachedMode: 'boolean',
  spokenVerdicts: 'boolean',
  soundCues: 'boolean',
  recommender: 'object',
  gifts: 'array',
  chartMastery: 'object',
  puzzleProgress: 'object',
  lexicon: 'array',
  fadingLog: 'array',
  interleavingSpots: 'object',
  anomalyTally: 'object',
  assessments: 'array',
  savedRanges: 'array',
  progression: 'object',
};

const CARD = /^[2-9TJQKA][shdc]$/;

function typeOf(v: unknown): string {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  return typeof v;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Why one hand entry is not a hand, or null when it is. The cards must be real and distinct; every other
 * field must have its type when present. Absence is allowed: an older profile's hands predate some fields
 * (hand numbers, decisions, times), and the parser reads a missing field honestly.
 */
function handProblem(raw: unknown): string | null {
  if (!isPlainObject(raw)) return 'is not an object';
  const hole = raw.hole;
  if (!Array.isArray(hole) || hole.length !== 2 || !hole.every((c) => typeof c === 'string' && CARD.test(c))) return 'has bad hole cards';
  const board = raw.board;
  if (!Array.isArray(board) || board.length > 5 || !board.every((c) => typeof c === 'string' && CARD.test(c))) return 'has a bad board';
  const cards = [...hole, ...board];
  if (new Set(cards).size !== cards.length) return 'repeats a card';
  for (const key of ['handNumber', 'net', 'playedAt'] as const) {
    if (raw[key] !== undefined && !finite(raw[key])) return `has a bad ${key}`;
  }
  for (const key of ['grades', 'decisions'] as const) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) return `has bad ${key}`;
  }
  for (const key of ['vpip', 'pfr'] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'boolean') return `has a bad ${key}`;
  }
  return null;
}

const refuse = (reason: ImportRefusal, detail?: string): ImportCheck => ({ ok: false, reason, ...(detail ? { detail } : {}) });

/**
 * Check a file's text. `ok` carries the profile to write (already migrated and normalised by the profile
 * parser) and what the confirm shows. Never throws.
 */
export function checkImport(text: string, byteLength = text.length): ImportCheck {
  if (byteLength > MAX_IMPORT_BYTES) return refuse('too-large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refuse('not-json');
  }
  if (!isPlainObject(parsed)) return refuse('not-a-profile');

  // An export's envelope, or a bare profile (offsuit-state.json copied from another machine).
  let raw: Record<string, unknown>;
  let exportedAt: string | null = null;
  if (Object.hasOwn(parsed, 'format')) {
    if (parsed.format !== EXPORT_FORMAT) return refuse('not-a-profile');
    const fv = parsed.formatVersion;
    if (!finite(fv) || !Number.isInteger(fv) || fv < 1) return refuse('not-a-profile');
    if (fv > EXPORT_FORMAT_VERSION) return refuse('newer-format');
    if (!isPlainObject(parsed.profile)) return refuse('not-a-profile');
    raw = parsed.profile;
    if (typeof parsed.exportedAt === 'string' && parsed.exportedAt.length <= 40 && Number.isFinite(Date.parse(parsed.exportedAt))) {
      exportedAt = parsed.exportedAt;
    }
  } else {
    raw = parsed;
  }

  // A profile has a hand log and a bankroll; a JSON file without them is something else.
  if (!Array.isArray(raw.hands) || !finite(raw.bankroll)) return refuse('not-a-profile');

  if (Object.hasOwn(raw, 'schemaVersion')) {
    const v = raw.schemaVersion;
    if (!finite(v) || !Number.isInteger(v) || v < 1) return refuse('bad-field', 'schemaVersion');
    if (v > SCHEMA_VERSION) return refuse('newer-version');
  }
  for (const [key, want] of Object.entries(FIELD_TYPES)) {
    if (!Object.hasOwn(raw, key)) continue;
    if (typeOf(raw[key]) !== want) return refuse('bad-field', key);
    if (want === 'number' && !finite(raw[key])) return refuse('bad-field', key);
  }
  const hands = raw.hands as unknown[];
  if (hands.length > MAX_HAND_LOG) return refuse('bad-field', 'hands');
  for (let i = 0; i < hands.length; i++) {
    const problem = handProblem(hands[i]);
    if (problem !== null) return refuse('bad-field', `hand ${i + 1} ${problem}`);
  }
  const progression = raw.progression;
  if (progression !== undefined && !isPlainObject(progression)) return refuse('bad-field', 'progression');

  const droppedKeys = Object.keys(raw).filter((k) => !Object.hasOwn(PROFILE_SHAPE, k));
  const fromVersion = schemaVersionOf(raw);
  const known: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) if (Object.hasOwn(PROFILE_SHAPE, key)) known[key] = raw[key];

  let session: SessionState;
  try {
    session = deserialize(migrate(structuredClone(known)).state);
  } catch {
    return refuse('bad-field');
  }
  // Strict, so nothing unchecked rides in: unknown keys at every level are left out.
  const profile = withoutLicence(serialize({ ...session, unknownKeys: {} }));

  const playedAts = session.hands.map((h) => h.playedAt).filter((t): t is number => t !== undefined);
  return {
    ok: true,
    profile,
    preview: {
      hands: session.hands.length,
      handsPlayed: session.stats.handsPlayed,
      bankroll: session.bankroll,
      lastPlayedAt: playedAts.length > 0 ? Math.max(...playedAts) : null,
      exportedAt,
      fromVersion,
      droppedKeys,
    },
  };
}

export const IMPORT_REFUSAL_TEXT: Record<ImportRefusal, string> = {
  'too-large': 'That file is far larger than any profile. Nothing was changed.',
  'not-json': 'That file is not a profile: it could not be read as one. Nothing was changed.',
  'not-a-profile': 'That file is not an Offsuit profile. Nothing was changed.',
  'newer-format': 'That export is from a newer Offsuit. Update this one to import it. Nothing was changed.',
  'newer-version': 'That profile is from a newer Offsuit. Update this one to import it. Nothing was changed.',
  'bad-field': 'Part of that profile is damaged, so it was not imported. Nothing was changed.',
};
