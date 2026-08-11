# GTO Fundamentals and Pedagogy for the Offsuit Tutor

A consolidated, deduplicated reference covering (A) the solver-math primitives Offsuit's grading engine should teach and check, and (B) how strong players actually study GTO and how that maps onto Offsuit's existing pedagogy machinery. Every formula below is exact and deterministic — the app can compute it for any bet size without a solver.

---

## A. The indifference spine

The whole framework hangs off one idea: **indifference**. MDF makes the *bettor's bluffs* indifferent; the correct bluff-to-value ratio makes the *caller's bluff-catchers* indifferent; mixed strategies keep the *opponent* indifferent between exploit attempts. Sklansky's optimal-bluffing rule (bluff a fraction equal to the pot odds you lay) is the same math seen from the aggressor's side. Teaching pot odds, MDF/alpha, bluff ratios, and mixing as one "indifference" family ties them together instead of as four disconnected rules.

### Pot odds vs required equity
- **Pot odds** = ratio of pot to the cost of a call (e.g. $30 pot, $10 call = 3:1).
- **Required (break-even) equity** = `call / (pot_after_call)`. Facing a bet `B` into pot `P`, required equity = **`B / (P + 2B)`**.
  - 3:1 pot-odds call needs 25% (`1/(3+1)`).
  - Pot-sized bet needs 33%.
- **Beginner misconception**: treating the ratio and the percentage as interchangeable, and forgetting the pot grows by your own call in the denominator.

### Equity vs EV
- **Equity** = your share of the pot at showdown (estimate via outs; **Rule of 2-and-4**: outs × 2 per remaining street, ×4 with two streets to come).
- **EV** = money-weighted average outcome of a *decision*, including fold equity and future betting — not just showdown share. A call can be **+EV below** the raw pot-odds threshold (implied odds) and **-EV above** it (reverse implied odds).
- **Misconception**: equating "I have enough equity" with "+EV" while ignoring realization, position, and future streets.

### MDF and alpha
- **MDF (Minimum Defense Frequency)** = `Pot / (Pot + Bet)` — how often the defender must continue (call or raise) so a zero-equity bluff can't profit betting any two cards. Pot-sized bet → 50%; half-pot → 67%.
- **Alpha (α)** = `Bet / (Bet + Pot)` = risk/(risk+reward) = the fold frequency at which a 0%-equity bluff breaks even; the max a defender may fold. **α = 1 − MDF.** The `Bet/(Bet+Pot)` form is only valid for an *initial bet*; for a raise use `risk/(risk+reward)`.
- **Key limitation**: MDF assumes bluffs have **zero equity**, which real bluffs (draws, high cards) rarely do. Do **not** apply MDF against players who don't bluff enough — over-fold vs value-heavy opponents instead. Apply it only to bluff-catchers, not against polarized value+draws. Solver data across all 1755 flops shows the OOP BB consistently **over-folds** relative to MDF while the IP defender calls closer to it. MDF is a shield against over-bluffing, not a universal defend rule.

### Bluff-to-value (bettor's side)
- On the river, bluffs as a fraction of your betting range = **`Bet / (Pot + 2·Bet)`**, making the opponent's bluff-catcher indifferent. Value:Bluff = `(Pot+Bet):Bet`.
  - Half-pot ≈ 2 value : 1 bluff (~33% bluffs).
  - Pot-sized ≈ 2 value : 1 bluff (~33% bluffs).
  - Overbets justify **more** bluffs (higher α).
- **Misconception**: "a pot bet means 50% bluffs" — from the bettor's side it's ~1/3. The widely-copied river-odds tables **conflate** defender pot-odds with bettor bluff-ratios and are internally inconsistent; teach the two perspectives separately.

---

## B. Ranges, textures, and sizing

### Range construction and shapes
Think in the whole *set* of hands you'd play a way, not the single hand you hold.
- **Polarized** = strong value + weak bluffs, no medium hands → bets big.
- **Linear / merged** = strong + medium + weak in a contiguous block (top corner of the matrix) → bets medium; common on flops where value can still be outdrawn and draws improve.
- **Condensed / capped** = mostly medium, no nutted hands → the vulnerable, checking/calling side.
- **Misconception**: judging your single hand's strength instead of how the whole range performs; mislabeling merged as polarized.

### Polarization and bet sizing
- A perfectly polarized range maximizes EV with **geometric** sizing: one constant %-of-pot per street that gets you exactly all-in on the last bet.
- **Geometric bet size** = `0.5 · (((pot + 2·eff_stack) / pot)^(1/n_bets) − 1)`.
- Larger polarized bets pressure capped ranges and license more bluffs (higher α). Caveat: big bets and polarized ranges *usually* pair but not always — you can bet small polarized or big linear. Don't overbet without a nut advantage.

### Range advantage vs nut advantage (independent)
- **Range advantage** = your whole range's average equity beats the opponent's on this board → drives bet **FREQUENCY** (c-bet more often, especially dry boards).
- **Nut advantage** = you hold more of the very strongest combos → drives bet **SIZING** and fold equity (size up / overbet).
- High-dry boards (A-K-2 rainbow) favor the preflop raiser; connected low boards (8-7-6) favor the caller.
- **Detectable mistake pattern**: "checking when ahead / betting when behind" — scared players check strong ranges; capped players keep firing marginal hands.

### Blockers / card removal
- A **blocker** removes combos from the opponent's range (A♠ blocks their nut flush); **unblockers** make their holdings more likely.
- Combinatorics: holding one card of an unpaired hand cuts its 16 combos; holding one card of a rank cuts that pair from 6 toward 3.
- **Reframe by hand intent**: value wants to block trash + unblock value (get paid); **bluffs** want to block value + unblock trash (induce folds); **bluff-catchers** want to block value + unblock the opponent's bluffs.
- **Misconception**: blockers always dominate. In reality effects are often microscopic and exploitative reads (is villain over/under-bluffing?) usually outweigh card removal. Blockers matter most when ranges are narrow/polarized or facing a large bet.

### SPR and equity realization
- **SPR (Stack-to-Pot Ratio)** = `eff_stack / pot`, measured at the start of a street. Break-even all-in equity rises with SPR: SPR 1 ≈ 33%, SPR 2 ≈ 40%, SPR 3 ≈ 43%. Low SPR suits one-pair/made hands (AA/KK/AK prefer 3-betting to lower SPR); high SPR suits robust/nut draws.
  - **Misconception**: measuring commitment in big blinds instead of SPR.
- **Equity realization**: raw equity assumes the hand always reaches showdown; **realized equity** = the share actually won given position, streets, folds. Usually `R < 1` (e.g. realized = 0.75 × 40% = 30%), but a hand can over-realize (`R > 1`). Drivers: position (IP realizes more), connectedness/suitedness (76s flops something 62.4% vs 55.9% for 76o), higher SPR helps IP realize (hurts OOP), range advantage, opponent skill.
  - **Misconception**: valuing hands by raw equity preflop leads to -EV calls; offsuit/disconnected hands realize far less than raw equity suggests.

### Pure vs mixed — the Three Laws of Indifference
1. **Selfish EV**: every hand takes its own highest-EV action.
2. **Indifference**: if a hand mixes, those actions have equal EV.
3. **Fixed Strategies**: changing your mix among indifferent actions costs nothing against a *fixed* opponent; it only matters if they adapt.

**Why solvers mix**: to make the *opponent* indifferent and stay unexploitable — the right action with your hand is set by the opponent's strategy, not your own range. When one action is clearly higher-EV, the solver plays it **pure**. Exploitative/nodelocked sims produce more pure actions.
- **Misconceptions**: "GTO punishes every mistake" (it only gains vs *pure* mistakes that lose EV, not vs mixing errors); sub-1% mixed frequencies are usually solver noise, not meaningful equilibrium behavior.

---

## C. How strong players study, and how to teach it

### Solver workflow (garbage-in-garbage-out)
1. **Fix inputs**: correct starting ranges, effective stack (a 100bb solution differs fundamentally from 50bb), and a **deliberately small bet-size tree** (three sizes per street: small 25-33%, medium 66-75%, overbet 125-150%).
2. Read **range-level frequencies before individual hands**.
3. Separate **pure** strategies (top set always bets, air always folds — these capture most of the edge) from **mixed**.
4. Run **adjacent boards** to turn facts into rules.

### Distill-and-test cadence
A weekly loop: pick one spot (Mon) → run 10-15 boards logging frequencies/sizes/categories (Tue-Wed) → **distill 3-5 heuristic rules** (Thu) → test those rules in play and check against the solver (Fri/weekend). The distillation step (many solves → a few executable rules) is what converts data into skill.

### Node-locking — mechanics and boundaries
- **Mechanics** (GTO Wizard model): *Set Strategy* (paint an action over hand classes), *Set Frequency* (shift aggregate frequencies; hands move by EV-loss order, weakest fold first), *Lock/Unlock*. **Gotcha**: Set Frequency does **not** auto-lock the hands you adjusted — you must lock the range before submitting. *Compare Nodes* shows before/after.
- **Only "somewhat exploitative", not maximal**: when you lock one node, the solver still assumes the villain plays **perfect GTO at every other node**, so it (a) constrains itself to exploits immune to counter-exploitation elsewhere and (b) unrealistically models a player flawless everywhere but the locked spot. A true max-exploit requires locking *every* node. Use node-locking to reveal pool imbalances and the **direction** of deviation, not as a magic max-EV button.
- **Single-street limit**: solver AI solves one street at a time; a locked-flop exploit assumes perfect future-street play.

### Population exploitation off a GTO baseline
Exploitation is a **layer on top of** GTO, never a replacement — keep the baseline so you don't create your own leaks. Workflow: gather pool stats (VPIP, PFR, 3Bet/4Bet, Fold-to-Cbet, check-raise freq) → translate a stat into a locked frequency ("pool folds 60% to turn barrels" → lock 60% fold) → read the counter → simplify into rules. **Common leaks and counters**: over-folding to c-bets on boards missing the defender (c-bet wider, more bluffs); under-bluffing turn/river (over-fold vs their bets, bluff them more); calling stations too wide (value-bet thinner and larger); polarized/capped 3-bet ranges (fold out bluffs, call lighter). Caveats: mind sample size, separate pool from individual, account for meta drift.

### Learning science
- **Deliberate practice (Ericsson)**: well-defined task with a clear goal, learner can attempt independently, **immediate feedback**, repeatable, teacher-designed. Decompose the skill and drill the weak chunk at the **edge of ability**. Without corrective feedback, repetition grooves bad habits. Quantity of play has far lower benefit than deliberate practice (meta-analytic r≈0.40).
- **Testing effect / retrieval practice**: active retrieval beats passive review; **difficult-but-successful** retrievals build memory best, and even failed attempts help (generation effect). Testing **with feedback** outperforms testing without. **Interleaving** beats blocked practice because real spots "come at you mixed."
- **Spaced repetition**: exploits the spacing effect against the forgetting curve; wrong/hard cards resurface sooner. Algorithms: Leitner, SM-family, modern **FSRS** (Anki 23.10). Practical schedule: review a rule on days 1, 3, 7.
- **Four range drills**: (1) Pair-Quiz = active recall (commit before peeking, focus on errors); (2) Position-Flip = interleaving (quiz one hand across all seats in **random** order); (3) Partner Quiz = retrieval surfacing the *why*; (4) Time-Pressure Recall = automaticity (3-second timer).

### Separating decision from result, and decision from reasoning
- **Resulting (Annie Duke)**: judging a decision by its outcome is a trap. Test: imagine the exact spot 1000 times — is it +EV or -EV *given what you knew at the time*?
- **Right for the wrong reason** (the core coaching insight): a player can pick the correct action with wrong justification, or a normally-correct action where it's wrong. Worked example: value-betting AK on K92 is textbook-correct, but **continuing vs a turn check-raise** (heavily value-weighted at that level, beating TPTK with 99/44/K9) is the leak — "right idea, wrong application" costing 100bb vs 6bb. Remedy: at each node ask "what does this action represent / what range am I up against?" and grade the *thinking* at each node independently of the card and of whether the standard play usually works.
- **Hand-review method**: tag hands where you hesitated (>5s), replay **without** the result, write reasoning at each node, then reveal; reconstruct **both** ranges ("most mistakes hide in the range step, not the single hand"); find repeated patterns sorted by street with P&L per pattern; fix **one leak at a time**.
- **Common study mistakes**: studying only lost hands (variance-driven) instead of high-frequency spots; memorizing solver numbers instead of the why; copying frequencies without an executable rule; ignoring turn/river; skipping spaced reviews.

---

## Applicability to Offsuit

Offsuit already implements a large share of the *pedagogy* research; the largest untapped opportunity is on the *solver-math* side.

**What already exists (do not rebuild):**
- **Spaced repetition** — `src/core/schedule.ts` implements flat (non-expanding) waves at days 0/1/7/21/30 and a beta-binomial mastery posterior (a deliberate, better-calibrated alternative to fitted FSRS at n≈12). This *is* the day-1/3/7 recommendation, tuned.
- **Interleaving** — `src/core/interleave.ts` enforces "block only at low similarity or first exposure," derives similarity from stimulus+response, and pre-frames the 20-30pt accuracy drop. This is the interleaving/position-flip science, structurally.
- **Decision vs reasoning** — `src/core/reasonGrade.ts` grades the stated reason into `range/price/hand-strength/none`, and G4 (`applyG4Override`) escalates the exact "right for the wrong reason" case to T3. This directly implements the AK-on-K92 insight.
- **Confidence routing** — `src/core/confidence.ts` gives GUESS-correct *more* support than SURE-correct (the lucky-guess asymmetry) and schedules SURE-wrong on days 0/2/7, plus a latency cross-check catching "guess-but-fast / sure-but-slow."
- **Population exploitation** — `src/core/archetypes.ts` ships the six leaks with actionable exploit text (nit/station/lag/tag-reg/over-folder/maniac) and per-session jitter, and `tag-reg` correctly encodes "no reliable leak, play standard."

**The real gaps (where this research is most actionable):**

1. **`coach.ts` grades with ad-hoc equity thresholds, not the exact formulas.** `gradeDecision` compares Monte-Carlo equity against `potOddsRequired = toCall/(pot+toCall)` for calls (correct), but bets/checks are graded against hardcoded constants (`equity < 0.35`, `equity >= 0.55`). Replace these with the size-derived, board-agnostic formulas: grade defense against **MDF = Pot/(Pot+Bet)**, fold frequency against **α = Bet/(Bet+Pot)**, and the *betting* range's bluff fraction against **Bet/(Pot+2·Bet)**. These are exact and deterministic for any bet size — the single highest-leverage correctness upgrade.

2. **No equity realization.** `src/core/equity.ts` returns raw Monte-Carlo equity vs random, and `coach.ts` grades on it directly (halving it only in the crude free-fold haircut). Introduce an **R multiplier** keyed on position, SPR, and suitedness/connectedness so preflop grading stops rewarding -EV calls that merely have raw equity (penalize offsuit-disconnected hands whose realization is low).

3. **No SPR-aware commitment coaching.** Compute `SPR = eff_stack/pot` per street and map to break-even all-in equity (SPR1≈33%, SPR2≈40%, SPR3≈43%) to teach pot-commitment and the "AA/KK prefer 3-betting to lower SPR" lesson. `coach.ts` currently ignores stack entirely (its own comment notes it "reads neither betSize nor stack").

4. **Board-texture classification is a tag without a computation.** `reasonGrade.ts`/`types.ts` carry `TEXTURE` and `DEPTH-POSITION` error tags, and `lessons/content/board-texture-dimensions.ts` teaches it, but nothing classifies a flop for **range advantage (drives frequency) vs nut advantage (drives sizing)**. A texture module would let the tutor detect the specific "checking when ahead / betting when behind" mistake.

5. **Teach the two indifference perspectives separately.** Offsuit can differentiate itself by being numerically correct where the popular river-odds tables conflate defender pot-odds with bettor bluff-ratios. The lessons `alpha-the-bluff-price.ts` and `minimum-defence-frequency.ts` already exist; ensure the coach messages present defender-MDF and bettor-bluff-to-value as distinct math.

6. **Grade mixing honestly.** Use the Three Laws to present pure spots as clear-cut and mixed spots as equal-EV, and explicitly treat sub-1% mixes as noise — grade whether the chosen action is within the EV-indifference band, not whether it matches the modal solver action (avoids false negatives against a human who picks a legitimate side of a mix).

7. **A geometric-sizing helper** (`0.5·(((pot+2·eff_stack)/pot)^(1/n_bets)−1)`) would let the coach recommend a per-street size that sets up a clean all-in for polarized ranges, and flag overbets attempted without a nut advantage.

8. **Blocker feedback by intent, with a humility caveat.** When the tutor explains `BLOCKERS`, reframe by hand role (value/bluff/bluff-catcher) and warn that card-removal edges are often microscopic vs exploitative reads — preventing the agent from over-explaining tiny removal effects.

The catalog of beginner misconceptions (ratio vs percentage, raw vs realized equity, single-hand vs range thinking, over-applying MDF vs non-bluffers, blockers dominating, resulting) is a ready-made mistake taxonomy the six archetypes and the tutor can detect and address.

---

## Sources
- https://en.wikipedia.org/wiki/Pot_odds
- https://blog.gtowizard.com/mdf-alpha/
- https://blog.gtowizard.com/the-three-laws-of-indifference/
- https://blog.gtowizard.com/stack-to-pot-ratio/
- https://blog.gtowizard.com/understanding-blockers-in-poker/
- https://upswingpoker.com/geometric-bet-sizing/
- https://upswingpoker.com/equity-realization-explained/
- https://upswingpoker.com/polarized-vs-linear-ranges/
- https://pokercoaching.com/blog/range-advantage/
- https://riverodds.app/river-bluff-frequency/
- https://help.gtowizard.com/how-to-use-nodelocking/
- https://www.poker.org/poker-strategy/pro-tips-with-james-sweeney-the-problem-with-node-locking-a1rY07C6ISPQ/
- https://thinkgto.com/blog/how-to-use-a-poker-solver-effectively
- https://thinkgto.com/blog/memorize-preflop-ranges-without-burning-out
- https://pokerwizard.org/news/node-locking-population-tendencies
- https://en.wikipedia.org/wiki/Practice_(learning_method)
- https://en.wikipedia.org/wiki/Spaced_repetition
- https://en.wikipedia.org/wiki/Testing_effect
- https://hunter.poker/en/poker-result-oriented-thinking-vs-decision-quality/
- https://jarvispoker.com/learn/how-to-review-a-poker-hand
- https://pokeredgehub.com/hand-review-method-en/
- https://www.rangecraftpoker.com/en/help-center/poker-tools-how-to-build-effective-study-habits