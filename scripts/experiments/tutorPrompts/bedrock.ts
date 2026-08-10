/**
 * EXPERIMENT 4 — Bedrock client.
 * Shells out to the already-authenticated aws CLI. No new npm dependencies (PRODUCT-SPEC's
 * local-only posture means the shipped app has its own client; this is a research harness).
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const MODEL_ID = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
export const REGION = 'us-west-2';
export const AWS_PROFILE = 'ziya';

export interface InvokeOpts {
  system?: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

export async function invoke(opts: InvokeOpts): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'tutorprompt-'));
  const reqPath = join(dir, 'req.json');
  const outPath = join(dir, 'out.json');
  const body: Record<string, unknown> = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: opts.maxTokens ?? 400,
    messages: [{ role: 'user', content: opts.user }],
  };
  if (opts.system) body.system = opts.system;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  writeFileSync(reqPath, JSON.stringify(body));

  try {
    await run(
      'aws',
      [
        'bedrock-runtime', 'invoke-model',
        '--region', REGION,
        '--model-id', MODEL_ID,
        '--body', `fileb://${reqPath}`,
        '--cli-binary-format', 'raw-in-base64-out',
        outPath,
      ],
      { env: { ...process.env, AWS_PROFILE }, maxBuffer: 8 * 1024 * 1024 },
    );
    const parsed = JSON.parse(readFileSync(outPath, 'utf8')) as { content: { text?: string }[] };
    return (parsed.content[0]?.text ?? '').trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Bounded concurrency so 100+ calls do not all fire at once. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
