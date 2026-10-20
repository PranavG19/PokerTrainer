// First: take WebRTC out of the page before any other module runs (sealWebRtc.ts).
import './sealWebRtc.js';
import './styles.css';
import './styles-panels.css';
import './styles-screens.css';
import './styles-settings.css';
import './styles-glass.css';
import './styles-dee.css';
import './styles-pro.css';
import './styles-habit.css';
// After the kit: the cosmetic tokens' defaults and every Locker item (paint only).
import './styles-cosmetics.css';

import type { HandRecord, SessionState } from '../core/session.js';
import type { SavedRange } from '../core/rangeEditor.js';
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
  saveRange,
  deleteRange,
  serialize,
  setCoachedMode,
  setSoundCues,
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
import { reachWeightedLoss } from '../core/rw.js';
import { REFERENCE_REACH, classDecisionsFor, type GradedDecision } from '../core/reachRef.js';
import { createSoundPlayer } from './sound.js';
import { attachThumb } from './components/thumb.js';
import { spadeIcon } from './components/glyphs.js';
import { renderHome } from './screens/home.js';
import { renderProfile } from './screens/profile.js';
import { renderCareer } from './screens/career.js';
import { careerRecord, type CareerInput } from '../core/career.js';
import { systemDayKeyOf } from '../core/localDay.js';
import { renderProgressScreen } from './screens/progress.js';
import { decisionRecordsFromHands, type KcEvidence } from '../core/progress.js';
import { standing, currentForm, puzzleCoverage, depthLabel, depthToStack, affordableStack, type Depth, type FormState } from '../core/standing.js';
import { SCENARIOS } from '../core/puzzleScenarios.js';
import { renderLessonScreen } from './screens/lesson.js';
import { renderPuzzleScreen } from './screens/puzzle.js';
import { renderContrastScreen } from './screens/contrast.js';
import { renderCharts } from './screens/charts.js';
import { renderChartBank } from './screens/chartBank.js';
import { renderEquityCalculator } from './screens/equityCalculator.js';
import { renderRangeEditor } from './screens/rangeEditor.js';
import { renderDrillScreen } from './screens/drill.js';
import { renderHandReadingDrill } from './screens/handReadingDrill.js';
import { renderBoardReadingDrill } from './screens/boardReadingDrill.js';
import { renderAnomalyScreen } from './screens/anomaly.js';
import { renderDossier } from './screens/dossier.js';
import { renderProTools } from './screens/proTools.js';
import type { HandsBridge } from './screens/proHands.js';
import type { IcmBridge } from './screens/proIcm.js';
import { renderRobustnessScreen } from './screens/robustness.js';
import { renderReview, renderReviewList, type ReviewHandle } from './screens/review.js';
import { readOnlyHeadline, renderSettings, type SettingsStatus } from './screens/settings.js';
import { renderSpacing } from './screens/spacing.js';
import { renderTrainScreen, type TrainMode as TrainModeSpec } from './screens/train.js';
import { conceptStatesFromLog, dueNow, gate, posterior, type ConceptState } from '../core/schedule.js';
import { remediationQueue } from '../core/contrastManifest.js';
import { renderTable, BB, START_STACK, type TableHandle } from './screens/table.js';
import { renderMultiplayerScreen, type MultiplayerBridge } from './screens/multiplayer.js';
import { renderOnlineScreen, type OnlineBridge } from './screens/online.js';
import { renderAssessmentScreen } from './screens/assessment.js';
import type { AssessmentGrade } from '../core/assessmentBlock.js';
import { renderVarianceScreen } from './screens/variance.js';
import type { SessionPlan } from '../core/sessionPlan.js';
import { beginFocusRestore } from './focusRestore.js';
import { renderPerch } from './components/perch.js';
import { renderDeeSettings } from './screens/deeSettings.js';
import { renderDeeChat, type DeeChatHandle, type PhraseBridge } from './components/deeChat.js';
import { renderPhrasingRow, type PhrasingRowHandle, type PhrasingView } from './components/phrasingRow.js';
import type { ChatContext } from '../core/dee/chat/types.js';
import { currentStreakOn } from '../core/progression/persist.js';
import {
  contextOf,
  forgetRules,
  lineMemoryOf,
  rememberRule,
  setCharacter,
  setFrequency,
  setTone,
  withLineMemory,
} from '../core/dee/memory.js';
import { principleOf, quietnessForDepth, type DeeContext } from '../core/dee/engine.js';
import { DEPTHS } from '../core/standing.js';
import { createProClient, type ProBridge } from './pro.js';
import { renderProSettings } from './components/proSettings.js';
import { openDeepLinkConfirm, openUpgradeSheet } from './components/upgradeSheet.js';
import type { Feature } from '../core/entitlements/features.js';
import { renderChapter, renderRivalDossier, renderStoryMap, renderStoryStrip } from './screens/story.js';
import { renderKitchen, renderMasquerade } from './screens/storyRooms.js';
import { bossFor, bossRecordOf, recordBoss } from '../core/story/boss.js';
import { shelf as keepsakeShelf, syncKeepsakes } from '../core/story/keepsakes.js';
import {
  MASQUERADE_ROUND_HANDS,
  beginMasquerade,
  castOf,
  ensureMasquerade,
  nameSeat,
  recordMasqueradeHand,
  seatReads,
  type NameResult,
} from '../core/story/masquerade.js';
import { buildRoute, tableFor, tableSeed, type StoryRoute } from '../core/story/route.js';
import { KITCHEN, MASQUERADE, RIVALS, rivalOf, venueById, type ChapterId, type RivalId, type StoryRoomId, type Venue } from '../core/story/cast.js';
import {
  STORY_TABLE_HANDS,
  chapterOf,
  isUnmasked,
  judgeTable,
  logChoice,
  markIntroSeen,
  markLessonDone,
  recordStoryHand,
  recordTable,
  resumeStage,
  rivalRecordOf,
  type Stage,
  type TableJudgement,
} from '../core/story/campaign.js';
import { effectiveResult } from '../core/progression/persist.js';
import type { DecisionRecord } from '../core/session.js';
import { localHour, now, startClockAt } from './clock.js';
import { REAL as REAL_HOOKS, type TestHooks } from '../core/testHooks.js';
import { applyProgress, DRILL_ANSWERS as DRILL_ANSWERS_FOR_TICKET, streakToday, type ApplyContext, type ProgressExtras } from '../core/progression/apply.js';
import { repsOn } from '../core/progression/reps.js';
import { todaysRing } from '../core/progression/ring.js';
import { greetingFor, type Greeting } from '../core/progression/greeting.js';
import { ticketFor } from '../core/ticket.js';
import { folioCards } from '../core/folio.js';
import { effectiveTone, MAX_RIVAL_SITTINGS } from '../core/progression/persist.js';
import { LEAK_LABELS } from '../core/story/cast.js';
import { renderTicket } from './screens/ticket.js';
import { renderFolio } from './screens/folio.js';
import { renderOnboarding, type OnboardingResult } from './screens/onboarding.js';
import type { HomeHabit } from './screens/home.js';
import type { TicketItemRecord } from '../core/progression/types.js';
import { SECTIONS, SECTION_GROUP_STARTS, sectionOf, subNavOf, litSubItem, type Leaf, type Section } from './nav.js';
import { renderSubNav } from './components/subnav.js';
import { renderPlay } from './screens/play.js';
import type { TableSize } from '../core/tableSize.js';
import { renderRivals, renderTrophies, renderYouProfile } from './screens/you.js';
import { renderStyle } from './screens/style.js';
import { renderLetters } from './screens/letters.js';
import { styleRead, ARCHETYPE_STYLE } from '../core/style.js';
import { draftLetter, fileLetters, type LetterInput } from '../core/letters.js';
import { weekOf } from '../core/week.js';
import { milestoneById } from '../core/progression/milestones.js';
import { renderLocker } from './screens/locker.js';
import { equip, paintOf, SLOT_ATTRIBUTE, syncCosmetics, type EarnContext } from '../core/cosmetics/locker.js';
import { COSMETIC_SLOTS, type CosmeticSlot } from '../core/progression/types.js';
import { milestoneFacts, masteredIds } from '../core/progression/apply.js';
import { milestoneViews, nextUp } from '../core/progression/milestones.js';
import { sureRight, weeklyEvLoss } from '../core/progression/decisions.js';
import { VENUES } from '../core/story/cast.js';
import { chevron, gearIcon } from './components/glyphs.js';
import type { DayKey } from '../core/localDay.js';

const DEFAULT_SEED = 42;

/** The You sub-nav's title per item (the mock: "Profile", "Trophy room", …). */
const YOU_TITLE: Partial<Record<Leaf, string>> = {
  profile: 'Profile',
  trophies: 'Trophy room',
  style: 'Style',
  hands: 'Hands',
  letters: 'Letters',
  rivals: 'Rivals',
  locker: 'Locker',
  dee: 'Dee',
};

export interface SpeakResult {
  spoken: boolean;
  reason: string | null;
}

interface OffsuitBridge extends ProBridge, HandsBridge, IcmBridge {
  loadState: () => Promise<Record<string, unknown>>;
  /** Main answers `{ saved: false, readOnly }` when it refused the write; the in-memory bridge answers nothing. */
  saveState: (obj: Record<string, unknown>) => Promise<{ saved: boolean; readOnly: string | null; failed?: string } | void>;
  getSeed: () => Promise<number | null>;
  /** e2e only: the test clock and the onboarding switch (core/testHooks.ts). Absent outside Electron. */
  testHooks?: () => Promise<TestHooks>;
  readSettings?: () => Promise<SettingsStatus>;
  setTutorEnabled?: (enabled: boolean) => Promise<boolean>;
  setTheme?: (theme: string) => Promise<string>;
  deleteProfile?: (confirmation: string) => Promise<{ deleted: boolean }>;
  /** Narration. `null` stops the current utterance. Absent outside Electron. */
  speak?: (text: string | null) => Promise<SpeakResult>;
  /** Multiplayer (local relay). All absent outside Electron; the socket lives in main behind an opt-in. */
  mpStatus?: () => Promise<{ enabled: boolean; active: boolean }>;
  mpSetEnabled?: (enabled: boolean) => Promise<boolean>;
  mpHost?: MultiplayerBridge['mpHost'];
  mpJoin?: MultiplayerBridge['mpJoin'];
  mpAction?: (action: unknown) => Promise<void>;
  mpDeal?: () => Promise<void>;
  mpStop?: () => Promise<void>;
  onMpEvent?: (handler: (event: unknown) => void) => () => void;
  /** Dee chat's optional phrasing model, all in main. Absent outside Electron: the scripted answers only. */
  deePhrasingStatus?: () => Promise<PhrasingView>;
  deePhrasingDownload?: (consent: boolean, licences: string) => Promise<PhrasingView>;
  deePhrasingCancel?: () => Promise<PhrasingView>;
  deePhrasingDelete?: () => Promise<PhrasingView>;
  deePhrasingSetEnabled?: (on: boolean) => Promise<PhrasingView>;
  deeChatWarm?: () => Promise<void>;
  deeChatPhrase?: PhraseBridge;
  onDeePhrasing?: (handler: (status: PhrasingView) => void) => () => void;
  /** Online play (an Offsuit server). All absent outside Electron; main holds the socket and the key. */
  onlineStatus?: OnlineBridge['onlineStatus'];
  onlineConfigure?: OnlineBridge['onlineConfigure'];
  onlineConnect?: OnlineBridge['onlineConnect'];
  onlineRequest?: OnlineBridge['onlineRequest'];
  onlineAction?: OnlineBridge['onlineAction'];
  onlineEmote?: OnlineBridge['onlineEmote'];
  onlineLeave?: OnlineBridge['onlineLeave'];
  onlineDisconnect?: OnlineBridge['onlineDisconnect'];
  onlineExportIdentity?: OnlineBridge['onlineExportIdentity'];
  onOnlineEvent?: OnlineBridge['onOnlineEvent'];
  /** You › Style: capture the card's rect and save it as a PNG where the learner picks. Absent outside Electron. */
  saveStyleCard?: (rect: { x: number; y: number; width: number; height: number }) => Promise<'saved' | 'cancelled' | 'failed'>;
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
 * Set the document theme. Graphite is the :root default, so it needs no attribute — clearing the
 * attribute for graphite keeps first paint (and the default case) attribute-free and FOUC-free; any
 * other theme is a single documentElement attribute the bundled CSS keys off. Called once in boot()
 * before the first render, and again on a live change from Settings.
 */
function applyTheme(theme: string): void {
  const root = document.documentElement;
  if (theme && theme !== 'graphite') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
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
  theme: 'graphite',
};

/** A destination (nav.ts): the 7-tab bar's sections, the Study and You sub-navs, Progress and Settings. */
type Tab = Leaf;

/**
 * The six practice/maintenance surfaces the Train hub folds together, in rail order. Each `mode` is
 * the id the hub tracks; `testid` is the OLD per-tab testid, kept on the rail button so every deep-link
 * spec still resolves after one prepended click on tab-train. `band` splits the evergreen practice
 * surfaces (day-one usable) from the maintenance ones (history-driven, empty on a fresh profile). See
 * memory offsuit-train-hub-ia for the rename/order/default rationale.
 */
type TrainMode = 'puzzle' | 'drill' | 'reading' | 'board' | 'anomaly' | 'robustness' | 'charts' | 'repair' | 'spacing';
const TRAIN_MODES: readonly {
  mode: TrainMode;
  label: string;
  testid: string;
  band: 'practice' | 'maintenance';
}[] = [
  { mode: 'puzzle', label: 'Spots', testid: 'tab-puzzle', band: 'practice' },
  { mode: 'drill', label: 'Math', testid: 'tab-drill', band: 'practice' },
  { mode: 'reading', label: 'Reading', testid: 'tab-reading', band: 'practice' },
  { mode: 'board', label: 'Sight', testid: 'tab-board', band: 'practice' },
  { mode: 'anomaly', label: 'Speed', testid: 'tab-anomaly', band: 'practice' },
  { mode: 'robustness', label: 'Stress', testid: 'tab-robustness', band: 'practice' },
  // Charts folded in from its own tab (1.14): the preflop chart drill is practice like the rest of the rail.
  { mode: 'charts', label: 'Charts', testid: 'tab-charts', band: 'practice' },
  { mode: 'repair', label: 'Leaks', testid: 'tab-repair', band: 'maintenance' },
  { mode: 'spacing', label: 'Upkeep', testid: 'tab-spacing', band: 'maintenance' },
];

/** The spade mark (the mock's SVG, not the Unicode glyph) and the wordmark; the mark alone below 1040px. */
function renderBrand(): HTMLElement {
  const brand = document.createElement('div');
  brand.className = 'brand';
  const word = document.createElement('span');
  word.className = 'brand-word';
  word.textContent = 'Offsuit';
  brand.append(spadeIcon(), word);
  return brand;
}

async function boot(): Promise<void> {
  const base = bridge();
  /**
   * True while saves are failing (a full disk). Shown in the same banner as read-only, cleared by the
   * next save that lands, so nobody plays on believing a session is being kept when it is not.
   */
  let saveFailing = false;
  // Every save goes through here, so a refusal or a failure shows the banner the moment it happens,
  // whichever of the ~20 save sites hit it.
  const io: OffsuitBridge = {
    ...base,
    saveState: async (obj) => {
      // THE PROGRESSION HOST (1.5): every save is one diff → award → save. What changed since the last save
      // pays (core/progression/apply.ts); the session saved is the one with its progression applied.
      void obj;
      // While a delete is in flight nothing is written: a save of the old session landing after it would undo it.
      if (deleting) return { saved: false, readOnly: null, failed: 'deleting' };
      const applied = applyProgress(lastSaved, session, takeExtras(), applyContext());
      session = { ...session, progression: applied.progression };
      // Dee's letters: an ended week is filed on the next save, before the 500-hand cap can cut into it. Read-only
      // profiles file nothing (the store would refuse it, and a letter must not exist only in memory).
      if (settings.profile.readOnly == null) {
        const letters = fileLetters(session.progression.letters, letterInput(), today());
        if (letters !== session.progression.letters) session = { ...session, progression: { ...session.progression, letters } };
      }
      const toSave = session;
      // A profile delete while this save is in flight must not make the deleted session the next diff's base.
      const generation = profileGeneration;
      paintDee();
      let outcome: Awaited<ReturnType<OffsuitBridge['saveState']>>;
      try {
        outcome = await base.saveState(serialize(toSave));
        if ((!outcome || outcome.saved) && generation === profileGeneration) lastSaved = toSave;
      } catch {
        outcome = { saved: false, readOnly: null, failed: 'ipc' };
      }
      const failing = outcome ? !outcome.saved && outcome.readOnly == null : false;
      if (failing !== saveFailing) {
        saveFailing = failing;
        paintReadOnly();
      }
      if (outcome && !outcome.saved && outcome.readOnly != null && settings.profile.readOnly == null) {
        await refreshSettings();
      }
      return outcome;
    },
  };
  const seed = (await io.getSeed()) ?? DEFAULT_SEED;
  const hooks: TestHooks = (await io.testHooks?.().catch(() => REAL_HOOKS)) ?? REAL_HOOKS;
  startClockAt(hooks.now);
  let session: SessionState = deserialize(await io.loadState());
  /** The session as last saved: the base of the next save's diff. */
  let lastSaved: SessionState = session;
  /** Facts a save cannot see, from the screen that saw them; consumed by the next save. */
  let extras: ProgressExtras = {};
  const addExtras = (more: ProgressExtras): void => {
    extras = { ...extras, ...more, priceHeld: (extras.priceHeld ?? 0) + (more.priceHeld ?? 0), polished: [...(extras.polished ?? []), ...(more.polished ?? [])] };
  };
  function takeExtras(): ProgressExtras {
    const e: ProgressExtras = {
      ...extras,
      ...(shownGreeting ? { greeting: { lineId: shownGreeting.greeting.lineId, day: shownGreeting.day } } : {}),
      ...(shownTicket ? { shownTicket } : {}),
    };
    extras = {};
    return e;
  }
  /** Sight answers today (the Ticket's drill item when it is Sight), counted in memory, keyed by day. */
  let perception: { day: number; board: number } = { day: -1, board: 0 };
  /** The greeting on Home and the day it was shown (kept all day, persisted with the next save). */
  let shownGreeting: { greeting: Greeting; day: DayKey } | null = null;
  /** The Ticket Home or the Ticket screen last showed: the day's first save freezes exactly this one. */
  let shownTicket: SessionState['progression']['ticket'] | null = null;
  /** Bumped by a profile delete, so a save resolving afterwards cannot restore the deleted diff base. */
  let profileGeneration = 0;
  /** A profile delete is awaiting main. */
  let deleting = false;
  // One shared cue player; it constructs its AudioContext lazily on the first mistake with sound on.
  const soundPlayer = createSoundPlayer();

  let tab: Tab = 'home';
  // Which mode the Train hub opens on. Set by a deep-link (the recommender's "drill" route) or a rail
  // click; defaults to Spots, the one surface usable with zero prior state (the maintenance rungs are
  // empty on a fresh profile, so landing there would be a dead front door — see offsuit-train-hub-ia).
  let trainMode: TrainMode = 'puzzle';
  let table: TableHandle | null = null;
  /**
   * Multiplayer is a PANEL within the Play tab, not its own tab (the tab bar is at its 13-tab budget).
   * When true, the Play tab shows the multiplayer screen instead of Home or a solo table; leaving it
   * returns to Home. It swaps out like the table does, so its pushed-event subscription is torn down.
   */
  let multiplayerActive = false;
  /**
   * Online play is a PANEL within the Play tab too, opened from the multiplayer panel's "Play online"
   * row. Leaving it returns to the multiplayer panel. Leaving keeps the player signed in (main holds the
   * session), but the screen leaves any table it was seated at.
   */
  let onlineActive = false;
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
  /** Today's Ticket is a PANEL within the Play tab, like the assessment block; leaving it returns to Home. */
  let ticketActive = false;
  /** Learn shows the lessons or the Folio (the Rulebook). */
  let learnView: 'lessons' | 'folio' = 'lessons';
  /** You › Rivals: a rival's file open, or the list. */
  let rivalOpen: ChapterId | null = null;
  /** The Locker's slot on show; kept across re-renders (an equip, a tab change). */
  let lockerSlot: CosmeticSlot = 'cardBack';
  /** One-shot deep links from a Ticket item into Train's Math and Spots. */
  let drillKindNext: string | null = null;
  let puzzleNext: string | null = null;
  /** Onboarding: reopened from Dee's settings, or dismissed this run (Skip saves, so it never returns by itself). */
  let onboardingOpen = false;
  let onboardingDismissed = false;
  /** Answers typed so far, kept if the learner leaves the sheet for another tab and comes back. */
  let onboardingDraft: OnboardingResult | null = null;
  let settings: SettingsStatus = (await io.readSettings?.()) ?? LOCAL_ONLY_SETTINGS;
  /**
   * Pro: a display copy of main's licence snapshot (pro.ts). Read after loadState, so main has adopted
   * the profile's key before it is asked. A change repaints Settings; a deep link asks first.
   */
  const pro = createProClient(base);
  await pro.reload().catch(() => undefined);
  pro.subscribe(() => {
    if (tab === 'settings' || tab === 'pro') render();
  });
  const openProSheet = (feature?: Feature): void => {
    openUpgradeSheet(pro, { feature, onHaveKey: showKeyEntry });
  };
  function showKeyEntry(): void {
    tab = 'settings';
    render();
    const input = document.querySelector<HTMLTextAreaElement>('[data-testid="pro-key-input"]');
    input?.scrollIntoView({ block: 'center' });
    input?.focus();
  }
  pro.onDeepLink(() => void pro.reload().then(() => openDeepLinkConfirm(pro)));
  if (pro.status().pendingDeepLink) void openDeepLinkConfirm(pro);
  // Apply the chosen theme before the first render. Graphite is the :root default (already painted with
  // no JS, so no FOUC); only a non-default choice needs the attribute. This is a top-level document
  // attribute, not a screen subscription, so it is safe to set here in boot() before anything mounts.
  applyTheme(settings.theme);
  /**
   * Where the Profile tab is: the profile itself, the hand picker, or one hand's replay. The picker
   * is its own view rather than a section of the profile because the profile column has no spare
   * height at 900x640 — see screens/profile.ts.
   */
  let profileView:
    | { at: 'profile' }
    | { at: 'picker' }
    | { at: 'replay'; index: number }
    | { at: 'career' } = {
    at: 'profile',
  };
  let review: ReviewHandle | null = null;
  /**
   * Where the Story tab is. A chapter table is mounted like the Play table (it owns `table`), so leaving the tab
   * tears it down; coming back lands on the chapter's table beat. `justPlayed` carries the table just finished
   * into its debrief (the debrief of an older table reads the last sitting on file).
   */
  let storyView:
    | { at: 'map' }
    | { at: 'chapter'; id: ChapterId; stage: Stage; justPlayed: { judgement: TableJudgement; wasUnmasked: boolean } | null }
    | { at: 'table'; id: ChapterId }
    | { at: 'dossier'; id: ChapterId }
    | { at: 'kitchen'; stage: 'intro' | 'lesson' | 'boss' }
    | { at: 'masquerade'; said: { seat: number; result: NameResult } | null }
    | { at: 'masq-table' } = { at: 'map' };

  const app = document.getElementById('app');
  if (!app) throw new Error('#app missing');

  const nav = document.createElement('nav');
  nav.className = 'tabs';
  const screen = document.createElement('main');
  screen.className = 'screen';
  /**
   * The read-only banner: shown over every screen while main refuses to save, so nobody plays a long
   * session believing it is being kept. Fixed-position and click-through, so it never moves layout or
   * blocks a control; Settings carries the full explanation.
   */
  const readOnlyBanner = document.createElement('div');
  readOnlyBanner.className = 'profile-read-only';
  readOnlyBanner.dataset.testid = 'read-only-banner';
  readOnlyBanner.setAttribute('role', 'status');
  readOnlyBanner.hidden = true;
  app.replaceChildren(nav, screen, readOnlyBanner);
  function paintReadOnly(): void {
    const reason = settings.profile.readOnly ?? (saveFailing ? 'save-failing' : null);
    readOnlyBanner.hidden = reason === null;
    readOnlyBanner.dataset.reason = reason ?? '';
    readOnlyBanner.textContent = reason === null ? '' : readOnlyHeadline(reason);
  }
  paintReadOnly();

  /** Go to a destination. A section click lands on that section's front (Learn's lessons, Home's launcher). */
  function go(leaf: Leaf): void {
    tab = leaf;
    // Leaving Hands drops a replay: coming back to a half-stepped hand is state nobody asked to keep.
    profileView = { at: 'profile' };
    learnView = 'lessons';
    ticketActive = false;
    rivalOpen = null;
    // Leaving closes an open answers sheet; what was typed stays in the draft.
    onboardingOpen = false;
    render();
    // Backup count and guard failures move while the learner is elsewhere, so opening Settings re-reads.
    if (leaf === 'settings') void refreshSettings();
  }

  // The bar is built once and only its selected flag changes per render, so the shared thumb can slide
  // from the old section to the new one (and a clicked tab keeps keyboard focus).
  const tabButtons = new Map<Section, HTMLButtonElement>();
  const strip = document.createElement('div');
  strip.className = 'tab-strip';
  for (const t of SECTIONS) {
    if (SECTION_GROUP_STARTS.has(t.id)) {
      const divider = document.createElement('span');
      divider.className = 'tab-divider';
      divider.setAttribute('aria-hidden', 'true');
      strip.appendChild(divider);
    }
    const b = document.createElement('button');
    b.className = 'tab';
    b.dataset.testid = t.testid;
    b.textContent = t.label;
    b.addEventListener('click', () => go(t.leaf));
    tabButtons.set(t.id, b);
    strip.appendChild(b);
  }
  // Settings is a title-bar button, not a section; it keeps the old tab's testid.
  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'nav-settings';
  settingsButton.dataset.testid = 'tab-settings';
  settingsButton.setAttribute('aria-label', 'Settings');
  settingsButton.title = 'Settings';
  settingsButton.appendChild(gearIcon());
  settingsButton.addEventListener('click', () => go('settings'));

  function paintTabs(): void {
    const lit = sectionOf(tab);
    for (const [id, button] of tabButtons) {
      button.dataset.active = String(lit === id);
      if (lit === id) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    settingsButton.dataset.active = String(tab === 'settings');
    if (tab === 'settings') settingsButton.setAttribute('aria-current', 'page');
    else settingsButton.removeAttribute('aria-current');
  }

  const navSpacer = document.createElement('div');
  navSpacer.className = 'nav-spacer';
  navSpacer.setAttribute('aria-hidden', 'true');
  nav.setAttribute('aria-label', 'Sections');
  // Dee's perch: Dee at 20px and the streak, at the right of the title bar. It opens Dee chat (whose
  // Settings button opens Dee's settings).
  const perch = renderPerch(() => openChat());
  nav.append(renderBrand(), strip, perch.root, settingsButton, navSpacer);
  attachThumb(strip, 'button.tab');

  /** Character on/off is one document attribute, so every mark on every screen follows it (styles-dee.css). */
  function paintDee(): void {
    document.documentElement.dataset.character = session.progression.dee.character ? 'on' : 'off';
    paintCosmetics();
    const streak = session.progression.streak;
    perch.setStreak(currentStreakOn(streak, systemDayKeyOf(streak.boundaryHour)(now())));
  }
  /**
   * What is equipped is one document attribute per slot (styles-cosmetics.css), so every screen follows it. The
   * default is no attribute at all, as with the theme; an id this build does not know paints the default.
   */
  function paintCosmetics(): void {
    const root = document.documentElement;
    const paint = paintOf(session.progression.cosmetics);
    for (const slot of COSMETIC_SLOTS) {
      const attr = `data-${SLOT_ATTRIBUTE[slot]}`;
      const value = paint[slot];
      if (value === null) root.removeAttribute(attr);
      else if (root.getAttribute(attr) !== value) root.setAttribute(attr, value);
    }
  }
  paintDee();

  /**
   * Dee's engine context from the profile. The biggest leak is the principle with the most EV loss in the
   * session stats; quietness stretches cooldowns by certified depth (VISION §2.2).
   */
  function deeContext(): DeeContext {
    let leak: string | null = null;
    for (const [principle, cost] of Object.entries(session.stats.leakCostBb ?? {})) {
      if (cost > 0 && (leak === null || cost > (session.stats.leakCostBb[leak] ?? 0))) leak = principle;
    }
    const depthIndex = Math.max(0, DEPTHS.indexOf(currentStanding(Date.now()).depth));
    return contextOf(session.progression.dee, {
      biggestLeak: leak === null ? null : principleOf(leak),
      quietness: quietnessForDepth(depthIndex),
    });
  }

  // ── Dee chat ──────────────────────────────────────────────────────────────────────────────────────
  let chat: DeeChatHandle | null = null;
  let phrasing: PhrasingView | null = null;
  let phrasingRow: PhrasingRowHandle | null = null;
  void io.deePhrasingStatus?.().then((v) => {
    phrasing = v;
    phrasingRow?.update(v);
  });
  io.onDeePhrasing?.((v) => {
    phrasing = v;
    phrasingRow?.update(v);
  });

  /** What chat may answer from, read fresh per question: the live table if there is one, else the last saved hand. */
  function chatContext(): ChatContext {
    // A mounted table is always the one on screen (render() tears it down elsewhere): Play's or a story chapter's.
    const atTable = table?.chatContext();
    let lastHand: ChatContext['lastHand'] = atTable?.lastHand ?? null;
    if (lastHand === null && !atTable?.live) {
      // From anywhere else: the last saved hand. Its grades carry no pot shares (those are not persisted),
      // so the answer names the decision and its cost without a price.
      const saved = session.hands[session.hands.length - 1];
      if (saved?.decisions) {
        lastHand = {
          handNumber: saved.handNumber,
          decisions: saved.decisions
            .filter((d) => d.verdict !== null)
            .map((d) => ({
              street: d.street,
              action: d.action,
              pot: d.pot,
              toCall: d.toCall,
              grade: { severity: d.verdict!.severity, evLossBb: d.verdict!.evLossBb, principle: d.verdict!.principle },
            })),
        };
      }
    }
    const suggestion = currentRecommendation().suggestion;
    return {
      phase: atTable?.live ? 'in-hand' : lastHand ? 'after-hand' : 'idle',
      lastHand,
      study: suggestion ? { source: suggestion.source, action: suggestion.action, reason: suggestion.reason } : null,
      phrasingInstalled: phrasing?.state === 'installed' && phrasing.enabled,
    };
  }

  function openChat(): void {
    if (chat !== null) return;
    chat = renderDeeChat({
      context: chatContext,
      character: session.progression.dee.character,
      phrase: phrasing?.state === 'installed' && phrasing.enabled ? io.deeChatPhrase : undefined,
      warm: () => void io.deeChatWarm?.(),
      onPerch: (pose) => perch.setPose('chat', pose),
      onOpenSettings: () => {
        go('dee');
      },
      onClose: () => {
        chat = null;
      },
    });
    document.body.appendChild(chat.root);
  }

  // `/` opens chat from anywhere (outside a text field), so it is reachable without the pointer.
  window.addEventListener('keydown', (e) => {
    if (e.key !== '/' || chat !== null || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    openChat();
  });

  async function saveProgression(next: SessionState['progression']): Promise<void> {
    session = { ...session, progression: next };
    paintDee();
    await io.saveState(serialize(session));
  }

  function teardownTable(): void {
    table?.destroy();
    table = null;
  }

  // ── Story ───────────────────────────────────────────────────────────────────────────────────────
  const today = (): ReturnType<ReturnType<typeof systemDayKeyOf>> => systemDayKeyOf(session.progression.streak.boundaryHour)(now());

  /** The orbit for this learner: reordered by their own reach-weighted leaks (story/route.ts). */
  function storyRoute(): StoryRoute {
    return buildRoute(session.hands, session.progression.story);
  }

  /** Every story save also files any keepsake it earned in Dee's memory (story/keepsakes.ts). */
  function saveStory(next: SessionState['progression']['story']): Promise<void> {
    return saveProgression(syncKeepsakes({ ...session.progression, story: next }));
  }

  /** A boss hand played to the end: the attempt, and the first clean day (which keeps the keepsake). */
  function onBossFinish(room: StoryRoomId, clean: boolean): void {
    const boss = bossFor(room);
    if (boss) void saveStory(recordBoss(session.progression.story, boss.id, clean, today()));
  }

  function bossKept(room: StoryRoomId): boolean {
    const boss = bossFor(room);
    return boss ? bossRecordOf(session.progression.story, boss.id).cleanOn !== null : false;
  }

  /** Open one of the story's rooms on the Story tab: a keepsake opens the hand (or the Masquerade) that earns it. */
  function openRoom(room: StoryRoomId): void {
    tab = 'story';
    if (room === KITCHEN.id) storyView = { at: 'kitchen', stage: 'boss' };
    else if (room === MASQUERADE.id) storyView = { at: 'masquerade', said: null };
    else storyView = { at: 'chapter', id: room, stage: 'boss', justPlayed: null };
    render();
  }

  function unmaskedInOrbit(rival: RivalId): boolean {
    const venue = VENUES.find((v) => v.rival === rival);
    return venue ? isUnmasked(session.progression.story, venue) : false;
  }

  function openMasquerade(): void {
    const m = session.progression.story.masquerade;
    const dealt = ensureMasquerade(m);
    if (dealt !== m) void saveStory({ ...session.progression.story, masquerade: dealt });
    storyView = { at: 'masquerade', said: null };
    render();
  }

  /** The Masquerade's table: three masked seats, their jittered styles, every action counted for the Folio. */
  function startMasqueradeTable(): void {
    teardownTable();
    const m = ensureMasquerade(session.progression.story.masquerade);
    const hands = m.seats.reduce((n, seat) => Math.max(n, seat.acted), 0);
    const tseed = (Math.imul(m.run, 7919) ^ Math.imul(hands + 1, 104729) ^ seed) >>> 0;
    storyView = { at: 'masq-table' };
    const finish = (): void => {
      teardownTable();
      addExtras({ storyTableEnded: true });
      storyView = { at: 'masquerade', said: null };
      render();
    };
    table = renderTable({
      seed: tseed,
      bankroll: session.bankroll,
      handNumber: session.stats.handsPlayed + 1,
      handLimit: MASQUERADE_ROUND_HANDS,
      coachedMode: session.coachedMode,
      cast: castOf(m).map((c) => {
        // A seat shows its rival's name only once both the Masquerade and the orbit have unmasked them.
        const named = c.unmasked && c.rival !== null && unmaskedInOrbit(c.rival);
        return {
          name: named && c.rival ? RIVALS[c.rival].short : c.mask,
          avatar: (named && c.rival ? RIVALS[c.rival].short : c.mask)[0],
          archetype: c.archetype,
          profile: c.profile,
          revealLabel: c.unmasked && c.rival ? RIVALS[c.rival].style : null,
        };
      }),
      onHandComplete: (r) => void onHandComplete(r),
      onHandSettled: (hand) => {
        const story = session.progression.story;
        const next = recordMasqueradeHand(story.masquerade, hand.villains.map((v) => v.actions));
        void saveStory({ ...story, masquerade: next });
      },
      sittingEnd: {
        note: 'That is the round. The Folio has the counts: only what each mask did, never its cards.',
        label: 'Back to the Folio',
        testid: 'masq-folio-go',
      },
      onRebuy: () => void onRebuy(),
      onGifts: (gifts) => void onGifts(gifts),
      onPrediction: (outcome, confidence) => void onPrediction(outcome, confidence),
      onCoachedModeChange: (on) => void onCoachedModeChange(on),
      onVerdict: (message) => narrate(message),
      dee: {
        context: deeContext(),
        memory: lineMemoryOf(session.progression.dee),
        onMemory: (memory) => {
          session = { ...session, progression: withLineMemory(session.progression, memory) };
        },
        onPerch: (source, pose) => perch.setPose(source, pose),
        onActing: (on) => perch.setActing(on),
      },
      onPriceHeld: (count) => addExtras({ priceHeld: count }),
      onSessionOver: () => finish(),
    });
    screen.replaceChildren(table.root);
  }

  function storyDee(): { tone: DeeContext['tone']; character: boolean } {
    return { tone: deeContext().tone, character: session.progression.dee.character };
  }

  // ── The habit loop: the host's context, Home's pieces, the Ticket and the Folio ─────────────────────
  const dayOf = (): ReturnType<typeof systemDayKeyOf> => systemDayKeyOf(session.progression.streak.boundaryHour);

  /** The costliest leak's coach principle (by bb lost), for the Ticket's spots. */
  function costliestPrinciple(): string | null {
    let leak: string | null = null;
    for (const [principle, cost] of Object.entries(session.stats.leakCostBb ?? {})) {
      if (cost > 0 && (leak === null || cost > (session.stats.leakCostBb[leak] ?? 0))) leak = principle;
    }
    return leak;
  }

  function applyContext(): ApplyContext {
    return { now: now(), dayOf: dayOf(), scenarios: SCENARIOS, leakPrinciple: costliestPrinciple() };
  }

  /** Today's Ticket: the frozen one, or the one the next save will freeze (built the same way). */
  function todaysTicket(): SessionState['progression']['ticket'] {
    return ticketFor(session.progression.ticket, {
      day: today(),
      now: now(),
      concepts: deriveConcepts(),
      leakPrinciple: costliestPrinciple(),
      scenarios: SCENARIOS,
      puzzleProgress: session.puzzleProgress,
    });
  }

  function currentFolio(): ReturnType<typeof folioCards> {
    return folioCards({ lexicon: session.lexicon, rules: session.progression.dee.ruleSentences, folio: session.progression.folio, now: now(), dayOf: dayOf() });
  }

  function homeHabit(): HomeHabit {
    const p = session.progression;
    const d = today();
    const streak = streakToday(p, d);
    const dueCount = dueNow(deriveConcepts(), now()).length;
    const ruleDays = [
      ...session.lexicon.map((a) => dayOf()(a.at)),
      ...p.dee.ruleSentences.map((r) => r.day),
    ];
    const ticket = todaysTicket();
    const topLeak = storyRoute().leaks[0];
    const rules = p.dee.ruleSentences;
    const newest = rules.length > 0 ? rules[rules.length - 1].text : null;
    const greeting = p.dee.character
      ? greetingFor({
          day: d,
          hour: localHour(),
          name: p.personalization.displayName,
          tone: effectiveTone(p.dee.personality),
          handsPlayed: session.stats.handsPlayed,
          dueCount,
          leak: topLeak ? LEAK_LABELS[topLeak.kind] : null,
          rule: newest !== null && newest.split(/\s+/).length <= 14 ? newest : null,
          ticketDoneToday: ticket.finishedOn === d,
          daysSinceLastSession: p.streak.lastCountedDay === null ? null : d - p.streak.lastCountedDay,
          lastGreeting: p.dee.lastGreeting,
        })
      : null;
    shownGreeting = greeting ? { greeting, day: d } : null;
    shownTicket = ticket;
    return {
      greeting,
      streak: { ...streak, countedDays: p.streak.countedDays, today: d, boundaryHour: p.streak.boundaryHour },
      ring: todaysRing({
        today: d,
        dueNow: dueCount,
        repsToday: repsOn(p.reps, d),
        suggestionTakenOn: p.tallies.suggestionTakenOn,
        suggestionOffered: currentRecommendation().suggestion !== null,
        ruleDays,
      }),
      ticket,
      today: d,
      onOpenTicket: () => {
        ticketActive = true;
        render();
      },
    };
  }

  /** Open the surface that works one Ticket item. The item ticks itself off when the work is on file. */
  function startTicketItem(item: TicketItemRecord): void {
    ticketActive = false;
    tab = 'train';
    if (item.kind === 'review') {
      trainMode = 'drill';
      drillKindNext = item.ref;
    } else if (item.kind === 'drill') {
      trainMode = item.ref === 'board' ? 'board' : 'anomaly';
    } else {
      trainMode = 'puzzle';
      puzzleNext = item.ref;
    }
    render();
  }

  /** A perception answer, counted toward the Ticket's drill item; a board answer saves only when it completes it. */
  /** A Sight answer, counted toward the Ticket's drill item (Speed's count is read from the saved awards). */
  function onSightAnswer(): boolean {
    const d = today();
    if (perception.day !== d) perception = { day: d, board: 0 };
    perception.board += 1;
    addExtras({ perception: { mode: 'board', answered: perception.board } });
    return perception.board === DRILL_ANSWERS_FOR_TICKET;
  }

  function onboardingDue(): boolean {
    const p = session.progression.personalization;
    return (hooks.onboarding && p.answeredOn === null && session.hands.length === 0 && !onboardingDismissed);
  }

  /**
   * Play's panels are exclusive: opening one closes any other left open, so a launcher always lands on its own
   * panel whatever was open before (re-review S-A). The caller renders.
   */
  function openPanel(kind: 'friends' | 'online' | 'assessment' | 'variance'): void {
    multiplayerActive = kind === 'friends';
    onlineActive = kind === 'online';
    assessmentActive = kind === 'assessment';
    varianceActive = kind === 'variance';
  }

  /** Open a chapter. Choosing one other than the suggested chapter is logged (N1: an override, never a refusal). */
  function openChapter(id: ChapterId): void {
    const route = storyRoute();
    void saveStory(logChoice(session.progression.story, route.next, id, today()));
    storyView = { at: 'chapter', id, stage: resumeStage(chapterOf(session.progression.story, id)), justPlayed: null };
    render();
  }

  /** A chapter table: heads-up against the rival, seeded per chapter and attempt, the rival leaning on the leak. */
  function startStoryTable(venue: Venue): void {
    teardownTable();
    // Keyed on the hands already dealt against this rival, so a table left half-way never re-deals the same cards.
    const tseed = tableSeed(venue.id, rivalRecordOf(session.progression.story, venue).hands, seed);
    const routed = storyRoute().chapters.find((c) => c.venue.id === venue.id);
    const rt = tableFor(venue, routed?.leak ?? null, tseed);
    const rival = rivalOf(venue);
    const wasUnmasked = isUnmasked(session.progression.story, venue);
    const decisions: DecisionRecord[] = [];
    storyView = { at: 'table', id: venue.id };
    const finish = async (): Promise<void> => {
      const judgement = judgeTable(decisions, venue);
      teardownTable();
      addExtras({ storyTableEnded: true });
      storyView = { at: 'chapter', id: venue.id, stage: 'debrief', justPlayed: { judgement, wasUnmasked } };
      await saveStory(recordTable(session.progression.story, venue, judgement, today()));
      render();
    };
    table = renderTable({
      seed: tseed,
      bankroll: session.bankroll,
      handNumber: session.stats.handsPlayed + 1,
      handLimit: STORY_TABLE_HANDS,
      coachedMode: session.coachedMode,
      cast: [
        {
          name: wasUnmasked ? rival.short : 'Regular',
          avatar: wasUnmasked ? rival.short[0] : '?',
          archetype: rival.archetype,
          profile: rt.profile,
          streetProfiles: rt.streetProfiles,
          revealLabel: wasUnmasked ? rival.style : null,
        },
      ],
      onHandComplete: (r) => {
        decisions.push(...(r.decisions ?? []));
        void onHandComplete(r);
      },
      onHandSettled: (hand) => {
        const seat = hand.villains[0];
        if (!seat) return;
        const story = recordStoryHand(session.progression.story, venue, { actions: seat.actions, shown: seat.shown, board: hand.board }, today());
        void saveStory(story);
      },
      sittingEnd: {
        note: `That is the table. The debrief judges your decisions, not the chips.`,
        label: 'Debrief',
        testid: 'story-debrief-go',
      },
      onRebuy: () => void onRebuy(),
      onGifts: (gifts) => void onGifts(gifts),
      onPrediction: (outcome, confidence) => void onPrediction(outcome, confidence),
      onCoachedModeChange: (on) => void onCoachedModeChange(on),
      onVerdict: (message) => narrate(message),
      dee: {
        context: deeContext(),
        memory: lineMemoryOf(session.progression.dee),
        onMemory: (memory) => {
          session = { ...session, progression: withLineMemory(session.progression, memory) };
        },
        onPerch: (source, pose) => perch.setPose(source, pose),
        onActing: (on) => perch.setActing(on),
      },
      onPriceHeld: (count) => addExtras({ priceHeld: count }),
      // Busted, swept or the planned hands played: the debrief judges what was played.
      onSessionOver: () => void finish(),
    });
    screen.replaceChildren(table.root);
  }

  function renderStoryTab(): HTMLElement {
    const story = session.progression.story;
    const unmasked = (id: ChapterId): boolean => isUnmasked(session.progression.story, venueById(id) as Venue);
    const toMap = (): void => {
      storyView = { at: 'map' };
      render();
    };
    if (storyView.at === 'kitchen') {
      return renderKitchen({
        progress: chapterOf(story, KITCHEN.id),
        stage: storyView.stage,
        bossKept: bossKept(KITCHEN.id),
        dee: storyDee(),
        onStage: (stage) => {
          storyView = { at: 'kitchen', stage };
        },
        onIntroSeen: () => void saveStory(markIntroSeen(session.progression.story, KITCHEN.id)),
        onLessonDone: () => void saveStory(markLessonDone(session.progression.story, KITCHEN.id)),
        onBossFinish: (clean) => onBossFinish(KITCHEN.id, clean),
        onBack: toMap,
      });
    }
    if (storyView.at === 'masquerade' || storyView.at === 'masq-table') {
      const said = storyView.at === 'masquerade' ? storyView.said : null;
      const m = ensureMasquerade(story.masquerade);
      return renderMasquerade({
        state: m,
        unmaskedInOrbit,
        dee: storyDee(),
        said,
        onName: (seat, rival) => {
          const cur = ensureMasquerade(session.progression.story.masquerade);
          const named = nameSeat(cur, seat, rival, seatReads(cur.seats[seat]), today());
          storyView = { at: 'masquerade', said: { seat, result: named.result } };
          void saveStory({ ...session.progression.story, masquerade: named.state }).then(() => render());
        },
        onSitDown: () => startMasqueradeTable(),
        onNewMasquerade: () => {
          storyView = { at: 'masquerade', said: null };
          void saveStory({ ...session.progression.story, masquerade: beginMasquerade(session.progression.story.masquerade) }).then(() => render());
        },
        onBack: toMap,
      });
    }
    if (storyView.at === 'dossier') {
      const venue = venueById(storyView.id) as Venue;
      return renderRivalDossier({
        venue,
        unmasked: unmasked(venue.id),
        record: rivalRecordOf(story, venue),
        dee: storyDee(),
        onOpenChapter: () => openChapter(venue.id),
        onBack: () => {
          storyView = { at: 'map' };
          render();
        },
      });
    }
    const route = storyRoute();
    if (storyView.at === 'chapter' || storyView.at === 'table') {
      const view = storyView;
      const venue = venueById(view.id) as Venue;
      const progress = chapterOf(story, venue.id);
      const routed = route.chapters.find((c) => c.venue.id === venue.id) ?? route.chapters[0];
      const lastSitting = [...rivalRecordOf(story, venue).sittings].reverse().find((s) => s.chapter === venue.id);
      const lastResult = effectiveResult(progress);
      const lastTable: TableJudgement | null =
        lastSitting && lastResult
          ? { judged: lastSitting.judged, free: lastSitting.free, serious: lastSitting.serious, focusSerious: 0, result: lastResult }
          : null;
      const stage: Stage = view.at === 'table' ? 'table' : view.stage;
      const justPlayed = view.at === 'chapter' ? view.justPlayed : null;
      const tseed = tableSeed(venue.id, rivalRecordOf(story, venue).hands, seed);
      return renderChapter({
        venue,
        routed,
        total: route.chapters.length,
        progress,
        unmasked: unmasked(venue.id),
        stage,
        tailor: tableFor(venue, routed.leak, tseed).tailor,
        justPlayed,
        lastTable,
        dee: storyDee(),
        onStage: (next) => {
          storyView = { at: 'chapter', id: venue.id, stage: next, justPlayed };
        },
        onIntroSeen: () => void saveStory(markIntroSeen(session.progression.story, venue.id)),
        onLessonDone: () => void saveStory(markLessonDone(session.progression.story, venue.id)),
        onSitDown: () => startStoryTable(venue),
        onOpenFile: () => {
          storyView = { at: 'dossier', id: venue.id };
          render();
        },
        onBack: toMap,
        bossKept: bossKept(venue.id),
        onBossFinish: (clean) => onBossFinish(venue.id, clean),
      });
    }
    const kitchen = chapterOf(story, KITCHEN.id);
    const masq = story.masquerade;
    return renderStoryMap({
      route,
      unmasked,
      dee: storyDee(),
      kitchen: { kept: bossKept(KITCHEN.id), started: kitchen.introSeen },
      masquerade: { unmasked: masq.seats.filter((s) => s.unmaskedOn !== null).length, seats: masq.seats.length, completed: masq.completed },
      onOpenKitchen: () => {
        const p = chapterOf(session.progression.story, KITCHEN.id);
        storyView = { at: 'kitchen', stage: !p.introSeen ? 'intro' : !p.lessonDone ? 'lesson' : 'boss' };
        render();
      },
      onOpenMasquerade: () => openMasquerade(),
      onOpenChapter: (id) => openChapter(id),
      onOpenFile: (id) => {
        storyView = { at: 'dossier', id };
        render();
      },
    });
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

  /** Persist one saved preflop range (upsert by name) so the learner's library survives a restart. */
  async function onSaveRange(range: SavedRange): Promise<void> {
    session = saveRange(session, range);
    await io.saveState(serialize(session));
  }

  /** Persist the deletion of a saved range so the library stays in sync across a restart. */
  async function onDeleteRange(name: string): Promise<void> {
    session = deleteRange(session, name);
    await io.saveState(serialize(session));
  }

  /** Persist one completed puzzle scenario so its best score survives a restart. */
  async function onPuzzleComplete(scenarioId: string, correct: number): Promise<void> {
    session = recordPuzzleResult(session, scenarioId, correct);
    addExtras({ spot: { id: scenarioId, correct } });
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
   * Assemble the Career record's inputs from the SAME already-derived, honest sources the standing and
   * Progress screen use — nothing here is fabricated or computed anew. Activity timestamps are the hand
   * playedAt (absent on legacy hands, filtered out) plus each assessment's `at`, used only to count
   * distinct days practised (career.ts never builds a shame counter from them).
   */
  function buildCareerInput(now: number): CareerInput {
    const masteredKcCount = deriveConcepts().filter((state) => gate(state, now).status === 'mastered').length;
    const handTimestamps = session.hands
      .map((hand) => hand.playedAt)
      .filter((ts): ts is number => typeof ts === 'number');
    const assessmentTimestamps = session.assessments.map((decision) => decision.at);
    return {
      decisions: session.assessments,
      masteredKcCount,
      puzzleCoverage: puzzleCoverage(session.puzzleProgress, puzzleStepCounts),
      depthFloor: session.depthFloor,
      // The RAW stats (vpipHands/pfrHands/leakCostBb) career.ts needs, not the display SessionSummary
      // computeStats derives — biggestLeakOf reads stats.leakCostBb directly.
      stats: session.stats,
      calibration: session.calibration,
      rebuys: session.rebuys,
      assessmentsTaken: session.assessments.length,
      activityTimestamps: [...handTimestamps, ...assessmentTimestamps],
      // The learner's own day (4 am local), not UTC: an evening session belongs to that evening.
      dayKeyOf: systemDayKeyOf(),
    };
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
      // BACKLOG #2 / G2: reach-weight the error-tag family so study priority is `mean(ΔEV) × reach`,
      // not raw session cost — a leak in a spot you reach often outranks an equally costly rare one.
      // Built from the SAME graded hero decisions the leak tally aggregates; empty on a fresh profile,
      // where recommend falls back to the raw-cost leaks unchanged.
      rw: deriveRwReport(),
      recommender: session.recommender,
      now: Date.now(),
    });
    return { suggestion, askPreference: shouldAskPreference(session.recommender) };
  }

  /**
   * The reach-weighted study-priority report (rw.ts) the recommender ranks the error-tag family by.
   * Only graded decisions with a coach principle are leaks (free spots carry a null principle and are
   * skipped, mirroring the raw-cost leak tally); `classDecisionsFor` drops any class the frozen
   * reference table does not cover, so an unexpected principle or street never throws on Home.
   */
  function deriveRwReport(): ReturnType<typeof reachWeightedLoss> {
    const graded: GradedDecision[] = [];
    for (const hand of session.hands) {
      for (const decision of hand.decisions ?? []) {
        const verdict = decision.verdict;
        if (verdict && verdict.principle) {
          graded.push({ street: decision.street, principle: verdict.principle, deltaEvBb: verdict.evLossBb });
        }
      }
    }
    return reachWeightedLoss(classDecisionsFor(graded), REFERENCE_REACH);
  }

  /**
   * Accepting routes the learner at the suggestion's subject. Deliberately conservative: an unknown
   * subject opens the Drill tab rather than doing nothing, because a suggestion whose button is inert
   * is worse than one that lands somewhere sensible.
   */
  async function onAcceptSuggestion(suggestion: Suggestion): Promise<void> {
    session = { ...session, recommender: acceptSuggestion(session.recommender) };
    addExtras({ suggestionTaken: true });
    // The non-error-tag route lands on the Math (drill) rung of the Train hub — the arithmetic trainer
    // that used to be its own tab. error-tag routes to Learn as before.
    if (suggestion.source === 'error-tag') {
      tab = 'learn';
    } else {
      tab = 'train';
      trainMode = 'drill';
    }
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
    paintReadOnly();
    if (tab === 'settings') render();
  }

  async function onSetTutorEnabled(enabled: boolean): Promise<void> {
    await io.setTutorEnabled?.(enabled);
    await refreshSettings();
  }

  async function onDeleteProfile(confirmation: string): Promise<void> {
    deleting = true;
    profileGeneration += 1;
    let outcome: { deleted: boolean } | undefined;
    try {
      outcome = await io.deleteProfile?.(confirmation);
    } finally {
      deleting = false;
    }
    // Only on a real delete: main refuses an unconfirmed call, and dropping the session anyway would
    // destroy in memory exactly what the gate just refused to destroy on disk. On a real delete the
    // session MUST go, or the next save would write the deleted log straight back.
    if (outcome?.deleted === true) {
      session = deserialize({});
      lastSaved = session;
      // Nothing the deleted profile was owed or had open carries over to the fresh one.
      profileGeneration += 1;
      extras = {};
      perception = { day: -1, board: 0 };
      shownGreeting = null;
      shownTicket = null;
      onboardingDraft = null;
      onboardingOpen = false;
      onboardingDismissed = false;
      ticketActive = false;
      rivalOpen = null;
      drillKindNext = null;
      puzzleNext = null;
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

  async function onSoundCuesChange(on: boolean): Promise<void> {
    session = setSoundCues(session, on);
    render();
    await io.saveState(serialize(session));
  }

  async function onThemeChange(theme: string): Promise<void> {
    // Apply optimistically for an instant switch, then reconcile to what main actually stored: it
    // clamps to a known theme, so if the request was unknown the DOM follows the stored value, never
    // the rejected one. This keeps the attribute, the persisted file, and the selector all in sync.
    applyTheme(theme);
    const stored = (await io.setTheme?.(theme)) ?? theme;
    if (stored !== theme) applyTheme(stored);
    settings = { ...settings, theme: stored };
    render();
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
    // A real verdict (non-null) is a costly mistake — the only moment onVerdict fires. Chime it if the
    // learner asked for sound, gated HERE (not in the player) so with it off no AudioContext is ever
    // built, mirroring the speak switch: an off toggle must not touch the audio hardware at all.
    if (message !== null && session.soundCues) soundPlayer.play();
    if (!session.spokenVerdicts) return;
    // Cancel (null) only goes out if something might be talking, so it too stays behind the switch.
    void io.speak?.(message)?.catch(() => undefined);
  }

  function startTable(plan?: SessionPlan, tableSize: TableSize = 4): void {
    teardownTable();
    // A table lives under Play, wherever it was started from (Home's New session, Play's planner, onboarding).
    // A panel left open (friends, online, the assessment, variance) must not cover it (review B1).
    multiplayerActive = false;
    onlineActive = false;
    assessmentActive = false;
    varianceActive = false;
    tab = 'play';
    paintTabs();
    // The session planner (when the learner started from it) models a whole-task live-hand count; a
    // planned session is bounded by it so it honours the plan rather than running forever. The plain
    // New session path passes no plan → undefined → the classic unbounded table.
    const handLimit = plan?.blocks.find((b) => b.kind === 'whole-task')?.units;
    // The table's depth tracks the learner's earned STANDING: a 200bb table is a genuinely different
    // game than a 40bb one (the climb payoff). Calibrating (depth 0) → null → the classic 100bb table.
    // The villains' commitTax (ai.ts) makes them play a deep stack honestly, so this is a real reward,
    // not just a bigger number.
    //
    // AFFORDABILITY BOUND: bankroll is "pocket + chips on the table", modelled around the 5000 sit-down,
    // so a learner may not buy in DEEPER than they can back. Cap the deep stack at the bankroll, floored
    // at the standard 5000 table — so a flush learner sits at full earned depth, an in-between one sits
    // at what they own, and a broke learner still gets the classic table (exactly today's behaviour).
    // Depth 0 stays undefined → renderTable's default, so nothing changes for a Calibrating profile.
    const depthStack = depthToStack(currentStanding(Date.now()).depth, BB);
    const buyIn = affordableStack(depthStack, session.bankroll, START_STACK);
    table = renderTable({
      seed,
      bankroll: session.bankroll,
      handNumber: session.stats.handsPlayed + 1,
      startStack: buyIn ?? undefined,
      handLimit,
      tableSize,
      coachedMode: session.coachedMode,
      onHandComplete: (r) => void onHandComplete(r),
      onRebuy: () => void onRebuy(),
      onGifts: (gifts) => void onGifts(gifts),
      onPrediction: (outcome, confidence) => void onPrediction(outcome, confidence),
      onCoachedModeChange: (on) => void onCoachedModeChange(on),
      onVerdict: (message) => narrate(message),
      dee: {
        context: deeContext(),
        memory: lineMemoryOf(session.progression.dee),
        onMemory: (memory) => {
          // Saved with the hand (onHandComplete runs right after), so this only updates the state.
          session = { ...session, progression: withLineMemory(session.progression, memory) };
        },
        onPerch: (source, pose) => perch.setPose(source, pose),
        onActing: (on) => perch.setActing(on),
      },
      onAskDee: () => openChat(),
      onPriceHeld: (count) => addExtras({ priceHeld: count }),
      // Hero busted out (or the planned hands played): back to Home, where the bankroll and a fresh table are.
      onSessionOver: () => {
        teardownTable();
        go('home');
      },
    });
    screen.replaceChildren(table.root);
  }

  function render(): void {
    // Screens without their own repaint hook (settings toggles, the theme picker, …) rebuild by a
    // full screen swap here, which drops keyboard focus to <body>. Capture the focused control inside
    // `screen` and restore it after the swap. Scoped to `screen`, not `app`, so a real tab switch
    // (focus on a nav button) is left alone — the browser keeps focus on the clicked tab.
    const restoreScreenFocus = beginFocusRestore(screen);
    try {
      renderInner();
    } finally {
      restoreScreenFocus();
    }
  }

  function renderInner(): void {
    paintTabs();

    // Every non-play tab tears the table down: a hand left mounted behind another screen would keep
    // its AI timer running and deal on while nobody is watching it.
    // A chapter table belongs to the Story tab the way a solo table belongs to Play.
    if (tab === 'story' && (storyView.at === 'table' || storyView.at === 'masq-table') && table) {
      teardownReview();
      screen.replaceChildren(table.root);
      return;
    }
    // Leaving the Story tab leaves its table: it is never shown under Play (D17), and the chapter picks up at its table.
    if (storyView.at === 'table' && tab !== 'story') {
      teardownTable();
      storyView = { at: 'chapter', id: storyView.id, stage: 'table', justPlayed: null };
    }
    if (storyView.at === 'masq-table' && tab !== 'story') {
      teardownTable();
      storyView = { at: 'masquerade', said: null };
    }
    if (tab !== 'play' && tab !== 'home') {
      teardownTable();
      teardownReview();
      screen.replaceChildren(renderTab(tab));
      return;
    }

    teardownReview();
    if (tab === 'home') {
      // Home is the launcher; the tables live under Play, so leaving Play for Home leaves its table.
      teardownTable();
      renderHomeTab();
      return;
    }

    // Play tab: the multiplayer panel wins if it is open, then the assessment block, then a live solo
    // table, else home.
    if (onlineActive) {
      screen.replaceChildren(
        renderOnlineScreen({
          bridge: io,
          onOpenPro: () => openProSheet('ranked-play'),
          onExit: () => {
            onlineActive = false;
            openPanel('friends');
            render();
          },
        }),
      );
      return;
    }
    if (multiplayerActive) {
      screen.replaceChildren(
        renderMultiplayerScreen({
          bridge: io,
          onExit: () => {
            multiplayerActive = false;
            go('home');
          },
          onPlayOnline: () => {
            multiplayerActive = false;
            openPanel('online');
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
          // Done returns to Home, the launcher, as it did before the tables moved under Play.
          onExit: () => {
            assessmentActive = false;
            go('home');
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
            go('progress');
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
      renderPlay({
        session,
        onNewSession: () => startTable(),
        onNewSixMax: () => startTable(undefined, 6),
        onStartPlanned: (plan) => startTable(plan),
        onPlayWithFriends: () => {
          openPanel('friends');
          render();
        },
        onStartAssessment: () => {
          openPanel('assessment');
          render();
        },
      }),
    );
  }

  /** Home: first-run onboarding, the Ticket panel, or the launcher with the habit loop. */
  function renderHomeTab(): void {
    if (onboardingDue()) {
      screen.replaceChildren(renderOnboardingSheet());
      return;
    }
    if (ticketActive) {
      screen.replaceChildren(
        renderTicket({
          ticket: (shownTicket = todaysTicket()),
          leakOnFile: costliestPrinciple() !== null,
          today: today(),
          onStart: (item) => startTicketItem(item),
          onBack: () => {
            ticketActive = false;
            render();
          },
        }),
      );
      return;
    }
    screen.replaceChildren(
      renderHome({
        habit: homeHabit(),
        session,
        standing: currentStanding(Date.now()),
        onNewSession: () => startTable(),
        onStartPlanned: (plan) => startTable(plan),
        onPlayWithFriends: () => {
          tab = 'play';
          openPanel('friends');
          render();
        },
        planner: false,
        side: homeSide(),
        storyStrip: renderStoryStrip({
          route: storyRoute(),
          unmasked: (id) => isUnmasked(session.progression.story, venueById(id) as Venue),
          onOpen: () => {
            tab = 'story';
            storyView = { at: 'map' };
            render();
          },
        }),
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
  /**
   * Renders one of the six Train-hub surfaces, with the EXACT props each had as a standalone tab — the
   * screen modules are unchanged, they simply mount inside the hub body now. Called fresh on every rail
   * switch (the hub never caches a node), so the RT-gated Speed screen's timers do not outlive a visit.
   */
  function renderTrainMode(mode: TrainMode): HTMLElement {
    if (mode === 'puzzle') {
      const initialScenarioId = puzzleNext ?? undefined;
      puzzleNext = null;
      return renderPuzzleScreen({
        progress: session.puzzleProgress,
        onComplete: (scenarioId, correct) => void onPuzzleComplete(scenarioId, correct),
        initialScenarioId,
      });
    }
    if (mode === 'repair') {
      return renderContrastScreen({
        hands: session.hands,
        lexicon: session.lexicon,
        onLexiconAttempt: (attempt) => void onLexiconAttempt(attempt),
      });
    }
    if (mode === 'drill') {
      const initialKind = drillKindNext ?? undefined;
      drillKindNext = null;
      return renderDrillScreen({
        fadingLog: session.fadingLog,
        onFadingEvents: (events) => void onFadingEvents(events),
        initialKind,
      });
    }
    if (mode === 'anomaly') {
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
    if (mode === 'charts') {
      return renderCharts({
        mastery: session.chartMastery,
        onAnswer: (handClass, correct) => void onChartAnswer(handClass, correct),
        onSpot: (spotClass, module, correct) => void onInterleaveSpot(spotClass, module, correct),
      });
    }
    if (mode === 'reading') return renderHandReadingDrill();
    if (mode === 'board') {
      return renderBoardReadingDrill({
        // Sight answers are not persisted; the one that completes the Ticket's drill item saves it.
        onAnswer: () => {
          if (onSightAnswer()) void io.saveState(serialize(session));
        },
      });
    }
    if (mode === 'robustness') return renderRobustnessScreen();
    // 'spacing' (Upkeep): real graded history grouped into per-concept states (see deriveConcepts). On a
    // fresh profile the log is empty and the screen says so.
    return renderSpacing({ concepts: deriveConcepts(), now: Date.now() });
  }

  /**
   * The muted, zero-suppressed count a maintenance rung shows after its label. Both are REAL pending
   * work the app already computes for the screens themselves — Leaks reads the remediation queue the
   * repair screen builds, Upkeep the due-rep count the spacing screen shows — so the rail never
   * fabricates a number. Zero returns null (the hub then shows nothing), so a fresh profile's empty
   * rungs stay bare rather than announcing "0 to fix".
   */
  function trainNote(mode: TrainMode): string | null {
    if (mode === 'repair') {
      // remediationQueue returns the WHOLE manifest (fired entries first, then the rest as null), so its
      // length is constant — the honest count is only the entries a real leak actually FIRED.
      const n = remediationQueue(session.hands).filter((q) => q.firedBy !== null).length;
      return n > 0 ? `${n} to fix` : null;
    }
    if (mode === 'spacing') {
      const n = dueNow(deriveConcepts(), Date.now()).length;
      return n > 0 ? `${n} due` : null;
    }
    return null;
  }

  /** Builds the hub's mode list, binding each rung to its fresh-render thunk, old testid and any count. */
  function renderTrainTab(): HTMLElement {
    const modes: TrainModeSpec[] = TRAIN_MODES.map((m) => ({
      id: m.mode,
      label: m.label,
      testid: m.testid,
      band: m.band,
      note: trainNote(m.mode),
      render: () => renderTrainMode(m.mode),
    }));
    return renderTrainScreen({ modes, initialMode: trainMode });
  }

  /** A destination's screen, inside its section's sub-nav when it has one (Study, You). */
  function renderTab(which: Exclude<Tab, 'play' | 'home'>): HTMLElement {
    const body = renderLeaf(which);
    const items = subNavOf(which);
    if (items === null) return body;
    const study = sectionOf(which) === 'study';
    return renderSubNav({
      title: study ? 'Study' : YOU_TITLE[litSubItem(which)] ?? 'You',
      note: study ? 'Reference tools: nothing here is graded' : which === 'profile' ? 'Everything here stays on this Mac' : undefined,
      items,
      lit: litSubItem(which),
      onPick: (leaf) => go(leaf),
      body,
      testid: study ? 'study-nav' : 'you-nav',
    });
  }

  function renderLeaf(which: Exclude<Tab, 'play' | 'home'>): HTMLElement {
    if (which === 'hands') return renderProfileTab();
    // Profile's Edit opens the answers in place, so Save and Cancel come back to Profile (review N2).
    if (which === 'profile' && onboardingOpen) return renderOnboardingSheet(true);
    if (which === 'profile') return renderYouProfileTab();
    if (which === 'trophies') {
      const facts = milestoneFacts(session, session.progression, SCENARIOS, masteredIds(deriveConcepts(), now()).length);
      const views = milestoneViews(session.progression.milestones, facts);
      return renderTrophies(views, nextUp(views, 4));
    }
    if (which === 'rivals') return renderRivalsTab();
    if (which === 'locker') return renderLockerTab();
    if (which === 'style') return renderStyleTab();
    if (which === 'letters') return renderLettersTab();
    if (which === 'learn') {
      if (learnView === 'folio') {
        return renderFolio({
          cards: currentFolio(),
          onPolish: (conceptId) => {
            addExtras({ polished: [conceptId] });
            void io.saveState(serialize(session)).then(() => render());
          },
          onWrite: () => {
            learnView = 'lessons';
            render();
          },
          copy: navigator.clipboard ? (text) => navigator.clipboard.writeText(text) : undefined,
        });
      }
      const cards = currentFolio();
      return renderLessonScreen({
        folio: {
          count: cards.length,
          toPolish: cards.filter((c) => c.tarnished).length,
          onOpen: () => {
            learnView = 'folio';
            render();
          },
        },
        dee: {
          tone: deeContext().tone,
          character: session.progression.dee.character,
          onRule: (lessonId, text) =>
            void saveProgression(rememberRule(session.progression, lessonId, text, systemDayKeyOf()(Date.now()))),
        },
      });
    }
    if (which === 'dee' && onboardingOpen) return renderOnboardingSheet(true);
    if (which === 'dee') {
      const remembered = session.progression.dee.ruleSentences;
      phrasingRow = phrasing
        ? renderPhrasingRow(phrasing, {
            download: (consent, licences) => void io.deePhrasingDownload?.(consent, licences).then((v) => phrasingRow?.update((phrasing = v))),
            cancel: () => void io.deePhrasingCancel?.(),
            remove: () => void io.deePhrasingDelete?.().then((v) => phrasingRow?.update((phrasing = v))),
            setEnabled: (on) => void io.deePhrasingSetEnabled?.(on).then((v) => phrasingRow?.update((phrasing = v))),
          })
        : null;
      return renderDeeSettings({
        phrasing: phrasingRow?.root,
        // Reopened here, in Dee's settings, never over the Play tab: a live table is left exactly as it was.
        onRedoOnboarding: () => {
          onboardingOpen = true;
          render();
        },
        context: deeContext(),
        rulesRemembered: remembered.length,
        newestRule: remembered.length > 0 ? remembered[remembered.length - 1].text : null,
        handlers: {
          onTone: (tone) => void saveProgression(setTone(session.progression, tone)),
          onFrequency: (frequency) => void saveProgression(setFrequency(session.progression, frequency)),
          onCharacter: (on) => void saveProgression(setCharacter(session.progression, on)),
          onForgetRules: () => void saveProgression(forgetRules(session.progression)),
        },
      });
    }
    if (which === 'train') return renderTrainTab();
    if (which === 'story') return renderStoryTab();
    if (which === 'chart-bank') return renderChartBank();
    if (which === 'equity') return renderEquityCalculator();
    if (which === 'ranges') {
      return renderRangeEditor({
        ranges: session.savedRanges,
        onSave: (range) => void onSaveRange(range),
        onDelete: (name) => void onDeleteRange(name),
      });
    }
    if (which === 'dossier') return renderDossier();
    if (which === 'pro') {
      return renderProTools({
        pro,
        bridge: io,
        openSheet: openProSheet,
        // Charts is a Train rung since the 7-tab nav (1.14).
        onPractise: () => {
          trainMode = 'charts';
          go('train');
        },
      });
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
          openPanel('variance');
          tab = 'play';
          render();
        },
        onStartAssessment: () => {
          openPanel('assessment');
          tab = 'play';
          render();
        },
      });
    }
    if (which === 'settings') {
      return renderSettings({
        status: settings,
        spokenVerdicts: session.spokenVerdicts,
        soundCues: session.soundCues,
        handlers: {
          onSetTutorEnabled: (enabled) => void onSetTutorEnabled(enabled),
          onDeleteProfile: (confirmation) => void onDeleteProfile(confirmation),
          onSpokenVerdictsChange: (on) => void onSpokenVerdictsChange(on),
          onSoundCuesChange: (on) => void onSoundCuesChange(on),
          onThemeChange: (theme) => void onThemeChange(theme),
          onOpenDee: () => go('dee'),
        },
        proSection: renderProSettings(pro, { openSheet: openProSheet }),
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

    if (profileView.at === 'career') {
      return renderCareer({
        record: careerRecord(buildCareerInput(Date.now()), Date.now()),
        onBack: () => goto({ at: 'profile' }),
      });
    }

    return renderProfile({
      session,
      onOpenReview: () => goto({ at: 'picker' }),
      onOpenCareer: () => goto({ at: 'career' }),
    });
  }

  /** Onboarding's five sheets. Skip or finish saves what was answered, once; finishing deals the first hand. */
  function renderOnboardingSheet(fromSettings = false): HTMLElement {
    const p = session.progression;
    return renderOnboarding({
      initial: onboardingDraft ? { ...onboardingDraft.personalization, answeredOn: p.personalization.answeredOn } : p.personalization,
      tone: onboardingDraft?.tone ?? effectiveTone(p.dee.personality),
      spokenVerdicts: onboardingDraft?.spokenVerdicts ?? session.spokenVerdicts,
      finishLabel: fromSettings ? 'Save' : undefined,
      onDraft: (draft) => {
        onboardingDraft = draft;
      },
      onCancel: fromSettings
        ? () => {
            onboardingOpen = false;
            onboardingDraft = null;
            render();
          }
        : undefined,
      onDone: (result, finished) => {
        onboardingOpen = false;
        onboardingDismissed = true;
        onboardingDraft = null;
        session = setSpokenVerdicts(session, result.spokenVerdicts);
        session = {
          ...session,
          progression: {
            ...setTone(session.progression, result.tone),
            personalization: { ...result.personalization, answeredOn: p.personalization.answeredOn ?? today() },
          },
        };
        void io.saveState(serialize(session));
        if (finished && !fromSettings) startTable();
        else render();
      },
    });
  }

  /** Home's second column under the streak: the next trophy and the rule the learner wrote most recently. */
  function homeSide(): HTMLElement[] {
    const facts = milestoneFacts(session, session.progression, SCENARIOS, masteredIds(deriveConcepts(), now()).length);
    const [next] = nextUp(milestoneViews(session.progression.milestones, facts), 1);
    const out: HTMLElement[] = [];
    const group = document.createElement('div');
    group.className = 'g-group home-week';
    if (next) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'g-row session-card';
      row.dataset.testid = 'home-next-trophy';
      const text = document.createElement('span');
      text.className = 'session-card-text';
      const t = document.createElement('span');
      t.className = 'session-card-title t-head';
      t.textContent = `Next trophy: ${next.def.name}`;
      const m = document.createElement('span');
      m.className = 'session-card-meta g-caption';
      m.textContent = `${next.def.fact}; ${next.value} of ${next.target} ${next.unit}`;
      text.append(t, m);
      row.append(text, chevron());
      row.addEventListener('click', () => go('trophies'));
      group.appendChild(row);
    }
    const cards = currentFolio();
    const rule = [...cards].sort((a, b) => b.writtenOn - a.writtenOn)[0];
    const r = document.createElement('button');
    r.type = 'button';
    r.className = 'g-row session-card';
    r.dataset.testid = 'home-rule';
    const rt = document.createElement('span');
    rt.className = 'session-card-text';
    const q = document.createElement('span');
    q.className = 'session-card-title t-head';
    q.textContent = rule ? `“${rule.text}”` : 'The Rulebook';
    const qm = document.createElement('span');
    qm.className = 'session-card-meta g-caption';
    qm.textContent = rule ? `Your newest rule · ${cards.length} in the Rulebook` : 'Your rules, in your own words, land here';
    rt.append(q, qm);
    r.append(rt, chevron());
    r.addEventListener('click', () => {
      go('learn');
      learnView = 'folio';
      render();
    });
    group.appendChild(r);
    out.push(group);
    return out;
  }

  function renderYouProfileTab(): HTMLElement {
    const p = session.progression;
    const t = now();
    const concepts = deriveConcepts();
    const activity = [...session.hands.map((h) => h.playedAt).filter((x): x is number => typeof x === 'number'), ...session.assessments.map((a) => a.at)];
    const since = activity.length > 0 ? dayOf()(activity.reduce((a, b) => Math.min(a, b))) : null;
    const graded = session.hands.reduce((n, h) => n + (h.decisions ?? []).filter((d) => d.verdict !== null).length, 0) + session.assessments.length;
    const streak = streakToday(p, today());
    return renderYouProfile(
      {
        personalization: p.personalization,
        since,
        handsPlayed: session.stats.handsPlayed,
        gradedDecisions: graded,
        cards: currentFolio(),
        weeks: weeklyEvLoss(session.assessments, t),
        sureRight: sureRight(session.calibration),
        sureTotal: session.calibration.sureTotal,
        conceptsMastered: masteredIds(concepts, t).length,
        conceptsTotal: concepts.length,
        depthLabel: currentStanding(t).label,
        streak: { current: streak.current, best: streak.best },
        repsTotal: p.reps.total,
        keepsakes: keepsakeShelf(p.story),
      },
      {
        onEdit: () => {
          onboardingOpen = true;
          render();
        },
        onOpenFolio: () => {
          go('learn');
          learnView = 'folio';
          render();
        },
        onOpenProgress: () => go('progress'),
        onOpenTrophies: () => go('trophies'),
        onOpenKeepsake: (room) => openRoom(room),
      },
    );
  }

  /** You › Style: the engine's read of the hand log, the unmasked regulars on the same map, and the card to keep. */
  function renderStyleTab(): HTMLElement {
    const read = styleRead(session.hands, dayOf());
    const story = session.progression.story;
    const rivals = VENUES.filter((v) => isUnmasked(story, v)).map((v) => {
      const r = rivalOf(v);
      return { name: r.name, style: ARCHETYPE_STYLE[r.archetype] };
    });
    return renderStyle({
      read,
      name: session.progression.personalization.displayName,
      week: read.since === null ? null : Math.floor((weekOf(today()) - weekOf(read.since)) / 7) + 1,
      rivals,
      onSave: io.saveStyleCard
        ? (card) => {
            const r = card.getBoundingClientRect();
            return (io.saveStyleCard as NonNullable<OffsuitBridge['saveStyleCard']>)({ x: r.x, y: r.y, width: r.width, height: r.height });
          }
        : null,
      onOpenLeakFinder: () => go('pro'),
    });
  }

  function letterInput(): LetterInput {
    const p = session.progression;
    const sittings = VENUES.flatMap((v) =>
      rivalRecordOf(p.story, v).sittings.map((s) => ({ day: s.day, venue: v.name, judged: s.judged, free: s.free })),
    );
    // A regular whose sittings reached the cap has dropped older ones: the story is whole only after its oldest kept.
    const capped = VENUES.map((v) => rivalRecordOf(p.story, v).sittings).filter((list) => list.length >= MAX_RIVAL_SITTINGS && list.length > 0);
    const sittingsWholeFrom = capped.length > 0 ? (Math.max(...capped.map((list) => list[0].day + 1)) as DayKey) : null;
    return {
      hands: session.hands,
      assessments: session.assessments,
      rules: currentFolio().map((c) => ({ text: c.text, day: c.writtenOn })),
      milestones: p.milestones.achieved,
      sittings,
      sittingsWholeFrom,
      leakPrinciple: costliestPrinciple(),
      dayOf: dayOf(),
    };
  }

  /** You › Letters. Ended weeks are filed on every save and again as the page opens, so a letter reads the same ever after. */
  function renderLettersTab(): HTMLElement {
    const p = session.progression;
    const input = letterInput();
    // A read-only profile files nothing: the store would refuse it, and a letter must not exist only in memory.
    const letters = settings.profile.readOnly == null ? fileLetters(p.letters, input, today()) : p.letters;
    if (letters !== p.letters) void saveProgression({ ...session.progression, letters });
    return renderLetters({
      draft: draftLetter(letters, input, today()),
      filed: letters.filed,
      name: p.personalization.displayName,
      tone: effectiveTone(p.dee.personality),
      leakPrinciple: costliestPrinciple(),
      milestoneName: (id) => milestoneById(id)?.name ?? null,
      onOpenTicket: () => go('home'),
    });
  }

  /**
   * The Locker. What has been earned is filed on save; anything earned and not filed yet (a profile from before this
   * build) shows as earned here, and the equip's own save files its receipt.
   */
  function renderLockerTab(): HTMLElement {
    const p = session.progression;
    const earn: EarnContext = {
      milestones: p.milestones,
      seals: p.seals,
      story: p.story,
      facts: milestoneFacts(session, p, SCENARIOS, masteredIds(deriveConcepts(), now()).length),
    };
    const cosmetics = syncCosmetics(p.cosmetics, earn, today());
    return renderLocker({
      cosmetics,
      earn,
      slot: lockerSlot,
      onSlot: (slot) => {
        lockerSlot = slot;
        render();
      },
      onEquip: (itemId) => {
        const next = equip(cosmetics, itemId);
        if (next === cosmetics) return;
        void saveProgression({ ...session.progression, cosmetics: next }).then(() => {
          render();
          // The button is disabled once its item is worn, so the keyboard lands on the worn item's tile instead of <body>.
          document.querySelector<HTMLElement>(`[data-testid="locker-item"][data-id="${CSS.escape(itemId)}"]`)?.focus();
        });
      },
    });
  }

  /** The story's regulars, masked until beaten; a row opens the existing dossier, which returns here. */
  function renderRivalsTab(): HTMLElement {
    const story = session.progression.story;
    if (rivalOpen !== null) {
      const venue = venueById(rivalOpen) as Venue;
      return renderRivalDossier({
        venue,
        unmasked: isUnmasked(story, venue),
        record: rivalRecordOf(story, venue),
        dee: storyDee(),
        onOpenChapter: () => {
          rivalOpen = null;
          go('story');
          openChapter(venue.id);
        },
        onBack: () => {
          rivalOpen = null;
          render();
        },
      });
    }
    return renderRivals(
      VENUES.map((v) => {
        const unmasked = isUnmasked(story, v);
        const r = rivalOf(v);
        return { id: v.id, venue: v.name, name: unmasked ? r.name : null, style: unmasked ? r.style : null, hands: rivalRecordOf(story, v).hands };
      }),
      (id) => {
        rivalOpen = id as ChapterId;
        render();
      },
    );
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
