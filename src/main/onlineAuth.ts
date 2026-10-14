/**
 * ONLINE SIGN-IN — the Ed25519 half of the online protocol (src/core/online/protocol.ts), shared by the
 * app's client and the server so both compute the signed bytes from one definition.
 *
 * The signature covers the server's fresh nonce AND keying material exported from this TLS session
 * (RFC 8446 §7.5). Both ends derive the same bytes only on the same TLS session, so a man in the middle
 * who terminates TLS separately on each side gets different material and the signature fails, and a
 * signature from one connection proves nothing on another.
 */

import * as crypto from 'node:crypto';
import type * as tls from 'node:tls';
import { authPayload, EKM_LABEL, ONLINE_PROTO } from '../core/online/protocol.js';

/** DER header that turns a raw 32-byte Ed25519 public key into a SubjectPublicKeyInfo. */
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');

export function ed25519PublicKey(raw: Buffer): crypto.KeyObject {
  return crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI, raw]), format: 'der', type: 'spki' });
}

/** The raw 32-byte public key of an Ed25519 key object, base64url: how the server knows a player. */
export function rawPublicKey(key: crypto.KeyObject): string {
  const spki = key.export({ type: 'spki', format: 'der' });
  return spki.subarray(spki.length - 32).toString('base64url');
}

function keyingMaterial(socket: tls.TLSSocket): string {
  return socket.exportKeyingMaterial(32, EKM_LABEL, Buffer.from(ONLINE_PROTO)).toString('hex');
}

/** The client's signature for this connection. */
export function signAuth(socket: tls.TLSSocket, nonce: string, publicKey: string, privateKey: crypto.KeyObject): string {
  return crypto.sign(null, authPayload(nonce, keyingMaterial(socket), publicKey), privateKey).toString('base64url');
}

/** The server's check. Never throws: a malformed key or signature is simply not valid. */
export function verifyAuth(socket: tls.TLSSocket, nonce: string, publicKey: string, signature: string): boolean {
  try {
    const key = ed25519PublicKey(Buffer.from(publicKey, 'base64url'));
    return crypto.verify(null, authPayload(nonce, keyingMaterial(socket), publicKey), key, Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}
