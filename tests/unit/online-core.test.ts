/**
 * The pure online pieces: frame validation, names, server addresses, the ladder's arithmetic, the grader
 * pin, and the relay's new seat rules (hold, resume, the turn clock) with the guest's resync check.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatServerAddress, parsePin, parseServerAddress } from '../../src/core/online/address.js';
import { normaliseName } from '../../src/core/online/names.js';
import {
  MAX_CLIENT_FRAME,
  normaliseCode,
  parseAuth,
  parseHello,
  parseOnlineFrame,
} from '../../src/core/online/protocol.js';
import {
  addLoss,
  buildBoard,
  EMPTY_TALLY,
  GRADER_FINGERPRINTS,
  GRADER_VERSION,
  graderFingerprint,
  MIN_DECISIONS,
  PAIR_CAP,
  rate,
  seasonBounds,
  seasonOf,
  type Tally,
} from '../../src/core/online/ranked.js';
import { GuestProtocol } from '../../src/core/relayGuest.js';
import { silentLog } from '../../server/log.js';
import { Rankings } from '../../server/rankings.js';
import { Store } from '../../server/store.js';
import { Table, testCrypto } from './relayHarness.js';

describe('frame validation', () => {
  it('accepts exactly the known shapes', () => {
    expect(parseOnlineFrame('{"type":"action","action":{"kind":"raise","amount":400}}')).toEqual({ type: 'action', action: { kind: 'raise', amount: 400 } });
    expect(parseOnlineFrame('{"type":"room-create","id":3,"seats":4,"ranked":true}')).toEqual({ type: 'room-create', id: 3, seats: 4, ranked: true });
    expect(parseOnlineFrame('{"type":"room-join","id":3,"code":"abcde-fghjk"}')).toEqual({ type: 'room-join', id: 3, code: 'ABCDEFGHJK' });
    expect(parseOnlineFrame('{"type":"emote","emote":"gg"}')).toEqual({ type: 'emote', emote: 'gg' });
    expect(parseOnlineFrame('{"type":"ping"}')).toEqual({ type: 'ping' });
  });

  it.each([
    ['not JSON', '{"type":'],
    ['an array', '[1,2]'],
    ['an unknown type', '{"type":"chat","text":"hi"}'],
    ['a negative amount', '{"type":"action","action":{"kind":"bet","amount":-1}}'],
    ['a fractional amount', '{"type":"action","action":{"kind":"bet","amount":1.5}}'],
    ['a huge amount', '{"type":"action","action":{"kind":"bet","amount":1e15}}'],
    ['an unknown action', '{"type":"action","action":{"kind":"peek"}}'],
    ['extra action fields', '{"type":"action","action":{"kind":"bet","amount":1,"seat":2}}'],
    ['a request without an id', '{"type":"ladder"}'],
    ['a zero id', '{"type":"ladder","id":0}'],
    ['seven seats', '{"type":"room-create","id":1,"seats":7,"ranked":false}'],
    ['ranked as a string', '{"type":"room-create","id":1,"seats":2,"ranked":"yes"}'],
    ['a short code', '{"type":"room-join","id":1,"code":"ABC"}'],
    ['adult not literally true', '{"type":"profile","id":1,"name":"Eve","adult":1}'],
    ['a free-text emote', '{"type":"emote","emote":"you are bad"}'],
    ['a stuffed frame', '{"type":"ping","a":1,"b":2,"c":3,"d":4,"e":5,"f":6}'],
    ['a malformed commitment', '{"type":"entropy-commit","hand":1,"nonce":"00","commitment":"zz"}'],
    ['__proto__ games', '{"type":"action","action":{"__proto__":{"kind":"fold"}}}'],
  ])('refuses %s', (_label, line) => {
    expect(parseOnlineFrame(line)).toBeNull();
  });

  it('refuses any frame over the size limit, whatever it holds', () => {
    expect(parseOnlineFrame(`{"type":"ping","pad":"${'x'.repeat(MAX_CLIENT_FRAME)}"}`)).toBeNull();
  });

  it('never throws on random bytes', () => {
    for (let i = 0; i < 2000; i += 1) {
      const junk = Array.from({ length: (i % 60) + 1 }, () => String.fromCharCode(Math.floor(Math.random() * 128))).join('');
      expect(() => parseOnlineFrame(junk)).not.toThrow();
      expect(() => parseHello(junk)).not.toThrow();
      expect(() => parseAuth(junk)).not.toThrow();
    }
  });

  it('a hello carries a 32-byte key and an auth a 64-byte signature, nothing else', () => {
    const key = Buffer.alloc(32, 1).toString('base64url');
    expect(parseHello(JSON.stringify({ type: 'hello', proto: 'offsuit-online', v: 1, key }))).not.toBeNull();
    expect(parseHello(JSON.stringify({ type: 'hello', proto: 'offsuit-online', v: 1, key: key.slice(1) }))).toBeNull();
    expect(parseAuth(JSON.stringify({ type: 'auth', sig: Buffer.alloc(64).toString('base64url') }))).not.toBeNull();
    expect(parseAuth(JSON.stringify({ type: 'auth', sig: 'abc' }))).toBeNull();
  });

  it('codes fold look-alikes and dashes, and refuse anything else', () => {
    expect(normaliseCode('olil0-12345')).toBe('0111012345');
    expect(normaliseCode('ABCDE FGHJK')).toBe('ABCDEFGHJK');
    expect(normaliseCode('ABCDEFGHJU')).toBeNull();
    expect(normaliseCode(42)).toBeNull();
  });
});

describe('display names', () => {
  it.each(['Ada', 'Bo 2', 'José', 'k.o_ok-1'])('allows %s', (name) => expect(normaliseName(name)).toEqual({ name }));
  it.each(['a', 'x'.repeat(17), 'admin', 'Offsuit', '<b>hi</b>', 'f.u.c.k', 'sh1t', ' ', 'ok\u0000'])('refuses %j', (name) => {
    expect('error' in normaliseName(name)).toBe(true);
  });
});

describe('server address and pin', () => {
  it('parses host names, IPs, ports and the default port', () => {
    expect(parseServerAddress('play.example.com')).toEqual({ host: 'play.example.com', port: 443 });
    expect(parseServerAddress(' Play.Example.com:8443 ')).toEqual({ host: 'play.example.com', port: 8443 });
    expect(parseServerAddress('203.0.113.9:9000')).toEqual({ host: '203.0.113.9', port: 9000 });
    expect(parseServerAddress('[2001:db8::1]:443')).toEqual({ host: '2001:db8::1', port: 443 });
    expect(formatServerAddress({ host: '2001:db8::1', port: 9 })).toBe('[2001:db8::1]:9');
  });
  it.each(['', 'http://x.com/path', 'a b', 'x.com:0', 'x.com:99999', '2001:db8::1', '-bad.com'])('refuses %j', (text) => {
    expect('error' in parseServerAddress(text)).toBe(true);
  });
  it('an empty pin means public authorities; a pin is 43 base64url characters', () => {
    expect(parsePin('')).toEqual({ pin: null });
    expect(parsePin('A'.repeat(43))).toEqual({ pin: 'A'.repeat(43) });
    expect('error' in parsePin('abc')).toBe(true);
  });
});

describe('the rating', () => {
  const tally = (losses: number[]): Tally => losses.reduce(addLoss, EMPTY_TALLY);

  it('is bb lost per 100 decisions with a 95% interval, unrated below the minimum sample', () => {
    const thin = rate(tally([0, 1, 0, 2]));
    expect(thin.rated).toBe(false);
    expect(thin.bbPer100).toBe(75);
    const losses = Array.from({ length: MIN_DECISIONS }, (_v, i) => (i % 4 === 0 ? 2 : 0));
    const r = rate(tally(losses));
    expect(r.rated).toBe(true);
    expect(r.bbPer100).toBe(50);
    expect(r.low).toBeLessThan(50);
    expect(r.high).toBeGreaterThan(50);
    expect(r.low).toBeGreaterThanOrEqual(0);
  });

  it('orders by the pessimistic end, so a short lucky run does not top a long steady one, and marks ties', () => {
    const steady = tally(Array.from({ length: 2000 }, (_v, i) => (i % 10 === 0 ? 1 : 0))); // 10 / 100
    const lucky = tally(Array.from({ length: MIN_DECISIONS }, (_v, i) => (i % 25 === 0 ? 2 : 0))); // 8 / 100, wide
    const board = buildBoard(
      [
        { keyId: 'lucky', name: 'Lucky', tally: lucky },
        { keyId: 'steady', name: 'Steady', tally: steady },
        { keyId: 'thin', name: 'Thin', tally: tally([0, 0, 0]) },
      ],
      'thin',
    );
    expect(board.rows.map((r) => r.keyId)).toEqual(['steady', 'lucky']);
    expect(board.rows[1].tiedAbove).toBe(true);
    expect(board.calibrating).toBe(1);
  });

  it('seasons are UTC months', () => {
    expect(seasonOf(Date.UTC(2026, 9, 31, 23, 59))).toBe('2026-10');
    expect(seasonOf(Date.UTC(2026, 10, 1, 0, 0))).toBe('2026-11');
    const { start, end } = seasonBounds('2026-12');
    expect(new Date(start).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(new Date(end + 1).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('the grader is pinned: any change to what it says must bump GRADER_VERSION', () => {
    expect(graderFingerprint()).toBe(GRADER_FINGERPRINTS[GRADER_VERSION]);
  });

});

describe('collusion caps on the season ladder', () => {
  function rankings(): { r: Rankings; store: Store } {
    const store = Store.open(fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-rank-')));
    return { r: new Rankings(store, silentLog, Date.now), store };
  }

  it('decisions beyond the pair cap count in a friends league but not on the ladder', () => {
    const { r, store } = rankings();
    const season = seasonOf(Date.now());
    const write = (k: string, opp: string, ev: number, n: number): void => {
      for (let i = 0; i < n; i += 1) store.append('decisions', season, { k, d: `x:${k}:${opp}:${i}`, ev, g: 1, auto: false, opp: [opp], day: '2026-10-13', in: {} as never });
    };
    for (const k of ['A', 'B', 'C', 'D']) store.setProfile(k, k, Date.now());
    // A plays only with accomplice B, far past the cap: 0.0 loss every time.
    write('A', 'B', 0, PAIR_CAP + 500);
    const fresh = new Rankings(store, silentLog, Date.now);
    const league = fresh.leagueBoard(['A', 'B'], 'A');
    expect(league.rows.find((row) => row.keyId === 'A')?.rating.decisions).toBe(PAIR_CAP + 500);
    // On the ladder A counts at most PAIR_CAP, and is not listed with fewer than three opponents.
    const ladder = fresh.ladder('A');
    expect(ladder.rows.find((row) => row.keyId === 'A')).toBeUndefined();
    expect(fresh.seasonView('A').you.decisions).toBe(PAIR_CAP);
    void r;
  });
});

describe('relay seat rules for the online server', () => {
  it('a held player keeps the seat and their turn waits; resume replays the deal to a fresh checker', () => {
    const table = new Table({ seatCount: 2 });
    table.join('a');
    table.join('b');
    const before = table.server.roomState().table!;
    expect(before.handNumber).toBe(1);
    const owner = table.server.roomState().dealtTo[before.toAct];
    table.route(table.server.hold(owner));
    // Not folded: the seat is still to act, waiting on the clock.
    expect(table.server.roomState().table!.toAct).toBe(before.toAct);
    expect(table.server.roomState().table!.seats[before.toAct].folded).toBe(false);
    // While held, nothing arrives in their name.
    expect(table.server.message(owner, { type: 'action', action: { kind: 'fold' } })).toEqual([]);
    table.guests.set(owner, new GuestProtocol(testCrypto));
    table.route(table.server.resume(owner)!);
    const events = table.events.get(owner)!;
    expect(events.some((e) => e.type === 'violation')).toBe(false);
    expect(events.filter((e) => e.type === 'state').at(-1)).toBeDefined();
  });

  it('autoAct checks when free, else folds, and records it as an automatic decision', () => {
    const decisions: { auto: boolean; kind: string }[] = [];
    const table = new Table({ seatCount: 2 }, { onDecision: (d) => decisions.push({ auto: d.auto, kind: d.action.kind }) });
    table.join('a');
    table.join('b');
    table.route(table.server.autoAct());
    expect(decisions).toEqual([{ auto: true, kind: 'fold' }]);
  });

  it('a guest refuses a resync once it has seen a deal, and one that leaves out entropy it revealed', () => {
    const table = new Table({ seatCount: 2 });
    table.join('a');
    table.join('b');
    const owner = 'a';
    table.route(table.server.hold(owner));
    const replay = table.server.resume(owner)!.find((o) => o.message.type === 'resync')!.message;
    // The live guest already holds this deal: a second copy is an attempt to replace it.
    const live = table.guests.get(owner)!;
    expect(live.receive(replay).events.some((e) => e.type === 'violation')).toBe(true);
    // A fresh guest that remembers revealing different entropy for this deal refuses it too.
    const nonce = (replay as { commit: { nonce: string } }).commit.nonce;
    const fresh = new GuestProtocol(testCrypto, { revealed: (n) => (n === nonce ? 'f'.repeat(64) : undefined), remember: () => undefined });
    expect(fresh.receive(replay).events.some((e) => e.type === 'violation' && /entropy you revealed/.test(e.reason))).toBe(true);
  });
});
