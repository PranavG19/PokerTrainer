/**
 * Stripe (Managed Payments) webhooks: signature verification and event → subscription id.
 *
 * research/TECH-PAYMENTS.md §3: header `Stripe-Signature: t=<unix>,v1=<hex>[,v1=…]`, where
 * v1 = hex(HMAC-SHA256(whsec secret, `${t}.${rawBody}`)). Only `v1` is honoured (a `v0` test scheme is
 * ignored), every v1 is tried (Stripe sends one per active secret while a secret is being rolled), the
 * compare is constant-time, and `t` must be within TOLERANCE_SECONDS of now, so a captured delivery
 * cannot be replayed later. Inside the window, replays are stopped by the event-id ledger (handler.ts).
 *
 * An event is only a trigger: the handler re-reads the subscription from Stripe's API before granting
 * anything (delivery order is not guaranteed, and an event body is a snapshot that may be stale).
 */

import * as crypto from 'node:crypto';

export const TOLERANCE_SECONDS = 300;

export function verifyStripeSignature(
  rawBody: string,
  header: string | undefined,
  secrets: readonly string[],
  nowSeconds: number,
  toleranceSeconds = TOLERANCE_SECONDS,
): boolean {
  if (typeof header !== 'string' || header.length > 4096 || secrets.length === 0) return false;
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't' && /^\d{1,12}$/.test(value)) t = Number(value);
    else if (key === 'v1' && /^[0-9a-f]{64}$/.test(value)) v1.push(value);
  }
  if (t === null || v1.length === 0) return false;
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  for (const secret of secrets) {
    const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest();
    for (const candidate of v1) {
      if (crypto.timingSafeEqual(expected, Buffer.from(candidate, 'hex'))) return true;
    }
  }
  return false;
}

/** Build a header the way Stripe does. For tests and the local webhook replayer only. */
export function signStripePayload(rawBody: string, secret: string, t: number): string {
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

/** What an event means for us, before the API read-back. */
/**
 * - grant / past-due / ended: re-read the subscription and follow it.
 * - refund: revoke only if the charge is FULLY refunded (a goodwill partial refund is not a cancellation).
 * - dispute-closed: revoke only when the dispute is lost. An open dispute changes nothing: most are won.
 */
export type EventKind = 'grant' | 'past-due' | 'ended' | 'refund' | 'dispute-closed' | 'ignore';

export interface ParsedEvent {
  readonly id: string;
  readonly type: string;
  readonly kind: EventKind;
  /** The subscription the event is about, when the body names it. */
  readonly subscriptionId: string | null;
  /** The checkout session id (cs_…) or invoice id (in_…): what a receipt shows, used to restore. */
  readonly orderId: string | null;
  /** A charge (refund, dispute) whose subscription must be looked up through its invoice. */
  readonly chargeId: string | null;
  /** A dispute's outcome: 'lost', 'won', … (charge.dispute.closed only). */
  readonly disputeStatus: string | null;
}

const KINDS: Readonly<Record<string, EventKind>> = {
  'checkout.session.completed': 'grant',
  'customer.subscription.created': 'grant',
  'customer.subscription.updated': 'grant',
  'invoice.paid': 'grant',
  'invoice.payment_failed': 'past-due',
  'customer.subscription.deleted': 'ended',
  'charge.refunded': 'refund',
  'charge.dispute.closed': 'dispute-closed',
};

export function parseStripeEvent(json: unknown): ParsedEvent | null {
  const o = record(json);
  const id = str(o.id);
  const type = str(o.type);
  if (id === null || type === null || o.object !== 'event') return null;
  const obj = record(record(o.data).object);
  const kind = KINDS[type] ?? 'ignore';
  const objId = str(obj.id);
  const objType = str(obj.object);

  let subscriptionId: string | null = null;
  if (objType === 'subscription') subscriptionId = objId;
  else subscriptionId = str(obj.subscription) ?? str(record(record(obj.parent).subscription_details).subscription);

  let orderId: string | null = null;
  if (objType === 'checkout.session' || objType === 'invoice') orderId = objId;

  let chargeId: string | null = null;
  if (objType === 'charge') chargeId = objId;
  else if (objType === 'dispute') chargeId = str(obj.charge);

  const disputeStatus = objType === 'dispute' ? str(obj.status) : null;
  return { id, type, kind, subscriptionId, orderId, chargeId, disputeStatus };
}

/** The subscription as Stripe's API reports it now. */
export interface SubscriptionTruth {
  readonly id: string;
  /** Stripe's status: active, trialing, past_due, canceled, unpaid, incomplete, … */
  readonly status: string;
  readonly customerEmail: string | null;
  /** Unix seconds: the end of the period paid for. */
  readonly currentPeriodEnd: number;
  readonly interval: 'month' | 'year' | null;
}

/** What the handler needs from Stripe's API. Faked in tests; `stripeApi` is the real one. */
export interface StripeApi {
  getSubscription(id: string): Promise<SubscriptionTruth | null>;
  /** A charge with the subscription it paid for (charge → invoice → subscription), or null. */
  getCharge(chargeId: string): Promise<ChargeTruth | null>;
}

export interface ChargeTruth {
  readonly id: string;
  readonly subscriptionId: string | null;
  /** Minor units. */
  readonly amount: number;
  readonly amountRefunded: number;
}

/**
 * The real client: two GETs with the restricted secret key. `fetchImpl` is injectable for tests and for
 * hosts without a global fetch. Reads only; this module never creates or changes anything at Stripe.
 */
export function stripeApi(secretKey: string, fetchImpl: typeof fetch = fetch): StripeApi {
  const get = async (path: string): Promise<Record<string, unknown> | null> => {
    const response = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
      headers: { authorization: `Bearer ${secretKey}` },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`stripe ${path.split('?')[0]}: ${response.status}`);
    return record(await response.json());
  };
  return {
    async getSubscription(id) {
      const s = await get(`subscriptions/${encodeURIComponent(id)}?expand[]=customer`);
      if (s === null) return null;
      const item = record(asArray(record(s.items).data)[0]);
      // Newer API versions put the period on the item; older ones on the subscription.
      const periodEnd = num(item.current_period_end) ?? num(s.current_period_end);
      const interval = str(record(record(item.price).recurring).interval);
      if (str(s.id) === null || str(s.status) === null || periodEnd === null) return null;
      return {
        id: str(s.id) as string,
        status: str(s.status) as string,
        customerEmail: str(record(s.customer).email),
        currentPeriodEnd: periodEnd,
        interval: interval === 'month' || interval === 'year' ? interval : null,
      };
    },
    async getCharge(chargeId) {
      const c = await get(`charges/${encodeURIComponent(chargeId)}?expand[]=invoice`);
      if (c === null || str(c.id) === null) return null;
      const inv = record(c.invoice);
      return {
        id: str(c.id) as string,
        subscriptionId: str(inv.subscription) ?? str(record(record(inv.parent).subscription_details).subscription),
        amount: typeof c.amount === 'number' ? c.amount : 0,
        amountRefunded: typeof c.amount_refunded === 'number' ? c.amount_refunded : 0,
      };
    },
  };
}

function record(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= 255 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
}
