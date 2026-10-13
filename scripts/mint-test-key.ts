/**
 * Mint a TEST licence key with the throwaway dev key pair (scripts/dev-licence-key.json). Such a key
 * works only in an unpackaged run (`npm start`, e2e); a packaged build refuses the dev kid.
 *
 *   node scripts/mint-test-key.ts                      # Pro, annual, a year from now
 *   node scripts/mint-test-key.ts --plan monthly --days 30 --seats 2
 *   node scripts/mint-test-key.ts --expired-days 3     # paid period ended 3 days ago (in grace)
 *   node scripts/mint-test-key.ts --perpetual
 *   node scripts/mint-test-key.ts --link               # also print the offsuit:// deep link
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { encodeToken } from '../src/core/entitlements/token.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string): boolean => args.includes(`--${name}`);

const dev = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'dev-licence-key.json'), 'utf8')) as {
  kid: string;
  x: string;
  d: string;
};
const key = crypto.createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', x: dev.x, d: dev.d }, format: 'jwk' });

const now = Math.floor(Date.now() / 1000);
const day = 86_400;
const expiredDays = flag('expired-days');
const iat = expiredDays !== undefined ? now - (Number(expiredDays) + 30) * day : now;
const exp = has('perpetual')
  ? null
  : expiredDays !== undefined
    ? now - Number(expiredDays) * day
    : now + Number(flag('days') ?? 365) * day;

const token = encodeToken(
  {
    v: 1,
    kid: dev.kid,
    lid: flag('lid') ?? `lic_test_${crypto.randomBytes(6).toString('base64url')}`,
    tier: flag('tier') ?? 'pro',
    plan: has('perpetual') ? 'perpetual' : (flag('plan') ?? 'annual'),
    iat,
    exp,
    seats: Number(flag('seats') ?? 3),
  },
  (message) => new Uint8Array(crypto.sign(null, message, key)),
);

console.log(token);
if (has('link')) console.log(`offsuit://activate?key=${encodeURIComponent(token)}`);
