# Review: feat/dee-character
Verdict: PASS WITH NOTES after fixes (was CHANGES REQUESTED at ce37308; every Act-on item fixed in the next commit)
Base: a7d6420 (merge-base with origin/main)  Head: ce37308. I reviewed e518563 and f93733a in full. ce37308 (the lesson.spec #10 fix) landed while I was reviewing, and I read it too.

Short version: the teaching contracts hold. Commit-before-feedback, the GATE, the coach, outcome and pot announcers, the coach word budget and `Grade.price` are all unchanged, and `Grade.spot` is never persisted. The profile additions follow the recipe. Five defects block the merge. Two of them have Dee say false things: "Price held" fires on calls and folds made on the wrong side of the price, and the `{repeat}` counts carry the wrong label. One is a turn-versus-river claim. One is a perch timer that spins at 0 ms for weeks at a time. The last is the dialogue's live region, which is rebuilt on every repaint.

## Act on

- **src/core/dee/engine.ts:137-145 (`isPriceHeld`). "Price held" praises calls and folds made on the wrong side of the price.** The check is `severity === 'free'` plus `|had - needed| <= 0.10`. It never checks which side of the price the action was on. `free` means "cost under 0.5 bb", not "right". A call that was slightly under the price, in a pot of 24 bb or less, grades `free`. I reproduced it through `handEndEvent` and `selectLine` on a turn call with needed 0.33, had 0.31 and evLoss 0.4, Sure, reason category `price`. Dee says *"Price held. The call cleared 33% with 31%, and the reason said so."* (`ph-call-2`), or *"A call at 33% with 31% of the pot: close, and correct on price."* (`ph-call-1`). The fold mirror case (had 0.35, needed 0.33) gives *"Price held… 33% needed, 35% had"*. Both numbers come from the engine, but the claim attached to them is false, and it is attached to a mistake. Owner D6 says "a close spot played right". DECISIONS.md:24 restates the rule without the "right" half. dee.spec #3 only ever plays the right side (`right = had >= needed ? 'call' : 'fold'`), so nothing catches this. Fix: also require `evLossBb === 0`, or by action: call/raise needs `had >= needed`, fold needs `had <= needed`. Add a unit test for each wrong-side case.

- **src/core/dee/engine.ts:171-172 + 213-222. The `{repeat}` count is per principle, but the lines label it per action.** `byPrinciple` is keyed only by principle. `value or bluff` covers three different mistakes (free folds, late checks, weak leads), and `pot odds` covers both calls and folds. Some failing scenarios:
  - A free fold, then a missed late-street value check. Dee says *"Missed value, verdict number 2 this sitting."* (`vb-check-r2`, bank.ts:202), but it is the first missed-value verdict.
  - *"Weak leads, verdict number {repeat} this sitting. Checking was free each time."* (`vb-lead-r2`, :238) fires after an earlier check mistake, where "checking was free each time" makes no sense.
  - A pot-odds fold, then a pot-odds call. Dee says *"Pot-odds call number 2 this sitting."* (`po-call-r1`, :60), and `po-call-r2` says *"Same pattern as earlier: a call above the price."*
  - `po-fold-r1` (:118) says *"Same seat, same price, same fold."* and `vb-free-r2` (:168) says *"Free folds, verdict number…"*.

  The number is engine-made, but the meaning Dee gives it is wrong. Fix: count repeats per (principle, action class) for these lines. Or keep one per-principle counter, change the r-lines to say "{principle} verdict number N", and drop the action-specific wording.

- **bank.ts:42 (`po-call-s5`) and :394 (`ph-late-2`). "No cards left" is said on the turn.** `late` is `turn || river` (engine.ts:152), but these lines say *"A late-street call has no cards left to rescue it"* and *"No cards left to come, so the price was the whole decision."* The probe above picked `ph-late-2` on a turn spot. On the turn one card is still to come. Fix: add a `river` condition (an event field), or reword these lines to fit both streets.

- **src/renderer/components/perch.ts:83. The blink delay is `undefined` (0 ms) for long stretches of time.** `cycle[(Date.now() >> 10) % cycle.length]`. `>>` truncates `Date.now()` to int32, which goes negative for about 24.8 days in every 49.7. A negative `%` gives indexes -4..-1, so `cycle[-n]` is `undefined`, and `setTimeout(fn, undefined)` fires immediately and re-arms itself. I computed it: from about 2026-10-30 to 2026-11-24, four seconds in five give a 0 ms delay (clamped to about 4 ms once nested). The result is a permanent timer loop that rewrites the SVG `innerHTML` every few ms while Dee is at rest, so the mark sits in the blink frame most of the time. The CPU cost lasts as long as the app is open, because the perch lives for the app's lifetime. This window opens about 18 days from today. Fix: `Math.floor(Date.now() / 1024) % cycle.length`, or a counter that steps through the cycle.

- **src/renderer/screens/lesson.ts:465-503 (dialogue `role="log" aria-live="polite"`). The live region is rebuilt on every repaint, so turns are not reliably announced.** `render()` rebuilds the whole subtree with `replaceChildren`, which includes the `<ol role=log>`: on every option pick, every commit and every example switch. A live region inserted together with its content is not reliably announced. Where it is announced, it is read whole, so picking an option, before any commit, would re-read the whole thread. The codebase's own pattern exists for exactly this reason: "an always-present visually-hidden role=status region … survives paint()'s replaceChildren" (anomaly.spec:1565, drill.spec:938, charts.spec:1093). dee.spec #4 only checks that the `role` attribute is set. Fix: keep a persistent region outside the repainted subtree (or keep the `ol` and append only new turns). Write each new Dee turn into it on commit only.

## Consider

- **lesson.ts:536-545. Focus is lost after every dialogue commit.** After a commit, `picked = null` disables `dialogue-commit`, and focusRestore cannot focus a disabled button, so focus drops to `<body>`. After the last answer the button is removed entirely. A keyboard user tabs from the top after each answer. The old commit-box path also drops focus at its reveal, but the dialogue has three commits per example. Tradeoff: a small explicit focus move (to the first untried option, or to the reveal) against relying on focusRestore.
- **Character off still prints Dee's first-person persona in lessons.** `lo-5` (*"I have watched this spot from every seat"*), `ld-7` (*"I just move left; the thinking was yours"*) and similar first-person lines in the lesson bank still appear, labelled "Coach" (lesson.ts:488, dialogue.ts:143). DECISIONS.md treats them as "lesson questions", but they are Dee's own voice. Tradeoff: under Character off, skip the bank's `lesson-open/retry/done` lines (the scripted steps already carry the lesson), or pick from a neutral subset.
- **The session summary is hard to reach.** (a) It only fires from `sittingOver()` (table.ts:525): bust, swept, or a planned hand limit. Leaving the table or pressing New session never summarises, so under **"After sessions only"** an unplanned table is effectively silent forever. (b) Under `normal`, the summary is dropped whenever the last hand had a beat (table.ts:536). (c) `priceHeld` is only counted when `handEndEvent` produced the event (engine.ts:200), so under `mistakes` and `sessions` it is always 0. Under `normal` it is capped at 2 by "once per principle", so `se-*-ph` reads "N close prices held" with an undercount. Tradeoff: count price-held spots separately from the beat, and summarise on teardown or New session.
- **"Mistakes only" still speaks on right-action-wrong-reason** (engine.ts:189-198 runs before the frequency check). Its copy says "Quiet when the price held", but a G4 line is not a mistake either. Tradeoff: decide and say which it is. If G4 stays, change the caption.
- **Claims the code does not back.** `ld-6` (*"This spot comes back on the schedule, a little harder"*): the lesson dialogue records nothing to a scheduler. `ld-5` (*"Try the next position, where only the size moves"*) also shows on the last example and is MDF-specific in a bank that claims to be generic. `ph-1` and `ph-call-*` say "called" and can fall back onto a fold or all-in. `ph-3` says "with the price as the reason" when the reason was `range`. `rg-raise-s2` and `rg-allin-s1` say "most of that range is ahead", which the grade does not compute. Tradeoff: rewording against keeping the voice.
- **G4 lines open with praise ahead of the correction** (`g4-hs-1` *"Right move. The reason given was the hand…"*, `g4-none-1`, bank.ts:312-341). This is G4's own semantics, but the owner rule says "no praise attached to a correction". Tradeoff: "The action held; the reason was the hand" keeps the fact without the praise.
- **Gaps in the bank lint (tests/unit/dee-bank.test.ts).**
  - The `trait` ban has no `you are` / `you're` (the owner's explicit rule). The guard only catches a *leading* "You".
  - `NUMBER_WORDS` (:70) leaves out `one`, `half` and `first`, so `se-clean-1`'s authored *"half a big blind"* passes.
  - The dialogue lint (:201-238) checks digits but not number words or `DEE_BANS` in option `back` replies.
  - `deeSettings.ts` copy (`QUIET`, `FREQUENCY_COPY`, *"Two quiet minutes"*) is not linted.
  - Coverage (:150-163) is a hand-written list, not derived from `coach.ts`'s principle × action × priced table, so a new coach principle would not fail it.
  - Nothing ties a line's claim to its event: wrong-side Price held, turn versus river, per-action repeats. Those are where the real defects above slipped through.

  Every line and every variant is linted. The gap is in what each line is checked for.
- **Settings preview (deeSettings.ts:59-74).** It runs two Monte Carlo grades synchronously each time the screen opens. It builds a `price-held` event without going through `isPriceHeld`, and it forces `severity`/`principle`. The values today are right (call: free, needed .25, had .306; fold: serious, 3.2 bb), and they are deterministic. Tradeoff: pin them in a unit test, or route them through `handEndEvent`, so a grader change cannot turn the preview into a false claim.
- **Duplication.** `MAX_SAID` (engine.ts:337) and `MAX_DEE_SAID` (persist.ts) both exist, as do `frequencyOf` (engine.ts:56) and `effectiveFrequency` (persist.ts:373). Keep one of each.
- **Layout.** At ≤1040 px the perch takes about 50 px plus a 16 px gap from the tab strip. My estimate leaves about 60 px of slack at 900 px, but only spacing.spec #13 and layout.spec #3 measure it. When the hand ends the sitting (`data-ended` + beat), the dock wraps onto a second row. Only dee.spec covers the beat at the two sizes, and not the ended case. Run rebuy, swept-table and session-plan-start at 900x640 before merging. Also, `.tabs .nav-spacer { width: 52px }` breaks the strip's centring at >1040 px when Character is off.

## Noted

- The teaching contract is intact. The beat is built in `deeAtSettle` (table.ts:801), after settle and after any verdict or gate. The coach, outcome and pot announcers are untouched, and `dee-announcer` is a fourth, separate region that is cleared on nextHand. GATE constants and flow are unchanged. In-hand, Dee only changes pose (the gate pose appears only once the gate itself is on screen).
- `Grade.spot` is additive, the coach sheet still reads only `Grade.price`, and `DecisionRecord.verdict` copies explicit fields (table.ts:938), so nothing new is persisted inside v1 objects.
- Profile: `character`, `handsWatched` and `said` are new keys inside `progression.dee` (a v2 object), with tolerant parsers and present in `PROGRESSION_SHAPE`. The unknown-key carry covers older builds. The frequency change is safe: main never wrote `after-hands` or `quiet`, and main's `effectiveFrequency` reads `mistakes`/`sessions` as `normal` without rewriting them. The `MAX_RUN * 1000` clamp on `handsWatched` is an odd constant.
- The perch streak only repaints in `saveProgression`, and `countSession` has no caller in `src` (pre-existing), so the number is static for the whole run.
- Rounding can print "30% asked, 30% held" on a real verdict. This is pre-existing in `coach.ts buildMessage` as well.
- `role=radio` buttons with no arrow-key roving match charts.ts. `.perch:focus-visible` uses an rgba literal, and dee.ts carries hex in SVG art (documented).
- The `dee` tab leaves no tab marked active or `aria-current`, which is fine for a perch-opened screen.

## Dismissed

- *lesson.spec #10 breaks (it ran `commitByDispatch` on minimum-defence-frequency, which no longer has `commit-answer`).* Proof: fixed at ce37308, which switched it to counting-outs-as-a-frequency.
- *The line memory could be lost before the save.* Proof: `finishHand` runs `deeAtSettle` (and so `onMemory`) before `opts.onHandComplete` (table.ts:801 → 810), and `recordHand` then saves the updated session.
- *The tutor-rail specs drive the converted lesson.* Proof: their `openLesson` defaults to `pot-odds-as-a-price` (tutor-rail.spec:67, tutor-rail-history.spec), which has no script.
- *lesson.spec #8's every-lesson walk fails on MDF.* Proof: the dialogue path still renders the hole cards, board and `lesson-prompt`, and it adds no reveal before the last commit.
- *The `.dock-sep:first-of-type` rule never matches.* Proof: the separator is the first `span` among the dock's children (table.ts:1520), so it matches.

## Verification

- `npx tsc --noEmit -p tsconfig.json`: exit 0. `npx vitest run`: exit 0, 96 files, 2230 tests.
- A scratch vitest probe (outside the repo, since deleted) reproduced the wrong-side Price held lines and the `ph-late-2`-on-turn pick, and confirmed the settings preview grades. A node one-liner confirmed the negative `(Date.now() >> 10) % 5` window.
- e2e was not run, as instructed. These are unexercised:
  - Price held on the wrong side.
  - Per-action repeat claims.
  - The perch blink cadence.
  - Live-region announcements in the dialogue.
  - The tab bar's fit at 900 px with the perch (spacing.spec #13, layout.spec #3).
  - The beat plus an ended-sitting dock at 900x640 (rebuy, swept-table, session-plan-start).
- This branch touches the engine-adjacent `coach.ts`, the table, the app shell and the profile, so AGENTS.md calls for `npm run test:full` on the final commit.


## Resolution (author)
- Act on 1 fixed: `isPriceHeld` requires the right side of the price (a call or raise at or above it, a fold below it); unit tests cover a 31%-vs-33% call and the fold mirror.
- Act on 2 fixed: `{repeat}` counts the same kind of mistake (principle, action group, priced or free) via `DeeSitting.byKind`; the summary still ranks by principle.
- Act on 3 fixed: `po-call-s5` says "few cards left"; `ph-late-2` no longer claims no cards are to come.
- Act on 4 fixed: the blink cycle index is `Math.floor(Date.now() / 1024) % 5`.
- Act on 5 fixed: one persistent polite `dialogue-announcer` announces each new turn; the thread is a plain list. Focus moves to the first open option after a commit, or to the reveal at the end (dee.spec #4 asserts both).
- Consider, fixed: Character off drops Dee's own lesson lines (open/retry/done) and keeps the script's questions; every close price that held counts toward the summary; G4 lines say "The action held" instead of "Right move"; the unbacked claims (`ld-5`, `ld-6`, `ph-1` "called", `ph-3` "the price as the reason", `rg-raise-s2`, `rg-allin-s1`, `se-clean-*` "half a big blind") are reworded; the lint bans `you are/you're` and `half`, and checks number words in dialogue lines; the settings preview runs its spot through `isPriceHeld`; one `MAX_DEE_SAID`; the nav spacer keeps the strip centred with Character off; the "Mistakes only" caption names the G4 case.
- Consider, kept: an open-ended table that is left mid-way gets no session summary (DECISIONS.md, Open question in FINDINGS.md). `frequencyOf` and `effectiveFrequency` both exist: one is the engine's typed reader, the other the persist module's; merging them would make core/dee depend on persist for a one-line map.
