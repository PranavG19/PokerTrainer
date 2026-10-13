/**
 * The public half of licensing: verification keys and the provider's public URLs. Nothing here is a
 * secret, and nothing secret may ever be added here (docs/PAYMENTS-SETUP.md). `scripts/payments-setup.ts`
 * fills PRODUCTION_KEYS and the URLs after the owner creates the merchant account.
 *
 * Key rotation: add the new kid, start signing with it on the server, and keep the old kid until every
 * token it signed has expired (a year past the last annual renewal it signed, plus the grace). Perpetual
 * licences signed by a retired key must be re-issued under the new one before its kid is removed.
 */

/** Production verification keys: kid → Ed25519 public key (the JWK `x`, base64url of the raw 32 bytes). */
export const PRODUCTION_KEYS: Readonly<Record<string, string>> = {
  // Filled by `node scripts/payments-setup.ts`. Empty means no production token verifies yet.
};

/**
 * The throwaway development key. Its PRIVATE half is committed (scripts/dev-licence-key.json) so tests
 * and `scripts/mint-test-key.ts` can mint tokens; that is exactly why a packaged build never accepts it
 * (src/main/licence.ts keyring()).
 */
export const DEV_KEY_ID = 'dev-2026-10';
export const DEV_KEYS: Readonly<Record<string, string>> = {
  [DEV_KEY_ID]: 'tFyl-lNzpI7Y5wpLFSq8L37x_O9RjzKhz51Pw3vWwPw',
};

/** Licence ids refused by every build from this one on (a refunded perpetual licence, a leaked key). */
export const REVOKED_LICENCE_IDS: ReadonlySet<string> = new Set<string>([]);

/**
 * The provider's hosted checkout per plan, opened in the system browser, never in the app. Empty until
 * the owner creates the products; the upgrade sheet then says checkout is not set up yet.
 */
export const CHECKOUT_URLS: Readonly<Record<'monthly' | 'annual', string>> = {
  monthly: '',
  annual: '',
};

/**
 * The price per plan as shown BEFORE checkout ("$6 a month"), so nobody clicks through to find it.
 * Set to what the provider charges; empty shows "Price shown at checkout" instead of a guess.
 */
export const PRICE_LABELS: Readonly<Record<'monthly' | 'annual', string>> = {
  monthly: '',
  annual: '',
};

/** The merchant of record, named on the upgrade sheet (who charges the card and handles tax). */
export const MERCHANT_NAME = 'Stripe';

/** Where a subscriber manages or cancels: the provider's customer portal. Never hidden. */
export const MANAGE_URL = '';

/**
 * The licence server (the online server task hosts it): refresh and restore. Empty = those buttons say
 * the server is not set up yet. Contacted only when the learner presses one of them.
 */
export const LICENCE_SERVER_URL = '';
