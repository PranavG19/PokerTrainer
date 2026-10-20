import { describe, expect, it } from 'vitest';
import { ARCHETYPE_NAMES, decideArchetypeAction, sessionProfile, type ArchetypeName } from '../../src/core/archetypes.js';
import type { DayKey } from '../../src/core/localDay.js';
import { emptyMasquerade, parseProgression, serializeProgression, defaultProgression } from '../../src/core/progression/persist.js';
import type { MasqueradeSeat, RivalAction } from '../../src/core/progression/types.js';
import { MIN_OBSERVATIONS, DEVIATION_THRESHOLD_POINTS } from '../../src/core/reads.js';
import { mulberry32 } from '../../src/core/rng.js';
import { applyAction, createTable, isHandOver, legalActions, startHand } from '../../src/core/table.js';
import { RIVALS, RIVAL_IDS } from '../../src/core/story/cast.js';
import { capturedAction } from '../../src/core/story/dossier.js';
import {
  BASELINES,
  EXPECTED_LEAN,
  INK_OBSERVATIONS,
  MASQUERADE_SEATS,
  READ_IDS,
  beginMasquerade,
  bestFits,
  canName,
  castOf,
  ensureMasquerade,
  isComplete,
  nameSeat,
  recordMasqueradeHand,
  rivalsFor,
  seatReads,
} from '../../src/core/story/masquerade.js';

const day = (n: number): DayKey => n as DayKey;

const seat = (over: Partial<MasqueradeSeat>): MasqueradeSeat => ({
  rival: 'wren', acted: 0, played: 0, faced: 0, folded: 0, chances: 0, bets: 0, missed: [], unmaskedOn: null, ...over,
});

describe('the Folio ink gate at 20 hands (reads.ts R1, read-only)', () => {
  it('is reads.ts’s own sample gate', () => {
    expect(INK_OBSERVATIONS).toBe(MIN_OBSERVATIONS);
    expect(INK_OBSERVATIONS).toBe(20);
  });

  it('19 hands stay in pencil; the 20th inks the plays read', () => {
    const pencil = seatReads(seat({ acted: 19, played: 2 }))[0];
    expect(pencil).toMatchObject({ id: 'plays', inked: false, needs: 1, lean: null });
    const ink = seatReads(seat({ acted: 20, played: 2 }))[0];
    expect(ink).toMatchObject({ id: 'plays', inked: true, needs: 0, lean: 'fewer' });
    expect(ink.gates.sampleGate).toBe(true);
  });

  it('an inked read leans only past R1’s deviation gate; inside it, it is standard', () => {
    const at = (played: number) => seatReads(seat({ acted: 20, played }))[0].lean;
    // Baseline 0.30 of 20 = 6. Fifteen points either side: 9 is +15 (more), 3 is -15 (fewer).
    expect(at(6)).toBe('standard');
    expect(at(8)).toBe('standard');
    expect(at(9)).toBe('more');
    expect(at(4)).toBe('standard');
    expect(at(3)).toBe('fewer');
    expect(DEVIATION_THRESHOLD_POINTS).toBe(15);
  });

  it('no seat can be named before a read is inked; a name is judged on the fit, never the hidden identity', () => {
    let m = beginMasquerade(emptyMasquerade());
    const pencil = seatReads(m.seats[0]);
    expect(canName(pencil)).toBe(false);
    expect(nameSeat(m, 0, 'wren', pencil, day(5)).result).toBe('not-inked');

    // A seat that plays few hands and folds to everything reads as either tight style.
    m = { ...m, seats: m.seats.map((s, i) => (i === 0 ? { ...s, rival: 'percival', acted: 20, played: 1, faced: 20, folded: 19 } : s)) };
    const reads = seatReads(m.seats[0]);
    expect(bestFits(reads).sort()).toEqual(['percival', 'wren']);
    const wrong = nameSeat(m, 0, 'juniper', reads, day(5));
    expect(wrong.result).toBe('not-a-fit');
    expect(wrong.state.seats[0].missed).toEqual(['juniper']);
    expect(nameSeat(wrong.state, 0, 'juniper', reads, day(5)).result).toBe('tried');
    const right = nameSeat(wrong.state, 0, 'wren', reads, day(6));
    expect(right.result).toBe('unmasked');
    expect(right.state.seats[0].unmaskedOn).toBe(day(6));
    expect(nameSeat(right.state, 0, 'wren', reads, day(7)).result).toBe('already');
  });

  it('unmasking every seat completes the Masquerade once, and keeps the first day', () => {
    let m = beginMasquerade(emptyMasquerade());
    m = { ...m, seats: m.seats.map((s) => ({ ...s, acted: 20, played: 7, faced: 20, folded: 11, chances: 20, bets: 8 })) };
    for (let i = 0; i < MASQUERADE_SEATS; i++) {
      const r = seatReads(m.seats[i]);
      const fit = bestFits(r)[0];
      m = nameSeat(m, i, fit, r, day(9 + i)).state;
    }
    expect(isComplete(m)).toBe(true);
    expect(m.completed).toBe(1);
    expect(m.completedOn).toBe(day(11));
    const next = beginMasquerade(m);
    expect(next.run).toBe(m.run + 1);
    expect(next.completedOn).toBe(day(11));
    expect(next.seats.every((s) => s.unmaskedOn === null && s.acted === 0)).toBe(true);
  });
});

describe('the Masquerade table', () => {
  it('deals three distinct rivals per run, the same ones on a replay', () => {
    for (let run = 1; run < 30; run++) {
      const a = rivalsFor(run);
      expect(a).toHaveLength(MASQUERADE_SEATS);
      expect(new Set(a).size).toBe(MASQUERADE_SEATS);
      expect(rivalsFor(run)).toEqual(a);
    }
    expect(ensureMasquerade(emptyMasquerade()).seats).toHaveLength(MASQUERADE_SEATS);
  });

  it('every seat is masked, with a jittered profile', () => {
    const m = beginMasquerade(emptyMasquerade());
    for (const c of castOf(m)) {
      expect(c.unmasked).toBe(false);
      expect(c.mask).not.toMatch(new RegExp(Object.values(RIVALS).map((r) => r.short).join('|')));
    }
  });

  it('counts only what each seat did: plays, folds to a bet, bets when nobody has', () => {
    const a = (street: RivalAction['street'], kind: RivalAction['kind'], facingBet: boolean): RivalAction => ({ street, kind, facingBet, potShare: null });
    let m = beginMasquerade(emptyMasquerade());
    m = recordMasqueradeHand(m, [
      [a('preflop', 'call', true), a('flop', 'bet', false), a('turn', 'fold', true)],
      [a('preflop', 'fold', true)],
      [a('preflop', 'check', false), a('flop', 'check', false)],
    ]);
    expect(m.seats.map(({ acted, played, faced, folded, chances, bets }) => ({ acted, played, faced, folded, chances, bets }))).toEqual([
      { acted: 1, played: 1, faced: 2, folded: 1, chances: 1, bets: 1 },
      { acted: 1, played: 0, faced: 1, folded: 1, chances: 0, bets: 0 },
      { acted: 1, played: 0, faced: 0, folded: 0, chances: 1, bets: 0 },
    ]);
  });

  it('round-trips through the profile parser, and clamps a part above its whole', () => {
    const p = defaultProgression();
    const m = recordMasqueradeHand(beginMasquerade(emptyMasquerade()), []);
    const back = parseProgression(serializeProgression({ ...p, story: { ...p.story, masquerade: m } }));
    expect(back.story.masquerade).toEqual(m);
    const bad = parseProgression({ story: { masquerade: { run: 2, seats: [{ rival: 'wren', acted: 3, played: 9, faced: 1, folded: 4, chances: 2, bets: 5 }, { acted: 1 }] } } });
    expect(bad.story.masquerade.seats).toEqual([seat({ acted: 3, played: 3, faced: 1, folded: 1, chances: 2, bets: 2 })]);
  });
});

/**
 * The baselines and every style's lean, measured: a balanced regular in the learner's seat and three styles at a
 * four-seat table, the actions captured as the table captures them (dossier.ts `capturedAction`).
 */
describe('the baselines are the balanced seat’s, and each style leans the way EXPECTED_LEAN says', () => {
  it('re-measures them', () => {
    const tally: Record<ArchetypeName, MasqueradeSeat> = Object.fromEntries(ARCHETYPE_NAMES.map((n) => [n, seat({})])) as never;
    for (let run = 1; run <= 20; run++) {
      const styles: ArchetypeName[] = ['tag-reg', ...rivalsFor(run).map((id) => RIVALS[id].archetype)];
      const profiles = styles.map((s, i) => sessionProfile(s, run * 31 + i));
      let t = createTable({ seats: styles.map((s, i) => ({ name: s, stack: 5000, isHero: i === 0, avatar: 'x' })), sb: 25, bb: 50, seed: run });
      const rng = mulberry32(run ^ 0x5eed);
      for (let h = 0; h < 30; h++) {
        for (const s of t.seats) s.stack = 5000;
        let st = startHand(t);
        const acts: RivalAction[][] = styles.map(() => []);
        for (let g = 0; g < 200 && !isHandOver(st) && legalActions(st).length > 0; g++) {
          const i = st.toAct;
          const action = decideArchetypeAction(profiles[i], st, i, rng);
          if (st.street !== 'showdown') acts[i].push(capturedAction({ street: st.street, pot: st.pot, currentBet: st.currentBet }, st.seats[i], action));
          st = applyAction(st, action);
        }
        // The balanced seat in the learner's chair counts too: it is the baseline's own sample.
        styles.forEach((s, i) => {
          const one = recordMasqueradeHand({ run: 0, seats: [seat({})], completed: 0, completedOn: null }, [acts[i]]).seats[0];
          const t0 = tally[s];
          tally[s] = { ...t0, acted: t0.acted + one.acted, played: t0.played + one.played, faced: t0.faced + one.faced, folded: t0.folded + one.folded, chances: t0.chances + one.chances, bets: t0.bets + one.bets };
        });
        t = st;
      }
    }
    for (const style of ARCHETYPE_NAMES) {
      const reads = seatReads(tally[style]);
      for (const r of reads) {
        expect(r.n, `${style}.${r.id} sample`).toBeGreaterThan(40);
        expect(r.lean, `${style}.${r.id}: ${r.share?.toFixed(2)} vs ${r.baseline}`).toBe(EXPECTED_LEAN[style][r.id]);
        if (style === 'tag-reg') expect(Math.abs((r.share ?? 0) - BASELINES[r.id]), `${r.id} baseline`).toBeLessThan(0.06);
      }
    }
    expect(READ_IDS).toHaveLength(3);
    expect(RIVAL_IDS).toHaveLength(6);
  });
});
