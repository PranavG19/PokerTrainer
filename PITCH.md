# PITCH — why build The Back Room

*For a skeptical owner. Claims are labelled: **[evidence]** for published research, carrying the confidence
tag the source gave it: *verified* (TEACHING-METHOD.md), *confident* or *recalled* (the learning scientist's
report). No citation was re-checked online in this session. **[repo]** is something the code shows, and
**[speculation]** is a forecast. There are no invented statistics.*

---

## The short version

Offsuit already has the hard part, which most trainers never build: a teaching engine. Commit-before-feedback,
flat spaced repetition, confidence routing, contrast sets, a reason gate, the learner's own rule sentences, and
a coach that knows when to stay silent. **[repo]** What it lacks is the reason to come back on day 7, and a face
that makes the engine's discipline feel like a person, not a lint rule.

The Back Room adds three things: a character (Dee) who delivers the engine's existing verdicts and asks its
questions, a humane habit loop (the Lamp) built around the spacing schedule, and an earn-only identity layer.
Together they make the method usable by a human with a job.

It has to be built in one order: **fix the grader first, ship a small honest core, measure it, then go big.**
Below is the case for doing all of it. It answers the skeptic's ten objections ([`panel/skeptic.md`](panel/skeptic.md))
in their order of strength.

---

## 1. Why this, why now

**A spaced engine only works if the learner returns.** The schedule in `schedule.ts` sends concepts back at
days 0, 1–2, 7, 21 and 30–45. **[repo]** Distributed practice and practice testing are the two techniques
Dunlosky et al. (2013) rate as high-utility **[evidence, confident]**, and equally spaced retrieval beats
expanding intervals for long-term retention (Karpicke & Roediger 2007) **[evidence, verified]**. But every one of those findings
assumes the learner shows up at the interval. Today, nothing in Offsuit gives anyone a reason to open the app
on day 7. The Lamp and the daily Ticket exist for that one job: getting due reviews done on time. Their
streak counts **appointments kept**, not time spent, and a day with nothing due counts as rested.

**Feedback quality is the second lever, and Dee is built around it.** Bare right/wrong feedback measures at
d = 0.05, while elaborated feedback measures at 0.49 (Van der Kleij, Feskens & Eggen 2015)
**[evidence, verified, as cited in TEACHING-METHOD.md]**. Every line Dee says is elaborated: the price needed, the share
you had, the mechanism. It is never "wrong!". Feedback aimed at the task helps, and feedback aimed at the self
can hurt (Kluger & DeNisi 1996) **[evidence, verified; the effect sizes are recalled]**. That is why Dee's ban list is the engine's ban list: no "you
are…", no praise attached to a correction.

**A character makes the existing rules legible.** The silence rule ("no comment means it cost under 0.5 bb")
is right, but a blank panel is easy to misread as the app not working. A button that visibly stays seated
when a decision was free teaches the convention in the first minute. **[speculation]** It is a design bet,
not a measured effect. Lester et al. (1997) described the "persona effect" on liking **[evidence, confident]**;
later work, such as the Schroeder et al. (2013) meta-analysis, found small effects on learning
**[evidence, recalled]**. Dee is therefore not built to teach
better than the engine. It is built to make the engine's teaching land.

**The market gap is real.** Solvers (GTO Wizard and others) are powerful and cold. Course sites are video.
Trackers measure but don't teach. No poker product combines a real teaching engine with a daily habit loop
that refuses to reward results. **[speculation, product-strategist §5]**

---

## 2. Answering the skeptic, strongest first

**1. "You'll be celebrating a noisy grader."** This is the strongest objection, and it is correct about
today. In Experiment 1, the grader had no opinion on 39.3% of decisions, and the policies tied on 47.7% (70.1%
in another population). The grader uses one villain range everywhere, barely
grades preflop, and applies hard bb thresholds with no noise band. **[repo]**
**Answer:**
- **Wave 0 fixes the grader before any reward exists:** a close-spot band, preflop grading from the charts,
  villain ranges by archetype and street, then a re-run of Experiment 1.
- **Rewards are designed to need the grader as little as possible.** Reps pay for a full commit, a reason
  line, a due review done on time, a sentence written, and a contrast set finished. None of those depends on
  the verdict being right. The verdict-dependent grants (Sure-and-right, a repaired confident error) are a
  minority, and close spots pay nothing extra.
- **Dee says nothing on a close spot.**
- **The Wave 0 exit criterion is a judgement the owner makes on the Experiment 1 re-run.** If the grader
  isn't fit, the character ships pose-only and rewards wait.

**2. "With one user and no telemetry, nobody will know if it worked."** **Answer:** the local trial harness
(WP 1.8):
- Four weeks, alternating weeks on and off, with a written prediction and **kill criteria written in
  advance**.
- Learning: assessment EV loss and decay-probe accuracy must not get worse with the layer on.
- Gaming alarms: the Sure rate rising while Sure accuracy falls; farming of mastered items; late-night
  sessions.
- Wellbeing: more than two sessions a day; an optional "wanted to / had to" self-report.

If any criterion trips, the layer goes off by default. This is n = 1, so it can detect harm and engagement
change, not prove a learning gain. We say so instead of pretending otherwise. **[speculation that it is
sufficient]**

**3. "It rewrites the product's soul."** **Answer:** it keeps every rule the soul is made of:
- silence when a decision cost nothing
- commit before feedback
- no claims about the person
- nothing locked (N1)
- one suggestion, never a queue (N2)
- the pot is never the score
- no comparison with other people

What changes is the non-goals list, and this is a real reversal, not a footnote. The v2.1 amendment says the
reward for climbing is "a deeper, harder game … never chips-for-power, cosmetics, or a shop". D1 overturns the
"cosmetics" half of that, and D18 overturns the bans on ICM, hand-history import and leaderboards. Both are the
owner's call. Separately, the code lifted the banned words on 2026-08-14 without a spec entry. **[repo]** That
drift exists today, and D1 fixes it in writing either way.

**4. "Agents don't make taste, decisions or playtesting fast."** **Agreed. It is in the plan.**
BUILD-PLAN's last table lists what stays slow: 18 owner decisions (down from about 65 raised), art direction,
about 400 lines read by a human, a four-week trial, legal review, and a 45-minute e2e suite on every
integration. The swarm compresses the parts that are mostly typing: pure core modules, specs, screens. The
plan serializes the shared files so the diff stays reviewable, and integrates in about five commits per
wave, each with the full suite green.

**5. "This is a poker product. Gambling adjacency, minors."** **Answer:**
- Nothing is ever bought, nothing is random, and nothing has value.
- Chips never convert to anything; branded types and an isolation test enforce that.
- There are no coin showers, gold, reels, jackpots or "one more hand".
- There is an 18+ statement (D11).
- Pro-tool imports of real-money hands earn nothing, and bankroll views are Moonshot-gated behind a
  responsible-gambling review.

The economy report lists 20 regulatory risks to verify. The design keeps clear of each one by construction,
and this pitch does not claim legal clearance.

**6. "The maintenance treadmill: content, pins, migrations."** **Answer:**
- The schema work fixes a **latent data-loss bug that exists today**. `deserialize` drops unknown keys, so
  any future field is at risk. **[repo]** That work is worth doing even if the rest is cancelled.
- Content is data, linted in CI.
- Seasons ship in the build and then archive, so there is no live-ops calendar.
- Cosmetics are paint-only and proven by `theme.spec` with zero layout delta.

**7. "It dilutes the serious-trainer identity."** **Answer:** the layer can be switched off (the Character
and Celebrations switches), and serious players get a whole pillar of their own: hand-history import, a leak
finder with honest confidence bands, ICM, push/fold. Nothing for them comes at the cost of the character, and
Dee's tone is drier than most solvers' UI copy.

**8. "Mascots are tacky next to premium glass."** **Answer: look at the mocks.** Dee is a glass disc with an
engraved D. It uses the role colours, perches without its own glass, and is never on the felt. Its motion is
capped at 1.6 s and celebrations happen at session end only. That standard is the same one the glass rounds
were held to, at both window sizes ([gallery](demo/vision/index.html)).

**9. "Leagues are hollow offline."** **Agreed for global leagues.** That is why they are a Moonshot behind
D3. The Ghost Rail (your past weeks plus labelled fictional regulars) and the LAN Club are honest about what
they are, and nobody is ever demoted.

**10. "Opportunity cost."** **Answer:** look at what Wave 0 consists of: grader fixes, the tilt check the spec
already promises, the local-day bug, the schema guard. Every item is overdue work that serious users need
anyway. The Bold and Moonshot tiers are bought only after the trial says the core earns its keep.

---

## 3. What each pillar unlocks

| Pillar | What it unlocks | Confidence |
|---|---|---|
| Truth first | A grader trustworthy enough to drive feedback and, later, rewards; fixes problems that exist today | high **[repo]** |
| Learn | Lessons as dialogue (Interrogator first); Folio turns self-explanation into a keepsake. Self-explanation is one of the strongest findings in the method (Chi et al. 1989, in TEACHING-METHOD.md). | evidence-backed mechanism; effect in Offsuit **[speculation]** |
| Play | Dee at the table makes silence legible; "Price held" makes calibration visible | **[speculation]** |
| Progress and streaks | Return on the due day; rest days protect spacing. A single missed day doesn't derail habit formation (Lally et al. 2010) **[evidence, confident]**, which is why there is no reset-to-zero. | mechanism **[evidence]**, size **[speculation]** |
| Character and story | A reason to try a hard chapter: rivals make archetype exploits memorable | **[speculation]** |
| Cosmetics | Identity without a casino: receipts that mean something. Expected tangible rewards can undermine intrinsic motivation (Deci, Koestner & Ryan 1999) **[evidence, confident]**, which is why cosmetics are informational receipts first and Chalk waits for the trial. | risk-managed |
| Social | Home games become study nights, over the LAN that already exists | **[speculation]** |
| Pro tools | Credibility with serious players; imported leaks become drills | high demand **[speculation]** |

**On Duolingo:** Duolingo has publicly credited streak mechanics with much of its retention in its own posts
and earnings materials. **[recalled, not independently verified]** That is an engagement claim, not a
learning claim. The Back Room borrows the habit loop and rejects the parts that would harm learning here:
hearts, loss-framed warnings, leaderboards, and an owl-like mascot.

---

## 4. Why swarms change the calculus

- **Wave 1 is about 48 agent-hours** of package work over 14 packages. With 6–8 agents in parallel, that is
  about one to two days of wall-clock, plus about five integration runs of the 45-minute suite.
  **[speculation, BUILD-PLAN]**
- **The precedent is in this repo.** The glass redesign this branch is cut from is 24 commits, +6,588/−3,724
  lines, with 551 e2e tests passing on its final run (`PR-DRAFT.md`), built with this repo's agent workflow
  (`AGENTS.md`, the verify-app skill, an independent review). That attribution is **[recalled from the repo
  setup, not measured]**. This panel is one session's work: eight reports of about 45,000 words, and eleven
  mock screens at two sizes. **[repo]**
- **So the cost is no longer the code. It is decisions, taste and evidence.** The plan front-loads exactly
  those: 18 decisions, one art direction, one trial. If the trial fails, the loss is about 2–4 days of agent
  time and one schema change that was worth making anyway.

---

## 5. Recommended first wave

**Wave 0 plus Wave 1 Core, behind a four-week trial:**
1. Sign D1 (the scoped v2.2 amendment), D2 (schema v2), D5–D9, D11 and D16.
2. Wave 0 in full: the grader fixes, the tilt check, the local day, the schema guard, the 18+ statement, and
   the Experiment 1 re-run.
3. Wave 1:
   - Dee (pose-only in-hand, the hand-end beat, "Price held" if D6 is approved)
   - lessons as dialogue
   - the Lamp with Rhythm and spare wicks
   - Reps and Seals
   - receipt-only cosmetics (backs, felts, Dee rims)
   - Today's Ticket, Folio, Profile, and the navigation
   - the trial harness
4. **Not yet:** Chalk, the Long Orbit, the Ghost Rail, Pro tools (D18), LLM flavour. Story and Pro are the
   first Bold packages if the trial passes, and they can be built in parallel the week after.

If the trial trips a kill criterion, the layer stays off by default and Offsuit keeps a better grader, a safer
profile and a tilt check. **There is no losing branch that leaves the product worse.**
