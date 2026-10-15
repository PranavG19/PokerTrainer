/**
 * Today's ring (VISION Pillar 3): three goals for the day, each closed by something the learner did today. Derived,
 * never stored: every goal reads a record that already exists.
 *
 *  - **Due**: clear what is due. Closed when nothing is due now AND the learner did graded work today (an empty
 *    queue on a day with no work closes nothing: the ring pays for effort, never for absence).
 *  - **Suggestion**: take the one suggestion (N2). Closed on the day it was taken.
 *  - **Rule**: one rule in your words. Closed when a rule sentence was written today (accepted or saved).
 *
 * The ring has no streak of its own and nothing carries over: tomorrow it is open again.
 */

import type { DayKey } from '../localDay.js';

export type RingGoalId = 'due' | 'suggestion' | 'rule';

export interface RingGoal {
  readonly id: RingGoalId;
  readonly label: string;
  /** What closes it, or what closed it. */
  readonly detail: string;
  readonly done: boolean;
}

export interface Ring {
  readonly goals: readonly RingGoal[];
  readonly closed: number;
}

export interface RingInput {
  readonly today: DayKey;
  /** Concepts due right now (schedule.ts dueNow). */
  readonly dueNow: number;
  /** Reps awarded today (reps.ts repsOn). */
  readonly repsToday: number;
  /** The day the one suggestion was last taken. */
  readonly suggestionTakenOn: DayKey | null;
  /** Whether a suggestion is on offer at all (the recommender may have nothing owed). */
  readonly suggestionOffered: boolean;
  /** Days on which a rule sentence was written (lexicon attempts and Dee's remembered rules). */
  readonly ruleDays: readonly DayKey[];
}

export function todaysRing(input: RingInput): Ring {
  const dueDone = input.dueNow === 0 && input.repsToday > 0;
  const suggestionDone = input.suggestionTakenOn === input.today;
  const ruleDone = input.ruleDays.includes(input.today);
  const goals: RingGoal[] = [
    {
      id: 'due',
      label: 'Clear what is due',
      detail: dueDone
        ? 'Nothing left due today'
        : input.dueNow > 0
          ? `${input.dueNow} ${input.dueNow === 1 ? 'concept' : 'concepts'} due`
          : 'Nothing due; one graded rep closes it',
      done: dueDone,
    },
    {
      id: 'suggestion',
      label: 'Take the suggestion',
      detail: suggestionDone ? 'Taken today' : input.suggestionOffered ? 'One suggestion on Home' : 'Nothing suggested yet',
      done: suggestionDone,
    },
    {
      id: 'rule',
      label: 'One rule in your words',
      detail: ruleDone ? 'Written today' : 'Write one in a lesson or a repair',
      done: ruleDone,
    },
  ];
  return { goals, closed: goals.filter((g) => g.done).length };
}
