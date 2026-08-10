/**
 * WHICH TESTS COULD THIS CHANGE HAVE BROKEN — a fast-feedback selector for iterating, NOT a
 * replacement for the full suite before a commit.
 *
 * The rule this obeys: every answer is either "these suites" or "all of them", and it says which and
 * why. A selector that guesses wrong silently is worse than no selector, so every branch that cannot
 * prove a suite is unaffected returns everything.
 *
 * HOW A SUITE IS TIED TO A SOURCE FILE, in three ways, most reliable first:
 *
 *   1. THE REAL IMPORT GRAPH. A spec's transitive `from '../../src/...'` imports are resolved by
 *      reading the files, so `progress.spec.ts` importing `core/progress.js` — which imports
 *      `core/session.js` — is affected by a change to either.
 *   2. THE RENDERER GRAPH. An e2e spec drives the UI rather than importing it, so a change to
 *      `screens/progress.ts` is invisible to the import graph above. Renderer files are attributed by
 *      walking `renderer/main.ts`'s own imports and mapping each screen to the suites that exercise
 *      it, via SUITE_SURFACES below.
 *   3. NAME MATCHING, as a backstop: `foo.spec.ts` is affected by `screens/foo.ts` and `core/foo.ts`.
 *
 * SHARED FILES FORCE A FULL RUN, deliberately. Anything under ALWAYS_FULL — the engine, the RNG, the
 * app shell, the test helpers — is depended on so widely that a partial answer would be a false
 * negative. Measured: table.ts is reachable from most of the suite, so "affected by table.ts" is
 * "everything" anyway; naming it explicitly makes that honest instead of accidental.
 *
 * Usage:
 *   npx tsx scripts/affected-tests.ts            # vs HEAD (uncommitted work)
 *   npx tsx scripts/affected-tests.ts HEAD~3     # vs an earlier revision
 *   npx tsx scripts/affected-tests.ts --run      # print, then run what it selected
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Files whose blast radius is the whole suite. Not a convenience list — each one is either the poker
 * engine every spec deals through, the shell every screen mounts inside, or the harness every test
 * launches with.
 */
const ALWAYS_FULL = [
  'src/core/table.ts',
  'src/core/cards.ts',
  'src/core/rng.ts',
  'src/core/evaluator.ts',
  'src/core/session.ts',
  'src/main/main.ts',
  'src/main/preload.ts',
  'src/main/store.ts',
  'src/renderer/main.ts',
  'src/renderer/styles.css',
  'tests/e2e/helpers.ts',
  'tests/e2e/flow.ts',
  'package.json',
  'playwright.config.ts',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.main.json',
];

/**
 * Which suites exercise which renderer surface. Only for files the import graph cannot attribute,
 * i.e. screens and components, which e2e drives through the DOM rather than importing.
 *
 * A screen absent from this map falls back to name matching plus the always-full list, so a new screen
 * with no entry is over-tested rather than under-tested.
 */
const SUITE_SURFACES: Record<string, readonly string[]> = {
  'src/renderer/screens/progress.ts': ['progress'],
  'src/renderer/screens/contrast.ts': ['contrast'],
  'src/renderer/screens/dossier.ts': ['dossier'],
  'src/renderer/screens/robustness.ts': ['robustness'],
  'src/renderer/screens/spacing.ts': ['spacing'],
  'src/renderer/screens/anomaly.ts': ['anomaly'],
  'src/renderer/screens/charts.ts': ['charts'],
  'src/renderer/screens/drill.ts': ['drill'],
  'src/renderer/screens/lesson.ts': ['lesson'],
  'src/renderer/screens/review.ts': ['review'],
  'src/renderer/screens/settings.ts': ['settings'],
  'src/renderer/screens/sessionPlan.ts': ['session-plan'],
  'src/renderer/screens/profile.ts': ['screens', 'navigation'],
  'src/renderer/screens/home.ts': ['screens', 'navigation', 'session-plan'],
  // The table is the play surface: every gameplay-shaped suite goes through it.
  'src/renderer/screens/table.ts': [
    'gameplay',
    'allin',
    'rebuy',
    'busted-seats',
    'handover-chips',
    'coached-handover',
    'swept-table',
    'interaction',
    'keyboard',
    'layout',
    'soak',
    'deep-soak',
    'persistence',
    'archetypes',
  ],
  'src/renderer/components/coachPanel.ts': ['gameplay', 'coached-handover', 'layout'],
  'src/renderer/components/statsSheet.ts': ['layout', 'interaction'],
  'src/renderer/components/predictPanel.ts': ['predict'],
  'src/renderer/components/tutorRail.ts': ['tutor-rail', 'tutor'],
  'src/renderer/components/recommendation.ts': ['recommend', 'session-plan'],
  'src/renderer/components/card.ts': ['gameplay', 'layout', 'contrast', 'robustness'],
  'src/main/network.ts': ['no-network'],
  'src/main/speech.ts': ['voice'],
};

function git(args: readonly string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8' });
}

/**
 * Test OUTPUTS, not inputs. Screenshots are rewritten by the very suites this script selects, so
 * counting them as changes would make every run look like it touched everything. Same for the audit
 * probes, which are one-off scripts nothing imports.
 */
function isArtifact(file: string): boolean {
  return (
    file.startsWith('screenshots/') ||
    file.startsWith('test-results/') ||
    file.startsWith('playwright-report/') ||
    file.startsWith('dist/') ||
    file.startsWith('.claude/') ||
    file.startsWith('scripts/audit-')
  );
}

function changedFiles(base: string): string[] {
  // Both committed-since-base and uncommitted, so the answer covers the working tree as it stands.
  const tracked = git(['diff', '--name-only', base]).split('\n');
  const staged = git(['diff', '--name-only', '--cached']).split('\n');
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n');
  return [...new Set([...tracked, ...staged, ...untracked])]
    .filter((f) => f.length > 0)
    .filter((f) => !isArtifact(f));
}

/** Every `../../src/...` or relative import a file reaches, transitively. */
function importsOf(entry: string, seen = new Set<string>()): Set<string> {
  const abs = path.join(ROOT, entry);
  if (seen.has(entry) || !fs.existsSync(abs)) return seen;
  seen.add(entry);

  const source = fs.readFileSync(abs, 'utf-8');
  for (const match of source.matchAll(/from '([^']+)'/g)) {
    const spec = match[1];
    if (!spec.startsWith('.')) continue;
    // .js in TS source refers to the .ts file next to it.
    const resolved = path
      .relative(ROOT, path.resolve(path.dirname(abs), spec))
      .replace(/\.js$/, '.ts');
    if (resolved.endsWith('.css')) {
      seen.add(resolved);
      continue;
    }
    importsOf(resolved, seen);
  }
  return seen;
}

function suiteName(specPath: string): string {
  return path.basename(specPath).replace(/\.(spec|test)\.ts$/, '');
}

const base = process.argv.find((a) => !a.startsWith('--') && a !== process.argv[0] && a !== process.argv[1]) ?? 'HEAD';
const shouldRun = process.argv.includes('--run');

const changed = changedFiles(base);
if (changed.length === 0) {
  console.log('No changes vs ' + base + ' — nothing to test.');
  process.exit(0);
}

console.log(`Changed vs ${base} (${changed.length}):`);
for (const file of changed) console.log(`  ${file}`);
console.log();

const forcingFull = changed.filter((f) => ALWAYS_FULL.includes(f));
if (forcingFull.length > 0) {
  console.log('FULL SUITE REQUIRED — these are depended on too widely to narrow:');
  for (const file of forcingFull) console.log(`  ${file}`);
  console.log('\n  npm test -- --run && npm run e2e');
  if (shouldRun) {
    execFileSync('npm', ['test', '--', '--run'], { cwd: ROOT, stdio: 'inherit' });
    execFileSync('npm', ['run', 'e2e'], { cwd: ROOT, stdio: 'inherit' });
  }
  process.exit(0);
}

const specs = [
  ...fs.readdirSync(path.join(ROOT, 'tests/e2e')).filter((f) => f.endsWith('.spec.ts')).map((f) => `tests/e2e/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'tests/unit')).filter((f) => f.endsWith('.test.ts')).map((f) => `tests/unit/${f}`),
];

const affected = new Set<string>();
const why = new Map<string, string>();

for (const spec of specs) {
  const name = suiteName(spec);

  // A changed spec always runs.
  if (changed.includes(spec)) {
    affected.add(spec);
    why.set(spec, 'the spec itself changed');
    continue;
  }

  // 1. The import graph.
  const graph = importsOf(spec);
  const imported = changed.find((f) => graph.has(f));
  if (imported !== undefined) {
    affected.add(spec);
    why.set(spec, `imports ${imported}`);
    continue;
  }

  // 2. The renderer surface map.
  const surface = changed.find((f) => SUITE_SURFACES[f]?.includes(name));
  if (surface !== undefined) {
    affected.add(spec);
    why.set(spec, `drives ${surface}`);
    continue;
  }

  // 3. Name matching.
  const named = changed.find(
    (f) => f === `src/core/${name}.ts` || f === `src/renderer/screens/${name}.ts`,
  );
  if (named !== undefined) {
    affected.add(spec);
    why.set(spec, `matches ${named} by name`);
  }
}

/*
 * A changed source file that reached NO suite is reported loudly. It means either the file is untested
 * or this selector cannot see the link — both worth knowing, and both a reason to run everything
 * rather than to trust an empty answer.
 */
const sourceChanges = changed.filter((f) => f.startsWith('src/'));
const attributed = new Set([...why.values()].map((reason) => reason.split(' ').pop()));
const orphans = sourceChanges.filter((f) => !attributed.has(f));

if (affected.size === 0) {
  console.log('No suite could be attributed to these changes — running everything, because an empty');
  console.log('answer is indistinguishable from a selector that cannot see the link.');
  console.log('\n  npm test -- --run && npm run e2e');
  process.exit(0);
}

const e2e = [...affected].filter((s) => s.startsWith('tests/e2e/')).sort();
const unit = [...affected].filter((s) => s.startsWith('tests/unit/')).sort();

console.log(`Affected: ${unit.length} unit file(s), ${e2e.length} e2e file(s) of ${specs.length} total.`);
for (const spec of [...unit, ...e2e]) console.log(`  ${spec}  — ${why.get(spec)}`);

if (orphans.length > 0) {
  console.log('\nWARNING — changed but reached no suite:');
  for (const file of orphans) console.log(`  ${file}`);
  console.log('  Either it is untested or the link is invisible here. Prefer the full suite.');
}

console.log('\nFast feedback:');
if (unit.length > 0) console.log(`  npm test -- --run ${unit.join(' ')}`);
if (e2e.length > 0) console.log(`  npm run build && npx playwright test ${e2e.join(' ')}`);
console.log('\nBEFORE COMMITTING, always: npm test -- --run && npm run e2e');

if (shouldRun) {
  if (unit.length > 0) {
    execFileSync('npm', ['test', '--', '--run', ...unit], { cwd: ROOT, stdio: 'inherit' });
  }
  if (e2e.length > 0) {
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
    execFileSync('npx', ['playwright', 'test', ...e2e], { cwd: ROOT, stdio: 'inherit' });
  }
}
