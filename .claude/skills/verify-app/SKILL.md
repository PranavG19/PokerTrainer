---
name: verify-app
description: Prove a change in the running Offsuit Electron app — launch the built app with Playwright's Electron driver, drive Home and the table, screenshot both documented window sizes, check the console.
---

# Verify Offsuit in the running app

## Launch
- `npm run build` (writes `dist/`; e2e uses the same build). Then `node .claude/skills/verify-app/drive.mjs <outdir>`.
- The script launches `dist/main/main.js` through Playwright's `_electron` with `--seed=42`, an isolated
  `--user-data-dir` in the OS temp dir, and `OFFSUIT_E2E=1 OFFSUIT_E2E_HIDDEN=1` (deterministic, window never shown). No ports.
- Ready means Home has rendered: `[data-testid="home-screen"]`.

## Health check
- The script fails fast unless `nav.tabs button.tab` counts 12 — the right build, not a stale `dist/`.
  If you changed `src/main/`, rebuild first: `dist/` is what launches.

## Drive
- The real user path: Home → `new-hand` → wait for `[data-testid="table-screen"][data-awaiting="hero"]` →
  `btn-call` → the flop. Window size via `BrowserWindow.setContentSize` at 900x640 and 1100x760.
- For other screens, copy the step list in the drive script: tabs are `[data-testid="tab-<id>"]` (`tab-learn`,
  `tab-train`, `tab-charts`, …); Train sub-modes `tab-puzzle`, `tab-drill`, …; coached mode is
  `coach-mode-toggle`, then `predict-<action>`, `confidence-sure`, the action, `gate-input` / `gate-submit`.

## Evidence
- `home-<w>x<h>.png` and `table-<w>x<h>.png` in `<outdir>`, plus one JSON line: the outdir, the tab count, the
  pot text and every console error / page error. A non-empty `errors` exits 1.
- Read the screenshots; a passing script only proves the path ran.

## Cleanup
- The script closes the one app it launched (`app.close()` on its own handle). It never kills by process name.
  The temp user-data dir is left for inspection; delete it by path if you want.
