/**
 * Bedrock bridge. Main process only — the Security section puts every network
 * call in main, so nothing here is reachable from the renderer.
 *
 * DEV CONFIGURATION, NOT THE SHIPPING DESIGN. This shells out to the already
 * authenticated `aws` CLI because SigV4-signing by hand is out of scope while
 * the no-new-npm-dependencies constraint holds. The shipping design is a signed
 * HTTPS client against one allowlisted host. The seam is `ModelClient`, so
 * replacing this implementation touches no caller.
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { AgentEnvelope, ModelClient, ModelTurn, PromptEnvelope } from './types.js';

export interface BedrockConfig {
  readonly profile: string;
  readonly region: string;
  readonly modelId: string;
  readonly timeoutMs?: number;
}

/** The one host the egress allowlist admits, derived from the region. */
export function bedrockHost(region: string): string {
  return `bedrock-runtime.${region}.amazonaws.com`;
}

/** Bedrock's InvokeModel body for an Anthropic model. */
export function invokeBody(envelope: PromptEnvelope): string {
  return JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: envelope.maxTokens,
    system: envelope.system,
    messages: [{ role: 'user', content: [{ type: 'text', text: envelope.user }] }],
  });
}

/**
 * Bedrock's InvokeModel body for a MULTI-TURN, TOOL-USING agent conversation. Distinct from
 * invokeBody() because the wire shape is tools[] + messages[], not a single user turn.
 *
 * Anthropic's Bedrock schema mirrors the native Messages API: each tool declares name/description
 * and an input_schema; each message carries a role + a content list. AgentMessage's 'tool' role
 * is fed back to the model as an assistant-authored acknowledgement of the tool result — Bedrock's
 * chat schema only knows 'user' and 'assistant', so tool results ride the assistant channel
 * (agent.ts already stamps them into the transcript as tool role, and the model reads the prose
 * content regardless of role label).
 */
export function converseBody(envelope: AgentEnvelope): string {
  return JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: envelope.maxTokens,
    system: envelope.system,
    tools: envelope.tools.map((t) => ({
      name: t.name,
      description: t.description,
      // The agent loop dispatches tool calls locally from the args object, so the schema is
      // deliberately loose — every argument is accepted at the wire level and validated by the
      // dispatcher (lookupPrinciple / recallTurn reject non-string / non-integer args as refusal
      // stubs). Tightening this would duplicate the dispatcher's contract on the wire.
      input_schema: { type: 'object', properties: {}, additionalProperties: true },
    })),
    messages: envelope.messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: [{ type: 'text', text: m.text }],
    })),
  });
}

/**
 * Parse an InvokeModel response into a ModelTurn. Tool calls take priority — an Anthropic response
 * that includes any tool_use block is interpreted as the agent's tool_use turn (mixed text+tool
 * blocks are treated as a tool_use turn, dropping any preamble text). A response with only text
 * blocks is a text turn. An empty response throws — that is the same failure surface as
 * completionFrom(), and the agent loop treats a throw as fallback:error.
 */
export function converseTurnFrom(responseBody: string): ModelTurn {
  const parsed = JSON.parse(responseBody) as {
    content?: Array<
      | { type: 'text'; text?: string }
      | { type: 'tool_use'; id?: string; name?: string; input?: Record<string, unknown> }
      | { type: string }
    >;
  };
  const blocks = parsed.content ?? [];
  // Filter to well-formed tool_use blocks up front — a block with no name is undispatchable and
  // is dropped rather than entering the tool_use branch with an empty calls array, which would
  // wedge the agent loop.
  const toolUses = blocks
    .filter(
      (b): b is { type: 'tool_use'; name?: string; input?: Record<string, unknown> } =>
        b.type === 'tool_use',
    )
    .filter((t) => typeof t.name === 'string' && t.name.length > 0);
  if (toolUses.length > 0) {
    return {
      kind: 'tool_use',
      calls: toolUses.map((t) => ({ name: t.name as string, args: t.input ?? {} })),
    };
  }
  const text = blocks
    .filter((b): b is { type: 'text'; text?: string } => b.type === 'text')
    .map((b) => (typeof b.text === 'string' ? b.text : ''))
    .join('')
    .trim();
  if (text === '') throw new Error('bedrock returned no text or tool_use block');
  return { kind: 'text', text };
}

/** Pull the assistant text out of an InvokeModel response body. */
export function completionFrom(responseBody: string): string {
  const parsed = JSON.parse(responseBody) as {
    content?: { type?: string; text?: string }[];
  };
  const text = (parsed.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('')
    .trim();
  if (text === '') throw new Error('bedrock returned no text block');
  return text;
}

function run(
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { env, timeout: timeoutMs }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(`${file} failed: ${stderr.trim() || error.message}`));
        return;
      }
      resolve();
    });
  });
}

/**
 * Shared shell-out for both complete() and converse(). Writes `body` to a temp file (avoiding the
 * platform's argv length limit for long prompts), invokes `aws bedrock-runtime invoke-model`, and
 * returns the parsed response body via `parse`. Cleans up the temp dir on every exit path.
 */
async function invokeModel<T>(
  config: BedrockConfig,
  body: string,
  timeoutMs: number,
  parse: (responseBody: string) => T,
): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-bedrock-'));
  const bodyPath = path.join(dir, `${crypto.randomUUID()}.json`);
  const outPath = path.join(dir, 'out.json');
  try {
    fs.writeFileSync(bodyPath, body, 'utf-8');
    await run(
      'aws',
      [
        'bedrock-runtime',
        'invoke-model',
        '--region',
        config.region,
        '--model-id',
        config.modelId,
        '--body',
        `fileb://${bodyPath}`,
        '--cli-binary-format',
        'raw-in-base64-out',
        outPath,
      ],
      { ...process.env, AWS_PROFILE: config.profile },
      timeoutMs,
    );
    return parse(fs.readFileSync(outPath, 'utf-8'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function bedrockClient(config: BedrockConfig): ModelClient {
  const timeoutMs = config.timeoutMs ?? 60_000;

  return {
    id: `bedrock:${config.modelId}`,
    async complete(envelope: PromptEnvelope): Promise<string> {
      return invokeModel(config, invokeBody(envelope), timeoutMs, completionFrom);
    },
    async converse(envelope: AgentEnvelope): Promise<ModelTurn> {
      return invokeModel(config, converseBody(envelope), timeoutMs, converseTurnFrom);
    },
  };
}
