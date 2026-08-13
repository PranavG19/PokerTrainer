/**
 * Tutor assembly and the ask gate. This is the only module main.ts talks to.
 *
 * T1 — with no credentials configured the tutor resolves to the null tutor,
 * whose module graph contains nothing that can open a socket. "Zero network
 * calls with no key" is therefore a property of what got constructed, not a
 * runtime check that could be bypassed.
 */

import {
  mintSpotContext,
  runTutorAgent,
  type SpotPhase,
} from './agent.js';
import { bedrockClient, bedrockHost } from './bedrock.js';
import { liveTutor, type GuardFailure } from './liveTutor.js';
import { askVerdict, type TutorContext } from './muteMatrix.js';
import { nullModelClient, nullTutor, type Tutor } from './nullTutor.js';
import { openReplayCache, type ReplayCache, type ReplayMode } from './replayCache.js';
import { buildRulesRequest, buildStrategyRequest } from './requests.js';
import type {
  AgentMessage,
  GradePayload,
  ModelClient,
  TutorRequest,
  VisibleTable,
} from './types.js';

export interface TutorEnvConfig {
  readonly OFFSUIT_BEDROCK_PROFILE?: string;
  readonly OFFSUIT_BEDROCK_REGION?: string;
  readonly OFFSUIT_BEDROCK_MODEL?: string;
  readonly OFFSUIT_REPLAY_MODE?: string;
  readonly OFFSUIT_REPLAY_DIR?: string;
}

export interface ResolvedTutor {
  readonly tutor: Tutor;
  readonly credentialsConfigured: boolean;
  /** Empty when no credentials are configured — the Security section's empty allowlist. */
  readonly egressAllowlist: readonly string[];
  readonly guardFailures: GuardFailure[];
  /**
   * The multi-turn seam for the tool-using agent (runTutorAgent). It is the same
   * network client the single-shot `tutor` wraps: the Bedrock client when
   * credentials are set, and nullModelClient (no converse(), zero network) when
   * they are not. The agent reads a missing converse() as "no model" and falls to
   * the guard-clean fixed table, so a no-credentials follow-up is byte-for-byte
   * the null tutor. Separated from `tutor` only because respond() and converse()
   * are different seams; both are backed by the same configuration.
   */
  readonly client: ModelClient;
  /**
   * The same replay cache the single-shot `tutor` wraps, exposed so the multi-turn agent
   * (runTutorAgent) shares one recording surface with liveTutor. Disabled (mode 'off') unless
   * OFFSUIT_REPLAY_MODE + OFFSUIT_REPLAY_DIR are set, so the default path is untouched.
   */
  readonly cache: ReplayCache;
}

function replayMode(raw: string | undefined): ReplayMode {
  return raw === 'replay' || raw === 'record' ? raw : 'off';
}

/** All three Bedrock settings must be present; a partial config is no config. */
export function resolveTutor(env: TutorEnvConfig): ResolvedTutor {
  const guardFailures: GuardFailure[] = [];
  const profile = env.OFFSUIT_BEDROCK_PROFILE;
  const region = env.OFFSUIT_BEDROCK_REGION;
  const modelId = env.OFFSUIT_BEDROCK_MODEL;

  if (profile === undefined || region === undefined || modelId === undefined) {
    // No credentials: a disabled cache still satisfies the ResolvedTutor shape, and a replay-mode
    // cache with a dir can drive the agent from recordings even without a live client.
    return {
      tutor: nullTutor,
      credentialsConfigured: false,
      egressAllowlist: [],
      guardFailures,
      client: nullModelClient,
      cache: openReplayCache({
        mode: replayMode(env.OFFSUIT_REPLAY_MODE),
        dir: env.OFFSUIT_REPLAY_DIR,
      }),
    };
  }

  const client = bedrockClient({ profile, region, modelId });
  const cache = openReplayCache({
    mode: replayMode(env.OFFSUIT_REPLAY_MODE),
    dir: env.OFFSUIT_REPLAY_DIR,
  });
  const tutor = liveTutor({
    client,
    cache,
    onGuardFailure: (failure) => guardFailures.push(failure),
  });

  return {
    tutor,
    credentialsConfigured: true,
    egressAllowlist: [bedrockHost(region)],
    guardFailures,
    client,
    cache,
  };
}

export interface AskInput {
  readonly context: TutorContext;
  readonly question: string;
  readonly table: VisibleTable;
  /** Present only post-reveal. Its presence is what selects the strategy builder. */
  readonly grade?: GradePayload;
  readonly lexicon?: readonly string[];
  /**
   * Prior exchanges in THIS spot, oldest first, for a bounded multi-turn follow-up.
   * When present and non-empty, the ask is driven by the tool-using agent
   * (runTutorAgent) rather than the single-shot tutor, so the model can read what
   * was already said. It is threaded into the agent's TRANSCRIPT only — never into
   * the guarded request, whose allowedNumerals come from this turn's table/grade
   * alone. History therefore cannot widen what a numeral is checked against, which
   * is the load-bearing privacy property (tested). Absent → the turn-0 path is
   * byte-for-byte unchanged.
   */
  readonly history?: readonly { readonly question: string; readonly answerText: string }[];
}

export interface AskResult {
  readonly tutorId: string;
  readonly questionKind: 'rules' | 'strategy';
  readonly verdict: 'allowed' | 'blocked';
  readonly text: string | null;
  /**
   * Flattened key paths of the payload that was actually built, for the T3a
   * oracle. Empty when the matrix blocked the question, because then no payload
   * was built at all.
   */
  readonly payloadKeys: readonly string[];
  /**
   * Which route actually produced `text`: `model` only when a live call's output passed the guard,
   * `fixed` when the written string table answered, `null` when the matrix blocked the question and
   * nothing answered at all.
   *
   * Forwarded because liveTutor falls back to the fixed table SILENTLY whenever the model fails,
   * times out or is guard-rejected — so `tutorId` is not evidence the model answered, and a caller
   * inferring provenance from it tells the learner "from the configured model" while the written
   * notes are what they are reading. TutorResponse has carried this all along; it simply stopped
   * here instead of reaching the renderer.
   */
  readonly answeredBy: 'fixed' | 'model' | null;
}

function keyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return prefix === '' ? [] : [prefix];
  if (Array.isArray(value)) return prefix === '' ? [] : [`${prefix}[]`];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    keyPaths(child, prefix === '' ? key : `${prefix}.${key}`),
  );
}

function requestFor(input: AskInput): TutorRequest {
  if (input.grade === undefined) {
    return buildRulesRequest({ question: input.question, table: input.table }).payload;
  }
  return buildStrategyRequest(
    {
      prompt: input.question,
      table: input.table,
      grade: input.grade,
      lexicon: input.lexicon ?? [],
    },
    'correction',
  ).payload;
}

/**
 * Which SpotContext phase a mute-matrix context sits in. Only 'spot-post-reveal'
 * is post-reveal; every other context is pre-commit, which is the stricter phase
 * gate (recall_grade and numeric_phrases are omitted from its tool registry). The
 * default therefore fails safe: an unrecognised or in-progress context never
 * exposes a solver tool.
 */
function phaseFor(context: TutorContext): SpotPhase {
  return context === 'spot-post-reveal' ? 'post-reveal' : 'pre-commit';
}

/**
 * The request the AGENT will guard against, built with the agent's own routing
 * (rules unless BOTH the phase is post-reveal AND a grade is present). Reported as
 * payloadKeys so the T3a oracle sees the same request the agent enforced. History
 * is deliberately NOT an input here: it never widens what a numeral is checked
 * against.
 */
function agentRequestFor(input: AskInput, phase: SpotPhase): TutorRequest {
  if (phase === 'pre-commit' || input.grade === undefined) {
    return buildRulesRequest({ question: input.question, table: input.table }).payload;
  }
  return buildStrategyRequest(
    {
      prompt: input.question,
      table: input.table,
      grade: input.grade,
      lexicon: input.lexicon ?? [],
    },
    'correction',
  ).payload;
}

/**
 * Prior exchanges → the agent's seed transcript, oldest first, each pair rendered
 * as the learner's question then the tutor's answer. mintSpotContext prepends the
 * CURRENT question at index 0 (the anchor the guarded request is built from), so
 * these seeded turns are the conversational context the model may read — content
 * only, never a new numeral source.
 */
function seedFromHistory(
  history: readonly { readonly question: string; readonly answerText: string }[],
): AgentMessage[] {
  return history.flatMap((pair) => [
    { role: 'user' as const, text: pair.question },
    { role: 'assistant' as const, text: pair.answerText },
  ]);
}

export async function askTutor(resolved: ResolvedTutor, input: AskInput): Promise<AskResult> {
  const { kind, verdict } = askVerdict(input.context, input.question);
  if (verdict === 'blocked') {
    return {
      tutorId: resolved.tutor.id,
      questionKind: kind,
      verdict,
      text: null,
      payloadKeys: [],
      // Blocked: no payload was built and nothing answered, so there is no source to name.
      answeredBy: null,
    };
  }

  // Follow-up turn: drive the tool-using agent so the model can read the prior
  // exchanges. Turn 0 (no history) keeps the single-shot path below, byte-for-byte.
  if (input.history !== undefined && input.history.length > 0) {
    const phase = phaseFor(input.context);
    // The grade is passed to the anchor ONLY post-reveal; pre-commit has no grade
    // field to read, which is the structural half of the T3a guarantee.
    const grade = phase === 'post-reveal' ? input.grade : undefined;
    const ctx = mintSpotContext({
      phase,
      table: input.table,
      grade,
      lexicon: input.lexicon,
      question: input.question,
      seedTranscript: seedFromHistory(input.history),
    });
    const result = await runTutorAgent(ctx, { client: resolved.client, cache: resolved.cache });
    return {
      tutorId: resolved.tutor.id,
      questionKind: kind,
      verdict,
      text: result.text,
      // The request the agent actually guarded against — history is not in it.
      payloadKeys: keyPaths(agentRequestFor(input, phase)).sort(),
      answeredBy: result.source,
    };
  }

  const request = requestFor(input);
  const response = await resolved.tutor.respond(request);
  return {
    tutorId: resolved.tutor.id,
    questionKind: kind,
    verdict,
    text: response.text,
    payloadKeys: keyPaths(request).sort(),
    answeredBy: response.source,
  };
}
