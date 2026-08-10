/**
 * CONTRAST SETS — PRODUCT-SPEC B6, user story 19, Edge-cases row "contrast generator".
 *
 * After an error the learner sees near-identical spots that differ in EXACTLY ONE of B6's seven
 * variables, so the boundary is discovered rather than memorised. The whole value of the device
 * rests on the one-variable guarantee: if two things move, the learner attributes the flip to the
 * wrong one and installs a false rule, which is worse than installing no rule. So a two-variable
 * pair is a bug here, never a degraded approximation — this module refuses to emit one and says
 * why, and the caller falls back to a worked example.
 *
 * HONEST AXIS COVERAGE. B6 says board texture and stack depth need a separately solved tree, and
 * this project has no solver; range asymmetry needs the two ranges at the node, which core does not
 * hold either. Those three axes are declared unavailable rather than faked — see AXIS_AVAILABILITY.
 * Of the four that remain, only `kickerGap` can fill the canonical four-spot set. `suitedness` has
 * two levels. `position` and `playersBehind` cap at three spots on a 4-max table for a structural
 * reason, not a missing-content reason: see AXIS_MAX_SET_SIZE. So they are offered at their real
 * size and fail loudly at size 4, because padding a set with a repeated level would put two
 * identical spots in front of the learner, from which no boundary can be read.
 *
 * DECIDED: CONTRAST SETS ARE AXIS-SIZED, NOT ALWAYS FOUR. Story 19 asks for four variants and B5
 * assumes a 6-max table, where position and players-behind would reach four. This game is 4-max, so
 * on those axes four is unreachable for a structural reason. The alternative — widening the engine
 * to 6-max — is a large change to the one file every test depends on, and it would buy a fourth spot
 * on two axes only. Two or three genuinely one-variable spots teach the boundary; four spots where
 * one is a duplicate, or where two variables moved, teach the wrong thing. So callers must read
 * AXIS_MAX_SET_SIZE or axisCoverage() and accept the axis's real size rather than hardcoding 4.
 *
 * Every variant is built through the real engine in table.ts off a real 52-card deck. A variant
 * that cannot be dealt is a content bug, so it is dropped and — if that leaves the set short —
 * reported as a failure instead of reaching a learner.
 *
 * Randomness is a seed parameter. A generator that reaches for Math.random cannot be property
 * tested, and the one-variable property is the only reason this file exists.
 */

import { freshDeck, RANKS, rankValue, suitOf, type Card, type Rank } from './cards.js';
import { mulberry32, type Rng } from './rng.js';
import {
  applyAction,
  createTable,
  legalActions,
  startHand,
  type ActionKind,
  type Street,
  type TableState,
} from './table.js';

// ── The seven-variable feature vector (B6) ───────────────────────────────────

export const CONTRAST_AXES = [
  'suitedness',
  'kickerGap',
  'position',
  'playersBehind',
  'rangeAsymmetry',
  'boardTexture',
  'stackDepth',
] as const;

export type ContrastAxis = (typeof CONTRAST_AXES)[number];

export type Suitedness = 'suited' | 'offsuit';

/** Rank distance between the two hole cards, banded. A pair is gap 0 and is never suited. */
export type GapBand = 'pair' | 'connected' | 'one-gap' | 'two-gap' | 'wide';

export const GAP_BANDS: readonly GapBand[] = ['pair', 'connected', 'one-gap', 'two-gap', 'wide'];

/** The 4-max table the app deals (table.ts creates four seats). */
export type ContrastPosition = 'BTN' | 'CO' | 'SB' | 'BB';

export const POSITIONS: readonly ContrastPosition[] = ['BTN', 'SB', 'BB', 'CO'];

export type RangeAsymmetry = 'symmetric' | 'ip-favoured' | 'oop-favoured';

/** B5's six flop classes, plus the two cases a classifier must admit it cannot place. */
export type BoardTexture =
  | 'preflop'
  | 'dry-ace-high'
  | 'dry-king-high'
  | 'low-connected'
  | 'paired'
  | 'monotone'
  | 'broadway-two-tone'
  | 'other';

/** B5's three solved depths. */
export type StackDepth = 'bb40' | 'bb100' | 'bb200';

export interface SpotFeatures {
  readonly suitedness: Suitedness;
  readonly kickerGap: GapBand;
  readonly position: ContrastPosition;
  /** Live opponents still to act after hero on this street. */
  readonly playersBehind: number;
  readonly rangeAsymmetry: RangeAsymmetry;
  readonly boardTexture: BoardTexture;
  readonly stackDepth: StackDepth;
}

/**
 * A dealable spot. Everything the engine needs plus the one declared field (`rangeAsymmetry`) that
 * cards cannot express.
 */
export interface ContrastSpot {
  /** The concept being remediated. Logged on failure so the miss is attributable (B6). */
  readonly conceptId: string;
  readonly hole: readonly Card[];
  readonly board: readonly Card[];
  readonly street: Street;
  readonly position: ContrastPosition;
  /** Live opponents, by seat. Distinct, non-empty, never hero's own position. */
  readonly villainPositions: readonly ContrastPosition[];
  readonly effectiveStackBb: number;
  /** Chips already in the middle, in big blinds. Postflop only; preflop the blinds are the pot. */
  readonly potBb: number;
  readonly bb: number;
  readonly rangeAsymmetry: RangeAsymmetry;
}

// ── Feature derivation ───────────────────────────────────────────────────────

const TABLE_SEATS = 4;

const OFFSET_FROM_BUTTON: Readonly<Record<ContrastPosition, number>> = {
  BTN: 0,
  SB: 1,
  BB: 2,
  CO: 3,
};

/** Clockwise from the button, so the small blind acts first once the flop is out. */
const POSTFLOP_ORDER: readonly ContrastPosition[] = ['SB', 'BB', 'CO', 'BTN'];

/** Preflop opens on the seat left of the big blind, which on 4-max is the cutoff. */
const PREFLOP_ORDER: readonly ContrastPosition[] = ['CO', 'BTN', 'SB', 'BB'];

const actingOrder = (street: Street): readonly ContrastPosition[] =>
  street === 'preflop' ? PREFLOP_ORDER : POSTFLOP_ORDER;

export function playersBehind(spot: ContrastSpot): number {
  const order = actingOrder(spot.street);
  const heroAt = order.indexOf(spot.position);
  return spot.villainPositions.filter((p) => order.indexOf(p) > heroAt).length;
}

export function suitednessOf(hole: readonly Card[]): Suitedness {
  return hole.length === 2 && suitOf(hole[0]) === suitOf(hole[1]) ? 'suited' : 'offsuit';
}

export function gapBandOf(hole: readonly Card[]): GapBand {
  const gap = Math.abs(rankValue(hole[0]) - rankValue(hole[1]));
  if (gap === 0) return 'pair';
  if (gap === 1) return 'connected';
  if (gap === 2) return 'one-gap';
  if (gap === 3) return 'two-gap';
  return 'wide';
}

/**
 * Order is significant: a paired monotone flop is filed under `paired` because that is the feature
 * that moves the strategy. `other` exists so an unclassifiable board is visible rather than
 * silently absorbed into a class the bank never solved.
 */
export function boardTextureOf(board: readonly Card[]): BoardTexture {
  if (board.length === 0) return 'preflop';
  const flop = board.slice(0, 3);
  if (flop.length < 3) return 'other';
  const ranks = flop.map(rankValue);
  const suits = flop.map(suitOf);
  if (new Set(ranks).size < 3) return 'paired';
  if (new Set(suits).size === 1) return 'monotone';
  const high = Math.max(...ranks);
  const low = Math.min(...ranks);
  const value = (rank: Rank): number => RANKS.indexOf(rank);
  const broadway = ranks.filter((r) => r >= value('T')).length;
  if (broadway >= 2 && new Set(suits).size === 2) return 'broadway-two-tone';
  if (high <= value('9') && high - low <= 4) return 'low-connected';
  if (high === value('A')) return 'dry-ace-high';
  if (high === value('K')) return 'dry-king-high';
  return 'other';
}

/** Buckets to B5's solved depths; the midpoints are where a spot stops playing like the shallower one. */
export function stackDepthOf(effectiveStackBb: number): StackDepth {
  if (effectiveStackBb <= 70) return 'bb40';
  if (effectiveStackBb <= 150) return 'bb100';
  return 'bb200';
}

export function featuresOf(spot: ContrastSpot): SpotFeatures {
  return {
    suitedness: suitednessOf(spot.hole),
    kickerGap: gapBandOf(spot.hole),
    position: spot.position,
    playersBehind: playersBehind(spot),
    rangeAsymmetry: spot.rangeAsymmetry,
    boardTexture: boardTextureOf(spot.board),
    stackDepth: stackDepthOf(spot.effectiveStackBb),
  };
}

export function differingAxes(a: SpotFeatures, b: SpotFeatures): ContrastAxis[] {
  return CONTRAST_AXES.filter((axis) => a[axis] !== b[axis]);
}

/** Hamming distance over the seven-variable vector. The spec's oracle (test matrix line for B6). */
export function hammingDistance(a: SpotFeatures, b: SpotFeatures): number {
  return differingAxes(a, b).length;
}

// ── Honest coverage (B6) ─────────────────────────────────────────────────────

export interface AxisAvailability {
  readonly available: boolean;
  /** Stated in full because "unavailable" without a reason reads as a bug rather than a boundary. */
  readonly reason: string;
}

export const AXIS_AVAILABILITY: Readonly<Record<ContrastAxis, AxisAvailability>> = {
  suitedness: { available: true, reason: 'two levels, suited and offsuit' },
  kickerGap: { available: true, reason: 'five gap bands, enough for a four-spot set' },
  position: { available: true, reason: 'four seats on the 4-max table' },
  playersBehind: { available: true, reason: 'up to three opponents behind hero on a 4-max table' },
  rangeAsymmetry: {
    available: false,
    reason: 'asymmetry is a property of the two ranges at the node, and core holds no ranges',
  },
  boardTexture: {
    available: false,
    reason: 'B6: a texture neighbour needs a separately solved tree, and this build has no solver',
  },
  stackDepth: {
    available: false,
    reason: 'B6: a depth neighbour needs a separately solved tree, and this build has no solver',
  },
};

export const PRODUCIBLE_AXES: readonly ContrastAxis[] = CONTRAST_AXES.filter(
  (axis) => AXIS_AVAILABILITY[axis].available,
);

/**
 * Ceiling on spots per set, from the table geometry — not from thin content, so no amount of
 * authoring lifts it. Only `kickerGap` reaches user story 19's four.
 *
 * `position`: four seats, but holding players-behind fixed while moving hero costs one — with one
 * live villain and hero acting first, only the seats with a villain still behind them qualify.
 * `playersBehind`: hero's own seat fixes how many opponents *can* sit behind, so on 4-max the count
 * ranges over at most three values and the base already occupies one of them.
 */
export const AXIS_MAX_SET_SIZE: Readonly<Record<ContrastAxis, number>> = {
  suitedness: 2,
  kickerGap: 5,
  position: 3,
  playersBehind: 3,
  rangeAsymmetry: 0,
  boardTexture: 0,
  stackDepth: 0,
};

// ── Engine construction ──────────────────────────────────────────────────────

export type BuildResult =
  | { readonly ok: true; readonly state: TableState }
  | { readonly ok: false; readonly reason: string };

function dealOff(deck: Card[], cards: readonly Card[]): { rest: Card[] } | { reason: string } {
  const rest = [...deck];
  for (const card of cards) {
    const at = rest.indexOf(card);
    if (at === -1) return { reason: `card unavailable or dealt twice: ${card}` };
    rest.splice(at, 1);
  }
  return { rest };
}

const chipTotal = (state: TableState): number =>
  state.seats.reduce((sum, seat) => sum + seat.stack, 0) + state.pot;

const BOARD_LENGTH: Readonly<Record<Street, number>> = {
  preflop: 0,
  flop: 3,
  turn: 4,
  river: 5,
  showdown: 5,
};

/**
 * Deals the spot on the real engine and returns the state a renderer would draw.
 *
 * Placed, not replayed: no action sequence is guaranteed to reach an arbitrary mid-hand pot, so the
 * hand is started for real — which is what checks the button/blind mapping against the engine — and
 * the spot is then written onto that state and handed back to legalActions/applyAction for
 * judgement. Anything the engine will not accept is reported, not patched.
 */
export function buildSpot(spot: ContrastSpot): BuildResult {
  if (spot.hole.length !== 2) return { ok: false, reason: `hole has ${spot.hole.length} cards` };
  if (spot.board.length !== BOARD_LENGTH[spot.street]) {
    return { ok: false, reason: `${spot.street} wants ${BOARD_LENGTH[spot.street]} board cards` };
  }
  if (spot.villainPositions.length < 1 || spot.villainPositions.length > TABLE_SEATS - 1) {
    return { ok: false, reason: `${spot.villainPositions.length} live villains on a 4-max table` };
  }
  if (new Set(spot.villainPositions).size !== spot.villainPositions.length) {
    return { ok: false, reason: 'two villains on one seat' };
  }
  if (spot.villainPositions.includes(spot.position)) {
    return { ok: false, reason: 'a villain occupies hero’s seat' };
  }

  const dealt = dealOff(freshDeck(), [...spot.hole, ...spot.board]);
  if ('reason' in dealt) return { ok: false, reason: dealt.reason };

  const heroSeat = 0;
  const dealer = (heroSeat - OFFSET_FROM_BUTTON[spot.position] + TABLE_SEATS) % TABLE_SEATS;
  const heroStack = Math.round(spot.effectiveStackBb * spot.bb);
  // Every seat needs chips at deal time: startHand sits a chipless seat out, which would move the
  // button and put the blinds somewhere the position mapping does not claim.
  const buildStack = heroStack + Math.round(spot.potBb * spot.bb) + spot.bb * 4;

  let state: TableState;
  try {
    const fresh = createTable({
      seats: Array.from({ length: TABLE_SEATS }, (_, i) => ({
        name: i === heroSeat ? 'Hero' : `V${i}`,
        stack: buildStack,
        isHero: i === heroSeat,
      })),
      sb: spot.bb / 2,
      bb: spot.bb,
      seed: 1,
    });
    // startHand rotates the button one seat left, so seed it one seat behind the target.
    fresh.dealer = (dealer - 1 + TABLE_SEATS) % TABLE_SEATS;
    state = startHand(fresh);
  } catch (err) {
    return { ok: false, reason: `engine threw on deal: ${String(err)}` };
  }

  if (state.dealer !== dealer) {
    return { ok: false, reason: `button landed on seat ${state.dealer}, wanted ${dealer}` };
  }
  const seatOf = (p: ContrastPosition): number => (dealer + OFFSET_FROM_BUTTON[p]) % TABLE_SEATS;
  if (state.seats[seatOf('SB')].committed !== spot.bb / 2) {
    return { ok: false, reason: 'small blind did not land where the position mapping says' };
  }
  if (state.seats[seatOf('BB')].committed !== spot.bb) {
    return { ok: false, reason: 'big blind did not land where the position mapping says' };
  }

  const liveSeats = new Set([heroSeat, ...spot.villainPositions.map(seatOf)]);
  const rest = [...dealt.rest];
  state.board = [...spot.board];
  state.street = spot.street;
  state.toAct = heroSeat;
  state.seats.forEach((seat, i) => {
    seat.folded = !liveSeats.has(i);
    seat.allIn = false;
    // Villain cards come off the same deck the hero cards were removed from, which is what makes
    // "no duplicate card" a fact about the deal rather than an assertion about the author.
    seat.hole = seat.folded ? [] : i === heroSeat ? [...spot.hole] : [rest.pop()!, rest.pop()!];
  });
  state.deck = rest;

  if (spot.street === 'preflop') {
    // The blinds are the pot preflop, so committed stays as startHand posted it and the effective
    // stack is split between what is behind and what is already in front of each seat.
    if (heroStack <= spot.bb) {
      return { ok: false, reason: `effective stack ${heroStack} does not cover the big blind` };
    }
    state.seats.forEach((seat) => {
      seat.stack = seat.folded ? 0 : heroStack - seat.committed;
    });
  } else {
    state.pot = Math.round(spot.potBb * spot.bb);
    state.currentBet = 0;
    state.minRaise = spot.bb;
    state.lastAggressor = null;
    state.seats.forEach((seat) => {
      seat.committed = 0;
      seat.stack = seat.folded ? 0 : heroStack;
    });
  }

  const legal = legalActions(state);
  const wanted: ActionKind = legal.includes('check') ? 'check' : 'call';
  if (!legal.includes(wanted)) {
    return { ok: false, reason: `engine offers [${legal.join(', ')}], no ${wanted} for hero` };
  }
  const before = chipTotal(state);
  try {
    const after = applyAction(state, { kind: wanted });
    if (chipTotal(after) !== before) {
      return { ok: false, reason: `chips changed on ${wanted}: ${before} to ${chipTotal(after)}` };
    }
  } catch (err) {
    return { ok: false, reason: `engine threw on ${wanted}: ${String(err)}` };
  }

  return { ok: true, state };
}

/** Duplicate cards are the one deal bug that renders as a plausible screen, so it gets its own check. */
export function duplicateCards(state: TableState): Card[] {
  const seen = new Set<Card>();
  const dupes: Card[] = [];
  for (const card of [...state.board, ...state.seats.flatMap((seat) => seat.hole)]) {
    if (seen.has(card)) dupes.push(card);
    seen.add(card);
  }
  return dupes;
}

// ── Variant candidates, one axis at a time ───────────────────────────────────

function holeCandidates(
  board: readonly Card[],
  suitedness: Suitedness,
  gap: GapBand,
): Card[][] {
  const available = freshDeck().filter((card) => !board.includes(card));
  const combos: Card[][] = [];
  for (let i = 0; i < available.length; i++) {
    for (let j = i + 1; j < available.length; j++) {
      const hole = [available[i], available[j]];
      if (suitednessOf(hole) === suitedness && gapBandOf(hole) === gap) combos.push(hole);
    }
  }
  return combos;
}

const pick = <T,>(items: readonly T[], rng: Rng): T => items[Math.floor(rng() * items.length)];

/** Every non-empty seating of live villains that leaves hero's own seat free. */
function villainPlacements(hero: ContrastPosition): ContrastPosition[][] {
  const others = POSITIONS.filter((p) => p !== hero);
  const placements: ContrastPosition[][] = [];
  for (let mask = 1; mask < 1 << others.length; mask++) {
    placements.push(others.filter((_, i) => (mask >> i) & 1));
  }
  return placements;
}

/**
 * Candidate one-variable neighbours on `axis`, one per level of that axis other than the base's.
 * Nothing else in the vector is allowed to move, which is why position variants must re-seat the
 * villains to hold players-behind fixed and hole-card variants must preserve the other card
 * property. A level with no realisation simply does not appear.
 */
function neighboursOn(base: ContrastSpot, axis: ContrastAxis, rng: Rng): ContrastSpot[] {
  const features = featuresOf(base);

  if (axis === 'suitedness') {
    const flipped: Suitedness = features.suitedness === 'suited' ? 'offsuit' : 'suited';
    const combos = holeCandidates(base.board, flipped, features.kickerGap);
    return combos.length === 0 ? [] : [{ ...base, hole: pick(combos, rng) }];
  }

  if (axis === 'kickerGap') {
    const spots: ContrastSpot[] = [];
    for (const band of GAP_BANDS) {
      if (band === features.kickerGap) continue;
      const combos = holeCandidates(base.board, features.suitedness, band);
      if (combos.length > 0) spots.push({ ...base, hole: pick(combos, rng) });
    }
    return spots;
  }

  if (axis === 'position') {
    const spots: ContrastSpot[] = [];
    for (const position of POSITIONS) {
      if (position === features.position) continue;
      // Villain count is held too: a variant that also drops an opponent is a different spot even
      // though "opponents in the hand" is not one of the seven axes.
      const seatings = villainPlacements(position).filter(
        (villains) =>
          villains.length === base.villainPositions.length &&
          playersBehind({ ...base, position, villainPositions: villains }) ===
            features.playersBehind,
      );
      if (seatings.length > 0) {
        spots.push({ ...base, position, villainPositions: pick(seatings, rng) });
      }
    }
    return spots;
  }

  if (axis === 'playersBehind') {
    const byCount = new Map<number, ContrastPosition[][]>();
    for (const villains of villainPlacements(features.position)) {
      const behind = playersBehind({ ...base, villainPositions: villains });
      if (behind === features.playersBehind) continue;
      byCount.set(behind, [...(byCount.get(behind) ?? []), villains]);
    }
    return [...byCount.keys()]
      .sort((a, b) => a - b)
      .map((behind) => ({ ...base, villainPositions: pick(byCount.get(behind)!, rng) }));
  }

  // rangeAsymmetry, boardTexture, stackDepth: declared unavailable above, so no candidates exist.
  return [];
}

// ── Generation ───────────────────────────────────────────────────────────────

export interface ContrastVariant {
  readonly spot: ContrastSpot;
  readonly features: SpotFeatures;
  /** The dealt position, straight off table.ts. */
  readonly state: TableState;
}

export interface ContrastSet {
  readonly conceptId: string;
  readonly axis: ContrastAxis;
  readonly base: ContrastVariant;
  /** Each at Hamming distance exactly 1 from `base`, all differing on `axis`. */
  readonly variants: readonly ContrastVariant[];
}

export interface ContrastFailure {
  readonly ok: false;
  readonly axis: ContrastAxis;
  /** Logged so the un-remediated concept is attributable rather than silently dropped. */
  readonly conceptId: string;
  readonly reason: string;
  /** S2 keeps remediation alive when the grid cannot: a worked example, never a looser set. */
  readonly fallback: 'worked-example';
}

export type ContrastSetResult = { readonly ok: true; readonly set: ContrastSet } | ContrastFailure;

/** Four spots including the base, per user story 19. */
export const DEFAULT_SET_SIZE = 4;

const toVariant = (spot: ContrastSpot): ContrastVariant | string => {
  const built = buildSpot(spot);
  if (!built.ok) return built.reason;
  const dupes = duplicateCards(built.state);
  if (dupes.length > 0) return `duplicate card dealt: ${dupes.join(', ')}`;
  return { spot, features: featuresOf(spot), state: built.state };
};

/**
 * `size` spots total (base included) differing only on `axis`.
 *
 * Failure is a value, not an exception, because the caller's job is to fall back to a worked
 * example — but an emitted set that breaks the one-variable rule *is* thrown, because that is this
 * module being wrong rather than the grid being thin.
 */
export function generateContrastSet(
  base: ContrastSpot,
  axis: ContrastAxis,
  opts: { readonly seed: number; readonly size?: number },
): ContrastSetResult {
  const size = opts.size ?? DEFAULT_SET_SIZE;
  const fail = (reason: string): ContrastFailure => ({
    ok: false,
    axis,
    conceptId: base.conceptId,
    reason,
    fallback: 'worked-example',
  });

  if (size < 2) return fail(`set size ${size} is not a contrast`);
  if (!AXIS_AVAILABILITY[axis].available) {
    return fail(`axis ${axis} is not available: ${AXIS_AVAILABILITY[axis].reason}`);
  }

  const baseVariant = toVariant(base);
  if (typeof baseVariant === 'string') return fail(`base spot is not dealable: ${baseVariant}`);

  const rng = mulberry32(opts.seed);
  const variants: ContrastVariant[] = [];
  const rejected: string[] = [];
  for (const candidate of neighboursOn(base, axis, rng)) {
    const variant = toVariant(candidate);
    if (typeof variant === 'string') {
      rejected.push(variant);
      continue;
    }
    variants.push(variant);
    if (variants.length === size - 1) break;
  }

  if (variants.length < size - 1) {
    const ceiling =
      size > AXIS_MAX_SET_SIZE[axis] ? `; axis tops out at ${AXIS_MAX_SET_SIZE[axis]} spots` : '';
    const detail = rejected.length > 0 ? `; undealable: ${rejected.join('; ')}` : '';
    return fail(
      `axis ${axis} yields ${variants.length} one-variable neighbour(s), need ${size - 1}` +
        `${ceiling}${detail}`,
    );
  }

  const set: ContrastSet = { conceptId: base.conceptId, axis, base: baseVariant, variants };
  assertSingleVariable(set);
  return set.variants.length === size - 1 ? { ok: true, set } : fail('internal size mismatch');
}

/**
 * The invariant, checked on the way out. A pair differing on two axes would teach the wrong rule,
 * so it must never leave this module — including as a "close enough" set.
 */
export function assertSingleVariable(set: ContrastSet): void {
  const members = [set.base, ...set.variants];
  for (const variant of set.variants) {
    const axes = differingAxes(set.base.features, variant.features);
    if (axes.length !== 1 || axes[0] !== set.axis) {
      throw new Error(
        `contrast set for ${set.conceptId} on ${set.axis} differs on [${axes.join(', ')}]`,
      );
    }
  }
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const axes = differingAxes(members[i].features, members[j].features);
      if (axes.length > 1) {
        throw new Error(
          `contrast set for ${set.conceptId} has a two-variable pair on [${axes.join(', ')}]`,
        );
      }
    }
  }
}

/**
 * Largest honest set size per axis for this base — 0 where the axis is unavailable, 1 where the base
 * is dealable but has no neighbour. This is what a caller offers the learner: the generator only
 * offers toggles that exist (B6).
 */
export function axisCoverage(
  base: ContrastSpot,
  seed: number,
): Readonly<Record<ContrastAxis, number>> {
  const coverage = {} as Record<ContrastAxis, number>;
  const baseDealable = typeof toVariant(base) !== 'string';
  for (const axis of CONTRAST_AXES) {
    if (!AXIS_AVAILABILITY[axis].available || !baseDealable) {
      coverage[axis] = 0;
      continue;
    }
    const rng = mulberry32(seed);
    const dealable = neighboursOn(base, axis, rng).filter(
      (spot) => typeof toVariant(spot) !== 'string',
    );
    coverage[axis] = 1 + dealable.length;
  }
  return coverage;
}
