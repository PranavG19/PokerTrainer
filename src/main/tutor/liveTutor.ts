/**
 * The live tutor: model client → replay cache → guard → fixed-string fallback.
 *
 * T4's failure policy is the whole control flow here: one regeneration, then
 * the fixed string table. Guard failures are collected so settings diagnostics
 * can show them.
 */

import { checkTutorOutput, type GuardViolation } from './guard.js';
import { fixedResponse, type Tutor } from './nullTutor.js';
import type { ReplayCache } from './replayCache.js';
import { buildRulesRequest, buildStrategyRequest, type BuiltRequest } from './requests.js';
import type { ModelClient, TutorRequest, TutorResponse } from './types.js';

export interface GuardFailure {
  readonly requestKind: TutorRequest['kind'];
  readonly attempt: 1 | 2;
  readonly violations: readonly GuardViolation[];
}

export interface LiveTutorOptions {
  readonly client: ModelClient;
  readonly cache: ReplayCache;
  /** Diagnostics sink — the Security section requires guard failures be visible in settings. */
  readonly onGuardFailure?: (failure: GuardFailure) => void;
}

/**
 * Rebuild the envelope for a payload the renderer already produced. Routing
 * through the T3a builders means a rules request cannot acquire an envelope
 * that mentions a solver quantity, because there is no such builder.
 */
function envelopeFor(request: TutorRequest): BuiltRequest<TutorRequest> {
  return request.kind === 'rules'
    ? buildRulesRequest({ question: request.question, table: request.table })
    : buildStrategyRequest(
        {
          prompt: request.prompt,
          table: request.table,
          grade: request.grade,
          lexicon: request.lexicon,
        },
        'correction',
      );
}

export function liveTutor(options: LiveTutorOptions): Tutor {
  const { client, cache, onGuardFailure } = options;

  return {
    id: `live:${client.id}`,
    async respond(request: TutorRequest): Promise<TutorResponse> {
      const built = envelopeFor(request);

      for (const attempt of [1, 2] as const) {
        let text: string;
        try {
          const cached = cache.read(built.envelope);
          if (cached !== null) {
            text = cached;
          } else {
            text = await client.complete(built.envelope);
            cache.write(built.envelope, text);
          }
        } catch {
          // "API call fails / times out → one retry, then fixed string table."
          if (attempt === 2) break;
          continue;
        }

        const verdict = checkTutorOutput({ text, kind: built.kind }, request);
        if (verdict.ok) return { text, kind: built.kind, source: 'model' };
        onGuardFailure?.({ requestKind: request.kind, attempt, violations: verdict.violations });
      }

      return fixedResponse(request);
    },
  };
}
