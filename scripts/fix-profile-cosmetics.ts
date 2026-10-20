/**
 * ONE-TIME FIX-UP: bring a local profile's `progression.cosmetics` up to this build, in place (no schemaVersion bump:
 * there are no customers yet, so schema changes are edited in place and existing local profiles are repaired by a
 * script like this one; AGENTS.md "Profile schema").
 *
 * What it repairs, and only in `progression.cosmetics` (every other byte of the file is left as it was):
 *  - parses the section with this build's parser: duplicate owned ids, equips of items not owned, malformed receipts
 *    and an out-of-range Chalk ledger are normalised exactly as the app would on its next save;
 *  - keeps an equip in a slot only a newer build knows (the parser now carries it);
 *  - files the receipts for items already earned by milestones, Seals or rivals unmasked on file, dated the day the
 *    fact first held (what the app files on its next save anyway, made visible now).
 * It never grants a priced item, never touches Chalk's balance beyond the parser's clamp, and never reads chips.
 *
 * Usage (Node 26 runs the .ts; src/ imports resolve through the hook):
 *   node --import ./scripts/ts-js-resolve.mjs scripts/fix-profile-cosmetics.ts                 # dry run, real profile
 *   node --import ./scripts/ts-js-resolve.mjs scripts/fix-profile-cosmetics.ts --file <path>   # dry run, that file
 *   node --import ./scripts/ts-js-resolve.mjs scripts/fix-profile-cosmetics.ts --write [--file <path>]
 * A dry run (the default) prints what would change and writes nothing. --write first copies the file to
 * `<file>.pre-fix-cosmetics-<stamp>`, checks the copy byte for byte, and only then replaces the file atomically
 * (temp file, then rename). Quit Offsuit first: a profile changed under a running app opens read-only.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SCHEMA_VERSION, schemaVersionOf, unknownKeysOf, withUnknownKeys, type KeyShape } from '../src/core/profileSchema.js';
import { parseProgression, PROGRESSION_SHAPE, serializeProgression } from '../src/core/progression/persist.js';
import { syncCosmetics } from '../src/core/cosmetics/locker.js';
import { systemDayKeyOf, type DayKey } from '../src/core/localDay.js';

export interface FixResult {
  /** The whole profile, repaired; the same object when nothing changed. */
  readonly fixed: Record<string, unknown>;
  /** What changed, in words; empty when nothing would. */
  readonly changes: readonly string[];
  /** Set when the file is left alone on purpose (a newer build's profile, or no cosmetics to repair). */
  readonly skipped: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const stable = (v: unknown): string => JSON.stringify(v);

export function fixProfile(raw: Record<string, unknown>, today: DayKey): FixResult {
  const version = schemaVersionOf(raw);
  if (version > SCHEMA_VERSION) return { fixed: raw, changes: [], skipped: `schemaVersion ${version} is newer than this build's ${SCHEMA_VERSION}` };
  if (!isObject(raw.progression)) return { fixed: raw, changes: [], skipped: 'no progression section (the app migrates it on load)' };

  const before = isObject(raw.progression.cosmetics) ? raw.progression.cosmetics : {};
  const p = parseProgression(raw.progression);
  const synced = syncCosmetics(p.cosmetics, { milestones: p.milestones, seals: p.seals, story: p.story }, today);
  const shape = PROGRESSION_SHAPE.cosmetics as KeyShape;
  const after = withUnknownKeys(serializeProgression({ ...p, cosmetics: synced }).cosmetics as Record<string, unknown>, unknownKeysOf(before, shape), shape);
  if (stable(after) === stable(before)) return { fixed: raw, changes: [], skipped: null };

  const changes: string[] = [];
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const owned0 = list(before.owned);
  const owned1 = list(after.owned);
  const added = owned1.filter((id) => !owned0.includes(id));
  const dropped = [...new Set(owned0)].filter((id) => !owned1.includes(id));
  if (added.length > 0) changes.push(`files ${added.length} earned item(s): ${added.join(', ')}`);
  if (dropped.length > 0) changes.push(`drops unreadable owned id(s): ${dropped.join(', ')}`);
  if (owned0.length !== new Set(owned0).size) changes.push('removes duplicate owned ids');
  const eq0 = isObject(before.equipped) ? before.equipped : {};
  const eq1 = isObject(after.equipped) ? after.equipped : {};
  for (const slot of Object.keys(eq0)) if (!(slot in eq1)) changes.push(`drops the equip ${slot} = ${String(eq0[slot])} (not owned)`);
  const r0 = Array.isArray(before.receipts) ? before.receipts.length : 0;
  const r1 = Array.isArray(after.receipts) ? after.receipts.length : 0;
  if (r1 !== r0) changes.push(`receipts ${r0} → ${r1}`);
  if (stable(before.chalk) !== stable(after.chalk)) changes.push(`Chalk ledger ${stable(before.chalk ?? null)} → ${stable(after.chalk)}`);
  if (changes.length === 0) changes.push('normalises the cosmetics section to this build’s shape');

  const progression = { ...raw.progression };
  Object.defineProperty(progression, 'cosmetics', { value: after, enumerable: true, writable: true, configurable: true });
  return { fixed: { ...raw, progression }, changes, skipped: null };
}

function realProfilePath(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'offsuit-desktop', 'offsuit-state.json');
}

function main(argv: readonly string[]): number {
  const write = argv.includes('--write');
  const at = argv.indexOf('--file');
  const file = at >= 0 ? argv[at + 1] : realProfilePath();
  if (!file || !fs.existsSync(file)) {
    console.error(`no profile at ${file ?? '(missing --file value)'}`);
    return 2;
  }
  const text = fs.readFileSync(file, 'utf-8');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    console.error(`${file} is not JSON; left untouched (the app recovers from its .bakN copies)`);
    return 2;
  }
  if (!isObject(raw)) {
    console.error(`${file} is not a profile object; left untouched`);
    return 2;
  }
  const result = fixProfile(raw, systemDayKeyOf()(Date.now()));
  const mode = write ? 'write' : 'dry run';
  if (result.skipped !== null) {
    console.log(`[${mode}] ${file}: skipped, ${result.skipped}`);
    return 0;
  }
  if (result.changes.length === 0) {
    console.log(`[${mode}] ${file}: nothing to change`);
    return 0;
  }
  console.log(`[${mode}] ${file}:`);
  for (const c of result.changes) console.log(`  - ${c}`);
  if (!write) {
    console.log('  (dry run: nothing written; pass --write to apply, after a backup)');
    return 0;
  }
  // Back up first, and prove the backup before touching the file.
  const backup = `${file}.pre-fix-cosmetics-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  if (fs.readFileSync(backup, 'utf-8') !== text) {
    console.error(`backup ${backup} does not match the profile; nothing written`);
    return 1;
  }
  const temp = `${file}.fix-tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(result.fixed, null, 2), { flag: 'wx' });
  fs.renameSync(temp, file);
  console.log(`  backed up to ${backup}; profile written`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  process.exitCode = main(process.argv.slice(2));
}
