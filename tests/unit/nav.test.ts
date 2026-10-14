import { describe, expect, it } from 'vitest';
import { litSubItem, OLD_TABS, SECTIONS, sectionOf, STUDY_NAV, subNavOf, YOU_NAV, type Leaf } from '../../src/renderer/nav.js';
import { sureRight, weeklyEvLoss } from '../../src/core/progression/decisions.js';
import { emptyCalibration } from '../../src/core/predict.js';

describe('navigation: seven sections, the You sub-nav, every old tab folded in (1.14, N1)', () => {
  it('has the owner’s seven sections in order and the owner’s You sub-nav in order', () => {
    expect(SECTIONS.map((s) => s.label)).toEqual(['Home', 'Play', 'Learn', 'Story', 'Train', 'Study', 'You']);
    expect(YOU_NAV.map((i) => i.label)).toEqual(['Profile', 'Trophies', 'Style', 'Hands', 'Letters', 'Rivals', 'Locker', 'Dee']);
  });

  it('every one of the thirteen old tabs (Pro included) has a path, ending on a button that exists', () => {
    const buttons = new Set([
      ...SECTIONS.map((s) => s.testid),
      ...STUDY_NAV.map((i) => i.testid),
      ...YOU_NAV.map((i) => i.testid),
      'tab-charts', // the Train rail rung
      'tab-progress', // Profile's link
      'tab-settings', // the title-bar button
    ]);
    expect(Object.keys(OLD_TABS)).toHaveLength(13);
    for (const [old, path] of Object.entries(OLD_TABS)) {
      expect(path.length, old).toBeGreaterThan(0);
      expect(path.length, old).toBeLessThanOrEqual(2);
      for (const id of path) expect(buttons.has(id), `${old} → ${id}`).toBe(true);
    }
  });

  it('every leaf belongs to one section (Settings to none) and lights the right sub-nav item', () => {
    const leaves: Leaf[] = ['home', 'play', 'learn', 'story', 'train', ...STUDY_NAV.map((i) => i.leaf), ...YOU_NAV.map((i) => i.leaf), 'progress'];
    for (const l of leaves) expect(sectionOf(l)).not.toBeNull();
    expect(sectionOf('settings')).toBeNull();
    expect(subNavOf('equity')).toBe(STUDY_NAV);
    expect(subNavOf('progress')).toBe(YOU_NAV);
    expect(subNavOf('home')).toBeNull();
    expect(litSubItem('progress')).toBe('profile');
  });
});

describe('decisions, not results (Profile)', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const WEEK = 7 * 86_400_000;
  it('weekly EV loss is bb per 100 decisions, oldest week first, empty weeks skipped', () => {
    const d = (at: number, ev: number) => ({ at, evLossBb: ev, correct: ev === 0 });
    const pts = weeklyEvLoss([d(now - 3 * WEEK, 0.1), d(now - 3 * WEEK, 0.05), d(now - 1000, 0.02)], now);
    expect(pts).toEqual([
      { weeksAgo: 3, bbPer100: 7.5, decisions: 2 },
      { weeksAgo: 0, bbPer100: 2, decisions: 1 },
    ]);
    expect(weeklyEvLoss([], now)).toEqual([]);
  });

  it('Sure right is null before any Sure call, a whole percent after', () => {
    expect(sureRight(emptyCalibration())).toBeNull();
    expect(sureRight({ ...emptyCalibration(), sureTotal: 30, sureCorrect: 26 })).toBe(87);
  });
});
