/**
 * RELAY SESSION — the main-process lifecycle for the LOCAL player's multiplayer session.
 *
 * There are two roles a local player can take, and this module owns both behind one small interface so
 * main.ts's IPC layer stays a thin pass-through:
 *
 *   HOST — start a RelayServer (the authority) and a TLS relayHost so remote players can connect, and
 *   seat the local player as an in-process participant whose broadcasts are delivered by callback
 *   rather than over a socket. The host's own view therefore never round-trips through the network.
 *
 *   JOIN — open a TLS socket to a remote host from its invite, pin its certificate, and fold the pushed
 *   ServerMessages through GuestProtocol, which checks the deal. No RelayServer here; the remote host is
 *   the authority.
 *
 * Either way the caller supplies onState/onError callbacks (main.ts forwards them to the renderer via
 * webContents.send), so the routing is testable without Electron. The one hard rule this preserves:
 * the local player only ever sees the REDACTED view the authority produced — hosting does not hand the
 * renderer the un-redacted room, it hands it viewFor(localPlayer), the same as any other seat.
 */

import * as crypto from 'node:crypto';
import * as os from 'node:os';
import * as tls from 'node:tls';
import { formatInvite, type Invite } from '../core/relayClient.js';
import { GuestProtocol } from '../core/relayGuest.js';
import { RelayServer } from '../core/relayServer.js';
import type { DealCrypto } from '../core/dealCommit.js';
import { PROTOCOL_VERSION, type CreateRoomOpts, type RoomView, type ServerMessage } from '../core/multiplayer.js';
import type { Action } from '../core/table.js';
import { createRelayHost, encodeLine, frameChunk, type RelayHost } from './relayHost.js';
import { certFingerprint, createTableCertificate } from './selfSignedCert.js';

/** node:crypto behind core's injected interface: every multiplayer deal and guest entropy draws here. */
export const nodeDealCrypto: DealCrypto = {
  random: (length) => crypto.randomBytes(length),
  sha256: (data) => crypto.createHash('sha256').update(data).digest(),
};

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
  /** The table certificate's SHA-256 (base64url) and the room token: the two secrets an invite carries. */
  readonly fingerprint: string;
  readonly token: string;
  /** One invite link per LAN address, in `addresses` order. */
  readonly invites: readonly string[];
  /**
   * The host machine's LAN IPv4 address(es) a guest types to join — the piece a bare port cannot supply.
   * Loopback and internal interfaces are excluded (a guest on another machine can't use 127.0.0.1). May
   * be empty on a machine with no LAN interface (then the guest must be told the address another way);
   * the host still listens, so this is informational, not a failure.
   */
  readonly addresses: readonly string[];
}

/**
 * The non-internal IPv4 addresses of this machine — what a guest on the same network types to reach the
 * host. Takes the interface map as an argument (defaulting to os.networkInterfaces()) so the selection
 * rule is unit-testable without depending on the test machine's real interfaces. IPv6 is excluded: the
 * join UI and relay use plain host:port and a link-local v6 address needs a zone id most users can't give.
 */
export function lanAddresses(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): string[] {
  const out: string[] = [];
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      // Node <18 typed `family` as a string ('IPv4'); >=18 as a number (4). Accept both.
      const isV4 = info.family === 'IPv4' || (info.family as unknown) === 4;
      if (isV4 && !info.internal) out.push(info.address);
    }
  }
  return out;
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

/**
 * Start hosting: a RelayServer, a TCP host for remote players, and the local player seated in-process.
 * The local player's broadcasts are delivered via the callbacks; remote players' broadcasts go out
 * their sockets (relayHost owns that). Returns the session controls and the port to share.
 */
export async function hostSession(
  opts: CreateRoomOpts,
  callbacks: SessionCallbacks,
  hostOpts: { readonly host?: string } = {},
): Promise<{ session: RelaySession; info: HostInfo }> {
  // The dealer is the in-process local seat; the CSPRNG is node:crypto. No seed exists anywhere.
  const server = new RelayServer(opts, { crypto: nodeDealCrypto, dealerPlayerId: LOCAL_PLAYER });
  // A fresh key, certificate and token per table: an old invite pins a key that no longer exists.
  const certificate = createTableCertificate();
  const token = crypto.randomBytes(16).toString('base64url');
  // The local player has no socket, so the host must deliver broadcasts addressed to LOCAL_PLAYER to
  // the callbacks — including ones triggered by a REMOTE player's activity, which flow through the
  // host's deliver(). Without this, a deal fired when the guest joins would never reach the host UI.
  const host: RelayHost = await createRelayHost({
    server,
    // Bind ALL interfaces, not the loopback default: "Play with friends on your local network" is the
    // whole point, and a loopback-only host silently refuses every LAN peer. Safe — the relay is behind
    // the explicit multiplayer opt-in, speaks only TLS, and seats nobody without the invite token.
    host: hostOpts.host ?? '0.0.0.0',
    tls: { key: certificate.keyPem, cert: certificate.certPem },
    token,
    localDelivery: {
      playerId: LOCAL_PLAYER,
      deliver: (message) => {
        // The deal handshake messages are for guests; the dealer's own seat only renders.
        if (message.type === 'state') callbacks.onState(message.view);
        else if (message.type === 'error') callbacks.onError(message.reason);
      },
    },
  });
  // Seat the local player in-process, delivering to EVERY recipient: the initial connect broadcasts to
  // any already-connected remote players too, not just the local callback. host.deliver routes locals
  // to the callback and remotes to their sockets.
  host.deliver(server.connect(LOCAL_PLAYER, 'You'));

  let stopped = false;
  const session: RelaySession = {
    action(action: Action): void {
      if (stopped) return;
      // Deliver to ALL players: a host action moves everyone's state, so the remote players' sockets
      // must receive it too — delivering only to the local callback froze the guests.
      host.deliver(server.message(LOCAL_PLAYER, { type: 'action', action }));
    },
    dealNext(): void {
      if (stopped) return;
      host.deliver(server.dealNext());
    },
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      await host.close();
    },
  };
  const addresses = lanAddresses();
  const fingerprint = certificate.fingerprint;
  const invites = addresses.map((address) => formatInvite({ host: address, port: host.port, fingerprint, token }));
  return { session, info: { port: host.port, addresses, fingerprint, token, invites } };
}

/** What the guest tells the user when the pinned fingerprint does not match the host's certificate. */
export const FINGERPRINT_MISMATCH =
  "This table's security certificate does not match the invite link, so Offsuit did not connect. " +
  'Someone may be intercepting the connection, or the host restarted the table. Ask for a fresh invite.';

/** A TLS failure before any frame: most often a v1 (plaintext) host, which cannot speak TLS. */
export const SECURE_CONNECT_FAILED =
  'Could not open a secure connection to that table. The host may be running an older Offsuit; ' +
  'update both apps to the same version.';

export interface GuestCallbacks extends SessionCallbacks {
  /** A deal warning (relayGuest.ts): shown and kept, but play continues. Falls back to onError. */
  readonly onWarning?: (reason: string) => void;
  /** A hand ended and every card shown opened the host's commitment. */
  readonly onVerified?: (hand: number, cards: number) => void;
  /** Every raw line received, for tests that inspect the wire. */
  readonly onWire?: (line: string) => void;
}

/**
 * Join a table from its invite. Opens a TLS socket, pins the certificate fingerprint BEFORE sending
 * anything, then sends the hello with the room token. Server messages run through GuestProtocol, which
 * answers the deal handshake and checks every card shown against the host's commitment; a failed check
 * ends the session with the reason. No RelayServer locally — the remote end is the authority.
 */
export function joinSession(invite: Invite, name: string, callbacks: GuestCallbacks): RelaySession {
  // rejectUnauthorized is off because nothing here trusts a CA: the pin below is the whole check, and
  // the TLS handshake itself proves the host holds the pinned certificate's private key.
  const socket = tls.connect({ host: invite.host, port: invite.port, rejectUnauthorized: false, minVersion: 'TLSv1.3' });
  socket.setEncoding('utf8');
  const guest = new GuestProtocol(nodeDealCrypto);
  let buffer = '';
  let stopped = false;
  let welcomed = false;
  let secured = false;

  const fail = (reason: string): void => {
    if (!stopped) callbacks.onError(reason);
    stopped = true;
    socket.destroy();
  };

  socket.on('secureConnect', () => {
    secured = true;
    const presented = certFingerprint(socket.getPeerCertificate().raw);
    const pinned = Buffer.from(invite.fingerprint, 'base64url');
    const actual = Buffer.from(presented, 'base64url');
    if (pinned.length !== actual.length || !crypto.timingSafeEqual(pinned, actual)) {
      fail(FINGERPRINT_MISMATCH);
      return;
    }
    socket.write(encodeLine({ type: 'hello', v: PROTOCOL_VERSION, token: invite.token, name }));
  });
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    const { lines, rest, overflow } = frameChunk(buffer);
    if (overflow) {
      // A remote host that floods us with an oversized frame (buggy or hostile) would otherwise grow
      // this buffer without bound in the main process. Surface it and drop the connection.
      fail('message too large');
      return;
    }
    buffer = rest;
    for (const line of lines) {
      if (stopped) return;
      callbacks.onWire?.(line);
      const message = safeServerMessage(line);
      if (message === null) continue;
      if (!welcomed) {
        // Before the welcome only a refusal is meaningful; a host that skips it is not v2.
        if (message.type === 'error') fail(message.reason);
        else if (message.type !== 'welcome' || message.v !== PROTOCOL_VERSION) {
          fail(`This table speaks a different relay protocol than v${PROTOCOL_VERSION}. Update both apps to the same Offsuit version.`);
        } else welcomed = true;
        continue;
      }
      const step = guest.receive(message);
      for (const reply of step.send) socket.write(encodeLine(reply));
      for (const event of step.events) {
        if (event.type === 'state') callbacks.onState(event.view);
        else if (event.type === 'error') callbacks.onError(event.reason);
        else if (event.type === 'warning') (callbacks.onWarning ?? callbacks.onError)(event.reason);
        else if (event.type === 'verified') callbacks.onVerified?.(event.hand, event.cards);
        else if (event.type === 'violation') fail(event.reason);
      }
    }
  });
  socket.on('error', () => {
    if (!stopped) fail(secured ? 'connection error' : SECURE_CONNECT_FAILED);
  });
  socket.on('close', () => {
    if (!stopped) fail('The table closed the connection.');
  });

  return {
    action(action: Action): void {
      if (stopped || socket.destroyed || !welcomed) return;
      socket.write(encodeLine({ type: 'action', action }));
    },
    // A joined player is not the authority, so it cannot deal directly — it REQUESTS the next hand and
    // the host's relay deals it (a no-op there while a hand is still live). This lets a guest advance a
    // finished hand instead of waiting on the host.
    dealNext(): void {
      if (stopped || socket.destroyed || !welcomed) return;
      socket.write(encodeLine({ type: 'deal' }));
    },
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      if (welcomed) socket.write(encodeLine({ type: 'leave' }));
      socket.destroy();
    },
  };
}

const SERVER_TYPES = new Set(['welcome', 'state', 'error', 'commit', 'entropy-set', 'dealt']);

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
  return typeof type === 'string' && SERVER_TYPES.has(type) ? (value as ServerMessage) : null;
}
