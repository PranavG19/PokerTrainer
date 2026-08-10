/**
 * SESSION ASSEMBLY — PRODUCT-SPEC S1, S2, S2a, S2b, S3, and the "empty spacing queue" edge case.
 *
 * One button, two lengths, six ingredients. Everything here is a pure function of a requested
 * duration, a mode, and how many decay probes are actually owed; nothing reads the clock or the RNG,
 * so `assemble` at 23 minutes is as testable as at 50.
 *
 * TWO THINGS ARE NOT NEGOTIABLE, and the whole file exists to make them structural rather than
 * remembered. Decay probes are never cut, because they are the only retention measurement in the
 * system — cut them and the app can no longer tell learning from forgetting. Remediation is never cut
 * below one contrast set, because an un-remediated T2 is worse than an ungraded one: it enters the
 * spacing queue carrying no repair, so every future rep on that concept re-teaches the error.
 *
 * WHY MINUTES ARE QUANTISED INTO UNITS. A block is a whole number of atoms — PLM blocks, probes,
 * spots, contrast sets — and half an atom is not a smaller measurement, it is no measurement (S2b's
 * argument for the warm-up floor, generalised). So every proportional budget is floored to whole
 * units and the leftover minutes are simply not spent. Whole-task live hands are the exception: a
 * hand has no fixed length, so its minutes stay proportional and its hand count is an estimate.
 */

export type SessionMode = 'session' | 'free-roam';

/** S1's six ingredients, in the order they run. */
export const BLOCK_KINDS = [
  'warm-up',
  'decay-probes',
  'graded-spots',
  'contrast-remediation',
  'whole-task',
  'scoreboard',
] as const;

export type BlockKind = (typeof BLOCK_KINDS)[number];

/** S1, share of a 50-minute session. Sums to 1. */
export const SHARES: Record<BlockKind, number> = {
  'warm-up': 0.08,
  'decay-probes': 0.06,
  'graded-spots': 0.48,
  'contrast-remediation': 0.2,
  'whole-task': 0.14,
  scoreboard: 0.04,
};

export const SESSION_LENGTHS = [30, 50] as const;
export const DEFAULT_SESSION_MINUTES = 30;

export const WARM_UP_BLOCK_MINUTES = 4;
export const PROBE_MINUTES = 0.75;
export const PROBE_COUNT = 4;
export const MINUTES_PER_GRADED_SPOT = 1.25;
export const CONTRAST_SET_MINUTES = 5;
export const MINUTES_PER_LIVE_HAND = 2;
export const SCOREBOARD_MINUTES = 2;

/**
 * Q1: a graded block spans >= 7 classes with no consecutive repeats, so it needs at least 7 spots.
 * This is the number that makes S2a arithmetic rather than taste — see `assemble`.
 */
export const MIN_GRADED_SPOTS = 7;

/** S2, and the order is the whole point. Probes and the remediation floor are absent by design. */
export const CUT_ORDER = ['whole-task', 'warm-up-length', 'graded-spot-count'] as const;
export type CutTarget = (typeof CUT_ORDER)[number];

export interface Block {
  readonly kind: BlockKind;
  readonly minutes: number;
  /** Whole atoms: PLM blocks, probes, spots, contrast sets, live hands (estimated), 1 for scoreboard. */
  readonly units: number;
  /** S3: structured and casual reps must stay distinguishable downstream, so every block carries it. */
  readonly mode: SessionMode;
}

export interface Cut {
  readonly target: CutTarget;
  readonly minutesRemoved: number;
}

export interface SessionPlan {
  readonly mode: SessionMode;
  readonly requestedMinutes: number;
  readonly totalMinutes: number;
  readonly blocks: readonly Block[];
  /** In CUT_ORDER; a target that was already at its floor does not appear. */
  readonly cuts: readonly Cut[];
  /** S3: free-roam remediation is owed to the next session rather than skipped. */
  readonly remediationDeferred: boolean;
}

export interface PlanRequest {
  readonly durationMinutes: number;
  readonly mode: SessionMode;
  /** Concepts owed a probe, i.e. `dueNow(states, now).length`. Zero is the first-3-weeks edge case. */
  readonly dueProbes: number;
}

export type PlanResult =
  | { readonly ok: true; readonly plan: SessionPlan }
  | { readonly ok: false; readonly reason: string };

/** Every quantity in the file is a multiple of 0.25, so this kills float dust without hiding error. */
function toQuarter(minutes: number): number {
  return Math.round(minutes * 4) / 4;
}

function block(kind: BlockKind, minutes: number, units: number, mode: SessionMode): Block {
  return { kind, minutes: toQuarter(minutes), units, mode };
}

/**
 * S2a — NO 15-MINUTE SESSION EXISTS, and the reason is arithmetic, not preference. The blocks that do
 * not scale eat the sitting whole: one warm-up block (4 min, the S2b floor) + four probes (3 min,
 * uncuttable) + one contrast set (5 min, the remediation floor) + scoreboard (2 min, fixed) = 14 of
 * the 15 minutes. The remaining ~1 minute buys zero graded spots at 1.25 min each, and even a
 * generous reading buys one — which cannot span Q1's >= 7 classes without consecutive repeats. Since
 * S2 forbids cutting any of those four, the only cuttable block is the graded one, so a "15-minute
 * session" is a warm-up wearing the word practice. The honest name for a 15-minute sitting is
 * free-roam (S3), which drops probes and remediation and therefore does fit.
 *
 * The same arithmetic puts the shortest real session at 14 + 7 * 1.25 = 22.75 minutes.
 */
export function assemble(request: PlanRequest): PlanResult {
  const { durationMinutes: duration, mode, dueProbes } = request;
  if (!(duration > 0)) return { ok: false, reason: `duration ${duration} is not a positive number of minutes` };
  if (dueProbes < 0) return { ok: false, reason: `dueProbes ${dueProbes} is negative` };

  const freeRoam = mode === 'free-roam';

  // S3: probes never fire outside a session. Edge case: fewer than four due means fewer probes, and an
  // empty queue means no block at all rather than an empty one on screen.
  const probeCount = freeRoam ? 0 : Math.min(PROBE_COUNT, Math.floor(dueProbes));
  const probeMinutes = probeCount * PROBE_MINUTES;

  const contrastSets = freeRoam
    ? 0
    : Math.max(1, Math.floor((SHARES['contrast-remediation'] * duration) / CONTRAST_SET_MINUTES));
  const contrastMinutes = contrastSets * CONTRAST_SET_MINUTES;

  // Minutes freed by unfired probes and by deferred remediation belong to graded spots, not to the
  // floor: the edge-case rule says the probe block's time is reallocated, and S3's deferral is the
  // same shape of hole. Reallocating is what keeps a probe-less session from being a short session.
  const probeShortfall = PROBE_COUNT * PROBE_MINUTES - probeMinutes;
  const deferredRemediationMinutes = freeRoam ? SHARES['contrast-remediation'] * duration : 0;
  const gradedBudget = SHARES['graded-spots'] * duration + probeShortfall + deferredRemediationMinutes;

  // S1's "min 1 block" floor, which S2b makes the winner over S2's cut order.
  const warmUpFloorBlocks = 1;
  const warmUpBlocks = Math.max(
    warmUpFloorBlocks,
    Math.floor((SHARES['warm-up'] * duration) / WARM_UP_BLOCK_MINUTES),
  );

  const wholeTaskBudget = toQuarter(SHARES['whole-task'] * duration);

  /*
   * S2a: free-roam runs "without decay probes, remediation floors, or a scoreboard". Probes and
   * remediation were already gated on `freeRoam` above; the scoreboard was not, so it fired in every
   * free-roam plan at every duration — measured 10 of 10 configurations before this line changed. It
   * also reads on O6, which forbids a running session P&L: a scoreboard is the one block whose whole
   * job is to summarise outcomes, and free-roam is the always-open mode where that signal does the
   * most damage.
   */
  const scoreboardMinutes = freeRoam ? 0 : SCOREBOARD_MINUTES;

  const uncuttable = probeMinutes + contrastMinutes + scoreboardMinutes;
  const cuts: Cut[] = [];

  let warmUpMinutes = warmUpBlocks * WARM_UP_BLOCK_MINUTES;
  let gradedSpots = Math.floor(gradedBudget / MINUTES_PER_GRADED_SPOT);
  let wholeTaskMinutes = wholeTaskBudget;
  const spent = () =>
    warmUpMinutes + gradedSpots * MINUTES_PER_GRADED_SPOT + wholeTaskMinutes + uncuttable;

  // Cut 1: whole-task, dropped whole rather than trimmed. It is the block whose value is least
  // divisible — half a hand teaches nothing — so S1 says "dropped first" and means dropped.
  if (spent() > duration && wholeTaskMinutes > 0) {
    cuts.push({ target: 'whole-task', minutesRemoved: wholeTaskMinutes });
    wholeTaskMinutes = 0;
  }

  // Cut 2: warm-up LENGTH, above one block only (S2b). In the 23-50 minute range this cut is
  // structurally unreachable, because 8% of anything under 50 minutes is already below one block, so
  // the floor is where warm-up starts. That is not a dead branch: it is the guarantee that the S2
  // order cannot eat the floor if the shares or the block length are ever retuned.
  if (spent() > duration && warmUpMinutes > warmUpFloorBlocks * WARM_UP_BLOCK_MINUTES) {
    const surplus = spent() - duration;
    const droppableBlocks = Math.min(
      Math.ceil(surplus / WARM_UP_BLOCK_MINUTES),
      warmUpMinutes / WARM_UP_BLOCK_MINUTES - warmUpFloorBlocks,
    );
    if (droppableBlocks > 0) {
      cuts.push({ target: 'warm-up-length', minutesRemoved: droppableBlocks * WARM_UP_BLOCK_MINUTES });
      warmUpMinutes -= droppableBlocks * WARM_UP_BLOCK_MINUTES;
    }
  }

  // Cut 3: graded spot count, last because it is the block the session is for.
  if (spent() > duration) {
    const affordableSpots = Math.max(
      0,
      Math.floor((duration - warmUpMinutes - wholeTaskMinutes - uncuttable) / MINUTES_PER_GRADED_SPOT),
    );
    if (affordableSpots < gradedSpots) {
      cuts.push({
        target: 'graded-spot-count',
        minutesRemoved: (gradedSpots - affordableSpots) * MINUTES_PER_GRADED_SPOT,
      });
      gradedSpots = affordableSpots;
    }
  }

  if (spent() > duration) {
    return {
      ok: false,
      reason: `${mode} needs ${toQuarter(spent())} min of uncuttable floors but only ${duration} were requested`,
    };
  }

  // Free-roam is "a few graded spots" (S2a), so Q1's interleaving floor does not apply to it; a
  // session without an interleaved block is the thing S2a refuses to call a session.
  const requiredSpots = freeRoam ? 1 : MIN_GRADED_SPOTS;
  if (gradedSpots < requiredSpots) {
    return {
      ok: false,
      reason:
        `${duration} min leaves room for ${gradedSpots} graded spots; ` +
        `${mode === 'session' ? `a session needs ${MIN_GRADED_SPOTS} to interleave >= 7 classes — use free-roam instead` : 'free-roam needs at least 1'}`,
    };
  }

  const blocks: Block[] = [
    block('warm-up', warmUpMinutes, warmUpMinutes / WARM_UP_BLOCK_MINUTES, mode),
    block('decay-probes', probeMinutes, probeCount, mode),
    block('graded-spots', gradedSpots * MINUTES_PER_GRADED_SPOT, gradedSpots, mode),
    block('contrast-remediation', contrastMinutes, contrastSets, mode),
    block('whole-task', wholeTaskMinutes, Math.floor(wholeTaskMinutes / MINUTES_PER_LIVE_HAND), mode),
    block('scoreboard', scoreboardMinutes, scoreboardMinutes > 0 ? 1 : 0, mode),
  ].filter((b) => b.units > 0);

  return {
    ok: true,
    plan: {
      mode,
      requestedMinutes: duration,
      totalMinutes: toQuarter(blocks.reduce((sum, b) => sum + b.minutes, 0)),
      blocks,
      cuts,
      remediationDeferred: freeRoam,
    },
  };
}

/** Convenience for the caller that only has a plan: minutes by kind, 0 for a skipped block. */
export function minutesByKind(plan: SessionPlan): Record<BlockKind, number> {
  const minutes = Object.fromEntries(BLOCK_KINDS.map((k) => [k, 0])) as Record<BlockKind, number>;
  for (const b of plan.blocks) minutes[b.kind] = b.minutes;
  return minutes;
}
