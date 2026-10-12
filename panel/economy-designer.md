# Economy and cosmetics: an earn-only economy for Offsuit

Panel lens: game economy and cosmetics designer. Scope: streaks, freezes and repairs, XP, levels, leagues (offline,
ghost and LAN), quests, achievements, seasons, currencies and cosmetics. One hard rule runs through all of it:
**earn only.** No real money, no currency for sale, no loot boxes, no gacha, no paid random drops.

Nothing here is legal advice. Every regulatory point is a **risk to verify** with counsel before shipping.

---

## 0. The repo already argues with this proposal. Read this before anything else

The owner should settle these conflicts on purpose. Do not let the feature overwrite them quietly. The repo has
an amendment convention: "consciously revised here rather than silently overwritten", from the PRODUCT-SPEC
v2.1 amendment. This design needs a **v2.2 amendment**.

| Where | What it says | What this proposal needs |
|---|---|---|
| `PRODUCT-SPEC.md` § Out of scope (line 542) | "leaderboards, XP, streaks, cosmetics, a shop" are non-goals | Amend: XP (as effort), streaks (weekly and humane), cosmetics and an earn-only wardrobe come into scope. Leaderboards against other people stay out (§5). |
| `PRODUCT-SPEC.md` v2.1 amendment (line 546) | "The reward for climbing is a deeper, harder game … never chips-for-power, cosmetics, or a shop." It also says the banned words "rank/percentile/level/streak/XP/leaderboard/badge/trophy" stay forbidden on the progress and coach surfaces. | Keep "never chips-for-power" exactly as written. Allow cosmetics for **effort and mastery**, never for Depth itself (§3.4). Keep the vocabulary ban on the **coach** surface permanently. |
| `src/core/progress.ts:442-447` | The comment says the gamification vocabulary was removed from `BANNED_PHRASINGS` on 2026-08-14 by product decision | **The code and the spec disagree today.** The spec says those words are still banned on Progress. The code says they are allowed. Reconcile this first, whatever else is decided. |
| `research/TEACHING-METHOD.md:379, 455, 517, 790` | `streak`, `rank`, XP and "streaks-on-results" are deliberately absent in learning mode. 86% of negative motivational effects came from uninformative reward or punishment (Wisniewski et al. 2020). | The design obeys the letter of this. Nothing is ever earned from **results** (chips, pots, verdict correctness). Currency never appears on a teaching surface (§2.4). |
| `TEACHING-METHOD.md:485` | "Fix the visual layout now and never change it — card art, seat positions, stack display" (the parafoveal gain) | **Card faces, seat layout and stack display are never cosmetic.** Card *backs*, table paint, avatars and the character are allowed. |
| `TEACHING-METHOD.md:252`, `PRODUCT-SPEC.md` G3 | "Silence is not praise." No praise next to a correction. | No celebration ever fires on or near a coach verdict or a hand result (§7). |
| `PRODUCT-SPEC.md` N2 | The recommender gives one suggestion, "a list is a queue, and a queue is a soft lock" | Quests must not become a second queue. The daily quest **is** the recommender's suggestion (§6). |
| `AGENTS.md`, `DECISIONS.md:242`, `styles-glass.css:10` | `html[data-theme]` may change paint only (theme.spec). Pins: `--text-hi` #FFFFFF, `--positive` #3DDC97, the to-act ring, Fold with no box-shadow, seat opacity order. | Every cosmetic is a paint-only token override inside a whitelist. A cosmetic may never touch a pinned token (§8.1). |

**A naming correction for the panel:** the brief calls `bank.ts` the play-money chip stack. It isn't.
`src/core/bank.ts` is the **solver node bank** (on-bank versus off-bank grading, B4). The play-money stack is
`SessionState.bankroll` in `src/core/session.ts:136`. It defaults to `DEFAULT_BANKROLL = 10000` (line 23) and
`rebuy()` is free and leaves the bankroll unchanged (line 465). Everything below that says "chips" means
`session.bankroll`.

---

## 1. Design thesis: two ledgers that never touch

Offsuit already has two separate measures of the learner, and it keeps them apart well.

- **Skill:** Depth (`src/core/standing.ts`), computed from EV loss and mastery gates. It never reads chips and it
  only ratchets up.
- **Effort:** practice cadence and milestones (`src/core/career.ts`), described as "a count of days, never a
  break-on-miss shame counter".

The economy adds a third ledger for **study effort spent on learning actions** and keeps all three apart. It also
puts a wall between the economy and the chip stack.

```
 learning actions ──▶ Reps (effort, never spent) ──▶ Notebooks (levels)
        │                   │
        │                   └──▶ Chalk (spendable, capped per day) ──▶ wardrobe items (fixed prices)
        │
 mastery state (schedule.gate) ──▶ Seals (derived, never stored) ──▶ mastery-locked items
 Depth (standing.ts) ──▶ shown, never converted into anything
 chips (session.bankroll) ──▶ NOTHING. No route in or out.
```

---

## 2. Currencies

### 2.1 The roster

| Name | What it is | Spendable? | Source | Sink | Cap |
|---|---|---|---|---|---|
| **Reps** | Effort points, the XP equivalent. Tallies reasoned study. | No | Learning actions (§2.3) | None. Fills Notebooks (levels). | No lifetime cap. Daily Reps above 400 count at 0 for leagues and quests. |
| **Chalk** | Soft currency for the wardrobe. A pool player chalks the cue before a shot: preparation, not payout. | Yes | Paid alongside Reps, 1 Chalk per Rep, with a daily curve (§2.5) | Wardrobe items at fixed prices. Dyes. | **Daily earn cap 300. No wallet cap.** |
| **Seals** | One per concept the schedule gate reads `mastered` | No (it is a gate, not a coin) | Derived live from `schedule.ts` `gate()` → `'mastered'` | None. Mastery-locked items check the count. | Bounded by the KC count. |
| **Play chips** | `session.bankroll` | Only at the table | Hands. Free rebuy. | Hands | Unchanged from today |

**Why no wallet cap.** A wallet cap creates "use it or lose it" pressure. That is a loss-aversion nudge of the
kind the UK Children's Code and the EU CPC principles object to. The **daily earn** cap does the anti-grind work,
and saving up for a Grand item stays a calm choice.

**Why Seals are derived, not stored.** Mastery decays (`DECAY_HALF_LIFE_DAYS = 30`, and the gate can read
`frozen`). A stored seal would claim mastery the schedule no longer believes in. **An owned item never goes
away.** Unlocking checks the Seal count at the moment of unlock, and a later decay does not take the item back.
The UI can say "a seal faded, its spaced rep is due". That is information, not punishment, and it routes into
`nextDue`.

### 2.2 Why chips must stay separate from Chalk (the most important rule in this report)

1. **The legal "prize" element.** Gambling law in many places has three elements: consideration, chance and
   prize. A poker hand is chance. If chips could turn into Chalk, or win cosmetics, then a chance outcome would
   pay out something that feels valuable. That is two of the three elements. Add any purchase anywhere later and
   you have all three.
   - **Kater v. Churchill Downs** (9th Cir. 2018) held that free-to-play casino chips were a "thing of value"
     under Washington law because they extended play. The Big Fish settlement (~$155M) followed.
   - Offsuit's chips extend play too (a rebuy is free, so it is safe today). If chips ever buy cosmetics, that
     analysis comes back. *Risk to verify.*
2. **The social-casino look.** Regulators and ratings boards treat "simulated gambling + a reward loop + coins"
   as a social casino. If Chalk ever looks or sounds like money, Offsuit looks like one. Chalk's icon is a
   **chalk cube**: square, matte, never round or metallic. It has no clinking sound and no slot-style rolling
   counter.
3. **The pedagogy.** TEACHING-METHOD:790 deletes every outcome signal in learning mode because chips are
   variance. A chip→Chalk exchange would bring back, as a reward, the exact signal the method exists to remove.
4. **Minors** (§10). An earn-only, chip-isolated design is the only version that is defensible if anyone under
   18 ever opens the app.

**Make the separation structural, the way bank.ts makes "ungraded" structural:**

```ts
// src/core/economy.ts — branded so a chip amount cannot be passed where Chalk is expected.
declare const chalkBrand: unique symbol;
export type Chalk = number & { readonly [chalkBrand]: 'chalk' };
declare const repsBrand: unique symbol;
export type Reps = number & { readonly [repsBrand]: 'reps' };
// There is deliberately no function (Chalk) => chips or (chips) => Chalk.
```

Add a unit test, `economy-isolation.test.ts`, with three parts:
- An import-graph check: `economy.ts` never imports `session.ts`'s bankroll writers, `table.ts` or `bank.ts`. Then
  `table.ts` and `session.ts` never import `economy.ts`.
- A property check: earning functions take an `EarnSource` union that has **no arm** carrying `net`, `pot`,
  `chipsWon` or a hand result.
- This is the same "make the bug a type error" approach `bank.ts` uses for `NodeGrading`.

### 2.3 Earn table: learning actions, not outcomes

Every source is an action the method already values. **Correctness never changes the payout.** A wrong answer
with a reason earns the same as a right one, and a SURE-wrong review earns *more*, because G8 calls it "the
highest-value event in the system".

| Learning action | Builds on | Reps |
|---|---|---|
| Graded spot answered **with a reason sentence** (G5 gate, self-explanation) | `coach.ts`, `reasonGrade.ts` | 6 |
| Graded spot, no reason required | `coach.ts` | 2 |
| Due spaced rep done inside its wave window | `schedule.ts` `nextDue`, `WAVES` | 10 |
| Due spaced rep done late (still counts, never shamed) | `schedule.ts` | 6 |
| Decay probe answered | `sessionPlan.ts` `PROBE_COUNT` | 8 |
| Contrast set finished ("which variable flipped it?") | `contrast.ts` | 25 |
| Mechanism sentence **accepted** by the L2 criteria | `lexicon.ts` | 20 |
| Mechanism sentence **rejected** but attempted (rejections are diagnostic, L2) | `lexicon.ts` | 5 |
| Reviewing a **SURE-wrong** decision's full causal chain | `predict.ts`, G8 | 15 |
| Assessment block of 30 spots finished | `assessmentBlock.ts` | 80 |
| Pre-registering at most 2 villain tendencies (R2) | `reads.ts` | 5 |
| Puzzle scenario finished | `puzzle.ts` | 10 |
| First clean solve of a scenario (once per scenario) | `session.puzzleProgress` | +30 once |
| Lesson finished for the first time | `lessons/` (5 dirs; README counts 24 lessons) | 30 |
| Perception or anomaly drill item (RT drills, where fast is the goal) | `anomaly.ts` | 1 each, max 40 per day |
| Coached hand with a committed prediction and confidence | `predict.ts` | 3 |
| Uncoached live hand | `table.ts` | 1, max 20 per day |
| **Chips won, pots won, showdowns won, bb/100, a correct verdict** | — | **0, by type** |

**What a session is worth.** Take a 30-minute planned session (`sessionPlan.ts`: 4 probes, about 10 graded spots,
one contrast set, about 6 live hands). That is about 32 + 60 + 25 + 18, plus about 30 for due reps, so **about
165 Reps and 165 Chalk**. Every price below is set against that number.

### 2.4 Where currency may appear

- **Allowed:** Home (one quiet figure), Career, the Wardrobe, and the session-end summary.
- **Never:** the table during a hand, a coach sheet, a verdict, Progress's teaching metrics (the "four numbers"
  contract, story 35), Assessment, or Review.
- No "+6" toast on a graded spot. Earning is **batched and shown only at session end.** This keeps G3 ("silence
  is not praise") whole: a floating +6 after a T0 decision would be praise by another name.

### 2.5 Daily curve (anti-grind)

| Reps earned today | Chalk per Rep |
|---|---|
| 0–150 | 1.0 |
| 151–300 | 0.5 |
| 301+ | 0 (Reps still count toward Notebooks, up to 400 per day for leagues) |

Most learners hit the 300 Chalk cap at about 2 sessions. When they do, the session-end card reads:
**"Chalk is full for today. Spacing works better tomorrow."** That is a fact about the method (flat spacing,
Q4), not a scolding.

---

## 3. Prices, levels and unlock paths

### 3.1 Price ladder (fixed, published, never on sale)

| Tier | Chalk | About how many 30-min sessions | Notes |
|---|---|---|---|
| Common | 150 | 1 | |
| Uncommon | 450 | 3 | |
| Rare | 1,000 | 6 | |
| Grand | 2,400 | 15 (about 4 weeks at 4 per week) | |
| Dye (recolour an owned item inside its palette) | 60 | under 1 | |
| Mastery-locked | not for sale | — | Needs Seals, Depth or a milestone. Some *also* cost Chalk once unlocked. |

**Every price tag shows "about N sessions" next to the number.** That is the honest conversion. There are no
discounts, no "limited time" and no bundles, because those are urgency nudges.

**The collection is finite.** The full catalogue below costs about 34,000 Chalk. That is about 7 to 9 months of
regular study, so a dedicated learner can finish it. An endless sink is a treadmill.

### 3.2 Notebooks (levels)

A level is a **Notebook**: you fill pages with study. It is never called "rank". Notebook *n* needs
`300 + 100·(n−1)` Reps more than the last one. N1 = 300, N10 ≈ 7,500 cumulative, N25 ≈ 37,500.

- **Each Notebook grants one fixed item** (named in the catalogue). There is no random reward.
- **Notebooks measure effort, never skill.** They must never appear beside Depth with a shared visual weight.
  Depth is the skill reading, and the v2.1 amendment protects it.

### 3.3 Unlock rule kinds (all deterministic, all visible ahead of time)

1. `default`: owned from the start.
2. `price`: buy with Chalk.
3. `notebook`: reach Notebook *n*.
4. `seals`: hold at least *k* Seals at unlock time, optionally inside one KC family.
5. `milestone`: a `career.ts` milestone id or a new achievement id (§6.3).
6. `season`: a step on a free season track (§6.4). It goes to the Archive at Rare price after the season.
7. `rhythm`: a weekly-rhythm count (§4).

Every locked item in the Wardrobe shows its rule in plain words and a progress bar. Nothing is hidden. "Secret"
achievements are left out on purpose, because a hidden reward is a variable-ratio schedule.

### 3.4 What Depth unlocks: nothing cosmetic

The v2.1 amendment says the reward for Depth is "a deeper, harder game … and a quieter coach". **Keep it that
way.** Depth unlocks table depths, not outfits. If Depth bought cosmetics, players would push to inflate it and
the ratchet would turn into a target (Goodhart's law). The only Depth-adjacent cosmetics key off
`career.ts`'s "Certified the Nbb table" milestones as **commemorative plaques**, granted rather than bought. Even
that is an owner decision (D4).

---

## 4. Streaks: the "Weekly Rhythm"

A Duolingo-style daily streak fights this app's method twice:
- Flat spacing says a gap is correct ("a gap is not punished (spacing means gaps are correct)",
  `career.ts:72-75`).
- Daily-loss anxiety is the motivational punishment TEACHING-METHOD:275 says backfires.

So the streak counts **weeks**, not days.

**Rules**
1. **The learner picks a target of days per week**, from 2 to 6. The default is 3. A *week* counts when that many
   distinct study days happen in it.
2. **A study day** = at least 30 Reps from §2.3, or 1 due spaced rep, whichever comes first. Live hands alone
   never qualify. It must be learning.
3. **The Rhythm** = the count of consecutive weeks met. `career.ts` `currentRun` (daily) can still show as
   information on Career.
4. **Freezes are earned, free, and applied automatically.** You get 1 freeze per 3 met weeks and can hold up to 3.
   A missed week spends one silently. You also start with 1. **Freezes are never sold for Chalk.** Selling freezes
   turns anxiety into revenue, which is the core Duolingo dark pattern.
5. **Weekend mode** (opt-in): Saturday and Sunday don't count toward the denominator. Equivalently, you set your
   own study days.
6. **Pause (vacation)**: up to 6 weeks a year, in blocks of 1 week or more, set ahead or within 3 days after. The
   Rhythm is held, not broken.
7. **Repair**: a broken Rhythm can be repaired within 14 days by meeting the next week's target plus one extra
   study day. The cost is time, never Chalk. You can repair once per season.
8. **No shaming, ever.** No push notifications by default. The app is offline, and OS notifications should be
   opt-in and off by default, matching `soundCues`/`spokenVerdicts`. No "you'll lose your streak!". No crying
   character. A broken Rhythm reads: **"Rhythm: 0 weeks. Longest: 11. Next week counts from today."**
9. **Best Rhythm is kept forever** and is the figure Career shows most prominently. A break should never feel
   like losing your history.

**A bug in the current code to fix first.** `career.ts:114` buckets days by **UTC** (`Math.floor(ms /
86_400_000)`). For a learner in UTC−8, an evening session lands on "tomorrow". The Rhythm needs **local-day
bucketing**, with the offset recorded on each earn event so travel can't rewrite history.

**Clock tampering.** Local-first means the learner can change the system clock. **Don't fight it.** Nothing of
value is at stake, and that is a benefit of an earn-only economy. Guard only the LAN league (host-authoritative,
§5.2).

---

## 5. Leagues for an offline app

The method bans comparison with other players: no leaderboards, no percentiles, "multiplayer is explicitly
UNRANKED". So Offsuit leagues compare you with **your own past and with fictional characters who say they are
fictional**.

### 5.1 The Ghost Rail (default, fully offline)

A weekly league of 8 seats at a pictured rail:

- **You.**
- **Three past-self ghosts:** "You, 1 week ago", "You, 4 weeks ago" and "You, 12 weeks ago". Each ghost's score
  is that week's capped Reps, replayed from the ledger.
- **Four character regulars** drawn from the six archetypes (`archetypes.ts`: nit, station, LAG, TAG-reg,
  over-folder, maniac), shown as the cast in outfits. Each has a seeded weekly total of
  `{0.75, 0.9, 1.1, 1.3} × your 4-week median capped Reps`, plus a seeded wobble.
- **Disclosed in the league header:** "The regulars are characters. Their weeks are written to sit around your
  usual week." Rubber-banding that is hidden is a fake-social-proof dark pattern. Rubber-banding that is disclosed
  is a personal-best challenge in costume.

**Tiers.** Nine tiers named after card ranks: **Deuce Rail → Four → Six → Eight → Ten → Jack → Queen → King →
Ace Rail.**
- You **promote** by finishing in the top 3, which in practice means beating your own median.
- There is **no demotion**. That mirrors the Depth ratchet, and demotion is the loss-aversion engine of
  Duolingo leagues.
- At Ace Rail, the weekly result just reads "held the Ace Rail" and pays its weekly grant.

**Weekly grant.** Fixed by finish position, not random: 1st 120 Chalk, 2nd 90, 3rd 60, 4th–8th 30. This sits
outside the daily cap, but it is bounded at 120 a week.

### 5.2 LAN Club (opt-in, builds on the relay)

This uses the existing host-authoritative relay (`src/core/relayServer.ts`, `multiplayer.ts`,
`src/main/relayHost.ts`). Multiplayer defaults off (`store.ts` `loadMultiplayerEnabled`), and the Club is a
second opt-in on top of that.

- **The default is cooperative, not ranked.** A Club fills **one shared Notebook a week**: everyone's capped
  Reps added together. When it is full, every member gets the same fixed grant (100 Chalk) and the Club's table
  surface earns a stitch on its "Club Banner" cosmetic. No one is ranked against anyone.
- **Competitive mode (owner decision D6).** A weekly ranking by **capped Reps only**, never Depth, Seals, chips or
  accuracy. The cap means the ranking measures showing up, and nobody can grind past the daily ceiling.
- **What goes on the wire:** display name, equipped avatar and outfit ids, and the weekly capped-Reps integer.
  Nothing else. **No trading or gifting of items between members**, because a secondary market turns cosmetics
  into a "thing of value" (§10).
- The **host is authoritative** for the week boundary and totals, which matches the relay's design. Clients send
  their capped integer, and the host clamps it to `7 × 400`.

---

## 6. Quests, achievements, seasons

### 6.1 Daily quests: one card, not a queue

N2 says one suggestion only. So:

- **Quest 1 is the recommender's suggestion** (`recommend.ts`), shown as a quest card for +40 Reps.
- **Quests 2 and 3 are optional, fixed-pattern "study shapes"**, rotated by a published weekly calendar. Examples:
  "Write one mechanism sentence", "Do your due reps", "One contrast set", "Pre-register two tendencies".
  Each is +20 Reps.
- Quests **never** ask for a result ("win 3 pots", "go 10 for 10"). They **never** ask for more than about 30
  minutes in total, and they **expire quietly** with no penalty.

### 6.2 Weekly quests

These come from the same calendar: one "breadth" quest (touch 3 module families) and one "depth" quest (finish an
assessment block, or review 5 SURE-wrongs). Each pays 150 Chalk once, outside the daily cap, bounded.

### 6.3 Achievements

Achievements extend `career.ts` `computeMilestones`, which is already "effort and mastery only". The labels must
pass `bannedPhrasingIn` (no "great job", no trait claims). The new ones, each a fact:

| id | Label (a fact, never praise) | Rule |
|---|---|---|
| `hypercorrect-10` | Reviewed 10 decisions you were sure of and had wrong | 10 SURE-wrong reviews |
| `lexicon-10` | Ten of your own sentences accepted | 10 accepted L2 sentences |
| `rejected-and-returned` | Rewrote a rejected sentence into an accepted one | Same concept, rejected then accepted |
| `wave-4` | Carried a concept through all four spacing waves | Every `WAVES` entry done for one KC |
| `calibrated` | Sure means sure: 85%+ over 100 sure calls | `sureAccuracy ≥ 0.85`, n ≥ 100 |
| `honest-guess` | Flagged 50 guesses as guesses | 50 GUESS commits |
| `blocked-vs-interleaved` | Ran the Q6 debiasing comparison | Q6 A/B finished, with its pre-commit |
| `pre-registered-10` | Pre-registered tendencies in 10 sessions | R2 × 10 |
| `ledger-honest` | Logged 25 showdown gifts | `gifts.length ≥ 25` (`giftLedger.ts`) |
| `assessment-4` | Four assessment blocks taken | assessments ≥ 4 |
| `anomaly-200` | 200 anomaly calls | `anomalyTally.attempts ≥ 200` |
| `rhythm-12` | Twelve weeks of your own rhythm | Rhythm ≥ 12 |

### 6.4 Seasons: a free track, no pass

- Seasons last 10 weeks. Each is themed on a curriculum family, for example **Season of the Paired Board** or
  **Season of the River Bluff-Catch**, matching the B5 node families.
- The **track is free, fixed and fully previewed** on day 1: 10 steps, one per 400 capped Reps that season.
- **There is no premium tier, ever.** A two-tier "battle pass" is a payment funnel even when the premium half is
  free.
- **No permanent FOMO.** Every season item moves to the **Archive** at Rare price (1,000 Chalk) after the season
  ends. Missing a season costs Chalk, never the item.

---

## 7. Celebrations: when, and when never

| Fires at | Never fires at |
|---|---|
| The session-end summary | A won pot, a showdown, a busted villain |
| A KC's gate flipping to `mastered` (shown at session end, not mid-drill) | A coach verdict of any severity |
| A Notebook filled | A correct answer |
| A season step, an item unlocked, a Rhythm week met | An assessment block mid-way. It shows only after the block's withheld feedback. |

- **Celebration copy is fact-only:** "Notebook 6 is full." "Pot odds is mastered. Its next probe is in 21
  days." It is never "Great job!" (banned).
- **Accessibility:** respect `prefers-reduced-motion`, keep within WCAG 2.3.1 (no more than 3 flashes per second),
  and keep duration at or under 1.6 s. Any effect can be switched off in Settings. Sound is off by default
  (matching `soundCues`).
- **No intermittent celebration.** Every trigger is deterministic and the same every time. Variable reward
  schedules are the slot-machine mechanism and are banned here.

---

## 8. Cosmetics

### 8.1 Hard constraints on every item

1. **Paint only.** A cosmetic is a token override in a scoped block such as `html[data-cos-table='x']` or
   `[data-cos-back='y']`. It must pass the same `theme.spec` geometry check as `html[data-theme]`
   (`styles-glass.css:10`).
2. **Never** override `--text-hi`, `--positive`, the to-act ring or scale, Fold's shadow or seat opacities (the
   AGENTS.md pins). Never repaint coral or mint meanings (the colour role map).
3. **Card faces, seat positions and stack display never change** (TEACHING-METHOD:485). Only the **back** of a
   card is a cosmetic. A four-colour face deck is an accessibility setting, free and outside the economy (D8).
4. **Felt green means "the table only".** Table surfaces can re-dye the table, but they must keep AA on the pot,
   bet pills and seat text. They reuse the existing contrast harness (`src/core/contrast.ts`) and the 7-surface
   variant work in `demo/glass/table-variants.css` (`midnight`, `glass`, `ink`, `scoreboard`, `classic` and
   others).
5. **Fit 900×640 and 1100×760 with no page scroll.** Avatars and outfits render inside the existing seat-card
   box.
6. **No item may suggest value or money.** No gold chips, no "VIP", no diamond, no casino or brand marks, no WSOP
   lookalikes.
7. **Chip sets change paint only, not denominations,** and never imply a premium stack.

### 8.2 Catalogue (52 items)

Prices: C = Common 150, U = Uncommon 450, R = Rare 1,000, G = Grand 2,400.

**Card backs (10)**

| # | Item | Unlock |
|---|---|---|
| 1 | **Plain Bone** | default |
| 2 | **Graphite Weave** | C |
| 3 | **Patina Deck**: the back develops verdigris each time any concept completes a spacing wave, so it visibly ages with your spaced practice | Notebook 4; its ageing is driven by `WAVES` completions |
| 4 | **Signature Back**: prints your most recent *accepted* mechanism sentence in tiny engraving | milestone `lexicon-10` |
| 5 | **Blueprint**: the hand-class chunk diagram of N3 as linework | Seals ≥ 3 in the preflop family |
| 6 | **Tide Chart**: concentric rings, one per mastered Seal | Seals ≥ 8 |
| 7 | **Moth & Lamp** | U |
| 8 | **Paired-Board Mosaic** | Season of the Paired Board, step 5 |
| 9 | **Null Hypothesis**: a blank back with a tiny "n<20" stamp, a joke about gate R1 | milestone `pre-registered-10` |
| 10 | **Constellation of Gifts**: one star per logged gift | milestone `ledger-honest` |

**Table surfaces (8)**

| # | Item | Unlock |
|---|---|---|
| 11 | **Glass** (current default) | default |
| 12 | **Midnight** (the `midnight` variant) | C |
| 13 | **Ink Felt** (`ink`) | U |
| 14 | **Classic Baize** (`classic`) | C |
| 15 | **Scoreboard** (`scoreboard`; paint only, so the row-layout part of that variant is excluded) | R |
| 16 | **Chalkboard**: faint erased equations under the lamp | Notebook 10 |
| 17 | **Ghost Rail**: a faint silhouette rail of your past-self ghosts | Promote to the Ten Rail |
| 18 | **Club Banner**: the table embroidered with your LAN Club's stitches | LAN Club, 4 shared Notebooks |

**Chip sets (5). Paint only, never "premium"**

| # | Item | Unlock |
|---|---|---|
| 19 | **Clay Neutral** | default |
| 20 | **Pastel Bakelite** | C |
| 21 | **Slate & Bone** | U |
| 22 | **Wooden Tokens** (looks like board-game pieces, de-casino-fied on purpose) | Notebook 6 |
| 23 | **Chalk Cubes**: the bets are drawn as chalk marks | R |

**Avatars (seat portrait) (7)**

| # | Item | Unlock |
|---|---|---|
| 24 | **Monogram** | default |
| 25 | **Owl-free Bird** (a deliberately un-Duolingo heron; see D10 on trade dress) | C |
| 26 | **Raccoon Who Mucks** | U |
| 27 | **Calibration Telescope** | milestone `calibrated` |
| 28 | **Tortoise of Spacing** | milestone `wave-4` |
| 29 | **The Pre-Registrar** (a clipboard with eyes) | R |
| 30 | **Ace-Rail Gull** | Reach the Ace Rail |

**Character outfits (the teaching character, working name "Muck") (12)**

| # | Item | Unlock |
|---|---|---|
| 31 | **Dealer's Vest** | default |
| 32 | **Variance Raincoat**: a "this is just weather" coat for the variance lesson | First finish of the variance lesson |
| 33 | **Hypercorrection Hat**: a lightning-struck top hat | milestone `hypercorrect-10` |
| 34 | **Solver Robe** (deliberately cosmic and overwrought; the character says it "has never once been worn correctly") | Seals ≥ 12 |
| 35 | **Indifference Cardigan** (G9 mixed-node joke: "both buttons are worth the same") | Seals ≥ 2 in the principles family |
| 36 | **Blocker Shades** | Seals ≥ 3 in the river family |
| 37 | **Polarity Scarf** (half one colour, half the other) | U |
| 38 | **Pot-Odds Pocket Protector** | Notebook 3 |
| 39 | **Rain Boots of Rest** (worn when Pause is active, so vacations look cosy, not guilty) | Use Pause once |
| 40 | **Gift Ledger Quill & Visor** | milestone `ledger-honest` |
| 41 | **Paired-Board Pyjamas** | Season of the Paired Board, step 10 |
| 42 | **Grand Tuxedo of Almost Nothing** (absurdly formal; says nothing during verdicts, as G3 requires) | G |

**Celebration effects (6). Session-end only, all reduced-motion safe**

| # | Item | Unlock |
|---|---|---|
| 43 | **Quiet Underline** (a single ink stroke) | default |
| 44 | **Torn-Chart Confetti**: little 13×13 range grids floating away, a joke about leaving the grid behind | Seals ≥ 5 |
| 45 | **Chalk Dust Puff** | C |
| 46 | **Notebook Page Turn** | Notebook 8 |
| 47 | **Lamp Brighten**: the table lamp swells once | U |
| 48 | **Constellation Draw**: your Seals connect into a shape | R |

**Themes (whole-app paint, `html[data-theme]`) (4)**

| # | Item | Unlock |
|---|---|---|
| 49 | **Glass** (`graphite` id) and **Obsidian** | default (both exist today, `store.ts` `THEMES`) |
| 50 | **Dusk**: warm graphite, paint only | R |
| 51 | **Library**: sepia-paper ink on dark | Notebook 15 |
| 52 | **Archive Season Theme** (each season ships one) | season step 8, then Archive at R |

Any theme must pass the AA harness and keep the pinned tokens. **Accessibility themes (high contrast, larger
type) are free and never gated** (D8).

**Dealer-button skins** are a possible extension slot (13th, 14th: "Dealer Coaster", "Stamped D"). The button's
"D" on bone is pinned per DECISIONS:281, so it would be paint only.

### 8.3 Randomness

**Recommendation: none in acquisition.** The one allowed randomness is **"Dealer's Pick"**: an opt-in toggle that
equips a random combination **of items you already own** each session. It gives novelty without a draw, a
purchase or a hidden odd. It cannot hand you anything you don't already have, so it is not a loot mechanic under
any reading I know of. *Verify anyway* (D7).

---

## 9. Schema additions

The economy lives in the **profile** (`SessionState`) because it is earned per learner. It is backed up by
`backup.ts` and removed by `deleteProfile`. The theme *choice* stays a device preference in the settings file
(`store.ts` `loadTheme`), but a saved theme the profile doesn't own falls back to `graphite`. That matches how an
unknown value resolves today.

Follow the house pattern: an **append-only log** whose only writer is one function, with balances **derived,
never stored**. This mirrors `lexicon`, `fadingLog` and `giftLedger.ts`: "There is no exported function that adds,
edits, re-scores or deletes a gift".

```ts
// src/core/economy.ts (new, pure, no DOM, no clock: `now` is passed in like every core module)

export type EarnSource =
  | { kind: 'reasoned-spot'; decisionId: string }
  | { kind: 'spot'; decisionId: string }
  | { kind: 'due-rep'; conceptId: string; wave: number; late: boolean }
  | { kind: 'probe'; conceptId: string }
  | { kind: 'contrast-set'; setId: string }
  | { kind: 'lexicon'; conceptId: string; accepted: boolean }
  | { kind: 'sure-wrong-review'; decisionId: string }
  | { kind: 'assessment'; blockId: string }
  | { kind: 'pre-registration'; sessionId: string }
  | { kind: 'puzzle'; scenarioId: string; firstClean: boolean }
  | { kind: 'lesson'; lessonId: string }
  | { kind: 'perception-item'; drill: 'anomaly' | 'plm' }
  | { kind: 'coached-hand'; handId: string }
  | { kind: 'live-hand'; handId: string };
// No arm carries net, pot, chipsWon, verdict correctness. That is the isolation rule as a type.

export type EconomyEvent =
  | { readonly t: 'earn'; readonly at: number; readonly tzOffsetMin: number; readonly source: EarnSource;
      readonly reps: Reps; readonly chalk: Chalk }               // chalk already curve-adjusted
  | { readonly t: 'grant'; readonly at: number; readonly itemId: CosmeticId; readonly rule: UnlockRuleRef }
  | { readonly t: 'spend'; readonly at: number; readonly itemId: CosmeticId; readonly chalk: Chalk }
  | { readonly t: 'league-grant' | 'quest-grant'; readonly at: number; readonly weekId: string; readonly chalk: Chalk }
  | { readonly t: 'checkpoint'; readonly at: number; readonly reps: Reps; readonly chalk: Chalk;
      readonly owned: readonly CosmeticId[] };                    // compaction, bounded like MAX_ASSESSMENT_LOG

export interface RhythmConfig {
  readonly daysPerWeek: 2 | 3 | 4 | 5 | 6;
  readonly weekendMode: boolean;
  readonly weekStartsOn: 0 | 1;                                    // Sunday or Monday
}
export interface Pause { readonly fromDay: number; readonly toDay: number }   // local day index
export interface Loadout {
  readonly cardBack: CosmeticId; readonly table: CosmeticId; readonly chips: CosmeticId;
  readonly avatar: CosmeticId; readonly outfit: CosmeticId; readonly celebration: CosmeticId;
  readonly dealersPick: boolean;
}
export interface EconomyState {
  readonly version: 1;
  ledger: EconomyEvent[];                                          // only writer: recordEconomyEvent()
  loadout: Loadout;
  rhythm: RhythmConfig;
  pauses: Pause[];
  repairsUsedBySeason: Record<string, number>;
  club?: { readonly clubId: string; readonly mode: 'coop' | 'ranked' };      // only when multiplayer is on
}

// SessionState addition (src/core/session.ts), defaulted in emptySession() and tolerated as absent on load:
//   economy: EconomyState;

// src/core/cosmetics.ts: authored catalogue as data, like contrastManifest.ts
export type Slot = 'cardBack' | 'table' | 'chips' | 'avatar' | 'outfit' | 'celebration' | 'theme';
export type UnlockRule =
  | { kind: 'default' }
  | { kind: 'price'; tier: 'common' | 'uncommon' | 'rare' | 'grand' }
  | { kind: 'notebook'; n: number }
  | { kind: 'seals'; count: number; family?: string }
  | { kind: 'milestone'; id: string }
  | { kind: 'league'; tier: RailTier }
  | { kind: 'season'; seasonId: string; step: number; archivePrice: 'rare' }
  | { kind: 'rhythm'; weeks: number }
  | { kind: 'club'; sharedNotebooks: number };
export interface CosmeticItem {
  readonly id: CosmeticId; readonly slot: Slot; readonly name: string; readonly blurb: string;
  readonly rule: UnlockRule;
  /** Paint only: a whitelist of token names it may set. Validated against PINNED_TOKENS at build time. */
  readonly paint: Readonly<Partial<Record<AllowedToken, string>>>;
}

// Derived, pure: no stored balances anywhere.
export function balances(ledger: readonly EconomyEvent[]): { reps: Reps; chalk: Chalk; owned: Set<CosmeticId> };
export function notebookOf(reps: Reps): { n: number; intoNext: number; needed: number };
export function seals(states: readonly ConceptState[], now: number): number;   // schedule.gate(...) === 'mastered'
export function rhythm(ledger: readonly EconomyEvent[], cfg: RhythmConfig, pauses: readonly Pause[], now: number):
  { weeks: number; best: number; freezesHeld: number; repairOpenUntilDay: number | null };
export function ghostRail(ledger: readonly EconomyEvent[], weekId: string, seed: number): RailStanding;
```

**Dedupe.** `earn` is keyed by `source` identity per local day. Replaying the same puzzle earns its 10 once a
day, and `firstClean` earns once ever. Re-opening a lesson earns 0.

**Main process.** IPC: `economy:summary`, `economy:buy(itemId)` and `economy:equip(loadout)`. `buy` re-derives
the balance from the ledger and rejects anything not affordable or not unlocked. The renderer never sends a
balance.

**Relay.** Add exactly one message kind, `club:week { capped: number; avatar; outfit }`. The host clamps it.

---

## 10. Regulatory and ethical risks (to verify, not advice)

| # | Risk | Why it touches Offsuit | Mitigation in this design | Verify |
|---|---|---|---|---|
| 1 | **Simulated gambling classification** | Offsuit *is* simulated poker regardless of cosmetics. Australia's classification changes from Sept 2024 reportedly put simulated gambling at **R18+** and paid loot boxes at M or higher. | No loot boxes. The economy adds nothing gambling-like. | Whether a trainer with no purchases still lands R18+ in AU. Whether the app is distributed there at all. |
| 2 | **PEGI** | PEGI's gambling descriptor. Games that "teach or encourage" gambling may be rated 18. In-game purchase descriptors. | No purchases means no purchase descriptor. | PEGI's current criteria for poker trainers. |
| 3 | **ESRB** | "Simulated Gambling" descriptor. "In-Game Purchases (Includes Random Items)". | Neither purchases nor random items. | Whether an IARC self-rating is needed for store distribution. |
| 4 | **Social-casino / "thing of value"** (Kater v. Churchill Downs, 9th Cir. 2018; WA RCW 9.46) | Play chips extend play. | Chips are never purchasable and never exchangeable for Chalk or items, enforced by type. Rebuy stays free. | That no future change (a "chip pack", or chips as a quest reward) re-creates the theory. |
| 5 | **Loot boxes as gambling: Belgium** (Gaming Commission, 2018) | Only matters if a random paid drop exists. | There are none. Dealer's Pick only reshuffles owned items. | That Dealer's Pick is outside the BGC's analysis. |
| 6 | **Loot boxes: Netherlands** (KSA 2018; the Council of State 2022 ruling in EA's favour on FIFA packs) | Same as row 5. Also tradability matters in the Dutch analysis. | No trading or gifting of items. | Current KSA stance; pending Dutch legislation. |
| 7 | **Odds disclosure** (Apple App Store guideline 3.1.1, Google Play, China) | Only for random paid items. | None exist. Disclose Dealer's Pick as "random among items you own". | Store review wording. |
| 8 | **App store gambling policies** (Apple 5.3 and age rating 17+ for frequent simulated gambling; Google Play "Real-Money Gambling, Games and Contests" and simulated gambling rules; Microsoft Store) | A store build of a poker trainer. | Rate honestly as simulated gambling. Never imply real-money winnings. | Distribution plan (currently Electron direct download?). |
| 9 | **Minors** | Teaching poker to under-18s is sensitive in many jurisdictions. Streak and reward loops target young users' habits. | Earn-only and chip-isolated. No social pressure by default. | Whether to add an age gate or an "18+" statement at first launch (D1). |
| 10 | **UK Age Appropriate Design Code** (ICO Children's Code: "nudge techniques", which the ICO has named as including streak-style mechanics) | Applies to online services likely to be accessed by children. Offsuit is largely offline, but has an optional tutor (Bedrock) and LAN. | No notifications by default. No loss-framed streaks. Pause and freezes are free. | Applicability to a desktop app with optional egress. |
| 11 | **EU DSA Art. 25 (dark patterns)** | Applies to online *platforms*, likely not to an offline app. | Design to its standard anyway. | Applicability. |
| 12 | **EU Unfair Commercial Practices Directive / CPC Network "key principles on in-game virtual currencies" (2024)** | They target sold currencies (real-money price display, no obfuscation). | No sale. Prices shown in honest "sessions" units. | That an earn-only currency is out of scope. |
| 13 | **US FTC Act §5, dark patterns** (FTC 2022 staff report; Epic Games 2022 settlement, ~$245M on interface design) | Confirmshaming, false urgency, fake social proof. | No timers, no "limited", disclosed NPC leagues, no guilt copy (§11). | — |
| 14 | **COPPA / children's data** | LAN display names. Tutor egress. | The economy sends nothing off-device except the opt-in Club integer. | That LAN names aren't "collected" by an operator. |
| 15 | **Future monetisation creep** | Selling Chalk later would bring in rows 4–8 and 12 all at once. A "supporter pack" is the slippery first step. | DECISIONS line: "Chalk is never sold, gifted for money, or exchanged." Any change needs a spec amendment. | — |
| 16 | **Trade dress / IP** | A Duolingo-owl lookalike. Casino or WSOP marks. Real card brands (Bicycle, KEM). | Original character, no green owl, no brand marks. | IP review of the art. |
| 17 | **Photosensitivity** | Celebration effects. | WCAG 2.3.1, reduced motion, a kill switch. | — |
| 18 | **Conditioning toward gambling** | Celebrating wins at a simulated table trains a reward response to gambling outcomes. That is an ethical risk for anyone, and more so for minors. | No celebration on any hand outcome, ever (§7). | — |
| 19 | **Pedagogical harm** (overjustification; 86% of negative motivational effects from uninformative reward) | Learners could chase Chalk rather than understanding, for example by typing filler reasons. | Reasoned-spot Reps need a non-empty reason. Repeated identical reasons earn 0. Currency is kept off teaching surfaces. | Measure it (§12). |
| 20 | **Gambling-harm adjacency** | Some users of a poker trainer gamble with real money. A sticky loop could deepen problem play. | Offer a link to an offline "about gambling harm" card (no network). Break reminder at 60 minutes. | Messaging review. |

---

## 11. Anti-grind and anti-dark-pattern safeguards (checklist)

1. A daily Chalk cap of 300 with a half-rate band. A league and quest Reps ceiling of 400 a day.
2. Reasonless clicks earn the low rate. **Identical or near-identical reason strings** (normalised Levenshtein
   under 0.2 to any of the day's last 20) earn 0. Reasons under 3 words earn 0.
3. No multipliers: no "streak bonus ×2", no "double XP weekend". Multipliers inflate loss aversion around a break.
4. No timers, countdowns, "ends in 3h", "only today", bundles or discounts.
5. Freezes, Pause and Repair are free and never sold.
6. No hidden items, no hidden odds, no hidden achievements.
7. NPC league members are labelled as characters. Rubber-banding is disclosed.
8. Add a **guilt-copy ban list** to the existing ban: "sad", "miss you", "don't let me down", "you'll lose",
   "abandon", "last chance". Lint every economy and character string through `bannedPhrasingIn`.
9. A break reminder after 60 minutes of continuous study, phrased as method ("retrieval after a gap beats
   another block now").
10. Everything is off by default except the Wardrobe and the Rhythm display. Notifications, the LAN Club,
    competitive mode and celebration sound are all opt-in.
11. A "Quiet mode" switch hides every economy surface for learners who want the pure trainer, and earning keeps
    working silently.

---

## 12. How to know it works (and when to switch it off)

Use the app's own metrics as guardrails. Read them off logs that already exist, locally:

- **Primary:** assessment-mode RW EV loss (the promise). It must not get worse for learners who use the
  economy.
- **Watch:** the share of reasoned spots whose reasons are L2-acceptable. If that share falls after the economy
  ships, Chalk is buying filler.
- **Watch:** the share of sessions that are only perception drills (the cheapest Reps). If it rises, re-price.
- **Watch:** the late-rep share. The economy should *reduce* spacing debt.

---

## 13. Decisions for the owner

1. **D1. Audience and age.** Declare Offsuit 18+, adult-only, at first launch? The economy is designed to be
   safe either way, but simulated gambling plus streaks aimed at minors is the highest-risk combination in the
   table above.
2. **D2. The v2.2 amendment.** Approve amending PRODUCT-SPEC § Out of scope and the v2.1 "never cosmetics or a
   shop" line, and reconcile the `progress.ts` 2026-08-14 comment with the spec's still-banned word list. Which
   surfaces may say "streak" and "level"? Recommendation: Career, Home and Wardrobe may. Coach, Progress metrics,
   Assessment and Review may not.
3. **D3. Daily or weekly streak.** Recommendation: the **weekly Rhythm** described here. A daily streak
   contradicts flat spacing.
4. **D4. Depth and cosmetics.** Recommendation: Depth unlocks nothing cosmetic, only granted commemorative
   plaques from the existing milestones. Alternatively, no plaques either.
5. **D5. NPC league members.** Approve disclosed, rubber-banded archetype characters, or use past-self ghosts
   only.
6. **D6. LAN Club competitive mode.** Allow it (ranked by capped Reps only), or keep the Club cooperative-only,
   in line with "multiplayer is explicitly UNRANKED". Recommendation: cooperative only for v1.
7. **D7. Dealer's Pick.** Allow the one randomness (shuffling owned items), or allow none.
8. **D8. Free accessibility.** Commit that high-contrast, large-type and four-colour-deck options are free
   settings, never cosmetics.
9. **D9. Permanent no-sale pledge.** Add a DECISIONS.md line: Chalk and items are never sold, never tradable and
   never exchangeable with chips. Undoing it requires a spec amendment.
10. **D10. Character art direction.** Commission an original mascot that clearly isn't an owl, to avoid trade
    dress risk. Agree that the character never speaks during a verdict (G3) and never guilt-trips (§11.8).
11. **D11. The UTC day bug.** Fix `career.ts` day bucketing to local time before any Rhythm ships.

---

### File references (what each piece builds on)

- Effort, cadence, milestones: `src/core/career.ts` (`computeCadence`, `computeMilestones`),
  `src/renderer/screens/career.ts`
- Skill and its ratchet (kept separate): `src/core/standing.ts`, `SessionState.depthFloor` in
  `src/core/session.ts`
- Seals and spacing waves: `src/core/schedule.ts` (`gate`, `nextDue`, `WAVES`, `DECAY_HALF_LIFE_DAYS`)
- Session value estimate: `src/core/sessionPlan.ts`
- Earn sources: `coach.ts`, `reasonGrade.ts`, `lexicon.ts`, `predict.ts`, `contrast.ts`, `assessmentBlock.ts`,
  `puzzle.ts`, `anomaly.ts`, `reads.ts`, `giftLedger.ts`, `masteryDrill.ts`
- The append-only ledger pattern: `src/core/giftLedger.ts`, `SessionState.lexicon` and `fadingLog`
- The ban list to extend: `src/core/progress.ts` (`BANNED_PHRASINGS`, `bannedPhrasingIn`)
- Persistence: `src/main/store.ts` (profile versus settings file, `THEMES`), `src/core/backup.ts`
- Paint-only cosmetics: `src/renderer/styles-glass.css` (header, the obsidian block), `demo/glass/tokens.css`,
  `demo/glass/table-variants.css`, `src/core/contrast.ts`, `DECISIONS.md` (theme rules, colour role map)
- LAN Club: `src/core/relayServer.ts`, `src/core/multiplayer.ts`, `src/main/relayHost.ts`, `store.ts`
  `loadMultiplayerEnabled`
- Characters: `src/core/archetypes.ts`, `src/core/tableTalk.ts` (information-free banter during a hand. Outfits
  must not leak archetype labels before showdown, O3.)
- Chip stack (not bank.ts): `src/core/session.ts` (`bankroll`, `DEFAULT_BANKROLL`, `rebuy`)
