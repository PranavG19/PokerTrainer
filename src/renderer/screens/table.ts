import type { Card } from '../../core/cards.js';
import type { Action, ActionKind, Seat, Street, TableState } from '../../core/table.js';
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
import { VILLAIN_BETTING_RANGE } from '../../core/preflop.js';
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
import { seatSlots } from '../seatLayout.js';
import { beginFocusRestore } from '../focusRestore.js';
import {
  clearGate,
  clearCoach,
  readGateInput,
  recordGateAttempts,
  renderCoachPanel,
  showGate,
  showGateRetry,
  setCoachContext,
  showGrade,
  showReasonNote,
} from '../components/coachPanel.js';
import {
  clearPredictPanel,
  committedPrediction,
  committedReason,
  lendResult,
  reclaimResult,
  renderPredictPanel,
  resetCommit,
  setCommitVisible,
  showPredictResult,
} from '../components/predictPanel.js';
import { renderStatsSheet, toggleStatsSheet, updateStatsSheet } from '../components/statsSheet.js';
import { keycap } from '../components/glyphs.js';
import type { PredictedAction } from '../../core/predict.js';
import {
  NEW_SITTING,
  handEndEvent,
  recordHandInSitting,
  rememberLine,
  selectLine,
  sessionEndEvent,
  watchHand,
  type BeatDecision,
  type DeeContext,
  type DeeLineMemory,
  type DeeSitting,
} from '../../core/dee/engine.js';
import type { DeePose, SpokenLine } from '../../core/dee/types.js';
import { renderDee } from '../components/dee.js';
import { capturedAction } from '../../core/story/dossier.js';
import type { ChatDecision } from '../../core/dee/chat/types.js';

/**
 * Dee at the table (owner D7): no words in-hand, only the perch's pose; one line at hand end, after the reveal;
 * the sitting's summary when the sitting ends. The table never decides whether Dee talks: the engine applies
 * the silence rule, the frequency setting and Character off (core/dee/engine.ts).
 */
export interface TableDee {
  readonly context: DeeContext;
  readonly memory: DeeLineMemory;
  /** The cooldown clock and recent lines after each finished hand, to persist. */
  readonly onMemory: (memory: DeeLineMemory) => void;
  /** Hold (or release, with null) a pose on the title-bar perch. */
  readonly onPerch: (source: string, pose: DeePose | null) => void;
  /** The hero is to act (the perch does not blink then). */
  readonly onActing: (on: boolean) => void;
}

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
  /** What Dee chat may answer from: whether a hand is live, and the last finished hand's graded decisions. */
  chatContext: () => { live: boolean; lastHand: { handNumber: number; decisions: ChatDecision[] } | null };
  destroy: () => void;
}

/**
 * Story (D17): one villain seat of a chapter table, in place of the live table's regulars. The profile is the
 * session's (jittered once by the caller, O3); `streetProfiles` replaces it on the streets a chapter's rival
 * leans on (story/route.ts `tableFor`).
 */
export interface TableCastSeat {
  readonly name: string;
  readonly avatar: string;
  readonly archetype: ArchetypeName;
  readonly profile: ArchetypeProfile;
  readonly streetProfiles?: Readonly<Partial<Record<Street, ArchetypeProfile>>>;
  /** Shown on the seat once a hand ends. Null keeps the seat masked: its style label never shows. */
  readonly revealLabel: string | null;
}

/** One villain's hand, as the hero saw it: what they did, and their cards only if a showdown turned them up. */
export interface SettledSeat {
  readonly seatId: number;
  readonly name: string;
  readonly actions: readonly { street: Exclude<Street, 'showdown'>; kind: ActionKind; facingBet: boolean; potShare: number | null }[];
  /** Two or more hands were live at the end and this was one of them; null otherwise (a fold-out shows nothing). */
  readonly shown: readonly Card[] | null;
}

export interface SettledHand {
  readonly handNumber: number;
  readonly board: readonly Card[];
  readonly villains: readonly SettledSeat[];
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
  /**
   * The number of live hands the SESSION PLANNER allocated to this sitting (the plan's whole-task
   * block). When set, the session is bounded: after this many hands complete the table stops offering
   * "Next hand" and shows a planned-complete end-state instead, so the launched session honours the
   * plan rather than running forever. Absent → the classic unbounded table (every existing caller and
   * the plain New session path), so nothing changes unless a plan is threaded in.
   */
  handLimit?: number;
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
  /** Dee. Absent (tests, multiplayer) means no Dee at this table. */
  dee?: TableDee;
  /** Story: the villains at a chapter table. Absent = the live table and its regulars, unchanged (D17). */
  cast?: readonly TableCastSeat[];
  /** Story: each settled hand, with what every villain did and showed (the rival dossier's input). */
  onHandSettled?: (hand: SettledHand) => void;
  /** Story: the planned-complete end's note and button, in place of "New session". */
  sittingEnd?: { readonly note: string; readonly label: string; readonly testid: string };
  /** Open Dee chat (the handover's "Ask Dee", or `D` at handover). Absent: no chat entry at this table. */
  onAskDee?: () => void;
}): TableHandle {
  // The depth-driven starting stack, defaulting to the classic 100bb table. A single local so the
  // initial deal, the bust top-up and the rebuy prompt all agree — a rebuy must match the table's depth.
  const startStack = opts.startStack ?? START_STACK;

  const root = document.createElement('div');
  root.className = 'table-screen';
  root.dataset.testid = 'table-screen';
  // Sync oracle for the planned session bound: present only when the planner allocated a live-hand
  // count, so a default (unbounded) table can be told apart from a planned one. A positive limit
  // is required — a plan whose whole-task block was cut allocates no live hands, and a 0-hand bound
  // would end the session before it began, so those fall back to the unbounded table.
  if (opts.handLimit !== undefined && opts.handLimit > 0) root.dataset.handLimit = String(opts.handLimit);
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

  // A FOURTH polite region, for Dee's hand-end line. Its own for the same reason as the others: the hand's last
  // decision can bring a verdict, the outcome and Dee's line in one tick, and a shared region would drop two.
  // Written once at settle, cleared on nextHand.
  const deeAnnouncer = document.createElement('div');
  deeAnnouncer.className = 'visually-hidden';
  deeAnnouncer.dataset.testid = 'dee-announcer';
  deeAnnouncer.setAttribute('role', 'status');
  deeAnnouncer.setAttribute('aria-live', 'polite');
  root.appendChild(deeAnnouncer);

  // The stage holds the table itself — villains in scoreboard rows around the pot and board, the hero
  // plate at the bottom — so the dock and the teaching panels below it stay in flow (styles-glass.css).
  const stage = document.createElement('div');
  stage.className = 'table-stage';
  root.appendChild(stage);

  // The hero plate comes first in the document, as the hero's seat always did, so reading order (and
  // every seat query in document order) still runs seat 0, 1, 2, 3. Position is CSS, not DOM order.
  const heroWrap = document.createElement('div');
  heroWrap.className = 'hero-wrap';
  stage.appendChild(heroWrap);

  const seatsWrap = document.createElement('div');
  seatsWrap.className = 'seats';
  stage.appendChild(seatsWrap);

  const centre = document.createElement('div');
  centre.className = 'table-centre';
  stage.appendChild(centre);

  // The pot is the score: a small label over a large figure. Two spans with a space between keep the
  // element's text "Pot N" for readers and tests.
  const potEl = document.createElement('div');
  potEl.className = 'pot';
  potEl.dataset.testid = 'pot';
  const potLabel = document.createElement('span');
  potLabel.className = 'pot-label';
  potLabel.textContent = 'Pot';
  const potValue = document.createElement('span');
  potValue.className = 'pot-value';
  potEl.append(potLabel, ' ', potValue);
  centre.appendChild(potEl);

  const boardWrap = document.createElement('div');
  boardWrap.dataset.testid = 'board';
  boardWrap.className = 'board-wrap';
  centre.appendChild(boardWrap);

  // The table's corners: the blinds as metadata on the left; on the right the win/tie readout, the
  // Coach switch and the Stats text button — table settings, off the action dock. Built once, so the
  // switch animates and focus survives every render.
  const cornerLeft = document.createElement('div');
  cornerLeft.className = 'table-corner table-corner-l';
  const blinds = document.createElement('span');
  blinds.className = 'g-caption g-num';
  blinds.textContent = `Blinds ${SB}/${BB}`;
  cornerLeft.appendChild(blinds);
  stage.appendChild(cornerLeft);

  const cornerRight = document.createElement('div');
  cornerRight.className = 'table-corner table-corner-r';
  stage.appendChild(cornerRight);

  const coachSwitch = document.createElement('button');
  coachSwitch.type = 'button';
  coachSwitch.className = 'g-switch';
  coachSwitch.dataset.testid = 'coach-mode-toggle';
  coachSwitch.setAttribute('role', 'switch');
  const switchTrack = document.createElement('span');
  switchTrack.className = 'g-switch-track';
  switchTrack.setAttribute('aria-hidden', 'true');
  coachSwitch.append('Coach', switchTrack);
  coachSwitch.addEventListener('click', () => setCoachedMode(!coachedMode));

  const statsToggle = document.createElement('button');
  statsToggle.type = 'button';
  statsToggle.className = 'pill quiet sm';
  statsToggle.dataset.testid = 'stats-toggle';
  statsToggle.textContent = 'Stats';
  statsToggle.addEventListener('click', () => toggleStatsSheet(stats));
  statsToggle.setAttribute('aria-expanded', 'false');

  const heroCards = document.createElement('div');
  heroCards.className = 'hero-cards';
  heroCards.dataset.testid = 'hero-cards';
  heroWrap.appendChild(heroCards);

  const coach = renderCoachPanel(() => submitGate());
  root.appendChild(coach);

  /*
   * THE COACHED SHEET (the mock's gate and verdict sheets). In coached mode the coach panel lives in a
   * sheet that rises over the table stage: the stage dims and goes inert behind it, and the tray/dock
   * below stay live — so "Next hand" at handover, and the next decision's commit, are never behind a
   * modal, and every existing flow (the gate's 8s budget and Enter-to-submit, the verdict cleared at the
   * next decision, the announcer) is unchanged. Opening moves focus into the sheet (the gate's answer
   * field, or the sheet itself for a verdict); Close or Esc dismisses a verdict and returns focus to the
   * first live control. Uncoached, the coach panel stays inline above the dock, as before.
   */
  const sheetLayer = document.createElement('div');
  sheetLayer.className = 'coach-layer';
  sheetLayer.hidden = true;
  const scrim = document.createElement('div');
  scrim.className = 'coach-scrim';
  scrim.setAttribute('aria-hidden', 'true');
  const sheet = document.createElement('section');
  sheet.className = 'coach-sheet';
  sheet.dataset.testid = 'coach-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Coach');
  sheet.tabIndex = -1;
  // The second half of a verdict: what the hero committed to, then the reveal line (lent by the tray).
  const sheetPredict = document.createElement('div');
  sheetPredict.className = 'coach-sheet-predict';
  const sheetCommit = document.createElement('div');
  sheetCommit.className = 'coach-sheet-commit';
  sheetCommit.dataset.testid = 'verdict-commit';
  sheetPredict.appendChild(sheetCommit);
  const sheetFoot = document.createElement('div');
  sheetFoot.className = 'coach-sheet-foot';
  const sheetCaption = document.createElement('span');
  sheetCaption.className = 'g-caption';
  const sheetClose = document.createElement('button');
  sheetClose.type = 'button';
  sheetClose.className = 'pill primary';
  sheetClose.dataset.testid = 'coach-close';
  sheetClose.append('Close', keycap('esc'));
  sheetClose.setAttribute('aria-keyshortcuts', 'Escape');
  sheetClose.addEventListener('click', () => dismissVerdict());
  sheetFoot.append(sheetCaption, sheetClose);
  /** Dee's hand-end line, perched on the verdict sheet when the hand ends behind it. */
  const sheetDee = document.createElement('div');
  sheetDee.className = 'coach-sheet-dee';
  sheetDee.hidden = true;
  sheetLayer.append(scrim, sheet);
  /** 'gate' while a gate is up, 'verdict' while a coached verdict is shown, else null. */
  let sheetKind: 'gate' | 'verdict' | null = null;
  /** The prediction behind the verdict on show, for the sheet's "You committed to …" line. */
  let sheetPrediction: { action: PredictedAction; confidence: Confidence } | null = null;

  let coachedMode = opts.coachedMode === true;
  // Built once, but only in the DOM while coached mode is on: with it detached there is no panel
  // to query and no gate to leak, so uncoached play is byte-for-byte the old behaviour.
  // Committing must refresh the stats sheet too, not just the buttons: the withheld win% is
  // released by the same commitment that unlocks the actions.
  const predict = renderPredictPanel(() => {
    refreshStats();
    syncPredictMount();
    renderControls();
  });
  // While the reason is typed, Dee's lights glance at it, from the perch only.
  predict.addEventListener('focusin', (e) => {
    if ((e.target as HTMLElement).dataset?.testid === 'reason-input') perch('reason', 'glance');
  });
  predict.addEventListener('focusout', (e) => {
    if ((e.target as HTMLElement).dataset?.testid === 'reason-input') perch('reason', null);
  });

  // Controls come before the stats sheet: at 760px tall the sheet would otherwise push the
  // action pills below the fold, leaving a player with no visible way to act.
  const controls = document.createElement('div');
  controls.className = 'controls';
  root.appendChild(controls);

  // The stats readout lives in the table's top-right corner: the win/tie line always shown, the made-hand
  // list opening under it as a small float.
  const stats = renderStatsSheet();
  stats.addEventListener('stats-toggle', (e) =>
    statsToggle.setAttribute('aria-expanded', String((e as CustomEvent<boolean>).detail)),
  );
  toggleStatsSheet(stats, false);
  cornerRight.append(stats, coachSwitch, statsToggle);

  // ── mutable hand state ─────────────────────────────────────────────
  const cast = opts.cast;
  const seatNames = cast ? ['You', ...cast.map((c) => c.name)] : SEAT_NAMES;
  const table = createTable({
    seats: seatNames.map((name, i) => ({
      name,
      stack: startStack,
      isHero: i === 0,
      avatar: i > 0 && cast ? cast[i - 1].avatar : name[0],
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
  /** Story only: a street's profile in place of the session's, and the label a seat reveals (null = masked). */
  const seatStreetProfiles = new Map<number, Readonly<Partial<Record<Street, ArchetypeProfile>>>>();
  const seatReveal = new Map<number, string | null>();
  if (cast) {
    cast.forEach((c, i) => {
      seatArchetype.set(i + 1, c.archetype);
      seatProfile.set(i + 1, c.profile);
      if (c.streetProfiles) seatStreetProfiles.set(i + 1, c.streetProfiles);
      seatReveal.set(i + 1, c.revealLabel);
    });
  } else {
    for (let seat = 1; seat <= 3; seat++) {
      const name = chosen[seat - 1];
      seatArchetype.set(seat, name);
      // sessionProfile composes jitter.ts: a pure fn of (name, seed), so the jitter is per-session and
      // reproducible. Drawn once per seat and reused for every decision that seat makes this session.
      seatProfile.set(seat, sessionProfile(name, opts.seed));
    }
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
  /** Story: every villain action this hand, captured pre-action, for `onHandSettled`. Reset per hand. */
  let villainActions = new Map<number, SettledSeat['actions'][number][]>();
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

  // ── Dee ─────────────────────────────────────────────────────────────
  /** The hand's hero decisions as Dee's engine reads them, captured at each reveal. */
  let beatDecisions: BeatDecision[] = [];
  let sitting: DeeSitting = NEW_SITTING;
  let deeMemory: DeeLineMemory = opts.dee?.memory ?? { handsWatched: 0, said: [] };
  /** The hand-end beat on show (built once at settle, so a re-render does not replay its hop). */
  let beatEl: HTMLElement | null = null;
  /** The sitting's summary, once the sitting is over. */
  let sessionEl: HTMLElement | null = null;
  const perch = (source: string, pose: DeePose | null): void => opts.dee?.onPerch(source, pose);

  /**
   * The beat as the mock draws it (demo/vision/table.html, "great" and "mistake"): Dee at 44px, the line at
   * headline size with a short lead sentence ("Price held.", "Noted.") in bold, and the hand's outcome as the
   * caption under it. The same element moves into the verdict sheet while one is open at hand end.
   */
  function deeLineEl(line: SpokenLine, testid: string, size: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'dee-beat';
    el.dataset.testid = testid;
    el.dataset.lineId = line.lineId;
    el.dataset.event = line.event;
    el.dataset.pose = line.pose;
    const body = document.createElement('div');
    body.className = 'dee-beat-body';
    const text = document.createElement('p');
    text.className = 'dee-beat-line';
    text.dataset.testid = `${testid}-line`;
    const lead = /^([^.?!]{1,24}[.?!])\s+(.+)$/.exec(line.text);
    if (lead && lead[1].split(/\s+/).length <= 3) {
      const b = document.createElement('b');
      b.textContent = lead[1];
      text.append(b, ` ${lead[2]}`);
    } else text.textContent = line.text;
    body.append(text);
    el.append(renderDee(line.pose, size), body);
    return el;
  }

  /** Say one line: remember it against the cooldown clock and announce it. */
  function say(line: SpokenLine | null, testid: string): HTMLElement | null {
    if (line === null) return null;
    deeMemory = rememberLine(deeMemory, line.lineId);
    deeAnnouncer.textContent = `Dee: ${line.text}`;
    return deeLineEl(line, testid, 44);
  }

  /** The last finished hand's decisions, for Dee chat. Kept until the next hand finishes. */
  let lastHandChat: { handNumber: number; decisions: ChatDecision[] } | null = null;
  function rememberHandForChat(): void {
    lastHandChat = {
      handNumber: state.handNumber,
      decisions: beatDecisions.map((d) => ({
        street: d.street,
        action: d.action,
        pot: d.pot,
        toCall: d.toCall,
        grade: { severity: d.grade.severity, evLossBb: d.grade.evLossBb, principle: d.grade.principle, price: d.grade.price, spot: d.grade.spot },
      })),
    };
  }

  function sittingOver(): boolean {
    if (heroSeat().stack === 0) return true;
    if (state.seats.filter((seat) => seat.stack > 0).length < 2) return true;
    return opts.handLimit !== undefined && opts.handLimit > 0 && state.handNumber - opts.handNumber + 1 >= opts.handLimit;
  }

  /** At settle: the hand-end beat, then (if the sitting is over) its summary. */
  function deeAtSettle(): void {
    const dee = opts.dee;
    if (!dee) return;
    const event = handEndEvent(beatDecisions, sitting, dee.context);
    deeMemory = watchHand(deeMemory);
    const seed = (opts.seed ^ (state.handNumber * 0x9e3779b1)) >>> 0;
    beatEl = say(selectLine(event, dee.context, deeMemory, seed), 'dee-beat');
    sitting = recordHandInSitting(sitting, beatDecisions, event);
    if (sittingOver()) {
      sessionEl = beatEl === null ? say(selectLine(sessionEndEvent(sitting, dee.context), dee.context, deeMemory, seed + 1), 'dee-session') : null;
      sitting = NEW_SITTING;
    }
    dee.onMemory(deeMemory);
  }

  const heroSeat = (): Seat => state.seats[0];

  function setAwaiting(v: 'hero' | 'ai' | 'handover'): void {
    root.dataset.awaiting = v;
    opts.dee?.onActing(v === 'hero');
  }

  /** The coach panel sits in the sheet in coached mode and inline above the dock otherwise. */
  function syncCoachMount(): void {
    if (coachedMode) {
      if (coach.parentElement !== sheet) sheet.replaceChildren(coach, sheetPredict, sheetDee, sheetFoot);
      if (sheetLayer.parentElement !== stage) stage.appendChild(sheetLayer);
      // A verdict already up (shown inline while uncoached) moves into the sheet rather than vanishing
      // inside a hidden layer while the voice and the announcer still carry it.
      if (!coach.hidden && sheetKind === null) openSheet(gate !== null ? 'gate' : 'verdict');
      return;
    }
    closeSheet();
    if (coach.parentElement !== root) root.insertBefore(coach, predict.parentElement === root ? predict : controls);
    sheetLayer.remove();
  }

  /** Everything in the stage but the sheet goes inert (out of the tab order and the a11y tree). The
   *  right-hand corner is table settings, not table content: the Coach switch and Stats stay reachable at
   *  every point in a hand, sheet or not. */
  function setStageInert(on: boolean): void {
    for (const child of stage.children) {
      if (child === sheetLayer || child === cornerRight) continue;
      (child as HTMLElement).inert = on;
    }
  }

  function openSheet(kind: 'gate' | 'verdict'): void {
    sheetKind = kind;
    perch('sheet', kind === 'gate' ? 'gate' : coach.dataset.severity === 'serious' ? 'serious' : coach.dataset.severity === 'notable' ? 'gate' : 'thinking');
    root.dataset.sheet = kind;
    sheetLayer.hidden = false;
    sheetLayer.dataset.kind = kind;
    setStageInert(true);
    if (kind === 'verdict') {
      sheet.setAttribute('aria-label', 'Coach verdict');
      // The reveal line joins the verdict while the sheet is up; a free grade never opens the sheet.
      if (sheetPrediction) {
        const action = sheetPrediction.action[0].toUpperCase() + sheetPrediction.action.slice(1);
        const conf = sheetPrediction.confidence === 'sure' ? 'Sure' : 'Guess';
        const em = (text: string): HTMLElement => {
          const b = document.createElement('b');
          b.textContent = text;
          return b;
        };
        sheetCommit.replaceChildren('You committed to ', em(action), ', ', em(conf));
        sheetPredict.hidden = false;
        lendResult(predict, sheetPredict);
      } else {
        sheetPredict.hidden = true;
      }
      syncSheetCaption();
      sheetClose.hidden = false;
      sheet.focus({ preventScroll: true });
    } else {
      sheet.setAttribute('aria-label', 'Coach: explain this spot');
      sheetPredict.hidden = true;
      sheetCaption.textContent = 'The verdict appears when you answer, use both attempts, or the bar runs out.';
      sheetClose.hidden = true;
    }
  }

  /** A verdict opens before its action is applied, so the caption follows the live state (render()). */
  function syncSheetCaption(): void {
    if (sheetKind === 'verdict') {
      sheetCaption.textContent = state.winners === null ? 'The hand plays on behind this sheet' : '';
    }
  }

  function closeSheet(): void {
    perch('sheet', null);
    if (sheetKind === null) return;
    const hadFocus = sheetLayer.contains(document.activeElement);
    sheetKind = null;
    delete root.dataset.sheet;
    sheetLayer.hidden = true;
    setStageInert(false);
    reclaimResult(predict);
    sheetPrediction = null;
    // A beat lent to the sheet at hand end goes back to the dock.
    if (state.winners !== null) renderControlsInner();
    // Focus returns to the first live control below the table, never to <body>.
    if (hadFocus) {
      // At hand end the dock's primary takes the focus (Next hand, a story chapter's end, else Rebuy or New session),
      // never "Ask Dee".
      const primary =
        state.winners === null
          ? null
          : root.querySelector<HTMLElement>('.controls .pill.primary, [data-testid="btn-rebuy"], [data-testid="new-session"]');
      const next = primary ?? [...root.querySelectorAll<HTMLElement>('.predict button, .controls button, .controls input')].find(
        (el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null,
      );
      (next ?? stage).focus({ preventScroll: true });
    }
  }

  /** Close (or Esc) on a verdict: the verdict is dismissed, exactly as the next decision would clear it. */
  function dismissVerdict(): void {
    if (sheetKind !== 'verdict') return;
    clearCoach(coach);
    if (adviceShown) opts.onVerdict?.(null);
    adviceShown = false;
    closeSheet();
  }

  /** In the DOM only while coached mode is on; kept directly above the controls it gates. */
  function syncPredictMount(): void {
    if (coachedMode) {
      if (predict.parentElement === null) root.insertBefore(predict, controls);
      // The commit row belongs to a pending decision. At handover there is none, and leaving it up
      // is both a dead control and 74px of height the 900x640 column cannot spare.
      const commitVisible = state.winners === null;
      setCommitVisible(predict, commitVisible);
      // The tray takes the dock's place until the hero commits (every dock action is locked until then);
      // once committed, the dock returns under it. A gate keeps the dock up, locked, under the sheet.
      controls.hidden = commitVisible && committedPrediction(predict) === null && gate === null;
      predict.dataset.committed = String(committedPrediction(predict) !== null);
      return;
    }
    controls.hidden = false;
    predict.remove();
    clearPredictPanel(predict);
  }

  function syncCoachSwitch(): void {
    coachSwitch.setAttribute('aria-checked', String(coachedMode));
    coachSwitch.dataset.on = String(coachedMode);
  }

  function setCoachedMode(on: boolean): void {
    coachedMode = on;
    syncCoachSwitch();
    syncCoachMount();
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
      // Facing a bet/raise, grade hero vs the aggressor's modelled range (CONSOLIDATED #1) rather than
      // vs two random cards. On an unpriced spot the coach ignores this and stays on the random field.
      villainRange: toCall > 0 ? VILLAIN_BETTING_RANGE : undefined,
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
    // The sheet opens first so showGate's focus lands in a visible field.
    openSheet('gate');
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
    rememberHandForChat();
    deeAtSettle();
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

    if (opts.onHandSettled) {
      // A showdown is two or more hands live at the end. A pot won by a fold shows no cards worth reading,
      // even though the winner's cards are turned up on the felt.
      const live = state.seats.filter((seat) => !seat.folded && seat.hole.length > 0);
      const showdown = live.length >= 2;
      opts.onHandSettled({
        handNumber: state.handNumber,
        board: [...state.board],
        villains: state.seats
          .filter((seat) => !seat.isHero)
          .map((seat) => ({
            seatId: seat.id,
            name: seat.name,
            actions: villainActions.get(seat.id) ?? [],
            shown: showdown && !seat.folded && seat.hole.length > 0 ? [...seat.hole] : null,
          })),
      });
    }
  }

  function advance(): void {
    if (isHandOver(state)) {
      finishHand();
      return;
    }
    if (state.toAct === 0) {
      // A new decision: the previous verdict's pot and to-call no longer describe this spot.
      // A coached sheet never sits over a live decision: whatever it holds (a verdict, or G4's note on
      // a silent grade) is dismissed here, so the tray, the dock and the hotkeys are the hero's again.
      if (sheetKind === 'verdict') dismissVerdict();
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
      const profile = seatStreetProfiles.get(state.toAct)?.[state.street] ?? seatProfile.get(state.toAct);
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
      if (opts.onHandSettled && state.street !== 'showdown') {
        const seat = state.seats[state.toAct];
        const list = villainActions.get(seat.id) ?? [];
        list.push(capturedAction({ street: state.street, pot: state.pot, currentBet: state.currentBet }, seat, action));
        villainActions.set(seat.id, list);
      }
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
        // The save keeps the grade's stored shape; the meter's price is a display detail, not persisted.
        verdict: { severity: grade.severity, evLossBb: grade.evLossBb, message: grade.message, principle: grade.principle },
      };
      // Logged only when the gate actually fired; absent otherwise (matches the schema: absent = the
      // gate did not apply, never 0).
      if (gated) decision.gateAttempts = gateAttempts;
      decisions.push(decision);
      const reason = reasonText !== '' ? gradeReason(reasonText) : null;
      beatDecisions.push({
        grade,
        action: action.kind,
        street,
        toCall,
        pot,
        confidence: prediction?.confidence ?? null,
        reasonCategory: reason?.category ?? null,
        rightForWrongReason:
          reason !== null &&
          applyG4Override({ severityFromEv: grade.severity, reason, graderSource: 'local' }).rightForWrongReason,
      });

      if (prediction !== null) {
        const outcome = predictOutcome(prediction, action.kind, grade.severity === 'free');
        const route = routeFor(prediction, outcome);
        showPredictResult(predict, outcome, predictResultText(prediction, action.kind, outcome), route);
        opts.onPrediction?.(outcome, prediction.confidence);
        // Fresh commitment for the next street; the reveal line stays up until the next hand.
        resetCommit(predict);
      }
      // Coached: a verdict — or G4's reason note on a silent grade — rises as the sheet (the gate's sheet,
      // if one was up, turns into it). Nothing to say closes it, and the reveal line stays in the tray.
      if (coachedMode && !coach.hidden) {
        setCoachContext(coach, verdictContext(street, action.kind, toCall));
        sheetPrediction = prediction;
        openSheet('verdict');
      } else {
        closeSheet();
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
    beatDecisions = [];
    beatEl = null;
    sessionEl = null;
    deeAnnouncer.textContent = '';
    villainCalls = [];
    villainActions = new Map();
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
    closeSheet();
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
    potValue.textContent = String(state.pot);

    // Board diff: rebuild the row (cheap), but tag only the cards dealt SINCE the last render as
    // data-deal-in so the CSS deal animation fires once per card as it arrives, not on every re-render
    // at the same street. A shrink (new hand resets prevBoardLen to 0) animates the next street's deal.
    const row = renderCardRow(state.board);
    if (state.board.length > prevBoardLen) {
      const cards = row.querySelectorAll<HTMLElement>('[data-testid="card"]');
      for (let i = prevBoardLen; i < cards.length; i++) {
        cards[i].dataset.dealIn = 'true';
        // Stagger the corner-deal across cards dealt together (the flop's three): 0, 1, 2. A lone
        // turn/river card is index 0, so it has no delay. Consumed by animation-delay in styles.css.
        cards[i].style.setProperty('--deal-i', String(i - prevBoardLen));
      }
      // The board just grew (a new street was dealt) — announce the pot the player is now sizing against.
      // Only here, so a reader hears the pot at each street rather than on every intervening chip move.
      // Skipped at showdown (winners set): the outcome announcer already says who won how much.
      if (state.winners === null) potAnnouncer.textContent = `Pot ${state.pot}`;
    }
    prevBoardLen = state.board.length;
    // The streets still to come are drawn as empty inset wells, so the board keeps its five-card shape.
    // Not cards: they carry no card testid, so every card query is unchanged.
    for (let n = state.board.length; n < 5; n++) {
      const well = document.createElement('div');
      well.className = 'card-well';
      // Decoration: a screen reader already hears the street from the pot announcer.
      well.setAttribute('aria-hidden', 'true');
      row.appendChild(well);
    }
    boardWrap.replaceChildren(row);

    const hero = heroSeat();
    heroCards.replaceChildren(
      ...hero.hole.map((c: Card) => renderCard(c)),
    );

    const showdown = state.winners !== null;
    const seatEls = state.seats.map((seat) =>
      renderSeat(seat, state, showdown, seatArchetype, lastActionBySeat.get(seat.id), seatReveal),
    );
    // The hero's seat IS the hero plate: it takes the big hole cards in, so the to-act ring and the
    // turn wash land on one object. Villains take the scoreboard slots, clockwise from the hero
    // (seatLayout.ts).
    const heroEl = seatEls.find((_el, i) => state.seats[i].isHero);
    heroEl?.prepend(heroCards);
    const villainEls = seatEls.filter((_el, i) => !state.seats[i].isHero);
    seatSlots(villainEls.length).forEach((slot, i) => {
      const el = villainEls[i];
      el.dataset.slot = slot.area;
      el.style.setProperty('--i', String(slot.index));
      el.style.setProperty('--n', String(slot.count));
    });
    seatsWrap.replaceChildren(...villainEls);
    if (heroEl) heroWrap.replaceChildren(heroEl);

    // The commit row tracks whether a decision is pending, so it must be re-synced every render,
    // not only when the toggle is clicked.
    syncPredictMount();
    syncSheetCaption();

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
    // A keyboard user acting via the control pills would otherwise be dropped to <body> on every
    // state tick that rebuilds these controls. Capture the focused control up front and restore it
    // after the rebuild, through every early return.
    const restoreControlFocus = beginFocusRestore(controls);
    try {
      renderControlsInner();
    } finally {
      restoreControlFocus();
    }
  }

  function renderControlsInner(): void {
    controls.replaceChildren();
    delete controls.dataset.beat;
    delete controls.dataset.ended;

    if (state.winners !== null) {
      // One Dee line per handover: the hand's own beat first; the sitting's summary when the hand had none.
      // While a verdict sheet is up at hand end, the line sits on the sheet beside the verdict (the mock's
      // "mistake" state) and the dock carries only the outcome; it returns to the dock when the sheet closes.
      const deeEl = beatEl ?? sessionEl;
      const inSheet = deeEl !== null && sheetKind === 'verdict';
      sheetDee.replaceChildren(...(inSheet && deeEl ? [deeEl] : []));
      sheetDee.hidden = !inSheet;
      const summary = document.createElement('div');
      summary.className = 'winner-summary';
      summary.dataset.testid = 'winner-summary';
      summary.textContent = winnerSummaryText();
      if (deeEl && !inSheet) {
        // The beat tray: the line, the outcome as its caption, then the actions.
        summary.classList.add('g-caption');
        deeEl.querySelector('.dee-beat-body')?.append(summary);
        controls.appendChild(deeEl);
      } else controls.appendChild(summary);
      controls.dataset.beat = String(deeEl !== null && !inSheet);
      /** "Ask Dee", quiet, beside the dock's last actions (never the primary). */
      const askDee = (): void => {
        if (!opts.onAskDee || opts.dee?.context.character === false) return;
        const ask = pill('Ask Dee', 'ask-dee', () => opts.onAskDee?.());
        ask.classList.add('quiet');
        ask.setAttribute('aria-keyshortcuts', 'D');
        ask.appendChild(keycap('D'));
        controls.appendChild(ask);
      };

      // A busted hero sits out every future hand, so "Next hand" would be a no-op forever.
      // Offer a rebuy at the same table, or an explicit end of session — never a dead button.
      if (heroSeat().stack === 0) {
        const over = document.createElement('div');
        over.className = 'winner-summary';
        over.dataset.testid = 'session-over';
        controls.dataset.ended = 'true';
        over.textContent = opts.sittingEnd
          ? `You are out of chips. Rebuy for ${startStack} to keep this table, or go to the debrief.`
          : `You are out of chips. Rebuy for ${startStack} to keep this table, or start a new session.`;
        controls.appendChild(over);
        controls.appendChild(pill(`Rebuy ${startStack}`, 'btn-rebuy', () => rebuyAndContinue()));
        controls.appendChild(
          pill(opts.sittingEnd?.label ?? 'New session', opts.sittingEnd?.testid ?? 'new-session', () => opts.onSessionOver?.()),
        );
        askDee();
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
        controls.dataset.ended = 'true';
        swept.textContent = opts.sittingEnd
          ? 'You have every chip at this table — nobody is left to play.'
          : 'You have every chip at this table — nobody is left to play. Start a new session.';
        controls.appendChild(swept);
        controls.appendChild(pill(opts.sittingEnd?.label ?? 'New session', opts.sittingEnd?.testid ?? 'new-session', () => opts.onSessionOver?.()));
        askDee();
        return;
      }

      // The planned session is bounded: once the planner's allocated live hands have all been played,
      // stop offering "Next hand" and end the sitting the plan modelled. handNumber continues the
      // session's numbering (see the `table.handNumber` setup), so the count played THIS sitting is
      // measured from the hand this table opened on.
      if (
        opts.handLimit !== undefined &&
        opts.handLimit > 0 &&
        state.handNumber - opts.handNumber + 1 >= opts.handLimit
      ) {
        const done = document.createElement('div');
        done.className = 'winner-summary';
        done.dataset.testid = 'session-planned-complete';
        controls.dataset.ended = 'true';
        const end = opts.sittingEnd;
        done.textContent = end?.note ?? `That is your planned ${opts.handLimit}-hand sitting. Start a new session when you are ready.`;
        controls.appendChild(done);
        const endPill = pill(end?.label ?? 'New session', end?.testid ?? 'new-session', () => opts.onSessionOver?.());
        if (end) endPill.classList.add('primary');
        controls.appendChild(endPill);
        askDee();
        return;
      }

      askDee();
      const next = pill('Next hand', 'next-hand', () => nextHand());
      next.classList.add('primary');
      next.setAttribute('aria-keyshortcuts', 'Enter');
      next.appendChild(keycap('↩'));
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

    // The dock, in rank order: the secondary actions (each with its real hotkey as a trailing keycap),
    // the sizing group (slider, amount slot, presets), then the one primary, Raise.
    const fold = pill('Fold', 'btn-fold', () => heroAct({ kind: 'fold' }));
    fold.disabled = !heroTurn || !committed || !legal.includes('fold');
    fold.appendChild(keycap('F'));
    fold.setAttribute('aria-keyshortcuts', 'F');
    controls.appendChild(fold);

    // C is check when checking is legal, else the call (onKey below): the keycap sits on whichever one C does.
    const cIsCheck = legal.includes('check');
    const check = pill('Check', 'btn-check', () => heroAct({ kind: 'check' }));
    check.disabled = !heroTurn || !committed || !legal.includes('check');
    if (cIsCheck) {
      check.appendChild(keycap('C'));
      check.setAttribute('aria-keyshortcuts', 'C');
    }
    controls.appendChild(check);

    const call = pill(toCall > 0 ? `Call ${toCall}` : 'Call', 'btn-call', () =>
      heroAct({ kind: legal.includes('call') ? 'call' : 'allin' }),
    );
    call.disabled = !heroTurn || !committed || !(legal.includes('call') || legal.includes('allin'));
    if (!cIsCheck) {
      call.appendChild(keycap('C'));
      call.setAttribute('aria-keyshortcuts', 'C');
    }
    controls.appendChild(call);

    controls.appendChild(dockSeparator());

    const canRaise = legal.includes('raise') || legal.includes('bet');
    const min = canRaise ? minRaiseTo(state) : 0;
    const max = canRaise ? maxRaiseTo(state) : 0;

    const sizing = document.createElement('div');
    sizing.className = 'dock-slider';
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
    sizing.appendChild(slider);

    const amountLabel = document.createElement('span');
    amountLabel.className = 'raise-amount';
    amountLabel.dataset.testid = 'raise-amount';
    amountLabel.textContent = String(min);
    // Keep the slider value, the visible chip count, the screen-reader announcement and the track fill in
    // lock-step: set all four through one place so they can never drift.
    const setAmount = (value: string): void => {
      slider.value = value;
      amountLabel.textContent = value;
      slider.setAttribute('aria-valuetext', value);
      slider.style.setProperty('--f', String(max > min ? (Number(value) - min) / (max - min) : 0));
    };
    setAmount(String(min));
    slider.addEventListener('input', () => setAmount(slider.value));
    sizing.appendChild(amountLabel);
    controls.appendChild(sizing);

    const setPreset = (fraction: number): void => {
      const target = fraction === Infinity ? max : clamp(Math.round(state.pot * fraction), min, max);
      setAmount(String(target));
    };

    // The presets are one small segmented group of one-shot actions (role=group, not a selection). The
    // ½/¾ glyphs are their own accessible name, which reads as a meaningless fraction; spell each preset
    // out. Pot/All-in already read fine but are labelled too for a consistent "Bet …" phrasing.
    const presetGroup = document.createElement('div');
    presetGroup.className = 'g-seg g-seg-sm dock-presets';
    presetGroup.setAttribute('role', 'group');
    presetGroup.setAttribute('aria-label', 'Bet size');
    const presets: [string, string, number, string][] = [
      ['½', 'preset-half', 0.5, 'Bet half pot'],
      ['¾', 'preset-threequarter', 0.75, 'Bet three-quarter pot'],
      ['Pot', 'preset-pot', 1, 'Bet pot'],
      ['All-in', 'preset-allin', Infinity, 'Bet all-in'],
    ];
    for (const [label, testid, fraction, ariaLabel] of presets) {
      const b = pill(label, testid, () => setPreset(fraction));
      b.setAttribute('aria-label', ariaLabel);
      if (label.length === 1) b.classList.add('dock-frac');
      // All-in is also the A hotkey, which shoves directly: named in the tooltip, not as a keycap on a
      // control that only sizes.
      if (testid === 'preset-allin') b.title = 'All-in (A)';
      b.disabled = !heroTurn || !canRaise;
      presetGroup.appendChild(b);
    }
    controls.appendChild(presetGroup);

    controls.appendChild(dockSeparator());

    const raise = pill('Raise', 'btn-raise', () => {
      const amount = clamp(parseInt(slider.value, 10) || min, min, max);
      heroAct({ kind: legal.includes('raise') ? 'raise' : 'bet', amount });
    });
    raise.disabled = !heroTurn || !committed || !canRaise;
    raise.appendChild(keycap('R'));
    raise.setAttribute('aria-keyshortcuts', 'R');
    // The R key raises to the minimum; this button raises to the slider's amount. Say so where it shows.
    raise.title = `R raises to the minimum (${min})`;
    controls.appendChild(raise);
  }

  // ── keyboard (R3) ──────────────────────────────────────────────────
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && sheetKind === 'verdict') {
      dismissVerdict();
      return;
    }
    // Action hotkeys never reach a table that is behind a sheet.
    if (sheetKind !== null) return;
    if (state.winners !== null) {
      // At handover: D asks Dee; Enter deals the next hand when no control has focus (a focused button
      // already answers Enter itself).
      const focus = document.activeElement;
      const typing = focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement;
      if (!typing && e.key.toLowerCase() === 'd' && opts.onAskDee && opts.dee?.context.character !== false && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        opts.onAskDee();
      } else if (e.key === 'Enter' && !typing && !(focus instanceof HTMLButtonElement)) {
        root.querySelector<HTMLButtonElement>('[data-testid="next-hand"]')?.click();
      }
      return;
    }
    if (state.toAct !== 0) return;
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
  syncCoachSwitch();
  syncCoachMount();
  syncPredictMount();
  advance();

  return {
    root,
    chatContext: () => ({ live: state.winners === null && !settled, lastHand: lastHandChat }),
    destroy: () => {
      if (pendingTimer !== null) clearTimeout(pendingTimer);
      if (gateTimer !== null) clearTimeout(gateTimer);
      window.removeEventListener('keydown', onKey);
      perch('sheet', null);
      perch('reason', null);
      opts.dee?.onActing(false);
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
  seatReveal: ReadonlyMap<number, string | null>,
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
    // Story: a cast seat reveals its own label (its style in words), or stays masked until the chapter is beaten.
    const story = seatReveal.has(seat.id);
    const storyLabel = seatReveal.get(seat.id) ?? null;
    const trueLabel = story ? (storyLabel ?? 'Masked') : ARCHETYPE_EXPLOITS[name].label;
    // O3: the label is hidden ('Unknown') mid-hand and revealed only once the hand has ended, so the
    // learner classifies from behaviour rather than reading the answer off the seat.
    const shown = visibleArchetypeLabel(trueLabel, state.winners !== null);
    const revealed = shown.revealed && (!story || storyLabel !== null);
    const text = shown.text;
    const tag = document.createElement('div');
    tag.className = 'seat-archetype';
    tag.dataset.testid = 'seat-archetype';
    tag.dataset.revealed = String(revealed);
    tag.textContent = text;
    // The tooltip must gate on reveal too: the exploit text names the archetype, so setting it
    // mid-hand would leak the label on hover — the exact thing O3 hides.
    tag.title = revealed && !story ? ARCHETYPE_EXPLOITS[name].exploit : '';
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

  // Villain cards stay face-down until showdown. The hero's seat is the hero plate, which already holds
  // their hole cards full-size (render() moves the hero-cards row in), so it gets no second, small copy.
  if (seat.hole.length > 0 && !seat.isHero) {
    const faceDown = !(showdown && !seat.folded);
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

const PAST: Record<ActionKind, string> = {
  fold: 'folded',
  check: 'checked',
  call: 'called',
  bet: 'bet',
  raise: 'raised',
  allin: 'went all-in',
};

/** The verdict sheet's context caption: "On the flop, you folded to 75". */
function verdictContext(street: string, action: ActionKind, toCall: number): string {
  const when = street === 'preflop' ? 'Preflop' : `On the ${street}`;
  return `${when}, you ${PAST[action]}${toCall > 0 ? ` to ${toCall}` : ''}`;
}

function dockSeparator(): HTMLElement {
  const sep = document.createElement('span');
  sep.className = 'dock-sep';
  sep.setAttribute('aria-hidden', 'true');
  return sep;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
