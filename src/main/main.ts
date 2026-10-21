// First, before any module that could open a socket: the test-mode network recorder (no-op unless
// OFFSUIT_NET_ORACLE is set). See netOracle.ts.
import './netOracle.js';
import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import * as path from 'node:path';
import { DELETE_CONFIRM_PHRASE } from '../core/backup.js';
import { testHooksFrom } from '../core/testHooks.js';
import { sealNetwork, silenceChromium } from './network.js';
import { cancelSpeech, speak } from './speech.js';
import {
  deleteProfile,
  load,
  loadLicenceMirror,
  resaveLast,
  saveLicenceMirror,
  loadDeePhrasing,
  loadMultiplayerEnabled,
  loadOnlineSettings,
  loadTheme,
  ONLINE_IDENTITY_FILE,
  loadTutorEnabled,
  profileStatus,
  save,
  saveDeePhrasing,
  saveMultiplayerEnabled,
  saveOnlineSettings,
  saveTheme,
  saveTutorEnabled,
} from './store.js';
import { askTutor, resolveTutor, type AskInput, type ResolvedTutor } from './tutor/index.js';
import { nullModelClient, nullTutor } from './tutor/nullTutor.js';
import { hostSession, joinSession, type RelaySession } from './relaySession.js';
import { parseInvite } from '../core/relayClient.js';
import { OnlineController } from './onlineMain.js';
import type { Action } from '../core/table.js';
import { CHECKOUT_URLS, LICENCE_SERVER_URL, MANAGE_URL, PRICE_LABELS } from '../core/entitlements/config.js';
import { FEATURE_INFO, PRO_FEATURES } from '../core/entitlements/features.js';
import { devOverrideFrom } from '../core/entitlements/entitlements.js';
import { checkoutPlans, createLicenceAuthority, gated, licenceEndpoints, tokenFromDeepLink, tokenId } from './licence.js';
import { createProTools, type ProTools } from './proTools.js';
import { saveStyleCard } from './styleCard.js';
import { createProfileFiles } from './profileFile.js';
import { refreshLicence, restoreLicence } from './licenceClient.js';
import { LAN_TABLE, MAX_SEAT_NAME, type RoomView } from '../core/multiplayer.js';
import { activeManifest } from './dee/manifest.js';
import { PhrasingService } from './dee/service.js';

let mainWindow: BrowserWindow | null = null;
/** Stops Dee's phrasing sidecar; set once the service exists. */
let stopPhrasing: () => void = () => undefined;
/** The Pro tools (import, leak report, push-fold); created in whenReady. */
let proTools: ProTools | null = null;

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
 * Online play (an Offsuit server, opt-in, off by default). The controller owns the only online socket and
 * opens it only from connect(); see onlineMain.ts for the gate.
 */
/** Set once the licence authority exists (whenReady); until then nothing is Pro. */
let rankedAllowed: () => boolean = () => false;
const online = new OnlineController({
  canRanked: () => rankedAllowed(),
  load: loadOnlineSettings,
  save: saveOnlineSettings,
  identityFile: ONLINE_IDENTITY_FILE,
  push: (event) => {
    if (mainWindow !== null && !mainWindow.isDestroyed()) mainWindow.webContents.send('online:event', event);
  },
});

/**
 * Push a multiplayer event to the renderer. The relay server BROADCASTS unprompted (a remote player
 * acting moves everyone's state), so unlike the request/response tutor this is a one-way channel from
 * main to the renderer via webContents.send.
 */
function pushMultiplayerEvent(
  event: { type: 'state'; view: RoomView } | { type: 'error' | 'warning'; reason: string },
): void {
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
    // Keep the configured cache: with the tutor OFF and the null client, a 'replay' cache still
    // cannot produce anything the guard would not clear (recorded turns are re-guarded per turn),
    // and 'record' never fires because the null client has no converse() to record.
    cache: configured.cache,
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
 * Under e2e, the window is never shown at all unless a spec asks for the visible tier
 * (tests/e2e/helpers.ts sets OFFSUIT_E2E_HIDDEN=1 by default). A never-shown window still lays out and
 * paints (`paintWhenInitiallyHidden`), so screenshots and geometry hold; `backgroundThrottling: false`
 * keeps its timers and frames running as if it were in front.
 */
const isHidden = isE2E && process.env.OFFSUIT_E2E_HIDDEN === '1';

/**
 * LICENSING (src/main/licence.ts): the authority is created in `whenReady`, so nothing can ask for it
 * before the profile can be read. The dev override and the dev key are refused in a packaged build,
 * whatever the environment says. A Pro feature's IPC handler is registered with `gated(authority, …)`.
 */
const endpoints = licenceEndpoints(
  { checkout: CHECKOUT_URLS, manage: MANAGE_URL, server: LICENCE_SERVER_URL },
  process.env,
  app.isPackaged,
);
/**
 * What may be sold right now: a plan opens checkout only with a URL, a price shown before it, and at least
 * one Pro feature shipped. Decided here, so the sheet's "checkout stays closed" is a fact, not a promise.
 */
const sellable = checkoutPlans(endpoints, PRICE_LABELS, PRO_FEATURES.some((f) => FEATURE_INFO[f].available), process.env, app.isPackaged);

/**
 * A deep link `offsuit://activate?key=…` is only ever a PROPOSAL: any web page can open one, so the
 * key is held here and the renderer asks the learner to confirm before `install()` runs. The protocol
 * is registered by a packaged build only; a developer or e2e run must not make itself the system's
 * handler for offsuit:// (that would outlive the run, in LaunchServices).
 */
let pendingDeepLink: string | null = null;
function receiveDeepLink(url: unknown): void {
  const token = tokenFromDeepLink(url);
  if (token === null) return;
  pendingDeepLink = token;
  if (mainWindow !== null && !mainWindow.isDestroyed()) mainWindow.webContents.send('licence:deeplink');
}
// macOS delivers the URL as an event, possibly before ready (a cold start from the link).
app.on('open-url', (event, url) => {
  event.preventDefault();
  receiveDeepLink(url);
});
if (app.isPackaged) app.setAsDefaultProtocolClient('offsuit');

/**
 * Checkout and the subscription portal open in the SYSTEM BROWSER, never in the app (no payment page
 * ever loads in an Offsuit window, and the seal stays total). Only a URL from `endpoints` can be opened;
 * the renderer names a plan, never a URL. Under e2e the call is recorded instead, because opening a
 * browser would take the screen from whoever is at the keyboard.
 */
function openExternal(url: string): Promise<void> {
  if (isE2E) {
    const g = globalThis as { __offsuitOpenedExternal?: string[] };
    (g.__offsuitOpenedExternal ??= []).push(url);
    return Promise.resolve();
  }
  return shell.openExternal(url);
}

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
 * window. The accessory activation policy (no Dock icon) means it never becomes the active app at
 * all — but only if it is set before the app is ready; from inside `whenReady` it is too late, which
 * still stole focus on every one of ~370 launches.
 */
if (isE2E) {
  app.dock?.hide();
  if (process.platform === 'darwin') app.setActivationPolicy('accessory');
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#000000',
    titleBarStyle: 'hiddenInset',
    // Centre the inset traffic lights (12px) on the renderer's 44px title bar (--nav-h in styles-glass.css),
    // whose left padding leaves them room.
    trafficLightPosition: { x: 16, y: 16 },
    show: false,
    // Hidden e2e never shows the window; it must still paint for screenshots and layout measurement.
    paintWhenInitiallyHidden: true,
    webPreferences: {
      // .cjs: Electron's sandboxed preload requires CommonJS, but the package is "type": "module".
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: !isHidden,
      // No devtools in a packaged build: nothing to poke at the renderer's (display-only) licence state.
      devTools: !app.isPackaged,
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
     * UNDER E2E THE WINDOW NEVER TAKES FOCUS. A suite launches the app hundreds of times, and each
     * `show()` pulls the active window away from whoever is at the keyboard. Hidden (the default) never
     * shows it; it still paints, so the 30 screenshotting specs and the layout geometry tests hold. The
     * visible tier shows it inactive, and tests/e2e/helpers.ts moves it to AeroSpace workspace 12.
     */
    if (isHidden) return;
    if (isE2E) {
      mainWindow?.showInactive();
      return;
    }
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/*
 * One running Offsuit per profile. Two copies on the same user-data directory each hold a whole
 * profile in memory and write it whole, so the last one to save would erase the other's progress.
 * The lock is per user-data directory, so e2e runs (one temp directory each) are unaffected. A second
 * launch exits at once and brings the first window forward, except under e2e, where nothing takes focus.
 * store.ts also refuses to save over a file that changed since it was read, which covers older builds
 * that never took this lock.
 */
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on('second-instance', (_event, argv) => {
    // Windows and Linux hand a deep link to the running copy as an argument of the second launch.
    for (const arg of argv) if (arg.startsWith('offsuit:')) receiveDeepLink(arg);
    if (mainWindow === null || isE2E) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
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

  const authority = createLicenceAuthority({
    isPackaged: app.isPackaged,
    devOverride: devOverrideFrom(process.env, app.isPackaged),
    nowSeconds: () => Math.floor(Date.now() / 1000),
    monotonicSeconds: () => performance.now() / 1000,
    loadMirror: loadLicenceMirror,
    saveMirror: saveLicenceMirror,
  });
  rankedAllowed = () => authority.can('ranked-play');
  // Windows/Linux cold start from a link: the URL is an argument of this launch.
  for (const arg of process.argv) if (arg.startsWith('offsuit:')) receiveDeepLink(arg);

  // Main's entitlements replace the renderer's on the way in and on the way out (licence.ts).
  ipcMain.handle('store:load', () => authority.adopt(load()));
  ipcMain.handle('store:save', (_event, obj: Record<string, unknown>) =>
    save(authority.stamp(typeof obj === 'object' && obj !== null ? obj : {})),
  );

  // ── Licensing ─────────────────────────────────────────────────────────────
  // Verification is offline and lives here. Every network call below is a button the learner pressed.
  const licenceStatus = () => ({
    snapshot: authority.snapshot(),
    checkout: { monthly: sellable.monthly !== null, annual: sellable.annual !== null },
    prices: { monthly: sellable.monthly?.price ?? null, annual: sellable.annual?.price ?? null },
    manage: endpoints.manage !== null,
    server: endpoints.server === null ? null : new URL(endpoints.server).host,
    devBuild: !app.isPackaged,
    pendingDeepLink: pendingDeepLink !== null,
  });
  /** A licence change is persisted at once, not at the renderer's next save. */
  const persistLicence = () => {
    resaveLast((obj) => authority.stamp(obj));
    return licenceStatus();
  };
  ipcMain.handle('licence:status', () => licenceStatus());
  ipcMain.handle('licence:activate', (_event, raw: unknown) => {
    const outcome = authority.install(typeof raw === 'string' ? raw : '');
    if (!outcome.ok) return { ok: false, reason: outcome.reason, status: licenceStatus() };
    return { ok: true, status: persistLicence() };
  });
  ipcMain.handle('licence:remove', () => {
    authority.remove();
    return persistLicence();
  });
  ipcMain.handle('licence:deeplinkPreview', () => {
    if (pendingDeepLink === null) return null;
    const preview = authority.preview(pendingDeepLink);
    if (!preview.ok) return { ok: false, reason: preview.reason, id: tokenId(pendingDeepLink) };
    const c = preview.claims;
    return {
      ok: true,
      id: preview.id,
      plan: c.plan,
      tier: c.tier,
      paidThrough: c.exp,
      licenceHint: c.lid.slice(-6),
      ended: preview.ended,
      replaces: preview.replaces,
    };
  });
  // Confirm names the key it showed: a link that arrived after the dialog opened is not the one approved.
  ipcMain.handle('licence:deeplinkConfirm', (_event, accept: unknown, id: unknown) => {
    const token = pendingDeepLink;
    if (token === null || typeof id !== 'string' || id !== tokenId(token)) {
      return { ok: false, reason: 'declined', status: licenceStatus() };
    }
    pendingDeepLink = null;
    if (accept !== true) return { ok: false, reason: 'declined', status: licenceStatus() };
    const outcome = authority.install(token);
    if (!outcome.ok) return { ok: false, reason: outcome.reason, status: licenceStatus() };
    return { ok: true, status: persistLicence() };
  });
  ipcMain.handle('licence:openCheckout', async (_event, plan: unknown) => {
    const offer = plan === 'monthly' || plan === 'annual' ? sellable[plan] : null;
    if (offer === null) return { opened: false };
    await openExternal(offer.url);
    return { opened: true };
  });
  ipcMain.handle('licence:openManage', async () => {
    if (endpoints.manage === null) return { opened: false };
    await openExternal(endpoints.manage);
    return { opened: true };
  });
  ipcMain.handle('licence:refresh', async () => {
    const token = authority.token();
    if (token === null) return { ok: false, reason: 'no-licence', status: licenceStatus() };
    const reply = await refreshLicence(endpoints.server, token);
    if (reply.ok) authority.correctClock(reply.clock, reply.token ?? token);
    if (!reply.ok) return { ok: false, reason: reply.reason, serverStatus: reply.status ?? null, status: licenceStatus() };
    if (reply.token !== null && reply.token !== token) {
      const outcome = authority.install(reply.token);
      if (!outcome.ok) return { ok: false, reason: 'bad-reply', status: licenceStatus() };
      return { ok: true, serverStatus: reply.status, status: persistLicence() };
    }
    return { ok: true, serverStatus: reply.status, status: licenceStatus() };
  });
  ipcMain.handle('licence:restore', async (_event, input: { orderId?: unknown; email?: unknown }) => {
    const orderId = typeof input?.orderId === 'string' ? input.orderId : '';
    const email = typeof input?.email === 'string' ? input.email : '';
    if (orderId.trim() === '' || email.trim() === '') return { ok: false, reason: 'missing', status: licenceStatus() };
    const reply = await restoreLicence(endpoints.server, orderId, email);
    if (reply.ok) authority.correctClock(reply.clock, reply.token);
    if (!reply.ok || reply.token === null) {
      return { ok: false, reason: reply.ok ? 'not-found' : reply.reason, serverStatus: reply.status ?? null, status: licenceStatus() };
    }
    const outcome = authority.install(reply.token);
    if (!outcome.ok) return { ok: false, reason: 'bad-reply', status: licenceStatus() };
    return { ok: true, serverStatus: reply.status, status: persistLicence() };
  });
  ipcMain.handle('app:seed', () => seed);
  // You › Style: the card as a PNG, through the native save dialog only.
  ipcMain.handle('style:saveCard', (_event, rect: unknown) => saveStyleCard(mainWindow, rect, app.getPath('pictures')));
  // The test clock and the onboarding switch: e2e only, never packaged (core/testHooks.ts).
  ipcMain.handle('app:testHooks', () => testHooksFrom(process.env, app.isPackaged));

  // ── Profile export and import (profileFile.ts) ──────────────────────────────
  // Main opens the dialogs and reads only what they return. An import is checked strictly, previewed, and
  // written only on a confirm naming that preview; the current profile is copied aside first. The imported
  // profile carries main's licence, never the file's. Free, never gated: the profile is the learner's.
  const profileFiles = createProfileFiles({
    window: () => mainWindow,
    userData: app.getPath('userData'),
    stamp: (obj) => authority.stamp(obj),
  });
  ipcMain.handle('profile:export', () => profileFiles.exportProfile());
  ipcMain.handle('profile:importPick', () => profileFiles.pickImport());
  ipcMain.handle('profile:importConfirm', (_event, id: unknown, accept: unknown) => profileFiles.confirmImport(id, accept));

  // ── Pro tools (proTools.ts) ───────────────────────────────────────────────
  // Gated here, in main: a renderer that draws the surface anyway gets { locked }. The import reads only
  // what the native dialog returns; the store lives outside the profile, so importing earns nothing.
  const pro = (proTools = createProTools({ userData: app.getPath('userData'), window: () => mainWindow }));
  ipcMain.handle('pro:importHands', gated(authority, 'leak-finder', () => pro.importHands()));
  ipcMain.handle('pro:handsReport', gated(authority, 'leak-finder', () => pro.report()));
  // Deleting your imported hands is never locked: the data stays yours after Pro ends.
  ipcMain.handle('pro:clearHands', () => pro.clear());
  ipcMain.handle('pro:shove', gated(authority, 'icm-tools', (_event: unknown, request: unknown) => pro.shove(request)));

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
      theme: loadTheme(),
    };
  });

  ipcMain.handle('settings:setTutorEnabled', (_event, enabled: boolean) => {
    tutorEnabled = enabled === true;
    saveTutorEnabled(tutorEnabled);
    return tutorEnabled;
  });

  ipcMain.handle('settings:setTheme', (_event, theme: string) => {
    saveTheme(theme);
    return loadTheme();
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
    onWarning: (reason: string) => pushMultiplayerEvent({ type: 'warning', reason }),
  };

  ipcMain.handle('mp:host', async (_event, opts: { seatCount?: number; name?: unknown }) => {
    if (!multiplayerEnabled) return { error: 'multiplayer is off' };
    await stopRelaySession();
    const seatCount = Math.min(6, Math.max(2, Math.floor(opts?.seatCount ?? 3)));
    const { session, info } = await hostSession(
      // No seed: a hosted room deals from node:crypto with commit-before-reveal (relayServer.ts). The
      // --seed flag stays a solo-play and e2e tool only.
      { ...LAN_TABLE, seatCount },
      sessionCallbacks,
      // A test run's table listens on loopback only: the specs' guests connect to 127.0.0.1, and nothing on
      // the machine's network can reach a table a spec deals. A real table binds every interface (LAN play).
      { name: typeof opts?.name === 'string' ? opts.name.slice(0, MAX_SEAT_NAME) : undefined, ...(isE2E ? { host: '127.0.0.1' } : {}) },
    );
    relaySession = session;
    return {
      port: info.port,
      addresses: info.addresses,
      invites: info.invites,
      fingerprint: info.fingerprint,
      token: info.token,
    };
  });

  ipcMain.handle('mp:join', async (_event, request: { invite?: unknown; name?: unknown }) => {
    if (!multiplayerEnabled) return { error: 'multiplayer is off' };
    // Parsed again here: the renderer's check is for the notice, this one is the gate.
    const invite = parseInvite(typeof request?.invite === 'string' ? request.invite : '');
    if ('error' in invite) return { error: invite.error };
    await stopRelaySession();
    relaySession = joinSession(
      invite,
      typeof request.name === 'string' ? request.name : 'Guest',
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

  // ── Online play (an Offsuit server) ─────────────────────────────────────────
  // Every handler re-checks in OnlineController; the renderer's checks are only for the notice.
  ipcMain.handle('online:status', () => online.view());
  ipcMain.handle('online:configure', (_event, patch: { enabled?: unknown; server?: unknown; pin?: unknown }) => online.configure(patch ?? {}));
  ipcMain.handle('online:connect', (_event, request: { name?: unknown; adult?: unknown }) => online.connect(request ?? {}));
  ipcMain.handle('online:request', (_event, op: unknown, fields: unknown) => online.request(op, fields));
  ipcMain.handle('online:action', (_event, action: unknown) => online.action(action));
  ipcMain.handle('online:emote', (_event, emote: unknown) => online.emote(emote));
  ipcMain.handle('online:leave', () => online.leave());
  ipcMain.handle('online:disconnect', () => online.disconnect());
  ipcMain.handle('online:exportIdentity', () => online.exportIdentity());

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
  /**
   * Dee chat's optional phrasing model. The renderer sends a template id and typed slots, never text
   * (phrasing.ts re-renders and re-checks them); the download runs only on the consent click and is the
   * feature's only network use (no-network.spec proves it). Everything is in <userData>/dee-model.
   */
  const { manifest, testLoopback } = activeManifest(process.env, app.isPackaged);
  const phrasing = new PhrasingService({
    dir: path.join(app.getPath('userData'), 'dee-model'),
    manifest,
    testLoopback,
    loadEnabled: loadDeePhrasing,
    saveEnabled: saveDeePhrasing,
    onStatus: (status) => {
      if (mainWindow !== null && !mainWindow.isDestroyed()) mainWindow.webContents.send('dee:phrasing', status);
    },
  });
  stopPhrasing = () => phrasing.stop();
  ipcMain.handle('dee:phrasing:status', () => phrasing.status());
  ipcMain.handle('dee:phrasing:download', (_event, consent: unknown, licences: unknown) => phrasing.download(consent, licences));
  ipcMain.handle('dee:phrasing:cancel', () => phrasing.cancel());
  ipcMain.handle('dee:phrasing:delete', () => phrasing.remove());
  ipcMain.handle('dee:phrasing:setEnabled', (_event, on: unknown) => phrasing.setEnabled(on));
  ipcMain.handle('dee:chat:warm', () => phrasing.warm());
  ipcMain.handle('dee:chat:phrase', (_event, req: unknown) => phrasing.phrase(req as never));

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
  // The phrasing sidecar is a child process; it must not outlive the app either.
  stopPhrasing();
  // A relay socket must not outlive the app that opened it: drop any live host/join on quit.
  void stopRelaySession();
  online.disconnect();
  proTools?.stop();
});
