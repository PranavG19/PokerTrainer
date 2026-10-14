/**
 * THE PROGRESSION HOST'S ONE PATH: diff → award → save.
 *
 * Every save of the profile passes the session as it was last saved (`prev`) and as it is now (`next`) through
 * `applyProgress`. What changed between them is the only thing that can pay: new hands, new graded drill reps, new
 * rule sentences, new assessment blocks, new perception responses. A save that changed nothing pays nothing, and a
 * replay of the same change pays once (each award is keyed, reps.ts). The few facts a save cannot see are passed
 * as `extras` by the screen that saw them: a puzzle spot finished, a "Price held" beat (the grader's close band does
 * not persist), a story table ended, the one suggestion taken, a Folio card re-polished.
 *
 * From the same diff it advances the Ticket, counts the streak day when a session finished, and files Seals and
 * milestones. Pure: the caller passes the clock and the day function.
 */

import type { DayKey, DayKeyOf } from '../localDay.js';
import type { SessionState } from '../session.js';
import { conceptStatesFromLog, dueNow, gate, nextDue, type ConceptState } from '../schedule.js';
import type { Scenario } from '../puzzle.js';
import { puzzleCoverage } from '../standing.js';
import { currentStreakOn } from './persist.js';
import { award, keys, repsForDrillRep, repsForHand, repsForRule, repsForSpot, REPS_ASSESSMENT, REPS_PER_PERCEPTION } from './reps.js';
import { countFinished, handsMakeASession, handsOn, type FinishedSession } from './streak.js';
import { syncSeals } from './seals.js';
import { syncMilestones, type MilestoneFacts } from './milestones.js';
import { markDone, ticketFor } from '../ticket.js';
import { polish } from '../folio.js';
import type { ProgressionState } from './types.js';

/** Perception answers in one visit that finish the Ticket's drill item (about the warm-up block's length). */
export const DRILL_ANSWERS = 10;

export interface ProgressExtras {
  /** A puzzle spot finished, with the steps played right. */
  readonly spot?: { readonly id: string; readonly correct: number };
  /** "Price held" beats in the hand just finished (grader's close band). */
  readonly priceHeld?: number;
  /** A story table was played to its end. */
  readonly storyTableEnded?: boolean;
  /** The one suggestion was taken. */
  readonly suggestionTaken?: boolean;
  /** Sight answers so far this visit (Speed's are read from the persisted awards). */
  readonly perception?: { readonly mode: string; readonly answered: number };
  /** Folio cards re-polished. */
  readonly polished?: readonly string[];
  /** Today's greeting, so it holds all day and tomorrow avoids it. */
  readonly greeting?: { readonly lineId: string };
}

export interface ApplyContext {
  readonly now: number;
  readonly dayOf: DayKeyOf;
  readonly scenarios: readonly Scenario[];
  /** The costliest leak's principle, for the Ticket's spots. */
  readonly leakPrinciple: string | null;
}

export interface Applied {
  readonly progression: ProgressionState;
  /** Sessions that finished in this diff (for a moment on screen; already counted). */
  readonly finished: readonly FinishedSession[];
  /** Reps paid by this diff. */
  readonly paid: number;
}

function gradedConcepts(s: SessionState): ConceptState[] {
  return conceptStatesFromLog(s.fadingLog.filter((e) => e.kind === 'graded'));
}

export function masteredIds(concepts: readonly ConceptState[], now: number): string[] {
  return concepts.filter((c) => gate(c, now).status === 'mastered').map((c) => c.id);
}

export function applyProgress(prev: SessionState, next: SessionState, extras: ProgressExtras, ctx: ApplyContext): Applied {
  const today: DayKey = ctx.dayOf(ctx.now);
  let p = next.progression;
  let r = p.reps;
  const finished: FinishedSession[] = [];

  // ── Reps from the diff ──
  const priorHands = new Set(prev.hands.map((h) => h.playedAt).filter((t): t is number => typeof t === 'number'));
  for (const h of next.hands) {
    if (typeof h.playedAt !== 'number' || priorHands.has(h.playedAt)) continue;
    const effort = (h.decisions ?? []).map((d) => ({ graded: d.verdict !== null, gateAttempts: d.gateAttempts }));
    r = award(r, keys.hand(h.playedAt), repsForHand(effort), ctx.dayOf(h.playedAt));
  }

  const before = gradedConcepts(prev);
  const priorReps = new Set(prev.fadingLog.filter((e) => e.kind === 'graded').map((e) => `${e.at}:${e.conceptId}`));
  for (const e of next.fadingLog) {
    if (e.kind !== 'graded' || priorReps.has(`${e.at}:${e.conceptId}`)) continue;
    const state = before.find((c) => c.id === e.conceptId);
    const masteredNotDue = state !== undefined && gate(state, e.at).status === 'mastered' && nextDue(state, e.at) === null;
    r = award(r, keys.drill(e.conceptId, e.at), repsForDrillRep(masteredNotDue), ctx.dayOf(e.at));
  }

  const priorAttempts = new Set(prev.lexicon.map((a) => `${a.at}:${a.conceptId}`));
  const ruleDaysNew: DayKey[] = [];
  for (const a of next.lexicon) {
    if (priorAttempts.has(`${a.at}:${a.conceptId}`)) continue;
    r = award(r, keys.rule(a.conceptId, a.at), repsForRule(a.outcome === 'accepted'), ctx.dayOf(a.at));
    ruleDaysNew.push(ctx.dayOf(a.at));
  }
  const priorRules = new Set(prev.progression.dee.ruleSentences.map((s) => `${s.day}:${s.conceptId}:${s.text}`));
  for (const s of next.progression.dee.ruleSentences) {
    if (priorRules.has(`${s.day}:${s.conceptId}:${s.text}`)) continue;
    r = award(r, `lesson-rule:${s.day}:${s.conceptId}`.slice(0, 64), repsForRule(true), s.day);
  }

  const priorBlocks = new Set(prev.assessments.map((a) => a.at));
  const newBlocks = [...new Set(next.assessments.map((a) => a.at).filter((at) => !priorBlocks.has(at)))];
  for (const at of newBlocks) r = award(r, keys.assessment(at), REPS_ASSESSMENT, ctx.dayOf(at));
  if (newBlocks.length > 0) finished.push('assessment');

  const speedDelta = next.anomalyTally.attempts - prev.anomalyTally.attempts;
  if (speedDelta > 0) r = award(r, keys.perception(today, next.anomalyTally.attempts), speedDelta * REPS_PER_PERCEPTION, today);

  if (extras.spot) r = award(r, keys.spot(extras.spot.id, today), repsForSpot(extras.spot.correct), today);

  p = { ...p, reps: r };

  // ── Tallies, Folio, greeting ──
  let tallies = p.tallies;
  if (extras.priceHeld && extras.priceHeld > 0) tallies = { ...tallies, priceHeld: tallies.priceHeld + Math.floor(extras.priceHeld) };
  if (extras.suggestionTaken) tallies = { ...tallies, suggestionTakenOn: today };
  let folio = p.folio;
  for (const id of extras.polished ?? []) folio = polish(folio, id, ctx.now);
  let dee = p.dee;
  if (extras.greeting && (dee.lastGreeting?.day !== today || dee.lastGreeting.lineId !== extras.greeting.lineId)) {
    dee = { ...dee, lastGreeting: { day: today, lineId: extras.greeting.lineId } };
  }

  // ── The Ticket ──
  // Built (when today's is not frozen yet) from the state BEFORE this save: that is the Ticket Home showed, and the
  // work in this very save is the work on one of its items. Built from after, a spot just solved clean or a concept
  // just reviewed would drop off instead of being ticked.
  const concepts = gradedConcepts(next);
  let ticket = ticketFor(p.ticket, {
    day: today,
    now: ctx.now,
    concepts: before,
    leakPrinciple: ctx.leakPrinciple,
    scenarios: ctx.scenarios,
    puzzleProgress: prev.puzzleProgress,
  });
  const wasFinished = ticket.finishedOn === today;
  const dueIds = new Set(dueNow(concepts, ctx.now).map((d) => d.conceptId));
  const repsToday = new Set(
    next.fadingLog.filter((e) => e.kind === 'graded' && ctx.dayOf(e.at) === today).map((e) => e.conceptId),
  );
  // Speed answers are persisted (each save's tally delta is a keyed award), so today's count survives a relaunch.
  const speedToday = r.awards.filter((a) => a.key.startsWith(`speed:${today}:`)).reduce((n, a) => n + a.reps, 0) / REPS_PER_PERCEPTION;
  for (const item of ticket.items) {
    if (ticket.done.includes(item.id)) continue;
    const answered = item.ref === 'anomaly' ? speedToday : extras.perception?.mode === item.ref ? extras.perception.answered : 0;
    const done =
      (item.kind === 'review' && repsToday.has(item.ref) && !dueIds.has(item.ref)) ||
      (item.kind === 'spot' && extras.spot?.id === item.ref) ||
      (item.kind === 'drill' && answered >= DRILL_ANSWERS);
    if (done) ticket = markDone(ticket, item.id, today);
  }
  if (!wasFinished && ticket.finishedOn === today) {
    finished.push('ticket');
    tallies = { ...tallies, ticketsFinished: tallies.ticketsFinished + 1 };
  }

  // ── The streak ──
  if (extras.storyTableEnded) finished.push('story-table');
  const handsToday = handsOn(next.hands, today, ctx.dayOf);
  if (handsMakeASession(handsToday) && !handsMakeASession(handsOn(prev.hands, today, ctx.dayOf))) finished.push('table-hands');
  let streak = p.streak;
  for (const f of finished) streak = countFinished(streak, f, today);

  p = { ...p, tallies, folio, dee, ticket, streak };

  // ── Seals and milestones ──
  const mastered = masteredIds(concepts, ctx.now);
  const seals = syncSeals(p.seals, mastered, today);
  const facts = milestoneFacts(next, p, ctx.scenarios, mastered.length);
  const milestones = syncMilestones(p.milestones, facts, today);
  p = { ...p, seals, milestones };

  return { progression: p, finished, paid: r.total - next.progression.reps.total };
}

/** The milestone facts from the profile: process facts only. */
export function milestoneFacts(s: SessionState, p: ProgressionState, scenarios: readonly Scenario[], conceptsMastered: number): MilestoneFacts {
  const steps = Object.fromEntries(scenarios.map((x) => [x.id, x.target.length]));
  const ruleConcepts = new Set([
    ...s.lexicon.filter((a) => a.outcome === 'accepted').map((a) => a.conceptId),
    ...p.dee.ruleSentences.map((r) => r.conceptId),
  ]);
  return {
    depthFloor: s.depthFloor,
    conceptsMastered,
    puzzlesSolvedClean: puzzleCoverage(s.puzzleProgress, steps),
    assessmentsTaken: new Set(s.assessments.map((a) => a.at)).size,
    rulesInYourWords: ruleConcepts.size,
    bestStreak: p.streak.best,
    priceHeld: p.tallies.priceHeld,
    ticketsFinished: p.tallies.ticketsFinished,
    sureTotal: s.calibration.sureTotal,
    sureRight: s.calibration.sureCorrect,
  };
}

/** The streak as read today, and whether today already counts. */
export function streakToday(p: ProgressionState, today: DayKey): { current: number; best: number; countedToday: boolean } {
  return { current: currentStreakOn(p.streak, today), best: p.streak.best, countedToday: p.streak.lastCountedDay === today };
}
