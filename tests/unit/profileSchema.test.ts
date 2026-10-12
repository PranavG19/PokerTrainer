import { describe, expect, it } from 'vitest';
import {
  migrate,
  PROFILE_SHAPE,
  SCHEMA_VERSION,
  schemaVersionOf,
  unknownKeysOf,
  withUnknownKeys,
  type KeyShape,
} from '../../src/core/profileSchema.js';
import { deserialize, emptySession, serialize } from '../../src/core/session.js';
import { defaultProgression } from '../../src/core/progression/persist.js';

/** A v1 profile as the app wrote it before schemaVersion existed (no version key, no progression). */
function v1Profile(): Record<string, unknown> {
  const s = serialize(emptySession());
  delete s.schemaVersion;
  delete s.progression;
  return {
    ...s,
    bankroll: 8740,
    rebuys: 2,
    hands: [{ playedAt: 1_700_000_000_000, net: -260, vpip: true, pfr: false, grades: [], decisions: [] }],
    stats: { handsPlayed: 1, vpipHands: 1, pfrHands: 0, evLossBb: 0, leaks: {}, leakCostBb: {} },
    lexicon: [{ conceptId: 'pot-odds', text: 'the price is the call over the pot after I call', at: 1, accepted: true }],
  };
}

describe('schemaVersionOf', () => {
  it('reads an absent key as v1', () => {
    expect(schemaVersionOf({})).toBe(1);
  });

  it('reads garbage as v1, so the migrations (which keep everything) run again', () => {
    for (const v of ['2', null, 0, -3, 1.5, Number.NaN, {}, true]) expect(schemaVersionOf({ schemaVersion: v })).toBe(1);
  });

  it('keeps any number above this build’s version, integer or not, so it reads as newer', () => {
    expect(schemaVersionOf({ schemaVersion: 3 })).toBe(3);
    expect(schemaVersionOf({ schemaVersion: 2.5 })).toBe(2.5);
  });
});

describe('migrate v1 → v2', () => {
  it('adds schemaVersion and a default progression', () => {
    const r = migrate(v1Profile());
    expect(r).toMatchObject({ from: 1, to: 2, tooNew: false });
    expect(r.state.schemaVersion).toBe(2);
    expect(r.state.progression).toEqual(JSON.parse(JSON.stringify(defaultProgression())));
  });

  it('leaves every v1 field byte-identical', () => {
    const before = v1Profile();
    const snapshot = JSON.stringify(before);
    const after = migrate(before).state;
    expect(JSON.stringify(before)).toBe(snapshot); // the input is not mutated
    for (const key of Object.keys(before)) expect(JSON.stringify(after[key])).toBe(JSON.stringify(before[key]));
  });

  it('is idempotent: migrating a migrated profile changes nothing', () => {
    const once = migrate(v1Profile()).state;
    const twice = migrate(once);
    expect(twice).toMatchObject({ from: 2, to: 2, tooNew: false });
    expect(twice.state).toBe(once);
  });

  it('keeps a progression already there when the version key was lost (it never resets)', () => {
    const progression = { ...JSON.parse(JSON.stringify(defaultProgression())), streak: { countedDays: [19000] } };
    const r = migrate({ ...v1Profile(), progression });
    expect(r.state.progression).toBe(progression);
  });

  it('a v1 profile then deserialises to the same session a v1 load gave, plus defaults', () => {
    const v1 = v1Profile();
    const viaV1 = deserialize(v1);
    const viaV2 = deserialize(migrate(v1).state);
    expect({ ...viaV2, unknownKeys: {} }).toEqual({ ...viaV1, unknownKeys: {} });
  });
});

describe('a newer profile', () => {
  it('is flagged tooNew and returned untouched', () => {
    const v3 = { ...v1Profile(), schemaVersion: 3, progression: { streak: { meaningChanged: true } } };
    const r = migrate(v3);
    expect(r).toMatchObject({ from: 3, to: 3, tooNew: true });
    expect(r.state).toBe(v3);
  });
});

describe('unknown keys', () => {
  it('survive a load and save at the top level and inside progression', () => {
    const disk = migrate(v1Profile()).state;
    const progression = disk.progression as Record<string, Record<string, unknown>>;
    const withFuture = {
      ...disk,
      futureTop: { a: 1 },
      progression: {
        ...progression,
        quests: [{ id: 'q1' }],
        streak: { ...progression.streak, glow: 'amber' },
        personalization: { ...progression.personalization, pronounsNote: 'kept' },
      },
    };
    const saved = serialize(deserialize(JSON.parse(JSON.stringify(withFuture))));
    expect(saved.futureTop).toEqual({ a: 1 });
    const p = saved.progression as Record<string, Record<string, unknown>>;
    expect(p.quests).toEqual([{ id: 'q1' }]);
    expect(p.streak.glow).toBe('amber');
    expect(p.personalization.pronounsNote).toBe('kept');
  });

  it('never resurrect a known value the parser replaced', () => {
    // An equip of an item not owned is dropped by the parser; the carry must not put it back.
    const disk = migrate(v1Profile()).state;
    const progression = structuredClone(disk.progression) as Record<string, Record<string, unknown>>;
    progression.cosmetics.equipped = { felt: 'not-owned' };
    const saved = serialize(deserialize({ ...disk, progression }));
    expect((saved.progression as Record<string, Record<string, unknown>>).cosmetics.equipped).toEqual({});
  });

  it('carry "__proto__" as plain data, without touching any prototype', () => {
    const raw = JSON.parse('{"bankroll": 1, "__proto__": {"polluted": true}}') as Record<string, unknown>;
    const carried = unknownKeysOf(raw);
    expect(Object.getPrototypeOf(carried)).toBe(Object.prototype);
    const out = withUnknownKeys({}, carried);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.stringify(out)).toBe('{"__proto__":{"polluted":true}}');
  });

  /**
   * If serialize wrote a key the shape did not list, the carry would treat the on-disk copy as unknown and
   * could resurrect it after the parser dropped it. So the shape must list every key serialize writes.
   */
  it('the shape lists every key serialize writes, at every fixed-shape level', () => {
    const missing: string[] = [];
    const walk = (value: unknown, shape: KeyShape, at: string): void => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
      for (const [key, child] of Object.entries(value)) {
        const known = shape[key];
        if (known === undefined) missing.push(`${at}${key}`);
        else if (known !== true) walk(child, known, `${at}${key}.`);
      }
    };
    walk(serialize(emptySession()), PROFILE_SHAPE, '');
    expect(missing).toEqual([]);
  });
});

describe('serialize', () => {
  it('stamps the current schema version', () => {
    expect(serialize(emptySession()).schemaVersion).toBe(SCHEMA_VERSION);
  });
});
