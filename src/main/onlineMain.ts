/**
 * ONLINE PLAY IN MAIN — the opt-in, the one live OnlineSession, and what the renderer may ask of it.
 * Electron-free (main.ts injects the settings store, the identity file and the push channel), so the
 * gate's logic is unit-testable.
 *
 * THE GATE IS STRUCTURAL, AS FOR LAN MULTIPLAYER. With online play off, or no server set, or no 18+
 * confirmation, there is no OnlineSession and so no socket: connect() refuses before any network call,
 * and turning the switch off closes the session. Setting a server address only stores text; nothing is
 * looked up or contacted until the player presses Go online. The main-process network oracle
 * (no-network.spec) observes this from outside.
 */

import { parsePin, parseServerAddress } from '../core/online/address.js';
import { normaliseName } from '../core/online/names.js';
import { EMOTE_IDS, type EmoteId, type OnlineRequestType, type RoomInfo, type WelcomeFrame } from '../core/online/protocol.js';
import type { Action } from '../core/table.js';
import { OnlineSession, type OnlineEvent, type OnlineStatus, type OnlineTarget } from './onlineClient.js';
import { exportIdentity, loadIdentity, loadOrCreateIdentity } from './onlineIdentity.js';

export interface OnlineSettingsLike {
  readonly enabled: boolean;
  readonly server: string;
  readonly pin: string;
  readonly name: string;
  readonly adultOn: string;
}

export interface OnlineDeps {
  readonly load: () => OnlineSettingsLike;
  readonly save: (patch: Partial<OnlineSettingsLike>) => OnlineSettingsLike;
  readonly identityFile: string;
  readonly push: (event: OnlineEvent) => void;
  readonly today?: () => string;
  /** Tests: a private CA for the CA-validated path. */
  readonly ca?: string;
  /** Whether this install may play ranked: main passes `authority.can('ranked-play')` (licence.ts). */
  readonly canRanked: () => boolean;
}

/** What the renderer may ask the server for. Anything else is refused here, before the wire. */
const RENDERER_REQUESTS: readonly OnlineRequestType[] = [
  'room-create', 'room-join', 'room-leave', 'kick', 'ladder', 'season',
  'league-create', 'league-join', 'league-leave', 'league-board', 'leagues', 'export', 'forget',
];

export const RANKED_IS_PRO = 'Ranked play is part of Offsuit Pro.';

export interface OnlineStatusView extends OnlineSettingsLike {
  readonly status: OnlineStatus;
  /** The first 10 characters of this device's public key, or null before it has one. */
  readonly keyId: string | null;
  readonly room: RoomInfo | null;
  readonly season: string | null;
  readonly rankedEntitled: boolean;
}

type Result<T = unknown> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };

export class OnlineController {
  private session: OnlineSession | null = null;
  private status: OnlineStatus = 'offline';
  private welcome: WelcomeFrame | null = null;

  constructor(private readonly deps: OnlineDeps) {}

  view(): OnlineStatusView {
    const settings = this.deps.load();
    return {
      ...settings,
      status: this.status,
      keyId: loadIdentity(this.deps.identityFile)?.publicKey.slice(0, 10) ?? null,
      room: this.session?.currentRoom() ?? null,
      season: this.welcome?.season ?? null,
      rankedEntitled: this.deps.canRanked(),
    };
  }

  /** Store the opt-in, server and pin. Turning online play off, or changing the server, disconnects. */
  configure(patch: { enabled?: unknown; server?: unknown; pin?: unknown }): Result<OnlineStatusView> {
    const next: { -readonly [K in keyof OnlineSettingsLike]?: OnlineSettingsLike[K] } = {};
    if (patch.enabled !== undefined) next.enabled = patch.enabled === true;
    if (patch.server !== undefined) {
      if (patch.server === '') next.server = '';
      else {
        const address = parseServerAddress(patch.server);
        if ('error' in address) return { ok: false, error: address.error };
        next.server = String(patch.server).trim();
      }
    }
    if (patch.pin !== undefined) {
      const pin = parsePin(patch.pin);
      if ('error' in pin) return { ok: false, error: pin.error };
      next.pin = pin.pin ?? '';
    }
    const before = this.deps.load();
    const after = this.deps.save(next);
    if (!after.enabled || after.server !== before.server || after.pin !== before.pin) this.disconnect();
    return { ok: true, data: this.view() };
  }

  /**
   * Go online: the one place a socket is opened. Requires the opt-in, a server, a valid name and the
   * 18+ confirmation, checked here whatever the renderer showed.
   */
  async connect(request: { name?: unknown; adult?: unknown }): Promise<Result<OnlineStatusView>> {
    const settings = this.deps.load();
    if (!settings.enabled) return { ok: false, error: 'Online play is off.' };
    const address = parseServerAddress(settings.server);
    if ('error' in address) return { ok: false, error: 'Set a server address first.' };
    const pin = parsePin(settings.pin);
    if ('error' in pin) return { ok: false, error: pin.error };
    if (request.adult !== true) return { ok: false, error: 'Online play is for people 18 or over.' };
    const named = normaliseName(request.name);
    if ('error' in named) return { ok: false, error: named.error };
    this.deps.save({ name: named.name, adultOn: settings.adultOn || (this.deps.today ?? isoToday)() });
    this.disconnect();
    const target: OnlineTarget = { ...address, pin: pin.pin, ...(this.deps.ca !== undefined ? { ca: this.deps.ca } : {}) };
    // The device key is made here, on first use, and never before.
    let identity;
    try {
      identity = loadOrCreateIdentity(this.deps.identityFile);
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
    const session = new OnlineSession(target, identity, (event) => this.onEvent(session, event));
    this.session = session;
    try {
      this.welcome = await session.connect();
      await session.request('profile', { name: named.name, adult: true });
      return { ok: true, data: this.view() };
    } catch (error) {
      if (this.session === session) this.disconnect();
      return { ok: false, error: (error as Error).message };
    }
  }

  private onEvent(session: OnlineSession, event: OnlineEvent): void {
    if (session !== this.session) return;
    if (event.type === 'status') this.status = event.status;
    if (event.type === 'status' && event.status === 'offline') this.session = null;
    if (event.type === 'welcome') this.welcome = event.welcome;
    this.deps.push(event);
  }

  async request(op: unknown, fields: unknown): Promise<Result> {
    if (!RENDERER_REQUESTS.includes(op as OnlineRequestType)) return { ok: false, error: 'Not a request this app makes.' };
    const session = this.session;
    if (session === null || !session.isOnline()) return { ok: false, error: 'Not connected to the server.' };
    const body = typeof fields === 'object' && fields !== null ? { ...(fields as Record<string, unknown>) } : {};
    delete body.type;
    delete body.id;
    // Ranked tables are a Pro feature, decided by main's licence authority on every request.
    if (op === 'room-create' && body.ranked === true && !this.deps.canRanked()) return { ok: false, error: RANKED_IS_PRO };
    try {
      if (op === 'export') return { ok: true, data: await exportAll(session) };
      const data = await session.request(op as OnlineRequestType, body as never);
      if (op === 'forget') this.disconnect();
      // A code does not say whether its table is ranked until the server seats you: leave at once.
      if (op === 'room-join' && (data as RoomInfo | null)?.ranked === true && !this.deps.canRanked()) {
        await session.request('room-leave', {}).catch(() => undefined);
        return { ok: false, error: RANKED_IS_PRO };
      }
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  action(action: unknown): void {
    const a = action as Action;
    if (typeof a?.kind !== 'string') return;
    this.session?.action({ kind: a.kind, ...(Number.isInteger(a.amount) ? { amount: a.amount } : {}) });
  }

  emote(emote: unknown): void {
    if (EMOTE_IDS.includes(emote as EmoteId)) this.session?.emote(emote as EmoteId);
  }

  leave(): void {
    this.session?.leave();
  }

  disconnect(): void {
    const session = this.session;
    this.session = null;
    this.welcome = null;
    this.status = 'offline';
    session?.close();
  }

  /** The device identity, private key included, for the player to keep. Null before there is one. */
  exportIdentity(): string | null {
    const identity = loadIdentity(this.deps.identityFile);
    if (identity === null) return null;
    const settings = this.deps.load();
    return JSON.stringify(
      {
        what: 'Offsuit online identity. Keep it private: anyone with this file can play as you.',
        identity: exportIdentity(identity),
        server: settings.server,
        name: settings.name,
        adultOn: settings.adultOn,
      },
      null,
      2,
    );
  }
}

/** Fetch every page of a server data export and join them into one document for the player. */
async function exportAll(session: OnlineSession): Promise<unknown> {
  type Page = { pages: number; decisions: unknown[]; hands: unknown[] } & Record<string, unknown>;
  const first = (await session.request('export', { page: 0 })) as Page;
  const decisions = [...first.decisions];
  const hands = [...first.hands];
  for (let page = 1; page < Math.min(first.pages, 10_000); page += 1) {
    const next = (await session.request('export', { page })) as Page;
    decisions.push(...next.decisions);
    hands.push(...next.hands);
  }
  const { page: _page, pages: _pages, ...summary } = first;
  return { ...summary, decisions, hands };
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
