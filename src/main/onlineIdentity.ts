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

export const IDENTITY_UNREADABLE =
  'Your online identity file could not be read, so Offsuit did not replace it (that would lose this ' +
  'identity for good). Restore it from your export, or move the file away to start a new identity.';

/** The stored identity, or null when there is none or it does not hold together. */
export function loadIdentity(file: string): Identity | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as IdentityFile & { identity?: IdentityFile };
    // The app's export wraps the identity; copied back into place it loads as the same identity.
    const parsed = raw?.identity ?? raw;
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

/** Create a key only when there is no file at all: an unreadable file is refused, never overwritten. */
export function loadOrCreateIdentity(file: string): Identity {
  if (!fs.existsSync(file)) return createIdentity(file);
  const identity = loadIdentity(file);
  if (identity === null) throw new Error(IDENTITY_UNREADABLE);
  return identity;
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
