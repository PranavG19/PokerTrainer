/**
 * NETWORK SEAL — PRODUCT-SPEC Security, the bullet that begins "Chromium and Electron are silenced
 * explicitly, because the app-level allowlist does not govern them."
 *
 * THE POINT OF THIS FILE IS THE PLACEMENT, not the cancelling. Before it existed the app hooked
 * `mainWindow.webContents.session.webRequest.onBeforeSendHeaders` — one window's session, at the
 * moment headers are about to be sent. Three things escape that hook, and every one of them is a real
 * source the spec names:
 *
 *   1. ANY OTHER SESSION. A partition, a webview, or a second window created later has its own
 *      session and is not covered. Sealing `defaultSession` plus an `app.on('session-created')`
 *      handler covers the browser process instead of one window.
 *   2. REQUESTS THAT NEVER REACH THE HEADER STAGE. Chromium's own traffic — component updates, safe
 *      browsing lists, domain reliability beacons, spellcheck dictionary downloads — is not the app's
 *      HTTP client and does not necessarily pass through an app-level header hook. `onBeforeRequest`
 *      is the earliest interception point, which is why the spec names it specifically.
 *   3. TRAFFIC THAT SHOULD NEVER BE ATTEMPTED AT ALL. Cancelling a safe-browsing update still means
 *      Chromium tried; the switches below stop it being attempted, so the seal is defence in depth
 *      rather than a single net.
 *
 * WHY SEALING EVERYTHING DOES NOT BREAK THE TUTOR. The one authorised egress is Bedrock, and
 * src/main/tutor/bedrock.ts reaches it by spawning the `aws` CLI — a child process with its own
 * network stack. Electron's session is not in that path, so the seal can be total rather than an
 * allowlist with a hole in it. If the shipping design ever replaces the CLI with an in-process HTTPS
 * client, THIS is the file that has to grow the one-host exception, and `bedrockHost(region)` is the
 * only string it may admit.
 */

import { app, session, type Session } from 'electron';

/**
 * Schemes that never leave the machine. `devtools:` and `chrome-extension:` are here because a
 * developer opening DevTools must not trip the seal — DevTools is local UI, not egress.
 */
const LOCAL_SCHEMES = ['file:', 'data:', 'blob:', 'devtools:', 'chrome:', 'chrome-extension:'];

export function isLocalUrl(url: string): boolean {
  return LOCAL_SCHEMES.some((scheme) => url.startsWith(scheme));
}

/**
 * Cancel every non-local request on one session. Registered per session rather than once globally
 * because `webRequest` is a per-session interface — there is no browser-wide hook, so covering the
 * browser process means covering each session as it appears.
 *
 * Nothing is recorded here on purpose. A blocked-request list maintained by the seal would be the
 * seal grading its own homework, and tests/e2e/no-network.spec.ts deliberately takes its evidence from
 * outside this file instead: a loopback proxy that sees anything which escapes, and Chromium's own
 * `onErrorOccurred`.
 */
export function sealSession(target: Session): void {
  target.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isLocalUrl(details.url) });
  });
}

/**
 * Switches, applied before `app.whenReady()` or they are ignored. Each one turns off a background
 * network user that the spec names by hand; the seal above would cancel them anyway, so this exists to
 * stop the attempt rather than to catch it.
 */
export function silenceChromium(): void {
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('disable-domain-reliability');
  app.commandLine.appendSwitch('safebrowsing-disable-auto-update');
  app.commandLine.appendSwitch('disable-breakpad');
  app.commandLine.appendSwitch('disable-crash-reporter');
  // Features rather than flags: these have no standalone switch.
  app.commandLine.appendSwitch(
    'disable-features',
    'SafeBrowsing,OptimizationHints,MediaRouter,SpellcheckService,Translate',
  );
}

/**
 * Seal the default session and every session created afterwards.
 *
 * `session-created` fires for partitions the app never asked for, which is the case a per-window hook
 * cannot cover. Called from `app.whenReady()`; `silenceChromium` must be called before that.
 */
export function sealNetwork(): void {
  sealSession(session.defaultSession);
  app.on('session-created', (created) => {
    sealSession(created);
  });
}
