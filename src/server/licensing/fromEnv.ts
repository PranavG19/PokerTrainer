/**
 * Build the licence server from the env `scripts/payments-setup.ts` prints (docs/PAYMENTS-SETUP.md), so the
 * online server hosts it with one call: `createLicenceServer(licenceServerDepsFromEnv(process.env, store))`.
 * Throws, naming the variable, when something required is missing: a server that starts without its
 * signing key or webhook secret would accept nothing and say nothing.
 */

import * as fs from 'node:fs';
import type { LicenceServerDeps } from './handler.js';
import { signingKeyFromJwk } from './mint.js';
import type { LicenceStore } from './store.js';
import { stripeApi } from './stripe.js';

export function licenceServerDepsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  store: LicenceStore,
  opts: { fetchImpl?: typeof fetch; log?: (line: string) => void } = {},
): LicenceServerDeps {
  const need = (name: string): string => {
    const v = env[name];
    if (v === undefined || v.trim() === '') throw new Error(`licence server: ${name} is not set`);
    return v.trim();
  };
  const keyJson =
    env.OFFSUIT_LICENCE_SIGNING_KEY !== undefined && env.OFFSUIT_LICENCE_SIGNING_KEY.trim() !== ''
      ? env.OFFSUIT_LICENCE_SIGNING_KEY
      : fs.readFileSync(need('OFFSUIT_LICENCE_SIGNING_KEY_FILE'), 'utf8');
  const jwk = JSON.parse(keyJson) as { kid: string; x: string; d: string };
  const publicKeys = JSON.parse(need('OFFSUIT_LICENCE_PUBLIC_KEYS')) as Record<string, string>;
  if (publicKeys[jwk.kid] !== jwk.x) throw new Error('licence server: OFFSUIT_LICENCE_PUBLIC_KEYS must include the signing key');
  return {
    store,
    stripe: stripeApi(need('STRIPE_SECRET_KEY'), opts.fetchImpl),
    webhookSecrets: need('STRIPE_WEBHOOK_SECRETS').split(',').map((s) => s.trim()).filter((s) => s !== ''),
    signing: signingKeyFromJwk(jwk),
    publicKeys,
    emailPepper: need('OFFSUIT_LICENCE_EMAIL_PEPPER'),
    nowSeconds: () => Math.floor(Date.now() / 1000),
    log: opts.log,
  };
}
