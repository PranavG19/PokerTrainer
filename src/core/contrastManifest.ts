/**
 * THE CONTRAST-AXIS MANIFEST AND THE REMEDIATION FLOOR — PRODUCT-SPEC B6, S2, and the T2 row of G1.
 *
 * src/core/contrast.ts can build a one-variable set around any base spot. It cannot know WHICH base
 * spots the build committed to, and B6 is explicit that this is not a search: "the build takes an
 * explicit contrast-axis manifest: for each concept, the base node plus the specific one-variable
 * neighbours required". So the grid is authored data, here, and the generator is asked only for the
 * neighbours the manifest names.
 *
 * WHY THE MANIFEST DOES NOT ALWAYS ASK FOR FOUR SPOTS. Story 19 wants four variants. contrast.ts
 * proves that only `kickerGap` reaches four on a 4-max table, and refuses to pad a set with a
 * repeated level. So `remediate` asks each axis for the largest set that axis can honestly fill for
 * that base (axisCoverage), capped at four. A three-spot set on `position` is not a degraded
 * four-spot set; it is the whole axis.
 *
 * S2 IS A FLOOR, NOT A PREFERENCE. "Never cut remediation below one contrast set (an un-remediated
 * T2 is worse than an ungraded one, because it enters the spacing queue without a repair)." A
 * concept whose manifested axes all turn out to be unbuildable therefore does not return nothing —
 * it returns B6's runtime fallback, a worked example, with the reasons the sets could not be built
 * carried alongside so the miss is attributable rather than silent. `assertRemediationFloor` makes
 * that structural: no remediation can leave this module carrying zero repairs.
 *
 * THE RARE CASE IS AUTHORED AS RARE. One of the entries below (`flop-cbet-size-by-texture`) asks
 * only for a board-texture neighbour, which B6 says needs a separately solved tree and this build
 * has no solver for. It is in the manifest precisely because the fallback must exist and be
 * exercised; it is one entry out of six because B6 says the fallback is the rare case.
 */

import type { HandRecord } from './session.js';
import { remediationDays } from './schedule.js';
import {
  AXIS_AVAILABILITY,
  DEFAULT_SET_SIZE,
  axisCoverage,
  generateContrastSet,
  type ContrastAxis,
  type ContrastSet,
  type ContrastSpot,
} from './contrast.js';

export interface ManifestEntry {
  readonly conceptId: string;
  readonly title: string;
  /** B5's node families, so the learner can see which part of the bank this repair sits in. */
  readonly nodeFamily: string;
  /**
   * The coach principle whose T2 grade fires this repair. Matches coach.ts's `principle` strings,
   * which is what the session log stores — see `t2LeaksFrom`.
   */
  readonly repairs: string;
  readonly base: ContrastSpot;
  /** B6's per-concept axis list: the one-variable neighbours this concept was built to need. */
  readonly axes: readonly ContrastAxis[];
  /**
   * S2's floor when the grid cannot deliver. Authored, never generated: a worked example is content,
   * and a generated one would be the "looser set" S2 exists to forbid. Three chunks ending in a next
   * action (G6).
   */
  readonly workedExample: readonly string[];
}

/**
 * The grid. Six concepts across B5's node families, each naming the axes its neighbours were built
 * for. Every base here is dealable on the real engine and every axis list is measured, not assumed —
 * tests/unit/contrastManifest.test.ts asserts both, so an entry that stops producing a repair is a
 * test failure rather than a blank screen.
 */
export const CONTRAST_MANIFEST: readonly ManifestEntry[] = [
  {
    conceptId: 'btn-srp-cbet',
    title: 'C-betting the button in a single-raised pot',
    nodeFamily: 'BTN-vs-BB SRP',
    repairs: 'ranges',
    base: {
      conceptId: 'btn-srp-cbet',
      hole: ['Ah', 'Kd'],
      board: ['7s', '2c', 'Td'],
      street: 'flop',
      position: 'BTN',
      villainPositions: ['BB'],
      effectiveStackBb: 100,
      potBb: 6,
      bb: 2,
      rangeAsymmetry: 'ip-favoured',
    },
    // players-behind is asked for and cannot be answered from this base: in position postflop,
    // nobody is behind, so the count is pinned. That is reported, not hidden.
    axes: ['kickerGap', 'suitedness', 'position', 'playersBehind'],
    workedExample: [
      'The button holds the range advantage on a low disconnected flop, so the small bet is a range bet, not a value bet.',
      'Ace-king has no fold equity to protect and no equity to deny, so its whole reason to bet is that the range in front of it folds too often.',
      'Next: re-decide this node, then say which card in the flop would make the bet worse.',
    ],
  },
  {
    conceptId: 'bb-defence-vs-cbet',
    title: 'Defending the big blind against a flop c-bet',
    nodeFamily: 'BB defence',
    repairs: 'pot odds',
    base: {
      conceptId: 'bb-defence-vs-cbet',
      hole: ['9h', '8h'],
      board: ['Th', '6d', '2c'],
      street: 'flop',
      position: 'BB',
      villainPositions: ['BTN'],
      effectiveStackBb: 100,
      potBb: 5,
      bb: 2,
      rangeAsymmetry: 'oop-favoured',
    },
    axes: ['playersBehind', 'position', 'suitedness', 'kickerGap'],
    workedExample: [
      'The price on a half-pot c-bet asks for one continue in four, and the big blind is the seat closing the action.',
      'Nine-eight suited on a ten-high flop continues on backdoor equity, not on the pair it does not have.',
      'Next: re-decide this node, then name the smallest bet you would still fold it to.',
    ],
  },
  {
    conceptId: 'sb-squeeze',
    title: 'Squeezing from the small blind over an open and a call',
    nodeFamily: 'SB squeeze',
    repairs: 'ranges',
    base: {
      conceptId: 'sb-squeeze',
      hole: ['Ac', 'Qd'],
      board: [],
      street: 'preflop',
      position: 'SB',
      villainPositions: ['CO', 'BTN'],
      effectiveStackBb: 100,
      potBb: 0,
      bb: 2,
      rangeAsymmetry: 'symmetric',
    },
    axes: ['suitedness', 'kickerGap', 'playersBehind'],
    workedExample: [
      'A squeeze prices two ranges at once, so the size is set by the caller behind rather than by the opener.',
      'Ace-queen offsuit squeezes for value against a cold-calling range and turns into a bluff-catcher when it only calls.',
      'Next: re-decide this node, then say which seat calling would make the squeeze worse.',
    ],
  },
  {
    conceptId: 'turn-probe',
    title: 'Probing the turn after the flop went checked through',
    nodeFamily: 'turn probe',
    repairs: 'value or bluff',
    base: {
      conceptId: 'turn-probe',
      hole: ['Jc', '9d'],
      board: ['7s', '2c', 'Td', '4h'],
      street: 'turn',
      position: 'BB',
      villainPositions: ['CO', 'BTN'],
      effectiveStackBb: 100,
      potBb: 14,
      bb: 2,
      rangeAsymmetry: 'symmetric',
    },
    axes: ['kickerGap', 'suitedness', 'playersBehind'],
    workedExample: [
      'A flop that checked through leaves the strongest hands out of both ranges, which is what makes the turn a probing spot.',
      'Jack-nine on a turned four has a gutshot and two overcards to the low cards, so it bets as a semi-bluff and folds to a raise.',
      'Next: re-decide this node, then name the turn card that would stop you probing.',
    ],
  },
  {
    conceptId: 'river-bluff-catch',
    title: 'Catching a river bluff out of position',
    nodeFamily: 'river bluff-catch',
    repairs: 'pot odds',
    base: {
      conceptId: 'river-bluff-catch',
      hole: ['Ac', '3d'],
      board: ['7s', '2c', 'Td', '4h', 'Qs'],
      street: 'river',
      position: 'SB',
      villainPositions: ['BTN'],
      effectiveStackBb: 100,
      potBb: 30,
      bb: 2,
      rangeAsymmetry: 'ip-favoured',
    },
    axes: ['kickerGap', 'suitedness', 'position'],
    workedExample: [
      'A river call is a price question about one range, because no equity can be realised after it.',
      'Ace-three is a pure bluff-catcher: it beats every bluff and loses to every value bet, so only the frequency of bluffs matters.',
      'Next: re-decide this node, then say how often the bet must be a bluff for the call to break even.',
    ],
  },
  {
    conceptId: 'flop-cbet-size-by-texture',
    title: 'Choosing the c-bet size from the flop texture',
    nodeFamily: 'BTN-vs-BB SRP',
    repairs: 'value or bluff',
    base: {
      conceptId: 'flop-cbet-size-by-texture',
      hole: ['Kh', 'Qh'],
      board: ['Ks', '8d', '3c'],
      street: 'flop',
      position: 'BTN',
      villainPositions: ['BB'],
      effectiveStackBb: 100,
      potBb: 6,
      bb: 2,
      rangeAsymmetry: 'ip-favoured',
    },
    /**
     * The rare case, and it is honest rather than contrived: the only neighbour that teaches this
     * concept is the same node on a different texture, and B6 says a texture neighbour needs a
     * separately solved tree. This build has no solver, so the set cannot be built and the learner
     * gets B6's worked-example fallback instead of a set that moved two variables.
     */
    axes: ['boardTexture', 'stackDepth'],
    workedExample: [
      'Size follows how much of the range wants to keep betting: a flop that hits the whole range takes a small bet, a flop that splits it takes a large one.',
      'King-queen on a king-high dry flop is the top of a range that is nearly all continuing, so a third of the pot asks the right question of every worse hand.',
      'Next: re-decide this node, then say what the same hand should bet on a monotone flop and why the number moved.',
    ],
  },
];

export function manifestEntry(conceptId: string): ManifestEntry | undefined {
  return CONTRAST_MANIFEST.find((entry) => entry.conceptId === conceptId);
}

/** One manifested axis, resolved against what the generator can actually build for this base. */
export interface AxisOffer {
  readonly axis: ContrastAxis;
  /** `null` when the axis could not be built; `reason` then says why, in full. */
  readonly set: ContrastSet | null;
  /** Spots including the base. 1 means the base stands alone, which is not a contrast. */
  readonly spots: number;
  readonly reason: string;
}

export interface Remediation {
  readonly conceptId: string;
  /** 'worked-example' only when no manifested axis could be built — B6's rare case. */
  readonly kind: 'contrast-sets' | 'worked-example';
  /** Every manifested axis, buildable or not, in manifest order. Nothing is dropped. */
  readonly offers: readonly AxisOffer[];
  /** Present exactly when `kind` is 'worked-example'. S2's floor made concrete. */
  readonly fallback: { readonly steps: readonly string[]; readonly reason: string } | null;
  /** The T2 row: the repair enters the spacing queue. Days from schedule.remediationDays(). */
  readonly repairDays: readonly number[];
}

/**
 * Resolves one manifest entry into what the learner can actually be shown.
 *
 * Each axis is asked for the largest set it can honestly fill for this base, capped at story 19's
 * four. An axis that cannot reach two spots is reported with the generator's own reason rather than
 * quietly omitted (B6: "per-concept coverage is honest"), and an axis unavailable in this build
 * carries AXIS_AVAILABILITY's stated reason.
 */
export function remediate(entry: ManifestEntry, seed: number): Remediation {
  const coverage = axisCoverage(entry.base, seed);
  const offers: AxisOffer[] = entry.axes.map((axis) => {
    if (!AXIS_AVAILABILITY[axis].available) {
      return { axis, set: null, spots: 0, reason: AXIS_AVAILABILITY[axis].reason };
    }
    const size = Math.min(DEFAULT_SET_SIZE, coverage[axis]);
    if (size < 2) {
      return {
        axis,
        set: null,
        spots: coverage[axis],
        reason: `this base has no one-variable neighbour on ${axis}, so a pair would have to move a second variable`,
      };
    }
    const result = generateContrastSet(entry.base, axis, { seed, size });
    return result.ok
      ? { axis, set: result.set, spots: size, reason: '' }
      : { axis, set: null, spots: coverage[axis], reason: result.reason };
  });

  const built = offers.filter((offer) => offer.set !== null);
  if (built.length > 0) {
    return {
      conceptId: entry.conceptId,
      kind: 'contrast-sets',
      offers,
      fallback: null,
      repairDays: remediationDays(),
    };
  }

  const remediation: Remediation = {
    conceptId: entry.conceptId,
    kind: 'worked-example',
    offers,
    fallback: {
      steps: entry.workedExample,
      // Every reason, not the first: which axes were tried is the attributable part of the miss.
      reason: offers.map((offer) => `${offer.axis}: ${offer.reason}`).join('; '),
    },
    repairDays: remediationDays(),
  };
  assertRemediationFloor(remediation);
  return remediation;
}

/**
 * S2, checked on the way out. A remediation carrying neither a set nor a worked example would send
 * an un-remediated T2 into the spacing queue, which S2 says is worse than never grading it at all.
 * So it is a thrown error here rather than an empty panel on screen.
 */
export function assertRemediationFloor(remediation: Remediation): void {
  const sets = remediation.offers.filter((offer) => offer.set !== null).length;
  if (sets === 0 && (remediation.fallback === null || remediation.fallback.steps.length === 0)) {
    throw new Error(
      `remediation for ${remediation.conceptId} carries no repair: S2 forbids cutting below one contrast set`,
    );
  }
  if (remediation.kind === 'contrast-sets' && sets === 0) {
    throw new Error(`remediation for ${remediation.conceptId} claims sets it does not have`);
  }
  if (remediation.kind === 'worked-example' && sets > 0) {
    throw new Error(
      `remediation for ${remediation.conceptId} fell back to a worked example while ${sets} set(s) were buildable`,
    );
  }
}

/**
 * A T2 leak in the session log, by the principle it was tagged with.
 *
 * G1's T2 band is the one that gets an end-of-block correction rather than an interrupt, and in this
 * build that band is coach.ts's `notable` severity (0.5–2.0 bb): 'free' is silent (T0/T1) and
 * 'serious' is the interrupt band (T3+). The mapping is coarse because this build grades in bb and
 * has no per-street pot fractions, and it is stated here rather than assumed anywhere else.
 */
export const T2_SEVERITY = 'notable';

export interface T2Leak {
  readonly principle: string;
  readonly count: number;
  readonly costBb: number;
}

/** Ranked by total cost, because what to repair first is the most expensive leak, not the commonest. */
export function t2LeaksFrom(hands: readonly HandRecord[]): T2Leak[] {
  const byPrinciple = new Map<string, { count: number; costBb: number }>();
  for (const hand of hands) {
    for (const grade of hand.grades) {
      if (grade.severity !== T2_SEVERITY) continue;
      const seen = byPrinciple.get(grade.principle) ?? { count: 0, costBb: 0 };
      byPrinciple.set(grade.principle, {
        count: seen.count + 1,
        costBb: seen.costBb + grade.evLossBb,
      });
    }
  }
  return [...byPrinciple.entries()]
    .map(([principle, tally]) => ({ principle, count: tally.count, costBb: tally.costBb }))
    .sort((a, b) => b.costBb - a.costBb || a.principle.localeCompare(b.principle));
}

export interface QueueEntry {
  readonly entry: ManifestEntry;
  /** The T2 leak that fired this repair, or `null` when nothing in the log has fired it yet. */
  readonly firedBy: T2Leak | null;
}

/**
 * The remediation queue: concepts fired by a T2 leak first, most expensive leak first, then the rest
 * in manifest order.
 *
 * Unfired concepts stay in the list rather than being hidden, because N1 locks nothing — a learner
 * may work any repair at any time — and because hiding them would make an empty log look like an
 * empty product.
 */
export function remediationQueue(hands: readonly HandRecord[]): QueueEntry[] {
  const leaks = t2LeaksFrom(hands);
  const rank = new Map(leaks.map((leak, index) => [leak.principle, index]));
  const fired = CONTRAST_MANIFEST.filter((entry) => rank.has(entry.repairs));
  const rest = CONTRAST_MANIFEST.filter((entry) => !rank.has(entry.repairs));
  return [
    ...fired
      .slice()
      .sort((a, b) => (rank.get(a.repairs) ?? 0) - (rank.get(b.repairs) ?? 0))
      .map((entry) => ({
        entry,
        firedBy: leaks.find((leak) => leak.principle === entry.repairs) ?? null,
      })),
    ...rest.map((entry) => ({ entry, firedBy: null })),
  ];
}
