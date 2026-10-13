/**
 * ONLINE CLIENT — main's connection to an Offsuit online server, and the headless client the server's
 * integration tests drive (no Electron here: only node:tls and node:crypto).
 *
 * One OnlineSession is one signed-in presence: it connects, checks the server's certificate (a pinned
 * SHA-256, or a public authority valid for the host name), signs in with the device key, and then:
 *   - answers requests by id (rooms, ladder, season, leagues, export, forget);
 *   - runs every table message through GuestProtocol, the LAN guest's deal checker, so a server that
 *     shows a card it did not commit to ends the table for this player with the reason;
 *   - reconnects on its own after a drop (the server holds the seat for its grace window) and takes the
 *     replayed deal (`resync`) only on a fresh protocol, checking its own revealed entropy is in it.
 *
 * It opens nothing until connect() is called, and main calls that only after the player turned online
 * play on, set a server, and confirmed they are 18 or over.
 */

import * as crypto from 'node:crypto';
import * as tls from 'node:tls';
import { GuestProtocol, type GuestMemory } from '../core/relayGuest.js';
import type { Action } from '../core/table.js';
import type { RoomView, ServerMessage } from '../core/multiplayer.js';
import {
  MAX_SERVER_FRAME,
  ONLINE_PROTO,
  ONLINE_VERSION,
  PING_MS,
  type EmoteId,
  type OnlineRequest,
  type OnlineRequestType,
  type RoomInfo,
  type WelcomeFrame,
} from '../core/online/protocol.js';
import { splitLines } from './relayHost.js';
import { signAuth } from './onlineAuth.js';
import type { Identity } from './onlineIdentity.js';
import { certFingerprint } from './selfSignedCert.js';
import { nodeDealCrypto } from './relaySession.js';

export interface OnlineTarget {
  readonly host: string;
  readonly port: number;
  /** SHA-256 of the server certificate, base64url; null means "validate with public authorities". */
  readonly pin: string | null;
  /** Extra trusted authorities (tests only: a private CA standing in for Let's Encrypt). */
  readonly ca?: string;
}

export type OnlineStatus = 'connecting' | 'online' | 'reconnecting' | 'offline';

export type OnlineEvent =
  | { readonly type: 'status'; readonly status: OnlineStatus; readonly reason?: string }
  | { readonly type: 'welcome'; readonly welcome: WelcomeFrame }
  | { readonly type: 'room'; readonly room: RoomInfo | null }
  | { readonly type: 'state'; readonly view: RoomView }
  | { readonly type: 'clock'; readonly seat: number; readonly ms: number }
  | { readonly type: 'emote'; readonly seat: number; readonly emote: EmoteId }
  | { readonly type: 'error' | 'warning' | 'removed'; readonly reason: string }
  | { readonly type: 'verified'; readonly hand: number; readonly cards: number };

export const PIN_MISMATCH =
  "This server's certificate does not match the pin in Settings, so Offsuit did not connect. " +
  'Someone may be intercepting the connection, or the server changed its certificate.';

/** How long to keep retrying after a drop: a little under the server's 60 s seat hold. */
export const RECONNECT_DELAYS_MS: readonly number[] = [250, 500, 1000, 2000, 4000, 8000, 15_000, 15_000];

type RequestFields<T extends OnlineRequestType> = Omit<Extract<OnlineRequest, { type: T }>, 'type' | 'id'>;

export interface OnlineSessionOptions {
  /** Retry after a drop. On by default. */
  readonly reconnect?: boolean;
  readonly delays?: readonly number[];
  /** Every raw line received, for tests that inspect the wire. */
  readonly onWire?: (line: string) => void;
}

export class OnlineSession {
  private socket: tls.TLSSocket | null = null;
  private guest: GuestProtocol;
  private room: RoomInfo | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (data: unknown) => void; reject: (reason: Error) => void }>();
  private closed = false;
  private everWelcomed = false;
  private attempt = 0;
  private ping: NodeJS.Timeout | null = null;
  /** The entropy this player revealed per deal, across reconnects (relayGuest.ts GuestMemory). */
  private readonly revealed = new Map<string, string>();
  private readonly memory: GuestMemory = {
    revealed: (nonce) => this.revealed.get(nonce),
    remember: (nonce, entropy) => {
      this.revealed.set(nonce, entropy);
      // Only the last few deals can ever be replayed; keep the map small.
      if (this.revealed.size > 16) this.revealed.delete(this.revealed.keys().next().value!);
    },
  };
  private welcomeWaiters: { resolve: (w: WelcomeFrame) => void; reject: (e: Error) => void }[] = [];

  constructor(
    private readonly target: OnlineTarget,
    private readonly identity: Identity,
    private readonly onEvent: (event: OnlineEvent) => void,
    private readonly options: OnlineSessionOptions = {},
  ) {
    this.guest = new GuestProtocol(nodeDealCrypto, this.memory);
  }

  /** Connect and sign in. Resolves with the welcome, or rejects with the reason it could not. */
  connect(): Promise<WelcomeFrame> {
    const waiting = new Promise<WelcomeFrame>((resolve, reject) => this.welcomeWaiters.push({ resolve, reject }));
    this.open();
    return waiting;
  }

  currentRoom(): RoomInfo | null {
    return this.room;
  }

  isOnline(): boolean {
    return this.socket !== null && this.everWelcomed && !this.closed;
  }

  private emit(event: OnlineEvent): void {
    if (!this.closed || event.type === 'status') this.onEvent(event);
  }

  private open(): void {
    this.emit({ type: 'status', status: this.everWelcomed ? 'reconnecting' : 'connecting' });
    const { host, port, pin, ca } = this.target;
    const socket = tls.connect({
      host,
      port,
      minVersion: 'TLSv1.3',
      // A pin is the whole check (the handshake proves the server holds the pinned certificate's key);
      // without one, Node validates the chain and the host name against the public roots.
      rejectUnauthorized: pin === null,
      ...(ca !== undefined ? { ca } : {}),
      ...(/^[\d.]+$/.test(host) || host.includes(':') ? {} : { servername: host }),
    });
    this.socket = socket;
    this.guest = new GuestProtocol(nodeDealCrypto, this.memory);
    socket.setEncoding('utf8');
    let buffer = '';
    let welcomed = false;
    let fatal: string | null = null;

    const end = (reason: string, retry: boolean): void => {
      fatal = reason;
      if (!retry) this.stopRetrying();
      socket.destroy();
    };

    socket.on('secureConnect', () => {
      if (pin !== null) {
        const presented = Buffer.from(certFingerprint(socket.getPeerCertificate().raw), 'base64url');
        const pinned = Buffer.from(pin, 'base64url');
        if (presented.length !== pinned.length || !crypto.timingSafeEqual(presented, pinned)) return end(PIN_MISMATCH, false);
      }
      socket.write(`${JSON.stringify({ type: 'hello', proto: ONLINE_PROTO, v: ONLINE_VERSION, key: this.identity.publicKey })}\n`);
    });

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const { lines, rest } = splitLines(buffer);
      if (rest.length > MAX_SERVER_FRAME || lines.some((l) => l.length > MAX_SERVER_FRAME)) return end('The server sent a message too large to read.', true);
      buffer = rest;
      for (const line of lines) {
        if (socket.destroyed) return;
        this.options.onWire?.(line);
        let frame: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(line);
          if (typeof parsed !== 'object' || parsed === null) continue;
          frame = parsed as Record<string, unknown>;
        } catch {
          continue;
        }
        if (frame.type === 'bye') {
          const reason = typeof frame.reason === 'string' ? frame.reason.slice(0, 200) : 'The server closed the connection.';
          // A restart is worth waiting out; anything else (signed in elsewhere, data deleted) is final.
          return end(reason, /restarting/i.test(reason));
        }
        if (!welcomed) {
          if (frame.type === 'challenge' && typeof frame.nonce === 'string' && /^[0-9a-f]{64}$/.test(frame.nonce)) {
            socket.write(`${JSON.stringify({ type: 'auth', sig: signAuth(socket, frame.nonce, this.identity.publicKey, this.identity.privateKey) })}\n`);
          } else if (frame.type === 'welcome' && frame.v === ONLINE_VERSION) {
            welcomed = true;
            this.onWelcome(frame as unknown as WelcomeFrame);
          } else {
            return end('That address is not an Offsuit online server this app can talk to.', false);
          }
          continue;
        }
        this.onFrame(frame);
      }
    });

    socket.on('error', (error: Error & { code?: string }) => {
      if (fatal === null) {
        fatal = error.code === 'CERT_HAS_EXPIRED' || /certificate|self.signed|altnames|issuer/i.test(error.message)
          ? `The server's certificate is not valid for ${host} (${error.code ?? error.message}).`
          : 'Could not reach the server.';
        if (/certificate|self.signed|altnames|issuer/i.test(error.message)) this.stopRetrying();
      }
    });
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      if (this.ping !== null) clearInterval(this.ping);
      this.ping = null;
      for (const { reject } of this.pending.values()) reject(new Error('The connection to the server closed.'));
      this.pending.clear();
      const reason = fatal ?? 'The connection to the server dropped.';
      if (this.closed) return;
      if (!this.everWelcomed || this.options.reconnect === false || this.attempt >= (this.options.delays ?? RECONNECT_DELAYS_MS).length) {
        for (const { reject } of this.welcomeWaiters.splice(0)) reject(new Error(reason));
        this.closed = true;
        this.onEvent({ type: 'status', status: 'offline', reason });
        return;
      }
      const delay = (this.options.delays ?? RECONNECT_DELAYS_MS)[this.attempt];
      this.attempt += 1;
      this.emit({ type: 'status', status: 'reconnecting', reason });
      setTimeout(() => {
        if (!this.closed) this.open();
      }, delay).unref();
    });
  }

  /** No more automatic retries: the next close is final. */
  private stopRetrying(): void {
    this.attempt = Number.POSITIVE_INFINITY;
  }

  private onWelcome(welcome: WelcomeFrame): void {
    this.everWelcomed = true;
    this.attempt = 0;
    this.room = welcome.room;
    this.ping = setInterval(() => this.write({ type: 'ping' }), PING_MS);
    this.ping.unref();
    this.emit({ type: 'status', status: 'online' });
    this.emit({ type: 'welcome', welcome });
    for (const { resolve } of this.welcomeWaiters.splice(0)) resolve(welcome);
  }

  private onFrame(frame: Record<string, unknown>): void {
    switch (frame.type) {
      case 'reply': {
        const waiter = this.pending.get(frame.id as number);
        if (waiter === undefined) return;
        this.pending.delete(frame.id as number);
        if (frame.ok === true) waiter.resolve(frame.data);
        else waiter.reject(new Error(typeof frame.error === 'string' ? frame.error : 'The server refused that.'));
        return;
      }
      case 'room': {
        const room = (frame.room ?? null) as RoomInfo | null;
        // A different table starts a fresh deal checker: hand numbers start again at 1 there.
        if (room?.code !== this.room?.code) this.guest = new GuestProtocol(nodeDealCrypto, this.memory);
        this.room = room;
        this.emit({ type: 'room', room });
        return;
      }
      case 'clock':
        if (Number.isInteger(frame.seat) && typeof frame.ms === 'number') this.emit({ type: 'clock', seat: frame.seat as number, ms: frame.ms });
        return;
      case 'emote':
        if (Number.isInteger(frame.seat) && typeof frame.emote === 'string') this.emit({ type: 'emote', seat: frame.seat as number, emote: frame.emote as EmoteId });
        return;
      case 'removed':
        this.emit({ type: 'removed', reason: typeof frame.reason === 'string' ? frame.reason.slice(0, 200) : 'You left the table.' });
        return;
      case 'state':
      case 'error':
      case 'commit':
      case 'entropy-set':
      case 'dealt':
      case 'resync':
        return this.onTable(frame as unknown as ServerMessage);
    }
  }

  private onTable(message: ServerMessage): void {
    const step = this.guest.receive(message);
    for (const reply of step.send) this.write(reply);
    for (const event of step.events) {
      if (event.type === 'state') this.emit({ type: 'state', view: event.view });
      else if (event.type === 'error') this.emit({ type: 'error', reason: event.reason });
      else if (event.type === 'warning') this.emit({ type: 'warning', reason: event.reason });
      else if (event.type === 'verified') this.emit({ type: 'verified', hand: event.hand, cards: event.cards });
      else if (event.type === 'violation') {
        // The server showed a card it cannot prove: leave the table, keep the reason on screen.
        this.write({ type: 'leave' });
        this.emit({ type: 'removed', reason: event.reason });
      }
    }
  }

  private write(frame: object): void {
    const socket = this.socket;
    if (socket === null || socket.destroyed || !this.everWelcomed) return;
    socket.write(`${JSON.stringify(frame)}\n`);
  }

  request<T extends OnlineRequestType>(type: T, fields: RequestFields<T>, timeoutMs = 15_000): Promise<unknown> {
    const socket = this.socket;
    if (socket === null || socket.destroyed || !this.everWelcomed) return Promise.reject(new Error('Not connected to the server.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The server did not answer.'));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      socket.write(`${JSON.stringify({ type, id, ...fields })}\n`);
    });
  }

  action(action: Action): void {
    this.write({ type: 'action', action });
  }

  emote(emote: EmoteId): void {
    this.write({ type: 'emote', emote });
  }

  leave(): void {
    this.write({ type: 'leave' });
  }

  /** Send a raw line (tests: forged and malformed frames). */
  raw(line: string): void {
    this.socket?.write(line);
  }

  /** Drop the connection without leaving, as a network failure would (tests). */
  drop(): void {
    this.socket?.destroy();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.ping !== null) clearInterval(this.ping);
    this.socket?.destroy();
    this.socket = null;
    for (const { reject } of this.welcomeWaiters.splice(0)) reject(new Error('Disconnected.'));
    this.onEvent({ type: 'status', status: 'offline' });
  }
}
