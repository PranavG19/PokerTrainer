/**
 * EXPERIMENT 3 — reason-grader accuracy against the hand-labelled corpus (PRODUCT-SPEC open
 * question #3). G4 fires T3 + interrupt + re-serve on a classification, so the gate is the
 * PRECISION of {hand-strength, none}: one minus that is the fraction of well-reasoned decisions
 * the harshest event in the design would punish.
 *
 * Usage:
 *   node scripts/experiments/reasonGrader/run.mjs --classifier keyword
 *   node scripts/experiments/reasonGrader/run.mjs --classifier llm [--repeats 1] [--tag v1] [--no-prefill]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { invoke, mapLimit, MODEL_ID } from '../socratic/bedrock.mjs';
import { keywordGrade } from './keyword.mjs';
import { LABELS, perClass, g4Binary, markdownConfusion, pct } from './metrics.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const classifier = flag('--classifier', 'keyword');
const repeats = Number(flag('--repeats', '1'));
const tag = flag('--tag', classifier);
// Without a prefill the model sometimes opens with reasoning prose and the 12-token cap truncates
// it mid-sentence, which scores as unparsed — a harness artefact, not a misclassification. The
// prefill forces the first token to be the label. --no-prefill reproduces the artefact.
const prefill = !args.includes('--no-prefill');

const corpusPath = new URL('../../../research/corpus/reasons.jsonl', import.meta.url);
const corpus = readFileSync(corpusPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

/** The grader prompt. Ported verbatim from the M2 v2 variant, which beat the bare v1 rubric. */
const SYSTEM = `You are the reason-grader of a poker tutor. Classify the learner's typed reason into exactly
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

const parse = (raw) => {
  const s = raw.trim().toLowerCase();
  // hand-strength first: "range" is a substring of nothing here but "hand-strength" contains none of
  // the others, whereas a verbose reply like "hand-strength (range vocabulary)" must not read range.
  return LABELS.find((l) => s.startsWith(l)) ?? LABELS.find((l) => s.includes(l)) ?? `unparsed(${s})`;
};

async function classifyLlm(row) {
  const messages = [{ role: 'user', content: `NODE: ${row.node}\nLEARNER'S REASON: "${row.text}"\n\nLabel?` }];
  if (prefill) messages.push({ role: 'assistant', content: 'Label:' });
  const raw = await invoke(messages, { system: SYSTEM, maxTokens: 12 });
  return parse(raw);
}

async function runOnce(runIndex) {
  const rows = classifier === 'keyword'
    ? corpus.map((row) => ({ ...row, got: keywordGrade(row.text) }))
    : await mapLimit(corpus, 5, async (row) => ({ ...row, got: await classifyLlm(row) }));
  return rows.map((r) => ({ ...r, correct: r.got === r.label, run: runIndex }));
}

const runs = [];
for (let i = 0; i < repeats; i++) runs.push(await runOnce(i));
// Report run 0 as the headline; extra runs measure the classifier's own instability.
const rows = runs[0];

const accuracy = rows.filter((r) => r.correct).length / rows.length;
const byFamily = {};
for (const r of rows) {
  byFamily[r.family] ??= { n: 0, correct: 0 };
  byFamily[r.family].n++;
  if (r.correct) byFamily[r.family].correct++;
}

const g4 = g4Binary(rows);
const classes = perClass(rows);
const misses = rows.filter((r) => !r.correct).map((r) => ({ id: r.id, family: r.family, truth: r.label, got: r.got, text: r.text }));
const selfAgreement = repeats > 1
  ? corpus.map((_, i) => new Set(runs.map((run) => run[i].got)).size === 1).filter(Boolean).length / corpus.length
  : null;

const summary = {
  experiment: 'E3 reason grader',
  classifier,
  model: classifier === 'llm' ? MODEL_ID : 'keyword-only (pure function, no network)',
  n: rows.length,
  repeats,
  overallAccuracy: `${rows.filter((r) => r.correct).length}/${rows.length} = ${pct(accuracy)}`,
  selfAgreementAcrossRuns: selfAgreement === null ? 'n/a (single run)' : pct(selfAgreement),
  g4Positive_handStrengthOrNone: {
    ...g4,
    precision: pct(g4.precision),
    recall: pct(g4.recall),
    precisionCI95: g4.precisionCI95.map((x) => pct(x)),
    recallCI95: g4.recallCI95.map((x) => pct(x)),
    wellReasonedPunishedPer100Interrupts: g4.precision === null ? 'n/a' : ((1 - g4.precision) * 100).toFixed(1),
  },
  perClass: Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, { ...v, precision: pct(v.precision), recall: pct(v.recall), f1: v.f1.toFixed(3) }])),
  byFamily: Object.fromEntries(Object.entries(byFamily).map(([k, v]) => [k, `${v.correct}/${v.n}`])),
  misses,
};

mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(new URL(`./out/${tag}.json`, import.meta.url), JSON.stringify({ summary, runs }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log('\nCONFUSION MATRIX\n' + markdownConfusion(rows));
