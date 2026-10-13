/**
 * The closed vocabularies Dee chat answers from: concepts, features, rules, hand categories, and the typed slot
 * kinds. Everything here is authored or comes from the lesson catalogue; nothing comes from the learner.
 *
 * The slot kinds are the trust boundary for the optional model. Main re-renders an answer from its template id
 * and slots before any rewording, and `slotValueOk` accepts a value only if it matches its kind: a number in
 * its format, or a member of one of these closed lists. A learner's own text can never pass as a slot value
 * (unless it is, character for character, catalogue text), so no free text reaches the model.
 */

import { CATEGORY_NAMES, HandCategory } from '../../evaluate.js';
import { LESSONS, lessonById } from '../../lessons/index.js';

export interface Concept {
  readonly id: string;
  /** How Dee names it in an answer. */
  readonly term: string;
  /** Matched against the normalised question, whole words. */
  readonly aliases: readonly string[];
  /** Dee's own one-line definition. When absent the lesson's mechanism sentence is the definition. */
  readonly definition?: string;
  /** The lesson that teaches it, if one does. */
  readonly lessonId?: string;
}

/**
 * The glossary. Definitions are short, task-as-subject, and carry no number of their own: a lesson's mechanism
 * may (it is catalogue text, quoted as written).
 */
export const CONCEPTS: readonly Concept[] = [
  { id: 'pot-odds', term: 'Pot odds', aliases: ['pot odds', 'the price', 'price of a call', 'price'], lessonId: 'pot-odds-as-a-price' },
  { id: 'pot-share', term: 'Pot share', aliases: ['pot share', 'equity', 'share of the pot'],
    definition: 'the part of the pot a hand takes on average from here, counting ties as half. A call is priced right when the pot share is at least the price.' },
  { id: 'range', term: 'A range', aliases: ['range', 'ranges', 'hand range'],
    definition: 'every hand a seat could hold here, given how it has played. Reading a range means counting those hands, not guessing one.',
    lessonId: 'range-role-bettor-or-caller' },
  { id: 'outs', term: 'Outs', aliases: ['outs', 'an out', 'counting outs'],
    definition: 'the unseen cards that turn a hand into the best one. Counted against every unseen card, they become a frequency.',
    lessonId: 'counting-outs-as-a-frequency' },
  { id: 'mdf', term: 'Minimum defence frequency', aliases: ['mdf', 'minimum defence frequency', 'minimum defense frequency', 'defence frequency', 'defense frequency'], lessonId: 'minimum-defence-frequency' },
  { id: 'alpha', term: 'Alpha', aliases: ['alpha', 'bluff price', 'break even fold', 'break-even fold'], lessonId: 'alpha-the-bluff-price' },
  { id: 'spr', term: 'SPR', aliases: ['spr', 'stack to pot', 'stack-to-pot', 'stack to pot ratio'], lessonId: 'spr-sets-the-plan' },
  { id: 'combos', term: 'Combos', aliases: ['combos', 'combo', 'combinations', 'combination'], lessonId: 'combos-not-hands' },
  { id: 'polarity', term: 'Polarity', aliases: ['polarity', 'polarised', 'polarized', 'polar'], lessonId: 'polarity-picks-the-size' },
  { id: 'domination', term: 'Domination', aliases: ['domination', 'dominated', 'dead hand', 'dead hands'], lessonId: 'domination-and-dead-hands' },
  { id: 'realisation', term: 'Equity realisation', aliases: ['equity realisation', 'equity realization', 'realisation', 'realization'], lessonId: 'equity-realisation' },
  { id: 'range-advantage', term: 'Range advantage', aliases: ['range advantage', 'nut advantage'], lessonId: 'range-advantage-versus-nut-advantage' },
  { id: 'nuts', term: 'The nuts', aliases: ['nuts', 'the nuts', 'nut hand'], lessonId: 'who-holds-the-nuts' },
  { id: 'texture', term: 'Board texture', aliases: ['board texture', 'texture', 'wet board', 'dry board'], lessonId: 'board-texture-dimensions' },
  { id: 'position', term: 'Position', aliases: ['position', 'in position', 'out of position'], lessonId: 'betting-order-and-position' },
  { id: 'three-bet', term: 'A 3-bet', aliases: ['3-bet', '3bet', 'three bet', 'three-bet', 're-raise', 'reraise'], lessonId: 'facing-a-3bet' },
  { id: 'kicker', term: 'A kicker', aliases: ['kicker', 'kickers'],
    definition: 'a card in the best five that is not part of the made hand. When two hands make the same pair, the higher kicker decides.' },
  { id: 'blinds', term: 'The blinds', aliases: ['blinds', 'blind', 'big blind', 'small blind'],
    definition: 'the forced bets that start each pot, posted by the seats left of the button. The big blind is also the unit every bb figure counts in.' },
  { id: 'button', term: 'The button', aliases: ['button', 'dealer button', 'the dealer'],
    definition: 'the disc that marks the dealer seat. It moves one seat left each hand, and after the flop it acts last.' },
  { id: 'bluff', term: 'A bluff', aliases: ['bluff', 'bluffs', 'bluffing'],
    definition: 'a bet with a hand that rarely gets called by worse. It earns when the folds it gets are worth more than the price of the bet.',
    lessonId: 'alpha-the-bluff-price' },
  { id: 'value-bet', term: 'A value bet', aliases: ['value bet', 'value betting', 'betting for value', 'value'],
    definition: 'a bet that worse hands call often enough to pay for it. The question it asks is which worse hands call.' },
  { id: 'c-bet', term: 'A c-bet', aliases: ['c-bet', 'cbet', 'continuation bet'],
    definition: 'a bet on the flop by the seat that raised before it. Whether it earns depends on whose range the flop favours.' },
  { id: 'check', term: 'A check', aliases: ['a check', 'check'],
    definition: 'a pass that puts no chips in. It is open only when nobody has bet on this street.' },
  { id: 'check-raise', term: 'A check-raise', aliases: ['check-raise', 'check raise', 'checkraise'],
    definition: 'a check, then a raise after another seat bets. It is how the seat acting first builds a pot with a strong range.' },
  { id: 'showdown', term: 'Showdown', aliases: ['showdown'],
    definition: 'the end of a hand that reached the river with two or more seats left. The best five cards take the pot.' },
  { id: 'all-in', term: 'All-in', aliases: ['all-in', 'all in', 'allin', 'shove', 'jam'],
    definition: 'a bet of every chip a seat has left. A seat all-in can only contest what it matched; the rest goes to a side pot.' },
  { id: 'ev', term: 'EV', aliases: ['ev', 'expected value', 'bb lost', 'ev loss'],
    definition: 'the average result of a decision over many repeats. The coach counts a mistake as the EV given up, in big blinds.' },
  { id: 'fold-equity', term: 'Fold equity', aliases: ['fold equity'],
    definition: 'the part of a bet’s value that comes from the folds it gets. It is why a bet can be right with a hand that is behind.' },
  { id: 'flush', term: 'A flush', aliases: ['flush', 'a flush'],
    definition: 'five cards of one suit, in any order. It ranks above a straight and below a full house.' },
  { id: 'straight', term: 'A straight', aliases: ['straight', 'a straight'],
    definition: 'five cards of consecutive rank in any suits. The ace plays high or low, never round the corner.' },
  { id: 'straight-flush', term: 'A straight flush', aliases: ['straight flush', 'royal flush', 'royal'],
    definition: 'five cards in a row, all of one suit. It is the top of the ladder; the ace-high one is the royal flush.' },
  { id: 'quads', term: 'Four of a kind', aliases: ['four of a kind', 'quads'],
    definition: 'all four cards of one rank. Only a straight flush beats it.' },
  { id: 'full-house', term: 'A full house', aliases: ['full house', 'boat'],
    definition: 'three cards of one rank with a pair of another. The three cards decide between full houses first.' },
  { id: 'set', term: 'A set', aliases: ['a set', 'set'],
    definition: 'three of a kind made with a pocket pair and one matching board card. Trips is the same rank made with one hole card.' },
];

export function conceptById(id: string): Concept | undefined {
  return CONCEPTS.find((c) => c.id === id);
}

/** A concept's definition as said: Dee's own line, or the lesson's mechanism quoted. */
export function definitionOf(c: Concept): string {
  if (c.definition !== undefined) return c.definition;
  const lesson = c.lessonId === undefined ? undefined : lessonById(c.lessonId);
  return lesson?.mechanism ?? '';
}

/** How the app works. Each id has one authored answer in the chat bank (`feature-<id>`). */
export const FEATURES: readonly { readonly id: string; readonly aliases: readonly string[] }[] = [
  { id: 'phrasing', aliases: ['smarter phrasing', 'phrasing', 'local model', 'language model', 'the model', 'download', 'llm', 'ai model'] },
  { id: 'price-held', aliases: ['price held'] },
  { id: 'streak', aliases: ['streak', 'streaks', 'daily'] },
  { id: 'sure-guess', aliases: ['sure or guess', 'sure and guess', 'sure', 'guess', 'confidence'] },
  { id: 'gate', aliases: ['the gate', 'gate', 'one line', 'explain before'] },
  { id: 'coach', aliases: ['coach mode', 'coached mode', 'the coach', 'coach', 'verdict', 'verdicts', 'severity', 'serious', 'notable'] },
  { id: 'quiet', aliases: ['turn you off', 'turn dee off', 'turn off dee', 'mute', 'quiet', 'be quiet', 'stop talking', 'tone', 'character', 'talk less', 'hide dee', 'hide you'] },
  { id: 'chips', aliases: ['chips', 'bankroll', 'rebuy', 'buy in', 'buy-in', 'bank'] },
  { id: 'privacy', aliases: ['internet', 'online', 'network', 'privacy', 'private', 'data', 'offline', 'send my', 'upload'] },
  { id: 'lessons', aliases: ['lessons', 'lesson', 'learn tab', 'train', 'drills', 'drill'] },
  { id: 'review', aliases: ['review', 'replay', 'hand history', 'past hands', 'kept hand'] },
  { id: 'about-dee', aliases: ['who are you', 'what are you', 'your name', 'are you human', 'are you real', 'are you alive', 'are you an ai', 'are you a bot', 'about dee', 'who is dee', 'what is dee'] },
  { id: 'scope', aliases: ['what can you do', 'what can i ask', 'what do you know', 'help', 'how does this chat', 'how do you work'] },
];

/** Rules questions Dee answers from the engine's own rules. */
export const RULES: readonly { readonly id: string; readonly aliases: readonly string[] }[] = [
  { id: 'ladder', aliases: ['hand rankings', 'hand ranking', 'rankings', 'ranking', 'order of hands', 'hand order', 'best hand', 'strongest hand', 'what beats what'] },
  { id: 'order', aliases: ['who acts first', 'acts first', 'goes first', 'act first', 'betting order', 'order of betting', 'who acts last', 'acts last'] },
  { id: 'best-five', aliases: ['best five', 'five cards', 'seven cards', 'how many cards', 'use my cards', 'play the board', 'hole cards'] },
  { id: 'split', aliases: ['split pot', 'split the pot', 'tie', 'ties', 'chop', 'chopped'] },
  { id: 'side-pot', aliases: ['side pot', 'side pots', 'main pot'] },
  { id: 'min-raise', aliases: ['min raise', 'min-raise', 'minimum raise', 'how much can i raise', 'smallest raise', 'raise size'] },
  { id: 'check', aliases: ['can i check', 'when can i check', 'allowed to check', 'checking'] },
  { id: 'blinds-move', aliases: ['how do blinds work', 'blinds work', 'who posts', 'post the blind'] },
];

/** Hand categories, best last (the evaluator's order), with the names a question may use. */
export const CATEGORY_WORDS: readonly { readonly category: HandCategory; readonly aliases: readonly string[] }[] = [
  { category: HandCategory.HighCard, aliases: ['high card', 'nothing', 'ace high'] },
  { category: HandCategory.Pair, aliases: ['one pair', 'a pair', 'pair'] },
  { category: HandCategory.TwoPair, aliases: ['two pair', 'two pairs', '2 pair'] },
  { category: HandCategory.Trips, aliases: ['three of a kind', 'trips', 'a set', 'set'] },
  { category: HandCategory.Straight, aliases: ['straight', 'a straight'] },
  { category: HandCategory.Flush, aliases: ['flush', 'a flush'] },
  { category: HandCategory.FullHouse, aliases: ['full house', 'boat', 'full boat'] },
  { category: HandCategory.Quads, aliases: ['four of a kind', 'quads'] },
  { category: HandCategory.StraightFlush, aliases: ['straight flush', 'royal flush', 'royal'] },
];

/** A category as said in prose: the evaluator's name, with the words a reader expects. */
export function categoryWord(c: HandCategory): string {
  const spoken: Partial<Record<HandCategory, string>> = {
    [HandCategory.HighCard]: 'high card',
    [HandCategory.Pair]: 'a pair',
    [HandCategory.TwoPair]: 'two pair',
    [HandCategory.Trips]: 'three of a kind',
    [HandCategory.Straight]: 'a straight',
    [HandCategory.Flush]: 'a flush',
    [HandCategory.FullHouse]: 'a full house',
    [HandCategory.Quads]: 'four of a kind',
    [HandCategory.StraightFlush]: 'a straight flush',
  };
  return spoken[c] ?? CATEGORY_NAMES[c].toLowerCase();
}

/** The ladder, best first, as one phrase. */
export function ladderPhrase(): string {
  const all = CATEGORY_WORDS.map((c) => c.category).sort((a, b) => b - a);
  return all.map((c) => categoryWord(c).replace(/^an? /, '')).join(', ');
}

// ── slot kinds: the typed boundary main checks before any rewording ─────────────────────────────────────

const STREETS = ['preflop', 'flop', 'turn', 'river'];
const ACTED = ['folded', 'called', 'checked', 'bet', 'raised', 'went all-in'];
const PRINCIPLES = ['pot odds', 'value or bluff', 'ranges'];

const closed = (values: readonly string[]): ((v: string) => boolean) => {
  const set = new Set(values);
  return (v) => set.has(v);
};
const capitalised = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export const SLOT_KINDS = {
  pct: (v: string) => /^\d{1,3}%$/.test(v),
  chips: (v: string) => /^\d{1,7}$/.test(v),
  bb: (v: string) => /^\d{1,4}\.\d$/.test(v),
  freq: (v: string) => /^about \d{1,2} times? in \d{1,2}$/.test(v) || v === 'never' || v === 'always',
  street: closed(STREETS),
  acted: closed(ACTED),
  principle: closed(PRINCIPLES),
  term: closed(CONCEPTS.flatMap((c) => [c.term, capitalised(c.term)])),
  definition: closed(CONCEPTS.map(definitionOf)),
  lesson: closed(LESSONS.map((l) => l.title)),
  category: closed(CATEGORY_WORDS.flatMap((c) => [categoryWord(c.category), capitalised(categoryWord(c.category))])),
  ladder: closed([ladderPhrase()]),
  /** Engine prose with no typed shape (the recommender's action and reason). A template using it never rewords. */
  prose: (_v: string) => false,
} as const;

export type SlotKind = keyof typeof SLOT_KINDS;

/** Which kind each chat slot is. A template may use only these names (the chat bank lint checks). */
export const CHAT_SLOTS: Readonly<Record<string, SlotKind>> = {
  street: 'street',
  acted: 'acted',
  principle: 'principle',
  toCall: 'chips',
  pot: 'chips',
  potAfter: 'chips',
  bet: 'chips',
  reqPct: 'pct',
  sharePct: 'pct',
  evLossBb: 'bb',
  silenceBb: 'bb',
  freq: 'freq',
  term: 'term',
  definition: 'definition',
  lesson: 'lesson',
  better: 'category',
  worse: 'category',
  category: 'category',
  ladder: 'ladder',
  studyAction: 'prose',
  studyReason: 'prose',
};

/** Whether a slot value is of its declared kind. Unknown slot names are never ok. */
export function slotValueOk(name: string, value: string): boolean {
  const kind = CHAT_SLOTS[name];
  return kind !== undefined && SLOT_KINDS[kind](value);
}
