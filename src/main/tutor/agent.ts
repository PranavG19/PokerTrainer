/**
 * PHASE 1 — the tool-using tutor agent, hermetic.
 *
 * A deterministic TypeScript orchestrator drives a capped tool-dispatch loop
 * against a ModelClient.converse() seam. The loop lives here, in code, NOT in
 * the model, so the two privacy invariants are enforced by the orchestrator and
 * cannot be talked out of it:
 *
 *   1. STRUCTURAL PHASE GATE — pre-commit, the tool registry sent to the model
 *      omits recall_grade and numeric_phrases entirely. A tool absent from the
 *      registry cannot be dispatched: `dispatchTool` refuses any name not in the
 *      phase's registry, and no solver number reaches context. This mirrors
 *      requestFor()'s grade-presence routing — the same signal, one level up.
 *
 *   2. EVERY BOUNDARY IS GUARDED — the phase request is built ONCE
 *      (pre-commit => RulesRequest, whose allowedNumerals is solver-free) and is
 *      fixed for the whole conversation. Every tool result runs guardToolResult
 *      before it enters the transcript; every model TEXT turn runs the same
 *      checkTutorOutput liveTutor uses today, plus (post-reveal) the phrase
 *      joint-truth check. The union of numerals ever admitted therefore cannot
 *      grow past what the fixed request allows — no tool can widen it.
 *
 * Termination is guaranteed three ways: a text turn that passes the guard, or
 * either hard cap (MAX_TURNS completions / MAX_TOOL_CALLS tool executions), or a
 * throwing/timing-out converse — every non-clean exit falls to the fixed string
 * table (nullTutor), which is guard-clean by construction. The loop ALWAYS
 * terminates with a guard-clean response.
 *
 * P1 is hermetic: driven by a scripted MockModelClient, ZERO network. bedrock.ts
 * implements converse() as of this commit; the OFFSUIT_LIVE_E2E round-trip
 * exercises that impl against the real network in a later phase.
 */

import { LESSONS } from '../../core/lessons/index.js';
import { checkTutorOutput, type GuardViolation } from './guard.js';
import {
  checkPhraseUse,
  numericPhrasesFor,
  phraseInstruction,
  type NumericPhrase,
} from './numericPhrases.js';
import { fixedResponse } from './nullTutor.js';
import { buildRulesRequest, buildStrategyRequest } from './requests.js';
import type {
  AgentEnvelope,
  AgentMessage,
  GradePayload,
  ModelClient,
  ToolCall,
  ToolSpec,
  TutorRequest,
  TutorResponse,
  VisibleTable,
} from './types.js';

export type SpotPhase = 'pre-commit' | 'post-reveal';

/**
 * The per-spot context: an IMMUTABLE anchor plus a bounded transcript. Minted by
 * the orchestrator when a spot is entered and discarded when the anchor changes
 * (new hand/street/phase => new context). Tools read EXCLUSIVELY from this
 * object, so a tool cannot reach a solver number that is not in the anchor.
 *
 * The anchor is bounded three ways: single-spot scope, the transcript turn cap,
 * and the type of the anchor itself — a pre-commit anchor has no `grade` field
 * to read, the same absence requestFor() keys on.
 */
export interface SpotContext {
  readonly phase: SpotPhase;
  readonly table: VisibleTable;
  /** Present only post-reveal. Its absence is the structural pre-commit guarantee. */
  readonly grade?: GradePayload;
  readonly lexicon: readonly string[];
  readonly question: string;
  /** A bounded ring of guard-passed turns. The single source of truth for recall_turn. */
  readonly transcript: AgentMessage[];
}

export interface AgentCaps {
  /** Model completions across the whole conversation. */
  readonly maxTurns: number;
  /** Tool executions across the whole conversation. */
  readonly maxToolCalls: number;
}

export const DEFAULT_CAPS: AgentCaps = { maxTurns: 4, maxToolCalls: 6 };

/** Transcript memory bound. Tied to the caps: a run can append at most maxTurns + maxToolCalls turns. */
const transcriptCap = (caps: AgentCaps): number => caps.maxTurns + caps.maxToolCalls + 1;

export interface AgentDeps {
  /** Must implement converse(). The mock supplies it hermetically; bedrock.ts will later. */
  readonly client: ModelClient;
  readonly caps?: Partial<AgentCaps>;
}

/** How the loop ended, for diagnostics and tests. */
export type Termination =
  | 'text'
  | 'fallback:max-turns'
  | 'fallback:max-tool-calls'
  | 'fallback:error'
  | 'fallback:guard';

export interface AgentResult extends TutorResponse {
  readonly termination: Termination;
  readonly turns: number;
  readonly toolCalls: number;
}

/** Freeze the anchor and seed the transcript with the learner's question. */
export function mintSpotContext(anchor: {
  readonly phase: SpotPhase;
  readonly table: VisibleTable;
  readonly grade?: GradePayload;
  readonly lexicon?: readonly string[];
  readonly question: string;
  /** Prior turns to seed with. Used by tests to simulate a poisoned history. */
  readonly seedTranscript?: readonly AgentMessage[];
}): SpotContext {
  const seed = anchor.seedTranscript ?? [];
  return {
    phase: anchor.phase,
    table: anchor.table,
    grade: anchor.grade,
    lexicon: anchor.lexicon ?? [],
    question: anchor.question,
    transcript: [{ role: 'user', text: anchor.question }, ...seed],
  };
}

// ── Tool registry ──────────────────────────────────────────────────────────

export const TOOL = {
  recallTable: 'recall_table',
  recallGrade: 'recall_grade',
  numericPhrases: 'numeric_phrases',
  lookupPrinciple: 'lookup_principle',
  recallTurn: 'recall_turn',
} as const;

const RECALL_TABLE: ToolSpec = {
  name: TOOL.recallTable,
  description: 'The visible table as prose: street, board, hero cards, pot, positions, stacks, to-act.',
};
const RECALL_GRADE: ToolSpec = {
  name: TOOL.recallGrade,
  description: 'The engine grade as prose: tier, EVs, best action, equity, principle, boundary, flipping variable.',
};
const NUMERIC_PHRASES: ToolSpec = {
  name: TOOL.numericPhrases,
  description: 'Engine-authored numeric phrases you may quote verbatim. The only sanctioned source of numbers.',
};
const RECALL_TURN: ToolSpec = {
  name: TOOL.recallTurn,
  description: 'The text of an earlier turn in this spot. Pass { index }.',
};

/**
 * The keys reachable in each phase. Pre-commit sees mechanics-only; post-reveal sees all. Derived
 * at module load, deterministic, and enumerated in the tool description so the model does not have
 * to guess valid keys. New lessons added to src/core/lessons appear here automatically via
 * LESSON_PRINCIPLES; the drift-guard test enforces that path.
 */
function principleKeysFor(phase: SpotPhase): readonly string[] {
  return Object.entries(PRINCIPLES)
    .filter(([, entry]) => phase === 'post-reveal' || entry.mechanics)
    .map(([key]) => key)
    .sort();
}

/**
 * Build the LOOKUP_PRINCIPLE ToolSpec for a given phase, enumerating the valid keys inline. Kept
 * as a function (not a module-level const) to defer the PRINCIPLES read past its declaration —
 * PRINCIPLES is initialised later in this module.
 */
function lookupPrincipleSpec(phase: SpotPhase): ToolSpec {
  const keys = principleKeysFor(phase).join(', ');
  const scope = phase === 'pre-commit' ? 'Mechanics keys only pre-commit. ' : '';
  return {
    name: TOOL.lookupPrinciple,
    description: `Fixed lesson text for a principle key. Pass { key }. ${scope}Valid keys: ${keys}.`,
  };
}

/**
 * THE PHASE GATE. Pre-commit omits recall_grade and numeric_phrases — the two
 * solver tools — so the model literally cannot emit a tool_use for them. Adding
 * a solver tool pre-commit requires editing this function, not forgetting a
 * check, which is the T3a/T8 structural guarantee.
 */
export function registryFor(phase: SpotPhase): readonly ToolSpec[] {
  if (phase === 'pre-commit') {
    return [RECALL_TABLE, lookupPrincipleSpec('pre-commit'), RECALL_TURN];
  }
  return [RECALL_TABLE, RECALL_GRADE, NUMERIC_PHRASES, lookupPrincipleSpec('post-reveal'), RECALL_TURN];
}

/** Fast membership test for the dispatcher's refusal path. */
export function toolNamesFor(phase: SpotPhase): readonly string[] {
  return registryFor(phase).map((t) => t.name);
}

// ── The principle corpus (fixed, number-free) ────────────────────────────────

interface PrincipleEntry {
  readonly text: string;
  /** Mechanics entries are the only keys allowed pre-commit. */
  readonly mechanics: boolean;
}

/**
 * Two sanitized overrides for the lesson mechanisms whose natural phrasing embeds a numeric
 * example ("2 times in 7", "1 time in 5"). Those digits would fail number-provenance against a
 * RulesRequest (whose allowedNumerals come from the visible table + question), so the lesson
 * text is rewritten to preserve the teaching intent without the numeric example.
 */
const LESSON_MECHANISM_OVERRIDES: Readonly<Record<string, string>> = {
  'pot-odds-as-a-price':
    'Pot odds are a price: the chips a call costs against the chips it can win, read as a natural frequency.',
  'counting-outs-as-a-frequency':
    'An out count becomes a frequency by comparing outs against unseen cards, one card at a time.',
};

/**
 * The lesson corpus (src/core/lessons) auto-mapped into PrincipleEntries so the tutor names
 * the same concepts the lessons teach. Phase 0-2 (Rules/Eyes/Arithmetic) is mechanics —
 * reachable pre-commit. Phase 3 (Principles) is strategy — post-reveal only. The corpus
 * import is safe because tsconfig.main.json pins rootDir="src" (main.ts, store.ts and others
 * already routinely import from ../core/); the earlier "widens emit root" concern is resolved.
 */
const LESSON_PRINCIPLES: Readonly<Record<string, PrincipleEntry>> = Object.freeze(
  Object.fromEntries(
    LESSONS.map((lesson) => [
      lesson.id,
      {
        text: LESSON_MECHANISM_OVERRIDES[lesson.id] ?? lesson.mechanism,
        mechanics: lesson.phase <= 2,
      },
    ]),
  ),
);

/**
 * A fixed lesson corpus keyed by an enum the context supplies, never by
 * free-text the model authors. Every entry is number-free (or sanitized), so it passes
 * guardToolResult against any request. Pre-commit, only `mechanics` keys are
 * reachable — a strategy key from a pre-commit call is refused.
 *
 * Order: lesson-derived keys first (17 from src/core/lessons), then the hand-authored keys
 * for concepts the lesson corpus does not name directly (button, blinds, 3-bet, cold-call,
 * check-raise, showdown, position, streets, actions, order, hand-rankings, and the seven
 * ErrorTag strategy entries). No key collides — lesson ids are kebab-case, hand-authored keys
 * are short nouns or ErrorTag ALL-CAPS.
 */
const PRINCIPLES: Readonly<Record<string, PrincipleEntry>> = {
  ...LESSON_PRINCIPLES,
  // Mechanics — reachable in every phase.
  actions: {
    text: 'Fold gives up the hand; check passes without adding chips when no bet is live; call matches the current bet; bet or raise puts chips in and asks the others to match.',
    mechanics: true,
  },
  order: {
    text: 'Action moves clockwise from the seat left of the button preflop and from the first live seat left of the button on later streets, until every live player has matched the last bet.',
    mechanics: true,
  },
  'hand-rankings': {
    text: 'Higher categories beat lower ones: a straight beats trips, a flush beats a straight, a full house beats a flush, and quads beat a full house. Within a category the higher ranks decide it.',
    mechanics: true,
  },
  showdown: {
    text: 'At showdown each player makes the best five-card hand from their two hole cards and the five board cards; the strongest hand wins the pot, and equal hands split it.',
    mechanics: true,
  },
  position: {
    text: 'Position is where you sit relative to the button. Later seats act after earlier ones on every postflop street, so a later seat sees more information before it must decide — playing more hands and applying more pressure from position is standard.',
    mechanics: true,
  },
  streets: {
    text: 'A hand has four betting rounds: preflop with two hole cards, the flop with three community cards, the turn with a fourth, and the river with a fifth. A round of betting completes each street before the next card is dealt.',
    mechanics: true,
  },
  blinds: {
    text: 'The small blind and big blind are forced bets posted before the cards are dealt, one seat and two seats left of the button. They seed the pot and set the amount everyone else must call or raise to enter the hand.',
    mechanics: true,
  },
  button: {
    text: 'The button marks the dealer seat and moves one seat clockwise after each hand. It is the last seat to act on every postflop street, which is why the button is the best seat at the table.',
    mechanics: true,
  },
  '3-bet': {
    text: 'A 3-bet is the third bet on a street: the big blind was the first, the opener\'s raise was the second, and re-raising the opener puts in the third. A 4-bet re-raises a 3-bet, and so on.',
    mechanics: true,
  },
  'cold-call': {
    text: 'A cold-call is calling a raise from a player who has not yet put chips in this hand — cold because it means entering the pot for the raised amount, not adding to a bet already made.',
    mechanics: true,
  },
  'check-raise': {
    text: 'A check-raise is checking first when the action reaches a seat, then raising a later bet on the same street after another player has bet into the same seat.',
    mechanics: true,
  },
  // Strategy — reachable only post-reveal, keyed by ErrorTag.
  RANGE: {
    text: 'A range is the whole set of hands a line represents. Compare the range that continues against the range that takes the line, not one hand against another.',
    mechanics: false,
  },
  TEXTURE: {
    text: 'Board texture is how the community cards connect: which ranges gain the overpairs, the nutted combinations, and the draws decides who can apply pressure.',
    mechanics: false,
  },
  PRICE: {
    text: 'Price is the share of the final pot a call costs, weighed against the share of the pot the continuing hand can expect to win.',
    mechanics: false,
  },
  BLOCKERS: {
    text: 'A blocker is a card in hand that removes combinations from the opponent, shrinking the set of hands they can hold at this node.',
    mechanics: false,
  },
  SIZING: {
    text: 'Sizing matches the amount put in to how polarised the betting range is: a wide, thin range sizes small; a nutted-or-air range sizes large.',
    mechanics: false,
  },
  'DEPTH-POSITION': {
    text: 'Stack depth and seat order set how much of a hand equity can actually be realised, because the deeper stack and the later seat control the size and the last decision.',
    mechanics: false,
  },
  PURITY: {
    text: 'A pure node is one the solver takes with a single action every time; choosing any other action at such a node is the error, whatever the reasoning.',
    mechanics: false,
  },
};

const TOOL_RESULT_REJECTED = 'That information is not available here.';
const REFUSAL = (name: string): string => `The tool "${name}" is not available in this phase.`;

// ── Prose renderers (visible-table and grade fields only) ────────────────────

/** Same fields renderTable() emits; duplicated here to keep requests.ts untouched. */
function renderTableProse(table: VisibleTable): string {
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
 * Post-reveal only. The tool result must survive guardToolResult, which post-reveal judges numerals
 * via checkPhraseUse — every digit must sit inside an engine-authored numeric phrase. So the numeric
 * fields (deltaEv, pot, equity, action EVs, class RW) are rendered as those exact phrases; the
 * word-only fields (chosen, best, error tag, principle, flipping variable) pass on their own.
 *
 * Omitted (verify-flagged bug): `tier` ("T0".."T4") and `boundaryHand` (e.g. "76s") carry stray
 * digits that no phrase covers, so including them made the ENTIRE result scrubbed to the refusal
 * stub. They are not lost — the model gets `tier` and `boundaryHand` in the strategy request
 * payload (renderGrade in requests.ts), so they land in the prompt itself; they just cannot be
 * re-surfaced via this guard-scored tool result.
 */
function renderGradeProse(grade: GradePayload): string {
  const phrases = numericPhrasesFor(grade).map((p) => p.text);
  return [
    ...phrases,
    `chosen: ${grade.chosenAction}`,
    `best: ${grade.bestAction}`,
    `error tag: ${grade.errorTag}`,
    `principle: ${grade.principle}`,
    `flipping variable: ${grade.flippingVariable}`,
  ].join('\n');
}

function lookupPrinciple(key: unknown, phase: SpotPhase): string {
  if (typeof key !== 'string') return TOOL_RESULT_REJECTED;
  const entry = PRINCIPLES[key];
  if (entry === undefined) return TOOL_RESULT_REJECTED;
  if (phase === 'pre-commit' && !entry.mechanics) return TOOL_RESULT_REJECTED;
  return entry.text;
}

function recallTurn(ctx: SpotContext, index: unknown): string {
  if (typeof index !== 'number' || !Number.isInteger(index)) return TOOL_RESULT_REJECTED;
  const turn = ctx.transcript[index];
  return turn === undefined ? TOOL_RESULT_REJECTED : turn.text;
}

/** Execute one call. A name outside the phase registry is refused — the gate at dispatch. */
function dispatchTool(call: ToolCall, ctx: SpotContext, registryNames: readonly string[]): string {
  if (!registryNames.includes(call.name)) return REFUSAL(call.name);
  switch (call.name) {
    case TOOL.recallTable:
      return renderTableProse(ctx.table);
    case TOOL.recallGrade:
      return ctx.grade === undefined ? TOOL_RESULT_REJECTED : renderGradeProse(ctx.grade);
    case TOOL.numericPhrases:
      return ctx.grade === undefined
        ? TOOL_RESULT_REJECTED
        : numericPhrasesFor(ctx.grade)
            .map((p) => p.text)
            .join('\n');
    case TOOL.lookupPrinciple:
      return lookupPrinciple(call.args.key, ctx.phase);
    case TOOL.recallTurn:
      return recallTurn(ctx, call.args.index);
    default:
      return REFUSAL(call.name);
  }
}

// ── The guards ───────────────────────────────────────────────────────────────

function requestFor(ctx: SpotContext): TutorRequest {
  if (ctx.phase === 'pre-commit' || ctx.grade === undefined) {
    return buildRulesRequest({ question: ctx.question, table: ctx.table }).payload;
  }
  return buildStrategyRequest(
    { prompt: ctx.question, table: ctx.table, grade: ctx.grade, lexicon: ctx.lexicon },
    'correction',
  ).payload;
}

/**
 * The one predicate both guards share.
 *
 * FORM (word-count unless skipped, ban-list, leading-pronoun) always runs via
 * checkTutorOutput. NUMERALS are checked one of two ways, never both, because
 * the two provenance tests disagree on rounding:
 *
 *   - PRE-COMMIT / no phrases: string-membership provenance against the fixed
 *     RulesRequest (allowedNumerals is solver-free). Any numeral not literally in
 *     the request is a violation. This is the load-bearing privacy check.
 *   - POST-REVEAL / phrases present: checkPhraseUse — every numeral must sit
 *     inside an engine-authored phrase. This is STRICTER than string-membership
 *     (an approved phrase is grade-derived by construction) and it is the only
 *     one that tolerates the engine's own rounding, e.g. an EV of 0 rendered as
 *     "0.0". So it REPLACES provenance rather than stacking on top of it, which
 *     is why a legitimately rounded phrase quote is not falsely rejected.
 *
 * checkPhraseUse subsumes string-membership provenance for the privacy goal, so
 * dropping the latter post-reveal loosens nothing: a numeral outside every
 * approved phrase still fails, and every approved phrase came from a grade field.
 */
function formAndNumeralsClean(
  text: string,
  request: TutorRequest,
  phrases: readonly NumericPhrase[],
  skipWordCount: boolean,
): boolean {
  const verdict = checkTutorOutput({ text, kind: 'correction' }, request, { skipWordCount });

  // Pre-commit / no phrases: string-membership provenance is the privacy check.
  if (phrases.length === 0) return verdict.ok;

  // Post-reveal: every non-provenance violation still fails; numerals are judged
  // by checkPhraseUse instead, which subsumes provenance and tolerates rounding.
  const formClean = verdict.violations.every(
    (v: GuardViolation) => v.check === 'number-provenance',
  );
  return formClean && checkPhraseUse(text, phrases).length === 0;
}

/**
 * The per-hop tool-result guard. A tool result is context fed BACK to the model,
 * not final prose, so the T4 word cap does not apply (a full principle lookup
 * runs long) — but form and numeral provenance do. A result carrying a
 * fabricated solver numeral or a banned construction is replaced by a refusal
 * stub rather than entering the transcript.
 */
export function guardToolResult(
  text: string,
  request: TutorRequest,
  phrases: readonly NumericPhrase[],
): string {
  return formAndNumeralsClean(text, request, phrases, true) ? text : TOOL_RESULT_REJECTED;
}

/** The final-output joint-truth check: form AND the phase-appropriate numeral check. */
function textPasses(
  text: string,
  request: TutorRequest,
  phrases: readonly NumericPhrase[],
): boolean {
  return formAndNumeralsClean(text, request, phrases, false);
}

// ── The loop ─────────────────────────────────────────────────────────────────

const REGENERATE_NUDGE =
  'That reply was rejected by the output guard. Re-answer using only engine-provided numbers, no praise, no second-person openings.';

function appendTurn(ctx: SpotContext, message: AgentMessage, cap: number): void {
  ctx.transcript.push(message);
  // Bound memory: drop the oldest non-anchor turn, never the seeded question at [0].
  while (ctx.transcript.length > cap) ctx.transcript.splice(1, 1);
}

function systemFor(ctx: SpotContext, phrases: readonly NumericPhrase[]): string {
  const base =
    ctx.phase === 'pre-commit'
      ? 'Answer a mechanics question about Texas hold\'em using the tools. Rules only: do not say which action is better, do not rank actions, do not hint at equity. Never state a number that is not returned by a tool.'
      : 'The engine has already graded this decision. Narrate its numbers using the tools; never compute one.';
  return phrases.length > 0 ? `${base}\n\n${phraseInstruction(phrases)}` : base;
}

/**
 * Drive the capped tool-dispatch loop. Pure and hermetic: the only side effect is
 * appending guard-passed turns to ctx.transcript. Never touches the network — it
 * calls deps.client.converse(), which the mock (and later bedrock.ts) supplies.
 */
export async function runTutorAgent(ctx: SpotContext, deps: AgentDeps): Promise<AgentResult> {
  const caps: AgentCaps = { ...DEFAULT_CAPS, ...deps.caps };
  const cap = transcriptCap(caps);
  const request = requestFor(ctx);
  const registry = registryFor(ctx.phase);
  const registryNames = registry.map((t) => t.name);
  const phrases =
    ctx.phase === 'post-reveal' && ctx.grade !== undefined ? numericPhrasesFor(ctx.grade) : [];
  const system = systemFor(ctx, phrases);

  const converse = deps.client.converse;
  const fall = (termination: Termination, turns: number, toolCalls: number): AgentResult => {
    const fixed = fixedResponse(request);
    return { ...fixed, termination, turns, toolCalls };
  };

  if (converse === undefined) return fall('fallback:error', 0, 0);

  let turns = 0;
  let toolCalls = 0;
  let regenerated = false;

  for (;;) {
    if (turns >= caps.maxTurns) return fall('fallback:max-turns', turns, toolCalls);

    const envelope: AgentEnvelope = {
      system,
      tools: registry,
      messages: [...ctx.transcript],
      maxTokens: 400,
    };

    let turn;
    try {
      turn = await converse.call(deps.client, envelope);
    } catch {
      return fall('fallback:error', turns, toolCalls);
    }
    turns += 1;

    if (turn.kind === 'text') {
      if (textPasses(turn.text, request, phrases)) {
        return { text: turn.text, kind: 'correction', source: 'model', termination: 'text', turns, toolCalls };
      }
      // One regeneration, matching liveTutor's policy, then the fixed table.
      if (regenerated) return fall('fallback:guard', turns, toolCalls);
      regenerated = true;
      appendTurn(ctx, { role: 'user', text: REGENERATE_NUDGE }, cap);
      continue;
    }

    // tool_use: execute each call, guard each result, append it.
    appendTurn(ctx, { role: 'assistant', text: `[requested: ${turn.calls.map((c) => c.name).join(', ')}]` }, cap);
    for (const call of turn.calls) {
      if (toolCalls >= caps.maxToolCalls) return fall('fallback:max-tool-calls', turns, toolCalls);
      toolCalls += 1;
      const raw = dispatchTool(call, ctx, registryNames);
      const guarded = guardToolResult(raw, request, phrases);
      appendTurn(ctx, { role: 'tool', text: guarded }, cap);
    }
  }
}
