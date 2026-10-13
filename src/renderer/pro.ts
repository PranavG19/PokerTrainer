/**
 * The renderer's side of Pro: a DISPLAY copy of main's licence snapshot, the one gating pattern, and the
 * calls the Settings licence section and the upgrade sheet make.
 *
 * Nothing here decides anything. `can()` reads main's snapshot so the UI draws the right surface, but a
 * Pro feature's work runs behind a main IPC handler wrapped in `gated()` (src/main/licence.ts), so
 * changing this module's state from devtools draws a surface that main then refuses to serve.
 *
 * THE GATING PATTERN, for every Pro surface a later task builds:
 *     container.appendChild(proGate(pro, 'leak-finder', () => renderLeakFinder(...)));
 * Free sees an honest locked card that opens the upgrade sheet; Pro sees the surface (or "Coming in an
 * update" while the feature has not shipped). A Free feature passed here always renders: learning is
 * never locked (can() guarantees it).
 */

import { can, freeSnapshot, parseSnapshot, type EntitlementSnapshot } from '../core/entitlements/entitlements.js';
import { FEATURE_INFO, type Feature } from '../core/entitlements/features.js';

export interface ProStatus {
  readonly snapshot: EntitlementSnapshot;
  readonly checkout: { readonly monthly: boolean; readonly annual: boolean };
  readonly manage: boolean;
  /** The licence server's host, when one is configured (shown before any call is made). */
  readonly server: string | null;
  readonly devBuild: boolean;
  readonly pendingDeepLink: boolean;
}

export interface ProBridge {
  licenceStatus?: () => Promise<unknown>;
  licenceActivate?: (key: string) => Promise<unknown>;
  licenceRemove?: () => Promise<unknown>;
  licenceOpenCheckout?: (plan: 'monthly' | 'annual') => Promise<{ opened: boolean }>;
  licenceOpenManage?: () => Promise<{ opened: boolean }>;
  licenceRefresh?: () => Promise<unknown>;
  licenceRestore?: (input: { orderId: string; email: string }) => Promise<unknown>;
  licenceDeepLinkPreview?: () => Promise<unknown>;
  licenceDeepLinkConfirm?: (accept: boolean) => Promise<unknown>;
  onLicenceDeepLink?: (handler: () => void) => () => void;
}

export interface ProNotice {
  readonly kind: 'ok' | 'error';
  readonly text: string;
}

export interface DeepLinkPreview {
  readonly plan: string;
  readonly paidThrough: number | null;
  readonly licenceHint: string;
}

export interface ProClient {
  status(): ProStatus;
  can(feature: Feature): boolean;
  /** The outcome of the last action, kept here so a re-render of Settings still shows it. */
  notice(): ProNotice | null;
  reload(): Promise<void>;
  activate(key: string): Promise<boolean>;
  remove(): Promise<void>;
  openCheckout(plan: 'monthly' | 'annual'): Promise<void>;
  openManage(): Promise<void>;
  refresh(): Promise<void>;
  restore(orderId: string, email: string): Promise<boolean>;
  deepLinkPreview(): Promise<DeepLinkPreview | ProNotice | null>;
  confirmDeepLink(accept: boolean): Promise<void>;
  /** Called after every status change; returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Called when main receives an offsuit:// link. */
  onDeepLink(listener: () => void): () => void;
}

const OFFLINE: ProStatus = {
  snapshot: freeSnapshot(),
  checkout: { monthly: false, annual: false },
  manage: false,
  server: null,
  devBuild: false,
  pendingDeepLink: false,
};

export function parseStatus(raw: unknown): ProStatus {
  if (typeof raw !== 'object' || raw === null) return OFFLINE;
  const o = raw as Record<string, unknown>;
  const checkout = (typeof o.checkout === 'object' && o.checkout !== null ? o.checkout : {}) as Record<string, unknown>;
  return {
    snapshot: parseSnapshot(o.snapshot),
    checkout: { monthly: checkout.monthly === true, annual: checkout.annual === true },
    manage: o.manage === true,
    server: typeof o.server === 'string' ? o.server : null,
    devBuild: o.devBuild === true,
    pendingDeepLink: o.pendingDeepLink === true,
  };
}

/** Why an action failed, in words. Never blames the learner for a server or build that is not set up. */
export function reasonText(reason: unknown, serverStatus?: unknown): string {
  switch (reason) {
    case 'malformed':
    case 'wrong-format':
      return 'That does not look like an Offsuit key. Paste the whole key: it starts with OFFSUIT1.';
    case 'bad-claims':
      return 'That key is damaged. Copy it again from your receipt or the page you got it from.';
    case 'bad-signature':
      return 'That key was not issued for this version of Offsuit (or it is a test key). Nothing was changed.';
    case 'revoked':
      return 'That key was refunded or reported lost, so it no longer works.';
    case 'network':
      return 'Could not reach the licence server. Nothing was changed; try again when you are online.';
    case 'not-configured':
      return 'The licence server is not set up in this build yet.';
    case 'not-found':
      return 'No purchase matches that order number and email.';
    case 'missing':
      return 'Enter both the order number and the email you bought with.';
    case 'no-licence':
      return 'There is no key on this Mac to check.';
    case 'refused':
      return `The licence server said no${typeof serverStatus === 'string' ? ` (${serverStatus})` : ''}. Nothing was changed.`;
    case 'bad-reply':
      return 'The licence server sent something Offsuit could not use. Nothing was changed.';
    case 'declined':
      return 'The key was not added.';
    default:
      return 'That did not work. Nothing was changed.';
  }
}

export function createProClient(bridge: ProBridge): ProClient {
  let status: ProStatus = OFFLINE;
  let notice: ProNotice | null = null;
  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const l of listeners) l();
  };
  const take = (raw: unknown): Record<string, unknown> => {
    const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    if ('status' in o && typeof o.status === 'object') status = parseStatus(o.status);
    return o;
  };
  const fail = (o: Record<string, unknown>): void => {
    notice = { kind: 'error', text: reasonText(o.reason, o.serverStatus) };
  };

  return {
    status: () => status,
    can: (feature) => can(status.snapshot, feature),
    notice: () => notice,
    async reload() {
      status = parseStatus(await bridge.licenceStatus?.());
      emit();
    },
    async activate(key) {
      const o = take(await bridge.licenceActivate?.(key));
      if (o.ok === true) notice = { kind: 'ok', text: 'Pro is on. Thank you.' };
      else fail(o.ok === undefined ? { reason: 'not-configured' } : o);
      emit();
      return o.ok === true;
    },
    async remove() {
      status = parseStatus(await bridge.licenceRemove?.());
      notice = { kind: 'ok', text: 'The key was removed from this Mac. Your purchase is unchanged; paste the key to add it back.' };
      emit();
    },
    async openCheckout(plan) {
      const r = await bridge.licenceOpenCheckout?.(plan);
      notice = r?.opened
        ? { kind: 'ok', text: 'Checkout opened in your browser. When it is done, paste your key below, or use the Open in Offsuit link.' }
        : { kind: 'error', text: 'Checkout is not open yet.' };
      emit();
    },
    async openManage() {
      const r = await bridge.licenceOpenManage?.();
      if (!r?.opened) notice = { kind: 'error', text: 'Subscription management is not set up in this build yet.' };
      emit();
    },
    async refresh() {
      const o = take(await bridge.licenceRefresh?.());
      if (o.ok === true) {
        notice = {
          kind: 'ok',
          text:
            o.serverStatus === 'renewed'
              ? 'Renewed: the new period is on this Mac.'
              : o.serverStatus === 'canceled'
                ? 'The subscription is cancelled. Pro stays until the period you paid for ends.'
                : o.serverStatus === 'revoked'
                  ? 'This purchase was refunded, so no new period was added.'
                  : 'Up to date: there is no newer period yet.',
        };
      } else fail(o.ok === undefined ? { reason: 'not-configured' } : o);
      emit();
    },
    async restore(orderId, email) {
      const o = take(await bridge.licenceRestore?.({ orderId, email }));
      if (o.ok === true) notice = { kind: 'ok', text: 'Restored. Pro is on.' };
      else fail(o.ok === undefined ? { reason: 'not-configured' } : o);
      emit();
      return o.ok === true;
    },
    async deepLinkPreview() {
      const raw = await bridge.licenceDeepLinkPreview?.();
      if (typeof raw !== 'object' || raw === null) return null;
      const o = raw as Record<string, unknown>;
      if (o.ok !== true) return { kind: 'error', text: reasonText(o.reason) };
      return {
        plan: typeof o.plan === 'string' ? o.plan : 'pro',
        paidThrough: typeof o.paidThrough === 'number' ? o.paidThrough : null,
        licenceHint: typeof o.licenceHint === 'string' ? o.licenceHint : '',
      };
    },
    async confirmDeepLink(accept) {
      const o = take(await bridge.licenceDeepLinkConfirm?.(accept));
      if (o.ok === true) notice = { kind: 'ok', text: 'Pro is on. Thank you.' };
      else if (accept) fail(o);
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onDeepLink(listener) {
      return bridge.onLicenceDeepLink?.(listener) ?? (() => {});
    },
  };
}

export function formatDay(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * THE ONE GATE. `render` runs only when the snapshot grants the feature; otherwise an honest locked
 * card that names the feature and opens the upgrade sheet. No blur-teaser of the real surface, no
 * counter, no nag: a sentence and a button.
 */
export function proGate(
  client: ProClient,
  feature: Feature,
  render: () => HTMLElement,
  openSheet: (feature: Feature) => void,
): HTMLElement {
  const info = FEATURE_INFO[feature];
  if (client.can(feature)) {
    if (info.available) return render();
    return gateCard(feature, 'Included in your Pro. Coming in an update.', null);
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pill sm';
  button.dataset.testid = 'pro-gate-open';
  button.textContent = 'What Pro adds';
  button.addEventListener('click', () => openSheet(feature));
  return gateCard(feature, info.available ? 'Part of Pro.' : 'Part of Pro, coming in an update.', button);
}

function gateCard(feature: Feature, note: string, action: HTMLElement | null): HTMLElement {
  const info = FEATURE_INFO[feature];
  const row = document.createElement('div');
  row.className = 'pro-gate';
  row.dataset.testid = 'pro-gate';
  row.dataset.feature = feature;
  row.dataset.locked = String(action !== null);
  const text = document.createElement('div');
  text.className = 'pro-gate-text';
  const title = document.createElement('div');
  title.className = 'pro-gate-title';
  title.textContent = info.title;
  const blurb = document.createElement('div');
  blurb.className = 'g-caption';
  blurb.textContent = `${info.blurb} ${note}`;
  text.append(title, blurb);
  row.appendChild(text);
  if (action !== null) row.appendChild(action);
  return row;
}
