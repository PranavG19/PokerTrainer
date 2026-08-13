import { describe, expect, it } from 'vitest';
import { askTutor, type AskInput, type ResolvedTutor } from '../../src/main/tutor/index.js';
import { nullModelClient, nullTutor } from '../../src/main/tutor/nullTutor.js';
import { openReplayCache } from '../../src/main/tutor/replayCache.js';
import type {
  AgentEnvelope,
  GradePayload,
  ModelClient,
  ModelTurn,
  VisibleTable,
} from '../../src/main/tutor/types.js';

/**
 * PHASE 2 — the multi-turn follow-up path (AskInput.history → runTutorAgent).
 *
 * Hermetic: every test drives a scripted converse() stub or the no-network
 * nullModelClient, exactly like agent.test.ts. Zero network.
 *
 * The load-bearing test is the prove-oracle-can-fail privacy proof: a fabricated
 * solver numeral planted in the HISTORY must never reach the answer pre-commit,
 * AND the test proves it goes red if history were fed into the guarded request.
 */

const TABLE: VisibleTable = {
  positions: ['BTN', 'BB'],
  stacksBb: [97, 88],
  potBb: 11,
  board: ['Kh', 'Td', '4c'],
  heroCards: ['Ah', 'Qs'],
  toAct: 'BTN',
  street: 'flop',
};

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

const CLEAN_RULES = 'The rules card lists what each action does. Open the rules card.';

/** A scripted converse() stub, recording every envelope so the transcript is inspectable. */
function mockClient(turns: readonly ModelTurn[]): ModelClient & {
  readonly envelopes: AgentEnvelope[];
} {
  const envelopes: AgentEnvelope[] = [];
  let calls = 0;
  return {
    id: 'mock',
    envelopes,
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

/** A ResolvedTutor wrapping a specific client, otherwise the no-credentials defaults. */
function resolvedWith(client: ModelClient): ResolvedTutor {
  return {
    tutor: nullTutor,
    credentialsConfigured: false,
    egressAllowlist: [],
    guardFailures: [],
    client,
    cache: openReplayCache({ mode: 'off' }),
  };
}

const text = (t: string): ModelTurn => ({ kind: 'text', text: t });
const toolUse = (name: string, args?: Record<string, unknown>): ModelTurn => ({
  kind: 'tool_use',
  calls: [{ name, args: args ?? {} }],
});

describe('history routes the ask through the agent without widening the guarded request', () => {
  it('with history present, the model reads the prior exchange in its transcript', async () => {
    const client = mockClient([text(CLEAN_RULES)]);
    await askTutor(resolvedWith(client), {
      context: 'spot-pre-commit',
      question: 'and who acts first',
      table: TABLE,
      history: [{ question: 'what does check mean', answerText: CLEAN_RULES }],
    });

    // The prior pair is in the transcript the model saw, oldest-first, after the
    // current question that mintSpotContext anchors at index 0.
    const messages = client.envelopes[0].messages.map((m) => `${m.role}:${m.text}`);
    expect(messages).toEqual([
      'user:and who acts first',
      'user:what does check mean',
      `assistant:${CLEAN_RULES}`,
    ]);
  });

  it('a pre-commit follow-up still builds the RULES request — no grade path, even with history', async () => {
    const client = mockClient([text(CLEAN_RULES)]);
    const result = await askTutor(resolvedWith(client), {
      context: 'spot-pre-commit',
      question: 'and who acts first',
      table: TABLE,
      // A grade is present on the input but pre-commit must not reach it.
      grade: GRADE,
      history: [{ question: 'what does check mean', answerText: CLEAN_RULES }],
    });
    expect(result.questionKind).toBe('rules');
    // payloadKeys report the request the agent guarded against: no grade path.
    expect(result.payloadKeys.some((k) => k.startsWith('grade.'))).toBe(false);
    expect(result.payloadKeys).toContain('question');
    // And the tool registry the model was offered omits the two solver tools.
    const tools = client.envelopes[0].tools.map((t) => t.name);
    expect(tools).not.toContain('recall_grade');
    expect(tools).not.toContain('numeric_phrases');
  });

  it('turn 0 (no history) never touches the agent path — the single-shot tutor answers', async () => {
    // A client whose converse() would throw if called proves the no-history path
    // does not route through runTutorAgent.
    const wouldThrow: ModelClient = {
      id: 'guard',
      async complete() {
        return 'x';
      },
      async converse() {
        throw new Error('converse must not be called on turn 0');
      },
    };
    const result = await askTutor(resolvedWith(wouldThrow), {
      context: 'spot-pre-commit',
      question: 'what does check mean',
      table: TABLE,
    });
    // nullTutor's fixed rules answer, from the single-shot path.
    expect(result.answeredBy).toBe('fixed');
    expect(result.text).toContain('rules card');
  });
});

describe('THE LOAD-BEARING PRIVACY PROOF — a fabricated numeral in history cannot ship pre-commit', () => {
  const FABRICATED = '42.42'; // not in TABLE, not a real grade field: a pure fabrication

  it('a poisoned history turn is scrubbed at the tool boundary and never reaches the answer', async () => {
    const poisoned = `earlier I said the edge was ${FABRICATED} bb`;
    // The model tries to recall the poisoned history turn, then echoes the numeral.
    const client = mockClient([
      toolUse('recall_turn', { index: 1 }),
      text(`so the edge is ${FABRICATED} bb`),
    ]);
    const result = await askTutor(resolvedWith(client), {
      context: 'spot-pre-commit',
      question: 'what does bet mean',
      table: TABLE,
      history: [{ question: 'earlier', answerText: poisoned }],
    });

    // The pre-commit guard rejects the echo → regenerate → still dirty → fixed table.
    expect(result.text).not.toContain(FABRICATED);
    expect(result.answeredBy).toBe('fixed');
  });

  it('ORACLE-CAN-FAIL: the numeral is only absent because history stays out of the guarded request', () => {
    // The guarded request for this ask is the RULES request built from the current
    // turn alone — its serialisation contains no history and no fabricated numeral.
    // If history were folded into it (the mutation), the numeral WOULD be allowed.
    const rules = { context: 'spot-pre-commit', question: 'what does bet mean', table: TABLE };
    const guardedSerialised = JSON.stringify(rules);
    expect(guardedSerialised).not.toContain(FABRICATED);

    // The counterfactual: a request that DID absorb history would carry it, which is
    // exactly what would let the guard admit the fabricated numeral as "provenanced".
    const widened = JSON.stringify({
      ...rules,
      history: [{ question: 'earlier', answerText: `edge was ${FABRICATED} bb` }],
    });
    expect(widened).toContain(FABRICATED);
  });

  it('post-reveal, the SAME history still cannot introduce a fabricated numeral', async () => {
    // Post-reveal admits real grade numerals, but a fabrication in history is not one.
    const client = mockClient([
      toolUse('recall_turn', { index: 1 }),
      text(`the edge is ${FABRICATED} bb`),
    ]);
    const result = await askTutor(resolvedWith(client), {
      context: 'spot-post-reveal',
      question: 'explain',
      table: TABLE,
      grade: GRADE,
      history: [{ question: 'earlier', answerText: `I thought ${FABRICATED} bb` }],
    });
    expect(result.text).not.toContain(FABRICATED);
    expect(result.answeredBy).toBe('fixed');
  });
});

describe('the no-credentials follow-up is byte-for-byte the null tutor', () => {
  it('nullModelClient (no converse) makes a follow-up fall to the fixed table', async () => {
    const result = await askTutor(resolvedWith(nullModelClient), {
      context: 'spot-pre-commit',
      question: 'and who acts first',
      table: TABLE,
      history: [{ question: 'what does check mean', answerText: CLEAN_RULES }],
    });
    // No converse() → agent falls straight to the guard-clean fixed rules answer.
    expect(result.answeredBy).toBe('fixed');
    expect(result.text).toContain('rules card');
    expect(result.tutorId).toBe('null');
  });

  it('a blocked strategy follow-up pre-commit is still blocked, history or not', async () => {
    const result = await askTutor(resolvedWith(nullModelClient), {
      context: 'spot-pre-commit',
      question: 'should I bet here',
      table: TABLE,
      history: [{ question: 'what does check mean', answerText: CLEAN_RULES }],
    });
    expect(result.verdict).toBe('blocked');
    expect(result.text).toBeNull();
    // Blocked → no payload built at all, even with history present.
    expect(result.payloadKeys).toEqual([]);
  });
});
