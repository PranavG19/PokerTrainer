import { describe, expect, it } from 'vitest';
import {
  WORD_LIMITS,
  allowedNumerals,
  checkTutorOutput,
  type GuardCheck,
} from '../../src/main/tutor/guard.js';
import {
  FIXED_SILENT_NOTICE,
  SILENCE_CONTRACT,
  fixedCorrection,
  fixedQuestion,
  fixedRulesAnswer,
  nullTutor,
} from '../../src/main/tutor/nullTutor.js';
import { buildRulesRequest, buildStrategyRequest } from '../../src/main/tutor/requests.js';
import type {
  ErrorTag,
  GradePayload,
  Tier,
  TutorRequest,
  VisibleTable,
} from '../../src/main/tutor/types.js';

const TABLE: VisibleTable = {
  positions: ['BTN', 'BB'],
  stacksBb: [100, 100],
  potBb: 5,
  board: ['Kh', '7d', '2c'],
  heroCards: ['Ah', 'Qs'],
  toAct: 'BTN',
  street: 'flop',
};

function grade(overrides: Partial<GradePayload> = {}): GradePayload {
  return {
    tier: 'T2',
    deltaEvBb: 0.8,
    errorTag: 'RANGE',
    potBeforeActionBb: 5,
    chosenAction: 'check',
    bestAction: 'bet',
    actionEvsBb: { check: 1.2, bet: 2 },
    equityPct: 61,
    principle: 'Range advantage sets the bet',
    boundaryHand: 'AJo',
    flippingVariable: 'one seat of position',
    classRwBbPer100: 1.9,
    ...overrides,
  };
}

const strategyRequest: TutorRequest = buildStrategyRequest(
  { prompt: 'explain', table: TABLE, grade: grade(), lexicon: [] },
  'correction',
).payload;

const rulesRequest: TutorRequest = buildRulesRequest({
  question: 'what does check mean',
  table: TABLE,
}).payload;

function checks(text: string, kind: 'correction' | 'question' = 'correction'): GuardCheck[] {
  return checkTutorOutput({ text, kind }, strategyRequest).violations.map((v) => v.check);
}

describe('T4 check 1 — word count', () => {
  it('a 60-word correction passes and a 61-word one fails', () => {
    const sixty = Array.from({ length: 60 }, () => 'range').join(' ');
    expect(checkTutorOutput({ text: sixty, kind: 'correction' }, strategyRequest).ok).toBe(true);
    const result = checkTutorOutput(
      { text: `${sixty} range`, kind: 'correction' },
      strategyRequest,
    );
    expect(result.ok).toBe(false);
    expect(result.wordCount).toBe(61);
    expect(result.violations.map((v) => v.check)).toContain('word-count');
  });

  it('a 20-word question passes and a 21-word one fails — the tighter budget applies', () => {
    const twenty = Array.from({ length: 20 }, () => 'range').join(' ');
    expect(checkTutorOutput({ text: twenty, kind: 'question' }, strategyRequest).ok).toBe(true);
    expect(checks(`${twenty} range`, 'question')).toContain('word-count');
    // Same string is fine under the correction budget: the budget is per kind.
    expect(checkTutorOutput({ text: `${twenty} range`, kind: 'correction' }, strategyRequest).ok).toBe(
      true,
    );
  });

  it('degenerate: empty and whitespace-only text count as zero words', () => {
    expect(checkTutorOutput({ text: '', kind: 'question' }, strategyRequest).wordCount).toBe(0);
    expect(checkTutorOutput({ text: '   \n ', kind: 'question' }, strategyRequest).wordCount).toBe(0);
    expect(checkTutorOutput({ text: '', kind: 'question' }, strategyRequest).ok).toBe(true);
  });

  it('WORD_LIMITS matches T4 exactly', () => {
    expect(WORD_LIMITS).toEqual({ correction: 60, question: 20 });
  });
});

describe('T4 check 2 — ban-list lint, adversarial corpus', () => {
  // Second-person trait attribution.
  const traitAttribution = [
    "Betting is right here, but you're folding far too much to this size.",
    'Checking loses value here; you are too passive on wet boards.',
    'The range is capped, and you always check back top pair.',
    'Range advantage decides this; your tendency is to under-bet.',
    'This is a spot where a nit folds and the range should continue.',
    'The board favours the caller, so you tend to over-fold.',
  ];
  for (const text of traitAttribution) {
    it(`flags trait attribution: ${text.slice(0, 44)}...`, () => {
      expect(checks(text)).toContain('ban-list');
    });
  }

  // Praise adjacent to a correction.
  const praise = [
    'Nice read, but the range taking this line is stronger than the calling range.',
    'Good fold, though the price offered made continuing correct.',
    'Well played overall; the sizing here does not match the polarity.',
    'Great instincts — the boundary hand is AJo and the flipping variable is position.',
  ];
  for (const text of praise) {
    it(`flags praise beside a correction: ${text.slice(0, 44)}...`, () => {
      expect(checks(text)).toContain('ban-list');
    });
  }

  // Streak / rank / percentile language is ALLOWED as of 2026-08-14 (product decision) — these must
  // NOT trip the ban-list guard. Each string is otherwise clean of trait/praise/fold-reveal phrasing.
  const rankNowAllowed = [
    'The range is capped. That is three RANGE errors in a row.',
    'The board favours the bettor. The percentile on this tag is falling.',
    'Sizing is off here — this breaks the streak of clean decisions.',
    'The price is wrong. This node now ranks first on the leaderboard of leaks.',
  ];
  for (const text of rankNowAllowed) {
    it(`no longer flags streak/rank language: ${text.slice(0, 44)}...`, () => {
      expect(checks(text)).not.toContain('ban-list');
    });
  }

  // Per-hand fold reveal (G10).
  const foldReveal = [
    'You folded and the board would have brought a straight.',
    'That holding would have flopped a set on the next street.',
    'If you had called, the river would have improved the hand.',
  ];
  for (const text of foldReveal) {
    it(`flags per-hand fold reveal: ${text.slice(0, 44)}...`, () => {
      expect(checks(text)).toContain('ban-list');
    });
  }

  it('permits the same correction rewritten with the task as subject', () => {
    const clean =
      'Range advantage sets the bet. The continuing range here is stronger than the range taking this line. Boundary: AJo; the flipping variable is one seat of position. Next: re-run this node with the variant that toggles that variable.';
    expect(checkTutorOutput({ text: clean, kind: 'correction' }, strategyRequest).ok).toBe(true);
  });

  it('does NOT flag "your range" as a banned construction — T4 relies on that phrase passing', () => {
    // T4's own worked example of a falsehood the guard cannot catch. The ban
    // list must let it through, or that stated limitation is misdescribed.
    // (A *leading* "Your" still trips check 4 — that is check 4's job, not the
    // ban list's, so assert on the ban-list channel specifically.)
    expect(checks('Your range is uncapped here.')).not.toContain('ban-list');
    expect(checks('Betting is fine; your range is uncapped here.')).toEqual([]);
    expect(
      checkTutorOutput({ text: 'The range is uncapped here.', kind: 'correction' }, strategyRequest).ok,
    ).toBe(true);
  });
});

describe('T4 check 3 — number provenance', () => {
  it('permits every numeral that appears in the payload', () => {
    // 5 (pot), 2 (bet EV), 61 (equity), 0.8 (deltaEv), 1.9 (class RW), 100 (stacks).
    const text = 'Pot 5 with 100 behind; the bet line is worth 2 at 61 equity, costing 0.8 here.';
    expect(checkTutorOutput({ text, kind: 'correction' }, strategyRequest).ok).toBe(true);
  });

  it('rejects a numeral absent from the payload', () => {
    const result = checkTutorOutput(
      { text: 'The bet line gains 47 here.', kind: 'correction' },
      strategyRequest,
    );
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([{ check: 'number-provenance', detail: '47' }]);
  });

  it('rejects each absent numeral separately', () => {
    const result = checkTutorOutput(
      { text: 'Range advantage costs 47 and gains 88.', kind: 'correction' },
      strategyRequest,
    );
    expect(result.violations.map((v) => v.detail)).toEqual(['47', '88']);
  });

  it('a comma-grouped numeral reads as its ungrouped form', () => {
    const withThousand = buildStrategyRequest(
      { prompt: 'x', table: TABLE, grade: grade({ classRwBbPer100: 1100 }), lexicon: [] },
      'correction',
    ).payload;
    expect(
      checkTutorOutput({ text: 'The class costs 1,100 per hundred.', kind: 'correction' }, withThousand)
        .ok,
    ).toBe(true);
  });

  it('boundary: a payload numeral embedded in a word still counts as present', () => {
    const withHand = buildStrategyRequest(
      { prompt: 'x', table: TABLE, grade: grade({ boundaryHand: '76s' }), lexicon: [] },
      'correction',
    ).payload;
    expect(checkTutorOutput({ text: 'Boundary: 76s flips it.', kind: 'correction' }, withHand).ok).toBe(
      true,
    );
  });

  it('numeral-free output is vacuously clean', () => {
    expect(checks('Range advantage sets the bet on this texture.')).toEqual([]);
  });

  it('KNOWN GAP: a false RELATIONSHIP among permitted numerals passes (T4 says so)', () => {
    // Payload has pot 5 and bet EV 2; the sentence inverts them and still passes.
    const inverted = 'Risking 5 to win 2 is the price the range faces.';
    expect(checkTutorOutput({ text: inverted, kind: 'correction' }, strategyRequest).ok).toBe(true);
  });

  it('KNOWN GAP: a numeral-free falsehood passes entirely (T4 says so)', () => {
    expect(
      checkTutorOutput({ text: 'The range is uncapped here.', kind: 'correction' }, strategyRequest).ok,
    ).toBe(true);
  });

  it('allowedNumerals covers the rules payload too — which has no engine numbers', () => {
    const allowed = allowedNumerals(rulesRequest);
    // Visible table numbers only: pot 5, stacks 100.
    expect(allowed.has('5')).toBe(true);
    expect(allowed.has('100')).toBe(true);
    // Nothing solver-shaped can be quoted from a rules payload.
    expect(allowed.has('61')).toBe(false);
    expect(allowed.has('0.8')).toBe(false);
    expect(
      checkTutorOutput({ text: 'The bet is worth 0.8.', kind: 'correction' }, rulesRequest).violations,
    ).toEqual([{ check: 'number-provenance', detail: '0.8' }]);
  });

  it('KNOWN GAP: a numeric card rank widens the allowed set, because membership is textual', () => {
    // The board holds 2c and 7d, so "2" and "7" are payload numerals under
    // T4's string-membership rule even though no engine quantity equals them.
    const allowed = allowedNumerals(rulesRequest);
    expect(allowed.has('2')).toBe(true);
    expect(allowed.has('7')).toBe(true);
    expect(checkTutorOutput({ text: 'Bet 7 into 5.', kind: 'correction' }, rulesRequest).ok).toBe(true);
    // A rank not on the board is still caught.
    expect(
      checkTutorOutput({ text: 'Bet 8 into 5.', kind: 'correction' }, rulesRequest).violations,
    ).toEqual([{ check: 'number-provenance', detail: '8' }]);
  });
});

describe('T4 check 4 — no leading second-person pronoun (a proxy, not the full property)', () => {
  for (const opener of ['You', 'you', 'Your', 'Yours', 'Yourself', "You're", '  You']) {
    it(`flags a leading "${opener.trim()}"`, () => {
      expect(checks(`${opener} check here loses value.`)).toContain('leading-pronoun');
    });
  }

  it('does not flag "you" appearing later — the proxy is positional only', () => {
    expect(checks('Checking here costs the range value that betting captures.')).toEqual([]);
    // Mid-sentence "your" is untouched by check 4 and by the ban list.
    expect(checks('Betting captures value your range already holds.')).toEqual([]);
  });

  it('KNOWN GAP: a learner-subject sentence with a non-pronoun subject passes', () => {
    // "The player" is the grammatical subject; the full property is violated and
    // the proxy cannot see it. T4 says the full property is not enforced.
    expect(checks('The player misread this texture completely.')).toEqual([]);
  });
});

describe('the guard reports every violation, not the first', () => {
  it('a maximally bad output trips all four checks at once', () => {
    const filler = Array.from({ length: 60 }, () => 'range').join(' ');
    const text = `You're on a 3 hand streak. Nice work. ${filler}`;
    const result = checkTutorOutput({ text, kind: 'correction' }, strategyRequest);
    expect(result.ok).toBe(false);
    expect(new Set(result.violations.map((v) => v.check))).toEqual(
      new Set<GuardCheck>(['word-count', 'ban-list', 'number-provenance', 'leading-pronoun']),
    );
  });
});

describe('the fixed string table passes its own guard', () => {
  const TIERS: Tier[] = ['T0', 'T1', 'T2', 'T3', 'T4'];
  const TAGS: ErrorTag[] = [
    'RANGE',
    'TEXTURE',
    'PRICE',
    'BLOCKERS',
    'SIZING',
    'DEPTH-POSITION',
    'PURITY',
  ];

  for (const tier of TIERS) {
    for (const tag of TAGS) {
      it(`${tier}/${tag} correction is guard-clean`, () => {
        const g = grade({ tier, errorTag: tag });
        const request = buildStrategyRequest(
          { prompt: 'x', table: TABLE, grade: g, lexicon: [] },
          'correction',
        ).payload;
        const text = fixedCorrection(g);
        if (text === null) {
          // T0/T1 are silent by G1; there is nothing to guard.
          expect(tier === 'T0' || tier === 'T1').toBe(true);
          return;
        }
        const result = checkTutorOutput({ text, kind: 'correction' }, request);
        expect(result.violations, `${tier}/${tag}: ${text}`).toEqual([]);
      });
    }
  }

  it('fixedQuestion fits the 20-word question budget and is guard-clean', () => {
    const result = checkTutorOutput({ text: fixedQuestion(grade()), kind: 'question' }, strategyRequest);
    expect(result.violations).toEqual([]);
    expect(result.wordCount).toBeLessThanOrEqual(WORD_LIMITS.question);
  });

  it('fixedRulesAnswer is guard-clean against the rules payload', () => {
    expect(
      checkTutorOutput({ text: fixedRulesAnswer(), kind: 'correction' }, rulesRequest).violations,
    ).toEqual([]);
  });

  it('the silent notice is guard-clean', () => {
    expect(
      checkTutorOutput({ text: FIXED_SILENT_NOTICE, kind: 'correction' }, strategyRequest).violations,
    ).toEqual([]);
  });

  it('the G3 silence contract is screen copy, and its threshold has no payload source', () => {
    expect(SILENCE_CONTRACT).toContain('Silence is not praise.');
    // The "2%" is a fixed property of the grader, not of any node — so against
    // a payload that happens not to contain a 2 it fails provenance. That is
    // why it is screen copy rather than a guarded tutor output.
    const noTwo = buildStrategyRequest(
      {
        prompt: 'x',
        table: { ...TABLE, potBb: 5, stacksBb: [100, 100], board: ['Kh', 'Td', '9c'] },
        // Tier T4, not T2: the tier label itself is a payload string, so a T2
        // grade would supply the "2" through the back door.
        grade: grade({
          tier: 'T4',
          deltaEvBb: 0.8,
          actionEvsBb: { check: 1.5, bet: 3 },
          classRwBbPer100: 1.9,
          equityPct: 61,
          potBeforeActionBb: 5,
        }),
        lexicon: [],
      },
      'correction',
    ).payload;
    const result = checkTutorOutput({ text: SILENCE_CONTRACT, kind: 'correction' }, noTwo);
    expect(result.violations).toEqual([{ check: 'number-provenance', detail: '2' }]);
  });

  it('every nullTutor response passes the guard for the request that produced it', async () => {
    for (const tier of TIERS) {
      const g = grade({ tier });
      const request = buildStrategyRequest(
        { prompt: 'x', table: TABLE, grade: g, lexicon: ['betting folds out the worse ace'] },
        'correction',
      ).payload;
      const response = await nullTutor.respond(request);
      expect(response.source).toBe('fixed');
      expect(
        checkTutorOutput({ text: response.text, kind: response.kind }, request).violations,
        `${tier}: ${response.text}`,
      ).toEqual([]);
    }
    const rulesResponse = await nullTutor.respond(rulesRequest);
    expect(
      checkTutorOutput({ text: rulesResponse.text, kind: rulesResponse.kind }, rulesRequest).violations,
    ).toEqual([]);
  });
});
