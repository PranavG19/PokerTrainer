# Poker Trainer — Product Spec

**Status:** design-complete at feature level. Supersedes `SPEC.md` (which described the vibe-coded prototype; that file is left in place as a record, not a plan).
**Grounding:** `research/TEACHING-METHOD.md` (pedagogy), `research/DESIGN-NOTES.md` (visual language).
**Scope of this document:** features, modes, screens, teaching architecture, and the tutor/grader interlock. Not implementation decomposition.

---

## Problem

A complete beginner who wants to get good at poker has two options, and both fail.

**Play hands.** The feedback signal is the pot, whose standard deviation is ~100 bb/100. A single hand's result is drawn from a distribution so wide that it confirms bad rules as often as good ones. ~8% of 200-hand sessions lose two or more buy-ins at *zero* strategic error. Experience without an informative signal doesn't just fail to teach — across 62 evaluations of clinical experience, 52% found performance *declining* with years of practice.

**Use a solver or a chart app.** These fail for six structural reasons, none cosmetic: visible reference material inflates in-app fluency while storing nothing; no committed prediction means no discrepancy signal; bare verdicts (`-1.4bb`, a red X) measure d = 0.05, indistinguishable from no feedback at all; a 13×13 grid is ~400 item-level facts per node against a ~4-chunk working memory, presented as isolated cells with no organising principle to chunk against; guidance that helps a novice becomes actively harmful as schemas form; and the solver's *frequencies* — the part every trainer teaches — are the most abstraction-overfit part of its output.

The gap: **nothing converts solver output into a curriculum.** The learner needs perception installed before strategy, errors graded by what they actually cost, silence when nothing was lost, and a coach that asks rather than tells. A conversational tutor makes the asking possible for the first time.

## Solution

A local desktop app with six surfaces and a tutor that lives in a rail beside all of them.

You are never blocked. Every mode, lesson, drill, and chart is reachable from minute one. The app maintains a view of what you can and can't do and **recommends** your next step; you override freely, and overrides are logged so a plateau has a paper trail.

Underneath, a real solver's output — computed offline, shipped as data — grades your decisions by what they cost rather than by right/wrong, stays quiet when a decision cost nothing, and interrupts when it cost a lot. The tutor narrates those numbers, interrogates your reasoning, grades your stated *reason* separately from your action, and remembers the sentences you wrote in your own words.

**The promise is a criterion, not a rank:** your assessment-mode reach-weighted EV loss, in bb/100, going down. Never earnings, never a percentile.

---

## Vocabulary

Canonical terms. Used consistently throughout; an implementer should not invent synonyms.

| term | meaning |
|---|---|
| **node** | a decision point: `(positions × action history × board class × size bucket)`. The unit of observation. Not a hand. |
| **spot** | one graded presentation of a node to the learner |
| **spot bank** | the read-only data artifact of solver-computed nodes shipped with the app |
| **on-bank / off-bank** | whether a position exists in the spot bank. Off-bank positions are never graded. |
| **ΔEV** | EV(best action) − EV(chosen action) at a node, in bb, from solver node values |
| **reach** | P(node class occurs per hand dealt), against the reference bot population |
| **RW** | reach-weighted loss = ΔEV × reach × 100, in bb/100 |
| **tier** | severity class T0–T4, driving what the coach does |
| **KC** | knowledge component — one trainable skill, spanning many nodes |
| **PLM** | perceptual learning module — a fluency drill, graded on correct *and* fast |
| **fluency gate** | passing a PLM: correct AND under a response-time threshold |
| **lexicon entry** | a mechanism sentence the learner wrote, serving as a concept's name |
| **archetype** | a rule-based bot opponent with a named behavioural signature |
| **the rail** | the tutor chat drawer, present on every surface |
| **hat** | one of the tutor's five bounded roles |
| **session** | an assembled sequence of blocks launched by one button |

---

## The spine — six phases

Phases order *content*, not access. All are visible and enterable at any time; the recommender uses your position on this spine to decide what to suggest.

| phase | installs | advances when |
|---|---|---|
| **0 · Rules** | betting order, hand rankings, what the actions mean | you can act without asking what an action does |
| **1 · Eyes** | perception: 7-cards-to-best-5 under 2 s, texture dimensions, blockers, nut-advantage direction, range role | fluency gates pass |
| **2 · Arithmetic** | pot odds in natural frequencies, MDF, alpha, combos, SPR, the variance table | each reproducible to a number under time |
| **3 · Principles** | indifference, range vs nut advantage, equity realisation, polarity→size, blockers-as-selection, capped ranges, protecting the check range, domination | you can state each mechanism in your own sentence |
| **4 · Nodes** | the ~50 situated rules; the long middle of the product | per-KC mastery bars fill |
| **5 · Reads** | opponent-specific deviation, capped and reverted | baseline criterion met, read gates open |
| **6 · Maintenance** | nothing new; spacing waves continue indefinitely | never — steady state |

Charts belong to phase 4. They remain *reachable* in phase 0 (see Decision N3).

---

## User stories

**Onboarding and orientation**
1. As a total beginner, I want a one-screen explanation of the rules so I can act without knowing any strategy.
2. As a total beginner, I want the app to name the one thing to do next so I don't have to design my own curriculum.
3. As a learner, I want to ignore that recommendation and go anywhere without arguing with a locked door.
4. As a learner who overrode a recommendation, I want the app to have logged it so a later plateau is diagnosable.
5. As a returning learner, I want the home screen to show what I did last and what's due.

**Perception drills**
6. As a learner, I want single-keystroke forced-choice drills with feedback in under half a second and no prose.
7. As a learner, I want my response *time* to count, not just accuracy, so speed becomes real.
8. As a learner, I never want to see the same stimulus twice within a category.
9. As a learner mid-drill, I want the tutor rail closed so I'm not pulled into verbalising.
10. As a learner, I want a fluency gate to certify a category and to re-test it weeks later unannounced.
11. As a learner, I want every irrelevant surface feature randomised so I learn the structure, not the picture.

**Graded spots**
12. As a learner, I want to name the spot type myself before acting, because the app naming it deletes the skill.
13. As a learner, I want to commit an action, a size, and whether I'm `SURE` or `GUESSING`, with the solver panel structurally unreachable until I do.
14. As a learner, I want to state a reason in one line and have that reason graded separately from my action.
15. As a learner who was right for the wrong reason, I want to be told loudly — this is the case that otherwise installs a false rule permanently.
16. As a learner, I want silence when my decision cost essentially nothing, and I want to know in advance that silence means that.
17. As a learner making a large error, I want to be interrupted immediately rather than at end-of-block.
18. As a learner, I want a correction short enough to hold in my head — three chunks, sixty words, ending in a next action.
19. As a learner who erred, I want four near-identical variants that differ in exactly one variable, so I can find the boundary myself.
20. As a learner, I want to name the flipping variable in my own words and have that sentence become the concept's name.
21. As a learner, I want to be re-served that concept days and weeks later without warning.
22. As a learner, I want to ask "why?" mid-spot, get an answer, and see that it cost me a scaffolding rung.

**Live play**
23. As a learner, I want to play actual hands against opponents from day one, ungraded.
24. As a learner in a graded whole-task block, I want the pot outcome hidden and feedback batched to the end.
25. As a learner, I want opponents whose tendencies are learnable but whose labels are hidden until the hand ends.
26. As a learner, I want opponent parameters jittered per session so I learn to classify rather than memorise three caricatures.
27. As a learner in an off-bank position, I want to be told it's ungraded rather than given a fabricated grade.

**Reads and exploitation**
28. As a learner, I want a dossier per opponent showing what I've actually observed, with sample size beside every count.
29. As a learner, I want to pre-register at most two tendencies before a session, because scanning ten stats finds a fake leak in a baseline opponent 95% of the time.
30. As a learner, I want a deviation blocked until n ≥ 20 *and* the observed frequency is ≥15 points off baseline — two independent gates.
31. As a learner, I want to be taught that shrinkage is a magnitude control and never a safety mechanism.
32. As a learner, I want revert triggers to fire mechanically: two counter-actions halve, three revert, session end expires everything.
33. As a learner, I want my read *accuracy* graded against the bot's true frequencies, which no human coach can do.
34. As a learner, I want the gift ledger auto-populated from observed showdowns so I can't inflate it.

**Progress and honesty**
35. As a learner, I want exactly four numbers on my scoreboard and no chip graph.
36. As a learner, I want per-KC mastery bars so I can see that "folds too much to big bets" is one skill at twenty nodes, not twenty charts.
37. As a learner, I want a weekly assessment with no coach and no feedback until the end, and I want to be warned it will look worse than practice.
38. As a learner, I want the app to refuse to draw a results graph below 10,000 hands.
39. As a learner, I want my own lexicon of mechanism sentences quoted back to me in future corrections.
40. As a learner, I want fold decisions counted into a node-level aggregate at n ≥ 50, and never told "you folded 76s and would have flopped a straight."

**Tutor**
41. As a learner, I want to ask a rules question at any moment, including mid-hand, and get an answer.
42. As a learner, I want strategy questions refused before commit and answered after.
43. As a learner, I want to argue with the curriculum — "teach me 3-betting" — and get a real answer about what's missing.
44. As a learner without an API key, I want the entire app to work, with the tutor replaced by fixed text.
45. As a privacy-conscious learner, I want a plain statement of exactly what leaves my machine, and an off switch.
46. As a learner, I never want the tutor to state a number the engine didn't compute.

---

## Decisions

### Navigation

**N1 — Nothing is ever locked.** No mode, lesson, drill, or reference is gated behind progress. There is no "level", no unlock animation, no greyed-out nav.

**N2 — The recommender is a single suggestion, not a queue.** Home shows one recommended next action with a one-line reason (*"P4 range role: 8/10 correct but median 3.1 s, target 2.5 s"*). Its inputs: unpassed fluency gates in phase order, KC mastery posteriors, spacing debt (concepts past due), and the last session's top error tags. It never shows a ranked list — a list is a queue, and a queue is a soft lock.

**N3 — Early chart access is answered with juxtaposition, not refusal.** Opening a range chart before phase 4 renders the compressed form *first* and the grid beside it: six ordered hand classes, three verbal threshold rules for that position (≤12 words each), the ~12 boundary combos that actually flip the decision highlighted, and one line noting the grid is the reference expansion of those rules. All ~169 cells remain visible. Rationale: the method's objection is that the grid supplies no organising principle to chunk against — supplying the principle alongside removes the objection without removing the artifact.

**N4 — Every override is logged** as `{timestamp, recommended, chosen}`. Surfaced only in the phase-6 maintenance view and when the recommender's suggestion has been declined 5+ consecutive times, at which point it asks once what you'd rather work on and adjusts weighting.

**N5 — Five surfaces plus a rail.** Drill · Spot · Table · Dossier · Progress. Assessment is Spot mode with the coach disabled, not a sixth surface. Review is a mode of the hand just played. Home is a launcher, not a surface.

### Session assembly

**S1 — One button, adaptive length.** "Start session" takes a duration (15 / 30 / 50 min, default 30) and assembles blocks proportionally from the method's six ingredients:

| block | share of 50 min | scales |
|---|---|---|
| fluency warm-up (PLM) | 8% | proportional, min 1 block |
| decay probes | 6% | fixed count 4, or fewer if none due |
| graded spots | 48% | proportional |
| contrast remediation | 20% | proportional, min 1 contrast set |
| whole-task live hands | 14% | **dropped first** below 30 min |
| scoreboard | 4% | fixed |

**S2 — Degradation order is explicit.** Under time pressure, cut in this order: whole-task → warm-up length → graded spot count. Never cut decay probes (they are the only retention measurement) and never cut remediation below one contrast set (an un-remediated T2 is worse than an ungraded one, because it enters the spacing queue without a repair).

**S3 — Free-roam is first-class.** Modes entered outside a session behave identically except: decay probes never fire, and remediation defers to the next session rather than firing inline. Every decision is logged with `mode` so the recommender can distinguish structured from casual reps.

**S4 — Sessions are resumable, not restartable.** Quitting mid-session persists position; reopening offers resume or discard. Discard keeps the graded decisions already logged — they happened.

### Grading

**G1 — Dual-axis severity. This resolves a defect in the method as written.**

The method tiers on RW alone. Under its own reach table that inverts: a 0.6 bb BTN-RFI error (reach 0.092) scores RW 5.5 → *severe, interrupt*, while a 10 bb river blunder at an exact node (reach 0.0015) scores RW 1.5 → *bottom of the leak tier*. T4 would require ΔEV > 133 bb and **could never fire postflop at 100 bb**. As specified, the coach interrupts marginal opens and shrugs at stack-offs.

Decision: **tier = max(tier_RW, tier_absolute)**, where `tier_absolute` is keyed to ΔEV as a fraction of pot.

| tier | RW (bb/100) | ΔEV as pot fraction | coach action |
|---|---|---|---|
| **T0 free** | < 0.1 | < 2% | nothing, ever. Not logged as a leak, not in the tag histogram. |
| **T1 noise** | 0.1 – 1.0 | 2 – 8% | logged silently; weekly aggregate only |
| **T2 leak** | 1.0 – 5.0 | 8 – 20% | end-of-block correction; fires contrast set; enters spacing queue |
| **T3 severe** | 5 – 20 | 20 – 50% | in-hand interrupt; immediate re-serve; scheduled day 2 and 7 |
| **T4 catastrophic** | > 20 | > 50% | block, rewind, worked example, forced re-decision |

The pot-fraction axis also implements the method's ε (2% of pot) as the T0 floor, replacing a bb figure that doesn't calibrate across streets. The method's separate "magnitude flag at ΔEV ≥ 3 bb" override becomes redundant and is dropped — the absolute axis subsumes it and does so per-street.

**G2 — Reach is pooled, fixed, and versioned.** Computed at `(street × action class)` granularity — "faces any flop c-bet", not "faces BTN c-bet on K72r from BB". Exact-node reach is what produces the inversion above and is also unmeasurable at a solo learner's volume. Reach values are computed once against a **frozen reference bot population**, shipped in the bank, and carry a `referencePopId`. Live bots are jittered; reach never reads from them. Changing the reference population is a bank version bump, because it silently re-tiers every historical decision otherwise.

**G3 — Silence is declared, once, verbatim, on first launch,** and restated in the phase-0 screen: *"No comment means your decision cost under 0.1 bb/100. Silence is not praise."* The tutor rail is subject to the same rule — it does not congratulate a T0.

**G4 — Right-for-the-wrong-reason is T3 unconditionally,** overriding both axes, whenever ΔEV ≈ 0 and the reason grader returns `hand-strength` or `none`. This is the only case where silence installs a false rule, because the action, the verdict, and the chips all confirm it.

**G5 — The reason field is a closed set plus optional free text.** A dropdown/keyboard-selected principle name (from the phase-3 principle list plus `pot odds`, `MDF`, `alpha`, `I'm guessing`) is **required**; a free-text line is optional and, when present, is what the reason grader classifies. Rationale: closed-set selection is deterministically assertable in tests and works with no API key; free text is where the generation benefit and the wrong-reason detection live. With no key, `G4` degrades to firing only when the closed-set choice is `I'm guessing` — stated as a known reduction in Failure modes.

**G6 — Corrections are three chunks, ≤60 words, task-as-subject, ending in a next action.** Enforced by a guard (see T4), not by prompt instruction.

**G7 — One error tag per decision, upstream wins:** `RANGE > TEXTURE > PRICE > BLOCKERS > SIZING > DEPTH-POSITION > PURITY`. Reports aggregate by tag, never by trait — *"SIZING: 1.9 bb/100 across 340 decisions"*, never *"you're too loose"*.

**G8 — Confidence routing, 2×2.** SURE-correct → principle name only. SURE-wrong → full causal chain, immediate re-serve, scheduled day 2 and 7, difficulty up; this is the highest-value event in the system. GUESS-correct → full elaboration (the lucky guess that inflates every metric). GUESS-wrong → terse correction plus a worked example, higher repetition. Remediation queue ranks by **confidence × RW**, not RW alone. Self-reported confidence is cross-checked against response latency and flagged when they disagree persistently.

**G9 — Mixed nodes have two channels.** Support (was the action ever taken here?) tiers normally. Weight is scored at exactly zero, with one line explaining that the solver mixes because the actions are worth the same. Frequencies are **purified to modal** everywhere before phase 4, and the learner is told the frequency was discarded on purpose.

**G10 — Fold counterfactuals are node-level aggregates at n ≥ 50 only.** Per-hand fold reveals are prohibited in the string table, permanently. *"You folded 76s and would have flopped a straight"* teaches loose calling from n = 1.

### The spot bank

**B1 — Offline batch, shipped as data.** An open-source postflop solver (`bupticybee/TexasSolver` or `b-inary/postflop-solver`) runs as a **build-time job**, not at runtime. Runtime cost per flop tree is ~172 s and ~1.6 GB — live solving is not a design option. Output is a versioned, read-only artifact.

**B2 — Per-node provenance is mandatory.** Each node carries `solverConfigId`, tree description (bet sizes, depth), iteration count, achieved exploitability, and `referencePopId`. Where two configs disagree materially at a node, the app **surfaces the disagreement** and grades the node as mixed rather than picking a winner.

**B3 — Preflop is a coarse purified blueprint,** not solver output (both candidate engines are postflop-only). Source: published range sets or a small self-written preflop CFR. This is not a compromise — the method argues a finer memorised blueprint directly cannibalises the re-solving skill that is the actual target. Six hand classes, three verbal rules per position, ~12 boundary combos per position.

**B4 — Off-bank positions are never graded.** They get bots, equity display, and explicit silence: *"ungraded — no solver data for this node."* This is the method's own epistemology made structural: in spots you've never had graded, you have a hunch, not an intuition.

**B5 — Bank scope, v1:** 6-max, 100 bb primary with 40 bb and 200 bb sets for depth-interleaving; the ~50 phase-4 nodes plus their contrast-set variants; one to two bet sizes per street. Target ~300–600 solved nodes. Node coverage is a first-class product constraint, tracked and displayed — the learner can see which node families are gradeable.

**B6 — Contrast sets are generated from the bank, not authored.** Each variant toggles **exactly one** of `{suitedness, kicker/gap, position, players-behind, range-asymmetry, board texture, stack depth}`. Two variables changed means no feature is attributable. Generation fails loudly rather than emitting a two-variable pair; four variants on one simultaneous screen for rule extraction, then six novel variants distributed sequentially.

### The tutor

**T1 — BYO API key. This knowingly breaks the local-only constraint, and the break is scoped and stated.**

With no key, the app is fully functional and makes zero network calls. With a key, the tutor is live. The settings screen states plainly what leaves the machine: the current node (cards, board, action history), your typed reason text, your commit and confidence, the engine's computed numbers for that node, and your lexicon entries when quoted. Never: your decision log in bulk, your session history, your API key in any log, or anything at all while a drill or assessment is running.

**T2 — Downstream of the grader, always.** The engine computes every quantity. The tutor receives a payload and produces prose. It never grades, never decides correctness, never generates a number.

**T3 — Five hats, each bounded.**

| hat | input | output | may write to learner model |
|---|---|---|---|
| **Explainer** | tier, ΔEV, RW, error tag, principle, boundary hand, flipping variable | the three-chunk correction | no |
| **Interrogator** | the same, plus learner's reason | one question, ≤20 words | no |
| **Reason grader** | free-text reason, node | one of `range` / `price` / `hand-strength` / `none` | `reasonRefs` only |
| **Negotiator** | learner request, KC state, gate state | what's missing and the real next step | `override` event |
| **Answerer** | learner question, post-commit node state | an answer | `hintRequested` event |

**T4 — The guard is a pure function and the primary oracle.** Every tutor output passes: word count ≤60 (corrections) or ≤20 (questions); ban-list lint (no second-person trait attribution, no praise adjacent to a correction, no streak/rank/percentile language, no per-hand fold reveal); **number provenance** — every numeral in the output must appear in the input payload; and task-as-grammatical-subject. Fail → one regeneration, then fall back to the fixed string table. Guard failures are logged and visible in settings.

**T5 — Mute matrix.**

| context | strategy questions | rules questions | unprompted coach |
|---|---|---|---|
| PLM drill in progress | blocked | blocked | never |
| Spot, pre-commit | blocked | allowed | never |
| Spot, post-reveal | allowed | allowed | tier ≥ T2 only |
| Assessment | blocked | allowed | never |
| Table (ungraded) | allowed | allowed | never |
| Table (whole-task block) | blocked | allowed | batched to block end |
| Dossier / Progress | allowed | allowed | never |

Rules questions are always allowed because a zero-context beginner is otherwise stuck. The rules-vs-strategy classifier is a keyword allowlist over a fixed rules vocabulary — deterministic, testable, and biased toward refusal (ambiguous → treated as strategy).

**T6 — Hints are priced.** An answer mid-spot logs `hintRequested` and drops that concept one fading rung. Cost is shown before the answer, and it's reversible by clearing the rung on the next three consecutive correct.

**T7 — Fading ladder is per concept, never global.** Rungs 0–4: worked examples → full correction → principle name only → bare "incorrect" → batched self-marked review (where the 13×13 grid becomes a legitimate lookup index). Drop exactly one rung on that concept alone when accuracy falls under 70%. **A global difficulty level is forbidden** — it strips scaffolding from concepts never learned.

### The lexicon

**L1 — The learner's sentence is the concept's name.** On resolving a contrast set, the learner answers *"which variable flipped the answer, and why?"* An accepted sentence becomes the concept tag; all future feedback on that concept opens by quoting it.

**L2 — Acceptance criteria are explicit.** Accept sentences framed in domination risk, equity realisation, or range asymmetry. Reject cached cells (*"K7s is a CO open"*). With a key, the tutor classifies and pushes back once; with no key, acceptance falls back to a keyword check and the learner self-marks. Rejected attempts are kept — they're diagnostic.

**L3 — Lexicon entries are immutable once accepted, additive over time.** A concept may accumulate several sentences; the most recent is quoted, earlier ones are visible in the entry's history. Editing history would destroy the record of how understanding moved.

### Opponents

**O1 — Six rule-based archetypes:** nit, station, LAG, TAG-reg, over-folder, maniac. Never a dialled-down solver — weakening a strong engine does not produce human-like play, and a loosened GTO bot teaches exploits nobody offers.

**O2 — TAG-reg exists so "I don't know" has a home.** It maps to baseline, and the learner is scored for **not** deviating against it.

**O3 — Parameters jittered per session within a band; archetype label hidden until the hand ends.** Otherwise the learner overfits to three fixed caricatures instead of learning to classify. Jitter is seeded and reproducible.

**O4 — True frequencies are known, so reads are gradeable.** This is a genuine advantage over the research literature, which had to infer opponent models. Read accuracy is scored directly: Brier score on action forecasts, benchmarked against the **node base rate** (not against uniform — beating uniform is arithmetic, only beating the base rate is a read). Calibration curve withheld until 400 forecasts.

**O5 — The gift ledger auto-populates from observed showdowns,** in action-with-a-holding form. This removes the method's own worry that a motivated learner inflates a hand-kept ledger.

### Reads and deviation

**R1 — Two independent gates.** Go/no-go: `n ≥ 20` of that observable AND raw frequency ≥15 points off baseline. Magnitude: `w = n/(n+10)`, deviate by `w × full exploit`. The app teaches the trap explicitly — **shrinkage is sign-preserving, so it is a magnitude control and never a go/no-go control.**

**R2 — Pre-registration is enforced.** At session start, write at most two tendencies you'll track. Only those can license a deviation. Anything noticed opportunistically goes to a notebook and becomes next session's hypothesis with fresh data. Rationale: a baseline opponent scanned across ten stats at n=10 each shows a 15-point "exploitable" leak 95% of the time; pre-registration plus the n≥20 gate cuts the false-read rate to ~24%.

**R3 — Deviation breadth capped at three, node-selection capped at two.** At most three named deviations active per session, applied at the top two nodes by `(reach × bb per occurrence)` and not at all elsewhere. "Play looser against him" is the random-node-selection policy — it spends the whole budget and captures almost none of the gain, and the phrase is on the ban list.

**R4 — Revert triggers fire mechanically, not on judgment.** Two counter-actions → halve `w`. Three → baseline for the rest of the session. Session end → all reads expire, `n` resets to zero. Six contrary observations → gate re-closes. Ledger exhausted → drop the largest deviation. Justification: capped-and-reverted beats max-exploit-and-persist by ~15× on the method's own session arithmetic.

**R5 — Levelling is capped at L2 by arithmetic.** Suspecting you've been levelled routes to *baseline*, not to counter-levelling; entering L2 on suspicion costs 2.38 bb per occurrence. L2 requires four named counter-actions at that node. L3 would require ~26,000 hands and therefore does not exist in the product.

**R6 — Simulated observation streams, not 1,000 live hands.** The method's G3 gate wants 1,000 hands of baseline play before the module unlocks, which is 8–12 hours of table time in a system premised on live play being ~10× worse per minute. Replaced with generated observation sets — *"here are 20 observations of this villain; does the gate open, and where?"* — with live hands as a final integration check only.

### Progress display

**P1 — Four numbers, and only four:** graded decisions this week (target 200+); assessment-mode RW EV loss in bb/100; fluent categories passing a gate; SURE-wrong count this week.

**P2 — Per-KC mastery bars are the primary progress surface.** Task-level, so they don't violate the feedback law, and they carry the instructional payload: they show that "folds too much to big bets" is one skill expressed at twenty nodes rather than twenty charts. This is also the deliberate adherence concession — see Open questions.

**P3 — No results graph under 10,000 hands.** Above it, the chip graph renders *beside* the EV graph, and their divergence is the lesson. Below it, the app refuses and links the variance module.

**P4 — Weekly assessment: 30 interleaved spots, no coach, no equity, no feedback until the end,** classes drawn from ≥7 days earlier. Pre-framed in writing: assessment scores will look worse than practice scores, and the delayed test is the real one.

**P5 — Mastery gates.** A: perceptual fluency, correct AND under RT threshold, resurrect at 1 week and 1 month. B: KC mastery at posterior ≥ 0.90 with CI lower bound ≥ 0.85 and ≥12 opportunities, **hard cap 25 opportunities** → freeze the KC, surface the error signature, route to a worked example, never another rep. C: delayed unannounced novel-instance test, ≥85% on action and reason, ≥7 days after last exposure. D: exploit unlock. **"N correct in a row" gating is forbidden** — noise-sensitive and it interacts badly with the guess floor solver mixing creates.

**P6 — The learner model is a per-KC beta-binomial posterior with a decay term, not fitted PFA.** The method prescribes nightly L-BFGS over hundreds of parameters (per-KC difficulty, per-KC learning rates split by success/failure, learner random effect, per-item difficulty) plus per-KC isotonic recalibration. At ~200 decisions/week from one person that is not estimable — the method itself says to pool calibration below 200 held-out observations per KC, which will never be reached. A conjugate posterior with hand-set priors gives the same gate and the same visible bar, is better calibrated at n=12 than anything fitted, and is ~15 lines. The method's argument for multi-KC crediting is kept; its estimation machinery is dropped.

**P7 — Difficulty is automatic and never learner-set,** via a three-level ordering heuristic over prior difficulty × staleness × last outcome, targeting roughly 75–85% success on **novel instances only**. The method's per-KC [0.75, 0.85] band recomputed every 20 spots is not estimable at ~8 opportunities per KC per week; the heuristic approximates it without pretending to measure it.

### Visual language

**V1 — Offsuit, adapted to desktop.** True black canvas; `#1C1C1E`–`#2A2A2C` surfaces; near-white `#FAFAFA` card faces; rank top-left with suit pip directly beneath (not the traditional corner-index layout — this is the signature element); diagonal-hatch card backs; pill action buttons, no border, no shadow; huge light-weight numerals; sentence-case low-contrast labels; **mint `#3DDC97` as the only saturated accent**; generous emptiness. No felt, no table oval, no gradients in the game UI.

**V2 — Mint is reserved.** In the original it marks win%. Here it marks **win% and fluency-gate pass** only. Severity tiers use type weight and position, not colour — a red X is the d = 0.05 channel and colour-coding severity re-introduces it.

**V3 — DOM, never canvas.** Cards are rounded rects with text. DOM is inspectable by Playwright, which is the whole testability argument.

**V4 — The drill surface is visually fixed at first launch and never changes.** Card art, seat positions, stack display. Changing layout between drill and play forfeits part of the parafoveal gain that the perception layer is buying.

---

## Edge cases & states

| case | behavior |
|---|---|
| **No API key** | Full app, zero network calls. Tutor replaced by fixed string table. Reason grading falls back to closed-set only; `G4` fires only on `I'm guessing`. Settings states the reduction. |
| **API call fails / times out** | One retry, then fixed string table for that event. Rail shows a one-line notice. Never blocks the spot; the decision is already graded by the engine. |
| **Guard rejects tutor output twice** | Fixed string table. Logged; visible in settings diagnostics. |
| **Off-bank position in Spot mode** | Cannot happen — Spot mode draws only from the bank. Off-bank exists only at the Table. |
| **Off-bank position at the Table** | Equity shown, no grade, explicit "ungraded" marker. Not logged as a decision. |
| **Empty spacing queue** (first ~3 weeks) | Decay-probe block is skipped and its time reallocated to graded spots. The block is not shown as empty. |
| **No concepts due, no gates open** | Recommender suggests the earliest unpassed fluency gate; if all pass, the weakest KC by posterior; if none, assessment. |
| **Learner quits mid-spot** | The commit is either complete (logged, graded) or absent (discarded). No partial decision is ever persisted. |
| **Learner quits mid-session** | Position persisted; resume or discard on reopen. Already-logged decisions are kept either way. |
| **Bank version changes under an existing profile** | Historical decisions retain their original `bankVersion` and `referencePopId` and are **not** re-tiered. Mastery posteriors carry forward; the change is noted in the maintenance view. |
| **Learner requests a concept whose prerequisites are unmet** | Negotiator names exactly what's missing and offers both paths. Proceeding is always permitted and logged as an override. |
| **Reason field left blank** | Closed-set principle is required; commit is blocked until selected. Free text is genuinely optional. |
| **Stimulus pool exhausted in a PLM category** | Category is marked exhausted and rotates to held-out transfer stimuli; if those are exhausted too, the drill is disabled with a message rather than repeating. |
| **Contrast generator cannot produce a one-variable variant** | Fails loudly, logs the concept, falls back to a worked example. Never emits a two-variable pair. |
| **Learner tilted / error burst** | The method's "stay silent when tilted" has no sensor. Implemented as an explicit proxy: 3 consecutive T2+ with response times under 40% of personal median → offer to end the block, log for review, suppress in-hand interrupts for the remainder. Named as a proxy, not a tilt detector. |

---

## Security

**Trust boundary.** Single-user local desktop app. No server, no accounts, no auth, no multi-tenancy. There is no untrusted client and no privilege model — the only actor is the person at the keyboard, and they own the data and the machine.

**The one real surface is the API key and what accompanies it.**

- **Key storage:** OS keychain via Electron's `safeStorage`, never in the profile JSON, never in plain text, never in a log, never in a crash report, never in the replay cache. Redacted from any diagnostic export.
- **Egress allowlist:** exactly one host, the configured model provider. Any other outbound request is a bug and is asserted against in tests. With no key configured, the allowlist is empty and any request fails the test suite.
- **What is sent, per call:** current node (hole cards, board, action history, stacks, pot), the learner's commit and confidence, their typed reason text, engine-computed numbers for that node, and lexicon entries when quoted. Bounded to one node — never a decision log, never session history, never bulk export.
- **What is never sent:** the decision log, session history, the profile file, the API key in any prompt, and anything at all during a PLM drill or assessment block (structurally — the rail is closed and the IPC channel is not connected in those modes).
- **Renderer isolation:** `contextIsolation` on, `nodeIntegration` off, network calls made from the main process only. The renderer cannot reach the network or the filesystem directly. This makes the mute matrix structural rather than merely enforced in UI code: pre-commit, the main process has not sent the solver payload to the renderer, so no renderer bug can leak it.
- **Prompt injection surface:** the learner's own typed text is the only free input, and it flows into their own tutor call. There is no other user and no shared content, so injection can only affect the injector's own session. The guard's number-provenance check bounds the damage regardless.
- **Logging:** decision records, guard failures, and override events are logged locally. API request/response bodies are logged **only** into the opt-in replay cache, which is developer-facing and off by default in a shipped build.

**Enforcement placement.** Pre-commit solver unreachability, drill-time tutor muting, and no-key-means-no-network are **structural** (payload absent from the renderer; IPC channel unconnected; empty allowlist) rather than merely detected by tests. The ban list, word counts, and number provenance are **detection** via the guard — structural is not possible for natural-language properties, and the guard plus fixed-string fallback is the honest ceiling.

**Reversibility.** All operations are local and reversible except two, which get a human-gated path with an explicit confirm: **delete profile** (destroys the decision log — the only irreplaceable artifact, since the spot bank is rebuildable and the code is in git) and **reset a KC's history**. Profile writes are atomic (write-temp-then-rename) so a crash mid-write cannot corrupt the log. A rolling backup of the last 3 profile versions is kept.

**AGPL.** Both candidate solvers are AGPL-3.0. Personal local use is unproblematic. The obligations attach to *distribution* and *network service*. Decision: the solver is a **build-time tool that is not distributed with the app**; only its numeric output ships. This is the same posture as compiling with a GPL toolchain, but it is not legal advice, and the boundary should be re-examined before any public build. `TexasSolver`'s own FAQ additionally distinguishes bundling the release binary from integrating the source — relevant if the build job is ever automated for others.

---

## Scale & performance

Single user, single machine. Everything is small; the constraints worth naming:

| thing | volume | bound |
|---|---|---|
| decision log | ~200/week → ~10k/year | append-only JSONL. No pruning; ~10k records is a few MB. Aggregates precomputed on write, so no read ever scans the whole log. |
| spot bank | 300–600 nodes | read-only, loaded lazily per node, indexed by `nodeKey`. Solved offline, so runtime cost is a file read. |
| PLM stimuli | 300+ per category | flops are 22,100 combinations — generated, not stored. Uniqueness tracked as a seen-set per category. |
| equity computation | live, at the Table | Monte Carlo in a worker, ~2,000 iterations for ±1%. Off the render thread. |
| tutor call | one per correction | streamed into the rail; the correction is already computed and displayed by the engine, so latency never blocks grading. |
| hand history | unbounded | capped at the last 500 hands with full detail, older ones reduced to their decision records. |

**Hot path:** the recommender runs on home-screen load and reads only precomputed per-KC aggregates — never the raw log. **First bottleneck to watch:** contrast-set generation, which searches the bank for one-variable neighbours; if it exceeds ~50 ms, precompute the neighbour graph at build time.

## Concurrency

Single-user, single-window, single-process-of-record. Genuine concurrency is limited to:

- **Renderer/main IPC ordering.** A commit is a single message and the grade is computed in main; the renderer cannot grade or double-grade. Double-submit is prevented by disabling the commit control on send and by an idempotency key per spot presentation.
- **Worker equity results arriving late.** Tagged with the presentation ID; a result for a stale presentation is discarded.
- **Tutor response arriving after the learner moves on.** Tagged likewise and dropped. The rail never retro-fills a spot the learner has left.
- **Profile writes.** Serialized through a single writer in main, atomic rename, no read-then-write on counters — aggregates are updated under the same lock as the append.
- **Second app instance.** Prevented (single-instance lock); a second launch focuses the existing window. Two processes writing one profile is the only real corruption risk and it's eliminated rather than handled.

## Lifecycle

- **Profile** created on first launch; one per machine, no multi-profile in v1.
- **Decision records** are immutable once written. Corrections to grading (e.g. a bank fix) append a superseding record rather than editing history.
- **Lexicon entries** are immutable and additive (L3).
- **Concepts** are never deleted; a frozen KC (25-opportunity cap) stays visible with its error signature.
- **Deletes** are hard, human-gated, and confirmed: delete profile, reset KC.
- **Bank upgrades** are additive and versioned. Old decisions keep their `bankVersion`. A node removed from the bank keeps its historical decisions and stops being served.
- **Incremental shipping order:** phase 1 (Drill + fluency gates, no solver needed — the evaluator and Monte Carlo equity suffice) → phase 2–3 (Arithmetic, Principles, no bank needed) → Table + bots → the bank + Spot + grading → tutor → Dossier + reads. **The perception layer ships first because it has no solver dependency**, and the tutor ships late because the guard and fixed string table have to exist first anyway.

## Failure modes

| dependency fails | behavior |
|---|---|
| tutor API unreachable, slow, rate-limited, or returns malformed output | one retry → fixed string table. Grading, spacing, and gates are unaffected because they never depended on it. |
| API key invalid or revoked | tutor disabled with a settings notice; app continues fully. |
| spot bank file missing or corrupt (checksum) | Spot mode disabled with an explicit message; Drill, Table, and Progress continue. Never grade against a partial bank. |
| profile file corrupt | restore from the newest of 3 rolling backups; if all fail, start fresh with an explicit warning rather than a silent reset. |
| equity worker crashes | equity display shows a dash; play continues. Never blocks an action. |
| solver disagreement at a node (B2) | node is served as mixed and the disagreement is surfaced. Not silently resolved. |
| guard rejects repeatedly for one event type | fixed strings for that type, flagged in diagnostics. |

## Out of scope

Multiplayer, accounts, cloud sync, telemetry, real money, leaderboards, XP, streaks, cosmetics, a shop. Tournaments and ICM (cash only; the method has no verifiable MTT variance figures). Multiway theory beyond three-handed spots. Mobile and web. Multiple learner profiles. Importing hand histories from real sites. Live-solving at runtime. Bankroll management. A global difficulty setting (explicitly forbidden, not merely absent). Any promise expressed as earnings, rank, or percentile.

## Testing

**Seams, highest level first.** Playwright against real Electron for every surface (DOM, not canvas — V3). Vitest for the evaluator, the tier function, the guard, the contrast generator, the gate logic, and the recommender.

**Independent oracles, per claim** — the point being that a test the implementer also wrote is self-consistency, not verification:

| claim | oracle |
|---|---|
| hand evaluator is correct | differential against a published 7-card evaluator over exhaustive/large random samples — an external reference, not our own expectation table |
| tier assignment is correct | spec-literal table driven from the G1 matrix as data; the boundary cases (RW 0.099/0.101, pot fraction 1.9%/2.1%) asserted directly, and the previously-inverted cases (0.6 bb BTN RFI, 10 bb river) asserted to their intended tiers |
| solver EVs are sane | independent equity/Monte Carlo cross-check at nodes with analytically known answers; bank build fails on a mismatch beyond tolerance |
| pre-commit solver data is unreachable | assert on the **IPC payload**, not the DOM — the number must be absent from what the renderer received, so no CSS or DOM check can pass a leak |
| no network without a key | fail the test run on any outbound request; assert the allowlist is empty |
| guard enforces the feedback law | corpus of recorded tutor outputs, including adversarial ones, replayed through the guard; mutation testing on the guard itself, since it's the enforcement point |
| tutor invents no numbers | number-provenance property test over the recorded corpus: every numeral in output ∈ numerals in payload |
| deals are reproducible | same seed → identical board and hole cards, asserted |
| session degradation is correct | 15/30/50-minute assemblies asserted against the S1 table and the S2 drop order |
| contrast sets differ in exactly one variable | property test over generated sets: Hamming distance on the seven-variable vector is exactly 1 |
| fluency gates require speed, not just accuracy | a simulated learner at 10/10 accuracy but above the RT threshold must fail the gate |

**Tutor nondeterminism, three layers:** a **null tutor** returning fixtures (all e2e runs against it — the entire teaching machine is testable with no model present); a **replay cache** keyed by prompt hash for deterministic transcripts in CI; and the **guard as oracle**, which converts "did the coach behave" from a judgment call into an assertion.

**What a test asserts:** external behavior. That silence happened. That the interrupt fired. That the concept entered the queue with the right due date. That the correction was ≤60 words with the task as subject. Never that a particular function was called.

---

## Open questions

None blocking in a mandatory section. Six known risks, carried deliberately:

1. **Adherence is the largest untested assumption, and P2 is a deliberate deviation from the method.** Hours 1–7 are near-zero poker, silence means most decisions produce nothing, every motivational surface is banned, and assessment is pre-framed as looking worse than practice. For a solo learner that's a churn cliff. The concessions — always-open Table from minute one, per-KC bars as the primary progress display — are adherence choices, not research-backed ones, and are labelled as such. **No citation supports them and none is claimed.**
2. **Reason grading depends on a model that may not be good enough.** `G4`, the single sharpest rule in the method, needs a text classifier that can tell *"my range is capped here"* from *"I have top pair."* If the chosen model is unreliable at that, `G4` degrades to the closed-set-only version and the method's best rule is materially weakened. Measure classifier agreement against hand-labelled reasons before trusting it.
3. **Reach pooling (G2) is a decided trade, not a solved problem.** Pooling reintroduces exactly the bias per-node weighting was meant to remove — it tells you that you over-fold somewhere, not where. The alternative inverts the tiers. Instrument tier distribution and revisit if T3 rate strays far from a few percent of decisions.
4. **N=1 statistics bound what the learner model can honestly claim.** ~8 opportunities per KC per week means no per-KC success band, no per-KC calibration curve, no data-driven KC splitting. P6 and P7 substitute honest heuristics. The KC graph is therefore **authored and hand-tuned**, where the method wants it discovered from error curves — a real loss, and the reason the 60–120 KC cap matters.
5. **The 85% target-success figure is derived for stochastic-gradient binary classifiers**, not humans making multi-action decisions with mixed-strategy optima. It's an instrument setting to tune, not a law. At a node with three near-equal actions the correct error rate is genuinely undefined.
6. **AGPL and the local-only break are both stated tradeoffs, not resolved constraints.** The solver posture (build-time tool, output-only distribution) should be re-examined before any public build. The tutor's network access is a knowing override of the original local-only parameter, scoped as narrowly as the feature allows.

Also inherited from the source document and worth keeping visible: **zero perceptual-learning studies have ever been run on poker.** Every transfer claim in phase 1 is inferred from butterflies, ECGs, histopathology, and cockpit instruments. The largest single risk is the **taxonomy** — perceptual learning installs whatever boundaries you present and resists later verbal correction, so if STATIC/SEMI/DYNAMIC or the seven role labels are fuzzy or solver-inconsistent, the fuzziness is installed permanently. Validate every label against the bank before showing a single trial.
