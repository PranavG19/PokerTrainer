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
import type { AgentEnvelope, ModelTurn, PromptEnvelope } from './types.js';

export type ReplayMode = 'off' | 'replay' | 'record';

export function promptHash(envelope: PromptEnvelope): string {
  const canonical = JSON.stringify([envelope.system, envelope.user, envelope.maxTokens]);
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

/**
 * Hash for a multi-turn AGENT envelope. Keyed over the full conversation state the model would
 * condition on — system, the tool registry (name+description), the running transcript, and the
 * budget — so a recorded turn only replays when the exact same envelope recurs. Distinct namespace
 * from promptHash: turn files are written as `${hash}.turn.json`, completion files as `${hash}.json`,
 * so the single-shot and multi-turn caches never collide in one directory.
 */
export function envelopeHash(envelope: AgentEnvelope): string {
  const canonical = JSON.stringify([
    envelope.system,
    envelope.tools.map((t) => [t.name, t.description]),
    envelope.messages.map((m) => [m.role, m.text]),
    envelope.maxTokens,
  ]);
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export interface ReplayCache {
  readonly mode: ReplayMode;
  read(envelope: PromptEnvelope): string | null;
  write(envelope: PromptEnvelope, completion: string): void;
  /** Multi-turn agent channel — reads a recorded ModelTurn for an AgentEnvelope, or null. */
  readTurn(envelope: AgentEnvelope): ModelTurn | null;
  /** Records a ModelTurn for an AgentEnvelope (record mode only; a no-op otherwise). */
  writeTurn(envelope: AgentEnvelope, turn: ModelTurn): void;
}

const DISABLED: ReplayCache = {
  mode: 'off',
  read: () => null,
  write: () => {},
  readTurn: () => null,
  writeTurn: () => {},
};

/** True when a parsed value is a well-formed ModelTurn (guards a hand-edited or truncated cache file). */
function isModelTurn(value: unknown): value is ModelTurn {
  if (value === null || typeof value !== 'object') return false;
  const turn = value as { kind?: unknown; text?: unknown; calls?: unknown };
  if (turn.kind === 'text') return typeof turn.text === 'string';
  if (turn.kind === 'tool_use') {
    return (
      Array.isArray(turn.calls) &&
      turn.calls.every(
        (c) => c !== null && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string',
      )
    );
  }
  return false;
}

export function openReplayCache(options: { mode: ReplayMode; dir?: string }): ReplayCache {
  if (options.mode === 'off' || options.dir === undefined) return DISABLED;
  const dir = options.dir;

  const fileFor = (envelope: PromptEnvelope): string =>
    path.join(dir, `${promptHash(envelope)}.json`);
  const turnFileFor = (envelope: AgentEnvelope): string =>
    path.join(dir, `${envelopeHash(envelope)}.turn.json`);

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
    readTurn(envelope) {
      try {
        const raw = fs.readFileSync(turnFileFor(envelope), 'utf-8');
        const parsed = JSON.parse(raw) as { turn?: unknown };
        return isModelTurn(parsed.turn) ? parsed.turn : null;
      } catch {
        return null;
      }
    },
    writeTurn(envelope, turn) {
      if (options.mode !== 'record') return;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        turnFileFor(envelope),
        JSON.stringify({ envelope, turn }, null, 2),
        'utf-8',
      );
    },
  };
}
