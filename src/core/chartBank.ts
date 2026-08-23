/**
 * PREFLOP CHART BANK — BACKLOG #5 (the curated, static teaching-chart artifact).
 *
 * A browsable CATALOG of standard preflop ranges the learner can select and drill against: the five
 * raise-first-in charts (one per opening seat) plus six facing-a-raise (vs-RFI) response charts. It is
 * a thin surface over core/preflop.ts and adds NO poker maths of its own — every "correct action" here
 * is resolved by the same `isInRfiRange` / `defenseAction` queries the existing Charts screen and the
 * live grader use, so the bank and the rest of the app can never disagree about a cell.
 *
 * WHY NOT src/core/bank.ts. bank.ts models the POSTFLOP solver bank: a node is keyed by
 * `(positions × action history × board class × size bucket)` and carries mandatory solver provenance —
 * `solverConfigId`, `iterations`, `exploitability`, `referencePopId` — because its whole reason to
 * exist is to REFUSE to grade a node that has no solve behind it (PRODUCT-SPEC B4, story 27). These
 * charts are the opposite kind of artifact: hand-authored teaching ranges with a documented published
 * posture (see preflop.ts's header), no board and no size bucket (they are preflop), and no solver run
 * at all. Wiring them through bank.ts would mean inventing an `exploitability` and an `iterations` for
 * a range nobody solved — which is precisely the fabricated-provenance move bank.ts was built to
 * forbid. So the two banks stay separate: bank.ts refuses ungraded postflop nodes; this catalogs the
 * preflop charts the app can teach honestly today.
 *
 * SOURCE / POSTURE. The range values are preflop.ts's: the widely published 100bb 6-max GTO-derived
 * RFI family (Upswing / GTO Wizard style), purified to whole-in / whole-out cells (no mixed
 * frequencies), and the adversarially-verified beginner defense simplification. These are TEACHING
 * charts, not a live solver — read a verdict as the standard line, not a claim of GTO optimality.
 *
 * Pure data plus total queries. No clock, no randomness (the drill's sampler lives in the screen).
 */

import {
  ALL_COMBOS,
  RFI_POSITIONS,
  comboWeight,
  defenseAction,
  defenseWidth,
  isCombo,
  isInRfiRange,
  rfiWidth,
  type Combo,
  type DefensePosition,
  type RfiPosition,
} from './preflop.js';

/** The two chart families the bank ships: opening ranges, and facing-a-raise responses. */
export type ChartCategory = 'rfi' | 'defense';

/**
 * Every action any chart in the bank can call for. RFI charts use {open, fold}; defense charts use
 * {threebet, call, fold} — the exact strings `preflop.defenseAction` already returns, so no remap.
 */
export type ChartAction = 'open' | 'threebet' | 'call' | 'fold';

/**
 * What preflop.ts query backs a chart. Kept as data (not a stored closure) so the catalog stays plain,
 * serializable values and the resolver dispatches on `kind`.
 */
export type ChartSource =
  | { readonly kind: 'rfi'; readonly position: RfiPosition }
  | { readonly kind: 'defense'; readonly spot: DefensePosition };

export interface PreflopChart {
  /** Stable id used for selection and persistence, e.g. 'rfi-CO', 'def-bb-vs-btn'. */
  readonly id: string;
  /** Human label for the browse list, e.g. 'CO — open first in', 'BB vs BTN open'. */
  readonly label: string;
  readonly category: ChartCategory;
  readonly source: ChartSource;
  /** The legal choices for this chart, in display / keyboard order. The drill grades against these. */
  readonly actions: readonly ChartAction[];
}

const RFI_ACTIONS: readonly ChartAction[] = ['open', 'fold'];
const DEFENSE_ACTIONS: readonly ChartAction[] = ['threebet', 'call', 'fold'];

/** The six facing-a-raise (vs-RFI) response charts, in browse order (BB defenses, then blind-vs-blind). */
const DEFENSE_SPOTS: readonly { spot: DefensePosition; label: string }[] = [
  { spot: 'bb-vs-utg', label: 'BB vs UTG open' },
  { spot: 'bb-vs-hj', label: 'BB vs HJ open' },
  { spot: 'bb-vs-co', label: 'BB vs CO open' },
  { spot: 'bb-vs-btn', label: 'BB vs BTN open' },
  { spot: 'bb-vs-sb', label: 'BB vs SB open' },
  { spot: 'sb-vs-btn', label: 'SB vs BTN open' },
];

/**
 * THE BANK. RFI charts first (opening seat order), then the vs-RFI responses. Built from preflop.ts's
 * own position/spot lists, never a pasted list, so adding a range there is the only edit needed.
 */
export const CHART_BANK: readonly PreflopChart[] = [
  ...RFI_POSITIONS.map(
    (position): PreflopChart => ({
      id: `rfi-${position}`,
      label: `${position} — open first in`,
      category: 'rfi',
      source: { kind: 'rfi', position },
      actions: RFI_ACTIONS,
    }),
  ),
  ...DEFENSE_SPOTS.map(
    ({ spot, label }): PreflopChart => ({
      id: `def-${spot}`,
      label,
      category: 'defense',
      source: { kind: 'defense', spot },
      actions: DEFENSE_ACTIONS,
    }),
  ),
];

const BY_ID: ReadonlyMap<string, PreflopChart> = new Map(CHART_BANK.map((c) => [c.id, c]));

/** The bank's first chart — the browse default and the fallback for an unknown persisted selection. */
export const DEFAULT_CHART_ID = CHART_BANK[0].id;

export function chartById(id: string): PreflopChart | undefined {
  return BY_ID.get(id);
}

/**
 * The standard action for a combo on this chart. Delegates entirely to preflop.ts: RFI is
 * open-or-fold via `isInRfiRange`; defense is threebet/call/fold via `defenseAction`. Throws on a
 * combo outside the 169-cell domain, so a typo is caught here rather than silently graded.
 */
export function correctAction(chart: PreflopChart, combo: Combo): ChartAction {
  if (!isCombo(combo)) throw new Error(`not a canonical starting hand: ${combo}`);
  if (chart.source.kind === 'rfi') {
    return isInRfiRange(combo, chart.source.position) ? 'open' : 'fold';
  }
  return defenseAction(combo, chart.source.spot);
}

/** Combo-weighted share of hands that DO something other than fold — the number a chart calls its width. */
export function chartWidth(chart: PreflopChart): number {
  return chart.source.kind === 'rfi'
    ? rfiWidth(chart.source.position)
    : defenseWidth(chart.source.spot);
}

export interface ChartCell {
  readonly combo: Combo;
  readonly action: ChartAction;
}

/** All 169 cells with their standard action, in ALL_COMBOS order. The grid and the integrity tests share it. */
export function chartCells(chart: PreflopChart): readonly ChartCell[] {
  return ALL_COMBOS.map((combo) => ({ combo, action: correctAction(chart, combo) }));
}

// ---------------------------------------------------------------------------
// Drill scoring
// ---------------------------------------------------------------------------

export interface DrillGrade {
  readonly chartId: string;
  readonly combo: Combo;
  readonly correct: ChartAction;
  readonly chose: ChartAction;
  readonly right: boolean;
}

/**
 * Grade one drill answer. Throws if the chosen action is not one this chart offers — grading a
 * choice the chart cannot present would score the learner against a decision they were never shown.
 */
export function gradeChartAnswer(chart: PreflopChart, combo: Combo, chose: ChartAction): DrillGrade {
  if (!chart.actions.includes(chose)) {
    throw new Error(`action ${chose} is not offered by chart ${chart.id}`);
  }
  const correct = correctAction(chart, combo);
  return { chartId: chart.id, combo, correct, chose, right: chose === correct };
}

// ---------------------------------------------------------------------------
// Persistence (selection + per-chart scoreboard)
// ---------------------------------------------------------------------------

export interface ChartTally {
  readonly attempts: number;
  readonly correct: number;
}

/**
 * What survives a restart: which chart the learner had open, and their running scoreboard per chart.
 * Serialized to JSON. `deserializeProgress` is defensive — unknown chart ids are dropped, an invalid
 * selection falls back to the default, and tallies are clamped to sane integers — so a hand-edited or
 * stale save can never crash the screen or invent a score.
 */
export interface ChartBankProgress {
  readonly selectedId: string;
  readonly tallies: Readonly<Record<string, ChartTally>>;
}

export const EMPTY_PROGRESS: ChartBankProgress = { selectedId: DEFAULT_CHART_ID, tallies: {} };

export function serializeProgress(progress: ChartBankProgress): string {
  return JSON.stringify(progress);
}

function clampTally(raw: unknown): ChartTally | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const attempts = Math.max(0, Math.floor(Number(record.attempts) || 0));
  // A correct count can never exceed attempts, and never go negative: either would let a stale save
  // paint an impossible accuracy (e.g. 5/3) that the screen would then keep counting up from.
  const correct = Math.min(attempts, Math.max(0, Math.floor(Number(record.correct) || 0)));
  return { attempts, correct };
}

export function deserializeProgress(text: string | null | undefined): ChartBankProgress {
  if (text === null || text === undefined || text === '') return EMPTY_PROGRESS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return EMPTY_PROGRESS;
  }
  if (typeof parsed !== 'object' || parsed === null) return EMPTY_PROGRESS;
  const record = parsed as Record<string, unknown>;

  const tallies: Record<string, ChartTally> = {};
  const rawTallies = record.tallies;
  if (typeof rawTallies === 'object' && rawTallies !== null) {
    for (const [id, value] of Object.entries(rawTallies as Record<string, unknown>)) {
      if (!BY_ID.has(id)) continue; // Drop a tally for a chart the bank no longer ships.
      const tally = clampTally(value);
      if (tally !== null) tallies[id] = tally;
    }
  }

  const selectedId =
    typeof record.selectedId === 'string' && BY_ID.has(record.selectedId)
      ? record.selectedId
      : DEFAULT_CHART_ID;

  return { selectedId, tallies };
}

/** Fold one graded answer into the scoreboard, returning fresh progress (no mutation). */
export function recordAnswer(progress: ChartBankProgress, grade: DrillGrade): ChartBankProgress {
  const prev = progress.tallies[grade.chartId] ?? { attempts: 0, correct: 0 };
  const next: ChartTally = {
    attempts: prev.attempts + 1,
    correct: prev.correct + (grade.right ? 1 : 0),
  };
  return { selectedId: progress.selectedId, tallies: { ...progress.tallies, [grade.chartId]: next } };
}

/** Weighted-combo count of hands taking a given action on a chart — exported for the integrity tests. */
export function actionComboCount(chart: PreflopChart, action: ChartAction): number {
  return chartCells(chart)
    .filter((cell) => cell.action === action)
    .reduce((sum, cell) => sum + comboWeight(cell.combo), 0);
}
