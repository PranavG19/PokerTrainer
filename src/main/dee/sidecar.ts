/**
 * The `llama-server` sidecar: the phrasing model in its own process, so a crash in the runtime (Metal, an
 * allocator) ends the child and never main.
 *
 * Containment, all of it measured on the pinned build (b11588):
 *  - **No network.** On macOS the child runs under `sandbox-exec` with a profile that denies every network
 *    operation except a unix socket, and denies file writes outside its own run directory and the system temp
 *    directory. `--offline` stops llama.cpp's own model fetcher; no `-hf` or URL is ever passed.
 *  - **No listener on any port.** It listens on a unix socket in a fresh 0700 temp directory, so nothing on the
 *    machine's TCP stack can reach it, and requests need a per-launch random API key.
 *  - **No extra surface.** No web UI, no `/slots`, no `/props`, no metrics, no tools, no MCP.
 *  - **A minimal environment.** The child gets PATH and HOME only: no proxy variables, no tokens.
 *
 * Determinism: temperature 0 and a fixed seed, so a rewording is the one the model gives every time and the
 * phraser's cache is exact.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PhraseModel, RewriteInput } from './phrasing.js';

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
export const SIDECAR_SEED = 7;
const READY_TIMEOUT_MS = 30_000;

export interface SidecarPaths {
  readonly binary: string;
  readonly model: string;
}

/** The sandbox profile. `runDir` is the only place besides temp the child may write. */
export function sandboxProfile(runDir: string, tmp = os.tmpdir()): string {
  const q = (p: string): string => JSON.stringify(fs.existsSync(p) ? fs.realpathSync(p) : p);
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    '(allow network* (local unix))',
    '(deny file-write*)',
    `(allow file-write* (subpath ${q(runDir)}) (subpath ${q(tmp)}) (literal "/dev/null"))`,
  ].join('\n');
}

/** The server's arguments. Pure, so a test can pin every flag. */
export function sidecarArgs(paths: SidecarPaths, socket: string, apiKeyFile: string): string[] {
  return [
    '-m', paths.model,
    '--host', socket,
    '--api-key-file', apiKeyFile,
    '--offline',
    '--no-webui',
    '--no-slots',
    '-c', '2048',
    '-np', '1',
    '-ngl', '99',
    '--seed', String(SIDECAR_SEED),
    '--temp', '0',
    '--log-disable',
  ];
}

/** The command line actually spawned: under the sandbox on macOS. */
export function sidecarCommand(paths: SidecarPaths, runDir: string, socket: string, keyFile: string): { command: string; args: string[] } {
  const args = sidecarArgs(paths, socket, keyFile);
  if (process.platform === 'darwin' && fs.existsSync(SANDBOX_EXEC)) {
    return { command: SANDBOX_EXEC, args: ['-p', sandboxProfile(runDir), paths.binary, ...args] };
  }
  return { command: paths.binary, args };
}

/** Qwen3's chat template honours "/no_think": the reply carries an empty thinking block, then the line. */
export function chatBody(input: RewriteInput): string {
  return JSON.stringify({
    messages: [
      { role: 'system', content: input.persona },
      { role: 'user', content: `FACTS: ${input.facts.join(' | ')}\nLINE: ${input.scripted} /no_think` },
    ],
    temperature: 0,
    seed: SIDECAR_SEED,
    max_tokens: 160,
    cache_prompt: true,
    stream: false,
  });
}

function request(socket: string, method: string, pathName: string, key: string, body: string | null, signal?: AbortSignal): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: socket, method, path: pathName, signal, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' } },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => {
          data += c;
          if (data.length > 64_000) req.destroy(new Error('response too large'));
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(body ?? undefined);
  });
}

export class LlamaSidecar implements PhraseModel {
  readonly id: string;
  private child: ChildProcess | null = null;
  private runDir: string | null = null;
  private socket = '';
  private key = '';
  private ready: Promise<void> | null = null;
  /** Called when the child exits on its own (a crash), so the service can count restarts. */
  onExit: ((code: number | null) => void) | null = null;

  constructor(private readonly paths: SidecarPaths, id: string) {
    this.id = id;
  }

  get running(): boolean {
    return this.child !== null;
  }

  /** Start once; concurrent callers share the same readiness promise. */
  start(): Promise<void> {
    this.ready ??= this.launch().catch((e: unknown) => {
      this.stop();
      throw e;
    });
    return this.ready;
  }

  private async launch(): Promise<void> {
    // A short path: macOS caps a unix socket path at 104 bytes, and userData can be deep.
    this.runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-dee-'));
    fs.chmodSync(this.runDir, 0o700);
    this.socket = path.join(this.runDir, 'dee.sock');
    this.key = crypto.randomBytes(24).toString('hex');
    const keyFile = path.join(this.runDir, 'key');
    fs.writeFileSync(keyFile, `${this.key}\n`, { mode: 0o600 });
    const { command, args } = sidecarCommand(this.paths, this.runDir, this.socket, keyFile);
    const child = spawn(command, args, {
      stdio: 'ignore',
      env: { PATH: '/usr/bin:/bin', HOME: this.runDir, TMPDIR: os.tmpdir() },
      detached: false,
    });
    this.child = child;
    child.on('exit', (code) => {
      const wasOurs = this.child === child;
      this.child = null;
      this.ready = null;
      if (wasOurs) this.onExit?.(code);
    });
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.child === null) throw new Error('sidecar exited during start');
      if (fs.existsSync(this.socket)) {
        try {
          const r = await request(this.socket, 'GET', '/health', this.key, null);
          if (r.status === 200) return;
        } catch {
          // Not accepting yet.
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('sidecar did not become ready');
  }

  async rewrite(input: RewriteInput, signal: AbortSignal): Promise<string> {
    await this.start();
    const r = await request(this.socket, 'POST', '/v1/chat/completions', this.key, chatBody(input), signal);
    if (r.status !== 200) throw new Error(`sidecar ${r.status}`);
    const parsed = JSON.parse(r.body) as { choices?: { message?: { content?: unknown } }[] };
    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('sidecar reply had no text');
    return content;
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    this.ready = null;
    if (child && child.exitCode === null) child.kill('SIGTERM');
    if (this.runDir) fs.rmSync(this.runDir, { recursive: true, force: true });
    this.runDir = null;
  }
}
