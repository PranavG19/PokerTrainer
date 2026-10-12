# The mock persona (one player, every screen agrees)

Sam (Dee calls them what they set in onboarding; there is no account and no real name field). Pronouns are not
needed anywhere: write to "you".

## Onboarding answers (profile, new)
- Goals: **Win my Thursday home game**; also "understand why I lose".
- Where you play: **Home game** (also some online). Stakes: **$1/$2 home game**, 100 bb deep.
- Experience: **A few years, never studied.**
- Why you play: **The friends, and the puzzle.**
- Schedule: **Weeknights, 15 minutes** (Mon–Fri); the game itself is Thursday.
- Dee: personality **Warm** (dial: Dry · Warm · Blunt), voice **Off** (spokenVerdicts), frequency **After hands only**.

## Numbers (sources: vision/personalization-sources.md)
- Started 6 weeks ago (31 Aug). 1,240 graded decisions. 412 hands played (HandRecord, last 500 kept).
- Streak **23 days**, best **31**. Today (Sunday) not yet played on Home; kept on other screens' perch (data-today).
- EV loss **4.1 bb/100**, down from 9.4 in the first assessment block (assessmentBlock.ts).
- Sure calls right **81%** (118 of 146); Guess 52% (61 of 117). The mark is 85%.
- Biggest leak: **river calls**, 1.8 bb a time across 14 hands (bets of 60–100% pot). Second: folding to c-bets 68% (pot odds).
- Style (derived from decisions[] and vpip/pfr): VPIP **24%**, PFR **17%**, aggression **2.1**, c-bet **58%**, fold to river bet **38%** (was 61%).
  Archetype: **The Closer** (selective, takes the lead). Quadrants: The Closer (selective + assertive), The Anchor
  (selective + patient), The Pressure (wide + assertive), The Explorer (wide + patient). Neutral names only, never "nit/fish".
- Rules in your words: **12** accepted sentences (lexicon). Quotable ones:
  - "the price is the call over the pot after I call" (pot odds, 3 Oct)
  - "a small SPR means the flop decides the hand" (SPR, 19 Sep)
  - "bluff where my story is the river card" (bluffing, 27 Sep)
- Concepts: 7 of 12 mastered (schedule gate). Depth: certified 40 bb and 75 bb tables; working on 100 bb.

## Rival
- **Bo**, loose-aggressive (revealed after the hand; jitter.ts), 38 hands together, you are **−14 bb** against him.
  Bets the river 2.1× as often as average; bluffs 44% of his big river bets; folds to a check-raise 60%.
  You won the last one (the Price held hand: river 9♣ J♠, Bo Q♦ J♣, you K♥ 2♦).
- Other regulars: Ada (tight-passive, you +6 bb), Cy (tight, +2 bb).

## Kept hands (the reel)
1. **The Long Call** — 11 Oct: called Bo's 450 river bet at a 31% price with K♥2♦ on 4♠4♦K♦9♣J♠, Sure, right reason. +1450.
2. **The Set Fold** — 4 Oct: folded 7♠7♥ (a set of sevens) on A♠7♦K♠Q♠ to a check-raise all-in; the grader said fold (free). First time you folded a set correctly.
3. **The Squeeze** — 26 Sep: 3-bet Q♣J♣ from the button over a call, took it down preflop. +22 bb.
4. **First certified hand** — 2 Sep: the 40 bb table.

## Trophies (fixed, shown in advance; each names the decision it records)
Earned (6): The Long Call (11 Oct), The Set Fold (4 Oct), Forty Deep (40 bb table certified, 2 Sep), Seventy-Five Deep (75 bb, 6 Oct),
Twelve Rules (12 sentences accepted, 9 Oct), Three Weeks (21-day streak, 9 Oct).
Next: The Hundred (certify 100 bb; 3 of 5 blocks), Sure Means Sure (85% over 100 Sure calls; 81% now), Thirty-One (beat your best streak; 23/31), Rival Turned (win back the 14 bb from Bo).
Materials: ceramic bone (decisions), smoked glass (depth), graphite (habit). No gold, no colour.

## Dee's weekly letter, week 6 (scripted templates filled from the numbers above)
"You called Bo's big river bets 9 times this week. Six were right, and you said why five times. Your fold to big river
bets went from 61% to 38%, which is where the price says it should be. The one that still costs you: folding to
c-bets on dry boards, 68%. Next week starts there. — Dee"

## Story (The Long Orbit, at depth): built from your leaks
Chapter 3 of 6, "The River Room": Bo's room, because river calls are your costliest leak. Chapters are reordered by leakCostBb.
