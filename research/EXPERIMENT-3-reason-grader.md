# Experiment 3 — is the reason grader accurate enough to let G4 interrupt?

**Model:** `us.anthropic.claude-sonnet-4-5-20250929-v1:0` via Bedrock `invoke-model`, profile `ziya`,
`us-west-2`, shelled out through `scripts/experiments/socratic/bedrock.mjs`. No npm dependency added.
**Corpus:** `research/corpus/reasons.jsonl` — 100 authored lines (range 25 / price 25 /
hand-strength 30 / none 20).
**Harness:** `scripts/experiments/reasonGrader/run.mjs`, one call per line, temperature at the API
default (1.0), concurrency 5, `max_tokens` 12 with an `assistant: "Label:"` prefill.
**Runs:** 3 independent passes per configuration (300 classifications each), so the report can
separate the classifier's error from its instability.

> This supersedes an earlier draft of this file that reported 96/100 from a single run of a harness
> (`measure-g4.mjs`) whose import path was broken — it could not execute as committed. That figure
> was not reproducible and the file has been deleted. Everything below is regenerated from
> `scripts/experiments/reasonGrader/out/*.json`.

## Why this experiment exists

PRODUCT-SPEC open question 3 makes this a gate, not a carried risk:

> Reason grading carries the sharpest rule in the design on a classifier of unknown accuracy. `G4`
> fires the harshest event (T3, interrupt, re-serve) on a *classification*, so at 80% accuracy
> roughly one in five well-reasoned decisions gets punished — which erodes trust in the loudest
> channel — while false negatives let the false rule install silently, defeating G4's purpose. At
> 60% it is noise. **Gate:** hand-label ~100 real reason lines and measure agreement *before*
> enabling G4's escalation. Until that measurement exists, G4 logs but does not interrupt.

G4 (spec line 212) escalates when ΔEV is T0/T1 **and** the grader returns `hand-strength` or `none`.
Overall accuracy is therefore the wrong headline. The gate turns on the **precision of the union
class {hand-strength, none}**: one minus that precision is the share of well-reasoned decisions the
harshest event in the design would punish.

## Corpus design

Authored to put the bulk of the weight in the middle of the distribution, because a corpus of easy
cases measures nothing. Family breakdown:

| family | n | what it probes |
|---|---:|---|
| clear-range | 17 | unambiguous range reasoning |
| range-clumsy | 6 | correct range reasoning, bad grammar, no jargon |
| clear-price | 14 | explicit pot-odds arithmetic |
| price-no-number | 8 | price reasoning that never names a number ("too expensive for a draw") |
| clear-hs | 19 | plain "my cards are good/bad" |
| **hs-in-range-vocab** | 5 | hand strength wearing range words ("my range is weak because these two cards are weak") |
| **hs-in-price-vocab** | 6 | hand strength wearing price words ("my equity is high because pocket tens is a big pair") |
| mixed | 5 | genuinely two categories; labelled by operative clause |
| hunch | 8 | feelings, reads, "I always play these the same" |
| clear-none | 5 | explicit admissions of guessing |
| degenerate | 7 | empty string, `.`, `?`, `asdf`, `n/a`, `because` |

Six lines are flagged `arguable` in the corpus with a note giving the reasoning
(`r05 r21 p06 p13 h21 h25`). Two form a deliberate minimal pair: `r21` ("betting because the hands
that call are worse and will pay" → range) against `h25` ("top pair top kicker is way ahead of the
range that calls" → hand-strength). Same vocabulary, different operative clause. `h25` is the hardest
line in the corpus and every configuration missed it in every run.

## Results

Headline is the **decontaminated** LLM configuration, for the reason in the next section.

| configuration | accuracy (run 0) | pooled accuracy (n=300) | self-agreement across 3 runs |
|---|---:|---:|---:|
| LLM, decontaminated prompt | 96/100 | 290/300 = **96.7%** | 93.0% |
| LLM, prompt as written | 98/100 | 292/300 = 97.3% | 99.0% |
| keyword-only fallback | 82/100 | — (deterministic) | 100% by construction |

### Prompt contamination, and why the headline is the lower number

The grader prompt was carried over from the earlier 32-case M2 measurement, and its worked examples
are near-verbatim corpus lines `h05`, `h06` and `p25`. Scoring those items against that prompt
measures memorisation of the rubric, not generalisation. `--decontaminate` swaps in structurally
identical examples that appear nowhere in the corpus. The leak is worth **0.6 pts of pooled accuracy
and 1.4 pts of G4 precision**, and it inflates self-agreement from 93% to 99% — the as-written prompt
looks more stable than the classifier really is. The decontaminated run is the honest number.

### Confusion matrix — LLM decontaminated, pooled over 3 runs (n=300)

| truth \ predicted | range | price | hand-strength | none | recall |
|---|---:|---:|---:|---:|---:|
| **range** (n=75) | **74** | 0 | 1 | 0 | 98.7% |
| **price** (n=75) | 0 | **74** | 1 | 0 | 98.7% |
| **hand-strength** (n=90) | 5 | 2 | **82** | 1 | 91.1% |
| **none** (n=60) | 0 | 0 | 0 | **60** | 100.0% |
| **precision** | 93.7% | 97.4% | **97.6%** | **98.4%** | |

Every error in 300 classifications is a `hand-strength` line escaping its class. `range`, `price` and
`none` were never once confused with each other.

### Confusion matrix — keyword fallback (deterministic, n=100)

| truth \ predicted | range | price | hand-strength | none | recall |
|---|---:|---:|---:|---:|---:|
| **range** (n=25) | **21** | 0 | 2 | 2 | 84.0% |
| **price** (n=25) | 0 | **21** | 0 | 4 | 84.0% |
| **hand-strength** (n=30) | 3 | 1 | **21** | 5 | 70.0% |
| **none** (n=20) | 1 | 0 | 0 | **19** | 95.0% |
| **precision** | 84.0% | 95.5% | **91.3%** | **63.3%** | |

## The number the gate turns on

Union class = `hand-strength` ∪ `none`, i.e. "G4 would escalate". Pooled over 3 runs.

| | LLM decontaminated | LLM as-written | keyword |
|---|---:|---:|---:|
| true positives | 143 | 145 | 45 |
| **false positives** (well-reasoned, punished) | **2** | **0** | **8** |
| false negatives (false rule installs silently) | 7 | 5 | 5 |
| **G4 precision** | **98.6%** [95.1, 99.6] | 100.0% [97.4, 100] | 84.9% [72.9, 92.1] |
| G4 recall | 95.3% [90.7, 97.7] | 96.7% [92.4, 98.6] | 90.0% [78.6, 95.7] |
| false-positive rate on range/price lines | 1.33% [0.4, 4.7] | 0.0% | 16.0% [8.3, 28.5] |

Intervals are Wilson 95%; the normal approximation is wrong this close to p = 1.

**The arithmetic the spec asks for.** At 98.6% precision, per 100 G4 interrupts, **1.4 land on a
learner who did reason about range or price**. Equivalently, of 100 genuinely well-reasoned
decisions, 1.3 get punished. The spec's framing was "one in five at 80%, noise at 60%"; the
measurement is **1 in 71**. Even the pessimistic end of the interval (95.1%) is 1 in 20 — an order of
magnitude better than the case the spec called unacceptable.

**Adversarial lower bound.** Because I authored both the lines and the labels, here is the same
number with every one of the 6 `arguable` items scored *against* the classifier — i.e. assuming a
second rater disagrees with me on all of them: accuracy 92.0%, **G4 precision 90.9% [85.3, 94.5] →
9.1 well-reasoned decisions punished per 100 interrupts, about 1 in 11.** That is the floor. It still
clears the spec's bar, and it is the number to plan against rather than 98.6%.

### The error direction is the safe one

All 10 pooled errors are `hand-strength` lines read as something else. That is a **false negative**:
G4 fails to fire and the false rule installs silently. Bad — it is half of what the spec worries
about — but it is not the half that "erodes trust in the loudest channel". Only 2 of 150 range/price
lines were ever wrongly pushed *into* the harsh event.

The recurring miss is worth naming: **hand-strength dressed in range vocabulary** is the weak spot
(`hs-in-range-vocab` scored 4/5 decontaminated, and `h25` failed in all 3 runs of both LLM
configurations). That is exactly the population G4 exists to catch, so its residual failure mode is
under-firing on the most sophisticated-sounding wrong reasoning.

### Instability

Self-agreement across 3 runs is 93% decontaminated: 7 of 100 lines changed label between identical
calls (`r24 p16 h06 h07 h16 h21 h23` — all in the hard families). Two consequences:

- A single run over-reports; a one-run figure carries roughly ±2 pts of sampling noise.
- More importantly for the product: **the same learner sentence can grade differently on two
  occasions.** For a rule that fires an interrupt, that is a fairness problem independent of
  accuracy. Setting `temperature: 0` in the shipped grader is the obvious mitigation and was not
  tested here — the bedrock helper does not currently pass a temperature.

### Latency

10 sequential calls, same shape as a real grade: min 2153 ms, **median 2505 ms**, p90 2823 ms, max
3474 ms. G4's interrupt is in-hand and G5a budgets REASON at 15 s, so ~2.5 s fits — but it is not
free, and it lands after the learner has already committed.

## What the model buys over a word list

| | LLM (decontaminated) | keyword | delta |
|---|---:|---:|---:|
| accuracy | 96.7% | 82.0% | +14.7 pts |
| G4 precision | 98.6% | 84.9% | +13.7 pts |
| well-reasoned punished / 100 interrupts | 1.4 | 15.1 | **11x fewer** |
| `none` precision | 98.4% | 63.3% | +35.1 pts |

The keyword classifier's failure is concentrated and diagnostic: **`none` precision 63.3%**. It
over-predicts `none` (30 predictions for 20 true cases) because it can only see vocabulary — a
learner who reasons correctly in plain words that miss the word list gets swept into the one class
that triggers G4. It also cannot do the thing the label set exists for, deciding which clause is
operative, so `hs-in-range-vocab` scored 2/5 and `range-clumsy` 3/6.

It is still a usable fallback for what T1 needs. At 82% accuracy it is fine for the weekly aggregate
and the tag histogram. It is **not** good enough to fire an interrupt: at 84.9% precision, 15 of every
100 interrupts would hit a learner who reasoned properly — almost exactly the "one in five" case the
spec named as unacceptable.

## Recommendation

**YES — enable G4's escalation, on the LLM grader only.**

1. **With a live tutor: G4 may interrupt.** Measured G4 precision 98.6% (adversarial floor 90.9%)
   against a gate that tolerated 80%. The spec's condition is met.
2. **On the no-key / fallback path: G4 logs, does not interrupt.** The keyword classifier measures
   84.9% precision with a 63.3%-precision `none` class. Spec line 436 already reduces G4 to firing
   only on `I'm guessing` with no key; that reduction is **confirmed as necessary**, and it should be
   read as covering G5's unreachable-tutor and 15 s-timeout cases too, not only the missing-key case.
3. **Set `temperature: 0` in the shipped grader.** 7% of lines changed label between identical runs.
   Untested here; do it before relying on the precision figure.
4. **Log the grader's label and the raw model reply alongside every decision**, so the first ~100 real
   learner lines become the re-measurement corpus with no extra instrumentation.
5. **Treat the escalation as provisional until re-measured on harvested lines.** If real-line
   precision comes in under ~95%, drop G4 back to logging.

## What this does NOT establish

- **The corpus is AUTHORED, not harvested from a real learner.** I wrote all 100 lines and all 100
  labels. This is the largest bound on the result: I wrote the hard cases I could *think of*, and a
  real beginner's idiosyncratic phrasing is precisely what classifiers fail on. It is also circular in
  a subtler way — the same author wrote the corpus and read the grader prompt, so the corpus may test
  the rubric's own distinctions rather than the ones learners actually blur. **Re-run against the
  first ~100 real lines the product collects.** Read this as "the classifier can execute this rubric",
  not "the classifier will be 96% accurate in production".
- **One rater, no inter-rater agreement.** Single-label ground truth on genuinely mixed lines is a
  judgement call. The 6 `arguable` flags and the 90.9% adversarial floor are partial mitigation, but
  no κ against a second labeller exists. Every "correct" here means "agrees with me".
- **Class balance is authored, not natural.** 50 of 100 lines sit in the G4-positive union class. The
  real base rate of hand-strength reasoning among T0/T1 decisions is unknown, and precision moves
  with prevalence — if only 10% of real reasons are hand-strength, G4 precision falls even with
  identical error rates. This is the second-largest bound.
- **G4's full condition was not tested.** G4 requires ΔEV ∈ T0/T1 *and* the label. Only the label half
  is measured; 8 corpus lines carry an explicit "CORRECT / dEV 0.0 / tier T0" node string and all were
  graded correctly, but the engine-side conjunction is not this experiment's subject.
- **One prompt, one model.** No variant sweep beyond the contamination swap, and no cheaper-model
  comparison — Haiku on this task is worth measuring for cost, given ~2.5 s and one call per graded
  spot.
- **Nothing about G4's pedagogy.** Whether interrupting on right-for-the-wrong-reason actually teaches
  better is untouched. This measures only whether the classifier can spot it.

## Reproducing

```bash
node scripts/experiments/reasonGrader/controls.mjs                                        # scorer controls
node scripts/experiments/reasonGrader/run.mjs --classifier keyword
node scripts/experiments/reasonGrader/run.mjs --classifier llm --repeats 3 --decontaminate --tag llm-decontaminated
node scripts/experiments/reasonGrader/run.mjs --classifier llm --repeats 3 --tag llm    # contaminated, for the delta
```

`controls.mjs` is the substitute for a mutation check, since `tests/` is out of scope for this
experiment: it scores an oracle classifier (must be 100%), a seeded random one (must be ~25%), and two
degenerate constant ones. The load-bearing control is **CONSTANT-POS**, which always predicts
`hand-strength` — the "G4 interrupts everything" pathology. Its G4 precision must collapse to the
corpus base rate of 50.0%, and it does (measured: 50.0%, recall 100%). A scorer that reported high
precision there would not be measuring the gate quantity at all. All 7 controls pass, exit 0.
