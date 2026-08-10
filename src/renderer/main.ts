import './styles.css';
import './styles-panels.css';
import './styles-screens.css';
import './styles-settings.css';

import type { HandRecord, SessionState } from '../core/session.js';
import {
  deserialize,
  rebuy,
  recordHand,
  recordPrediction,
  serialize,
  setCoachedMode,
  setSpokenVerdicts,
} from '../core/session.js';
import type { PredictOutcome } from '../core/predict.js';
import { renderHome } from './screens/home.js';
import { renderProfile } from './screens/profile.js';
import { renderLessonScreen } from './screens/lesson.js';
import { renderCharts } from './screens/charts.js';
import { renderDrillScreen } from './screens/drill.js';
import { renderRobustnessScreen } from './screens/robustness.js';
import { renderReview, renderReviewList, type ReviewHandle } from './screens/review.js';
import { renderSettings, type SettingsStatus } from './screens/settings.js';
import { renderTable, type TableHandle } from './screens/table.js';

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

type Tab = 'play' | 'learn' | 'drill' | 'robustness' | 'charts' | 'profile' | 'settings';

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
  { id: 'drill', label: 'Drill', testid: 'tab-drill' },
  { id: 'robustness', label: 'Robustness', testid: 'tab-robustness' },
  { id: 'charts', label: 'Charts', testid: 'tab-charts' },
  { id: 'profile', label: 'Profile', testid: 'tab-profile' },
  { id: 'settings', label: 'Settings', testid: 'tab-settings' },
];

async function boot(): Promise<void> {
  const io = bridge();
  const seed = (await io.getSeed()) ?? DEFAULT_SEED;
  let session: SessionState = deserialize(await io.loadState());

  let tab: Tab = 'play';
  let table: TableHandle | null = null;
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

  async function onPrediction(outcome: PredictOutcome): Promise<void> {
    session = recordPrediction(session, outcome);
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
      onPrediction: (outcome) => void onPrediction(outcome),
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

    // Play tab: keep a live table mounted if there is one, else the home screen.
    if (table) {
      screen.replaceChildren(table.root);
      return;
    }
    screen.replaceChildren(
      renderHome({
        session,
        onNewSession: () => startTable(),
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
    if (which === 'charts') return renderCharts();
    if (which === 'drill') return renderDrillScreen();
    if (which === 'robustness') return renderRobustnessScreen();
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
