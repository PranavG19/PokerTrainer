/**
 * Regressions for the review of e3e58df (code-review.md, Act on 1–8). Each was red before its fix.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_SERVER_FRAME } from '../../src/core/online/protocol.js';
import { seasonOf } from '../../src/core/online/ranked.js';
import type { ResyncMessage, ServerMessage } from '../../src/core/multiplayer.js';
import { GuestProtocol, type GuestMemory } from '../../src/core/relayGuest.js';
import type { DecisionRecord } from '../../src/core/relayServer.js';
import { createIdentity, exportIdentity, loadOrCreateIdentity } from '../../src/main/onlineIdentity.js';
import { silentLog } from '../../server/log.js';
import { Rankings } from '../../server/rankings.js';
import { Store, type DecisionLine } from '../../server/store.js';
import { checkOrCall, signedIn, startTestServer, type Player, type TestServer } from './onlineHarness.js';
import { Table, testCrypto } from './relayHarness.js';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-fix-'));

function mapMemory(): GuestMemory & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, revealed: (n) => map.get(n), remember: (n, e) => void map.set(n, e) };
}

/** A two-seat table dealt once; returns the resync a held-then-resumed `a` would get. */
function dealtResync(): { table: Table; resync: ResyncMessage } {
  const table = new Table({ seatCount: 2 });
  table.join('a');
  table.join('b');
  table.route(table.server.hold('a'));
  const resync = table.server.resume('a')!.find((o) => o.message.type === 'resync')!.message as ResyncMessage;
  return { table, resync };
}

describe('1. a forced reconnect cannot slip in a deal the player put no entropy into', () => {
  it('a guest remembers its entropy as soon as it commits, before any reveal', () => {
    const memory = mapMemory();
    const guest = new GuestProtocol(testCrypto, memory);
    const { resync } = dealtResync();
    const commit: ServerMessage = { ...resync.commit, nonce: 'ab'.repeat(16), hand: 9 };
    guest.receive(commit);
    expect(memory.map.get('ab'.repeat(16))).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a resync for a deal it committed to must carry that entropy', () => {
    const { resync } = dealtResync();
    const memory = mapMemory();
    memory.map.set(resync.commit.nonce, 'c'.repeat(64));
    const events = new GuestProtocol(testCrypto, memory).receive(resync).events;
    expect(events.some((e) => e.type === 'violation')).toBe(true);
  });

  it('a resync with no entropy set at all is a violation, as on the live path', () => {
    const { resync } = dealtResync();
    const bare: ResyncMessage = { ...resync, set: null, dealt: { ...resync.dealt, reveals: [] } };
    expect(new GuestProtocol(testCrypto, mapMemory()).receive(bare).events.some((e) => e.type === 'violation')).toBe(true);
  });

  it('a resync this app cannot check (it restarted) is accepted with a visible warning', () => {
    const { resync } = dealtResync();
    const events = new GuestProtocol(testCrypto, mapMemory()).receive(resync).events;
    expect(events.some((e) => e.type === 'violation')).toBe(false);
    expect(events.some((e) => e.type === 'warning')).toBe(true);
  });
});

describe('server-side fixes', () => {
  let t: TestServer | null = null;
  const players: Player[] = [];
  afterEach(async () => {
    for (const p of players.splice(0)) p.close();
    await t?.close();
    t = null;
  });

  it('2. export and forget need a player row, and are limited per key', async () => {
    t = await startTestServer();
    const named = await signedIn(t, 'Ada');
    players.push(named);
    await named.request('export');
    await expect(named.request('export')).rejects.toThrow(/a minute/);
    const { Player: P } = await import('./onlineHarness.js');
    const { freshIdentity } = await import('./onlineHarness.js');
    const unnamed = new P(t.target, freshIdentity());
    players.push(unnamed);
    await unnamed.connect();
    await expect(unnamed.request('export')).rejects.toThrow(/nothing about this key|Choose a name/);
    await expect(unnamed.request('forget')).rejects.toThrow(/nothing about this key|Choose a name/);
  });

  it('6. the grader seed comes from a server secret, not from anything a client sees', async () => {
    t = await startTestServer();
    const a = await signedIn(t, 'Ada');
    const b = await signedIn(t, 'Bo');
    players.push(a, b);
    const room = (await a.request('room-create', { seats: 2, ranked: true })) as { code: string };
    await b.request('room-join', { code: room.code });
    a.strategy = checkOrCall;
    b.strategy = checkOrCall;
    await a.waitView((v) => v.handNumber >= 2, 15_000);
    await t.server.rankings.idle();
    const lines = t.server.store.read<DecisionLine>('decisions', seasonOf(Date.now()));
    expect(lines.length).toBeGreaterThan(0);
    // The old seed was the deal nonce's first 32 bits mixed with the index, which every player sees.
    const derivable = (nonce: string, index: number): number =>
      ((Number.parseInt(nonce.slice(0, 8), 16) >>> 0) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
    for (const line of lines) {
      const [nonce, index] = line.d.split(':');
      expect(line.in.seed).not.toBe(derivable(nonce, Number(index)));
    }
    for (const p of [a, b]) expect(p.wire.join('\n')).not.toContain(t.server.store.gradeSecret);
  });
});

describe('store and rankings', () => {
  it('3. a heavy player can export: the reply is paged under the frame limit', () => {
    const store = Store.open(tmp());
    const season = seasonOf(Date.now());
    store.setProfile('K'.repeat(43), 'Ada', Date.now());
    const input = { hole: ['Ah', 'Kd'], board: ['2c', '7d', 'Jh', 'Kc', '3s'], street: 'river', pot: 900, toCall: 300, stack: 3800, bb: 50, chosen: 'call' as const, opponents: 3, seed: 123456789 };
    for (let i = 0; i < 4000; i += 1) {
      store.append('decisions', season, { k: 'K'.repeat(43), d: `${'a'.repeat(32)}:${i}`, ev: 1.2345, g: 1, auto: false, opp: ['O'.repeat(43), 'P'.repeat(43)], day: '2026-10-13', in: input });
    }
    let page = 0;
    let rows = 0;
    for (;;) {
      const reply = store.exportFor('K'.repeat(43), page) as { pages: number; decisions: unknown[] };
      expect(JSON.stringify(reply).length).toBeLessThan(MAX_SERVER_FRAME);
      rows += reply.decisions.length;
      page += 1;
      if (page >= reply.pages) break;
    }
    expect(rows).toBe(4000);
  });

  it('4. a restart after the month turned still saves the finished season', () => {
    const store = Store.open(tmp());
    const sept = Date.UTC(2026, 8, 15);
    for (const k of ['A', 'B']) store.setProfile(k, k, sept);
    void new Rankings(store, silentLog, () => sept);
    for (let i = 0; i < 250; i += 1) store.append('decisions', '2026-09', { k: 'A', d: `x:${i}`, ev: i % 5 === 0 ? 1 : 0, g: 1, auto: false, opp: ['B'], day: '2026-09-15', in: {} as never });
    // The process is down when the month turns, and starts in October.
    const october = new Rankings(store, silentLog, () => Date.UTC(2026, 9, 1, 0, 30));
    expect(store.results('2026-09')?.A?.decisions).toBe(250);
    expect(october.seasonView('A').last?.decisions).toBe(250);
  });

  it('5. a decision graded after an opponent was forgotten does not name them', async () => {
    const store = Store.open(tmp());
    store.setProfile('a', 'A', Date.now());
    const rankings = new Rankings(store, silentLog, Date.now);
    let record: DecisionRecord | null = null;
    const table = new Table({ seatCount: 2 }, { onDecision: (d) => (record = d) });
    table.join('a');
    table.join('b');
    table.route(table.server.autoAct());
    // 'b' has no player row: forgotten (or never named).
    rankings.submit({ key: 'a', opponents: ['b'], record: { ...record!, playerId: 'a' } });
    await rankings.idle();
    const lines = store.read<DecisionLine>('decisions', seasonOf(Date.now()));
    expect(lines).toHaveLength(1);
    expect(lines[0].opp).toEqual([]);
  });
});

describe('8. the device identity is never silently replaced', () => {
  it('an unreadable identity file is refused, not overwritten', () => {
    const file = path.join(tmp(), 'id.json');
    fs.writeFileSync(file, '{"v":1,"publicKey":"tru');
    expect(() => loadOrCreateIdentity(file)).toThrow(/could not be read/);
    expect(fs.readFileSync(file, 'utf8')).toBe('{"v":1,"publicKey":"tru');
  });

  it('the app’s own export file loads back as the same identity', () => {
    const dir = tmp();
    const original = createIdentity(path.join(dir, 'a.json'));
    const exported = path.join(dir, 'b.json');
    fs.writeFileSync(exported, JSON.stringify({ what: 'Offsuit online identity', identity: exportIdentity(original) }));
    expect(loadOrCreateIdentity(exported).publicKey).toBe(original.publicKey);
  });
});

describe('7. addresses are not kept after their limits have lapsed', () => {
  it('the per-address maps empty once nobody from that address is connected and its windows pass', async () => {
    let clock = Date.now();
    const t = await startTestServer({ now: () => clock });
    try {
      const p = await signedIn(t, 'Ada');
      p.close();
      await new Promise((r) => setTimeout(r, 100));
      expect(t.server.stats().addressesTracked).toBeGreaterThan(0);
      clock += 11 * 60_000;
      await new Promise((r) => setTimeout(r, 200));
      expect(t.server.stats().addressesTracked).toBe(0);
    } finally {
      await t.close();
    }
  });
});
