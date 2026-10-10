/**
 * SEAT LAYOUT — where each villain sits on the table, as a pure rule of the seat count.
 *
 * The table is a scoreboard "U" (the `sports` direction in demo/glass/): one or two seats in each side
 * column and the rest in one top row, filled clockwise from the hero, who holds the bottom. Clockwise
 * from the hero (the button) means the first villain is the bottom of the left column and the last is
 * the bottom of the right column, so the small blind always sits on the hero's left, as at a real table.
 *
 * A rule, not hand-placed seats: the solo table is 3 villains and LAN rooms go to 5 (core/multiplayer.ts
 * caps seatCount at 6), and the same rule was checked visually up to 8 villains in the mock. The CSS
 * reads the slot as data-slot plus --i/--n (index within the area, size of the area).
 */

export type SeatArea = 'left' | 'top' | 'right';

export interface SeatSlot {
  area: SeatArea;
  /** Position within the area: bottom→top for the left column, left→right for the top row,
   *  top→bottom for the right column — i.e. clockwise order. */
  index: number;
  /** How many seats share the area. */
  count: number;
}

/** Seats per side column for `villains` opponents: one up to 5 villains, two from 6 (≥7-handed). */
export function sideColumnSize(villains: number): number {
  if (villains <= 1) return 0;
  return Math.max(1, Math.round(villains / 4));
}

/** Slots for `villains` opponents, in clockwise order from the hero. */
export function seatSlots(villains: number): SeatSlot[] {
  if (!Number.isInteger(villains) || villains < 0) throw new RangeError(`villains ${villains} must be a non-negative integer`);
  const side = sideColumnSize(villains);
  const top = villains - 2 * side;
  const slots: SeatSlot[] = [];
  // Left column, filled from the bottom (nearest the hero) upward. index counts top→bottom for CSS, so
  // the first clockwise seat gets the highest index.
  for (let i = 0; i < side; i++) slots.push({ area: 'left', index: side - 1 - i, count: side });
  for (let i = 0; i < top; i++) slots.push({ area: 'top', index: i, count: top });
  for (let i = 0; i < side; i++) slots.push({ area: 'right', index: i, count: side });
  return slots;
}
