/**
 * The online server on localhost, and headless players: the app's own OnlineSession (src/main/onlineClient.ts)
 * with a fresh device key each, no Electron. Every test here talks to the real server over real TLS 1.3.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { RoomView } from '../../src/core/multiplayer.js';
import type { RoomInfo, WelcomeFrame } from '../../src/core/online/protocol.js';
import type { Action } from '../../src/core/table.js';
import { OnlineSession, type OnlineEvent, type OnlineSessionOptions, type OnlineTarget } from '../../src/main/onlineClient.js';
import { createIdentity, type Identity } from '../../src/main/onlineIdentity.js';
import { issueCertificate } from '../../src/main/selfSignedCert.js';
import { silentLog } from '../../server/log.js';
import { startOnlineServer, type OnlineServer, type OnlineServerOptions } from '../../server/transport.js';

export const FAST = { turnMs: 2_000, graceMs: 4_000, nextHandMs: 150, entropyMs: 3_000, idleRoomMs: 60_000, erasePassMs: 200 };

export interface TestServer {
  readonly server: OnlineServer;
  readonly target: OnlineTarget;
  readonly dir: string;
  close(): Promise<void>;
}

export async function startTestServer(opts: Partial<OnlineServerOptions> = {}): Promise<TestServer> {
  const dir = opts.stateDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-online-'));
  const cert = issueCertificate({ commonName: 'Offsuit online server', days: 30 });
  const server = await startOnlineServer({
    stateDir: dir,
    tls: { key: cert.keyPem, cert: cert.certPem },
    log: silentLog,
    tickMs: 25,
    ...opts,
    timing: { ...FAST, ...opts.timing },
  });
  return {
    server,
    dir,
    target: { host: '127.0.0.1', port: server.port, pin: cert.fingerprint },
    close: () => server.close(),
  };
}

export class Player {
  readonly events: OnlineEvent[] = [];
  readonly wire: string[] = [];
  readonly session: OnlineSession;
  view: RoomView | null = null;
  room: RoomInfo | null = null;
  /** Act on every turn with this; null means the test acts itself. */
  strategy: ((view: RoomView) => Action) | null = null;

  constructor(
    target: OnlineTarget,
    readonly identity: Identity,
    options: OnlineSessionOptions = {},
  ) {
    this.session = new OnlineSession(target, identity, (event) => this.onEvent(event), {
      delays: [50, 100, 200, 400, 800],
      ...options,
      onWire: (line) => this.wire.push(line),
    });
  }

  private onEvent(event: OnlineEvent): void {
    this.events.push(event);
    if (event.type === 'room') this.room = event.room;
    if (event.type === 'state') {
      this.view = event.view;
      if (this.strategy !== null && event.view.yourTurn && event.view.winners === null) {
        const action = this.strategy(event.view);
        // Act on the next tick, as a person would, never inside the frame handler.
        setTimeout(() => this.session.action(action), 5);
      }
    }
  }

  connect(): Promise<WelcomeFrame> {
    return this.session.connect();
  }

  request(type: Parameters<OnlineSession['request']>[0], fields: Record<string, unknown> = {}): Promise<unknown> {
    return this.session.request(type, fields as never);
  }

  async waitFor<T extends OnlineEvent>(match: (e: OnlineEvent) => e is T, ms?: number, from?: number): Promise<T>;
  async waitFor(match: (e: OnlineEvent) => boolean, ms?: number, from?: number): Promise<OnlineEvent>;
  async waitFor(match: (e: OnlineEvent) => boolean, ms = 8_000, from = 0): Promise<OnlineEvent> {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = this.events.slice(from).find(match);
      if (found !== undefined) return found;
      if (Date.now() > deadline) throw new Error(`timed out; events: ${JSON.stringify(this.events.slice(-8))}`);
      await sleep(10);
    }
  }

  async waitView(match: (v: RoomView) => boolean, ms = 8_000): Promise<RoomView> {
    const deadline = Date.now() + ms;
    for (;;) {
      if (this.view !== null && match(this.view)) return this.view;
      if (Date.now() > deadline) throw new Error(`view timed out at ${JSON.stringify(this.view && { hand: this.view.handNumber, street: this.view.street, toAct: this.view.toAct, winners: this.view.winners })}`);
      await sleep(10);
    }
  }

  close(): void {
    this.session.close();
  }
}

export function freshIdentity(): Identity {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-id-'));
  return createIdentity(path.join(dir, 'online-identity.json'));
}

/** A player who is connected, named and 18+. */
export async function signedIn(t: TestServer, name: string, options: OnlineSessionOptions = {}): Promise<Player> {
  const p = new Player(t.target, freshIdentity(), options);
  await p.connect();
  await p.request('profile', { name, adult: true });
  return p;
}

/** Check if free, else call: a passive player that always reaches showdown. */
export const checkOrCall = (view: RoomView): Action => ({ kind: view.legal.includes('check') ? 'check' : 'call' });

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Every card string named anywhere in a JSON line. */
export function cardsIn(line: string): string[] {
  return [...line.matchAll(/"([2-9TJQKA][shdc])"/g)].map((m) => m[1]);
}
