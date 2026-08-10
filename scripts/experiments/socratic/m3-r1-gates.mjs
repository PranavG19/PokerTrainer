/**
 * MEASUREMENT 3 — ADAPTING TO THE OPPONENT, UNDER THE R1 GATES.
 *
 * R1: go/no-go is `n >= 20 of that observable AND raw frequency >= 15 points off baseline`.
 * Magnitude is `w = n/(n+10)`, applied as `w x full exploit`. The spec's whole point:
 * "shrinkage is sign-preserving, so it is a magnitude control and NEVER a go/no-go control."
 *
 * The failure this measures: a model that licenses a deviation at n=3 because w is small, i.e.
 * treats shrinkage as if it were the gate. That teaches the exact error the module exists to
 * prevent. The rate of licensing an UNGATED deviation is the number reported.
 *
 * Baselines come from the real bot archetypes in src/core/ai.ts (read, not invented) — the
 * frequencies below are stated as observed counts over observations, which is what R6's
 * simulated observation streams provide.
 *
 * Usage: node scripts/experiments/socratic/m3-r1-gates.mjs [--variant v1|v2]
 */
import { invoke, mapLimit, MODEL_ID } from './bedrock.mjs';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const variant = args.includes('--variant') ? args[args.indexOf('--variant') + 1] : 'v1';

/**
 * Cases. `shouldLicense` is computed from R1 mechanically, not judged:
 *   n >= 20 AND |observed - baseline| >= 15 points.
 * `preRegistered` covers R2: only a pre-registered tendency can license a deviation at all.
 */
const RAW = [
  // n too small, huge apparent edge — the shrinkage-as-gate trap
  { id: 'a1', observable: 'folds to flop c-bet', baseline: 45, observed: 100, n: 3, preRegistered: true },
  { id: 'a2', observable: 'calls river bet', baseline: 40, observed: 100, n: 4, preRegistered: true },
  { id: 'a3', observable: 'folds to turn probe', baseline: 50, observed: 0, n: 5, preRegistered: true },
  { id: 'a4', observable: 'raises flop', baseline: 15, observed: 60, n: 5, preRegistered: true },
  { id: 'a5', observable: 'folds to c-bet', baseline: 45, observed: 90, n: 10, preRegistered: true },
  { id: 'a6', observable: 'calls down light', baseline: 40, observed: 85, n: 19, preRegistered: true },
  // n large enough but edge too small
  { id: 'b1', observable: 'folds to c-bet', baseline: 45, observed: 52, n: 40, preRegistered: true },
  { id: 'b2', observable: 'calls river bet', baseline: 40, observed: 51, n: 60, preRegistered: true },
  { id: 'b3', observable: 'raises flop', baseline: 15, observed: 27, n: 35, preRegistered: true },
  { id: 'b4', observable: 'folds to turn bet', baseline: 50, observed: 36, n: 100, preRegistered: true },
  // both gates pass — deviation IS licensed
  { id: 'c1', observable: 'calls river bet', baseline: 40, observed: 85, n: 24, preRegistered: true },
  { id: 'c2', observable: 'folds to c-bet', baseline: 45, observed: 70, n: 30, preRegistered: true },
  { id: 'c3', observable: 'raises flop', baseline: 15, observed: 45, n: 22, preRegistered: true },
  { id: 'c4', observable: 'folds to turn probe', baseline: 50, observed: 20, n: 55, preRegistered: true },
  { id: 'c5', observable: 'calls down light', baseline: 40, observed: 80, n: 100, preRegistered: true },
  // exact boundaries
  { id: 'd1', observable: 'folds to c-bet', baseline: 45, observed: 60, n: 20, preRegistered: true },
  { id: 'd2', observable: 'folds to c-bet', baseline: 45, observed: 60, n: 19, preRegistered: true },
  { id: 'd3', observable: 'folds to c-bet', baseline: 45, observed: 59, n: 20, preRegistered: true },
  // gates pass but NOT pre-registered (R2) — still not licensed this session
  { id: 'e1', observable: 'checks back turn', baseline: 55, observed: 90, n: 40, preRegistered: false },
  { id: 'e2', observable: 'overbets river', baseline: 5, observed: 35, n: 25, preRegistered: false },
];

const CASES = RAW.map((c) => {
  const gap = Math.abs(c.observed - c.baseline);
  const gatesPass = c.n >= 20 && gap >= 15;
  return { ...c, gap, gatesPass, shouldLicense: gatesPass && c.preRegistered, w: c.n / (c.n + 10) };
});

const V1 = `You are the tutor for a poker training app teaching opponent-read discipline.

The app's rule R1 has two independent gates:
- Go/no-go: n >= 20 observations of that observable AND raw frequency at least 15 points off baseline.
- Magnitude: w = n/(n+10); deviate by w x the full exploit.
R2: only a tendency pre-registered at session start can license a deviation.

Given an observation, say whether a deviation is licensed and explain briefly.

Begin your reply with exactly one line: VERDICT: LICENSED or VERDICT: NOT LICENSED`;

const V2 = `You are the tutor for a poker training app teaching opponent-read discipline.

R1 — TWO INDEPENDENT GATES. They are not interchangeable and not tradeable.
1. GO/NO-GO gate. BOTH conditions must hold:
     n >= 20 observations of that specific observable, AND
     |observed - baseline| >= 15 percentage points.
   If either fails, NO deviation is licensed. Full stop. There is no partial deviation, no
   "small deviation", no "proceed cautiously" — the answer is baseline play.
2. MAGNITUDE control, applied ONLY after gate 1 has passed: w = n/(n+10), deviate by
   w x the full exploit.

THE TRAP YOU MUST NOT FALL INTO
Shrinkage is sign-preserving. w is always > 0, so w NEVER turns a deviation off. It is therefore
a MAGNITUDE control and NEVER a go/no-go control. Reasoning of the form "n is only 3, so w is
small, so make a small deviation" is exactly the error this module exists to prevent. At n = 3 the
correct output is NOT a scaled-down exploit; it is NO deviation at all, because gate 1 failed.
A large apparent edge at small n is what a baseline opponent looks like when scanned across many
stats — it is noise, not a read.

R2 — Only a tendency PRE-REGISTERED at session start can license a deviation. Gates passing on a
tendency that was not pre-registered still licenses nothing this session; it goes to the notebook
as next session's hypothesis.

Begin your reply with exactly one line: VERDICT: LICENSED or VERDICT: NOT LICENSED
Then at most three sentences.`;


/**
 * V3: identical rules to V2, but the ARITHMETIC IS FORCED FIRST and the verdict comes LAST.
 * V1/V2 both failed only on near-boundary gaps (11-14 points), and the transcripts show why:
 * the required "VERDICT:" first line makes the model commit before it has computed |observed -
 * baseline|, after which it self-corrects in prose while the machine-readable verdict stays wrong.
 * This variant changes ONLY the output order, to test that the defect is ordering, not rules.
 */
const V3 = V2.replace(
  `Begin your reply with exactly one line: VERDICT: LICENSED or VERDICT: NOT LICENSED
Then at most three sentences.`,
  `OUTPUT FORMAT — follow in this exact order, and do not state a verdict before line 3.
Line 1: GAP: <|observed - baseline|> — write the subtraction out and then the result.
Line 2: GATE1: PASS or FAIL — PASS only if n >= 20 AND the line-1 gap >= 15.
Line 3: PREREG: yes or no.
Line 4: VERDICT: LICENSED or VERDICT: NOT LICENSED (LICENSED requires GATE1 PASS and PREREG yes).
Then at most two sentences.`,
);

const system = variant === 'v3' ? V3 : variant === 'v2' ? V2 : V1;

/** Did the reply smuggle in a scaled-down deviation despite a failed gate? */
function smuggledDeviation(text) {
  return /\b(?:small(?:er)?|slight(?:ly)?|modest|minor|tiny|scaled[- ]down|reduced|partial|cautious(?:ly)?|lightly|marginal)\b[^.]{0,60}\b(?:deviat|exploit|adjust|widen|tighten|bluff more|fold more|call more)/i.test(text)
    || /\b(?:deviat|exploit|adjust)\w*\b[^.]{0,40}\b(?:but keep it small|only slightly|a little|modestly|cautiously)\b/i.test(text);
}

const results = await mapLimit(CASES, 5, async (c) => {
  const prompt = [
    `OBSERVATION SET (from a simulated observation stream)`,
    `observable: ${c.observable}`,
    `baseline frequency for this population: ${c.baseline}%`,
    `this villain's observed frequency: ${c.observed}%`,
    `n (observations of this observable): ${c.n}`,
    `pre-registered at session start: ${c.preRegistered ? 'yes' : 'no'}`,
    ``,
    `Is a deviation licensed?`,
  ].join('\n');
  const out = await invoke([{ role: 'user', content: prompt }], { system, maxTokens: 300 });
  const upper = out.toUpperCase();
  const vline = upper.split('\n').find((l) => l.includes('VERDICT:')) ?? upper.split('\n')[0];
  const said = vline.includes('NOT LICENSED') ? false : vline.includes('LICENSED') ? true : null;
  return {
    ...c,
    reply: out,
    saidLicensed: said,
    correct: said === c.shouldLicense,
    smuggled: !c.shouldLicense && smuggledDeviation(out),
  };
});

const ungated = results.filter((r) => !r.shouldLicense);
const licensedUngated = ungated.filter((r) => r.saidLicensed === true);
const smuggling = ungated.filter((r) => r.smuggled);
const smallN = results.filter((r) => r.n < 20);
const smallNLicensed = smallN.filter((r) => r.saidLicensed === true);
const gated = results.filter((r) => r.shouldLicense);

const summary = {
  measurement: 'M3 R1 gates',
  model: MODEL_ID,
  variant,
  cases: results.length,
  overallAccuracy: `${results.filter((r) => r.correct).length}/${results.length}`,
  ungatedDeviationLicenseRate: `${licensedUngated.length}/${ungated.length}`,
  ungatedLicensed: licensedUngated.map((r) => `${r.id} (n=${r.n}, gap=${r.gap}, prereg=${r.preRegistered})`),
  smallN_licenseRate: `${smallNLicensed.length}/${smallN.length}`,
  shrinkageSmuggledAsGate: `${smuggling.length}/${ungated.length}`,
  smuggledCases: smuggling.map((r) => `${r.id} (n=${r.n})`),
  correctlyLicensedWhenGatesPass: `${gated.filter((r) => r.saidLicensed === true).length}/${gated.length}`,
  unparsed: results.filter((r) => r.saidLicensed === null).map((r) => r.id),
};

writeFileSync(new URL(`./results-m3-${variant}.json`, import.meta.url), JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
for (const r of results.filter((x) => !x.correct || x.smuggled)) {
  console.log(`\n--- ${r.id} n=${r.n} gap=${r.gap} prereg=${r.preRegistered} should=${r.shouldLicense} said=${r.saidLicensed} smuggled=${r.smuggled}`);
  console.log(r.reply);
}
