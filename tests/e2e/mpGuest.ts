import type { Page } from '@playwright/test';
import { joinSession, type RelaySession } from '../../src/main/relaySession.js';
import type { Invite } from '../../src/core/relayClient.js';
import type { RoomView } from '../../src/core/multiplayer.js';

/**
 * A real v2 guest for the multiplayer specs: the app's own joinSession (TLS, certificate pin, token
 * hello, deal verification) run in the test process against the app's hosted table.
 */
export interface TestGuest {
  readonly session: RelaySession;
  readonly views: RoomView[];
  readonly errors: string[];
  /** Every raw line the guest received. */
  readonly wire: string[];
}

/** The loopback invite for the table the page is hosting, read off the share block. */
export async function hostedInvite(page: Page): Promise<Invite> {
  const share = page.locator('[data-testid="mp-host-port"]');
  await share.waitFor();
  return {
    host: '127.0.0.1',
    port: Number(await share.getAttribute('data-port')),
    fingerprint: (await share.getAttribute('data-fingerprint')) ?? '',
    token: (await share.getAttribute('data-token')) ?? '',
  };
}

export function joinAsGuest(invite: Invite, name = 'Guest'): TestGuest {
  const views: RoomView[] = [];
  const errors: string[] = [];
  const wire: string[] = [];
  const session = joinSession(invite, name, {
    onState: (v) => views.push(v),
    onError: (e) => errors.push(e),
    onWire: (line) => wire.push(line),
  });
  return { session, views, errors, wire };
}
