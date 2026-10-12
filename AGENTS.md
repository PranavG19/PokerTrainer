# Offsuit

Electron + TypeScript desktop Hold'em trainer. `src/core/` is pure poker logic (engine, grader, schedulers;
no DOM), `src/main/` is the Electron main process (window, store, network seal, LAN relay), `src/renderer/` is
the UI: plain DOM in `screens/*.ts` and `components/*.ts`, plain CSS, no framework.

## Commands
- Fast check (seconds): `npm run typecheck`
- Unit tests: `npm test` (vitest, `tests/unit/`)
- Full verify: `npm run typecheck && npm test && npm run e2e` — `e2e` builds `dist/` then runs Playwright
  against the real Electron app (`tests/e2e/`, one worker, ~45 min). All three must be green on the final commit.
- Iterating only: `node scripts/affected-tests.ts` (Node 26 runs the .ts directly; `tsx` is not installed and
  must not be fetched) prints the suites a diff can break, `--run` runs them. It is a
  shortcut for the loop, never the evidence for a commit — the full suite is.
- Run locally: `npm start` (builds, then opens the window).

## Boundaries
- No dependency changes and no network: `no-network.spec` and the CSP in `index.html` (no remote fonts or
  scripts) enforce it. Do not reinstall or add packages.
- e2e runs overwrite tracked files in `screenshots/`. Never commit those side effects: `git checkout screenshots/`.
- Pushing, opening PRs and merging are the human's.

## Look and styling (the glass system)
- `src/renderer/styles-glass.css` is the design system: tokens, materials, the shared `g-` component kit, the
  table, the coach sheets. Read its header and "Shared primitives" before styling anything. The mock it was
  built from is `demo/glass/` (`tokens.css`, `glass.css`, `*.html`); the decisions are in `DECISIONS.md`.
- Tokens only: the type scale `--t-cap … --t-hero` (11 12 13 15 17 22 28 34), ink `--ink-1/2/3`, the one state
  ramp `--fill-0…3`, radii `--r-xs/thumb/ctl/group/dock/sheet` (4 6 8 12 14 20), heights `--h-sm/ctl/lg`. No
  hex literals or orphan sizes in screen sheets.
- Colour role map (each hue one meaning): neutrals = structure; bone = cards and the ONE primary action per
  screen; mint (`--positive`, pinned by e2e) = your turn, positive deltas, an ON switch — never a balance;
  coral = serious / wrong / negative; amber = notable and the gate timer; felt green = the table only.
- Compose the kit (`.g-group` for actionable lists only, `.g-sect`/`.g-flat` for informational ones, `.g-seg`
  + `components/thumb.ts` for any segmented choice, `.pill` / `.pill.primary` / `.pill.quiet`, `.g-kbd` via
  `components/glyphs.ts`) instead of restyling per screen.
- Load order: `styles-glass.css` loads before the per-screen sheets, so a screen rule of equal specificity
  wins over the kit. A theme block (`html[data-theme]`) may change paint only, never layout (`theme.spec`).
- Every screen must fit 900x640 and 1100x760 with no page scroll; many specs pin this.
- e2e pins to keep: `--text-hi` #FFFFFF, `--positive` #3DDC97, the to-act ring and 1.02 scale, Fold with no
  box-shadow, seat opacity order live > folded > busted. Change a pin only with the reason in `DECISIONS.md`.

## Routing
- `DECISIONS.md` is the living decision record; edit the line, do not append history.
- To prove a change in the running app, use `.claude/skills/verify-app/SKILL.md`.

## Done
- `npm run typecheck`, `npm test` and `npm run e2e` exit 0 on the final commit.
- UI changes: screenshots of the running app at 900x640 and 1100x760.
- Changed files, any spec change with its reason, skipped checks and open concerns reported.
