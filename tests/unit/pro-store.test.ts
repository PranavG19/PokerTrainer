import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseHandHistories } from '../../src/core/pro/parse.js';
import { parseShoveRequest } from '../../src/core/pro/analysis.js';
import { createHandStore, expandPicked, MAX_FILE_BYTES, readPicked } from '../../src/main/hhStore.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'hh');
const fixtureHands = () => parseHandHistories(fs.readFileSync(path.join(FIXTURES, 'pokerstars-cash.txt'), 'utf8')).hands;

const dirs: string[] = [];
const tmp = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-hh-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('the hand store (NDJSON, outside the profile)', () => {
  it('adds, de-duplicates by site and id, survives a reload, and clears', () => {
    const dir = tmp();
    const hands = fixtureHands();
    const store = createHandStore(dir);
    expect(store.add(hands, { at: '2026-10-14T05:00:00.000Z', files: 1 })).toEqual({ added: hands.length, duplicates: 0, overCap: 0, tooLarge: 0, total: hands.length });
    expect(store.add(hands, { at: '2026-10-14T05:01:00.000Z', files: 1 })).toMatchObject({ added: 0, duplicates: hands.length });
    const lines = fs.readFileSync(path.join(dir, 'hands.ndjson'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(hands.length);
    expect(createHandStore(dir).all()).toEqual(hands);
    expect(createHandStore(dir).meta()).toEqual({ at: '2026-10-14T05:01:00.000Z', files: 1, sites: ['pokerstars'] });
    store.clear();
    expect(createHandStore(dir).count()).toBe(0);
    expect(fs.existsSync(path.join(dir, 'hands.ndjson'))).toBe(false);
  });

  it('a doctored store line is dropped, never trusted', () => {
    const dir = tmp();
    const [good] = fixtureHands();
    const bad = { ...good, id: '999', hero: 40 };
    const text = [JSON.stringify(good), '{not json', JSON.stringify(bad), JSON.stringify({ __proto__: { polluted: 1 } }), ''].join('\n');
    fs.writeFileSync(path.join(dir, 'hands.ndjson'), text);
    expect(createHandStore(dir).all()).toEqual([good]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('stores no opponent name and no money: only seats, stacks and decisions', () => {
    const dir = tmp();
    createHandStore(dir).add(fixtureHands(), { at: new Date().toISOString(), files: 1 });
    const text = fs.readFileSync(path.join(dir, 'hands.ndjson'), 'utf8');
    for (const name of ['RiverRat77', 'Mr.Pickles', 'Vilain_6', 'Zoë']) expect(text).not.toContain(name);
    expect(text).not.toMatch(/collected|rake|won|pot/i);
  });
});

describe('which files an import may read', () => {
  it('a folder gives its top-level .txt files only, skipping links, dotfiles, other files and subfolders', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'B.TXT'), 'x');
    fs.writeFileSync(path.join(dir, '.hidden.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'notes.md'), 'x');
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'deep.txt'), 'x');
    fs.symlinkSync('/etc/hosts', path.join(dir, 'link.txt'));
    const picked = expandPicked([dir]);
    expect(picked.files.map((f) => path.basename(f.path))).toEqual(['B.TXT', 'a.txt']);
    expect(picked.skipped).toEqual({ link: 1 });
  });

  it('refuses relative paths, links picked directly, missing files and oversized files', () => {
    const dir = tmp();
    const big = path.join(dir, 'big.txt');
    fs.writeFileSync(big, '');
    fs.truncateSync(big, MAX_FILE_BYTES + 1);
    fs.symlinkSync('/etc/hosts', path.join(dir, 'l.txt'));
    const picked = expandPicked(['relative.txt', path.join(dir, 'l.txt'), path.join(dir, 'missing.txt'), big]);
    expect(picked.files).toEqual([]);
    expect(picked.skipped).toEqual({ 'not-a-file': 1, link: 1, unreadable: 1, 'too-large': 1 });
  });

  it('reads UTF-8 (BOM dropped) and UTF-16 exports; a NUL byte means not text', async () => {
    const dir = tmp();
    const utf8 = path.join(dir, 'u8.txt');
    fs.writeFileSync(utf8, '﻿PokerStars Hand #1');
    const utf16 = path.join(dir, 'u16.txt');
    fs.writeFileSync(utf16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('PokerStars Hand #2', 'utf16le')]));
    const bin = path.join(dir, 'bin.txt');
    fs.writeFileSync(bin, Buffer.from([0x50, 0x00, 0x51]));
    expect(await readPicked({ path: utf8, size: 0 })).toMatchObject({ text: 'PokerStars Hand #1' });
    expect(await readPicked({ path: utf16, size: 0 })).toMatchObject({ text: 'PokerStars Hand #2' });
    expect(await readPicked({ path: bin, size: 0 })).toEqual({ skip: 'not-text' });
    // m4: the budget is checked on the size really opened, not the size the dialog saw.
    expect(await readPicked({ path: utf8, size: 0 }, 5)).toEqual({ skip: 'import-too-large' });
  });

  it('a file swapped for a link after the dialog is not followed', async () => {
    const dir = tmp();
    const p = path.join(dir, 'h.txt');
    fs.writeFileSync(p, 'x');
    const [picked] = expandPicked([p]).files;
    fs.rmSync(p);
    fs.symlinkSync('/etc/hosts', p);
    expect(await readPicked(picked)).toEqual({ skip: 'unreadable' });
  });
});

describe('IMPORTS EARN NOTHING: the Pro modules have no path to the profile or any reward', () => {
  // Read the import graph of every Pro module: none of them may reach the profile store, the session
  // reducer, progression (Reps, Seals, streak), story or rivals. So an import cannot award anything.
  const FORBIDDEN = /(?:^|\/)(?:store|session|progression\/|story\/|giftLedger|standing|career|dee\/)/;
  const files = ['src/main/hhStore.ts', 'src/main/proTools.ts', 'src/main/proWorker.ts', ...fs.readdirSync(path.join(ROOT, 'src/core/pro')).map((f) => `src/core/pro/${f}`)];

  function importsOf(rel: string, seen = new Set<string>()): Set<string> {
    if (seen.has(rel)) return seen;
    seen.add(rel);
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of src.matchAll(/from '(\.[^']+)'/g)) {
      const next = path.normalize(path.join(path.dirname(rel), m[1].replace(/\.js$/, '.ts')));
      if (fs.existsSync(path.join(ROOT, next))) importsOf(next, seen);
    }
    return seen;
  }

  it('reaches none of store, session, progression, story, gifts, standing, career or Dee', () => {
    for (const f of files.filter((x) => x.endsWith('.ts'))) {
      const reached = [...importsOf(f)].filter((r) => r !== f && FORBIDDEN.test(r.replace(/^src\/(main|core)\//, '')));
      expect(reached, f).toEqual([]);
    }
  });
});

describe('a push-fold request from the renderer is validated whole', () => {
  const ok = { stacks: [27, 13, 6, 14], button: 1, hero: 1, ante: 0.125, payouts: [0.5, 0.3, 0.2], callers: { kind: 'equilibrium' } };
  it('accepts a real spot', () => {
    expect(parseShoveRequest(ok)).not.toBeNull();
    expect(parseShoveRequest({ ...ok, callers: { kind: 'top', share: 0.2 } })).not.toBeNull();
  });
  it('refuses anything out of range rather than clamping it', () => {
    for (const bad of [
      null,
      'x',
      { ...ok, stacks: [27] },
      { ...ok, stacks: new Array(11).fill(10) },
      { ...ok, stacks: [27, 13, -6, 14] },
      { ...ok, stacks: [27, 13, Number.NaN, 14] },
      { ...ok, stacks: [27, 13, 1e9, 14] },
      { ...ok, hero: 3 }, // the big blind
      { ...ok, hero: 1.5 },
      { ...ok, button: 7 },
      { ...ok, ante: 5 },
      { ...ok, payouts: [0.5, 0.3] }, // does not sum to 1
      { ...ok, payouts: [0.2, 0.2, 0.2, 0.2, 0.2] }, // more places than players
      { ...ok, callers: { kind: 'top', share: 0 } },
      { ...ok, callers: { kind: 'qq-plus' } },
      { ...ok, callers: undefined },
    ]) {
      expect(parseShoveRequest(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('review round 1: the store never loses hands to its own caps', () => {
  it('M1: a store over the byte cap is refused for writing, never read as empty and overwritten', () => {
    const dir = tmp();
    const hands = fixtureHands();
    createHandStore(dir).add(hands, { at: '2026-10-14T05:00:00.000Z', files: 1 });
    const file = path.join(dir, 'hands.ndjson');
    const size = fs.statSync(file).size;
    // The same store opened with a cap below its size: it must refuse to write, and say so.
    const capped = createHandStore(dir, { maxStoreBytes: size - 1 });
    const out = capped.add([{ ...hands[0], id: '424242' }], { at: '2026-10-14T05:01:00.000Z', files: 1 });
    expect(out.refused).toBe('store-unreadable');
    expect(out.added).toBe(0);
    expect(fs.statSync(file).size).toBe(size);
    expect(capped.status()).toBe('too-large');
  });

  it('M1: adding stops at the byte budget (counted as over the cap), and an oversized hand is refused', () => {
    const dir = tmp();
    const hands = fixtureHands();
    const one = Buffer.byteLength(JSON.stringify(hands[0])) + 1;
    const store = createHandStore(dir, { maxStoreBytes: one * 2 + 10 });
    const out = store.add(hands, { at: '2026-10-14T05:00:00.000Z', files: 1 });
    expect(out.added).toBeLessThanOrEqual(2);
    expect(out.overCap).toBe(hands.length - out.added);
    expect(fs.statSync(path.join(dir, 'hands.ndjson')).size).toBeLessThanOrEqual(one * 2 + 10);
    const big = { ...hands[0], id: '777', actions: Array.from({ length: 400 }, () => hands[0].actions[0]) };
    expect(createHandStore(tmp()).add([big], { at: '2026-10-14T05:00:00.000Z', files: 1 })).toMatchObject({ added: 0, tooLarge: 1 });
  });

  it('m8: a doctored line keeps only the known fields; a meta.json that is not a small file is ignored', () => {
    const dir = tmp();
    const [good] = fixtureHands();
    fs.writeFileSync(path.join(dir, 'hands.ndjson'), JSON.stringify({ ...good, name: 'RealName', note: 'x'.repeat(1000) }) + '\n');
    const [read] = createHandStore(dir).all();
    expect(Object.keys(read).sort()).toEqual(Object.keys(good).sort());
    fs.mkdirSync(path.join(dir, 'meta.json'));
    expect(createHandStore(dir).meta()).toBeNull();
  });
});
