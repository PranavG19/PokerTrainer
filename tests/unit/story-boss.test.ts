import { describe, expect, it } from 'vitest';
import { ARCHETYPE_NAMES, type ArchetypeName } from '../../src/core/archetypes.js';
import type { DayKey } from '../../src/core/localDay.js';
import { defaultProgression } from '../../src/core/progression/persist.js';
import {
  BOSS_HANDS,
  answerBoss,
  bossFor,
  bossRecordOf,
  handOver,
  isClean,
  optionsAt,
  pendingAsk,
  recordBoss,
  startBoss,
  type BossAsk,
  type BossRun,
} from '../../src/core/story/boss.js';
import { KITCHEN, RIVALS, VENUES } from '../../src/core/story/cast.js';
import { stackedDeck } from '../../src/core/puzzle.js';
import { scenarioOf } from '../../src/core/story/boss.js';

/**
 * Boss hands: every one plays through the REAL engine (each scripted move legal at the seat it lands on, the line
 * reaching the end of the hand), every ask offers at least two actions with a question back for each wrong one, and
 * the right line at each rival's hand is that rival's exploit.
 */

const day = (n: number): DayKey => n as DayKey;

function playRight(run: BossRun): BossRun {
  let r = run;
  for (let guard = 0; guard < 20 && !r.done; guard++) {
    const p = pendingAsk(r);
    if (!p) break;
    r = answerBoss(r, p.ask.correct);
  }
  return r;
}

const asksOf = (id: string): BossAsk[] =>
  (BOSS_HANDS.find((b) => b.id === id)?.moves ?? []).flatMap((m) => (m.who === 'ask' ? [m.ask] : []));

/** What each style's exploit asks of the learner at its boss hand (archetypes.ts ARCHETYPE_EXPLOITS). */
const EXPLOIT: Readonly<Record<ArchetypeName, readonly string[]>> = {
  nit: ['fold'], // when it bets, it has it
  station: ['bet'], // value bet thin, never bluff
  'over-folder': ['bet'], // bet: it gives up too easily
  lag: ['call'], // widen and let it barrel
  maniac: ['call'], // trap and call down; never raise
  'tag-reg': ['call'], // the standard line: the price decides
};

describe('boss hands', () => {
  it('there is one for the Kitchen Table and one per venue, each id unique', () => {
    expect(bossFor(KITCHEN.id)).toBeDefined();
    for (const v of VENUES) expect(bossFor(v.id), v.id).toBeDefined();
    expect(new Set(BOSS_HANDS.map((b) => b.id)).size).toBe(BOSS_HANDS.length);
    expect(BOSS_HANDS).toHaveLength(VENUES.length + 1);
  });

  it.each(BOSS_HANDS.map((b) => [b.id, b] as const))('%s: the engine deals exactly the fixed cards and plays the whole line', (_id, boss) => {
    const run = startBoss(boss);
    expect(run.state.seats[0].hole).toEqual([...boss.hero]);
    expect(run.state.seats[1].hole).toEqual([...boss.rival]);
    const end = playRight(run);
    expect(end.done).toBe(true);
    expect(handOver(end), 'the line plays to the end of the hand').toBe(true);
    expect(isClean(end)).toBe(true);
    // Every board card the hand reached is the scripted one.
    expect(end.state.board).toEqual(boss.board.slice(0, end.state.board.length));
    expect(stackedDeck(scenarioOf(boss)).length).toBeGreaterThan(0);
  });

  it.each(BOSS_HANDS.map((b) => [b.id, b] as const))('%s: every ask offers a choice, and every wrong one has a question back', (_id, boss) => {
    let run = startBoss(boss);
    let asks = 0;
    for (let guard = 0; guard < 20 && !run.done; guard++) {
      const p = pendingAsk(run);
      if (!p) break;
      asks++;
      const kinds = optionsAt(run.state);
      expect(kinds.length, `${p.ask.id} options`).toBeGreaterThanOrEqual(2);
      expect(kinds).toContain(p.ask.correct);
      for (const k of kinds) if (k !== p.ask.correct) expect(p.ask.back[k], `${p.ask.id}: a question back for ${k}`).toBeDefined();
      run = answerBoss(run, p.ask.correct);
    }
    expect(asks).toBe(asksOf(boss.id).length);
    expect(asks).toBeGreaterThanOrEqual(1);
  });

  it('the right line at each rival’s hand is that rival’s exploit', () => {
    for (const v of VENUES) {
      const archetype = RIVALS[v.rival].archetype;
      const kinds = [...new Set(asksOf(bossFor(v.id)!.id).map((a) => a.correct))];
      expect(kinds, `${v.id} (${archetype})`).toEqual(EXPLOIT[archetype]);
    }
    expect(Object.keys(EXPLOIT).sort()).toEqual([...ARCHETYPE_NAMES].sort());
  });

  it('a wrong answer gets a question back, the hand waits, and the hand is no longer clean', () => {
    const boss = bossFor('lighthouse')!;
    const run = startBoss(boss);
    const wrong = answerBoss(run, 'call');
    expect(wrong.at).toBe(run.at);
    expect(wrong.state).toBe(run.state);
    expect(wrong.replies.at(-1)).toMatchObject({ right: false });
    expect(wrong.replies.at(-1)!.text.trim().endsWith('?')).toBe(true);
    expect(pendingAsk(wrong)!.options.find((o) => o.kind === 'call')!.tried).toBe(true);
    // The same wrong answer twice changes nothing.
    expect(answerBoss(wrong, 'call')).toBe(wrong);
    const end = playRight(wrong);
    expect(end.done).toBe(true);
    expect(isClean(end)).toBe(false);
  });

  it('the record counts attempts and keeps the first clean day (a ratchet)', () => {
    let story = defaultProgression().story;
    story = recordBoss(story, 'boss-diner', false, day(10));
    expect(bossRecordOf(story, 'boss-diner')).toEqual({ attempts: 1, cleanOn: null });
    story = recordBoss(story, 'boss-diner', true, day(11));
    story = recordBoss(story, 'boss-diner', false, day(12));
    expect(bossRecordOf(story, 'boss-diner')).toEqual({ attempts: 3, cleanOn: day(11) });
  });

  it('a pending ask fills its numbers from the engine: the template never states one', () => {
    for (const boss of BOSS_HANDS) {
      let run = startBoss(boss);
      for (let guard = 0; guard < 20 && !run.done; guard++) {
        const p = pendingAsk(run);
        if (!p) break;
        expect(p.text, `${boss.id}.${p.ask.id}`).not.toMatch(/\{/);
        expect(/\d/.test(p.ask.ask)).toBe(false);
        run = answerBoss(run, p.ask.correct);
      }
    }
  });
});
