# Independent review: the Ghost Rail and offline Seasons (branch feat-ghost-rail-seasons) (2.5, 2.7)

Four passes by one reviewer agent with no author context. It reviewed read-only and ran typecheck and units only (no
Playwright or build: the shared e2e lock governs those).

| Pass | Verdict |
|---|---|
| 1. Review | **PASS WITH FIXES**: no blocker; two major, four minor, four nits, four test gaps |
| 2. Re-review | **PASS WITH FIXES**: every fix correct; one major (estimate), one minor, four nits |
| 3. Re-review | **PASS WITH FIXES**: one minor regression from round 2, one stale line of copy |
| 4. Re-review | **PASS**: nothing new |

## Findings and outcomes

| ID | Finding | Outcome |
|---|---|---|
| 1 (M) | Stopping the week once under the pace lifted promotion odds from 1.8% to 18% (simulated) | Fixed, red first: a week is judged on exactly its first 40 scored decisions and rated only when it has them |
| 2 (M) | The Rail's right column clipped Past weeks at 900x640 (the column hides overflow; noPageScroll cannot see it) | Fixed: Past weeks flexes and scrolls inside itself, three rows |
| 3 (L) | An older build settled weeks against a newer build's tier as 'held' | Fixed, red first: an unknown tier leaves the week open |
| 4 (L) | Corrupt promotions could invent moves (and Five Up); a corrupt tier read as a demotion | Fixed, red first: known pairs must be one step up, one move per week, tier at least the highest known move |
| 5 (L) | Ladder names clipped at 900 px | Fixed: rungs show 2 … A, the name in aria-label |
| 6 (L) | The archive counted a finale-week move as held at the close | Fixed, red first: a move is held from the next Monday |
| 7 (nit) | A non-finite grade counted as a free decision | Fixed, red first: skipped |
| 8 (nit) | e2e read the file before the save; playBlock did not assert its clicks | Fixed: polled; asserted |
| 9 (nit) | Pre-existing: with saves failing past 500 awards, evicted hand keys pay again, now into the Rail and Season too | **Open** (inherited ledger behaviour; FINDINGS open question) |
| 10 (nit) | Hard-coded 400 / "30-spot" copy; a seed out of step with its weeks | Fixed: constants (a block is 30 hands); seed consistent |
| R2-1 (M, estimate) | Dropping decisions past the 400-Rep line left ordinary weeks unrated | Fixed, red first: the line is on Reps only (VISION §4); the week is 40 decisions (decision to evaluate) |
| R2-2 (L) | A week at its count was marked mixed by a later grader's hand | Fixed, red first |
| R2-3 (L) | DECISIONS.md stale | Fixed in place, with Supersedes notes |
| R2-4 (nit) | A late-settled older move vanished on reload | Fixed, red first: promotions kept in week order |
| R2-5 (nit) | A stored week over the count was rated on all of it | Fixed, red first: read at the count, mean kept |
| R2-6 (nit) | Profile's links light Trophies | Accepted: the sub-nav marks a section (DECISIONS.md) |
| R3-1 (L) | After the week-order sort, the archived tier read the last move, not the highest | Fixed, red first |
| R3-2 (L) | Rail copy still said play counts 0 past the line | Fixed |

## Checked and found fine
Existing Reps, streak, Ticket and `paid` behaviour unchanged; idempotency under stale and replayed saves (including a
full 500-entry log); week and season maths with negative modulo and the 4 am turn; the daily line across saves; no
demotion path; no schema bump, PROGRESSION_SHAPE keys added, tolerant parsers; no mint, no hex in screen CSS, nothing
for sale, copy passes the lint; the e2e dates resolve as the spec expects.
