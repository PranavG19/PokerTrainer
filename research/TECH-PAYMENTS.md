# TECH-PAYMENTS: merchant of record and licensing for Offsuit Pro

Research date: 2026-10-12. Every claim cites a source ID from [Sources](#sources); all sources were accessed
2026-10-12. Where a page shows its own "last updated" date, it is given there. Claims marked
**(unverified, from memory)** could not be confirmed from a fetched primary source.

Product facts the analysis depends on: a Hold'em **trainer**. Play money only, no real-money wagering, no
prizes, no cash-out, no chips or virtual currency for sale. One product is sold: "Pro" (online ranked play and
seasons, a hand-history import leak finder, ICM/push-fold tools, cloud sync), sold worldwide, macOS first.

---

## 1. Lemon Squeezy (Stripe-owned; moving to Stripe Managed Payments)

**Status.** Stripe bought Lemon Squeezy on 2024-07-26 [S12]. Stripe Managed Payments (SMP) was announced
2025-04-29 as "merchant-of-record functionality built into Stripe", starting in private preview in summer
2025 [S13]. The 2026-01-28 update says: "Our goal is to provide Lemon Squeezy users an easy way to migrate
to Stripe Managed Payments" and "Very soon we will announce public access for Stripe Managed Payments" [S14].
SMP is now generally available ("Start now" self-serve signup) [S6]. Lemon Squeezy still takes signups
[S10], but a new product should not start on a platform whose own team is moving its users to Stripe.

**1. AUP (poker/gambling).** The prohibited list opens: "The following products and services are prohibited
on Lemon Squeezy:" and includes "Regulated products such as: CBD, gambling, weapons, ammunition, pay to play
auctions, sweepstakes, lotteries, business-in-a-box, work-from-home, get-rich-quick schemes, etc." [S9]. The
Terms Appendix A also covers "products restricted by our payment processing partners" (Stripe) [S8]. For
unclear cases: "contact Lemon Squeezy support with a description or example of the content before you start
selling" [S9].
**Verdict: allowed, but ask first.** "Gambling" is prohibited. A trainer with no wagering is not gambling,
but "poker" alone could trigger a review, so ask support in writing before going live. Page dates: none
shown [S8][S9].

**2. Fees and tax.** 5% + 50¢ base [S10]. On top of that: +1.5% for international (non-US) transactions,
+1.5% for PayPal, +0.5% for subscription payments. Payouts are free to a US bank and 1% to non-US banks;
PayPal payouts cost $0.50 (US) or 3% capped at $30 (non-US). Abandoned-cart recovery adds 5% [S11]. Lemon
Squeezy is the MoR and collects sales tax/VAT [S10]. It supports both subscriptions and one-off products.

**3. Licence keys and webhooks.** Lemon Squeezy has built-in licence keys: "a unique license key will be
generated for each customer that purchases the product". Activation limits and validity length can be set,
and for subscriptions "license keys are linked directly to the subscription lifecycle" [S17]. Licence API
endpoints are `POST https://api.lemonsqueezy.com/v1/licenses/activate`, `/validate` and `/deactivate`, rate
limited to 60/min [S15]. `validate` returns `valid`, `license_key.status`
(`inactive|active|expired|disabled`), `activation_limit`, `activation_usage` and `expires_at` [S15][S16].
Webhook events [S19]: `order_created`, `order_refunded`, `subscription_created`, `subscription_updated`,
`subscription_cancelled`, `subscription_resumed`, `subscription_expired`, `subscription_paused`,
`subscription_unpaused`, `subscription_payment_success`, `subscription_payment_failed`,
`subscription_payment_recovered`, `subscription_payment_refunded`, `license_key_created`,
`license_key_updated`.
**Signature:** header `X-Signature` = hex(HMAC-SHA256(key = the webhook signing secret, msg = the raw
request body)) [S18]. There is no timestamp, so replays have to be caught by deduplicating on the event or
order id.

**4. Refunds and chargebacks.** The seller issues refunds. Lemon Squeezy "is not obligated to issue refunds
… but may do so if a Seller … commits fraud, if there are mistakes …, or if a Product violates the Terms"
[S8]. The terms state no chargeback fee [S8][S11]. A $15 fee per chargeback is **(unverified, from memory)**.

**5. Server needed?** The built-in keys work without our own server: the app calls `/v1/licenses/validate`.
Calling it from the client exposes the call to tampering, and Lemon Squeezy's future is tied to the SMP
migration.

---

## 2. Paddle (Billing)

**1. AUP (poker/gambling).** The AUP was last updated 13 April 2026 [S3]. Its "Gambling" category, listed
as **prohibited**:
- "Betting-related products, competition/event tickets, or entries"
- "lotteries, auctions, contests, sweepstakes, or games of chance"
- "Sports forecasting/odds making where monetary or material prizes are involved"
- "fantasy sports leagues"

Also prohibited: "Virtual currency or stored value, including but not limited to store credit, gift cards,
vouchers". Paddle says it serves "software companies (including B2B SaaS, Consumer Software, and Games)",
and "Paddle reserves the right to exercise judgment in ascertaining whether any of these factors are likely
to be present" [S3]. The only categories allowed with enhanced review are content generation (realistic
human faces), tech support and VPN/proxies [S3].
**Verdict: allowed in principle, but the highest review risk of the five.** "Games of chance" carries no
prize qualifier, unlike Stripe's wording. A reviewer who files poker as a game of chance could reject us at
discretion, and Paddle offers no pre-approval path for this category. Raise it with sales before
integrating.

**2. Fees and tax.** "5% + 50¢ per Checkout transaction", "all-inclusive with no monthly fee". Products
under $10 can get "bespoke pricing" [S20]. Paddle is the MoR and handles tax and VAT [S20]. It supports
subscriptions and one-off sales. Tax categories are `standard` and `saas` by default [S24].

**3. Licence keys and webhooks.** Paddle Billing has **no built-in licence keys** [S24], so our own token
design (section 5) is required. Webhook events [S22]:
- subscriptions: `subscription.created`, `subscription.activated`, `subscription.updated`,
  `subscription.past_due`, `subscription.paused`, `subscription.resumed`, `subscription.canceled`,
  `subscription.trialing`
- transactions: `transaction.completed`, `transaction.paid`, `transaction.payment_failed`
- refunds and chargebacks: `adjustment.created`, `adjustment.updated`

Adjustment actions are `refund`, `credit`, `chargeback`, `chargeback_warning` and `chargeback_reverse`
[S23]. Renewals arrive as `transaction.completed` with `origin` = `subscription_recurring`, and `canceled`
is terminal **(unverified, from memory)**.
**Signature:** header `Paddle-Signature: ts=<unix>;h1=<hex>`. h1 = hex(HMAC-SHA256(key = the endpoint
secret key `pdl_ntfset_…`, msg = `ts + ":" + rawBody`)). The SDK's default tolerance is 5 seconds [S21].

**4. Refunds and chargebacks.** Live-account refunds are created as `pending_approval`. They are approved
automatically if the account is verified, the refund is ≤ US$400 and within balance, and the payment was
not a bank transfer [S23]. Under the MSA (last updated 6 October 2026), Paddle may refund the buyer if the
buyer "requests a refund within fourteen (14) days … and Paddle determines, in its sole discretion, that a
refund is appropriate" [S25]. The chargeback fee is "up to 20 GBP, USD or EUR, or 40 AUD or CAD" per
chargeback or pre-chargeback alert, and the seller reimburses the amount [S25]. Buyer terms (last updated
31 March 2026): EU/UK 14-day withdrawal, which doesn't apply once the buyer has used the product; cancel any
time, effective at period end [S26].

**5. Server needed?** Yes. Without licence keys, entitlement needs our webhook handler plus a token, or an
API lookup.

---

## 3. Stripe: Payments + Billing + Tax (we are the MoR), and Stripe Managed Payments (Stripe is the MoR)

**1. AUP (poker/gambling).** The Prohibited and Restricted Businesses list was last updated 2026-09-22 [S1].
Its Gambling bullets are under **Prohibited Businesses**:
- "Games of chance including gambling, internet gambling, casino games, sweepstakes and contests, and
  fantasy sports leagues with a monetary or material prize"
- "Games of skill including video game and mobile game tournaments or competitions, darts, card games, and
  board games with a monetary or material prize"
- "Payments of an entry or player fee that promise the entrant or player will win a prize of value"
- "Lotteries", "Bidding fee auctions"

A Japan-specific item reads: "Consultation and advisory or prediction services relating to online gaming or
gambling" [S1]. SMP adds a product-eligibility review [S5]. Its video-game tax codes say "This does not
include games that are considered betting, gambling, lottery, and so on" [S5].
**Verdict: allowed.** Stripe's list is the only one that ties every games bullet to "**with a monetary or
material prize**". Offsuit has no prize, no entry fee and no cash-out, so it falls outside every bullet as
written. One caveat: in Japan a leak finder could be read as gambling "advisory". That item is listed under
Japan, which in context appears to apply to Japan-based businesses; this needs confirming. Stripe also
reviews each business for SMP eligibility [S5].

**2. Fees and tax.**
- *Stripe as processor only (we are the MoR):* 2.9% + 30¢ for domestic cards, +1.5% international cards,
  +1% currency conversion [S27]. Billing adds 0.7% of billing volume [S28]. Tax Basic costs 0.5% per
  transaction where we are registered (or 50¢ via the API). Tax Complete, which adds registration and
  filing, starts at $90/month [S29]. **We stay liable** and must register for EU OSS, UK VAT, US states and
  so on ourselves [S29]. That is not workable for a solo seller worldwide.
- *Stripe Managed Payments (Stripe is the MoR):* "Managed Payments adds 3.5% per successful transaction to
  your standard Stripe processing fees", covering tax, fraud, disputes and support [S6]. It is generally
  available [S6]. Stripe handles indirect tax in "more than 80 countries" and remits it. Where it doesn't,
  we remain responsible, and Stripe Tax calculates those at no charge [S7]. Customers see Link as MoR, and
  statements read `LINK.COM* <descriptor>` [S7].
  - Eligibility [S5]: businesses based in US, CA, the EU/EEA, CH, GB, AU, HK, JP or SG; digital products
    only (software, video games, online courses); buyers in 195+ countries except CN, CU, IR, KP, RU, SY and
    a few others.
  - Subscriptions are "Available with Billing" and must be created through Checkout or Payment Links [S4].
    Whether Billing's 0.7% stacks on top is **(unverified)**.
  - Estimated all-in for a US card: about 6.4% + 30¢. An international card adds 1.5%, and FX adds 1%.
  - Suggested tax code: `txcd_10202001` "Downloadable Software - non-recreational - personal use (…
    educational …)" [S5].

**3. Licence keys and webhooks.** Stripe has **no licence keys**. There are Billing entitlements
(`entitlements.active_entitlement_summary.updated`), but these are server-side only [S31], so our own token
design is required. Events to handle [S31]:
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated` (also fires on renewal and plan change)
- `invoice.paid` (renewal paid: extend access after confirming the subscription is `active`)
- `invoice.payment_failed`
- `customer.subscription.deleted` (subscription ended)
- `charge.refunded`
- `charge.dispute.created`
- `radar.early_fraud_warning.created`

**Signature:** header `Stripe-Signature: t=<unix>,v1=<hex>[,v1=…]`.
v1 = hex(HMAC-SHA256(key = the endpoint secret `whsec_…`, msg = `t + "." + rawBody`)) [S30].
- Ignore every scheme other than `v1`.
- Compare in constant time.
- The libraries default to a 5-minute tolerance, and Stripe says never to use 0.
- A rolled secret can mean more than one `v1` per header.
- Deduplicate on event id, because delivery order is not guaranteed and retries continue for up to 3 days
  [S30].

**4. Refunds and chargebacks.**
- With SMP, Stripe handles disputes: it decides whether to fight, submits the evidence and pays the evidence
  fee itself. We pay the dispute-received fee [S7], which is $15, plus $15 if we counter a dispute ourselves
  (refunded if we win) [S27].
- Customers can ask Link support for refunds. Stripe "can issue refunds within 60 days" in some cases, and
  "If you don't respond within 48 hours, Stripe might issue a refund without your approval" [S7].
- Continued SMP eligibility requires "a low historical dispute rate" [S5].

**5. Server needed?** Yes. Stripe has no licence keys, so entitlement needs our webhook handler, which the
ranked-play server will host anyway.

---

## 4. Gumroad

**1. AUP (poker/gambling).** The prohibited products page was last updated September 16, 2026 [S2].
Prohibited: "gambling (including legal gambling where the cardholder is not present when the bet is made,
lotteries, illegal gambling, internet gambling, sports forecasting and odds making)", and "virtual currency".
"The gambling entry above covers wagering itself and the things that drive a wager: picks, predictions, tips
or "signals", live odds feeds, sportsbook affiliate and promo-code funnels, lotteries, and any promise by the
seller that the buyer will make money." **Explicitly allowed:** "Educational writing and courses about
strategy, discipline, house edge or bankroll math are allowed. So are bet logs, bankroll and session
trackers, profit-and-loss spreadsheets, odds and expected-value calculators that work on numbers the buyer
supplies, and statistical research datasets." [S2]
**Verdict: allowed, and the clearest fit.** Strategy education, session trackers and EV calculators that
run on the buyer's own data describe the trainer, the leak finder and the ICM tools almost exactly.
Marketing must never promise winnings ("make money at poker").

**2. Fees and tax.**
- 10% + $0.50 per direct sale, plus card processing of 2.9% + $0.30 and any PayPal fees. Discover
  marketplace sales cost a flat 30% [S32].
- Direct sales drop to 5% + $0.50 once a month's paid sales pass $20k [S32].
- Gumroad has been the MoR for all taxes since 2025-01-01 [S33].
- Memberships (subscriptions) and one-off sales are both supported [S33].

**3. Licence keys and webhooks.** Gumroad has built-in licence keys: `POST
https://api.gumroad.com/v2/licenses/verify` with `product_id`, `license_key` and `increment_uses_count`
(default "true"). The response carries `uses` and a `purchase` object with `refunded`, `disputed` and
`recurrence` [S34]. There is **no activation limit**: we would read `uses` and enforce a limit ourselves.
Webhooks are the "Ping" plus resource subscriptions: `sale`, `refund`, `dispute`, `dispute_won`,
`cancellation`, `subscription_updated`, `subscription_ended` (fires at the actual end) and
`subscription_restarted` [S35].
**Signature: none.** In Gumroad's words: "Because the payload is unsigned … treat a ping as a trigger
rather than as data: take sale_id, read the sale back through the API, and reconcile periodically" [S36].
Pings must be acknowledged within 5 seconds, and only 503/504 responses are retried [S36].

**4. Refunds and chargebacks.** Sellers set their own refund policy. Gumroad "reserves the right to issue
refunds within 90 days of purchase … to prevent chargebacks". If more than 1% of customers dispute, Gumroad
enforces a 30-day refund policy account-wide [S37]. On a chargeback the seller covers the amount plus
processing fees, and Gumroad returns its platform fee. Gumroad contests the dispute with seller input
(72-hour window) [S38].

**5. Server needed?** Not strictly. The app can call `/v2/licenses/verify` directly. With our server, the
handler has to call back to the Gumroad API to confirm each ping before minting a token.

---

## 5. Mac App Store (MAS)

**1. Guidelines (poker/gambling).**
- 5.3.4: "Apps that offer real money gaming (e.g. sports betting, poker, casino games, horse racing) or
  lotteries must have necessary licensing … Illegal gambling aids, including card counters, are not
  permitted" [S39]. 5.3.3 forbids IAP for real-money-gaming currency [S39]. Neither applies to a
  play-money trainer.
- Age rating: "Simulated Gambling: Betting or wagering without using real money or in-game currency that
  can be exchanged for real money". Infrequent simulated gambling rates **13+**, frequent rates **18+**
  [S40]. A poker trainer is "frequent", so expect **18+**.
- 2.3.6 requires honest answers to the age-rating questions [S39]. The guidelines page shows no date
  [S39].

**Verdict: allowed, at 18+.** The listing must make clear there is no real money, which is true. The
"gambling aids" risk applies to real-time assistance during real-money play. Offsuit doesn't attach to live
real-money tables, and the listing should say so.

**2. Fees and commerce.**
- Commission is 15% under the Small Business Program (up to $1M in proceeds the prior year), otherwise 30%
  [S41]. The 15% rate for subscriptions after their first year is **(unverified, from memory)**.
- Apple is the MoR and handles tax.
- 3.1.1: "If you want to unlock features or functionality within your app … you must use in-app purchase.
  Apps may not use their own mechanisms … such as license keys" [S39].
- 2.4.5(vi): MAS apps "may not present a license screen at launch, require license keys, or implement
  their own copy protection" [S39].
- 3.1.2: subscriptions must last at least seven days and be available on all of the user's devices [S39].
- 3.1.3(b): multiplatform apps may honour subscriptions bought elsewhere "provided those items are also
  available as in-app purchases within the app" [S39].

**3. Distribution effects.**
- Sandboxing is mandatory (2.4.5(i)). So are Xcode packaging (ii) and updates only through the MAS (vii)
  [S39].
- Electron requires its MAS build. The `autoUpdater` and `crashReporter` modules are disabled, and the
  build needs `com.apple.security.app-sandbox` and application-groups [S42].
- The LAN relay needs `com.apple.security.network.server` ("may listen for incoming network connections").
  Online play needs `com.apple.security.network.client` [S43][S42].
- Electron's `inAppPurchase` module (MAS only) wraps purchase, restore and getProducts. Its docs don't
  cover subscription or receipt validation [S44], so we would add a StoreKit 2 / App Store Server API path.
- **Selling direct outside the MAS remains possible**, as a Developer ID-signed, notarized build with its
  own checkout. That build is not bound by the App Review rules. Notarization being required outside the
  MAS is **(unverified, from memory)**.
- A MAS build would need IAP for Pro and its own sandboxed, no-licence-key variant: a second build to
  maintain.
- The 2025 US anti-steering ruling (*Epic v. Apple*) allowing external purchase links on the US storefront
  is **(unverified, from memory)**.

**4. Refunds and chargebacks.** Apple handles refunds and chargebacks. Refund notifications arrive through
App Store Server Notifications V2 (`REFUND`), and renewals as `DID_RENEW`, `EXPIRED` and so on
**(unverified, from memory)**.

**5. Server needed?** Apple's model is receipt or JWS transactions. A server is needed to link MAS
purchases to a ranked-play account.

**MAS conclusion.** Not for launch. Sandboxing, the update channel, a second build, a 15–30% cut and an 18+
rating cost a lot for little gain. Ship direct first. Revisit the MAS as a second channel through 3.1.3(b)
once IAP prices are set.

---

## Summary table

| | Lemon Squeezy | Paddle Billing | Stripe Managed Payments | Gumroad | Mac App Store |
|---|---|---|---|---|---|
| MoR | Yes | Yes | Yes (Stripe/Link) | Yes (since 2025) | Yes (Apple) |
| Poker-trainer AUP | Allowed; ask first ("gambling" prohibited) | Allowed in principle; highest risk ("games of chance", no prize qualifier, discretion) | Allowed (all game bullets need "a monetary or material prize") | Allowed; explicit carve-out for strategy education and calculators | Allowed; age rating 18+ (frequent simulated gambling) |
| Headline fee | 5% + 50¢ (+1.5% intl, +0.5% subs, +1.5% PayPal) | 5% + 50¢ all-in | 2.9% + 30¢ + 3.5% (+1.5% intl card, +1% FX) | 10% + $0.50 + 2.9% + $0.30 processing | 15% (SBP) / 30% |
| Subscriptions | Yes | Yes | Yes (Checkout/Payment Links only) | Yes (memberships) | Yes (IAP, ≥ 7 days) |
| Built-in licence keys | Yes (activation limits, `/v1/licenses/validate`) | No | No | Yes (`/v2/licenses/verify`, no limit) | Not allowed (2.4.5(vi)) |
| Webhook signature | `X-Signature` = HMAC-SHA256(body), hex | `Paddle-Signature` ts;h1 = HMAC-SHA256(`ts:body`) | `Stripe-Signature` t,v1 = HMAC-SHA256(`t.body`) | Unsigned (re-read via API) | JWS-signed notifications (unverified) |
| Chargeback fee | Not stated ($15 unverified) | Up to 20 USD/GBP/EUR | $15 received (+$15 if we counter) | Amount plus processing fees | Apple handles |
| Long-term risk | Being folded into SMP | Low | Low | Low | Distribution constraints |

---

## Recommendation

**Provider: Stripe Managed Payments**, sold direct (Developer ID build), not through the MAS at launch.

**Model:** a Pro subscription, **monthly plus annual** (annual at a discount), sold through Stripe Checkout
in Managed Payments mode. No one-off licence, because the paid features (ranked play, seasons, cloud sync)
are ongoing server services. Entitlement uses **Ed25519-signed tokens minted from webhooks**, not provider
licence keys.

How the tokens work:
1. The ranked-play server hosts `/billing/stripe/webhook`. It verifies `Stripe-Signature` and deduplicates
   on `event.id`.
2. On `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` and
   `invoice.paid` (after re-reading the subscription and confirming `status === "active"`), it upserts
   `{account, plan, current_period_end}`.
3. On `invoice.payment_failed` it flags past-due and keeps access until the period ends. On
   `customer.subscription.deleted`, `charge.refunded` and `charge.dispute.created` it revokes.
4. The token reaches the app by pasting it, or through an `offsuit://activate?key=…` deep link from the
   checkout success page (the app asks before installing it). Offsuit never contacts the server by itself:
   **Check for renewal** and **Restore** are buttons the learner presses (the no-network guarantee). The token
   is `{v, kid, lid, tier, plan, iat, exp = current_period_end, seats}`, Ed25519-signed; the public key ships
   in the app, so it verifies offline. Implemented in `src/core/entitlements/token.ts`.
5. Offline, Pro keeps working for a **14-day grace** after `exp` (a renewal the app has not fetched yet is the
   likely case), then quietly returns to Free. Ranked play and sync are online anyway, so the server checks
   the same token and its revocation state live. (Supersedes the 7-day grace and daily background refresh
   first proposed here, because the app makes no network call the learner did not ask for.)
6. Learning is never gated, so a lapsed token only hides Pro.

**Why Stripe Managed Payments:**
1. Its AUP is the only one whose games wording is explicitly conditioned on "a monetary or material prize",
   which Offsuit doesn't have.
2. Stripe is the MoR in 80+ countries, so we never register for VAT.
3. It has the strongest webhook security (timestamped HMAC, a replay tolerance, secret rolling).
4. Lemon Squeezy's own team is moving its users to SMP. Choosing SMP now skips a migration later.
5. Its fees (about 6.4% + 30¢ US, about 7.9% + 30¢ international) are above Paddle but well below Gumroad.

We need a server anyway for ranked play, so the lack of licence keys costs nothing. Our signed tokens are
stronger than client-side licence-key checks.

**Fallback if Stripe's review rejects us: Gumroad.** A Stripe rejection would be about gambling-adjacency.
Paddle's broader "games of chance" wording and Lemon Squeezy's Stripe-backed AUP would probably fail the
same way. Gumroad's prohibited-products page explicitly allows "Educational writing and courses about
strategy" and "expected-value calculators that work on numbers the buyer supplies".
- Model there: a monthly and annual membership.
- Pings are unsigned, so treat each one as a trigger only. The handler calls Gumroad's API (or
  `/v2/licenses/verify` with `increment_uses_count=false`) to confirm, then mints the same Ed25519 token.
- Put a secret path segment in the `post_url` as a cheap filter; the API read-back is the actual check.
- Cost: about 12.9% + $0.80 all-in.

Paddle (5% + 50¢) is the cheaper alternative if its sales team confirms in writing that a no-prize poker
trainer is not a "game of chance".

**Poker AUP answer.**
- Gambling means wagering something of value for a chance at a prize of value. Offsuit has no stake, no
  prize, no cash-out and no purchasable currency.
- Read literally, every provider's gambling clause therefore misses it.
- Stripe's (every bullet needs "a monetary or material prize") and Gumroad's (explicit strategy-education
  carve-out) say so most clearly. Lemon Squeezy's ("gambling") is fine in substance but worth a pre-check.
  Paddle's ("games of chance", at its discretion) carries real reviewer risk.
- The MAS allows it as simulated gambling rated 18+.

Onboarding description to submit (and to keep identical on the website, store listing and EULA):
> "Offsuit is educational desktop software that teaches Texas Hold'em strategy. All play uses play-money
> chips that have no cash value, cannot be bought, sold, transferred or redeemed, and cannot be won as a
> prize. There is no real-money wagering, no entry fee, no prizes or rewards of any value, and no virtual
> currency for sale. The only paid product is a 'Pro' software subscription that unlocks analysis tools
> (hand-history review of the user's own data, ICM calculators), cloud sync and online ranked practice
> games. It does not connect to or assist play at real-money poker sites in real time, and we make no
> claim that users will win money."

Tax code for SMP: `txcd_10202001` (non-recreational, educational downloadable software).

Don't ever describe ranked seasons with words like "prize", "reward of value", "tournament entry",
"cash" or "earn". If seasons ever grant prizes of value, every provider's gambling clause applies.

---

## Sources

All accessed 2026-10-12.

| ID | URL | Page date |
|---|---|---|
| S1 | https://stripe.com/legal/restricted-businesses | Last updated 2026-09-22 |
| S2 | https://gumroad.com/prohibited | Last updated September 16, 2026 |
| S3 | https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle | Last updated 13 April 2026 |
| S4 | https://docs.stripe.com/payments/managed-payments | none shown |
| S5 | https://docs.stripe.com/payments/managed-payments/eligibility | none shown |
| S6 | https://stripe.com/managed-payments | none shown |
| S7 | https://docs.stripe.com/payments/managed-payments/how-it-works | none shown |
| S8 | https://www.lemonsqueezy.com/terms | none shown (effective on account creation) |
| S9 | https://docs.lemonsqueezy.com/help/getting-started/prohibited-products | none shown |
| S10 | https://www.lemonsqueezy.com/pricing (and https://www.lemonsqueezy.com/) | none shown |
| S11 | https://docs.lemonsqueezy.com/help/getting-started/fees | none shown |
| S12 | https://www.lemonsqueezy.com/blog/stripe-acquires-lemon-squeezy | 2024-07-26 |
| S13 | https://www.lemonsqueezy.com/blog/stripe-lemon-squeezy-update-2025 | 2025-04-29 |
| S14 | https://www.lemonsqueezy.com/blog/2026-update | 2026-01-28 |
| S15 | https://docs.lemonsqueezy.com/help/licensing/license-api | none shown |
| S16 | https://docs.lemonsqueezy.com/api/license-api/validate-license-key | none shown |
| S17 | https://docs.lemonsqueezy.com/help/licensing/generating-license-keys | none shown |
| S18 | https://docs.lemonsqueezy.com/help/webhooks/signing-requests | none shown |
| S19 | https://docs.lemonsqueezy.com/help/webhooks/event-types | none shown |
| S20 | https://www.paddle.com/pricing | none shown |
| S21 | https://developer.paddle.com/webhooks/signature-verification | none shown |
| S22 | https://developer.paddle.com/webhooks/overview | none shown |
| S23 | https://developer.paddle.com/build/transactions/create-transaction-adjustments | none shown |
| S24 | https://developer.paddle.com/build/products/create-products-prices | none shown |
| S25 | https://www.paddle.com/legal/terms | Last updated 6 October 2026 |
| S26 | https://www.paddle.com/legal/checkout-buyer-terms | Last updated 31 March 2026 |
| S27 | https://stripe.com/pricing | none shown |
| S28 | https://stripe.com/billing/pricing | none shown |
| S29 | https://stripe.com/tax/pricing | none shown |
| S30 | https://docs.stripe.com/webhooks | none shown |
| S31 | https://docs.stripe.com/billing/subscriptions/webhooks | none shown |
| S32 | Gumroad help "Gumroad's fees" (gumroad.com help article 66). The page is JS-rendered, so it was read from Gumroad's open-source repo: https://github.com/antiwork/gumroad/blob/main/app/views/help_center/articles/contents/_66-gumroads-fees.html.erb | none shown |
| S33 | https://gumroad.com/pricing | none shown |
| S34 | https://gumroad.com/api (JS-rendered; read from https://github.com/antiwork/gumroad/blob/main/app/javascript/components/ApiDocumentation/Endpoints/Licenses.tsx) | none shown |
| S35 | https://gumroad.com/api (read from https://github.com/antiwork/gumroad/blob/main/app/javascript/components/ApiDocumentation/Endpoints/ResourceSubscriptions.tsx) | none shown |
| S36 | https://gumroad.com/ping (read from https://github.com/antiwork/gumroad/blob/main/app/javascript/pages/Public/Ping.tsx) | none shown |
| S37 | Gumroad help article 51 "What is Gumroad's refund policy" (read from https://github.com/antiwork/gumroad/blob/main/app/views/help_center/articles/contents/_51-what-is-gumroads-refund-policy.html.erb) | none shown |
| S38 | Gumroad help article 134 "How does Gumroad handle chargebacks" (read from https://github.com/antiwork/gumroad/blob/main/app/views/help_center/articles/contents/_134-how-does-gumroad-handle-chargebacks.html.erb) | none shown |
| S39 | https://developer.apple.com/app-store/review/guidelines/ | none shown in fetched text |
| S40 | https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/ | none shown |
| S41 | https://developer.apple.com/app-store/small-business-program/ | none shown |
| S42 | https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide | none shown |
| S43 | https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.network.server (and `.network.client`), read through Apple's documentation JSON | n/a |
| S44 | https://www.electronjs.org/docs/latest/api/in-app-purchase | none shown |

Pages that couldn't be fetched (both returned 404):
- https://www.paddle.com/legal/aup; the help-centre AUP (S3) was used instead.
- Paddle's chargeback help pages; the MSA (S25) was used instead.

The Gumroad help and API pages render client-side and came back empty, so their text was read from
Gumroad's public source repository. The MAS anti-steering, notarization, App Store Server Notification and
Lemon Squeezy chargeback-fee claims are from memory and unverified.
