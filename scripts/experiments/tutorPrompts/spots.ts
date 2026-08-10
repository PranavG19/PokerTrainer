/**
 * EXPERIMENT 4 — spot collection.
 *
 * Drives the REAL engine (src/core/table.ts, ai.ts, coach.ts, equity.ts) headless and seeded,
 * and assembles the Explainer/Interrogator payload described in PRODUCT-SPEC T3.
 *
 * Every number in a payload is computed here by engine code. Nothing is invented, and the
 * payload carries a `permittedNumerals` list so the guard's provenance check (T4.3) has an
 * explicit input set rather than a JSON blob to substring-match against.
 */
import type { Card } from '../../../src/core/cards.js';
import { RANKS, rankOf, suitOf, SUITS } from '../../../src/core/cards.js';
import { createTable, startHand, applyAction, legalActions, isHandOver, minRaiseTo, maxRaiseTo } from '../../../src/core/table.js';
import type { TableState, ActionKind } from '../../../src/core/table.js';
import { decideAction } from '../../../src/core/ai.js';
import { gradeDecision, potOddsRequired } from '../../../src/core/coach.js';
import type { Grade } from '../../../src/core/coach.js';
import { equityVsRandom, DISPLAY_ITERATIONS } from '../../../src/core/equity.js';
import { mulberry32 } from '../../../src/core/rng.js';

export type Tier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4';
export type ErrorTag = 'RANGE' | 'TEXTURE' | 'PRICE' | 'BLOCKERS' | 'SIZING' | 'DEPTH-POSITION' | 'PURITY';

/** G1 bands, verbatim from PRODUCT-SPEC. Preflop in absolute bb; postflop as a fraction of the
 *  pot as it stands before the learner's own action (the single denominator definition). */
export function severityTier(evLossBb: number, street: string, potBb: number): Tier {
  if (street === 'preflop') {
    if (evLossBb < 0.10) return 'T0';
    if (evLossBb < 0.35) return 'T1';
    if (evLossBb < 1.2) return 'T2';
    if (evLossBb <= 3.0) return 'T3';
    return 'T4';
  }
  const frac = potBb === 0 ? 0 : evLossBb / potBb;
  const bands: Record<string, [number, number, number, number]> = {
    flop: [0.03, 0.10, 0.25, 0.60],
    turn: [0.025, 0.09, 0.22, 0.55],
    river: [0.02, 0.08, 0.20, 0.50],
  };
  const b = bands[street] ?? bands.flop;
  if (frac < b[0]) return 'T0';
  if (frac < b[1]) return 'T1';
  if (frac < b[2]) return 'T2';
  if (frac <= b[3]) return 'T3';
  return 'T4';
}

/** G7 taxonomy, mapped from the principle the engine's grader already emits. Upstream wins. */
function errorTag(principle: string | null): ErrorTag {
  if (principle === 'ranges') return 'RANGE';
  if (principle === 'pot odds') return 'PRICE';
  if (principle === 'value or bluff') return 'SIZING';
  return 'PURITY';
}

/**
 * The principle the shipped grader WOULD have emitted, mirroring coach.ts's branch structure.
 *
 * Needed because coach.ts nulls `principle` whenever its own three-tier `severity` is 'free'
 * (evLoss < 0.5 bb), while PRODUCT-SPEC G1's five-tier bands put plenty of sub-0.5-bb decisions in
 * T1 and T2 (a 0.4 bb preflop error is T2). Reading grade.principle directly therefore handed the
 * tutor `principle: none, error tag: PURITY` on genuine T1/T2 spots. Re-derived here rather than
 * edited in coach.ts, which is read-only for this experiment.
 */
function derivedPrinciple(chosen: Action, equity: number, required: number, street: string, toCall: number): string | null {
  if (chosen === 'call') return equity >= required ? null : 'pot odds';
  if (chosen === 'fold') {
    if (toCall === 0) return null;
    return equity > required ? 'pot odds' : null;
  }
  if (chosen === 'check') {
    const late = street === 'turn' || street === 'river';
    return late && equity > 0.55 ? 'value or bluff' : null;
  }
  if (equity < 0.35 && toCall > 0) return 'ranges';
  if (equity >= 0.55) return null;
  if (equity < 0.35 && toCall === 0) return 'value or bluff';
  return null;
}

const POSITION_NAMES_4 = ['BTN', 'SB', 'BB', 'CO'];
function positionOf(state: TableState, seatId: number): string {
  const n = state.seats.length;
  const offset = (seatId - state.dealer + n) % n;
  return POSITION_NAMES_4[offset] ?? `SEAT${offset}`;
}

/**
 * One-variable neighbours of a holding, along the B6 contrast axes reachable without a solver.
 *
 * "Exactly one variable" means exactly one *axis*, not one *step*: the kicker axis is scanned
 * across every rank, so the nearest flipping hand can be several ranks away. The first version of
 * this searched only +-1/+-2 ranks and found a boundary for 0 of 356 spots, because a pot-odds gap
 * of 17% held vs 40% required cannot be closed by one rank of kicker.
 *
 * `blocked` is the BOARD only. Passing hero's own hole cards in it rejected every candidate — each
 * neighbour retains one hero card by construction — which is the second reason the boundary count
 * was 0/149 on the first stratified run.
 */
function neighbours(hole: Card[], blocked: Set<string>): { hand: Card[]; variable: string }[] {
  const [a, b] = hole;
  const ra = rankOf(a), rb = rankOf(b);
  const sa = suitOf(a), sb = suitOf(b);
  const out: { hand: Card[]; variable: string }[] = [];
  const push = (h: Card[], variable: string) => {
    if (h[0] === h[1]) return;
    if (blocked.has(h[0]) || blocked.has(h[1])) return;
    out.push({ hand: h, variable });
  };

  const aIsHi = RANKS.indexOf(ra) >= RANKS.indexOf(rb);
  const hiC = aIsHi ? a : b;
  const loC = aIsHi ? b : a;
  const hiIdx = RANKS.indexOf(rankOf(hiC));
  const loIdx = RANKS.indexOf(rankOf(loC));
  const hiSuit = suitOf(hiC);
  const loSuit = suitOf(loC);

  // suitedness
  if (sa === sb) {
    const alt = SUITS.find((s) => s !== sa && !blocked.has(rankOf(loC) + s));
    if (alt) push([hiC, rankOf(loC) + alt], 'suitedness');
  } else {
    push([hiC, rankOf(loC) + hiSuit], 'suitedness');
  }
  // kicker axis: every rank strictly below the top card
  for (let i = 0; i < hiIdx; i++) {
    if (i === loIdx) continue;
    push([hiC, RANKS[i] + loSuit], 'the kicker');
  }
  // top-card axis: every rank strictly above the low card
  for (let i = loIdx + 1; i < RANKS.length; i++) {
    if (i === hiIdx) continue;
    push([RANKS[i] + hiSuit, loC], 'the top card');
  }
  // pairing axis: make it a pair of the top rank
  const pairSuit = SUITS.find((s) => s !== hiSuit && !blocked.has(rankOf(hiC) + s));
  if (pairSuit) push([hiC, rankOf(hiC) + pairSuit], 'pairing the top card');
  return out;
}

export interface Spot {
  id: string;
  seed: number;
  handNumber: number;
  street: string;
  position: string;
  heroHole: Card[];
  board: Card[];
  chosen: ActionKind;
  legal: ActionKind[];
  /** Engine-computed. */
  grade: Grade;
  tier: Tier;
  tag: ErrorTag;
  potBb: number;
  toCallBb: number;
  stackBb: number;
  potSharePct: number;
  requiredPct: number;
  opponents: number;
  actionHistory: string[];
  boundary: { hand: string; variable: string; sharePct: number } | null;
  bestAlternative: { action: ActionKind; evLossBb: number };
  /** See derivedPrinciple: coach.ts nulls its own principle below 0.5 bb, which spans T1 and T2. */
  principle: string | null;
}

function bbFmt(chips: number, bb: number): number {
  return Math.round((chips / bb) * 10) / 10;
}

function handLabel(hole: Card[]): string {
  const [a, b] = hole;
  const ra = rankOf(a), rb = rankOf(b);
  const hi = RANKS.indexOf(ra) >= RANKS.indexOf(rb) ? ra : rb;
  const lo = RANKS.indexOf(ra) >= RANKS.indexOf(rb) ? rb : ra;
  if (ra === rb) return `${hi}${lo}`;
  return `${hi}${lo}${suitOf(a) === suitOf(b) ? 's' : 'o'}`;
}

/**
 * Collect graded decisions. For each hero node we grade EVERY legal action, which yields a natural
 * spread of tiers at one genuine node; then we keep the ones the caller's tier quota still needs.
 */
export function collectSpots(opts: { seeds: number[]; maxPerSeed?: number }): Spot[] {
  const spots: Spot[] = [];
  for (const seed of opts.seeds) {
    let state = createTable({
      seats: [
        { name: 'Hero', stack: 10000, isHero: true },
        { name: 'Ada', stack: 10000 },
        { name: 'Bo', stack: 10000 },
        { name: 'Cy', stack: 10000 },
      ],
      sb: 25,
      bb: 50,
      seed,
    });
    const rng = mulberry32(seed * 977 + 13);

    for (let hand = 0; hand < (opts.maxPerSeed ?? 6); hand++) {
      state = startHand(state);
      let guard = 0;
      while (!isHandOver(state) && guard++ < 200) {
        if (state.toAct === 0) {
          const hero = state.seats[0];
          const legal = legalActions(state);
          if (legal.length === 0) break;
          const toCall = Math.max(0, state.currentBet - hero.committed);
          const opponents = Math.max(1, state.seats.filter((s) => !s.folded && s.id !== 0).length);
          const gradeSeed = seed + state.handNumber;
          const eq = equityVsRandom(hero.hole, state.board, opponents, DISPLAY_ITERATIONS, gradeSeed);
          const share = eq.win + eq.tie * 0.5;
          const required = potOddsRequired(state.pot, toCall);

          const graded = legal.map((act) => ({
            act,
            grade: gradeDecision({
              hole: hero.hole,
              board: state.board,
              street: state.street,
              pot: state.pot,
              toCall,
              stack: hero.stack,
              bb: state.bb,
              chosen: act,
              betSize: act === 'bet' || act === 'raise' ? minRaiseTo(state) : undefined,
              opponents,
              seed: gradeSeed,
            }),
          }));
          // The cheapest NON-FOLD action. Folding costs 0 by coach.ts's rule whenever equity is
          // below the required share, so "cheapest overall" resolved to fold on almost every node
          // and gave the tutor "fold" as the recommended next action even on 99%-share river checks.
          const nonFold = graded.filter((g) => g.act !== 'fold');
          const cheapest = (nonFold.length ? nonFold : graded).reduce(
            (m, g) => (g.grade.evLossBb < m.grade.evLossBb ? g : m),
          );

          for (const { act, grade } of graded) {
            const potBb = state.pot / state.bb;
            const tier = severityTier(grade.evLossBb, state.street, potBb);
            const principle = grade.principle ?? derivedPrinciple(act, share, required, state.street, toCall);

            spots.push({
              id: `s${seed}h${state.handNumber}-${state.street}-${act}`,
              seed,
              handNumber: state.handNumber,
              street: state.street,
              position: positionOf(state, 0),
              heroHole: [...hero.hole],
              board: [...state.board],
              chosen: act,
              legal: [...legal],
              grade,
              tier,
              tag: errorTag(principle),
              principle,
              potBb: bbFmt(state.pot, state.bb),
              toCallBb: bbFmt(toCall, state.bb),
              stackBb: bbFmt(hero.stack, state.bb),
              potSharePct: Math.round(share * 100),
              requiredPct: Math.round(required * 100),
              opponents,
              actionHistory: [...state.log],
              boundary: null,
              bestAlternative: { action: cheapest.act, evLossBb: Math.round(cheapest.grade.evLossBb * 10) / 10 },
            });
          }

          // Advance the hand along a line that REACHES later streets. Advancing on the cheapest
          // action folded hero preflop almost every hand: 272 of 356 decisions were preflop and
          // the sample held 4 turn nodes and zero river nodes. Continuing (check, else call) is
          // both a plausible learner line and the only way turn/river nodes exist to grade.
          const cont = legal.includes('check') ? 'check' : legal.includes('call') ? 'call' : cheapest.act;
          state = applyAction(state, {
            kind: cont,
            amount: cont === 'bet' || cont === 'raise' ? minRaiseTo(state) : undefined,
          });
        } else {
          state = applyAction(state, decideAction(state, state.toAct, rng));
        }
      }
      // reseat busted stacks so the sample keeps flowing
      for (const s of state.seats) if (s.stack <= 0) s.stack = 10000;
    }
  }
  return spots;
}

/**
 * The boundary hand (T3's "boundary hand" + "flipping variable"): the nearest holding, differing
 * on exactly one contrast axis, whose verdict for the SAME action flips to free. Computed lazily
 * because each candidate costs a 2,000-iteration Monte Carlo run and only the sampled spots need it.
 */
export function computeBoundary(spot: Spot): Spot['boundary'] {
  if (spot.grade.evLossBb === 0) return null;
  const blocked = new Set<string>(spot.board);
  const bb = 50;
  const pot = spot.potBb * bb;
  const toCall = spot.toCallBb * bb;
  const eqSeed = spot.seed + spot.handNumber;
  const eq = equityVsRandom(spot.heroHole, spot.board, spot.opponents, DISPLAY_ITERATIONS, eqSeed);
  const share = eq.win + eq.tie * 0.5;

  let best: { hand: Card[]; variable: string; share: number } | null = null;
  for (const nb of neighbours(spot.heroHole, blocked)) {
    const nbEq = equityVsRandom(nb.hand, spot.board, spot.opponents, DISPLAY_ITERATIONS, eqSeed);
    const nbShare = nbEq.win + nbEq.tie * 0.5;
    const nbGrade = gradeDecision({
      hole: nb.hand, board: spot.board, street: spot.street, pot, toCall,
      stack: spot.stackBb * bb, bb, chosen: spot.chosen,
      betSize: spot.chosen === 'bet' || spot.chosen === 'raise' ? pot : undefined,
      opponents: spot.opponents, seed: eqSeed,
    });
    if (nbGrade.evLossBb > 0) continue;
    if (best === null || Math.abs(nbShare - share) < Math.abs(best.share - share)) {
      best = { hand: nb.hand, variable: nb.variable, share: nbShare };
    }
  }
  if (!best) return null;
  return { hand: handLabel(best.hand), variable: best.variable, sharePct: Math.round(best.share * 100) };
}

// ── Payload assembly ─────────────────────────────────────────────────────────

/** The Explainer payload (T3 row 1). Post-reveal, so solver/EV fields are permitted here. */
export interface ExplainerPayload {
  street: string;
  position: string;
  yourHand: string;
  board: string;
  potBb: number;
  toCallBb: number;
  yourAction: string;
  tier: Tier;
  evLossBb: string;
  errorTag: ErrorTag;
  principle: string;
  potSharePct: number;
  requiredSharePct: number;
  cheapestAction: string;
  classRwBb100: string;
  boundaryHand: string | null;
  flippingVariable: string | null;
  boundarySharePct: number | null;
  permittedNumerals: string[];
}

export function explainerPayload(spot: Spot, classRwBb100: number): ExplainerPayload {
  const p: ExplainerPayload = {
    street: spot.street,
    position: spot.position,
    yourHand: handLabel(spot.heroHole) + ` (${spot.heroHole.join(' ')})`,
    board: spot.board.length ? spot.board.join(' ') : '(none)',
    potBb: spot.potBb,
    toCallBb: spot.toCallBb,
    yourAction: spot.chosen,
    tier: spot.tier,
    evLossBb: spot.grade.evLossBb.toFixed(1),
    errorTag: spot.tag,
    principle: spot.principle ?? 'none',
    potSharePct: spot.potSharePct,
    requiredSharePct: spot.requiredPct,
    cheapestAction: spot.bestAlternative.action,
    classRwBb100: classRwBb100.toFixed(1),
    boundaryHand: spot.boundary?.hand ?? null,
    flippingVariable: spot.boundary?.variable ?? null,
    boundarySharePct: spot.boundary?.sharePct ?? null,
    permittedNumerals: [],
  };
  p.permittedNumerals = extractNumerals(JSON.stringify({ ...p, permittedNumerals: undefined }));
  return p;
}

export function extractNumerals(s: string): string[] {
  return [...new Set(s.match(/\d+(?:\.\d+)?/g) ?? [])];
}

export { handLabel };
