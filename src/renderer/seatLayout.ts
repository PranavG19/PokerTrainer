/**
 * SEAT LAYOUT — where each villain sits on the table, as a pure rule of the seat count.
 *
 * The table is a scoreboard "U" (the `sports` direction in demo/glass/): one or two seats in each side
 * column and the rest in one top row, filled clockwise from the hero, who holds the bottom. Clockwise
 * from the hero means the first villain is the bottom of the left column and the last is the bottom of
 * the right column, so the seat after the hero always sits on the hero's left, as at a real table.
 *
 * A rule, not hand-placed seats: the solo table is 3 villains (4-max) or 5 (6-max), and the same rule was
 * checked visually up to 8 villains in the mock. The CSS reads the slot as data-slot plus --i/--n (index
 * within the area, size of the area).
 *
 * 6-max is two per side and one on top (an oval), not three across the top. The top row shares the stage's
 * top edge with the table corners (the blinds on the left; the win readout, Coach and Stats on the right),
 * and only the centre of that edge is clear of both: three seats across it overlapped the corners at both
 * window sizes, and one another once the quips were revealed (measured, 900x640 and 1100x760).
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

/** Seats per side column for `villains` opponents: one up to 4 villains (≤5-handed), two from 5 (6-max). */
export function sideColumnSize(villains: number): number {
  if (villains <= 1) return 0;
  return Math.max(villains >= 5 ? 2 : 1, Math.round(villains / 4));
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
