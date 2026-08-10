import { describe, it, expect } from 'vitest';
import {
  ACCURACY_DROP_POINTS,
  BANKROLL_ABSENT,
  FIRST_EXPOSURE_RUNG,
  INTERLEAVING_PREFRAME,
  MAX_FADING_RUNG,
  MIN_INTERLEAVED_CLASSES,
  MODULES,
  assembleInterleavedBlock,
  blockingRequirement,
  indexContent,
  mayShareBlock,
  moduleById,
  moduleOfContent,
  partitionByModule,
  preframeOwed,
  similarity,
  type BlockItem,
  type BlockResult,
  type InterleavedBlock,
  type ModuleId,
} from '../../src/core/interleave.js';
import { MIN_GRADED_SPOTS } from '../../src/core/sessionPlan.js';
import { LESSONS } from '../../src/core/lessons/index.js';
import { CONTRAST_MANIFEST } from '../../src/core/contrastManifest.js';

/**
 * INTERLEAVING — PRODUCT-SPEC Q1, Q2, Q3.
 *
 * The expectations here come from the spec's sentences, not from what the module returns. Two
 * inversions are what this file exists to catch, and both are asserted in BOTH directions with
 * categories that genuinely differ:
 *
 *   1. HIGH between-category similarity licenses interleaving; LOW similarity forces blocking. A
 *      module with that backwards passes any test suite whose fixtures are symmetric, so every
 *      similarity assertion below names a concrete pair and states which way it goes.
 *   2. Q2's "blocking is also correct, and ONLY correct" in two cases. A module that blocks
 *      generously satisfies Q2's letter and deletes Q1, so the rung-2/high-similarity case asserts
 *      `mustBlock: false` and `mustInterleave: true` rather than merely "no error".
 */

/** Fail loudly rather than skipping: an unexpected refusal is a finding, not a pass. */
function blockOf(result: BlockResult, where: string): InterleavedBlock {
  if (!result.ok) throw new Error(`${where}: refused — [${result.refusal}] ${result.reason}`);
  return result.block;
}

function refusalOf(result: BlockResult, where: string) {
  if (result.ok) throw new Error(`${where}: expected a refusal, got a block of ${result.block.items.length}`);
  return result;
}

const spot = (spotClass: string, module: ModuleId, rung = 2): BlockItem => ({ spotClass, module, rung });

/**
 * Q1's own confusion set, verbatim from the spec: "K7s-CO / K7o-CO / K9s-CO / K7s-UTG /
 * K7s-vs-UTG-open" — plus two more RFI classes to reach Q1's floor of seven. Every class here is a
 * preflop hole-cards-and-a-seat decision, so the whole set is high-similarity and legal to mix.
 */
const CONFUSION_SET: readonly BlockItem[] = [
  spot('K7s-CO', 'preflop-rfi'),
  spot('K7o-CO', 'preflop-rfi'),
  spot('K9s-CO', 'preflop-rfi'),
  spot('K7s-UTG', 'preflop-rfi'),
  spot('K7s-vs-UTG-open', 'preflop-vs-open'),
  spot('K9o-BTN', 'preflop-rfi'),
  spot('A5s-SB', 'preflop-rfi'),
];

const framed = (items: readonly BlockItem[]): BlockResult =>
  assembleInterleavedBlock({ items, preframeShown: true });

// ---------------------------------------------------------------------------

describe('the module taxonomy is closed and matches the content that exists', () => {
  it('names every module exactly once', () => {
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size, `duplicate module id in ${ids.join(', ')}`).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(moduleById(id).id).toBe(id);
  });

  it('places every authored lesson in exactly one module', () => {
    // Derives the taxonomy's completeness from the content directory rather than from a hand list:
    // adding a lesson without placing it fails here instead of silently defaulting to some module.
    const unplaced = LESSONS.filter((lesson) => moduleOfContent(lesson.id) === undefined).map((l) => l.id);
    expect(unplaced, `lessons with no module: ${unplaced.join(', ')}`).toEqual([]);
  });

  it('places every contrast-manifest concept in exactly one module', () => {
    const unplaced = CONTRAST_MANIFEST.filter(
      (entry) => moduleOfContent(entry.conceptId) === undefined,
    ).map((e) => e.conceptId);
    expect(unplaced, `manifest concepts with no module: ${unplaced.join(', ')}`).toEqual([]);
  });

  it('claims no content id that does not exist in this build', () => {
    const real = new Set<string>([
      ...LESSONS.map((l) => l.id),
      ...CONTRAST_MANIFEST.map((e) => e.conceptId),
      // progress.ts's route id for the module it links when it refuses a results graph.
      'variance-module',
    ]);
    const invented = MODULES.flatMap((m) => m.contentIds).filter((id) => !real.has(id));
    expect(invented, `module content ids with no content: ${invented.join(', ')}`).toEqual([]);
  });

  it('refuses a taxonomy where one content id is claimed by two modules', () => {
    // An ambiguous module means an ambiguous boundary, so Q2's refusal would depend on list order.
    // MODULES has no duplicate, so this is the only way to reach the guard.
    const doubled = [
      moduleById('pot-odds-arithmetic'),
      { ...moduleById('variance'), contentIds: ['pot-odds-as-a-price'] },
    ];
    expect(() => indexContent(doubled)).toThrow(/claimed by both/);
    // And the same call over the real taxonomy does not throw — the guard is not firing spuriously.
    expect(() => indexContent(MODULES)).not.toThrow();
  });

  it('has no bankroll module, and says why', () => {
    // Q2 names bankroll as a low-similarity neighbour; PRODUCT-SPEC's non-goals exclude it. An empty
    // category no content can land in would be worse than its documented absence.
    expect(MODULES.map((m) => m.id)).not.toContain('bankroll');
    expect(BANKROLL_ABSENT).toMatch(/non-goals/);
  });
});

describe('Q2 — high similarity interleaves, low similarity blocks (the direction is the clause)', () => {
  it('rates preflop RFI against pot-odds arithmetic LOW, and refuses the mix', () => {
    // Q2's own example: "preflop RFI is not mixed with pot-odds arithmetic ... in the same block".
    expect(similarity('preflop-rfi', 'pot-odds-arithmetic')).toBe('low');
    expect(mayShareBlock('preflop-rfi', 'pot-odds-arithmetic')).toBe(false);
  });

  it('rates preflop RFI against variance LOW', () => {
    expect(similarity('preflop-rfi', 'variance')).toBe('low');
    expect(mayShareBlock('preflop-rfi', 'variance')).toBe(false);
  });

  it('rates two preflop decision families HIGH, and lets them share a block', () => {
    // The opposite direction, with categories that genuinely differ: an open-or-fold decision and a
    // decision facing an open are different modules, and Q1's own confusion set spans exactly that
    // pair (K7s-CO and K7s-vs-UTG-open). High similarity is the licence to MIX.
    expect(similarity('preflop-rfi', 'preflop-vs-open')).toBe('high');
    expect(mayShareBlock('preflop-rfi', 'preflop-vs-open')).toBe(true);

    const block = blockOf(framed(CONFUSION_SET), "Q1's confusion set");
    expect([...block.moduleIds].sort()).toEqual(['preflop-rfi', 'preflop-vs-open']);
  });

  it('rates a pair differing only in what the learner SEES as low', () => {
    // Pot odds from a stated pot and bet, versus a variance figure from a hand count and a win rate:
    // both ask for a number, and the stimulus alone separates them. Q2 names both as low-similarity
    // neighbours of each other's company, so the stimulus half of the relation has to bite on its own.
    expect(moduleById('pot-odds-arithmetic').response).toBe(moduleById('variance').response);
    expect(similarity('pot-odds-arithmetic', 'variance')).toBe('low');
  });

  it('rates a pair differing only in what the learner PRODUCES as low', () => {
    // Same board, pot and stacks in view; one asks for an action and the other for a mechanism
    // sentence. The response half of the relation has to bite on its own too.
    expect(moduleById('postflop-nodes').stimulus).toBe(moduleById('principles').stimulus);
    expect(similarity('postflop-nodes', 'principles')).toBe('low');
    expect(mayShareBlock('postflop-nodes', 'principles')).toBe(false);
  });

  it('is reflexive and symmetric', () => {
    for (const { id } of MODULES) expect(similarity(id, id), `${id} vs itself`).toBe('high');
    for (const a of MODULES) {
      for (const b of MODULES) {
        expect(similarity(a.id, b.id), `${a.id}/${b.id} asymmetric`).toBe(similarity(b.id, a.id));
      }
    }
  });

  it('refuses a mixed block naming the boundary crossed', () => {
    const mixed = [...CONFUSION_SET.slice(0, 6), spot('pot-odds-half-pot', 'pot-odds-arithmetic')];
    const refusal = refusalOf(framed(mixed), 'RFI mixed with pot-odds arithmetic');

    expect(refusal.refusal).toBe('low-similarity-boundary');
    // "Naming the boundary" means the two sides are identifiable, not that a flag was set.
    expect(refusal.boundary?.a).toBe('preflop-rfi');
    expect(refusal.boundary?.b).toBe('pot-odds-arithmetic');
    expect(refusal.boundary?.differsOn.length ?? 0).toBeGreaterThan(0);
    expect(refusal.reason).toContain(moduleById('preflop-rfi').label);
    expect(refusal.reason).toContain(moduleById('pot-odds-arithmetic').label);
  });

  it('offers no way to opt out: the same mix is refused however it is ordered', () => {
    const mixed = [spot('pot-odds-half-pot', 'pot-odds-arithmetic'), ...CONFUSION_SET.slice(0, 6)];
    expect(refusalOf(framed(mixed), 'pot-odds first').refusal).toBe('low-similarity-boundary');
    expect(refusalOf(framed([...mixed].reverse()), 'pot-odds last').refusal).toBe(
      'low-similarity-boundary',
    );
  });

  it('splits a refused mix into the per-module blocks Q2 says to run instead', () => {
    const mixed: readonly BlockItem[] = [
      spot('K7s-CO', 'preflop-rfi'),
      spot('pot-odds-half-pot', 'pot-odds-arithmetic'),
      spot('K9s-CO', 'preflop-rfi'),
      spot('mdf-third-pot', 'pot-odds-arithmetic'),
      spot('K7s-vs-UTG-open', 'preflop-vs-open'),
    ];
    const groups = partitionByModule(mixed);

    expect(groups.length).toBe(2);
    // The partition is unique because similarity is an equivalence relation: every pair inside a
    // group is high-similarity, and every cross-group pair is low.
    for (const group of groups) {
      for (const a of group.moduleIds) {
        for (const b of group.moduleIds) expect(mayShareBlock(a, b), `${a}/${b} grouped`).toBe(true);
      }
    }
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        expect(mayShareBlock(groups[i].moduleIds[0], groups[j].moduleIds[0])).toBe(false);
      }
    }
    // Nothing is lost or duplicated by the split.
    expect(groups.flatMap((g) => g.items.map((i) => i.spotClass)).sort()).toEqual(
      mixed.map((i) => i.spotClass).sort(),
    );
    // Order inside a group is the queue order it arrived in.
    const preflopGroup = groups.find((g) => g.moduleIds.includes('preflop-rfi'));
    expect(preflopGroup?.items.map((i) => i.spotClass)).toEqual([
      'K7s-CO',
      'K9s-CO',
      'K7s-vs-UTG-open',
    ]);
  });

  it('is order-independent: the same items in any order partition the same way', () => {
    const items: readonly BlockItem[] = [
      spot('K7s-CO', 'preflop-rfi'),
      spot('pot-odds-half-pot', 'pot-odds-arithmetic'),
      spot('sigma-200-hands', 'variance'),
      spot('K7s-vs-UTG-open', 'preflop-vs-open'),
    ];
    const signature = (list: readonly BlockItem[]) =>
      partitionByModule(list)
        .map((g) => [...g.items.map((i) => i.spotClass)].sort().join('+'))
        .sort()
        .join('|');
    expect(signature([...items].reverse())).toBe(signature(items));
  });
});

describe('Q2 — blocking is correct, and ONLY correct, in two places', () => {
  it('requires a rung-0 concept to be blocked, on first-exposure grounds', () => {
    const requirement = blockingRequirement(spot('K7s-CO', 'preflop-rfi', FIRST_EXPOSURE_RUNG), [
      'preflop-rfi',
    ]);
    expect(requirement.mustBlock).toBe(true);
    if (!requirement.mustBlock) throw new Error('unreachable');
    expect(requirement.grounds).toContain('first-exposure');
    // The two grounds must stay distinguishable: a first exposure among like company is not a
    // boundary crossing, and reporting it as one would make the reason wrong.
    expect(requirement.grounds).not.toContain('low-similarity');
    expect(requirement.boundary).toBeNull();
  });

  it('does NOT require a rung-2 concept in high-similarity company to be blocked', () => {
    // The inversion this test exists for: a module that blocks generously passes every assertion
    // above and destroys the interleaving Q1 requires.
    const requirement = blockingRequirement(spot('K7s-CO', 'preflop-rfi', 2), [
      'preflop-rfi',
      'preflop-vs-open',
    ]);
    expect(requirement.mustBlock).toBe(false);
    if (requirement.mustBlock) throw new Error('unreachable');
    expect(requirement.mustInterleave).toBe(true);
  });

  it('requires blocking on low-similarity grounds even past first exposure', () => {
    const requirement = blockingRequirement(spot('K7s-CO', 'preflop-rfi', MAX_FADING_RUNG), [
      'pot-odds-arithmetic',
    ]);
    expect(requirement.mustBlock).toBe(true);
    if (!requirement.mustBlock) throw new Error('unreachable');
    expect(requirement.grounds).toEqual(['low-similarity']);
    expect(requirement.boundary?.b).toBe('pot-odds-arithmetic');
  });

  it('reports both grounds when both hold', () => {
    const requirement = blockingRequirement(
      spot('K7s-CO', 'preflop-rfi', FIRST_EXPOSURE_RUNG),
      ['variance'],
    );
    expect(requirement.mustBlock).toBe(true);
    if (!requirement.mustBlock) throw new Error('unreachable');
    expect([...requirement.grounds].sort()).toEqual(['first-exposure', 'low-similarity']);
  });

  it('interleaves every rung above 0 in like company — blocking is not merely optional there', () => {
    for (let rung = FIRST_EXPOSURE_RUNG + 1; rung <= MAX_FADING_RUNG; rung++) {
      const requirement = blockingRequirement(spot('K7s-CO', 'preflop-rfi', rung), ['preflop-rfi']);
      expect(requirement.mustBlock, `rung ${rung} was forced to block`).toBe(false);
    }
  });

  it('rejects a rung outside T7\'s ladder rather than treating it as past first exposure', () => {
    expect(() => blockingRequirement(spot('K7s-CO', 'preflop-rfi', -1))).toThrow(/rung/);
    expect(() => blockingRequirement(spot('K7s-CO', 'preflop-rfi', MAX_FADING_RUNG + 1))).toThrow(/rung/);
    expect(() => blockingRequirement(spot('K7s-CO', 'preflop-rfi', 1.5))).toThrow(/rung/);
  });

  it('keeps a first exposure out of an interleaved block entirely', () => {
    const withFirstExposure = [
      ...CONFUSION_SET.slice(0, 6),
      spot('QTo-BTN', 'preflop-rfi', FIRST_EXPOSURE_RUNG),
    ];
    const refusal = refusalOf(framed(withFirstExposure), 'rung-0 spot inside an interleaved block');
    expect(refusal.refusal).toBe('first-exposure-rung');
    expect(refusal.reason).toContain('QTo-BTN');
  });
});

describe('Q1 — the interleaving floor this module must not contradict', () => {
  it('uses the same >= 7 classes sessionPlan sizes its graded block for', () => {
    expect(MIN_INTERLEAVED_CLASSES).toBe(7);
    // sessionPlan.MIN_GRADED_SPOTS is derived from this same clause; if they drift, a session can be
    // assembled whose graded block this module then refuses.
    expect(MIN_GRADED_SPOTS).toBe(MIN_INTERLEAVED_CLASSES);
  });

  it('refuses two consecutive spots of the same class', () => {
    const items = [
      spot('K7s-CO', 'preflop-rfi'),
      spot('K7s-CO', 'preflop-rfi'),
      ...CONFUSION_SET.slice(1),
    ];
    const refusal = refusalOf(framed(items), 'consecutive same class');
    expect(refusal.refusal).toBe('consecutive-same-class');
    expect(refusal.reason).toContain('K7s-CO');
  });

  it('accepts the same classes reordered so no pair is consecutive', () => {
    const block = blockOf(
      framed([
        spot('K7s-CO', 'preflop-rfi'),
        spot('K9s-CO', 'preflop-rfi'),
        spot('K7s-CO', 'preflop-rfi'),
        ...CONFUSION_SET.slice(1),
      ]),
      'reordered repeat',
    );
    // Q1 forbids ADJACENT repeats, not repeats — a block of 20 spots over 7 classes must repeat.
    expect(block.items.length).toBe(9);
    expect(block.distinctClasses).toBe(7);
  });

  it('refuses a block spanning fewer than 7 classes', () => {
    const refusal = refusalOf(framed(CONFUSION_SET.slice(0, 6)), 'six classes');
    expect(refusal.refusal).toBe('too-few-classes');
    expect(refusal.reason).toContain('6 classes');
  });

  it('accepts a block at exactly the floor', () => {
    const block = blockOf(framed(CONFUSION_SET), 'exactly seven classes');
    expect(block.distinctClasses).toBe(MIN_INTERLEAVED_CLASSES);
    expect(block.items.length).toBe(7);
  });

  it('refuses an empty block and a blank spot class', () => {
    expect(refusalOf(framed([]), 'empty').refusal).toBe('empty-block');
    expect(
      refusalOf(framed([spot('  ', 'preflop-rfi'), ...CONFUSION_SET]), 'blank class').refusal,
    ).toBe('blank-spot-class');
  });
});

describe('Q3 — the accuracy cost is pre-framed in writing before the first interleaved block', () => {
  it('states the 20-30 point drop, in those numbers', () => {
    expect(ACCURACY_DROP_POINTS).toEqual({ min: 20, max: 30 });
    const text = INTERLEAVING_PREFRAME.join(' ');
    expect(text).toContain('20-30 points');
    // The claim is relative to blocked practice; "accuracy drops 20-30 points" alone is a different
    // and much worse claim.
    expect(text).toMatch(/relative to blocked practice/);
  });

  it('says the drop is the intended trade rather than a defect', () => {
    expect(INTERLEAVING_PREFRAME.join(' ')).toMatch(/intended trade/);
  });

  it('is written and structured: three chunks ending in a next action', () => {
    expect(INTERLEAVING_PREFRAME.length).toBe(3);
    for (const chunk of INTERLEAVING_PREFRAME) expect(chunk.trim().length).toBeGreaterThan(0);
    expect(INTERLEAVING_PREFRAME[2]).toMatch(/^Next: /);
  });

  it('refuses to hand out an interleaved block before the pre-frame has been shown', () => {
    const refusal = refusalOf(
      assembleInterleavedBlock({ items: CONFUSION_SET, preframeShown: false }),
      'pre-frame not shown',
    );
    expect(refusal.refusal).toBe('preframe-not-shown');
    expect(refusal.reason).toContain('20-30');
    expect(preframeOwed(false)).toBe(true);
  });

  it('hands out the same block once the pre-frame has been shown', () => {
    // The pre-frame is the only difference between the two calls, so this pins that Q3 is what
    // refused above rather than something else about the block.
    expect(preframeOwed(true)).toBe(false);
    expect(blockOf(framed(CONFUSION_SET), 'pre-framed').items.length).toBe(CONFUSION_SET.length);
  });

  it('does not let a mixed block through just because the pre-frame was shown', () => {
    const mixed = [...CONFUSION_SET.slice(0, 6), spot('sigma-200-hands', 'variance')];
    expect(refusalOf(framed(mixed), 'pre-framed but mixed').refusal).toBe('low-similarity-boundary');
  });
});
