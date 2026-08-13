import {
  applyAction,
  createTable,
  legalActions,
  minRaiseTo,
  startHand,
  type Action,
  type ActionKind,
  type Street,
  type TableState,
} from './table.js';
import { gradeDecision, type Grade } from './coach.js';
import {
  ARCHETYPE_NAMES,
  decideArchetypeAction,
  sessionProfile,
  type ArchetypeName,
  type ArchetypeProfile,
} from './archetypes.js';
import { mulberry32, shuffle, type Rng } from './rng.js';

/**
 * ASSESSMENT BLOCK ENGINE — the pure core behind the weekly assessment (P4/G2). A block is a fixed run
 * of REAL random-dealt hands (not puzzle scenarios) played with the coach graded but SILENT: the learner
 * gets no per-decision verdict, and a single score is revealed only at the end. Every hero decision is
 * graded by coach.gradeDecision — the SAME grader the live table uses (table.ts computeHeroGrade) — so
 * the recorded evLossBb is the real one.
 *
 * WHY random deals, not the puzzle library: the coach reasons about a single hand's equity versus a
 * random-hand villain, so it is only honest on the spot distribution it was calibrated for — the live
 * table's. Grading a puzzle scenario instead measured coach-vs-curriculum disagreement (a taught fold
 * for reverse-implied-odds reasons graded as an 8–14bb "blunder"), which is not the learner's skill.
 * See offsuit-coach-grading-scope.
 *
 * This host drives the same core primitives the table screen does — createTable/startHand/applyAction
 * for the engine, decideArchetypeAction for the villains, gradeDecision for the hero — so it reuses the
 * poker rules wholesale and re-implements only the thin "whose turn / next hand" orchestration. It owns
 * nothing pedagogical: it does not choose the hero's action (the caller does) and it does not re-grade.
 */

const HERO = 0;
const VILLAIN_SEATS = [1, 2, 3] as const;
const SEAT_COUNT = 4;
const START_STACK = 5000;
const SB = 25;
const BB = 50;
const SEAT_NAMES = ['You', 'V1', 'V2', 'V3'] as const;
/** A block cannot run forever if a hand somehow stalls; generous, never hit in normal play. */
const STEP_GUARD = 400;

/** A single hero decision the block is waiting on. The caller renders the hero's view from `table`. */
export interface AssessmentSpot {
  /** 0-based index of this decision within the whole block, for progress display. */
  readonly index: number;
  /** Which hand (1-based) of the block this decision belongs to. */
  readonly hand: number;
  /** The live table at the decision point. */
  readonly table: TableState;
  /** The actions the engine will accept here (from legalActions). */
  readonly legal: readonly ActionKind[];
  /** What it costs the hero to call right now, 0 when they can check. */
  readonly toCall: number;
}

/** The graded result of one hero decision, ready to persist as an AssessmentDecision. */
export interface AssessmentGrade {
  readonly index: number;
  readonly hand: number;
  readonly chosen: ActionKind;
  readonly grade: Grade;
  /** The street the decision was made on — carried so the standing score can require contested postflop spots. */
  readonly street: Street;
  /** What it cost the hero to continue (0 when a check was free) — carried for the standing CONTESTED filter. */
  readonly toCall: number;
}

export interface AssessmentBlockOptions {
  /** How many hands the block deals. */
  readonly size: number;
  /** Seed for the deck, the villain decisions, and the coach's Monte Carlo, so a block is reproducible. */
  readonly seed: number;
}

/**
 * A running assessment block. Construct it, read `current()` to render the spot the learner faces, call
 * `commit(action)` to grade that decision and advance, and read `isDone()` / `grades()` for the reveal.
 * All state is internal and mutated in place — the screen is a thin renderer over this, mirroring how the
 * table screen owns its TableState.
 */
export class AssessmentBlock {
  private readonly seed: number;
  private readonly size: number;
  private readonly table0: TableState;
  private readonly aiRng: Rng;
  private readonly seatProfile = new Map<number, ArchetypeProfile>();
  private readonly recorded: AssessmentGrade[] = [];
  private handNumber = 0;
  private state: TableState;
  private finished = false;

  constructor(options: AssessmentBlockOptions) {
    this.seed = options.seed;
    this.size = Math.max(1, Math.floor(options.size));

    this.table0 = createTable({
      seats: SEAT_NAMES.map((name, i) => ({
        name,
        stack: START_STACK,
        isHero: i === HERO,
        avatar: name[0],
      })),
      sb: SB,
      bb: BB,
      seed: options.seed,
    });

    // Mirror the live table's seeding: one long-lived villain-decision stream, a SEPARATE stream for the
    // 3-of-6 archetype selection so drawing which three are seated never perturbs the decision stream.
    this.aiRng = mulberry32(options.seed ^ 0x5eed);
    const selectRng = mulberry32(options.seed ^ 0x5e1ec7);
    const chosen = shuffle([...ARCHETYPE_NAMES], selectRng).slice(0, 3) as ArchetypeName[];
    for (const seat of VILLAIN_SEATS) {
      this.seatProfile.set(seat, sessionProfile(chosen[seat - 1], options.seed));
    }

    this.state = this.deal();
    this.advanceToHero();
  }

  /** The hero decision the block is currently waiting on, or null once the block is done. */
  current(): AssessmentSpot | null {
    if (this.isDone()) return null;
    return {
      index: this.recorded.length,
      hand: this.handNumber,
      table: this.state,
      legal: legalActions(this.state),
      toCall: this.heroToCall(),
    };
  }

  /**
   * Grade the learner's chosen action for the current spot and advance the block. The grade uses the
   * SAME coach input the live table builds. The engine then applies the learner's action, plays villains
   * to the next hero decision, and deals the next hand when this one ends. A no-op (returns null) once the
   * block is done or when called with no live spot.
   */
  commit(chosen: ActionKind): AssessmentGrade | null {
    const spot = this.current();
    if (spot === null) return null;
    const grade = this.gradeHere(chosen);
    const result: AssessmentGrade = {
      index: this.recorded.length,
      hand: this.handNumber,
      chosen,
      grade,
      street: this.state.street,
      toCall: this.heroToCall(),
    };
    this.recorded.push(result);

    this.state = applyAction(this.state, this.legalize(chosen));
    this.advanceToHero();
    return result;
  }

  isDone(): boolean {
    return this.finished;
  }

  /** Every graded decision so far, in play order. The reveal reads this. */
  grades(): readonly AssessmentGrade[] {
    return this.recorded;
  }

  /** Total hero decisions graded — the sample behind the block's mean EV loss. */
  get count(): number {
    return this.recorded.length;
  }

  /** How many hands the block will deal in total. */
  get plannedHands(): number {
    return this.size;
  }

  private heroToCall(): number {
    const hero = this.state.seats[HERO];
    return Math.max(0, this.state.currentBet - hero.committed);
  }

  private gradeHere(chosen: ActionKind): Grade {
    const hero = this.state.seats[HERO];
    const opponents = this.state.seats.filter((s) => !s.folded && s.id !== HERO).length;
    const betSize = chosen === 'bet' || chosen === 'raise' ? minRaiseTo(this.state) : undefined;
    return gradeDecision({
      hole: hero.hole,
      board: this.state.board,
      street: this.state.street,
      pot: this.state.pot,
      toCall: this.heroToCall(),
      stack: hero.stack,
      bb: this.state.bb,
      chosen,
      betSize,
      opponents: Math.max(1, opponents),
      // Same seed shape the live table uses, so the block's grading is deterministic.
      seed: this.seed + this.state.handNumber,
    });
  }

  /**
   * Deal the next hand. Each hand starts from a fresh 100bb table (table0 is never mutated by startHand,
   * which clones) — so no bust can end the block early and every spot is a clean 100bb decision — but the
   * BUTTON rotates so the hero is assessed across positions rather than always on the same seat. startHand
   * rotates the dealer +1 from its current value, so pre-setting it one behind the target seat lands the
   * button on a different seat each hand, cycling all four over four hands. handNumber threads the deck
   * seed (seed + handNumber) so each hand is a fresh, reproducible shuffle.
   */
  private deal(): TableState {
    this.handNumber += 1;
    this.table0.handNumber = this.handNumber - 1;
    this.table0.dealer = (this.handNumber - 2 + SEAT_COUNT) % SEAT_COUNT;
    return startHand(this.table0);
  }

  /** Play villains until the hero must act, the hand ends, or the block is complete. */
  private advanceToHero(): void {
    for (let guard = 0; guard < STEP_GUARD; guard += 1) {
      if (this.handEnded()) {
        if (this.handNumber >= this.size) {
          this.finished = true;
          return;
        }
        this.state = this.deal();
        continue;
      }
      if (this.state.toAct === HERO) return;
      const profile = this.seatProfile.get(this.state.toAct);
      if (profile === undefined) return; // defensive: an unseated actor cannot happen with 4 seats
      const action = decideArchetypeAction(profile, this.state, this.state.toAct, this.aiRng);
      this.state = applyAction(this.state, action);
    }
    // A hand that will not progress must not hang the block; end it here rather than loop forever.
    this.finished = true;
  }

  private handEnded(): boolean {
    return this.state.winners !== null || this.state.street === 'showdown' || legalActions(this.state).length === 0;
  }

  /** Coerce an intended action to a legal one for this state — the same helper the puzzle screen uses. */
  private legalize(kind: ActionKind, to?: number): Action {
    const legal = legalActions(this.state);
    if (kind === 'raise' || kind === 'bet') {
      if (legal.includes('raise')) return { kind: 'raise', amount: to ?? minRaiseTo(this.state) };
      if (legal.includes('bet')) return { kind: 'bet', amount: to ?? minRaiseTo(this.state) };
      return { kind: legal.includes('call') ? 'call' : legal.includes('check') ? 'check' : 'fold' };
    }
    if (kind === 'check' && !legal.includes('check')) return { kind: legal.includes('call') ? 'call' : 'fold' };
    if (kind === 'call' && !legal.includes('call')) return { kind: legal.includes('check') ? 'check' : 'fold' };
    return { kind };
  }
}
