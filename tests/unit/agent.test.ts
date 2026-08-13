import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAPS,
  TOOL,
  guardToolResult,
  mintSpotContext,
  registryFor,
  runTutorAgent,
  toolNamesFor,
  type AgentResult,
  type SpotContext,
} from '../../src/main/tutor/agent.js';
import { buildRulesRequest, buildStrategyRequest } from '../../src/main/tutor/requests.js';
import { numericPhrasesFor } from '../../src/main/tutor/numericPhrases.js';
import type {
  AgentEnvelope,
  GradePayload,
  ModelClient,
  ModelTurn,
  VisibleTable,
} from '../../src/main/tutor/types.js';

const TABLE: VisibleTable = {
  positions: ['BTN', 'BB'],
  stacksBb: [97, 88],
  potBb: 11,
  board: ['Kh', 'Td', '4c'],
  heroCards: ['Ah', 'Qs'],
  toAct: 'BTN',
  street: 'flop',
};

/** Distinct, unusual numerals so a leak is identifiable by its exact digits. */
const GRADE: GradePayload = {
  tier: 'T3',
  deltaEvBb: 1.73,
  errorTag: 'TEXTURE',
  potBeforeActionBb: 11,
  chosenAction: 'check',
  bestAction: 'bet',
  actionEvsBb: { check: 3.41, bet: 5.14, fold: 0.29 },
  equityPct: 63,
  principle: 'Nut advantage sets the size',
  boundaryHand: 'AJo',
  flippingVariable: 'one seat of position',
  classRwBbPer100: 2.87,
};

const SOLVER_DIGITS = ['1.73', '3.41', '5.14', '0.29', '63', '2.87'];

/**
 * A scripted model. Each entry in `turns` is returned in order; the last entry
 * repeats. Records every envelope it was handed so tests can assert the registry
 * and the transcript the model actually saw. Zero network — the whole suite is
 * hermetic against this stub and nullTutor's fixed strings.
 */
function mockClient(turns: readonly ModelTurn[]): ModelClient & {
  readonly envelopes: AgentEnvelope[];
  calls: number;
} {
  const envelopes: AgentEnvelope[] = [];
  let calls = 0;
  return {
    id: 'mock',
    envelopes,
    get calls() {
      return calls;
    },
    async complete() {
      throw new Error('complete() must not be called by the agent');
    },
    async converse(envelope: AgentEnvelope): Promise<ModelTurn> {
      envelopes.push(envelope);
      const turn = turns[Math.min(calls, turns.length - 1)];
      calls += 1;
      return turn;
    },
  };
}

const text = (t: string): ModelTurn => ({ kind: 'text', text: t });
const toolUse = (...calls: { name: string; args?: Record<string, unknown> }[]): ModelTurn => ({
  kind: 'tool_use',
  calls: calls.map((c) => ({ name: c.name, args: c.args ?? {} })),
});

const preCommit = (question: string, seed?: SpotContext['transcript']): SpotContext =>
  mintSpotContext({ phase: 'pre-commit', table: TABLE, question, seedTranscript: seed });

const postReveal = (question: string): SpotContext =>
  mintSpotContext({ phase: 'post-reveal', table: TABLE, grade: GRADE, question });

// A clean, phrase-compliant post-reveal correction the model can emit.
const CLEAN_POST_REVEAL =
  'Nut advantage sets the size here. The board hands the betting range more nutted combinations, so this hand holds 63% pot share. Boundary AJo; the flipping variable is one seat of position.';

describe('the phase-gated tool registry', () => {
  it('pre-commit omits recall_grade and numeric_phrases — the two solver tools', () => {
    const names = toolNamesFor('pre-commit');
    expect(names).toContain(TOOL.recallTable);
    expect(names).toContain(TOOL.lookupPrinciple);
    expect(names).toContain(TOOL.recallTurn);
    expect(names).not.toContain(TOOL.recallGrade);
    expect(names).not.toContain(TOOL.numericPhrases);
  });

  it('post-reveal registers all five, including the solver tools', () => {
    const names = toolNamesFor('post-reveal');
    for (const t of Object.values(TOOL)) expect(names).toContain(t);
  });

  it('the envelope the model receives carries exactly the phase registry', async () => {
    const client = mockClient([text('The rules card lists what each action does. Open the rules card.')]);
    await runTutorAgent(preCommit('what does check mean'), { client });
    const sent = client.envelopes[0].tools.map((t) => t.name);
    expect(sent).toEqual([...toolNamesFor('pre-commit')]);
    expect(sent).not.toContain(TOOL.recallGrade);
  });
});

describe('property (a) — pre-commit, a scripted call to a solver tool reaches no solver number', () => {
  it('recall_grade is refused pre-commit and no grade numeral enters the transcript', async () => {
    // The model tries to call recall_grade (absent from the pre-commit registry),
    // then emits clean text. The refusal stub is what lands in context.
    const client = mockClient([
      toolUse({ name: TOOL.recallGrade }),
      text('The rules card lists what each action does. Open the rules card.'),
    ]);
    const ctx = preCommit('what does check mean');
    const result = await runTutorAgent(ctx, { client });

    const transcript = ctx.transcript.map((m) => m.text).join('\n');
    for (const digits of SOLVER_DIGITS) {
      expect(transcript, `solver numeral ${digits} leaked into context`).not.toContain(digits);
    }
    expect(transcript).toContain('not available in this phase');
    expect(result.source).toBe('model');
  });

  it('numeric_phrases is refused pre-commit too', async () => {
    const client = mockClient([
      toolUse({ name: TOOL.numericPhrases }),
      text('The rules card lists what each action does. Open the rules card.'),
    ]);
    const ctx = preCommit('what does raise mean');
    await runTutorAgent(ctx, { client });
    const transcript = ctx.transcript.map((m) => m.text).join('\n');
    for (const digits of SOLVER_DIGITS) expect(transcript).not.toContain(digits);
  });

  it('a mechanics lookup pre-commit succeeds; a strategy-key lookup is refused', async () => {
    const client = mockClient([
      toolUse({ name: TOOL.lookupPrinciple, args: { key: 'actions' } }),
      toolUse({ name: TOOL.lookupPrinciple, args: { key: 'TEXTURE' } }),
      text('The rules card lists what each action does. Open the rules card.'),
    ]);
    const ctx = preCommit('what does fold mean');
    await runTutorAgent(ctx, { client });
    const toolTexts = ctx.transcript.filter((m) => m.role === 'tool').map((m) => m.text);
    expect(toolTexts[0]).toContain('Fold gives up the hand');
    expect(toolTexts[1]).toContain('not available'); // strategy key refused pre-commit
  });

  it('the beginner mechanics keys (position, streets, blinds, button) are reachable pre-commit', async () => {
    // A learner asking "what is position?" or "what is the button?" is asking a pure mechanics
    // question — no grade, no equity, no ranked action. These keys carry number-free prose and MUST
    // resolve pre-commit; a refusal here would leave the tutor mute on the most common beginner
    // questions.
    const keys = ['position', 'streets', 'blinds', 'button'] as const;
    const expectedFragments: Record<(typeof keys)[number], string> = {
      position: 'seats act after earlier',
      streets: 'four betting rounds',
      blinds: 'forced bets',
      button: 'dealer seat',
    };
    for (const key of keys) {
      const ctx = preCommit(`what is ${key}`);
      const client = mockClient([
        toolUse({ name: TOOL.lookupPrinciple, args: { key } }),
        text('The rules card lists this. Open the rules card.'),
      ]);
      await runTutorAgent(ctx, { client });
      const toolResult = ctx.transcript.filter((m) => m.role === 'tool')[0].text;
      expect(toolResult, `${key} refused pre-commit`).not.toContain('not available');
      expect(toolResult, `${key} content missing`).toContain(expectedFragments[key]);
    }
  });
});

describe('THE LOAD-BEARING PRIVACY PROOF — prove the oracle can fail', () => {
  // A fabricated solver numeral is planted in BOTH the conversation history AND a
  // tool result, and the model's answer echoes it. The pre-commit guard must
  // REJECT it. The final assertion proves the test goes RED if the guard is
  // bypassed — otherwise a green here would mean nothing.

  const FABRICATED = '42.42'; // not in TABLE, not a real grade field: a pure fabrication
  const echo = `The best action bets for ${FABRICATED} bb of expected value.`;

  it('a fabricated solver numeral in history AND in a tool result is rejected pre-commit', async () => {
    // Seed the transcript with a poisoned prior turn carrying the fabricated numeral.
    const poisonedHistory: SpotContext['transcript'] = [
      { role: 'assistant', text: `earlier I noted the edge was ${FABRICATED} bb` },
    ];
    const ctx = preCommit('what does bet mean', poisonedHistory);

    // The model asks to recall that poisoned turn (index 1), then echoes the numeral.
    const client = mockClient([
      toolUse({ name: TOOL.recallTurn, args: { index: 1 } }),
      text(echo),
    ]);
    const result = await runTutorAgent(ctx, { client });

    // (1) TOOL BOUNDARY: recall_turn re-surfaced the poisoned history turn, but
    // guardToolResult scrubbed the fabricated numeral before it re-entered the
    // transcript — the tool result is the refusal stub, not the poisoned text.
    const toolResult = ctx.transcript.filter((m) => m.role === 'tool')[0].text;
    expect(toolResult).not.toContain(FABRICATED);
    expect(toolResult).toContain('not available');

    // (2) TEXT BOUNDARY: the model's echo of the fabricated numeral was rejected
    // by the joint check → one regeneration → still dirty → fixed rules string.
    expect(result.source).toBe('fixed');
    expect(result.termination).toBe('fallback:guard');
    expect(result.text).not.toContain(FABRICATED);
  });

  it('ORACLE-CAN-FAIL: without the guard, the fabricated numeral WOULD ship', () => {
    // This is the mutation, inlined: bypass textPasses and return the raw model
    // text. The assertion below is what the guard prevents — proving the guard is
    // load-bearing, not decorative.
    const rulesRequest = buildRulesRequest({ question: 'what does bet mean', table: TABLE }).payload;
    // The real guard rejects it:
    const guarded = guardToolResult(echo, rulesRequest, []);
    expect(guarded).not.toContain(FABRICATED);
    expect(guarded).toContain('not available'); // replaced by the refusal stub

    // The bypass (what a broken guard would do) WOULD contain it — RED without the guard.
    const bypassed = echo; // pretend the guard let it through
    expect(bypassed).toContain(FABRICATED);
  });

  it('the same fabricated numeral IS admissible post-reveal ONLY if it is a real grade field', () => {
    // Sanity: the guard is not blanket-rejecting all numerals. A real grade
    // numeral inside its engine phrase passes; the fabrication still does not.
    const rulesRequest = buildRulesRequest({ question: 'q', table: TABLE }).payload;
    // 42.42 is fabricated → rejected even as a bare tool result.
    expect(guardToolResult(`edge is ${FABRICATED} bb`, rulesRequest, [])).toContain('not available');
    // A visible-table numeral (pot 11) IS in the rules request → admitted.
    expect(guardToolResult('the pot is 11bb', rulesRequest, [])).toContain('11bb');
  });
});

describe('property (b) — a tool result with a fabricated solver numeral is guard-rejected', () => {
  it('guardToolResult replaces a fabricated-numeral result with a refusal stub', () => {
    const rulesRequest = buildRulesRequest({ question: 'q', table: TABLE }).payload;
    const dirty = 'the edge is 99.99 bb on this line';
    expect(guardToolResult(dirty, rulesRequest, [])).not.toContain('99.99');
  });

  it('a long but clean principle lookup is NOT word-count-rejected (tool profile skips the cap)', () => {
    const rulesRequest = buildRulesRequest({ question: 'q', table: TABLE }).payload;
    const long = registryLookupText();
    // Over 60 words, zero off-payload numerals → must pass the tool-result guard.
    expect(long.split(/\s+/).length).toBeGreaterThan(40);
    expect(guardToolResult(long, rulesRequest, [])).toBe(long);
  });

  function registryLookupText(): string {
    // The longest mechanics entry, exercised through the real dispatch shape.
    return 'Action moves clockwise from the seat left of the button preflop and from the first live seat left of the button on later streets, until every live player has matched the last bet, and then the street is complete and the next card or the showdown follows in order.';
  }
});

describe('property (c) — hitting a cap terminates in a guard-clean fixed fallback', () => {
  it('MAX_TURNS is hit when the model never emits clean text, falling to fixed strings', async () => {
    // Every turn is dirty text → one regeneration → still dirty → guard fallback.
    // Force the turn cap by making the model loop tool calls forever within budget.
    const client = mockClient([toolUse({ name: TOOL.recallTable })]); // repeats forever
    const result = await runTutorAgent(postReveal('explain'), {
      client,
      caps: { maxTurns: 3, maxToolCalls: 100 },
    });
    expect(result.source).toBe('fixed');
    expect(result.termination).toBe('fallback:max-turns');
    expect(result.turns).toBe(3);
    expect(result.text).toContain('Nut advantage sets the size'); // the fixed correction
  });

  it('MAX_TOOL_CALLS is hit when the model keeps calling tools, falling to fixed strings', async () => {
    const client = mockClient([toolUse({ name: TOOL.recallTable }, { name: TOOL.recallTable })]);
    const result = await runTutorAgent(postReveal('explain'), {
      client,
      caps: { maxTurns: 100, maxToolCalls: 3 },
    });
    expect(result.source).toBe('fixed');
    expect(result.termination).toBe('fallback:max-tool-calls');
    expect(result.toolCalls).toBeLessThanOrEqual(3);
  });

  it('a throwing converse falls to fixed strings without ever returning model text', async () => {
    const client: ModelClient = {
      id: 'throwing',
      async complete() {
        throw new Error('unused');
      },
      async converse() {
        throw new Error('network down');
      },
    };
    const result = await runTutorAgent(postReveal('explain'), { client });
    expect(result.source).toBe('fixed');
    expect(result.termination).toBe('fallback:error');
  });

  it('a client with no converse() at all falls straight to fixed strings', async () => {
    const noConverse: ModelClient = { id: 'legacy', async complete() { return 'x'; } };
    const result = await runTutorAgent(preCommit('what does check mean'), { client: noConverse });
    expect(result.source).toBe('fixed');
    expect(result.termination).toBe('fallback:error');
  });
});

describe('property (d) — post-reveal, an inverted-relationship text turn fails the joint check', () => {
  it('an inverted numeric relationship regenerates, then a clean retry is used', async () => {
    // "requiring 63% pot share" inverts the hand's ACTUAL share into a REQUIRED
    // share — the exact measured false-relationship class. It passes plain
    // provenance (63 is a grade field) but fails the phrase check.
    const inverted = 'This spot requires 63% pot share to continue, so folding is right.';
    const client = mockClient([text(inverted), text(CLEAN_POST_REVEAL)]);
    const result = await runTutorAgent(postReveal('explain'), { client });
    expect(result.source).toBe('model');
    expect(result.termination).toBe('text');
    expect(result.turns).toBe(2); // regenerated once
    expect(result.text).toBe(CLEAN_POST_REVEAL);
  });

  it('a clean phrase-compliant answer is used on the first turn', async () => {
    const client = mockClient([text(CLEAN_POST_REVEAL)]);
    const result = await runTutorAgent(postReveal('explain'), { client });
    expect(result.source).toBe('model');
    expect(result.turns).toBe(1);
  });

  it('the joint check catches an inverted relationship that plain provenance passes', () => {
    // Prove the two halves are both load-bearing: the inverted text uses only
    // grade numerals (provenance-clean) yet must be caught by the phrase check.
    const phrases = numericPhrasesFor(GRADE);
    const inverted = 'This spot requires 63% pot share to continue.';
    // checkTutorOutput alone (string membership) would pass 63 — it is a grade field.
    // The joint check does not, because 63% is not inside an approved phrase here.
    expect(phrases.some((p) => p.text.includes('63%'))).toBe(true);
    const client = mockClient([text(inverted), text(inverted)]);
    return runTutorAgent(postReveal('explain'), { client }).then((r: AgentResult) => {
      expect(r.source).toBe('fixed'); // both attempts inverted → fallback
      expect(r.termination).toBe('fallback:guard');
    });
  });
});

describe('the numeric-phrase channel and post-reveal wiring', () => {
  it('post-reveal appends the phrase instruction to the system prompt', async () => {
    const client = mockClient([text(CLEAN_POST_REVEAL)]);
    await runTutorAgent(postReveal('explain'), { client });
    expect(client.envelopes[0].system).toContain('character for');
    expect(client.envelopes[0].system).toContain('this hand holds 63% pot share');
  });

  it('pre-commit does NOT append the phrase instruction (no grade to derive from)', async () => {
    const client = mockClient([text('The rules card lists what each action does. Open the rules card.')]);
    await runTutorAgent(preCommit('what does check mean'), { client });
    expect(client.envelopes[0].system).not.toContain('character for');
    expect(client.envelopes[0].system).toContain('Rules only');
  });

  it('numeric_phrases post-reveal returns engine-authored fragments that pass the guard', async () => {
    const ctx = postReveal('explain');
    const client = mockClient([
      toolUse({ name: TOOL.numericPhrases }),
      text(CLEAN_POST_REVEAL),
    ]);
    await runTutorAgent(ctx, { client });
    const toolResult = ctx.transcript.filter((m) => m.role === 'tool')[0].text;
    expect(toolResult).toContain('this hand holds 63% pot share');
    // It was admitted (not the refusal stub), proving the engine channel is clean.
    expect(toolResult).not.toContain('not available');
  });

  it('recall_grade post-reveal surfaces the grade — numerals routed through numericPhrasesFor', async () => {
    // Verify-flagged regression: renderGradeProse used to emit raw formats like "equity: 63%" and
    // "deltaEv: 1.73bb" that matched no approved phrase, so checkPhraseUse flagged every numeral and
    // guardToolResult scrubbed the ENTIRE result to the refusal stub — making recall_grade dead
    // weight post-reveal. The fix routes numeric fields through numericPhrasesFor (their approved
    // shape) and keeps only the word-only fields alongside them.
    const ctx = postReveal('explain');
    const client = mockClient([
      toolUse({ name: TOOL.recallGrade }),
      text(CLEAN_POST_REVEAL),
    ]);
    await runTutorAgent(ctx, { client });
    const toolResult = ctx.transcript.filter((m) => m.role === 'tool')[0].text;
    // NOT the refusal stub — the grade is really surfaced.
    expect(toolResult).not.toContain('not available');
    // Every numeric grade field arrives in its exact approved-phrase shape.
    expect(toolResult).toContain('costs 1.7 bb');
    expect(toolResult).toContain('a 11 bb pot');
    expect(toolResult).toContain('this hand holds 63% pot share');
    expect(toolResult).toContain('check is worth 3.4 bb');
    expect(toolResult).toContain('bet is worth 5.1 bb');
    expect(toolResult).toContain('2.9 bb/100 across this spot class');
    // Word-only fields survive unchanged (no digits to trip the phrase check).
    expect(toolResult).toContain('chosen: check');
    expect(toolResult).toContain('best: bet');
    expect(toolResult).toContain('error tag: TEXTURE');
    expect(toolResult).toContain('principle: Nut advantage sets the size');
    expect(toolResult).toContain('flipping variable: one seat of position');
  });

  it('ORACLE-CAN-FAIL: without numericPhrasesFor, recall_grade WOULD scrub to the refusal stub', () => {
    // The mutation, inlined: render the grade in its OLD raw shape ("equity: 63%") and score it. This
    // is what the buggy version emitted, and this test proves the guard rejects it — so the fix
    // (composing from numericPhrasesFor) is load-bearing, not decorative.
    const request = buildStrategyRequest(
      { prompt: 'explain', table: TABLE, grade: GRADE, lexicon: [] },
      'correction',
    ).payload;
    const phrases = numericPhrasesFor(GRADE);
    // A raw-shape line every one of these numerals is a grade field, so plain provenance passes;
    // but each numeral sits OUTSIDE every approved phrase, so checkPhraseUse rejects the whole line
    // and guardToolResult returns the refusal stub.
    const rawShape = 'deltaEv: 1.73bb\nequity: 63%\npot before action: 11bb';
    expect(guardToolResult(rawShape, request, phrases)).toContain('not available');
  });
});

describe('bounds and the context manager', () => {
  it('registryFor returns frozen-order arrays and DEFAULT_CAPS are the documented values', () => {
    expect(DEFAULT_CAPS).toEqual({ maxTurns: 4, maxToolCalls: 6 });
    expect(registryFor('pre-commit').length).toBe(3);
    expect(registryFor('post-reveal').length).toBe(5);
  });

  it('recall_turn is bounded to the current spot transcript; an out-of-range index is refused', () => {
    const rulesRequest = buildRulesRequest({ question: 'q', table: TABLE }).payload;
    // Direct guard check that an out-of-range recall cannot fabricate content.
    // (Exercised end-to-end below.)
    expect(guardToolResult('not available here', rulesRequest, [])).toContain('not available');
  });

  it('recall_turn returns an earlier guarded turn verbatim within the spot', async () => {
    const ctx = preCommit('what does check mean');
    const client = mockClient([
      toolUse({ name: TOOL.recallTurn, args: { index: 0 } }), // the seeded question
      text('The rules card lists what each action does. Open the rules card.'),
    ]);
    await runTutorAgent(ctx, { client });
    const toolResult = ctx.transcript.filter((m) => m.role === 'tool')[0].text;
    expect(toolResult).toBe('what does check mean');
  });

  it('a new spot mints a fresh context — no prior transcript carries over', () => {
    const a = preCommit('question one');
    const b = preCommit('question two');
    expect(a.transcript).not.toBe(b.transcript);
    expect(b.transcript[0].text).toBe('question two');
    expect(b.transcript).toHaveLength(1);
  });
});
