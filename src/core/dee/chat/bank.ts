/**
 * Dee's chat bank: every answer and every refusal Dee can give in chat, authored once, in the voice of the line
 * bank (bank.ts): short sentences on concrete nouns, task as the subject, no praise, no luck, no outcomes, no
 * money. Every number is a slot the engine fills (answer.ts); a template writes no digit and no number word.
 *
 * tests/unit/dee-chat-bank.test.ts lints every template filled with engine facts on every CI run: the tutor
 * guard (checkTutorOutput), Dee's ban list (minus a template's named `allowBans`), no numeral or number word in
 * a template, only declared slots, and the guard's word budget.
 *
 * `phrase: false` marks what the optional model may never reword: every refusal (policy reads the same every
 * time) and the study answer, which quotes the recommender's own prose.
 */

import type { ChatTemplate } from './types.js';

// ── explain the last hand (and "what was my mistake", which names the same decision) ────────────────
const explain: ChatTemplate[] = [
  { id: 'explain-po-call', answers: 'explain-hand', pose: 'serious', phrase: true,
    text: 'On the {street} the hand called {toCall} into {pot}. That price was {reqPct}, and the hand held {sharePct} of the pot, short of it. The call gave up {evLossBb} bb.' },
  { id: 'explain-po-fold', answers: 'explain-hand', pose: 'serious', phrase: true,
    text: 'On the {street} the hand folded to {toCall} into {pot}. The price was {reqPct}, and the hand held {sharePct}, more than the price asked. The fold gave up {evLossBb} bb.' },
  { id: 'explain-free-fold', answers: 'explain-hand', pose: 'serious', phrase: true,
    text: 'On the {street} nothing was owed, and the hand folded anyway. Checking was free, so the fold gave up {evLossBb} bb of pot share.' },
  { id: 'explain-late-check', answers: 'explain-hand', pose: 'gate', phrase: true,
    text: 'On the {street} the hand checked while well ahead. A bet charges the worse hands; the check left {evLossBb} bb behind.' },
  { id: 'explain-raise-priced', answers: 'explain-hand', pose: 'serious', phrase: true,
    text: 'On the {street} the hand {acted} over a bet of {toCall} into {pot}. Even a call needed {reqPct}, and the hand held {sharePct}. Putting more in behind it gave up {evLossBb} bb.' },
  { id: 'explain-lead', answers: 'explain-hand', pose: 'gate', phrase: true,
    text: 'On the {street} the hand {acted} with no bet to face and little pot share behind it. A lead like that needs a range to back it; this one gave up {evLossBb} bb.' },
  { id: 'explain-other', answers: 'explain-hand', pose: 'gate', phrase: true,
    text: 'The costliest decision came on the {street}: {evLossBb} bb, filed under {principle}.' },
  { id: 'explain-held-call', answers: 'explain-hand', pose: 'price-held', phrase: true,
    text: 'Nothing in that hand cost {silenceBb} bb or more. The last price was {reqPct}, for {toCall} into {pot}, and the hand held {sharePct}: enough for the call.' },
  { id: 'explain-held-fold', answers: 'explain-hand', pose: 'rest', phrase: true,
    text: 'Nothing in that hand cost {silenceBb} bb or more. The last price was {reqPct}, for {toCall} into {pot}, and the hand held {sharePct}, short of it, so the fold kept the chips.' },
  { id: 'explain-clean', answers: 'explain-hand', pose: 'rest', phrase: true,
    text: 'Nothing in that hand cost {silenceBb} bb or more, and no bet was faced. A quiet hand.' },
  { id: 'mistake-none', answers: 'my-mistake', pose: 'rest', phrase: true,
    text: 'No mistake to name in that hand: nothing cost {silenceBb} bb or more.' },
];

// ── the price ──────────────────────────────────────────────────────────────────────────────────────
const price: ChatTemplate[] = [
  { id: 'price-last', answers: 'price-now', pose: 'glance', phrase: true,
    text: 'The last price faced: {toCall} to call into {pot}, so the call buys a share of {potAfter}. That is {reqPct}, {freq}. The hand held {sharePct}.' },
  { id: 'price-last-none', answers: 'price-now', pose: 'rest', phrase: true,
    text: 'No bet was faced in that hand, so there was no price. A check costs nothing.' },
  { id: 'price-hypo', answers: 'price-now', pose: 'glance', phrase: true,
    text: 'A bet of {bet} into {pot} makes {potAfter} after the call. The price is {reqPct}, {freq}: the call needs at least that share of the pot.' },
  { id: 'price-how', answers: 'price-now', pose: 'listening', phrase: true,
    text: 'The price is the call over the pot after the call. Ask with a bet and a pot, as in a bet into a pot, and Dee does the arithmetic.' },
];

// ── terms ──────────────────────────────────────────────────────────────────────────────────────────
const define: ChatTemplate[] = [
  { id: 'define-own', answers: 'define', pose: 'listening', phrase: true,
    text: '{term} is {definition}' },
  { id: 'define-own-lesson', answers: 'define', pose: 'listening', phrase: true,
    text: '{term} is {definition} The lesson “{lesson}” works through it.' },
  { id: 'define-lesson', answers: 'define', pose: 'listening', phrase: true,
    text: 'From the lesson “{lesson}”: {definition}' },
];

// ── what to study next ─────────────────────────────────────────────────────────────────────────────
const study: ChatTemplate[] = [
  { id: 'study-suggest', answers: 'study-next', pose: 'glance', phrase: false,
    text: 'Next: {studyAction}. The reason: {studyReason}.' },
  { id: 'study-none', answers: 'study-next', pose: 'rest', phrase: true,
    text: 'Nothing is owed yet. A few hands at the table give the coach something to read, and the next step shows on Home.' },
];

// ── the rules, as the engine plays them ────────────────────────────────────────────────────────────
const rules: ChatTemplate[] = [
  { id: 'rules-compare', answers: 'rules', pose: 'glance', phrase: true,
    text: '{better} beats {worse}. Rarer hands rank higher.' },
  { id: 'rules-same', answers: 'rules', pose: 'glance', phrase: true,
    text: 'Two hands of {category} are compared card by card: the higher ranks decide, then the kickers inside the best five.' },
  { id: 'rules-ladder', answers: 'rules', pose: 'listening', phrase: true,
    text: 'From the top: {ladder}. Rarer hands rank higher, and only the best five cards count.' },
  { id: 'rules-order', answers: 'rules', pose: 'listening', phrase: true,
    text: 'Preflop, the seat left of the big blind acts first and the big blind acts last. On every later street the first live seat left of the button starts, and the button acts last.' },
  { id: 'rules-best-five', answers: 'rules', pose: 'listening', phrase: true,
    text: 'A hand is the best five of seven cards: the hole cards and the board, in any mix. The rest play no part.' },
  { id: 'rules-split', answers: 'rules', pose: 'listening', phrase: true,
    text: 'Hands with the same best five cards split the pot. Suits never break a tie.' },
  { id: 'rules-side-pot', answers: 'rules', pose: 'listening', phrase: true,
    text: 'A seat all-in can only contest what it matched from each other seat. Anything beyond that goes to a side pot among the seats still covering it.' },
  { id: 'rules-min-raise', answers: 'rules', pose: 'listening', phrase: true,
    text: 'A raise must add at least as much as the last bet or raise on this street. Less than that is only possible as an all-in.' },
  { id: 'rules-check', answers: 'rules', pose: 'listening', phrase: true,
    text: 'A check passes without putting chips in. It is open only when nobody has bet on this street.' },
  { id: 'rules-blinds-move', answers: 'rules', pose: 'listening', phrase: true,
    text: 'The seats left of the button post the small and big blinds before the cards come. The button moves one seat left each hand, and the blinds move with it.' },
];

// ── how the app works ──────────────────────────────────────────────────────────────────────────────
const feature: ChatTemplate[] = [
  { id: 'feature-phrasing-off', answers: 'feature', pose: 'listening', phrase: true,
    text: 'Smarter phrasing is an optional download of about a gigabyte, in Settings under Dee. It only rewords the written answer; the engine still computes every number, and the written answer shows whenever a rewording fails a check.' },
  { id: 'feature-phrasing-on', answers: 'feature', pose: 'listening', phrase: true,
    text: 'Smarter phrasing is installed. A small model on this machine rewords the written answer; every number still comes from the engine, and a rewording that fails a check is dropped for the written one.' },
  { id: 'feature-price-held', answers: 'feature', pose: 'price-held', phrase: true,
    text: 'Price held is the one remark on a hand played right: a close price, a call or fold on the right side of it, marked Sure, for a price or range reason.' },
  // The streak answer must name the streak; the absence-guilt ban exists to stop Dee nagging about it, which
  // this factual line does not do.
  { id: 'feature-streak', answers: 'feature', pose: 'listening', phrase: true, allowBans: ['absence-guilt'],
    text: 'The streak counts days in a row with a practice session. A missed day starts it over; there are no freezes and no rest days.' },
  { id: 'feature-sure-guess', answers: 'feature', pose: 'listening', phrase: true,
    text: 'Each decision is marked Sure or Guess before the verdict. A Sure that grades as a mistake gets priority on review, because a confident error is a rule worth fixing.' },
  { id: 'feature-gate', answers: 'feature', pose: 'gate', phrase: true,
    text: 'On a costly decision the coach asks for one line on the price or range behind it before the verdict shows. A clear reason opens the verdict straight away.' },
  { id: 'feature-coach', answers: 'feature', pose: 'listening', phrase: true,
    text: 'With Coach on, each decision is graded against the price and the pot share. A cost under {silenceBb} bb stays silent; anything above is notable, and the costliest are serious.' },
  { id: 'feature-quiet', answers: 'feature', pose: 'listening', phrase: true,
    text: 'Settings, under Dee, sets how often Dee speaks and in which tone. Character off hides Dee everywhere; the coach’s verdicts stay.' },
  { id: 'feature-chips', answers: 'feature', pose: 'listening', phrase: true,
    text: 'The chips here are play chips. They buy nothing and cost nothing, and a rebuy refills them.' },
  { id: 'feature-privacy', answers: 'feature', pose: 'listening', phrase: true,
    text: 'Chat answers come from this machine. The only download chat can make is the optional phrasing model, and only after its button is pressed.' },
  { id: 'feature-lessons', answers: 'feature', pose: 'listening', phrase: true,
    text: 'Learn holds the lessons and Train holds the drills. A lesson ends with a sentence in its own words, kept in the notebook for the next time the spot comes up.' },
  { id: 'feature-review', answers: 'feature', pose: 'listening', phrase: true,
    text: 'Every finished hand is kept, with each decision as it looked at the time. The hand history replays them one decision at a time.' },
  { id: 'feature-about-dee', answers: 'feature', pose: 'glance', phrase: true,
    text: 'Dee is the dealer button, with two lights for eyes. Dee phrases what the engine decided: every number in an answer comes from the engine, never from a guess.' },
  { id: 'feature-scope', answers: 'feature', pose: 'listening', phrase: true,
    text: 'Dee answers about the last hand, the price, mistakes, poker terms, the rules, what to study next, and how the app works. Anything else gets a polite no.' },
];

// ── refusals: scripted, never reworded ─────────────────────────────────────────────────────────────
const refusals: ChatTemplate[] = [
  { id: 'refuse-off-topic', answers: 'off-topic', pose: 'rest', phrase: false,
    text: 'That is outside this table. Dee answers about poker practice here: the last hand, the price, terms, rules and the app.' },
  // The money refusals must name what they refuse.
  { id: 'refuse-money', answers: 'money', pose: 'gate', phrase: false, allowBans: ['gambling'],
    text: 'Dee does not talk about money. Offsuit uses play chips only, and the practice here is about decisions, not stakes.' },
  { id: 'refuse-gambling', answers: 'gambling', pose: 'gate', phrase: false, allowBans: ['gambling'],
    text: 'Dee will not help with gambling for money: no sites, stakes or bets. The table here is for practice, with play chips.' },
  { id: 'refuse-support', answers: 'support', pose: 'listening', phrase: false, allowBans: ['gambling'],
    text: 'That matters more than any hand of cards. A doctor or a gambling support service can help; Offsuit never uses money.' },
  { id: 'refuse-personal', answers: 'personal', pose: 'glance', phrase: false,
    text: 'Dee is a dealer button, so that one is outside its reach. Ask about the table instead.' },
  { id: 'refuse-medical', answers: 'medical', pose: 'listening', phrase: false,
    text: 'Health questions belong with a doctor, not a dealer button. Dee sticks to the table.' },
  { id: 'refuse-crisis', answers: 'crisis', pose: 'listening', phrase: false,
    text: 'That matters far more than any hand. Please reach someone close, or a local crisis line or emergency service, right now.' },
  { id: 'refuse-injection', answers: 'injection', pose: 'gate', phrase: false,
    text: 'Dee only answers from the engine, and that does not change. Ask about the table, and the answer comes from there.' },
  { id: 'refuse-too-long', answers: 'too-long', pose: 'glance', phrase: false,
    text: 'That is a lot of words for a dealer button. One short question at a time, please.' },
  { id: 'refuse-in-hand', answers: 'in-hand', pose: 'thinking', phrase: false,
    text: 'Not while the hand is live: the read is yours until it ends. Ask again at the end, and Dee shows the arithmetic.' },
  { id: 'refuse-no-hand', answers: 'no-hand', pose: 'rest', phrase: false,
    text: 'No hand has finished yet, so there is nothing to explain. Play one, and ask again at the end.' },
  { id: 'refuse-unknown', answers: 'unknown', pose: 'thinking', phrase: false,
    text: 'Dee has no answer for that one yet. Try a term, a rule, the price, or the last hand.' },
];

export const CHAT_BANK: readonly ChatTemplate[] = [...explain, ...price, ...define, ...study, ...rules, ...feature, ...refusals];

export function chatTemplate(id: string): ChatTemplate | undefined {
  return CHAT_BANK.find((t) => t.id === id);
}
