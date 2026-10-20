/**
 * TABLE SIZE — the solo table's two shapes: the classic 4-max (three villains) and 6-max (five), BUILD-PLAN 2.12.
 *
 * Everything else is already seat-count generic: the engine posts blinds and rotates the button over any n,
 * seatLayout.ts places any number of villains, and gradeSpot.ts maps seats onto the 6-max charts by their
 * distance from the button (so 6-handed reads UTG, HJ, CO, BTN, SB, BB with no mapping at all). What a size
 * decides is only who sits down: the names and which archetypes fill the villain seats.
 */
import { ARCHETYPE_NAMES, type ArchetypeName } from './archetypes.js';
import { mulberry32, shuffle } from './rng.js';

export type TableSize = 4 | 6;

/**
 * Seat 0 is the hero. Names stay distinct (gradeSpot attributes the log by name) and so do their first letters
 * (each is the seat's avatar). The first four are the 4-max table's, unchanged.
 */
const NAMES = ['You', 'Ada', 'Bo', 'Cy', 'Dot', 'Eve'] as const;

export function seatNamesFor(size: TableSize): string[] {
  return NAMES.slice(0, size);
}

/**
 * The archetype at each villain seat (index 0 is seat 1), a pure function of the seed. The draw is the 4-max
 * table's own 3-of-6 shuffle on its own stream, cut longer: the first three seats get exactly the archetypes the
 * 4-max table seats for the same seed, and 6-max seats five of the six, each once.
 */
export function villainArchetypes(seed: number, size: TableSize): ArchetypeName[] {
  const selectRng = mulberry32(seed ^ 0x5e1ec7);
  return shuffle([...ARCHETYPE_NAMES], selectRng).slice(0, size - 1);
}
