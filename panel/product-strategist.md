# Product strategist: The Back Room

**Lens.** What a complete poker-learning product looks like, who it is for, which loops keep people coming back, and how it beats the existing tools. The owner asked for a Duolingo-style character, streaks and cosmetics, "wacky and ambitious". My answer is ambitious on the shell (a cast, a place, seasons, a collectible deck) and conservative on the core (the grader, the silence rule, the ban on praise and on trait claims, the hidden pot). The only thing Offsuit has that no competitor has is an honest teaching engine. The character has to be built out of that engine; it cannot sit on top of it.

**Working name for the experience: The Back Room.** Offsuit stays the app. The Back Room is the place inside it: a small card room after hours, run by **Pip**, a dealer who teaches. (The name comes from the suit pip under the rank, which is the app's signature card element; see `research/DESIGN-NOTES.md`.) A recurring cast of regulars sits at the tables. You come back on the nights the schedule says you are owed a game, and over a season you earn the right to sit deeper.

Speculation is labelled where it appears. This document contains no market-size, retention or conversion figures, because none exist in the repo and I had no network access. Competitor descriptions come from general product knowledge and were not checked in this session.

---

## 1. The app today: strengths and gaps

### Strengths (these are the moat)

- **A real teaching method, written down and enforced in code.** `research/TEACHING-METHOD.md` (910 lines) and `PRODUCT-SPEC.md` set out a method. Feedback is graded by cost. Silence means a decision cost nothing. The learner commits before the reveal. Corrections are three chunks and no more than 60 words. Spacing gaps are flat, the queue is interleaved from confusion sets, and the learner names concepts in their own words. All of this is enforced structurally, not by convention:
  - `src/core/schedule.ts` exports `assertFlatGaps`.
  - `src/core/recommend.ts` returns a single `Suggestion` rather than a list, so the Home screen cannot become a queue.
  - `src/core/lexicon.ts` and `src/core/giftLedger.ts` are append-only by construction.
- **A guarded tutor that works offline.** `src/main/tutor/` has a null tutor (`nullTutor.ts`, which cannot open a socket), a mute matrix (`muteMatrix.ts`), a phase-gated tool agent (`agent.ts`), and an output guard (`guard.ts`) that checks word count, praise, fold-reveal and number provenance. This is exactly the plumbing a talking character needs, and most apps with a mascot do not have it.
- **Opponents with known ground truth.** There are six archetypes with session jitter and labels hidden until showdown (`src/core/archetypes.ts`, `jitter.ts`). Because the true frequencies are known, a read can be graded (`reads.ts`, `screens/dossier.ts`). A human-data tracker cannot do this.
- **Honest progress primitives already exist.**
  - `src/core/standing.ts` holds "Depth" (40/75/125/200bb tables). It is earned from EV loss only and ratchets, so a bust cannot demote you. It has a separate `currentForm` with the values settling, sharp, warming up and rusty.
  - `src/core/career.ts` already computes `PracticeCadence` (`distinctDays`, `last30` dot grid, `currentRun`) and an effort/mastery milestone ladder, with the explicit rule that "a gap is not punished (spacing means gaps are correct)".
- **The gamification vocabulary is no longer banned.** On 2026-08-14 "streak", "XP" and "badge" were allowed (`src/core/progress.ts` around line 442; `src/main/tutor/guard.ts` around line 78). What stays banned is trait claims and praise (`BANNED_PHRASINGS`: "you are", "too loose", "great job", "well done"). That split is the design brief for a character.
- **Personality hooks already exist.** `src/core/tableTalk.ts` gives villains banter that carries no information during a hand, and personality lines only after showdown reveals the archetype. `src/main/speech.ts` already speaks verdicts through the local `say` binary.
- **A broad surface.** There are 24 validated lessons (`src/core/lessons/content/`), 67 puzzle scenarios grouped into 10 modules (`src/core/puzzleCurriculum.ts`), contrast sets, anomaly, robustness, spacing, assessment, a range editor, charts, an equity calculator, LAN multiplayer (`src/core/multiplayer.ts`, `src/main/relayHost.ts`), and a polished glass design system (`demo/glass/tokens.css`, `src/renderer/styles-glass.css`).

### Gaps (what stops it being a product people return to)

1. **Nothing pulls you back tomorrow.** Cadence is computed but shown only on a Career sub-view under Profile (`screens/career.ts`). No surface says "you are owed four probes today", even though `schedule.ts` knows exactly that.
2. **No identity, no place.** The villains are 'Ada', 'Bo' and 'Cy' with a single initial as the avatar (`screens/table.ts:89`, `:345`). The coach is a sheet with no presence. The app reads as a very good instrument panel.
3. **Eleven tabs and a hub of drills** (`src/renderer/main.ts` around lines 185–215). It is complete, but a beginner faces a cockpit. The recommender helps, but it is one line on Home.
4. **The grader is heuristic, not a solver.** `coach.ts` grades with three principles ('pot odds', 'ranges', 'value or bluff') against a modelled range. `types.ts` in lessons says phases 4+ are not modelled "because no spot bank exists yet". `research/EXPERIMENT-1-adherence.md` says plainly that solver adherence is untested. Any ambition about seasons or depth inherits this ceiling.
5. **Content volume is thin for a daily habit.** 24 lessons and 67 scenarios are enough for weeks, not for a year of daily returns. Contrast sets cover only some axes (`contrast.ts`, "HONEST AXIS COVERAGE").
6. **The spec itself still lists "XP, streaks, cosmetics, a shop" as out of scope** (`PRODUCT-SPEC.md`, "Out of scope"). Only the vocabulary ban was lifted, by an amendment in code comments. Before building any of this, the spec needs a v2.2 amendment in the same style as the v2.1 STANDING amendment.
7. **Desktop only, no network, no notifications.** Daily-habit apps usually live on phones (general observation, not measured). Offsuit lives in an Electron window the learner has to remember to open.

---

## 2. Target users and jobs to be done

I am naming segments by situation, not demographics. These are hypotheses to test; I have no user research.

| # | Segment | Situation | Job to be done | Fit today | Priority |
|---|---|---|---|---|---|
| A | **The home-game newcomer** | Invited to a friends' game. Knows hand rankings roughly, is embarrassed by not knowing what to do. | "Help me not be the person everyone waits on, and stop losing my stack in dumb ways, within a few weeks." | Strong. Phases 0–2, lessons, puzzles, rules-only tutor, LAN tables. | **Primary** |
| B | **The plateaued recreational player** | Plays low-stakes live or online. Has seen charts and videos. Results swing and they cannot tell why. | "Tell me which one or two leaks actually cost me money, and fix them without making me memorise grids." | Strong. Reach-weighted leak ranking (`rw.ts`), contrast sets, assessment, Depth. | **Primary** |
| C | **The poker-curious watcher** | Watches streams and tournaments, never plays seriously. Wants the game to make sense. | "Make poker legible, a little every day, without risking money." | Medium. Needs the daily loop and the character most. | Secondary (it is the Duolingo audience) |
| D | **The home-game host / friend group** | Runs a weekly game and wants friends to improve together. | "Give my group a shared thing to do between games and a fair way to review hands." | Partial. The LAN relay exists; there is no shared review. | Secondary, cheap to serve |
| E | **The studying grinder** | Already uses a solver library. Wants node-level precision. | "Drill my exact solver strategies." | **Poor, and should stay so.** There is no spot bank, and the method deliberately purifies frequencies. | **Not targeted.** Saying so is a strength. |

**Jobs the product must do for A and B, in order:**
1. Give me one thing to do now (`recommend.ts`, exists).
2. Tell me honestly whether I am getting better, despite the swings (assessment, RW, Depth, exists).
3. Make showing up easy and worth it (missing).
4. Make it mine (missing: identity, cosmetics, the lexicon as an artifact).
5. Let me take it to my real game (partly there: LAN tables; missing: table-ready "cheat sheet" export from your own lexicon).

---

## 3. Core loops

Every loop below is built on a mechanism that already exists, so the loops are the method in costume.

### Daily: "The Ticket" (5–12 minutes)

You open the app and Pip is shuffling. The Ticket is what the scheduler says you owe today, and nothing more:
- the decay probes that are due (`schedule.ts` waves at day 1–2/7/21/30–45, `PROBE_COUNT` = 4 in `sessionPlan.ts`);
- one perception (PLM) block (`anomaly.ts`, `boardReading.ts`);
- three to five graded spots drawn from your top reach-weighted leak (`rw.ts`, `recommend.ts`).

When nothing is due, the Ticket says so and offers a free hand or a puzzle. **A day with nothing owed is a rest day, not a broken streak.**

*Spec tension:* S2a forbids a 15-minute session and S3 says probes never fire in free-roam. The Ticket is therefore either free-roam with a probe exception or a new spec object. This is owner decision 3 in §7.

### Session: "A Night at the Back Room" (30 or 50 minutes)

This is the existing `sessionPlan.ts` assembly (warm-up, probes, graded spots, contrast remediation, whole-task hands, scoreboard), staged as an evening. You sit with three regulars and Pip deals. Before the hands you pre-register at most two reads (R2, `reads.ts`). The night ends with the scoreboard and Pip's one-line "what tonight was about", from the session's top error tag (`progress.ts tagAggregates`). Outcomes stay hidden at the table (O6).

### Weekly: "The Thursday Game" and "The Regulars' File"

- **Thursday Game** is the P4 weekly assessment (`assessmentBlock.ts`, `screens/assessment.ts`): 30 hands, no coach, Pip deals in silence. It is pre-framed as harder than practice. Results are RW bb/100 and the Depth check. This is the only weekly number that counts, and the ritual makes it feel like an event rather than a test.
- **The Regulars' File** is the weekly dossier recap (`screens/dossier.ts`, `giftLedger.ts`): what you observed about each regular, the sample size beside every count, gifts received, reads that were right or wrong against the true jittered frequencies (O4).

### Seasonal (about 6–8 weeks, speculative length): "Seasons"

A Season is a themed arc over one knowledge-component family that maps onto the puzzle modules in `puzzleCurriculum.ts`. Examples: "Season of the River" (value, bluffs, big folds), "Season of the Blinds", "Season of Depth" (SPR, stack depth). A season has:
- a story beat with one regular (see F2);
- a cosmetic set that is earned, never bought;
- a **finale**: the delayed, unannounced novel-instance test (gate C, P5), staged as a "high-stakes night" whose stakes are only cosmetic. Passing certifies that season's concepts in your Rulebook (F5).

Seasons order content. They never lock it (N1): every season's spots stay reachable at any time, as every tab is today.

### Lifetime: Depth

The ratcheting table depth (`standing.ts`, `DEPTHS` 40/75/125/200) is the long arc. Earning a deeper table literally moves you to a deeper room in the Back Room, with new tablecloth and new regulars. It is the honest version of Duolingo's leagues: you climb against the game, not against people.

---

## 4. Feature list

Each entry gives what it is, why it is there, and what it builds on. ★ marks the features I would ship first.

### F1 ★ Pip, the dealer-coach

**What.** A persistent character: a dealer behind the table and in the rail. Pip has a look (illustrated or drawn as DOM shapes; it must not be canvas, per V3), a small set of animated states, a voice (local `say` plus authored lines), and a dry, observant personality. **Pip's personality is in what Pip notices about the hand, never in judging you.** Pip never says "great job" and never says "you're tight". Pip says "That river bet priced a call at a third of the pot. Ask what it beats." The "task as subject" rule becomes Pip's character trait: a dealer comments on the cards.

**Pip's states map one-to-one onto the method's states, so the character makes the method visible:**

| Method state | Pip | Source |
|---|---|---|
| Silence (decision cost about 0, T0/free) | keeps dealing, a small nod-free shuffle | `coach.ts` severity `free` |
| Notable (T2) | leans in after the hand, one question | Interrogator hat, `prompts.ts` |
| Serious (T3/T4) | **stops the deal**: hand flat on the felt, card held | interrupt rule, `coachPanel.ts` |
| PLM drill | **steps away from the table** (the mute matrix shown literally) | `muteMatrix.ts` `plm-drill` |
| Pre-commit strategy question | taps the "after you act" sign | T3a, `requests.ts` |
| Hint asked | slides a chip across: "costs a rung" | `fading.ts` hint debt and `RESTORE_STREAK` |
| Lexicon quote | reads your sentence back off a card | `lexicon.ts feedbackOpening` |
| Declined recommendation 5 times | asks once what you would rather do | `recommend.ts shouldAskPreference` (Negotiator) |

**Why.** The owner wants a teaching character. The defensible version is one where every expression is caused by the engine. Pip cannot "react" to anything the grader did not compute, so the character cannot invent feedback.

**Builds on.** `src/main/tutor/nullTutor.ts` (Pip's default voice is the fixed string table, so Pip works with no key and no network), `guard.ts` (every Pip line, authored or generated, passes the same guard), `muteMatrix.ts`, `agent.ts` (an optional Bedrock-voiced Pip), `src/main/speech.ts`, `src/renderer/components/tutorRail.ts`, `coachPanel.ts`, `predictPanel.ts`.

**Speculation.** Whether a deliberately non-praising mascot feels warm enough to motivate is the central bet of this document and is untested. The counter-argument: a dealer is the one person at a card room who is professionally neutral, so the fiction fits the constraint.

### F2 ★ The Regulars: a cast whose mood is the lesson

**What.** Replace Ada/Bo/Cy with 8–10 named regulars, each with a stable face, voice, seat habits and post-showdown banter. **The twist that makes it teach:** a regular's *archetype is redrawn per session*. Bo is a person; "which Bo showed up tonight" is the classification problem. At showdown the label is revealed ("Bo was playing the station tonight"), and `tableTalk.ts` showdown lines fire in character.

**Why.**
- Characters create attachment, and story beats per season need characters.
- Fixing character to archetype would leak the label that O3 hides, which turns reading into memorising faces. Redrawing per session preserves O3 and makes the character *more* interesting: the regulars have moods, and moods have tells you learn to read.
- The Regulars' File (the dossier) becomes a file per person, with your observation history across sessions. Reads still expire at session end (R4); the history is evidence, not a live read.

**Builds on.** `src/core/archetypes.ts` (`sessionProfile(name, seed)`), `jitter.ts`, `tableTalk.ts` (`quipFor` with `revealed`), `reads.ts`, `giftLedger.ts`, `screens/dossier.ts`, `seatPositions.ts`, `table.ts` `avatar` field.

**Wacky extension (speculation).** Each regular has a per-season arc told through post-session vignettes. For example, Cy is trying to stop over-bluffing rivers, and you can watch Cy's river bluff frequency (a jitter parameter) actually drift across the season. This is the exploit-twin curriculum (Layer 4) as soap opera.

### F3 ★ "Kept": a streak that agrees with spacing

**What.** The streak counts **appointments kept**, not calendar days. A day is "owed" when the scheduler has reps due. A day is "kept" when you did them. Days with nothing owed are rest days and are shown as rest, not as gaps. A secondary, purely informational "days at the table" count shows the existing `currentRun`. Late is acceptable: a probe done within the wave window (for example the 30–45-day wave) still keeps the appointment.

**Why.** A calendar streak rewards opening the app daily. The method says spacing gaps are *correct*, and `career.ts` already refuses to punish a gap. Duolingo's streak works partly by loss aversion (general knowledge). An appointments streak keeps the "don't break the chain" pull, but the chain is made of retention events the method values. You cannot keep it by grinding, and missing a rest day costs nothing.

**Builds on.** `src/core/schedule.ts` (`WAVES`, due computation), `career.ts computeCadence` (the `last30` dot grid becomes the Kept calendar: kept, missed and rest states), `sessionPlan.ts` probes, `src/main/store.ts` persistence.

**Design rules to write into the spec.**
- A missed appointment does not reset the count to zero. It shows "1 missed", and the next kept appointment resumes the count. Pip's line is a fact ("Two probes waited three extra days"), never guilt.
- There is no "streak freeze" purchase. The scheduler's wave windows already provide slack.
- Kept never appears on the teaching surfaces (Progress, coach), mirroring how Standing was scoped to Play/Profile.

### F4 ★ The Ticket: the daily entry point

**What.** Home opens on Pip holding today's ticket: "4 probes owed · 1 Sight block · 3 spots on facing big river bets". One button. A finished ticket is torn and filed. It sits beside the existing single recommendation, not on top of it.

**Why.** The habit loop needs a five-minute unit. Today's minimum honest unit is a 30-minute session, or free-roam with no due work.

**Builds on.** `recommend.ts` (`SOURCES` already ranks spacing-debt first), `sessionPlan.ts`, `screens/home.ts`, `components/recommendation.ts`, `schedule.ts`. Needs a spec amendment for probes outside a session (§7).

### F5 ★ The Rulebook: your lexicon as a collectible deck

**What.** Every accepted lexicon sentence becomes a **card in your deck**:
- the concept name on the face, **your own sentence** as the rule text, the date you wrote it, and its history;
- the card's finish shows retention state from the decay posterior: crisp when fresh, **tarnished** when a probe is due, re-polished when you pass it;
- passing a season finale stamps the card "certified";
- the deck exports as a printable one-page "table card" in your own words, the method's "one-page table card" (`TEACHING-METHOD.md` around line 769), generated locally.

**Why.** It is the honest version of collectibles. You cannot collect a card without writing a mechanism sentence that passes acceptance (L2). You cannot keep it shiny without retrieval. The deck is literally your knowledge. It also creates the "make it mine" artifact for segment A to take to the Friday game.

**Builds on.** `src/core/lexicon.ts` (append-only `record`, `quoteFor`), `src/core/schedule.ts` (`posterior` with `DECAY_HALF_LIFE_DAYS`), `fading.ts`, `reasonGrade.ts`, `contrast.ts` (where sentences are born), `screens/contrast.ts`, `components/card.ts` (the card component exists).

### F6 Cosmetics: earned, table-only, never purchasable

**What.**
- Card backs (variations on the hatch back), felt and tablecloth paints, Pip outfits, seat frames, a regular's "signature" showdown banter pack, room ambience (room tone, deal sounds through `sound.ts`).
- **Earned only** from: Depth certifications (`standing.ts`), the milestone ladder (`career.ts computeMilestones`), clean puzzle solves (`puzzleCoverage`), season finales, Kept appointments, and accepted lexicon entries.
- **Never earned from chips, pots, wins or volume of hands.** That would reinstall the outcome signal the whole method deletes.

**Hard constraints from the existing system.**
- V4: the drill surface is visually fixed, so cosmetics never touch PLM drills.
- Card *faces* never change, because perception training is on the face.
- Themes are paint-only (`theme.spec`, AGENTS.md).
- The e2e pins stay: `--positive` #3DDC97 and `--text-hi`.
- Every cosmetic must fit 900x640.

**Why.** Cosmetics give the long tail a reason without corrupting the signal. Tying them to mastery gates makes them a readable record ("that green felt means 75bb certified").

**Builds on.** `src/renderer/styles-glass.css` theme blocks (`html[data-theme]`; graphite and obsidian already exist, `screens/settings.ts`), `demo/glass/table-variants.css` (felt variants already explored), `career.ts` milestones, `session.ts` (a new `cosmetics` field with migration defaults).

**No shop.** There is no network and real money is out of scope. "Shop" is a closet, not a store.

### F7 Depth as rooms

**What.** The 40/75/125/200bb tables become rooms in the Back Room: the front table, the back table, the private room, the high room. Each room has its own paint and regulars, and certification is a short ceremony with Pip. Current form (sharp, warming up, rusty) appears as Pip's read of your night, stated about decisions ("the last fifteen contested decisions averaged…"), never about you.

**Builds on.** `standing.ts` (`depthLabel`, `depthToStack`, ratchet `depthFloor` in `session.ts`), `screens/home.ts` standing prop, `screens/career.ts`.

**Caveat.** Depth is only as good as `coach.gradeDecision` (stated in `standing.ts`'s header). Making it more prominent raises the cost of grader errors (§6).

### F8 The Map: a Duolingo path that never locks

**What.** One scrolling map of the spine's phases (Rules, Eyes, Arithmetic, Principles, Nodes, Reads, Maintenance), with lessons, puzzle modules and drills placed on it. Pip's token sits on the recommended stop. **Every stop is open** (N1). Mastery shows as the finish of the stop: posterior bars from `schedule.ts`, gate status `learning`, `mastered` or `frozen`.

**Why.** It replaces eleven tabs as the beginner's entry. Duolingo's path is its clearest affordance (general knowledge). The lock is the part to drop, and the spec already argues why (N1, N2).

**Builds on.** `src/core/lessons/index.ts` (prerequisites are advisory only), `puzzleCurriculum.ts`, `recommend.ts`, `progress.ts kcBars`, `screens/train.ts` (the practice hub), the main.ts tab registry. The Map can *become* the Learn and Train tabs, which relieves the 13-tab budget noted in `main.ts`.

### F9 Home Game Night: LAN multiplayer with Pip dealing

**What.**
- Friends join over the existing LAN relay and Pip deals.
- After the game, a **shared review**: each player's own decisions graded privately, plus an opt-in "hand of the night" chosen by RW, not by pot size (the "What we delete" table bans selecting hands by big losses).
- Optional household board of **appointments Kept**: effort, never results.

**Builds on.** `src/core/multiplayer.ts` (`viewFor` redaction), `relayHost.ts`, `relaySession.ts`, `screens/multiplayer.ts`, `screens/review.ts`, `coach.ts`.

**Open.** Whether a results leaderboard exists at all is owner decision 7.

### F10 The Negotiation: "teach me 3-betting"

**What.** Pip as Negotiator (T3): you ask for any topic, and Pip shows what is missing on the Map and offers the real next step. Overrides are logged (N4). In the null tutor this is a deterministic lookup over `lessons` prerequisites and KC state.

**Builds on.** `recommend.ts` (`decline`, `prefer`), `lessons/index.ts`, `tutor/requests.ts`, `muteMatrix.ts`.

### F11 Gifts from the regulars

**What.** The gift ledger in character: "Bo paid 100 into your aces with queens on a king-high board". Entries come from observed showdowns in action-with-holding form. The weekly file lists gifts per regular.

**Builds on.** `src/core/giftLedger.ts`, `giftObserve.ts`, `screens/dossier.ts`.

**Note.** A gift is information, not reward. It earns no cosmetics, because it is chip-adjacent.

### F12 The Variance Room

**What.** A Pip-hosted explainer that runs automatically when you take a big downswing at the table: the `screens/variance.ts` content plus your own grades for those hands. It turns tilt into arithmetic.

**Builds on.** `screens/variance.ts`, `arithmetic.ts` (risk of ruin), `progress.ts` (`RESULTS_GRAPH_MIN_HANDS`).

### F13 Spoken Pip and quiet mode

**What.** Pip's voice through local `say`, off by default as today. One "room tone" toggle. A fully silent Pip remains first-class.

**Builds on.** `src/main/speech.ts`, `src/renderer/sound.ts`, `session.ts` (`spokenVerdicts`, `soundCues`).

### F14 Content engine for daily volume (the unglamorous prerequisite)

**What.**
- **Authoring:** grow lessons past 24 using the AUTHORING.md two-file pattern, and puzzle scenarios past 67.
- **Generation:** generated observation streams (R6) and generated contrast sets.
- **The big one:** a solver-built spot bank (B0–B7 in the spec, never built), which unlocks phase-4 nodes and real ΔEV grading.

**Why.** A daily product needs novel instances every day, and the method forbids reused illustrative stimuli. Without a bank, Seasons beyond the first few repeat themselves.

**Builds on.** `src/core/lessons/validate.ts`, `puzzleScenarios.ts`, `contrastManifest.ts`, `chartBank.ts`, `bank.ts`.

---

## 5. Differentiation

The claim that survives a skeptic is not "Duolingo for poker". Several apps can put a mascot on flashcards. The claim is: **the only poker trainer whose coach can stay quiet, and whose rewards cannot be bought with luck.**

| Product (general description, not checked this session) | What it is best at | Where Offsuit and the Back Room differ |
|---|---|---|
| **GTO Wizard** (solver library plus trainer) | Precise solutions and drilling for serious players | Starts at zero. Purified rules in the learner's own words. Grades the *reason* separately from the action. Silence rule. Fully offline. Does not try to beat it on node precision (it targets segment E, we do not). |
| **PokerSnowie** (AI-based play evaluation) | Scoring play against a strong engine | Feedback is cost-graded corrections plus the commit-before-reveal protocol, not an error-rate score. Opponents are human-like archetypes with readable tendencies, not a strong engine. |
| **Upswing / Run It Once** (video courses and coaching) | Expert explanation, community | Active retrieval, spacing and contrast instead of passive video. The coach (Pip) asks before telling. The method calls passive review with no ex-ante record harmful. |
| **PokerTracker / Hold'em Manager** (trackers and HUDs over real hand histories) | Real-data stats on real opponents | Our opponents' *true* frequencies are known, so reads are graded (Brier vs base rate, O4). Sample-size gates and pre-registration teach what HUD-stat scanning gets wrong (the spec's false-leak arithmetic). Not a tracker; real hand-history import is out of scope. |
| **ICMIZER** (tournament ICM) | Tournament push/fold and ICM | Out of scope. Cash only, by design. No overlap. |
| **Duolingo-style apps** | Habit engine, character, streaks, leagues | Same habit shell. But the streak is appointments kept (spacing-correct), rewards come from mastery gates only, the mascot never praises, and there are no leagues on results. Variance makes a results leaderboard actively misleading in poker in a way it is not for vocabulary. |

**The three things no competitor can copy without rebuilding their pedagogy:**
1. A character whose every expression is caused by a graded event, held in check by a mechanical output guard (`guard.ts`).
2. A collectible deck written by the learner (the Rulebook), whose condition is retention.
3. A cast whose hidden mood is the curriculum, with gradeable reads.

---

## 6. Risks (what a skeptic will say, and the answer or the concession)

1. **"A mascot that never praises is a mascot nobody loves."** *Concession: untested.* The bet is that warmth can come from presence, humour about the cards, ritual and voice rather than praise. If it fails, the fallback is to allow **effort acknowledgement that is about the task** ("Four probes, all done") while keeping trait and outcome praise banned. Testing this needs real users, which the product does not have (no telemetry, by spec).
2. **Streak loss aversion versus pedagogy.** Even an appointments streak can produce anxious grinding or rushed probes. *Mitigation:* probes are graded on correctness, Kept counts completion not score, and there is no reset to zero. *Residual:* there is no data on whether Kept motivates as well as a calendar streak (speculation either way).
3. **The proxy problem, made louder.** Depth, seasons and certified cards all rest on `coach.ts`, a heuristic three-principle grader with a modelled range and no solver (`EXPERIMENT-1-adherence.md` "SCOPE CORRECTION"). Gamifying it raises the visibility and the cost of every grader error. Reason grading is about 82% accurate on its corpus (`reasonGrade.ts` header). That is fine for a private hint, and riskier when it gates a collectible. *Mitigation:* the spot bank (F14) is prioritised before Seasons 3+, and nothing cosmetic depends on a single reason classification.
4. **The outcome signal sneaking back.** Any cosmetic, story beat or regular line tied to winning pots reinstalls the σ ≈ 100 bb/100 signal (spec Problem section). *Mitigation:* a unit test asserting every reward source is in an allowlist of non-chip inputs, in the same style as `assertFlatGaps` and the `BANNED_PHRASINGS` assertion.
5. **Character leaks.** Regulars' faces, voices or in-hand chatter could leak archetype (O3). Pip's reactions could leak the answer pre-commit (T3a, T8). *Mitigation:* reuse the `tableTalk.ts` information-free invariant, and make Pip's pre-commit state a function of visible table state only, enforced by type, as `RulesRequest` is.
6. **Content treadmill.** A daily product consumes novel content faster than one author writes it. 24 lessons and 67 scenarios will run out (§1, gap 5). *Concession:* the Back Room without F14 is a few months of product, not a year.
7. **Desktop habit gap.** Electron, no network, no push. A daily ritual may never form on a laptop (speculation). Local OS notifications ("4 probes owed") are possible without network but need care about hostile defaults, as audio is treated in `session.ts`.
8. **Scope versus the test wall.** There are 62 e2e specs (~45 min), many pinned to the 900x640 layout. A new Home, a Map replacing tabs, and a character in the rail will churn screenshots and specs heavily. *Mitigation:* ship Pip and the Ticket inside the existing Home and rail first. The Map is phase 2.
9. **Pip's voice cost.** With no key, Pip is the fixed string table. Personality at scale means authoring hundreds of guard-passing lines, or the opt-in Bedrock path, which breaks local-only and carries the known numeral-free-falsehood hole (`RECOMMENDATIONS.md` item 7; spec T4).
10. **Tone drift into casino.** Felt, chips and "high room" fiction can drift toward gambling aesthetics, which fights the honesty stance. *Mitigation:* the colour role map in AGENTS.md (mint = your turn, felt green = the table only) and "no outcome numerals at the table" remain hard rules.

---

## 7. Decisions the owner must make

1. **Does Pip ever praise?** (a) Never: G7 as written, Pip is a neutral dealer. (b) Task-scoped effort acknowledgement only. (c) Lift the ban. *Recommendation: (a) at launch, (b) as the documented fallback. Not (c): it contradicts the founding method's strongest-evidence rule.*
2. **Streak semantics:** appointments kept (F3) or calendar days? Reset to zero or "missed" counter? *Recommendation: appointments kept, no reset.*
3. **The Ticket versus S2a and S3:** amend the spec to allow a short "probe ticket" containing due probes outside a 30/50 session, or keep the Ticket as pure free-roam with no probes? *Recommendation: amend. Probes are the retention measurement, and a daily ticket is where they are most likely to actually happen.*
4. **Write the v2.2 spec amendment.** "Out of scope" still lists XP, streaks, cosmetics and shop. Amend in the same explicit style as v2.1 STANDING, naming what stays banned (trait, praise, chip-derived rewards, fold reveals).
5. **Regulars: archetype redrawn per session (F2) or fixed per character?** Fixed is simpler and more lovable, and breaks O3. *Recommendation: redraw.*
6. **Cosmetics: earned-only, permanently?** Any purchase path implies network and money, both out of scope. *Recommendation: earned-only, and say so in the product promise.*
7. **Leaderboards on LAN:** none, effort-only (Kept), or results? *Recommendation: effort-only or none. Results boards are variance theatre.*
8. **Spot bank before or after the character?** The character is cheaper and more visible. The spot bank is what makes Depth and Seasons honest past the first few. *Recommendation: build Pip, the Ticket and the Rulebook now, and commit to the bank before Season 3.*
9. **Which segment first: A (home-game newcomer) or B (plateaued player)?** This decides whether the first season is "Rules and Eyes" or "The River". *Recommendation: A. The character and ritual matter most there, and the curriculum already covers phases 0–3 best.*
10. **Platform:** stay desktop-only (the current spec) or plan a companion for the daily Ticket? This is a large change to the local-only stance, so decide it explicitly rather than drifting into it.
11. **Pip's voice:** fixed strings only, or the opt-in Bedrock Pip? This determines the authoring budget (risk 9).

---

## Suggested build order (sketch)

1. **Season 0, "The Room opens":** Pip in the rail and coach sheets (F1, null tutor only), the Ticket on Home (F4), Kept on Home and Career (F3), named regulars with redrawn moods (F2), and the first cosmetic set from existing milestones (F6).
2. **Season 1:** the Rulebook (F5), Depth as rooms (F7), the Thursday Game ritual, the Regulars' File.
3. **Season 2:** the Map replacing Learn and Train (F8), Home Game Night review (F9), the Variance Room (F12).
4. **Before Season 3:** the spot bank and phase-4 nodes (F14), then seasonal story arcs and exploit-twin vignettes.
