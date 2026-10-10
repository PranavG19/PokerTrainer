import { describe, expect, it } from 'vitest';
import { seatSlots, sideColumnSize } from '../../src/renderer/seatLayout.js';

/**
 * SEAT LAYOUT — the scoreboard "U". The load-bearing properties: every villain gets exactly one slot,
 * no two share a slot, the order is clockwise from the hero (left column bottom→top, top row
 * left→right, right column top→bottom), and both side columns are always the same size.
 */

const key = (s: { area: string; index: number }): string => `${s.area}:${s.index}`;

describe('seatSlots', () => {
  it('the solo table (3 villains) is left, top, right — the round-4 layout', () => {
    expect(seatSlots(3)).toEqual([
      { area: 'left', index: 0, count: 1 },
      { area: 'top', index: 0, count: 1 },
      { area: 'right', index: 0, count: 1 },
    ]);
  });

  it('6-max (5 villains, the LAN maximum) puts three across the top', () => {
    expect(seatSlots(5).map(key)).toEqual(['left:0', 'top:0', 'top:1', 'top:2', 'right:0']);
  });

  it('9-max (8 villains) uses two per side and four across the top, clockwise', () => {
    // Left column bottom→top means descending index (index counts top→bottom).
    expect(seatSlots(8).map(key)).toEqual(['left:1', 'left:0', 'top:0', 'top:1', 'top:2', 'top:3', 'right:0', 'right:1']);
  });

  it('heads-up (1 villain) sits alone in the top row', () => {
    expect(seatSlots(1)).toEqual([{ area: 'top', index: 0, count: 1 }]);
  });

  it('every count from 0 to 8 gives one distinct slot per villain with symmetric columns', () => {
    for (let v = 0; v <= 8; v++) {
      const slots = seatSlots(v);
      expect(slots).toHaveLength(v);
      expect(new Set(slots.map(key)).size).toBe(v);
      const left = slots.filter((s) => s.area === 'left').length;
      const right = slots.filter((s) => s.area === 'right').length;
      expect(left).toBe(right);
      expect(left).toBe(sideColumnSize(v));
      for (const s of slots) expect(s.index).toBeLessThan(s.count);
    }
  });

  it('rejects a negative or fractional count', () => {
    expect(() => seatSlots(-1)).toThrow(RangeError);
    expect(() => seatSlots(2.5)).toThrow(RangeError);
  });
});
