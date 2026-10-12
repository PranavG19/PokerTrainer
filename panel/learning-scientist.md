# Panel report: the learning scientist

**Question.** Can Offsuit add a Duolingo-style layer (a character who teaches, streaks, XP, levels, quests,
cosmetics) that makes the existing pedagogy work harder instead of replacing it?

**Short answer.** Yes, but only if every mechanic is attached to an event the method already treats as
learning: a commitment made before feedback, a reason stated, a due review completed, a confident error
repaired, a delayed test passed. It must never attach to the pot, to volume, to speed outside perception
drills, or to anything the learner can farm by choosing easy items. Three Duolingo staples (hearts/lives,
random chests, and loss-framed streak pressure) are actively harmful here and should be forbidden, not tuned.
The strongest idea in this report is not a reward at all. It is a character the learner *teaches*. The
character plays from the learner's own lexicon sentences, and when one of those sentences is wrong the
learner has to diagnose the character's mistake. That idea is built on `lexicon.ts` and `contrast.ts`, which
already exist.

Citation tags: **[confident]** means I am sure the paper exists and of the direction of its finding.
**[recalled]** means the paper exists but I am less sure of a detail. I give no effect sizes from memory
except those already in `research/TEACHING-METHOD.md`, which marks its own verification status. I had no
network access, so nothing here is newly verified.

---

## 0. The contradiction the owner must resolve first

The repo contradicts itself on this topic, so the panel has to pick a side.

- `research/TEACHING-METHOD.md` §"The four numbers on the scoreboard" and §"What we delete" both say
  **"no streak on results, no XP"**, and the ban list forbids "streak counters on results, leaderboards,
  percentile ranks".
- `PRODUCT-SPEC.md` N1 says **"There is no 'level', no unlock animation, no greyed-out nav."**
- `src/main/tutor/guard.ts:78-80` records that gamification vocabulary was **allowed on 2026-08-14 by
  product decision**. The trait-praise, praise-adjacent-to-correction and fold-reveal rules were kept as
  "pedagogy guarantees, not gamification bans."
- `src/core/career.ts` and `src/core/standing.ts` already ship a small gamified layer: a practice cadence
  with `currentRun`, effort/mastery milestones, and a "Depth" tier that ratchets up from decision quality.

Read closely, the method never banned streaks or XP as such. It banned **outcome-contingent and
uninformative** reward ("streaks-on-results", "86% of negative motivational effects came from uninformative
reward/punishment", per Wisniewski, Zierer & Hattie 2020 as cited in the manual). The proposal below keeps
that line exactly where the manual drew it. **Decision D1** (§6) asks the owner to write the reconciliation
into `DECISIONS.md` and to amend the TEACHING-METHOD scoreboard line, so the next agent does not reintroduce
the ban or overrun it.

---

## 1. What the app already does right

Most "Duolingo for X" products bolt engagement onto weak pedagogy. Offsuit is the reverse case: the
pedagogy is unusually strong, and the risk is that engagement mechanics dilute it. These are the pieces any
gamification layer has to preserve, each with the file that holds it.

| Already right | Where | Why it matters for gamification |
|---|---|---|
| **Commit before feedback.** Action plus SURE/GUESS confidence is required before reveal. | `src/core/predict.ts`; renderer commit tray (`DECISIONS.md:132`) | The commit is the natural, unfarmable atom of "doing work". It is the right thing to put XP on. Feedback only bites against a committed answer (Bangert-Drowns et al. 1991, as cited). |
| **Confidence routing (2x2)**, with SURE-wrong as "the highest-value event". It gets an immediate re-serve, then day 2 and day 7. | `src/core/confidence.ts:108-175`; `SURE_WRONG_SCHEDULE` | Hypercorrection: high-confidence errors are corrected more durably (Butterfield & Metcalfe 2001 [confident]; Metcalfe 2017 [confident]). A reward system that punishes SURE-wrong would suppress the most valuable event in the app. |
| **Latency cross-check on confidence** | `src/core/confidence.ts:301-350` (`PERSISTENT_DISAGREEMENTS = 3`) | Without it, confidence is the first field learners game once it drives rewards. It already exists, so it can police an XP rule. |
| **Flat spacing waves** (0, 1–2, 7, 21, 30–45 days), conjugate posterior, mastery gate, 25-opportunity freeze | `src/core/schedule.ts:25-64`, `gate()`, `dueNow()` | "Due" is a computed fact. A streak can be defined as "did what was due" rather than "showed up". Cepeda et al. 2006 (meta-analysis) and 2008 (ridgeline) [confident]. |
| **Interleaving with refusal rules** (mix only high-similarity modules; block only at first exposure) | `src/core/interleave.ts` | In-session accuracy will drop. Any XP that pays for raw correctness would penalise the learner for the scheduler doing its job (Kornell & Bjork 2008 [confident]; Rohrer et al. 2015/2020 as cited). |
| **Per-concept fading, never global** | `src/core/fading.ts` (`ACCURACY_FLOOR 0.7`, one drop per crossing) | Rules out a global "level" that strips scaffolding. Display levels must therefore be identity, not difficulty. |
| **Priced hints** (a hint drops that concept one rung) | `fading.ts` `HintPrice`; PRODUCT-SPEC T6 | Already an honest "cost" mechanic, so a separate currency is not needed to make hints meaningful. |
| **Outcome-blind grading.** Assessment is silent until the end; no results graph under 10,000 hands; win rate only above 2,000 hands. | `src/core/assessmentBlock.ts`; `src/core/progress.ts:42-51, 94-102` | The principle that every reward rule below inherits: **remove the result from the display; never say "ignore the result."** Outcome bias survives instruction (Baron & Hershey 1988 [confident]). |
| **Depth ratchets on decision quality**, with "current form" kept separate so a bad night cannot demote it | `src/core/standing.ts:140-300` | Already a skill-earned "level" that variance cannot touch. It is the template for how levels should behave. |
| **Cadence is not a shame counter** ("a gap is not punished (spacing means gaps are correct)") | `src/core/career.ts:52-76` | The right instinct. The proposal formalises it. |
| **Learner's own sentence is the concept name**, append-only and quoted back | `src/core/lexicon.ts` | The raw material for a character with memory, and for the teach-the-character mode. |
| **One-variable contrast sets** that fail loudly rather than emit two-variable pairs | `src/core/contrast.ts` | Supplies "the character got it wrong; which variable?" items. |
| **Gift ledger can only be written from observed showdowns** | `src/core/giftLedger.ts` | A precedent for anti-inflation by construction. Every XP source should be built the same way. |
| **Guard on all tutor text**: no trait attribution, no praise next to a correction, number provenance | `src/main/tutor/guard.ts:58-85` | Every character line, celebratory ones included, must pass the same guard. |
| **Decay probes and remediation can never be cut** | `src/core/sessionPlan.ts:8-12` | A streak "minimum day" must not become a way to skip them. |

Two gaps matter before a character ships:

1. **The tilt proxy from the PRODUCT-SPEC edge-case table is not implemented.** That rule is "3 consecutive
   T2+ with RT under 40% of personal median → offer to end the block". Grepping `src/` for `tilt` finds only
   `robustness.ts`'s opponent "tilt" weights. A character that celebrates and nags needs this brake first.
2. **The grader is heuristic and fragile.** `research/EXPERIMENT-1-adherence.md` found that 47.7% of
   decisions are ties and that one commit flipped the headline result. Any XP rule keyed to fine-grained
   `evLossBb` inherits that noise, so XP below is keyed to coarse tiers and to process, not to bb magnitude.

---

## 2. Mechanics that amplify learning, each tied to code

The governing principle comes from Cognitive Evaluation Theory. A reward undermines intrinsic motivation
when it is felt as **controlling**, and supports it when it is felt as **informational about competence**
(Deci & Ryan 1985 [confident]). The Deci, Koestner & Ryan 1999 meta-analysis [confident] found two things.
Expected, tangible, task-contingent rewards (engagement-, completion- and performance-contingent alike)
reduced free-choice intrinsic motivation. Positive verbal feedback did not; it tended to increase it, at least
in college-age samples. Points sit awkwardly between "tangible" and "verbal", and the gamification
literature is mixed and context-dependent (Hamari, Koivisto & Sarsa 2014 [confident]; a later meta-analysis by
Sailer & Homner 2020 [recalled] reports small positive average effects with wide heterogeneity). So the design
target is: **every point the learner sees should tell them something true about their learning.** If a
number carries no information, cut it.

### 2.1 The character: a tutor with a memory, a silence, and a notebook

Call it **the Dealer** as a working name. Its job is to give a face to the five tutor hats that already exist
(`PRODUCT-SPEC.md` T3, `src/main/tutor/prompts.ts`), plus one new hat.

- **Self-determination theory's third need is relatedness** (Ryan & Deci 2000 [confident]). Offsuit
  currently serves autonomy (N1: nothing locked) and competence (gates, bars), but nothing serves
  relatedness. That is the honest case for a character. The pedagogical-agent literature reports a
  "persona effect" (Lester et al. 1997 [confident]) whose effect on learning, as opposed to liking, is small
  in meta-analysis (Schroeder, Adesope & Gilbert 2013 [recalled]). **Do not justify the character as a
  learning intervention by itself.** Justify it as an adherence intervention that delivers interventions
  that do work. PRODUCT-SPEC Open question 2 names adherence as "the highest-probability project-killer".
- **The silence rule becomes visible.** "No comment means your decision cost under 0.1 bb/100. Silence is
  not praise." The character is how that convention becomes legible. On T0/T1 it stays idle and keeps the
  same neutral pose it had pre-commit. Reacting to every hand would break the silence rule and turn a
  meaningful channel into noise.
- **Memory through the lexicon.** "In March you wrote: *'suitedness pays for a weak kicker.'* This one is
  offsuit." That is `lexicon.ts` `feedbackOpening` / `quoteFor`, given a voice. Quoting the learner's own
  generated rule is elaboration plus retrieval cue, and it is the most personal thing a tutor can do.
- **The flagship new hat, the Protégé ("teach the Dealer").** Learning by teaching, and the protégé effect
  specifically, is documented with teachable agents: students worked harder on a computer character's
  learning than on their own (Chase, Chin, Oppezzo & Schwartz 2009 [confident]; the Betty's Brain line,
  Biswas, Leelawong, Schwartz & Vye 2005 [recalled]). Mechanic:
  1. The Dealer's "playbook" is literally the learner's accepted lexicon sentences.
  2. The Dealer plays spots drawn from `contrast.ts` along an axis the sentence covers.
  3. When the learner's sentence is incomplete (it predicts the wrong action on the toggled variant), the
     Dealer makes that mistake on screen, and the learner must name the variable and repair the sentence.
  4. The repaired sentence is appended to the lexicon (append-only, so history is kept).

  This is erroneous-example study (Große & Renkl 2007 [recalled]) and self-explanation (Chi et al. 1989, as
  cited) in one task. The learner commits a diagnosis *before* the reveal, so commit-before-feedback still
  holds. The Dealer's errors are generated from the learner's own rules, so they cannot be memorised from
  a fixed set, which satisfies the "300+ unique stimuli / no reused flops" principle.
- **Variance companion.** After a big lost pot with a T0 decision, the Dealer says the arithmetic sentence
  the method already prescribes ("~8% of 200-hand sessions lose two buy-ins at zero error"), framed on the
  decision. It never commiserates ("unlucky!") and never celebrates a won pot. Both responses make the pot
  salient, which is the outcome-bias channel.

### 2.2 XP that pays for the learning events, not for answers

XP is credited for (formula in §4.1):

1. **A full-protocol commit** (classify, commit, confidence, reason). This makes the forced commitment worth
   doing even when the answer is wrong. Unsuccessful retrieval still beats study-only (Kornell, Hays &
   Bjork 2009, as cited), so XP must not make errors costly.
2. **Calibration, via a proper scoring rule** on SURE/GUESS, so honest confidence maximises expected XP.
   That turns the latency cross-check from a policeman into an auditor: gaming confidence is never
   profitable, so there is nothing to police. Calibration feedback improves calibration (the manual's
   14th honest limit gives the ceiling and its caveats).
3. **Due reviews completed** (`schedule.dueNow`). Spacing works and learners under-rate it: "spacing
   outperformed massing for 90% of participants while 72% believed massing had been more effective"
   (Kornell 2009, as cited). XP is the place to pay for the thing learners would otherwise skip.
4. **Repairs.** A SURE-wrong concept answered correctly at its day-2 or day-7 re-serve earns the largest
   single XP grant in the system. That aligns the reward with "the highest-value event" rather than
   against it.
5. **Delayed-test passes (Gate C)** and decay probes: the retention measurements. Testing as learning:
   Roediger & Karpicke 2006 [confident]; Dunlosky et al. 2013 rate practice testing and distributed practice
   as the two high-utility techniques [confident].

### 2.3 Streak days defined by the spacing engine

A streak day is satisfied by doing **what the scheduler says is owed, or one honest unit**, whichever is
smaller. Rest days are part of the plan, not a lapse (§4.2). The method prescribes six practice sessions
plus one assessment per week and at most two sessions per day. A streak that demands seven days does not
fit the method. A **weekly rhythm with built-in rest days** does.

Habit research supports a consistent cue for automaticity. Lally et al. 2010 [confident] found habit
formation took a median of about two months, with very wide individual variation, and that a single missed
day did not materially derail it. That finding is the scientific argument against reset-to-zero streaks:
missing a day does not break the habit, so the UI should not say it did.

### 2.4 Quests as named pending work, not as targets

Quests come from scheduler state, never from arbitrary counts:

- **"Repairs pending: 3"**, from `SURE_WRONG_SCHEDULE`. The quest **names the count, never the concept or
  the day**. The re-serve and decay probes must stay unannounced (Q4: "embedded unannounced"). Naming
  the concept is cue support and inflates retrieval strength (failure mechanism 1 in the manual).
- **"The Experiment"**, the Q6 interleaved-vs-blocked debiasing A/B. The learner pre-commits their
  interpretation in writing and the Dealer co-signs it; the result is revealed at day 7. It is the most
  metacognitively valuable quest available, and the spec already requires it.
- **"Pre-register two reads"** (R2) at the start of a Table session. The quest completes on writing them,
  not on the reads being right.
- **"Frozen concept: worked example waiting"**, from `gate()` returning `frozen` at 25 opportunities. The
  quest routes to the worked example and never offers "another rep".

### 2.5 Levels and cosmetics as identity, earned by certification

- **Levels are display-only titles derived from mastery facts.** Examples: concepts at Gate B, Gate C passes,
  Depth floor (`standing.ts`). A level never gates content (N1) and never changes difficulty (T7). Depth is
  already "Certified the 75bb table" in `career.ts:155`. Keep that wording and register: certification, not
  rank.
- **Cosmetics are earned by Gate C (delayed, unannounced, novel-instance) passes and by repairs**, never
  bought with Table chips. `standing.ts:64` `affordableStack` reads a bankroll, and a bankroll is variance.
  Cosmetics paid in chips would make the pot a reward currency and would reopen the outcome channel the
  method deleted.
- **Cosmetics stay off the stimulus.** V4 fixes the drill surface. The PLM principle randomises irrelevant
  features per trial for transfer. Either way, cosmetic card backs, felts or deck faces must never appear
  in PLM, Spot, assessment or probe blocks. Allowed surfaces: the Dealer's wardrobe, Home, the Career
  screen, and the free-roam Table only. (The two source rules conflict with each other; see D7.)
- **A trophy that is the learning itself.** When a concept passes Gate C, its trophy is the learner's own
  lexicon sentence, engraved, with the date and the "boundary hand". This is the one cosmetic that is also
  a retrieval cue.

---

## 3. Mechanics to forbid or constrain

| Mechanic | Verdict | Mechanism of harm | Source |
|---|---|---|---|
| **Hearts / lives** (errors cost a life; out of lives = stop or pay) | **Forbid** | Makes errors costly, so learners avoid hard items and hedge. It destroys errorful generation ("I don't know is a commitment and scores as a miss") and the 75–85% target band. It also makes SURE-wrong, the highest-value event, the most expensive one. | Kornell, Hays & Bjork 2009; Potts & Shanks 2014 (both as cited in manual) |
| **Random chests / loot boxes / gacha / spin-the-wheel** | **Forbid absolutely** | A variable-ratio schedule is the most extinction-resistant reinforcement schedule (Ferster & Skinner 1957 [confident]). Loot-box spending correlates with problem-gambling severity (Zendle & Cairns 2018 [confident]). This is a poker app, so its users are gambling-adjacent by selection. Near-miss presentations increase the urge to continue gambling (Clark et al. 2009 [confident]). Shipping a slot machine inside a poker trainer is the worst wellbeing decision available. | |
| **Streak wagers ("double or nothing")** | **Forbid** | Duolingo has offered a streak wager in its shop [recalled; I believe it exists, not sure of current status]. In a poker app it teaches betting on your own streak. | |
| **Reset-to-zero streak with loss-framed warnings** ("Your streak is about to die!") | **Forbid the framing; constrain the streak** | Losses loom larger than gains (Kahneman & Tversky 1979 [confident]), so loss-framed streaks are effective. They are effective at producing low-quality "streak-saving" sessions, and after a break they trigger an abstinence-violation "what-the-hell" collapse (Marlatt & Gordon 1985 [recalled]). Spacing explicitly says gaps are correct (`career.ts:70`). | |
| **XP for raw correctness** | **Constrain** | Interleaving and desirable difficulties lower in-session accuracy by design (Bjork 1994 [confident]; Soderstrom & Bjork 2015, as cited). Correctness-XP makes the scheduler feel like a penalty and rewards learners who escape to free-roam easy items. | |
| **XP for volume** (hands at the Table, lessons opened, minutes in app) | **Forbid** | Volume is the deleted metric ("'hands played' or 'hours studied' as volume" in the manual's deletion table). Ungraded Table hands are not decisions (`PRODUCT-SPEC` edge case "Off-bank … not logged as a decision"). | |
| **XP for mastered, not-due items** | **Forbid** (zero XP) | Farming: the learner grinds what they already know. The scheduler already holds them "in rotation" at the right rate. | `schedule.ts` `gate()` mastered + `nextDue` |
| **Per-item XP pop-ups** ("+15!") | **Forbid** | An XP flash is knowledge-of-result, the d = 0.05 channel (Van der Kleij et al. 2015, as cited). It moves attention up Kluger & DeNisi's 1996 hierarchy toward the self [confident], and it competes with a ≤60-word, ≤4-chunk correction (Cowan 2001, as cited). In assessment and probe blocks it would leak correctness before the withheld reveal. | |
| **Speed bonuses** outside PLM | **Forbid** | Speed is part of the PLM gate (`anomaly.ts`: "speed is part of the gate"), so RT credit is legitimate there. Elsewhere, speed pay fights the REASON state and imitates the tilt signature (fast + wrong). | |
| **Double-XP weekends / happy hours / limited-time events** | **Forbid** | They manufacture massed practice and binges. They violate "two sessions per study day maximum". | Cepeda et al. 2006 |
| **Leaderboards / leagues** | **Forbid** (and moot offline) | Social-comparison feedback is self-level feedback, the least effective level (Hattie & Timperley 2007 [confident]). The method bans percentile ranks. The only allowed comparison is **ipsative**: you vs you four weeks ago, on assessment RW. | |
| **Trait or ability praise** ("You're a natural", "Shark!") | **Forbid** (already guarded) | Praise for intelligence led children to choose easier tasks and to perform worse after failure, compared with effort or process praise (Mueller & Dweck 1998 [confident]). | `guard.ts` trait rules |
| **Praise adjacent to a correction** | **Forbid** (already guarded) | The "but" clause is the part that gets dropped. | `guard.ts:71-75` |
| **Character reactions before commit** (frown on hover, nervous animation, "hmm") | **Forbid** | Pre-commit information channel: the same leak as hover-to-reveal (Bangert-Drowns et al. 1991, as cited). A facial reaction is a qualitative hint that the number-provenance guard cannot catch (T3a). | |
| **Character animation during CLASSIFY/COMMIT and during PLM blocks** | **Forbid** | Seductive details: interesting but irrelevant material reduces learning (Harp & Mayer 1998 [confident]). It also costs working memory in a 4-chunk budget and conflicts with V4's fixed drill surface and "no verbalisation during PLM". | |
| **Celebrating won pots / commiserating lost pots** | **Forbid** | Outcome bias (Baron & Hershey 1988). A poker-specific harm: loss-induced emotion is the tilt pathway (Palomäki, Laakasuo & Salmela 2013 [recalled]). | |
| **Guilt-trip notifications** | **Forbid** | Duolingo's owl is publicly known for guilt-tripping reminders as a marketing persona. That is public brand behaviour, not research, and controlling language is exactly what CET predicts undermines motivation. | |
| **Lucky-guess praise** | **Constrain** | GUESS-correct gets full elaboration (`confidence.ts`), never celebration. Celebrating a lucky guess reinforces guessing. | Butler, Karpicke & Roediger 2008 (as cited) |

---

## 4. Concrete rules

### 4.1 XP formula (sketch, to be implemented as a pure `src/core/xp.ts` over the decision log)

XP is a **fold over logged events**, like `fading.ts` `deriveState`. There is no writable XP field, so it is
recomputable, auditable, and cannot be inflated. Every term reads a field that already exists. **No term
reads `net`, the pot result, the bankroll, or the board runout.**

```
xp(event) =
  0                                   if mode is free-roam AND item is mastered-and-not-due
  0                                   if T0 Table hand off-bank (ungraded)
  otherwise:
    COMMIT      10   full protocol: classify + commit + confidence (+ reason when required)
  + REASON       3   reason present and not 'none' (flat; NOT graded by category, see note)
  + CALIBRATION  per proper scoring rule:
                     GUESS: +7 regardless of correctness
                     SURE : +10 if action-correct (severity tier free), +0 if wrong
  + DUE          5   item was due per schedule.dueNow at serve time
  + REPAIR      25   SURE-wrong concept correct at its day-2 or day-7 re-serve
  + PROBE        8   decay probe completed (credited at block end, never per item)
  + GATE_C      50   concept passes Gate C (credited at assessment end)

daily cap: XP accrues for at most two sessions' worth of planned items per day (the method's
"two sessions per study day maximum"); beyond the cap the app still works and still grades, but
the counter stops and says why.
```

Design notes:

- **Why the calibration payoffs are 7/10/0.** SURE has expected value 10p and GUESS is a flat 7. SURE beats
  GUESS exactly when the learner's true probability of being right is above 0.7. Honesty is therefore the
  XP-maximising policy, with "sure" meaning "better than 70%". The threshold can be tuned. Keep the
  structure: a proper scoring rule with no negative payoff, because no loss means no loss aversion. Show it
  to the learner once in plain words ("Say SURE when you'd bet on it at 7 to 3").
- **Why REASON is flat.** The local reason grader is 82/100 accurate with G4 precision 84.9%
  (`reasonGrade.ts` header). PRODUCT-SPEC Open question 3 says G4 logs but does not interrupt until
  measured. Paying XP by reason category would punish roughly one well-reasoned line in five. Keep it
  flat until the grader is validated.
- **Why correctness is binary on the tier.** It avoids inheriting the heuristic `evLossBb`'s fine-grained
  noise and its 47.7% ties (EXPERIMENT-1).
- **The process-to-correctness ratio is deliberately about 2:1.** A learner at the 75–85% target earns
  most XP from doing the protocol, so interleaving's accuracy dip barely moves the counter.
- **XP is shown only at block boundaries and on the scoreboard**, as one line per source ("Repairs: 2 · 50
  XP"). That makes the tally informational about *which learning events happened*, not a slot machine.

### 4.2 Streak-day definition and freeze rules ("Rhythm")

**A day counts** when the learner completes **one honest unit**:

- all items `dueNow` (capped at about 8 minutes of work), **or**, if nothing is due,
- one graded block of at least `MIN_GRADED_SPOTS = 7` full-protocol commits (`sessionPlan.ts:60`), **or**
- the weekly assessment.

**These do not count:** reading a lesson, ungraded Table hands, PLM drills alone (they are warm-up, about
4 minutes), and re-doing mastered puzzles. An honest unit must contain retrieval with commitment.

**The headline is the week, not the day.** A **Rhythm week** is ≥5 counted days, or ≥4 plus the assessment.
That matches the method's six-plus-one week with slack. The visible streak is "Rhythm: 9 weeks", and the
daily dots stay as information (`career.ts` `last30`).

**Freeze and rest rules:**

- **Two rest days per week are built in and not purchasable.** Using one does not "spend" anything. The UI
  does not call a rest day a freeze. It is the plan.
- **A missed Rhythm week does not reset to zero.** The display shows "Rhythm: 0 weeks, longest 9", and the
  next counted day starts a fresh run under fresh-start framing ("New week"). Temporal landmarks increase
  goal pursuit (Dai, Milkman & Riis 2014 [confident]).
- **No streak-at-risk warnings and no OS notifications by default.** At most, one opt-in local reminder per
  day, phrased as fact ("4 reviews are due"), never as loss.
- **An end-of-day "streak save" never shortens the session plan.** Decay probes and remediation stay uncut
  (`sessionPlan.ts:8-12`). The minimum unit is the plan's own floor, not a bypass of it.
- **Illness/holiday pause:** the learner can pause Rhythm for up to 14 days with one click and no cost.
  Because spacing waves are flat, the scheduler absorbs it (`schedule.ts` waves are ranges).

### 4.3 Feedback timing for the character

| Phase | Character may | Character may not |
|---|---|---|
| CLASSIFY / COMMIT / REASON | sit still and answer **rules** questions through the solver-free request builder (T3a) | change expression, gesture, speak about strategy, show XP |
| GATE (T2+ only) | ask the ≤12-word self-explanation prompt | hint at the answer |
| REVEAL, T0/T1 | stay idle (the declared silence) | nod, smile, show "+XP" |
| REVEAL, SURE-correct | name the principle, ≤5 words | elaborate or praise |
| REVEAL, GUESS-correct | full elaboration (`confidence.ts`) | celebrate the guess |
| REVEAL, SURE-wrong | **curiosity, not disappointment**: "You were sure. Find the variable." Then the causal chain | sigh, wince, any trait language |
| REVEAL, GUESS-wrong | terse correction plus worked example | more words |
| T3 interrupt | interrupt in-hand as the spec says | soften with praise |
| PLM block | absent from the screen | anything |
| Assessment / decay probes | absent until block end, then one batched debrief | per-item anything, XP included |
| Whole-task Table block | batched at block end | in-hand commentary |
| After tilt proxy fires | offer to end the block; go quiet for the rest of it | push "one more" |

**Praise rules** (Hattie & Timperley 2007 levels: task, process, self-regulation, self; self is least
effective [confident]):

- Praise only at **process or self-regulation** level, and **specifically**. "Repaired: the turn bluff-catch
  you were sure about on Tuesday is correct today," or "You stated RANGE before acting on six of seven."
  Never self level ("you're great").
- **Never in the same message as a correction** (already guarded).
- **Praise names the event, not the person.** Keep the guard's grammatical-subject proxy for character
  lines too.
- Praise is **scarce and earned**: repairs, Gate C passes, a completed Experiment, a calibration
  improvement. If every commit gets praise, praise carries no information, the same argument as the
  silence rule.

---

## 5. How to measure that it works (local only)

The learner is N=1 and the app is offline, so the evaluation must be a **single-case design**, not an A/B
test. Everything below is computable from the existing local decision log, plus a small engagement-event
log (`xpEvent`, `rhythmDay`, `characterLineShown`, `reminderShown`).

**Primary (learning; already instrumented):**

1. **Assessment-mode RW EV loss** (`progress.ts` `assessmentEvLossBb100`), compared ipsatively over 4-week
   windows.
2. **Decay-probe accuracy at days 21 and 30–45.** This is the only retention measure, and it is the one
   that matters.
3. **Gate C passes per week** and **time-to-criterion per concept**.
4. **SURE-wrong repair rate**: the share of SURE-wrong concepts correct at their day-7 re-serve.

**Calibration:**

5. SURE accuracy minus GUESS accuracy (`predict.ts` `sureAccuracy`/`guessAccuracy`). It should widen.
   **Alarm if the SURE rate rises while SURE accuracy falls**, which would mean the XP rule is being
   gamed, or is miscalibrated at 0.7.
6. Reads Brier skill vs base rate (`reads.ts:274-290`). Do not show a curve before 400 forecasts, per the
   manual.

**Engagement quality (Goodhart alarms):**

7. **XP composition**: the share from DUE + REPAIR + PROBE vs COMMIT on new items. If due work falls as a
   share, the rewards are pulling learners off the schedule.
8. **Free-roam to session-mode ratio**, and the share of free-roam commits on mastered items (farming
   index).
9. **Streak-save sessions**: sessions starting within two hours of midnight that end at exactly the minimum
   unit. Compare their accuracy, reason presence and median RT against normal sessions. If they are worse,
   the streak is producing low-quality work.
10. **Reason-line degeneration**: the share of reason lines that duplicate a previous line verbatim, and the
    median length over time.
11. **Override log** (`recommend.ts` N4). Declines of the recommender should not rise after gamification.

**Wellbeing:**

12. Sessions per day above two; late-night sessions; sessions continued after the tilt proxy fires; return
    within 7 days after a broken Rhythm week (the abstinence-violation check).
13. One optional, weekly, two-item local self-report ("I practised because I wanted to / because I felt I
    had to"). That is a crude Self-Regulation Questionnaire-style autonomous vs controlled split (Ryan &
    Connell 1989 [recalled]). If "had to" climbs, the layer has turned controlling.

**Design:** an **ABAB withdrawal**. Two weeks with the character and XP on, two off (the core loop is
unchanged), repeated. Compare decay-probe accuracy and counted days per phase. Pre-register the
interpretation in writing first, as Q6 does, because at N=1 a null result will be read as vindication. Be
honest about power: a few weeks of one person can detect a large adherence change (days practised), not a
small learning change. The learning metrics are guardrails that must not get worse, not outcomes the layer
is expected to improve.

---

## 6. Decisions for the owner

1. **D1. Reconcile the docs.** Record in `DECISIONS.md` that XP, streaks and levels are permitted **only**
   on process and mastery events, never on outcomes or volume. Amend the TEACHING-METHOD scoreboard line
   and N1 to "levels are titles, never locks". *Recommend: yes, before any code.*
2. **D2. Streak unit.** Daily streak vs the weekly **Rhythm** with two built-in rest days and no reset-shame.
   *Recommend: Rhythm.* A daily streak contradicts the six-plus-one week and the spacing engine.
3. **D3. XP visibility.** Per-item pop-ups vs block-end tallies. *Recommend: block-end only.* Per-item XP is
   the d = 0.05 channel and leaks into withheld blocks.
4. **D4. Calibration scoring.** Adopt the 7/10/0 proper scoring rule (SURE means better than 70%), or another
   threshold. *Recommend: adopt it, explain it once, and audit with metric 5.*
5. **D5. Hearts, chests, wagers, leaderboards.** *Recommend: forbid all four permanently, and add a test like
   `METRIC_KEYS` that fails if a random-reward or lives module appears.* This is a poker app; the
   gambling-adjacency argument is decisive.
6. **D6. Character voice source.** A fixed string table (offline, guard-checked) as the floor, with the
   BYO-key LLM as optional colour through the same guard. *Recommend: the string table must carry the full
   character.* With no key, the app makes zero network calls, and the character cannot be key-only.
7. **D7. Where cosmetics may appear.** *Recommend: Dealer, Home, Career and free-roam Table only; never on
   drill, Spot, probe or assessment stimuli.* Also resolve the V4 ("fixed drill surface") vs PLM
   ("randomise irrelevant surface features") conflict in the source docs. Both rules exclude cosmetics from
   stimuli, so this recommendation holds whichever wins.
8. **D8. Currency.** No currency, or a non-convertible one earned only from repairs and Gate C, and never
   chips. *Recommend: no currency at all.* Cosmetics unlock directly from certifications. A currency
   invites a shop, and a shop invites purchasable freezes.
9. **D9. The flagship.** Fund **teach-the-Dealer** (lexicon-driven protégé mode on contrast sets) as the
   character's core interaction. *Recommend: yes.* It is the only character mechanic with a direct
   learning mechanism behind it, and it reuses `lexicon.ts` and `contrast.ts`.
10. **D10. Prerequisites.** Implement the **tilt proxy** before the character ships, and keep XP off reason
    categories until the reason grader is validated (Open question 3). *Recommend: both block the
    release.*
11. **D11. Evaluation.** Run the ABAB withdrawal with a written pre-registration. *Recommend: yes.* Without
    it, the app cannot tell whether the layer is improving learning or only engagement.

**What the skeptic should hear.** Duolingo's streak engineering is aimed at retention of *users*. Offsuit's
pedagogy is aimed at retention of *knowledge*. These coincide only when the act that keeps the streak alive
is itself spaced, committed, effortful retrieval. Duolingo has published its spaced-repetition model
(Settles & Meeder 2016, half-life regression [confident]). It has also said publicly that streak features
drive retention [confident on the claim, not on any figure]. Neither shows that streaks improve learning.
This design makes the streak, the XP and the character pay out only on the acts the method already proved
worth doing. Everything that would pay out on anything else is forbidden by rule and, where possible, made
unrepresentable by type, following the `METRIC_KEYS` and `giftLedger.ts` precedents.
