# FINDINGS — The Back Room (character, habit and identity vision)

## Outcome
- **The design:** Offsuit gets a visible teacher, Dee the dealer button. Dee is a glass disc whose engraved D
  changes shape to show expressions. Around Dee sit a humane habit loop (the Lamp: lit days, rest days that
  never break the run, weekly Rhythm, earned spare wicks), effort points that are never spent (Reps), Seals
  for mastery, earn-only paint-only cosmetics, a six-rival campaign (The Long Orbit), and pro tools. It is
  local-first, with no money, no randomness and nothing locked.
- **Order:** Wave 0 fixes the grader, adds the tilt check and the schema guard first. Wave 1 ships Dee, the
  Lamp and receipt cosmetics behind a four-week on/off trial with kill criteria. Story, Chalk and Pro follow
  only if the trial passes.
- **Status:** design and mocks only. Nothing under `src/` changed, nothing was installed, nothing was pushed.
  The mocks render at both window sizes with no console errors, no network and no page scroll.

## Decisions to evaluate
- **Mascot = Dee (the button).** If overruled: Tell (a chip) or Pip (a human dealer), and the rig and every
  mock are redrawn.
- **"Price held":** Dee acknowledges a hard spot played right, with the numbers, on close spots only. If
  overruled: Dee is silent on every correct decision.
- **Dee adds no words in-hand** (pose only; one line at the hand-end beat). If overruled: it breaks the coach's
  word budget and the silence rule.
- **Receipts first, Chalk (an earn-only currency) after the trial.** If overruled: Chalk in Wave 1, with
  more grind risk.
- **Streak = the Lamp, counted in kept weeks against a chosen Rhythm.** If overruled: a daily streak, which
  fights the spacing schedule.
- **A 9-tab navigation** (Home, Play, Learn, Story, Train, Study, Pro, Locker, Profile). If overruled: keep
  the 11 tabs, with Story and Locker nested.
- **Lamp and ring colour = white light plus chip tone,** never mint or amber. If overruled: a new "habit"
  hue token (lilac was proposed).
- **The daily Ticket is under 30 minutes** (the spec bans sub-30-minute sessions). If overruled: the daily
  loop is the 30-minute plan.

## Open questions
- **A v2.2 spec amendment** bringing effort XP, a humane streak and cosmetics into scope, and reconciling the
  2026-08-14 code-versus-spec drift. Reserved for the owner. Default taken: designed only.
- **The persisted profile schema change** (`schemaVersion` plus a `progression` namespace). Reserved for the
  owner. Default taken: not made. Note that the current `deserialize` already drops unknown keys.
- **Any backend** for global leagues, friends or sync. Default taken: none (Ghost Rail, LAN Club, profile
  export).
- **Do the grader fixes gate the rewards?** Default taken: yes (Wave 0 exit criterion).
- **An 18+ statement.** Default taken: yes, proposed.
- **Pro import of real-money hands.** Default taken: review and counting stats only, no profit/loss, earns
  nothing.
- **A second amendment for the other non-goals** (ICM, hand-history import, leaderboards), which gates Pro
  tools and the Ghost Rail. Default taken: Wave 2, after the trial.
- **LLM flavour for Dee's lines.** Default taken: off by default; guarded; scripted fallback.

## Alternatives rejected
- A daily reset-to-zero streak, which would fight flat spacing and add streak anxiety.
- Loot boxes, random drops or bought currency, for gambling adjacency.
- Global leagues at launch, which would break no-network.
- Lottie, Rive or 3D for the character, which need CSP changes or new dependencies.

## Evidence
- Synthesis: `VISION.md` (the cast, interaction model, feature list by pillar, economy, the D1–D18
  decisions), `PITCH.md`, `BUILD-PLAN.md`.
- Panel: `product-strategist.md`, `learning-scientist.md`, `character-designer.md`, `economy-designer.md`,
  `ux-motion-designer.md`, `poker-domain-expert.md`, `technical-architect.md`, `skeptic.md`.
- Review: `code-review.md`.
- Mocks: `index.html` (the gallery), `gallery.png`, and `character-`, `home-`, `table-mistake-`,
  `table-great-`, `lesson-`, `celebrate-`, `locker-`, `story-`, `profile-`, `pro-import-` and `pro-icm-`
  at `1100x760.png` and `900x640.png`.
