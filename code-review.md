# Review: grader-close-band (close band, charts preflop, villain ranges)
Verdict: FAIL at the first pass (4 act-on items) → FAIL at 876a79a (2 new) → FAIL at 09cbaec (shove pricing) → PASS WITH NOTES at the jam fix (the tip's grader)
Base: 2b28855e047746a941fdc9f759c0bfd2d12bd67d  Head: 2e1433df0fe108ca55e872fb69021ad531318890

The postflop maths is right. The pot share, required price, EV-loss formula, band width and weighted-range
equity all match an independent exact oracle (table at the end). The defects are in the adapter
(`gradeSpot.ts`): it decides which model applies, and it does not read bet size or stack depth preflop, or
the shape of a multiway raise postflop. There is also one copy defect. All four are reproduced with real
`TableState`s built through `createTable`/`startHand`/`applyAction`.

## Act on

- **src/core/gradeSpot.ts:108-121 (chartSpotFor), with src/core/chartGrade.ts:220-258. Chart spots ignore raise size, all-ins and stack depth.**
  Any single raise counts as a standard open, any second raise counts as a standard 3-bet, and the
  100bb charts are applied at any stack. The cost then scales with `pot`, which includes the oversized
  raise. Reproduced on a 6-max table: UTG and HJ fold, CO goes all-in for 100bb, BTN and SB fold, BB to act.
  `chartSpotFor` returns `{kind:'defend', spot:'bb-vs-co'}`, and the grades are:
  - BB **calls AA** vs the shove: `serious`, 18.7bb, "Against a CO open, the BB chart raises AA; calling it costs ~18.7 bb." This is the best legal action; a raise is not possible.
  - BB **calls QQ**: `serious`, 12.9bb.
  - BB **folds 98s** / **T9s**: `serious`, 8.7bb / 9.4bb. Folding is correct against a 100bb shove.
  - BB **calls KJo**: `free`, 0bb. Calling off 100bb with KJo is waved through.
  - BB **calls 72o**: 49.5bb, quoted as a chart loss.

  A 30x open (raise to 1500) gives the same bad grades: fold 98s is `serious` 2.7bb, call 76s is `free`.
  Hero at 8bb in the CO is graded on the 100bb CO chart. In the live app this happens whenever a stack runs
  short: a bot's raise clamps to all chips, or hero shoves. The `allin` → `raise` mapping (chartMove) also
  grades a 100bb first-in shove the same as a 2.5x open.
  Fix: in `chartSpotFor`, return null (the pot-odds model) when any of these hold:
  - a preflop raise is an all-in;
  - the open is above a standard size (for example > 4bb, plus 1bb per limper);
  - the 3-bet is above a standard multiple of the open;
  - effective stack < about 40bb;
  - hero's chosen action is `allin`.

  Add unit cases for the shove, the oversize open and the short stack.

- **src/core/gradeSpot.ts:152. `facing` is inferred from hero's own commitment, which is wrong multiway.**
  Reproduced on a 4-handed limped flop: P1 checks, P2 bets 100, P3 raises to 300, hero (BTN) has committed 0.
  `lastAggressor` is P3, a raiser, but the code passes `facing: 'bet'`. The bots pick bluffRaiseFreq
  versus bluffBetFreq from their own `toCall > 0` (ai.ts:128, archetypes.ts:174), so P3 used the raise
  frequency. For a LAG on that board the modelled range share is 0.561 as 'bet' against 0.461 as 'raise'.
  Hero's equity is therefore measured against a range about 22% too wide, and hero is graded too leniently
  on exactly the large-pot multiway spots.
  Fix: take `facing` from the aggressor's own action this street. It is a raise when someone else had
  already bet before the aggressor acted, which can be read from the log since the last street change, or
  from a per-street bet count recorded on the state. Add a test.

- **src/core/gradeSpot.ts:153-161 with villainRanges.ts:221-229. A raise's size is measured differently from how the bots size it, so a bot's standard raise moves the value line.**
  The bots raise to `currentBet + pot × betPotFraction`, where `pot` is the pot when they act
  (ai.ts:156, archetypes.ts:203). The grader measures `toCall / (state.pot − toCall)`. That equals the
  bot's fraction for a bet into hero, but not for a raise over hero's bet. Measured with hero betting half
  pot (300) and the bot raising at its own size:

  | Archetype | Graded fraction | Own size | Value-line shift |
  |---|---|---|---|
  | tag-reg | 0.495 | 0.66 | −0.042 |
  | lag | 0.563 | 0.75 | −0.041 |
  | maniac | 0.750 | 1.0 | −0.042 |

  So a bot raising at its own size is modelled with a value line about 4 points low, which widens the
  range. This contradicts DECISIONS.md ("zero at the archetype's size, so the bots are modelled exactly")
  and the module header. The unit test only pins the 'bet' case.
  Fix: for `facing: 'raise'`, compute the fraction as (raise-to − bet faced by the aggressor) / (pot when
  the aggressor acted). Pin it with a test: a bot-sized raise gives shift 0.

- **src/core/coach.ts closeChartMessage. The close copy for defence and 3-bet spots is garbled, with position names lowercased.**
  The function rewrites `spotPhrase` with `.toLowerCase()` inside parentheses. Actual output:
  - "Close spot: Q4s sits on the edge of the chart (against a co open, the bb chart), where both choices are played. Either choice holds up."
  - "Close spot: JJ sits on the edge of the chart (facing a 3-bet after a co open, the chart), …"

  Only the RFI form reads correctly. No test asserts this copy.
  Fix: build the phrase per kind, for example "the BB chart against a CO open" or "the chart facing a
  3-bet after a CO open". Add a copy test for each kind that also runs `bannedPhrasingIn`.

## Consider

- **src/core/chartGrade.ts:240-245. Preflop cost magnitudes (my solver recall; confidence low to moderate).**
  - Facing a 3-bet, the loose cap is reached for almost every hand outside the chart: K·pot = 283 at
    potBb 10.5, so any d > 0.1 hits the cap. Calling a UTG 3-bet with 77, KJo or 65s comes out at a flat
    2.44–2.50bb, which is `serious` and opens the gate. From my memory of 100bb 6-max solver EVs, these
    flats lose roughly 0.3–1bb.
  - Folding AA in the BB to an open is graded 3.8bb. Solver EV relative to the fold is about 9–11bb, so
    this understates it by about 3x (it still lands in `serious`).
  - RFI fold AA ≈ 3.8bb and open 72o = 1bb are the right order. AKo UTG fold 1.94bb looks about 1.5x high
    (published ~1.0–1.3bb).

  Tradeoff: recalibrating changes the Experiment 1 numbers, and the model is declared "not a solve".
- **src/core/villainRanges.ts:202-207 (preflopContinue).** "Raise or call" is applied to every villain:
  - A BB who checked a limped pot continued with all 1326 hands, but is modelled as filtered by callStrength.
  - An open-raiser's range should be the raise branch only.

  Both make postflop ranges wrong in the common limped-pot and raised-pot cases.
  Tradeoff: needs the preflop action per seat, which `preflopActions` already parses.
- **src/core/closeSpot.ts / coach.ts.** The band is in pot-share units, so a close spot forgives up to band × (pot + toCall) / bb.
  - In my fuzz (300 spots, pots up to 60bb) the largest estimate silenced as close was 3.57bb.
  - In a 300bb pot it could be about 14bb, shown as "Either choice holds up".

  Tradeoff: this is the band applied literally, but a bb cap on what counts as close would keep big-pot
  errors visible.
- **villainRanges.ts:140-141.** The river table is called "exact" but ignores card removal between the two hands.
  - Measured against exact enumeration with removal: QsJs on Ah Kd 7s 2c 9h is 0.4069 vs 0.3924, which is
    1.45 points, half of STEP_WIDTH and not "well under" it.
  - AcKc on the same board is off by 0.45 points.

  Tradeoff: an exact pairwise version on the river is about 1M evaluations per board, then cached.
- **gradeSpot.ts:71.** `line.includes(' posts ')` also drops every action of a seat whose name contains " posts ".
  - Reproduced with a seat named "Ann posts": the log reads 'Ann posts posts SB 25'.
  - Anchoring the match (`/^(.*) posts (SB|BB) \d+$/`) removes the edge.
- **Tests.** No tests cover:
  - `chartSpotFor` facing an all-in, an oversize open or a short stack;
  - multiway `facing`;
  - the raise-size shift;
  - the close copy for defend and 3-bet spots.

## Noted

- Postflop equity is heads-up against the last aggressor only, even when other players are live. This was already the case before the branch.
- `depthTax` (ai.ts, deep stacks over 100bb) is not in the range model. It does not apply at the app's 100bb.
- Earlier postflop streets are not replayed. This one-street memory is stated in DECISIONS.
- With bb = 0, a chart grade returns `evLossBb: NaN` (silent, `free`). This matches the existing classifySeverity guard, but NaN is then persisted in the verdict.
- Doc drift: DECISIONS says "a hand 10% outside the CO chart ≈ 0.3bb". The formula gives 27 × 1.5 × 0.01 = 0.405, and chartGrade.ts's header says ~0.4.
- A short all-in that lifts the bet is counted as a raise in `preflopActions`, while `lastAggressor` stays on the earlier full raiser. This is an edge case.

## Dismissed

- **Wrong seat graded.** Proof: every call site grades `state.toAct` while hero is to act:
  - table.ts:796 runs in the hero action handler before `applyAction`;
  - assessmentBlock `commit` runs only when `toAct === HERO` (line 230);
  - the harness `gradeHero` reads `state.seats[state.toAct]`.
- **4-max seat mapping.** Proof: from the real engine, `chartSeats` gives `["BTN","SB","BB","CO"]` for 4 seats, `[…,"HJ","CO"]` for 5 and `[…,"UTG","HJ","CO"]` for 6. The first seat to act on 4-max opens the CO chart, matching contrast.ts:136.
- **All-in parsing.** Proof: the log prints `all-in <allInTotal>` (table.ts:485), a street total, and the parser compares it with the street total `toMatch`, so a call for less is classified correctly.
- **Silence rule / close shape.** Proof: fuzz of 300 random postflop spots with all six archetypes:
  - 0 cases of `message === null` with an estimate ≥ 0.5, and 0 the other way round;
  - every close grade is `free`, 0bb, with no price and no principle (28 close, 9 with a message);
  - two runs of the same input give identical results (0 differences);
  - 0 banned phrasings.

  Separately, the chart messages for AA in defend, 3-bet and RFI spots also contain no banned phrasings.
- **Card removal in `equityVsWeightedRange`.** Proof: matches exact enumeration within MC error on 7 spots (table).
- **Chart direction.** Proof: `chartAction` agrees with `isInRfiRange`, `defenseAction` and `threeBetResponseAction` on 45 RFI, 44 defend and 24 3-bet samples (0 mismatches).

## Verification

- I could not run `npx tsc --noEmit` or `npx vitest run`. The worktree's `node_modules` is a symlink into
  `/Users/pranavgk/Documents/scratch/temp/Poker/`, and partway through the review that directory became
  unreadable ("Operation not permitted", even outside the sandbox). `git diff origin/main...HEAD` also
  failed after the first calls, because it reads that repo's packed-refs. The diff was read before that.
  CI status on the branch is therefore unverified by me.
- I ran the repo modules directly with Node 26 type stripping, using a resolve/load hook in
  `tests/tmp/rev/` that maps `.js` imports to `.ts` and rewrites evaluate.ts's enum.
- I wrote my own 7-card evaluator. Over 30,000 random showdowns it agreed with `evaluate.ts` on every
  comparison (0 mismatches). Exact enumeration over villain hands and runouts is in
  `tests/tmp/rev/oracle.ts`, `close.ts`, `chart.ts`, `shove.ts` and `fuzz.ts`.
- Not tested by me: the renderer (coachPanel close paint, styles) and Electron; e2e was not run, by
  instruction.

## Independent maths checks

Spots R1–R5 and T1–T2 use the villain's range from the repo (`villainRange`), pot = pot including the bet,
bb = 50, 2000 iterations, seed 7. "Exact" means enumerating every villain hand and every runout with my own
evaluator.

| Check | Repo | Independent | Delta | OK? |
|---|---|---|---|---|
| R1 river KcQc vs tag-reg, call 400 into 1000: required price | 0.2857 | 0.2857 | 0 | OK |
| R1 pot share (MC vs exact) | 0.527 | 0.542 | −1.5pt (half-width 2.2) | OK |
| R2 river 99 vs maniac, call 800/1600: pot share | 0.6705 | 0.6626 | +0.8pt | OK |
| R3 river 88 vs nit, fold 300/800: pot share | 0.0493 | 0.0498 | −0.05pt | OK |
| T1 turn AsJc vs station, call 200/600: pot share | 0.7950 | 0.8035 | −0.85pt | OK |
| T2 turn QhJh flush draw vs lag, call 225/525: pot share | 0.5232 | 0.5062 | +1.7pt (half-width 2.2) | OK |
| R4 river Ad5d vs over-folder, call 220/620: EV loss (req − eq)(pot + call)/bb | 4.379bb | 4.366bb | 0.013 | OK |
| R5 river Td9d vs lag, fold 300/700: EV loss (eq − req)(pot + call)/bb | 7.495bb | 7.532bb | 0.037 (MC) | OK |
| 95% half-width at 2000 iterations (R1/R2/T2), exact var = win + tie/4 − p² | 0.0217/0.0206/0.0218 | 0.0216/0.0207/0.0218 | ≤0.0001 | OK |
| Close classification, 7 spots above + 8 near-line (A2 vs lag, river, req 0.2368) | 15/15 | 15/15 agree | 0 | OK |
| Near-line A2: estimate 0.28bb (MC) vs exact 0.48bb, both < 0.5 so no message | silent | silent | — | OK |
| River strength 9c9d (Ah Kd 7s 2c 9h) | 0.9935 | 0.9939 (exact with removal) | −0.04pt | OK |
| River strength AcKc | 0.9824 | 0.9869 | −0.45pt | OK |
| River strength QsJs | 0.4069 | 0.3924 | +1.45pt | Marginal (removal ignored) |
| River strength 3c4d | 0.0069 | 0.0045 | +0.24pt | OK |
| Preflop strength AA | 0.8511 | 0.8526 own MC 60k (published 85.2) | −0.09pt vs published | OK |
| Preflop strength 72o | 0.3459 | 0.3428 own MC (published 34.6) | 0.0pt vs published | OK |
| Preflop strength KK | 0.8225 | 0.8258 own MC (published ~82.4) | −0.15pt | OK |
| Preflop strength AKs | 0.6730 | 0.6688 own MC (published ~67.0) | +0.3pt | OK (≈2 SE) |
| Chart direction, RFI / defend / 3-bet samples | 45 / 44 / 24 | same via preflop.ts | 0 mismatches | OK |
| RFI fold AA cost (any seat) | 3.82–3.83bb | ~2.5–3.5bb solver RFI EV (low confidence) | ~+0.5 | Plausible |
| RFI open 72o | 1.00bb (cap) | ~0.6–0.9bb | ~+0.2 | Plausible |
| BB fold AA vs CO open | 3.78bb | ~9–11bb solver (moderate confidence) | −6 | Understated (still serious) |
| UTG call 3-bet with 77 / KJo | 2.44 / 2.50bb (cap) | ~0.3–1bb (low confidence) | +1.5–2 | Overstated (serious) |
| BB vs CO 100bb shove: call AA | serious 18.7bb | 0 (best action) | — | **WRONG** |
| BB vs CO 100bb shove: fold 98s | serious 8.7bb | ~0 (correct fold) | — | **WRONG** |
| Bot-sized raise value-line shift (tag-reg/lag/maniac) | −0.042/−0.041/−0.042 | 0 (DECISIONS claim) | ~−4pt | **WRONG** |
| Multiway raise faced as 'bet' (lag range share) | 0.561 | 0.461 | +0.10 | **WRONG** |

## Resolution (author, at the fix commit)

| Finding | Bucket | Disposition |
|---|---|---|
| Chart spots ignore shoves, raise size, stack depth | Act on | **Fixed.** `chartSpotFor` returns null on any all-in, an open over 5bb, a 3-bet over 15bb, or hero/raiser under 40bb; those spots go to the pot-odds model. Tests: `chartGrade.test.ts` "chart spots only where the charts apply" (red on the reviewed head). |
| Multiway raise graded as a bet | Act on | **Fixed.** `facing` is read from the aggressor's own last log line ("raises to", or an all-in with others already in). Test: `villainRanges.test.ts` "bet or raise, and the size read" (red on the reviewed head). |
| A bot's normal raise lowers the value line | Act on | **Fixed.** Size is read only for a postflop bet into no bet, as the aggressor's chips over the pot without this street's chips; a raise is modelled at the archetype's own size. Same test. |
| Garbled close chart copy | Act on | **Fixed.** `chartName()` builds the phrase; test pins the 3-bet-response sentence. |
| Loose cap facing a 3-bet too high | Consider | **Taken.** `CAP_LOOSE_CALL` 0.5 → 0.25 of the price: calling a CO 3-bet with 77 ≈ 1.4bb (notable). |
| Mixed cell across two regions (found while fixing) | — | **Fixed.** Row adjacency counts only one region over (3-bet/call, call/fold): folding AKo to a CO 3-bet is a mistake, not close. Test added. |
| `' posts '` name parse | Consider | **Taken.** Anchored to `/ posts (SB|BB) \d+$/`. |
| Folding AA in the BB understated (3.8 vs ~10bb) | Consider | Not changed: still `serious`; recorded as an open question in DECISIONS/FINDINGS. |
| preflopContinue ignores the villain's actual preflop action | Consider | Not changed: the log has no street markers, so the preflop action cannot be read postflop without an engine change. Follow-up. |
| Big-pot close spots can hide a large estimate | Consider | Not changed: the band is the honest uncertainty; `estimateLossBb` keeps the figure. Open question. |
| River strength ignores card removal (≤1.45 pts) | Consider | Not changed: under the 3-point step width the range uses. Comment softened to "well under the step width" → stated as measured. |
| Doc drift 0.3 → 0.4bb | Noted | Fixed in DECISIONS. |

## Re-verification (at 876a79a)

Independent re-check of the four act-on items and every Fixed/Taken row. I did not edit any source file.
Every check below runs real `TableState`s (`createTable`/`startHand`/`applyAction`) through `chartSpotFor` and
`gradeSpot`. The scratch scripts are in `tests/tmp/rv/` (`charts.ts`, `facing.ts`, `shovemodel.ts`, `copy.ts`, `sb.ts`; gitignored).

### Per item

| Item | Status | Evidence |
|---|---|---|
| Act-on 1: chart ignores shoves, size, depth | **Partly fixed** | Spots now go to the pot-odds model: CO shove, then BB to act (`null`); the 30x open (`null`); hero at 8bb or 39.98bb (`null`, while 40bb still charts); a 30bb raiser (`null`); an open of 251 (`null`, while 250 = 5bb charts); a 3-bet to 751 (`null`, while 750 charts). Facing the shove: call AA `free 0`, fold 98s `free 0`, call 72o `serious 42.2bb` priced from pot odds. With archetype models the shove grades sensibly (lag: fold KJo `serious 15.9`, call `free`). The standard bot sizes (open ≤ 2.5bb, 3-bet 6.5bb, or 11.5bb over a 5bb open) still chart, so normal spots are not lost. **Not fixed:** hero's own `allin`. The review's fix list named it, but the resolution does not mention it (see the new Act on below). |
| Act-on 2: multiway `facing` | **Verified fixed** (with a latent edge) | Limped 4-way flop, S bets 100, B raises to 300, U folds: `gradeSpot` matches only `facing:'raise'`. Hero bets and villain raises: `raise`. A bet with a caller before hero: `bet`. A bet followed by a third player's short all-in for less: `bet` (correct). Edge: names that are prefixes of each other (see Consider). |
| Act-on 3: raise size mis-measured | **Verified fixed** | A raise now carries no `potFraction`, so the archetype's own size is used and the shift is 0. For a bet with callers before hero, `potFraction = villain.committed / (pot − street chips)`: S bets 150 into 200 with B calling reads 0.750. A 400 overbet with a caller reads 2.000, as the only matching candidate. A real `decideArchetypeAction` lag bet (150 into 200) reads 0.750 = `betPotFraction`, and `valueLine` gives 0.53 both with and without the size, so the shift is 0. |
| Act-on 4: garbled close copy | **Verified fixed** | Actual output: "…edge of the BB chart against a CO open…", "…the SB chart against a BTN open…", "…the chart facing a 3-bet after a CO open…". `bannedPhrasingIn` returns null on all three. Only the 3-bet form is pinned by a test. |
| CAP_LOOSE_CALL 0.5 → 0.25 (Taken) | Verified | Unit test 72o call is 0.35. UTG 3-bet response: 72o call is >1. |
| Mixed cell one region over (Fixed) | **Regression in sb-vs-btn** | See the new Act on below. In BB defence the cell counts are unchanged (26/32/38/40/36). For BTN facing a 3-bet the count is unchanged (20). For UTG/HJ/CO facing a 3-bet, only AKo-fold and AQo-4-bet lose close, which is the intended change: folding AKo to a UTG 3-bet is `serious` 3.9bb. RFI is untouched (the guard sits after the RFI branch; CO still has 12 boundary cells). |
| `' posts '` anchored (Taken) | Verified | Regex `/ posts (SB|BB) \d+$/`. Every existing chart test passes. |
| Doc drift 0.3 → 0.4 | Verified | DECISIONS.md line updated. |
| Tests "red on the reviewed head" | Not checked | I did not run the new tests against 2e1433d. |

### New Act on

- **src/core/gradeSpot.ts:125 / src/core/coach.ts:239 (`chartMove('allin')` → `'raise'`). Hero's own 100bb shove is still graded as a standard open.**
  This was in the original act-on 1 fix list ("hero's chosen action is `allin`") and is not addressed.
  Reproduced at 100bb, 6-max, with UTG first in:
  - `allin` with 72o: `notable` 1.00bb, "The UTG opening chart folds 72o; raising it costs ~1.0 bb." This is the same as a min-open. A 100bb shove of 72o loses roughly 3bb or more: it is called by about 12% of hands at about 30% equity.
  - `allin` with AA: `free` 0. Shoving aces 100bb deep forfeits most of the open's value.
  - The BB shoving QJo over a CO open grades the same as a 3-bet (0.38bb, free).

  Fix: in `gradeSpot`, skip the chart when `chosen === 'allin'` and the hero's stack is at least `MIN_CHART_DEPTH_BB`. Grade it through the pot-odds model, or grade it as a separate push mistake. Add a test that a 100bb UTG shove of 72o is not the 1bb open cost.
- **src/core/chartGrade.ts:209. The new "one region over" rule removes the mixed cells of the 3-bet-or-fold SB vs BTN chart.**
  sb-vs-btn is authored as mostly 3-bet-or-fold (preflop.ts:345, "a separate 3-bet-or-fold spot"). Its edge therefore runs straight from raise to fold. |raise − fold| = 2, so that edge can no longer be close: the mixed-cell count falls from 22 to 18.
  At SB-vs-2.5x pricing (pot 200, to call 100), these were silent before the fix and now get a coach message:
  - SB 3-betting **ATo**: `notable` 0.50bb, "the SB chart folds ATo; raising it costs ~0.5 bb";
  - SB 3-betting **KJo**: `notable` 0.50bb;
  - SB folding **AJo**: `notable` 0.52bb.

  In a 3-bet-or-fold strategy these are the mixed cells, and the fix's own rationale ("a solve mixes 3-bet with call, or call with fold") does not hold for this spot.
  Fix: allow raise/fold adjacency in sb-vs-btn. More generally, allow it wherever the row has no call cell between the two neighbours. Keep the AKo/AQo-facing-3-bet case non-close. Add a test for sb-vs-btn ATo raise being close.

### Consider

- **gradeSpot.ts:174. The aggressor's last line is found with `startsWith(name + ' ')`, which mis-attributes when one seat name is a prefix of another.**
  Reproduced with seats `Al`, `Bo`, `Bo B`: Al bets 100, Bo raises to 300, Bo B calls 300. `last` becomes "Bo B calls 300", so the raise is read as `facing:'bet'` with `potFraction` 1.5.
  This is latent today: `SEAT_NAMES` is You/Ada/Bo/Cy, and the LAN table passes no model. Matching the action regex and comparing the name capture exactly (as `preflopActions` does) removes it.
  Postflop also does not refuse duplicate names the way `preflopActions` does.
- **gradeSpot.ts:177. `last.includes(' all-in ') && othersIn` reads a first-in full all-in bet as a raise once anyone has called it.**
  Unreachable for bots: they use `allin` first in only with ≤ 1bb behind, which is never a full bet, so `lastAggressor` stays null (D in `facing.ts`). It is reachable only for a human villain, who has no model. Reading the street's betting order would be exact.
- **Tests.** Missing cases:
  - the defend close copy (only the 3-bet sentence is pinned);
  - the `potFraction` read for a bet with callers;
  - the boundary values of the guards (5bb, 15bb, 40bb).
- **Depth guard is hero and raisers only.** A 100bb CO is still graded on the RFI chart when the BB behind has 8bb. Effective stack is arguably the right measure, but this is minor and a judgment call.

### Verification

- `npx tsc --noEmit -p tsconfig.json`: exit 0.
- `npx vitest run tests/unit/chartGrade.test.ts tests/unit/villainRanges.test.ts tests/unit/closeSpot.test.ts tests/unit/coach.test.ts tests/unit/coach-message.test.ts`: 5 files, 86 tests passed, exit 0.
- Not run, by instruction: Electron, e2e, the full unit suite.

Verdict after fixes: FAIL

## Resolution of the re-verification (author)

| Finding | Disposition |
|---|---|
| Hero all-in graded as a min-open | **Fixed.** In a chart spot a shove the chart does not make costs 3x the wrong-raise loss (100bb 72o from CO = 3bb, serious) and is never a close mixed cell; a shove the chart plays is graded as its raise. Test: "hero shoves and the 3-bet-or-fold chart" (red before). |
| One-region rule regressed SB vs BTN | **Fixed.** That chart is 3-bet-or-fold by design, so 3-bet beside fold counts as one step there. Test: ATo 3-bet and AJo fold are close again (red before). |
| Aggressor's line matched by name prefix | **Fixed.** Exact-line regex; `aggressorRead` exported and tested directly (red with the prefix match). |
| Missing tests: bet size with callers, limits | Bet-size-with-callers test added (0.75). Limits are covered by the shove / 30x / 8bb tests; exact-boundary values not pinned. |
| A called first-in all-in read as a raise (humans only) | Noted: no model exists for a human seat, so it never reaches the range. |
| Effective stack ignored (100bb hero vs 8bb BB) | Noted: follow-up; at the app's 100bb tables only a busted-down bot can trigger it. |

## Re-verification (at 09cbaec)

Independent re-check of the "Resolution of the re-verification" table. I did not edit any source file. Every
grade below comes from real `TableState`s (`createTable`/`startHand`/`applyAction`, 6-max 100bb, bb 50) run
through `chartSpotFor`/`gradeSpot` (`modelFor: () => null` preflop, `ARCHETYPE_PROFILES.lag` postflop). The
scratch scripts are in `tests/tmp/rv2/` (gitignored): `shove.ts`, `shoveev.ts` (shove EV against a QQ+/AK
caller, `equityVsRange`), and `names.ts`.

### Per item

| Item | Status | Evidence |
|---|---|---|
| Hero all-in graded as a min-open | **Partly fixed** | The headline case is fixed. A 100bb UTG shove of 72o grades `serious` 3.00 (it was `notable` 1.00), and CO 72o also grades 3.00. A shove of a boundary cell is never close. A shove the chart plays (AA) is `free`, as DECISIONS documents. **Not fixed:** the shove cost is the chart's distance cost × 3, so it keeps the open's shape and not the shove's. Hands near the chart edge are still silent or under-graded (see the new Act on). |
| SB vs BTN 3-bet-or-fold edges | **Verified fixed** | sb-vs-btn has 22 mixed cells again (18 at 876a79a), for example `AJo:raise->fold`, `ATo:fold->raise`, `KJo:fold->raise`, `KQo:raise->fold`. In the live spot (BTN opens 125, SB to act): 3-bet ATo is close (est 0.50), 3-bet KJo is close (0.50), fold AJo is close (0.52). Fold AA is still `serious` 3.76. Calling ATo is still `notable` 0.50: the step-2 rule does not leak into the call side. The exception is keyed to `sb-vs-btn` only, so the BB and 3-bet-response counts are unchanged. A shove of ATo there is `notable` 1.50 and not close, because the shove return sits before `isMixedCell`. |
| Aggressor line matched by prefix | **Verified fixed** | Line: limp 4-way, Y bets 100, Z folds, hero calls, X check-raises to 400, Y calls. The read is `facing:'raise'` for every name pair tried: `Bo`/`Bo B`, `A.B`/`AxB`, `Bo (2)`/`Bo (2) x`, `x+y`/`xxy`, `$1`/`$1$`, `a\b`/`a\b c`, `[Bo]`/`B`, `.*`/`Bo`, `Bo|Cy`/`Bo`, `^Bo$`/`Bo`. A bet with a prefix-named caller reads `bet` at 0.75 (`Bo B`/`Bo`, `A.B`/`A`, `.*`/`Bo`). A short postflop all-in over a bet ("Bo all-in 550") reads `raise`. The escape covers every metacharacter that `RegExp` treats specially. **Latent, unchanged:** two seats with the same name still mis-read. `Bo`/`Bo` reads `bet` with potFraction 2, because the postflop path does not refuse duplicates the way `preflopActions` does. Unreachable today: the bot names are unique, and LAN seats carry no model. |
| Tests: bet size with callers; limits | Verified as stated | The "bet with a caller" test pins 0.75. The guard boundaries are not pinned. By hand: 40bb charts and 39.98bb does not. |
| Called first-in all-in (humans only); effective stack | Noted (agree) | Both are unchanged and unreachable by the bots. |
| Tests "red before" | Checked by reading the diff, not run | Each new assertion depends on the changed line: the old `steps !== 1` rule, the old `startsWith(name + ' ')` match, and the old 1.0bb shove cost. |

Regression hunt (all clean apart from the Act on below):
- **Limp special case.** The `rfi`/`call` branch returns before the shove line, and its recursive call passes no `shove`. UTG limp 72o = 0.50 and limp AA = 1.91 (half the nearer mistake), unchanged.
- **Defence spot where the chart calls.** BB vs CO: a shove of any call-region hand is capped at 0.25 × toCall × 3 = 1.13bb (`notable`). 64 of 73 hands land there; the 9 at the 3-bet edge are `free` (AJs 0.00, TT 0.01, KJs 0.03, KQo 0.46). A shove of a fold-region hand is also 1.13 (72o, K5o).
- **Shove where the chart 3-bets** (QQ, AKo, AA in BB vs CO): 0, `free`, as documented.

### New Act on

- **src/core/chartGrade.ts:276 (`lossBb * SHOVE_MULTIPLIER`). A 100bb shove is still graded by how far the hand sits from the chart edge, not by what a shove costs. A shove of a hand near the edge stays silent.**
  The 3x factor is applied to `CHART_K * pot * d²` (the open's distance cost). So it is right only where that cost hits its cap: 72o, K9o and 106 of the 130 UTG off-chart hands.

  Grades at 100bb, UTG first in, with the shove EV against five players who call only with QQ+/AK (`shoveev.ts`):

  | Shove | Grade | EV vs fold |
  |---|---|---|
  | KJo | `free` 0.01 | −5.8bb |
  | QJo | `free` 0.03 | −4.7bb |
  | ATo | `free` 0.15 | −4.7bb |
  | KTo | `free` 0.42 | — |
  | A9o | `notable` 0.96 | — |
  | 72o | `serious` 3.00 | −5.7bb |

  KJo and 72o lose about the same and are graded 300x apart.
  - **CO:** shoves of A8o down to A2o are all `free` (0.00 to 0.42).
  - **BTN:** T8o 0.00, 97o 0.02, 76o 0.12.
  - **Facing a 3-bet** (CO opens 125, BTN 3-bets 375), the cap again sets the figure. A jam of AQo is `notable` 1.03 and a jam of AJo is `notable` 1.91. Their EV against a QQ+/AK caller is −5.6bb to −14bb, depending on whether the 3-bet range is 120 or 80 combos.
  - **On-chart hands** (UTG KQo −6.1bb, 22 −2.7bb, AJo −4.9bb) are `free` 0 by the documented "graded as the chart's raise" rule. That rule rests on the same assumption, that shove EV tracks open EV, and these numbers disprove it.

  Before the fix, all of these were also silent, so this is the original act-on item left half done, not a regression.
  Fix: grade a hero shove at or above `MIN_CHART_DEPTH_BB` by its own cost, independent of `chartDistance`. Either:
  - estimate the push EV from the hand's equity against a fixed calling range, the call probability from the players behind, and the depth (every input is in `gradeSpot`); or
  - at minimum, floor the loss of any shove outside a small jam set (QQ+/AK, or the chart's raise region facing a 3-bet) at the 72o figure.

  Pin it with a test that a UTG 100bb shove of KJo (and of 22) is not `free`.

### Consider

- **The depth edge is discontinuous** (`chartGrade.ts:276` with `gradeSpot.ts` `MIN_CHART_DEPTH_BB`). A UTG 72o shove is graded as follows:
  - at 40bb, 50bb and 100bb alike: `serious` 3.00;
  - at 39.98bb: `free` 0.29, because the pot-odds model takes over.

  The modelled EV against a QQ+/AK caller is −1.5bb at 40bb, −2.2bb at 50bb and −5.7bb at 100bb. The fixed multiplier therefore overstates the cost at 40bb about 2x and understates it at 100bb. This is the same root as the Act on: a depth-aware shove cost removes both. Tradeoff: more model surface in a grader that otherwise reads no sizes.
- **coach.ts:283 copy.** A shove reads "…raising it costs ~3.0 bb". "Shoving" would name the mistake the learner made. Tradeoff: one more verb branch in `chartMessage`.

### Verification

- `npx tsc --noEmit -p tsconfig.json`: exit 0.
- `npx vitest run tests/unit/chartGrade.test.ts tests/unit/villainRanges.test.ts tests/unit/closeSpot.test.ts`: 3 files, 58 tests passed, exit 0.
- Scratch reproductions: `tests/tmp/rv2/shove.ts`, `shoveev.ts` and `names.ts` (vite-node, exit 0).
- Not run, by instruction: Electron, e2e, `test:full`, and the full unit suite.
- Untested by any committed test:
  - the shove cost of near-edge and on-chart hands;
  - the depth boundaries of the guards;
  - the duplicate-name postflop read.

Verdict after fixes: FAIL

## Resolution of the re-verification at 09cbaec (author)

| Finding | Disposition |
|---|---|
| A shove's cost is 3x the edge cost, so near-edge shoves are silent | **Fixed.** A chart-spot shove is priced by its own EV against a QQ+/AK calling range (`shoveLossBb`); the multiplier is gone. Test: 72o, KJo, 22 and A8o shoves first in from the CO are not free; AA and KK are (red on 09cbaec for KJo/22/A8o). |
| The coach message for a shove says "raising" | **Fixed.** The shove verdict has its own sentence naming the calling range and the pot share. |
| The 40bb edge jumps | Noted: below 40bb the pot-odds model grades the shove; push/fold charts are a follow-up. |
| Duplicate seat names mis-read postflop | Noted: bot names are unique and LAN seats carry no model. |

## Re-verification (at 6b1d0e1)

Independent re-check of the shove fix (6b1d0e1: `shoveLossBb` and `SHOVE_CALL_RANGE` in `chartGrade.ts`,
`gradeShove` in `coach.ts`) and of the e2e re-pin (ac7fb05). I did not edit any source file. Grades come from
real `TableState`s (`createTable`/`startHand`/`applyAction`, 100bb, bb 50) run through `gradeSpot` with
`modelFor: () => null`. The pot shares come from my own oracle: a separate 7-card evaluator and Monte Carlo
(`tests/tmp/rv3/oracle.ts`, 30k to 40k trials, villain combos dealt with card removal). It does not import
`src/core/equity`. Spot checks: AA v KK 0.827, AKo v QQ 0.431, A8o v KK 0.290. Scripts are in
`tests/tmp/rv3/`: `ev.ts`, `spots.ts`, `edges.ts` and `sanity.ts`.

### Per item

| Item | Status | Evidence |
|---|---|---|
| A shove's cost was 3x the edge cost, so near-edge shoves were silent | **Fixed for first-in (RFI) spots. Regressed in defence and 3-bet spots** (new Act on) | See the 4-max CO table below. The formula matches my own calculation to within the app's Monte Carlo noise. |
| Shove copy said "raising" | Fixed | Example: "A shove this deep is called only by QQ+ and AK, where you have 22% pot share; it costs ~2.7 bb." `bannedPhrasingIn` returns null, and no `BANNED_PHRASINGS` entry matches. The calling-range claim is false outside RFI spots (see the Act on). |
| 40bb edge; duplicate seat names | Noted (unchanged, agree) | No change. |
| e2e re-pin, seed 8 → 10 (ac7fb05) | **Verified: no assertion weakened** | I compared all 227 changed lines one by one. The changes are `seed: 8`→`10` (plus `?? 8`→`?? 10` defaults), the renamed `reachSeed8Gate`→`reachPinnedGate`, comments, and one message string (`'seed 10 must give…'`). No `expect` line was removed or relaxed. Two `expect(await waitForIdle(page)).toBe('handover')` lines were added in `gate.spec`, so those tests got stricter. The predict test 21 move from seed 43 to 10 keeps all three of its expects (`awaiting` is `ai`, `withheld` is `true`, no win%). No spec still mentions QsQh, 3.9bb or 348 as a pin. I did not run e2e (by instruction), so whether the new seed holds in the app is left to the running suite. |

**Formula check: 4-max, CO first in, 3 behind, pot 1.5bb, 100bb.** My EV uses the commit's formula with my own
share and the naive per-player q = 34/1326.

| Hand | My share | App share (seed 1) | My EV vs fold | App grade |
|---|---|---|---|---|
| 72o | 0.217 | 0.224 | −2.83 | `serious` 2.72 |
| KJo | 0.200 | 0.215 | −3.08 | `serious` 2.87 |
| 22 | 0.343 | 0.354 | −0.93 | `notable` 0.76 |
| A8o | 0.250 | 0.245 | −2.33 | `serious` 2.41 |
| AA | 0.832 | 0.838 | +6.45 | `free` 0 |
| KK | 0.570 | 0.578 | +2.51 | `free` 0 |

- Each gap is explained by the app's 2000-trial share. For KJo, 1.5pp of share is worth about 0.2bb at these stakes.
- Card removal is ignored in q. Its effect is ±0.5bb: KJo −2.45, A8o −1.80, 22 −1.12. It does not change any severity here.
- When the caller is a blind, `pot + 2·stack` overcounts the final pot by that blind (≤1bb·share, ≤0.3bb). This is negligible.
- BTN first in (2 behind): 72o 1.35, KJo 1.45, A8o 1.14 `notable`; 22 `free` 0.02. My numbers are 1.42, 1.59, 1.10 and 0.14. They agree.

**Determinism and edge cases.**
- Determinism: same seed gives the same loss and the same message.
- Seed spread over 40 seeds: CO 22 runs 0.58 to 1.33 and is always `notable`. CO A8o runs 2.07 to 2.68 and is always `serious`. The noise is real, but no severity flips at these hands.
- Non-finite inputs give `free` with a null message, never a "~NaN bb" verdict: bb=0, bb=NaN, pot NaN, and a missing `stack` (`evLossBb` NaN). Stack 0 gives 0.
- `seed` undefined falls back to 1. `shoveLossBb` with NaN inputs gives NaN, and with negative `behind` it gives 0.
- Unit file `chartGrade.test.ts`: 30 passed.

### New Act on

- **coach.ts:87 → chartGrade.ts `shoveLossBb` (`behind` = `opponents` from `gradeSpot.ts:148`). In defence and 3-bet spots every opponent is priced as a random hand. The raiser is not random, so every non-premium shove there is now `free`. This is a regression from 09cbaec, which graded these spots `notable`.**
  - `opponents` counts the live seats. First in, that equals the players behind, which is correct.
  - In a defence or 3-bet spot it also counts the raiser, who has already acted. The raiser gets q = 34/1326 = 2.6%, the chance that a random hand holds QQ+/AK.
  - The raiser's real chance of holding QQ+/AK is much higher: 9.6% of the CO open range, 15.9% of the UTG range, and 57% of the 60-combo BB 3-bet range (`bb-vs-co` threebet, used as a proxy for a 3-bettor's range).
  - Meanwhile the dead money is 4 to 11.5bb, so fold equity dominates the result.

  App grade against my EV, with the raiser's range conditioned on its action (QQ+/AK share of that range, other players random):

  | Spot | App, every hand tested (72o KJo 22 A8o AQo) | My EV |
  |---|---|---|
  | 6-max BB vs UTG open | `free` 0.00 | 72o −5.4, KJo −6.0, A8o −4.4, AQo −4.6, 22 −1.4 |
  | 4-max BB vs CO open | `free` 0.00 | 72o −1.7, KJo −2.0, A8o −1.1, AQo −1.2 |
  | 4-max SB vs BTN open | `free` 0.00 | 72o −0.9, KJo −1.2 |
  | 4-max CO open, BTN 3-bets 7.5bb, CO jams | `free` 0.00 | 72o −25, KJo −27, A8o −22, AQo −22, 22 −11 |

  - At 09cbaec these were all graded: BB-vs-CO shoves 1.13 `notable`, and a 3-bet jam of AQo 1.03 `notable` (see the re-verification above).
  - The 3-bet-spot gap is large. Even with a wide 120-combo 3-bet range (q ≈ 0.28), a 72o jam loses more than 10bb, and the grade is silent.
  - The message also states "called only by QQ+ and AK" as a fact, in a spot where that is the one claim the model gets wrong.

  Fix (all the inputs are in `chartSpotFor`/`gradeSpot`): pass `shoveLossBb` a per-opponent call probability instead of a count.
  - The raiser gets the QQ+/AK share of its own range: `rfiCombos(opener)` in defence spots, and a 3-bet range in 3-bet spots.
  - Only players still to act get the random-hand q.
  - Or, at minimum, route shoves in `defend`/`3bet` spots back to the previous cost until this is done.

  Pin it with a test that a 100bb BB-vs-UTG shove of 72o, and a CO jam of KJo over a BTN 3-bet, are not `free`.

### Consider

- **The All-in preset + Raise button bypasses the shove grade** (`table.ts:1143` and `:1175`; `coach.ts:86` checks only `chosen === 'allin'`).
  - The dock's "All-in" preset sets the slider to `maxRaiseTo` (committed + stack), and the Raise button sends `{kind: 'raise', amount}`.
  - CO 72o raised to 5000 grades as the chart's raise, `notable` 1.00 ("raising it costs ~1.0 bb"). KJo raised to 5000 grades `free` 0. The same chips sent through the A key grade 2.72 and 2.87.
  - This predates the fix (09cbaec keyed on `allin` too), but it is now the main way past the fix.
  - Fix: treat `betSize >= committed + stack` as `allin` in `gradeSpot`. Tradeoff: one more input the grader reads.
- **Card removal in q** (`SHOVE_CALL_RANGE` against 1326). This is ±0.5bb at 100bb, and it biases blocker hands (AK, KJ, A8) toward overstated losses. It can wait; the Monte Carlo noise is the same size.
- **Test comment** `chartGrade.test.ts` ("loses (1 - 3*share/...) of the stack") is garbled. The assertion itself is right.

### Verification

- `npx vitest run tests/unit/chartGrade.test.ts`: 30 passed, exit 0.
- Scratch scripts `tests/tmp/rv3/{oracle,sanity,ev,spots,edges}.ts` (vite-node): exit 0.
- Not run, by instruction: typecheck, e2e, `test:full`, Electron, and the full unit suite.

Verdict after fixes: FAIL


## Resolution of the re-verification at 6b1d0e1 (author)

| Finding | Disposition |
|---|---|
| Shoves over a raise priced the raiser as a random hand | **Fixed.** `shoveLossBb` takes one call chance per live opponent: random if it has not acted, its RFI chart's QQ+/AK share if it opened, the BB 3-bet region's share against hero's seat if it 3-bet. Tests: BB jamming 72o over a CO open is not free; the CO jamming KJo over a BTN 3-bet is serious (red before). |
| A raise to the whole stack skipped the shove grade | **Fixed.** `gradeSpot` grades a chart-spot raise whose size is the whole stack as `allin`. Test: the raise and the all-in grade identically. |
| "called only by QQ+ and AK" false outside first-in | **Fixed.** The copy reads "called by QQ+ and AK". |
| Card removal in the call chance (±0.5bb) | Noted. |

## Re-verification (at a3a55f6)

Independent re-check of a3a55f6 (`shoveCallChance`, `openerCallChance`, `threeBettorCallChance` and
`shoveLossBb` in `chartGrade.ts`; `shoveCallers` and the whole-stack-raise rule in `gradeSpot.ts`). I did not
edit any source file. Grades come from real `TableState`s (`createTable`/`startHand`/`applyAction`, 100bb,
bb 50, seed 11) run through `gradeSpot` with `modelFor: () => null`. My EV uses my own call chances and the
exact final pot when the raiser calls. For pot share it uses `equityVsRange` at 20k trials, so the share is
not independent here (the rv3 oracle agreed with it). Scripts are in `tests/tmp/rv4/`: `check.ts`,
`edges.ts`, `fourbet.ts` and `defend.ts`.

### Call chances (my own count: pair 6, suited 4, offsuit 12; calling set AA KK QQ AKs AKo = 34)

| Range | Mine | App |
|---|---|---|
| Random hand | 34/1326 = 0.0256 | 0.0256 |
| RFI UTG / HJ / CO / BTN / SB | 34/214, 34/274, 34/354, 34/582, 34/498 = 0.159, 0.124, 0.096, 0.058, 0.068 | identical |
| 3-bettor proxy vs UTG / HJ / CO / BTN (BB 3-bet region) | 34/34, 34/44, 34/60, 34/74 = **1.000**, 0.773, 0.567, 0.459 | identical |

### Per item

| Item | Status | Evidence |
|---|---|---|
| Shoves over a raise priced the raiser as a random hand | **Fixed** (see the new Act on for what it causes in 3-bet spots) | Every spot that was `free` at 6b1d0e1 is now graded, and matches my EV. 6-max BB vs UTG: 72o 5.17 `serious` (mine −5.62), KJo 5.47 (−5.56), A8o 4.51 (−4.46), AQo 4.85 (−4.59), 22 1.00 `notable` (−1.57). 4-max BB vs CO: 72o 1.54, KJo 1.73, A8o 1.14, AQo 1.35, all `notable` (mine −1.81, −1.78, −1.11, −1.19). 4-max SB vs BTN, where BB behind is random: 72o 0.79, KJo 0.95 `notable` (mine −1.03, −1.00). CO jam over a BTN 7.5bb 3-bet: 72o 24.0, KJo 25.1, A8o 21.6, AQo 22.9, 22 8.8 `serious` (mine −26.1, −25.9, −21.9, −22.4, −11.6). AA and KK are `free` everywhere. In `shoveCallers`, folded seats are excluded and hero is excluded from the raisers. The opener gets its RFI chart's chance, the 3-bettor gets the proxy, and anyone yet to act gets the random chance. |
| A raise to the whole stack skipped the shove grade | **Fixed** | In all 42 spot × hand cases above, `raise` with `betSize = stack + committed` gives a `Grade` deep-equal to `allin`. A raise to more than the stack also counts as a shove. Stack−1, 125 and an undefined `betSize` each stay the chart's raise (KJo CO `free`; 72o CO raise to 125 `notable` 1.00, the chart message). |
| "called only by QQ+ and AK" copy | **Fixed** | Example: "A shove this deep is called by QQ+ and AK, where you have 21% pot share; it costs ~1.7 bb." |
| Card removal | Noted (agree) | No change. |

**Regression checks (all pass).**
- BB facing a limp and a raise (4-max: CO limps, BTN raises to 4bb, SB folds): `chartSpotFor` gives null. Both `allin` and a raise to the whole stack go to the pot-odds model, and neither is converted.
- 30bb hero: no chart spot, and `allin` takes the pot-odds path.
- RFI first in: the players behind get the random chance. CO KJo is 2.87 through `gradeSpot`, and the same 2.87 through `gradeDecision` with no `shoveCallers`, which fills the default. 4-max CO and 6-max UTG RFI numbers are unchanged from 6b1d0e1 (CO 72o 2.72, KJo 2.87, 22 0.76, A8o 2.41).
- Determinism: the same seed gives the same grade.
- `npx vitest run tests/unit/chartGrade.test.ts`: 33 passed, exit 0.

### New Act on

- **In 3-bet spots, jamming the chart's own 4-bet hands is graded `serious`** (`threeBettorCallChance` → `shoveLossBb`). The 3-bettor's proxy is the BB's 3-bet region. That region is almost all value, so it calls far more often than the ranges `threeBetResponseAction` was built to 4-bet against.
  - Against a UTG open, the proxy is exactly QQ+/AK, so q = 1: the 3-bettor never folds, and every non-AA/KK jam is priced against the top of its range.
  - These grades were `free` at 6b1d0e1. Now they are loud false positives on the hands the chart says to raise.

  Opener jams over a 7.5bb 3-bet, 6-max (`fourbet.ts`); the chart's action is `threebet` (4-bet) unless noted:

  | Opener | QQ | JJ | AKs | AKo |
  |---|---|---|---|---|
  | UTG | `serious` 11.75 | `serious` 22.33 (chart: call) | `serious` 13.30 | `serious` 19.39 |
  | HJ | `serious` 6.47 | `serious` 14.64 (chart: call) | `serious` 7.66 | `serious` 12.37 |
  | CO (also the 4-max table's open) | `notable` 1.68 | `serious` 7.67 | `serious` 2.55 | `serious` 6.01 |
  | BTN | `free` 0 | `serious` 4.40 | `free` 0.26 | `serious` 3.05 |

  - On the 4-max table, CO open → BTN 3-bet → CO jam is the commonest 3-bet response. There, AQs (chart: 4-bet) is `serious` 18.1, and TT (chart: call) is `serious` 6.5.
  - The arithmetic is right for the input. The input contradicts the chart: if the 3-bettor really held 57% QQ+/AK, the chart's AKo 4-bet would itself be a mistake.
  - The message then tells the learner that a standard AK jam over a 3-bet costs ~6 to 19bb.
  - Fix, either of:
    - (a) In `defend`/`3bet` spots, when `chartAction(spot, hand)` is `raise`, grade the jam as the chart's raise. This mirrors "a raise to the whole stack is a shove" in the other direction: a shove of a chart-raise hand is that raise.
    - (b) Give the 3-bettor a range that includes the bluffs the response chart assumes, for example the widest region (`bb-vs-btn`, q 0.46) for every opener, with q < 1 always.
  - Pin it with a test: CO AKo, and UTG QQ, jamming over a 3-bet are not `serious`.

### Consider

- **Pot overcount when the raiser calls.** `pot + 2·stack` counts the raiser's chips already in twice: (villain committed − hero committed)·share. That is about 0.5bb in defence (1.5bb·share) and about 1.7bb in 3-bet spots (5bb·share). It understates the loss: for example, 22 vs a UTG open is 1.00 (mine 1.57), and 22 jamming over a 3-bet is 8.8 (mine 11.6). No severity flips in the spots tested. Pass `committed` per caller if this is touched.
- **RFI jams of QQ/JJ/TT/AK are graded `notable`** (6-max UTG: QQ 0.67, AKs 0.86, AKo 1.58, JJ 1.93), and AQs is `serious` 4.12. This predates a3a55f6 (RFI is unchanged), and it follows from "one caller, always QQ+/AK" with no worse-hand calls. It is worth a line in `DECISIONS.md` if it is intended.

### Verification

- `npx vitest run tests/unit/chartGrade.test.ts`: 33 passed, exit 0.
- Scratch scripts `tests/tmp/rv4/{check,edges,fourbet,defend}.ts` (vite-node): exit 0.
- Not run, by instruction: typecheck, e2e, `test:full`, Electron, and the full unit suite.

Verdict after fixes: FAIL


## Resolution of the re-verification at a3a55f6 (author)

| Finding | Disposition |
|---|---|
| Jamming a 4-bet hand over a 3-bet graded serious | **Fixed** (fix a). In defence and 3-bet spots a jam of a hand the chart re-raises is graded as the chart's raise. Test: CO AKo and UTG QQ jamming over a 3-bet are free (red before). |
| The raiser's chips counted twice in the called pot (≈0.5–1.7bb understatement) | Noted: no severity flip in the reviewer's spots; follow-up. |
| UTG open-jams of QQ/AK/JJ graded notable | Noted: a real (small) chip loss against QQ+/AK; predates a3a55f6. |

## Re-verification (at the jam fix)

Independent re-check of 35eb799 (`jamOfChartRaise` in `gradeDecision`, `src/core/coach.ts`). I did not edit
any source file. Grades come from real `TableState`s (`createTable`/`startHand`/`applyAction`, 100bb, bb 50,
seed 11) run through `gradeSpot` with `modelFor: () => null`, for `allin` and for a raise to the whole stack.
The only grader source change since a3a55f6 is the 10 lines in `coach.ts`. Scratch scripts were in
`tests/tmp/rv5/` (`jam.ts`, `regions.ts`, `sb.ts`) and have been deleted.

### Per item

| Item | Status | Evidence |
|---|---|---|
| Jamming a 4-bet hand over a 3-bet graded serious | **Fixed** | Opener jams over a BB/BTN 3-bet, chart `raise`, all `free` 0.00: 4-max CO AA KK QQ JJ AKs AKo AQs; 6-max UTG AA KK QQ AKs AKo; 6-max HJ QQ AKs AKo. At a3a55f6 these were CO AKo `serious` 6.01, UTG QQ `serious` 11.75, CO JJ `serious` 7.67, and so on. In all 139 cases, a raise to the whole stack is deep-equal to `allin`. |
| Non-chart jams over a 3-bet still charged | **Holds** | Through shove pricing, unchanged from rv4: 4-max CO KJo `serious` 24.86, 72o 23.75, A8o 21.34, AQo 22.60, 22 8.50; 6-max UTG KJo 53.37, 72o 51.42; HJ KJo 38.85, 72o 37.34. Hands the chart calls are still charged as shoves: 4-max CO TT 6.15; UTG JJ 22.70, AQs 41.04. |
| BB jams over an open | **Holds** (one note below) | Chart-raise hands are `free`: vs UTG AA KK QQ AKs AKo; vs CO also JJ AQs AQo KQs; vs BTN also TT AJs. Non-raise hands keep the rv4 numbers: 6-max vs UTG 72o `serious` 5.17, KJo 5.47, A8o 4.51, 22 `notable` 1.00; 4-max vs CO 72o `notable` 1.54, KJo 1.73, A8o 1.14. |
| RFI jams unchanged | **Holds** | `chart.kind !== 'rfi'` keeps RFI on shove pricing. 4-max CO: 72o 2.72, KJo 2.87, 22 0.76, A8o 2.41, AKo 0.40. 6-max UTG: QQ 0.67, AKs 0.86, AKo 1.58, JJ 1.93, AQs 4.12. All are identical to rv4. |
| Raise regions the fix makes free | **Checked** | Every defend and 3-bet chart's `raise` region is value only: UTG is QQ+/AK; the widest is `bb-vs-sb` (22 hands, down to 77, KQo, JTs). There are no bluff hands, so the fix cannot clear a 100bb jam of a weak hand. A `3bet`/opener SB spot would throw in `chartAction` (SB has no `fourBet` row), but `chartSpotFor` returns null there, so it is unreachable. |
| Pot overcount; UTG open-jams `notable` | Noted (agree) | No change. |

**Regression checks (all pass).**
- `npx vitest run` on the coach, chart and grade tests (`chartGrade`, `chartBank`, `chartBank-ui`, `charts`, `coach`, `coach-message`, `reasonGrade`): 7 files, 140 tests passed.
- `npm run typecheck`: exit 0.

### Notes (not regressions)

- **6-max BB vs a BTN open: jamming 72o (chart `fold`) is graded `free` 0.00, and so are KJo, A8o, A5s and 76s.** 72o is not a chart raise, so this goes through the same shove path as at a3a55f6, and the fix does not cause it. The cause is the model: the BTN's RFI range calls only with QQ+/AK (q 0.058), so 94% fold equity on a 4bb pot outweighs the called loss. In practice the BTN calls a 100bb jam wider than that. So "BB jamming 72o over an open is charged" holds against UTG and CO opens, but not against BTN opens. Worth a line in `DECISIONS.md`, or a wider caller range for late-position openers.
- **Jams of hands the chart calls still use the value-only 3-bettor stand-in.** UTG JJ costs 22.7bb, AQs 41.0bb, and 4-max CO TT 6.15bb. The direction is right (looser than the chart), but the size inherits q = 1 against UTG. Fix (b) from rv4 would temper it. This is not a blocker.

### Verification

- Scratch scripts `tests/tmp/rv5/{jam,regions,sb}.ts` (vite-node): exit 0. They have been deleted.
- Not run, by instruction: e2e, Electron and `test:full`.

Verdict after fixes: PASS WITH NOTES
