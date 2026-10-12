# BUILD-PLAN — a swarm plan for The Back Room

Work packages (WPs) for parallel coding agents, ordered into waves. Sources:
[`panel/technical-architect.md`](panel/technical-architect.md) §12, re-cut so the skeptic's prerequisites come
first, plus [VISION.md](VISION.md) §3.

**How to read the estimates.** "Agent-hours" means one coding agent's wall-clock time to a green package
(unit tests passing, typecheck clean, the package's own e2e specs passing), assuming the decisions it depends
on are signed. These are bold, deliberately: an agent on a pure `src/core` module with a clear contract
usually finishes faster than it predicts. They are **estimates, not measurements**. Integration time is
counted separately, because the full e2e suite takes about 45 minutes per run, and that, not typing, sets the
pace.

## Ground rules for the swarm

- **Hotspot owners.** One package at a time may touch each shared file, and the others hand it their changes
  as a patch:

  | Shared files | Owner, in order |
  |---|---|
  | `core/session.ts`, `main/store.ts`, `core/backup.ts` | F |
  | `core/coach.ts` | 0.2, then 0.3 |
  | `main/main.ts`, `main/preload.ts` | H, then a queue: 2.8, 2.11, 3.1 |
  | `renderer/main.ts` (routes) | 1.14 (navigation), then 1.5, 1.7, 1.13, then 2.x screens |
  | `styles-glass.css` (tokens only) | 1.2 |
  | `renderer/screens/table.ts` | 0.4, then 0.5, then 1.4, then 2.1, then 2.12 |
  | `screens/settings.ts` | 0.8, then 1.8, then 2.8 |
  | `screens/home.ts` | 0.8, then 1.5, then 1.11 |

- **Every package** runs `npm run typecheck`, `npm test` and its own e2e specs
  (`node scripts/affected-tests.ts --run`) while iterating. **Integration commits** run the full
  `typecheck && test && e2e` and `git checkout screenshots/` afterwards.
- **No dependency changes, no network.** The CSP and `no-network.spec` stay as they are unless D3 is
  overruled.
- **Content lint is CI-hard.** Every line, label and cosmetic name goes through `bannedPhrasingIn`, `guard.ts`
  word limits and the leading-pronoun check.
- **Pins:** keep `--text-hi`, `--positive`, the to-act ring and 1.02 scale, Fold with no shadow, and the seat
  opacity order. Any change goes in DECISIONS.md with its reason.

---

## Wave 0 — Truth and foundations (gates everything; mostly parallel)

| WP | Package | Depends on | Files (N new, T touched) | Tests | Agent-h |
|---|---|---|---|---|---|
| **0.1** | Spec v2.2 amendment text and DECISIONS lines (the agent drafts, the **owner signs**) | — | T `PRODUCT-SPEC.md`, `DECISIONS.md`, `research/TEACHING-METHOD.md` cross-refs | doc lint (banned phrasing in the amendment's examples) | 1 + **owner** |
| **0.2** | Close-spot band: noise-aware severity, plus a `close` flag on `Grade` | — | T `core/coach.ts`; N `core/closeSpot.ts` | unit: MC-error band at 2,000 iterations, threshold fixtures, NaN stays `free` | 2 |
| **0.3** | Preflop graded from the charts | — | T `core/coach.ts`, `core/table.ts`; reads `core/preflop.ts`, `core/chartBank.ts` | unit: open, defend and 3-bet fixtures per seat | 3 |
| **0.4** | Villain ranges by archetype and street | — | T `renderer/screens/table.ts:589`, `core/assessmentBlock.ts:212`; N `core/villainRanges.ts` | unit: range widths per archetype; regression on existing grader tests | 3 |
| **0.5** | The tilt check (proxy, block break, interrupt suppression) | — | N `core/tilt.ts`; T `screens/table.ts` (a hook only) | unit: 3×T2+ under 40% of median RT; e2e `tilt.spec` | 2 |
| **0.6** | Local-day boundary at 4 am | — | T `core/career.ts:103` | unit: time-zone and DST fixtures | 1 |
| **F** | Schema v2: `schemaVersion`, a `progression` namespace, forward-only `migrate.ts`, `snapshotBeforeMigrate`, read-only for newer profiles | **D2 signed** | N `core/migrate.ts`, `core/progression/types.ts`; T `core/session.ts`, `main/store.ts`, `core/backup.ts` | unit: migration fixtures v1→v2, downgrade guard, idempotence; e2e `profile-migrate.spec` | 4 |
| **H** | Test clock (`OFFSUIT_NOW`, e2e only), progression fixtures, bundle-budget script, animation pause under e2e | — | T `main/main.ts`, `main/preload.ts`, `scripts/affected-tests.ts`; N `scripts/bundle-budget.ts` | `ipc-channels.test.ts`; budget script in `npm test` | 2 |
| **0.7** | Re-run Experiment 1 after 0.2–0.4 | 0.2, 0.3, 0.4 | N `research/EXPERIMENT-1b.md` | — | 2 + review |
| **0.8** | 18+ and audience statement in onboarding and About | D11 | T `screens/settings.ts`, `screens/home.ts` (first run) | e2e assertion in `navigation.spec` | 0.5 |

**Wave 0 exit criteria:** the tie and no-opinion rates from 0.7 are reported, and the owner judges the grader
fit to drive rewards. This is a judgement call. A suggested pre-registered target, written now: no opinion on
under 20% of decisions, and no severity flip from re-seeding the Monte Carlo on a fixed spot set
**[speculation; the owner sets the real numbers]**. If it is not fit, rewards wait; the character can still ship pose-only.

---

## Wave 1 — Core: Dee, the Lamp and receipts (the recommended first wave)

| WP | Package | Depends on | Files | Tests | Agent-h |
|---|---|---|---|---|---|
| **1.1** | Cast engine: line types, deterministic selector (`rng.ts`), cooldowns in hands and sessions, depth quieting, the mute matrix twin; starter banks of about 120 lines | types only | N `core/cast/{types,select,policy,banks/*}.ts` | unit: `cast-select` (determinism, `null` = silence), `cast-lint` (every line), `cast-policy` (silent pre-commit, in drills and in assessments) | 4 |
| **1.2** | The Dee rig: TS path data, `components/dee.ts` (`createElementNS`), ten poses, tokens, reduced motion; `assetsInlineLimit: 0` | D8 | N `renderer/art/dee.ts`, `components/dee.ts`, `styles-character.css`; T `styles-glass.css` (tokens), `vite.config.ts` | unit: pose → parts map; e2e `character.spec` (no animation while hero is to act, none under reduced motion, no visible change after a free grade) | 4 |
| **1.3** | Progression core: Reps award ledger (keyed per award, idempotent), the Lamp, Rhythm, wicks, Pause, today's ring, Seals (derived), milestones | F types, 0.6 (local day), H (test clock), D1, D5 | N `core/progression/{reps,lamp,ring,seals,milestones}.ts` | unit: time travel with `OFFSUIT_NOW`, award idempotence, "chips earn 0" by type, rested days never break | 4 |
| **1.4** | Table integration: pose-only in-hand, the perch on the verdict sheet, the hand-end beat, "Price held" (D6), tilt hook | 1.1, 1.2, 0.2, 0.4, 0.5, D6, D7 | T `screens/table.ts`, `components/coachPanel.ts`, `components/predictPanel.ts` | e2e: extend `coached-handover.spec` (still one bone primary), new `dee-table.spec`; all existing table pins | 5 |
| **1.5** | Progression host plus Home: one diff → award → save; perch in the title bar; greeting; Lamp; ring; Ticket entry | F, 1.1–1.3, H | N `renderer/progressionHost.ts`; T `renderer/main.ts`, `screens/home.ts` | e2e `home-dee.spec`, `lamp.spec` (rest days, wicks, 4 am boundary) at 900×640 and 1100×760 | 5 |
| **1.6** | Lessons as dialogue (Interrogator first, commit before reasoning, the Folio hand-off) | 1.1, 1.2 | T `screens/lesson.ts`, `styles-lesson.css`; reads `lessons/content/*` | e2e: extend `lesson.spec`; unit: each lesson's prompt never reveals the action | 4 |
| **1.7** | Receipt cosmetics (no currency): card backs, felts, Dee rims as paint-only attributes; Locker v1; equip persistence | F, 1.2 | N `core/cosmetics/catalogue.ts`, `screens/locker.ts`, `styles-cosmetics.css`; T `components/card.ts` (data attributes only) | e2e: extend `theme.spec` to every slot (zero layout delta), `locker.spec` (computed-style allowlist) | 4 |
| **1.8** | Settings: Character, Celebrations and Rhythm; Pause; the local trial harness (on/off blocks, written prediction, kill criteria) | 1.3 | T `screens/settings.ts`; N `core/trial.ts` | unit `trial`; e2e `settings.spec` additions | 2 |
| **1.9** | Onboarding: five sheets with Skip; assessment with Dee silent | 1.2, 1.5, 0.8 | N `screens/onboarding.ts` | e2e `onboarding.spec`; fresh-profile `navigation.spec` (nothing locked) | 3 |
| **1.10** | Celebration moment (session end only, 1600 ms cap; the milestone clack behind the sound switch, D13) | 1.2, 1.3, D13 | N `components/moment.ts` | e2e: never fires on a verdict; reduced motion | 2 |

| **1.11** | Today's Ticket (a sub-30-minute review unit, D16) | 1.3, 1.5, D16 | N `core/ticket.ts`; T `core/sessionPlan.ts`, `screens/home.ts` | unit: the Ticket only takes what is due plus one drill plus three leak spots; e2e `ticket.spec` | 3 |
| **1.12** | Folio, the Rulebook: sentence cards, tarnish on decay, re-polish on review, one-page export | 1.1, F | N `core/folio.ts`, `screens/folio.ts`; reads `core/lexicon.ts`, `core/schedule.ts` | unit: tarnish follows `schedule.ts`; e2e `folio.spec` | 3 |
| **1.13** | Profile: Seals, milestones, keepsake shelf, decisions not results (assessment EV loss, calibration) | 1.3 | T `screens/profile.ts`, `styles-progress.css` | e2e: extend `profile.spec`; no bankroll or percentile on the page (asserted) | 3 |
| **1.14** | Navigation (D9): the nine-tab set and the mapping of the old tabs; nothing locked | D9 | T `renderer/main.ts`, `screens/*` entry points | e2e: `navigation.spec` (every old destination reachable at 900 px) | 2 |

Socratic interrupts and per-concept fading ride inside 1.6 (lessons) and 1.4 (table). They need no package of
their own.

**Wave 1 total:** about 48 agent-hours of package work. With 6–8 agents in parallel, that is **roughly one to
two working days of wall-clock**, plus integration. Integration is about five integration commits × the
45-minute full suite, with fixes in between, so 1–2 more days. This is a speculative estimate.

---

## Wave 2 — Bold

| WP | Package | Depends on | Files | Tests | Agent-h |
|---|---|---|---|---|---|
| **2.1** | The Long Orbit: chapter types, runner, map screen, the Kitchen Table plus 6 rival chapters, boss hands, keepsakes | 1.1, 1.2, 1.5, 0.4, 2.2, D17 | N `core/campaign/*`, `screens/story.ts`; T `core/tableTalk.ts` (rival hook), `screens/table.ts` | unit: every chapter's lessons exist and boss puzzles validate; e2e `story.spec` (any chapter can be opened) | 8 |
| **2.2** | Rivals: six rival banks, medallion art, showdown banks, session-drawn profiles | 1.1, 0.4 | N `core/cast/banks/rival-*.ts`, `renderer/art/rivals.ts` | `cast-lint`; unit: no in-hand archetype flavour (the `tableTalk` invariant) | 4 |
| **2.3** | The Masquerade epilogue | 2.1, 2.2 | T `core/reads.ts` (read-only use), `screens/story.ts` | unit: the Folio ink gate at 20 hands | 3 |
| **2.4** | Teach Dee (contrast sets played from your sentences) | 1.1, 1.6 | N `core/teachDee.ts`; T `screens/contrast.ts` | unit: repair detection | 4 |
| **2.5** | Ghost Rail league (offline; labelled bots and your own past weeks) | 1.3, D18 | N `core/progression/rail.ts` | unit: no demotion; fictional characters labelled | 2 |
| **2.6** | Chalk (D4): earn curve, daily cap, fixed prices, chips-isolation test, Locker prices | 1.3, 1.7, **trial result** | N `core/economy/*`; T `screens/locker.ts` | unit: branded-type isolation, cap, no conversion paths | 3 |
| **2.7** | Seasons (free track, delayed-test finale, archive) | 1.3, 1.7 | N `core/progression/season.ts` | unit with the time-travel clock | 3 |
| **2.8** | Profile export and import, challenge codes (QR drawn locally) | F, H | N `core/challengeCode.ts`, `core/qr.ts`; T `main/main.ts`, `main/preload.ts` (queued) | unit: round trip; e2e via the file dialog stub | 4 |
| **2.9** | LAN Club and Home Game Night (cooperative) | 2.5, 2.8 | T `core/multiplayer.ts`, `core/relayServer.ts`, `main/relaySession.ts` | `relayServer`/`multiplayer` unit tests; LAN e2e | 5 |
| **2.10** | Pro core: HH parsers (Stars, GG, ACR), leak finder with binomial bands, ICM / bubble factor / push-fold, range-vs-range equity, plus a Worker spike | D18, trial passed | N `core/pro/*`, `renderer/leakWorker.ts` | unit: parser fixtures for each site; ICM against hand-computed values | 8 |
| **2.11** | Pro UI and IPC: import dialog, NDJSON store outside the profile, two screens | 2.10, H | N `screens/pro*.ts`, `main/hhStore.ts`; T `main/main.ts`, `main/preload.ts` (queued) | e2e `pro-tools.spec`; imports earn nothing (asserted) | 5 |
| **2.12** | 6-max table | 0.4 | T `seatLayout.ts`, `screens/table.ts` | the existing seat-rule unit tests; table pins | 3 |
| **2.13** | Celebrations, chip sets and themes catalogue (paint only) | 1.7 | T `styles-cosmetics.css`, `store.ts` THEMES | `theme.spec` | 2 |

**Wave 2 starts only after the Wave-1 trial passes.** **Wave 2 total:** about 54 agent-hours. With 8–10 agents that is two to three days of package work, plus
integration (the `main/preload` queue and the `table.ts` owner serialize part of it). This is a speculative
estimate.

## Wave 3 — Moonshots (each needs its own decision)

| WP | Package | Depends on | Notes | Agent-h |
|---|---|---|---|---|
| 3.1 | LLM flavour via `tutor:flavour` (D12) | 1.1 | The guard is reused; a scripted fallback; no call without credentials | 3 |
| 3.2 | Dee's voice via `speech.ts` | 1.1 | Off by default | 2 |
| 3.3 | Offline-solved spot bank and node-locking-lite | 2.10 | The **solver runs offline, by a human-run pipeline**; the app only ships data | 6 + pipeline |
| 3.4 | Bankroll view (D10) | 2.11 | Needs a responsible-gambling review first | 3 |
| 3.5 | Backend leagues, friends, sync (D3) | all | A new network spec, opt-in, CSP and `no-network.spec` changes, ops | unbounded |

---

## Critical path

**D1 + D2 signed → F (schema v2), with 0.6 and H alongside → 1.3 (progression core) → 1.5 (host and Home) →
Wave-1 integration (1.4 and the other Wave-1 packages join here; full e2e) → Wave-1 trial (four calendar weeks)
→ Wave 2 (2.1 Story, 2.6 Chalk, 2.10 Pro) → Wave-2 integration.** 1.4 runs in parallel with 1.3 and 1.5 and
needs 0.2, 0.4 and 0.5. It is on the critical path only if the grader fixes run late.

Packages 0.2–0.6, H, 1.1 and 1.2 have no upstream dependencies and start at once. Pro (2.10) waits for D18 and
the trial, as PITCH §5 recommends.

## Which decision gates which package

| Decision | Gates |
|---|---|
| D1 (v2.2 amendment) | 1.3, 1.5, 1.7, 1.10–1.13 (anything that shows Reps, the Lamp or cosmetics) |
| D2 (schema) | F, and everything that persists |
| D3 (backend) | 3.5 only |
| D4 (Chalk) | 2.6 |
| D5 (streak unit) | 1.3 |
| D6 ("Price held") / D7 (in-hand words) | 1.4 |
| D8 (mascot) | 1.2 |
| D9 (navigation) | 1.14 |
| D10 / D18 (Pro scope, bankroll) | 2.10, 2.11, 3.4; D18 also gates 2.5 |
| D11 (18+) | 0.8 |
| D12 (LLM flavour) | 3.1 |
| D13 (sound) | 1.10 |
| D14 (grader gates rewards) | the Wave 0 exit criterion |
| D15 (trial) | 1.8, and the start of Wave 2 |
| D16 (Ticket) | 1.11 |
| D17 (rivals everywhere) | 2.1, 2.2 | Wave 0's grader fixes
(0.2–0.4 → 0.7) run in parallel with Wave 1's pure modules. Their result gates whether **rewards** (not the
character) ship.

## What is genuinely slow, whatever the agent speed

| Item | Why agents can't compress it | Realistic span |
|---|---|---|
| **Owner decisions** D1–D18 | The spec amendments and the schema change are reserved for the owner; there are 18 decisions, down from about 65 raised by the panel | Days, at the owner's pace |
| **Art direction of Dee** | Taste. The mocks are a direction, not final art. Expect 2–3 review rounds. | A week of elapsed time |
| **Writing and QA of lines** | About 400 lines for the cast and rivals. Lint catches banned words, not tone. A human must read them all. | 2–4 human-days |
| **Playtesting and the trial** | Four weeks on/off is calendar time; learning effects need delayed tests | 4+ weeks, irreducible |
| **Legal and policy review** (simulated gambling, minors, stores) | Not an engineering task; the list is in VISION §4 | Weeks, external |
| **The full e2e suite** | About 45 minutes a run, one worker; every integration commit pays it | 5–10 runs per wave |
| **Merging the glass redesign** | The branch this is cut from is still an unmerged draft | Owner review |
| **Backend and ops** (only if D3 is overruled) | On-call, privacy policy, data retention | Ongoing |
