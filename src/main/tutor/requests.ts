/**
 * T3a — two request builders, two input types.
 *
 * The pre-commit rules path is served by `buildRulesRequest`, whose input
 * (RulesInput) has no field for ΔEV, action EVs, best action or equity, and
 * whose output (RulesRequest) has none either. There is no shared supertype
 * carrying those fields: the strategy path's input is a separate interface, so
 * a leak requires editing a type rather than forgetting a check.
 *
 * Both builders also emit the PromptEnvelope, because the envelope is what
 * actually reaches the model — a payload that is clean while the rendered
 * prompt smuggles a number in would satisfy the type and defeat the rule.
 */

import type {
  GradePayload,
  PromptEnvelope,
  RulesRequest,
  StrategyRequest,
  TutorOutputKind,
  VisibleTable,
} from './types.js';
import { RULES_VOCABULARY } from './muteMatrix.js';
import { WORD_LIMITS } from './guard.js';

/** Pre-commit input. Visible table state and a question. Nothing else exists here. */
export interface RulesInput {
  readonly question: string;
  readonly table: VisibleTable;
}

/** Post-reveal input. This is the type that is *allowed* to carry the numbers. */
export interface StrategyInput {
  readonly prompt: string;
  readonly table: VisibleTable;
  readonly grade: GradePayload;
  readonly lexicon: readonly string[];
}

export interface BuiltRequest<TPayload> {
  readonly payload: TPayload;
  readonly envelope: PromptEnvelope;
  readonly kind: TutorOutputKind;
}

const SHARED_RULES = [
  'Make the hand, the range or the decision the grammatical subject. Never open with "you".',
  'Never praise, never mention streaks, ranks or percentiles, never attribute a trait to the learner.',
  'Never state a number that is not already in the payload below.',
].join(' ');

function renderTable(table: VisibleTable): string {
  return [
    `street: ${table.street}`,
    `board: ${table.board.length === 0 ? '(none)' : table.board.join(' ')}`,
    `hero cards: ${table.heroCards.join(' ')}`,
    `pot: ${table.potBb}bb`,
    `positions: ${table.positions.join(', ')}`,
    `stacks: ${table.stacksBb.map((s) => `${s}bb`).join(', ')}`,
    `to act: ${table.toAct}`,
  ].join('\n');
}

/**
 * Pre-commit. The envelope is assembled from RulesInput alone, so there is no
 * expression in this function that could reference a solver quantity.
 */
export function buildRulesRequest(input: RulesInput): BuiltRequest<RulesRequest> {
  const payload: RulesRequest = {
    kind: 'rules',
    question: input.question,
    vocabulary: RULES_VOCABULARY,
    table: input.table,
  };

  const envelope: PromptEnvelope = {
    system: [
      'Answer a mechanics question about Texas hold\'em. Rules only.',
      'You have no strategic information about this hand and must not imply any:',
      'do not say which action is better, do not rank actions, do not hint at equity.',
      SHARED_RULES,
      `Answer in at most ${WORD_LIMITS.correction} words.`,
    ].join(' '),
    user: [
      `question: ${input.question}`,
      '',
      'visible table:',
      renderTable(input.table),
      '',
      `rules vocabulary: ${RULES_VOCABULARY.join(', ')}`,
    ].join('\n'),
    maxTokens: 300,
  };

  return { payload, envelope, kind: 'correction' };
}

function renderGrade(grade: GradePayload): string {
  const evs = Object.entries(grade.actionEvsBb)
    .map(([action, ev]) => `${action}=${ev}bb`)
    .join(', ');
  return [
    `tier: ${grade.tier}`,
    `deltaEv: ${grade.deltaEvBb}bb`,
    `pot before the learner's action: ${grade.potBeforeActionBb}bb`,
    `chosen: ${grade.chosenAction}`,
    `best: ${grade.bestAction}`,
    `action EVs: ${evs}`,
    `equity: ${grade.equityPct}%`,
    `error tag: ${grade.errorTag}`,
    `principle: ${grade.principle}`,
    `boundary hand: ${grade.boundaryHand}`,
    `flipping variable: ${grade.flippingVariable}`,
    `class RW: ${grade.classRwBbPer100}bb/100`,
  ].join('\n');
}

/** Post-reveal. `kind` selects the T4 word budget the guard will enforce. */
export function buildStrategyRequest(
  input: StrategyInput,
  kind: TutorOutputKind,
): BuiltRequest<StrategyRequest> {
  const payload: StrategyRequest = {
    kind: 'strategy',
    prompt: input.prompt,
    table: input.table,
    grade: input.grade,
    lexicon: input.lexicon,
  };

  const budget =
    kind === 'question'
      ? `Ask exactly one question, at most ${WORD_LIMITS.question} words.`
      : `Write three chunks — principle name, range or board consequence, then the boundary and the one variable that flips it — ending in a next action, in at most ${WORD_LIMITS.correction} words.`;

  const envelope: PromptEnvelope = {
    system: [
      'The engine has already graded this decision. Narrate its numbers; never compute one.',
      SHARED_RULES,
      budget,
    ].join(' '),
    user: [
      `request: ${input.prompt}`,
      '',
      'visible table:',
      renderTable(input.table),
      '',
      'engine numbers:',
      renderGrade(input.grade),
      '',
      input.lexicon.length === 0
        ? 'learner lexicon: (none)'
        : `learner lexicon: ${input.lexicon.map((l) => `"${l}"`).join('; ')}`,
    ].join('\n'),
    maxTokens: 400,
  };

  return { payload, envelope, kind };
}
