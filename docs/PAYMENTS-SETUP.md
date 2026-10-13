# Payments setup (owner)

Offsuit Pro is sold through **Stripe Managed Payments** (Stripe is the merchant of record: it charges the card,
handles VAT and sales tax, and handles refunds). The app verifies Pro offline with an Ed25519-signed key that our
licence server mints from Stripe's webhooks. The reasons are in [research/TECH-PAYMENTS.md](../research/TECH-PAYMENTS.md)
and DECISIONS.md, "Pro and licensing".

Nothing here needs a secret in the repo. The only secrets are the signing key, the Stripe keys and the email
pepper, and all of them live on the licence server.

## 1. Create the Stripe side (in Stripe's dashboard)

1. Create the Stripe account and turn on **Managed Payments**.
   - Business description: use the exact paragraph in research/TECH-PAYMENTS.md ("Offsuit is educational desktop
     software…"). Keep the website, EULA and store text identical to it.
   - Product tax code: `txcd_10202001`.
2. Create one product, "Offsuit Pro", with two recurring prices: monthly and annual.
3. Create a **Payment Link** or Checkout for each price.
   - Success URL: `https://<licence server>/v1/licence/claim?session_id={CHECKOUT_SESSION_ID}`.
4. Turn on the **customer portal** (cancel, update card, invoices). Its login link is the "Manage or cancel" URL.
5. Add a **webhook endpoint** at `https://<licence server>/webhooks/stripe` with these events:
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`,
   `charge.dispute.closed`. (A partial refund keeps Pro; a full refund or a lost dispute ends it for the period
   it covered. Revoking does not stop billing: cancel the subscription in Stripe when you refund in full.) Copy its signing secret (`whsec_…`).
6. Create a **restricted API key** with read access to Subscriptions, Charges, Invoices and Customers (`rk_live_…`).

## 2. Run the one command

```sh
node scripts/payments-setup.ts \
  --checkout-monthly https://buy.stripe.com/… --checkout-annual https://buy.stripe.com/… \
  --manage https://billing.stripe.com/p/login/… --server https://<licence server> \
  --price-monthly '$6 a month' --price-annual '$48 a year'
```

Every flag is optional: run it bare to make only the key, then fill the URLs later in
`src/core/entitlements/config.ts`. The command does four things:

- Generates the **production key pair**. The private key goes to `~/.offsuit-licensing/<kid>.json` with mode 600.
  It is never printed and never in the repo. Back it up offline: losing it means re-issuing every key.
- Writes the **public key** into `PRODUCTION_KEYS` in `src/core/entitlements/config.ts`, plus any URLs and prices
  you passed. Commit that file. A build verifies only the keys it embeds.
- Prints the **licence server env**:

  | Variable | Value |
  |---|---|
  | `OFFSUIT_LICENCE_SIGNING_KEY_FILE` | the private key file (or its JSON in `OFFSUIT_LICENCE_SIGNING_KEY`) |
  | `OFFSUIT_LICENCE_PUBLIC_KEYS` | `{"<kid>":"<x>"}`, plus any retired kids |
  | `OFFSUIT_LICENCE_EMAIL_PEPPER` | a random secret it generated |
  | `STRIPE_SECRET_KEY` | the restricted key from step 1.6 |
  | `STRIPE_WEBHOOK_SECRETS` | `whsec_…`, comma-separated while rolling a secret |

- Refuses to overwrite an existing key. To rotate, run it with `--kid <new id>`.

## 3. Host the licence server

The online server task mounts `createLicenceServer` from `src/server/licensing/handler.ts`, with the
`nodeListener` adapter or its own framework. It must give the handler the raw request body. It needs:

- a `LicenceStore` backed by its database (`MemoryLicenceStore` is the reference implementation)
- `stripeApi(STRIPE_SECRET_KEY)`
- `signingKeyFromJwk(<key file JSON>)`
- TLS, plus rate limiting on `/v1/*`
- if it runs more than one instance: a store whose writes per subscription are serialised (a row lock or
  compare-and-set). The handler serialises events per subscription inside one process only.

To email keys, use the optional `onIssued` hook. Without it, the buyer gets the key on the checkout success page,
which also offers an `offsuit://` link, and can restore it with the order number and email.

## 4. Before selling

- [ ] Stripe's review has accepted the business description.
- [ ] At least one Pro feature has shipped. The upgrade sheet keeps checkout closed while every Pro feature reads
      "Coming in an update", because `CHECKOUT_URLS` is empty or the features are unavailable.
- [ ] Test in **Stripe test mode** end to end: buy, claim page, Open in Offsuit, Check for renewal after a test
      renewal, refund (the next refresh says refunded), cancel from the portal.
- [ ] The build is packaged (`app.isPackaged`). Only then does it refuse the dev key and `OFFSUIT_DEV_TIER`, and
      register `offsuit://`.

## Development keys

`node scripts/mint-test-key.ts [--plan monthly --days 30 | --expired-days 3 | --perpetual] [--link]` mints a key
with the committed throwaway dev key. Such keys work in `npm start` and e2e only.
