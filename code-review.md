# Independent review: story extras (branch feat-story-extras): the Kitchen Table, boss hands, keepsakes, the Masquerade (2.1, 2.3)

One reviewer agent with no author context. It reviewed read-only and ran typecheck and the unit suites only (no
Playwright or build: the shared e2e lock governs those). Blast radius: high (`main.ts`, `progression` schema), so
the full e2e suite runs before merge.

| Pass | HEAD | Verdict |
|---|---|---|
| 1. Review | 3289c8c (pre-rebase) | **ONE BLOCKER**, four should-fix, three nits |
| 2. Re-review | f0095bb (rebased on #44, 6-max) | **PASS WITH NOTES**: every fix correct and complete, nothing new; agrees with declining #3; no semantic conflict with the 6-max merge (a cast still forces the 4-seat path) |

## Findings and outcomes

| ID | Finding | Outcome |
|---|---|---|
| 1 (Blocker) | A Masquerade opened from the keepsake shelf was never dealt to disk, so `onHandSettled` counted every hand into an empty seat list | Fixed, red first (`story-extras.spec` "review blocker" failed on the old build): `openRoom` goes through `openMasquerade`, and the hand is recorded against `ensureMasquerade(...)` |
| 2 (Should) | The Masquerade showed the style of a rival the orbit still masks (seat caption and the table's reveal label) | Fixed: the style shows only once the orbit has unmasked that rival too; e2e asserts it is absent |
| 3 (Should) | Boss copy uses the rivals' epithets ("the keeper", "the librarian") and states their tendency before the unmask | **Declined, recorded.** The shipped chapter scripts and intros (#25) already use the same epithets and tendencies while masked ("The keeper bets…", "The toll keeper pays nearly every toll"); D17's mask hides the name and the style label, and neither appears. In Open questions for the owner |
| 4 (Should) | The boss hand turned the rival's cards over after a fold (Library: the rival folds; Lighthouse: the right line folds) | Fixed: cards turn over only at a showdown (`reachedShowdown`, unit-tested); the two reveal lines no longer describe folded cards |
| 5 (Should) | The boss beat's `kept` flag was captured once: a later missed play hid the kept keepsake, and the chapter's beat row did not tick until a re-render | Fixed: the beat and the chapter track it locally; e2e plays clean then misses and sees "On the shelf", and the row ticks at once |
| 6 (Nit) | "N first answers" counted every wrong try | Fixed: "N wrong answers before the right one" |
| 7 (Nit) | The round's doc said two rounds ink "the first read", but folds and bets count per bet or chance | Fixed the doc; the gate is per observable under R1, unchanged |
| 8 (Nit) | `role="listitem"` on buttons (shelf, seat rows); a raw rgba focus ring; a seat with an unknown rival id can never be named | Not changed: the first two copy the shipped beat-row pattern; the third only arises from a newer build's id, where the seat plays and reads as the standard regular |

## Checked by the reviewer and found fine
The boss state machine (every line legal in the engine, numbers from slots, wrong answers never advance); seat order
between `castOf` and `hand.villains`; the Masquerade table torn down on leaving; `saveStory` ordering; parser clamps
and `__proto__` guards; Locker receipt days; N1; no chips judged; existing specs' selectors.
