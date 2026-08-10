import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NETWORK SEAL, the parts testable without launching Electron.
 *
 * WHY THIS FILE EXISTS AT ALL, given tests/e2e/no-network.spec.ts already drives the real app: one
 * property of the seal is INVISIBLE FROM OUTSIDE THE PROCESS, and I found that by mutation rather than
 * by reasoning. Moving `silenceChromium()` into `app.whenReady().then(...)` — which makes every switch
 * a silent no-op, because Chromium has already read its command line — passed the entire e2e suite.
 * `commandLine.hasSwitch` returns true regardless of when the switch was appended (measured), and
 * `process.argv` carries none of them either way, so there is no observable difference between "applied
 * in time" and "applied too late and ignored".
 *
 * The response was to make lateness throw instead of testing for it, and THAT is what this file pins.
 * `electron` is mocked because network.ts imports `app` at module scope, which is also the reason this
 * cannot live in the e2e suite: the e2e app is by definition already past `whenReady`.
 */

const appMock = {
  isReady: vi.fn(() => false),
  commandLine: {
    appendSwitch: vi.fn(),
  },
  on: vi.fn(),
};

const sessionMock = {
  defaultSession: { webRequest: { onBeforeRequest: vi.fn() } },
};

vi.mock('electron', () => ({
  app: appMock,
  session: sessionMock,
}));

const { isLocalUrl, sealNetwork, sealSession, silenceChromium } = await import(
  '../../src/main/network.js'
);

beforeEach(() => {
  vi.clearAllMocks();
  appMock.isReady.mockReturnValue(false);
});

describe('isLocalUrl', () => {
  it('admits the schemes that never leave the machine', () => {
    for (const url of [
      'file:///Users/x/dist/renderer/index.html',
      'data:text/css;base64,abc',
      'blob:file:///abc-123',
      'devtools://devtools/bundled/panel.js',
      'chrome://gpu',
      'chrome-extension://abc/background.js',
    ]) {
      expect(isLocalUrl(url), `${url} should be treated as local`).toBe(true);
    }
  });

  it('refuses everything that leaves the machine, including loopback', () => {
    /*
     * LOOPBACK IS NOT LOCAL for this purpose, and that is deliberate rather than an oversight: a
     * request to 127.0.0.1 is still a request out of the process, and "no cloud" is not the only claim
     * being defended — the app must not talk to a helper daemon either. The one authorised egress
     * (Bedrock) leaves through the `aws` CLI subprocess and never transits an Electron session.
     */
    for (const url of [
      'http://example.com/x',
      'https://bedrock-runtime.us-west-2.amazonaws.com/model/invoke',
      'http://127.0.0.1:9000/telemetry',
      'http://localhost:1234/',
      'ws://example.com/socket',
      'ftp://example.com/f',
    ]) {
      expect(isLocalUrl(url), `${url} must not be treated as local`).toBe(false);
    }
  });

  it('is not fooled by a local scheme appearing later in the URL', () => {
    // startsWith, not includes: a remote URL carrying "file:" in a query must still be blocked.
    expect(isLocalUrl('http://evil.example/?next=file:///etc/passwd')).toBe(false);
    expect(isLocalUrl('https://example.com/data:text/html')).toBe(false);
  });
});

describe('silenceChromium', () => {
  it('appends every switch PRODUCT-SPEC names, before the app is ready', () => {
    silenceChromium();
    const applied = appMock.commandLine.appendSwitch.mock.calls.map((call) => call[0]);
    for (const expected of [
      'disable-background-networking',
      'disable-component-update',
      'disable-domain-reliability',
      'safebrowsing-disable-auto-update',
      'disable-breakpad',
      'disable-crash-reporter',
    ]) {
      expect(applied, `${expected} is not applied`).toContain(expected);
    }

    const features = appMock.commandLine.appendSwitch.mock.calls.find(
      (call) => call[0] === 'disable-features',
    );
    expect(features, 'no disable-features switch').toBeDefined();
    for (const feature of ['SafeBrowsing', 'OptimizationHints', 'SpellcheckService']) {
      expect(String(features?.[1]), `${feature} is not in disable-features`).toContain(feature);
    }
  });

  it('THROWS when called after the app is ready, because the switches would be ignored', () => {
    /*
     * The whole reason the guard exists. This is the mutation that survived the e2e suite, so it is
     * pinned here instead — and it is pinned as a THROW rather than a warning, because a warning in a
     * shipped build is a background-networking app that nobody notices.
     */
    appMock.isReady.mockReturnValue(true);
    expect(() => silenceChromium()).toThrow(/after app ready/);
    expect(
      appMock.commandLine.appendSwitch,
      'a late call must apply nothing rather than half-applying',
    ).not.toHaveBeenCalled();
  });
});

describe('sealSession', () => {
  /** Drive the registered listener the way Electron would, and report what it decided. */
  function decisionFor(url: string): boolean {
    const target = { webRequest: { onBeforeRequest: vi.fn() } };
    sealSession(target as never);
    const listener = target.webRequest.onBeforeRequest.mock.calls[0][0] as (
      details: { url: string },
      callback: (response: { cancel: boolean }) => void,
    ) => void;
    let cancelled: boolean | undefined;
    listener({ url }, (response) => {
      cancelled = response.cancel;
    });
    if (cancelled === undefined) throw new Error(`the seal never answered for ${url}`);
    return cancelled;
  }

  it('cancels remote requests and lets local ones through', () => {
    expect(decisionFor('https://example.com/x'), 'a remote request was allowed').toBe(true);
    expect(decisionFor('file:///dist/renderer/index.html'), 'a local asset was blocked').toBe(false);
  });

  it('always answers the callback, so a request can never hang', () => {
    // An onBeforeRequest listener that returns without calling back stalls the request forever, which
    // would look like a network timeout rather than a block.
    for (const url of ['file:///a', 'https://b.example', '', 'not-a-url', 'about:blank']) {
      expect(() => decisionFor(url), `${url} left the request unanswered`).not.toThrow();
    }
  });

  it('registers at onBeforeRequest, not at a later stage', () => {
    // The placement IS the fix (PRODUCT-SPEC: "Enforcement and test both sit at
    // session.webRequest.onBeforeRequest"), so it is asserted rather than assumed.
    const target = { webRequest: { onBeforeRequest: vi.fn(), onBeforeSendHeaders: vi.fn() } };
    sealSession(target as never);
    expect(target.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
    expect(
      target.webRequest.onBeforeSendHeaders,
      'the header stage is too late — it does not govern Chromium’s own traffic',
    ).not.toHaveBeenCalled();
  });
});

describe('sealNetwork', () => {
  it('seals the default session AND every session created later', () => {
    sealNetwork();
    expect(
      sessionMock.defaultSession.webRequest.onBeforeRequest,
      'the default session was not sealed',
    ).toHaveBeenCalledTimes(1);

    const created = appMock.on.mock.calls.find((call) => call[0] === 'session-created');
    expect(created, 'no session-created handler: a runtime partition would be unsealed').toBeDefined();

    // The handler must actually seal what it is handed — registering and ignoring is the bug shape.
    const fresh = { webRequest: { onBeforeRequest: vi.fn() } };
    (created?.[1] as (session: unknown) => void)(fresh);
    expect(fresh.webRequest.onBeforeRequest, 'a newly created session was not sealed').toHaveBeenCalledTimes(
      1,
    );
  });
});
