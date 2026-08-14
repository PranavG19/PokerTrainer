import type { Lesson, LessonPhase } from './types.js';
import { potOddsAsAPrice } from './content/pot-odds-as-a-price.js';
import { whatTheActionsMean } from './content/what-the-actions-mean.js';
import { handRankingsInOrder } from './content/hand-rankings-in-order.js';
import { bettingOrderAndPosition } from './content/betting-order-and-position.js';
import { alphaTheBluffPrice } from './content/alpha-the-bluff-price.js';
import { sprSetsThePlan } from './content/spr-sets-the-plan.js';
import { combosNotHands } from './content/combos-not-hands.js';
import { rangeRoleBettorOrCaller } from './content/range-role-bettor-or-caller.js';
import { countingOutsAsAFrequency } from './content/counting-outs-as-a-frequency.js';
import { minimumDefenceFrequency } from './content/minimum-defence-frequency.js';
import { dominationAndDeadHands } from './content/domination-and-dead-hands.js';
import { equityRealisation } from './content/equity-realisation.js';
import { rangeAdvantageVersusNutAdvantage } from './content/range-advantage-versus-nut-advantage.js';
import { polarityPicksTheSize } from './content/polarity-picks-the-size.js';
import { bestFiveFromSeven } from './content/best-five-from-seven.js';
import { boardTextureDimensions } from './content/board-texture-dimensions.js';
import { whoHoldsTheNuts } from './content/who-holds-the-nuts.js';
import { positionSetsYourRange } from './content/position-sets-your-range.js';

/**
 * Every lesson the app knows about. Explicit imports, not a glob: the renderer is bundled
 * by Vite and the unit tests run under Vitest, so a directory scan would either break the
 * build or silently register nothing. Adding a lesson means adding two lines here.
 *
 * Order is authoring order, not curriculum order — phases order content (N1), and no code
 * may read this array as a queue.
 */
export const LESSONS: readonly Lesson[] = [
  potOddsAsAPrice,
  rangeRoleBettorOrCaller,
  countingOutsAsAFrequency,
  minimumDefenceFrequency,
  alphaTheBluffPrice,
  sprSetsThePlan,
  combosNotHands,
  polarityPicksTheSize,
  dominationAndDeadHands,
  equityRealisation,
  rangeAdvantageVersusNutAdvantage,
  whatTheActionsMean,
  handRankingsInOrder,
  bettingOrderAndPosition,
  bestFiveFromSeven,
  boardTextureDimensions,
  whoHoldsTheNuts,
  positionSetsYourRange,
];

export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((lesson) => lesson.id === id);
}

export function lessonsInPhase(phase: LessonPhase): readonly Lesson[] {
  return LESSONS.filter((lesson) => lesson.phase === phase);
}

export type { Lesson, LessonExample, LessonPhase, LessonPosition } from './types.js';
