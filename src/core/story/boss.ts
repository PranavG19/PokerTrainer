/**
 * Boss hands: one fixed hand per room, whose right line is that rival's exploit (VISION §2.5, BUILD-PLAN 2.1). The
 * Kitchen Table has one too, its first hand, with the price as the whole lesson.
 *
 * - **The engine plays it.** A boss hand is a fixed deal (puzzle.ts `buildScenarioTable`) and one line of moves in
 *   engine order. The moves before and between the asked decisions are played for the learner; at an ask the
 *   learner picks one of the actions the engine offers there. Every number on screen is the engine's: the asks are
 *   templates over the decision's own pot and price (dee/dialogue.ts `exampleFacts`, the lesson slots).
 * - **Cards only at a showdown.** The rival's cards turn over only when the hand reaches one (`reachedShowdown`).
 * - **Judged on the decision, never the chips.** A wrong answer gets a question back and the hand waits (as the
 *   lesson beat does); the hand is clean when every ask was answered right at the first try. A clean hand earns the
 *   room's keepsake (keepsakes.ts). Who won the pot appears nowhere, and the Observatory's hand is lost at showdown
 *   on purpose: the right call still loses sometimes.
 * - **Nothing is locked (N1).** A boss hand opens whenever the learner picks it, and replays as often as they like.
 *
 * Pure: state in, new state out.
 */

import type { Card } from '../cards.js';
import { exampleFacts, type LessonFacts } from '../dee/dialogue.js';
import { renderLine } from '../dee/engine.js';
import type { Facts } from '../dee/types.js';
import type { DayKey } from '../localDay.js';
import { buildScenarioTable, type Scenario } from '../puzzle.js';
import type { BossRecord, StoryState } from '../progression/types.js';
import { applyAction, isHandOver, legalActions, type ActionKind, type Street, type TableState } from '../table.js';
import type { ChapterId, StoryRoomId } from './cast.js';

/** One decision the learner makes. Its words are templates over the decision's lesson slots. */
export interface BossAsk {
  readonly id: string;
  readonly correct: ActionKind;
  /** For a bet or raise: the total the bet goes to, in chips (the engine's unit; never said in words). */
  readonly to?: number;
  readonly ask: string;
  readonly right: string;
  /** A question back for every other action the engine offers at this decision. */
  readonly back: Partial<Record<ActionKind, string>>;
}

export type BossMove =
  | { readonly who: 'rival' | 'hero'; readonly kind: ActionKind; readonly to?: number }
  | { readonly who: 'ask'; readonly ask: BossAsk };

export interface BossHand {
  /** `boss-${room}`. Persisted in `story.bosses`. */
  readonly id: string;
  readonly room: typeof KITCHEN_ROOM | ChapterId;
  readonly title: string;
  /** Before the hand: where it is, never the answer. No numbers. */
  readonly setup: string;
  /** Dee, after the hand, once the rival's cards are turned over. */
  readonly reveal: string;
  readonly hero: readonly [Card, Card];
  readonly rival: readonly [Card, Card];
  readonly board: readonly [Card, Card, Card, Card, Card];
  /** The hero on the button (acts first before the flop, last after it), else in the big blind. */
  readonly heroOnButton: boolean;
  readonly moves: readonly BossMove[];
}

const KITCHEN_ROOM = 'kitchen' as const;

const raiseBack = 'Raised, which of the hands that bet here stay in, and which of them go?';

export const BOSS_HANDS: readonly BossHand[] = [
  {
    id: 'boss-kitchen',
    room: 'kitchen',
    title: 'The first hand',
    setup: 'The other seat limps in from the button, and the flop gives a middle pair.',
    reveal: 'High cards and a bet. The price decided, and it decided early.',
    hero: ['8h', '7h'],
    rival: ['Qc', 'Td'],
    board: ['Kd', '8s', '3c', '2h', 'Js'],
    heroOnButton: false,
    moves: [
      { who: 'rival', kind: 'call' },
      { who: 'hero', kind: 'check' },
      { who: 'hero', kind: 'check' },
      { who: 'rival', kind: 'bet', to: 50 },
      {
        who: 'ask',
        ask: {
          id: 'price',
          correct: 'call',
          ask: 'A bet of {toCall} into {oldPot}. The call needs {callPrice}. Fold, call or raise?',
          right: 'Call. A middle pair is ahead here far more often than {callPrice}.',
          back: {
            fold: 'The call needs {callPrice} of the pot. Is a middle pair ahead more often than that?',
            raise: raiseBack,
            allin: raiseBack,
          },
        },
      },
      { who: 'hero', kind: 'check' },
      { who: 'rival', kind: 'check' },
      { who: 'hero', kind: 'check' },
      { who: 'rival', kind: 'check' },
    ],
  },
  {
    id: 'boss-lighthouse',
    room: 'lighthouse',
    title: 'The lamp lights',
    setup: 'The keeper raised, bet the flop and went quiet on the turn. Top pair, a middling kicker.',
    reveal: 'Her cards stay dark, as a folded hand’s do. When this lamp lights, the ship is usually real.',
    hero: ['Qd', 'Ts'],
    rival: ['Ac', 'Qc'],
    board: ['Qh', '8c', '3d', '5s', '2c'],
    heroOnButton: false,
    moves: [
      { who: 'rival', kind: 'raise', to: 150 },
      { who: 'hero', kind: 'call' },
      { who: 'hero', kind: 'check' },
      { who: 'rival', kind: 'bet', to: 150 },
      { who: 'hero', kind: 'call' },
      { who: 'hero', kind: 'check' },
      { who: 'rival', kind: 'check' },
      { who: 'hero', kind: 'check' },
      { who: 'rival', kind: 'bet', to: 450 },
      {
        who: 'ask',
        ask: {
          id: 'river',
          correct: 'fold',
          ask: 'Now the keeper bets {toCall} into {oldPot} on the river. The call needs {callPrice}. Fold, call or raise?',
          right: 'Fold. The price is fair; her range is not. A lit lamp means a real ship.',
          back: {
            call: 'The price is fair. Which hands does she bet this big on a river, and how many does this beat?',
            raise: 'Raised, which of her betting hands fold, and which of them call?',
            allin: 'Raised, which of her betting hands fold, and which of them call?',
          },
        },
      },
    ],
  },
  {
    id: 'boss-diner',
    room: 'diner',
    title: 'The last toll',
    setup: 'The toll keeper calls the raise and the flop bet. Top pair, a weak kicker.',
    reveal: 'A worse pair, paying every toll on the way. Noted.',
    hero: ['Ah', '7d'],
    rival: ['Kc', 'Jd'],
    board: ['Ac', 'Js', '5d', '9h', '3c'],
    heroOnButton: true,
    moves: [
      { who: 'hero', kind: 'raise', to: 150 },
      { who: 'rival', kind: 'call' },
      { who: 'rival', kind: 'check' },
      { who: 'hero', kind: 'bet', to: 150 },
      { who: 'rival', kind: 'call' },
      { who: 'rival', kind: 'check' },
      {
        who: 'ask',
        ask: {
          id: 'turn',
          correct: 'bet',
          to: 300,
          ask: 'He checks the turn, and the pot holds {pot}. He pays nearly every toll. Check or bet?',
          right: 'Bet. He calls with worse pairs, and every one of those calls pays.',
          back: { check: 'Checked back, what does a regular who pays every toll pay here?' },
        },
      },
      { who: 'rival', kind: 'call' },
      { who: 'rival', kind: 'check' },
      {
        who: 'ask',
        ask: {
          id: 'river',
          correct: 'bet',
          to: 600,
          ask: 'A blank on the river, and he checks again. Check or bet?',
          right: 'Bet again. Thin value is the whole lesson at this counter.',
          back: { check: 'Which worse hands still call one more bet from him?' },
        },
      },
      { who: 'rival', kind: 'call' },
    ],
  },
  {
    id: 'boss-library',
    room: 'library',
    title: 'The quiet river',
    setup: 'The librarian calls the raise and a small flop bet, then checks the turn. Nothing made.',
    reveal: 'Set down at the first raised voice, and nothing shown. A bet asked, and it was answered.',
    hero: ['7s', '6s'],
    rival: ['8d', '8c'],
    board: ['Kd', 'Qc', '2h', '9d', '3s'],
    heroOnButton: true,
    moves: [
      { who: 'hero', kind: 'raise', to: 150 },
      { who: 'rival', kind: 'call' },
      { who: 'rival', kind: 'check' },
      { who: 'hero', kind: 'bet', to: 100 },
      { who: 'rival', kind: 'call' },
      { who: 'rival', kind: 'check' },
      { who: 'hero', kind: 'check' },
      { who: 'rival', kind: 'check' },
      {
        who: 'ask',
        ask: {
          id: 'river',
          correct: 'bet',
          to: 350,
          ask: 'Nothing made, and he checks the river with {pot} in the middle. Check or bet?',
          right: 'Bet. He folds more often than the bet needs, so it profits with nothing behind it.',
          back: { check: 'Checked, nothing here holds up at a showdown. What does he do when a bet lands?' },
        },
      },
      { who: 'rival', kind: 'fold' },
    ],
  },
  {
    id: 'boss-night-train',
    room: 'night-train',
    title: 'The third barrel',
    setup: 'The conductor raised and bet the flop, and the call was made. Top pair, a good kicker.',
    reveal: 'High cards and no pair. The train never stops, so the call stays aboard.',
    hero: ['As', 'Jh'],
    rival: ['Qs', 'Ts'],
    board: ['Jc', '7d', '4s', 'Kh', '2d'],
    heroOnButton: false,
    moves: [
      { who: 'rival', kind: 'raise', to: 150 },
      { who: 'hero', kind: 'call' },
      { who: 'hero', kind: 'check' },
      { who: 'rival', kind: 'bet', to: 200 },
      { who: 'hero', kind: 'call' },
      { who: 'hero', kind: 'check' },
      { who: 'rival', kind: 'bet', to: 450 },
      {
        who: 'ask',
        ask: {
          id: 'turn',
          correct: 'call',
          ask: 'The conductor fires again: {toCall} into {oldPot}. The call needs {callPrice}. Fold, call or raise?',
          right: 'Call. Her barrels run wide, and a pair this good beats a lot of them.',
          back: {
            fold: 'Folded here, what does every barrel she fires earn?',
            raise: 'Raised, what happens to all the hands she was barrelling with?',
            allin: 'Raised, what happens to all the hands she was barrelling with?',
          },
        },
      },
      { who: 'hero', kind: 'check' },
      { who: 'rival', kind: 'bet', to: 1100 },
      {
        who: 'ask',
        ask: {
          id: 'river',
          correct: 'call',
          ask: 'And again on the river: {toCall} into {oldPot}. The call needs {callPrice}. Fold, call or raise?',
          right: 'Call. Stay aboard: she bets her misses as hard as her hands.',
          back: {
            fold: 'The call needs {callPrice}. How many of her barrels are made hands?',
            raise: 'Raised, which of her hands call, and which of them fold?',
            allin: 'Raised, which of her hands call, and which of them fold?',
          },
        },
      },
    ],
  },
  {
    id: 'boss-pier',
    room: 'pier',
    title: 'The whole box',
    setup: 'The pyrotechnician raised big before the flop. Top pair, the best kicker.',
    reveal: 'A missed draw, fired again and again. Let the rockets come.',
    hero: ['Ad', 'Kc'],
    rival: ['9s', '7s'],
    board: ['Kh', '8s', '4d', '6c', '2h'],
    heroOnButton: false,
    moves: [
      { who: 'rival', kind: 'raise', to: 200 },
      { who: 'hero', kind: 'call' },
      { who: 'hero', kind: 'check' },
      { who: 'rival', kind: 'bet', to: 400 },
      {
        who: 'ask',
        ask: {
          id: 'flop',
          correct: 'call',
          ask: 'She fires the whole pot: {toCall} into {oldPot}. Fold, call or raise?',
          right: 'Call. Let her keep firing; a raise would only fold the hands she is bluffing with.',
          back: {
            fold: 'The call needs {callPrice}. How often is top pair behind a range that bets everything?',
            raise: 'Raised, what happens to all the hands she was bluffing with?',
            allin: 'Raised, what happens to all the hands she was bluffing with?',
          },
        },
      },
      { who: 'hero', kind: 'check' },
      { who: 'rival', kind: 'bet', to: 1200 },
      {
        who: 'ask',
        ask: {
          id: 'turn',
          correct: 'call',
          ask: 'Again on the turn: {toCall} into {oldPot}. The call needs {callPrice}. Fold, call or raise?',
          right: 'Call. The trap holds: she keeps lighting the fuses herself.',
          back: {
            fold: 'The call needs {callPrice}. What share of her bets are bluffs?',
            raise: 'Raised, which of her hands keep going, and do they beat this?',
            allin: 'Raised, which of her hands keep going, and do they beat this?',
          },
        },
      },
      { who: 'hero', kind: 'check' },
      { who: 'rival', kind: 'check' },
    ],
  },
  {
    id: 'boss-observatory',
    room: 'observatory',
    title: 'The standard line',
    setup: 'The metronome raised and bet the flop small, then checked the turn. Top pair, a good kicker.',
    reveal: 'Her hand was better this time. The call was the price’s, and the price was right.',
    hero: ['Qh', 'Jh'],
    rival: ['Ad', 'Qd'],
    board: ['Qc', '9d', '5s', '3h', '2c'],
    heroOnButton: false,
    moves: [
      { who: 'rival', kind: 'raise', to: 150 },
      { who: 'hero', kind: 'call' },
      { who: 'hero', kind: 'check' },
      { who: 'rival', kind: 'bet', to: 100 },
      { who: 'hero', kind: 'call' },
      { who: 'hero', kind: 'check' },
      { who: 'rival', kind: 'check' },
      { who: 'hero', kind: 'check' },
      { who: 'rival', kind: 'bet', to: 250 },
      {
        who: 'ask',
        ask: {
          id: 'river',
          correct: 'call',
          ask: 'A small river bet: {toCall} into {oldPot}. The call needs {callPrice}. Fold, call or raise?',
          right: 'Call. Nothing she has shown asks for a special line, so the price decides alone.',
          back: {
            fold: 'A special fold needs a leak. Which leak has she shown?',
            raise: 'Raised, which of her hands call, and do they beat top pair?',
            allin: 'Raised, which of her hands call, and do they beat top pair?',
          },
        },
      },
    ],
  },
];

export function bossById(id: string): BossHand | undefined {
  return BOSS_HANDS.find((b) => b.id === id);
}

export function bossFor(room: StoryRoomId): BossHand | undefined {
  return BOSS_HANDS.find((b) => b.room === room);
}

/** The fixed deal as a two-seat puzzle scenario; seat 0 is the hero and seat 1 the rival. */
export function scenarioOf(boss: BossHand): Scenario {
  return {
    id: boss.id,
    title: boss.title,
    setup: boss.setup,
    seatCount: 2,
    button: boss.heroOnButton ? 0 : 1,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [boss.hero, boss.rival],
    board: boss.board,
    villainScript: [],
    // puzzle.ts asks for a non-empty target; the asks are this file's, so the line itself is the target.
    target: boss.moves.filter((m) => m.who === 'ask').map((m) => ({ action: (m as { ask: BossAsk }).ask.correct, explanation: '' })),
  };
}

/** One move as played, for the hand so far: who did what on which street, and the chips it put in. */
export interface PlayedMove {
  readonly who: 'rival' | 'hero';
  readonly street: Exclude<Street, 'showdown'>;
  readonly kind: ActionKind;
  /** For a call: the chips called; for a bet or raise: the total it went to; else 0. */
  readonly chips: number;
  readonly potAfter: number;
}

export interface BossReply {
  readonly askId: string;
  readonly right: boolean;
  readonly text: string;
}

export interface BossRun {
  readonly boss: BossHand;
  readonly state: TableState;
  /** Index of the next move in `boss.moves`. */
  readonly at: number;
  readonly played: readonly PlayedMove[];
  /** Wrong answers at the pending ask, so they can be shown as tried. */
  readonly tried: readonly ActionKind[];
  /** Wrong answers over the whole hand: zero is clean. */
  readonly misses: number;
  readonly replies: readonly BossReply[];
  readonly done: boolean;
}

const HERO = 0;
const RIVAL = 1;

/** The engine action for a move: a bet or raise carries its total, anything else none. */
function actionOf(kind: ActionKind, to: number | undefined): { kind: ActionKind; amount?: number } {
  return kind === 'bet' || kind === 'raise' ? { kind, amount: to } : { kind };
}

function play(run: BossRun, who: 'rival' | 'hero', kind: ActionKind, to: number | undefined): BossRun {
  const s = run.state;
  const seat = who === 'hero' ? HERO : RIVAL;
  if (s.toAct !== seat) throw new Error(`${run.boss.id}: move ${run.at} is ${who}'s, but seat ${s.toAct} is to act`);
  if (!legalActions(s).includes(kind)) throw new Error(`${run.boss.id}: move ${run.at} (${who} ${kind}) is not legal here`);
  const street = s.street as PlayedMove['street'];
  const chips = kind === 'call' ? Math.min(s.currentBet - s.seats[seat].committed, s.seats[seat].stack) : kind === 'bet' || kind === 'raise' ? (to ?? 0) : 0;
  const state = applyAction(s, actionOf(kind, to));
  return { ...run, state, played: [...run.played, { who, street, kind, chips, potAfter: state.pot }] };
}

/** Play every move up to the next ask (or the end). */
function advance(run: BossRun): BossRun {
  let r = run;
  while (r.at < r.boss.moves.length) {
    const move = r.boss.moves[r.at];
    if (move.who === 'ask') return r;
    r = { ...play(r, move.who, move.kind, move.to), at: r.at + 1 };
  }
  return { ...r, done: true };
}

export function startBoss(boss: BossHand): BossRun {
  return advance({ boss, state: buildScenarioTable(scenarioOf(boss)), at: 0, played: [], tried: [], misses: 0, replies: [], done: false });
}

/** The decision's own numbers, in the lesson slots: the pot with the bet in it, the call, and the shares. */
export function decisionFacts(state: TableState): LessonFacts {
  const toCall = Math.max(0, state.currentBet - state.seats[HERO].committed);
  return exampleFacts({ pot: state.pot, toCall });
}

export interface PendingAsk {
  readonly ask: BossAsk;
  readonly facts: LessonFacts;
  readonly text: string;
  /** The actions the engine offers here, less two that are never the lesson: all-in beside a bet or raise, and a fold when checking is free. */
  readonly options: readonly { readonly kind: ActionKind; readonly tried: boolean }[];
}

export function optionsAt(state: TableState): ActionKind[] {
  const legal = legalActions(state);
  const aggressive = legal.includes('bet') || legal.includes('raise');
  return legal.filter((k) => (k !== 'allin' || !aggressive) && (k !== 'fold' || !legal.includes('check')));
}

export function pendingAsk(run: BossRun): PendingAsk | null {
  if (run.done) return null;
  const move = run.boss.moves[run.at];
  if (move?.who !== 'ask') return null;
  const facts = decisionFacts(run.state);
  return {
    ask: move.ask,
    facts,
    text: renderLine(move.ask.ask, facts as Facts) ?? move.ask.ask,
    options: optionsAt(run.state).map((kind) => ({ kind, tried: run.tried.includes(kind) })),
  };
}

/** Answer the pending ask. Right: the move is played and the hand runs on. Wrong: a question back, and it waits. */
export function answerBoss(run: BossRun, kind: ActionKind): BossRun {
  const pending = pendingAsk(run);
  if (pending === null || !pending.options.some((o) => o.kind === kind) || run.tried.includes(kind)) return run;
  const { ask, facts } = pending;
  if (kind !== ask.correct) {
    const text = renderLine(ask.back[kind] ?? '', facts as Facts) ?? '';
    return { ...run, tried: [...run.tried, kind], misses: run.misses + 1, replies: [...run.replies, { askId: ask.id, right: false, text }] };
  }
  const text = renderLine(ask.right, facts as Facts) ?? '';
  const played = play(run, 'hero', kind, ask.to);
  return advance({ ...played, at: run.at + 1, tried: [], replies: [...run.replies, { askId: ask.id, right: true, text }] });
}

/** The rival's cards turn over only at a showdown: a hand that ends in a fold shows nothing (as at the table). */
export function reachedShowdown(run: BossRun): boolean {
  return run.done && run.state.seats.every((s) => !s.folded);
}

export function isClean(run: BossRun): boolean {
  return run.done && run.misses === 0;
}

/** True once the engine says the hand is over: the line always plays to its end. */
export function handOver(run: BossRun): boolean {
  return isHandOver(run.state);
}

// ── the record ──────────────────────────────────────────────────────────────────────────────────────

export function bossRecordOf(story: StoryState, id: string): BossRecord {
  return story.bosses[id] ?? { attempts: 0, cleanOn: null };
}

/** A boss hand played to the end: one more attempt, and the first clean day kept (a ratchet). */
export function recordBoss(story: StoryState, id: string, clean: boolean, day: DayKey): StoryState {
  const prev = bossRecordOf(story, id);
  const next: BossRecord = { attempts: prev.attempts + 1, cleanOn: prev.cleanOn ?? (clean ? day : null) };
  return { ...story, bosses: { ...story.bosses, [id]: next } };
}
