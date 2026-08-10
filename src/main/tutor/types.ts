/**
 * Tutor types. Main-process only (PRODUCT-SPEC "Security" → renderer isolation:
 * network calls happen in main, so these types never cross into the renderer).
 *
 * These deliberately live under src/main rather than src/core: importing a
 * src/core module from src/main would move tsc's inferred rootDir up to `src`
 * and relocate the emitted entry point away from dist/main/main.js.
 */

export type Tier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4';

/** G7, upstream-wins order. */
export type ErrorTag =
  | 'RANGE'
  | 'TEXTURE'
  | 'PRICE'
  | 'BLOCKERS'
  | 'SIZING'
  | 'DEPTH-POSITION'
  | 'PURITY';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';

/**
 * T4 defines exactly two word budgets, so outputs carry exactly two kinds.
 * A rules answer is prose, not an interrogation, so it takes the `correction`
 * budget (60 words) — there is no third budget to give it.
 */
export type TutorOutputKind = 'correction' | 'question';

/**
 * What the learner can already see at the table. Carries no solver quantity,
 * no equity and no EV — this is the whole point of T3a, so nothing may be
 * added here without re-reading that decision.
 */
export interface VisibleTable {
  readonly positions: readonly string[];
  readonly stacksBb: readonly number[];
  readonly potBb: number;
  readonly board: readonly string[];
  readonly heroCards: readonly string[];
  readonly toAct: string;
  readonly street: Street;
}

/** Engine-computed numbers. Post-reveal only (T8 for `equityPct`). */
export interface GradePayload {
  readonly tier: Tier;
  readonly deltaEvBb: number;
  readonly errorTag: ErrorTag;
  readonly potBeforeActionBb: number;
  readonly chosenAction: string;
  readonly bestAction: string;
  readonly actionEvsBb: Readonly<Record<string, number>>;
  readonly equityPct: number;
  readonly principle: string;
  readonly boundaryHand: string;
  readonly flippingVariable: string;
  readonly classRwBbPer100: number;
}

/**
 * T3a — the pre-commit rules path. There is no field on this type that can
 * carry ΔEV, an action EV, a best action or equity, so leaking one requires
 * editing this interface rather than forgetting a check at a call site.
 *
 * It shares no supertype with StrategyRequest: `kind` discriminates and the
 * only structure in common is VisibleTable, which is solver-free by definition.
 */
export interface RulesRequest {
  readonly kind: 'rules';
  readonly question: string;
  /** The fixed rules vocabulary the answer may draw on. */
  readonly vocabulary: readonly string[];
  readonly table: VisibleTable;
}

/** Post-reveal / post-commit path. This one is allowed to carry the numbers. */
export interface StrategyRequest {
  readonly kind: 'strategy';
  readonly prompt: string;
  readonly table: VisibleTable;
  readonly grade: GradePayload;
  /** Lexicon sentences the learner wrote, quoted back (T1). */
  readonly lexicon: readonly string[];
}

export type TutorRequest = RulesRequest | StrategyRequest;

export interface TutorResponse {
  readonly text: string;
  readonly kind: TutorOutputKind;
  /** `fixed` means the string table answered; `model` means a live call did. */
  readonly source: 'fixed' | 'model';
}

/** The seam a real SigV4-signed client replaces without touching callers. */
export interface ModelClient {
  readonly id: string;
  complete(envelope: PromptEnvelope): Promise<string>;
}

export interface PromptEnvelope {
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
}
