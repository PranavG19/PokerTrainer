/**
 * The Masquerade, the Long Orbit's replayable epilogue (VISION §2.5, BUILD-PLAN 2.3). Three seats, three masks, and
 * one of the rivals' styles behind each, its parameters jittered for this Masquerade (archetypes.ts
 * `sessionProfile`, jitter.ts). The learner unmasks a seat by reading it.
 *
 * - **Reads come from what the learner saw.** Per seat the table keeps three pairs of counts of its actions, never its cards:
 *   how often it plays a hand (puts chips in before the flop by choice), how often it folds to a bet, and how often
 *   it bets when nobody has. All three are visible on every hand; nothing is read from the engine's hidden state.
 * - **The Folio ink gate is reads.ts's own.** A read is inked only once its observations pass R1's sample gate,
 *   `MIN_OBSERVATIONS` (20): before that the Folio shows it in pencil, with how many more it needs. Once inked, its
 *   lean (more, fewer or standard) is R1's deviation gate against the balanced seat's baseline. reads.ts is used
 *   read-only: this file calls `gates` and changes nothing in it.
 * - **Naming is judged on the evidence.** A seat can be named once one of its reads is inked. A name fits when the
 *   inked reads fit that style at least as well as any other style; the mask then comes off and shows who it was.
 *   Two styles can read the same (a seat that folds everything looks alike from either side), so the honest test is
 *   the fit, never a guess at the hidden identity. A name that does not fit gets a question back, never a grade.
 * - Nothing is locked (N1): the Masquerade opens at any time, and a new one can be dealt whenever.
 *
 * Pure: state in, new state out. Days come from the caller.
 */

import { sessionProfile, type ArchetypeName, type ArchetypeProfile } from '../archetypes.js';
import type { DayKey } from '../localDay.js';
import { gates, MIN_OBSERVATIONS, type Gates } from '../reads.js';
import { mulberry32 } from '../rng.js';
import type { MasqueradeSeat, MasqueradeState, RivalAction } from '../progression/types.js';
import { RIVAL_IDS, RIVALS, type RivalId } from './cast.js';

export const MASQUERADE_SEATS = 3;
/** The Folio ink gate: R1's sample gate, in hands for the plays read. */
export const INK_OBSERVATIONS = MIN_OBSERVATIONS;
/** Hands in one round at the Masquerade table. Two rounds ink the first read. */
export const MASQUERADE_ROUND_HANDS = 10;
/** The masks, in seat order. Never a rival's name, never a style. */
export const MASKS = ['Fox', 'Moth', 'Heron'] as const;

export const READ_IDS = ['plays', 'folds', 'bets'] as const;
export type MasqueradeReadId = (typeof READ_IDS)[number];
export type Lean = 'more' | 'fewer' | 'standard';

/**
 * The balanced seat's frequencies, measured: the standard regular's style at a four-seat table against the other
 * styles (tests/unit/story-masquerade.test.ts re-measures them, and fails if one drifts by more than six points).
 */
export const BASELINES: Readonly<Record<MasqueradeReadId, number>> = { plays: 0.3, folds: 0.58, bets: 0.44 };

/** How each style reads against those baselines, by R1's deviation gate (measured by the same test). */
export const EXPECTED_LEAN: Readonly<Record<ArchetypeName, Readonly<Record<MasqueradeReadId, Lean>>>> = {
  nit: { plays: 'fewer', folds: 'more', bets: 'fewer' },
  station: { plays: 'more', folds: 'fewer', bets: 'fewer' },
  lag: { plays: 'more', folds: 'fewer', bets: 'more' },
  'tag-reg': { plays: 'standard', folds: 'standard', bets: 'standard' },
  'over-folder': { plays: 'fewer', folds: 'more', bets: 'fewer' },
  maniac: { plays: 'more', folds: 'fewer', bets: 'more' },
};

export const READ_LABELS: Readonly<Record<MasqueradeReadId, { readonly label: string; readonly unit: string; readonly counted: string }>> = {
  plays: { label: 'Plays a hand', unit: 'hands', counted: 'put chips in by choice before the flop' },
  folds: { label: 'Folds to a bet', unit: 'bets faced', counted: 'folded' },
  bets: { label: 'Bets when nobody has', unit: 'chances', counted: 'bet' },
};

// ── a Masquerade ─────────────────────────────────────────────────────────────────────────────────────

function seedOf(run: number): number {
  return (Math.imul(run + 1, 0x9e3779b1) ^ 0x6d61736b) >>> 0;
}

/** The rivals behind the masks of Masquerade `run`: three distinct styles, seeded, so a replay deals the same. */
export function rivalsFor(run: number): RivalId[] {
  const rng = mulberry32(seedOf(run));
  return RIVAL_IDS.map((id) => [rng(), id] as const)
    .sort((a, b) => a[0] - b[0])
    .slice(0, MASQUERADE_SEATS)
    .map(([, id]) => id);
}

function emptySeat(rival: string): MasqueradeSeat {
  return { rival, acted: 0, played: 0, faced: 0, folded: 0, chances: 0, bets: 0, missed: [], unmaskedOn: null };
}

/** Deal a new Masquerade: the next run, fresh seats. What earlier ones earned (the count, the day) stays. */
export function beginMasquerade(m: MasqueradeState): MasqueradeState {
  const run = m.run + 1;
  return { ...m, run, seats: rivalsFor(run).map(emptySeat) };
}

/** The current Masquerade, or a first one dealt when there is none yet. */
export function ensureMasquerade(m: MasqueradeState): MasqueradeState {
  return m.seats.length > 0 ? m : beginMasquerade(m);
}

export interface MasqueradeCastSeat {
  readonly mask: string;
  readonly rival: RivalId | null;
  readonly archetype: ArchetypeName;
  /** This Masquerade's jittered profile: the truth the reads are measured against (jitter.ts). */
  readonly profile: ArchetypeProfile;
  readonly unmasked: boolean;
}

/** The table's seats. A rival id this build does not know plays as the standard regular, still masked. */
export function castOf(m: MasqueradeState): MasqueradeCastSeat[] {
  return m.seats.map((seat, i) => {
    const rival = (RIVAL_IDS as readonly string[]).includes(seat.rival) ? (seat.rival as RivalId) : null;
    const archetype: ArchetypeName = rival ? RIVALS[rival].archetype : 'tag-reg';
    return { mask: MASKS[i] ?? `Mask ${i + 1}`, rival, archetype, profile: sessionProfile(archetype, seedOf(m.run) + i), unmasked: seat.unmaskedOn !== null };
  });
}

/** One finished hand: each seat's actions as the learner saw them (table.ts `SettledSeat`), in seat order. */
export function recordMasqueradeHand(m: MasqueradeState, seats: readonly (readonly RivalAction[])[]): MasqueradeState {
  return {
    ...m,
    seats: m.seats.map((seat, i) => {
      const actions = seats[i] ?? [];
      const preflop = actions.filter((a) => a.street === 'preflop');
      const acted = preflop.length > 0 ? 1 : 0;
      const played = preflop.some((a) => a.kind === 'call' || a.kind === 'bet' || a.kind === 'raise' || a.kind === 'allin') ? 1 : 0;
      const faced = actions.filter((a) => a.facingBet);
      // A chance to bet: a decision after the flop with no bet to face.
      const open = actions.filter((a) => a.street !== 'preflop' && !a.facingBet);
      return {
        ...seat,
        acted: seat.acted + acted,
        played: seat.played + played,
        faced: seat.faced + faced.length,
        folded: seat.folded + faced.filter((a) => a.kind === 'fold').length,
        chances: seat.chances + open.length,
        bets: seat.bets + open.filter((a) => a.kind === 'bet' || a.kind === 'raise' || a.kind === 'allin').length,
      };
    }),
  };
}

// ── reads and the ink gate ───────────────────────────────────────────────────────────────────────────

export interface InkRead {
  readonly id: MasqueradeReadId;
  readonly n: number;
  readonly count: number;
  readonly share: number | null;
  readonly baseline: number;
  /** R1's two gates (reads.ts), over this read. */
  readonly gates: Gates;
  /** Past the sample gate: the Folio writes it in ink. */
  readonly inked: boolean;
  /** Observations still needed before it inks; 0 once inked. */
  readonly needs: number;
  /** Once inked: the deviation gate's verdict against the baseline. Null in pencil. */
  readonly lean: Lean | null;
}

function inkRead(id: MasqueradeReadId, count: number, n: number): InkRead {
  const share = n > 0 ? count / n : null;
  const g = gates({
    id,
    n,
    observedFrequency: share ?? BASELINES[id],
    baselineFrequency: BASELINES[id],
    preRegistered: true,
    counterActions: 0,
    contraryObservations: 0,
    fullExploitBb: 0,
  });
  const inked = g.sampleGate;
  return {
    id,
    n,
    count,
    share,
    baseline: BASELINES[id],
    gates: g,
    inked,
    needs: Math.max(0, INK_OBSERVATIONS - n),
    lean: !inked ? null : !g.deviationGate ? 'standard' : g.deviationPoints > 0 ? 'more' : 'fewer',
  };
}

/** A seat's three reads, plays first. */
export function seatReads(seat: MasqueradeSeat): InkRead[] {
  return [inkRead('plays', seat.played, seat.acted), inkRead('folds', seat.folded, seat.faced), inkRead('bets', seat.bets, seat.chances)];
}

/** A seat can be named once one of its reads is inked. */
export function canName(reads: readonly InkRead[]): boolean {
  return reads.some((r) => r.inked);
}

/** How many of the inked reads a style's expected lean matches. */
export function fitScore(reads: readonly InkRead[], archetype: ArchetypeName): number {
  return reads.filter((r) => r.inked && r.lean === EXPECTED_LEAN[archetype][r.id]).length;
}

/** The styles the inked reads fit best (never empty: at worst, every style ties). */
export function bestFits(reads: readonly InkRead[]): RivalId[] {
  const scores = RIVAL_IDS.map((id) => [id, fitScore(reads, RIVALS[id].archetype)] as const);
  const top = Math.max(...scores.map(([, s]) => s));
  return scores.filter(([, s]) => s === top).map(([id]) => id);
}

export type NameResult = 'unmasked' | 'not-a-fit' | 'not-inked' | 'already' | 'tried';

/**
 * Name seat `index` as `rival`. It fits when the inked reads fit that style as well as any style does: the mask comes
 * off, and when every seat is unmasked the Masquerade is complete (the day kept, a ratchet).
 */
export function nameSeat(
  m: MasqueradeState,
  index: number,
  rival: RivalId,
  reads: readonly InkRead[],
  day: DayKey,
): { state: MasqueradeState; result: NameResult } {
  const seat = m.seats[index];
  if (!seat) return { state: m, result: 'not-inked' };
  if (seat.unmaskedOn !== null) return { state: m, result: 'already' };
  if (!canName(reads)) return { state: m, result: 'not-inked' };
  if (seat.missed.includes(rival)) return { state: m, result: 'tried' };
  if (!bestFits(reads).includes(rival)) {
    const seats = m.seats.map((s, i) => (i === index ? { ...s, missed: [...s.missed, rival] } : s));
    return { state: { ...m, seats }, result: 'not-a-fit' };
  }
  const seats = m.seats.map((s, i) => (i === index ? { ...s, unmaskedOn: day } : s));
  const done = seats.every((s) => s.unmaskedOn !== null);
  return {
    state: { ...m, seats, completed: m.completed + (done ? 1 : 0), completedOn: m.completedOn ?? (done ? day : null) },
    result: 'unmasked',
  };
}

export function isComplete(m: MasqueradeState): boolean {
  return m.seats.length > 0 && m.seats.every((s) => s.unmaskedOn !== null);
}
