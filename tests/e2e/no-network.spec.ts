import { expect, test } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { launchApp, sel } from './helpers.js';

/**
 * NO NETWORK, MEASURED FROM OUTSIDE THE APP — PRODUCT-SPEC's testing table:
 *
 *   "loopback proxy plus `session.webRequest.onBeforeRequest`; the run fails on *any* request from the
 *    browser process, not just the app's HTTP client. Separately assert autoUpdater and crashReporter
 *    are never initialised."
 *
 * WHY THE EXISTING assertNoNetwork IS NOT ENOUGH, and why this file exists next to it rather than
 * replacing it. `helpers.assertNoNetwork` uses `page.route`, which is a RENDERER-level interception:
 * it sees what the page requests and nothing else. The sources the spec actually worries about —
 * component updates, safe browsing lists, domain reliability beacons, the updater — are Chromium's own
 * traffic in the browser process, and `page.route` is blind to every one of them. The spec says so in
 * as many words: v1's "any outbound request" against an app-level allowlist "would not have caught a
 * single one of these sources".
 *
 * SO THE EVIDENCE HERE COMES FROM OUTSIDE THE APP. Two independent oracles, neither of which the app
 * reports on itself:
 *
 *   1. A LOOPBACK PROXY. Electron is launched with `--proxy-server` pointing at a real HTTP server in
 *      this process, configured to catch ALL traffic including localhost. Anything that escapes the
 *      seal must transit it to reach anywhere, so a single connection is a failure with a URL attached.
 *      A test that only asked the app "did you block anything?" would be the seal grading itself.
 *   2. THE PROCESS'S OWN MODULE STATE. autoUpdater and crashReporter are asserted un-started by
 *      evaluating in the MAIN process (`app.evaluate`), because "never initialised" is a fact about the
 *      browser process that no renderer assertion can reach.
 */

interface Proxy {
  readonly port: number;
  readonly seen: string[];
  close: () => Promise<void>;
}

/**
 * A real HTTP server on loopback that records and refuses. It answers CONNECT (how HTTPS transits a
 * proxy) as well as plain requests, so an https:// attempt is recorded rather than silently failing to
 * connect — a proxy that only spoke HTTP would let TLS traffic look like "no traffic".
 */
async function startProxy(): Promise<Proxy> {
  const seen: string[] = [];

  const server = http.createServer((request, response) => {
    seen.push(`http ${request.method ?? '?'} ${request.url ?? '?'}`);
    response.writeHead(403).end();
  });

  server.on('connect', (request, socket) => {
    seen.push(`connect ${request.url ?? '?'}`);
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    port,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/**
 * `--proxy-bypass-list=<-loopback>` is the load-bearing flag: Chromium bypasses the proxy for
 * localhost by DEFAULT, so without it a request to a loopback address would never be recorded and the
 * proxy would report "clean" for traffic it simply never saw.
 */
function proxyArgs(port: number): string[] {
  return [`--proxy-server=http://127.0.0.1:${port}`, '--proxy-bypass-list=<-loopback>'];
}

test('the browser process makes no request at all, measured at a loopback proxy', async () => {
  const proxy = await startProxy();
  const { app, page, close } = await launchApp({ seed: 42, extraArgs: proxyArgs(proxy.port) });
  try {
    // A real sitting, not just a launch: deal, act, and visit every surface, because a background
    // network user may only wake once the app is doing something.
    await page.waitForSelector('[data-testid="home-screen"]');
    await page.locator(sel.newHand).click();
    await page.locator('[data-testid="table-screen"]').waitFor();

    for (const button of [sel.btnCheck, sel.btnCall, sel.btnFold]) {
      const locator = page.locator(button);
      if (await locator.isEnabled().catch(() => false)) {
        await locator.click();
        break;
      }
    }

    for (const tab of ['tab-learn', 'tab-drill', 'tab-charts', 'tab-profile', 'tab-settings']) {
      await page.locator(`[data-testid="${tab}"]`).click();
      await expect(page.locator(`[data-testid="${tab}"]`)).toHaveAttribute('data-active', 'true');
    }

    // Give any deferred background task a window to fire. Chromium's component and safe-browsing
    // checks are scheduled after startup, so asserting immediately would pass for the wrong reason.
    await page.waitForTimeout(4000);

    expect(proxy.seen, 'the browser process attempted network access').toEqual([]);
  } finally {
    await close();
    await proxy.close();
  }
});

test('autoUpdater and crashReporter are never initialised', async () => {
  const { app, close } = await launchApp({ seed: 42 });
  try {
    /*
     * Evaluated in the MAIN process, which is the only place the question is answerable: "never
     * initialised" is a property of the browser process, and no renderer has a view of it.
     *
     * WHAT THIS ASSERTS, AND WHY IT IS NOT "getUploadToServer() THROWS". I wrote that first, on the
     * assumption that querying an unstarted reporter is an error. It is not, at least on macOS: the
     * measured state of a never-started reporter is `uploadToServer=false, parameters={}`, with no
     * reports and an empty feed URL (probed before rewriting this). So the assertion is the conjunction
     * of those four facts rather than one exception, and the load-bearing one is UPLOADS OFF — a
     * reporter that is running but uploading nowhere sends nothing, which is the property the spec
     * cares about, while an upload endpoint is egress by definition.
     */
    const state = await app.evaluate(({ autoUpdater, crashReporter }) => ({
      uploadToServer: crashReporter.getUploadToServer(),
      parameterCount: Object.keys(crashReporter.getParameters()).length,
      uploadedReports: crashReporter.getUploadedReports().length,
      feedUrl: ((): string => {
        try {
          return autoUpdater.getFeedURL();
        } catch (error) {
          // An unconfigured updater may report by throwing; that is the same fact as an empty feed.
          return `no-feed (${(error as Error).message.slice(0, 40)})`;
        }
      })(),
    }));

    expect(state.uploadToServer, 'crashReporter would upload crashes off the machine').toBe(false);
    // Parameters are only set by a started reporter, so an empty bag is evidence of never-started.
    expect(state.parameterCount, 'crashReporter carries parameters, so it was started').toBe(0);
    expect(state.uploadedReports, 'crash reports have been uploaded').toBe(0);
    // An empty feed URL is the un-configured state; anything else is an update server.
    expect(state.feedUrl, `autoUpdater has a feed: ${state.feedUrl}`).toMatch(/^$|^no-feed/);
  } finally {
    await close();
  }
});

test('the Chromium switches that silence background networking are actually applied', async () => {
  const { app, close } = await launchApp({ seed: 42 });
  try {
    /*
     * The switches are asserted as APPLIED rather than as written in source, because appending one
     * after `app.whenReady()` is a silent no-op — the failure mode is a switch that exists in the code
     * and does nothing. `commandLine.hasSwitch` reads what Chromium actually holds.
     */
    const switches = await app.evaluate(({ app: electronApp }) => ({
      backgroundNetworking: electronApp.commandLine.hasSwitch('disable-background-networking'),
      componentUpdate: electronApp.commandLine.hasSwitch('disable-component-update'),
      domainReliability: electronApp.commandLine.hasSwitch('disable-domain-reliability'),
      safeBrowsing: electronApp.commandLine.hasSwitch('safebrowsing-disable-auto-update'),
      breakpad: electronApp.commandLine.hasSwitch('disable-breakpad'),
      disabledFeatures: electronApp.commandLine.getSwitchValue('disable-features'),
    }));

    expect(switches.backgroundNetworking).toBe(true);
    expect(switches.componentUpdate).toBe(true);
    expect(switches.domainReliability).toBe(true);
    expect(switches.safeBrowsing).toBe(true);
    expect(switches.breakpad).toBe(true);
    for (const feature of ['SafeBrowsing', 'OptimizationHints', 'SpellcheckService']) {
      expect(switches.disabledFeatures, `${feature} is not disabled`).toContain(feature);
    }
  } finally {
    await close();
  }
});

test('the seal covers a session the app never asked for, not just the main window', async () => {
  const { app, close } = await launchApp({ seed: 42 });
  try {
    /*
     * The exact hole the old per-window hook left. A partition created at runtime gets its own session
     * with its own webRequest, so a hook installed on `mainWindow.webContents.session` does not govern
     * it. `app.on('session-created')` is what closes this, and the only way to test it is to create one
     * and try to fetch through it.
     *
     * The request is made from the MAIN process against a routable address, so a pass means the seal
     * cancelled it — not that the address happened to be unreachable. ERR_BLOCKED_BY_CLIENT is
     * Chromium's specific report for a webRequest cancellation, which distinguishes the two.
     */
    const outcome = await app.evaluate(async ({ session: electronSession, net }) => {
      const fresh = electronSession.fromPartition('persist:seal-probe-not-in-the-app');
      return new Promise<string>((resolve) => {
        const request = net.request({
          url: 'http://example.com/seal-probe',
          session: fresh,
        });
        request.on('response', (response) => resolve(`RESPONDED ${response.statusCode}`));
        request.on('error', (error: Error) => resolve(`blocked: ${error.message}`));
        request.end();
        setTimeout(() => resolve('TIMED OUT — neither blocked nor answered'), 10_000);
      });
    });

    expect(outcome, `a fresh partition was not sealed: ${outcome}`).toContain('blocked');
    expect(outcome, 'the request failed for some reason other than the seal').toContain(
      'ERR_BLOCKED_BY_CLIENT',
    );
  } finally {
    await close();
  }
});

test('local assets still load, so the seal is a seal and not a brick', async () => {
  /*
   * The counter-test, and the reason it is not optional: `cancel: true` for everything would pass every
   * assertion above while shipping a blank window. A seal is only correct if the app still works, so
   * this asserts the app rendered real content and logged no failed local load.
   */
  const proxy = await startProxy();
  const { page, close } = await launchApp({ seed: 42, extraArgs: proxyArgs(proxy.port) });
  const failures: string[] = [];
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (url.startsWith('file:')) failures.push(`${url}: ${request.failure()?.errorText ?? '?'}`);
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.waitForSelector('[data-testid="home-screen"]');
    await page.locator(sel.newHand).click();
    // Cards render, which means the stylesheet, the bundle and the fonts all loaded from file://.
    await expect(page.locator(sel.heroCards).locator(sel.card).first()).toBeVisible();
    // Styling specifically: a blocked stylesheet is invisible to a DOM-presence assertion.
    const cardWidth = await page
      .locator(sel.heroCards)
      .locator(sel.card)
      .first()
      .evaluate((node) => node.getBoundingClientRect().width);
    expect(cardWidth, 'cards have no width, so the stylesheet did not load').toBeGreaterThan(10);

    expect(failures, 'a local asset was blocked by the seal').toEqual([]);
    expect(errors, 'the renderer threw while loading under the seal').toEqual([]);
    expect(proxy.seen, 'the app reached the network while merely rendering').toEqual([]);
  } finally {
    await close();
    await proxy.close();
  }
});
