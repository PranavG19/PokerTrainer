# Offsuit Implementation Study Guide

This guide describes the implementation at source commit `7b57233`. It treats source, build
configuration, and executable tests as evidence. README and product-spec claims are not evidence.

## 1. System Map

Offsuit is a TypeScript modular monolith split across three runtime zones:

```text
Renderer (DOM, no Node)
  src/renderer/main.ts + screens/components
                |
                | window.offsuit (contextBridge)
                v
Preload (narrow IPC facade)
  src/main/preload.ts
                |
                | ipcRenderer.invoke / main -> renderer event
                v
Electron main (privileged adapters)
  src/main/main.ts
  store, filesystem, speech, tutor, TCP relay, network seal
                |
                v
Core modules (mostly deterministic domain logic)
  table, evaluation, equity, coaching, pedagogy, persistence model
```

The important qualification is "mostly": [`src/core/backup.ts`](../src/core/backup.ts)
contains Node filesystem code, while the rest of `src/core` is generally platform-free.

### Runtime ownership

| Concern | Actual owner | Evidence |
|---|---|---|
| Window lifecycle and privileged capabilities | Electron main | [`src/main/main.ts`](../src/main/main.ts) `createWindow`, `app.whenReady` |
| Renderer-to-main API | Preload | [`src/main/preload.ts`](../src/main/preload.ts) `contextBridge.exposeInMainWorld` |
| Application composition and navigation | Renderer | [`src/renderer/main.ts`](../src/renderer/main.ts) `boot`, `render`, `renderTab` |
| Poker rules and settlement | Core | [`src/core/table.ts`](../src/core/table.ts) `startHand`, `legalActions`, `applyAction`, `settle` |
| Decision coaching | Core, orchestrated by table screen | [`src/core/coach.ts`](../src/core/coach.ts) `gradeDecision`; [`src/renderer/screens/table.ts`](../src/renderer/screens/table.ts) `heroAct` |
| Durable profile | Main filesystem adapter plus core parser | [`src/main/store.ts`](../src/main/store.ts) `load`, `save`; [`src/core/session.ts`](../src/core/session.ts) `serialize`, `deserialize` |
| Optional model tutor | Main only | [`src/main/tutor/index.ts`](../src/main/tutor/index.ts) `resolveTutor`, `askTutor` |
| Multiplayer authority | Pure room/server core hosted by main TCP | [`src/core/relayServer.ts`](../src/core/relayServer.ts) `RelayServer`; [`src/main/relayHost.ts`](../src/main/relayHost.ts) `createRelayHost` |

## 2. Electron Boundaries

### Main and renderer isolation

`createWindow` enables `contextIsolation`, disables `nodeIntegration`, and loads a CommonJS
preload. The renderer is loaded from a built local file. This is the right baseline Electron
shape: renderer code cannot import `fs`, spawn processes, or open the relay directly
([`src/main/main.ts`](../src/main/main.ts) `createWindow`).

The preload exposes named operations rather than raw `ipcRenderer`
([`src/main/preload.ts`](../src/main/preload.ts)):

- Profile: `loadState`, `saveState`
- Runtime: `getSeed`
- Tutor/settings: `tutorStatus`, `askTutor`, `readSettings`, toggles, delete
- Speech: `speak`
- Multiplayer: status, host/join/action/deal/stop, plus `onMpEvent`

Main registers the corresponding request handlers in one block
([`src/main/main.ts`](../src/main/main.ts) `app.whenReady`). A lexical test checks that invoke
channels and handle channels stay paired
([`tests/unit/ipc-channels.test.ts`](../tests/unit/ipc-channels.test.ts)).

### Boundary strengths

1. The renderer receives no model client, AWS profile, filesystem path writer, child-process
   handle, or socket.
2. Profile deletion is re-authorized in main and again in the filesystem helper, not trusted to
   UI state (`settings:deleteProfile`, `backup.deleteProfile`).
3. Multiplayer views are generated per player by `viewFor`; the deck is absent and opponents'
   cards are `null` before showdown
   ([`src/core/multiplayer.ts`](../src/core/multiplayer.ts) `viewFor`).
4. Speech passes text as an argv item to `spawn` with `shell: false`; it cannot select the binary
   through IPC ([`src/main/speech.ts`](../src/main/speech.ts) `speak`).

### Boundary weaknesses

TypeScript declarations do not validate IPC at runtime. Several preload methods deliberately use
`unknown`, but main then accepts values as `AskInput`, `Action`, or `Record<string, unknown>`
without a complete parser:

- `tutor:ask` forwards a cast-shaped `AskInput`.
- `store:save` accepts and writes any object.
- `mp:action` forwards an `Action`.
- `safeServerMessage` checks only the top-level message type, then casts the whole payload.

See [`src/main/main.ts`](../src/main/main.ts) `ipcMain.handle` registrations and
[`src/main/relaySession.ts`](../src/main/relaySession.ts) `safeServerMessage`. Context isolation
reduces who can invoke these paths, but a compromised renderer can still send malformed values.

The CSP is useful but not maximally strict: it permits inline styles and is duplicated in
`index.html` and `main.ts`. There is no navigation/window-open policy in `createWindow`. Those are
defense-in-depth gaps, not evidence that normal local-file loading is unsafe.

### The development-mode trap

`npm run dev` starts Vite only. In a browser there is no preload, so renderer `bridge()` installs
an in-memory substitute with only load/save/seed
([`src/renderer/main.ts`](../src/renderer/main.ts) `bridge`). It does **not** exercise:

- Electron IPC or context isolation
- filesystem persistence
- the network seal
- tutor settings or Bedrock
- speech
- multiplayer

Use it for fast visual work, not for proving desktop behavior.

## 3. Poker Engine and State Machine

### State representation

`TableState` is a mutable-looking plain data graph returned as a new JSON clone on public
transitions. Public fields hold seats, board, street, pot, current bet, actor, dealer, deck, log,
and winners. Internal bookkeeping is attached through a cast to `HiddenState`:

- `_seed`
- `_startStacks`
- `_streetActed`
- `_raiseCapped`

See [`src/core/table.ts`](../src/core/table.ts) `TableState`, `HiddenState`, and `h`. This keeps
states serializable, but the cast means the compiler cannot prove that hidden fields exist. The
engine relies on creation through `createTable` and cloning through `clone`.

### Hand lifecycle

```text
createTable
  -> startHand
       rotate funded dealer
       seed shuffle with seed + handNumber
       post blinds and deal
       choose first actor
  -> legalActions(state)
  -> applyAction(state, action)
       assertLegal
       move chips / mark fold or all-in
       close round? -> advanceStreet
       otherwise -> next actor
  -> showdown or one player remains
  -> settle
       build side pots and refunds
       evaluate eligible hands
       split pots and odd chips
       clear betting state
  -> startHand again
```

Core symbols: [`src/core/table.ts`](../src/core/table.ts) `createTable`, `startHand`,
`legalActions`, `assertLegal`, `applyAction`, `isRoundComplete`, `advanceStreet`, `isHandOver`,
`settle`, `buildSidePots`.

### Rules implemented

- Heads-up and multiway blind/button order
- Sat-out zero-stack seats
- Partial blind all-ins
- Minimum raises and all-in raises below the minimum
- Reopening and non-reopening action after short all-ins
- Burn cards and street progression
- Fold wins, showdown evaluation, side pots, uncalled-chip refunds, split pots, odd chips
- Deterministic dealing and deterministic AI streams

Action validation is in the engine, not just the UI. Illegal action kinds and invalid bet/raise
amounts throw before mutation (`assertLegal`). Multiplayer adds ownership and turn checks before
calling the same engine
([`src/core/multiplayer.ts`](../src/core/multiplayer.ts) `applyPlayerAction`).

### Evaluation and equity

[`src/core/evaluate.ts`](../src/core/evaluate.ts) `evaluate` computes the best five-card category
from five to seven cards and packs category/kickers into a sortable integer. It handles the wheel
straight explicitly.

[`src/core/equity.ts`](../src/core/equity.ts) provides two different tools:

- `equityVsRandom`: seeded Monte Carlo against random opponent holdings, used for visible coaching
  at `DISPLAY_ITERATIONS = 2000`.
- `exactEquityHeadsUp`: exhaustive board completion when both hands are known.

The exact implementation is independently cross-checked against Monte Carlo and zero-sum
properties in
[`tests/unit/equity-crosscheck.test.ts`](../tests/unit/equity-crosscheck.test.ts).

### Renderer-level application state

The core knows poker rules, but the solo game state machine is in
[`src/renderer/screens/table.ts`](../src/renderer/screens/table.ts):

- `advance` alternates hero and delayed AI turns.
- `heroAct` coordinates commitment, grade, decision log, engine transition, and prediction tally.
- `openGate` / `resolveGate` withhold and later reveal costly feedback.
- `finishHand` settles, records the hand, and derives observed villain gifts.
- `nextHand` resets UI state and invokes the next core transition.

This split is pragmatic and testable, but `renderTable` is also a large closure containing domain
orchestration, timers, persistence callbacks, accessibility output, and DOM rendering.

## 4. Decision Grading and Pedagogy

### What `gradeDecision` actually grades

The coach is **not** a GTO solver and does not compare all legal actions. It evaluates the chosen
action using hero equity against random hands and fixed heuristics
([`src/core/coach.ts`](../src/core/coach.ts) `gradeDecision`):

| Chosen action | Implemented rule |
|---|---|
| Call | Compare pot share with `toCall / (pot + toCall)` |
| Fold facing a bet | Penalize only when estimated equity exceeds the price |
| Fold for free | Charge half-realized equity from the existing pot |
| Check | Penalize only on turn/river above a `0.55` equity threshold |
| Bet/raise/all-in facing a bet | Penalize equity shortfall against the call price |
| Bet/raise/all-in unopened | Penalize equity below `0.35` with a fixed multiplier |

Severity is fixed at `<0.5bb = free`, `<2bb = notable`, otherwise `serious`.

Important limits:

- Opponent ranges are random, not inferred from actions or archetypes.
- Fold equity is absent.
- Multi-action EVs and a best action are not computed.
- Position, blockers, sizing, stack, and bet size are not modeled comprehensively. `stack` and
  `betSize` are accepted by the input but are not used by the current calculation.
- Monte Carlo is deterministic for a seed, but remains an estimate.

The messages should therefore be read as beginner heuristics, not solver ground truth.

### The learning loop

Coached play implements a useful retrieval-and-feedback sequence:

1. **Commit before reveal.** `committedPrediction` requires an action and confidence before action
   buttons unlock (`heroAct`, `renderControls`).
2. **Withhold the answer.** `refreshStats` hides win percentage until commitment.
3. **Act and grade once.** `computeHeroGrade` runs before state mutation; the grade is captured rather
   than recomputed after a timed prompt.
4. **Retrieve on costly mistakes.** `gateShouldFire` opens an eight-second, two-attempt prompt for
   `notable`/`serious` coached errors.
5. **Always advance.** A passing reason, exhausted attempts, or timeout all call `resolveGate`; the
   prompt never traps the hand.
6. **Separate confidence calibration.** `predictOutcome` distinguishes match, sure-wrong,
   guess-wrong, and deviation; `tally` stores sure/guess accuracy separately
   ([`src/core/predict.ts`](../src/core/predict.ts)).
7. **Persist evidence.** `DecisionRecord` stores pre-action board, pot, price, chosen action, grade,
   and optional gate-attempt count ([`src/core/session.ts`](../src/core/session.ts)).

### Reason grading

`gradeReason` is a deterministic regex classifier over four labels: `range`, `price`,
`hand-strength`, and `none`
([`src/core/reasonGrade.ts`](../src/core/reasonGrade.ts)). Precedence is policy: empty/evasive and
hunches become `none`; explicit mechanism vocabulary can become `range`/`price`; own-hand claims
can become `hand-strength`.

The table always calls `applyG4Override` with `graderSource: 'local'`. On that path, a free action
with a weak reason is logged as right-for-the-wrong-reason, but severity escalates only for an
explicit admission of guessing. This is a deliberate precision safeguard, not model grading.

### Longer-term pedagogy

The session model and pure modules implement more than per-hand feedback:

- Leak totals ranked by **cost**, not frequency: `session.computeStats`
- Confidence calibration: `predict.tally`
- Spacing waves and beta-binomial mastery: `schedule.posterior`, `gate`, `nextDue`
- Support fading and hint debt: `fading.applyEvent`
- One next-action recommendation: `recommend.recommend`
- Assessment records separated from practice: `session.recordAssessment`,
  `progress.computeMetrics`
- Contrast sets constrained to one changed variable: `contrast.generateContrastSet`,
  `assertSingleVariable`

These are deterministic reducers over explicit history. The renderer decides when to invoke and
persist them.

## 5. Persistence, Network, and Tutor Safety

### Profile durability

The profile is `${app.getPath('userData')}/offsuit-state.json`
([`src/main/store.ts`](../src/main/store.ts) `STATE_FILE`). Saves:

1. rotate three backups,
2. copy the old live file to backup 1,
3. write a random temp file,
4. rename it over the live file.

See [`src/core/backup.ts`](../src/core/backup.ts) `saveWithBackup`, `atomicWrite`,
`loadWithRecovery`. Loading tries live then backups newest-first. Session deserialization is
tolerant and bounded: malformed fields default or are dropped, and major logs are capped
([`src/core/session.ts`](../src/core/session.ts) `deserialize`, `MAX_HAND_LOG`,
`MAX_GIFT_LOG`, `MAX_ASSESSMENT_LOG`).

Limits:

- Rename atomicity protects against torn JSON, but there is no `fsync`, schema version, migration
  ledger, checksum, or inter-process lock.
- Backup helpers broadly catch filesystem errors, so permission and I/O failures can look like
  missing files.
- Synchronous filesystem calls run in Electron main.
- Renderer save callbacks are often launched with `void`; a failed save is not surfaced in the UI.

### Delete semantics

`deleteProfile` requires the exact phrase and removes the live profile plus three backups. It does
not delete:

- `offsuit-settings.json`
- Chromium local storage
- opt-in tutor replay-cache files outside user data

This matters because [`src/renderer/screens/lesson.ts`](../src/renderer/screens/lesson.ts)
persists `offsuit-lexicon-v1` in `localStorage`, while the main session separately persists
`SessionState.lexicon`. The two stores use different entry types and are not synchronized.
Therefore the current "Delete Profile" operation does **not** erase all learner-authored lesson
text, and there are two lexicon histories with different consumers.

### Electron network seal

[`src/main/network.ts`](../src/main/network.ts):

- `silenceChromium` disables named Chromium background services before readiness.
- `sealSession` cancels every non-local URL at `onBeforeRequest`.
- `sealNetwork` covers the default session and future sessions.

This is tested from outside the blocking function, including a fresh partition and a positive
control ([`tests/e2e/no-network.spec.ts`](../tests/e2e/no-network.spec.ts)).

The guarantee is narrower than "the process cannot use the network." Electron session hooks do
not govern:

- the `aws` child process used by the tutor,
- `node:net` multiplayer sockets,
- any future Node HTTP client in main.

### Tutor path

`resolveTutor` requires profile, region, and model ID together. Otherwise it builds `nullTutor` and
`nullModelClient`, with an empty reported egress list
([`src/main/tutor/index.ts`](../src/main/tutor/index.ts) `resolveTutor`).

With credentials, `bedrockClient` writes the prompt to a temp directory and runs:

```text
aws bedrock-runtime invoke-model ...
```

using `execFile`, not a shell
([`src/main/tutor/bedrock.ts`](../src/main/tutor/bedrock.ts) `invokeModel`). Temp files are removed
in `finally`.

Safety layers:

- Pre-commit request types contain visible table data but no grade
  (`buildRulesRequest`, `VisibleTable`).
- Post-reveal requests may contain `GradePayload` (`buildStrategyRequest`).
- The multi-turn agent omits grade/numeric tools pre-commit (`agent.registryFor`).
- Tool calls and model turns are capped (`DEFAULT_CAPS`).
- `checkTutorOutput` limits words, bans selected constructions, checks numeral provenance, and
  rejects a leading second-person pronoun.
- Live calls get one retry, then fixed strings (`liveTutor.respond`).

Limits:

- `egressAllowlist` is diagnostic data, not an enforced child-process network policy. The AWS CLI
  is not restricted by `sealNetwork` and may use credential-related endpoints in addition to the
  displayed Bedrock runtime host.
- The default Bedrock timeout is 60 seconds per attempt, not 15 seconds.
- The guard explicitly verifies form, not truth. It cannot detect a false relationship among
  allowed numbers or a false number-free strategy claim
  ([`src/main/tutor/guard.ts`](../src/main/tutor/guard.ts) `checkTutorOutput`).
- Runtime decoding uses selective checks plus casts rather than a complete response schema.
- Replay `record` mode writes prompts, completions, grades, cards, questions, and lexicon context
  as plaintext JSON to the configured directory
  ([`src/main/tutor/replayCache.ts`](../src/main/tutor/replayCache.ts) `openReplayCache`).

### Multiplayer path

Multiplayer defaults off. Enabling it permits main to bind a plaintext newline-delimited JSON TCP
server on `0.0.0.0`, or connect as a client
([`src/main/relaySession.ts`](../src/main/relaySession.ts) `hostSession`, `joinSession`). The host is
authoritative through `RelayServer`, and all outgoing table state passes through per-player
`viewFor`.

Current safety/operability limits:

- No authentication, encryption, room secret, origin identity, or authorization beyond socket-to-seat
  ownership. Treat it as trusted-LAN-only.
- No message-size limit, receive-buffer cap, idle timeout, connection cap, or rate limit.
- A socket is seated immediately with a generated name. The later `join` message does not actually
  rename it: `RelayServer.message` treats `join` as a state resend.
- Disconnect removes the room player but does not fold or otherwise update that player's live engine
  seat. A disconnect on the acting seat can stall a hand.
- Client-side `safeServerMessage` validates only `type` before casting the nested view.

## 6. TypeScript Architecture Quality

### What is strong

- Strict TypeScript is enabled globally.
- Core behavior is mostly explicit imports and deterministic functions, with no reflection or DI
  container.
- Randomness and time are usually injected as seeds/`now`.
- Poker invariants are centralized in one engine used by solo and multiplayer modes.
- Persistence has an explicit `serialize`/`deserialize` boundary instead of trusting disk objects.
- Request types structurally separate pre-commit visible state from post-reveal grades.
- The lockfile is committed and there are no runtime npm dependencies.
- The test corpus is larger than source: roughly 47.7K TypeScript test lines versus 36.1K source
  lines at the analyzed commit.

### What constrains confidence

- `strict` is on, but `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are not.
- There is no lint script enforcing `no-explicit-any`, non-null assertions, exhaustive switches, or
  floating promises.
- Process boundaries lack shared runtime schemas.
- Preload and renderer independently declare bridge shapes; the channel test proves names pair, not
  payload compatibility.
- `Card` is just `string`; invalid cards are representable.
- `HiddenState` depends on casts and convention.
- `src/renderer/main.ts` (952 lines), `renderTable` (over 1,000 lines), and several large core files
  exceed a comfortable one-pass working set.
- Main IPC registration, app startup, settings, tutor, speech, and multiplayer are centralized in
  one file without a typed handler registry.
- `src/core/backup.ts` mixes infrastructure into the nominal domain directory.
- Unit tests are broad and fast enough, but `npm test` means the full 1,670-test suite rather than an
  affected inner loop. E2E is a separate heavy, serialized Electron suite.
- No CI configuration is present in the repository, so local scripts are capabilities, not enforced
  merge gates.

Overall: the domain modularity and executable evidence are strong for a local desktop prototype.
The weakest architectural surface is runtime boundary validation, followed by oversized renderer
orchestration and claims that are reported but not structurally enforced (notably child-process
egress).

## 7. Setup and Run Path

No Node version is pinned in the repository. The configured toolchain targets ES2022 and uses
Electron 33, TypeScript 5.7, Vite 6, Vitest 2, and Playwright 1.58
([`package.json`](../package.json), [`package-lock.json`](../package-lock.json)).

### Full desktop app

```bash
cd /Users/pranavgk/Documents/scratch/temp/Poker
npm ci
npm run typecheck
npm test
npm start
```

`npm start` runs `npm run build` and then `electron .`. The build:

1. compiles main as ESM,
2. compiles preload as CommonJS and renames it to `preload.cjs`,
3. bundles the renderer into `dist/renderer`.

The `rootDir: "src"` pin in
[`tsconfig.main.json`](../tsconfig.main.json) keeps the entry point at `dist/main/main.js` even
when main imports core modules.

For a deterministic manual run:

```bash
npm run build
npx electron . --seed=42
```

### Browser-only visual loop

```bash
npm run dev
```

Open Vite's printed URL. Remember that this uses in-memory state and no Electron capabilities.

### Tests

```bash
npm test                 # all unit tests
npm run typecheck        # source + tests
npm run e2e              # rebuild, then serialized Electron Playwright suite
```

Socket tests need permission to bind loopback and `0.0.0.0`. E2E tests use isolated Electron user
data directories and real windows parked off-screen
([`playwright.config.ts`](../playwright.config.ts),
[`tests/e2e/helpers.ts`](../tests/e2e/helpers.ts)).

### Optional tutor

The implementation reads these at main-process startup:

```bash
OFFSUIT_BEDROCK_PROFILE=...
OFFSUIT_BEDROCK_REGION=...
OFFSUIT_BEDROCK_MODEL=...
npm start
```

All three are required. The AWS CLI must be installed and authenticated for the selected profile.
Replay is separately opt-in through `OFFSUIT_REPLAY_MODE=record|replay` and
`OFFSUIT_REPLAY_DIR`.

Speech uses macOS `/usr/bin/say`; other platforms return `unavailable` unless a test/dev override
points `OFFSUIT_SAY_BINARY` at an executable.

## 8. Implementation Gaps to Keep in View

Ordered by impact, not ease:

1. **Coach authority is overstated by some names/copy.** The implementation is a seeded
   equity-vs-random heuristic, not action-EV or solver grading (`coach.gradeDecision`).
2. **Child-process egress is described, not confined.** The displayed Bedrock host is not an
   enforced allowlist for the AWS CLI (`resolveTutor`, `bedrockClient`).
3. **Profile deletion is incomplete for learner text.** Lesson `localStorage`, settings, and replay
   caches survive (`backup.deleteProfile`, `lesson.LEXICON_KEY`).
4. **Two lexicon persistence models diverge.** Lesson entries and `SessionState.lexicon` have
   different schemas and consumers.
5. **IPC and server messages are not fully runtime-validated.** Static types disappear at the process
   and wire boundaries.
6. **Multiplayer is trusted-LAN prototype quality.** Plaintext/unauthenticated, unbounded framing,
   ignored join names, and disconnects can strand live seats.
7. **No packaged distribution path exists.** There is no Electron Forge/Builder config, signing,
   installer, update mechanism, or packaging script; `npm start` is the run path.
8. **Browser dev is behaviorally different.** It cannot validate the desktop architecture.
9. **Persistence has no schema version or durable flush.** Tolerant parsing provides compatibility
   but can silently discard unknown/corrupt fields.
10. **Large renderer closures concentrate risk.** Navigation, session mutation, persistence, and
    table orchestration are difficult to reason about independently.
11. **No repository CI policy is visible.** The comprehensive tests are not demonstrably required by
    source-controlled automation.
12. **Progress intentionally withholds several features.** The renderer passes `hands: []` and
    `fluency: []` because all-in-adjusted EV and reaction times are not recorded
    ([`src/renderer/main.ts`](../src/renderer/main.ts) `renderTab('progress')`). This is an honest gap,
    not a broken calculation.

## 9. Recommended Code-Reading Sequence

Read in this order; each step answers one question needed by the next.

1. [`package.json`](../package.json), [`tsconfig.json`](../tsconfig.json),
   [`tsconfig.main.json`](../tsconfig.main.json), [`tsconfig.preload.json`](../tsconfig.preload.json):
   what gets built into each runtime?
2. [`src/main/main.ts`](../src/main/main.ts) `createWindow`, `app.whenReady`: what is privileged?
3. [`src/main/preload.ts`](../src/main/preload.ts): what can cross into main?
4. [`src/renderer/main.ts`](../src/renderer/main.ts) `bridge`, `boot`, `render`: who owns application
   state and persistence calls?
5. [`src/core/table.ts`](../src/core/table.ts) from `TableState` through `applyAction`: what makes an
   action legal and advances a round?
6. Continue `table.ts` through `settle` and `buildSidePots`: where do chips end up?
7. [`src/core/evaluate.ts`](../src/core/evaluate.ts) and
   [`src/core/equity.ts`](../src/core/equity.ts): how are hand strength and estimates produced?
8. [`src/renderer/screens/table.ts`](../src/renderer/screens/table.ts) `advance`, `heroAct`,
   `finishHand`: how is the engine turned into a playable loop?
9. [`src/core/coach.ts`](../src/core/coach.ts),
   [`src/core/predict.ts`](../src/core/predict.ts),
   [`src/core/reasonGrade.ts`](../src/core/reasonGrade.ts): what is actually graded?
10. [`src/core/session.ts`](../src/core/session.ts) `SessionState`, `recordHand`, `serialize`,
    `deserialize`: what evidence persists?
11. [`src/main/store.ts`](../src/main/store.ts) and
    [`src/core/backup.ts`](../src/core/backup.ts): how does it reach disk and recover?
12. [`src/main/network.ts`](../src/main/network.ts), then
    [`src/main/tutor/index.ts`](../src/main/tutor/index.ts) and
    [`src/main/tutor/bedrock.ts`](../src/main/tutor/bedrock.ts): which network paths are and are not
    sealed?
13. [`src/core/multiplayer.ts`](../src/core/multiplayer.ts),
    [`src/core/relayServer.ts`](../src/core/relayServer.ts),
    [`src/main/relayHost.ts`](../src/main/relayHost.ts): where is multiplayer authority and redaction?
14. Read the matching unit tests after each module; finish with persistence, no-network, gameplay,
    tutor, and multiplayer E2E specs.

## 10. Active Recall

Answer without opening the source, then verify against the cited symbol.

1. Why can `npm run dev` not prove Electron isolation? (`renderer.main.bridge`)
2. Which three BrowserWindow settings define the primary renderer boundary? (`main.createWindow`)
3. Which IPC operations can cause filesystem, process, or socket effects? (`preload.ts`)
4. Why is `_raiseCapped` needed, and what clears it? (`table.applyAction`, `advanceStreet`)
5. What two conditions end betting and move a street? (`table.isRoundComplete`)
6. Why does settlement need both pots and refunds? (`table.buildSidePots`)
7. What is deterministic about Monte Carlo, and what remains approximate? (`equityVsRandom`)
8. Does the coach choose the best action? What does it actually compare? (`coach.gradeDecision`)
9. Which grade thresholds produce silence, a notable error, and a serious error?
10. When is win percentage hidden? (`tableScreen.refreshStats`)
11. What three events resolve the self-explanation gate? (`submitGate`, `resolveGate`)
12. Why can local reason grading log a weak reason without escalating it? (`applyG4Override`)
13. Which persisted counters survive the 500-hand history cap? (`SessionState.stats`)
14. What makes profile replacement atomic, and what durability guarantee is still absent?
15. What data survives "Delete Profile" today?
16. Why does the Electron network seal not contain Bedrock or multiplayer?
17. What enforces pre-commit tutor blindness: prompt wording, types, tool registry, or all three?
18. What can the tutor guard prove, and what can it not prove? (`checkTutorOutput`)
19. Where is opponent-card redaction guaranteed? (`multiplayer.viewFor`)
20. What happens if the acting multiplayer client disconnects?
21. Which process boundaries rely on casts instead of complete runtime parsers?
22. Why is `src/renderer/screens/table.ts` an application layer, not merely a view?

## 11. Executable Exercises

Run these from the repository root. They use existing tests and do not modify production code.

### Exercise 1: Trace one complete hand

```bash
npx vitest run tests/unit/table.test.ts
```

Before running, predict the actor and pot after heads-up call/check. Then map the passing assertions
to `startHand -> applyAction -> advanceStreet -> settle`.

### Exercise 2: Attack action validation

```bash
npx vitest run tests/unit/action-validation.test.ts tests/unit/raisecap-reopen.test.ts
```

Explain why chip conservation alone would not catch a negative raise or a wrongly closed raise
right.

### Exercise 3: Verify settlement edge cases

```bash
npx vitest run tests/unit/allin.test.ts tests/unit/uncalled.test.ts tests/unit/settled-state.test.ts
```

For one test, draw contribution levels and identify which chips form a contested pot versus a
refund.

### Exercise 4: Compare equity oracles

```bash
npx vitest run tests/unit/equity.test.ts tests/unit/equity-crosscheck.test.ts
```

State which assertions use exact enumeration, Monte Carlo convergence, symmetry, and zero-sum
relationships. Identify which are independent of the production formula.

### Exercise 5: Find the coach's blind spots

```bash
npx vitest run tests/unit/coach.test.ts tests/unit/coach-message.test.ts
```

Construct, on paper, a bluff with low showdown equity that should be profitable through fold
equity. Predict how `gradeDecision` treats it and why.

### Exercise 6: Separate action and reason grading

```bash
npx vitest run tests/unit/predict.test.ts tests/unit/reasonGrade.test.ts
```

Classify these before running: "I have top pair", "the call is cheap", "his range is capped", and
"I'm guessing". Then trace whether a free action would escalate on the local path.

### Exercise 7: Corrupt and recover profile state

```bash
npx vitest run tests/unit/session.test.ts tests/unit/backup.test.ts
```

List which malformed values default, clamp, drop, or trigger backup recovery. Distinguish
syntactic JSON recovery from semantic session parsing.

### Exercise 8: Prove channel pairing, then inspect what it misses

```bash
npx vitest run tests/unit/ipc-channels.test.ts tests/unit/tutorPayload.test.ts
```

Explain why equal channel sets do not prove request payload validity. Name one runtime parser that
would be needed to close that gap.

### Exercise 9: Exercise network boundaries

```bash
npx vitest run tests/unit/network.test.ts tests/unit/relayHost.test.ts tests/unit/relaySession.test.ts
npx playwright test tests/e2e/no-network.spec.ts
```

The socket tests require local bind permission. Explain why all tests can pass while the AWS CLI
still reaches the network.

### Exercise 10: Exercise tutor fallbacks

```bash
npx vitest run tests/unit/guard.test.ts tests/unit/agent.test.ts tests/unit/tutorHistory.test.ts
```

Follow one pre-commit request and one post-reveal request. Record the payload fields, tool registry,
allowed numerals, retry path, and final fallback.

### Exercise 11: Run the real desktop persistence path

```bash
npm run build
npx playwright test tests/e2e/persistence.spec.ts
```

This proves renderer -> preload -> main -> disk -> restart, which no core unit test can prove.

### Exercise 12: Perform a boundary inventory

```bash
grep -REn "ipcMain\\.|ipcRenderer\\.|contextBridge|execFile|spawn|net\\.create|readFileSync|writeFileSync|localStorage" src
```

Classify each hit as process crossing, network, process spawn, filesystem, or browser storage.
Check that every side effect has a named owner and an input-validation story.

## 12. Video Storyboard

Target: 12-15 minutes. Use source on one side and the running Electron app on the other.

| Time | Visual | Narration / demonstration |
|---|---|---|
| 0:00-0:45 | Repository tree, then the three-zone diagram | Establish that this is an implementation tour: renderer, preload/main, core. |
| 0:45-2:00 | `main.createWindow` and `preload.ts` | Show context isolation, no Node integration, and the exact bridge. Highlight that channel pairing is not payload validation. |
| 2:00-2:45 | Run `npm run dev`, then `bridge()` | Demonstrate why browser dev is visually useful but architecturally incomplete. |
| 2:45-4:30 | `table.startHand`, `legalActions`, `applyAction` with a live hand | Follow one call/check street transition. Keep the pot and actor visible beside the code. |
| 4:30-5:30 | `settle` and side-pot test | Draw contribution slices, then run the focused all-in/refund tests. |
| 5:30-6:30 | `evaluate` and `equityVsRandom` | Contrast exact hand ranking, exact known-hand equity, and seeded Monte Carlo. |
| 6:30-8:20 | Coached mode in the app; `heroAct`, `refreshStats`, gate symbols | Commit action/confidence, show withheld equity, make a costly decision, answer or time out the reason gate. |
| 8:20-9:30 | `coach.gradeDecision` table of heuristics | State plainly that this is not solver EV. Show unused `stack`/`betSize`, random ranges, and absent fold equity. |
| 9:30-10:40 | Profile file and backup flow | Complete a hand, inspect persistence, restart, then explain temp-write/rename and three backups. |
| 10:40-11:30 | Delete flow plus lesson `localStorage` | Show what deletion removes and the surviving settings/local lexicon gap. |
| 11:30-12:30 | `network.ts`, Bedrock CLI, TCP relay | Draw the boundary: Electron traffic is sealed; child process and Node sockets bypass it intentionally. |
| 12:30-13:30 | Tutor request types, registry, guard | Compare pre-commit and post-reveal payloads. Explain "form and provenance, not truth." |
| 13:30-14:20 | Multiplayer `viewFor` and relay | Show card redaction, then name plaintext/auth, framing, rename, and disconnect gaps. |
| 14:20-15:00 | Test output and implementation-gap list | Close with the verified signals: typecheck and 1,670 unit tests, then the highest-impact remaining work. |

### Recording checklist

```bash
npm ci
npm run typecheck
npm test
npm run build
npx electron . --seed=42
```

Use an isolated `--user-data-dir` for recording if preserving the normal profile matters. Do not
enable tutor replay recording with real learner text unless the output directory is intentionally
handled as sensitive data.
