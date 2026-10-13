# DECISIONS — Glass mockup (`demo/glass/`)

Living record. Each line is the current end state.
- Round 1 ("liquid glass" everywhere) was rejected as tacky; its captures are in `demo/glass/round1/`.
- Round 2 (one coat, few floats) was liked for its background; its captures are in `demo/glass/round2/`.
- Round 3 is a scored, element-by-element refinement. The rubric and scores are in `SCORECARD.md` and
  `demo/glass/scorecard.html`.

## Story: the Long Orbit (branch `feat/story-campaign`)
Owner decisions in force: D1 (character, story in scope; the tutor never authors a number; no trait insults), D17
(rivals appear in Story first; live play keeps Ada, Bo and Cy), round 2 (each named regular keeps one archetype; the
dossier counts showdowns only), N1 (nothing is locked).
- **Six venues, one rival per archetype** (VISION §2.1, `src/core/story/cast.ts`): the Lighthouse (Wren Holloway, `nit`,
  "a bet that means it"), the Toll Road Diner (Barnaby Tull, `station`, thin value), the Library (Percival Hush,
  `over-folder`, the price of a bluff), the Night Train (Vesper Kade, `lag`, defending against barrels), the Fireworks
  Pier (Juniper Vale, `maniac`, trapping and calling down), the Observatory (Ines Marlow, `tag-reg`, not deviating;
  always last). The Kitchen Table tutorial and the Masquerade epilogue are not built (the task asks for six venues).
- **A chapter** is Dee's intro (story lines) → a lesson-dialogue beat (the `dee/dialogue.ts` engine over a chapter
  script, its numbers from a named lesson example) → 6 hands heads-up against the rival → a debrief. Every beat can be
  picked in any order and every venue opened at any time; the stage is only where the chapter picks up.
- **The goal is decision quality, never chips** (`campaign.ts judgeTable`): judged decisions are postflop ones facing a
  bet plus every turn and river decision (a free flop check, or a preflop fold, proves nothing). Met = at least 3
  judged, 3 in 4 of them free, and no serious mistake of a kind the rival punishes. Fewer than 3 judged reads "not
  enough to judge". Meeting it takes the mask off, as a ratchet.
- **Masked until beaten:** at a story table the rival sits as "Regular" with a "?" avatar, and the seat's label stays
  "Masked" after the hand (not the archetype label the live table reveals). Unmasked, the seat shows the rival's name
  and their style in words, never the archetype id.
- **Personalization** (`route.ts`): each charged decision in the hand log is a leak kind (coach principle × action:
  over-fold, over-call, missed value, empty bluff, light raise, free fold). Kinds rank by reach-weighted loss
  (`rw.ts` over the authored reference reach, the recommender's ranking), raw cost breaking ties. A kind needs 2
  decisions before it moves anything. The chapter whose rival punishes the top kind moves first and is "suggested
  next"; the Observatory stays last. A brand-new player gets the designer's default orbit.
- **The rival leans on the leak:** on the street carrying that kind's cost, the rival's session profile changes
  (over-fold → more bluffs, over-call → bets every strong hand, missed value → checks and pays, empty bluff → calls
  more, light raise → re-raises more, free fold → checks more). A structural zero (`archetypes.ts`) is never raised.
- **Every personalized element cites its source:** the chapter's citation names the hand count, the cost, the
  decision count and the reach-weighted bb/100; the table's lean names how many of those decisions came on its street.
  Dee's own line names only the kind in words (`{focus}`), never the numbers.
- **The dossier counts showdowns only** (`dossier.ts`): a hand adds to the hand count; what the rival did is stored only
  for a hand where two or more hands were live at the end. A pot won by a fold adds nothing, even though the table
  turns the winner's cards up. Reads (big bets shown that were bluffs, late calls with a pair or less, bets with two
  pair or better) appear once they have 3 observations; until then each says how many more it needs. Dee's take is the
  read furthest from its balanced baseline (more than 0.15 away), else "the standard line is the read".
- **Decision quality over time** is one bar per table against the rival (share of judged decisions that cost
  nothing) with the goal line; chips are not on it.
- **Persistence:** `progression.story {chapters, rivals, overrides}`, additive, no version bump (AGENTS.md recipe).
  Chapter and rival ids, and a result this build does not know, are kept as written. A showdown without two shown cards,
  a full board and seven distinct cards is dropped. Choosing a chapter other than the suggested one is logged in
  `overrides` (bounded), never refused.
- **Story hands are hands:** each lands in the hand log, the stats and the bankroll like any table hand, so the leaks
  that route the orbit also see them. Dee watches the story table as at the live one.
- **Words:** 28 story lines (4 with Dry/Blunt variants) and 6 chapter scripts (13 steps) in `src/core/story/scripts.ts`, linted with Dee's bank lint (shared
  in `tests/unit/deeLint.ts`): the tutor guard once filled, Dee's ban list, `bannedPhrasingIn`, no archetype id, no
  numeral or number word in a template, slots from the vocabulary, STRICT checks on tone variants, every beat running on
  its lesson example. The lint caught and fixed "win", "once", "Everyone" and a dropped "nothing" in a variant.
- **Nav:** Story is a 12th tab after Learn. Home gets a story strip as a third launch row; at 900x640 the recent-hands
  list (which already scrolls when Home is short) shows fewer rows.

## Dee, the character layer (branch `feat/dee-character`)
Owner decisions in force: D1 (character in scope; the tutor never authors a number; no trait insults), D5, D6
("Price held" on close spots only), D7 (no words in-hand: pose only, one line at hand end), D8 (Two lights), D12 (the
line bank is authored once, here).
- **Dee phrases; the engine owns every number.** Lines are templates with slots (`{reqPct}` `{sharePct}` `{evLossBb}`
  `{toCall}` `{pot}` `{repeat}` `{hands}` `{mistakes}` `{priceHeld}` `{rule}`) filled only from engine facts
  (`src/core/dee/engine.ts`). `renderLine` also refuses any output numeral that no fact supplied, so a template typo
  cannot author a number. Templates may not contain digits or number words (bank lint).
- **The bank:** 173 lines in `src/core/dee/bank.ts`, plus 9 lesson-dialogue lines in `src/core/dee/dialogues/`.
  The canonical text is Warm; Dry and Blunt are optional variants of the same line (the dial changes words, never
  numbers). Lines without a variant read the same in every tone.
- **The STRICT checks are ported, not copied into the test.** `src/core/dee/strict.ts` holds the PoC's rephrase check
  verbatim in behaviour (`rephraseProblems`, replayed against the PoC's ten probes) for a later rephrasing channel.
  The bank applies `variantProblems` to each tone variant: polarity words must match exactly and slots/numerals must
  keep their order, but the variant may use its own content words. Reason: the PoC's content-word order rule is a
  containment check on a model's rewording; applied to an author's tone variant it would forbid every Blunt line.
- **Silence rule:** a hand whose decisions all cost under 0.5 bb gets no line. The one exception is Price held.
- **Price held fires** on a `free` grade, on a priced postflop spot, on the right side of the price (a call or raise
  at or above it, a fold below it), with pot share within 10 points of the price, a Sure commit, a reason the grader
  reads as `price` or `range`, and no G4 flag; once per principle per sitting. Preflop is excluded: the grader's share
  against a betting range is too coarse to call a spot close. Seam: when
  the grader's close-spot band lands, its `Grade.close` decides closeness instead (`isPriceHeld(d, closeBand)`).
- **`Grade.spot`** (new, optional) carries the two pot shares on every priced decision, silent ones included. The
  coach sheet still paints only `Grade.price`, which stays absent on a free grade (coach.test pins that).
- **Hand-end priority:** the costliest mistake, then right-action-wrong-reason, then Price held. `{repeat}` counts the
  same kind of mistake (principle, action, priced or not), and a repeat notable of that kind gets "Noted." (a tic).
  "Mistakes only" keeps the right-action-wrong-reason line (it is a correction).
- **The sitting summary** shows when the sitting ends at the table (planned hands played, busted, or the table
  swept), in the dock, only if the last hand had no beat of its own. An open-ended table left mid-way gets none, so
  under "After sessions only" such a table stays silent. A line quoting the learner's own sentence outranks one that does
  not; sentences over 11 words are not quoted (the beat has two lines).
- **Frequency** (`progression.dee.personality.frequency`): `normal` = After notable hands (the id the v2 default
  already wrote, so it keeps meaning the default), `mistakes` = Mistakes only, `sessions` = After sessions only. The
  v2 placeholder ids `after-hands` and `quiet` were never written by any build and now read as the default.
- **Character off hides Dee everywhere:** no mark (perch, beat, lessons, settings preview), and no line of Dee's own
  (the beat, the session summary, the lesson open/retry/done lines). The coach's verdicts, the gate and the lesson
  script's questions stay; the lesson thread
  labels the speaker "Coach" instead of "Dee". Supersedes: the vision mock's "Off shows a plain dealer button", because
  the task asks for Dee hidden everywhere.
- **Memory** (`progression.dee`, additive, no version bump): `character` (default true), `handsWatched` (the cooldown
  clock, in hands) and `said` (the last 64 lines and the hand count each was said at). Rule sentences use the existing
  `ruleSentences`. A sentence accepted in a lesson is remembered there; "Forget" clears them (the lesson lexicon itself
  is append-only and untouched).
- **Depth quieting:** cooldowns stretch 1×, 1×, 1.5×, 2×, 3× by certified depth index (VISION §2.2).
- **Lesson dialogue is generic:** a script (`src/core/dee/dialogues/<lesson-id>.ts`) is steps of a question, options
  and Dee's reply, all slots filled from the lesson example's own fields (`exampleFacts`). Converting a lesson is one
  file plus one registry line. A distractor equal to the right answer is dropped. The first converted lesson is
  `minimum-defence-frequency` (all numbers derivable from pot and toCall); `pot-odds-as-a-price` keeps its commit box
  because the tutor-rail specs drive it.

## Test harness: hidden e2e and test tiers
- **Hidden by default.** Under `OFFSUIT_E2E_HIDDEN=1`, which the helper sets on every launch, the window is created
  `show: false` and never shown. It keeps `paintWhenInitiallyHidden` and gets `backgroundThrottling: false`, so
  screenshots, geometry and rAF/timer-driven specs behave as if the window were in front.
  - Supersedes: `showInactive()` plus parking off-screen. That still left a 40px sliver on screen (macOS clamps
    the position).
- **Accessory policy at module scope** for every e2e launch: `app.dock.hide()` (already there) plus an explicit
  `setActivationPolicy('accessory')`, so the app never activates.
- **Visible tier: show inactive, switch to the regular policy, move to ws12 by window id, then float it at
  1100x760.** AeroSpace does not list windows of accessory-policy apps (measured: no row for the pid until the
  policy flips). Switching to `regular` after `showInactive()` did not move focus (measured with
  `scripts/focus-watch.sh`). Floating keeps AeroSpace's tiling from resizing the window the layout specs measure.
  The cost is a ~100ms tile on the focused workspace before the move lands, and a Dock icon while that app runs.
  The off-screen parking is gone: ws12 is not on screen, so there is nothing left to park away from.
- **No spec needs the visible tier.** Keyboard, focus, layout, screenshot and voice specs all pass hidden;
  Playwright drives input through CDP, which needs no OS focus.
- **Tiers are npm scripts, not a new runner.** `test:smoke` is a declared spec list. `test:affected` is
  `scripts/affected-tests.ts origin/main --run`, which already widens to the full suite on shared files.
  `test:full` is typecheck + unit + e2e. No dependency was added; Node 26 runs the selector's .ts directly.
- **The selector runs everything when it can attribute nothing.** Under `--run`, "no suite could be attributed"
  now runs the full suite instead of exiting 0 with nothing run, so `test:affected` can't go green untested.
- **Smoke set:** `navigation` (launch and every tab), `persistence`, `no-network` and `gameplay` (hands to
  showdown), 33 tests. It is the cheapest set covering the five areas in the brief. Timings, measured under
  heavy machine load, are in AGENTS.md.
- `.gitignore` uses `node_modules` without the slash, so a symlinked `node_modules` in a worktree is ignored too.

## Profile schema v2 (branch `feat/profile-schema-v2`)

- **Version key:** `schemaVersion`; absent or garbage = v1, any number above `SCHEMA_VERSION` = newer.
- **Migration v1 → v2 adds defaults only.** It does not seed the streak, Reps or milestones from the logs.
  Those features backfill from `hands`/`assessments` when they land. Seeding now would be untested logic
  with no reader.
- **The snapshot is `offsuit-state.json.pre-v2`**, a copy of the file actually read (live or the backup
  recovery used). It is written at load, before any save. It is never overwritten: on a re-upgrade the first
  copy is kept, and the rolling backups hold the later one. If the snapshot can't be written (a full disk),
  load still works, but every save refuses until the snapshot succeeds. Delete removes it.
- **A failed write never throws to the renderer.** `save` returns `failed`, the banner says "Not saving"
  until the next save lands, and the session stays in memory. Writes go temp file first, then backup
  rotation, then rename, so failed saves on a full disk never push good versions out of `.bakN`.
- **Read-only lives in main, not the renderer.** It covers a newer `schemaVersion` and a file changed on
  disk since this build last read or wrote it: mtime/size flags a change, and only different bytes (sha256)
  stop saving. Delete is the one way out. The banner is fixed
  and click-through, so no layout changes. It is amber because read-only is notable, not an error.
- **Unknown keys are carried** at the top level and at every fixed-shape level of `progression`, using a
  declared key tree. Lists, maps and v1 objects are owned whole by their parsers. A carried key never
  overwrites one the serialiser wrote.
- **Extensible vocabularies are persisted as strings** (tier, entitlements, cosmetic ids, onboarding
  answers, Dee's tone and frequency) and read through `effective*()` helpers. An older build keeps a newer
  build's value rather than resetting it.
- **The streak is the classic daily streak (owner D5).** `progression.streak` holds the current run, the
  best run, the last counted local day, the counted-day history (bounded) and the boundary hour. A day
  counts with one finished session. A missed day resets the run (`currentStreakOn` reads 0 after a gap).
  The history is the source of truth: the parser derives the run and last day from it. A session dated
  before the last counted day is a clock correction: later days are dropped and the run recomputed, so a
  fast clock can never freeze the streak. The best run is a record and is kept.
  There are no rest days, no freezes and no spare wicks. Supersedes: the Lamp (lit and rested days, the
  weekly Rhythm, spare wicks), because the owner chose the classic streak.
- **Scope (owner D1: amend the spec fully).** The character, the streak, XP, trophies and earn-only
  cosmetics are in scope. The tutor still never authors a number, and there are no trait insults. Nothing
  in the schema changes for it.
- **Local day = local time, turning at 4 am**, with the offset looked up per timestamp (DST-safe). Career's
  cadence uses it now. It was UTC.
- **Units:** `bankroll` is `Chips`, and `Reps`/`Chalk` are separate brands with no converters, and the constructors refuse any branded number,
  so `chalk(bankroll)` does not compile. Isolation is
  tested by type (`@ts-expect-error`), at runtime, and by a source scan of `core/progression`.
- **Single-instance lock** per user-data directory. A second launch exits and focuses the first, except
  under e2e, where it does not take focus.

## The full redesign (branch `glass-full-redesign`): the mockup, built
The restyle below gave the app the tokens, materials and the `sports` table, but most screens kept their old
layouts. This branch builds the mock's layouts and components (`demo/glass/*.html`, rounds 3 and 5) in the
real app. Kept as the user saw them: the in-app pre-blurred backdrop, regular-width SF numerals, the 2–6 seat
rule.

### Shared kit
- **One component kit in `styles-glass.css` ("Shared primitives"), `g-` prefixed** so it never collides with
  a per-screen class: text roles (`.t-hero` … `.t-head`, `.g-label`, `.g-sub`, `.g-caption`), `.g-stat`,
  `.g-group` (inset group, actionable lists only), `.g-sect` / `.g-flat` (hairline sections, informational
  lists), `.g-seg` (segmented track), `.g-row`, `.g-switch`, `.g-kbd`, `.g-chev`, `.g-icon`, `.g-mini`, and the
  `.pill.quiet` / `.pill.sm` / `.pill.lg` button ranks. Screens compose these instead of restyling.
- **One sliding selected thumb (`components/thumb.ts`)** for the tab strip and every segmented control. The
  selected item keeps its own flag (`data-active`, `aria-checked`, …), which is what tests and assistive tech
  read; the thumb is an `aria-hidden` span that follows it (a MutationObserver on those attributes plus a
  ResizeObserver). A control that a screen re-renders gets a fresh thumb in place, so it slides only where
  the DOM persists (the tab strip, the table's controls).
- **Glyphs (`components/glyphs.ts`)** are built with `createElementNS`, never `innerHTML`: chevron, spade,
  people, warning, icon tile, keycap. Keycaps are `aria-hidden`; the shortcut is announced by the control.

### Window and nav chrome
- **The tab bar is built once** and only its `data-active` (and `aria-current="page"`) changes per render,
  so the thumb slides and a clicked tab keeps focus. Before, `nav.replaceChildren` rebuilt all eleven buttons
  on every render.
- **Grouped tabs:** play (Play, Learn, Train, Charts) · study (Bank, Equity, Ranges, Dossier) · you (Progress,
  Profile, Settings), with 12px dividers. The grouping is presentation only; `TABS` stays the one registry
  and the DOM order is unchanged.
- **Wordmark:** the 14px SVG spade plus "Offsuit" at 15/600; the mark alone below 1040px.
- **Unified title bar:** `titleBarStyle: 'hiddenInset'` was already set. Added `trafficLightPosition
  {x:16, y:16}` so the 12px lights centre on the 44px bar. The bar is a drag region and every tab opts out
  (`-webkit-app-region: no-drag`). The bar stays 44px (the mock's 48 would cost Home's 640px budget; the
  e2e pin is ≤ 52).

### Home (`demo/glass/home.html`)
- **Two columns:** the launcher column (headline, Suggested next, launch rows, Recent hands) and the planner.
  Home fits 900x640 with no page scroll because Recent hands is the one block that shrinks: its inset group
  scrolls inside itself (`session-plan.spec` 17 still pins the no-scroll and Start-above-the-fold rules).
- **The bankroll is neutral ink (34/600) with a baseline-aligned delta** from the 10000 start ("+840" mint,
  "−5000" coral, none at break-even). Supersedes: the whole figure coloured by direction, because the colour
  role map reserves mint for deltas, never balances. The headline still reads as a loss at a glance (the
  reason that colouring was added), because the delta is in the same coral as a losing row. `data-direction`
  on the figure is unchanged.
- **Standing** uses the same stat component: a 15/500 value over the 12/500 label, bottom-aligned with the
  bankroll label.
- **Suggested next is a flat hairline section:** the label, then one action row (title 17/600, reason, chevron)
  whose hover rect bleeds 10px into the gutter so the text sits on the section edge. The label-to-title gap
  is 6px (the round-3 rater's top complaint was the detached eyebrow). Skip is a small secondary button.
- **New session / Play with friends are one inset group of rows** with icon tiles, captions and chevrons.
- **Recent hands:** a title-case label (the uppercase eyebrow is gone), rows in an inset group with 24px
  mini cards and 13/500 tabular amounts signed with the true minus (U+2212). The rows are not openable in
  the app (no `onOpenHand` is wired), so they carry no chevron; the mock's chevron would promise an action.
- **The planner is a flat hairline table:** title row with the Plan/Interleaving segmented control, Length and
  Mode beside their labels, the detail scrolling inside the column, and Start pinned under it as the single
  36px bone primary with its caption beside it. The caption stays inside the `plan-start` button (so it is
  part of its accessible name and `.session-card-meta` still resolves); only the title part wears the bone.
- **The planner's controls are built once** and only their flags change, so the three segmented thumbs
  slide; only the plan body is rebuilt per change.

### Table (`demo/glass/table.html`, `sports`)
- **Coach is a real switch and Stats a tertiary text button, in the table's top-right corner,** off the dock
  (`role="switch"`, `aria-checked`; `data-on` kept). Both are built once, so the switch animates and focus
  survives every render. The blinds sit top-left as 12px metadata.
- **The Win/Tie strip under the dock is gone; the readout moved to that corner.** The win/tie line is quiet
  metadata in the stat grammar (value then label, neutral ink — the role map gives a win% no hue, so it is no
  longer mint), and Stats (or the readout itself) drops the made-hand list as a small float anchored to the
  corner's right edge, clear of the top seat. This
  frees the strip's ~40px at 900x640 and fixes the strip that matched nothing else in the system. The sheet's
  testids, `data-open`, `data-withheld` and the "—" withholding in coached mode are unchanged.
- **The dock has the round-3 hierarchy:** Fold / Check / Call secondary with trailing keycaps on their real
  hotkeys (C sits on Check when checking is legal, else on Call, exactly as the C key behaves), a separator,
  the sizing group (a slider whose track fills to the thumb centre, a fixed 40px tabular amount slot, and the
  presets ½ ¾ Pot All-in as one small segmented group with `role="group"`; All-in's A hotkey is in its
  tooltip), a separator, and Raise as the one bone primary with its R keycap. The R key raises to the
  minimum while the button raises to the slider's amount, so the button's tooltip says "R raises to the
  minimum (N)". Next hand is the primary at handover. Keycaps are `aria-hidden`; each button names its key
  with `aria-keyshortcuts`. The table also draws the streets still to come as empty inset wells (no card
  testid, so card queries are unchanged).
- **Round-5 sports fixes:**
  - **One green on the hero:** the pinned mint ring stays (`interaction.spec`); the mint border and mint wash
    are gone. Your turn is the ring plus a soft white light pool on the plate.
  - **The dealer button sits on the plate's top-right corner,** clear of the hole cards.
  - **The pot and board sit lower on a tall stage** (60% instead of 46% when the stage is at least 480px
    tall). Measured on the flop (`tests/tmp/fr-gap.mjs`), the board-to-hero gap went from 153px to 91px at
    1100x760 and from 88px to 43px at 900x640. The app has no price
    line (the mock's "75 to call, a 25% price"); adding one would hand the learner the pot-odds answer the
    drills ask for, so it was not added.

### Coach sheets and the commit tray (coached mode)
- **The gate and the verdict are the mock's sheets** (`coach-sheet`, `role="dialog"`): a float that rises from
  the bottom of the table stage over a scrim, with the stage dimmed and blurred behind it and every stage
  child `inert`. The tray and the dock below the stage stay live. Supersedes: the inline coach panel in
  coached mode, because the user asked for the mock's sheets.
  - **Why not fully modal:** a modal over the dock would put "Next hand" behind the sheet at handover
    (`coached-handover.spec` 1 pins it on screen and clickable) and add a dismissal before every next
    decision. Keeping the dock live preserves every existing flow unchanged, and the sheet still takes focus,
    blocks the table and its hotkeys, and dismisses with Close or Esc. The nav also stays live, as switching
    tabs mid-hand already abandons the hand.
- **Behaviour contracts kept:**
  - The gate's 8s budget, two attempts, Enter-to-submit and its focus on the answer field are unchanged; the
    sheet opens before `showGate` so the focus lands in a visible field.
  - "Commit before feedback": the verdict sheet only ever opens after the action is committed and graded.
  - A verdict is cleared at the hero's next decision, exactly as before (the sheet closes with it), and
    survives to handover otherwise. Close or Esc dismisses it early, which also stops the voice narration.
  - The screen-reader announcer still announces each verdict once.
  - Action hotkeys never reach a table behind a sheet; Esc closes a verdict but never a gate.
  - On close, focus returns to the first live control (the tray, else the dock), never to `<body>`.
  - The table-settings corner (the Coach switch, the win/tie readout, Stats) is never inert and sits above the
    scrim, so the Coach switch stays reachable at every point in a hand, as the dock toggle was.
  - Switching Coach on while an uncoached verdict is up moves it into the sheet (it never vanishes while the
    voice and the announcer still carry it); switching Coach off moves an open sheet's verdict or gate back
    inline.
  - The sheet's caption follows the live state: "The hand plays on behind this sheet" only while it does.
  - One primary on screen: while a verdict sheet is up its Close is the bone button and Next hand under it
    reads as secondary; with the sheet closed Next hand is the primary again.
- **The verdict sheet holds both halves:** the coach's head (a 13px warning glyph plus "Serious"/"Notable" in
  coral/amber, so severity is never colour alone, and "On the flop, you folded to 75" on the right), the 17/600
  headline, the principle, the price meter, a divider, "You committed to Fold, Sure", the 15/600 neutral
  reveal line and the support at 56ch, then Close (bone, `esc` keycap). The reveal line and support are lent
  to the sheet by the tray and handed back on close (they stay up until the next hand, as before).
- **The price meter** is new data on the grade: `Grade.price {needed, had}` on a priced, non-silent verdict
  (`core/coach.ts`, unit-tested). It is a display detail, so the saved decision keeps the grade's stored shape.
- **G4's reason note on a silent grade** also opens the sheet, so the note is seen; it is dismissed at the next
  decision with everything else in the sheet.
- **The commit tray takes the dock's place until the hero commits** (every dock action is locked until then);
  once committed, the dock returns under it. During a gate the dock stays, locked, under the sheet. The tray
  is the dock's thin glass with a 15/600 question and one 28px row: the action and confidence segmented
  controls (with the sliding thumb; each choice carries `aria-pressed`), and the optional "why" field. The
  confidence labels are title case on the control; the reveal line keeps "SURE".
- **The uncoached verdict stays an inline float above the dock** with the same head, headline and meter. The
  mock defines the sheets only in coached mode, and a dimming sheet after every uncoached mistake would turn
  casual play into a dialog per decision.
- **The gate's budget bar keeps draining under reduced motion.** It is a functional timer, not decoration;
  every other animation on the table stops. Supersedes: the bar frozen under reduced motion.

### Spec changes (each: what changed and why; none weakens what the spec asserts)
- `screens.spec` (Home): hand nets are signed with the true minus U+2212, so the regex and `Number()` parse
  accept it; the "one loss colour" test now compares the bankroll's delta with the losing row (the figure is
  neutral ink by the role map) and asserts the figure is not painted as the loss.
- `predict.spec` (toggle): the Coach toggle is a switch, so "off" is asserted as `role="switch"` +
  `aria-checked="false"` instead of the old "Coach off" label text.
- `layout.spec` 8: the made-hand list now opens as a small float that fits at 900x640, so "the body scrolls"
  became "the body scrolls, or every row is on screen, inside the body and hit-tests to itself". Added: the
  open list covers no seat stack. The no-page-scroll, win% on screen and action pills on screen assertions
  are unchanged.
- `gate.spec` 5: under reduced motion the budget bar's animation is now asserted ON (`offsuit-gate-drain`);
  the gate box's entrance animation is still asserted off and the gate still fires, resolves and logs.
- Added: `coached-handover.spec` 3 (the gate sheet takes focus into its field; the stage behind is inert except
  the settings corner; Esc does not dismiss a gate), 4 (the verdict sheet takes focus, holds both halves, its
  caption is honest at handover, exactly one bone primary, the Coach switch reachable, Esc dismisses it,
  focus lands on Next hand, nothing stays inert) and 5 (switching Coach on over an uncoached verdict keeps it
  on screen); `coach.test.ts` (`Grade.price`).
- Added by the screen work: `grid-tools.spec` (Equity shows only the villain input its mode needs; Bank,
  Equity and Ranges grids fit with every cell at least 24px), `puzzle.spec` 0 (each Spots action shows its
  real hotkey). Changed: `charts.spec` 4 also accepts the boundary's corner notch (`::after`) as its
  non-colour cue, alongside border style and weight; the "not recoloured, not mint" checks are unchanged.

### Every other screen (the round-3 element change log, applied with the kit)
- **Learn:** a 22/600 title, title-case phase labels, each phase's lessons as one inset group of rows with
  chevrons; the lesson view's facts on the stat component, its example a hairline section with a segmented
  1/2/3, Commit as the one bone primary. The tutor rail (shared with Spots) is a flat hairline section.
- **Train hub and drills:** the sub-rail is a source list (fill-1, no shadow), distinct from the toolbar thumb.
  Math matches `drill.html`: the 216px Drilling column with ONE kind list (checkmark plus the session tally,
  then "All kinds"), the 22/600 question, the 15/600 band sentence, the You said / The answer stat pair with
  coral only on the wrong value, the numbered method with tertiary tabular numerals, and Next problem as the
  bone primary with ↩. Reading, Sight, Defense and 3-bet follow it; Spots is two flat columns with the tutor
  rail; Speed, Stress, Leaks, Upkeep and variance are hairline columns with stat figures and one primary.
- **Charts, Bank, Equity, Ranges:** `charts.html`'s 288px side column (segmented spot and seat with the sliding
  thumb, the 28px width stat, classes as a flat list, numbered rules, flat boundary tags), the 13×13 grid on an
  opaque base with graphite cells and the boundary as a 10px corner notch (never a ring: rings mean focus),
  a legend drawn like the cells, row-staggered cell fade-in, and the quiz as a horizontal inset group with
  trailing keycaps. Bank, Equity and Ranges share the grid language and use the kit's fields, segmented
  pickers and one bone primary each.
- **Dossier, Progress, Profile, Settings, Review, Assessment, Career, Multiplayer:** headline figures on the
  stat component, title-case labels, inset groups only for lists that act (tendencies, saved ranges, the hand
  picker, setup rows, multiplayer seats as rows), hairline sections for the rest, one primary each. Settings'
  on/off controls are real switches (`role="switch"`, `aria-checked`, visible On/Off text kept) and the theme
  picker is a segmented control; the theme switch is still paint-only.
- **Bugs found and fixed along the way (each with a failing test first):**
  - Equity's hidden villain inputs and its 169-cell grid showed in "Any two cards" mode (`.equity-field`'s
    `display:flex` beat `hidden`): `grid-tools.spec` E1 failed first.
  - Spots showed Check's hint as "C" though its hotkey is K: `puzzle.spec` 0 failed first.
  - Learn's Enter on the lesson list re-clicked the now-persistent focused tab and redrew the list over the
    lesson (the persistent nav exposed a missing `preventDefault`): `lesson.spec` 7 failed first.
  - The review's three table defects (verdict hidden by switching Coach on, a stale "plays on" caption, two
    primaries at handover): `coached-handover.spec` 4 and 5 failed first (`tests/tmp/e2e-red-review.log`).

### Tests: why no failing-first test overall, and what no test covers
- **No failing-first test applies to the redesign itself:** it changes how screens look and where controls
  sit, not a defect. The behaviour it adds is pinned by new tests (the sheet's focus, inertness, Esc, caption
  and primaries; `Grade.price`; the grid fit), and each real bug found along the way got its failing test
  first (above).
- **No test covers:** how any screen looks beyond the colour, geometry and fit pins; the sliding thumb's
  motion; hover and press states; the stage's blur under a sheet; the obsidian theme's appearance; the
  backdrop under `prefers-reduced-transparency`; the real traffic-light position (`trafficLightPosition`)
  in a windowed build. The evidence for these is the screenshots (`fr-final/`, `fr-compare/`) and the AA
  measurement (`aa-fr.log`).

## The app restyle (shipped look: glass, with the `sports` table)
The user chose `sports`. The real app (`src/renderer/`) now uses the glass system and the `sports` table.
The mock in `demo/glass/` stays as the reference.

### What changed, and where
- **`styles-glass.css`** (new, loaded after the global sheets) holds the whole look.
  - Tokens, a pre-blurred backdrop, one coat, a titlebar nav and one button system.
  - Selected states, fields, floats, bone cards, grid-cell faces, and the table.
  - Per-screen sheets are untouched. The few selected states they define are overridden with an `html`
    prefix.
- **`seatLayout.ts`** (new, pure, unit-tested in `tests/unit/seatLayout.test.ts`) is the scoreboard "U" rule
  from the mock. It gives one or two seats per side column and the rest in the top row, clockwise from the
  hero.
- **`screens/table.ts`** has three small DOM changes:
  - a `.table-stage` wrapper
  - the pot as "Pot" plus a value span, with the text still "Pot N"
  - the hero's seat moves onto the hero plate, together with the big hole cards
  - Seat order in the document is unchanged (0, 1, 2, 3).
- **`screens/settings.ts`:** the default theme's label reads "Glass". Its id stays `graphite`, so saved
  settings still resolve.

### Decisions
- **The backdrop is drawn in the app and pre-blurred,** not real macOS vibrancy. A static `filter: blur` layer
  is rasterised once, while a full-window `backdrop-filter` re-blurs on every repaint (`deal-perf.spec`
  measures the flop). Contrast was measured on this exact backdrop. Real vibrancy needs a transparent window,
  and contrast then depends on the user's wallpaper.
- **Numerals are regular-width SF, heavy and tabular,** not the mock's condensed SF. Supersedes: condensed
  figures across the app. The latest blind rater scored the condensed face 6.8 on type and asked for SF Pro
  tabular, and it needs a system-font file hack that Electron's CSP would not load.
- **The coach verdict, the gate and the commit row** were inline glass floats in this restyle. Supersedes: now
  the mock's sheets and tray in coached mode (see "Coach sheets and the commit tray" above).
- **Selected means the glass thumb** (a light fill with light ink) everywhere. It replaces the old white chip
  and the white outlines. The committed prediction is a selection, so it is no longer mint.
- **Grid cells get opaque graphite faces:** in range is `#474C55`, out is `#1C1F25`, a 3-bet is stronger. Bone
  is reserved for real cards. The range editor and equity grids lose their decorative green. The opaque face
  is also what lets the revealed-cell ring read (`charts.spec` 6b).
- **Obsidian stays a paint-only alternative.** It is opaque near-black with the backdrop hidden, and switching
  to it still causes no layout (`theme.spec`).
- **Kept pins:**
  - `--text-hi` stays white and `--positive` stays mint.
  - The to-act ring (mint at 0.4 alpha with a 1.02 scale), and a resting seat's transform of `none`. Seats are
    placed with `translate`, never `transform`.
  - Fold has no shadow, and the enabled Raise is lifted. The secondary hairline is a border.
  - A busted seat has a dashed edge.
  - The seat opacity order holds: live is 1, then folded, then busted, all above 0.
- **Folded and busted opacity moved from 0.4 / 0.22 to 0.72 / 0.56.** At the old values the dimmed seat
  text failed AA on the coat (2.7–3.6:1 in `app-contrast.log`). The order is what `busted-seats.spec`
  pins, not the values. All text on a busted seat is full ink, so it stays legible at 0.56. A folded
  hero now also dims their own hole cards on the hero plate.
- **Three "quiet" captions were coloured with a surface token (`--surface-hi`),** which made them invisible
  (1.2:1, before and after the restyle). They are now `--text-lo-2`:
  - the charts class score with no attempts
  - the drill's "when" tag
  - the drill's "Full worked method" line
  - The tab bar stays at or under 52px; it is 44px.
- **Changed pin:** `interaction.spec`'s pot check asserted the old 14px/500 `.pot`. It now asserts what the
  design intends: the pot figure is white, at least 700 weight, larger than every seat stack, and the text
  still reads "Pot N".
- **A pre-existing failure was fixed in the test,** in its own commit. `voice.spec` test 2 failed on `main`
  before any restyle. Its second verdict is hand 2, because re-opening the table continues the hand
  numbering, and that hand grades notable rather than the pinned hand-1 serious.

### Tests: why no failing-first test, and what no test covers
- **No failing-first test applies.** A restyle repairs no defect. The new behaviour with logic is the seat
  rule, and `seatLayout.test.ts` covers it. The pot pin was rewritten to the new intent; it was not loosened.
- **No test covers:**
  - How the screens look, beyond the e2e colour, geometry and fit pins.
  - The 6–9 seat compaction in the real app, which has 4 seats solo; the rule is unit-tested but only the
    mock renders more seats.
  - The obsidian theme's appearance.
  - Hover and press states.
  - The backdrop under `prefers-reduced-transparency`.
  - The evidence for these is the Playwright screenshots of the running app (`tests/tmp/app/`) and the
    contrast measurement on them (`app-contrast.log`).
- **AA on the running app:** 96 renders at both sizes, and all pass. The minimum is 4.75:1, the dealer
  button's "D" on bone in Obsidian.
  - The renders are every screen state in the default theme, the same in Obsidian, and a busted-villain
    showdown and next hand in both themes.
  - The method is `app-contrast.mjs` plus `aa-measure.py`: rendered pixels with the text hidden, the
    5th-percentile-worst pixel per text run.
  - It does not see pseudo-element text, such as the "Bet" label and the quote marks. Those were checked
    by hand: "Bet" is `--ink-2` on the pill, about 9:1.
- **A layout test was added after the review found a defect:** no seat may overlap the board or another seat
  at showdown at 900x640 (`layout.spec` 4). It failed first ("seat 3 x board": the river crossed Cy's seat),
  and it passes after the side seats were capped at `47% - 160px`.

## Table: refined tinted glass, and more seats
The user is leaning to `sports` and the tinted `glass` table. `?felt=glass` is now the refined slab; the
round-4 version stays as `?felt=glass-r4`. Links to `?felt=glass` in the round-4 records now open the refined slab; the version those ratings scored is `glass-r4`. The seat count is switchable: `table.html?felt=glass&seats=6`
(4, 6 or 9).

### What was wrong with `glass-r4` (both blind raters) → the fix
- **The oval framed an empty field.** The rail filled about 80% of the window with nothing in it but a
  dead zone between the board and the hero (rating 2 surface hier/space; rating 1 space). → The slab is
  smaller and holds only the pot and board; the seats sit on its rim.
- **The rail was neither glass nor coat.** It had two concentric hairlines of different opacities that
  read as an embossed tabletop or a "CSS donut" (rating 1 material/craft; rating 2 material). → One real
  frosted slab: one 0.5px rim, a specular top edge, a soft inner shadow, and no inner pane.
- **The pot did not lead.** "Pot 225" was about 20px, lower than the hero's 34px stack (both raters, pot
  and hero hier). → The pot uses the `sports` scoreboard numeral and is the largest figure on the table.
- **Seats were loose type on the surface.** Name, stack and quip sat at one level with no container, unlike
  the app's row cards (rating 2 seat consist/hier). → Seats use the `sports` row card, the same radius,
  fill and condensed stack for every seat.
- **No seat states.** Nothing marked the active villain or the folded seats (both raters, seat states). →
  The seat with the live bet gets a brighter rim and full-ink text, folded seats lose the plate, and busted
  seats show as an outlined empty chair.
- **Empty turn and river slots vanished** (1.15:1). → 1px outlined wells, as in `sports`.
- **The bet was a 3D chip** (rating 2 bet apple 4). → The flat "Bet 75" pill from `sports`.
- **The hero was not distinguished** except by the green dot. → The `sports` mint wash on the hero card:
  colour reserved for whose turn it is.
- **No identity or sense of place** (rating 2 colour). → A very faint green glow under the board was tried on
  both `glass` and `sports` (`&glow=1`) and **not adopted**. The blind rater preferred the version without it
  in both pairs (`glass` 7 vs 6 overall, `sports` 8 vs 7), saying it is decoration that dilutes the "Your
  turn" green. The `&glow=1` switch stays in the mock for reference only.

### Result and recommendation (blind rating 3, `SCORECARD-TABLE.md`)
- **Scores:** `sports` 8 overall (fit 8.17, scales 7.83). Refined `glass` 7 (fit 7.17, scales 7.33).
  `glass-r4` 5 (fit 7.33, scales 6.33). In the same rating, the refinement put `glass` 2 points above `glass-r4` overall and on hierarchy
  (7.67 vs 6.50). It is slightly lower on fit (7.17 vs 7.33) and on type (6.8 vs 8.0, the condensed numerals). `sports` still beats
  it on every summary score.
- **Recommendation: ship `sports`**, with its 6- and 9-seat rows layout. `glass` is the alternative if you
  want a literal table shape.
  - It is the better oval, and it scales to 9 seats at 900x640 with no overlaps.
  - The rater still reads the oval as a game skin no other screen uses.
  - At 9 seats the oval's hairline runs through the folded seats.
- **Rater fixes not yet applied (unrated):**
  - `sports`:
    - Close the about-170pt gap between the price line and the hero at 1100x760.
    - Drop one of the hero's two greens (the wash or the green "Your turn" text).
    - Move the dealer button off the hero's card.
  - `glass`:
    - Give folded rim seats the frosted fill, so the rim hairline stops cutting through them.
    - Mark the active villain at 4 seats too.
  - Both: the condensed numerals (`type` 6.8) are the open decision below.

### Seat counts the real app supports
- **Solo play: hero plus 3**, fixed. The table screen seats `['You', 'Ada', 'Bo', 'Cy']`
  ([table.ts:83](/Users/pranavgk/Documents/scratch/temp/Poker/src/renderer/screens/table.ts:83)).
- **LAN multiplayer: 2 to 6 seats.**
  - The room rejects anything outside 2..6
    ([multiplayer.ts:131](/Users/pranavgk/Documents/scratch/temp/Poker/src/core/multiplayer.ts:131)).
  - The main process clamps the host request to 2..6, default 3
    ([main.ts:292](/Users/pranavgk/Documents/scratch/temp/Poker/src/main/main.ts:292)).
  - The host picker offers 2 to 6 ([multiplayer.ts:352](/Users/pranavgk/Documents/scratch/temp/Poker/src/renderer/screens/multiplayer.ts:352)).
  - The relay comments that "2–6 seats a real table uses"
    ([relayHost.ts:49](/Users/pranavgk/Documents/scratch/temp/Poker/src/main/relayHost.ts:49)).
  - The multiplayer screen draws seats as a list of rows, not an oval
    ([multiplayer.ts:444](/Users/pranavgk/Documents/scratch/temp/Poker/src/renderer/screens/multiplayer.ts:444)).
- **The engine has no cap.** `createTable` takes any seat array
  ([table.ts:120](/Users/pranavgk/Documents/scratch/temp/Poker/src/core/table.ts:120)). The six
  archetypes are villain styles, not seats
  ([archetypes.ts:2](/Users/pranavgk/Documents/scratch/temp/Poker/src/core/archetypes.ts:2)).
- **9-max exceeds today's maximum of 6.** It is mocked as a stress case only.

### Seat layout algorithm (`demo/glass/table-seats.js`)
- **Order:** villains go clockwise from the hero, who is on the button. Seat 1 is always the small blind,
  on the hero's left.
- **Ring layout (`glass`, and `glass-r4` for comparison).**
  - Villains sit on the slab's rim ellipse, spaced evenly by arc length (not by angle, which bunches the
    end seats).
  - The arc's half-width from 12 o'clock is 90° for up to 3 villains, 112° for 5 and 124° for 8. Extra
    seats wrap down the sides toward the hero.
  - A seat is clamped 12px inside the window.
  - The hero holds the bottom of the rim. The pot and board sit 4% below the slab's centre.
- **Rows layout (`sports`): a scoreboard U.**
  - Each side column holds `max(1, round(k/4))` seats, where k is the number of villains. The rest form one
    top row across 27–73% of the width.
  - Columns fill the band between the top row and the hero.
- **Bets.**
  - A bet sits 8px inside its seat, on the line to the pot.
  - If that spot hits the board, the price line, a seat, the hero or another bet, it tries straight across,
    then straight up or down, stepping outward 4px at a time.
  - In the rows layout, a top-row seat bets straight down and a column seat straight across, so ownership
    reads by alignment.
- **Dealer button:** on the seat's inner edge, vertically centred, clear of the stack figure.
- **Compaction.**
  - Full (4 seats): the round-4 seat card.
  - Mid (5–6): cards 30 → 26px, no "Unknown" tag, the quip cut to 112px, folded seats drop the quip.
  - Compact (7–9): cards 21px, no quips except on the live seat, folded seats show no cards, and stacks
    shrink to 20px (22px live) but stay condensed and legible.
- **States:**
  - The live bettor gets a brighter rim and a larger stack.
  - Folded seats lose the plate and are dimmed.
  - A busted seat is a dashed empty chair reading "Sitting out".
- **Verified by:** [r5-capture.log](/Users/pranavgk/Documents/scratch/temp/Poker/tests/tmp/r5-capture.log): 116 renders, all
  passing the layout guard.
  - **Sets covered:**
    - The 48 evidence renders.
    - Probes with every villain betting and the button on seat 1 or 4.
    - Predict and gate at 4–9 seats.
    - 5, 7 and 8 seats.
  - **Checks:**
    - No clipping, and no truncated name or stack.
    - The seat count matches.
    - No unplaced bet.
    - No overlap between seats, hero, bets, pot, board, price, corners, dock, commit tray and every dealer button.
    - The glass slab clears the dock and tray.
  - **What it does not check:**
    - Overlaps under an open sheet. The table behind is inert and dimmed, and only clipping is tested.
    - The oval's hairline crossing seats. The rater flagged this at 9 seats.
    - Resizing after load.
  - **AA:** checked on the 48 evidence renders,
    [r5-contrast.log](/Users/pranavgk/Documents/scratch/temp/Poker/tests/tmp/r5-contrast.log).
    - All 36 `glass` and `sports` renders pass (minimum 4.93:1 against the 4.5 bar).
    - The only failures are `glass-r4` at 6 and 9 seats, at 3.2–3.65:1. There its bare-type seats land on its rail hairline, which
      is a reason the round-4 surface does not scale.

## Round 4 — the table surface (green under review)
The user likes the direction but questions the green felt. Round 4 changes only the table surface and what
sits on it, offering switchable variants (`table.html?felt=…`). Everything else stays as in round 3.

### Apple Sports: what makes it premium (from the App Store listing, iOS 26 assets; see references.md)
- **A dark canvas that is never flat.** The Today list sits on a deep, clearly saturated brand-green field, with a gentle top-down gradient and one lighter grouped card, not pure #000. The game
  sheet's canvas is the two team colours blended across the width, with soft vertical light streaks.
  Depth comes from tint and light, not texture.
- **Team colour is identity, not surface.**
  - A colour appears as a wash: a diagonal or left/right gradient behind a live card, or a soft glow
    behind a crest.
  - It appears as an accent: the possession bar or a tick.
  - Rows in the list stay neutral, and the colour is only in the logos.
  - Even the full-colour sheet keeps every number white.
- **Scoreboard typography.** Scores are a heavy, condensed, tabular face (SF Pro Compressed/Condensed
  Bold) at roughly 3× the size of everything around them. The clock is a medium-weight middle figure.
  Labels are small and grey. The scale contrast does the hierarchy, with almost no boxes.
- **Card and row materials.**
  - The Lock Screen cards are opaque colour washes with 0.5px light edges.
  - The Upcoming list is frosted glass over a blurred teal-to-navy field, with the focused row lifted as
    its own slightly lighter glass slab.
  - Lists use full-bleed hairline dividers and generous row heights.
- **Live state.** "3rd 11:55" plus a small symbol and a progress bar; no flashing. What is live is shown
  by which numbers are present, plus one accent bar.
- **Density and restraint.** There are many rows, but each row is three things: a crest, a number and a
  name. There is nothing decorative, and the motion is functional.

### Translated to a poker table
- The table should be a **canvas defined by light and tint**, not a textured material. The oval can stay,
  but as a lit zone rather than a cloth.
- **"Team colour" maps to the player whose turn it is.** It is one accent wash behind the acting seat,
  never the whole surface.
- **The pot is the score:** a heavy, condensed, tabular figure. The board is the "clock" row; seats are
  team rows with a name, a stack (a condensed tabular figure) and a quip in grey.
- **Glass is used only where something is lifted:** the focused hero seat, like the focused row in the
  Upcoming list.

### Variants built (`demo/glass/table-variants.css`, `table.html?felt=…`, gallery `table-variants.html`)
Every variant keeps the oval or panel positions: seats left/top/right, the pot and board in the centre, the
hero at the bottom. They differ in material and emphasis, not in layout logic. All pass AA
(`variants-contrast.log`) and the layout guard.
- **`midnight`: graphite, defined by light.** A near-black, hue-free surface; a soft top lamp (11% white);
  a hairline rail and a 0.5px inlay. The weave is replaced by fine grain only. Cards and chips are the only
  colour. Taken from Apple Sports: the dark canvas that avoids flatness through light.
- **`glass`: a tinted frosted slab.** A rail at 10% fill with `blur(28px) saturate(175%)` picks up the
  desktop, plus the floats' 0.5px gradient rim. The playing area is a darker inset pane of the same slab,
  with no second blur. Taken from the frosted Upcoming list. Trade-off: it costs one more backdrop blur, and
  the table and coat are both glass.
- **`ink`: deep ink felt.** The round-3 cloth, re-dyed to the background's slate navy
  (`#1D2A45 → #131D33 → #0B1222`) with a neutral lamp. This tests whether green is the problem, rather than
  felt itself.
- **`scoreboard`: the Apple Sports layout.**
  - A tinted near-black rounded panel replaces the oval.
  - The pot is the score: 60px heavy condensed tabular SF (`SFNS.ttf` at `font-stretch: 50%`, falling back
    to the system font).
  - Seats are team-row cards with condensed 26px stacks.
  - The hero gets the single accent wash (a mint diagonal gradient, the "team colour" of whose turn it is).
- **`classic`: the control.** A darker, desaturated green with a neutral lamp, to show whether a refined green
  would have been enough.
- **Unchanged in every variant:** cards, dealer, dock, sheets and chrome. The dock needed no tuning; its 34%
  glass reads over all seven surfaces. `sports` replaces the bet chips with a pill.

- **`sports`: added after blind rating 1**, applying that rater's fixes to `scoreboard`:
  - no boxed panel: the coat is the canvas, and a dark lit zone with no edge holds the play
  - quieter seat rows (4% fill, 0.5px edge)
  - outlined turn/river wells (the rater measured them at 1.1:1)
  - the bet as a flat "Bet 75" pill instead of a 3D chip
  - The rater's "web face, not SF" note is wrong: the figures are SF Pro on its width axis. That is recorded
    rather than changed.

### Recommendation (round 4)
- **Ship `sports`.** It was the top pick in rating 2, with the highest fit (7.67) and element mean (7.29).
  Rating 1 predates it; there, its parent `scoreboard` was the top pick (overall 7, fit 7.00). It is the most
  direct translation of Apple Sports. Both raters ranked round-3 green last or near-last on fit: it
  spends the app's semantic green on the largest surface and is the one casino-textured screen. Note that Apple
  Sports' own Today canvas *is* a saturated green, so the case against green is semantic (in Offsuit, mint
  already means "your turn" and "gain"), not that green is un-premium.
- **What green does better:** both raters credit it with an instant sense of place. `sports` keeps green only
  as the "you" accent wash. A faint green glow under the board is a cheap option if the user misses it.
- **Port notes for `sports`:**
  - The condensed figures need SF Pro's width axis in Electron. Chromium's `-apple-system` doesn't expose
    it; the mock loads `SFNS.ttf` via `@font-face`. Alternatively bundle SF Pro Condensed under Apple's
    licence, or fall back to the regular width.
  - If the condensed figures ship, adopt them for the Home bankroll and the Charts/Drill stats too, so they
    belong to the system, not one screen. This is a fork for the user.
  - The e2e pot pin (14px/500) and the to-act pin must be updated.
  - The table loses its oval, so `screens/table.ts` positions seats as row cards. The rows rule, the bet placement and the compaction tiers in `demo/glass/table-seats.js` port as a pure function of the seat count and the stage size. It belongs beside `seatPositions.ts`, and it would also let the multiplayer screen's list become a table.

## Round 3 — system decisions
- **The coat's blur never rendered in round 2.** An independent rater found the desktop's contour lines showing
  crisp through the "frosted" coat. A probe confirmed it: with and without `backdrop-filter`, the round-2
  pixels were identical (mean diff 0.00). The cause was the desktop at `z-index:-2` plus the grain as
  `.shell::after` with `mix-blend-mode`; together they make Chromium drop the coat's backdrop at DPR 2. The fix
  is explicit stacking (desk 0 · coat 1 · grain 2) with the grain on its own element.
  - The blur is set to **18px**: the dunes still read and contours stay faint, so no text sits on a crisp
    line. 14px left contours under body text; 26px erased them.
  - The background artwork, colours and grain are unchanged.
- **Glass is perceptible where it floats.** Floats went from an 84% dark slab to a lighter grey glass at
  `oklch(.32 / .34)` (dock, tray) and `oklch(.27 / .62)` (sheets), `blur(26px) saturate(175%)`. The first
  iteration (58% dark) still read as a slab to the blind raters. A 0.5px gradient rim (22% → 4%) and a 20% top
  highlight carry the shape instead of opacity. The felt and rail now show through the dock. Glow, thick rims and saturation stay out.
- **Type scale:** caption 11 · footnote 12 · body 13 · headline 15 · title3 17 · title2 22 · stat 28 · hero 34.
  - The 40, 20, 10 and 9px orphans are gone.
  - Labels are 12/500 ink-2 and captions are 12/400 ink-3, so there are two roles, not four.
- **Radii are concentric:**
  - 4: cells, keycaps, tags
  - 6: thumb inside an 8px track
  - 8: controls
  - 12: inset groups
  - 14: dock and tray (8 + 6 padding)
  - 20: sheets
- **Control heights:** 28 (small: segmented, presets, tertiary) and 32 (regular); 36 only for the Home CTA.
- **Button ranks:**
  - **primary:** bone, with a hover → press ramp `#FAF8F3` → `#E2DFD6`
  - **secondary:** fill 8 → 13 → 18% with a top light and a 0.5px edge
  - **tertiary:** plain, then 8 → 13% fills
  - **disabled:** no fill and no edge, ink-3
  - **focus:** one 2px ring everywhere, including the slider thumb and rows
- **One selection material**, a sliding thumb shared by tabs and segments. Secondary lists (the Train
  sub-nav, drill kinds) use a quieter fill-1 with no shadow.
- **Colour role map** (in tokens.css):
  - neutrals carry the structure
  - bone = physical objects and the one primary action
  - mint = your turn, positive deltas and an ON switch (never a balance)
  - coral = serious severity, a wrong value, negative deltas
  - amber = notable severity and the gate timer
  - felt green = the table only
  - desk bands = the background only
- **Containers:** inside the coat, only actionable lists (New session / Play with friends, Recent hands, the
  tally) are inset groups. Informational sections (Suggested next, the plan table, chart classes) are flat
  hairline lists. The blind raters flagged translucent cards that don't float.
- **To-act:** a soft pool of light on the felt plus the mint status, with no coloured outline on the seat.
  This changes the e2e pin for the to-act mint shadow and scale; see port work.
- **Chart boundary:** a corner notch, because a ring reads as keyboard focus.
- **Motion:**
  - the deal
  - sliding selection thumbs
  - quip fade, bet slide, dock rise and sheet rise
  - a meter grow and a gap reveal
  - staggered chart cells and the drill reveal
  - a breathing your-turn dot
  - reduced motion stops all of it except the gate's functional 8s timer, which round 2 broke
- **Shortcut hints** are trailing keycaps, and only on real hotkeys.
- **Deal** is 420ms on a soft spring with a 45ms stagger. The raters found 640ms sluggish for a UI.
- **Focus** is a 2px ring at a 2px offset everywhere (1.5px on fields).

## Round 3 — element change log (problem → change → rationale)
| Element | Problem (from the before-rater) | Change | Rationale |
|---|---|---|---|
| `nav-bar` | 11 equal tabs, flat strip, no window inset | Traffic-light inset; the coat runs under the toolbar (unified title bar) with one hairline; tabs grouped play/study/you with short 12px dividers; one sliding selected thumb | Hierarchy without hiding any of the 11 real tabs; macOS window grammar |
| `wordmark` | 13/600 text plus a soft Unicode ♠ | 14px SVG spade mark at cap height plus a 15/600 wordmark; mark only below 1040px | A brand anchor and a crisp glyph |
| `tab-active` | Flat pill with no edge; a different selection style from segments | Shared sliding selected thumb (fill 20% + 16% top light + 0.5px edge + shadow); press darkens | One selection material everywhere |
| `tab-inactive` | Hover 3.5% was invisible; no press state | Hover fill-1 (8%), press fill-2 (13%); labels raised to ink-2 #C0C6CD | One state ramp |
| `bankroll` | 40px orphan size; mint spent on a balance | 34/600 ink-1 figure with a baseline-aligned mint +840 delta (mint = positive delta) | Colour role map; type scale |
| `depth` | Read as a second headline; mixed label styles | 15/500 value + the shared 12/500 label on the same stat component and baseline | One stat component |
| `suggest` | The primary action looked like a heading; Skip looked like the button | A plain hairline section: action row (title, body, chevron) whose hover rect bleeds into the gutter so text sits on the section edge; Skip as a small secondary button | A clear primary → tertiary order |
| `skip` | More button-like than the primary; faint states | Tertiary (plain) button on the shared ramp | Button ranks |
| `tiles` | No affordance, asymmetric padding, a blue UA focus ring | One inset group (3% fill) of two rows: icon tile, title, one-line caption, chevron, row hover/press, inset focus ring | Apple grouped-list grammar |
| `recent` | ~300px dead zone; static-looking rows | Rows in a 3% inset group that hugs its content: hover, chevron, 13/500 amounts, #index in ink-2 | Rows read as openable; no void |
| `mini-cards` | 9px suit; sticker shadow; outshouted the row | A dedicated 24px mini card (rank 12 over suit 11, centred), toned bone, small contact shadow | Optical small size and quieter emphasis |
| `results` | 13/400, lighter than the cards | 13/500 tabular amounts with the U+2212 minus; mint/coral by the role map | The outcome leads the row |
| `plan` | Seven tiers; segments unlabeled and run together | Title row; Length/Mode beside their labels; flat hairline table and footer; CTA with a vertically centred caption; coat blur 18px so no crisp contour sits under text | Form-style grouping |
| `segmented` | 12px labels; invisible track; jumping thumb; no hover/press | 13px labels in ink-2 #C0C6CD, a 3% track with an edge, the shared sliding thumb (220ms), hover/press fills | NSSegmentedControl fidelity |
| `plan-rows` | Four type styles per row; crowded fixed columns; zeros read active | Flat list: label · pct · min · count; zero rows in ink-2; notes indented 16px | Fewer styles; clear zero state |
| `gave-up` | Read as a footnote; values misaligned with the table | Section label + a flat two-column row (label, value) and a caption footer | Aligned values, honest grouping |
| `start` | A two-line marketing-card pill; radius 10 off-scale; hover = press | Single-line large primary (36px, r8), a stronger top highlight and a soft drop; caption vertically centred beside it | One primary-button spec |
| `felt` | The ±45° crosshatch read as a screen door | A single-direction 0.5px weave at 3.5% plus finer noise; the lamp 7.5% → 9% | Wool, not mesh |
| `rail` | Flat black band; invisible inlay | Top-arc sheen 13%, a bottom shade, a 1.5px top light at 16%; the rail casts onto the felt | One plausible light source |
| `villain` | Cards centred against a 3-line block; four sizes | Cards top-aligned to the name; 13/600 name, 11/500 archetype and 12px quip in ink-2 (AA on felt), 13/500 stack; deal 420ms spring | A tighter type ramp |
| `villain-name` | Placeholder-looking 'Unknown'; three sizes | The archetype is an inline 11/500 ink-2 suffix (real hidden label kept) | A quieter suffix, one line |
| `quip` | Synthetic italic as bright as data; static | Regular 12px ink-2 in curly quotes; fades in after the deal | Flavour text recedes |
| `card-backs` | The lattice read as a mesh; double ring mushed | Fine ±60° lattice + 16% spade monogram, soft sheen, single frame; deal 420ms with a soft spring | Calmer pattern |
| `bet` | Floated alone; no motion | On the seat→pot line, 13/600 amount, slides in; crisp chips (no CSS filter blur; the contact shadow is drawn in the SVG) | Physical logic |
| `pot` | 'Pot' label as bright as the value | Label 12/500 ink-2, value 17/600 | Label/value hierarchy |
| `board` | (scored 8+) | Unchanged artwork; deal 640 → 420ms with a soft spring, 45ms stagger | — |
| `slot` | Flat dark rectangles crossed by the twill | Deeper inset well (24% black, inset shadow, bottom lip highlight), above the weave; aria-label 'turn/river, to come' | Reads as a recess |
| `price` | The key figure was the quietest text | 13px with the two figures in ink-1/500 | Decision-relevant numbers lead |
| `hero-cards` | (scored 8+) | Unchanged artwork; deal 420ms spring | — |
| `hero` | No seat treatment for 'it's you, now'; 10px dealer inline | Type on the felt; your turn = a soft light pool + the mint status; dealer puck tucked on the left card's corner | One clear to-act treatment |
| `dealer` | 10px under the floor; flat disc inline in text | 22px disc, 11px/700, inner rim + top light, on the hero's card corner; arrives with a 420ms spring | Type floor; real button shape |
| `your-turn` | A 12px line with no cue | 13/500 mint with a slow 2.4s breathing dot (off under reduced motion) | The most important state reads first |
| `blinds` | Different baseline from the right-hand controls | 12px ink-3 metadata on the same 28px row as the controls | Alignment |
| `coach-stats` | Mode toggle read as plain text; no pressed state | 'Coach' is a real switch whose track fills mint when on (role map: mint = an ON switch); Stats a tertiary text button 16px away | macOS toggle grammar |
| `dock` | 84% slab with no refraction; non-concentric radii; three button styles | Lighter, thinner glass (L .32 at 34%, blur 26 / saturate 175%), a 20% top highlight and a gradient rim; r14 = 8 + 6 | Visible glass and one control system |
| `fcc` | Disabled Check looked enabled; faint states | Secondary ramp (8/13/18%); disabled Check keeps a quiet hairline container and ink-3 text | Distinct states |
| `hints` | 'Call 75 C' read as an amount | Trailing keycaps (18px, r4, edge + bottom shade, ink-1 glyph); only real hotkeys get one | Unambiguous shortcuts |
| `slider` | No focus; value detached; flat thumb | Track fills to the thumb centre; thumb rim + top light, hover/press scale, focus ring; value in a fixed 40px tabular slot with 8px trailing space | System-grade slider |
| `presets` | Loose ghost text, tiny fractions, no states | Small segmented group (½ ¾ at 15px, Pot, All-in) with aria-labels; the All-in shortcut in its tooltip; a 2px focus ring at a 2px offset | Grouped presets |
| `raise` | Hover = press (pure white) | Bone ramp: hover #FAF8F3, press #E2DFD6, 0.5px dark edge | Press feedback |
| `tray` | Slab; 13px question; mixed heights | The same thin float glass; 15/600 question; 28px controls; Sure/Guess in title case (the app uppercases in code) | Glass plus aligned controls |
| `gate` | Slab; dead space; field ≠ button height; the timer broke under reduced motion | Sheet glass over a strongly dimmed, blurred table (no bloom); 32px field + button; a 1.5px focus ring at a 2px offset; budget as a progressbar; the timer exempt from reduced motion | Material, a11y and a functional timer |
| `verdict` | About 10 tiers; coral three times; no primary; ring at rest | Two groups and one primary Close; coral only on severity + tick; table dimmed to 30% behind (no bloom); support at 56ch | One headline, one visual, one action |
| `severity` | Text only | A 13px warning glyph + 'Serious' in coral; no light behind the header | Not colour alone |
| `meter` | 1px tick; no scale; the gap was not shown | 4px bar: dim fill to the price, bright band for the surplus over it, 2px coral price tick, 0/100% endpoints | The insight is the gap |
| `committed` | Small grey line | 12px lead-in 'You committed to Fold, Sure' above the neutral result (the result keeps the app's 'SURE') | Calm hierarchy |
| `support` | Dense, repetitive engine copy | 12px ink-2 at 1.55, measure capped at 56ch; copy verbatim | Readable support tier |
| `grid` | Dashed outlines shouted; 9.5px floor; three boundary channels | Three states: open 26% flat, fold 3.5%, boundary = a 10px corner notch; 11px; row-staggered fade-in | One channel per meaning |
| `cells` | Keycap-like edge on open cells; dashed corners | Flat cells with a ≥1.6:1 open/fold luminance step; boundary corner notch; hover lift | Crisper data |
| `legend` | Dashed checkbox swatch; mismatched radii | Three swatches matching the cells (with a hairline), boundary shown with the same notch | Legend = data |
| `charts-side` | Everything 12px; ragged wraps; button-like chips | Wider 288px column; classes as a flat list (name, cells, score; description below); rules 13px; tags; scrolls with an edge fade | Hierarchy and honest non-interactive tags |
| `quiz` | Key before the label; hairline crossing the text | Horizontal group (no separators); trailing keycaps 'open O' | Consistent shortcuts |
| `drill-subnav` | Selection identical to the top tab; jump | Source-list selection (fill-1, no shadow) distinct from the toolbar thumb | Secondary nav reads secondary |
| `drill-kind` | Chips wrapped to two rows; a third selection style | One level-2 picker with a checkmark and the session tally trailing each kind, plus an 'All kinds' total (no duplicate list) | Lists, not wrapping chips |
| `drill-q` | (material only: wallpaper crisp behind text) | 22/600 title on the now-frosted coat | — |
| `drill-result` | Coral twice; stat styling differed | Band sentence 15/600 ink-1, coral only on the wrong value, the shared stat component, a 320ms reveal | Colour role map; one stat |
| `drill-method` | Small numbered circles fine; spacing tight | Tertiary tabular numerals inside the content edge, 13px at 1.5 | Rhythm |
| `drill-next` | Hover = press | Bone ramp, trailing keycap ↩ | Button spec |

## Why round 1 read as tacky (diagnosis)
- **Every element was its own pane.** Nav, four seats, toolbar chips, quip, bet chip, pot, dock, tray and
  sheets each had a blur. That came to about 12 stacked `backdrop-filter`s. Modern material uses 2–3 per
  viewport, and Synara documents why: a blur over a blur samples its own coat and turns into a slab.
- **Uniform heavy blur and saturate(180%) on everything**, over a backdrop that was itself blurred and
  saturated. The result looks plasticky, not like a material.
- **A saturated teal felt and mint/indigo light pools.** It read like a gaming-site gradient, not a room.
- **Glow as emphasis:** a 1.5px mint ring plus a 28px glow on the hero, mint glow under the primary button,
  and mint dashed boundaries. Glow is the dated 2021 glass-card tell.
- **Thick, bright specular rims** (a 38%-white gradient ring) on every pane. Real glass edges are nearly
  invisible: Foundry uses 12% white and an 8% inset highlight.
- **Template chrome:** an all-caps tracked label on everything (UNKNOWN, POT, SUGGESTED NEXT, COACH),
  kbd chips on every button, a mint app-tile logo, gradient "candy" buttons and blue/green toy chips.
- **One radius and one shadow on every card-shaped thing**, the SaaS-card kit.

## Direction (round 2)
- **One coat, a few floats.** The whole window is a single translucent coat over a dark, low-chroma
  "desktop" (simulating macOS under-window vibrancy). Everything inside the window is clear and divided
  by 0.5–1px hairlines. Glass, meaning fill plus blur, is spent only on things that float over content:
  the action dock, the commit tray and the modal sheets. That makes **at most 2 blurred layers per
  viewport.**
- **The table is the one bold thing.** It is real cloth: a deep, desaturated spruce wool with a fine woven
  grain, lit from above by a soft pendant pool, inside a matte black rail with an inlaid hairline. Seats
  are not boxes; they are type set on the rail (name, stack, status) beside the cards.
- **Cards are objects.** Bone faces with a 0.5px edge and a two-layer contact shadow that sits on the felt.
  Indices are in the system serif (New York) and the centre pip is large. Backs are ink with a fine
  low-contrast line pattern.
- **Almost monochrome.** Ink, graphite and bone. Mint `#3DDC97` (the pinned role) appears only for "your
  turn" and positive numbers. Coral and amber appear only as text for severity. The primary button is
  bone-on-ink (Apple dark style), not a mint gradient.
- **Type:** SF Pro at native tracking (Synara's rule), with tabular figures. Sentence case everywhere, no
  all-caps labels. Hierarchy comes from size and weight steps: 11 / 12 / 13 / 15 / 20 / 28.
- **Motion:** one orchestrated moment, the deal on load. Everything else is response motion: colour
  transitions on hover, a press dip, and sheets that rise when opened. No hover lifts on tiles.
- **Dark only this round.** Light was optional and is dropped. Round 1's light work is in git history.

## References → what I took from each
- **Synara** (`tests/tmp/synara`, read-only):
  - "whole-window glass": the body carries ONE translucent coat and nested surfaces go transparent.
  - never stack `backdrop-filter`: a measured 30% coat rendered at 59%.
  - floating composer at popover 55% with `blur(40px) saturate(150%)` on a `::before`.
  - hairlines at white 4–5%.
  - monochrome oklch greys for charts.
  - native SF tracking.
  - muted text is translucent ink, so it is never dimmed twice.
- **Foundry** (`/Applications/Foundry.app`, `src/foundry-glass.ts` read from app.asar):
  - `vibrancy: under-window`, with background at oklch(0.13 0.028 262) / 50% and cards at 65%.
  - floats at 85% with `blur(24px) saturate(180%)`, edge white 12%, highlight `inset 0 1px 0` white 8%.
  - shadow `0 16px 40px -8px` at 55% plus `0 2px 8px` at 30%.
  - blur only on surfaces that cover content.
  - an opaque fallback at 97% under `prefers-reduced-transparency`.
- **"More premium than Foundry"**, in the specifics:
  - film grain on the coat so the blur is not plasticky.
  - a woven felt with a lamp pool instead of a flat surface.
  - real card objects.
  - fewer floats than Foundry's chrome.
  - a serif index on the cards as the one typographic flourish.

## Decisions to evaluate
- Seats move from the real top row to an oval, set as type on the rail rather than boxed. If overruled, keep the
  row: the cards and felt still carry the look.
- Coach and Stats leave the action dock for the table's top-right corner. If overruled, the dock carries 11
  controls and is tight at 900px.
- In coached mode the commit tray **replaces** the dock until the player commits (the real app stacks the
  tray above a disabled bar). If overruled, stack them, and shrink the hero seat at 900x640.
- The gate and verdict are **bottom sheets** that rise over the dock slot and fully cover the hero row. The table
  behind them recedes (blur 5px, 62% brightness), so a sheet edge never cuts crisp content. The verdict adds a
  pot-share-vs-price meter and a Close (Esc) button. If overruled, both become inline strips above the dock,
  with no dismiss.
- Cards get bone faces with serif indices (the app ships dark faces). If overruled, use dark faces; the felt
  and rail still carry the table.
- Charts open cells are graphite on an opaque base. Bone is reserved for real cards, and the base stops the
  wallpaper from tinting data cells into a fake heatmap. If overruled, use bone cells, and expect a white wall
  at 1100x760.
- **Table surface:** `sports`, with a scoreboard rows layout up to 9 seats, is recommended over the refined `glass` oval (8 vs 7 overall, scales 7.83 vs 7.33) and over round-3 green. If overruled, ship `glass` with its ring layout and accept the lower fit score; or keep green, accepting the fit cost two earlier raters measured.
- **Green glow under the board:** not adopted (it lost in both A/B pairs). If overruled, `&glow=1` is ready on either surface.

## Open questions
- Can Electron get the real look? The mock fakes vibrancy with a CSS "desktop" (dune bands with contour
  lines). In the app this needs Foundry's `vibrancy: 'under-window'` plus a transparent window. Default taken:
  the mock simulates it, and porting needs that main-process change.
- Theme-block rule: styles.css forbids changing `--text-hi`/`--positive` in a theme block. Default taken:
  both keep their pinned values. The coat itself cannot come from a paint-only block (see port work).

## Contrast (WCAG AA)
- Measured on rendered pixels with the text hidden (`tests/tmp/glass-contrast.mjs`). Results are in
  `demo/glass/contrast.md`.

## Mock-only vs port work
- **Mock-only:**
  - static markup with a hard-coded hand (blinds 25/50, hero on the button, flop 4♠ 4♦ K♦, hero K♥ 2♦, Bo
    bets 75)
  - no engine; the deal animation plays once on load
  - `?state=live|predict|gate|verdict`
  - dark only
- **Real copy kept:**
  - `predictPanel.ts` and `predict.ts`
  - `coach.ts`, `coachPanel.ts`, `confidence.ts` and the `table.ts` GATE
  - `tableTalk.ts` in-hand quips, using the engine's own pick `IN_HAND_LINES[action][(seat.id + board.length) % 6]`
    on the flop: Ada "I’ll wait.", Bo "Let’s make it interesting.", Cy "I’ll let this one go." These replace
    round 1's invented status lines.
  - `jitter.ts` hidden archetype "Unknown"
  - `recommend.ts`, `home.ts` (the bankroll is plain digits; round 3 shows it in neutral ink with a mint
    "+840" delta, where the app colours the whole figure — see port work), `sessionPlan.ts` and `standing.ts`
  - `charts.ts`, including the class-accuracy "—" column
  - `drill.ts` ("Next problem — Enter" is shown as "Next problem" plus an ↩ keycap)
  - `preflop.ts` `RFI_SPECS.CO` and `BOUNDARY_COMBOS.CO`
- **The gate follows `table.ts`:** the fold is committed but not applied while the gate is open, so the hero
  stays unchanged. The fold lands when the verdict shows.
- **Invented for the mock** (not app copy):
  - the table corner text "Blinds 25/50"
  - "75 to call, a 25% price"
  - the hero's "Your turn" / "Folded" line
  - the empty turn/river card wells
  - the sheets' "Coach" and "Serious" labels and the "On the flop, you folded to 75" context
  - "You committed to Fold, Sure"
  - the meter
  - "Ada and Bo play the hand out behind this sheet" and the Close/Esc footer
  - the gate note "The verdict appears when you answer, use both attempts, or the bar runs out."
  - the key hints (F, C, R and A are real hotkeys; A moves to the All-in tooltip). The charts quiz shows
    "open O" / "fold F" where the app writes "O open" / "F fold".
  - the window chrome: traffic lights, the spade mark and the grouped tab dividers
  - the "+840" bankroll delta, the plan's "Length"/"Mode" labels and the charts "cells · score" header
  - "Sure"/"Guess" in title case (the app calls `toUpperCase()` in `predictPanel.ts`)
  - the merged drill kind list with trailing tallies (the app shows kind chips and a separate tally)
- **Port work:**
  1. Main process: Foundry's `vibrancy: 'under-window'`, `visualEffectState: 'active'` and a transparent
     background, so the coat frosts the real desktop, plus `titleBarStyle: 'hiddenInset'` for the inline
     traffic lights. A paint-only theme block cannot produce the coat. Layer order matters: the round-2 bug
     (a blended `::after` on the coat silently disabling `backdrop-filter`) applies to the renderer too.
  2. Paint: one `html[data-theme='glass']` block with the tier-2 names (`--text-lo`/`--text-lo-2` = the
     measured `--ink-2`/`--ink-3`, `--suit-red` = coral, `--rule`/`--edge` = hairlines). `--surface*` stays
     near-opaque for the roughly 60 renderer rules that use it without a backdrop.
  3. Component rules:
     - the coat on the shell, plus `.float` for the action bar, the predict panel and the coach sheets
     - the oval table, rail and felt in `screens/table.ts`
     - seats as type
     - bone card faces in `components/card.ts`
     - the tray/dock swap
     - bottom sheets with focus handling
  4. e2e pins this breaks or must update:
     - the pot (14px/500 pinned; the mock uses 17px/600)
     - Fold `box-shadow: none` (the mock has an inset hairline)
     - the to-act mint ring with `rgba(61, 220, 151, 0.4)` and scale 1.02 (the mock replaces it with a felt
       light pool, a breathing dot and mint text)
     - the bankroll's whole-figure net colour (`data-direction` is kept; the colour moves to the delta)
     - the predict confidence labels' casing, if any spec matches "SURE"/"GUESS"
     - the winner ring's mint `border-top-color` (not mocked)
  5. A GPU check: the coat plus at most two floats in Electron.

## Multiplayer: an unpredictable, checked deal and relay protocol v2
The revised design in `research/TECH-MULTIPLAYER.md` §3.1–3.2 (branch `vision-tech-research`, after review
R5–R7, R13), built. Solo play is unchanged: it keeps the seeded `mulberry32` and every e2e seed.

### The deal
- **A hosted room has no seed.** `RoomState.seed` and `CreateRoomOpts.seed` are gone and `main.ts` no longer
  passes `seed ?? 1`. A room deals only from an injected deck (`startHand(state, deck)`); the seeded shuffle
  is the solo path alone.
- **Secrecy: a CSPRNG order the host keeps.** The host shuffles 52 cards with `node:crypto.randomBytes`
  (unbiased Fisher–Yates, rejection-sampled 32-bit draws), injected into core as `DealCrypto` so core stays
  crypto-free and runs under vitest unchanged.
- **Commit before reveal, with guest entropy** ([dealCommit.ts](/Users/pranavgk/Documents/scratch/temp/Poker/src/core/dealCommit.ts)):
  1. The host publishes one salted SHA-256 leaf per committed position (`H(domain‖nonce‖hand‖j‖card‖salt)`,
     16-byte salts, a fresh 16-byte nonce per attempt), the dealer and the deal order.
  2. Every guest commits to 32 random bytes; the host publishes the full set; every guest checks its own is
     in it, then reveals.
  3. The revealed entropy, with the leaves, dealer and deal order, derives a public permutation `sigma`
     (SHA-256 counter stream) mapping the k-th card dealt to committed position `sigma[k]`. The host fixed
     its order before `sigma` existed, so it cannot place cards; each guest's guarantee needs only its own
     entropy to be honest.
- **Per-card openings, no full reveal.** Every state message carries an opening (card + salt) for each card
  its view shows. The guest computes k itself from the canonical deal order (holes round by round from the
  deal order, then burn/flop×3/burn/turn/burn/river), never from the host. Unseen positions are never
  opened, even at hand end: that would hand every guest the mucked hands (review R6.3).
  Supersedes: verifying "the full deck at hand end", because the only full check is a full reveal; the guest
  instead checks every card it saw, and that no card is opened twice.
- **What a guest raises** ([relayGuest.ts](/Users/pranavgk/Documents/scratch/temp/Poker/src/core/relayGuest.ts)):
  a violation (the session ends) for a card that does not open its leaf, a card shown without an opening, a
  card opened twice, a changed card, a lied deal order, reveals that do not open the published commitments,
  its own entropy left out of the set or the deal, a replayed nonce or hand, a malformed view, a hidden or
  moved seat, or any hole or turn shown for a hand with no completed handshake (showdown hands excepted).
  Its seat is learned once and held, so the host's `isYou` cannot switch checks off. A warning for a deal
  restarted after it revealed: kept on the table (`mp-warning`) until it leaves, not cleared by the next
  state. Supersedes: excluded entropy as a warning, because a host could then choose `sigma` with a
  made-up seat's entropy (review A1).
- **Aborts are visible, not prevented.** A host that dislikes `sigma` can still restart the deal; the guest
  is warned each time and the warning stays on screen. A guest that stays silent for 10 s
  (`ENTROPY_TIMEOUT_MS`) or reveals badly is removed from the table and the deal restarts, so one guest
  cannot stall it. Supersedes: leaving such a guest out of the deal's entropy, because an honest host must
  never deal around a guest (see A1 above).
- **A seat freed mid-hand keeps its cards from a newcomer.** Found by the reconnect test: a player who took
  a seat freed mid-hand was shown the leaver's hole and could act with it. `RoomState.dealtTo` now records who
  each hand was dealt to, from the players who received that deal's commitment; only that player sees or
  plays it (red test: `multiplayer.test.ts`, "a seat freed mid-hand").
- **Seats follow the people in them.** At each deal a seat whose player left sits out (its chips leave with
  the player; dealt in, the table would stall on its turn), and a seat taken by someone new since the last
  deal (`seatedAt`, recorded for every seat, dealt in or not) is bought in at the starting stack. A busted
  player who stays stays out, so no chips are created. No deal is committed with fewer than two funded
  seats.
- **A player who leaves mid-hand is folded when the turn reaches their seat** (`foldAbsent`, through the
  engine's own fold), so a Wi-Fi drop never freezes the table.
- **A guest's out-of-range bet is an error, not an exception** in the host's socket handler.

### Transport: relay protocol v2
- **TLS 1.3 only, a fresh self-signed P-256 certificate per hosted table**, built in
  [selfSignedCert.ts](/Users/pranavgk/Documents/scratch/temp/Poker/src/main/selfSignedCert.ts) (hand-rolled
  DER: `node:crypto` signs but cannot issue a certificate, and no dependency may be added).
- **The invite link** is `offsuit://join?host=…&port=…&fp=<SHA-256 of the cert, base64url>&token=<128-bit,
  base64url>`, one per LAN address. The join box takes the whole link; a bare `host:port` is refused.
- **The guest pins the fingerprint before sending a byte** (`rejectUnauthorized: false` because nothing here
  trusts a CA; the pin is the whole check, and the TLS handshake proves key possession). A mismatch says so
  and never sends the token.
- **Nothing reaches an unauthenticated socket.** The first frame inside TLS must be `hello {v, token,
  name}`; the token is compared in constant time; until then the socket is not seated and is sent nothing.
  Five bad tokens from one address shut that address out for the table; a socket with no hello is dropped
  after 5 s; one address may hold at most 4 sockets that have not yet said hello, so a tokenless peer
  cannot fill the 32 slots (review A8). The 128-bit token is the real defence (one guess per TLS
  handshake).
- **Version 2, and mismatches are told plainly.** A v1 plaintext client is recognised by its first byte and
  gets a v1-framed `error` it can display; a hello with another `v` gets "This table runs relay protocol v2
  and your app sent vN"; a v2 guest pointed at a v1 host reports that it could not open a secure connection.
  The renderer's `parseJoinAddress` stays as the host/port check inside `parseInvite`.
- **A closed table's invite is dead**: a new table has a new certificate and token. A guest that leaves can
  rejoin the same table with the same invite.

### Network observation (reviews R5, R13)
- **Main-process network oracle** ([netOracle.ts](/Users/pranavgk/Documents/scratch/temp/Poker/src/main/netOracle.ts)),
  test mode only (`OFFSUIT_NET_ORACLE=<file>`), imported first by `main.ts`: it records `net.Socket#connect`
  (net, tls, http, https and fetch all funnel through it), `net.Server#listen`, UDP sends, DNS lookups and
  every `child_process` entry point, flagging network tools. It records and never blocks.
  `no-network.spec` now requires zero egress records over its sitting, with a positive control, and
  `multiplayer.spec` requires no listener while multiplayer is off.
- **WebRTC:** `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` in `silenceChromium`, the same
  policy on every webContents, and the `RTCPeerConnection` family deleted from the page before any renderer
  code runs (`sealWebRtc.ts`). Measured (evidence `webrtc-probe.txt`): before, a page gathered a host
  candidate per interface and sent 16 STUN packets; after, none of either.
- **The tutor guard reads spelled-out numbers** (check `number-words`: compounds, tens words, unit-bearing
  words, `1k`), kept separate from digit provenance so the agent's post-reveal path, which replaces that
  check with phrase checks, still runs it (review A9). "a dozen" and fractions are not read.
- **`sandbox-exec` was not added.** The in-process oracle covers the stated paths; an OS-level run is an open
  question.

## Tests and environment
- No failing-first test applies: no defect is repaired and nothing under `src/` changes.
- No automated test covers the visual design. The evidence is the DPR-2 JPEG captures, the capture guard and
  the contrast measurement (also DPR 2). The guard's sheet rule was negative-tested
  (`tests/tmp/probe-guard.mjs`): with the recede filter removed it flags Ada, Cy and the bet.
- `npm run typecheck` passes. `npm test` passes (85 files, 1796 tests).
- `npm run e2e` fails, all 540 tests, at `electron.launch`, because `node_modules/electron` is half-installed
  in this checkout. This is environmental, not caused by the branch. Reinstalling was out of scope.
- Captures use Playwright's cached Chromium 1243 headless shell through `executablePath`. Nothing was
  installed. Synara was shallow-cloned read-only: nothing installed and none of its scripts run.
  Foundry's asar was read by a dependency-free script; nothing in the .app was modified.

## Pro and licensing (branch `feat/pro-licensing`)

- **Merchant of record: Stripe Managed Payments**, sold direct (not the Mac App Store at launch); fallback Gumroad.
  Stripe's restricted list ties every games line to "a monetary or material prize", so a play-money trainer with
  no prizes is allowed (re-fetched 2026-10-12; page updated 2026-09-22). Paddle is cheaper (5% + 50¢) but bans
  "games of chance" with no prize qualifier. Full comparison and sources: `research/TECH-PAYMENTS.md`.
- **Model: monthly and annual Pro subscription.** No one-off licence at launch: ranked play, seasons and sync are
  running costs. The token format still allows a perpetual licence (`exp: null`) if one is ever sold.
- **Our own Ed25519 tokens, not provider licence keys.** `OFFSUIT1.<claims>.<sig>`, claims
  `{v, kid, lid, tier, plan, iat, exp, seats}`, signature over the prefix and payload. Public keys are embedded per
  `kid` (rotation: add a kid, keep the old until its tokens expire); a revoked-lid list covers refunded perpetual
  keys. Stripe has no licence keys, and the online server exists anyway.
- **Main is the only authority.** It verifies with node:crypto, and on every save it replaces the renderer's
  `progression.entitlements` with its own, so a devtools edit or a doctored save grants nothing. Pro work runs
  behind `gated(authority, feature, handler)` IPC handlers. Devtools are off in a packaged build.
- **Dev key and override only when unpackaged.** The throwaway dev private key is committed
  (`scripts/dev-licence-key.json`) so tests can mint keys; `keyring(app.isPackaged)` drops its kid in a packaged
  build, and `OFFSUIT_DEV_TIER` is ignored there.
- **Offline grace: 14 days after `exp`**, then Free. Supersedes the research draft's 7 days with a daily refresh,
  because the app never calls the network by itself: "Check for renewal" and "Restore" are buttons.
- **Clock: licence time = max(system clock, high-water mark, token iat), and the mark also advances by the time
  Offsuit runs (a monotonic clock).** A rollback never revives an ended licence, and with the clock held back
  licence time still ticks at the app's pace. The learner is told only past 36 h. A stored mark out of range is
  ignored, never allowed to zero the guard. Only the licence server's SIGNED time (`OFFSUIT-TIME1.<now>.<lid>`, in its
  refresh/restore reply) lowers a mark a fast clock pushed ahead. Supersedes "a newer token resets the mark", because the review showed any
  paste with the clock set back could then revive an expired key.
- **A key never downgrades the installed one.** Installing (paste or deep link) refuses a key whose paid period
  and grace have ended, a key issued earlier than the valid key in place, and another licence that ends sooner.
- **Persistence: additive, no schema bump.** `progression.entitlements` gains `licence` and `highWater` (older v2
  builds carry them). `tier`/`granted` stay as a display cache. The token and mark are mirrored in
  `offsuit-settings.json`, so deleting the profile (starting over) keeps the purchase and the rollback guard.
- **Seats are carried, not enforced offline.** The online server counts activations for the features that need it.
- **Network: one origin, armed per request, measured by both oracles.** The loopback proxy sees exactly the one CONNECT after the press; the main-process oracle (`netOracle.ts`, from the deal-security work) sees no socket at all. Refresh/restore go through `licensingFetch` on an in-memory
  partition that admits only the configured licence server while the request is in flight. Checkout and
  "Manage or cancel" open in the system browser (`shell.openExternal`, recorded instead under e2e); the renderer
  names a plan, never a URL.
- **Deep link `offsuit://activate?key=` is a proposal.** Any page can open one, so the app shows the plan, date,
  key ending, whether it has ended and which key it replaces, and asks; Escape is a no. Confirm carries the id of
  the key shown, so a link that arrives while the dialog is open is never the one installed. The protocol is registered only by a packaged build.
- **Checkout opens only when a plan has a URL, a price label and at least one Pro feature has shipped**, decided in
  main (`checkoutPlans`), so the sheet's "checkout stays closed" is enforced. "Manage or cancel" shows whenever the
  portal is configured, key or no key.
- **Upgrade sheet copy:** the price before checkout, renewal and how to cancel on the same sheet, unshipped Pro
  features marked "Coming in an update" (checkout stays closed until one ships), learning named as never locked.
  Monthly is the default plan (the smaller commitment). No countdown, no urgency, "Not now" never re-asks.
- **Webhook server (`src/server/licensing/`):** Stripe-Signature v1, 5-minute window, event-id ledger; grants come
  from re-reading the subscription at Stripe, never from the event body; a token is minted only when the paid
  period moves forward (also past-due → active); events are serialised per subscription (multi-instance hosts need
  the same from their store). A FULL refund or a LOST dispute revokes the period it covered; a refund that beats the
  grant leaves a tombstone; a partial refund or an open dispute changes nothing; a later paid period re-grants.
  Supersedes "a refund or dispute is final", because a goodwill partial refund would have revoked a paying
  subscriber for good. Restore needs order id + email (stored only as a peppered
  hash), with one 404 for every miss.
