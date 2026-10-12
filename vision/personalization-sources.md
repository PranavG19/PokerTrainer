# Personalization data sources (read from `src/`, branch `vision-panel`)

Two persisted files: the profile `offsuit-state.json` (`src/main/store.ts:37 save()` ← `src/core/session.ts:537 serialize()`,
`SessionState` at `session.ts:135`) and device settings `offsuit-settings.json` (`store.ts:21`).
"New" = a field the approved simple versioned profile (owner D2) would add; no migrations (no prior users).

| # | Feature | Recorded today? | Source | New field for the mocks |
|---|---|---|---|---|
| 1 | Hand history | Last 500 hands (`MAX_HAND_LOG`, session.ts:20) | `HandRecord` session.ts:66 (hole, board, net, vpip, pfr, grades, playedAt, decisions); `DecisionRecord` session.ts:43 (street, board, pot, toCall, action, verdict); `recordHand` session.ts:488 | `finalPot`, `wentToShowdown`, `villain {name, archetype}`, `pinned` (kept hands survive the 500 cap) |
| 2 | Leaks | Yes | `SessionStats.leaks/leakCostBb` session.ts:130; `computeStats` session.ts:514; `BiggestLeak` career.ts:61; `reachWeightedLoss` rw.ts:157; `recommend()` recommend.ts:219 | `DecisionRecord.errorTag` (G7 tags, progress.ts:30) for per-tag leaks |
| 3 | Your rule sentences | Yes | `SessionState.lexicon` session.ts:200; `AcceptedSentence` lexicon.ts:62; `feedbackOpening` lexicon.ts:303 | — |
| 3b | Typed decision reasons | No (graded then dropped) | `gradeReason` reasonGrade.ts:143, renderer/screens/table.ts:603 | `DecisionRecord.reason {text, category}` |
| 4 | Calibration | Aggregate | `SessionState.calibration` session.ts:149; `sureAccuracy` predict.ts:112; `CareerRecord.sureAccuracy` career.ts:85 | `DecisionRecord.prediction` for a trend line |
| 5 | Your style | VPIP, PFR only | `HandRecord.vpip/pfr` session.ts:72; `stats.vpipHands/pfrHands` session.ts:127; opponent axes `ArchetypeProfile` archetypes.ts:49 | Aggression, c-bet, fold-to-bet derived from `decisions[]`; lifetime counters in `SessionStats` |
| 6 | Rivals | No (reads are session-only by R4) | `reads.ts:42 Read`, `expireSession` reads.ts:156; nearest persisted: `gifts: GiftEntry[]` session.ts:175, giftLedger.ts:83 | `rivals[] {name, archetype, handsSeen, yourNetBb, leakAgainst}` (records outcomes, not reads, so R4 holds) |
| 7 | Mastery, depth | Yes | `fadingLog` session.ts:208 → `conceptStatesFromLog` schedule.ts:334; `gate()` schedule.ts:141; `standing()` standing.ts:226; `currentForm` standing.ts:276; `DEPTHS` standing.ts:38; `careerRecord` career.ts:163; `puzzleProgress` session.ts:192; `chartMastery` session.ts:184 | — |
| 8 | Days, streak | Partly | `HandRecord.playedAt` session.ts:80; `PracticeCadence` career.ts:72 (distinctDays, currentRun, UTC) | `sessions[] {startedAt, endedAt, hands}`; `streak {current, best, lastDay}` in local time |
| 9 | Identity, goals | No | `assessments` session.ts:239; `recommender.preferred` recommend.ts:63 | `profile {displayName, goals[], venue, stakes, experience, why, days[], deeVoice}` from onboarding |
| 10 | Chips | Current only | `bankroll` session.ts:136; `hands[].net` | — (chips stay out of rewards) |
| 11 | Settings | Yes | `coachedMode` session.ts:151, `spokenVerdicts` :156, `soundCues` :163; `tutorEnabled` store.ts:65; `theme` store.ts:109 | `dee {presence, voice, frequency}`; `cosmetics {back, felt, deeFinish}` |
| 12 | Tilt | No | nearest `currentForm` standing.ts:276 | derived from `playedAt` + `net` + EV loss after a big loss |

Rules that still shape personalization after the owner's full amendment (D1):
- The tutor/LLM never generates a number or grade and never receives bulk history (PRODUCT-SPEC.md:283–285), so Dee's weekly letter is **scripted templates filled from the numbers above**, not generated prose.
- G7 (PRODUCT-SPEC.md:234) and `BANNED_PHRASINGS` (progress.ts:448): no trait insults ("nit", "fish", "too loose"). The style identity names **how you play** in neutral, earned terms, with the numbers beside it, and it is recomputed, not a verdict on the person.
- G10 (PRODUCT-SPEC.md:240): no per-hand fold counterfactuals. "You folded a set correctly" is fine; "you would have won" is not.
