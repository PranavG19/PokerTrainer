import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { DayKey } from '../../src/core/localDay.js';
import { fixedOffsetDayKeyOf } from '../../src/core/localDay.js';
import { chalk, reps } from '../../src/core/units.js';
import { emptySession, type HandRecord, type SessionState } from '../../src/core/session.js';
import { SCENARIOS } from '../../src/core/puzzleScenarios.js';
import { applyProgress, type ApplyContext } from '../../src/core/progression/apply.js';
import { award } from '../../src/core/progression/reps.js';
import { defaultProgression, parseProgression, serializeProgression } from '../../src/core/progression/persist.js';
import { CHALK_DAILY_CAP } from '../../src/core/progression/types.js';
import { CATALOGUE } from '../../src/core/cosmetics/catalogue.js';
import { earnStatus, equip, isOwned, syncCosmetics } from '../../src/core/cosmetics/locker.js';
import { CHALK_PRICES, chalkForDay, chalkLeftToday, earnChalk, FULL_RATE_REPS, HALF_RATE_REPS, spendItem } from '../../src/core/economy/chalk.js';

const day = (n: number) => n as DayKey;
const ledger0 = () => defaultProgression().cosmetics.chalk;
const repsDay = (amount: number, d: number, key = 'k') => award(defaultProgression().reps, key, amount, day(d));

describe('the earn curve (VISION §4): 1 per Rep to 150, ½ per Rep to 300, then nothing; at most 225 a day', () => {
  it.each([
    [0, 0],
    [1, 1],
    [149, 149],
    [150, 150],
    [151, 150],
    [152, 151],
    [200, 175],
    [299, 224],
    [300, 225],
    [301, 225],
    [5000, 225],
  ])('%i Reps in a day earn %i Chalk', (r, c) => {
    expect(chalkForDay(reps(r))).toBe(c);
  });

  it('the curve is monotonic and never above the cap', () => {
    let last = 0;
    for (let r = 0; r <= 400; r++) {
      const c = chalkForDay(reps(r));
      expect(c).toBeGreaterThanOrEqual(last);
      expect(c).toBeLessThanOrEqual(CHALK_DAILY_CAP);
      last = c;
    }
    expect(chalkForDay(reps(HALF_RATE_REPS))).toBe(CHALK_DAILY_CAP);
    expect(chalkForDay(reps(FULL_RATE_REPS))).toBe(FULL_RATE_REPS);
  });
});

describe('the ledger: paid once per day, capped, idempotent', () => {
  it('pays what today owes and nothing again for the same Reps', () => {
    const r = repsDay(120, 10);
    const a = earnChalk(ledger0(), r, day(10));
    expect(a).toEqual({ balance: 120, day: 10, earnedToday: 120 });
    expect(earnChalk(a, r, day(10))).toBe(a);
  });

  it('pays only the increase as the day goes on, and stops at the cap', () => {
    let r = repsDay(100, 10, 'a');
    let l = earnChalk(ledger0(), r, day(10));
    r = award(r, 'b', 100, day(10)); // 200 Reps today
    l = earnChalk(l, r, day(10));
    expect(l).toEqual({ balance: 175, day: 10, earnedToday: 175 });
    r = award(r, 'c', 900, day(10));
    l = earnChalk(l, r, day(10));
    expect(l.earnedToday).toBe(CHALK_DAILY_CAP);
    expect(l.balance).toBe(CHALK_DAILY_CAP);
    expect(chalkLeftToday(l, day(10))).toBe(0);
  });

  it('a new day starts a new curve; the balance carries (no wallet cap)', () => {
    const l1 = earnChalk(ledger0(), repsDay(400, 10), day(10));
    const r2 = award(repsDay(400, 10), 'x', 50, day(11));
    const l2 = earnChalk(l1, r2, day(11));
    expect(l2).toEqual({ balance: 275, day: 11, earnedToday: 50 });
    expect(chalkLeftToday(l2, day(11))).toBe(175);
    expect(chalkLeftToday(l2, day(12))).toBe(CHALK_DAILY_CAP);
  });

  it('a clock moved back to an earlier day earns nothing, so the same day is never paid twice', () => {
    const r = award(repsDay(300, 10), 'y', 300, day(11));
    const l = earnChalk(earnChalk(ledger0(), r, day(10)), r, day(11));
    expect(l.balance).toBe(450);
    expect(earnChalk(l, r, day(10))).toBe(l);
  });

  it('Reps dated another day do not pay into today', () => {
    expect(earnChalk(ledger0(), repsDay(200, 9), day(10))).toEqual(ledger0());
  });
});

describe('spending: fixed published prices, owned on purchase, never with chips', () => {
  const priced = CATALOGUE.filter((i) => i.earn.kind === 'chalk');

  it('every priced item costs one of the four published prices, and every price is used', () => {
    expect(CHALK_PRICES).toEqual([150, 450, 1000, 2400]);
    for (const item of priced) expect(CHALK_PRICES as readonly number[]).toContain((item.earn as { price: number }).price);
    expect(new Set(priced.map((i) => (i.earn as { price: number }).price))).toEqual(new Set(CHALK_PRICES));
  });

  it('spends the exact price, owns the item with a receipt, and can then be worn', () => {
    const rich = { ...defaultProgression().cosmetics, chalk: { balance: chalk(500), day: day(3), earnedToday: chalk(0) } };
    const s = spendItem(rich, 'back-herringbone', day(4));
    expect(s.chalk).toEqual({ balance: 50, day: 3, earnedToday: 0 });
    expect(s.owned).toEqual(['back-herringbone']);
    expect(s.receipts).toEqual([{ itemId: 'back-herringbone', day: 4, fact: 'Herringbone, for 450 Chalk', chalk: 450 }]);
    const item = CATALOGUE.find((i) => i.id === 'back-herringbone')!;
    expect(isOwned(s, item)).toBe(true);
    expect(equip(s, 'back-herringbone').equipped.cardBack).toBe('back-herringbone');
  });

  it('refuses too little Chalk or a second purchase', () => {
    const some = { ...defaultProgression().cosmetics, chalk: { balance: chalk(449), day: null, earnedToday: chalk(0) } };
    expect(spendItem(some, 'back-herringbone', day(4))).toBe(some);
    const owned = { ...some, owned: ['back-linen'], chalk: { ...some.chalk, balance: chalk(5000) } };
    expect(spendItem(owned, 'back-linen', day(4))).toBe(owned);
  });

  it('a priced item is never granted by a fact, and its rule shows the price and the balance', () => {
    const p = defaultProgression();
    const achievedAll = { achieved: Object.fromEntries(CATALOGUE.flatMap((i) => (i.earn.kind === 'milestone' ? [[i.earn.id, { day: day(1) }]] : []))) };
    const synced = syncCosmetics(p.cosmetics, { milestones: achievedAll, seals: p.seals, story: p.story }, day(2));
    for (const item of priced) expect(synced.owned).not.toContain(item.id);
    const s = earnStatus(CATALOGUE.find((i) => i.id === 'back-night-weave')!, { milestones: p.milestones, seals: p.seals, story: p.story, balance: 300 });
    expect(s).toMatchObject({ met: false, source: '1,000 Chalk', progress: { value: 300, target: 1000, unit: 'Chalk' } });
  });

  it('the ledger survives a save and a load', () => {
    const c = spendItem({ ...defaultProgression().cosmetics, chalk: { balance: chalk(700), day: day(7), earnedToday: chalk(120) } }, 'chips-pewter', day(7));
    const round = parseProgression(serializeProgression({ ...defaultProgression(), cosmetics: c })).cosmetics;
    expect(round).toEqual(c);
  });
});

describe('the save path pays Chalk from Reps, and from nothing else', () => {
  const dayOf = fixedOffsetDayKeyOf(0);
  const NOW = Date.parse('2026-10-12T20:00:00Z');
  const ctx: ApplyContext = { now: NOW, dayOf, scenarios: SCENARIOS, leakPrinciple: null };
  const hand = (at: number, graded: number): HandRecord => ({
    handNumber: 1, hole: ['As', 'Kd'], board: [], net: 0, vpip: false, pfr: false, grades: [], playedAt: at,
    decisions: Array.from({ length: graded }, () => ({
      street: 'flop' as const, board: [], pot: 100, toCall: 50, action: 'call' as const, amount: null,
      verdict: { severity: 'free' as const, evLossBb: 0, message: null, principle: null },
    })),
  });

  it('a hand of graded decisions today pays Reps and the same day’s Chalk; saving again pays nothing', () => {
    const s0 = emptySession();
    const s1: SessionState = { ...s0, hands: [hand(NOW - 1000, 3)] };
    const p1 = applyProgress(s0, s1, {}, ctx).progression;
    expect(p1.reps.total).toBe(30);
    expect(p1.cosmetics.chalk).toEqual({ balance: 30, day: dayOf(NOW), earnedToday: 30 });
    const saved = { ...s1, progression: p1 };
    expect(applyProgress(saved, saved, {}, ctx).progression.cosmetics).toBe(p1.cosmetics);
  });

});

describe('no conversion paths, by source', () => {
  const SRC = path.resolve(__dirname, '../../src');
  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));
  const code = (f: string) => fs.readFileSync(f, 'utf-8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  it('Chalk is minted (the `chalk(` constructor) only in the units, the parser, the economy and the Locker rules', () => {
    const allowed = new Set(['core/units.ts', 'core/progression/persist.ts', 'core/economy/chalk.ts', 'core/cosmetics/locker.ts']);
    const minting = files(SRC).filter((f) => /\bchalk\(/.test(code(f))).map((f) => path.relative(SRC, f));
    expect(minting.filter((f) => !allowed.has(f))).toEqual([]);
  });

  it('the economy never reads chips, the bankroll, pots or results, and never mints Reps or chips', () => {
    const dir = path.join(SRC, 'core/economy');
    for (const f of files(dir)) {
      const src = code(f);
      expect(src, f).not.toMatch(/bankroll|\bChips\b|chips\(|\bpot\b|\bnet\b|winners|evLoss/);
      expect(src, f).not.toMatch(/\breps\(/);
    }
  });

  it('no module turns Chalk into anything: no function returns Reps or chips from a Chalk value', () => {
    for (const f of files(SRC)) {
      const src = code(f);
      expect(src, f).not.toMatch(/\(\s*\w+\s*:\s*Chalk\b[^)]*\)\s*:\s*(Reps|Chips)\b/);
    }
  });

  it('nothing sells Chalk: no price in money, and the Chalk constants are the four published prices only', () => {
    const src = code(path.join(SRC, 'core/economy/chalk.ts'));
    expect(src).not.toMatch(/\$\s*\d|\busd\b|checkout|purchase|discount|\bsales?\b|bundle|Math\.random/i);
  });
});

describe('review round 1 (Chalk)', () => {
  it('a ledger day ahead of today (a clock moved back) shows nothing left today, so the Locker never promises Chalk it will not pay', () => {
    const l = { balance: chalk(100), day: day(20), earnedToday: chalk(40) };
    expect(earnChalk(l, repsDay(200, 19), day(19))).toBe(l);
    expect(chalkLeftToday(l, day(19))).toBe(0);
  });

  it('no priced item in a slot whose effect is not built yet (celebrations: the session-end moment)', () => {
    expect(CATALOGUE.filter((i) => i.slot === 'celebration' && i.earn.kind === 'chalk')).toEqual([]);
  });

  it('spend checks the catalogue itself: a mastery item, an unknown id, or a day-one item is never sold', () => {
    const rich = { ...defaultProgression().cosmetics, chalk: { balance: chalk(9999), day: null, earnedToday: chalk(0) } };
    for (const id of ['back-the-seal', 'back-graphite', 'back-from-nowhere']) expect(spendItem(rich, id, day(1)), id).toBe(rich);
    const s = spendItem(rich, 'back-night-weave', day(1));
    expect(s.chalk.balance).toBe(8999);
    expect(s.receipts.at(-1)).toMatchObject({ itemId: 'back-night-weave', chalk: 1000, fact: 'Night weave, for 1,000 Chalk' });
  });

  const dayOf = fixedOffsetDayKeyOf(0);
  const hand = (at: number, graded: number, net = 0): HandRecord => ({
    handNumber: 1, hole: ['As', 'Kd'], board: [], net, vpip: false, pfr: false, grades: [], playedAt: at,
    decisions: Array.from({ length: graded }, () => ({
      street: 'flop' as const, board: [], pot: 100, toCall: 50, action: 'call' as const, amount: null,
      verdict: { severity: 'free' as const, evLossBb: 0, message: null, principle: null },
    })),
  });

  it('a hand that won a huge pot earns exactly what its graded decisions earn, no more', () => {
    const NOW = Date.parse('2026-10-12T20:00:00Z');
    const ctx: ApplyContext = { now: NOW, dayOf, scenarios: SCENARIOS, leakPrinciple: null };
    const s0 = emptySession();
    const plain = applyProgress(s0, { ...s0, hands: [hand(NOW - 1000, 2, 0)] }, {}, ctx).progression.cosmetics.chalk;
    const rich = applyProgress(s0, { ...s0, bankroll: 9_000_000 as SessionState['bankroll'], hands: [hand(NOW - 1000, 2, 250_000)] }, {}, ctx).progression.cosmetics.chalk;
    expect(plain.balance).toBe(20);
    expect(rich).toEqual(plain);
  });

  it('spending leaves the saved bankroll and Reps as they were', () => {
    const NOW = Date.parse('2026-10-12T20:00:00Z');
    const ctx: ApplyContext = { now: NOW, dayOf, scenarios: SCENARIOS, leakPrinciple: null };
    const s0 = { ...emptySession(), bankroll: 12_345 as SessionState['bankroll'] };
    const bought = spendItem({ ...s0.progression.cosmetics, chalk: { balance: chalk(200), day: null, earnedToday: chalk(0) } }, 'back-linen', day(1));
    const next: SessionState = { ...s0, progression: { ...s0.progression, cosmetics: bought } };
    const out: SessionState = { ...next, progression: applyProgress(s0, next, {}, ctx).progression };
    expect(out.bankroll).toBe(12_345);
    expect(out.progression.reps).toEqual(s0.progression.reps);
    expect(out.progression.cosmetics.chalk.balance).toBe(50);
  });

  it('the 4 am boundary: a hand before it pays into the previous day, not today', () => {
    const NOW = Date.parse('2026-10-12T04:30:00Z');
    const ctx: ApplyContext = { now: NOW, dayOf, scenarios: SCENARIOS, leakPrinciple: null };
    const s0 = emptySession();
    const out = applyProgress(s0, { ...s0, hands: [hand(Date.parse('2026-10-12T03:50:00Z'), 3), hand(Date.parse('2026-10-12T04:10:00Z'), 1)] }, {}, ctx).progression;
    expect(out.reps.total).toBe(40);
    expect(out.cosmetics.chalk).toEqual({ balance: 10, day: dayOf(NOW), earnedToday: 10 });
  });

  it('today’s awards still pay when older days’ awards fill the bounded log', () => {
    let r = defaultProgression().reps;
    for (let i = 0; i < 600; i++) r = award(r, `old:${i}`, 10, day(i % 50));
    r = award(r, 'today', 90, day(100));
    expect(earnChalk(ledger0(), r, day(100)).balance).toBe(90);
  });

  it('no module but units.ts casts a number into a unit', () => {
    const SRC = path.resolve(__dirname, '../../src');
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []));
    const casting = walk(SRC).filter((f) => !f.endsWith('core/units.ts') && /\bas\s+(Chips|Reps|Chalk)\b/.test(fs.readFileSync(f, 'utf-8')));
    expect(casting.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
