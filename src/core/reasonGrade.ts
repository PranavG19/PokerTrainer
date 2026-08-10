import type { Severity } from './coach.js';

/**
 * The reason grader (story 14, PRODUCT-SPEC line 96: "state a reason in one line and have that
 * reason graded separately from my action") and G4's escalation (line 212).
 *
 * LOCAL AND PURE. No network, no model call. Spec line 218 says test determinism is bought by
 * "the null-tutor stub and the reason-grader's recorded corpus", and line 436 says that with no
 * API key the app makes zero network calls — so a grader that can run on the no-key path has to be
 * a pure function over the text. This is the port of the classifier measured in
 * research/EXPERIMENT-3-reason-grader.md against research/corpus/reasons.jsonl (100 lines): 82/100
 * accuracy, G4 precision 84.9%. Those are the recorded numbers this module inherits, and the unit
 * test pins the per-line outcome so a regex edit cannot silently move them.
 *
 * IT IS NOT THE DEFAULT PATH. Line 218 names the three cases the non-model path covers — no API
 * key, tutor unreachable after one retry, 15 s with no typing — and says closed-set selection must
 * not be the default because it is the answer-matching item class the method measures at near-zero
 * transfer. This module grades free text rather than offering a picker, so it does not ship that
 * item class; but its 84.9% G4 precision is why `applyG4Override` treats a local label differently
 * from a tutor label (see `ReasonGraderSource`).
 */

/**
 * The closed label set, fixed verbatim by spec line 293 (tutor roles table, "Reason grader":
 * "one of `range` / `price` / `hand-strength` / `none`"). Not derived and not extended — G4 names
 * two of these four by name, so adding a fifth would silently change which decisions escalate.
 */
export type ReasonCategory = 'range' | 'price' | 'hand-strength' | 'none';

export const REASON_CATEGORIES: readonly ReasonCategory[] = [
  'range',
  'price',
  'hand-strength',
  'none',
];

/** The two labels G4 escalates on (spec line 212). */
export const G4_REASONS: readonly ReasonCategory[] = ['hand-strength', 'none'];

export interface ReasonGrade {
  readonly category: ReasonCategory;
  /**
   * True only for an outright admission of guessing — "I'm guessing", "idk", "not sure",
   * "i dont know why". Carried separately from the label because spec line 436 reduces G4 on the
   * fallback path to firing *only* on `I'm guessing`, which is a strict subset of `none`: a hunch
   * ("felt right", "gut call") and a degenerate line ("asdf", "?") also grade `none` and are not
   * admissions.
   */
  readonly explicitGuess: boolean;
}

const EMPTY_OR_EVASIVE = /^\s*$|^[\s.?!,\-]*$|^(idk|asdf|vibes|n\/a|na|because|dunno|no idea|\?+)$/i;

const EXPLICIT_GUESS =
  /\b(i(?:'m| am) guessing|i guess(?:ed)?|guessing|idk|i do ?n'?t know|dont know|not sure|no idea|dunno)\b/i;

const HUNCH =
  /\b(felt? right|feeling|gut|hunch|vibes?|guess(ing|ed)?|not sure|i don'?t know|dont know|idk|looks? weak|looks? strong|seeing what happens|worked last time|always play|instinct)\b/i;

/** "My cards" claims: rank talk, made-hand nouns, and the self-referential strength adjectives. */
const OWN_HAND =
  /\b(my (hand|cards|kicker|draw)|i have|i hold|i flopped|i'?ve got|top pair|top kicker|second pair|middle pair|bottom pair|overpair|top set|trip|trips|set|two pair|quads|full house|boat|nut(s|ted)?|monster|garbage|trash|rubbish|showdown value|ace high|king high|\d+ high|pocket \w+|best (possible )?hand|too good to fold|too pretty|plays itself|live|strong enough)\b/i;

const RANGE =
  /\b(range|ranges|dominat\w*|capped|uncapped|polari\w+|the hands? (that|he|she|they|which)|hands? (that )?(call|continue|fold|beat)|his hands?|her hands?|their hands?|villain'?s hands?|combos?|value hands?|bluffs?|opens? \d+%|defend|folds? out|only (get )?call(ed)? by better|worse (hands?)? (call|fold)|board hits?|hits? my range|broadway|position)\b/i;

const PRICE =
  /\b(pot odds?|odds|price|cheap|expensive|equity|percent|break ?even|implied odds|to win|risking|risk \d+|\d+ ?(bb|into)|call \d+|bet \d+|min-?raise|overbet|half pot|pot-?sized?|two-?thirds|one-?third|\d+ ?outs?|outs|needs? to be right|\bworth it\b|worth a shot|laying (him|her|them)|to see one more card|not enough in the middle|chase)\b/i;

/**
 * Numeric price talk, kept out of PRICE's alternation on purpose.
 *
 * PRICE is wrapped in `\b(...)\b`, and that trailing `\b` silently kills any alternative ending in
 * a non-word character or a digit: `%` cannot match in "41%" (both sides of the closing boundary
 * are non-word), and `need(ed|s)? \d` cannot match in "needed 41" (the boundary after the digit
 * fails, and no backtrack reaches a digit at a boundary). In the measured harness
 * (scripts/experiments/reasonGrader/keyword.mjs) that swallowed all four price→`none` errors:
 * p01, p03, p17, p25 — every price line whose whole argument is a percentage or a ratio.
 *
 * It is ranked BELOW range vocabulary, unlike PRICE itself, and that ordering is measured rather
 * than chosen: at PRICE's precedence it takes r04 ("he opens like 70% from the button so my defend
 * needs to be wide") off `range`, because a percentage in a reason is as often a range width as a
 * price. Below `range` it recovers all four price lines and moves no other line in the corpus.
 */
const PRICE_NUMERIC = /\d\s?%|\bneed(?:ed|s)? \d|\bgetting \d+ ?(?:to|:) ?\d|\d+ ?to ?1\b/i;

/**
 * Decides whether the price/range vocabulary is decoration over a hand-strength claim.
 * The signal: the sentence names the learner's own holding AND the range/price token appears
 * only in a clause subordinate to it ("...because my cards are weak", "...so the price doesn't
 * matter"). Approximated by the connective, which is what a pure function can actually see.
 */
const HS_SUBORDINATES_OTHER =
  /\b(because|since|so)\b[^.]*\b(i have|my (hand|cards|two cards)|pocket|a (big|strong) pair|is strong|is weak|are weak|the nuts|best hand)\b/i;
const OTHER_IS_IRRELEVANT =
  /\b(price|pot odds?|odds)\b[^.]*\b(irrelevant|does ?n'?t matter|no matter)\b|\b(my (hand|draw|range))\b[^.]*\b(so the price|price does ?n'?t)\b/i;

/**
 * WHY THERE IS NO LESSON-VOCABULARY MATCHER HERE, having built one and measured it.
 *
 * The lessons' mechanism axes and this label set already agree: of the 17 lessons, the ones whose
 * mechanism the closed set can express divide cleanly into price (pot-odds-as-a-price,
 * alpha-the-bluff-price, counting-outs-as-a-frequency, minimum-defence-frequency,
 * equity-realisation) and range (range-role-bettor-or-caller, who-holds-the-nuts,
 * range-advantage-versus-nut-advantage, combos-not-hands, domination-and-dead-hands,
 * polarity-picks-the-size) — which is exactly `range` / `price` from spec line 293. So the label set
 * needed no deriving: line 293 fixes it verbatim at four values, and G4 names two of them.
 *
 * Feeding `acceptanceKeywords` into the matchers as a phrase list was implemented and measured, and
 * it changed no label on any of the 100 corpus lines: every multi-word phrase from a mapped lesson
 * was already decided by the regexes above, so the step was unreachable. It is not shipped rather
 * than shipped as dead code.
 *
 * The keywords are also at the wrong granularity to assert against. types.ts defines them as the
 * fallback check on the learner's *mechanism sentence* when the learner self-marks — bare noun
 * phrases like "natural frequency" and "card removal". Grading a noun phrase as if it were a stated
 * reason has no meaning: 33 of the 60 multi-word phrases do not classify in isolation, which is the
 * expected behaviour of a sentence classifier on a fragment, not a defect in either file.
 *
 * The lessons the closed set cannot express are NOT force-fitted: spr-sets-the-plan (depth),
 * board-texture-dimensions (texture), best-five-from-seven, hand-rankings-in-order,
 * what-the-actions-mean, betting-order-and-position (phase-0 rules). G7's error tags include
 * TEXTURE and DEPTH-POSITION; line 293's reason labels do not, and inventing a fifth label would
 * change which decisions G4 escalates.
 */

/**
 * Grades one line of learner text. Deterministic: same string in, same label out, every time —
 * which the model grader is not (EXPERIMENT-3 measured 93% self-agreement across identical runs,
 * "the same learner sentence can grade differently on two occasions").
 *
 * Precedence, in order, because the order IS the tie-break policy:
 *   1. empty or evasive               → none        (nothing was stated)
 *   2. hunch with no mechanism words  → none
 *   3. own hand subordinating a mechanism word → hand-strength   (G4's inversion case)
 *   4. price vocabulary, no own hand  → price
 *   5. range vocabulary, no own hand  → range
 *   6. bare numeric price, no own hand → price
 *   7. own hand alone                 → hand-strength
 *   8. own hand + mechanism           → price if a number carries it, else range, else hand-strength
 *   9. otherwise                      → none
 */
export function gradeReason(text: string): ReasonGrade {
  const trimmed = (text ?? '').trim();
  const explicitGuess = EXPLICIT_GUESS.test(trimmed);
  const category = classify(trimmed);
  return { category, explicitGuess };
}

function classify(trimmed: string): ReasonCategory {
  if (EMPTY_OR_EVASIVE.test(trimmed)) return 'none';

  const numericPrice = PRICE_NUMERIC.test(trimmed);
  const price = PRICE.test(trimmed) || numericPrice;
  const range = RANGE.test(trimmed);
  if (HUNCH.test(trimmed) && !price && !range) return 'none';

  const own = OWN_HAND.test(trimmed);
  if (own && (HS_SUBORDINATES_OTHER.test(trimmed) || OTHER_IS_IRRELEVANT.test(trimmed))) {
    return 'hand-strength';
  }

  if (!own) {
    if (PRICE.test(trimmed)) return 'price';
    if (range) return 'range';
    if (numericPrice) return 'price';
  } else {
    if (!price && !range) return 'hand-strength';
    // Both present and not clearly subordinated: keep the mechanism if it carries a real number,
    // otherwise the holding is doing the work.
    if (price && /\d/.test(trimmed)) return 'price';
    if (range && /\b(range|dominat|capped|the hands? (that|he)|calls?)\b/i.test(trimmed)) {
      return 'range';
    }
    return 'hand-strength';
  }

  // No mechanism vocabulary at all. This is the class the experiment measures at 63.3% precision —
  // "a learner who reasons correctly in plain words that miss the word list gets swept into the one
  // class that triggers G4" — and it is why `applyG4Override` withholds the interrupt on this path.
  return 'none';
}

/**
 * Which grader produced the label.
 *
 * 'tutor' — the model grader. EXPERIMENT-3 measured G4 precision 98.6% (adversarial floor 90.9%)
 *   against a spec gate that tolerated 80%, and its recommendation 1 is "with a live tutor, G4 may
 *   interrupt".
 * 'local' — this module. Measured G4 precision 84.9% with a 63.3%-precision `none` class, i.e.
 *   15 of every 100 interrupts would land on a learner who reasoned properly. Spec line 436 already
 *   reduces G4 with no API key to firing only on `I'm guessing`; recommendation 2 confirms that
 *   reduction as necessary and extends it to line 218's other two fallback cases.
 */
export type ReasonGraderSource = 'tutor' | 'local';

/**
 * T3 in this build's severity vocabulary. coach.ts grades in bb with three bands, and
 * contrastManifest.ts states the mapping already used elsewhere: 'free' is silent (T0/T1),
 * 'notable' is T2, 'serious' is the interrupt band (T3+). G4 escalates to T3, so it escalates to
 * 'serious'.
 */
export const G4_SEVERITY: Severity = 'serious';

/** G4's precondition is ΔEV in T0/T1, which is exactly coach.ts's silent band. */
export const G4_ELIGIBLE_SEVERITY: Severity = 'free';

export interface ReasonAdjustedGrade {
  /** The severity to act on. G4's escalation has already been applied if it fired. */
  readonly severity: Severity;
  /** G4's condition held: ΔEV in T0/T1 and the reason is `hand-strength` or `none`. */
  readonly rightForWrongReason: boolean;
  /** G4 raised the severity. False when the condition held but escalation was suppressed. */
  readonly escalated: boolean;
}

export interface G4Input {
  /** Whatever the severity function returned for this decision — coach.ts's `Grade.severity`. */
  readonly severityFromEv: Severity;
  readonly reason: ReasonGrade;
  readonly graderSource: ReasonGraderSource;
}

/**
 * G4 — right-for-the-wrong-reason is T3 unconditionally (spec line 212), OVERRIDING the severity
 * function, whenever ΔEV is T0/T1 and the reason grader returns `hand-strength` or `none`.
 *
 * PRECEDENCE, which is the whole reason this function exists: G4 is applied AFTER the severity
 * function and its result replaces the severity function's. "Unconditionally" is not a tie-break
 * to be weighed against ΔEV — a decision that cost 0.00 bb and was reasoned from hand strength is
 * T3 because, quoting the clause, "this is the only case where silence installs a false rule,
 * because the action, the verdict, and the chips all confirm it". A severity function that quietly
 * won here would return silence, and silence is the failure mode.
 *
 * The override is UPWARD ONLY, and that is not a softening of "unconditionally": G4's own
 * precondition is ΔEV ∈ T0/T1, so a decision already at T2+ is outside the clause entirely and
 * keeps the severity it earned. G4 can never lower a severity, and `rightForWrongReason` is false
 * above the silent band because the condition itself is false there, not because it was overruled.
 *
 * On the 'local' path the condition is reported but the escalation is withheld unless the learner
 * explicitly admitted to guessing (line 436). `rightForWrongReason` still fires so the event is
 * logged — spec open question 3: "Until that measurement exists, G4 logs but does not interrupt."
 */
export function applyG4Override(input: G4Input): ReasonAdjustedGrade {
  const { severityFromEv, reason, graderSource } = input;

  const conditionHolds =
    severityFromEv === G4_ELIGIBLE_SEVERITY && G4_REASONS.includes(reason.category);

  if (!conditionHolds) {
    return { severity: severityFromEv, rightForWrongReason: false, escalated: false };
  }

  const mayInterrupt = graderSource === 'tutor' || reason.explicitGuess;
  if (!mayInterrupt) {
    return { severity: severityFromEv, rightForWrongReason: true, escalated: false };
  }

  return { severity: G4_SEVERITY, rightForWrongReason: true, escalated: true };
}
