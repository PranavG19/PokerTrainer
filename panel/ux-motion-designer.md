# Panel: UX and motion designer — a character, a daily rhythm and cosmetics inside the glass system

Lens: rendering, placement, motion, celebration, onboarding, cosmetics, colour roles, accessibility.
Sources read: `AGENTS.md`, `demo/glass/tokens.css`, `demo/glass/glass.css`, `demo/glass/home.html`,
`DECISIONS.md` (glass, sheets, motion, theme, round 3 change log), `src/renderer/styles-glass.css` (header,
"Shared primitives", table stage, coach sheet, reduced-motion block), `screens/home.ts`, `table.ts`,
`lesson.ts`, `review.ts`, `components/coachPanel.ts`, `tutorRail.ts`, `thumb.ts`, `sound.ts`, `index.html`
(CSP), `research/DESIGN-NOTES.md`, `PRODUCT-SPEC.md`, `src/core/progress.ts`, `tests/e2e/coached-handover.spec.ts`.

---

## 0. Read this first: three conflicts the owner has to rule on

The brief is "Duolingo, wacky and ambitious". The repo already says no to parts of it, on purpose. I design
for the brief below, but every spec here assumes the owner rules on these three first.

1. **The spec bans streaks, XP and cosmetics.** `PRODUCT-SPEC.md:542` lists "leaderboards, XP, streaks,
   cosmetics, a shop" as non-goals. The v2.1 amendment (`PRODUCT-SPEC.md:544-546`) says the reward for
   climbing is "a deeper, harder game … never chips-for-power, cosmetics, or a shop". The tutor guard
   (`PRODUCT-SPEC.md:306`) lints "streak/rank/percentile language". `SPEC.md:43` repeats it.
   **Decision needed:** a v2.2 amendment, written the same way v2.1 was: say what changes, and keep what the
   ban protects (no reward for chip luck or for showing up without deciding). My design takes that line.
   Streak credit comes from graded decisions, never from chips. Nothing is ever bought. No reward is random.
2. **The silence rule.** A `free` grade produces no output (`coachPanel.ts:5-11`), and `sound.ts:5-8` refuses a
   "you were right" chime because it would be the only channel announcing a free grade. **So the character
   must not nod, smile or sparkle after a correct decision.** If it did, it would be a second coach that
   breaks the first coach's best rule. My spec has the character react per hand only when the coach speaks.
   Rewards build up per sitting and per day, never per hand.
3. **Words.** `BANNED_PHRASINGS` (`src/core/progress.ts:448`) bans "great job", "well done", "keep it up" and
   "you are". The guard bans praise next to a correction. The character's lines go through the same fixed
   string table and the same guard, with no exemption for a mascot. In the UI, "XP" becomes **reps** (graded
   decisions) and the streak becomes **the stack** (days in a row with at least one sitting). Whether the
   word "streak" may appear in UI copy is the owner's call. I avoid it below.

Working name for the character: **Tell**. It is a matte ceramic poker chip with two ink eyes. A tell is what
you read at the table, and Tell reads you back. The name avoids every banned word ("nit" was the obvious pun,
and it is banned).

---

## 1. How the character is rendered

### Options against the constraints
The constraints: no new runtime dependencies without approval, a CSP of `default-src 'self'; script-src 'self'`
(`index.html:5`), so no `unsafe-eval`, no `wasm-unsafe-eval`, no `data:` images, no network
(`no-network.spec`), and a GPU budget the glass already spends ("at most 2 blurred layers", `DECISIONS.md:640`).

| Option | Fit | Blocking problems |
|---|---|---|
| **Inline SVG + CSS + Web Animations API** | Zero dependencies. Allowed by the CSP (inline `<svg>` is DOM, and `element.animate()` and `style` are allowed under `style-src 'unsafe-inline'`). Themeable with custom properties, so cosmetics stay paint-only. Crisp at any DPR. Testable with Playwright like any DOM. | It needs a small hand-built rig and pose system (~300 lines of TS). Expressive range comes from the design, not from a tool. |
| Lottie (`lottie-web`) | Rich After Effects motion. | A new dependency. The full build uses `eval` for expressions, which the CSP blocks (the light build is required). JSON-driven colours fight token theming. It needs an AE pipeline that nobody here has. It plays one-way timelines, so state blending is weak. |
| Rive | The best interactive state machines. Small files. | The runtime is WASM: it needs `'wasm-unsafe-eval'` in `script-src` (a CSP change) and a self-hosted `.wasm` (the default runtime fetches from a CDN, which breaks `no-network`). It adds a dependency, an editor, and a canvas that does not theme through CSS. |
| 3D (three.js) | The most "wacky". | About 600 KB. WebGL competes with `backdrop-filter` for the GPU. `deal-perf.spec` exists for a reason. Lit 3D next to flat glass reads as a game, not a tool. Screen readers and reduced motion are all hand-built. |

### Recommendation: SVG + CSS + WAAPI, built in-house
- **Asset:** one inline `<svg viewBox="0 0 64 64">` symbol set in a new `components/tell.ts` (same pattern as
  `components/glyphs.ts`). The parts are separate `<g>` elements, each with its own `transform-origin`:
  `body` (the chip disc), `edge` (the 8 inlay notches on the rim), `eyeL`/`eyeR` (rounded rects, so blinks
  scale Y), `lids` (for squint and content), `shine` (a specular arc), and `acc` (an accessory slot,
  §6).
- **Poses** are WAAPI keyframe sets on those parts. **Expressions** are a small state machine in TS:
  `idle | look(dx,dy) | blink | think | attentive | content | sleep | roll`. Every animated property is
  `transform` or `opacity`, so nothing reflows and it all runs on the compositor.
- **Depth without 3D:** the chip is drawn in three tones (`--chip-a` face, a darker rim band, and the `shine`
  arc in `oklch(1 0 0 / .35)`). Faking a turn is `scaleX(cos θ)` on the body, plus swapping the visible face
  at 90°. That is how the "flip to show its back" trick works with no 3D at all.
- **Rive later:** if the owner later wants richer motion, Rive is the only upgrade worth it. It is a dependency
  plus a CSP edit (`'wasm-unsafe-eval'`) plus a self-hosted `.wasm`, and those are three owner approvals. Keep
  the `components/tell.ts` API (`tell.express('attentive')`) so the renderer can be swapped behind it.

---

## 2. Where Tell lives, and how big it is

### Sizes (fixed tokens, so no orphan sizes)
Add these to `styles-glass.css` `:root` as geometry tokens. They are theme-invariant, as `theme.spec` requires.

| Token | px | Use |
|---|---|---|
| `--tell-xs` | 16 | Inline voice marker next to a line of text (tutor turns, review notes) |
| `--tell-sm` | 24 | The perch in the title bar; the sheet rim |
| `--tell-md` | 44 | Home greeting, in the headline row |
| `--tell-xl` | 128 | Onboarding and the celebration sheet only |

The eyes stay at least 2px wide even at `--tell-xs`, so the character reads as a face and not a dot. Below
16px, don't render Tell at all.

### The perch: a home that costs zero height
The title bar `.tabs` is 44px (`--nav-h`). It must stay at most 52px (pinned), and it has empty space on the
right. **The perch** is a 32×28 button on the right of the tabs:
- It contains the `--tell-sm` chip, then **the stack count** (12/500 tabular `--ink-1`, for example "12"), then
  a 20px **day ring** drawn around the chip (see §4).
- It has no glass of its own. It sits in the coat with `--fill-0` at rest and `--fill-1`/`--fill-2` on hover
  and press (the one state ramp), with `--r-ctl`. It is a button and an app-region exception
  (`-webkit-app-region: no-drag`).
- Its background is never bone. `coached-handover.spec.ts:308-313` counts every button whose background is
  `rgb(244, 242, 236)` as the primary. The chip face is `--chip-a #D9D4C8` on a transparent button, so the
  one-primary pin is safe.
- Clicking it opens **the Tell popover**: a `--float-sheet` float, 300px wide, `--r-sheet`, anchored under
  the perch. It shows today's ring, the stack, the next unlock, and "Ask Tell" (which goes to the tutor rail's
  rules-only path). While the popover is open it is the screen's only blur. It does not open over a coach
  sheet; the perch is inert while one is up.

### Per screen
**Home (`screens/home.ts`)** has no float and is built 640px-exact, so Tell borrows space that already exists.
- **Greeting:** `--tell-md` (44px) at the right end of `.home-headline`, bottom-aligned with the bankroll's
  label row. The row is already about 52px tall (34px hero plus label), so this costs no height. At 900px the
  headline column is about 420px wide and the bankroll plus standing use about 260px, so 44px fits.
- **Tell voices the recommendation.** The "Suggested next" label becomes a `--tell-xs` marker plus "Suggested
  next". The suggestion text is what Tell says. The character becomes the launcher's voice without adding
  anything new to the screen. The one primary on Home (the planner's bone Start) is untouched. Tell's eyes
  glance toward it once on load (look, 320ms) and then rest.
- At 1100×760 the extra height goes to recent hands, as it does today, and not to Tell.

**Table (`screens/table.ts`)** has two inviolable areas: the felt and the dock's primary.
- **At rest Tell is not on the stage at all.** It sits on the perch in the title bar. The felt is the table's
  alone ("felt green = the table only"), and a sixth face on the stage would read as a seat. Seats already have
  quoted chatter (`.seat-talk`).
- **When a coach sheet rises, Tell rides it.** Tell hops from the perch and **sits on the top rim of the
  `.coach-sheet`**: `--tell-sm`, centred 24px in from the sheet's left padding, 10px above the rim and
  overlapping it. This is the "glass perch". The sheet is the coach, so the coach gets a face exactly when it
  speaks. It sits above the blurred, dimmed stage (`styles-glass.css:1457`), never on live felt, and it adds no
  blur layer. The severity glyph and the word "Serious"/"Notable" stay as they are, because Tell does not
  replace a non-colour cue.
- **Gate sheet:** Tell is `think` (eyes up and left, lids at 30%) and still. Nothing moves near a timed field.
  The gate bar is the one thing that drains (`DECISIONS.md:140`).
- **Uncoached mode:** Tell stays on the perch and never reacts per hand.
- **Never:** on the dock, on a seat, over the board, or overlapping `.table-corner-r` (the Coach switch has to
  stay reachable over a sheet, z-index 6).

**Lesson (`screens/lesson.ts`, `tutorRail.ts`)**: a 640px column that scrolls inside itself.
- Each tutor turn in `.lesson-rail` gets a `--tell-xs` marker before its head. The provenance line
  (`answeredBy`, `tutorRail.ts` guarantee 3) stays under every answer word for word. **Tell must never imply it
  wrote an answer that came from the notes**, so the marker is the rail's identity and the provenance is the
  truth.
- A pending answer shows Tell in `think` with lids that breathe 30% → 45% (1.6s, `--ease`, alternate). This
  replaces any spinner.
- Finishing a chapter triggers the "seal" (§4) on the lesson row in the list, not a full-screen takeover.

**Review (`screens/review.ts`)**
- A `--tell-sm` at the right of `.review-head`, in line with the progress count.
- Each `.review-verdict` note gets a `--tell-xs` marker. Tell turns to look at the street being shown
  (`look(dx)`, 220ms) when the learner steps forward or back. That is the one place where gaze is
  informative, because it points at the change.

---

## 3. Micro-interactions

### New motion tokens
These go next to the existing `--ease`, `--ease-spring`, `--ease-deal` and `--dur-1/2/3/deal`:

```css
--ease-arc: cubic-bezier(0.45, 0, 0.2, 1);   /* in-out: ring draws, hops along an arc */
--dur-4: 480ms;                               /* seal deboss, hop */
--dur-ring: 900ms;                            /* a ring segment closing */
--dur-moment: 1600ms;                         /* the longest celebration, in total; a hard cap */
```

### The table of interactions
"RM" is the behaviour under `prefers-reduced-motion: reduce`. Everything is transform and opacity only.

| Moment | What happens | Duration / easing | RM |
|---|---|---|---|
| Idle | Blink (eyes `scaleY 1 → .1 → 1`) every 4–9s at random. No other loop. | 140ms `--ease` | No blink; eyes static |
| Idle at the table, hero to act | **Suspended.** Not even a blink. The breathing your-turn dot (2.4s) is the only loop on screen (`DECISIONS.md:593`). | n/a | n/a |
| Hover the perch | Chip tilts 6° toward the cursor and the shine slides 2px | `--dur-1` `--ease` | Fill ramp only |
| Poke Tell (click the face) | A wobble: rotate −8° → 5° → 0 | `--dur-3` `--ease-spring` | None, but the popover still opens |
| Commit (any action) | **Nothing per decision.** If a sheet is about to open, Tell starts the hop (below) | n/a | n/a |
| Hop from perch to sheet rim | FLIP: x and y on separate keyframes so the path arcs, with a 1.06 → 1 squash on landing. It starts 60ms after the sheet's `coach-rise` (320ms) and lands as the rise ends. | `--dur-4` `--ease-arc` (x), `--ease-deal` (y) | 120ms crossfade: out on the perch, in on the rim |
| Verdict, Notable | `attentive`: eyes widen to 1.15, a 2px lean toward the text | `--dur-2` `--ease` | Expression swaps with no motion |
| Verdict, Serious | `attentive`, plus the lids drop 15%. **Concentrating, not sad**: no frown and no tears. | `--dur-2` `--ease` | Expression swaps |
| Sheet closes | Hop back to the perch, reversed | `--dur-3` `--ease-arc` | 120ms crossfade |
| Rep tick (end of hand, graded decisions counted) | The day ring advances by the reps earned this hand, in one step and in silence. **Not per decision, and not tied to a correct grade**: a mistake counts as a rep. | `--dur-3` `--ease` (stroke-dashoffset is paint-only) | Jumps to the final value |
| Stack tick (first sitting of the day) | One chip drops onto the stack glyph in the perch: translateY −6 → 0 with a settle, and the count changes with a 4px vertical slide | `--dur-deal` `--ease-deal`, then count `--dur-2` | The count changes in place |
| Quest complete ("Today's three", §4) | The quest row's leading circle fills with `--chip-a` and a check draws in `--ink-on-bone` | Fill `--dur-2`, check `--dur-3` `--ease-arc` | Final state at once |
| Tutor thinking | `think`: lids breathe | 1.6s alternate `--ease` | Static `think` pose |
| App idle more than 2 min | `sleep`: lids closed, all animation stops | `--dur-3` | Pose only |

Rules for the implementer:
- Every animation is cancelled on `visibilitychange` (hidden) and while `[data-sheet]` is a gate.
- At most one Tell animation runs at a time. A new one cancels the old one with `commitStyles()`, so it never
  jumps.
- Add the new selectors (`.tell *`, `.perch *`, `.tell-moment *`) to the reduced-motion block at the foot of
  `styles-glass.css:1675`, and mirror that in JS with
  `matchMedia('(prefers-reduced-motion: reduce)')` before every `animate()` call.

---

## 4. Celebrations that feel premium

The model is Apple Fitness closing a ring: one shape, drawn by light, that finishes. Not a fountain of
rewards.

### The three rings → one ring, the Day ring
One ring around Tell on the perch (20px diameter on the perch, 112px in the moment sheet). It measures **today's
three**, which are three daily goals chosen deterministically from the learner's plan:
1. a sitting of at least N graded decisions,
2. one lesson step or review,
3. the recommender's suggestion done.

There are three arcs of 116° each with 4° gaps, so the three goals are visible as segments. That is closer to
a watch's ring segments than to a progress bar.
- Track: `--fill-1`, 2px on the perch and 8px in the sheet, with a round cap.
- Progress: `--chip-a` (ceramic, a physical object; see §7 for why it is not mint or amber).

**Closing the ring (all three done):**
1. The final segment draws (`--dur-ring` `--ease-arc`).
2. A specular highlight, `conic-gradient` from transparent through `oklch(1 0 0 / .55)` back to transparent,
   rotated once around the ring: 600ms `--ease`, at opacity only.
3. Tell goes `content` (eyes become arcs, ^ ^): 300ms.
4. The perch count stays still. Total is about 1.5s, under `--dur-moment`. No sheet and no sound. It happens in
   the title bar and gets out of the way.
- RM: the ring shows closed, Tell shows `content` for 2s, and nothing sweeps.

### Stack milestones (7, 30, 100, 365 days)
A **moment sheet** is the only full celebration. It is a centred `--float-sheet` float, 360px wide,
`--r-sheet`, over `--scrim`, and it opens **only at a natural pause**: on Home, or after a sitting ends. Never
mid-hand, and never over a coach sheet.
- `--tell-xl` Tell stands on a stack of real chips (the active chip set, §6). The milestone's chips drop onto
  the stack one at a time: each `translateY(-24px) → 0`, `--dur-deal` `--ease-deal`, staggered 70ms, **at most
  7 chips drawn** even at 365 (larger milestones get a taller stack drawn once, not more falling chips).
- The headline is 22/600 `--ink-1`: "30 days at the table." The caption is 13 `--ink-2`, with the fact and
  nothing else: "1,240 decisions graded since 12 Sept." The guard's provenance rule fits here, because every
  number comes from the record.
- One bone primary, "Back to it" (Esc and ↩). If the milestone unlocked a cosmetic, a secondary "Try the new
  felt" button.
- Total motion is at most `--dur-moment` (1.6s), and then everything rests. No loop.
- RM: the stack is drawn complete and the sheet appears with a 120ms fade.
- Sound (only if the learner turned sound on): one soft ceramic "clack". Two filtered noise bursts at 30ms
  each, peak gain 0.06 (below the 0.09 mistake cue in `sound.ts`). Never a rising arpeggio, because that is the
  slot-machine signature. This is a second cue in a module that was designed for exactly one, so it needs owner
  sign-off.

### Depth promotion (the existing "standing", for example "40bb → 60bb table")
The spec already says the reward is a deeper game. Make the felt itself the celebration. On the first hand at
the new depth, the lamp pool (`--lamp`) widens from 62% to 72% radius and settles back over 1200ms
`--ease-arc`. The pot caption reads "60bb table" in `--ink-2` for that hand. Tell does not appear. The table is
the reward. RM: no lamp motion, and the caption alone.

### Chapter clears (lesson phases)
**The seal.** The finished phase's row in `.lesson-list` gets a 20px ceramic seal (a `--chip-a` disc with the
chapter's suit glyph debossed in `--ink-on-bone`). It presses in: `scale(1.25) → 0.94 → 1` and the shadow
goes from `--card-shadow` to `--card-shadow-sm`, over `--dur-4` `--ease-spring`. It feels like a stamp landing
on paper. RM: the seal is just there.

### What to avoid: it reads as gambling
This is an app about a gambling game that teaches people **not** to judge by outcomes. Any reward grammar
taken from casinos teaches the opposite. Banned, outright:
- **Showers of coins or chips**, particle bursts, or confetti. Physical chips only ever *stack* (they settle
  down and rest; they never spray out).
- **Flashing, strobing or pulsing jackpot light**: nothing flashes more than 3 times a second (WCAG 2.3.1),
  and nothing should flash at all.
- **Spinning reels, wheels, odometers and count-up tickers.** Numbers change in place (§3). Never roll digits
  upward, and never animate a balance.
- **Random rewards**: mystery boxes, loot drops, "spin for a bonus", variable-ratio anything. Every unlock is
  deterministic and visible in advance in the popover ("At 14 days: Walnut felt").
- **Near-miss framing** ("so close!"), multipliers ("×2!"), and "double or nothing".
- **The red and gold casino palette**, sunbursts behind numbers, and metallic gold text.
- **Celebrating a pot won, a bankroll high or a lucky river.** That is a variance signal, and the method exists
  to delete it. Celebrations key off decisions graded and days kept, never chips.
- **Guilt as a mechanic.** No crying mascot, no "your stack is about to die!" push. Missing a day shows the
  stack as-is with a neutral line ("Fresh stack today."). **Rest days:** the learner sets their days per week
  in onboarding, and a planned rest day never breaks the stack (it shows as a hollow chip). Missing an unplanned
  day breaks it quietly.
- **Badges or trophies** (these words are banned anyway) and leaderboards.

---

## 5. Onboarding, screen by screen

The first run only. Five steps, each one a sheet over Home, so the real UI is visible behind it from the
start. Every step fits 900×640 with no scroll. One bone primary per step. A "Skip intro" tertiary is always in
the foot.

| # | Surface | Content | Motion | Primary |
|---|---|---|---|---|
| 1 | Moment sheet (360px), Home dimmed | `--tell-xl` Tell rolls in from the right edge of the sheet (`translateX(120px) rotate(200deg) → 0`, `--dur-deal`×2 = 840ms `--ease-deal`), then blinks twice. "I'm Tell. I read the table with you, and I stay quiet unless something matters." | One entrance, then rest | "Deal me in" |
| 2 | Same sheet | "How many days a week?" in a `.g-seg` (3 / 4 / 5 / 7) with the sliding thumb from `thumb.ts`. Caption: "Days you skip on purpose never break your stack." | The thumb slides (existing) | "Next" |
| 3 | Sheet over a **frozen real table** (the stage blurred as for `[data-sheet]`) | Teaches *commit before feedback* by hopping to a coach sheet rim: Tell hops from the moment sheet to the rim, which demonstrates where it will live. "When I have something to say, I'll be here. When I'm quiet, that decision was fine." This one line explains the silence rule. | Hop, `--dur-4` | "Show me a hand" |
| 4 | Handoff to `assessment.ts` (a short calibration block) | The existing assessment, unchanged. It already withholds feedback. Tell sits on the perch, asleep-ish (`sleep` pose with lids at 70%), to show it is deliberately silent. | None during the hands | (the screen's own) |
| 5 | Moment sheet over Home | The first Day ring at 1/3 (the assessment counts as the sitting). "Three a day closes the ring." The perch is highlighted: a 2px `--focus-ring`-style outline at a 2px offset, held for 2s. It is not a pulsing beacon. | Ring segment draw `--dur-ring` | "Got it" |

Tell's eyes always look toward the step's primary when the sheet opens (look, 220ms), and stop there.

---

## 6. Cosmetics within "a theme may change paint only, never layout"

`theme.spec.ts:101-122` proves a theme swap triggers **zero layout** using CDP. Cosmetics use the same
mechanism and the same proof. **A cosmetic is a set of custom properties on `html[data-felt]`,
`html[data-back]`, `html[data-chips]` and `html[data-tell]`.** Each one is orthogonal to `data-theme`. They
change paint only, and the spec is extended to swap each one and still assert `layoutDelta === 0`.

| Slot | Tokens it may set | Hard limits (so roles survive) |
|---|---|---|
| **Felt** | `--felt-a/b/c`, `--lamp`, `--rail-a/b`, `--rail-sheen`, `--inlay`, plus an optional `--felt-weave` (a `repeating-linear-gradient` paint layer) | Lightness L 0.10–0.24 and chroma C ≤ 0.04 (oklch), so no felt can read as mint, coral or amber. The hue is free at that chroma (walnut, slate, oxblood-grey). Keep 4.5:1 for the `--ink-1` pot text, and stay well inside the `--text-hi` pin. |
| **Card back** | `--back-a`, `--back-line`, `--back-pattern` (any CSS gradient: hatch, as in Offsuit's own back from `DESIGN-NOTES.md`, guilloche, houndstooth) | **Card faces are never cosmetic**: bone, `--card-red` 5.3:1 and the serif index stay fixed. No mint, coral or amber in backs. |
| **Chip set** | `--chip-a`, `--chip-b`, `--chip-inlay` | `--chip-a` L ≥ 0.80, so chips still read as physical bone-family objects. Chips are never fully bone `#F4F2EC`: that colour is the primary's. |
| **Tell skin** | `--tell-face`, `--tell-rim`, `--tell-eye`, accessory opacity flags `--acc-visor`, `--acc-bowtie`, `--acc-shades` (0/1) | Every accessory is pre-drawn in the SVG inside the fixed 64×64 viewBox and toggled by **opacity**, never `display` or `d`/`href` changes, so the box never changes. Eyes are always `--ink-on-bone` on a light face, at ≥ 7:1. |
| **Theme** (existing) | The paint block as today (`html[data-theme='obsidian']`) | Never `--text-hi` or `--positive` (pins). |

**Unlocks**, deterministic and never bought:
- Stack milestones (7 → a card back, 30 → a felt, 100 → a chip set, 365 → a Tell accessory).
- Depth promotions (a felt per depth tier: "the 200bb room").
- Chapter clears (each phase's seal suit unlocks that suit's card back).

The popover lists everything: locked items show as `--fill-1` silhouettes with the exact condition. A
**Wardrobe** section goes in Settings (one `.g-group` per slot, a live 64px preview, and a `.g-seg` to pick).
The table preview there is a miniature felt with two backs. Picking applies at once, with a 220ms crossfade
on the colour properties only.

The silly, ambitious part, done tastefully: **Tell wears the chip set.** Its face becomes the active chip
design. Poke it 7 times in 3 seconds and it flips (the `scaleX` trick, 480ms) to show the chip's back and
then flips again. It is a private joke with no reward attached. RM: no flip.

---

## 7. Colour-role conflicts, resolved

The map is in `tokens.css:62-70` and the `styles-glass.css` header. Each new element gets an owner hue or
none:

| New element | Tempting colour | Ruling | Why |
|---|---|---|---|
| The stack (streak) count | Flame orange or amber | **`--ink-1` number plus a chip-stack glyph in `--chip-a`/`--chip-b`.** No flame. | Amber already means "notable severity" and "the gate timer". An amber number in the title bar would read as a warning on every screen. A flame is Duolingo's loss-aversion signature, and "about to burn out" urgency is the guilt mechanic §4 bans. Chips are physical objects, which is bone's family. |
| Day ring progress | Mint | **`--chip-a`** on a `--fill-1` track | Mint means "your turn / positive delta / ON". A ring is a balance-like quantity, and the spec forbids mint as a balance (`DECISIONS.md:46-49`). |
| Rep gain "+12" | Mint | **`--ink-2` "+12 reps"**, or no number at all | A delta of a count is not an EV delta. Using mint for it would cheapen the one positive signal the coach owns. |
| Serious verdict reaction | Coral eyes or a coral tint on Tell | **No colour on Tell, ever.** Expression only. | Severity is carried by the glyph plus the word, already done. Tell is not a second severity channel. |
| Celebration light | Gold | **White light (`oklch(1 0 0 / .55)` specular) plus `--chip-a`** | Gold is the jackpot palette. Light is the glass system's own material (`--float-rim`, `--float-highlight`). |
| Locked cosmetic | Grey with a padlock in amber | `--fill-1` silhouette plus a 12px lock glyph in `--ink-3` | Neutral is structure. |
| Tell's body | Bone `#F4F2EC` | **`--chip-a #D9D4C8`** | Bone is the one primary action (and is measured that way by `coached-handover.spec`). Tell is a step down, and so is the stack. |

**Proposed new tokens (no new hue):**
```css
--tell-face: var(--chip-a);          /* #D9D4C8 */
--tell-rim: var(--chip-b);           /* #6F767E */
--tell-eye: var(--ink-on-bone);      /* #15171A, about 12:1 on the face */
--tell-shine: oklch(1 0 0 / 0.35);
--ring-track: var(--fill-1);
--ring-fill: var(--chip-a);
--ring-gleam: oklch(1 0 0 / 0.55);
```
**Owner option, not my default:** if the owner wants colour in celebrations, add **one** new hue with one
meaning, "a kept habit". A desaturated lilac, about `oklch(0.80 0.07 300)`, is the obvious candidate, since it
echoes Offsuit's own pastel tournament cards (`DESIGN-NOTES.md`) and is far from mint, coral, amber and felt.
It would be used only for the ring fill and the stack count's glyph. It goes in `DECISIONS.md` and the
role-map comment, in the same line style.

---

## 8. Accessibility

- **Contrast (AA):** the stack count `--ink-1` on the coat is ≥ 12:1 (per `demo/glass/contrast.md`). Captions
  are `--ink-3`, which is the existing AA floor. Non-text: `--chip-a` against the coat is well above 3:1, so
  the ring and Tell's silhouette pass 1.4.11. `--chip-b` (slate) is decoration only and never the sole carrier
  of state. Ring segments are also readable in the popover as text ("2 of 3 today").
- **Names and roles:** the perch is `<button aria-label="Tell. 12-day stack. Today 2 of 3.">` (the label is
  updated in place, not in a live region). The `<svg>` is `aria-hidden="true"` everywhere. Tell is never an
  image the reader has to describe.
- **What Tell says is real text** in the DOM, not inside the SVG. A visually hidden "Tell:" prefix goes only
  where the speaker is ambiguous (Home suggestion, review notes). In the tutor rail the existing turn structure
  already names the speaker.
- **No double announcement:** at the table the coach announcer (`table.ts:158-186`, polite) already reads the
  verdict. Tell's expressions add **nothing** to the live region. Ring and stack updates go to one polite
  region on the perch only at a pause (the end of a sitting), and never during a hand, so they never interrupt
  the hand's announcements.
- **Focus:** the perch takes the standard 2px ring at a 2px offset (`--focus-ring`). The popover and the moment
  sheet trap focus like the coach sheet: focus moves to the primary, Esc closes, and focus goes back to the
  opener. Onboarding sheets follow the same rule. The hit target is 32×28, above WCAG 2.5.8's 24px minimum.
- **Keyboard:** the perch is in the tab order after the tabs. A global shortcut is optional. If added, it must
  not collide with the table's action hotkeys (`keyboard.spec`), and it is shown as a trailing `.g-kbd` only in
  the popover.
- **Motion:** every row in §3 has a reduced-motion version. Under `prefers-reduced-transparency` the popover and
  moment sheet take the opaque `--float` fallback that already exists. Nothing flashes, and no loop runs while
  the hero is to act.
- **Settings:** a "Character" switch (`.g-switch`, mint when ON, as the role map allows). Off removes Tell from
  every surface and leaves the ring and stack in the popover. A separate "Celebrations" switch turns off moment
  sheets (the ring still closes quietly).

---

## 9. What the mock builders should build, and how to check it

1. `demo/glass/tell.html`: the rig at 16, 24, 44 and 128px, all eight expressions, and the poke/flip.
   Include a toggle that forces reduced motion.
2. Home 900×640 and 1100×760: the perch in the tabs, the 44px greeting in the headline row, and the
   "Suggested next" voice marker. Check there is no page scroll and exactly one bone primary.
3. Table with a Serious verdict sheet: Tell on the sheet rim, attentive. Show the hop as a 3-frame strip.
4. Lesson with a pending tutor turn (`think`), plus the chapter seal on the list.
5. A 30-day moment sheet and a ring-closing strip (5 frames over 1.5s).
6. Wardrobe in Settings: four slots, with locked silhouettes.

**Tests to extend when this ships** (spec changes, with the reason in `DECISIONS.md`):
- `theme.spec`: a zero-layout swap for each of `data-felt`, `data-back`, `data-chips` and `data-tell`.
- `coached-handover.spec`: still exactly one bone button, with Tell present.
- A new `tell.spec`: no Tell animation running while the hero is to act; none at all under emulated
  reduced motion; nothing added to the coach announcer by Tell; perch label correct; and **no visible
  change to Tell after a `free` grade** (the silence rule, enforced in CI).
- `layout.spec`: the 900×640 and 1100×760 no-scroll checks with the perch and greeting present.

---

## Decisions for the owner (summary)
1. Amend `PRODUCT-SPEC` (v2.2) to allow the stack, reps and cosmetics, and keep: no reward for chips, no
   purchase, no randomness, and the silence rule intact. **Required before anything ships.**
2. The rendering stays SVG + CSS + WAAPI with no new dependencies (recommended). Rive is the only upgrade path,
   and it needs a dependency plus a CSP change plus a self-hosted WASM file.
3. Tell lives on a title-bar perch and on the coach sheet's rim. It is never on the felt.
4. No new hue (recommended), so Tell, the stack and the ring are drawn in chip ceramic and light. Or, optionally,
   one lilac "kept habit" hue.
5. A second sound cue (the ceramic clack, at milestones only, behind the sound switch): yes or no.
6. Whether the word "streak" may appear in UI copy. My default is "stack" and "days at the table".
