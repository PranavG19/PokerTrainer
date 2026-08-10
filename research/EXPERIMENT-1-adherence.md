# Experiment 1 — does grader-adherence predict win rate against our own bots?

PRODUCT-SPEC Open question #1, run as a measurement.

---

## SCOPE CORRECTION — READ THIS FIRST

**This experiment does not, and cannot, measure solver-adherence.** There is no spot bank and no
solver in this repository. Nothing below is evidence about a solver, about GTO, or about EV loss
measured against one.

What was measured is the honest available proxy: **does adherence to the existing EV-loss grader in
`src/core/coach.ts` predict win rate against the existing bot population in `src/core/ai.ts`?**

Every conclusion in this document is a statement about *our current heuristic grader*. The spec's
question — "does solver-adherence predict win-rate ranking" — remains **unanswered and untested**.
This experiment cannot retire that risk. What it can do, and did, is find defects in the grader we
actually ship, and it found several.

---

## Verdict

**Qualified yes, and it was a no six hours ago.**

1. **The grader used as a veto over play the student already has: +117.8 bb/100 [+92.5, +143.0],
   n = 24,000 paired hands.** A hero that plays the shipped TAG logic and switches only when the
   coach objects beats the identical TAG hero that never hears the coach. This is the arm the
   product's promise actually rests on, and it is positive and well outside the noise band.

2. **The grader used as a whole strategy is barely better than nothing: `adherent-passive`
   +80.7 bb/100 [+59.6, +101.7], statistically indistinguishable from the TAG bot
   (+4.6 bb/100 [−26.5, +35.8], inside the noise) and from a deliberately terrible nit
   (+9.4 bb/100 [−12.6, +31.4], inside the noise).** Taking the argmin over this grader is not a
   poker strategy. It ranks **3rd of 8** policies, behind an arm that differs from it only in how it
   breaks ties.

3. **The ranking is NOT monotone in adherence.** `adherent-aggro` and `adherent-passive` are equally
   adherent by construction — both play the argmin of graded EV loss — and differ only in tie-break.
   They are separated by **142 bb/100 [100.9, 183.1]**. Since 47.7% of decisions are ties, roughly
   half of "adherence" is the tie-break, not the grader. **Adherence does not determine win rate;
   adherence plus an arbitrary tie-break does.**

4. **Direction flips with the opponent.** The veto gains +425.3 bb/100 vs all-station but *loses*
   −46.1 vs all-nit and −50.2 vs all-tag, both outside the noise band. Against a single lineup this
   would have looked like a clean win; against four it is opponent-dependent.

5. **Six hours before this run, the answer was NO.** Against the grader as it stood at commit
   `6351ee8`, the veto arm *lost* −71.2 bb/100 [−96.6, −45.8], and pure adherence finished **6th of
   8, below always-fold**. One committed bug fix moved the verdict from "the grader actively harms a
   competent player" to "the grader helps as a veto". That fragility is the most important result
   here: see [The bug that flipped the verdict](#the-bug-that-flipped-the-verdict).

**So: grader-adherence weakly predicts win rate against our bots, in the veto framing only, with an
opponent-dependent sign. It does not survive as a standalone strategy, and it was actively harmful
one commit ago.**

---

## Method

Headless harness driving `src/core/table.ts`, `src/core/ai.ts` and `src/core/coach.ts` directly. No
Electron, no DOM. Four seats, hero in seat 0, blinds 25/50, every seat 100 bb deep — the shipped
table constants from `src/renderer/screens/table.ts`.

### Duplicate-hand pairing

Hand *n* is **the same hand for every policy**:

- the deal is keyed on `(seed, handNumber)` inside `startHand`, and every stack is restored to
  5000 before each hand, so the button rotation — and therefore the hole cards and the board — are
  byte-identical across policies;
- each villain decision draws from its own stream keyed on `(seed, handNumber, seatId, k)`, so the
  *k*-th decision of seat 2 sees the same rolls regardless of how the hero played.

Villain *behaviour* still diverges, because the pot and board it faces do — that is the effect under
measurement — but its *luck* does not. This is what makes the paired confidence intervals legitimate,
and it is much tighter than unpaired at the same *n*.

Stack resets also remove the bust/rebuy confound: without them, `always-fold` would survive forever
while a shoving policy busts and stops sampling.

### Hero policies

| Policy | Description |
|---|---|
| `adherent-passive` | **Grader-adherent.** Calls `gradeDecision` once per legal action, plays the argmin of `evLossBb`. Ties broken passive-first. |
| `adherent-aggro` | Same argmin rule, ties broken aggression-first. Isolates how much of "adherence" is really the tie-break. |
| `tag-baseline` | Control arm: the shipped TAG bot logic (`decideActionAs('tag', …)`) driving the hero seat, grader never consulted. |
| `tag-plus-grader` | **The treatment arm.** Same TAG intent, but when the coach grades the intended action non-free and some other legal action grades free, it switches to the nearest such action. The grader as a student meets it — a veto over play they already had. |
| `wide-caller` | Deliberately off but plausible: calls any bet at any price, never folds while it can call, never initiates. |
| `never-bluff-nit` | Deliberately off but plausible: value-bets only a near-lock (0.85), folds to any bet below 0.72 raw strength, never bluffs. Reads strength with `ai.ts`'s own 300-iteration estimator, **never the grader**, so its badness is independent of the thing under test. |
| `always-fold` | Control. Folds whenever legal. Its bb/100 is analytically known, so it validates the harness. |
| `random-legal` | Control. Uniform over legal actions. |

All aggression is sized to 2/3 pot, matching `ai.ts`'s `betPotFraction`, so sizing is not a confound.
All-in is ranked last in both adherent tie-breaks: the grader scores `allin` with the same branch as
`bet` and never sees the amount, so preferring it would measure the grader's blindness to sizing
rather than its advice.

### Bot mixes

Four lineups, so the answer is not an artifact of one opponent: `shipped` (tag/station/nit — the
actual `archetypeForSeat` assignment), `all-station`, `all-nit`, `all-tag`.

### Seeds and sample size

**Seeds: 20260809, 424242, 8675309.** Everything seeded through `mulberry32`; `Math.random` is never
called anywhere in the harness.

8 policies × 4 mixes × 3 seeds × **2000 hands = 24,000 paired hands per policy**, 192,000 hands
simulated in total, 404,589 hero decisions. Wall clock 1154 s across 9 cores.

**What this sample size buys.** The spec quotes σ ≈ 100 bb/100 for a 100-hand block. Measured here
for `adherent-passive`: **σ_hand = 16.6 bb, i.e. σ = 166 bb per 100-hand block** — worse than the
spec's figure, because a 4-handed 100 bb table with a station in it is higher-variance than the
6-max reference. At n = 24,000 that is an unpaired 95% half-width of **±21.0 bb/100**. Pairing brings
the half-width on *differences* to roughly ±25 bb/100 despite the differences having their own
variance.

Extrapolating from the observed σ, an unpaired ±10 bb/100 would need ~106,000 hands and ±5 bb/100
~424,000. **Anything below ~50 bb/100 in a single unpaired mean here is not measurable at this
sample size, and any reported difference smaller than its stated interval is a null result.**

---

## Results

Provenance: the harness reads `coach.ts`, `ai.ts`, `table.ts`, `equity.ts`, `evaluate.ts`, `cards.ts`,
`rng.ts`. This run used the **committed `c66c40e`** bytes of all seven (dependency hash
`ab936c4541ed69b8`); the run recorded all seven as clean at start, and the mid-run dirty warning it
printed was for unrelated `lessons/` and `sessionPlan.ts` files. Raw data:
`scripts/experiments/adherence/out/results-2000-c66c40e.json`.

`src/core/ai.ts` was subsequently edited by a parallel agent to add `export` to `PROFILES` plus one
comment. Verified inert for this measurement two ways: the file is byte-identical to `c66c40e` apart
from the `export` keyword and the comment, and re-running a cell after the edit reproduces the saved
per-hand results exactly. The current worktree dependency hash is therefore `a164c091d08c728d` while
the measured one is `ab936c4541ed69b8`.

### Pooled win rate, all mixes and seeds (n = 24,000 each)

| Rank | Policy | bb/100 | 95% CI | σ_hand |
|---:|---|---:|---|---:|
| 1 | `adherent-aggro` | **+222.6** | [+173.0, +272.3] | 39.2 bb |
| 2 | `tag-plus-grader` | **+193.8** | [+154.8, +232.7] | 30.8 bb |
| 3 | `adherent-passive` | **+80.7** | [+59.6, +101.7] | 16.6 bb |
| 4 | `tag-baseline` | +76.0 | [+44.0, +108.0] | 25.3 bb |
| 5 | `never-bluff-nit` | +71.3 | [+55.7, +86.9] | 12.3 bb |
| 6 | `always-fold` | −26.1 | [−26.7, −25.6] | 0.4 bb |
| 7 | `wide-caller` | −230.3 | [−255.6, −205.1] | 20.0 bb |
| 8 | `random-legal` | −368.0 | [−460.2, −275.7] | 72.9 bb |

Note these are all large positive numbers for anything competent, because a 4-handed table
containing a calling station is extremely profitable. Absolute levels are not the interesting
quantity; the paired differences are.

### The measurement that matters: grader marginal value

`tag-plus-grader` minus `tag-baseline`, paired, bb/100:

| Mix | Difference | 95% CI | Verdict |
|---|---:|---|---|
| **POOLED** | **+117.8** | **[+92.5, +143.0]** | **HELPS** |
| `shipped` | +142.0 | [+93.0, +191.0] | HELPS |
| `all-station` | +425.3 | [+354.5, +496.1] | HELPS |
| `all-nit` | −46.1 | [−64.4, −27.7] | **HURTS** |
| `all-tag` | −50.2 | [−98.8, −1.6] | **HURTS** |

The pooled result is positive and comfortably outside the noise. But the sign **flips against two of
the four lineups**, and it is not marginal in either — both exclude zero. The pooled win is carried
almost entirely by `all-station`, where the grader's pot-odds arithmetic correctly tells the hero to
keep paying a villain who never folds. Against thinking opponents the same advice is a small loss.

### Every pairwise paired difference (row − column, bb/100, `*` = significant at 95%)

```
                    adherent-  adherent-  tag-basel  tag-plus-  wide-call  never-blu  always-fo  random-le
adherent-passive            .      -142*         5       -113*       311*         9        107*       449*
adherent-aggro           142*          .       147*        29        453*       151*       249*       591*
tag-baseline              -5       -147*          .      -118*       306*         5        102*       444*
tag-plus-grader          113*       -29        118*          .       424*       123*       220*       562*
wide-caller             -311*      -453*      -306*      -424*          .      -302*      -204*       138*
never-bluff-nit           -9       -151*        -5       -123*       302*          .        97*       439*
always-fold             -107*      -249*      -102*      -220*       204*       -97*          .       342*
random-legal            -449*      -591*      -444*      -562*      -138*      -439*      -342*          .
```

Read the `adherent-passive` row. It beats the two genuinely bad controls (`wide-caller` +311,
`random-legal` +449) and `always-fold` (+107). It is **inside the noise against `tag-baseline` (+5)
and against the deliberately-crippled `never-bluff-nit` (+9)** — the grader's own preferred strategy
cannot be distinguished from a policy built to be bad. And it **loses to its own tie-break variant by
142**.

### Tie-break dominates

| Policy | hero decisions | all actions graded free | >1 action tied at the minimum |
|---|---:|---:|---:|
| `adherent-passive` | 60,183 | 23,653 (**39.3%**) | 28,691 (**47.7%**) |
| `adherent-aggro` | 50,536 | 18,345 (36.3%) | 22,355 (44.2%) |

**On 39.3% of decisions the grader has no opinion at all** (every legal action grades below the 0.5bb
silence threshold), and **on 47.7% the minimum is shared**. So on roughly half of all decisions the
thing choosing the action is the tie-break, not the coach. That is the mechanism behind the 142 bb/100
gap between two policies that are, by the definition under test, *equally adherent*.

### Harness validation

- `always-fold` measured **−26.1 bb/100 [−26.7, −25.6]**, and its outcome distribution is exactly
  the four values the rules permit, at the frequencies the rules predict:

  | per-hand result | count | share | why |
  |---:|---:|---:|---|
  | 0 bb | 12,000 | **50.0%** | not in a blind — folds preflop for nothing |
  | −0.5 bb | 6,000 | **25.0%** | in the SB, folds, loses the posted small blind |
  | −1 bb | 4,178 | 17.4% | in the BB, someone raised or the BB was outdrawn, loses the posted big blind |
  | +0.5 bb | 1,822 | 7.6% | in the BB, everyone folded around, collects the SB |

  The 50/25/25 split across the four seats is exact, and the BB row splits into loss and walk. Mean
  −0.2611 bb/hand = −26.1 bb/100. σ_hand = 0.4 bb, as a near-deterministic policy should be. This is
  the harness's strongest correctness check: a policy with an analytically forced outcome set produced
  precisely that set.
- **`stuckStates` = 0** across all 192,000 hands: the engine never presented a live state with no
  legal action.
- **Reproducibility verified twice.** Two independent runs of the same cell produce byte-identical
  per-hand results, and a 300-hand run is a strict prefix of the 2000-hand run of the same cell.

---

## The bug that flipped the verdict

**An earlier full run of this same experiment returned the opposite answer.** Against
`src/core/coach.ts` as of commit `6351ee8`:

| Measurement | at `6351ee8` (before) | at `c66c40e` (after) |
|---|---:|---:|
| grader marginal value (`tag-plus-grader` − `tag-baseline`) | **−71.2** [−96.6, −45.8] **HURTS** | **+117.8** [+92.5, +143.0] HELPS |
| `adherent-passive` | −96.2 [−105.2, −87.2] | +80.7 [+59.6, +101.7] |
| rank of `adherent-passive` | **6 of 8 — below `always-fold`** | 3 of 8 |
| rank of `never-bluff-nit` | 3 of 8 | 5 of 8 |
| decisions with no grader opinion | 68.0% | 39.3% |
| decisions tied at the minimum | 70.1% | 47.7% |

Archived: `out/results-2000-prefix-coach-6351ee8.json`,
`out/analysis-2000-prefix-coach-6351ee8.log`.

The cause, found by this harness and quoted from the probe output:

```
quad aces, river, pot 600, nobody bet — FOLD         evLoss=0.000bb  free
quad aces, river, pot 600, nobody bet — check        evLoss=2.700bb  serious
```

**The grader graded folding the absolute nuts as free and charged 2.70bb "serious" for checking the
same hand.** The fold branch returned `0` unconditionally when `toCall === 0`, and `fold` is in
`legalActions` at every decision including `toCall === 0` (`table.ts:273`), so an argmin-over-grader
policy was systematically induced to surrender pots it could not lose.

This was fixed in `c66c40e` by another agent working in this repository in parallel, prompted by the
`out/grader-bugs.log` this harness produced. The regression probe now reports
`ordering bet < check < fold: HOLDS`.

**The methodological point is more important than the bug.** A single one-branch defect in a
121-line heuristic grader moved the headline result from "the coach actively harms a competent
player by 71 bb/100" to "the coach helps by 118 bb/100" — a 189 bb/100 swing, roughly eight times
the measurement's own confidence half-width. **Any claim that adherence to this grader predicts win
rate is one bug away from being false, and the full unit suite was green in both states.**

### Process incident worth recording

The first run's data was silently invalid. `src/core/coach.ts` was committed at 00:24:45 while that
run had written its results at 00:23:14, so the saved numbers described a version of the grader that
no longer existed on disk. **Nothing in the output said so.** It was caught only because a
reproducibility check afterwards failed to reproduce, and the investigation of *that* led to the
commit log.

The runner now hashes the exact set of files the harness reads
(`coach/ai/table/equity/evaluate/cards/rng`), records the hash and HEAD in every results file, names
the output file after the hash, and prints
`!! DEPENDENCIES CHANGED MID-RUN … DISCARD` if they move. Watching all of `src/core` was too coarse
and produced a false alarm on an unrelated lessons/nav commit.

---

## Grader defects found

Reproductions with exact numbers: `scripts/experiments/adherence/out/grader-bugs-c66c40e.log`,
regenerated by `./node_modules/.bin/vite-node scripts/experiments/adherence/grader-bugs.ts`. All
still present at `c66c40e` except B4b.

**B7 — STRUCTURAL: the grader can essentially never strictly prefer betting or raising.** An
exhaustive sweep of (street × facing-a-bet × equity band) found aggression the *strict* argmin in
**2 of 24 cases**, both "check the nuts on a turn/river". On preflop and flop the best aggression can
ever do is *tie* check at zero:

```
preflop  toCall=0    high (quads)     check=0.00  bet=0.00  fold=3.40      argmin={check,bet}
flop     toCall=0    high (quads)     check=0.00  bet=0.00  fold=4.00      argmin={check,bet}
flop     toCall=100  high (quads)     fold=8.00  call=0.00  raise=0.00     argmin={call,raise}
```
The consequence, traced over real engine spots (`diagnose.ts`, 500 hands, seed 424242, 1481
decisions): **`adherent-passive` never bets or raises on preflop or the flop — not once —** and its
only aggression is `turn/bet` 5.5%, `river/bet` 6.3%, `river/allin` 0.3%. Aggression is legal at
every one of those 1481 decisions and ties for the graded minimum on 49.4% of them, so the grader
permits it constantly and *requires* it almost never. Before the `c66c40e` fix it was worse still:
zero bets and zero raises across all 824 traced decisions.

This is the mechanism behind the 142 bb/100 gap: the grader cannot distinguish the two tie-breaks, so
the tie-break is free to be right.

**B1 — blind to bet size and stack depth.** A min-bet and an all-in shove grade identically.
`betSize` and `stack` are accepted by `gradeDecision` and never read.
```
bet, stack 100     evLoss=0.113bb  free
bet, stack 5000    evLoss=0.113bb  free
allin, stack 5000  evLoss=0.113bb  free
```

**B2 — it can never say "bet this".** Value is only ever charged to a CHECK, only on turn/river, only
above 55% pot share. Betting quad aces and checking them both grade `0.00bb free` on the flop.

**B3 — folding is free whenever calling is −EV**, so `fold` ties the cheapest continuation and the
tie-break decides whether the hero folds or continues.

**B5 — equity is measured vs RANDOM hands, so correct folds are graded as serious errors.** A villain
who bets the river does not hold a random hand, but `equityVsRandom` assumes it does:
```
99 on KQ943 river, facing pot bet, fold   evLoss=3.844bb  serious  Folding with 98% pot share when only 50% was needed costs ~3.8 bb.
99 on KQ943 river, facing pot bet, call   evLoss=0.000bb  free
```
This is the defect most likely to teach a beginner something actively harmful — it tells them to
never fold — and it is the mechanism behind the grader *losing* money against `all-nit` and
`all-tag`, whose bets mean something.

**B6 — the missed-value charge cannot fire in a small pot even holding the nuts.** It is
`(equity − 0.55) × pot × 0.5 / bb`, so checking quads is silent below a ~2.2bb pot:
```
quad aces, river, check, pot=100 (2.0bb)   evLoss=0.450bb  free
quad aces, river, check, pot=111 (2.2bb)   evLoss=0.499bb  free
quad aces, river, check, pot=150 (3.0bb)   evLoss=0.675bb  notable
```

**B4b — [FIXED in `c66c40e`]** folding the nuts graded free. Kept as a regression probe.

---

## What this does and does not establish

**Does:**
- The grader adds bb/100 as a veto over competent baseline play, pooled across four bot mixes, at
  n = 24,000 paired hands.
- The grader's own argmin is not a strategy: indistinguishable from the TAG bot and from a
  deliberately bad nit, and 142 bb/100 behind an equally-adherent tie-break variant.
- Adherence is not monotone with win rate, and the marginal value flips sign by opponent.
- The result is fragile to single-branch defects in a 121-line heuristic.

**Does not:**
- **Anything about solver-adherence.** No solver, no spot bank, no GTO baseline. The spec's Open
  question #1 is still open.
- Anything about *human* win rate. The opponents are three rule-based bots whose strategy is a
  function of `equityVsRandom` — the same estimator the grader uses. Hero and villain share a world
  model, which flatters the grader in a way no human opponent would.
- Anything about *learning*. This measures a policy mechanically obeying advice, not a person
  acquiring skill from it. A hero that follows a veto perfectly is not a student.
- Anything about bet sizing. B1 means the grader cannot express sizing, so every policy here sizes at
  a fixed 2/3 pot. A real strategic question is entirely outside the instrument.
- Absolute bb/100 levels transferred to any other configuration. These are 4-handed, 100 bb,
  25/50, with stacks reset every hand.

## Recommendation

The spec's stated fallback — "if it doesn't track even against the trainer's own bots, the promise is
dead before a single node is solved" — is **not** triggered: it does track, weakly, in the veto
framing. But the honest reading of the numbers is that **this grader is a reasonable in-game hint
layer and is not fit to author a curriculum against.** Two policies that are identically adherent
differ by 142 bb/100; the grader has no opinion on 39% of decisions; it cannot recommend a bet; it
cannot see a bet size; and it tells a beginner never to fold. Content authored as though this grader
were GTO would be teaching its artifacts.

The experiment the spec actually asked for still needs a solver and a spot bank, and this result
does not substitute for it.

---

## Reproducing

From the **repo root** (`/tmp` cannot see `node_modules`):

```bash
# full experiment, ~19 min on 9 cores — writes out/results-2000-dep<hash>.json
./node_modules/.bin/vite-node scripts/experiments/adherence/run.ts 2000 20260809 424242 8675309

# re-analyse saved data without re-simulating
./node_modules/.bin/vite-node scripts/experiments/adherence/analyze.ts \
  scripts/experiments/adherence/out/results-2000-c66c40e.json

# grader defect reproductions
./node_modules/.bin/vite-node scripts/experiments/adherence/grader-bugs.ts

# per-decision grader diagnostics over real engine spots
./node_modules/.bin/vite-node scripts/experiments/adherence/diagnose.ts 300 20260809
```

Files: `scripts/experiments/adherence/{harness,policies,stats,run,cell,analyze,diagnose,grader-bugs}.ts`.
`src/` and `tests/` were not modified by this experiment.
