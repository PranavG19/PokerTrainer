/**
 * Minting and checking licence tokens on the server, with node:crypto. The token format is the app's
 * own (src/core/entitlements/token.ts), so a token minted here is verified there byte for byte.
 */

import * as crypto from 'node:crypto';
import { base64urlEncode, encodeToken, timeMessage, verifyToken, type LicenceClaims, type VerifyResult } from '../../core/entitlements/token.js';

export interface SigningKey {
  readonly kid: string;
  readonly key: crypto.KeyObject;
}

/** From the JWK the setup script writes (`{ kid, x, d }`): the private key never leaves the server. */
export function signingKeyFromJwk(jwk: { kid: string; x: string; d: string }): SigningKey {
  return {
    kid: jwk.kid,
    key: crypto.createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x, d: jwk.d }, format: 'jwk' }),
  };
}

export function mintToken(signing: SigningKey, claims: Omit<LicenceClaims, 'v' | 'kid'>): string {
  return encodeToken({ v: 1, kid: signing.kid, ...claims }, (message) =>
    new Uint8Array(crypto.sign(null, message, signing.key)),
  );
}

/** The server's clock, signed for one licence: what lets the app correct a mark a fast clock pushed ahead. */
export function signTime(signing: SigningKey, now: number, lid: string): { now: number; kid: string; sig: string } {
  return { now, kid: signing.kid, sig: base64urlEncode(new Uint8Array(crypto.sign(null, timeMessage(now, lid), signing.key))) };
}

/** Verify a token the app sent back (refresh), against every public key the server accepts. */
export function verifyWithKeys(token: string, publicKeys: Readonly<Record<string, string>>): VerifyResult {
  const keys = new Map<string, crypto.KeyObject>();
  for (const [kid, x] of Object.entries(publicKeys)) {
    keys.set(kid, crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' }));
  }
  return verifyToken(token, (kid, message, signature) => {
    const key = keys.get(kid);
    return key !== undefined && crypto.verify(null, message, key, signature);
  });
}

/** A licence id: unguessable, and inside the token's id alphabet. */
export function newLicenceId(): string {
  return `lic_${crypto.randomBytes(12).toString('base64url')}`;
}

/** Emails are kept only as this hash: enough to check a restore request, useless if the store leaks. */
export function emailHash(email: string, pepper: string): string {
  return crypto.createHmac('sha256', pepper).update(email.trim().toLowerCase(), 'utf8').digest('hex');
}
