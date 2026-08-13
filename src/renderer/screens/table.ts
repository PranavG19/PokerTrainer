import type { Card } from '../../core/cards.js';
import type { Action, ActionKind, Seat, TableState } from '../../core/table.js';
import {
  applyAction,
  createTable,
  isHandOver,
  legalActions,
  maxRaiseTo,
  minRaiseTo,
  settle,
  startHand,
} from '../../core/table.js';
import type { Grade, Severity } from '../../core/coach.js';
import { gradeDecision } from '../../core/coach.js';
import {
  ARCHETYPE_EXPLOITS,
  ARCHETYPE_NAMES,
  decideArchetypeAction,
  sessionProfile,
  type ArchetypeName,
  type ArchetypeProfile,
} from '../../core/archetypes.js';
import { visibleArchetypeLabel } from '../../core/jitter.js';
import { mulberry32, shuffle } from '../../core/rng.js';
import { createGiftLedger, type GiftEntry } from '../../core/giftLedger.js';
import { isCallingAction, recordHandGifts, type VillainCall } from '../../core/giftObserve.js';
import { quipFor } from '../../core/tableTalk.js';
import type { DecisionRecord, GradeRecord, HandRecord } from '../../core/session.js';
import type { Confidence, PredictOutcome } from '../../core/predict.js';
import { predictOutcome, predictResultText } from '../../core/predict.js';
import { routeFor } from '../../core/confidence.js';
import { applyG4Override, gateAttemptIsHit, gradeReason } from '../../core/reasonGrade.js';
import { renderCard, renderCardRow } from '../components/card.js';
import {
  clearGate,
  clearCoach,
  readGateInput,
  recordGateAttempts,
  renderCoachPanel,
  showGate,
  showGateRetry,
  showGrade,
  showReasonNote,
} from '../components/coachPanel.js';
import {
  clearPredictPanel,
  committedPrediction,
  committedReason,
  renderPredictPanel,
  resetCommit,
  setCommitVisible,
  showPredictResult,
} from '../components/predictPanel.js';
import { renderStatsSheet, toggleStatsSheet, updateStatsSheet } from '../components/statsSheet.js';

const SB = 25;
/** The big blind, exported so the caller can size a depth-derived starting stack in the same units. */
export const BB = 50;
/** The classic 100bb buy-in, exported as the affordability floor for a depth-derived deep stack. */
export const START_STACK = 5000;
const AI_DELAY_MS = 450;

/**
 * GATE — state 4 of the five-state protocol (PRODUCT-SPEC G5a). When the hero commits a coached
 * action whose coach severity is T2+ (notable/serious), the verdict is WITHHELD and the learner is
 * asked to name the mechanism in one line before the reveal. Up to two attempts inside a single
 * budget; the gate ALWAYS reveals on a passing attempt, on exhaustion, or on expiry (spec: "expiry
 * advances the state rather than failing the spot"). It never changes the verdict, never escalates
 * severity — it is a retrieval prompt at the moment of maximum error signal.
 */
const GATE_BUDGET_MS = 8000;
const GATE_MAX_ATTEMPTS = 2;
const GATE_PROMPT = 'In one line: what range or price drives this?';

/**
 * Villains sit at 1..3. Each session a seeded 3-of-6 shuffle (see selectRng below) picks which of
 * the six archetypes fills them, so the set is fixed for the whole table but varies by seed — over a
 * range of seeds all six appear at seat 1+, and the label stays classifiable as one opponent across
 * hands.
 */
const SEAT_NAMES = ['You', 'Ada', 'Bo', 'Cy'];

export interface TableHandle {
  root: HTMLElement;
  destroy: () => void;
}

export function renderTable(opts: {
  seed: number;
  bankroll: number;
  handNumber: number;
  /**
   * The hero's (and villains') starting stack in chips, so the table depth tracks the learner's earned
   * STANDING (a 200bb table is a genuinely different game than a 40bb one — the Depth climb payoff).
   * Absent means the classic 100bb table (START_STACK), which is what every test and a fresh/Calibrating
   * profile gets, so nothing changes unless a depth is explicitly wired in.
   */
  startStack?: number;
  coachedMode?: boolean;
  onHandComplete: (record: HandRecord) => void;
  onSessionOver?: () => void;
  onRebuy?: () => void;
  onPrediction?: (outcome: PredictOutcome, confidence: Confidence) => void;
  onCoachedModeChange?: (on: boolean) => void;
  /**
   * Called with each verdict at the moment it is shown, and with null when the table stops owning
   * one. The table does not know whether narration is on: the caller holds that preference and
   * decides, so this cannot go stale against a setting changed mid-session.
   */
  onVerdict?: (message: string | null) => void;
  /**
   * O5/story 34: the -EV villain calls this hand's showdown REVEALED, auto-populated so the ledger
   * cannot be inflated. Called once per completed hand with the gifts observed (empty for a hand that
   * revealed none), so the caller persists them. The table observes; it never scores — the ledger
   * derives every number from the revealed cards.
   */
  onGifts?: (gifts: readonly GiftEntry[]) => void;
}): TableHandle {
  // The depth-driven starting stack, defaulting to the classic 100bb table. A single local so the
  // initial deal, the bust top-up and the rebuy prompt all agree — a rebuy must match the table's depth.
  const startStack = opts.startStack ?? START_STACK;

  const root = document.createElement('div');
  root.className = 'table-screen';
  root.dataset.testid = 'table-screen';
  // GATE (state 4) sync oracle: 'open' while a self-explanation is pending, 'closed' otherwise. Waited
  // on by e2e because data-awaiting stays 'hero' while the gated action's application is deferred.
  root.dataset.gate = 'closed';

  // A screen-reader announcement channel for the coach verdict. The coach PANEL toggles `hidden`, which
  // pulls it from the accessibility tree — so an aria-live on the panel itself would not reliably
  // announce. This region is ALWAYS in the tree and only its text changes, which is the pattern SRs
  // announce dependably. It carries the same verdict string that drives voice narration (revealHeroGrade
  // → onVerdict), so the spoken, visual and screen-reader channels can never disagree. Visually hidden
  // (.visually-hidden) since sighted users read the panel; role=status = polite, non-interrupting.
  const announcer = document.createElement('div');
  announcer.className = 'visually-hidden';
  announcer.dataset.testid = 'coach-announcer';
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-live', 'polite');
  root.appendChild(announcer);

  // A SEPARATE polite region for the hand OUTCOME (who won, how much). It must not share the coach
  // region: a hero fold triggers the verdict and ends the hand in the same tick, so a shared region
  // would clobber the teaching verdict with the outcome and the SR user would never hear the verdict.
  // Two regions let a screen reader queue both announcements. Written once at settle, cleared on nextHand.
  const outcomeAnnouncer = document.createElement('div');
  outcomeAnnouncer.className = 'visually-hidden';
  outcomeAnnouncer.dataset.testid = 'outcome-announcer';
  outcomeAnnouncer.setAttribute('role', 'status');
  outcomeAnnouncer.setAttribute('aria-live', 'polite');
  root.appendChild(outcomeAnnouncer);

  // A THIRD polite region for the POT at STREET BOUNDARIES. A sighted player reads the pot off the felt
  // before sizing a bet; a screen-reader user got nothing. It fires only when the board grows (flop/turn/
  // river) — at most three times a hand — NOT on every bet, because a pot that re-announces on each chip
  // movement is noise a reader cannot use. Its own region for the same reason as the outcome one: a street
  // deal can coincide with a verdict, and a shared region would clobber the teaching output.
  const potAnnouncer = document.createElement('div');
  potAnnouncer.className = 'visually-hidden';
  potAnnouncer.dataset.testid = 'pot-announcer';
  potAnnouncer.setAttribute('role', 'status');
  potAnnouncer.setAttribute('aria-live', 'polite');
  root.appendChild(potAnnouncer);

  const seatsWrap = document.createElement('div');
  seatsWrap.className = 'seats';
  root.appendChild(seatsWrap);

  const centre = document.createElement('div');
  centre.className = 'table-centre';
  root.appendChild(centre);

  const potEl = document.createElement('div');
  potEl.className = 'pot';
  potEl.dataset.testid = 'pot';
  centre.appendChild(potEl);

  const boardWrap = document.createElement('div');
  boardWrap.dataset.testid = 'board';
  boardWrap.className = 'board-wrap';
  centre.appendChild(boardWrap);

  const heroWrap = document.createElement('div');
  heroWrap.className = 'hero-wrap';
  root.appendChild(heroWrap);

  const heroCards = document.createElement('div');
  heroCards.className = 'hero-cards';
  heroCards.dataset.testid = 'hero-cards';
  heroWrap.appendChild(heroCards);

  const coach = renderCoachPanel(() => submitGate());
  root.appendChild(coach);

  let coachedMode = opts.coachedMode === true;
  // Built once, but only in the DOM while coached mode is on: with it detached there is no panel
  // to query and no gate to leak, so uncoached play is byte-for-byte the old behaviour.
  // Committing must refresh the stats sheet too, not just the buttons: the withheld win% is
  // released by the same commitment that unlocks the actions.
  const predict = renderPredictPanel(() => {
    refreshStats();
    renderControls();
  });

  // Controls come before the stats sheet: at 760px tall the sheet would otherwise push the
  // action pills below the fold, leaving a player with no visible way to act.
  const controls = document.createElement('div');
  controls.className = 'controls';
  root.appendChild(controls);

  const stats = renderStatsSheet();
  toggleStatsSheet(stats, false);
  root.appendChild(stats);

  // ── mutable hand state ─────────────────────────────────────────────
  const table = createTable({
    seats: SEAT_NAMES.map((name, i) => ({
      name,
      stack: startStack,
      isHero: i === 0,
      avatar: name[0],
    })),
    sb: SB,
    bb: BB,
    seed: opts.seed,
  });
  // Continue the session's numbering. The shuffle is keyed on seed + handNumber, so restarting
  // at 1 on every re-mount would both duplicate handNumber in the saved log and re-deal a hand
  // the player has already seen.
  table.handNumber = opts.handNumber - 1;
  let state: TableState = startHand(table);

  // One long-lived stream so villain decisions stay deterministic across a session.
  const aiRng = mulberry32(opts.seed ^ 0x5eed);
  // A SEPARATE stream for the 3-of-6 archetype selection, so drawing which archetypes are seated
  // never advances aiRng — the villain-decision stream stays byte-identical in structure regardless
  // of which three were chosen. Pure function of opts.seed: same seed always seats the same three.
  const selectRng = mulberry32(opts.seed ^ 0x5e1ec7);
  const chosen = shuffle([...ARCHETYPE_NAMES], selectRng).slice(0, 3);
  // Fixed for the whole session (chosen once here, never per hand), matching jitter.ts's "per
  // session, not per hand" so a seat stays classifiable as one opponent across every hand.
  const seatArchetype = new Map<number, ArchetypeName>();
  const seatProfile = new Map<number, ArchetypeProfile>();
  for (let seat = 1; seat <= 3; seat++) {
    const name = chosen[seat - 1];
    seatArchetype.set(seat, name);
    // sessionProfile composes jitter.ts: a pure fn of (name, seed), so the jitter is per-session and
    // reproducible. Drawn once per seat and reused for every decision that seat makes this session.
    seatProfile.set(seat, sessionProfile(name, opts.seed));
  }
  let grades: GradeRecord[] = [];
  /** Every hero decision in order, captured pre-action so the review can replay the spot as seen. */
  let decisions: DecisionRecord[] = [];
  /**
   * How many community cards were on the board at the previous render, so render() can animate ONLY the
   * cards dealt since — a board diff. Without it, render() (which runs on every state change: pot, seat
   * action, coach reveal) rebuilds the whole board row and every card would re-fire its deal-in. Reset
   * to 0 per hand in nextHand so a fresh flop deals in. -1 initially so the very first paint of an empty
   * board is not treated as a deal.
   */
  let prevBoardLen = 0;
  /**
   * O5: every villain call this hand, captured PRE-action (the pot, board and price are overwritten
   * as the hand runs on). Reset per hand; resolved against the settled table at finishHand, where the
   * showdown decides which callers revealed and are therefore observable. Held cards are read from
   * the settled state, not captured here, so a caller who later folds contributes nothing.
   */
  let villainCalls: VillainCall[] = [];
  /** Session-lived so a gift's `seq` is monotonic across hands, matching giftLedger's contract. */
  const giftLedger = createGiftLedger();
  /**
   * The last action each villain seat took THIS hand, for the seat's speech bubble. Populated when a
   * villain acts, cleared each hand. In-hand the quip keys off the action kind ALONE (information-
   * free — the archetype label is hidden until showdown, tableTalk.ts's invariant), so this stores
   * only the kind, never the archetype.
   */
  const lastActionBySeat = new Map<number, ActionKind>();
  let heroVpip = false;
  let heroPfr = false;
  let heroStartStack = state.seats[0].stack + state.seats[0].committed;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;
  /**
   * True while the coach panel holds a verdict on a decision the hero has already made. A verdict
   * quotes the pot and to-call it graded, so leaving it up at the NEXT decision puts "Calling 50
   * into a 75 pot" a few pixels under a live "Pot 366" — two contradictory numbers for one
   * quantity, and the quoted figures are the strongest cue that the advice describes right now.
   * showGrade only overwrites when the new decision is itself gradeable, so a free decision after a
   * graded one used to leave the stale line up. It is cleared on the next decision rather than on a
   * street change because the pot moves within a street too (hero bets, villain raises). The
   * verdict still stays up for the whole villain phase, and for the hand's last decision it
   * survives showdown and handover, which is where it is actually read.
   */
  let adviceShown = false;

  /**
   * The open GATE (state 4), or null when no gate is up. Non-null means the hero has committed a T2+
   * action whose verdict is WITHHELD pending a self-explanation: `proceed` is the deferred continuation
   * that reveals the grade and applies the action, `attemptsUsed` counts submissions so far. While it
   * is non-null the action buttons and keyboard are locked (heroAct re-entry guard), and `state` is NOT
   * mutated — applyAction is deferred into `proceed`, so the pot/board the decision was made against
   * stay the pre-action readings the replay contract needs.
   */
  let gate: {
    readonly grade: Grade;
    readonly reasonText: string;
    readonly proceed: (attempts: 0 | 1 | 2) => void;
    attemptsUsed: 0 | 1 | 2;
  } | null = null;
  let gateTimer: ReturnType<typeof setTimeout> | null = null;

  const heroSeat = (): Seat => state.seats[0];

  function setAwaiting(v: 'hero' | 'ai' | 'handover'): void {
    root.dataset.awaiting = v;
  }

  /** In the DOM only while coached mode is on; kept directly above the controls it gates. */
  function syncPredictMount(): void {
    if (coachedMode) {
      if (predict.parentElement === null) root.insertBefore(predict, controls);
      // The commit row belongs to a pending decision. At handover there is none, and leaving it up
      // is both a dead control and 74px of height the 900x640 column cannot spare.
      setCommitVisible(predict, state.winners === null);
      return;
    }
    predict.remove();
    clearPredictPanel(predict);
  }

  function setCoachedMode(on: boolean): void {
    coachedMode = on;
    syncPredictMount();
    opts.onCoachedModeChange?.(on);
    render();
  }

  /** Grade the hero's decision. Pure of any panel effect, so the verdict can be WITHHELD behind a
   *  gate and revealed later without re-running the seeded Monte Carlo (a re-grade is a different
   *  number). */
  function computeHeroGrade(chosen: ActionKind, betSize?: number): Grade {
    const hero = heroSeat();
    const toCall = Math.max(0, state.currentBet - hero.committed);
    const opponents = state.seats.filter((s) => !s.folded && s.id !== hero.id).length;
    return gradeDecision({
      hole: hero.hole,
      board: state.board,
      street: state.street,
      pot: state.pot,
      toCall,
      stack: hero.stack,
      bb: state.bb,
      chosen,
      betSize,
      opponents: Math.max(1, opponents),
      seed: opts.seed + state.handNumber,
    });
  }

  /** Paint a computed grade into the coach panel — the REVEAL. Split out of the old recordHeroGrade so
   *  the GATE can defer this without changing a single line of what is shown. */
  function revealHeroGrade(grade: Grade, reasonText: string): void {
    showGrade(coach, grade);
    // G4 (story 14): grade the reason SEPARATELY and, if the action was EV-fine but the reason was a
    // hand-strength/none rationale, flag "right for the wrong reason" — escalating only on an explicit
    // guess. This never alters the EV grade or the predict outcome; it is its own verdict. Only graded
    // when a reason was actually typed, so an empty box never escalates. showReasonNote runs AFTER
    // showGrade because a free grade clears the panel, and the note may need to reveal it again.
    if (reasonText !== '') {
      const adjusted = applyG4Override({
        severityFromEv: grade.severity,
        reason: gradeReason(reasonText),
        graderSource: 'local',
      });
      showReasonNote(coach, adjusted);
    }
    adviceShown = grade.message !== null && grade.severity !== 'free';
    // Exactly the condition showGrade paints under, so narration and the panel can never disagree
    // about whether there is a verdict — one call per verdict shown, none for a silent grade.
    if (adviceShown) opts.onVerdict?.(grade.message);
    // Same condition, same string: announce the verdict to screen readers via the always-present live
    // region. A silent (free) grade announces nothing, matching the panel's silence rule exactly.
    announcer.textContent = adviceShown ? (grade.message ?? '') : '';
    if (grade.principle !== null) {
      grades.push({
        severity: grade.severity,
        principle: grade.principle,
        evLossBb: grade.evLossBb,
      });
    }
  }

  // ── GATE (state 4) ──────────────────────────────────────────────────
  /** The gate fires only in coached mode and only on a genuine mistake — coach severity T2+. Below
   *  that, or uncoached, the verdict reveals immediately as before. */
  function gateShouldFire(severity: Severity): boolean {
    return coachedMode && (severity === 'notable' || severity === 'serious');
  }

  /** Open the gate: withhold the verdict, prompt for the mechanism, and start the single shared budget.
   *  render() re-locks the action controls while the gate is up. */
  function openGate(grade: Grade, reasonText: string, proceed: (attempts: 0 | 1 | 2) => void): void {
    gate = { grade, reasonText, proceed, attemptsUsed: 0 };
    root.dataset.gate = 'open';
    showGate(coach, GATE_PROMPT, GATE_BUDGET_MS, GATE_MAX_ATTEMPTS);
    render();
    gateTimer = setTimeout(resolveGate, GATE_BUDGET_MS);
  }

  /** A submission. A range/price rationale resolves the gate immediately; anything weaker buys the one
   *  remaining attempt, then the second submission resolves regardless (the gate never fails the spot).
   *  The budget timer keeps running across both attempts — it is a per-gate budget, not per-attempt. */
  function submitGate(): void {
    if (gate === null) return;
    const hit = gateAttemptIsHit(gradeReason(readGateInput(coach)));
    gate.attemptsUsed = (gate.attemptsUsed + 1) as 1 | 2;
    if (hit || gate.attemptsUsed >= GATE_MAX_ATTEMPTS) {
      resolveGate();
      return;
    }
    // Missed on the first of two: re-prompt for the last attempt, same budget still ticking.
    showGateRetry(coach, gate.attemptsUsed, GATE_MAX_ATTEMPTS);
  }

  /** Reveal the withheld verdict and run the deferred continuation. Called on a passing attempt, on
   *  exhausting attempts, or on budget expiry — every path reveals. attempts is 0 only when the budget
   *  expired with no submission. */
  function resolveGate(): void {
    if (gate === null) return;
    if (gateTimer !== null) {
      clearTimeout(gateTimer);
      gateTimer = null;
    }
    const { attemptsUsed, proceed } = gate;
    // Publish the final attempt count on the panel BEFORE clearGate (clearGate leaves it in place for
    // the reveal, but the resolving submit itself never went through showGateRetry, so 0/1-attempt
    // resolutions would otherwise show a stale count).
    recordGateAttempts(coach, attemptsUsed);
    clearGate(coach);
    root.dataset.gate = 'closed';
    gate = null;
    proceed(attemptsUsed);
  }

  // One source of truth for the showdown outcome line, shared by the visible winner-summary panel and
  // the screen-reader announcement so the two can never disagree.
  function winnerSummaryText(): string {
    return (state.winners ?? [])
      .map((w) => `${state.seats[w.seatId].name} wins ${w.amount} (${w.description})`)
      .join(' · ');
  }

  function finishHand(): void {
    if (settled) return;
    settled = true;
    state = settle(state);
    setAwaiting('handover');
    // The hand's outcome reaches screen readers via its own polite region. Written once here at settle
    // (not in the per-render controls, which would re-announce every re-render) and cleared on nextHand.
    // Kept distinct from the coach region so a fold that both grades and ends the hand announces both.
    outcomeAnnouncer.textContent = winnerSummaryText();
    render();

    const hero = heroSeat();
    opts.onHandComplete({
      handNumber: state.handNumber,
      hole: hero.hole,
      board: state.board,
      net: hero.stack - heroStartStack,
      vpip: heroVpip,
      pfr: heroPfr,
      grades,
      decisions,
      // Stamped at completion (same clock the fading log uses) so the Progress week window is real.
      playedAt: Date.now(),
    });

    // O5: resolve the hand's captured villain calls against the SETTLED table, which fixes who
    // revealed. recordHandGifts filters to observable showdowns and the ledger scores each by exact
    // equity; onGifts fires only when the hand actually revealed a -EV call, so a gift-less hand
    // persists nothing.
    const gifts = recordHandGifts(giftLedger, state, villainCalls);
    if (gifts.length > 0) opts.onGifts?.(gifts);
  }

  function advance(): void {
    if (isHandOver(state)) {
      finishHand();
      return;
    }
    if (state.toAct === 0) {
      // A new decision: the previous verdict's pot and to-call no longer describe this spot.
      if (adviceShown) {
        clearCoach(coach);
        adviceShown = false;
        // The panel stops showing it, so the voice stops saying it. Narration that outlived the text
        // would be the one channel carrying information nothing on screen backs up.
        opts.onVerdict?.(null);
      }
      setAwaiting('hero');
      render();
      return;
    }
    setAwaiting('ai');
    render();
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      // toAct is a villain seat (1..3) here — seat 0 is handled by the branch above — so its profile
      // is always present; throw rather than silently skip if the invariant ever breaks.
      const profile = seatProfile.get(state.toAct);
      if (profile === undefined) throw new Error(`no archetype profile for seat ${state.toAct}`);
      // decideArchetypeAction throws if it is not this seat's turn; advance() guarantees it is. It
      // consumes aiRng in the same count/order as ai.ts's decideActionAs (three draws per decision),
      // so the long-lived stream advances identically — only the profile thresholds differ.
      const action = decideArchetypeAction(profile, state, state.toAct, aiRng);
      // O5 capture, PRE-action. Only a CALL against a live bet is scorable, so an all-in is captured
      // only when it is a call for the stack (its total does not exceed the current bet) — never a
      // raise-shove, which is aggression whose EV needs the fold equity a showdown does not record
      // (giftLedger's "why only calls"). The pot here is before this seat's chips go in (it already
      // holds the bettor's bet); cost is the seat's own contribution, capped at its stack for a short
      // all-in, the same min the engine applies (table.ts call/allin) — the price actually paid.
      if (isCallingAction(action.kind)) {
        const villain = state.seats[state.toAct];
        const isCallForStack = villain.committed + villain.stack <= state.currentBet;
        const scorable = action.kind === 'call' || isCallForStack;
        const cost = Math.min(state.currentBet - villain.committed, villain.stack);
        if (scorable && cost > 0) {
          villainCalls.push({
            handNumber: state.handNumber,
            villainSeatId: villain.id,
            villainName: villain.name,
            action: action.kind,
            board: [...state.board],
            street: state.street,
            potBefore: state.pot,
            cost,
          });
        }
      }
      // Table-talk: remember what this villain just did so its seat can show a line. Kind only —
      // the quip is information-free in-hand (tableTalk.ts), so nothing about the archetype is stored.
      lastActionBySeat.set(state.toAct, action.kind);
      state = applyAction(state, action);
      advance();
    }, AI_DELAY_MS);
  }

  function heroAct(action: Action): void {
    // `gate !== null` is the re-entry lock: while a gate is open the action is already committed and
    // its reveal deferred, so neither a button nor a keyboard shortcut may commit another.
    if (state.toAct !== 0 || settled || gate !== null) return;
    if (!legalActions(state).includes(action.kind)) return;
    // The lockout, not a hint: with no commitment the action does not happen at all, so the
    // keyboard shortcuts cannot walk around the disabled buttons either.
    const prediction = coachedMode ? committedPrediction(predict) : null;
    if (coachedMode && prediction === null) return;
    // Read the reason BEFORE the grade path and before resetCommit (in the continuation) clears it.
    // Empty in uncoached play, so the G4 path is coached-only by construction.
    const reasonText = coachedMode ? committedReason(predict) : '';

    if (state.street === 'preflop') {
      const hero = heroSeat();
      const voluntary = action.kind === 'call' || action.kind === 'raise' || action.kind === 'bet' || action.kind === 'allin';
      // The big blind's forced post is not voluntary; only extra chips count as VPIP.
      if (voluntary && hero.committed <= state.bb) heroVpip = true;
      if (action.kind === 'raise' || action.kind === 'bet') heroPfr = true;
    }

    const grade = computeHeroGrade(action.kind, action.amount);

    // Everything downstream of the grade — reveal, decision log, predict result, applying the action —
    // is deferred into this continuation. When the gate fires it runs after the self-explanation; when
    // it does not, it runs immediately. Captured by value from the PRE-action state (the pot/board the
    // hero decided against), because the gate holds `state` unmutated until this runs.
    const street = state.street;
    const board = [...state.board];
    const pot = state.pot;
    const toCall = Math.max(0, state.currentBet - heroSeat().committed);
    const gated = gateShouldFire(grade.severity);
    const proceed = (gateAttempts: 0 | 1 | 2): void => {
      revealHeroGrade(grade, reasonText);
      const decision: DecisionRecord = {
        street,
        board,
        pot,
        toCall,
        action: action.kind,
        amount: action.amount ?? null,
        verdict: { ...grade },
      };
      // Logged only when the gate actually fired; absent otherwise (matches the schema: absent = the
      // gate did not apply, never 0).
      if (gated) decision.gateAttempts = gateAttempts;
      decisions.push(decision);

      if (prediction !== null) {
        const outcome = predictOutcome(prediction, action.kind, grade.severity === 'free');
        const route = routeFor(prediction, outcome);
        showPredictResult(predict, outcome, predictResultText(prediction, action.kind, outcome), route);
        opts.onPrediction?.(outcome, prediction.confidence);
        // Fresh commitment for the next street; the reveal line stays up until the next hand.
        resetCommit(predict);
      }
      state = applyAction(state, action);
      advance();
    };

    if (gated) openGate(grade, reasonText, proceed);
    else proceed(0);
  }

  function nextHand(): void {
    if (pendingTimer !== null) clearTimeout(pendingTimer);
    // A gate always resolves before advance()/finishHand run (they live in its deferred tail), so no
    // hand normally starts with a gate open. This only guards a tab-switch-mid-gate: drop the
    // un-applied action and its pending timer exactly as a pending villain action would be dropped.
    if (gateTimer !== null) {
      clearTimeout(gateTimer);
      gateTimer = null;
    }
    gate = null;
    clearGate(coach);
    root.dataset.gate = 'closed';
    grades = [];
    decisions = [];
    villainCalls = [];
    // A new hand starts with an empty board; reset so the next flop deals in fresh.
    prevBoardLen = 0;
    lastActionBySeat.clear();
    heroVpip = false;
    heroPfr = false;
    settled = false;
    clearCoach(coach);
    // Clear the SR announcements too, so a new hand leaves neither last hand's verdict nor its outcome
    // nor its pot lingering in the a11y tree.
    announcer.textContent = '';
    outcomeAnnouncer.textContent = '';
    potAnnouncer.textContent = '';
    if (adviceShown) opts.onVerdict?.(null);
    adviceShown = false;
    clearPredictPanel(predict);
    state = startHand(state);
    heroStartStack = state.seats[0].stack + state.seats[0].committed;
    advance();
  }

  /**
   * Top the busted hero back up and deal on. Same table: handNumber, the dealer rotation and the
   * session's recorded stats all carry over, because only the hero's stack changed. nextHand()
   * re-reads heroStartStack after the top-up, so the next hand's `net` is measured from the table's
   * starting stack and the injected chips are never mistaken for a win.
   */
  function rebuyAndContinue(): void {
    if (heroSeat().stack !== 0) return;
    state.seats[0].stack = startStack;
    opts.onRebuy?.();
    nextHand();
  }

  // ── rendering ──────────────────────────────────────────────────────
  function render(): void {
    potEl.textContent = `Pot ${state.pot}`;

    // Board diff: rebuild the row (cheap), but tag only the cards dealt SINCE the last render as
    // data-deal-in so the CSS deal animation fires once per card as it arrives, not on every re-render
    // at the same street. A shrink (new hand resets prevBoardLen to 0) animates the next street's deal.
    const row = renderCardRow(state.board);
    if (state.board.length > prevBoardLen) {
      const cards = row.querySelectorAll<HTMLElement>('[data-testid="card"]');
      for (let i = prevBoardLen; i < cards.length; i++) cards[i].dataset.dealIn = 'true';
      // The board just grew (a new street was dealt) — announce the pot the player is now sizing against.
      // Only here, so a reader hears the pot at each street rather than on every intervening chip move.
      // Skipped at showdown (winners set): the outcome announcer already says who won how much.
      if (state.winners === null) potAnnouncer.textContent = `Pot ${state.pot}`;
    }
    prevBoardLen = state.board.length;
    boardWrap.replaceChildren(row);

    const hero = heroSeat();
    heroCards.replaceChildren(
      ...hero.hole.map((c: Card) => renderCard(c)),
    );

    const showdown = state.winners !== null;
    seatsWrap.replaceChildren(
      ...state.seats.map((seat) =>
        renderSeat(seat, state, showdown, seatArchetype, lastActionBySeat.get(seat.id)),
      ),
    );

    // The commit row tracks whether a decision is pending, so it must be re-synced every render,
    // not only when the toggle is clicked.
    syncPredictMount();

    refreshStats();

    renderControls();
  }

  /**
   * In coached mode the win% IS the answer, so showing it before the hero commits defeats the
   * gate: feedback effects collapse when the answer is available pre-response. Withhold it until
   * the prediction is in — an empty hole makes the sheet render "—" instead of a number.
   */
  function refreshStats(): void {
    const hero = heroSeat();
    // Withheld whenever the hand is live and the current decision is uncommitted — NOT just on the
    // hero's turn. Equity is constant within a street, so leaving the win% up while a villain thinks
    // hands the learner the answer before the action returns to them, and the gate does nothing.
    const withheld = coachedMode && !settled && committedPrediction(predict) === null;
    // A folded hero has no equity in the pot; showing a win% for a hand they are not contesting
    // teaches the opposite of "your fold ended your claim on this pot". Same at showdown: the board
    // is complete and the contesting hands are face-up, so the hero's chance is 0 or 1 and the
    // winner summary already says which. A Monte Carlo "96%" over a decided hand is simply false.
    const noStake = hero.folded || state.winners !== null;
    updateStatsSheet(stats, {
      hole: withheld || noStake ? [] : hero.hole,
      board: state.board,
      opponents: Math.max(1, state.seats.filter((s) => !s.folded && s.id !== 0).length),
      seed: opts.seed + state.handNumber,
    });
    stats.dataset.withheld = String(withheld);
  }

  function renderControls(): void {
    controls.replaceChildren();

    // Before the showdown branch so the toggle is reachable at every point in a hand.
    const modeToggle = pill(`Coach ${coachedMode ? 'on' : 'off'}`, 'coach-mode-toggle', () =>
      setCoachedMode(!coachedMode),
    );
    modeToggle.dataset.on = String(coachedMode);
    controls.appendChild(modeToggle);

    if (state.winners !== null) {
      const summary = document.createElement('div');
      summary.className = 'winner-summary';
      summary.dataset.testid = 'winner-summary';
      summary.textContent = winnerSummaryText();
      controls.appendChild(summary);

      // A busted hero sits out every future hand, so "Next hand" would be a no-op forever.
      // Offer a rebuy at the same table, or an explicit end of session — never a dead button.
      if (heroSeat().stack === 0) {
        const over = document.createElement('div');
        over.className = 'winner-summary';
        over.dataset.testid = 'session-over';
        over.textContent = `You are out of chips. Rebuy for ${startStack} to keep this table, or start a new session.`;
        controls.appendChild(over);
        controls.appendChild(pill(`Rebuy ${startStack}`, 'btn-rebuy', () => rebuyAndContinue()));
        controls.appendChild(
          pill('New session', 'new-session', () => opts.onSessionOver?.()),
        );
        return;
      }

      // The mirror case, and the one the busted-hero branch above missed by testing the wrong seat:
      // when the HERO holds every chip, each villain sits out, both blinds land on the hero, and the
      // hand is over before it deals — "Next hand" posts the blinds to itself forever with no
      // decision to make. Measured at 25 hands from the standard table with a station hero. Only
      // "New session" is offered because a rebuy tops up the hero, which is not who is short.
      if (state.seats.filter((seat) => seat.stack > 0).length < 2) {
        const swept = document.createElement('div');
        swept.className = 'winner-summary';
        swept.dataset.testid = 'table-swept';
        swept.textContent = 'You have every chip at this table — nobody is left to play. Start a new session.';
        controls.appendChild(swept);
        controls.appendChild(pill('New session', 'new-session', () => opts.onSessionOver?.()));
        return;
      }

      const next = pill('Next hand', 'next-hand', () => nextHand());
      controls.appendChild(next);
      return;
    }

    const legal = legalActions(state);
    const heroTurn = state.toAct === 0;
    const hero = heroSeat();
    const toCall = Math.max(0, state.currentBet - hero.committed);
    // Coached mode only: no committed prediction, no acting. Also greyed while a GATE is open — the
    // action is already committed and awaiting a self-explanation, so the pills lock (the heroAct
    // `gate !== null` guard is the real lockout; this is the visible half of it).
    const committed = (!coachedMode || committedPrediction(predict) !== null) && gate === null;

    const fold = pill('Fold', 'btn-fold', () => heroAct({ kind: 'fold' }));
    fold.disabled = !heroTurn || !committed || !legal.includes('fold');
    controls.appendChild(fold);

    const check = pill('Check', 'btn-check', () => heroAct({ kind: 'check' }));
    check.disabled = !heroTurn || !committed || !legal.includes('check');
    controls.appendChild(check);

    const call = pill(toCall > 0 ? `Call ${toCall}` : 'Call', 'btn-call', () =>
      heroAct({ kind: legal.includes('call') ? 'call' : 'allin' }),
    );
    call.disabled = !heroTurn || !committed || !(legal.includes('call') || legal.includes('allin'));
    controls.appendChild(call);

    const canRaise = legal.includes('raise') || legal.includes('bet');
    const min = canRaise ? minRaiseTo(state) : 0;
    const max = canRaise ? maxRaiseTo(state) : 0;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.dataset.testid = 'raise-slider';
    slider.className = 'raise-slider';
    slider.min = String(min);
    slider.max = String(max);
    slider.value = String(min);
    slider.disabled = !heroTurn || !canRaise || max <= min;
    // A range input announces only "slider" and a bare number without a name; label it, and mirror the
    // visible amount into aria-valuetext so a screen reader reads the chip count as it moves.
    slider.setAttribute('aria-label', 'Raise amount');
    slider.setAttribute('aria-valuetext', String(min));
    controls.appendChild(slider);

    const amountLabel = document.createElement('span');
    amountLabel.className = 'raise-amount';
    amountLabel.dataset.testid = 'raise-amount';
    amountLabel.textContent = String(min);
    slider.addEventListener('input', () => {
      amountLabel.textContent = slider.value;
      slider.setAttribute('aria-valuetext', slider.value);
    });
    controls.appendChild(amountLabel);

    const setPreset = (fraction: number): void => {
      const target = fraction === Infinity ? max : clamp(Math.round(state.pot * fraction), min, max);
      slider.value = String(target);
      amountLabel.textContent = slider.value;
      slider.setAttribute('aria-valuetext', slider.value);
    };

    // The ½/¾ glyphs are their own accessible name, which reads as a meaningless fraction; spell each
    // preset out. Pot/All-in already read fine but are labelled too for a consistent "Bet …" phrasing.
    const presets: [string, string, number, string][] = [
      ['½', 'preset-half', 0.5, 'Bet half pot'],
      ['¾', 'preset-threequarter', 0.75, 'Bet three-quarter pot'],
      ['Pot', 'preset-pot', 1, 'Bet pot'],
      ['All-in', 'preset-allin', Infinity, 'Bet all-in'],
    ];
    for (const [label, testid, fraction, ariaLabel] of presets) {
      const b = pill(label, testid, () => setPreset(fraction));
      b.setAttribute('aria-label', ariaLabel);
      b.disabled = !heroTurn || !canRaise;
      controls.appendChild(b);
    }

    const raise = pill('Raise', 'btn-raise', () => {
      const amount = clamp(parseInt(slider.value, 10) || min, min, max);
      heroAct({ kind: legal.includes('raise') ? 'raise' : 'bet', amount });
    });
    raise.disabled = !heroTurn || !committed || !canRaise;
    controls.appendChild(raise);

    const statsToggle = pill('Stats', 'stats-toggle', () => toggleStatsSheet(stats));
    controls.appendChild(statsToggle);
  }

  // ── keyboard (R3) ──────────────────────────────────────────────────
  function onKey(e: KeyboardEvent): void {
    if (state.toAct !== 0 || state.winners !== null) return;
    const legal = legalActions(state);
    const key = e.key.toLowerCase();
    if (key === 'f' && legal.includes('fold')) heroAct({ kind: 'fold' });
    else if (key === 'c') {
      if (legal.includes('check')) heroAct({ kind: 'check' });
      else if (legal.includes('call')) heroAct({ kind: 'call' });
      // Facing a bet bigger than the stack there is no 'call' — an all-in IS the call, which is
      // what btn-call does. Without this the C shortcut was silently dead in exactly that spot.
      else if (legal.includes('allin')) heroAct({ kind: 'allin' });
    } else if (key === 'r' && (legal.includes('raise') || legal.includes('bet'))) {
      heroAct({ kind: legal.includes('raise') ? 'raise' : 'bet', amount: minRaiseTo(state) });
    } else if (key === 'a' && legal.includes('allin')) heroAct({ kind: 'allin' });
  }
  window.addEventListener('keydown', onKey);

  // A restored coachedMode=true must arm the gate on the very first render, not only once the
  // toggle is clicked.
  syncPredictMount();
  advance();

  return {
    root,
    destroy: () => {
      if (pendingTimer !== null) clearTimeout(pendingTimer);
      if (gateTimer !== null) clearTimeout(gateTimer);
      window.removeEventListener('keydown', onKey);
      // Switching tabs unmounts the panel holding the verdict, so the voice reading it must stop too.
      if (adviceShown) opts.onVerdict?.(null);
    },
  };
}

function renderSeat(
  seat: Seat,
  state: TableState,
  showdown: boolean,
  seatArchetype: Map<number, ArchetypeName>,
  lastAction: ActionKind | undefined,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'seat';
  el.dataset.testid = 'seat';
  el.dataset.seatId = String(seat.id);
  // Out of the game, not out of this hand: a chipless seat is folded and dealt no cards by
  // startHand, so no cards plus no chips is the one state that only a sat-out seat can be in.
  const sittingOut = seat.stack === 0 && seat.hole.length === 0;
  if (seat.folded) el.dataset.folded = 'true';
  if (sittingOut) el.dataset.out = 'true';
  if (seat.allIn) el.dataset.allin = 'true';
  if (state.toAct === seat.id && state.winners === null) el.dataset.toAct = 'true';
  // At showdown the pod that took the pot carries the same mint ring the to-act pod wore while the
  // hand was live — the ring is never on two pods at once (to-act is guarded off once winners land),
  // so it reads as "the action resolved HERE". Mint marks the winner, matching the winner-summary
  // text below it, so no new colour enters the palette.
  if (state.winners?.some((w) => w.seatId === seat.id)) el.dataset.winner = 'true';

  const avatar = document.createElement('div');
  avatar.className = 'seat-avatar';
  avatar.textContent = seat.avatar;
  el.appendChild(avatar);

  const name = document.createElement('div');
  name.className = 'seat-name';
  name.textContent = seat.name;
  el.appendChild(name);

  if (!seat.isHero) {
    const name = seatArchetype.get(seat.id);
    if (name === undefined) throw new Error(`no archetype for villain seat ${seat.id}`);
    const trueLabel = ARCHETYPE_EXPLOITS[name].label;
    // O3: the label is hidden ('Unknown') mid-hand and revealed only once the hand has ended, so the
    // learner classifies from behaviour rather than reading the answer off the seat.
    const { revealed, text } = visibleArchetypeLabel(trueLabel, state.winners !== null);
    const tag = document.createElement('div');
    tag.className = 'seat-archetype';
    tag.dataset.testid = 'seat-archetype';
    tag.dataset.revealed = String(revealed);
    tag.textContent = text;
    // The tooltip must gate on reveal too: the exploit text names the archetype, so setting it
    // mid-hand would leak the label on hover — the exact thing O3 hides.
    tag.title = revealed ? ARCHETYPE_EXPLOITS[name].exploit : '';
    el.appendChild(tag);

    // Table-talk: a short line for the villain's last action. In-hand it is information-free (the
    // archetype is passed only once `revealed`, which gates on the same showdown flag O3 uses, so a
    // live-hand line never leaks the hidden label). The variant is a STABLE per-seat/street index, not
    // random, so a replay says the same things. Only shown when the seat has acted this hand.
    if (lastAction !== undefined) {
      const bubble = document.createElement('div');
      bubble.className = 'seat-talk';
      bubble.dataset.testid = 'seat-talk';
      bubble.dataset.revealed = String(revealed);
      bubble.textContent = quipFor(lastAction, revealed ? name : null, seat.id + state.board.length);
      el.appendChild(bubble);
    }
  }

  const stack = document.createElement('div');
  stack.className = 'seat-stack';
  stack.dataset.testid = 'seat-stack';
  stack.textContent = String(seat.stack);
  el.appendChild(stack);

  // In words, not just a dim: a stack reading 0 and the absence of hole cards are what a learner
  // has to infer "out of the game" from otherwise, and both also describe a seat that merely folded.
  if (sittingOut) {
    const out = document.createElement('div');
    out.className = 'seat-out';
    out.dataset.testid = 'seat-out';
    out.textContent = 'Out of chips';
    el.appendChild(out);
  }

  // Villain cards stay face-down until showdown; the hero always sees their own.
  if (seat.hole.length > 0) {
    const faceDown = !seat.isHero && !(showdown && !seat.folded);
    el.appendChild(renderCardRow(seat.hole, { faceDown, small: true }));
  }

  // Only while the hand is live. settle() pays every chip into a stack and zeroes the pot, but it
  // leaves seat.committed untouched on the fold-out path (applyAction jumps straight to showdown
  // without the street advance that clears it). Rendering it then puts a blind-chip pill in front
  // of a player for chips that are already back in their displayed stack — "Pot 0" beside a yellow
  // 15000, i.e. the same chips counted twice on one screen.
  if (seat.committed > 0 && state.winners === null) {
    const chips = document.createElement('div');
    chips.className = 'seat-committed';
    chips.dataset.testid = 'seat-committed';
    chips.textContent = String(seat.committed);
    el.appendChild(chips);
  }

  if (state.dealer === seat.id) {
    const btn = document.createElement('div');
    btn.className = 'dealer-button';
    btn.dataset.testid = 'dealer-button';
    btn.textContent = 'D';
    // The bare 'D' glyph reads as a meaningless letter; name it so the marker is announced.
    btn.setAttribute('aria-label', 'Dealer');
    el.appendChild(btn);
  }

  return el;
}

function pill(label: string, testid: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'pill';
  b.dataset.testid = testid;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
