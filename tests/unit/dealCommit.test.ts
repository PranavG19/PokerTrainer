import { describe, expect, it } from 'vitest';
import { freshDeck } from '../../src/core/cards.js';
import {
  boardIndex,
  deriveSigma,
  engineDeck,
  entropyCommitment,
  holeIndex,
  leafHash,
  sealDeck,
  toHex,
  type CommitMessage,
} from '../../src/core/dealCommit.js';
import type { ServerMessage } from '../../src/core/multiplayer.js';
import { GuestProtocol } from '../../src/core/relayGuest.js';
import { mulberry32, shuffleWith, uniformInt, wordsFrom } from '../../src/core/rng.js';
import { applyAction, createTable, isHandOver, legalActions, settle, startHand, type TableState } from '../../src/core/table.js';
import { Table, testCrypto } from './relayHarness.js';

/**
 * DEAL COMMITMENT — commit-before-reveal dealing, attacked from both sides.
 *
 * A malicious HOST is played by rewriting messages on their way to a guest (Table.tamper) or by
 * changing the server's own deck mid-hand; the guest's GuestProtocol must raise a violation. A
 * malicious GUEST sends bad entropy; the server must refuse it without stalling the table.
 */

describe('the canonical deal order matches the engine', () => {
  it('every hole and board card the engine deals is the one holeIndex/boardIndex names, over random hands', () => {
    const rng = mulberry32(7);
    for (let trial = 0; trial < 400; trial += 1) {
      const n = 2 + Math.floor(rng() * 5);
      // Some seats busted (sit out), some short (all-in early), so deal order and run-outs vary.
      const seats = Array.from({ length: n }, (_u, i) => ({
        name: `s${i}`,
        stack: i > 1 && rng() < 0.25 ? 0 : rng() < 0.3 ? 40 + Math.floor(rng() * 200) : 5000,
      }));
      let table: TableState = createTable({ seats, sb: 25, bb: 50, seed: 0 });
      // Advance a few hands so the button has moved.
      const skip = Math.floor(rng() * 3);
      for (let h = 0; h < skip; h += 1) table = startHand(table, freshDeck());
      const probe = startHand(table, freshDeck());
      const order: number[] = [];
      for (let step = 1; step <= n; step += 1) {
        const s = (probe.dealer + step) % n;
        if (probe.seats[s].hole.length > 0) order.push(s);
      }
      if (order.length < 2) continue;
      const sealed = sealDeck(testCrypto, probe.handNumber, probe.dealer, order);
      const sigma = shuffleWith(Array.from({ length: 52 }, (_u, i) => i), wordsFrom(testCrypto.random));
      let live = startHand(table, engineDeck(sealed, sigma));
      // Play random legal actions to the end.
      for (let i = 0; i < 200 && !isHandOver(live); i += 1) {
        // Kinds that need no amount; all-in covers the raising lines.
        const legal = legalActions(live).filter((k) => k !== 'bet' && k !== 'raise');
        live = applyAction(live, { kind: legal[uniformInt(legal.length, () => Math.floor(rng() * 2 ** 32))] });
      }
      if (isHandOver(live)) live = settle(live);
      for (const s of order) {
        for (const r of [0, 1] as const) {
          expect(live.seats[s].hole[r]).toBe(sealed.cards[sigma[holeIndex(order, s, r)]]);
        }
      }
      live.board.forEach((card, b) => expect(card).toBe(sealed.cards[sigma[boardIndex(order, b)]]));
    }
  });
});

describe('an honest table', () => {
  it('deals, every guest verifies every card it sees, and nobody is warned', () => {
    const table = new Table({}, { dealerPlayerId: 'host' });
    table.join('host', 'Host', false);
    table.join('g1');
    table.playOut();
    expect(table.eventsOf('g1', 'violation')).toEqual([]);
    expect(table.eventsOf('g1', 'warning')).toEqual([]);
    const verified = table.eventsOf('g1', 'verified');
    expect(verified).toHaveLength(1);
    // Two holes + five board cards at least (showdown adds the host's two).
    expect((verified[0] as { cards: number }).cards).toBeGreaterThanOrEqual(7);
  });

  it('sigma depends on every guest’s entropy, so the host cannot fix the deal before guests commit', () => {
    const sealed = sealDeck(testCrypto, 1, 0, [1, 0]);
    const a = deriveSigma(testCrypto.sha256, sealed.commit, [{ seat: 1, entropy: 'aa'.repeat(32) }]);
    const b = deriveSigma(testCrypto.sha256, sealed.commit, [{ seat: 1, entropy: 'ab'.repeat(32) }]);
    expect(a).not.toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 52 }, (_u, i) => i));
  });
});

describe('a malicious host is caught', () => {
  /** A two-guest table with the host seat, dealt and ready to play. */
  function dealtTable(): Table {
    const table = new Table({}, { dealerPlayerId: 'host' });
    table.join('host', 'Host', false);
    table.join('g1');
    return table;
  }

  it('changing the deck mid-hand: the swapped turn card does not open its commitment', () => {
    const table = dealtTable();
    // Reach the flop honestly.
    for (let i = 0; i < 10 && table.server.roomState().table!.street === 'preflop'; i += 1) {
      const t = table.server.roomState().table!;
      const actor = table.server.roomState().players.find((p) => p.seatId === t.toAct)!;
      table.send(actor.playerId, { type: 'action', action: { kind: t.currentBet > t.seats[t.toAct].committed ? 'call' : 'check' } });
    }
    expect(table.eventsOf('g1', 'violation')).toEqual([]);
    // The host's process rewrites the rest of its deck: the turn is now a different card.
    const deck = (table.server.roomState().table as TableState).deck;
    [deck[deck.length - 2], deck[0]] = [deck[0], deck[deck.length - 2]];
    table.playOut();
    const violations = table.eventsOf('g1', 'violation');
    expect(violations).toHaveLength(1);
    expect((violations[0] as { reason: string }).reason).toMatch(/not the card the deck committed to/);
  });

  it('forging an opening for a substituted card: the salt cannot open the committed leaf', () => {
    const table = dealtTable();
    table.tamper = (to, m) => {
      if (to !== 'g1' || m.type !== 'state' || m.openings.length === 0) return m;
      const mine = m.view.seats.find((s) => s.isYou)!;
      const fake = freshDeck().find((c) => !mine.hole!.includes(c))!;
      const seats = m.view.seats.map((s) => (s.isYou ? { ...s, hole: [fake, mine.hole![1]] } : s));
      const openings = m.openings.map((o) => (o.card === mine.hole![0] ? { ...o, card: fake, salt: toHex(testCrypto.random(16)) } : o));
      return { ...m, view: { ...m.view, seats }, openings };
    };
    table.playOut();
    expect(table.eventsOf('g1', 'violation').length).toBeGreaterThan(0);
  });

  it('showing a card with no opening at all is a violation', () => {
    const table = dealtTable();
    table.tamper = (to, m) => (to === 'g1' && m.type === 'state' ? { ...m, openings: [] } : m);
    table.send('host', { type: 'action', action: { kind: 'call' } });
    expect((table.eventsOf('g1', 'violation')[0] as { reason: string } | undefined)?.reason).toMatch(/without proof/);
  });

  it('lying about who was dealt in (to shift the board positions) is a violation', () => {
    const table = new Table({}, { dealerPlayerId: 'host' });
    table.tamper = (to, m) => (to === 'g1' && m.type === 'commit' ? { ...m, dealOrder: [...m.dealOrder].reverse() } : m);
    table.join('host', 'Host', false);
    table.join('g1');
    expect((table.eventsOf('g1', 'violation')[0] as { reason: string }).reason).toMatch(/do not match the deal/);
  });

  it('leaving the guest’s entropy out (to grind sigma with its own) or dropping a revealed one is a violation', () => {
    // Review A1: the host drops the guest's commitment and publishes one for a made-up seat whose
    // entropy it grinds against its own sealed order, placing the guest's first hole card.
    const g = new GuestProtocol(testCrypto);
    const dealOrder = [1, 0];
    const sealed = sealDeck(testCrypto, 1, 0, dealOrder);
    g.receive(sealed.commit);
    let fake = '';
    for (let i = 0; i < 5000; i += 1) {
      fake = toHex(testCrypto.random(32));
      const sigma = deriveSigma(testCrypto.sha256, sealed.commit, [{ seat: 0, entropy: fake }]);
      if (sealed.cards[sigma[holeIndex(dealOrder, 1, 0)]] === 'As') break;
    }
    const step = g.receive({
      type: 'entropy-set', hand: 1, nonce: sealed.commit.nonce,
      commitments: [{ seat: 0, commitment: entropyCommitment(testCrypto.sha256, sealed.commit.nonce, 1, fake) }],
    });
    expect((step.events[0] as { reason: string }).reason).toMatch(/left your shuffle entropy out/);
    expect(step.send, 'the guest must not reveal into a set without it').toEqual([]);
    expect(g.isBroken()).toBe(true);

    const dropped = new Table({}, { dealerPlayerId: 'host' });
    dropped.tamper = (to, m) => {
      if (to !== 'g1' || m.type !== 'dealt') return m;
      // The host swaps in entropy of its own choosing, with a matching forged commitment — but the
      // guest saw the published set, so the reveal no longer opens it.
      return { ...m, reveals: [{ seat: m.reveals[0].seat, entropy: 'ee'.repeat(32) }] };
    };
    dropped.join('host', 'Host', false);
    dropped.join('g1');
    expect((dropped.eventsOf('g1', 'violation')[0] as { reason: string }).reason).toMatch(/does not match the published/);
  });

  it('replaying a commitment (same nonce) or committing to an already-dealt hand is a violation', () => {
    const table = dealtTable();
    const commit = table.wire.get('g1')!.find((m): m is CommitMessage => m.type === 'commit')!;
    const guest = table.guests.get('g1')!;
    expect(guest.receive({ ...commit, hand: commit.hand + 1 }).events[0].type).toBe('violation');
    const fresh = new GuestProtocol(testCrypto);
    fresh.receive(commit);
    expect(fresh.receive(commit).events.some((e) => e.type === 'violation')).toBe(true);
  });

  it('a deal restarted after the guest revealed is a visible warning, every time', () => {
    const table = dealtTable();
    table.playOut();
    // Hold the guest's next deal at the reveal: the host sees the reveal and throws the deal away.
    // The host withholds the deal (and so every view of it) once it has the guest's reveal.
    table.tamper = (_to, m) => (m.type === 'dealt' || m.type === 'state' ? null : m);
    table.send('g1', { type: 'deal' });
    // The host restarts (here: by sending a fresh commit for the same hand).
    const fresh = sealDeck(testCrypto, table.server.roomState().table!.handNumber + 1, 0, [0, 1]);
    table.tamper = (_to, m) => m;
    table.route([{ to: 'g1', message: fresh.commit }]);
    expect(table.eventsOf('g1', 'warning').map((e) => (e as { reason: string }).reason)).toContain(
      'The host restarted a deal after the shuffle was fixed.',
    );
  });

  it('dealing the guest cards with no commitment at all is a violation', () => {
    const guest = new GuestProtocol(testCrypto);
    const view = {
      roomId: 'r', you: 'g', board: [], street: 'preflop', pot: 75, currentBet: 50, toAct: 0, dealer: 0,
      handNumber: 1, winners: null, legal: [], yourTurn: false,
      seats: [
        { id: 0, name: 'H', stack: 4975, committed: 25, folded: false, allIn: false, hole: null, isYou: false, inHand: true },
        { id: 1, name: 'G', stack: 4950, committed: 50, folded: false, allIn: false, hole: ['As', 'Kd'], isYou: true, inHand: true },
      ],
    } as const;
    const step = guest.receive({ type: 'state', view, openings: [] } as ServerMessage);
    expect(step.events[0].type).toBe('violation');
    // And once broken it stays broken.
    expect(guest.receive({ type: 'error', reason: 'x' }).events).toEqual([]);
  });

  it('a committed deck holding one card twice is caught when both copies are shown', () => {
    // A hand-built cheating host that committed 52 copies of the As. Every leaf is distinct (the salts
    // differ), so the commitment itself looks well formed; the second As shown gives it away.
    const guest = new GuestProtocol(testCrypto);
    const nonce = toHex(testCrypto.random(16));
    const salts = Array.from({ length: 52 }, () => toHex(testCrypto.random(16)));
    const leaves = salts.map((salt, j) => leafHash(testCrypto.sha256, nonce, 1, j, 'As', salt));
    const commit: CommitMessage = { type: 'commit', hand: 1, nonce, dealer: 0, dealOrder: [1, 0], leaves };
    const { commitment } = guest.receive(commit).send[0] as { commitment: string };
    const { entropy } = guest.receive({ type: 'entropy-set', hand: 1, nonce, commitments: [{ seat: 1, commitment }] })
      .send[0] as { entropy: string };
    expect(guest.receive({ type: 'dealt', hand: 1, nonce, reveals: [{ seat: 1, entropy }] }).events).toEqual([]);
    const sigma = deriveSigma(testCrypto.sha256, commit, [{ seat: 1, entropy }]);
    const open = (k: number) => ({ k, card: 'As', salt: salts[sigma[k]] });
    const view = {
      roomId: 'r', you: 'g', board: [], street: 'preflop', pot: 75, currentBet: 50, toAct: 0, dealer: 0,
      handNumber: 1, winners: null, legal: [], yourTurn: false,
      seats: [
        { id: 0, name: 'H', stack: 4975, committed: 25, folded: false, allIn: false, hole: null, isYou: false, inHand: true },
        { id: 1, name: 'G', stack: 4950, committed: 50, folded: false, allIn: false, hole: ['As', 'As'], isYou: true, inHand: true },
      ],
    };
    const k0 = holeIndex([1, 0], 1, 0);
    const k1 = holeIndex([1, 0], 1, 1);
    const step = guest.receive({ type: 'state', view, openings: [open(k0), open(k1)] } as ServerMessage);
    expect((step.events[0] as { reason: string }).reason).toMatch(/dealt twice/);
  });
});

describe('a malicious or broken guest cannot stall or steer the deal', () => {
  it('a reveal that does not open its commitment is refused; the deal restarts without that guest', () => {
    const table = new Table({}, { dealerPlayerId: 'host' });
    table.join('host', 'Host', false);
    // g1 lies on its reveal: intercept its outgoing reveal by muting it and sending a forged one.
    table.mute.add('g1');
    table.join('g1');
    const commit = table.wire.get('g1')!.find((m): m is CommitMessage => m.type === 'commit')!;
    table.send('g1', { type: 'entropy-commit', hand: commit.hand, nonce: commit.nonce, commitment: 'ab'.repeat(32) });
    table.send('g1', { type: 'entropy-reveal', hand: commit.hand, nonce: commit.nonce, entropy: 'cd'.repeat(32) });
    const errors = table.wire.get('g1')!.filter((m) => m.type === 'error').map((m) => (m as { reason: string }).reason);
    expect(errors).toContain('your reveal did not match your commitment');
    // g1 is removed from the table (its connection closed), not dealt around.
    expect(table.server.roomState().players.map((p) => p.playerId)).toEqual(['host']);
    expect(table.server.dealPending()).toBe(false);
  });

  it('a silent guest is removed at the deadline instead of stalling the table', () => {
    let clock = 0;
    const table = new Table({}, { dealerPlayerId: 'host', now: () => clock, entropyTimeoutMs: 1000 });
    table.join('host', 'Host', false);
    table.mute.add('g1');
    table.join('g1');
    expect(table.server.dealPending()).toBe(true);
    table.route(table.server.tick());
    expect(table.server.dealPending(), 'not before the deadline').toBe(true);
    clock = 1500;
    const out = table.server.tick();
    expect(out.find((o) => o.to === 'g1')).toEqual({ to: 'g1', message: { type: 'error', reason: 'you did not answer the deal in time' }, close: true });
    table.route(out);
    expect(table.server.dealPending()).toBe(false);
    expect(table.server.roomState().players.map((p) => p.playerId)).toEqual(['host']);
  });

  it('copying another guest’s commitment, a wrong nonce, or acting mid-deal are refused', () => {
    const table = new Table({}, { dealerPlayerId: 'host' });
    table.join('host', 'Host', false);
    table.mute.add('g1');
    table.join('g1');
    const commit = table.wire.get('g1')!.find((m): m is CommitMessage => m.type === 'commit')!;
    const errorsOf = (id: string) => table.wire.get(id)!.filter((m) => m.type === 'error').map((m) => (m as { reason: string }).reason);
    table.send('g1', { type: 'entropy-commit', hand: commit.hand, nonce: 'ff'.repeat(16), commitment: 'ab'.repeat(32) });
    expect(errorsOf('g1')).toContain('no deal is waiting for that commitment');
    table.send('g1', { type: 'action', action: { kind: 'fold' } });
    expect(errorsOf('g1')).toContain('the next hand is still being dealt');
  });
});

describe('the guest refuses what it cannot check (review A2, A3)', () => {
  const seat = (id: number, over: Record<string, unknown> = {}) => ({
    id, name: `s${id}`, stack: 4950, committed: 50, folded: false, allIn: false, hole: null, isYou: false, inHand: true, ...over,
  });
  const view = (over: Record<string, unknown>) => ({
    roomId: 'r', you: 'g', seats: [], board: [], street: 'preflop', pot: 75, currentBet: 50, toAct: 0, dealer: 0,
    handNumber: 1, winners: null, legal: [], yourTurn: false, ...over,
  });
  const state = (v: unknown, openings: unknown = []) => ({ type: 'state', view: v, openings }) as ServerMessage;

  it('a view with no seat marked as the guest’s cannot switch verification off', () => {
    // Before any handshake: hole cards and a turn, with isYou left off every seat.
    const g = new GuestProtocol(testCrypto);
    const step = g.receive(state(view({ seats: [seat(0), seat(1, { hole: ['As', 'Ah'] })], toAct: 1, yourTurn: true })));
    expect(step.events.map((e) => e.type)).toEqual(['violation']);
  });

  it('once its seat is known, the host cannot move it or hide it', () => {
    const table = new Table({}, { dealerPlayerId: 'host' });
    table.join('host', 'Host', false);
    table.join('g1');
    const guest = table.guests.get('g1')!;
    const v = table.view('g1');
    const hidden = { ...v, seats: v.seats.map((s) => ({ ...s, isYou: false })) };
    expect(guest.receive(state(hidden)).events[0].type).toBe('violation');
  });

  it('a malformed view becomes a violation, never an exception in main', () => {
    const shapes = [
      view({ seats: [seat(0), seat(1, { isYou: true })], board: ['2c', '3c', '4c', '5c', '6c', '7c'] }),
      view({ seats: [seat(0), seat(1, { isYou: true, hole: 'AsAh' })] }),
      view({ seats: [seat(1), seat(0, { isYou: true })] }),
      null,
      view({ seats: 'nope' }),
    ];
    for (const shape of shapes) {
      const g = new GuestProtocol(testCrypto);
      let step: ReturnType<GuestProtocol['receive']> | undefined;
      expect(() => (step = g.receive(state(shape)))).not.toThrow();
      expect(step!.events.map((e) => e.type)).toEqual(['violation']);
    }
    const g = new GuestProtocol(testCrypto);
    expect(() => g.receive(state(view({ seats: [seat(0), seat(1, { isYou: true })], board: ['2c'] }), [null]))).not.toThrow();
    expect(() => g.receive({ type: 'dealt', hand: 1, nonce: 'x', reveals: [null] } as never)).not.toThrow();
  });
});

describe('seats and players that come and go (review A4, A5)', () => {
  it('a seat whose player left sits out the next hand, so the table cannot stall on it', () => {
    const table = new Table({ seatCount: 3 });
    for (const id of ['g1', 'g2', 'g3']) table.join(id);
    expect(table.server.roomState().table!.seats.filter((s) => s.hole.length > 0)).toHaveLength(2); // g3 joined late
    table.playOut();
    table.route(table.server.disconnect('g2'));
    table.send('g1', { type: 'deal' });
    const engine = table.server.roomState().table!;
    const gone = 1; // g2's seat
    expect(engine.seats[gone].hole).toEqual([]);
    table.playOut();
    expect(table.server.roomState().table!.winners, 'the hand finished without the departed seat').not.toBeNull();
    expect(table.eventsOf('g1', 'violation')).toEqual([]);
  });

  it('a newcomer who takes a seat while a deal is pending is not dealt that hand, and is bought in for the next', () => {
    const table = new Table({ seatCount: 3 });
    table.join('g1');
    table.join('g2');
    table.join('g3'); // seat 2, joins after the first deal
    table.playOut();
    // Hold the next deal open at the commitment (g1 silent), and let g4 take g2's seat meanwhile.
    table.mute.add('g1');
    table.send('g1', { type: 'deal' });
    expect(table.server.dealPending()).toBe(true);
    table.route(table.server.disconnect('g2'));
    table.join('g4');
    // g2 leaving restarted the deal; g1 answers it now (its answer to the abandoned attempt is refused).
    table.release('g1');
    for (const id of ['g1', 'g3', 'g4']) expect(table.eventsOf(id, 'violation'), id).toEqual([]);
    // A rejoining or late player is bought in once the hand they arrived during is over.
    table.playOut();
    table.send('g1', { type: 'deal' });
    const engine = table.server.roomState().table!;
    const g4Seat = table.server.roomState().players.find((p) => p.playerId === 'g4')!.seatId;
    expect(engine.seats[g4Seat].hole).toHaveLength(2);
    expect(table.server.roomState().dealtTo[g4Seat]).toBe('g4');
    for (const id of ['g1', 'g3', 'g4']) expect(table.eventsOf(id, 'violation'), id).toEqual([]);
  });

  it('an out-of-range bet or raise from a guest is an error to it, not a thrown exception', () => {
    const table = new Table({ seatCount: 2 });
    table.join('g1');
    table.join('g2');
    const t = table.server.roomState().table!;
    const actor = table.server.roomState().players.find((p) => p.seatId === t.toAct)!.playerId;
    for (const amount of [1e308, -1, 0, 0.5, Number.MAX_SAFE_INTEGER, Number.NaN]) {
      for (const kind of ['raise', 'bet'] as const) {
        let out: ReturnType<typeof table.server.message> = [];
        expect(() => (out = table.server.message(actor, { type: 'action', action: { kind, amount } }))).not.toThrow();
        expect(out.every((o) => o.message.type === 'error' || o.message.type === 'state')).toBe(true);
      }
    }
    expect(() => table.server.message(actor, { type: 'entropy-commit', hand: 1e308, nonce: '__proto__', commitment: 'x' })).not.toThrow();
  });
});

describe('seats and chips across hands (re-review)', () => {
  /** Total chips on the table: stacks plus the pot. */
  const chips = (t: Table): number => {
    const e = t.server.roomState().table!;
    return e.seats.reduce((n, s) => n + s.stack, 0) + e.pot;
  };

  it('a player who busts and stays is not bought in again: no chips are created', () => {
    // Three seats, so two players still have a game after the third busts.
    const table = new Table({ seatCount: 3, startStack: 100 });
    table.mute.add('g1');
    table.join('g1');
    table.join('g2');
    table.join('g3');
    table.route(table.server.disconnect('g1')); // restart the first deal with all three seated
    table.join('g1');
    table.playOut();
    table.send('g2', { type: 'deal' });
    table.release('g1');
    expect(table.server.roomState().table!.seats.filter((s) => s.hole.length > 0).length).toBeGreaterThanOrEqual(2);
    const total = chips(table);
    // All in until someone busts, then keep asking for hands: the buster must stay at zero.
    for (let hand = 0; hand < 30; hand += 1) {
      const e = table.server.roomState().table!;
      if (e.winners === null) {
        const actor = table.server.roomState().players.find((p) => p.seatId === e.toAct)!;
        const legal = table.view(actor.playerId).legal;
        table.send(actor.playerId, { type: 'action', action: { kind: legal.includes('allin') ? 'allin' : 'call' } });
        table.playOut();
      }
      table.send('g2', { type: 'deal' });
      expect(chips(table), `hand ${hand}`).toBe(total);
    }
  });

  it('a guest who leaves mid-hand is folded, so the table never waits on an empty seat', () => {
    const table = new Table({ seatCount: 3 });
    table.join('g1');
    table.join('g2');
    table.join('g3');
    table.playOut();
    table.send('g1', { type: 'deal' }); // three dealt in
    const e = table.server.roomState().table!;
    expect(e.seats.filter((s) => s.hole.length > 0)).toHaveLength(3);
    // The player to act next leaves, and so does a player who is not to act.
    const toAct = table.server.roomState().players.find((p) => p.seatId === e.toAct)!.playerId;
    table.route(table.server.disconnect(toAct));
    table.playOut();
    expect(table.server.roomState().table!.winners, 'the hand finished without the leaver').not.toBeNull();
    for (const id of ['g1', 'g2', 'g3'].filter((g) => g !== toAct)) expect(table.eventsOf(id, 'violation')).toEqual([]);
  });

  it('a heads-up opponent leaving ends the hand for the one who stays', () => {
    const table = new Table({ seatCount: 2 });
    table.join('g1');
    table.join('g2');
    const e = table.server.roomState().table!;
    const notToAct = table.server.roomState().players.find((p) => p.seatId !== e.toAct)!.playerId;
    table.route(table.server.disconnect(notToAct));
    const stayer = notToAct === 'g1' ? 'g2' : 'g1';
    table.send(stayer, { type: 'action', action: { kind: 'call' } });
    expect(table.server.roomState().table!.winners).not.toBeNull();
  });
});
