/**
 * What the licence server remembers. An interface so the online server can back it with its own
 * database; `MemoryLicenceStore` is the reference implementation the tests run against.
 *
 * No card data, no name, no address: Stripe is the merchant of record and keeps those. An email is kept
 * only as a peppered hash (mint.ts emailHash), to check a restore request.
 */

export type LicenceStatus = 'active' | 'past-due' | 'canceled' | 'revoked';

export interface LicenceRecord {
  readonly lid: string;
  readonly subscriptionId: string;
  readonly plan: 'monthly' | 'annual';
  readonly status: LicenceStatus;
  /** Unix seconds: the period paid through. The latest token's `exp`. */
  readonly paidThrough: number;
  /** The latest token minted for this licence. */
  readonly token: string;
  readonly emailHash: string | null;
  /** Checkout sessions and invoices that paid for it: what a receipt shows, so they can restore it. */
  readonly orderIds: readonly string[];
}

export interface LicenceStore {
  /** Record an event id; false if it was already recorded (a replay or a retry). Atomic. */
  claimEvent(eventId: string): Promise<boolean>;
  /** Undo `claimEvent` when processing failed, so Stripe's retry is processed rather than skipped. */
  releaseEvent(eventId: string): Promise<void>;
  bySubscription(subscriptionId: string): Promise<LicenceRecord | null>;
  byLicence(lid: string): Promise<LicenceRecord | null>;
  byOrder(orderId: string): Promise<LicenceRecord | null>;
  put(record: LicenceRecord): Promise<void>;
  /** Remember an order id before its subscription is known (checkout can arrive before the subscription). */
  linkOrder(orderId: string, subscriptionId: string): Promise<void>;
  subscriptionForOrder(orderId: string): Promise<string | null>;
}

export class MemoryLicenceStore implements LicenceStore {
  private readonly events = new Set<string>();
  private readonly records = new Map<string, LicenceRecord>();
  private readonly orders = new Map<string, string>();

  async claimEvent(eventId: string): Promise<boolean> {
    if (this.events.has(eventId)) return false;
    this.events.add(eventId);
    return true;
  }
  async releaseEvent(eventId: string): Promise<void> {
    this.events.delete(eventId);
  }
  async bySubscription(subscriptionId: string): Promise<LicenceRecord | null> {
    return this.records.get(subscriptionId) ?? null;
  }
  async byLicence(lid: string): Promise<LicenceRecord | null> {
    for (const r of this.records.values()) if (r.lid === lid) return r;
    return null;
  }
  async byOrder(orderId: string): Promise<LicenceRecord | null> {
    const sub = this.orders.get(orderId);
    return sub === undefined ? null : (this.records.get(sub) ?? null);
  }
  async put(record: LicenceRecord): Promise<void> {
    this.records.set(record.subscriptionId, record);
    for (const order of record.orderIds) this.orders.set(order, record.subscriptionId);
  }
  async linkOrder(orderId: string, subscriptionId: string): Promise<void> {
    this.orders.set(orderId, subscriptionId);
  }
  async subscriptionForOrder(orderId: string): Promise<string | null> {
    return this.orders.get(orderId) ?? null;
  }
}
