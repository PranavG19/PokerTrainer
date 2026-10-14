/**
 * The line grammar PokerStars, GGPoker and ACR share: seat lines, the button line, blind posts, the
 * street markers, "Dealt to", and "NAME<sep>verb amount" action lines. Each site file supplies a
 * `Dialect` (how its header reads, and what sits between a name and its verb); everything after the
 * header is this one state machine.
 *
 * Hostile input rules, kept here so no site file can forget them:
 * - every line's length is checked against MAX_LINE before any regex or slice sees it;
 * - a hand over MAX_HAND_LINES is 'too-long' before any line is read;
 * - regexes are anchored or bounded, with no nested or overlapping quantifiers;
 * - player names are matched against the seat-line names, longest first, never by splitting on spaces,
 *   so a name with spaces, colons, dots or brackets cannot shift what the rest of the line means.
 *
 * Never read: winnings, "collected", rake, pot totals, chat. Those lines fall through as ignored.
 */

import type { Card } from '../cards.js';
import {
  MAX_HAND_LINES,
  MAX_LINE,
  isParsedHand,
  normaliseDate,
  parseAmount,
  parseCards,
  type ActionKind,
  type HhAction,
  type ParsedHand,
  type Site,
  type SkipReason,
  type Street,
} from './handHistory.js';

export interface Skip {
  readonly skip: SkipReason;
  readonly id: string | null;
}
export type HandOutcome = ParsedHand | Skip;

export const isSkip = (r: HandOutcome): r is Skip => 'skip' in r;

export interface Header {
  readonly id: string;
  readonly game: 'cash' | 'tournament';
  readonly sb: number;
  readonly bb: number;
  readonly playedAt: string | null;
}

export interface Dialect {
  readonly site: Site;
  /** What sits between a player's name and the verb: ': ' on Stars and GG, ' ' on ACR. */
  readonly sep: string;
  /** The hand number from a header line, or null when the line is not this site's header. */
  headerId(line: string): string | null;
  /** The whole header: the stakes, game and date, or why the hand is not kept. */
  header(line: string, id: string): Header | SkipReason;
}

/** CRLF, CR and LF all end a line, so a Windows export parses exactly like a Mac one. */
export const splitLines = (text: string): string[] => text.split(/\r\n|\r|\n/);

export const stripBom = (line: string): string => (line.charCodeAt(0) === 0xfeff ? line.slice(1) : line);

export const isBlank = (line: string): boolean => line.trim() === '';

// ---------------------------------------------------------------------------------------------------
// Header pieces the sites share

/** "($0.05/$0.10 USD)", "(€0.02/€0.05 EUR)", "($0.02/$0.05)": a cash game's stakes. */
const CASH_STAKES = /\(([$€£]?[\d.,]{1,20})\/([$€£]?[\d.,]{1,20})(?: [A-Z]{3})?\)/;
/** "Level I (10/20)", "Level10(1,500/3,000(400))", "Level 1 (10.00/20.00)": a tournament level. */
const LEVEL_STAKES = /Level ?[IVXLCDM\d]{1,8} ?\(([\d.,]{1,20})\/([\d.,]{1,20})[()]/;
/** ACR cash: " - $0.01/$0.02 - " with no parentheses. */
const DASH_STAKES = / - ([$€£]?[\d.,]{1,20})\/([$€£]?[\d.,]{1,20}) - /;

export type StakesStyle = 'cash' | 'level' | 'dash';

const STAKES_RE: Readonly<Record<StakesStyle, RegExp>> = { cash: CASH_STAKES, level: LEVEL_STAKES, dash: DASH_STAKES };

/**
 * The blinds and the date from the text after the hand number. The date is looked for only AFTER the
 * stakes, so a big blind like "1000/2000" can never be mistaken for the start of a date.
 */
export function stakesAndDate(
  rest: string,
  style: StakesStyle,
): { sb: number; bb: number; playedAt: string | null } | null {
  const m = STAKES_RE[style].exec(rest);
  if (m === null) return null;
  const sb = parseAmount(m[1]);
  const bb = parseAmount(m[2]);
  if (sb === null || bb === null || bb < 1) return null;
  return { sb, bb, playedAt: normaliseDate(rest.slice(m.index + m[0].length)) };
}

/** Stars and GG name the game the same way: "Hold'em No Limit", "Hold'em Limit", "Omaha Pot Limit". */
export function holdemGameSkip(rest: string): SkipReason | null {
  // Short deck is "6+ Hold'em" on Stars and "Short Deck" on GG: a different game, whatever its limit.
  if (rest.includes('6+') || rest.includes('Short Deck') || !rest.includes("Hold'em")) return 'not-holdem';
  return rest.includes("Hold'em No Limit") ? null : 'not-no-limit';
}

// ---------------------------------------------------------------------------------------------------
// Seat and table lines

const SEAT_HEAD = /^Seat (\d{1,2}): /;
/**
 * The stack at the END of a seat line: "($10 in chips)", "(1500 in chips, $0.50 bounty)", ACR "($2.00)".
 * Anchored at the end so a name holding its own "(…)" never reads as the stack.
 */
const SEAT_STACK = / \(([$€£]?[\d.,]{1,20})(?: in chips)?(?:, [^()]{1,60})?\)$/;
const SITTING_OUT = ' is sitting out';

interface SeatLine {
  readonly seatNo: number;
  readonly name: string;
  readonly stack: number;
  readonly out: boolean;
}

function seatLine(line: string): SeatLine | null {
  const m = SEAT_HEAD.exec(line);
  if (m === null) return null;
  let rest = line.slice(m[0].length);
  let out = false;
  if (rest.endsWith(SITTING_OUT)) {
    out = true;
    rest = rest.slice(0, -SITTING_OUT.length);
  } else {
    // Stars: "(1500 in chips) out of hand (moved from another table into small blind)".
    const k = rest.indexOf(') out of hand');
    if (k >= 0) {
      out = true;
      rest = rest.slice(0, k + 1);
    }
  }
  const s = SEAT_STACK.exec(rest);
  if (s === null || s.index === 0) return null;
  const stack = parseAmount(s[1]);
  if (stack === null) return null;
  return { seatNo: Number(m[1]), name: rest.slice(0, s.index), stack, out };
}

const TABLE_MAX = /(?:^| )(\d{1,2})-max(?: \(Play Money\))? Seat #(\d{1,2}) is the button$/;
const TABLE_BUTTON = /Seat #(\d{1,2}) is the button$/;

function tableLine(line: string): { max: number | null; button: number } | null {
  const m = TABLE_MAX.exec(line);
  if (m !== null) return { max: Number(m[1]), button: Number(m[2]) };
  const b = TABLE_BUTTON.exec(line);
  return b === null ? null : { max: null, button: Number(b[1]) };
}

// ---------------------------------------------------------------------------------------------------
// Markers, cards, verbs

interface Marker {
  readonly name: string;
  readonly rest: string;
}

/** "*** FLOP *** [..]" (every site) or ACR's older "** Dealing Flop ** [ 2d, 7h, Kc ]". */
function marker(line: string): Marker | null {
  for (const fence of ['*** ', '** ']) {
    if (!line.startsWith(fence)) continue;
    const close = ' ' + fence.trimEnd();
    const k = line.indexOf(close, fence.length);
    if (k < 0) return null;
    return { name: line.slice(fence.length, k).toUpperCase(), rest: line.slice(k + close.length) };
  }
  return null;
}

const HOLE_MARKERS = new Set(['HOLE CARDS', 'DEALING DOWN CARDS']);
const SHOWDOWN_MARKERS = new Set([
  'SHOW DOWN',
  'SHOWDOWN',
  'FIRST SHOW DOWN',
  'FIRST SHOWDOWN',
  'SECOND SHOW DOWN',
  'SECOND SHOWDOWN',
]);
const SUMMARY_MARKERS = new Set(['SUMMARY']);
const BOARD_SIZE = { flop: 3, turn: 4, river: 5 } as const;
const PREV_STREET = { flop: 'preflop', turn: 'flop', river: 'turn' } as const;

/**
 * Which street a marker opens. A run-it-twice prints "FIRST FLOP" and "SECOND FLOP": the first board is
 * the one kept (ParsedHand.board), the second is ignored ('second').
 */
function boardStreet(name: string): 'flop' | 'turn' | 'river' | 'second' | null {
  let n = name;
  if (n.startsWith('SECOND ') || n.startsWith('THIRD ')) n = n.slice(n.indexOf(' ') + 1);
  const second = n !== name;
  if (n.startsWith('FIRST ')) n = n.slice(6);
  else if (n.startsWith('DEALING ')) n = n.slice(8);
  if (n !== 'FLOP' && n !== 'TURN' && n !== 'RIVER') return null;
  if (second) return 'second';
  return n.toLowerCase() as 'flop' | 'turn' | 'river';
}

/** Every "[..]" group on a street line, concatenated ("[Kc 7h 2d] [9s]" = four cards). */
function bracketCards(text: string): Card[] | null {
  const out: Card[] = [];
  let from = 0;
  for (let groups = 0; ; groups++) {
    const a = text.indexOf('[', from);
    if (a < 0) return groups === 0 ? null : out;
    if (groups === 2) return null;
    const b = text.indexOf(']', a);
    if (b < 0) return null;
    // ACR's older format separates board cards with commas.
    const cards = parseCards(text.slice(a, b + 1).replace(/,/g, ' '));
    if (cards === null) return null;
    out.push(...cards);
    from = b + 1;
  }
}

const ALL_IN = ' and is all-in';

type Verb =
  | { readonly post: 'sb' | 'bb' | 'ante' | 'other'; readonly amount: number }
  | { readonly kind: ActionKind; readonly amount: number; readonly allIn: boolean };

const ACTION_WORDS = ['folds', 'checks', 'calls', 'bets', 'raises', 'posts'];

/** What follows a player's name. null: not a betting line (shows, mucks, collected, chat…). 'bad': a betting verb that does not parse. */
function parseVerb(text: string): Verb | 'bad' | null {
  let r = text;
  let allIn = false;
  if (r.endsWith(ALL_IN)) {
    allIn = true;
    r = r.slice(0, -ALL_IN.length);
  }
  const amt = (s: string): number | null => parseAmount(s);
  if (r === 'folds' || r.startsWith('folds [')) return { kind: 'fold', amount: 0, allIn: false };
  if (r === 'checks') return { kind: 'check', amount: 0, allIn: false };
  for (const [word, kind] of [
    ['calls ', 'call'],
    ['bets ', 'bet'],
  ] as const) {
    if (!r.startsWith(word)) continue;
    const a = amt(r.slice(word.length));
    return a === null ? 'bad' : { kind, amount: a, allIn };
  }
  if (r.startsWith('raises ')) {
    // "raises $0.20 to $0.30" keeps the "to" total; "raises to $0.30" (older WPN) is the same total.
    const body = r.slice(7);
    const k = body.startsWith('to ') ? 0 : body.indexOf(' to ');
    if (k < 0) return 'bad';
    if (k > 0 && amt(body.slice(0, k)) === null) return 'bad';
    const to = amt(body.slice(k === 0 ? 3 : k + 4));
    return to === null ? 'bad' : { kind: 'raise', amount: to, allIn };
  }
  if (r.startsWith('posts ')) {
    const p = r.slice(6);
    for (const [prefix, post] of [
      ['small blind ', 'sb'],
      ['the small blind ', 'sb'],
      ['big blind ', 'bb'],
      ['the big blind ', 'bb'],
      ['the ante ', 'ante'],
      ['ante ', 'ante'],
    ] as const) {
      if (!p.startsWith(prefix)) continue;
      const a = amt(p.slice(prefix.length));
      return a === null ? 'bad' : { post, amount: a };
    }
    // "posts small & big blinds $0.15" (a dead blind), a straddle, anything else: chips in the pot, but
    // not the hand's small or big blind and not a decision, so neither a blind seat nor an action.
    return { post: 'other', amount: 0 };
  }
  const word = r.split(' ', 1)[0];
  return ACTION_WORDS.includes(word) ? 'bad' : null;
}

/** A betting line whose name is not a seated player: the hand references someone it never seated. */
function looksLikeAction(line: string, sep: string): boolean {
  if (sep === ': ') return ACTION_WORDS.some((w) => line.includes(`: ${w}`));
  return (
    line.endsWith(' folds') ||
    line.endsWith(' checks') ||
    ACTION_WORDS.some((w) => line.includes(` ${w} `))
  );
}

// ---------------------------------------------------------------------------------------------------
// The hand

const malformed = (id: string | null): Skip => ({ skip: 'malformed', id });

/**
 * One hand's lines to a ParsedHand or a skip. Blank lines around (and inside) the hand are ignored.
 *
 * Choices the formats leave open:
 * - A seat marked sitting out (or "out of hand") is not in `seats`. In Stars tournaments such a player
 *   still posts and is auto-folded: their posts count toward the ante but name no blind seat, and their
 *   folds are ignored; any other action from them, or a "Dealt to" with cards, does not make them a
 *   player (the cards are ignored, so a sat-out hero is 'no-hero-cards').
 * - A dead button (on an empty seat) is given to the nearest seated player before it, the player who
 *   acts last postflop.
 * - The first small-blind and first big-blind posts name `sbSeat`/`bbSeat`; later ones (a new player
 *   posting in) do not. `ante` is the largest single ante posted.
 * - `showdown` needs the showdown section, hero not folded, and someone else not folded: GG prints
 *   "*** SHOWDOWN ***" even when everyone folds to one player.
 */
export function parseHandLines(raw: readonly string[], d: Dialect): HandOutcome {
  let start = 0;
  let end = raw.length;
  while (start < end && isBlank(raw[start])) start++;
  while (end > start && isBlank(raw[end - 1])) end--;
  if (start === end) return malformed(null);
  const first = stripBom(raw[start]).trimStart();
  const id = first.length <= MAX_LINE ? d.headerId(first) : null;
  if (end - start > MAX_HAND_LINES) return { skip: 'too-long', id };
  const lines: string[] = [];
  for (let i = start; i < end; i++) {
    const l = i === start ? first : raw[i];
    if (l.length > MAX_LINE) return malformed(id);
    // GG pads "Dealt to 4a7b3c9d " with a trailing space; nothing reads trailing whitespace.
    lines.push(l.trimEnd());
  }
  if (id === null) return malformed(null);
  const head = d.header(lines[0], id);
  if (typeof head === 'string') return { skip: head, id };

  // Pass 1: the table line and the seat lines, which all come before the first "***" marker.
  let table: { max: number | null; button: number } | null = null;
  const all: SeatLine[] = [];
  let bodyStart = 1;
  for (; bodyStart < lines.length; bodyStart++) {
    const l = lines[bodyStart];
    if (l.startsWith('*')) break;
    if (l.startsWith('Seat ')) {
      const s = seatLine(l);
      if (s === null) return malformed(id);
      all.push(s);
    } else if (table === null && l.endsWith(' is the button')) {
      table = tableLine(l);
      if (table === null) return malformed(id);
    }
  }
  if (table === null) return malformed(id);
  if (new Set(all.map((s) => s.seatNo)).size !== all.length) return malformed(id);
  if (new Set(all.map((s) => s.name)).size !== all.length) return malformed(id);
  if (all.some((s) => s.seatNo < 1 || s.seatNo > 10 || s.name.trim() === '')) return malformed(id);
  const live = all.filter((s) => !s.out).sort((a, b) => a.seatNo - b.seatNo);
  if (live.length < 2 || live.length > 10) return malformed(id);
  const maxSeats = table.max ?? (live.length > 9 || all.some((s) => s.seatNo > 9) ? 10 : 9);
  if (maxSeats < 2 || maxSeats > 10 || all.some((s) => s.seatNo > maxSeats)) return malformed(id);
  const buttonNo = table.button;
  let button = live.findIndex((s) => s.seatNo === buttonNo);
  if (button < 0) {
    const before = live.filter((s) => s.seatNo < buttonNo);
    button = before.length > 0 ? live.indexOf(before[before.length - 1]) : live.length - 1;
  }

  // Longest name first, so "Hero" never claims a line that belongs to "Hero 2". -1 = sitting out.
  const names = [
    ...live.map((s, idx) => ({ name: s.name, idx })),
    ...all.filter((s) => s.out).map((s) => ({ name: s.name, idx: -1 })),
  ].sort((a, b) => b.name.length - a.name.length);
  const findName = (text: string, after: string): { name: string; idx: number } | null => {
    for (const n of names) if (text.startsWith(n.name + after)) return n;
    return null;
  };

  // Pass 2: posts, cards, streets and actions.
  let street: Street | null = null;
  let inShowdown = false;
  let sawShowdown = false;
  // Every site ends a finished hand with a summary; a hand without one was cut off mid-write.
  let sawSummary = false;
  let hero: number | null = null;
  let heroCards: Card[] | null = null;
  let board: Card[] = [];
  let sbSeat: number | null = null;
  let bbSeat: number | null = null;
  let ante = 0;
  const actions: HhAction[] = [];

  for (let j = 1; j < lines.length; j++) {
    const l = lines[j];
    if (l === '' || (j < bodyStart && (l.startsWith('Seat ') || l.endsWith(' is the button')))) continue;

    if (l.startsWith('*')) {
      const mk = marker(l);
      if (mk === null) continue;
      if (SUMMARY_MARKERS.has(mk.name)) {
        sawSummary = true;
        break;
      }
      if (SHOWDOWN_MARKERS.has(mk.name)) {
        sawShowdown = true;
        inShowdown = true;
        continue;
      }
      if (inShowdown) continue;
      if (HOLE_MARKERS.has(mk.name)) {
        if (street !== null && street !== 'preflop') return malformed(id);
        street = 'preflop';
        continue;
      }
      const bs = boardStreet(mk.name);
      if (bs === null || bs === 'second') continue;
      if (street !== PREV_STREET[bs]) return malformed(id);
      const got = bracketCards(mk.rest);
      if (got === null) return malformed(id);
      const size = BOARD_SIZE[bs];
      if (got.length === size && got.slice(0, board.length).every((c, k) => c === board[k])) board = got;
      else if (board.length + got.length === size) board = [...board, ...got];
      else return malformed(id);
      if (new Set(board).size !== board.length) return malformed(id);
      street = bs;
      continue;
    }

    if (l.startsWith('Dealt to ')) {
      const rest = l.slice(9);
      if (names.some((n) => n.name === rest)) continue; // GG lists every player, with cards for hero only
      const who = findName(rest, ' [');
      if (who === null) return malformed(id);
      if (who.idx < 0) continue;
      const cards = parseCards(rest.slice(who.name.length + 1));
      if (cards === null || cards.length !== 2 || hero !== null) return malformed(id);
      hero = who.idx;
      heroCards = cards;
      if (street === null) street = 'preflop';
      continue;
    }

    const who = findName(l, d.sep);
    if (who === null) {
      if (l.includes(' said, "')) continue;
      if (looksLikeAction(l, d.sep)) return malformed(id);
      continue;
    }
    const rest = l.slice(who.name.length + d.sep.length);
    if (rest.startsWith('said, "')) continue;
    const v = parseVerb(rest);
    if (v === null) continue;
    if (v === 'bad') return malformed(id);
    if ('post' in v) {
      if (v.post === 'ante') ante = Math.max(ante, v.amount);
      else if (v.post === 'sb' && sbSeat === null && who.idx >= 0) sbSeat = who.idx;
      else if (v.post === 'bb' && bbSeat === null && who.idx >= 0) bbSeat = who.idx;
      continue;
    }
    if (who.idx < 0) {
      if (v.kind === 'fold') continue;
      return malformed(id);
    }
    if (inShowdown) continue;
    if (street === null) return malformed(id);
    actions.push({ street, seat: who.idx, kind: v.kind, amount: v.amount, allIn: v.allIn });
  }

  if (!sawSummary) return { skip: 'partial', id };
  if (hero === null || heroCards === null) return { skip: 'no-hero-cards', id };
  if (new Set([...heroCards, ...board]).size !== heroCards.length + board.length) return malformed(id);
  const folded = new Set(actions.filter((a) => a.kind === 'fold').map((a) => a.seat));
  const heroIdx = hero;
  const hand: ParsedHand = {
    site: d.site,
    id: head.id,
    game: head.game,
    playedAt: head.playedAt,
    maxSeats,
    button,
    sb: head.sb,
    bb: head.bb,
    ante,
    seats: live.map((s, k) => ({ seatNo: s.seatNo, stack: s.stack, isHero: k === heroIdx })),
    hero: heroIdx,
    heroCards: [heroCards[0], heroCards[1]],
    actions,
    sbSeat,
    bbSeat,
    board,
    showdown: sawShowdown && !folded.has(heroIdx) && live.length - folded.size >= 2,
  };
  // The last word: anything the grammar let through that a consumer could not trust is still dropped.
  return isParsedHand(hand) ? hand : malformed(id);
}
