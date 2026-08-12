import { afterEach, describe, expect, it } from 'vitest';
import { hostSession, joinSession, type RelaySession } from '../../src/main/relaySession.js';
import type { RoomView } from '../../src/core/multiplayer.js';

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

describe('host + join end to end', () => {
  it('a hosted game and a joined player each see only their own hole, and the deck never transits', async () => {
    const hostSide = collector();
    const { session: host, info } = await hostSession(OPTS, hostSide.callbacks);
    sessions.push(host);
    expect(info.port).toBeGreaterThan(0);

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
});
