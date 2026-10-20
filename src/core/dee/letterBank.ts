/**
 * Dee's letters (VISION pillar 9, You › Letters): the weekly note, in Dee's voice, SCRIPTED. Every sentence is one
 * of these templates and every number in it is a slot the letter engine (src/core/letters.ts) filled from the week's
 * records; nothing is generated (PRODUCT-SPEC: the tutor never authors a number). A line whose slot has no fact is
 * not eligible, so a thin week gets a short letter rather than a sentence with a hole in it.
 *
 * The same lint as the line bank (tests/unit/letter-bank.test.ts): the tutor guard on every filled line, Dee's ban
 * list (no luck, no outcomes, no absence guilt, no traits, no praise, no money), no numeral or number word in a
 * template, slots from the letter vocabulary only, the word budget, and the STRICT polarity and order checks between
 * each tone variant and its canonical line.
 */

/** The slots a letter line may use, each already formatted with its noun ("24 hands", "38%"). */
export const LETTER_SLOTS = [
  'hands',
  'graded',
  'sheet',
  'focus',
  'riverCalls',
  'riverRight',
  'foldRiver',
  'foldRiverWas',
  'assessLoss',
  'assessWas',
  'style',
  'styleWas',
  'handsPct',
  'leadPct',
  'leak',
  'venue',
  'judged',
  'free',
  'shelf',
  'rule',
  'ruleDay',
] as const;
export type LetterSlot = (typeof LETTER_SLOTS)[number];
export type LetterFacts = Partial<Record<LetterSlot, string>>;

/** What a sentence is about. The order here is the order a letter reads in. */
export const LETTER_EVENTS = [
  'open',
  'open-assess',
  'river',
  'style',
  'style-change',
  'fold-move',
  'assessment',
  'assessment-change',
  'sheet',
  'clean',
  'leak',
  'story',
  'shelf',
  'rule-new',
  'ps',
] as const;
export type LetterEvent = (typeof LETTER_EVENTS)[number];

/** The paragraph each event sits in: the week, what moved, what is next. The P.S. is its own. */
export const LETTER_PARAGRAPH: Readonly<Record<LetterEvent, 0 | 1 | 2 | 'ps'>> = {
  open: 0,
  'open-assess': 0,
  river: 0,
  style: 1,
  'style-change': 1,
  'fold-move': 1,
  assessment: 1,
  'assessment-change': 1,
  sheet: 2,
  clean: 2,
  leak: 2,
  story: 2,
  shelf: 2,
  'rule-new': 2,
  ps: 'ps',
};

/** Words per filled line. A letter is longer than a verdict, but each sentence still has to be short. */
export const LETTER_WORD_BUDGET = 32;

export interface LetterLine {
  readonly id: string;
  readonly event: LetterEvent;
  /** The canonical (Warm) line. */
  readonly text: string;
  readonly dry?: string;
  readonly blunt?: string;
}

export const LETTER_BANK: readonly LetterLine[] = [
  // ── the week, counted ──
  { id: 'lt-open-1', event: 'open', text: 'This week the table dealt {hands}, and the coach graded {graded}.',
    dry: 'This week: {hands} dealt, {graded} graded.',
    blunt: '{hands} dealt. {graded} graded.' },
  { id: 'lt-open-2', event: 'open', text: 'I watched {hands} go by this week, with {graded} graded along the way.',
    dry: '{hands} this week, {graded} graded.' },
  { id: 'lt-open-3', event: 'open', text: 'The week came to {hands} and {graded} graded, counted from the seat beside the pot.' },
  { id: 'lt-open-a1', event: 'open-assess', text: 'No table hands this week. The assessment block graded {graded} with the feedback held back.',
    dry: 'No table hands this week. The assessment block graded {graded}.' },
  { id: 'lt-river-1', event: 'river', text: 'Facing a river bet there were {riverCalls}, and the coach marked {riverRight} of them right.',
    dry: 'Facing a river bet: {riverCalls}, {riverRight} marked right.',
    blunt: 'River bets: {riverCalls}. {riverRight} right.' },
  { id: 'lt-river-2', event: 'river', text: 'On the river, {riverCalls} against a bet, and {riverRight} of them cleared the price.' },

  // ── what moved ──
  { id: 'lt-style-1', event: 'style', text: 'The hands read as {style} this week: {handsPct} of hands played, {leadPct} of those raised first.',
    dry: 'The hands read as {style}: {handsPct} played, {leadPct} raised first.' },
  { id: 'lt-style-2', event: 'style', text: 'On the style map the week sits with {style}, from {handsPct} of hands played and {leadPct} raised first.' },
  { id: 'lt-style-c1', event: 'style-change', text: 'The hands read as {style} this week, after {styleWas} the week before. The map has the trail.',
    dry: 'Read as {style} this week, {styleWas} the week before.',
    blunt: '{style} this week. {styleWas} before that.' },
  { id: 'lt-style-c2', event: 'style-change', text: 'A move on the map: {style} this week, where last week read as {styleWas}.' },
  { id: 'lt-fold-1', event: 'fold-move', text: 'Folding to a river bet went from {foldRiverWas} to {foldRiver}. The price decides which side of that is right.',
    dry: 'Fold to a river bet: {foldRiverWas} to {foldRiver}.',
    blunt: 'River folds: {foldRiverWas}, now {foldRiver}.' },
  { id: 'lt-fold-2', event: 'fold-move', text: 'Facing a river bet, the fold went from {foldRiverWas} to {foldRiver} of the time.' },
  { id: 'lt-assess-1', event: 'assessment', text: 'The assessment block cost {assessLoss} this week. Lower is better, and it only counts decisions.',
    dry: 'Assessment cost: {assessLoss}. Lower is better; it only counts decisions.',
    blunt: 'Assessment: {assessLoss}. Lower is better. Decisions only.' },
  { id: 'lt-assess-c1', event: 'assessment-change', text: 'The assessment block cost {assessLoss} this week, against {assessWas} the week before. Lower is better.',
    dry: 'Assessment: {assessLoss}, against {assessWas} before. Lower is better.',
    blunt: 'Assessment: {assessLoss}. Before: {assessWas}. Lower is better.' },

  // ── what is next ──
  { id: 'lt-sheet-1', event: 'sheet', text: '{sheet} went to the sheet, most of the cost on {focus}.',
    dry: '{sheet} to the sheet, most of the cost on {focus}.',
    blunt: '{sheet} to the sheet. Most of the cost: {focus}.' },
  { id: 'lt-sheet-2', event: 'sheet', text: 'The sheet took {sheet} this week. The heaviest part was {focus}.' },
  { id: 'lt-clean-1', event: 'clean', text: 'No graded decision went to the sheet this week. Quiet weeks are the goal.',
    dry: 'No graded decision went to the sheet this week.',
    blunt: 'No decision to the sheet this week.' },
  { id: 'lt-clean-2', event: 'clean', text: 'The sheet stayed empty this week. I had a quiet seat.' },
  { id: 'lt-leak-1', event: 'leak', text: 'The costliest spot on file is {leak}. Next week starts there; the Ticket draws its spots from it.',
    dry: 'Costliest on file: {leak}. Next week starts there.',
    blunt: 'Costliest: {leak}. Start there.' },
  { id: 'lt-leak-2', event: 'leak', text: 'Next week starts with {leak}, the costliest spot on file.' },
  { id: 'lt-story-1', event: 'story', text: 'At {venue}, {free} of {judged} cost nothing.',
    dry: '{venue}: {free} of {judged} cost nothing.' },
  { id: 'lt-shelf-1', event: 'shelf', text: 'And {shelf} went on the shelf this week. Each one records a decision or a habit kept.' },
  { id: 'lt-rule-1', event: 'rule-new', text: 'A new rule went in the notebook, in your words: “{rule}”',
    dry: 'New in the notebook: “{rule}”' },

  // ── the P.S.: the learner's own words, quoted back ──
  { id: 'lt-ps-1', event: 'ps', text: 'The rule from {ruleDay}, in your words: “{rule}”' },
  { id: 'lt-ps-2', event: 'ps', text: 'From your notebook, written {ruleDay}: “{rule}” It still applies.' },
  { id: 'lt-ps-3', event: 'ps', text: 'Worth a read before the next deal, from {ruleDay}: “{rule}”' },
];
