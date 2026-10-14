# Code review — Pro tools (branch `feat-pro-tools`)

Independent adversarial review at HIGH radius by a reviewer subagent with no authoring context, including an independent Malmuth-Harville ICM and side-pot model (its scratch scripts lived in /tmp/prorev). Verdict history: round 1 FAIL (1 blocker, 3 major) → round 2 FAIL (1 new major) → **round 3 PASS WITH NOTES** at 5d86208; the round-3 copy notes are fixed in ed20b9a. The blocker (B1, the shipped flag) is held for the owner's checkout answer, which the reviewer judged an honest holding state.

## Pro tools review, round 3 (feat-pro-tools at 5d86208 vs origin/main, HIGH radius)

Re-reviewed the fix diff `e9f52bc..5d86208` (10 files, +120/−25) and re-checked the whole branch for regressions.
The worktree is clean at 5d86208.

- `npm run typecheck`: exit 0.
- `npx vitest run tests/unit/pro-*.test.ts tests/unit/profileSchema.test.ts`: 8 files, 141 tests passed.
- No e2e and no repo edits.

VERDICT: PASS WITH NOTES

N1 through N5 hold. No round-1 or round-2 fix regressed. The notes below are copy and edge cases, plus the standing
caveat that no screen is verified while `available` is held false.

## Round-2 findings: status

| # | Status | Evidence |
|---|---|---|
| N1, forced player ahead of a live caller | **Fixed** | `shapeOf` throws when any non-last caller is forced (`pushFold.ts:96`) |
| N2, all-in hero gave "failed", not "invalid" | **Fixed** | `parseShoveRequest` now runs `shapeOf` and returns `null`, so main answers `{invalid:true}` before any worker job |
| N3, stuck store was a UI dead end | **Fixed** | The report carries `status`. A status other than `ok` shows `pro-store-status` copy and keeps Delete visible with zero hands (unit-tested) |
| N4, newer build's lines dropped | **Fixed (by contract)** | `meta.json` now carries `storeVersion: 1`; `storeVersion > 1` gives status `newer`, writes are refused, and the file and meta are untouched |
| N5, DECISIONS.md said both "enumeration" and "subset DP" | **Fixed** | One ICM line ("exact, by a DP over who has already placed"); the duplicate is removed |

## Repro reruns (/tmp/prorev/r3.ts, pf2c.ts, store2.ts, n4.ts, icmrand.ts)

**N1 and N2: each spot now gives the expected answer.**
- [10, 0.5, 10], BTN shoves into an all-in SB: refused (`null`). This was round 2's repro.
- "Three left" with the SB at 0.5 and ante 1/8 ([15,0.5,20]): refused.
- "Bubble" with the SB seat at 0.5 ([27,13,0.5,14]): refused.
- Hero SB with 0.3: refused. Hero all in from a 0.5 ante: refused.
- An SB whose post covers a 0.4 hero, with the BB behind: refused (correct: the SB is forced and not last).
- Still accepted, and still right:
  - [10,10,0.8] (BB forced and last): top 10% gives push 29.3%, 72o −0.589 bb; equilibrium push 24.1%. Unchanged
    from round 2.
  - Heads-up with the BB at 0.8.
  - A 0.9 hero against the BB's covering post.
  - The three presets are unchanged.
- The BB first in is still refused.
- Heads-up 10 bb Nash is still SB 58.4% / BB 37.3%.

**`settle()` against my independent side-pot model.** All ten spots that are still accepted match:
max |gain diff| ≤ 1.8e-15, no shove/fold flips. The two spots this round now refuses ([10,0.3,10] and [10,0.5,10])
throw, as designed.

**ICM DP.** 300 random spots: max |mine − code| = 6.9e-16. The fixed cases and bubble factors are unchanged from
round 2.

**M1 store.**
- 10 hands of 27 KB come back as `tooLarge: 10`.
- 9,000 hands of 14 KB give `added: 7303, overCap: 1697`. The file is 104,856,474 bytes, at or under the cap, and
  reloads with status `ok`.
- A file padded over the cap by hand gives `too-large` and refuses writes. The file is untouched.

**m5 junk file.** 1,000 skip records kept, 8,738,133 skips counted by reason, heap grew by 82 MB.

**N4.**
- A store with `storeVersion: 2` in meta plus a line this build cannot parse gives status `newer`.
- `add` returns `refused`. `hands.ndjson` is byte-identical afterwards and meta still says 2.

## Notes (none blocking)

1. **minor: the "newer" copy says Offsuit "only reads" the hands, but it reads none.**
   - `proHands.ts` paint, with `hhStore.ts read()`. For status `newer`, `read()` empties `hands`, so the report
     has 0 hands. The screen then shows both the "No hands imported yet" empty state and "this one only reads them
     and will not add to them".
   - The same happens for `too-large` and `unreadable`: the empty state is visible next to a notice saying the
     hands exist.
   - Fix:
     - Hide `pro-empty` when `stuck`.
     - Either reword "newer" to say the hands are kept as they are and not shown, or read the lines this build can
       still validate for display only (writes stay refused).
2. **nit: the import refusal notice is generic.**
   - A `newer` store answers `refused: 'store-unreadable'`, so the import notice says the file "could not be read
     whole", while the status line correctly says "saved by a newer Offsuit".
   - Fix: carry the status in `refused` (`'newer'`).
3. **nit: N4 holds only while `meta.json` exists, and only if a future build bumps the version.**
   - A store with no `meta.json` reads as version 1 (verified: deleting meta gives status `ok`). Without meta, a
     newer build's store would be rewritten by this one.
   - With version 1 in meta, lines this build cannot parse are still dropped on the next add (verified). That is
     right by the contract, but only if every future change to the line format bumps `STORE_VERSION`.
   - Fix: add one sentence to the DECISIONS.md store line ("change the line format, bump `STORE_VERSION`").
     Optionally, treat an `.ndjson` with no meta as read-only until the user imports or deletes.
4. **nit: the "invalid" copy now names one cause for every refusal.**
   - "you, or a player ahead of another, are already all in from the blinds" is now the message for every
     `invalid`, including out-of-range stacks or payouts sent by something other than this screen.
   - The screen's own inputs can only produce the all-in case, so this is fine in practice.

## B1 holding state (unchanged, still honest)
- `available` is false for both tools.
- A licence holder sees "Coming in an update" (pinned by a spec).
- The licensed specs skip on a reason derived from `FEATURE_INFO`.
- Main serves only licensed calls.

The standing caveat: no screen-level behaviour is verified on this branch. That covers no-scroll at 900x640 and
1100x760, the import flow and the profile staying byte-identical, the ICM screen, and the new `pro-store-status`
layout in the side column at 640 px height. Run the licensed specs with the local flip at both sizes before the
flag ships, and before calling the screens done.

## Pro tools review, round 2 (feat-pro-tools at e9f52bc vs origin/main, HIGH radius)

Re-reviewed the whole branch (`origin/main...e9f52bc`) plus the fix diff `e61b848..e9f52bc` (19 files, +580/−161).
The worktree is clean at e9f52bc.

- `npm run typecheck`: exit 0.
- `npx vitest run tests/unit/pro-*.test.ts tests/unit/profileSchema.test.ts`: 8 files, 137 tests passed.
- No e2e and no repo edits.

VERDICT: FAIL

One new major finding: N1, which the M2 fix introduced. Everything else from round 1 is fixed or acceptably
justified. If N1 is fixed (or refused honestly, see below), I expect PASS WITH NOTES.

## Round-1 findings: status

| # | Round 1 | Status | Evidence |
|---|---|---|---|
| B1 | `available: false`, so the licensed e2e cannot pass | **Justified (holding state)**, see below | Blurb reworded; DECISIONS.md committed; specs gated on `SHIPPED` |
| M1 | Store over cap read as empty, then overwritten | **Fixed** | Repro below |
| M2 | Player all in from the blinds treated as able to fold | **Fixed for a forced player BEHIND live callers; it moved the bug for a forced player IN FRONT of one** | See N1 |
| M3 | Tournament and short-stack hands held to 100bb cash charts | **Fixed** | `leaks.ts`: `chartable` needs cash, no ante, hero ≥ 60bb; spots also need a deep opener or 3-bettor; the method line counts excluded hands |
| m1 | Fold-to-3-bet confounds | **Fixed / justified** | Squeezes and all-in 3-bets skipped; all-in opens skipped for BB defence; the explain sentence states the opening-range assumption |
| m2 | Side pots under 1 bb | **Fixed** | `settle()` matches my independent model exactly (below) |
| m3 | Worker race, no timeout or cancel | **Fixed** | Pending jobs per worker; `retire(w)` nulls `worker` only if it is still `w`; a 60 s timeout ends the worker; solves coalesced; validated in main first |
| m4 | Stale byte budget, synchronous reads | **Fixed** | `readPicked` is async, the budget is the remainder, and `bytes` is what was really read |
| m5 | Skip-object amplification | **Fixed** | Repro below |
| m6 | Clear during an import | **Fixed** | `clear` returns `busy` while `importing` |
| m7 | Unhandled rejections | **Fixed** | Import and clear both `.catch` and show a notice |
| m8 | Doctored lines, `meta.json` | **Fixed** | `cleanHand` keeps known keys only; `meta()` checks `lstat`, regular file and ≤ 4 KB; store lines over 16 KB skipped before `JSON.parse` |
| m9 | Picker on Windows and Linux | **Fixed** | Not macOS: `openFile` only |
| n1 | CSS literals | **Fixed** (mostly) | rgba replaced by `--ink-2`; radii use `--r-xs`; `--h-lg` for heights. A few px remain (18/8/10/14 px marks, `3px` swatch radius): nit |
| n2 | Practise button | **Justified** | Relabelled "Open the charts", which matches what it does |

## Reruns

### M1: the store with long hands (/tmp/prorev/store2.ts)
- **Oversized hands:** ten 27 KB hands (385 actions) give `{added: 0, tooLarge: 10}` (`MAX_HAND_BYTES` = 16 KB).
- **Byte cap:** 9,000 hands of 14 KB give `{added: 7303, overCap: 1697}`. The file is 104,856,474 bytes, under
  `MAX_STORE_BYTES` (104,857,600). A fresh store reads 7,303 hands with status `ok`. Took 233 ms.
- **Over-cap file:** padded past the cap by hand, the store opens with `count 0, status too-large`.
  - `add` returns `refused: 'store-unreadable'`.
  - The file is byte-for-byte untouched.
- Data loss: fixed.

### M2: [10, 10, 0.8], BTN shoves, BB all in for 0.8 (/tmp/prorev/pf4.ts)
- Top 10% callers: push 29.3%, 72o gain −0.589 bb. The BB is forced to 100%. That matches my round-1 forced-in
  answer exactly.
- Equilibrium: push 24.1%, SB calls 14%, BB 100%.
- Fixed for this spot.

### m5: 25 MB junk file of `"x\n\n"`
- 744 ms; 1,000 skip records kept; `skipCounts {"unknown-site": 8738133}`.
- Heap grew by 82 MB, down from 600 MB.
- Fixed.

### `settle()` side pots, against my independent layered-pot model (/tmp/prorev/pf2b.ts)
- My model: ante dead, blinds capped by stack, a folder's money above an all-in's match returned to whoever covers
  it. It shares no code with `settle()`.
- Compared per-class hero gain, with forced callers given a full range in both models. Max |diff| ≤ 4e-15 and no
  push flips on every spot:
  - [12,8,20,15] with ante 0.125, chips and ICM, heroes on three seats;
  - [5,30,10,7,9,12] ICM with ante 0.1;
  - [10,10,0.8] chips and ICM;
  - [10,0.3,10] (round 1 differed by 0.0565 bb here; now exact);
  - [10,0.5,10] with ante 0.125;
  - [10,6,0.7,12] ICM;
  - [0.9,10,10].
- A hero all in from the posts (`[10,10,10,0.1]`, ante 0.5) now throws `hero is already all in`.

## New findings

### N1. major: a forced (all-in) player in front of a live caller ends the action, so everyone behind it is ignored
- `src/core/pro/pushFold.ts:89-91` (`forced`), `:298-299` (forced range set to all ones), `shoveGains`
  `:205-219`.
- `reach *= 1 − pCall`. A forced caller's range is all ones, so its `pCall` is exactly 1 and `reach` becomes 0 for
  every later seat. The one-caller model then says "the forced player called, so everyone after folds". But a
  player all in from the small blind has made no decision. The big blind behind it still chooses to call or fold
  hero's shove.
- Repro: stacks [10, 0.5, 10], BTN shoves, SB all in for 0.5, BB 10 deep.
  - BB calling top 5% and BB calling 100% give the identical answer: push 100%, 72o gain +0.519 bb.
  - In equilibrium the screen shows the BB "calling 69.5%", a range that has no effect on anything.
  - In reality a 72o shove into a 10 bb BB that can call is far from +0.5 bb. The more the BB calls, the worse it
    gets (three-way, with 10 bb at risk against the BB).
- Reachable from the UI. Stack inputs go down to 0.5. Set the SB to 0.5 in the "Three left" preset (ante 1/8: the
  ante plus 0.375 puts it all in), or the SB seat in "Bubble".
- Round 1's M2 was a forced player BEHIND the live callers, and that is now right. This is the same root cause in
  the other seat order, introduced by the fix.
- The header (`pushFold.ts:20-21`) and DECISIONS.md describe only the "earlier caller calls, forced money dead"
  case, so the docs do not admit this one.
- Fix: there is no three-way equity, so the honest options are:
  - (a) refuse the spot as `invalid` with a message ("a player all in from the blinds with someone left to act
    behind it is a three-way pot this model doesn't price"); or
  - (b) model a forced player as always in the showdown without consuming `reach`, which needs three-way equity
    the table does not have.
- Do (a) in `parseShoveRequest` (so the screen shows "That spot cannot happen…"-style copy, reworded) and in
  `shapeOf`. Pin it with a test: SB forced with a live BB behind gives `invalid`.

### N2. minor: a hero all in from the posts comes back as "Could not work this spot out", not `invalid`
- `analysis.ts` `parseShoveRequest` still accepts `{stacks:[10,0.3,10], hero:1}` (verified). The refusal is a
  throw in `shapeOf`, inside the worker. The worker posts `ok:false`, `shove()` maps that to `{failed:true}`, and
  the screen shows the generic failure.
- DECISIONS.md says such a hero "is refused".
- Fix: apply the same posted-stack check in `parseShoveRequest` and return `null`, so the reply is
  `{invalid:true}`. Put N1's refusal in the same place.

### N3. minor: an over-cap or unreadable store is a dead end in the UI
- The `too-large` state is protected on disk. But:
  - the worker's report sees 0 hands, so the screen says "No hands imported yet";
  - the Delete button is hidden whenever there are no hands (`proHands.ts` paint: `clear.hidden = !has`);
  - the refusal notice tells the user to "Delete imported hands to start over", which they cannot do from the UI.
- This build cannot reach the state by itself any more (`add` never writes past the cap). It can be reached through
  a read error (`unreadable`), a hand edit, or a future build with a larger cap.
- Fix: return `store.status()` with the report, show "The imported-hands file could not be read; it was left as it
  is", and keep Delete visible in that state.

### N4. minor: the store silently drops lines a newer build wrote
- `hhStore.ts:234-245`. A line that fails `isParsedHand` (a new site, a new action kind) or carries new keys is
  dropped or stripped on read. The next `add` rewrites the file without it.
- There is no version on the store. A newer build's hands are lost the first time an older build imports.
- This is the profile-schema rule ("an older build never overwrites a newer value"), applied to a file that is
  outside the profile but just as much the user's data.
- Fix: keep unparsed lines verbatim in `lines` (count them, don't analyse them), or put a `v` in `meta.json` and
  open read-only when it is newer.

### N5. nit
- DECISIONS.md, the ICM line, still says "Malmuth-Harville by exact enumeration". A later line says "ICM is a
  subset DP". Edit the line rather than add another; the record says "edit the line, do not append history".
- The job timeout clock starts at `post`, so it includes time spent queued behind other jobs. That is harmless
  with coalescing, as worst cases are ~2 s per solve.

## B1 holding state: honest and consistent?
Yes, with one caveat.

What holds:
- A licence holder sees "Included in your Pro. Coming in an update." (`proGate`), and a new spec pins it.
- The two licensed specs skip with a stated reason derived from `FEATURE_INFO` itself, so a flip un-skips them
  automatically and they cannot silently stay skipped.
- Main still serves the gated IPC to a licence holder. That is consistent with "main is the only authority", since
  the Pro user is paid up, and nothing is reachable without a licence (spec 1).
- The blurb no longer promises "costliest". DECISIONS.md records the hold and why.

The caveat:
- With the flag held, NO screen-level behaviour of this branch is verified: no-scroll at 900x640 and 1100x760, the
  import flow, the profile byte-identity after an import, and the ICM screen.
- The merge must not be described as "screens verified". The licensed specs have to run with the local flip, at
  both sizes, before the flag ships.
- N1 is reachable only through the ICM screen, so it is latent while the flag is held. It still has to be fixed
  before the flip.

## Independent ICM check (subset DP)
My Malmuth-Harville is an independent recursion over finishing orders; just-busted players take the next places,
split evenly. Against the new DP in `icm.ts`:
- **The round-1 fixed cases** ([50,30,20], [27,13,6,14], 5-, 6- and 10-player, one and two just busted, two-place
  payouts) all agree to ≤ 4.3e-15.
  - Example: [50,30,20] with [.5,.3,.2] gives .383929 / .327500 / .288571 from both.
  - [27,13,6,14] gives .354201 / .249743 / .135530 / .260526 from both.
- **300 random spots** (2 to 8 players, about 12% zero stacks, 1 to n paid places, random payouts): max |mine −
  code| = 6.9e-16.
- **Bubble factors** are unchanged from round 1 and still match mine to 5 decimal places: 1.34783, 1.08917,
  1.63060, 1.29356, 1.38044, 1.33347; heads-up winner-take-all gives 1.
- **The DP's correctness argument holds.** Masks are visited in increasing order and every successor has a larger
  mask, so `reach[mask]` is complete before it is expanded. `left` and `count` depend only on the mask.
- **Speed:** 10 players with 10 paid takes 0.03 ms per call (100 calls in 3 ms). A full 10-handed equilibrium
  request went from 4.8 s to 1.6 s.

The push-fold sanity results from round 1 still stand. Heads-up 10 bb gives SB 58.4% / BB 37.3%. The BB call
threshold against any two is exactly (S−1)/(2S); the code path it goes through is unchanged.

## Pro tools review, round 1 (feat-pro-tools vs origin/main, HIGH radius)

Reviewed: e61b848 and 2746486, `git diff origin/main...HEAD` (48 files, +6993). Also noted: the worktree has an
uncommitted `DECISIONS.md` edit, and an ignored, untracked `tests/tmp/pro-preview.ts`.

VERDICT: FAIL

Run: `npx vitest run tests/unit/pro-*.test.ts` gave 7 files and 113 tests, all passing. `npm run typecheck` exits 2,
but only on the ignored local file `tests/tmp/pro-preview.ts` (8 errors). The committed tree has no type errors.
e2e and Playwright were not run, as instructed. So no-scroll at 900x640 and 1100x760 is NOT verified here.

## Findings

### B1. blocker: both features are still `available: false`, so a Pro user never reaches either screen and the committed e2e cannot pass
- `src/core/entitlements/features.ts:58-69` (unchanged by the branch) and `src/renderer/pro.ts:266-268`.
- With a valid licence, `proGate` returns "Included in your Pro. Coming in an update." and does not call
  `render()`. `renderProHands` and `renderProIcm` are unreachable in the shipped app.
- `tests/e2e/pro-tools.spec.ts` specs 2 and 3 expect `pro-empty`, `pro-import`, `pro-cell` and so on after
  `activatePro`. They time out at the first locator. The spec has evidently never run: there is no
  `test-results/pro-tools-shots`.
- That also means the Done criterion (screenshots of the running app at both sizes) cannot be met.
- The uncommitted DECISIONS.md line says `available` stays false on purpose. If that is the decision, the spec and
  the screens contradict it. Either way the branch is not consistent.
- The blurb at `features.ts:61`, "see your costliest patterns", contradicts D10. leaks.ts says: no "costliest" by
  money. The upgrade sheet shows this copy.
- Fix: pick one.
  - Ship it: set `available: true`, then rerun the e2e at both sizes.
  - Keep it hidden: add an explicit e2e/dev override (main-authorised, not renderer state), or mark specs 2 and 3
    as pending with the reason in DECISIONS.md.
  - Either way, reword the blurb (e.g. "see where your frequencies leave the charts") and commit the DECISIONS.md
    section.

### M1. major: data loss. The store can grow past `MAX_STORE_BYTES`; the next read sees zero hands and the next import overwrites the whole store
- `src/main/hhStore.ts:31-32,171-172,200-224`.
- `add()` caps hands (50,000) but never bytes. `read()` silently returns `[]` when the file is over 120 MB.
- A valid hand can be about 27 KB: up to 400 lines, about 390 actions. Every one passes `isParsedHand`.
- Reproduced in /tmp/prorev/store.ts:
  - 6,001 such hands give a 164 MB `hands.ndjson`;
  - a fresh `createHandStore` sees `0` hands;
  - the next `add` of one hand rewrites the file to 27 KB. 6,000 hands are gone without a word.
- About 35 MB of hostile or synthetic files (or a long run of unusually long tournament hands) gets there.
- At the hand cap, `next.map(JSON.stringify).join('\n')` reaches about 1.4 GB, past V8's maximum string length.
  `add` then throws `RangeError` after the parse, on main's thread.
- Fix: cap bytes, not just hands.
  - Reject a hand whose JSON is over a few KB, or cap actions at e.g. 120.
  - Track the running byte size in `add` and count anything past the budget as `overCap`.
  - On a read that hits the size cap, open the store read-only (refuse writes, surface a notice) and never treat
    "too big" as "empty".
  - Stream the write (`fs.writeSync` per line to the temp file) instead of building one giant string.

### M2. major: push-fold treats a player who is already all in from the blinds or ante as able to fold, so the fixed top-N% caller model gives badly wrong charts, and the UI can reach it
- `src/core/pro/pushFold.ts:75-79` (callers), `:95-98,142-153` (callerFold = noCall), `:172-199`.
- Any seat behind hero with `after[j] === 0` (stack ≤ posted) is still a "caller". With a fixed range it "folds"
  most of the time, and hero is credited the dead chips uncontested. In reality it is a forced showdown.
- Reproduced (/tmp/prorev/pf3.ts): stacks `[10, 10, 0.8]`, hero on the BTN, BB all in for 0.8, callers top 10%.
  The code says shove 100% of hands; 72o's gain is +0.49 bb. With the BB correctly forced in, it is −0.59 bb and
  the shove range is 29%.
- The ICM screen allows stacks from 0.5 (`proIcm.ts:293-300`) with presets of 6 bb. Setting the BB to 0.5 to 1 bb
  with "Top 10%" reaches this.
- The equilibrium mode happens to call 100% (fold leaves the stack at 0), so it is right by accident.
- Also related: hero with stack ≤ posted (e.g. SB with 0.3, accepted by `parseShoveRequest`) gets a "push"
  chart for a spot with no decision.
- Fix:
  - In `shapeOf`, mark callers with `after[j] <= 0` as forced: calling range of all ones, never updated by fictitious play.
  - Refuse (`invalid`) a hero with `stacks[hero] <= posted[hero]`.
  - Add a test: BB all in from the blind, fixed range, push range equals the forced-call answer.

### M3. major: the leak finder holds tournament and short-stack hands to 100bb cash charts, with no depth or game filter
- `src/core/pro/leaks.ts:162-221,233-259`. `factsOf` and `leakReport` never read `hand.game`, stacks or `ante`.
- A tournament player at 15 to 25 bb defends the BB much wider with antes, and opens or shoves differently. At
  hundreds of hands the bands are narrow, so the gates (n ≥ 20, 15 points, band clear) fire. The report then calls
  correct short-stack play a "leak".
- The Pro tab pairs this with an ICM tool, so tournament imports are the expected case. The fixtures include
  tournaments on all three sites.
- Fix:
  - Count only hands whose effective stack (hero against the opener, or hero against the table for opens) is at
    least about 60 to 80 bb and with no ante, or report tournament and short-stack hands separately.
  - Say so in the method caption.

### m1. minor: fold-to-3-bet is conditional on the chart's opening range, but hero's number is conditional on hero's own
- `leaks.ts:90-95,199-203`.
- The chart number is `folded∩RFI / RFI`, which is the right construction. But hero's observed rate depends on
  hero's actual opening range. A player who opens wider than the chart should fold more to 3-bets.
- The spot also mixes:
  - 3-bet shoves from short stacks,
  - squeezes (callers between),
  - in-position against out-of-position 3-bettors.
- The two "leaks" (open too wide, fold to 3-bet too much) can be one leak counted twice.
- Fix:
  - Only read the fold-to-3-bet gap when the matching open spot is in line.
  - Or say in the explain sentence that it assumes the chart's opening range.
  - Exclude spots where the 3-bet was all in, or where someone called between.
  - The same sizing and all-in caveat applies to `bb-defend` (an open-shove is not a standard open).

### m2. minor: side pots are wrong when a caller's stack is below other players' posted money
- `pushFold.ts:101-112`. `dead` is given whole to the winner even when the winner could not match it.
- Example: SB with 0.3 total, BB folds its 1.0. The code gives the SB 1.6 when it wins; the real main pot is 0.9.
- The same applies to an ante bigger than a stack: `parseShoveRequest` accepts a 0.1 stack with ante 1.
- Only reachable with stacks under 1 bb. Fix: cap each folder's dead contribution at the all-in amount, for the
  main pot; the excess goes to hero's side pot. Or refuse stacks below 1 bb plus ante.

### m3. minor: worker lifecycle races and no timeout or cancel
- `src/main/proTools.ts:52-66`. `'error'` and `'exit'` both call `failAll`, which nulls `worker` unconditionally.
- If a new job arrives between the old worker's `error` and `exit`, a new worker `w2` is created. Then the stale
  `exit` rejects `w2`'s pending jobs and orphans `w2`: a leaked thread, results dropped.
- Fix: guard with `if (worker === w)` and reject only that worker's jobs.
- There is no per-job timeout and no cancellation:
  - A 10-handed, 10-paid equilibrium request takes 4.8 s in the worker (measured), and two solves run per request.
  - Each stack edit queues another one. `generation` in `proIcm.ts:396` drops stale answers but not the work,
    so N edits mean N×5 s of "Working it out…" and imports queue behind them.
- Fix: coalesce shove jobs (keep only the latest pending), validate in main before posting, and add a timeout that
  terminates and recreates the worker.

### m4. minor: the import's byte budget uses stale `lstat` sizes, and main does all reading synchronously
- `proTools.ts:106-118` adds `f.size` from `expandPicked`'s `lstat`, not the size `readPicked` actually read
  (from `fstat`).
- A file that grows between pick and read is still capped at 25 MB, but the 200 MB per-import budget is not
  enforced: up to 400×25 MB.
- Up to 200 MB is read with `readSync` on main's thread (UI stalls), then cloned to the worker, so it sits in
  memory twice.
- Fix: count `Buffer.byteLength` or the fstat size returned by `readPicked`. Read in the worker (main already
  vetted the paths, so pass `PickedFile[]`).

### m5. minor: hostile-input memory amplification in the parse
- `src/core/pro/parse.ts:47-58`. Every non-blank block that no site claims adds a `{id, reason}` object.
- A 25 MB file of `"x\n\n"` gives 8.7M skip objects and about 600 MB of heap in the worker (measured, 0.9 s).
- Eight such files run one after another. It probably survives, but it is 24× amplification.
- Fix: count reasons in `parseHandHistories` instead of pushing one object per skip (the worker only counts them
  anyway). Or stop pushing after e.g. 10,000.

### m6. minor: imports and deletes can interleave
- `proTools.ts:123,138-141`. `clear()` during an in-flight import empties the cache; the import's `store.add`
  then writes the new hands. Hands appear right after "Imported hands deleted".
- Fix: refuse `clear` while `importing` (return `busy`), or drop the import result if a clear happened.

### m7. minor: error paths reach the renderer as unhandled rejections
- `proHands.ts:326` (`proImportHands` has no `catch`) and `:357` (`proClearHands`).
- A worker crash, a disk-full `atomicWrite`, or a thrown `rmSync` leaves the button re-enabled with no notice.
- Fix: catch, and show "Import failed; nothing was changed".

### m8. minor: hand-edited store and meta files
- `hhStore.ts:182,234-235`.
  - `isParsedHand` accepts extra keys, so a doctored line keeps arbitrary fields (names, money, megabyte strings).
    They are rewritten on every `add`.
  - `meta()` does `readFileSync(metaFile)` with no `lstat`, regular-file or size check. A FIFO or a link to
    `/dev/zero` at `meta.json` hangs or OOMs the worker, and with it every later Pro job.
  - Both need same-user write access to userData.
- Fix: rebuild each hand from the known keys only. Give meta the same `lstat`/size check as the store.

### m9. minor: the open-or-folder dialog is macOS-only
- `proTools.ts:96`. `['openFile', 'openDirectory']` together makes Windows and Linux show a folder-only picker.
  Electron documents this.
- If those platforms are ever built, single-file import is gone. Fix: two buttons, or by platform.

### n1. nit: CSS has colour literals and orphan sizes in a screen sheet
- `styles-pro-tools.css`:
  - `rgba(255,255,255,.5/.6)` at lines 159, 241, 291;
  - `border-radius: 4px` at 115 and 189 (should be `var(--r-xs)`);
  - `3px` at 249 and `1px` at 184;
  - `height: 36px` and `min-height: 46px/40px` instead of `--h-*`.
- Older sheets do the same, but AGENTS.md says no literals or orphan sizes.

### n2. nit: other small issues
- `main.ts` `onPractise: () => { tab = 'charts' }` ignores the spot's position, so "Practise this chart" does not
  open the chart for the spot.
- The ICM busted-player convention splits places evenly when two bust at once. The common convention gives the
  bigger starting stack the higher place. It never matters inside push-fold, where at most one player busts per
  outcome. Document it, or order by stack.
- 9-max: LJ and UTG+1/UTG+2 all use the 6-max UTG chart (documented). Real 9-max UTG is tighter. That is fine
  under the 15-point gate, but say so in the method line.
- `DECISIONS.md` is edited but not committed; the branch carries no decision record.
- The stored hands do contain money: stacks and blinds in currency hundredths. DECISIONS.md says "no money". It is
  never shown, but reword it ("no results").

## What I checked and found sound
- **Paths.** The renderer can name no path. `preload` exposes four no-path calls, and import reads only
  `dialog.showOpenDialog` output. A folder gives its top-level `.txt` files only. Links are skipped at expansion,
  `O_NOFOLLOW` plus `fstat` is used at open, and size is re-checked on the open handle. A FIFO is rejected by
  `lstat` (only a contrived lstat-to-open swap could block on `openSync`).
- **Gating.** `pro:importHands`, `pro:handsReport` and `pro:shove` are wrapped in `gated()`, and the licence is
  checked before any dialog or worker job. `pro:clearHands` is ungated, as intended. The shove argument is fully
  validated in `parseShoveRequest`: finite numbers, ranges, integer seats, hero not BB, payouts summing to 1,
  ≤ 10 players.
- **ReDoS.** Every regex is bounded or anchored, and lines over 400 characters are rejected before any regex.
  A 25 MB single line parses in 3 ms. Header spam (25 MB) takes 207 ms; a lone-CR file takes 570 ms.
- **Prototype pollution.** `JSON.parse` `__proto__` creates an own key only, and all count maps use fixed enums.
- **Earns nothing.** No pro module imports progression, session or story. The store is outside the profile. The
  renderer screens never save. No dependency, network or schema change.
- **Leak finder.**
  - 6-max positions are right (BTN/SB/BB/CO/HJ/UTG).
  - Limps and cold-calls exclude defend spots (squeeze spots are excluded).
  - 3-bet detection (`raises === raisesAtHeroOpen + 1` on hero's next action) is right.
  - The BB-defend chart is the unconditional share, which is right for a randomly dealt BB.
  - Fold-to-3-bet is conditional on the opening range (yes: `folded∩RFI / RFI`).
  - Clopper-Pearson by bisection, and the gates match reads.ts.
- **Push-fold.** `outcomes()` is right for all normal spots: dead money, blinds, antes (equal antes cancel inside
  `matched`), the uncalled excess returned, and hero folding giving everything to the BB. My independent
  side-pot model matched the code to 0 on five spots (4 to 6 handed, antes, ICM and chips). It differed only for
  stacks under 1 bb (m2).
- **One-caller probability accounting.** `reach × pCall` with `pCall = Σ COMPAT·range / (size·1225)`, conditioned
  on hero's class. It is exact within the stated model; card removal between callers is ignored, as documented.
- **Equity table spot checks.** Against any hand: AA 85.21%, 72o 34.59%, 32o 32.30%, AKs 67.05%, all right.
  AA vs KK is 82.31% (true ≈ 82.2%, inside Monte Carlo noise at 100k samples).

## Independent ICM check
My own Malmuth-Harville (/tmp/prorev/icm.ts): recursive over remaining players, then busted players take the next
places, split evenly. It shares no code with `icm.ts`.

| Stacks | Payouts | Mine | Code | max diff |
|---|---|---|---|---|
| 50,30,20 | .5,.3,.2 | .383929 .327500 .288571 | .383929 .327500 .288571 | 0 |
| 27,13,6,14 | .5,.3,.2 | .354201 .249743 .135530 .260526 | same | 0 |
| 40,25,15,12,8 | .5,.3,.2 | .325231 .252376 .175752 .145565 .101076 | same | 0 |
| 3000,2500,2000,1500,1000,500 | .4,.3,.2,.1 | .244562 .222348 .194878 .160222 .115880 .062110 | same | 0 |
| 10..1 (10 players) | 9 places | .146093 … .030970 | same | 0 |
| 20,0,10 (one just busted) | .5,.3,.2 | .433333 .200000 .366667 | same | 0 |
| 20,0,0,10 (two just busted) | .5,.3,.2 | .433333 .100000 .100000 .366667 | same | 0 |
| 20,0,10 | .65,.35 | .55 0 .45 | same | 0 |

A hand check of [50,30,20] for player 1: .5·.5 + (.3·50/70 + .2·50/80)·.3 + (rest)·.2 = .3839. It matches.

Bubble factors (mine / code): [50,30,20] 20-stack vs 50-stack 1.34783 / 1.34783; 50 vs 20 1.08917 / 1.08917;
[27,13,6,14] 6 vs 27 1.63060 / 1.63060; 27 vs 13 1.29356 / 1.29356; [40,25,15,12,8] 8 vs 40 1.38044 / 1.38044;
25 vs 15 1.33347 / 1.33347. Heads-up winner-take-all: 1, as expected. Chip EV (no payouts): null, as designed.

"Just busted takes the next place": verified. A 0 stack gets the places after the live players, and two at once
split them evenly (see n2 for the tie-break convention).

### Push-fold sanity
- **Heads-up chip EV Nash (fictitious play, 2,000 rounds).**
  - 10 bb: SB shoves 58.4%, BB calls 37.3%, exploitability 6.7e-4 bb a hand. That matches the reference
    ≈ 58% / 37%.
  - 5 bb: 71.5 / 62.1. 15 bb: 45.7 / 28.5. 20 bb: 40.2 / 21.8. All plausible.
- **BB call threshold against any two.** For S = 10, 4 and 20, `callGainsFor` equals my 2S·eq − (S−1) exactly
  (max diff 0, no sign flips), so the threshold is (S−1)/(2S): 0.45, 0.375, 0.475.
- **outcomes() and chips/ICM stacks:** see "found sound" above. Exact, except m2 (stacks under 1 bb) and M2
  (players all in from the blinds treated as able to fold).
