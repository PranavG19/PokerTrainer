/**
 * The Long Orbit's words: each chapter's lesson-dialogue beat and Dee's story lines (owner D1, D12: authored
 * once, here). The same rules as Dee's bank (src/core/dee/bank.ts):
 *
 * - **Dee phrases; the engine owns every number.** A number is a slot. The dialogue beats take theirs from the
 *   lesson example the venue names (dee/dialogue.ts `exampleFacts`); the story lines take theirs from the
 *   chapter's own counts (campaign.ts `debriefFacts`) or the dossier (dossier.ts `takeFacts`).
 * - Never "you are", never praise attached to a correction, never luck, chips won, people compared, guilt
 *   about absence, or an archetype id. The rivals' own lines (cast.ts) comment only on their own style.
 *
 * tests/unit/story-lines.test.ts lints every template: the tutor guard (checkTutorOutput) once filled, Dee's
 * ban list, word budgets, no numeral or number word in a template, slots from the vocabulary, the STRICT
 * polarity and slot-order checks on tone variants, and every beat running on its lesson example.
 */

import type { DialogueScript } from '../dee/dialogue.js';
import type { DeePose } from '../dee/types.js';
import type { ChapterId } from './cast.js';

/** A non-slot answer a beat may offer (the bank lint allows only these words as option labels). */
export const WORD_ANSWERS = ['Rarely', 'Often', 'More', 'Fewer', 'Call', 'Raise', 'Standard', 'Special'] as const;

const priceBacks = {
  fold: 'That is the fold a bluff needs. What does the call risk, out of the pot after it?',
  defend: 'That is the share of a range that defends. What does this one call need?',
};

export const CHAPTER_SCRIPTS: Readonly<Record<ChapterId, DialogueScript>> = {
  lighthouse: {
    lessonId: 'pot-odds-as-a-price',
    steps: [
      {
        id: 'pot-after',
        ask: 'The keeper bets {toCall} into {oldPot}. After a call, what does the pot hold?',
        options: [
          { id: 'after', label: '{potAfterCall}', correct: true },
          { id: 'with-bet', label: '{pot}', correct: false, back: 'That counts the bet but not the call. What is there after the call goes in?' },
          { id: 'before', label: '{oldPot}', correct: false, back: 'That is before the bet landed. What is there after the bet and the call?' },
        ],
        right: '{potAfterCall}. The call puts {toCall} of it in.',
      },
      {
        id: 'price',
        ask: 'So what share of that pot must the call take back to break even?',
        options: [
          { id: 'price', label: '{callPrice}', correct: true },
          { id: 'fold', label: '{betFoldShare}', correct: false, back: priceBacks.fold },
          { id: 'defend', label: '{defendShare}', correct: false, back: priceBacks.defend },
        ],
        right: '{callPrice}. That is the price.',
      },
      {
        id: 'lamp',
        ask: 'The lamp lights only for a real ship. Against those hands, does a middling pair hold up that often?',
        options: [
          { id: 'rarely', label: 'Rarely', correct: true },
          { id: 'often', label: 'Often', correct: false, back: 'When every bet is a strong hand, what does a middling pair beat?' },
        ],
        right: 'Rarely. The price is fair; the range is not. Let it go, and steal when the lamp is dark.',
      },
    ],
  },
  diner: {
    lessonId: 'what-the-actions-mean',
    steps: [
      {
        id: 'bluff-price',
        ask: 'A bluff of {toCall} into {oldPot}. How often must it get a fold to break even?',
        options: [
          { id: 'alpha', label: '{betFoldShare}', correct: true },
          { id: 'price', label: '{callPrice}', correct: false, back: 'That prices a call. What does the bluff risk, against the pot after it lands?' },
          { id: 'defend', label: '{defendShare}', correct: false, back: 'That is the share that keeps going. What fold does the bluff itself need?' },
        ],
        right: '{betFoldShare}. A bluff needs that many folds just to break even.',
      },
      {
        id: 'tolls',
        ask: 'The toll keeper pays nearly every toll. Does a bluff get folds that often?',
        options: [
          { id: 'rarely', label: 'Rarely', correct: true },
          { id: 'often', label: 'Often', correct: false, back: 'When almost every bet gets called, where do the folds come from?' },
        ],
        right: 'Rarely. So the bet here is for value: bet the hands that beat what pays.',
      },
    ],
  },
  library: {
    lessonId: 'minimum-defence-frequency',
    steps: [
      {
        id: 'bet-price',
        ask: 'A bet of {toCall} into {oldPot}. How often must it get a fold to break even?',
        options: [
          { id: 'alpha', label: '{betFoldShare}', correct: true },
          { id: 'defend', label: '{defendShare}', correct: false, back: 'That is the share that must keep going. What fold does the bet itself need?' },
          { id: 'price', label: '{callPrice}', correct: false, back: 'That prices a call. What does the bet risk, against the pot after it?' },
        ],
        right: '{betFoldShare}. Any more folds than that, and the bet profits by itself.',
      },
      {
        id: 'hush',
        ask: 'The librarian folds to most raised voices. More folds than {betFoldShare}, or fewer?',
        options: [
          { id: 'more', label: 'More', correct: true },
          { id: 'fewer', label: 'Fewer', correct: false, back: 'When a bet clears the reading room, what share of hands stays?' },
        ],
        right: 'More. So a bet here profits on the spot, even with nothing behind it.',
      },
    ],
  },
  'night-train': {
    lessonId: 'minimum-defence-frequency',
    steps: [
      {
        id: 'price',
        ask: 'The conductor bets {toCall} into {oldPot}. What price does a call get?',
        options: [
          { id: 'price', label: '{callPrice}', correct: true },
          { id: 'fold', label: '{betFoldShare}', correct: false, back: 'That is the fold her bluff needs. What does the call risk, out of the pot after it?' },
        ],
        right: '{callPrice}. The call needs that share of the pot after it.',
      },
      {
        id: 'defend',
        ask: 'To stop her bluffs paying for themselves, what share of hands must keep going?',
        options: [
          { id: 'mdf', label: '{defendShare}', correct: true },
          { id: 'price', label: '{callPrice}', correct: false, back: 'That prices a single call. Is this question about one hand, or the whole range?' },
        ],
        right: '{defendShare}. Fold more than that, and every barrel she fires pays its own fare.',
      },
    ],
  },
  pier: {
    lessonId: 'equity-realisation',
    steps: [
      {
        id: 'price',
        ask: 'The pyrotechnician fires {toCall} into {oldPot}. What share of the pot must a call take?',
        options: [
          { id: 'price', label: '{callPrice}', correct: true },
          { id: 'fold', label: '{betFoldShare}', correct: false, back: 'That is the fold her bluff needs. What does the call risk, against the pot after it?' },
          { id: 'defend', label: '{defendShare}', correct: false, back: priceBacks.defend },
        ],
        right: '{callPrice}. Against her range, plenty of hands clear that.',
      },
      {
        id: 'trap',
        ask: 'She bets nearly everything. With a strong hand, call and let her fire, or raise?',
        options: [
          { id: 'call', label: 'Call', correct: true },
          { id: 'raise', label: 'Raise', correct: false, back: 'Raised, what happens to all the hands she was bluffing with?' },
        ],
        right: 'Call. Her bluffs keep coming, and a raise only folds them away.',
      },
    ],
  },
  observatory: {
    lessonId: 'pot-odds-as-a-price',
    steps: [
      {
        id: 'price',
        ask: 'The metronome bets {toCall} into {oldPot}. What price does a call get?',
        options: [
          { id: 'price', label: '{callPrice}', correct: true },
          { id: 'fold', label: '{betFoldShare}', correct: false, back: priceBacks.fold },
          { id: 'defend', label: '{defendShare}', correct: false, back: priceBacks.defend },
        ],
        right: '{callPrice}. A small bet, a small price.',
      },
      {
        id: 'line',
        ask: 'Nothing about her play leans anywhere. The standard line, or a special one?',
        options: [
          { id: 'standard', label: 'Standard', correct: true },
          { id: 'special', label: 'Special', correct: false, back: 'A special line exploits a leak. Which leak has she shown?' },
        ],
        right: 'Standard. Nothing to chase here, so the price decides alone.',
      },
    ],
  },
};

/** Slots a story line may use. Each is filled by the engine from a count or a name, never authored. */
export const STORY_SLOTS = ['rival', 'focus', 'judged', 'free', 'bigBets', 'bluffs', 'calls', 'thin', 'bets', 'strong'] as const;
export type StorySlot = (typeof STORY_SLOTS)[number];
export type StoryFacts = Partial<Record<StorySlot, string>>;

export type StoryEvent =
  | 'intro'
  | 'intro-personal'
  | 'debrief-met'
  | 'debrief-met-again'
  | 'debrief-short'
  | 'debrief-unjudged'
  | 'take-bluffs-high'
  | 'take-bluffs-low'
  | 'take-thin-high'
  | 'take-thin-low'
  | 'take-strong-high'
  | 'take-strong-low'
  | 'take-baseline'
  | 'take-none';

/** Word budget per surface: the intro and debrief sit beside Dee at 40px, the take is one line in a file. */
export const STORY_WORD_BUDGET: Readonly<Record<StoryEvent, number>> = {
  intro: 22,
  'intro-personal': 22,
  'debrief-met': 22,
  'debrief-met-again': 22,
  'debrief-short': 22,
  'debrief-unjudged': 22,
  'take-bluffs-high': 22,
  'take-bluffs-low': 22,
  'take-thin-high': 22,
  'take-thin-low': 22,
  'take-strong-high': 22,
  'take-strong-low': 22,
  'take-baseline': 22,
  'take-none': 22,
};

export interface StoryLine {
  readonly id: string;
  readonly event: StoryEvent;
  /** Intro lines belong to one venue; every other line is shared. */
  readonly venue?: ChapterId;
  readonly pose: DeePose;
  readonly text: string;
  readonly dry?: string;
  readonly blunt?: string;
}

const intro = (venue: ChapterId, id: string, text: string, extra: Partial<StoryLine> = {}): StoryLine => ({
  id: `story.intro.${venue}.${id}`,
  event: 'intro',
  venue,
  pose: 'listening',
  text,
  ...extra,
});

export const STORY_LINES: readonly StoryLine[] = [
  intro('lighthouse', 'a', 'The Lighthouse. {rival} keeps the lamp, and it is lit only for a real ship.', {
    dry: 'The Lighthouse. {rival} lights the lamp only for a real ship.',
    blunt: 'The Lighthouse. {rival} only lights the lamp for a real ship.',
  }),
  intro('lighthouse', 'b', 'From this seat the lamp looks steady. When it lights, the price buys very little.'),
  intro('diner', 'a', 'The Toll Road Diner. {rival} pays every toll to see what is down the road.', {
    dry: 'The Diner. {rival} pays every toll, to see what is down the road.',
  }),
  intro('diner', 'b', 'Here the bet is for value. A bluff at this counter buys nothing.'),
  intro('library', 'a', 'The Library. {rival} folds when the room gets loud, and it gets loud a lot.'),
  intro('library', 'b', 'Quiet hands still take pots here, if a bet asks the question.'),
  intro('night-train', 'a', 'The Night Train. {rival} never stops it: a bet, then another, then another.'),
  intro('night-train', 'b', 'Price first, then stay aboard. Folding every barrel pays the whole fare.'),
  intro('pier', 'a', 'The Fireworks Pier. {rival} lights everything together. Weather, not a role model.'),
  intro('pier', 'b', 'Strong hands call here, and let the rockets keep coming.'),
  intro('observatory', 'a', 'The Observatory. {rival} plays the standard line, and there is nothing to chase.'),
  intro('observatory', 'b', 'The last room of the orbit. I talk least here; the price decides alone.'),

  { id: 'story.personal.a', event: 'intro-personal', pose: 'listening', text: 'This room is about {focus}. The table here leans on exactly that.' },
  { id: 'story.personal.b', event: 'intro-personal', pose: 'listening', text: 'Built around {focus}. Same price as anywhere, and a regular who presses on it.' },

  { id: 'story.met.a', event: 'debrief-met', pose: 'listening', text: '{free} of {judged} decisions cost nothing. The mask comes off: {rival}.',
    dry: '{free} of {judged} cost nothing. Mask off: {rival}.',
    blunt: '{free} of {judged} cost nothing. Mask off. {rival}.' },
  { id: 'story.met.b', event: 'debrief-met', pose: 'listening', text: 'Noted: {free} of {judged} decisions cost nothing. That earns a name, and it is {rival}.' },
  { id: 'story.met-again.a', event: 'debrief-met-again', pose: 'rest', text: '{free} of {judged} decisions cost nothing. Same file, more in it.' },
  { id: 'story.short.a', event: 'debrief-short', pose: 'gate', text: '{free} of {judged} decisions cost nothing. The goal asks for more, and the table stays open.',
    dry: '{free} of {judged} cost nothing. The goal asks for more; the table stays open.',
    blunt: '{free} of {judged} cost nothing. The goal asks for more. Table stays open.' },
  { id: 'story.short.b', event: 'debrief-short', pose: 'thinking', text: 'A few decisions here cost something. {free} of {judged} cost nothing. Another table whenever.' },
  { id: 'story.unjudged.a', event: 'debrief-unjudged', pose: 'thinking', text: 'Too few priced spots to judge this table. It deals again whenever.' },

  { id: 'story.take.bluffs-high', event: 'take-bluffs-high', pose: 'thinking', text: '{bluffs} of {bigBets} big bets shown were bluffs. Hold that against the price before letting a hand go.' },
  { id: 'story.take.bluffs-low', event: 'take-bluffs-low', pose: 'rest', text: '{bluffs} of {bigBets} big bets shown were bluffs. When this regular bets big, it means it.' },
  { id: 'story.take.thin-high', event: 'take-thin-high', pose: 'thinking', text: '{thin} of {calls} calls shown held a pair or less. Bet the hands that beat that, and skip the bluffs.' },
  { id: 'story.take.thin-low', event: 'take-thin-low', pose: 'rest', text: '{thin} of {calls} calls shown held a pair or less. A call here usually means a hand.' },
  { id: 'story.take.strong-high', event: 'take-strong-high', pose: 'rest', text: '{strong} of {bets} bets shown held better than one pair. The bet means strength.' },
  { id: 'story.take.strong-low', event: 'take-strong-low', pose: 'thinking', text: '{strong} of {bets} bets shown held better than one pair. The bets run light.' },
  { id: 'story.take.baseline', event: 'take-baseline', pose: 'rest', text: 'Nothing unusual shown so far. The standard line is the read.' },
  { id: 'story.take.none', event: 'take-none', pose: 'asleep', text: 'Nothing earned yet. Only showdowns count in this file; the rest is guessing.' },
];
