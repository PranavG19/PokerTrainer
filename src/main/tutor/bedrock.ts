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
import type { ModelClient, PromptEnvelope } from './types.js';

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

export function bedrockClient(config: BedrockConfig): ModelClient {
  const timeoutMs = config.timeoutMs ?? 60_000;

  return {
    id: `bedrock:${config.modelId}`,
    async complete(envelope: PromptEnvelope): Promise<string> {
      // The CLI reads the body from a file rather than argv so a long prompt
      // cannot hit the platform's argument-length limit.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-bedrock-'));
      const bodyPath = path.join(dir, `${crypto.randomUUID()}.json`);
      const outPath = path.join(dir, 'out.json');
      try {
        fs.writeFileSync(bodyPath, invokeBody(envelope), 'utf-8');
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
        return completionFrom(fs.readFileSync(outPath, 'utf-8'));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
