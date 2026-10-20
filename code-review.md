# Independent review: cosmetics and the Locker (branch feat-cosmetics): receipts, paint only (1.7, 2.13)

Two passes by one reviewer agent with no author context. It reviewed read-only and ran typecheck and units only (no
Playwright or build: the shared e2e lock governs those).

| Pass | HEAD | Verdict |
|---|---|---|
| 1. Review | f0d3d26 | **PASS WITH NOTES**: nothing blocking; two medium, three low, one judgement call, four test gaps |
| 2. Re-review | df44e45 | **PASS WITH NOTES**: every fix correct; two low test gaps, fixed in the final commit |

## Findings and outcomes

| ID | Finding | Outcome |
|---|---|---|
| 1 (M) | An equip in a slot this build does not know is dropped on save (`persist.ts` reads the known slots only) | **Open, for the owner.** The parser predates this branch and `progression.test` pins the drop, so changing it changes how an existing persisted field parses. No newer build exists yet, so nothing is lost today |
| 2 (M) | A preview could differ from the item worn: `--back-frame` was set by two backs only, and the Graphite rim read `--chip-b` | Fixed in df44e45, red first: every item declares every token of its slot and reads no other slot's (`cosmetics.test` parses the sheet); `locker.spec` checks preview against worn for every pair in a slot |
| 3 (L-M) | Focus fell to `<body>` after Use | Fixed, red first: focus lands on the worn item's tile |
| 4 (L) | The worn finish covered Dee's DEALER micro-text at 80px and up; a comment still said "dash" | Fixed: the ring is drawn under the bevel, face and text |
| 5 (L) | With a newer build's item worn, the default claimed "In use" and could not be worn | Fixed, red first: worn-ness is read from the stored id |
| 6 (L) | Library's desk bands were green, a hue reserved for the table | Fixed: browns and greys |
| 7 | Tests could pass on broken code: no check that every paint value has a block; the allowlist ran on the table only; preview of an owned, unworn item untested | Fixed: token-completeness unit tests; the allowlist also swaps on the Locker stage (Dee's finish, the moment); a preview-does-not-wear test |
| R2-a (L) | The required token set came from the default block only | Fixed: it is the union over the slot's items |
| R2-b (L-M) | The allowlist's Locker pass swapped on the document, which the stage ignores | Fixed: it swaps on the stage and asserts stroke and background changes were seen there |

## Found while fixing
- The first Inlaid rim used `stroke-dasharray`, which re-lays out the SVG. The extended `theme.spec` caught it (one
  layout); no finish uses a dash, and the allowlist no longer accepts one.
- The allowlist test's snapshot leaves out the title-bar perch, whose Dee blinks on a timer. The stage's Dee is measured.

## Checked and found fine (both passes)
- Earning reads only milestone receipts, Seal receipts and `story.chapters[].beatenOn`; nothing reads chips, pots or
  results; nothing is priced, sold or random; the Chalk ledger is never written; every receipt is `chalk: 0`.
- Every save goes through `applyProgress`, so receipts are filed with the ratchets that earn them, dated the day the
  fact first held, and never taken back.
- Cosmetic blocks set custom properties only; the pins are untouched; there is one bone primary on the Locker;
  nothing in the app is locked; the celebration footnote is honest about the unbuilt session-end moment.
