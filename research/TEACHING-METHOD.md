# THE MANUAL
### A method for taking a complete beginner to near-equilibrium play with real understanding, and then to correct opponent-specific deviation

---

## The thesis

Poker's native feedback signal — the pot — is a single draw from a distribution with σ ≈ 100 bb/100, which makes unaided experience not merely slow but actively miseducative; a solver converts that wicked environment into a kind one by replacing the outcome with the expectation, and it is the only thing that can. But a solver's *output* is not a curriculum: its frequencies are the most abstraction-overfit part of its answer, its mixed nodes carry zero EV gradient, and a 13×13 grid is a lookup index for someone who already holds the schema, which is precisely why handing it to a beginner blocks schema formation. So the method is this: install perception before strategy, grade reach-weighted EV loss at the decision node rather than the hand, force commitment and a stated reason before any reveal, drill boundaries rather than cells, and treat opponent-specific deviation as a second curriculum with a different oracle, a worse feedback signal, and a hard cap — because the entire edge in exploitation lives in the cap and the revert, not in the exploit.

---

## Why solver interfaces fail as teachers — the mechanism

Six independent failure mechanisms, all structural rather than cosmetic. Fixing the UI does not fix any of them.

**1. Cue support inflates retrieval strength while storage strength stays at zero.** A visible chart, a labelled spot type, or an on-screen frequency pumps accessibility to ceiling. The learner performs fluently in-app and blanks at the table. Reference material is legitimate *as feedback*; as scaffolding it is a null operation. (Bjork & Bjork disuse theory, [recalled].)

**2. No committed prediction means no discrepancy signal.** Feedback effects in test-like events collapse or reverse under pre-search availability of the answer — hover-to-reveal, side-by-side, peek (Bangert-Drowns et al. 1991, [verified]; the look-ahead subgroup sign is [recalled]). Reveal-first tutoring delivers a fluent read of someone else's reasoning, which produces the feeling of understanding and encodes nothing.

**3. Bare verdicts are worth nothing measurable.** Knowledge-of-result — right/wrong, a red X, a naked `-1.4bb` — is **d = 0.05**, statistically indistinguishable from no feedback. Knowledge of correct response is 0.32; elaborated feedback 0.49 (Van der Kleij, Feskens & Eggen 2015, [verified]). Every commercial trainer ships the d = 0.05 channel as its primary one.

**4. The representation blocks chunking.** One preflop chart is 169 cells; with mixed frequencies it is ~400–500 item-level facts *for one node*, and six positions × open/3bet/call/4bet exceeds 10,000 facts before a flop is dealt. Against a ~4-chunk working-memory ceiling (Cowan 2001, [verified]) the learner encodes ~4 cells per exposure and reconstructs the rest by guessing. Worse: the grid presents cells as non-interacting isolated elements, so it supplies **no organising principle to chunk against**. The obstruction is the representation, not the volume.

**5. Expertise reversal, and why coaches can't see it.** Guidance that helps a novice becomes neutral and then *harmful* as schemas form, because redundant external explanation must be reconciled against internal structure (Kalyuga, Ayres, Chandler & Sweller 2003, [verified]). The grid and the solver tree are genuinely efficient for the coach — as a lookup index over a schema they already hold. That efficiency is exactly why they keep handing it to beginners.

**6. The solver's frequencies are the part you should trust least.** Real-game exploitability falls, bottoms out, then rises while abstract-game exploitability keeps falling — textbook overfitting (Johanson, Waugh, Bowling & Zinkevich 2011, [verified]). Quantified: CFR in a 10-bucket perfect-recall abstraction lows at 277 mbb/g then degrades to 305; in a 9,000-bucket imperfect-recall abstraction lows at 241 then degrades to 289 — while CFR-BR, minimising *real*-game exploitability in the same representational space, reaches 92.6 and 61.3 (Johanson, Bard, Burch & Bowling 2012, [verified]). And refinement is not monotone: in Leduc, refining the card abstraction for *both* players — "as is classically done for competitions" — took exploitability from 272.2 to **359.9** mb/h (Waugh, Schnizlein, Bowling & Szafron 2009, [verified]). Coarse structure is robust. Fine frequencies are artifacts of a bet-size tree someone chose.

**7. Mixed nodes have no gradient, so grading them is grading noise.** At equilibrium a player is indifferent between all pure strategies in his support — stated inside Ganzfried, Sandholm & Waugh's own Proposition 2 ([verified]). The EV derivative with respect to mixing weight is **zero**. "You 3-bet this 55%, the solver says 68%" is noise dressed as feedback on the least load-bearing quantity in the solution, and it injects up to 50% pure label noise into any learner model, flattening the skill's learning curve at the mixing entropy so mastery never triggers.

**The repo's grader has failure mode 8, and it is the highest-value single fix.** `/Users/pranavgk/Documents/temp1/poke/src/core/coach.ts:91-95` classifies on raw per-decision bb:

```ts
if (evLossBb < 0.5) return 'free';
if (evLossBb < 2.0) return 'notable';
return 'serious';
```

CFR's central object is a **counterfactual** value — the value at an information set weighted by the probability of reaching it. A 0.5 bb per-decision floor is simultaneously far too loose on a node reached every hand and far too tight on a node reached 0.8% of the time. Tier on reach-weighted loss; display both numbers.

---

## Units, once, for the whole document

| symbol | definition |
|---|---|
| **ΔEV** | EV(best action at node) − EV(chosen action), from the solver's own counterfactual node values, in bb |
| **RW** | reach-weighted loss = ΔEV × P(node reached per hand) × 100, in **bb/100**. Every severity threshold is on RW. |
| **ε** | mastery tolerance = **2% of pot**, not a bb figure (rivers have bigger pots and bigger absolute gaps; calibrate per street as a pot fraction) |
| conversion | 1 bb/100 = 10 mbb/g |

---

## The concept graph: the minimum spanning set

Ordered by prerequisite. **Principles precede the rules that instantiate them** — indifference before river bluff frequency, nut advantage before overbet conditions, MDF before any defence chart. The preflop range KC for a node is a prerequisite for that node's postflop KCs, not a separate module. This is slower to first competence than chart-first; say so out loud or the learner churns to a chart app.

### Layer 0 — PERCEPTION (5–7 hours, ~2,900 trials, before any strategy content)

Each is a Perceptual Learning Module: single forced choice, immediate label feedback ≤500 ms, **no prose, no think-aloud**, RT-adaptive sequencing with minimum lag 3 intervening trials, **300+ unique never-repeated stimuli per category**, every irrelevant surface feature randomised per trial (suit identities, seat graphics, stack display, card order). Mastery is **correct AND under threshold**, never accuracy alone.

| # | node | prereq | stimulus → response | median target | mastery gate | leverage |
|---|---|---|---|---|---|---|
| P0 | card floor | — | 7 cards → best 5-card hand | 1.5 s | 9/10 < **2.0 s**, ~400 trials | Gates every downstream RT threshold. At 4 s per read-out, no later target is reachable and the learner concludes they're bad at texture. |
| P1a–e | texture dimensions | P0 | bare flop → pairedness / connectivity / suitedness / high-card class / **overpair-availability** | 600 ms | 9/10 < **900 ms**, 200 each | **Overpair-availability does more work than any other single dimension and beginners never see it.** 764r → 88–AA are overpairs; QJT → only AA/KK. |
| P2 | composite texture | P1 | flop → STATIC / SEMI / DYNAMIC | 900 ms | 9/10 < **1.3 s**, ~300 | The label that actually predicts action. Include near-miss pairs differing in exactly one card: K72r vs 972r, 765ss vs 765r. |
| P3 | advantage direction | P2 + R2 | **node banner** + flop → PFR / caller / neither holds the nut advantage | 1.5 s | 8/10 < **2.0 s**, ~400 | Range advantage and nut advantage dissociate constantly, and **that dissociation is the single highest-value chunk in postflop poker.** BTN/BB on K72r: BTN has both. On 765ss: BTN keeps a slight range edge, BB holds more straights and two-pair. |
| P4 | **range role** ★ | P3, P5 | node + flop + hole cards → 1 of 7 roles | 1.8 s | 8/10 < **2.5 s**, ~600 across ≥8 node types | The flagship. Force the same role from maximally dissimilar holdings — A5s on 9h7h2c and KTo on QJ4r share **zero** card features and occupy the same role. That is abstract perceptual learning: structural relationships recognised in novel instances sharing no constituent features. |
| P5 | blockers | P0 | board + hole → do I hold the blocker? y/n | 800 ms | 9/10 < **1.2 s**, ~250 | Feeds P4 and every bluff-selection decision. |
| P6 | nut-changing runouts | P2, P5 | flop + hole → multi-select 13 ranks × 4 suits | 4 s | 8/10 < **6 s**, ~200 | Converts a static texture label into a live plan. Genuinely compositional — do not force this under 2 s. |
| P7 | anomaly trigger | P2–P4 | spot → "is this standard?" y/n, 15% seeded anomalies | 1.2 s | 9/10 < 1.5 s, ~200 | Installs the two-speed switch (§ Two-speed architecture). |

**Role vocabulary (P4 response set, 7 labels, fixed):** NUTTED VALUE · THIN VALUE · MARGINAL SHOWDOWN / BLUFFCATCH · DRAW-SEMIBLUFF · AIR WITH BLOCKERS · AIR NO BLOCKERS · TRAP.

**Never present a board without its node.** Role is node-dependent — the same hand is thin value as PFR and a bluffcatcher as caller. Node-free board drills train a false invariant the learner then misapplies for years.

### Layer 1 — FACTS (10–14 KCs; retrieval practice, drilled to a number)

| # | node | prereq | mastery gate | leverage |
|---|---|---|---|---|
| F1 | pot odds → required equity, **in natural frequencies** | — | 9/10 < 5 s | Reached on every call decision. "Pot 20, bet 10 — you put in 10 of 30, so you need to be right 10 times in 30," never "25%." |
| F2 | MDF from bet size (33% pot ⇒ defend 75%) | F1 | 9/10 < 5 s | Prerequisite to every defence rule; a global "folds too much to big bets" leak expressed at twenty nodes. |
| F3 | alpha / bluff:value from size (75% pot river ⇒ 3 bluffs : 7 value) | F1, R1 | 9/10 < 5 s | Prerequisite to river bluff frequency *and* to every exploit in the deviation catalogue. |
| F4 | combinatorics / combo counting | P0 | 8/10 < 10 s | Feeds blockers, range construction, and the gift ledger. |
| F5 | SPR arithmetic | F1 | 8/10 < 8 s | Makes stack depth a readable cue rather than a mode. |
| F6 | **variance table** | F1 | reproduce from memory | Not strategy. It is the gate on every results-based inference the learner will otherwise make (§ Hour 5). |

### Layer 2 — PRINCIPLES (12–16 KCs; the transfer core; taught by self-explanation, not retrieval)

| # | node | prereq | mastery gate | leverage |
|---|---|---|---|---|
| R1 | **indifference** | F1, F3 | Gate C (§ learner model) | Must precede river bluff frequency. Also the concept that makes correct deviation possible: at an indifference node the baseline frequency *equals* the exploit's breakeven frequency. |
| R2 | range advantage vs **nut** advantage | P1, P2 | Gate C | Feeds P3, all c-bet rules, all overbet conditions. |
| R3 | equity realisation + positional discount | F1, R2 | Gate C | The variable that pays for a weak kicker and for OOP defence width. |
| R4 | polarity → size | R2, F3 | Gate C | Must precede any sizing rule. |
| R5 | blockers as bet/bluff selection | P5, F4 | Gate C | Directly gates deviations #3 and #5 in the catalogue. |
| R6 | capped-range recognition | R2 | Gate C | The single fact that makes probe/delayed-cbet nodes learnable. |
| R7 | protecting the checking range | R4, R6 | Gate C | Prevents the "always bet when strong" leak that no chart can encode. |
| R8 | card removal / domination | F4, R3 | Gate C | The K7s boundary family lives here. |

### Layer 3 — SITUATED RULES (~50 KCs; each a `(position pair × action node × board class × size bucket)` cell)

Discovered, not authored (see § learner model, KC granularity). Expect "flop c-bet" to split into at least: dry-ace-high / dry-king-high / low-connected / paired / monotone / broadway-two-tone. **Cap the whole graph at 60–120 KCs** — beyond that no single KC accumulates the 12 opportunities a defensible gate needs inside a realistic study budget.

Leverage ranking for Layer 3, by reach rate per hand (6-max, 100bb, vs one specific villain) — this is the *only* legitimate study-priority ordering:

| observable / node | occurrences per hand |
|---|---|
| VPIP / RFI opportunity | 1.000 |
| BTN RFI | 0.092 |
| faces *any* flop c-bet (pooled) | 0.077 |
| BB facing BTN open | 0.041 |
| villain in BB facing your BTN c-bet (that exact node) | 0.0165 |
| faces *any* river bet (pooled) | 0.012 |
| faces your turn barrel (that node) | 0.0054 |
| faces your river bet (that node) | 0.0015 |
| river hero-fold node | 0.0007 |

### Layer 4 — EXPLOIT TWINS (one per Layer-3 KC; locked)

Unlocks only when its GTO twin **at the same node** is mastered, and is scored against a **node-locked** solve, never against GTO. Restrict to 6 canonical reads: over-folds river · under-defends flop · never bluffs · over-bluffs · calls too wide preflop · never 3-bets. Score **direction** (right way) and **magnitude** (fraction of available exploit EV captured) as separate numbers; direction mastery gates magnitude drilling. Grading a deviation against GTO penalises exactly the behaviour you are building.

---

## The training loop

### Per-hand protocol: prediction-before-reveal, enforced by the renderer

Solver output is **structurally unreachable** until commit — no hover, no peek, no side-by-side, no equity readout. Not an instruction; a lockout.

| state | budget | content | notes |
|---|---|---|---|
| **1 CLASSIFY** | ≤6 s | one word from a closed set: `RFI · defend · 3bet · squeeze · cbet · probe · barrel · thin-value · bluffcatch · multiway` | **Spot type is never labelled by the app.** Scored as an independent number from action accuracy. This is the sub-skill blocked drilling deletes, because the lesson heading does the classification for you. |
| **2 COMMIT** | ≤20 s | action + size + confidence `SURE`/`GUESS` | Two confidence levels, not three — the routing table needs two cells and a third costs a click per decision for no routing gain. Cross-check confidence against response latency; self-reported confidence is gameable the moment learners notice it drives difficulty. |
| **3 REASON** | ≤15 s | one typed line, must reference **RANGE** or **PRICE** | A line whose subject is the learner's own holding ("I have top pair", "ace-five is trash") gets exactly one redirect — *"That's what you hold. What does your RANGE do?"* — then logs as `hand-strength-reason`, which is itself a diagnostic and drops the concept one fading rung. |
| **4 GATE** | 8 s, 2 attempts | self-explanation prompt, ≤12 words, **only when ΔEV ≥ T2** | *"What is your range doing on this board?"* / *"What equity do you need at this price?"* Gate on errors only — gating every hand makes it noise the learner clicks through. |
| **5 REVEAL** | — | EV per action, ΔEV, RW, one error tag, correction text if the tier calls for it | — |

**No skip button.** "I don't know" is a commitment and scores as a miss. Unsuccessful retrieval on items *engineered to fail* still beats study-only (Kornell, Hays & Bjork 2009, [verified]), and guess-then-feedback beat both reading the correct pairing and multiple-choice selection on rare-word definitions where nearly every guess is wrong — with participants rating the errorful condition weakest when it was strongest (Potts & Shanks 2014, [verified]). The forced guess is only safe because nothing here lets a commit go ungraded; unfed errorful generation entrenches the error.

**Why the reason field is non-negotiable despite halving throughput.** Students studying *identical* worked physics examples split into good and poor learners purely on whether they self-explained (Chi, Bassok, Lewis, Reimann & Glaser 1989, [verified]); Cognitive Tutor geometry students required to state a reason per step gained better declarative knowledge and transfer while covering *fewer* problems in the same time (Aleven & Koedinger 2002, [verified]). And the binding constraint: transfer of practice testing is d = 0.40 [0.31, 0.50] overall, strong to application and inference items, **weak to absent for rearranged stimulus–response items**, moderated by response congruency and *elaborated* retrieval — with a publication-bias correction that substantially shrank the intercept (Pan & Rickard 2018, [verified]). Answer-matching without the surrounding explanation is precisely the item class they measured near-zero transfer on. Forty reasoned spots beat two hundred clicked ones.

**Quiz in the table's direction, never the chart's.** "Here is a seat, stacks, and action — act" transfers. "What does the baseline say for K7s from CO?" is a rearranged S-R item and does not.

### Per-session structure: 50 minutes, fixed blocks

Two sessions per study day maximum. **Six practice sessions + one assessment session per week.**

| min | block | content | feedback timing |
|---|---|---|---|
| 0:00–0:04 | **FLUENCY WARM-UP** | 1 PLM block, ~110 trials, RT-adaptive, min lag 3 | immediate, ≤500 ms, label only, no prose |
| 0:04–0:07 | **DECAY PROBES** | 4 novel instances of concepts last seen 21–45 days ago, unannounced, no coach | **withheld to 0:48** |
| 0:07–0:31 | **GRADED BLOCK** | 20 interleaved spots, full 5-state protocol | immediate per spot |
| 0:31–0:41 | **CONTRAST REMEDIATION** | top-2 errors → 4-variant simultaneous screen each, then 2 novel sequential variants | immediate |
| 0:41–0:48 | **WHOLE-TASK** | ~14 live hands vs archetype bots, reason requirement dropped, **pot outcome hidden** | batched, end of block |
| 0:48–0:50 | **SCOREBOARD** | exactly four numbers | — |

**Why whole-task exists at all**, given live play is ~10× worse per minute as a practice medium: component mastery does not sum to node performance. Part-task flight PLMs got non-pilots past 500–2,500-hour pilots in 1–2 hours and the authors flagged integration as the open question (Kellman & Kaiser 1994, [verified]). Budget it at 14% of session time and expect a visible dip when fluent parts first run together.

### The interleaved queue: built from confusion sets, not syllabi

A 20-spot block **never repeats a class consecutively** and spans: 100bb BTN RFI · 40bb BB defence vs 3-bet · 200bb SB squeeze · c-bet on A72r (range advantage) then 986ss (none) · turn probe after BTN checks back · river bluff-catch KQ on Kh9h4s2c7d facing 75% pot · a 3-way flop. Stack depths interleaved 40/100/200 so depth is a cue to *read*, not a mode you're told.

This is the exact implementation constraint from the preregistered cluster-RCT: no two consecutive problems requiring the same strategy, 54 seventh-grade classes, ~4 months, unannounced test one month later — **61% interleaved vs 38% blocked, d = 0.83** (Rohrer, Dedrick, Hartwig & Cheung 2020, [verified]). With identical practice problems: d = 0.42 at 1 day, **d = 0.79 at 30 days** — the advantage grows with delay (Rohrer, Dedrick & Stershic 2015, [verified]). And with spacing held *fixed* and only ordering varied, interleaving impaired practice-session performance and **doubled** next-day scores, with the error analysis showing the gain came entirely from correctly pairing each problem to its procedure (Taylor & Rohrer 2010, [verified]).

**But interleaving is conditional, and this contradicts the common trainer maxim "randomise everything."** 59 studies, 238 effect sizes: overall g = 0.42, but paintings g = 0.67, mathematics g = 0.34, expository text and tastes non-significant, and **word learning REVERSED at g = −0.39 favouring blocking**. The metaregression moderators are high between-category similarity, low within-category similarity, high material complexity (Brunmair & Richter 2019, [verified]). Therefore:

- **DO interleave:** K7s-CO / K7o-CO / K9s-CO / K7s-UTG / K7s-vs-UTG-open / KTo-HJ / K5s-BTN. Near-identical surface features, different correct actions.
- **DO NOT interleave:** preflop RFI with pot-odds arithmetic, bankroll, or ICM. Low between-category similarity buys the in-session cost with none of the discrimination benefit.

**Pre-frame the cost in writing before the first block:** in-session accuracy drops 20–30 points. Blocking is permitted only for the first exposure to a genuinely new concept (fading rung 0), then interleaving forever.

### The contrast-set generator: given one error, what gets served next

**Trigger:** any T2+ error, *or* a T0/T1 with a broken reason line.
**Output:** 4 variants on **one simultaneous screen** (rule extraction), then 6 novel variants distributed sequentially and interleaved (boundary sharpening). 10 reps per triggered concept.

**Generation rule, absolute: each variant toggles EXACTLY ONE of** `{suitedness, kicker/gap, position, players-behind, range-asymmetry (who acted first), board texture, stack depth}`. Two variables changed = no feature is attributable = the learner caches an instance pair instead of inducing a boundary.

**The K7s ladder** (6-max, 100bb, folded to CO, hero K7s, no chart, no label, learner misses):

| variant | toggle | target inference |
|---|---|---|
| K7**o**, CO, folded to hero | suitedness | *"suitedness is what pays for a weak kicker"* |
| K**9**s, CO, folded to hero | kicker gap | *"the kicker sets how often I'm the dominated one when a K flops"* |
| K7s, **UTG**, folded to hero | players behind | *"the same hand class flips on how many players can still hold a better version of it"* |
| K7s, CO, **UTG has opened** | range asymmetry | *"my K is only an asset against ranges containing few better Kx"* |

Then one prompt: **"Which variable flipped the answer, and why?"** The learner's sentence is stored as the concept tag and **all future feedback on this concept quotes their sentence back**. Reject *"K7s is a CO open"* — that is a cached cell. Accept only statements in terms of domination risk, equity realisation, or range asymmetry. Escalation variant if all four fail: 72s on BTN folded-to-hero vs K7s from UTG, forcing the learner to state that position and range width outweigh absolute card rank near the boundary.

**Postflop skeleton, identical:** base = BTN vs BB SRP, K72 rainbow, hero A5s, c-bet or check. Toggles: (a) K76 two-tone, same hand; (b) 55 instead of A5s, same board; (c) hero is BB after BTN checks; (d) 40bb. Target rule: *"range advantage plus low draw density buys a high-frequency small bet; when draw density rises, no-pair hands lose the fold-equity-plus-backdoor profile and go to check."*

**Simultaneous presentation is the format for rule extraction only.** If the active ingredient is discriminative contrast rather than temporal separation, near-miss instances presented together produce the same comparison and make the discriminating feature explicit. Flagged as the weakest link here: the frequently-cited detail that simultaneous presentation *matched* temporal interleaving is [recalled], not confirmed (Kang & Pashler 2011 — title-level claim [verified], the simultaneity finding [recalled]).

### Spacing schedule

Per concept, embedded **unannounced** in the normal interleaved queue. Never a "review session."

| day | reps | mode |
|---|---|---|
| 0 | 10 | blocked micro-block, chart hidden, prediction before every reveal |
| 1–2 | 4 | interleaved |
| 7 | 4 | interleaved |
| 21 | 3 | interleaved |
| 30–45 | 2 | **decay probe**, unannounced, feedback withheld to end of session |

Gaps derive from the ridgeline result: >1,350 participants, gaps to 3.5 months, retention intervals to 1 year; final performance is an **inverted U** in gap length and the optimum grows with test delay — optimal gap ≈ 20–40% of a 1-week retention interval but only ≈**5–10% of a 1-year interval** (Cepeda, Vul, Rohrer, Wixted & Pashler 2008, [verified]). For "still correct a year from now," 5–10% of 365 days = 18–36 days, which is why day 21 and day 30–45 carry the durable load and day 1–2 is acquisition scaffolding. Over-spacing hurts too; there is no "longer is always better."

**Later gaps stay roughly flat, not doubling.** Expanding retrieval promotes short-term retention while **equally spaced** retrieval enhances long-term retention (Karpicke & Roediger 2007, [verified]). Popular SRS expanding intervals are convention, not evidence. Do not build 1/2/4/8/16.

**Do not compress remediation into 1/2/3-day chains** — that is massing wearing spacing's clothes. Spacing outperformed massing for **90% of participants** while **72% believed massing had been more effective** (Kornell 2009, [verified]).

**Mastered concepts never exit rotation.** One probe miss reopens the contrast set and resets to a 7-day gap. Two misses returns the concept to active learning with 6 remaining opportunities — not a full reset.

### Fading ladder — per concept, advanced on measured accuracy, never on calendar

| rung | scaffold | exit criterion |
|---|---|---|
| 0 | worked examples: 2–3 fully reasoned hands, learner's only job is to say **why each step follows**, then an isomorphic hand with suits and texture changed | 3 consecutive correct |
| 1 | full 3-element correction | 3 consecutive correct |
| 2 | **principle name only** — learner reconstructs the why | 85% on novel boards across 3 sessions |
| 3 | bare "incorrect", learner self-diagnoses; principle name on request, **logged as a hint** | tag-specific error rate < 10% |
| 4 | batched delayed review: 10 hands, learner self-marks all 10, then reveal. **The 13×13 grid becomes visible here, as a lookup index.** | Gate C |

Rung 0 exists because unguided problem solving spends working memory on means-ends search that contributes nothing to schema formation — studying worked algebra examples beat solving equivalent problems, *in less time* (Sweller & Cooper 1985, [verified]). But a worked example with no generation demand is a lecture; the poor learners in Chi et al. studied the same examples.

Drop back **exactly one rung, for that concept only**, if accuracy falls below 70%. **A global "difficulty level" is forbidden** — it strips scaffolding from concepts the learner has never learned.

**What replaces the grid until rung 4:** (a) six ordered hand classes — pairs, suited aces, suited broadways, suited connectors, offsuit broadways, everything else; (b) three verbal threshold rules per position, each ≤12 words (*UTG: "all pairs 66+, suited A-x and suited broadways, KQo/AQo+"*); (c) **all mixed frequencies rounded to pure**; (d) drills on only the ~10–15 boundary combos per position that actually flip the decision — KJo/KTs/A9o/QTo/66/54s at the edges. The other ~150 cells are trivially in or trivially out and carry no information.

---

## Feedback law

### Severity tiers — reach-weighted, anchored to published landmarks

| tier | RW (bb/100) | anchor | action |
|---|---|---|---|
| **T0 FREE** | < 0.1 | = 1 mbb/g, the exact threshold at which HULHE is defined "essentially solved": ~61M hands in a human lifetime, per-hand SD ~5 bb, 1.64σ ⇒ statistically indistinguishable from exact (Bowling, Burch, Johanson & Tammelin 2015, [verified]; Cepheus reached 0.986 mbb/g) | **never surfaced, ever.** Not logged as a leak. Not counted in the tag histogram. |
| **T1 NOISE** | 0.1 – 1.0 | below the resolution of anything a learner can act on | logged silently; appears only as an aggregate in the weekly batch report |
| **T2 LEAK** | 1.0 – 5.0 | 5 bb/100 = 50 mbb/g, the professional-edge benchmark used in the Cepheus and DeepStack papers | end-of-block 3-element correction; **fires the contrast-set generator**; enters the spacing queue |
| **T3 SEVERE** | 5 – 20 | 8.8 bb/100 = the entire HULHE dealer positional advantage (bounded 87.7–89.7 mbb/g, [verified]); ~14.7 bb/100 = Libratus's whole margin over four top-10 HUNL specialists (Brown & Sandholm 2018, venue [verified], the 147 mbb/hand figure [verified] from the NeurIPS/IJCAI companions) | **in-hand interrupt.** Correction now, immediate re-serve of the class inside this block, scheduled re-serves at day 2 and day 7 |
| **T4 CATASTROPHIC** | > 20; hard-block > 75 | 75 bb/100 = 750 mbb/g = the cost of **folding every hand** in HUNL | block, rewind, force re-decision after a worked example |

**Two overrides.**

1. **Magnitude flag.** If ΔEV ≥ 3.0 bb at a single node, the correction enters end-of-block review even at T1 — otherwise reach-weighting silently swallows a 1,100 mbb river blunder occurring 0.8% of the time. Display it as the learner's own arithmetic lesson: *"costs 1,100 mbb when it happens; happens 0.8% of hands; 9 mbb/g; T1 — study this last."*

2. **Right-for-the-wrong-reason override.** ΔEV = 0 with a broken reason line **breaks silence unconditionally and is treated as T3.** This is the only case where silence actively installs a false rule, because the correct action, the verdict, and the chip result all confirm it. A learner who folds A5o on K72r saying "ace-five is trash" will fold A5s on 963ss for the same reason. This correction outranks any −1 bb error, and human coaches skip these hands because they look clean.

### The silence rule

Declare it verbatim on day one: **"No comment means your decision cost under 0.1 bb/100. Silence is not praise."**

Stay silent when: (a) RW < 0.1 bb/100 and the action class is right; (b) the baseline is genuinely mixed and the learner picked a branch with meaningful frequency; (c) the learner is mid-session and tilted — log it for review instead. Break silence unconditionally on right-for-wrong-reason.

Undefined silence gets read as approval or as inattention; a declared convention makes silence carry information. And correcting a 0.2 bb deviation is not neutral — it destroys the magnitude signal the learner needs to prioritise, and burns attentional budget the next decision needs.

### The correction: exactly three chunks, ≤60 words, task as grammatical subject

Pure short-term storage is about 4 chunks once rehearsal and long-term chunking are controlled (Cowan 2001, [verified]). The board, the holding, and the action already occupy that buffer. Exceeding capacity does not slow encoding — it **silently truncates** it, and the learner reports understanding because the last sentence is still fluent.

**Template, enforced by string length:**
1. **Principle name**, ≤5 words.
2. **The range/board consequence**, one sentence.
3. **The boundary** — the nearest hand that flips the answer, and the *one* variable that flips it.

Then stop, mid-thought if necessary. Second-order caveats go behind a learner-requested expansion.

> *"Opening range too wide for early position. From UTG you play through five opponents, so you need hands that flop well against strong continuing ranges — KJo is dominated by every hand that calls you. Boundary: KQo opens, KJo folds; the flipping variable is one seat of position — KJo opens from CO."* — 52 words, 3 chunks. Do **not** add blockers, ICM, or that the fold is close at 40bb.

**Every correction ends with a next action, not a verdict:** *"Re-run this node with the offsuit version"* / *"Drill the 12 boundary combos in this class."*

**Ban list, enforced by lint on the feedback string table.** Target: 100% of feedback strings have the HAND, the RANGE, or the DECISION as grammatical subject — never the player. No "you're too loose", no "you're a nit", no "you're improving", no leak-personality labels, no streak counters on results, no leaderboards, no percentile ranks. **No praise attached to a correction** — "nice read, but…" displaces the task information and the "but" clause is the part that gets dropped.

The mechanism: feedback effectiveness decreases as attention moves up the control hierarchy from the task toward the self (Kluger & DeNisi 1996, paper [verified]; the d ≈ .41 and ~1/3-harmful figures [recalled]). Quantified at educational scale: 994 effect sizes, 435 studies, N > 61,000, random-effects **d = 0.55** [0.48, 0.62], **17% of effects negative**, d = 0.48 after trimming 3.5% extremes — and **86% of the negative motivational effects came from uninformative reward/punishment** (Wisniewski, Zierer & Hattie 2020, [verified]). Their type gradient *is* the feedback design: reinforcement/punishment d = 0.24 (k=39), corrective d = 0.46 (k=238), high-information d = 0.99 (k=42), Q_B = 41.52, p < .0001. **Use d = 0.48 as the planning estimate, not the 0.79 from earlier meta-synthesis.**

### Error taxonomy — 7 tags, fixed, upstream wins

`RANGE · TEXTURE · PRICE (pot-odds/MDF/alpha) · BLOCKERS · SIZING · DEPTH-POSITION · PURITY (off-support)`

When two tags apply, emit the **upstream** one: RANGE > TEXTURE > PRICE > BLOCKERS > SIZING. Attributing to the downstream symptom trains the wrong repair. Leak reports aggregate by tag only — *"SIZING: 1.9 bb/100 across 340 decisions"* — never by trait.

### Confidence routing (2×2)

| | correct | error |
|---|---|---|
| **SURE** | principle name only, no elaboration | **highest-value event in the system.** Full causal chain: *"You were sure. You were wrong. Here's the variable you didn't weigh."* Immediate re-serve of the class + scheduled at day 2 and day 7. Raise difficulty. |
| **GUESS** | **full elaboration** — this is the lucky guess that inflates every accuracy metric | terse correction; re-serve the **worked example**, not more words; higher repetition count |

SURE-error rests on hypercorrection: errors held with high confidence are corrected more readily and more durably (Metcalfe 2017, paper [verified]; hypercorrection specifics [recalled] from the review's known content). GUESS-correct rests on the finding that feedback's retention benefit is **concentrated on responses that were correct but held with low confidence** — feedback works substantially by correcting metacognitive errors (Butler, Karpicke & Roediger 2008, [verified]). Caveat: that finding is on verbal multiple-choice retention; transfer to procedural poker decisions is an assumption.

**Remediation queue is ranked by confidence × RW**, not RW alone. A 2 bb error the learner was certain about outranks a 4 bb error they flagged as a guess.

### Mixed nodes: two channels

**Channel A, SUPPORT** — is the chosen action one the solver ever takes here? Off-support is a real ΔEV and tiers normally.
**Channel B, WEIGHT** — scored at exactly **zero**, with one line: *"the solver mixes here because these actions are worth the same; your split cannot cost you EV against a balanced opponent."*

**Beginners are taught purified, and told the frequency was discarded on purpose.** In Leduc Hold'em the best *unpurified* abstract strategy lost 43.8 mb/h to a full-game equilibrium; after purification the best lost **1.86 mb/h**, and 14 of 24 purified strategies beat the best unpurified one; the program using purification won the 2010 ACPC two-player no-limit total-bankroll division (Ganzfried, Sandholm & Waugh 2012, [verified]). Mixing weights are the most abstraction-overfit part of a solve. Honest caveat from the same table: purification is **non-monotone on the exploitability axis** — Hyperborean went from 235.2 mbb/h unrounded to **437.2** purified, monotonically worse. Purification cuts EV loss against a fixed strong opponent and can nearly double worst-case exploitability. For a beginner whose own baseline exploitability is enormous, that trade is free.

**Mixing is introduced only after pure play holds 90% across three sessions.** Adding a 70/30 split to a learner who has not encoded the threshold is guidance added ahead of the schema it modifies — expertise reversal in its purest form — and it converts a learnable verbal rule back into an unlearnable table.

### Immediate vs delayed — the call, and what was dropped

The literature is genuinely split and anyone asserting otherwise is overreading: immediate error flagging gives the fastest learning rate and least time on task (Corbett & Anderson 2001, existence [verified], condition means [recalled]); the delay-retention effect favours delay (Kulhavy & Anderson 1972, [verified]); and the timing × complexity interaction was **non-significant** in the meta-analysis (Van der Kleij et al. 2015, [verified]).

**Resolution, on a mechanism rather than a vote:** delayed feedback reduced accuracy in **information-integration** category learning while having **no effect** on rule-based learning, and model fits showed the decrement came from learners **falling back on rule-based strategies** (Maddox, Ashby & Bohil 2003, [verified]). Board texture, range role, and deviation decisions are integration categories. The fallback failure mode for a poker student is literally "he's a fish so I'll play loose" — the aggregate-stat error this whole design engineers against.

| content type | timing |
|---|---|
| PLM blocks, new concepts (rungs 0–2), read classification, gate checks | **immediate**, ≤500 ms |
| fading rung 4, gift ledger, nodelock derivation (genuinely rule-based) | **batched** to end of set |
| assessment mode, decay probes | **withheld entirely** |

**Dropped:** the delayed-feedback-for-retention prescription as a global default. Its main mechanism is spaced re-presentation, which this design buys separately and explicitly in the spacing schedule — so there is no reason to pay for spacing with delay. Instrument delayed-retention accuracy per concept and let your own data adjudicate.

### No verbalisation during PLM blocks

No think-aloud, no written justification, no coach commentary mid-block. A concurrent numerical Stroop task dramatically impaired learning of simple explicit rules but did **not** significantly delay learning of complex integration categories (Waldron & Ashby 2001, [verified]) — read in reverse, engaging the verbal system biases learners toward rule strategies, which is Maddox's failure mode on integration structures. Instruction before a module is a single screen naming the categories with 2–3 anchor exemplars. Full theory arrives after fluency. Explicit verbal scaffolds are legal in the review phase only (see the encoded-hand recall drill: show a 4-street hand for 8 s, reconstruct `node → capped/uncapped → texture class → role → size → nut-changing cards`; pass = all six slots without the specific cards).

---

## The learner model

### The observation unit is the decision node

The repo's `HandRecord` (`/Users/pranavgk/Documents/temp1/poke/src/core/session.ts:17`) logs at hand granularity with `net` as a first-class field. Both are wrong: one BB-defence hand generates 3–6 observations, and `net` must not exist in the learning-mode schema at all.

```ts
interface DecisionRecord {
  id: string; sessionId: string; ts: number;
  mode: 'practice' | 'assessment' | 'plm' | 'wholetask';

  // node
  nodeKey: string;           // positions × action-history × board-class × size-bucket
  spotClass: string;         // never shown pre-commit
  street: 'pre'|'flop'|'turn'|'river';
  stackBb: number; potBb: number; toCallBb: number;
  hole: Card[]; board: Card[];
  reachProb: number;         // P(node | hand dealt) — MODEL-DEPENDENT, log which bot population
  kcs: string[];             // 4–8 KC ids
  difficultyTier: 1|2|3;
  evSpreadBb: number;        // best − worst: routes correctness vs frequency queue

  // commit — all captured BEFORE any reveal
  classifyTag: string; classifyCorrect: boolean; classifyMs: number;
  action: Action; sizeBb?: number;
  confidence: 'sure'|'guess';
  reasonText: string; reasonRefs: 'range'|'price'|'hand-strength'|'none';
  commitMs: number;
  freqEstimate?: {a: string, p: number}[];   // frequency-queue nodes only

  // grade
  evChosenBb: number; evBestBb: number; deltaEvBb: number;
  rwBb100: number;           // deltaEvBb × reachProb × 100  ← tiers on THIS
  onSupport: boolean;
  tier: 0|1|2|3|4;
  tag: ErrorTag | null;      // exactly one, upstream wins
  magnitudeFlagged: boolean; // deltaEvBb >= 3.0

  // read channel
  forecast?: {fold: number, call: number, raise: number};  // clamped [0.02, 0.96]
  forecastActual?: 'fold'|'call'|'raise';
  brier?: number;            // Σ(p_k − o_k)², range 0–2
  logScore?: number;         // −ln p_actual, nats
  nodeBaseRate?: {fold:number,call:number,raise:number};   // the ONLY baseline that counts

  // feedback audit
  fadingRung: 0|1|2|3|4;
  correctionShown: boolean; correctionWords: number; hintRequested: boolean;
  gateAttempts: 0|1|2;

  // provenance
  solverConfigId: string;    // if two configs disagree here → surface the disagreement, don't pick
  abstractionSensitive: boolean;
}
```

**Deliberately absent in learning mode:** `chipsWon`, `net`, `sessionPnl`, `allInEV`, `streak`, `rank`.

### Blame assignment by counterfactual solver ablation

Replay the hand holding the learner's decision at node *i* and substituting the solver's decision at every other node; read off exactly how much of total EV loss is attributable to node *i*. **This is poker's structural advantage over every other tutoring domain** — standard multi-skill credit assignment in ITSs is guesswork (blame all KCs compensatorily, or blame the weakest conjunctively; both are inference).

Two rules. **Never distribute a hand's total EV loss uniformly across the KCs it touched.** And **score each node against the solver's continuation from the *actual state reached*, not against the solver's own on-path frequencies**, or preflop errors get double-charged to postflop KCs.

Worked: BB 8h7h vs BTN 2.5x; BTN c-bets 33% on Jc8d3s; BB calls; turn 5c; BTN bets 75%; BB folds. Four observations. The leak localises entirely at the turn-fold node across `MDF-vs-75%-turn`, `turn-card-classification (5c is a blank)`, and `alpha (75% pot ⇒ BTN needs 43% bluffs, so second pair is above indifference)`. Because `indifference` is a Layer-2 principle also implicated by river bluff-catch errors, **one turn fold moves the estimate for river bluff-catching too** — that cross-node coupling is the entire reason to have a KC model rather than a chart. Had the learner folded 8h7h *preflop*, all loss belongs to the preflop KC and the turn KCs never got an opportunity.

### The ghost-fold bucket

Folds are 55–70% of preflop decisions and yield **zero** natural feedback — the censored-action problem, where your action determines whether you observe the outcome, so an invalid rule can look valid forever (Einhorn & Hogarth 1978, [verified]). Over-folding is therefore self-sealing: it never generates disconfirming evidence.

Every fold silently runs the counterfactual and accumulates into a **node-level aggregate reported only at n ≥ 50**: *"your BB-vs-BTN folds cost 3.1 bb/100 versus baseline."* **Never per hand.** *"You folded 76s and would have flopped a straight"* is the single most destructive string the app could emit — it teaches loose calling from n = 1.

### The model: PFA over a KC graph

```
logit P(ΔEV < 2% pot at node) =
    θ_learner
  + Σ_{k ∈ KC(node)} [ β_k + γ⁺_k · successes_{s,k} + γ⁻_k · failures_{s,k} ]
  − δ_node
  − λ · days_since_last_opportunity_k      ← forgetting term, added by hand
```

Fit nightly by L-BFGS. Per-KC difficulty β_k, per-KC learning rates split by success/failure, learner random effect, item difficulty δ_node seeded from `−log(solver EV spread)` plus street and stack-depth terms, then overwritten from data.

**Guess floor computed analytically and passed in FIXED, not fitted**, from the solver's action-EV spread under a measured passive-beginner action prior. Free-fitting is non-identifiable — multiple parameter sets fit the data equally well while implying substantially different mastery times (Beck & Chang 2007, [verified]) — and in poker it is doubly degenerate because solver mixing gives a genuinely high floor. Cap any fitted noise term at 0.3; if a KC's fit demands more, that is evidence to **split the KC**.

**Why PFA and not BKT or DKT.** Every poker hand touches 4–8 KCs; PFA handles multi-KC items natively (Pavlik, Cen & Koedinger 2009, [verified]) while BKT is single-KC-per-item by construction. Logistic regression with the right features wins on datasets of moderate size or very high interactions-per-student, DKT wins only at large scale, and Markov approaches lag both (Gervet, Koedinger, Schneider & Mitchell 2020, [verified]). And DKT's canonical headline advantage was substantially an artifact: **123,778 of 525,535 rows (23.6%)** in the public ASSISTments 2009-10 set were duplications produced by the multi-skill-to-multi-row transform; splitting predictions gives **AUC 0.97 on duplicated rows vs 0.77 on leading records** — the RNN was memorising repeated sequences, and on the dataset where the artifact is removed PFA performs as well as DKT (Xiong, Zhao, Van Inwegen & Beck 2016, [verified]). Poker, the maximally multi-skill domain, sits squarely in that failure regime. Finally: only the logistic model produces a **per-KC mastery bar you can show the learner**, and that bar *is* the theory instruction — it is what tells them "folds too much to big bets" is one skill expressed at twenty nodes, not twenty charts.

**Cold start.** Sessions 1–3: single-dimension **response-time-weighted Elo** on learner and item simultaneously, score in [−1, 1] signed and scaled by RT so fast-correct > slow-correct > slow-wrong > fast-wrong (Klinkenberg, Straatemeier & van der Maas 2011, [verified]; Math Garden's specific target success rate is [recalled]). Used only to pick difficulty. Hand each KC to its PFA posterior at 5 observations. Keep Elo running permanently as the between-refit estimate of θ_learner. **A single Elo number is orientation, not diagnosis** — a trainer that stops there has shipped a leaderboard.

**Optimise calibration, not AUC.** Every mastery gate is a threshold decision, so ranking quality is irrelevant. Report reliability diagrams and expected calibration error per KC; recalibrate (isotonic) per KC before applying the gate; **reject any model change that improves AUC while worsening ECE in the 0.85–0.95 region where the gate lives.** Models with equal predictive accuracy imply substantially different amounts of required practice under a threshold policy (Rollinson & Brunskill 2015, [verified]). Pool calibration across a KC family when a KC has < 200 held-out observations.

**KC granularity is discovered, not authored.** Plot error rate vs opportunity index per KC monthly; a "KC" whose curve fails to decline is a conflation of several skills with different difficulties (Cen, Koedinger & Junker 2006, [verified]). Split flat curves along the largest residual factor — usually board texture, then bet size, then position. Delete any KC under 10% error on first opportunity; mis-set thresholds waste large amounts of learner time with no learning benefit (Cen, Koedinger & Junker 2007, [verified]).

### Difficulty: two dials, both automatic. The learner never sets it.

**Dial 1 — target success band.** Serve spots where predicted P(no T2+ error) ∈ **[0.75, 0.85]**, recomputed every 20 spots, measured on **novel instances only**. Reading accuracy on repeated instances drifts the learner into a high-scoring non-learning equilibrium.

For a broad class of stochastic-gradient-descent learners on binary classification the optimal training error rate is **~15.87%** (accuracy ~85%), demonstrated on ANNs and biologically plausible models, with learning slower both when training is too easy and too hard (Wilson, Shenhav, Straccia & Cohen 2019, [verified]). The same claim for motor skill: information available in a trial rises with difficulty but *usable* information peaks and then falls, and the peak shifts right as skill grows (Guadagnoli & Lee 2004, [verified]).

Why 0.75–0.85 and not 0.50: selection at the information-theoretic frontier maximises information for the psychometric model and minimises it for the learner; lower-ability and more anxious learners preferentially self-select easier items (Jansen et al. 2016, [recalled]). Violate the band downward **only inside a certification probe**, where you actually need the discriminating information.

**Honest caveat:** the 85% figure is derived for binary classifiers, not for humans making multi-action decisions with mixed-strategy optima. Anchor to instrument and tune, not a law. And the correct error rate at a node with three near-equal actions is *undefined* — which is why dial 2 exists.

**Dial 2 — EV gradient.** Precompute per node `spread = EV(best) − EV(worst)`.
- spread > 1 bb → **correctness queue**
- spread < 0.3 bb → **frequency queue**: the learner states a mix ("3-bet 35% / call 65%") and is scored on distance to the solver mix **over a rolling window of that spot class**, never per instance.

This makes the silence threshold principled rather than arbitrary. Silence means *"this node had no gradient"* — and a node with no gradient should never have been served as a right/wrong question.

**Item difficulty: solver EV spread is a prior, not the answer.** Learner-perceived difficulty diverges systematically — spots where the intuitive-but-wrong action is *very* wrong are easy for the model and hard for humans. Audit the residuals: any hand whose empirical error rate is >2 SD above its solver-derived prior is a **high-value teaching item** and belongs in the curriculum core.

### The four gates

| gate | what it certifies | criterion |
|---|---|---|
| **A — perceptual fluency** | one PLM category | **correct AND under RT threshold.** 8/10 (P4, P6) or 9/10 (P0, P1, P2, P5, P7). Resurrect at 1 week and 1 month. |
| **B — KC mastery** | one knowledge component | posterior mean P(ΔEV < 2% pot on a fresh item) ≥ **0.90** AND 90% CI lower bound ≥ **0.85** AND ≥ **12 opportunities** AND items span ≥ 3 difficulty tiers with ≥ 2 of the last 8 from the hardest. **Hard cap 25 opportunities**: on cap, **freeze the KC**, surface the error signature (*"you folded to 65%+ pot bets on 71% of turn nodes where MDF is 57%"*), route to a worked-example unit — **never another rep.** Re-test at 7/21/60 days with one hardest-tier item; a miss demotes to 6 remaining opportunities, not a reset; a **2× response-time slowdown at correct** schedules an extra review. |
| **C — delayed unannounced novel-instance test** | one concept | ≥ **85% action-AND-reason** accuracy on never-seen instances across **3+ spaced sessions**, with ≥1 measurement **≥7 days** after last exposure, **no advance warning**. |
| **D — exploit unlock** | one exploit twin | GTO twin mastered at the same node (Gate B) + baseline criterion (§ exploitation gate) + `n ≥ 20` observations of that exact node + observed frequency ≥ **15 points** off baseline. Magnitude = `w × full_exploit`, `w = n/(n+10)`. |

**Why Gate B is 0.90, not Corbett & Anderson's 0.95** ([verified] for the original 0.95 criterion): the binarised signal carries irreducible noise from solver mixing and abstraction error, and a 0.95 gate on that signal produces **wheel-spinning** — the learner grinds a KC indefinitely because the estimator cannot clear the bar (Beck & Gong 2013, [verified]; the prevalence percentages are [recalled]). Repeated failure is evidence the *instruction* was wrong. The asymmetry deliberately favours slight over-certification: the spaced re-test catches it, the EV cost of a false certify is bounded, and the cost of a false non-certify is the learner quitting.

**Gating on "N correct in a row" is forbidden** — noise-sensitive and demonstrably less equitable than model-based tracing (Doroudi & Brunskill 2019, [verified]), and it interacts catastrophically with the high guess floor solver mixing creates.

### The four numbers on the scoreboard

1. **Graded decisions this week** (target 200+).
2. **RW EV loss, bb/100 — ASSESSMENT MODE ONLY.**
3. **Fluent categories** — count passing Gate A.
4. **SURE-wrong count** this week.

Nothing else. No chip graph, no practice-mode bb/100, no leaderboard, no streak on results, no XP.

**Assessment mode, weekly:** 30 interleaved spots, no coach, no equity display, no feedback until the end, classes drawn from ≥7 days earlier. Performance during acquisition is an unreliable index of learning and some manipulations move the two in *opposite* directions (Soderstrom & Bjork 2015, [verified]; Schmidt & Bjork 1992, [verified]). In-trainer accuracy rises fastest under exactly the conditions — blocked, cued, feedback-rich — that hurt retention. Assessment scores will be visibly worse than practice scores and will demotivate unless framed up front: **the delayed test is the real one.**

**Two headline metrics, neither sufficient alone.** RW EV loss measures GTO adherence — a learner can drive it near zero and exploit nobody. The opponent-action **Brier score benchmarked against the node base rate** measures reads. Brier decomposes as reliability − resolution + uncertainty (Murphy 1973, [verified]): reliability is "my 70%s happen 70% of the time"; resolution is "I say different numbers in different situations, i.e. I actually know something." **Benchmarking against uniform (0.667 for three categories) is arithmetic; only beating the node base rate is a read.** A learner with perfect reliability and zero resolution is a base-rate parrot and must be told so. Run log score `−ln p_actual` clamped to [0.02, 0.96] as secondary — assigning 2% to an action that occurs costs 3.9 nats versus 0.71 for a fair 49%, which is exactly the lesson a beginner who says "he never bluffs there" needs (Brier 1950, [verified]).

**Do not show the calibration curve before 400 forecasts.** At p ≈ 0.7 you need ~80 forecasts inside a bin to resolve a 10-point miscalibration at 95% confidence; a 5-bin curve needs ~400. Showing one earlier teaches the learner to over-read noise in their own noise-reading.

### Promise a criterion, not a rank

*"You will get your baseline RW EV loss under X bb/100 in assessment mode."* Never promise professional earnings or elite ranking — the individual-differences literature does not support it for any given learner, and that promise is the main credibility leak in poker pedagogy.

Calibrate your own expectations at **d ≈ 0.5–0.8** on a held-out EV-loss benchmark against a self-study control, with **time-to-criterion as a co-primary outcome**, and **expect zero measurable effect in the first weeks**. Bloom's 2-sigma figure rests on small dissertation studies ([verified]); the review record puts human tutoring at **d = 0.79** and intelligent tutoring systems at **d = 0.76** — granularity of interaction, not human-ness, is the operative variable (VanLehn 2011, [verified]); and the Cognitive Tutor Algebra cluster-RCT across seven states found **nothing in year 1** and roughly **eight percentile points in year 2**, significant for high schools only (Pane, Griffin, McCaffrey & Karam 2014, [verified]). A 2-sigma prior guarantees you read a genuine success as a failure and thrash the design. Note also the shape of the gain: the PUMP/PAT deployment beat comparison classes by **15% on standardized tests and 100% on tests targeting the curriculum's own objectives** (Koedinger, Anderson, Hadley & Mark 1997, [verified]) — mastery-gated tutoring moves the targeted construct far more than it moves generic transfer measures.

### Practice opponents

Rule-based, human-calibrated archetypes — never a dialled-down solver. Weakening a strong engine does not produce human-like play: depth-limited Stockfish predicts human moves *better* the stronger the version, for players of almost all skill levels, and Leela's best move-matching was 46% and flat across skill levels, while skill-targeted models hit 46–52% each peaking near its own training band (McIlroy-Young, Sen, Kleinberg & Anderson 2020, [verified]). An artificially loosened GTO bot teaches exploits nobody offers.

`/Users/pranavgk/Documents/temp1/poke/src/core/ai.ts:48-51` already has the right shape — `nit` (callStrength .68, bluffRaiseFreq 0), `tag`, `station` (loosecallFreq .85). Two changes: **jitter the profile parameters within a band per session and hide the archetype label until after the hand** (or the learner overfits to three fixed caricatures instead of learning to classify), and add the missing three archetypes plus a `TAG-reg` the learner is scored for **not** deviating against.

**Log novelty explicitly** — actions the learner had never taken in that spot class. Across 5.8M professional Go decisions over 71 years evaluated with 58 billion counterfactuals, human decision quality improved significantly after superhuman AI appeared, **mediated by an increase in previously unobserved moves** (Shin, Kim, van Opheusden & Griffiths 2023, [verified]). Exploration is the mediating variable, so instrument it. Related existence proof for the solver-as-concept-source role: AlphaZero concept vectors filtered for teachability improved all four grandmasters they were presented to (Schut et al. 2025, [verified]; small-N proof of concept, not an efficacy trial).

---

## Hours 1–10 for a true beginner

Absolute ordering principle: **charts last.** Preflop charts are unidimensional, verbalisable, rule-based structures — the cheapest thing to learn, the least transferable, and teaching them first biases the learner into the verbal/explicit system, which is precisely the strategy that degrades information-integration learning.

| hour | content | not shown |
|---|---|---|
| **1** | 0:00–0:05 the only lecture in ten hours: rules, betting order, hand rankings, one screen. 0:05–1:00 **PLM-0**, ~380 trials, RT-adaptive, min lag 3, immediate label feedback, target median 1.5 s. **Fix the visual layout now and never change it** — card art, seat positions, stack display; changing layout between drill and play forfeits part of the parafoveal gain. | any chart, any range grid, any equity %, any solver frequency, any bet size, position theory, the words "GTO"/"range"/"polarity", any chip count |
| **2** | 0:00–0:20 PLM-0 to Gate A (9/10 < 2.0 s). 0:20–0:40 **PLM-1a** pairedness (K72r / 992r / 777). 0:40–1:00 **PLM-1b** connectivity (K72 / J93 / 987 / T98-with-straight). | **what any of this is for.** No strategic implication is attached to a label yet. |
| **3** | 0:00–0:15 **PLM-1c** suitedness (K72r / Kh7h2c / KhJh4h). 0:15–0:35 **PLM-1d** high-card class (A83 / K72 / QJ4 / 962 / 764). 0:35–1:00 **PLM-1e overpair-availability** — 764r → 88–AA yes; QJT → only AA/KK, almost none. | same |
| **4** | 0:00–0:35 **PLM-2** STATIC / SEMI / DYNAMIC, target 900 ms, **with near-miss pairs differing in exactly one card** (K72r vs 972r, 765ss vs 765r) — this trains dimensional attention, which is the substrate of a read. 0:35–1:00 **PLM-5** blockers y/n, target 800 ms. | same |
| **5** | **The only theory hour before hour 14. Zero hands played.** 0:00–0:20 pot odds in **natural frequencies** ("pot 20, bet 10 — you put in 10 of 30, so you need to be right 10 times in 30"), then MDF, then alpha. 0:20–0:40 **the variance module**: run the target win rate through 1,000 simulated 10,000-hand samples and show the trajectory fan with the ~31% of paths ending below zero highlighted, then the table below. 0:40–0:55 the two studies side by side. 0:55–1:00 the hard rule. | any strategy content |
| **6** | 0:00–0:10 one screen: what a range is, what "capped" means, three anchors. 0:10–1:00 **PLM-3** nut-advantage direction, ~400 trials, target 1.5 s. **Never a board without its node.** | charts, frequencies |
| **7** | 0:00–0:05 the 7 role labels, 2 anchors each. 0:05–1:00 **PLM-4 blocked micro-block**, ~250 trials, one node type at a time. **Blocked is correct here and only here** — massed presentation supports discovering what members of one category share; interleaving supports what separates them (Carvalho & Goldstone 2013/2014, [recalled] mechanism; the block-then-interleave *ordering* is an inference from titles plus Brunmair's moderators, so treat the trial count as arbitrary and the defensible claim as "brief blocking on introduction, interleaving thereafter"). | charts |
| **8** | 0:00–0:30 **PLM-4 fully interleaved** across ≥8 node types, forcing role consistency across dissimilar holdings. 0:30–0:34 **the first verbal strategy rule, ≤12 words, taught explicitly before exposure**: *"BB vs 2.5x BTN open: defend about 62%, 3-bet about 11%, fold the rest — pot odds 3.5:1 needs 22% equity plus a realisation discount."* 0:34–1:00 first graded block: 10 spots, blocked on BB-vs-BTN, full 5-state protocol, fading rung 0→1. | the 13×13 grid, mixed frequencies, any solver %, chip results |
| **9** | Standard 50-minute session, first run. 20 interleaved spots across ≥7 classes, depths 40/100/200, confidence tagging on, contrast generator fires on the top 2 errors. Expect in-session accuracy 55–65%. **Pre-frame in writing before the block starts.** | same |
| **10** | 0:00–0:30 **first assessment block**: 30 interleaved spots, no coach, no equity, no feedback until the end. This is the baseline every future number is compared against. 0:30–0:50 **set up the mandatory debiasing A/B** (below). 0:50–1:00 state the epistemology out loud. | everything in the "still not shown" list |

**Why the rule is taught before exposure in hour 8.** People do not converge on probabilistic rules from outcome feedback — they hypothesise *deterministic* rules and treat each disconfirmation as grounds to switch, so noise causes rule-thrashing rather than rule-refinement, and additional trials do not rescue it (Brehmer 1980, [verified]). **"Play 500 hands of this spot and you'll get a feel" is a null instruction.** But the rule taught must be the *reason*; the frequency is a consequence the learner should re-derive.

**Hour 5's variance table** (σ ≈ 100 bb/100 for online 6-max NLHE — **empirical from tracking-software databases, NOT peer-reviewed; every figure below scales linearly in σ**). SE of win rate = 100/√(N/100) bb/100:

| N hands | SE (bb/100) | P(a true 5 bb/100 winner is in the red) |
|---|---|---|
| 1,000 | 31.6 | 44% |
| 10,000 | 10.0 | 31% |
| 100,000 | 3.2 | 5.7% |
| 1,000,000 | 1.0 | ~0% |

CI excluding zero for a true 5 bb/100 edge: **~154,000 hands**. 80% power: **~314,000**. Win rate to ±1 bb/100: **~3.8 million**. A 200-hand session has 1σ = **±141 bb**, so a two-buy-in losing session is a routine ~1.4σ event occurring in **~8% of sessions at zero EV loss**. Teach this by simulated sequences, never by a standard deviation: experiencing sequentially simulated outcomes from a known model produces markedly better inference than reading the model's summary (Hogarth & Soyer 2011, [verified]), and applied economists shown standard regression tables badly overestimated predictability until given a scatterplot (Soyer & Hogarth 2012, [verified]). Frequency-format training taught Bayesian reasoning in under two hours with retention that persisted where probability-format training decayed (Sedlmeier & Gigerenzer 2001, paper [verified], the 5- and 15-week intervals [recalled]).

**Hour 5's worked power-failure lesson.** 300 participants, 60 hands each, card distribution experimentally standardised into better/average/worse boxes: experts did **not** out-earn average players, and the authors concluded "card distribution was the decisive factor" (Meyer, von Meduna, Brosowski & Hayer 2013, [verified]). Against: players identified as skilled **before** the 2010 WSOP returned average ROI **over +30%** versus **−15%** for everyone else (Levitt & Miles 2012, [verified]). Same game, opposite published conclusions, and the resolution is **power, not truth** — 60 hands gives a win-rate SE around 130 bb/100. Supporting: performance in online poker persists across periods across hundreds of millions of player-hand observations, but skill dominates chance only when measured over **1,500+ hands** (Potter van Loon, van den Assem & van Dolder 2015, [verified]). The line to deliver: *"if a 300-person peer-reviewed study cannot detect poker skill in 60 hands, your 60-hand session cannot detect anything about you or your opponent."* And: **experience without informative feedback buys nothing and can cost** — of 62 evaluations of clinical experience, 32 (52%) reported performance *declining* with years in practice on all outcomes assessed, and only 1 (2%) reported improvement on some (Choudhry, Fletcher & Soumerai 2005, [verified]).

**Hour 5's hard rule, enforced by the app:** **no strategy change is ever justified by results below 100,000 hands.** The app refuses to render a bb/100 or $ graph below 10,000 hands and renders only the confidence band above it. Strategy changes come from RW EV loss and node-level opponent-model counts. Full stop.

**Hour 10's mandatory debiasing A/B — both halves required, not one.** Train the K-x boundary family **interleaved** and a matched family (the suited-connector open boundary) **blocked**; unannounced tests at day 7; scores side by side with the concepts named. **Separately**, explain *why blocking felt better* — fluency during study is not retrievability later. Interleaving beat blocking for inductive learning while learners believed the opposite even after experiencing the advantage; experience-based and theory-based debiasing each produced only small gains; **only when the two schedules were tested separately AND both debiasing approaches were combined did a majority recognise the benefit** (Yan, Bjork & Bjork 2016, [verified]). Persistence is attributed to fluency misattribution, prior beliefs, and self-perception as a unique learner. Learners rated massed presentation as more effective than interleaved even *after* their own test scores showed the opposite (Kornell & Bjork 2008, [verified]). **Expect to re-run this, and expect reversion to chart-grinding the moment they feel behind.**

**Hour 10's epistemology, verbatim:** *"Your intuition becomes trustworthy only in spots where you have received solver feedback. In spots you have never had graded, you have no intuition — you have a hunch. Track which node families you have ≥100 graded reps in; those are the only spots where you are licensed to deviate on feel."* The two necessary conditions for valid intuition are an environment of sufficiently high validity **plus** adequate opportunity to learn its regularities, and subjective experience is explicitly not a reliable indicator of accuracy (Kahneman & Klein 2009, [verified]). Poker gives condition 2 in abundance and condition 1 **only** at the decisions-vs-solver level.

**Still not shown at hour 10:** the 13×13 grid · any mixed frequency · any solver % before commit · live equity readout · opponent ranges pre-commit · any chip graph, practice-mode bb/100, leaderboard, streak or XP · any exploit or read-based content · multiway theory · ICM · bankroll management · bet-size trees beyond one size per node.

**Hours 11–20, sketched.** H11–13: PLM-6, PLM-7, and component drills — pot-odds to a number, texture classification, range construction scored by overlap with the solver, sizing with the action pre-fixed — **capped at 40% of weekly graded volume**, because component mastery does not sum to node performance and each scaffold must be retired when its tag-specific error rate drops below ~10%. H14: the preflop rule set, purified, as 6 hand classes + 3 verbal thresholds per position + the ~12 boundary combos per position. H15–20: interleaved graded sessions; the day-7 and day-21 spacing waves land; earliest concepts advance to fading rung 2.

---

## The two-speed architecture (installed, not taught)

**Default:** recognise `node + texture + role`, play the memorised frequency. **Deliberate:** only when a slot is anomalous. PLM-7 drills the trigger detection itself, with an explicit trigger list — off-tree sizing, unfamiliar texture class, stack depth outside trained range, a read that contradicts the frame.

Recognition is what survives time pressure: a top grandmaster's rated strength playing about half a dozen grandmasters simultaneously — seconds per move, almost no look-ahead possible — was only slightly below tournament conditions, so recognition based on stored knowledge accounts for far more of high-level skill than search does (Gobet & Simon 1996 *Psych Science*, [verified]). And the unit is a configuration bound to a functional label, not a fact: after a 5-second view of middlegame positions a master placed ~16 pieces correctly, Class A ~8, a beginner ~4 — but **on randomised positions there was no relation to playing strength and all three did worse than the beginner had on real positions** (Chase & Simon 1973, [verified]). Chunks are few and large: masters reproduced chunks of up to **15 pieces** while replacing **no more than about three chunks** (Gobet & Clarkson 2004, [verified]). There is also a sub-chunk floor — expert advantage on *random* domain material is moderate and significant across domains, which only small memory structures can explain (Sala & Gobet 2017, [verified]), and chess experts beat novices even on randomised positions via superior domain-specific parafoveal vision from familiarity with individual symbols (Bilalić, Langner, Erb & Grodd 2010, [verified]). That is what PLM-0 buys.

**Import the two-speed structure; discard satisficing.** Fireground commanders were right to act on the first workable option (Klein, Calderwood & Clinton-Cirocco 1986, [recalled] — interview-derived, not experimental, in a domain with fast reliable feedback). A poker player choosing the first adequate line forfeits EV and abandons mixed strategies.

**Blueprint + re-solve is the right curriculum shape because it is the architecture every superhuman agent uses.** Give the learner exactly **one** memorised artifact — a coarse preflop blueprint, reached on 100% of hands, mostly pure, cheap to verify — and teach everything from the flop onward as re-solving from principles. When an opponent uses an off-blueprint size, the correct behaviour is to **re-reason, not to snap the size to the nearest chart entry**; Libratus's entire third-street-onward architecture exists to avoid exactly that snapping, re-solving in response to every off-tree opponent bet ([verified]). The licence for a coarse blueprint is the value/strategy asymmetry: in No-Limit Flop Hold'em an abstraction **0.02% of full size** produced a P1 strategy exploitable for 112 mbb/h yet estimated the game value at **35 mbb/h against a true 37** — "a very poor estimate of the strategy, a good estimate of the value" (Brown & Sandholm 2017, [verified]). **Making the memorised blueprint finer directly cannibalises the re-solving skill that is the actual target.**

**The core robustness drill, and it is Pluribus's own mechanism.** *"Here is the spot. Evaluate your line against four opponent continuations — equilibrium-ish, fold-biased, call-biased, raise-biased."* A line best against exactly one and bad against the others is a leak; a line fine against all four is robust. This teaches exploitability intuition with zero exploitability computation. In imperfect-information games a state has no well-defined value, so perfect-information-style search is broken; the fix is to let the opponent choose among several continuation strategies at the leaf, and Pluribus instantiates exactly **k = 4** (blueprint plus fold-, call- and raise-biased) (Brown, Sandholm & Amos 2018, [verified]; Brown & Sandholm 2019, [verified]). The efficiency payoff is the proof it matters: Modicum used ~700 core hours on a 4-core CPU with 16 GB and beat Baby Tartanian8 by **6 ± 5** and Slumbot by **11 ± 9** mbb/g, while **naive single-value depth-limited solving LOST to BT8 by 10 ± 8** — the multiple-continuation mechanism flips the sign. Label the drill a heuristic, not a bound; DeepStack's own authors note that sparsening the lookahead tree "voids the soundness property of Theorem 1" ([verified]).

**Never label multiway output "GTO" or "unexploitable."** Independently computed equilibria do not compose with 3+ players (the Lemonade Stand Game: infinitely many uniform-spacing equilibria, independent selection almost surely not an equilibrium), finding one is at least as hard as two-player general-sum, and **CFR has no convergence guarantee outside two-player zero-sum** — Pluribus explicitly abandons equilibrium as the goal (Brown & Sandholm 2019, [verified]). Call it "strong empirical baseline." It still *worked*: **48 mbb/game (SE 25, p = 0.028)** over 10,000 hands versus five elite pros, and **32 mbb/game (SE 15, p = 0.014)** in the 1-human-5-AI format.

**Frame equilibrium correctly: it caps your losses; all profit comes from opponent error.** Pluribus's own text notes the RPS equilibrium "guarantees that the player will not win in expectation." A curriculum that presents GTO as the destination has removed the entire source of EV.

---

## The exploitation ladder

Exploitation is not "GTO plus reads." It is a second curriculum with a different oracle (node-locked best response), a different loss function (exploitation minus added exploitability), and catastrophically worse data.

**The spine is one asymmetry nobody teaches: you need ~20 observations to licence a deviation, the opponent needs ~4 to detect it, and a specific river node arrives 3.6 times in a 300-hand session. The entire edge is in the cap and the revert.**

### The gate — three conditions, all measured

**G1 — Baseline RW EV loss < 1.5 bb/100 in assessment mode** (30 interleaved spots, classes ≥7 days old, no coach, no equity, no feedback until the end). Not motivational gatekeeping: the plain equilibrium baseline CFR5 averages **+56 mb/h** across an 8-opponent crosstable while every frequentist best response except one averages *negative* ([verified]). If the learner's baseline is worse than that, the honest recommendation is "fix the baseline, that's where the money is." And frame the budget as **added** exploitability on an already-leaky baseline, not a fall from perfection: with 97.5% confidence, every evaluated no-limit ACPC bot was exploitable for over **3,180 mBB/h** — more than **4×** the 750 mBB/h cost of folding every hand (Lisý & Bowling 2017, [verified]). **A Local Best Response result of zero means "no exploit found," never "unexploitable"** — it is a lower bound, and against a bot with unabstracted cards and sparse betting a full best response found 90 mBB/h where LBR itself lost 536.

**G2 — Frequency literacy, not action literacy.** A deviation is *defined* as a delta from a baseline frequency, and the gift condition is uncheckable without one. Flash-drill frequencies **with their breakeven twins**:

| node | baseline frequency | its breakeven twin |
|---|---|---|
| villain folds to 50%-pot river bet | 33% | your bluff breaks even at exactly **33%** (bet 10 into 20) |
| villain folds to 33%-pot flop c-bet | ~45% | your bluff breaks even at 25% |
| you call a 50%-pot river bet | need 25% equity | he must bluff ≥33% for the call to profit |
| BB defends vs 2.5x BTN open | ~40% | 3.5:1 needs 22% equity + realisation discount |

Row 1's coincidence is the load-bearing teaching moment: **at an indifference node the baseline frequency equals the exploit's breakeven frequency**, which is why shrinkage alone is not a safety mechanism.

**G3 — The baseline is the prober, and it needs time to gather.** Among strategies of equal game-theoretic value some explore the opponent better, and stronger Nash strategies (γ > 0.7) explored more effectively ([verified]). But DBBR ran **1,000 hands of pure equilibrium play** before switching exploitation on and **still** saw its win rate decrease significantly for the first several hundred hands against two opponents, because equilibrium play left parts of the tree unexplored ([verified]). So: **minimum 1,000 hands of baseline play against the population** before the module unlocks, and **minimum 50 hands** against any individual villain before the first deviation — the switching point that was robust to game length and opponent across the whole opponent range in Kuhn poker ([verified]).

**What the gate deliberately does not require:** solver mastery of the node, tournament results, or a bankroll threshold. Those are traditions.

### Observation → belief

**Step 1: the arithmetic nobody does.** Hands needed with **one specific villain**:

| observable | occurrences/hand | n=10 | **n=20** | n=40 |
|---|---|---|---|---|
| **T1** VPIP opportunity | 1.000 | 10 | **20** | 40 |
| **T1** faces *any* flop c-bet (pooled) | 0.077 | 130 | **260** | 519 |
| **T2** you in BB facing his BTN open | 0.041 | 242 | **484** | 969 |
| **T2** villain in BB facing your BTN c-bet (that node) | 0.0165 | 606 | **1,212** | 2,424 |
| **T3** faces *any* river bet (pooled) | 0.012 | 833 | **1,667** | 3,333 |
| **T3** faces your turn barrel (that node) | 0.0054 | 1,852 | **3,704** | 7,407 |
| **T3** faces your river bet (that node) | 0.0015 | 6,667 | **13,333** | 26,667 |

**Print this. Gate progression on reproducing the n=20 column.** The consequence they will hate: **in a 300-hand session you get exactly one tier of read — T1, plus maybe pooled fold-to-c-bet.** The node-specific river read they most want does not exist and will not exist. This is the human-scale version of the researchers' own wall: FBR typically used **5 million** training hands (usable down to 1 million) and RNR degraded below **100k** observations ([verified]).

Pooling is the only escape and it has a real cost — it reintroduces exactly the bias per-information-set confidence was built to remove. Teach it as a declared bias-variance trade: *"pooled fold-to-c-bet tells you he over-folds somewhere; it does not tell you he over-folds on K72r from the blinds, and deviating at the wrong node is where the loss lives."*

**Ban aggregate stats as licences.** A gift is formally a strategy that is not a best response to *some* equilibrium strategy of the other player, and safe exploitation is possible **iff** such gifts exist (Ganzfried & Sandholm 2015, Def. 5.2, [verified]). So the learner must name an **action-with-a-holding**: "he called 7 into 20 on the river with third pair, no draw." "His VPIP is 38" identifies where to look and licenses nothing.

**Declare the showdown bias.** Gift evidence accrues only from hands that reached showdown, which over-samples his calling range and under-samples his folding range. RNR/DBR built models from a dedicated never-folding **Probe** agent precisely because equilibrium observation is thin, and self-play data worked but was strictly worse ([verified]). A learner cannot afford a probe seat; they eat slower learning as the premium for not bleeding, and the manual says so rather than picking a side.

**Step 2: two independent gates, and the trap between them.**

**Gate 1 (go/no-go):** `n ≥ 20` observations of that observable **AND** raw k/n exceeds baseline by **≥ 15 percentage points**.
**Gate 2 (magnitude):** `p̂ = (k + s·g)/(n + s)` with **s = 10** and g = baseline; deviate by `w × full_exploit` where **`w = n/(n+10)`**.

| n | w | 95% CI half-width at p=.5 | gate? |
|---|---|---|---|
| 5 | 0.33 | ±44 pts | no |
| 10 | 0.50 | ±31 pts | no |
| 15 | 0.60 | ±25 pts | no |
| **20** | **0.67** | **±22 pts** | **YES** |
| 30 | 0.75 | ±18 pts | yes |
| 40 | 0.80 | ±15 pts | yes |
| 100 | 0.91 | ±10 pts | yes |

Worked at the table: villain folded **16 of 20** to your flop c-bet, baseline 0.45. `p̂ = (16 + 4.5)/30 = 0.683`, margin +0.233 → passes. `w = 0.67`. You c-bet **45% + 0.67×(100−45) = 82%** of your range, **not 100%**.

**THE TRAP, taught explicitly.** `p̂ > g` **iff** `k/n > g`. Algebraically always. **Shrinkage toward the baseline is sign-preserving** — it changes the *size* of the indicated deviation, never its *direction*. Combined with G2's indifference coincidence, a learner armed only with the Bayesian update will deviate off **2-for-2**, just by a small amount, which feels responsible and is not. This is the human analogue of the DBR **1-Step ablation**: removing the default-policy fill-in was **insufficient** — thin-sample frequencies overfit on their own ([verified]). **Shrinkage is a magnitude control and never a go/no-go control. Teach both gates or the learner believes they have a safety mechanism they do not have.**

**Step 3: the garden of forking paths.** A villain sitting **exactly at baseline** (g = 0.45), learner scanning m stats, exact binomial P(at least one stat looks ≥15 points exploitable):

| n per stat | m=1 | m=4 | m=10 | m=20 |
|---|---|---|---|---|
| 10 | 26% | 70% | **95%** | 99.8% |
| 20 | 13% | 43% | 75% | 94% |
| 30 | 7% | 26% | 52% | 77% |
| 40 | 4% | 15% | 34% | 56% |

At a 20-point margin, n=20: 5.8% single, 21% at m=4, 45% at m=10. **A learner scanning a 10-stat HUD at 10 observations each finds a "leak" in a perfectly baseline villain 95% of the time.** People grossly overestimate the reliability of small samples and explain deviations causally rather than as sampling error (Tversky & Kahneman 1971, [verified]).

**Gate 0 (pre-registration):** at session start, write **at most two** villain tendencies you will track, before seeing data. Only those two can licence a deviation. Anything noticed opportunistically goes in a notebook and becomes next session's pre-registered hypothesis with **fresh data**. Gate 0 (m=2) + Gate 1 (n≥20, 15 pts) puts the false-read rate near **24%** instead of 95%. Still not small — and the honest framing is: *one in four of your reads is noise; that is why the deviation is capped rather than maximal.* Over-guarding also costs: a 20-point margin at n=20 raises the mean true EV per triggered deviation but roughly halves the trigger rate, and **total policy EV per node falls**. 15 points at n≥20 is the chosen point on that curve.

**Step 4: unobserved node → baseline, and assume he plays it well.** Hard structural stop, not a caution. Forbid range-extrapolation: *"he folded to my turn barrel twice, so he'll fold rivers"* is exactly RNR's default-policy error, and the direction is catastrophic, not marginal. Bet 10 into 20 on the river: at a *believed* 60% fold rate the bluff is **+8.0 bb**; at his actual 30% it is **−4.0 bb**. **The read didn't shrink the edge, it flipped the sign.** DBR's fix was structural — `Pconf(I) = 0` where `nI = 0`, which their Theorem 1 shows is exactly the strategy robust to independent Dirichlet priors of total strength ≤ s ([verified]). The human version is structural too: the deviation checklist has a node field, and an unobserved node is a hard stop.

Honest caveat: per-node independence throws away correlation that genuinely exists — real humans' leaks *are* correlated, which is why the Bayesian hold'em work needed an expert-defined 10-dimensional recursive prior rather than independent per-information-set Dirichlets, since the game size virtually guarantees never seeing the same information set twice (Southey et al. 2005, [verified]). The correct fix is a good **structured** prior — which is what the archetype portfolio is. Per-node independence is the fallback until the learner has calibrated archetypes.

### The deviation catalogue

Ranked by **reach-weighted bb/100**, computed from the reach table with stated pot/bet assumptions. Read as an order-of-magnitude ranking, not measurements — **no published source gives human-scale mbb/g for these**, and the manual says so.

| # | opponent leak, named as an action | counter | bb/occurrence | node/hand | **bb/100** | added self-exposure |
|---|---|---|---|---|---|---|
| 1 | both blinds fold to steals >85% | widen BTN RFI 45%→58% | +0.35/combo | 0.092 | **0.76** | lowest — wide BTN opens are near-unexploitable at 100bb |
| 2 | folds to flop c-bet 70% (base 45%) | c-bet 33% pot on ~40% more of range | +1.37 | 0.0165 | **0.91** | low — small bet, cheap to be wrong, hard to counter-attack |
| 3 | never folds river (10%, base 33%) | **cut all river bluffs**, bet only value, size up | +2.25 saved | 0.0015 | **0.34** | **zero** — removing a bluff is not a deviation he can punish |
| 4 | folds turn 62% (base 45%) | barrel turn wider incl. no-equity blockers | +2.04 | 0.0054 | **0.39** | medium — 8bb into 12, range gets read fast |
| 5 | folds river 65% (base 33%) | 50%-pot river bluff with missed-draw blockers (A5s, KQo) | +6.34 | 0.0015 | **0.28** | **highest per bb** — 3.6 attempts/session, 4-observation detection window |
| 6 | calls river 70% (base 40%) | thin value: 33% pot with third pair+ | +3.51 | 0.0015 | **0.06** | low — punished only by check-raises he doesn't have |
| 7 | opens small, folds to 3-bets >70% | widen blind 3-bets, small sizing | +0.30/combo | 0.041 | **0.15** | medium — 9bb of exposure |
| 8 | **never shown a river bluff** in ≥20 showdowns | hero-fold a bluffcatcher | +7.00 | 0.0007 | **0.10** | medium, and asymmetric in confidence needed |

**Teaching order is NOT the bb/100 order.** It is ordered by **confidence required per bb exposed**, because the failure mode being engineered against is a confidently wrong read. A bluff deviation at pot 20 / bet 10 needs only **33%** confidence to break even (+8 if he folds 60%, −4 if he folds 20%). A hero-fold needs **50%** (save 6, lose 6 — symmetric). Therefore:

> **#3 (stop bluffing) → #2 (c-bet more) → #1 (steal more) → #5 (river bluff) → #6 (thin value) → #4 (turn barrel) → #7 (3-bet) → #8 (hero-fold, last).**

#8 has the weakest available evidence class (showdowns — the biased sample), the rarest node (0.0007/hand), and the most symmetric payoff. **Most coaches teach it first because it feels like reading souls. It belongs last.**

### Capping self-exposure: five dials

A p-RNR is an **ε-safe best response** — among all strategies with exploitability ≤ ε, it is a best response to the model ([verified] Theorem 1). That turns "how much should I deviate?" into a one-dial constrained optimisation. Empirically the dial is cheap: with p chosen so ε ≈ 100 mb/h, RNR kept **85 of FBR's 137** mb/h on PsOpti4 while averaging **+43** across the field instead of FBR's −129, and kept **582 of 2,170** on A60 while averaging **+78** (beating the equilibrium's +56). Meanwhile FBR-A60 beat A60 for **+2,170** and averaged **−142** — and even between two near-identical bots differing only in solver iterations, model error cost 30% ([verified]).

**Dial 1 — Node selection. This is where the safety actually comes from.** At a *single* node the trade is **exactly linear**: pot 2, bet 1, baseline bluff 0.50, villain calling 30% — gain and added exploitability both scale linearly, ratio pinned at **1.10** for every deviation size from 0.05 to 1.0. RNR's famous concavity comes entirely from **selecting** among many nodes with heavy-tailed leak sizes: with 200 nodes, deviating at the top-10 captures **52%** of the full best response's gain for **5%** of its added exploitability, top-20 gets **64% for 10%** — while 20 *randomly chosen* nodes get **8% for the same 10%**. (The heavy-tail assumption is mine, plausible and unmeasured.)

> **Drill:** given a read, write the five nodes where it applies, rank by (node/hand) × (bb per occurrence), **deviate hard at the top two and not at all at the other three.**

**Kill the phrase "play looser against him."** That is the random-node-selection policy: it spends the whole budget and captures almost none of the gain.

**Dial 2 — Magnitude, `w = n/(n+10)`, never 100%.** Exposure arithmetic on the river bluff if the read is wrong (true fold rate 0.20): at w=1.0 you bluff 100% and lose **−4.00 bb/attempt**; at w=0.67 you bluff 82% and lose **−3.27**; at w=0.40 you bluff 67% and lose **−2.68**. Over ~3.6 river occurrences in 300 hands that is 14.4 vs 11.8 vs 9.6 bb of exposure. **The cap buys little on the magnitude axis and almost everything on the detection axis.**

**Dial 3 — Breadth: at most three named deviations active, written on paper before the session.** Anything not on the paper is played baseline. This is the portfolio design imported directly: the responses were tuned to be exploitable for approximately **100 mbb/h**, "kept relatively low to ensure that any of the responses could be used without substantial risk" ([verified]).

**Dial 4 — The gift ledger (RWYWE).** Maintain `k_t` = value of gifts received; permit an ε-safe best response with ε ≤ k_t. **Proposition 6.1: keying the budget to *realised* profit is NOT safe; keying it to *expected* profit given observed gifts IS** ([verified]). Kuhn results, game value −0.0556 $/hand: RWYWE scored **0.3636 / −0.0110 / −0.02043** against random / sophisticated-static / dynamic-nemesis opponents, while the unsafe best response scored **0.4700 / +0.0548 / −0.12094** — against a nemesis that switches at hand 100, BR loses **more than double the game value** while every safe algorithm stays at or above value.

Gift unit values, in bb, entered only in action-with-a-holding form:

| observed gift | bb banked |
|---|---|
| folded river to 50%-pot bet at 70% (base 33%) | +7.34 |
| folded flop to 33% c-bet at 70% (base 45%) | +1.37 |
| called river with third pair no draw (70% vs 40%) | +3.51 |
| reached showdown without a single river bluff in 20 | +7.00 |

**Total active deviation exposure may not exceed the ledger.** One theorem kills two tilt patterns: *"I'm stuck three buy-ins so I'll exploit harder"* is RWYW keyed to realised losses — provably unsafe. *"I'm up four from coolers so I can gamble"* is RWYW keyed to realised wins — also unsafe. **Neither running bad nor running hot is a gift.** The ledger is subjective and a motivated learner will inflate it, so it is written, timestamped, and requires the action-with-a-holding form to enter. Scaling caveat from the authors themselves: computing ε-safe best responses at hold'em scale costs about as much as a full equilibrium computation, so **the human gift ledger is an analogy to a proven idea, not an implementation of one.** Say that.

**Dial 5 — Patience, and it inverts the coaching instinct.** Using all 56 bet sizes from round one exploited opponents **"almost a full order of magnitude less"** than checking the first two rounds and attacking on rounds 3–4 — Hyperborean 2014: **574 ± 125** mBB/h with 56 bets from round 1, versus **4,675 ± 152** with 56 bets on rounds 3–4 ([verified]). Mechanism, in their words: greedy large early bets "push the opponent to folds before she places more money in to the pot," and forgo information learnable later. **Spotting a leak is a reason to attack it later and smaller, not now and bigger.** Catalogue entries #2 and #5 are both small-sizing for this reason.

### The archetype portfolio — classification replaces estimation

Instead of estimating a high-dimensional action-frequency vector online (which the reach table proved impossible) and then computing a robust response (too slow), precompute a small portfolio of pre-capped robust responses offline and online estimate only **which one is working**. Six archetypes, each with exactly three pre-drilled capped deviations, memorised cold. At the table the only online task is **classification plus confidence**.

| archetype | signature (T1 observable, ≤20 hands) | the three deviations |
|---|---|---|
| **Nit** (12/10) | VPIP<15, folds blinds to steals | widen BTN/CO RFI · c-bet flop 33% near-100% · fold to his river bet without the nuts |
| **Station** (45/8) | calls >65% of rivers | **cut all river bluffs** · thin value with third pair · never bluff-raise |
| **LAG** | 3-bets >12%, barrels turn | 4-bet wider for value · call his turn barrel one pair wider · stop 3-betting light |
| **TAG-reg** (24/19) | balanced | **no deviations.** This slot exists so "I don't know" has somewhere to go, and it maps to baseline. |
| **Over-folder** | folds to flop c-bet >65% | c-bet more · barrel turn · stop thin river value (he's not there) |
| **Maniac** | raises >25% of turns | tighten opens · call down wider · stop semi-bluffing (he does it for you) |

Results justifying this architecture: Small-Portfolio's win rate was **nearly double** a fixed Nash strategy computed in a *considerably larger* abstraction, beat every individual response in its own portfolio by **at least 19.9%**, and beat **Small-Static** — a robust response to a single *aggregate* model of the same data — which "suggests that the mimics are exploitable in at least partially independent ways and that modelling them as a single aggregate player harms the response's exploitive power." On the 2011 ACPC benchmark: Small-Portfolio **317 ± 5** mbb/h, Big-Portfolio **290 ± 11**, actual event winner Calamari **276 ± 4** ([verified]).

**Two consequences.** **"Play more aggressively against weak fields" IS Small-Static** — explicitly forbidden. And **six, not twenty**: bandit regret grows with the number of experts, and the small portfolio beat the big one.

### Nodelocking is a hand-built RNR, so it inherits RNR's pathologies

1. It computes a best response to the **model**, whose unobserved parts the tool filled in — the mechanism that broke RNR (as p rose, counter-strategies did "markedly worse against the actual Orange strategy").
2. It reports exploitation **of the model**, not of the villain, and **that gap widens as you lock harder**.
3. The 1-Step ablation proves removing the fill-in is insufficient: thin-sample frequencies overfit on their own.

**Four rules.** **R1** Read **direction and ranking only**, never magnitude — *"against a villain who over-folds turns, my barrels shift toward straight-draw blockers and away from mid pairs"* is signal; *"+3.2 bb"* is fiction. **R2** Lock **only observed nodes**; leave everything else at equilibrium (the manual implementation of `Pconf(I)=0`). **R3** Always run the **paired opposite lock** — lock the inverse error and check what the same adjustment costs; if it's catastrophic under the opposite lock it fails the budget regardless. **R4** Apply `w = n/(n+10)` to the solver's **recommended shift**, not adopt it whole.

**The derivation drill.** For each catalogue entry: given the read, **predict in writing** which hand classes gain and which lose and why, *before* running the lock; run it; run the paired opposite lock; write the one-sentence mechanism in your own words. That sentence becomes the concept tag and all future feedback quotes it back. A nodelock consumed without a prior written prediction is a lecture.

**What the learner memorises from a nodelock: nothing.** The deliverable is a mechanism sentence, never a frequency.

**State the toolchain gap plainly:** no consumer nodelocking tool reports the exploitability of *your response*, so the single most important quantity in the whole RNR framework is invisible in the practitioner's toolchain. R3 is a **weak** substitute.

### Revert triggers — the highest-value rule in the module, and essentially no trainer teaches it

**Detection is faster than measurement.** He needs far fewer observations to notice your deviation than you needed to justify it, because your deviation is *large* and his leak was *marginal*. Deviate river bluffing from baseline 0.33; he flags at observed ≥0.53:

| your bluff frequency | P(he flags) at n=4 | n=8 | n=15 |
|---|---|---|---|
| 1.00 (max exploit) | **1.00** | 1.00 | 1.00 |
| 0.82 (w = 0.67, capped) | 0.79 | 0.92 | 0.99 |
| 0.60 (w = 0.4) | 0.48 | 0.59 | 0.79 |
| 0.46 (w = 0.2) | 0.26 | 0.28 | 0.38 |

**You needed n≥20 to licence the read. He needs 4. And in 300 hands you only get ~3.6 river-bet occurrences against him.**

Session arithmetic — 300 hands, 10 river-bet occurrences, +6.5 bb per successful exploit, −4.0 bb per occurrence once adapted:

| line | net |
|---|---|
| max exploit, he adapts at attempt 4, **no revert** | **+2.0 bb** |
| max exploit, adapts at 4, **revert immediately** | **+26.0 bb** |
| capped (w=0.67), adapts at 7, revert | **+30.5 bb** |

**Capped-and-reverted beats max-exploit-and-persist by 15×. The whole edge is the revert.**

**T-A — Counter-action count (primary, Bayesian).** Prior P(adapted) = 0.15; each counter-action (he calls a spot he'd been folding, raises a street he'd been calling) is LR ≈ 0.80/0.35 = 2.29:

| counter-actions | P(adapted) |
|---|---|
| 0 | 0.15 |
| 1 | 0.29 |
| 2 | **0.48** |
| 3 | 0.68 |
| 4 | 0.83 |

Abandonment threshold: gain if still exploitable +9.5, loss if adapted −4.0 → **q = 9.5/13.5 = 0.70**, landing between 3 and 4. So: **two counter-actions → halve w. Three → revert to baseline for the rest of the session.** Not "reassess." Revert.

**T-B — Session boundary.** All reads expire; n resets to zero. Brutal and correct: the read came from a sample whose stationarity you cannot verify, and the convergence results assumed a **stationary** opponent whose cards you saw at showdown.

**T-C — Ledger exhaustion.** If active exposure exceeds banked gifts, drop the largest deviation. Mechanical.

**T-D — Evidence decay (the trigger nobody has).** With s=10, g=0.45, k held at 16 while n grows (he stops folding):

| observations | p̂ | margin | deviation |
|---|---|---|---|
| 16/20 | 0.683 | +0.233 | ON, w=0.67 |
| 16/24 | 0.603 | +0.153 | ON, w=0.71 |
| **16/26** | **0.569** | **+0.119** | **OFF** |
| 16/30 | 0.512 | +0.062 | OFF |

**Six additional non-folds turn the deviation off.** The 15-point margin is re-evaluated on every new observation, not just at first trigger. Note the deliberately perverse-looking feature: **w rises with n while the gate closes.** Two independent gates, exactly as designed.

### Levelling, capped by arithmetic rather than advice

L1 (still exploitable) = +9.5 bb/occurrence. L2 (he's adapted, I invert) = −4.0 if he hadn't. Prior P(adapter) = 0.15. **EV of entering L2 with no evidence = 0.15×(+4.0) − 0.85×(3.5) = −2.38 bb.** Breakeven prior **q = 0.70** — identical to T-A's revert threshold, which is not a coincidence:

> **When you suspect he has levelled you, the correct move is almost never to level him back. It is to revert to baseline.** Baseline costs zero; L2 costs 2.38 bb per occurrence to enter on suspicion.

This is the nemesis result read correctly: the safe algorithms didn't out-guess the nemesis, **they stopped deviating** — and all stayed at or above the game value while the unsafe BR collapsed to −0.12094.

**When L2 is legitimate:** Def 5.2 one level up. *"He check-raised my 33% c-bet with a hand that has no equity, twice, right after I started c-betting 82%"* is a gift at level 2 — he has over-adjusted, and the counter is to value-bet into his widened bluff-raising range. *"I feel like he's onto me"* licenses nothing.

**The spiral-killer is the evidence requirement, and the arithmetic is why.** L2 requires **n ≥ 4 counter-actions in that node** — which by the reach table means a river-node L2 read needs ~26,000 hands and is unobtainable in a session. L3 requires **two independent detections** — joint probability ≈ 0.83 × 0.83 = 0.69 even under favourable assumptions, against a −2.38 bb entry cost. **L3 never clears its gate. The ladder is capped at L2 by arithmetic, not by advice.** A learner told "don't over-level" will over-level; a learner who has computed 26,000 hands will not.

**Drill format.** Forced 3-choice on every suspected-levelled spot: *(a) still leaking → continue; (b) adapted → **baseline**; (c) over-adapted, and here is the named counter-action with its holding → level 2.* Choosing (c) without the named action is graded as an **error even when the hand is won**. Choosing (b) when (c) was correct is graded **free** — deliberately asymmetric, because over-reverting is cheap and over-levelling is not.

### The one-page table card

> **Before the session:** write 2 tracked tendencies and 3 permitted deviations. Nothing else counts.
>
> **To deviate, ALL of:** (1) named action-with-a-holding, not a stat; (2) **n ≥ 20** of *that* observable; (3) raw frequency **≥ 15 points** off baseline; (4) on today's paper; (5) exposure ≤ gift ledger; (6) node is one you have actually observed.
>
> **How much:** `p̂ = (k + 10g)/(n + 10)`. **`w = n/(n+10)`.** Deviate by w × full exploit. **Top two nodes only. Never 100%.**
>
> **Unobserved node → baseline, and assume he plays it well.**
>
> **Revert:** 2 counter-actions → halve w. **3 → baseline.** Session ends → all reads expire. 6 contrary observations → gate closes.
>
> **He levelled you → baseline, not level 2.** L2 costs 2.38 bb to enter on suspicion and needs 4 named counter-actions in that node. **L3 needs 26,000 hands. It does not exist.**

---

## What we delete, and why

| deleted | mechanism | replacement |
|---|---|---|
| **The 13×13 grid, until fading rung 4** | ~400–500 item-level facts per node against a ~4-chunk buffer, presented as isolated non-interacting cells with no organising principle to chunk against. Textbook expertise reversal: it is the coach's lookup index. | 6 hand classes · 3 verbal thresholds per position ≤12 words · purified frequencies · drills on the ~12 boundary combos per position that flip the decision. Grid appears at hour ~14 as a self-check index. |
| **Every outcome signal in learning mode** — pot won/lost, chip graph, session P/L, all-in-adjusted winnings, bankroll, streaks-on-results, leaderboards, percentile ranks, XP. `net` deleted from the schema. | Maximally salient, maximally self-directed, near-zero task information, variance-corrupted. 17% of 994 educational effects were negative and 86% of negative motivational effects came from uninformative reward/punishment. Grading also survives instruction: good-outcome decisions were rated better decisions with decision information held constant, **despite instructions to judge only the decision.** | Match-rate and RW EV loss per 100 decisions. Structurally outcome-blind grading, never instruction-blind: **remove the result from the display; never say "ignore the result."** Chip graph gated behind 10,000 hands and shown beside the EV graph as the lesson in their divergence. |
| **Bare verdicts as feedback** (red X, green check, naked `-1.4bb`) | Knowledge-of-result = **d = 0.05**. Shipping it as the primary channel is a bug. | 3-element ≤60-word correction ending in a next action, no praise attached. |
| **Reviewing hands selected because they were big losses** | Selects on variance, directs elaboration at hands whose decisions were often fine, ignores the systematic 0.5 bb leaks that constitute most of the EV loss, and trains outcome bias on a variance-selected sample. | Select by RW or by error tag. A 3 bb error you won outranks a perfect hand you lost a stack in. |
| **Post-hoc narrated review with no ex-ante record** | Outcome knowledge inflates the retrospectively judged probability of the known outcome, subjects are largely unaware and cannot suppress it on instruction, and people misremember their own prior forecasts toward what happened. | Timestamped, locked pre-reveal log: opponent range in ≤6 combo classes **with combo counts**, action, EV ranking of candidate actions, confidence. **No log, no review** — an unlogged hand history is a story. Caps review at 15–25 hands/session; that is the correct throughput. |
| **Blocked drilling by position** ("40 BTN RFI, then 40 CO") | The lesson heading does the classification, which is the sub-skill the table demands. With spacing fixed, interleaving doubled next-day scores. 3-exemplar mini-blocks were tested directly and were **no better than random (p = .27)**. | Interleaved queue from a confusion set, no two consecutive same-class spots, spot type unlabelled. Blocking only on introduction day. |
| **Randomising across unrelated modules and calling it interleaving** | Interleaving pays at *high between-category similarity*; word learning reversed to g = −0.39 favouring blocking. Cross-module mixing buys the in-session cost with none of the benefit. | Confusion sets: near-identical surface features, different correct actions. |
| **In-session accuracy as a progress metric, and every scoreboard slot it would occupy** | Acquisition performance is an unreliable index of learning and can move opposite to it; the conditions that maximise it (blocked, cued, feedback-rich) hurt retention. | Weekly assessment mode only, reported as RW bb/100, with the manual stating in plain words that practice-mode accuracy is not progress. |
| **Unbounded remediation and "N correct in a row" gating** | Wheel-spinning: repeated failure is evidence the *instruction* was wrong. N-consecutive-correct is noise-sensitive, less equitable than model-based tracing, and interacts catastrophically with the high guess floor from solver mixing. | Cap at 25 opportunities → freeze KC, surface the error signature, route to a worked example. Gate on calibrated posterior 0.90 with 0.85 CI lower bound. |
| **Learner-set difficulty, a global "skill level", and any single global accuracy/Elo number as diagnosis** | Self-selection drifts to comfort under fatigue and frustration under ego. A global level strips scaffolding from concepts never learned. A single scalar collapses 80 KCs and cannot answer the only question that matters — which drill next. | Elo for cold start only; per-KC PFA posteriors own the dial; fading is per concept; learner sees only harder/easier nudges. |
| **Solver-as-practice-opponent** | Weakening a strong engine does not produce human-like play; depth-limited Stockfish predicts human moves *better* the stronger it is. A loosened GTO bot teaches exploits nobody offers. | Rule-based human-calibrated archetypes with jittered parameters and hidden labels. Solver grades and supplies concepts. |
| **Mixed frequencies before pure play holds 90% across 3 sessions** | Guidance added ahead of the schema it modifies; converts a learnable verbal rule back into an unlearnable table. | Purified modal actions, with the learner *told* the frequency was discarded on purpose. |
| **Think-aloud during pattern drills** | Concurrent load impaired *rule* learning but not integration learning — so engaging the verbal system biases toward rule strategies that fail on integration categories. | Silence during PLM blocks. Verbalisation confined to the review phase and the encoded-hand recall drill. |
| **Reused illustrative flops** (the "20 canonical boards" of every training video) | Lets learners cache items instead of extracting invariants; they classify the demos perfectly and fail on novel boards. Deployed modules used 261–415 unique stimuli for a reason. | 300+ unique never-repeated stimuli per category, all irrelevant surface features randomised per trial. Transfer measured on held-out boards only. |
| **Per-hand fold counterfactuals** ("you folded 76s, flop came 5-8-9") | Teaches loose calling from n = 1. The single most destructive string the app could emit. | Node-level aggregates at n ≥ 50 only. |
| **Stat-threshold triggers with no sample-size gate** | A baseline villain scanned across 10 HUD stats at 10 observations each shows a 15-point "exploitable" leak **95% of the time**. | Pre-register 2 tendencies + n≥20 + 15-point margin → false-read rate ~24%. |
| **Maximal exploitation as a goal state** | FBR-A60 beat A60 for +2,170 mb/h and averaged **−142** across the field, worse than plain equilibrium's +56. Maximal exploitation is unreachable within 200–900 hands even in Kuhn poker. | Capped 3-deviation portfolio; the edge is the revert. |
| **"Deviate slightly everywhere against a weak player"** | The single-node trade is exactly linear (ratio 1.10 at every size). The concavity comes entirely from *selecting* nodes. Uniform small deviations spend the budget and capture nothing. | Ranked shortlist, hard deviation at the top two nodes only. |
| **Reads as durable properties of a villain** | Stationarity is unverifiable and the convergence results assumed it. | Session-boundary expiry; 2 counter-actions halve, 3 revert; 6 contrary observations re-close the gate. |
| **"Play more aggressively against weak fields"** | That is Small-Static — a robust response to one aggregate model — which measurably lost to a 4-response portfolio. | Six archetypes with three pre-drilled deviations each. Not twenty; the small portfolio beat the big one. |
| **Nodelock EV numbers quoted to two decimals** | The tool computes a best response to a fiction whose unobserved parts it filled in, and the model/reality gap widens as you lock harder. | Direction and ranking only; the deliverable is a mechanism sentence. |
| **"Punish the leak now, size up"** | Using all bet sizes from round one exploited opponents almost a full order of magnitude less than waiting (574 vs 4,675 mBB/h). | Attack later and smaller. |
| **"GTO is unexploitable, so deviation is pure added risk"** | Every evaluated no-limit ACPC bot leaks >3,180 mBB/h — 4× worse than folding every hand. Your own baseline leaks far more than the ε you're agonising over. | Frame as *added* exploitability on an already-leaky baseline; fix your own leaks first. |
| **Hero-folding taught early off aggression stats** | Most symmetric payoff (50% vs a bluff's 33%), rarest node (0.0007/hand), and its only valid evidence class is showdowns — the biased sample. | Last in the catalogue, n≥20 and showdown-verified only. |
| **Mindset coaching for downswings; "10,000 hours"; "hands played" or "hours studied" as volume** | ~8% of 200-hand sessions lose 2+ buy-ins at zero EV loss — most of a downswing is arithmetic, and diagnosing variance as tilt teaches that outcomes are diagnostic of state. The 10,000-hour figure is a group mean for one cohort, the slowest chess player needed **8×** the practice of the fastest to reach master, and grandmasters averaged **~5,000 hours** of serious solitary study in their first decade. | The variance table in hour 5. Volume stated as **graded decisions with an attributed EV number**, error rate held in the 15–25% band. |

---

## Reading list

### Read these ten first

| # | paper | status | what it justifies |
|---|---|---|---|
| 1 | **Hogarth, Lejarraga & Soyer (2015)**, The Two Settings of Kind and Wicked Learning Environments, *Curr Dir Psychol Sci* 24:379-385 | **[verified]** | The whole premise: inference is accurate only when acquisition-time and use-time informational elements match. Why the pot cannot be the feedback signal and the solver must be. |
| 2 | **Van der Kleij, Feskens & Eggen (2015)**, *Rev Educ Res* 85:475-511 | **[verified]** | KR d=0.05, KCR 0.32, elaborated 0.49. Kills bare verdicts as a feedback channel. |
| 3 | **Wisniewski, Zierer & Hattie (2020)**, *Frontiers in Psychology* 10:3087 | **[verified]** | 994 effects, d=0.55 raw / 0.48 trimmed, 17% negative, 86% of negative motivational effects from uninformative reward/punishment. The feedback type gradient (0.24 / 0.46 / 0.99). Use 0.48 for planning. |
| 4 | **Rohrer, Dedrick, Hartwig & Cheung (2020)**, *J Educ Psych* 112:40-52 | **[verified]** | Preregistered cluster-RCT, 54 classes: 61% vs 38%, d=0.83 at one month. The "no two consecutive same-strategy problems" constraint, verbatim. |
| 5 | **Brunmair & Richter (2019)**, *Psychological Bulletin* 145:1029-1052 | **[verified]** | Interleaving g=0.42 overall but g=−0.39 for word learning; moderators are high between-category / low within-category similarity. Why queues are confusion sets, not syllabi. |
| 6 | **Mettler & Kellman (2014)**, *Vision Research* 99:111-123 | **[verified]** | RT-adaptive 125.3 vs random 234.9 trials to criterion; mini-blocking no better than random (p=.27); +38%/+39% efficiency, d≈1.09-1.22. The drill scheduler. |
| 7 | **Krasne, Stevens, Kellman & Niemann (2020)**, *AEM Educ Train* 4:89-99 | **[verified]** | 415 unique ECGs, 46±24 min, fluency effect sizes **2.5–3.1** vs accuracy 0.9–3.2, gains at one year. Why fluency (correct AND under RT) is the gate, not accuracy. |
| 8 | **Bowling, Burch, Johanson & Tammelin (2015)**, *Science* 347:145-149 | **[verified]** | The 1 mbb/g "essentially solved" threshold and its derivation; dealer advantage bounded 87.7–89.7 mbb/g. Anchors the entire severity scale's zero point. |
| 9 | **Ganzfried & Sandholm (2015)**, Safe Opponent Exploitation, *ACM TEAC* 3(2) Art. 8 | **[verified]** | Def 5.2 (gifts) + Prop 6.1 (realised profit unsafe, expected profit safe) + the Kuhn nemesis table. The gift ledger, and the theorem that kills two tilt patterns. |
| 10 | **Johanson & Bowling (2009)**, Data Biased Robust Counter Strategies, AISTATS, PMLR 5:264-271 | **[verified]** | `Pconf(I)=0` where `nI=0`; Theorem 1 (Dirichlet-prior robustness); the 1-Step ablation proving thin-sample frequencies overfit independently. The single most transferable deviation result. |

### Grouped by what they justify

**Grade the process, never the outcome; poker's signal is uninformative below ~1,500 hands**
Baron & Hershey (1988) *JPSP* 54:569-579 [verified] · Fischhoff (1975) *JEP:HPP* 1:288-299 [verified] · Fischhoff & Beyth (1975) *OBHP* 13:1-16 [verified] · Guilbault, Bryant, Brockway & Posavac (2004) *BASP* 26:103-117 [verified] existence, pooled effect size [recalled] · Einhorn & Hogarth (1978) *Psych Review* 85:395-416 [verified] · Brehmer (1980) *Acta Psychologica* 45:223-241 [verified] · Potter van Loon, van den Assem & van Dolder (2015) *PLOS ONE* 10:e0115479 [verified] · Levitt & Miles (2012) *J Sports Econ* 15:31-44 [verified] · Meyer, von Meduna, Brosowski & Hayer (2013) *J Gambling Studies* 29:535-550 [verified] · Tversky & Kahneman (1971) *Psych Bulletin* 76:105-110 [verified] · Burch, Schmid, Moravčík, Morrill & Bowling (AIVAT, 2018 AAAI / arXiv:1612.06915) [verified] — 85% SD reduction, 44× fewer games, "enabled the first statistically significant AI victory against professional poker players in no-limit hold'em" · Billings & Kan (2006) DIVAT, *ICGA Journal* 29(3) [verified] — required sample grows as Θ(n²) as skill converges · Smith, Levere & Kurtzman (2009) *Management Science* 55:1547-1555 [recalled] finding · Fiedler & Rock (2009) *Gaming Law Rev Econ* 13:50-57 [verified] existence only — **the specific Critical Repetition Frequency number is unverifiable; do not quote it**

**Retrieval, generation, spacing, desirable difficulties**
Karpicke & Roediger (2008) *Science* 319:966-968 [verified] · Roediger & Karpicke (2006) *Psych Science* 17:249-255 [verified] · Pan & Rickard (2018) *Psych Bulletin* 144:710-756 [verified] · Taylor & Rohrer (2010) *ACP* 24:837-848 [verified] · Rohrer, Dedrick & Stershic (2015) *J Educ Psych* 107:900-908 [verified] · Cepeda, Vul, Rohrer, Wixted & Pashler (2008) *Psych Science* 19:1095-1102 [verified] · Karpicke & Roediger (2007) *JEP:LMC* 33:704-719 [verified] · Kornell (2009) *ACP* 23:1297-1317 [verified] · Kornell & Bjork (2008) *Psych Science* 19:585-592 [verified] · Potts & Shanks (2014) *JEP:General* 143:644-667 [verified] · Kornell, Hays & Bjork (2009) *JEP:LMC* 35:989-998 [verified] · Slamecka & Graf (1978) *JEP:HLM* 4:592-604 [verified] existence · Yan, Bjork & Bjork (2016) *JEP:General* [verified] · Soderstrom & Bjork (2015) *PPS* 10:176-199 [verified] · Schmidt & Bjork (1992) *Psych Science* 3:207-218 [verified] · Shea & Morgan (1979) *JEP:HLM* 5:179-187 [verified] · Bjork & Bjork (1992) disuse theory, in *From Learning Processes to Cognitive Processes* [verified] existence · Bjork & Bjork (2011) desirable difficulties chapter [verified] existence · Carvalho & Goldstone (2014) *Mem & Cog* 42:481-495 and *Psych Bull Rev* [recalled] mechanism · Kang & Pashler (2011/2012) *ACP* 26:97-103 [verified] title-level, simultaneity detail [recalled] · Birnbaum, Kornell, Bjork & Bjork (2013) *Mem & Cog* 41:392-402 [recalled] · Butler (2010) *JEP:LMC* 36:1118-1133 [recalled] details · Dunlosky, Rawson, Marsh, Nathan & Willingham (2013) *PSPI* 14:4-58 [recalled] — useful calibration: practice testing and distributed practice rated high-utility, interleaving only moderate

**Feedback design, cognitive load, worked examples, fading**
Kluger & DeNisi (1996) *Psych Bulletin* 119:254-284 [verified] paper, d≈.41 and ~1/3-harmful [recalled] · Hattie & Timperley (2007) *Rev Educ Res* 77:81-112 [verified] paper, d≈0.79 [recalled] and **inflated** per Wisniewski et al. · Shute (2007/2008) [verified] existence, individual guidelines [recalled], and several conflict with the KR/KCR/EF gradient · Chi, Bassok, Lewis, Reimann & Glaser (1989) *Cognitive Science* 13:145-182 [verified] · Chi, de Leeuw, Chiu & LaVancher (1994) *Cognitive Science* 18:439-477 [verified], gain magnitudes [recalled] · Aleven & Koedinger (2002) *Cognitive Science* 26:147-179 [verified], effect sizes [recalled] · Bisra, Liu, Nesbit, Salimi & Winne (2018) *Educ Psych Rev* 30:703-725 [verified] existence, g≈0.55 [recalled] — use the direction, not the number · Bangert-Drowns, Kulik, Kulik & Morgan (1991) *Rev Educ Res* 61:213-238 [verified], mean ~0.26 and look-ahead subgroup sign [recalled] · Butler, Karpicke & Roediger (2008) *JEP:LMC* 34:918-928 [verified] · Kulhavy & Anderson (1972) *J Educ Psych* 63:505-512 [verified] · Corbett & Anderson (2001) CHI '01:245-252 [verified] existence, condition means [recalled] · Cowan (2001) *BBS* 24:87-114 [verified] · Sweller & Cooper (1985) *Cognition and Instruction* 2:59-89 [verified] · Sweller (1988) *Cognitive Science* 12:257-285 [verified] existence · Kalyuga, Ayres, Chandler & Sweller (2003) *Educ Psychologist* 38:23-31 [verified] · Kalyuga, Chandler & Sweller (2004) *Human Factors* 46:567-581 [verified] · Renkl & Atkinson (2003) *Educ Psychologist* 38:15-22 and Renkl, Atkinson, Maier & Staley (2002) *J Exp Educ* 70:293-315 [verified]; backward fading as the specific superior ordering [recalled] · van Merriënboer, Kester & Paas (2006) *ACP* 20:343-352 [verified] existence, 4C/ID whole-task argument [recalled] · Metcalfe (2017) *Annu Rev Psychol* 68:465-489 [verified] paper, hypercorrection specifics [recalled]

**Perception, chunking, category learning, fluency**
Chase & Simon (1973) *Cognitive Psychology* 4:55-81 [verified] · Simon & Chase (1973) *American Scientist* 61:394-403 [verified] — the ~50,000-pattern estimate, explicitly labelled crude by the authors · Gobet & Simon (1996) *Cognitive Psychology* 31:1-40 [verified] (templates; masters replaced ~60 pieces across 5 boards) · Gobet & Simon (1996) *Psych Science* 7:52-55 [verified] · Gobet & Simon (1996) *Psych Bull Rev* 3:159-163 [verified] · Gobet & Clarkson (2004) *Memory* 12:732-747 [verified] · Sala & Gobet (2017) *Mem & Cog* 45:183-199 [verified] · Gong, Ericsson & Moxley (2015) *PLOS ONE* 10:e0118756 [verified] — largest-chunk size correlates with skill · Reingold, Charness, Pomplun & Stampe (2001) *Psych Science* 12:48-55 [verified] · Sheridan & Reingold (2017) *J Vision* 17(3):4 [verified] · Bilalić, Langner, Erb & Grodd (2010) *JEP:General* 139:728-742 [verified] · Wan, Nakatani, Ueno, Asamizuya, Cheng & Tanaka (2011) *Science* 331:341-346 [verified] · Ericsson & Kintsch (1995) *Psych Review* 102:211-245 [verified] metadata, LTWM thesis as standardly stated · de Groot (1946/1966) [recalled] — directional only, no sample sizes asserted · Kellman & Garrigan (2009) *Physics of Life Reviews* 6:53-84 [verified] · Kellman, Massey & Son (2010) *Topics in Cognitive Science* 2:285-305 [verified] · Kellman, Massey, Roth, Burke & Zucker (2008) *Pragmatics & Cognition* 16(2) [verified] · Kellman & Massey (2013) *Psych Learn Motiv* 58:117-165 [verified] · Kellman & Kaiser (1994) *Proc HFES* 38:1183-1187 [verified] · Krasne, Hillman, Kellman & Drake (2013) *J Pathology Informatics* 4:34 [verified] · Mettler, Massey & Kellman (2016) *JEP:General* 145:897-917 [verified] · Maddox, Ashby & Bohil (2003) *JEP:LMC* 29:650-662 [verified] · Waldron & Ashby (2001) *Psych Bull Rev* 8:168-176 [verified] · Ashby, Alfonso-Reese, Turken & Waldron (1998) *Psych Review* 105:442-481 [verified] — **contested**, see limits · Ashby & Maddox (2005) *Annu Rev Psychol* 56:149-178 [verified] · Medin & Schaffer (1978) *Psych Review* 85:207-238 [verified] metadata · Nosofsky (1986) *JEP:General* 115:39-57 [verified] · Klein, Calderwood & Clinton-Cirocco (1986/2010) [recalled] — no percentage quoted · Hatala, Brooks & Norman (2003) *Adv Health Sci Educ* 8:17-26 [recalled] numbers · St. Germain & Tenenbaum (2011) *High Ability Studies* 22:3-17 [verified] metadata — **essentially the only confirmable expertise-protocol study on poker; the direct poker chunking literature is empty**

**Learner modelling, mastery, adaptive curriculum**
Corbett & Anderson (1995) *UMUAI* 4:253-278 [verified] · Pavlik, Cen & Koedinger (2009) AIED [verified] · Cen, Koedinger & Junker (2006) ITS, LNCS 4053 [verified] · Cen, Koedinger & Junker (2007) AIED [verified] · Beck & Chang (2007) UM, LNCS 4511 [verified] · Baker, Corbett & Aleven (2008) ITS, LNCS 5091 [verified] · Yudelson, Koedinger & Gordon (2013) AIED, LNCS 7926 [verified] — individualising *learning rates* beats individualising initial knowledge · Beck & Gong (2013) AIED, LNCS 7926 [verified], prevalence [recalled] · Rollinson & Brunskill (2015) EDM [verified] · Doroudi & Brunskill (2019) LAK [verified] · Gervet, Koedinger, Schneider & Mitchell (2020) *JEDM* 12:31-54 [verified] · Piech et al. (2015) Deep Knowledge Tracing, arXiv:1506.05908 [verified] · Xiong, Zhao, Van Inwegen & Beck (2016) EDM [verified] · Pelánek (2017) *UMUAI* 27:313-350 [verified] · Pelánek, Papoušek, Řihák, Stanislav & Nižnan (2017) *UMUAI* 27:89-118 [verified] · Klinkenberg, Straatemeier & van der Maas (2011) *Computers & Education* 57:1813-1824 [verified], target success rate [recalled] · Jansen, Hofman, Savi, Visser & van der Maas (2016) *LID* 51:1-10 [recalled] · Koedinger, Corbett & Perfetti (2012) *Cognitive Science* 36:757-798 [verified] · Koedinger, Anderson, Hadley & Mark (1997) *IJAIED* 8:30-43 [verified] · Ritter, Yudelson, Fancsali & Berman (2016) L@S [verified] metadata · Koedinger, Brunskill, Baker, McLaughlin & Stamper (2013) *AI Magazine* 34:27-41 [verified] · Bloom (1984) *Educational Researcher* 13:4-16 [verified] · Kulik, Kulik & Bangert-Drowns (1990) *Rev Educ Res* 60:265-299 [verified] · VanLehn (2011) *Educ Psychologist* 46:197-221 [verified] · Pane, Griffin, McCaffrey & Karam (2014) *EEPA* 36:127-144 [verified] · McGaghie, Issenberg, Cohen, Barsuk & Wayne (2011) *Academic Medicine* 86:706-711 [verified] — simulation + deliberate practice vs traditional clinical education, **effect size 0.71** [0.65-0.76]

**Difficulty control**
Wilson, Shenhav, Straccia & Cohen (2019) *Nature Communications* 10 [verified] · Guadagnoli & Lee (2004) *J Motor Behavior* 36:212-224 [verified] · Kornell & Metcalfe (2006) *JEP:LMC* 32:609-622 [verified] · Metcalfe & Kornell (2005) *JML* 52:463-477 [verified] existence

**Equilibrium computation: what it does and does not settle**
Zinkevich, Johanson, Bowling & Piccione (2007) NIPS 20 [verified] — Thm 2 bounds *value*, not action probabilities · Tammelin (2014) CFR+, arXiv:1407.5042 [verified] — note the *current* strategy is the solution and the average was measured as more exploitable and discarded · Waugh, Schnizlein, Bowling & Szafron (2009) AAMAS [verified] — abstraction pathologies, exact Leduc counterexamples · Johanson, Waugh, Bowling & Zinkevich (2011) IJCAI [verified] · Johanson, Bard, Burch & Bowling (2012) AAAI (CFR-BR) [verified] · Johanson, Burch, Valenzano & Bowling (2013) AAMAS [verified] — exploitability does not correlate well with one-on-one performance; intransitivities exist · Ganzfried, Sandholm & Waugh (2012) AAMAS [verified] — Prop 2 indifference, purification, and its non-monotone exploitability · Lisý & Bowling (2017) AAAI-17 Workshop, arXiv:1612.07547 [verified] · Moravčík et al. (2017) DeepStack, *Science* 356:508-513 [verified] · Brown & Sandholm (2018) Libratus, *Science* 359:418-424 [verified] venue; 147 mbb/hand at 99.98% over 120,000 hands [verified] from the NeurIPS-2017/IJCAI-2018 companions · Brown & Sandholm (2019) Pluribus, *Science* 365:885-890 [verified] · Brown, Sandholm & Amos (2018) NeurIPS 31 [verified] · Brown & Sandholm (2017) NeurIPS 30, arXiv:1705.02955 [verified] · Brown, Bakhtin, Lerer & Gong (2020) ReBeL, arXiv:2007.13544 [verified], NeurIPS venue [recalled] · Schmid et al. (2023) Student of Games, *Science Advances* [verified] metadata · Kuhn (1950) A Simplified Two-Person Poker [verified] existence, the one-parameter equilibrium family [recalled]

**Principled deviation**
Johanson, Zinkevich & Bowling (2007) NIPS 20:721-728 [verified] · Johanson & Bowling (2009) AISTATS [verified] · Ganzfried & Sandholm (2015) *ACM TEAC* 3(2) [verified] · Ganzfried & Sandholm (2011) AAMAS:533-540 (DBBR) [verified] · Hoehn, Southey, Holte & Bulitko (2005) AAAI-05:783-788 [verified] · Southey, Bowling, Larson, Piccione, Burch, Billings & Rayner (2005) UAI:550-558 [verified] · Bard, Johanson, Burch & Bowling (2013) AAMAS:255-262 [verified] · McCracken & Bowling (2004) AAAI Fall Symposium [verified] — the ε-safe best response concept · Bard & Bowling (2007) AAAI:515-521 [verified] existence — particle filtering for non-stationary opponents, the methodological answer to everything above assuming stationarity · Billings, Davidson, Schaeffer & Szafron (2002) *AI* 134:1-2 [verified] existence · Billings et al. (2004) Computers and Games (Vexbot) [verified] existence

**Practice opponents, AI as concept source, and the deliberate-practice dispute**
McIlroy-Young, Sen, Kleinberg & Anderson (2020) KDD:1677-1687 [verified] · Shin, Kim, van Opheusden & Griffiths (2023) *PNAS* 120(12) [verified] · Schut, Tomašev, McGrath, Hassabis, Paquet & Kim (2025) *PNAS* 122 [verified] · Ericsson, Krampe & Tesch-Römer (1993) *Psych Review* 100:363-406 [verified] — **no "10,000 hour rule" is stated in the paper** · Macnamara, Hambrick & Oswald (2014) *Psych Science* 25:1608-1618 [verified] · Hambrick, Oswald, Altmann, Meinz, Gobet & Campitelli (2014) *Intelligence* 45:34-45 [verified] · Ericsson & Harwell (2019) *Frontiers in Psychology* 10:2396 [verified] · Ericsson (2016) *PPS* 11:351-354 [verified] · Macnamara & Maitra (2019) *R Soc Open Sci* 6:190327 [verified] · Macnamara, Moreau & Hambrick (2016) *PPS* 11 [verified] · Mosing, Madison, Pedersen, Kuja-Halkola & Ullén (2014) *Psych Science* 25:1795-1803 [verified] · Meinz & Hambrick (2010) *Psych Science* 21:914-919 [verified] · Gobet & Campitelli (2007) *Dev Psych* 43:159-172 [verified] · Charness, Tuffiash, Krampe, Reingold & Vasyukova (2005) *ACP* 19:151-165 [verified] · Choudhry, Fletcher & Soumerai (2005) *Ann Intern Med* 142:260-273 [verified] · Kahneman & Klein (2009) *American Psychologist* 64:515-526 [verified]

**Calibration and the read channel**
Brier (1950) *Monthly Weather Review* 78:1-3 [verified] · Murphy (1973) *J Appl Meteorology* 12:595-600 [verified] · Murphy & Winkler (1977) *JRSS-C* 26:41-47 [verified], specific reliability figures [recalled] · Lichtenstein & Fischhoff (1980) *OBHP* 26:149-171 [verified], the early-gain and ~200-item specifics [recalled] · Chang, Chen, Mellers & Tetlock (2016) *JDM* 11:509-526 [verified] — CHAMPS-KNOW, under one hour, **6–11%** Brier improvement sustained across four years · Mellers et al. (2014) *Psych Science* 25:1106-1115 [verified] — training is the *smallest* of the three levers · Hertwig, Barron, Weber & Erev (2004) *Psych Science* 15:534-539 [verified] · Sedlmeier & Gigerenzer (2001) *JEP:General* 130:380-400 [verified], retention intervals [recalled] · Hogarth & Soyer (2011) *JEP:General* 140:434-463 [verified] · Soyer & Hogarth (2012) *Int J Forecasting* 28:695-711 [verified], exact error percentages [recalled] · Lord, Lepper & Preston (1984) *JPSP* 47:1231-1243 [verified] — "consider the opposite" works where "be unbiased" does not · Schmidt (1975) *Psych Review* 82:225-260 [verified] and van Rossum (1990) *Human Movement Science* 9:3-5 [verified] existence only — **cite van Rossum only as evidence the variability hypothesis has a contested empirical base** · DeDonno & Detterman (2008) *Gaming Law Rev* 12:31-36 [verified] existence, sample and effect sizes [recalled]

### Gaps and dropped citations

- **σ ≈ 100 bb/100** for online 6-max NLHE is from tracking-software databases. **Not peer-reviewed, no citable source.** Every variance figure in hour 5 scales linearly in it.
- **No MTT equivalent** for the variance table. The thresholds run into thousands of tournaments; I have no verifiable published figure. State it qualitatively.
- **No published mbb/g** for the exploitability cost of a human-scale frequency error in HUNL. Every "added self-exposure" figure in the deviation catalogue is **ordinal**.
- **Fiedler & Rock (2009)**: paper exists (DOI 10.1089/glre.2008.13106), abstract elided by the publisher; the Critical Repetition Frequency number circulating in poker discourse could not be verified. **Do not quote a hand count from it.**
- **Kang & Pashler (2011)**: the widely-repeated claim that *simultaneous side-by-side* presentation matched or beat temporal interleaving is **not confirmed**. The title-level discriminative-contrast claim is.
- **de Groot (1946)** and **Klein et al. (1986)**: both are load-bearing conceptually and both are [recalled] at the level of statistics. No depth figures and no "percentage of recognitional decisions" quoted anywhere in this manual.

---

## Honest limits

**1. Transfer of testing is the load-bearing and weakest link in the whole design.** Pan & Rickard's PET-PEESE correction substantially shrank the intercept, implying little benefit absent response congruency and elaborated retrieval. Testing reliably improves retention *of the tested thing*; transfer to novel spots is real but conditional and smaller than the popular literature implies. This method bets everything on satisfying those two moderators — which is exactly why the reason field and the table-direction prompt are non-negotiable even at half throughput.

**2. Immediate vs delayed feedback is genuinely unresolved, and the timing × complexity interaction was non-significant.** I picked immediate-for-integration on Maddox's dissociation and bought spacing separately. That is a mechanism-based bet, not a settled result. **Instrument delayed-retention accuracy per concept and let your own data adjudicate.** Anyone whose documentation asserts one answer is overreading.

**3. The 85% rule is derived for stochastic-gradient-descent binary classifiers**, validated on neural nets and biologically plausible models — not on humans making multi-action decisions with mixed-strategy optima. Anchor to tune, not a law. And the correct error rate at a node with three near-equal actions is genuinely undefined.

**4. Zero perceptual-learning-module studies have ever been run on poker.** Every transfer claim in the perception layer is inferred from butterflies, ECGs, histopathology, algebra, and cockpit instruments. **The single largest risk in the whole design is the taxonomy**: perceptual learning installs whatever boundaries you present and resists later verbal correction. If STATIC/SEMI/DYNAMIC or the 7 role labels are fuzzy or solver-inconsistent, you have permanently installed a fuzzy perception. Validate every label against a solver before showing a single trial.

**5. The multiple-systems account behind "don't verbalise during drills" is contested.** Single-system exemplar models account for much of the same data; the dual-task and delayed-feedback dissociations are the strongest but not decisive evidence. The practical prescription survives either way; **do not sell the neural story as settled.** The same applies to exemplar-vs-prototype: the safe claim is the training implication (near-miss pairs, one-variable contrasts), not the theoretical victory.

**6. The deliberate-practice literature is unresolved, and the disagreement is partly definitional.** Deliberate practice explained 26% of variance for games and 21% for music; a reanalysis with measurement-error correction put chess at 34% and music at ~30% of *reliable* variance; the pro-DP reanalysis lands at 29% (61% after attenuation correction) by excluding effects that violate the three criteria; a double-blind replication of the 1993 violinist study did not reproduce the core finding; within monozygotic twin pairs discordant in practice there was **no ability difference**; and working-memory capacity adds incrementally to sight-reading beyond practice. **All of that is about individual differences in relative attainment.** The target here is criterion-referenced and fixed — "get baseline RW EV loss under X bb/100" is a standard, not a rank — so the contest does not touch the promise. Say that rather than picking a camp.

**7. Everything quantitative on safe exploitation is Kuhn poker.** The authors state that scaling to Texas hold'em is blocked because computing ε-safe best responses costs about as much as a full equilibrium computation. The gift ledger is an **analogy to a proven idea, not an implementation of one**. Likewise, Hoehn's 200-hand convergence and 50-hand switching point are Kuhn numbers — a game with a handful of parameters versus HUNL's O(10¹⁸) — and they assume a **stationary** opponent whose cards you see at showdown. Real villains drift and hide, both of which push the switch later.

**8. The 15-point margin, n≥20, s=10, three-deviation cap, and 24% residual false-read rate are mine**, derived from exact binomial arithmetic and DBR's structural form, not measured on humans. They are instrumentable: log trigger rate and post-trigger realised EV per deviation class and tune them. Present them as instrumented defaults, not laws. Also note they are not independent in the way a statistician wants — a learner who checks Gate 1 *after* peeking at the data is doing optional stopping.

**9. Reach probability is model-dependent.** It depends on the opponent's strategy, so it must be computed against your training-bot population, and **the population must be logged** — otherwise every tier assignment silently drifts when the bots change.

**10. No consumer nodelocking tool reports the exploitability of your response.** The single most important quantity in the robust-counter-strategy framework is invisible in the practitioner's toolchain. The paired-opposite-lock heuristic is a weak substitute and this manual says so rather than papering over it.

**11. Kluger & DeNisi's ~1/3-harmful figure is from 1996 organisational and lab tasks, not tutoring systems.** Wisniewski et al.'s 17%-negative across 994 educational effects is the better-matched number. The direction is robust across both; the magnitude is contested. **Do not quote 38% as if it applied to a poker trainer.** Similarly, Hattie's d ≈ 0.79 is inflated relative to a direct meta-analysis of primary effects (0.48), and Hattie's framework should be used as a design checklist, not as an effect-size source.

**12. Pooling reads introduces exactly the bias per-information-set confidence was built to remove**, and per-node independence throws away correlation that genuinely exists. There is a real bias-variance tradeoff here and **the literature does not resolve it for humans.** The archetype portfolio is the structured-prior answer; per-node independence is the fallback until the archetypes are calibrated.

**13. Balanced play as prober vs the ε budget pulls in opposite directions and is not resolvable from the seat.** Stronger Nash strategies explored opponents better, but the robust-response literature needed a dedicated never-folding Probe agent and found self-play data strictly worse. The researchers sidestepped it with a throwaway seat. A learner cannot. The design's only response is asymmetric caution: assume your data is thinner and more showdown-biased than it feels.

**14. Calibration training's ceiling is 6–11% Brier improvement from a sub-one-hour tutorial**, and it improves reliability far more than resolution — that is, it fixes the mapping from felt-confidence to stated number without adding knowledge. Run the module once, early, then spend the remaining budget on poker-specific range knowledge where the resolution gains live. And that 6–11% comes from geopolitical forecasting among self-selected volunteers, not millisecond-scale in-game action prediction by beginners; treat it as an upper bound until measured in-app.

**15. Purification is a one-way trade that this design accepts knowingly.** It cut EV loss against a true equilibrium from 43.8 to 1.86 mb/h in Leduc but took Hyperborean from 235.2 to 437.2 mbb/h of worst-case exploitability in limit hold'em. For a beginner the trade is free because their own baseline exploitability dwarfs the difference. For a learner approaching the criterion, it stops being free — and the manual does not currently specify where that crossover sits, because nobody has measured it.

**16. EV loss against a solver is not the same construct as win rate against humans.** A learner can drive assessment-mode RW to near zero while exploiting nobody, and a system can improve the former while the latter is swamped by variance for tens of thousands of hands. That is why the two-metric scoreboard exists, and why **no win-rate delta is promised anywhere in this document.**

**Three concrete repo changes implied.** `/Users/pranavgk/Documents/temp1/poke/src/core/coach.ts:91-95` — replace raw-bb severity with reach-weighted tiers plus the two overrides. `/Users/pranavgk/Documents/temp1/poke/src/core/session.ts:17-22` — replace hand-granularity `HandRecord` (with `net` as a first-class field) with the node-granularity `DecisionRecord`; delete `net` from the learning-mode schema. `/Users/pranavgk/Documents/temp1/poke/src/core/ai.ts:48-51` — jitter `PROFILES` parameters per session, hide the archetype label until after the hand, and add `lag`, `overfolder`, `maniac`, plus a `tagreg` the learner is scored for *not* deviating against.