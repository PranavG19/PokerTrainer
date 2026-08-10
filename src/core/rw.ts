/**
 * REACH-WEIGHTED LOSS (RW) — PRODUCT-SPEC G2, G0 (line 183), P1, G8.
 *
 * RW is the method's study-prioritisation statistic and NOTHING ELSE. The spec spends line 183
 * establishing that ΔEV and reach live at different granularities — ΔEV is a property of a specific
 * holding at a specific node, reach is a property of a node CLASS — so their product overstates any
 * single decision by a factor of P(holding | node) and "was never a coherent per-decision quantity".
 * Every pathology the spec lists (interrupting marginal preflop opens, shrugging at stack-offs, T4
 * unreachable postflop) came from tiering on RW. G0's fix is that severity() never sees a reach term;
 * G2's job, this module, is the legitimate other half: reach-weighting is how you PRIORITISE STUDY.
 *
 * THREE GUARANTEES ARE MADE STRUCTURAL, not merely tested:
 *
 * (1) GRANULARITY IS (street × action class), NEVER per-node. `ClassDecision` — the only input that
 *     carries a decision's loss — has no `nodeKey` field and no place to put one. The spec's example
 *     is exact: "faces any flop c-bet", not "faces BTN c-bet on K72r from BB". Decisions in one class
 *     collapse into one `ClassRw` row by construction; a caller cannot ask this module for a
 *     per-node breakdown because it never received the node. This is why RW cannot regress into a
 *     per-decision severity input: the coordinate a per-decision quantity would need is absent from
 *     the type.
 *
 * (2) REACH COMES FROM A FROZEN REFERENCE POPULATION, never the live jittered bots. `reachWeightedLoss`
 *     accepts a `ReachTable`, which is authored data carrying a `referencePopId` (the same id bank.ts
 *     stamps on every `NodeProvenance`). There is no bot type in this module's signatures at all, so
 *     "read reach off the live bots" is not a mistake a caller can make here — there is nothing to
 *     read it from. The report echoes the `referencePopId` so a consumer can prove which frozen
 *     population an RW figure was computed against; changing it is a bank version bump (G2).
 *
 * (3) STUDY-PRIORITISATION ONLY. The output carries mean ΔEV, reach, sample count and the RW figure,
 *     and NO severity, NO tier, NO per-decision handle. `Severity` from coach.ts is not imported, so
 *     nothing here can be mistaken for the per-decision channel G2's NON-uses list forbids
 *     (per-decision severity, silence, interrupts, contrast triggering).
 *
 * THE FORMULA, verbatim from G2: `mean(ΔEV over decisions in that class) × reach(class) × 100`, in
 * bb/100 (the definitions table, line 45). No randomness, no clock: pure aggregation over data the
 * caller supplies, deterministic by construction.
 */

import type { Street } from './table.js';

/**
 * An action class is the coarse behavioural bucket a decision falls in — "faces any flop c-bet". It
 * is opaque here: this module compares class labels, it never parses them. Kept a bare string for the
 * same reason `NodeKey` is in bank.ts — the taxonomy is authored elsewhere, not decided here.
 */
export type ActionClass = string;

/**
 * One graded decision's loss, tagged with the CLASS it belongs to and nothing finer. The absence of a
 * `nodeKey` is the point (guarantee 1): a decision enters RW as a member of a class, so the product
 * that overstates a single node (line 183) cannot be formed — there is no node to multiply against.
 *
 * `deltaEvBb` is ΔEV = EV(best action) − EV(chosen action) in bb (definitions table, line 43). It is
 * the same quantity coach.ts surfaces as `evLossBb`; RW never recomputes it, it only aggregates.
 */
export interface ClassDecision {
  readonly street: Street;
  readonly actionClass: ActionClass;
  readonly deltaEvBb: number;
}

/** One class's reach, as measured once against the frozen reference population. */
export interface ClassReach {
  readonly street: Street;
  readonly actionClass: ActionClass;
  /** P(node class occurs per hand dealt) against the reference population (definitions table). */
  readonly reach: number;
}

/**
 * The frozen reach data shipped in the bank. `referencePopId` binds every reach in the table to the
 * one population it was computed against; it is required, so an RW figure can never be produced from
 * reach with no provenance. Compare `NodeProvenance.referencePopId` in bank.ts — same id, same
 * promise.
 */
export interface ReachTable {
  readonly referencePopId: string;
  readonly byClass: ReadonlyMap<ClassKey, number>;
}

/** The composite key for a class. Opaque; built only by `classKey`. */
export type ClassKey = string;

const KEY_SEPARATOR = '|';

/**
 * Joins a (street, action class) into a key. Throws on an action class containing the separator,
 * because collapsing two distinct classes onto one key would average unrelated decisions together and
 * mis-rank study priority — bank.ts guards `nodeKeyOf` for the same reason.
 */
export function classKey(street: Street, actionClass: ActionClass): ClassKey {
  if (actionClass.includes(KEY_SEPARATOR)) {
    throw new Error(
      `action class ${JSON.stringify(actionClass)} contains ${KEY_SEPARATOR}, which would collide with another class`,
    );
  }
  return `${street}${KEY_SEPARATOR}${actionClass}`;
}

/**
 * Builds a reach table. Throws on a duplicate class (which of two reach values wins would silently
 * decide every RW in that class) and on a reach outside [0, 1] (reach is a probability per hand; a
 * value of 2 would double the class's RW and its study rank without any decision changing).
 */
export function reachTable(referencePopId: string, entries: readonly ClassReach[]): ReachTable {
  const byClass = new Map<ClassKey, number>();
  for (const entry of entries) {
    const key = classKey(entry.street, entry.actionClass);
    if (byClass.has(key)) {
      throw new Error(`reach table has two entries for class ${key}`);
    }
    if (!Number.isFinite(entry.reach) || entry.reach < 0 || entry.reach > 1) {
      throw new Error(
        `reach for class ${key} is ${entry.reach}, not a probability in [0, 1]`,
      );
    }
    byClass.set(key, entry.reach);
  }
  return { referencePopId, byClass };
}

/**
 * One class's reach-weighted loss. Carries the sample count so a consumer can weight or gate on it,
 * but no severity and no tier: RW is study priority, never a per-decision verdict (G2 NON-uses).
 */
export interface ClassRw {
  readonly street: Street;
  readonly actionClass: ActionClass;
  /** mean(ΔEV over decisions in this class), in bb. */
  readonly meanDeltaEvBb: number;
  /** reach(class), copied from the frozen table — never recomputed from live play. */
  readonly reach: number;
  /** mean × reach × 100, in bb/100 (G2's formula, definitions table's unit). */
  readonly rw: number;
  /** How many decisions in this class the mean was taken over. */
  readonly decisions: number;
}

/**
 * The RW report: every class that saw a decision, ranked by RW descending for the study-priority
 * ordering, plus the `referencePopId` the reaches were computed against so the figure is auditable.
 */
export interface RwReport {
  readonly referencePopId: string;
  readonly classes: readonly ClassRw[];
}

/**
 * G2, in full: group the decisions by (street × action class), take the mean ΔEV in each class,
 * multiply by that class's frozen reach and by 100, and rank the classes for study priority.
 *
 * Throws when a decided class has no reach in the table: reach is shipped frozen and a class with
 * decisions but no reference reach is a bank/taxonomy mismatch. Dropping it silently would understate
 * that class's study priority to zero — exactly the leak the weekly report exists to surface — so it
 * fails loudly, as bank.ts does on a node with no provenance.
 */
export function reachWeightedLoss(
  decisions: readonly ClassDecision[],
  reach: ReachTable,
): RwReport {
  const sums = new Map<ClassKey, { street: Street; actionClass: ActionClass; sum: number; count: number }>();
  for (const decision of decisions) {
    const key = classKey(decision.street, decision.actionClass);
    const bucket = sums.get(key);
    if (bucket === undefined) {
      sums.set(key, {
        street: decision.street,
        actionClass: decision.actionClass,
        sum: decision.deltaEvBb,
        count: 1,
      });
    } else {
      bucket.sum += decision.deltaEvBb;
      bucket.count += 1;
    }
  }

  const classes: ClassRw[] = [];
  for (const [key, bucket] of sums) {
    const classReach = reach.byClass.get(key);
    if (classReach === undefined) {
      throw new Error(`no reach for decided class ${key} in reference population ${reach.referencePopId}`);
    }
    const meanDeltaEvBb = bucket.sum / bucket.count;
    classes.push(
      Object.freeze({
        street: bucket.street,
        actionClass: bucket.actionClass,
        meanDeltaEvBb,
        reach: classReach,
        rw: meanDeltaEvBb * classReach * 100,
        decisions: bucket.count,
      }),
    );
  }

  // Study-priority ordering: worst RW first, ties broken on the key so the order is deterministic and
  // does not depend on decision arrival order (mirrors reads.ts `rankNodes`).
  classes.sort(
    (a, b) =>
      b.rw - a.rw ||
      classKey(a.street, a.actionClass).localeCompare(classKey(b.street, b.actionClass)),
  );

  return Object.freeze({ referencePopId: reach.referencePopId, classes: Object.freeze(classes) });
}

/**
 * Scoreboard metric #2 (P1): the single assessment-mode RW figure, in bb/100. It is the sum of the
 * per-class reach-weighted losses — total expected loss per 100 hands across every class that acted —
 * which is the coherent aggregate of the class-level figures G2 defines.
 */
export function scoreboardRw(report: RwReport): number {
  return report.classes.reduce((total, klass) => total + klass.rw, 0);
}

/**
 * G8's lookup: the class-level RW the remediation queue ranks by (confidence × class-level RW). Zero
 * when the class saw no decisions this session — it contributed no loss, so it multiplies out — which
 * is distinct from the load error `reachWeightedLoss` throws for a decided class with no reach.
 */
export function rwFor(report: RwReport, street: Street, actionClass: ActionClass): number {
  const key = classKey(street, actionClass);
  const match = report.classes.find(
    (klass) => classKey(klass.street, klass.actionClass) === key,
  );
  return match === undefined ? 0 : match.rw;
}
