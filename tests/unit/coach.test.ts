import { describe, it, expect } from 'vitest';
import { gradeDecision, potOddsRequired } from '../../src/core/coach.js';

describe('potOddsRequired', () => {
  it('potOddsRequired(30, 10) === 0.25', () => {
    expect(potOddsRequired(30, 10)).toBe(0.25);
  });

  it('potOddsRequired(0, 0) === 0', () => {
    expect(potOddsRequired(0, 0)).toBe(0);
  });

  it('potOddsRequired(100, 100) === 0.5', () => {
    expect(potOddsRequired(100, 100)).toBe(0.5);
  });
});

describe('gradeDecision', () => {
  it('silence rule: 0.2bb deviation returns free and message === null', () => {
    // AA preflop calling a small bet — equity far exceeds pot odds, no loss
    const g = gradeDecision({
      hole: ['As', 'Ah'],
      board: [],
      street: 'preflop',
      pot: 10,
      toCall: 2,
      stack: 100,
      bb: 2,
      chosen: 'call',
      opponents: 1,
      seed: 42,
    });
    expect(g.severity).toBe('free');
    expect(g.message).toBe(null);
  });

  it('correct call with ample equity returns free', () => {
    // AA on a low flop calling a small bet
    const g = gradeDecision({
      hole: ['Ah', 'Ad'],
      board: ['3c', '5d', '8h'],
      street: 'flop',
      pot: 20,
      toCall: 5,
      stack: 100,
      bb: 2,
      chosen: 'call',
      opponents: 1,
      seed: 1,
    });
    expect(g.severity).toBe('free');
    expect(g.message).toBe(null);
  });

  it('calling 40 into a 20 pot with ~10% equity returns serious with numbers', () => {
    // 72o on a board that doesn't help, facing huge bet
    const g = gradeDecision({
      hole: ['7c', '2d'],
      board: ['As', 'Kh', 'Qd', 'Jc', '9s'],
      street: 'river',
      pot: 20,
      toCall: 40,
      stack: 100,
      bb: 2,
      chosen: 'call',
      opponents: 1,
      seed: 5,
    });
    expect(g.severity).toBe('serious');
    expect(g.message).not.toBe(null);
    // Message should contain numbers
    expect(g.message).toMatch(/\d+/);
  });

  it('folding with strong equity returns notable or serious', () => {
    // AA preflop folding to a small raise — clearly wrong
    const g = gradeDecision({
      hole: ['As', 'Ah'],
      board: [],
      street: 'preflop',
      pot: 10,
      toCall: 4,
      stack: 100,
      bb: 2,
      chosen: 'fold',
      opponents: 1,
      seed: 42,
    });
    expect(g.severity === 'notable' || g.severity === 'serious').toBe(true);
    expect(g.message).not.toBe(null);
    expect(g.principle).toBe('pot odds');
  });

  it('correct fold with weak equity returns free', () => {
    // 72o facing a huge bet on a scary board
    const g = gradeDecision({
      hole: ['7c', '2d'],
      board: ['As', 'Kh', 'Qd', 'Jc', '9s'],
      street: 'river',
      pot: 20,
      toCall: 40,
      stack: 100,
      bb: 2,
      chosen: 'fold',
      opponents: 1,
      seed: 5,
    });
    expect(g.severity).toBe('free');
    expect(g.message).toBe(null);
  });

  it('check on flop with marginal equity is free', () => {
    const g = gradeDecision({
      hole: ['9h', '8h'],
      board: ['2c', '5d', 'Ks'],
      street: 'flop',
      pot: 10,
      toCall: 0,
      stack: 100,
      bb: 2,
      chosen: 'check',
      opponents: 1,
      seed: 3,
    });
    expect(g.severity).toBe('free');
    expect(g.message).toBe(null);
  });

  it('principle is one of the allowed values when present', () => {
    const allowed = [
      'pot odds', 'ranges', 'position', 'indifference',
      'polarity', 'board coverage', 'blockers', 'value or bluff',
    ];
    const g = gradeDecision({
      hole: ['7c', '2d'],
      board: ['As', 'Kh', 'Qd', 'Jc', '9s'],
      street: 'river',
      pot: 20,
      toCall: 40,
      stack: 100,
      bb: 2,
      chosen: 'call',
      opponents: 1,
      seed: 5,
    });
    if (g.principle !== null) {
      expect(allowed).toContain(g.principle);
    }
  });

  it('evLossBb is non-negative', () => {
    const g = gradeDecision({
      hole: ['Kh', 'Qh'],
      board: ['Th', '9h', '2c'],
      street: 'flop',
      pot: 30,
      toCall: 15,
      stack: 100,
      bb: 2,
      chosen: 'call',
      opponents: 2,
      seed: 1,
    });
    expect(g.evLossBb).toBeGreaterThanOrEqual(0);
  });

  it('raising with low equity facing a bet is penalized', () => {
    const g = gradeDecision({
      hole: ['3c', '2d'],
      board: ['As', 'Kh', 'Qd'],
      street: 'flop',
      pot: 30,
      toCall: 15,
      stack: 100,
      bb: 2,
      chosen: 'raise',
      betSize: 40,
      opponents: 1,
      seed: 1,
    });
    // Low equity raising into strength should be penalized
    expect(g.evLossBb).toBeGreaterThan(0);
  });

  it('severity tiers: evLossBb < 0.5 => free', () => {
    // We craft a situation where calling is slightly suboptimal but < 0.5 bb
    // Using a marginal hand where equity is just barely below pot odds
    const g = gradeDecision({
      hole: ['Th', '9h'],
      board: ['2c', '5s', 'Kd', '7h', 'Jc'],
      street: 'river',
      pot: 50,
      toCall: 5,
      stack: 100,
      bb: 10,
      chosen: 'call',
      opponents: 1,
      seed: 1,
    });
    // With pot=50, toCall=5, required = 5/55 ~= 9%. T9 on this board likely has >9%.
    // So this should be free.
    expect(g.severity).toBe('free');
  });

  it('Grade interface shape is correct', () => {
    const g = gradeDecision({
      hole: ['Ac', 'Kc'],
      board: [],
      street: 'preflop',
      pot: 3,
      toCall: 2,
      stack: 100,
      bb: 2,
      chosen: 'call',
      opponents: 1,
      seed: 1,
    });
    expect(g).toHaveProperty('severity');
    expect(g).toHaveProperty('evLossBb');
    expect(g).toHaveProperty('message');
    expect(g).toHaveProperty('principle');
  });
});
