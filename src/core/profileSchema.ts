/**
 * The profile's schema version, its forward-only migration chain, and the unknown-key carry.
 *
 * Pure: no fs, no clock. The main process runs `migrate` on every load (store.ts), before the renderer
 * sees the profile; the renderer's `deserialize`/`serialize` (session.ts) carry unknown keys through.
 *
 * - **v1** is every profile written before `schemaVersion` existed. An absent key means v1.
 * - **v2** adds `schemaVersion` and the `progression` namespace (progression/types.ts).
 *
 * Two rules keep a profile from losing data across builds:
 * 1. A build that opens a profile with a NEWER `schemaVersion` than it knows opens it read-only and
 *    never writes it (store.ts). A newer build may have changed what a field means, so writing it back
 *    is unsafe even with every key preserved.
 * 2. Within one version, keys this build does not know survive a load and save (`unknownKeysOf` /
 *    `withUnknownKeys`), so an additive field from a newer build of the same version is kept.
 *
 * Recipe for later tasks: AGENTS.md, "Profile schema".
 */

import { defaultProgression, PROGRESSION_SHAPE, serializeProgression } from './progression/persist.js';

export const SCHEMA_VERSION = 2;

/**
 * The version a raw profile declares. Absent, or anything that is not a positive integer, reads as v1:
 * every migration is tolerant of what it finds, so re-running from v1 cannot lose data. A number above
 * SCHEMA_VERSION (integer or not) is a newer build's profile.
 */
export function schemaVersionOf(raw: Record<string, unknown>): number {
  const v = raw.schemaVersion;
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1;
  if (v > SCHEMA_VERSION) return v;
  return Number.isInteger(v) && v >= 1 ? v : 1;
}

/**
 * One step. Must be additive and idempotent: running it on a profile that already has its fields keeps
 * them, and it never deletes or rewrites a key an older version owns.
 */
interface Migration {
  readonly from: number;
  readonly to: number;
  readonly run: (raw: Record<string, unknown>) => Record<string, unknown>;
}

const MIGRATIONS: readonly Migration[] = [
  {
    from: 1,
    to: 2,
    // A v1 profile gains an empty progression. If one is already there (a v2 profile whose version key
    // was lost), it is kept: the parser validates it, and nothing is reset.
    run: (raw) => ({
      ...raw,
      progression: isPlainObject(raw.progression) ? raw.progression : serializeProgression(defaultProgression()),
      schemaVersion: 2,
    }),
  },
];

export interface MigrationResult {
  /** The migrated profile, or the input untouched when it is current or newer. */
  readonly state: Record<string, unknown>;
  readonly from: number;
  /** The version `state` is now at. Equals `from` when nothing ran. */
  readonly to: number;
  /** The profile was written by a newer build: open read-only, never save. */
  readonly tooNew: boolean;
}

export function migrate(raw: Record<string, unknown>): MigrationResult {
  const from = schemaVersionOf(raw);
  if (from > SCHEMA_VERSION) return { state: raw, from, to: from, tooNew: true };
  let state = raw;
  let at = from;
  for (const step of MIGRATIONS) {
    if (step.from === at) {
      state = step.run(state);
      at = step.to;
    }
  }
  if (at !== SCHEMA_VERSION) throw new Error(`no migration path from v${from} to v${SCHEMA_VERSION}`);
  if (state.schemaVersion !== at) state = { ...state, schemaVersion: at };
  return { state, from, to: at, tooNew: false };
}

// ---- unknown-key carry ----

/** `true` = owned whole by a parser; an object = a fixed-shape object whose unlisted keys are carried. */
export type KeyShape = { readonly [key: string]: true | KeyShape };

/**
 * Every top-level key session.ts reads. v1 objects are leaves: new fields go in a new top-level key or
 * in `progression`, never inside an existing v1 object (AGENTS.md "Profile schema").
 */
export const PROFILE_SHAPE: KeyShape = {
  schemaVersion: true,
  bankroll: true,
  hands: true,
  rebuys: true,
  depthFloor: true,
  stats: true,
  calibration: true,
  coachedMode: true,
  spokenVerdicts: true,
  soundCues: true,
  recommender: true,
  gifts: true,
  chartMastery: true,
  puzzleProgress: true,
  lexicon: true,
  fadingLog: true,
  interleavingSpots: true,
  anomalyTally: true,
  assessments: true,
  savedRanges: true,
  progression: PROGRESSION_SHAPE,
};

/** A sparse tree holding only the keys `shape` does not list, at every fixed-shape level. Opaque JSON. */
export type UnknownKeys = Readonly<Record<string, unknown>>;

export function unknownKeysOf(raw: unknown, shape: KeyShape = PROFILE_SHAPE): UnknownKeys {
  if (!isPlainObject(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const known = Object.hasOwn(shape, key) ? shape[key] : undefined;
    if (known === undefined) {
      define(out, key, structuredClone(value));
    } else if (known !== true) {
      const nested = unknownKeysOf(value, known);
      if (Object.keys(nested).length > 0) define(out, key, nested);
    }
  }
  return out;
}

/**
 * Put the carried keys back into a freshly serialised profile. A key the serialiser wrote always wins:
 * the carry only fills keys this build does not know, so it can never resurrect a value it replaced.
 */
export function withUnknownKeys(
  serialized: Record<string, unknown>,
  unknown: UnknownKeys,
  shape: KeyShape = PROFILE_SHAPE,
): Record<string, unknown> {
  for (const [key, value] of Object.entries(unknown)) {
    const known = Object.hasOwn(shape, key) ? shape[key] : undefined;
    if (known === undefined) {
      if (!Object.hasOwn(serialized, key)) define(serialized, key, structuredClone(value));
    } else if (known !== true && isPlainObject(serialized[key]) && isPlainObject(value)) {
      withUnknownKeys(serialized[key] as Record<string, unknown>, value, known);
    }
  }
  return serialized;
}

/** An own data property even for "__proto__", which plain assignment would turn into a prototype swap. */
function define(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
