# Review: feat/pro-licensing
Verdict: PASS WITH NOTES
Base: a7d64200ba36589c680f81f9caa3813fd8805829  Head: a4b7356 (first pass at 2de00fd3 was BLOCK with 9 Act-on items; all 9 are fixed at a4b7356, each with a probe below)

## Act on
None remain. Each original item, re-attacked at a4b7356:
- FIXED. Remove, then re-paste an expired key after a clock rollback (clock.ts / licence.ts). Proof: probe2-client "1" returns `{ok:false, reason:'already-ended'}` and the state stays `free`. Pasting never moves the mark (`highWaterAfterInstall` is deleted), and `remove()` keeps the mark.
- FIXED. An out-of-range stored mark zeroing the guard (licence.ts adopt / mirror). Proof: probe2-client "2". Profile `highWater` set to 1e20, -1, "x", 1.5 or null, and the settings mirror set to 1e20 on restart, all leave the state `expired`. `saneMark` runs before every combine.
- FIXED. Deep-link confirm installing a link other than the one shown (main.ts deeplinkConfirm). Proof: probe2-deeplink.spec (real app). Preview A, link B arrives, `confirm(true, idA)` gives `declined`. Confirm with no id gives `declined`. The installed key stays `aaaaaa`.
- FIXED. An expired key replacing a good one (licence.ts install). Proof: the dialog reads "Its paid period has already ended, so it cannot be added" with Close only. `install` refuses `already-ended` and `older-than-current` (probe2-client "6"). A newer key shows "It replaces the key ending aaaaaa".
- FIXED. Checkout opening with nothing shipped or no price (main.ts checkoutPlans). Proof: with `OFFSUIT_CHECKOUT_MONTHLY` set, nothing shipped and no price, `licenceOpenCheckout('monthly')` returns `{opened:false}`. The sheet's price now comes from main (`status.prices`). The dev overrides are unpackaged only.
- FIXED (in one process). Concurrent first events minting two lids (handler.ts). Proof: probe2-server "race" with 5 ms store and API latency gives `issued, current, current`, one `onIssued`, orderIds `[cs_1, in_1]`. A full refund running alongside a grant ends `revoked`. Multi-instance needs the store guarantee docs/PAYMENTS-SETUP.md now asks for (see Noted).
- FIXED. A refund before the grant being lost (handler.ts revoke tombstone). Proof: refund-first gives `revoked`. The checkout after it also gives `revoked`, and 0 tokens are issued. Restore on the tombstone answers `revoked` with no token.
- FIXED. A partial refund revoking for good (stripe.ts getCharge, handler.ts). Proof: partial refund gives `partial-refund`, then a full refund gives `revoked`, the same period gives `revoked`, and a later paid period gives `renewed`. `charge.dispute.closed` with `won` changes nothing; with `lost` it revokes.
- FIXED. payments-setup `$n` expansion (scripts/payments-setup.ts). Proof: run on a /tmp copy, `'$10 a month'` and `'$1 a year'` are written verbatim. `--server http://x` throws before any key file is created (the key dir does not exist afterwards). The docs use single quotes.

## Consider
Both items from the second pass were fixed by the author after it (verified by the unit tests named here; not re-attacked by the reviewer):
- FIXED. `correctClock` trusting an unsigned number. The server now returns `clock: {now, kid, sig}`, an Ed25519 signature over `OFFSUIT-TIME1.<now>.<lid>`, and main corrects the mark only from a reading that verifies with an embedded key for the licence in hand. Proof: licenceAuthority.test "only the server’s SIGNED time…": unsigned, wrong key, another lid and no token are all refused. licenceServer.test "the clock reading in a reply is signed for that licence".
- FIXED. A newer but shorter key from another licence replacing a longer one. `install` refuses `shorter-than-current` (a different lid with an earlier paid-through date, or any end date over a perpetual key). Proof: licenceAuthority.test "a different licence that ends sooner…". Tradeoff accepted: switching from annual to a different, shorter licence needs Remove first.

## Noted
- The rollback guard is two user-writable files. Zeroing or deleting both, then setting the clock back and re-pasting a saved key, revives it offline. This is inherent to an offline mark. With the clock held back, licence time now ticks by app runtime (probe "3": 696 runtime hours until a 29-day key ends; the mark survives restarts, probe "3b"). DECISIONS now says exactly that.
- handler.ts `serialized` covers one process only. Multi-instance hosts must provide a row lock or compare-and-set, as docs/PAYMENTS-SETUP.md now says. `subscriptionForOrder` (for an event carrying an order id but no subscription) runs outside the queue. A `linkOrder` still queued can make it answer `no-subscription`, and that event is then consumed. Real Stripe events of these types all name the subscription, so this is an edge.
- stripe.ts getCharge maps a missing `amount` to 0. `amountRefunded < amount` is then false, so a charge with no amount reads as fully refunded. Stripe always sends `amount`, so this is harmless today.
- src/main/network.ts `licensingArmed` is module-global. Concurrent fetches fail closed only.
- `store:load` gives the renderer the profile, token included. The key is the learner's own, so there is no grant impact.
- A dispute now changes nothing until it closes. Decided in DECISIONS.

## Dismissed
- Forged keys (edited claims, signature reuse, padding and alternate encodings, the S+L malleable signature, duplicate keys and `__proto__`, kid confusion), the dev key or OFFSUIT_DEV_TIER in a packaged build, a doctored saveState, odd IPC types, openExternal or the licensing session aimed elsewhere, webhook replay or re-signing, events for another customer, restore enumeration, and egress without a button press. Proof: the first-pass probes held, and the code on those paths is unchanged at a4b7356 apart from the reviewed fixes. pro.spec and no-network.spec pass at a4b7356.
- The restore timing gap (old Consider). Proof: handler.ts now hashes before the lookup and compares against a zero hash on a miss.
- Past-due to active in the same period minting a token (old Consider). Proof: probe2-server returns `current` with 1 issued.
- Manage hidden without a key (old Consider). Proof: proSettings.ts shows it whenever `status.manage`.
- The profile schema recipe. Proof: the change is additive under `progression.entitlements`, carried by the unknown-key carry, and needs no bump.

## Verification
- At a4b7356: `npm run typecheck` exit 0. `npx vitest run` exit 0 (96 files, 1933 tests). `npm run build` exit 0.
- `env -u ELECTRON_RUN_AS_NODE npx playwright test tests/e2e/pro.spec.ts tests/e2e/no-network.spec.ts`: 15 passed, exit 0. Screenshots were restored with `git checkout screenshots/`.
- Re-attack probes (run from tests/tmp, then moved to /tmp/offsuit-review-probes/v2/, so tests/tmp is gone and tsc stays clean): probe2-client.test.ts (14 tests across both files pass), probe2-server.test.ts, and probe2-deeplink.spec.ts (real app). payments-setup ran on copies in /tmp/offsuit-probe only.
- Not run: `npm run test:full` (required for this high-radius change before merge), a packaged build end to end, a real Stripe account, and a multi-instance store.
