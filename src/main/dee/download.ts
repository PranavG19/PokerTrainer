/**
 * The one network call "Smarter phrasing" makes: fetching the pinned files, only after the learner's consent
 * click. Main process, `node:https` (never Chromium's stack, so the session seal in network.ts stays total and
 * the main-process oracle sees every socket).
 *
 * Integrity: every URL, the first and each redirect, must be on the manifest's host list over HTTPS; the body is
 * streamed to a `.part` file while hashing; a body longer than the pinned size is cut off; the file is renamed
 * into place only when its size and sha256 both match. Anything else deletes the partial file.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import { downloadUrlAllowed, type PinnedAsset } from './manifest.js';

export interface Progress {
  readonly received: number;
  readonly total: number;
}

export class DownloadError extends Error {
  constructor(readonly code: 'host' | 'redirects' | 'status' | 'size' | 'sha256' | 'aborted' | 'network', detail: string) {
    super(`${code}: ${detail}`);
  }
}

const MAX_REDIRECTS = 5;

function get(url: string, signal: AbortSignal): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { signal, headers: { 'user-agent': 'Offsuit', accept: '*/*' } }, resolve);
    req.on('error', (e) => reject(signal.aborted ? new DownloadError('aborted', 'cancelled') : new DownloadError('network', e.message)));
  });
}

/** Follow redirects, each one checked against the host list, to the response that carries the body. */
async function open(url: string, signal: AbortSignal, testLoopback: boolean): Promise<http.IncomingMessage> {
  let at = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!downloadUrlAllowed(at, testLoopback)) throw new DownloadError('host', new URL(at).host);
    const res = await get(at, signal);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      at = new URL(res.headers.location, at).toString();
      continue;
    }
    if (status !== 200) {
      res.resume();
      throw new DownloadError('status', String(status));
    }
    return res;
  }
  throw new DownloadError('redirects', String(MAX_REDIRECTS));
}

/**
 * Download one pinned asset to `dest`. Resolves once the verified file is in place; rejects (with the partial
 * file removed) on any host, size or hash mismatch, on cancel, or on a network error.
 */
export async function fetchVerified(
  asset: PinnedAsset,
  dest: string,
  opts: { signal: AbortSignal; onProgress?: (p: Progress) => void; testLoopback?: boolean },
): Promise<void> {
  const part = `${dest}.part`;
  fs.rmSync(part, { force: true });
  try {
    const res = await open(asset.url, opts.signal, opts.testLoopback ?? false);
    const declared = Number(res.headers['content-length'] ?? NaN);
    if (Number.isFinite(declared) && declared !== asset.size) {
      res.resume();
      throw new DownloadError('size', `declared ${declared}, pinned ${asset.size}`);
    }
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(part, { mode: 0o600 });
    let received = 0;
    let lastTick = 0;
    await new Promise<void>((resolve, reject) => {
      const fail = (e: Error): void => {
        res.destroy();
        out.destroy();
        reject(e);
      };
      res.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > asset.size) return fail(new DownloadError('size', `over ${asset.size}`));
        hash.update(chunk);
        if (!out.write(chunk)) {
          res.pause();
          out.once('drain', () => res.resume());
        }
        const now = Date.now();
        if (now - lastTick > 100) {
          lastTick = now;
          opts.onProgress?.({ received, total: asset.size });
        }
      });
      res.on('error', (e) => fail(opts.signal.aborted ? new DownloadError('aborted', 'cancelled') : new DownloadError('network', e.message)));
      res.on('aborted', () => fail(new DownloadError(opts.signal.aborted ? 'aborted' : 'network', 'connection closed')));
      res.on('end', () => out.end(() => resolve()));
      out.on('error', (e) => fail(new DownloadError('network', e.message)));
    });
    opts.onProgress?.({ received, total: asset.size });
    if (received !== asset.size) throw new DownloadError('size', `got ${received}, pinned ${asset.size}`);
    const digest = hash.digest('hex');
    if (digest !== asset.sha256) throw new DownloadError('sha256', `got ${digest.slice(0, 12)}…`);
    fs.renameSync(part, dest);
  } catch (e) {
    fs.rmSync(part, { force: true });
    if (opts.signal.aborted && !(e instanceof DownloadError && e.code !== 'aborted')) throw new DownloadError('aborted', 'cancelled');
    throw e;
  }
}

/** Hash a file already on disk (re-verifying the runtime before each start). */
export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (c) => hash.update(c))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}
