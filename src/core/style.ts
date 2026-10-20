/**
 * YOUR STYLE (VISION pillar 9, You › Style): how the learner plays, read from the hand log by the engine. The tutor
 * never authors any of it.
 *
 * Two axes, both counted from `HandRecord.vpip/pfr`:
 *  - hands you play: the share of hands with chips put in voluntarily (VPIP);
 *  - taking the lead: of the hands you play, the share you raised first in (PFR ÷ VPIP).
 * The two lines split the map into four neutral styles. Each name describes how the hands were played, never the
 * person (G7, BANNED_PHRASINGS in progress.ts): no style is better than another, and the map says what would move
 * you, not what you should be.
 *
 * NEVER A READ ON NOISE. A style is named only from at least MIN_OBSERVATIONS hands (20, the reads.ts gate the leak
 * finder also uses) AND as many hands played, since the lead is a share of those; each other rate needs as many
 * observations of its own. When the exact 90% band of a share
 * crosses its line, the read says so ("close to the line") rather than pretending the side is settled.
 *
 * Pure: the caller passes the day function.
 */

import type { DayKey, DayKeyOf } from './localDay.js';
import type { HandRecord } from './session.js';
import type { ArchetypeName } from './archetypes.js';
import { MIN_OBSERVATIONS } from './reads.js';
import { clopperPearson } from './pro/binomial.js';
import { weekOf } from './week.js';

/** Hands (and observations per rate) before anything is read. */
export const STYLE_MIN_HANDS = MIN_OBSERVATIONS;
/** The hands line: playing more than this share of hands is "more hands". */
export const HANDS_LINE = 0.27;
/** The lead line: raising first in at least this share of the hands you play is "taking the lead". */
export const LEAD_LINE = 0.5;
/** Weeks the trail keeps. */
export const TRAIL_WEEKS = 8;
export const STYLE_BAND = 0.9;

export const STYLE_IDS = ['closer', 'pressure', 'anchor', 'explorer'] as const;
export type StyleId = (typeof STYLE_IDS)[number];

export interface StyleInfo {
  readonly name: string;
  /** One line, how the hands were played. */
  readonly how: string;
  /** Which side of each line. */
  readonly moreHands: boolean;
  readonly leads: boolean;
}

export const STYLES: Readonly<Record<StyleId, StyleInfo>> = {
  closer: { name: 'The Closer', how: 'Fewer hands, and you do the betting.', moreHands: false, leads: true },
  pressure: { name: 'The Pressure', how: 'Many hands, and you lead most of them.', moreHands: true, leads: true },
  anchor: { name: 'The Anchor', how: 'Fewer hands, and others bet into you.', moreHands: false, leads: false },
  explorer: { name: 'The Explorer', how: 'Many hands; the board comes to you.', moreHands: true, leads: false },
};

/**
 * Where the regulars of the Long Orbit sit on the same map, from their fixed archetype (archetypes.ts): how often
 * each enters a pot and whether it raises or calls when it does. Shown only for a rival already unmasked.
 */
export const ARCHETYPE_STYLE: Readonly<Record<ArchetypeName, StyleId>> = {
  nit: 'closer',
  'tag-reg': 'closer',
  lag: 'pressure',
  maniac: 'pressure',
  'over-folder': 'anchor',
  station: 'explorer',
};

export function styleAt(handsShare: number, lead: number): StyleId {
  const more = handsShare > HANDS_LINE;
  const leads = lead >= LEAD_LINE;
  return more ? (leads ? 'pressure' : 'explorer') : leads ? 'closer' : 'anchor';
}

/** A count read: k of n, the share once n reaches the gate (null below it), and how many more are needed. */
export interface Rate {
  readonly k: number;
  readonly n: number;
  /** k / n once n >= STYLE_MIN_HANDS, else null. */
  readonly share: number | null;
  readonly needed: number;
}

function rate(k: number, n: number): Rate {
  return { k, n, share: n >= STYLE_MIN_HANDS ? k / n : null, needed: Math.max(0, STYLE_MIN_HANDS - n) };
}

export interface TrailPoint {
  /** The Monday the week starts. */
  readonly week: DayKey;
  readonly hands: number;
  readonly handsShare: number;
  readonly lead: number;
  readonly style: StyleId;
}

export interface GraderRow {
  readonly kind: 'lead' | 'call' | 'fold';
  /** Graded decisions of this kind, and how many cost nothing. */
  readonly graded: number;
  readonly right: number;
}

export interface StyleRead {
  /** Hands in the log the read uses. */
  readonly hands: number;
  /** The first local day in the log with a timestamp, or null. */
  readonly since: DayKey | null;
  readonly vpip: Rate;
  readonly pfr: Rate;
  /** PFR over VPIP: of the hands played, the share raised first in. n is the hands played. */
  readonly lead: Rate;
  /** Null until STYLE_MIN_HANDS hands and STYLE_MIN_HANDS of them played. */
  readonly style: StyleId | null;
  /** The 90% band of each share crosses its line: the side is not settled yet. */
  readonly nearHandsLine: boolean;
  readonly nearLeadLine: boolean;
  /** Postflop bets, raises and all-ins over calls. Null until STYLE_MIN_HANDS such actions. */
  readonly aggression: { readonly aggressive: number; readonly calls: number; readonly factor: number | null; readonly needed: number };
  /** Facing a river bet: the share folded. */
  readonly foldToRiverBet: Rate;
  /**
   * "Was": the share in the oldest week with STYLE_MIN_HANDS river bets of its own, shown only when the log holds at
   * least as many river bets outside that week, so the two numbers are not mostly the same bets.
   */
  readonly foldToRiverBetWas: number | null;
  /** One point per week that clears the same gate as the style (hands and hands played), oldest first, at most TRAIL_WEEKS. */
  readonly trail: readonly TrailPoint[];
  /** What the coach said about each kind of decision, from the verdicts on file. */
  readonly grader: readonly GraderRow[];
}

type LoggedHand = Pick<HandRecord, 'vpip' | 'pfr' | 'playedAt' | 'decisions'>;

const POSTFLOP = new Set(['flop', 'turn', 'river']);
const AGGRESSIVE = new Set(['bet', 'raise', 'allin']);

export function styleRead(hands: readonly LoggedHand[], dayOf: DayKeyOf): StyleRead {
  let vpip = 0;
  let pfr = 0;
  let aggressive = 0;
  let calls = 0;
  let since: DayKey | null = null;
  const weeks = new Map<number, { n: number; vpip: number; pfr: number; riverBets: number; riverFolds: number }>();
  const grader = { lead: { graded: 0, right: 0 }, call: { graded: 0, right: 0 }, fold: { graded: 0, right: 0 } };
  let riverBets = 0;
  let riverFolds = 0;

  for (const h of hands) {
    if (h.vpip) vpip++;
    if (h.pfr) pfr++;
    let week: { n: number; vpip: number; pfr: number; riverBets: number; riverFolds: number } | null = null;
    if (typeof h.playedAt === 'number') {
      const day = dayOf(h.playedAt);
      if (since === null || day < since) since = day;
      const w = weekOf(day);
      week = weeks.get(w) ?? { n: 0, vpip: 0, pfr: 0, riverBets: 0, riverFolds: 0 };
      week.n++;
      if (h.vpip) week.vpip++;
      if (h.pfr && h.vpip) week.pfr++;
      weeks.set(w, week);
    }
    for (const d of h.decisions ?? []) {
      if (POSTFLOP.has(d.street)) {
        if (AGGRESSIVE.has(d.action)) aggressive++;
        else if (d.action === 'call') calls++;
      }
      if (d.street === 'river' && d.toCall > 0) {
        riverBets++;
        if (d.action === 'fold') riverFolds++;
        if (week) {
          week.riverBets++;
          if (d.action === 'fold') week.riverFolds++;
        }
      }
      if (d.verdict === null) continue;
      const kind = AGGRESSIVE.has(d.action) ? 'lead' : d.toCall > 0 && d.action === 'call' ? 'call' : d.toCall > 0 && d.action === 'fold' ? 'fold' : null;
      if (kind === null) continue;
      grader[kind].graded++;
      if (d.verdict.severity === 'free') grader[kind].right++;
    }
  }

  const n = hands.length;
  const vpipRate = rate(vpip, n);
  const lead = rate(Math.min(pfr, vpip), vpip);
  const style = vpipRate.share !== null && lead.share !== null ? styleAt(vpipRate.share, lead.share) : null;
  const handsBand = n > 0 ? clopperPearson(vpip, n, STYLE_BAND) : { low: 0, high: 1 };
  const leadBand = vpip > 0 ? clopperPearson(Math.min(pfr, vpip), vpip, STYLE_BAND) : { low: 0, high: 1 };

  const ordered = [...weeks.entries()].sort((a, b) => a[0] - b[0]);
  const trail: TrailPoint[] = ordered
    .filter(([, w]) => w.n >= STYLE_MIN_HANDS && w.vpip >= STYLE_MIN_HANDS)
    .slice(-TRAIL_WEEKS)
    .map(([week, w]) => ({ week: week as DayKey, hands: w.n, handsShare: w.vpip / w.n, lead: w.pfr / w.vpip, style: styleAt(w.vpip / w.n, w.pfr / w.vpip) }));
  const firstRiverWeek = ordered.find(([, w]) => w.riverBets >= STYLE_MIN_HANDS);

  return {
    hands: n,
    since,
    vpip: vpipRate,
    pfr: rate(pfr, n),
    lead,
    style,
    nearHandsLine: style !== null && handsBand.low <= HANDS_LINE && handsBand.high > HANDS_LINE,
    nearLeadLine: style !== null && leadBand.low < LEAD_LINE && leadBand.high >= LEAD_LINE,
    aggression: {
      aggressive,
      calls,
      factor: aggressive + calls >= STYLE_MIN_HANDS && calls > 0 ? aggressive / calls : null,
      needed: Math.max(0, STYLE_MIN_HANDS - (aggressive + calls)),
    },
    foldToRiverBet: rate(riverFolds, riverBets),
    foldToRiverBetWas:
      firstRiverWeek !== undefined && riverBets - firstRiverWeek[1].riverBets >= STYLE_MIN_HANDS ? firstRiverWeek[1].riverFolds / firstRiverWeek[1].riverBets : null,
    trail,
    grader: (['lead', 'call', 'fold'] as const).map((kind) => ({ kind, ...grader[kind] })),
  };
}

/** A share as a whole percent. */
export function pct(share: number): number {
  return Math.round(share * 100);
}
