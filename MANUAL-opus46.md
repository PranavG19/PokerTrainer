# THE MANUAL

## Thesis

The perfect player is not the one who plays equilibrium — it is the one who plays equilibrium when blind and the maximally-exploitative counter when they can see. This manual builds that player in three phases: first, automate a near-theory-optimal baseline so it costs zero attention; second, understand the principles deeply enough to solve novel spots at the table; third, read specific opponents and deviate correctly, proportionally to confidence, with named exposure and pre-committed revert triggers. Everything that follows serves exactly this sequence.

---

## Why the Standard Way of Learning Fails

The standard path is: memorize preflop charts, watch training videos, play volume, review losing hands. Every step is broken.

**Charts without generators.** A 169-cell chart per position is ~1,300 cells of rote memorization. Under pressure, rote fails. Worse, charts are outputs of a system — when stack depth changes, opponent tendencies shift, or the game is short-handed, every cell must be re-derived. A student who memorizes outputs without understanding the generator cannot adapt.

**Passive consumption.** Watching solver outputs or strategy videos builds recognition memory: you see the answer and feel "I knew that." But at the table, you must generate the answer under fog with no prompt. Recognition and generation are different neural operations. Passive study trains the wrong one.

**Result-based feedback.** Poker's signal lies. A 5bb/100 winner with standard variance (~80bb/100 SD) needs 100,000 hands before results distinguish them from breakeven at 95% confidence. A 500-hand live session carries zero information about whether your strategy is correct. Correct thin-value bets lose 40% of the time. Correct river calls lose 70% of the time against draws. The brain encodes losses 2x more intensely than wins. Over thousands of hands, result-based learning trains you away from correct marginal decisions — the decisions that constitute 80% of your edge.

**The mechanism:** You lose three river calls in a session. Your threat system tags "river calls" as dangerous. You start folding more. Folding more is invisible — you never see the bluffs you would have caught. Your winrate drops but you feel safer. You have installed the wrong lesson with high confidence, and nothing in your feedback environment will correct it because the correction is hidden inside hands you never played to showdown.

The fix: commit to decisions before seeing answers, evaluate by EV cost not outcome, use process-based feedback (did your reasoning match the principle?), and treat results as irrelevant noise until sample sizes reach statistical power.

---

## The Generative Core

These 11 ideas, in this order, are sufficient to re-derive correct play in any spot. Each depends on everything above it. The gate test tells you whether the concept is installed. The leverage column tells you what breaks if it isn't.

| # | Concept | One-sentence definition | Gate test | Leverage |
|---|---------|------------------------|-----------|----------|
| 1 | **Pot odds & equity** | A call is correct when your win probability exceeds the price the pot offers: call/(pot+bet+call). | Given any bet size as fraction of pot, state required equity in under 2 seconds. | Every decision node — call, fold, raise. 100% of hands. |
| 2 | **Ranges, not hands** | You have a distribution of possible holdings. Your opponent has a distribution. Strategy is distribution-vs-distribution. | When asked "what do you do with ATs here?" answer with "my range does X on this board" not "ATs is strong." | Every postflop decision. Transforms the question from hand-strength to range-position. |
| 3 | **Position = information asymmetry** | Acting last means you see their action before choosing yours. Worth ~15-20% more equity realization with identical cards. | State why BTN is the most profitable seat in terms of information, not "because you act last." | Determines preflop range width, postflop aggression allocation, bluff efficiency. Every hand dealt. |
| 4 | **SPR (stack-to-pot ratio)** | Effective stack / pot after the flop. SPR 1-3: one-bet game. SPR 4-8: two-bet game. SPR 10+: three-bet game. | Given a pot and remaining stacks, state how many bets fit and name a multi-street plan in under 5 seconds. | Every postflop street — commitment, sizing, draw playability, slowplay decisions. |
| 5 | **Indifference** | At equilibrium, opponent's marginal hands are exactly 0 EV between their options. This generates all bluff ratios and defense frequencies. | Derive bluff-to-value ratio for a pot-sized bet from scratch in under 15 seconds (2:1 value:bluff). | All equilibrium frequencies — bluff ratios, calling frequencies, why over-folding/over-bluffing is exploitable. One principle, hundreds of derived numbers. |
| 6 | **Range advantage & nut advantage** | Range advantage: your range has more equity on this board. Nut advantage: your range has more of the strongest possible hands. Independent axes. | Given a flop and two preflop ranges, identify which player has each advantage and state the sizing implication. | Determines c-bet frequency, sizing, and check-raise strategy on every flop texture. |
| 7 | **Polarity vs. linearity** | Polar range (nuts + air) bets large. Merged range (continuous block of hand strength) bets small. Shape determines size. | Given a betting range description, state whether it is polar or merged and name the correct sizing bucket. | Directly determines bet sizing — the most frequent decision after "bet or check." Explains all solver sizings from 20% to 200% pot. |
| 8 | **Role in range** | The same hand is value, bluff-catcher, semi-bluff, or air depending on the board and the rest of your range. The board determines role; role determines action. | Classify any hand on any board into one of 6 roles (Nutted, Thin Value, Bluff-Catcher, Semi-Bluff, Blocker-Bluff, Unplayable) with correct reasoning. | Every postflop decision. The synthesis concept — how you apply all prior concepts to a specific hand on a specific board. |
| 9 | **Blockers** | Your cards remove combos from opponent's range, determining WHICH hands to select as bluffs and calls among strategically equivalent options. | State why A5s is a better 3-bet bluff than Q8o in terms of specific combos removed from opponent's range. | Determines hand selection among equivalent actions — which air to bluff with, which bluff-catchers to call with. Refines every marginal decision. |
| 10 | **Value or bluff — no third category** | Every bet either expects to be called by worse (value) or expects profit from the fold (bluff). "Betting for protection" and "betting for information" are either value or bluff in disguise, or mistakes. | For any bet, name which category it is and what specific outcome makes it profitable. | Forces clarity on every bet. If you cannot name which it is, check. |
| 11 | **Exploitation = equilibrium + a read** | Identify a specific deviation from balanced play, calculate the counter, deviate proportionally to confidence, name the exposure, pre-commit a revert trigger. | State the exploit, its exposure, and the sample size supporting it before executing any deviation. | The bridge from theory to profit. Where virtually all money is made against human opponents. |

---

## Preflop Without Charts

### Seven Rules That Replace ~1,200 Chart Cells

**Rule 1: The Three-Filter Open Test.** Every hand has three sources of value:
- **Dominance:** beats the hands that will pay you (AK dominates AQ/AJ/AT)
- **Nut potential:** makes straights/flushes that stack opponents (87s, small pairs)
- **Clarity:** you know what to do postflop on most boards (pairs hit-or-miss, AKo flops top pair or gives up)

From EP (UTG/HJ): need 2+ filters. From CO: need 1.5 (one strong, one marginal). From BTN: need 1+. This produces the correct open/fold within 1-2 combos of solver output in under 5 seconds.

**Rule 2: Position adds one layer per seat toward the button.** UTG ~15% of hands. Each seat toward BTN adds 5-7% (roughly one tier of hands). HJ ~19%, CO ~27%, BTN ~45%. The mechanism: equity realization. The same hand realizes 5-8% more of its raw equity in position because you see checks, control pot size, get free cards.

**Rule 3: Linear vs. Polar 3-bet.** One binary question: does the opener fold a lot to 3-bets?
- **Against tight openers** (UTG/HJ, fold to 3-bet ~55%): LINEAR. Your best hands in a row — QQ+, AK, AQs, AJs, KQs. Bluffs don't profit because they call too often with hands that crush you.
- **Against wide openers** (CO/BTN, fold to 3-bet ~45-50%): POLAR. Premiums (QQ+, AK) plus suited-Ax bluffs (A5s-A2s) and suited-Kx bluffs (K5s-K4s). Blockers reduce 4-bet probability; nut potential covers you when called.

**Rule 4: Pot-odds defense in the blinds.** BB facing a min-raise gets 3.5:1 — needs 22% equity — defend ~55% vs BTN, ~35% vs UTG. SB should 3-bet or fold (OOP + no closing action + no pot-odds advantage makes flatting bleed EV). Defense width = pot odds needed adjusted down slightly for OOP realization.

**Rule 5: 4-bet or fold when cold.** Facing a 3-bet after someone already opened: 4-bet (KK+, AK) or fold (almost everything else). Exception: QQ-TT and AQs with position and a small 3-bet. Cold-calling caps your range, creates multiway bloat, and generates postflop complexity that costs more than the preflop call could ever be worth.

**Rule 6: Stack depth below 40bb kills speculative hands.** At 20bb, 76s is garbage (you'll never win a pot big enough to justify the miss rate). ATo is premium (you're all-in preflop where raw equity reigns). The cutoff: below 40bb, shift to high-card/pair hands. Above 40bb, add suited connectors and gappers. The math: 76s needs ~15:1 implied odds. At 25bb in a single-raised pot of 5bb, max win is 25bb = 5:1. Not enough.

**Rule 7: Blockers choose bluffs.** A5s blocks AA (1 combo removed), AK (2 combos removed), AQ (2 combos removed). The 5 gives wheel-straight equity. This is not arbitrary — it simultaneously reduces 4-bet probability AND provides nut potential when called.

### Five Memorized Anchors (genuinely non-derivable)

| Anchor | Content | Why you must just know it |
|--------|---------|--------------------------|
| UTG opening range | ~15%, ~85 combos: 77+, ATs+, KJs+, QJs, AJo+, KQo. Four tiers: A (AA-QQ, AKs, AKo), B (JJ-99, AQs-ATs, KQs-KTs, QJs, AQo-AJo), C (88-22, A9s-A2s, QTs, J9s+, T9s, 98s), D (position-dependent, HJ+ only). | Calibration point. All other positions derive from this by addition. |
| RFI sizing | 2.5x from all positions. | Convention. Smaller invites too many callers; larger risks too much with marginal opens. |
| 3-bet sizing | 3x IP, 4x OOP. | OOP needs a larger pot to compensate for realization disadvantage. |
| The A5s-A2s bluff set | These four hands are your primary 3-bet bluffs in polar constructions. | Blocker math plus nut potential. Derivable in theory but too slow in real time. |
| Set-mine threshold | Need 15:1 implied odds. Call up to ~7% of effective stack with small pairs hoping to flop a set. | At standard depths (100bb), you can call ~7bb with 22-77 against a single raiser. |

### The Suited/Offsuit Universe Split

T9s is an open from every position. T9o is a fold from UTG/HJ/MP and marginal from CO. The gap is not the 3-4% equity difference — it is 2-3x in actual profit. The flush draw provides: a reason to continue on 40% of flops where you miss your pair, nut potential that stacks second-best flushes, and credible bluffing lines on three-flush boards. Treat suited and offsuit as different hands, not variants of the same hand.

### What to Ignore at the Boundary

The marginal hand at any range boundary (Q8s vs Q7s from CO) costs ~0.01bb/hand to get wrong. What IS catastrophic: folding top-15% hands that should always open (+0.15bb/hand lost), open-limping instead of raising (~0.08bb/hand), calling when you should 3-bet. Spend zero energy on boundary precision. Spend all energy on never misplaying clear-value hands.

---

## Postflop as Perception

### Five Board Texture Classes

Every flop in poker belongs to one of these five. Each demands a different sizing and frequency. If two boards produce the same sizing and frequency, they are the same class.

| Class | Examples | Who it favors | Default sizing | Default frequency | Mechanism |
|-------|----------|---------------|----------------|-------------------|-----------|
| **Dry-Static** | K72r, A83r, Q52r | Preflop raiser (range advantage: more big-card hands, overpairs) | 25-33% pot | 70-90% of range | Few turn cards change equity. No urgency. Small bet extracts from worse hands that would fold to large. |
| **Wet-Dynamic** | JT8ss, 976r, QJ7ss | Depends — caller often connects heavily | 67-75% pot | 40-55% of range (selective) | 20-30 turn cards shift equity dramatically. Must charge draws NOW. Large bet denies free equity. |
| **Paired** | K55r, 772r, TT4r | Preflop raiser (opponent rarely has trips: 3-8% of their range) | 25-33% pot | 80%+ of range | Both ranges compressed into "missed." Raiser's overpairs dominate. Tiny bet, massive frequency. |
| **Monotone** | 8s5s3s, Kh7h2h | Often the caller (more suited combos across all ranks) | Check range or 20-25% block bet | Low (25-40%) or full range at tiny size | Nut advantage shared or shifted to caller. Raiser cannot bet large and polar without enough nutted hands. |
| **Broadway-heavy** | KQJ, AJT, KJT | Preflop raiser (nut advantage: all strong broadway combos) | 67-75% pot | 50-65% selectively | Raiser has all top two-pairs, sets of broadway cards, and nut straights. Large bet exploits this nut imbalance. |

**The single variable that determines sizing:** How many turn cards change the story? Dry boards: 3-5 scary cards → bet small. Dynamic boards: 20-30 scary cards → bet large. Count this in 2 seconds and your sizing is correct.

### Six Range Roles

Every hand you hold on every board is exactly one of these. The correct action for each role is nearly fixed regardless of specifics.

| Role | Definition | Action | Example |
|------|-----------|--------|---------|
| **Nutted** | Top 5-8% of your range on this board | Build the pot — bet or raise | Set of kings on K72r |
| **Thin Value** | Beats most of villain's calling range but folds to heavy aggression | Bet for value, fold to raise | AQ on Q-8-3r (beats QJ, QT, all pairs below) |
| **Bluff-Catcher** | Beats only bluffs, loses to every value hand | Check and call — never bet, never raise | JJ on K-Q-8-4-2 (beats missed draws only) |
| **Semi-Bluff** | Has 8+ outs and benefits from fold equity | Bet to deny equity and collect folds | Flush draw + overcard on T-7-2 two-tone |
| **Blocker-Bluff** | No equity but blocks villain's continuing range | Bluff specifically because it reduces call probability | Ah-5c on Kh-Qh-7-3-2 (blocks every flush) |
| **Unplayable** | No equity, no blockers, no outs | Check-fold | 6-4 offsuit on A-K-Q-J-9 |

### The Three-Question Role Assignment

Ask in order, answer in 5 seconds:
1. **Does my hand beat villain's value betting range?** If no → bluff-catcher or worse.
2. **Does worse call my bet?** If yes → value. If no but I have outs → semi-bluff.
3. **Do I block villain's continues?** If yes → blocker-bluff. If no → unplayable.

### Drilling to Automaticity

Automaticity in board reading requires approximately 5,000 deliberate classification reps. At 10 boards per minute in flash-drill format: 500 minutes = 8-10 hours spread over 2-3 weeks. Below this volume, the skill is conscious and slow. Above it, it is perceptual and instant.

**Board Flash Drill — Texture + Favor + Size**

| Week | Target accuracy | Time per board | Volume per session |
|------|----------------|----------------|--------------------|
| 1 | 70% | 5 seconds | 200-300 boards (2-3 blocks of 100, 10 min each) |
| 2 | 85% | 3 seconds | 200-300 boards |
| 3 | 95% | 2 seconds | 200-300 boards |

Protocol: Reveal flop for the time limit. Student speaks: (a) Texture class, (b) Who it favors, (c) Default sizing. Coach confirms or corrects in one word. No explanation during drill. Minimum 3,000 boards total across all sessions.

**One Hand, Many Boards — Role Assignment Drill**

Fix one hand (start with A5s — spans all six roles). Deal 50 random flops. For each: name role in 5 seconds, state implied action (Bet-Big, Bet-Small, Check-Call, Check-Fold, Raise). After 50 boards, switch to a second hand (87s, then KTo, then 44). Four hands × 50 boards = 200 reps per session. Run 5 sessions (1,000 total). Target: 90% accuracy at 3 seconds by week 3.

**Full Integration — 3-Second Flop Protocol**

Precondition: 2,000+ board flash reps and 500+ role assignment reps completed.

Given preflop scenario + your hand + flop: produce the FULL output in 3 seconds: (a) Texture class, (b) Who it favors, (c) Sizing, (d) My hand's range role, (e) My action. Spoken as one stream: "Wet-dynamic, favors me, large sizing, semi-bluff, bet 66%."

50 hands per session, 3 sessions per week, 3 weeks = 450 integrated reps. Final target: 90% agreement with solver's highest-frequency action.

---

## The Cost Table

Common errors ranked by actual cost in big blinds per occurrence:

| Error | Cost (bb) | Frequency | Cumulative session leak |
|-------|-----------|-----------|------------------------|
| Open-limping instead of raising | 3-5 per occurrence | High at beginner level | 15-30bb/session |
| Folding to overbets with adequate bluff-catchers | 5-15 per occurrence | 2-4 per session | 10-40bb/session |
| Checking back winning hands on the river (missed value) | 3-8 per occurrence | 5-8 per session | 15-40bb/session |
| Never bluffing rivers (opponents always fold to you) | N/A (invisible) | Constant | 8-15bb/100 ongoing |
| Using one bet size for all textures | 0.5-1 per hand | Every c-bet | 5-10bb/100 ongoing |
| Calling river with bluff-catchers vs never-bluffs player | 4-8 per occurrence | 3-8 per session | 12-60bb/session |
| Auto-folding to 3-bets with clear calling EV | 2-3 per fold | 3-5 per session | 6-15bb/session |
| Betting "for protection" when hand is a bluff-catcher | 2-5 per occurrence | 3-6 per session | 6-30bb/session |
| Not c-betting dry textures (checking back range advantage) | 1-2 per occurrence | 4-8 per session | 4-16bb/session |
| Potting it on K72r instead of 33% | 0.5-1 per hand | Every dry-board c-bet | 3-8bb/100 ongoing |

**The severity rule:** Under 0.5bb = noise, ignore it. 0.5-2bb = note the pattern, no discussion. 2-5bb = address it. 5-10bb = full breakdown. Over 10bb = stop everything, this is the session's lesson.

---

## The Training Loop

### Per-Decision Protocol

Every training hand follows this sequence:

1. **See the spot** (2 seconds to read).
2. **WRITE action + one-sentence reason.** Not think — write. Verbal commits allow retroactive editing. Time limit: 20 seconds. No analysis paralysis.
3. **System reveals correct action + correct reason.**
4. **Self-mark on a 3-point scale:**
   - GREEN: right action AND right reason.
   - YELLOW: right action, wrong reason — OR wrong action, right framework.
   - RED: wrong action, wrong reason.
5. **Green → silence + next problem. Yellow/Red → contrast set.**

Pace: 40-60 hands in 30 minutes = one hand per 30-45 seconds average.

### After Every Miss: One-Variable Contrast Set

Within 10 seconds, serve 4 variants of the missed spot. Each toggles exactly ONE variable:
- (a) Change position (IP → OOP)
- (b) Change texture (dry → wet)
- (c) Change hand strength (strong draw → weak draw)
- (d) Change stack depth (100bb → 40bb)

For each variant, student commits action+reason. After all 4: "Which variable changed your answer and why?" Student articulates the rule in one sentence. If they cannot after 4 contrasts, add a 5th extreme-case variant. Record the extracted rule in the student's own words — this becomes the concept tag.

Total time per contrast set: 3-5 minutes.

### Session Structure

| Element | Duration | Purpose |
|---------|----------|---------|
| Interleaved random queue | 25-30 min | 40 hands mixing all spot types: preflop, c-bet, turn barrel, river value/bluff, sizing. No more than 2 consecutive same-type. |
| Discrimination tag | Before each commit | Student first TAGS the spot type in one word ("cbet", "thin value", "bluff", "sizing", "defend") — scored independently. |
| Contrast sets (triggered by misses) | 3-5 min each | Served immediately after miss. 2-4 per session expected. |
| Total active decision-making | 25-35 min MAX | After 30-40 full-effort decisions, quality collapses. Two 30-min sessions beat one 90-min session. |

**Difficulty band:** Optimal is 70-80% accuracy on novel instances. Below 60% = guessing, nothing encodes. Above 85% = maintenance, not growth. Adjust problem difficulty to hold this band.

**Track two metrics separately:**
- Discrimination accuracy: did they correctly identify the spot type?
- Execution accuracy: given they knew the type, did they get the answer right?

If discrimination < 70%: needs more interleaving. If discrimination > 80% but execution < 70% on a specific type: that type needs contrast sets.

### Interleaving Is Non-Negotiable

Mixing spot types in random order produces worse practice scores but dramatically better table performance. The reason: at the table, no one announces "this is a thin value spot." The player must first CLASSIFY the situation, then retrieve the principle, then apply it. Blocked practice removes the classification step, inflating scores while leaving the real skill untrained.

### Mastery Threshold

A concept is mastered when: ≥85% accuracy on NOVEL instances (never-seen boards) across 3+ spaced sessions with CORRECT reasoning (not just correct action). Below this, the concept re-enters rotation.

### Concept Decay Probes

For each mastered concept: schedule 2 novel instances 7-14 days after last exposure, embedded in normal sessions with no signal they are probes. If both correct with correct reasoning → extend to 21-30 days. One miss → contrast set + reschedule at 7 days. Both miss → concept drops to active learning.

---

## The Coach's Voice

### Anatomy of a Correction

Every correction has exactly four parts, delivered in this order, with nothing else:

1. **Name the principle** (one clause, max 8 words).
2. **Show the board/range consequence** (one sentence — what their range looks like and why it fails).
3. **Give the boundary** (one sentence — the nearest hand that flips the answer, and the single variable that flips it).
4. **Stop.**

Word budget: 40-80 words for a beginner. Mechanism: working memory holds 4 chunks. Exceeding 80 words means part of the correction drops before encoding completes.

### The Self-Explanation Gate

Before any correction: the learner must generate their own diagnosis. Maximum two gate attempts.

| Spot type | Gate question |
|-----------|--------------|
| Bet/check decision | "What is your range doing on this board?" |
| Call/fold decision | "What price are you getting and what equity do you need?" |
| Sizing error | "What shape is your betting range here — polar or merged?" |

**Protocol:**
1. Ask the gate question. Wait. Do not fill silence.
2. If learner answers with a principle (even wrong): correct the principle directly.
3. If learner answers with hand-strength reasoning ("I had top pair"): say "That's what you HAVE. What is your RANGE doing?" Wait again.
4. If learner says "I don't know": deliver the full correction immediately. Productive failure before explanation installs 3-5x stronger.
5. If learner gives correct principle but wrong conclusion: "Right principle. Where does the boundary sit?"

When the learner is silent for more than 8 seconds: "Commit. Even if you're guessing. The guess creates the hook for the correction." Uncommitted attention does not encode corrections.

### The Results-to-Cost Redirect

The learner says "that call was bad, I lost" or "that bluff was good, he folded."

**The redirect has exactly one form:**

> "What was the EV difference between your action and the alternative — in big blinds, not in outcomes?"

The napkin formula: (your equity - breakeven equity) × total pot = EV gained or lost.

> "You called 8bb into a pot of 20bb. You needed 8/28 = 29% equity. Estimate your equity against their range. If it was 35%, your call gained (0.35 - 0.29) × 28 = 1.7bb every time you make it. If it was 22%, your call lost (0.29 - 0.22) × 28 = 2.0bb. Which was it? That's what it cost — or gained. Whether you won THIS pot is a coin flip. The 1.7bb is forever."

| Learner says | Coach says |
|---|---|
| "I got unlucky" | "What was your equity when the money went in? If above breakeven, you made money in expectation. The card was irrelevant." |
| "I should have folded, they had it" | "How many combos of 'it' exist versus how many bluff combos take that line? If bluffs outnumber value, you call forever and accept losing this one." |
| "My bluff worked so it was good" | "If they fold 80% and you need 40% folds to profit, the bluff was good. If they fold 35% and happened to fold THIS time, the bluff was bad and you got lucky. Which?" |

### "Why Did They Raise?" — The Four Answers

Solvers show a hand raises 45% in a spot. The learner asks "but WHY?" The solver cannot answer. The coach answers with exactly one of four reasons:

| Reason | Mechanism | Example |
|--------|-----------|---------|
| **Value raise (building pot)** | Hand is strong enough to want more money against continuing range | "JT raises on J-T-4 because it's top two — wants stacks in before a scare card." |
| **Semi-bluff raise (equity + fold equity)** | Has outs if called, prefers a fold | "9h8h raises on Jh-7h-2c — 15 outs, and if villain folds overpairs, wins immediately." |
| **Blocker raise (removes calling combos)** | No equity but blocks villain's continues | "Ah-5c raises river on Kh-Qh-7h-3d-2s — Ah removes every flush from villain's calling range." |
| **Balance filler (indifferent, selected to fill range)** | EV(raise) = EV(call); solver picked it for blocker profile | "QdJd on K-T-4-7-2 raises sometimes — not because it's better than calling, but the raising range needs bluff bodies, and QJ blocks KQ/KJ." |

How to distinguish in practice: "If every continuing hand called instead of raising, would this hand still want to raise?" YES = reason 1 or 2. NO = reason 3 or 4. Then: "Does it have outs?" YES = reason 2. NO + blocks continues = reason 3. NO + doesn't block but range needs bodies = reason 4.

### The EV Severity Gate

| EV cost of error | Coach response |
|---|---|
| Under 0.5bb | Silence. Mark in tracking. Address only if it recurs 5+ times. |
| 0.5-2bb | "Incorrect." + principle name only. No elaboration unless learner asks. |
| 2-5bb | Full gate question + correction. This is the teaching zone. |
| 5-10bb | Full correction + contrast set (2-3 variant boards). Real leak. |
| Over 10bb | Stop the session. This error is the entire lesson. Reconstruct the decision tree from scratch. |

Human attention absorbs roughly 3-5 corrections per 30-minute session. Spending one on a 0.3bb spot means a 6bb spot goes unaddressed.

### Verbatim Correction Scripts

**Script 1: Calling too loose from BB — K7s facing UTG 3x open**

Error: Learner calls because "I'm suited and getting odds."

> "Equity realization, not raw equity. K7s has 33% equity against UTG's range — barely above the 31% pot odds require. But you're out of position for three streets against a range where every Kx dominates you. When you flop a king, you don't know if you're ahead or crushed. You realize maybe 70% of that 33%.
>
> Boundary: K9s is the worst suited king that defends here. The difference: K9 makes better two-pair combos and its kicker survives against KT/KJ. K7 never outkicks anything in their range.
>
> 76s also defends — different reason. It never dominates anything, but it has nut potential (straights on 5-8-9 type boards) and perfect clarity (you flop a draw or you fold). K7s is stuck in the middle: not enough nut potential, zero clarity, dominated when you connect."

---

**Script 2: Bad river call against an unbalanced river bettor**

Error: Villain bets 75% pot on the river. They've shown only strong hands 6 of 7 river showdowns. Learner calls with second pair "because I might be good."

> "You need to beat their VALUE hands to profit from a call, not their bluffs. This player has shown you value 6 of 7 times on the river. Equilibrium says they should bluff 30% at this sizing — they're bluffing maybe 15%. Your call needs 30% equity against their betting range; you have maybe 18%.
>
> Boundary: if this same player had shown bluffs 3 of 7 times, you call. That's close enough to balanced that your bluff-catchers break even. The trigger to fold: fewer than 2 bluffs in 7 river showdowns. Below that rate, all bluff-catchers become folds against THIS player, regardless of your hand."

---

**Script 3: Missed c-bet — checking back A-high on K72r as preflop raiser IP**

Error: Learner checks back ATo on K72r after opening BTN, BB called. Reason: "I don't have a king."

> "Range advantage determines who bets, not your hand. Your range on K72r has all the Kx hands, all the overpairs, and all the big aces. BB's range has some Kx but also 97s, 64s, T8s — hands that missed completely. You bet 33% pot with your ENTIRE range here. ATo is not a value bet — it's part of a range bet that forces BB to fold 25% of their air and denies free cards to hands with 6 outs against you.
>
> Boundary: if this board were 876 with two spades, you check ATo. Why? BB's range CONNECTS — they have straights, two pairs, and flush draws. You no longer have range advantage. Your hand with no draw and no pair becomes a check-fold, not a bet."

---

**Script 4: Cold-calling a 3-bet OOP with JTs**

Error: UTG opens, HJ 3-bets, learner calls from CO with JTs. Reason: "It's suited and plays well postflop."

> "4-bet or fold when cold. JTs cannot survive a 3-bet pot out of position against two strong ranges. The pot is already bloated, your SPR will be ~3-4, and JTs needs a high SPR to realize its nut potential through implied odds. At SPR 4, you'll flop a flush draw and have no room to maneuver — you either check-shove 60bb with a draw or check-fold and waste your preflop investment.
>
> Boundary: QQ is the worst hand that cold-calls here, and ONLY with position on the 3-bettor and a small 3-bet size. Everything below QQ either 4-bets (KK+, AK — enough equity to play a big pot) or folds (everything else — not enough equity at the reduced SPR). JTs folds because the SPR it needs (10+) no longer exists."

---

**Script 5: Results-driven wrong lesson — "I need to stop calling river bets"**

Error: After losing three river calls in one session, learner concludes they're calling too much.

> "Zero new information. You lost three calls. How many river calls did you make total tonight? If you made eight calls and three lost, that's a 62% win rate on calls — you're printing money and should call MORE. You're encoding three losses because they hurt. The five wins didn't register because they felt expected.
>
> The question is never 'did it work?' The question is: 'What price was I getting, and was my equity above that price?' If you called 75% pot bets with hands that had 35% equity against their range, every single call was correct regardless of which three happened to lose tonight.
>
> Boundary: you SHOULD tighten your river calls when you have evidence that a SPECIFIC player bluffs below equilibrium frequency — meaning fewer than 2 bluffs per 7 river value bets you've observed from THEM. Three losses against three different players in one night is variance, not a pattern."

---

**Script 6: Wrong sizing — potting it on K72r with top pair**

Error: Learner bets 75% pot on K72r with KJo. Reason: "I have top pair and want to protect it."

> "Size follows range shape, not hand strength. Your range on K72r is MERGED — everything from AA down through AK, KQ, KJ, KT, 99, 88, and your bluffs. A merged range bets small: 25-33% pot. Why? At 33%, opponent must defend 75% of their range — they call with all pairs and some ace-highs, and you extract from all of them. At 75%, they fold everything below top pair — you deny yourself value from second pair, third pair, and ace-high that would have called small.
>
> Boundary: on QJ9 with two spades, NOW you bet 67-75% with KK. Why? That board is dynamic — 20+ turn cards change the equity picture. You must charge draws their full price. K72r has 3-5 scary turn cards. No urgency, no need for a large price. Small bet, high frequency."

---

**Script 7: Incoherent river bluff**

Error: Learner check-calls flop, check-calls turn, then leads river for pot on A-K-7-4-2 rainbow with 65s (missed gutshot). Reason: "I can't win at showdown."

> "What value hand takes this exact line? You check-called twice then led pot on the river. What strong hand checks flop, checks turn, then suddenly bets big? None. AK bets the flop. 77 raises the flop. A slow-played set bets the turn. Your story is: 'I had nothing, I had nothing, now I'm the nuts.' No hand does this. Opponent calls because your line is incoherent.
>
> Boundary: if you had BET the flop with this hand (as a semi-bluff with the gutshot), then bet the turn, then bet the river — that line represents AK, AA, sets. The story makes sense. Bluffs must be PLANNED from the first street where the story begins, not improvised on the river when you realize you missed. A bluff without a story is just lighting money on fire."

---

**Script 8: Over-folding to a turn raise — folding top pair + good kicker to a single raise**

Error: Learner has AQ on Q-8-3r, bets turn (4 falls), faces a 2.5x raise, folds. Reason: "They must have a set or two pair."

> "Count their value combos vs bluffs. On Q834r, what hands raise the turn for value? 88 (3 combos), 33 (3 combos), Q8s (1 combo), maybe 84s (1 combo). That's 8 combos. What hands raise as a bluff? Any flush draw that picked up equity, any gutshot — easily 10-15 combos. You're folding to a range that is 40-60% bluffs.
>
> You're getting 2.5:1 on the call. You need 28% equity. Against their raise range (even if we weight toward value), AQ has 35%+ equity.
>
> Boundary: if the board were Q83 and the turn brought a SECOND queen (Q83Q), now their raise range shrinks to ONLY full houses (83, 88, 33) because trips would just call. That's 7 combos of pure value with almost no bluffs. Now AQ folds. The paired board removes the bluffing incentive — that's what flips the answer."

---

**Script 9: "Betting for protection" without identifying value or bluff**

Error: Learner bets 60% pot on the turn with 99 on A-7-5-J (no flush draw) after checking flop. Reason: "I need to protect against overcards."

> "Every bet is either value or bluff. Which is this? If it's value: what worse hand calls? Pocket 8s? They probably folded. 75s? Maybe — that's one combo. If one combo of worse calls and ten combos of better (AJ, AT, A7, A5, JT, QJ) are already ahead, this is not a value bet.
>
> If it's a bluff: what better hand folds? Nothing. AJ doesn't fold to a 60% bet.
>
> So it's neither value nor bluff. It's a check. 99 on A-7-5-J is a bluff-catcher. Bluff-catchers check and call. They never bet.
>
> Boundary: if the board were 7-5-3-2 with no flush draw, NOW 99 is thin value. What calls worse? 87, 76, 65, A5, A3 — twelve combos. 'Protection' was the wrong word for the right instinct on a board where you're actually ahead of the calling range."

---

**Script 10: Playing results — checking back the nuts after a cooler**

Error: Gets stacked with 555 vs 888 on 8-5-2. Next orbit, checks back a set of sevens on 7-4-2 "to see if they have a higher set first."

> "Zero new information received. Set over set happens 1 in 100 times you flop a set. You lost one. The probability is still 1 in 100 next time. Checking back the nuts because of what happened twenty minutes ago is paying a 100% tax on one hand to avoid a 1% disaster. You miss a full pot of value 99% of the time.
>
> Your set of sevens on 7-4-2 is the nuts right now. Bet 75% pot. If they have 44 or 22, you get stacked and it was still correct.
>
> Boundary: the spot where you DO slow down with a set is SPR 12+ on a dynamic board (set of 7s on 7-6-5 two-tone). There, checking isn't about fearing a higher set — it's about 40% of turns running out badly. THAT'S a reason. 'It happened last time' is never a reason."

---

### The Fade: Same Correction at Three Levels

Example: Missed c-bet on K72r (Script 3 above)

| Level | Correction | Word count |
|-------|-----------|------------|
| Beginner | Full 4-part correction with range explanation and boundary | ~80 words |
| Intermediate | "Range advantage. You own this board. 33% with everything. Flips on connected/wet textures where BB's suited connectors hit." | ~25 words |
| Advanced | "Range bet." | ~3 words |

**Fade triggers:**
- Beginner → Intermediate: 3 consecutive correct applications with correct stated reasoning across different boards.
- Intermediate → Advanced: 85%+ accuracy on novel instances across 3 spaced sessions.
- Advanced → Silence (checkmark only): threshold holds for 14+ days.

Continuing to explain to an improving player actively degrades their skill. Explanation creates a crutch — the brain waits for the external voice instead of generating its own reasoning.

---

## The Silence Rule

When the learner commits to the correct action with correct reasoning, the optimal response is confirmation only — no elaboration, no praise, no additional teaching.

Three mechanisms:
1. Adding explanation after correct answers trains the learner to wait for external validation instead of trusting their own judgment.
2. Attention is finite per session — explanation after correct plays burns it on spots where the learner needs no help.
3. Silence IS the signal that builds autonomy — it says "your internal reasoning is now the authority."

A coach who explains after every hand, right or wrong, makes every hand feel equally uncertain, destroying the learner's ability to distinguish "I know this" from "I am guessing."

**What is never said after a correct answer:** "Nice try." "Good thinking." "And also consider..." "You could also..." Any praise variant. These train approval-seeking, not reasoning.

---

## Hours 1-10: The Concrete Plan

### Hour 1: Install Pot Odds (Day 1)

- **0-15 min:** Price Tag Flashcards. 12 cards showing bet sizes as fraction of pot (25%, 33%, 50%, 67%, 75%, 100%, 125%, 150%, 200%, 250%, 300%, all-in for common SPRs). For each: state (a) opponent's minimum defense frequency [defense = pot/(pot+bet)], (b) your required bluff percentage [bluff% = bet/(pot+bet)]. Run full deck in under 50 seconds. Session 1 allows formula recall; Session 2+ must be instant.

- **15-30 min:** The Indifference Construction Exercise. Toy game: pot 100, river, you bet 100 (pot-sized), opponent calls or folds. Your range = 50% nuts, 50% air.
  - Work through: if you bet all, opponent always calls (you're 50% bluffs; they need only 33% equity to call and they have 50%).
  - Derive: to make opponent indifferent, your range when betting must be 2/3 value, 1/3 bluff.
  - From their side: opponent must call 50% to make your bluffs indifferent.
  - Verify: bluff EV = 0.5(+100) + 0.5(-100) = 0. Call EV = (2/3)(-100) + (1/3)(+200) = 0.
  - Repeat with 1/2 pot bet, 1/3 pot bet, 2x pot bet. Derive ratios fresh each time.

- **30-45 min:** First 20 hands of Commit-Reason-Reveal protocol. All hands are preflop decisions from various positions. Student writes action + reason. Coach reveals. Self-marks green/yellow/red. Pace: one per 30 seconds.

### Hour 2: Install Preflop (Day 2)

- **0-5 min:** Price Tag drill — full deck, under 50 seconds. Daily warmup from now on.

- **5-25 min:** The Three-Filter Open Test (live drill). Shuffle a deck, deal two cards. Student announces position (rotate UTG through BTN). Speaks three yes/no answers: "Dominance? Nut potential? Clarity?" Announces "Open" or "Fold." 30 seconds per hand, 40 hands. Coach marks against reference chart. Only catastrophic errors (folding clear-opens) corrected.

- **25-40 min:** UTG Anchor Build. Write the range in four tiers on paper. Read once. Cover. Reconstruct from memory. Three attempts, then reconstruct the whole range in under 90 seconds. Must hit 80%+ on cold recall next day.

- **40-50 min:** Linear or Polar Snap Decision drill. Coach calls scenarios: "BTN opens, you're in BB" → "Polar" (3 seconds). "UTG opens, you're in HJ" → "Linear" (3 seconds). After each response, construct 5 hands from memory. 20 reps total. Target: under 2 seconds for linear/polar call, under 10 seconds for 5-hand construction.

### Hour 3: Install Board Texture (Day 3-4)

- **0-5 min:** Price Tag + 5 preflop opens from the Three-Filter test (maintenance).

- **5-35 min:** Board Flash Drill — first session. 100 boards at 5 seconds each. Student calls: Texture class, Who it favors, Default sizing. Coach corrects in one word. No explanations. Two blocks of 100, 2-min rest between. Target: just get familiar, 50-60% accuracy is expected.

- **35-50 min:** Turn Scare Card Counting Drill. Display a flop. Student has 8 seconds to state how many turn cards (out of 47) significantly change the equity picture. Thresholds: Dry = 3-6. Semi-dynamic = 10-15. Dynamic = 20-28. After number, name 3 specific scare cards and why. 15 boards.

### Hour 4: Install Range Roles (Day 5-6)

- **0-5 min:** Board Flash (200 boards, 5 seconds each, one 20-min block). Building volume toward 3,000.

- **5-35 min:** One Hand, Many Boards. Fix A5s. Deal 50 flops. For each: name role (Nutted/Thin Value/Bluff-Catcher/Semi-Bluff/Blocker-Bluff/Unplayable) + action (Bet-Big/Bet-Small/Check-Call/Check-Fold/Raise) in 5 seconds.

- **35-50 min:** Same drill with 87s (25 boards). Different role distribution — more semi-bluff, more unplayable, fewer thin value.

### Hour 5: Install Sizing Logic (Day 7-8)

- **0-15 min:** Board Flash (200 boards, 3 seconds target). Should be at 70%+ by now.

- **15-35 min:** Size-Texture Snap Drill. 30 board texture cards, each with context ("SRP BTN vs BB" or "3-bet pot IP"). Student states: (a) one of three sizes — small 33%, medium 67%, overbet 125%, (b) one word WHY — "polar", "merged", or "nut-advantage". All 30 in under 3 minutes. Score: 25+/30 = pass.

- **35-50 min:** SPR Commitment Decision Drill. Present scenarios at varying SPRs.
  - SPR 3 with top set: "One big bet. Bet 75% flop, set up turn shove."
  - SPR 20 with top set: "Three streets or two + check. Bet small across streets or bet-bet-check."
  - SPR 2 with flush draw: "Shove flop — fold equity alone profits."
  - SPR 12 with flush draw: "Call and realize equity across streets."
  
  10 scenarios, each requiring SPR calculation + multi-street plan.

### Hour 6: First Integration (Day 9-10)

- **0-30 min:** Full Integration Drill (3-Second Flop Protocol). 50 hands, given preflop scenario + hand + flop. Produce full output (texture, favor, sizing, role, action) in 3 seconds. Accept 60-65% accuracy — this is hard.

- **30-45 min:** Contrast sets for every miss from the integration drill. One variable at a time.

### Hour 7: Install the Coaching Framework (Day 11-12)

- **0-20 min:** Board Flash (should be at 85% accuracy, 3 seconds now, 200 boards).

- **20-40 min:** Interleaved Random Queue (first full session). 40 hands mixing all types. Student tags spot type BEFORE committing. Track discrimination vs execution separately.

- **40-50 min:** Review all misses. For each, student answers the gate question. Coach delivers correction only at 2-5bb+ severity. Under 0.5bb: silence.

### Hour 8: Install EV Thinking (Day 13-14)

- **0-15 min:** Interleaved queue (40 hands, maintenance).

- **15-35 min:** The EV Ruler (live play or replay). At every 10bb+ pot decision: (A) What fraction of pot am I risking? (B) What equity do I need to break even? (C) Am I above or below by 5+ points? If above by 5+: clear, act. If below by 5+: clear, fold/check. Within 5: mark "close" — review later. Practice on 20 hands from replayed sessions.

- **35-50 min:** Cost-It-Out. Take 5 largest pots from a recent session. For each: state decision point, what you did, the alternative, napkin EV for each, the difference in bb. Rank by cost. If largest is under 2bb: move on. If over 5bb: this is your study topic.

### Hour 9: Deliberate Play (Day 15-16)

- **Full session of play** (30-60 min live or online) executing ONLY: memorized preflop rules, 3 postflop heuristics (c-bet 33% on dry boards with range, check on wet boards without nut advantage, bet 66% on turns with value+draws). No reads, no adjustments. Flag 5 non-trivial decisions for later review.

- **Post-session (15 min):** Covered-Result Review. For each flagged hand: write villain's range, your equity, whether your action was correct at equilibrium. Grade CLEAR CORRECT, CLEAR WRONG, or CLOSE. Only then check results. Note if seeing the result changes your grade — that is corruption.

### Hour 10: Certification Check (Day 17-18)

- **0-30 min:** Full integration drill at playing speed. 50 hands, 3 seconds each. Score must be 85%+ on boards you've never seen before. If below: return to Hour 6 and repeat.

- **30-50 min:** Backward Hand-Reading Speed Drill. 20 hand histories showing only preflop action + board + opponent's final river action. 15 seconds per hand: "Name 3 value hands and 2 bluffs that would take exactly this line at this sizing." Score +1 if actual hand was in your list. Target: 10/20 on first attempt.

After Hour 10, student enters the Baseline Certification Gate before any exploitation training.

---

## The Exploitation Ladder

### The Gate: Baseline Certification

Play 2,000 hands (or equivalent sim time, ~8 hours) executing only memorized strategies. No reads, no adjustments.

Certification requirements:
- VPIP/PFR within 2% of chosen strategy
- C-bet frequency within 5% of target
- Fold-to-3-bet matches chart

Any stat outside tolerance = repeat the block. Only after TWO consecutive certified blocks (4,000 hands / ~16 hours) proceed to exploitation training. Time: 2-3 weeks online, 4-6 weeks live.

The reason this gate exists: a player who must think about baseline play cannot simultaneously observe opponents. Deviation from a shaky foundation is not exploitation — it is improvisation, and improvisation in a negative-sum game is creative losing.

### Sample Size Requirements (Non-Negotiable)

| Observations | Confidence | Maximum deviation from GTO |
|---|---|---|
| 4 hands | Can distinguish recreational vs regular (60% confidence). Nothing else. | Zero deviation. |
| 15 relevant actions | One gross tendency — very tight or very loose VPIP (70% confidence). | Maximum 10-15% shift. |
| 50 relevant observations of SAME action type | 75% confidence on a specific frequency. | 30-40% shift toward exploit. |
| 100+ relevant observations | Real precision. | 50-70% shift. |
| Never | 100% confidence. | Never deviate fully. |

**VPIP** is the most sample-efficient read: every single hand provides one data point. A player who enters 8 of 12 pots is almost certainly 65%+ VPIP. This cascades to every postflop decision against them — weaker average range, so more thin value, less bluff needed.

**Fold frequency to turn/river aggression** is the highest-leverage specific tendency because pots are 4-12x bigger than on the flop.

Track maximum 2-3 tendencies per opponent simultaneously. Human working memory holds 4±1 chunks. With 5-8 opponents consuming attention, you get at most 2-3 reliable counters per player.

### The Deviation Catalogue

| Opponent Leak | Your Counter | What It Exposes You To | Revert When |
|---|---|---|---|
| Folds >65% to river bets (equilibrium: ~50% vs pot-sized) | Bluff river with all missed draws and blocker hands | You lose full bet when they DO call — they have strong hands when they continue | They call 2 river bets in 30 minutes |
| Folds >70% to c-bets (equilibrium: ~55-60%) | C-bet 100% of flops at 33% sizing | You get check-raised more when they finally fight back | They check-raise you once or show a trap at showdown |
| Never bluffs rivers (bluffs <15% of river bets) | Fold all hands weaker than top pair to their river bets | You fold to the one time they DO bluff — but this is free money via inaction | They show a bluff at a river showdown |
| Calls too wide preflop (VPIP >45%) | Value bet thinner, reduce bluffs, expand value range postflop | If their wide range connects with a dynamic board, you pay off a hidden two-pair or straight | Board runs out very connected; slow down |
| Bets too large with marginal hands (uses pot-size with one pair) | Call down lighter and wider with bluff-catchers | You pay off their legitimate value bets at full price | They show down the nuts after a pot-sized bet |
| Never raises for value (always flat-calls with strong hands) | Bet-bet-bet for value with thinner hands — they won't raise to warn you | You overbet into a monster they slow-played | They raise you — once is enough to reset |
| 3-bets too tight (<4% from the blinds) | Open wider from late position, fold to their 3-bets with everything except premiums | If they widen their 3-betting, you've been folding too much | They 3-bet you twice in one orbit |
| Donk-bets paired boards with air | Call flop, raise turn if they bet again (they're double-barreling bluffs) | You get stacked by the rare trips that donk-bets for deception | They show trips at showdown |

### The Exploit-Exposure Pairing Protocol

Before executing ANY deviation, verbalize (internally or written):
- **EXPLOIT:** What you are doing differently.
- **EXPOSURE:** What beats you if the read is wrong.
- **CAP:** How you limit the damage.

Example: "EXPLOIT: bluffing river because villain folds 75%+. EXPOSURE: if he calls, I lose full bet with air. CAP: only doing this with hands that have zero showdown value anyway — not sacrificing a free showdown."

### Levelling: One Level Above, Never More

Against a recreational player who thinks only about their own hand (level 1), play level 2: what do they have, and does my action profit against that range? Going to level 3 is fantasy — they are not thinking about your range, so adjusting to what they think about your range adjusts to something that does not exist.

The rule: play one level above your opponent. Against most live players, that means level 2.

### Revert Triggers (Pre-Committed, Concrete)

Revert to baseline when any of these fire:
1. Villain shows down a hand contradicting the tracked tendency.
2. Villain's behavior changes visibly (posture, sizing pattern, verbal pattern after a loss).
3. A third competent player enters the pot.
4. You have been caught exploiting twice in 30 minutes.
5. You feel angry, tilted, or triumphant — any strong emotion degrades read accuracy.

Without pre-committed triggers, the exploiting player relies on in-the-moment judgment about when to stop — and that judgment is biased toward continuing because stopping feels like giving up an edge.

### The Exploitation Ratchet (In-Session Protocol)

1. Track ONE stat per opponent: fold-to-bet on a specific street. Tally each fold or showdown.
2. After 8-10 observations, state hypothesis: "Villain folds to river bets >70%."
3. State the exploit: "I will bluff the river with any missed draw."
4. State the risk: "If villain notices and starts calling, my bluffs lose. If villain calls two river bets in a row, I revert."
5. Execute for 5 hands.
6. Post-session: was the read correct? Did the exploit gain or lose? Adjust.

Only deviate in spots where the EV gap between GTO and exploitative action is LARGE. If theory says a spot is 52/48 between bet and check, no read makes deviation meaningful. Deviate where theory says bet 75% but villain's tendency makes betting 100% gain a full 25% of pot.

---

## Beating Variance: Making a Lying Feedback Signal Usable

### The Core Problem

A winning player at 5bb/100 loses money in roughly 40% of individual sessions. Correct thin-value bets and correct thin calls are punished by results MORE often than rewarded (the 60% win produces less emotional signal than the 40% loss). The brain's pattern-recognition system detects real patterns — in corrupted data. It evolved for environments where outcomes ARE informative (fire burns, avoid fire). In poker, the system works but on noise artifacts.

### The Covered-Result Review Protocol

1. During play, flag 5 hands where you faced a non-trivial decision. Write the hand up to YOUR decision point. Stop there. Do not record the result. (2 min total, spread across session.)
2. Wait minimum 24 hours.
3. Open flagged hands. For each (5-8 min per hand): (a) Write villain's range. (b) Write your equity. (c) Identify whether your action at equilibrium frequency supports it. (d) Grade: CLEAR CORRECT, CLEAR WRONG, or CLOSE.
4. Only after grading all 5, look up results. Note if your emotional response changes your grade — that is corruption.
5. Track CLEAR WRONG count per week. Target: below 1 per session within 8 weeks.

### The Post-Loss Lockdown Protocol

Session ends with a loss. Start a 24-hour timer.

**PERMITTED:** Log hands mechanically. Note physical state. Do something else entirely.

**FORBIDDEN:**
- Telling anyone a bad beat story.
- Any sentence starting with "I should have..."
- Revising any strategic default.
- Reviewing any hand for strategic content.
- Deciding whether to move up or down in stakes.

After 24 hours: run Covered-Result Review on flagged hands. If 0-1 CLEAR WRONG: session was fine, variance happened. If 2+: identify the common thread and create one specific drill.

The ONLY valid strategic conclusion from a losing session is discovered 24+ hours later through blind review.

### The Zero-Information Mantra (Tilt Interrupt)

A bad beat occurs. Within 5 seconds — before the next hand — say internally:

> "Zero new information. [X]% event occurred. No update."

Replace [X] with villain's actual equity. "Zero new information. 18% event occurred. No update."

If you feel the pull to play differently: name it. "My system wants me to play tighter with overpairs. That is a corrupted update. My strategy does not change."

If after 3 bad beats you cannot say the mantra with genuine indifference: leave the table for exactly 10 minutes. Return only when you can say it flatly.

Practice: for the first 2 weeks, say the mantra after EVERY pot lost, even small ones. Build automaticity so it fires when you need it.

The mechanism: the corrupted update happens in the first seconds after the outcome during encoding. Explicit counter-framing during the encoding window prevents the false belief from forming. Walking away helps arousal but does not prevent the strategic corruption — the encoding already happened.

### Pre-Action Distribution Prediction (The Clean Feedback Loop)

The ONLY reliable short-term feedback signal: predicting opponent action distributions before they act, then scoring the prediction.

1. Choose 10 hands per session where you are not in the hand.
2. Before villain acts, commit: probability they bet vs check; if they bet, size bucket (small/medium/large/overbet).
3. Score: +1 if your most-likely action was correct, +0.5 if second choice occurred, 0 otherwise.
4. Track score over sessions. Beginner: 4-5/10. Intermediate: 6-7/10. Expert: 7.5-8.5/10. You'll never reach 10 (genuine mixing).
5. Weekly: review worst predictions. "What information was available that I ignored?"

This provides immediate, clean, outcome-independent feedback on every hand observed. Over 500 predictions the player develops calibrated reads backed by statistics, not anecdote.

### Sample-Size Calibration (Visceral Drill)

Take a coin. Flip 10 times. Record heads%. Do this 5 separate times. You will see 30%, 60%, 70%, 40%, 80%. All from a fair coin. Your "read" on an opponent after 8-12 hands is LESS reliable than this.

Rule of thumb: true frequency ±30% with only 10 observations. Until 15+ observations in the same category, label any read PROVISIONAL and do not deviate from default strategy.

---

## What We Delete, and Why

Every item below is actively harmful — it installs wrong beliefs, wastes scarce attention, or produces the illusion of learning without the substance.

| Deleted Item | Why It Is Harmful |
|---|---|
| Memorizing 6 separate position-specific opening charts | All derivable from UTG + one rule per seat. Chart memorization is slower and more fragile under stress than knowing the generator. |
| Open-limping strategies | Forfeits initiative, leaks information, invites multiway pots. Dominated by raising in every solver output. |
| "Tight is right" as a universal principle | Correct from EP, catastrophically wrong from BTN/BB where folding too much hands the blinds guaranteed profit. |
| "Bet for information" | There is no information bet. You are either value betting or bluffing. The information is a free side effect. |
| "Pot control" | Just "checking is higher EV" dressed in a name that obscures the reason. |
| "Bet for protection" as standalone concept | Either a value bet or a bluff in disguise. Calling it protection lets you avoid asking which one it is. |
| "Never slowplay" | Sometimes checking the nuts IS correct to protect your checking range. |
| "Table image" | Irrelevant until you understand your own strategy well enough to predict what opponents think you're doing. |
| Physical tells as a primary skill | At stakes below $5/$10 live, mathematical play captures 50x more EV than read-based play. |
| "Play the player not the cards" | Vague to the point of harm. The real concept is: identify a specific frequency deviation and calculate the counter-adjustment. |
| Starting hand tier lists with 5+ categories | Hand value is position-dependent and opponent-dependent. A single ranking actively misleads. |
| Exact RFI percentages to one decimal place | Boundary hands are nearly zero-EV. 14% vs 16% costs less than 0.02bb/hand. False precision. |
| Mixed-frequency strategies for preflop spots | Always-open or always-fold produces within 0.01bb of the mixed strategy. Mixing correctly wastes attention on randomization devices. |
| "Always c-bet 66%" as a fixed rule | An average that destroys information. The correct number ranges from 25% to 90% depending on texture. |
| Memorizing solver frequencies for mixed-strategy hands | The frequency is free to deviate from. Only the THRESHOLD hand matters. |
| "Bet big for value, small as a bluff" | Backwards. Polar ranges bet large with BOTH value and bluffs. Hand-strength-based sizing leaks your holding. |
| "Balance your bet sizes" without mechanism | Without knowing polarity determines size, the student just randomizes — worse than consistency. |
| More than 3 bet sizes before mastering 3 | EV gain from a 4th size is sub-0.3bb/100, far below cognitive overload costs. |
| Bet sizing tells as a beginner study priority | Low-stakes opponents don't size consistently enough to exploit. Attention better spent on fundamentals. |
| Tracking win-rate during learning phase | Variance makes it meaningless under 50,000 hands. Tells you nothing about which decisions are wrong. |
| Session results on a graph | Creates emotional relationship with variance rather than decision quality. |
| Marathon 3-hour study sessions | Quality collapses after 30-40 decisions. Last 2 hours train sloppy pattern-matching. |
| Drilling one spot to 95% before moving on | Comfortable, inflates scores, fails to build discrimination (30-40% of table performance). |
| Praising correct answers | Trains approval-seeking, not internal confidence. Silence IS the signal. |
| Explaining edge cases before base case is at 80% | Confuses the principle. Makes learner think "it's complicated" when base covers 85%. |
| Hand history review where coach talks for 40 minutes | Passive consumption with no forced output. |
| Watching training videos without committing first | Builds recognition memory, not generation skill. Zero table improvement. |
| Reviewing largest pots lost | Guarantees you study high-variance spots rather than high-frequency leaks. |
| "In my experience..." | Anecdote is not mechanism. State the principle and the math. |
| "It depends" as a standalone answer | Always true, never actionable. Must specify what it depends on and the threshold where the answer flips. |
| Soul reads and one-hand narratives | Single hands carry zero statistical weight. Dramatic stories damage calibration. |
| Physical tells, timing tells, table-talk meta-game | Noise at the volume most players can generate. Worth 0.1bb/100 at best. |
| Level 4+ thinking | Pure fantasy against 95% of opponents. |
| "I need more experience in this spot" | Unfalsifiable non-advice that delays the actual correction. |
| Tracking opponents you'll never see again | You cannot accumulate data to exploit a tourist. Baseline dominates. |
| Bad beat stories in any form | Rehearse narrative formation — the exact skill you must extinguish. |
| EV-adjusted winrate calculators as motivation | Adds noise to noise. Corrects only all-in runouts, gives false confidence. |
| Reviewing play immediately after a session "while fresh" | Freshness = maximum emotional bias + maximum confidence in corrupted recall. |

---

## The Honest Hard Parts

### Where This Method Is Demanding

**The 5,000-rep perceptual threshold.** Board texture classification requires 8-10 hours of focused flash-drill over 2-3 weeks. This is boring. It is not intellectually stimulating. It is the difference between understanding the game and being able to play it. Most learners abandon this phase because it feels menial. It is the single most important bottleneck.

**The silence after losses.** The 24-hour lockdown protocol violates every instinct. After a bad session, the brain DEMANDS to form a narrative — "I was too loose," "I should have folded that river." Suppressing this narrative without a replacement feels like ignoring a fire alarm. The replacement (wait, then review with results hidden) works but requires faith in the process for the first 10-15 sessions before the benefits become visible.

**The commit-before-reveal discipline.** Writing your action and reason before seeing the answer is effortful and exposes ignorance. Every session contains 8-12 moments of genuine "I don't know" that feel bad. Learners want to peek, want to skip the reason, want to give vague answers. Every shortcut here produces zero learning dressed as progress.

**Exploitation restraint.** After investing 40-60 hours in baseline, the learner is eager to "use it." The certification gate — 4,000 more hands of pure baseline — feels like prison. The temptation to start reading opponents immediately produces the confirmation-bias loop: successful exploits feel like genius, failed exploits feel like variance, and the player develops an identity as a creative reader without the data to back it. This is the most common path to a plateaued losing player.

### Where a Learner Will Most Likely Stall

| Stall point | What it looks like | The actual problem | The fix |
|---|---|---|---|
| Week 2 of board flash drills | Scores stuck at 70%, feels no improvement | Missing one specific texture class consistently (usually monotone or paired) | Identify the weak class. Drill 50 boards of ONLY that class, then re-integrate. |
| First integration drill | Under 60% accuracy, overwhelmed | Trying to compute all 5 outputs sequentially instead of perceiving the gestalt | Decompose: first call texture+favor only (2 outputs) for 100 boards. Then add sizing. Then add role. Build up to 5. |
| Post-certification exploitation phase | Over-deviates on 5 observations, loses the equivalent of baseline gains | Emotional excitement about "finally playing real poker" overrides sample-size discipline | Force the confidence calibration drill (coin flips). Require written justification of sample size for every deviation. |
| Results-based regression (month 2-3) | After a 10-session downswing, reverts to tight-passive "safe" play | The corrupted-update mechanism installed the wrong lesson during a loss cluster | Re-run the zero-information mantra protocol. Covered-result review reveals that "safe" play is costing more than the downswing was. Show the math. |
| Thin-value paralysis | Checks back every river, afraid of getting raised | Brain encodes the 40% of river value bets that get shown better (painful) more than the 60% that profit (expected) | Count: how many river value bets won vs lost over 200 hands. The NUMBER breaks the illusion that "it always goes wrong." |
| Bluff paralysis | Never bluffs rivers because "the bluff that gets caught" is seared in memory | Same availability bias — caught bluffs are 10x more vivid than successful ones | Calculate: how many folds did you get this session that you didn't register emotionally? Force the count. Then ask: was your total bluff EV positive or negative over 50 bluffs? |

### What I Would Watch For as the Coach

1. **Reason consistency.** Track the learner's stated reasons across sessions. If they bet the flop "because I have range advantage" on Monday and "because I have a good hand" on Thursday for the same structural spot — the concept is not installed. It is post-hoc rationalization that will collapse under pressure. Serve contrast set immediately.

2. **Discrimination vs execution gap.** If the learner correctly identifies spot types 80%+ but executes at 60% on one specific type, they understand the game but have a hole in one concept. This is the easiest stall to fix — it is one contrast set away from resolution.

3. **Concept drift under fatigue.** If accuracy drops in the last 10 minutes of every session, sessions are too long. Shorten to 25 minutes. Two short sessions at full quality beat one long session with degraded trailing edge.

4. **False "close" labeling.** If the learner marks 50%+ of decisions as "close" in the EV Ruler protocol, they are avoiding commitment. Impose a cap: maximum 8 "close" calls per 50 decisions. Forces actual triage.

5. **The 85% plateau trap.** If the learner is consistently above 85% on all concepts in training but still leaking in real play — the drills are too similar to prior instances. They are recalling, not transferring. Introduce maximally-novel surface features on the same deep principles. If accuracy drops to 70% on novel instances, that is the real level — the 85% was cache-hitting, not skill.

---

## Three Sizes: The Complete Bet-Sizing Framework

| Size | When to use | Range shape | Mechanism |
|---|---|---|---|
| **25-33% pot** | Dry-static boards (K72r, A83r). Paired boards (K55r). High c-bet frequency spots. Your entire range bets. | Merged (continuous block of hand strength) | Few turn cards change equity. No urgency. Small bet extracts from worse that folds to large. Wide frequency makes range unexploitable — too many value hands to raise into. |
| **67-75% pot** | Dynamic boards (JT8ss, 976r). Selective value+bluff spots. Standard turn/river sizing when ranges are clearly polar. | Polar-ish (value hands + draws/bluffs, with a check-back range in between) | Many turn cards shift equity. Must charge draws. Large bet separates range into clear value and clear bluff, denying equity. |
| **125-150% pot (overbet)** | You have nut advantage and opponent's range is capped (their strong hands already raised/bet earlier). River spots with pure nuts-or-air. 3-bet pots where you have all the best hands. | Maximally polar (nuts + air, nothing between) | Opponent's best hand is one pair; they cannot withstand an overbet with medium-strength holdings. Your nuts extract maximum; your bluffs get maximum fold equity. |

**The bluff-to-value ratio is mechanically determined by size:**
- 33% pot: 75% value, 25% bluffs.
- 67% pot: 60% value, 40% bluffs.
- 100% pot: 50% value, 50% bluffs (2:1 value:bluff in your betting range — equivalent because "bluff" means the pot-winning bluff needs to work at B/(B+P)).
- 150% pot: 40% value, 60% bluffs.

Formula: bluff% = bet / (bet + pot). Once you pick a size, count value combos and derive bluff combos.

**Geometric sizing across streets:** Choose a size that naturally commits stacks by the river. With 100bb effective and 7bb pot on flop, 67% each street: flop 4.7bb → pot 16.4bb → turn 11bb → pot 38.4bb → river 25.6bb. Total invested ~99bb. This eliminates awkward river over-shoves and tells a coherent story.

**When the solver shows a mix (55% bet / 45% check with ATs):** The two actions have IDENTICAL EV. The frequency is free — deviating from 55/45 to 70/30 costs zero for that hand. The THRESHOLD — where strategy flips from mostly-bet to mostly-check — is where all the money lives. Study thresholds, not frequencies. One threshold insight replaces fifty memorized numbers.

---

## Post-Session Review Protocol

After every session, pull 5 flagged hands. The ONLY permitted questions:

1. "What did you do and what was the alternative?"
2. "Estimate the pot at that decision point."
3. "Estimate your equity edge over breakeven — above or below, and by how much?"
4. "Multiply the edge by the pot. That's your gain or cost in big blinds."
5. "Is this above or below 2bb?" (Below: "Move on." Above: "Study topic.")

Never ask "what happened next" or "what did they show." The result is not part of review. If the learner volunteers the result: "I didn't ask what happened. I asked what it cost."

---

## The Learner's Stated Reason Must Be Tracked Across Time

Not just right/wrong — but WHICH reason they gave. A player who bets "because I have range advantage" on Monday and "because I have a good hand" on Thursday for the same spot has not installed the principle. They are post-hoc rationalizing correct actions with whatever framework feels salient. Under pressure, the weaker reason dominates. Inconsistent reasons on correct actions are a leading indicator of future breakdown. Track them.

---

## The First Exposure to Any Concept Arrives as a Problem, Never as a Lecture

The learner must fail productively before receiving the framework. The failure creates the question that the framework answers. A framework delivered before the learner has the question it answers is inert information — it has nowhere to attach. The order matters because the brain only builds strong connections to answers it was already seeking.

---

## Explanation Must Shrink as the Learner Improves

| Stage | Feedback after miss | Duration |
|---|---|---|
| Installation (weeks 1-2) | Full 3-sentence explanation: principle name, why it applies, what would change if one variable were different | Until concept hits 3 consecutive correct |
| Naming (weeks 3-4) | Principle name only: "range advantage" or "equity denial." Learner reconstructs why. | Until 85%+ on novel instances across 3 sessions |
| Binary (weeks 5-6) | "Incorrect." Learner self-diagnoses. After 5 seconds, may request principle name (counts as "hint used"). | Until threshold holds 14+ days |
| Batch (week 7+) | Delayed — complete 10 hands, review all 10 at once, self-marking first | Ongoing |

If accuracy drops below 70% at any stage, step back one level for that concept only.

---

## The Kill List: Things a Coach Must Never Say

| Banned | Why it fails | Replacement |
|---|---|---|
| "That's a good question" | Delays answer, zero content | Answer immediately |
| "It depends on the opponent" | True but useless without specifying what and how | "Against default, X. Against a folder (70%+ fold-to-bet), Y." |
| "You need to balance here" | Abstract without mechanism | "Your raising range needs 2 bluffs per value raise at this sizing, meaning [hands]." |
| "Think about what they have" | Too vague | "Name 3 value hands and 2 bluffs that take this line." |
| "You played it fine" | Unclear | Either silence (correct) or "0.3bb mistake, not worth discussing." |
| "In my experience..." | Anecdote ≠ mechanism | State principle and math |
| "That's a common mistake" | Normalizes, adds nothing | Delete entirely |
| "Does that make sense?" | Learner says yes to end interaction | "State the principle back in your words." |
| "Nice hand" / "Good thinking" | Trains approval-seeking | Silence |
| "You could also consider..." | Opens menu learner cannot close | Give one answer |
| "In general..." | Vague enough to be useless | Be specific |

---

## The Taxonomy of Self-Deceptions (Result-Based)

These form predictably from result-based learning:

1. **"This hand always loses here"** — AK on a low board after getting shown sets twice. Reality: 3 combos of sets in an 80-combo range.
2. **"This player always has it"** — After villain showed strong hands 3 times in a row. Reality: 3 observations, binomial noise.
3. **"I run bad in this spot"** — After losing with correct play 4 times in 200 hands. Reality: functioning variance.
4. **"I should have known"** — Hindsight rewriting where the result makes information seem obvious retroactively.

Each is the brain's pattern-recognition system operating correctly on corrupted data. The fix: starve it of outcome data and feed it process data instead.

---

## The Expert's Decision Stack (What Strong Players Do)

1. **Think in ranges, not hands.** The question is never "do they have a set?" but "what fraction of their range beats me?"
2. **Narrow subtractively.** Each action removes hands permanently. By the river: 8-15 combos.
3. **Read backward from the current action.** "What hands would take THIS action at THIS sizing given all prior streets?" — not forward from preflop range.
4. **Ask "what am I representing?"** before betting. A bet must tell a story some hand in your range would actually tell.
5. **Detect capped ranges instantly.** When opponent checks a street where strong hands always bet, their range is capped. Attack with large sizes.
6. **Spend zero energy on clear decisions.** All bandwidth reserved for the 10-15% of spots that are genuinely close.
7. **Default action for every category.** Execute without thought, upgrade to deliberation only when a specific trigger fires.
8. **Close decisions resolved quickly are worth more than perfect decisions reached slowly.** EV difference between close options is tiny; time/energy compounds as fatigue.

---

This is the complete system. Eleven concepts generate all correct play. Seven preflop rules replace 1,200 chart cells. Five board classes and six range roles, drilled to 5,000 reps, make postflop perception instant. Three bet sizes handle 90%+ of spots. The training loop uses commit-before-reveal, one-variable contrast sets, and interleaved random queues at 70-80% difficulty. The coaching voice corrects in 4 parts under 80 words, fades to silence as the learner improves, and never comments on spots under 0.5bb. Results are noise until 100,000 hands. Exploitation comes after 4,000 hands of certified baseline play, scales proportionally to observed sample size, requires a named exposure for every deviation, and reverts on five concrete triggers.

The player this produces is not the one who memorized the most. It is the one who can derive the answer to any novel spot from eleven principles, execute it in 3 seconds, and then — when facing a specific human — identify the one way that human deviates from what the principles predict, and extract exactly the margin that deviation allows. That is mastery.