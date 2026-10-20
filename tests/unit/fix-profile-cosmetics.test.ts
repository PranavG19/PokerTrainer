import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { DayKey } from '../../src/core/localDay.js';
import { fixProfile, parseArgs } from '../../scripts/fix-profile-cosmetics.js';

const ROOT = path.resolve(__dirname, '../..');
const FIX = path.join(ROOT, 'tests/fixtures/profiles');
const load = (name: string) => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf-8')) as Record<string, unknown>;
const TODAY = 20745 as DayKey;

describe('the cosmetics fix-up script, over the fixture profiles', () => {
  it('repairs a profile needing it: earned items filed, dangling equips dropped, the newer slot kept, the ledger clamped', () => {
    const raw = load('v2-needs-cosmetics-fix.json');
    const { fixed, changes, skipped } = fixProfile(raw, TODAY);
    expect(skipped).toBeNull();
    const c = (fixed.progression as Record<string, any>).cosmetics;
    expect(c.owned).toEqual(['back-guilloche', 'avatar-from-newer', 'back-the-seal', 'felt-spruce']);
    expect(c.equipped).toEqual({ cardBack: 'back-guilloche', avatar: 'avatar-from-newer' });
    expect(c.receipts.map((r: { itemId: string; day: number }) => [r.itemId, r.day])).toEqual([
      ['back-guilloche', 20690],
      ['back-the-seal', 20700],
      ['felt-spruce', 20710],
    ]);
    expect(c.chalk).toEqual({ balance: 300, day: 20740, earnedToday: 225 });
    expect(c.futureCosmeticsKey).toEqual([1, 2]);
    expect(changes.join('\n')).toMatch(/files 2 earned item/);
    expect(changes.join('\n')).toMatch(/drops the equip felt/);
  });

  it('leaves every byte outside progression.cosmetics as it was', () => {
    const raw = load('v2-needs-cosmetics-fix.json');
    const { fixed } = fixProfile(structuredClone(raw), TODAY);
    const strip = (o: Record<string, any>) => ({ ...o, progression: { ...o.progression, cosmetics: null } });
    expect(JSON.stringify(strip(fixed))).toBe(JSON.stringify(strip(raw)));
  });

  it('is idempotent: running it on its own output changes nothing', () => {
    const once = fixProfile(load('v2-needs-cosmetics-fix.json'), TODAY).fixed;
    const twice = fixProfile(once, TODAY);
    expect(twice.changes).toEqual([]);
    expect(twice.fixed).toBe(once);
  });

  it('a clean profile needs nothing; a newer build’s and a v1 profile are skipped untouched', () => {
    const clean = load('v2-clean.json');
    expect(fixProfile(clean, TODAY)).toEqual({ fixed: clean, changes: [], skipped: null });
    const newer = load('v3-newer-build.json');
    expect(fixProfile(newer, TODAY).fixed).toBe(newer);
    expect(fixProfile(newer, TODAY).skipped).toMatch(/newer/);
    expect(fixProfile(load('v1-no-progression.json'), TODAY).skipped).toMatch(/no progression/);
  });

  it('refuses any argument it does not know, so a mistyped flag never falls through to the real profile', () => {
    expect(parseArgs(['--write', '--file=/tmp/x.json'])).toEqual({ write: true, file: '/tmp/x.json', error: null });
    expect(parseArgs(['--file', '/tmp/y.json'])).toEqual({ write: false, file: '/tmp/y.json', error: null });
    expect(parseArgs(['--write', '--fiel=/tmp/x.json']).error).toMatch(/unknown argument/);
    expect(parseArgs(['--file']).error).toMatch(/needs a path/);
    expect(parseArgs(['--file', '--write']).error).toMatch(/needs a path/);
    const out = (() => {
      try {
        execFileSync(process.execPath, ['--import', './scripts/ts-js-resolve.mjs', 'scripts/fix-profile-cosmetics.ts', '--write', '--fiel=/tmp/nope.json'], { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe' });
        return 'exit 0';
      } catch (e) {
        return String((e as { stderr?: string }).stderr);
      }
    })();
    expect(out).toContain('unknown argument --fiel=');
  });

  it('the CLI: a dry run writes nothing; --write backs up byte for byte first, then writes the fix', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-fix-'));
    const file = path.join(dir, 'offsuit-state.json');
    const original = fs.readFileSync(path.join(FIX, 'v2-needs-cosmetics-fix.json'), 'utf-8');
    fs.writeFileSync(file, original);
    const run = (...args: string[]) =>
      execFileSync(process.execPath, ['--import', './scripts/ts-js-resolve.mjs', 'scripts/fix-profile-cosmetics.ts', '--file', file, ...args], { cwd: ROOT, encoding: 'utf-8' });
    const dry = run();
    expect(dry).toContain('dry run');
    expect(fs.readFileSync(file, 'utf-8')).toBe(original);
    expect(fs.readdirSync(dir)).toEqual(['offsuit-state.json']);
    const wrote = run('--write');
    expect(wrote).toContain('backed up to');
    const backups = fs.readdirSync(dir).filter((f) => f.includes('.pre-fix-cosmetics-'));
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, backups[0]), 'utf-8')).toBe(original);
    const after = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(after.progression.cosmetics.owned).toContain('back-the-seal');
    expect(after.bankroll).toBe(8420);
    expect(run('--write')).toContain('nothing to change');
    expect(fs.readdirSync(dir).filter((f) => f.includes('.pre-fix-cosmetics-'))).toHaveLength(1);
  });
});
