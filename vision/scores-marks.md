# Dee mark directions: scores

**This is the truly blind re-rate. The renders had no captions or descriptions, only the labels 1 to 5.** I looked at only three files: `dee-marks-blind-1100x760.png`, `dee-marks-blind-900x640.png` and the table context `sports-live-1100x760.jpg`. I opened no other file.

What each direction looks like (my reading, since none were described):
1. A dark glass pebble with one bone dash for an eye, like a visor. Expressions come from the dash tilting and moving, an arc for Price held, and coral or amber rims.
2. A bone dealer button with two pill eyes. The hero has DEALER lettering round the rim. Expressions come from the eyes moving, ^^ for Price held, coral or amber rims, and for Asleep the disc tipped flat with its eyes shut.
3. A lowercase "d" in a dark squircle. Expressions only tint the counter of the d (coral or amber).
4. A bone dealer button with one central pupil. Expressions come from the pupil moving, coral or amber rims, and the disc tipped flat for Asleep.
5. An open bone ring with an orbiting dot. Expressions come from where the dot sits, a coral ring with a centre dot for Serious, an amber arc for The gate, and a grey ring for Asleep.

## Scores (1 to 10)

| Dir | 16px | 64px | Range | Original | Glass fit | Premium | Personal | Overall |
|---|---|---|---|---|---|---|---|---|
| 1 | 6 | 8 | 6 | 7 | 9 | 8 | 6 | 6 |
| **2** | **8** | **9** | **9** | **7** | **8** | **8** | **9** | **8** |
| 3 | 9 | 8 | 3 | 4 | 7 | 6 | 3 | 4 |
| 4 | 6 | 8 | 5 | 6 | 8 | 8 | 6 | 6 |
| 5 | 7 | 8 | 6 | 5 | 9 | 7 | 3 | 5 |

## Why each score under 8 is low, and what to do

**Direction 1**
- 16px (6): it is a dark pebble on a dark chip, so at 16px it shrinks to a grey smudge with a dash, and the "23" outweighs it. Fix: add a 1px bone outline, or a lighter body tone, at 16px and 24px only.
- Range (6): Rest, Listening, Glance and Thinking are all the same dash nudged a few pixels, and they look alike at 24 to 32px. Fix: let the dash change shape as well as position, for example shorter for Listening, a dot plus a dash for Thinking, and a curve for Glance.
- Original (7): a single glowing visor slit is a common robot-face shorthand. Fix: tie it to the button, for example a faint D, or rim ticks on the pebble.
- Personal (6): one dash on a dark body reads as cool and distant. That fits a judge, but people get attached to warmth, not to a slot. Fix: give it at least one warm, readable state beyond Price held.
- Overall (6): it is the cleanest fit with the glass system, but it does not read as the dealer button, which is a bone object at the table. It looks like a UI control.

**Direction 2**
- Original (7): two vertical pill eyes on a round white body is a well-worn cute-mascot formula. It is not a copy, but you cannot own it. Fix: make the button do some of the expressing. Let the inner rim ring act as a lid or brow (it thins, tilts or dims), and keep the DEALER rim lettering as a signature at 64px and above. That way the face cannot be lifted off the disc.

**Direction 3**
- Range (3): seven of the eight expressions are the same "d". Only Serious and The gate change, and only by tinting the counter. It has no expression system. Fix: make the counter of the d the eye, with pupil, lid and squint states. Even so, the ceiling is low.
- Original (4): a lowercase letter in a squircle is an app-icon or monogram, not a character. It looks like any "d"-named product.
- Glass fit (7): at 900x640 the expression tiles lose their squircle and turn into bare glyphs, while at 1100x760 they keep it. The two sizes do not match. Fix: keep one container across sizes.
- Premium (6): the specular arc on the squircle is generic stock glass, and the plain bold letterform adds nothing. Fix: draw a custom d with a bevel like a button edge.
- Personal (3): nobody grows attached to a letter. It is legible branding, not a companion.
- Overall (4): it has the best 16px legibility and fails at everything else the brief asks.

**Direction 4**
- 16px (6): at 16px a bone disc with a dark centre dot reads as a radio button, a record button or a target, not as Dee. Fix: draw a dedicated 16px glyph with a larger pupil and a thinner rim, or add a highlight so it reads as an eye.
- Range (5): the only expressive part is one pupil sliding about. Thinking, Glance and Listening differ by a few pixels, and Price held has no positive state. Fix: add a lid that can close, half-close, smile or squint.
- Original (6): a single staring eyeball calls up HAL, a webcam, or other cyclops characters. The "always watching you" feeling also works against a coach the player should warm to.
- Personal (6): a judge's stare. Fix: same as Range. A lid that can smile turns watching into caring.
- Overall (6): it is well crafted, and as a disc it is truer to the dealer button than 1, but the eye is both too limited and slightly unsettling.

**Direction 5**
- 16px (7): it is legible as a glyph, but at 16px in the nav it reads as a refresh, loading or power icon. Fix: close the ring or change how the dot sits, so it cannot pass for a spinner.
- Range (6): the dot moving round the ring is abstract. Viewers have to learn what each state means. The amber arc for The gate is the best timer state in the set, though.
- Original (5): ring plus dot is the house style of loading spinners and voice assistants.
- Premium (7): the flat strokes are clean but carry no craft detail: no material, no bevel, no light. It looks unfinished next to 1, 2 and 4.
- Personal (3): it is an indicator, not a someone. In a UI it would also be confused with a busy state, which is a real usability cost.
- Overall (5).

## Ranking

1. **Direction 2.** It is the only one that is plainly the dealer button: a bone disc, a physical object, the same as the "D" chip at the table in the context shot. It has a real face and the widest, most readable expressions (the tipped-over Asleep disc is charming). It holds up at 64px, and it already reads in the nav chip.
2. **Direction 1.** Best fit with the glass system and well made, but it is dark on dark at small sizes and does not read as the button.
3. **Direction 4.** The right object and fine craft, but one eye limits the range and it feels like being watched.
4. **Direction 5.** Elegant and systemic, but it reads as a spinner and has no personality.
5. **Direction 3.** A monogram, not a character.

## Ship: Direction 2

**Single biggest fix: make the face belong to the button, so it stops being a generic two-dot face.** Let the inner rim ring do part of the expressing: it thins, tilts as a brow, or closes as a lid. Keep the DEALER rim lettering as the signature at 64px and above. The 900x640 hero currently drops the lettering, so restore it there. Then draw a separate, hand-tuned 16px version: no inner ring, eyes at least 2px wide, and a slightly darker rim stroke so the disc separates from the chip.

Two smaller notes on Direction 2:
- Bone is also the single primary-action colour. Keep Dee's hero off any screen whose primary pill is in view, or set it smaller there.
- Serious and The gate depend only on a thin coral or amber rim, which is weak at 24px. Change the eyes as well, not just the rim colour.
