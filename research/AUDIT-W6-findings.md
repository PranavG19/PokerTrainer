# W6 invariant audit — findings, fixes, and what is deliberately left open

The probes live in `scripts/audit-w6/`. Each is a standalone script, runnable with
`npx tsx scripts/audit-w6/<name>.ts`, and each prints its own reproduction rather than asserting —
they are instruments, not tests. Every defect that survived became a unit test with a mutation proof;
the probe is kept so the measurement can be re-run after a change.

## The headline result about method

**Chip conservation — `sum(stacks) + pot === constant` — held through EVERY defect below.** It was the
strongest invariant in the codebase and it caught none of these. Nine of ten defects were misrouted
money or corrupt state with correct totals; the tenth destroyed chips and was still missed, because it
only appears with fewer than two funded seats, a configuration the fuzzer never built.

The oracles that actually found things were:

| oracle | what it catches | found |
|---|---|---|
| **stake cap** — no seat collects more than rivals matched | misrouted pots | a5, a7, a12 |
| **ledger identity** — `stack + committed` equals the start stack | destroyed chips | a20 |
| **rule reachability** — is a legal action ever refused? | over-restriction | a3, a4, a14 |
| **state legality** — does an illegal input get applied? | absent validation | a2 |
| **message-vs-number agreement** — does the prose match the figure? | false teaching | a10, a11, a17 |

## Fixed, with a regression test and mutation proof

1. **Fold-out overpay** (`a7`, `a5`). `settle()` paid the last standing seat the whole pot with no
   stake cap. A seat all-in for a 25-chip small blind collected 3025 — a 121x return. 511 occurrences
   in a 4000-seed fuzz. → `tests/unit/uncalled.test.ts`
2. **Showdown overpay, same root** (`a5` seed 1007). This corrected an earlier diagnosis of mine: I
   had recorded the showdown path as capping correctly because `a7`'s control had no folds in it and
   so never exercised the dead-money rule. `buildSidePots` poured any slice with no live claimant
   into the *previous* pot, whose sole claimant was the short all-in. Uncontested chips now return to
   each contributor individually, since contributors sit at different totals. 30 occurrences, worst
   478.
3. **Chip destruction on a one-funded-seat table** (`a20`, `a19`). `startHand` assigned
   `seat.committed` twice instead of accumulating; when one seat posts both blinds the small blind
   vanished from the ledger while its chips had left the stack. 25 destroyed per hand, compounding.
   → `tests/unit/lone-funded-seat.test.ts`
4. **The swept-table dead end** (`a19`). The escape hatch tested the *hero's* stack, so a hero holding
   every chip got "Next hand" forever with no decision in it. Reachable in 59 of 60 seeds.
   → `tests/e2e/swept-table.spec.ts`
5. **Stale raise cap after a full raise** (`a15`, `a14`). `_raiseCapped` was cleared only in
   `advanceStreet`, so a cap outlived the all-in that justified it. A seat facing a legitimate full
   raise was offered `[fold, call]` with 4890 behind while an uncapped seat at the same table was
   offered a raise. → `tests/unit/raisecap-reopen.test.ts`
6. **Capping a seat that never matched the bet** (`a4` H2). The condition was "has acted this street",
   which also catches a seat that acted earlier and was then raised over — that seat still owes a
   live full raise. Now "has matched the current bet", which is what the comment always claimed.
7. **No input validation at all** (`a2`). `raise` to -500 *credited* the seat 500 chips; `raise` to
   999999 drove a stack to -994999 with `allIn` still false; a folded seat could bet. 20+ illegal
   actions accepted, now 0. → `tests/unit/action-validation.test.ts`
8. **Free-fold verdict contradicted its own number** (`a10`, `a17`). Folding at `toCall` 0 reused the
   priced-fold sentence, printing "when only 0% was needed" beside a 7.3 bb charge. 254 of 2234
   generated messages. → `tests/unit/coach-message.test.ts`
9. **NaN graded `serious`** (`a10`). Every `<` against NaN is false, so a non-finite ΔEV fell past both
   bands into the harshest tier — the loudest channel in the product, fired by a division the grader
   could not carry out.
10. **The bet verdict said "risks" about a cost** (`a11`). An all-in of a 5000 stack printed
    "risks ~1.0 bb" while the seat risked 100 bb. The figure was the EV loss all along; the noun was
    wrong. The grader reads neither `betSize` nor `stack`, so it cannot report exposure at all.
11. **Free folds filed as an arithmetic leak** (`a17`). The principle was tagged `pot odds`, but
    nothing was owed, so no price was misjudged. Every free fold landed under pot odds in the leak
    list, so a learner whose real weakness is surrendering free cards would be shown pot-odds drills.
    Now `value or bluff`. G7 aggregates by error tag, which makes the tag load-bearing.

## Investigated and NOT a defect

- **`a14`'s 15 remaining hits after fix 5.** Its heuristic asks "is `lastAggressor` a live seat other
  than me?", which also matches a raise made *before* the cap and already answered.
  `a23-cap-precise.ts` settles it: 0 truly stale caps across 190 capped states in 3000 seeds. Two
  criteria were tried and discarded first, both recorded in that probe — "currentBet rose since the
  cap" flags all 190 correct caps, because a short all-in always lifts currentBet, that being what
  makes it short; "a live seat owns the bet" flags 4 more where that seat had merely *called*.
- **`a6`'s partial-blind `currentBet`.** Demanding the full big blind from other players when the BB
  is short is correct poker, and the showdown path side-pots the excess. Not a bug.
- **`a9` section C, zero funded seats.** Degenerates safely: pot 0, no winner, no crash. Unreachable
  in-app, since the hero always has chips or is offered rebuy / new session.
- **`a8` shuffle-key collisions.** The key is `seed + handNumber`, so every `(seed, hand)` pair on the
  same diagonal deals identically — seed 43 hand 5 equals seed 47 hand 1. Cosmetic for a single-seed
  app; it means a "new seed" can replay a hand the learner has seen. Left alone: fixing it changes
  every pinned seed in the e2e suite, and 500 seeds still gave 500 distinct first deals.
- **`a13` negative stacks from out-of-range amounts.** Closed by fix 7 rather than by clamping.

## Known-open, stated rather than fixed

- ~~**`currentBet` outlives its commitments at showdown**~~ — **CLOSED** (`8306bda`, `437bc95`).
  Fixed rather than left open, because "inert" was a property of which callers existed and new surfaces
  reading table state at handover were being added. `clearBettingState` now runs at both `settle` exits,
  after `payRefunds` (both it and `buildSidePots` read `committed`, so clearing earlier would zero every
  side pot and refund). Test oracle is agreement — no bet may exceed the highest commitment — over 300
  seeds, with a control proving the sweep reaches both exits.

  Two findings came out of mutation-testing the fix, and both changed what the code says:
  - **Equal stacks never leave anything to clear.** A hand only reaches the river once a betting round
    has closed, and `advanceStreet` zeroes `committed` on the way in. It takes UNEVEN stacks — a short
    all-in ends the round with the deep seat's commitment still recorded (5 of 400 hands, `a29`).
  - **`street === 'showdown'` does not mean `settle` takes the showdown path.** The fold-out branch runs
    first whenever one seat is unfolded, which is *every* dirty hand: 0 of 600 dirty hands reached the
    showdown exit (`a30`), and 0 of 5810 multiway hands across 8 stack shapes arrived dirty at all
    (`a31`). The clear on that exit is therefore **unreachable defence-in-depth**, and is commented as
    such in `core/table.ts` with the measurement instead of being given a test that cannot fail.
- **The grader cannot anchor a curriculum.** 47.7% of spots grade indifferent, it is blind to bet size
  and stack depth, and it can never say "bet this". Fixes 8-11 make it stop *lying*; they do not make
  it a teacher. This is the largest open item and it is a design question, not a bug.
