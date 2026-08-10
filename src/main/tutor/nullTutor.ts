/**
 * The null tutor and the fixed string table.
 *
 * This module imports nothing that can open a socket or spawn a process. That
 * is the whole guarantee behind T1's "with no key, the app is fully functional
 * and makes zero network calls" — it holds by construction here, not by a
 * runtime check somewhere else.
 *
 * Every string below is written to pass the T4 guard, and the unit tests replay
 * the entire table through it. Where a correction needs a specific noun it
 * interpolates one of the payload's *words* (principle, boundary hand, flipping
 * variable); it never writes a numeral of its own, so number provenance holds
 * even when the interpolated text contains digits like `76s`.
 */

import type { ErrorTag, GradePayload, TutorRequest, TutorResponse } from './types.js';

/**
 * G3, verbatim. Screen copy for first launch and the phase-0 screen — NOT a
 * tutor output, and deliberately not routed through the guard: it states the
 * silence threshold as a percentage, and that numeral has no payload to come
 * from. The tests assert it is absent from the guarded table.
 */
export const SILENCE_CONTRACT =
  'No comment means that decision cost almost nothing — under 2% of the pot. Silence is not praise.';

/** Three chunks: principle, consequence, boundary + flipping variable, then a next action. */
const CHUNK_BY_TAG: Readonly<Record<ErrorTag, string>> = {
  RANGE:
    'The continuing range here is stronger than the range taking this line, so marginal holdings shed value instead of gaining it.',
  TEXTURE:
    'This board favours the range that holds the overpairs and the nutted combinations, and the chosen line ignores which range that is.',
  PRICE: 'The price offered and the share of the pot needed to continue point in opposite directions.',
  BLOCKERS:
    'Holding a card that removes the opponent\'s strongest combinations changes which hands can be attacked here.',
  SIZING: 'The amount chosen does not match how polarised the range taking this line is.',
  'DEPTH-POSITION':
    'Stack depth and seat order set how much of this equity can actually be realised, and the line assumed more than either allows.',
  PURITY: 'The solver never takes this action at this node, so the branch itself is the error.',
};

const NEXT_ACTION_BY_TIER: Readonly<Record<'T2' | 'T3' | 'T4', string>> = {
  T2: 'Next: re-run this node with the variant that toggles that variable.',
  T3: 'Next: re-decide this node now, then again in two days.',
  T4: 'Next: work the example, then re-decide this node before continuing.',
};

/**
 * The correction for a graded decision, or `null` when the tier is silent.
 * T0 and T1 return `null` rather than a string: G1 gives T0 "nothing, ever" and
 * T1 "logged silently", so a fixed string for either would break the silence
 * contract the null tutor is meant to honour.
 */
export function fixedCorrection(grade: GradePayload): string | null {
  if (grade.tier === 'T0' || grade.tier === 'T1') return null;
  return [
    `${grade.principle}.`,
    CHUNK_BY_TAG[grade.errorTag],
    `Boundary: ${grade.boundaryHand}; the flipping variable is ${grade.flippingVariable}.`,
    NEXT_ACTION_BY_TIER[grade.tier],
  ].join(' ');
}

/** The Interrogator's fallback: one question, ≤20 words, task as subject. */
export function fixedQuestion(grade: GradePayload): string {
  return `Which variable flips this node between ${grade.chosenAction} and ${grade.bestAction}?`;
}

/** The pre-commit rules fallback. Names no action as better — T3a forbids it. */
export function fixedRulesAnswer(): string {
  return 'The rules card lists what each action does, the order of play, and which hand beats which. The table shows the legal actions for this seat. Next: open the rules card.';
}

/** Something has to reach the rail even when the tier is silent and prose was requested. */
export const FIXED_SILENT_NOTICE = 'Nothing was lost on that decision, so nothing is corrected.';

export interface Tutor {
  readonly id: string;
  respond(request: TutorRequest): Promise<TutorResponse>;
}

function fixedTextFor(request: TutorRequest): { text: string; kind: 'correction' | 'question' } {
  if (request.kind === 'rules') {
    return { text: fixedRulesAnswer(), kind: 'correction' };
  }
  const correction = fixedCorrection(request.grade);
  return correction === null
    ? { text: FIXED_SILENT_NOTICE, kind: 'correction' }
    : { text: correction, kind: 'correction' };
}

/**
 * The default tutor. Returns fixtures, resolves synchronously in effect, and is
 * what every e2e run drives so the teaching machine is testable with no model
 * present.
 */
export const nullTutor: Tutor = {
  id: 'null',
  async respond(request: TutorRequest): Promise<TutorResponse> {
    const { text, kind } = fixedTextFor(request);
    return { text, kind, source: 'fixed' };
  },
};

/** Exposed so the guarded live path can fall back to the same strings. */
export function fixedResponse(request: TutorRequest): TutorResponse {
  const { text, kind } = fixedTextFor(request);
  return { text, kind, source: 'fixed' };
}
