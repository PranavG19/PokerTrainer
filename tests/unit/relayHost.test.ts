import { afterEach, describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import * as net from 'node:net';
import * as tls from 'node:tls';
import {
  BAD_TOKEN,
  createRelayHost,
  encodeLine,
  frameChunk,
  MAX_HANDSHAKING_PER_ADDRESS,
  MAX_MESSAGE_BYTES,
  MAX_TOKEN_FAILURES,
  parseClientMessage,
  parseHello,
  splitLines,
  tokenMatches,
  V1_REFUSAL,
  versionMismatch,
  type RelayHost,
} from '../../src/main/relayHost.js';
import { createTableCertificate } from '../../src/main/selfSignedCert.js';
import { RelayServer } from '../../src/core/relayServer.js';
import { PROTOCOL_VERSION, type ServerMessage } from '../../src/core/multiplayer.js';
import { GuestProtocol } from '../../src/core/relayGuest.js';
import { ROOM as OPTS, testCrypto } from './relayHarness.js';

/**
 * RELAY HOST — the TLS transport (relay protocol v2) around the (already-tested) RelayServer.
 *
 * The framing helpers are pure and tested directly. The transport itself is proven with REAL TLS
 * sockets against a local host on an ephemeral port. Two assertions matter most: a card never crosses
 * the wire to the wrong player, and nothing at all reaches a socket that has not presented the room
 * token inside TLS.
 */

const CERT = createTableCertificate();
const TOKEN = crypto.randomBytes(16).toString('base64url');

let host: RelayHost | null = null;
const openClients: net.Socket[] = [];

function startHost(server: RelayServer, extra: { helloTimeoutMs?: number } = {}): Promise<RelayHost> {
  return createRelayHost({ server, tls: { key: CERT.keyPem, cert: CERT.certPem }, token: TOKEN, ...extra });
}

afterEach(async () => {
  for (const c of openClients.splice(0)) c.destroy();
  await host?.close();
  host = null;
});

describe('framing helpers (pure)', () => {
  it('splits complete newline-delimited lines and keeps the trailing partial', () => {
    expect(splitLines('a\nb\nc')).toEqual({ lines: ['a', 'b'], rest: 'c' });
    expect(splitLines('a\nb\n')).toEqual({ lines: ['a', 'b'], rest: '' });
    // A CRLF client is tolerated, and blank lines are dropped.
    expect(splitLines('x\r\n\r\ny\r\n')).toEqual({ lines: ['x', 'y'], rest: '' });
  });

  it('parses valid client messages and rejects malformed or hostile input', () => {
    expect(parseClientMessage('{"type":"leave"}')).toEqual({ type: 'leave' });
    expect(parseClientMessage('{"type":"deal"}')).toEqual({ type: 'deal' });
    // v1's bare join is gone: identity is the hello, checked by the transport before anything else.
    expect(parseClientMessage('{"type":"join","name":"Al"}')).toBeNull();
    expect(parseClientMessage('{"type":"entropy-commit","hand":1,"nonce":"ab","commitment":"cd"}')).toEqual({
      type: 'entropy-commit',
      hand: 1,
      nonce: 'ab',
      commitment: 'cd',
    });
    expect(parseClientMessage('{"type":"entropy-reveal","hand":"1","nonce":"ab","entropy":"cd"}')).toBeNull();
    expect(parseClientMessage('{"type":"action","action":{"kind":"fold"}}')).toEqual({
      type: 'action',
      action: { kind: 'fold' },
    });
    expect(parseClientMessage('{"type":"action","action":{"kind":"raise","amount":150}}')).toEqual({
      type: 'action',
      action: { kind: 'raise', amount: 150 },
    });
    // Garbage and unknown kinds are dropped, not thrown.
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage('42')).toBeNull();
    expect(parseClientMessage('{"type":"action","action":{"kind":"teleport"}}')).toBeNull();
    expect(parseClientMessage('{"type":"nonsense"}')).toBeNull();
  });

  it('parses a hello, and compares tokens in constant time and only at full length', () => {
    expect(parseHello('{"type":"hello","v":2,"token":"t","name":"G"}')).toEqual({ type: 'hello', v: 2, token: 't', name: 'G' });
    expect(parseHello('{"type":"hello"}')).toEqual({ type: 'hello', v: -1, token: '', name: 'Player' });
    expect(parseHello('{"type":"join","name":"G"}')).toBeNull();
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches(TOKEN, TOKEN.slice(0, -2) + (TOKEN.endsWith('A') ? 'BA' : 'AA'))).toBe(false);
    expect(tokenMatches(TOKEN, '')).toBe(false);
    expect(tokenMatches(TOKEN, TOKEN.slice(0, 10))).toBe(false);
  });

  it('encodeLine appends exactly one newline', () => {
    expect(encodeLine({ type: 'error', reason: 'x' })).toBe('{"type":"error","reason":"x"}\n');
  });
});

describe('frameChunk — the receive-buffer size guard', () => {
  it('passes normal newline-delimited traffic through with no overflow', () => {
    expect(frameChunk('a\nb\nc')).toEqual({ lines: ['a', 'b'], rest: 'c', overflow: false });
  });

  it('flags an oversized partial tail — a peer that streams bytes but never sends a newline', () => {
    // Without the guard this string would just accumulate in `buffer` forever (unbounded main-process
    // memory). No '\n', so it is all a still-arriving remainder — and it is over the cap.
    const huge = 'x'.repeat(MAX_MESSAGE_BYTES + 1);
    expect(frameChunk(huge)).toEqual({ lines: [], rest: huge, overflow: true });
  });

  it('flags an oversized complete line', () => {
    const huge = `${'x'.repeat(MAX_MESSAGE_BYTES + 1)}\n`;
    expect(frameChunk(huge).overflow).toBe(true);
  });

  it('does not flag a frame exactly at the cap', () => {
    const atCap = 'x'.repeat(MAX_MESSAGE_BYTES);
    expect(frameChunk(atCap).overflow).toBe(false);
  });

  it('honors a custom cap on both the tail and complete lines', () => {
    expect(frameChunk('abcdef', 3).overflow).toBe(true); // 6-char tail over a 3 cap
    expect(frameChunk('abcd\n', 3).overflow).toBe(true); // 4-char complete line over a 3 cap
    expect(frameChunk('ab\nc', 3).overflow).toBe(false); // both within the cap
  });
});

/**
 * Connect a TLS client, send a hello, and collect parsed server messages. When `answer` is set the
 * client runs a real GuestProtocol so the deal handshake completes.
 */
function connectClient(
  port: number,
  opts: { token?: string; v?: number; hello?: boolean; answer?: boolean } = {},
): { socket: tls.TLSSocket; messages: ServerMessage[]; raw: string[] } {
  const socket = tls.connect({ port, host: '127.0.0.1', rejectUnauthorized: false });
  socket.setEncoding('utf8');
  openClients.push(socket);
  const messages: ServerMessage[] = [];
  const raw: string[] = [];
  const guest = new GuestProtocol(testCrypto);
  socket.on('error', () => undefined);
  socket.on('secureConnect', () => {
    if (opts.hello === false) return;
    socket.write(encodeLine({ type: 'hello', v: opts.v ?? PROTOCOL_VERSION, token: opts.token ?? TOKEN, name: 'P' }));
  });
  let buffer = '';
  socket.on('data', (chunk: string) => {
    raw.push(chunk);
    buffer += chunk;
    const { lines, rest } = splitLines(buffer);
    buffer = rest;
    for (const line of lines) {
      const message = JSON.parse(line) as ServerMessage;
      messages.push(message);
      if (opts.answer !== false) for (const reply of guest.receive(message).send) socket.write(encodeLine(reply));
    }
  });
  return { socket, messages, raw };
}

/** Resolve once `predicate` holds or a short timeout elapses (polling, no fixed sleep). */
async function waitFor(predicate: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for a socket condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const closed = (socket: net.Socket): Promise<void> => new Promise((r) => (socket.closed ? r() : socket.on('close', () => r())));

describe('real TLS round-trip', () => {
  it('two clients join with the token, a hand is dealt, and each sees only their own hole', async () => {
    const server = new RelayServer(OPTS, { crypto: testCrypto });
    host = await startHost(server);

    const a = connectClient(host.port);
    await waitFor(() => a.messages.length >= 2);
    expect(a.messages[0]).toEqual({ type: 'welcome', v: PROTOCOL_VERSION });
    const b = connectClient(host.port);
    // Once the second client joins and both answer the handshake, both get a dealt state.
    await waitFor(() => a.messages.some((m) => m.type === 'state' && m.view.handNumber >= 1));
    await waitFor(() => b.messages.some((m) => m.type === 'state' && m.view.handNumber >= 1));

    const aView = latest(a.messages)!.view;
    const bView = latest(b.messages)!.view;

    // Each client sees their own two cards.
    expect(aView.seats.find((s) => s.isYou)?.hole).toHaveLength(2);
    expect(bView.seats.find((s) => s.isYou)?.hole).toHaveLength(2);
    // And null for the other seats — no card crossed the wire to the wrong player.
    for (const seat of aView.seats) if (!seat.isYou) expect(seat.hole).toBeNull();
    for (const seat of bView.seats) if (!seat.isYou) expect(seat.hole).toBeNull();
    // The deck never crosses the wire at all.
    expect(JSON.stringify(a.messages)).not.toContain('"deck"');
  });

  it('an out-of-turn action over the wire is refused with an error to that client only', async () => {
    const server = new RelayServer(OPTS, { crypto: testCrypto });
    host = await startHost(server);

    const a = connectClient(host.port);
    await waitFor(() => a.messages.length >= 2);
    const b = connectClient(host.port);
    await waitFor(() => a.messages.some((m) => m.type === 'state' && m.view.handNumber >= 1));

    // Whichever client is NOT to act tries to fold; the server must reject only to them.
    const offClient = latest(a.messages)!.view.yourTurn ? b : a;
    offClient.socket.write(encodeLine({ type: 'action', action: { kind: 'fold' } }));
    await waitFor(() => offClient.messages.some((m) => m.type === 'error'));
    const err = offClient.messages.find((m) => m.type === 'error');
    expect(err && err.type === 'error' ? err.reason : '').toBe('not your turn');
  });

  it('drops a client that sends an oversized frame instead of buffering it without bound', async () => {
    const server = new RelayServer(OPTS, { crypto: testCrypto });
    host = await startHost(server);

    const a = connectClient(host.port);
    await waitFor(() => a.messages.length >= 2); // seated

    // A frame far over the cap with NO trailing newline: the guard must reject it, tell the peer, and
    // close the socket.
    a.socket.write('x'.repeat(MAX_MESSAGE_BYTES + 10));
    await waitFor(() => a.messages.some((m) => m.type === 'error'));
    const err = a.messages.find((m) => m.type === 'error');
    expect(err && err.type === 'error' ? err.reason : '').toBe('message too large');
    await closed(a.socket);
  });
});

describe('who may join — the v2 handshake', () => {
  it('a socket that has not sent its hello is not seated and is sent nothing', async () => {
    const server = new RelayServer(OPTS, { crypto: testCrypto });
    host = await startHost(server);
    const silent = connectClient(host.port, { hello: false });
    await new Promise((r) => setTimeout(r, 300));
    expect(silent.raw).toEqual([]);
    expect(server.roomState().players).toEqual([]);
  });

  it('a wrong token is refused, never seated, and an address that keeps guessing is shut out', async () => {
    const server = new RelayServer(OPTS, { crypto: testCrypto });
    host = await startHost(server);
    const wrong = crypto.randomBytes(16).toString('base64url');
    for (let i = 0; i < MAX_TOKEN_FAILURES; i += 1) {
      const guess = connectClient(host.port, { token: wrong });
      await waitFor(() => guess.messages.length >= 1);
      expect(guess.messages).toEqual([{ type: 'error', reason: BAD_TOKEN }]);
      await closed(guess.socket);
    }
    expect(server.roomState().players).toEqual([]);
    // The next attempt from the same address is dropped before TLS: even the right token is refused.
    const locked = connectClient(host.port);
    await closed(locked.socket);
    expect(locked.messages).toEqual([]);
  });

  it('a mismatched protocol version is told which version the table speaks', async () => {
    const server = new RelayServer(OPTS, { crypto: testCrypto });
    host = await startHost(server);
    const future = connectClient(host.port, { v: 3 });
    await waitFor(() => future.messages.length >= 1);
    expect(future.messages).toEqual([{ type: 'error', reason: versionMismatch(3) }]);
    expect(server.roomState().players).toEqual([]);
  });

  it('a v1 plaintext client gets a v1-framed refusal it can show, not a TLS error', async () => {
    const server = new RelayServer(OPTS, { crypto: testCrypto });
    host = await startHost(server);
    const v1 = net.createConnection({ port: host.port, host: '127.0.0.1' });
    openClients.push(v1);
    v1.setEncoding('utf8');
    let text = '';
    v1.on('data', (c: string) => (text += c));
    v1.on('connect', () => v1.write(encodeLine({ type: 'join', name: 'Old' })));
    await closed(v1);
    expect(JSON.parse(text.trim())).toEqual({ type: 'error', reason: V1_REFUSAL });
    expect(server.roomState().players).toEqual([]);
  });

  it('one address cannot hold the connection slots with sockets that never say hello', async () => {
    // Review A8: silent sockets were never counted, so a tokenless peer could hold all 32 slots by
    // reconnecting each hello deadline. Now each address may have only a few sockets mid-handshake.
    const server = new RelayServer(OPTS, { crypto: testCrypto });
    host = await startHost(server);
    const silent: net.Socket[] = [];
    for (let i = 0; i < MAX_HANDSHAKING_PER_ADDRESS; i += 1) {
      const s = net.createConnection({ port: host.port, host: '127.0.0.1' });
      s.on('error', () => undefined);
      openClients.push(s);
      silent.push(s);
      await new Promise<void>((r) => s.on('connect', () => r()));
    }
    await new Promise((r) => setTimeout(r, 100));
    const extra = net.createConnection({ port: host.port, host: '127.0.0.1' });
    extra.on('error', () => undefined);
    openClients.push(extra);
    await closed(extra);
    expect(silent.every((s) => !s.destroyed), 'the earlier sockets are still waiting').toBe(true);
    // Once they go, the address may connect again, and a seated guest no longer counts.
    for (const s of silent) s.destroy();
    await new Promise((r) => setTimeout(r, 100));
    const guest = connectClient(host.port);
    await waitFor(() => guest.messages.some((m) => m.type === 'welcome'));
  });

  it('a socket that never says hello is dropped at the deadline', async () => {
    const server = new RelayServer(OPTS, { crypto: testCrypto });
    host = await startHost(server, { helloTimeoutMs: 200 });
    const silent = connectClient(host.port, { hello: false });
    await closed(silent.socket);
    expect(server.roomState().players).toEqual([]);
  });
});

/** The latest state message in a stream. */
function latest(msgs: ServerMessage[]): Extract<ServerMessage, { type: 'state' }> | undefined {
  return [...msgs].reverse().find((m): m is Extract<ServerMessage, { type: 'state' }> => m.type === 'state');
}
