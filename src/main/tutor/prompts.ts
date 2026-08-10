/**
 * Tutor prompts, as data.
 *
 * Every string here won a measured comparison against real Bedrock output. The method, the sample
 * sizes and every quoted failure live in research/EXPERIMENT-4-tutor-prompts.md; the harness that
 * produced the numbers is scripts/experiments/tutorPrompts/. Model measured against:
 * `us.anthropic.claude-sonnet-4-5-20250929-v1:0` on Bedrock, us-west-2, temperature 0.
 *
 * Sample: 149 genuinely graded decisions from the real engine (src/core/table.ts + ai.ts +
 * coach.ts, seeded, headless), stratified across preflop/flop/turn/river and tiers T1-T4, plus 32
 * T0 decisions for the silence measurement. Five prompt designs x 149 spots x two hats = 1,490
 * graded calls, plus 320 silence calls and 72 independent confirmation calls.
 *
 * The scoreboard each prompt was chosen on is NOT the guard pass rate. It is the joint rate:
 * passes the T4 guard AND makes no false claim (Explainer) / leaks no answer (Interrogator). The
 * two come apart sharply, and that is the experiment's central finding — see EXPLAINER_CORRECTION's
 * note below.
 */

/** Shared preamble. Encodes T2: the tutor is downstream of the grader and generates no number. */
const DOWNSTREAM_OF_GRADER =
  `You turn a poker grader's numbers into prose. The grader has already decided what was wrong and ` +
  `by how much. You never grade, never decide correctness, and never produce a number that is not ` +
  `in the payload.`;

/**
 * EXPLAINER — the three-chunk correction (T3 row 1, G6).
 *
 * MEASURED: guard pass 115/149 = 77.2%; of those, 37 carried a false numeric relationship, so the
 * joint usable rate is 78/149 = 52.3%. Best of five designs on the joint metric. Mean 45.3 words.
 *
 * Why this one and not the higher-scoring variant: a v2 of this prompt that added explicit
 * number-meaning rules reached 89.9% guard pass — the best guard score measured — and its joint
 * usable rate FELL to 45.6%, because instructing the model to check the ranks between the hand and
 * the boundary hand made it state rank distances it then got wrong (56/134 outputs). Optimising
 * the guard metric made the teaching worse. Both other designs scored lower on both axes: an
 * example-driven prompt reached 31.5% guard pass (it copied the 52-word worked example's length and
 * ran over 60 words on 68 of 149), and a role-plus-enumerated-ban-list prompt reached 50.3%.
 *
 * Residual risk this prompt does NOT close, quantified: 32.2% of the outputs it produces that pass
 * the guard contain a relationship that is false while using only permitted numerals. That is the
 * hole PRODUCT-SPEC T4 names and declines to close, now measured. Do not ship the Explainer without
 * a truth check that the guard does not currently perform.
 */
export const EXPLAINER_CORRECTION = `${DOWNSTREAM_OF_GRADER}

Write the correction. Rules:
- Exactly three chunks: (1) principle name, at most 5 words; (2) the range or board consequence, one sentence; (3) the boundary hand and the one variable that flips it.
- End with a next action, not a verdict.
- 60 words maximum.
- The hand, the range, or the decision is the grammatical subject. Never the player. Do not begin with "You".
- Every digit you write must already appear in the payload.
- No praise. No traits. No streaks, ranks or percentiles. Never say what the folded hand would have become.

Output the correction only.`;

/**
 * INTERROGATOR — one question, <=20 words, that probes without revealing (T3 row 2).
 *
 * MEASURED: guard pass 141/149 = 94.6%; leak rate 1/141 = 0.7%; joint usable 140/149 = 94.0%.
 * Mean 14.8 words. This is the best result in the whole experiment and the only hat where a real
 * model held the constraint cleanly.
 *
 * The three banned items numbered 6-8 below are not stylistic. Each was measured: the same prompt
 * WITHOUT them scored 92.6% guard pass and leaked on 36/138 questions — 14 named the cheaper
 * action contrastively ("all-in over check"), 15 asserted the verdict inside a subordinate clause
 * ("when you're ahead of their range"), 8 handed back the learner's own pot share. Adding the three
 * rules cut the leak rate from 26.1% to 0.7% and cost nothing on the guard. A terse design scored
 * 10.7% guard pass here and is not competitive.
 *
 * The guard cannot see a leak: a leaking question is 13 words, has no banned construction, starts
 * with "What" and carries only permitted numerals. The prompt is the only control.
 */
export const INTERROGATOR_QUESTION = `You are the Interrogator in a poker tutor. ${DOWNSTREAM_OF_GRADER} The learner has already committed and the grader has already scored the decision. Your job is to make them retrieve, not to inform them.

FORM. Exactly one question. 20 words maximum. No preamble.

BANNED:
  1. Any statement or implication of the verdict — right, wrong, costly, fine, close.
  2. Naming or hinting at the better action ("wouldn't folding...", "have you considered raising").
  3. Any digit at all. Numbers are the grader's, and a number in a question is a verdict.
  4. Traits about the player, streaks, ranks, percentiles.
  5. Revealing what a folded hand would have become.

  6. Naming the cheapest action alongside the action taken. "Instead of checking", "all-in over check", "betting rather than checking behind" — a contrast between two actions tells the learner which one the grader preferred. Name at most one action, and prefer naming none.
  7. Asserting the answer in the question's premise. A subordinate clause is still a claim: "when you're ahead of their range", "with a hand that wins this often", "when you held top pair", "when you're bluffing", "with no card left to come". Every one of those hands over the verdict inside a grammatically innocent question.
  8. Stating the learner's own pot share or equity back to them. It is the verdict in numeric form, and it is unreachable at this moment by design.

A question that survives all eight asks about a quantity the learner must go and estimate: what a range contains, what a card changed, what a hand beats. Ask for that estimate. Do not supply any part of it.

Output the question only.`;

/**
 * SILENCE (G3). Appended to a hat's prompt so a T0 decision produces nothing.
 *
 * MEASURED over 320 T0 calls (32 decisions x 5 designs x 2 representations):
 *   - sentinel ("output NONE"): 160/160 = 100% compliant, every design.
 *   - empty ("output nothing at all"): 136/160 = 85%. The 24 failures are all the same shape —
 *     the model narrates the instruction instead of obeying it: "I notice this is a T0 severity
 *     tier. According to my instructions, I should output nothing at all."
 *
 * So the sentinel is the shipping form, and the caller maps the sentinel to no rail output. Asking
 * a chat model for an empty completion asks it to produce zero tokens, which it reliably will not do.
 *
 * The one thing the model never did: praise. 0 of 320 T0 responses contained any commendation or
 * confirmation token. The spec predicted this rule would be the most-violated; it was the least.
 */
export const SILENCE_SENTINEL = 'NONE';

export const SILENCE_RULE = `
SILENCE. A tier of T0 means the decision cost almost nothing. On T0 your entire output is the single token ${SILENCE_SENTINEL}, with nothing before or after it — no explanation, no praise, no acknowledgement. Silence is not praise: a T0 is never congratulated or confirmed.`;

/** True when a completion is the tutor declining to speak. */
export function isSilent(completion: string): boolean {
  return completion.trim() === SILENCE_SENTINEL || completion.trim().length === 0;
}
