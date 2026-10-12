# Dee mark: blind scores

I rated these from the two renders (`dee-marks-blind-1100x760.png`, `dee-marks-blind-900x640.png`) and the shipped table (`sports-live-1100x760.jpg`) only. The render's own card captions were visible. I scored what is drawn, not what the captions claim.

| Criterion | D1 Smoked pebble + visor | D2 Bone button, two dots | D3 "d" glass tile | D4 Bone button, one jewel eye | D5 Ring + bead |
|---|---|---|---|---|---|
| Legibility at 16px | 5 | 8 | 8 | 6 | 7 |
| Legibility at 64px | 7 | 9 | 8 | 8 | 8 |
| Expression range | 5 | 7 | 2 | 4 | 5 |
| Originality | 4 | 6 | 4 | 6 | 4 |
| Fit with glass system | 7 | 8 | 7 | 8 | 7 |
| Premium / craft | 7 | 8 | 7 | 9 | 7 |
| Feels personal | 6 | 9 | 2 | 4 | 3 |
| **Overall** | **5** | **8** | **4** | **6** | **5** |

**Rank:** 1. D2, 2. D4, 3. D5, 4. D1, 5. D3.

## Reasons (every score under 8)

### Direction 1: smoked-glass pebble with a bone visor
- **16px (5):** In the "23" chip the visor shrinks to a white bar inside a dark circle, which is the standard "remove / minus" control glyph. It reads as a button you could press, not as a character. *Fix:* split the visor into two short slots, or curve it, so the 16px form cannot be mistaken for a minus.
- **64px (7):** The dark body on the dark glass chrome has low figure-ground contrast. Only the specular arc and the visor carry the shape. *Fix:* add a lighter bone rim or a stronger edge highlight so the silhouette holds on `--ink` backgrounds.
- **Expression (5):** Rest, Listening, Glance and Thinking change only by a few pixels of visor offset or tilt, and they look almost identical. Asleep is the same bar, just dimmer. Only Price held (the arc) and the coloured rims for Serious and The gate stand out. *Fix:* give the visor real shape changes (narrowing, arc up or down, split) instead of position changes alone.
- **Originality (4):** A dark glossy capsule with a glowing visor slit is the stock "friendly robot" form (EVE, many assistant mascots). It also drops the dealer-button idea, which is the one thing that makes Dee Dee. *Fix:* if you keep it, make the body a puck with a chip edge so it is still a button.
- **Fit (7):** Smoked glass matches the materials. But a bone visor on a dark body turns the bone role inside out: bone should be the physical object itself. *Fix:* make the body bone and the visor ink.
- **Premium (7):** The gloss is tidy but generic, and nothing in it is poker-specific. *Fix:* add an engraved or chip-edge detail on the rim at hero size.
- **Personal (6):** It is cute, but it reads as an appliance with one feature. *Fix:* same as Expression: a face that can smile and narrow.

### Direction 2: dealer button in bone ceramic with two engraved dots (pick)
- **Expression (7):** The second row is excellent. The ^^ for Price held is readable and warm, the coral and amber rims for Serious and The gate use colour exactly as the role map defines it, and the flipped, lying-flat button for Asleep is clever. Row 1 is weak: Rest, Listening, Glance and Thinking differ only by 1–2px dot shifts and are hard to tell apart even at 64. *Fix:* give each row-1 state one silhouette-level cue. For example, Listening tilts the whole disc about 8 degrees, Glance moves the dots fully to one edge, and Thinking puts the dots up and to the side and turns them a little, or shows one dot as a short dash.
- **Originality (6):** A disc with two dot eyes is a very common kawaii face and could be anyone's. What saves it is the DEALER engraving and the ceramic rim, but those are lost below hero size (the 900x640 hero also drops the engraving). *Fix:* carry one button-specific feature to every size, such as a single notch or an inset rim ring that stays visible at 24 and 16px.

### Direction 3: lowercase "d" whose bowl is the button
- **Expression (2):** Six of the eight states show the same glyph. Only Serious and The gate change, and only by a rim colour round the counter. At 900x640 the tile backgrounds disappear from the expression grid, so the set is also inconsistent across window sizes. *Fix:* there is no real fix that keeps the concept. It is a wordmark, not a character.
- **Originality (4):** A letter on a rounded tile is the default way to make an app icon. *Fix:* use it as the app icon, not as Dee.
- **Fit (7):** The tile works as an icon. But in the nav it reads as a second logo next to the spade wordmark. *Fix:* keep it only as the dock or app icon.
- **Premium (7):** It is clean but plain. *Fix:* not worth investing in as the character.
- **Personal (2):** You cannot get attached to a letter. *Fix:* not fixable within this direction.

### Direction 4: bone button with one smoked-glass jewel eye
- **16px (6):** In the chip it reads as a radio button or a target, not a face. *Fix:* make the jewel larger relative to the disc (about 40%) and put a glint on it at small sizes.
- **Expression (4):** The eight states differ only by where the single pupil sits, plus the shared coloured rims. Price held looks like Rest. A single eye cannot smile or narrow, so warmth has no channel. *Fix:* add a lid, a bone crescent that can close over the jewel from the top or bottom, so the eye can narrow (Serious), smile (Price held) and close (Asleep).
- **Originality (6):** It is a well-made button, but a lone eye brings HAL and eyeball baggage. Up close it reads as watching or judging, which is risky for a grader. *Fix:* the lid above also softens it.
- **Personal (4):** It feels cold and watchful. *Fix:* the lid gives it blink and smile states.
- Craft is the best of the five (9): the ceramic, the jewel and the engraving are the most premium hero.

### Direction 5: ring with one bead (the button's path round the table)
- **16px (7):** It is crisp, but a ring with a gap and a dot is the universal refresh / reload / loading glyph. In a nav it will read as "sync". *Fix:* close the ring and set the bead on it, not in a gap, so it reads as an orbit rather than a refresh icon.
- **Expression (5):** Bead position is an abstract code: Rest, Listening, Glance and Thinking are just the bead at four clock positions, and the player has to learn the mapping. Serious (a coral bullseye) and The gate (an amber partial ring) do read, but the amber ring looks like a progress spinner. *Fix:* pair the bead with motion or ring weight (a thinner, open ring for Thinking, a closed ring for Serious).
- **Originality (4):** It is close to the generic loading/refresh and power marks. *Fix:* see 16px.
- **Fit (7):** The monoline suits SF Symbols. But a ring with an amber sweep collides with the gate timer's own UI. *Fix:* never animate the ring as a sweep. Keep sweeps for the timer only.
- **Premium (7):** It is minimal to the point of being anonymous. *Fix:* add the bone ceramic material to the bead at large sizes.
- **Personal (3):** It is a symbol, not a someone. *Fix:* not fixable without giving it a face.

## Pick: ship Direction 2

It is the only direction that is a dealer button and also a face. The bone ceramic is a physical object, so it sits correctly in the colour role map. It reads as a friendly character at 16px in the nav (I checked a zoomed crop of the chip: two clear dots on a bone disc). It has the warmest states (Price held ^^, the lying-flat Asleep), and it uses coral and amber exactly as the system defines them. A player would grow attached to it.

**Single biggest fix:** row 1 (Rest, Listening, Glance, Thinking) needs states that read at a glance. Right now they differ by 1–2px dot nudges. Give each one a whole-object cue (a tilt of the disc, dots pushed fully to one edge, dots raised with one shortened to a dash for Thinking) so all eight states are distinct at 64px and the important ones survive at 24px.

**Secondary concerns for D2:**
- Keep one button-specific feature (an inset rim ring or a notch) visible at every size, so it is not just a generic dot-eyed circle.
- Watch that a bright bone disc in the nav does not compete with the single bone primary action on the same screen. At 16px a slightly lower-value bone, or a thin rim, may help.
