import { describe, expect, it } from 'vitest';
import {
  checkImport,
  EXPORT_FORMAT,
  exportEnvelope,
  exportText,
  FIELD_TYPES,
  IMPORT_REFUSAL_TEXT,
  MAX_IMPORT_BYTES,
} from '../../src/core/profileTransfer.js';
import { PROFILE_SHAPE, SCHEMA_VERSION } from '../../src/core/profileSchema.js';
import { deserialize, emptySession, recordHand, serialize, type HandRecord } from '../../src/core/session.js';
import { defaultProgression } from '../../src/core/progression/persist.js';

const NOW = new Date('2026-10-20T12:00:00Z');

function hand(n: number, over: Partial<HandRecord> = {}): HandRecord {
  return {
    handNumber: n,
    hole: ['As', 'Kd'],
    board: ['2c', '7h', 'Td'],
    net: n % 2 === 0 ? 150 : -50,
    vpip: true,
    pfr: n % 3 === 0,
    grades: [],
    decisions: [],
    playedAt: 1_760_000_000_000 + n * 60_000,
    ...over,
  };
}

/** A profile with some history, a licence and a key from a newer build, as main would hold it. */
function aProfile(): Record<string, unknown> {
  let s = emptySession();
  for (let i = 1; i <= 12; i++) s = recordHand(s, hand(i));
  const out = serialize({ ...s, bankroll: 12_345 as never, coachedMode: true });
  const progression = out.progression as Record<string, unknown>;
  progression.entitlements = { tier: 'pro', granted: ['leak-finder'], licence: 'v1.secret-token', highWater: 1_760_000_000 };
  out.futureThing = { from: 'a newer build' };
  return out;
}

const expectedAfterImport = (profile: Record<string, unknown>): Record<string, unknown> => ({
  ...profile,
  progression: { ...(profile.progression as object), entitlements: defaultProgression().entitlements },
});

describe('round trip', () => {
  it('export then import gives back the same profile, without the licence, unknown keys carried', () => {
    const profile = aProfile();
    const text = exportText(profile, NOW);
    const checked = checkImport(text);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.profile).toEqual(expectedAfterImport(profile));
    expect(checked.preview).toEqual({
      hands: 12,
      handsPlayed: 12,
      bankroll: 12_345,
      lastPlayedAt: 1_760_000_000_000 + 12 * 60_000,
      exportedAt: NOW.toISOString(),
      fromVersion: SCHEMA_VERSION,
      unknownKeys: ['futureThing'],
    });
    // A second trip changes nothing.
    const again = checkImport(exportText(checked.profile, NOW));
    expect(again.ok && again.profile).toEqual(checked.profile);
  });

  it('the export never carries the licence token', () => {
    const text = exportText(aProfile(), NOW);
    expect(text).not.toContain('secret-token');
    const env = exportEnvelope(aProfile(), NOW);
    expect(env.format).toBe(EXPORT_FORMAT);
    expect((env.profile.progression as Record<string, unknown>).entitlements).toEqual(defaultProgression().entitlements);
  });

  it('a bare profile file (offsuit-state.json from another machine) imports too', () => {
    const checked = checkImport(JSON.stringify(aProfile()));
    expect(checked.ok && checked.preview.exportedAt).toBe(null);
    expect(checked.ok && checked.profile).toEqual(expectedAfterImport(aProfile()));
  });

  it('a v1 profile is migrated on the way in', () => {
    const v1 = serialize(recordHand(emptySession(), hand(1)));
    delete v1.schemaVersion;
    delete v1.progression;
    const checked = checkImport(JSON.stringify(v1));
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.preview.fromVersion).toBe(1);
    expect(checked.profile.schemaVersion).toBe(SCHEMA_VERSION);
    expect(deserialize(checked.profile).hands).toHaveLength(1);
  });

  it('an older profile whose hands predate some fields still imports', () => {
    const legacy = { bankroll: 9000, hands: [{ hole: ['Qs', 'Qh'], board: [], net: 0 }] };
    const checked = checkImport(JSON.stringify(legacy));
    expect(checked.ok).toBe(true);
  });
});

describe('strict refusals', () => {
  const env = (profile: unknown, over: Record<string, unknown> = {}) =>
    JSON.stringify({ format: EXPORT_FORMAT, formatVersion: 1, exportedAt: NOW.toISOString(), profile, ...over });
  const good = () => serialize(emptySession());

  const cases: [string, string, string, string?][] = [
    ['not JSON', 'not json at all {', 'not-json'],
    ['an array', '[1,2,3]', 'not-a-profile'],
    ['a scalar', '42', 'not-a-profile'],
    ['someone else’s JSON', JSON.stringify({ name: 'package', version: '1.0.0' }), 'not-a-profile'],
    ['a wrong format name', env(good(), { format: 'other-app' }), 'not-a-profile'],
    ['a newer export format', env(good(), { formatVersion: 2 }), 'newer-format'],
    ['a fractional export format', env(good(), { formatVersion: 1.5 }), 'not-a-profile'],
    ['an envelope without a profile', env(null), 'not-a-profile'],
    ['a newer schema', env({ ...good(), schemaVersion: SCHEMA_VERSION + 1 }), 'newer-version'],
    ['a fractional schema', env({ ...good(), schemaVersion: 1.5 }), 'bad-field', 'schemaVersion'],
    ['a string bankroll', env({ ...good(), bankroll: '100' }), 'not-a-profile'],
    ['hands as an object', env({ ...good(), hands: {} }), 'not-a-profile'],
    ['stats as an array', env({ ...good(), stats: [] }), 'bad-field', 'stats'],
    ['a string flag', env({ ...good(), coachedMode: 'yes' }), 'bad-field', 'coachedMode'],
    ['progression as a string', env({ ...good(), progression: 'x' }), 'bad-field', 'progression'],
    ['a null field', env({ ...good(), gifts: null }), 'bad-field', 'gifts'],
    ['a hand with one hole card', env({ ...good(), hands: [hand(1, { hole: ['As'] })] }), 'bad-field', 'hand 1 has bad hole cards'],
    ['a hand with a fake card', env({ ...good(), hands: [hand(1, { hole: ['As', '1x'] })] }), 'bad-field', 'hand 1 has bad hole cards'],
    ['a repeated card', env({ ...good(), hands: [hand(1), hand(2, { board: ['As', '2c', '3c'] })] }), 'bad-field', 'hand 2 repeats a card'],
    ['six board cards', env({ ...good(), hands: [hand(1, { board: ['2c', '3c', '4c', '5c', '6c', '7c'] })] }), 'bad-field', 'hand 1 has a bad board'],
    ['a string result', env({ ...good(), hands: [{ ...hand(1), net: '5' }] }), 'bad-field', 'hand 1 has a bad net'],
    ['a hand that is not an object', env({ ...good(), hands: ['x'] }), 'bad-field', 'hand 1 is not an object'],
    ['more hands than the log holds', env({ ...good(), hands: Array.from({ length: 501 }, (_, i) => hand(i)) }), 'bad-field', 'hands'],
  ];
  for (const [name, text, reason, detail] of cases) {
    it(`refuses ${name}`, () => {
      const checked = checkImport(text);
      expect(checked.ok).toBe(false);
      if (checked.ok) return;
      expect(checked.reason).toBe(reason);
      if (detail !== undefined) expect(checked.detail).toBe(detail);
    });
  }

  it('refuses an oversized file before reading it', () => {
    expect(checkImport('{}', MAX_IMPORT_BYTES + 1)).toEqual({ ok: false, reason: 'too-large' });
  });

  it('a __proto__ key cannot reach the prototype', () => {
    // Inside a parser-owned object it would be dropped, so the file is refused.
    const nested = checkImport(`{"bankroll": 100, "hands": [], "stats": {"__proto__": {"polluted": true}}}`);
    expect(nested).toMatchObject({ ok: false, reason: 'bad-field' });
    // At the top level it is an unknown key, carried as an own data property.
    const top = checkImport(`{"bankroll": 100, "hands": [], "__proto__": {"polluted": true}}`);
    expect(top.ok).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    if (top.ok) {
      expect(Object.getPrototypeOf(top.profile)).toBe(Object.prototype);
      expect(Object.hasOwn(top.profile, '__proto__')).toBe(true);
    }
  });

  it('every refusal has text', () => {
    for (const text of Object.values(IMPORT_REFUSAL_TEXT)) expect(text).toContain('Nothing was changed');
  });
});

describe('the field list', () => {
  it('names every top-level key the profile parser reads', () => {
    expect(Object.keys(FIELD_TYPES).sort()).toEqual(Object.keys(PROFILE_SHAPE).sort());
  });

  it('matches the types serialize writes', () => {
    const s = serialize(emptySession());
    for (const [key, want] of Object.entries(FIELD_TYPES)) {
      const v = s[key];
      expect(Array.isArray(v) ? 'array' : typeof v, key).toBe(want);
    }
  });
});

describe('nested values the parser would repair are refused, not rewritten', () => {
  const env = (profile: unknown) => JSON.stringify({ format: EXPORT_FORMAT, formatVersion: 1, exportedAt: NOW.toISOString(), profile });
  const base = () => aProfile();
  const cases: [string, (p: Record<string, unknown>) => void][] = [
    ['junk decisions', (p) => ((p.hands as Record<string, unknown>[])[0].decisions = [1, 'x', null])],
    ['a junk grade', (p) => ((p.hands as Record<string, unknown>[])[0].grades = [7])],
    ['a string streak', (p) => ((p.progression as Record<string, unknown>).streak = 'garbage')],
    ['a string stat', (p) => ((p.stats as Record<string, unknown>).handsPlayed = 'lots')],
    ['a negative depth floor', (p) => (p.depthFloor = -3)],
  ];
  for (const [name, spoil] of cases) {
    it(`refuses ${name}`, () => {
      const p = base();
      spoil(p);
      const checked = checkImport(env(p));
      expect(checked.ok, name).toBe(false);
      if (!checked.ok) expect(checked.reason).toBe('bad-field');
    });
  }

  it('keeps and counts unknown keys at every level, as a save does', () => {
    const p = base();
    (p.progression as Record<string, unknown>).futureThing = { x: 1 };
    ((p.progression as Record<string, unknown>).streak as Record<string, unknown>).futureField = 2;
    const checked = checkImport(env(p));
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect((checked.profile.progression as Record<string, unknown>).futureThing).toEqual({ x: 1 });
    expect(((checked.profile.progression as Record<string, unknown>).streak as Record<string, unknown>).futureField).toBe(2);
    expect(checked.profile.futureThing).toEqual({ from: 'a newer build' });
    expect([...checked.preview.unknownKeys].sort()).toEqual(['futureThing', 'progression.futureThing', 'progression.streak.futureField']);
  });
});

describe('an export is always importable by the build that wrote it', () => {
  it('normalises a profile main loaded but never saved', () => {
    const raw = aProfile();
    (raw.stats as Record<string, unknown>).handsPlayed = 'lots';
    ((raw.hands as Record<string, unknown>[])[0]).grades = [7];
    const checked = checkImport(exportText(raw, NOW));
    expect(checked.ok).toBe(true);
  });

  it('leaves a newer build’s profile as it is (an import then says it is newer)', () => {
    const newer = { ...aProfile(), schemaVersion: SCHEMA_VERSION + 1, stats: 'their shape' };
    expect(exportEnvelope(newer, NOW).profile.stats).toBe('their shape');
    expect(checkImport(exportText(newer, NOW))).toEqual({ ok: false, reason: 'newer-version' });
  });
});
