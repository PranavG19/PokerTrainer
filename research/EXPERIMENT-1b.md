# Experiment 1b — the grader after Wave 0 (close band, charts preflop, villain ranges)

The Wave 0 exit measurement (build plan package 0.7). Same harness, seeds and sample as
[Experiment 1](EXPERIMENT-1-adherence.md): 8 policies × 4 lineups × 3 seeds (20260809, 424242, 8675309) ×
2000 hands = 24,000 paired hands per policy. The same scope correction applies: this measures adherence to
**our own grader** against **our own bots**, not solver adherence.

## What changed in the harness

- **It now grades the way the live table does.** Experiment 1 called `gradeDecision` with no villain model,
  while the live table passed `VILLAIN_BETTING_RANGE` whenever a bet was faced. Both now call
  `core/gradeSpot.ts` (`scripts/experiments/adherence/grade.ts`), with each bot's archetype profile as its
  model. `OFFSUIT_GRADER_MODE=legacy-random` keeps the old no-model call so the original figure can be
  reproduced.
- **More opinion measures**, per street (`report.ts`): *silent* (every action under 0.5bb and nothing
  flagged close: the grader says nothing), *close* (some action inside the band), *tied* (as before: more
  than one action at the minimum), *tiedCls* (more than one action class at the minimum, with bet, raise
  and all-in one class, because the grader never sees a size), *decisive* (a unique minimum and some action
  charged). Verdict histograms over every legal action and over the action played.
- **Re-seed stability** (`stability.ts`): 300 hands of real engine spots, every legal action graded under 5
  grader seeds; a state "flips" when some action's verdict word changes, and "flips loud" when one seed calls
  an action a mistake and another does not.
- Cells retry after a transient spawn/file error (a cell is deterministic, so a retry is identical).

Raw reports: [`experiment-1b/`](experiment-1b/) (`before-legacy-random.txt`, `before-shipped.txt`,
`after-shipped.txt`, `stability-*.txt`).

## Results

"Before" is `origin/main` at `2b28855`. "Before, shipped" grades as the live table did (the fixed betting
range when facing a bet); "before, legacy" is the no-model call Experiment 1 used. "After" is this branch at `a3a55f6` (the tip's grader; later commits touch only scripts and docs).

### How often the grader has an opinion (adherent-passive, every legal action graded, all streets)

| Measure | Exp. 1 as published (`c66c40e`) | Before, legacy (`2b28855`) | Before, shipped (`2b28855`) | After |
|---|---:|---:|---:|---:|
| decisions | 60,183 | 60,183 | 74,737 | 60,968 |
| every action free (old "no opinion") | 39.3% | 43.2% | 39.2% | 22.7% |
| **silent** (free and nothing close) | 39.3% | 43.2% | 39.2% | **18.0%** |
| close (some action in the band) | — | — | — | 12.4% |
| tied at the minimum | 47.7% | 53.9% | 61.7% | 56.1% |
| tied, bet/raise/all-in as one class | — | — | 51.0% | 46.7% |
| decisive | — | 14.7% | 13.2% | 29.7% |

Preflop, where the charts now decide: silent 62.2% → 14.0%, decisive 2.1% → 43.1% (before, shipped → after).
Postflop silent: flop 34.1% → 26.5%, turn 27.7% → 20.9%, river 20.1% → 12.8%.

The legacy column differs from the published 39.3% / 47.7% because `coach.ts` changed after `c66c40e`
(the exact break-even raise price, `57d7bec`, and the free-fold retag); the decision count reproduces
exactly (60,183), so the harness is the same.

### Severity distribution (adherent-passive)

| Over | free | close | notable | serious |
|---|---:|---:|---:|---:|
| every legal action, before (shipped) | 80.1% | — | 14.4% | 5.5% |
| every legal action, after | 63.0% | 6.7% | 21.9% | 8.4% |
| action played, after | 94.1% | 5.9% | 0% | 0% |

### The veto arm per lineup (tag-plus-grader − tag-baseline, paired bb/100, 95% CI)

| Lineup | Before, legacy | Before, shipped | After |
|---|---|---|---|
| pooled | +101.3 [+75.5, +127.1] | +144.1 [+113.0, +175.2] | **+182.5 [+151.8, +213.2]** |
| shipped (tag/station/nit) | +127.5 [+75.9, +179.1] | +110.9 [+48.2, +173.7] | +153.5 [+93.4, +213.6] |
| all-station | +402.4 [+331.0, +473.8] | +566.6 [+476.5, +656.6] | +546.6 [+454.0, +639.1] |
| all-nit | **−50.4 [−69.3, −31.6] HURTS** | **−31.2 [−48.0, −14.4] HURTS** | **+32.9 [+15.2, +50.6] HELPS** |
| all-tag | **−74.2 [−123.6, −24.8] HURTS** | **−70.0 [−124.9, −15.2] HURTS** | −3.1 [−52.8, +46.7] inside noise |

### Pooled win rates (bb/100)

| Policy | Before, shipped | After |
|---|---|---|
| adherent-passive | +104.1 [+78.4, +129.9] | +116.3 [+91.9, +140.7] |
| adherent-aggro | +360.7 [+294.0, +427.4] | +374.1 [+306.4, +441.7] |
| tag-plus-grader | +220.1 [+176.5, +263.7] | +258.5 [+216.9, +300.1] |
| tag-baseline (control, unchanged) | +76.0 [+44.0, +108.0] | +76.0 [+44.0, +108.0] |

`adherent-passive` and `adherent-aggro` still differ by about 260 bb/100: the tie-break still decides much
of what "adherence" plays.

### Re-seed stability (300 hands, 5 grader seeds)

| | Before (shipped) | After |
|---|---:|---:|
| hero decision states | 998 | 971 |
| some verdict word changes | 8.9% | 14.1% |
| **a mistake under one seed, not under another** | **6.7%** | **6.1%** |

The band does not move loud flips. Any hard line on a noisy estimate flips near the line; the band moves the
line (to the band's edge) rather than removing it, and the 0.5bb silence line is a second edge. The word-level
rate rises because "close" is a new word that a spot can flip into.

## Verdict: is the grader fit to drive rewards?

**Not yet, for rewards that read a single verdict. It now meets one of the two suggested targets, and it is
fit for the coarse use the skeptic proposed.**

Against the suggested pre-registered targets (BUILD-PLAN Wave 0):
- *No opinion on under 20% of decisions:* **met, narrowly and with a caveat** — 18.0% silent (39.2% before). Part of the last drop is cheap: a 100bb preflop shove is now priced (`shoveLossBb`), so in many preflop spots the all-in is the one action charged. Before shove pricing (`c91155d`) it was 21.7%. On the old
  measure (every action free, a close spot included) it is 22.7%.
- *No severity flip from re-seeding on a fixed spot set:* **missed** — 6.1% of states still flip between
  "mistake" and "not a mistake" under re-seeding (6.7% before). Not reachable by any threshold on a 2000-
  iteration estimate; it needs either more iterations on graded spots or a reward that ignores verdicts near
  a line.
- *A veto arm positive against all four lineups (the skeptic's bar):* **missed narrowly** — positive against
  three, all-tag now inside the noise at −3 (it was −70, significant). Both previously harmful lineups improved.

What did improve, plainly: preflop is graded (decisive 2% → 43%), the archetype exploit text and the grade
now agree (calling down a maniac is not charged; folding to a nit is not), and the veto arm stopped hurting.

What still blocks a reward layer: ties (46.7% even counting bet/raise/all-in as one) come from the grader
never preferring a bet to a check except on turn/river value (Experiment 1 defect B7, out of this scope), and
~6% of verdicts are seed-fragile. **Recommendation:** rewards, if any, key only on the coarse "serious vs not"
boundary and give nothing for close spots, as the skeptic proposed; the reward-reading layer waits for a
best-alternative comparison (G-d) and a stability fix (more iterations on graded decisions). The owner sets
the real bar.

## Reproducing

```bash
OFFSUIT_JOBS=12 OFFSUIT_GRADER_MODE=shipped ./node_modules/.bin/vite-node scripts/experiments/adherence/run.ts 2000 20260809 424242 8675309
./node_modules/.bin/vite-node scripts/experiments/adherence/stability.ts 300 20260809 5
```
"Before" runs used frozen worktrees at `2b28855` with this branch's harness files copied in.
