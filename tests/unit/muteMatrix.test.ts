import { describe, expect, it } from 'vitest';
import {
  RULES_VOCABULARY,
  STRATEGY_MARKERS,
  askVerdict,
  classifyQuestion,
  questionVerdict,
  unpromptedCoach,
  type QuestionKind,
  type TutorContext,
  type UnpromptedCoach,
  type Verdict,
} from '../../src/main/tutor/muteMatrix.js';

/**
 * T5, transcribed independently of the implementation table so a silent edit to
 * one cell fails here. Order: [strategy, rules, unprompted coach].
 */
const T5_LITERAL: readonly [TutorContext, Verdict, Verdict, UnpromptedCoach][] = [
  ['plm-drill', 'blocked', 'blocked', 'never'],
  ['spot-pre-commit', 'blocked', 'allowed', 'never'],
  ['spot-post-reveal', 'allowed', 'allowed', 'tier-t2-plus'],
  ['assessment', 'blocked', 'allowed', 'never'],
  ['table-ungraded', 'allowed', 'allowed', 'never'],
  ['table-whole-task', 'blocked', 'allowed', 'batched-to-block-end'],
  ['dossier-progress', 'allowed', 'allowed', 'never'],
];

describe('T5 — every cell of the mute matrix', () => {
  for (const [context, strategy, rules, coach] of T5_LITERAL) {
    it(`${context}: strategy=${strategy}, rules=${rules}, coach=${coach}`, () => {
      expect(questionVerdict(context, 'strategy')).toBe(strategy);
      expect(questionVerdict(context, 'rules')).toBe(rules);
      expect(unpromptedCoach(context)).toBe(coach);
    });
  }

  it('covers all seven contexts and no others', () => {
    expect(T5_LITERAL).toHaveLength(7);
    expect(new Set(T5_LITERAL.map(([c]) => c)).size).toBe(7);
  });

  it('rules questions are allowed everywhere except a PLM drill', () => {
    // "Rules questions are always allowed because a zero-context beginner is
    // otherwise stuck" — with the drill's no-verbalisation rule overriding.
    for (const [context, , rules] of T5_LITERAL) {
      expect(rules, context).toBe(context === 'plm-drill' ? 'blocked' : 'allowed');
    }
  });

  it('strategy is blocked pre-commit and in assessment, allowed post-reveal', () => {
    expect(questionVerdict('spot-pre-commit', 'strategy')).toBe('blocked');
    expect(questionVerdict('assessment', 'strategy')).toBe('blocked');
    expect(questionVerdict('spot-post-reveal', 'strategy')).toBe('allowed');
  });

  it('the unprompted coach never fires outside post-reveal and the whole-task block', () => {
    const speaking = T5_LITERAL.filter(([, , , coach]) => coach !== 'never').map(([c]) => c);
    expect(speaking).toEqual(['spot-post-reveal', 'table-whole-task']);
  });
});

describe('the rules-vs-strategy classifier is biased toward refusal', () => {
  const rulesQuestions = [
    'what does check mean',
    'which hand beats a flush',
    'who acts first on the flop',
    'what is the minimum raise',
    'how do the blinds work',
    'is a straight higher than trips',
    'what are my legal actions',
    'how does a side pot work',
  ];
  for (const q of rulesQuestions) {
    it(`rules: "${q}"`, () => {
      expect(classifyQuestion(q)).toBe('rules');
    });
  }

  const strategyQuestions = [
    'should I fold here',
    'what is the best action',
    'is calling correct',
    'what is my equity',
    'how wide is their range',
    'do I have the odds to call',
    'what does the solver do here',
    'how often should I bluff this river',
    'what would you recommend',
    'is this a good spot to raise',
  ];
  for (const q of strategyQuestions) {
    it(`strategy: "${q}"`, () => {
      expect(classifyQuestion(q)).toBe('strategy');
    });
  }

  it('a strategy marker beats a rules term in the same question — refusal wins', () => {
    // Every word but "should" is rules vocabulary.
    expect(classifyQuestion('should I check or bet on this street')).toBe('strategy');
    expect(classifyQuestion('what is the best position to call from')).toBe('strategy');
  });

  it('degenerate: unrecognised, empty and punctuation-only questions are strategy', () => {
    expect(classifyQuestion('')).toBe('strategy');
    expect(classifyQuestion('   ')).toBe('strategy');
    expect(classifyQuestion('???')).toBe('strategy');
    expect(classifyQuestion('hmm')).toBe('strategy');
    expect(classifyQuestion('tell me about this')).toBe('strategy');
  });

  it('is case- and punctuation-insensitive', () => {
    expect(classifyQuestion('WHAT DOES CHECK MEAN?!')).toBe('rules');
    expect(classifyQuestion('Should I FOLD?')).toBe('strategy');
  });

  it('matches whole tokens, not substrings — "reads" must not be found inside another word', () => {
    // "already" contains "read" as a substring; a substring classifier would
    // mark this strategy for the wrong reason. Tokenised, it has no strategy
    // marker and one rules term ("board"), so it is rules.
    expect(classifyQuestion('is the board already complete')).toBe('rules');
    // And the real token does classify as strategy.
    expect(classifyQuestion('what read do I have on the board')).toBe('strategy');
  });

  it('a hyphenated rules term is one token', () => {
    expect(classifyQuestion('what is the turn-order')).toBe('rules');
    expect(classifyQuestion('what does all-in mean')).toBe('rules');
  });

  it('the two vocabularies are disjoint, so no term decides both ways', () => {
    const rules = new Set(RULES_VOCABULARY);
    const overlap = STRATEGY_MARKERS.filter((m) => rules.has(m));
    expect(overlap).toEqual([]);
  });
});

describe('askVerdict — classify, then apply T5', () => {
  const cases: readonly [TutorContext, string, QuestionKind, Verdict][] = [
    ['spot-pre-commit', 'what does check mean', 'rules', 'allowed'],
    ['spot-pre-commit', 'should I check here', 'strategy', 'blocked'],
    // The bad case T3a exists to stop: a "rules question" that is really a
    // strategy question must land in the strategy column pre-commit.
    ['spot-pre-commit', 'what is the best legal action', 'strategy', 'blocked'],
    ['plm-drill', 'what does check mean', 'rules', 'blocked'],
    ['plm-drill', 'should I check', 'strategy', 'blocked'],
    ['assessment', 'which hand beats a flush', 'rules', 'allowed'],
    ['assessment', 'what is my equity', 'strategy', 'blocked'],
    ['spot-post-reveal', 'should I have bet', 'strategy', 'allowed'],
    ['table-whole-task', 'what is the minimum raise', 'rules', 'allowed'],
    ['table-whole-task', 'is calling correct', 'strategy', 'blocked'],
    ['table-ungraded', 'how wide is their range', 'strategy', 'allowed'],
    ['dossier-progress', 'what is my worst tag', 'strategy', 'allowed'],
    // An unparseable question is strategy, so it inherits the strategy verdict.
    ['spot-pre-commit', '???', 'strategy', 'blocked'],
    ['table-ungraded', '???', 'strategy', 'allowed'],
  ];

  for (const [context, question, kind, verdict] of cases) {
    it(`${context} + "${question}" → ${kind}/${verdict}`, () => {
      expect(askVerdict(context, question)).toEqual({ kind, verdict });
    });
  }
});
