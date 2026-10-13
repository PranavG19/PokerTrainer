/**
 * The answer engine: a gate result plus the chat context in, one filled template out. The engine computes every
 * fact (the grade's price and pot share, the arithmetic, the lesson, the recommender's suggestion); the template
 * only words it. Numbers the learner typed are never echoed: the one place a typed number is read is a
 * hypothetical price ("a bet of 50 into 100"), where the engine computes the price from it, and the answer
 * says the computed figures.
 *
 * `renderLine` (engine.ts) fills the template and refuses any numeral no fact supplied, so a template typo
 * cannot author a number here either. A template that cannot be filled falls back to the "unknown" refusal
 * rather than showing a sentence with a hole in it.
 */

import { naturalFrequency, potOdds } from '../../arithmetic.js';
import { HandCategory } from '../../evaluate.js';
import { lessonById } from '../../lessons/index.js';
import { renderLine, SILENCE_BB, slotsOf } from '../engine.js';
import type { Facts } from '../types.js';
import { CHAT_BANK, chatTemplate } from './bank.js';
import { classify } from './gate.js';
import type { ChatAnswer, ChatContext, ChatDecision, ChatSlots, ChatSuggestion, ChatTemplate, GateResult, Refusal } from './types.js';
import { categoryWord, conceptById, definitionOf, ladderPhrase } from './vocab.js';

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const bb = (x: number): string => x.toFixed(1);
const capitalised = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const ACTED: Readonly<Record<ChatDecision['action'], string>> = {
  fold: 'folded',
  check: 'checked',
  call: 'called',
  bet: 'bet',
  raise: 'raised',
  allin: 'went all-in',
};

/** Fill one template. Null when a slot has no fact or a numeral has no source. */
function fill(t: ChatTemplate, all: ChatSlots, kind: ChatAnswer['kind']): ChatAnswer | null {
  // Only the slots the template says: the answer carries exactly what main will re-check.
  const slots: Record<string, string> = {};
  for (const name of slotsOf(t.text)) if (all[name] !== undefined) slots[name] = all[name];
  const text = renderLine(t.text, slots as Facts);
  if (text === null) return null;
  return { kind, answers: t.answers, templateId: t.id, slots, text, pose: t.pose, phrase: t.phrase };
}

export function refusal(r: Refusal): ChatAnswer {
  const t = chatTemplate(`refuse-${r}`);
  if (t === undefined) throw new Error(`no refusal template for ${r}`);
  const out = fill(t, {}, 'refusal');
  if (out === null) throw new Error(`refusal ${r} did not render`);
  return out;
}

function answer(id: string, slots: ChatSlots): ChatAnswer {
  const t = chatTemplate(id);
  return (t && fill(t, slots, 'answer')) ?? refusal('unknown');
}

const isMistake = (d: ChatDecision): boolean => d.grade.severity !== 'free' && Number.isFinite(d.grade.evLossBb) && d.grade.evLossBb >= SILENCE_BB;

/** The costliest graded mistake of the hand, or null (the silence rule's threshold, as at the table). */
export function costliest(decisions: readonly ChatDecision[]): ChatDecision | null {
  let worst: ChatDecision | null = null;
  for (const d of decisions) if (isMistake(d) && (worst === null || d.grade.evLossBb > worst.grade.evLossBb)) worst = d;
  return worst;
}

/** The facts one graded decision supplies. Shares only where the grade carries them (a priced spot). */
function decisionSlots(d: ChatDecision): Record<string, string> {
  const s: Record<string, string> = { street: d.street, acted: ACTED[d.action], toCall: String(d.toCall), pot: String(d.pot), silenceBb: bb(SILENCE_BB) };
  const shares = d.grade.price ?? d.grade.spot;
  if (shares && d.toCall > 0) {
    s.reqPct = pct(shares.needed);
    s.sharePct = pct(shares.had);
  }
  if (isMistake(d)) s.evLossBb = bb(d.grade.evLossBb);
  if (d.grade.principle) s.principle = d.grade.principle;
  return s;
}

function explainMistake(d: ChatDecision): ChatAnswer {
  const s = decisionSlots(d);
  const priced = d.toCall > 0;
  const p = d.grade.principle;
  const raised = d.action === 'bet' || d.action === 'raise' || d.action === 'allin';
  const id =
    p === 'pot odds' && d.action === 'call' && priced ? 'explain-po-call'
    : p === 'pot odds' && d.action === 'fold' && priced ? 'explain-po-fold'
    : p === 'value or bluff' && d.action === 'fold' && !priced ? 'explain-free-fold'
    : p === 'value or bluff' && d.action === 'check' ? 'explain-late-check'
    : p === 'ranges' && raised && priced ? 'explain-raise-priced'
    : p === 'value or bluff' && raised && !priced ? 'explain-lead'
    : 'explain-other';
  const out = answer(id, s);
  return out.answers === 'unknown' ? answer('explain-other', s) : out;
}

/** The last priced decision of a hand, for "what was the price". */
function lastPriced(decisions: readonly ChatDecision[]): ChatDecision | null {
  for (let i = decisions.length - 1; i >= 0; i--) {
    const d = decisions[i];
    if (d.toCall > 0 && (d.grade.spot ?? d.grade.price)) return d;
  }
  return null;
}

function explainHand(ctx: ChatContext): ChatAnswer {
  const decisions = ctx.lastHand?.decisions ?? [];
  const worst = costliest(decisions);
  if (worst) return explainMistake(worst);
  const priced = lastPriced(decisions);
  if (priced) {
    const s = decisionSlots(priced);
    const shares = priced.grade.spot ?? priced.grade.price;
    const enough = shares !== undefined && shares.had >= shares.needed;
    // A call, raise or check is "enough" only with the share at or over the price; a fold, only under it.
    if (priced.action === 'fold' && !enough) return answer('explain-held-fold', s);
    if (priced.action !== 'fold' && enough) return answer('explain-held-call', s);
  }
  return answer('explain-clean', { silenceBb: bb(SILENCE_BB) });
}

function priceAnswer(ctx: ChatContext, gate: Extract<GateResult, { kind: 'intent' }>): ChatAnswer {
  if (gate.topic === 'hypothetical' && gate.numbers && gate.numbers.length === 2) {
    const [bet, pot] = gate.numbers;
    const po = potOdds(pot, bet);
    return answer('price-hypo', {
      bet: String(bet),
      pot: String(pot),
      potAfter: String(po.potAfterCall),
      reqPct: pct(po.requiredEquity),
      freq: po.frequency.text,
    });
  }
  if (ctx.lastHand === null) return answer('price-how', {});
  const d = lastPriced(ctx.lastHand.decisions);
  if (d === null) return answer('price-last-none', {});
  const shares = d.grade.spot ?? d.grade.price;
  if (!shares) return answer('price-last-none', {});
  return answer('price-last', {
    toCall: String(d.toCall),
    pot: String(d.pot),
    potAfter: String(d.pot + d.toCall),
    reqPct: pct(shares.needed),
    freq: naturalFrequency(shares.needed).text,
    sharePct: pct(shares.had),
  });
}

function defineAnswer(topic: string | undefined): ChatAnswer {
  const c = topic === undefined ? undefined : conceptById(topic);
  if (c === undefined) return refusal('unknown');
  const lesson = c.lessonId === undefined ? undefined : lessonById(c.lessonId);
  if (c.definition === undefined) {
    return lesson ? answer('define-lesson', { lesson: lesson.title, definition: definitionOf(c) }) : refusal('unknown');
  }
  if (lesson) return answer('define-own-lesson', { term: c.term, definition: c.definition, lesson: lesson.title });
  return answer('define-own', { term: c.term, definition: c.definition });
}

function rulesAnswer(gate: Extract<GateResult, { kind: 'intent' }>): ChatAnswer {
  if (gate.topic === 'compare' && gate.numbers && gate.numbers.length === 2) {
    const [a, b] = gate.numbers as [HandCategory, HandCategory];
    if (a === b) return answer('rules-same', { category: categoryWord(a) });
    const [better, worse] = a > b ? [a, b] : [b, a];
    return answer('rules-compare', { better: capitalised(categoryWord(better)), worse: categoryWord(worse) });
  }
  if (gate.topic === 'ladder') return answer('rules-ladder', { ladder: ladderPhrase() });
  const t = gate.topic === undefined ? undefined : chatTemplate(`rules-${gate.topic}`);
  return t ? answer(t.id, {}) : refusal('unknown');
}

function featureAnswer(ctx: ChatContext, topic: string | undefined): ChatAnswer {
  if (topic === 'phrasing') return answer(ctx.phrasingInstalled ? 'feature-phrasing-on' : 'feature-phrasing-off', {});
  if (topic === 'coach') return answer('feature-coach', { silenceBb: bb(SILENCE_BB) });
  const t = topic === undefined ? undefined : chatTemplate(`feature-${topic}`);
  return t ? answer(t.id, {}) : answer('feature-scope', {});
}

/** Intents that are about the live hand, which Dee does not discuss until it ends. */
const ABOUT_THE_HAND = new Set(['explain-hand', 'my-mistake', 'price-now']);

/** The whole scripted pipeline: gate, then engine facts, then the template. This alone is the product. */
export function answerQuestion(question: string, ctx: ChatContext): ChatAnswer {
  return answerFor(classify(question), ctx);
}

export function answerFor(gate: GateResult, ctx: ChatContext): ChatAnswer {
  if (gate.kind === 'refuse') return refusal(gate.refusal);
  if (ctx.phase === 'in-hand' && ABOUT_THE_HAND.has(gate.intent)) return refusal('in-hand');
  switch (gate.intent) {
    case 'explain-hand':
      return ctx.lastHand === null ? refusal('no-hand') : explainHand(ctx);
    case 'my-mistake': {
      if (ctx.lastHand === null) return refusal('no-hand');
      const worst = costliest(ctx.lastHand.decisions);
      return worst ? explainMistake(worst) : answer('mistake-none', { silenceBb: bb(SILENCE_BB) });
    }
    case 'price-now':
      return priceAnswer(ctx, gate);
    case 'define':
      return defineAnswer(gate.topic);
    case 'study-next':
      return ctx.study === null
        ? answer('study-none', {})
        : answer('study-suggest', { studyAction: ctx.study.action.replace(/[.\s]+$/, ''), studyReason: ctx.study.reason.replace(/[.\s]+$/, '') });
    case 'rules':
      return rulesAnswer(gate);
    case 'feature':
      return featureAnswer(ctx, gate.topic);
  }
}

/** The one-tap questions the panel offers for where the learner is. */
export function suggestionsFor(ctx: ChatContext): ChatSuggestion[] {
  if (ctx.phase === 'in-hand') {
    return [
      { label: 'What is pot odds?', question: 'What is pot odds?' },
      { label: 'Who acts first?', question: 'Who acts first?' },
      { label: 'What can I ask?', question: 'What can I ask?' },
    ];
  }
  if (ctx.lastHand !== null) {
    return [
      { label: 'Explain this hand', question: 'Explain this hand' },
      { label: 'What was my mistake?', question: 'What was my mistake?' },
      { label: 'What was the price?', question: 'What was the price?' },
      { label: 'What should I study next?', question: 'What should I study next?' },
    ];
  }
  return [
    { label: 'What should I study next?', question: 'What should I study next?' },
    { label: 'What is pot odds?', question: 'What is pot odds?' },
    { label: 'Does a flush beat a straight?', question: 'Does a flush beat a straight?' },
    { label: 'What can I ask?', question: 'What can I ask?' },
  ];
}

/** Every template id, for the lint and the IPC check. */
export const CHAT_TEMPLATE_IDS: readonly string[] = CHAT_BANK.map((t) => t.id);
