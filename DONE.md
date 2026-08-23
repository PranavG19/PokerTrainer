# UI fixes — charts grading guard + focus preservation across repaints

Branch: `fix/ui-charts-a11y`

## What changed

### 1. Charts "phantom grading" (CONSOLIDATED #4)
`src/renderer/screens/charts.ts`
- `commit()` guarded only `position === 'BB'`, never the drill `mode`. In `defense` /
  `3bet-response` mode the RFI grid is off screen (those panels own their own grading), yet the
  `document`-level keydown still ran `commit`, which **persisted** a graded RFI answer via
  `onAnswer`/`onSpot` for a spot the learner never saw — corrupting chart mastery and the
  interleave log. Added `if (mode !== 'rfi') return;` at the top of `commit`.
- Added a modifier-key guard to `onKey` (`if (event.altKey || event.ctrlKey || event.metaKey)
  return;`) so Cmd+O / Ctrl+F / Alt+O are not treated as RFI answers. Mirrors the identical guard
  in `drill.ts`, `defenseDrill.ts`, `threeBetResponseDrill.ts`, and the other drill screens.

### 2. Focus dropped to `<body>` on every repaint (CONSOLIDATED #16, a11y)
New helper `src/renderer/focusRestore.ts`
- `withRestoredFocus(container, repaint)` and `beginFocusRestore(container)` capture the focused
  control inside a container before a `replaceChildren` rebuild and restore focus (and any text
  caret) to the equivalent rebuilt control afterwards. Controls are matched by their stable
  `data-*` attributes (`data-testid` plus disambiguators like `data-mode`/`data-position`), which
  the screens re-emit identically each paint. If nothing was focused, or the focused control has no
  `data-*` identity / no rebuilt match, restoration is skipped — focus is never guessed at. This is
  the general form of the explicit focus move `train.ts` already does.

Wired in:
- `src/renderer/screens/table.ts` — `renderControls()` (rebuilds all control pills every state tick).
- `src/renderer/screens/dossier.ts` — `paint()` (rebuilds on every one of ~20 forecast clicks).
- `src/renderer/screens/puzzle.ts` — `paint()`.
- `src/renderer/screens/lesson.ts` — `render()`.
- `src/renderer/main.ts` — `render()`, scoped to the `screen` element. This covers `settings.ts`
  (whose toggles/theme picker repaint via a full screen swap at the router level, not an in-screen
  paint) and every other full-screen rebuild. Scoping to `screen` (not `app`) deliberately leaves a
  real tab switch alone — focus is then on a nav button outside `screen`, so nothing is restored and
  the browser keeps focus on the clicked tab.

## Tests (red-first, real oracles)
- `tests/unit/charts.test.ts` (5 tests) — asserts `onAnswer`/`onSpot` fire only for a real,
  unmodified RFI keypress; not in defense/3-bet modes, not with a modifier held; and resume on
  return to RFI. Verified red-first: 4 fail with the guards removed.
- `tests/unit/focusRestore.test.ts` (7 tests) — real `document.activeElement` oracle after real
  rebuilds, including a negative test that reproduces the dropped-to-`<body>` bug when unwrapped,
  same-testid disambiguation, and text-caret preservation.
- Added `jsdom` as a dev dependency and used per-file `// @vitest-environment jsdom`, so the
  existing node-env unit tests are untouched (the repo otherwise tests DOM only via Playwright e2e,
  which needs an Electron display build and was not run here).

## Verify (real results)
- `npm run typecheck` — PASS, exit 0, no errors.
- `npm test` — PASS, 78 files, **1682 passed / 0 failed** (baseline 1670 + 12 new).

## What I left alone
- The other CONSOLIDATED findings (#1 equity-vs-random grader, #5/#8/#9 relay hardening, #17-#19
  other a11y items, maintainability #11-#14) — out of scope for this task.
- E2E specs: the repo's DOM coverage convention is Playwright, but it needs an Electron display
  build; the new behavior is covered by the jsdom unit tests instead.
- Security posture unchanged: no `innerHTML`/`eval`, CSP/contextIsolation/nodeIntegration untouched,
  no test weakened or deleted.

## Concerns
- The `main.render()` focus restore is broad by design (covers all router-level rebuilds). It only
  acts when a `data-*`-identified control inside `screen` held focus, so tab switches and
  programmatic renders are unaffected — but it is worth an e2e keyboard pass on settings toggles if
  one is run.
