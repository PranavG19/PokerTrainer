import * as crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { timeMessage, verifyToken } from '../../src/core/entitlements/token.js';
import { createLicenceServer, type LicenceRequest } from '../../src/server/licensing/handler.js';
import { signingKeyFromJwk, verifyWithKeys } from '../../src/server/licensing/mint.js';
import { MemoryLicenceStore } from '../../src/server/licensing/store.js';
import {
  parseStripeEvent,
  signStripePayload,
  stripeApi,
  verifyStripeSignature,
  type StripeApi,
  type SubscriptionTruth,
} from '../../src/server/licensing/stripe.js';

const SECRET = 'whsec_test_secret';
const PEPPER = 'pepper';
const DAY = 86_400;

function world(opts: { latencyMs?: number } = {}) {
  let now = 1_791_000_000;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const x = publicKey.export({ format: 'jwk' }).x as string;
  const d = privateKey.export({ format: 'jwk' }).d as string;
  const subs = new Map<string, SubscriptionTruth>();
  const charges = new Map<string, string>();
  const chargeAmounts = new Map<string, { amount: number; refunded: number }>();
  const stripe: StripeApi = {
    getSubscription: async (id) => subs.get(id) ?? null,
    getCharge: async (id) => {
      const sub = charges.get(id);
      if (sub === undefined) return null;
      const a = chargeAmounts.get(id) ?? { amount: 600, refunded: 600 };
      return { id, subscriptionId: sub, amount: a.amount, amountRefunded: a.refunded };
    },
  };
  const store = new MemoryLicenceStore();
  if (opts.latencyMs !== undefined) {
    const delay = () => new Promise((r) => setTimeout(r, opts.latencyMs));
    for (const m of ['bySubscription', 'put', 'byOrder', 'linkOrder', 'subscriptionForOrder'] as const) {
      const original = (store[m] as (...a: unknown[]) => Promise<unknown>).bind(store);
      (store as unknown as Record<string, unknown>)[m] = async (...a: unknown[]) => {
        await delay();
        return original(...a);
      };
    }
  }
  const issued: string[] = [];
  const handle = createLicenceServer({
    store,
    stripe,
    webhookSecrets: [SECRET],
    signing: signingKeyFromJwk({ kid: 'prod-test', x, d }),
    publicKeys: { 'prod-test': x },
    emailPepper: PEPPER,
    nowSeconds: () => now,
    onIssued: (r) => {
      issued.push(r.lid);
    },
  });
  let n = 0;
  const event = (type: string, object: Record<string, unknown>, id = `evt_${++n}`) =>
    JSON.stringify({ id, object: 'event', type, data: { object } });
  const deliver = (body: string, opts: { secret?: string; t?: number } = {}) =>
    handle({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'stripe-signature': signStripePayload(body, opts.secret ?? SECRET, opts.t ?? now) },
      body,
    });
  const post = (url: string, value: unknown) => handle({ method: 'POST', url, headers: {}, body: JSON.stringify(value) });
  const verifyApp = (token: string) =>
    verifyToken(token, (kid, m, s) => kid === 'prod-test' && crypto.verify(null, m, publicKey, s));
  return {
    handle,
    store,
    subs,
    charges,
    chargeAmounts,
    issued,
    event,
    deliver,
    post,
    verifyApp,
    advance: (s: number) => {
      now += s;
    },
    now: () => now,
    x,
  };
}

function activeSub(w: ReturnType<typeof world>, id = 'sub_1', periodEnd = w.now() + 365 * DAY): void {
  w.subs.set(id, { id, status: 'active', customerEmail: 'Sam@Example.com', currentPeriodEnd: periodEnd, interval: 'year' });
}

async function checkout(w: ReturnType<typeof world>) {
  activeSub(w);
  const res = await w.deliver(
    w.event('checkout.session.completed', { id: 'cs_test_1', object: 'checkout.session', subscription: 'sub_1' }),
  );
  return res;
}

describe('Stripe signatures', () => {
  const body = '{"a":1}';
  const t = 1_791_000_000;

  it('accepts Stripe’s construction and any of several v1 signatures (secret rolling)', () => {
    expect(verifyStripeSignature(body, signStripePayload(body, SECRET, t), [SECRET], t)).toBe(true);
    const rolled = `${signStripePayload(body, 'whsec_old', t)},v1=${signStripePayload(body, SECRET, t).split('v1=')[1]}`;
    expect(verifyStripeSignature(body, rolled, [SECRET], t)).toBe(true);
  });

  it('refuses a wrong secret, an edited body, a v0-only header, a stale or future timestamp', () => {
    expect(verifyStripeSignature(body, signStripePayload(body, 'whsec_x', t), [SECRET], t)).toBe(false);
    expect(verifyStripeSignature('{"a":2}', signStripePayload(body, SECRET, t), [SECRET], t)).toBe(false);
    expect(verifyStripeSignature(body, signStripePayload(body, SECRET, t).replace('v1=', 'v0='), [SECRET], t)).toBe(false);
    expect(verifyStripeSignature(body, signStripePayload(body, SECRET, t - 301), [SECRET], t)).toBe(false);
    expect(verifyStripeSignature(body, signStripePayload(body, SECRET, t + 301), [SECRET], t)).toBe(false);
    expect(verifyStripeSignature(body, undefined, [SECRET], t)).toBe(false);
    expect(verifyStripeSignature(body, 't=1,v1=zz', [SECRET], t)).toBe(false);
  });

  it('parses the events we act on and ignores the rest', () => {
    expect(parseStripeEvent({ id: 'evt', object: 'event', type: 'invoice.paid', data: { object: { id: 'in_1', object: 'invoice', parent: { subscription_details: { subscription: 'sub_9' } } } } }))
      .toEqual({ id: 'evt', type: 'invoice.paid', kind: 'grant', subscriptionId: 'sub_9', orderId: 'in_1', chargeId: null, disputeStatus: null });
    expect(parseStripeEvent({ id: 'evt', object: 'event', type: 'charge.dispute.closed', data: { object: { id: 'dp_1', object: 'dispute', charge: 'ch_1', status: 'lost' } } }))
      .toMatchObject({ kind: 'dispute-closed', chargeId: 'ch_1', disputeStatus: 'lost' });
    expect(parseStripeEvent({ id: 'evt', object: 'event', type: 'charge.dispute.created', data: { object: {} } })?.kind).toBe('ignore');
    expect(parseStripeEvent({ id: 'evt', object: 'event', type: 'customer.created', data: { object: {} } })?.kind).toBe('ignore');
    expect(parseStripeEvent({ id: 'evt', type: 'invoice.paid' })).toBeNull();
  });
});

describe('the licence server', () => {
  it('a checkout mints a token the APP verifies offline, exp = the paid-through date', async () => {
    const w = world();
    expect(await checkout(w)).toMatchObject({ status: 200, body: '{"status":"issued"}' });
    const record = await w.store.bySubscription('sub_1');
    expect(record).toMatchObject({ status: 'active', plan: 'annual', orderIds: ['cs_test_1'] });
    const v = w.verifyApp(record!.token);
    expect(v.ok && v.claims).toMatchObject({ kid: 'prod-test', tier: 'pro', plan: 'annual', exp: w.now() + 365 * DAY, seats: 3 });
    expect(w.issued).toHaveLength(1);
    // No plaintext email kept.
    expect(JSON.stringify(record)).not.toMatch(/example\.com/i);
  });

  it('REPLAYED WEBHOOKS: the same event id twice mints nothing more; a stale capture is refused outright', async () => {
    const w = world();
    activeSub(w);
    const body = w.event('customer.subscription.created', { id: 'sub_1', object: 'subscription' }, 'evt_fixed');
    expect((await w.deliver(body)).body).toContain('issued');
    expect((await w.deliver(body)).body).toContain('duplicate');
    w.advance(600);
    expect((await w.deliver(body, { t: w.now() - 600 })).status).toBe(400);
    expect(w.issued).toHaveLength(1);
  });

  it('a different event that says nothing new mints nothing (no fresh token per retry)', async () => {
    const w = world();
    await checkout(w);
    const before = (await w.store.bySubscription('sub_1'))!.token;
    await w.deliver(w.event('customer.subscription.updated', { id: 'sub_1', object: 'subscription' }));
    expect((await w.store.bySubscription('sub_1'))!.token).toBe(before);
  });

  it('a forged event cannot grant: unsigned → 400; signed but the subscription is not active at Stripe → no token', async () => {
    const w = world();
    const body = w.event('customer.subscription.created', { id: 'sub_x', object: 'subscription', status: 'active' });
    expect((await w.handle({ method: 'POST', url: '/webhooks/stripe', headers: {}, body })).status).toBe(400);
    expect((await w.deliver(body, { secret: 'whsec_guess' })).status).toBe(400);
    w.subs.set('sub_x', { id: 'sub_x', status: 'incomplete', customerEmail: null, currentPeriodEnd: w.now() + DAY, interval: 'month' });
    expect((await w.deliver(body)).body).toContain('canceled');
    expect(await w.store.bySubscription('sub_x')).toBeNull();
  });

  it('a renewal mints a later token; the app’s refresh returns it', async () => {
    const w = world();
    await checkout(w);
    const first = (await w.store.bySubscription('sub_1'))!.token;
    w.advance(365 * DAY);
    activeSub(w, 'sub_1', w.now() + 365 * DAY);
    expect((await w.deliver(w.event('invoice.paid', { id: 'in_2', object: 'invoice', subscription: 'sub_1' }))).body).toContain('renewed');
    const res = await w.post('/v1/licence/refresh', { token: first });
    const reply = JSON.parse(res.body) as { status: string; token: string };
    expect(reply.status).toBe('renewed');
    expect(reply.token).not.toBe(first);
    const v = w.verifyApp(reply.token);
    expect(v.ok && v.claims.lid).toBe(w.verifyApp(first).ok && (w.verifyApp(first) as { claims: { lid: string } }).claims.lid);
    expect(JSON.parse((await w.post('/v1/licence/refresh', { token: reply.token })).body).status).toBe('current');
  });

  it('the clock reading in a reply is signed for that licence', async () => {
    const w = world();
    await checkout(w);
    const record = (await w.store.bySubscription('sub_1'))!;
    const clock = JSON.parse((await w.post('/v1/licence/refresh', { token: record.token })).body).clock as { now: number; sig: string };
    const pub = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: w.x }, format: 'jwk' });
    expect(crypto.verify(null, timeMessage(clock.now, record.lid), pub, Buffer.from(clock.sig, 'base64url'))).toBe(true);
    expect(crypto.verify(null, timeMessage(clock.now, 'lic_other'), pub, Buffer.from(clock.sig, 'base64url'))).toBe(false);
  });

  it('refresh refuses a forged token', async () => {
    const w = world();
    expect((await w.post('/v1/licence/refresh', { token: 'OFFSUIT1.e30.' + 'A'.repeat(86) })).status).toBe(400);
  });

  it('cancellation and refunds: no token is handed out afterwards, and a refunded period stays refunded', async () => {
    const w = world();
    await checkout(w);
    const token = (await w.store.bySubscription('sub_1'))!.token;
    w.subs.set('sub_1', { ...w.subs.get('sub_1')!, status: 'canceled' });
    await w.deliver(w.event('customer.subscription.deleted', { id: 'sub_1', object: 'subscription' }));
    expect(JSON.parse((await w.post('/v1/licence/refresh', { token })).body)).toMatchObject({ status: 'canceled' });
    expect(JSON.parse((await w.post('/v1/licence/refresh', { token })).body).token).toBeUndefined();
    w.charges.set('ch_1', 'sub_1');
    await w.deliver(w.event('charge.refunded', { id: 'ch_1', object: 'charge' }));
    expect((await w.store.bySubscription('sub_1'))!.status).toBe('revoked');
    // A later "active" event for the refunded period cannot re-grant it.
    w.subs.set('sub_1', { ...w.subs.get('sub_1')!, status: 'active' });
    expect((await w.deliver(w.event('customer.subscription.updated', { id: 'sub_1', object: 'subscription' }))).body).toContain('revoked');
    expect(JSON.parse((await w.post('/v1/licence/refresh', { token })).body)).toMatchObject({ status: 'revoked', clock: { now: w.now(), kid: 'prod-test' } });
  });

  it('RACE: Stripe’s first three events at once mint ONE licence and send ONE email', async () => {
    const w = world({ latencyMs: 5 });
    activeSub(w);
    await Promise.all([
      w.deliver(w.event('checkout.session.completed', { id: 'cs_1', object: 'checkout.session', subscription: 'sub_1' })),
      w.deliver(w.event('customer.subscription.created', { id: 'sub_1', object: 'subscription' })),
      w.deliver(w.event('invoice.paid', { id: 'in_1', object: 'invoice', subscription: 'sub_1' })),
    ]);
    expect(w.issued).toHaveLength(1);
    const record = (await w.store.bySubscription('sub_1'))!;
    expect([...record.orderIds].sort()).toEqual(['cs_1', 'in_1']);
  });

  it('RACE: a refund arriving with a grant is never overwritten by it', async () => {
    const w = world({ latencyMs: 5 });
    await checkout(w);
    w.charges.set('ch_1', 'sub_1');
    await Promise.all([
      w.deliver(w.event('charge.refunded', { id: 'ch_1', object: 'charge' })),
      w.deliver(w.event('customer.subscription.updated', { id: 'sub_1', object: 'subscription' })),
    ]);
    expect((await w.store.bySubscription('sub_1'))!.status).toBe('revoked');
  });

  it('a refund before any licence exists leaves a tombstone: the next grant for that period issues nothing', async () => {
    const w = world();
    activeSub(w);
    w.charges.set('ch_1', 'sub_1');
    await w.deliver(w.event('charge.refunded', { id: 'ch_1', object: 'charge' }));
    expect((await w.deliver(w.event('customer.subscription.created', { id: 'sub_1', object: 'subscription' }))).body).toContain('revoked');
    expect(w.issued).toHaveLength(0);
  });

  it('a PARTIAL refund does not revoke; a dispute revokes only when lost', async () => {
    const w = world();
    await checkout(w);
    w.charges.set('ch_1', 'sub_1');
    w.chargeAmounts.set('ch_1', { amount: 4800, refunded: 500 });
    await w.deliver(w.event('charge.refunded', { id: 'ch_1', object: 'charge' }));
    expect((await w.store.bySubscription('sub_1'))!.status).toBe('active');
    await w.deliver(w.event('charge.dispute.created', { id: 'dp_1', object: 'dispute', charge: 'ch_1', status: 'needs_response' }));
    expect((await w.store.bySubscription('sub_1'))!.status).toBe('active');
    await w.deliver(w.event('charge.dispute.closed', { id: 'dp_1', object: 'dispute', charge: 'ch_1', status: 'won' }));
    expect((await w.store.bySubscription('sub_1'))!.status).toBe('active');
    await w.deliver(w.event('charge.dispute.closed', { id: 'dp_1', object: 'dispute', charge: 'ch_1', status: 'lost' }));
    expect((await w.store.bySubscription('sub_1'))!.status).toBe('revoked');
  });

  it('after a refund, a NEW paid period (Stripe kept billing) issues a key again', async () => {
    const w = world();
    await checkout(w);
    w.charges.set('ch_1', 'sub_1');
    await w.deliver(w.event('charge.refunded', { id: 'ch_1', object: 'charge' }));
    w.advance(365 * DAY);
    activeSub(w, 'sub_1', w.now() + 365 * DAY);
    expect((await w.deliver(w.event('invoice.paid', { id: 'in_9', object: 'invoice', subscription: 'sub_1' }))).body).toContain('renewed');
    expect((await w.store.bySubscription('sub_1'))!.status).toBe('active');
  });

  it('past-due back to active in the same period mints nothing new', async () => {
    const w = world();
    await checkout(w);
    const token = (await w.store.bySubscription('sub_1'))!.token;
    w.subs.set('sub_1', { ...w.subs.get('sub_1')!, status: 'past_due' });
    await w.deliver(w.event('invoice.payment_failed', { id: 'in_x', object: 'invoice', subscription: 'sub_1' }));
    w.subs.set('sub_1', { ...w.subs.get('sub_1')!, status: 'active' });
    await w.deliver(w.event('customer.subscription.updated', { id: 'sub_1', object: 'subscription' }));
    const after = (await w.store.bySubscription('sub_1'))!;
    expect(after.status).toBe('active');
    expect(after.token).toBe(token);
    expect(w.issued).toHaveLength(1);
  });

  it('restore needs the order id AND the email; every miss looks the same', async () => {
    const w = world();
    await checkout(w);
    const ok = await w.post('/v1/licence/restore', { orderId: 'cs_test_1', email: '  sam@example.COM ' });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body).token).toBe((await w.store.bySubscription('sub_1'))!.token);
    for (const bad of [{ orderId: 'cs_test_1', email: 'other@example.com' }, { orderId: 'cs_nope', email: 'sam@example.com' }, {}]) {
      const res = await w.post('/v1/licence/restore', bad);
      expect(res).toMatchObject({ status: 404, body: '{"status":"not-found"}' });
    }
  });

  it('the claim page shows the key and the deep link, escapes it, and waits for a slow webhook', async () => {
    const w = world();
    const pending = await w.handle({ method: 'GET', url: '/v1/licence/claim?session_id=cs_test_1', headers: {}, body: '' });
    expect(pending.status).toBe(202);
    await checkout(w);
    const page = await w.handle({ method: 'GET', url: '/v1/licence/claim?session_id=cs_test_1', headers: {}, body: '' });
    expect(page.status).toBe(200);
    expect(page.body).toContain('offsuit://activate?key=OFFSUIT1.');
    expect(page.body).not.toMatch(/<script/i);
    expect((await w.handle({ method: 'GET', url: '/v1/licence/claim?session_id=<x>', headers: {}, body: '' })).status).toBe(404);
  });

  it('a failure mid-processing releases the event so Stripe’s retry is processed', async () => {
    const w = world();
    activeSub(w);
    const original = w.subs.get.bind(w.subs);
    let fail = true;
    w.subs.get = (id: string) => {
      if (fail) throw new Error('stripe down');
      return original(id);
    };
    const body = w.event('customer.subscription.created', { id: 'sub_1', object: 'subscription' }, 'evt_retry');
    expect((await w.deliver(body)).status).toBe(500);
    fail = false;
    expect((await w.deliver(body)).body).toContain('issued');
  });

  it('verifyWithKeys accepts retired kids it is told about and nothing else', async () => {
    const w = world();
    await checkout(w);
    const token = (await w.store.bySubscription('sub_1'))!.token;
    expect(verifyWithKeys(token, { 'prod-test': w.x }).ok).toBe(true);
    expect(verifyWithKeys(token, {}).ok).toBe(false);
  });
});

describe('stripeApi', () => {
  it('reads the period from the item (new API) or the subscription (old), with the restricted key', async () => {
    const seen: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      seen.push(`${url} ${(init?.headers as Record<string, string>).authorization}`);
      return new Response(
        JSON.stringify({ id: 'sub_1', status: 'active', customer: { email: 'a@b.c' }, items: { data: [{ current_period_end: 1_800_000_000, price: { recurring: { interval: 'month' } } }] } }),
      );
    }) as typeof fetch;
    const api = stripeApi('rk_test_1', fake);
    expect(await api.getSubscription('sub_1')).toEqual({ id: 'sub_1', status: 'active', customerEmail: 'a@b.c', currentPeriodEnd: 1_800_000_000, interval: 'month' });
    expect(seen[0]).toBe('https://api.stripe.com/v1/subscriptions/sub_1?expand[]=customer Bearer rk_test_1');
  });
});

export type { LicenceRequest };

describe('licenceServerDepsFromEnv', async () => {
  const { licenceServerDepsFromEnv } = await import('../../src/server/licensing/fromEnv.js');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const jwk = { kid: 'prod-x', x: publicKey.export({ format: 'jwk' }).x as string, d: privateKey.export({ format: 'jwk' }).d as string };
  const env = {
    OFFSUIT_LICENCE_SIGNING_KEY: JSON.stringify(jwk),
    OFFSUIT_LICENCE_PUBLIC_KEYS: JSON.stringify({ 'prod-x': jwk.x }),
    OFFSUIT_LICENCE_EMAIL_PEPPER: 'p',
    STRIPE_SECRET_KEY: 'rk_test',
    STRIPE_WEBHOOK_SECRETS: 'whsec_a, whsec_b',
  };

  it('builds the deps from the setup script’s env', () => {
    const deps = licenceServerDepsFromEnv(env, new MemoryLicenceStore());
    expect(deps.webhookSecrets).toEqual(['whsec_a', 'whsec_b']);
    expect(deps.signing.kid).toBe('prod-x');
  });

  it('names what is missing, and refuses public keys that omit the signing key', () => {
    expect(() => licenceServerDepsFromEnv({ ...env, STRIPE_WEBHOOK_SECRETS: '' }, new MemoryLicenceStore())).toThrow('STRIPE_WEBHOOK_SECRETS');
    expect(() => licenceServerDepsFromEnv({ ...env, OFFSUIT_LICENCE_PUBLIC_KEYS: '{}' }, new MemoryLicenceStore())).toThrow('must include');
  });
});
