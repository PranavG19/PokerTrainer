/**
 * THE LICENCE SERVER: Stripe webhook → Ed25519 licence token, plus the app's two user-initiated calls
 * (refresh, restore) and the checkout success page. Framework-free: `handle(request)` takes a method,
 * path, headers and the RAW body (the signature covers the exact bytes) and returns a status and body;
 * `nodeListener` adapts it to node:http. The online server task mounts it; docs/PAYMENTS-SETUP.md lists
 * the env it needs.
 *
 * Routes
 *   POST /webhooks/stripe      Stripe-Signature verified, 5-minute window, event ids deduplicated.
 *   POST /v1/licence/refresh   { token }            → { status, token? }  (the app's "Check for renewal")
 *   POST /v1/licence/restore   { orderId, email }   → { status, token? }  (the app's "Restore")
 *   GET  /v1/licence/claim?session_id=cs_…          → an HTML page with the key and an offsuit:// link
 *
 * Grants come only from the subscription as Stripe's API reports it at processing time, never from the
 * event body, so a reordered, stale or replayed event cannot grant more than Stripe currently says.
 * A token is minted only when the paid-through date moves forward, so a retried event mints nothing.
 *
 * The host must add rate limiting on /v1/* (restore takes a guessable-looking order id) and TLS.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import * as crypto from 'node:crypto';
import { emailHash, mintToken, newLicenceId, verifyWithKeys, type SigningKey } from './mint.js';
import { parseStripeEvent, verifyStripeSignature, type StripeApi, type SubscriptionTruth } from './stripe.js';
import type { LicenceRecord, LicenceStatus, LicenceStore } from './store.js';

export interface LicenceServerDeps {
  readonly store: LicenceStore;
  readonly stripe: StripeApi;
  /** Every active webhook signing secret (two while rolling one). */
  readonly webhookSecrets: readonly string[];
  readonly signing: SigningKey;
  /** Public keys the server accepts on refresh: kid → x. Includes the signing key's and retired ones. */
  readonly publicKeys: Readonly<Record<string, string>>;
  /** Peppers the email hash. A secret. */
  readonly emailPepper: string;
  readonly nowSeconds: () => number;
  /** Seats per purchase, carried in the token. */
  readonly seats?: number;
  /** Called after a new token is minted (e.g. to email it). Failures are logged, never fatal. */
  readonly onIssued?: (record: LicenceRecord) => Promise<void> | void;
  readonly log?: (line: string) => void;
}

export interface LicenceRequest {
  readonly method: string;
  /** Path with query, e.g. `/v1/licence/claim?session_id=cs_123`. */
  readonly url: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
}

export interface LicenceResponse {
  readonly status: number;
  readonly contentType: 'application/json' | 'text/html; charset=utf-8';
  readonly body: string;
}

const json = (status: number, value: unknown): LicenceResponse => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(value),
});

export function createLicenceServer(deps: LicenceServerDeps): (request: LicenceRequest) => Promise<LicenceResponse> {
  const log = deps.log ?? (() => {});

  async function webhook(request: LicenceRequest): Promise<LicenceResponse> {
    const now = deps.nowSeconds();
    if (!verifyStripeSignature(request.body, request.headers['stripe-signature'], deps.webhookSecrets, now)) {
      return json(400, { status: 'bad-signature' });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(request.body);
    } catch {
      return json(400, { status: 'bad-body' });
    }
    const event = parseStripeEvent(parsed);
    if (event === null) return json(400, { status: 'bad-body' });
    if (event.kind === 'ignore') return json(200, { status: 'ignored' });
    if (!(await deps.store.claimEvent(event.id))) return json(200, { status: 'duplicate' });

    try {
      let subscriptionId = event.subscriptionId;
      let charge = null;
      if (event.chargeId !== null) {
        charge = await deps.stripe.getCharge(event.chargeId);
        subscriptionId ??= charge?.subscriptionId ?? null;
      }
      if (subscriptionId === null && event.orderId !== null) {
        subscriptionId = await deps.store.subscriptionForOrder(event.orderId);
      }
      if (subscriptionId === null) return json(200, { status: 'no-subscription' });
      const sub = subscriptionId;
      // One subscription's events run one at a time: Stripe sends checkout, subscription and invoice
      // events within milliseconds, and each is a read-then-write of the same record.
      const outcome = await serialized(sub, async () => {
        if (event.orderId !== null) await deps.store.linkOrder(event.orderId, sub);
        if (event.kind === 'refund') {
          if (charge === null || charge.amountRefunded < charge.amount) return 'partial-refund';
          return revoke(sub, event.orderId);
        }
        if (event.kind === 'dispute-closed') {
          return event.disputeStatus === 'lost' ? revoke(sub, event.orderId) : 'dispute-closed';
        }
        const truth = await deps.stripe.getSubscription(sub);
        if (truth === null) return 'no-subscription';
        return apply(truth, event.orderId, now);
      });
      return json(200, { status: outcome });
    } catch (error) {
      // Let Stripe's retry run the event again rather than having it skipped as a duplicate.
      await deps.store.releaseEvent(event.id);
      log(`webhook ${event.type} ${event.id} failed: ${(error as Error).message}`);
      return json(500, { status: 'error' });
    }
  }

  /**
   * Per-subscription serialisation within this process. A host running several instances must give the
   * store an equivalent guarantee (a row lock or compare-and-set on `put`); docs/PAYMENTS-SETUP.md says so.
   */
  const queues = new Map<string, Promise<unknown>>();
  function serialized<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.then(run, run);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    queues.set(key, settled);
    void settled.then(() => {
      if (queues.get(key) === settled) queues.delete(key);
    });
    return next;
  }

  /**
   * A full refund or a lost dispute: no key is handed out for the period it covered. With no record yet
   * (the refund beat the grant), a tombstone is written so the grant that follows issues nothing. A LATER
   * paid period (Stripe kept billing) is a new purchase and is granted again.
   */
  async function revoke(subscriptionId: string, orderId: string | null): Promise<string> {
    const existing = await deps.store.bySubscription(subscriptionId);
    const truth = await deps.stripe.getSubscription(subscriptionId);
    const through = Math.max(existing?.paidThrough ?? 0, truth?.currentPeriodEnd ?? 0);
    const orderIds = mergeOrders(existing?.orderIds ?? [], orderId);
    await deps.store.put(
      existing !== null
        ? { ...existing, status: 'revoked', paidThrough: through, orderIds }
        : {
            lid: newLicenceId(),
            subscriptionId,
            plan: truth?.interval === 'year' ? 'annual' : 'monthly',
            status: 'revoked',
            paidThrough: through,
            token: '',
            emailHash: truth?.customerEmail == null ? null : emailHash(truth.customerEmail, deps.emailPepper),
            orderIds,
          },
    );
    return 'revoked';
  }

  /** Bring our record in line with Stripe's subscription. Returns what happened. */
  async function apply(truth: SubscriptionTruth, orderId: string | null, now: number): Promise<string> {
    const existing = await deps.store.bySubscription(truth.id);
    const status = statusOf(truth.status);
    const orderIds = mergeOrders(existing?.orderIds ?? [], orderId);
    const email = truth.customerEmail === null ? (existing?.emailHash ?? null) : emailHash(truth.customerEmail, deps.emailPepper);
    // A refunded period stays refunded, whatever a later event for it says.
    if (existing?.status === 'revoked' && truth.currentPeriodEnd <= existing.paidThrough) {
      await deps.store.put({ ...existing, orderIds, emailHash: email });
      return 'revoked';
    }

    if (status !== 'active' || truth.currentPeriodEnd <= now) {
      if (existing !== null && existing.status !== 'revoked') await deps.store.put({ ...existing, status, orderIds, emailHash: email });
      return status;
    }
    const plan = truth.interval === 'year' ? 'annual' : 'monthly';
    // The same period (a retry, or past-due paid up): the key already minted covers it; no new one.
    if (existing !== null && existing.status !== 'revoked' && existing.token !== '' && truth.currentPeriodEnd <= existing.paidThrough) {
      await deps.store.put({ ...existing, status: 'active', orderIds, emailHash: email });
      return 'current';
    }
    const lid = existing?.lid ?? newLicenceId();
    const token = mintToken(deps.signing, {
      lid,
      tier: 'pro',
      plan,
      iat: now,
      exp: truth.currentPeriodEnd,
      seats: deps.seats ?? 3,
    });
    const record: LicenceRecord = {
      lid,
      subscriptionId: truth.id,
      plan,
      status: 'active',
      paidThrough: truth.currentPeriodEnd,
      token,
      emailHash: email,
      orderIds,
    };
    await deps.store.put(record);
    try {
      await deps.onIssued?.(record);
    } catch (error) {
      log(`onIssued ${lid} failed: ${(error as Error).message}`);
    }
    return existing === null || existing.token === '' ? 'issued' : 'renewed';
  }

  async function refresh(request: LicenceRequest): Promise<LicenceResponse> {
    const body = parseBody(request.body);
    const token = typeof body?.token === 'string' ? body.token : '';
    const verified = verifyWithKeys(token, deps.publicKeys);
    if (!verified.ok) return json(400, { status: 'invalid' });
    const record = await deps.store.byLicence(verified.claims.lid);
    if (record === null) return json(404, { status: 'not-found' });
    return json(200, { ...reply(record, token), now: deps.nowSeconds() });
  }

  async function restore(request: LicenceRequest): Promise<LicenceResponse> {
    const body = parseBody(request.body);
    const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
    const email = typeof body?.email === 'string' ? body.email : '';
    // One answer for every miss, so the endpoint cannot be used to learn which orders exist.
    const notFound = json(404, { status: 'not-found' });
    if (orderId === '' || orderId.length > 128 || email.trim() === '') return notFound;
    // Hashed before the lookup, so a known and an unknown order take the same work.
    const given = Buffer.from(emailHash(email, deps.emailPepper), 'hex');
    const record = await deps.store.byOrder(orderId);
    const stored = Buffer.from(record?.emailHash ?? '0'.repeat(64), 'hex');
    if (!crypto.timingSafeEqual(given, stored) || record === null || record.emailHash === null) return notFound;
    return json(200, { ...reply(record, null), now: deps.nowSeconds() });
  }

  async function claim(request: LicenceRequest): Promise<LicenceResponse> {
    const sessionId = new URL(request.url, 'http://x').searchParams.get('session_id') ?? '';
    const html = (status: number, inner: string, retry = false): LicenceResponse => ({
      status,
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Offsuit Pro</title>${retry ? '<meta http-equiv="refresh" content="3">' : ''}<meta name="viewport" content="width=device-width"></head><body style="font:15px -apple-system,system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;line-height:1.5">${inner}</body></html>`,
    });
    if (!/^cs_[A-Za-z0-9_]{1,200}$/.test(sessionId)) return html(404, '<p>This link is not a checkout we know.</p>');
    const record = await deps.store.byOrder(sessionId);
    if (record === null) return html(202, '<p>Your payment went through. Your key is being made; this page refreshes in a moment.</p>', true);
    if (record.status === 'revoked') return html(410, '<p>This purchase was refunded, so it has no key.</p>');
    const key = escapeHtml(record.token);
    return html(
      200,
      `<h1 style="font-size:22px">Thanks. Here is your Offsuit Pro key.</h1>
<p><a href="offsuit://activate?key=${encodeURIComponent(record.token)}">Open in Offsuit</a> (Offsuit asks before it adds the key), or copy the key into Settings → Offsuit Pro.</p>
<textarea readonly rows="6" style="width:100%;font:12px ui-monospace,Menlo,monospace">${key}</textarea>
<p>Keep this key, or the order number from Stripe's receipt email: either restores Pro on a new Mac. Cancel any time from Settings → Offsuit Pro → Manage or cancel.</p>`,
    );
  }

  return async (request) => {
    const path = new URL(request.url, 'http://x').pathname;
    const method = request.method.toUpperCase();
    if (method === 'POST' && path === '/webhooks/stripe') return webhook(request);
    if (method === 'POST' && path === '/v1/licence/refresh') return refresh(request);
    if (method === 'POST' && path === '/v1/licence/restore') return restore(request);
    if (method === 'GET' && path === '/v1/licence/claim') return claim(request);
    return json(404, { status: 'no-route' });
  };
}

/** The app's reply contract (src/main/licenceClient.ts): a token only while the licence is in good standing. */
function reply(record: LicenceRecord, sent: string | null): { status: string; token?: string } {
  if (record.status === 'revoked') return { status: 'revoked' };
  if (record.status === 'canceled') return { status: 'canceled' };
  const status = sent === null ? record.status : record.token === sent ? 'current' : 'renewed';
  return { status, token: record.token };
}

function statusOf(stripeStatus: string): LicenceStatus {
  if (stripeStatus === 'active' || stripeStatus === 'trialing') return 'active';
  if (stripeStatus === 'past_due') return 'past-due';
  return 'canceled';
}

function mergeOrders(orders: readonly string[], orderId: string | null): readonly string[] {
  return orderId === null || orders.includes(orderId) ? orders : [...orders, orderId].slice(-100);
}

function parseBody(body: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(body);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** node:http adapter. Bodies over 64 KB are refused before they are buffered. */
export function nodeListener(handle: (request: LicenceRequest) => Promise<LicenceResponse>) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 65_536) {
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v;
      handle({ method: req.method ?? 'GET', url: req.url ?? '/', headers, body: Buffer.concat(chunks).toString('utf8') })
        .then((out) => res.writeHead(out.status, { 'content-type': out.contentType, 'cache-control': 'no-store' }).end(out.body))
        .catch(() => res.writeHead(500).end());
    });
  };
}
