// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHome } from '../../src/renderer/screens/home.js';
import { deserialize } from '../../src/core/session.js';
import type { SessionPlan } from '../../src/core/sessionPlan.js';

/**
 * REAL ORACLE for BACKLOG #1: the session planner is built and displayed, but Start used to discard
 * it — home.ts wired the planner's Start straight to onNewSession(), so the planned config never
 * reached the launched session. These tests record what the planner's Start actually hands back and
 * assert it is the ASSEMBLED plan (with the whole-task live-hand count core modelled), not a
 * zero-argument default. They fail against the pre-fix home (which threads nothing) and pass only
 * once the plan is wired through to a planned-start handler.
 */

function click(root: HTMLElement, selector: string): void {
  const el = root.querySelector<HTMLElement>(selector);
  if (el === null) throw new Error(`missing ${selector}`);
  el.click();
}

/** Drive the on-screen planner to a 50-minute session, which core models with 3 whole-task hands. */
function selectFiftyMinuteSession(root: HTMLElement): void {
  click(root, '[data-testid="length-btn"][data-minutes="50"]');
}

describe('session planner Start threads the assembled plan into session start', () => {
  let planned: SessionPlan[];
  let defaultStarts: number;
  let root: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    planned = [];
    defaultStarts = 0;
    root = renderHome({
      session: deserialize({}),
      onNewSession: () => {
        defaultStarts += 1;
      },
      onStartPlanned: (plan) => {
        planned.push(plan);
      },
    });
    document.body.appendChild(root);
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('hands the planned config (not the default) to the planned-start handler', () => {
    selectFiftyMinuteSession(root);
    click(root, '[data-testid="plan-start"]');

    expect(planned).toHaveLength(1);
    // The default, plan-less New session path must NOT be the one that fires for a planned start —
    // that collapse is the exact bug (home.ts discarded the plan and called onNewSession()).
    expect(defaultStarts).toBe(0);
  });

  it('the threaded plan carries the whole-task live-hand count core modelled (3 at 50 min)', () => {
    selectFiftyMinuteSession(root);
    click(root, '[data-testid="plan-start"]');

    const plan = planned[0];
    expect(plan.requestedMinutes).toBe(50);
    expect(plan.mode).toBe('session');
    const wholeTask = plan.blocks.find((b) => b.kind === 'whole-task');
    expect(wholeTask?.units, 'a 50-minute session models 3 whole-task live hands').toBe(3);
  });
});
