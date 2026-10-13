/**
 * THE OWNER'S ONE SETUP COMMAND, run once after creating the Stripe account (docs/PAYMENTS-SETUP.md):
 *
 *   node scripts/payments-setup.ts
 *
 * 1. Generates the PRODUCTION Ed25519 key pair. The private key is written OUTSIDE the repo
 *    (~/.offsuit-licensing/<kid>.json, mode 600) and is never printed; it goes to the licence server only.
 * 2. Embeds the public key in src/core/entitlements/config.ts (PRODUCTION_KEYS), so builds verify it.
 * 3. Prints the env vars the licence server needs.
 *
 * Optional, to fill the app's public URLs in the same run (all can be edited in config.ts later):
 *   --checkout-monthly <https url> --checkout-annual <https url> --manage <https url> --server <https url>
 *   --price-monthly '$6 a month' --price-annual '$48 a year'   (single quotes: the shell expands $6 in double)
 * Rotation: run it again with --kid <new id>; the old kid stays in PRODUCTION_KEYS (config.ts explains when to drop it).
 * Testing the script itself: --dir <key dir> --config <config.ts path>.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const today = new Date().toISOString().slice(0, 7);
const kid = flag('kid') ?? `prod-${today}`;
if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(kid)) throw new Error(`bad kid ${kid}`);
const keyDir = flag('dir') ?? path.join(os.homedir(), '.offsuit-licensing');
const configPath = flag('config') ?? path.join(import.meta.dirname, '..', 'src', 'core', 'entitlements', 'config.ts');
const keyFile = path.join(keyDir, `${kid}.json`);

const httpsOnly = (name: string): string | undefined => {
  const v = flag(name);
  if (v !== undefined && !v.startsWith('https://')) throw new Error(`--${name} must be an https URL`);
  return v;
};
// Every flag is checked before anything is generated or written, so a typo leaves no half-done setup.
const urls = {
  checkoutMonthly: httpsOnly('checkout-monthly'),
  checkoutAnnual: httpsOnly('checkout-annual'),
  manage: httpsOnly('manage'),
  server: httpsOnly('server'),
};
for (const name of ['price-monthly', 'price-annual']) {
  const v = flag(name);
  if (v !== undefined && /['\\\n]/.test(v)) throw new Error(`--${name}: quotes, backslashes and newlines are not allowed`);
}

if (fs.existsSync(keyFile)) {
  console.error(`${keyFile} already exists. Nothing was changed. Use --kid <new id> to rotate.`);
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const x = publicKey.export({ format: 'jwk' }).x as string;
const d = privateKey.export({ format: 'jwk' }).d as string;
fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
fs.writeFileSync(keyFile, JSON.stringify({ kid, x, d }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });

let config = fs.readFileSync(configPath, 'utf8');
const keysStart = config.indexOf('export const PRODUCTION_KEYS');
const keysEnd = config.indexOf('};', keysStart);
if (keysStart < 0 || keysEnd < 0) throw new Error('PRODUCTION_KEYS not found in config.ts');
config = `${config.slice(0, keysEnd)}  '${kid}': '${x}',\n${config.slice(keysEnd)}`;

const setString = (name: string, value: string | undefined, key?: string): void => {
  if (value === undefined) return;
  if (/['\\\n]/.test(value)) throw new Error(`--${name}: quotes, backslashes and newlines are not allowed`);
  if (key === undefined) {
    // Replacer functions, not replacement strings: a price like "$10 a month" would read "$1" as a group.
    config = config.replace(new RegExp(`(export const ${name} = )'[^']*';`), (_m, head: string) => `${head}'${value}';`);
  } else {
    const start = config.indexOf(`export const ${name}`);
    const end = config.indexOf('};', start);
    const block = config.slice(start, end).replace(new RegExp(`(\\n\\s*${key}: )'[^']*'`), (_m, head: string) => `${head}'${value}'`);
    config = config.slice(0, start) + block + config.slice(end);
  }
};
setString('CHECKOUT_URLS', urls.checkoutMonthly, 'monthly');
setString('CHECKOUT_URLS', urls.checkoutAnnual, 'annual');
setString('PRICE_LABELS', flag('price-monthly'), 'monthly');
setString('PRICE_LABELS', flag('price-annual'), 'annual');
setString('MANAGE_URL', urls.manage);
setString('LICENCE_SERVER_URL', urls.server);
fs.writeFileSync(configPath, config);

const pepper = crypto.randomBytes(32).toString('base64url');
console.log(`Production licence key ${kid} created.

  Private key: ${keyFile}   (mode 600; never commit it, back it up somewhere offline)
  Public key:  ${x}
  Embedded in: ${path.relative(process.cwd(), configPath)} (PRODUCTION_KEYS). Commit that file.

Licence server environment (docs/PAYMENTS-SETUP.md):
  OFFSUIT_LICENCE_SIGNING_KEY_FILE=${keyFile}      # or the file's JSON in OFFSUIT_LICENCE_SIGNING_KEY
  OFFSUIT_LICENCE_PUBLIC_KEYS='{"${kid}":"${x}"}'  # add retired kids here too
  OFFSUIT_LICENCE_EMAIL_PEPPER=${pepper}
  STRIPE_SECRET_KEY=rk_live_…                      # a RESTRICTED key: read Subscriptions, Charges, Invoices
  STRIPE_WEBHOOK_SECRETS=whsec_…                   # comma-separated while rolling a secret
`);
