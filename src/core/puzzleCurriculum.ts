/**
 * The puzzle CURRICULUM — a teaching order over the flat scenario library.
 *
 * The scenarios in puzzleScenarios.ts are a flat array; this file groups them into named, ordered
 * MODULES that follow the chronology of a hand (preflop → flop → turn → river) with a difficulty ramp
 * both across and within modules. It is a pure VIEW over the existing library: it adds no scenario and
 * fabricates no data — every module id is an id that already exists, and the picker uses this only to
 * label and group its options. "Next puzzle" and jump-by-index still walk the underlying array order,
 * so nothing about grading or the deal changes.
 *
 * A module is a coherent skill a beginner can name ("the reraise game", "playing the flop"), so the
 * learner sees a progression instead of 44 undifferentiated spots.
 */

import { SCENARIOS } from './puzzleScenarios.js';

export interface CurriculumModule {
  /** Stable kebab-case key — for testids and any future persistence. */
  readonly key: string;
  /** Learner-facing module name. */
  readonly title: string;
  /** One line: what this module teaches. */
  readonly blurb: string;
  /** The scenario ids in this module, in teaching order (a difficulty ramp within the module). */
  readonly scenarioIds: readonly string[];
}

export const CURRICULUM: readonly CurriculumModule[] = [
  {
    key: 'preflop-fundamentals',
    title: 'Preflop Fundamentals: Open, Isolate, and the Easy Folds',
    blurb:
      'The preflop decisions with one right answer — raise your premiums first-in, punish a limper, and lay down the pretty hands that are actually dominated.',
    scenarioIds: [
      'btn-open-aks',
      'sb-raise-or-fold-ajo',
      'isolate-limper-aqs',
      'fold-kq-to-utg',
      'fold-weak-ace-to-ep-open',
    ],
  },
  {
    key: 'reraise-game',
    title: 'The Reraise Game: 3-Bets, Squeezes, and 4-Bets',
    blurb:
      'Build big pots with the best hands — value 3-bets, squeezing over an open and a call, 4-betting the nuts, and finally a blocker 3-bet bluff.',
    scenarioIds: [
      '3bet-aa-vs-open',
      'squeeze-kk-vs-open-call',
      '4bet-aa-vs-3bet',
      '3bet-aqs-vs-btn-steal',
      'blocker-3bet-bluff-a5s',
    ],
  },
  {
    key: 'facing-a-raise',
    title: 'Facing a Raise: Continue or Lay It Down',
    blurb:
      'The discipline of playing back at aggression — set-mine and call the 3-bets you should, and fold the dominated hands that only look strong.',
    scenarioIds: [
      'set-mine-call-22',
      'call-3bet-ip-aqs',
      'iso-3bet-vs-limp-reraise',
      'call-3bet-oop-99',
      'fold-open-to-3bet',
      'squeeze-fold-weak',
      'fold-multiway-ajo',
      'fold-3bet-bluff-to-4bet',
    ],
  },
  {
    key: 'flop-cbet-pot-control',
    title: 'Playing the Flop: C-Bets and Pot Control',
    blurb:
      'The everyday flop — whose range does the board favor? C-bet where you have it, call the draws that have the price, FOLD the draws that do not, control the pot with marginal hands, and give up when you miss.',
    scenarioIds: [
      'bb-defend-vs-btn',
      'cbet-dry-ace',
      'call-flush-draw-odds',
      'fold-gutshot-to-flop-cbet',
      'fold-flush-draw-to-flop-overbet',
      'pot-control-ip',
      'checkback-underpair-multiway',
      'fold-flop-airball',
      'fold-to-raise-on-cbet',
    ],
  },
  {
    key: 'flop-big-hands-semibluffs',
    title: 'Flop Aggression: Big Hands and Semi-Bluffs',
    blurb:
      'Turn strong holdings into big pots — raise the donk bet, trap on dry boards, fast-play sets on wet ones, and check-raise a draw as a semi-bluff.',
    scenarioIds: [
      'raise-donk-bet-set',
      'trap-flopped-set-dry',
      'value-raise-flop-set',
      'checkraise-set-wet',
      'semibluff-checkraise-draw',
    ],
  },
  {
    key: 'the-turn',
    title: 'The Turn: Second Barrels and Big Draws',
    blurb:
      'Keep the pressure on — barrel value, delay and probe, semi-bluff your equity, call the big draw on implied odds, and fold when the scare card lands.',
    scenarioIds: [
      'barrel-turn-overpair',
      'delayed-cbet-turn',
      'probe-turn-after-checkback',
      'double-barrel-semibluff',
      'call-turn-implied-oesd',
      'fold-tptk-turn-flush-in',
    ],
  },
  {
    key: 'the-river',
    title: 'The River: Value, Bluffs, and Big Folds',
    blurb:
      'No cards left — extract thin and polar value, run the blocker bluff, catch the bluff you beat, and make the disciplined big-bet laydowns that separate the best.',
    scenarioIds: [
      'value-bet-river-flush',
      'thin-value-bet-river',
      'overbet-river-nut-flush',
      'river-bluff-blocker',
      'call-river-bluffcatch',
      'fold-busted-draw-river',
      'overpair-fold-river-jam',
      'fold-weak-pair-river-overbet',
    ],
  },
  {
    key: 'multiway-pots',
    title: 'Multiway Pots: A Crowd Changes Everything',
    blurb:
      'With more players in, hands go up in value and bluffs go down. Fold the dominated big cards when a raise gets a caller, give up your air instead of c-betting into a field, value-bet a touch smaller, and set-mine the small pairs the price now rewards.',
    scenarioIds: [
      'multiway-fold-ako-to-3bet-and-call',
      'multiway-no-cbet-bluff-air',
      'multiway-tighten-value-bet',
      'multiway-set-mine-price',
    ],
  },
  {
    key: 'blind-vs-blind',
    title: 'Blind vs Blind: Heads-Up, the Ranges Explode',
    blurb:
      'One opponent and position guaranteed to the small blind: open a huge share of hands, defend the big blind even wider on the price, 3-bet your good hands for value against a range that opens everything, then postflop check-raise the big draws OOP, range-c-bet the boards that favour you, and double-barrel top pair for value on the runouts that keep the range advantage.',
    scenarioIds: [
      'bvb-sb-open-wide',
      'bvb-bb-defend-wide',
      'bvb-bb-3bet-value',
      'bvb-bb-checkraise-semibluff',
      'bvb-sb-cbet-dry',
      'bvb-sb-double-barrel-value',
    ],
  },
  {
    key: 'stack-depth-and-spr',
    title: 'Stack Depth: When One Pair Is a Stack, and When It Is Not',
    blurb:
      'The same hand plays differently by depth. Shallow (40bb), a low stack-to-pot ratio commits top pair, overpairs and big draws; deep (200bb), a high ratio means one pair pot-controls or folds while sets and the nuts build for stacks.',
    scenarioIds: [
      'commit-tptk-40bb',
      'commit-overpair-40bb',
      'commit-flush-draw-jam-40bb',
      'deep-pot-control-overpair-200bb',
      'deep-fold-tptk-200bb',
      'deep-stack-set-200bb',
    ],
  },
];

/**
 * The curriculum must partition the library exactly: every scenario in exactly one module, and every
 * module id a real scenario. A drift here (a new scenario left out, a renamed id, a duplicate) is a
 * teaching gap that would silently drop a spot from the grouped picker, so it throws at module load —
 * the same fail-loud contract as puzzle.ts's assertScenario.
 */
function assertPartitionsLibrary(): void {
  const libraryIds = new Set(SCENARIOS.map((s) => s.id));
  const seen = new Set<string>();
  for (const module of CURRICULUM) {
    for (const id of module.scenarioIds) {
      if (!libraryIds.has(id)) {
        throw new Error(`curriculum module ${module.key}: "${id}" is not a scenario`);
      }
      if (seen.has(id)) throw new Error(`curriculum: "${id}" appears in more than one module`);
      seen.add(id);
    }
  }
  const missing = [...libraryIds].filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new Error(`curriculum leaves ${missing.length} scenario(s) ungrouped: ${missing.join(', ')}`);
  }
}

assertPartitionsLibrary();

/** The module a scenario belongs to, or undefined if (impossibly, given the assert) ungrouped. */
export function moduleForScenario(id: string): CurriculumModule | undefined {
  return CURRICULUM.find((m) => m.scenarioIds.includes(id));
}
