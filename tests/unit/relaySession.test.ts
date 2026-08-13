import { afterEach, describe, expect, it } from 'vitest';
import { hostSession, joinSession, lanAddresses, type RelaySession } from '../../src/main/relaySession.js';
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

const OPTS = { roomId: 'r1', seatCount: 3, sb: 25, bb: 50, startStack: 5000, seed: 42 } as const;

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

    const guestSide = collector();
    const guest = joinSession({ host: '127.0.0.1', port: info.port }, 'Guest', guestSide.callbacks);
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
    const guest = joinSession({ host: lan, port: info.port }, 'Guest', guestSide.callbacks);
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
    const guest = joinSession({ host: '127.0.0.1', port: info.port }, 'Guest', guestSide.callbacks);
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
    const guest = joinSession({ host: '127.0.0.1', port: info.port }, 'Guest', guestSide.callbacks);
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
    const guest = joinSession({ host: '127.0.0.1', port: info.port }, 'Guest', guestSide.callbacks);
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
});
