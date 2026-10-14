/**
 * STRUCTURED LOGS — one JSON object per line on stdout, which systemd hands to journald (rotated there).
 *
 * NO PERSONAL DATA. No IP address, display name, public key or card is ever a field. A player appears as
 * `who`, a salted hash of their key (the salt lives in the state store and never leaves the server), so
 * the operator can follow one player's events through the logs without the logs naming anyone, and
 * deleting the state store unlinks the logs from players for good. Field values are restricted to
 * numbers, booleans and short strings the server chose; callers pass no free text from a client.
 */

import * as crypto from 'node:crypto';

export type LogFields = Readonly<Record<string, string | number | boolean>>;
export type Log = (event: string, fields?: LogFields) => void;

export function jsonLog(write: (line: string) => void = (line) => process.stdout.write(line)): Log {
  return (event, fields = {}) => {
    write(`${JSON.stringify({ t: new Date().toISOString(), ev: event, ...fields })}\n`);
  };
}

export const silentLog: Log = () => undefined;

/** A short, salted, one-way stand-in for a player key: stable across restarts, meaningless without the salt. */
export function pseudonym(salt: string, key: string): string {
  return crypto.createHmac('sha256', salt).update(key).digest('base64url').slice(0, 10);
}
