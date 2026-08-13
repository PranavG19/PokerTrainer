import { app, BrowserWindow, ipcMain, session } from 'electron';
import * as path from 'node:path';
import { DELETE_CONFIRM_PHRASE } from '../core/backup.js';
import { sealNetwork, silenceChromium } from './network.js';
import { cancelSpeech, speak } from './speech.js';
import {
  deleteProfile,
  load,
  loadMultiplayerEnabled,
  loadTutorEnabled,
  profileStatus,
  save,
  saveMultiplayerEnabled,
  saveTutorEnabled,
} from './store.js';
import { askTutor, resolveTutor, type AskInput, type ResolvedTutor } from './tutor/index.js';
import { nullModelClient, nullTutor } from './tutor/nullTutor.js';
import { hostSession, joinSession, type RelaySession } from './relaySession.js';
import type { Action } from '../core/table.js';
import type { RoomView } from '../core/multiplayer.js';

let mainWindow: BrowserWindow | null = null;

/**
 * Resolved once at startup from the environment. With no Bedrock settings this
 * is the null tutor and the egress allowlist is empty (T1, Security section).
 */
const configured = resolveTutor(process.env);

/**
 * The off switch, story 45. Structural rather than a flag consulted at call
 * time: turning it off substitutes the *null tutor and an empty allowlist*, and
 * nullTutor's module graph holds nothing that can open a socket — the same
 * property that makes the no-credentials case zero-network. A later bug in the
 * ask path therefore cannot leak, because there is no client to leak through.
 */
let tutorEnabled = loadTutorEnabled();

/**
 * Multiplayer opt-in and the single live session (host or join), if any. Defaults OFF: multiplayer
 * opens a socket, so a fresh profile is never networkable and the seal stays total. Every host/join
 * entry point re-checks this flag, so turning it off is structural — with it off there is no code path
 * that opens a socket.
 */
let multiplayerEnabled = loadMultiplayerEnabled();
let relaySession: RelaySession | null = null;

/**
 * Push a multiplayer event to the renderer. The relay server BROADCASTS unprompted (a remote player
 * acting moves everyone's state), so unlike the request/response tutor this is a one-way channel from
 * main to the renderer via webContents.send.
 */
function pushMultiplayerEvent(event: { type: 'state'; view: RoomView } | { type: 'error'; reason: string }): void {
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mp:event', event);
  }
}

/** Tear down any live session — on stop, on a new host/join, and on quit. */
async function stopRelaySession(): Promise<void> {
  const session = relaySession;
  relaySession = null;
  await session?.stop();
}

function activeTutor(): ResolvedTutor {
  if (tutorEnabled) return configured;
  return {
    tutor: nullTutor,
    credentialsConfigured: configured.credentialsConfigured,
    egressAllowlist: [],
    guardFailures: configured.guardFailures,
    // Off means the null (no-network) client too, same structural guarantee as the
    // null tutor: a follow-up while disabled has no client to leak through.
    client: nullModelClient,
  };
}

function parseSeedArg(): number | null {
  const arg = process.argv.find(a => a.startsWith('--seed='));
  if (!arg) return null;
  const n = parseInt(arg.split('=')[1], 10);
  return Number.isFinite(n) ? n : null;
}

const seed = parseSeedArg();

/**
 * Set by tests/e2e/helpers.ts on every launch. It governs presentation ONLY — window activation and
 * the Dock icon — and nothing about behaviour, so a test still exercises the same app a person runs.
 */
const isE2E = process.env.OFFSUIT_E2E === '1';

/**
 * Before `whenReady`, or the switches are read too late to take effect. Chromium's own background
 * network users are turned off here; the seal in `sealNetwork()` is what catches anything that tries
 * anyway (src/main/network.ts explains why one window's session was not enough).
 */
silenceChromium();

/**
 * AT MODULE SCOPE, NOT IN `whenReady` — and that placement is the whole fix. On macOS a GUI app
 * ACTIVATES as it launches, which is what pulls focus away from whoever is at the keyboard; the
 * window's own `showInactive()` does not prevent it, because the app is what activated, not the
 * window. Hiding the Dock icon switches the process to an accessory activation policy, so it never
 * becomes the active app at all — but only if it happens before the app is ready. Called from inside
 * `whenReady` it runs after activation has already happened, which is the version I shipped first and
 * which still stole focus on every one of ~370 launches.
 *
 * The window stays fully real and renderable: 30 spec files screenshot it and the layout tests measure
 * its geometry, so headless and `offscreen` are both out.
 */
if (isE2E) app.dock?.hide();

/**
 * Park the test window off the visible desktop, keeping its SIZE exactly as the caller set it.
 *
 * `setBounds` after creation rather than `x` in the BrowserWindow constructor: macOS CLAMPS the
 * constructor coordinate onto a visible display, so `x: -3400` silently became x=0 and the window
 * appeared in the top-left corner (measured — the constructor version reported
 * `{x:0, y:25, width:1100, height:760}`).
 *
 * Re-applied on every resize, because `setSize` re-centres the window and would drag it back on
 * screen; the layout tests resize to 1100x760 and 900x640 on purpose, so this has to hold across both.
 * Width and height are read back from the window rather than assumed, so parking never changes the
 * geometry those tests measure.
 */
function moveOffScreen(win: BrowserWindow | null): void {
  if (win === null || win.isDestroyed()) return;
  const { width, height } = win.getBounds();
  /*
   * Large values on purpose. macOS refuses to hide a window completely — it clamps the position so
   * roughly 40px stays on screen no matter what is asked for (measured: x=-4000 became x=-1060 for a
   * 1100px window, y=4000 became y=1376 on a 1440px display). So the goal is not "invisible", which is
   * not available, but "the far bottom-right corner", where a 40px sliver sits under whatever is in
   * front instead of over the top-left where the eye and the menu bar are.
   */
  win.setBounds({ x: OFFSCREEN_X, y: OFFSCREEN_Y, width, height });
}

const OFFSCREEN_X = 100_000;
const OFFSCREEN_Y = 100_000;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#000000',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      // .cjs: Electron's sandboxed preload requires CommonJS, but the package is "type": "module".
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  /*
   * Network blocking used to live HERE, as onBeforeSendHeaders on this one window's session. It is now
   * sealNetwork() over defaultSession plus every session created later, at onBeforeRequest — the
   * placement PRODUCT-SPEC's Security section requires, because a per-window header hook governs
   * neither Chromium's own traffic nor any session but this one. See src/main/network.ts.
   */

  mainWindow.loadFile(path.join(import.meta.dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    /*
     * UNDER E2E THE WINDOW RENDERS BUT NEVER TAKES FOCUS. A suite launches the app hundreds of times,
     * and each `show()` pulls the active window away from whoever is at the keyboard — unusable
     * alongside a tiling window manager.
     *
     * `showInactive()` rather than headless or `offscreen`, because 30 spec files screenshot the real
     * window and the layout tests measure real geometry against the documented 1100x760 / 900x640
     * sizes. An offscreen window has neither. This keeps the window fully real and only declines the
     * activation.
     */
    if (isE2E) {
      mainWindow?.showInactive();
      moveOffScreen(mainWindow);
      return;
    }
    mainWindow?.show();
  });

  /*
   * The layout tests resize the real window, and macOS re-centres it on the active display when they
   * do — which would put it back in front of whatever the user is working on. Re-parking on every
   * resize is what keeps it away for the whole run.
   */
  if (isE2E) {
    mainWindow.on('resize', () => {
      moveOffScreen(mainWindow);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Set CSP via session headers
app.whenReady().then(() => {
  // Before the window exists, so nothing can be requested during load that the seal has not seen.
  sealNetwork();

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'"],
      },
    });
  });

  ipcMain.handle('store:load', () => load());
  ipcMain.handle('store:save', (_event, obj: Record<string, unknown>) => save(obj));
  ipcMain.handle('app:seed', () => seed);

  ipcMain.handle('tutor:status', () => {
    const active = activeTutor();
    return {
      tutorId: active.tutor.id,
      credentialsConfigured: active.credentialsConfigured,
      egressAllowlist: active.egressAllowlist,
      guardFailures: active.guardFailures.length,
    };
  });
  ipcMain.handle('tutor:ask', (_event, input: AskInput) => askTutor(activeTutor(), input));

  /**
   * Everything the settings screen states about egress is read from the resolved
   * tutor here rather than restated in renderer copy, so the screen cannot drift
   * from what the app would actually do.
   */
  ipcMain.handle('settings:read', () => {
    const active = activeTutor();
    return {
      tutorEnabled,
      tutorId: active.tutor.id,
      credentialsConfigured: active.credentialsConfigured,
      egressAllowlist: active.egressAllowlist,
      guardFailures: active.guardFailures,
      profile: profileStatus(),
      deleteConfirmPhrase: DELETE_CONFIRM_PHRASE,
    };
  });

  ipcMain.handle('settings:setTutorEnabled', (_event, enabled: boolean) => {
    tutorEnabled = enabled === true;
    saveTutorEnabled(tutorEnabled);
    return tutorEnabled;
  });

  // ── Multiplayer (local relay) ──────────────────────────────────────────────
  // The opt-in is the structural gate: host/join refuse while it is off, so with multiplayer disabled
  // there is no path that opens a socket and the network seal is intact (no-network.spec stays green).

  ipcMain.handle('mp:status', () => ({ enabled: multiplayerEnabled, active: relaySession !== null }));

  ipcMain.handle('mp:setEnabled', async (_event, enabled: boolean) => {
    multiplayerEnabled = enabled === true;
    saveMultiplayerEnabled(multiplayerEnabled);
    // Turning it off must also drop any live session — leaving a socket open would defeat the switch.
    if (!multiplayerEnabled) await stopRelaySession();
    return multiplayerEnabled;
  });

  const sessionCallbacks = {
    onState: (view: RoomView) => pushMultiplayerEvent({ type: 'state', view }),
    onError: (reason: string) => pushMultiplayerEvent({ type: 'error', reason }),
  };

  ipcMain.handle('mp:host', async (_event, opts: { seatCount?: number }) => {
    if (!multiplayerEnabled) return { error: 'multiplayer is off' };
    await stopRelaySession();
    const seatCount = Math.min(6, Math.max(2, Math.floor(opts?.seatCount ?? 3)));
    const { session, info } = await hostSession(
      { roomId: 'local', seatCount, sb: 25, bb: 50, startStack: 5000, seed: seed ?? 1 },
      sessionCallbacks,
    );
    relaySession = session;
    return { port: info.port, addresses: info.addresses };
  });

  ipcMain.handle('mp:join', async (_event, address: { host: string; port: number; name?: string }) => {
    if (!multiplayerEnabled) return { error: 'multiplayer is off' };
    if (typeof address?.host !== 'string' || !Number.isFinite(address?.port)) {
      return { error: 'a host and port are required' };
    }
    await stopRelaySession();
    relaySession = joinSession(
      { host: address.host, port: Math.floor(address.port) },
      typeof address.name === 'string' ? address.name : 'Guest',
      sessionCallbacks,
    );
    return { joined: true };
  });

  ipcMain.handle('mp:action', (_event, action: Action) => {
    relaySession?.action(action);
  });

  ipcMain.handle('mp:deal', () => {
    relaySession?.dealNext();
  });

  ipcMain.handle('mp:stop', async () => {
    await stopRelaySession();
  });

  // The gate is here and in core/backup.ts, never in the renderer: a UI bug must
  // not be able to destroy the decision log.
  ipcMain.handle('settings:deleteProfile', (_event, confirmation: unknown) =>
    deleteProfile(typeof confirmation === 'string' ? confirmation : ''),
  );

  /**
   * Narration — ONE channel. No egress: /usr/bin/say is a local binary, spawned with the verdict as
   * an argv element and no shell. `null` means stop talking, which is what turning the toggle off or
   * leaving the table sends; anything else is a verdict to read.
   *
   * The handler never rejects. A failed utterance resolves with a reason the renderer can display,
   * because the verdict is already readable on screen and speech must not be able to break a hand.
   */
  ipcMain.handle('speech:speak', (_event, text: unknown) => {
    if (text === null) {
      cancelSpeech();
      return { spoken: false, reason: 'cancelled' };
    }
    return speak(text);
  });

  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

/**
 * A voice must not outlive the app that started it. `say` is a separate process and does NOT die
 * with its parent, so quitting mid-verdict otherwise leaves macOS reading poker advice aloud to an
 * empty desk with no window left to stop it. Same rule as leaving the table: when the panel holding
 * the verdict is gone, so is the voice reading it.
 */
app.on('will-quit', () => {
  cancelSpeech();
  // A relay socket must not outlive the app that opened it: drop any live host/join on quit.
  void stopRelaySession();
});
