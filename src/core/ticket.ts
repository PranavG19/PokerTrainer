/**
 * TODAY'S TICKET (D16): one review unit a day, under 30 minutes.
 *
 * PRODUCT-SPEC bans a "session" under 30 minutes, because a short sitting cannot hold decay probes, remediation
 * floors and a scoreboard. The Ticket is not one of those sessions: it is REVIEW, and it takes only three things:
 *  1. what is due (schedule.ts `dueNow`), most overdue first, as many as fit;
 *  2. ONE perception drill (Speed or Sight, alternating by day);
 *  3. THREE spots from the costliest leak (puzzle scenarios whose decision is the leak's principle).
 * Nothing else: no new material, no live table, no scoreboard. The total is bounded by TICKET_MAX_MINUTES and the
 * bound is checked on the built Ticket, not trusted.
 *
 * The Ticket is built once a day and then frozen (progression.ticket), so working an item never reshuffles the rest.
 *
 * Pure: the caller passes `now`, the day and the facts.
 */

import type { DayKey } from './localDay.js';
import type { ConceptState } from './schedule.js';
import { dueNow } from './schedule.js';
import { MINUTES_PER_GRADED_SPOT, WARM_UP_BLOCK_MINUTES } from './sessionPlan.js';
import type { Scenario } from './puzzle.js';
import type { TicketItemRecord, TicketState } from './progression/types.js';

/** Strictly under thirty minutes (D16). */
export const TICKET_MAX_MINUTES = 29;
export const TICKET_SPOTS = 3;
/** A spot is a short scenario, a few decisions long. */
export const MINUTES_PER_SPOT = 2;
/** The one perception drill: the warm-up block's length. */
export const DRILL_MINUTES = WARM_UP_BLOCK_MINUTES;
/** The perception drills the Ticket rotates through (Train hub mode ids). */
export const PERCEPTION_DRILLS = ['anomaly', 'board'] as const;

export type TicketKind = 'review' | 'drill' | 'spot';

export interface TicketInput {
  readonly day: DayKey;
  readonly now: number;
  readonly concepts: readonly ConceptState[];
  /** The costliest leak's coach principle ('pot odds' | 'value or bluff' | 'ranges'), or null with no leak yet. */
  readonly leakPrinciple: string | null;
  readonly scenarios: readonly Scenario[];
  /** session.puzzleProgress: a spot already solved clean sorts after one not yet solved. */
  readonly puzzleProgress: Readonly<Record<string, { attempts: number; bestCorrect: number }>>;
}

/**
 * The coach principle a scenario's decisive step turns on: facing a bet (call or fold) is the price, a bet is value
 * or bluff, a raise is ranges. The last target step is the decision the scenario is about.
 */
export function scenarioPrinciple(s: Scenario): 'pot odds' | 'value or bluff' | 'ranges' {
  const last = s.target[s.target.length - 1]?.action;
  if (last === 'call' || last === 'fold') return 'pot odds';
  if (last === 'raise' || last === 'allin') return 'ranges';
  return 'value or bluff';
}

export function buildTicket(input: TicketInput): TicketItemRecord[] {
  // The drill and the spots are fixed in size; what is due fills the rest of the budget.
  const spots = pickSpots(input);
  const drill = PERCEPTION_DRILLS[Math.abs(input.day) % PERCEPTION_DRILLS.length];
  const fixed = DRILL_MINUTES + spots.length * MINUTES_PER_SPOT;
  const reviews: TicketItemRecord[] = [];
  let budget = TICKET_MAX_MINUTES - fixed;
  for (const due of dueNow(input.concepts, input.now)) {
    const minutes = round(due.reps * MINUTES_PER_GRADED_SPOT);
    if (minutes > budget) continue;
    budget -= minutes;
    reviews.push(item('review', due.conceptId, minutes));
  }
  return [...reviews, item('drill', drill, DRILL_MINUTES), ...spots.map((id) => item('spot', id, MINUTES_PER_SPOT))];
}

function pickSpots(input: TicketInput): string[] {
  const solvedClean = (s: Scenario): boolean => (input.puzzleProgress[s.id]?.bestCorrect ?? 0) >= s.target.length;
  const ranked = input.scenarios
    .map((s, i) => ({ s, i }))
    .sort(
      (a, b) =>
        Number(scenarioPrinciple(b.s) === input.leakPrinciple) - Number(scenarioPrinciple(a.s) === input.leakPrinciple) ||
        Number(solvedClean(a.s)) - Number(solvedClean(b.s)) ||
        // Rotate by day within a tier, so the same three do not come back every day.
        rotate(a.i, input.day, input.scenarios.length) - rotate(b.i, input.day, input.scenarios.length),
    );
  return ranked.slice(0, TICKET_SPOTS).map(({ s }) => s.id);
}

function rotate(i: number, day: DayKey, n: number): number {
  return n === 0 ? 0 : (i - ((Math.abs(day) * TICKET_SPOTS) % n) + n) % n;
}

function item(kind: TicketKind, ref: string, minutes: number): TicketItemRecord {
  return { id: `${kind}:${ref}`.slice(0, 64), kind, ref, minutes };
}

function round(m: number): number {
  return Math.round(m * 4) / 4;
}

export function ticketMinutes(items: readonly TicketItemRecord[]): number {
  return items.reduce((sum, i) => sum + i.minutes, 0);
}

/** Today's Ticket: the frozen one when it was built today, else a fresh build (not yet saved). */
export function ticketFor(state: TicketState, input: TicketInput): TicketState {
  if (state.day === input.day && state.items.length > 0) return state;
  return { day: input.day, items: buildTicket(input), done: [], finishedOn: state.finishedOn };
}

/**
 * Mark one item done. Unknown ids and repeats change nothing. When the last item is done, the Ticket is finished
 * today (`finishedOn`): the caller counts the streak day and the tally off that transition.
 */
export function markDone(state: TicketState, itemId: string, day: DayKey): TicketState {
  if (state.day !== day) return state;
  if (!state.items.some((i) => i.id === itemId) || state.done.includes(itemId)) return state;
  const done = [...state.done, itemId];
  const finished = state.items.every((i) => done.includes(i.id));
  return { ...state, done, finishedOn: finished ? day : state.finishedOn };
}

/** True when the Ticket was finished on `day`. */
export function finishedOn(state: TicketState, day: DayKey): boolean {
  return state.finishedOn === day;
}
