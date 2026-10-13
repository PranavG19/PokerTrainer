import { describe, expect, it } from 'vitest';
import type { DayKey } from '../../src/core/localDay.js';
import { defaultProgression, effectiveResult } from '../../src/core/progression/persist.js';
import { RIVALS, VENUES, rivalDisplayName, venueById, type Venue } from '../../src/core/story/cast.js';
import {
  GOAL_FREE_SHARE,
  GOAL_MIN_JUDGED,
  chapterOf,
  debriefLine,
  introLines,
  isJudged,
  isUnmasked,
  judgeTable,
  logChoice,
  markIntroSeen,
  markLessonDone,
  recordTable,
  resumeStage,
  storyLine,
} from '../../src/core/story/campaign.js';
import type { LoggedDecision } from '../../src/core/story/route.js';

const day = 20200 as DayKey;
const opts = { tone: 'warm' as const, seed: 9, character: true };
const d = (street: LoggedDecision['street'], toCall: number, severity: 'free' | 'notable' | 'serious', action = 'call', principle: string | null = severity === 'free' ? null : 'pot odds'): LoggedDecision => ({
  street,
  toCall,
  action,
  verdict: { severity, evLossBb: severity === 'free' ? 0 : severity === 'notable' ? 1 : 3, principle },
});
const library = venueById('library') as Venue;
const lighthouse = venueById('lighthouse') as Venue;

describe('the cast', () => {
  it('six venues, six rivals, one per archetype', () => {
    expect(VENUES).toHaveLength(6);
    expect(new Set(VENUES.map((v) => RIVALS[v.rival].archetype)).size).toBe(6);
    expect(VENUES[VENUES.length - 1].id).toBe('observatory');
  });

  it('a masked rival is the venue’s regular; unmasked, their name', () => {
    expect(rivalDisplayName(library, false)).toBe('The Library’s regular');
    expect(rivalDisplayName(library, true)).toBe('Percival');
  });
});

describe('the goal is decision quality, never chips', () => {
  it('judges only decisions with something at stake: postflop, priced or late', () => {
    expect(isJudged({ street: 'preflop', toCall: 50 })).toBe(false);
    expect(isJudged({ street: 'flop', toCall: 0 })).toBe(false);
    expect(isJudged({ street: 'flop', toCall: 40 })).toBe(true);
    expect(isJudged({ street: 'river', toCall: 0 })).toBe(true);
  });

  it(`met: at least ${GOAL_MIN_JUDGED} judged, ${GOAL_FREE_SHARE * 100}% free, no serious mistake of the rival’s kind`, () => {
    const met = judgeTable([d('flop', 50, 'free'), d('turn', 0, 'free', 'check'), d('river', 50, 'free'), d('river', 50, 'notable')], lighthouse);
    expect(met).toEqual({ judged: 4, free: 3, serious: 0, focusSerious: 0, result: 'met' });
  });

  it('short: a serious call over the price at the Lighthouse fails the goal even at three in four', () => {
    const j = judgeTable([d('flop', 50, 'free'), d('turn', 50, 'free'), d('river', 50, 'free'), d('river', 50, 'serious')], lighthouse);
    expect(j).toMatchObject({ judged: 4, free: 3, focusSerious: 1, result: 'short' });
    // The same serious call is not the Library's focus, so there it is only counted.
    expect(judgeTable([d('flop', 50, 'free'), d('turn', 50, 'free'), d('river', 50, 'free'), d('river', 50, 'serious')], library).result).toBe('met');
  });

  it('unjudged: too few decisions with something at stake (folding every hand preflop proves nothing)', () => {
    const j = judgeTable([d('preflop', 50, 'free', 'fold'), d('preflop', 50, 'free', 'fold'), d('flop', 0, 'free', 'check'), d('flop', 40, 'free')], library);
    expect(j).toMatchObject({ judged: 1, result: 'unjudged' });
  });
});

describe('chapter progress', () => {
  it('nothing is locked: any chapter starts at its intro, and the stage only suggests where to pick up', () => {
    let s = defaultProgression().story;
    expect(resumeStage(chapterOf(s, 'pier'))).toBe('intro');
    s = markIntroSeen(s, 'pier');
    expect(resumeStage(chapterOf(s, 'pier'))).toBe('lesson');
    s = markLessonDone(s, 'pier');
    expect(resumeStage(chapterOf(s, 'pier'))).toBe('table');
  });

  it('meeting the goal takes the mask off, once; a later short table never puts it back', () => {
    let s = defaultProgression().story;
    s = recordTable(s, library, { judged: 4, free: 2, serious: 1, focusSerious: 0, result: 'short' }, day);
    expect(isUnmasked(s, library)).toBe(false);
    s = recordTable(s, library, { judged: 4, free: 4, serious: 0, focusSerious: 0, result: 'met' }, (day + 1) as DayKey);
    expect(isUnmasked(s, library)).toBe(true);
    s = recordTable(s, library, { judged: 4, free: 1, serious: 2, focusSerious: 0, result: 'short' }, (day + 2) as DayKey);
    const p = chapterOf(s, 'library');
    expect(p).toMatchObject({ tables: 3, beatenOn: day + 1, lastResult: 'short' });
    expect(effectiveResult(p)).toBe('short');
    expect(s.rivals.percival.sittings.map((x) => x.free)).toEqual([2, 4, 1]);
  });

  it('choosing a chapter other than the suggested one is logged, never refused', () => {
    let s = defaultProgression().story;
    s = logChoice(s, 'lighthouse', 'lighthouse', day);
    expect(s.overrides).toEqual([]);
    s = logChoice(s, 'lighthouse', 'pier', day);
    expect(s.overrides).toEqual([{ day, suggested: 'lighthouse', chosen: 'pier' }]);
  });
});

describe('Dee’s story lines', () => {
  it('the intro names the masked regular, and a personalized chapter names what it was built from', () => {
    const lines = introLines(library, false, 'free-fold', 'folding when checking was free', opts);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.lineId)).toEqual(expect.arrayContaining([expect.stringMatching(/^story\.personal\./)]));
    expect(lines.some((l) => l.text.includes('folding when checking was free'))).toBe(true);
    expect(lines.every((l) => !l.text.includes('Percival'))).toBe(true);
  });

  it('is seeded: the same seed says the same words', () => {
    expect(introLines(library, true, null, null, opts)).toEqual(introLines(library, true, null, null, opts));
  });

  it('the debrief says the engine’s counts and, when met, the name', () => {
    const met = debriefLine(library, { judged: 5, free: 4, serious: 0, focusSerious: 0, result: 'met' }, false, opts)!;
    expect(met.text).toContain('4 of 5');
    expect(met.text).toContain('Percival');
    expect(debriefLine(library, { judged: 5, free: 2, serious: 1, focusSerious: 0, result: 'short' }, false, opts)!.text).toContain('2 of 5');
    expect(debriefLine(library, { judged: 1, free: 1, serious: 0, focusSerious: 0, result: 'unjudged' }, false, opts)!.lineId).toBe('story.unjudged.a');
  });

  it('Character off: Dee says nothing of its own', () => {
    expect(storyLine('take-none', {}, { ...opts, character: false })).toBeNull();
    expect(introLines(library, false, null, null, { ...opts, character: false })).toEqual([]);
  });

  it('a line whose slot has no fact is skipped, so Dee never says a sentence with a hole in it', () => {
    expect(storyLine('debrief-met', {}, opts)).toBeNull();
  });
});
