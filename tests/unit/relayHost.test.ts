import { afterEach, describe, expect, it } from 'vitest';
import * as net from 'node:net';
import {
  createRelayHost,
  encodeLine,
  parseClientMessage,
  splitLines,
  type RelayHost,
} from '../../src/main/relayHost.js';
import { RelayServer } from '../../src/core/relayServer.js';
import type { ServerMessage } from '../../src/core/multiplayer.js';

/**
 * RELAY HOST — the node:net transport around the (already-tested) RelayServer.
 *
 * The framing helpers are pure and tested directly. The transport itself is proven with REAL sockets
 * against a local host on an ephemeral port — "test locally against a local server first". The single
 * most important end-to-end assertion is that a card never crosses the wire to the wrong player: two
 * connected clients each receive their own hole and null for the opponent's.
 */

const OPTS = { roomId: 'r1', seatCount: 3, sb: 25, bb: 50, startStack: 5000, seed: 42 } as const;

let host: RelayHost | null = null;
const openClients: net.Socket[] = [];

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
    expect(parseClientMessage('{"type":"join","name":"Al"}')).toEqual({ type: 'join', name: 'Al' });
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

  it('encodeLine appends exactly one newline', () => {
    expect(encodeLine({ type: 'error', reason: 'x' })).toBe('{"type":"error","reason":"x"}\n');
  });
});

/** Connect a raw client and collect parsed server messages as they arrive. */
function connectClient(port: number): { socket: net.Socket; messages: ServerMessage[] } {
  const socket = net.createConnection({ port, host: '127.0.0.1' });
  socket.setEncoding('utf8');
  openClients.push(socket);
  const messages: ServerMessage[] = [];
  let buffer = '';
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    const { lines, rest } = splitLines(buffer);
    buffer = rest;
    for (const line of lines) messages.push(JSON.parse(line) as ServerMessage);
  });
  return { socket, messages };
}

/** Resolve once `predicate` holds or a short timeout elapses (polling, no fixed sleep). */
async function waitFor(predicate: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for a socket condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('real socket round-trip', () => {
  it('two clients connect, a hand is dealt, and each sees only their own hole', async () => {
    const server = new RelayServer(OPTS);
    host = await createRelayHost({ server });

    const a = connectClient(host.port);
    await waitFor(() => a.messages.length >= 1);
    const b = connectClient(host.port);
    // Once the second client joins, the server auto-deals and broadcasts a state to both.
    await waitFor(() => a.messages.some((m) => m.type === 'state' && m.view.handNumber >= 1));
    await waitFor(() => b.messages.some((m) => m.type === 'state' && m.view.handNumber >= 1));

    const latest = (msgs: ServerMessage[]) =>
      [...msgs].reverse().find((m): m is Extract<ServerMessage, { type: 'state' }> => m.type === 'state');
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
    const server = new RelayServer(OPTS);
    host = await createRelayHost({ server });

    const a = connectClient(host.port);
    await waitFor(() => a.messages.length >= 1);
    const b = connectClient(host.port);
    await waitFor(() => a.messages.some((m) => m.type === 'state' && m.view.handNumber >= 1));

    // Whichever client is NOT to act tries to fold; the server must reject only to them.
    const aToAct = latest2(a.messages);
    const offClient = aToAct ? b : a;
    offClient.socket.write(encodeLine({ type: 'action', action: { kind: 'fold' } }));
    await waitFor(() => offClient.messages.some((m) => m.type === 'error'));
    const err = offClient.messages.find((m) => m.type === 'error');
    expect(err && err.type === 'error' ? err.reason : '').toBe('not your turn');
  });
});

/** True if client a's latest state view says it is a's turn. */
function latest2(msgs: ServerMessage[]): boolean {
  const view = [...msgs].reverse().find((m) => m.type === 'state');
  return view && view.type === 'state' ? view.view.yourTurn : false;
}
