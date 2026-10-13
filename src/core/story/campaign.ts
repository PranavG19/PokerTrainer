/**
 * The campaign engine: a chapter's beats, its goal, and what finishing a table writes to the profile.
 *
 * A chapter runs: Dee's intro (story lines) → a lesson-dialogue beat (the dee/dialogue.ts engine, over the
 * chapter's script and its lesson's example) → a seeded table heads-up against the rival → a debrief. Every
 * beat can be skipped or replayed and every chapter entered at any time (N1): the stage is a suggestion of
 * where to pick up, never a gate.
 *
 * THE GOAL IS DECISION QUALITY, NEVER CHIPS. A table is judged on the learner's graded decisions where
 * something was at stake: postflop, facing a bet or on the turn or river (a free flop check is not a
 * decision worth judging). It is met with at least GOAL_MIN_JUDGED such decisions, GOAL_FREE_SHARE of them
 * costing nothing, and no serious mistake of a kind the venue's rival exists to punish. Meeting it takes the
 * rival's mask off (a ratchet). Chips won or lost appear nowhere in it.
 *
 * Pure: state in, new state out. Days come from the caller (localDay.ts).
 */

import { mulberry32 } from '../rng.js';
import { renderLine } from '../dee/engine.js';
import type { Facts, Tone } from '../dee/types.js';
import type { DayKey } from '../localDay.js';
import { MAX_STORY_OVERRIDES } from '../progression/persist.js';
import type { ChapterProgress, ChapterResult, RivalRecord, StoryState } from '../progression/types.js';
import { rivalDisplayName, rivalOf, type ChapterId, type LeakKind, type Venue } from './cast.js';
import { emptyRivalRecord, recordRivalHand, recordRivalSitting, type RivalHand } from './dossier.js';
import { leakKindOf, type LoggedDecision } from './route.js';
import { STORY_LINES, type StoryEvent, type StoryFacts, type StoryLine } from './scripts.js';

/** Hands at a chapter table. */
export const STORY_TABLE_HANDS = 6;
export const GOAL_MIN_JUDGED = 3;
/** Three in four judged decisions cost nothing. */
export const GOAL_FREE_SHARE = 0.75;

export const STAGES = ['intro', 'lesson', 'table', 'debrief'] as const;
export type Stage = (typeof STAGES)[number];

export function emptyChapter(): ChapterProgress {
  return { introSeen: false, lessonDone: false, tables: 0, lastResult: null, beatenOn: null };
}

export function chapterOf(story: StoryState, id: ChapterId): ChapterProgress {
  return story.chapters[id] ?? emptyChapter();
}

export function rivalRecordOf(story: StoryState, venue: Venue): RivalRecord {
  return story.rivals[venue.rival] ?? emptyRivalRecord();
}

export function isUnmasked(story: StoryState, venue: Venue): boolean {
  return chapterOf(story, venue.id).beatenOn !== null;
}

/** Where a chapter picks up: the first beat not yet done, or the table again once one has been played. */
export function resumeStage(p: ChapterProgress): Stage {
  if (!p.introSeen) return 'intro';
  if (!p.lessonDone) return 'lesson';
  return 'table';
}

/** A decision the goal judges: postflop, with a bet faced or on a late street. */
export function isJudged(d: Pick<LoggedDecision, 'street' | 'toCall'>): boolean {
  if (d.street === 'preflop' || d.street === 'showdown') return false;
  return d.toCall > 0 || d.street === 'turn' || d.street === 'river';
}

export interface TableJudgement {
  readonly judged: number;
  readonly free: number;
  readonly serious: number;
  /** Serious mistakes of a kind the rival punishes (the venue's targets). */
  readonly focusSerious: number;
  readonly result: ChapterResult;
}

export function judgeTable(decisions: readonly LoggedDecision[], venue: Pick<Venue, 'targets'>): TableJudgement {
  let judged = 0;
  let free = 0;
  let serious = 0;
  let focusSerious = 0;
  for (const d of decisions) {
    if (!isJudged(d) || d.verdict === null) continue;
    judged++;
    if (d.verdict.severity === 'free') free++;
    if (d.verdict.severity === 'serious') {
      serious++;
      const kind = leakKindOf(d);
      if (kind !== null && venue.targets.includes(kind)) focusSerious++;
    }
  }
  const result: ChapterResult =
    judged < GOAL_MIN_JUDGED ? 'unjudged' : free / judged >= GOAL_FREE_SHARE && focusSerious === 0 ? 'met' : 'short';
  return { judged, free, serious, focusSerious, result };
}

// ── state updates ───────────────────────────────────────────────────────────────────────────────────

function withChapter(story: StoryState, id: ChapterId, change: (p: ChapterProgress) => ChapterProgress): StoryState {
  return { ...story, chapters: { ...story.chapters, [id]: change(chapterOf(story, id)) } };
}

export function markIntroSeen(story: StoryState, id: ChapterId): StoryState {
  return withChapter(story, id, (p) => (p.introSeen ? p : { ...p, introSeen: true }));
}

export function markLessonDone(story: StoryState, id: ChapterId): StoryState {
  return withChapter(story, id, (p) => (p.lessonDone ? p : { ...p, introSeen: true, lessonDone: true }));
}

/** N1: choosing a chapter other than the suggested one is logged, never refused. */
export function logChoice(story: StoryState, suggested: ChapterId, chosen: ChapterId, day: DayKey): StoryState {
  if (suggested === chosen) return story;
  return { ...story, overrides: [...story.overrides, { day, suggested, chosen }].slice(-MAX_STORY_OVERRIDES) };
}

/** One hand at the chapter table, into the rival's file (showdown-only reads: dossier.ts). */
export function recordStoryHand(story: StoryState, venue: Venue, hand: RivalHand, day: DayKey): StoryState {
  const record = recordRivalHand(rivalRecordOf(story, venue), hand, day);
  return { ...story, rivals: { ...story.rivals, [venue.rival]: record } };
}

/** A finished table: the sitting into the rival's file, the result onto the chapter, the mask off if met. */
export function recordTable(story: StoryState, venue: Venue, judgement: TableJudgement, day: DayKey): StoryState {
  const record = recordRivalSitting(rivalRecordOf(story, venue), {
    day,
    chapter: venue.id,
    judged: judgement.judged,
    free: judgement.free,
    serious: judgement.serious,
  });
  const next = withChapter(story, venue.id, (p) => ({
    ...p,
    introSeen: true,
    tables: p.tables + 1,
    lastResult: judgement.result,
    beatenOn: p.beatenOn ?? (judgement.result === 'met' ? day : null),
  }));
  return { ...next, rivals: { ...next.rivals, [venue.rival]: record } };
}

// ── Dee's story lines ──────────────────────────────────────────────────────────────────────────────

export interface SpokenStoryLine {
  readonly lineId: string;
  readonly pose: StoryLine['pose'];
  readonly text: string;
}

/**
 * One line for a story moment, or null. Seeded, so a replay says the same words; a line whose slot has no
 * fact is skipped (renderLine), so Dee never says a sentence with a hole in it. Character off: silence.
 */
export function storyLine(
  event: StoryEvent,
  facts: StoryFacts,
  opts: { tone: Tone; seed: number; character: boolean; venue?: ChapterId },
  bank: readonly StoryLine[] = STORY_LINES,
): SpokenStoryLine | null {
  if (!opts.character) return null;
  const eligible: SpokenStoryLine[] = [];
  for (const line of bank) {
    if (line.event !== event || (line.venue !== undefined && line.venue !== opts.venue)) continue;
    const template = (opts.tone === 'dry' ? line.dry : opts.tone === 'blunt' ? line.blunt : undefined) ?? line.text;
    const text = renderLine(template, facts as Facts);
    if (text !== null) eligible.push({ lineId: line.id, pose: line.pose, text });
  }
  if (eligible.length === 0) return null;
  return eligible[Math.floor(mulberry32(opts.seed >>> 0)() * eligible.length)];
}

/** The intro: the venue's own line, then (personalized) the line naming what the chapter was built from. */
export function introLines(
  venue: Venue,
  unmasked: boolean,
  focus: LeakKind | null,
  focusLabel: string | null,
  opts: { tone: Tone; seed: number; character: boolean },
): SpokenStoryLine[] {
  const facts: StoryFacts = { rival: rivalDisplayName(venue, unmasked) };
  const out: SpokenStoryLine[] = [];
  const own = storyLine('intro', facts, { ...opts, venue: venue.id });
  if (own) out.push(own);
  if (focus !== null && focusLabel !== null) {
    const personal = storyLine('intro-personal', { focus: focusLabel }, { ...opts, seed: opts.seed + 1 });
    if (personal) out.push(personal);
  }
  return out;
}

/** The debrief line for a judged table, with the counts it may say. */
export function debriefLine(
  venue: Venue,
  judgement: TableJudgement,
  wasUnmasked: boolean,
  opts: { tone: Tone; seed: number; character: boolean },
): SpokenStoryLine | null {
  const facts: StoryFacts = { judged: String(judgement.judged), free: String(judgement.free), rival: rivalOf(venue).short };
  const event: StoryEvent =
    judgement.result === 'unjudged'
      ? 'debrief-unjudged'
      : judgement.result === 'short'
        ? 'debrief-short'
        : wasUnmasked
          ? 'debrief-met-again'
          : 'debrief-met';
  return storyLine(event, facts, opts);
}
