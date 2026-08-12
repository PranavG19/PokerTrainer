import { describe, expect, it } from 'vitest';
import { CURRICULUM, moduleForScenario } from '../../src/core/puzzleCurriculum.js';
import { SCENARIOS, scenarioById } from '../../src/core/puzzleScenarios.js';

/**
 * The curriculum's partition invariant is enforced at MODULE LOAD by assertPartitionsLibrary(), which
 * throws — so a broken partition fails the whole suite loudly. These tests pin it as explicit assertions
 * anyway (a thrown import is a blunt signal), and — more importantly — lock the SUBSTANTIVE property of
 * the stack-depth module that its name alone cannot enforce: that it actually teaches VARIED depths. A
 * module called "stack depth" whose scenarios were all 100bb would teach nothing about SPR while still
 * satisfying the partition, so the depth spread is pinned with a test rather than trusted to the label.
 */

describe('curriculum partitions the library exactly', () => {
  it('every scenario is in exactly one module', () => {
    const counts = new Map<string, number>();
    for (const module of CURRICULUM) {
      for (const id of module.scenarioIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const scenario of SCENARIOS) {
      expect(counts.get(scenario.id), `${scenario.id} is not grouped exactly once`).toBe(1);
    }
    // No module lists an id that is not a real scenario.
    const libraryIds = new Set(SCENARIOS.map((s) => s.id));
    for (const [id] of counts) {
      expect(libraryIds.has(id), `curriculum lists "${id}", which is not a scenario`).toBe(true);
    }
    // The total grouped equals the library size — no orphan, no phantom.
    const grouped = [...counts.values()].reduce((sum, n) => sum + n, 0);
    expect(grouped).toBe(SCENARIOS.length);
  });

  it('every module key is unique kebab-case and carries a title and blurb', () => {
    const keys = new Set<string>();
    for (const module of CURRICULUM) {
      expect(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(module.key), `module key "${module.key}"`).toBe(true);
      expect(keys.has(module.key), `duplicate module key "${module.key}"`).toBe(false);
      keys.add(module.key);
      expect(module.title.length, `${module.key} title`).toBeGreaterThan(0);
      expect(module.blurb.length, `${module.key} blurb`).toBeGreaterThan(0);
      expect(module.scenarioIds.length, `${module.key} is empty`).toBeGreaterThan(0);
    }
  });
});

describe('the stack-depth module teaches genuinely varied depths (not the label alone)', () => {
  const SHORT_STACK = 2000; // 40bb at 25/50
  const DEEP_STACK = 10_000; // 200bb at 25/50
  const module = CURRICULUM.find((m) => m.key === 'stack-depth-and-spr');

  it('the module exists and every id resolves to a real scenario', () => {
    expect(module, 'stack-depth-and-spr module is missing').toBeDefined();
    for (const id of module!.scenarioIds) {
      expect(scenarioById(id), `${id}`).toBeDefined();
      expect(moduleForScenario(id)?.key).toBe('stack-depth-and-spr');
    }
  });

  it('spans both a shallow (40bb) and a deep (200bb) stack — the whole point of an SPR module', () => {
    const depths = module!.scenarioIds.map((id) => scenarioById(id)!.startStack);
    // The library's default is 5000 (100bb); an SPR module made only of default-depth spots would be a
    // lie. Require at least one shallow and one deep scenario, and NONE at the default depth.
    expect(depths, 'no shallow (40bb) scenario in the SPR module').toContain(SHORT_STACK);
    expect(depths, 'no deep (200bb) scenario in the SPR module').toContain(DEEP_STACK);
    expect(
      depths.every((d) => d === SHORT_STACK || d === DEEP_STACK),
      `the SPR module has an off-depth scenario: ${depths.join(', ')}`,
    ).toBe(true);
  });

  it('every scenario in the module teaches a real commitment decision (a fold, call, bet or raise line)', () => {
    for (const id of module!.scenarioIds) {
      const scenario = scenarioById(id)!;
      // The taught line must end on a genuine action, and the whole point is a postflop SPR decision, so
      // at least one target step sits on the flop or later (board present when the hero acts on it).
      expect(scenario.target.length, `${id} has an empty line`).toBeGreaterThan(0);
      const kinds = new Set(scenario.target.map((t) => t.action));
      expect(
        [...kinds].every((k) => ['fold', 'check', 'call', 'bet', 'raise', 'allin'].includes(k)),
        `${id} has a non-action target`,
      ).toBe(true);
    }
  });
});
