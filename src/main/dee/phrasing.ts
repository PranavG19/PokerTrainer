/**
 * The phrasing channel: the ONLY place a model touches Dee's words, and it may only reword.
 *
 * The renderer sends a template id and its slots, never text. Main re-renders the scripted answer from the chat
 * bank (src/core/dee/chat/bank.ts) after checking every slot against its declared kind (vocab.ts), so learner
 * text cannot reach the model. The model sees Dee's persona, the scripted answer and the slot values, and
 * returns a rewording. That rewording is shown only if it passes every check below; otherwise, or if the model
 * misses the budget, the scripted answer is shown. The scripted answer is the complete product.
 *
 * The checks are noise filters, not a certificate of meaning (the research's central finding: nothing
 * mechanical certifies meaning). They are deliberately strict, so a rewording that survives can only have
 * dropped words or used house words, in the script's order, with the script's numbers and polarity:
 *  - the tutor guard (`checkTutorOutput`) with the scripted text as the only allowed source of numerals;
 *  - no Dee ban the script itself does not trip;
 *  - every numeral of the script kept, none added, in the same order;
 *  - STRICT=2 (`rephraseProblems`): number words, no new action verb, a question stays one, no collapse,
 *    the same polarity words, and the script's content words in order;
 *  - one line of plain prose: no markup, no link, no prompt echo.
 */

import { checkTutorOutput } from '../tutor/guard.js';
import type { StrategyRequest } from '../tutor/types.js';
import { DEE_BANS } from '../../core/dee/bans.js';
import { renderLine, slotsOf } from '../../core/dee/engine.js';
import { rephraseProblems } from '../../core/dee/strict.js';
import { chatTemplate } from '../../core/dee/chat/bank.js';
import { slotValueOk } from '../../core/dee/chat/vocab.js';

/** The research's budget: past it, the scripted answer shows and is never swapped. */
export const PHRASE_BUDGET_MS = 600;

/** Dee's persona for the rewording. Fixed text; nothing from the learner or the profile enters it. */
export const PERSONA =
  'You are Dee, a dealer button with a dry, warm, old-world voice. Reword the LINE in that voice. ' +
  'Rules: keep every number exactly as written and in the same order; keep every word like not, no, only, more, less, ' +
  'enough, first, last; keep the meaning and the order of ideas; do not add a fact, an action or advice; ' +
  'you may drop small words or join sentences. Reply with the reworded line only, on one line.';

export interface RewriteInput {
  readonly persona: string;
  readonly scripted: string;
  /** The slot values, so a model is told which strings are facts. Every one is typed (vocab.ts). */
  readonly facts: readonly string[];
}

/** Anything that can reword: the llama-server sidecar, or a fake in tests. */
export interface PhraseModel {
  readonly id: string;
  rewrite(input: RewriteInput, signal: AbortSignal): Promise<string>;
}

export interface PhraseRequest {
  readonly templateId: string;
  readonly slots: Readonly<Record<string, string>>;
}

export interface PhraseResult {
  /** Null only when the request itself was invalid; the renderer then keeps its own scripted text. */
  readonly text: string | null;
  readonly source: 'model' | 'script';
  /** Why the scripted answer was used (or null when the model's rewording was). */
  readonly reason: string | null;
  readonly ms: number;
}

/** The scripted answer for a request, re-rendered here from typed slots; or why the request is refused. */
export function scriptedFor(req: PhraseRequest): { text: string; phrase: boolean } | { error: string } {
  if (typeof req?.templateId !== 'string' || typeof req.slots !== 'object' || req.slots === null) return { error: 'malformed' };
  const t = chatTemplate(req.templateId);
  if (t === undefined) return { error: 'unknown-template' };
  const wanted = new Set(slotsOf(t.text));
  const given = Object.keys(req.slots);
  if (given.length !== wanted.size || given.some((k) => !wanted.has(k))) return { error: 'slot-set' };
  for (const [k, v] of Object.entries(req.slots)) {
    // A template that can never be reworded may carry untyped engine prose; the rest must be typed.
    if (typeof v !== 'string' || (t.phrase && !slotValueOk(k, v))) return { error: `slot:${k}` };
  }
  const text = renderLine(t.text, req.slots);
  if (text === null) return { error: 'render' };
  return { text, phrase: t.phrase };
}

/** What a model returned, as one plain line: no thinking block, no echo of the prompt's label, no wrapping quotes. */
export function cleanModelText(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*(?:LINE|Dee|Reworded|Answer)\s*:\s*/i, '')
    .trim()
    .replace(/^["“'‘](.*)["”'’]$/s, '$1')
    .trim();
}

/** Every numeral in any script (full-width digits, fractions, circled numbers), not only ASCII ones. */
const NUMERAL = /\p{N}+(?:\.\p{N}+)?/gu;
const numerals = (t: string): string[] => (t.match(NUMERAL) ?? []) as string[];

/** Plain printable ASCII plus the bank's typographic punctuation: a rewording may not bring in another script. */
const REPERTOIRE = /^[\x20-\x7E\u2018\u2019\u201C\u201D\u2013\u2014\u2026]*$/u;

/**
 * Words the PoC's order rule treats as house words but whose position carries the meaning: what a number is
 * (price, share, held, needed), who acts (first, last, button, blind), and the negators and limiters. A rewording
 * may neither drop nor move them, so "the price was 31% and the share 22%" cannot become the reverse, and "the seat
 * left of the big blind acts first" cannot lose its seat.
 */
const BOUND = new Set(
  ('price pot share hand held needed had asked first last button blind seat not no never only just more less ' +
    'enough too still already again every all some any most free better worse best worst short close so from').split(' '),
);
const stem = (w: string): string => w.replace(/(?:'s|s|ed|ing)$/, '');

/** The bound words and numerals, in order, must be exactly the script's. */
export function boundOrderProblem(text: string, script: string): string | null {
  const toks = (t: string): string[] =>
    ((t.toLowerCase().match(/[a-z']+|\d+(?:\.\d+)?/g) ?? []) as string[]).filter((w) => /\d/.test(w) || BOUND.has(w) || BOUND.has(stem(w))).map(stem);
  const a = toks(text).join(' ');
  const b = toks(script).join(' ');
  return a === b ? null : `bound:${b}=>${a}`;
}
const words = (t: string): number => t.trim().split(/\s+/).filter(Boolean).length;

/** Every reason a rewording of `scripted` is refused; empty means it may be shown. */
export function rewriteProblems(candidate: string, scripted: string): string[] {
  const out: string[] = [];
  if (candidate.trim() === '') return ['empty'];
  if (!REPERTOIRE.test(candidate) && REPERTOIRE.test(scripted)) out.push('script-repertoire');
  if (/[\r\n]/.test(candidate)) out.push('multiline');
  if (/[<>`*#_[\]{}|\\]|https?:|www\.|@/i.test(candidate)) out.push('markup');
  if (/\b(?:line|rules?|persona|instructions?|prompt)\s*:/i.test(candidate)) out.push('prompt-echo');
  if (words(candidate) > Math.min(60, words(scripted) + 8)) out.push('too-long');
  // The scripted text is the only source of numerals the guard may admit.
  const request = { kind: 'strategy', prompt: scripted, table: { positions: [], stacksBb: [], potBb: 0, board: [], heroCards: [], toAct: '', street: 'river' } } as unknown as StrategyRequest;
  const kind = scripted.trim().endsWith('?') ? 'question' : 'correction';
  for (const v of checkTutorOutput({ text: candidate, kind }, request).violations) out.push(`guard:${v.check}:${v.detail}`);
  for (const [name, re] of DEE_BANS) if (re.test(candidate) && !re.test(scripted)) out.push(`dee-ban:${name}`);
  if (numerals(candidate).join(' ') !== numerals(scripted).join(' ')) out.push(`numerals:${numerals(scripted).join(' ')}=>${numerals(candidate).join(' ')}`);
  out.push(...rephraseProblems(candidate, scripted).map((p) => `strict:${p}`));
  const bound = boundOrderProblem(candidate, scripted);
  if (bound) out.push(bound);
  return out;
}

export interface PhraserOptions {
  readonly budgetMs?: number;
  readonly cacheSize?: number;
  readonly now?: () => number;
}

/**
 * Words one answer: the cache, then the model under the budget, then the checks. Deterministic for a given model
 * (temperature 0 and a fixed seed in the sidecar), so a cached rewording is the one the model would give again.
 */
export class Phraser {
  private readonly cache = new Map<string, { text: string; source: 'model' | 'script'; reason: string | null }>();
  private readonly budgetMs: number;
  private readonly cacheSize: number;
  private readonly now: () => number;

  constructor(private readonly model: () => PhraseModel | null, opts: PhraserOptions = {}) {
    this.budgetMs = opts.budgetMs ?? PHRASE_BUDGET_MS;
    this.cacheSize = opts.cacheSize ?? 256;
    this.now = opts.now ?? Date.now;
  }

  async phrase(req: PhraseRequest): Promise<PhraseResult> {
    const start = this.now();
    const ms = (): number => this.now() - start;
    const script = scriptedFor(req);
    if ('error' in script) return { text: null, source: 'script', reason: `invalid:${script.error}`, ms: ms() };
    if (!script.phrase) return { text: script.text, source: 'script', reason: 'scripted-only', ms: ms() };
    const model = this.model();
    if (model === null) return { text: script.text, source: 'script', reason: 'no-model', ms: ms() };

    const key = `${model.id}|${req.templateId}|${JSON.stringify(Object.entries(req.slots).sort(([a], [b]) => a.localeCompare(b)))}`;
    const hit = this.cache.get(key);
    if (hit) return { ...hit, ms: ms() };

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve('timeout');
      }, this.budgetMs);
    });
    let raw: string | 'timeout';
    try {
      raw = await Promise.race([model.rewrite({ persona: PERSONA, scripted: script.text, facts: Object.values(req.slots) }, controller.signal), timeout]);
    } catch {
      // A crashed or refusing model is the scripted answer; not cached, so a restarted model can try again.
      return { text: script.text, source: 'script', reason: 'model-error', ms: ms() };
    } finally {
      clearTimeout(timer);
    }
    if (raw === 'timeout') return { text: script.text, source: 'script', reason: 'timeout', ms: ms() };

    const candidate = cleanModelText(raw);
    const problems = rewriteProblems(candidate, script.text);
    const result =
      problems.length > 0
        ? { text: script.text, source: 'script' as const, reason: `rejected:${problems[0]}` }
        : candidate === script.text
          ? { text: script.text, source: 'script' as const, reason: 'unchanged' }
          : { text: candidate, source: 'model' as const, reason: null };
    this.remember(key, result);
    return { ...result, ms: ms() };
  }

  private remember(key: string, value: { text: string; source: 'model' | 'script'; reason: string | null }): void {
    this.cache.set(key, value);
    while (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value as string);
  }
}
