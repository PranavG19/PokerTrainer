/**
 * The Pro tools' heavy work, off main's thread (worker_threads): parsing imported files, the leak report
 * over the whole store, and the push-fold solves. Measured on this Mac: an ICM solve is ~200ms and a
 * 25 MB file parses in seconds, either of which would stall every other IPC call and window event if
 * main ran it. The worker holds no state and no Electron API; main checks the licence before it ever
 * posts a job (gated(), licence.ts), so nothing here is reachable without Pro.
 */

import { parentPort } from 'node:worker_threads';
import { answerShove, parseShoveRequest } from '../core/pro/analysis.js';
import type { ParsedHand, SkipReason } from '../core/pro/handHistory.js';
import { leakReport } from '../core/pro/leaks.js';
import { parseHandHistories } from '../core/pro/parse.js';
import { createHandStore } from './hhStore.js';

export type Job =
  | { readonly kind: 'parse'; readonly texts: readonly string[] }
  | { readonly kind: 'report'; readonly dir: string }
  | { readonly kind: 'shove'; readonly request: unknown };

function run(job: Job): unknown {
  if (job.kind === 'parse') {
    const hands: ParsedHand[] = [];
    const skipped: Partial<Record<SkipReason, number>> = {};
    for (const text of job.texts) {
      const r = parseHandHistories(text);
      for (const h of r.hands) hands.push(h);
      for (const [reason, n] of Object.entries(r.skipCounts) as [SkipReason, number][]) skipped[reason] = (skipped[reason] ?? 0) + n;
    }
    return { hands, skipped };
  }
  if (job.kind === 'report') {
    const store = createHandStore(job.dir);
    return { report: leakReport(store.all()), meta: store.meta(), status: store.status() };
  }
  const request = parseShoveRequest(job.request);
  return request === null ? { invalid: true } : { answer: answerShove(request) };
}

parentPort?.on('message', (msg: { id: number; job: Job }) => {
  try {
    parentPort!.postMessage({ id: msg.id, ok: true, value: run(msg.job) });
  } catch (error) {
    parentPort!.postMessage({ id: msg.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
