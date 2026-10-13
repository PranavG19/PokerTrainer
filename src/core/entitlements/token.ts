/**
 * The Pro licence token: a compact, offline-verifiable, Ed25519-signed string.
 *
 *     OFFSUIT1.<base64url(JSON claims)>.<base64url(64-byte Ed25519 signature)>
 *
 * The signature covers the ASCII bytes of `OFFSUIT1.<payload>` (the prefix is in the signed message, so
 * a signature can never be lifted onto a different format). Claims carry the key id (`kid`), so a build
 * can hold several public keys at once and keys can be rotated: a new key signs new tokens while the
 * old one still verifies tokens it already signed, until the build that drops it ships.
 *
 * SELF-CONTAINED ON PURPOSE: no imports, no Node or DOM APIs beyond TextEncoder/btoa/atob, and no
 * crypto. The signature check is injected (`SignatureCheck`), so main verifies with node:crypto, the
 * server and the scripts sign with node:crypto, and `scripts/*.ts` can import this file directly under
 * Node's type stripping (which cannot resolve this repo's `.js`-suffixed imports).
 */

export const TOKEN_PREFIX = 'OFFSUIT1';

/** What a token says. Times are unix seconds (UTC), never local days: a licence is not a streak. */
export interface LicenceClaims {
  /** Claims format; this build reads 1. */
  readonly v: 1;
  /** Key id: which public key signed it. */
  readonly kid: string;
  /** Licence id: stable across renewals of one subscription (the server's row key; revocation lists name it). */
  readonly lid: string;
  /** The tier this token grants. A tier this build does not know verifies but grants nothing. */
  readonly tier: string;
  /** e.g. 'monthly' | 'annual' | 'perpetual'. Display only. */
  readonly plan: string;
  /** Issued at. Also a lower bound on the true time (see trustedNow in clock.ts). */
  readonly iat: number;
  /** Paid through, or null for a perpetual licence. The offline grace runs after it. */
  readonly exp: number | null;
  /** Devices the purchase covers. Offline it is informational; the online server counts activations. */
  readonly seats: number;
}

export type DecodeError = 'malformed' | 'wrong-format' | 'bad-claims';

export interface DecodedToken {
  readonly claims: LicenceClaims;
  /** The exact bytes the signature covers. */
  readonly message: Uint8Array;
  readonly signature: Uint8Array;
}

/** Verify `signature` over `message` with the public key named `kid`; false for an unknown kid. */
export type SignatureCheck = (kid: string, message: Uint8Array, signature: Uint8Array) => boolean;

/** Ed25519 signatures are exactly 64 bytes. */
const SIG_BYTES = 64;
/** A pasted key is short; anything near this is not one (and is not worth decoding). */
export const MAX_TOKEN_CHARS = 2048;
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** People paste keys out of emails: drop whitespace and line breaks anywhere in it. */
export function normalizeToken(raw: string): string {
  return raw.replace(/\s+/g, '');
}

export function encodeToken(claims: LicenceClaims, sign: (message: Uint8Array) => Uint8Array): string {
  const payload = base64urlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const message = new TextEncoder().encode(`${TOKEN_PREFIX}.${payload}`);
  return `${TOKEN_PREFIX}.${payload}.${base64urlEncode(sign(message))}`;
}

/** Parse without trusting: the result says what the token CLAIMS. Call verifyToken before believing it. */
export function decodeToken(raw: string): DecodedToken | { error: DecodeError } {
  const token = normalizeToken(raw);
  if (token.length === 0 || token.length > MAX_TOKEN_CHARS) return { error: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 3) return { error: 'malformed' };
  const [prefix, payload, sig] = parts;
  if (prefix !== TOKEN_PREFIX) return { error: 'wrong-format' };
  const payloadBytes = base64urlDecode(payload);
  const signature = base64urlDecode(sig);
  if (payloadBytes === null || signature === null || signature.length !== SIG_BYTES) return { error: 'malformed' };
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes));
  } catch {
    return { error: 'malformed' };
  }
  const claims = parseClaims(json);
  if (claims === null) return { error: 'bad-claims' };
  return { claims, message: new TextEncoder().encode(`${prefix}.${payload}`), signature };
}

export type VerifyResult =
  | { readonly ok: true; readonly claims: LicenceClaims }
  | { readonly ok: false; readonly reason: DecodeError | 'bad-signature' | 'revoked' };

/**
 * Decode, then check the signature with the key the token names. The verifier decides which kids it
 * accepts (a packaged build never accepts the dev key), and `revoked` lists licence ids a build refuses
 * (a refunded perpetual licence cannot otherwise be taken back offline).
 */
export function verifyToken(raw: string, check: SignatureCheck, revoked: ReadonlySet<string> = new Set()): VerifyResult {
  const decoded = decodeToken(raw);
  if ('error' in decoded) return { ok: false, reason: decoded.error };
  let valid = false;
  try {
    valid = check(decoded.claims.kid, decoded.message, decoded.signature);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad-signature' };
  if (revoked.has(decoded.claims.lid)) return { ok: false, reason: 'revoked' };
  return { ok: true, claims: decoded.claims };
}

/** Strict: a signed token is our own output, so anything off-shape is refused rather than repaired. */
function parseClaims(json: unknown): LicenceClaims | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (!isId(o.kid) || !isId(o.lid) || !isId(o.tier) || !isId(o.plan)) return null;
  if (!isTime(o.iat)) return null;
  if (o.exp !== null && !isTime(o.exp)) return null;
  if (o.exp !== null && (o.exp as number) <= (o.iat as number)) return null;
  if (typeof o.seats !== 'number' || !Number.isInteger(o.seats) || o.seats < 1 || o.seats > 1000) return null;
  return {
    v: 1,
    kid: o.kid as string,
    lid: o.lid as string,
    tier: o.tier as string,
    plan: o.plan as string,
    iat: o.iat as number,
    exp: o.exp as number | null,
    seats: o.seats,
  };
}

function isId(v: unknown): v is string {
  return typeof v === 'string' && ID_RE.test(v);
}

/** Unix seconds between 2020 and 2200: anything else is not a time we issued. */
function isTime(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1_577_836_800 && v <= 7_258_118_400;
}

export function base64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Null for anything that is not canonical unpadded base64url (so one token has exactly one spelling). */
export function base64urlDecode(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  let bin: string;
  try {
    bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
  } catch {
    return null;
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return base64urlEncode(out) === text ? out : null;
}
