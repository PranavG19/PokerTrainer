# Independent review: habit loop PR 2 (branch feat-habit-nav): the 7-tab nav, Profile, the Trophy room

Two passes by separate reviewer agents with no author context. Each reviewed read-only and ran units only.

| Pass | HEAD | Verdict |
|---|---|---|
| 1. Review | 7022980 | **FAIL**: one blocker (B1), three should-fix, eight nits |
| 2. Re-review | 0093c0c | **PASS WITH NOTES**: B1 and S1–S3 fixed; one new should-fix (S-A) and four nits, fixed in a7e0a29 |

## Findings and outcomes

| ID | Finding | Outcome |
|---|---|---|
| B1 | A panel left open (friends, online, assessment, variance) hid a table started from Home, and the hidden hand kept eating keys | Fixed in 45b771e, after a red e2e test: starting a table closes every panel |
| S1 | story.spec checked D17 against Home, not Play | Fixed: it now checks Play, where the tables live |
| S2 | No vertical-fit checks under the sub-navs | Fixed: a spec measures all 13 Study and You screens at both sizes |
| S3 | An open rival file stuck across navigation | Fixed: reset on navigation and on a delete |
| N1–N8 | trophy rows in `.g-group`; Profile's Edit opened under Dee; sub-nav ARIA; Home mid-hand undocumented; duplicated `--screen-h`; Charts width margin; the bone mark unrecorded; extra work | Fixed or recorded. N6, the Charts cell width at 900 px (about 1 px over the floor), is open as a plausible flake; the charts spec passes |
| S-A | A launcher could land on another panel left open | Fixed in a7e0a29, after a red e2e test: the panels are exclusive (`openPanel`) |
| N-A..N-D | Fit test on an empty profile; no test for Profile's Edit; the Hands graph sized from `100vh`; the sheet closing on navigation unrecorded | A rule line clamps at two lines; Edit has a test; the graph sizes from `--screen-h`; recorded in DECISIONS.md |

## Checked and found fine (both passes)
- **Reachability:** every old destination (the 12 tabs plus Pro) is reachable in at most two clicks through `OLD_TABS`.
- **Profile and the Trophy room:** no results appear (no bankroll, chips, won or lost, net or percentile); e2e checks this.
- **Styling:** tokens only, with no hex literals, and no mint, amber or coral on balances.
- **Spec changes:** each one is a deliberate retarget, and none weakens a test.
- **`go()` resets:** onboarding (first run, the Dee redo, Profile's Edit) still behaves.
