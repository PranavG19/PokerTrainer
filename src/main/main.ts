import { app, BrowserWindow, ipcMain, session } from 'electron';
import * as path from 'node:path';
import { DELETE_CONFIRM_PHRASE } from '../core/backup.js';
import { cancelSpeech, speak } from './speech.js';
import {
  deleteProfile,
  load,
  loadTutorEnabled,
  profileStatus,
  save,
  saveTutorEnabled,
} from './store.js';
import { askTutor, resolveTutor, type AskInput, type ResolvedTutor } from './tutor/index.js';
import { nullTutor } from './tutor/nullTutor.js';

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

function activeTutor(): ResolvedTutor {
  if (tutorEnabled) return configured;
  return {
    tutor: nullTutor,
    credentialsConfigured: configured.credentialsConfigured,
    egressAllowlist: [],
    guardFailures: configured.guardFailures,
  };
}

function parseSeedArg(): number | null {
  const arg = process.argv.find(a => a.startsWith('--seed='));
  if (!arg) return null;
  const n = parseInt(arg.split('=')[1], 10);
  return Number.isFinite(n) ? n : null;
}

const seed = parseSeedArg();

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

  // Block all network access
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.url.startsWith('file://')) {
      callback({ cancel: false });
    } else {
      callback({ cancel: true });
    }
  });

  mainWindow.loadFile(path.join(import.meta.dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Set CSP via session headers
app.whenReady().then(() => {
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
});
