# Review: feat/story-campaign (Story mode "The Long Orbit", 2 commits)
Verdict: CHANGES REQUESTED (BLOCK: four act-on items)
Base: 729396997497c30dab168a9305ca1e350189aa4d  Head: 4b20d91ca5ad1e1ed5fa4f2177d54e2cc672f93a
Blast radius: MEDIUM (new feature surface plus progression data). Reviewed against AGENTS.md and the DECISIONS.md
"Story: the Long Orbit" section.

## Act on
1. **src/renderer/main.ts:1124 (with :1069). The Play tab shows the story table (D17 break).** `renderInner` keeps a
   chapter table only on the Story tab (:1069). Any other tab tears it down, but the Play branch falls through to
   `if (table) screen.replaceChildren(table.root)`. Scenario: open the Lighthouse, Sit down, click **Play**. The
   heads-up masked "Regular" table now sits under Play. Its hands keep feeding the rival file and the chapter judgement.
   Pressing Debrief runs `finish()`, which sets `storyView` to the debrief and calls `render()` with `tab === 'play'`, so
   the learner lands on Home and the debrief stays hidden until they click Story. Live play no longer means Ada, Bo and
   Cy. Fix: record who owns `table` (`'play' | 'story'`). Tear the story table down when `tab === 'play'`, or send the
   learner back to the Story tab. Add an e2e step (sit down at a chapter, click Play, expect Home or the solo table with
   4 seats).

2. **src/renderer/screens/table.ts:962-969. An all-in call is recorded as an all-in bet, which corrupts the dossier
   reads.** When a seat cannot cover a bet, `legalActions` offers `allin` instead of `call` (table.ts:366-372), and
   `callOrAllIn` returns `{ kind: 'allin' }` (archetypes.ts:209). The capture stores that as `kind: 'allin'`, with
   `potShare = seat.stack / state.pot`. Scenario: heads-up at 100bb, the hero shoves the river and the rival (equal or
   shorter stack) calls with nothing of their own. The record is a river "all-in, ~50% of the pot". `reads()` counts it
   as the rival's last aggressive action, so it adds a "big bet shown that was a bluff" and a "bet". It is missing from
   "late calls". Dee's take can then say "{bluffs} of {bigBets} big bets shown were bluffs" about a hand where the rival
   never bet. The file shows `River all-in 50% of the pot · held nothing of their own`. The read is still drawn from a
   showdown, but its content is wrong, and heads-up stack-offs are common, most of all at the Pier. Fix: when
   `seat.committed + seat.stack <= state.currentBet`, record it as `call` (`facingBet: true`, `potShare: null`). Pull the
   capture into a pure helper and unit-test it (all-in call, all-in raise, bet, raise-to sizing).

3. **src/core/story/scripts.ts:265-267, 273. "Held the price" is used for any free decision (D6), and Dee says
   something it has no fact for.** D6 reserves "Price held" (the wording and the `price-held` pose) for close spots on
   the right side of the price. `story.met.a` says "{free} of {judged} decisions held the price", with its Dry and Blunt
   variants, and `story.met.*` use the `price-held` pose. `{free}` counts every judged decision that cost nothing,
   including a free turn check. Scenario: a table of four free turn checks and one river call reads "4 of 5 decisions
   held the price" with the Price-held pose. `story.short.b` starts "Close spots, and a few over the price." Nothing
   checks closeness. A short table lost to one serious 30 bb over-call still gets "Close spots". That is the
   unbacked-claim class the Dee PR just fixed. Fix: change the wording to "cost nothing" and use a non-D6 pose
   (`rest`/`gate`). Drop "Close spots" or back it with a fact. Add a lint row banning "held the price" / `price-held`
   outside `event: 'price-held'`.

4. **src/renderer/screens/story.ts:659-661. The Home strip names a personalized leak with no data source** (owner rule:
   each personalized element cites its source). With a leak, the strip reads "Next: The Night Train, built from folding
   to bets the price said to call". It gives no hand count, cost, decision count or reach-weighted figure. The map and
   the chapter both show `routed.citation`, but the strip is the most visible surface and shows none. Fix: add the
   source to the meta line (for example "· from your last N hands", or `c.citation` as the caption on a second line).
   Pin it in story.spec.

## Consider
- **table.ts:1245-1268. A bust or a sweep at a chapter table says "start a new session" and the button reads "New
  session", but it opens the debrief.** `sittingEnd` only replaces the planned-complete branch. Scenario: the hero busts
  on hand 3, reads "Rebuy … or start a new session", presses New session, and gets a debrief judged on 3 hands.
  Tradeoff: one more conditional in two branches, against copy that misleads.
- **main.ts:503. A table abandoned midway deals the same cards next time.** `progress.tables` only increments in
  `recordTable`, so after leaving by another tab the next Sit down reuses `tableSeed(id, tables, seed)` and deals the same
  hands. route.ts:238 says "a replay deals a new table". The abandoned hands also stay in the dossier with no sitting.
  Tradeoff: persist an attempt counter at sit-down (additive), or accept repeat deals.
- **main.ts:595. A later-opened debrief rebuilds `focusSerious: 0`.** A short table that failed only on a target-kind
  serious mistake, reopened later, shows "Serious mistakes: 1" with no "of this table's kind". The caption no longer
  explains why the table fell short. Tradeoff: add `focusSerious` to `RivalSitting` (additive, parser clamps it), or
  drop the clause in the rebuilt view.
- **dossier.ts:59-61. A paired board plus one pair of the rival's own reads as "two pair or better".** For example the
  board is K K 7 4 2 and the rival holds 7x: category TwoPair is above the board's Pair, so the hand is `strong` and
  counts in "Bets shown down held two pair or better". Tradeoff: compare what the hole cards add (the evaluator's rank
  on top of the board's), at the cost of a slightly more involved helper.
- **No unit test reaches the table.ts story path** (`villainActions`, `potShare`, the showdown flag, `cast`/`seatReveal`
  labels). Only e2e touches it. Item 2 is the bug that gap let through.

## Noted
- `openChapter` (main.ts:492) logs an override every time a non-suggested chapter is opened, including a return from
  its own file. The list is bounded at 100. This matches N1 (logged, never refused) but repeats entries.
- styles-story.css:61 uses an `rgba(255,255,255,.6)` outline and :192 an orphan `border-radius: 2px`, outside the token
  set. storyArt.ts puts hex fills in SVG strings (a component, not a screen sheet, which matches the existing art
  pattern).
- story.ts:177 always says "hands" (plural), so 1 hand reads wrong. The renderer computes `GOAL_FREE_SHARE * 4` itself.
  That number is UI copy, not Dee.
- `tableSeed` is based on the constant `DEFAULT_SEED`, so every learner's first Lighthouse table deals the same cards.
  It is deterministic by design.
- The Library targets `free-fold` against an over-folder. The link between the leak and the rival is loose. It is a
  design call, not a defect.

## Dismissed
- *The dossier reads engine truth.* Proof: table.ts:884-897 sets `shown` only when two or more unfolded seats with hole
  cards remain at settle, so a fold-out winner's turned-up cards are excluded. `recordRivalHand` (dossier.ts:43) and
  `parseShowdown` (persist.ts) also require 2 shown cards, a 5-card board and 7 distinct cards. Actions are public
  table actions only.
- *Live table behaviour changed.* Proof: with `cast` absent, `seatNames = SEAT_NAMES`, the archetype draw loop is
  unchanged, `seatStreetProfiles`/`seatReveal` are empty, so `story` is false and the label, tooltip and quip paths are
  the old ones (table.ts:427, 456-474, 1505-1520). The Play-tab issue in Act-on 1 is a main.ts routing bug, not a
  table.ts one.
- *The mask leaks through the post-hand quip or tooltip.* Proof: `revealed` is false when `revealLabel` is null, so
  `quipFor` gets `null`, and `title` is gated on `!story` (table.ts:1513-1531).
- *Schema not additive.* Proof: `story` is a new key in `progression`, with a default, a tolerant parser (`section` →
  `parseStory`), `PROGRESSION_SHAPE` updated, unknown chapter/rival ids and results kept as strings (`effectiveResult`
  maps them on read), no `SCHEMA_VERSION` change. The progression round-trip fixture includes story.
- *Lost update between `saveStory` and `onHandComplete`.* Proof: `saveProgression` and `recordHand` both assign
  `session` synchronously before awaiting (main.ts:465, 646), and `onHandSettled` runs after `onHandComplete` in
  `finishHand`.
- *A lean lifts a structural zero.* Proof: `up()` returns 0 for 0 (route.ts:198), and the only absolute writes lower a
  value (`bluffBetFreq: 0`) or apply `max` to a non-zero `raiseFreq`. This is tested (story-route "a structural zero
  stays zero").
- *The goal counts chips.* Proof: `judgeTable` reads only `verdict.severity` and the leak kind, and the bankroll never
  enters `TableJudgement`.
- *Something is hard-locked (N1).* Proof: every venue button, every beat row and "Skip to the table" are always
  enabled. `resumeStage` only picks the opening beat.

## Verification
- `npm run typecheck`: exit 0.
- `npx vitest run` (full): 1 failure out of 2371, `perf.test.ts > evaluate() 200k hands` at 6927 ms, with load average
  ~31 (another e2e run was on the machine). Rerun alone: 7/7 pass. `story-*`, `progression`, `dee-bank`: 426/426 pass.
- e2e not run, as instructed. No screenshots taken.
- Untested by any suite: the table.ts capture path (`villainActions`, `potShare`, all-in-call classification), tab
  ownership of a chapter table (Play while seated), the bust/sweep end of a chapter table, an abandoned-table reseed,
  and the Home strip's citation.

## Resolution (author)
1. Play tab shows the story table — fixed: leaving the Story tab tears the chapter table down and the chapter resumes at its table beat (`src/renderer/main.ts`, "Leaving the Story tab leaves its table"). e2e step added in `story.spec.ts` (third test: Play shows Home and no table; Story returns to the table beat).
2. All-in call recorded as a bet — fixed: the capture is a pure `capturedAction` in `src/core/story/dossier.ts`; an all-in that does not exceed the bet faced is a `call` (`facingBet: true`, `potShare: null`). Unit-tested in `story-dossier.test.ts`.
3. D6 wording and an unbacked claim — fixed: the met lines say "cost nothing" with the `listening` pose; `story.short.b` now says "Some of them cost more than the price allowed", which is true of any short table. The story lint fails "held the price"/"price held" wording and the `price-held` pose in any story line.
4. Home strip without a source — fixed: it says "built from your last N hands: {leak}, {cost} bb" and carries the chapter's full citation as its title. Pinned in `tests/unit/story-ui.test.ts` (jsdom).
Consider items taken: bust and sweep at a chapter table show "Debrief" (not "New session"); the table seed is keyed on hands dealt against the rival, so an abandoned table never re-deals the same cards; a paired board plus one pair of their own reads as one pair. Not taken: a reopened debrief still rebuilds `focusSerious: 0` (the per-sitting focus count is not persisted; the caption then omits it) — listed in FINDINGS.md.

## Re-verification (reviewer, at e8c3c63)
Final verdict: **PASS WITH NOTES.** All four act-on items are fixed. The fixes added no blocking problem.
Checked against `git diff 4b20d91..HEAD` (b037670, e8c3c63).

1. **Fixed.** main.ts:1074-1078 adds a check that runs after the Story-tab table branch: when `storyView.at === 'table'`
   and `tab !== 'story'`, it tears the table down and sets `storyView` back to the chapter's table beat. It runs before
   the Play branch, so the Play branch's `if (table)` can no longer mount a chapter table. It runs once, because
   `storyView` leaves `'table'`. The new step in story.spec pins it (Play shows Home with no table, and Story comes back
   at the table beat). I read that spec but did not run it.
2. **Fixed.** `capturedAction` (dossier.ts:46-59) records an all-in with `committed + stack <= currentBet` as
   `call`, `facingBet: true`, `potShare: null`. An all-in over the bet stays aggression. table.ts:966 uses it. Unit
   tests cover a short all-in call, an exact all-in call, an all-in over the bet, a bet, a raise and a call.
3. **Fixed.** `story.met.*` now say "cost nothing" with the `listening` pose. `story.short.b` no longer claims "close
   spots". The story lint now fails "held the price"/"price held" wording and the `price-held` pose in any story line
   (story-lines.test.ts:71-73).
4. **Fixed.** The strip meta now reads "built from your last N hands: {leak}, {cost} bb", and its `title` is the
   chapter's full citation. The row's aria-label already includes the meta. story-ui.test.ts (jsdom) pins both, plus a
   new player's strip that names no leak.

Consider items taken (checked): a bust or sweep at a chapter table shows Debrief, with matching copy. The table seed now
comes from the hands already dealt against the rival, at both call sites (main.ts:503, :599), so an abandoned table
gets a fresh deal. A paired board plus one pair of the rival's own now reads as `pair`. The `focusSerious: 0` rebuild
was not taken, and the author has declared it a follow-up. It stays Noted.

New notes (none blocking):
- dossier.ts:81. The paired-board rule also turns a real two pair of the rival's own into `pair`. Example: KdTc on
  2c 2d Ts Kh 9s, where the best five are KK TT 9 and both pairs use a hole card. This is rarer than the bug it
  replaced. A fix would count how many hole cards pair the board.
- story.ts:660. "your last 1 hands" when the log holds one hand. It is the same unpluralized "hands" as story.ts:177,
  which is already Noted. In practice a leak needs 2 decisions, but those can come from one hand.
- scripts.ts:273. "Some of them cost more than the price allowed" opens the debrief with no antecedent for "them". It
  also uses price wording for mistakes that have no price, such as a missed-value check or a free fold. Wording only.

Verification at e8c3c63: `npm run typecheck` exit 0. `npx vitest run` exit 0, 104 files and 2375 tests passed
(including the new story-ui and capture tests). e2e not run, as instructed.
