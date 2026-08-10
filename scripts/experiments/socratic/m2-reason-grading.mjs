/**
 * MEASUREMENT 2 — REASON GRADING IN CONTEXT (G4).
 *
 * The reason grader hat returns exactly one of range / price / hand-strength / none.
 * G4 escalates to T3 unconditionally when ΔEV is T0/T1 AND the label is hand-strength or none —
 * i.e. a CORRECT action justified by hand strength. The spec says that case "otherwise installs
 * a false rule permanently", and open question 3 gates G4's escalation on measured agreement.
 * This measures that agreement.
 *
 * The label set is authored here with the intended label per line, including hard middle cases:
 * lines that name a card AND a price, lines that use range vocabulary to say a hand-strength
 * thing, and lines that are pure hand strength dressed in jargon.
 *
 * Usage: node scripts/experiments/socratic/m2-reason-grading.mjs [--variant v1|v2]
 */
import { invoke, mapLimit, MODEL_ID } from './bedrock.mjs';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const variant = args.includes('--variant') ? args[args.indexOf('--variant') + 1] : 'v1';

/**
 * Each case: the node context, the learner's typed reason, the intended label, and whether this
 * is the G4 trip case (action correct + hand-strength/none => T3).
 * `actionCorrect` is the engine's verdict, not the model's — the tutor never decides correctness.
 */
const CASES = [
  // --- clear price ---
  { id: 'p1', node: 'facing 14 into 20 on flop, holding 7h2c', reason: 'I needed 41% to call and only had 16%, so the price was wrong', label: 'price', actionCorrect: true },
  { id: 'p2', node: 'facing 8 into 36 on flop with a flush draw', reason: 'cheap price, only had to put in 8 to win 36 so calling is fine', label: 'price', actionCorrect: true },
  { id: 'p3', node: 'facing 45 into 50 on river', reason: 'getting about 2 to 1 and I do not win often enough for that', label: 'price', actionCorrect: true },
  { id: 'p4', node: 'facing 24 into 30 on flop', reason: 'the pot odds do not justify continuing here', label: 'price', actionCorrect: true },
  // --- clear range ---
  { id: 'r1', node: 'BTN opens, we are BB with K7s', reason: 'the range that calls my raise beats K7s most of the time', label: 'range', actionCorrect: true },
  { id: 'r2', node: 'flop Ah Kd Qs, we hold 6c3d', reason: 'my raising range on this board should be broadway hands, not this', label: 'range', actionCorrect: true },
  { id: 'r3', node: 'river, villain bets small into a capped board', reason: 'his betting range is uncapped here and mine is capped so I cannot raise', label: 'range', actionCorrect: true },
  { id: 'r4', node: 'turn, we hold top pair', reason: 'checking keeps my range wide enough to defend the river', label: 'range', actionCorrect: true },
  // --- clear hand strength ---
  { id: 'h1', node: 'flop Kd 9s 4h, we hold 7h2c', reason: 'my hand is garbage, 7 high, nothing there', label: 'hand-strength', actionCorrect: true },
  { id: 'h2', node: 'turn, we hold AA on Ad 9s 4h 2c', reason: 'I have trip aces which is a monster so I bet', label: 'hand-strength', actionCorrect: true },
  { id: 'h3', node: 'flop, we hold TT on 9c 4h 2s', reason: 'pocket tens is a strong pair and the board is low so I am ahead', label: 'hand-strength', actionCorrect: true },
  { id: 'h4', node: 'river, we hold KK on Kh 7c 3s 8d 2h', reason: 'top set, easy call, my cards are just too good to fold', label: 'hand-strength', actionCorrect: true },
  // --- none ---
  { id: 'n1', node: 'flop, facing a bet', reason: 'felt right', label: 'none', actionCorrect: true },
  { id: 'n2', node: 'turn, facing a bet', reason: 'I am guessing', label: 'none', actionCorrect: true },
  { id: 'n3', node: 'river, facing a bet', reason: 'he always bluffs in this spot, I just have a feeling about him', label: 'none', actionCorrect: true },
  { id: 'n4', node: 'flop, facing a bet', reason: 'idk', label: 'none', actionCorrect: true },
  // --- HARD MIDDLE: hand strength dressed in price/range vocabulary ---
  { id: 'm1', node: 'facing 6 into 40 with AhKh on Qh7h2c', reason: 'I have the nut flush draw with two overcards, that is a huge hand', label: 'hand-strength', actionCorrect: true },
  { id: 'm2', node: 'facing 5 into 30 with TT on 9c4h2s', reason: 'my equity is high because pocket tens is a big pair', label: 'hand-strength', actionCorrect: true },
  { id: 'm3', node: 'facing 20 into 24 with 9c4s on Ks Qd Jh', reason: 'my range here is weak because these two cards are weak', label: 'hand-strength', actionCorrect: true },
  { id: 'm4', node: 'river, holding KK', reason: 'the price is fine because my hand is strong enough to call anything', label: 'hand-strength', actionCorrect: true },
  // --- HARD MIDDLE: genuinely both, but the operative clause is price/range ---
  { id: 'm5', node: 'facing 8 into 36 with JhTh on 9h8c2d', reason: 'eight open enders and flush outs against 36 in the pot means the price is good', label: 'price', actionCorrect: true },
  { id: 'm6', node: 'facing 34 into 40 with 5h4d on As Kc 9h 2d', reason: 'gutshot only, and the 46% I would need is way more than a gutshot gives', label: 'price', actionCorrect: true },
  { id: 'm7', node: 'BB vs BTN open holding K7s', reason: 'K7s is dominated by the offsuit broadways that continue against me', label: 'range', actionCorrect: true },
  { id: 'm8', node: 'flop bet with AA', reason: 'betting because the hands that call are worse than aces and will pay', label: 'range', actionCorrect: true },
  // --- G4 TRIP CASES: action was CORRECT, reason is hand-strength/none => must escalate T3 ---
  { id: 'g1', node: 'CORRECT fold, facing 24 into 30 with 8d3c on Ah Kd Qs. ΔEV 0.0 bb, tier free', reason: 'folded because 8-3 is a bad hand', label: 'hand-strength', actionCorrect: true, g4Trip: true },
  { id: 'g2', node: 'CORRECT call, facing 6 into 40 with AhKh on Qh7h2c. ΔEV 0.0 bb, tier free', reason: 'called because ace king is strong', label: 'hand-strength', actionCorrect: true, g4Trip: true },
  { id: 'g3', node: 'CORRECT bet, holding AA on Ad9s4h. ΔEV 0.0 bb, tier free', reason: 'bet because I have the best possible hand right now', label: 'hand-strength', actionCorrect: true, g4Trip: true },
  { id: 'g4', node: 'CORRECT fold preflop with 72o UTG. ΔEV 0.0 bb, tier free', reason: 'seven deuce is the worst hand in poker', label: 'hand-strength', actionCorrect: true, g4Trip: true },
  { id: 'g5', node: 'CORRECT check, holding 5h4d on As Kc 9h. ΔEV 0.0 bb, tier free', reason: 'nothing here, just checked', label: 'hand-strength', actionCorrect: true, g4Trip: true },
  { id: 'g6', node: 'CORRECT raise, holding KK preflop. ΔEV 0.0 bb, tier free', reason: 'kings, obviously', label: 'hand-strength', actionCorrect: true, g4Trip: true },
  { id: 'g7', node: 'CORRECT call, facing 5 into 30 with TT. ΔEV 0.0 bb, tier free', reason: 'not sure honestly, just clicked call', label: 'none', actionCorrect: true, g4Trip: true },
  { id: 'g8', node: 'CORRECT fold, facing 45 into 50 with Jc6s. ΔEV 0.0 bb, tier free', reason: 'I guessed', label: 'none', actionCorrect: true, g4Trip: true },
];

const V1 = `You are the reason-grader of a poker tutor. Classify the learner's typed reason.

Output exactly one of these four tokens and nothing else:
range
price
hand-strength
none`;

const V2 = `You are the reason-grader of a poker tutor. Classify the learner's typed reason into exactly
one label. Output only the token, nothing else.

range         - the reason is about which HANDS the opponent (or the learner) holds as a group:
                what continues, what is dominated, what is capped or uncapped, what the calling
                or betting range looks like.
price         - the reason is about the COST of the decision versus how often it must work:
                pot odds, the share needed, breaking even, the size of the bet against the pot.
hand-strength - the reason is about how good the learner's own two cards are, in isolation.
                THIS INCLUDES reasons that borrow range or price vocabulary but whose operative
                content is still "my cards are strong / my cards are weak". "My equity is high
                because I have a big pair" is hand-strength: the word equity is decoration, the
                reasoning is the pair. "My range is weak because these two cards are weak" is
                hand-strength: a single holding is not a range.
none          - no mechanism at all: a guess, a feeling, a hunch, an unsupported claim about the
                opponent, or an admission of not knowing.

DECIDING THE HARD CASES
Ask which clause is doing the work. If removing the price/range words leaves the same argument
intact, the label is hand-strength. If the price/range clause is what makes the decision, use
price or range even when a specific holding is also mentioned — "a gutshot gives less than the
46% needed" is price, because the comparison is what decides it.
Prefer price over range when both appear and a number or pot size is the operative comparison.

Output exactly one of: range price hand-strength none`;

const system = variant === 'v2' ? V2 : V1;

const results = await mapLimit(CASES, 5, async (c) => {
  const out = await invoke(
    [{ role: 'user', content: `NODE: ${c.node}\nLEARNER'S REASON: "${c.reason}"\n\nLabel?` }],
    { system, maxTokens: 12 },
  );
  const raw = out.trim().toLowerCase();
  const got = ['hand-strength', 'range', 'price', 'none'].find((l) => raw.includes(l)) ?? `unparsed(${raw})`;
  return { ...c, got, correct: got === c.label };
});

const overall = results.filter((r) => r.correct).length;
const trip = results.filter((r) => r.g4Trip);
// G4 detection: the escalation fires iff the label is hand-strength or none. A trip case
// mislabelled as range/price means the false rule installs silently.
const tripDetected = trip.filter((r) => r.got === 'hand-strength' || r.got === 'none');
const middle = results.filter((r) => r.id.startsWith('m'));
const clear = results.filter((r) => /^[prhn]\d/.test(r.id));

const byLabel = {};
for (const r of results) {
  byLabel[r.label] ??= { n: 0, correct: 0 };
  byLabel[r.label].n++;
  if (r.correct) byLabel[r.label].correct++;
}
// Confusions that matter most: a hand-strength reason graded as range/price (G4 false negative)
const falseNegatives = results.filter((r) => (r.label === 'hand-strength' || r.label === 'none') && r.got !== 'hand-strength' && r.got !== 'none');
const falsePositives = results.filter((r) => (r.label === 'range' || r.label === 'price') && (r.got === 'hand-strength' || r.got === 'none'));

const summary = {
  measurement: 'M2 reason grading',
  model: MODEL_ID,
  variant,
  overallAccuracy: `${overall}/${results.length}`,
  clearCasesAccuracy: `${clear.filter((r) => r.correct).length}/${clear.length}`,
  hardMiddleAccuracy: `${middle.filter((r) => r.correct).length}/${middle.length}`,
  g4TripDetectionRate: `${tripDetected.length}/${trip.length}`,
  g4FalseNegatives: falseNegatives.map((r) => `${r.id}: intended ${r.label}, got ${r.got}`),
  g4FalsePositives_wouldPunishGoodReasoning: falsePositives.map((r) => `${r.id}: intended ${r.label}, got ${r.got}`),
  byLabel,
};

writeFileSync(new URL(`./results-m2-${variant}.json`, import.meta.url), JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
for (const r of results.filter((x) => !x.correct)) {
  console.log(`MISS ${r.id} intended=${r.label} got=${r.got} :: "${r.reason}"`);
}
