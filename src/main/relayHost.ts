/**
 * RELAY HOST — the main-process TCP transport for a local multiplayer table.
 *
 * WHY TCP + NEWLINE-DELIMITED JSON, NOT WEBSOCKET. The app ships with zero runtime dependencies
 * (package.json `dependencies: []`) and forbids adding npm deps; Node has a global WebSocket CLIENT but
 * no built-in WebSocket SERVER, so a WS server would mean either a new dependency or a hand-rolled
 * RFC6455 framing layer. For a local-network relay a plain `node:net` socket carrying one JSON object
 * per line is entirely sufficient and uses only built-ins. A browser/cloud client (Phase 4) can add a
 * WS bridge then; this layer stays a thin shell.
 *
 * WHY THIS IS SAFE UNDER THE NETWORK SEAL. The seal (src/main/network.ts) cancels requests on
 * Electron's sessions; a `node:net` server in the main process is outside that path entirely — the
 * same reason the tutor's `aws` CLI child process can reach Bedrock. This host is only ever started
 * behind an explicit opt-in (like the tutor toggle), so with multiplayer off no socket is ever opened
 * and tests/e2e/no-network.spec.ts is unaffected.
 *
 * ALL game logic lives in RelayServer (src/core/relayServer.ts), which is transport-agnostic and fully
 * unit-tested. This file only owns the socket: accept a connection, frame its bytes into JSON lines,
 * hand each to the server, and write the server's Outbound[] back to the right sockets. The framing is
 * extracted into pure helpers so the part that has logic is testable without standing up a server.
 */

import * as net from 'node:net';
import { RelayServer, type Outbound } from '../core/relayServer.js';
import type { ClientMessage, PlayerId, ServerMessage } from '../core/multiplayer.js';
import type { ActionKind } from '../core/table.js';

/** The engine's action kinds, used to reject an unknown kind before it reaches the room. */
const ACTION_KINDS: readonly ActionKind[] = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];

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
  if (record.type === 'join') {
    return { type: 'join', name: typeof record.name === 'string' ? record.name : 'Player' };
  }
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
  return null;
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
  /** Called after the first/next hand should be dealt — the transport exposes dealNext to a control path. */
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
 * Start a TCP relay host wrapping a RelayServer. Each accepted socket is a player; its id is derived
 * from the socket so disconnects map back to the right seat. Returns once the server is listening.
 */
export function createRelayHost(options: RelayHostOptions): Promise<RelayHost> {
  const { server } = options;
  const sockets = new Map<PlayerId, net.Socket>();
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
      if (socket !== undefined && !socket.destroyed) socket.write(encodeLine(item.message));
    }
  };

  const tcp = net.createServer((socket) => {
    const playerId: PlayerId = `p${nextId++}`;
    sockets.set(playerId, socket);
    socket.setEncoding('utf8');
    let buffer = '';
    // A player's first message must be a join to establish their name; until then connect() has run
    // with a placeholder. We connect immediately with a default name and let a later join rename via
    // the message path — matching the RelayServer contract (connect seats, message routes).
    deliver(server.connect(playerId, `Player ${playerId}`));

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const { lines, rest } = splitLines(buffer);
      buffer = rest;
      for (const line of lines) {
        const message = parseClientMessage(line);
        if (message === null) {
          deliver([{ to: playerId, message: { type: 'error', reason: 'malformed message' } }]);
          continue;
        }
        deliver(server.message(playerId, message));
      }
    });

    const drop = (): void => {
      if (!sockets.has(playerId)) return;
      sockets.delete(playerId);
      deliver(server.disconnect(playerId));
    };
    socket.on('close', drop);
    socket.on('error', drop);
  });

  return new Promise<RelayHost>((resolve, reject) => {
    tcp.on('error', reject);
    tcp.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      const address = tcp.address();
      const port = typeof address === 'object' && address !== null ? address.port : (options.port ?? 0);
      options.onListening?.(port);
      resolve({
        port,
        deliver,
        close: () =>
          new Promise<void>((res) => {
            for (const socket of sockets.values()) socket.destroy();
            sockets.clear();
            tcp.close(() => res());
          }),
      });
    });
  });
}
