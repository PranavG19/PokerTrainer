/**
 * SELF-SIGNED CERTIFICATE — one fresh P-256 key and X.509 certificate per hosted table.
 *
 * WHY HAND-ROLLED. node:crypto can make a key and sign bytes but cannot issue a certificate, and the app
 * adds no dependencies. A certificate is only ~400 bytes of DER around the public key, so it is built
 * here: a TBSCertificate (v3, random serial, CN "Offsuit table", 30-day validity, the key's SPKI) signed
 * with ECDSA-SHA256.
 *
 * WHY SELF-SIGNED IS ENOUGH. Nobody validates this certificate against a CA. The guest pins its SHA-256
 * fingerprint, which arrives in the invite link alongside the room token (research TECH-MULTIPLAYER
 * §3.2, review R7), and the TLS handshake proves the host holds the matching private key. A fresh key per
 * table means an old invite link pins a key that no longer exists.
 */

import * as crypto from 'node:crypto';

function der(tag: number, body: Buffer): Buffer {
  const len = body.length;
  let header: Buffer;
  if (len < 0x80) header = Buffer.from([tag, len]);
  else if (len < 0x100) header = Buffer.from([tag, 0x81, len]);
  else header = Buffer.from([tag, 0x82, len >> 8, len & 0xff]);
  return Buffer.concat([header, body]);
}

const seq = (...parts: Buffer[]): Buffer => der(0x30, Buffer.concat(parts));

/** An OID's DER body from its dotted form. */
function oid(dotted: string): Buffer {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const bytes = [40 * a + b];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = n >>> 7; v > 0; v >>>= 7) chunk.unshift((v & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return der(0x06, Buffer.from(bytes));
}

function utcTime(date: Date): Buffer {
  const p = (n: number): string => String(n).padStart(2, '0');
  const text =
    p(date.getUTCFullYear() % 100) + p(date.getUTCMonth() + 1) + p(date.getUTCDate()) +
    p(date.getUTCHours()) + p(date.getUTCMinutes()) + p(date.getUTCSeconds()) + 'Z';
  return der(0x17, Buffer.from(text, 'ascii'));
}

const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'));
const NAME = seq(der(0x31, seq(oid('2.5.4.3'), der(0x0c, Buffer.from('Offsuit table', 'utf8')))));

export interface TableCertificate {
  readonly keyPem: string;
  readonly certPem: string;
  /** SHA-256 of the certificate DER, base64url: what the invite link carries and the guest pins. */
  readonly fingerprint: string;
}

/** SHA-256 over a certificate's DER, base64url — the form both sides compare. */
export function certFingerprint(certDer: Buffer): string {
  return crypto.createHash('sha256').update(certDer).digest('base64url');
}

export function createTableCertificate(now: Date = new Date()): TableCertificate {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const serial = crypto.randomBytes(16);
  serial[0] = (serial[0] & 0x7f) | 0x40; // positive and minimal: no sign bit, no leading zero
  const notBefore = new Date(now.getTime() - 24 * 3600 * 1000);
  const notAfter = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))), // [0] EXPLICIT version v3
    der(0x02, serial),
    ECDSA_SHA256,
    NAME,
    seq(utcTime(notBefore), utcTime(notAfter)),
    NAME,
    spki,
  );
  const signature = crypto.sign('sha256', tbs, privateKey); // DER-encoded ECDSA signature
  const certDer = seq(tbs, ECDSA_SHA256, der(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const b64 = certDer.toString('base64').replace(/(.{64})/g, '$1\n');
  return {
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    certPem: `-----BEGIN CERTIFICATE-----\n${b64.trimEnd()}\n-----END CERTIFICATE-----\n`,
    fingerprint: certFingerprint(certDer),
  };
}
