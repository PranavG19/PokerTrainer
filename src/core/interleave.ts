/**
 * INTERLEAVING AND ITS TWO EXCEPTIONS — PRODUCT-SPEC Q1, Q2, Q3.
 *
 * Q2 is a prohibition, not a preference: "never interleave across low-similarity module boundaries —
 * preflop RFI is not mixed with pot-odds arithmetic, variance, or bankroll content in the same block.
 * Those are blocked by module. Blocking is also correct, and only correct, on the first exposure to a
 * genuinely new concept (fading rung 0)."
 *
 * Before this file the app had no notion of a module and no notion of similarity, so Q2 was
 * unenforceable — `sessionPlan.assemble` counts graded spots and knows nothing about what is in them.
 * This module supplies the missing vocabulary and the refusal.
 *
 * THE DIRECTION IS THE WHOLE CLAUSE, AND IT IS EASY TO INVERT. High between-category similarity is
 * where interleaving pays, so high similarity is the licence to MIX. Low similarity is where the
 * effect reverses (the method's word-learning g = -0.39), so low similarity is the instruction to
 * BLOCK. Anything that reads "similar things must be kept apart" has the clause backwards and
 * destroys the effect it thinks it is protecting.
 *
 * WHERE THE SIMILARITY RELATION COMES FROM. Q2 says similarity decides, and does not say how to
 * measure it. Q1 does: a queue is built from "confusion sets ... items with near-identical surface
 * features and different correct actions (K7s-CO / K7o-CO / K9s-CO / K7s-UTG / K7s-vs-UTG-open)".
 * Two things are worth interleaving exactly when they can be confused for one another — same
 * stimulus, same kind of response, different right answer. So each module here declares those two
 * fields and similarity is DERIVED from them rather than hand-scored per pair. Note that Q1's own
 * example set spans an open-or-fold decision and a decision facing an open, which is why those are
 * two modules that may share a block.
 *
 * Because similarity is "same stimulus AND same response", it is an equivalence relation, so the
 * legal blocks are its equivalence classes and `partitionByModule` is unique rather than a greedy
 * guess. `interleave.test.ts` pins that.
 *
 * BLOCKING IS CORRECT IN EXACTLY TWO PLACES, AND INCORRECT EVERYWHERE ELSE. Q2's "only" is
 * load-bearing: a module that blocks generously would satisfy Q2 and quietly delete Q1. So
 * `blockingRequirement` returns a union whose negative arm asserts `mustInterleave: true` — there is
 * no third state where blocking is merely allowed.
 *
 * THE FADING RUNG IS AN INPUT, NOT A DEPENDENCY. Rung 0 is Q4's day-0 blocked micro-block and T7's
 * worked-examples rung. The ladder itself (T7: rungs 0-4) lives in src/core/fading.ts, which is being
 * written in a separate worktree and therefore cannot be imported here; `rung` arrives as a documented
 * integer and is range-checked against T7's ladder.
 *
 * NO CALLER MAY OPT OUT. `assembleInterleavedBlock` takes no force flag, returns no partial block on
 * refusal, and refuses in one direction only. A surface that wants a mixed block gets a reason naming
 * the boundary it crossed and the per-module blocks it should run instead.
 */

// ---------------------------------------------------------------------------
// 1. THE MODULE TAXONOMY
// ---------------------------------------------------------------------------

/**
 * What the learner sees before committing. Q1's "surface features", named per module so similarity
 * is derived from declared data instead of scored by taste.
 */
export type Stimulus =
  | 'table-state-and-legal-actions'
  | 'cards-in-view'
  | 'hole-cards-and-a-seat'
  | 'a-board-a-pot-and-stacks'
  | 'a-stated-pot-and-bet'
  | 'a-hand-count-and-a-win-rate'
  | 'an-observation-set';

/** What the learner produces. Q1's "different correct actions" generalised to the response type. */
export type Response = 'an-action' | 'a-number' | 'a-classification' | 'a-mechanism-sentence';

/**
 * The closed set of content modules this build actually has. Derived from the content that exists —
 * src/core/lessons/content/*.ts (spine phases 0-3), src/core/preflop.ts, src/core/arithmetic.ts,
 * src/core/contrastManifest.ts (the phase-4 node families), src/core/reads.ts — not from a category
 * scheme invented alongside it. Q2 names one module this build does not have: see BANKROLL_ABSENT.
 */
export type ModuleId =
  | 'rules'
  | 'perception'
  | 'preflop-rfi'
  | 'preflop-vs-open'
  | 'postflop-nodes'
  | 'principles'
  | 'pot-odds-arithmetic'
  | 'variance'
  | 'reads';

export interface ContentModule {
  readonly id: ModuleId;
  /** Prose name, used verbatim in a refusal so the boundary is legible on screen. */
  readonly label: string;
  readonly stimulus: Stimulus;
  readonly response: Response;
  /** The file that owns this module's content, so a reader can check the taxonomy against it. */
  readonly source: string;
  /**
   * Lesson ids and manifest concept ids that belong to this module. Only ids that exist in this
   * build appear; a module whose content is generated rather than authored has none, which is the
   * gap `moduleOfContent` cannot close (see the header of interleave.test.ts).
   */
  readonly contentIds: readonly string[];
}

/**
 * Q2 names "bankroll content" as an example of a low-similarity neighbour. This build has none:
 * PRODUCT-SPEC's non-goals list "Bankroll management" explicitly, and the only `bankroll` in the code
 * is a chip counter in session.ts. So there is no bankroll module to draw a boundary against, and
 * inventing one would put a category in the taxonomy that no content can ever land in.
 */
export const BANKROLL_ABSENT =
  'PRODUCT-SPEC non-goals exclude bankroll management, so Q2\'s bankroll example has no module here';

export const MODULES: readonly ContentModule[] = [
  {
    id: 'rules',
    label: 'the rules',
    stimulus: 'table-state-and-legal-actions',
    response: 'a-classification',
    source: 'src/core/lessons/content (spine phase 0)',
    contentIds: ['what-the-actions-mean', 'hand-rankings-in-order', 'betting-order-and-position'],
  },
  {
    id: 'perception',
    label: 'perception drills',
    stimulus: 'cards-in-view',
    response: 'a-classification',
    source: 'src/core/lessons/content (spine phase 1), src/core/evaluate.ts, src/core/anomaly.ts',
    contentIds: [
      'best-five-from-seven',
      'board-texture-dimensions',
      'who-holds-the-nuts',
      'range-role-bettor-or-caller',
    ],
  },
  {
    id: 'preflop-rfi',
    label: 'preflop RFI',
    stimulus: 'hole-cards-and-a-seat',
    response: 'an-action',
    source: 'src/core/preflop.ts, src/core/lessons/content (spine phase 1)',
    // The RFI blueprint is generated from thresholds (RFI_SPECS) and carries no authored id; the one
    // authored lesson that teaches the same stimulus→action (seat sets the opening range) belongs here.
    contentIds: ['position-sets-your-range', 'small-blind-raise-or-fold'],
  },
  {
    id: 'preflop-vs-open',
    label: 'preflop decisions facing an open',
    stimulus: 'hole-cards-and-a-seat',
    response: 'an-action',
    source: 'src/core/contrastManifest.ts, src/core/preflop.ts (BB defence rules), src/core/lessons/content',
    contentIds: [
      'sb-squeeze',
      'defend-the-big-blind',
      'blind-vs-blind-defence',
      'opener-seat-sets-defence-width',
      'three-bet-or-flat-the-defence',
      'facing-a-3bet',
    ],
  },
  {
    id: 'postflop-nodes',
    label: 'postflop node decisions',
    stimulus: 'a-board-a-pot-and-stacks',
    response: 'an-action',
    source: 'src/core/contrastManifest.ts (spine phase 4)',
    contentIds: [
      'btn-srp-cbet',
      'bb-defence-vs-cbet',
      'turn-probe',
      'river-bluff-catch',
      'flop-cbet-size-by-texture',
    ],
  },
  {
    id: 'principles',
    label: 'principles stated in your own sentence',
    stimulus: 'a-board-a-pot-and-stacks',
    response: 'a-mechanism-sentence',
    source: 'src/core/lessons/content (spine phase 3)',
    contentIds: [
      'equity-realisation',
      'domination-and-dead-hands',
      'range-advantage-versus-nut-advantage',
      'polarity-picks-the-size',
    ],
  },
  {
    id: 'pot-odds-arithmetic',
    label: 'pot-odds arithmetic',
    stimulus: 'a-stated-pot-and-bet',
    response: 'a-number',
    source: 'src/core/arithmetic.ts, src/core/lessons/content (spine phase 2)',
    contentIds: [
      'pot-odds-as-a-price',
      'counting-outs-as-a-frequency',
      'minimum-defence-frequency',
      'alpha-the-bluff-price',
      'spr-sets-the-plan',
      'combos-not-hands',
    ],
  },
  {
    id: 'variance',
    label: 'the variance table',
    stimulus: 'a-hand-count-and-a-win-rate',
    response: 'a-number',
    source: 'src/core/arithmetic.ts (riskOfLosing), src/core/progress.ts',
    // The route id progress.ts hands a caller when it refuses a results graph.
    contentIds: ['variance-module'],
  },
  {
    id: 'reads',
    label: 'opponent reads',
    stimulus: 'an-observation-set',
    response: 'a-classification',
    source: 'src/core/reads.ts (spine phase 5)',
    contentIds: [],
  },
];

const MODULE_BY_ID: ReadonlyMap<ModuleId, ContentModule> = new Map(
  MODULES.map((module) => [module.id, module]),
);

export function moduleById(id: ModuleId): ContentModule {
  const module = MODULE_BY_ID.get(id);
  // Unreachable while ModuleId and MODULES agree; a thrown error beats a silently missing boundary.
  if (!module) throw new Error(`unknown content module: ${id}`);
  return module;
}

/**
 * Content id -> module. A duplicate id throws rather than routing a spot to whichever module happened
 * to be listed first: an ambiguous module means an ambiguous boundary, and Q2's refusal would then
 * depend on list order. Takes its modules as an argument so the guard is reachable from a test —
 * MODULES has no duplicate, so a guard that could only be exercised through it could not be proven.
 */
export function indexContent(
  modules: readonly ContentModule[],
): ReadonlyMap<string, ModuleId> {
  const map = new Map<string, ModuleId>();
  for (const module of modules) {
    for (const contentId of module.contentIds) {
      const existing = map.get(contentId);
      if (existing) {
        throw new Error(`content id ${contentId} is claimed by both ${existing} and ${module.id}`);
      }
      map.set(contentId, module.id);
    }
  }
  return map;
}

const MODULE_OF_CONTENT: ReadonlyMap<string, ModuleId> = indexContent(MODULES);

/** `undefined` for content this build cannot place — the caller must not guess a module. */
export function moduleOfContent(contentId: string): ModuleId | undefined {
  return MODULE_OF_CONTENT.get(contentId);
}

// ---------------------------------------------------------------------------
// 2. SIMILARITY — THE RELATION Q2 TURNS ON
// ---------------------------------------------------------------------------

export type Similarity = 'high' | 'low';

/** Which declared field made two modules dissimilar. Named in the refusal, never inferred by a reader. */
export type SimilarityDimension = 'stimulus' | 'response';

/**
 * HIGH means the two categories can be confused for one another, which is where interleaving pays,
 * so high similarity is what LICENSES a shared block. LOW is where the effect reverses, so low
 * similarity is what FORCES blocking. Reflexive: a module is always high-similarity with itself.
 */
export function similarity(a: ModuleId, b: ModuleId): Similarity {
  return differences(a, b).length === 0 ? 'high' : 'low';
}

function differences(a: ModuleId, b: ModuleId): readonly SimilarityDimension[] {
  const left = moduleById(a);
  const right = moduleById(b);
  const out: SimilarityDimension[] = [];
  if (left.stimulus !== right.stimulus) out.push('stimulus');
  if (left.response !== right.response) out.push('response');
  return out;
}

/** Q2 in one predicate: two modules may share a block exactly when their similarity is high. */
export function mayShareBlock(a: ModuleId, b: ModuleId): boolean {
  return similarity(a, b) === 'high';
}

export interface ModuleBoundary {
  readonly a: ModuleId;
  readonly b: ModuleId;
  /** Non-empty: a boundary exists precisely because at least one dimension differs. */
  readonly differsOn: readonly SimilarityDimension[];
}

function boundaryBetween(a: ModuleId, b: ModuleId): ModuleBoundary | null {
  const differsOn = differences(a, b);
  return differsOn.length === 0 ? null : { a, b, differsOn };
}

function boundaryProse(boundary: ModuleBoundary): string {
  const left = moduleById(boundary.a);
  const right = moduleById(boundary.b);
  const parts = boundary.differsOn.map((dimension) =>
    dimension === 'stimulus'
      ? `what the learner sees (${left.stimulus} vs ${right.stimulus})`
      : `what the learner produces (${left.response} vs ${right.response})`,
  );
  return `${left.label} and ${right.label} differ in ${parts.join(' and in ')}`;
}

// ---------------------------------------------------------------------------
// 3. THE TWO GROUNDS FOR BLOCKING, AND NOTHING ELSE
// ---------------------------------------------------------------------------

/** T7's ladder: rungs 0-4. Rung 0 is Q4's day-0 blocked micro-block, the first exposure. */
export const FIRST_EXPOSURE_RUNG = 0;
export const MAX_FADING_RUNG = 4;

export type BlockingGround = 'low-similarity' | 'first-exposure';

/**
 * Q2's "only" made structural. The negative arm asserts `mustInterleave`, so there is no state in
 * which a caller may block a past-first-exposure concept among high-similarity company.
 */
export type BlockingRequirement =
  | {
      readonly mustBlock: true;
      /** Both grounds can hold at once; order is first-exposure first, then the boundary. */
      readonly grounds: readonly BlockingGround[];
      /** Present only when 'low-similarity' is a ground. */
      readonly boundary: ModuleBoundary | null;
      readonly why: string;
    }
  | {
      readonly mustBlock: false;
      readonly mustInterleave: true;
      readonly why: string;
    };

export interface ConceptExposure {
  /** Q1's spot class, e.g. 'K7s-CO'. Free text: no class registry exists in this build. */
  readonly spotClass: string;
  readonly module: ModuleId;
  /**
   * T7 fading rung, 0-4, for THIS concept — never a global level (T7 forbids one). Supplied by the
   * caller because the ladder lives in src/core/fading.ts, which this module deliberately does not
   * import.
   */
  readonly rung: number;
}

function assertRung(rung: number, where: string): void {
  if (!Number.isInteger(rung) || rung < FIRST_EXPOSURE_RUNG || rung > MAX_FADING_RUNG) {
    throw new RangeError(
      `${where}: rung ${rung} is not one of T7's rungs ${FIRST_EXPOSURE_RUNG}-${MAX_FADING_RUNG}`,
    );
  }
}

/**
 * "Must this be blocked, and why" — with Q2's two grounds distinguished.
 *
 * `alongside` is the company the concept would keep in one block: the modules of the other spots.
 * A rung-0 concept must be blocked whatever its company. A rung >= 1 concept in high-similarity
 * company must NOT be blocked — it must be interleaved.
 */
export function blockingRequirement(
  concept: ConceptExposure,
  alongside: readonly ModuleId[] = [],
): BlockingRequirement {
  assertRung(concept.rung, `blockingRequirement(${concept.spotClass})`);

  const grounds: BlockingGround[] = [];
  const reasons: string[] = [];

  if (concept.rung === FIRST_EXPOSURE_RUNG) {
    grounds.push('first-exposure');
    reasons.push(
      `${concept.spotClass} is at fading rung ${FIRST_EXPOSURE_RUNG}, a first exposure to a new concept, ` +
        'and Q2 makes blocking correct there (Q4 day 0: a blocked micro-block of 10 reps)',
    );
  }

  const crossed = alongside
    .map((other) => boundaryBetween(concept.module, other))
    .find((boundary): boundary is ModuleBoundary => boundary !== null);

  if (crossed) {
    grounds.push('low-similarity');
    reasons.push(
      `${boundaryProse(crossed)}, so between-category similarity is low and Q2 forbids interleaving across that boundary`,
    );
  }

  if (grounds.length > 0) {
    return { mustBlock: true, grounds, boundary: crossed ?? null, why: reasons.join('; ') };
  }

  return {
    mustBlock: false,
    mustInterleave: true,
    why:
      `${concept.spotClass} is at rung ${concept.rung}, past first exposure, among high-similarity company ` +
      `(${[concept.module, ...alongside].map((id) => moduleById(id).label).join(', ')}); ` +
      'Q2 makes blocking correct ONLY at low similarity or at rung 0, so this must be interleaved',
  };
}

// ---------------------------------------------------------------------------
// 4. Q3 — THE WRITTEN PRE-FRAME
// ---------------------------------------------------------------------------

/** Q3's figure, verbatim: accuracy drops 20-30 points relative to blocked practice. */
export const ACCURACY_DROP_POINTS = { min: 20, max: 30 } as const;

/**
 * Q3: "in-session accuracy cost is pre-framed in writing before the first interleaved block". Three
 * chunks ending in a next action (G6), task-as-subject, no praise and no trait claim (G7).
 */
export const INTERLEAVING_PREFRAME: readonly string[] = [
  `An interleaved block mixes spot classes, so in-session accuracy drops ${ACCURACY_DROP_POINTS.min}-${ACCURACY_DROP_POINTS.max} points relative to blocked practice.`,
  'That drop is the intended trade: blocked practice feels more fluent while it is happening and leaves less that can be retrieved later.',
  'Next: read the accuracy in this block as the price of the trade, then compare it against the day-7 probe rather than against a blocked block.',
];

/**
 * Q3 is a precondition, so it is checked where the block is handed out rather than left to a screen.
 * Stronger than Q3's letter — Q3 names the FIRST interleaved block, and this refuses every
 * un-pre-framed one — which cannot violate Q3 and removes the "has it been shown yet" bookkeeping
 * from every caller.
 */
export function preframeOwed(preframeShown: boolean): boolean {
  return !preframeShown;
}

// ---------------------------------------------------------------------------
// 5. THE PROHIBITION AS A FUNCTION THAT REFUSES
// ---------------------------------------------------------------------------

/**
 * Q1's floor: "a 20-spot block spans >= 7 classes". Same 7 as sessionPlan.MIN_GRADED_SPOTS, which is
 * derived from this clause; interleave.test.ts pins the two together rather than importing session
 * assembly into queue construction.
 */
export const MIN_INTERLEAVED_CLASSES = 7;

/** A spot as the queue sees it: its class, its module, and the concept's own fading rung. */
export type BlockItem = ConceptExposure;

export type RefusalCode =
  | 'empty-block'
  | 'blank-spot-class'
  | 'low-similarity-boundary'
  | 'first-exposure-rung'
  | 'consecutive-same-class'
  | 'too-few-classes'
  | 'preframe-not-shown';

export interface InterleavedBlock {
  readonly items: readonly BlockItem[];
  /** Distinct modules present, in first-appearance order. All pairwise high-similarity. */
  readonly moduleIds: readonly ModuleId[];
  readonly distinctClasses: number;
}

/** Matches sessionPlan.PlanResult's shape so a refusal composes with a refused sitting. */
export type BlockResult =
  | { readonly ok: true; readonly block: InterleavedBlock }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly refusal: RefusalCode;
      /** Populated only for 'low-similarity-boundary'; that refusal must name what it crossed. */
      readonly boundary: ModuleBoundary | null;
    };

export interface BlockRequest {
  /** In queue order: `items[i]` is presented before `items[i + 1]`. */
  readonly items: readonly BlockItem[];
  /** Q3: has the written pre-frame already been put in front of this learner? */
  readonly preframeShown: boolean;
}

const refuse = (
  refusal: RefusalCode,
  reason: string,
  boundary: ModuleBoundary | null = null,
): BlockResult => ({ ok: false, reason, refusal, boundary });

/**
 * Accept a proposed interleaved block, or refuse it naming the boundary crossed.
 *
 * There is no force flag and no partial result: Q2 says "never", so a caller that wants the mix must
 * change the mix. `partitionByModule` returns the blocks it should run instead.
 *
 * Check order, and the reason for it: the two Q2 grounds first (they say the block is the wrong
 * SHAPE), then Q1's queue constraints (the right shape in the wrong ORDER), then Q3's pre-frame (the
 * block is fine and the learner has not been told the price).
 */
export function assembleInterleavedBlock(request: BlockRequest): BlockResult {
  const { items, preframeShown } = request;

  if (items.length === 0) return refuse('empty-block', 'an interleaved block of zero spots is not a block');

  for (const item of items) {
    assertRung(item.rung, `assembleInterleavedBlock(${item.spotClass})`);
    if (item.spotClass.trim() === '') {
      return refuse(
        'blank-spot-class',
        `a spot in module ${item.module} carries a blank spot class, so Q1's class count cannot be checked`,
      );
    }
  }

  // Q2, negative case. Reported on the first crossing in queue order so the message is reproducible.
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const boundary = boundaryBetween(items[i].module, items[j].module);
      if (boundary) {
        return refuse(
          'low-similarity-boundary',
          `refusing to interleave "${items[i].spotClass}" with "${items[j].spotClass}": ` +
            `${boundaryProse(boundary)}, so Q2 forbids putting them in one block — they are blocked by module`,
          boundary,
        );
      }
    }
  }

  // Q2's second ground: a first exposure belongs in its own blocked micro-block, never in this one.
  const firstExposure = items.find((item) => item.rung === FIRST_EXPOSURE_RUNG);
  if (firstExposure) {
    return refuse(
      'first-exposure-rung',
      `refusing to interleave "${firstExposure.spotClass}": it is at fading rung ${FIRST_EXPOSURE_RUNG}, ` +
        'a first exposure, which Q2 says is blocked (Q4 day 0)',
    );
  }

  // Q1: no two consecutive spots may share a class.
  for (let i = 1; i < items.length; i++) {
    if (items[i].spotClass === items[i - 1].spotClass) {
      return refuse(
        'consecutive-same-class',
        `spots ${i} and ${i + 1} both belong to class "${items[i].spotClass}"; ` +
          'Q1 forbids two consecutive spots sharing a spot class',
      );
    }
  }

  // Q1: >= 7 classes. A shorter proposal cannot reach the floor, and saying so is the honest refusal.
  const classes = new Set(items.map((item) => item.spotClass));
  if (classes.size < MIN_INTERLEAVED_CLASSES) {
    return refuse(
      'too-few-classes',
      `${items.length} spots span ${classes.size} classes; Q1 requires >= ${MIN_INTERLEAVED_CLASSES} per interleaved block`,
    );
  }

  if (preframeOwed(preframeShown)) {
    return refuse(
      'preframe-not-shown',
      'Q3: the written pre-frame stating the ' +
        `${ACCURACY_DROP_POINTS.min}-${ACCURACY_DROP_POINTS.max} point accuracy drop must be shown before an interleaved block`,
    );
  }

  const moduleIds: ModuleId[] = [];
  for (const item of items) if (!moduleIds.includes(item.module)) moduleIds.push(item.module);

  return { ok: true, block: { items, moduleIds, distinctClasses: classes.size } };
}

// ---------------------------------------------------------------------------
// 6. WHAT TO DO WITH A REFUSED MIX
// ---------------------------------------------------------------------------

export interface ModuleBlock {
  /** Every module here is pairwise high-similarity with the others, so one block is legal. */
  readonly moduleIds: readonly ModuleId[];
  readonly items: readonly BlockItem[];
}

/**
 * Q2's "those are blocked by module", constructively: split a mixed proposal along its low-similarity
 * boundaries. Since similarity is an equivalence relation, this partition is unique — not a greedy
 * pass whose result depends on item order. Groups appear in first-appearance order, and item order
 * inside a group is preserved, so the caller can hand each group straight back to
 * `assembleInterleavedBlock`.
 */
export function partitionByModule(items: readonly BlockItem[]): readonly ModuleBlock[] {
  const groups = new Map<string, { moduleIds: ModuleId[]; items: BlockItem[] }>();
  for (const item of items) {
    const module = moduleById(item.module);
    const key = `${module.stimulus}|${module.response}`;
    const group = groups.get(key) ?? { moduleIds: [], items: [] };
    if (!group.moduleIds.includes(item.module)) group.moduleIds.push(item.module);
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({ moduleIds: group.moduleIds, items: group.items }));
}
