# Offsuit-Desktop — spec

Local-only Electron Texas Hold'em with a teaching layer. Minimal, dark, Offsuit-inspired.

## Self-answered decisions (no user input available; AFK autonomous run)

| Question | Decision | Why |
|---|---|---|
| Game or tracker? | **Game** (offline cash game vs AI) | Research confirmed Offsuit is a Hold'em game, not a bankroll tracker. |
| Stack | **Electron + vanilla TS + Vite**, no React | "Super simple." A 6-max table is ~10 components; React earns nothing here and adds build surface. |
| Renderer | **DOM + CSS**, no canvas | Cards are rounded rects with text. DOM is inspectable by Playwright → agent-testable. Canvas would be opaque to tests. |
| Hand evaluation | **Own evaluator** (7-card, ranked) | Zero deps, fully unit-testable, no license question. `pokersolver` exists but a 5-of-7 evaluator is ~120 lines and we must test it anyway. |
| Equity / win% | **Monte Carlo in a worker**, 2000 iters | Matches Offsuit's "Win 71%" sheet. Exact enumeration is too slow for preflop; 2000 iters gives ±1%. |
| Persistence | **JSON file in `app.getPath('userData')`** | No cloud, no DB, no network. Survives restart. Trivially assertable in tests. |
| AI | **3 rule-based archetypes** (nit / TAG / station) | Needed for the teaching layer's exploitation ladder — the student must have someone to read. Deterministic given a seed → testable. |
| RNG | **Seeded PRNG (mulberry32)**, seed injectable via `--seed` | The single most important testability decision. Deterministic deals = e2e assertions on exact hands. |
| Teaching layer | **EV-loss grading + coach line**, from MANUAL-opus46.md | The differentiator. Grades decisions by bb cost, not right/wrong; stays silent under 0.5bb. |
| Testing | **Vitest** (unit) + **Playwright** (e2e via Electron driver) | Playwright drives real Electron and screenshots — the independent visual oracle. |
| Window | 1100×760, non-resizable-min 900×640 | Desktop adaptation of a portrait phone layout. |

## Roadmap (ALL features must ship + be e2e tested)

- **R1 Core engine** — deck, seeded shuffle, 7-card evaluator, hand ranking, side pots, blinds, betting rounds, street progression, showdown.
- **R2 Table UI** — Offsuit visual language: black canvas, rank-over-pip cards, hatch backs, pill actions, seat pods, dealer button, blind chips, pot.
- **R3 Interaction** — fold/check/call/raise, raise slider + presets (½/¾/pot/all-in), keyboard shortcuts (F/C/R/A), turn gating.
- **R4 AI opponents** — 3 archetypes with distinct, observable frequencies; act on a delay; deterministic under seed.
- **R5 Stats sheet** — live win% (mint) + made-hand category %, bottom sheet, toggleable.
- **R6 Coach layer** — per-decision EV-loss grade, severity tiers (free <0.5bb / notable 0.5–2bb / serious >2bb), one-line reason, silence rule.
- **R7 Session + persistence** — bankroll across hands, hand history log, stats (VPIP/PFR/hands played), survives restart.
- **R8 Home screen** — bankroll numeral, "New session" cards, recent-hands list, 2-tab nav (Play / Profile).
- **R9 Profile/stats screen** — session graph, coach leak summary by concept, lifetime counters.

## Success criteria (each must be proven by a test)
1. `npm test` green: evaluator correct on known hands, side pots, betting legality.
2. `npm run e2e` green: app launches, plays a full hand to showdown, asserts DOM state.
3. Deterministic: same `--seed` ⇒ identical board + hole cards, asserted.
4. Screenshots captured for every screen; visual review confirms Offsuit language.
5. Persistence: bankroll after N hands survives an app restart, asserted.
6. Coach: a deliberate 4bb error triggers a "serious" grade; a 0.2bb deviation triggers silence.
7. Zero network calls at runtime (asserted by failing the test if any request is attempted).

## Non-goals
Multiplayer, accounts, cloud sync, real money, leaderboards, XP, cosmetics, tournaments (cash game only), mobile.
