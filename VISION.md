# VISION — Offsuit: The Back Room

A synthesis of the eight panel reports in [`panel/`](panel/) (product, learning science, character, economy,
UX and motion, poker domain, architecture, skeptic). The mocks are in [`demo/vision/`](demo/vision/index.html).
The pitch is in [PITCH.md](PITCH.md), the swarm plan in [BUILD-PLAN.md](BUILD-PLAN.md).

> **Owner decisions are marked ⚑ DECISION** throughout and collected in §7. Nothing here changes `src/`, the
> spec, or the persisted profile until the owner signs them.

---

## 1. Product vision

**The Back Room** is Offsuit with a teacher you can see. It is a late-night card room where a dealer button
called Dee has sat in every seat and never won a pot, so it only ever grades the decision. Around Offsuit's
existing teaching engine it adds a cast, a campaign, a humane habit loop and an earn-only identity layer:
commit-before-feedback, flat spaced repetition, calibration, contrast sets, the reason gate, the learner's own
rule sentences, and the honest standing ratchet. It also adds the pro tools a serious player needs to bring a
real game home. The engine's rules stay intact. The coach is silent when a decision cost nothing. Rewards pay
for process, never for results. Nothing is ever bought, and nothing is random. Everything is local-first.

*Mocks show the Bold vision, including Chalk. The recommended first wave is narrower (PITCH §5).*

**Who it is for**, in order (product-strategist §2):
1. **Home-game newcomers** who want to stop being the fish at Friday's game and would quit a solver in ten
   minutes.
2. **Plateaued recreational players** (micro and low stakes, live or online). They know the words, have leaks
   they can't name, and need structure more than they need content.
3. **Returning players** who used to play and want a calm, daily way back in.
4. **Serious players** are served by Pro Tools (hand-history import, ICM, leak finder). They are not the
   target of the character layer, and the layer can be turned off.

**The one-line position:** *the only poker trainer whose coach knows when to stay quiet, and whose rewards
can't be bought or won by luck.*

---

## 2. The character system

### 2.1 The cast

The panel proposed four mascots: Dee (the character designer), Tell the ceramic chip (UX), Pip the human
dealer (product), and an unnamed "Dealer" (learning science). **Dee is chosen.** It is the most original and
the least derivative, and it is already on the table: the existing dealer badge becomes the character.
Tell's motion specs and Pip's venue framing are folded in. ⚑ DECISION D8 (the mascot).

| Character | What it is | Job | Builds on |
|---|---|---|---|
| **Dee** (lead) | The dealer button: a smoked-graphite glass disc with an engraved bone "D". Its only feature is the D's counter (the hole), which changes shape for each expression. No eyes, no beak, no limbs. | Speaks the coach's verdicts (it doesn't write them), asks the Interrogator's one question, greets, celebrates facts | `.dealer` badge in `styles.css` and the glass kit; `coach.ts` `Grade`; `coachPanel.ts`; `src/main/tutor/` |
| **Folio** | A notebook | Keeps the learner's own rule sentences, quotes them back, inks reads once they pass the gate | `lexicon.ts` (`feedbackOpening`), `giftLedger.ts`, `reads.ts` gates |
| **Tock** | An amber sand-glass | Runs the gate timer and the speed drills | `table.ts` GATE budget, `anomaly.ts` |
| **Mirror** | An empty glass card frame | Shows how often Sure was right | `predict.ts`, `confidence.ts` |
| **The Muck** | A heap of folded cards | Handles folds, including the free-fold mistake | `coach.ts` `toCall === 0` branch |

**Rivals** are one per archetype in `src/core/archetypes.ts`. Their names avoid the archetype ids, because
`nit` and `maniac` are banned words:

| Archetype | Rival | Venue | What beating them teaches |
|---|---|---|---|
| `nit` | Wren Holloway, lighthouse keeper | The Lighthouse | Her bet means strength: fold to it and take her blinds. Arc: "even a lighthouse flickers", so a read is a probability. |
| `station` | Barnaby Tull, toll-road keeper | The Toll Road Diner | Thin value; never bluff him |
| `over-folder` | Percival Hush, librarian | The Library | The bluff price (alpha) |
| `lag` | Vesper Kade, night-train conductor | The Night Train | Widen your defence and let her barrel |
| `maniac` | Juniper Vale, pier pyrotechnician | The Fireworks Pier | Trap and call down. She is weather, not a role model. |
| `tag-reg` | Ines Marlow, the metronome | The Observatory (final) | You win by *not* deviating |

Art: see [character sheet](demo/vision/character.html), which shows one SVG rig in ten states (seated,
hello, listening, rolling, wobble, on edge, price held, quoting, sitting out, engraving). Rivals are glass
medallions carrying a keepsake glyph (wick, ticket, bookmark, punched ticket, fuse, tuning fork). Each stays
masked until the learner beats its boss hand. This keeps the existing rule that an archetype is hidden until
showdown (`jitter.ts`, `tableTalk.ts`).

### 2.2 Personality bible (Dee)

- **Values:** the price, not the pot. Ask before telling. The learner's words outrank Dee's. A gap is not a
  failure.
- **Voice:** dry, warm, a little old-world. Short sentences built on concrete nouns: price, pot share, range,
  seat. It counts time in hands and orbits, never in missed days.
- **Tics:** "Price first." "Noted." (the whole reaction to a repeated notable). "From this seat…" It talks
  about itself as furniture: "I just move left. The thinking is the table's."
- **Never says:** anything about you as a person ("you are…", "a natural"); praise attached to a correction
  ("nice, but…"); luck, hot runs, "one more hand", chips won; anything comparing you with other people; guilt
  about absence; any strategy before commit.
- **Gets quieter as you improve:** every cooldown stretches by 1×, 1.5×, 2× and 3× per certified depth
  (`standing.ts` DEPTHS). The mascot stepping back is the reward for climbing.

### 2.3 The interaction model

| Moment | What Dee does | Rule it keeps |
|---|---|---|
| Before you commit | Still and silent; can explain the rules only | Commit-before-feedback (G5); the tutor's pre-commit path carries no solver fields (`tutor/types.ts` `RulesRequest`) |
| `free` grade | Nothing: no line, no pose change | The silence rule (G3, `coachPanel.ts`) |
| `notable` (0.5–2 bb) | Wobbles, amber rim; the engine's message is the content. A repeat in the same principle gets "Noted." | The ≤60-word, three-chunk budget (T4) |
| `serious` (≥2 bb, or G4) | Perches on the verdict sheet's rim, standing on edge, coral rim. Adds no words in-hand. | The one interrupt |
| Gate open | Listening, with an amber arc that drains in step with Tock | The reason gate (`table.ts` GATE) |
| Hand-end beat | At most one line from the bank, with cooldowns, in a 1.5 s slot | Lines only after the reveal |
| A hard spot played right | "Price held. 25% needed, 33% had: a close one." Fires only on a `free` grade where the spot was close (pot share within 10 points of the price, or inside the close-spot band), you said Sure, and your reason named the mechanism; once per principle per session; whether or not you won the pot. ⚑ DECISION D6 | Task feedback, not praise; never mentions the pot |
| Tilt proxy (3 consecutive T2+ verdicts answered in under 40% of your median time) | Sits out beside the cards and offers to end the block; suppresses in-hand interrupts for the rest of the block | PRODUCT-SPEC edge-case table. **Not built yet**, so it must be built first (Wave 0). |
| Biggest leak | One Home line per session, framed as a direction to practise | `career.ts` `biggestLeak`, `recommend.ts` (one suggestion) |
| Return after a gap | Leads with what is due: "Four concepts are due; the gap helped the spacing." | `schedule.ts` `dueNow`; no loss framing |
| Mastery | Engraving pose. One rim inlay shimmers mint once, then Folio reads your accepted sentence aloud. | Mint stays a positive delta |

**Dialogue engine.** `src/core/cast/` (proposed) holds line banks as typed data. Each line has
`{ event, conditions, pose, cooldown (hands or sessions), weight }`. A deterministic selector, seeded through
`rng.ts` with the hand id and street, works like `quipFor`. When every eligible line is on cooldown it returns
`null`, and silence is the fallback. Slots may only use engine fields (`{reqPct} {sharePct} {evLossBb}
{toCall} {pot}`) or career, standing and schedule data, which mirrors the guard's number-provenance check. A
unit test runs every line through `bannedPhrasingIn`, `WORD_LIMITS` and the leading-pronoun proxy in
`guard.ts`. The optional LLM (the existing guarded Bedrock tutor) may only *reword* a scripted line, through a
`tutor:flavour` channel that carries a line id and enums, never free text. The guard checks every output.
Without credentials it makes no call, so `no-network.spec` is unchanged. ⚑ DECISION D12.

### 2.4 Sample dialogue tied to real coach events

The event keys come from `coach.ts` (`Severity` `free | notable | serious`; principles `pot odds`,
`value or bluff`, `ranges`), `reasonGrade.ts`, `predict.ts`, `lexicon.ts` and `career.ts`. The full bank of
49 lines is in [`panel/character-designer.md` §9](panel/character-designer.md).

| Event | Line |
|---|---|
| `grade.serious.pot odds.fold` (toCall > 0) | "The price was low enough. The hand was already paying." |
| `grade.serious.pot odds.call`, hand-end | "Price first. The pot asked {reqPct}%; the hand brought {sharePct}%." |
| `grade.notable.pot odds.call`, repeat | "Noted." |
| `fold.free` (`toCall === 0`) | "Checking was free. Folding gave the pot away." |
| `grade.notable.value or bluff.check` (late street) | "That hand wanted a bet. Who pays you off?" |
| `grade.notable.value or bluff.bet` (lead below 35%) | "What is this bet for? Value, or a bluff with a story?" |
| `grade.serious.ranges.raise` | "That raise needed {reqPct}% just to continue." |
| `g4.right-action-wrong-reason` | "Right move. The reason given was the hand, not the price." |
| `gate.miss` | "Say it as a mechanism, not a conclusion." |
| `lexicon.rejected.cached-cell` | "That's a memorised answer. Tell me why it's true." |
| `lexicon.accepted` | "Inked. That sentence is permanent now." |
| `predict.sure-wrong` | "Marked sure, came out different. Those get priority." |
| `predict.guess-wrong` | "A guess that missed. That's what guesses are for." |
| `tilt.proxy` | "Three quick ones in a row. Want to stop the block here?" |
| `form.sharp`, session end | "Last fifteen decisions: the price held." |
| `cadence.return` | "Back after an orbit. Three concepts are due; the gap helped." |
| `milestone.depth-75` | "The 75bb table. Deeper stacks, and I talk less from here." |
| `showdown.unmask.nit` (Wren) | "Lamp's only lit when the ship is real." |

### 2.5 Story: The Long Orbit

There are seven venues. Chapter 0 is the Kitchen Table (the tutorial, unnumbered on the map), followed by six rival chapters, numbered 1–6, in the venues above, then a
replayable epilogue, **The Masquerade**, where every seat is masked and has a jittered profile and you unmask
seats by reading them (`reads.ts` gates, `anomaly.ts` categories). Each chapter runs: a cold open, 2–4 real
lessons from `src/core/lessons/content/`, a drill block, a session against the rival, and a boss puzzle from
`puzzleScenarios.ts` whose correct line is that rival's exploit. **Nothing is locked** (PRODUCT-SPEC N1): the
orbit is a recommended order, and choosing another chapter is logged as an override, as the recommender does
today. Depth becomes geography: the 75bb table is "the back room at the Diner". See the
[map mock](demo/vision/story.html).

---

## 3. The complete feature list

**Tiers.** *Core* is the minimum honest product. *Bold* is the full vision. *Moonshot* is speculative, or
needs a backend or new content pipelines. "Schema" means new persisted data, and every persisted change is
⚑ DECISION D2.

### Pillar 0 — Truth first (prerequisites the skeptic demanded; nothing below ships without them)

| Feature | One line | Tier | Builds on | Schema |
|---|---|---|---|---|
| Close-spot band | Verdicts within Monte Carlo noise or a mixed spot read "close", earn nothing extra, and Dee says nothing | Core | `coach.ts` `classifySeverity`, `equity.ts` DISPLAY_ITERATIONS | none |
| Preflop graded from the charts | Opening and defence mistakes are graded against `preflop.ts` / `chartBank.ts`, not the postflop formula | Core | `preflop.ts`, `chartBank.ts`, `coach.ts` | none |
| Villain ranges by archetype and street | Replace the one fixed `VILLAIN_BETTING_RANGE` | Core | `table.ts:589`, `assessmentBlock.ts:212`, `archetypes.ts` | none |
| The tilt check | Build the spec's tilt proxy and block break | Core | PRODUCT-SPEC edge cases, `session.ts` timings | small |
| Local-day fix | Streak days are counted in local time, not UTC | Core | `career.ts:103` | none |
| Schema version and downgrade guard | `schemaVersion`, forward-only migration, a backup before migrating; a newer profile opens read-only | Core | `store.ts`, `backup.ts`, `session.ts` `deserialize` (today it silently drops unknown keys) | **yes** |
| Re-run Experiment 1 | Measure tie and no-opinion rates after the grader fixes | Core | `research/EXPERIMENT-1-adherence.md` | none |
| 18+ statement | A plain statement of audience and purpose in onboarding and About | Core | — | none |

### Pillar 1 — Learn

| Feature | One line | Tier | Builds on | Schema |
|---|---|---|---|---|
| Dialogue lessons | Every lesson becomes a conversation: Dee asks, you commit, a wrong answer gets a question back | Core | `lessons/content/*`, `lesson.ts`, `predict.ts` | none |
| Today's Ticket | A 5–12 minute daily unit: everything due, one perception drill, three spots from the costliest leak | Core | `schedule.ts`, `sessionPlan.ts`, `recommend.ts`, `anomaly.ts` | small (ticket log). Needs a spec change, because sessions under 30 minutes are banned today. |
| Folio, the Rulebook | Your accepted sentences become cards; they tarnish as they decay and re-polish on review; export as a one-page sheet | Core | `lexicon.ts`, `schedule.ts` | small |
| Teach Dee | Dee plays from your own sentences on contrast sets. When a sentence is wrong, you name the variable and repair it (the protégé effect plus erroneous examples). | Bold | `contrast.ts`, `lexicon.ts`, `contrastManifest.ts` | small |
| Socratic interrupts | The Interrogator's ≤20-word question before the Explainer speaks | Core | `tutor/prompts.ts`, `guard.ts` | none |
| Spot bank, solved offline | River spots first, each tagged with its provenance | Bold | `bank.ts` (refuses to grade without solver data), `robustness.ts` | content pack |
| Fading per concept | Dee's help visibly thins as `fading.ts` advances | Core | `fading.ts` | none |

### Pillar 2 — Play

| Feature | One line | Tier | Builds on | Schema |
|---|---|---|---|---|
| Dee at the table | Pose-only in-hand; perches on the sheet rim for serious verdicts; a hand-end beat | Core | `table.ts`, `coachPanel.ts`, `predictPanel.ts` | none |
| Price held | The rare, specific beat for a hard spot played right with a mechanism reason | Core | `coach.ts` `Grade.price`, `reasonGrade.ts`, `confidence.ts` | none |
| The Regulars | Named rivals replace Ada, Bo and Cy, each with a session-drawn profile ("which Bo showed up tonight") | Bold | `archetypes.ts`, `jitter.ts`, `tableTalk.ts` | none |
| The Masquerade | Masked seats; unmask by reading; Folio inks a read only after 20 hands | Bold | `reads.ts`, `anomaly.ts` | small |
| 6-max table | Match the charts, which are 6-max; the table is 4-max today | Bold | `seatLayout.ts` (unit-tested to 8 villains) | none |

### Pillar 3 — Progress and streaks

| Feature | One line | Tier | Builds on | Schema |
|---|---|---|---|---|
| The Lamp | Lit days. Days with nothing due show as hollow "rested" rings and never break the run. | Core | `career.ts` `PracticeCadence` (`last30`, `currentRun`) | small |
| Weekly Rhythm | You pick 2–6 days a week; the run is counted in kept weeks | Core | `career.ts` | small |
| Spare wicks and Pause | Earned freezes (one per two kept weeks, at most two held) and a free 14-day pause; never sold | Core | — | small |
| Today's ring | Three goals (clear what is due, the one suggestion, one rule in your words) | Core | `recommend.ts` (one suggestion, N2) | none (derived) |
| Reps and Notebooks | Effort points, never spent; they fill Notebook levels | Core | award ledger keyed per award | **yes** |
| Seals | One per mastered concept, derived live from the schedule gate | Core | `schedule.ts` `gate()` | none (derived) |
| Milestones | Fact-labelled, e.g. "Certified the 75bb table" | Core | `career.ts` `computeMilestones` | none |
| Decisions, not results | Assessment EV loss trend and calibration, on Profile | Core | `assessmentBlock.ts`, `confidence.ts` | none |
| Seasons | 6–8 weeks, free track only, ending in the delayed test; then archived | Bold | `assessmentBlock.ts`, spacing waves | small |

### Pillar 4 — Character and story

| Feature | One line | Tier | Builds on | Schema |
|---|---|---|---|---|
| Dee and the cast | Ten poses, with line banks for every coach event | Core | §2 | none |
| The Long Orbit | Seven chapters plus the Masquerade epilogue | Bold | `lessons/`, `puzzleScenarios.ts`, `recommend.ts` | small (chapter progress) |
| Rival keepsakes | One per clean boss hand; each opens its replay | Bold | `puzzle.ts`, `session.puzzleProgress` | small |
| Depth quieting | Dee speaks less at each certified depth | Core | `standing.ts` | none |
| LLM flavour | Optional rewording of a scripted line, guarded | Moonshot | `src/main/tutor/` | none |
| Voice | Dee read aloud by the system's speech voice, off by default | Moonshot | `src/main/speech.ts` | none |

### Pillar 5 — Cosmetics and identity (earn-only, paint-only)

| Feature | One line | Tier | Builds on | Schema |
|---|---|---|---|---|
| Receipts | Every cosmetic is labelled with the fact that earned it | Core | milestones, Seals | **yes** (owned and equipped) |
| Card backs | 10 originals (Patina Deck ages with your spacing; Signature Back prints your sentence) | Core | `components/card.ts`; faces are never cosmetic (TEACHING-METHOD:485) | yes |
| Tables | The existing felt variants as paint-only themes, plus Chalkboard and Ghost Rail | Core | `demo/glass/table-variants.css`, `theme.spec` | yes |
| Chip sets | De-casino-fied: Clay, Slate & Bone, Wooden Tokens, Chalk Cubes | Bold | `--chip-a/b` tokens | yes |
| Dee's rims and engravings | Rim finishes, an inlay per Seal, your sentence engraved | Core | dee rig | yes |
| Celebrations | Quiet Underline, Lamp Brighten, Page Turn, Constellation Draw; at session end only | Bold | motion tokens | yes |
| Themes | Glass and Obsidian today; Dusk and Library added | Bold | `store.ts` THEMES, `html[data-theme]` | yes |
| Chalk | Earn-only cosmetic budget: 1 Chalk per Rep on a daily curve, at most 225 a day, fixed published prices, no sales | Bold | economy §4 | **yes**. ⚑ DECISION D4 |

### Pillar 6 — Social (local and LAN first)

| Feature | One line | Tier | Builds on | Schema |
|---|---|---|---|---|
| Ghost Rail | An offline league against your own past weeks and labelled bots (not the story rivals), tiers Deuce to Ace, counted by reasoned Reps; no demotion. Needs D18: the spec bans leaderboards. | Bold | `progression` ledger, rivals | small |
| LAN Club | A cooperative club over the existing relay; shared Notebooks; no trading | Bold | `relayServer.ts`, `multiplayer.ts`, `relaySession.ts` | small |
| Home Game Night | Dee deals a LAN game, then a shared review with no leaderboard of results | Bold | `multiplayer.ts`, `review.ts` | none |
| Challenge codes | A seeded spot as a code (optionally a locally drawn QR); a friend plays the same hand | Bold | `rng.ts` seeds, `puzzle.ts` | none |
| Profile export and import | Through a native file dialog; the "sync" with no server | Bold | `backup.ts`, `store.ts` | none |
| Global leagues, friends, cloud sync | Needs a backend and **breaks no-network**; flagged | Moonshot | — | server. ⚑ DECISION D3 |

### Pillar 7 — Pro tools

| Feature | One line | Tier | Builds on | Schema |
|---|---|---|---|---|
| Hand-history import | PokerStars, GG and ACR text parsed locally, stored outside the profile | Bold | `evaluate.ts`, `cards.ts` | NDJSON store |
| Leak finder | Counting stats with exact binomial bands; never a leak under 20 hands or a 15-point gap; "turn this leak into a drill" | Bold | `reads.ts` gates, `chartBank.ts`, `contrast.ts` | none |
| ICM and push/fold | Malmuth-Harville ICM, bubble factor, HU and 3-handed push/fold Nash solved offline | Bold | `equity.ts` (exact HU) | content pack |
| Range-vs-range equity and advantage | Range and nut advantage on any board | Bold | `equity.ts`, `rangeEditor.ts`, `boardReading.ts` | none |
| Node-locking-lite | One-street river EV tree with a lockable villain frequency | Moonshot | `rw.ts`, `reachRef.ts` | none |
| Session logger and live notebook | Live reads using the `reads.ts` gates, plus an hourly and variance calculator | Bold | `reads.ts`, `variance.ts` screen | small |
| Bankroll view | In bb or buy-in units with currency off by default, risk-of-ruin as education, a responsible-gambling notice, no stake-up prompts | Moonshot | — | small. ⚑ DECISION D10 |

### Pillar 8 — Platform

| Feature | One line | Tier | Builds on | Schema |
|---|---|---|---|---|
| Progression host | One diff → award → save path, idempotent per award key | Core | `session.ts`, `store.ts` | yes |
| Test clock | `OFFSUIT_NOW`, honoured only under e2e, for streak and day tests | Core | `main.ts`, `preload.ts` | none |
| Asset policy | Inline SVG built from TS path data; `assetsInlineLimit: 0` because the CSP blocks `data:` | Core | `vite.config.ts`, `index.html` CSP | none |
| Character and Celebrations switches | Separate off switches, with reduced motion honoured | Core | `settings.ts` | small |
| Local trial harness | On/off/on/off blocks with a written prediction and kill criteria | Core | `progress.ts` local metrics | small |
| Workers for leak finding | A spike: module workers from `file://`, with time-sliced batches as the fallback | Bold | `deal-perf.spec` pin | none |

---

## 4. Economy design

**Hard rules.** Earn-only. No real money anywhere. No currency for sale. No loot boxes, gacha or random paid
drops. No trading or gifting. Table chips (`SessionState.bankroll`) never convert to or from anything,
enforced by branded types and an isolation test. Nothing is earned from chips, pots, showdowns, bb/100 or a
correct verdict, by type (economy-designer §2–3).

| Currency | What | Spendable | Sources | Sinks | Caps |
|---|---|---|---|---|---|
| **Reps** | Effort, the XP equivalent | No | Learning actions only (table below) | Fill Notebooks (levels) | Above 400 a day, Reps count at 0 for the Rail and quests |
| **Chalk** (Bold, ⚑ D4) | Cosmetic budget | Yes | 1 per Rep for the first 150 Reps a day, 0.5 per Rep up to 300 Reps, then nothing | Locker items at fixed prices: 150 / 450 / 1,000 / 2,400 | **At most 225 earned a day**; no wallet cap |
| **Seals** | Mastered concepts | No (a gate) | Derived from `schedule.ts` `gate() === 'mastered'` | Unlock mastery items | Bounded by the concept count |
| **Spare wicks** | Freezes | Used automatically | One per two kept weeks | Cover a missed week | Hold at most 2; never sold |

**Sources** (Reps per action; learning-scientist §4 and economy §3 reconciled):

| Action | Reps |
|---|---|
| A graded spot with a full commit (action + Sure or Guess) | 10, plus 3 for any reason line (flat, because the reason grader is ~82% accurate) |
| Calibration: Guess | flat 7. Sure: 10 if right, 0 if wrong, so saying Sure pays only above ~70% belief; nothing ever subtracts |
| A due review inside its wave window | 10 (late still counts: 6) |
| A once-confident mistake answered right at its day-2 or day-7 return | 25 |
| Decay probe | 8 |
| Contrast set finished | 25 |
| Rule sentence accepted / attempted | 20 / 5 |
| Assessment block of 30 spots | 80 |
| Mastered items that aren't due | **0** |
| Chips won, pots won, a correct verdict, an imported real-money hand | **0, by type** |

About 165 Chalk for a 30-minute session. The whole catalogue costs about 34,000 Chalk: about 206 such sessions,
so roughly 8–10 months at five sessions a week. That is speculation, from the economy model, not measured. (The
economy report states a 300 cap, but its own curve tops out at 225, which is corrected here.)

**Streak rules (the Lamp).**
- A **counted day** needs one of: everything that was due, or at least 7 full-protocol decisions, or an
  assessment.
- A day with **nothing due** shows as *rested* and never breaks the run.
- The **run is counted in weeks**. A week is kept when it meets the learner's own Rhythm (2–6 days).
- Missed weeks are covered by **spare wicks**. Uncovered, the run ends quietly. The lifetime lit-day count
  never resets, and Dee leads with what is due, never with the loss.
- **Pause** gives 14 free days for holidays or illness.
- Notifications are opt-in and never loss-framed. There are no late-night "save your streak" prompts:
  sessions after a set hour show a gentle "the schedule will keep" note.
- **Day boundary:** 4 am local time (fixes the UTC bug).

**Cosmetic tiers.** Common (fixed Chalk), Uncommon (fixed Chalk), mastery-locked (Seals, Notebook level, or
milestone), story keepsakes (boss hands), and seasonal (free track, then archived). All of them are visible
in advance with their rule or price. **Card faces, seat layout and stack display are never cosmetic.**

**Forbidden mechanics:** any randomness in rewards, including an owned-item shuffle (the economy panel's "Dealer's Pick" is rejected so that "nothing is random" stays absolute); hearts or lives; streak wagers; double-XP events; per-item XP pop-ups; speed bonuses
outside perception drills; leaderboards against other people; celebrating or commiserating pots; sales,
timers, bundles; chips as currency.

**Risks to verify (not legal advice; the full table is in economy-designer §10):** simulated-gambling
classification (Australia reportedly rates simulated gambling R18+ from September 2024 [to verify]; PEGI and
ESRB descriptors); social
casino and "thing of value" doctrine (*Kater v. Churchill Downs*, 9th Cir. 2018); loot-box rulings (Belgium
2018, Netherlands 2018/2022), which matter only if randomness and value were ever combined; app store
gambling policies; the UK Children's Code on nudges; EU DSA and consumer law on dark patterns; FTC
dark-pattern guidance; COPPA; future monetisation creep; mascot trade dress; photosensitivity.

---

## 5. Look and motion (glass rules kept)

- **Rendering:** inline SVG plus CSS plus the Web Animations API, transform and opacity only, no new
  dependency. Lottie is rejected (it needs `eval` under the CSP), and so are Rive (it needs WASM and a CSP
  change) and three.js (size, GPU cost and a gamey feel).
- **Placement:** a **perch** in the title bar (Dee at 30 px, the Lamp count, today's ring) with no glass of
  its own. Dee is never on the felt. On the table it sits on the coach sheet's rim or in the hand-end tray,
  and floats stay at two or fewer.
- **Colour roles:** the Lamp and the rings are white light plus `--chip-a`. Never mint, because a kept habit
  isn't "your turn" and mint is never a balance. Never amber, because amber is notable and the timer. Dee's
  rim uses role colours (amber notable, coral serious, one mint tick per Seal). New tokens: `--ring-track`,
  `--ring-fill`, `--lamp-on`, `--lamp-rest`, `--dee-*` sizes, `--ease-arc`, `--dur-4` 480 ms, `--dur-ring`
  900 ms, `--dur-moment` 1600 ms (a hard cap on any celebration).
- **Celebrations** happen at session end only, in one moment sheet, built from Fitness-ring closes, a single
  gleam and factual copy. **Avoid** coin or chip showers, confetti, flashing, reels, count-up tickers,
  near-miss copy and gold.
- **Cosmetics** are paint-only attributes (`html[data-felt|back|chips|rim]`), and `theme.spec` must prove
  each causes zero layout change. Pinned tokens are never touched.
- **Accessibility:** the art is `aria-hidden`; lines are real DOM text; the coach announcer is unchanged;
  focus rings stay; the Character and Celebrations switches are separate.

---

## 6. What needs a backend

| Wants a server | Breaks no-network? | Local or LAN alternative (recommended) |
|---|---|---|
| Global leagues | yes | Ghost Rail (offline) and a LAN Club league over the relay |
| Friends and follows | yes | LAN Club; challenge codes |
| Cloud sync | yes | Profile export and import through a file dialog; a user-chosen synced folder |
| Remote content and seasons | yes | Seasons ship in the app build |
| Analytics and telemetry | yes | The local trial harness; nothing leaves the machine |
| Anti-cheat | yes | Not needed: nothing has value |

⚑ DECISION D3: the recommendation is **no backend**. Everything Core and Bold works offline. Moonshot server
features would need a separate network spec, an opt-in, and changes to `no-network.spec` and the CSP.

---

## 7. Every decision the owner must make

| # | Decision | Recommended default | What changes if overruled |
|---|---|---|---|
| **D1** | Write a **v2.2 spec amendment** that brings effort XP, a humane streak and earn-only cosmetics into scope, and reconcile the 2026-08-14 drift (code lifted the banned words; the spec still bans them). It also reverses v2.1's "never … cosmetics, or a shop" line. | Amend, scoped: rewards for process only; the vocabulary stays banned on coach surfaces | Without it, nothing in Pillars 3–5 can ship; the layer stays a mock |
| **D2** | **Persisted profile schema change** (`schemaVersion`, a `progression` namespace, forward-only migration, a backup before migrating, read-only for newer profiles). Reserved for the owner. | Approve | Without it, the profile can't hold Reps or owned items; today an older build would silently wipe new fields |
| **D3** | A **backend** for leagues, friends and sync | None; local and LAN only | A network spec, opt-in consent, a CSP and `no-network.spec` change, and ops on-call |
| **D4** | **Chalk** (a spendable earn-only currency) vs **receipts only** | Receipts only in Wave 1; Chalk only if the trial shows no farming | With Chalk from day one: more grind risk, more economy tuning |
| **D5** | **Streak unit** | The Lamp: lit days, a run in kept weeks, a chosen Rhythm, rested days | A daily streak fights flat spacing and raises streak anxiety |
| **D6** | May Dee **acknowledge good play** ("Price held")? | Yes, as task feedback, rare and specific, close spots only | No: Dee is silent on every correct decision, and "Price held" is cut |
| **D7** | Does Dee **speak in-hand**? | No: pose only, with words at the hand-end beat | Yes: it breaks the T4 word budget and the silence rule |
| **D8** | **The mascot** | Dee (the button) | Tell (a chip; reads more like a casino), Pip (a human; costlier art and stronger personality risk) |
| **D9** | **Navigation**: the nine-tab set (Home, Play, Learn, Story, Train, Study, Pro, Locker, Profile) vs the current 11. This is a synthesis proposal, not from a panel report. The mapping: Charts goes into Train; Bank, Equity, Ranges and Dossier into Study; Progress and Settings into Profile, with Settings also opening from the perch. | The new set, with nothing locked (N1) | Keep the 11; Story and Locker live under Learn and Profile |
| **D10** | **Pro tools** on real-money hand histories, and bankroll framing | Import for review and counting stats only, no profit/loss, no gamification; bankroll in bb units, currency off | Scope creeps toward a tracker; responsible-gambling review needed |
| **D11** | **18+ statement** and audience | Yes, in onboarding and About | Minors risk under several regimes |
| **D12** | **LLM flavour** lines | Off by default; guarded; scripted fallback | Off entirely, or on by default (needs a cost and consent note) |
| **D13** | A **second sound cue** (a ceramic clack at milestones) | Yes, behind the sound switch | Silent milestones |
| **D14** | **Grader fixes gate the rewards** (Pillar 0 first) | Yes | Rewards would amplify grader noise (the skeptic's strongest objection) |
| **D15** | **Run the trial** with kill criteria before Bold | Yes, four weeks on/off | Bold ships on faith |
| **D16** | **Daily Ticket** under 30 minutes (the spec bans sub-30-minute sessions) | Allow, as review rather than a "session" | The daily loop falls back to the 30-minute plan |
| **D17** | **Rivals replace Ada, Bo and Cy** everywhere, or only in Story | Story and the Masquerade first | Live play keeps the anonymous regulars |
| **D18** | A **second amendment for the other non-goals** that PRODUCT-SPEC:542 still lists: ICM, tournaments, hand-history import, bankroll management and leaderboards (Pillar 7 and the Ghost Rail) | Wave 2, after the trial: allow Pro tools (review-only on real-money imports) and the Ghost Rail (labelled bots and your past weeks, never other people) | Pro tools and the Ghost Rail are cut; Offsuit stays cash-game only |
