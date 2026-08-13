import './styles.css';
import './styles-panels.css';
import './styles-screens.css';
import './styles-settings.css';

import type { HandRecord, SessionState } from '../core/session.js';
import type { LexiconAttempt } from '../core/lexicon.js';
import type { FadingEvent } from '../core/fading.js';
import {
  deserialize,
  rebuy,
  recordAnomalyResponse,
  recordChartAnswer,
  recordGifts,
  recordFadingEvents,
  recordHand,
  recordAssessment,
  recordInterleaveSpot,
  recordLexiconAttempt,
  recordPrediction,
  recordPuzzleResult,
  serialize,
  setCoachedMode,
  setSpokenVerdicts,
} from '../core/session.js';
import type { GiftEntry } from '../core/giftLedger.js';
import type { Confidence, PredictOutcome } from '../core/predict.js';
import {
  accept as acceptSuggestion,
  decline as declineSuggestion,
  prefer as preferSource,
  recommend,
  shouldAskPreference,
  type Source,
  type Suggestion,
} from '../core/recommend.js';
import { computeStats } from '../core/session.js';
import { renderHome } from './screens/home.js';
import { renderProfile } from './screens/profile.js';
import { renderProgressScreen } from './screens/progress.js';
import { decisionRecordsFromHands, type KcEvidence } from '../core/progress.js';
import { standing, currentForm, puzzleCoverage, depthLabel, type Depth, type FormState } from '../core/standing.js';
import { SCENARIOS } from '../core/puzzleScenarios.js';
import { renderLessonScreen } from './screens/lesson.js';
import { renderPuzzleScreen } from './screens/puzzle.js';
import { renderContrastScreen } from './screens/contrast.js';
import { renderCharts } from './screens/charts.js';
import { renderDrillScreen } from './screens/drill.js';
import { renderAnomalyScreen } from './screens/anomaly.js';
import { renderDossier } from './screens/dossier.js';
import { renderRobustnessScreen } from './screens/robustness.js';
import { renderReview, renderReviewList, type ReviewHandle } from './screens/review.js';
import { renderSettings, type SettingsStatus } from './screens/settings.js';
import { renderSpacing } from './screens/spacing.js';
import { conceptStatesFromLog, gate, posterior, type ConceptState } from '../core/schedule.js';
import { renderTable, type TableHandle } from './screens/table.js';
import { renderMultiplayerScreen } from './screens/multiplayer.js';
import { renderAssessmentScreen } from './screens/assessment.js';
import type { AssessmentGrade } from '../core/assessmentBlock.js';
import { renderVarianceScreen } from './screens/variance.js';

const DEFAULT_SEED = 42;

export interface SpeakResult {
  spoken: boolean;
  reason: string | null;
}

interface OffsuitBridge {
  loadState: () => Promise<Record<string, unknown>>;
  saveState: (obj: Record<string, unknown>) => Promise<void>;
  getSeed: () => Promise<number | null>;
  readSettings?: () => Promise<SettingsStatus>;
  setTutorEnabled?: (enabled: boolean) => Promise<boolean>;
  deleteProfile?: (confirmation: string) => Promise<{ deleted: boolean }>;
  /** Narration. `null` stops the current utterance. Absent outside Electron. */
  speak?: (text: string | null) => Promise<SpeakResult>;
  /** Multiplayer (local relay). All absent outside Electron; the socket lives in main behind an opt-in. */
  mpStatus?: () => Promise<{ enabled: boolean; active: boolean }>;
  mpSetEnabled?: (enabled: boolean) => Promise<boolean>;
  mpHost?: (opts: { seatCount?: number }) => Promise<{ port?: number; error?: string }>;
  mpJoin?: (address: { host: string; port: number; name?: string }) => Promise<{ joined?: boolean; error?: string }>;
  mpAction?: (action: unknown) => Promise<void>;
  mpDeal?: () => Promise<void>;
  mpStop?: () => Promise<void>;
  onMpEvent?: (handler: (event: unknown) => void) => () => void;
}

declare global {
  interface Window {
    offsuit?: OffsuitBridge;
  }
}

/** Outside Electron (`npm run dev`) there is no preload bridge; keep the app debuggable in a plain browser. */
function bridge(): OffsuitBridge {
  if (window.offsuit) return window.offsuit;
  let mem: Record<string, unknown> = {};
  return {
    loadState: async () => mem,
    saveState: async (obj) => {
      mem = obj;
    },
    getSeed: async () => null,
  };
}

/**
 * In a plain browser there is no main process to resolve a tutor, and the honest report of that is
 * the fully-local one: no credentials, empty allowlist. Never fabricated as "live" — this screen's
 * whole job is not overstating egress.
 */
const LOCAL_ONLY_SETTINGS: SettingsStatus = {
  tutorEnabled: false,
  tutorId: 'null',
  credentialsConfigured: false,
  egressAllowlist: [],
  guardFailures: [],
  profile: { path: '(in-memory)', backupCount: 0, lastRecovery: 'fresh' },
  deleteConfirmPhrase: 'DELETE PROFILE',
};

type Tab =
  | 'play'
  | 'learn'
  | 'puzzle'
  | 'repair'
  | 'drill'
  | 'anomaly'
  | 'robustness'
  | 'charts'
  | 'dossier'
  | 'spacing'
  | 'progress'
  | 'profile'
  | 'settings';

/**
 * The tab bar, in spine order: play, then the teaching surfaces, then progress.
 *
 * A registry rather than a hand-written list of tabButton calls, because each new surface would
 * otherwise mean editing three separate places in render(). N1 governs the whole bar: NOTHING IS
 * EVER LOCKED, so every tab is enterable from the first launch — no levels, no unlock animation,
 * no greyed-out entry. A tab whose screen module is not built yet renders its own empty state
 * rather than being hidden, since hiding it would be a soft lock.
 */
const TABS: readonly { id: Tab; label: string; testid: string }[] = [
  { id: 'play', label: 'Play', testid: 'tab-play' },
  { id: 'learn', label: 'Learn', testid: 'tab-learn' },
  { id: 'puzzle', label: 'Puzzle', testid: 'tab-puzzle' },
  { id: 'repair', label: 'Repair', testid: 'tab-repair' },
  { id: 'drill', label: 'Drill', testid: 'tab-drill' },
  { id: 'robustness', label: 'Robustness', testid: 'tab-robustness' },
  { id: 'charts', label: 'Charts', testid: 'tab-charts' },
  { id: 'anomaly', label: 'Anomaly', testid: 'tab-anomaly' },
  { id: 'dossier', label: 'Dossier', testid: 'tab-dossier' },
  { id: 'spacing', label: 'Spacing', testid: 'tab-spacing' },
  { id: 'progress', label: 'Progress', testid: 'tab-progress' },
  { id: 'profile', label: 'Profile', testid: 'tab-profile' },
  { id: 'settings', label: 'Settings', testid: 'tab-settings' },
];

async function boot(): Promise<void> {
  const io = bridge();
  const seed = (await io.getSeed()) ?? DEFAULT_SEED;
  let session: SessionState = deserialize(await io.loadState());

  let tab: Tab = 'play';
  let table: TableHandle | null = null;
  /**
   * Multiplayer is a PANEL within the Play tab, not its own tab (the tab bar is at its 13-tab budget).
   * When true, the Play tab shows the multiplayer screen instead of Home or a solo table; leaving it
   * returns to Home. It swaps out like the table does, so its pushed-event subscription is torn down.
   */
  let multiplayerActive = false;
  /**
   * The weekly assessment is a PANEL within the Play tab, same as multiplayer (the tab bar is full). When
   * true the Play tab shows the assessment block instead of Home or a solo table; finishing or leaving it
   * returns to Home. It swaps out like the table does, so its keydown listener tears down on unmount.
   */
  let assessmentActive = false;
  /**
   * The variance explainer is a PANEL within the Play tab (same as multiplayer/assessment — the tab bar
   * is full). Opened from the Progress results-graph refusal's "read the variance module" route; leaving
   * it returns to Progress, where the learner came from.
   */
  let varianceActive = false;
  let settings: SettingsStatus = (await io.readSettings?.()) ?? LOCAL_ONLY_SETTINGS;
  /**
   * Where the Profile tab is: the profile itself, the hand picker, or one hand's replay. The picker
   * is its own view rather than a section of the profile because the profile column has no spare
   * height at 900x640 — see screens/profile.ts.
   */
  let profileView: { at: 'profile' } | { at: 'picker' } | { at: 'replay'; index: number } = {
    at: 'profile',
  };
  let review: ReviewHandle | null = null;

  const app = document.getElementById('app');
  if (!app) throw new Error('#app missing');

  const nav = document.createElement('nav');
  nav.className = 'tabs';
  const screen = document.createElement('main');
  screen.className = 'screen';
  app.replaceChildren(nav, screen);

  const tabButton = (label: string, id: Tab, testid: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = 'tab';
    b.dataset.testid = testid;
    b.textContent = label;
    b.addEventListener('click', () => {
      tab = id;
      // Leaving Profile drops the replay: coming back to a half-stepped hand from another tab is
      // state the learner did not ask to keep, and the picker is one click away.
      profileView = { at: 'profile' };
      render();
      // Backup count and guard failures move while the learner is elsewhere, so opening the tab
      // re-reads rather than showing what was true at boot.
      if (id === 'settings') void refreshSettings();
    });
    return b;
  };

  function teardownTable(): void {
    table?.destroy();
    table = null;
  }

  /** Its keydown listener would otherwise outlive the screen and eat the table's arrow keys. */
  function teardownReview(): void {
    review?.destroy();
    review = null;
  }

  async function onHandComplete(record: HandRecord): Promise<void> {
    session = recordHand(session, record);
    await io.saveState(serialize(session));
    // The table screen stays mounted showing the result; only the persisted totals changed.
  }

  async function onRebuy(): Promise<void> {
    session = rebuy(session);
    await io.saveState(serialize(session));
  }

  /** O5: persist the -EV villain calls a completed hand revealed. The table already scored them. */
  async function onGifts(gifts: readonly GiftEntry[]): Promise<void> {
    session = recordGifts(session, gifts);
    await io.saveState(serialize(session));
  }

  async function onPrediction(outcome: PredictOutcome, confidence: Confidence): Promise<void> {
    session = recordPrediction(session, outcome, confidence);
    await io.saveState(serialize(session));
  }

  /** Persist one preflop chart-drill answer so its class mastery survives a restart. */
  async function onChartAnswer(handClass: string, correct: boolean): Promise<void> {
    session = recordChartAnswer(session, handClass, correct);
    await io.saveState(serialize(session));
  }

  /** Persist one completed puzzle scenario so its best score survives a restart. */
  async function onPuzzleComplete(scenarioId: string, correct: number): Promise<void> {
    session = recordPuzzleResult(session, scenarioId, correct);
    await io.saveState(serialize(session));
  }

  /**
   * Persist every graded decision from a finished assessment block. Each becomes an AssessmentDecision
   * tagged (in the progress input) mode:'assessment', so it feeds the assessment-EV-loss metric alone.
   * `correct` mirrors the practice path: a decision that cost nothing (severity 'free') is correct. One
   * timestamp for the whole block — the block was played in one sitting, so the week window is the same.
   */
  async function onAssessmentComplete(grades: readonly AssessmentGrade[]): Promise<void> {
    const at = Date.now();
    for (const g of grades) {
      session = recordAssessment(session, {
        at,
        evLossBb: g.grade.evLossBb,
        correct: g.grade.severity === 'free',
        // Carried so the standing score can filter to sound-math charges on contested spots.
        principle: g.grade.principle,
        toCall: g.toCall,
        street: g.street,
      });
    }
    await io.saveState(serialize(session));
  }

  /** Persist one recorded lexicon attempt so an accepted mechanism sentence keeps naming its concept (L1). */
  async function onLexiconAttempt(attempt: LexiconAttempt): Promise<void> {
    session = recordLexiconAttempt(session, attempt);
    await io.saveState(serialize(session));
  }

  /** Persist drill fading events so a concept's scaffolding rung survives a restart (T6/T7). */
  async function onFadingEvents(events: readonly FadingEvent[]): Promise<void> {
    session = recordFadingEvents(session, events);
    await io.saveState(serialize(session));
  }

  /** Persist one graded RFI spot so the interleaving view's class list survives a restart (Q1/Q2). */
  async function onInterleaveSpot(spotClass: string, module: string, correct: boolean): Promise<void> {
    session = recordInterleaveSpot(session, spotClass, module, correct);
    await io.saveState(serialize(session));
  }

  /** Persist one graded anomaly-drill response so the lifetime tally survives a restart (O8). */
  async function onAnomalyResponse(scored: {
    correct: boolean;
    fast: boolean;
    tag: 'missed-anomaly' | 'false-alarm' | 'slow' | null;
  }): Promise<void> {
    session = recordAnomalyResponse(session, scored);
    await io.saveState(serialize(session));
  }

  /**
   * The per-concept learner states the scheduler and recommender both reason over, derived from the
   * Drill's persisted graded history. Only 'graded' events are opportunities (hint / support-faded
   * events are not), so the states are built from real reps with nothing invented. Shared by the
   * Spacing queue and the launcher recommendation so both see the same history.
   */
  function deriveConcepts(): ConceptState[] {
    return conceptStatesFromLog(session.fadingLog.filter((event) => event.kind === 'graded'));
  }

  /**
   * Per-KC mastery bars for the Progress screen (P2, "the primary progress surface"). The composition
   * root is the right home for this: progress.ts and schedule.ts deliberately do not import each other
   * (progress.ts:330 — one owns the beta-binomial learner model, the other the display), so main.ts is
   * where their plain shapes meet. Each concept's own graded-rep history becomes a posterior + gate
   * status; nothing is invented. `errorSignature` is null because the graded fadingLog carries no error
   * tag — fabricating one would be the exact dishonesty the progress module exists to avoid, and
   * kcCaption already renders null as 'unattributed'. The concept id is used as the label, matching how
   * the Spacing screen already surfaces concepts.
   */
  function deriveKcs(now: number): KcEvidence[] {
    return deriveConcepts().map((state): KcEvidence => {
      const p = posterior(state, now);
      return {
        id: state.id,
        label: state.id,
        status: gate(state, now).status,
        posteriorMean: p.mean,
        ciLower: p.ciLower,
        ciUpper: p.ciUpper,
        opportunities: p.opportunities,
        errorSignature: null,
      };
    });
  }

  /** Steps per puzzle scenario, so puzzleCoverage can count clean full solves. Read from SCENARIOS. */
  const puzzleStepCounts = Object.fromEntries(SCENARIOS.map((s) => [s.id, s.target.length]));

  /**
   * The learner's STANDING ("Depth"): the table depth earned from decision quality + mastery, never
   * chips (see [[offsuit-ranking-design]] / PRODUCT-SPEC v2.1 amendment). Computed from the same honest
   * inputs the Progress screen uses — the mastered-KC count from the gated concept states, and puzzle
   * coverage — plus the assessment decisions (already structurally StandingDecision). The ratcheted floor
   * is persisted back onto the session so it only ever climbs.
   */
  function currentStanding(now: number): { depth: Depth; label: string; form: FormState } {
    const masteredKcCount = deriveConcepts().filter((state) => gate(state, now).status === 'mastered').length;
    const coverage = puzzleCoverage(session.puzzleProgress, puzzleStepCounts);
    const result = standing(
      {
        decisions: session.assessments,
        masteredKcCount,
        puzzleCoverage: coverage,
        depthFloor: session.depthFloor,
      },
      now,
    );
    // Ratchet: persist the deepest earned depth so it never drops. Only write when it actually grows,
    // so a plain re-render does not churn the save file.
    if (result.current > session.depthFloor) {
      session = { ...session, depthFloor: result.current };
      void io.saveState(serialize(session));
    }
    // Current form is the SEPARATE live reading (clause c) — it never touches the ratcheted depth; a bad
    // run shows up here, not as a demotion. Same honest evLossBb over the same eligibility filter.
    const form = currentForm(session.assessments, now).state;
    return { depth: result.depth, label: depthLabel(result.depth), form };
  }

  /**
   * N2's single suggestion for the launcher.
   *
   * The recommender now sees REAL concept states derived from the Drill log, so its spacing-debt,
   * fluency-gate and mastery sources can actually fire — they read the beta-binomial posterior and the
   * due schedule, both computable from graded reps alone. Reaction-time fluency is NOT among them and
   * stays unrecorded, so nothing here fabricates timing data. On a fresh profile the log is empty, the
   * concept list is empty, and `recommend` falls back to leak-cost candidates or returns null, which
   * the card renders as "nothing is owed yet" rather than a fabricated first task.
   *
   * `now` is passed rather than read inside core, so the recommendation stays a pure function of state.
   */
  function currentRecommendation(): { suggestion: Suggestion | null; askPreference: boolean } {
    const suggestion = recommend({
      concepts: deriveConcepts(),
      leaks: computeStats(session).leaks,
      recommender: session.recommender,
      now: Date.now(),
    });
    return { suggestion, askPreference: shouldAskPreference(session.recommender) };
  }

  /**
   * Accepting routes the learner at the suggestion's subject. Deliberately conservative: an unknown
   * subject opens the Drill tab rather than doing nothing, because a suggestion whose button is inert
   * is worse than one that lands somewhere sensible.
   */
  async function onAcceptSuggestion(suggestion: Suggestion): Promise<void> {
    session = { ...session, recommender: acceptSuggestion(session.recommender) };
    tab = suggestion.source === 'error-tag' ? 'learn' : 'drill';
    render();
    await io.saveState(serialize(session));
  }

  /** N4: the override is logged through core, with no alternative invented when none was named. */
  async function onDeclineSuggestion(suggestion: Suggestion): Promise<void> {
    session = {
      ...session,
      recommender: declineSuggestion(session.recommender, suggestion, '', Date.now()),
    };
    render();
    await io.saveState(serialize(session));
  }

  async function onPreferSource(source: Source): Promise<void> {
    session = { ...session, recommender: preferSource(session.recommender, source) };
    render();
    await io.saveState(serialize(session));
  }

  async function onCoachedModeChange(on: boolean): Promise<void> {
    session = setCoachedMode(session, on);
    await io.saveState(serialize(session));
  }

  /** Re-read from main after every mutation, so the screen reports the resolved state, not a guess. */
  async function refreshSettings(): Promise<void> {
    settings = (await io.readSettings?.()) ?? LOCAL_ONLY_SETTINGS;
    if (tab === 'settings') render();
  }

  async function onSetTutorEnabled(enabled: boolean): Promise<void> {
    await io.setTutorEnabled?.(enabled);
    await refreshSettings();
  }

  async function onDeleteProfile(confirmation: string): Promise<void> {
    const outcome = await io.deleteProfile?.(confirmation);
    // Only on a real delete: main refuses an unconfirmed call, and dropping the session anyway would
    // destroy in memory exactly what the gate just refused to destroy on disk. On a real delete the
    // session MUST go, or the next save would write the deleted log straight back.
    if (outcome?.deleted === true) {
      session = deserialize({});
      teardownTable();
    }
    await refreshSettings();
  }

  /**
   * Turning narration off must silence what is being said right now, not just the next verdict — a
   * player reaching for the switch mid-sentence wants it to stop. `null` is the cancel message.
   */
  async function onSpokenVerdictsChange(on: boolean): Promise<void> {
    session = setSpokenVerdicts(session, on);
    if (!on) void io.speak?.(null);
    render();
    await io.saveState(serialize(session));
  }

  /**
   * The single gate on narration, and the reason the preference is checked HERE rather than inside
   * the table: with it off, no speak message is sent at all — not one that main declines to act on.
   * An off switch that still fires the channel is the risk this shape removes.
   *
   * Never awaited: an utterance runs for seconds and a hand must not wait on it. A rejected invoke
   * (no bridge, a main-process fault) is swallowed for the same reason — the verdict is on screen.
   */
  function narrate(message: string | null): void {
    if (!session.spokenVerdicts) return;
    // Cancel (null) only goes out if something might be talking, so it too stays behind the switch.
    void io.speak?.(message)?.catch(() => undefined);
  }

  function startTable(): void {
    teardownTable();
    table = renderTable({
      seed,
      bankroll: session.bankroll,
      handNumber: session.stats.handsPlayed + 1,
      coachedMode: session.coachedMode,
      onHandComplete: (r) => void onHandComplete(r),
      onRebuy: () => void onRebuy(),
      onGifts: (gifts) => void onGifts(gifts),
      onPrediction: (outcome, confidence) => void onPrediction(outcome, confidence),
      onCoachedModeChange: (on) => void onCoachedModeChange(on),
      onVerdict: (message) => narrate(message),
      // Hero busted out: drop back to home, where a fresh table can be started.
      onSessionOver: () => {
        teardownTable();
        render();
      },
    });
    screen.replaceChildren(table.root);
  }

  function render(): void {
    nav.replaceChildren(
      ...TABS.map((t) => {
        const button = tabButton(t.label, t.id, t.testid);
        button.dataset.active = String(tab === t.id);
        return button;
      }),
    );

    // Every non-play tab tears the table down: a hand left mounted behind another screen would keep
    // its AI timer running and deal on while nobody is watching it.
    if (tab !== 'play') {
      teardownTable();
      teardownReview();
      screen.replaceChildren(renderTab(tab));
      return;
    }

    teardownReview();

    // Play tab: the multiplayer panel wins if it is open, then the assessment block, then a live solo
    // table, else home.
    if (multiplayerActive) {
      screen.replaceChildren(
        renderMultiplayerScreen({
          bridge: io,
          onExit: () => {
            multiplayerActive = false;
            render();
          },
        }),
      );
      return;
    }
    if (assessmentActive) {
      screen.replaceChildren(
        renderAssessmentScreen({
          // The session seed offset by the hand count so successive blocks are not identical, while any
          // one block stays reproducible for its run.
          seed: seed + session.stats.handsPlayed,
          onComplete: (grades) => void onAssessmentComplete(grades),
          onExit: () => {
            assessmentActive = false;
            render();
          },
        }),
      );
      return;
    }
    if (varianceActive) {
      screen.replaceChildren(
        renderVarianceScreen({
          onExit: () => {
            varianceActive = false;
            tab = 'progress';
            render();
          },
        }),
      );
      return;
    }
    if (table) {
      screen.replaceChildren(table.root);
      return;
    }
    screen.replaceChildren(
      renderHome({
        session,
        standing: currentStanding(Date.now()),
        onNewSession: () => startTable(),
        onPlayWithFriends: () => {
          multiplayerActive = true;
          render();
        },
        recommendation: currentRecommendation(),
        recommendationHandlers: {
          onAccept: (suggestion) => void onAcceptSuggestion(suggestion),
          onDecline: (suggestion) => void onDeclineSuggestion(suggestion),
          onPrefer: (source) => void onPreferSource(source),
        },
      }),
    );
  }

  /**
   * Renders one non-play surface. Each screen module owns its own file; this only routes.
   * `learn`, `drill` and `charts` land as their modules are built — until then they show a real
   * empty state, because N1 forbids hiding a surface and a blank panel would read as a bug.
   */
  function renderTab(which: Exclude<Tab, 'play'>): HTMLElement {
    if (which === 'profile') return renderProfileTab();
    if (which === 'learn') return renderLessonScreen();
    if (which === 'puzzle') {
      return renderPuzzleScreen({
        progress: session.puzzleProgress,
        onComplete: (scenarioId, correct) => void onPuzzleComplete(scenarioId, correct),
      });
    }
    if (which === 'repair') {
      return renderContrastScreen({
        hands: session.hands,
        lexicon: session.lexicon,
        onLexiconAttempt: (attempt) => void onLexiconAttempt(attempt),
      });
    }
    if (which === 'charts') {
      return renderCharts({
        mastery: session.chartMastery,
        onAnswer: (handClass, correct) => void onChartAnswer(handClass, correct),
        onSpot: (spotClass, module, correct) => void onInterleaveSpot(spotClass, module, correct),
      });
    }
    if (which === 'drill') {
      return renderDrillScreen({
        fadingLog: session.fadingLog,
        onFadingEvents: (events) => void onFadingEvents(events),
      });
    }
    if (which === 'anomaly') {
      const t = session.anomalyTally;
      return renderAnomalyScreen({
        lifetime: {
          attempts: t.attempts,
          correct: t.correct,
          fast: t.fast,
          missedAnomaly: t.missedAnomaly,
          falseAlarm: t.falseAlarm,
          slow: t.slow,
        },
        onResponse: (scored) => void onAnomalyResponse(scored),
      });
    }
    if (which === 'robustness') return renderRobustnessScreen();
    if (which === 'dossier') return renderDossier();
    if (which === 'spacing') {
      // Real graded history, grouped into per-concept states (see deriveConcepts). On a fresh profile
      // the log is empty and the screen says so.
      return renderSpacing({ concepts: deriveConcepts(), now: Date.now() });
    }
    if (which === 'progress') {
      /*
       * REAL DECISIONS, HONESTLY WITHHELD ELSEWHERE. The hand log now carries per-decision verdicts
       * (evLossBb + severity) and a playedAt timestamp, so the effort metric — graded decisions this
       * week — is computed from real play via decisionRecordsFromHands. What stays empty is deliberate:
       *  - `hands: []` keeps the win rate WITHHELD. It needs the all-in-adjusted evBb, which HandRecord
       *    does not store (only actual chips), and fabricating evBb from net would be inventing the one
       *    number P1 most forbids faking.
       *  - `fluency: []` because no reaction time is recorded anywhere, so no category can honestly pass.
       * Core's refusals then do the right thing: the win rate reads "need more hands", the results graph
       * is refused with its route out, and the assessment EV-loss reads from real blocks when the learner
       * has played one (empty until then — never a fabricated zero).
       */
      const progressNow = Date.now();
      return renderProgressScreen({
        input: {
          // Practice decisions come from real play; assessment spots are the separately-tagged block
          // decisions, mapped to mode:'assessment' so they feed the assessment-EV-loss metric ALONE
          // (progress.ts filters on mode). tag/sure mirror the practice path: the block records neither.
          decisions: [
            ...decisionRecordsFromHands(session.hands),
            ...session.assessments.map((a) => ({
              at: a.at,
              mode: 'assessment' as const,
              evLossBb: a.evLossBb,
              tag: null,
              sure: false,
              correct: a.correct,
            })),
          ],
          hands: [],
          fluency: [],
          botConfigId: 'default',
        },
        // The bars ARE the primary surface (P2): each concept's real graded-rep history rendered as a
        // posterior + gate status. Empty on a fresh profile (no reps yet), which the screen shows as
        // "nothing is locked" rather than a blank — so this never fabricates a first bar.
        kcs: deriveKcs(progressNow),
        now: progressNow,
        onOpenVariance: () => {
          // The refusal's promised route now lands on the honest variance explainer (a Play-tab panel),
          // not the generic Learn list — the alternative the refusal names is a real page, not a shrug.
          varianceActive = true;
          tab = 'play';
          render();
        },
        onStartAssessment: () => {
          assessmentActive = true;
          tab = 'play';
          render();
        },
      });
    }
    if (which === 'settings') {
      return renderSettings({
        status: settings,
        spokenVerdicts: session.spokenVerdicts,
        handlers: {
          onSetTutorEnabled: (enabled) => void onSetTutorEnabled(enabled),
          onDeleteProfile: (confirmation) => void onDeleteProfile(confirmation),
          onSpokenVerdictsChange: (on) => void onSpokenVerdictsChange(on),
        },
      });
    }
    return renderPlaceholder(which);
  }

  /**
   * The Profile tab, either the profile itself or the replay of one logged hand. A hand asked for by
   * number and no longer in the capped log falls back to the profile rather than an error screen.
   */
  function renderProfileTab(): HTMLElement {
    const goto = (next: typeof profileView): void => {
      profileView = next;
      render();
    };

    if (profileView.at === 'replay') {
      // Identified by its position in the log, not by handNumber: handNumber is not unique. A save
      // written before it was recorded parses every hand to 0, so a lookup by number would open the
      // first such hand whichever row the learner clicked — someone else's cards under their click.
      // A row that has aged out of the capped log falls back to the picker, not to an error screen.
      const hand = session.hands[profileView.index];
      if (hand !== undefined) {
        review = renderReview({ hand, onBack: () => goto({ at: 'picker' }) });
        return review.root;
      }
      profileView = { at: 'picker' };
    }

    if (profileView.at === 'picker') {
      return renderReviewList({
        hands: session.hands,
        onOpen: (index) => goto({ at: 'replay', index }),
        onBack: () => goto({ at: 'profile' }),
      });
    }

    return renderProfile({ session, onOpenReview: () => goto({ at: 'picker' }) });
  }

  function renderPlaceholder(which: string): HTMLElement {
    const root = document.createElement('div');
    root.className = 'empty-state';
    root.dataset.testid = `${which}-screen`;

    const title = document.createElement('div');
    title.className = 'empty-state-title';
    title.textContent = 'Not built yet';
    root.appendChild(title);

    const body = document.createElement('div');
    body.className = 'empty-state-body';
    body.textContent = 'This surface is on the roadmap. Nothing here is locked.';
    root.appendChild(body);

    return root;
  }

  render();
}

void boot();
