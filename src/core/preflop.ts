/**
 * PREFLOP BLUEPRINT — PRODUCT-SPEC N3 and B3.
 *
 * This is deliberately a COARSE PURIFIED blueprint, not a fine memorised chart, and the coarseness
 * is the design rather than a limitation. B3: a finer memorised blueprint directly cannibalises the
 * re-solving skill that is the actual target, so the blueprint stops at six ordered hand classes,
 * three verbal threshold rules per position, and the ~12 boundary combos that actually flip the
 * decision. N3 renders that compressed form first and the 13x13 grid beside it as the reference
 * expansion — so all 169 cells stay visible, but the organising principle arrives with them.
 *
 * Two consequences of the coarseness, stated rather than hidden:
 *
 * NO FREQUENCIES. Every range here is pure open-or-fold. The spec's own objection to trainers is
 * that the solver's frequencies are the most abstraction-overfit part of its output, so a "62% open"
 * cell would be exactly the fact that is not worth storing. Where a published range mixes, this
 * blueprint rounds the cell to whole in or whole out.
 *
 * RANGES ARE GENERATED FROM THE SAME THRESHOLDS THE RULES STATE. `RFI_SPECS` is a per-high-card
 * kicker floor, not a list of 169 flags. That is not a compactness trick: it means the verbal rule
 * and the grid cannot drift apart, because the grid IS the rule expanded.
 *
 * Everything here is pure data plus total queries. There is no clock and no randomness in this
 * module, so no `now` or seed parameter is needed.
 *
 * PUBLISHED POSTURE (item 3 of the brief). The threshold shape follows the widely published 100bb
 * 6-max GTO-derived RFI family (Upswing / GTO Wizard style charts) rather than an older
 * "tight-is-right" or a modern hyper-aggressive one: all pocket pairs and all suited aces open from
 * every seat, offsuit hands need real high-card strength, and the button opens close to half. It is
 * then purified as described above. Resulting widths, combo-weighted: UTG 16%, HJ 21%, CO 27%,
 * SB 38%, BTN 44%.
 */

import { RANKS, rankOf, rankValue, suitOf, type Card, type Rank } from './cards.js';

/** Canonical starting-hand notation: "AA", "AKs", "AKo". Higher rank first, always. */
export type Combo = string;

/** Seat order, 6-max. */
export const POSITIONS = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const;
export type Position = (typeof POSITIONS)[number];

/**
 * The big blind has no raise-first-in node at all — if everyone folds to it the hand is already
 * over. Modelling BB with an empty RFI range rather than omitting the position keeps every query
 * total, and BB's rules and boundary combos are about DEFENCE instead (see `POSITION_RULES`).
 */
export const RFI_POSITIONS = ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const;
export type RfiPosition = (typeof RFI_POSITIONS)[number];

const rankIndex = (rank: Rank): number => RANKS.indexOf(rank);

interface ParsedCombo {
  readonly hi: Rank;
  readonly lo: Rank;
  readonly suited: boolean;
  readonly pair: boolean;
  /** 0 for a connector like 98s, 1 for a one-gapper like 97s. */
  readonly gap: number;
}

/** All 169 canonical combos, derived from RANKS — never a pasted list. Ordered strongest rank first. */
export const ALL_COMBOS: readonly Combo[] = (() => {
  const combos: Combo[] = [];
  for (let hi = RANKS.length - 1; hi >= 0; hi--) {
    combos.push(`${RANKS[hi]}${RANKS[hi]}`);
    for (let lo = hi - 1; lo >= 0; lo--) {
      combos.push(`${RANKS[hi]}${RANKS[lo]}s`);
      combos.push(`${RANKS[hi]}${RANKS[lo]}o`);
    }
  }
  return combos;
})();

const PARSED: ReadonlyMap<Combo, ParsedCombo> = (() => {
  const parsed = new Map<Combo, ParsedCombo>();
  for (const combo of ALL_COMBOS) {
    const hi = combo[0] as Rank;
    const lo = combo[1] as Rank;
    const pair = hi === lo;
    parsed.set(combo, {
      hi,
      lo,
      pair,
      suited: combo[2] === 's',
      gap: rankIndex(hi) - rankIndex(lo) - 1,
    });
  }
  return parsed;
})();

export const isCombo = (value: string): boolean => PARSED.has(value);

function parse(combo: Combo): ParsedCombo {
  const parsed = PARSED.get(combo);
  if (!parsed) throw new Error(`not a canonical starting hand: ${combo}`);
  return parsed;
}

/** Two real cards to the combo they collapse to. The bridge between the engine and this blueprint. */
export function comboOf(a: Card, b: Card): Combo {
  const [hi, lo] = rankValue(a) >= rankValue(b) ? [a, b] : [b, a];
  if (rankOf(hi) === rankOf(lo)) return `${rankOf(hi)}${rankOf(lo)}`;
  return `${rankOf(hi)}${rankOf(lo)}${suitOf(hi) === suitOf(lo) ? 's' : 'o'}`;
}

/** How many of the 1326 dealt combinations a cell stands for. Pairs 6, suited 4, offsuit 12. */
export function comboWeight(combo: Combo): number {
  const { pair, suited } = parse(combo);
  if (pair) return 6;
  return suited ? 4 : 12;
}

export const TOTAL_COMBINATIONS = 1326;

// ---------------------------------------------------------------------------
// Six ordered hand classes
// ---------------------------------------------------------------------------

export type HandClassId = 'premium' | 'strong' | 'broadway' | 'suited-ace' | 'speculative' | 'trash';

export interface HandClass {
  readonly id: HandClassId;
  /** The chunk name a learner says out loud. Six of these fit in working memory; 169 cells do not. */
  readonly label: string;
}

/**
 * Ordered strongest to weakest. The order is load-bearing twice over: it is the ranking a learner
 * recites, and it is what makes `classOf` total and single-valued — the first matching class wins,
 * and the last class matches everything. So a combo can never fall in two classes or in none.
 *
 * Class membership and RFI membership are independent axes on purpose. A `trash` cell can still be
 * a button open; the class says what the hand IS, the range says where it PLAYS.
 */
export const HAND_CLASSES: readonly HandClass[] = [
  { id: 'premium', label: 'premium — QQ+ and AK' },
  { id: 'strong', label: 'strong — JJ-88, AQ, AJs, KQs' },
  { id: 'broadway', label: 'broadway — two cards ten or better' },
  { id: 'suited-ace', label: 'suited ace — nut blocker, thin kicker' },
  { id: 'speculative', label: 'speculative — small pairs, suited connectors' },
  { id: 'trash', label: 'trash — no pair, no suit, no connection' },
];

const CLASS_PREDICATES: readonly (readonly [HandClassId, (hand: ParsedCombo) => boolean])[] = [
  [
    'premium',
    (h) => (h.pair && rankIndex(h.hi) >= rankIndex('Q')) || (h.hi === 'A' && h.lo === 'K'),
  ],
  [
    'strong',
    (h) =>
      (h.pair && rankIndex(h.hi) >= rankIndex('8')) ||
      (h.hi === 'A' && h.lo === 'Q') ||
      (h.hi === 'A' && h.lo === 'J' && h.suited) ||
      (h.hi === 'K' && h.lo === 'Q' && h.suited),
  ],
  ['broadway', (h) => !h.pair && rankIndex(h.lo) >= rankIndex('T')],
  ['suited-ace', (h) => h.suited && h.hi === 'A'],
  ['speculative', (h) => h.pair || (h.suited && h.gap <= 1)],
  ['trash', () => true],
];

/** Total: every one of the 169 combos resolves to exactly one class. Throws only off-domain. */
export function classOf(combo: Combo): HandClassId {
  const hand = parse(combo);
  for (const [id, matches] of CLASS_PREDICATES) {
    if (matches(hand)) return id;
  }
  // Unreachable: the last predicate is `() => true`. Kept so the compiler sees a total return.
  throw new Error(`unclassified combo: ${combo}`);
}

export function combosInClass(id: HandClassId): readonly Combo[] {
  return ALL_COMBOS.filter((combo) => classOf(combo) === id);
}

// ---------------------------------------------------------------------------
// RFI ranges
// ---------------------------------------------------------------------------

/**
 * A range as thresholds, not as flags. `suited`/`offsuit` map a high card to the LOWEST kicker
 * played with it; an absent high card means that row is folded entirely. Membership is therefore
 * monotonic within a row by construction, which is what makes the row statable in one clause.
 */
interface RfiSpec {
  readonly pairsDownTo: Rank;
  readonly suited: Partial<Record<Rank, Rank>>;
  readonly offsuit: Partial<Record<Rank, Rank>>;
}

const RFI_SPECS: Record<RfiPosition, RfiSpec> = {
  UTG: {
    pairsDownTo: '2',
    suited: { A: '2', K: 'T', Q: 'T', J: 'T', T: '9', '9': '8', '8': '7', '7': '6' },
    offsuit: { A: 'J', K: 'Q' },
  },
  HJ: {
    pairsDownTo: '2',
    suited: { A: '2', K: '9', Q: '9', J: '9', T: '8', '9': '7', '8': '7', '7': '6', '6': '5' },
    offsuit: { A: 'T', K: 'J', Q: 'J' },
  },
  CO: {
    pairsDownTo: '2',
    suited: {
      A: '2',
      K: '8',
      Q: '8',
      J: '8',
      T: '7',
      '9': '6',
      '8': '6',
      '7': '5',
      '6': '5',
      '5': '4',
    },
    offsuit: { A: '9', K: 'T', Q: 'T', J: 'T' },
  },
  BTN: {
    pairsDownTo: '2',
    suited: {
      A: '2',
      K: '2',
      Q: '5',
      J: '6',
      T: '6',
      '9': '5',
      '8': '5',
      '7': '4',
      '6': '4',
      '5': '3',
      '4': '3',
    },
    offsuit: { A: '2', K: '8', Q: '9', J: '9', T: '9', '9': '8' },
  },
  // The small blind opens into one player, so it is wider than the cutoff; it plays every one of
  // those pots out of position and cannot see a free flop, so it is tighter than the button. Both
  // halves of that sit in the width ordering below.
  SB: {
    pairsDownTo: '2',
    suited: {
      A: '2',
      K: '2',
      Q: '5',
      J: '7',
      T: '7',
      '9': '6',
      '8': '5',
      '7': '5',
      '6': '4',
      '5': '4',
    },
    offsuit: { A: '2', K: '9', Q: 'T', J: 'T' },
  },
};

/** Widths in strictly increasing order. Getting this backwards teaches the exact opposite of play. */
export const RFI_WIDTH_ORDER = ['UTG', 'HJ', 'CO', 'SB', 'BTN'] as const;

export function isInRfiRange(combo: Combo, position: Position): boolean {
  const hand = parse(combo);
  if (position === 'BB') return false; // No first-in node exists for the big blind.
  const spec = RFI_SPECS[position];
  if (hand.pair) return rankIndex(hand.hi) >= rankIndex(spec.pairsDownTo);
  const floor = (hand.suited ? spec.suited : spec.offsuit)[hand.hi];
  if (floor === undefined) return false;
  return rankIndex(hand.lo) >= rankIndex(floor);
}

export function rfiCombos(position: Position): readonly Combo[] {
  return ALL_COMBOS.filter((combo) => isInRfiRange(combo, position));
}

/** Combo-weighted share of all 1326 hands, i.e. the number a chart calls "18.4%". */
export function rfiWidth(position: Position): number {
  const weighted = rfiCombos(position).reduce((sum, combo) => sum + comboWeight(combo), 0);
  return weighted / TOTAL_COMBINATIONS;
}

// ---------------------------------------------------------------------------
// Three verbal rules per position
// ---------------------------------------------------------------------------

export const MAX_RULE_WORDS = 12;

/**
 * N3's budget: three rules, each <= 12 words. The budget is the point — it is what makes a rule
 * chunkable against the six classes instead of a paragraph to re-read. Each position's three rules
 * split the same way: the pair-and-suited-ace spine, the suited widening, the offsuit threshold.
 */
export const POSITION_RULES: Record<Position, readonly [string, string, string]> = {
  UTG: [
    'Open all pairs and all suited aces, without exception.',
    'Suited broadways plus T9s; suited connectors only down to 76s.',
    'Offsuit needs AJo or KQo; fold everything weaker offsuit.',
  ],
  HJ: [
    'All pairs and all suited aces, same as under the gun.',
    'Suited kings, queens and jacks down to the nine kicker.',
    'Offsuit needs ATo, KJo or QJo; nothing weaker opens.',
  ],
  CO: [
    'All pairs and all suited aces still open, as always.',
    'Suited broadways down to eight; suited connectors down to 54s.',
    'Offsuit A9o, KTo, QTo and JTo; fold below those.',
  ],
  BTN: [
    'Every suited ace, every suited king, every pair opens.',
    'Suited hands down to 43s; almost any two suited play.',
    'All offsuit aces, K8o, Q9o, J9o, T9o, 98o.',
  ],
  SB: [
    'Raise or fold only; never limp the small blind.',
    'All pairs, all suited aces and kings, all offsuit aces.',
    'Tighter than button out of position: fold 43s, K8o, 98o.',
  ],
  BB: [
    'Big blind never opens; there is no first-in range.',
    'Defend wide versus a button open, the price is excellent.',
    'Three-bet premiums and suited wheel aces; call the rest.',
  ],
};

export const ruleWordCount = (rule: string): number => rule.trim().split(/\s+/).length;

// ---------------------------------------------------------------------------
// Boundary combos
// ---------------------------------------------------------------------------

/**
 * The ~12 per position that actually flip the decision, per N3. Each list straddles the frontier —
 * the thinnest hands still opened and the fattest ones already folded — because the interior of a
 * range teaches nothing, while a learner who knows which side K9s falls on has the whole row.
 *
 * BB is the exception, and honestly so: with no first-in range its boundaries are DEFENCE
 * boundaries against a button open, so every entry is out of the (empty) RFI range.
 */
export const BOUNDARY_COMBOS: Record<Position, readonly Combo[]> = {
  UTG: ['22', 'A2s', 'KTs', 'K9s', 'QTs', 'JTs', 'T9s', '76s', '65s', 'AJo', 'ATo', 'KQo'],
  HJ: ['K9s', 'K8s', 'Q9s', 'J9s', 'T8s', 'T7s', '97s', '65s', '54s', 'ATo', 'A9o', 'KTo'],
  CO: ['K8s', 'K7s', 'Q8s', 'J8s', 'T7s', '96s', '75s', '54s', 'A9o', 'A8o', 'KTo', 'K9o'],
  BTN: ['Q5s', 'Q4s', 'J6s', 'J5s', '43s', '32s', 'A2o', 'K8o', 'K7o', 'Q9o', 'Q8o', '98o'],
  SB: ['J7s', 'J6s', 'T7s', 'T6s', '54s', '43s', 'A2o', 'K9o', 'K8o', 'QTo', 'Q9o', 'T9o'],
  BB: ['K9o', 'Q9o', 'J9o', 'T8o', '97s', '86s', '75s', '64s', '54s', 'K5s', 'Q6s', '43s'],
};

const BOUNDARY_SETS: Record<Position, ReadonlySet<Combo>> = (() => {
  const sets = {} as Record<Position, ReadonlySet<Combo>>;
  for (const position of POSITIONS) sets[position] = new Set(BOUNDARY_COMBOS[position]);
  return sets;
})();

export function isBoundaryCombo(combo: Combo, position: Position): boolean {
  parse(combo); // Reject off-domain input here too, so all three queries agree on their domain.
  return BOUNDARY_SETS[position].has(combo);
}

// ---------------------------------------------------------------------------
// Combined query
// ---------------------------------------------------------------------------

export interface ComboVerdict {
  readonly combo: Combo;
  readonly position: Position;
  readonly handClass: HandClassId;
  readonly open: boolean;
  readonly boundary: boolean;
}

/** One call for the N3 juxtaposition view: what is this hand, does it open, is it a frontier cell. */
export function lookup(combo: Combo, position: Position): ComboVerdict {
  return {
    combo,
    position,
    handClass: classOf(combo),
    open: isInRfiRange(combo, position),
    boundary: isBoundaryCombo(combo, position),
  };
}
