/**
 * EXPERIMENT 1 — one worker: runs a single (policy, mix, seed) cell and writes its JSON.
 * Spawned by run.ts; not normally invoked by hand.
 *
 *   ./node_modules/.bin/vite-node scripts/experiments/adherence/cell.ts <policy> <mix> <seed> <hands> <outPath>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIXES, runMatch } from './harness.js';
import { POLICY_NAMES } from './policies.js';
import type { PolicyName } from './policies.js';

const [policyArg, mixArg, seedArg, handsArg, outPath] = process.argv.slice(2);

const policy = POLICY_NAMES.find((p) => p === policyArg);
if (!policy) throw new Error(`unknown policy: ${policyArg}`);
const mix = MIXES.find((m) => m.name === mixArg);
if (!mix) throw new Error(`unknown mix: ${mixArg}`);
const seed = Number(seedArg);
const hands = Number(handsArg);
if (!Number.isFinite(seed) || !Number.isFinite(hands)) throw new Error('seed and hands must be numbers');
if (!outPath) throw new Error('missing outPath');

const result = runMatch({ policy: policy as PolicyName, mix, seed, hands });
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(result));
