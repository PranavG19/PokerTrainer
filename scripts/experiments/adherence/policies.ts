/**
 * EXPERIMENT 1 — hero policies.
 *
 * SCOPE: there is no spot bank and no solver in this repo, so none of this measures
 * solver-adherence. It measures adherence to the EV-loss grader that ships in
 * src/core/coach.ts. Every conclusion is about that grader, not about a solver.
 *
 * A policy is a pure function from a table state to a legal action. All randomness arrives
 * through an injected Rng (mulberry32) so a whole run is reproducible from its seeds.
 */
import type { Rng } from '../../../src/core/rng.js';
import type { Action, ActionKind, TableState } from '../../../src/core/table.js';
import { legalActions, minRaiseTo, maxRaiseTo } from '../../../src/core/table.js';
import { decideActionAs } from '../../../src/core/ai.js';
import { gradeDecision } from '../../../src/core/coach.js';
import { equityVsRandom } from '../../../src/core/equity.js';

export type PolicyName =
  | 'adherent-passive'
  | 'adherent-aggro'
  | 'tag-baseline'
  | 'tag-plus-grader'
  | 'wide-caller'
  | 'never-bluff-nit'
  | 'always-fold'
  | 'random-legal';

export const POLICY_NAMES: readonly PolicyName[] = [
  'adherent-passive',
  'adherent-aggro',
  'tag-baseline',
  'tag-plus-grader',
  'wide-caller',
  'never-bluff-nit',
  'always-fold',
  'random-legal',
];

export const POLICY_BLURB: Record<PolicyName, string> = {
  'adherent-passive':
    'Grader-adherent. Picks the legal action the coach grades as costing the fewest bb; ties broken passive-first.',
  'adherent-aggro':
    'Grader-adherent. Same minimum-EV-loss rule, ties broken aggression-first. Isolates how much of "adherence" is really the tie-break.',
  'tag-baseline':
    'Competent baseline: the shipped TAG bot logic played from the hero seat, grader never consulted. The control arm of the A/B below.',
  'tag-plus-grader':
    'The same TAG baseline, but whenever the coach grades the intended action non-free and some other legal action grades free, it switches. This is the grader as the student meets it — a veto over play they already had — and tag-plus-grader minus tag-baseline is the grader\'s marginal value in bb/100.',
  'wide-caller':
    'Deliberately off but plausible: calls every bet at any price, never folds while it can call, never bets.',
  'never-bluff-nit':
    'Deliberately off but plausible: value-bets only a near-lock, never bluffs, folds to any bet without 72% raw strength. Reads strength with ai.ts\'s own estimator, never the grader.',
  'always-fold': 'Control. Folds whenever folding is legal. Its bb/100 is analytically known, so it validates the harness.',
  'random-legal': 'Control. Uniform over the legal actions.',
};

/** Diagnostics collected while a hero decision is made. Only the adherent policies fill these. */
export interface DecisionTrace {
  street: string;
  legal: number;
  /** How many legal actions sat at the minimum graded EV loss. >1 means the tie-break chose, not the grader. */
  tiedAtMin: number;
  minLossBb: number;
  /** True when every legal action graded free (<0.5bb) — the grader had no opinion at all. */
  allFree: boolean;
  chosen: ActionKind;
  /** Whether an aggressive action was available at all, and whether it was in the tied minimum. */
  aggressionLegal: boolean;
  aggressionAtMin: boolean;
}

export interface PolicyContext {
  rng: Rng;
  /** Grader seed. Mirrors the renderer's `opts.seed + state.handNumber` so the coach behaves as shipped. */
  graderSeed: number;
  trace: DecisionTrace[];
}

export type Policy = (state: TableState, ctx: PolicyContext) => Action;

/** Bots size to 2/3 pot (ai.ts betPotFraction); the hero policies match so sizing is not a confound. */
const HERO_POT_FRACTION = 0.66;

function sizedAggression(state: TableState, kind: 'bet' | 'raise'): Action {
  const target = state.currentBet + Math.round(state.pot * HERO_POT_FRACTION);
  const amount = Math.min(Math.max(target, minRaiseTo(state)), maxRaiseTo(state));
  return { kind, amount };
}

function toAction(state: TableState, kind: ActionKind): Action {
  if (kind === 'bet' || kind === 'raise') return sizedAggression(state, kind);
  return { kind };
}

function firstLegal(legal: ActionKind[], preference: readonly ActionKind[]): ActionKind {
  for (const kind of preference) if (legal.includes(kind)) return kind;
  return legal[0];
}

// ── Grader-adherent ──────────────────────────────────────────────────────────

/**
 * All-in is ranked last in both tie-breaks. The grader scores 'allin' with the same branch as
 * 'bet'/'raise' — it never sees the amount — so a policy that preferred it would be shoving 100bb
 * on any 35% hand and would be measuring the grader's blindness to sizing rather than its advice.
 * Keeping it last means all-in is only chosen when it is the only way to continue.
 */
const PASSIVE_FIRST: readonly ActionKind[] = ['check', 'call', 'fold', 'bet', 'raise', 'allin'];
const AGGRO_FIRST: readonly ActionKind[] = ['bet', 'raise', 'call', 'check', 'fold', 'allin'];

const AGGRESSIVE: readonly ActionKind[] = ['bet', 'raise', 'allin'];

function adherent(preference: readonly ActionKind[]): Policy {
  return (state, ctx) => {
    const legal = legalActions(state);
    const hero = state.seats[state.toAct];
    const toCall = Math.max(0, state.currentBet - hero.committed);
    const opponents = state.seats.filter((s) => !s.folded && s.id !== hero.id).length;

    const losses = new Map<ActionKind, number>();
    for (const kind of legal) {
      const grade = gradeDecision({
        hole: hero.hole,
        board: state.board,
        street: state.street,
        pot: state.pot,
        toCall,
        stack: hero.stack,
        bb: state.bb,
        chosen: kind,
        opponents: Math.max(1, opponents),
        seed: ctx.graderSeed,
      });
      losses.set(kind, grade.evLossBb);
    }

    const minLoss = Math.min(...losses.values());
    const tied = legal.filter((kind) => losses.get(kind)! <= minLoss + 1e-9);
    const chosen = firstLegal(tied, preference);

    ctx.trace.push({
      street: state.street,
      legal: legal.length,
      tiedAtMin: tied.length,
      minLossBb: minLoss,
      allFree: Math.max(...losses.values()) < 0.5,
      chosen,
      aggressionLegal: AGGRESSIVE.some((k) => legal.includes(k)),
      aggressionAtMin: AGGRESSIVE.some((k) => tied.includes(k)),
    });

    return toAction(state, chosen);
  };
}

// ── Competent baseline, and the same baseline with the grader as a veto ──────

/**
 * The shipped TAG bot, driving the hero seat. decideActionAs is the exact function ai.ts uses for a
 * villain, so this arm has no bespoke strategy of its own to argue about: it is by construction as
 * good as the trainer's best opponent.
 */
const tagBaseline: Policy = (state, ctx) => decideActionAs('tag', state, state.toAct, ctx.rng);

/**
 * The grader as a student actually meets it: they already have a way to play, and the coach either
 * stays silent or objects. This arm takes the TAG action, grades it, and if the coach objects
 * (severity above free) it switches to a legal action the coach grades free — preferring the one
 * closest to the original intent so the switch is the smallest edit that satisfies the advice.
 *
 * This is the arm the product's promise actually rests on. The pure `adherent-*` arms answer a
 * different question — "is argmin over this grader a strategy?" — and it is not one.
 */
const tagPlusGrader: Policy = (state, ctx) => {
  const intended = decideActionAs('tag', state, state.toAct, ctx.rng);
  const hero = state.seats[state.toAct];
  const toCall = Math.max(0, state.currentBet - hero.committed);
  const opponents = state.seats.filter((s) => !s.folded && s.id !== hero.id).length;
  const grade = (chosen: ActionKind): number =>
    gradeDecision({
      hole: hero.hole,
      board: state.board,
      street: state.street,
      pot: state.pot,
      toCall,
      stack: hero.stack,
      bb: state.bb,
      chosen,
      opponents: Math.max(1, opponents),
      seed: ctx.graderSeed,
    }).evLossBb;

  const intendedLoss = grade(intended.kind);
  if (intendedLoss < 0.5) return intended; // coach silent: play as intended

  const legal = legalActions(state);
  // Nearest-intent order: keep aggression aggressive, keep passivity passive.
  const order: readonly ActionKind[] = AGGRESSIVE.includes(intended.kind)
    ? ['raise', 'bet', 'call', 'check', 'fold', 'allin']
    : ['check', 'call', 'fold', 'bet', 'raise', 'allin'];
  for (const kind of order) {
    if (kind === intended.kind || !legal.includes(kind)) continue;
    if (grade(kind) < 0.5) {
      ctx.trace.push({
        street: state.street,
        legal: legal.length,
        tiedAtMin: 1,
        minLossBb: intendedLoss,
        allFree: false,
        chosen: kind,
        aggressionLegal: AGGRESSIVE.some((k) => legal.includes(k)),
        aggressionAtMin: AGGRESSIVE.includes(kind),
      });
      return toAction(state, kind);
    }
  }
  return intended; // coach objected but offered nothing free — nothing to switch to
};

// ── Deliberately off but plausible ───────────────────────────────────────────

/** Calls too wide: pays any price, never folds while a call exists, never initiates. */
const wideCaller: Policy = (state) => {
  const legal = legalActions(state);
  if (legal.includes('check')) return { kind: 'check' };
  if (legal.includes('call')) return { kind: 'call' };
  if (legal.includes('allin')) return { kind: 'allin' }; // too short to call in full
  return { kind: 'fold' };
};

/**
 * Never bluffs and folds far too much: the nit archetype pushed past plausibility into a leak.
 * Deliberately does NOT consult the grader — it reads strength with the same 300-iteration estimator
 * ai.ts uses, so its badness is independent of the thing under test.
 *
 * Thresholds are far above ai.ts's nit (call 0.68 / raise 0.80): it value-bets only a near-lock and
 * pays only with a hand that beats a random holding three times out of four, price be damned.
 */
const NIT_CALL_STRENGTH = 0.72;
const NIT_BET_STRENGTH = 0.85;

const neverBluffNit: Policy = (state, ctx) => {
  const legal = legalActions(state);
  const hero = state.seats[state.toAct];
  const eq = equityVsRandom(hero.hole, state.board, 1, 300, Math.floor(ctx.rng() * 0xffffffff));
  const strength = eq.win + eq.tie * 0.5;

  if (strength >= NIT_BET_STRENGTH) {
    if (legal.includes('bet')) return sizedAggression(state, 'bet');
    if (legal.includes('raise')) return sizedAggression(state, 'raise');
  }
  if (legal.includes('check')) return { kind: 'check' };
  if (strength >= NIT_CALL_STRENGTH) {
    if (legal.includes('call')) return { kind: 'call' };
    if (legal.includes('allin')) return { kind: 'allin' };
  }
  return { kind: 'fold' };
};

// ── Controls ─────────────────────────────────────────────────────────────────

const alwaysFold: Policy = (state) => {
  const legal = legalActions(state);
  if (legal.includes('fold')) return { kind: 'fold' };
  return toAction(state, legal[0]);
};

const randomLegal: Policy = (state, ctx) => {
  const legal = legalActions(state);
  return toAction(state, legal[Math.floor(ctx.rng() * legal.length)]);
};

export const POLICIES: Record<PolicyName, Policy> = {
  'adherent-passive': adherent(PASSIVE_FIRST),
  'adherent-aggro': adherent(AGGRO_FIRST),
  'tag-baseline': tagBaseline,
  'tag-plus-grader': tagPlusGrader,
  'wide-caller': wideCaller,
  'never-bluff-nit': neverBluffNit,
  'always-fold': alwaysFold,
  'random-legal': randomLegal,
};
