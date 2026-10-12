# Blind rating, round 2 (raw)

Rater: independent, blind (did not design this). Inputs: /tmp/blind2/s01..s20 at 1100x760 and 900x640 (DPR 2), both sizes read for every screen. Reference bar: demo/glass/screenshots/home-1100x760.jpg and demo/glass/variants/sports-live-1100x760.jpg. Rubric: SCORECARD.md.

**Motion and states come from stills only.** No animation was seen, so Motion is 7 everywhere: there is no evidence either way. To lift it, give the next rater a motion strip (rest, mid-transition, settled) for the sheet entrances, the deal, Dee's expressions and the streak fill. States only covers what a still can show: selected, disabled, affordance.

## Per screen

| # | Screen (as seen) | hier | type | color | material | space | consist | states | motion | a11y | craft | apple | personal | premium | mean |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| s01 | Onboarding 2/4, who you are | 8 | 8 | 8 | 8 | 7 | 8 | 8 | 7 | 8 | 7 | 8 | 9 | 8 | 7.85 |
| s02 | You > Rivals (Bo) | 7 | 6 | 8 | 7 | 6 | 7 | 7 | 7 | 8 | 6 | 7 | 9 | 7 | 7.08 |
| s03 | You > Trophy room | 8 | 8 | 8 | 8 | 7 | 8 | 8 | 7 | 8 | 7 | 7 | 9 | 8 | 7.77 |
| s04 | Play, commit tray | 8 | 6 | 7 | 7 | 6 | 7 | 8 | 7 | 8 | 6 | 7 | 7 | 7 | 7.00 |
| s05 | Home | 8 | 7 | 7 | 8 | 7 | 8 | 8 | 7 | 8 | 8 | 8 | 9 | 8 | 7.77 |
| s06 | You > Your style | 8 | 8 | 8 | 7 | 7 | 8 | 7 | 7 | 8 | 8 | 8 | 9 | 8 | 7.77 |
| s07 | Play, hand result tray | 8 | 6 | 7 | 7 | 6 | 7 | 8 | 7 | 8 | 7 | 7 | 8 | 7 | 7.15 |
| s08 | Study (leak finder + push/fold) | 7 | 7 | 8 | 7 | 6 | 7 | 6 | 7 | 6 | 7 | 7 | 8 | 7 | 6.92 |
| s09 | You > Dee | 8 | 8 | 8 | 8 | 7 | 8 | 6 | 7 | 8 | 6 | 8 | 10 | 8 | 7.69 |
| s10 | You > Your best hands | 8 | 7 | 8 | 8 | 7 | 7 | 8 | 7 | 8 | 6 | 8 | 9 | 8 | 7.62 |
| s11 | Trophy reveal sheet | 9 | 8 | 8 | 8 | 7 | 8 | 8 | 7 | 8 | 7 | 8 | 9 | 9 | 8.00 |
| s12 | Story map | 7 | 8 | 8 | 8 | 6 | 8 | 7 | 7 | 8 | 6 | 7 | 9 | 8 | 7.46 |
| s13 | You > Locker | 7 | 8 | 8 | 7 | 6 | 7 | 6 | 7 | 7 | 7 | 7 | 9 | 8 | 7.23 |
| s14 | You > Profile | 8 | 8 | 8 | 8 | 8 | 8 | 7 | 7 | 8 | 7 | 8 | 9 | 8 | 7.85 |
| s15 | Onboarding 3/4, goals | 8 | 8 | 8 | 8 | 7 | 8 | 7 | 7 | 8 | 7 | 8 | 9 | 8 | 7.77 |
| s16 | Learn lesson (chat) | 8 | 7 | 8 | 8 | 7 | 8 | 8 | 7 | 8 | 7 | 8 | 9 | 8 | 7.77 |
| s17 | Onboarding 1/4, meet Dee | 9 | 8 | 8 | 8 | 8 | 8 | 8 | 7 | 8 | 8 | 8 | 10 | 9 | 8.23 |
| s18 | Onboarding 4/4, what I heard | 8 | 8 | 8 | 8 | 7 | 8 | 8 | 7 | 8 | 7 | 8 | 9 | 8 | 7.85 |
| s19 | Verdict sheet (Serious) | 8 | 7 | 8 | 8 | 7 | 8 | 8 | 7 | 8 | 7 | 8 | 8 | 8 | 7.69 |
| s20 | You > Letters | 8 | 7 | 8 | 8 | 7 | 7 | 8 | 7 | 7 | 7 | 8 | 10 | 9 | 7.77 |

## Category means (20 screens)

| hier | type | color | material | space | consist | states | motion | a11y | craft | apple | personal | premium | **all** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 7.90 | 7.40 | 7.85 | 7.70 | 6.80 | 7.65 | 7.45 | 7.00 | 7.80 | 6.90 | 7.65 | 8.90 | 7.95 | **7.61** |

Weakest: Spacing (6.80) and Craft (6.90). Strongest: Personal (8.90). Next to the reference bar, the screens match its glass, nav and bone primary. They fall short of it in three ways. Big figures use a condensed display face. Screens built from boxed cards leave dead bands. Several 900px layouts clip or collide.

## Problems that repeat across screens (fix once, lifts many)
1. **Condensed display numerals** (s02 −14, s04/s07/s10/s13 stacks and pot, s05 23, s08 1.6, s20 38%). This is a second figure face that is not in the SF system. Siblings on the same screen use SF (s20: 38% condensed, while 68% and 6 of 9 use SF). Fix: SF Pro Display 600 with tabular figures at 34/28 for every hero figure.
2. **Meter labels not anchored to their ticks** (s10, s16, s11, s19 are the better ones). In s10, 'needed 31%' and 'you had 34%' sit about 80px left of their marks. Fix: centre each label on its tick x and clamp it to the track ends.
3. **Bordered card on everything** (s02, s05, s06, s13). Static info groups get the same 1px border and fill as actionable tiles, so emphasis is flat and states are ambiguous. Fix: keep `.g-group` for actionable lists and use flat `.g-sect` for information.
4. **Dead bands next to cramped edges.** In s12, s18 and s20 one column has about 150px of void, while the other column (or the bottom row) sits 26–44px from the window edge (s04, s08, s09, s10, s19, s20). Fix: a 40px bottom inset minimum, and distribute the leftover space into the gap between sections.
5. **900px degradation.** Captions are dropped silently, and text wraps or truncates (s03, s08, s09, s16, s20). Fix: give fixed-height label boxes and use shorter copy variants, not deletions plus wraps.
6. **Placeholder "Unknown"** archetypes on the table (s04, s07; struck through in s02). It reads as unfinished.

## Every reason under 8

### s01 Onboarding 2/4
- space 7: at 900 the sheet leaves about 18px side margins against a 40px top inset, so it nearly fills the window. Cap the width at window − 80px. At 1100 it is off-centre vertically (285px above, 200px below); centre it in the content area.
- motion 7: stills only (see header).
- craft 7: the 'Live casino' glyph reads as a bowl and its stroke is heavier than the house/monitor/book icons; redraw it at the same 1.5px stroke. Card descriptions orphan a single word at 1100 ('seats', 'clean'); balance the wraps or widen the measure.

### s02 Rivals
- hier 7: eight bordered groups (file, record, 3 stat tiles, 2 rule cards, 3 hands, 2 table rows, next, CTA) all have equal visual weight. Flatten the stat tiles and rules to `.g-sect` so 'How he plays' and the CTA lead.
- type 6: '−14' is in a condensed face while 21 / 4 / 6 use SF. At 900 the 'bb' unit is top-aligned above 'after 38 hands' instead of sitting on the figure baseline. Use SF 600 tabular and baseline-align the unit.
- material 7: the Bo chip is a flat grey disc with white dashes (plastic), and the FILE panel is an opaque dark slab. Add an edge highlight and a rim gradient to the chip, and drop the panel fill to the coat.
- space 6: at 900 the 'Also at your table' heading is removed and its row butts against the hands list. The CTA row is about 30px from the window bottom. Keep the heading and use a 40px bottom inset.
- consist 7: 'a call breaks even at 1 in 3' is centred under its bar while the sibling captions are left-aligned. Left-align it.
- states 7: the struck-through 'Unknown' reads as an edit artefact or error. Use 'was Unknown' in ink-3, or drop it.
- motion 7: stills only.
- craft 6: the chart end label '−29' collides with the series end dot. The '2 Sep / 11 Oct · +15 on the last hand' footer is crowded at 900. The 'bb' unit is misaligned. Fix these labels.
- apple 7: card-in-card density reads as a web dashboard, not a macOS inspector. Use fewer containers and hairline sections.
- premium 7: follows from the density and the mixed numerals above.

### s03 Trophy room
- space 7: at 900 the shelf labels wrap to two lines ('The Long / Call', 'Seventy- / Five Deep'), the dates are dropped and the baselines go uneven. Give each tile a fixed two-line label box, bottom-aligned.
- motion 7: stills only.
- craft 7: the hyphen break in 'Seventy-Five' is bad. 'Rival Turned' shows an empty progress track labelled '−14 bb to go'; a negative in a progress label reads as an error, so use '14 bb to go'.
- apple 7: the pedestal is a hard-ellipse skeuomorphic plinth with a hard top edge. Soften it to a contact shadow plus a subtle disc, or remove the plinth.

### s04 Play, commit tray
- type 6: the condensed display face on the stacks (4875 / 4950 / 5000) and the pot (225) is outside the SF system. Use SF Pro Display 600 tabular, with the pot at 34.
- color 7: there is no felt zone. The table is the same navy dune coat as every other screen, so 'felt green = the table only' has nothing to land on (only the hero seat has a green cast). Restore a lit felt ellipse under the board.
- material 7: the villain seats are near-opaque dark slabs with a 1px border. Lower the fill and add a top-edge light, or put the type directly on the felt.
- space 6: at 900 the price line is about 20px above the hero seat, and the hero seat is about 40px above the tray. At 1100 the tray is 26px from the window bottom. Pull the board up and keep a 40px bottom inset.
- consist 7: all three villains show 'Unknown', so the archetype looks like a placeholder. Hide it until it is known.
- motion 7: stills only.
- craft 6: the reason field clips mid-word ('his bluf') with no fade. Add a trailing fade mask or let it scroll. The D puck overlaps the card corner.
- apple 7: the condensed numerals and boxed seats are not system-grade.
- personal 7: placeholder archetypes and generic quips on a screen the user sees every hand.
- premium 7: follows from the type and space above.

### s05 Home
- type 7: '23' is in the condensed display face, an orphan beside the SF 'day streak' and every other figure. Use SF 600 at 34 tabular.
- color 7: the streak days are glossy bone pearls. Bone should mean cards and the one primary, and the pearls compete with 'Start tonight'. Use neutral fill-2 dots with ink-1 for done.
- space 7: at 1100 the right column ends about 280px above the window bottom while the left fills it, which is unbalanced. At 900 the 'Last kept hand' subtitle wraps and leaves 'Sure' as an orphan. Shorten the copy and balance the column heights.
- motion 7: stills only.

### s06 Your style
- material 7: the share card sits inside a dark well, so there are three containers (coat, well, card). Drop the well and let the card float on the coat with a soft drop.
- space 7: there is about 190px of dead space below the quadrant cards at 1100, and about 110px of empty well under 'Save card image' at 900. Raise the grid height or align the panel bottoms.
- states 7: the four archetype description cards are bordered like buttons but are static. Flatten them to `.g-sect`, or make them open something.
- motion 7: stills only.

### s07 Play, hand result
- type 6: condensed numerals (1450, 4300, 5750). Same fix as s04.
- color 7: the hero won, but 'Called 450, won the 1450 pot' is grey, with no mint +750 (Letters and Hands show +750 in mint). Add the mint delta.
- material 7: seat slabs, as in s04.
- space 6: at 1100 the hero seat is about 16px above the verdict tray, while about 180px of empty band sits between the price line and the hero. Move the hero up and keep at least 24px clear of the tray.
- consist 7: the hero seat widens to about 620px here against about 420px in s04, so the seat jumps size between states. Fix its width.
- motion 7: stills only.
- craft 7: the D puck overlaps the hero card corner. At 900 the verdict support line is dropped silently.
- apple 7 / premium 7: follow from the above.

### s08 Study
- hier 7: two dense tool panels, a primary, a secondary text button and a free-floating 'Drill this chart' all compete. Make 'Drill this chart' the second panel's footer row inside its group.
- type 7: '1.6' is condensed while '37 of 40' is SF. Unify the figure face.
- material 7: the grid panel and drill card are opaque slabs. Lighten them to the coat and use a hairline.
- space 6: at 1100 the footer row is 44px from the window bottom, and 'Drill this chart' sits 80px below the drill card with nothing between. Tighten it to 16px from its card.
- consist 7: the 'Checked and fine' tags are bordered semibold chips that look like buttons. Use plain ink-2 text with middots.
- states 6: the confidence intervals are drawn with slider thumbs and tick tracks, so they read as draggable sliders. Use a range band with a point marker and no thumb.
- motion 7: stills only.
- a11y 6: at 900 the grid drops every cell label, so 169 cells are distinguished only by grey luminance, and the hatch for Bubble fold against Push is low contrast. Keep 11px labels, or show them on hover with a stronger hatch.
- craft 7: 'too' is an orphan line in the summary, and 'Calling 3-bets out of position' wraps at 900.
- apple 7 / premium 7: density and slider confusion.

### s09 Dee
- space 7: at 1100 the right list ends about 30px from the window bottom. At 900 the 'Idle' segment is dropped, and the preview sentence ends with the orphan 'work.'.
- states 6: 'Read verdicts aloud' is off, but its Low/Clear segment still shows an active selection, so the disabled dependency is invisible. Dim it to 40% and make it non-interactive while the switch is off.
- motion 7: stills only.
- craft 6: at 900 the selected checkmark overlaps the word 'hands' in 'After notable hands', a collision. Reserve 28px of right padding for the check.

### s10 Your best hands
- type 7: the 'Replay' primary is about 17px against about 15px on every other bone primary, and the mini table uses condensed numerals.
- space 7: the mini table leaves its left third empty, with Bo's seat off the board's axis. At 1100 the 'How a hand gets kept' footer is about 30px from the bottom.
- consist 7: Replay is larger than the sibling primaries. 'The Set Fold' card shows no outcome figure while its siblings do.
- motion 7: stills only.
- craft 6: the meter labels 'needed 31%' and 'you had 34%' are offset about 80px left of their ticks. Anchor each label to its tick.

### s11 Trophy reveal
- space 7: at 900 the sheet's side margins are about 16px, and the 'It goes on your shelf' caption is dropped.
- motion 7: stills only.
- craft 7: the tracking on the 'FOLDED · RIGHT' plaque pushes 'T' to the plaque edge. Add 12px of side padding or reduce the tracking.

### s12 Story
- hier 7: the 75 bb centre ring is the largest element, but the chapter you are in (River Room) is the signal. Shrink the ring, or give the current node the emphasis.
- space 6: the right column has about 150px of void above 'Continue' at both sizes, while 'Depth certified' is crammed into the bottom-left corner beside the Observatory label. Move 'Depth certified' to the right column, or place Continue directly under 'Why this order'.
- states 7: all six nodes are identical dark tiles, and done, current and next differ only by caption. Use a ring for current and dim the future nodes to 60%.
- motion 7: stills only.
- craft 6: the orbit path runs into tile edges and under the '2 · The Night Train' label. Stop the path at the node radius plus 6px.
- apple 7: the decorative orbit plus the ring reads as a game map more than a system app. Fine for character, but the overlaps cost it.

### s13 Locker
- hier 7 / states 6: there are two selection signals, the 'in use' dot on Graphite and the lit, bordered tile on Etched river (the preview), so it is unclear which back is applied. Use one selected treatment for 'applied' and a lighter 'previewing' ring.
- material 7: the card-back thumbnails are about 70px with low-contrast art. The preview well is a slab.
- space 6: the preview puts three seats in the top 260px, then leaves about 120px of empty band above 'Bet'. The 'Paint only…' footer floats 140px below Dee's finish. Redistribute the seats and pin the footer under the last group.
- consist 7: the card-back tiles are centred while the surface and finish tiles are left-aligned. Pick one.
- motion 7: stills only.
- a11y 7: the locked backs (Depth rings, Calibration) are at roughly 1.3:1 and nearly invisible. Raise them to about 50% opacity and keep the lock glyph.
- craft 7: thumbnail art is too small to judge the pattern. Enlarge it to about 96px.
- apple 7: ambiguous selection is not a system pattern.

### s14 Profile
- states 7: each row has both an 'Edit' label and a chevron, a double affordance. Keep the chevron and make the whole row the target.
- motion 7: stills only.
- craft 7: at 900 the 'Wk 6' axis label runs past the plot's right edge, and the '4.1' end label crowds the last point. '3 of 12 · See all 12' is redundant; use 'See all 12'.

### s15 Onboarding 3/4
- space 7: orphan single words wrap in the goal descriptions at 1100 ('with', 'me', 'game').
- states 7: the selected day circles carry both a fill and a check badge. Use one signal.
- motion 7: stills only.
- craft 7: the check badges overlap the circle rim and crowd the neighbouring circles. Inset them, or drop them.

### s16 Learn lesson
- type 7: Dee's chat lines are about 20px against 15px body everywhere else, which feels like a different app. Use 17/400 for Dee and 15 for the replies.
- space 7: about 110px of dead space sits above the answer cards at 1100.
- motion 7: stills only.
- craft 7: at 900 'shown wer…' truncates mid-word, and the '3 of 4' label is dropped, leaving bare progress bars. 'Bo showed bluffs 4 of 9' is not anchored to the end of its band.

### s17 Onboarding 1/4
- motion 7: stills only. (All other categories are 8 or above. Minor: at 900 the body paragraph wraps at about 1490px while the helper line runs to 1680, giving a ragged measure, and the paragraph ends on the orphan 'words.'.)

### s18 Onboarding 4/4
- space 7: about 150px of dead space sits in the right column under 'Read verdicts aloud' at both sizes. Move the toggle up into the voice group, or balance the columns.
- motion 7: stills only.
- craft 7: the editable-token underlines are heavy (about 2px), break around the commas and differ in width. Use a 1px dotted ink-3 underline offset 3px.

### s19 Verdict sheet
- type 7: 'SURE' in capitals shouts inside a sentence. The cost appears twice ('costs ~2.9 bb' and 'pot odds · 2.9 bb'). Use title case and show the figure once.
- space 7: at 1100 the sheet sits about 30px from the window bottom with about 490px of dimmed void above. Give it a 40px inset, or centre it.
- motion 7: stills only.
- craft 7: the duplicated figure, the em dash construction and the '~' in a headline are rough. Tighten the copy.

### s20 Letters
- type 7 / consist 7: the hero '38%' is in the condensed face while the sibling cards' '6 of 9' and '68%' use SF. Use one figure style.
- space 7: at 1100 the hand-of-the-week board cards butt against the column divider (0px). At 900 the letter panel has about 150px of empty space under the signature, and the P.S. is dropped.
- motion 7: stills only.
- a11y 7: the 6 of 9 encoding (ringed, filled and small dot) uses 10px glyphs that are hard to tell apart. Enlarge them to 14px and add a legend.
- craft 7: the footer note wraps to the orphan 'generated.' at 900.
