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
Verdict: FAIL (BLOCK: 4 act-on items)
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
