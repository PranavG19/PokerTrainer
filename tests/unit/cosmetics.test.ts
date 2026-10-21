import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { DayKey } from '../../src/core/localDay.js';
import { fixedOffsetDayKeyOf } from '../../src/core/localDay.js';
import { emptySession, type SessionState } from '../../src/core/session.js';
import { SCENARIOS } from '../../src/core/puzzleScenarios.js';
import { bannedPhrasingIn } from '../../src/core/progress.js';
import { applyProgress, type ApplyContext } from '../../src/core/progression/apply.js';
import { milestoneById } from '../../src/core/progression/milestones.js';
import { defaultProgression, parseProgression, serializeProgression } from '../../src/core/progression/persist.js';
import { COSMETIC_SLOTS, type CosmeticsState } from '../../src/core/progression/types.js';
import { CATALOGUE, defaultItem, itemsFor } from '../../src/core/cosmetics/catalogue.js';
import { earnStatus, equip, equippedItem, isOwned, paintOf, receiptFor, SLOT_ATTRIBUTE, syncCosmetics, type EarnContext } from '../../src/core/cosmetics/locker.js';

const day = (n: number) => n as DayKey;
const empty = (): CosmeticsState => defaultProgression().cosmetics;
const ctxOf = (over: Partial<EarnContext> = {}): EarnContext => {
  const p = defaultProgression();
  return { milestones: p.milestones, seals: p.seals, story: p.story, ...over };
};
const achieved = (ids: Record<string, number>): EarnContext['milestones'] => ({
  achieved: Object.fromEntries(Object.entries(ids).map(([k, d]) => [k, { day: day(d) }])),
});

describe('the catalogue: fixed, shown in advance, paint only', () => {
  it('ids are unique, and each slot has exactly one day-one default, listed first', () => {
    expect(new Set(CATALOGUE.map((i) => i.id)).size).toBe(CATALOGUE.length);
    for (const slot of COSMETIC_SLOTS) {
      const items = itemsFor(slot);
      expect(items.length, slot).toBeGreaterThanOrEqual(3);
      expect(items.filter((i) => i.earn.kind === 'day-one')).toHaveLength(1);
      expect(items[0]).toBe(defaultItem(slot));
      expect(new Set(items.map((i) => i.paint)).size, `${slot} paints are unique`).toBe(items.length);
    }
  });

  it('every milestone rule names a milestone that exists, and no item is earned twice by the same fact in a slot', () => {
    for (const item of CATALOGUE) {
      if (item.earn.kind === 'milestone') expect(milestoneById(item.earn.id), item.id).toBeDefined();
    }
    for (const slot of COSMETIC_SLOTS) {
      const rules = itemsFor(slot).map((i) => JSON.stringify(i.earn));
      expect(new Set(rules).size).toBe(rules.length);
    }
  });

  it('every name, fact and source passes the content lint', () => {
    const ctx = ctxOf();
    for (const item of CATALOGUE) {
      const s = earnStatus(item, ctx);
      for (const text of [item.name, s.fact, s.source]) expect(bannedPhrasingIn(text), `${item.id}: ${text}`).toBeNull();
    }
  });

  it('paint values are attribute-safe tokens', () => {
    for (const item of CATALOGUE) expect(item.paint).toMatch(/^[a-z][a-z-]*$/);
  });
});

describe('earning: receipts of ratchets already kept', () => {
  it('a milestone receipt earns its item, dated the day the milestone held', () => {
    const ctx = ctxOf({ milestones: achieved({ 'depth-40': 20010 }) });
    const next = syncCosmetics(empty(), ctx, day(20050));
    expect(next.owned).toEqual(['back-the-seal']);
    expect(next.receipts).toEqual([{ itemId: 'back-the-seal', day: day(20010), fact: 'Certified the 40bb table', chalk: 0 }]);
  });

  it('three Seal receipts earn the Inlaid rim, dated the third Seal', () => {
    const seals = { earned: { a: { day: day(5) }, b: { day: day(9) } } };
    expect(syncCosmetics(empty(), ctxOf({ seals }), day(30)).owned).not.toContain('rim-inlaid');
    const three = { earned: { ...seals.earned, c: { day: day(7) } } };
    const next = syncCosmetics(empty(), ctxOf({ seals: three }), day(30));
    expect(next.owned).toContain('rim-inlaid');
    expect(receiptFor(next, 'rim-inlaid')?.day).toBe(9);
  });

  it('a rival unmasked earns the Etched river back', () => {
    const story = { ...defaultProgression().story, chapters: { lighthouse: { introSeen: true, lessonDone: true, tables: 2, lastResult: 'met', beatenOn: day(12) } } };
    const next = syncCosmetics(empty(), ctxOf({ story }), day(40));
    expect(next.owned).toEqual(['back-etched-river']);
    expect(receiptFor(next, 'back-etched-river')?.fact).toBe('Unmasked a regular in the Long Orbit');
  });

  it('returns the same object when nothing is new, and never takes an item back', () => {
    const s0 = empty();
    expect(syncCosmetics(s0, ctxOf(), day(1))).toBe(s0);
    const owned = syncCosmetics(s0, ctxOf({ milestones: achieved({ 'streak-7': 3 }) }), day(4));
    // The milestone receipt is gone from the context (a corrupt file, say): the item stays owned.
    expect(syncCosmetics(owned, ctxOf(), day(5))).toBe(owned);
    expect(owned.owned).toEqual(['felt-spruce']);
  });

  it('day-one items are owned without being stored', () => {
    const s0 = empty();
    for (const slot of COSMETIC_SLOTS) expect(isOwned(s0, defaultItem(slot))).toBe(true);
    expect(syncCosmetics(s0, ctxOf(), day(1)).owned).toEqual([]);
  });

  it('a locked milestone item shows its progress from the facts', () => {
    const facts = {
      depthFloor: 40, conceptsMastered: 3, puzzlesSolvedClean: 0, assessmentsTaken: 0, rulesInYourWords: 4,
      bestStreak: 9, priceHeld: 0, ticketsFinished: 0, sureTotal: 0, sureRight: 0,
    };
    const item = CATALOGUE.find((i) => i.id === 'back-guilloche')!;
    expect(earnStatus(item, ctxOf({ facts })).progress).toEqual({ value: 4, target: 12, unit: 'rules' });
  });
});

describe('equipping: only what is owned, one per slot', () => {
  const owned = syncCosmetics(empty(), ctxOf({ milestones: achieved({ 'depth-75': 2, 'streak-21': 3 }) }), day(9));

  it('equips an owned item and paints its attribute', () => {
    const s = equip(owned, 'felt-night-ink');
    expect(s.equipped).toEqual({ felt: 'felt-night-ink' });
    expect(paintOf(s)).toEqual({ cardBack: null, felt: 'night-ink', chipSet: null, deeRim: null, celebration: null });
  });

  it('refuses an item not owned, or an id this build does not know (the same object back)', () => {
    expect(equip(owned, 'back-calibration')).toBe(owned);
    expect(equip(owned, 'back-from-a-newer-build')).toBe(owned);
  });

  it('a day-one item clears the slot, so the default paints with no attribute', () => {
    const s = equip(equip(owned, 'rim-smoked'), 'rim-bone');
    expect(s.equipped).toEqual({});
    expect(paintOf(s).deeRim).toBeNull();
    expect(equip(s, 'rim-bone')).toBe(s);
  });

  it('an equipped id this build does not know is kept on file and paints the default', () => {
    const fromNewer = parseProgression({ cosmetics: { owned: ['back-x-newer'], equipped: { cardBack: 'back-x-newer' } } }).cosmetics;
    expect(fromNewer.equipped.cardBack).toBe('back-x-newer');
    expect(equippedItem(fromNewer, 'cardBack').id).toBe('back-graphite');
    expect(paintOf(fromNewer).cardBack).toBeNull();
    // And it survives a save by this build.
    const round = parseProgression(serializeProgression({ ...defaultProgression(), cosmetics: fromNewer })).cosmetics;
    expect(round.equipped.cardBack).toBe('back-x-newer');
  });

  it('an item of another slot in a slot paints the default', () => {
    const odd = { ...owned, equipped: { felt: 'rim-smoked' } };
    expect(equippedItem(odd, 'felt').id).toBe('felt-graphite');
  });

  it('owned, equipped and receipts survive a save and a load', () => {
    const s = equip(equip(owned, 'felt-night-ink'), 'rim-smoked');
    const round = parseProgression(serializeProgression({ ...defaultProgression(), cosmetics: s })).cosmetics;
    expect(round).toEqual(s);
  });
});

describe('the save path files cosmetics with the ratchets it files', () => {
  const dayOf = fixedOffsetDayKeyOf(0);
  const NOW = Date.parse('2026-10-12T20:00:00Z');
  const ctx: ApplyContext = { now: NOW, dayOf, scenarios: SCENARIOS, leakPrinciple: null };

  it('a profile with a milestone on file gets its item on the next save', () => {
    const s0 = emptySession();
    const p = { ...s0.progression, milestones: achieved({ 'first-assessment': 20000 }) };
    const s: SessionState = { ...s0, progression: p };
    const out = applyProgress(s, s, {}, ctx).progression;
    expect(out.cosmetics.owned).toEqual(['felt-chalkboard']);
    expect(out.cosmetics.receipts[0]).toMatchObject({ itemId: 'felt-chalkboard', day: 20000, chalk: 0 });
    // Saving again files nothing new.
    const again = applyProgress({ ...s, progression: out }, { ...s, progression: out }, {}, ctx).progression;
    expect(again.cosmetics).toBe(out.cosmetics);
  });
});

describe('isolation: chips never earn or buy a cosmetic, and nothing costs anything', () => {
  it('no cosmetics module reads the bankroll, chips, pots or results', () => {
    const dir = path.resolve(__dirname, '../../src/core/cosmetics');
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), 'utf-8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/bankroll|Chips|chips\(|\bpot\b|\bnet\b|winners|evLoss/);
    }
  });

  it('syncing and equipping never touch the Chalk ledger; every receipt is free', () => {
    const s0 = empty();
    const all = syncCosmetics(
      s0,
      ctxOf({ milestones: achieved(Object.fromEntries(CATALOGUE.flatMap((i) => (i.earn.kind === 'milestone' ? [[i.earn.id, 1]] : [])))) }),
      day(2),
    );
    const worn = CATALOGUE.reduce((s, i) => equip(s, i.id), all);
    expect(worn.chalk).toEqual(s0.chalk);
    expect(worn.receipts.every((r) => r.chalk === 0)).toBe(true);
  });

  it('a big bankroll earns nothing', () => {
    const s0 = emptySession();
    const rich: SessionState = { ...s0, bankroll: 1_000_000 as SessionState['bankroll'] };
    const ctx: ApplyContext = { now: Date.parse('2026-10-12T20:00:00Z'), dayOf: fixedOffsetDayKeyOf(0), scenarios: SCENARIOS, leakPrinciple: null };
    expect(applyProgress(s0, rich, {}, ctx).progression.cosmetics).toBe(s0.progression.cosmetics);
  });
});

describe('the paint: every item is a complete token block of its own slot', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/styles-cosmetics.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(',').map((s) => s.trim()),
    decls: Object.fromEntries([...m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()])),
  }));
  /** The tokens an element with `data-<attr>="<value>"` declares itself (what it does not declare, it inherits). */
  const tokensFor = (attr: string, value: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const r of rules) {
      const hit = r.selectors.some((s) => {
        if (s === `[data-${attr}='${value}']`) return true;
        const not = s.match(new RegExp(`^\\[data-${attr}\\]:not\\(\\[data-${attr}='([\\w-]+)'\\]\\)$`));
        return not !== null && not[1] !== value;
      });
      if (hit) Object.assign(out, r.decls);
    }
    return out;
  };
  // A slot's tokens are every token any of its items declares, so an item adding one the default lacks fails too.
  const slotTokens = Object.fromEntries(
    COSMETIC_SLOTS.map((slot) => [slot, new Set(itemsFor(slot).flatMap((i) => Object.keys(tokensFor(SLOT_ATTRIBUTE[slot], i.paint))))]),
  );

  it('the default block sits on :root and on the default attribute, so the stage can restate it', () => {
    for (const slot of COSMETIC_SLOTS) {
      const d = defaultItem(slot);
      const root = rules.find((r) => r.selectors.includes(':root') && r.selectors.includes(`[data-${SLOT_ATTRIBUTE[slot]}='${d.paint}']`));
      expect(root, slot).toBeDefined();
      expect(slotTokens[slot].size, slot).toBeGreaterThan(0);
    }
  });

  it('every item declares every token of its slot, so a preview on the stage never inherits the worn item', () => {
    for (const item of CATALOGUE) {
      const own = Object.keys(tokensFor(SLOT_ATTRIBUTE[item.slot], item.paint));
      const missing = [...slotTokens[item.slot]].filter((t) => !own.includes(t));
      expect(missing, `${item.id} (${item.paint})`).toEqual([]);
    }
  });

  it('no item reads another slot’s token, so wearing one slot never repaints another', () => {
    for (const item of CATALOGUE) {
      const values = Object.values(tokensFor(SLOT_ATTRIBUTE[item.slot], item.paint)).join(' ');
      for (const slot of COSMETIC_SLOTS) {
        if (slot === item.slot) continue;
        for (const t of slotTokens[slot]) expect(values, `${item.id} reads ${t}`).not.toMatch(new RegExp(`var\\(${t}\\b`));
      }
    }
  });
});


describe('an equip in a slot only a newer build knows (owner: carry it, in place, no version bump)', () => {
  it('is carried through a load and a save while its item is owned; one not owned is still dropped', () => {
    // JSON.parse makes `__proto__` an own key (an object literal would set the prototype instead).
    const raw = JSON.parse('{"cosmetics":{"owned":["avatar-x","felt-spruce"],"equipped":{"felt":"felt-spruce","avatar":"avatar-x","hat":"not-owned","__proto__":"avatar-x"}}}');
    const p = parseProgression(raw);
    const round = parseProgression(serializeProgression(p)).cosmetics.equipped as Record<string, string>;
    expect(round).toEqual({ felt: 'felt-spruce', avatar: 'avatar-x' });
  });

  it('wearing something in a known slot keeps the newer slot', () => {
    const p = parseProgression({ cosmetics: { owned: ['avatar-x', 'felt-spruce'], equipped: { avatar: 'avatar-x' } } });
    const worn = equip(p.cosmetics, 'felt-spruce').equipped as Record<string, string>;
    expect(worn).toEqual({ avatar: 'avatar-x', felt: 'felt-spruce' });
    expect(paintOf(equip(p.cosmetics, 'felt-spruce')).felt).toBe('spruce');
  });
});
