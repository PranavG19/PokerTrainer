# Independent review: Settings — Character, Celebrations and the local trial (branch feat-settings-trial, 1.8)

Two passes, each by a fresh reviewer agent with no author context. Both reviewed read-only and ran only the typecheck
and unit tests; Playwright runs go through the shared e2e lock.

| Pass | HEAD | Verdict |
|---|---|---|
| 1. Review | bc5a8bd | **PASS WITH NOTES**: no high findings, no egress, no deletion; 2 medium defects, 1 medium design risk, 10 low |
| 2. Re-review | 97a5909 | **PASS WITH NOTES**: all 8 fixes correct; 1 medium (the mid-trial table), 6 low, fixed in d58dd62 |

## Findings and outcomes

| ID | Finding | Outcome |
|---|---|---|
| 1.1 (M) | An older build read a newer build's unknown trial status as "none" and let Start replace the whole trial | Fixed in 97a5909, red first: `startRefusal` reads the raw status and start day |
| 1.2 (M) | `countBlock` re-ran each concept's whole drill history for every rep, on every save (383 ms at 3,000 × 3,000) | Fixed in 97a5909: counting is incremental from a per-week high-water mark, and only concepts with a new rep are replayed |
| 1.3 (M, design) | The late-night and busy-day criteria compared raw totals, so more practice in on weeks tripped them | Changed in 97a5909: they compare shares, with minimum samples. Recorded in DECISIONS.md as a decision to evaluate |
| 1.4 (L) | Taking the max of each field kept a capped log from shrinking a week but also stopped it growing | Fixed in 97a5909, red first (incremental counting) |
| 1.5 (L) | An empty save filed an empty week, so "weeks with a session" over-counted | Fixed in 97a5909, red first |
| 1.6 (L) | Practice earlier on the start day, before Start was pressed, counted | Fixed in 97a5909, red first: `startedAt` |
| 1.7 (L) | Verdicts showed mid-trial, which could bias the remaining weeks, and on a stopped trial, which is never judged | Fixed in 97a5909: verdicts appear only once results are ready or finished |
| 1.8 (L) | Quieter spacing allowed a line on the Nth hand, and it also silenced the session summary | Fixed in 97a5909, red first: N silent hands; the summary is exempt |
| 1.9 (L) | An off week that starts while a table is open applies at the next save or table | Open, accepted: the next save or table rebuild applies it |
| 1.10 (L) | `observeTrial` ran inside `saveState` with no guard | Fixed: wrapped in try/catch; the old counts stand |
| 1.11 (L) | The baseline kept all seven Calibration fields | Fixed, red first: three fields |
| 1.12 (L) | a11y: Start's reason was not live; Dee's screen gives no off-week note; aria-pressed vs aria-checked differ between screens | The reason is now `aria-live`. The other two stay open (Settings follows its own theme idiom) |
| 1.13 (L) | Test gaps (off-week Dee silence at the table, a loose mastered assertion, the 4 am day in e2e) | The mastered assertion is exact; e2e accepts either side of 4 am. The off-week check is by `html[data-character]`, the attribute every Dee mark reads |
| 2.1 (M) | The running view's on-vs-off table still let the verdict be worked out | Fixed in d58dd62: while running, every week is pooled into one column, and `data-tripped` is set only once results are ready or finished |
| 2.2 (L) | One save with a fast clock stalled a week until real time caught up | Fixed in d58dd62: a mark past now is filed back at now, so at most one save's activity is lost (test) |
| 2.3 (L) | Blocks without `through` double-count | e2e fixtures carry `through`. Never shipped: bc5a8bd was not merged |
| 2.4 (L) | The table showed late and busy totals where the criteria use rates | Fixed: share (n) |
| 2.5 (L) | Fields inside a block or the baseline can't be carried | Recorded in DECISIONS.md: a later field goes in a new key |
| 2.6 (L) | Stale header comment | Fixed |
| 2.7 (L) | No test that a session continues across saves, or that a delayed rep reads history older than the mark | Added (unit) |
