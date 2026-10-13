/**
 * RANKINGS — the server's half of ranked play: grade every decision a ranked table records, keep the
 * season's tallies, and answer ladder, season and league queries (the score itself: src/core/online/ranked.ts).
 *
 * Grading runs off the table's path: a decision is queued and graded on a later turn of the event loop
 * (each grade is a ~2,000-sample Monte Carlo), so a table never waits on the grader. The ledger line is
 * written when the grade is, and the tallies are rebuilt from the ledger at startup, so the ledger is the
 * record and the tallies a cache of it.
 *
 * One season, one grader: the season opens pinned to GRADER_VERSION, and if this server's grader is not
 * the pinned one (its fingerprint differs, or the season opened under another version), ranked play is
 * refused for the rest of the season instead of mixing two graders in one ladder.
 */

import {
  addLoss,
  buildBoard,
  decisionSeed,
  EMPTY_TALLY,
  GRADER_FINGERPRINTS,
  GRADER_VERSION,
  graderFingerprint,
  gradeInput,
  gradeInputFor,
  MIN_DECISIONS,
  MIN_OPPONENTS,
  PAIR_CAP,
  rate,
  seasonBounds,
  seasonOf,
  type Board,
  type Rating,
  type Tally,
} from '../src/core/online/ranked.js';
import type { DecisionRecord } from '../src/core/relayServer.js';
import type { Log } from './log.js';
import { day, previousSeason, type DecisionLine, type HandLine, type Store } from './store.js';

/** A decision waiting to be graded, with the keys of the opponents dealt into its hand. */
export interface DecisionJob {
  readonly key: string;
  readonly opponents: readonly string[];
  readonly record: DecisionRecord;
}

interface SeasonTallies {
  /** Every decision: what a friends league shows. */
  readonly all: Map<string, Tally>;
  /** Decisions inside the per-pair cap: what the season ladder shows. */
  readonly capped: Map<string, Tally>;
  readonly pairs: Map<string, Map<string, number>>;
}

const emptyTallies = (): SeasonTallies => ({ all: new Map(), capped: new Map(), pairs: new Map() });

export interface SeasonView {
  readonly season: string;
  readonly graderVersion: number;
  readonly start: string;
  readonly end: string;
  readonly ranked: boolean;
  /** Why ranked play is closed, when it is. */
  readonly closed: string | null;
  readonly you: Rating & { readonly opponents: number; readonly needed: number; readonly minOpponents: number };
  readonly last: Rating | null;
}

export interface PairSignal {
  readonly a: string;
  readonly b: string;
  readonly hands: number;
  /** Chips that moved from a to b over their shared hands (negative: b to a). */
  readonly flow: number;
  /** Hands where the two connected from one network. */
  readonly sharedNetwork: number;
  /** The share of a's ranked hands that b sat in. */
  readonly shareOfA: number;
}

export class Rankings {
  private season: string;
  private tallies: SeasonTallies = emptyTallies();
  private queue: DecisionJob[] = [];
  private draining = false;
  private idleWaiters: (() => void)[] = [];
  private readonly fingerprintOk: boolean;

  constructor(
    private readonly store: Store,
    private readonly log: Log,
    private readonly now: () => number,
  ) {
    this.fingerprintOk = GRADER_FINGERPRINTS[GRADER_VERSION] === graderFingerprint();
    if (!this.fingerprintOk) this.log('grader.mismatch', { version: GRADER_VERSION });
    this.season = seasonOf(now());
    this.openSeason();
  }

  /** Open the current season (pinning the grader) and rebuild its tallies from the ledger. */
  private openSeason(): void {
    this.store.openSeason(this.season, GRADER_VERSION, this.now());
    this.tallies = emptyTallies();
    for (const line of this.store.read<DecisionLine>('decisions', this.season)) this.ingest(line.k, line.opp, line.ev);
    const removed = this.store.prune(this.season);
    if (removed.length > 0) this.log('ledger.pruned', { files: removed.length });
  }

  /** Close the month if it turned: keep each player's final rating, then start the new season empty. */
  private rollover(): void {
    const current = seasonOf(this.now());
    if (current === this.season) return;
    const results: Record<string, Rating> = {};
    for (const [key, tally] of this.tallies.capped) results[key] = rate(tally);
    this.store.saveResults(this.season, results);
    this.log('season.closed', { players: Object.keys(results).length });
    this.season = current;
    this.openSeason();
  }

  currentSeason(): string {
    this.rollover();
    return this.season;
  }

  /** Null when ranked play is open, else the reason it is closed. */
  closedReason(): string | null {
    this.rollover();
    if (!this.fingerprintOk) return 'Ranked play is paused: this server’s grader does not match its pinned version.';
    const row = this.store.season(this.season);
    if (row !== undefined && row.graderVersion !== GRADER_VERSION) {
      return 'Ranked play resumes next season: the grader changed during this one.';
    }
    return null;
  }

  private ingest(key: string, opponents: readonly string[], loss: number): void {
    const t = this.tallies;
    t.all.set(key, addLoss(t.all.get(key) ?? EMPTY_TALLY, loss));
    const pairs = t.pairs.get(key) ?? new Map<string, number>();
    t.pairs.set(key, pairs);
    // Counted on the ladder only while every opponent at the hand is still under the pair cap.
    const underCap = opponents.every((o) => (pairs.get(o) ?? 0) < PAIR_CAP);
    for (const o of opponents) pairs.set(o, (pairs.get(o) ?? 0) + 1);
    if (underCap) t.capped.set(key, addLoss(t.capped.get(key) ?? EMPTY_TALLY, loss));
  }

  // ── Grading ──────────────────────────────────────────────────────────────

  submit(job: DecisionJob): void {
    this.queue.push(job);
    if (!this.draining) {
      this.draining = true;
      setImmediate(() => this.drain());
    }
  }

  private drain(): void {
    const started = Date.now();
    // Grade for at most ~8 ms per turn of the loop, then yield so sockets and clocks keep moving.
    while (this.queue.length > 0 && Date.now() - started < 8) this.grade(this.queue.shift()!);
    if (this.queue.length > 0) {
      setImmediate(() => this.drain());
      return;
    }
    this.draining = false;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }

  private grade(job: DecisionJob): void {
    // A key erased while its decisions waited in the queue (it left the table by deleting its data) is
    // never written back.
    if (this.store.player(job.key) === undefined) return;
    const { record } = job;
    const input = gradeInputFor(record.before, record.seat, record.action, decisionSeed(record.nonce, record.index));
    const ev = gradeInput(input);
    const season = this.currentSeason();
    const line: DecisionLine = {
      k: job.key,
      d: `${record.nonce}:${record.index}`,
      ev: Math.round(ev * 10_000) / 10_000,
      g: GRADER_VERSION,
      auto: record.auto,
      opp: job.opponents,
      day: day(this.now()),
      in: input,
    };
    this.store.append('decisions', season, line);
    this.ingest(job.key, job.opponents, line.ev);
  }

  /** Resolves once every queued decision is graded and written (tests, and a clean shutdown). */
  idle(): Promise<void> {
    if (!this.draining && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  recordHand(line: HandLine): void {
    const known = (k: string): boolean => this.store.player(k) !== undefined;
    this.store.append('hands', this.currentSeason(), { ...line, p: line.p.filter((p) => known(p.k)), shared: line.shared.filter(([a, b]) => known(a) && known(b)) });
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  private nameOf(key: string): string {
    return this.store.player(key)?.name ?? 'Player';
  }

  private opponentsOf(key: string): number {
    return this.tallies.pairs.get(key)?.size ?? 0;
  }

  ladder(viewer: string): Board & { readonly season: string } {
    const season = this.currentSeason();
    const entries = [...this.tallies.capped].map(([key, tally]) => ({
      keyId: key.slice(0, 10),
      name: this.nameOf(key),
      tally,
      eligible: this.opponentsOf(key) >= MIN_OPPONENTS,
    }));
    return { season, ...buildBoard(entries, viewer.slice(0, 10)) };
  }

  leagueBoard(members: readonly string[], viewer: string): Board {
    const entries = members.map((key) => ({ keyId: key.slice(0, 10), name: this.nameOf(key), tally: this.tallies.all.get(key) ?? EMPTY_TALLY }));
    return buildBoard(entries, viewer.slice(0, 10));
  }

  seasonView(viewer: string): SeasonView {
    const season = this.currentSeason();
    const { start, end } = seasonBounds(season);
    const closed = this.closedReason();
    const mine = rate(this.tallies.capped.get(viewer) ?? EMPTY_TALLY);
    const last = this.store.results(previousSeason(season))?.[viewer] ?? null;
    return {
      season,
      graderVersion: this.store.season(season)?.graderVersion ?? GRADER_VERSION,
      start: day(start),
      end: day(end),
      ranked: closed === null,
      closed,
      you: { ...mine, opponents: this.opponentsOf(viewer), needed: MIN_DECISIONS, minOpponents: MIN_OPPONENTS },
      last,
    };
  }

  /** Drop a key from the live tallies (the store erases the ledger). */
  forget(key: string): void {
    this.tallies.all.delete(key);
    this.tallies.capped.delete(key);
    this.tallies.pairs.delete(key);
    for (const pairs of this.tallies.pairs.values()) pairs.delete(key);
  }

  /**
   * Collusion signals for the operator (admin.ts signals), never shown to players: per pair of players,
   * how often they sit together, the chips that moved between them, and how often from one network.
   * Read from the hand ledger; a high share plus a one-way flow is the pattern worth a look.
   */
  signals(season = this.currentSeason()): PairSignal[] {
    const pair = new Map<string, { hands: number; flow: number; shared: number }>();
    const handsOf = new Map<string, number>();
    for (const hand of this.store.read<HandLine>('hands', season)) {
      for (const p of hand.p) handsOf.set(p.k, (handsOf.get(p.k) ?? 0) + 1);
      for (let i = 0; i < hand.p.length; i += 1) {
        for (let j = i + 1; j < hand.p.length; j += 1) {
          const [a, b] = [hand.p[i], hand.p[j]].sort((x, y) => x.k.localeCompare(y.k));
          const id = `${a.k}|${b.k}`;
          const row = pair.get(id) ?? { hands: 0, flow: 0, shared: 0 };
          row.hands += 1;
          // What a lost and b won this hand, counted once per pair: a crude, honest flow measure.
          const lossA = Math.max(0, a.start - a.end);
          const winB = Math.max(0, b.end - b.start);
          const lossB = Math.max(0, b.start - b.end);
          const winA = Math.max(0, a.end - a.start);
          row.flow += Math.min(lossA, winB) - Math.min(lossB, winA);
          if (hand.shared.some(([x, y]) => (x === a.k && y === b.k) || (x === b.k && y === a.k))) row.shared += 1;
          pair.set(id, row);
        }
      }
    }
    return [...pair].map(([id, row]) => {
      const [a, b] = id.split('|');
      return { a, b, hands: row.hands, flow: row.flow, sharedNetwork: row.shared, shareOfA: row.hands / (handsOf.get(a) ?? row.hands) };
    }).sort((x, y) => y.hands - x.hands);
  }
}
