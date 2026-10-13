/**
 * The licence server client: the two user-initiated calls, refresh (fetch a renewed token) and restore
 * (get the token for an order). Each is one request through network.ts's licensing session; nothing here
 * runs on a timer or at startup. The server side is src/server/licensing/http.ts.
 */

import { licensingFetch } from './network.js';

export type ServerReply =
  | { readonly ok: true; readonly token: string | null; readonly status: string }
  | { readonly ok: false; readonly reason: 'not-configured' | 'network' | 'refused' | 'bad-reply'; readonly status?: string };

/** The server's answer to either call: `{ status, token? }`. Anything else is a bad reply. */
async function call(server: string | null, path: string, body: Record<string, unknown>): Promise<ServerReply> {
  if (server === null) return { ok: false, reason: 'not-configured' };
  let response: Response;
  try {
    response = await licensingFetch(`${server}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, reason: 'bad-reply' };
  }
  const o = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
  const status = typeof o.status === 'string' ? o.status.slice(0, 40) : 'unknown';
  if (!response.ok) return { ok: false, reason: 'refused', status };
  const token = typeof o.token === 'string' && o.token.length <= 2048 ? o.token : null;
  return { ok: true, token, status };
}

export function refreshLicence(server: string | null, token: string): Promise<ServerReply> {
  return call(server, '/v1/licence/refresh', { token });
}

export function restoreLicence(server: string | null, orderId: string, email: string): Promise<ServerReply> {
  return call(server, '/v1/licence/restore', { orderId: orderId.trim().slice(0, 128), email: email.trim().slice(0, 254) });
}
