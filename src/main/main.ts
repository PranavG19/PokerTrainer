import { app, BrowserWindow, ipcMain, session } from 'electron';
import * as path from 'node:path';
import { load, save } from './store.js';
import { askTutor, resolveTutor, type AskInput } from './tutor/index.js';

let mainWindow: BrowserWindow | null = null;

/**
 * Resolved once at startup from the environment. With no Bedrock settings this
 * is the null tutor and the egress allowlist is empty (T1, Security section).
 */
const tutor = resolveTutor(process.env);

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

  ipcMain.handle('tutor:status', () => ({
    tutorId: tutor.tutor.id,
    credentialsConfigured: tutor.credentialsConfigured,
    egressAllowlist: tutor.egressAllowlist,
    guardFailures: tutor.guardFailures.length,
  }));
  ipcMain.handle('tutor:ask', (_event, input: AskInput) => askTutor(tutor, input));

  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
