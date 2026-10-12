# Review: feat/profile-schema-v2
Verdict: CHANGES REQUESTED (streak change at c2a44f7; the profile-schema work was PASS WITH NOTES at ba7ba94)
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
