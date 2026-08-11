import { describe, expect, it } from 'vitest';
import {
  buildScenarioTable,
  gradeStep,
  isComplete,
  stackedDeck,
  type Scenario,
} from '../../src/core/puzzle.js';
import { SCENARIOS, scenarioById } from '../../src/core/puzzleScenarios.js';
import {
  applyAction,
  legalActions,
  minRaiseTo,
  type ActionKind,
  type TableState,
} from '../../src/core/table.js';

/**
 * The load-bearing test is "the engine deals exactly what the scenario wrote". Everything about a
 * puzzle being a TEACHING tool depends on the deal being the scripted one — a drift in the engine's
 * burn/pop order would silently teach a different hand than the explanation describes. So the deck
 * stacking is verified by running each scenario through the REAL engine and asserting the holes and
 * the full board come out identical to the scenario, rather than trusting stackedDeck in isolation.
 */

const HERO = 0;

/**
 * Drive a scenario: hero plays the target line, villains play their script. Returns how many target
 * steps the hero actually got to take, so the caller can assert the whole line was reachable. The
 * villain driver is TOLERANT — if a scripted action is illegal at the seat it lands on (villain lines
 * past the taught decision are not the lesson), it substitutes a legal default rather than crashing.
 */
function playScenario(scenario: Scenario): { state: TableState; heroSteps: number } {
  let state = buildScenarioTable(scenario);
  let heroStep = 0;
  let scriptAt = 0;

  for (let guard = 0; guard < 40 && state.winners === null && state.street !== 'showdown'; guard++) {
    const legal = legalActions(state);
    if (legal.length === 0) break;
    if (state.toAct === HERO) {
      const target = scenario.target[heroStep];
      if (target === undefined) break; // target line finished; the rest of the hand is not the lesson
      heroStep += 1;
      state = applyAction(state, legalize(state, target.action));
    } else {
      const scripted = scenario.villainScript[scriptAt];
      scriptAt += 1;
      const kind = scripted?.kind ?? 'fold';
      state = applyAction(state, legalize(state, kind, scripted?.to));
    }
  }
  return { state, heroSteps: heroStep };
}

/** Coerce an intended action to a legal engine Action for the seat currently to act. */
function legalize(state: TableState, kind: ActionKind, to?: number): { kind: ActionKind; amount?: number } {
  const legal = legalActions(state);
  if (kind === 'raise' || kind === 'bet') {
    if (legal.includes('raise')) return { kind: 'raise', amount: to ?? minRaiseTo(state) };
    if (legal.includes('bet')) return { kind: 'bet', amount: to ?? minRaiseTo(state) };
    // Cannot raise (e.g. capped or all-in short): call if we can, else check, else fold.
    return { kind: legal.includes('call') ? 'call' : legal.includes('check') ? 'check' : 'fold' };
  }
  if (kind === 'check' && !legal.includes('check')) return { kind: legal.includes('call') ? 'call' : 'fold' };
  if (kind === 'call' && !legal.includes('call')) return { kind: legal.includes('check') ? 'check' : 'fold' };
  return { kind };
}

describe('the deck is stacked so the engine deals exactly the scripted scenario', () => {
  it('every scenario deals its exact holes to every seat', () => {
    for (const scenario of SCENARIOS) {
      const state = buildScenarioTable(scenario);
      for (let seat = 0; seat < scenario.seatCount; seat++) {
        expect(state.seats[seat].hole, `${scenario.id} seat ${seat}`).toEqual([
          ...scenario.holes[seat],
        ]);
      }
    }
  });

  it('the board runs out exactly as written when the hand is played to the end', () => {
    for (const scenario of SCENARIOS) {
      // Force a full runout by having everyone check/call: build a table where the hero and villains
      // never fold, so all five board cards are dealt and can be checked against the script.
      const state = buildScenarioTable(scenario);
      // Run the board out directly through the engine's own dealing by advancing streets via checks.
      const runout = forceRunout(state);
      expect(runout.slice(0, scenario.board.length), scenario.id).toEqual([...scenario.board]);
    }
  });

  it('the board cards sit in the deck and no shown card is ever used as a burn', () => {
    for (const scenario of SCENARIOS) {
      const deck = stackedDeck(scenario);
      // Holes are already dealt by startHand, so the deck holds them no longer; the board must be
      // present exactly once, and no hole card may reappear (a reappearing hole would be a burn/board
      // collision that duplicates a card in play).
      for (const card of scenario.board) {
        expect(deck.filter((c) => c === card).length, `${scenario.id}: board ${card}`).toBe(1);
      }
      for (const hole of scenario.holes.flat()) {
        expect(deck.includes(hole), `${scenario.id}: hole ${hole} leaked back into the deck`).toBe(
          false,
        );
      }
      expect(new Set(deck).size, `${scenario.id}: deck has no duplicates`).toBe(deck.length);
    }
  });
});

/** Check/call every seat to the river so the engine deals the whole board, then read it back. */
function forceRunout(start: TableState): string[] {
  let state = start;
  for (let guard = 0; guard < 60 && state.street !== 'showdown' && state.winners === null; guard++) {
    const legal = legalActions(state);
    if (legal.length === 0) break;
    const kind: ActionKind = legal.includes('check') ? 'check' : legal.includes('call') ? 'call' : legal[0];
    state = applyAction(state, { kind });
  }
  return state.board;
}

describe('scenarios play out along their target line', () => {
  it('the hero can actually reach every step of each target line', () => {
    for (const scenario of SCENARIOS) {
      const { heroSteps } = playScenario(scenario);
      // Every taught decision must be reachable by playing the line — a scenario whose script ends
      // the hand before the hero's last target step would teach a step the learner can never take.
      expect(heroSteps, `${scenario.id}: reached ${heroSteps}/${scenario.target.length} steps`).toBe(
        scenario.target.length,
      );
    }
  });
});

describe('step grading matches the target line', () => {
  const scenario = scenarioById('bb-defend-vs-btn');
  if (scenario === undefined) throw new Error('fixture missing');

  it('a matching action is correct and carries the explanation', () => {
    const v = gradeStep(scenario, 0, 'call');
    expect(v.correct).toBe(true);
    expect(v.expected).toBe('call');
    expect(v.explanation.length).toBeGreaterThan(20);
  });

  it('a mismatching action is wrong but STILL carries the explanation — the reason is always taught', () => {
    const v = gradeStep(scenario, 0, 'fold');
    expect(v.correct).toBe(false);
    expect(v.played).toBe('fold');
    expect(v.expected).toBe('call');
    expect(v.explanation.length).toBeGreaterThan(20);
  });

  it('the second step grades independently of the first', () => {
    expect(gradeStep(scenario, 1, 'bet').correct).toBe(true);
    expect(gradeStep(scenario, 1, 'check').correct).toBe(false);
  });

  it('an out-of-range step is a caller bug, not a silent miss', () => {
    expect(() => gradeStep(scenario, 99, 'bet')).toThrow(/no target step/);
  });

  it('isComplete is true only once every target step has been graded', () => {
    expect(isComplete(scenario, 0)).toBe(false);
    expect(isComplete(scenario, scenario.target.length - 1)).toBe(false);
    expect(isComplete(scenario, scenario.target.length)).toBe(true);
  });
});

describe('scenario validation rejects a malformed puzzle', () => {
  const base = scenarioById('btn-open-aks');
  if (base === undefined) throw new Error('fixture missing');

  it('a duplicated card across holes and board throws', () => {
    const dup: Scenario = { ...base, board: [base.holes[0][0], 'Kd', '7c', '2h', '9s'] };
    expect(() => buildScenarioTable(dup)).toThrow(/appears twice/);
  });

  it('a hole/seat count mismatch throws', () => {
    const bad: Scenario = { ...base, seatCount: 4 };
    expect(() => buildScenarioTable(bad)).toThrow(/holes for/);
  });

  it('an empty target line throws', () => {
    const bad: Scenario = { ...base, target: [] };
    expect(() => buildScenarioTable(bad)).toThrow(/target line is empty/);
  });
});
