# DESIGN — The Back Room, round 2 (implementer detail)

The human-facing record is [FINDINGS.md](FINDINGS.md). The principles are in [../DESIGN-BRIEF.md](../DESIGN-BRIEF.md), the
data sources in [personalization-sources.md](personalization-sources.md), and the persona in [persona.md](persona.md).
Mocks are in `demo/vision/` (gallery `index.html`), renders in `demo/vision/screenshots/`, and round 1 in `demo/vision/round1/`.

## Dee's mark: Two lights (`demo/vision/dee.js`, `face`)
- **Object:** a bone-ceramic dealer button, 100-unit viewBox. The body is a radial bone gradient (#FFFFFF → #F3F0E8 → #DAD5C9 → #BEB8AB) with a
  bevel stroke and a dished face (r 37.5) with a light lip. DEALER is micro-engraved on a textPath only at ≥ 96px. There's a soft contact shadow.
- **Small sizes (< 30px):** darker bone (`-cs` gradient, so it doesn't compete with the bone primary), an inset rim ring kept at every
  size (the button cue), and eyes scaled ×1.55. At 16px: two dots on a ringed button.
- **Expression = the two lights plus posture.** Lights are `[cx, cy, w, h]` ink capsules (#1C1F24) with an engraved lip and a glint.

| Pose | Lights | Posture | Use |
|---|---|---|---|
| rest | 7×13 at y47 | — | default |
| attentive | 7.6×15.5, raised | tilt −10°, lift | Home greeting, listening |
| glance | shifted to one edge | tilt 6° | in-hand perch while you type a reason |
| thinking | one up, one a dash | tilt −4° | a question asked |
| pleased / proud | two arcs (smiling eyes) | lift; proud adds a bevel light sweep | Price held, a trophy |
| serious | short, low | coral rim | a serious verdict |
| notable | slightly short | amber arc on the rim | the gate |
| asleep | low lines | lying flat (3/4 view, side band) | idle > 2 min, Character resting |
| blink | lines | — | every 4–9 s, never while you're to act |

- **Motion:** expression morph 220 ms (`--dur-2`), hop 320 ms `--ease-spring` with no visible overshoot, glance-and-return (P16).
  Reduced motion swaps poses instantly.
- **Alternatives** (kept on `dee-marks.html`): `button` (ceramic plus a smoked-glass jewel), `orbit` (ring plus bead), `pebble` (glass dome
  plus visor) and `monogram` (a lowercase d on a glass tile). Swap with `data-mark`.

## Shell and kit
- **Tabs:** Home, Play, Learn, Story | Train, Study | You. The You sub-nav is `<div data-subnav="…">` with Profile, Trophies, Style, Hands,
  Letters, Rivals, Locker and Dee. Pages put it in `.vtop` (an h1 plus an optional `.vcap` caption on the left, the sub-nav on the right).
- **Perch:** Dee at 20px plus the streak glyph (three stacked buttons) and the count in `--ink-1`. With `data-today="open"` the count is `--ink-2`.
  The thumb is re-placed after `fonts.ready` and on resize (the round-1 off-centre thumb).
- **New tokens (vision.css only):** `--streak-ink`, `--ring-track/fill`, `--stage-pool/floor` (the lit zone an object sits in), `--score`
  (the sports condensed numerals), `--ease-arc`, `--dur-4` 480, `--dur-moment` 1600.
- **Kit:** `.vpage` is a top-aligned page frame. The rest of the kit:
  - `.dee-line`: Dee's line as type, never a bubble.
  - `.tile` / `.tile.lit`, `.choice` (selectable tile), `.week` (the streak strip), `.stage`.
  - The mini sports table (`.ms`, `.mbet`, `.mpot`, `.mboard`, `.mhero`): pages set only sizes.
- **Table:** every table mock is `html[data-felt='sports']` with `demo/glass/table-seats.js` (`rows` layout).

## Screens (state → what it proves)
| File | States | Personal elements → source |
|---|---|---|
| `onboarding.html` | `?step=1..4` | new `profile {displayName, venue, stakes, experience, goals, days, sessionMinutes}`, `dee {voice}` |
| `home.html` | — | leak `leakCostBb` (session.ts:130), due `dueNow` (schedule.ts:243), rival, streak (new), kept hand (new `pinned`) |
| `table.html` | `?state=live|mistake|great` | your rule quoted (`lexicon`, session.ts:200), leak count, Price held → kept hand |
| `milestone.html` | — | The Set Fold from `decisions[]` + `evaluate.ts` |
| `lesson.html` | — | your rule (lexicon), your kept hand |
| `story.html` | — | chapter order by `leakCostBb`, depth from `standing()` (standing.ts:226) |
| `study.html` | — | leak finder (`reachWeightedLoss`, rw.ts:157) over imported hands, push/fold drills |
| `profile.html` | — | onboarding profile, `careerRecord` (career.ts:163), calibration (session.ts:149), lexicon, standing |
| `trophies.html` | — | `careerRecord` milestones, `decisions[]`; fixed and shown in advance |
| `style.html` | — | `HandRecord.vpip/pfr` (session.ts:72); aggression, c-bet, fold-to-river from `decisions[]` |
| `hands.html` | — | `hands[]`, `decisions[]`, new `pinned`, `reason`, `prediction`, `villain` |
| `letter.html` | — | the week's `hands[]`, leaks, lexicon, filled into scripted templates |
| `rival.html` | — | new `rivals[]` from `HandRecord.villain`; `gifts` (session.ts:175) |
| `locker.html` | — | new `cosmetics`, each item's earning trophy |
| `dee-settings.html` | — | new `dee {presence, voice, frequency, personality}`, `spokenVerdicts` (session.ts:156) |
| `dee-marks.html` | `?blind=1` | — |

## Profile format (owner D2: simple, versioned, no migrations)
`{ schemaVersion: 1, …SessionState, profile: {…}, streak: {current, best, lastDay}, rivals: [...], cosmetics: {back, surface, deeFinish, owned[]},
dee: {personality, voice, frequency, celebrations, character}, hands[].pinned/reason/prediction/villain/finalPot }`, with a backup file written on save.
An unknown `schemaVersion` opens read-only. There is no migration code (there are no prior users).

## Render
`cd demo/vision && node capture.mjs [page …]` uses the main checkout's Playwright by absolute path. It renders each page and state at 1100×760 and
900×640 (DPR 2), fails loudly on console errors, network or page scroll, and `?still=1` freezes motion at its end frame.
