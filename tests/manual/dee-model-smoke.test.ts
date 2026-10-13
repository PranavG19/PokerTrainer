/**
 * MANUAL smoke test of "Smarter phrasing" with a REAL local model. Never run in CI: it needs a llama-server
 * binary and ~1 GB of weights on disk, and `npm test` does not include tests/manual. Run it with:
 *
 *   DEE_SMOKE_BINARY=<llama-server> DEE_SMOKE_MODEL=<Qwen3-1.7B-Q4_K_M.gguf> [DEE_SMOKE_OUT=<file>] \
 *     npx vitest run --config tests/manual/vitest.config.ts
 *
 * It starts the sidecar exactly as the app does (sandbox, unix socket, API key), sends every phraseable chat
 * answer for a set of hands and questions through the app's Phraser (600 ms budget, every check), and prints
 * per-answer outcome and latency, a summary, and a sandbox egress probe.
 */

import { execFileSync } from 'node:child_process';
import { it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LlamaSidecar, sandboxProfile, SANDBOX_EXEC } from '../../src/main/dee/sidecar.js';
import { Phraser } from '../../src/main/dee/phrasing.js';
import { answerQuestion } from '../../src/core/dee/chat/answer.js';

const binary = process.env.DEE_SMOKE_BINARY;
const model = process.env.DEE_SMOKE_MODEL;
const outFile = process.env.DEE_SMOKE_OUT;

const lines: string[] = [];
const log = (s: string): void => {
  lines.push(s);
  console.log(s);
};

const grade = (severity: string, evLossBb: number, principle: string | null, needed?: number, had?: number) =>
  needed === undefined ? { severity, evLossBb, principle } : { severity, evLossBb, principle, price: severity === 'free' ? undefined : { needed, had }, spot: { needed, had } };
const HANDS = [
  [{ street: 'flop', action: 'fold', pot: 225, toCall: 75, grade: grade('serious', 2.94, 'pot odds', 0.25, 0.74) }],
  [{ street: 'river', action: 'call', pot: 1000, toCall: 450, grade: grade('notable', 1.2, 'pot odds', 0.31, 0.22) }],
  [{ street: 'turn', action: 'fold', pot: 300, toCall: 0, grade: grade('serious', 3.1, 'value or bluff') }],
  [{ street: 'river', action: 'check', pot: 600, toCall: 0, grade: grade('notable', 0.8, 'value or bluff') }],
  [{ street: 'flop', action: 'raise', pot: 300, toCall: 100, grade: grade('serious', 2.2, 'ranges', 0.25, 0.12) }],
  [{ street: 'river', action: 'call', pot: 1000, toCall: 450, grade: grade('free', 0.1, null, 0.31, 0.34) }],
];
const QUESTIONS = ['Explain this hand', 'What was my mistake?', 'What was the price?', 'What is a kicker?', 'What is SPR?', 'What is equity?',
  'Does a flush beat a straight?', 'hand rankings', 'who acts first', 'What is price held?', 'How does the streak work?', 'What is 50 into 100?',
  'What is a c-bet?', 'How does a side pot work?', 'What are chips for?', 'Who are you?'];

it.skipIf(!binary || !model)('real-model phrasing smoke', async () => {
  const sidecar = new LlamaSidecar({ binary: binary!, model: model! }, 'smoke');
  const phraser = new Phraser(() => sidecar);
  const t0 = Date.now();
  await sidecar.start();
  log(`sidecar ready in ${Date.now() - t0} ms (cold start, model load)`);

  const seen = new Set<string>();
  const results: { ms: number; source: string; reason: string | null }[] = [];
  for (const decisions of HANDS) {
    for (const q of QUESTIONS) {
      const a = answerQuestion(q, { phase: 'after-hand', lastHand: { handNumber: 1, decisions }, study: null, phrasingInstalled: true } as never);
      const key = `${a.templateId}|${JSON.stringify(a.slots)}`;
      if (!a.phrase || seen.has(key)) continue;
      seen.add(key);
      const r = await phraser.phrase({ templateId: a.templateId, slots: a.slots });
      results.push({ ms: r.ms, source: r.source, reason: r.reason });
      log(`[${r.source}${r.reason ? ` ${r.reason}` : ''}] ${r.ms} ms ${a.templateId}`);
      log(`  script: ${a.text}`);
      if (r.source === 'model') log(`  model:  ${r.text}`);
    }
  }
  // A second pass is all cache hits.
  const cached = Date.now();
  for (const key of seen) {
    const [templateId, slots] = [key.slice(0, key.indexOf('|')), JSON.parse(key.slice(key.indexOf('|') + 1))];
    await phraser.phrase({ templateId, slots });
  }
  const live = results.filter((r) => r.reason !== 'timeout').map((r) => r.ms).sort((a, b) => a - b);
  const all = results.map((r) => r.ms).sort((a, b) => a - b);
  const q = (xs: number[], p: number): number => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] ?? NaN;
  const count = (f: (r: (typeof results)[number]) => boolean): number => results.filter(f).length;
  log('');
  log(`answers: ${results.length}; shown reworded: ${count((r) => r.source === 'model')}; unchanged: ${count((r) => r.reason === 'unchanged')}; rejected by a check: ${count((r) => (r.reason ?? '').startsWith('rejected'))}; over budget: ${count((r) => r.reason === 'timeout')}; model error: ${count((r) => r.reason === 'model-error')}`);
  log(`latency (all, ms): p50 ${q(all, 0.5)} p95 ${q(all, 0.95)} max ${all[all.length - 1]}; answered within budget: p50 ${q(live, 0.5)} p95 ${q(live, 0.95)}`);
  log(`second pass (${seen.size} cache hits): ${Date.now() - cached} ms total`);
  sidecar.stop();

  // The sandbox egress probe: the same profile the sidecar runs under, around curl.
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-dee-probe-'));
  let probe = 'not run (no sandbox-exec)';
  if (fs.existsSync(SANDBOX_EXEC)) {
    try {
      execFileSync(SANDBOX_EXEC, ['-p', sandboxProfile(runDir), '/usr/bin/curl', '-s', '-m', '5', '-o', '/dev/null', 'https://example.com'], { stdio: 'ignore' });
      probe = 'REACHED THE NETWORK (the sandbox did not hold)';
    } catch (e) {
      probe = `denied (curl exit ${(e as { status?: number }).status})`;
    }
  }
  fs.rmSync(runDir, { recursive: true, force: true });
  log(`sandbox egress probe, curl https://example.com inside the sidecar profile: ${probe}`);
  if (outFile) fs.writeFileSync(outFile, `${lines.join('\n')}\n`);

}, 600_000);
