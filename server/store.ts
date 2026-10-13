/**
 * STATE STORE — everything the online server keeps, in one small directory (backed up daily by the
 * deploy's timer). No database: at this scale a JSON document plus append-only ledgers is enough, has no
 * dependency, and a backup is a tar of the directory.
 *
 *   state.json                    players, leagues, seasons, past season results, the log salt.
 *                                 Written whole, atomically (temp file, fsync, rename), so a backup taken
 *                                 mid-write still holds the previous complete file.
 *   ledger/decisions-YYYY-MM.jsonl one line per graded ranked decision, with the grader's full input, so
 *                                 any score can be recomputed (admin.ts regrade) and audited.
 *   ledger/hands-YYYY-MM.jsonl    one line per settled ranked hand: who sat, stacks in and out. The
 *                                 collusion signals (chip flow between a pair) are read from here.
 *
 * WHAT IS STORED, AND NOTHING ELSE (docs/PRIVACY-ONLINE.md): per player a public key, a display name, the
 * DATE they confirmed they are 18 or over, the dates they first and last signed in; league names and
 * members; the ranked ledgers. No IP address, no e-mail, no device detail, no unranked hand. Ledgers older
 * than the previous season are deleted at startup; their per-player results are kept as one row each.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { GradeInput, Rating } from '../src/core/online/ranked.js';

export interface PlayerRow {
  readonly name: string;
  /** The day the player confirmed they are 18 or over (YYYY-MM-DD). */
  readonly adultOn: string;
  readonly created: string;
  seen: string;
}

export interface LeagueRow {
  readonly name: string;
  owner: string;
  readonly members: string[];
  readonly created: string;
}

export interface SeasonRow {
  readonly graderVersion: number;
  readonly opened: string;
}

interface StateFile {
  readonly version: 1;
  readonly logSalt: string;
  /** Keys the grader's Monte Carlo seeds, so no client can know a decision's exact seed (review A6). */
  readonly gradeSecret: string;
  readonly players: Record<string, PlayerRow>;
  readonly leagues: Record<string, LeagueRow>;
  readonly seasons: Record<string, SeasonRow>;
  /** Final ratings of seasons whose ledgers are gone: season → key → rating. */
  readonly results: Record<string, Record<string, Rating>>;
}

/** One graded decision. `d` is `<deal nonce>:<index>`, unique for good. */
export interface DecisionLine {
  readonly k: string;
  readonly d: string;
  readonly ev: number;
  readonly g: number;
  readonly auto: boolean;
  readonly opp: readonly string[];
  readonly day: string;
  readonly in: GradeInput;
}

export interface HandLine {
  readonly h: string;
  readonly day: string;
  readonly p: readonly { readonly k: string; readonly start: number; readonly end: number }[];
  /** Pairs of players at this hand who connected from one network: a signal, never a refusal. */
  readonly shared: readonly (readonly [string, string])[];
}

export type LedgerKind = 'decisions' | 'hands';

export const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The season before `season` ('YYYY-MM'). */
export function previousSeason(season: string): string {
  const [y, m] = season.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export class Store {
  private state: StateFile;
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;

  private constructor(
    readonly dir: string,
    state: StateFile,
  ) {
    this.state = state;
  }

  /**
   * Open (or create) the store. A state.json that does not parse stops the server with the reason
   * rather than starting empty: silently starting over would erase every player, and the fix (restore
   * last night's backup) is the operator's to make.
   */
  static open(dir: string): Store {
    fs.mkdirSync(path.join(dir, 'ledger'), { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'state.json');
    if (!fs.existsSync(file)) {
      const fresh: StateFile = {
        version: 1,
        logSalt: crypto.randomBytes(16).toString('hex'),
        gradeSecret: crypto.randomBytes(32).toString('hex'),
        players: {},
        leagues: {},
        seasons: {},
        results: {},
      };
      const store = new Store(dir, fresh);
      store.writeNow();
      return store;
    }
    let parsed: StateFile;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as StateFile;
    } catch (error) {
      throw new Error(`${file} is not valid JSON (${(error as Error).message}); restore it from a backup`);
    }
    if (parsed?.version !== 1 || typeof parsed.logSalt !== 'string') throw new Error(`${file} is not an Offsuit state file`);
    const store = new Store(dir, { ...parsed, results: parsed.results ?? {}, gradeSecret: parsed.gradeSecret ?? crypto.randomBytes(32).toString('hex') });
    if (parsed.gradeSecret === undefined) store.writeNow();
    return store;
  }

  get logSalt(): string {
    return this.state.logSalt;
  }

  get gradeSecret(): string {
    return this.state.gradeSecret;
  }

  /** Seasons that were opened, oldest first. */
  openedSeasons(): string[] {
    return Object.keys(this.state.seasons).sort();
  }

  // ── Players ──────────────────────────────────────────────────────────────

  player(key: string): PlayerRow | undefined {
    return Object.hasOwn(this.state.players, key) ? this.state.players[key] : undefined;
  }

  setProfile(key: string, name: string, now: number): PlayerRow {
    const today = day(now);
    const before = this.player(key);
    const row: PlayerRow = { name, adultOn: before?.adultOn ?? today, created: before?.created ?? today, seen: today };
    this.state.players[key] = row;
    this.changed();
    return row;
  }

  /** Record a sign-in day (one write a day at most). */
  touch(key: string, now: number): void {
    const row = this.player(key);
    if (row === undefined || row.seen === day(now)) return;
    row.seen = day(now);
    this.changed();
  }

  playerCount(): number {
    return Object.keys(this.state.players).length;
  }

  // ── Leagues ──────────────────────────────────────────────────────────────

  league(code: string): LeagueRow | undefined {
    return Object.hasOwn(this.state.leagues, code) ? this.state.leagues[code] : undefined;
  }

  createLeague(code: string, name: string, owner: string, now: number): LeagueRow {
    const row: LeagueRow = { name, owner, members: [owner], created: day(now) };
    this.state.leagues[code] = row;
    this.changed();
    return row;
  }

  joinLeague(code: string, key: string): void {
    const row = this.league(code);
    if (row === undefined || row.members.includes(key)) return;
    row.members.push(key);
    this.changed();
  }

  /** Leave a league; the oldest remaining member inherits ownership, and an empty league is deleted. */
  leaveLeague(code: string, key: string): void {
    const row = this.league(code);
    if (row === undefined) return;
    const at = row.members.indexOf(key);
    if (at >= 0) row.members.splice(at, 1);
    if (row.members.length === 0) delete this.state.leagues[code];
    else if (row.owner === key) row.owner = row.members[0];
    this.changed();
  }

  leaguesOf(key: string): { code: string; row: LeagueRow }[] {
    return Object.entries(this.state.leagues)
      .filter(([, row]) => row.members.includes(key))
      .map(([code, row]) => ({ code, row }));
  }

  // ── Seasons ──────────────────────────────────────────────────────────────

  season(id: string): SeasonRow | undefined {
    return Object.hasOwn(this.state.seasons, id) ? this.state.seasons[id] : undefined;
  }

  /** Open a season pinned to a grader version; an existing season keeps the version it opened with. */
  openSeason(id: string, graderVersion: number, now: number): SeasonRow {
    const existing = this.season(id);
    if (existing !== undefined) return existing;
    const row: SeasonRow = { graderVersion, opened: day(now) };
    this.state.seasons[id] = row;
    this.changed();
    return row;
  }

  saveResults(season: string, results: Record<string, Rating>): void {
    this.state.results[season] = results;
    this.changed();
  }

  results(season: string): Record<string, Rating> | undefined {
    return this.state.results[season];
  }

  // ── Ledgers ──────────────────────────────────────────────────────────────

  private ledgerFile(kind: LedgerKind, season: string): string {
    return path.join(this.dir, 'ledger', `${kind}-${season}.jsonl`);
  }

  append(kind: LedgerKind, season: string, line: DecisionLine | HandLine): void {
    fs.appendFileSync(this.ledgerFile(kind, season), `${JSON.stringify(line)}\n`, { mode: 0o600 });
  }

  /**
   * Visit every line of one ledger, streamed in 1 MB chunks (a ledger as one string would hit V8's string
   * limit at about a million lines). A torn last line (a crash mid-append) is skipped.
   */
  scan<T extends DecisionLine | HandLine>(kind: LedgerKind, season: string, visit: (line: T) => void): void {
    forEachLine(this.ledgerFile(kind, season), (text) => {
      let parsed: T;
      try {
        parsed = JSON.parse(text) as T;
      } catch {
        // A partial line from an interrupted append: it was never acknowledged as stored.
        return;
      }
      visit(parsed);
    });
  }

  /** Every line of one ledger (admin tools and tests; the server itself scans). */
  read<T extends DecisionLine | HandLine>(kind: LedgerKind, season: string): T[] {
    const out: T[] = [];
    this.scan<T>(kind, season, (line) => out.push(line));
    return out;
  }

  /** Delete ledgers older than the season before `current`. Their results must already be saved. */
  prune(current: string): string[] {
    const keep = new Set([current, previousSeason(current)]);
    const removed: string[] = [];
    for (const name of fs.readdirSync(path.join(this.dir, 'ledger'))) {
      const match = /^(?:decisions|hands)-(\d{4}-\d{2})\.jsonl$/.exec(name);
      if (match !== null && !keep.has(match[1])) {
        fs.rmSync(path.join(this.dir, 'ledger', name));
        removed.push(name);
      }
    }
    return removed;
  }

  ledgerSeasons(): string[] {
    const seasons = new Set<string>();
    for (const name of fs.readdirSync(path.join(this.dir, 'ledger'))) {
      const match = /^decisions-(\d{4}-\d{2})\.jsonl$/.exec(name);
      if (match !== null) seasons.add(match[1]);
    }
    return [...seasons].sort();
  }

  // ── A player's rights: export and erasure ──────────────────────────────────

  /**
   * Everything stored about one key, from one scan of every ledger. Other players at your hands appear by
   * the first 10 characters of their key only, and nothing about their networks.
   */
  exportAll(key: string): ExportDocument {
    const decisions: unknown[] = [];
    const hands: unknown[] = [];
    for (const season of this.ledgerSeasons()) {
      this.scan<DecisionLine>('decisions', season, (d) => {
        if (d.k === key) decisions.push({ ...d, opp: d.opp.map((o) => o.slice(0, 10)) });
      });
      this.scan<HandLine>('hands', season, (h) => {
        if (h.p.some((p) => p.k === key)) hands.push({ h: h.h, day: h.day, p: h.p.map((p) => ({ ...p, k: p.k === key ? 'you' : p.k.slice(0, 10) })) });
      });
    }
    const results: Record<string, Rating> = {};
    for (const [season, rows] of Object.entries(this.state.results)) if (rows[key]) results[season] = rows[key];
    return {
      summary: {
        key,
        player: this.player(key) ?? null,
        leagues: this.leaguesOf(key).map(({ code, row }) => ({ code, name: row.name, owner: row.owner === key, members: row.members.length })),
        pastSeasons: results,
        decisionCount: decisions.length,
        handCount: hands.length,
      },
      decisions,
      hands,
    };
  }

  /** One page of an export document: the summary, and EXPORT_PAGE decision and hand rows from `page`. */
  static page(doc: ExportDocument, page: number): Record<string, unknown> {
    const from = page * EXPORT_PAGE;
    return {
      ...doc.summary,
      page,
      pages: Math.max(1, Math.ceil(Math.max(doc.decisions.length, doc.hands.length) / EXPORT_PAGE)),
      decisions: doc.decisions.slice(from, from + EXPORT_PAGE),
      hands: doc.hands.slice(from, from + EXPORT_PAGE),
    };
  }

  /** One page of everything stored about a key (scans every ledger; the lobby serves pages from one scan). */
  exportFor(key: string, page = 0): Record<string, unknown> {
    return Store.page(this.exportAll(key), page);
  }

  /**
   * Erase one key: the player row, league memberships, past results, and every ledger line naming them.
   * Hands they shared with others keep the others' rows, with this player's row removed.
   */
  forget(key: string): void {
    delete this.state.players[key];
    for (const { code } of this.leaguesOf(key)) this.leaveLeague(code, key);
    for (const rows of Object.values(this.state.results)) delete rows[key];
    for (const season of this.ledgerSeasons()) {
      this.rewrite<DecisionLine>('decisions', season, (d) =>
        d.k === key ? null : d.opp.includes(key) ? { ...d, opp: d.opp.filter((o) => o !== key) } : d,
      );
      this.rewrite<HandLine>('hands', season, (h) =>
        h.p.some((p) => p.k === key) || h.shared.some(([a, b]) => a === key || b === key)
          ? { ...h, p: h.p.filter((p) => p.k !== key), shared: h.shared.filter(([a, b]) => a !== key && b !== key) }
          : h,
      );
    }
    this.changed();
    this.writeNow();
  }

  /** Stream one ledger through `map` (null drops the line) into a temp file, then rename it into place. */
  private rewrite<T extends DecisionLine | HandLine>(kind: LedgerKind, season: string, map: (line: T) => T | null): void {
    const file = this.ledgerFile(kind, season);
    if (!fs.existsSync(file)) return;
    const tmp = `${file}.tmp-${process.pid}`;
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      this.scan<T>(kind, season, (line) => {
        const kept = map(line);
        if (kept !== null) fs.writeSync(fd, `${JSON.stringify(kept)}\n`);
      });
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private changed(): void {
    this.dirty = true;
    if (this.timer !== null) return;
    this.timer = setTimeout(() => this.writeNow(), 1000);
    this.timer.unref();
  }

  writeNow(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    atomicWrite(path.join(this.dir, 'state.json'), JSON.stringify(this.state));
    this.dirty = false;
  }

  close(): void {
    if (this.dirty || this.timer !== null) this.writeNow();
  }
}

export interface ExportDocument {
  readonly summary: Record<string, unknown>;
  readonly decisions: readonly unknown[];
  readonly hands: readonly unknown[];
}

/** Decision and hand rows per export page: ~450 bytes a decision row, so a page is well under 1 MiB. */
export const EXPORT_PAGE = 1000;

/** Call `visit` for each non-empty line of a file, reading it in chunks. Nothing when the file is absent. */
function forEachLine(file: string, visit: (line: string) => void): void {
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return;
  }
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    const decoder = new StringDecoder('utf8');
    let rest = '';
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (n === 0) break;
      const lines = (rest + decoder.write(chunk.subarray(0, n))).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) if (line.length > 0) visit(line);
    }
    rest += decoder.end();
    if (rest.length > 0) visit(rest);
  } finally {
    fs.closeSync(fd);
  }
}

function atomicWrite(file: string, text: string): void {
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}
