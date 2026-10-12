# Panel: the skeptic

**Lens.** The case against. The owner said "It should be a challenge to sell me that it's worth doing all
this", so this report makes that challenge as hard and as honest as I can. I read the seven panel reports
and spot-checked their claims against the code at `dc4a9b8` (worktree `vision-panel`). Every objection
below comes with the evidence or design change that would answer it, so the pitch writer has something to
work against rather than a wall to talk past.

**What I concede up front.** The case for doing *something* is real, and the repo makes it itself.
`PRODUCT-SPEC.md` Open question 2 (line 585) calls adherence "the highest-probability project-killer".
It says "every motivational surface is banned" and that the existing adherence choices have "no citation
behind them". An austere trainer that nobody opens is not a trainer. So I am not arguing for zero. I am
arguing that the proposed *form* (character + streaks + XP + quests + leagues + seven cosmetic slots +
campaign + rivals + pro tools + social) is the wrong form for this product at this moment, and that most
of the cost is in places where "agents code fast" does not help.

---

## Objections, strongest first

### 1. You would be gamifying a grader that cannot yet tell the actions apart

**The claim.** Every reward, celebration, certification and character reaction amplifies whatever the
grader says. The grader is the weakest part of the product, and the repo has measured that.

**Evidence.**
- `research/EXPERIMENT-1-adherence.md` §"Tie-break dominates": on **39.3%** of decisions every legal
  action grades below the 0.5bb silence line, so the grader has no opinion. On **47.7%** the minimum is
  shared. Two "equally adherent" policies that differ only in tie-break are separated by **142 bb/100**.
  Pure adherence is "statistically indistinguishable from … a deliberately terrible nit".
- The same document: "Six hours before this run, the answer was NO." One bug fix flipped the verdict from
  "the grader actively harms a competent player" to "helps as a veto". The veto arm's sign also flips with
  the opponent: +425 vs all-station, −46 vs all-nit, −50 vs all-TAG.
- One fixed villain range for every street, archetype and position. `VILLAIN_BETTING_RANGE` is passed
  whenever `toCall > 0` (`src/renderer/screens/table.ts:589`, `src/core/assessmentBlock.ts:212`). The
  poker expert shows this makes the app contradict its own maniac exploit text ("call down light").
- Preflop opens are mostly ungraded at the table. The expert's arithmetic: with `SB = 25`, `BB = 50`, the
  formula's ceiling is about 2.5bb and realistic gaps fall under the 0.5bb silence line. The app has the
  correct charts in `preflop.ts` and does not use them to grade.
- Hard bb thresholds with no noise band (`src/core/coach.ts:155-156`: `< 0.5` free, `< 2.0` notable) on a
  2,000-iteration Monte Carlo (about ±2.2 equity points at 95%). In a big pot, a call inside the model's
  own noise grades "serious". The loudest channel fires exactly where the app knows least.

**Why the panel's mitigation is not enough.** The learning scientist and economy designer both key XP to
"process, not outcomes". That is the right instinct, but the grader still gets in.
- The scientist's XP formula pays SURE +10 "if action-correct (severity tier free)".
- REPAIR (+25, the biggest grant) requires being "correct" at the re-serve.
- GATE_C (+50) is a pass/fail on graded items.
- Depth, which the strategist turns into rooms and the economy turns into ceremonies, is "only as good as
  `coach.gradeDecision`" (`standing.ts` header, quoted in the strategist's F7 caveat).

So "process XP" is still about half grader XP, and the biggest grants are grader verdicts.

There is a second problem. Today a wrong grade costs one coach sentence the learner can shrug off. Under
the proposal it costs a broken certification, a missed repair, a tarnished Rulebook card or a lost league
place. Raising the stakes on a signal raises the cost of its errors. A serious player who catches the
grader calling a correct exploit a mistake will not forgive that if a mascot also reacted to it.

**What would answer it.**
- Ship the poker expert's G-a (a "close" verdict inside the noise band), G-b (grade preflop from the
  charts) and G-c (villain range by archetype and street) first.
- Then re-run Experiment 1 and publish two numbers. First, the share of decisions where the grader picks
  a unique best action (the tie rate should fall well below 47.7%). Second, a veto arm that is positive
  against all four lineups, not only the pooled one.
- Until then, any reward that reads a grade should key only on the coarse "serious vs not" boundary, and
  "close" spots should earn and cost nothing.

### 2. Nobody can know whether it worked, and the spec forbids the instrument

**The claim.** The pitch is "this makes people learn more, or stick with learning longer". The product
cannot measure either.

**Evidence.**
- Telemetry is a non-goal (`PRODUCT-SPEC.md:542`). Every panel report accepts that, which is right for
  privacy. But it means there is one user, the owner, and no population.
- The learning scientist's own power statement: an ABAB withdrawal on N=1 "can detect a large adherence
  change (days practised), not a small learning change. The learning metrics are guardrails that must not
  get worse." So the strongest evaluation on offer measures engagement, the thing Duolingo optimises,
  and cannot measure learning, the thing Offsuit exists for.
- Open question 6 (PRODUCT-SPEC) already says N=1 statistics make the KC graph "unfalsifiable in-product".
  Adding a reward layer adds confounds to a system that already cannot detect its own mis-cuts.
- The spec prescribes a cheap pre-build experiment for exactly this risk (Open question 2): run the austere
  loop on paper for two weeks. I found no record in `DECISIONS.md` or `research/` that it was run. If the
  cheap test of the core loop was skipped, the expensive test of a reward layer on top of it will be too.
- The strategist is candid: "Whether a deliberately non-praising mascot feels warm enough to motivate is
  the central bet of this document and is untested", and "Testing this needs real users, which the
  product does not have."

**What would answer it.**
- Before any code, write down a decision rule: which metric, over which window, and what result makes the
  owner switch the layer off. The scientist's metrics 1, 2 and 9 (assessment RW EV loss, day-21/30-45 probe
  accuracy, streak-save session quality) are the right ones.
- Commit to the ABAB in writing with a date. Accept in advance that the honest outcome is "I liked it",
  which is a taste result, not an efficacy result, and say so in the pitch.
- Alternatively, find even three outside learners (LAN, friends) and accept a small, local, opt-in,
  file-export diary as the evaluation. That is a spec decision too.

### 3. It rewrites the product's soul, and the rewrite has already started without a record

**The claim.** The method is not neutral about any of this. It was built on removing these mechanics, and
the governance that is supposed to protect it has already drifted.

**Evidence.**
- `PRODUCT-SPEC.md:542` lists "leaderboards, XP, streaks, cosmetics, a shop" as out of scope. The v2.1
  amendment (`:546`) says the reward for climbing is "a deeper, harder game … never chips-for-power,
  cosmetics, or a shop". It says `BANNED_PHRASINGS` is "**UNTOUCHED** — the words
  'rank/percentile/level/streak/XP/leaderboard/badge/trophy' remain forbidden".
- **That sentence is false today.** Commit `078f089` (2026-08-14, "remove the anti-gamification
  firewall") deleted those words from `BANNED_PHRASINGS` (`src/core/progress.ts:442-447`) and from the
  guard (`src/main/tutor/guard.ts:78-80`), and inverted three tests. The decision lives only in code
  comments. `DECISIONS.md`, described in AGENTS.md as "the living decision record", has no entry for it
  (grep for `2026-08-14`, `XP` or `gamif` finds nothing). The spec still says the opposite. Four panelists
  noticed this independently.
- `research/TEACHING-METHOD.md:379` "Deliberately absent in learning mode: … `streak`, `rank`".
  `:455` "no streak on results, no XP". `:517` lists XP, streaks and leaderboards among outcome signals,
  with the evidence that "17% of 994 educational effects were negative". `:252` "Silence is not praise."
  `:273` bans the player as grammatical subject. `PRODUCT-SPEC.md:144` N1: "There is no 'level', no unlock
  animation, no greyed-out nav."
- The brief asks for a Duolingo-like character. Duolingo's owl reacts to everything, praises, and is
  publicly known for guilt-trip reminders (the scientist's §3). Offsuit's rules forbid each of those. Every
  panelist responded by designing a character who is mostly *not allowed to do anything*:
  - Dee "adds no words to the verdict" in-hand.
  - Tell "must not nod, smile or sparkle after a correct decision".
  - Pip "keeps dealing" on a free grade.
  - The Dealer is "absent from the screen" in PLM.

  That is the honest design, and it is also the tell. A mascot whose defining trait is restraint is not
  what the owner asked for. A mascot that does what the owner asked for breaks the method.

**Why this is not just "write a v2.2 amendment".** The v2.1 amendment worked because it was narrow: one
number, computed from decision quality, ratcheting, one surface. This proposal would amend the
out-of-scope list in at least eight places (XP, streaks, cosmetics, leaderboards, tournaments/ICM, HH
import, bankroll, telemetry by implication), plus N1 (levels), plus T7/V4 (surface stability), plus S2a/S3
(the strategist's Ticket needs probes outside sessions). At that point it is not an amendment, it is a new
spec wearing the old one's name.

**What would answer it.**
- First, a `DECISIONS.md` entry and a spec fix for the 2026-08-14 change, independent of this proposal.
  The repo's honesty depends on its records agreeing.
- Then a v2.2 amendment that lists, item by item, what is in scope, what stays banned, and the
  pedagogical reason for each.
- If the owner cannot write that amendment in one sitting without contradicting TEACHING-METHOD, that is
  the answer.

### 4. "Agents code fast" is true and mostly irrelevant here

**The claim.** Typing code is the cheap part of this proposal. The expensive parts do not speed up with
more agents, and a swarm makes some of them worse.

**What is slow regardless.**
- **Decisions.** The seven reports raise about **65 owner decisions**: strategist 11, learning scientist
  11, economy 11, poker expert 10, character 8, architect 8, UX 6. Many are coupled. The panel has not
  converged on the basics:
  - Four mascots: Dee the dealer button, Tell the ceramic chip, Pip the human dealer, "the Dealer" as a
    working name.
  - Four streak units: appointments "Kept" (strategist), a weekly "Rhythm" (scientist and economy), a daily
    "stack" with planned rest days (UX), and "lit days / run" (character).
  - Currency: the economy designer's Reps plus Chalk, with caps and half-rate bands, against "no currency at
    all" from the scientist (D8), the character designer and the architect's preference (D5).
  - Even the XP word differs: "reps" (UX) and "Reps" (economy) mean different things.

  No agent can make these decisions. Each one needs the owner's taste.
- **Taste.** The glass system took a full redesign branch to get right (`styles-glass.css` is 1,689 lines;
  DECISIONS.md is mostly visual rulings). A character's face, poses and voice are harder than a token
  ramp, and they are judged by feel, not by tests.
- **Content QA.** The character designer wrote 46 sample lines and checked them "by hand". The strategist
  says personality at scale means "hundreds of guard-passing lines". The lint catches banned words. It does
  not catch smug, cloying, repetitive or subtly wrong lines. Lines like "First time standing up. It'll
  happen less." (Dee's line for the first serious mistake) pass the lint and still make a prediction about
  the person.
- **Playtesting.** Streaks, seasons and quests only show their problems over weeks of real calendar time.
  The architect needs a fake clock (`OFFSUIT_NOW`, D7) just to test them, and a fake clock cannot tell you
  whether day 23 feels like a chore.
- **Legal and ethical review.** The economy designer's §10 lists 20 regulatory rows, every one marked "to
  verify". None can be verified offline by an agent.
- **Evaluation.** See objection 2. Its timescale is weeks, not tokens.

**The review problem.**
- The current branch, `glass-full-redesign`, is a draft PR: 24 commits, 74 files, +6,588/−3,724, not yet
  merged. This proposal would stack a larger, more subjective change on unmerged work.
- The full e2e suite is 60 specs and about 539 tests, ~45 minutes on one worker (AGENTS.md; architect §7).
- The architect lists six `ALWAYS_FULL` hotspot files (`session.ts`, `renderer/main.ts`, `preload.ts`,
  `main.ts`, `store.ts`, `vite.config.ts`) that nearly every work package touches, so every integration
  step runs the full 45-minute suite. Parallel agents converge on those files and queue behind them.
- The architect's own plan (WP0–WP13) is serial on its hotspots. The swarm speed-up applies to pure
  `src/core` modules, which are the smallest and least risky part.
- A swarm diff of this size is reviewable only by the owner. The owner is one person, and "Pushing, opening
  PRs and merging are the human's" (AGENTS.md). Agents make the diff faster than a human can judge whether
  it is good.

**What would answer it.** A plan whose critical path is decisions, not code: a decision log with the owner's
answers to the coupled ten (mascot, streak unit, currency, praise, leagues, campaign, pro tools, real-money
data, age, evaluation) before any work package starts. Merge the glass redesign first. Then show one
vertical slice (character + one streak + one cosmetic) reviewed and lived with for two weeks before
anything else is built.

### 5. A reward loop on a gambling game is a different ethical object

**The claim.** The same streak that is harmless in a language app is not harmless in poker. Some users of
a poker trainer gamble with real money. A sticky daily loop wrapped around a simulated card room trains a
habit around the activity.

**Evidence.**
- The economy designer's §10 rows 1–3 and 8: simulated gambling may be R18+ in Australia, may get PEGI 18,
  ESRB "Simulated Gambling", and Apple 17+. Row 9: minors. Row 10: the UK Children's Code names
  streak-style mechanics as nudge techniques. Row 20: "a sticky loop could deepen problem play".
- Nothing in the repo states an audience age. I found no 18+ statement anywhere in `src/` or the spec.
  A cast of cute characters, cosmetics and a "Day ring" is exactly what pulls younger users in.
- The panel's own designs drift toward casino grammar even while banning it:
  - UX's streak is called "the stack", and its 7/30/100/365 milestone animation drops chips onto a stack.
    That is chip-accumulation imagery, in a product whose method deletes the chip signal
    (`TEACHING-METHOD.md:517`).
  - The economy's league tiers run "Deuce Rail → … → Ace Rail".
  - The strategist's rooms are "the private room, the high room", and its season finale is a
    "high-stakes night".

  Each one is defensible alone. Together they make an app that looks and feels like a card room you are
  rewarded for returning to.
- The learning scientist rates loss-framed streaks as effective "at producing low-quality 'streak-saving'
  sessions" and warns of the abstinence-violation collapse after a break. The proposed mitigations (no
  reset, rest days, no notifications) are good. They also remove most of the pull, which is the reason a
  streak works at all. Either the streak bites, and it carries Duolingo's harms, or it doesn't, and it is
  decoration that costs a schema migration.
- The tilt proxy the spec requires ("3 consecutive T2+ with RT under 40% of personal median → offer to end
  the block") is not implemented. Grepping `src/` for `tilt` finds only opponent tilt weights in
  `robustness.ts`. A loop that encourages returning, before the brake that encourages stopping exists, is
  the wrong order.

**What would answer it.**
- An explicit 18+ statement at first launch.
- The tilt proxy and a break reminder shipped *before* any streak.
- A "quiet mode" that removes every economy surface (economy §11.11), with the trainer working fully
  without it.
- A design review of all copy and imagery against one question: "would this look at home in a casino
  lobby?", with the chip-stack streak metaphor dropped.
- A permanent DECISIONS line that nothing is ever sold, random or chip-convertible (economy D9). That line
  costs nothing, and it closes the door on the slide the economy designer's row 15 describes.

### 6. The maintenance bill is permanent, and it lands on a 45-minute test wall

**The claim.** Features ship once. Content and compatibility are paid for every month afterwards.

**Evidence.**
- **The content treadmill.** The strategist admits "the Back Room without F14 is a few months of product,
  not a year". F14 is the solver spot bank, which the spec describes (B0–B7) and which was never built.
  Today there are 24 lessons and 67 scenarios. On top of that the proposal needs:
  - season arcs with per-season cosmetic sets and story beats;
  - a cast of five speakers plus six rivals (character designer; their own D8 says the cast "may be one
    or two too many");
  - 52 catalogue items (economy §8.2);
  - league names and curves;
  - quest pools;
  - every line in every bank, lint-checked and taste-checked.

  A daily product that runs out of new content becomes a daily reminder that it ran out.
- **Schema risk that already exists.** The profile has no `schemaVersion` (grep finds none). `deserialize`
  (`src/core/session.ts:569`) rebuilds from known keys and `serialize` (`:537`) writes only those. So an
  older build that opens a newer profile and saves **silently erases the new fields**. That has been
  harmless because nothing users care about has been added since. XP, owned cosmetics and a 60-day streak
  are exactly what users care about. This is a latent data-loss bug that the expansion turns live.
- **Clock bugs.** `career.ts:103` buckets days in UTC (`Math.floor(ms / 86_400_000)`). For a learner in
  New York, an 8pm session counts toward tomorrow. Harmless on a dot grid, but a reason to rage-quit if a
  streak breaks because of it. The economy designer flags it (D11), and the architect flags that Career
  and a new streak must not disagree on screen.
- **Pins and specs.** The architect's §8 lists twelve pinned specs at risk:
  - nav fit at 900px (11 tabs already, with no room for a 12th or 13th);
  - Home no-scroll;
  - the `screens.spec` ban on "level/tier" in the standing label;
  - `--positive` mint semantics;
  - `theme.spec` paint-only;
  - `deal-perf.spec` (no long task at flop, now sharing the frame with celebrations);
  - the a11y announcer;
  - O3 archetype hiding.

  Each new cosmetic multiplies the computed-style checks. The architect budgets +60 e2e tests (+6 minutes),
  which I think is optimistic for 7 cosmetic slots × 2 window sizes × the pinned elements.
- **Perf.** Equity runs synchronously on the renderer main thread with no Workers anywhere in `src`
  (architect §1). Celebrations, saves and grading would land on the same frame. A leak finder over
  imported hands needs a Worker that "needs a spike" because of `file://` restrictions.

**What would answer it.**
- Fix the schema gap (version field, pass through unknown keys, snapshot before migrating, downgrade
  guard) **now, as a standalone change**, whatever is decided about the expansion. It is a bug.
- Fix the UTC day.
- Put a hard cap on content in the amendment, for example "one season, one cast of ≤3, ≤12 cosmetics, ≤150
  lines", and treat raising any cap as a new decision.

### 7. It dilutes the one identity no competitor has

**The claim.** The strategist names the moat correctly: "the only poker trainer whose coach can stay quiet,
and whose rewards cannot be bought with luck". The proposal spends that moat on a costume.

**Evidence and argument.**
- The poker expert's bottom line: serious players respect Offsuit's refusal to fabricate solver output
  (`bank.ts` `UNGRADED_NOTICE`), its sample-size gates (`reads.ts`), and its refusal to show win rates
  below 2,000 hands (`variance.ts`). "Serious players leave trainers that feel like slot machines or that
  praise lucky results."
- Segment E (the studying grinder) is "not targeted" (strategist). But segment B, the plateaued
  recreational player who is a primary target, is exactly the person who will judge the app by whether it
  feels like a tool or a toy. A ceramic chip with ink eyes on the title bar answers that question before
  they read a single verdict.
- "Duolingo for poker" invites comparison with a product built on A/B infrastructure and a phone in every
  pocket. The strategist notes the platform problem:
  "Daily-habit apps usually live on phones … Offsuit lives in an Electron window the learner has to
  remember to open." A Duolingo shell without push notifications, mobile or social is the weakest version
  of Duolingo and the most diluted version of Offsuit.
- The pro tools in the same brief pull in the opposite direction: ICM, push/fold, HH import, a leak finder,
  bankroll. The poker expert recommends real-money data handling only in its most restricted form, and no
  HUD-like opponent database. Building a mascot-led beginner product and a real-money analysis tool at
  the same time is two products with one owner.

**What would answer it.** A clear audience call: segment A or B first (strategist D9). Keep every
character surface off by default for the other. Show the pitch to one serious player and one newcomer and
record both reactions. Keep pro tools as a separate decision with its own amendment.

### 8. Art, voice and taste risk against a premium glass system

**The claim.** The glass system's premium feel is fragile, and a mascot is the fastest way to break it.

**Evidence.**
- AGENTS.md's role map gives each hue one meaning and pins mint, white, the to-act ring and seat opacity.
  UX had to invent `--chip-a` ceramic and float a "lilac kept-habit hue" (its D4) because no existing
  colour may carry a streak. Each new meaning dilutes the map.
- The character has to be original. Trade dress against the Duolingo owl is economy row 16, and the
  owner's brief literally says "Duolingo-like". It has to be built as hand-authored SVG with CSS
  expressions. CSP blocks `data:` images, Vite inlines small assets as `data:` (architect D8), and Rive
  would need a dependency, which AGENTS.md forbids.
- There is no illustrator and no voice actor, and the CSP forbids remote fonts. Character quality will be
  bounded by what an agent can draw in SVG paths. Agents are good at systems and mediocre at faces.
- A half-good mascot is worse than none. A cute character on the glass redesign's restrained frosted
  surfaces is a style collision the owner will see every day.

**What would answer it.**
- Mock the character in `demo/glass/` at both window sizes, beside the table and the coach sheet, before
  any engine work.
- If it does not survive the owner looking at it for a week, the character dies and the rest of the
  proposal should not depend on it.
- Make the character optional by architecture: every streak, quest and cosmetic must work with it
  switched off.

### 9. Leagues and social are hollow without a backend

**The claim.** In a local-first, no-network app, "leagues" and "social" are simulations of other people.

**Evidence.**
- `no-network.spec` measures the network seal from outside the app. Global leagues, friends, presence and
  sync are all marked "**YES** breaks no-network" in the architect's §6.
- The offline alternatives are:
  - **Ghost leagues of 29 seeded bots** (architect), or 8 seats with 4 rubber-banded characters at
    0.75–1.3× your median (economy). These are disclosed, which is honest, but they are a league whose
    opponents are written to sit around you. That is a progress bar wearing a costume. Disclosed or not, it
    imitates social proof.
  - **A LAN league** with no verification: the architect calls it "honour system", and "there is nothing to
    protect".
  - **Challenge codes** with a checksum that "catches typos, not cheating".
- v2.1 says "no comparison to other players … multiplayer is explicitly UNRANKED". The learning scientist
  rates leaderboards as "Forbid (and moot offline)": social comparison is self-level feedback, the least
  effective level.

**What would answer it.** Drop leagues from v1 entirely. If the owner wants a social loop, the honest one
already exists: LAN Home Game Night with private review (strategist F9). It needs no ranking.

### 10. The opportunity cost is the actual product

**The claim.** Everything above competes for the same scarce resource: the owner's attention and review
time. The highest-value work is not on the list.

**What is not on the list but should come first.**
- G-a, G-b and G-c (grader credibility).
- The tilt proxy.
- The spot bank (F14), which unlocks phase-4 content and real ΔEV.
- Enough content volume to sustain any daily loop.
- The G4 reason-grader validation that Open question 3 has been waiting on: "hand-label ~100 real reason
  lines".
- Merging the glass redesign.
- The schema fix.

Each of these makes Offsuit better at being Offsuit. None of them is in the brief.

---

## The strongest single objection

The proposal builds a large reward layer around a grader that, by the repo's own measurement, cannot pick
a unique best action on almost half of all decisions (47.7% ties, 39.3% no opinion), was "actively
harmful" one commit before it was "helpful", uses one villain range for every street and archetype, and
barely grades preflop. And the product has no way to tell whether the layer helps, because there is one
user, no telemetry by design, and the best evaluation on offer can only detect engagement changes, not
learning. So the expansion would make the app's least reliable signal louder and more consequential, in
the one domain (gambling) where reward loops do the most harm. It would also rewrite a spec whose
anti-gamification line has already been crossed once without a record. You cannot sell "worth doing" for
something whose worth you cannot observe, built on a signal you have not yet earned the right to
celebrate. Fix the grader and decide how you will know, and the conversation changes. Until then, every
streak day and every certified card is partly a celebration of Monte Carlo noise and tie-breaks.

---

## The minimum version I would accept if forced

These are ordered; each step is gated on the previous one.

1. **Housekeeping that is right regardless.**
   - Record the 2026-08-14 decision in `DECISIONS.md` and correct the v2.1 text that calls
     `BANNED_PHRASINGS` "UNTOUCHED".
   - Add `schemaVersion`, unknown-key passthrough, snapshot-before-migrate and a downgrade guard.
   - Fix the UTC day in `career.ts`.
   - Add an 18+ statement at first launch.
   - Merge the glass redesign.
2. **Grader credibility.**
   - Ship G-a (a close band with no bb figure), G-b (charts preflop) and G-c (villain range by archetype
     and street).
   - Re-run Experiment 1 and publish the new tie rate and the per-lineup sign of the veto arm.
   - Ship the tilt proxy.
3. **A written v2.2 amendment of one page.**
   - One streak unit: the weekly Rhythm, with built-in rest days, no reset-to-zero and no notifications.
   - No currency, no shop, no randomness, no leagues, no campaign, no social, no pro tools in this round.
   - The praise, trait and silence rules unchanged.
   - Content caps written in, for example ≤150 lines and ≤12 cosmetics.
4. **One vertical slice, behind a switch, off for nobody and removable by everybody.**
   - The Rhythm shown on Home from the existing `career.ts` cadence, with zero net height.
   - The Rulebook (strategist F5): accepted lexicon sentences as cards whose finish shows retention. It is
     the only collectible that is literally the learning.
   - A small set of paint-only felts and card backs (about 6), unlocked directly by existing milestones.
   - One dealer-voiced character, if the owner still wants one after seeing a static SVG mock for a week.
     It gets a fixed bank of ≤60 lines, silence on free grades, no in-hand words, and absence in
     PLM/assessment.
   - The learning scientist's teach-the-Dealer protégé mode as the character's one real job, because it
     is the only character mechanic with a learning mechanism behind it.
5. **A pre-registered evaluation.**
   - A four-week ABAB with the kill criteria written before the first week.
   - The criteria: assessment RW EV loss and day-21/30-45 probe accuracy must not worsen, and streak-save
     sessions must not be lower quality.
   - If the guardrails hold and the owner practised more days, build the next slice. If not, switch it
     off and keep step 1 and 2, which were worth doing anyway.

Everything else (seasons, a cast of rivals, quests, leagues, a seven-slot wardrobe, Chalk, story mode, HH
import, ICM) waits until step 5 produces a result. That is where the owner should demand the pitch earn
its next yard.
