import './styles.css';
import './styles-panels.css';
import './styles-screens.css';

import type { HandRecord, SessionState } from '../core/session.js';
import {
  deserialize,
  rebuy,
  recordHand,
  recordPrediction,
  serialize,
  setCoachedMode,
} from '../core/session.js';
import type { PredictOutcome } from '../core/predict.js';
import { renderHome } from './screens/home.js';
import { renderProfile } from './screens/profile.js';
import { renderTable, type TableHandle } from './screens/table.js';

const DEFAULT_SEED = 42;

interface OffsuitBridge {
  loadState: () => Promise<Record<string, unknown>>;
  saveState: (obj: Record<string, unknown>) => Promise<void>;
  getSeed: () => Promise<number | null>;
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

type Tab = 'play' | 'profile';

async function boot(): Promise<void> {
  const io = bridge();
  const seed = (await io.getSeed()) ?? DEFAULT_SEED;
  let session: SessionState = deserialize(await io.loadState());

  let tab: Tab = 'play';
  let table: TableHandle | null = null;

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
      render();
    });
    return b;
  };

  function teardownTable(): void {
    table?.destroy();
    table = null;
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
      // Hero busted out: drop back to home, where a fresh table can be started.
      onSessionOver: () => {
        teardownTable();
        render();
      },
    });
    screen.replaceChildren(table.root);
  }

  function render(): void {
    const play = tabButton('Play', 'play', 'tab-play');
    const profile = tabButton('Profile', 'profile', 'tab-profile');
    play.dataset.active = String(tab === 'play');
    profile.dataset.active = String(tab === 'profile');
    nav.replaceChildren(play, profile);

    if (tab === 'profile') {
      teardownTable();
      screen.replaceChildren(renderProfile({ session }));
      return;
    }

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

  render();
}

void boot();
