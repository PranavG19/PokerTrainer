import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chalk, chips, reps, type Chalk, type Chips, type Reps } from '../../src/core/units.js';
import { emptySession } from '../../src/core/session.js';

/**
 * The economy's isolation rule: table chips never convert to Reps or Chalk, and neither converts to
 * the other. The `@ts-expect-error` lines are the real test: `npm run typecheck` fails if any of
 * them starts compiling.
 */
describe('chips, Reps and Chalk do not mix', () => {
  it('type-level: no unit is assignable to another, and a bare number is none of them', () => {
    const bankroll: Chips = emptySession().bankroll;
    const r: Reps = reps(10);
    const c: Chalk = chalk(10);

    // @ts-expect-error chips are not Chalk
    const chipsAsChalk: Chalk = bankroll;
    // @ts-expect-error chips are not Reps
    const chipsAsReps: Reps = bankroll;
    // @ts-expect-error Reps are not Chalk (Chalk is earned on its own curve, not 1:1)
    const repsAsChalk: Chalk = r;
    // @ts-expect-error Chalk is not Reps
    const chalkAsReps: Reps = c;
    // @ts-expect-error Chalk never becomes chips
    const chalkAsChips: Chips = c;
    // @ts-expect-error Reps never become chips
    const repsAsChips: Chips = r;
    // @ts-expect-error a bare number is not Chalk: it has to go through the constructor
    const bare: Chalk = 5;
    // @ts-expect-error arithmetic drops the brand, so a sum of chips is not Chalk either
    const summed: Chalk = bankroll + 1;

    // The constructors are the only way in, and they refuse a value that already has a unit.
    // @ts-expect-error chips cannot be minted into Chalk
    const minted = chalk(bankroll);
    // @ts-expect-error chips cannot be minted into Reps
    const repsFromChips = reps(bankroll);
    // @ts-expect-error Reps cannot be minted into Chalk
    const chalkFromReps = chalk(r);
    // @ts-expect-error Chalk cannot be minted into chips
    const chipsFromChalk = chips(c);

    void [chipsAsChalk, chipsAsReps, repsAsChalk, chalkAsReps, chalkAsChips, repsAsChips, bare, summed];
    void [minted, repsFromChips, chalkFromReps, chipsFromChalk];
    expect(bankroll).toBe(10000);
  });

  it('runtime: Reps and Chalk are whole and never negative; chips stay finite', () => {
    expect(reps(-3)).toBe(0);
    expect(reps(2.9)).toBe(2);
    expect(chalk(Number.NaN)).toBe(0);
    expect(chips(Number.POSITIVE_INFINITY, 500)).toBe(500);
    expect(chips(-120)).toBe(-120);
  });

  it('source-level: nothing in the progression namespace reads the bankroll', () => {
    const dir = path.join(import.meta.dirname, '../../src/core/progression');
    const offenders = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .filter((name) => /\bbankroll\b|\bChips\b|\bchips\(/.test(fs.readFileSync(path.join(dir, name), 'utf-8')));
    expect(offenders).toEqual([]);
  });
});
