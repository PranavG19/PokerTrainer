/**
 * EXPERIMENT 4 — step 2: make the real Bedrock calls and score them.
 *
 * Usage (from the REPO ROOT — /tmp cannot see node_modules):
 *   ./node_modules/.bin/vite-node scripts/experiments/tutorPrompts/run.ts explainer
 *   ./node_modules/.bin/vite-node scripts/experiments/tutorPrompts/run.ts interrogator
 *   ./node_modules/.bin/vite-node scripts/experiments/tutorPrompts/run.ts silence
 *
 * Writes out/<phase>.json with every prompt, every raw completion and every guard verdict, so the
 * report quotes real strings rather than summaries.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { ExplainerPayload, Spot } from './spots.js';
import { invoke, mapLimit, MODEL_ID } from './bedrock.js';
import { runGuard, failureKeys } from './guard.js';
import type { GuardResult } from './guard.js';
import {
  EXPLAINER_SYSTEM, INTERROGATOR_SYSTEM, VARIANTS, VARIANTS_V2, renderPayload, silenceSuffix,
} from './variants.js';
import type { VariantName, SilenceMode } from './variants.js';

interface SampleFile {
  collectedTotal: number;
  distribution: Record<string, number>;
  graded: { spot: Spot; payload: ExplainerPayload }[];
  silent: { spot: Spot; payload: ExplainerPayload }[];
}

const sample: SampleFile = JSON.parse(
  readFileSync('scripts/experiments/tutorPrompts/out/sample.json', 'utf8'),
);

const CONCURRENCY = 6;
/** `--v2` runs the round-2 variants against the same sample, so the two rounds are comparable. */
const ROUND_V2 = process.argv.includes('--v2');
const ACTIVE = ROUND_V2 ? VARIANTS_V2 : VARIANTS;
const SUFFIX = ROUND_V2 ? '-v2' : '';
const OUT = 'scripts/experiments/tutorPrompts/out';
mkdirSync(OUT, { recursive: true });

/** Synthetic learner reasons, one per error tag, so the Interrogator has something to probe. */
const LEARNER_REASONS: Record<string, string> = {
  RANGE: 'I thought my hand was live against his range',
  PRICE: 'the price looked cheap relative to the pot',
  SIZING: 'I wanted to keep the pot small and see the next card',
  PURITY: 'it felt like the standard play here',
  TEXTURE: 'the board looked good for my hand',
  BLOCKERS: 'I had a blocker to his best hand',
  'DEPTH-POSITION': 'I had position so I could control the pot',
};

interface Row {
  spotId: string;
  street: string;
  tier: string;
  tag: string;
  variant: VariantName;
  output: string;
  guard: GuardResult;
  failureKeys: string[];
  payload: ExplainerPayload;
  learnerReason?: string;
}

async function phaseExplainer(): Promise<void> {
  const jobs: { item: { spot: Spot; payload: ExplainerPayload }; variant: VariantName }[] = [];
  for (const item of sample.graded) for (const variant of ACTIVE) jobs.push({ item, variant });
  console.log(`explainer${SUFFIX}: ${sample.graded.length} spots x ${ACTIVE.length} variants = ${jobs.length} calls`);

  const rows = await mapLimit(jobs, CONCURRENCY, async ({ item, variant }, i) => {
    const output = await invoke({
      system: EXPLAINER_SYSTEM[variant],
      user: renderPayload(item.payload),
      maxTokens: 300,
      temperature: 0,
    });
    const guard = runGuard(output, 'correction', item.payload.permittedNumerals);
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${jobs.length}`);
    return {
      spotId: item.spot.id,
      street: item.spot.street,
      tier: item.spot.tier,
      tag: item.spot.tag,
      variant,
      output,
      guard,
      failureKeys: failureKeys(guard),
      payload: item.payload,
    } satisfies Row;
  });

  writeFileSync(`${OUT}/explainer${SUFFIX}.json`, JSON.stringify({ modelId: MODEL_ID, rows }, null, 2));
  report(rows, 'EXPLAINER');
}

async function phaseInterrogator(): Promise<void> {
  const jobs: { item: { spot: Spot; payload: ExplainerPayload }; variant: VariantName }[] = [];
  for (const item of sample.graded) for (const variant of ACTIVE) jobs.push({ item, variant });
  console.log(`interrogator: ${jobs.length} calls`);

  const rows = await mapLimit(jobs, CONCURRENCY, async ({ item, variant }, i) => {
    const reason = LEARNER_REASONS[item.spot.tag] ?? LEARNER_REASONS.PURITY;
    const output = await invoke({
      system: INTERROGATOR_SYSTEM[variant],
      user: renderPayload(item.payload, reason),
      maxTokens: 120,
      temperature: 0,
    });
    const guard = runGuard(output, 'question', item.payload.permittedNumerals);
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${jobs.length}`);
    return {
      spotId: item.spot.id,
      street: item.spot.street,
      tier: item.spot.tier,
      tag: item.spot.tag,
      variant,
      output,
      guard,
      failureKeys: failureKeys(guard),
      payload: item.payload,
      learnerReason: reason,
    } satisfies Row;
  });

  writeFileSync(`${OUT}/interrogator${SUFFIX}.json`, JSON.stringify({ modelId: MODEL_ID, rows }, null, 2));
  report(rows, 'INTERROGATOR');
}

/**
 * Silence. Every T0 spot is asked of every variant under both silence representations. A T0
 * payload deliberately still carries the full numeric field set: the question is whether the model
 * withholds prose when told to, not whether it can be starved of material.
 */
async function phaseSilence(): Promise<void> {
  const modes: SilenceMode[] = ['empty', 'sentinel'];
  const jobs: { item: { spot: Spot; payload: ExplainerPayload }; variant: VariantName; mode: SilenceMode }[] = [];
  for (const item of sample.silent) for (const variant of ACTIVE) for (const mode of modes) jobs.push({ item, variant, mode });
  console.log(`silence: ${jobs.length} calls`);

  const rows = await mapLimit(jobs, CONCURRENCY, async ({ item, variant, mode }, i) => {
    const output = await invoke({
      system: EXPLAINER_SYSTEM[variant] + '\n' + silenceSuffix(mode),
      user: renderPayload(item.payload),
      maxTokens: 300,
      temperature: 0,
    });
    const silent = mode === 'empty'
      ? output.trim().length === 0
      : output.trim() === 'NONE';
    if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${jobs.length}`);
    return {
      spotId: item.spot.id, street: item.spot.street, tier: item.spot.tier,
      variant, mode, output, silent, words: output.trim() ? output.trim().split(/\s+/).length : 0,
    };
  });

  writeFileSync(`${OUT}/silence${SUFFIX}.json`, JSON.stringify({ modelId: MODEL_ID, rows }, null, 2));

  console.log('\n=== SILENCE ===');
  for (const mode of modes) {
    for (const variant of ACTIVE) {
      const sub = rows.filter((r) => r.mode === mode && r.variant === variant);
      const ok = sub.filter((r) => r.silent).length;
      console.log(`  ${mode}/${variant}: ${ok}/${sub.length} silent`);
    }
  }
  console.log('\nVIOLATIONS:');
  for (const r of rows.filter((r) => !r.silent)) {
    console.log(`  [${r.mode}/${r.variant}] ${r.spotId}: ${JSON.stringify(r.output)}`);
  }
}

function report(rows: Row[], label: string): void {
  console.log(`\n=== ${label} ===`);
  for (const variant of ACTIVE) {
    const sub = rows.filter((r) => r.variant === variant);
    const pass = sub.filter((r) => r.guard.pass).length;
    const pct = ((pass / sub.length) * 100).toFixed(1);
    const byCheck: Record<string, number> = {};
    for (const r of sub) for (const k of r.failureKeys) byCheck[k] = (byCheck[k] ?? 0) + 1;
    const avgWords = (sub.reduce((a, r) => a + r.guard.wordCount, 0) / sub.length).toFixed(1);
    console.log(`  ${variant}: ${pass}/${sub.length} pass (${pct}%)  avg words ${avgWords}  failures ${JSON.stringify(byCheck)}`);
  }
  console.log('\nFAILURES (all):');
  for (const r of rows.filter((r) => !r.guard.pass)) {
    console.log(`  [${r.variant}] ${r.spotId} ${r.tier} — ${r.failureKeys.join(', ')}`);
    for (const f of r.guard.failures) console.log(`      ${f.check}: ${f.detail}`);
    console.log(`      OUTPUT: ${JSON.stringify(r.output)}`);
  }
}

const phase = process.argv[2];
if (phase === 'explainer') await phaseExplainer();
else if (phase === 'interrogator') await phaseInterrogator();
else if (phase === 'silence') await phaseSilence();
else {
  console.error('usage: run.ts <explainer|interrogator|silence>');
  process.exit(1);
}
