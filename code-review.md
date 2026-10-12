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
