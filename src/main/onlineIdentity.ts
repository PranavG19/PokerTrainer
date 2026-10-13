/**
 * ONLINE IDENTITY — the device key pair an online server knows this player by. No password, no e-mail.
 *
 * Generated the first time the player goes online (never at install or launch: an offline player has
 * no key at all), kept in its own file next to the profile with owner-only permissions, and read only
 * by main. The renderer never sees the private key; it sees the first 10 characters of the public key,
 * which is how the app shows "this device". Losing the file loses the online identity (account recovery
 * is out of scope), so Settings can export it, private key included, for the player to keep.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { rawPublicKey } from './onlineAuth.js';

export interface Identity {
  /** The raw Ed25519 public key, base64url (43 characters). */
  readonly publicKey: string;
  readonly privateKey: crypto.KeyObject;
  readonly created: string;
}

interface IdentityFile {
  readonly v: 1;
  readonly publicKey: string;
  readonly privateKeyPem: string;
  readonly created: string;
}

/** The stored identity, or null when there is none or it does not hold together. */
export function loadIdentity(file: string): Identity | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as IdentityFile;
    if (parsed?.v !== 1 || typeof parsed.privateKeyPem !== 'string') return null;
    const privateKey = crypto.createPrivateKey(parsed.privateKeyPem);
    const publicKey = rawPublicKey(crypto.createPublicKey(privateKey));
    // The stored public key must be the private key's: a file edited by hand is not trusted half-way.
    if (publicKey !== parsed.publicKey) return null;
    return { publicKey, privateKey, created: parsed.created };
  } catch {
    return null;
  }
}

export function createIdentity(file: string, now: Date = new Date()): Identity {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const identity: Identity = { publicKey: rawPublicKey(publicKey), privateKey, created: now.toISOString().slice(0, 10) };
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(serialise(identity), null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return identity;
}

export function loadOrCreateIdentity(file: string): Identity {
  return loadIdentity(file) ?? createIdentity(file);
}

function serialise(identity: Identity): IdentityFile {
  return {
    v: 1,
    publicKey: identity.publicKey,
    privateKeyPem: identity.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    created: identity.created,
  };
}

/** The exportable identity: everything needed to be this player on another machine. */
export function exportIdentity(identity: Identity): IdentityFile {
  return serialise(identity);
}
