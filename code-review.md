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


- `npx tsc --noEmit -p tsconfig.json`: exit 0. `npx vitest run`: exit 0, 96 files, 2230 tests.
- A scratch vitest probe (outside the repo, since deleted) reproduced the wrong-side Price held lines and the `ph-late-2`-on-turn pick, and confirmed the settings preview grades. A node one-liner confirmed the negative `(Date.now() >> 10) % 5` window.
- e2e was not run, as instructed. These are unexercised:
  - Price held on the wrong side.
  - Per-action repeat claims.
  - The perch blink cadence.
  - Live-region announcements in the dialogue.
  - The tab bar's fit at 900 px with the perch (spacing.spec #13, layout.spec #3).
  - The beat plus an ended-sitting dock at 900x640 (rebuy, swept-table, session-plan-start).
- This branch touches the engine-adjacent `coach.ts`, the table, the app shell and the profile, so AGENTS.md calls for `npm run test:full` on the final commit.


## Resolution (author)
- Act on 1 fixed: `isPriceHeld` requires the right side of the price (a call or raise at or above it, a fold below it); unit tests cover a 31%-vs-33% call and the fold mirror.
- Act on 2 fixed: `{repeat}` counts the same kind of mistake (principle, action group, priced or free) via `DeeSitting.byKind`; the summary still ranks by principle.
- Act on 3 fixed: `po-call-s5` says "few cards left"; `ph-late-2` no longer claims no cards are to come.
- Act on 4 fixed: the blink cycle index is `Math.floor(Date.now() / 1024) % 5`.
- Act on 5 fixed: one persistent polite `dialogue-announcer` announces each new turn; the thread is a plain list. Focus moves to the first open option after a commit, or to the reveal at the end (dee.spec #4 asserts both).
- Consider, fixed: Character off drops Dee's own lesson lines (open/retry/done) and keeps the script's questions; every close price that held counts toward the summary; G4 lines say "The action held" instead of "Right move"; the unbacked claims (`ld-5`, `ld-6`, `ph-1` "called", `ph-3` "the price as the reason", `rg-raise-s2`, `rg-allin-s1`, `se-clean-*` "half a big blind") are reworded; the lint bans `you are/you're` and `half`, and checks number words in dialogue lines; the settings preview runs its spot through `isPriceHeld`; one `MAX_DEE_SAID`; the nav spacer keeps the strip centred with Character off; the "Mistakes only" caption names the G4 case.
- Consider, kept: an open-ended table that is left mid-way gets no session summary (DECISIONS.md, Open question in FINDINGS.md). `frequencyOf` and `effectiveFrequency` both exist: one is the engine's typed reader, the other the persist module's; merging them would make core/dee depend on persist for a one-line map.

## Re-verification (reviewer)
Checked `git diff ce37308..9b63ff8` (f9da512 + 9b63ff8). `npx tsc --noEmit -p tsconfig.json`: exit 0. `npx vitest run`: exit 0, 96 files, 2234 tests. e2e not run, as instructed.

- Act on 1 (Price held on the wrong side): **VERIFIED.** engine.ts `isPriceHeld` now returns false for a fold with `had >= needed` and for a call or raise with `had < needed`, before the closeness test. dee-engine.test covers the 31%-vs-33% call, the 36% fold and the 30% fold that holds. The settings preview's call (had .306, needed .25) is still on the right side.
- Act on 2 (`{repeat}` label): **VERIFIED.** `DeeSitting.byKind` is keyed by principle, action group (bet/raise/allin together) and priced/free, and `handEndEvent` reads `{repeat}` from it. `byPrinciple` still drives only the session summary's top principle. I re-checked every r-line against its kind: `po-call-r1/r2` (pot odds, call, priced), `po-fold-r1/r2`, `vb-free-r1/r2` (fold, free), `vb-check-r2`, `vb-lead-r1/r2` (raise group, free), `rg-raise-r1/r2`. Each line's wording now matches what it counts. The generic `v-noted-2` ("Same principle as earlier") is still true. A unit test covers fold then call (repeat 0) and fold then fold (repeat 1).
- Act on 3 ("no cards left" on the turn): **VERIFIED.** `po-call-s5` (all three tones) says "few cards left", and `ph-late-2` now reads "Late in the hand the price carries more of the decision." Both are true on the turn and the river.
- Act on 4 (perch blink index): **VERIFIED.** `Math.floor(Date.now() / 1024) % 5` is never negative for any positive timestamp, so the delay is always one of the five cycle values.
- Act on 5 (dialogue live region): **NOT FIXED. It moved, but the same failure remains.** lesson.ts:197 mounts `dialogueAnnouncer` as a child of `root` through `root.replaceChildren(renderLessonView(...), railSeam(), dialogueAnnouncer)`, which runs on every render. `replaceChildren` removes the node and re-inserts it each time. In the commit handler (lesson.ts ~554) the text is set *before* `render()`, so the region is detached and re-attached with its content already in place. That is the "inserted with content" case this item was about, and it is not reliably announced. Two related problems:
  - Every later option pick re-inserts it still holding the previous reply, which can re-announce that reply.
  - The list view (`root.replaceChildren(renderList(), railSeam())`) drops the region entirely.

  dee.spec #4 checks only `toHaveText` and the `aria-live` attribute, not that the node survives a render. Fix: mount the announcer once, outside the subtree `render()` replaces (for example, a stable wrapper whose content child is the repainted part, which is how the table's announcers sit on `root` beside the repainted stage). Or set the text *after* `render()` and stop re-inserting the node: append it once and repaint a sibling container. Add an e2e or DOM check that the same announcer node (`isSameNode`) is still connected after an option pick and after a commit.
  - The focus half of this item is **VERIFIED.** After a commit, focus goes to the first enabled option, or to the reveal (`tabIndex = -1`), and dee.spec #4 asserts both.

Spot-checked Consider fixes:
- Character off drops the bank's lesson-open/retry/done lines (`bankLine` returns null). VERIFIED.
- `priceHeld` counts every held spot regardless of frequency. VERIFIED.
- The G4 lines are reworded. VERIFIED.
- `MAX_SAID` is removed. VERIFIED.
- The nav spacer is restored to 92px with Character off. VERIFIED.

One note on the "kept" rationale: engine.ts now imports `MAX_DEE_SAID` from `progression/persist.js`, so core/dee already depends on persist. That weakens the stated reason for keeping `frequencyOf` and `effectiveFrequency` separate. Still Consider, not blocking.

## Resolution of re-verification item 5 (author)
- The dialogue announcer is mounted once and never detached: `paint()` in lesson.ts repaints every other child and leaves the region in place (the list view keeps it too). dee.spec #4 tags the node and asserts the same node is still connected after a pick, a commit and the last step.

### Re-verification of item 5 at 183a021 (reviewer)
I checked `git diff 9b63ff8..183a021` (lesson.ts and dee.spec.ts). `npx tsc --noEmit -p tsconfig.json`: exit 0. `npx vitest run`: exit 0, 96 files, 2234 tests. e2e not run, as instructed.

- Act on 5 (dialogue live region): **VERIFIED.** `paint()` removes every child of `root` except `dialogueAnnouncer`, prepends the new content, and appends the announcer only when it is not already a child. That happens once, on the first render (the list view), and it is never detached afterwards. Both the list and the lesson branch of `renderInner` go through `paint()`, and no other `replaceChildren` on `root` remains. The commit handler sets the text before `render()`, which is now fine, because the region stays connected and the mutation lands in a live, mounted region. A later option pick does not change the text, so it does not re-announce.
- Noted, not blocking:
  1. The `__dee` tag in dee.spec #4 proves node identity and connection, but not "never detached". A detach-and-reattach of the same node would keep the tag. The code is right today. A MutationObserver on `root` (childList) that flags any removal of the announcer would make the spec pin it.
  2. The announcer keeps the last reply's text when the learner moves to another lesson or example. It is silent, because nothing changes it, but clearing it on `openLesson` or an example switch would keep the a11y tree tidy.

Final: all five Act-on items are VERIFIED. **Verdict: PASS WITH NOTES.** The notes are the remaining Consider items above: no summary for an open-ended table left mid-way (owner-deferred), the duplicate frequency normalizers, and an unverified 900 px tab-bar and ended-dock fit. Before merge, AGENTS.md calls for `npm run test:full` on the final commit, because this change has a high blast radius.
- At f9e75c2, after deleting my temporary files:
  - `npm run typecheck` exits 0.
  - `npx vitest run --exclude tests/unit/perf.test.ts` exits 0, with 88 of 88 files and 1852 of 1852
    tests passing.
- Temporary tests, now deleted:
  - D1 to D5 for foldAbsent: consecutive leavers, an all-in leaver, a side pot (the D3 run was redone with
    a legal all-in after a harness misstep in my own script), pending, and the dealer seat.
  - E1, E1b and E2 for seatedAt.
  - F for the guard `k` and fifty-fifty rules.
- Not run: e2e and Electron.
- Untested by the branch's suite: a leaver who is all-in and wins (their chips disappear at the next
  deal); side pots with an auto-fold; and the guard's `k` card-text cases (only "fifty-fifty" was added to
  guard.test.ts).

- `npx tsc --noEmit -p tsconfig.json`: exit 0. `npx tsc --noEmit -p tsconfig.main.json`: exit 0.
- `npx vitest run`: 1852 of 1853 pass. The one failure is perf under load (see Noted).
- Red-first: I extracted origin/main into /tmp and ran d635155's `profile-roundtrip.test.ts` and `localDay.test.ts` there. 3 of 3 fail, each on the asserted behaviour (key dropped; UTC buckets). HEAD's version of localDay.test fails on main only because the import is missing, which is expected for the implementation version.
- Scratch tests in /tmp/hd (an extract of HEAD): fake ENOSPC rotation (backups lost), the sweep pattern miss, and `reps(bankroll)` compiling.
- Not run: e2e and Electron, as instructed. Still untested: the renderer's handling of thrown saves, backup rotation under ENOSPC, the snapshot temp sweep, a newer build's second instance, and `systemDayKeyOf` across DST.

## Author response (fixed in the next commit)
| Finding | Outcome |
|---|---|
| Save that throws shows no banner | Fixed: `save` returns `{saved:false, failed}`; the renderer also catches IPC rejection and shows "Not saving" until a save lands. Test: store.test "a write that fails". |
| `chalk(bankroll)` compiles | Fixed: the constructors take `Unbranded`; 4 new `@ts-expect-error` mint cases. |
| Full disk wipes backups | Fixed: temp file written before rotation. Test: backups byte-identical after 3 failed saves. |
| mtime/size guard could misfire | Fixed: a changed stamp stops saving only if the sha256 differs. Test: "a file touched but not changed". |
| Snapshot temps never swept | Fixed: the sweep matches `.pre-vN.<uuid>.tmp`. Test updated. |
| Re-upgrade takes no new snapshot | Kept by design: the first copy is the untouched original, and the rolling backups hold the later v1 file. Pre-v2 Delete leaving `.pre-v2`: cannot change old builds; noted. |
| DST test does not call `systemDayKeyOf` | Not changed: the real function depends on the machine timezone. The per-timestamp lookup is tested through `dayKeyAt`, and `systemDayKeyOf` is checked against `Date`. |
| PROFILE_SHAPE drift test is one-way | Not changed: the dangerous direction (serialize writes an unlisted key) is the one tested. An extra listed key only stops a carry. |

## Re-review at ba7ba94
Both blocking items are fixed, and I have no new blocking findings. I tested the fixes on an extract of ba7ba94 in /tmp/hd2, using scratch tests that fake ENOSPC on `writeFileSync`, `copyFileSync` and `renameSync`.

- **(1) Renderer save wrapper (main.ts:248-266): fixed.** `save()` no longer throws: a failed write returns `failed: 'write'`, a failed snapshot returns `failed: 'pre-migration-copy'`, and the wrapper turns an IPC rejection into `failed: 'ipc'`. `saveFailing` is set on any `saved:false` without a read-only reason and cleared by the next save that lands. The in-memory bridge returns `void`, which counts as not failing. A read-only reason takes priority over `save-failing` in `paintReadOnly`. No save runs before the banner exists. Consider: the banner says progress "saves as soon as it can", but a retry only happens on the next action that saves, and quitting while it is showing loses the session. The text could say "keep Offsuit open; it retries on your next action".
- **(2) Temp-first `saveWithBackup` (backup.ts:110-123): fixed for the case reported.** Every failure path unlinks the temp, and no `.tmp` files were left in any probe. Results after 3 failed saves:
  - Temp write fails: live and all 3 backups byte-identical (repo test "a write that fails").
  - Temp write succeeds but the bak1 copy fails (`copyIfPresent` swallows it): all 3 saves go through, but the backups shrink to `[none, none, v3]`, so the previous versions v4, v2 and v1 are gone. This is the likely state on a nearly full disk: the temp file took the last of the space, and the copy needs the same again. **Consider:** `fs.linkSync(file, bak1)` instead of `copyFileSync`. A hard link uses no space and is safe because live is always replaced by rename, never rewritten in place. Fall back to copy if linking fails.
  - The final rename fails: rotation has already run, so all three backups become the live version (v3, v2, v1 lost). The live file is intact. A same-directory rename failing is rare. Noted. Running the rename-dependent steps only once the rename can succeed, or skipping rotation when `renameSync` fails, would close it.
- **(3) Hash-confirmed `changedElsewhere` (store.ts:79-84): fixed.** A changed stamp with identical bytes re-stamps and keeps saving (test "a file touched but not changed"). Different bytes still trip the guard (the existing second-copy test). Noted: `remember()` hashes the file re-read from disk rather than the text just written, so another writer landing in that window is taken as our own write. Also, `hashOf` returning null on a transient read error (for example EMFILE) while the stamp differs would trip the guard. Hashing the written text, and treating a null hash as "unknown, retry" rather than "changed", closes both.
- **(4) `Unbranded` constructors (units.ts:17-38): fixed.** The 4 new `@ts-expect-error` mint cases compile, so each line really errors, and `reps(n)` with `n: number` still compiles (scratch probe, tsc exit 0). Noted: arithmetic and `Number()` still launder a brand (`chalk(bankroll - 0)`, `chalk(Number(bankroll))` compile). That is inherent to TS brands and matches the existing "arithmetic drops the brand" note. The source scan of `core/progression` is the backstop.
- **Author's "not changed" items.** The DST response does not hold: `process.env.TZ` set at runtime makes `systemDayKeyOf` machine-independent, so a real per-timestamp test is possible. The drift response covers serialize writing an unlisted key, not a legacy key that deserialize reads but nothing lists, which the carry would write back on every save. Both stay Consider, not blocking. The re-upgrade snapshot decision is accepted.
- **Verification at ba7ba94.**
  - Both `tsc` configs: exit 0.
  - `npx vitest run`: 1852 of 1855. The 3 failures are all `perf.test.ts` (load average 76-135); re-run alone it passes 7 of 7.
  - The store, backup, units, profileSchema and progression suites plus the scratch probes: 67 of 67 pass.
  - e2e not run, as instructed. The renderer's banner states (`save-failing` set and cleared) still have no automated test.

## Author response to the re-review (next commit)
| Note | Outcome |
|---|---|
| Banner says "saves as soon as it can" | Fixed: "Free some space and keep Offsuit open: the next action saves everything." |
| Re-hash reads the file after the write | Fixed: hashes the text just written. |
| A null hash on a transient read failure trips the guard | Fixed: present-but-unreadable is not a change; a missing file still is. |
| Use a hard link for bak1 on a full disk | Not changed: a link shares bytes with the live file, so an in-place edit or corruption of the live file would corrupt the backup too. Commented in backup.ts. |
| Final rename fails after rotation | Not changed: rare (the temp is already written on the same volume); the live file stays intact. |
| DST test does not use a real timezone | Fixed: `systemDayKeyOf` is tested under TZ=America/Los_Angeles across 2023-11-05. |
| Drift test misses a legacy key that is read but not listed | Not changed: every key deserialize reads is also written by serialize, which the test covers. |

## Streak change (c2a44f7)
Verdict for this commit: **CHANGES REQUESTED**. The streak parser is meant to repair corrupt data, but when the stored fields disagree with the history it trusts the stored values. The counter can also freeze the streak for good. I verified every example below with scratch tests in /tmp/hd3 (an extract of c2a44f7).

### Act on
- **persist.ts:144-153 `parseStreak`. A corrupt stored value can invent a run or cut one, which breaks invariants (1) and (4).**
  - **It invents a run across a gap.** `{current:50, lastCountedDay:100, countedDays:[100,102]}` parses to `current:50`, `lastCountedDay:102`. The history shows a gap, so the true run is 1. The stored `current` belonged to the old pointer (100) but is applied to the new one (102).
  - **It invents a run with no history.** `{current:1e9, lastCountedDay:5, countedDays:[]}` parses to `current:1e9`, `best:1e9`.
  - **It cuts a run when the pointer is ahead of the history.** `{current:1, lastCountedDay:104, countedDays:[101,102,103]}` parses to `current:1`, `lastCountedDay:104`. That is below the history's trailing run of 3, and day 104 is not in the history. `countSession` always writes both fields together, so a pointer outside the history can only come from corruption.
  - Fix: treat the history as the source of truth.
    - `lastCountedDay` = the newest counted day when the history is non-empty. The stated pointer is used only when the history is empty, and then `current` is 1.
    - `current` = `runEndingOn(countedDays, lastCountedDay)`.
    - Raise `current` to the stored value only when `stated === lastCountedDay` and the run reaches the start of a full history (`logged === countedDays.length === MAX_STREAK_DAYS`). That is the only case where the true run can be longer than the log, and it keeps the existing "current: 5000 over a full history" test passing.
    - Add the three cases above as tests.
- **persist.ts:184-197 `countSession` / `currentStreakOn`. A `lastCountedDay` in the future freezes the streak, which breaks rule (2).**
  - If the clock was ahead when a session was counted (or the pointer is corrupt) and is then corrected, `countSession` ignores every real day until that future day arrives.
  - Meanwhile `currentStreakOn` shows the stored run every day, because `today - last <= 1` is true for any negative gap.
  - Probe: last day 20000 with current 5, then sessions on days 19800-19804. Each day leaves current at 5 and shows 5, so the learner gets neither the reset for missed days nor credit for sessions.
  - The "changes nothing" rule is right for a small backward step (flying west can move the DayKey back one), not for a large one.
  - Fix: in `countSession`, when `day < last - 1`, treat it as a clock correction. Drop counted days after `day`, recompute the run with `runEndingOn`, then count `day`. In `currentStreakOn`, return `current` only when the gap is 0 or 1, and treat a gap of -1 or less as "pointer not trusted". Whether the future days are kept or dropped is the owner's call, but the streak must not stop counting. Add a test that moves the clock back.

### Checked and fine
- **best >= current** holds on every path, including parse, `countSession`, and the 800-day run kept past the 730-day history.
- **The pointer is never older than the newest counted day** (`Math.max`).
- **A null pointer with no history** reads as 0. Negative, float and non-integer days are dropped or floored, and duplicates collapse.
- **Same day twice** is a no-op. **The next day** adds 1. **A gap** starts again at 1, and `currentStreakOn` reads 0 after a missed day. **The bounded history** keeps the newest 730 days while `current` and `best` keep counting.
- **Shape:** `PROGRESSION_SHAPE.streak` lists exactly the five fields, and the drift test passes. A stray `restedDays` or freeze field is carried untouched and never read. A `progression.lamp` written by an earlier commit on this branch would be carried forever as an unknown key, but no build with `lamp` ever shipped (origin/main has no `progression`), so no migration is needed.

### Consider / Noted
- **DECISIONS.md:12 still says the migration "does not seed the Lamp".** Edit that line to say the streak.
- **The new AGENTS.md streak line runs past the file's wrap width.**
- **`streak.boundaryHour` is stored but nothing reads it.** Day keys come from `systemDayKeyOf()` with the default hour. If the hour ever becomes a setting, the stored history needs re-keying.

### Verification
- `tsc -p tsconfig.json`: exit 0.
- progression, profileSchema, store and localDay tests: 49 of 49 pass.
- The scratch probes above.
- Not run: e2e (the profile-schema.spec fixture was updated in this commit).

### Re-check at ef9bfc6
Both streak blockers are fixed, and I found no new blockers. I re-ran my probes on an extract of ef9bfc6 in /tmp/hd4.

- **(1) The parser no longer invents or cuts runs.**
  - Run across a gap: `[100,102]` with a stored current of 50 now gives current 1 on day 102.
  - Pointer ahead of the history: `[101,102,103]` with a pointer of 104 now gives current 3 on day 103.
  - Stored 1e9 with no history now gives current 0 and no last day.
  - A full 1000-day run still parses as 1000, because the trailing run fills all 730 days and the stored pointer agrees.
- **(2) A fast clock no longer freezes the streak.** With a last day of 20000, the streak reads 0 on day 19800. Sessions on 19800, 19801 and 19802 then give 1, 2 and 3. Best stays at 5.

**Consider (not blocking):**
- **A one-day step back erases the day just counted** (persist.ts:202-212). Count days 96-100, then a session on day 99. This happens when flying west lands a late session before the 4 am turnover. Day 100 is dropped, the run becomes 4 on day 99, and the streak reads 0 on day 101 unless another session counts day 100. Fix: treat a step of exactly one day back as a no-op, and correct only when `day < last - 1`.
- **A clock correction during a run longer than 730 days cuts it to the history.** A 1000-day run corrected by 5 days becomes 726 instead of 995. Fix: when the kept history still has a full trailing run, keep `current - (last - newest)`. This is rare.
- **A corrupt `best` becomes a 100-year record.** `best: 1e9` with an empty history parses to 36,500. When `countedDays.length < MAX_STREAK_DAYS` the history is complete, so best could be capped at the longest run in the history.
- **Nit:** AGENTS.md line 63 is still past the wrap width, because "Core takes a `DayKeyOf`; only the renderer" stays on the long line.

**Docs:** DECISIONS.md now says "streak" and describes the history-first rule and the clock correction. The `boundaryHour` documentation in types.ts reads correctly.

**Verification:**
- `tsc -p tsconfig.json`: exit 0.
- progression, profileSchema, store, localDay and units tests: 55 of 55 pass.
- Not run: e2e.

## Author response to the streak re-check
| Note | Outcome |
|---|---|
| One day back drops a counted day | Fixed: a one-day step back is ignored; only a larger gap corrects the clock. Test: "one day back (a westward flight before 4 am)". |
| A run over 730 days is cut by a clock correction | Not changed: it needs both a 2-year run and a clock error, and the best run is kept. |
| A corrupt best reads as 36,500 | Not changed: capping best by the history would cut a real record whenever the history itself is damaged. Losing a record is worse than an implausible one. |
| AGENTS.md line width | Fixed. |


# Review: grader-close-band (close band, charts preflop, villain ranges)
Verdict: FAIL at the first pass (4 act-on items) → FAIL at 876a79a (2 new) → FAIL at 09cbaec (shove pricing) → PASS WITH NOTES at the jam fix (the tip's grader)
Base: 2b28855e047746a941fdc9f759c0bfd2d12bd67d  Head: 2e1433df0fe108ca55e872fb69021ad531318890

The postflop maths is right. The pot share, required price, EV-loss formula, band width and weighted-range
equity all match an independent exact oracle (table at the end). The defects are in the adapter
(`gradeSpot.ts`): it decides which model applies, and it does not read bet size or stack depth preflop, or
the shape of a multiway raise postflop. There is also one copy defect. All four are reproduced with real
`TableState`s built through `createTable`/`startHand`/`applyAction`.

## Act on

- **src/core/gradeSpot.ts:108-121 (chartSpotFor), with src/core/chartGrade.ts:220-258. Chart spots ignore raise size, all-ins and stack depth.**
  Any single raise counts as a standard open, any second raise counts as a standard 3-bet, and the
  100bb charts are applied at any stack. The cost then scales with `pot`, which includes the oversized
  raise. Reproduced on a 6-max table: UTG and HJ fold, CO goes all-in for 100bb, BTN and SB fold, BB to act.
  `chartSpotFor` returns `{kind:'defend', spot:'bb-vs-co'}`, and the grades are:
  - BB **calls AA** vs the shove: `serious`, 18.7bb, "Against a CO open, the BB chart raises AA; calling it costs ~18.7 bb." This is the best legal action; a raise is not possible.
  - BB **calls QQ**: `serious`, 12.9bb.
  - BB **folds 98s** / **T9s**: `serious`, 8.7bb / 9.4bb. Folding is correct against a 100bb shove.
  - BB **calls KJo**: `free`, 0bb. Calling off 100bb with KJo is waved through.
  - BB **calls 72o**: 49.5bb, quoted as a chart loss.

  A 30x open (raise to 1500) gives the same bad grades: fold 98s is `serious` 2.7bb, call 76s is `free`.
  Hero at 8bb in the CO is graded on the 100bb CO chart. In the live app this happens whenever a stack runs
  short: a bot's raise clamps to all chips, or hero shoves. The `allin` → `raise` mapping (chartMove) also
  grades a 100bb first-in shove the same as a 2.5x open.
  Fix: in `chartSpotFor`, return null (the pot-odds model) when any of these hold:
  - a preflop raise is an all-in;
  - the open is above a standard size (for example > 4bb, plus 1bb per limper);
  - the 3-bet is above a standard multiple of the open;
  - effective stack < about 40bb;
  - hero's chosen action is `allin`.

  Add unit cases for the shove, the oversize open and the short stack.

- **src/core/gradeSpot.ts:152. `facing` is inferred from hero's own commitment, which is wrong multiway.**
  Reproduced on a 4-handed limped flop: P1 checks, P2 bets 100, P3 raises to 300, hero (BTN) has committed 0.
  `lastAggressor` is P3, a raiser, but the code passes `facing: 'bet'`. The bots pick bluffRaiseFreq
  versus bluffBetFreq from their own `toCall > 0` (ai.ts:128, archetypes.ts:174), so P3 used the raise
  frequency. For a LAG on that board the modelled range share is 0.561 as 'bet' against 0.461 as 'raise'.
  Hero's equity is therefore measured against a range about 22% too wide, and hero is graded too leniently
  on exactly the large-pot multiway spots.
  Fix: take `facing` from the aggressor's own action this street. It is a raise when someone else had
  already bet before the aggressor acted, which can be read from the log since the last street change, or
  from a per-street bet count recorded on the state. Add a test.

- **src/core/gradeSpot.ts:153-161 with villainRanges.ts:221-229. A raise's size is measured differently from how the bots size it, so a bot's standard raise moves the value line.**
  The bots raise to `currentBet + pot × betPotFraction`, where `pot` is the pot when they act
  (ai.ts:156, archetypes.ts:203). The grader measures `toCall / (state.pot − toCall)`. That equals the
  bot's fraction for a bet into hero, but not for a raise over hero's bet. Measured with hero betting half
  pot (300) and the bot raising at its own size:

  | Archetype | Graded fraction | Own size | Value-line shift |
  |---|---|---|---|
  | tag-reg | 0.495 | 0.66 | −0.042 |
  | lag | 0.563 | 0.75 | −0.041 |
  | maniac | 0.750 | 1.0 | −0.042 |

  So a bot raising at its own size is modelled with a value line about 4 points low, which widens the
  range. This contradicts DECISIONS.md ("zero at the archetype's size, so the bots are modelled exactly")
  and the module header. The unit test only pins the 'bet' case.
  Fix: for `facing: 'raise'`, compute the fraction as (raise-to − bet faced by the aggressor) / (pot when
  the aggressor acted). Pin it with a test: a bot-sized raise gives shift 0.

- **src/core/coach.ts closeChartMessage. The close copy for defence and 3-bet spots is garbled, with position names lowercased.**
  The function rewrites `spotPhrase` with `.toLowerCase()` inside parentheses. Actual output:
  - "Close spot: Q4s sits on the edge of the chart (against a co open, the bb chart), where both choices are played. Either choice holds up."
  - "Close spot: JJ sits on the edge of the chart (facing a 3-bet after a co open, the chart), …"

  Only the RFI form reads correctly. No test asserts this copy.
  Fix: build the phrase per kind, for example "the BB chart against a CO open" or "the chart facing a
  3-bet after a CO open". Add a copy test for each kind that also runs `bannedPhrasingIn`.

## Consider

- **src/core/chartGrade.ts:240-245. Preflop cost magnitudes (my solver recall; confidence low to moderate).**
  - Facing a 3-bet, the loose cap is reached for almost every hand outside the chart: K·pot = 283 at
    potBb 10.5, so any d > 0.1 hits the cap. Calling a UTG 3-bet with 77, KJo or 65s comes out at a flat
    2.44–2.50bb, which is `serious` and opens the gate. From my memory of 100bb 6-max solver EVs, these
    flats lose roughly 0.3–1bb.
  - Folding AA in the BB to an open is graded 3.8bb. Solver EV relative to the fold is about 9–11bb, so
    this understates it by about 3x (it still lands in `serious`).
  - RFI fold AA ≈ 3.8bb and open 72o = 1bb are the right order. AKo UTG fold 1.94bb looks about 1.5x high
    (published ~1.0–1.3bb).

  Tradeoff: recalibrating changes the Experiment 1 numbers, and the model is declared "not a solve".
- **src/core/villainRanges.ts:202-207 (preflopContinue).** "Raise or call" is applied to every villain:
  - A BB who checked a limped pot continued with all 1326 hands, but is modelled as filtered by callStrength.
  - An open-raiser's range should be the raise branch only.

  Both make postflop ranges wrong in the common limped-pot and raised-pot cases.
  Tradeoff: needs the preflop action per seat, which `preflopActions` already parses.
- **src/core/closeSpot.ts / coach.ts.** The band is in pot-share units, so a close spot forgives up to band × (pot + toCall) / bb.
  - In my fuzz (300 spots, pots up to 60bb) the largest estimate silenced as close was 3.57bb.
  - In a 300bb pot it could be about 14bb, shown as "Either choice holds up".

  Tradeoff: this is the band applied literally, but a bb cap on what counts as close would keep big-pot
  errors visible.
- **villainRanges.ts:140-141.** The river table is called "exact" but ignores card removal between the two hands.
  - Measured against exact enumeration with removal: QsJs on Ah Kd 7s 2c 9h is 0.4069 vs 0.3924, which is
    1.45 points, half of STEP_WIDTH and not "well under" it.
  - AcKc on the same board is off by 0.45 points.

  Tradeoff: an exact pairwise version on the river is about 1M evaluations per board, then cached.
- **gradeSpot.ts:71.** `line.includes(' posts ')` also drops every action of a seat whose name contains " posts ".
  - Reproduced with a seat named "Ann posts": the log reads 'Ann posts posts SB 25'.
  - Anchoring the match (`/^(.*) posts (SB|BB) \d+$/`) removes the edge.
- **Tests.** No tests cover:
  - `chartSpotFor` facing an all-in, an oversize open or a short stack;
  - multiway `facing`;
  - the raise-size shift;
  - the close copy for defend and 3-bet spots.

## Noted

- Postflop equity is heads-up against the last aggressor only, even when other players are live. This was already the case before the branch.
- `depthTax` (ai.ts, deep stacks over 100bb) is not in the range model. It does not apply at the app's 100bb.
- Earlier postflop streets are not replayed. This one-street memory is stated in DECISIONS.
- With bb = 0, a chart grade returns `evLossBb: NaN` (silent, `free`). This matches the existing classifySeverity guard, but NaN is then persisted in the verdict.
- Doc drift: DECISIONS says "a hand 10% outside the CO chart ≈ 0.3bb". The formula gives 27 × 1.5 × 0.01 = 0.405, and chartGrade.ts's header says ~0.4.
- A short all-in that lifts the bet is counted as a raise in `preflopActions`, while `lastAggressor` stays on the earlier full raiser. This is an edge case.

## Dismissed

- **Wrong seat graded.** Proof: every call site grades `state.toAct` while hero is to act:
  - table.ts:796 runs in the hero action handler before `applyAction`;
  - assessmentBlock `commit` runs only when `toAct === HERO` (line 230);
  - the harness `gradeHero` reads `state.seats[state.toAct]`.
- **4-max seat mapping.** Proof: from the real engine, `chartSeats` gives `["BTN","SB","BB","CO"]` for 4 seats, `[…,"HJ","CO"]` for 5 and `[…,"UTG","HJ","CO"]` for 6. The first seat to act on 4-max opens the CO chart, matching contrast.ts:136.
- **All-in parsing.** Proof: the log prints `all-in <allInTotal>` (table.ts:485), a street total, and the parser compares it with the street total `toMatch`, so a call for less is classified correctly.
- **Silence rule / close shape.** Proof: fuzz of 300 random postflop spots with all six archetypes:
  - 0 cases of `message === null` with an estimate ≥ 0.5, and 0 the other way round;
  - every close grade is `free`, 0bb, with no price and no principle (28 close, 9 with a message);
  - two runs of the same input give identical results (0 differences);
  - 0 banned phrasings.

  Separately, the chart messages for AA in defend, 3-bet and RFI spots also contain no banned phrasings.
- **Card removal in `equityVsWeightedRange`.** Proof: matches exact enumeration within MC error on 7 spots (table).
- **Chart direction.** Proof: `chartAction` agrees with `isInRfiRange`, `defenseAction` and `threeBetResponseAction` on 45 RFI, 44 defend and 24 3-bet samples (0 mismatches).

## Verification

- I could not run `npx tsc --noEmit` or `npx vitest run`. The worktree's `node_modules` is a symlink into
  `/Users/pranavgk/Documents/scratch/temp/Poker/`, and partway through the review that directory became
  unreadable ("Operation not permitted", even outside the sandbox). `git diff origin/main...HEAD` also
  failed after the first calls, because it reads that repo's packed-refs. The diff was read before that.
  CI status on the branch is therefore unverified by me.
- I ran the repo modules directly with Node 26 type stripping, using a resolve/load hook in
  `tests/tmp/rev/` that maps `.js` imports to `.ts` and rewrites evaluate.ts's enum.
- I wrote my own 7-card evaluator. Over 30,000 random showdowns it agreed with `evaluate.ts` on every
  comparison (0 mismatches). Exact enumeration over villain hands and runouts is in
  `tests/tmp/rev/oracle.ts`, `close.ts`, `chart.ts`, `shove.ts` and `fuzz.ts`.
- Not tested by me: the renderer (coachPanel close paint, styles) and Electron; e2e was not run, by
  instruction.

## Independent maths checks

Spots R1–R5 and T1–T2 use the villain's range from the repo (`villainRange`), pot = pot including the bet,
bb = 50, 2000 iterations, seed 7. "Exact" means enumerating every villain hand and every runout with my own
evaluator.

| Check | Repo | Independent | Delta | OK? |
|---|---|---|---|---|
| R1 river KcQc vs tag-reg, call 400 into 1000: required price | 0.2857 | 0.2857 | 0 | OK |
| R1 pot share (MC vs exact) | 0.527 | 0.542 | −1.5pt (half-width 2.2) | OK |
| R2 river 99 vs maniac, call 800/1600: pot share | 0.6705 | 0.6626 | +0.8pt | OK |
| R3 river 88 vs nit, fold 300/800: pot share | 0.0493 | 0.0498 | −0.05pt | OK |
| T1 turn AsJc vs station, call 200/600: pot share | 0.7950 | 0.8035 | −0.85pt | OK |
| T2 turn QhJh flush draw vs lag, call 225/525: pot share | 0.5232 | 0.5062 | +1.7pt (half-width 2.2) | OK |
| R4 river Ad5d vs over-folder, call 220/620: EV loss (req − eq)(pot + call)/bb | 4.379bb | 4.366bb | 0.013 | OK |
| R5 river Td9d vs lag, fold 300/700: EV loss (eq − req)(pot + call)/bb | 7.495bb | 7.532bb | 0.037 (MC) | OK |
| 95% half-width at 2000 iterations (R1/R2/T2), exact var = win + tie/4 − p² | 0.0217/0.0206/0.0218 | 0.0216/0.0207/0.0218 | ≤0.0001 | OK |
| Close classification, 7 spots above + 8 near-line (A2 vs lag, river, req 0.2368) | 15/15 | 15/15 agree | 0 | OK |
| Near-line A2: estimate 0.28bb (MC) vs exact 0.48bb, both < 0.5 so no message | silent | silent | — | OK |
| River strength 9c9d (Ah Kd 7s 2c 9h) | 0.9935 | 0.9939 (exact with removal) | −0.04pt | OK |
| River strength AcKc | 0.9824 | 0.9869 | −0.45pt | OK |
| River strength QsJs | 0.4069 | 0.3924 | +1.45pt | Marginal (removal ignored) |
| River strength 3c4d | 0.0069 | 0.0045 | +0.24pt | OK |
| Preflop strength AA | 0.8511 | 0.8526 own MC 60k (published 85.2) | −0.09pt vs published | OK |
| Preflop strength 72o | 0.3459 | 0.3428 own MC (published 34.6) | 0.0pt vs published | OK |
| Preflop strength KK | 0.8225 | 0.8258 own MC (published ~82.4) | −0.15pt | OK |
| Preflop strength AKs | 0.6730 | 0.6688 own MC (published ~67.0) | +0.3pt | OK (≈2 SE) |
| Chart direction, RFI / defend / 3-bet samples | 45 / 44 / 24 | same via preflop.ts | 0 mismatches | OK |
| RFI fold AA cost (any seat) | 3.82–3.83bb | ~2.5–3.5bb solver RFI EV (low confidence) | ~+0.5 | Plausible |
| RFI open 72o | 1.00bb (cap) | ~0.6–0.9bb | ~+0.2 | Plausible |
| BB fold AA vs CO open | 3.78bb | ~9–11bb solver (moderate confidence) | −6 | Understated (still serious) |
| UTG call 3-bet with 77 / KJo | 2.44 / 2.50bb (cap) | ~0.3–1bb (low confidence) | +1.5–2 | Overstated (serious) |
| BB vs CO 100bb shove: call AA | serious 18.7bb | 0 (best action) | — | **WRONG** |
| BB vs CO 100bb shove: fold 98s | serious 8.7bb | ~0 (correct fold) | — | **WRONG** |
| Bot-sized raise value-line shift (tag-reg/lag/maniac) | −0.042/−0.041/−0.042 | 0 (DECISIONS claim) | ~−4pt | **WRONG** |
| Multiway raise faced as 'bet' (lag range share) | 0.561 | 0.461 | +0.10 | **WRONG** |

## Resolution (author, at the fix commit)

| Finding | Bucket | Disposition |
|---|---|---|
| Chart spots ignore shoves, raise size, stack depth | Act on | **Fixed.** `chartSpotFor` returns null on any all-in, an open over 5bb, a 3-bet over 15bb, or hero/raiser under 40bb; those spots go to the pot-odds model. Tests: `chartGrade.test.ts` "chart spots only where the charts apply" (red on the reviewed head). |
| Multiway raise graded as a bet | Act on | **Fixed.** `facing` is read from the aggressor's own last log line ("raises to", or an all-in with others already in). Test: `villainRanges.test.ts` "bet or raise, and the size read" (red on the reviewed head). |
| A bot's normal raise lowers the value line | Act on | **Fixed.** Size is read only for a postflop bet into no bet, as the aggressor's chips over the pot without this street's chips; a raise is modelled at the archetype's own size. Same test. |
| Garbled close chart copy | Act on | **Fixed.** `chartName()` builds the phrase; test pins the 3-bet-response sentence. |
| Loose cap facing a 3-bet too high | Consider | **Taken.** `CAP_LOOSE_CALL` 0.5 → 0.25 of the price: calling a CO 3-bet with 77 ≈ 1.4bb (notable). |
| Mixed cell across two regions (found while fixing) | — | **Fixed.** Row adjacency counts only one region over (3-bet/call, call/fold): folding AKo to a CO 3-bet is a mistake, not close. Test added. |
| `' posts '` name parse | Consider | **Taken.** Anchored to `/ posts (SB|BB) \d+$/`. |
| Folding AA in the BB understated (3.8 vs ~10bb) | Consider | Not changed: still `serious`; recorded as an open question in DECISIONS/FINDINGS. |
| preflopContinue ignores the villain's actual preflop action | Consider | Not changed: the log has no street markers, so the preflop action cannot be read postflop without an engine change. Follow-up. |
| Big-pot close spots can hide a large estimate | Consider | Not changed: the band is the honest uncertainty; `estimateLossBb` keeps the figure. Open question. |
| River strength ignores card removal (≤1.45 pts) | Consider | Not changed: under the 3-point step width the range uses. Comment softened to "well under the step width" → stated as measured. |
| Doc drift 0.3 → 0.4bb | Noted | Fixed in DECISIONS. |

## Re-verification (at 876a79a)

Independent re-check of the four act-on items and every Fixed/Taken row. I did not edit any source file.
Every check below runs real `TableState`s (`createTable`/`startHand`/`applyAction`) through `chartSpotFor` and
`gradeSpot`. The scratch scripts are in `tests/tmp/rv/` (`charts.ts`, `facing.ts`, `shovemodel.ts`, `copy.ts`, `sb.ts`; gitignored).

### Per item

| Item | Status | Evidence |
|---|---|---|
| Act-on 1: chart ignores shoves, size, depth | **Partly fixed** | Spots now go to the pot-odds model: CO shove, then BB to act (`null`); the 30x open (`null`); hero at 8bb or 39.98bb (`null`, while 40bb still charts); a 30bb raiser (`null`); an open of 251 (`null`, while 250 = 5bb charts); a 3-bet to 751 (`null`, while 750 charts). Facing the shove: call AA `free 0`, fold 98s `free 0`, call 72o `serious 42.2bb` priced from pot odds. With archetype models the shove grades sensibly (lag: fold KJo `serious 15.9`, call `free`). The standard bot sizes (open ≤ 2.5bb, 3-bet 6.5bb, or 11.5bb over a 5bb open) still chart, so normal spots are not lost. **Not fixed:** hero's own `allin`. The review's fix list named it, but the resolution does not mention it (see the new Act on below). |
| Act-on 2: multiway `facing` | **Verified fixed** (with a latent edge) | Limped 4-way flop, S bets 100, B raises to 300, U folds: `gradeSpot` matches only `facing:'raise'`. Hero bets and villain raises: `raise`. A bet with a caller before hero: `bet`. A bet followed by a third player's short all-in for less: `bet` (correct). Edge: names that are prefixes of each other (see Consider). |
| Act-on 3: raise size mis-measured | **Verified fixed** | A raise now carries no `potFraction`, so the archetype's own size is used and the shift is 0. For a bet with callers before hero, `potFraction = villain.committed / (pot − street chips)`: S bets 150 into 200 with B calling reads 0.750. A 400 overbet with a caller reads 2.000, as the only matching candidate. A real `decideArchetypeAction` lag bet (150 into 200) reads 0.750 = `betPotFraction`, and `valueLine` gives 0.53 both with and without the size, so the shift is 0. |
| Act-on 4: garbled close copy | **Verified fixed** | Actual output: "…edge of the BB chart against a CO open…", "…the SB chart against a BTN open…", "…the chart facing a 3-bet after a CO open…". `bannedPhrasingIn` returns null on all three. Only the 3-bet form is pinned by a test. |
| CAP_LOOSE_CALL 0.5 → 0.25 (Taken) | Verified | Unit test 72o call is 0.35. UTG 3-bet response: 72o call is >1. |
| Mixed cell one region over (Fixed) | **Regression in sb-vs-btn** | See the new Act on below. In BB defence the cell counts are unchanged (26/32/38/40/36). For BTN facing a 3-bet the count is unchanged (20). For UTG/HJ/CO facing a 3-bet, only AKo-fold and AQo-4-bet lose close, which is the intended change: folding AKo to a UTG 3-bet is `serious` 3.9bb. RFI is untouched (the guard sits after the RFI branch; CO still has 12 boundary cells). |
| `' posts '` anchored (Taken) | Verified | Regex `/ posts (SB|BB) \d+$/`. Every existing chart test passes. |
| Doc drift 0.3 → 0.4 | Verified | DECISIONS.md line updated. |
| Tests "red on the reviewed head" | Not checked | I did not run the new tests against 2e1433d. |

### New Act on

- **src/core/gradeSpot.ts:125 / src/core/coach.ts:239 (`chartMove('allin')` → `'raise'`). Hero's own 100bb shove is still graded as a standard open.**
  This was in the original act-on 1 fix list ("hero's chosen action is `allin`") and is not addressed.
  Reproduced at 100bb, 6-max, with UTG first in:
  - `allin` with 72o: `notable` 1.00bb, "The UTG opening chart folds 72o; raising it costs ~1.0 bb." This is the same as a min-open. A 100bb shove of 72o loses roughly 3bb or more: it is called by about 12% of hands at about 30% equity.
  - `allin` with AA: `free` 0. Shoving aces 100bb deep forfeits most of the open's value.
  - The BB shoving QJo over a CO open grades the same as a 3-bet (0.38bb, free).

  Fix: in `gradeSpot`, skip the chart when `chosen === 'allin'` and the hero's stack is at least `MIN_CHART_DEPTH_BB`. Grade it through the pot-odds model, or grade it as a separate push mistake. Add a test that a 100bb UTG shove of 72o is not the 1bb open cost.
- **src/core/chartGrade.ts:209. The new "one region over" rule removes the mixed cells of the 3-bet-or-fold SB vs BTN chart.**
  sb-vs-btn is authored as mostly 3-bet-or-fold (preflop.ts:345, "a separate 3-bet-or-fold spot"). Its edge therefore runs straight from raise to fold. |raise − fold| = 2, so that edge can no longer be close: the mixed-cell count falls from 22 to 18.
  At SB-vs-2.5x pricing (pot 200, to call 100), these were silent before the fix and now get a coach message:
  - SB 3-betting **ATo**: `notable` 0.50bb, "the SB chart folds ATo; raising it costs ~0.5 bb";
  - SB 3-betting **KJo**: `notable` 0.50bb;
  - SB folding **AJo**: `notable` 0.52bb.

  In a 3-bet-or-fold strategy these are the mixed cells, and the fix's own rationale ("a solve mixes 3-bet with call, or call with fold") does not hold for this spot.
  Fix: allow raise/fold adjacency in sb-vs-btn. More generally, allow it wherever the row has no call cell between the two neighbours. Keep the AKo/AQo-facing-3-bet case non-close. Add a test for sb-vs-btn ATo raise being close.

### Consider

- **gradeSpot.ts:174. The aggressor's last line is found with `startsWith(name + ' ')`, which mis-attributes when one seat name is a prefix of another.**
  Reproduced with seats `Al`, `Bo`, `Bo B`: Al bets 100, Bo raises to 300, Bo B calls 300. `last` becomes "Bo B calls 300", so the raise is read as `facing:'bet'` with `potFraction` 1.5.
  This is latent today: `SEAT_NAMES` is You/Ada/Bo/Cy, and the LAN table passes no model. Matching the action regex and comparing the name capture exactly (as `preflopActions` does) removes it.
  Postflop also does not refuse duplicate names the way `preflopActions` does.
- **gradeSpot.ts:177. `last.includes(' all-in ') && othersIn` reads a first-in full all-in bet as a raise once anyone has called it.**
  Unreachable for bots: they use `allin` first in only with ≤ 1bb behind, which is never a full bet, so `lastAggressor` stays null (D in `facing.ts`). It is reachable only for a human villain, who has no model. Reading the street's betting order would be exact.
- **Tests.** Missing cases:
  - the defend close copy (only the 3-bet sentence is pinned);
  - the `potFraction` read for a bet with callers;
  - the boundary values of the guards (5bb, 15bb, 40bb).
- **Depth guard is hero and raisers only.** A 100bb CO is still graded on the RFI chart when the BB behind has 8bb. Effective stack is arguably the right measure, but this is minor and a judgment call.

### Verification

- `npx tsc --noEmit -p tsconfig.json`: exit 0.
- `npx vitest run tests/unit/chartGrade.test.ts tests/unit/villainRanges.test.ts tests/unit/closeSpot.test.ts tests/unit/coach.test.ts tests/unit/coach-message.test.ts`: 5 files, 86 tests passed, exit 0.
- Not run, by instruction: Electron, e2e, the full unit suite.

Verdict after fixes: FAIL

## Resolution of the re-verification (author)

| Finding | Disposition |
|---|---|
| Hero all-in graded as a min-open | **Fixed.** In a chart spot a shove the chart does not make costs 3x the wrong-raise loss (100bb 72o from CO = 3bb, serious) and is never a close mixed cell; a shove the chart plays is graded as its raise. Test: "hero shoves and the 3-bet-or-fold chart" (red before). |
| One-region rule regressed SB vs BTN | **Fixed.** That chart is 3-bet-or-fold by design, so 3-bet beside fold counts as one step there. Test: ATo 3-bet and AJo fold are close again (red before). |
| Aggressor's line matched by name prefix | **Fixed.** Exact-line regex; `aggressorRead` exported and tested directly (red with the prefix match). |
| Missing tests: bet size with callers, limits | Bet-size-with-callers test added (0.75). Limits are covered by the shove / 30x / 8bb tests; exact-boundary values not pinned. |
| A called first-in all-in read as a raise (humans only) | Noted: no model exists for a human seat, so it never reaches the range. |
| Effective stack ignored (100bb hero vs 8bb BB) | Noted: follow-up; at the app's 100bb tables only a busted-down bot can trigger it. |

## Re-verification (at 09cbaec)

Independent re-check of the "Resolution of the re-verification" table. I did not edit any source file. Every
grade below comes from real `TableState`s (`createTable`/`startHand`/`applyAction`, 6-max 100bb, bb 50) run
through `chartSpotFor`/`gradeSpot` (`modelFor: () => null` preflop, `ARCHETYPE_PROFILES.lag` postflop). The
scratch scripts are in `tests/tmp/rv2/` (gitignored): `shove.ts`, `shoveev.ts` (shove EV against a QQ+/AK
caller, `equityVsRange`), and `names.ts`.

### Per item

| Item | Status | Evidence |
|---|---|---|
| Hero all-in graded as a min-open | **Partly fixed** | The headline case is fixed. A 100bb UTG shove of 72o grades `serious` 3.00 (it was `notable` 1.00), and CO 72o also grades 3.00. A shove of a boundary cell is never close. A shove the chart plays (AA) is `free`, as DECISIONS documents. **Not fixed:** the shove cost is the chart's distance cost × 3, so it keeps the open's shape and not the shove's. Hands near the chart edge are still silent or under-graded (see the new Act on). |
| SB vs BTN 3-bet-or-fold edges | **Verified fixed** | sb-vs-btn has 22 mixed cells again (18 at 876a79a), for example `AJo:raise->fold`, `ATo:fold->raise`, `KJo:fold->raise`, `KQo:raise->fold`. In the live spot (BTN opens 125, SB to act): 3-bet ATo is close (est 0.50), 3-bet KJo is close (0.50), fold AJo is close (0.52). Fold AA is still `serious` 3.76. Calling ATo is still `notable` 0.50: the step-2 rule does not leak into the call side. The exception is keyed to `sb-vs-btn` only, so the BB and 3-bet-response counts are unchanged. A shove of ATo there is `notable` 1.50 and not close, because the shove return sits before `isMixedCell`. |
| Aggressor line matched by prefix | **Verified fixed** | Line: limp 4-way, Y bets 100, Z folds, hero calls, X check-raises to 400, Y calls. The read is `facing:'raise'` for every name pair tried: `Bo`/`Bo B`, `A.B`/`AxB`, `Bo (2)`/`Bo (2) x`, `x+y`/`xxy`, `$1`/`$1$`, `a\b`/`a\b c`, `[Bo]`/`B`, `.*`/`Bo`, `Bo|Cy`/`Bo`, `^Bo$`/`Bo`. A bet with a prefix-named caller reads `bet` at 0.75 (`Bo B`/`Bo`, `A.B`/`A`, `.*`/`Bo`). A short postflop all-in over a bet ("Bo all-in 550") reads `raise`. The escape covers every metacharacter that `RegExp` treats specially. **Latent, unchanged:** two seats with the same name still mis-read. `Bo`/`Bo` reads `bet` with potFraction 2, because the postflop path does not refuse duplicates the way `preflopActions` does. Unreachable today: the bot names are unique, and LAN seats carry no model. |
| Tests: bet size with callers; limits | Verified as stated | The "bet with a caller" test pins 0.75. The guard boundaries are not pinned. By hand: 40bb charts and 39.98bb does not. |
| Called first-in all-in (humans only); effective stack | Noted (agree) | Both are unchanged and unreachable by the bots. |
| Tests "red before" | Checked by reading the diff, not run | Each new assertion depends on the changed line: the old `steps !== 1` rule, the old `startsWith(name + ' ')` match, and the old 1.0bb shove cost. |

Regression hunt (all clean apart from the Act on below):
- **Limp special case.** The `rfi`/`call` branch returns before the shove line, and its recursive call passes no `shove`. UTG limp 72o = 0.50 and limp AA = 1.91 (half the nearer mistake), unchanged.
- **Defence spot where the chart calls.** BB vs CO: a shove of any call-region hand is capped at 0.25 × toCall × 3 = 1.13bb (`notable`). 64 of 73 hands land there; the 9 at the 3-bet edge are `free` (AJs 0.00, TT 0.01, KJs 0.03, KQo 0.46). A shove of a fold-region hand is also 1.13 (72o, K5o).
- **Shove where the chart 3-bets** (QQ, AKo, AA in BB vs CO): 0, `free`, as documented.

### New Act on

- **src/core/chartGrade.ts:276 (`lossBb * SHOVE_MULTIPLIER`). A 100bb shove is still graded by how far the hand sits from the chart edge, not by what a shove costs. A shove of a hand near the edge stays silent.**
  The 3x factor is applied to `CHART_K * pot * d²` (the open's distance cost). So it is right only where that cost hits its cap: 72o, K9o and 106 of the 130 UTG off-chart hands.

  Grades at 100bb, UTG first in, with the shove EV against five players who call only with QQ+/AK (`shoveev.ts`):

  | Shove | Grade | EV vs fold |
  |---|---|---|
  | KJo | `free` 0.01 | −5.8bb |
  | QJo | `free` 0.03 | −4.7bb |
  | ATo | `free` 0.15 | −4.7bb |
  | KTo | `free` 0.42 | — |
  | A9o | `notable` 0.96 | — |
  | 72o | `serious` 3.00 | −5.7bb |

  KJo and 72o lose about the same and are graded 300x apart.
  - **CO:** shoves of A8o down to A2o are all `free` (0.00 to 0.42).
  - **BTN:** T8o 0.00, 97o 0.02, 76o 0.12.
  - **Facing a 3-bet** (CO opens 125, BTN 3-bets 375), the cap again sets the figure. A jam of AQo is `notable` 1.03 and a jam of AJo is `notable` 1.91. Their EV against a QQ+/AK caller is −5.6bb to −14bb, depending on whether the 3-bet range is 120 or 80 combos.
  - **On-chart hands** (UTG KQo −6.1bb, 22 −2.7bb, AJo −4.9bb) are `free` 0 by the documented "graded as the chart's raise" rule. That rule rests on the same assumption, that shove EV tracks open EV, and these numbers disprove it.

  Before the fix, all of these were also silent, so this is the original act-on item left half done, not a regression.
  Fix: grade a hero shove at or above `MIN_CHART_DEPTH_BB` by its own cost, independent of `chartDistance`. Either:
  - estimate the push EV from the hand's equity against a fixed calling range, the call probability from the players behind, and the depth (every input is in `gradeSpot`); or
  - at minimum, floor the loss of any shove outside a small jam set (QQ+/AK, or the chart's raise region facing a 3-bet) at the 72o figure.

  Pin it with a test that a UTG 100bb shove of KJo (and of 22) is not `free`.

### Consider

- **The depth edge is discontinuous** (`chartGrade.ts:276` with `gradeSpot.ts` `MIN_CHART_DEPTH_BB`). A UTG 72o shove is graded as follows:
  - at 40bb, 50bb and 100bb alike: `serious` 3.00;
  - at 39.98bb: `free` 0.29, because the pot-odds model takes over.

  The modelled EV against a QQ+/AK caller is −1.5bb at 40bb, −2.2bb at 50bb and −5.7bb at 100bb. The fixed multiplier therefore overstates the cost at 40bb about 2x and understates it at 100bb. This is the same root as the Act on: a depth-aware shove cost removes both. Tradeoff: more model surface in a grader that otherwise reads no sizes.
- **coach.ts:283 copy.** A shove reads "…raising it costs ~3.0 bb". "Shoving" would name the mistake the learner made. Tradeoff: one more verb branch in `chartMessage`.

### Verification

- `npx tsc --noEmit -p tsconfig.json`: exit 0.
- `npx vitest run tests/unit/chartGrade.test.ts tests/unit/villainRanges.test.ts tests/unit/closeSpot.test.ts`: 3 files, 58 tests passed, exit 0.
- Scratch reproductions: `tests/tmp/rv2/shove.ts`, `shoveev.ts` and `names.ts` (vite-node, exit 0).
- Not run, by instruction: Electron, e2e, `test:full`, and the full unit suite.
- Untested by any committed test:
  - the shove cost of near-edge and on-chart hands;
  - the depth boundaries of the guards;
  - the duplicate-name postflop read.

Verdict after fixes: FAIL

## Resolution of the re-verification at 09cbaec (author)

| Finding | Disposition |
|---|---|
| A shove's cost is 3x the edge cost, so near-edge shoves are silent | **Fixed.** A chart-spot shove is priced by its own EV against a QQ+/AK calling range (`shoveLossBb`); the multiplier is gone. Test: 72o, KJo, 22 and A8o shoves first in from the CO are not free; AA and KK are (red on 09cbaec for KJo/22/A8o). |
| The coach message for a shove says "raising" | **Fixed.** The shove verdict has its own sentence naming the calling range and the pot share. |
| The 40bb edge jumps | Noted: below 40bb the pot-odds model grades the shove; push/fold charts are a follow-up. |
| Duplicate seat names mis-read postflop | Noted: bot names are unique and LAN seats carry no model. |

## Re-verification (at 6b1d0e1)

Independent re-check of the shove fix (6b1d0e1: `shoveLossBb` and `SHOVE_CALL_RANGE` in `chartGrade.ts`,
`gradeShove` in `coach.ts`) and of the e2e re-pin (ac7fb05). I did not edit any source file. Grades come from
real `TableState`s (`createTable`/`startHand`/`applyAction`, 100bb, bb 50) run through `gradeSpot` with
`modelFor: () => null`. The pot shares come from my own oracle: a separate 7-card evaluator and Monte Carlo
(`tests/tmp/rv3/oracle.ts`, 30k to 40k trials, villain combos dealt with card removal). It does not import
`src/core/equity`. Spot checks: AA v KK 0.827, AKo v QQ 0.431, A8o v KK 0.290. Scripts are in
`tests/tmp/rv3/`: `ev.ts`, `spots.ts`, `edges.ts` and `sanity.ts`.

### Per item

| Item | Status | Evidence |
|---|---|---|
| A shove's cost was 3x the edge cost, so near-edge shoves were silent | **Fixed for first-in (RFI) spots. Regressed in defence and 3-bet spots** (new Act on) | See the 4-max CO table below. The formula matches my own calculation to within the app's Monte Carlo noise. |
| Shove copy said "raising" | Fixed | Example: "A shove this deep is called only by QQ+ and AK, where you have 22% pot share; it costs ~2.7 bb." `bannedPhrasingIn` returns null, and no `BANNED_PHRASINGS` entry matches. The calling-range claim is false outside RFI spots (see the Act on). |
| 40bb edge; duplicate seat names | Noted (unchanged, agree) | No change. |
| e2e re-pin, seed 8 → 10 (ac7fb05) | **Verified: no assertion weakened** | I compared all 227 changed lines one by one. The changes are `seed: 8`→`10` (plus `?? 8`→`?? 10` defaults), the renamed `reachSeed8Gate`→`reachPinnedGate`, comments, and one message string (`'seed 10 must give…'`). No `expect` line was removed or relaxed. Two `expect(await waitForIdle(page)).toBe('handover')` lines were added in `gate.spec`, so those tests got stricter. The predict test 21 move from seed 43 to 10 keeps all three of its expects (`awaiting` is `ai`, `withheld` is `true`, no win%). No spec still mentions QsQh, 3.9bb or 348 as a pin. I did not run e2e (by instruction), so whether the new seed holds in the app is left to the running suite. |

**Formula check: 4-max, CO first in, 3 behind, pot 1.5bb, 100bb.** My EV uses the commit's formula with my own
share and the naive per-player q = 34/1326.

| Hand | My share | App share (seed 1) | My EV vs fold | App grade |
|---|---|---|---|---|
| 72o | 0.217 | 0.224 | −2.83 | `serious` 2.72 |
| KJo | 0.200 | 0.215 | −3.08 | `serious` 2.87 |
| 22 | 0.343 | 0.354 | −0.93 | `notable` 0.76 |
| A8o | 0.250 | 0.245 | −2.33 | `serious` 2.41 |
| AA | 0.832 | 0.838 | +6.45 | `free` 0 |
| KK | 0.570 | 0.578 | +2.51 | `free` 0 |

- Each gap is explained by the app's 2000-trial share. For KJo, 1.5pp of share is worth about 0.2bb at these stakes.
- Card removal is ignored in q. Its effect is ±0.5bb: KJo −2.45, A8o −1.80, 22 −1.12. It does not change any severity here.
- When the caller is a blind, `pot + 2·stack` overcounts the final pot by that blind (≤1bb·share, ≤0.3bb). This is negligible.
- BTN first in (2 behind): 72o 1.35, KJo 1.45, A8o 1.14 `notable`; 22 `free` 0.02. My numbers are 1.42, 1.59, 1.10 and 0.14. They agree.

**Determinism and edge cases.**
- Determinism: same seed gives the same loss and the same message.
- Seed spread over 40 seeds: CO 22 runs 0.58 to 1.33 and is always `notable`. CO A8o runs 2.07 to 2.68 and is always `serious`. The noise is real, but no severity flips at these hands.
- Non-finite inputs give `free` with a null message, never a "~NaN bb" verdict: bb=0, bb=NaN, pot NaN, and a missing `stack` (`evLossBb` NaN). Stack 0 gives 0.
- `seed` undefined falls back to 1. `shoveLossBb` with NaN inputs gives NaN, and with negative `behind` it gives 0.
- Unit file `chartGrade.test.ts`: 30 passed.

### New Act on

- **coach.ts:87 → chartGrade.ts `shoveLossBb` (`behind` = `opponents` from `gradeSpot.ts:148`). In defence and 3-bet spots every opponent is priced as a random hand. The raiser is not random, so every non-premium shove there is now `free`. This is a regression from 09cbaec, which graded these spots `notable`.**
  - `opponents` counts the live seats. First in, that equals the players behind, which is correct.
  - In a defence or 3-bet spot it also counts the raiser, who has already acted. The raiser gets q = 34/1326 = 2.6%, the chance that a random hand holds QQ+/AK.
  - The raiser's real chance of holding QQ+/AK is much higher: 9.6% of the CO open range, 15.9% of the UTG range, and 57% of the 60-combo BB 3-bet range (`bb-vs-co` threebet, used as a proxy for a 3-bettor's range).
  - Meanwhile the dead money is 4 to 11.5bb, so fold equity dominates the result.

  App grade against my EV, with the raiser's range conditioned on its action (QQ+/AK share of that range, other players random):

  | Spot | App, every hand tested (72o KJo 22 A8o AQo) | My EV |
  |---|---|---|
  | 6-max BB vs UTG open | `free` 0.00 | 72o −5.4, KJo −6.0, A8o −4.4, AQo −4.6, 22 −1.4 |
  | 4-max BB vs CO open | `free` 0.00 | 72o −1.7, KJo −2.0, A8o −1.1, AQo −1.2 |
  | 4-max SB vs BTN open | `free` 0.00 | 72o −0.9, KJo −1.2 |
  | 4-max CO open, BTN 3-bets 7.5bb, CO jams | `free` 0.00 | 72o −25, KJo −27, A8o −22, AQo −22, 22 −11 |

  - At 09cbaec these were all graded: BB-vs-CO shoves 1.13 `notable`, and a 3-bet jam of AQo 1.03 `notable` (see the re-verification above).
  - The 3-bet-spot gap is large. Even with a wide 120-combo 3-bet range (q ≈ 0.28), a 72o jam loses more than 10bb, and the grade is silent.
  - The message also states "called only by QQ+ and AK" as a fact, in a spot where that is the one claim the model gets wrong.

  Fix (all the inputs are in `chartSpotFor`/`gradeSpot`): pass `shoveLossBb` a per-opponent call probability instead of a count.
  - The raiser gets the QQ+/AK share of its own range: `rfiCombos(opener)` in defence spots, and a 3-bet range in 3-bet spots.
  - Only players still to act get the random-hand q.
  - Or, at minimum, route shoves in `defend`/`3bet` spots back to the previous cost until this is done.

  Pin it with a test that a 100bb BB-vs-UTG shove of 72o, and a CO jam of KJo over a BTN 3-bet, are not `free`.

### Consider

- **The All-in preset + Raise button bypasses the shove grade** (`table.ts:1143` and `:1175`; `coach.ts:86` checks only `chosen === 'allin'`).
  - The dock's "All-in" preset sets the slider to `maxRaiseTo` (committed + stack), and the Raise button sends `{kind: 'raise', amount}`.
  - CO 72o raised to 5000 grades as the chart's raise, `notable` 1.00 ("raising it costs ~1.0 bb"). KJo raised to 5000 grades `free` 0. The same chips sent through the A key grade 2.72 and 2.87.
  - This predates the fix (09cbaec keyed on `allin` too), but it is now the main way past the fix.
  - Fix: treat `betSize >= committed + stack` as `allin` in `gradeSpot`. Tradeoff: one more input the grader reads.
- **Card removal in q** (`SHOVE_CALL_RANGE` against 1326). This is ±0.5bb at 100bb, and it biases blocker hands (AK, KJ, A8) toward overstated losses. It can wait; the Monte Carlo noise is the same size.
- **Test comment** `chartGrade.test.ts` ("loses (1 - 3*share/...) of the stack") is garbled. The assertion itself is right.

### Verification

- `npx vitest run tests/unit/chartGrade.test.ts`: 30 passed, exit 0.
- Scratch scripts `tests/tmp/rv3/{oracle,sanity,ev,spots,edges}.ts` (vite-node): exit 0.
- Not run, by instruction: typecheck, e2e, `test:full`, Electron, and the full unit suite.

Verdict after fixes: FAIL


## Resolution of the re-verification at 6b1d0e1 (author)

| Finding | Disposition |
|---|---|
| Shoves over a raise priced the raiser as a random hand | **Fixed.** `shoveLossBb` takes one call chance per live opponent: random if it has not acted, its RFI chart's QQ+/AK share if it opened, the BB 3-bet region's share against hero's seat if it 3-bet. Tests: BB jamming 72o over a CO open is not free; the CO jamming KJo over a BTN 3-bet is serious (red before). |
| A raise to the whole stack skipped the shove grade | **Fixed.** `gradeSpot` grades a chart-spot raise whose size is the whole stack as `allin`. Test: the raise and the all-in grade identically. |
| "called only by QQ+ and AK" false outside first-in | **Fixed.** The copy reads "called by QQ+ and AK". |
| Card removal in the call chance (±0.5bb) | Noted. |

## Re-verification (at a3a55f6)

Independent re-check of a3a55f6 (`shoveCallChance`, `openerCallChance`, `threeBettorCallChance` and
`shoveLossBb` in `chartGrade.ts`; `shoveCallers` and the whole-stack-raise rule in `gradeSpot.ts`). I did not
edit any source file. Grades come from real `TableState`s (`createTable`/`startHand`/`applyAction`, 100bb,
bb 50, seed 11) run through `gradeSpot` with `modelFor: () => null`. My EV uses my own call chances and the
exact final pot when the raiser calls. For pot share it uses `equityVsRange` at 20k trials, so the share is
not independent here (the rv3 oracle agreed with it). Scripts are in `tests/tmp/rv4/`: `check.ts`,
`edges.ts`, `fourbet.ts` and `defend.ts`.

### Call chances (my own count: pair 6, suited 4, offsuit 12; calling set AA KK QQ AKs AKo = 34)

| Range | Mine | App |
|---|---|---|
| Random hand | 34/1326 = 0.0256 | 0.0256 |
| RFI UTG / HJ / CO / BTN / SB | 34/214, 34/274, 34/354, 34/582, 34/498 = 0.159, 0.124, 0.096, 0.058, 0.068 | identical |
| 3-bettor proxy vs UTG / HJ / CO / BTN (BB 3-bet region) | 34/34, 34/44, 34/60, 34/74 = **1.000**, 0.773, 0.567, 0.459 | identical |

### Per item

| Item | Status | Evidence |
|---|---|---|
| Shoves over a raise priced the raiser as a random hand | **Fixed** (see the new Act on for what it causes in 3-bet spots) | Every spot that was `free` at 6b1d0e1 is now graded, and matches my EV. 6-max BB vs UTG: 72o 5.17 `serious` (mine −5.62), KJo 5.47 (−5.56), A8o 4.51 (−4.46), AQo 4.85 (−4.59), 22 1.00 `notable` (−1.57). 4-max BB vs CO: 72o 1.54, KJo 1.73, A8o 1.14, AQo 1.35, all `notable` (mine −1.81, −1.78, −1.11, −1.19). 4-max SB vs BTN, where BB behind is random: 72o 0.79, KJo 0.95 `notable` (mine −1.03, −1.00). CO jam over a BTN 7.5bb 3-bet: 72o 24.0, KJo 25.1, A8o 21.6, AQo 22.9, 22 8.8 `serious` (mine −26.1, −25.9, −21.9, −22.4, −11.6). AA and KK are `free` everywhere. In `shoveCallers`, folded seats are excluded and hero is excluded from the raisers. The opener gets its RFI chart's chance, the 3-bettor gets the proxy, and anyone yet to act gets the random chance. |
| A raise to the whole stack skipped the shove grade | **Fixed** | In all 42 spot × hand cases above, `raise` with `betSize = stack + committed` gives a `Grade` deep-equal to `allin`. A raise to more than the stack also counts as a shove. Stack−1, 125 and an undefined `betSize` each stay the chart's raise (KJo CO `free`; 72o CO raise to 125 `notable` 1.00, the chart message). |
| "called only by QQ+ and AK" copy | **Fixed** | Example: "A shove this deep is called by QQ+ and AK, where you have 21% pot share; it costs ~1.7 bb." |
| Card removal | Noted (agree) | No change. |

**Regression checks (all pass).**
- BB facing a limp and a raise (4-max: CO limps, BTN raises to 4bb, SB folds): `chartSpotFor` gives null. Both `allin` and a raise to the whole stack go to the pot-odds model, and neither is converted.
- 30bb hero: no chart spot, and `allin` takes the pot-odds path.
- RFI first in: the players behind get the random chance. CO KJo is 2.87 through `gradeSpot`, and the same 2.87 through `gradeDecision` with no `shoveCallers`, which fills the default. 4-max CO and 6-max UTG RFI numbers are unchanged from 6b1d0e1 (CO 72o 2.72, KJo 2.87, 22 0.76, A8o 2.41).
- Determinism: the same seed gives the same grade.
- `npx vitest run tests/unit/chartGrade.test.ts`: 33 passed, exit 0.

### New Act on

- **In 3-bet spots, jamming the chart's own 4-bet hands is graded `serious`** (`threeBettorCallChance` → `shoveLossBb`). The 3-bettor's proxy is the BB's 3-bet region. That region is almost all value, so it calls far more often than the ranges `threeBetResponseAction` was built to 4-bet against.
  - Against a UTG open, the proxy is exactly QQ+/AK, so q = 1: the 3-bettor never folds, and every non-AA/KK jam is priced against the top of its range.
  - These grades were `free` at 6b1d0e1. Now they are loud false positives on the hands the chart says to raise.

  Opener jams over a 7.5bb 3-bet, 6-max (`fourbet.ts`); the chart's action is `threebet` (4-bet) unless noted:

  | Opener | QQ | JJ | AKs | AKo |
  |---|---|---|---|---|
  | UTG | `serious` 11.75 | `serious` 22.33 (chart: call) | `serious` 13.30 | `serious` 19.39 |
  | HJ | `serious` 6.47 | `serious` 14.64 (chart: call) | `serious` 7.66 | `serious` 12.37 |
  | CO (also the 4-max table's open) | `notable` 1.68 | `serious` 7.67 | `serious` 2.55 | `serious` 6.01 |
  | BTN | `free` 0 | `serious` 4.40 | `free` 0.26 | `serious` 3.05 |

  - On the 4-max table, CO open → BTN 3-bet → CO jam is the commonest 3-bet response. There, AQs (chart: 4-bet) is `serious` 18.1, and TT (chart: call) is `serious` 6.5.
  - The arithmetic is right for the input. The input contradicts the chart: if the 3-bettor really held 57% QQ+/AK, the chart's AKo 4-bet would itself be a mistake.
  - The message then tells the learner that a standard AK jam over a 3-bet costs ~6 to 19bb.
  - Fix, either of:
    - (a) In `defend`/`3bet` spots, when `chartAction(spot, hand)` is `raise`, grade the jam as the chart's raise. This mirrors "a raise to the whole stack is a shove" in the other direction: a shove of a chart-raise hand is that raise.
    - (b) Give the 3-bettor a range that includes the bluffs the response chart assumes, for example the widest region (`bb-vs-btn`, q 0.46) for every opener, with q < 1 always.
  - Pin it with a test: CO AKo, and UTG QQ, jamming over a 3-bet are not `serious`.

### Consider

- **Pot overcount when the raiser calls.** `pot + 2·stack` counts the raiser's chips already in twice: (villain committed − hero committed)·share. That is about 0.5bb in defence (1.5bb·share) and about 1.7bb in 3-bet spots (5bb·share). It understates the loss: for example, 22 vs a UTG open is 1.00 (mine 1.57), and 22 jamming over a 3-bet is 8.8 (mine 11.6). No severity flips in the spots tested. Pass `committed` per caller if this is touched.
- **RFI jams of QQ/JJ/TT/AK are graded `notable`** (6-max UTG: QQ 0.67, AKs 0.86, AKo 1.58, JJ 1.93), and AQs is `serious` 4.12. This predates a3a55f6 (RFI is unchanged), and it follows from "one caller, always QQ+/AK" with no worse-hand calls. It is worth a line in `DECISIONS.md` if it is intended.

### Verification

- `npx vitest run tests/unit/chartGrade.test.ts`: 33 passed, exit 0.
- Scratch scripts `tests/tmp/rv4/{check,edges,fourbet,defend}.ts` (vite-node): exit 0.
- Not run, by instruction: typecheck, e2e, `test:full`, Electron, and the full unit suite.

Verdict after fixes: FAIL


## Resolution of the re-verification at a3a55f6 (author)

| Finding | Disposition |
|---|---|
| Jamming a 4-bet hand over a 3-bet graded serious | **Fixed** (fix a). In defence and 3-bet spots a jam of a hand the chart re-raises is graded as the chart's raise. Test: CO AKo and UTG QQ jamming over a 3-bet are free (red before). |
| The raiser's chips counted twice in the called pot (≈0.5–1.7bb understatement) | Noted: no severity flip in the reviewer's spots; follow-up. |
| UTG open-jams of QQ/AK/JJ graded notable | Noted: a real (small) chip loss against QQ+/AK; predates a3a55f6. |

## Re-verification (at the jam fix)

Independent re-check of 35eb799 (`jamOfChartRaise` in `gradeDecision`, `src/core/coach.ts`). I did not edit
any source file. Grades come from real `TableState`s (`createTable`/`startHand`/`applyAction`, 100bb, bb 50,
seed 11) run through `gradeSpot` with `modelFor: () => null`, for `allin` and for a raise to the whole stack.
The only grader source change since a3a55f6 is the 10 lines in `coach.ts`. Scratch scripts were in
`tests/tmp/rv5/` (`jam.ts`, `regions.ts`, `sb.ts`) and have been deleted.

### Per item

| Item | Status | Evidence |
|---|---|---|
| Jamming a 4-bet hand over a 3-bet graded serious | **Fixed** | Opener jams over a BB/BTN 3-bet, chart `raise`, all `free` 0.00: 4-max CO AA KK QQ JJ AKs AKo AQs; 6-max UTG AA KK QQ AKs AKo; 6-max HJ QQ AKs AKo. At a3a55f6 these were CO AKo `serious` 6.01, UTG QQ `serious` 11.75, CO JJ `serious` 7.67, and so on. In all 139 cases, a raise to the whole stack is deep-equal to `allin`. |
| Non-chart jams over a 3-bet still charged | **Holds** | Through shove pricing, unchanged from rv4: 4-max CO KJo `serious` 24.86, 72o 23.75, A8o 21.34, AQo 22.60, 22 8.50; 6-max UTG KJo 53.37, 72o 51.42; HJ KJo 38.85, 72o 37.34. Hands the chart calls are still charged as shoves: 4-max CO TT 6.15; UTG JJ 22.70, AQs 41.04. |
| BB jams over an open | **Holds** (one note below) | Chart-raise hands are `free`: vs UTG AA KK QQ AKs AKo; vs CO also JJ AQs AQo KQs; vs BTN also TT AJs. Non-raise hands keep the rv4 numbers: 6-max vs UTG 72o `serious` 5.17, KJo 5.47, A8o 4.51, 22 `notable` 1.00; 4-max vs CO 72o `notable` 1.54, KJo 1.73, A8o 1.14. |
| RFI jams unchanged | **Holds** | `chart.kind !== 'rfi'` keeps RFI on shove pricing. 4-max CO: 72o 2.72, KJo 2.87, 22 0.76, A8o 2.41, AKo 0.40. 6-max UTG: QQ 0.67, AKs 0.86, AKo 1.58, JJ 1.93, AQs 4.12. All are identical to rv4. |
| Raise regions the fix makes free | **Checked** | Every defend and 3-bet chart's `raise` region is value only: UTG is QQ+/AK; the widest is `bb-vs-sb` (22 hands, down to 77, KQo, JTs). There are no bluff hands, so the fix cannot clear a 100bb jam of a weak hand. A `3bet`/opener SB spot would throw in `chartAction` (SB has no `fourBet` row), but `chartSpotFor` returns null there, so it is unreachable. |
| Pot overcount; UTG open-jams `notable` | Noted (agree) | No change. |

**Regression checks (all pass).**
- `npx vitest run` on the coach, chart and grade tests (`chartGrade`, `chartBank`, `chartBank-ui`, `charts`, `coach`, `coach-message`, `reasonGrade`): 7 files, 140 tests passed.
- `npm run typecheck`: exit 0.

### Notes (not regressions)

- **6-max BB vs a BTN open: jamming 72o (chart `fold`) is graded `free` 0.00, and so are KJo, A8o, A5s and 76s.** 72o is not a chart raise, so this goes through the same shove path as at a3a55f6, and the fix does not cause it. The cause is the model: the BTN's RFI range calls only with QQ+/AK (q 0.058), so 94% fold equity on a 4bb pot outweighs the called loss. In practice the BTN calls a 100bb jam wider than that. So "BB jamming 72o over an open is charged" holds against UTG and CO opens, but not against BTN opens. Worth a line in `DECISIONS.md`, or a wider caller range for late-position openers.
- **Jams of hands the chart calls still use the value-only 3-bettor stand-in.** UTG JJ costs 22.7bb, AQs 41.0bb, and 4-max CO TT 6.15bb. The direction is right (looser than the chart), but the size inherits q = 1 against UTG. Fix (b) from rv4 would temper it. This is not a blocker.

### Verification

- Scratch scripts `tests/tmp/rv5/{jam,regions,sb}.ts` (vite-node): exit 0. They have been deleted.
- Not run, by instruction: e2e, Electron and `test:full`.

Verdict after fixes: PASS WITH NOTES

---

# Review: fix/mp-deal-security
Verdict: PASS WITH NOTES
Base: 2b28855  Head: f9e75c2

This is the final review after three rounds. Every Act-on item from rounds 1 and 2 is fixed and was
checked again at f9e75c2. My temporary attack tests (`tests/unit/zz-review4.test.ts` and
`tests/unit/zz-review5.test.ts`) have been deleted, and the tree is clean. History was rewritten again, so
this head is f9e75c2, not a80620c.

## Status of earlier findings

**Round-2 Act-on items**

- **R2-1. A busted player who stays gets a free rebuy: FIXED.**
  - What changed: newcomers are detected by `RelayServer.seatedAt` (relayServer.ts:108-109, :272). That
    map records every seat's occupant at each completed deal, whether or not the seat was dealt in. It is
    taken from `pending.occupants` (:293, :358), so a restarted deal recomputes the base and never
    stacks two buy-ins.
  - Proof: dealCommit.test.ts "a player who busts and stays is not bought in again" passes; it checks
    chips each hand for 30 hands.
  - My check E1: seat 2 busts and stays. Next deal it is not dealt and chips stay 15000.
  - My check E1b: the player then leaves and a new player joins that seat. The newcomer is bought in at
    5000 (chips 20000), which is the intended rejoin behaviour.
  - My check E2: a newcomer arrives, the deal restarts on a timeout, then another newcomer arrives.
    Chips go from 10000 to 15000, which is exactly one buy-in.
  - First hand: `handNumber > 0` guards it, and the seats are built from `createTable`.
- **R2-2. A guest leaving mid-hand stalls the table: FIXED.**
  - What changed: `foldAbsent` (multiplayer.ts:301-321) runs at the top of every `broadcastState`
    (relayServer.ts:144-148). It folds through the engine when the turn sits on a seat whose `dealtTo`
    owner is neither connected nor the dealer.
  - Proof: dealCommit.test.ts "a guest who leaves mid-hand is folded…" and "a heads-up opponent leaving…"
    pass.
  - My checks:
    - D1, 4 seats: two seats in a row leave. Both are folded when the turn reaches them, and the player
      to act is not folded. The hand finishes with no guest violations.
    - D2: a leaver who is already all-in is not folded. The hand settles, and that seat can win the pot
      (it won 14850); chips are conserved.
    - D3, side pot: a short stack is all-in, a deep stack is all-in, and a third seat leaves facing the
      bet. It is folded at its turn, and the main pot and side pot settle correctly (15050 before and
      after).
    - D4: a leaver during a pending deal causes no fold. The previous hand is settled, so it is a no-op,
      and the redeal is clean.
    - D5: the dealer's in-process seat is never folded across 4 hands.
  - Looping: the loop is bounded by `seatCount`. Each absent seat folds at most once, `isHandOver` and
    `settle` stop it, and `fold` is always legal while the seat may act (table.ts:285).
- **Guard `k` and "fifty-fifty" false positives (Consider): FIXED.**
  - "9 K 2", "3k-high" and "fifty-fifty" are no longer read as numbers.
  - "1k", "1.5k", "3k" and "2k, 3k" are still caught.
  - Proof: my check F.

**Round-1 Act-on items, still fixed at f9e75c2**

- A1, entropy left out: now a violation, and warnings persist.
- A2, `isYou` spectator bypass: the seat is held once learned.
- A3, a malformed frame throws: shapes are checked, with a try/catch behind them.
- A4, a false violation for a newcomer during a pending deal: `dealtTo` comes from the recipients.
- A5: an engine throw now becomes an error.
- A8: handshakes are capped per address.
- A9: spelled-out numbers have their own check, and the post-reveal path keeps it.
- Sigma binds the dealer and the deal order.
- The oracle covers `dns.promises` and `sh -c`.
- The `node_modules` symlink and the `wip:` commit are gone.

The round-2 proofs (B1 to B5) still hold: the unit suite is green at this head.

## Consider
- **src/core/relayGuest.ts:208-212. "Verified" covers the cards only.**
  - Winners, pot and stacks are taken from the host, though the guest holds every showdown card and
    the board.
  - Tradeoff: a few lines with the existing evaluator, against a label that suggests more than it checks.
- **src/core/relayServer.ts:238-245 with relayGuest.ts:121-125. A guest can be removed and rejoin
  repeatedly.**
  - A guest that commits and never reveals is removed after 10 s, and can then rejoin with the same
    invite.
  - Each cycle costs about 10 s per hand.
  - It also shows honest guests "the host restarted a deal" warnings that blame the host.
  - Tradeoff: a rejoin cool-down, and a warning that names the removed seat.
- **src/core/relayServer.ts:266-274. A rejoin is a rebuy.**
  - A busted player can leave and rejoin to get a fresh `startStack`.
  - A player who leaves with chips loses them: an absent seat is zeroed at the next deal, which includes
    an all-in leaver's winnings, as in D2.
  - This is intended ("rejoining should buy in"), but no UI tells the player.
  - Tradeoff: hold a leaver's stack for a rejoin under the same name, against having no persistent
    identity.

## Noted
- After a restart, a late commitment gets "no deal is waiting for that commitment" as an error toast. It
  is noise, not harm.
- A LAN peer with 8 or more IPv4 aliases can still hold all 32 slots, each for `HELLO_TIMEOUT_MS`.
- Heads-up, after one player busts nothing is dealt until a newcomer joins (`dealOrder.length < 2`), and no
  UI message says so.
- The guard's `k` rule is now lowercase only, so "2K" is read as just `2`, which the digit provenance
  check still runs on. "a dozen" and "half" are out of scope, as declared.
- Whether an absent seat is folded depends on the turn reaching it. An absent seat that never gets the turn
  again (others all-in) stays in to showdown. That matches table rules, but its winnings then leave with
  the seat.
- DECISIONS.md records that `npm run e2e` fails at `electron.launch` in this checkout. AGENTS.md "Done"
  requires e2e to pass, so that is unmet here. Electron was not run, per the brief.

## Dismissed
- **foldAbsent can fold a present player's seat.**
  - Proof: it breaks when `present.has(dealtTo[toAct])`, and `present` is everyone connected plus the
    dealer.
  - Every dealt seat has a `dealtTo` owner, because unoccupied seats are zeroed and `recipients` is
    everyone connected.
  - D1 and D5 confirm it.
- **foldAbsent folds during the pending phase.** Proof: during a pending deal `room.table` is the
  previous, already-settled hand (`winners !== null`), or null before the first hand. D4 confirms it.
- **foldAbsent mis-settles side pots or loops.** Proof: it folds only through `applyAction` and `settle`,
  and the loop is bounded by `seatCount`. D3 conserves chips across a main pot and a side pot.
- **seatedAt misfires on the first hand, on a restart, or on bust-leave-rejoin.** Proof: the
  `handNumber > 0` guard; `occupants` is recomputed on each `beginDeal` and committed only in
  `finishDeal`; and E1, E1b and E2.
- **Round-1 and round-2 dismissals stand.** These cover unseen-card leaks, sigma grinding, the token sent
  before the pin, the handshake sniff, the counter leak, false violations from guest seat rules, and solo
  determinism.

## Verification
- At f9e75c2, after deleting my temporary files:
  - `npm run typecheck` exits 0.
  - `npx vitest run --exclude tests/unit/perf.test.ts` exits 0, with 88 of 88 files and 1852 of 1852
    tests passing.
- Temporary tests, now deleted:
  - D1 to D5 for foldAbsent: consecutive leavers, an all-in leaver, a side pot (the D3 run was redone with
    a legal all-in after a harness misstep in my own script), pending, and the dealer seat.
  - E1, E1b and E2 for seatedAt.
  - F for the guard `k` and fifty-fifty rules.
- Not run: e2e and Electron.
- Untested by the branch's suite: a leaver who is all-in and wins (their chips disappear at the next
  deal); side pots with an auto-fold; and the guard's `k` card-text cases (only "fifty-fifty" was added to
  guard.test.ts).

- `npx tsc --noEmit -p tsconfig.json`: exit 0. `npx tsc --noEmit -p tsconfig.main.json`: exit 0.
- `npx vitest run`: 1852 of 1853 pass. The one failure is perf under load (see Noted).
- Red-first: I extracted origin/main into /tmp and ran d635155's `profile-roundtrip.test.ts` and `localDay.test.ts` there. 3 of 3 fail, each on the asserted behaviour (key dropped; UTC buckets). HEAD's version of localDay.test fails on main only because the import is missing, which is expected for the implementation version.
- Scratch tests in /tmp/hd (an extract of HEAD): fake ENOSPC rotation (backups lost), the sweep pattern miss, and `reps(bankroll)` compiling.
- Not run: e2e and Electron, as instructed. Still untested: the renderer's handling of thrown saves, backup rotation under ENOSPC, the snapshot temp sweep, a newer build's second instance, and `systemDayKeyOf` across DST.

## Author response (fixed in the next commit)
| Finding | Outcome |
|---|---|
| Save that throws shows no banner | Fixed: `save` returns `{saved:false, failed}`; the renderer also catches IPC rejection and shows "Not saving" until a save lands. Test: store.test "a write that fails". |
| `chalk(bankroll)` compiles | Fixed: the constructors take `Unbranded`; 4 new `@ts-expect-error` mint cases. |
| Full disk wipes backups | Fixed: temp file written before rotation. Test: backups byte-identical after 3 failed saves. |
| mtime/size guard could misfire | Fixed: a changed stamp stops saving only if the sha256 differs. Test: "a file touched but not changed". |
| Snapshot temps never swept | Fixed: the sweep matches `.pre-vN.<uuid>.tmp`. Test updated. |
| Re-upgrade takes no new snapshot | Kept by design: the first copy is the untouched original, and the rolling backups hold the later v1 file. Pre-v2 Delete leaving `.pre-v2`: cannot change old builds; noted. |
| DST test does not call `systemDayKeyOf` | Not changed: the real function depends on the machine timezone. The per-timestamp lookup is tested through `dayKeyAt`, and `systemDayKeyOf` is checked against `Date`. |
| PROFILE_SHAPE drift test is one-way | Not changed: the dangerous direction (serialize writes an unlisted key) is the one tested. An extra listed key only stops a carry. |

## Re-review at ba7ba94
Both blocking items are fixed, and I have no new blocking findings. I tested the fixes on an extract of ba7ba94 in /tmp/hd2, using scratch tests that fake ENOSPC on `writeFileSync`, `copyFileSync` and `renameSync`.

- **(1) Renderer save wrapper (main.ts:248-266): fixed.** `save()` no longer throws: a failed write returns `failed: 'write'`, a failed snapshot returns `failed: 'pre-migration-copy'`, and the wrapper turns an IPC rejection into `failed: 'ipc'`. `saveFailing` is set on any `saved:false` without a read-only reason and cleared by the next save that lands. The in-memory bridge returns `void`, which counts as not failing. A read-only reason takes priority over `save-failing` in `paintReadOnly`. No save runs before the banner exists. Consider: the banner says progress "saves as soon as it can", but a retry only happens on the next action that saves, and quitting while it is showing loses the session. The text could say "keep Offsuit open; it retries on your next action".
- **(2) Temp-first `saveWithBackup` (backup.ts:110-123): fixed for the case reported.** Every failure path unlinks the temp, and no `.tmp` files were left in any probe. Results after 3 failed saves:
  - Temp write fails: live and all 3 backups byte-identical (repo test "a write that fails").
  - Temp write succeeds but the bak1 copy fails (`copyIfPresent` swallows it): all 3 saves go through, but the backups shrink to `[none, none, v3]`, so the previous versions v4, v2 and v1 are gone. This is the likely state on a nearly full disk: the temp file took the last of the space, and the copy needs the same again. **Consider:** `fs.linkSync(file, bak1)` instead of `copyFileSync`. A hard link uses no space and is safe because live is always replaced by rename, never rewritten in place. Fall back to copy if linking fails.
  - The final rename fails: rotation has already run, so all three backups become the live version (v3, v2, v1 lost). The live file is intact. A same-directory rename failing is rare. Noted. Running the rename-dependent steps only once the rename can succeed, or skipping rotation when `renameSync` fails, would close it.
- **(3) Hash-confirmed `changedElsewhere` (store.ts:79-84): fixed.** A changed stamp with identical bytes re-stamps and keeps saving (test "a file touched but not changed"). Different bytes still trip the guard (the existing second-copy test). Noted: `remember()` hashes the file re-read from disk rather than the text just written, so another writer landing in that window is taken as our own write. Also, `hashOf` returning null on a transient read error (for example EMFILE) while the stamp differs would trip the guard. Hashing the written text, and treating a null hash as "unknown, retry" rather than "changed", closes both.
- **(4) `Unbranded` constructors (units.ts:17-38): fixed.** The 4 new `@ts-expect-error` mint cases compile, so each line really errors, and `reps(n)` with `n: number` still compiles (scratch probe, tsc exit 0). Noted: arithmetic and `Number()` still launder a brand (`chalk(bankroll - 0)`, `chalk(Number(bankroll))` compile). That is inherent to TS brands and matches the existing "arithmetic drops the brand" note. The source scan of `core/progression` is the backstop.
- **Author's "not changed" items.** The DST response does not hold: `process.env.TZ` set at runtime makes `systemDayKeyOf` machine-independent, so a real per-timestamp test is possible. The drift response covers serialize writing an unlisted key, not a legacy key that deserialize reads but nothing lists, which the carry would write back on every save. Both stay Consider, not blocking. The re-upgrade snapshot decision is accepted.
- **Verification at ba7ba94.**
  - Both `tsc` configs: exit 0.
  - `npx vitest run`: 1852 of 1855. The 3 failures are all `perf.test.ts` (load average 76-135); re-run alone it passes 7 of 7.
  - The store, backup, units, profileSchema and progression suites plus the scratch probes: 67 of 67 pass.
  - e2e not run, as instructed. The renderer's banner states (`save-failing` set and cleared) still have no automated test.

## Author response to the re-review (next commit)
| Note | Outcome |
|---|---|
| Banner says "saves as soon as it can" | Fixed: "Free some space and keep Offsuit open: the next action saves everything." |
| Re-hash reads the file after the write | Fixed: hashes the text just written. |
| A null hash on a transient read failure trips the guard | Fixed: present-but-unreadable is not a change; a missing file still is. |
| Use a hard link for bak1 on a full disk | Not changed: a link shares bytes with the live file, so an in-place edit or corruption of the live file would corrupt the backup too. Commented in backup.ts. |
| Final rename fails after rotation | Not changed: rare (the temp is already written on the same volume); the live file stays intact. |
| DST test does not use a real timezone | Fixed: `systemDayKeyOf` is tested under TZ=America/Los_Angeles across 2023-11-05. |
| Drift test misses a legacy key that is read but not listed | Not changed: every key deserialize reads is also written by serialize, which the test covers. |

## Streak change (c2a44f7)
Verdict for this commit: **CHANGES REQUESTED**. The streak parser is meant to repair corrupt data, but when the stored fields disagree with the history it trusts the stored values. The counter can also freeze the streak for good. I verified every example below with scratch tests in /tmp/hd3 (an extract of c2a44f7).

### Act on
- **persist.ts:144-153 `parseStreak`. A corrupt stored value can invent a run or cut one, which breaks invariants (1) and (4).**
  - **It invents a run across a gap.** `{current:50, lastCountedDay:100, countedDays:[100,102]}` parses to `current:50`, `lastCountedDay:102`. The history shows a gap, so the true run is 1. The stored `current` belonged to the old pointer (100) but is applied to the new one (102).
  - **It invents a run with no history.** `{current:1e9, lastCountedDay:5, countedDays:[]}` parses to `current:1e9`, `best:1e9`.
  - **It cuts a run when the pointer is ahead of the history.** `{current:1, lastCountedDay:104, countedDays:[101,102,103]}` parses to `current:1`, `lastCountedDay:104`. That is below the history's trailing run of 3, and day 104 is not in the history. `countSession` always writes both fields together, so a pointer outside the history can only come from corruption.
  - Fix: treat the history as the source of truth.
    - `lastCountedDay` = the newest counted day when the history is non-empty. The stated pointer is used only when the history is empty, and then `current` is 1.
    - `current` = `runEndingOn(countedDays, lastCountedDay)`.
    - Raise `current` to the stored value only when `stated === lastCountedDay` and the run reaches the start of a full history (`logged === countedDays.length === MAX_STREAK_DAYS`). That is the only case where the true run can be longer than the log, and it keeps the existing "current: 5000 over a full history" test passing.
    - Add the three cases above as tests.
- **persist.ts:184-197 `countSession` / `currentStreakOn`. A `lastCountedDay` in the future freezes the streak, which breaks rule (2).**
  - If the clock was ahead when a session was counted (or the pointer is corrupt) and is then corrected, `countSession` ignores every real day until that future day arrives.
  - Meanwhile `currentStreakOn` shows the stored run every day, because `today - last <= 1` is true for any negative gap.
  - Probe: last day 20000 with current 5, then sessions on days 19800-19804. Each day leaves current at 5 and shows 5, so the learner gets neither the reset for missed days nor credit for sessions.
  - The "changes nothing" rule is right for a small backward step (flying west can move the DayKey back one), not for a large one.
  - Fix: in `countSession`, when `day < last - 1`, treat it as a clock correction. Drop counted days after `day`, recompute the run with `runEndingOn`, then count `day`. In `currentStreakOn`, return `current` only when the gap is 0 or 1, and treat a gap of -1 or less as "pointer not trusted". Whether the future days are kept or dropped is the owner's call, but the streak must not stop counting. Add a test that moves the clock back.

### Checked and fine
- **best >= current** holds on every path, including parse, `countSession`, and the 800-day run kept past the 730-day history.
- **The pointer is never older than the newest counted day** (`Math.max`).
- **A null pointer with no history** reads as 0. Negative, float and non-integer days are dropped or floored, and duplicates collapse.
- **Same day twice** is a no-op. **The next day** adds 1. **A gap** starts again at 1, and `currentStreakOn` reads 0 after a missed day. **The bounded history** keeps the newest 730 days while `current` and `best` keep counting.
- **Shape:** `PROGRESSION_SHAPE.streak` lists exactly the five fields, and the drift test passes. A stray `restedDays` or freeze field is carried untouched and never read. A `progression.lamp` written by an earlier commit on this branch would be carried forever as an unknown key, but no build with `lamp` ever shipped (origin/main has no `progression`), so no migration is needed.

### Consider / Noted
- **DECISIONS.md:12 still says the migration "does not seed the Lamp".** Edit that line to say the streak.
- **The new AGENTS.md streak line runs past the file's wrap width.**
- **`streak.boundaryHour` is stored but nothing reads it.** Day keys come from `systemDayKeyOf()` with the default hour. If the hour ever becomes a setting, the stored history needs re-keying.

### Verification
- `tsc -p tsconfig.json`: exit 0.
- progression, profileSchema, store and localDay tests: 49 of 49 pass.
- The scratch probes above.
- Not run: e2e (the profile-schema.spec fixture was updated in this commit).

### Re-check at ef9bfc6
Both streak blockers are fixed, and I found no new blockers. I re-ran my probes on an extract of ef9bfc6 in /tmp/hd4.

- **(1) The parser no longer invents or cuts runs.**
  - Run across a gap: `[100,102]` with a stored current of 50 now gives current 1 on day 102.
  - Pointer ahead of the history: `[101,102,103]` with a pointer of 104 now gives current 3 on day 103.
  - Stored 1e9 with no history now gives current 0 and no last day.
  - A full 1000-day run still parses as 1000, because the trailing run fills all 730 days and the stored pointer agrees.
- **(2) A fast clock no longer freezes the streak.** With a last day of 20000, the streak reads 0 on day 19800. Sessions on 19800, 19801 and 19802 then give 1, 2 and 3. Best stays at 5.

**Consider (not blocking):**
- **A one-day step back erases the day just counted** (persist.ts:202-212). Count days 96-100, then a session on day 99. This happens when flying west lands a late session before the 4 am turnover. Day 100 is dropped, the run becomes 4 on day 99, and the streak reads 0 on day 101 unless another session counts day 100. Fix: treat a step of exactly one day back as a no-op, and correct only when `day < last - 1`.
- **A clock correction during a run longer than 730 days cuts it to the history.** A 1000-day run corrected by 5 days becomes 726 instead of 995. Fix: when the kept history still has a full trailing run, keep `current - (last - newest)`. This is rare.
- **A corrupt `best` becomes a 100-year record.** `best: 1e9` with an empty history parses to 36,500. When `countedDays.length < MAX_STREAK_DAYS` the history is complete, so best could be capped at the longest run in the history.
- **Nit:** AGENTS.md line 63 is still past the wrap width, because "Core takes a `DayKeyOf`; only the renderer" stays on the long line.

**Docs:** DECISIONS.md now says "streak" and describes the history-first rule and the clock correction. The `boundaryHour` documentation in types.ts reads correctly.

**Verification:**
- `tsc -p tsconfig.json`: exit 0.
- progression, profileSchema, store, localDay and units tests: 55 of 55 pass.
- Not run: e2e.

## Author response to the streak re-check
| Note | Outcome |
|---|---|
| One day back drops a counted day | Fixed: a one-day step back is ignored; only a larger gap corrects the clock. Test: "one day back (a westward flight before 4 am)". |
| A run over 730 days is cut by a clock correction | Not changed: it needs both a 2-year run and a clock error, and the best run is kept. |
| A corrupt best reads as 36,500 | Not changed: capping best by the history would cut a real record whenever the history itself is damaged. Losing a record is worse than an implausible one. |
| AGENTS.md line width | Fixed. |


# Review: feat/profile-schema-v2
Verdict: PASS WITH NOTES (streak blockers fixed at ef9bfc6; was CHANGES REQUESTED at c2a44f7)
Base: 2b28855 (merge-base with origin/main)  Head: 8af212d. I reviewed d635155 and 21278db in full. 8af212d (AGENTS.md, DECISIONS.md, profile-schema.spec) landed while I was reviewing, and I read it too.

I found no way for the on-disk profile to be lost or overwritten by the paths this branch adds. The two blocking items are about a guarantee the branch states but does not keep: one is about telling the learner when saving has stopped, the other is the claimed unit isolation.

## Act on
- **src/renderer/main.ts:244-249, src/main/store.ts:132-135. A save that throws never shows the banner, so the learner gets no warning that saving has stopped.** Two cases throw instead of resolving `{saved:false}`: the new "pre-migration copy could not be written" refusal (store.ts:135), and any ENOSPC from `saveWithBackup`. The wrapper only paints on a resolved `!outcome.saved`. A rejection goes to roughly 20 `await io.saveState` sites (and the `void` one at main.ts:534) and ends as an unhandled rejection. Scenario: a v1 profile on a nearly full disk. The snapshot fails at load, then every save throws for the whole session, nothing is kept, and the screen looks normal. DECISIONS.md says "every save refuses until the snapshot succeeds", and the banner comment says "so nobody plays a long session believing it is being kept". Neither is true for this path. Fix: catch in the wrapper (or have main return `{saved:false, readOnly:null, error:'write-failed'}`), show a "Not saving: could not write the profile" banner state, and clear it on the next successful save. Add a store or renderer test for the snapshot-failure case that checks the banner.
- **src/core/units.ts:9-13, 23-38, tests/unit/units.test.ts:13-35. The brand isolation can be bypassed through the constructors, though the docs say it cannot.** The docs say "`reps(…)` fed a Chips value does not compile (tests/unit/units.test.ts pins this)". It does compile. A scratch file with `const b: Chips = emptySession().bankroll; reps(b); chalk(b);` passes `tsc -p tsconfig.json` with exit 0. The test only checks direct assignment. `chalk(session.bankroll)` is the exact chips-to-Chalk conversion the economy rule forbids, and nothing catches it. Fix: `type Unbranded = number & { readonly [unit]?: never }` as the `value` parameter of `reps`, `chalk` and `chips`. Keep `chips`' `fallback: number`. Add `// @ts-expect-error` lines for `reps(bankroll)`, `chalk(bankroll)`, `chips(r)` and `reps(c)`.

## Consider
- **src/core/backup.ts:113-118. On a full disk, failed saves destroy the rolling backups before they fail.** The rotation renames run first, then `copyIfPresent` fails silently and `atomicWrite` throws. Verified with a scratch test that fakes ENOSPC in `fs`: live v4 with baks v3, v2, v1, then 3 failed saves, leaves baks `[none, none, v3]`. v2 and v1 are gone, and the renderer fires saves every few seconds. The live file stays intact. `bak1Present: false` in evidence/disk-full-result.txt is this same loss, not a pass. The ordering predates this branch, but disk-full is in scope here. Fix: write the temp file first. Only after `writeFileSync` succeeds, rotate and copy, then rename the temp into place.
- **src/main/store.ts:127-131. Make the changed-elsewhere guard unable to false-positive.** I could not produce a false positive in normal single-instance use (see Dismissed). It still depends only on stat. Two edge cases would trip it: a filesystem that caches attributes (network home directories), or the `stampOf` after a write returning null, which makes `lastSeen` null and the next save mismatch. Either one silently stops all saving. Fix: keep a hash of the text last read or written. When the stamp differs, re-read the file and trip only if the content differs. Add a test that 25 back-to-back saves never trip it. Tradeoff: one extra read, only when the stamp differs.
- **src/core/backup.ts:150. `sweepTempFiles` does not match `offsuit-state.json.pre-v2.<uuid>.tmp`.** Verified: it returns 0 and the file stays. It also skips settings temps. A crash during the snapshot leaks one profile-sized file permanently. Fix: `^base(\.pre-v\d+)?\.<uuid>\.tmp$`.
- **src/core/backup.ts:181-186. On a re-upgrade, no named copy is taken because the first snapshot is kept.** After a downgrade and months on a pre-v2 build, the re-migration has no copy of the latest v1 file beyond 3 rolling backups, and those are gone within seconds. Also, a pre-v2 build's Delete leaves `.pre-v2` behind, so after a re-upgrade a profile the learner deleted still sits on disk, and Settings may say the original was kept. Tradeoff: the migration only adds fields, so the risk is low. Do you keep the first copy or the most recent one?
- **tests/unit/localDay.test.ts:51-66. The DST test never calls `systemDayKeyOf`.** It builds its own `offsetAt`. The "system agrees" test re-implements the function, so the claimed per-timestamp lookup is untested. Fix: set `process.env.TZ = 'America/Los_Angeles'` (Node applies it at runtime), assert across 2023-11-05, then restore it.
- **tests/unit/profileSchema.test.ts:144. The drift test only checks that serialize's keys are in the shape.** Suppose `deserialize` keeps reading a legacy key that serialize no longer writes. That key would be missing from `PROFILE_SHAPE`, so the carry would write it back on every save. No such key exists today: deserialize's reads and serialize's writes are the same set of keys, checked. Fix: also assert that every `obj.<key>` read in `deserialize` is in the shape, or drive the parser and the shape from one key list.

## Noted
- A pre-v2 build drops `schemaVersion`, `progression` and unknown keys when it saves. This side cannot fix that. Nothing writes `progression` yet (no renderer reference), so nothing is lost today. Once a feature writes it, a downgrade loses it except in the rolling backups.
- An older build without the lock, running at the same time, has no guard. It can overwrite our last save, and our guard then stops us. This copy's work after the other copy's write is lost, which cannot be avoided from this side. The banner does report it.
- `sweepTempFiles` can remove an in-flight temp file of a concurrent older build. That build's save then throws once and the next one retries, so nothing is lost.
- There is no fsync before rename (pre-existing). That matters for power loss, not for a process crash.
- `"schemaVersion": 1e999` parses to Infinity and reads as v1. Absurd input.
- In read-only mode the settings file and the localStorage stores (lesson lexicon, chartBank) still write. They are separate from the profile and the snapshot, and the profile itself is never written.
- `app.exit(0)` (main.ts:222) has no early return. The rest of the module runs, but it only reads the settings file and no writes happen before ready.
- `perf.test.ts` failed once in the full run. Load average was 100-290 because of a concurrent brew upgrade. Re-run alone it passed twice on head, and origin/main failed it once under the same load.

## Dismissed
- **Renderer saves racing through IPC.** `ipcMain.handle('store:save')` calls a fully synchronous `save()`, so main runs invocations one at a time, in arrival order. The last save issued wins.
- **Our own writes tripping the guard.** `lastSeen` is re-stamped after every write (store.ts:139) and after delete (182). Backup rotation only renames backups and copies from live, so it never modifies live. Two saves in the same millisecond each re-stamp. Coarse mtime resolution can only cause false negatives. store.test runs 4 or more back-to-back saves without tripping.
- **An e2e relaunch racing the previous process's exit.** Playwright's `close()` waits for the process `exit` (coreBundle: `onExit` emits Close, and the custom close handler awaits it), so the lock is released before the next launch. If a close is swallowed, the relaunch exits 0 at `firstWindow()`. That is a loud test failure, not data loss.
- **`__proto__` pollution.** `define()` plus `Object.hasOwn` in profileSchema.ts, and the skip in `dayReceipts`, prevent it. Tested by `carry "__proto__" as plain data` and the receipt `"__proto__"` test.
- **The carry resurrecting a value the parser removed.** Known keys are never carried. Maps and lists (`equipped`, `earned`, `awards`, …) are leaves in `PROGRESSION_SHAPE`. Tested by `never resurrect a known value the parser replaced`.

## Data-loss scenarios
| Scenario | Outcome | Test |
|---|---|---|
| Crash between snapshot and first save | safe: disk still v1, migrates again, the existing snapshot is kept | store.test "a crash after the snapshot but before the first save just migrates again on restart" |
| Crash during snapshot | safe, but leaks a `.pre-v2.<uuid>.tmp` that is never swept; the next load snapshots again | untested (sweep miss verified by a scratch test) |
| Crash during the atomic live write | safe: rename is atomic, the temp file is swept | store.test "a crash mid-write leaves only a temp file, which the next load removes" |
| Downgrade to pre-v2, then re-upgrade | loses `progression` and unknown keys written by v2 (empty today); v1 fields kept; no new snapshot | store.test "a pre-v2 build in between loses only what it never knew; the re-upgrade keeps the first snapshot" |
| v3 profile opened by this v2 build | safe: read-only, no profile, backup or snapshot writes; Delete is the only way out | store.test "opens read-only, reports it, and never writes…", "delete is the one way out…" |
| Same-version newer build's extra keys | safe: carried | store.test "a v2 build that is older than the data…", profile-roundtrip.test |
| ENOSPC at snapshot | live safe; every save refused, but **silently** (Act on #1) | store.test "a snapshot that cannot be written blocks the save…" (no renderer test) |
| ENOSPC at backup rotation | live safe; **loses 2 of the 3 rolling backups** within 2 failed saves | untested in repo (scratch test verified) |
| ENOSPC at the write | live safe, temp cleaned up; the session is not saved and **no banner** | evidence/disk-full.mts (real volume) |
| Second instance, same build | safe: the lock makes the second launch exit 0 | e2e profile-schema.spec "a second copy … exits at once" (not run by me) |
| Second instance, older build without the lock | ours stops saving after its write; it can overwrite our last save; this copy's later work is lost | store.test "stops saving instead of overwriting the other copy's progress" |
| Second instance, newer build (with the lock) | safe: the lock | untested |
| Guard false positive in single-instance use | not reproducible locally; theoretical on attribute-caching filesystems | untested (Consider #2) |
| Corrupt or partial progression | safe: per-section defaults, the rest of the profile intact | progression.test "one corrupt section…", "a wholly corrupt progression…" |
| `__proto__` / resurrection | safe | profileSchema.test, progression.test |
| Read-only: anything still writing? | the profile, backups and snapshot are not written; settings and localStorage are; Delete works | store.test "never writes the file, its backups or a snapshot" |

## Verification
- `npx tsc --noEmit -p tsconfig.json`: exit 0. `npx tsc --noEmit -p tsconfig.main.json`: exit 0.
- `npx vitest run`: 1852 of 1853 pass. The one failure is perf under load (see Noted).
- Red-first: I extracted origin/main into /tmp and ran d635155's `profile-roundtrip.test.ts` and `localDay.test.ts` there. 3 of 3 fail, each on the asserted behaviour (key dropped; UTC buckets). HEAD's version of localDay.test fails on main only because the import is missing, which is expected for the implementation version.
- Scratch tests in /tmp/hd (an extract of HEAD): fake ENOSPC rotation (backups lost), the sweep pattern miss, and `reps(bankroll)` compiling.
- Not run: e2e and Electron, as instructed. Still untested: the renderer's handling of thrown saves, backup rotation under ENOSPC, the snapshot temp sweep, a newer build's second instance, and `systemDayKeyOf` across DST.

## Author response (fixed in the next commit)
| Finding | Outcome |
|---|---|
| Save that throws shows no banner | Fixed: `save` returns `{saved:false, failed}`; the renderer also catches IPC rejection and shows "Not saving" until a save lands. Test: store.test "a write that fails". |
| `chalk(bankroll)` compiles | Fixed: the constructors take `Unbranded`; 4 new `@ts-expect-error` mint cases. |
| Full disk wipes backups | Fixed: temp file written before rotation. Test: backups byte-identical after 3 failed saves. |
| mtime/size guard could misfire | Fixed: a changed stamp stops saving only if the sha256 differs. Test: "a file touched but not changed". |
| Snapshot temps never swept | Fixed: the sweep matches `.pre-vN.<uuid>.tmp`. Test updated. |
| Re-upgrade takes no new snapshot | Kept by design: the first copy is the untouched original, and the rolling backups hold the later v1 file. Pre-v2 Delete leaving `.pre-v2`: cannot change old builds; noted. |
| DST test does not call `systemDayKeyOf` | Not changed: the real function depends on the machine timezone. The per-timestamp lookup is tested through `dayKeyAt`, and `systemDayKeyOf` is checked against `Date`. |
| PROFILE_SHAPE drift test is one-way | Not changed: the dangerous direction (serialize writes an unlisted key) is the one tested. An extra listed key only stops a carry. |

## Re-review at ba7ba94
Both blocking items are fixed, and I have no new blocking findings. I tested the fixes on an extract of ba7ba94 in /tmp/hd2, using scratch tests that fake ENOSPC on `writeFileSync`, `copyFileSync` and `renameSync`.

- **(1) Renderer save wrapper (main.ts:248-266): fixed.** `save()` no longer throws: a failed write returns `failed: 'write'`, a failed snapshot returns `failed: 'pre-migration-copy'`, and the wrapper turns an IPC rejection into `failed: 'ipc'`. `saveFailing` is set on any `saved:false` without a read-only reason and cleared by the next save that lands. The in-memory bridge returns `void`, which counts as not failing. A read-only reason takes priority over `save-failing` in `paintReadOnly`. No save runs before the banner exists. Consider: the banner says progress "saves as soon as it can", but a retry only happens on the next action that saves, and quitting while it is showing loses the session. The text could say "keep Offsuit open; it retries on your next action".
- **(2) Temp-first `saveWithBackup` (backup.ts:110-123): fixed for the case reported.** Every failure path unlinks the temp, and no `.tmp` files were left in any probe. Results after 3 failed saves:
  - Temp write fails: live and all 3 backups byte-identical (repo test "a write that fails").
  - Temp write succeeds but the bak1 copy fails (`copyIfPresent` swallows it): all 3 saves go through, but the backups shrink to `[none, none, v3]`, so the previous versions v4, v2 and v1 are gone. This is the likely state on a nearly full disk: the temp file took the last of the space, and the copy needs the same again. **Consider:** `fs.linkSync(file, bak1)` instead of `copyFileSync`. A hard link uses no space and is safe because live is always replaced by rename, never rewritten in place. Fall back to copy if linking fails.
  - The final rename fails: rotation has already run, so all three backups become the live version (v3, v2, v1 lost). The live file is intact. A same-directory rename failing is rare. Noted. Running the rename-dependent steps only once the rename can succeed, or skipping rotation when `renameSync` fails, would close it.
- **(3) Hash-confirmed `changedElsewhere` (store.ts:79-84): fixed.** A changed stamp with identical bytes re-stamps and keeps saving (test "a file touched but not changed"). Different bytes still trip the guard (the existing second-copy test). Noted: `remember()` hashes the file re-read from disk rather than the text just written, so another writer landing in that window is taken as our own write. Also, `hashOf` returning null on a transient read error (for example EMFILE) while the stamp differs would trip the guard. Hashing the written text, and treating a null hash as "unknown, retry" rather than "changed", closes both.
- **(4) `Unbranded` constructors (units.ts:17-38): fixed.** The 4 new `@ts-expect-error` mint cases compile, so each line really errors, and `reps(n)` with `n: number` still compiles (scratch probe, tsc exit 0). Noted: arithmetic and `Number()` still launder a brand (`chalk(bankroll - 0)`, `chalk(Number(bankroll))` compile). That is inherent to TS brands and matches the existing "arithmetic drops the brand" note. The source scan of `core/progression` is the backstop.
- **Author's "not changed" items.** The DST response does not hold: `process.env.TZ` set at runtime makes `systemDayKeyOf` machine-independent, so a real per-timestamp test is possible. The drift response covers serialize writing an unlisted key, not a legacy key that deserialize reads but nothing lists, which the carry would write back on every save. Both stay Consider, not blocking. The re-upgrade snapshot decision is accepted.
- **Verification at ba7ba94.**
  - Both `tsc` configs: exit 0.
  - `npx vitest run`: 1852 of 1855. The 3 failures are all `perf.test.ts` (load average 76-135); re-run alone it passes 7 of 7.
  - The store, backup, units, profileSchema and progression suites plus the scratch probes: 67 of 67 pass.
  - e2e not run, as instructed. The renderer's banner states (`save-failing` set and cleared) still have no automated test.

## Author response to the re-review (next commit)
| Note | Outcome |
|---|---|
| Banner says "saves as soon as it can" | Fixed: "Free some space and keep Offsuit open: the next action saves everything." |
| Re-hash reads the file after the write | Fixed: hashes the text just written. |
| A null hash on a transient read failure trips the guard | Fixed: present-but-unreadable is not a change; a missing file still is. |
| Use a hard link for bak1 on a full disk | Not changed: a link shares bytes with the live file, so an in-place edit or corruption of the live file would corrupt the backup too. Commented in backup.ts. |
| Final rename fails after rotation | Not changed: rare (the temp is already written on the same volume); the live file stays intact. |
| DST test does not use a real timezone | Fixed: `systemDayKeyOf` is tested under TZ=America/Los_Angeles across 2023-11-05. |
| Drift test misses a legacy key that is read but not listed | Not changed: every key deserialize reads is also written by serialize, which the test covers. |

## Streak change (c2a44f7)
Verdict for this commit: **CHANGES REQUESTED**. The streak parser is meant to repair corrupt data, but when the stored fields disagree with the history it trusts the stored values. The counter can also freeze the streak for good. I verified every example below with scratch tests in /tmp/hd3 (an extract of c2a44f7).

### Act on
- **persist.ts:144-153 `parseStreak`. A corrupt stored value can invent a run or cut one, which breaks invariants (1) and (4).**
  - **It invents a run across a gap.** `{current:50, lastCountedDay:100, countedDays:[100,102]}` parses to `current:50`, `lastCountedDay:102`. The history shows a gap, so the true run is 1. The stored `current` belonged to the old pointer (100) but is applied to the new one (102).
  - **It invents a run with no history.** `{current:1e9, lastCountedDay:5, countedDays:[]}` parses to `current:1e9`, `best:1e9`.
  - **It cuts a run when the pointer is ahead of the history.** `{current:1, lastCountedDay:104, countedDays:[101,102,103]}` parses to `current:1`, `lastCountedDay:104`. That is below the history's trailing run of 3, and day 104 is not in the history. `countSession` always writes both fields together, so a pointer outside the history can only come from corruption.
  - Fix: treat the history as the source of truth.
    - `lastCountedDay` = the newest counted day when the history is non-empty. The stated pointer is used only when the history is empty, and then `current` is 1.
    - `current` = `runEndingOn(countedDays, lastCountedDay)`.
    - Raise `current` to the stored value only when `stated === lastCountedDay` and the run reaches the start of a full history (`logged === countedDays.length === MAX_STREAK_DAYS`). That is the only case where the true run can be longer than the log, and it keeps the existing "current: 5000 over a full history" test passing.
    - Add the three cases above as tests.
- **persist.ts:184-197 `countSession` / `currentStreakOn`. A `lastCountedDay` in the future freezes the streak, which breaks rule (2).**
  - If the clock was ahead when a session was counted (or the pointer is corrupt) and is then corrected, `countSession` ignores every real day until that future day arrives.
  - Meanwhile `currentStreakOn` shows the stored run every day, because `today - last <= 1` is true for any negative gap.
  - Probe: last day 20000 with current 5, then sessions on days 19800-19804. Each day leaves current at 5 and shows 5, so the learner gets neither the reset for missed days nor credit for sessions.
  - The "changes nothing" rule is right for a small backward step (flying west can move the DayKey back one), not for a large one.
  - Fix: in `countSession`, when `day < last - 1`, treat it as a clock correction. Drop counted days after `day`, recompute the run with `runEndingOn`, then count `day`. In `currentStreakOn`, return `current` only when the gap is 0 or 1, and treat a gap of -1 or less as "pointer not trusted". Whether the future days are kept or dropped is the owner's call, but the streak must not stop counting. Add a test that moves the clock back.

### Checked and fine
- **best >= current** holds on every path, including parse, `countSession`, and the 800-day run kept past the 730-day history.
- **The pointer is never older than the newest counted day** (`Math.max`).
- **A null pointer with no history** reads as 0. Negative, float and non-integer days are dropped or floored, and duplicates collapse.
- **Same day twice** is a no-op. **The next day** adds 1. **A gap** starts again at 1, and `currentStreakOn` reads 0 after a missed day. **The bounded history** keeps the newest 730 days while `current` and `best` keep counting.
- **Shape:** `PROGRESSION_SHAPE.streak` lists exactly the five fields, and the drift test passes. A stray `restedDays` or freeze field is carried untouched and never read. A `progression.lamp` written by an earlier commit on this branch would be carried forever as an unknown key, but no build with `lamp` ever shipped (origin/main has no `progression`), so no migration is needed.

### Consider / Noted
- **DECISIONS.md:12 still says the migration "does not seed the Lamp".** Edit that line to say the streak.
- **The new AGENTS.md streak line runs past the file's wrap width.**
- **`streak.boundaryHour` is stored but nothing reads it.** Day keys come from `systemDayKeyOf()` with the default hour. If the hour ever becomes a setting, the stored history needs re-keying.

### Verification
- `tsc -p tsconfig.json`: exit 0.
- progression, profileSchema, store and localDay tests: 49 of 49 pass.
- The scratch probes above.
- Not run: e2e (the profile-schema.spec fixture was updated in this commit).

### Re-check at ef9bfc6
Both streak blockers are fixed, and I found no new blockers. I re-ran my probes on an extract of ef9bfc6 in /tmp/hd4.

- **(1) The parser no longer invents or cuts runs.**
  - Run across a gap: `[100,102]` with a stored current of 50 now gives current 1 on day 102.
  - Pointer ahead of the history: `[101,102,103]` with a pointer of 104 now gives current 3 on day 103.
  - Stored 1e9 with no history now gives current 0 and no last day.
  - A full 1000-day run still parses as 1000, because the trailing run fills all 730 days and the stored pointer agrees.
- **(2) A fast clock no longer freezes the streak.** With a last day of 20000, the streak reads 0 on day 19800. Sessions on 19800, 19801 and 19802 then give 1, 2 and 3. Best stays at 5.

**Consider (not blocking):**
- **A one-day step back erases the day just counted** (persist.ts:202-212). Count days 96-100, then a session on day 99. This happens when flying west lands a late session before the 4 am turnover. Day 100 is dropped, the run becomes 4 on day 99, and the streak reads 0 on day 101 unless another session counts day 100. Fix: treat a step of exactly one day back as a no-op, and correct only when `day < last - 1`.
- **A clock correction during a run longer than 730 days cuts it to the history.** A 1000-day run corrected by 5 days becomes 726 instead of 995. Fix: when the kept history still has a full trailing run, keep `current - (last - newest)`. This is rare.
- **A corrupt `best` becomes a 100-year record.** `best: 1e9` with an empty history parses to 36,500. When `countedDays.length < MAX_STREAK_DAYS` the history is complete, so best could be capped at the longest run in the history.
- **Nit:** AGENTS.md line 63 is still past the wrap width, because "Core takes a `DayKeyOf`; only the renderer" stays on the long line.

**Docs:** DECISIONS.md now says "streak" and describes the history-first rule and the clock correction. The `boundaryHour` documentation in types.ts reads correctly.

**Verification:**
- `tsc -p tsconfig.json`: exit 0.
- progression, profileSchema, store, localDay and units tests: 55 of 55 pass.
- Not run: e2e.

## Author response to the streak re-check
| Note | Outcome |
|---|---|
| One day back drops a counted day | Fixed: a one-day step back is ignored; only a larger gap corrects the clock. Test: "one day back (a westward flight before 4 am)". |
| A run over 730 days is cut by a clock correction | Not changed: it needs both a 2-year run and a clock error, and the best run is kept. |
| A corrupt best reads as 36,500 | Not changed: capping best by the history would cut a real record whenever the history itself is damaged. Losing a record is worse than an implausible one. |
| AGENTS.md line width | Fixed. |

---

# Review: hidden e2e and test tiers
Verdict: FAIL (two small act-on items; the runtime change itself is sound)
Base: 2b28855 (origin/main)  Head: 2b28855 + uncommitted working tree (branch test-hidden-e2e-tiers), plus untracked scripts/focus-watch.sh

## Re-verification (author fixes after the FAIL)
- **1, `test:affected` green with nothing run: FIXED.** `scripts/affected-tests.ts` runs the full suite under `--run` when no suite is attributed (`runFullSuite()`).
- **2, placeholder timings: FIXED.** AGENTS.md has the measured figures and the load they ran under.
- **Visible-tier geometry: FIXED.** The off-screen parking is removed from `src/main/main.ts`; the helper floats the window on ws12 and restores 1100x760. `OFFSUIT_E2E_VISIBLE=1` on `layout` + `navigation`: 15/16 passed; the 16th (navigation:168) was a load timeout and passed on rerun. The focused workspace was unchanged (7 → 7), and Electron was never the focused app.
- **Stale comments, env override order, AeroSpace server check: FIXED** (`main.ts` comments rewritten; `OFFSUIT_E2E_HIDDEN` is set after `opts.env`; the check runs `aerospace list-workspaces --focused`).
- **"Supersedes:" line kept.** The project's record rules require it when a decision changes.
- **Hidden full run:** 440 passed, 21 failed, 90 did not run, 1 skipped, in 1.3 h at load avg ~300. The 17 affected files then passed 167/170 on rerun, and the last 3 passed on their own. All are 60s load timeouts that pass on rerun. No Electron window appeared in 4754 + 1495 AeroSpace polls.
- **Verdict after fixes: PASS WITH NOTES.** The note: timings were measured under heavy load.


## Act on
- scripts/affected-tests.ts:248-252 (code that already existed, but this diff makes it a Done gate). When no suite can be attributed, the script prints "running everything" and then calls `process.exit(0)` without running anything, even with `--run`. Failure scenario: a diff that touches only `DECISIONS.md`, `AGENTS.md`, `scripts/focus-watch.sh`, or a `src/` file the selector cannot link. `npm run test:affected` then runs typecheck, prints "running everything" and exits 0, so no unit or e2e test has run. AGENTS.md:16 names "tests, docs" as this tier's use, and AGENTS.md:71 lets that green exit satisfy Done. AGENTS.md:18-19 also says the script "falls back to the full suite by itself", but that is only true for `ALWAYS_FULL` files, not for this branch. Fix: under `shouldRun`, run `npm test -- --run` and `npm run e2e` in this branch (as the FULL SUITE branch does), or exit non-zero. You could also exit non-zero when `orphans.length > 0` under `--run`.
- AGENTS.md:15-17 and DECISIONS.md:27. The tier table still has the placeholders `~SMOKE`, `~AFFECTED` and `~FULL`, and DECISIONS says "the timings are in AGENTS.md". An agent picking a tier gets no cost signal. The old "~45 min" figure was removed and nothing replaced it. Fix: fill in the measured times from the run in progress, or drop the column.

## Consider
- src/main/main.ts:204-207 and 219-222 against the visible tier in tests/e2e/helpers.ts:113-146. In visible mode (`OFFSUIT_E2E_HIDDEN=0`), the main process still calls `moveOffScreen()` after `showInactive()` and on every `resize`. The helper then hands the window to AeroSpace, which tiles it on ws12 at the workspace's size. Scenario: `OFFSUIT_E2E_VISIBLE=1 npx playwright test layout`, the "compare the two modes" use AGENTS.md documents. The layout specs would measure AeroSpace's tile instead of 1100x760 / 900x640. Each AeroSpace resize also fires `resize`, so `setBounds(100000,100000)` fights the tiler. Not run here (no spec uses the visible tier and e2e was off-limits), so this is plausible, not demonstrated. Tradeoff: skipping the re-park when visible and floating the window (`aerospace layout floating --window-id <id>`) adds a few lines to a tier nobody uses yet. The alternative is to state in AGENTS.md that visible-tier geometry is not the documented size.
- src/main/main.ts:194-203 and 116-126. The ready-to-show comment still says e2e uses `showInactive()` so the window "renders but never takes focus". Now the default never shows it, and `showInactive` is the visible tier only. The module-scope comment says the Dock hide "switches the process to an accessory activation policy", but the new line sets that policy explicitly anyway. Tradeoff: comments only; cheap to bring in line with DECISIONS.md:10-15.
- tests/e2e/helpers.ts:47-59. `...opts.env` comes after `OFFSUIT_E2E_HIDDEN`, so a caller that passes `env: { OFFSUIT_E2E_HIDDEN: '1' }` with `visible: true` spins 10s and throws "the window was never shown". No spec does this today (only `OFFSUIT_SAY_BINARY` and tutor env are passed). Tradeoff: setting the HIDDEN key after `opts.env` keeps the two from disagreeing.

## Noted
- helpers.ts:93-101: `aerospace --version` succeeds even if the AeroSpace server is not running. The later `list-windows` call then throws a raw execFileSync error instead of the friendly message.
- AGENTS.md:27-29 and DECISIONS.md:22-23 ("all pass hidden", "No spec needs the visible tier") rest on the full run that is still in progress. Confirm it is green before committing.
- DECISIONS.md:13-14: the "Supersedes:" sub-bullet is history, and the file says "edit the line, do not append history". Minor.
- `.claude/` is in `isArtifact`, so the verify-app edits never count toward selection. That is expected.
- code-review.md is a tracked file, so overwriting it with this review shows up in the working-tree diff.

## Dismissed
- Normal (non-e2e) launch behaviour changed. Proof: `paintWhenInitiallyHidden: true` is Electron's default. `backgroundThrottling: !isHidden` is `true` (the default) whenever `OFFSUIT_E2E` is unset, because `isHidden` requires `isE2E`. The dock and activation-policy block and the `if (isHidden) return` are both gated on e2e, so `mainWindow.show()` is unchanged for a person launching the app.
- `setActivationPolicy('accessory')` before `ready` is unsafe. Proof: `app.dock.hide()` already ran at the same point and sets the same policy, so the new call only repeats it explicitly.
- The smoke filters over-match or under-match. Proof: `npx playwright test --list navigation persistence no-network gameplay` lists "Total: 33 tests in 4 files": exactly those four specs, nothing else (no path segment of the worktree matches).
- A spec bypasses the helper and launches visible. Proof: redesign-capture.spec.ts imports `_electron` but launches only through `launchApp` (lines 76, 98, 119). No other `electron.launch` exists in tests/ or scripts/.
- The visible-tier poll races. Proof: it waits for `isVisible()` (set synchronously by `showInactive` in ready-to-show) before flipping the policy, then polls `list-windows` filtered by the main pid. Both loops are bounded at 10s and throw with a cause.

## Verification
- `npm run typecheck`: exit 0.
- `node scripts/affected-tests.ts origin/main`: exit 0. It lists the 8 changed files (including the untracked focus-watch.sh) and reports FULL SUITE REQUIRED because of package.json, src/main/main.ts and tests/e2e/helpers.ts. On this branch `test:affected` therefore equals the full suite.
- `npx playwright test --list <smoke filters>`: 33 tests in 4 files.
- Not run: any e2e (a run is in progress and owns dist/), the visible tier, and `scripts/focus-watch.sh` (read only; it is executable and its POSIX `sh` is fine on macOS). Nothing tests that hidden mode takes no focus or that the visible tier lands on ws12. The evidence for both is the author's measurement.
