/**
 * The online server hosts PR #24's licence server (Stripe webhook → licence token) on the same TLS port as
 * the game: after the handshake, a connection that speaks HTTP goes to the licence handler, anything else
 * to the game. Its store is a file in the state directory. Localhost only; Stripe is faked.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLicenceServer } from '../../src/server/licensing/handler.js';
import { signingKeyFromJwk } from '../../src/server/licensing/mint.js';
import { signStripePayload, type StripeApi, type SubscriptionTruth } from '../../src/server/licensing/stripe.js';
import { FileLicenceStore } from '../../server/licenceStore.js';
import { signedIn, startTestServer, type TestServer } from './onlineHarness.js';

const SECRET = 'whsec_test_placeholder';

function licence(dir: string) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const x = publicKey.export({ format: 'jwk' }).x as string;
  const d = privateKey.export({ format: 'jwk' }).d as string;
  const subs = new Map<string, SubscriptionTruth>();
  const stripe: StripeApi = { getSubscription: async (id) => subs.get(id) ?? null, getCharge: async () => null };
  const store = new FileLicenceStore(path.join(dir, 'licences.json'));
  const handle = createLicenceServer({
    store,
    stripe,
    webhookSecrets: [SECRET],
    signing: signingKeyFromJwk({ kid: 'test', x, d }),
    publicKeys: { test: x },
    emailPepper: 'pepper',
    nowSeconds: () => Math.floor(Date.now() / 1000),
  });
  return { handle, store, subs };
}

function request(port: number, method: string, url: string, body = '', headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: '127.0.0.1', port, method, path: url, rejectUnauthorized: false, headers: { 'content-type': 'application/json', ...headers } },
      (res) => {
        let text = '';
        res.on('data', (c: Buffer) => (text += c.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

let servers: TestServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

describe('the licence server, hosted on the game port', () => {
  it('a signed Stripe webhook is processed and its licence persisted; the game still signs in on the same port', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-lic-'));
    const lic = licence(dir);
    const t = await startTestServer({ stateDir: dir, licence: lic.handle });
    servers.push(t);
    lic.subs.set('sub_1', { id: 'sub_1', status: 'active', customerEmail: 'a@example.com', currentPeriodEnd: Math.floor(Date.now() / 1000) + 86_400 * 30, interval: 'month' });
    const body = JSON.stringify({ id: 'evt_1', object: 'event', type: 'checkout.session.completed', data: { object: { id: 'cs_1', object: 'checkout.session', subscription: 'sub_1' } } });
    const ok = await request(t.server.port, 'POST', '/webhooks/stripe', body, { 'stripe-signature': signStripePayload(body, SECRET, Math.floor(Date.now() / 1000)) });
    expect(ok.status).toBe(200);
    const forged = await request(t.server.port, 'POST', '/webhooks/stripe', body, { 'stripe-signature': signStripePayload(body, 'whsec_wrong', Math.floor(Date.now() / 1000)) });
    expect(forged.status).not.toBe(200);
    // Persisted: a fresh store over the same file sees the licence.
    expect(await new FileLicenceStore(path.join(dir, 'licences.json')).bySubscription('sub_1')).not.toBeNull();
    const p = await signedIn(t, 'Ada');
    expect(p.session.isOnline()).toBe(true);
    p.close();
  });

  it('rate-limits /v1/* per address', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-lic-'));
    const t = await startTestServer({ stateDir: dir, licence: licence(dir).handle });
    servers.push(t);
    const statuses: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      statuses.push((await request(t.server.port, 'POST', '/v1/licence/restore', JSON.stringify({ orderId: `cs_${i}`, email: 'a@example.com' }))).status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  it('without licence configuration an HTTP request gets 404 and nothing else', async () => {
    const t = await startTestServer();
    servers.push(t);
    expect((await request(t.server.port, 'GET', '/v1/licence/claim?session_id=cs_1')).status).toBe(404);
  });
});

describe('FileLicenceStore', () => {
  it('claims an event once, survives a reopen, and serialises concurrent writes', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-lic-')), 'licences.json');
    const a = new FileLicenceStore(file);
    expect(await a.claimEvent('evt_1')).toBe(true);
    expect(await a.claimEvent('evt_1')).toBe(false);
    const rec = (n: number) => ({ lid: `l${n}`, subscriptionId: `sub_${n}`, plan: 'monthly' as const, status: 'active' as const, paidThrough: n, token: 't', emailHash: null, orderIds: [`cs_${n}`] });
    await Promise.all(Array.from({ length: 20 }, (_v, n) => a.put(rec(n))));
    const b = new FileLicenceStore(file);
    expect(await b.claimEvent('evt_1')).toBe(false);
    for (let n = 0; n < 20; n += 1) expect((await b.byOrder(`cs_${n}`))?.lid).toBe(`l${n}`);
  });
});

describe('round 2 review: the HTTP branch', () => {
  it('L1. a client that sends only a request line is closed by a hard deadline', async () => {
    const tls = await import('node:tls');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-lic-'));
    const t = await startTestServer({ stateDir: dir, licence: licence(dir).handle, limits: { httpDeadlineMs: 500 } });
    servers.push(t);
    const socket = tls.connect({ host: '127.0.0.1', port: t.server.port, rejectUnauthorized: false });
    await new Promise<void>((r) => socket.on('secureConnect', () => r()));
    socket.write('POST /v1/licence/restore HTTP/1.1\r\n');
    const closedAt = await new Promise<number>((r) => {
      const started = Date.now();
      socket.on('close', () => r(Date.now() - started));
      socket.on('error', () => undefined);
    });
    expect(closedAt).toBeLessThan(3000);
  });

  it('L2. a path spelled to dodge the /v1 limit is refused, and the limit holds on the normalised path', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-lic-'));
    const t = await startTestServer({ stateDir: dir, licence: licence(dir).handle });
    servers.push(t);
    for (const target of ['/./v1/licence/restore', '//h/v1/licence/restore', '/x/../v1/licence/restore']) {
      expect((await request(t.server.port, 'POST', target, '{}')).status, target).toBe(400);
    }
    const statuses: number[] = [];
    for (let i = 0; i < 25; i += 1) statuses.push((await request(t.server.port, 'POST', '/v1/licence/restore?x=1', '{}')).status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});
