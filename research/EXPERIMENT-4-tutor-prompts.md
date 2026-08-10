# Experiment 4 — can a real model hold the tutor's constraints?

**Date:** 2026-08-09
**Model:** `us.anthropic.claude-sonnet-4-5-20250929-v1:0` via Bedrock, `us-west-2`, temperature 0
**Calls made:** 1,882 real invocations — 1,490 graded (2 hats × [3 designs + 2 round-2 designs] × 149
spots), 320 silence, 72 independent confirmation. No stubs, no simulated output; every completion is
stored under `scripts/experiments/tutorPrompts/out/`.
**Harness:** `scripts/experiments/tutorPrompts/` — run from the repo root with `vite-node`.
**Winning prompts:** `src/main/tutor/prompts.ts`, verified byte-identical to the measured strings by
`scripts/experiments/tutorPrompts/verify.ts`.

---

## Verdict, first

**A real model holds the *form* constraints well and the *truth* constraint badly, and the two
optimise against each other.**

- **The Interrogator works.** 94.6% guard pass, 0.7% answer-leak rate, mean 14.8 words. This is the
  hat the product's core bet rests on ("the coach ASKS rather than tells") and it is the one a real
  model does cleanly. It needed the three specific bans in §4 to get there; without them it leaked
  on 26.1% of its own guard-passing questions.
- **The silence rule is the easiest constraint in the spec, not the hardest.** The spec predicted
  G3 would be "the one most likely to be violated." Across 320 T0 calls the model produced **zero**
  praise, zero congratulation, zero confirmation. It failed only by *narrating the instruction*, and
  only when asked for a literally empty response — a fixable API-shape problem, not a pedagogy one.
- **The Explainer is not shippable as measured.** 77.2% guard pass, but **32.2% of the outputs that
  PASS the guard state a numeric relationship that is false**, using only permitted numerals. That
  is precisely the hole PRODUCT-SPEC T4 names and declines to close, and this is its first
  measurement. One in three shipped corrections would teach something untrue.
- **The most important negative result:** a second-round Explainer prompt that added explicit
  number-meaning rules raised the guard pass rate to **89.9% — the best guard score in the
  experiment — while dropping the joint usable rate from 52.3% to 45.6%.** Telling the model to
  check the ranks between the hand and the boundary hand made it *state rank distances*, which it
  then got wrong on 56 of 134 outputs. **Optimising the guard metric made the teaching worse.** Any
  future prompt work that tunes on guard pass rate alone will make this product worse while the
  dashboard improves.

---

## 1. Method

### The payload comes from the real engine

`scripts/experiments/tutorPrompts/spots.ts` drives `src/core/table.ts`, `src/core/ai.ts`,
`src/core/coach.ts` and `src/core/equity.ts` headless and seeded. Ten seeds x 10 hands; at every hero
node **every legal action** is graded, which produces a natural spread of tiers at one genuine node.
Total collected: **1,821 graded decisions**.

Severity is banded by PRODUCT-SPEC **G1** (preflop in absolute bb; postflop as a fraction of the pot
before the learner's own action). Error tags follow **G7**. Class reach-weight follows **G2** —
`mean(ΔEV) × reach × 100` at `(street × action)` granularity over the full 1,821, never per-decision.

Three engine-facing defects were found and fixed in the harness while assembling payloads. All three
are in the harness, not in `src/` — no source file outside `src/main/tutor/prompts.ts` was touched:

1. **No turn or river nodes.** Advancing the hand on the cheapest action folded hero preflop nearly
   every hand: 272 of 356 decisions were preflop and there were 4 turn nodes and 0 river nodes.
   Advancing on a *continuing* action (check, else call) produced the final distribution below.
2. **Zero boundary hands, twice.** The T3 payload requires a boundary hand and a flipping variable.
   The first neighbour search scanned only ±1/±2 ranks and found a boundary for **0 of 356** spots —
   a pot-odds gap of 17% held vs 40% required cannot be closed by one rank of kicker, so "one
   variable" has to mean one *axis* scanned fully, not one *step*. The second version passed hero's
   own hole cards in the blocked set, which rejected every candidate (each neighbour retains one
   hero card by construction) and again found **0 of 149**. Final: **123 of 149** have a real
   boundary hand.
3. **`principle: none, error tag: PURITY` on genuine T1/T2 spots.** `coach.ts` nulls its principle
   when its own three-tier severity is `free` (< 0.5 bb), but G1's five-tier bands put plenty of
   sub-0.5-bb decisions in T1 and T2 (a 0.4 bb preflop error is T2). The harness re-derives the
   principle from coach.ts's own branch structure. **This is a real inconsistency between
   `src/core/coach.ts`'s tiering and PRODUCT-SPEC G1's, and it is worth a look independently of this
   experiment.** Also: `cheapestAction` resolved to `fold` on nearly every node, because folding
   costs 0 by coach.ts's rule whenever equity is below the required share — so the tutor was being
   handed "fold" as the recommended next action even on 99%-share river checks. The harness uses the
   cheapest *non-fold* action.

### The sample

**149 graded decisions**, stratified by street × tier, distinct on (hand, board), drawn with a seeded
shuffle:

| | T1 | T2 | T3 | T4 | total |
|---|---|---|---|---|---|
| preflop | 12 | 12 | 4 | 0 | 28 |
| flop | 12 | 12 | 8 | 1 | 33 |
| turn | 12 | 12 | 11 | 5 | 40 |
| river | 12 | 12 | 12 | 12 | 48 |
| **total** | **48** | **48** | **35** | **18** | **149** |

Error tags: PRICE 54, SIZING 53, RANGE 42. Boundary hand present on 123. Plus **32 T0 decisions**
(8 per street) for the silence measurement.

### The guard

`src/main/tutor/guard.ts` **did not exist** when this harness was written (`src/main/` held only
`main.ts`, `preload.ts`, `store.ts`), so the four mechanically-decidable T4 checks are implemented
locally in `scripts/experiments/tutorPrompts/guard.ts`: word count (≤60 / ≤20), ban-list lint
(second-person trait attribution, praise adjacent to a correction, streak/rank/percentile language,
per-hand fold reveal), number provenance (string membership over the payload's numerals), and no
leading second-person pronoun. **If a real `guard.ts` lands, reconcile it against that file rather
than duplicating it** — the numbers below were taken against it.

**The guard needed one refinement pass, and it matters that it was an over-fire, not an under-fire.**
The naive ban list scored poker's own vocabulary as violations. All stored completions were
re-scored against the refined guard without re-calling the model
(`scripts/experiments/tutorPrompts/rescore.ts`), so both versions are comparable on identical
strings. The over-fires, quoted:

| naive hit | count | actual meaning |
|---|---|---|
| `"rank"` | 30 | "Re-run this node with **one rank** higher" — a card's rank |
| `"points"` | 23 | "missing the price by 14 percentage **points**" — a unit |
| `"good"` | 10 | "**Price too good to fold**" — a property of the price |
| `"you're getting better"` | 7 | "**you're getting better than 3:1**" — receiving odds |
| `"you're nearly"` | 2 | "you're nearly drawing dead" — describes the hand |
| `"ranking"` | 1 | "drill bluff-catchers by **ranking** your pairs" |

After refinement, **ban-list violations across all 447 round-1 Explainer outputs: zero.** The model
never praised, never attributed a trait, never counted a streak, never revealed a folded hand's
runout. Every Explainer failure is word count or number provenance.

### The prompt designs

Three per hat, same payload, temperature 0:

- **terse** — the constraints as a bare list. No role, no examples.
- **example** — one worked example (the 52-word KJo correction from `TEACHING-METHOD.md`) plus a
  rejected counter-example with its reasons.
- **banlist** — a role, the constraints, and an enumerated ban list giving the reason for each item.

Then a **round 2**: each round-1 winner, with *only* its measured failure mode addressed
(`terse2`, `banlist2`). Same 149 spots.

---

## 2. Measurement 1 — GUARD PASS RATE

```
EXPLAINER — n = 149 per variant
variant     guard-pass        avg words   false-relationship   USABLE (pass & true)
terse       115/149 ( 77.2%)    45.3       37/115 ( 32.2%)    78/149 = 52.3%
example      47/149 ( 31.5%)    60.1       10/47  ( 21.3%)    37/149 = 24.8%
banlist      75/149 ( 50.3%)    59.1       14/75  ( 18.7%)    61/149 = 40.9%
terse2      134/149 ( 89.9%)    37.3       66/134 ( 49.3%)    68/149 = 45.6%
banlist2     94/149 ( 63.1%)    51.7       56/94  ( 59.6%)    38/149 = 25.5%

INTERROGATOR — n = 149 per variant
variant     guard-pass        avg words   leak rate            USABLE (pass & no leak)
terse        16/149 ( 10.7%)    24.6        9/16  ( 56.3%)     7/149 =  4.7%
example      87/149 ( 58.4%)    23.4        8/87  (  9.2%)    79/149 = 53.0%
banlist     138/149 ( 92.6%)    15.3       36/138 ( 26.1%)   102/149 = 68.5%
terse2       18/149 ( 12.1%)    24.7       10/18  ( 55.6%)     8/149 =  5.4%
banlist2    141/149 ( 94.6%)    14.8        1/141 (  0.7%)   140/149 = 94.0%
```

**Headline guard pass rates:** Explainer **77.2%** (best round-1 design, n=149), rising to 89.9% in
round 2 at a cost to truth. Interrogator **92.6%** round 1, **94.6%** round 2.

Per-tier and per-street breakdown for the round-1 Explainer winner (`terse`):

| | T1 | T2 | T3 | T4 | | preflop | flop | turn | river |
|---|---|---|---|---|---|---|---|---|---|
| pass | 41/48 | 38/48 | 27/35 | 9/18 | | 17/28 | 28/33 | 33/40 | 37/48 |

**Pass rate degrades with severity: 85% at T1 → 50% at T4.** The high-stakes corrections are the
unreliable ones. Mechanism: a T4 spot has a large EV loss and a dramatic equity gap, and the model
writes more to explain it, running over 60 words or reaching for a number it does not have.
**Preflop is the worst street (61%)** — the pot is 1.5 bb, the payload has few numerals, and the
model reaches for range percentages that were never given to it.

### Every Explainer failure mode, with real output

**Word count (terse: 1 of 149).** The single failure, at 69 words:

> "**Range Polarization on Paired Boards** T2o holds 32% equity against the calling range but needs
> only 28% to call profitably. This hand sits in the middle of your distribution—too weak to raise
> for value, too strong to fold. TT, which pairs the top kicker, reaches 69% equity and defines the
> value-raising threshold. Check whether your hand beats or ties enough bluff-catchers to raise, or
> simply realize equity by calling."

**Word count (example: 68 of 149 — the dominant failure of that design).** The worked example in the
prompt is 52 words, and the model treated it as a target rather than a ceiling; mean output was 60.1
words, exactly at the limit, so noise pushed half of them over. At 72 words:

> "Overbet shoves bluff with insufficient fold equity. You hold 21% equity against a calling range
> and need folds to profit, but SB versus BB on a connected board means villain continues wide —
> your shove risks 44bb to win 8.9bb against a range that calls profitably. Boundary: 96o shoves,
> 94o checks; the flipping variable is the kicker — two pips of equity separate profitable
> aggression from spew. Check behind and re-evaluate turn."

**This is a finding about prompt design that generalises: giving a length example anchors the model
at that length, and a 52-word example under a 60-word ceiling leaves no margin.** The terse design,
which states "60 words maximum" and gives no example, averaged 45.3 words.

**Number provenance (terse: 33 of 149).** 71 distinct fabricated numerals. Most are *arithmetically
correct derivations* the payload does not contain — the model computing a pot-odds ratio from pot and
to-call:

> "Price too good to fold. You're getting **3.6:1** on a call that needs **2.5:1** — any king or
> jack gives you a pair that wins often enough to profit…"

(pot 9.3, to-call 2.6 → 3.58:1. The arithmetic is right; the numerals are not in the payload.)

> "**Pot odds** 53o needs 22% equity to call 2.6 into 9.3 but holds only 8%, missing the price by
> **14** percentage points."

(22 − 8 = 14. Correct, and unpermitted.)

> "…this river spot demands 17% equity to call all-in, but 72o holds just 2% against CO's
> value-heavy range on an **8-8-A-K-9** runout."

(Re-spelling the board as a hyphenated string, which reads as new numerals to the check.)

**The provenance check is therefore firing mostly on true statements while missing false ones.** It
is a form check that behaves like a truth check often enough to be mistaken for one, and §3 shows
what it lets through.

### The Interrogator's failures

`terse` failed 115 of 149 on **leading second-person** — it answered the learner's stated reason
instead of asking:

> "**Your** hand *is* live—you have 30% equity, which beats the 22% you need to call profitably. So
> what made you choose all-in over the cheaper call when you already had the pot odds to continue?"

> "**Your** hand needs 22% equity to call profitably, but it only has 9%—why do you think the price
> seemed good enough when you needed more than twice the equity you actually had?"

Both hand over the entire verdict. The terse Interrogator prompt is actively harmful.

`banlist2`'s 8 remaining failures are all benign length overruns from spelling numbers to avoid
digits — the ban on digits and the 20-word cap pull against each other:

> "What share of the pot does your hand need to win to justify calling **one big blind to win two and
> a half**?" (21 words)

---

## 3. Measurement 2 — NUMBER FIDELITY

The spec states that provenance "passes output that is false using only permitted numerals (payload
has pot 10 and bet 5; 'risking 10 to win 5' inverts the relationship and passes)". Measured:

**Of the 115 guard-passing `terse` corrections, 37 (32.2%) contain at least one relationship that is
false.** Five decidable classes, checked mechanically by
`scripts/experiments/tutorPrompts/relations.ts` and then read by hand:

| class | what is false | terse | example | banlist | terse2 | banlist2 |
|---|---|---|---|---|---|---|
| A | a payload numeral repurposed as a different quantity | 10 | 0 | 1 | 3 | 4 |
| B | boundary direction or step size wrong | 15 | 4 | 1 | 19 | 44 |
| C | boundary presented as a floor the hand must clear when it is below the hand | 11 | 0 | 8 | 7 | 9 |
| D | boundary hand's share asserted as what the decision requires | 6 | 6 | 3 | 5 | 5 |
| E | an explicit rank-distance count is wrong | 3 | 4 | 1 | 56 | 49 |
| **≥1 false** | | **37/115** | **10/47** | **14/75** | **66/134** | **56/94** |
| **rate** | | **32.2%** | **21.3%** | **18.7%** | **49.3%** | **59.6%** |

### Class A — the exact inversion the spec predicted

The spec's own example is a bet/pot swap. What the model actually did is worse: it took a *pot-share
percentage* and asserted it as a *chip count*.

> "**Range Overplay** AKo holds 30% equity against Villain's continuing range but needs only 22% to
> call profitably. **The shove risks 22bb to win 7bb** when a 2bb call preserves position and stack
> depth."

Payload: pot 7 bb, to-call 2 bb, required share **22%**. Hero's real stack: **164.7 bb**. The shove
risks 164.7 bb, not 22. The `22` is the required *percentage*, reused as a *bb count*, and it passes
provenance because the digits `22` are in the payload. **This is the spec's hypothetical, found in
the wild, on the first sample.**

Every shove-size claim measured is false, and the error is large:

| output claim | real stack |
|---|---|
| "Shoving **2.5 bb**" | 109.6 bb |
| "jam **1.5bb**" | 190.1 bb |
| "risks **3 bb**" | 175.4 bb |
| "risks **7.9bb**" | 187.3 bb |
| "shove **8.9bb**" | 162.7 bb |
| "risks **26.6 bb**" | 179.4 bb |

Root cause: the payload carries no stack field, so the model substituted the nearest available
number. **This one is fixable in the payload, not the prompt** — add the stack. But the class is
general: any quantity the payload omits invites substitution from a quantity it includes.

And the EV loss reused as a bet size, which turns a cost into an instruction:

> "…checking forfeits 0.5 bb against hands that pay smaller bets. Q2o holds 47% and is the
> boundary—one top card separates betting from giving up. **Bet 0.5 bb** or more."

"Bet 0.5 bb" into a 2.5 bb pot is not advice anyone should follow; 0.5 is what the check cost.

### Class C — the boundary inverted into a floor

The boundary hand is the nearest hand whose verdict flips. When it flips *the other way* — the
boundary hand is worse and still fine, because the learner's hand was already fine — the model
still writes it as a bar to clear:

> "**Value or bluff** The 86s holds **94%** equity and should bet to deny a free river card, not
> check. **K6s with 41% equity is the boundary: any stronger hand must bet, any weaker may check.**"

94% is stronger than 41%, so "any stronger must bet" is consistent — but the sentence installs 41%
as a threshold that a hand at 94% is being measured against, which is not what the boundary means.
Sharper:

> "**Pot Odds** J7o needs 22% equity to call 5.9 into 20.7 but holds 84%, making this fold a 16.5bb
> mistake. **J9o marks the boundary where the kicker alone determines whether trips can profitably
> call.**"

J9o's share is **2%**. It is presented as a decision boundary for trips.

### Class D — a fabricated pot-odds rule

Six outputs assert the boundary hand's equity as the share the *decision* requires. The payload's
required share is 0% (no bet to call):

> "**Value or bluff** A3o holds 25% equity but **needs 35% to bet profitably** on this board."
> (payload required = 0%; 35% is 53o's equity)

> "**Value or bluff** Your 42o holds 26% equity but **needs 35% to bet profitably** on this turn."
> (payload required = 0%; 35% is 72o's equity)

A learner reading these learns a pot-odds rule that does not exist, expressed entirely in permitted
numerals.

### Class E — and why round 2 made it worse

Round-2 prompts told the model to *check the ranks* before naming a direction. It complied by stating
rank counts, and got them wrong 56 times in 134:

| claim | truth |
|---|---|
| "A8o at 36%: **six ranks higher** in the top card" | Q→A is **2** |
| "A4o — **one kicker rank**" (from AKo) | K→4 is **9** |
| "K3o, **one rank** lower" (from 93s) | 9→K is **4** up |
| "54s, **two ranks** higher on top" (from K4s) | K→5 is **8** down |
| "TT, **two ranks** higher and paired" (from T9s) | 9→T is **1** |

**This is the experiment's most actionable finding.** The instruction intended to improve fidelity
created a new falsehood class and *tripled* class E while raising the guard pass rate to its
best-ever 89.9%. The guard cannot see any of it: `six`, `one`, `two` are spelled words, not numerals,
so provenance never looks at them.

### What this means for T4

Number provenance is doing almost the opposite of its intent on this sample. It **rejects 33 outputs
whose arithmetic is correct** (derived ratios, differences) and **accepts 37 whose relationships are
false**. It is a necessary form check — the spec says so — and treating it as any part of a truth
guarantee is not supported by these numbers.

---

## 4. Measurement 3 — PROMPT VARIANTS

### Explainer: `terse` wins, and the winner is not the best guard scorer

| | terse | example | banlist | terse2 | banlist2 |
|---|---|---|---|---|---|
| guard pass | 77.2% | 31.5% | 50.3% | **89.9%** | 63.1% |
| false relationship (of passing) | 32.2% | 21.3% | **18.7%** | 49.3% | 59.6% |
| **joint usable** | **52.3%** | 24.8% | 40.9% | 45.6% | 25.5% |
| mean words | 45.3 | 60.1 | 59.1 | **37.3** | 51.7 |

**`terse` is the winner at 52.3% joint usable, +11.4 points over the next design.** `terse2` scores
higher on the guard and lower on what matters, which is the finding, not a footnote. The winner is
saved verbatim as `EXPLAINER_CORRECTION` in `src/main/tutor/prompts.ts`.

Why the two elaborate designs lost:

- **example** anchored length at the worked example's 52 words under a 60-word ceiling (mean 60.1;
  68 of 149 over).
- **banlist** produced the best truth rate of any design (18.7% false) but ran long — mean 59.1
  words, 52 word-count failures. **A prompt that explains *why* each rule exists produces more
  careful and more verbose output.** That trade is worth revisiting if the word ceiling is ever
  relaxed, because on truth it is the best prompt measured.

### Interrogator: `banlist2` wins decisively

| | terse | example | banlist | banlist2 |
|---|---|---|---|---|
| guard pass | 10.7% | 58.4% | 92.6% | **94.6%** |
| leak rate | 56.3% | 9.2% | 26.1% | **0.7%** |
| **joint usable** | 4.7% | 53.0% | 68.5% | **94.0%** |
| mean words | 24.6 | 23.4 | 15.3 | **14.8** |

**94.0% joint usable, +25.5 points over round 1.** Saved verbatim as `INTERROGATOR_QUESTION`.

**The hat inversion is the second real finding: `terse` wins the Explainer and loses the
Interrogator by 64 points.** Writing a bounded correction from supplied numbers is a constrained
transcription task, and extra prompt text mostly adds length. Asking a question that withholds an
answer the model can see is a *suppression* task, and suppression needs its failure modes named
explicitly — the model cannot infer "do not put the verdict in a subordinate clause" from "do not
reveal the answer." One prompt style per hat is not the right default.

### Verification

`scripts/experiments/tutorPrompts/verify.ts` asserts the three exports in `prompts.ts` are
byte-identical to the measured strings (all MATCH). An independent re-run driving the `prompts.ts`
exports against a disjoint 30-spot slice: Explainer 22/30 = 73.3% (recorded 77.2%), Interrogator
29/30 = 96.7% (recorded 94.6%), silence 12/12 = 100%, praise 0.

---

## 5. Measurement 4 — THE INTERROGATOR'S LEAK RATE

A question can pass every guard check and still destroy the mechanism. Three leak classes, checked
by `scripts/experiments/tutorPrompts/leaks.ts` against the payload:

- **L1** the cheaper action is named against the taken action — the learner now knows the preference.
- **L2** the verdict is asserted in the question's premise.
- **L3** the learner's own pot share is handed back. *The required share is deliberately not charged
  as a leak — it is pot/to-call arithmetic over two numbers already visible on the table.*

| | terse | example | banlist | banlist2 |
|---|---|---|---|---|
| L1 | 9 | 0 | 14 | **0** |
| L2 | 0 | 0 | 15 | **0** |
| L3 | 0 | 8 | 8 | **1** |
| **leak rate** | 56.3% | 9.2% | **26.1%** | **0.7%** |

### Round 1 leaks, verbatim

**L1 — the answer named as a contrast:**

> "What made you choose **all-in over check** when you wanted to keep the pot small?"
> "What pot size does your bet create **compared to checking**, and which achieves your stated goal?"
> "What does your nine-high straight need from worse hands to justify **betting instead of checking
> behind**?"
> "What happens to your fold equity when you **shove instead of checking for free**?"

Each names both the taken action and the grader's preferred one. The learner needs only to notice
which is mentioned second.

**L2 — the verdict inside a subordinate clause.** This is the subtle one, and the reason the guard
cannot help:

> "What pot size does your hand need **when you're ahead of their calling range**?"
> "What percentage of villain's range do you beat **when you're behind to every pair and every
> queen**?"
> "**With 65% equity and no card coming**, what were you protecting by keeping the pot small?"
> "What made you think your tens and nines needed protection **when you could see all five cards**?"
> "What made you choose that bet size **with a hand that wins this often**?"
> "What pot size does your hand need **when you're bluffing** with nine-high on the river?"
> "What made you want to keep the pot small **when you held top pair** on the river?"

Every one is grammatically a question and semantically an answer. "When you're ahead of their calling
range" *is* the verdict on a shove. 13 words, no banned construction, no unpermitted numeral —
passes the guard cleanly.

**L3 — equity handed back:**

> "What pot share does your hand need to justify calling, and how does **your 11%** compare?"
> "**Given you held 99% equity and needed only 22% to call**, what made 17.6 big blinds into 62 feel
> expensive?"
> "**Given you held 80% equity but needed only 22%**, what made the 2bb price feel wrong?"

T8 makes equity unreachable pre-commit *because it is a strong proxy for the correct action*. The
Interrogator fires at G5a state 4, which is pre-reveal. These hand it over.

### After the fix: 1 leak in 141

The single survivor, and it is marginal:

> "What does your jack need alongside it to hold **43%** against their range here?"
> (43% is the boundary hand's share, not the learner's)

**Leak rate 0.7%. The mechanism holds — but only because three specific failure modes were named in
the prompt after being measured.** The generic instruction "do not reveal the answer" produced a
26.1% leak rate. There is no reason to expect a fourth leak class does not exist outside this
sample; the honest statement is that three known classes are closed.

---

## 6. Measurement 5 — SILENCE COMPLIANCE

32 T0 decisions × 5 designs × 2 representations = **320 calls**.

| representation | silent | rate |
|---|---|---|
| `sentinel` — "your entire output is the single token NONE" | **160/160** | **100.0%** |
| `empty` — "output nothing at all, a completely empty response" | 136/160 | 85.0% |

Per design, `empty` mode: terse 32/32, example 32/32, terse2 28/32, banlist 23/32, banlist2 21/32.
Per design, `sentinel` mode: **32/32 for all five.**

### Praise violations: zero out of 320

**No T0 response contained any commendation or confirmation token.** Not "nice", not "good", not
"correct", not "well played", not "no mistake here". The spec's expectation that "models want to be
encouraging; this rule is the one most likely to be violated" **is not what a real model does** when
the rule is stated. It is the most reliably held constraint in the entire experiment.

### What actually failed: instruction narration

All 24 failures are the same shape — the model reports the rule instead of following it (mean 30.4
words):

> "I notice this is a T0 severity tier. According to my instructions, I should output nothing at all
> for T0 cases."

> "I notice this is a T0 (severity tier 0) situation, which means the decision cost almost nothing in
> EV terms. According to my instructions, I should output nothing at all for T0 decisions - a
> completely empty response with no acknowledgment."

> "I need to check the severity tier first. The severity tier is T0, which means the decision cost
> almost nothing (EV loss is 0.0 bb). According to my instructions, on T0 I must output nothing at
> all - a completely empty response, with no praise, confirmation, or explanation."

> "Looking at this payload, I see:
> - severity tier: T0
> - EV loss (bb): 0.0
> Following the rules exactly: \"A tier of T0 means the decision cost almost nothing. On T0 you
> output nothing at all — a completely empty response.\""

Note the last one leaks the EV loss and the tier into the rail — a T0 is not supposed to be logged
as a leak or surfaced at all, so this is a genuine G3 violation even though it is not praise.

**Root cause and fix:** asking a chat model for an empty completion asks it to emit zero tokens,
which it reliably will not do; it fills the turn with meta-commentary. A sentinel gives it something
to emit. `SILENCE_SENTINEL = 'NONE'` ships, and the caller maps it to no rail output. The
`isSilent()` helper in `prompts.ts` treats both the sentinel and an empty string as silence, so the
15% narration case still needs a caller-side guard: **an output that is neither the sentinel nor
empty on a T0 payload must be dropped, not rendered.** That check does not exist yet and is not
one of T4's four.

---

## 7. What a shipped tutor needs that this experiment shows is missing

Stated as findings, not as work I did:

1. **A truth check the guard does not currently have.** 32.2% of guard-passing corrections state a
   false relationship. Four of the five classes in §3 are mechanically decidable against the payload
   — `relations.ts` decides them — so a `verifyRelations(output, payload)` pass is buildable and
   would catch A, C, D and E without a language model. Class B (direction words) is largely decidable
   too.
2. **Never tune the Explainer prompt on guard pass rate.** The measured counter-example is
   `terse2`: +12.7 points of guard pass, −6.7 points of usable output.
3. **The payload's omissions are the fabrication surface.** Every class-A error substituted an
   available number for an absent one. The stack is absent and the model invented it eight times.
   Adding a field is cheaper than banning a behaviour.
4. **A per-hand `principle`/tier inconsistency exists in `src/core/coach.ts`** relative to
   PRODUCT-SPEC G1 (§1, defect 3). Not mine to fix, and worth a look.
5. **Silence needs a caller-side drop, not just a prompt rule.** 15% narration under `empty`, 0%
   under `sentinel`, but a non-sentinel non-empty T0 output must be discarded structurally.
6. **The T4 word-count ceiling and the Interrogator's digit ban pull against each other.** Spelling
   numbers to avoid digits pushed 7 questions over 20 words. Either the cap accounts for spelled
   numbers or the ban permits digits the payload contains.

## 8. Caveats

- **One model, one temperature, one day.** Everything is Sonnet 4.5 at temperature 0. Temperature 0
  makes the measurement reproducible and makes it a *floor* on variance — a shipped tutor at higher
  temperature will do worse on form.
- **`n = 149` per variant, so a cell like flop/T4 has 1 spot.** The per-tier breakdown in §2 is
  directional; the headline rates are the ones with sample behind them.
- **Leak and fidelity classes were derived from this sample.** They are the classes this model
  produced here. The rates for known classes are sound; "no other class exists" is not claimed, and
  the round-2 result — where closing four classes opened a fifth — is direct evidence against
  assuming closure.
- **The boundary hand is not solver output.** PRODUCT-SPEC B1 specifies `postflop-solver`; there is
  no bank yet, so boundaries come from `coach.ts`'s Monte Carlo equity over one-axis neighbours.
  The *shape* of the payload is right and the numbers are engine-computed, but a real solver's
  boundary hands will differ, and class C in particular is partly an artifact of a boundary defined
  by equity rather than by action EV.
- **The 149 spots come from bot-populated hands with hero's line forced to continue**, which
  over-represents deep-board spots relative to real play (48 river nodes vs 28 preflop). That was
  deliberate — the alternative was 4 turn nodes and no rivers — but it is not a natural street
  distribution.
- **The guard here is mine, not the shipping one.** `src/main/tutor/guard.ts` did not exist. If it
  lands with different regexes, every pass rate in this document shifts, and the re-scoring path
  (`rescore.ts`) exists precisely so it can be re-measured on the stored completions without
  spending calls.

## Files

- `scripts/experiments/tutorPrompts/spots.ts` — engine driver, payload assembly, boundary search
- `scripts/experiments/tutorPrompts/guard.ts` — the four T4 checks, local
- `scripts/experiments/tutorPrompts/variants.ts` — all five prompt designs
- `scripts/experiments/tutorPrompts/bedrock.ts` — aws-CLI client, no npm deps
- `scripts/experiments/tutorPrompts/sample.ts` — stratified draw → `out/sample.json`
- `scripts/experiments/tutorPrompts/run.ts` — the phases (`explainer`, `interrogator`, `silence`; `--v2`)
- `scripts/experiments/tutorPrompts/rescore.ts` — re-score stored completions after a guard change
- `scripts/experiments/tutorPrompts/relations.ts` — measurement 2, classes A–E
- `scripts/experiments/tutorPrompts/leaks.ts` — measurement 4, classes L1–L3
- `scripts/experiments/tutorPrompts/scoreboard.ts` — the joint table
- `scripts/experiments/tutorPrompts/verify.ts` — asserts `prompts.ts` == measured strings
- `scripts/experiments/tutorPrompts/confirm.ts` — independent re-run against `prompts.ts` exports
- `scripts/experiments/tutorPrompts/out/` — every prompt, completion and verdict, as JSON and logs
- `src/main/tutor/prompts.ts` — the winners, with measured rates in the comments
