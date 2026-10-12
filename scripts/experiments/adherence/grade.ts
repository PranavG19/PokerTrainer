/**
 * EXPERIMENT 1 — the one place the harness asks the grader for a verdict.
 *
 * The harness must grade the hero the way the SHIPPED app does, or it measures a grader nobody uses.
 * The first run of this experiment called gradeDecision with no villain model at all, while the live
 * table (renderer/screens/table.ts computeHeroGrade) passed VILLAIN_BETTING_RANGE whenever a bet was
 * faced. This module mirrors the live table's call so the two cannot drift again.
 *
 * GRADER_MODE (env OFFSUIT_GRADER_MODE):
 *  - 'shipped' (default): exactly what the live table passes.
 *  - 'legacy-random': no villain model, the grader as the first published run measured it. Kept so the
 *    original 39.3% / 47.7% figures can be reproduced.
 */
import { gradeDecision, type Grade } from '../../../src/core/coach.js';
import { VILLAIN_BETTING_RANGE } from '../../../src/core/preflop.js';
import type { ActionKind, TableState } from '../../../src/core/table.js';
import type { Archetype } from '../../../src/core/ai.js';

export type GraderMode = 'shipped' | 'legacy-random';

export const GRADER_MODE: GraderMode =
  process.env.OFFSUIT_GRADER_MODE === 'legacy-random' ? 'legacy-random' : 'shipped';

export interface GradeContext {
  graderSeed: number;
  /** Archetype of every seat, hero's entry unused. The shipped table knows its villains' archetypes. */
  archetypes: readonly (Archetype | null)[];
}

export function gradeHero(state: TableState, chosen: ActionKind, ctx: GradeContext): Grade {
  const hero = state.seats[state.toAct];
  const toCall = Math.max(0, state.currentBet - hero.committed);
  const opponents = state.seats.filter((s) => !s.folded && s.id !== hero.id).length;
  return gradeDecision({
    hole: hero.hole,
    board: state.board,
    street: state.street,
    pot: state.pot,
    toCall,
    stack: hero.stack,
    bb: state.bb,
    chosen,
    opponents: Math.max(1, opponents),
    seed: ctx.graderSeed,
    villainRange: GRADER_MODE === 'shipped' && toCall > 0 ? VILLAIN_BETTING_RANGE : undefined,
  });
}
