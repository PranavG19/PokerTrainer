# Panel: poker domain expert

Lens: what a serious player would need before trusting Offsuit, what the current engine can and cannot honestly support, and how a Duolingo-style character, streak and cosmetics layer could cost the product its credibility, plus how to prevent that.

## 1. Bottom line

Offsuit already has an unusually honest epistemology for a trainer. It refuses to fabricate solver output (`src/core/bank.ts`, `UNGRADED_NOTICE`), labels its own heuristics as heuristics (`src/core/robustness.ts` bans the words "exploitability", "bound" and "worstCase"), gates reads on sample size (`src/core/reads.ts`), and withholds results graphs until the sample means something (`src/renderer/screens/variance.ts`). That honesty is the product's strongest asset with serious players. Most consumer trainers do not have it.

The weak point is the live grader. `src/core/coach.ts` is a single-hand pot-odds model scored against one fixed villain range. A strong player will find its blind spots within an hour of play. Gamification would multiply them: if XP, streaks or the character react to grades, every grader error becomes a celebrated or punished moment. The order of work should be:

1. Make the grader say "close" when it cannot tell, and make it agree with the app's own charts and archetypes.
2. Add the tools a serious player expects that the current math can support honestly: range-vs-range equity, ICM, push/fold, a session log and hand-history import with counting stats.
3. Add the habit layer only on top of process signals, never on results.

## 2. Current-state assessment

### What is solid

- **Equity engine.** `src/core/equity.ts` provides exact heads-up enumeration (`exactEquityHeadsUp`), seeded Monte Carlo against random hands (`equityVsRandom`), and combo-weighted Monte Carlo against a range with card removal built in (`equityVsRange`, which enumerates concrete villain hands, so the 6/4/12 combo weights are exact). It is deterministic and tested. It is enough to build range-vs-range, ICM all-in equity and push/fold tables.
- **Poker arithmetic.** `src/core/arithmetic.ts` covers pot odds, MDF/defence, SPR, combo counting and a normal-approximation `riskOfLosing` with `SIGMA_BB_PER_100 = 100`. This is the base for any variance or hourly calculator.
- **Preflop blueprint.** `src/core/preflop.ts` has a purified 100bb 6-max RFI family, six defence spots, 3-bet responses, and threshold-generated ranges so the rule text and the grid cannot drift apart. `src/core/chartBank.ts` and `src/core/rangeEditor.ts` are thin, honest layers over it. The header states plainly that there are no frequencies, which is the right call for beginners but limiting for serious players (see 4.1).
- **Population and reads.** `src/core/archetypes.ts` has six archetypes with actionable exploit text and per-session jitter. `src/core/reads.ts` has real go/no-go gates (`MIN_OBSERVATIONS = 20`, a 15-point deviation threshold, `w = n/(n+10)` shrinkage that is explicitly not treated as a safety gate, and an exact binomial false-read probability). This is better read hygiene than most HUD users have.
- **Study prioritisation.** `src/core/rw.ts` and `src/core/reachRef.ts` keep reach out of severity and use it only to order study, against an authored, versioned reference population (`REFERENCE_POP_ID = 'authored-street-class-v1'`).
- **Honest scope statements.** `src/core/contrast.ts` declares the board-texture, stack-depth and range-asymmetry axes unavailable instead of faking them. `src/core/spotType.ts` classifies preflop only. `src/core/bank.ts` ships `EMPTY_BANK_INDEX`: there is no postflop solver data, and the code says so.
- **Variance literacy.** `src/renderer/screens/variance.ts` explains, using the real arithmetic, why a win rate is withheld below 2,000 hands and a graph below 10,000. Serious players respect this.

### What a strong player will notice (the credibility gaps)

1. **The grader's villain model is the same fixed range for every street, archetype and position.** `VILLAIN_BETTING_RANGE` in `src/core/preflop.ts` is one position-independent "has-a-hand" range, between CO and BTN RFI width. `src/renderer/screens/table.ts:589` and `src/core/assessmentBlock.ts:212` pass it whenever `toCall > 0`. Consequences:
   - A river bet is graded as if it came from a preflop continuing range. Real river betting ranges are polarized and much narrower, so bluff-catch grading is unreliable in both directions.
   - It ignores the villain's archetype. `ARCHETYPE_EXPLOITS.maniac` tells the learner to "call down light". The grader then measures that call against a value-weighted range and can charge the exploit as a pot-odds mistake. The app contradicts itself in the exact spot it teaches. A strong player will read this as "the coach doesn't understand exploitative play".
   - Preflop, the big blind counts as an "aggressor". An unopened pot has `toCall = bb`, so open, fold and limp decisions are graded on pot odds against the betting range, not against the charts in `src/core/preflop.ts`. With a 75-chip pot and a 50-chip call (`SB = 25`, `BB = 50` in `table.ts`), the formula's ceiling is about 2.5bb, and realistic equity gaps stay under the 0.5bb silence line. So opening mistakes are mostly not graded at the table, even though the app has the correct chart for every seat. (This is from reading the code; I did not run it.)
2. **There is no action comparison.** `gradeDecision` scores the chosen action against a threshold. It does not compute the best alternative. A call that should have been a raise, or a check that should have been a bet on the flop, costs nothing. Unpriced bets use documented constants (`equity < 0.35`, late-street check `> 0.55`). The code comments are honest about this, but it is not "EV loss versus the best action", which is what a solver user assumes "−1.4bb" means.
3. **No realization, no implied odds, no SPR.** Equity is raw showdown share. The comment in `coach.ts` admits the grader "reads neither betSize nor stack". `research/RECOMMENDATIONS.md` items 1 to 3 still stand.
4. **Absolute bb thresholds with no noise band.** Severity is `<0.5` free, `<2.0` notable, else serious (`classifySeverity`). At `DISPLAY_ITERATIONS = 2000` the Monte Carlo standard error is about 1.1 points of equity, so a 95% band is about ±2.2 points. In a 100bb pot, a call that is 2 points below the price grades about 2bb "serious", which is inside the model's own noise and well inside the error of the range model. The loudest channel fires exactly where the app knows least.
5. **Heads-up equity in multiway pots.** `equityVsRange` is heads-up by construction. When two players have called, the grader still measures against one range.
6. **The opponents are simple.** `decideArchetypeAction` in `src/core/archetypes.ts` uses equity against one random hand with 300 iterations, compared with call/raise thresholds. It has one bet size per archetype (`betPotFraction`), no position awareness, no preflop ranges, no board-texture awareness, no check-raise logic, and a depth tax only in `ai.ts` (`commitTax`). Bots like this are fine for teaching exploits against caricatures. They are not a sparring partner for a regular, and they must not be marketed as "GTO bots" or used as evidence of a win rate.
7. **The table is 4-max.** `SEAT_NAMES` in `table.ts` has four seats. The charts are 6-max, and `contrast.ts` documents the mismatch. Imported 6-max and 9-max histories and MTT play would need the engine and the range model to handle more seats.
8. **Records are thin for analysis.** `HandRecord` in `src/core/session.ts` stores hero hole cards, board, net, vpip/pfr and per-decision pot/toCall/action/amount/verdict. It has no hero position, no villain actions and no stacks per seat. A leak finder needs a richer, format-neutral hand model.

None of this is hidden in the code. The comments are candid. But the UI typography ("costs ~2.0 bb", severity colours) presents these numbers with more confidence than the model has.

## 3. The collision with the existing spec

The owner should know that the proposed layer directly reverses written decisions:

- `PRODUCT-SPEC.md` "Out of scope" lists leaderboards, XP, streaks, cosmetics, a shop, tournaments and ICM, importing hand histories from real sites, and bankroll management.
- `BANNED_PHRASINGS` in `src/core/progress.ts` forbids "rank/percentile/level/streak/XP/leaderboard/badge/trophy" on progress and coach surfaces, and it is enforced by tests.
- `research/TEACHING-METHOD.md` (lines ~379, 455, 517, 790) removes every outcome signal from learning mode, `net` included.

There is a precedent for changing this cleanly: the v2.1 STANDING amendment narrowed the "no rank" ban instead of deleting it. Standing is computed only from decision quality, ratchets, reads thin samples pessimistically, and is named by table depth, never by a banned word. Any streak or XP work should follow the same pattern: an explicit, scoped amendment in `PRODUCT-SPEC.md` and `DECISIONS.md`, with the ban list kept on the teaching surfaces.

## 4. Feature list

Feasibility key: **S** = days on existing code, **M** = 1 to 3 weeks, **L** = a new subsystem. Every item runs locally with no network and no new dependencies (per `AGENTS.md`). Anything that needs a solve is computed offline by the developer with the in-repo engine and shipped as data with provenance in the `bank.ts` style.

### 4.0 Prerequisite: grader credibility (do before any gamification)

**G-a. "Close spot" band.** When |equity − required| is within the Monte Carlo band (about 2.5 points at 2,000 iterations, widened by a range-model margin) or the EV loss is below a pot-relative floor, return a distinct `close` verdict ("Close: both actions are reasonable against this range") with no bb figure and no severity colour.
- Builds on: `classifySeverity`, `Grade.price` (the meter can draw the band).
- Feasibility: S. Data: none.
- This is the single most important guardrail for any XP layer.

**G-b. Use the charts preflop.** In unopened and facing-open pots, grade with `isInRfiRange`, `defenseAction` and `threeBetResponseAction` (by seat, mapped onto 4-max as `contrast.ts` already does) instead of pot odds against the betting range. Grade chart boundary combos as close, since the published solves mix them and the purified chart rounds them.
- Builds on: `preflop.ts`, `chartBank.ts`, `spotType.ts` (which already detects rfi/defend/3bet-response/squeeze).
- Feasibility: S to M.

**G-c. Villain range by archetype and street.** Replace the single `VILLAIN_BETTING_RANGE` with a small authored family: tight/value, standard, wide/maniac, crossed with street (narrowing toward the river, and polarized on the river for aggressive archetypes). Select it from the seat's archetype. Mark it as an authored model in the verdict ("against a typical maniac's river range"). This resolves the contradiction between the exploit text and the grade.
- Builds on: `RfiSpec`/`inThresholds`, `ARCHETYPE_PROFILES`, `equityVsRange`.
- Feasibility: M. Data: authored ranges, with widths pinned by tests the way `villainBettingWidth` is.

**G-d. Best-alternative comparison where it is computable.** Facing a bet, compare call against fold (exact under the model) and add a one-street raise EV using the fold-equity reweighting in `robustness.ts`. Where no alternative can be computed, say "graded against folding only".
- Feasibility: M.

**G-e. SPR and realization.** These are `RECOMMENDATIONS.md` items 2 and 3. Use `spr()` from `arithmetic.ts`, plus a coarse realization factor keyed on position and suitedness. Label it as approximate.
- Feasibility: M.

**G-f. Multiway honesty.** With more than one opponent left, run equity against N ranges or state "multiway: heads-up estimate".
- Feasibility: S to M (the Monte Carlo loop generalises).

### 4.1 Solver-adjacent study (realistic without shipping a solver)

**Range vs range equity and equity distribution.** Two painted ranges plus an optional board give overall equity, an equity histogram (hand-by-hand equity buckets: nuts / strong / medium / air), and per-combo equity heat on the 13x13 grid.
- Rationale: this is the core of range-advantage and nut-advantage reasoning, the texture gap `GTO-THEORY.md` gap 4 names.
- Builds on: `equityVsRange` called per hero combo, `rangeEditor.ts` `SavedRange`, the `equityCalculator.ts` screen.
- Feasibility: M. It is CPU-bound: 169 combos × 2,000 iterations in a worker is acceptable, and exact enumeration on the river is cheap.

**Range-advantage / nut-advantage board module.** Classify flops (paired, monotone, connectedness, high card) and compute IP-vs-OOP range equity and nut share from the preflop ranges.
- Unlocks: the declared-unavailable `texture` axis in `contrast.ts`, the `TEXTURE` error tag in `reasonGrade.ts`, and postflop spot types in `spotType.ts`.
- Feasibility: M. Data: none beyond the existing ranges.

**Precomputed simplified solutions ("study packs").** A small library of the most frequent single-raised-pot nodes (BTN vs BB, CO vs BB, SB vs BB; around 20 flop textures; 2 to 3 bet sizes; 100bb), solved offline by the developer and shipped as served-set data with full `NodeProvenance`. This is exactly the design `bank.ts` already anticipates (B1c: a few MB).
- Feasibility: L. Writing a small river or flop-abstraction CFR inside the repo is plausible (a river-only CFR with bucketed hands is a modest program). A full flop solver with turn and river cards is not. Start with river spots (two ranges, one board, two sizes), which are exactly solvable with modest code and are where bluff-catching is most often misjudged.
- Data: the solver configuration, iteration count and exploitability for each node, per `bank.ts`.

**Node-locking-lite.** On a river study-pack node, let the learner shift the villain's bluff fraction or calling frequency and see the hero's best response move. This is computable exactly on the river from the indifference formulas in `GTO-THEORY.md` (MDF, α, bluff ratio `B/(P+2B)`).
- Builds on: `reads.ts` (connect a gated read to a lock: "this read, if real, moves the best response this way"), `robustness.ts`.
- Feasibility: M for the river with closed-form toy games, L for anything earlier.
- Guardrail: show "direction of deviation", not "max-EV exploit", per the node-locking limits in `GTO-THEORY.md`.

**EV tree for a single decision.** A visual of fold / call / raise with fold-equity, equity-when-called and pot-after, for one street.
- Builds on: `robustness.ts`, which already does the one-street EV under four continuations.
- Feasibility: S to M. Label it "one street; future streets not modelled".

**Mixed frequencies for advanced users.** Optionally show published-style frequencies on chart boundary cells, behind an "advanced" switch, to respect `preflop.ts`'s beginner-purification argument.
- Data: authored per-cell frequencies with a source note.
- Owner decision: this conflicts with B3 ("no frequencies") unless it is gated by Standing.

### 4.2 Tournaments (MTT, SNG, Spin formats)

**ICM calculator.** Malmuth-Harville over stacks and a payout structure. The math is exact and small (permutations up to about 10 players with memoisation).
- Feasibility: S. Data: payout presets (Spin 3-max winner-take-most, 9-max SNG 50/30/20, MTT final-table ladders) authored as examples, never as claims about a specific site.

**Bubble factor and risk premium.** Derived from ICM: the equity needed to call an all-in versus a chip-EV call. This gives the clearest teaching moment in tournament poker ("you need 58% here, not 50%").
- Builds on: the ICM module and `coach.ts`'s `Grade.price` meter, which would show the ICM-required equity line.
- Feasibility: S once ICM exists.

**Push/fold charts (Nash, short stacks).**
- Heads-up SB-push / BB-call Nash at 1 to 25bb is a well-defined two-player game over 169 classes. It can be solved offline by fictitious play using a 169×169 preflop all-in equity matrix computed with `exactEquityHeadsUp`-style enumeration or high-iteration Monte Carlo. That matrix is about 28k pairs, a one-time developer computation shipped as a few hundred KB of data.
- Multi-way chip-EV push charts (shove from BTN/SB at 10bb with antes) are feasible with the same approach and approximations; ICM-adjusted versions are harder.
- Feasibility: M for HU and 3-handed, L for full-ring ICM Nash.
- Data: the equity matrix plus solved charts, both with provenance (config, ante, iterations, convergence).
- This fits the existing chart drill machinery (`chartBank.ts` `ChartAction`, `CHART_BANK`) almost unchanged.

**Tournament play mode.** Rising blinds and antes on the existing engine.
- Feasibility: M. `table.ts` has no ante today, and adding one touches the file every test depends on.
- Credibility caveat: grading pushes against the push/fold charts is honest. Deep-stacked MTT postflop grading inherits every limit in section 2, plus ICM, so keep tournament grading to push/fold and call-off spots at first.

**Spins / hyper-turbo.** Mostly 3-handed push/fold and short-stack play, so it falls out of the above. Avoid any prize-multiplier or lottery theming. That is gambling aesthetics.

### 4.3 Hand-history import and leak finder

**Local parser for PokerStars, GGPoker and ACR (Winning Poker Network) text histories.** The user drags in a file or folder and parsing happens in the main process. Nothing is uploaded.
- Format notes:
  - PokerStars is the most regular format and the de facto standard.
  - GG hand histories hide opponents' hole cards that were not shown, and contain format-specific lines (rake, jackpot/"cash drop", rabbit hunting, all-in insurance and EV-cashout lines) that must be parsed or skipped rather than mis-attributed.
  - ACR differs in seat/button and currency notation.
  - All three differ for tournaments versus cash, and by language and locale (decimal separators).
  - The parser needs a golden-file test corpus, which must be synthetic or user-donated. Do not scrape real histories.
- Builds on: a new format-neutral `ImportedHand` model (seats, positions, stacks, every action, shown cards, rake, results). The current `HandRecord` cannot hold this. `evaluate.ts` scores showdowns, and `HandOutcome.evBb` (all-in-adjusted EV) can be computed for imported all-ins with `exactEquityHeadsUp`.
- Feasibility: L (parsers are tedious; plan on edge-case work every week for months). Data: none shipped.

**Leak finder over imported hands.**
- Tier 1, pure counting and fully credible: VPIP/PFR by position, 3-bet and fold-to-3-bet, c-bet and fold-to-c-bet by street, WTSD, W$SD, steal and fold-to-steal, limp frequency, and RFI compared against the app's own charts by position. Show sample sizes and binomial confidence intervals using the `reads.ts` gate philosophy: no stat is called a leak below `MIN_OBSERVATIONS`, and a 15-point deviation is required.
- Tier 2, model-graded: run the (repaired) grader over imported decisions and aggregate by the `rw.ts` street × action class. Label it "estimated by Offsuit's model, not a solver".
- Tier 3: all-in-adjusted results compared with actual results (a luck line).
- Builds on: `progress.ts` aggregation, `rw.ts`, `reads.ts`, and feeding the found leaks into `schedule.ts` and `sessionPlan.ts` drills. This is the strongest "complete product" loop: real hands, then the leak, then a drill, then a re-check.
- Owner and ethics points: see section 6. Importing histories means handling real-money records.

**Opponent notebook from imports.** Per-screen-name stats, gated by `reads.ts`.
- Strong caution: this is effectively a HUD database. Several sites restrict third-party tools and real-time assistance. Offsuit must be post-session only, must never read files while a client is running, and must never overlay. Default it off, or leave it out (see section 6).

### 4.4 Live-play tools

**Session logger.** Date, venue type, game and stakes as a label, hours, and optional notes. Store results in bb by default and real currency only if opted in (section 6).
- Builds on: `src/main/store.ts` atomic writes and `backup.ts`.
- Feasibility: S.

**Live reads notebook.** Structured observations ("raised 3x from UTG with 22, shown"), feeding a per-player `Read` in `reads.ts`, so the 20-observation gate and the false-read probability apply to live reads too. This is very credible: live players chronically over-read small samples, and Offsuit's gates are the antidote.
- Feasibility: S to M.

**Hourly and variance calculator.** Win-rate confidence intervals from logged hours. Live sigma per hour is much less established than online bb/100 sigma, so make sigma a user input with a stated default range.
- Builds on: `riskOfLosing`, `normalCdf` and `variance.ts`, generalised from hands to hours (hands per hour is an input, about 30 live).
- Feasibility: S.

**Live hand-entry for review.** Quick manual entry of a hand from memory into the same `ImportedHand` model, so a live hand gets the same review screen.
- Feasibility: M (the input UX is the hard part).

### 4.5 Bankroll and tilt tracking (sensitive)

**Bankroll.** The existing "bankroll" is play chips (`DEFAULT_BANKROLL = 10000`). Tracking real-money bankrolls moves Offsuit from "trainer" toward "gambling companion".

Safest framing if the owner wants it at all:
- Track a **study log in big blinds**, not money. Units are bb or buy-ins, with currency off by default.
- Never show cumulative real-money P&L on Home or next to the character.
- Show **risk-of-ruin and buy-in guidance** as education ("at your stated sigma, a 20-buy-in roll has about X% risk of ruin"), not as a target to climb.
- Never suggest moving up in stakes, never show a "next stake unlocked" style prompt, and never link a streak or XP to real results.
- Add a fixed, non-dismissable responsible-gambling notice where real results are entered, with a link to help resources displayed as text (no network fetch).

**Tilt tracking.** This can be done well using process data the app already has: decision quality after a big loss compared with baseline (graded EV loss in the N decisions after a large negative `netBb`), response-time drift (`anomaly.ts`/`confidence.ts` latency), and "stop-loss" reminders the user sets.
- `TEACHING-METHOD.md` already has the theorem that deviation exposure must not track realised losses. Surface it.
- Frame tilt as "your decisions got worse after X", never "you lost X". It must not become a nudge to keep playing ("win it back").
- Feasibility: M for play-money sessions. For real-money logs the same logic applies, but it is an owner decision.

### 4.6 Curricula and formats

**Position × stack-depth curriculum.** Explicit units for 20/40/75/100/200bb crossed with position.
- Builds on: `standing.ts` depths (`DEPTHS: 0, 40, 75, 125, 200`), `commitTax`, the `SPR` drills in `arithmetic.ts`, and `contrast.ts`'s stack-depth axis (needs G-e first).
- Feasibility: M.

**6-max engine option.** Raises fidelity of positions, the charts and the contrast axes. Large blast radius in `table.ts`; plan it with the test owners.

**PLO, later.** The evaluator and equity code are Hold'em-specific (2 hole cards; PLO needs exactly 2 of 4 hole cards plus 3 board cards). The 13×13 grid, combo model, `preflop.ts`, `rangeEditor.ts` and every chart are Hold'em-only. PLO is effectively a second product sharing the table UI. Recommend not before the Hold'em study stack is complete.

## 5. Credibility guardrails for the character, streak and cosmetics layer

Serious players leave trainers that feel like slot machines or that praise lucky results. Rules:

1. **Reward process, never outcome.** XP and streaks may come from completed study units, committed predictions, reviewed hands, spaced reviews done on time, and imported-hand reviews. Never from chips won, pots won, `netBb`, showdowns, or a hand "going right". This is consistent with `TEACHING-METHOD.md`'s removal of outcome signals and with the Standing amendment's "never from chips".
2. **Never reward correctness on a single close decision.** XP for "correct" teaches matching the modal answer on mixed spots, which the Three Laws in `GTO-THEORY.md` say is meaningless. Reward attempts plus calibration (Brier-style, from `confidence.ts` and the calibration in `predict.ts`) instead. A well-calibrated "I'm not sure" earns as much as a confident right answer.
3. **Close-spot language is mandatory.** For a G-a `close` verdict or a chart boundary combo, the character shows a neutral "close spot — both are defensible", never a fail animation and never a confetti burst. Do not use red/coral for close spots. The colour role map in `AGENTS.md` already reserves coral for serious mistakes.
4. **No celebration on a model-limited grade.** If the verdict came from an authored range or a heuristic constant (the unpriced-bet branches in `coach.ts`), the character's reaction is capped at "noted". Only exact-math spots (pot odds on the river, push/fold vs a solved chart, chart RFI) may produce strong positive or negative reactions.
5. **The character must not be a hype figure.** No gambling iconography: no chips raining, no slot sounds, no "jackpot", no loot boxes, no randomised rewards (variable-ratio rewards are the gambling mechanic; cosmetics are earned deterministically or not at all). No purchasable anything (no shop: real money stays out).
6. **Streak design.** A study-day streak with a freeze or rest-day allowance, and no streak-loss guilt copy. It must never be at risk because of a bad session. It sits on Play/Profile only. The ban on `streak` in `BANNED_PHRASINGS` stays for coach and progress surfaces, following the Standing scoping precedent.
7. **Cosmetics are paint only.** Card backs, felts and table themes fit `html[data-theme]` (paint-only per `theme.spec`). No cosmetic may change information density (e.g. a "pro HUD skin" that shows equity pre-commit would break T8).
8. **Do not gamify imported real-money hands.** No XP for importing hands or for real-money results, and no character reaction to them. Otherwise the app rewards playing real money.
9. **Keep the voice adult.** The character's lines must pass the existing `BANNED_PHRASINGS` lint (no trait attribution such as "you're a nit"). Write one short line per event type, reviewed like coach copy, with a mute switch that defaults on for players at Standing 125bb and above.
10. **Label provenance everywhere.** Any number with a solver feel carries a small source tag: "exact", "model", "authored chart", or "solved: config X". This one habit keeps serious players.

## 6. Decisions for the owner

1. **Amend the spec or not.** XP, streaks, cosmetics, tournaments/ICM, hand-history import and bankroll management are each listed out of scope in `PRODUCT-SPEC.md`. Do you want a v2.2 amendment in the style of the Standing amendment, scoped item by item?
2. **Grader first?** I recommend G-a (close band) and G-b (charts preflop) ship before any gamification, and G-c (archetype-aware ranges) before any XP touches table play. Accept?
3. **Real-money data at all.** Hand-history import and a live session log mean Offsuit processes records of real gambling. Options, safest first:
   - (a) no import;
   - (b) import for review and counting stats only, bb units, no currency, no P&L graph, no gamification;
   - (c) full results tracking.
   I recommend (b).
4. **Opponent database / HUD-like features.** Recommend not building per-opponent stats from imports at all (site terms and RTA concerns, and it shifts the product toward a real-money edge tool). If built: post-session only, never while a client runs, off by default.
5. **Bankroll framing.** If anything ships: bb/buy-in units, risk-of-ruin as education, a responsible-gambling notice, no stake-up prompts, no money on Home. Confirm, or keep it out entirely (the current spec).
6. **Solver data.** Will you accept developer-computed, offline-solved study packs (river first, then push/fold) shipped as versioned data with provenance? This is the only honest route to "solver-adjacent" without a runtime solver.
7. **Mixed frequencies.** Keep the B3 "no frequencies" rule for everyone, or reveal frequencies on boundary cells behind Standing 125bb+?
8. **Table size.** Stay 4-max, or invest in 6-max (needed for credible position work and for imported 6-max hands)?
9. **Formats roadmap.** Suggested order: cash study stack, then SNG/Spin push/fold plus ICM, then MTT, with PLO deferred. Confirm.
10. **Bot positioning.** Commit in copy that the bots are archetype caricatures for exploit practice, not strong opponents, and never quote a win rate against them as evidence of skill.
