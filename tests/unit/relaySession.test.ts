import { afterEach, describe, expect, it } from 'vitest';
import * as net from 'node:net';
import * as tls from 'node:tls';
import {
  FINGERPRINT_MISMATCH,
  SECURE_CONNECT_FAILED,
  hostSession,
  joinSession,
  lanAddresses,
  type HostInfo,
  type RelaySession,
} from '../../src/main/relaySession.js';
import { BAD_TOKEN, MAX_MESSAGE_BYTES } from '../../src/main/relayHost.js';
import { createTableCertificate } from '../../src/main/selfSignedCert.js';
import { parseInvite, type Invite } from '../../src/core/relayClient.js';
import type { RoomView } from '../../src/core/multiplayer.js';
import type * as os from 'node:os';

/** Build a fake os.networkInterfaces() entry with only the fields lanAddresses reads. */
function iface(over: Partial<os.NetworkInterfaceInfo>): os.NetworkInterfaceInfo {
  return {
    address: '0.0.0.0',
    netmask: '',
    family: 'IPv4',
    mac: '',
    internal: false,
    cidr: null,
    ...over,
  } as os.NetworkInterfaceInfo;
}

/**
 * RELAY SESSION — the main-process host/join lifecycle, proven with a REAL local host and a REAL
 * joining client over a socket. This is the whole multiplayer backend exercised end to end as the app
 * will use it: a local host player seated in-process, a remote player over TCP, and the redaction
 * guarantee holding for BOTH.
 */

const OPTS = { roomId: 'r1', seatCount: 3, sb: 25, bb: 50, startStack: 5000 } as const;

/** The loopback invite for a hosted table (the advertised ones carry LAN addresses). */
function loopback(info: HostInfo, over: Partial<Invite> = {}): Invite {
  return { host: '127.0.0.1', port: info.port, fingerprint: info.fingerprint, token: info.token, ...over };
}

const sessions: RelaySession[] = [];
afterEach(async () => {
  for (const s of sessions.splice(0)) await s.stop();
});

/** Collect the views/errors a session delivers to its callbacks. */
function collector() {
  const views: RoomView[] = [];
  const errors: string[] = [];
  return {
    views,
    errors,
    callbacks: { onState: (v: RoomView) => views.push(v), onError: (e: string) => errors.push(e) },
    latest: () => (views.length > 0 ? views[views.length - 1] : null),
  };
}

async function waitFor(predicate: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('lanAddresses — what a guest types to reach the host', () => {
  it('keeps external IPv4 and drops loopback, internal, and IPv6', () => {
    const addrs = lanAddresses({
      lo0: [
        iface({ address: '127.0.0.1', internal: true }),
        iface({ address: '::1', family: 'IPv6', internal: true }),
      ],
      en0: [
        iface({ address: '192.168.1.42', internal: false }),
        iface({ address: 'fe80::1', family: 'IPv6', internal: false }),
      ],
    });
    // Only the one routable IPv4 on en0 survives. If the internal/IPv6 filter were dropped this would
    // include 127.0.0.1 (unusable across machines) or an IPv6 address (the join box takes plain host:port).
    expect(addrs).toEqual(['192.168.1.42']);
  });

  it('accepts the Node >=18 numeric family (4) as well as the legacy string', () => {
    const addrs = lanAddresses({
      en0: [iface({ address: '10.0.0.5', family: 4 as unknown as 'IPv4', internal: false })],
    });
    // Modern Node reports family as the number 4, not the string 'IPv4'. Rejecting it would leave a
    // real LAN host with an empty address list on every current runtime.
    expect(addrs).toEqual(['10.0.0.5']);
  });

  it('returns every routable IPv4 when a machine has more than one', () => {
    const addrs = lanAddresses({
      en0: [iface({ address: '192.168.1.42' })],
      en1: [iface({ address: '10.0.0.5' })],
    });
    expect(addrs).toEqual(['192.168.1.42', '10.0.0.5']);
  });

  it('is empty when nothing is routable (loopback-only / no network)', () => {
    expect(lanAddresses({ lo0: [iface({ address: '127.0.0.1', internal: true })] })).toEqual([]);
  });
});

describe('host + join end to end', () => {
  it('a hosted game and a joined player each see only their own hole, and the deck never transits', async () => {
    const hostSide = collector();
    const { session: host, info } = await hostSession(OPTS, hostSide.callbacks);
    sessions.push(host);
    expect(info.port).toBeGreaterThan(0);
    // HostInfo carries the LAN address(es) a guest must type — a bare port is unusable across machines.
    // It mirrors this machine's routable IPv4s (may be empty on a network-less CI box; then it's just []).
    expect(info.addresses).toEqual(lanAddresses());
    // One invite per address, each parsing back to that address, this table's port, pin and token.
    expect(info.invites.map((i) => parseInvite(i))).toEqual(
      info.addresses.map((host) => ({ host, port: info.port, fingerprint: info.fingerprint, token: info.token })),
    );

    const guestSide = collector();
    const guest = joinSession(loopback(info), 'Guest', guestSide.callbacks);
    sessions.push(guest);

    // Once the guest joins, two players are present and the host deals; both sides get a hand-1 view.
    await waitFor(() => (hostSide.latest()?.handNumber ?? 0) >= 1);
    await waitFor(() => (guestSide.latest()?.handNumber ?? 0) >= 1);

    const hostView = hostSide.latest()!;
    const guestView = guestSide.latest()!;

    // Each side sees its OWN two cards and null for the opponent.
    expect(hostView.seats.find((s) => s.isYou)?.hole).toHaveLength(2);
    expect(guestView.seats.find((s) => s.isYou)?.hole).toHaveLength(2);
    for (const seat of hostView.seats) if (!seat.isYou) expect(seat.hole).toBeNull();
    for (const seat of guestView.seats) if (!seat.isYou) expect(seat.hole).toBeNull();

    // The deck never reached either side.
    expect(JSON.stringify(hostSide.views)).not.toContain('"deck"');
    expect(JSON.stringify(guestSide.views)).not.toContain('"deck"');
  });

  it('a guest can connect over the LAN address the host advertises, not just loopback', async () => {
    // The reason the host binds 0.0.0.0 instead of the 127.0.0.1 default: a guest on another machine
    // reaches it at the advertised LAN address. Connecting to that same address from here routes back to
    // the local listener ONLY when it is bound to all interfaces — a loopback bind refuses it. This is the
    // one test that fails if hostSession reverts to the loopback default. Skipped on a network-less box
    // (no routable IPv4 to advertise), where the LAN-reachability claim is vacuous anyway.
    const lan = lanAddresses()[0];
    if (lan === undefined) return;

    const hostSide = collector();
    const { session: host, info } = await hostSession(OPTS, hostSide.callbacks);
    sessions.push(host);
    expect(info.addresses).toContain(lan);

    const guestSide = collector();
    const guest = joinSession(loopback(info, { host: lan }), 'Guest', guestSide.callbacks);
    sessions.push(guest);

    // A hand only reaches the guest if the socket actually connected to the LAN-bound listener.
    await waitFor(() => (guestSide.latest()?.handNumber ?? 0) >= 1);
    expect(guestSide.errors).not.toContain('connection error');
  });

  it('an out-of-turn action from a side is refused to that side only, leaving the view intact', async () => {
    const hostSide = collector();
    const { session: host, info } = await hostSession(OPTS, hostSide.callbacks);
    sessions.push(host);
    const guestSide = collector();
    const guest = joinSession(loopback(info), 'Guest', guestSide.callbacks);
    sessions.push(guest);
    await waitFor(() => (hostSide.latest()?.handNumber ?? 0) >= 1 && (guestSide.latest()?.handNumber ?? 0) >= 1);

    // Whichever side is NOT to act folds; only that side should get an error.
    const hostToAct = hostSide.latest()!.yourTurn;
    if (hostToAct) {
      guest.action({ kind: 'fold' });
      await waitFor(() => guestSide.errors.includes('not your turn'));
      expect(hostSide.errors).not.toContain('not your turn');
    } else {
      host.action({ kind: 'fold' });
      await waitFor(() => hostSide.errors.includes('not your turn'));
      expect(guestSide.errors).not.toContain('not your turn');
    }
  });

  it('the player to act can fold, ending the hand, and the host can deal the next one', async () => {
    const hostSide = collector();
    const { session: host, info } = await hostSession(OPTS, hostSide.callbacks);
    sessions.push(host);
    const guestSide = collector();
    const guest = joinSession(loopback(info), 'Guest', guestSide.callbacks);
    sessions.push(guest);
    await waitFor(() => (hostSide.latest()?.handNumber ?? 0) >= 1 && (guestSide.latest()?.handNumber ?? 0) >= 1);

    const firstHand = hostSide.latest()!.handNumber;
    // The side to act folds; heads-up that ends the hand (winners populated).
    if (hostSide.latest()!.yourTurn) host.action({ kind: 'fold' });
    else guest.action({ kind: 'fold' });
    await waitFor(() => hostSide.latest()?.winners !== null);

    // The host deals the next hand; both sides advance.
    host.dealNext();
    await waitFor(() => (hostSide.latest()?.handNumber ?? 0) > firstHand);
    expect(hostSide.latest()!.winners).toBeNull();
  });

  it('a JOINED (non-host) player can request the next hand, and the host relay deals it', async () => {
    const hostSide = collector();
    const { session: host, info } = await hostSession(OPTS, hostSide.callbacks);
    sessions.push(host);
    const guestSide = collector();
    const guest = joinSession(loopback(info), 'Guest', guestSide.callbacks);
    sessions.push(guest);
    await waitFor(() => (hostSide.latest()?.handNumber ?? 0) >= 1 && (guestSide.latest()?.handNumber ?? 0) >= 1);

    const firstHand = guestSide.latest()!.handNumber;
    // End the hand by folding whichever side is to act.
    if (hostSide.latest()!.yourTurn) host.action({ kind: 'fold' });
    else guest.action({ kind: 'fold' });
    await waitFor(() => guestSide.latest()?.winners !== null);

    // The GUEST asks for the next hand (a 'deal' request over the socket); the host relay deals it and
    // both sides advance — the guest is no longer stuck waiting on the host.
    guest.dealNext();
    await waitFor(() => (guestSide.latest()?.handNumber ?? 0) > firstHand);
    expect(guestSide.latest()!.winners).toBeNull();
    expect(hostSide.latest()!.handNumber).toBe(guestSide.latest()!.handNumber);
  });

  it('a joined client drops a host that floods an oversized frame instead of buffering it forever', async () => {
    // A rogue/buggy host that writes a colossal line with no newline would otherwise grow the join
    // socket's receive buffer without bound in the main process. Stand one up and assert the guard fires.
    // It speaks TLS and the invite pins its certificate, so the flood is past every handshake check.
    const cert = createTableCertificate();
    const rogueSockets: net.Socket[] = [];
    const rogue = tls.createServer({ key: cert.keyPem, cert: cert.certPem }, (socket) => {
      rogueSockets.push(socket);
      // Ignore the reset the client raises when it destroys the socket on overflow — an unhandled
      // 'error' on this side would otherwise throw out of the test.
      socket.on('error', () => undefined);
      socket.write('y'.repeat(MAX_MESSAGE_BYTES + 10));
    });
    await new Promise<void>((resolve) => rogue.listen(0, '127.0.0.1', resolve));
    const port = (rogue.address() as net.AddressInfo).port;

    try {
      const side = collector();
      const invite = { host: '127.0.0.1', port, fingerprint: cert.fingerprint, token: 'A'.repeat(22) };
      const session = joinSession(invite, 'Guest', side.callbacks);
      sessions.push(session);
      await waitFor(() => side.errors.includes('message too large'));
      expect(side.errors).toContain('message too large');
    } finally {
      // The client reset the connection mid-write, so the server-side socket lingers; destroy it
      // explicitly or server.close()'s callback never fires.
      for (const s of rogueSockets) s.destroy();
      await new Promise<void>((resolve) => rogue.close(() => resolve()));
    }
  });

  it('the deal arrives verified: the guest checks every card it saw by the end of the hand', async () => {
    const hostSide = collector();
    const { session: host, info } = await hostSession(OPTS, hostSide.callbacks);
    sessions.push(host);
    const verified: number[] = [];
    const guestSide = collector();
    const guest = joinSession(loopback(info), 'Guest', { ...guestSide.callbacks, onVerified: (hand) => verified.push(hand) });
    sessions.push(guest);
    await waitFor(() => (guestSide.latest()?.handNumber ?? 0) >= 1);
    if (hostSide.latest()!.yourTurn) host.action({ kind: 'fold' });
    else guest.action({ kind: 'fold' });
    await waitFor(() => verified.length === 1);
    expect(guestSide.errors).toEqual([]);
  });
});

describe('joining safely — pin, token, versions, reconnect', () => {
  it('a certificate that does not match the invite is refused before the token is ever sent', async () => {
    const hostSide = collector();
    const { session: host, info } = await hostSession(OPTS, hostSide.callbacks);
    sessions.push(host);
    const other = createTableCertificate(); // an interceptor's certificate
    const side = collector();
    sessions.push(joinSession(loopback(info, { fingerprint: other.fingerprint }), 'Guest', side.callbacks));
    await waitFor(() => side.errors.length > 0);
    expect(side.errors).toEqual([FINGERPRINT_MISMATCH]);
    // The host never seated anyone: its own view still has just the host's seat.
    await new Promise((r) => setTimeout(r, 100));
    expect(hostSide.latest()!.seats).toHaveLength(1);
  });

  it('a man in the middle with its own certificate never learns the room token', async () => {
    // The interceptor terminates TLS with its own certificate and records whatever the guest sends.
    const cert = createTableCertificate();
    const heard: string[] = [];
    const mitm = tls.createServer({ key: cert.keyPem, cert: cert.certPem }, (socket) => {
      socket.setEncoding('utf8');
      socket.on('data', (c: string) => heard.push(c));
      socket.on('error', () => undefined);
    });
    await new Promise<void>((r) => mitm.listen(0, '127.0.0.1', r));
    const { port } = mitm.address() as net.AddressInfo;
    try {
      const realCert = createTableCertificate();
      const side = collector();
      const token = 'Q'.repeat(22);
      sessions.push(joinSession({ host: '127.0.0.1', port, fingerprint: realCert.fingerprint, token }, 'G', side.callbacks));
      await waitFor(() => side.errors.length > 0);
      expect(side.errors).toEqual([FINGERPRINT_MISMATCH]);
      expect(heard.join('')).not.toContain(token);
    } finally {
      await new Promise<void>((r) => mitm.close(() => r()));
    }
  });

  it('a wrong token gets the host’s refusal and no seat', async () => {
    const hostSide = collector();
    const { session: host, info } = await hostSession(OPTS, hostSide.callbacks);
    sessions.push(host);
    const side = collector();
    sessions.push(joinSession(loopback(info, { token: 'B'.repeat(22) }), 'Guest', side.callbacks));
    await waitFor(() => side.errors.length > 0);
    expect(side.errors[0]).toBe(BAD_TOKEN);
    expect(hostSide.latest()!.seats).toHaveLength(1);
  });

  it('a v2 guest pointed at a v1 (plaintext) host says so instead of hanging', async () => {
    const v1 = net.createServer((socket) => {
      socket.on('error', () => undefined);
      socket.write('{"type":"state","view":{}}\n');
    });
    await new Promise<void>((r) => v1.listen(0, '127.0.0.1', r));
    const { port } = v1.address() as net.AddressInfo;
    try {
      const side = collector();
      sessions.push(joinSession({ host: '127.0.0.1', port, fingerprint: 'A'.repeat(43), token: 'A'.repeat(22) }, 'G', side.callbacks));
      await waitFor(() => side.errors.length > 0);
      expect(side.errors).toEqual([SECURE_CONNECT_FAILED]);
    } finally {
      v1.close();
    }
  });

  it('a guest that leaves can rejoin with the same invite; an invite for a closed table cannot', async () => {
    const hostSide = collector();
    const { session: host, info } = await hostSession(OPTS, hostSide.callbacks);
    sessions.push(host);
    const first = collector();
    const g1 = joinSession(loopback(info), 'Guest', first.callbacks);
    await waitFor(() => (first.latest()?.handNumber ?? 0) >= 1);
    await g1.stop();

    const again = collector();
    sessions.push(joinSession(loopback(info), 'Guest', again.callbacks));
    await waitFor(() => again.views.length > 0);
    expect(again.errors).toEqual([]);

    // The host closes and hosts a new table: a fresh certificate and token, so the old invite is dead.
    await host.stop();
    const { session: next, info: nextInfo } = await hostSession(OPTS, collector().callbacks);
    sessions.push(next);
    expect(nextInfo.fingerprint).not.toBe(info.fingerprint);
    expect(nextInfo.token).not.toBe(info.token);
    const stale = collector();
    sessions.push(joinSession(loopback(nextInfo, { fingerprint: info.fingerprint, token: info.token }), 'G', stale.callbacks));
    await waitFor(() => stale.errors.length > 0);
    expect(stale.errors).toEqual([FINGERPRINT_MISMATCH]);
  });
});
