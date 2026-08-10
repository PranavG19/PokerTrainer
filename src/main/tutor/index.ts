/**
 * Tutor assembly and the ask gate. This is the only module main.ts talks to.
 *
 * T1 — with no credentials configured the tutor resolves to the null tutor,
 * whose module graph contains nothing that can open a socket. "Zero network
 * calls with no key" is therefore a property of what got constructed, not a
 * runtime check that could be bypassed.
 */

import { bedrockClient, bedrockHost } from './bedrock.js';
import { liveTutor, type GuardFailure } from './liveTutor.js';
import { askVerdict, type TutorContext } from './muteMatrix.js';
import { nullTutor, type Tutor } from './nullTutor.js';
import { openReplayCache, type ReplayMode } from './replayCache.js';
import { buildRulesRequest, buildStrategyRequest } from './requests.js';
import type { GradePayload, TutorRequest, VisibleTable } from './types.js';

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
    return { tutor: nullTutor, credentialsConfigured: false, egressAllowlist: [], guardFailures };
  }

  const tutor = liveTutor({
    client: bedrockClient({ profile, region, modelId }),
    cache: openReplayCache({
      mode: replayMode(env.OFFSUIT_REPLAY_MODE),
      dir: env.OFFSUIT_REPLAY_DIR,
    }),
    onGuardFailure: (failure) => guardFailures.push(failure),
  });

  return {
    tutor,
    credentialsConfigured: true,
    egressAllowlist: [bedrockHost(region)],
    guardFailures,
  };
}

export interface AskInput {
  readonly context: TutorContext;
  readonly question: string;
  readonly table: VisibleTable;
  /** Present only post-reveal. Its presence is what selects the strategy builder. */
  readonly grade?: GradePayload;
  readonly lexicon?: readonly string[];
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
