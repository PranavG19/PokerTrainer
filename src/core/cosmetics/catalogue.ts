/**
 * The cosmetics catalogue (VISION Pillar 5, BUILD-PLAN 1.7 and 2.13): earn-only receipts, paint only.
 *
 * Every item is fixed and shown in advance with the fact or the price that earns it. Nothing is sold for money, nothing
 * is random, and no item is ever paid for in chips. Mastery items are earned by a fact the habit loop already keeps,
 * all of them ratchets: a milestone receipt, a count of Seal receipts, a story rival unmasked, or story keepsakes kept.
 * Common items cost earn-only Chalk at a fixed published price (owner D4: build Chalk). Card faces, seat layout and
 * stack display are never cosmetic.
 *
 * `paint` is the value the slot's document attribute takes (`html[data-back|felt|chips|rim|celebration]`); the CSS
 * for it sets custom properties only (styles-cosmetics.css), so equipping changes paint and never layout
 * (theme.spec, locker.spec). The first item of each slot is the day-one default: it paints with no attribute at all.
 *
 * Pure data: no clock, no DOM.
 */

import type { CosmeticSlot } from '../progression/types.js';
import type { ChalkPrice } from '../economy/chalk.js';

export type EarnRule =
  | { readonly kind: 'day-one' }
  /** A milestone receipt (progression/milestones.ts id). */
  | { readonly kind: 'milestone'; readonly id: string }
  /** At least `count` Seal receipts (a concept mastered, ever). */
  | { readonly kind: 'seals'; readonly count: number }
  /** At least `count` story rivals unmasked (a chapter goal met). */
  | { readonly kind: 'rivals'; readonly count: number }
  /** At least `count` story keepsakes (story/keepsakes.ts: a clean boss hand, a Masquerade unmasked). */
  | { readonly kind: 'keepsakes'; readonly count: number }
  /** Earn-only Chalk, at one of the fixed published prices (economy/chalk.ts CHALK_PRICES). Never money, never chips. */
  | { readonly kind: 'chalk'; readonly price: ChalkPrice };

export interface CosmeticItem {
  /** Persisted in `cosmetics.owned` / `equipped`. Never reused for another item. */
  readonly id: string;
  readonly slot: CosmeticSlot;
  readonly name: string;
  /** The document attribute's value; the day-one item's is never written to the document. */
  readonly paint: string;
  readonly earn: EarnRule;
}

const DAY_ONE: EarnRule = { kind: 'day-one' };
const ms = (id: string): EarnRule => ({ kind: 'milestone', id });
const price = (p: ChalkPrice): EarnRule => ({ kind: 'chalk', price: p });

export const CATALOGUE: readonly CosmeticItem[] = [
  // Card backs: the back of every face-down card. Faces are never cosmetic.
  { id: 'back-graphite', slot: 'cardBack', name: 'Graphite', paint: 'graphite', earn: DAY_ONE },
  { id: 'back-etched-river', slot: 'cardBack', name: 'Etched river', paint: 'etched-river', earn: { kind: 'rivals', count: 1 } },
  { id: 'back-guilloche', slot: 'cardBack', name: 'Guilloché', paint: 'guilloche', earn: ms('rules-12') },
  { id: 'back-button-lattice', slot: 'cardBack', name: 'Button lattice', paint: 'button-lattice', earn: ms('tickets-20') },
  { id: 'back-the-seal', slot: 'cardBack', name: 'The seal', paint: 'the-seal', earn: ms('depth-40') },
  { id: 'back-the-crease', slot: 'cardBack', name: 'The crease', paint: 'the-crease', earn: ms('price-held-10') },
  { id: 'back-depth-rings', slot: 'cardBack', name: 'Depth rings', paint: 'depth-rings', earn: ms('depth-125') },
  { id: 'back-calibration', slot: 'cardBack', name: 'Calibration', paint: 'calibration', earn: ms('sure-means-sure') },
  { id: 'back-linen', slot: 'cardBack', name: 'Linen', paint: 'linen', earn: price(150) },
  { id: 'back-herringbone', slot: 'cardBack', name: 'Herringbone', paint: 'herringbone', earn: price(450) },
  { id: 'back-night-weave', slot: 'cardBack', name: 'Night weave', paint: 'night-weave', earn: price(1000) },
  { id: 'back-engravers-plate', slot: 'cardBack', name: 'Engraver’s plate', paint: 'engravers-plate', earn: price(2400) },
  // Table surface: tints of the stage's lit zone.
  { id: 'felt-graphite', slot: 'felt', name: 'Graphite', paint: 'graphite', earn: DAY_ONE },
  { id: 'felt-spruce', slot: 'felt', name: 'Spruce', paint: 'spruce', earn: ms('streak-7') },
  { id: 'felt-night-ink', slot: 'felt', name: 'Night ink', paint: 'night-ink', earn: ms('depth-75') },
  { id: 'felt-umber', slot: 'felt', name: 'Umber', paint: 'umber', earn: ms('concepts-5') },
  { id: 'felt-chalkboard', slot: 'felt', name: 'Chalkboard', paint: 'chalkboard', earn: ms('first-assessment') },
  { id: 'felt-ghost-rail', slot: 'felt', name: 'Ghost rail', paint: 'ghost-rail', earn: ms('rail-first-move') },
  { id: 'felt-ballroom', slot: 'felt', name: 'Ballroom', paint: 'ballroom', earn: { kind: 'keepsakes', count: 8 } },
  { id: 'felt-slate', slot: 'felt', name: 'Slate', paint: 'slate', earn: price(150) },
  { id: 'felt-heather', slot: 'felt', name: 'Heather', paint: 'heather', earn: price(450) },
  { id: 'felt-ink-wash', slot: 'felt', name: 'Ink wash', paint: 'ink-wash', earn: price(1000) },
  // Chip sets (2.13): de-casino-fied, the bet's two tones.
  { id: 'chips-slate-bone', slot: 'chipSet', name: 'Slate and bone', paint: 'slate-bone', earn: DAY_ONE },
  { id: 'chips-clay', slot: 'chipSet', name: 'Clay', paint: 'clay', earn: ms('concepts-2') },
  { id: 'chips-wooden', slot: 'chipSet', name: 'Wooden tokens', paint: 'wooden', earn: ms('first-clean-solve') },
  { id: 'chips-chalk-cubes', slot: 'chipSet', name: 'Chalk cubes', paint: 'chalk-cubes', earn: ms('rules-1') },
  { id: 'chips-pewter', slot: 'chipSet', name: 'Pewter', paint: 'pewter', earn: price(450) },
  { id: 'chips-river-stone', slot: 'chipSet', name: 'River stone', paint: 'river-stone', earn: price(1000) },
  // Dee's finish: the rim only. The role rims (amber notable, coral serious) always paint over it.
  { id: 'rim-bone', slot: 'deeRim', name: 'Bone', paint: 'bone', earn: DAY_ONE },
  { id: 'rim-smoked', slot: 'deeRim', name: 'Smoked', paint: 'smoked', earn: ms('streak-21') },
  { id: 'rim-graphite', slot: 'deeRim', name: 'Graphite', paint: 'graphite', earn: ms('streak-30') },
  { id: 'rim-inlaid', slot: 'deeRim', name: 'Inlaid', paint: 'inlaid', earn: { kind: 'seals', count: 3 } },
  // Seasonal: earned by a Season's free track, kept for good once earned (the season itself is archived).
  { id: 'rim-season-stamp', slot: 'deeRim', name: 'Season stamp', paint: 'season-stamp', earn: ms('season-track') },
  { id: 'rim-lamplit', slot: 'deeRim', name: 'Lamplit', paint: 'lamplit', earn: { kind: 'keepsakes', count: 1 } },
  { id: 'rim-linen', slot: 'deeRim', name: 'Linen', paint: 'linen', earn: price(150) },
  { id: 'rim-walnut', slot: 'deeRim', name: 'Walnut', paint: 'walnut', earn: price(1000) },
  // Celebrations (2.13): the session-end moment's look, capped at 1600 ms, transform and opacity only.
  { id: 'cele-quiet-underline', slot: 'celebration', name: 'Quiet underline', paint: 'quiet-underline', earn: DAY_ONE },
  { id: 'cele-light-sweep', slot: 'celebration', name: 'Light sweep', paint: 'light-sweep', earn: ms('price-held-first') },
  { id: 'cele-page-turn', slot: 'celebration', name: 'Page turn', paint: 'page-turn', earn: ms('ticket-first') },
  { id: 'cele-constellation', slot: 'celebration', name: 'Constellation draw', paint: 'constellation', earn: ms('concepts-12') },
  { id: 'cele-ink-ring', slot: 'celebration', name: 'Ink ring', paint: 'ink-ring', earn: price(450) },
  { id: 'cele-two-lights', slot: 'celebration', name: 'Two lights', paint: 'two-lights', earn: price(2400) },
];

export function itemById(id: string): CosmeticItem | undefined {
  return CATALOGUE.find((i) => i.id === id);
}

export function itemsFor(slot: CosmeticSlot): CosmeticItem[] {
  return CATALOGUE.filter((i) => i.slot === slot);
}

/** The slot's day-one item: what paints when nothing (or an id this build does not know) is equipped. */
export function defaultItem(slot: CosmeticSlot): CosmeticItem {
  return itemsFor(slot).find((i) => i.earn.kind === 'day-one') as CosmeticItem;
}
