/**
 * Replay cache, keyed by prompt hash. Layer two of the Testing section's
 * "tutor nondeterminism, three layers": a recorded transcript makes CI
 * deterministic without the network.
 *
 * OFF BY DEFAULT. The Security section's logging rule allows request/response
 * bodies to be logged *only* into this cache, and only as a developer-facing
 * opt-in — so `openReplayCache` returns a disabled cache unless a directory is
 * passed explicitly, and a disabled cache never touches the filesystem.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PromptEnvelope } from './types.js';

export type ReplayMode = 'off' | 'replay' | 'record';

export function promptHash(envelope: PromptEnvelope): string {
  const canonical = JSON.stringify([envelope.system, envelope.user, envelope.maxTokens]);
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export interface ReplayCache {
  readonly mode: ReplayMode;
  read(envelope: PromptEnvelope): string | null;
  write(envelope: PromptEnvelope, completion: string): void;
}

const DISABLED: ReplayCache = {
  mode: 'off',
  read: () => null,
  write: () => {},
};

export function openReplayCache(options: { mode: ReplayMode; dir?: string }): ReplayCache {
  if (options.mode === 'off' || options.dir === undefined) return DISABLED;
  const dir = options.dir;

  const fileFor = (envelope: PromptEnvelope): string =>
    path.join(dir, `${promptHash(envelope)}.json`);

  return {
    mode: options.mode,
    read(envelope) {
      try {
        const raw = fs.readFileSync(fileFor(envelope), 'utf-8');
        const parsed = JSON.parse(raw) as { completion?: unknown };
        return typeof parsed.completion === 'string' ? parsed.completion : null;
      } catch {
        return null;
      }
    },
    write(envelope, completion) {
      if (options.mode !== 'record') return;
      fs.mkdirSync(dir, { recursive: true });
      // The API key is never in an envelope, so nothing here needs redaction —
      // but the whole file is still developer-facing and must not ship enabled.
      fs.writeFileSync(
        fileFor(envelope),
        JSON.stringify({ prompt: envelope, completion }, null, 2),
        'utf-8',
      );
    },
  };
}
