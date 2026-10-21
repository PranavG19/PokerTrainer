import { describe, expect, it } from 'vitest';
import {
  DIAGNOSIS_OPTIONS,
  FINDING_TITLES,
  MOVES,
  REWRITE_FINDINGS,
  TEACH_LINES,
  TEACH_MAX_SPOTS,
  TEACH_SLOTS,
  TEACH_WORD_BUDGET,
  actionFor,
  axisLevels,
  buildTeachSet,
  deeMove,
  defaultBaseFor,
  detectRepair,
  engineVerdict,
  levelLabel,
  levelOf,
  readingFor,
  recordTaught,
  rewritesDue,
  suggestReading,
  teachLine,
  teachSeed,
  teachableBases,
  type Finding,
  type Move,
  type RuleReading,
  type TeachEvent,
  type TeachFacts,
  type TeachSpot,
} from '../../src/core/teachDee.js';
import { differingAxes, type ContrastVariant, type SpotFeatures } from '../../src/core/contrast.js';
import { manifestEntry } from '../../src/core/contrastManifest.js';
import { gradeSpot } from '../../src/core/gradeSpot.js';
import { legalActions } from '../../src/core/table.js';
import { createLexicon } from '../../src/core/lexicon.js';
import { fixedOffsetDayKeyOf, type DayKey } from '../../src/core/localDay.js';
import type { TaughtSet } from '../../src/core/progression/types.js';
import { MAX_TAUGHT_SETS, defaultProgression, parseProgression, serializeProgression } from '../../src/core/progression/persist.js';
import { emptySession, type SessionState } from '../../src/core/session.js';
import { applyProgress, type ApplyContext } from '../../src/core/progression/apply.js';
import { REPS_CONTRAST_SET } from '../../src/core/progression/reps.js';
import { SCENARIOS } from '../../src/core/puzzleScenarios.js';
import { TEACH_MINUTES, TICKET_MAX_MINUTES, buildTicket, ticketMinutes } from '../../src/core/ticket.js';
import { checkTutorOutput } from '../../src/main/tutor/guard.js';
import { renderLine, slotsOf } from '../../src/core/dee/engine.js';
import { variantProblems } from '../../src/core/dee/strict.js';
import { bannedPhrasingIn } from '../../src/core/progress.js';
import { DEE_BANS, NUMBER_WORDS, request } from './deeLint.js';
import type { Facts } from '../../src/core/dee/types.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const BASE_FEATURES: SpotFeatures = {
  suitedness: 'suited',
  kickerGap: 'connected',
  position: 'BB',
  playersBehind: 1,
  rangeAsymmetry: 'symmetric',
  boardTexture: 'other',
  stackDepth: 'bb100',
};

/**
 * A spot for repair detection alone: the features (for the separating variable) and the plays that hold up.
 * detectRepair reads nothing else, so the engine is not needed to pin its logic.
 */
function spot(id: string, applies: boolean, holds: readonly Move[], features: Partial<SpotFeatures> = {}): TeachSpot {
  return {
    id,
    applies,
    pair: 0,
    variant: { features: { ...BASE_FEATURES, ...features } } as unknown as ContrastVariant,
    verdict: { holds, decisive: holds.length < MOVES.length, grades: { aggressive: null, passive: null, fold: null } },
  };
}

const BET_SUITED: RuleReading = { axis: 'suitedness', value: 'suited', action: 'aggressive', otherwise: 'passive' };

// ── Repair detection ───────────────────────────────────────────────────────

describe('repair detection: the rule is judged by the engine’s verdicts, spot by spot', () => {
  it('holds: no miss, and a verdict turned on the rule’s choice', () => {
    const r = detectRepair(
      [spot('a', true, ['aggressive']), spot('b', false, ['passive']), spot('c', true, ['aggressive', 'passive'])],
      BET_SUITED,
    );
    expect(r.finding).toBe('holds');
    expect(r.needsRewrite).toBe(false);
    expect(r.misses).toEqual([]);
    expect(r.judged).toBe(3);
  });

  it('wrong: every applying spot with a verdict is missed, and the play that held there is named', () => {
    const r = detectRepair([spot('a', true, ['passive']), spot('b', true, ['passive', 'fold']), spot('c', false, ['passive'])], BET_SUITED);
    expect(r.finding).toBe('wrong');
    expect(r.needsRewrite).toBe(true);
    expect(r.misses).toEqual(['a', 'b']);
    expect(r.enginePlays).toEqual(['passive']);
  });

  it('too broad: right on some applying spots, wrong on others, and the variable that splits them is named', () => {
    const r = detectRepair(
      [
        spot('in-0', true, ['aggressive'], { playersBehind: 0 }),
        spot('out-0', false, ['passive'], { playersBehind: 0, suitedness: 'offsuit' }),
        spot('in-2', true, ['passive'], { playersBehind: 2 }),
        spot('out-2', false, ['passive'], { playersBehind: 2, suitedness: 'offsuit' }),
      ],
      BET_SUITED,
    );
    expect(r.finding).toBe('too-broad');
    expect(r.misses).toEqual(['in-2']);
    expect(r.variable).toBe('playersBehind');
  });

  it('too broad with no single separating variable names none (it never guesses)', () => {
    const r = detectRepair(
      [
        spot('a', true, ['aggressive'], { playersBehind: 0, position: 'SB' }),
        spot('b', true, ['passive'], { playersBehind: 2, position: 'CO' }),
      ],
      BET_SUITED,
    );
    expect(r.finding).toBe('too-broad');
    expect(r.variable).toBeNull();
  });

  it('no flip: the near-misses are missed, yet the rule’s own play holds on every one of them', () => {
    const r = detectRepair(
      [spot('a', true, ['aggressive', 'passive']), spot('b', false, ['aggressive']), spot('c', false, ['aggressive'])],
      BET_SUITED,
    );
    expect(r.finding).toBe('no-flip');
    expect(r.variable).toBe('suitedness');
    expect(r.misses).toEqual(['b', 'c']);
  });

  it('too narrow: the rule’s play also fits a missed near-miss, but another near-miss really wants the other play', () => {
    const r = detectRepair(
      [spot('a', true, ['aggressive']), spot('b', false, ['aggressive']), spot('c', false, ['passive'])],
      BET_SUITED,
    );
    expect(r.finding).toBe('too-narrow');
    expect(r.misses).toEqual(['b']);
  });

  it('other half: outside the rule neither of its plays holds up', () => {
    const r = detectRepair([spot('a', true, ['aggressive']), spot('b', false, ['fold'])], BET_SUITED);
    expect(r.finding).toBe('other-half');
  });

  it('untested: no spot had a verdict, or no verdict depended on which half Dee played', () => {
    expect(detectRepair([spot('a', true, MOVES), spot('b', false, MOVES)], BET_SUITED).finding).toBe('untested');
    // Fold is wrong on both, so both spots have a verdict, but bet and check both hold: the rule was not tested.
    const r = detectRepair([spot('a', true, ['aggressive', 'passive']), spot('b', false, ['aggressive', 'passive'])], BET_SUITED);
    expect(r.finding).toBe('untested');
    expect(r.needsRewrite).toBe(false);
    expect(r.judged).toBe(2);
  });

  it('a fault where the rule applies outranks one in its other half', () => {
    const r = detectRepair([spot('a', true, ['passive']), spot('b', false, ['fold'])], BET_SUITED);
    expect(r.finding).toBe('wrong');
    expect(r.misses).toEqual(['a', 'b']);
  });

  it('a spot with no verdict never counts against the rule', () => {
    const r = detectRepair([spot('a', true, ['aggressive']), spot('b', false, ['passive']), spot('c', true, MOVES)], BET_SUITED);
    expect(r.finding).toBe('holds');
    expect(r.judged).toBe(2);
  });

  it('counts the spots where the learner’s own play left their rule', () => {
    const spots = [spot('a', true, ['aggressive']), spot('b', false, ['passive']), spot('c', true, ['aggressive'])];
    expect(detectRepair(spots, BET_SUITED, { a: 'aggressive', b: 'aggressive', c: 'fold' }).offRule).toBe(2);
    expect(detectRepair(spots, BET_SUITED).offRule).toBe(0);
  });

  it('Dee plays the rule’s play where it applies and the other play everywhere else', () => {
    expect(deeMove({ applies: true }, BET_SUITED)).toBe('aggressive');
    expect(deeMove({ applies: false }, BET_SUITED)).toBe('passive');
  });

  it('every finding that asks for a rewrite is one the learner can name before the reveal', () => {
    expect(DIAGNOSIS_OPTIONS.map(([f]) => f).sort()).toEqual([...REWRITE_FINDINGS].sort());
    for (const f of Object.keys(FINDING_TITLES) as Finding[]) expect(FINDING_TITLES[f].length).toBeGreaterThan(0);
  });
});

// ── The contrast set on the real engine ────────────────────────────────────

describe('the contrast set: real deals, one variable apart, judged by the grader', () => {
  const bases = teachableBases();

  it('every manifested spot with a buildable axis can be taught on', () => {
    expect(bases.length).toBeGreaterThanOrEqual(5);
    for (const b of bases) expect(b.axes.length).toBeGreaterThan(0);
  });

  it('on every base, axis and value: pairs differ in exactly the rule’s variable, and the tags are true', () => {
    for (const b of bases) {
      for (const a of b.axes) {
        for (const value of a.values) {
          const reading: RuleReading = { axis: a.axis, value, action: 'aggressive', otherwise: 'passive' };
          const result = buildTeachSet(b.entry.base, reading, 7);
          expect(result.ok, `${b.entry.conceptId} ${a.axis}=${value}`).toBe(true);
          if (!result.ok) continue;
          expect(result.spots.length).toBeLessThanOrEqual(TEACH_MAX_SPOTS);
          expect(result.spots.some((s) => s.applies)).toBe(true);
          expect(result.spots.some((s) => !s.applies)).toBe(true);
          for (const s of result.spots) {
            expect(levelOf(s.variant.features, a.axis) === value).toBe(s.applies);
          }
          const byPair = new Map<number, TeachSpot[]>();
          for (const s of result.spots) byPair.set(s.pair, [...(byPair.get(s.pair) ?? []), s]);
          for (const pair of byPair.values()) {
            expect(pair).toHaveLength(2);
            expect(differingAxes(pair[0].variant.features, pair[1].variant.features)).toEqual([a.axis]);
            // The cards a learner can see move no more than the variable needs: the board and seats never; for
            // suitedness both ranks stay; for the gap one card stays exactly.
            const [x, y] = pair.map((p) => p.variant.spot);
            expect(y.board).toEqual(x.board);
            const ranks = (h: readonly string[]) => h.map((c) => c[0]).sort().join('');
            if (a.axis === 'suitedness') expect(ranks(y.hole)).toBe(ranks(x.hole));
            else if (a.axis === 'kickerGap') expect(y.hole.some((c) => x.hole.includes(c))).toBe(true);
            else expect(y.hole).toEqual(x.hole);
          }
        }
      }
    }
  });

  it('is seeded: the same seed deals the same set, another seed deals another', () => {
    const entry = manifestEntry('turn-probe')!;
    const reading: RuleReading = { axis: 'kickerGap', value: 'connected', action: 'aggressive', otherwise: 'passive' };
    const key = (seed: number): string => {
      const r = buildTeachSet(entry.base, reading, seed);
      return r.ok ? r.spots.map((s) => `${s.id}:${s.variant.spot.hole.join('')}`).join(' ') : r.reason;
    };
    expect(key(11)).toBe(key(11));
    expect(new Set([11, 12, 13, 14].map(key)).size).toBeGreaterThan(1);
  });

  it('the verdict is the grader’s own: a play holds up exactly when gradeSpot calls it free', () => {
    const entry = manifestEntry('river-bluff-catch')!;
    const r = buildTeachSet(entry.base, { axis: 'kickerGap', value: 'pair', action: 'passive', otherwise: 'aggressive' }, 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const s of r.spots) {
      const v = engineVerdict(s.variant, 99);
      for (const m of MOVES) {
        const action = actionFor(m, legalActions(s.variant.state));
        const g = action === null ? null : gradeSpot(s.variant.state, action, { seed: 99, modelFor: () => null });
        expect(v.holds.includes(m)).toBe(g !== null && g.severity === 'free');
        expect(v.grades[m]?.evLossBb).toBe(g?.evLossBb);
      }
    }
  });

  it('a rule tested end to end on the engine finds a fault and names the variable (turn probe, suited bets)', () => {
    const entry = manifestEntry('turn-probe')!;
    const base = bases.find((b) => b.entry.conceptId === 'turn-probe')!;
    const reading = readingFor(base, suggestReading('Suited hands realise their equity better, so I bet them; offsuit I check'));
    expect(reading).toEqual({ axis: 'suitedness', value: 'suited', action: 'aggressive', otherwise: 'passive' });
    const findings = new Set<Finding>();
    for (let seed = 1; seed <= 6; seed++) {
      const r = buildTeachSet(entry.base, reading, seed);
      if (r.ok) findings.add(detectRepair(r.spots, reading).finding);
    }
    // Checking is the turn grader's free play nearly everywhere here, so "always bet suited" cannot hold.
    expect([...findings].some((f) => REWRITE_FINDINGS.includes(f))).toBe(true);
  });

  it('picks the rule’s own spot, then one with its principle, then the first', () => {
    expect(defaultBaseFor('river-bluff-catch', null)?.entry.conceptId).toBe('river-bluff-catch');
    expect(defaultBaseFor('some-lesson', 'value or bluff')?.entry.conceptId).toBe('turn-probe');
    expect(defaultBaseFor('some-lesson', null)?.entry.conceptId).toBe(bases[0].entry.conceptId);
  });
});

describe('Dee’s first reading of a sentence is a guess the learner corrects', () => {
  it.each([
    ['Suited connectors realise more equity, so bet them', { axis: 'suitedness', value: 'suited', action: 'aggressive', otherwise: 'passive' }],
    ['Offsuit hands check because they realise less equity', { axis: 'suitedness', value: 'offsuit', action: 'passive', otherwise: 'aggressive' }],
    ['On the button I raise: position realises equity', { axis: 'position', value: 'BTN', action: 'aggressive' }],
    ['A weak kicker is dominated, so fold it', { axis: 'kickerGap', action: 'fold' }],
    ['With players behind, call less', { axis: 'playersBehind', action: 'passive' }],
  ] as const)('%s', (sentence, expected) => {
    expect(suggestReading(sentence)).toMatchObject(expected);
  });

  it('a sentence with no cue guesses nothing, and the base fills a complete reading', () => {
    expect(suggestReading('range asymmetry decides it')).toEqual({});
    const b = teachableBases()[0];
    const r = readingFor(b, {});
    expect(b.axes.some((a) => a.axis === r.axis && a.values.includes(r.value))).toBe(true);
  });
});

// ── Records, the rewrite queue, Reps and the Ticket ─────────────────────────

const dayOf = fixedOffsetDayKeyOf(0);
const NOW = Date.parse('2026-10-12T20:00:00Z');

function taught(at: number, conceptId: string, finding: string): TaughtSet {
  return {
    at,
    conceptId,
    text: 'suited hands realise their equity, so bet them',
    base: 'turn-probe',
    axis: 'suitedness',
    value: 'suited',
    action: 'aggressive',
    otherwise: 'passive',
    finding,
    spots: 6,
    misses: finding === 'holds' ? 0 : 2,
  };
}

describe('taught sets: recorded once, bounded, and read tolerantly', () => {
  it('recordTaught is idempotent on the moment and bounded', () => {
    let s = { sets: [] as TaughtSet[] };
    s = recordTaught(s, taught(10, 'a', 'holds'));
    expect(recordTaught(s, taught(10, 'a', 'wrong'))).toBe(s);
    for (let i = 0; i < MAX_TAUGHT_SETS + 5; i++) s = recordTaught(s, taught(100 + i, 'a', 'holds'));
    expect(s.sets).toHaveLength(MAX_TAUGHT_SETS);
    expect(s.sets[0].at).toBe(105);
  });

  it('the profile round-trips a set and keeps a newer build’s finding; bad entries read as nothing', () => {
    const p = { ...defaultProgression(), teachDee: { sets: [taught(5, 'a', 'too-broad'), taught(6, 'b', 'a-newer-finding')] } };
    expect(parseProgression(JSON.parse(JSON.stringify(serializeProgression(p))))).toEqual(p);
    const bad = parseProgression({ teachDee: { sets: [{ at: 'x' }, null, 4, { ...taught(7, 'c', 'holds'), conceptId: '' }] } });
    expect(bad.teachDee.sets).toEqual([]);
    expect(parseProgression({ teachDee: 'garbage' }).teachDee).toEqual({ sets: [] });
  });

  it('a rewrite is due until a sentence for the rule lands after the set', () => {
    const sets = [taught(NOW - 5000, 'r1', 'too-broad'), taught(NOW - 4000, 'r2', 'holds'), taught(NOW - 3000, 'r3', 'a-newer-finding')];
    const onCards = ['r1', 'r2', 'r3'].map((conceptId) => ({ conceptId, text: 'a lesson rule', day: (dayOf(NOW) - 3) as DayKey }));
    expect(rewritesDue({ sets, lexicon: [], rules: onCards, dayOf }).map((s) => s.conceptId)).toEqual(['r1']);
    // A rule no longer on any card (its lesson rules forgotten) is not asked for: it could never be taught again.
    expect(rewritesDue({ sets, lexicon: [], rules: [], dayOf })).toEqual([]);
    const lex = createLexicon();
    const early = lex.record({ conceptId: 'r1', sentence: 'the kicker is dominated more often', at: NOW - 9000 });
    expect(early.outcome).toBe('accepted');
    expect(rewritesDue({ sets, lexicon: lex.attempts(), rules: [], dayOf })).toHaveLength(1);
    expect(rewritesDue({ sets, lexicon: lex.attempts(), rules: [], dayOf })[0].conceptId).toBe('r1');
    lex.record({ conceptId: 'r1', sentence: 'suited hands realise equity only with nobody behind', at: NOW - 1000 });
    expect(rewritesDue({ sets, lexicon: lex.attempts(), rules: [], dayOf })).toEqual([]);
    const lesson = [{ conceptId: 'r1', text: 'a lesson rule', day: (dayOf(NOW) + 1) as DayKey }];
    expect(rewritesDue({ sets, lexicon: [], rules: lesson, dayOf })).toEqual([]);
    // The newest set is the one that counts: a later set that held closes it.
    expect(rewritesDue({ sets: [...sets, taught(NOW - 500, 'r1', 'holds')], lexicon: [], rules: onCards, dayOf })).toEqual([]);
  });

  it('teachSeed moves with each set taught, and is stable for the same count', () => {
    expect(teachSeed('a', 'x', 0)).toBe(teachSeed('a', 'x', 0));
    expect(teachSeed('a', 'x', 1)).not.toBe(teachSeed('a', 'x', 0));
    expect(teachSeed('a', 'y', 0)).not.toBe(teachSeed('a', 'x', 0));
  });
});

describe('the progression host pays a finished set once, polishes a rule that held, and works the Ticket', () => {
  const ctx: ApplyContext = { now: NOW, dayOf, scenarios: SCENARIOS, leakPrinciple: null };
  const save = (prev: SessionState, next: SessionState): SessionState => ({ ...next, progression: applyProgress(prev, next, {}, ctx).progression });
  const withSets = (s: SessionState, sets: TaughtSet[]): SessionState => ({ ...s, progression: { ...s.progression, teachDee: { sets } } });

  it(`a finished set pays ${REPS_CONTRAST_SET} Reps whatever it found, and a replay pays nothing`, () => {
    const s0 = emptySession();
    const s1 = save(s0, withSets(s0, [taught(NOW - 1000, 'r1', 'wrong')]));
    expect(s1.progression.reps.total).toBe(REPS_CONTRAST_SET);
    expect(save(s1, s1).progression.reps.total).toBe(REPS_CONTRAST_SET);
    expect(save(s0, s1).progression.reps.total).toBe(REPS_CONTRAST_SET);
    const s2 = save(s1, withSets(s1, [...s1.progression.teachDee.sets, taught(NOW - 500, 'r1', 'holds')]));
    expect(s2.progression.reps.total).toBe(2 * REPS_CONTRAST_SET);
  });

  it('a finished set’s Reps reach the Ghost Rail’s week like any other learning Reps', () => {
    const s0 = emptySession();
    const s1 = save(s0, withSets(s0, [taught(NOW - 1000, 'r1', 'too-broad')]));
    expect(s1.progression.rail.weeks.reduce((n, w) => n + w.reps, 0)).toBe(REPS_CONTRAST_SET);
  });

  it('a set that held re-polishes its card at the moment it finished; one that failed does not', () => {
    const s0 = emptySession();
    const held = save(s0, withSets(s0, [taught(NOW - 1000, 'r1', 'holds')]));
    expect(held.progression.folio.polished.r1).toEqual([NOW - 1000]);
    const failed = save(s0, withSets(s0, [taught(NOW - 1000, 'r1', 'too-broad')]));
    expect(failed.progression.folio.polished.r1).toBeUndefined();
  });

  it('the Ticket carries one rule to rewrite, inside its budget, and ticks it when the rule is taught again', () => {
    const items = buildTicket({ day: dayOf(NOW), now: NOW, concepts: [], leakPrinciple: null, scenarios: SCENARIOS, puzzleProgress: {}, teach: 'r1' });
    expect(items.filter((i) => i.kind === 'teach')).toEqual([{ id: 'teach:r1', kind: 'teach', ref: 'r1', minutes: TEACH_MINUTES }]);
    expect(ticketMinutes(items)).toBeLessThanOrEqual(TICKET_MAX_MINUTES);
    expect(buildTicket({ day: dayOf(NOW), now: NOW, concepts: [], leakPrinciple: null, scenarios: SCENARIOS, puzzleProgress: {} }).some((i) => i.kind === 'teach')).toBe(false);

    // Yesterday's set found the rule wrong: today's Ticket asks for it, and teaching it again ticks the item.
    const e = emptySession();
    const onCard = { ...e, progression: { ...e.progression, dee: { ...e.progression.dee, ruleSentences: [{ conceptId: 'r1', text: 'a rule', day: (dayOf(NOW) - 3) as DayKey }] } } };
    const s0 = withSets(onCard, [taught(NOW - 86_400_000, 'r1', 'wrong')]);
    const s1 = save(s0, withSets(s0, [...s0.progression.teachDee.sets, taught(NOW - 100, 'r1', 'holds')]));
    expect(s1.progression.ticket.items.some((i) => i.id === 'teach:r1')).toBe(true);
    expect(s1.progression.ticket.done).toContain('teach:r1');
  });

  it('a teach item whose rule left the Folio the same day (rules forgotten) is closed, so the Ticket can still finish', () => {
    const e = emptySession();
    const onCard = { ...e, progression: { ...e.progression, dee: { ...e.progression.dee, ruleSentences: [{ conceptId: 'r1', text: 'a rule', day: (dayOf(NOW) - 3) as DayKey }] } } };
    const s0 = withSets(onCard, [taught(NOW - 86_400_000, 'r1', 'wrong')]);
    const s1 = save(s0, s0);
    expect(s1.progression.ticket.items.some((i) => i.id === 'teach:r1')).toBe(true);
    expect(s1.progression.ticket.done).not.toContain('teach:r1');
    const forgotten = { ...s1, progression: { ...s1.progression, dee: { ...s1.progression.dee, ruleSentences: [] } } };
    const s2 = save(s1, forgotten);
    expect(s2.progression.ticket.done).toContain('teach:r1');
  });
});

// ── The lint: every word Dee says here ─────────────────────────────────────

const FIXTURE: Required<TeachFacts> = {
  value: levelLabel('playersBehind', '2'),
  action: 'bet or raise',
  otherwise: 'check or call',
  dee: 'bet or raise',
  engine: 'check or call',
  variable: 'players left to act',
};

const words = (t: string): number => t.trim().split(/\s+/).length;

function lint(textOf: string, question: boolean): string[] {
  const problems: string[] = [];
  if (/\d/.test(textOf)) problems.push('literal numeral in the template');
  if (NUMBER_WORDS.test(textOf)) problems.push(`number word: ${NUMBER_WORDS.exec(textOf)?.[0]}`);
  for (const [name, re] of DEE_BANS) if (re.test(textOf)) problems.push(`dee-ban:${name}: ${re.exec(textOf)?.[0]}`);
  const banned = bannedPhrasingIn(textOf);
  if (banned) problems.push(`banned:${banned}`);
  for (const slot of slotsOf(textOf)) if (!(TEACH_SLOTS as readonly string[]).includes(slot)) problems.push(`unknown slot {${slot}}`);
  if (/held the price|price held/i.test(textOf)) problems.push('D6: price-held wording outside the price-held beat');
  const filled = renderLine(textOf, FIXTURE as Facts);
  if (filled === null) problems.push('does not render from its facts');
  else {
    if (words(filled) > TEACH_WORD_BUDGET) problems.push(`${words(filled)} words > ${TEACH_WORD_BUDGET}`);
    for (const v of checkTutorOutput({ text: filled, kind: question ? 'question' : 'correction' }, request(FIXTURE as Facts)).violations) {
      problems.push(`guard:${v.check}:${v.detail}`);
    }
  }
  return problems;
}

describe('Teach Dee’s lines pass Dee’s bank lint, in every tone', () => {
  const rows = TEACH_LINES.flatMap((line) =>
    [
      { tone: 'warm', text: line.text },
      ...(line.dry ? [{ tone: 'dry', text: line.dry }] : []),
      ...(line.blunt ? [{ tone: 'blunt', text: line.blunt }] : []),
    ].map((v) => ({ line, ...v })),
  );

  it('ids are unique', () => {
    expect(new Set(TEACH_LINES.map((l) => l.id)).size).toBe(TEACH_LINES.length);
  });

  it.each(rows.map((r) => [`${r.line.id} (${r.tone})`, r] as const))('%s', (_n, { line, text }) => {
    const problems = lint(text, line.text.trim().endsWith('?'));
    if (text !== line.text) problems.push(...variantProblems(text, line.text).map((p) => `strict:${p}`));
    if (line.pose === 'price-held') problems.push('D6: the price-held pose outside the price-held beat');
    expect(problems).toEqual([]);
  });

  it('every level label Dee can be handed passes the guard in every line that quotes it (no number of Dee’s own)', () => {
    for (const axis of ['suitedness', 'kickerGap', 'position', 'playersBehind'] as const) {
      for (const level of axisLevels(axis)) {
        const facts = { ...FIXTURE, value: levelLabel(axis, level) };
        for (const line of TEACH_LINES.filter((l) => l.text.includes('{value}'))) {
          for (const t of [line.text, line.dry, line.blunt].filter((x): x is string => x !== undefined)) {
            const filled = renderLine(t, facts as Facts)!;
            expect(checkTutorOutput({ text: filled, kind: 'correction' }, request({ ...FIXTURE, value: '' } as Facts)).violations.filter((v) => v.check !== 'number-provenance' || axis !== 'playersBehind'), `${line.id} ${level}`).toEqual([]);
          }
        }
      }
    }
  });

  it('every event the screen raises has a line that renders, in every tone', () => {
    const events: TeachEvent[] = ['read', 'agree', 'disagree', 'no-verdict', 'diagnose', 'rewrite', ...(Object.keys(FINDING_TITLES) as Finding[]).map((f) => `finding-${f}` as const)];
    for (const event of events) {
      for (const tone of ['warm', 'dry', 'blunt'] as const) {
        expect(teachLine(event, tone, FIXTURE, 3), `${event} ${tone}`).not.toBeNull();
      }
    }
  });

  it('labels the screen shows beside them carry no trait word or banned phrasing either', () => {
    const labels = [...Object.values(FINDING_TITLES), ...DIAGNOSIS_OPTIONS.map(([, l]) => l)];
    for (const axis of ['suitedness', 'kickerGap', 'position', 'playersBehind'] as const) {
      for (const v of axisLevels(axis)) labels.push(levelLabel(axis, v));
    }
    for (const l of labels) {
      expect(bannedPhrasingIn(l), l).toBeNull();
      const trait = DEE_BANS.find(([name]) => name === 'trait')![1];
      expect(trait.test(l), l).toBe(false);
      expect(NUMBER_WORDS.test(l), l).toBe(false);
    }
  });
});
