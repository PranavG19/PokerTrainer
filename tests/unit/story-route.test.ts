import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES, sessionProfile } from '../../src/core/archetypes.js';
import { defaultProgression } from '../../src/core/progression/persist.js';
import type { DayKey } from '../../src/core/localDay.js';
import { VENUES, venueById, type Venue } from '../../src/core/story/cast.js';
import { buildRoute, leakKindOf, leakSummaries, MIN_LEAK_DECISIONS, tableFor, tableSeed, type LoggedDecision, type LoggedHand } from '../../src/core/story/route.js';
import { recordTable } from '../../src/core/story/campaign.js';

const charged = (street: LoggedDecision['street'], action: string, toCall: number, principle: string, evLossBb: number): LoggedDecision => ({
  street,
  action,
  toCall,
  verdict: { severity: evLossBb >= 2 ? 'serious' : 'notable', evLossBb, principle },
});
const free = (street: LoggedDecision['street'], action: string, toCall: number): LoggedDecision => ({
  street,
  action,
  toCall,
  verdict: { severity: 'free', evLossBb: 0, principle: null },
});
const hands = (...decisions: LoggedDecision[]): LoggedHand[] => decisions.map((d) => ({ decisions: [d] }));
const story = () => defaultProgression().story;

describe('leak kinds: the coach principle × the action', () => {
  it('maps every charge the coach makes, and nothing that cost nothing', () => {
    expect(leakKindOf(charged('river', 'fold', 100, 'pot odds', 3))).toBe('over-fold');
    expect(leakKindOf(charged('turn', 'call', 100, 'pot odds', 3))).toBe('over-call');
    expect(leakKindOf(charged('river', 'check', 0, 'value or bluff', 1))).toBe('missed-value');
    expect(leakKindOf(charged('flop', 'bet', 0, 'value or bluff', 1))).toBe('empty-bluff');
    expect(leakKindOf(charged('flop', 'fold', 0, 'value or bluff', 1))).toBe('free-fold');
    expect(leakKindOf(charged('flop', 'raise', 50, 'ranges', 1))).toBe('light-raise');
    expect(leakKindOf(free('river', 'fold', 100))).toBeNull();
    expect(leakKindOf({ street: 'river', action: 'call', toCall: 50, verdict: null })).toBeNull();
  });
});

describe('leak summaries are reach-weighted (rw.ts over the reference reach)', () => {
  it('a frequent flop leak outranks an equally costly river one, because the flop is reached more', () => {
    const s = leakSummaries(hands(
      charged('flop', 'fold', 50, 'pot odds', 2), charged('flop', 'fold', 50, 'pot odds', 2),
      charged('river', 'call', 50, 'pot odds', 2), charged('river', 'call', 50, 'pot odds', 2),
    ));
    expect(s.map((l) => l.kind)).toEqual(['over-fold', 'over-call']);
    // mean ΔEV × reach × 100: flop pot odds reach 0.5, river 0.25 (reachRef.ts).
    expect(s[0].rw).toBeCloseTo(2 * 0.5 * 100);
    expect(s[1].rw).toBeCloseTo(2 * 0.25 * 100);
    expect(s[0].costBb).toBe(4);
  });

  it('names the street carrying the most cost', () => {
    const [s] = leakSummaries(hands(
      charged('river', 'fold', 50, 'pot odds', 3), charged('river', 'fold', 50, 'pot odds', 2), charged('flop', 'fold', 50, 'pot odds', 1),
    ));
    expect(s.topStreet).toBe('river');
    expect(s.byStreet).toEqual({ river: 2, flop: 1 });
  });
});

describe('the route', () => {
  it('a brand-new player gets the default orbit, the Lighthouse first and the Observatory last', () => {
    const r = buildRoute([], story());
    expect(r.personalized).toBe(false);
    expect(r.chapters.map((c) => c.venue.id)).toEqual(VENUES.map((v) => v.id));
    expect(r.next).toBe('lighthouse');
    expect(r.chapters.every((c) => c.citation === null)).toBe(true);
    expect(r.why).toMatch(/default orbit/i);
  });

  it('one costly decision is not a leak: the orbit waits for MIN_LEAK_DECISIONS', () => {
    expect(MIN_LEAK_DECISIONS).toBe(2);
    const r = buildRoute(hands(charged('river', 'fold', 100, 'pot odds', 5)), story());
    expect(r.personalized).toBe(false);
  });

  it('over-folding to bets moves the Night Train first, with a citation built from the numbers', () => {
    const log = hands(
      charged('river', 'fold', 100, 'pot odds', 3), charged('river', 'fold', 100, 'pot odds', 2),
      free('flop', 'call', 50), free('turn', 'check', 0),
    );
    const r = buildRoute(log, story());
    expect(r.personalized).toBe(true);
    expect(r.next).toBe('night-train');
    const first = r.chapters[0];
    expect(first.venue.id).toBe('night-train');
    expect(first.position).toBe(1);
    expect(first.defaultPosition).toBe(4);
    expect(first.leak?.kind).toBe('over-fold');
    expect(first.citation).toBe('From your last 4 hands: folding to bets the price said to call, 5.0 bb across 2 decisions, reach-weighted 62.5 bb/100.');
    expect(r.chapters[r.chapters.length - 1].venue.id).toBe('observatory');
    expect(r.source).toEqual({ hands: 4, decisions: 4, reach: 'authored-street-class-v1' });
  });

  it('two leaks order their chapters costliest-first; the rest keep the default order', () => {
    const log = hands(
      charged('flop', 'call', 50, 'pot odds', 3), charged('flop', 'call', 50, 'pot odds', 3),
      charged('river', 'check', 0, 'value or bluff', 1), charged('river', 'check', 0, 'value or bluff', 1),
    );
    const ids = buildRoute(log, story()).chapters.map((c) => c.venue.id);
    expect(ids).toEqual(['lighthouse', 'diner', 'library', 'night-train', 'pier', 'observatory']);
    const flipped = buildRoute(hands(
      charged('river', 'check', 0, 'value or bluff', 4), charged('river', 'check', 0, 'value or bluff', 4),
      charged('river', 'call', 50, 'pot odds', 1), charged('river', 'call', 50, 'pot odds', 1),
    ), story()).chapters.map((c) => c.venue.id);
    expect(flipped.slice(0, 2)).toEqual(['diner', 'lighthouse']);
  });

  it('suggested next skips a beaten chapter but never hides it (N1)', () => {
    const lighthouse = venueById('lighthouse') as Venue;
    const beaten = recordTable(story(), lighthouse, { judged: 4, free: 4, serious: 0, focusSerious: 0, result: 'met' }, 20000 as DayKey);
    const r = buildRoute([], beaten);
    expect(r.next).toBe('diner');
    expect(r.chapters.find((c) => c.venue.id === 'lighthouse')?.beaten).toBe(true);
    expect(r.chapters).toHaveLength(6);
  });
});

describe('the rival leans on the leak', () => {
  const train = venueById('night-train') as Venue;

  it('over-folding to river bets: the conductor bluffs more rivers, and only rivers', () => {
    const [leak] = leakSummaries(hands(charged('river', 'fold', 100, 'pot odds', 3), charged('river', 'fold', 100, 'pot odds', 2)));
    const t = tableFor(train, leak, 7);
    expect(t.profile).toEqual(sessionProfile('lag', 7));
    expect(Object.keys(t.streetProfiles)).toEqual(['river']);
    expect(t.streetProfiles.river!.bluffBetFreq).toBeCloseTo(Math.min(0.9, t.profile.bluffBetFreq + 0.3));
    expect(t.tailor?.text).toBe('This regular bluffs more on the river at this table: 2 of your 2 costly decisions of this kind came on the river.');
  });

  it('a structural zero stays zero (a lighthouse keeper never bluff-raises)', () => {
    const wren = venueById('lighthouse') as Venue;
    const [leak] = leakSummaries(hands(charged('turn', 'call', 100, 'pot odds', 3), charged('turn', 'call', 100, 'pot odds', 3)));
    const t = tableFor(wren, leak, 3);
    expect(ARCHETYPE_PROFILES.nit.bluffRaiseFreq).toBe(0);
    expect(t.streetProfiles.turn!.bluffRaiseFreq).toBe(0);
    expect(t.streetProfiles.turn!.raiseFreq).toBeGreaterThanOrEqual(0.95);
  });

  it('no leak, or a leak this rival does not punish: the plain jittered profile', () => {
    expect(tableFor(train, null, 7)).toEqual({ profile: sessionProfile('lag', 7), streetProfiles: {}, tailor: null });
    const [other] = leakSummaries(hands(charged('turn', 'call', 100, 'pot odds', 3), charged('turn', 'call', 100, 'pot odds', 3)));
    expect(tableFor(train, other, 7).tailor).toBeNull();
  });

  it('table seeds are deterministic, and differ by chapter and attempt', () => {
    expect(tableSeed('library', 0, 42)).toBe(tableSeed('library', 0, 42));
    expect(tableSeed('library', 0, 42)).not.toBe(tableSeed('library', 1, 42));
    expect(tableSeed('library', 0, 42)).not.toBe(tableSeed('diner', 0, 42));
  });
});
