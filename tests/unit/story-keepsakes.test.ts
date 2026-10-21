import { describe, expect, it } from 'vitest';
import type { DayKey } from '../../src/core/localDay.js';
import { defaultProgression } from '../../src/core/progression/persist.js';
import { BOSS_HANDS, recordBoss } from '../../src/core/story/boss.js';
import { KITCHEN, MASQUERADE, RIVALS, VENUES } from '../../src/core/story/cast.js';
import { earnStatus, syncCosmetics } from '../../src/core/cosmetics/locker.js';
import { itemById } from '../../src/core/cosmetics/catalogue.js';
import { KEEPSAKES, earnedOn, keepsakeDays, keepsakeFor, shelf, syncKeepsakes } from '../../src/core/story/keepsakes.js';

const day = (n: number): DayKey => n as DayKey;

describe('keepsakes: one per chapter, earned on decisions alone', () => {
  it('the Kitchen Table, each venue and the Masquerade have exactly one; every boss hand earns one', () => {
    expect(KEEPSAKES).toHaveLength(VENUES.length + 2);
    expect(new Set(KEEPSAKES.map((k) => k.id)).size).toBe(KEEPSAKES.length);
    for (const room of [KITCHEN.id, MASQUERADE.id, ...VENUES.map((v) => v.id)]) expect(keepsakeFor(room), room).toBeDefined();
    for (const b of BOSS_HANDS) expect(keepsakeFor(b.room), b.id).toBeDefined();
    // Each rival's keepsake is the glyph its medallion carries, and its id is the one Dee's memory already uses.
    for (const v of VENUES) expect(keepsakeFor(v.id)!.id).toBe(`${v.rival}-${RIVALS[v.rival].keepsake}`);
    expect(keepsakeFor('lighthouse')!.id).toBe('wren-wick');
  });

  it('a keepsake never names its rival: one can be earned while the rival is still masked', () => {
    for (const k of KEEPSAKES) for (const r of Object.values(RIVALS)) expect(`${k.name} ${k.fact}`).not.toContain(r.short);
  });

  it('a clean boss hand earns its room’s keepsake; a hand right only in the end does not', () => {
    let story = defaultProgression().story;
    story = recordBoss(story, 'boss-lighthouse', false, day(3));
    expect(earnedOn(story, keepsakeFor('lighthouse')!)).toBeNull();
    story = recordBoss(story, 'boss-lighthouse', true, day(4));
    story = recordBoss(story, 'boss-kitchen', true, day(2));
    expect(earnedOn(story, keepsakeFor('lighthouse')!)).toBe(day(4));
    expect(shelf(story).filter((s) => s.earnedOn !== null).map((s) => s.keepsake.id)).toEqual(['kitchen-lamp', 'wren-wick']);
    expect(keepsakeDays(story).sort()).toEqual([day(2), day(4)]);
  });

  it('the mask is earned by the first fully unmasked Masquerade', () => {
    const p = defaultProgression();
    const story = { ...p.story, masquerade: { ...p.story.masquerade, completed: 1, completedOn: day(9) } };
    expect(earnedOn(story, keepsakeFor(MASQUERADE.id)!)).toBe(day(9));
  });

  it('files earned ids in Dee’s memory once, keeping ids a newer build wrote', () => {
    const p = defaultProgression();
    const withNewer = { ...p, dee: { ...p.dee, keepsakes: ['someday-thing'] }, story: recordBoss(p.story, 'boss-diner', true, day(5)) };
    const synced = syncKeepsakes(withNewer);
    expect(synced.dee.keepsakes).toEqual(['someday-thing', 'barnaby-ticket']);
    expect(syncKeepsakes(synced)).toBe(synced);
  });

  it('the Locker files the first-keepsake item on a receipt, dated the day it was kept, and none for chips', () => {
    const p = defaultProgression();
    const ctx = (story: typeof p.story) => ({ milestones: p.milestones, seals: p.seals, story });
    const lamp = itemById('rim-lamplit')!;
    expect(earnStatus(lamp, ctx(p.story))).toMatchObject({ met: false, progress: { value: 0, target: 1 } });
    const story = recordBoss(p.story, 'boss-kitchen', true, day(7));
    expect(earnStatus(lamp, ctx(story))).toMatchObject({ met: true, day: day(7) });
    const synced = syncCosmetics(p.cosmetics, ctx(story), day(9));
    expect(synced.receipts.find((r) => r.itemId === 'rim-lamplit')).toMatchObject({ day: day(7), chalk: 0 });
    expect(synced.owned).not.toContain('felt-ballroom');
    expect(earnStatus(itemById('felt-ballroom')!, ctx(story)).progress).toMatchObject({ value: 1, target: KEEPSAKES.length });
  });
});
