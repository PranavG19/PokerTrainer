# Scores — The Back Room, round 1 vs round 2 (blind)

**Method.** An independent rater that did not design this scored PNG renders (2× DPR, both window sizes) blind. It used the round-3 rubric in
[`SCORECARD.md`](../SCORECARD.md), with 11 categories, plus **personal** (feels personal) and **premium**. There were 10 round-1/round-2 pairs,
labelled A/B in random order per pair, and 10 round-2-only screens. Raw scores and every reason under 8 are in
[`scores-raw.md`](scores-raw.md). The key (which side was which) was kept from the rater and applied afterwards. The Dee mark directions were
rated separately in [`scores-marks.md`](scores-marks.md).

**Limits.**
- The rater could tell the two rounds apart by their toolbar (it said so). That makes the comparison unblinded in practice, though not by label.
- Motion and states were inferred from stills.
- One rater, one pass: noise was about ±0.15 per element in the round-3 study.

## Summary
| | hier | type | color | material | space | consist | states | motion | a11y | craft | apple | **personal** | **premium** | **mean** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Round 1 (10 screens) | 6.7 | 7.4 | 7.5 | 7.2 | 6.0 | 6.3 | 7.1 | 7.0 | 7.4 | 6.1 | 6.8 | **7.0** | **7.0** | **6.88** |
| Round 2, same 10 screens | 7.9 | 7.9 | 7.8 | 7.9 | 7.0 | 8.0 | 8.0 | 8.0 | 7.8 | 7.6 | 7.8 | **8.9** | **8.0** | **7.89** |
| Round 2, all 20 screens | 8.0 | 8.0 | 7.8 | 7.9 | 7.2 | 7.8 | 7.8 | 8.0 | 7.8 | 7.5 | 7.8 | **9.1** | **8.2** | **7.90** |

## Per screen (mean · personal · premium)
| Screen | Round 1 | Round 2 |
|---|---|---|
| Home | 6.38 · 8 · 6 | **8.00** · 9 · 8 |
| Table, serious mistake | 6.92 · 6 · 7 | **8.15** · 9 · 8 |
| Table, Price held | 6.92 · 8 · 7 | 7.77 · 9 · 8 → fixed (beat overlap) |
| Profile | 6.62 · 7 · 7 | **8.00** · 9 · 8 |
| Locker | 6.38 · 7 · 6 | 7.92 · 9 · 8 → fixed |
| Story | 6.69 · 6 · 7 | 7.92 · 9 · 8 → fixed |
| Lesson | 6.62 · 7 · 7 | 7.92 · 9 · 8 → fixed |
| Celebration → Milestone | **8.00** · 8 · 8 | 7.92 · 9 · 8 → fixed |
| Pro import → Study | **7.62** · 7 · 8 | 7.31 · 8 · 7 → fixed |
| Character sheet → Dee settings | 6.69 · 6 · 7 | **8.00** · 9 · 9 |
| Onboarding 1 / 2 / 3 / 4 | — | 8.15 / 7.85 / 7.46 / 8.15 → 2 and 3 fixed |
| Trophy room | — | 7.85 · 9 · 8 → fixed |
| Style | — | 8.15 · 10 · 9 |
| Best hands | — | 7.92 · 9 · 8 → fixed |
| Letter | — | **8.23** · 10 · 9 |
| Rival | — | 8.15 · 10 · 9 |
| Table, commit tray | — | 7.23 · 8 · 7 → fixed (bone Commit, hero clearance) |

**Two screens scored lower than round 1:**
- **Study (7.31 vs 7.62):** bone push cells, a second CTA and a dead band.
- **Milestone (7.92 vs 8.00):** glossy 3D trophy, within noise.

Both were reworked against the rater's reasons.

## Re-score after the fixes (a second, stricter blind rater; `scores-raw-2.md`)
All 20 round-2 screens were re-rated in shuffled order with no round-1 pairs, by a new rater after the rater and review fixes (commit 5d8436f).
| | hier | type | color | material | space | consist | states | motion | a11y | craft | apple | **personal** | **premium** | **mean** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Round 2 after fixes | 7.9 | 7.4 | 7.9 | 7.7 | 6.8 | 7.7 | 7.5 | 7.0 | 7.8 | 6.9 | 7.7 | **8.9** | **8.0** | **7.61** |

- **Calibration.** This rater is stricter, so read the numbers with that in mind. It scored motion 7 everywhere ("no evidence in a still"). It marked down
  the condensed display numerals, which are the shipped `sports` table's face and which you chose. It also marked down the table screens for having
  no felt zone, which is likewise the shipped `sports` surface. Screens that barely changed moved by about ±0.3: Onboarding 1 went 8.15 → 8.23 and
  Letters 8.23 → 7.77. So the overall 7.90 → 7.61 is mostly rater offset, not regression.
- **Per screen (mean · personal · premium):**
  - Onboarding 1: 8.23 · 10 · 9
  - Milestone: 8.00 · 9 · 9
  - Onboarding 2 and Onboarding 4: 7.85 · 9 · 8
  - Profile: 7.85 · 9 · 8
  - Home, Lesson, Style, Trophies and Onboarding 3: 7.77 · 9 · 8
  - Letters: 7.77 · 10 · 9
  - Dee: 7.69 · 10 · 8
  - Table, mistake: 7.69 · 8 · 8
  - Hands: 7.62 · 9 · 8
  - Story: 7.46 · 9 · 8
  - Locker: 7.23 · 9 · 8
  - Table, great: 7.15 · 8 · 7
  - Rival: 7.08 · 9 · 7
  - Table, live: 7.00 · 7 · 7
  - Study: 6.92 · 8 · 7
- **Fixed after this re-score (author; confirmed only by the gallery re-render, not re-scored):**
  - meter labels anchored to their ticks;
  - the 900px truncations and the check overlap;
  - the read-aloud choice disabled when off;
  - a single selected tile in Locker;
  - the hyphen break on the Trophy shelf;
  - the dead columns;
  - the table's +750 net and the seats revealed at hand end.
- **Not changed, on purpose:** the condensed numerals and the no-felt surface (the shipped `sports` table), and motion (stills can't show it).
  Study stays the weakest screen because it is the densest. It is a candidate for splitting into two screens at port time.

## Dee mark directions (blind, `scores-marks.md`)
| Direction | 16px | 64px | expression | original | glass fit | craft | personal | **overall** |
|---|---|---|---|---|---|---|---|---|
| **Two lights** (recommended) | 8 | 9 | 7 | 6 | 8 | 8 | 9 | **8** |
| The button (jewel) | 6 | 8 | 4 | 6 | 8 | 9 | 4 | 6 |
| Orbit | 7 | 8 | 5 | 4 | 7 | 7 | 3 | 5 |
| Pebble | 5 | 7 | 5 | 4 | 7 | 7 | 6 | 5 |
| The d | 8 | 8 | 2 | 4 | 7 | 7 | 2 | 4 |

The rater's biggest fix for Two lights was to make rest, listening, glance and thinking distinct, plus a button cue at every size and a darker
bone when small. All three were applied (see [`DESIGN.md`](DESIGN.md)).
