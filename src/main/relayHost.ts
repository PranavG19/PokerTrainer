/**
 * RELAY HOST — the main-process TLS transport for a multiplayer table (relay protocol v2).
 *
 * WHY TLS + NEWLINE-DELIMITED JSON, NOT WEBSOCKET. The app ships with zero runtime dependencies
 * (package.json `dependencies: []`) and forbids adding npm deps; Node has no built-in WebSocket SERVER,
 * so a WS server would mean either a new dependency or a hand-rolled RFC6455 framing layer. One JSON
 * object per line over `node:tls` uses only built-ins.
 *
 * WHO MAY JOIN (research TECH-MULTIPLAYER §3.2, review R7). The host makes a fresh self-signed
 * certificate per table; the invite link carries its SHA-256 fingerprint and a 128-bit room token. The
 * guest pins the fingerprint, so a man in the middle cannot read the table, and presents the token as its
 * first frame INSIDE TLS, so it never crosses the network in clear and cannot be brute-forced offline.
 * Until that `hello` passes, a socket is not seated and receives nothing but a refusal. A v1 (plaintext)
 * client is recognised by its first byte and told, in its own protocol, to update.
 *
 * WHY THIS IS SAFE UNDER THE NETWORK SEAL. The seal (src/main/network.ts) cancels requests on
 * Electron's sessions; a `node:net` server in the main process is outside that path entirely — the
 * same reason the tutor's `aws` CLI child process can reach Bedrock. This host is only ever started
 * behind an explicit opt-in (like the tutor toggle), so with multiplayer off no socket is ever opened;
 * the main-process network oracle (netOracle.ts) is what observes that.
 *
 * ALL game logic lives in RelayServer (src/core/relayServer.ts), which is transport-agnostic and fully
 * unit-tested. This file only owns the socket: accept a connection, check its hello, frame its bytes
 * into JSON lines, hand each to the server, and write the server's Outbound[] back to the right sockets.
 * The framing is extracted into pure helpers so the part that has logic is testable without a server.
 */

import * as crypto from 'node:crypto';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { RelayServer, type Outbound } from '../core/relayServer.js';
import { PROTOCOL_VERSION, type ClientMessage, type HelloMessage, type PlayerId, type ServerMessage } from '../core/multiplayer.js';
import type { ActionKind } from '../core/table.js';

/** The engine's action kinds, used to reject an unknown kind before it reaches the room. */
const ACTION_KINDS: readonly ActionKind[] = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];

/**
 * The largest a single newline-delimited frame is ever allowed to be. Every message on this wire is a
 * small JSON object (a client action, or a redacted room view for at most six seats) — well under a
 * kilobyte in practice — so 64 KB is a generous ceiling. WHY THIS EXISTS: the receive loop accumulates
 * bytes into `buffer` until a '\n' arrives. A peer (the host binds 0.0.0.0, so any LAN machine) that
 * never sends a newline, or sends a colossal line, would otherwise grow that buffer without bound and
 * exhaust main-process memory / crash the app. Past this cap the frame is rejected and the socket
 * destroyed. The count is in UTF-16 code units, a safe over-approximation of byte length for JSON.
 */
export const MAX_MESSAGE_BYTES: number = 64 * 1024;

/** The largest number of simultaneous sockets a single relay host will hold open. A hostile LAN peer
 *  could otherwise open connections without bound; each accepted socket carries its own receive buffer,
 *  so capping the count bounds that memory too. Generous relative to the 2–6 seats a real table uses. */
export const MAX_CONNECTIONS: number = 32;

/** How long a socket may sit between connecting and a valid hello before it is dropped. */
export const HELLO_TIMEOUT_MS = 5_000;

/**
 * Bad invite tokens one remote address may present before it is refused for the rest of the table. The
 * token is 128 bits, so guessing is hopeless anyway (one try per TLS handshake); this keeps a scanner
 * from filling the connection slots.
 */
export const MAX_TOKEN_FAILURES = 5;

/**
 * Sockets one remote address may hold open before its hello. Without it a peer with no token could
 * hold every connection slot by reconnecting each HELLO_TIMEOUT_MS (review A8). Seated players do not
 * count, so guests behind one address are only limited while they are still connecting.
 */
export const MAX_HANDSHAKING_PER_ADDRESS = 4;

/** What a v1 (plaintext) client is told, in v1's own `error` frame, so it can show the user why. */
export const V1_REFUSAL =
  `This table uses Offsuit relay protocol v${PROTOCOL_VERSION} (encrypted invite links). ` +
  'Update Offsuit on this computer, then join with the invite link.';

export function versionMismatch(theirs: unknown): string {
  return (
    `This table runs relay protocol v${PROTOCOL_VERSION} and your app sent v${String(theirs)}. ` +
    'Update both apps to the same Offsuit version.'
  );
}

export const BAD_TOKEN = 'This invite is not valid for this table. Ask the host for a fresh invite link.';

/**
 * Split a growing receive buffer into complete newline-delimited lines, returning the finished lines
 * and the trailing remainder (an incomplete line still arriving). Pure: no socket, so a test can drive
 * partial/joined chunks directly. A line is complete when a '\n' terminates it; '\r' is trimmed so a
 * CRLF client works too.
 */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n');
  const rest = parts.pop() ?? '';
  const lines = parts.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line)).filter((l) => l.length > 0);
  return { lines, rest };
}

/**
 * Frame a growing receive buffer while enforcing a maximum frame size. Returns the complete lines, the
 * still-arriving remainder, and `overflow` — true when a single frame (a complete line, or the partial
 * tail that has not yet seen its '\n') exceeds `maxBytes`. Pure, so a test drives oversized input
 * directly. The caller MUST check `overflow` first and drop the connection: an overflowing buffer is a
 * buggy or hostile peer, and continuing to accumulate it is the unbounded-memory bug this guards.
 */
export function frameChunk(
  buffer: string,
  maxBytes: number = MAX_MESSAGE_BYTES,
): { lines: string[]; rest: string; overflow: boolean } {
  const { lines, rest } = splitLines(buffer);
  const overflow = rest.length > maxBytes || lines.some((line) => line.length > maxBytes);
  return { lines, rest, overflow };
}

/**
 * Parse one received line into a ClientMessage, or null if it is not a valid message. Defensive: a
 * malformed line from a hostile or buggy client must never throw into the socket handler — it is
 * dropped and the connection stays up.
 */
export function parseClientMessage(line: string): ClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.type === 'leave') return { type: 'leave' };
  if (record.type === 'deal') return { type: 'deal' };
  if (record.type === 'action') {
    const action = record.action;
    if (typeof action !== 'object' || action === null) return null;
    const kind = (action as Record<string, unknown>).kind;
    const amount = (action as Record<string, unknown>).amount;
    if (!ACTION_KINDS.includes(kind as ActionKind)) return null;
    return {
      type: 'action',
      // kind is one of the engine's ActionKinds; RelayServer re-validates that it is LEGAL for the
      // current spot, so this only needs to confirm it is a known kind and carry an optional amount.
      action: { kind: kind as ActionKind, ...(typeof amount === 'number' ? { amount } : {}) },
    };
  }
  // The deal handshake: shapes only here; RelayServer checks the hashes and that a deal is waiting.
  const hand = record.hand;
  const nonce = record.nonce;
  if (!Number.isInteger(hand) || typeof nonce !== 'string') return null;
  if (record.type === 'entropy-commit' && typeof record.commitment === 'string') {
    return { type: 'entropy-commit', hand: hand as number, nonce, commitment: record.commitment };
  }
  if (record.type === 'entropy-reveal' && typeof record.entropy === 'string') {
    return { type: 'entropy-reveal', hand: hand as number, nonce, entropy: record.entropy };
  }
  return null;
}

/** Parse the first frame: a hello, or null. The version and token are judged by the caller. */
export function parseHello(line: string): HelloMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.type !== 'hello') return null;
  return {
    type: 'hello',
    v: typeof record.v === 'number' ? record.v : -1,
    token: typeof record.token === 'string' ? record.token : '',
    name: typeof record.name === 'string' ? record.name : 'Player',
  };
}

/** Constant-time comparison of a presented token against the room's, both base64url. */
export function tokenMatches(expected: string, presented: string): boolean {
  const a = Buffer.from(expected, 'base64url');
  const b = Buffer.from(presented, 'base64url');
  return a.length === 16 && b.length === a.length && crypto.timingSafeEqual(a, b);
}

/** Serialize one outbound message to a wire line (JSON + newline). */
export function encodeLine(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}

export interface RelayHost {
  /** The port the server is listening on (useful when 0 was passed to get an ephemeral port). */
  readonly port: number;
  /**
   * Route a batch of server outputs to their recipients — remote players' to their sockets, the
   * in-process local player's to its callback. The host session calls this after driving the server
   * on the LOCAL player's behalf (its own action/deal), so a host action reaches the remote players
   * too, not just the host's own UI.
   */
  deliver(outbound: Outbound[]): void;
  /** Stop the server and drop every connection. */
  close(): Promise<void>;
}

export interface RelayHostOptions {
  readonly server: RelayServer;
  /** 0 (default) asks the OS for an ephemeral port; a fixed port is used as given. */
  readonly port?: number;
  /** Bind address; defaults to loopback so the relay is not exposed off-machine unless asked. */
  readonly host?: string;
  /** The table's certificate and key (selfSignedCert.ts). */
  readonly tls: { readonly key: string; readonly cert: string };
  /** The room token, base64url of 16 random bytes; the guest's hello must carry it. */
  readonly token: string;
  readonly helloTimeoutMs?: number;
  /** How often the server's entropy deadline is checked. */
  readonly tickMs?: number;
  readonly onListening?: (port: number) => void;
  /**
   * An in-process player (the local HOST seat) that has no socket. When set, any broadcast the server
   * addresses to `localDelivery.playerId` is handed to `localDelivery.deliver` instead of looked up in
   * the socket map — otherwise a broadcast triggered by a REMOTE player's activity (which routes
   * through this deliver()) would silently drop the local host's own view.
   */
  readonly localDelivery?: { readonly playerId: PlayerId; readonly deliver: (message: ServerMessage) => void };
}

/**
 * Start a TLS relay host wrapping a RelayServer. Each socket that passes the hello is a player; its id
 * is derived from the socket so disconnects map back to the right seat. Returns once listening.
 */
export function createRelayHost(options: RelayHostOptions): Promise<RelayHost> {
  const { server } = options;
  const sockets = new Map<PlayerId, tls.TLSSocket>();
  /** Every accepted raw socket, seated or still handshaking, so close() and the cap see them all. */
  const open = new Set<net.Socket>();
  const failures = new Map<string, number>();
  /** Sockets per remote address that have not yet passed their hello. */
  const handshaking = new Map<string, number>();
  const settle = (remote: string): void => {
    const n = (handshaking.get(remote) ?? 1) - 1;
    if (n <= 0) handshaking.delete(remote);
    else handshaking.set(remote, n);
  };
  const secureContext = tls.createSecureContext({ key: options.tls.key, cert: options.tls.cert, minVersion: 'TLSv1.3' });
  const helloTimeoutMs = options.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
  let nextId = 0;

  /** Deliver a batch of server outputs to the sockets they are addressed to — or to the in-process
   *  local player's callback when one is configured for that id. */
  const deliver = (outbound: Outbound[]): void => {
    for (const item of outbound) {
      if (options.localDelivery !== undefined && item.to === options.localDelivery.playerId) {
        options.localDelivery.deliver(item.message);
        continue;
      }
      const socket = sockets.get(item.to);
      if (socket === undefined || socket.destroyed) continue;
      if (item.close) refuse(socket, item.message.type === 'error' ? item.message.reason : 'removed from the table');
      else socket.write(encodeLine(item.message));
    }
  };

  /** Refuse a socket with one error frame and close it. */
  const refuse = (socket: net.Socket | tls.TLSSocket, reason: string): void => {
    socket.end(encodeLine({ type: 'error', reason }));
    setTimeout(() => socket.destroy(), 1000).unref();
  };

  const onSecure = (secure: tls.TLSSocket, remote: string, helloTimer: NodeJS.Timeout, admitted: () => void): void => {
    secure.setEncoding('utf8');
    let buffer = '';
    let playerId: PlayerId | null = null;

    secure.on('data', (chunk: string) => {
      buffer += chunk;
      const { lines, rest, overflow } = frameChunk(buffer);
      if (overflow) {
        // Oversized frame: tell the peer, then drop it. Leaving the socket up would let it keep feeding
        // an unbounded buffer — the exact main-process memory-exhaustion this cap exists to stop.
        refuse(secure, 'message too large');
        return;
      }
      buffer = rest;
      for (const line of lines) {
        if (secure.destroyed || secure.writableEnded) return;
        if (playerId === null) {
          // The first frame decides everything: nothing is seated or sent before a valid hello.
          const hello = parseHello(line);
          if (hello === null) return refuse(secure, 'expected a hello');
          if (hello.v !== PROTOCOL_VERSION) return refuse(secure, versionMismatch(hello.v));
          if (!tokenMatches(options.token, hello.token)) {
            failures.set(remote, (failures.get(remote) ?? 0) + 1);
            return refuse(secure, BAD_TOKEN);
          }
          clearTimeout(helloTimer);
          admitted();
          playerId = `p${nextId++}`;
          sockets.set(playerId, secure);
          secure.write(encodeLine({ type: 'welcome', v: PROTOCOL_VERSION }));
          deliver(server.connect(playerId, hello.name));
          continue;
        }
        const message = parseClientMessage(line);
        if (message === null) {
          deliver([{ to: playerId, message: { type: 'error', reason: 'malformed message' } }]);
          continue;
        }
        deliver(server.message(playerId, message));
      }
    });

    const drop = (): void => {
      if (playerId === null || !sockets.has(playerId)) return;
      sockets.delete(playerId);
      deliver(server.disconnect(playerId));
    };
    secure.on('close', drop);
    secure.on('error', drop);
  };

  const raw = net.createServer({ pauseOnConnect: true }, (socket) => {
    const remote = socket.remoteAddress ?? '';
    // Refuse past the cap, or a remote that keeps presenting bad tokens, before any handshake work.
    if (
      open.size >= MAX_CONNECTIONS ||
      (failures.get(remote) ?? 0) >= MAX_TOKEN_FAILURES ||
      (handshaking.get(remote) ?? 0) >= MAX_HANDSHAKING_PER_ADDRESS
    ) {
      socket.destroy();
      return;
    }
    open.add(socket);
    handshaking.set(remote, (handshaking.get(remote) ?? 0) + 1);
    let counted = true;
    const admitted = (): void => {
      if (counted) settle(remote);
      counted = false;
    };
    socket.on('close', () => {
      open.delete(socket);
      admitted();
    });
    socket.on('error', () => socket.destroy());
    const helloTimer = setTimeout(() => socket.destroy(), helloTimeoutMs);
    helloTimer.unref();
    socket.once('data', (first: Buffer) => {
      socket.pause();
      socket.unshift(first);
      // A TLS record starts with 0x16 (handshake). Anything else is a v1 plaintext client (its first
      // byte is '{') or noise: answer in v1's framing so an old app can say why, then close.
      if (first[0] !== 0x16) {
        refuse(socket, V1_REFUSAL);
        return;
      }
      const secure = new tls.TLSSocket(socket, { isServer: true, secureContext });
      secure.on('secure', () => onSecure(secure, remote, helloTimer, admitted));
      secure.on('error', () => socket.destroy());
    });
    socket.resume();
  });

  return new Promise<RelayHost>((resolve, reject) => {
    raw.on('error', reject);
    raw.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      const address = raw.address();
      const port = typeof address === 'object' && address !== null ? address.port : (options.port ?? 0);
      options.onListening?.(port);
      // The entropy deadline lives in the server; the transport only gives it a clock tick.
      const ticker = setInterval(() => deliver(server.tick()), options.tickMs ?? 500);
      ticker.unref();
      resolve({
        port,
        deliver,
        close: () =>
          new Promise<void>((res) => {
            clearInterval(ticker);
            for (const socket of open) socket.destroy();
            open.clear();
            sockets.clear();
            raw.close(() => res());
          }),
      });
    });
  });
}
