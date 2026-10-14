/**
 * ONLINE PROTOCOL — the wire between the app and an Offsuit online server (server/).
 *
 * The same framing as LAN relay v2 (one JSON object per line inside TLS 1.3) and, once a player sits at
 * a table, the same in-room messages: `state` views built by viewFor, the commit-before-reveal deal
 * (dealCommit.ts) and `action`/`leave`. What is new is everything before and around the table:
 *
 *   1. hello      client → server   { proto, v, key }        the device's Ed25519 public key
 *   2. challenge  server → client   { nonce }                 32 random bytes, fresh per connection
 *   3. auth       client → server   { sig }                   Ed25519 over authPayload(), which binds the
 *                                                             nonce AND this TLS session's exported keying
 *                                                             material, so a signature cannot be replayed on
 *                                                             another connection or relayed by a middleman
 *   4. welcome    server → client   who the server knows this key as, and the room it is held in, if any
 *
 * After the welcome, a request carries an `id` and gets one `reply` with the same id; table events are
 * pushed. Nothing a client sends is trusted: every frame is parsed by parseOnlineFrame, which checks the
 * type, every field's type and range, and the frame's size, and returns null for anything else.
 *
 * Pure: no socket, no crypto. Both the server and the app import it.
 */

import type { Action, ActionKind } from '../table.js';
import type { ClientMessage } from '../multiplayer.js';

export const ONLINE_PROTO = 'offsuit-online';
export const ONLINE_VERSION = 1;

/** The largest frame a client may send. Every client frame is a few hundred bytes at most. */
export const MAX_CLIENT_FRAME = 4 * 1024;
/**
 * The largest frame a server may send. Views and ladders are a few kilobytes; a data export (everything
 * the server holds about one player) is the one large reply, and the client chose and pinned this server.
 */
export const MAX_SERVER_FRAME = 1024 * 1024;
/** A client sends a ping this often while connected; the server drops a connection silent for 3 × this. */
export const PING_MS = 20_000;

/** Preset emotes: the only words players can send each other. No free text exists on this wire. */
export const EMOTES = {
  hello: 'Hello',
  gg: 'Good game',
  'nice-hand': 'Nice hand',
  'well-played': 'Well played',
  thinking: 'Thinking…',
  unlucky: 'Unlucky',
  thanks: 'Thanks',
  oops: 'Oops',
} as const;
export type EmoteId = keyof typeof EMOTES;
export const EMOTE_IDS = Object.keys(EMOTES) as EmoteId[];

const ACTION_KINDS: readonly ActionKind[] = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];
const B64URL = /^[A-Za-z0-9_-]+$/;
const HEX = /^[0-9a-f]+$/;

/** Room and league codes: 10 Crockford base-32 characters (50 bits), shown as XXXXX-XXXXX. */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 10;

/** Normalise a typed code (case, dashes, spaces, the look-alikes I/L/O) or null when it cannot be one. */
export function normaliseCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 32) return null;
  const folded = raw
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (folded.length !== CODE_LENGTH) return null;
  for (const ch of folded) if (!CODE_ALPHABET.includes(ch)) return null;
  return folded;
}

export function formatCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/**
 * The bytes a client signs to prove it holds its key on THIS connection. `ekm` is the TLS session's
 * exported keying material (RFC 8446 §7.5, label EKM_LABEL), which differs per TLS session, so a
 * signature captured or relayed from one connection is worthless on any other.
 */
export const EKM_LABEL = 'EXPORTER-offsuit-online-auth';
export function authPayload(nonceHex: string, ekmHex: string, keyB64: string): Uint8Array {
  return new TextEncoder().encode(`${ONLINE_PROTO}/auth/v${ONLINE_VERSION}\n${nonceHex}\n${ekmHex}\n${keyB64}`);
}

// ── Client → server frames ──────────────────────────────────────────────────

export interface HelloFrame { readonly type: 'hello'; readonly proto: string; readonly v: number; readonly key: string }
export interface AuthFrame { readonly type: 'auth'; readonly sig: string }

/** Requests: each carries an id the reply repeats. */
export type OnlineRequest =
  | { readonly type: 'profile'; readonly id: number; readonly name: string; readonly adult: true }
  | { readonly type: 'room-create'; readonly id: number; readonly seats: number; readonly ranked: boolean }
  | { readonly type: 'room-join'; readonly id: number; readonly code: string }
  | { readonly type: 'room-leave'; readonly id: number }
  | { readonly type: 'kick'; readonly id: number; readonly seat: number }
  | { readonly type: 'ladder'; readonly id: number }
  | { readonly type: 'season'; readonly id: number }
  | { readonly type: 'league-create'; readonly id: number; readonly name: string }
  | { readonly type: 'league-join'; readonly id: number; readonly code: string }
  | { readonly type: 'league-leave'; readonly id: number; readonly code: string }
  | { readonly type: 'league-board'; readonly id: number; readonly code: string }
  | { readonly type: 'leagues'; readonly id: number }
  /** Everything the server holds about this key, in pages (`page` from 0) so each reply fits a frame. */
  | { readonly type: 'export'; readonly id: number; readonly page: number }
  | { readonly type: 'forget'; readonly id: number };

export type OnlineRequestType = OnlineRequest['type'];

/** In-room frames, no id: the LAN relay's messages plus a preset emote. */
export type RoomFrame = ClientMessage | { readonly type: 'emote'; readonly emote: EmoteId };

export interface PingFrame { readonly type: 'ping' }

export type OnlineClientFrame = HelloFrame | AuthFrame | OnlineRequest | RoomFrame | PingFrame;

// ── Server → client frames ──────────────────────────────────────────────────

export interface RoomInfo {
  readonly code: string;
  readonly ranked: boolean;
  readonly seats: number;
  /** True for the player who created the room: they alone may remove a seat, between hands. */
  readonly creator: boolean;
}

export interface WelcomeFrame {
  readonly type: 'welcome';
  readonly proto: string;
  readonly v: number;
  /** The first 10 characters of the key, how the app shows "this device" to its owner. */
  readonly keyId: string;
  /** Null until the player has chosen a name and confirmed they are 18 or over. */
  readonly name: string | null;
  readonly season: string;
  /** The room this key is still seated in after a dropped connection, if any. */
  readonly room: RoomInfo | null;
}

export type OnlineServerFrame =
  | { readonly type: 'challenge'; readonly nonce: string }
  | WelcomeFrame
  | { readonly type: 'reply'; readonly id: number; readonly ok: true; readonly data: unknown }
  | { readonly type: 'reply'; readonly id: number; readonly ok: false; readonly error: string }
  | { readonly type: 'room'; readonly room: RoomInfo | null }
  | { readonly type: 'clock'; readonly seat: number; readonly ms: number }
  | { readonly type: 'emote'; readonly seat: number; readonly emote: EmoteId }
  | { readonly type: 'removed'; readonly reason: string }
  | { readonly type: 'bye'; readonly reason: string };

// ── Parsing (the server's first line of defence) ──────────────────────────────

function record(line: string): Record<string, unknown> | null {
  if (line.length > MAX_CLIENT_FRAME) return null;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  // No frame has more than six fields; a frame stuffed with keys is not one of ours.
  if (Object.keys(r).length > 6 || typeof r.type !== 'string') return null;
  return r;
}

const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 2 ** 31;
const isB64 = (v: unknown, chars: number): v is string => typeof v === 'string' && v.length === chars && B64URL.test(v);
const isHexN = (v: unknown, chars: number): v is string => typeof v === 'string' && v.length === chars && HEX.test(v);
const isShortText = (v: unknown): v is string => typeof v === 'string' && v.length <= 64;

/** The first frame on a connection: a hello, or null. Version and key are judged by the caller. */
export function parseHello(line: string): HelloFrame | null {
  const r = record(line);
  if (r === null || r.type !== 'hello') return null;
  if (typeof r.proto !== 'string' || r.proto.length > 32 || !Number.isInteger(r.v)) return null;
  // An Ed25519 public key: 32 bytes, base64url without padding.
  if (!isB64(r.key, 43)) return null;
  return { type: 'hello', proto: r.proto, v: r.v as number, key: r.key };
}

/** The second frame: the signature, 64 bytes base64url (86 characters). */
export function parseAuth(line: string): AuthFrame | null {
  const r = record(line);
  if (r === null || r.type !== 'auth' || !isB64(r.sig, 86)) return null;
  return { type: 'auth', sig: r.sig };
}

function parseAction(v: unknown): Action | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const a = v as Record<string, unknown>;
  if (Object.keys(a).length > 2 || !ACTION_KINDS.includes(a.kind as ActionKind)) return null;
  if (a.amount === undefined) return { kind: a.kind as ActionKind };
  // Chip amounts are whole and bounded; the engine still checks the amount is legal for the spot.
  if (!Number.isInteger(a.amount) || (a.amount as number) < 0 || (a.amount as number) > 1e9) return null;
  return { kind: a.kind as ActionKind, amount: a.amount as number };
}

/** Any frame after the welcome, or null. Shapes only: the server judges whether it is allowed now. */
export function parseOnlineFrame(line: string): OnlineRequest | RoomFrame | PingFrame | null {
  const r = record(line);
  if (r === null) return null;
  switch (r.type) {
    case 'ping':
      return { type: 'ping' };
    case 'action': {
      const action = parseAction(r.action);
      return action === null ? null : { type: 'action', action };
    }
    case 'leave':
      return { type: 'leave' };
    case 'deal':
      return { type: 'deal' };
    case 'entropy-commit':
      if (!Number.isInteger(r.hand) || !isHexN(r.nonce, 32) || !isHexN(r.commitment, 64)) return null;
      return { type: 'entropy-commit', hand: r.hand as number, nonce: r.nonce, commitment: r.commitment };
    case 'entropy-reveal':
      if (!Number.isInteger(r.hand) || !isHexN(r.nonce, 32) || !isHexN(r.entropy, 64)) return null;
      return { type: 'entropy-reveal', hand: r.hand as number, nonce: r.nonce, entropy: r.entropy };
    case 'emote':
      return EMOTE_IDS.includes(r.emote as EmoteId) ? { type: 'emote', emote: r.emote as EmoteId } : null;
  }
  if (!isId(r.id)) return null;
  const id = r.id;
  switch (r.type) {
    case 'profile':
      // The attestation must be the literal `true`: a missing or truthy-but-not-true value is not consent.
      return isShortText(r.name) && r.adult === true ? { type: 'profile', id, name: r.name, adult: true } : null;
    case 'room-create':
      if (!Number.isInteger(r.seats) || (r.seats as number) < 2 || (r.seats as number) > 6 || typeof r.ranked !== 'boolean') return null;
      return { type: 'room-create', id, seats: r.seats as number, ranked: r.ranked };
    case 'kick':
      return Number.isInteger(r.seat) && (r.seat as number) >= 0 && (r.seat as number) < 6 ? { type: 'kick', id, seat: r.seat as number } : null;
    case 'league-create':
      return isShortText(r.name) ? { type: 'league-create', id, name: r.name } : null;
    case 'room-join':
    case 'league-join':
    case 'league-leave':
    case 'league-board': {
      const code = normaliseCode(r.code);
      return code === null ? null : { type: r.type, id, code };
    }
    case 'export': {
      const page = r.page ?? 0;
      return Number.isInteger(page) && (page as number) >= 0 && (page as number) <= 10_000 ? { type: 'export', id, page: page as number } : null;
    }
    case 'room-leave':
    case 'ladder':
    case 'season':
    case 'leagues':
    case 'forget':
      return { type: r.type, id };
  }
  return null;
}
