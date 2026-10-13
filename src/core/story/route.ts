/**
 * Personalization: the orbit adapts to the learner's own leaks.
 *
 * - **What a leak is.** A graded decision the coach charged (severity above `free`), classified by the coach's
 *   principle and the action taken into a `LeakKind` (cast.ts). A kind names a decision ("calling bets above
 *   the price"), never a person.
 * - **How they rank.** Reach-weighted, with rw.ts's own formula over the frozen reference reach
 *   (reachRef.ts): a leak in a spot the learner reaches often outranks an equally costly rare one, exactly as
 *   the recommender ranks study (recommend.ts). Raw cost breaks ties.
 * - **What it changes.** The chapter whose rival punishes the costliest kind moves to the front of the orbit
 *   and becomes "suggested next", and its rival leans on that kind at the table (`tableFor`): over-fold to
 *   river bets and the conductor bluffs more rivers. Every personalized element carries a citation naming
 *   its data and its numbers. Nothing is locked (N1): this is an order, never a gate.
 * - **A new player** (no leak with at least MIN_LEAK_DECISIONS decisions) gets the designer's default orbit.
 *
 * Pure: hands in, a route out. No clock, no RNG beyond the caller's seed.
 */

import { sessionProfile, type ArchetypeProfile } from '../archetypes.js';
import { REFERENCE_POP_ID, REFERENCE_REACH, classDecisionsFor } from '../reachRef.js';
import { reachWeightedLoss } from '../rw.js';
import type { Street } from '../table.js';
import type { StoryState } from '../progression/types.js';
import { LEAK_KINDS, LEAK_LABELS, VENUES, rivalOf, type ChapterId, type LeakKind, type Venue } from './cast.js';

/** A pattern needs this many charged decisions before it reorders anything: one bad call is not a leak. */
export const MIN_LEAK_DECISIONS = 2;

/** The decision shape the hand log stores (session.ts DecisionRecord), seen structurally. */
export interface LoggedDecision {
  readonly street: Street;
  readonly toCall: number;
  readonly action: string;
  readonly verdict: { readonly severity: string; readonly evLossBb: number; readonly principle: string | null } | null;
}

export interface LoggedHand {
  readonly decisions?: readonly LoggedDecision[];
}

/** The coach's principle × the action taken, or null for a decision that cost nothing or no known pattern. */
export function leakKindOf(d: LoggedDecision): LeakKind | null {
  const v = d.verdict;
  if (v === null || v.severity === 'free' || v.principle === null) return null;
  const aggressive = d.action === 'bet' || d.action === 'raise' || d.action === 'allin';
  if (v.principle === 'pot odds') {
    if (d.action === 'fold' && d.toCall > 0) return 'over-fold';
    if (d.action === 'call') return 'over-call';
    return null;
  }
  if (v.principle === 'value or bluff') {
    if (d.action === 'check') return 'missed-value';
    if (d.action === 'fold' && d.toCall === 0) return 'free-fold';
    if (aggressive && d.toCall === 0) return 'empty-bluff';
    return null;
  }
  if (v.principle === 'ranges' && aggressive && d.toCall > 0) return 'light-raise';
  return null;
}

export interface LeakSummary {
  readonly kind: LeakKind;
  readonly decisions: number;
  readonly costBb: number;
  readonly meanBb: number;
  /** Reach-weighted loss, bb/100 (rw.ts), summed over the streets the kind occurred on. */
  readonly rw: number;
  /** Charged decisions of this kind per street. */
  readonly byStreet: Readonly<Partial<Record<Street, number>>>;
  /** The street carrying the most cost. */
  readonly topStreet: Street;
}

export function leakSummaries(hands: readonly LoggedHand[]): LeakSummary[] {
  const groups = new Map<LeakKind, { d: LoggedDecision; principle: string }[]>();
  for (const hand of hands) {
    for (const d of hand.decisions ?? []) {
      const kind = leakKindOf(d);
      if (kind === null || d.verdict === null || d.verdict.principle === null) continue;
      const list = groups.get(kind) ?? [];
      list.push({ d, principle: d.verdict.principle });
      groups.set(kind, list);
    }
  }
  const out: LeakSummary[] = [];
  for (const kind of LEAK_KINDS) {
    const list = groups.get(kind);
    if (!list) continue;
    const costBb = list.reduce((sum, x) => sum + (x.d.verdict?.evLossBb ?? 0), 0);
    const byStreet: Partial<Record<Street, number>> = {};
    const costByStreet: Partial<Record<Street, number>> = {};
    for (const { d } of list) {
      byStreet[d.street] = (byStreet[d.street] ?? 0) + 1;
      costByStreet[d.street] = (costByStreet[d.street] ?? 0) + (d.verdict?.evLossBb ?? 0);
    }
    const graded = list.map(({ d, principle }) => ({ street: d.street, principle, deltaEvBb: d.verdict?.evLossBb ?? 0 }));
    const report = reachWeightedLoss(classDecisionsFor(graded), REFERENCE_REACH);
    const rw = report.classes.reduce((sum, c) => sum + c.rw, 0);
    const topStreet = (Object.entries(costByStreet) as [Street, number][]).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    out.push({ kind, decisions: list.length, costBb, meanBb: costBb / list.length, rw, byStreet, topStreet });
  }
  return out.sort((a, b) => b.rw - a.rw || b.costBb - a.costBb || LEAK_KINDS.indexOf(a.kind) - LEAK_KINDS.indexOf(b.kind));
}

export interface RoutedChapter {
  readonly venue: Venue;
  /** 1-based place on the orbit, after personalization. */
  readonly position: number;
  /** 1-based place on the default orbit. */
  readonly defaultPosition: number;
  /** The leak that moved this chapter, or null on its default place. */
  readonly leak: LeakSummary | null;
  /** Where this chapter's personalization came from, in words with its numbers; null when not personalized. */
  readonly citation: string | null;
  readonly beaten: boolean;
}

export interface StoryRoute {
  readonly chapters: readonly RoutedChapter[];
  readonly next: ChapterId;
  readonly personalized: boolean;
  readonly leaks: readonly LeakSummary[];
  /** The data the route was read from, for the citations. */
  readonly source: { readonly hands: number; readonly decisions: number; readonly reach: string };
  /** One line on why the orbit is in this order. */
  readonly why: string;
}

const fmt = (n: number): string => n.toFixed(1);
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function citationFor(leak: LeakSummary, hands: number): string {
  return (
    `From your last ${plural(hands, 'hand')}: ${LEAK_LABELS[leak.kind]}, ${fmt(leak.costBb)} bb across ` +
    `${plural(leak.decisions, 'decision')}, reach-weighted ${fmt(leak.rw)} bb/100.`
  );
}

export function buildRoute(hands: readonly LoggedHand[], story: StoryState): StoryRoute {
  const leaks = leakSummaries(hands).filter((l) => l.decisions >= MIN_LEAK_DECISIONS);
  const decisions = hands.reduce((n, h) => n + (h.decisions?.filter((d) => d.verdict !== null).length ?? 0), 0);
  const leakFor = (venue: Venue): LeakSummary | null => leaks.find((l) => venue.targets.includes(l.kind)) ?? null;
  const last = VENUES[VENUES.length - 1];
  const moved = VENUES.filter((v) => v !== last && leakFor(v) !== null).sort((a, b) => {
    const la = leakFor(a) as LeakSummary;
    const lb = leakFor(b) as LeakSummary;
    return leaks.indexOf(la) - leaks.indexOf(lb) || VENUES.indexOf(a) - VENUES.indexOf(b);
  });
  const rest = VENUES.filter((v) => v !== last && !moved.includes(v));
  const order = [...moved, ...rest, last];
  const chapters = order.map((venue, i): RoutedChapter => {
    const leak = moved.includes(venue) ? leakFor(venue) : null;
    return {
      venue,
      position: i + 1,
      defaultPosition: VENUES.indexOf(venue) + 1,
      leak,
      citation: leak ? citationFor(leak, hands.length) : null,
      beaten: story.chapters[venue.id]?.beatenOn != null,
    };
  });
  const next = (chapters.find((c) => !c.beaten) ?? chapters[0]).venue.id;
  const top = leaks[0];
  const why =
    moved.length > 0 && top
      ? `Ordered by what costs you most: ${LEAK_LABELS[top.kind]} comes first.`
      : decisions === 0
        ? 'The default orbit: no graded decisions on record yet.'
        : `The default orbit: no costly pattern repeats in your last ${plural(hands.length, 'hand')} yet.`;
  return {
    chapters,
    next,
    personalized: moved.length > 0,
    leaks,
    source: { hands: hands.length, decisions, reach: REFERENCE_POP_ID },
    why,
  };
}

// ── the rival's table ───────────────────────────────────────────────────────────────────────────────

export interface Tailor {
  readonly kind: LeakKind;
  readonly street: Street;
  /** What the rival does differently, and the numbers that chose it. */
  readonly text: string;
}

export interface RivalTable {
  /** The rival's profile for the session: the archetype, jittered once by the table seed (O3). */
  readonly profile: ArchetypeProfile;
  /** The street the rival leans on, if the chapter is personalized. */
  readonly streetProfiles: Readonly<Partial<Record<Street, ArchetypeProfile>>>;
  readonly tailor: Tailor | null;
}

/** Raise a frequency but never lift a structural zero (archetypes.ts: an exact 0 is a fact about the style). */
const up = (value: number, by: number, cap: number): number => (value === 0 ? 0 : Math.min(cap, value + by));

const STREET_WORD: Readonly<Record<Street, string>> = {
  preflop: 'before the flop',
  flop: 'on the flop',
  turn: 'on the turn',
  river: 'on the river',
  showdown: 'at showdown',
};

/** The style change that exploits each kind, and how it reads. */
const LEANS: Readonly<Record<LeakKind, { apply: (p: ArchetypeProfile) => ArchetypeProfile; does: string }>> = {
  'over-fold': { apply: (p) => ({ ...p, bluffBetFreq: up(p.bluffBetFreq, 0.3, 0.9), bluffRaiseFreq: up(p.bluffRaiseFreq, 0.1, 0.6) }), does: 'bluffs more' },
  'over-call': { apply: (p) => ({ ...p, raiseFreq: Math.max(p.raiseFreq, 0.95) }), does: 'bets every strong hand' },
  'missed-value': { apply: (p) => ({ ...p, bluffBetFreq: 0, loosecallFreq: up(p.loosecallFreq, 0.1, 0.95) }), does: 'checks to you and pays a bet' },
  'empty-bluff': { apply: (p) => ({ ...p, loosecallFreq: up(p.loosecallFreq, 0.1, 0.95) }), does: 'calls even more' },
  'light-raise': { apply: (p) => ({ ...p, bluffRaiseFreq: up(p.bluffRaiseFreq, 0.2, 0.8) }), does: 're-raises more' },
  'free-fold': { apply: (p) => ({ ...p, bluffBetFreq: 0 }), does: 'checks to you more' },
};

export function tableFor(venue: Venue, leak: LeakSummary | null, seed: number): RivalTable {
  const rival = rivalOf(venue);
  const profile = sessionProfile(rival.archetype, seed);
  if (leak === null || !venue.targets.includes(leak.kind)) return { profile, streetProfiles: {}, tailor: null };
  const lean = LEANS[leak.kind];
  const street = leak.topStreet;
  const onStreet = leak.byStreet[street] ?? 0;
  return {
    profile,
    streetProfiles: { [street]: lean.apply(profile) },
    tailor: {
      kind: leak.kind,
      street,
      text:
        `This regular ${lean.does} ${STREET_WORD[street]} at this table: ${onStreet} of your ` +
        `${plural(leak.decisions, 'costly decision')} of this kind came ${STREET_WORD[street]}.`,
    },
  };
}

/** The table's seed: one per chapter and attempt (hands already dealt), so a replay deals a new table and a test can pin one. */
export function tableSeed(chapterId: string, attempt: number, base: number): number {
  let h = 2166136261 ^ base;
  for (const ch of `${chapterId}#${attempt}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
