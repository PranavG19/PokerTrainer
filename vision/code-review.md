# Review: vision-panel, round 2 (design and mocks only)

**Verdict: FAIL.** Eight must-fix findings remain. The visual system is close to `demo/glass`, and the capture is clean. The failures are in the numbers and the data story: the pot is reported as winnings, the chip stacks don't add up, the 100 bb depth tier doesn't exist, 15 minutes isn't a session, the streak rule contradicts owner decision D5, the rival "reads" have no possible source, the dates contradict each other, and the free-grade prices aren't recorded. Each of these is a claim the build would have to break a rule or invent data to honour.

Base: 575253f  Head: b2ad85b (`git show --stat HEAD`: 106 files, nothing under `src/`)

**Scope note.** This review covers the committed HEAD. While I was reviewing (around 16:09–16:12), someone else changed the working tree: 54 tracked files in `demo/vision/*.html` and their screenshots, plus new untracked `vision/DESIGN.md`, `vision/scores.md` and `vision/scores-raw.md`. I didn't write any of those; my capture ran on a copy in `/tmp/rv`. Some findings may already be fixed in that tree (for example R19, since `vision/scores.md` now exists). Check each one against the tip before closing it.

Severity: **must-fix** = a demonstrable contradiction with the code, an owner decision, the spec or poker arithmetic. **should-fix** = a defect a careful reader will hit. **consider** = a judgment call.

---

## Must-fix

### R1. The pot is shown as winnings, in mint, across five screens
- **Severity:** must-fix
- **Where:** `demo/vision/home.html:114`, `hands.html:184`, `trophies.html:276`, `letter.html:124` (the "+1450" in the hand-of-the-week row), `rival.html` "Your hands with him" (+29 bb), `vision/persona.md` (Kept hands 1)
- **Evidence:**
  - The Long Call shows **+1450** (mint) on Home, Hands, Letters and Trophies, and **+29 bb** on Rivals. 1450 is the final pot (550 + 450 + 450), not the hero's net.
  - Using the hand line in `table.html`'s own comment (limp 50, call 75 on the flop, pot 550 before the river), the hero put in 50 + 75 + 125 + 450 = 700. The net is +750, which is +15 bb.
  - `trophies-1100x760.png` labels it "+1450 **the pot**" in mint. Mint is for positive deltas only (AGENTS.md role map), and a pot is not a delta.
  - It also breaks VISION.md:298 and VISION.md:320: nothing is earned from chips, pots or a correct verdict. The trophy names the decision, then headlines the pot.
- **Fix:**
  - Use the net (+750 / +15 bb) wherever a delta is shown, or drop the chip figure from kept-hand rows and trophies.
  - Trophies show only the decision numbers (price 31%, had 34%, Sure).
  - Fix persona.md first, so every screen inherits the change.
- **Response:** Fixed. Every mint figure for The Long Call is the net, +750 (+15 bb); the pot 1450 is labelled as the pot (home, hands, letter, trophies "your net, of a 1450 pot", rival +15 bb, table "won the 1450 pot"). persona.md records the stacks.

### R2. The Long Call's stacks don't add up, and the three table states contradict each other
- **Severity:** must-fix
- **Where:** `demo/vision/table.html:191`, `table.html:200`, `hands.html:128` and the hero plate below it
- **Evidence:**
  - **Wrong totals.** `table-great-*.png` shows the hero at 5950 and Bo at 4050, with Ada 4950 and Cy 5000. That totals 19,950, so 50 chips have vanished. The correct end stacks are hero 5750 and Bo 4300.
  - **Impossible stacks before the call.** `hands-1100x760.png` shows the hero at 4500 after calling 450, which means only 50 went in before the river. That can't build a 550 pot with Bo at 4050 (Bo would need 500 in before the river).
  - **Two pot conventions.** `table-live` shows Pot 225 *including* Bo's 75 bet (75/300 = 25%). Hands shows Pot 550 *excluding* the 450 bet (450/1450 = 31%).
  - **Ada.** In the great state Ada's cards are drawn live, but she must have folded on the flop for the pot to be 550.
  - **One hand, three stories.** The live state pre-selects **Fold** in the commit tray (`table.html` tray, `aria-checked="true"` on Fold) while the typed reason argues for a call. The mistake state is the same flop folded. The great state is the same hand called on the river.
  - **Overlap at 1100.** In `table-great-1100x760.png` the beat tray covers the bottom of the hero plate and half the D button. The 900px render is clear.
- **Fix:**
  - Hero ends at 5750, Bo at 4300.
  - Hands shows the hero at 4300 after the call and Bo at 4300 after the bet.
  - Use one pot convention: pot including bets, as the shipped table does.
  - Fold Ada's cards in the great state.
  - Make the mistake state a different hand, or leave the live tray uncommitted.
  - Raise the hero plate when `.beat-open` is set at 1100x760.
- **Response:** Fixed. Table great: you 5750, Bo 4300 (LAG), Ada folded, Cy 5000 (sums to 20,000; commented in table.html). Hands still is the moment of the call: you 4750 "To call 450", Bo 4300, pot 550 with the Bet 450 pill, the same convention as the table. The beat tray reserves its height at both sizes (table-dee.css).

### R3. The 100 bb depth and "3 of 5 blocks" don't exist in the code
- **Severity:** must-fix
- **Where:** `vision/persona.md:27` and `:44`, `profile.html:232`, `story.html:106`, `:140`, `:194`, `trophies.html:289–290`, `locker.html:168`, `:223`, `onboarding.html:204`
- **Evidence:**
  - **The ladder.** `src/core/standing.ts:38` is `DEPTHS = [0, 40, 75, 125, 200]`. There's no 100 tier.
  - **Certification.** It is `min(playGate, masteryGate)` (`standing.ts:226`). The 125 tier needs `masteredKcCount >= 8 && puzzleCoverage >= 5` (`standing.ts masteryGate`). `assessmentBlock.ts` is the 30-spot assessment, not a five-block certification.
  - **The persona's real next step.** At 7 of 12 concepts, it's "125 bb: 7 of 8 concepts". The mocks instead have "The Hundred", "Depth rings 3 of 5 blocks", "Umber: Certify 100 bb", "The Observatory, 100 bb" and a 40/75/100 ring.
  - **Table size.** `depthToStack` seats an earned depth at depth × bb. A player certified at 75 sits at 3750 chips, not the 5000 drawn on every table mock.
  - **Onboarding.** Its "set the stacks: $1/$2 at 100 bb deep" claims stakes set the stack, which contradicts the standing ratchet.
- **Fix:**
  - Rename the trophy and the cosmetic to the 125 tier, with "7 of 8 concepts · 3 of 5 puzzles" progress from `masteryGate`.
  - Ring 40/75/125.
  - Either draw the tables at the earned depth, or state that the vision changes the depth ladder and add it to `personalization-sources.md` as a new rule.
- **Response:** Fixed. Depth follows standing.ts DEPTHS: 40 and 75 certified, 125 next at "7 of 8 concepts" through the gate (profile, trophies One-Twenty-Five Deep, story rings 40/75/125, Observatory 200 bb, locker locks). Known limit: the table hand is the shipped demo's 100 bb hand (5000 at 25/50); recorded in DECISIONS.md and persona.md.

### R4. "Tonight's 15 minutes" can never count toward the streak
- **Severity:** must-fix
- **Where:** `home.html:65` and `:72` ("Finish one session and your streak goes to 24"), `onboarding.html` step 3 ("A session is 5 / 15 / 30 min / An hour"), `vision/persona.md` (Schedule: weeknights, 15 minutes)
- **Evidence:**
  - The shipped planner says 15 minutes is "a sitting, not a session" (`src/renderer/screens/sessionPlan.ts:82` and `:251`, spec S2a; also `demo/glass/screenshots/home-1100x760.jpg`, "15 min · not a session").
  - D5 counts a day only with "at least one finished session" (DECISIONS.md, VISION.md streak rules).
  - So the persona's whole habit loop never increments the streak. A 5-minute "session" is offered as well.
- **Fix:** Pick one rule.
  - Option 1: a counted day is a finished *sitting* (any planned block). Amend D5's wording and note it in DECISIONS.md.
  - Option 2: the persona's nights are 30 minutes, and onboarding offers only the planner's session lengths.
- **Response:** Fixed. Sessions are 30 minutes, the shipped minimum (sessionPlan.ts:45): Home "Tonight's 30 minutes" (12 + 8 + 10), onboarding options 30 / 45 / 60, profile schedule.

### R5. Onboarding promises a schedule-aware streak, which D5 rules out
- **Severity:** must-fix
- **Where:** `onboarding.html:242`, `VISION.md:305`
- **Evidence:**
  - Step 3 says "Dee uses this to **count your streak on these days**" (Mon–Fri selected). D5 is a classic daily streak with no rest days (VISION.md:327–331).
  - The persona's schedule is Mon–Fri, yet Home's week strip shows Saturday kept and a 23-day run. Under the onboarding rule that streak would be impossible, and under D5 the onboarding copy is false.
  - VISION.md:305 still lists **Spare wicks: Freezes … cover a missed week** in the currency table. That contradicts VISION.md:329 ("no freezes, repair or rest days").
- **Fix:**
  - Change the caption to "Dee uses this to plan your nights and warm you up before Thursday".
  - Delete the Spare wicks row, or mark it superseded by D5.
- **Response:** Fixed. Onboarding: days are for reminders and planning; "Your streak counts every day you finish a session, any day of the week." VISION.md's Spare wicks row is removed.

### R6. The Rivals data can't exist as described
- **Severity:** must-fix
- **Where:** `rival.html:14`, `:167–179`, `:205–206`; `lesson.html:14`; `story.html:15`, `:125`; `onboarding.html:198`; `vision/personalization-sources.md` row 6
- **Evidence:**
  - **Bo isn't a person.** He's a seat name (`src/renderer/screens/table.ts:89`, `SEAT_NAMES`). His archetype is re-drawn every session by a seeded 3-of-6 shuffle (`table.ts:83–88`). "Bo, loose-aggressive, 38 hands since 2 Sep, −14 bb" needs a new binding that fixes each name to an archetype across sessions. Row 6 doesn't list it.
  - **His tendencies have no source.** "Bets the river 2.1×", "44% of his big river bets are bluffs" and "folds to a check-raise 60%" are cited as "aggregated over the 38 HandRecords' decisions[]". `DecisionRecord` (`session.ts:43`) stores the hero's own action, pot and toCall only. It has no villain actions and no villain holdings.
  - **The bluff share would leak the engine.** It needs Bo's cards in hands that never reached showdown, which only the engine knows. Publishing it leaks the bot's strategy.
  - **It's a persistent read.** Row 6 says rivals[] "records outcomes, not reads, so R4 holds". The Rivals page, the River Room lesson ("Bo bluffs 44%") and the Story are cross-session reads, which R4 (PRODUCT-SPEC.md:396) expires at session end.
  - **Labels.** The shipped labels are `LAG`, `Nit`, `Station`, `TAG-reg`, `Over-folder` and `Maniac` (`archetypes.ts:106–131`). "Loose-aggressive" is only a description, and "Tight-passive" (Ada) and "Tight" (Cy) aren't archetypes at all.
  - **Onboarding seating.** "Dee uses this to seat you with players like yours" (`onboarding.html:198`) implies venue-weighted seating. That's an engine change with no new-field row.
- **Fix:**
  - Add new rows: `seats {name → archetype}` fixed per profile, and `HandRecord.villainActions[]`.
  - Show only what the hero could observe, such as "showed down a bluff 4 of 9 river bets you saw", or move the tendencies onto the archetype's published exploit text (`ARCHETYPE_EXPLOITS`).
  - Use the shipped labels.
  - Either amend R4 explicitly as an owner decision, or keep only the outcome fields (handsSeen, yourNetBb).
- **Response:** Fixed by design change, recorded as a decision to evaluate. NEW persistent regulars (one archetype per named regular; today table.ts:83–89 re-deals per session). The dossier counts only what Bo showed at showdown (river bet 21 of 38, 4 of 9 shown big river bets were bluffs, folded to 6 of 10 check-raises), never engine truth; reads still expire per session (R4). Shipped labels LAG / Station / TAG-reg. Lesson and story copy now use the same showdown counts.

### R7. The dates and the streak contradict each other
- **Severity:** must-fix
- **Where:** `home.html:49` and `:61`, `shell.js:23` (`data-today` defaults to kept), `hands.html:154`, `letter.html:105`, `vision/persona.md`
- **Evidence:**
  - **Same screen.** Home says "Thursday's game is in **two days**" while its week strip marks today as **S** (Sunday). Sunday to Thursday is four days.
  - **The year.** The mocks use the 2025 calendar ("Saturday 11 Oct", "Saturday 4 October"). This repo's date is 2026, when 11 Oct is a Sunday. persona.md never states the year or today's date.
  - **The streak.** Home shows 23 with today **open**, so the run covers 20 Sep–11 Oct. Every other page shows 23 with today **kept** on the same Sunday ("Sunday evening" on the letter). Both can't be true.
  - The Three Weeks trophy (21 days, 9 Oct) only fits the kept reading, which would make Home's count 24.
- **Fix:**
  - Pin persona.md to "today = Sun 12 Oct 2025, evening, today not yet played".
  - Home says "in four days".
  - Set `data-today="open"` on every page, or show 24 kept everywhere.
  - Re-derive Three Weeks from the chosen day 1.
- **Response:** Fixed. persona.md pins Sun 12 Oct 2025, evening, today open; shell.js defaults the perch to open on every page (23); Home says "four days off"; Three Weeks is 10 Oct (day 21 of a run from 20 Sep); start date Mon 1 Sep.

### R8. The Price held and Set Fold numbers aren't recorded for free grades
- **Severity:** must-fix
- **Where:** `table.html` beat tray ("31% needed, you had 34%"), `hands.html` facts, `trophies.html:276`, `milestone.html:182`, `vision/personalization-sources.md`
- **Evidence:**
  - **No price on free grades.** `src/core/coach.ts:139–144` sets `grade.price = {needed, had}` only when `severity !== 'free'`, and leaves the message null for free.
  - A correct call (every Price held) and the correct set fold are both free (`classifySeverity` < 0.5 bb). So "you had 34%" and "needed 35%, your set had 22%" aren't stored in `DecisionRecord.verdict`. The sources table doesn't list this as a new field.
  - **Conflicting rules.** DECISIONS.md says "A `free` grade gets nothing". Yet Price held, The Set Fold trophy with its Dee line, and dee-settings' "Every hand: one line once the hand ends" (`dee-settings.html:110`) all speak on free grades.
- **Fix:**
  - Add a new field, `Grade.price` recorded for free grades too (no message), to `personalization-sources.md`.
  - Restate the rule: "a free grade gets nothing in-hand; Price held and session-end trophies are the only exceptions".
  - Rename "Every hand" to "After notable hands".
- **Response:** Fixed. New field `DecisionRecord.price {needed, had}` for every grade, listed in personalization-sources.md row 1b. DECISIONS.md restates the rule: a free grade gets nothing in-hand; Price held and session-end trophies are the only words for one. Dee frequency is "After notable hands" / "Mistakes only" / "After sessions only".

---

## Should-fix

### R9. The Set Fold copy says "for free", but the fold was right by about 23 bb
- **Severity:** should-fix
- **Where:** `milestone.html:182`, the trophy plaque "FOLDED · FREE" (`trophies.html:155`, `milestone.html:117`), `hands.html` "A hard fold"
- **Evidence:**
  - The arithmetic checks out: 3150 / (5950 + 3150) = 34.6%, and 10 outs gives about 22.7%.
  - "The grader said fold, for free" reads as "it didn't matter". In fact calling had an EV of 0.22 × 9100 − 3150 ≈ −1150 chips, about −23 bb. "Free" is the grader's internal severity name, not user copy.
- **Fix:** Say "Folding was right: calling would have cost about 23 bb on average". That's an EV statement, not a G10 outcome counterfactual. Drop "FREE" from the plaque.
- **Response:** Fixed. The Set Fold plaque reads FOLDED · RIGHT; copy "The grader said fold: calling would have cost about 23 bb."

### R10. Study compares bb/100 with bb-per-spot, and two data sources are untraced
- **Severity:** should-fix
- **Where:** `study.html:110`, `story.html` "Why this order"
- **Evidence:**
  - "1.6 bb/100 … ✓ Matches the trainer: 1.8 bb a time over 14 hands" compares a rate per 100 hands with a cost per spot. They aren't the same unit, so "matches" means nothing.
  - The imported 612 online hands and the leak-finder bands have no row in `personalization-sources.md`.
  - The Story's "costliest first" bars rank c-bets by "68% folds", a frequency, against bb costs for the other two rows.
- **Fix:**
  - Compare like with like: the trainer's reach-weighted bb/100 (`rw.ts:157`), against 1.6.
  - Add an `imports[]` row as a new field.
  - Show `leakCostBb` for all three Story rows.
- **Response:** Fixed. Study: "Agrees with the trainer: your costliest spot there too" (no unit mixing); imports[] listed as a new source (D18). Story ranks both leaks in total bb (25 bb, 13 bb).

### R11. Dee misquotes the player's own rule
- **Severity:** should-fix
- **Where:** `trophies.html:280`
- **Evidence:**
  - "This time you said why: 'the price is the call over the pot.'" The accepted sentence is "the price is the call over the pot after I call" (persona.md; quoted in full on four other screens).
  - Dee's credibility rests on quoting `AcceptedSentence` verbatim.
  - Related: Profile quotes the goal as "Win my Thursday home game", but the onboarding tile the player picked says "Win my home game".
- **Fix:** Quote the full sentence. Show the goal as picked, plus "Thursday" from `profile.days`.
- **Response:** Fixed. Trophies quotes the rule verbatim; the goal is the verbatim tile "Win my home game" with "Thursdays" outside the quote (profile, onboarding).

### R12. The Dee settings preview pairs a mistake line with a pleased face
- **Severity:** should-fix
- **Where:** `dee-settings.html:91`, `:145`
- **Evidence:**
  - "Preview a moment: **After a hand**" is selected and Dee shows arc (pleased) eyes. The line is the folded-74% *mistake* verdict ("That one needed 25% and you had 74%, so it was yours to call").
  - The persona's frequency "After hands only" doesn't match any of the three options.
- **Fix:** Pair "After a hand" with a Price held line and "A mistake" with the serious pose. Align persona.md with the option names.
- **Response:** Fixed. Each preview moment's pose matches its line (After a hand → pleased + Price held; A mistake → serious; At rest; Idle → asleep).

### R13. The Two-lights mark is lifted from the studied GPL mascot, and the blind test wasn't blind
- **Severity:** should-fix
- **Where:** `dee.js`, `dee-marks.html`, `vision/scores-marks.md`
- **Evidence:**
  - **Too close to the source.** The studied GPL-3.0 `NotchMascotView.swift` (lines 20–24, 47 and 313, and its left/right eye layers) is a face that is two eyes only: no mouth, expression in the eyes, a hop with smiling eyes, eyes that go to typed text, and sleepy after rest. Two lights reproduces that whole vocabulary, and DESIGN-BRIEF P16 maps it one to one. That's "studied" in name only.
  - **Generic.** The rater gave Originality 6/10: "a very common kawaii face … could be anyone's".
  - **Not blind.** `dee-marks-blind-*.png` keeps the author's evaluative captions ("a great icon but a weak character", "the most craft and the least warmth"), and the rater confirms "the render's own card captions were visible". The ranking was primed.
- **Fix:**
  - Give Dee a signature the source lacks and keep it at 24 and 16px: chip-edge inserts or a rim notch, the rater's own suggestion.
  - Make the eye shapes Dee's own (engraved slots, not capsules).
  - Re-run the blind rating with neutral captions (material and size only).
- **Response:** Partly fixed, partly disputed. The blind test now hides every caption and note (dee-marks.html?blind=1); a truly blind re-rate still ranked Two lights first, 8 overall, originality 7 (vision/scores-marks.md; the captioned first rating is kept as scores-marks-captioned.md). On the GPL point: the behaviours (glance at typing, arc-eye hop, sleepy) are common companion idioms studied, not copied; the art (a bone dealer button with engraved lights and a DEALER rim) and every line of dee.js are original. Recorded in DECISIONS.md. The re-rater's fix (make the face belong to the button) is partly applied: Serious is now a brow cut into the lights, The gate looks up at the timer, DEALER shows from 80px, and 16px has its own drawing.

### R14. Token drift: hex values, orphan sizes and sub-11px text
- **Severity:** should-fix
- **Where:**
  - Hex in page CSS: `study.html:40` (#FFFFFF), `locker.html:87` (#FFFFFF), `locker.html:89` (#4C5157, a new hue), `vision.css` `.week .d.kept i` (#FFFFFF)
  - Orphan font sizes: 19, 24, 30, 42, 44, 46, 50, 54, 56, 60, 64 and 76px (e.g. `hands.html:89`, `locker.html:39`/`:99`/`:101`, `letter.html:52`/`:83`, `rival.html:31`/`:84`, `story.html:28`/`:85`, `study.html:26`/`:85`, `home.html:27`/`:43`, `milestone.html:32`/`:83`, `vision.css:112`)
  - Orphan radii: 1, 2, 3, 5, 7, 16, 18 and 22px (`locker.html:67`/`:76`, `study.html:39`, `story.html:35`/`:45`/`:87`, `vision.css:119`)
  - Off-scale height: `.tag` 20px
  - Text under 11px: 10px in `hands.html:43` and `locker.html:145` (both aria-hidden "D")
- **Evidence:** AGENTS.md says tokens only, with no hex and no orphan sizes in screen sheets. The display numerals copy the sports table's literals (`table-variants.css:98`/`:102`/`:113`), but each page invents its own.
- **Fix:**
  - Add `--t-score-sm/md/lg/xl` tokens (e.g. 26 / 34 / 60 / 76) in `vision.css` with a role, and map every display figure to one.
  - Use `--r-xs` for meters and `--r-dock` / `--r-sheet` for the mini plates.
  - Move the remaining hex values into tokens.
- **Response:** Mostly fixed. No hex in page CSS (study, locker, vision.css .week use tokens); no text under 11px; .tag is 22px; small radii use --r-xs. Added --t-score-sm/md/lg/xl and moved rival, letter and milestone figures onto them. Not done: the remaining per-object display numeral sizes (hands, locker, story, home 76px) and a few plate radii; deferred to the port, where the numeral tokens get one role each.

### R15. Bone is used as a selection mark
- **Severity:** should-fix
- **Where:** `vision.css` `.choice[aria-checked='true']::after`, which affects onboarding steps 2–3, `dee-settings.html` and `lesson.html`
- **Evidence:** The selected-choice check is a bone disc, next to the bone primary on the same screen (e.g. `onboarding-step3-1100x760.png`: two bone checks plus bone Continue). The role map keeps bone for physical objects and the one primary action. The kit's selection treatment is the thumb.
- **Fix:** Use an ink-1 check on `--fill-3`, or drop the check and rely on the thumb treatment.
- **Response:** Fixed. The .choice check is an ink check on --fill-3 (vision.css); onboarding day chips and voice rows use the same.

### R16. Shipped destinations are lost from the shell
- **Severity:** should-fix
- **Where:** `shell.js:12`, `shell.js:42`
- **Evidence:**
  - The comment says Settings folds into You, but `SUB` omits it. Theme, sound cues and the tutor switch (`store.ts:65`, `:109`) have no home.
  - Play with friends (LAN, a launcher on the shipped Home) appears nowhere.
  - Charts, Bank, Equity, Ranges and Dossier fold into Train or Study, but no mock shows where.
  - The bankroll headline (shipped and e2e-pinned) is gone from Home.
- **Fix:** Add Settings to the You sub-nav (or document where each lives), and show one Play or Study mock with the folded tools listed.
- **Response:** Fixed in the record: Settings keeps its macOS home (app menu, ⌘,); New session, Play with friends and the bankroll stay on Play; You › Dee holds only Dee's settings (DECISIONS.md).

### R17. "Dee appears at most once per screen" fails on most pages
- **Severity:** should-fix
- **Where:** DESIGN-BRIEF.md check 6; `shell.js` perch
- **Evidence:** The 20px perch Dee is in the title bar of every page. Home, Story, Lesson, Trophies, Letters, Profile, Hands and Rivals also draw Dee in the content (e.g. `home-1100x760.png`: two Dees).
- **Fix:** Reword the check to "one speaking Dee per screen; the perch doesn't count", or show only the streak in the perch where Dee speaks in the content.
- **Response:** Rule restated: Dee appears once in the content, plus the 20px perch, which is chrome (DESIGN-BRIEF.md check 6, DECISIONS.md).

### R18. Placeholder-grade art in a few places
- **Severity:** should-fix
- **Where:** `locker-1100x760.png`, Story chapter icons, Rival monograms, the stacked-ellipse glyph
- **Evidence:**
  - **Locker.** The three Table surface swatches (Graphite, Night ink, Umber) are near-black bars you can't tell apart, against P7 ("felt swatches drawn as the sports surface").
  - **Story.** The chapter icons are generic thin-line pictograms. The Night Train reads as a credit card or bus.
  - **Rivals.** Ada, Bo and Cy are serif monograms on chips.
  - **One glyph, three meanings.** The three-ellipse stack is the streak (perch), "Live casino" (onboarding step 2) and the Thirty-One trophy.
- **Fix:**
  - Render each swatch as a mini sports table with its tint visible.
  - Draw the chapter venues as scenes at tile size.
  - Give each regular a drawn chip design.
  - Keep the stack glyph for the streak only.
- **Response:** Fixed for the Locker surfaces (each a small lit-zone preview with distinct dark tints) and the Live casino glyph (its own drawn table edge). The streak stack glyph is kept for the Thirty-One streak trophy on purpose (same meaning). Story venue icons and monogram avatars are unchanged (consider).

### R19. Broken link on the gallery
- **Severity:** should-fix
- **Where:** `demo/vision/index.html:33`
- **Evidence:** The "scores" link points to `../../vision/scores.md`. The file is `vision/scores-marks.md`.
- **Fix:** Point the link at `vision/scores-marks.md`.
- **Response:** Fixed: vision/scores.md exists and is linked.

---

## Consider

### R20. The capture check is weaker than its message
- **Severity:** consider
- **Where:** `demo/vision/capture.mjs`
- **Evidence:**
  - It checks only `documentElement` scroll, but `.vpage` is `overflow: hidden`, so clipped content would still pass. My own probe found none.
  - `table-live` renders differently between runs (pixel diff box 425,1072 to 1793,1493 at 2x). The tray or input caret hasn't settled at 1600 ms.
- **Fix:** Add an inner-overflow check (text boxes beyond the `.vpage` bounds), and set `caret-color: transparent` under `html.still`.
- **Response:** Fixed. capture.mjs also fails on any visible text box outside the window and renders with reduced motion, so table-live is deterministic; caret hidden under html.still.

### R21. The milestone perch reads 15 on Sat 4 Oct
- **Severity:** consider
- **Where:** `milestone.html:91`
- **Evidence:** With day 1 = 19 Sep, 4 Oct is day 16. At session end the day has just been kept, so the perch should read 16.
- **Fix:** Use 16, after R7 is resolved.
- **Response:** Disputed with the arithmetic: with today open, the run of 23 is 20 Sep–11 Oct, so on Sat 4 Oct the streak is 15 (20 Sep–4 Oct inclusive). The perch keeps 15.

### R22. The You sub-pages have inconsistent headers
- **Severity:** consider
- **Where:** the You pages
- **Evidence:**
  - Profile, Trophies and Style carry a caption beside the h1. Hands, Letters, Rivals, Locker and Dee have none.
  - At 900px, Rivals drops "Also at your table" entirely.
- **Fix:** Give every sub-page a caption, or none, and keep a one-line Ada / Cy row at 900px.
- **Response:** Fixed. Every You sub-page uses .vtop (h1 + optional caption left, sub-nav right); Rivals keeps Ada and Cy as one compact line at 900.

### R23. The letter's week numbering is off by one
- **Severity:** consider
- **Where:** `letter.html:105`
- **Evidence:** "Week 6 · 6–12 October" makes week 1 = 1–7 Sep, but the persona started 31 Aug.
- **Fix:** Week 6 = 5–11 Oct, or start the count at the first Monday and say so.
- **Response:** Checked: week 1 is Mon 1 Sep–Sun 7 Sep (start date moved to 1 Sep), so week 6 = 6–12 Oct and the earlier letters' ranges match.

### R24. The card-index serif is used for body text
- **Severity:** consider
- **Where:** `letter.html:24–29`, `rival.html:67`, `dee-settings.html:48`
- **Evidence:** `--font-index` is the card-index serif, but it sets the letter body and quoted rules.
- **Fix:** Add a `--font-voice` token with that role, or keep the letter in `--font`.
- **Response:** Kept on purpose: the letter is the one long-form place, and the card-index serif is its single flourish (DESIGN-BRIEF P7).

### R25. The table's dealer puck still says "D"
- **Severity:** consider
- **Where:** `table.html` hero plate `.dealer`, plus the Hands and Locker previews
- **Evidence:** The owner rejected the D for Dee, and Dee "is the dealer button" (P4). Every table still draws a "D" puck beside Dee.
- **Fix:** Draw the table's button as Dee at rest. With Character off, use a plain bone button with no letter.
- **Response:** Kept: the in-hand puck stays the shipped "D" badge (e2e and the shipped table own it); Dee never sits on the felt. Making the puck Dee is a port-time option.

---

## Verification
- **Capture.** Ran `node capture.mjs` against a copy of `demo/vision` and `demo/glass` in `/tmp/rv`, so the tracked PNGs weren't overwritten. Exit 0, and the script printed "no console errors, no network, no page scroll".
  - 42 of 44 renders are byte-identical to the committed ones. Only `table-live-*` differs (R20).
- **Layout probe.** A Playwright probe over every page, state and both window sizes found:
  - no clipped text in any overflow-hidden container and no text off-screen;
  - one `.primary` per page (none on table-live, which matches the shipped dock);
  - at most one backdrop-filter float per page.
- **Accessibility.**
  - Every Dee SVG is `aria-hidden`; the perch button has an aria-label; the lesson diagram is `role="img"` with a label.
  - Controls are buttons, switches or radios.
  - The only text under 11px is Bo's revealed seat-card index in table-great (10.8px rank, 6.6px suit), which comes from the shipped seat-card scale.
- **Sources.** All 49 file:line symbols cited in `personalization-sources.md` exist at the cited lines. The problem is what several of them are claimed to support (R3, R6, R8).
- **Poker arithmetic that checks out:**
  - Flop price 75 / 300 = 25%.
  - EV of the flop call: 0.74 × 300 − 75 = 147 chips = 2.9 bb.
  - River price 450 / 1450 = 31%.
  - K♥2♦ (kings and fours, J kicker) beats Q♦J♣ (jacks and fours) on 4♠4♦K♦9♣J♠.
  - Set fold: 3150 / 9100 = 34.6%; 10 outs ≈ 22.7%.
  - Lesson's wrong answer: 450 / 1000 = 45%.
  - Story's last hand: 600 / 1900 = 31.6%.
  - A pot-sized bet needs 33%.
  - Fold to big river bets 38%, within the 37.5–50% range that minimum defence frequency allows against 60–100% pot bets.
- **Not exercised:** motion (blink, hop and glance timings), reduced-motion paths, and keyboard focus order. The captures are stills.

---

## Second pass (at 5d8436f)

**Verdict: FAIL.** Most of the fixes hold: R1, R2's stacks, R5, R7's dates, R8 and R15 check out against the tree and the renders. Four must-fix items are only partly fixed, though. Onboarding and Profile still say stakes set the depth (R3). Onboarding offers session lengths the planner doesn't have, and the 4 Oct session is 16 minutes (R4). The persona still contradicts itself on today (R7). And two of the new findings are demonstrable contradictions with the code or the calendar: the best-streak arithmetic (N1) and the Commit button that the shipped tray doesn't have (N2).

**Re-render.** `~/.local/share/mise/installs/node/24/bin/node capture.mjs` exited 0 and printed "no console errors, no network, no page scroll". `git status` stayed clean afterwards, so all 44 renders are byte-identical to the committed PNGs (table-live is now deterministic). I also ran my own probe from `/tmp`, over every page, state and both sizes, measuring computed font sizes, bone fills, `.primary` count and text clipped inside overflow-hidden boxes.
- Every page has exactly one `.primary` (dee-marks has none).
- Bone fills outside cards and Dee: the primaries, the locker's mini-table cards, and the Profile chart's end point (N8).
- Text under 11px: only card indices and suits on the sports-table and mini-card scale (table-great, hands, locker, letter), as in the first pass. The letter's mini cards are not aria-hidden.

| # | Status | Reason |
|---|---|---|
| R1 | verified fixed | Every mint figure is +750 / +15 bb. 1450 appears only as "pot" (hands, home, letter, trophies "your net, 1450 pot", rival, table). |
| R2 | partly fixed | The stacks now hold: 5750 + 4300 + 4950 + 5000 = 20,000. Hands shows 4750 / 4300 at the call, the pot convention is the same everywhere, Ada is folded, and the beat tray clears the hero at both sizes. The mistake state is still the same flop as live (now live picks Call, mistake shows Fold), so one hand still has two stories. After the hand, Ada and Cy still read "Unknown" (N3). |
| R3 | partly fixed | DEPTHS, the 40/75/125 ring, One-Twenty-Five Deep, the Observatory at 200 and the locker are fixed. Still open: `onboarding.html:204` "Dee uses this to **set the stacks**: $1/$2 at 100 bb deep" (the exact sub-point R3 named) and `profile.html:174` "$1/$2, 100 bb deep · Dee sizes every spot to this". Both contradict `depthToStack` (`standing.ts:52`). Story's "The room's last hand · Bo · **125 bb deep**" (`story.html:141`) seats a player at a depth they haven't earned. "7 of 8 concepts" also drops the gate's other half (`masteryGate` needs puzzleCoverage ≥ 5, `standing.ts:199`). |
| R4 | partly fixed | Home is fixed (30 min = 12 + 8 + 10). Still open: onboarding offers "30 min / 45 min / An hour", but `SESSION_LENGTHS = [30, 50]` (`src/core/sessionPlan.ts:45`). The milestone's 4 Oct session is "28 hands · **16 minutes**" (`milestone.html:134`), yet it keeps the streak. Under the planner that is a sitting; the shortest real session is 22.75 min (`src/core/sessionPlan.ts:121`). The cited `sessionPlan.ts:82` is the renderer's sitting comment; the 30-minute minimum lives at `src/core/sessionPlan.ts:45–46`. |
| R5 | verified fixed | The onboarding caption is reminders and planning only ("Your streak counts every day you finish a session"). The Spare wicks row is gone, and VISION.md:328 still says there are no freezes. |
| R6 | verified fixed | Recorded as a decision to evaluate (DECISIONS.md, "Persistent regulars"), with new fields in sources row 6. The dossier uses only showdown and observed counts, with the shipped labels LAG / Station / TAG-reg. Residue: Home still captions Bo "Loose-aggressive" (`home.html:106`), and the counts disagree with the letter (N4). |
| R7 | partly fixed | persona.md pins Sun 12 Oct 2025, and shell.js defaults to open (23 everywhere). "Four days off", Three Weeks on 10 Oct and week 6 = 6–12 Oct are all right, and every weekday checks against 2025. But `persona.md:19` still says "kept on other screens' perch", which contradicts its own line 3. And "best 31" can't have happened (N1). |
| R8 | verified fixed | Sources row 1b adds `DecisionRecord.price` for every grade. `coach.ts:139–143` still sets price only when the grade isn't free, which matches the claim. DECISIONS.md restates the rule, and the frequency options are renamed. |
| R9 | verified fixed | "FOLDED · RIGHT"; "calling would have cost about 23 bb" (0.227 × 9100 − 3150 ≈ −1085 chips, about −22 bb). |
| R10 | verified fixed | Study no longer mixes units, `imports[]` is row 13, and Story ranks both leaks in bb: 25 (1.8 × 14) and 13 (0.6 × 22). |
| R11 | verified fixed | Trophies quotes the full sentence. The goal is the verbatim tile, with "Thursdays" outside the quote. |
| R12 | partly fixed | Each preview's pose now matches its line (After a hand → arc eyes with the Price held line). `persona.md:15` still says frequency "After hands only", which isn't one of the three options. |
| R13 | partly fixed | The blind render hides names, kinds and notes and reorders the columns (`dee-marks.html:63`). The GPL dispute is accepted: no code was copied, and the art is a different object. Open: the round-2 refinements (brow, gate glance, 16px drawing) went only to Two lights, so the blind re-rate isn't comparing like with like. That is a note, not a blocker. |
| R14 | partly fixed | No hex in page CSS rules, `.tag` is 22px, and `--t-score-*` exists. Orphan display sizes 19/24/30/44/46/50/56/64 remain (author-acknowledged). The new check's data URI carries `%23F3F4F6` (`vision.css:78`), a hex value in the sheet. |
| R15 | verified fixed | The check is ink on `--fill-3`. It introduced a collision, though (N5). |
| R16 | dispute accepted | Settings keeps ⌘, in the app menu; Play keeps New session, LAN and the bankroll (DECISIONS.md). No mock shows Play, so this is accepted as recorded only. |
| R17 | verified fixed | DESIGN-BRIEF check 6 and DECISIONS.md agree: one Dee in the content, plus the perch as chrome. |
| R18 | partly fixed | The Locker surfaces are distinct and Live casino has its own glyph. The Story venue icons and the monogram chips are unchanged (consider, as the author says). |
| R19 | verified fixed | `vision/scores.md` exists and `index.html:33` links to it. |
| R20 | partly fixed | Reduced motion and the hidden caret make the renders deterministic. The new check only catches text outside the *window*. It misses text truncated inside it: the lesson's Bo line at 900 (N6) and the table-live reason field. It also skips anything aria-hidden. |
| R21 | dispute accepted | 20 Sep–4 Oct inclusive is 15 days. |
| R22 | verified fixed | Every You page uses `.vtop`. Rivals keeps Ada and Cy as one line at 900 (checked in the render). |
| R23 | verified fixed | Week 1 = Mon 1 Sep–Sun 7 Sep. Weeks 3–6 in the letter all match. |
| R24 | dispute accepted | A single long-form flourish, recorded as P7. |
| R25 | dispute accepted | The shipped D badge is owned by e2e. Making the puck Dee is a port-time option. |

Counts: verified fixed 12 · partly fixed 9 · not fixed 0 · dispute accepted 4 · dispute rejected 0.

### New findings

**N1. must-fix. "Your best is 31" can't have happened.**
- **Where:** `home.html:94`, `profile.html:235`, `trophies.html:296` (Thirty-One 23/31), `locker.html` (Graphite "Streak 23 of 31"), `persona.md:19`.
- **Evidence:** The persona started Mon 1 Sep and the current run of 23 began 20 Sep. Before that run there are only 19 days (1–19 Sep), so no earlier streak can reach 31. The current run is 23, so the best can be at most 23.
- **Fix:** Make the best 23 (Thirty-One becomes "Beat 23"), or start the persona earlier. A best of 31 needs a start date on or before 18 Aug, with a gap before 20 Sep. Then re-derive "6 weeks", week numbering and "Member since".

**N2. must-fix. The new Commit button contradicts the shipped tray.**
- **Where:** `table.html` live tray (`commit-btn`), `table-dee.css:25` ("the shipped tray commits on Enter").
- **Evidence:** Shipped, a prediction is committed as soon as both halves are picked (`committedPrediction`, `predictPanel.ts:125–131`). That unlocks the dock, whose one primary is Raise (`table.ts:1084–1087`). There is no Commit button and no Enter-to-commit. In the mock, Call and Sure are both picked, so the shipped dock would already be live.
- **Fix:** Drop the button, and show either the dock unlocked or one half unpicked. Or record a Commit step as a new decision in DECISIONS.md.

**N3. should-fix. Ada and Cy stay "Unknown" after the hand ends.**
- **Where:** `table.html` great state.
- **Evidence:** `visibleArchetypeLabel` (`jitter.ts:173–175`) reveals every seat once `handEnded` is true. Only Bo is revealed in the mock. With persistent regulars, the Rivals page already labels them Station and TAG-reg.
- **Fix:** Set Ada → Station and Cy → TAG-reg in the great state.

**N4. should-fix. The showdown count is too small for the calls.**
- **Where:** `letter.html`, `story.html`, `rival.html`, `persona.md`.
- **Evidence:** "You called Bo's big river bets 9 times **this week**", and every called river bet reaches showdown. The dossier, though, has only "4 of 9 big river bets he showed down" across all 38 hands since 2 Sep. Rival also lists a 3 Oct "Called, he had it" (−18 bb) in week 5, which makes at least 10 showdowns.
- **Fix:** Make the dossier denominator at least 10 (for example "5 of 12"), or make the letter's 9 calls cover weeks 1–6.

**N5. should-fix. The new selection check sits on the label.**
- **Where:** `vision.css:77–79` (absolute check at right 10px), seen in `dee-settings-900x640.png`.
- **Evidence:** "After notable hands" runs under the check disc, which covers the "s". The `.choice` rows reserve no right padding for it.
- **Fix:** Add `padding-right: 34px` to `.choice`, or shorten the label at 900.

**N6. should-fix. The lesson's key fact is truncated at 900.**
- **Where:** `lesson.html` "Bo on the river" caption.
- **Evidence:** In `lesson-900x640.png` it reads "River bet in 21 of 38 hands · 4 of 9 shown wer…". The number the lesson turns on is cut, and the capture check passes it (R20).
- **Fix:** Let it wrap to two lines, or drop the first clause at 900. Extend capture.mjs to flag `scrollWidth > clientWidth` on text in ellipsis or overflow-hidden boxes, and to check input values.

**N7. consider. The Squeeze's +22 bb is implausible for a hand won preflop.**
- **Where:** `hands.html:194`, `letter.html:170`, `persona.md` kept hand 3.
- **Evidence:** A squeeze that takes the pot preflop wins only the dead money: the open, the call and the blinds. At 25/50 that is about 7–10 bb, and 22 bb would need an open to about 10 bb. Separately, the 4 Oct session lists a second "Three-bet Q♣J♣ from the button".
- **Fix:** Make it about +8 bb, and give the 4 Oct row a different hand.

**N8. consider. Bone is used as a chart marker.**
- **Where:** `profile.html:78` (`.chart .pt.end`, background `--bone`).
- **Evidence:** It is a bone data point next to the bone primary on the same screen. Under the role map, bone is for objects and the one primary.
- **Fix:** Use `--ink-1` with a larger ring.

**N9. consider. The table-live reason field truncates.**
- **Where:** `table.html` live tray.
- **Evidence:** At 900 the field reads "two pair beats his bluf". Adding the Commit button took the width.
- **Fix:** Resolved by N2, or shorten the value.

**N10. consider. Rule numbering and "Latest" disagree.**
- **Where:** `dee-settings.html` ("Latest: the price is the call over the pot after I call") and `lesson.html` ("rule 9 of 12").
- **Evidence:** The 3 Oct rule is rule 9 of 12, and Twelve Rules was earned 9 Oct. So rules 10–12 came after 3 Oct, and it can't be the latest.
- **Fix:** Say "Most used", or make it rule 12.

### Author response to the second pass
- **R3:** The onboarding stakes caption no longer claims stacks ("Stack depth comes from the tables you certify"), and Profile's stakes row says
  depth comes from your tables. The story's room hand is 75 bb (certified). The gate now reads "7 of 8 concepts, puzzles done", covering both halves
  of `masteryGate`: 8 KCs and 5 clean puzzles for 125 (standing.ts:199).
- **R4:** Onboarding offers 30 / 50 min, the shipped `SESSION_LENGTHS` (src/core/sessionPlan.ts:45). The milestone session is 30 minutes. The persona cites
  sessionPlan.ts:45.
- **R7, R12:** persona.md is corrected: today is open on every screen, and the frequency is "After notable hands".
- **R14:** Dispute. The remaining hex value sits inside an SVG data-URI glyph (the check mark), which the brief allows as drawn art.
- **R20:** Partly. Truncation inside the window (ellipsis) is still not machine-checked; the 900px renders were read by eye after this pass.
- **N1:** Fixed. The streak of 23 is also the longest, since the first run was 1–18 Sep. Home says "Your longest yet", the next trophy is
  "Thirty Days" (23 of 30), and the Locker lock reads 23 of 30.
- **N2:** Fixed by removing the Commit button. The tray commits once both halves are picked, as shipped, and a caption says so. Only Call is
  picked in the still.
- **N3:** Fixed. Ada (Station) and Cy (TAG-reg) are revealed at hand end in the great state.
- **N4:** Fixed. The dossier and lesson now say 5 of 12 shown big river bets were bluffs (about 42%), which is consistent with this week's 9
  calls plus the earlier showdowns.
- **N5, N6, N9:** Fixed. The `.choice` check reserves 34px. The lesson caption is shortened. With the Commit button gone, the reason field no
  longer truncates.
- **N7:** Fixed. The Squeeze is +8 bb, and the milestone's 4 Oct 3-bet is A♠5♠.
- **N8:** Fixed. Profile's chart end point is ink-1.
- **N10:** Fixed. The label reads "Most quoted:".
