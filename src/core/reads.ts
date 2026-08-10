/**
 * READS AND DEVIATION — PRODUCT-SPEC R1-R5 and O4.
 *
 * The read-gating arithmetic. Every number here exists to stop the learner deviating on noise.
 *
 * THE TRAP THIS MODULE EXISTS TO REMOVE: shrinkage (`w = n/(n+10)`) is SIGN-PRESERVING. It scales
 * the size of a deviation but never its direction, so it is a MAGNITUDE control and NEVER a
 * go/no-go control. A learner who believes shrinkage protects them from a bad read has exactly the
 * misconception this module removes: at n=3 the weight is still 0.23, which is a real deviation in
 * the wrong direction, not a safe one. Safety comes only from the two go/no-go gates below, which
 * are independent of `w` and of each other.
 *
 * Nothing here reads the clock or the RNG. `expireSession` takes the reads rather than a timestamp,
 * and the false-read arithmetic is exact binomial rather than simulated, so every figure this file
 * reports is reproducible.
 */

/** R1 go/no-go gate 1: observations of that observable. */
export const MIN_OBSERVATIONS = 20;

/** R1 go/no-go gate 2: raw frequency distance from baseline, in percentage points. */
export const DEVIATION_THRESHOLD_POINTS = 15;

/** R1 magnitude: the `+10` in `w = n/(n+10)`. Ten pseudo-observations of "he is baseline". */
export const SHRINKAGE_PRIOR = 10;

/** R3: breadth cap, and node-selection cap. */
export const MAX_ACTIVE_DEVIATIONS = 3;
export const MAX_DEVIATION_NODES = 2;

/** R4: mechanical revert triggers. No judgment call anywhere in this file. */
export const COUNTER_ACTIONS_TO_HALVE = 2;
export const COUNTER_ACTIONS_TO_BASELINE = 3;
export const CONTRARY_OBSERVATIONS_TO_CLOSE = 6;

/** O4: the calibration curve is withheld below this many forecasts. */
export const CALIBRATION_RELEASE_FORECASTS = 400;

/** Frequencies are compared in percentage points, where 0.65 - 0.5 lands 2e-15 above 15. */
const EPSILON = 1e-9;

export interface Read {
  /** The named tendency, e.g. "folds to turn probe". R3 bans unnamed "play looser against him". */
  readonly id: string;
  readonly n: number;
  readonly observedFrequency: number;
  readonly baselineFrequency: number;
  /** R2: only a tendency written down at session start can license a deviation. */
  readonly preRegistered: boolean;
  /** R4 counters. Both are session-scoped and both reset at session end. */
  readonly counterActions: number;
  readonly contraryObservations: number;
  /** Signed bb the full (unshrunk) exploit is worth. Sign is the direction of the deviation. */
  readonly fullExploitBb: number;
}

export interface Gates {
  /** Signed distance from baseline in percentage points. */
  readonly deviationPoints: number;
  readonly sampleGate: boolean;
  readonly deviationGate: boolean;
  /** Both gates, and only both. Neither one alone licenses anything. */
  readonly licensed: boolean;
}

export function deviationPoints(read: Read): number {
  return (read.observedFrequency - read.baselineFrequency) * 100;
}

/**
 * R1's two go/no-go gates, evaluated independently. `w` is deliberately absent: no value of the
 * shrinkage weight can open or close a gate.
 */
export function gates(read: Read): Gates {
  const points = deviationPoints(read);
  const sampleGate = read.n >= MIN_OBSERVATIONS;
  const deviationGate = Math.abs(points) >= DEVIATION_THRESHOLD_POINTS - EPSILON;
  return {
    deviationPoints: points,
    sampleGate,
    deviationGate,
    licensed: sampleGate && deviationGate,
  };
}

/** `w = n/(n+10)`. Monotone in n, never zero for n > 0, never 1. Magnitude only. */
export function shrinkageWeight(n: number): number {
  if (n <= 0) return 0;
  return n / (n + SHRINKAGE_PRIOR);
}

/**
 * The deviation actually applied: `w x full exploit`.
 *
 * Sign-preserving by construction — `shrinkageWeight` is non-negative, so this cannot flip a wrong
 * read into a harmless one. It only makes it smaller.
 */
export function appliedDeviation(fullExploitBb: number, n: number): number {
  return shrinkageWeight(n) * fullExploitBb;
}

export type RevertTrigger = 'counter-actions-halved' | 'reverted-to-baseline' | 'gate-re-closed';

export interface RevertState {
  /** 1, 0.5, or 0. Applied on top of `w`. */
  readonly weightMultiplier: number;
  /** `w x multiplier`; 0 means play baseline. */
  readonly effectiveWeight: number;
  readonly revertedToBaseline: boolean;
  readonly gateReClosed: boolean;
  readonly triggers: readonly RevertTrigger[];
}

/**
 * R4. Ordered most-severe first so a read with three counter-actions is at baseline rather than
 * merely halved.
 */
export function revertState(read: Read): RevertState {
  const w = shrinkageWeight(read.n);
  const triggers: RevertTrigger[] = [];

  const gateReClosed = read.contraryObservations >= CONTRARY_OBSERVATIONS_TO_CLOSE;
  if (gateReClosed) triggers.push('gate-re-closed');

  const revertedToBaseline = read.counterActions >= COUNTER_ACTIONS_TO_BASELINE;
  if (revertedToBaseline) triggers.push('reverted-to-baseline');

  if (gateReClosed || revertedToBaseline) {
    return { weightMultiplier: 0, effectiveWeight: 0, revertedToBaseline, gateReClosed, triggers };
  }

  if (read.counterActions >= COUNTER_ACTIONS_TO_HALVE) {
    triggers.push('counter-actions-halved');
    return {
      weightMultiplier: 0.5,
      effectiveWeight: w * 0.5,
      revertedToBaseline: false,
      gateReClosed: false,
      triggers,
    };
  }

  return {
    weightMultiplier: 1,
    effectiveWeight: w,
    revertedToBaseline: false,
    gateReClosed: false,
    triggers,
  };
}

/**
 * R4 session end: all reads expire and `n` resets to zero. Pre-registration survives only as the
 * written hypothesis — the evidence does not, so next session starts from fresh data.
 */
export function expireSession(reads: readonly Read[]): Read[] {
  return reads.map((read) => ({
    ...read,
    n: 0,
    counterActions: 0,
    contraryObservations: 0,
  }));
}

export interface ExploitNode {
  readonly id: string;
  /** Fraction of hands reaching this node. */
  readonly reach: number;
  readonly bbPerOccurrence: number;
}

export function nodeValue(node: ExploitNode): number {
  return node.reach * node.bbPerOccurrence;
}

/** R3 ranking. Ties break on id so a plan is deterministic. */
export function rankNodes(nodes: readonly ExploitNode[]): ExploitNode[] {
  return [...nodes].sort((a, b) => nodeValue(b) - nodeValue(a) || a.id.localeCompare(b.id));
}

export function selectDeviationNodes(nodes: readonly ExploitNode[]): ExploitNode[] {
  return rankNodes(nodes).slice(0, MAX_DEVIATION_NODES);
}

export type DropReason =
  | 'sample-gate'
  | 'deviation-gate'
  | 'not-pre-registered'
  | 'gate-re-closed'
  | 'reverted-to-baseline'
  | 'breadth-cap';

export interface ActiveDeviation {
  readonly readId: string;
  readonly weight: number;
  readonly appliedBb: number;
  /** The top two nodes by `reach x bb per occurrence`, and nowhere else. */
  readonly nodeIds: readonly string[];
}

export interface DeviationPlan {
  readonly active: readonly ActiveDeviation[];
  readonly dropped: readonly { readId: string; reason: DropReason }[];
  readonly nodeIds: readonly string[];
}

/**
 * R3 + R2 + R4 composed: which named deviations are live this session, and at which nodes.
 *
 * Over the breadth cap, the largest applied deviations survive — spreading the budget evenly is the
 * random-node-selection policy R3 bans.
 */
export function planDeviations(
  reads: readonly Read[],
  nodes: readonly ExploitNode[],
): DeviationPlan {
  const nodeIds = selectDeviationNodes(nodes).map((n) => n.id);
  const dropped: { readId: string; reason: DropReason }[] = [];
  const candidates: ActiveDeviation[] = [];

  for (const read of reads) {
    const g = gates(read);
    if (!read.preRegistered) {
      dropped.push({ readId: read.id, reason: 'not-pre-registered' });
      continue;
    }
    if (!g.sampleGate) {
      dropped.push({ readId: read.id, reason: 'sample-gate' });
      continue;
    }
    if (!g.deviationGate) {
      dropped.push({ readId: read.id, reason: 'deviation-gate' });
      continue;
    }
    const revert = revertState(read);
    if (revert.gateReClosed) {
      dropped.push({ readId: read.id, reason: 'gate-re-closed' });
      continue;
    }
    if (revert.revertedToBaseline) {
      dropped.push({ readId: read.id, reason: 'reverted-to-baseline' });
      continue;
    }
    candidates.push({
      readId: read.id,
      weight: revert.effectiveWeight,
      appliedBb: revert.effectiveWeight * read.fullExploitBb,
      nodeIds,
    });
  }

  const ranked = [...candidates].sort(
    (a, b) => Math.abs(b.appliedBb) - Math.abs(a.appliedBb) || a.readId.localeCompare(b.readId),
  );
  const active = ranked.slice(0, MAX_ACTIVE_DEVIATIONS);
  for (const over of ranked.slice(MAX_ACTIVE_DEVIATIONS)) {
    dropped.push({ readId: over.readId, reason: 'breadth-cap' });
  }

  return { active, dropped, nodeIds };
}

export interface Forecast {
  readonly nodeId: string;
  /** Learner's probability that the action occurs. */
  readonly forecast: number;
  /** The bot's true frequency at that node — known here, unlike in the research literature. */
  readonly nodeBaseRate: number;
  readonly occurred: boolean;
}

export interface ReadAccuracy {
  readonly forecasts: number;
  readonly brier: number;
  readonly baseRateBrier: number;
  readonly uniformBrier: number;
  /** 1 - brier/reference. Positive means the learner beat that reference. */
  readonly skillVsBaseRate: number;
  readonly skillVsUniform: number;
  readonly calibrationReleasable: boolean;
}

function meanSquaredError(forecasts: readonly Forecast[], predict: (f: Forecast) => number): number {
  if (forecasts.length === 0) return 0;
  const total = forecasts.reduce((sum, f) => sum + (predict(f) - (f.occurred ? 1 : 0)) ** 2, 0);
  return total / forecasts.length;
}

/** A perfect reference leaves no room to improve on, so matching it is zero skill, not infinite. */
function skill(brier: number, reference: number): number {
  if (reference === 0) return brier === 0 ? 0 : Number.NEGATIVE_INFINITY;
  return 1 - brier / reference;
}

/**
 * O4. Graded against the NODE BASE RATE, not against uniform, because beating uniform is arithmetic
 * — any node whose true frequency is far from 50% hands the learner a positive score for knowing
 * nothing about the opponent. Only beating the base rate is a read. `skillVsUniform` is exposed so
 * the two can be shown side by side and the gap taught.
 */
export function readAccuracy(forecasts: readonly Forecast[]): ReadAccuracy {
  const brier = meanSquaredError(forecasts, (f) => f.forecast);
  const baseRateBrier = meanSquaredError(forecasts, (f) => f.nodeBaseRate);
  const uniformBrier = meanSquaredError(forecasts, () => 0.5);
  return {
    forecasts: forecasts.length,
    brier,
    baseRateBrier,
    uniformBrier,
    skillVsBaseRate: skill(brier, baseRateBrier),
    skillVsUniform: skill(brier, uniformBrier),
    calibrationReleasable: forecasts.length >= CALIBRATION_RELEASE_FORECASTS,
  };
}

/** Exact binomial pmf over 0..n by the ratio recurrence — no factorials, so no overflow. */
function binomialPmf(n: number, p: number): number[] {
  if (p <= 0) return Array.from({ length: n + 1 }, (_, x) => (x === 0 ? 1 : 0));
  if (p >= 1) return Array.from({ length: n + 1 }, (_, x) => (x === n ? 1 : 0));

  const pmf = new Array<number>(n + 1);
  pmf[0] = (1 - p) ** n;
  const odds = p / (1 - p);
  for (let x = 0; x < n; x++) pmf[x + 1] = (pmf[x] * (n - x) * odds) / (x + 1);
  return pmf;
}

/**
 * R2's arithmetic, one observable: the chance a genuinely BASELINE opponent shows a deviation of at
 * least `thresholdPoints` on `n` observations. This is the false-read rate per stat.
 *
 * Compared in counts (`|x - p*n| >= t*n`) rather than frequencies, because at n=20 and p=0.5 the
 * frequency form silently excludes x=7 while including x=13 — the same 15-point deviation, one of
 * which rounds below the threshold in binary floating point.
 */
export function deviationProbability(
  n: number,
  baseline: number,
  thresholdPoints: number = DEVIATION_THRESHOLD_POINTS,
): number {
  if (n <= 0) return 0;
  const pmf = binomialPmf(n, baseline);
  const threshold = (thresholdPoints / 100) * n;
  const expected = baseline * n;
  let total = 0;
  for (let x = 0; x <= n; x++) {
    if (Math.abs(x - expected) >= threshold - EPSILON) total += pmf[x];
  }
  return total;
}

export interface FalseReadRate {
  readonly perObservable: number;
  /** P(at least one of k observables looks exploitable) = 1 - (1 - perObservable)^k. */
  readonly atLeastOne: number;
}

/**
 * R2's headline number, computed rather than asserted: scan `observables` independent stats at `n`
 * observations each on a baseline opponent, and this is the chance at least one of them looks like a
 * read. Independence across stats is the spec's own model and is optimistic — real leaks correlate,
 * which makes the joint rate somewhat lower than this.
 */
export function falseReadProbability(
  observables: number,
  n: number,
  baseline = 0.5,
  thresholdPoints: number = DEVIATION_THRESHOLD_POINTS,
): FalseReadRate {
  const perObservable = deviationProbability(n, baseline, thresholdPoints);
  if (observables <= 0) return { perObservable, atLeastOne: 0 };
  return { perObservable, atLeastOne: 1 - (1 - perObservable) ** observables };
}
