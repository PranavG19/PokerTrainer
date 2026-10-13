/**
 * The online server as a plain Node process (Node 22 or later, no dependencies):
 *
 *   node dist-server/server/main.js --state <dir> --cert <fullchain.pem> --key <privkey.pem> [--port 443] [--host 0.0.0.0]
 *   node dist-server/server/main.js --state <dir> --self-signed [--port 8443]
 *
 * `--self-signed` makes (once) and keeps a certificate in the state directory and prints its pin, for a
 * server with no domain: players paste the pin into Settings. With `--cert`/`--key` (Let's Encrypt on the
 * deployed VPS) players need no pin. SIGHUP re-reads the certificate files (certbot's deploy hook sends
 * it after a renewal); SIGTERM and SIGINT close connections, finish grading and write the store.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { issueCertificate } from '../src/main/selfSignedCert.js';
import { certFingerprint } from '../src/main/selfSignedCert.js';
import { createLicenceServer } from '../src/server/licensing/handler.js';
import { licenceServerDepsFromEnv } from '../src/server/licensing/fromEnv.js';
import { jsonLog, type Log } from './log.js';
import { FileLicenceStore } from './licenceStore.js';
import { startOnlineServer } from './transport.js';

interface Args {
  readonly state: string;
  readonly port: number;
  readonly host: string;
  readonly cert?: string;
  readonly key?: string;
  readonly selfSigned: boolean;
  /** Overrides of the per-address limits, for a load test from one machine (all clients share 127.0.0.1). */
  readonly maxPerAddress?: number;
  readonly attemptsPerMinute?: number;
}

export function parseArgs(argv: readonly string[]): Args | { readonly error: string } {
  const value = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const state = value('--state');
  if (state === undefined) return { error: '--state <dir> is required' };
  const port = Number(value('--port') ?? '443');
  if (!Number.isInteger(port) || port < 0 || port > 65535) return { error: '--port must be 0..65535' };
  const selfSigned = argv.includes('--self-signed');
  const cert = value('--cert');
  const key = value('--key');
  if (!selfSigned && (cert === undefined || key === undefined)) return { error: 'give --cert and --key, or --self-signed' };
  const limit = (flag: string): number | undefined => {
    const v = value(flag);
    return v === undefined ? undefined : Number(v);
  };
  return {
    state: path.resolve(state),
    port,
    host: value('--host') ?? '127.0.0.1',
    cert,
    key,
    selfSigned,
    maxPerAddress: limit('--max-per-address'),
    attemptsPerMinute: limit('--attempts-per-minute'),
  };
}

/** PEM text of a DER certificate's first block, for the pin. */
export function pemFingerprint(certPem: string): string {
  const body = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(certPem)?.[1] ?? '';
  return certFingerprint(Buffer.from(body.replace(/\s+/g, ''), 'base64'));
}

function selfSignedFiles(state: string): { key: string; cert: string } {
  const keyFile = path.join(state, 'tls-self-signed.key.pem');
  const certFile = path.join(state, 'tls-self-signed.cert.pem');
  if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) {
    fs.mkdirSync(state, { recursive: true, mode: 0o700 });
    const made = issueCertificate({ commonName: 'Offsuit online server', days: 3650 });
    fs.writeFileSync(keyFile, made.keyPem, { mode: 0o600 });
    fs.writeFileSync(certFile, made.certPem, { mode: 0o600 });
  }
  return { key: fs.readFileSync(keyFile, 'utf8'), cert: fs.readFileSync(certFile, 'utf8') };
}

/**
 * The licence server (PR #24), on when OFFSUIT_LICENCE_ENABLED=1, from the env docs/PAYMENTS-SETUP.md lists
 * (systemd reads it from /etc/offsuit/licence.env). Enabled but incomplete throws with the missing
 * variable's name; main then runs the game with licensing off and logs `licence.failed`.
 */
export function licenceFromEnv(env: NodeJS.ProcessEnv, state: string, log: Log): ReturnType<typeof createLicenceServer> | undefined {
  if (env.OFFSUIT_LICENCE_ENABLED !== '1') {
    log('licence.off', {});
    return undefined;
  }
  const store = new FileLicenceStore(path.join(state, 'licences.json'));
  // The handler's own log lines are its event names and ids, never a key, token or email.
  const handler = createLicenceServer(licenceServerDepsFromEnv(env, store, { log: (line) => log('licence', { line: line.slice(0, 200) }) }));
  log('licence.on', {});
  return handler;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if ('error' in args) {
    process.stderr.write(`offsuit-server: ${args.error}\n`);
    process.exit(2);
  }
  // journald (or a test harness) going away must not take the server down with an EPIPE.
  process.stdout.on('error', () => undefined);
  const log = jsonLog();
  const readTls = (): { key: string; cert: string } =>
    args.selfSigned ? selfSignedFiles(args.state) : { key: fs.readFileSync(args.key!, 'utf8'), cert: fs.readFileSync(args.cert!, 'utf8') };
  const tlsFiles = readTls();
  const limits = {
    ...(args.maxPerAddress !== undefined ? { maxPerAddress: args.maxPerAddress } : {}),
    ...(args.attemptsPerMinute !== undefined ? { attemptsPerMinute: args.attemptsPerMinute } : {}),
  };
  // A licensing fault must not take the tables down: the game starts with licensing off, said loudly.
  let licence: ReturnType<typeof licenceFromEnv>;
  try {
    licence = licenceFromEnv(process.env, args.state, log);
  } catch (error) {
    process.stderr.write(`offsuit-server: licensing is OFF: ${(error as Error).message}\n`);
    log('licence.failed', { reason: (error as Error).message.slice(0, 160) });
    licence = undefined;
  }
  const server = await startOnlineServer({ stateDir: args.state, tls: tlsFiles, port: args.port, host: args.host, log, limits, licence });
  // The pin is the certificate's public fingerprint, not a secret; printing it is how players get it.
  log('server.ready', { port: server.port, pin: pemFingerprint(tlsFiles.cert), selfSigned: args.selfSigned });

  process.on('SIGHUP', () => {
    try {
      server.reloadTls(readTls());
    } catch (error) {
      log('tls.reload_failed', { reason: (error as Error).message.slice(0, 120) });
    }
  });
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    log('server.stopping', {});
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  void main();
}
