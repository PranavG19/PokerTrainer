# Offsuit — design notes (from actual screenshots)

Source: App Store id6446099491 (6 screenshots, downloaded to `research/offsuit/`) + offsuit.app landing page.
Tagline on shot1: **"Simple. Modern. Poker."** — that is the whole brief.

## Palette

| Token | Value | Use |
|---|---|---|
| `--bg` | `#000000` | app canvas, true black |
| `--surface` | `#1C1C1E` → `#2A2A2C` | action buttons, stat sheet, seat pod, list row highlight |
| `--card-face` | `#FAFAFA` (near-white) | playing card face |
| `--ink` | `#0A0A0A` | black rank/pip on card, headline text on light bg |
| `--red` | `#F0483C`-ish vivid red | hearts/diamonds rank + pip |
| `--text-hi` | `#FFFFFF` | primary numerals, names |
| `--text-lo` | `#8E8E93` | labels ("Win", "Pair", XP subtitles) |
| `--mint` | `#3DDC97`-ish | win % positive accent (only saturated UI color) |
| `--chip-blind` | `#E8E24A` yellow, small circle w/ dark text | blind amount markers |

Only ONE accent color in the game UI (mint, for win%). Everything else is greyscale + card red.
Tournament cards are the exception: soft pastel gradients (lilac→pink, mint→cream).

## Typography
- Geometric sans, tight tracking. Very close to **Poppins / Outfit / SF Pro Rounded**. Landing headlines are near-identical to Poppins Medium.
- Big numerals are **light weight and huge** (bankroll `11,250` ~56px, weight 300). Restraint = the whole aesthetic.
- Labels: 12–13px, `--text-lo`, sentence case ("Weekly leaderboard", not "WEEKLY LEADERBOARD"). No uppercase anywhere.

## Playing card (the signature element)
- Rounded rect, radius ≈ 14–16px on a ~68×92 card. Aspect ratio ~0.74.
- **Rank top-left, suit pip bottom-left.** NOT the traditional corner-index + center-pip layout. This is the single most recognizable Offsuit trait.
- Rank is large (~28px, medium weight); pip smaller (~18px) directly beneath.
- Red suits: both rank and pip red. Black suits: both near-black.
- Card back: white face with **diagonal black hatch lines** (~45°, evenly spaced), same radius. Not a pattern image — just stripes.
- Hole cards overlap slightly and fan/rotate a few degrees (shot1 shows ~6° tilt, shot6 shows the pair overlapping ~12px).
- Board cards sit in a flat row, no overlap, small gap (~6px).

## Table screen layout (shot6 = canonical)
```
[← back]                                    (top-left, thin arrow)
  seat row: 5 opponents across the top
    avatar (emoji, ~44px circle)
    name    12px --text-lo
    stack   16px --text-hi
    D badge = white circle w/ dark "D", overlaps avatar bottom-right
    blind chip = small yellow circle below the seat it applies to
  ...vertical space...
  board: 5 cards centered, dealt cards face-up, undealt = hatch back
  pot: right-aligned number under the board, plain white, no "Pot:" label
  ...vertical space...
  actions: [Call 4] [Raise 8] [↑]     pill buttons, --surface, radius ~22px, 15px text
                                       the ↑ is a compact circular raise-more button
  hero: hole cards (left, overlapping)  |  hero pod (right)
        hero pod = --surface rounded rect: "Pair" label 11px --text-lo on top,
                   avatar, stack 20px white
```
Everything is generously spaced with large empty black regions. Emptiness is the design.

## Home screen (shot3)
- Top-right: shop/bag icon only. No cluttered nav.
- Huge bankroll numeral, left-aligned, light weight, no label.
- Horizontally scrolling tournament cards: pastel gradient, emoji, title 17px, meta line "250 buy-in · 400k prize · 1500 XP" 12px `--text-lo`.
- "Weekly leaderboard" section: rank medal emoji, avatar, name, XP subtitle.
- Bottom tab bar: 2 tabs only (Home, Profile), icon + 11px label.

## Stats sheet (shot4)
- Bottom sheet, `--surface`, radius ~28px, floats over dimmed table.
- "Win" label `--text-lo` → `71%` huge in mint.
- "2 Pair" label → `26%` huge in white.
- Centered, enormous type, nothing else. Two facts per sheet, max.

## Interaction feel
- Buttons are pills with no border, no shadow, just a lighter surface fill.
- No gradients in the game UI. No felt texture. No table oval. No chips animation implied.
- The "table" is literally just black space — a radical simplification vs every other poker app.

## What to copy vs. drop for our Electron app
COPY: black canvas, card design (rank above pip), hatch card backs, pill actions, huge light numerals,
      sentence-case low-contrast labels, mint as the only accent, generous emptiness, 2-tab nav.
DROP: multiplayer/social, leaderboards, XP, cosmetics, shop, cloud accounts (explicitly out of scope — local only).
ADAPT: desktop layout (wider, so seats arc across the top with more horizontal room; keyboard shortcuts
       instead of taps). Add the teaching layer from MANUAL-opus46.md as the differentiator.
