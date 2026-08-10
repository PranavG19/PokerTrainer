import type { Card } from '../cards.js';
import type { Street } from '../table.js';

/**
 * Lesson content as inert data. No functions, no DOM: a lesson is something a renderer
 * reads, so the same lesson can be shown as a card, a drill, or a rail quote without
 * the content knowing which.
 */

/**
 * Spine phases 0–3 (PRODUCT-SPEC "The spine — six phases"). Phases 4+ situate rules against
 * solver node values, and no spot bank exists yet, so they are deliberately not modelled —
 * a phase-4 lesson written today could not be graded.
 *
 * 0 Rules, 1 Eyes, 2 Arithmetic, 3 Principles. Phases order content, never access (N1).
 */
export type LessonPhase = 0 | 1 | 2 | 3;

/** Position under study, named for the 4-seat table the engine deals. */
export type LessonPosition = 'BTN' | 'CO' | 'SB' | 'BB';

/**
 * One position the learner is asked to play. The board/pot/stack fields are the visible
 * state the learner reasons from — they are the example, not decoration, so a renderer
 * must be able to draw the whole spot from this object alone.
 */
export interface LessonExample {
  /** Unique within its lesson; lets a report or the lexicon cite one example. */
  id: string;

  /** Hero's hole cards in the engine's notation, e.g. ['Ah', 'Kd'] (see src/core/cards.ts). */
  hole: Card[];

  /** Community cards visible at this decision: [] preflop, 3 on the flop, 4 turn, 5 river. */
  board: Card[];

  /** Must agree with board.length; carried explicitly so content is checkable by eye. */
  street: Street;

  /** Chips already in the middle, in the same units as stacks. */
  pot: number;

  /** Hero's remaining stack. */
  heroStack: number;

  /**
   * Villain stacks, one per opponent still in the hand. Length is the opponent count,
   * and the shorter stack is what caps a bet, so this cannot collapse to a single number.
   */
  villainStacks: number[];

  /** Big blind size, so pot and stacks can be read in bb without guessing the level. */
  bb: number;

  /** Which seat hero is acting from. */
  position: LessonPosition;

  /**
   * Chips hero must put in to continue: 0 when checking is free. Kept separate from pot
   * because pot odds need both and one cannot be derived from the other.
   */
  toCall: number;

  /**
   * Asks the learner how they would play it. Phrased as a question only — G5 and story 12:
   * the learner names the spot and commits before any answer is visible, so this field
   * must not hint at the action, and `reasoning` must stay hidden until commit.
   */
  prompt: string;

  /**
   * Revealed only after the learner commits. Three chunks, ≤60 words, task-as-subject,
   * ending in a next action (G6). Never praise, never a trait claim (G7).
   */
  reasoning: string;
}

export interface Lesson {
  /** Stable kebab-case id, e.g. 'domination-suited-broadways'. Referenced by prerequisites,
   * saved progress and lexicon entries, so renaming one breaks stored data. */
  id: string;

  phase: LessonPhase;

  title: string;

  /**
   * The one idea this lesson installs, in one sentence. It is the target the learner's own
   * mechanism sentence is compared against (L1: the learner's sentence becomes the concept's
   * name), so it states a mechanism, not a memorised conclusion.
   */
  mechanism: string;

  /**
   * Lesson ids that make this one land sooner. ADVISORY ONLY — N1: nothing is ever locked.
   * A recommender may order by this; no code may use it to gate, grey out, or refuse entry.
   */
  prerequisites: string[];

  examples: LessonExample[];

  /**
   * Keywords accepted by L2's fallback check on the learner's mechanism sentence, used when
   * no answer key is available and the learner self-marks. Populate with mechanism framings —
   * domination risk, equity realisation, range asymmetry — never a cached cell such as
   * "K7s is a CO open", which names a conclusion instead of the reason behind it.
   */
  acceptanceKeywords: string[];
}
