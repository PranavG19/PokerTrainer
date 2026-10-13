/**
 * THE ONLINE SERVER, END TO END ON LOCALHOST — the real server (server/transport.ts) over TLS 1.3, against
 * two or more headless clients running the app's own OnlineSession. Nothing here is public: the server
 * binds 127.0.0.1 on an ephemeral port and every client pins its throwaway certificate.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as tls from 'node:tls';
import { afterEach, describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import { gradeInput } from '../../src/core/online/ranked.js';
import { formatCode, MAX_CLIENT_FRAME } from '../../src/core/online/protocol.js';
import type { RoomInfo } from '../../src/core/online/protocol.js';
import { OnlineSession, PIN_MISMATCH } from '../../src/main/onlineClient.js';
import { issueCertificate } from '../../src/main/selfSignedCert.js';
import { regrade } from '../../server/admin.js';
import { seasonOf } from '../../src/core/online/ranked.js';
import type { DecisionLine } from '../../server/store.js';
import { cardsIn, checkOrCall, freshIdentity, Player, signedIn, sleep, startTestServer, type TestServer } from './onlineHarness.js';

let servers: TestServer[] = [];
let players: Player[] = [];

afterEach(async () => {
  for (const p of players) p.close();
  players = [];
  for (const s of servers) await s.close();
  servers = [];
});

async function server(opts: Parameters<typeof startTestServer>[0] = {}): Promise<TestServer> {
  const s = await startTestServer(opts);
  servers.push(s);
  return s;
}

async function seat(t: TestServer, names: string[], ranked = false): Promise<{ room: RoomInfo; ps: Player[] }> {
  const ps: Player[] = [];
  for (const name of names) {
    const p = await signedIn(t, name);
    players.push(p);
    ps.push(p);
  }
  const room = (await ps[0].request('room-create', { seats: names.length, ranked })) as RoomInfo;
  for (const p of ps.slice(1)) await p.request('room-join', { code: formatCode(room.code) });
  return { room, ps };
}

/** A raw TLS socket to the server that pins nothing and speaks whatever the test writes. */
function rawSocket(t: TestServer): Promise<{ socket: tls.TLSSocket; lines: string[]; closed: Promise<void> }> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: '127.0.0.1', port: t.server.port, rejectUnauthorized: false, minVersion: 'TLSv1.3' });
    const lines: string[] = [];
    let buf = '';
    socket.setEncoding('utf8');
    socket.on('data', (c: string) => {
      buf += c;
      const parts = buf.split('\n');
      buf = parts.pop() ?? '';
      lines.push(...parts.filter(Boolean));
    });
    socket.on('error', () => undefined);
    const closed = new Promise<void>((r) => socket.on('close', () => r()));
    socket.on('secureConnect', () => resolve({ socket, lines, closed }));
  });
}

describe('a full hand between two headless clients', () => {
  it('deals, plays to showdown, and every card each player saw opened the server’s commitment', async () => {
    const t = await server();
    const { ps } = await seat(t, ['Ada', 'Bo']);
    for (const p of ps) p.strategy = checkOrCall;
    for (const p of ps) await p.waitFor((e) => e.type === 'verified');
    for (const p of ps) {
      const settled = p.view!;
      expect(settled.winners).not.toBeNull();
      expect(settled.seats.filter((s) => s.isYou)).toHaveLength(1);
    }
  });

  it('never sends a player another player’s hole cards before showdown, on the wire itself', async () => {
    const t = await server();
    const { ps } = await seat(t, ['Ada', 'Bo', 'Cy']);
    for (const p of ps) p.strategy = checkOrCall;
    for (const p of ps) await p.waitView((v) => v.handNumber >= 3, 20_000);
    for (const p of ps) p.strategy = null;
    // Each player's own hole per hand, from their own views.
    const holeOf = (p: Player, hand: number): string[] => {
      for (const e of p.events) {
        if (e.type === 'state' && e.view.handNumber === hand) {
          const mine = e.view.seats.find((s) => s.isYou && s.hole !== null);
          if (mine) return [...mine.hole!];
        }
      }
      return [];
    };
    ps.forEach((p, i) => {
      for (const line of p.wire) {
        const frame = JSON.parse(line) as { type: string; view?: { handNumber: number; street: string; winners: unknown } };
        if (frame.type !== 'state') {
          // Only a state frame may name a card at all: commitments are hashes, the rest is not cards.
          if (frame.type !== 'resync') expect(cardsIn(line), `${frame.type} names a card`).toEqual([]);
          continue;
        }
        const view = frame.view!;
        if (view.street === 'showdown' || view.winners !== null) continue;
        const others = ps.filter((_q, j) => j !== i).flatMap((q) => holeOf(q, view.handNumber));
        for (const card of cardsIn(line)) expect(others, `${card} of hand ${view.handNumber} leaked to player ${i}`).not.toContain(card);
      }
    });
  });
});

describe('reconnects', () => {
  it('a dropped player keeps the seat, resumes mid-hand with a replayed deal, and finishes the hand verified', async () => {
    const t = await server();
    const { ps } = await seat(t, ['Ada', 'Bo']);
    const [ada, bo] = ps;
    ada.strategy = checkOrCall;
    await bo.waitView((v) => v.handNumber === 1 && v.seats.some((s) => s.isYou && s.hole !== null));
    const myHole = bo.view!.seats.find((s) => s.isYou)!.hole;
    const mark = bo.events.length;
    bo.session.drop();
    await bo.waitFor((e) => e.type === 'status' && e.status === 'reconnecting', 5_000, mark);
    await bo.waitFor((e) => e.type === 'status' && e.status === 'online', 5_000, mark);
    // The same hand, the same cards, accepted by a FRESH deal checker through the resync.
    const resumed = await bo.waitView((v) => v.handNumber === 1 && v.seats.some((s) => s.isYou && s.hole !== null));
    expect(resumed.seats.find((s) => s.isYou)!.hole).toEqual(myHole);
    expect(bo.wire.some((l) => l.startsWith('{"type":"resync"'))).toBe(true);
    bo.strategy = checkOrCall;
    if (bo.view!.yourTurn) bo.session.action(checkOrCall(bo.view!));
    await bo.waitFor((e) => e.type === 'verified', 10_000, mark);
    expect(bo.events.slice(mark).some((e) => e.type === 'removed')).toBe(false);
  });

  it('a player gone past the grace window loses the seat, and the table plays on', async () => {
    const t = await server({ timing: { graceMs: 300 } });
    const { ps } = await seat(t, ['Ada', 'Bo', 'Cy']);
    const [ada, bo, cy] = ps;
    ada.strategy = checkOrCall;
    cy.strategy = checkOrCall;
    await bo.waitView((v) => v.handNumber === 1);
    bo.close();
    // Bo's seat folds when the turn reaches it, the hand settles, and the next is dealt to the two left.
    await ada.waitView((v) => v.handNumber >= 2 && v.seats.filter((s) => s.inHand).length === 2, 15_000);
  });
});

describe('cheating attempts', () => {
  it('refuses any frame before sign-in, and a socket that skips the handshake is closed', async () => {
    const t = await server();
    const { room } = await seat(t, ['Ada', 'Bo']);
    const { socket, lines, closed } = await rawSocket(t);
    socket.write(`${JSON.stringify({ type: 'room-join', id: 1, code: room.code })}\n`);
    await closed;
    expect(lines.join('\n')).toContain('"type":"bye"');
    expect(lines.join('\n')).not.toContain('"type":"state"');
  });

  it('refuses a forged or replayed signature', async () => {
    const t = await server();
    const victim = freshIdentity();
    // The attacker knows the victim's public key but not the private key; it tries a signature from a
    // different session (any 64 bytes it has seen), which cannot match this session's nonce + TLS keys.
    const { socket, lines, closed } = await rawSocket(t);
    socket.write(`${JSON.stringify({ type: 'hello', proto: 'offsuit-online', v: 1, key: victim.publicKey })}\n`);
    await sleep(100);
    expect(lines[0]).toContain('"type":"challenge"');
    socket.write(`${JSON.stringify({ type: 'auth', sig: Buffer.alloc(64, 7).toString('base64url') })}\n`);
    await closed;
    expect(lines.at(-1)).toContain('Sign-in failed');
    expect(t.server.stats().signedIn).toBe(0);
  });

  it('a LAN relay client is told this is an online server, not seated', async () => {
    const t = await server();
    const { socket, lines, closed } = await rawSocket(t);
    socket.write(`${JSON.stringify({ type: 'hello', v: 2, token: 'x'.repeat(22), name: 'Mallory' })}\n`);
    await closed;
    expect(lines.at(-1)).toContain('online server');
  });

  it('closes a connection that sends an oversized frame, and never buffers it', async () => {
    const t = await server();
    const { socket, lines, closed } = await rawSocket(t);
    socket.write('{'.padEnd(MAX_CLIENT_FRAME + 10, 'a'));
    await closed;
    expect(lines.join('')).toContain('Message too large');
  });

  it('a flood of frames is rate-limited and then disconnected', async () => {
    const t = await server();
    const mallory = await signedIn(t, 'Mallory');
    players.push(mallory);
    const ping = `${JSON.stringify({ type: 'emote', emote: 'gg' })}\n`;
    mallory.session.raw(ping.repeat(500));
    await mallory.waitFor((e) => e.type === 'status' && e.status === 'offline', 5_000);
    expect(mallory.wire.some((l) => l.includes('Too many messages'))).toBe(true);
  });

  it('malformed and forged frames change nothing: wrong turn, bad amounts, free text, a client-sent grade', async () => {
    const t = await server({ timing: { turnMs: 60_000 } });
    const { ps } = await seat(t, ['Ada', 'Bo'], true);
    const [ada, bo] = ps;
    const v = await ada.waitView((x) => x.handNumber === 1 && x.toAct >= 0);
    const [turn, other] = v.yourTurn ? [ada, bo] : [bo, ada];
    const before = JSON.stringify(turn.view);
    other.session.action({ kind: 'call' });
    await other.waitFor((e) => e.type === 'error' && /not your turn/.test(e.reason));
    for (const forged of [
      { type: 'action', action: { kind: 'raise', amount: -500 } },
      { type: 'action', action: { kind: 'raise', amount: 1e12 } },
      { type: 'action', action: { kind: 'steal' } },
      { type: 'chat', text: 'free text is not a thing here' },
      { type: 'emote', emote: 'any words I like' },
      { type: 'grade', ev: 0 },
      { type: 'state', view: {} },
    ]) {
      turn.session.raw(`${JSON.stringify(forged)}\n`);
    }
    await sleep(200);
    expect(turn.wire.filter((l) => l.includes('not understood')).length).toBe(7);
    expect(JSON.stringify(turn.view)).toBe(before);
    await t.server.rankings.idle();
    expect(fs.existsSync(path.join(t.dir, 'ledger', `decisions-${seasonOf(Date.now())}.jsonl`))).toBe(false);
  });

  it('replaying an earlier hand’s deal messages is refused and changes nothing', async () => {
    const t = await server();
    const { ps } = await seat(t, ['Ada', 'Bo']);
    const [ada, bo] = ps;
    for (const p of ps) p.strategy = checkOrCall;
    await bo.waitFor((e) => e.type === 'verified');
    await bo.waitView((v) => v.handNumber === 2);
    const oldReveal = bo.wire.find((l) => l.startsWith('{"type":"dealt"'))!;
    const nonce = JSON.parse(oldReveal).nonce as string;
    const mine = JSON.parse(oldReveal).reveals[0].entropy as string;
    bo.session.raw(`${JSON.stringify({ type: 'entropy-reveal', hand: 1, nonce, entropy: mine })}\n`);
    bo.session.raw(`${JSON.stringify({ type: 'entropy-commit', hand: 1, nonce, commitment: 'a'.repeat(64) })}\n`);
    await bo.waitFor((e) => e.type === 'error' && /no deal is waiting/.test(e.reason));
    expect(ada.events.some((e) => e.type === 'removed')).toBe(false);
  });

  it('a room cannot be found by guessing codes: misses are rate-limited per key', async () => {
    const t = await server();
    await seat(t, ['Ada', 'Bo']);
    const mallory = await signedIn(t, 'Mallory');
    players.push(mallory);
    const errors: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      await mallory.request('room-join', { code: `ZZZZZ${String(i).padStart(5, '0')}` }).catch((e: Error) => errors.push(e.message));
    }
    expect(errors.slice(0, 10).every((m) => /No table has that code/.test(m))).toBe(true);
    expect(errors.slice(10).every((m) => /Too many codes/.test(m))).toBe(true);
  });

  it('nobody plays before confirming 18+ with a name; a name is checked', async () => {
    const t = await server();
    const p = new Player(t.target, freshIdentity());
    players.push(p);
    await p.connect();
    await expect(p.request('room-create', { seats: 2, ranked: false })).rejects.toThrow(/18 or over/);
    await expect(p.request('profile', { name: 'admin', adult: true })).rejects.toThrow(/reserved/);
    // `adult` must be the literal true: anything else is not a frame the server understands.
    p.session.raw(`${JSON.stringify({ type: 'profile', id: 99, name: 'Eve', adult: 'yes' })}\n`);
    await sleep(100);
    expect(p.wire.some((l) => l.includes('not understood'))).toBe(true);
    expect(t.server.store.player(p.identity.publicKey)).toBeUndefined();
  });

  it('only the opener removes a seat, only between hands, and the removed player cannot sit again', async () => {
    const t = await server({ timing: { nextHandMs: 60_000 } });
    const { room, ps } = await seat(t, ['Ada', 'Bo']);
    const [ada, bo] = ps;
    await ada.waitView((v) => v.handNumber === 1);
    await expect(bo.request('kick', { seat: 0 })).rejects.toThrow(/Only the player who opened/);
    await expect(ada.request('kick', { seat: bo.view!.seats.find((s) => s.isYou)!.id })).rejects.toThrow(/Wait for the hand/);
    for (const p of ps) p.strategy = checkOrCall;
    await ada.waitView((v) => v.winners !== null);
    await ada.request('kick', { seat: bo.view!.seats.find((s) => s.isYou)!.id });
    await bo.waitFor((e) => e.type === 'removed');
    await expect(bo.request('room-join', { code: room.code })).rejects.toThrow(/removed you|removed from this table/);
  });

  it('emotes are presets only and rate-limited', async () => {
    const t = await server();
    const { ps } = await seat(t, ['Ada', 'Bo']);
    const [ada, bo] = ps;
    ada.session.emote('gg');
    ada.session.emote('thanks');
    await bo.waitFor((e) => e.type === 'emote');
    await sleep(150);
    expect(bo.events.filter((e) => e.type === 'emote')).toHaveLength(1);
  });
});

describe('ranked recomputation', () => {
  it('grades every decision on the server with the shared grader, from what each player actually held', async () => {
    const t = await server();
    const { ps } = await seat(t, ['Ada', 'Bo'], true);
    const [ada, bo] = ps;
    // Ada folds to any bet and checks otherwise; Bo raises preflop, then calls.
    ada.strategy = (v) => ({ kind: v.legal.includes('check') ? 'check' : 'fold' });
    bo.strategy = (v) => (v.street === 'preflop' && v.legal.includes('raise') ? { kind: 'raise' } : checkOrCall(v));
    await ada.waitView((v) => v.handNumber >= 4, 20_000);
    ada.strategy = null;
    bo.strategy = null;
    await t.server.rankings.idle();
    const ledger = t.server.store.read<DecisionLine>('decisions', seasonOf(Date.now()));
    expect(ledger.length).toBeGreaterThanOrEqual(3);
    // 1. The stored grade is exactly the shared grader's verdict on the stored input.
    expect(regrade(t.server.store, seasonOf(Date.now())).differ).toEqual([]);
    for (const line of ledger) expect(gradeInput(line.in)).toBeCloseTo(line.ev, 4);
    // 2. The stored input is what the player held: every hole in Ada's ledger is a hole Ada was shown.
    const adaHoles = new Set(
      ada.events.flatMap((e) => (e.type === 'state' ? e.view.seats.filter((s) => s.isYou && s.hole !== null).map((s) => s.hole!.join()) : [])),
    );
    const adaLines = ledger.filter((l) => l.k === ada.identity.publicKey);
    expect(adaLines.length).toBeGreaterThan(0);
    for (const line of adaLines) expect(adaHoles.has(line.in.hole.join())).toBe(true);
    // 3. The decision names a deal the player saw committed before any card; its grader seed is keyed by a
    //    server secret that never appears on any player's wire.
    const nonces = ada.wire.filter((l) => l.startsWith('{"type":"commit"')).map((l) => JSON.parse(l).nonce as string);
    for (const line of adaLines) {
      const [nonce, index] = line.d.split(':');
      expect(nonces).toContain(nonce);
      expect(line.in.seed).toBe(crypto.createHmac('sha256', t.server.store.gradeSecret).update(`${nonce}:${index}`).digest().readUInt32BE(0));
      expect(line.opp).toEqual([bo.identity.publicKey]);
    }
    // 4. The season view reports the same count, unrated until the minimum sample.
    const season = (await ada.request('season')) as { you: { decisions: number; rated: boolean } };
    expect(season.you.decisions).toBe(adaLines.length);
    expect(season.you.rated).toBe(false);
  });

  it('a timed-out turn is played for the seat and still graded', async () => {
    const t = await server({ timing: { turnMs: 300 } });
    const { ps } = await seat(t, ['Ada', 'Bo'], true);
    const [ada] = ps;
    await ada.waitView((v) => v.handNumber >= 2, 15_000);
    await t.server.rankings.idle();
    const ledger = t.server.store.read<DecisionLine>('decisions', seasonOf(Date.now()));
    expect(ledger.length).toBeGreaterThan(0);
    expect(ledger.every((l) => l.auto)).toBe(true);
  });

  it('unranked tables store no decisions at all', async () => {
    const t = await server();
    const { ps } = await seat(t, ['Ada', 'Bo'], false);
    for (const p of ps) p.strategy = checkOrCall;
    await ps[0].waitView((v) => v.handNumber >= 2, 10_000);
    await t.server.rankings.idle();
    expect(t.server.store.ledgerSeasons()).toEqual([]);
  });
});

describe('identity, export and erasure', () => {
  it('exports what the server holds about a key, then forgets it everywhere', async () => {
    const t = await server();
    const { ps } = await seat(t, ['Ada', 'Bo'], true);
    const [ada, bo] = ps;
    for (const p of ps) p.strategy = checkOrCall;
    await ada.waitView((v) => v.handNumber >= 2, 10_000);
    await t.server.rankings.idle();
    const exported = (await ada.request('export')) as { player: { name: string; adultOn: string }; decisionCount: number };
    expect(exported.player.name).toBe('Ada');
    expect(exported.player.adultOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(exported.decisionCount).toBeGreaterThan(0);
    expect(JSON.stringify(exported)).not.toContain(bo.identity.publicKey);
    await ada.request('forget');
    await ada.waitFor((e) => e.type === 'status' && e.status === 'offline');
    await t.server.rankings.idle();
    expect(t.server.store.player(ada.identity.publicKey)).toBeUndefined();
    const season = seasonOf(Date.now());
    for (const kind of ['decisions', 'hands'] as const) {
      expect(fs.readFileSync(path.join(t.dir, 'ledger', `${kind}-${season}.jsonl`), 'utf8')).not.toContain(ada.identity.publicKey);
    }
  });

  it('stores no address, and logs no key, name or address', async () => {
    const lines: string[] = [];
    const t = await server({ log: (ev, f) => lines.push(JSON.stringify({ ev, ...f })) });
    const { ps } = await seat(t, ['Ada', 'Bo']);
    await ps[0].waitView((v) => v.handNumber === 1);
    await t.server.flush();
    const all = lines.join('\n') + fs.readFileSync(path.join(t.dir, 'state.json'), 'utf8');
    expect(lines.join('\n')).not.toContain('Ada');
    for (const p of ps) expect(lines.join('\n')).not.toContain(p.identity.publicKey);
    expect(all).not.toContain('127.0.0.1');
  });
});

describe('trusting the server', () => {
  it('connects with a public-authority style certificate (a private CA here) and refuses a host it is not for', async () => {
    const ca = issueCertificate({ commonName: 'Test Root', isCa: true, days: 30 });
    const leaf = issueCertificate({ commonName: 'localhost', altNames: ['localhost'], isCa: false, issuer: { commonName: 'Test Root', keyPem: ca.keyPem } });
    const t = await server({ tls: { key: leaf.keyPem, cert: leaf.certPem } });
    const good = new Player({ host: 'localhost', port: t.server.port, pin: null, ca: ca.certPem }, freshIdentity());
    players.push(good);
    await expect(good.connect()).resolves.toMatchObject({ type: 'welcome' });
    const wrongHost = new Player({ host: '127.0.0.1', port: t.server.port, pin: null, ca: ca.certPem }, freshIdentity());
    players.push(wrongHost);
    await expect(wrongHost.connect()).rejects.toThrow(/certificate/);
    const untrusted = new Player({ host: 'localhost', port: t.server.port, pin: null }, freshIdentity());
    players.push(untrusted);
    await expect(untrusted.connect()).rejects.toThrow(/certificate/);
  });

  it('refuses a server whose certificate does not match the pin, before sending anything', async () => {
    const t = await server();
    const wrong = issueCertificate().fingerprint;
    const p = new OnlineSession({ ...t.target, pin: wrong }, freshIdentity(), () => undefined);
    await expect(p.connect()).rejects.toThrow(PIN_MISMATCH);
    expect(t.server.stats().signedIn).toBe(0);
  });
});
