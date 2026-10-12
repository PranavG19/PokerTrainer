# Offsuit cast bible: Dee, the button who has sat in every seat

Panel lens: character and narrative design. The ask: a Duolingo-like character system (streaks, a character who teaches, cosmetics), "massive refactor, extremely wacky and ambitious".

My brief is the cast, how they speak, and the story. I aimed for something stranger than an owl, and I kept the teaching guarantees the codebase already enforces. Those guarantees shape the characters. A mascot that praises, shames or glamorises gambling would be blocked by `bannedPhrasingIn` (`src/core/progress.ts:470`) and by the tutor guard (`src/main/tutor/guard.ts`) before it shipped. The cast below is designed to pass both.

---

## 0. Three constraints that shape the characters

1. **The silence rule is a personality trait.** A `free` grade (< 0.5 bb) produces no output (`classifySeverity`, `src/core/coach.ts`; `renderCoachPanel`, `src/renderer/components/coachPanel.ts`). Duolingo's owl reacts to everything. Our lead says nothing when nothing was lost, and that restraint is its signature. Its silence is the reward.
2. **The task is the subject, never the person.** `BANNED_PHRASINGS` bans `you are`, `you're`, `too loose/tight/passive/aggressive`, `fish`, `great job`, `well done`, `keep it up`. It also bans `nit` and `maniac` as words. Guard check 4 rejects a leading second-person pronoun. So the characters talk about hands, prices and ranges. They never call the learner good or bad, and they never say "You…" at the start of a line. Rivals get proper names because two archetype ids are banned words.
3. **Archetypes stay hidden until showdown.** `tableTalk.ts` keeps in-hand banter free of information, and `visibleArchetypeLabel` (`src/core/jitter.ts:173`) hides each villain's label until the hand ends. If a rival is introduced by name at a read-training table, the read is given away. The fix is the Masquerade: every seat at a read table is masked, and the reveal happens at showdown (section 4).

---

## 1. The lead: **Dee**, the dealer button

### Concept
Dee is the dealer button. It is the small disc with a "D" that moves one seat clockwise every hand. Dee has done this at every table there has ever been. That makes it the only object in poker that has played from every position, seen every showdown and never held a card. It has watched everything and bet on nothing, which is the right stance for a teacher who grades decisions and ignores results.

Why a button fits:
- **Position is the first principle the curriculum teaches** (`betting-order-and-position.ts`, `position-sets-your-range.ts`, `opener-seat-sets-defence-width.ts`). The button is position made into an object, so Dee's job (it moves every hand) is itself the lesson.
- **It is already on the felt.** The table already renders a dealer badge (`.dealer-badge` and `.dealer-button`, `src/renderer/styles.css:258, 486`). The large refactor is that this badge **becomes Dee**. During a hand Dee sits in its seat as a working button. When a `notable` or `serious` verdict fires, Dee slides off its seat to the coach sheet, delivers the verdict, and slides back in time for the next deal. The mascot is a working part of the game, not a sticker on the corner of the screen.
- **It has no stake.** A button never wins a pot, so it cannot celebrate a pot or mourn one. That is outcome-blind grading in character form (TEACHING-METHOD, "Every outcome signal in learning mode").

### Silhouette and material
- A thick disc with a softly rounded edge, about 1:4 height to diameter, made of **smoked graphite glass** (it uses the `.g-` material from `styles-glass.css`). The D is engraved in **bone** enamel on top.
- **The face is the D itself.** The bowl inside the letter (its counter) is Dee's only feature. It works as an aperture that changes shape: a wide oval when listening, a thin crescent when amused, a hard flat line when serious, and two small marks shaped like quotation marks when quoting the learner. It has no eyes and no mouth. The silhouette is just a coin with a letter, which reads at 16 px and avoids every existing mascot shape.
- **Motion vocabulary:** Dee tilts the way a coin wobbles. When thinking it rolls on its edge. When it insists, it stands upright on its edge. When resting it lies flat, like a button put away in the drawer. Each pose maps to a coach state (section 7).
- **Colour discipline** follows the AGENTS.md role map. The body is neutral graphite and the engraving is bone. The rim light is **amber** for a notable verdict and while the gate timer runs, and **coral** for a serious one. Dee is **never mint**, because mint means "your turn" and positive deltas and is pinned by e2e. The only exception is the mastery engraving, which shimmers mint once because it is a real positive delta. Felt green stays on the table only.

### Personality bible

**Core values**
1. *The price, not the pot.* Dee cares about what a decision cost, never about what it won.
2. *Ask before telling.* It is the Interrogator hat before the Explainer hat (PRODUCT-SPEC T3).
3. *Your words outrank mine.* Once the learner has written a mechanism sentence, Dee quotes it before its own words (`feedbackOpening`, `src/core/lexicon.ts:303`).
4. *A gap is not a failure.* Spacing makes gaps correct (`career.ts` cadence header; `schedule.ts` WAVES at days 0/1/7/21/30).

**Voice**
- Dry, warm, a little old-world, like a croupier who has quietly read a lot of philosophy. Short sentences. Concrete nouns: price, pot share, range, card, seat.
- In-hand lines are at most 12 words, and Dee says nothing beyond the engine's own message (section 5). Flavour comes between hands.
- It counts in seats and orbits: "Three orbits ago…", "From the cutoff, the price changes."

**Verbal tics**
- **"Noted."** This is Dee's whole reaction to a notable verdict that has already been explained once this session.
- **"From this seat…"** begins any position remark.
- **"Price first."** Dee's motto, which it says when a `pot odds` verdict lands.
- **The orbit count.** Dee measures time in hands dealt ("forty hands since the last one of these"), never in days missed.
- Talks about itself as furniture: "I just move left. The thinking is the table's."

**What Dee never says**
- Trait claims ("you are…", "a tight player", "a natural"). These are banned and are bad teaching.
- Praise attached to a correction ("nice, but…"). TEACHING-METHOD bans it because the "but" clause is the part that gets dropped.
- Anything about chips won, a hot run, "due" cards, luck, "let it ride", or "one more hand". There is no glamour around gambling. The only time Dee mentions an outcome is to separate it from the decision.
- Anything about other players' progress, percentiles or comparisons (PRODUCT-SPEC v2.1 amendment).
- Guilt about absence. There is no "I miss you" and no sad face for a missed day.
- An answer before commit. The pre-commit rules path is the only one open before commit (T3a; the `RulesRequest` type in `src/main/tutor/types.ts` cannot carry solver fields). Before commit Dee can explain the rules and nothing else.

---

## 2. Supporting cast

Each supporting character is tied to a subsystem that already exists. They give a face to code that the learner currently meets as plain UI.

| Character | Object | Owns | Built on |
|---|---|---|---|
| **Folio** | A bone-white pocket notebook with a graphite elastic band. It opens like a clam to "talk". | The learner's own sentences, the lexicon. Folio reads them aloud, refuses cached answers, and never edits a sentence it has accepted. | `src/core/lexicon.ts` (L3 append-only, `REJECTION_TEXT`, `feedbackOpening`), `giftLedger.ts` (Folio also keeps the gift ledger, the same append-only pattern) |
| **Tock** | A small amber sand-glass that drains sideways. | The gate timer and fluency drills (PLMs). Tock is pure tempo and does not grade. | `RT_THRESHOLD_MS = 2000` and `PASS_RATE = 0.9` in `anomaly.ts`; `COMMIT_BUDGET_MS` in `confidence.ts`; the amber gate bar in `coachPanel.ts` |
| **The Muck** | A soft graphite heap of face-down cards that talks in a low murmur. | Folds, including the ghost-fold bucket. It is the keeper of hands you correctly let go. | `coach.ts` fold branches; the ghost-fold bucket (TEACHING-METHOD) |
| **Mirror** | A thin glass card frame with nothing in it. | Prediction calibration, "sure" against "guess". It shows your call before the reveal. | `predict.ts` (`Calibration`, `sureAccuracy`), `confidence.ts` (the 2×2 cells, `SURE_WRONG_SCHEDULE`) |

The supporting characters stay silent during a hand. Only Dee may interrupt, and only for a serious verdict (PRODUCT-SPEC "Immediate vs delayed"). The cast talks in lessons, drills, the Career screen and the campaign hub.

**A sample exchange (puzzle hub).**
Folio: "Page nineteen. Same handwriting as page four."
Dee: "Domination again. The sentence still holds."
Tock: "…" *(turns over)*

---

## 3. Rivals: the six archetypes as characters with story arcs

Source: `ARCHETYPE_NAMES = ['nit','station','lag','tag-reg','over-folder','maniac']` and `ARCHETYPE_EXPLOITS` (`src/core/archetypes.ts`). Each rival is one of these signatures with a name, a venue, an arc and a showdown line. They replace the single fixed `SHOWDOWN_LINES` entries in `tableTalk.ts` with a small showdown bank per rival. **Rival names never include the archetype id**, because two ids are banned words. The archetype label still appears only as `visibleArchetypeLabel` text after showdown.

| id | Rival | Venue | Behaviour, from the data | Arc |
|---|---|---|---|---|
| `nit` | **Wren Holloway**, the lighthouse keeper | The Lighthouse | callStrength 0.68, bluffRaiseFreq 0 (a structural zero) | Wren lights her lamp only for sure things. Chapter 1 teaches that her bet means strength: give up when she puts money in, and take her blinds when she does not. Late in the story, jitter (`jitter.ts`, O3) moves her bluffBetFreq up for one session and she bluffs exactly once. If you notice, `reads.ts` fires `gate-re-closed`. Her arc is "even a lighthouse flickers", which teaches that a read is a probability, not an identity. |
| `station` | **Barnaby Tull**, keeper of the toll road | The Toll Road Diner | loosecallFreq 0.85 | Barnaby pays every toll to see what is down the road. His curiosity is sincere and it costs him. Boss hand: a thin river value bet. Bluffing him is the trap. His arc ends when he buys a map, a lesson in the price of information. |
| `over-folder` | **Percival Hush**, the head librarian | The Quiet Library | callStrength 0.75, loosecallFreq 0 | Percival folds to any raised voice. The lesson is to bet and raise as a bluff (`alpha-the-bluff-price.ts`). His arc twist: in the epilogue he finally calls, but it happens in a session drawn with jitter, so the learner has to update the read rather than rely on the story. |
| `lag` | **Vesper Kade**, the night-train conductor | The Night Train | bluffBetFreq 0.5, bluffRaiseFreq 0.3 | Vesper never stops the train. Chapter lesson: widen your calls and let her barrel into you. Do not try to out-bluff her (`minimum-defence-frequency.ts`, `defend-the-big-blind.ts`). Arc: she respects whoever stays on the train. |
| `maniac` | **Juniper Vale**, the pier pyrotechnician | The Fireworks Pier | bluffBetFreq 0.8, betPotFraction 1.0 | Juniper treats every pot as a launch. Lesson: trap with strong hands and call down light (`equity-realisation.ts`, `domination-and-dead-hands.ts`). **Juniper is weather, not a role model.** The pier is loud and the story never makes her chip swings look glamorous. Her arc ends with her standing in the quiet after the show, out of chips and amused by it. That is a variance lesson, not a victory lap. |
| `tag-reg` | **Ines Marlow**, the metronome | The Observatory | balanced, "no reliable leak" | **The final boss, where you win by not deviating.** The O2 rule says the learner is scored for playing the standard line against her. Lore: Ines was Dee's first student. The final chapter tests whether you can sit across from someone with no leak and not invent one. |

**Showdown banks** extend `SHOWDOWN_LINES`. Each comments only on the rival's own style, as `tableTalk.ts` requires.
- Wren: "Lamp's only lit when the ship is real." / "Three hours for that one hand. Worth it."
- Barnaby: "Had to see what was round the bend. Always do."
- Percival: "Shh. I fold when it gets loud. It gets loud a lot."
- Vesper: "Train doesn't stop. Never has."
- Juniper: "Who needs a fuse? Light it all at once!"
- Ines: "Standard. I'd do it again."

---

## 4. Story mode: "The Long Orbit"

Dee is going round the world one seat at a time. Each chapter is a venue Dee has dealt at, with a rival who used to be a regular. **Every chapter can be entered from minute one** (N1: "You are never blocked"). The recommender (`src/core/recommend.ts`) suggests the next chapter from spine position, and choosing a different one is logged as an override, as it is today.

Chapter structure:
1. A **cold open** (scripted, 3–5 lines, can be skipped).
2. **2–4 lessons** from `src/core/lessons/content/`, delivered by Dee and Folio.
3. A **drill block** (PLM, puzzle or contrast set), with Tock.
4. A **table session against the rival**. Its hands are graded by `gradeDecision`, with the rival's profile drawn once from `sessionProfile(name, seed)`.
5. A **boss hand**: a fixed puzzle scenario (`puzzleScenarios.ts` / `puzzleCurriculum.ts`) whose correct line is the rival's exploit. A clean solve counts toward `first-clean-solve` and `clean-solves-5` (`career.ts` milestones).

| Ch | Venue | Spine phase | Lessons (real files) | Boss hand |
|---|---|---|---|---|
| 0 | **The Kitchen Table**. Dee's origin: a button cut from a breadboard. | 0 Rules | `hand-rankings-in-order`, `betting-order-and-position`, `what-the-actions-mean` | none. First graded decision (the first-lesson beat, section 8) |
| 1 | **The Lighthouse** (Wren) | 1 Eyes | `best-five-from-seven`, `board-texture-dimensions`, `who-holds-the-nuts`, `position-sets-your-range` | Wren leads the turn. The answer is to fold a good hand to the lamp. |
| 2 | **The Toll Road Diner** (Barnaby) | 2 Arithmetic | `pot-odds-as-a-price`, `counting-outs-as-a-frequency`, `combos-not-hands` | Thin river value. The trap is checking back, which would be a `value or bluff` miss. |
| 3 | **The Quiet Library** (Percival) | 2 Arithmetic | `alpha-the-bluff-price`, `spr-sets-the-plan`, `small-blind-raise-or-fold` | A river bluff priced by alpha. |
| 4 | **The Night Train** (Vesper) | 1–2 | `facing-a-3bet`, `three-bet-or-flat-the-defence`, `defend-the-big-blind`, `minimum-defence-frequency`, `blind-vs-blind-defence` | A call-down against a triple barrel. |
| 5 | **The Fireworks Pier** (Juniper) | 3 Principles | `equity-realisation`, `domination-and-dead-hands`, `opener-seat-sets-defence-width` | Trap: check-call with the nuts. |
| 6 | **The Observatory** (Ines) | 3 Principles | `range-advantage-versus-nut-advantage`, `polarity-picks-the-size`, `range-role-bettor-or-caller` | Standard line against the baseline. Deviating loses. |
| ∞ | **The Masquerade** (epilogue, replayable) | reads | the `reads.ts` and `anomaly.ts` systems | Six masked seats with jittered profiles. You unmask them by playing. |

**The Masquerade** is the narrative frame for read training, and the feature I most want built. Every seat wears a glass mask. Behaviour is the only clue. At showdown the mask lifts: the existing `visibleArchetypeLabel` reveal plus the rival's showdown line. `reads.ts` gates are characters too. Folio refuses to write a rival's name in ink before `MIN_OBSERVATIONS = 20`. Once the read clears `DEVIATION_THRESHOLD_POINTS`, Folio inks it. When a revert trigger fires (`counter-actions-halved`, `reverted-to-baseline`, `gate-re-closed`), Folio crosses the name out neatly, with a date. Anomaly drills (`TRIGGER_CATEGORIES`: `off-tree-sizing`, `unfamiliar-texture`, `stack-depth-outside-range`, `read-contradicts-frame`) appear as "someone at the ball is not who they seem".

**Depth as geography.** Standing (`standing.ts`, `DEPTHS` 40/75/125/200, ratcheted, never demoted) becomes the deeper rooms of each venue: "the back room at the Diner is a 75bb table". Labels stay `depthLabel()` strings ("75bb table"). The amendment says the reward for depth is a deeper game and a quieter coach. Make that literal: at each certified depth Dee speaks one line less per session, because the cooldown multiplier grows (section 5). The learner hears the mascot step back as they improve. Nobody else does this.

---

## 5. Dialogue system

### Architecture
New pure module **`src/core/cast/`**, with no DOM, clock or RNG, matching the style of `tableTalk.ts`:

```ts
type Speaker = 'dee' | 'folio' | 'tock' | 'muck' | 'mirror' | RivalId;
interface Line {
  id: string;                     // stable, for cooldown history and tests
  speaker: Speaker;
  event: EventKey;                // see the key list below
  when?: Condition;               // predicate over a pure CastContext (severity, principle, action, toCall>0, form, depth, chapter…)
  text: string;                   // template; slots come ONLY from engine fields
  pose: Pose;                     // one of the 8 in section 7
  cooldown: { hands?: number; perSession?: number; lifetime?: number };
  weight?: number;
}
function selectLine(event, ctx, history, variant): Line | null
```

- **Deterministic.** `variant` is a stable index (hand id plus street), as `quipFor` uses, so a replay says the same words.
- **Cooldowns** are counted in hands and sessions, never wall-clock time. When every eligible line is on cooldown, `selectLine` returns `null`, and silence is the fallback. A `depthQuietness` multiplier (1×, 1.5×, 2×, 3× per certified depth) stretches every cooldown.
- **Slot provenance.** Templates may only use slots from `Grade` and `Grade.price` (`{toCall} {pot} {reqPct} {sharePct} {evLossBb}`) or from career, standing or schedule data. This mirrors the guard's number-provenance check (T4): no line can contain a number the engine did not compute.
- **Lint at test time.** A unit test runs every `text` through `bannedPhrasingIn`, `WORD_LIMITS` and the leading-pronoun proxy from `guard.ts`, and checks every rival line against the `tableTalk.ts` invariant (no in-hand archetype flavour). This is the same "assert over every string" pattern progress.ts uses.

### In-hand rule (important)
During a hand, **Dee adds no words to the verdict**. The engine message from `buildMessage` stays the content, inside the ≤60-word, three-chunk budget. Dee is its speaker and changes pose only. Flavour lines go in the **hand-end beat** (after the reveal, a 1.5 s slot under the sheet), at session boundaries, in lessons and in the campaign. This keeps the T4 word budget and the "task as subject" property intact while still giving the verdict a face.

### Event keys (all derived from real signals)
- `grade.{notable|serious}.{pot odds|value or bluff|ranges}.{call|fold|check|bet|raise|allin}`, plus `fold.free`, which is the `toCall === 0` branch. `grade.free` never fires: silence.
- `g4.right-action-wrong-reason`. `applyG4Override` (`reasonGrade.ts`) raises a `free` action whose reason is `hand-strength` or `none` to `G4_SEVERITY = 'serious'`.
- `predict.{match|sure-wrong|guess-wrong|deviated}` (`predict.ts`); `confidence.{sure-wrong|guess-correct}` (routes in `confidence.ts`); `latency.{sure-but-slow|guess-but-fast}`.
- `gate.{open|hit|miss}` (`gateAttemptIsHit`); `lexicon.{accepted|rejected.cached-cell|rejected.no-mechanism-frame|quote}`.
- `plm.{gate-pass|slow|missed-anomaly|false-alarm|exhausted}` (anomaly `ErrorTag`, `EXHAUSTED_MESSAGE`).
- `tilt.proxy`: three consecutive T2+ verdicts with response time under 40% of the personal median (PRODUCT-SPEC edge-case table).
- `form.{settling|sharp|warming up|rusty}` (`currentForm`); `leak.biggest.{principle}` (`career.biggestLeak`).
- `reads.{gate-open|revert.*}`; `showdown.unmask.{archetype}`; `gift.logged` (`giftLedger.ts`).
- `cadence.{return|run}`; `schedule.{due|probe-miss}`; `milestone.{id}` (the ten ids in `computeMilestones`).

### The guarded LLM tutor as optional flavour
`liveTutor.ts` keeps everything it guarantees today. The cast adds one **persona paragraph** to `prompts.ts` (Dee's voice rules, written as writing rules, not facts). Every model output still goes through `guard.ts`. If the guard rejects it, `liveTutor` falls back to the fixed bank silently, as it does now, and the rail still shows `answeredBy` provenance on every turn (tutorRail.ts point 3). The rail label becomes "Dee, from the written notes" or "Dee, via model". The persona never carries numbers. The model can colour the words and nothing else.

---

## 6. How Dee teaches

**By severity** (`Severity` in `coach.ts`):
- `free`: no line and no pose change. Dee stays a working button in its seat. *(Owner decision D3: should even a nod be allowed? I say no.)*
- `notable` (0.5–2 bb): Dee wobbles, the rim goes amber, and the verdict appears on the sheet. A second notable in the same principle within a session gets "Noted." and nothing more.
- `serious` (≥ 2 bb, and G4): Dee leaves its seat and stands on its edge on the sheet with a coral rim. This is the one interrupt.

**By principle**:
- `pot odds`. Dee draws the price meter (`Grade.price.needed` and `.had`). Its frame is "price first".
- `value or bluff`. Covers three branches: a free fold at toCall 0, a check that misses value on a late street when equity is above 0.55, and a lead below 0.35. Dee's frame is "what is this bet for?"
- `ranges`. A raise over a bet below the price. The frame is "what does the bettor hold here?"

**By leak**: `career.biggestLeak` (the principle with the largest summed cost) chooses the chapter Dee recommends. It also gets one Home line per session, framed as a direction to practise, never as a description of the person.

**By tilt proxy**: Dee lies flat next to the hole cards ("sitting out" pose). It offers to end the block, and in-hand interrupts are suppressed for the rest of the block, as the spec requires. It is labelled a proxy in the UI, never "tilt".

**By cadence (the Duolingo part, done honestly)**: `PracticeCadence` already gives `last30` and `currentRun`, and its header says a run "is shown as information, never as something you lose."
- **The Lamp**: Dee carries a small lamp of light from the venue lighthouse. Each lit day adds a dot to a 30-dot glass strip (`last30`). On days with no activity the dot is not dark. It shows **"rested"**, a hollow ring, whenever `schedule.ts` had nothing due that day. That means spacing gaps look like part of the plan, because in this method they are.
- **The run never breaks visually.** After a gap Dee leads with what is due (`dueNow`), not with what was lost.
- **Owner decision D1:** PRODUCT-SPEC line 546 still lists "streak" as banned on coach and progress surfaces, while `progress.ts` removed it from the lint list on 2026-08-14. The two documents disagree. My recommendation: call it "lit days" and "run" on the Career and Home surfaces only, and never let the word "streak" appear in a coach line.

**Cosmetics (earned only from data, never bought)**
There is no shop and no currency. Every cosmetic is a **receipt** for a milestone, labelled with the fact.
- **Rim inlays**: one engraved glyph on Dee's rim for each mastered concept (`masteredKcCount`; schedule gate `mastered`). Twelve inlays fill the rim, which matches the `concepts-12` milestone.
- **Your sentence as engraving**: an accepted lexicon sentence can be micro-engraved round Dee's rim. Your own words become the cosmetic. Folio refuses to engrave a `cached-cell` sentence.
- **Card-back hatch variants** (30°, 60°, crosshatch, a fine pinstripe) unlock with clean puzzle solves (`clean-solves-5`). They are still diagonal hatches, so the signature from DESIGN-NOTES survives.
- **Felt themes per certified depth** (`depth-40` … `depth-200`): one `html[data-theme]` block each, **paint only** (the `theme.spec` rule). Lighthouse slate, Diner oxblood, Library walnut, Night Train indigo, Observatory black.
- **Rim finishes** for assessments taken: brushed graphite, bone enamel, smoked glass.
- **Rival keepsakes** after a clean boss hand: Wren's lamp wick, Barnaby's toll ticket, Percival's bookmark, Vesper's punched ticket, Juniper's spent fuse, Ines's tuning fork. They sit on a shelf on the Career screen. Each one shows the boss hand it came from and opens it in replay.
- **Never** cosmetics for chips, rebuys, hands played or login count. Owner decision D2 is needed, because PRODUCT-SPEC 542/546 currently lists cosmetics as out of scope.

---

## 7. Expressions and poses (for the SVG mocks)

One SVG rig: a disc, the engraved D, the counter aperture, and a rim stroke. Every pose changes only the transform, the aperture path and the rim colour.

1. **Seated (idle)**. Lies flat in its seat at a 3/4 view. Wide soft aperture. Neutral rim. The default, shown for every `free` grade.
2. **Listening (gate open)**. Tilts 20° toward the input. The aperture becomes a tall oval. The rim runs an amber arc that drains in step with Tock.
3. **Wobble (notable)**. Rocks once, at about 12°. The aperture is a raised-brow arc. Amber rim.
4. **On edge (serious)**. Stands upright with the D facing the learner. The aperture is a flat bar. Coral rim. It casts a sharp contact shadow on the sheet.
5. **Rolling (interrogating or thinking)**. Rolls slowly on its edge with motion blur on the rim. The aperture is a "?"-like hook. Used for the Interrogator hat's single ≤20-word question.
6. **Quoting**. Folio leans against it. The aperture becomes two small marks shaped like quotation marks. Used for `lexicon.quote` and `feedbackOpening`.
7. **Sitting out (tilt proxy, rest)**. Lies flat **off** the felt beside the cards with a dimmed engraving and a tiny lamp beside it. Calm, not sad.
8. **Engraving (mastery)**. Lifted and turned to show its rim. A new inlay glows with one mint shimmer and fades to bone.

Plus one per rival: a masked glass silhouette (pre-reveal) and an unmasked bust (post-showdown).

---

## 8. Emotional beats

- **First lesson (Ch 0).** Dee is in the seat when the app opens. The first time the learner hovers it, it rolls over: "I'm the button. I move one seat left every hand. Watch where I sit." The first graded decision is very likely to be free, so Dee says nothing. Then: "That one cost nothing. When something costs nothing, I keep quiet." The learner is taught the silence rule in the first minute.
- **First serious mistake.** Dee stands on edge for the first time. After the reveal, at the hand-end beat: "First time standing up. It'll happen less." There is no comfort-praise and no blame. Folio opens to an empty page: "Write the reason down. Your words go here, not mine."
- **Comeback.** When `form` moves from `rusty` to `sharp`, Dee mentions it once at the session's end, with the window size: "Last fifteen decisions: the price held." This is a fact about decisions, not about the person.
- **Run ends.** Dee does not mourn. It turns the lamp down to a rested ring and, on return, leads with `dueNow`: "Four concepts are due. The gap helped the spacing."
- **Mastery.** The Engraving pose, then Folio reads the learner's own accepted sentence aloud. The lead character steps aside so the learner's words get the last line.
- **The final boss.** The test is restraint, so the ending is quiet. Ines plays standard and you play standard. Dee: "Nothing to say. That's the whole lesson." Credits roll over the 30-dot lamp strip.

---

## 9. Sample lines (46), keyed to real events

All lines are checked by hand against `BANNED_PHRASINGS` and guard check 4: no leading "You", no "you are" or "you're", no praise words, no banned archetype words. "Slot" means the number is filled from engine fields only. In-hand lines are pose captions shown next to the engine message. "Hand-end" lines appear after the reveal.

**`grade.serious` / `pot odds`**
1. `grade.serious.pot odds.call`, hand-end: "Price first. The pot asked {reqPct}%; the hand brought {sharePct}%." *(slots)*
2. `grade.serious.pot odds.call`: "That call paid more than the hand was worth."
3. `grade.serious.pot odds.fold` (`toCall>0`): "The price was low enough. The hand was already paying."
4. `grade.serious.pot odds.fold`, second time this session: "Same seat, same price, same fold. Let's drill it."

**`grade.notable` / `pot odds`**
5. `grade.notable.pot odds.call`: "Close. Slightly over the price."
6. `grade.notable.pot odds.call`, repeat within cooldown: "Noted."
7. `grade.notable.pot odds.fold`: "A little under-priced fold. Worth a look on replay."

**`value or bluff`**
8. `fold.free` (`toCall===0`, notable or serious): "Checking was free. Folding gave the pot away."
9. `fold.free`, the Muck: "I don't take free cards. Hand that one back."
10. `grade.notable.value or bluff.check` (late street): "That hand wanted a bet. Who pays you off?"
11. `grade.serious.value or bluff.check` (river): "Plenty of value there, and the river went by quietly."
12. `grade.notable.value or bluff.bet` (lead with low pot share): "What is this bet for? Value, or a bluff with a story?"
13. `grade.serious.value or bluff.bet`: "A weak hand bet like a bluff, without the range behind it."

**`ranges`**
14. `grade.notable.ranges.raise`: "Before raising: what does the bettor hold here?"
15. `grade.serious.ranges.raise`: "That raise needed {reqPct}% just to continue." *(slot)*
16. `grade.serious.ranges.allin`: "The whole stack, below the price. Let's look at the range."

**G4 and the reason grader**
17. `g4.right-action-wrong-reason` (reason `hand-strength`): "Right move. The reason given was the hand, not the price."
18. `g4.right-action-wrong-reason` (reason `none`): "The action was fine. The reason was missing, which matters more."
19. `gate.open`, Tock: "Before the reveal, one line: why?"
20. `gate.miss`: "Say it as a mechanism, not a conclusion."
21. `gate.hit`: "That's a reason. Reveal."

**Lexicon (Folio)**
22. `lexicon.rejected.cached-cell`: "That's a memorised answer. Tell me why it's true."
23. `lexicon.rejected.no-mechanism-frame`: "Name the mechanism: domination, realisation, or range asymmetry."
24. `lexicon.accepted`: "Inked. That sentence is permanent now."
25. `lexicon.quote` (before feedback on that concept): "Quoting the notebook first: “{sentence}”." *(slot is the accepted sentence)*

**Prediction and calibration (Mirror)**
26. `predict.sure-wrong`: "Marked sure, came out different. Those get priority."
27. `predict.guess-wrong`: "A guess that missed. That's what guesses are for."
28. `latency.sure-but-slow`: "Said sure, took a while. Which was it?"
29. `predict.match`, session summary only: "Sure calls this session: {sureCorrect} of {sureTotal} held." *(slots)*

**Fluency drills (Tock)**
30. `plm.slow`: "Correct, but slow. Again, faster."
31. `plm.missed-anomaly`: "Something was off there. Look again."
32. `plm.false-alarm`: "Nothing was off. Ordinary is allowed."
33. `plm.gate-pass`: "Fluent. That one's automatic now."

**Tilt proxy, form, leak**
34. `tilt.proxy`: "Three quick ones in a row. Want to stop the block here?"
35. `tilt.proxy`, after accepting: "Logged for review. No interruptions for the rest of this block."
36. `form.rusty`, session start: "Recent decisions ran expensive. Starting slow."
37. `form.sharp`, session end: "Last fifteen decisions: the price held."
38. `leak.biggest.pot odds` (Home): "Most of the cost lives in calls. Diner's open."
39. `leak.biggest.value or bluff` (Home): "Most of the cost is in free folds and missed bets. Toll Road?"

**Reads and the Masquerade**
40. `reads.gate-open`, Folio: "Twenty hands watched. Now I'll write the name in pencil."
41. `reads.revert.gate-re-closed`: "That seat changed. Crossing it out."
42. `reads.revert.reverted-to-baseline`: "Back to standard against this seat. The read went quiet."
43. `showdown.unmask.nit`, Wren: "Lamp's only lit when the ship is real."
44. `gift.logged`, Folio: "Entered in the ledger. Their call, their price." *(the `describeGift` text follows)*

**Cadence, schedule, milestones**
45. `cadence.return` (gap ≥ 7 days, items due): "Back after an orbit. Three concepts are due; the gap helped."
46. `schedule.probe-miss`: "That one faded. Back on the schedule."
47. `milestone.first-clean-solve`: "First clean solve. The Kitchen Table gets an inlay."
48. `milestone.depth-75`: "The 75bb table. Deeper stacks, and I talk less from here."
49. `milestone.concepts-12`: "Twelve inlays. The rim's full."

---

## 10. Build plan and file references

| Piece | Builds on | New or changed |
|---|---|---|
| Cast line banks and `selectLine` | `tableTalk.ts` pattern | new `src/core/cast/{lines,select,context}.ts` |
| String lint over every line | `bannedPhrasingIn` (progress.ts), `guard.ts` checks | new `tests/unit/cast-lint.test.ts` |
| Dee replaces the dealer badge | `.dealer-badge` / `.dealer-button` (styles.css), the table screen | `components/dee.ts` (SVG rig, poses as `data-pose`), styles in `styles-glass.css` |
| Verdict speaker and poses | `coachPanel.ts` `data-severity` | add `data-pose` and the hand-end beat slot; no change to message text |
| Rival showdown banks | `SHOWDOWN_LINES`, `visibleArchetypeLabel` | widen `SHOWDOWN_LINES` to a bank per rival; masks in the seat render |
| Campaign | `lessons/content`, `puzzleCurriculum.ts`, `recommend.ts`, `sessionPlan.ts` | new `src/core/campaign.ts` (chapters as inert data); `screens/orbit.ts` |
| Lamp and cosmetics | `career.ts` cadence and milestones, `schedule.ts` `dueNow` | a "rested" flag derived from the schedule; `cosmetics.ts` mapping milestone id to unlock |
| Tilt proxy | PRODUCT-SPEC edge-case row (not yet implemented; no `tilt` sensor exists in `src/`) | new pure detector in `src/core/` |
| LLM flavour | `prompts.ts`, `liveTutor.ts`, `guard.ts` | a persona paragraph only; guard unchanged |
| e2e pins to keep | AGENTS.md pins (mint #3DDC97, to-act ring, 900x640 fit) | Dee is never mint except the engraving shimmer, and the sheet must still fit 900x640 |

---

## 11. Decisions for the owner

- **D1. "Streak" vocabulary.** PRODUCT-SPEC 542/546 still bans streaks and the word "streak", but `progress.ts` lifted it on 2026-08-14. Pick one source of truth. My recommendation: "lit days" and "run" on Career and Home only, gaps shown as "rested", never on coach surfaces.
- **D2. Cosmetics are currently out of scope** (PRODUCT-SPEC 542; the amendment says "never … cosmetics"). Approve mastery-receipt cosmetics with no currency and no shop, or drop them.
- **D3. Does Dee react to `free` decisions at all?** My recommendation: no, not even a nod. Silence is the reward.
- **D4. In-hand words.** Dee adds no words in-hand and is the speaker of `buildMessage`, with flavour only at the hand-end beat (my recommendation). The alternative is a ≤12-word caption counted inside the 60-word budget.
- **D5. Named rivals at read tables.** The Masquerade (masked until showdown, my recommendation) or named rivals only in campaign chapters, where the exploit is the stated lesson.
- **D6. Quieter coach as depth rises.** Approve the cooldown multiplier tied to certified depth.
- **D7. Ines, the balanced regular, as final boss.** Is a final chapter that ends with "nothing to say" too quiet for the owner's taste? I think it's the right ending.
- **D8. The supporting cast's size.** Five speakers (Dee, Folio, Tock, the Muck, Mirror) may be one or two too many. Mirror and the Muck could be folded into Dee if the voice budget is tight.
