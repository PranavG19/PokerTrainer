// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderCharts } from '../../src/renderer/screens/charts.js';

/**
 * REAL ORACLE: renderCharts persists a graded RFI answer through the onAnswer/onSpot callbacks. The
 * bug (CONSOLIDATED #4) is that the keyboard commit fired those callbacks even when the RFI grid was
 * not on screen (defense / 3-bet-response modes) or when a modifier key was held — grading a spot the
 * learner never saw. These tests record every callback call and assert it fires ONLY for a real,
 * unmodified RFI keypress, so they fail against the pre-fix code and pass only with the mode/modifier
 * guards in place.
 */

function press(key: string, init: KeyboardEventInit = {}): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

function clickMode(root: HTMLElement, mode: string): void {
  const btn = root.querySelector<HTMLElement>(`[data-testid="charts-mode-btn"][data-mode="${mode}"]`);
  if (btn === null) throw new Error(`mode button ${mode} missing`);
  btn.click();
}

describe('charts commit guard', () => {
  let answers: { handClass: string; correct: boolean }[];
  let spots: { spotClass: string; module: string; correct: boolean }[];
  let root: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    answers = [];
    spots = [];
    root = renderCharts({
      onAnswer: (handClass, correct) => answers.push({ handClass, correct }),
      onSpot: (spotClass, module, correct) => spots.push({ spotClass, module, correct }),
    });
    document.body.appendChild(root);
  });

  afterEach(() => {
    // Detach so the module's self-removing keydown listener unregisters on its next fire.
    root.remove();
    press('x');
  });

  it('grades and persists a real RFI keypress (open)', () => {
    expect(root.dataset.mode).toBe('rfi');
    press('o');
    expect(answers).toHaveLength(1);
    expect(spots).toHaveLength(1);
    expect(spots[0].module).toBe('preflop-rfi');
  });

  it('does NOT grade a keypress in defense mode (RFI grid not on screen)', () => {
    clickMode(root, 'defense');
    expect(root.dataset.mode).toBe('defense');
    press('f');
    press('o');
    expect(answers).toHaveLength(0);
    expect(spots).toHaveLength(0);
  });

  it('does NOT grade a keypress in 3-bet-response mode', () => {
    clickMode(root, '3bet-response');
    expect(root.dataset.mode).toBe('3bet-response');
    press('o');
    press('f');
    expect(answers).toHaveLength(0);
    expect(spots).toHaveLength(0);
  });

  it('resumes grading when the learner returns to RFI mode', () => {
    clickMode(root, 'defense');
    press('o');
    expect(answers).toHaveLength(0);
    clickMode(root, 'rfi');
    press('o');
    expect(answers).toHaveLength(1);
  });

  it('ignores a modifier-held keypress (Cmd/Ctrl/Alt + O/F)', () => {
    press('o', { metaKey: true });
    press('f', { ctrlKey: true });
    press('o', { altKey: true });
    expect(answers).toHaveLength(0);
    expect(spots).toHaveLength(0);
  });
});
