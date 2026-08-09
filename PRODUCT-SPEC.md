# Poker Trainer — Product Spec

**Version 2.** Revised against a five-angle adversarial review (30 findings) of v1, preserved at `PRODUCT-SPEC-v1-superseded.md`. Four root causes drove the revision: severity was computed by multiplying two quantities measured at different granularities (fixed in G0/G1); the bank was sized and costed in the wrong unit (fixed in B0–B7); the method's generative core had been inverted into recognition (fixed in G5/G5a); and several guarantees were claimed more strongly than they were secured (fixed in T3a/T4/T8 and the security section). Sections that correct v1 say so inline, so the reasoning is auditable rather than silently overwritten.

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
| **1 · Eyes** | perception: 7-cards-to-best-5 under 2 s, texture dimensions, blockers, nut-advantage direction, range role, **anomaly trigger** | fluency gates pass |
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
24. As a learner at the Table in any mode, I want the pot outcome hidden — stacks move, but no "you won 14 bb" and no session P&L — because that number is the misleading signal, and in a graded whole-task block I additionally want feedback batched to the end.
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

**S1 — One button, two lengths.** "Start session" takes a duration (**30 or 50 min**, default 30 — see S2a for why 15 is not offered) and assembles blocks proportionally from the method's six ingredients:

| block | share of 50 min | scales |
|---|---|---|
| fluency warm-up (PLM) | 8% | proportional, min 1 block |
| decay probes | 6% | fixed count 4, or fewer if none due |
| graded spots | 48% | proportional |
| contrast remediation | 20% | proportional, min 1 contrast set |
| whole-task live hands | 14% | **dropped first** below 30 min |
| scoreboard | 4% | fixed |

**S2 — Degradation order is explicit.** Under time pressure, cut in this order: whole-task → warm-up length → graded spot count. Never cut decay probes (they are the only retention measurement) and never cut remediation below one contrast set (an un-remediated T2 is worse than an ungraded one, because it enters the spacing queue without a repair).

**S2a — Session lengths are 30 and 50 minutes. There is no 15-minute session.** At 15 minutes the non-scaling floors — one warm-up block (~4 min), four decay probes (~3 min), one contrast set (~5 min), scoreboard (~2 min) — consume ~14 of the 15 minutes, leaving room for roughly one graded spot, which cannot satisfy Q1's interleaving constraint (≥7 classes, no consecutive repeats). Since S2 forbids cutting the floors, a 15-minute "session" degrades the graded block to near zero, i.e. it is a warm-up mislabelled as practice.

Instead, short sittings are served by **free-roam mode** (S3), where drills and a few graded spots run without decay probes, remediation floors, or a scoreboard. This is the honest version: a 15-minute sitting is practice, not a session, and the app calls it that. **A 30-minute session** allocates ~14 min of graded spots (≈11 spots), which clears the interleaving constraint.

**S2b — Warm-up floor reconciled.** S1's "min 1 block" for warm-up wins over S2's "cut warm-up length second": the cut order applies to warm-up *length above* one block, never below it. One block is the floor because a partial PLM block is not a fluency measurement.

**S3 — Free-roam is first-class.** Modes entered outside a session behave identically except: decay probes never fire, and remediation defers to the next session rather than firing inline. Every decision is logged with `mode` so the recommender can distinguish structured from casual reps.

**S4 — Sessions are resumable, not restartable.** Quitting mid-session persists position; reopening offers resume or discard. Discard keeps the graded decisions already logged — they happened.

### Grading

**G0 — The granularity rule, and the defect it repairs.**

**ΔEV and reach are measured at different granularities and must never be multiplied into a per-decision severity input.** ΔEV is a property of a *specific holding at a specific node*. Reach is a property of a *node class*. Their product overstates by a factor of P(holding | node), so `RW` was never a coherent per-decision quantity — which is why every attempt to tier on it produces a pathology (interrupting marginal preflop opens, shrugging at stack-offs, T4 unreachable postflop). Adding a second axis and taking `max` does not repair this: `max` is monotonic upward and therefore *structurally incapable* of fixing an over-fire, and a pot-fraction axis calibrated for postflop pots is catastrophic against a 1.5 bb preflop pot (T4 would begin at ΔEV 0.75 bb, so a routine open/fold error would trigger block-and-rewind).

Decision, and it governs everything below:

- **Per-decision severity is a function of ΔEV alone**, with bands calibrated per street (G1).
- **RW is an aggregate statistic**, computed over a node *class* across many decisions, used only for study prioritisation in the weekly report and the recommender (G2). It never determines what the coach says about a single decision.

This is a deliberate departure from the method, which tiers on RW directly. The method is right that reach-weighting is how you *prioritise study*, and wrong that it can grade a single decision.

**G1 — Per-decision severity: one axis, per-street bands.**

`severity(ΔEV, street)` — a pure function, no reach term. Bands are expressed as a fraction of the **pot as it stands at the moment of decision, before the learner's own action** (the single denominator definition; no other pot is ever used, and this is what the boundary tests assert against).

| tier | preflop (pot ≈ 1.5–7 bb) | flop | turn | river | coach action |
|---|---|---|---|---|---|
| **T0 free** | < 0.10 bb | < 3% | < 2.5% | < 2% | nothing, ever. Not logged as a leak, not in the tag histogram. |
| **T1 noise** | 0.10 – 0.35 bb | 3 – 10% | 2.5 – 9% | 2 – 8% | logged silently; weekly aggregate only |
| **T2 leak** | 0.35 – 1.2 bb | 10 – 25% | 9 – 22% | 8 – 20% | end-of-block correction; fires contrast set; enters spacing queue |
| **T3 severe** | 1.2 – 3.0 bb | 25 – 60% | 22 – 55% | 20 – 50% | in-hand interrupt; immediate re-serve; scheduled day 2, 7, 21 |
| **T4 catastrophic** | > 3.0 bb | > 60% | > 55% | > 50% | block, rewind, worked example, forced re-decision |

**Preflop is banded in absolute bb, not pot fraction.** The preflop pot is too small and too variable (1.5 bb walk vs 7 bb four-bet pot) for a fraction to calibrate; a 0.6 bb BTN-RFI boundary error lands T2 — an end-of-block correction, not an interrupt — which is the intended behaviour and the thing the previous design got wrong. Postflop bands narrow slightly by street because pots grow while stacks don't, so an equal pot fraction represents a larger share of remaining stack.

Sanity checks, which are also the required boundary tests: a 0.6 bb preflop open error → **T2** (not an interrupt). A 10 bb river blunder into a 40 bb pot → 25% → **T3** (interrupt). A stack-off blunder of 60 bb into a 40 bb pot → 150% → **T4** (reachable postflop, as it must be). A 0.02 bb flop deviation → **T0** (silent).

**G2 — RW is an aggregate, and its granularity is fixed and versioned.** Computed at `(street × action class)` granularity — "faces any flop c-bet", not "faces BTN c-bet on K72r from BB" — as `mean(ΔEV over decisions in that class) × reach(class) × 100`. Reach is computed once against a **frozen reference bot population**, shipped in the bank with a `referencePopId`, and never read from the live jittered bots. Uses: the weekly leak report, the study-priority ordering, and scoreboard metric #2. Non-uses: per-decision severity, silence, interrupts, contrast triggering. Changing the reference population is a bank version bump.

**G3 — Silence is declared verbatim, in the unit the grader actually uses.** On first launch and on the phase-0 screen: *"No comment means that decision cost almost nothing — under 2% of the pot. Silence is not praise."* The contract is stated in the same quantity `severity()` consumes, so it cannot be falsified by the grader (the previous version promised a bb/100 threshold while grading on something else). The tutor rail is subject to the same rule and does not congratulate a T0.

**G4 — Right-for-the-wrong-reason is T3 unconditionally,** overriding the severity function, whenever ΔEV is T0/T1 and the reason grader returns `hand-strength` or `none`. This is the only case where silence installs a false rule, because the action, the verdict, and the chips all confirm it.

**G5 — The reason field is free text, required. The closed set is a fallback, not the default.**

The learner types one line, and it must reference their **range** or the **price**. This is the generative act the method calls non-negotiable, and it is required on every graded spot in a session block.

A closed-set principle picker exists and is used in exactly three cases: (a) no API key is configured, (b) the tutor is unreachable after one retry, (c) the learner has typed nothing for 15 s and the budget expires. Rationale for the ordering — and this reverses v1 of this spec: closed-set *selection* is the answer-matching item class that the method's own citations measure at near-zero transfer, so making it the default path would ship the recognition task the product exists to replace. Test determinism is bought instead by the null-tutor stub and the reason-grader's recorded corpus, not by degrading the learner's task.

**G5a — The five-state protocol is implemented in full, with its time budgets.** Each state's budget is displayed as a thin bar; expiry advances the state rather than failing the spot.

| state | budget | content |
|---|---|---|
| 1 CLASSIFY | ≤6 s | one word from the closed spot-type set. **Never labelled by the app.** Scored independently of action accuracy. |
| 2 COMMIT | ≤20 s | action + size + `SURE`/`GUESS` |
| 3 REASON | ≤15 s | one typed line referencing RANGE or PRICE |
| 4 GATE | 8 s, 2 attempts | **pre-reveal** self-explanation prompt, ≤12 words, fired only when severity ≥ T2. Logged as `gateAttempts: 0|1|2`. |
| 5 REVEAL | — | EV per action, ΔEV, tier, one error tag, correction if the tier calls for it |

State 4 is a *pre-reveal* forced retrieval at the moment of maximum error signal; it was absent from v1 of this spec and its omission removed the second of the method's two generation demands. There is **no skip button** — "I don't know" is a commitment and scores as a miss.

**G6 — Corrections are three chunks, ≤60 words, task-as-subject, ending in a next action.** Enforced by a guard (see T4), not by prompt instruction.

**G7 — One error tag per decision, upstream wins:** `RANGE > TEXTURE > PRICE > BLOCKERS > SIZING > DEPTH-POSITION > PURITY`. Reports aggregate by tag, never by trait — *"SIZING: 1.9 bb/100 across 340 decisions"*, never *"you're too loose"*.

**G8 — Confidence routing, 2×2.** SURE-correct → principle name only. SURE-wrong → full causal chain, immediate re-serve, scheduled day 2 and 7, difficulty up; this is the highest-value event in the system. GUESS-correct → full elaboration (the lucky guess that inflates every metric). GUESS-wrong → terse correction plus a worked example, higher repetition. Remediation queue ranks by **confidence × class-level RW** — the aggregate from G2, since a per-decision RW does not exist under G0. Self-reported confidence is cross-checked against response latency and flagged when they disagree persistently.

**G9 — Mixed nodes have two channels.** Support (was the action ever taken here?) tiers normally. Weight is scored at exactly zero, with one line explaining that the solver mixes because the actions are worth the same. Frequencies are **purified to modal** everywhere before phase 4, and the learner is told the frequency was discarded on purpose.

**G10 — Fold counterfactuals are node-level aggregates at n ≥ 50 only.** Per-hand fold reveals are prohibited in the string table, permanently. *"You folded 76s and would have flopped a straight"* teaches loose calling from n = 1.

### The spot bank

**B0 — Solve, node, and spot are three different units. Costing or sizing the bank in the wrong one is the error this section exists to prevent.**

| unit | definition | rough count in v1 |
|---|---|---|
| **solve** | one solver run over one action tree from one starting configuration (flop + both ranges + stack depth + bet-size set). The unit of *build cost*. | 200–400 |
| **node** | a decision point reachable inside a solve: an action history at a street, including every turn/river runout. The unit of *coverage*. | ~10⁴–10⁵, essentially free once the solve exists |
| **spot** | one presentation to the learner: `(node × holding)`. The unit of *practice supply* and of "novel instance". | ~10⁶+ |

A single solve yields per-hand EVs for **every holding in the range at every node in its subtree**. So the practice supply is the product of nodes and holdings, not the count of solves. v1 of this spec sized the bank at "300–600 nodes" and then claimed "novel instances only" as the defence against memorisation — those two statements were incompatible at the *node* level and are trivially compatible at the *spot* level. Every downstream rule now names which unit it means.

**B1 — Offline batch, shipped as data, using one specific solver.** **`b-inary/postflop-solver`** (Rust, AGPL-3.0). This is not interchangeable with `bupticybee/TexasSolver`: verified against the source, `postflop-solver` exposes `expected_values_detail(player)` returning per-action-per-hand EVs (`src/game/interpreter.rs:713`), which is the exact substrate `severity()` consumes, while TexasSolver's documented output is a strategy-frequency JSON dump with no documented per-hand EV field. Choosing TexasSolver leaves the grading layer with no substrate.

**B1a — The build harness is a first-class deliverable, not a clause.** A bespoke Rust program that, per solve: constructs the tree, solves to a target exploitability, then walks every node — `apply_history` / `play` to navigate, **`cache_normalized_weights()` after each mutation** (the EV accessor panics without it), `expected_values_detail()` to read per-hand EVs — and serialises to the bank format. Constraints inherited from the crate: development suspended since Oct 2023, 32-bit floats, and the author states breaking changes ship without version bumps, so the dependency is **pinned to a specific commit** and vendored.

**B1b — Build cost is stated in solves, and it is not one overnight run.** At the published benchmark (~172 s, ~1.6 GB for a 1–2-bets-plus-allin flop tree, 6 threads), 200–400 solves is **10–19 hours** of wall clock, serialised by memory rather than cores — 1.6 GB per concurrent solve caps parallelism on a typical machine at 2–4. Turn and river nodes inside a solved flop are free; a second bet size per street inflates the tree and the benchmark. B2's two-config disagreement check doubles everything. Plan a multi-day incremental build with resumable per-solve outputs, not a night.

**B1c — Persistence policy, which resolves the "few MB vs multi-GB" contradiction.** Two artifacts. The **served set** stores per-hand action EVs only at nodes the curriculum serves (~16 KB/node → a few MB; this is what the app loads at runtime). The **subtree set** stores continuation values needed for fold counterfactuals (G10), mixed-node support detection (G9), and blame assignment — multi-GB, generated by the same build, and **not shipped**; features depending on it either read it in a local dev configuration or are scoped out (see B7).

**B2 — Per-node provenance is mandatory.** Each node carries `solverConfigId`, tree description (bet sizes, depth), iteration count, achieved exploitability, and `referencePopId`. Where two configs disagree materially at a node, the app **surfaces the disagreement** and grades the node as mixed rather than picking a winner.

**B3 — Preflop is a coarse purified blueprint,** not solver output (the engine is postflop-only). Source: published range sets or a small self-written preflop CFR. This is not a compromise — the method argues a finer memorised blueprint directly cannibalises the re-solving skill that is the actual target. Six hand classes, three verbal rules per position, ~12 boundary combos per position. **Consequence, stated rather than hidden:** preflop nodes carry no solver ΔEV, so cross-street blame assignment cannot separate preflop from postflop attribution (see B7).

**B4 — Off-bank positions are never graded.** They get bots and explicit silence: *"ungraded — no solver data for this node."* **Equity is not displayed pre-commit anywhere** (see T8). This is the method's own epistemology made structural: in spots you've never had graded, you have a hunch, not an intuition.

**B5 — Bank scope, v1, stated in solves.** 6-max. Depths 40/100/200 bb. The six flop-texture classes the method names for c-bet (dry-ace-high, dry-king-high, low-connected, paired, monotone, broadway-two-tone), each represented by several distinct flops rather than one canonical board. Primary node families: BTN-vs-BB SRP, BB defence vs 3-bet, SB squeeze, turn probe, river bluff-catch. One to two bet sizes per street. **Target 200–400 solves**, which yields ~10⁴–10⁵ nodes and effectively unbounded spots. Coverage is displayed: the learner can see which node families are gradeable.

**B6 — Contrast sets require an engineered grid, and the grid is a build input.** Each variant toggles **exactly one** of `{suitedness, kicker/gap, position, players-behind, range-asymmetry, board texture, stack depth}`. Two of those seven — board texture and stack depth — require a *separately solved* tree, so contrast coverage is a property of which solves were built, not a search over whatever happens to exist. Therefore:

- The build takes an explicit **contrast-axis manifest**: for each of the ~50 phase-4 concepts, the base node plus the specific one-variable neighbours required. Those neighbours are solved *because* the manifest lists them.
- A **neighbour graph is precomputed at build time** (not searched at runtime — this also removes the 50 ms runtime budget concern) and the build **fails** if a manifested concept lacks its four rule-extraction neighbours. Missing neighbours are a build error, not a runtime fallback.
- Per-concept coverage is honest: most concepts will have neighbours on a *subset* of the seven axes. The manifest records which axes are available per concept, and the generator only offers toggles that exist.
- Runtime fallback to a worked example remains, but is now the rare case rather than the common one, which is what S2's "never cut remediation below one contrast set" requires to be satisfiable.

**B7 — Explicitly scoped out of v1, with the reason.** **Cross-street blame assignment by counterfactual ablation.** The method calls this poker's structural advantage over other tutoring domains, and it is genuinely unbuildable here: it needs solver EVs at preflop nodes (which B3 does not provide) and continuation values at arbitrary live-hand states (which the served set does not hold). Blame assignment is therefore **scoped to single on-bank postflop nodes**, and the method's multi-KC coupling claim — that one turn fold moves the estimate for river bluff-catching — is **not implemented in v1**. A decision touching multiple KCs credits them all equally, which the method warns against; the alternative is a false precision. This is the largest single capability loss in the spec and it is named here rather than in a footnote.

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
| **Answerer (post-commit)** | learner question, post-commit node state | an answer | `hintRequested` event |
| **Rules answerer (pre-commit)** | learner question + **rules-only context** (see T3a) | an answer | nothing |

**T3a — The pre-commit tutor payload is solver-free by construction.** Tutor requests originate in the main process, which *holds* the solver data — so "the payload is absent from the renderer" (T7) says nothing about what the model sees. Without this rule, a learner could ask a "rules question" pre-commit and get a strategically loaded answer, and number-provenance would not catch it because a qualitative hint ("the aggressive line looks right here") contains no numerals.

Decision: the pre-commit rules path is served by a **separate request builder** whose input type physically cannot carry solver fields — it receives the rules vocabulary and the *visible* table state (positions, stacks, pot, board, the learner's own cards) and nothing else. No ΔEV, no action EVs, no best action, no equity. Enforced by the type: the rules-request struct has no fields for them, so a leak requires changing the type rather than forgetting a check. The IPC test asserts on **both** the spot-presentation payload and every tutor request payload.

**T4 — The guard is a pure function and a *necessary* oracle. It is not sufficient, and here is exactly what it does and does not secure.**

Every tutor output passes, and all four checks are mechanically decidable:
1. **Word count** — ≤60 (corrections), ≤20 (questions).
2. **Ban-list lint** — regex over forbidden constructions: second-person trait attribution, praise adjacent to a correction, streak/rank/percentile language, per-hand fold reveal.
3. **Number provenance** — every numeral in the output must appear in the input payload.
4. **No leading second-person pronoun** — a checkable proxy for the method's "task as grammatical subject." **The full property is not pure-function decidable** (it needs a dependency parse plus semantic classification of the subject), so v1 of this spec overclaimed it as a guard check and as a test assertion. The proxy is what ships; the full property is a writing rule for the prompt and the fixed string table, not an enforced invariant.

**What the guard cannot secure, stated plainly because v1 leaned on it as though it could:** number provenance is *string membership*, so it passes output that is false using only permitted numerals (payload has pot 10 and bet 5; "risking 10 to win 5" inverts the relationship and passes) and it passes false claims containing no numerals at all ("your range is uncapped here" when it is capped). The guard bounds *form*, not *truth*. Truth is bounded instead by keeping the tutor downstream of the grader (T2) and by the pre-commit type restriction (T3a) — and residually it is not bounded at all, which is a real limitation of putting a language model in this seat.

Fail → one regeneration, then fall back to the fixed string table. Guard failures are logged and visible in settings.

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

**T8 — Equity is never displayed before a commit, anywhere.** The method's per-hand protocol makes an equity readout part of what must be unreachable pre-commit, and equity is a strong proxy for the correct action — so displaying it pre-commit defeats the same mechanism the solver lockout protects, while sitting outside T7's "solver payload absent from the renderer" guarantee (equity is computed renderer-side in a worker). Decision: equity is shown **post-reveal in Spot mode**, **post-hand at the Table**, and **never in assessment**. This corrects v1 of this spec, where B4 granted "equity display" at off-bank positions and P4 implied equity was normally visible pre-commit in Spot mode.

### The practice queue

**Q1 — Interleaving is a queue-construction rule, not an adjective.** v1 of this spec used the word "interleaved" twice and specified no mechanism, which invites exactly the "randomise everything" default the method identifies as wrong. The rule:

- **No two consecutive spots may share a spot class.** Hard constraint on queue assembly; the generator retries or reorders rather than emitting a same-class pair.
- A 20-spot block spans **≥7 classes** and interleaves stack depths 40/100/200 so depth is a cue to read rather than a mode announced in a heading.
- **Queues are built from confusion sets, not syllabi:** items with near-identical surface features and different correct actions (K7s-CO / K7o-CO / K9s-CO / K7s-UTG / K7s-vs-UTG-open).

**Q2 — Interleaving is conditional, and the negative case is specified.** Interleaving pays at *high between-category similarity* and reverses at low similarity (the method cites word learning at g = −0.39, favouring blocking). Therefore: **never interleave across low-similarity module boundaries** — preflop RFI is not mixed with pot-odds arithmetic, variance, or bankroll content in the same block. Those are blocked by module. Blocking is also correct, and only correct, on the first exposure to a genuinely new concept (fading rung 0).

**Q3 — In-session accuracy cost is pre-framed in writing before the first interleaved block:** accuracy drops 20–30 points relative to blocked practice, and that is the intended trade.

**Q4 — The spacing schedule is implemented in full, and gaps are flat, not expanding.** Per concept, embedded unannounced in the normal queue — never a "review session."

| day | reps | mode |
|---|---|---|
| 0 | 10 | blocked micro-block, first exposure |
| 1–2 | 4 | interleaved |
| 7 | 4 | interleaved |
| 21 | 3 | interleaved |
| 30–45 | 2 | **decay probe**, unannounced, feedback withheld to session end |

v1 of this spec implemented only "day 2 and 7" and dropped the day-21 and day-30–45 waves, which are the ones carrying durable retention (the optimum gap is ~5–10% of the target retention interval, so ~18–36 days for "still correct in a year"). **Do not build 1/2/4/8/16** — equally spaced retrieval beats expanding for long-term retention, and expanding intervals are convention rather than evidence. Remediation is never compressed into 1/2/3-day chains, which is massing wearing spacing's clothes.

**Q5 — Mastered concepts never exit rotation.** One decay-probe miss reopens the contrast set and resets to a 7-day gap. Two misses return the concept to active learning with 6 remaining opportunities — not a full reset.

**Q6 — The debiasing A/B is mandatory and both halves are required.** Around hour 10: train one boundary family **interleaved** and a matched family **blocked**, test both unannounced at day 7, show the scores side by side with the concepts named — *and separately* explain why blocking felt more effective (fluency during study is not retrievability later). v1 of this spec dropped this entirely while independently naming chart-grinding reversion as its own largest risk; this is the method's only prescribed countermeasure. The learner's interpretation is **pre-committed in writing before the test**, because at ~15 items per condition the result can come out the wrong way by chance and an uncommitted learner will read a null as vindication. Expect to re-run it, and expect reversion under pressure regardless.

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

**O6 — The pot outcome is hidden at the Table in every mode, not only in graded whole-task blocks.** Stacks update, but no per-hand "you won 14 bb" and no running session P&L. Rationale: v1 of this spec scoped outcome-hiding to the graded block and left the always-open free-roam table showing pot results — which reinstalls the σ ≈ 100 bb/100 signal the entire method exists to delete, for a beginner, before any perception or arithmetic is built. The method's evidence is not merely that unaided play teaches slowly but that it can teach *negatively*. The always-open Table stays (it is the adherence floor), but it does not show the misleading signal.

**O7 — The robustness drill: four continuations.** On a graded spot, after reveal, the learner evaluates their line against four opponent continuations — equilibrium-ish, fold-biased, call-biased, raise-biased. A line best against exactly one and bad against the others is a leak; a line fine against all four is robust. This buys exploitability intuition with zero exploitability computation, and it is available from the served set without extra solves (the four continuations are re-weightings, not new trees). Labelled a heuristic, never a bound.

**O8 — The two-speed switch is installed, not taught.** Default: recognise `node + texture + role` and play the trained line. Deliberate: engage only when a slot is anomalous. The anomaly trigger is drilled as a phase-1 PLM (`is this standard? y/n`, 15% seeded anomalies) with an explicit trigger list — off-tree sizing, unfamiliar texture class, stack depth outside the trained range, a read that contradicts the frame. v1 of this spec omitted both the drill and the switch.

### Reads and deviation

**R1 — Two independent gates.** Go/no-go: `n ≥ 20` of that observable AND raw frequency ≥15 points off baseline. Magnitude: `w = n/(n+10)`, deviate by `w × full exploit`. The app teaches the trap explicitly — **shrinkage is sign-preserving, so it is a magnitude control and never a go/no-go control.**

**R2 — Pre-registration is enforced.** At session start, write at most two tendencies you'll track. Only those can license a deviation. Anything noticed opportunistically goes to a notebook and becomes next session's hypothesis with fresh data. Rationale: a baseline opponent scanned across ten stats at n=10 each shows a 15-point "exploitable" leak 95% of the time; pre-registration plus the n≥20 gate cuts the false-read rate to ~24%.

**R3 — Deviation breadth capped at three, node-selection capped at two.** At most three named deviations active per session, applied at the top two nodes by `(reach × bb per occurrence)` and not at all elsewhere. "Play looser against him" is the random-node-selection policy — it spends the whole budget and captures almost none of the gain, and the phrase is on the ban list.

**R4 — Revert triggers fire mechanically, not on judgment.** Two counter-actions → halve `w`. Three → baseline for the rest of the session. Session end → all reads expire, `n` resets to zero. Six contrary observations → gate re-closes. Ledger exhausted → drop the largest deviation. Justification: capped-and-reverted beats max-exploit-and-persist by ~15× on the method's own session arithmetic.

**R5 — Levelling is capped at L2 by arithmetic.** Suspecting you've been levelled routes to *baseline*, not to counter-levelling; entering L2 on suspicion costs 2.38 bb per occurrence. L2 requires four named counter-actions at that node. L3 would require ~26,000 hands and therefore does not exist in the product.

**R6 — Simulated observation streams, not 1,000 live hands.** The method's G3 gate wants 1,000 hands of baseline play before the module unlocks, which is 8–12 hours of table time in a system premised on live play being ~10× worse per minute. Replaced with generated observation sets — *"here are 20 observations of this villain; does the gate open, and where?"* — with live hands as a final integration check only.

### Progress display

**P1 — Five numbers, and only five:** graded decisions this week (target 200+); assessment-mode RW EV loss in bb/100 (the class-level aggregate from G2); fluent categories passing a gate; SURE-wrong count this week; and **win rate vs the bot population**, shown only above 2,000 hands against a fixed bot config.

The fifth is the ground-truth loop, added because the other four are all measured against the training artifacts themselves — the method concedes solver-EV-loss is a different construct from winning, so a product with no humans in it needs *some* outcome signal or it cannot see its own proxy gap. It is framed as an instrument, never a promise: displayed with its confidence band, never as a trend line, and never as a target. It is the one place an outcome number is permitted, and it is permitted because it is aggregated over thousands of hands rather than attached to a decision.

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
| **Off-bank position at the Table** | No grade, explicit "ungraded" marker, equity shown only after the hand (T8). Not logged as a decision. |
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
- **Chromium and Electron are silenced explicitly, because the app-level allowlist does not govern them.** `autoUpdater` never initialised; `crashReporter` never started; no remote fonts, stylesheets, scripts, or source maps (all assets bundled local); safe-browsing, spellcheck download, and domain-reliability disabled via command-line switches. Enforcement and test both sit at **`session.webRequest.onBeforeRequest` plus a loopback proxy**, so the check covers the whole browser process rather than only the app's own HTTP client — v1 of this spec asserted "any outbound request" while specifying an app-level allowlist, which would not have caught a single one of these sources.
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
- **Deletes.** Exactly one hard delete exists: **delete profile**, human-gated and confirmed, which destroys the decision log (the only irreplaceable artifact). **"Reset KC" is not a delete** — v1 of this spec listed it as one, contradicting both record immutability and "concepts are never deleted." It clears a KC's *derived* posterior and scaffolding rung, leaves every underlying decision record intact, is fully recomputable from the log, and is therefore reversible and not human-gated.
- **Derived aggregates are recoverable by definition, not merely written carefully.** Gates and the recommender read precomputed per-KC aggregates rather than the raw log, so a crash between the log append and the aggregate write would otherwise leave a correct log and a stale aggregate with no repair path. Decision: every aggregate is a **pure function of the log**, each carries the offset of the last record it incorporated, and startup replays any tail beyond that offset. Aggregates are a cache, never a source of truth.
- **Bank upgrades** are additive and versioned. Old decisions keep their `bankVersion`. A node removed from the bank keeps its historical decisions and stops being served.
- **Incremental shipping order:** **Drill tier A** (P0 card floor, P1a–e texture dimensions, P5 blockers — pure combinatorics, no bank) → phase 2–3 (Arithmetic, Principles, no bank) → Table + bots → **the bank build** → **Drill tier B** (P2, P3, P4, P6, P7 — bank-dependent labels, see D1) → Spot + grading → tutor → Dossier + reads. The tutor ships late because the guard and fixed string table must exist first regardless.

**D1 — Perception drills split into two tiers by label provenance, and only tier A ships before the bank.** v1 of this spec claimed "the perception layer ships first because it has no solver dependency." That is true of three drill families and false of five, and the false half includes the flagship:

| drill | label source | tier |
|---|---|---|
| P0 best-5-of-7 | hand evaluator | **A** — pure combinatorics |
| P1a–e pairedness / connectivity / suitedness / high-card class / overpair-availability | board combinatorics; overpair-availability = count of pocket pairs beating the board | **A** |
| P5 blockers | combinatorics over the nut-making holdings | **A** |
| P2 STATIC / SEMI / DYNAMIC | **needs a defined boundary that exists nowhere in the method.** Derived from the bank: equity-shift distribution across runouts, thresholded, then hand-audited | **B** |
| P3 nut-advantage direction | range-vs-range nut-region comparison at a node — needs bank ranges plus a "nut" threshold definition | **B** |
| P4 range role (7 labels, the flagship) | the holding's position in the range's equity distribution at that node — needs bank output | **B** |
| P6 nut-changing runouts | per-runout equity recomputation against the node's ranges | **B** |
| P7 anomaly trigger | requires a notion of "standard action," which only the grader defines | **B** |

**Every tier-B label is a build-time artifact with a written derivation function and a hand-audited sample, and the derivation is a build gate:** if a meaningful fraction of boards come out ambiguous under the threshold, the taxonomy is not ready and that drill does not ship. This is not optional polish — perceptual learning installs whatever boundaries it is shown and resists later verbal correction, so a fuzzy STATIC/SEMI/DYNAMIC boundary is a permanent installation. The method names this as the single largest risk in the whole design; this spec makes it a gate rather than an aspiration.

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
| tier assignment is correct | spec-literal table driven from the G1 per-street matrix as data. Required cases, each asserted to its intended tier: 0.6 bb preflop open → **T2, not an interrupt**; 10 bb river into a 40 bb pot → T3; 60 bb stack-off into 40 bb → **T4, proving T4 is reachable postflop**; 0.02 bb flop deviation → T0. Denominator is pot-before-the-learner's-action, so every boundary is computable. |
| severity never reads reach | property test: `severity()` is a pure function of `(ΔEV, street, pot)`; a mutation injecting a reach term must fail. This is the G0 invariant and it is the one most likely to be silently reintroduced. |
| solver EVs are sane | independent equity/Monte Carlo cross-check at nodes with analytically known answers; bank build fails on a mismatch beyond tolerance |
| pre-commit solver data is unreachable | assert on **both** IPC payloads — the spot presentation *and* every tutor request. The pre-commit rules-request type has no solver fields, so the assertion is a type-level check plus a runtime payload snapshot. No DOM or CSS check can pass a leak. |
| equity is not shown pre-commit | assert the equity value is absent from the pre-commit renderer payload in Spot mode and from the Table during a live hand |
| no network without a key | loopback proxy plus `session.webRequest.onBeforeRequest`; the run fails on *any* request from the browser process, not just the app's HTTP client. Separately assert autoUpdater and crashReporter are never initialised. |
| guard enforces the feedback law | corpus of recorded tutor outputs, including adversarial ones, replayed through the guard; mutation testing on the guard itself, since it's the enforcement point |
| tutor invents no numbers | number-provenance property test over the recorded corpus. **Known incomplete:** this cannot catch a false relationship among permitted numerals, nor a false numeral-free claim (see T4). No oracle in this spec closes that gap. |
| deals are reproducible | same seed → identical board and hole cards, asserted |
| session assembly is correct | 30- and 50-minute assemblies asserted against the S1 table and the S2 drop order; assert that no 15-minute session can be constructed (S2a) |
| the queue actually interleaves | property test over assembled blocks: no two consecutive spots share a class, ≥7 classes per 20-spot block, depths mixed — the Q1 constraint, which v1 of this spec left unspecified |
| spacing waves fire at the right times | simulated 60-day timeline asserts reps land at day 0/1–2/7/21/30–45 per concept, and that intervals are flat rather than expanding |
| contrast sets differ in exactly one variable | property test over generated sets: Hamming distance on the seven-variable vector is exactly 1. Build-time assertion that every manifested concept has its four rule-extraction neighbours. |
| fluency gates require speed, not just accuracy | a simulated learner at 10/10 accuracy but above the RT threshold must fail the gate |
| tier-B drill labels are unambiguous | build gate: sample of each tier-B category hand-audited against its derivation function; a category exceeding an ambiguity threshold blocks that drill from shipping (D1) |

**Tutor nondeterminism, three layers:** a **null tutor** returning fixtures (all e2e runs against it — the entire teaching machine is testable with no model present); a **replay cache** keyed by prompt hash for deterministic transcripts in CI; and the **guard as oracle**, which converts "did the coach behave" from a judgment call into an assertion.

**What a test asserts:** external behavior. That silence happened. That the interrupt fired. That the concept entered the queue with the right due date. That the correction was ≤60 words with the task as subject. Never that a particular function was called.

---

## Open questions

None blocking in a mandatory section. Nine known risks, carried deliberately. The first two are **pre-build experiments, not carried risks** — they are cheap, they gate months of work, and they should be run before the bank build starts.

1. **The product optimises a proxy and, as of v1 of this spec, contained no instrument to see the gap. Now partly fixed; the residue is real.** The method concedes that EV loss against a solver is not the same construct as winning against humans — a learner can drive assessment RW to near zero and exploit nobody. Since there are no humans in the product, both scoreboard metrics were measured against the training artifacts themselves. **Added: `win rate vs the bot population` as a ground-truth loop** (scoreboard metric #5, shown only above the sample size where it means anything, and explicitly *not* a promise). **Pre-build experiment, one weekend:** play the existing bots on solver-recommended lines vs deliberately-off-but-plausible lines and confirm that solver-adherence actually predicts win-rate ranking against that population. If it doesn't track even against the trainer's own bots, the promise is dead before a single node is solved.
2. **Adherence is the highest-probability project-killer and the mitigations remain unsupported.** Hours 1–7 are near-zero poker, silence means most decisions produce nothing, every motivational surface is banned, and assessment is pre-framed as looking worse than practice. The concessions — always-open Table, per-KC bars as the primary progress surface — are adherence choices with **no citation behind them, and none is claimed**. **Pre-build experiment, two weeks:** run the austere loop by hand on paper — forced classify, commit, typed reason, delayed feedback, genuine silence on small errors, one delayed weekly self-test. If the builder-as-user can't sustain the crudest version, no amount of Electron polish rescues it, and that is knowable for two weeks instead of six months.
3. **Reason grading carries the sharpest rule in the design on a classifier of unknown accuracy.** `G4` fires the harshest event (T3, interrupt, re-serve) on a *classification*, so at 80% accuracy roughly one in five well-reasoned decisions gets punished — which erodes trust in the loudest channel — while false negatives let the false rule install silently, defeating G4's purpose. At 60% it is noise. **Gate:** hand-label ~100 real reason lines and measure agreement *before* enabling G4's escalation. Until that measurement exists, G4 logs but does not interrupt.
4. **The reads/exploitation pillar is arithmetically sound and epistemically unvalidatable.** R1–R5 match the method's tables exactly (independently verified). But what the learner drills is classification of six known generators with a published answer key, and real opponents are non-stationary, continuously distributed, and correlated in their leaks. There is no cheap experiment that tests read-transfer without humans, which the product excludes by design. **This is the pillar to defer if scope must be cut** — it is gated behind months of prerequisites anyway, and shipping it later costs nothing.
5. **Bank memorisation is bounded at the spot level, not eliminated.** B0's node/spot distinction makes "novel instance" achievable (a few hundred solves yield ~10⁶ spots), but *nodes* still repeat, and a learner can plausibly learn "on this node class, bet" without the underlying structure. Novelty is enforced on `(node × holding)` and on runout, and the D1 tier-B drills attack structure directly — but the honest statement is that node-level familiarity accumulates and the product cannot fully prevent it. Instrument accuracy on first-exposure vs repeat nodes and watch the gap.
6. **N=1 statistics bound what the learner model can honestly claim, and the authored KC graph is now unfalsifiable in-product.** ~8 opportunities per KC per week means no per-KC success band, no per-KC calibration curve, and no data-driven KC splitting. The deeper cost, understated in v1 of this spec: error-curve splitting is the *detector* for a miscut KC, so without it a conflated KC (a "flop c-bet" that should split by texture) cannot be detected — and its mastery bar, which is the primary instructional surface, then teaches a wrong skill decomposition the learner can't self-correct. The 25-opportunity freeze bounds wheel-spinning but says nothing about mis-definition.
7. **Cross-street blame assignment is scoped out (B7)** — the method's claimed structural advantage over other tutoring domains, unbuildable here because preflop carries no solver ΔEV and the served set holds no arbitrary-state continuations. Multi-KC credit is therefore uniform, which the method explicitly warns against.
8. **Simulated observation streams change what is taught, not just how long it takes.** R6 replaces 1,000 live hands with generated observation sets. v1 of this spec framed that purely as a time saving; the real cost is that *experiencing* a sparse stream teaches felt data scarcity, while reading a table of 20 observations teaches gate arithmetic. Mitigation: deliver observations **sequentially, one at a time**, never as a table, so the scarcity is felt rather than summarised.
9. **Two mechanisms are kept despite the method flagging them as weak.** Simultaneous four-variant presentation for rule extraction rests on a claim the method itself marks `[recalled]` and calls its weakest link — if simultaneity carries no benefit over sequential, the neighbour-graph machinery is effort spent on an unconfirmed premise. And the 85% target-success figure is derived for stochastic-gradient binary classifiers, not humans making multi-action decisions with mixed-strategy optima; at a node with three near-equal actions the correct error rate is genuinely undefined.

**AGPL and the local-only break** are stated tradeoffs rather than resolved constraints. The solver posture (build-time tool, pinned and vendored, output-only distribution) should be re-examined before any public build. The tutor's network access is a knowing override of the original local-only parameter, scoped to one host and one node's payload per call.

Also inherited from the source document and worth keeping visible: **zero perceptual-learning studies have ever been run on poker.** Every transfer claim in phase 1 is inferred from butterflies, ECGs, histopathology, and cockpit instruments. The largest single risk is the **taxonomy** — perceptual learning installs whatever boundaries you present and resists later verbal correction, so if STATIC/SEMI/DYNAMIC or the seven role labels are fuzzy or solver-inconsistent, the fuzziness is installed permanently. D1 makes label validation a **build gate** rather than an aspiration, which is the only defence available.
