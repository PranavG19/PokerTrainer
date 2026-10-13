/**
 * The online server's address and optional certificate pin, as the player types them in Settings.
 * Pure, so the renderer can say what is wrong before main is asked and main can re-check it as the gate.
 *
 * Two ways to trust a server (both supported, chosen by whether a pin is given):
 *   - no pin: the certificate must be valid for the host name from a public authority (Let's Encrypt on
 *     the deployed server), checked by Node's TLS against its bundled roots;
 *   - a pin: the certificate's SHA-256 must equal it (a self-signed server, an IP address, a test).
 */

export const DEFAULT_ONLINE_PORT = 443;

export interface ServerAddress {
  readonly host: string;
  readonly port: number;
}

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const PIN = /^[A-Za-z0-9_-]{43}$/;

export function parseServerAddress(text: unknown): ServerAddress | { readonly error: string } {
  if (typeof text !== 'string' || text.trim() === '') return { error: 'Enter the server address, like play.example.com.' };
  let rest = text.trim().toLowerCase().replace(/^offsuit:\/\//, '').replace(/\/+$/, '');
  let portText = '';
  let host: string;
  if (rest.startsWith('[')) {
    const close = rest.indexOf(']');
    if (close < 0) return { error: 'That address is not complete.' };
    host = rest.slice(1, close);
    rest = rest.slice(close + 1);
    if (rest.startsWith(':')) portText = rest.slice(1);
    else if (rest !== '') return { error: 'That address is not complete.' };
    if (!/^[0-9a-f:]+$/.test(host) || !host.includes(':')) return { error: 'That is not an IPv6 address.' };
  } else {
    const parts = rest.split(':');
    if (parts.length > 2) return { error: 'Put an IPv6 address in brackets, like [2001:db8::1]:443.' };
    host = parts[0];
    portText = parts[1] ?? '';
    if (!HOSTNAME.test(host) && !IPV4.test(host)) return { error: 'That is not a server name or address.' };
  }
  if (portText === '') return { host, port: DEFAULT_ONLINE_PORT };
  if (!/^\d{1,5}$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
    return { error: 'The port must be a number from 1 to 65535.' };
  }
  return { host, port: Number(portText) };
}

export function formatServerAddress(address: ServerAddress): string {
  const host = address.host.includes(':') ? `[${address.host}]` : address.host;
  return address.port === DEFAULT_ONLINE_PORT ? host : `${host}:${address.port}`;
}

/** An empty pin means "use public authorities"; anything else must be a SHA-256, base64url. */
export function parsePin(text: unknown): { readonly pin: string | null } | { readonly error: string } {
  if (text === undefined || text === null || (typeof text === 'string' && text.trim() === '')) return { pin: null };
  if (typeof text !== 'string' || !PIN.test(text.trim())) {
    return { error: 'A certificate pin is 43 characters (the server prints it). Leave it empty for a normal certificate.' };
  }
  return { pin: text.trim() };
}
