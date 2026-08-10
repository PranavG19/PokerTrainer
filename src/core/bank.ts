/**
 * ON-BANK / OFF-BANK, AND THE REFUSAL TO GRADE — PRODUCT-SPEC B4, story 27, B2, T8.
 *
 * B4: "Off-bank positions are never graded. They get bots and explicit silence: *'ungraded — no
 * solver data for this node.'* Equity is not displayed pre-commit anywhere (see T8). This is the
 * method's own epistemology made structural: in spots you've never had graded, you have a hunch, not
 * an intuition." Story 27 states the failure it prevents: "I want to be told it's ungraded rather
 * than given a fabricated grade."
 *
 * WHY THIS MODULE EXISTS AT ALL. coach.ts grades whatever it is handed. It reads no bank — it
 * computes a Monte-Carlo pot share and derives an evLossBb from pot odds — so for a node with no
 * solver data it returns a fully-formed `Grade` with a `severity` and a bb number anyway. That
 * return value is story 27's fabricated grade, and it is fabricated in the specific sense B4 names:
 * the number is a hunch presented in the typography of an intuition. This module does not fix
 * coach.ts (grading on-bank is its job); it gives callers a way to *refuse* — a result type with no
 * severity and no number on it, so the refusal is not something a caller has to remember.
 *
 * THE UNION IS THE MECHANISM. `NodeGrading` is discriminated on `kind`. The 'ungraded' arm carries
 * exactly a node key and the notice: no `grade`, no `severity`, no `evLossBb`, and — T8 — no equity.
 * There is no numeric grade to read off it, so "off-bank came back as 0 bb / free / correct" is a
 * type error rather than a bug found later on screen. `gradeNode` additionally never *invokes* the
 * grader for an off-bank node, so the fabricated number is never computed, not merely discarded.
 *
 * MIXED (B2) IS NOT THIS. "Where two configs disagree materially at a node, the app surfaces the
 * disagreement and grades the node as mixed rather than picking a winner." Mixed is a graded
 * outcome about a node that *is* in the bank and has too much data to reduce to one answer;
 * off-bank has none. They are separate arms of the union and neither is assignable to the other.
 *
 * WHAT SAYS WHICH NODES ARE IN THE BANK. Nothing in this app records that today: no solves are
 * built (B5 targets 200–400, B1b costs them at 10–19 hours), and a grep of src/core finds no
 * on-bank concept at all. So the input is documented rather than invented: a `BankIndex` — the
 * read-only index of node keys the shipped bank contains, keyed the way the spec's capacity table
 * says the bank is keyed ("indexed by `nodeKey`"), carrying B2's mandatory per-node provenance.
 * `EMPTY_BANK_INDEX` is what this build actually has, and it is honest: with no solves, every node
 * is off-bank and B4's silence is the only correct output the app can produce. This mirrors
 * contrastManifest.ts, which models "what the build actually contains" as authored data and reports
 * the gaps instead of searching for a substitute.
 */

import type { Grade, Severity } from './coach.js';

/**
 * B4's string, verbatim, including the em dash and the final period — both sit inside the spec's
 * quotation marks. This is a promise to the learner, so it is a constant and not a template: a
 * paraphrase at one call site would be a different promise at that one screen.
 *
 * It is a fact about the bank ("no solver data for this node"), not a judgement of the learner and
 * not an apology. B4's rationale is why: the learner has a hunch here, and the honest thing to say
 * is what the bank lacks, not how they did.
 */
export const UNGRADED_NOTICE = 'ungraded — no solver data for this node.';

/** The bank's key. Opaque to this module: it compares keys, it never parses them. */
export type NodeKey = string;

/**
 * The vocabulary table's definition of a node, spelled out: "a decision point: `(positions × action
 * history × board class × size bucket)`". Four parts, so a key is derived from the spec rather than
 * chosen here.
 */
export interface NodeDescriptor {
  readonly positions: string;
  readonly actionHistory: string;
  readonly boardClass: string;
  readonly sizeBucket: string;
}

const KEY_SEPARATOR = '|';

/**
 * Joins a descriptor into a key.
 *
 * Throws on a part containing the separator, because collapsing two distinct nodes onto one key is
 * the one failure that turns this module against itself: an off-bank node that collides with an
 * on-bank key would be graded, which is exactly what B4 forbids.
 */
export function nodeKeyOf(descriptor: NodeDescriptor): NodeKey {
  const parts = [
    descriptor.positions,
    descriptor.actionHistory,
    descriptor.boardClass,
    descriptor.sizeBucket,
  ];
  for (const part of parts) {
    if (part.includes(KEY_SEPARATOR)) {
      throw new Error(
        `node key part ${JSON.stringify(part)} contains ${KEY_SEPARATOR}, which would collide with another node`,
      );
    }
  }
  return parts.join(KEY_SEPARATOR);
}

/** B2's mandatory per-node provenance, one record per solver config that solved the node. */
export interface NodeProvenance {
  readonly solverConfigId: string;
  /** B2's "tree description (bet sizes, depth)". */
  readonly tree: string;
  readonly iterations: number;
  readonly exploitability: number;
  readonly referencePopId: string;
}

/**
 * B2's material disagreement between two configs, as recorded by the build.
 *
 * Materiality is decided at build time and shipped, not recomputed here. Two reasons: B2 never
 * defines the threshold, and B1c puts the data a runtime check would need (per-config continuation
 * values, mixed-node support detection) in the multi-GB subtree set that is explicitly not shipped.
 * So the app surfaces a disagreement the build found; it does not discover one.
 */
export interface Disagreement {
  readonly configIds: readonly string[];
  readonly detail: string;
}

export interface BankNode {
  readonly nodeKey: NodeKey;
  readonly provenance: readonly NodeProvenance[];
  /** Non-null makes the node mixed (B2). Null means the configs agree. */
  readonly disagreement: Disagreement | null;
}

/** The read-only artifact B0 calls the spot bank, reduced to what "is this node on-bank?" needs. */
export interface BankIndex {
  /** Recorded on every decision so a bank upgrade never re-tiers history (edge case, line 445). */
  readonly bankVersion: string;
  readonly nodes: ReadonlyMap<NodeKey, BankNode>;
}

/**
 * Builds an index. Throws on a duplicate key: two entries for one node means one of them is silently
 * unreachable, and which one wins would decide a grade.
 */
export function bankIndex(bankVersion: string, nodes: readonly BankNode[]): BankIndex {
  const byKey = new Map<NodeKey, BankNode>();
  for (const node of nodes) {
    if (byKey.has(node.nodeKey)) {
      throw new Error(`bank index has two entries for node ${node.nodeKey}`);
    }
    if (node.provenance.length === 0) {
      // An on-bank node with no provenance is a node with no solver data, which is the definition of
      // off-bank. Admitting it to the index would make `lookupNode` say on-bank about a node that
      // cannot be graded — B4's failure with extra steps.
      throw new Error(`bank node ${node.nodeKey} carries no provenance, so it has no solver data (B2)`);
    }
    if (node.disagreement !== null && node.provenance.length < 2) {
      // B2's mixed case is two configs disagreeing. A node claiming a disagreement while only one
      // config ever solved it has no second opinion to surface, so "mixed" there would be a label
      // with nothing behind it.
      throw new Error(
        `bank node ${node.nodeKey} claims a disagreement but only ${node.provenance.length} config(s) solved it`,
      );
    }
    byKey.set(node.nodeKey, node);
  }
  return { bankVersion, nodes: byKey };
}

/**
 * What this build ships: no solves. B5 targets 200–400 and B1b prices them at 10–19 hours of wall
 * clock, so the bank is a later increment (the shipping order at line 511 puts "the bank build"
 * after Table + bots). Until then every node is off-bank and the whole app is B4's case.
 */
export const EMPTY_BANK_INDEX: BankIndex = bankIndex('none', []);

export type NodeLookup =
  | { readonly status: 'on-bank'; readonly node: BankNode }
  | {
      readonly status: 'off-bank';
      readonly nodeKey: NodeKey;
      readonly notice: typeof UNGRADED_NOTICE;
    };

export function lookupNode(index: BankIndex, nodeKey: NodeKey): NodeLookup {
  const node = index.nodes.get(nodeKey);
  if (node === undefined) return { status: 'off-bank', nodeKey, notice: UNGRADED_NOTICE };
  return { status: 'on-bank', node };
}

export function isOnBank(index: BankIndex, nodeKey: NodeKey): boolean {
  return index.nodes.has(nodeKey);
}

/**
 * The three outcomes a node can have. Discriminated so a caller cannot reach a severity without
 * having handled the ungraded case.
 *
 * The 'ungraded' arm deliberately carries no `grade`, no number of any kind, and no equity: T8 says
 * equity is shown post-reveal in Spot mode, post-hand at the Table, and never in assessment, so a
 * pre-commit off-bank result has nothing numeric to leak.
 */
export type NodeGrading =
  | {
      readonly kind: 'graded';
      readonly nodeKey: NodeKey;
      readonly grade: Grade;
      readonly solverConfigIds: readonly string[];
    }
  | {
      readonly kind: 'mixed';
      readonly nodeKey: NodeKey;
      /**
       * Mixed is graded (B2). G9's second channel — weight scored at exactly zero, with the line
       * explaining that the solver mixes because the actions are worth the same — needs the
       * unshipped subtree set (B1c), so this carries the support channel only.
       */
      readonly grade: Grade;
      readonly disagreement: Disagreement;
    }
  | {
      readonly kind: 'ungraded';
      readonly nodeKey: NodeKey;
      readonly notice: typeof UNGRADED_NOTICE;
    };

/**
 * The gate. On-bank nodes are graded by `gradeOnBank`; off-bank nodes return B4's silence.
 *
 * `gradeOnBank` is a callback rather than a `Grade` argument on purpose. A caller that computed the
 * grade first and passed it in would already have fabricated the number this exists to prevent —
 * and coach.ts will happily produce one for any node. Off-bank, the grader is never invoked.
 */
export function gradeNode(
  index: BankIndex,
  nodeKey: NodeKey,
  gradeOnBank: (node: BankNode) => Grade,
): NodeGrading {
  const lookup = lookupNode(index, nodeKey);
  if (lookup.status === 'off-bank') {
    return { kind: 'ungraded', nodeKey, notice: UNGRADED_NOTICE };
  }
  const { node } = lookup;
  const grade = gradeOnBank(node);
  if (node.disagreement !== null) {
    return { kind: 'mixed', nodeKey, grade, disagreement: node.disagreement };
  }
  return {
    kind: 'graded',
    nodeKey,
    grade,
    solverConfigIds: node.provenance.map((record) => record.solverConfigId),
  };
}

/**
 * `null` for an ungraded node, and null is the only thing it can be: there is no severity to invent
 * and no zero to substitute, since 'free' is a graded verdict meaning "this was fine".
 */
export function severityOf(outcome: NodeGrading): Severity | null {
  return outcome.kind === 'ungraded' ? null : outcome.grade.severity;
}

/**
 * The edge-case table, off-bank at the Table: "No grade, explicit 'ungraded' marker, equity shown
 * only after the hand (T8). **Not logged as a decision.**" An ungraded outcome must not enter the
 * decision log, or the mastery posteriors would be updated from a node with no solver data.
 */
export function isLoggableDecision(outcome: NodeGrading): boolean {
  return outcome.kind !== 'ungraded';
}
