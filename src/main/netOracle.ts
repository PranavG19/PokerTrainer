/**
 * MAIN-PROCESS NETWORK ORACLE — test mode only (review R5).
 *
 * WHY. tests/e2e/no-network.spec.ts proves the BROWSER process is silent with a loopback proxy, but
 * `--proxy-server` governs Chromium only. A `node:net`/`node:tls`/`node:http(s)` socket or `fetch` in
 * main, a UDP datagram, a DNS lookup, or a child process like `aws` or `curl` ignores it entirely, so
 * "multiplayer off means no socket" was enforced by the IPC gate but observed by nothing.
 *
 * WHAT. When OFFSUIT_NET_ORACLE names a file, this module (imported first by main.ts) wraps the Node
 * primitives every one of those paths funnels through and appends one JSON line per use to that file:
 *
 *   connect   net.Socket#connect — under net, tls, http, https and fetch alike (IPC paths are marked)
 *   udp       dgram.Socket#send / #connect
 *   dns       dns.lookup / dns.resolve*
 *   listen    net.Server#listen — an inbound surface, recorded so a spec can see a relay was opened
 *   spawn     every child_process entry point, with `network: true` for known network tools
 *
 * The recorder only records; it never blocks, so it cannot change what it observes. Without the
 * environment variable nothing is patched and the module does nothing.
 *
 * NOT SEEN (none is used in main today): `new dns.Resolver()`, `worker_threads` (each worker has its
 * own primitives), and Electron's `net`, which runs on Chromium's stack and is the session seal's job.
 */

import * as dgram from 'node:dgram';
import * as fs from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import * as net from 'node:net';
import * as path from 'node:path';

// An ESM namespace is read-only, so module-level functions are patched on the CommonJS exports object
// (the one the ESM bindings mirror) and pushed through with syncBuiltinESMExports.
const require = createRequire(import.meta.url);

export interface OracleRecord {
  readonly kind: 'connect' | 'udp' | 'dns' | 'listen' | 'spawn';
  readonly target: string;
  /** True for a socket to a filesystem path (IPC), which never leaves the machine. */
  readonly ipc?: boolean;
  /** True for a spawn of a command whose job is network access. */
  readonly network?: boolean;
}

/** Commands that exist to reach the network; spawning one is egress even if no socket is seen here. */
const NETWORK_TOOLS = new Set([
  'aws', 'curl', 'wget', 'nc', 'ncat', 'netcat', 'ssh', 'scp', 'sftp', 'rsync', 'ftp', 'telnet', 'ping',
  'dig', 'nslookup', 'host', 'openssl', 'git', 'npm', 'npx', 'pip', 'brew', 'llama-server', 'ollama',
]);

/** Whether a record is egress: what an offline spec requires to be absent. */
export function isOutbound(record: OracleRecord): boolean {
  if (record.kind === 'connect') return record.ipc !== true;
  if (record.kind === 'spawn') return record.network === true;
  return record.kind === 'udp' || record.kind === 'dns';
}

export function readOracle(file: string): OracleRecord[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as OracleRecord);
}

/** Describe net.Socket#connect's overloaded arguments as a target, and whether it is an IPC path. */
function connectTarget(args: unknown[]): { target: string; ipc: boolean } {
  let first = args[0];
  // net.connect normalises its arguments into [options, cb] with the original array on a symbol.
  if (Array.isArray(first)) first = first[0];
  if (typeof first === 'object' && first !== null) {
    const o = first as { path?: unknown; host?: unknown; port?: unknown };
    if (typeof o.path === 'string') return { target: o.path, ipc: true };
    return { target: `${String(o.host ?? 'localhost')}:${String(o.port)}`, ipc: false };
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return { target: first, ipc: true };
  return { target: `${typeof args[1] === 'string' ? args[1] : 'localhost'}:${String(first)}`, ipc: false };
}

/**
 * Install the recorder. Returns an uninstall function (for unit tests); main never uninstalls.
 * Idempotent per process: a second install is refused rather than double-recording.
 */
export function installNetOracle(file: string): () => void {
  const g = globalThis as { __offsuitNetOracle?: boolean };
  if (g.__offsuitNetOracle) return () => undefined;
  g.__offsuitNetOracle = true;
  const record = (r: OracleRecord): void => {
    try {
      fs.appendFileSync(file, `${JSON.stringify(r)}\n`);
    } catch {
      // The recorder must never break the app it observes.
    }
  };
  const restores: (() => void)[] = [];
  const wrap = <T extends object>(owner: T, name: keyof T & string, observe: (args: unknown[]) => void): void => {
    const original = owner[name] as unknown as (...a: unknown[]) => unknown;
    if (typeof original !== 'function') return;
    const wrapped = function (this: unknown, ...args: unknown[]): unknown {
      observe(args);
      return original.apply(this, args);
    };
    (owner as Record<string, unknown>)[name] = wrapped;
    restores.push(() => {
      (owner as Record<string, unknown>)[name] = original;
    });
  };

  wrap(net.Socket.prototype, 'connect', (args) => record({ kind: 'connect', ...connectTarget(args) }));
  wrap(net.Server.prototype, 'listen', (args) => record({ kind: 'listen', target: JSON.stringify(args[0] ?? null) }));
  const udpTarget = (args: unknown[]): string => {
    const port = args.slice(1).find((a) => typeof a === 'number' && a > 0);
    const address = args.find((a) => typeof a === 'string');
    return `${String(address ?? 'connected')}:${String(port ?? '')}`;
  };
  wrap(dgram.Socket.prototype, 'send', (args) => record({ kind: 'udp', target: udpTarget(args) }));
  wrap(dgram.Socket.prototype, 'connect', (args) => record({ kind: 'udp', target: udpTarget([null, ...args]) }));

  // Module-object functions: patch the CommonJS exports, then push them to the ESM bindings that
  // speech.ts, bedrock.ts and every other `import { spawn }` already linked against.
  const cp = require('node:child_process') as Record<string, unknown>;
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
    wrap(cp, name, (args) => {
      const command = String(args[0] ?? '');
      // Every word of the command line, so `sh -c "curl …"` is caught as well as `curl`.
      const words = [command, ...(Array.isArray(args[1]) ? args[1].map(String) : [])].flatMap((w) => w.split(/[\s;&|()]+/));
      record({ kind: 'spawn', target: command, network: words.some((w) => NETWORK_TOOLS.has(path.basename(w))) });
    });
  }
  const dnsModule = require('node:dns') as Record<string, unknown>;
  const dnsNames = ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveTxt', 'resolveSrv'];
  for (const owner of [dnsModule, dnsModule.promises as Record<string, unknown>]) {
    for (const name of dnsNames) wrap(owner, name, (args) => record({ kind: 'dns', target: String(args[0]) }));
  }
  syncBuiltinESMExports();

  return () => {
    for (const restore of restores.reverse()) restore();
    syncBuiltinESMExports();
    g.__offsuitNetOracle = false;
  };
}

const oracleFile = process.env.OFFSUIT_NET_ORACLE;
if (oracleFile !== undefined && oracleFile !== '') installNetOracle(oracleFile);
