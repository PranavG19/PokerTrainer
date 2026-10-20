/**
 * The Locker's rules (1.7): what is earned, what is owned, what is equipped. Pure; the caller passes the day.
 *
 * - **Earned** reads only ratchets the habit loop already keeps (milestone receipts, Seal receipts, rivals unmasked),
 *   so an item, once earned, stays earned: a streak reset or a decayed concept never takes one back.
 * - **Owned** (`cosmetics.owned`) is the receipt of that, filed on save like Seals and milestones, with the fact and
 *   the day the fact first held. Day-one items are the defaults and are never stored.
 * - **Equipped** is one item per slot, only ever an owned one (the parser drops anything else). Equipping a day-one
 *   item clears the slot. An id this build does not know is kept as it is and paints the default.
 *
 * Nothing here reads chips, pots or results, and nothing costs anything (owner D4 is open: receipts only).
 */

import type { DayKey } from '../localDay.js';
import { chalk } from '../units.js';
import { milestoneById, type MilestoneFacts } from '../progression/milestones.js';
import { COSMETIC_SLOTS, type CosmeticSlot, type CosmeticsState, type MilestonesState, type SealsState, type StoryState } from '../progression/types.js';
import { CATALOGUE, defaultItem, itemById, type CosmeticItem } from './catalogue.js';

export interface EarnContext {
  readonly milestones: MilestonesState;
  readonly seals: SealsState;
  readonly story: StoryState;
  /** For the progress on a locked milestone item; without it a locked item shows its rule only. */
  readonly facts?: MilestoneFacts;
}

export interface EarnStatus {
  readonly met: boolean;
  /** The day the fact first held; null while not met (or for a day-one item). */
  readonly day: DayKey | null;
  /** The fact, in words: what earns it (or earned it). */
  readonly fact: string;
  /** The receipt's short name: the milestone, or the rule. */
  readonly source: string;
  /** How close, while not met. */
  readonly progress: { readonly value: number; readonly target: number; readonly unit: string } | null;
}

/** The `n`th earliest day in a set of receipt days, or null when there are fewer than `n`. */
function nthDay(days: readonly DayKey[], n: number): DayKey | null {
  const sorted = [...days].sort((a, b) => a - b);
  return sorted.length >= n ? sorted[n - 1] : null;
}

export function earnStatus(item: CosmeticItem, ctx: EarnContext): EarnStatus {
  const rule = item.earn;
  switch (rule.kind) {
    case 'day-one':
      return { met: true, day: null, fact: 'Yours from day one', source: 'Day one', progress: null };
    case 'milestone': {
      const def = milestoneById(rule.id);
      const day = ctx.milestones.achieved[rule.id]?.day ?? null;
      const m = def && ctx.facts ? def.measure(ctx.facts) : null;
      return {
        met: day !== null,
        day,
        fact: def?.fact ?? 'A milestone this build does not know',
        source: def?.name ?? rule.id,
        progress: day === null && m ? { value: Math.min(m.value, m.target), target: m.target, unit: m.unit } : null,
      };
    }
    case 'seals': {
      const days = Object.values(ctx.seals.earned).map((s) => s.day);
      const day = nthDay(days, rule.count);
      return {
        met: day !== null,
        day,
        fact: `Earned ${rule.count} Seals: ${rule.count} concepts mastered`,
        source: `${rule.count} Seals`,
        progress: day === null ? { value: Math.min(days.length, rule.count), target: rule.count, unit: 'Seals' } : null,
      };
    }
    case 'rivals': {
      const days = Object.values(ctx.story.chapters)
        .map((c) => c.beatenOn)
        .filter((d): d is DayKey => d !== null);
      const day = nthDay(days, rule.count);
      const one = rule.count === 1;
      return {
        met: day !== null,
        day,
        fact: one ? 'Unmasked a regular in the Long Orbit' : `Unmasked ${rule.count} regulars in the Long Orbit`,
        source: one ? 'First unmasked' : `${rule.count} unmasked`,
        progress: day === null ? { value: Math.min(days.length, rule.count), target: rule.count, unit: one ? 'rival' : 'rivals' } : null,
      };
    }
  }
}

/**
 * File a receipt for every item earned now and not yet owned. Returns the same object when nothing is new, so a save
 * that earned nothing writes nothing new.
 */
export function syncCosmetics(state: CosmeticsState, ctx: EarnContext, today: DayKey): CosmeticsState {
  const owned = new Set(state.owned);
  const fresh = CATALOGUE.filter((i) => i.earn.kind !== 'day-one' && !owned.has(i.id)).flatMap((i) => {
    const s = earnStatus(i, ctx);
    return s.met ? [{ item: i, status: s }] : [];
  });
  if (fresh.length === 0) return state;
  return {
    ...state,
    owned: [...state.owned, ...fresh.map((f) => f.item.id)],
    receipts: [
      ...state.receipts,
      ...fresh.map((f) => ({ itemId: f.item.id, day: f.status.day ?? today, fact: f.status.fact, chalk: chalk(0) })),
    ],
  };
}

/** Owned, or a day-one item. */
export function isOwned(state: CosmeticsState, item: CosmeticItem): boolean {
  return item.earn.kind === 'day-one' || state.owned.includes(item.id);
}

/**
 * Equip an item in its slot. A day-one item clears the slot (the default paints with no attribute). An item not owned,
 * or an id this build does not know, is refused: the same object comes back.
 */
export function equip(state: CosmeticsState, itemId: string): CosmeticsState {
  const item = itemById(itemId);
  if (!item || !isOwned(state, item)) return state;
  const equipped = { ...state.equipped };
  if (item.earn.kind === 'day-one') {
    if (!(item.slot in equipped)) return state;
    delete equipped[item.slot];
  } else {
    if (equipped[item.slot] === item.id) return state;
    equipped[item.slot] = item.id;
  }
  return { ...state, equipped };
}

/** The item that paints a slot: the equipped one when this build knows it, else the day-one default. */
export function equippedItem(state: CosmeticsState, slot: CosmeticSlot): CosmeticItem {
  const id = state.equipped[slot];
  const item = id === undefined ? undefined : itemById(id);
  return item && item.slot === slot ? item : defaultItem(slot);
}

/** The document attribute for each slot: the paint value, or null for the default (no attribute). */
export const SLOT_ATTRIBUTE: Record<CosmeticSlot, string> = {
  cardBack: 'back',
  felt: 'felt',
  chipSet: 'chips',
  deeRim: 'rim',
  celebration: 'celebration',
};

export function paintOf(state: CosmeticsState): Record<CosmeticSlot, string | null> {
  const out = {} as Record<CosmeticSlot, string | null>;
  for (const slot of COSMETIC_SLOTS) {
    const item = equippedItem(state, slot);
    out[slot] = item.earn.kind === 'day-one' ? null : item.paint;
  }
  return out;
}

/** The receipt on file for an owned item (the newest, if a carried list holds two). */
export function receiptFor(state: CosmeticsState, itemId: string): CosmeticsState['receipts'][number] | null {
  for (let i = state.receipts.length - 1; i >= 0; i--) if (state.receipts[i].itemId === itemId) return state.receipts[i];
  return null;
}
