# Independent review: habit loop PR 1 (branch feat-habit-loop)

Three passes by separate reviewer agents with no author context. Each reviewed read-only and ran units only.

| Pass | HEAD | Verdict |
|---|---|---|
| 1. Review | 7e19a1e | **FAIL**: one blocker (B1), three should-fix (S1–S3), six nits |
| 2. Re-review | 1ff8bd2 | **FAIL**: one new double-pay (S-A), two should-fix (S-B, S-C), six nits |
| 3. Fix verification | 44447c3 | **PASS WITH NOTES**: two low edges (V-N1, V-N2), fixed in a38355a; one weak assertion (V-N3), noted; and V-N4, fixed |

## Findings and outcomes

| ID | Finding | Outcome |
|---|---|---|
| B1 | The Ticket was frozen from the post-work state, so the first item worked dropped off instead of ticking | Fixed in 5317b7c, after red unit tests (spot first, review first); e2e spec 2 now works a spot first |
| S1 | Redoing onboarding tore down a live table | Not reproducible: leaving Play already tears the table down (pre-existing behaviour). The redo still moved into Dee's settings (5317b7c) |
| S2 | Pending extras survived a profile delete | Fixed (5317b7c) |
| S3 | Speed progress toward the Ticket was in memory only | Fixed (5317b7c): counted from persisted awards |
| S-A | Speed Reps paid twice on a stale save base (a failed or overlapping save) | Fixed in 44447c3, after a red test: one keyed award per answer index |
| S-B | The day's first save could still re-pick the Ticket with a moved leak | Fixed (44447c3): Home's shown Ticket is adopted |
| S-C / N-c | Onboarding and panel state survived a delete; a save resolving after a delete restored the old diff base | Fixed (44447c3): resets plus a generation counter |
| N-a | Yesterday's greeting could be stamped as today's | Fixed (44447c3) |
| N-b | Escape and Skip from settings saved the edits | Fixed (44447c3): Cancel discards |
| N1–N4, N-d, N-e, N-f | Captions with no leak, the greeting header, a draft lost across tabs, orphan sizes, the bone colour, inline styles, e2e gaps | Fixed or recorded (DECISIONS.md) |
| V-N1 | A Speed answer saved across the 4 am turn paid twice | Fixed in a38355a, after a red test: keyed by its lifetime index |
| V-N2 | A capped Speed jump could push older award keys out of the log | Fixed (a38355a): cap lowered to 20 |
| V-N3 | The stale-ticket assertion is weak | Noted |
| V-N4 | A save during an in-flight delete could write the deleted profile back | Fixed (a38355a): no save while deleting |
| N5, N6 | Folio cap order; award day at a save straddling 4 am | Accepted; low impact |

## Checked and found fine (all passes)
- **Save wrapper:** it ignores its argument safely, because every caller assigns `session` first.
- **No double pay, and no pay for results:** hands, drills, rules, assessments and spots are keyed, and a bankroll-only diff pays 0.
- **Schema:** follows the AGENTS.md recipe, with no version bump and all lists bounded.
- **Test clock:** never active outside e2e or in a packaged build.
- **Streak (D5):** no freezes, and forward-framed copy.
- **Ticket:** at most 29 minutes, with exactly one drill and three spots.
- **Price held:** read from `Grade.close` only.
- **Styling:** no hex literals; mint and amber are absent from the streak and ring.
- **Nothing locked:** onboarding always leaves every tab live.
