/**
 * The licence server's store (src/server/licensing/store.ts LicenceStore), as one JSON file in the online
 * server's state directory, beside state.json and backed up with it.
 *
 * ONE PROCESS, SERIALISED WRITES. The online server runs as a single process (one systemd unit), and every
 * mutation here goes through one promise chain and rewrites the file atomically (temp, fsync, rename)
 * before it resolves, so writes for any subscription are serialised and a crash leaves the previous whole
 * file. Running more than one instance would need a real database with per-subscription locking
 * (docs/PAYMENTS-SETUP.md); this store refuses nothing to warn of that, so the deploy runs exactly one.
 *
 * Event ids are kept 35 days (Stripe retries for 3), so the file does not grow without bound.
 */

import * as fs from 'node:fs';
import type { LicenceRecord, LicenceStore } from '../src/server/licensing/store.js';

interface LicenceFile {
  readonly v: 1;
  /** Event id → when it was claimed (ms). */
  events: Record<string, number>;
  records: Record<string, LicenceRecord>;
  orders: Record<string, string>;
}

const EVENT_TTL_MS = 35 * 86_400_000;

export class FileLicenceStore implements LicenceStore {
  private data: LicenceFile;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {
    this.data = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as LicenceFile) : { v: 1, events: {}, records: {}, orders: {} };
  }

  /** Run one mutation after every earlier one, then persist before resolving. */
  private write<T>(mutate: () => T): Promise<T> {
    const next = this.chain.then(() => {
      const result = mutate();
      this.persist();
      return result;
    });
    this.chain = next.catch(() => undefined);
    return next;
  }

  private persist(): void {
    const cutoff = this.now() - EVENT_TTL_MS;
    for (const [id, at] of Object.entries(this.data.events)) if (at < cutoff) delete this.data.events[id];
    const tmp = `${this.file}.tmp-${process.pid}`;
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(this.data));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
  }

  claimEvent(eventId: string): Promise<boolean> {
    return this.write(() => {
      if (Object.hasOwn(this.data.events, eventId)) return false;
      this.data.events[eventId] = this.now();
      return true;
    });
  }

  releaseEvent(eventId: string): Promise<void> {
    return this.write(() => {
      delete this.data.events[eventId];
    });
  }

  async bySubscription(subscriptionId: string): Promise<LicenceRecord | null> {
    await this.chain;
    return Object.hasOwn(this.data.records, subscriptionId) ? this.data.records[subscriptionId] : null;
  }

  async byLicence(lid: string): Promise<LicenceRecord | null> {
    await this.chain;
    return Object.values(this.data.records).find((r) => r.lid === lid) ?? null;
  }

  async byOrder(orderId: string): Promise<LicenceRecord | null> {
    const sub = await this.subscriptionForOrder(orderId);
    return sub === null ? null : this.bySubscription(sub);
  }

  put(record: LicenceRecord): Promise<void> {
    return this.write(() => {
      this.data.records[record.subscriptionId] = record;
      for (const order of record.orderIds) this.data.orders[order] = record.subscriptionId;
    });
  }

  linkOrder(orderId: string, subscriptionId: string): Promise<void> {
    return this.write(() => {
      this.data.orders[orderId] = subscriptionId;
    });
  }

  async subscriptionForOrder(orderId: string): Promise<string | null> {
    await this.chain;
    return Object.hasOwn(this.data.orders, orderId) ? this.data.orders[orderId] : null;
  }
}
