# DONE — Session planner wired into session start (BACKLOG #1)

## What changed
The session planner was built and displayed, but Start discarded it: `home.ts` wired the planner's
Start straight to `onNewSession()`, throwing away the assembled `SessionPlan` and opening the
ordinary default table. The plan is now threaded into session start so the launched session honours
the planned live-hand count.

- **`src/renderer/screens/sessionPlan.ts`** — `onStart` now hands back the ASSEMBLED `SessionPlan`
  (`opts.onStart?.(result.plan)`) instead of just `(minutes, mode)`, so the launcher can parameterise
  the session by what core actually modelled.
- **`src/renderer/screens/home.ts`** — new optional `onStartPlanned?: (plan) => void`, threaded from
  the planner's Start. Falls back to the plain `onNewSession()` when a caller has not wired it, so
  nothing regresses.
- **`src/renderer/main.ts`** — `startTable(plan?)` derives a live-hand limit from the plan's
  `whole-task` block units and passes it to the table; wires `onStartPlanned: (plan) => startTable(plan)`.
- **`src/renderer/screens/table.ts`** — new optional `handLimit`. When set (>0) the table publishes
  `data-hand-limit` and, once that many hands have been played this sitting, shows a planned-complete
  end-state (`session-planned-complete`) instead of offering "Next hand" forever. Absent → the classic
  unbounded table, so every existing caller and the plain New session path are unchanged.

The threading mirrors how session config already flows into `startTable` (bankroll, depth-derived
`startStack`, `coachedMode`, `handNumber`).

## Tests (red-first, real oracles)
- **`tests/unit/session-planner-wiring.test.ts`** (vitest / jsdom) — the required red-first proof.
  Renders `renderHome`, drives the on-screen planner to a 50-minute session, clicks Start, and asserts
  the ASSEMBLED plan (with the 3 whole-task live hands core models) reaches the planned-start handler,
  NOT the plain-default `onNewSession`. Confirmed RED against the pre-fix home (plan discarded), GREEN
  after the wiring.
- **`tests/e2e/session-plan-start.spec.ts`** — behavioural proof at the table: a planned 50-minute
  session carries `data-hand-limit="3"` and ends with `session-planned-complete` after 3 fold-out
  hands (no "Next hand"), whereas the plain New session path is the default unbounded table with no
  hand limit.

## Verification (REAL counts)
- `npm run typecheck` — PASS (clean).
- `npm test` (vitest) — PASS, 79 files / 1700 tests (includes the 2 new wiring tests).
- `npm run e2e` — NOT RUN HERE. The Electron binary cannot download in this sandbox (only a ~256K
  stub arrives), so `electron.launch` fails with "Electron failed to install correctly". The new e2e
  spec compiles and lists (`playwright test --list` shows both tests) and is ready to run where the
  Electron binary is available.

## What I left alone
- The full session-plan ORCHESTRATOR (BACKLOG #1's "first slice": walk `SessionPlan.blocks` and mount
  each block's screen — warm-up, decay-probes, graded-spots, contrast-remediation, whole-task,
  scoreboard — in sequence). That is the L-effort net-new surface; this focused slice threads the
  plan's live-hand count into the existing table, which is the whole-task block the table already hosts.
- Short plans that cut the whole-task block (e.g. a 30-minute session models 0 live hands): those
  allocate no bounded live-hand budget, so `handLimit` is not applied (>0 guard) and the table opens
  unbounded, exactly as today.
- SIMPLIFY.md's L7 (`interleave.ts` framework) — explicitly gated on the planner being wired first;
  left for a follow-up now that intent is clearer.

## Concerns
- The e2e behavioural test is unverified in this environment (Electron download blocked). Run it in CI.
- "Honours the plan" here means the plan's whole-task live-hand count bounds the table. The other
  planned blocks (warm-up, probes, graded spots, contrast, scoreboard) are still not mounted — that is
  the deferred orchestrator, not this slice.
