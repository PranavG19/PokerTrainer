/**
 * RELAY SESSION — the main-process lifecycle for the LOCAL player's multiplayer session.
 *
 * There are two roles a local player can take, and this module owns both behind one small interface so
 * main.ts's IPC layer stays a thin pass-through:
 *
 *   HOST — start a RelayServer (the authority) and a TCP relayHost so remote players can connect, and
 *   seat the local player as an in-process participant whose broadcasts are delivered by callback
 *   rather than over a socket. The host's own view therefore never round-trips through the network.
 *
 *   JOIN — open a client socket to a remote host and fold the pushed ServerMessages into the local
 *   view. No RelayServer here; the remote host is the authority.
 *
 * Either way the caller supplies onState/onError callbacks (main.ts forwards them to the renderer via
 * webContents.send), so the routing is testable without Electron. The one hard rule this preserves:
 * the local player only ever sees the REDACTED view the authority produced — hosting does not hand the
 * renderer the un-redacted room, it hands it viewFor(localPlayer), the same as any other seat.
 */

import * as net from 'node:net';
import { RelayServer } from '../core/relayServer.js';
import { createRelayHost, encodeLine, splitLines, type RelayHost } from './relayHost.js';
import type { Action } from '../core/table.js';
import type { CreateRoomOpts, RoomView, ServerMessage } from '../core/multiplayer.js';

/** The local player's id when hosting — a stable, reserved id the local seat always uses. */
export const LOCAL_PLAYER: string = 'local';

export interface SessionCallbacks {
  /** A fresh redacted view for the local player. */
  readonly onState: (view: RoomView) => void;
  /** An error addressed to the local player (out-of-turn, illegal, room full…). */
  readonly onError: (reason: string) => void;
}

export interface HostInfo {
  readonly port: number;
}

/**
 * A running session — host or join — with the controls main.ts exposes over IPC. Every method is a
 * no-op after stop(), so a late renderer message cannot act on a torn-down session.
 */
export interface RelaySession {
  action(action: Action): void;
  dealNext(): void;
  stop(): Promise<void>;
}

/** Route a batch of the server's outputs: the local player's go to the callbacks, others are ignored
 *  here (the relayHost delivers those to their sockets directly). */
function routeLocal(callbacks: SessionCallbacks, outbound: ReturnType<RelayServer['connect']>): void {
  for (const item of outbound) {
    if (item.to !== LOCAL_PLAYER) continue;
    if (item.message.type === 'state') callbacks.onState(item.message.view);
    else callbacks.onError(item.message.reason);
  }
}

/**
 * Start hosting: a RelayServer, a TCP host for remote players, and the local player seated in-process.
 * The local player's broadcasts are delivered via the callbacks; remote players' broadcasts go out
 * their sockets (relayHost owns that). Returns the session controls and the port to share.
 */
export async function hostSession(
  opts: CreateRoomOpts,
  callbacks: SessionCallbacks,
): Promise<{ session: RelaySession; info: HostInfo }> {
  const server = new RelayServer(opts);
  // The local player has no socket, so the host must deliver broadcasts addressed to LOCAL_PLAYER to
  // the callbacks — including ones triggered by a REMOTE player's activity, which flow through the
  // host's deliver(). Without this, a deal fired when the guest joins would never reach the host UI.
  const host: RelayHost = await createRelayHost({
    server,
    localDelivery: {
      playerId: LOCAL_PLAYER,
      deliver: (message) => {
        if (message.type === 'state') callbacks.onState(message.view);
        else callbacks.onError(message.reason);
      },
    },
  });
  // Seat the local player in-process; the initial connect broadcast is routed the same way.
  routeLocal(callbacks, server.connect(LOCAL_PLAYER, 'You'));

  let stopped = false;
  const session: RelaySession = {
    action(action: Action): void {
      if (stopped) return;
      routeLocal(callbacks, server.message(LOCAL_PLAYER, { type: 'action', action }));
    },
    dealNext(): void {
      if (stopped) return;
      routeLocal(callbacks, server.dealNext());
    },
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      await host.close();
    },
  };
  return { session, info: { port: host.port } };
}

/**
 * Join a remote host at host:port. Opens a client socket, sends a join, and folds the pushed messages
 * into the callbacks. No RelayServer locally — the remote end is the authority and this only relays
 * the local player's actions to it.
 */
export function joinSession(
  address: { host: string; port: number },
  name: string,
  callbacks: SessionCallbacks,
): RelaySession {
  const socket = net.createConnection({ host: address.host, port: address.port });
  socket.setEncoding('utf8');
  let buffer = '';
  let stopped = false;

  socket.on('connect', () => {
    socket.write(encodeLine({ type: 'join', name }));
  });
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    const { lines, rest } = splitLines(buffer);
    buffer = rest;
    for (const line of lines) {
      const message = safeServerMessage(line);
      if (message === null) continue;
      if (message.type === 'state') callbacks.onState(message.view);
      else callbacks.onError(message.reason);
    }
  });
  socket.on('error', () => {
    if (!stopped) callbacks.onError('connection error');
  });

  return {
    action(action: Action): void {
      if (stopped || socket.destroyed) return;
      socket.write(encodeLine({ type: 'action', action }));
    },
    // A joined player is not the authority, so it cannot deal; asking to deal is a no-op. (The host
    // controls the deal.) Kept on the interface so main.ts treats host and join uniformly.
    dealNext(): void {},
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      socket.write(encodeLine({ type: 'leave' }));
      socket.destroy();
    },
  };
}

/** Parse a server → client line, tolerating garbage (never throws into the socket handler). */
function safeServerMessage(line: string): ServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const type = (value as { type?: unknown }).type;
  if (type === 'state' || type === 'error') return value as ServerMessage;
  return null;
}
