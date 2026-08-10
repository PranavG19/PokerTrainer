/**
 * OPPONENT PARAMETER JITTER — PRODUCT-SPEC O3, user stories 25 and 26.
 *
 * O3: "Parameters jittered per session within a band; archetype label hidden until the hand ends.
 * Otherwise the learner overfits to three fixed caricatures instead of learning to classify. Jitter
 * is seeded and reproducible."
 *
 * A pure function of (session seed, archetype id, nominal parameters). No clock, no Math.random, no
 * module state — the same three arguments give the same parameters forever, which is what makes an
 * e2e assertion and a replay possible at all.
 *
 * THE TWO FAILURES THIS MODULE IS SHAPED BY, both of which invert O3:
 *
 *  - TOO NARROW. Jitter that returns the nominal parameters unchanged satisfies "reproducible" and
 *    "within a band" perfectly while serving exactly the fixed caricatures O3 exists to prevent.
 *  - TOO WIDE. Jitter that can turn a nit into a maniac destroys the classification skill. The
 *    archetype has to stay recognisable as itself, or there is nothing to classify and the read
 *    grading in O4 grades noise.
 *
 * THE BAND, and why these two numbers:
 *
 *   halfWidth = min(JITTER_RELATIVE_BAND x nominal, JITTER_MAX_ABSOLUTE_SHIFT)
 *
 *  - RELATIVE, 15% of the nominal value, so the SHAPE of an archetype survives: whichever of its
 *    frequencies are large stay large and whichever are small stay small. A nit that stabs 5% of
 *    the time can move to at most 5.75%, so no seed makes it a bluffer. A parameter that is exactly
 *    zero stays exactly zero — a nit's "never bluff-raises" is a structural fact about the
 *    archetype, not a number to be jittered off zero.
 *  - ABSOLUTELY CAPPED at 5 percentage points, which is one third of R1's go/no-go gate of 15
 *    points off baseline. If jitter could move a true frequency by 15 points it could open or close
 *    a read gate on its own, and the learner would be gating on this session's dice instead of on
 *    the opponent. A third of the required evidence cannot.
 *
 * O4 — "true frequencies are known, so reads are gradeable" — still holds, because the jittered
 * parameters ARE the truth for the session. A read is graded against the values this function
 * returned, not against the nominal archetype; the caller must feed these into `reads.ts`'s
 * `nodeBaseRate`, not the un-jittered profile. Jitter narrows nothing about knowability: the truth
 * moves, and the record of where it moved to is this function's return value.
 *
 * PER SESSION, NOT PER HAND. There is deliberately no hand argument. A bot whose parameters shift
 * mid-session is unclassifiable, which is the inverse of the clause. The caller draws once per
 * session (seed included) and reuses the result for every hand.
 */

import { mulberry32 } from './rng.js';

/** Fraction of the nominal value the jitter may move it by. */
export const JITTER_RELATIVE_BAND = 0.15;

/**
 * Hard cap on the shift in absolute terms, i.e. 5 percentage points on a frequency. One third of
 * R1's 15-point deviation gate — see the header. Any change here must stay well below that gate.
 */
export const JITTER_MAX_ABSOLUTE_SHIFT = 0.05;

/** Comparisons on a band edge are float-noisy; the values themselves are exact. */
const EPSILON = 1e-12;

/**
 * Any flat bag of numeric parameters. A mapped constraint rather than `Record<string, number>` so a
 * plain interface with no index signature — ai.ts's `Profile`, and whatever the six archetypes grow
 * into — satisfies it directly. This module deliberately does not name the archetype fields: it
 * takes the parameters to jitter as an input so ai.ts stays the single owner of their shape.
 */
export type ArchetypeParameters<T> = { readonly [K in keyof T]: number };

export interface Band {
  readonly nominal: number;
  readonly halfWidth: number;
  readonly min: number;
  readonly max: number;
}

/**
 * The band one parameter may be jittered within.
 *
 * NO LOWER CLIP IS NEEDED. The band is relative, so `halfWidth <= 0.15 x |nominal| < |nominal|`: a
 * positive frequency can never be jittered to zero or below, and a zero one has a zero band and
 * does not move at all. A clamp at 0 here would be unreachable code.
 *
 * The UPPER clip exists because a frequency above 1 is not a frequency. It binds only for a nominal
 * above 0.95, and where it binds that one parameter's band becomes asymmetric — jitter on it is
 * very slightly downward-biased. That is the right trade against emitting an impossible frequency.
 * A nominal above 1 is not a frequency at all (a pot fraction may exceed 1: an overbet) and is
 * banded symmetrically, because clipping it would only ever shrink an overbetting archetype.
 */
export function bandFor(nominal: number): Band {
  if (!Number.isFinite(nominal)) throw new Error(`nominal parameter must be finite: ${nominal}`);
  const halfWidth = Math.min(JITTER_RELATIVE_BAND * Math.abs(nominal), JITTER_MAX_ABSOLUTE_SHIFT);
  const isUnitRange = nominal >= 0 && nominal <= 1;
  return {
    nominal,
    halfWidth,
    min: nominal - halfWidth,
    max: isUnitRange ? Math.min(1, nominal + halfWidth) : nominal + halfWidth,
  };
}

export function isWithinBand(nominal: number, value: number): boolean {
  const band = bandFor(nominal);
  return value >= band.min - EPSILON && value <= band.max + EPSILON;
}

/** FNV-1a, so each parameter gets its own stream keyed by name rather than by position. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * One independent stream per (session, archetype, parameter name).
 *
 * Keyed by NAME, not by iteration order, so a sibling archetype gaining a parameter does not
 * silently re-roll the parameters that were already there.
 *
 * No extra avalanche step on top of the xor: mulberry32 mixes its state before its first output, so
 * adjacent session seeds (1, 2, 3 — how sessions are actually numbered) already produce
 * uncorrelated first draws. Measured over 2000 consecutive seeds, adding an avalanche changed
 * neither the uniformity nor the adjacent-seed spread, so it was removed.
 */
function streamSeed(sessionSeed: number, archetypeId: string, parameter: string): number {
  return ((sessionSeed >>> 0) ^ fnv1a(`${archetypeId}:${parameter}`)) >>> 0;
}

/** Symmetric about the nominal value, so jitter is unbiased: no seed systematically loosens a bot. */
function jitterOne(sessionSeed: number, archetypeId: string, parameter: string, nominal: number): number {
  const band = bandFor(nominal);
  if (band.halfWidth === 0) return nominal;
  const unit = mulberry32(streamSeed(sessionSeed, archetypeId, parameter))();
  const shifted = nominal + (2 * unit - 1) * band.halfWidth;
  return Math.min(Math.max(shifted, band.min), band.max);
}

/**
 * O3's jitter: one session's parameters for one archetype.
 *
 * `archetypeId` participates in the seed so two archetypes that happen to share a nominal value do
 * not receive the same jitter, while two SEATS of the same archetype do — they are the same
 * opponent model, and the learner classifies them as one thing.
 */
export function jitterParameters<T extends ArchetypeParameters<T>>(
  sessionSeed: number,
  archetypeId: string,
  nominal: T,
): T {
  if (!Number.isFinite(sessionSeed)) throw new Error(`session seed must be finite: ${sessionSeed}`);
  const jittered: Record<string, number> = {};
  for (const [parameter, value] of Object.entries(nominal) as [string, number][]) {
    jittered[parameter] = jitterOne(sessionSeed, archetypeId, parameter, value);
  }
  // Keys are copied one-for-one, so the result has exactly T's shape.
  return jittered as T;
}

/**
 * Story 25 / O3: the label is hidden until the hand ends.
 *
 * `handEnded` is `state.winners !== null` at the table — the hand is over once the pot has been
 * awarded. Keyed on that and nothing else: there is no "reveal after N hands" or per-seat override,
 * because a label visible mid-hand is the whole thing the clause forbids.
 */
export const HIDDEN_ARCHETYPE_LABEL = 'Unknown';

export interface ArchetypeLabel {
  readonly revealed: boolean;
  /** What the seat may show right now. */
  readonly text: string;
}

export function visibleArchetypeLabel(trueLabel: string, handEnded: boolean): ArchetypeLabel {
  if (!handEnded) return { revealed: false, text: HIDDEN_ARCHETYPE_LABEL };
  return { revealed: true, text: trueLabel };
}
