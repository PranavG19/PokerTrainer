/**
 * Dee's dialogue engine: coach events plus personalization context in, one line id and its filled text out.
 *
 * The contract:
 * - **Dee phrases; the engine owns every number.** Slots are filled only from `Facts` built here out of a
 *   `Grade` (coach.ts), the session's counts and the learner's own saved sentence. `renderLine` refuses a
 *   line whose output carries a numeral no fact supplied, so a template typo cannot author one either.
 * - **The silence rule.** A decision that cost under half a big blind (`free`) gets no comment. The single
 *   exception is "Price held" (owner D6): a close spot played right, said Sure, with a mechanism reason.
 * - **Frequency.** `normal` speaks after notable hands (a mistake, or a price that held); `mistakes` only
 *   after a mistake; `sessions` never between hands, only the session summary.
 * - **Deterministic.** The pick among eligible lines is seeded (rng.ts) by the caller's seed, so a replay
 *   says the same words. Cooldowns are counted in hands, never in wall-clock time. Every line on cooldown
 *   means silence.
 *
 * SEAM: the grader's close-spot band (`Grade.close`, branch grader-close-band) has not landed on main. Until
 * it does, a spot is close when the pot share sits within CLOSE_SPOT_POINTS of the price, which is the
 * vision's own fallback rule (VISION §2.3). When it lands, pass `grade.close` as `closeBand` to
 * `priceHeldEvent` and the band decides instead.
 */

import type { Grade } from '../coach.js';
import { mulberry32 } from '../rng.js';
import { DEE_BANK } from './bank.js';
import {
  FREQUENCIES,
  TONES,
  type DeeAction,
  type DeeEvent,
  type DeeEventKind,
  type Facts,
  type Frequency,
  type Line,
  type Principle,
  type SpokenLine,
  type Tone,
} from './types.js';

/** VISION §2.3: a hard spot is one whose pot share sits within 10 points of the price. */
export const CLOSE_SPOT_POINTS = 0.1;
/** The silence rule's threshold (coach.ts classifySeverity: under 0.5 bb is `free`). */
export const SILENCE_BB = 0.5;
/** A saved sentence longer than this is not quoted at the table: the hand-end beat has two lines. */
export const MAX_QUOTED_RULE_WORDS = 11;

function quotable(rule: string | undefined): string | undefined {
  if (rule === undefined) return undefined;
  const t = rule.trim().replace(/[.!?]+$/, '');
  return t !== '' && t.split(/\s+/).length <= MAX_QUOTED_RULE_WORDS ? t : undefined;
}

export function toneOf(value: string): Tone {
  return (TONES as readonly string[]).includes(value) ? (value as Tone) : 'warm';
}

export function frequencyOf(value: string): Frequency {
  return (FREQUENCIES as readonly string[]).includes(value) ? (value as Frequency) : 'normal';
}

export function principleOf(value: string | null | undefined): Principle {
  return value === 'pot odds' || value === 'value or bluff' || value === 'ranges' ? value : 'other';
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** The facts a grade supplies. Only what the engine computed; nothing is rounded into a new claim. */
export function gradeFacts(grade: Pick<Grade, 'evLossBb' | 'price' | 'spot'>, toCall: number, pot: number): Facts {
  const facts: Facts = { toCall: String(toCall), pot: String(pot) };
  const shares = grade.price ?? grade.spot;
  if (shares) {
    facts.reqPct = pct(shares.needed);
    facts.sharePct = pct(shares.had);
  }
  if (Number.isFinite(grade.evLossBb) && grade.evLossBb >= SILENCE_BB) facts.evLossBb = grade.evLossBb.toFixed(1);
  return facts;
}

/** One hero decision, as the hand-end beat needs it. */
export interface BeatDecision {
  readonly grade: Pick<Grade, 'severity' | 'evLossBb' | 'principle' | 'price' | 'spot'> & { readonly close?: boolean };
  readonly action: DeeAction;
  readonly street: string;
  readonly toCall: number;
  readonly pot: number;
  /** The committed prediction, coached mode only. */
  readonly confidence: 'sure' | 'guess' | null;
  /** What the reason grader made of the typed reason; null when nothing was typed. */
  readonly reasonCategory: 'range' | 'price' | 'hand-strength' | 'none' | null;
  /** G4: an EV-fine action whose reason was hand strength or none. */
  readonly rightForWrongReason: boolean;
}

/** What Dee carries across a sitting. Not persisted: a new sitting starts fresh, as a session does. */
export interface DeeSitting {
  readonly hands: number;
  readonly mistakes: number;
  readonly priceHeld: number;
  /** Notable or serious verdicts per principle this sitting. */
  readonly byPrinciple: Readonly<Record<string, number>>;
  /** Principles whose "Price held" has fired this sitting (once per principle per session). */
  readonly heldPrinciples: readonly Principle[];
}

export const NEW_SITTING: DeeSitting = { hands: 0, mistakes: 0, priceHeld: 0, byPrinciple: {}, heldPrinciples: [] };

/** Personalization context, all of it already in the profile. */
export interface DeeContext {
  readonly tone: Tone;
  readonly frequency: Frequency;
  /** Character off hides Dee everywhere, so it says nothing of its own either. */
  readonly character: boolean;
  /** The learner's own saved sentence per principle, newest; quoted back where it applies. */
  readonly rules: Partial<Record<Principle, string>>;
  /** The principle carrying the most EV loss across the profile (session stats leakCostBb), if any. */
  readonly biggestLeak: Principle | null;
  /** Cooldown stretch per certified depth (VISION §2.2: 1×, 1.5×, 2×, 3×). */
  readonly quietness: number;
}

/** Dee's memory of what it said, in hands watched, so a line is not repeated straight after a restart. */
export interface DeeLineMemory {
  readonly handsWatched: number;
  readonly said: readonly { readonly lineId: string; readonly at: number }[];
}

/** Depth quieting: each certified depth stretches every cooldown (VISION §2.2). Index = DEPTHS position. */
export function quietnessForDepth(depthIndex: number): number {
  const steps = [1, 1, 1.5, 2, 3];
  return steps[Math.max(0, Math.min(steps.length - 1, depthIndex))];
}

/**
 * "Price held" (owner D6): a FREE grade on a priced spot whose pot share sat close to the price, a Sure
 * commit, and a reason the grader read as a mechanism (price or range). Never on a mistake, never on an
 * unpriced spot, never when the reason was a hand-strength claim.
 */
export function isPriceHeld(d: BeatDecision, closeBand?: boolean): boolean {
  if (d.grade.severity !== 'free' || d.toCall <= 0 || !d.grade.spot) return false;
  if (d.confidence !== 'sure' || d.rightForWrongReason) return false;
  if (d.reasonCategory !== 'price' && d.reasonCategory !== 'range') return false;
  const close = closeBand ?? Math.abs(d.grade.spot.had - d.grade.spot.needed) <= CLOSE_SPOT_POINTS;
  return close;
}

/** The principle a priced decision turns on, for "once per principle" on a free grade (which carries none). */
function spotPrinciple(d: BeatDecision): Principle {
  return d.action === 'raise' || d.action === 'bet' || d.action === 'allin' ? 'ranges' : 'pot odds';
}

const isLate = (street: string): boolean => street === 'turn' || street === 'river';

/**
 * The hand-end event, or null for silence. The costliest mistake speaks first; a right-for-the-wrong-reason
 * action next; a price that held last. The frequency setting and Character off are applied here, so the
 * renderer never decides whether Dee talks.
 */
export function handEndEvent(
  decisions: readonly BeatDecision[],
  sitting: DeeSitting,
  ctx: Pick<DeeContext, 'frequency' | 'character' | 'rules' | 'biggestLeak'>,
): DeeEvent | null {
  if (!ctx.character || ctx.frequency === 'sessions' || decisions.length === 0) return null;

  const mistakes = decisions.filter((d) => d.grade.severity !== 'free' && d.grade.evLossBb >= SILENCE_BB);
  if (mistakes.length > 0) {
    const worst = mistakes.reduce((a, b) => (b.grade.evLossBb > a.grade.evLossBb ? b : a));
    const principle = principleOf(worst.grade.principle);
    const facts = gradeFacts(worst.grade, worst.toCall, worst.pot);
    const repeat = sitting.byPrinciple[principle] ?? 0;
    if (repeat > 0) facts.repeat = String(repeat + 1);
    const rule = quotable(ctx.rules[principle]);
    if (rule) facts.rule = rule;
    return {
      kind: 'verdict',
      severity: worst.grade.severity === 'serious' ? 'serious' : 'notable',
      principle,
      action: worst.action,
      priced: worst.toCall > 0,
      late: isLate(worst.street),
      repeat,
      sure: worst.confidence === 'sure',
      leak: ctx.biggestLeak === principle,
      facts,
    };
  }

  const wrongReason = decisions.find((d) => d.rightForWrongReason);
  if (wrongReason) {
    return {
      kind: 'right-action-wrong-reason',
      action: wrongReason.action,
      priced: wrongReason.toCall > 0,
      reason: wrongReason.reasonCategory === 'hand-strength' ? 'hand-strength' : 'none',
      facts: gradeFacts(wrongReason.grade, wrongReason.toCall, wrongReason.pot),
    };
  }

  if (ctx.frequency !== 'normal') return null;
  const held = decisions.find((d) => isPriceHeld(d, d.grade.close) && !sitting.heldPrinciples.includes(spotPrinciple(d)));
  if (held) {
    const principle = spotPrinciple(held);
    const facts = gradeFacts(held.grade, held.toCall, held.pot);
    const rule = quotable(ctx.rules[principle]);
    if (rule) facts.rule = rule;
    return { kind: 'price-held', principle, action: held.action, priced: true, late: isLate(held.street), facts };
  }
  // The silence rule: nothing cost half a big blind and nothing was a close price held.
  return null;
}

/** Fold one finished hand into the sitting. Pure; the renderer keeps the value. */
export function recordHandInSitting(sitting: DeeSitting, decisions: readonly BeatDecision[], beat: DeeEvent | null): DeeSitting {
  const byPrinciple = { ...sitting.byPrinciple };
  let mistakes = 0;
  for (const d of decisions) {
    if (d.grade.severity === 'free' || d.grade.evLossBb < SILENCE_BB) continue;
    mistakes++;
    const p = principleOf(d.grade.principle);
    byPrinciple[p] = (byPrinciple[p] ?? 0) + 1;
  }
  const held = beat?.kind === 'price-held' && beat.principle ? [...sitting.heldPrinciples, beat.principle] : sitting.heldPrinciples;
  return {
    hands: sitting.hands + 1,
    mistakes: sitting.mistakes + mistakes,
    priceHeld: sitting.priceHeld + (beat?.kind === 'price-held' ? 1 : 0),
    byPrinciple,
    heldPrinciples: held,
  };
}

/** The session summary event. Under `sessions` it is the only thing Dee says. */
export function sessionEndEvent(sitting: DeeSitting, ctx: Pick<DeeContext, 'character'>): DeeEvent | null {
  if (!ctx.character || sitting.hands === 0) return null;
  const facts: Facts = { hands: String(sitting.hands), mistakes: String(sitting.mistakes) };
  if (sitting.priceHeld > 0) facts.priceHeld = String(sitting.priceHeld);
  let top: Principle | null = null;
  for (const [p, n] of Object.entries(sitting.byPrinciple)) {
    if (top === null || n > (sitting.byPrinciple[top] ?? 0)) top = principleOf(p);
  }
  return { kind: 'session-end', clean: sitting.mistakes === 0, principle: top ?? undefined, facts };
}

function matchesWhen(line: Line, e: DeeEvent): boolean {
  const w = line.when;
  if (!w) return true;
  if (w.severity !== undefined && w.severity !== e.severity) return false;
  if (w.principle !== undefined && w.principle !== e.principle) return false;
  if (w.action !== undefined && (e.action === undefined || !w.action.includes(e.action))) return false;
  if (w.priced !== undefined && w.priced !== (e.priced ?? false)) return false;
  if (w.late !== undefined && w.late !== (e.late ?? false)) return false;
  if (w.repeat === 'first' && (e.repeat ?? 0) !== 0) return false;
  if (w.repeat === 'repeat' && (e.repeat ?? 0) === 0) return false;
  if (w.sure !== undefined && w.sure !== (e.sure ?? false)) return false;
  if (w.reason !== undefined && w.reason !== e.reason) return false;
  if (w.clean !== undefined && w.clean !== (e.clean ?? false)) return false;
  if (w.leak !== undefined && w.leak !== (e.leak ?? false)) return false;
  return true;
}

/**
 * Specificity: a line that matches more conditions outranks a generic one for the same event, and a line
 * that quotes the learner's own sentence outranks one that does not (it is only eligible when there is one).
 */
function specificity(line: Line): number {
  const conditions = line.when ? Object.keys(line.when).length : 0;
  return conditions + (line.priority ?? 0) + (line.text.includes('{rule}') ? 1 : 0);
}

const SLOT = /\{([a-zA-Z]+)\}/g;
const NUMERAL = /\d+(?:\.\d+)?/g;

export function slotsOf(template: string): string[] {
  return [...template.matchAll(SLOT)].map((m) => m[1]);
}

/**
 * Fill a template from facts. Null when a slot has no fact, or when the result carries a numeral that no
 * fact supplied: Dee never says a number the engine did not compute.
 */
export function renderLine(template: string, facts: Facts): string | null {
  let missing = false;
  const text = template.replace(SLOT, (_m, name: string) => {
    const v = (facts as Record<string, string | undefined>)[name];
    if (v === undefined) missing = true;
    return v ?? '';
  });
  if (missing) return null;
  const allowed = new Set(Object.values(facts).flatMap((v) => (v ?? '').match(NUMERAL) ?? []));
  for (const n of text.match(NUMERAL) ?? []) if (!allowed.has(n)) return null;
  return text;
}

export function textFor(line: Line, tone: Tone): string {
  return (tone === 'dry' ? line.dry : tone === 'blunt' ? line.blunt : undefined) ?? line.text;
}

/**
 * Choose and fill one line for an event, or null (silence). Only the most specific eligible lines compete,
 * so a line written for "a serious pot-odds fold" beats the generic serious line; among those the pick is
 * weighted and seeded. A line said within its cooldown (in hands, stretched by depth) is skipped.
 */
export function selectLine(
  event: DeeEvent | null,
  ctx: Pick<DeeContext, 'tone' | 'quietness' | 'character'>,
  memory: DeeLineMemory,
  seed: number,
  bank: readonly Line[] = DEE_BANK,
): SpokenLine | null {
  if (event === null || !ctx.character) return null;
  const lastSaid = new Map<string, number>();
  for (const s of memory.said) lastSaid.set(s.lineId, Math.max(lastSaid.get(s.lineId) ?? -Infinity, s.at));
  const eligible: { line: Line; text: string }[] = [];
  for (const line of bank) {
    if (line.event !== event.kind || !matchesWhen(line, event)) continue;
    const at = lastSaid.get(line.id);
    if (at !== undefined && memory.handsWatched - at < Math.ceil(line.cooldown * ctx.quietness)) continue;
    const text = renderLine(textFor(line, ctx.tone), event.facts);
    if (text === null) continue;
    eligible.push({ line, text });
  }
  if (eligible.length === 0) return null;
  const top = Math.max(...eligible.map((e) => specificity(e.line)));
  const best = eligible.filter((e) => specificity(e.line) === top);
  const total = best.reduce((sum, e) => sum + (e.line.weight ?? 1), 0);
  let r = mulberry32(seed >>> 0)() * total;
  for (const e of best) {
    r -= e.line.weight ?? 1;
    if (r < 0) return { lineId: e.line.id, event: event.kind, pose: e.line.pose, text: e.text };
  }
  const last = best[best.length - 1];
  return { lineId: last.line.id, event: event.kind, pose: last.line.pose, text: last.text };
}

/** Remember a line as said at the current hand count. Bounded; oldest dropped first. */
export const MAX_SAID = 64;
export function rememberLine(memory: DeeLineMemory, lineId: string): DeeLineMemory {
  return { handsWatched: memory.handsWatched, said: [...memory.said, { lineId, at: memory.handsWatched }].slice(-MAX_SAID) };
}

export function watchHand(memory: DeeLineMemory): DeeLineMemory {
  return { handsWatched: memory.handsWatched + 1, said: memory.said };
}

/** Every event kind the bank must cover (the lint checks each has at least one line). */
export const EVENT_KINDS: readonly DeeEventKind[] = [
  'verdict',
  'right-action-wrong-reason',
  'price-held',
  'session-end',
  'lesson-open',
  'lesson-retry',
  'lesson-done',
];
