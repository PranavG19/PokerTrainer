# SCORECARD-TABLE — table surfaces

## Rating 3: refined `glass`, `glass-r4` and `sports`, at 4, 6 and 9 seats
A fresh blind rater (a subagent that built none of this) scored five randomly labelled variants
(`tests/tmp/vblind5-key.json`, scores in `tests/tmp/scores-r5.json`). The rubric is the round-3 one plus **fit** and a new
**scales** category, judged only from the 6- and 9-seat renders. The rater also judged the faint green glow under the board as an A/B on
both `glass` and `sports` (4 seats only, so no scales score). Motion was scored n/a (stills).

| Variant | Label | Overall (1–10) | Element mean | Fit mean | Scales mean |
|---|---|---|---|---|---|
| `sports` | V3 | 8 | 7.76 | 8.17 | 7.83 |
| `glass` | V2 | 7 | 7.64 | 7.17 | 7.33 |
| `sports+glow` | V5 | 7 | 7.68 | 8.00 | — |
| `glass+glow` | V1 | 6 | 7.58 | 7.17 | — |
| `glass-r4` | V4 | 5 | 7.31 | 7.33 | 6.33 |

**Ship pick: `sports`.** "The only variant that both keeps the target hierarchy (big pot, board, plated hero, raised active villain
at 6/9) and looks like the same product as home/charts/drill … It also scales cleanly to 9 seats at 900x640 with no collisions."

**Glow:** rejected on both. The rater found the two pairs unprompted and preferred the version without the glow each time: "decoration with
no state meaning [that] dilutes 'Your turn' green" and tints the empty turn/river wells.

**What the rater said about each one**
- **`sports` (8):** the best fit, since the seats are glass on the shared coat with no oval. At 9 seats it switches to a perimeter
  (four seats across the top, two per side) that never collides. Faults:
  - The condensed numerals appear on no other screen.
  - A dead band about 170pt tall sits between the price line and the hero at 1100x760.
  - The hero's green is doubled (the wash plus the "Your turn" text).
  - The dealer button sits on the hero's card.
  - Seat order around the table reads less clearly than on an ellipse.
- **`glass` (7):** clear pot → board → hero hierarchy and tidy glass plates, and "better for" not having the glow. Faults:
  - The oval is still a game skin no other screen uses.
  - The same orphan condensed numerals.
  - At 4 seats the active villain is not distinguished; at 6 and 9 it only wins by size.
  - **At 9 seats the oval's hairline runs through the folded compact seats.** Legible at 900x640, with nothing overlapping, but
    with uneven mid-side spacing and Bo's quip truncated.
- **`glass-r4` (5):** the pot is smaller than the hero's stack, which inverts the hierarchy. The double rail is the loudest shape, the
  3D chip is skeuomorphic, and the plateless seats lose the active and folded states. At 6 and 9 seats the seat labels sit on the rail
  stroke: "900x640 at 9 seats is technically legible but not acceptable." This matches the AA check, where those renders fail at
  3.2–3.65:1.

| Variant | hier | type | color | material | space | consist | states | a11y | craft | apple | fit | scales |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `sports` | 8.17 | 6.80 | 8.17 | 7.83 | 7.67 | 8.00 | 7.83 | 7.67 | 7.50 | 7.83 | 8.17 | 7.83 |
| `glass` | 7.67 | 6.80 | 7.83 | 7.67 | 8.00 | 8.00 | 7.83 | 7.67 | 7.17 | 7.67 | 7.17 | 7.33 |
| `sports+glow` | 8.17 | 6.80 | 7.33 | 7.83 | 7.67 | 8.00 | 7.83 | 7.67 | 7.50 | 7.83 | 8.00 | — |
| `glass+glow` | 7.67 | 6.80 | 7.17 | 7.67 | 8.00 | 8.00 | 7.67 | 7.67 | 7.33 | 7.67 | 7.17 | — |
| `glass-r4` | 6.50 | 8.00 | 7.83 | 6.83 | 7.50 | 7.17 | 7.50 | 7.67 | 7.00 | 7.17 | 7.33 | 6.33 |

**Limits**
- There was one rater, and ±0.3 is within rater noise.
- This rating is not comparable with ratings 1–2 below (a different rater and a different set). Even so, `glass` moved from 6 to 7 and
  `glass-r4` scored 5 here, which is consistent with its earlier 6s.
- `type` is 6.8 on all three variants that use the condensed numerals. The rater wants SF Pro tabular instead. This is the open
  condensed-figures decision.
- The `sports` 4-seat render now comes from the layout rule, not round 4's hand placement. The positions are the same.

---

## Ratings 1–2 (round 4): seven table surfaces

Two fresh blind raters (subagents that did not design this) scored the variants. Labels V1…Vn were randomised and the keys were kept from them (`tests/tmp/vblind-key.json`, `tests/tmp/vblind2-key.json`). The rubric is the round-3 one (`tests/tmp/sc/rubric.md`, 11 categories) plus **fit**: how well the table fits the rest of the app, judged against Home, Charts and Drill.
Six table elements were rated per variant (surface, seat, pot + board, hero, bet, card backs), from DPR-2 crops plus the full live and verdict screens.

- **Rating 1:** all six round-4 variants, with round-3 green as one of them.
- **Rating 2:** a fresh rater on the refined `sports` variant (built from rating 1's fixes), against `scoreboard`, `glass` and green.

## Results

| Variant | Rating | Overall (1–10) | Element mean | Fit mean | Rater verdict (abridged) |
|---|---|---|---|---|---|
| `sports` | 2 | 7 | 7.29 | 7.67 | The most coherent with the rest of Offsuit: no table plate, the window coat carries the play area, and seats, bet and hero are glass row cards exactly in the Apple Sports idiom (condensed tabular stacks, a single green wash on the… |
| `scoreboard` | 1 | 7 | 7.21 | 7.00 | This is the only variant that rethinks the table instead of repainting it. A near-black canvas, seats as quiet row-cards, a heavy scoreboard pot figure and a sparing green wash marking you are a direct translation of the Apple Spo… |
| `glass` | 1 | 6 | 7.06 | 7.17 | The best of the ovals. A slate bed close to the app's canvas, a hairline rather than a heavy rail, and quiet enough that the white cards and the green turn dot carry the colour. It fits the rest of the app most naturally, but it k… |
| `scoreboard` | 2 | 6 | 6.67 | 5.83 | The strongest information design of the four with felt removed: contained seat cards, a scoreboard-scale condensed pot and stacks, and a sparing green wash on the hero, all lifted from Apple Sports correctly. It is undone by its g… |
| `glass` | 2 | 6 | 6.24 | 6.00 | V1's layout with the felt turned to the app's navy. Colour discipline improves a lot and it sits in the window rather than fighting it, but the ghost oval rail now frames a large empty field without adding meaning, and every V1 we… |
| `ink` | 1 | 5 | 6.87 | 6.00 | A competent dark-UI poker table that has been recoloured, not redesigned. The saturated navy bed is the loudest surface in the app and carries no meaning, the heavy rail is the strongest edge on screen, and the seats, pot and hero… |
| `midnight` | 1 | 5 | 6.87 | 6.00 | The neutrality is right, but the execution is off. Pure black with a central spotlight reads as a hole cut in the window, darker than every other screen, and it kills the glass coat. The card backs and empty slots disappear. It is… |
| `green` | 2 | 5 | 6.07 | 4.67 | The most literal poker table: green felt, black rail, chip stack. It is competently made and instantly legible as a game, but it is a casino-client trope dropped into an otherwise restrained navy glass app. The felt is opaque, swa… |
| `classic` | 1 | 4 | 6.79 | 5.00 | It is the felt idea with the saturation turned down: dark green, vignette and rail. It is tasteful and coherent, but it spends the app's success and turn hue on the biggest surface, so the green 'Your turn' dot and the +gain numbe… |
| `green` | 1 | 4 | 6.63 | 4.00 | The most literal felt: textured mid-green, heavy rail, a spotlit centre. It is the only variant that reads as 'poker table' in under 100ms, and the cards look warm and familiar on it. But it is the most off-system screen in the ap… |

**Rating 1 ship pick:** `scoreboard`. Ship V4 [scoreboard], with the fixes below. It is the only variant whose hierarchy is right (pot, then hero, then villains), and it translates the cited Apple Sports idiom (near-black tinted canvas, restrained row cards, heavy tabular score figures, one colour wash with meaning) instead of just recolouring a felt oval. Required before shipping: (1) replace the non-SF condensed face with SF Pro Compressed or Condensed Semibold with tabular-nums, and apply that figure style to Home, Charts and Drill stats so it becomes system-wide; (2) remove the boxed outer panel and let content sit on the coat; (3) drop the seat platters to about 4% fill with a hairline; (4) outline the empty board slots; (5) flatten the 3D chip into a pill. If the team will not take on the type change, ship V6 [glass], which is the safest fit, but expect it to stay a 6. Where the felt wins: V5 [green] (and V2 [classic]) win on instant genre recognition, since the table reads as poker before any text is parsed, and on warmth behind the white cards. That is worth keeping only as V4 [scoreboard]'s sparing green wash on the hero platter, which is the felt reduced to a meaningful accent.

**Rating 2 ship pick:** `sports`. V4 [sports] is the only variant whose table belongs to the same product as Home, Charts and Train: the coat is the ground, glass is used only on floating seat/hero/bet plates, colour is reserved for the hero wash and turn signal, and the chip skeuomorph is replaced by a labelled pill. It inherits V3 [scoreboard]'s strong scoreboard hierarchy without V3 [scoreboard]'s opaque black slab and action-bar collision. Felt-like V1 [green] wins only on immediate sense of place (it unmistakably reads as a poker table, and the chip and rail make the bet/pot geography obvious at a glance); if that matters, borrow it as a very faint green radial wash under the board in V4 [sports] rather than a full felt surface.

## Where green wins
- **Both raters:** green (and `classic`) reads as a poker table before any text is read, puts warmth behind the white cards, and makes the pot and bet positions obvious at a glance.
- **Against it:** both raters ranked green last or second-to-last on fit (4.0 and 4.67). It spends the app's semantic mint/green on the largest surface, and it is the one textured, casino-style screen in an otherwise glass and graphite app.
- **The rater-suggested middle path:** keep green as an accent, as `sports` already does with the mint wash on your seat, or add a faint green glow under the board.

## Category means per variant

| Variant (rating) | hier | type | color | material | space | consist | states | motion | a11y | craft | apple | fit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `sports` (2) | 7.67 | 7.17 | 7.67 | 6.83 | 7.33 | 7.33 | 6.50 | 7.67 | 7.17 | 7.33 | 7.17 | 7.67 |
| `scoreboard` (1) | 8.17 | 6.83 | 7.67 | 6.67 | 7.33 | 6.83 | 7.17 | 8.00 | 7.33 | 6.83 | 6.83 | 7.00 |
| `glass` (1) | 6.83 | 7.17 | 7.67 | 6.67 | 7.00 | 6.83 | 6.83 | 8.00 | 7.50 | 7.00 | 6.17 | 7.17 |
| `scoreboard` (2) | 7.33 | 7.00 | 7.17 | 6.00 | 6.67 | 6.33 | 6.33 | 7.67 | 7.17 | 6.33 | 6.17 | 5.83 |
| `glass` (2) | 5.67 | 6.50 | 6.83 | 5.83 | 6.50 | 5.67 | 6.00 | 7.67 | 6.83 | 6.17 | 5.17 | 6.00 |
| `ink` (1) | 6.83 | 7.17 | 7.17 | 6.50 | 7.00 | 6.83 | 6.83 | 8.00 | 7.50 | 7.00 | 5.83 | 6.00 |
| `midnight` (1) | 6.83 | 7.17 | 7.50 | 6.50 | 7.00 | 6.83 | 6.83 | 8.00 | 7.00 | 7.00 | 6.00 | 6.00 |
| `green` (2) | 5.67 | 6.50 | 6.50 | 5.67 | 6.50 | 5.33 | 6.17 | 7.67 | 7.00 | 6.17 | 5.00 | 4.67 |
| `classic` (1) | 6.83 | 7.17 | 7.17 | 6.50 | 7.00 | 6.83 | 6.83 | 8.00 | 7.50 | 7.00 | 5.83 | 5.00 |
| `green` (1) | 6.83 | 7.17 | 7.00 | 6.33 | 7.00 | 6.83 | 6.83 | 8.00 | 7.17 | 7.00 | 5.67 | 4.00 |

## Limits
- **One rater per rating; ±0.3 is within rater noise.** Rating 2 re-scored `scoreboard`, `glass` and green lower than rating 1 did (6.67/6.24/6.07 vs 7.21/7.06/6.63), so compare variants within a rating, not across ratings.
- **Motion is shared by every variant.** It does not differentiate them.
- **`sports` was designed after rating 1** using that rater's fixes, then scored by a different rater.
