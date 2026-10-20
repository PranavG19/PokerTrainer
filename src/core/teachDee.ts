/**
 * TEACH DEE — the protégé mode (VISION §3 Pillar 1, BUILD-PLAN 2.4; panel/learning-scientist.md §2.1).
 *
 * The learner hands Dee one of their own Folio rules and says how to read it: the variable it turns on, the value
 * where it applies, the play it prescribes there and the play everywhere else. The app then builds a CONTRAST SET
 * around a manifested spot (contrastManifest.ts): pairs of real deals that differ in exactly that one variable
 * (contrast.ts guarantees it), so some spots sit where the rule applies and their near-misses sit just outside it.
 * Dee plays every spot from the rule; the learner commits their own play first. The ENGINE judges each spot
 * (gradeSpot, the same grader the table uses), and repair detection reads Dee's misses off those verdicts: when
 * the rule is wrong, too broad or too narrow, Dee makes the mistake on screen and the learner names what went
 * wrong and rewrites the sentence. The rewrite is appended to the lexicon (L3: history is kept).
 *
 * OWNER RULES THIS FILE HOLDS BY CONSTRUCTION:
 *  - The tutor never authors a number. Every verdict is gradeSpot's; every fact on a spot is the engine's state.
 *    Dee's lines carry no numeral and no number word (tests/unit/teachDee.test.ts runs the bank lint over them).
 *  - No trait insults: a finding is about the SENTENCE ("the rule reaches too far"), never about the learner.
 *  - Nothing is locked: any rule can be taught on any spot, as often as the learner likes.
 *
 * WHAT COUNTS AS A VERDICT. A spot has one when at least one of the three plays (bet or raise, check or call, fold)
 * does not hold up, by the grader's own severity: 'free' (including its close band) holds up, anything else does
 * not. A spot where all three hold up says nothing about any rule, so it is never counted against one.
 *
 * Pure: the caller passes the seed and the clock values.
 */

import {
  AXIS_MAX_SET_SIZE,
  GAP_BANDS,
  POSITIONS,
  PRODUCIBLE_AXES,
  axisCoverage,
  differingAxes,
  featuresOf,
  generateContrastSet,
  type ContrastAxis,
  type ContrastSpot,
  type ContrastVariant,
  type SpotFeatures,
} from './contrast.js';
import { CONTRAST_MANIFEST, type ManifestEntry } from './contrastManifest.js';
import type { Grade } from './coach.js';
import { gradeSpot } from './gradeSpot.js';
import { legalActions, type ActionKind } from './table.js';
import { mulberry32, shuffle } from './rng.js';
import type { LexiconAttempt } from './lexicon.js';
import type { DayKeyOf } from './localDay.js';
import type { RememberedSentence, TaughtSet, TeachDeeState } from './progression/types.js';
import { MAX_TAUGHT_SETS } from './progression/persist.js';
import { renderLine } from './dee/engine.js';
import type { DeePose, Facts, Tone } from './dee/types.js';

// ── The plays a rule can prescribe ───────────────────────────────────────────

/** A rule names a kind of play, not a size: the size is the engine's business. */
export const MOVES = ['aggressive', 'passive', 'fold'] as const;
export type Move = (typeof MOVES)[number];

export const MOVE_LABELS: Readonly<Record<Move, string>> = {
  aggressive: 'Bet or raise',
  passive: 'Check or call',
  fold: 'Fold',
};

/** Lower case, for a sentence: "Dee plays check or call". */
export const MOVE_WORDS: Readonly<Record<Move, string>> = {
  aggressive: 'bet or raise',
  passive: 'check or call',
  fold: 'fold',
};

/** The engine action a play is graded as on one spot: whichever of its actions the spot offers. */
export function actionFor(move: Move, legal: readonly ActionKind[]): ActionKind | null {
  const order: readonly ActionKind[] = move === 'aggressive' ? ['bet', 'raise'] : move === 'passive' ? ['check', 'call'] : ['fold'];
  return order.find((a) => legal.includes(a)) ?? null;
}

/** The default "everywhere else" play for a rule's play: the other side of the bet-or-not line. */
export function oppositeOf(move: Move): Move {
  return move === 'aggressive' ? 'passive' : 'aggressive';
}

// ── How the learner tells Dee to read a rule ─────────────────────────────────

export interface RuleReading {
  /** The variable the rule turns on. One of the producible axes. */
  readonly axis: ContrastAxis;
  /** The axis value where the rule applies, as `levelOf` spells it. */
  readonly value: string;
  /** Dee's play where the rule applies. */
  readonly action: Move;
  /** Dee's play everywhere else in the set (the near-misses). */
  readonly otherwise: Move;
}

/** One axis value, as stored and compared. */
export function levelOf(features: SpotFeatures, axis: ContrastAxis): string {
  return String(features[axis]);
}

/** A level's every possible value, in the order the axis runs (so "nearest near-miss" has a meaning). */
export function axisLevels(axis: ContrastAxis): readonly string[] {
  if (axis === 'suitedness') return ['suited', 'offsuit'];
  if (axis === 'kickerGap') return GAP_BANDS;
  if (axis === 'position') return POSITIONS;
  if (axis === 'playersBehind') return ['0', '1', '2', '3'];
  return [];
}

export const AXIS_NAMES: Readonly<Record<ContrastAxis, string>> = {
  suitedness: 'suitedness',
  kickerGap: 'the gap between the hole cards',
  position: 'the seat',
  playersBehind: 'players left to act',
  rangeAsymmetry: 'range asymmetry',
  boardTexture: 'the board texture',
  stackDepth: 'stack depth',
};

/**
 * A level for display. Digits only where the level is a count the engine computed (players behind), never a
 * spelled-out number: Dee's lines quote these, and Dee writes no number of its own.
 */
export function levelLabel(axis: ContrastAxis, value: string): string {
  if (axis === 'suitedness') return value === 'suited' ? 'suited' : 'offsuit';
  if (axis === 'kickerGap') {
    const gap: Record<string, string> = {
      pair: 'a pocket pair',
      connected: 'connected cards',
      'one-gap': 'a 1-rank gap',
      'two-gap': 'a 2-rank gap',
      wide: 'a wide gap',
    };
    return gap[value] ?? value;
  }
  if (axis === 'position') {
    const seat: Record<string, string> = { BTN: 'the button', CO: 'the cutoff', SB: 'the small blind', BB: 'the big blind' };
    return seat[value] ?? value;
  }
  if (axis === 'playersBehind') return value === '0' ? 'nobody left to act' : `${value} left to act`;
  return value;
}

/**
 * Dee's first reading of a sentence: keyword guesses the learner then corrects. A guess only, and never a grade —
 * the learner's own choice of variable, value and play is what Dee plays from.
 */
export function suggestReading(text: string): Partial<RuleReading> {
  const t = text.toLowerCase();
  const out: { axis?: ContrastAxis; value?: string; action?: Move; otherwise?: Move } = {};
  const hit = (re: RegExp): number => {
    const m = re.exec(t);
    return m === null ? -1 : m.index;
  };
  const axisCues: readonly (readonly [ContrastAxis, RegExp, string | null])[] = [
    ['suitedness', /\boff-?suit/, 'offsuit'],
    ['suitedness', /\bsuited\b/, 'suited'],
    ['kickerGap', /\bpocket pairs?\b|\bpairs? in (?:the )?hand\b/, 'pair'],
    ['kickerGap', /\bconnect(?:ed|ors?)\b/, 'connected'],
    ['kickerGap', /\bkickers?\b|\bgap/, null],
    ['position', /\bbutton\b|\bbtn\b/, 'BTN'],
    ['position', /\bcut-?off\b|\bco\b/, 'CO'],
    ['position', /\bsmall blind\b|\bsb\b/, 'SB'],
    ['position', /\bbig blind\b|\bbb\b/, 'BB'],
    ['position', /\bposition\b|\bseat\b/, null],
    ['playersBehind', /\bbehind\b|\bleft to act\b|\bstill to act\b/, null],
  ];
  let best = Infinity;
  for (const [axis, re, value] of axisCues) {
    const at = hit(re);
    if (at < 0 || at >= best) continue;
    best = at;
    out.axis = axis;
    if (value === null) delete out.value;
    else out.value = value;
  }
  const moveCues: readonly (readonly [Move, RegExp])[] = [
    ['fold', /\bfolds?\b|\bfolding\b|\bmuck/],
    ['aggressive', /\bbets?\b|\bbetting\b|\braises?\b|\braising\b|\bc-?bets?\b|\b3-?bets?\b|\bsqueez|\bopens?\b|\bleads?\b|\bprobes?\b|\bshove/],
    ['passive', /\bcalls?\b|\bcalling\b|\bchecks?\b|\bchecking\b|\bdefends?\b|\bcontinues?\b|\bbluff-?catch/],
  ];
  let first = Infinity;
  for (const [move, re] of moveCues) {
    const at = hit(re);
    if (at >= 0 && at < first) {
      first = at;
      out.action = move;
    }
  }
  if (out.action !== undefined) out.otherwise = oppositeOf(out.action);
  return out;
}

// ── Where a rule can be taught ───────────────────────────────────────────────

export interface TeachAxis {
  readonly axis: ContrastAxis;
  /** Levels this spot can deal on the axis, in axis order. The base's own level is among them. */
  readonly values: readonly string[];
}

export interface TeachBase {
  readonly entry: ManifestEntry;
  /** Axes with at least one one-variable neighbour on this base. */
  readonly axes: readonly TeachAxis[];
}

/** Fixed: the levels a base can deal are a property of the base, not of one teaching. */
const COVERAGE_SEED = 19;

let basesCache: readonly TeachBase[] | null = null;

/** Every manifested spot a rule can be taught on: the ones with at least one buildable axis. */
export function teachableBases(): readonly TeachBase[] {
  if (basesCache !== null) return basesCache;
  const out: TeachBase[] = [];
  for (const entry of CONTRAST_MANIFEST) {
    const coverage = axisCoverage(entry.base, COVERAGE_SEED);
    const axes: TeachAxis[] = [];
    for (const axis of PRODUCIBLE_AXES) {
      if (coverage[axis] < 2) continue;
      const result = generateContrastSet(entry.base, axis, { seed: COVERAGE_SEED, size: Math.min(coverage[axis], AXIS_MAX_SET_SIZE[axis]) });
      if (!result.ok) continue;
      const seen = new Set([result.set.base, ...result.set.variants].map((v) => levelOf(v.features, axis)));
      axes.push({ axis, values: axisLevels(axis).filter((l) => seen.has(l)) });
    }
    if (axes.length > 0) out.push({ entry, axes });
  }
  basesCache = out;
  return out;
}

const STREET_NAMES: Readonly<Record<string, string>> = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' };

/** A spot family described from the engine's own state, not the manifest's title. */
export function baseLabel(spot: ContrastSpot): string {
  return `${STREET_NAMES[spot.street] ?? spot.street} · ${spot.position} vs ${spot.villainPositions.join(', ')}`;
}

/**
 * The spot a rule is taught on by default: the rule's own concept when it is a manifested one, else the first
 * spot whose repair principle matches the rule's, else the first teachable spot. The learner can change it.
 */
export function defaultBaseFor(conceptId: string, principle: string | null): TeachBase | null {
  const bases = teachableBases();
  return (
    bases.find((b) => b.entry.conceptId === conceptId) ??
    bases.find((b) => principle !== null && b.entry.repairs === principle) ??
    bases[0] ??
    null
  );
}

/** A complete reading for this base, from Dee's guesses where they fit and the base's own values elsewhere. */
export function readingFor(base: TeachBase, guess: Partial<RuleReading>): RuleReading {
  const axis = base.axes.find((a) => a.axis === guess.axis) ?? base.axes[0];
  const own = levelOf(featuresOf(base.entry.base), axis.axis);
  const value = guess.value !== undefined && axis.values.includes(guess.value) ? guess.value : axis.values.includes(own) ? own : axis.values[0];
  const action = guess.action ?? 'aggressive';
  return { axis: axis.axis, value, action, otherwise: guess.otherwise ?? oppositeOf(action) };
}

// ── The contrast set ─────────────────────────────────────────────────────────

/** The engine's verdict on one spot: which plays hold up, and the grade of each. */
export interface SpotVerdict {
  /** Plays that hold up (grade severity 'free', its close band included). */
  readonly holds: readonly Move[];
  /** False when every play holds up: the spot says nothing about any rule. */
  readonly decisive: boolean;
  /** The grader's grade per play; null when the spot offers no action of that kind. */
  readonly grades: Readonly<Record<Move, Grade | null>>;
}

export interface TeachSpot {
  /** Stable within the set, for keys and the DOM. */
  readonly id: string;
  readonly variant: ContrastVariant;
  /** True when the spot sits at the rule's value: Dee plays the rule's play here. */
  readonly applies: boolean;
  /** Spots with the same pair index differ in exactly the rule's variable. */
  readonly pair: number;
  readonly verdict: SpotVerdict;
}

/** At most this many spots: three pairs, a few minutes' work (the Ticket's teach item is sized from it). */
export const TEACH_MAX_SPOTS = 6;

export type TeachSetResult =
  | { readonly ok: true; readonly spots: readonly TeachSpot[]; readonly anchorAxis: ContrastAxis | null }
  | { readonly ok: false; readonly reason: string };

/** The grader on one spot, for each play. Seeded so a set grades the same on every launch. */
export function engineVerdict(variant: ContrastVariant, seed: number): SpotVerdict {
  const legal = legalActions(variant.state);
  const grades = {} as Record<Move, Grade | null>;
  for (const move of MOVES) {
    const action = actionFor(move, legal);
    grades[move] = action === null ? null : gradeSpot(variant.state, action, { seed, modelFor: () => null });
  }
  const holds = MOVES.filter((m) => grades[m] !== null && grades[m]!.severity === 'free');
  return { holds, decisive: holds.length < MOVES.length, grades };
}

/**
 * The set: for each anchor (the base, then its one-variable neighbours on a second axis), the spot at the rule's
 * value and its nearest near-miss on the rule's axis. Each pair differs in exactly the rule's variable; the
 * anchors differ from one another in one other variable, so a rule that is right on one anchor and wrong on
 * another points at a second variable it does not name ("too broad").
 */
export function buildTeachSet(base: ContrastSpot, reading: RuleReading, seed: number, maxSpots: number = TEACH_MAX_SPOTS): TeachSetResult {
  if (!PRODUCIBLE_AXES.includes(reading.axis)) return { ok: false, reason: `${reading.axis} cannot be dealt in this build` };
  const rng = mulberry32(seed);
  const coverage = axisCoverage(base, seed);
  const others = PRODUCIBLE_AXES.filter((a) => a !== reading.axis && coverage[a] >= 2);
  const anchorAxis = others.length === 0 ? null : others[Math.floor(rng() * others.length)];
  const anchors: ContrastSpot[] = [base];
  if (anchorAxis !== null) {
    const result = generateContrastSet(base, anchorAxis, { seed, size: Math.min(coverage[anchorAxis], 3) });
    if (result.ok) anchors.push(...shuffle(result.set.variants.map((v) => v.spot), rng));
  }

  const order = axisLevels(reading.axis);
  const spots: Omit<TeachSpot, 'verdict'>[] = [];
  for (const [pair, anchor] of anchors.entries()) {
    if (spots.length + 2 > maxSpots) break;
    const size = Math.min(axisCoverage(anchor, seed + pair)[reading.axis], AXIS_MAX_SET_SIZE[reading.axis]);
    if (size < 2) continue;
    const result = generateContrastSet(anchor, reading.axis, { seed: seed + pair, size });
    if (!result.ok) continue;
    const members = [result.set.base, ...result.set.variants];
    const at = members.find((m) => levelOf(m.features, reading.axis) === reading.value);
    if (at === undefined) continue;
    const distance = (m: ContrastVariant): number => Math.abs(order.indexOf(levelOf(m.features, reading.axis)) - order.indexOf(reading.value));
    const near = members.filter((m) => m !== at).sort((a, b) => distance(a) - distance(b))[0];
    if (near === undefined) continue;
    spots.push({ id: `p${pair}-in`, variant: at, applies: true, pair });
    spots.push({ id: `p${pair}-out`, variant: near, applies: false, pair });
  }
  if (spots.length === 0) {
    return { ok: false, reason: `no spot here can be dealt at ${levelLabel(reading.axis, reading.value)} with a near-miss beside it` };
  }
  for (let i = 0; i < spots.length; i += 2) {
    const axes = differingAxes(spots[i].variant.features, spots[i + 1].variant.features);
    if (axes.length !== 1 || axes[0] !== reading.axis) throw new Error(`teachDee: pair ${i / 2} differs on [${axes.join(', ')}]`);
  }
  const graded = spots.map((s, i) => ({ ...s, verdict: engineVerdict(s.variant, seed + 100 + i) }));
  return { ok: true, spots: shuffle(graded, rng), anchorAxis };
}

/** Dee plays the rule: its play where the rule applies, the other play everywhere else. */
export function deeMove(spot: Pick<TeachSpot, 'applies'>, reading: RuleReading): Move {
  return spot.applies ? reading.action : reading.otherwise;
}

// ── Repair detection ─────────────────────────────────────────────────────────

export type Finding = 'holds' | 'wrong' | 'too-broad' | 'too-narrow' | 'no-flip' | 'other-half' | 'untested';

/** The findings that ask the learner to rewrite the sentence. */
export const REWRITE_FINDINGS: readonly Finding[] = ['wrong', 'too-broad', 'too-narrow', 'no-flip', 'other-half'];

export const FINDING_TITLES: Readonly<Record<Finding, string>> = {
  holds: 'The rule held',
  wrong: 'The rule plays the wrong move',
  'too-broad': 'The rule reaches too far',
  'too-narrow': 'The rule stops short',
  'no-flip': 'The variable does not move the answer',
  'other-half': 'The rule’s “everywhere else” play is wrong',
  untested: 'Nothing here tested the rule',
};

/** What the learner picks from when naming what went wrong (before the reveal). */
export const DIAGNOSIS_OPTIONS: readonly (readonly [Finding, string])[] = [
  ['wrong', 'Its play is wrong where it applies'],
  ['too-broad', 'It covers spots it should not'],
  ['too-narrow', 'It leaves out spots its play also fits'],
  ['no-flip', 'Its variable does not change the answer'],
  ['other-half', 'Its “everywhere else” play is wrong'],
];

export interface Repair {
  readonly finding: Finding;
  readonly needsRewrite: boolean;
  /** Spots with a verdict, and the ids of the ones where Dee's play did not hold up. */
  readonly judged: number;
  readonly misses: readonly string[];
  /**
   * The variable to name. For 'too-broad', the one variable (other than the rule's) that separates the spots the
   * rule got right from the ones it got wrong, when exactly one does; for 'no-flip', the rule's own variable.
   */
  readonly variable: ContrastAxis | null;
  /** For 'wrong': the plays that held up on every applying spot Dee missed (what the rule should say). */
  readonly enginePlays: readonly Move[];
  /** Spots where the learner's own play differed from the rule's (both committed). */
  readonly offRule: number;
}

/**
 * Read the rule's faults off the engine's verdicts. Order matters: a fault where the rule applies outranks one
 * in its "everywhere else" half, because the half the rule is about is the half it most needs right.
 *
 *  - untested:   no spot had a verdict, or no verdict depended on which half of the rule Dee played;
 *  - wrong:      Dee missed every applying spot that had a verdict;
 *  - too-broad:  Dee missed some applying spots and held others (a second variable splits them);
 *  - no-flip:    applying spots held, near-misses missed, and the rule's own play holds on every near-miss too;
 *  - too-narrow: as no-flip, but some near-miss really does want the other play (the line sits elsewhere);
 *  - other-half: near-misses missed where neither of the rule's plays holds up;
 *  - holds:      no miss, and at least one verdict turned on the rule's choice.
 */
export function detectRepair(
  spots: readonly TeachSpot[],
  reading: RuleReading,
  learner: Readonly<Record<string, Move>> = {},
): Repair {
  const judged = spots.filter((s) => s.verdict.decisive);
  const holds = (s: TeachSpot, m: Move): boolean => s.verdict.holds.includes(m);
  const missed = (s: TeachSpot): boolean => !holds(s, deeMove(s, reading));
  const inMiss = judged.filter((s) => s.applies && missed(s));
  const inHit = judged.filter((s) => s.applies && !missed(s));
  const outJudged = judged.filter((s) => !s.applies);
  const outMiss = outJudged.filter(missed);
  const offRule = spots.filter((s) => learner[s.id] !== undefined && learner[s.id] !== deeMove(s, reading)).length;
  const misses = [...inMiss, ...outMiss].map((s) => s.id);

  const result = (finding: Finding, variable: ContrastAxis | null = null, enginePlays: readonly Move[] = []): Repair => ({
    finding,
    needsRewrite: REWRITE_FINDINGS.includes(finding),
    judged: judged.length,
    misses,
    variable,
    enginePlays,
    offRule,
  });

  if (judged.length === 0) return result('untested');
  if (inMiss.length > 0 && inHit.length === 0) {
    const plays = MOVES.filter((m) => inMiss.every((s) => holds(s, m)));
    return result('wrong', null, plays);
  }
  if (inMiss.length > 0) return result('too-broad', separatingAxis(inMiss, inHit, reading.axis));
  if (outMiss.length > 0) {
    if (!outMiss.every((s) => holds(s, reading.action))) return result('other-half');
    if (outJudged.every((s) => holds(s, reading.action))) return result('no-flip', reading.axis);
    return result('too-narrow');
  }
  // No miss. It held only if some verdict depended on which half Dee played.
  const turned = judged.some((s) => !holds(s, s.applies ? reading.otherwise : reading.action));
  return result(turned ? 'holds' : 'untested');
}

/** The one variable, other than the rule's, on which every missed spot differs from every held one; else null. */
function separatingAxis(missed: readonly TeachSpot[], held: readonly TeachSpot[], ruleAxis: ContrastAxis): ContrastAxis | null {
  let common: ContrastAxis[] | null = null;
  for (const a of missed) {
    for (const b of held) {
      const axes = differingAxes(a.variant.features, b.variant.features).filter((x) => x !== ruleAxis);
      common = common === null ? axes : common.filter((x) => axes.includes(x));
    }
  }
  return common !== null && common.length === 1 ? common[0] : null;
}

// ── Seeds, records and the rewrite queue ─────────────────────────────────────

/** A set's seed: the rule and how often it has been taught, so a re-teach deals new cards and a replay the same. */
export function teachSeed(conceptId: string, text: string, priorSets: number): number {
  let h = 2166136261;
  for (const ch of `${conceptId}\u0000${text}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) + priorSets * 7919) >>> 0;
}

/** Append one finished set. Bounded; a set already on file (same `at`) changes nothing. */
export function recordTaught(state: TeachDeeState, set: TaughtSet): TeachDeeState {
  if (!Number.isFinite(set.at) || set.at <= 0 || state.sets.some((s) => s.at === set.at)) return state;
  return { sets: [...state.sets, set].sort((a, b) => a.at - b.at).slice(-MAX_TAUGHT_SETS) };
}

/** A stored finding, read by this build: a newer build's value asks for nothing. */
export function findingOf(value: string): Finding | null {
  return (['holds', 'wrong', 'too-broad', 'too-narrow', 'no-flip', 'other-half', 'untested'] as const).find((f) => f === value) ?? null;
}

/** The newest set per rule. */
export function latestSets(sets: readonly TaughtSet[]): Map<string, TaughtSet> {
  const out = new Map<string, TaughtSet>();
  for (const s of sets) {
    const prior = out.get(s.conceptId);
    if (prior === undefined || s.at >= prior.at) out.set(s.conceptId, s);
  }
  return out;
}

/**
 * Rules whose newest set asked for a rewrite that has not been written: no sentence for the rule landed after
 * the set (an accepted lexicon sentence after its moment, or a lesson rule on a later day). Oldest set first.
 */
export function rewritesDue(input: {
  readonly sets: readonly TaughtSet[];
  readonly lexicon: readonly LexiconAttempt[];
  readonly rules: readonly RememberedSentence[];
  readonly dayOf: DayKeyOf;
}): TaughtSet[] {
  const out: TaughtSet[] = [];
  for (const set of latestSets(input.sets).values()) {
    const finding = findingOf(set.finding);
    if (finding === null || !REWRITE_FINDINGS.includes(finding)) continue;
    const rewritten =
      input.lexicon.some((a) => a.conceptId === set.conceptId && a.outcome === 'accepted' && a.at > set.at) ||
      input.rules.some((r) => r.conceptId === set.conceptId && r.day > input.dayOf(set.at));
    if (!rewritten) out.push(set);
  }
  return out.sort((a, b) => a.at - b.at);
}

// ── Dee's lines ──────────────────────────────────────────────────────────────

/**
 * Slots a teach line can carry. Each is filled from the reading the learner set or from the engine's verdict,
 * never from Dee: `value` is a level label, `action` / `otherwise` / `dee` / `engine` are play words, `variable`
 * is an axis name.
 */
export const TEACH_SLOTS = ['value', 'action', 'otherwise', 'dee', 'engine', 'variable'] as const;
export type TeachSlot = (typeof TEACH_SLOTS)[number];
export type TeachFacts = Partial<Record<TeachSlot, string>>;

export type TeachEvent =
  | 'read'
  | 'agree'
  | 'disagree'
  | 'no-verdict'
  | 'diagnose'
  | 'rewrite'
  | `finding-${Finding}`;

/** One budget for every teach line: they sit beside a spot, so they are short. */
export const TEACH_WORD_BUDGET = 22;

export interface TeachLine {
  readonly id: string;
  readonly event: TeachEvent;
  readonly pose: DeePose;
  readonly text: string;
  readonly dry?: string;
  readonly blunt?: string;
}

export const TEACH_LINES: readonly TeachLine[] = [
  {
    id: 'teach.read.a',
    event: 'read',
    pose: 'listening',
    text: 'Got it. With {value}, I {action}. Anywhere else, I {otherwise}. Deal them.',
    dry: 'Understood. {value}: I {action}. Elsewhere I {otherwise}.',
    blunt: 'Fine. {value}, I {action}. Else I {otherwise}. Deal.',
  },
  {
    id: 'teach.read.b',
    event: 'read',
    pose: 'listening',
    text: 'So the rule is about {value}. There I {action}, and elsewhere I {otherwise}.',
    dry: 'The rule turns on {value}. There I {action}; elsewhere I {otherwise}.',
  },
  {
    id: 'teach.agree.a',
    event: 'agree',
    pose: 'glance',
    text: 'Played it from the rule, and the engine agrees.',
    dry: 'From the rule. The engine agrees.',
    blunt: 'Rule played. Engine agrees.',
  },
  {
    id: 'teach.agree.b',
    event: 'agree',
    pose: 'glance',
    text: 'The rule said {dee}, and that holds up here.',
    dry: 'The rule said {dee}. It holds up.',
  },
  {
    id: 'teach.disagree.a',
    event: 'disagree',
    pose: 'thinking',
    text: 'I played the rule: {dee}. The engine plays {engine} here.',
    dry: 'Rule said {dee}. Engine says {engine}.',
    blunt: 'I played {dee}. Engine plays {engine}.',
  },
  {
    id: 'teach.disagree.b',
    event: 'disagree',
    pose: 'thinking',
    text: 'That is what the rule told me: {dee}. Here the engine plays {engine}.',
    dry: 'The rule told me {dee}. The engine plays {engine} here.',
  },
  {
    id: 'teach.noverdict.a',
    event: 'no-verdict',
    pose: 'rest',
    text: 'The engine has no verdict on this spot. Any play holds up.',
    dry: 'No verdict here. Any play holds up.',
    blunt: 'No verdict. Any play holds.',
  },
  {
    id: 'teach.diagnose.a',
    event: 'diagnose',
    pose: 'thinking',
    text: 'Before the reveal: what went wrong with the rule?',
    dry: 'Before the reveal, name it: what went wrong with the rule?',
    blunt: 'What went wrong with the rule?',
  },
  {
    id: 'teach.rewrite.a',
    event: 'rewrite',
    pose: 'listening',
    text: 'Rewrite it so I play these right. Name the variable that moved the answer.',
    dry: 'Rewrite it. Name the variable that moved the answer.',
    blunt: 'Rewrite it. Name the variable.',
  },
  {
    id: 'teach.finding.holds',
    event: 'finding-holds',
    pose: 'glance',
    text: 'The rule held on every spot with a verdict. The card is polished.',
    dry: 'It held on every spot with a verdict. Card polished.',
    blunt: 'Held on every verdict. Card polished.',
  },
  {
    id: 'teach.finding.wrong',
    event: 'finding-wrong',
    pose: 'serious',
    text: 'Where the rule applies, {action} did not hold up. The engine plays {engine} there.',
    dry: 'Where it applies, {action} did not hold up. The engine plays {engine}.',
    blunt: '{action} did not hold up where it applies. Engine: {engine}.',
  },
  {
    id: 'teach.finding.toobroad',
    event: 'finding-too-broad',
    pose: 'thinking',
    text: 'The rule reaches too far: it held on some spots it covers and failed on others.',
    dry: 'It reaches too far: held on some of its spots, failed on others.',
    blunt: 'Too broad. Held on some of its spots, failed on others.',
  },
  {
    id: 'teach.finding.toonarrow',
    event: 'finding-too-narrow',
    pose: 'thinking',
    text: 'The rule stops short: {action} also held where it said {otherwise}.',
    dry: 'It stops short. {action} also held where it said {otherwise}.',
    blunt: 'It stops short: {action} held where it said {otherwise}.',
  },
  {
    id: 'teach.finding.noflip',
    event: 'finding-no-flip',
    pose: 'thinking',
    text: 'Here {variable} did not move the answer: {action} held on both sides.',
    dry: '{variable} did not move it. {action} held on both sides.',
    blunt: '{variable} did not change it. {action} held on both sides.',
  },
  {
    id: 'teach.finding.otherhalf',
    event: 'finding-other-half',
    pose: 'thinking',
    text: 'The rule’s fallback failed: outside it, {otherwise} did not hold up and nor did {action}.',
    dry: 'Its fallback failed: outside it, {otherwise} did not hold up, nor {action}.',
  },
  {
    id: 'teach.finding.untested',
    event: 'finding-untested',
    pose: 'rest',
    text: 'No verdict here turned on the rule. Try it on another spot.',
    dry: 'No verdict turned on the rule. Try another spot.',
    blunt: 'No verdict turned on it. Try another spot.',
  },
];

export interface SpokenTeachLine {
  readonly lineId: string;
  readonly pose: DeePose;
  readonly text: string;
}

function textForTone(line: TeachLine, tone: Tone): string {
  return (tone === 'dry' ? line.dry : tone === 'blunt' ? line.blunt : undefined) ?? line.text;
}

/** One line for an event, seeded among the lines that render from these facts; null when none does. */
export function teachLine(event: TeachEvent, tone: Tone, facts: TeachFacts, seed: number): SpokenTeachLine | null {
  const lines = TEACH_LINES.filter((l) => l.event === event);
  const rendered = lines
    .map((l) => ({ l, text: renderLine(textForTone(l, tone), facts as Facts) }))
    .filter((x): x is { l: TeachLine; text: string } => x.text !== null);
  if (rendered.length === 0) return null;
  const pick = rendered[Math.abs(Math.floor(seed)) % rendered.length];
  return { lineId: pick.l.id, pose: pick.l.pose, text: capitalise(pick.text) };
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
