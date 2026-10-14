/**
 * Dee's greeting on Home: one line, from what is on file. Scripted, never generated; held to the same lint as
 * every Dee line (DEE_BANS, the guard, the strict tone rules), so it never mentions absence, days missed, the
 * streak, luck or results, and never says something about the learner as a person.
 *
 * The salutation ("Evening, Sam.") is built outside the line, so the learner's chosen name is never a template.
 * Lines are chosen by the most specific moment that applies, then seeded by the day, avoiding yesterday's line
 * when another fits (`progression.dee.lastGreeting`). Every number comes from a fact.
 *
 * Pure: the caller passes the local hour and the day.
 */

import type { DayKey } from '../localDay.js';
import { mulberry32 } from '../rng.js';
import { renderLine } from '../dee/engine.js';
import type { Line, Tone } from '../dee/types.js';

export type GreetingMoment = 'first' | 'done' | 'return' | 'due' | 'leak' | 'rule' | 'quiet';

/** The slots a greeting may use, each filled from a record (counts formatted with their noun). */
export const GREETING_SLOTS = ['review', 'leak', 'rule'] as const;
export type GreetingFacts = Partial<Record<(typeof GREETING_SLOTS)[number], string>>;

export const GREETING_WORD_BUDGET = 20;

export interface GreetingLine extends Pick<Line, 'id' | 'text' | 'dry' | 'blunt'> {
  readonly moment: GreetingMoment;
}

export const GREETING_LINES: readonly GreetingLine[] = [
  {
    id: 'greet.first.1',
    moment: 'first',
    text: 'I sit at every table and never play a hand. Deal one and I watch the price.',
    dry: 'I sit at every table and never play a hand. Deal one; I watch the price.',
    blunt: 'I sit at every table, never play a hand. Deal one. I watch the price.',
  },
  {
    id: 'greet.done.1',
    moment: 'done',
    text: 'The Ticket is done. Anything from here is extra.',
    dry: 'Ticket done. Anything from here is extra.',
    blunt: 'Ticket done. Anything from here is extra.',
  },
  {
    id: 'greet.return.1',
    moment: 'return',
    text: 'Back at the table. {review} ready for review, and the gap helped the spacing.',
    dry: 'Back. {review} ready for review; the gap helped the spacing.',
    blunt: 'Back. {review} ready for review. The gap helped.',
  },
  {
    id: 'greet.due.1',
    moment: 'due',
    text: '{review} ready for review. The spacing did its work, and the Ticket starts there.',
    dry: '{review} ready for review. The Ticket starts there.',
    blunt: '{review} ready for review. Start the Ticket.',
  },
  {
    id: 'greet.due.2',
    moment: 'due',
    text: '{review} ready for review, right on the schedule. The Ticket has them up top.',
    dry: '{review} ready for review, on schedule. The Ticket has them up top.',
    blunt: '{review} ready for review. Ticket, top row.',
  },
  {
    id: 'greet.leak.1',
    moment: 'leak',
    text: 'The costliest spot on file is {leak}. The Ticket leans on it.',
    dry: 'Costliest spot on file: {leak}. The Ticket leans on it.',
    blunt: 'Costliest spot: {leak}. Work it.',
  },
  {
    id: 'greet.leak.2',
    moment: 'leak',
    text: 'Most of the cost on file is {leak}. The spots on the Ticket are about it.',
    dry: 'Most of the cost on file: {leak}. The Ticket spots cover it.',
    blunt: 'Most of the cost: {leak}. The Ticket spots cover it.',
  },
  {
    id: 'greet.rule.1',
    moment: 'rule',
    text: 'In your words: “{rule}.” It still holds at the table.',
    dry: 'On file, in your words: “{rule}.” It still holds.',
    blunt: 'On file: “{rule}.” Still holds.',
  },
  {
    id: 'greet.quiet.1',
    moment: 'quiet',
    text: 'Nothing is owed. A hand, a lesson or a spot: pick one.',
    dry: 'Nothing owed. A hand, a lesson or a spot: pick one.',
    blunt: 'Nothing owed. Pick one.',
  },
];

/** The order moments are tried in: the first that has facts wins. */
const PRECEDENCE: readonly GreetingMoment[] = ['done', 'first', 'return', 'due', 'leak', 'rule', 'quiet'];

export interface GreetingInput {
  readonly day: DayKey;
  /** Local hour 0–23, for the salutation. */
  readonly hour: number;
  readonly name: string | null;
  readonly tone: Tone;
  readonly handsPlayed: number;
  readonly dueCount: number;
  /** A leak in words (story/cast.ts LEAK_LABELS), or null. */
  readonly leak: string | null;
  /** The newest rule sentence short enough to quote, or null. */
  readonly rule: string | null;
  readonly ticketDoneToday: boolean;
  /** Whole local days since the last counted day; null before the first. */
  readonly daysSinceLastSession: number | null;
  /** Yesterday's (or today's) greeting, to avoid repeating it. */
  readonly lastGreeting: { day: DayKey; lineId: string } | null;
}

export interface Greeting {
  readonly salutation: string;
  readonly lineId: string;
  readonly text: string;
  readonly moment: GreetingMoment;
}

/** Morning 4 am–noon, afternoon noon–5 pm, evening otherwise (the practice day turns at 4 am). */
export function salutation(hour: number, name: string | null): string {
  const part = hour >= 4 && hour < 12 ? 'Morning' : hour >= 12 && hour < 17 ? 'Afternoon' : 'Evening';
  const n = name?.trim();
  return n ? `${part}, ${n}.` : `${part}.`;
}

function factsFor(input: GreetingInput): Partial<Record<GreetingMoment, GreetingFacts>> {
  const due = input.dueCount > 0 ? `${input.dueCount} ${input.dueCount === 1 ? 'concept' : 'concepts'}` : null;
  const out: Partial<Record<GreetingMoment, GreetingFacts>> = { quiet: {} };
  if (input.handsPlayed === 0) out.first = {};
  if (input.ticketDoneToday) out.done = {};
  if (due && input.daysSinceLastSession !== null && input.daysSinceLastSession >= 2) out.return = { review: due };
  if (due) out.due = { review: due };
  if (input.leak) out.leak = { leak: input.leak };
  if (input.rule) out.rule = { rule: input.rule.trim().replace(/[.!?]+$/, '') };
  return out;
}

/** The line in the chosen tone (the canonical Warm line when a tone has no variant), as engine.ts textFor does. */
export function toneText(line: GreetingLine, tone: Tone): string {
  return (tone === 'dry' ? line.dry : tone === 'blunt' ? line.blunt : undefined) ?? line.text;
}

export function greetingFor(input: GreetingInput): Greeting {
  const facts = factsFor(input);
  for (const moment of PRECEDENCE) {
    const f = facts[moment];
    if (f === undefined) continue;
    const lines = GREETING_LINES.filter((l) => l.moment === moment);
    // Today's line is kept all day; otherwise avoid yesterday's when another line fits.
    const kept = input.lastGreeting?.day === input.day ? lines.find((l) => l.id === input.lastGreeting?.lineId) : undefined;
    const fresh = lines.filter((l) => l.id !== input.lastGreeting?.lineId);
    const pool = kept ? [kept] : fresh.length > 0 ? fresh : lines;
    const pick = pool[Math.floor(mulberry32(input.day >>> 0)() * pool.length)];
    const text = renderLine(toneText(pick, input.tone), f);
    if (text === null) continue;
    return { salutation: salutation(input.hour, input.name), lineId: pick.id, text, moment };
  }
  // Unreachable: the quiet line has no slots. Kept total so Home never renders a hole.
  return { salutation: salutation(input.hour, input.name), lineId: 'greet.quiet.1', text: GREETING_LINES[GREETING_LINES.length - 1].text, moment: 'quiet' };
}
