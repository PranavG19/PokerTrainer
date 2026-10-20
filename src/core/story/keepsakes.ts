/**
 * Keepsakes: one per chapter of the Long Orbit (VISION §2.1, "one per clean boss hand; each opens its replay"). The
 * Kitchen Table's lamp, the six rivals' glyphs, and the Masquerade's mask. All of them are shown in advance with the
 * fact that earns them; nothing is random, bought or locked, and chips earn none of them.
 *
 * Earned reads only the story's own ratchets: a boss hand's first clean day (`story.bosses[id].cleanOn`) and the first
 * day a Masquerade was fully unmasked (`story.masquerade.completedOn`). The ids are also filed in Dee's memory
 * (`progression.dee.keepsakes`, unique) the moment they are earned, so Dee can say what has been kept.
 *
 * Pure data and derivations: no clock, no DOM.
 */

import type { DayKey } from '../localDay.js';
import type { ProgressionState, StoryState } from '../progression/types.js';
import { bossFor } from './boss.js';
import { KITCHEN, MASQUERADE, RIVALS, VENUES, type KeepsakeGlyph, type StoryRoomId } from './cast.js';

export interface Keepsake {
  /** `${owner}-${glyph}`, persisted in `dee.keepsakes`. Never reused. */
  readonly id: string;
  readonly room: StoryRoomId;
  readonly glyph: KeepsakeGlyph;
  readonly name: string;
  /** One word, for the shelf's label. */
  readonly short: string;
  /** The fact that earns it, in words. */
  readonly fact: string;
}

const GLYPH_NAMES: Readonly<Record<KeepsakeGlyph, string>> = {
  wick: 'The wick',
  ticket: 'The toll ticket',
  bookmark: 'The bookmark',
  punch: 'The punched ticket',
  fuse: 'The fuse',
  fork: 'The tuning fork',
  lamp: 'The kitchen lamp',
  mask: 'The mask',
};

const GLYPH_SHORT: Readonly<Record<KeepsakeGlyph, string>> = {
  wick: 'Wick',
  ticket: 'Ticket',
  bookmark: 'Bookmark',
  punch: 'Punch',
  fuse: 'Fuse',
  fork: 'Fork',
  lamp: 'Lamp',
  mask: 'Mask',
};

const kitchen: Keepsake = {
  id: 'kitchen-lamp',
  room: KITCHEN.id,
  glyph: 'lamp',
  name: GLYPH_NAMES.lamp,
  short: 'Lamp',
  fact: `Played the first hand at ${KITCHEN.name} clean`,
};

const masquerade: Keepsake = {
  id: 'masquerade-mask',
  room: MASQUERADE.id,
  glyph: 'mask',
  name: GLYPH_NAMES.mask,
  short: 'Mask',
  fact: `Unmasked every seat at ${MASQUERADE.name}, from the reads alone`,
};

/** In the order of the shelf: the Kitchen Table, the orbit's default order, then the Masquerade. */
export const KEEPSAKES: readonly Keepsake[] = [
  kitchen,
  ...VENUES.map((v): Keepsake => {
    const rival = RIVALS[v.rival];
    return {
      id: `${rival.id}-${rival.keepsake}`,
      room: v.id,
      glyph: rival.keepsake,
      // Named for the object, never the rival: a keepsake can be earned while its rival is still masked.
      name: GLYPH_NAMES[rival.keepsake],
      short: GLYPH_SHORT[rival.keepsake],
      fact: `Played the last hand at ${v.name} clean`,
    };
  }),
  masquerade,
];

export function keepsakeById(id: string): Keepsake | undefined {
  return KEEPSAKES.find((k) => k.id === id);
}

export function keepsakeFor(room: StoryRoomId): Keepsake | undefined {
  return KEEPSAKES.find((k) => k.room === room);
}

/** The day a keepsake was earned, or null. */
export function earnedOn(story: StoryState, k: Keepsake): DayKey | null {
  if (k.room === MASQUERADE.id) return story.masquerade.completedOn;
  const boss = bossFor(k.room);
  return boss ? (story.bosses[boss.id]?.cleanOn ?? null) : null;
}

export interface ShelfItem {
  readonly keepsake: Keepsake;
  readonly earnedOn: DayKey | null;
}

export function shelf(story: StoryState): ShelfItem[] {
  return KEEPSAKES.map((keepsake) => ({ keepsake, earnedOn: earnedOn(story, keepsake) }));
}

/** The days keepsakes were first earned, for the Locker's count rule. */
export function keepsakeDays(story: StoryState): DayKey[] {
  return KEEPSAKES.map((k) => earnedOn(story, k)).filter((d): d is DayKey => d !== null);
}

/** File every earned keepsake in Dee's memory; the same object when nothing is new. Ids a newer build wrote stay. */
export function syncKeepsakes(p: ProgressionState): ProgressionState {
  const have = new Set(p.dee.keepsakes);
  const fresh = KEEPSAKES.filter((k) => !have.has(k.id) && earnedOn(p.story, k) !== null).map((k) => k.id);
  if (fresh.length === 0) return p;
  return { ...p, dee: { ...p.dee, keepsakes: [...p.dee.keepsakes, ...fresh] } };
}
