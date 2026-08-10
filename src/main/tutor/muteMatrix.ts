/**
 * T5 — the mute matrix, plus the rules-vs-strategy classifier that decides
 * which column a question lands in.
 *
 * The table below is transcribed cell-for-cell from T5 and is the only place
 * the policy lives. The classifier is a keyword allowlist over a fixed rules
 * vocabulary: deterministic, and biased toward refusal, so anything ambiguous
 * is treated as strategy.
 */

export type TutorContext =
  | 'plm-drill'
  | 'spot-pre-commit'
  | 'spot-post-reveal'
  | 'assessment'
  | 'table-ungraded'
  | 'table-whole-task'
  | 'dossier-progress';

export type QuestionKind = 'rules' | 'strategy';

export type Verdict = 'allowed' | 'blocked';

/** The third T5 column. Not a question verdict — it governs the tutor speaking unbidden. */
export type UnpromptedCoach = 'never' | 'tier-t2-plus' | 'batched-to-block-end';

interface Row {
  readonly strategy: Verdict;
  readonly rules: Verdict;
  readonly unpromptedCoach: UnpromptedCoach;
}

const T5: Readonly<Record<TutorContext, Row>> = {
  'plm-drill': { strategy: 'blocked', rules: 'blocked', unpromptedCoach: 'never' },
  'spot-pre-commit': { strategy: 'blocked', rules: 'allowed', unpromptedCoach: 'never' },
  'spot-post-reveal': { strategy: 'allowed', rules: 'allowed', unpromptedCoach: 'tier-t2-plus' },
  assessment: { strategy: 'blocked', rules: 'allowed', unpromptedCoach: 'never' },
  'table-ungraded': { strategy: 'allowed', rules: 'allowed', unpromptedCoach: 'never' },
  'table-whole-task': {
    strategy: 'blocked',
    rules: 'allowed',
    unpromptedCoach: 'batched-to-block-end',
  },
  'dossier-progress': { strategy: 'allowed', rules: 'allowed', unpromptedCoach: 'never' },
};

export function questionVerdict(context: TutorContext, kind: QuestionKind): Verdict {
  const row = T5[context];
  return kind === 'rules' ? row.rules : row.strategy;
}

export function unpromptedCoach(context: TutorContext): UnpromptedCoach {
  return T5[context].unpromptedCoach;
}

/**
 * The fixed rules vocabulary — mechanics only. Every term here names something
 * that has one answer independent of strategy: an action, a street, a position,
 * a hand ranking, a piece of table procedure.
 */
export const RULES_VOCABULARY: readonly string[] = [
  'fold',
  'folds',
  'check',
  'checks',
  'call',
  'calls',
  'bet',
  'bets',
  'raise',
  'raises',
  'reraise',
  'allin',
  'all-in',
  'limp',
  'blind',
  'blinds',
  'ante',
  'button',
  'dealer',
  'position',
  'positions',
  'utg',
  'cutoff',
  'hijack',
  'preflop',
  'flop',
  'turn',
  'river',
  'street',
  'streets',
  'showdown',
  'pot',
  'side',
  'stack',
  'stacks',
  'hand',
  'hands',
  'card',
  'cards',
  'hole',
  'board',
  'suit',
  'suits',
  'suited',
  'offsuit',
  'rank',
  'ranks',
  'pair',
  'pairs',
  'trips',
  'set',
  'straight',
  'flush',
  'boat',
  'quads',
  'kicker',
  'beats',
  'wins',
  'ties',
  'split',
  'order',
  'turn-order',
  'act',
  'acts',
  'legal',
  'minimum',
  'mean',
  'means',
  'work',
  'works',
  'rule',
  'rules',
];

/**
 * Terms that force the strategy column. Includes normative modals: "should I
 * fold" is every word in the rules vocabulary and still a strategy question.
 */
export const STRATEGY_MARKERS: readonly string[] = [
  'should',
  'best',
  'better',
  'worse',
  'worst',
  'optimal',
  'correct',
  'right',
  'wrong',
  'profitable',
  // Evaluative adjectives. "Is this a good spot to raise" is every-word-rules
  // and unmistakably a strategy question, so the evaluation itself is a marker.
  'good',
  'bad',
  'strong',
  'weak',
  'ahead',
  'behind',
  'worth',
  'prefer',
  'ev',
  'equity',
  'odds',
  'outs',
  'range',
  'ranges',
  'gto',
  'solver',
  'balanced',
  'exploit',
  'exploitative',
  'frequency',
  'frequencies',
  'bluff',
  'bluffs',
  'value',
  'polarised',
  'polarized',
  'capped',
  'blocker',
  'blockers',
  'texture',
  'mdf',
  'alpha',
  'spr',
  'sizing',
  'combos',
  'read',
  'reads',
  'tendency',
  'tendencies',
  'play',
  'playing',
  'recommend',
  'advise',
];

function tokens(question: string): string[] {
  return question
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((t) => t !== '');
}

/**
 * Biased toward refusal by construction: a question is `rules` only when it
 * names something in the rules vocabulary AND names nothing strategic. Anything
 * else — including a question with no recognised terms at all — is `strategy`,
 * which is the more restrictive column in every row of T5.
 */
export function classifyQuestion(question: string): QuestionKind {
  const words = tokens(question);
  const strategyTerms = new Set(STRATEGY_MARKERS);
  if (words.some((w) => strategyTerms.has(w))) return 'strategy';

  const rulesTerms = new Set(RULES_VOCABULARY);
  return words.some((w) => rulesTerms.has(w)) ? 'rules' : 'strategy';
}

/** The whole gate in one call: classify, then look the verdict up in T5. */
export function askVerdict(
  context: TutorContext,
  question: string,
): { readonly kind: QuestionKind; readonly verdict: Verdict } {
  const kind = classifyQuestion(question);
  return { kind, verdict: questionVerdict(context, kind) };
}
