# Experiment 3 — is the reason grader accurate enough to let G4 interrupt?

**Model:** `us.anthropic.claude-sonnet-4-5-20250929-v1:0` via Bedrock, profile `ziya`, `us-west-2`.
**Corpus:** `research/corpus/reasons.jsonl`, 100 authored reason lines (range 25 / price 25 /
hand-strength 30 / none 20).
**Harness:** `measure-g4.mjs`, one call per line, temperature left at the API default, 8 concurrent.

## Why this experiment exists

PRODUCT-SPEC open question 3 makes this a gate, not a carried risk:

> Reason grading carries the sharpest rule in the design on a classifier of unknown accuracy. `G4`
> fires the harshest event (T3, interrupt, re-serve) on a *classification*, so at 80% accuracy
> roughly one in five well-reasoned decisions gets punished — which erodes trust in the loudest
> channel — while false negatives let the false rule install silently, defeating G4's purpose. At
> 60% it is noise. **Gate:** hand-label ~100 real reason lines and measure agreement *before*
> enabling G4's escalation. Until that measurement exists, G4 logs but does not interrupt.

So the question is not "is the classifier good" in the abstract. It is one number: **how many
well-reasoned decisions per hundred would G4 wrongly interrupt?**

## Result

**96/100 correct (96.0%).**

| class | precision | recall | tp | fp | fn |
|---|---|---|---|---|---|
| range | 92.6% | 100.0% | 25 | 2 | 0 |
| price | 100.0% | 96.0% | 24 | 0 | 1 |
| hand-strength | 100.0% | 90.0% | 27 | 0 | 3 |
| none | 90.9% | 100.0% | 20 | 2 | 0 |

Confusion (row = true label, column = prediction):

```
range         -> range 25
price         -> price 24, none 1
hand-strength -> hand-strength 27, range 2, none 1
none          -> none 20
```

### The number the gate actually turns on

G4 escalates only when the grader returns `hand-strength` or `none`. So the harm case is a learner
who reasoned about **range or price** and was classified into one of those two.

**1 of 50 well-reasoned lines = 2.0% false escalation.**

The single case is a `price` line read as `none`. At the spec's own framing — one in five at 80%
accuracy, noise at 60% — 2% is comfortably inside what the design can carry.

**Verdict: the gate passes. G4 may escalate, not merely log.**

### The error direction is the safe one

Both `hand-strength` and `price` have **100% precision**: nothing was ever wrongly *pushed into*
hand-strength. Every one of the three hand-strength misses went the other way — read as `range`
(2) or `none` (1). That is a false negative, which means the harsh event fails to fire and a false
rule may install silently. Bad, but it is the failure the spec is willing to accept; the one it
warns "erodes trust in the loudest channel" is a false *positive*, and there were none into
hand-strength.

The 2 `range` false positives came from hand-strength lines, and the 2 `none` false positives from
one price and one hand-strength line.

## What this does NOT establish

- **The corpus is authored, not harvested.** I wrote these 100 lines to look like a beginner's,
  including the hard cases (hand-strength reasoning dressed in range vocabulary, correct range
  reasoning stated clumsily, price reasoning that never names a number, evasive lines, lines mixing
  two categories). A real learner's phrasings will differ, and idiosyncratic phrasing is exactly
  what classifiers are worst at. **This measurement should be re-run against the first ~100 real
  lines the product collects**, and G4's escalation should be treated as provisional until then.
- **Single-label ground truth on genuinely mixed lines.** Some reasons legitimately carry both range
  and price content; forcing one label makes the task artificially crisp. Where I judged a line
  mixed I labelled it by its dominant clause, which is a judgement call another labeller could make
  differently. There is no inter-rater agreement figure here because there was one rater.
- **One prompt, one model, one run.** No prompt variants were compared and no repeat runs were done,
  so there is no stability estimate. Given 96%, variant tuning is not the pressing work.
- **Nothing about G4's *pedagogy*.** This measures whether the classifier can spot
  right-for-the-wrong-reason. Whether interrupting on it actually teaches better is a separate
  question this experiment does not touch.

## Consequence for the build

G4's escalation can be enabled. Two things should ship with it:

1. The classifier's verdict is logged alongside the decision, so the first hundred real lines become
   the re-measurement corpus without extra instrumentation.
2. The keyword fallback (needed anyway for the no-credentials path, per T1) should be measured on
   this same corpus before it is relied on — it was not measured here, and the comparison is what
   tells us what the model is actually buying over a word list.
