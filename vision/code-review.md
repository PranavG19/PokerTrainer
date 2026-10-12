# Review: vision-panel (The Back Room: design, pitch and mocks)
Verdict: FAIL (17 Act-on findings remain; most are cheap text or mock fixes, but R1–R7 are real contradictions an owner would act on)
Base: glass-full-redesign dc4a9b8  Head: vision-panel working tree (uncommitted: VISION.md, PITCH.md, BUILD-PLAN.md, panel/, demo/vision/, DECISIONS.md diff)

This is a design-and-pitch review, so there is no compile step. I tried to prove each artifact wrong
against the repo, the spec, the panel reports and the rendered mocks. I checked every [repo] claim against
the files, and every cited effect size against research/TEACHING-METHOD.md and panel/learning-scientist.md.
I looked at 12 of the 22 screenshots (both sizes for home, table and character; 900x640 for profile, locker,
story, celebrate, lesson, pro-import and pro-icm; 1100x760 for table-great).

## Act on

- **R1. VISION.md:95, demo/vision/table.html:124-133, DECISIONS.md (vision "Price held" line).** "Price held"
  is defined to fire *only if the spot was close*. Its canonical example, and the whole great-play mock, is
  "25% needed, 74% had". That is a 49-point margin, the opposite of close. The mock's own comment says "the
  grade is free". If you build to the mock, the rare beat fires on easy calls and becomes generic praise, which
  breaks G3 and D6. Fix: change the example and the mock to a genuinely close spot (e.g. "33% needed, 36% had",
  inside the close-spot band from WP 0.2). Or rewrite the rule as "the spot was hard" with a stated metric,
  and use that same metric in VISION:95, D6, DECISIONS and BUILD-PLAN 1.4.

- **R2. demo/vision/table.html:112-115 (table-mistake screenshots).** VISION:92 ("adds no words in-hand"), D7
  and DECISIONS ("Dee adds no words in-hand… speaks at the hand-end beat") all say Dee is silent in-hand. But
  the serious-verdict sheet puts Dee's line ("Price first. Folio has a page open…") inside the in-hand sheet,
  and the sheet's own caption reads "Ada and Bo play the hand out behind this sheet". So the hand is not over.
  The sheet also reaches four chunks (verdict, principle/meter, commit result, Dee line) against the T4
  three-chunk budget. Fix: remove the `.beat` from the sheet. Show the Folio prompt in the hand-end tray after
  the hand resolves, as the great state does. Or change D7 and say so.

- **R3. VISION.md:372 (D1), PITCH.md:183,193, BUILD-PLAN.md:93,119.** PRODUCT-SPEC:542 lists more as out of
  scope than XP, streaks and cosmetics. It also excludes "leaderboards", "Tournaments and ICM", "Importing
  hand histories from real sites" and "Bankroll management". D1 as written amends only "effort XP, a humane
  streak and earn-only cosmetics" (technical-architect.md:17 listed ICM, tournaments and HH import
  explicitly). Pillar 7 and the Ghost Rail league therefore ship against unamended non-goals. Separately,
  BUILD-PLAN:119 starts 2.10 (Pro core) "at once", while PITCH:193 says "Not yet: … Pro tools", to come only
  after the trial passes. Fix: widen D1, or add a D18, to cover ICM/tournaments, HH import, bankroll and the
  league framing. Then either move 2.10 out of the "start at once" list or change PITCH §5 to match.

- **R4. BUILD-PLAN.md:59-76 vs VISION.md §3.** Several **Core** features have no work package: Today's
  Ticket (VISION:175; 1.5 only adds an "entry"), Folio the Rulebook (VISION:176), Socratic interrupts
  (VISION:178), Fading per concept (VISION:180), the Profile "Decisions, not results" block (VISION:203; no WP
  touches `screens/profile.ts`), range-vs-range equity (VISION:249), and the D9 navigation change. Two
  further Core items are scheduled in Wave 2: Ghost Rail (VISION:235 vs 2.5) and profile export/import
  (VISION:239 vs 2.8). A swarm run from this plan would not ship the Core it promises. Fix: add WPs for the
  missing Core features, or re-tier them as Bold in VISION. Move 2.5 and 2.8 into Wave 1, or re-tier them.

- **R5. BUILD-PLAN.md:16-25, 46-52, 65, 116.** There are dependency and hotspot defects:
  (a) WP 0.4 says "T `core/table.ts:589`", but the call site is `src/renderer/screens/table.ts:589`
  (`src/core/table.ts` exists, so the agent will edit the wrong file).
  (b) `screens/table.ts` is touched by 0.4, 0.5, 1.4, 2.1 and 2.12, but the owner table names only 1.4 then
  2.1. Wave 0 runs 0.4 and 0.5 in parallel on it.
  (c) `core/coach.ts` is touched in parallel by 0.2 and 0.3 and has no owner. The same goes for
  `screens/settings.ts` (0.8 and 1.8) and `screens/home.ts` (0.8 and 1.5).
  (d) 1.3 (Lamp, Rhythm) depends on "F types" only. It needs 0.6 (the local-day fix) and H (its own tests use
  `OFFSUIT_NOW`).
  (e) The critical path "F → 1.3 → 1.5 → 1.4" contradicts the table, where 1.4 depends on neither 1.3 nor 1.5.
  (f) D1 (which VISION:372 says gates Pillars 3–5), D5, D6, D7, D9, D13 and D16 are not in any WP's "Depends
  on" column. D13 (the second sound cue) and D16 (the Ticket) have no WP at all.
  Fix: correct the path; add `core/coach.ts`, `screens/settings.ts` and `screens/home.ts` to the owner table
  with a sequence; make `screens/table.ts` owned 0.4 → 0.5 → 1.4 → 2.1 → 2.12; add 0.6, H and D5 to 1.3 and D1
  to 1.3, 1.5, 1.7 and 1.10; redraw the critical path from the table.

- **R6. VISION.md:380 (D9), DECISIONS.md (9-tab line), demo/vision/shell.js:2,9-10.** The nine-tab set (Home,
  Play, Learn, Story, Train, Study, Pro, Locker, Profile) is not proposed by any panel report.
  technical-architect.md:119,478 recommends *no* new tabs without a nav-fit measurement. The set drops 7 of the
  real 11 (`src/renderer/main.ts:204-216`: Charts, Bank, Equity, Ranges, Dossier, Progress, **Settings**)
  without saying where they go. Home is not a tab today. Settings is where the Character and Celebrations
  switches live (VISION:261, WP 1.8). Progress has an asserted five-metric contract, and `navigation.spec`
  pins every tab. shell.js:2 and :9 still say "the real 11 tabs" above a 9-tab array. Fix: add a mapping
  table (old tab → new home) to D9, keep Settings reachable, cite the source as "synthesis" and not the panel,
  and add the nav WP from R4. Correct the shell.js comments.

- **R7. demo/vision/home.html:112-114; profile.html:179; locker.html:117; home.html:128; story.html;
  VISION.md:67-69,235.** The rival masking rule is broken, and the mocks disagree about progress. Home's
  Ghost Rail lists Ines, Wren and Barnaby as the league "regulars". VISION:235 says the regulars are labelled
  fictional characters "Deuce to Ace". Ines is the final boss, masked as "?" on the character sheet, so the Home
  mock unmasks her before she is beaten. That contradicts "each stays masked until the learner beats its boss
  hand". Percival is beaten on Profile (Bookmark keepsake earned), but his hand is "Next" on Home and Story,
  and the Locker's "Library rim" is still locked behind "Beat Percival's hand". Fix: use non-rival fictional
  regulars on the Rail, and make the progress state of all mocks agree (Percival unbeaten, so remove the
  Bookmark keepsake, or beaten everywhere).

- **R8. demo/vision/shell.js:20 (the `.lamp-count` glyph, every screen's title bar).** The Lamp count's icon is a
  flame (a teardrop on a base line). panel/ux-motion-designer.md:326 rules this out explicitly: "No flame. A
  flame is Duolingo's loss-aversion signature". Economy risk 16 (trade dress) and PITCH:160 claim the
  Duolingo-specific parts are rejected. A number with a flame in the title bar is the most recognisable piece
  of Duolingo's streak UI. Fix: use the chip-stack glyph the UX designer specified, or a lamp *body* with no
  flame, and add the rule to DECISIONS.

- **R9. demo/vision/profile.html:49,219 (Seal VI "Blockers · Rep due").** Amber is used for a due review
  (dashed amber ring and amber label). The role map reserves amber for notable severity and the gate timer.
  VISION §5:337-338 itself refuses amber for habit states for exactly this reason. Fix: show a due seal with
  `--ink-2` text and a `--lamp-rest`-style hollow ring. Keep amber out of Profile.

- **R10. demo/vision/celebrate.html:64.** "Thirty lit days. Nine of them were rest days the schedule asked for.
  They count." This counts rested days as lit days. VISION:196 and 299-305, the Home and Profile legends ("Lit"
  vs "Rested") and the Lamp CSS all keep them distinct: a rest day *preserves the run* but is not a lit day.
  Counting rests as lit inflates the lifetime count with days of no practice, which is the hollow metric the
  design claims to avoid. Fix: "Thirty lit days, and nine rest days the schedule asked for kept the run
  going", or define "lit" to include rests everywhere and say so in D5.

- **R11. demo/vision/pro-import.html:120-121.** The import screen shows "Net, all hands −1.9 bb/100" and
  "All-in adjusted −0.6 bb/100". D10 (VISION:381) recommends "counting stats only, no profit/loss", and the same
  screen's notice says "results are never scored". Fix: remove both rows (or put them behind D10 as an
  explicit overrule). Keep the counting stats.

- **R12. VISION.md:228,277 (and panel/economy-designer.md:67,160-165).** The Chalk curve (1.0 per Rep up to
  150 Reps, 0.5 up to 300, 0 after) earns at most 150 + 75 = **225** Chalk a day. So the stated "300 a day"
  cap can never bind, and "most learners hit the 300 cap at about 2 sessions" (economy) is arithmetically
  false. The "7–9 months" catalogue estimate (VISION:296) inherits whichever figure the model used. The error
  comes from the panel, but the synthesis repeats it. Fix: either make the cap 225, or change the bands (e.g.
  1.0 to 200, 0.5 to 400). Then recompute the months estimate and label it [speculation] as it is now.

- **R13. PITCH.md:3-5,47-48,30-31,151,153,95-96.** Citation labelling overclaims.
  (a) The preamble says the citations "were checked by the panel's learning scientist". The panel tags them
  [confident] or [recalled], not verified.
  (b) PITCH:47-48 attributes "effects on learning are small" to "Lester et al. 1997 and follow-ups". Lester
  1997 is the persona-effect paper. The small-learning-effect finding is Schroeder, Adesope & Gilbert 2013, which
  learning-scientist.md:102-103 marks [recalled].
  (c) Dunlosky et al. 2013 is [recalled] in TEACHING-METHOD.md:840. Lally 2010, Deci-Koestner-Ryan 1999 and
  Lester 1997 are only [confident] in the panel (learning-scientist.md:85,102,160). All of them are printed as
  bare **[evidence]**.
  (d) PITCH:95-96 cites the v2.1 amendment as precedent ("the reward for climbing is a deeper game") but
  leaves out the rest of that sentence, "never chips-for-power, cosmetics, or a shop" (PRODUCT-SPEC:544). To
  a skeptical owner that reads as selective quotation.
  Fix: carry the source's confidence grade into the label ([evidence, recalled] and so on); cite Schroeder et
  al. 2013 for the small effect; quote v2.1 in full and say the cosmetics ban is what D1 overturns.

- **R14. demo/vision/vision.css:13,87; locker.html:34,48; celebrate.html:38; story.html:58;
  capture.mjs:26.** There are hex literals in page CSS outside the documented dee.js art: `#15171A`
  (felt-swatch rail), `#5B6470`/`#1E2228` (rim swatches, twice), `#D9D4C8` (story arc, which is literally
  `--chip-a`), and `--ring-gleam: #FFFFFF` (should alias `--text-hi`). AGENTS.md says "No hex literals". Also,
  locker.html:34 draws the Plain Bone back as a `data:image/svg+xml` URL. The app CSP (`default-src 'self'`,
  index.html:5) blocks that, as VISION:260 itself notes. capture.mjs:26 exempts `data:` from its network
  check, so this can't be caught. Fix: replace the literals with tokens (`var(--chip-a)`, a `--rail` token,
  rim tokens in vision.css), draw the back as inline SVG, and have capture.mjs flag `data:` URLs in
  stylesheets.

- **R15. demo/vision/story.html:56,64; index.html:47; home.html:97 vs profile.html:130-134.** The mocks are
  inconsistent with VISION. The Story map says "Chapter 3 of 6" and "six venues", and the Kitchen Table
  (chapter 0) is missing. VISION:140 says seven venues, and BUILD-PLAN 2.1 says "7 chapters". The venue is
  "The Library" in every mock but "The Quiet Library" in VISION:60. Home shows "Notebook 7 · 1,920 / 3,000
  reps", while Profile shows "Notebook 8 · 630 of 1,000 Reps". Fix: add the Kitchen Table node ("Chapter 3 of
  7", or number from 0), settle on one venue name, and use one Notebook state everywhere.

- **R16. demo/vision/lesson.html:70,89.** This is a pot-odds teaching error in the lesson that teaches pot
  odds. "100 to win 400: 1 time in 4" is the classic misstatement: you risk 100 to win 300, and your 100 is
  one quarter of the 400 final pot. "1 block paid, 4 blocks won" has the same error (3 blocks won, out of 4
  total). Fix: "You pay 100 into a pot that will be 400: you need to win 1 time in 4." Also change the caption
  to "1 block paid, 3 won · 1 of 4 is yours".

- **R17. VISION.md:20, PITCH.md:107, Locker copy vs VISION.md:229.** "Nothing is ever bought, and nothing is
  random" contradicts Dealer's Pick, "the only randomness". The economy panel's D7 asked the owner to decide
  this. The synthesis dropped it from the decision list but kept the feature. Fix: cut Dealer's Pick, or
  qualify the claim ("nothing you earn or win is random") and restore the decision as D18.

## Consider

- **PITCH.md:60.** "Experiment 1 found ties on 47.7% of decisions." That is the `adherent-passive` policy's
  rate (research/EXPERIMENT-1-adherence.md:200). Another population in the same file ties on 70.1% (line
  243). The more damning number for the argument is "no opinion on 39.3%". Tradeoff: one more clause for
  precision.
- **vision.css:14,26-27,58,69; home.html (Ghost Rail "You" bar); lesson.html ("pay 100" block).** `--chip-a`
  (#D9D4C8) is almost bone (#F4F2EC). Lamp dots, ring arcs, done checks, the solid "You" bar and the bone
  price block all sit beside the one bone primary, which dilutes "bone = cards and the ONE primary action".
  The UX panel justified chip-a as "bone's family". Tradeoff: a dimmer `--lamp-on` keeps the warmth without
  competing with Start.
- **VISION.md:334, shell.js:19.** The perch Dee is 30 px, an orphan size. The tokens are `--dee-sm` 24 and
  `--dee-md` 44. Pick one and use the token.
- **locker.html:51-55.** The Locker preview puts Dee on the felt swatch, while VISION:334 says "Dee is never on
  the felt". It's only a preview, but it's the image people will copy.
- **capture.mjs:29-30.** It checks root scroll only. It cannot see inner clipping, primary counts, hex or
  float counts. At 900x640 the character sheet silently drops its pose captions and two of the six "never"
  bullets (luck, "one more hand"). Tradeoff: a few `page.evaluate` assertions would make the "fits both
  sizes" claim evidence rather than inspection.
- **BUILD-PLAN.md:54.** The Wave 0 exit criterion ("the owner judges the grader fit") has no threshold written
  in advance, unlike the trial's pre-registered kill criteria (PITCH:73-84). Tradeoff: name target tie and
  no-opinion rates now, or say explicitly that it is a judgement call.
- **PITCH.md:175-176.** "If the trial fails, the loss is about two days of agent time." The plan's own
  estimate is 1–2 days of package work plus 1–2 days of integration (BUILD-PLAN:74-76), plus four weeks of
  the owner's calendar. Say "2–4 days".
- **VISION §7.** The economy panel's D8 (accessibility options free forever) and D9 (a permanent no-sale
  DECISIONS line, which skeptic.md:236 also demands) were dropped from the 17 decisions without a note. The
  no-sale rule appears as prose but is not recorded in DECISIONS.md. Tradeoff: these are cheap, binding
  pledges that answer skeptic objection 5.
- **BUILD-PLAN 2.1/2.2.** Story's boss hands and map medallions need the rival banks and art from 2.2, but
  2.1 does not depend on 2.2.
- **lesson.html:70.** Dee uses the `glint` (Price held) pose on a correction. Reserve glint for its one beat.
- **D16 / VISION:175.** PRODUCT-SPEC:171 already frames short sittings as free-roam "practice, not a session".
  Framing the Ticket that way may avoid a spec change entirely.

## Noted (verified true)

- Experiment 1's 47.7% tie and 39.3% no-opinion rates (EXPERIMENT-1:200-204). The UTC `dayIndex` is at
  `career.ts:103`. `deserialize` builds an explicit object, so unknown keys are dropped (`session.ts:569+`).
  `VILLAIN_BETTING_RANGE` is used at `screens/table.ts:589` and `assessmentBlock.ts:212`.
  `DISPLAY_ITERATIONS = 2000`. `DEPTHS` exists. The schedule gaps are 0, 1-2, 7, 21 and 30-45. seatLayout is
  tested to 8 villains. TEACHING-METHOD:485 bans layout and card-art changes. The reason grader scores 82/100.
  The tilt proxy matches PRODUCT-SPEC:450 and is not built.
- PR-DRAFT.md: 551 e2e passed, 1804 unit. The glass branch is 24 commits, 74 files, +6588/−3724. The panel
  totals 44,992 words. Wave 1 sums to 37 agent-hours and Wave 2 to 54. The economy panel lists 20
  regulatory risks. skeptic.md:151 says about 65 decisions were raised. The vocabulary ban was lifted on
  2026-08-14 in code (`progress.ts:443`, `guard.ts:78`) with no DECISIONS or spec entry.
- Van der Kleij 0.05/0.49, Karpicke & Roediger 2007, Chi 1989 and Kluger & DeNisi 1996 are in
  TEACHING-METHOD as [verified].
- The ICM mock is correct. Malmuth-Harville for 27/13/6/14 bb at 50/30/20 gives 35.4/25.0/13.6/26.1%. The
  bubble factors map to the stated required equities (BF/(1+BF)). The leak-finder band for 101/142 (64–77%) is
  right.
- LLM flavour reuses the existing opt-in tutor egress. With no credentials there is no call, so the claim at
  VISION:109 holds.
- One bone primary per visible state on every mock. `.group` is used only for actionable lists (quests,
  chapter row, leak listbox). There are at most two floats on the table states. Mint appears only on the
  Coach switch, positive deltas (−5.3 EV loss, +0.4 bb) and the Seal-tick legend.

## Dismissed

- **Dee resembles Duolingo's owl or another mascot.** Proof: dee.js:1-4 and the character sheet show a disc
  with an engraved D, no eyes, no beak, no limbs and no green. The "smile" counter is the closest thing to a
  face and is not bird-like. (The flame glyph is a separate issue, R8.)
- **The card backs copy existing art.** Proof: the locker.html:33-41 patterns are original gradients and a
  spade mark, with no Bicycle or KEM motifs.
- **The mocks make remote requests.** Proof: the only URL in the mocks is the SVG `xmlns` string inside a
  `data:` URL (locker.html:34). That is not a request, though the `data:` URL itself is R14. There are no
  fonts, CDNs or `@font-face`. vision.css imports the local `../glass/glass.css`.

## Verification

- Ran read-only greps and reads over VISION, PITCH, BUILD-PLAN, DECISIONS (git diff), PRODUCT-SPEC, the
  research files, panel/*.md, demo/vision/*, src/core/{career,session,equity,standing,schedule}.ts,
  src/renderer/main.ts, screens/table.ts, assessmentBlock.ts, index.html and PR-DRAFT.md. Ran `git rev-list` and
  `git diff --shortstat` for the glass branch numbers. Ran a Python Malmuth-Harville check of the ICM mock.
- Did not re-run capture.mjs (no installs or browser launches). The network and scroll claims rest on
  reading capture.mjs and the existing screenshots.
- Untested: nav fit of the nine-tab set at 900px with the real app's tab widths, and whether the 900x640 mocks
  clip inside overflow:hidden containers (capture can't see this).
