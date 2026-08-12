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
import type { Grade } from '../../core/coach.js';
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
import { applyG4Override, gradeReason } from '../../core/reasonGrade.js';
import { renderCard, renderCardRow } from '../components/card.js';
import { renderCoachPanel, showGrade, showReasonNote, clearCoach } from '../components/coachPanel.js';
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
const BB = 50;
const START_STACK = 5000;
const AI_DELAY_MS = 450;

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
  const root = document.createElement('div');
  root.className = 'table-screen';
  root.dataset.testid = 'table-screen';

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

  const coach = renderCoachPanel();
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
      stack: START_STACK,
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

  function recordHeroGrade(chosen: ActionKind, betSize?: number, reasonText = ''): Grade {
    const hero = heroSeat();
    const toCall = Math.max(0, state.currentBet - hero.committed);
    const opponents = state.seats.filter((s) => !s.folded && s.id !== hero.id).length;
    const grade: Grade = gradeDecision({
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
    if (grade.principle !== null) {
      grades.push({
        severity: grade.severity,
        principle: grade.principle,
        evLossBb: grade.evLossBb,
      });
    }
    return grade;
  }

  function finishHand(): void {
    if (settled) return;
    settled = true;
    state = settle(state);
    setAwaiting('handover');
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
    if (state.toAct !== 0 || settled) return;
    if (!legalActions(state).includes(action.kind)) return;
    // The lockout, not a hint: with no commitment the action does not happen at all, so the
    // keyboard shortcuts cannot walk around the disabled buttons either.
    const prediction = coachedMode ? committedPrediction(predict) : null;
    if (coachedMode && prediction === null) return;
    // Read the reason BEFORE recordHeroGrade (which does not reset it) and before resetCommit below
    // clears it. Empty in uncoached play, so the G4 path is coached-only by construction.
    const reasonText = coachedMode ? committedReason(predict) : '';

    if (state.street === 'preflop') {
      const hero = heroSeat();
      const voluntary = action.kind === 'call' || action.kind === 'raise' || action.kind === 'bet' || action.kind === 'allin';
      // The big blind's forced post is not voluntary; only extra chips count as VPIP.
      if (voluntary && hero.committed <= state.bb) heroVpip = true;
      if (action.kind === 'raise' || action.kind === 'bet') heroPfr = true;
    }

    const grade = recordHeroGrade(action.kind, action.amount, reasonText);
    // Logged from the PRE-action state, which is still `state` here: the pot and board the hero was
    // looking at when they decided. The verdict is stored verbatim rather than re-derived later,
    // because gradeDecision runs a seeded Monte Carlo and a re-grade is a different number.
    decisions.push({
      street: state.street,
      board: [...state.board],
      pot: state.pot,
      toCall: Math.max(0, state.currentBet - heroSeat().committed),
      action: action.kind,
      amount: action.amount ?? null,
      verdict: { ...grade },
    });

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
  }

  function nextHand(): void {
    if (pendingTimer !== null) clearTimeout(pendingTimer);
    grades = [];
    decisions = [];
    villainCalls = [];
    lastActionBySeat.clear();
    heroVpip = false;
    heroPfr = false;
    settled = false;
    clearCoach(coach);
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
   * re-reads heroStartStack after the top-up, so the next hand's `net` is measured from 5000 and
   * the injected chips are never mistaken for a win.
   */
  function rebuyAndContinue(): void {
    if (heroSeat().stack !== 0) return;
    state.seats[0].stack = START_STACK;
    opts.onRebuy?.();
    nextHand();
  }

  // ── rendering ──────────────────────────────────────────────────────
  function render(): void {
    potEl.textContent = `Pot ${state.pot}`;

    boardWrap.replaceChildren(renderCardRow(state.board));

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
      summary.textContent = state.winners
        .map((w) => `${state.seats[w.seatId].name} wins ${w.amount} (${w.description})`)
        .join(' · ');
      controls.appendChild(summary);

      // A busted hero sits out every future hand, so "Next hand" would be a no-op forever.
      // Offer a rebuy at the same table, or an explicit end of session — never a dead button.
      if (heroSeat().stack === 0) {
        const over = document.createElement('div');
        over.className = 'winner-summary';
        over.dataset.testid = 'session-over';
        over.textContent = `You are out of chips. Rebuy for ${START_STACK} to keep this table, or start a new session.`;
        controls.appendChild(over);
        controls.appendChild(pill(`Rebuy ${START_STACK}`, 'btn-rebuy', () => rebuyAndContinue()));
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
    // Coached mode only: no committed prediction, no acting. `true` when the gate is open.
    const committed = !coachedMode || committedPrediction(predict) !== null;

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
    controls.appendChild(slider);

    const amountLabel = document.createElement('span');
    amountLabel.className = 'raise-amount';
    amountLabel.dataset.testid = 'raise-amount';
    amountLabel.textContent = String(min);
    slider.addEventListener('input', () => {
      amountLabel.textContent = slider.value;
    });
    controls.appendChild(amountLabel);

    const setPreset = (fraction: number): void => {
      const target = fraction === Infinity ? max : clamp(Math.round(state.pot * fraction), min, max);
      slider.value = String(target);
      amountLabel.textContent = slider.value;
    };

    const presets: [string, string, number][] = [
      ['½', 'preset-half', 0.5],
      ['¾', 'preset-threequarter', 0.75],
      ['Pot', 'preset-pot', 1],
      ['All-in', 'preset-allin', Infinity],
    ];
    for (const [label, testid, fraction] of presets) {
      const b = pill(label, testid, () => setPreset(fraction));
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
