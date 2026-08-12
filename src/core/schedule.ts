/**
 * SPACED REPETITION — PRODUCT-SPEC Q4, Q5, P5 gate B, P6.
 *
 * The retention engine. Two deliberate departures from convention, both load-bearing:
 *
 * GAPS ARE FLAT, NOT EXPANDING. Day 0, 1-2, 7, 21, 30-45. The familiar 1/2/4/8/16 ladder is
 * convention rather than evidence: equally spaced retrieval beats expanding for long-term
 * retention, and the optimum gap is ~5-10% of the target interval, so "still correct in a year"
 * wants ~18-36 days — which is what the day-21 and day-30-45 waves are. `assertFlatGaps` exists so
 * the ladder cannot be quietly reintroduced.
 *
 * THE LEARNER MODEL IS A CONJUGATE POSTERIOR, NOT FITTED PFA. The method prescribes nightly L-BFGS
 * over per-KC difficulty, per-KC learning rates split by outcome, a learner random effect and
 * per-item difficulty, plus isotonic recalibration. At ~8 opportunities per KC per week from one
 * person, none of that is estimable — the method itself says to pool calibration below 200 held-out
 * observations per KC, which will never be reached here. A beta-binomial with hand-set priors gives
 * the same gate and the same visible bar, is better calibrated at n=12 than anything fitted, and is
 * short enough to read in one sitting.
 *
 * Every function takes an explicit `now`. A scheduler that reads the clock internally is a
 * scheduler you cannot time-travel, and the only honest test of this file is a simulated timeline.
 */

/** Day offsets from first exposure. Flat by design — see the header. */
export const WAVES = [
  { day: 0, reps: 10, mode: 'blocked' },
  { day: 1, reps: 4, mode: 'interleaved' },
  { day: 7, reps: 4, mode: 'interleaved' },
  { day: 21, reps: 3, mode: 'interleaved' },
  { day: 30, reps: 2, mode: 'probe' },
] as const;

export type WaveMode = (typeof WAVES)[number]['mode'];

/** Day 1-2 and day 30-45 are ranges in the spec; a rep landing anywhere inside counts as on time. */
const WAVE_WINDOWS: Record<number, readonly [number, number]> = {
  0: [0, 0],
  1: [1, 2],
  7: [7, 7],
  21: [21, 21],
  30: [30, 45],
};

export const MS_PER_DAY = 86_400_000;

/** P5 gate B. Twelve is the floor for a claim; twenty-five is where wheel-spinning is cut off. */
export const MIN_OPPORTUNITIES = 12;
export const MAX_OPPORTUNITIES = 25;
export const MASTERY_POSTERIOR = 0.9;
export const MASTERY_CI_LOWER = 0.85;

/**
 * Hand-set prior. Beta(2, 2) is weakly informative and centred at 0.5: it says "no opinion, but a
 * single lucky rep is not mastery", which is exactly the claim the evidence supports at n=1.
 */
export const PRIOR_ALPHA = 2;
export const PRIOR_BETA = 2;

/**
 * Half-life of a success. Stale evidence should not certify current skill, and P6 asks for a decay
 * term without naming one; 30 days matches the day-30-45 probe wave, so a concept that has not been
 * seen since its last probe has lost about half its weight by the time the next one is due.
 */
export const DECAY_HALF_LIFE_DAYS = 30;

export interface Opportunity {
  /** Absolute epoch ms. Explicit so a timeline can be simulated rather than waited out. */
  readonly at: number;
  readonly correct: boolean;
}

export interface ConceptState {
  readonly id: string;
  readonly firstSeen: number;
  readonly opportunities: readonly Opportunity[];
  /** Probe misses, which drive Q5's reopening rules. */
  readonly probeMisses: number;
}

export interface Posterior {
  readonly alpha: number;
  readonly beta: number;
  readonly mean: number;
  readonly ciLower: number;
  readonly ciUpper: number;
  /** Raw count, undecayed: the gate needs real reps, not a weighted total. */
  readonly opportunities: number;
}

function decayWeight(ageDays: number): number {
  if (ageDays <= 0) return 1;
  return Math.pow(0.5, ageDays / DECAY_HALF_LIFE_DAYS);
}

/**
 * Normal approximation to the beta interval. Exact beta quantiles need an incomplete-beta inverse,
 * which is a lot of numerics for a bar on a screen; at the n >= 12 the gate requires, the
 * approximation is close enough that it never changes a gate decision, and it is clamped to [0, 1]
 * so a wide interval cannot render as a negative bar.
 */
function credibleInterval(alpha: number, beta: number): readonly [number, number] {
  const mean = alpha / (alpha + beta);
  const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
  const sd = Math.sqrt(variance);
  return [Math.max(0, mean - 1.96 * sd), Math.min(1, mean + 1.96 * sd)];
}

export function posterior(state: ConceptState, now: number): Posterior {
  let alpha = PRIOR_ALPHA;
  let beta = PRIOR_BETA;

  for (const opportunity of state.opportunities) {
    const weight = decayWeight((now - opportunity.at) / MS_PER_DAY);
    if (opportunity.correct) alpha += weight;
    else beta += weight;
  }

  const [ciLower, ciUpper] = credibleInterval(alpha, beta);
  return {
    alpha,
    beta,
    mean: alpha / (alpha + beta),
    ciLower,
    ciUpper,
    opportunities: state.opportunities.length,
  };
}

export type GateStatus = 'learning' | 'mastered' | 'frozen';

export interface Gate {
  readonly status: GateStatus;
  readonly reason: string;
}

/**
 * P5 gate B. Note what is absent: there is no "N correct in a row" anywhere. The spec forbids it
 * outright — it is noise-sensitive, and it interacts badly with the guess floor that mixed-strategy
 * nodes create, where even perfect play cannot produce a streak.
 */
export function gate(state: ConceptState, now: number): Gate {
  const p = posterior(state, now);

  // Freezing reads the UNDECAYED record, mastery reads the decayed one, and the split matters.
  // Freezing asks "has this concept absorbed 25 reps without ever being learned?" — a question about
  // history, which decay must not rewrite. Mastery asks "is the skill sharp now?" — a question about
  // freshness, which is exactly what decay is for. Judging both on the decayed posterior let a
  // concept that HAD been mastered slide into 'frozen' weeks later purely by going stale, which
  // would drop it from rotation and contradict Q5's "mastered concepts never exit rotation".
  if (p.opportunities >= MAX_OPPORTUNITIES && !isMastered(undecayedPosterior(state))) {
    // Frozen, not failed, and never hidden: the Lifecycle rules keep a frozen KC visible with its
    // error signature. More reps at this point are wheel-spinning, so the route is a worked example.
    return {
      status: 'frozen',
      reason: `${p.opportunities} opportunities without mastery — frozen; a worked example is the next step, not another rep`,
    };
  }
  if (isMastered(p)) {
    return { status: 'mastered', reason: `posterior ${p.mean.toFixed(2)}, lower bound ${p.ciLower.toFixed(2)}` };
  }
  if (p.opportunities < MIN_OPPORTUNITIES) {
    return { status: 'learning', reason: `${p.opportunities} of ${MIN_OPPORTUNITIES} opportunities` };
  }
  return { status: 'learning', reason: `posterior ${p.mean.toFixed(2)}, lower bound ${p.ciLower.toFixed(2)}` };
}

/**
 * The record with no decay applied: "was this ever learned?", which is the question freezing asks.
 * Every opportunity counts at full weight regardless of age.
 */
function undecayedPosterior(state: ConceptState): Posterior {
  const correct = state.opportunities.filter((o) => o.correct).length;
  const alpha = PRIOR_ALPHA + correct;
  const beta = PRIOR_BETA + (state.opportunities.length - correct);
  const [ciLower, ciUpper] = credibleInterval(alpha, beta);
  return {
    alpha,
    beta,
    mean: alpha / (alpha + beta),
    ciLower,
    ciUpper,
    opportunities: state.opportunities.length,
  };
}

function isMastered(p: Posterior): boolean {
  return (
    p.opportunities >= MIN_OPPORTUNITIES && p.mean >= MASTERY_POSTERIOR && p.ciLower >= MASTERY_CI_LOWER
  );
}

export interface DueRep {
  readonly conceptId: string;
  readonly waveDay: number;
  readonly reps: number;
  readonly mode: WaveMode;
  /** Days late. Surfaced so the recommender can rank spacing debt rather than only its existence. */
  readonly overdueDays: number;
}

/** Which day offsets already have a rep recorded inside their window. */
function completedWaves(state: ConceptState): Set<number> {
  const done = new Set<number>();
  for (const wave of WAVES) {
    const [from, to] = WAVE_WINDOWS[wave.day];
    const hit = state.opportunities.some((o) => {
      const day = Math.floor((o.at - state.firstSeen) / MS_PER_DAY);
      return day >= from && day <= to;
    });
    if (hit) done.add(wave.day);
  }
  return done;
}

/**
 * The next wave owed for one concept, or null when nothing is due.
 *
 * Q5: a mastered concept NEVER exits rotation, so mastery is deliberately not consulted here.
 * A frozen concept is the one exception — it stops being served because more reps cannot help it.
 */
export function nextDue(state: ConceptState, now: number): DueRep | null {
  if (gate(state, now).status === 'frozen') return null;

  const done = completedWaves(state);
  const elapsedDays = Math.floor((now - state.firstSeen) / MS_PER_DAY);

  for (const wave of WAVES) {
    if (done.has(wave.day)) continue;
    const [from] = WAVE_WINDOWS[wave.day];
    if (elapsedDays < from) return null; // Later waves are not due either; the list is ordered.
    return {
      conceptId: state.id,
      waveDay: wave.day,
      reps: wave.reps,
      mode: wave.mode,
      overdueDays: elapsedDays - from,
    };
  }
  return null;
}

/** Everything owed right now, most overdue first. Ties break on id so the order is deterministic. */
export function dueNow(states: readonly ConceptState[], now: number): DueRep[] {
  return states
    .map((s) => nextDue(s, now))
    .filter((d): d is DueRep => d !== null)
    .sort((a, b) => b.overdueDays - a.overdueDays || a.conceptId.localeCompare(b.conceptId));
}

/**
 * Q5, and the asymmetry is the point. One probe miss reopens the contrast set and resets to a 7-day
 * gap. Two misses return the concept to active learning with 6 remaining opportunities — NOT a full
 * reset, because discarding the history would also discard the evidence of what was already learned.
 */
export interface ProbeMissOutcome {
  readonly reopenContrastSet: boolean;
  readonly nextGapDays: number;
  readonly returnToActiveLearning: boolean;
  readonly remainingOpportunities: number | null;
}

export function onProbeMiss(state: ConceptState): ProbeMissOutcome {
  const misses = state.probeMisses + 1;
  if (misses === 1) {
    return {
      reopenContrastSet: true,
      nextGapDays: 7,
      returnToActiveLearning: false,
      remainingOpportunities: null,
    };
  }
  return {
    reopenContrastSet: true,
    nextGapDays: 7,
    returnToActiveLearning: true,
    remainingOpportunities: 6,
  };
}

/**
 * The Q4 invariant, exported so it can be asserted rather than trusted: consecutive gaps must not
 * grow multiplicatively. An expanding ladder (1/2/4/8/16) is the single most likely thing for a
 * future change to reintroduce, because it is what everyone expects a spacing schedule to be.
 */
export function assertFlatGaps(waveDays: readonly number[] = WAVES.map((w) => w.day)): void {
  const gaps: number[] = [];
  for (let i = 1; i < waveDays.length; i++) gaps.push(waveDays[i] - waveDays[i - 1]);

  for (let i = 1; i < gaps.length; i++) {
    // Doubling every step is the signature of an expanding ladder. A gap that merely grows is fine
    // — 1, 6, 14, 9 is flat in the sense that matters; 1, 2, 4, 8 is not.
    if (gaps[i] === gaps[i - 1] * 2) {
      throw new Error(
        `expanding gaps detected at wave ${waveDays[i]}: ${gaps.join(',')} — Q4 requires flat spacing, not 1/2/4/8/16`,
      );
    }
  }
}

/**
 * Remediation must not be massed. A T2+ error schedules a repair, and compressing that repair into
 * consecutive days is "massing wearing spacing's clothes" — it feels like review and retains like
 * cramming.
 */
export function remediationDays(firstRepairDay = 2): number[] {
  const days = [firstRepairDay, firstRepairDay + 7, firstRepairDay + 21];
  const gaps = days.slice(1).map((d, i) => d - days[i]);
  if (gaps.some((g) => g < 5)) {
    throw new Error(`remediation gaps ${gaps.join(',')} are massed — no repair chain under 5 days`);
  }
  return days;
}

/**
 * One graded attempt on a concept, as the drill's fading log records it. Typed structurally rather
 * than importing fading.ts's GradedEvent so the scheduler stays free of a dependency on the drill —
 * a GradedEvent is assignable to this, which is the whole point of the adapter.
 */
export interface GradedAttempt {
  readonly conceptId: string;
  readonly at: number;
  readonly correct: boolean;
}

/**
 * Group a flat, time-ordered log of graded attempts into the per-concept states the scheduler reasons
 * over. This is the seam that lets the Spacing queue run on REAL learner history instead of the e2e
 * `__offsuitSpacing` seam: every field is derived from attempts the drill actually recorded, so no
 * data is invented — `firstSeen` is the earliest attempt on that concept and `opportunities` is the
 * log itself, regrouped. `probeMisses` starts at zero because the log records graded reps, not
 * decay-probe outcomes; nothing in the app emits a probe miss yet, and inventing one here would be
 * inventing exactly the Q5 signal this module exists to keep honest.
 */
export function conceptStatesFromLog(attempts: readonly GradedAttempt[]): ConceptState[] {
  const byConcept = new Map<string, { firstSeen: number; opportunities: Opportunity[] }>();
  for (const attempt of attempts) {
    const existing = byConcept.get(attempt.conceptId);
    if (existing === undefined) {
      byConcept.set(attempt.conceptId, {
        firstSeen: attempt.at,
        opportunities: [{ at: attempt.at, correct: attempt.correct }],
      });
    } else {
      existing.firstSeen = Math.min(existing.firstSeen, attempt.at);
      existing.opportunities.push({ at: attempt.at, correct: attempt.correct });
    }
  }

  return [...byConcept.entries()]
    .map(([id, { firstSeen, opportunities }]) => ({
      id,
      firstSeen,
      // Oldest first, so a caller reading the timeline sees it in the order it happened regardless of
      // how the log was ordered on the way in.
      opportunities: [...opportunities].sort((a, b) => a.at - b.at),
      probeMisses: 0,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
