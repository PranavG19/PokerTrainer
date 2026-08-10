/**
 * MEASUREMENT 4 — THE LEXICON (L1/L2).
 *
 * L2: accept sentences framed in domination risk, equity realisation, or range asymmetry.
 * Reject cached cells ("K7s is a CO open"). The accepted sentence becomes the concept's name
 * (L1), so a false accept installs a chart cell as a concept name permanently, and a false
 * reject discards the learner's own generative work — the thing G5 calls non-negotiable.
 *
 * The set below is authored here with intended verdicts, and deliberately includes hard middle
 * cases: a cached cell WITH a mechanism attached (accept), a mechanism sentence that names a
 * specific hand (accept — naming a hand is not the same as citing a cell), a sentence that
 * sounds mechanistic but is circular (reject), and correct-but-off-list mechanisms (reject per
 * the letter of L2, which is itself a finding).
 *
 * Usage: node scripts/experiments/socratic/m4-lexicon.mjs [--variant v1|v2]
 */
import { invoke, mapLimit, MODEL_ID } from './bedrock.mjs';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const variant = args.includes('--variant') ? args[args.indexOf('--variant') + 1] : 'v1';

const CASES = [
  // --- clear accepts: domination risk ---
  { id: 'ad1', s: 'K7s loses value against the offsuit broadways that keep calling, because my kicker is behind theirs', accept: true, kind: 'domination' },
  { id: 'ad2', s: 'the danger with KJ is that the hands continuing against me have the same king with a better second card', accept: true, kind: 'domination' },
  { id: 'ad3', s: 'A5o plays badly early because every ace that calls me has a bigger kicker', accept: true, kind: 'domination' },
  // --- clear accepts: equity realisation ---
  { id: 'ae1', s: 'suited connectors keep their equity out of position less often, because I get barrelled off before the river', accept: true, kind: 'equity-realisation' },
  { id: 'ae2', s: 'my hand has enough raw equity but cannot realise it in a three-bet pot with no position', accept: true, kind: 'equity-realisation' },
  { id: 'ae3', s: 'closing the action lets a weak hand see the flop and actually cash in its share', accept: true, kind: 'equity-realisation' },
  // --- clear accepts: range asymmetry ---
  { id: 'ar1', s: 'the BB cannot have the strong overpairs here, so the aggressor keeps betting on this board', accept: true, kind: 'range-asymmetry' },
  { id: 'ar2', s: 'an ace-high flop hits the opener much harder than the caller, so the caller has to fold more', accept: true, kind: 'range-asymmetry' },
  { id: 'ar3', s: 'my range is capped after checking twice, and the other range is not, which is what flips this', accept: true, kind: 'range-asymmetry' },
  // --- clear rejects: cached cells ---
  { id: 'rc1', s: 'K7s is a CO open', accept: false, kind: 'cached-cell' },
  { id: 'rc2', s: 'A5o is a fold from UTG', accept: false, kind: 'cached-cell' },
  { id: 'rc3', s: '77 is a call versus a three-bet at 100bb', accept: false, kind: 'cached-cell' },
  { id: 'rc4', s: 'the chart says raise', accept: false, kind: 'cached-cell' },
  { id: 'rc5', s: 'this is a standard c-bet spot', accept: false, kind: 'cached-cell' },
  // --- clear rejects: no mechanism ---
  { id: 'rn1', s: 'it just plays better', accept: false, kind: 'no-mechanism' },
  { id: 'rn2', s: 'position matters here', accept: false, kind: 'no-mechanism' },
  { id: 'rn3', s: 'the flipping variable is position', accept: false, kind: 'no-mechanism' },
  // --- HARD MIDDLE: circular / restates the verdict as if it were a mechanism ---
  { id: 'hm1', s: 'KJo folds because it is not strong enough to open from UTG', accept: false, kind: 'circular' },
  { id: 'hm2', s: 'the variable is the suit, because suited hands are better', accept: false, kind: 'circular' },
  { id: 'hm3', s: 'I open one and fold the other because one is above the threshold', accept: false, kind: 'circular' },
  // --- HARD MIDDLE: a cell citation WITH a real mechanism attached -> accept ---
  { id: 'hm4', s: 'K7s is a CO open but not a UTG open, because from UTG the kings that call me all have better kickers', accept: true, kind: 'cell-plus-mechanism' },
  { id: 'hm5', s: 'the chart opens KQo and folds KJo, and the reason is that KJo is dominated by the KQ that continues', accept: true, kind: 'cell-plus-mechanism' },
  // --- HARD MIDDLE: mechanism that names a specific hand (naming is not citing) -> accept ---
  { id: 'hm6', s: 'one seat of position is what flips KJo, because from CO only two players can hold a dominating king', accept: true, kind: 'mechanism-with-hand' },
  // --- HARD MIDDLE: correct poker mechanism that is OFF the L2 list ---
  // L2 names exactly three admissible frames. These are true and mechanistic but not on it.
  // Scored against the letter of L2 (reject); the report treats disagreement here as a spec
  // question rather than a model error.
  { id: 'hm7', s: 'holding the ace of hearts removes the nut flush from the calling range, so the bluff works more often', accept: false, kind: 'off-list-blockers' },
  { id: 'hm8', s: 'shorter stacks mean the implied odds never arrive, so the speculative hand stops being worth a call', accept: false, kind: 'off-list-stackdepth' },
];

const V1 = `You judge whether a learner's sentence is acceptable as the NAME of a poker concept
in a training app.

Accept sentences framed in domination risk, equity realisation, or range asymmetry.
Reject cached cells such as "K7s is a CO open".

Reply with exactly one word: ACCEPT or REJECT`;

const V2 = `You judge whether a learner's sentence may become the NAME of a poker concept in a
training app. The sentence must state a MECHANISM the learner generated, not a lookup result.

ACCEPT only if the sentence gives a causal mechanism drawn from one of these three frames:
  domination risk      - a holding is behind the specific hands that continue against it
                         (kicker problems, being outkicked by the calling range).
  equity realisation   - a hand's raw share does or does not get converted into money, because
                         of position, being barrelled off, closing the action, or pot geometry.
  range asymmetry      - one range hits or misses this board or node more than the other, or one
                         range is capped and the other is not.

REJECT if the sentence is:
  a cached cell        - a lookup verdict with no mechanism: "K7s is a CO open", "the chart says
                         raise", "this is a standard c-bet spot".
  no mechanism         - names a variable without saying what it causes: "position matters here",
                         "the flipping variable is position".
  circular             - restates the verdict as its own cause: "KJo folds because it is not
                         strong enough", "suited is better because suited hands are better".
                         A cause that is a synonym of the conclusion is circular.
  off-frame            - a mechanism that is true but is NOT one of the three frames above
                         (for example blockers/card-removal, or stack-depth and implied odds).
                         Reject these even though they are correct poker reasoning.

TWO RULES THAT DECIDE THE HARD CASES
1. Citing a chart cell does NOT by itself cause rejection. If the sentence cites a cell AND
   attaches one of the three mechanisms, ACCEPT — the mechanism is what is being named.
2. Naming a specific hand does NOT make a sentence a cached cell. "KJo is dominated by the KQ
   that continues" is a mechanism about a named hand, and is acceptable.

Reply with exactly one word: ACCEPT or REJECT`;

const system = variant === 'v2' ? V2 : V1;

const results = await mapLimit(CASES, 5, async (c) => {
  const out = await invoke(
    [{ role: 'user', content: `LEARNER'S SENTENCE: "${c.s}"\n\nACCEPT or REJECT?` }],
    { system, maxTokens: 8 },
  );
  const said = /ACCEPT/i.test(out) ? true : /REJECT/i.test(out) ? false : null;
  return { ...c, said, correct: said === c.accept };
});

const hard = results.filter((r) => r.id.startsWith('hm'));
const clear = results.filter((r) => !r.id.startsWith('hm'));
const falseAccepts = results.filter((r) => !r.accept && r.said === true);
const falseRejects = results.filter((r) => r.accept && r.said === false);
const byKind = {};
for (const r of results) {
  byKind[r.kind] ??= { n: 0, correct: 0 };
  byKind[r.kind].n++;
  if (r.correct) byKind[r.kind].correct++;
}

const summary = {
  measurement: 'M4 lexicon L1/L2',
  model: MODEL_ID,
  variant,
  cases: results.length,
  overallAccuracy: `${results.filter((r) => r.correct).length}/${results.length}`,
  clearCasesAccuracy: `${clear.filter((r) => r.correct).length}/${clear.length}`,
  hardMiddleAccuracy: `${hard.filter((r) => r.correct).length}/${hard.length}`,
  falseAccepts_installBadConceptName: falseAccepts.map((r) => `${r.id} [${r.kind}]: "${r.s}"`),
  falseRejects_discardLearnerWork: falseRejects.map((r) => `${r.id} [${r.kind}]: "${r.s}"`),
  byKind,
};

writeFileSync(new URL(`./results-m4-${variant}.json`, import.meta.url), JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
