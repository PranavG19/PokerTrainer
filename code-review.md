# Independent review: Chalk (branch feat-chalk): the earn-only budget, fixed prices, spending (2.6, owner D4)

Two passes by one reviewer agent with no author context. It reviewed read-only and ran typecheck and units only (no
Playwright or build: the shared e2e lock governs those). The cosmetics and Locker review (#35) is in that PR's history.

| Pass | HEAD | Verdict |
|---|---|---|
| 1. Review | d3e4db9 | **PASS WITH NOTES**: nothing blocking; no farming or double-pay; two medium, five low, test gaps |
| 2. Re-review | 557f8a7 | **PASS WITH NOTES**: fixes 2–7 landed; one medium-low and two low, fixed in the final commit |

## Findings and outcomes

| ID | Finding | Outcome |
|---|---|---|
| 1 (M) | The two-press confirm could be bypassed by a double-click | Fixed, red first (`locker.spec`): a confirm within 500 ms is ignored |
| 2 (M) | Chalk bought celebrations, whose session-end moment is unbuilt | Fixed, red first (`economy.test`): no celebration is priced |
| 3 (L-M) | With the clock behind the ledger day, the Locker promised Chalk it would not pay | Fixed, red first: nothing left today, and the Locker says when earning resumes. The lockout is kept: it is what stops a day being paid twice |
| 4 (L) | The balance missed today's owed Chalk until the next save | Fixed, red first: the Locker shows and spends the ledger the next save files |
| 5 (L) | A second purchase during an in-flight save could start from a stale snapshot | Fixed: a guard in main and the button off until the save lands |
| 6 (L) | A read-only profile could spend in memory | Fixed, red first: "Read-only profile", nothing spent or worn |
| 7 (L) | `spend` trusted the caller's price | Fixed, red first: `spendItem` reads price and name from the catalogue |
| T | Two tests could not fail (bankroll, won pot); the conversion regex was narrow | Rewritten against the saved bankroll and a graded hand; a scan forbids unit casts outside `units.ts`; tests added for 4 am, a full Reps log, a future ledger day |
| R2-a (M-L) | A held Enter still confirmed (key repeat turns into clicks) | Fixed, red first: repeated keydowns are ignored |
| R2-b (L) | The button stayed off if a spend was declined | Fixed: `onSpend` returns false and the caption repaints |
| R2-c (L) | An armed confirm never expired | Fixed: it lapses after 8 s (tested), along with the clock-behind line |

## Checked and found fine (both passes)
- The curve matches VISION §4 (150 + 75 = 225), and is monotonic. A day pays at most 225 whatever is replayed, gone
  stale or evicted from the Reps log. A clock moved back pays nothing.
- Every path into Chalk starts from Reps. Nothing reads chips, pots or results, and Chalk converts into nothing.
  There is no money path, sale or randomness. Nothing cosmetic or currency-like is Pro.
- The balance is ink, with one bone primary. There is no schema change: the v2 ledger and the receipt `chalk` field
  are reused.
