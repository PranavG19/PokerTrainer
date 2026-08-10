// Shells out to the already-authenticated aws CLI. No npm dependencies by constraint.
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const MODEL_ID = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
export const REGION = 'us-west-2';
export const PROFILE = 'ziya';

/**
 * One Bedrock InvokeModel call. `messages` is the full turn list, so callers own the
 * conversation state — a multi-turn Socratic exchange is just a growing array.
 */
export async function invoke(messages, { system, maxTokens = 512 } = {}) {
  const body = { anthropic_version: 'bedrock-2023-05-31', max_tokens: maxTokens, messages };
  if (system) body.system = system;

  const dir = await mkdtemp(join(tmpdir(), 'e5-'));
  const reqPath = join(dir, 'req.json');
  const outPath = join(dir, 'out.json');
  try {
    await writeFile(reqPath, JSON.stringify(body));
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
      { env: { ...process.env, AWS_PROFILE: PROFILE }, maxBuffer: 1 << 24 },
    );
    const parsed = JSON.parse(await readFile(outPath, 'utf8'));
    return parsed.content[0].text.trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Bounded-concurrency map: Bedrock throttles, and 30 parallel invokes trips it. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
