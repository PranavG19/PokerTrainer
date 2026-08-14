/**
 * Content validation for lessons. Pure functions over lesson data; no DOM, no I/O.
 *
 * The load-bearing check is `tryBuildExample`: every authored example is dealt from a real
 * 52-card deck and seated on the real betting engine (src/core/table.ts), then the engine is
 * asked whether hero can actually make the call the example says hero faces. An example that
 * cannot be constructed is a content bug, and running this from a unit test turns that bug into
 * a test failure instead of a blank screen at runtime.
 *
 * The banned-phrase list below deliberately duplicates part of src/main/tutor/guard.ts. That
 * guard bounds *tutor output* against a TutorRequest and lives in the Electron main process;
 * this one bounds *authored content* and must be importable by core and by the renderer. Sharing
 * one module would drag main-process types into core for no gain.
 */

import { freshDeck, RANKS, SUITS, type Card, type Rank, type Suit } from '../cards.js';
import {
  applyAction,
  createTable,
  legalActions,
  startHand,
  type ActionKind,
  type Street,
  type TableState,
} from '../table.js';
import type { Lesson, LessonExample, LessonPosition } from './types.js';

// ── Issues ───────────────────────────────────────────────────────────────────

export type IssueCode =
  | 'duplicate-lesson-id'
  | 'duplicate-example-id'
  | 'unknown-prerequisite'
  | 'prerequisite-cycle'
  | 'self-prerequisite'
  | 'unbuildable-example'
  | 'prose-too-long'
  | 'prose-shape'
  | 'banned-phrase'
  | 'empty-lesson';

export interface ValidationIssue {
  readonly code: IssueCode;
  readonly lessonId: string;
  /** Present when the issue belongs to one example rather than the lesson. */
  readonly exampleId?: string;
  /** The authored field at fault, e.g. 'reasoning'. */
  readonly field?: string;
  readonly detail: string;
}

// ── Prose rules (G6, G7, G10) ────────────────────────────────────────────────

/**
 * G6 gives 60 words to a correction; the other fields are shorter because they are read at a
 * glance beside a table, not instead of it.
 */
export const PROSE_WORD_LIMITS = {
  title: 10,
  mechanism: 30,
  prompt: 25,
  reasoning: 60,
} as const;

/** G6: three chunks. Chunks are sentences, which is the only mechanically decidable reading. */
export const REASONING_CHUNKS = 3;

interface BanRule {
  readonly name: string;
  readonly pattern: RegExp;
}

const BAN_RULES: readonly BanRule[] = [
  // G7 — aggregate by error tag, never by trait. Second-person trait attribution.
  { name: 'trait:you-are', pattern: /\byou(?:'re|’re|\s+are|\s+were)\b/i },
  { name: 'trait:you-habitually', pattern: /\byou\s+(?:always|never|tend|keep|usually|often)\b/i },
  {
    name: 'trait:your-trait-noun',
    pattern:
      /\byour\s+(?:tendency|tendencies|leak|leaks|problem|weakness|style|personality|game|instincts|habit|habits)\b/i,
  },
  {
    name: 'trait:player-label',
    pattern: /\b(?:nit|fish|whale|donk|maniac|calling\s+station)\b/i,
  },

  // No praise, and never praise adjacent to a correction.
  {
    name: 'praise:phrase',
    pattern:
      /\b(?:nice|great|excellent|perfect|impressive|awesome|beautiful|congrats|congratulations|well\s+(?:done|played)|good\s+(?:job|read|call|fold|bet|instincts|thinking))\b/i,
  },

  // Gamification vocabulary (streak/rank/percentile/XP/badge/leaderboard/personal best) was ALLOWED on
  // 2026-08-14 by product decision — the app now has honest progress features built on real data — so
  // the former rank:streak / rank:ordinal / rank:gamified rules were removed. The trait, praise and
  // fold-reveal rules below are separate pedagogy guarantees and stay.

  // G10 — per-hand fold reveals are prohibited permanently.
  { name: 'fold-reveal:you-folded', pattern: /\byou\s+folded\b/i },
  {
    name: 'fold-reveal:counterfactual',
    pattern: /\bwould\s+have\s+(?:flopped|hit|made|rivered|turned|won|scooped|improved|been)\b/i,
  },
  {
    name: 'fold-reveal:if-you-had',
    pattern: /\bif\s+you\s+had\s+(?:called|stayed|continued|raised)\b/i,
  },
];

/** G6 task-as-subject, checked as a proxy: the sentence may not open on the learner. */
const LEADING_PRONOUN = /^\s*(?:you|you're|you’re|your|yours|yourself)\b/i;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

export function sentenceChunks(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== '');
}

export function bannedPhrasesIn(text: string): string[] {
  return BAN_RULES.flatMap((rule) => {
    const hit = rule.pattern.exec(text);
    return hit === null ? [] : [`${rule.name}: "${hit[0]}"`];
  });
}

// ── Example construction through the real engine ─────────────────────────────

/** The app deals a 4-seat table, so every lesson position is an offset from that button. */
const TABLE_SEATS = 4;

/**
 * Seats clockwise from the button on the 4-max table: blinds one and two seats left of it, and
 * the cutoff is the seat to its right, acting before it. Villains who folded before the authored
 * street do not change these offsets, which is why seat count is fixed here and villainStacks
 * only says how many opponents are still in the hand.
 */
const SEAT_OFFSET_FROM_BUTTON: Readonly<Record<LessonPosition, number>> = {
  BTN: 0,
  SB: 1,
  BB: 2,
  CO: 3,
};

const BOARD_LENGTH: Readonly<Record<Street, number>> = {
  preflop: 0,
  flop: 3,
  turn: 4,
  river: 5,
  showdown: 5,
};

export type BuildResult =
  | { readonly ok: true; readonly state: TableState }
  | { readonly ok: false; readonly reason: string };

function isCard(card: Card): boolean {
  return (
    card.length === 2 &&
    RANKS.includes(card[0] as Rank) &&
    SUITS.includes(card[1] as Suit)
  );
}

/** Deals the named cards off a real deck, which is what proves they are legal and distinct. */
function dealFromDeck(cards: readonly Card[]): { rest: Card[] } | { reason: string } {
  const deck = freshDeck();
  for (const card of cards) {
    if (!isCard(card)) return { reason: `not a card: "${card}"` };
    const at = deck.indexOf(card);
    if (at === -1) return { reason: `card dealt twice: ${card}` };
    deck.splice(at, 1);
  }
  return { rest: deck };
}

function chipTotal(state: TableState): number {
  return state.seats.reduce((sum, seat) => sum + seat.stack, 0) + state.pot;
}

/**
 * Builds the example on the real engine and returns the state a renderer would draw.
 *
 * The snapshot is *placed* rather than replayed: an authored spot names a mid-hand position, and
 * no sequence of actions is guaranteed to reach an arbitrary pot from a fresh deal. So the hand
 * is started for real — which is what checks the position mapping against the engine's own blind
 * posting — and the authored pot, stacks, board and price are then written onto that state and
 * handed back to `legalActions`/`applyAction` for judgement.
 */
export function tryBuildExample(example: LessonExample): BuildResult {
  const villainCount = example.villainStacks.length;
  if (villainCount < 1 || villainCount > TABLE_SEATS - 1) {
    return { ok: false, reason: `${villainCount} villains: the 4-seat table allows 1 to 3` };
  }

  const offset = SEAT_OFFSET_FROM_BUTTON[example.position];

  if (example.street === 'showdown') {
    return { ok: false, reason: 'showdown offers no decision' };
  }
  if (example.board.length !== BOARD_LENGTH[example.street]) {
    return {
      ok: false,
      reason: `${example.street} shows ${BOARD_LENGTH[example.street]} board cards, not ${example.board.length}`,
    };
  }
  if (example.hole.length !== 2) {
    return { ok: false, reason: `${example.hole.length} hole cards, not 2` };
  }

  if (example.bb <= 0 || example.bb % 2 !== 0) {
    return { ok: false, reason: `bb ${example.bb} must be a positive even number of chips` };
  }
  if (example.pot <= 0) return { ok: false, reason: `pot ${example.pot} must be positive` };
  if (example.toCall < 0) return { ok: false, reason: `toCall ${example.toCall} is negative` };
  if (example.heroStack < 0) return { ok: false, reason: `heroStack ${example.heroStack} is negative` };
  if (example.villainStacks.some((stack) => stack < 0)) {
    return { ok: false, reason: 'a villain stack is negative' };
  }
  // toCall is chips hero adds; the bet hero is facing is already in `pot`.
  if (example.toCall > example.pot) {
    return { ok: false, reason: `toCall ${example.toCall} exceeds pot ${example.pot}` };
  }

  const dealt = dealFromDeck([...example.hole, ...example.board]);
  if ('reason' in dealt) return { ok: false, reason: dealt.reason };

  // Every construction seat needs chips: startHand sits a chipless seat out, which would
  // change who holds the button and where the blinds land.
  const buildStack =
    Math.max(example.heroStack, ...example.villainStacks, example.pot, example.bb) + example.bb * 4;
  const seats = Array.from({ length: TABLE_SEATS }, (_, i) => ({
    name: i === 0 ? 'Hero' : `V${i}`,
    stack: buildStack,
    isHero: i === 0,
  }));

  const heroSeat = 0;
  const dealer = (heroSeat - offset + TABLE_SEATS) % TABLE_SEATS;

  let state: TableState;
  try {
    const fresh = createTable({ seats, sb: example.bb / 2, bb: example.bb, seed: 1 });
    // startHand rotates the button one seat left, so seed it one seat behind the target.
    fresh.dealer = (dealer - 1 + TABLE_SEATS) % TABLE_SEATS;
    state = startHand(fresh);
  } catch (err) {
    return { ok: false, reason: `engine threw on deal: ${String(err)}` };
  }

  if (state.dealer !== dealer) {
    return { ok: false, reason: `button landed on seat ${state.dealer}, wanted ${dealer}` };
  }

  // Cross-check the position mapping against the engine instead of restating it: the blinds
  // must be the seats this module claims they are.
  const seatAt = (o: number): number => (dealer + o) % TABLE_SEATS;
  if (state.seats[seatAt(1)].committed !== example.bb / 2) {
    return { ok: false, reason: 'small blind did not land where the position mapping says' };
  }
  if (state.seats[seatAt(2)].committed !== example.bb) {
    return { ok: false, reason: 'big blind did not land where the position mapping says' };
  }

  // Place the authored snapshot. Seats past the villain count folded earlier in the hand —
  // their chips are already inside `pot`, so they keep no committed amount.
  state.street = example.street;
  state.board = [...example.board];
  state.deck = dealt.rest;
  state.pot = example.pot;
  state.currentBet = example.toCall;
  state.minRaise = example.bb;
  state.toAct = heroSeat;
  state.lastAggressor = example.toCall > 0 ? 1 : null;
  state.seats.forEach((seat, i) => {
    seat.committed = 0;
    seat.folded = i > villainCount;
    seat.allIn = false;
    seat.hole = [];
  });
  state.seats[heroSeat].hole = [...example.hole];
  state.seats[heroSeat].stack = example.heroStack;
  example.villainStacks.forEach((stack, i) => {
    state.seats[i + 1].stack = stack;
  });
  // Whoever bet has their bet in the middle already, which is why it is inside `pot`.
  if (example.toCall > 0) state.seats[1].committed = example.toCall;

  const before = chipTotal(state);
  const legal = legalActions(state);
  const needed: ActionKind =
    example.toCall === 0 ? 'check' : example.heroStack > example.toCall ? 'call' : 'allin';
  if (!legal.includes(needed)) {
    return {
      ok: false,
      reason: `engine offers [${legal.join(', ')}] but the example needs ${needed}`,
    };
  }

  try {
    const after = applyAction(state, { kind: needed });
    if (chipTotal(after) !== before) {
      return { ok: false, reason: `chips changed on ${needed}: ${before} to ${chipTotal(after)}` };
    }
  } catch (err) {
    return { ok: false, reason: `engine threw on ${needed}: ${String(err)}` };
  }

  return { ok: true, state };
}

// ── Prerequisite graph ───────────────────────────────────────────────────────

/** Ids on some prerequisite cycle. Cycles are content bugs even though nothing is gated (N1). */
function cycleMembers(lessons: readonly Lesson[]): string[] {
  const edges = new Map(lessons.map((lesson) => [lesson.id, lesson.prerequisites]));
  const state = new Map<string, 'open' | 'done'>();
  const onCycle = new Set<string>();

  const walk = (id: string, path: string[]): void => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'open') {
      for (const member of path.slice(path.indexOf(id))) onCycle.add(member);
      return;
    }
    state.set(id, 'open');
    for (const next of edges.get(id) ?? []) {
      if (edges.has(next)) walk(next, [...path, id]);
    }
    state.set(id, 'done');
  };

  for (const lesson of lessons) walk(lesson.id, []);
  return [...onCycle];
}

// ── Top level ────────────────────────────────────────────────────────────────

function proseIssues(
  lessonId: string,
  field: keyof typeof PROSE_WORD_LIMITS,
  text: string,
  exampleId?: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const words = countWords(text);
  if (words > PROSE_WORD_LIMITS[field]) {
    issues.push({
      code: 'prose-too-long',
      lessonId,
      exampleId,
      field,
      detail: `${words} words, limit ${PROSE_WORD_LIMITS[field]}`,
    });
  }
  if (words === 0) {
    issues.push({ code: 'prose-shape', lessonId, exampleId, field, detail: 'empty' });
  }
  for (const phrase of bannedPhrasesIn(text)) {
    issues.push({ code: 'banned-phrase', lessonId, exampleId, field, detail: phrase });
  }
  return issues;
}

export function validateLesson(lesson: Lesson): ValidationIssue[] {
  const issues: ValidationIssue[] = [
    ...proseIssues(lesson.id, 'title', lesson.title),
    ...proseIssues(lesson.id, 'mechanism', lesson.mechanism),
  ];

  if (LEADING_PRONOUN.test(lesson.mechanism)) {
    issues.push({
      code: 'prose-shape',
      lessonId: lesson.id,
      field: 'mechanism',
      detail: 'opens on the learner, not the task',
    });
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(lesson.id)) {
    issues.push({
      code: 'prose-shape',
      lessonId: lesson.id,
      field: 'id',
      detail: 'not kebab-case',
    });
  }

  if (lesson.examples.length === 0) {
    issues.push({ code: 'empty-lesson', lessonId: lesson.id, detail: 'no examples' });
  }
  if (lesson.acceptanceKeywords.length === 0) {
    issues.push({
      code: 'empty-lesson',
      lessonId: lesson.id,
      field: 'acceptanceKeywords',
      detail: 'no keywords, so L2 has no fallback check',
    });
  }
  if (lesson.prerequisites.includes(lesson.id)) {
    issues.push({
      code: 'self-prerequisite',
      lessonId: lesson.id,
      detail: 'lesson requires itself',
    });
  }

  const seenExampleIds = new Set<string>();
  for (const example of lesson.examples) {
    if (seenExampleIds.has(example.id)) {
      issues.push({
        code: 'duplicate-example-id',
        lessonId: lesson.id,
        exampleId: example.id,
        detail: 'example id used twice in this lesson',
      });
    }
    seenExampleIds.add(example.id);

    issues.push(...proseIssues(lesson.id, 'prompt', example.prompt, example.id));
    issues.push(...proseIssues(lesson.id, 'reasoning', example.reasoning, example.id));

    if (!example.prompt.trim().endsWith('?')) {
      issues.push({
        code: 'prose-shape',
        lessonId: lesson.id,
        exampleId: example.id,
        field: 'prompt',
        detail: 'prompt must be a question, so the learner commits first (G5)',
      });
    }

    const chunks = sentenceChunks(example.reasoning);
    if (chunks.length !== REASONING_CHUNKS) {
      issues.push({
        code: 'prose-shape',
        lessonId: lesson.id,
        exampleId: example.id,
        field: 'reasoning',
        detail: `${chunks.length} chunks, G6 wants ${REASONING_CHUNKS}`,
      });
    }
    if (LEADING_PRONOUN.test(example.reasoning)) {
      issues.push({
        code: 'prose-shape',
        lessonId: lesson.id,
        exampleId: example.id,
        field: 'reasoning',
        detail: 'opens on the learner, not the task',
      });
    }

    const built = tryBuildExample(example);
    if (!built.ok) {
      issues.push({
        code: 'unbuildable-example',
        lessonId: lesson.id,
        exampleId: example.id,
        detail: built.reason,
      });
    }
  }

  return issues;
}

export function validateLessons(lessons: readonly Lesson[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const known = new Set(lessons.map((lesson) => lesson.id));

  const seen = new Set<string>();
  for (const lesson of lessons) {
    if (seen.has(lesson.id)) {
      issues.push({
        code: 'duplicate-lesson-id',
        lessonId: lesson.id,
        detail: 'id registered twice',
      });
    }
    seen.add(lesson.id);
  }

  for (const lesson of lessons) {
    for (const prerequisite of lesson.prerequisites) {
      if (!known.has(prerequisite)) {
        issues.push({
          code: 'unknown-prerequisite',
          lessonId: lesson.id,
          field: 'prerequisites',
          detail: `no lesson named "${prerequisite}"`,
        });
      }
    }
    issues.push(...validateLesson(lesson));
  }

  for (const id of cycleMembers(lessons)) {
    issues.push({
      code: 'prerequisite-cycle',
      lessonId: id,
      field: 'prerequisites',
      detail: 'prerequisites form a cycle',
    });
  }

  return issues;
}

/** For a test or a startup assertion: one readable line per issue. */
export function formatIssues(issues: readonly ValidationIssue[]): string {
  return issues
    .map((issue) => {
      const where = [issue.lessonId, issue.exampleId, issue.field].filter(Boolean).join('/');
      return `${issue.code} at ${where}: ${issue.detail}`;
    })
    .join('\n');
}
