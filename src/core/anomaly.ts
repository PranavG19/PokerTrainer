/**
 * THE ANOMALY TRIGGER — PRODUCT-SPEC O8, plus the PLM machinery it hangs off (fluency gate,
 * stimulus exhaustion, error tagging).
 *
 * O8's claim is that the two-speed switch is INSTALLED, NOT TAUGHT. The default speed recognises
 * `node + texture + role` and plays the trained line; deliberate thought is engaged only when a slot
 * is anomalous. A paragraph explaining that installs nothing — what installs it is a phase-1 PLM
 * where the learner sees mostly standard slots and has to notice the 15% that are not. So this file
 * is a stimulus generator and a grader, not a lesson.
 *
 * The four trigger categories are the spec's explicit list, and an anomalous stimulus is always
 * exactly ONE feature off: sizing off the trained tree, a texture class outside the trained
 * taxonomy, a stack depth outside 40/100/200, or a read that contradicts the frame. One-feature
 * deviation is deliberate — a stimulus with three things wrong teaches "something feels off", which
 * is the intuition the learner already has, rather than which dimension to look at.
 *
 * Nothing here reads the clock or the global RNG. Every draw takes a seed and every grade takes the
 * measured response times as data, because a drill you cannot replay is a drill you cannot test.
 */

import { mulberry32, type Rng } from './rng';

// ---------------------------------------------------------------------------
// 1. THE TRIGGER LIST AND THE TRAINED RANGES
// ---------------------------------------------------------------------------

export type TriggerCategory =
  | 'off-tree-sizing'
  | 'unfamiliar-texture'
  | 'stack-depth-outside-range'
  | 'read-contradicts-frame';

export const TRIGGER_CATEGORIES: readonly TriggerCategory[] = [
  'off-tree-sizing',
  'unfamiliar-texture',
  'stack-depth-outside-range',
  'read-contradicts-frame',
];

/** O8: 15% of slots are anomalous. Low on purpose — the skill is noticing, not sorting a 50/50. */
export const ANOMALY_RATE = 0.15;

/** Q1 interleaves 40/100/200, so those three depths are what "trained range" means. */
export const TRAINED_DEPTHS_BB: readonly number[] = [40, 100, 200];
/** The solved bet-size set. Anything else is off-tree by definition (B6: the tree is a build input). */
export const TRAINED_SIZINGS_PCT: readonly number[] = [33, 75, 125];
/** P2's taxonomy. A board outside these three classes has no trained line to recognise. */
export const TRAINED_TEXTURES = ['static', 'semi', 'dynamic'] as const;

const UNTRAINED_TEXTURES = ['paired-monotone', 'four-to-a-straight', 'double-paired'] as const;
const OFF_TREE_SIZINGS_PCT: readonly number[] = [15, 45, 250];
const OUTSIDE_RANGE_DEPTHS_BB: readonly number[] = [12, 25, 350];

export type TextureLabel = (typeof TRAINED_TEXTURES)[number] | (typeof UNTRAINED_TEXTURES)[number];

/** Reads the frame already predicts. Present in standard slots so "a read exists" is not the cue. */
const FRAME_CONSISTENT_READS: readonly string[] = [
  'no read',
  'c-bets flop at a normal clip',
  'checks back weak on dry boards',
];

const CONTRADICTING_READS: readonly string[] = [
  'frame says overfolds turn — has not folded a turn all session',
  'frame says never bluffs river — showed two river bluffs',
  'frame says opens 12% — has opened 40% since sitting',
];

/** Trained nodes. The held-out pair is withheld from the main pool so transfer can be measured. */
const TRAINED_NODES: readonly string[] = [
  'BTN vs BB srp',
  'CO vs BTN 3bet',
  'SB vs BB srp',
  'UTG vs CO srp',
];
const HELD_OUT_NODES: readonly string[] = ['LJ vs BB srp', 'BB vs BTN 4bet'];

// ---------------------------------------------------------------------------
// 2. STIMULI
// ---------------------------------------------------------------------------

export interface AnomalyStimulus {
  /** Stable and unique within its category — this is what the seen-set stores. */
  readonly id: string;
  readonly category: TriggerCategory;
  readonly node: string;
  readonly textureClass: TextureLabel;
  readonly stackDepthBb: number;
  readonly sizingPctPot: number;
  readonly read: string;
  /** The oracle for `is this standard? y/n`. */
  readonly anomalous: boolean;
  /** Which trigger fired, labelled per O8. Null on standard slots. */
  readonly trigger: TriggerCategory | null;
  /** True for the held-out set served after a category is exhausted. */
  readonly transfer: boolean;
  readonly prompt: string;
}

const promptFor = (s: Omit<AnomalyStimulus, 'prompt'>): string =>
  `${s.node} · ${s.textureClass} · ${s.stackDepthBb} bb · ${s.sizingPctPot}% pot · ${s.read} — standard?`;

const withPrompt = (s: Omit<AnomalyStimulus, 'prompt'>): AnomalyStimulus => ({ ...s, prompt: promptFor(s) });

/**
 * Standard slots: every feature drawn from a trained set. Built as a full cross product of
 * node × texture × depth so the standard majority is genuinely varied — if standard slots repeated
 * a handful of surfaces, the learner would learn those surfaces instead of the trained ranges.
 */
function standardStimuli(category: TriggerCategory, nodes: readonly string[], tag: string): AnomalyStimulus[] {
  const out: AnomalyStimulus[] = [];
  nodes.forEach((node, nodeIndex) => {
    TRAINED_TEXTURES.forEach((textureClass, textureIndex) => {
      TRAINED_DEPTHS_BB.forEach((stackDepthBb, depthIndex) => {
        const spread = nodeIndex + textureIndex + depthIndex;
        out.push(
          withPrompt({
            id: `${category}/${tag}/${nodeIndex}-${textureIndex}-${depthIndex}`,
            category,
            node,
            textureClass,
            stackDepthBb,
            sizingPctPot: TRAINED_SIZINGS_PCT[spread % TRAINED_SIZINGS_PCT.length],
            read: FRAME_CONSISTENT_READS[spread % FRAME_CONSISTENT_READS.length],
            anomalous: false,
            trigger: null,
            transfer: tag === 'transfer-std',
          }),
        );
      });
    });
  });
  return out;
}

/** One feature off, and only one. `deviations` are that category's off-values. */
function anomalousStimuli(
  category: TriggerCategory,
  nodes: readonly string[],
  deviations: readonly (string | number)[],
  tag: string,
): AnomalyStimulus[] {
  const out: AnomalyStimulus[] = [];
  nodes.forEach((node, nodeIndex) => {
    deviations.forEach((deviation, deviationIndex) => {
      const spread = nodeIndex + deviationIndex;
      const base: Omit<AnomalyStimulus, 'prompt'> = {
        id: `${category}/${tag}/${nodeIndex}-${deviationIndex}`,
        category,
        node,
        textureClass: TRAINED_TEXTURES[spread % TRAINED_TEXTURES.length],
        stackDepthBb: TRAINED_DEPTHS_BB[spread % TRAINED_DEPTHS_BB.length],
        sizingPctPot: TRAINED_SIZINGS_PCT[spread % TRAINED_SIZINGS_PCT.length],
        read: FRAME_CONSISTENT_READS[spread % FRAME_CONSISTENT_READS.length],
        anomalous: true,
        trigger: category,
        transfer: tag === 'transfer-anom',
      };

      const deviated: Omit<AnomalyStimulus, 'prompt'> =
        category === 'off-tree-sizing'
          ? { ...base, sizingPctPot: deviation as number }
          : category === 'unfamiliar-texture'
            ? { ...base, textureClass: deviation as TextureLabel }
            : category === 'stack-depth-outside-range'
              ? { ...base, stackDepthBb: deviation as number }
              : { ...base, read: deviation as string };

      out.push(withPrompt(deviated));
    });
  });
  return out;
}

const DEVIATIONS: Record<TriggerCategory, readonly (string | number)[]> = {
  'off-tree-sizing': OFF_TREE_SIZINGS_PCT,
  'unfamiliar-texture': UNTRAINED_TEXTURES,
  'stack-depth-outside-range': OUTSIDE_RANGE_DEPTHS_BB,
  'read-contradicts-frame': CONTRADICTING_READS,
};

/**
 * The trainable pool for one category: 36 standard + 6 anomalous. The 6 is not the anomaly rate —
 * the rate is a coin, see `drawStimulus` — it is how many distinct one-feature deviations exist for
 * that trigger, and it is why exhaustion is a real state rather than a theoretical one.
 */
export function stimulusPool(category: TriggerCategory): readonly AnomalyStimulus[] {
  return [
    ...standardStimuli(category, TRAINED_NODES, 'std'),
    ...anomalousStimuli(category, TRAINED_NODES, DEVIATIONS[category], 'anom'),
  ];
}

/**
 * Held-out transfer stimuli: the same triggers at nodes never used in training. Reserved rather than
 * merged in, so "did the trigger generalise past the surfaces it was drilled on?" stays answerable.
 */
export function transferPool(category: TriggerCategory): readonly AnomalyStimulus[] {
  return [
    ...standardStimuli(category, HELD_OUT_NODES, 'transfer-std'),
    ...anomalousStimuli(category, HELD_OUT_NODES, DEVIATIONS[category], 'transfer-anom'),
  ];
}

// ---------------------------------------------------------------------------
// 3. DRAWING, WITH THE SEEN-SET AND THE EXHAUSTION PATH
// ---------------------------------------------------------------------------

export const DISABLED_MESSAGE =
  'Anomaly trigger drill is disabled: every stimulus in this category, including the held-out transfer set, has been seen. Repeating one would measure memory of the item, not the trigger.';

export const EXHAUSTED_MESSAGE =
  'Category exhausted — now serving held-out transfer stimuli at untrained nodes.';

export interface Draw {
  /** Null only when the drill is disabled. */
  readonly stimulus: AnomalyStimulus | null;
  /** True once the main pool is used up, whether or not transfer stimuli remain. */
  readonly categoryExhausted: boolean;
  readonly disabled: boolean;
  /** G3 silence applies to grading, not to system state: an exhausted pool is worth saying. */
  readonly message: string | null;
}

/**
 * Prefer the side the coin asked for; take the other side rather than repeat an id. The no-repeat
 * invariant outranks the 15% rate, because a repeated stimulus stops measuring the trigger at all
 * whereas a block that runs slightly hot or cold on anomalies still measures it.
 */
function choose(available: readonly AnomalyStimulus[], wantAnomaly: boolean, rng: Rng): AnomalyStimulus {
  const preferred = available.filter((s) => s.anomalous === wantAnomaly);
  const from = preferred.length > 0 ? preferred : available;
  return from[Math.min(from.length - 1, Math.floor(rng() * from.length))];
}

/**
 * One stimulus for one category. `seen` holds ids already shown IN THIS CATEGORY — the seen-set is
 * per category because the same node/texture/depth surface legitimately recurs across categories
 * with a different feature deviated.
 */
export function drawStimulus(
  seed: number,
  category: TriggerCategory,
  seen: ReadonlySet<string> = new Set(),
): Draw {
  const rng = mulberry32(seed);
  const wantAnomaly = rng() < ANOMALY_RATE;

  const unseenMain = stimulusPool(category).filter((s) => !seen.has(s.id));
  if (unseenMain.length > 0) {
    return {
      stimulus: choose(unseenMain, wantAnomaly, rng),
      categoryExhausted: false,
      disabled: false,
      message: null,
    };
  }

  const unseenTransfer = transferPool(category).filter((s) => !seen.has(s.id));
  if (unseenTransfer.length > 0) {
    return {
      stimulus: choose(unseenTransfer, wantAnomaly, rng),
      categoryExhausted: true,
      disabled: false,
      message: EXHAUSTED_MESSAGE,
    };
  }

  return { stimulus: null, categoryExhausted: true, disabled: true, message: DISABLED_MESSAGE };
}

/**
 * A block of draws that maintains its own seen-set, ending early on the disabled draw. Returned as
 * draws rather than stimuli so the caller can see where the pool ran out.
 */
export function drawBlock(
  seed: number,
  category: TriggerCategory,
  count: number,
  alreadySeen: ReadonlySet<string> = new Set(),
): Draw[] {
  const rng = mulberry32(seed);
  const seen = new Set(alreadySeen);
  const draws: Draw[] = [];

  for (let i = 0; i < count; i++) {
    const draw = drawStimulus(Math.floor(rng() * 0x1_0000_0000), category, seen);
    draws.push(draw);
    if (draw.disabled) return draws;
    if (draw.stimulus) seen.add(draw.stimulus.id);
  }
  return draws;
}

// ---------------------------------------------------------------------------
// 4. THE FLUENCY GATE
// ---------------------------------------------------------------------------

/**
 * Phase 1 targets perception "under 2 s" and this is a binary y/n judgment on a slot the learner is
 * supposed to recognise, not compute. Above this the learner is deliberating on every slot, which is
 * the failure mode O8 exists to remove — so slow-and-correct is a fail, by design.
 */
export const RT_THRESHOLD_MS = 2000;

export const MIN_TRIALS = 10;
/**
 * At a 15% anomaly rate a 10-trial block can easily contain zero anomalies, and a learner who
 * answers "standard" every time would then post a flawless block while having no trigger at all.
 * Two is the floor at which the block measures anything about detection.
 */
export const MIN_ANOMALY_TRIALS = 2;
/**
 * Answering "standard" reflexively scores ~85% by base rate alone, so the bar has to sit above it.
 */
export const PASS_RATE = 0.9;

export type ErrorTag = 'missed-anomaly' | 'false-alarm' | 'slow';

export interface Response {
  readonly stimulusId: string;
  /** What the learner answered: true = "standard". */
  readonly answeredStandard: boolean;
  /** The oracle, from the stimulus. */
  readonly wasStandard: boolean;
  readonly rtMs: number;
}

export interface ScoredResponse {
  readonly correct: boolean;
  readonly fast: boolean;
  /** A fluency pass is correct AND fast — both, always. */
  readonly pass: boolean;
  readonly tag: ErrorTag | null;
  /** G3: a slot answered correctly and fast gets nothing back. Silence is not praise. */
  readonly comment: string | null;
}

export function scoreResponse(response: Response, thresholdMs: number = RT_THRESHOLD_MS): ScoredResponse {
  const correct = response.answeredStandard === response.wasStandard;
  const fast = response.rtMs <= thresholdMs;
  if (correct && fast) return { correct, fast, pass: true, tag: null, comment: null };

  // A wrong answer is tagged by its direction; "slow" is reserved for answers that were right.
  if (!correct) {
    const tag: ErrorTag = response.wasStandard ? 'false-alarm' : 'missed-anomaly';
    const comment =
      tag === 'missed-anomaly'
        ? 'Anomalous slot played as standard — one feature was off the trained tree.'
        : 'Standard slot flagged as anomalous — every feature was inside the trained ranges.';
    return { correct, fast, pass: false, tag, comment };
  }
  return {
    correct,
    fast,
    pass: false,
    tag: 'slow',
    comment: `Correct at ${response.rtMs} ms; the trigger has to fire under ${thresholdMs} ms to be a trigger.`,
  };
}

export interface FluencyGateResult {
  readonly passed: boolean;
  readonly attempts: number;
  readonly correct: number;
  readonly passes: number;
  readonly accuracy: number;
  readonly passRate: number;
  readonly medianRtMs: number;
  readonly anomalyTrials: number;
  /** G7: aggregated by error TAG. No trait labels — the aggregate names the mistake, not the person. */
  readonly errorsByTag: Readonly<Record<ErrorTag, number>>;
  readonly reason: string;
}

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export function fluencyGate(
  responses: readonly Response[],
  thresholdMs: number = RT_THRESHOLD_MS,
): FluencyGateResult {
  const scored = responses.map((r) => scoreResponse(r, thresholdMs));
  const correct = scored.filter((s) => s.correct).length;
  const passes = scored.filter((s) => s.pass).length;
  const attempts = responses.length;
  const anomalyTrials = responses.filter((r) => !r.wasStandard).length;
  const medianRtMs = median(responses.map((r) => r.rtMs));

  const errorsByTag: Record<ErrorTag, number> = { 'missed-anomaly': 0, 'false-alarm': 0, slow: 0 };
  for (const s of scored) if (s.tag) errorsByTag[s.tag] += 1;

  const base = {
    attempts,
    correct,
    passes,
    accuracy: attempts === 0 ? 0 : correct / attempts,
    passRate: attempts === 0 ? 0 : passes / attempts,
    medianRtMs,
    anomalyTrials,
    errorsByTag: errorsByTag as Readonly<Record<ErrorTag, number>>,
  };

  if (attempts < MIN_TRIALS) {
    return { ...base, passed: false, reason: `${attempts} of ${MIN_TRIALS} trials` };
  }
  if (anomalyTrials < MIN_ANOMALY_TRIALS) {
    return {
      ...base,
      passed: false,
      reason: `only ${anomalyTrials} anomalous trials — too few to measure the trigger`,
    };
  }
  if (base.passRate < PASS_RATE) {
    // The reason names whichever half of the gate actually failed. A learner at 10/10 accuracy who is
    // simply slow must not be told they got items wrong, and vice versa.
    const dominant = (Object.entries(errorsByTag) as [ErrorTag, number][])
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])[0];
    const target = `${(thresholdMs / 1000).toFixed(1)} s`;
    const reason =
      correct === attempts
        ? `${correct}/${attempts} correct but median ${(medianRtMs / 1000).toFixed(1)} s against a ${target} target — speed is part of the gate`
        : `${correct}/${attempts} correct, median ${(medianRtMs / 1000).toFixed(1)} s against a ${target} target${
            dominant ? `, mostly ${dominant[0]} (${dominant[1]})` : ''
          }`;
    return { ...base, passed: false, reason };
  }
  return {
    ...base,
    passed: true,
    reason: `${passes}/${attempts} correct and under ${(thresholdMs / 1000).toFixed(1)} s`,
  };
}
