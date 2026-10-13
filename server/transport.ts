/**
 * TRANSPORT — the online server's TLS listener: who may connect, how fast, and the sign-in handshake.
 *
 * Built like the LAN relay host (src/main/relayHost.ts): a raw `node:net` server that screens each socket
 * BEFORE any TLS work, then a TLS 1.3 socket, then one JSON object per line. Only built-in modules.
 *
 * WHAT A STRANGER CAN DO, AND WHAT IT COSTS THEM:
 *   - Open sockets: MAX_PER_ADDRESS at once and ATTEMPTS_PER_MINUTE per address, MAX_CONNECTIONS in all.
 *   - Stall: a socket must sign in within HELLO_MS, and a signed-in one that sends nothing (not even the
 *     client's ping) for IDLE_MS is closed.
 *   - Send garbage or floods: a frame over MAX_CLIENT_FRAME closes the socket at once; each connection has
 *     a token bucket (FRAMES_PER_SECOND, BURST); malformed or over-rate frames are strikes, and STRIKES
 *     of them close it. Every frame is parsed by core/online/protocol.ts, which accepts only known shapes.
 *   - Read slowly to make the server buffer: a socket with more than MAX_BUFFERED bytes unsent is closed.
 *   - Guess keys: a signature is checked against a fresh nonce and this TLS session's keying material, so
 *     there is nothing to replay; AUTH_FAILURES bad signatures from one address block it for BLOCK_MS.
 *
 * Addresses are held in memory only, for these limits, and never logged or stored.
 */

import * as crypto from 'node:crypto';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { splitLines } from '../src/main/relayHost.js';
import { verifyAuth } from '../src/main/onlineAuth.js';
import {
  MAX_CLIENT_FRAME,
  ONLINE_PROTO,
  ONLINE_VERSION,
  parseAuth,
  parseHello,
  parseOnlineFrame,
  PING_MS,
  type WelcomeFrame,
} from '../src/core/online/protocol.js';
import { jsonLog, pseudonym, type Log } from './log.js';
import { DEFAULT_LIMITS, DEFAULT_TIMING, Lobby, type Conn, type LobbyLimits, type LobbyTiming } from './lobby.js';
import { Rankings } from './rankings.js';
import { Store } from './store.js';

export interface TransportLimits {
  readonly maxConnections: number;
  readonly maxPerAddress: number;
  readonly attemptsPerMinute: number;
  readonly helloMs: number;
  readonly idleMs: number;
  readonly framesPerSecond: number;
  readonly burst: number;
  readonly strikes: number;
  readonly maxBuffered: number;
  readonly authFailures: number;
  readonly blockMs: number;
}

export const TRANSPORT_LIMITS: TransportLimits = {
  maxConnections: 4000,
  maxPerAddress: 8,
  attemptsPerMinute: 30,
  helloMs: 10_000,
  idleMs: 3 * PING_MS,
  framesPerSecond: 10,
  burst: 30,
  strikes: 20,
  maxBuffered: 2 * 1024 * 1024,
  authFailures: 10,
  blockMs: 10 * 60_000,
};

export interface OnlineServerOptions {
  readonly stateDir: string;
  readonly tls: { readonly key: string; readonly cert: string };
  readonly port?: number;
  /** Defaults to loopback; the systemd unit passes 0.0.0.0. */
  readonly host?: string;
  readonly log?: Log;
  readonly now?: () => number;
  readonly timing?: Partial<LobbyTiming>;
  readonly lobbyLimits?: Partial<LobbyLimits>;
  readonly limits?: Partial<TransportLimits>;
  /** How often the rooms' clocks run. */
  readonly tickMs?: number;
}

export interface OnlineServer {
  readonly port: number;
  readonly lobby: Lobby;
  readonly rankings: Rankings;
  readonly store: Store;
  /** Swap the certificate (SIGHUP after a renewal); open connections keep theirs. */
  reloadTls(tlsFiles: { readonly key: string; readonly cert: string }): void;
  stats(): { connections: number; signedIn: number; rooms: number; seated: number };
  /** Grade everything queued and write the store. */
  flush(): Promise<void>;
  close(): Promise<void>;
}

/** A token bucket. */
class Bucket {
  private tokens: number;
  private at: number;
  constructor(
    private readonly rate: number,
    private readonly cap: number,
    now: number,
  ) {
    this.tokens = cap;
    this.at = now;
  }
  take(now: number): boolean {
    this.tokens = Math.min(this.cap, this.tokens + ((now - this.at) / 1000) * this.rate);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export async function startOnlineServer(options: OnlineServerOptions): Promise<OnlineServer> {
  const log = options.log ?? jsonLog();
  const now = options.now ?? Date.now;
  const limits: TransportLimits = { ...TRANSPORT_LIMITS, ...options.limits };
  const store = Store.open(options.stateDir);
  const rankings = new Rankings(store, log, now);
  const lobby = new Lobby(store, rankings, log, now, { ...DEFAULT_TIMING, ...options.timing }, { ...DEFAULT_LIMITS, ...options.lobbyLimits });
  let secureContext = tls.createSecureContext({ key: options.tls.key, cert: options.tls.cert, minVersion: 'TLSv1.3' });

  const open = new Set<net.Socket>();
  const perAddress = new Map<string, number>();
  const attempts = new Map<string, Bucket>();
  const authFailures = new Map<string, { count: number; until: number }>();
  /** The live connection of each signed-in key. */
  const signedIn = new Map<string, { conn: Conn; socket: tls.TLSSocket }>();

  const netTag = (address: string): string => pseudonym(store.logSalt, `net:${address}`);

  const raw = net.createServer({ pauseOnConnect: true }, (socket) => {
    const address = socket.remoteAddress ?? '';
    const t = now();
    const bucket = attempts.get(address) ?? new Bucket(limits.attemptsPerMinute / 60, limits.attemptsPerMinute, t);
    attempts.set(address, bucket);
    const blocked = authFailures.get(address);
    if (
      open.size >= limits.maxConnections ||
      (perAddress.get(address) ?? 0) >= limits.maxPerAddress ||
      !bucket.take(t) ||
      (blocked !== undefined && blocked.count >= limits.authFailures && t < blocked.until)
    ) {
      socket.destroy();
      return;
    }
    open.add(socket);
    perAddress.set(address, (perAddress.get(address) ?? 0) + 1);
    socket.on('close', () => {
      open.delete(socket);
      const n = (perAddress.get(address) ?? 1) - 1;
      if (n <= 0) perAddress.delete(address);
      else perAddress.set(address, n);
    });
    socket.on('error', () => socket.destroy());
    const helloTimer = setTimeout(() => socket.destroy(), limits.helloMs);
    helloTimer.unref();
    const secure = new tls.TLSSocket(socket, { isServer: true, secureContext });
    secure.on('error', () => socket.destroy());
    secure.on('secure', () => serve(secure, address, helloTimer));
    socket.resume();
  });

  function serve(secure: tls.TLSSocket, address: string, helloTimer: NodeJS.Timeout): void {
    secure.setEncoding('utf8');
    secure.setNoDelay(true);
    let buffer = '';
    let stage: 'hello' | 'auth' | 'ready' = 'hello';
    let key = '';
    let nonce = '';
    let conn: Conn | null = null;
    let strikes = 0;
    const bucket = new Bucket(limits.framesPerSecond, limits.burst, now());

    const send = (frame: object): void => {
      if (secure.destroyed || secure.writableEnded) return;
      if (secure.writableLength > limits.maxBuffered) {
        secure.destroy();
        return;
      }
      secure.write(`${JSON.stringify(frame)}\n`);
    };
    const bye = (reason: string): void => {
      if (secure.destroyed || secure.writableEnded) return;
      secure.end(`${JSON.stringify({ type: 'bye', reason })}\n`);
      setTimeout(() => secure.destroy(), 1000).unref();
    };
    const strike = (): void => {
      strikes += 1;
      if (strikes >= limits.strikes) {
        log('conn.strikes', conn ? { who: lobby.tag(key) } : {});
        bye('Too many messages this server could not use.');
      }
    };

    const handle = (line: string): void => {
      if (stage === 'hello') {
        const hello = parseHello(line);
        if (hello === null || hello.proto !== ONLINE_PROTO) {
          // A LAN relay client (v2 hello with a token) reached an online server: say so in its terms.
          return bye('This is an Offsuit online server. Use Play online, not an invite link.');
        }
        if (hello.v !== ONLINE_VERSION) return bye(`This server speaks online protocol v${ONLINE_VERSION} and your app sent v${hello.v}. Update Offsuit.`);
        key = hello.key;
        nonce = crypto.randomBytes(32).toString('hex');
        stage = 'auth';
        return send({ type: 'challenge', nonce });
      }
      if (stage === 'auth') {
        const auth = parseAuth(line);
        if (auth === null || !verifyAuth(secure, nonce, key, auth.sig)) {
          const t = now();
          const row = authFailures.get(address);
          const count = row !== undefined && t < row.until ? row.count + 1 : 1;
          authFailures.set(address, { count, until: t + limits.blockMs });
          log('auth.failed', {});
          return bye('Sign-in failed.');
        }
        clearTimeout(helloTimer);
        stage = 'ready';
        secure.setTimeout(limits.idleMs, () => secure.destroy());
        // One live connection per key: a newer sign-in replaces the older (a reconnect after a drop the
        // old socket has not noticed yet), whose seat is held and handed straight to the new one.
        const previous = signedIn.get(key);
        if (previous !== undefined) {
          lobby.detach(previous.conn);
          signedIn.delete(key);
          previous.socket.end(`${JSON.stringify({ type: 'bye', reason: 'Signed in again from another connection.' })}\n`);
          previous.socket.destroy();
        }
        conn = { key, netTag: netTag(address), send };
        signedIn.set(key, { conn, socket: secure });
        // The welcome names the room this key is held in; attach() then resumes it, sending the replayed
        // deal and the state, which must arrive after the welcome.
        const room = lobby.heldRoom(key);
        const welcome: WelcomeFrame = {
          type: 'welcome',
          proto: ONLINE_PROTO,
          v: ONLINE_VERSION,
          keyId: key.slice(0, 10),
          name: store.player(key)?.name ?? null,
          season: rankings.currentSeason(),
          room,
        };
        send(welcome);
        lobby.attach(conn);
        log('auth.ok', { who: lobby.tag(key), resumed: room !== null });
        return;
      }
      const frame = parseOnlineFrame(line);
      if (frame === null) {
        send({ type: 'error', reason: 'That message was not understood.' });
        return strike();
      }
      if (frame.type === 'ping') return;
      if ('id' in frame) {
        const reply = lobby.request(conn!, frame);
        send({ type: 'reply', id: frame.id, ...reply });
        if (frame.type === 'forget' && reply.ok) bye('Your data on this server was deleted.');
        return;
      }
      lobby.roomFrame(conn!, frame);
    };

    secure.on('data', (chunk: string) => {
      buffer += chunk;
      const { lines, rest } = splitLines(buffer);
      if (rest.length > MAX_CLIENT_FRAME || lines.some((l) => l.length > MAX_CLIENT_FRAME)) {
        log('conn.oversized', {});
        bye('Message too large.');
        secure.destroy();
        return;
      }
      buffer = rest;
      for (const line of lines) {
        if (secure.destroyed || secure.writableEnded) return;
        if (stage === 'ready' && !bucket.take(now())) {
          strike();
          continue;
        }
        handle(line);
      }
    });

    const closed = (): void => {
      if (conn === null) return;
      const live = signedIn.get(key);
      if (live !== undefined && live.conn === conn) {
        signedIn.delete(key);
        lobby.detach(conn);
      }
      conn = null;
    };
    secure.on('close', closed);
    secure.on('error', closed);
  }

  const ticker = setInterval(() => lobby.tick(), options.tickMs ?? 250);
  ticker.unref();

  return new Promise<OnlineServer>((resolve, reject) => {
    raw.on('error', reject);
    raw.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      const addr = raw.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : (options.port ?? 0);
      log('server.listening', { port });
      resolve({
        port,
        lobby,
        rankings,
        store,
        reloadTls(files) {
          secureContext = tls.createSecureContext({ key: files.key, cert: files.cert, minVersion: 'TLSv1.3' });
          log('tls.reloaded', {});
        },
        stats: () => ({ connections: open.size, signedIn: signedIn.size, ...lobby.stats() }),
        async flush() {
          await rankings.idle();
          store.close();
        },
        close: () =>
          new Promise<void>((res) => {
            clearInterval(ticker);
            for (const { socket } of signedIn.values()) socket.end(`${JSON.stringify({ type: 'bye', reason: 'The server is restarting. Reconnecting…' })}\n`);
            for (const socket of open) socket.destroy();
            raw.close(() => {
              void rankings.idle().then(() => {
                store.close();
                res();
              });
            });
          }),
      });
    });
  });
}
