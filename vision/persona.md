# The mock persona (one player, every screen agrees)

**Today is Sunday 12 October 2025, evening, not yet played.** Every date below is 2025. The streak of 23 runs
19 Sep–11 Oct (23 days, inclusive); today is still open.

Sam (Dee calls them what they set in onboarding; there is no account and no real name field). Pronouns are not
needed anywhere: write to "you".

## Onboarding answers (profile, new)
- Goals (tiles, verbatim): **Win my home game** and **Understand why I lose**. The game is on Thursdays (schedule).
- Where you play: **Home game** (also some online). Stakes: **$1/$2 home game** (Dee talks in this money; stack depth comes from the certified table).
- Experience: **A few years, never studied.**
- Why you play: **The friends, and the puzzle.**
- Schedule: **Weeknights, 30 minutes** (Mon–Fri reminders); the game itself is Thursday. 30 minutes is the shipped minimum session (sessionPlan.ts:45, spec S2a).
- Dee: personality **Warm** (dial: Dry · Warm · Blunt), voice **Off** (spokenVerdicts), frequency **After notable hands**.

## Numbers (sources: vision/personalization-sources.md)
- Started 6 weeks ago (Mon 1 Sep). 1,240 graded decisions. 412 hands played (HandRecord, last 500 kept).
- Streak **23 days** (19 Sep–11 Oct), which is also your longest (the first run, 1–17 Sep, was 17; 18 Sep was missed). Today (Sun 12 Oct) is not yet played on every screen.
- EV loss **4.1 bb/100**, down from 9.4 in the first assessment block (assessmentBlock.ts).
- Sure calls right **81%** (118 of 146); Guess 52% (61 of 117). The mark is 85%.
- Biggest leak: **river calls**, 1.8 bb a time across 14 hands = 25 bb (bets of 60–100% pot). Second: **folding to c-bets** on dry boards, 68% folds, 0.6 bb a time across 22 = 13 bb (pot odds).
- Style (derived from decisions[] and vpip/pfr): VPIP **24%**, PFR **17%**, aggression **2.1**, c-bet **58%**, fold to river bet **38%** (was 61%).
  Archetype: **The Closer** (selective, takes the lead). Quadrants: The Closer (selective + assertive), The Anchor
  (selective + patient), The Pressure (wide + assertive), The Explorer (wide + patient). Neutral names only, never "nit/fish".
- Rules in your words: **12** accepted sentences (lexicon). Quotable ones:
  - "the price is the call over the pot after I call" (pot odds, 3 Oct)
  - "a small SPR means the flop decides the hand" (SPR, 19 Sep)
  - "bluff where my story is the river card" (bluffing, 27 Sep)
- Concepts: 7 of 12 mastered (schedule gate). Depth (standing.ts DEPTHS 0/40/75/125/200): certified 40 bb and 75 bb; working on **125 bb, 7 of 8 concepts, puzzles done through the gate**. The table hand in the mocks is the shipped demo's 100 bb hand (5000 chips at 25/50).

## Rival
- **Bo**, LAG (the shipped label; revealed after a hand ends, jitter.ts). Persistent regulars are NEW: today the archetype is re-dealt each
  session (table.ts:83–89), so the vision pins one archetype per named regular. 38 hands together, you are **−14 bb** against him.
  What he SHOWED you (showdowns only, never engine truth): bet the river in 21 of 38 hands; 5 of the 12 big river bets that reached showdown were
  bluffs; folded to 6 of your 10 check-raises.
  You won the last one (the Price held hand: river 9♣ J♠, Bo Q♦ J♣, you K♥ 2♦).
- Other regulars: Ada (Station, you +6 bb), Cy (TAG-reg, +2 bb).

## Kept hands (the reel)
1. **The Long Call** — 11 Oct: called Bo's 450 river bet into 550 (31% price) with K♥2♦ on 4♠4♦K♦9♣J♠, Sure, right reason. Pot 1450; your net **+750 (+15 bb)**. Stacks after: you 5750, Bo 4300, Ada 4950, Cy 5000.
2. **The Set Fold** — 4 Oct: folded 7♠7♥ (a set of sevens) on A♠7♦K♠Q♠ to a check-raise all-in; the grader said fold (the fold saved about 23 bb against his range). First time you folded a set correctly.
3. **The Squeeze** — 26 Sep: 3-bet Q♣J♣ from the button over a call, took it down preflop. +8 bb.
4. **First certified hand** — 2 Sep: the 40 bb table.

## Trophies (fixed, shown in advance; each names the decision it records)
Earned (6): The Long Call (11 Oct), The Set Fold (4 Oct), Forty Deep (40 bb table certified, 2 Sep), Seventy-Five Deep (75 bb, 6 Oct),
Twelve Rules (12 sentences accepted, 9 Oct), Three Weeks (21-day streak, 9 Oct).
Next: One-Twenty-Five Deep (certify 125 bb; 7 of 8 concepts, puzzles done), Sure Means Sure (85% over 100 Sure calls; 81% now), Thirty Days (a 30-day streak; 23/30), Rival Turned (win back the 14 bb from Bo).
Materials: ceramic bone (decisions), smoked glass (depth), graphite (habit). No gold, no colour.

## Dee's weekly letter, week 6 (scripted templates filled from the numbers above)
"You called Bo's big river bets 9 times this week. Six were right, and you said why five times. Your fold to big river
bets went from 61% to 38%, which is where the price says it should be. The one that still costs you: folding to
c-bets on dry boards, 68%. Next week starts there. — Dee"

## Story (The Long Orbit, at depth): built from your leaks
Chapter 3 of 6, "The River Room": Bo's room, because river calls are your costliest leak. Chapters are reordered by leakCostBb.
