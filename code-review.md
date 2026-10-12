# Review: glass-full-redesign
Verdict: PASS WITH NOTES
Base: ddd4f277e68f5535f9940c219c74790b30508375  Head: 9e4f862 (first reviewed at 33feaab; this version covers e3b0334, baa8a4a and 9e4f862 as well)

## Re-verification (findings from the first review at 33feaab)
- **Act on 1: switching Coach on hid an uncoached verdict while its narration kept running. FIXED.**
  - The fix: in `syncCoachMount` (table.ts:447-449), a verdict that is already visible now opens the sheet instead of disappearing.
  - Probe, seed 8 uncoached, Call then Fold, then Coach on: `data-sheet="verdict"`, `coach-message` visible inside the sheet, focus on the sheet. Esc then dismisses the verdict and focus lands on `next-hand`.
  - New coached-handover.spec 5 pins this; it passes.
- **Act on 2: the sheet caption said "plays on" after the action that ended the hand. FIXED.**
  - The fix: `syncSheetCaption()` now also runs from `render()`.
  - Probe: the caption is `""` at handover (both on the coached path and on the switched-on path) and "The hand plays on behind this sheet" on a mid-hand verdict.
  - coached-handover.spec 4 pins this; it passes.
- **Act on 3: two bone primaries at coached handover. FIXED.**
  - The fix: while `data-sheet="verdict"`, `styles-glass.css` restyles Next hand as a secondary. Once the sheet closes (Esc, or Coach off), Next hand is bone again (probe: `rgb(244, 242, 236)` after Coach off).
  - coached-handover.spec 4 asserts that the only bone button is `['coach-close']`; it passes.
- **Consider: the Coach switch and Stats went inert under a sheet. FIXED.**
  - The fix: `.table-corner-r` is skipped by `setStageInert` and sits above the scrim (z-index 6).
  - Probe: the switch can be clicked mid-gate and with a verdict open.
    - Coach off mid-gate: the gate stays open and moves inline, nothing stays inert, and the dock stays locked.
    - Coach on again: the gate goes back into the sheet and the input is visible.
    - The gate then resolves into the verdict sheet as before.
  - The Stats float opened over either sheet does not overlap it (probe: float 86-157px, sheet 240-429px at 900x640).
- **Consider: layout.spec 8's weaker check, and the stats float covering a seat stack. FIXED.**
  - The float is now `position: static`, so it anchors to the corner's right edge.
  - Probe: no seat stack is covered at 900x640 or 1100x760.
  - The spec now hit-tests every row against the sheet body and also asserts that no seat stack is covered. That is stronger than the original assertion.
- **Consider: the R keycap vs the slider amount. FIXED (documented).** Raise now has the tooltip "R raises to the minimum (N)", and the difference is recorded in DECISIONS.md.
- **Consider: repeated raw `rgba(255,255,255,.6)` / `.5` focus rings in screen sheets. NOT FIXED.** It is optional and is carried below.

## Consider
- The per-screen sheets (styles-charts, -chart-bank, -drill, -equity, -range-editor, …) repeat about 10 raw `rgba(255,255,255,.6)` / `.5` focus-ring outlines and a few `rgba(0,0,0,…)` shadows. That goes against "no orphan colours in screen sheets". Tradeoff: one `--focus-ring` token in styles-glass.css removes the duplicates, but it touches about 10 files for no visible change.
- table.ts:937-943 (new in baa8a4a). Each empty board well is `role="img"` with the label "flop, to come", "turn, to come" or "river, to come". Preflop, a screen reader therefore reads three identical "flop, to come" images before any card. Tradeoff: making the wells `aria-hidden` (they are decorative; the street is already announced through the pot announcer) is quieter. Keeping them gives a sense of the board's shape.

## Noted
- With the settings corner no longer blurred during a gate, the win% (for example "81% Win") is readable while the gate asks "what range or price drives this?". This matches base ddd4f27, where the readout was also visible during a gate because the commitment is still in place, so it is not a regression. Withholding the readout while `gate !== null` would make the gate a stricter test.
- Keyboard focus drops to `<body>` after a hero action in coached mode, because the dock is hidden or disabled while villains act. Base behaves the same (probed on both).
- Pre-existing, outside the diff: `onKey` (table.ts) has no guard for text fields. Once committed, typing f, c, r or a in the tray's "Why?" field triggers that action.
- DECISIONS.md cites `tests/tmp/e2e-red-review.log` and `tests/tmp/fr-gap.mjs` as evidence, but `tests/tmp/` is gitignored, so those references cannot be checked from the repo.
- `attachThumb` never disconnects its observers. They are collected along with detached nodes, so there is no practical leak.
- A verdict on a street where the hero acts again straight away opens and is dismissed in the same tick. Base cleared the inline verdict the same way.

## Dismissed
- "Spec weakening" in gate.spec 5 (under reduced motion the timer bar's animation is now expected on). Proof: the change is declared in DECISIONS.md. The gate box's entrance animation is still asserted off, and the gate still fires, resolves and logs.
- "Spec weakening" in charts.spec (the boundary may differ by `::after` content). Proof: styles-charts.css:298-311 draws a real 10px corner notch, which is a non-colour cue.
- "Spec weakening" in screens.spec (bankroll colour). Proof: it now asserts more: the delta text, the delta colour matching the loss row, and the figure colour not matching it.
- "Spec weakening" in coached-handover.spec 3 (the inert check now excludes `.table-corner-r`). Proof: the exclusion is the intended fix, and the same test now also trial-clicks the switch.
- "The board wells break card queries." Proof: the wells carry no card testid. board-deal-in, allin, gameplay, deal-perf and theme specs pass (28/28).
- "The bold verdict lead-in changes its text." Proof: `toHaveText('You committed to Fold, Sure')` still passes.
- "Keycaps pollute accessible names or text oracles." Proof: `keycap()` is `aria-hidden`, and the specs that read `btn-call` text strip non-digits.
- "Live regions go inert with the stage." Proof: the announcers are children of `root`, not of the stage.

## Verification
- All runs used a detached worktree at 9e4f862 (/tmp/fr-review2), never the main checkout or its `dist/`.
- `npx tsc --noEmit -p tsconfig.json` exit 0, `npx vitest run` exit 0, and `npm run build` exit 0.
- `npx playwright test` on coached-handover, gate, predict, layout, interaction and keyboard: exit 0, 70 passed.
- `npx playwright test` on board-deal-in, allin, gameplay, deal-perf and theme: exit 0, 28 passed.
- I did not run the full e2e suite, because the owner's run is in progress. In the first round, at 33feaab, all 11 tabs and the 8 Train modes fit 900x640 and 1100x760 without page overflow.
- Electron probes at 9e4f862:
  - Coach switched on over an uncoached verdict.
  - Coach off and back on mid-gate.
  - Coach off with a verdict open.
  - Stats float over the gate and verdict sheets.
  - Stats float against seat stacks at both sizes.
  - Caption and primary-button state at handover.
- What no test covers yet:
  - Switching Coach off mid-gate or with a verdict open (probed only).
  - The automatic dismissal at the next decision moving focus out of the sheet.
  - The sheet that opens for a reason note alone on a free grade.
