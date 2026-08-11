# Tutor Phase 2 design (authored inline — build against this)

Goal: bounded multi-turn follow-ups anchored to ONE spot, routed through the merged Phase-1
`runTutorAgent` (src/main/tutor/agent.ts). Hermetic (nullTutor); no live model this phase.

## What already exists (do NOT rebuild)
- `runTutorAgent(ctx: SpotContext, deps: AgentDeps): Promise<AgentResult>` — the capped tool loop.
- `mintSpotContext({phase, table, grade?, lexicon?, question, seedTranscript?})` — freezes the anchor,
  seeds transcript with the question.
- `SpotContext.phase` = 'pre-commit' | 'post-reveal'; `registryFor(phase)` phase-gates the tools;
  guards run per-turn/per-tool. Privacy is already enforced inside runTutorAgent.
- `deps.client.converse` is OPTIONAL. nullTutor/bedrock do NOT implement it yet, so runTutorAgent
  returns `termination: 'fallback:error'` with the fixed-string answer. THAT IS FINE for Phase 2:
  we exercise the multi-turn MACHINERY (history threading, cap, per-turn phase routing) hermetically;
  the live converse() is Phase 4 (OFFSUIT_LIVE_E2E).
- `AskInput` (index.ts) = {context, question, table, grade?, lexicon?}. Rail calls it via
  window.offsuit.askTutor over the existing `tutor:ask` IPC channel.

## IPC decision: REUSE `tutor:ask`, add an optional `history` field. NO new channel.
Rationale: a new channel means editing preload + the ipc-channels drift-guard, more surface, and the
history is small (≤3 × {question, ≤60-word answer}). Add to AskInput:
```
readonly history?: readonly { readonly question: string; readonly answerText: string }[];
```
The ipc-channels.test.ts stays UNTOUCHED and green (no channel added). This is the cleaner path the
Phase-1 design already favored.

## main.ts wiring
In the `tutor:ask` handler (or a small helper in index.ts's askTutor), when `input.history` is present
and non-empty, build a SpotContext via mintSpotContext (phase from context: 'spot-pre-commit'/
plm-drill/assessment/table-* → 'pre-commit'; 'spot-post-reveal' → 'post-reveal'; grade presence must
agree), seed the transcript from history as prior {user question, assistant answerText} turns, and call
runTutorAgent with the active tutor's client. Return the AgentResult text + provenance. When history is
absent, keep the existing single-shot askTutor path byte-for-byte (no behavior change to turn 0).
CRITICAL: history is threaded into the transcript/envelope the MODEL reads, but the guard still scores
the built request (allowedNumerals from the current turn's table/grade only) — history never widens it.
This is the load-bearing privacy property; test it.

## Rail changes (src/renderer/components/tutorRail.ts)
- Add a bounded FIFO of the last N=3 {question, answerText} pairs for the current spot.
- After turn 0 (existing verdict), render a follow-up composer (input + send) that on submit calls
  askTutor with `history` = the FIFO, appends the answer, pushes {q,a} to the FIFO (evicting oldest).
- A cap counter: after N follow-ups, disable the composer and show a fixed notice
  ("follow-ups for this spot are used up — re-decide or move on"). Cap is a UX bound in the rail.
- Conversation dies when the anchor changes (rail re-mounts / context changes) — empty FIFO per spot.
- Per-turn provenance already rendered by the rail (answerSource) — keep it per answer.

## Tests (all hermetic, nullTutor)
Unit (add to a new tests/unit/*.test.ts or extend an existing tutor test):
1. askTutor with history threads it into the SpotContext transcript but NOT into the guarded request
   (assert the request/allowedNumerals is unchanged by history).
2. PROVE-ORACLE-CAN-FAIL privacy: seed history with a fabricated solver numeral (e.g. "42.42"),
   pre-commit context; assert the returned answer does NOT contain it AND that bypassing the guard
   makes the test RED.
3. pre-commit history routes to the rules builder (no grade field reachable).
e2e (Playwright, nullTutor — extend tutor-rail.spec.ts or a new spec):
4. ask N+1 follow-ups → composer disables at the cap with the used-up notice.
5. a rules-then-strategy pre-commit sequence: the strategy follow-up is still blocked pre-commit.
6. per-turn provenance renders under each answer.
Keep tests/unit/ipc-channels.test.ts green (unchanged — no new channel).

## Mutation checks to prove
- Drop the "history excluded from guarded request" wiring → privacy test RED.
- Remove the cap → the N+1 e2e RED.
- Route a pre-commit follow-up to the strategy builder → blocked-turn test RED.
