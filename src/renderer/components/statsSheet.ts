import type { Card } from '../../core/cards.js';
import { equityVsRandom } from '../../core/equity.js';

/**
 * 800 iterations, not the 2000 the core grader defaults to. The tradeoff:
 * - Cost: this runs synchronously on the renderer thread on every street change. Measured 9-18ms
 *   at 800 iters vs 5 opponents (worst case preflop), i.e. roughly one frame. 2000 iters would be
 *   ~45ms, a visible stutter during the deal.
 * - Accuracy: 800 Bernoulli samples give a standard error of ~1.7% near 50% equity, so the
 *   displayed integer can drift a couple of points run to run. That is acceptable for a coaching
 *   readout meant to convey magnitude ("you're ahead") — but it is why gradeDecision, whose
 *   output is scored in bb, keeps its own 2000-iteration estimate instead of reusing this one.
 */
const ITERATIONS = 800;

/** Categories rarer than this are noise on a beginner's screen. */
const MIN_SHOWN_CHANCE = 0.01;

export function renderStatsSheet(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'sheet stats-sheet';
  root.dataset.testid = 'stats-sheet';
  root.dataset.open = 'true';

  const header = document.createElement('button');
  header.className = 'stats-header';
  header.type = 'button';
  header.addEventListener('click', () => toggleStatsSheet(root));

  const winBlock = document.createElement('div');
  winBlock.className = 'stats-win';

  const winLabel = document.createElement('div');
  winLabel.className = 'stat-label';
  winLabel.textContent = 'Win';
  winBlock.appendChild(winLabel);

  const winValue = document.createElement('div');
  winValue.className = 'stats-win-value';
  winValue.dataset.testid = 'win-pct';
  winValue.textContent = '—';
  winBlock.appendChild(winValue);

  const tieBlock = document.createElement('div');
  tieBlock.className = 'stats-tie';

  const tieLabel = document.createElement('div');
  tieLabel.className = 'stat-label';
  tieLabel.textContent = 'Tie';
  tieBlock.appendChild(tieLabel);

  const tieValue = document.createElement('div');
  tieValue.className = 'stat-value';
  tieValue.textContent = '—';
  tieBlock.appendChild(tieValue);

  header.appendChild(winBlock);
  header.appendChild(tieBlock);
  root.appendChild(header);

  const body = document.createElement('div');
  body.className = 'stats-body';
  root.appendChild(body);

  return root;
}

export function updateStatsSheet(
  el: HTMLElement,
  opts: { hole: Card[]; board: Card[]; opponents: number; seed: number },
): void {
  const winValue = el.querySelector<HTMLElement>('[data-testid="win-pct"]');
  const tieValue = el.querySelector<HTMLElement>('.stats-tie .stat-value');
  const body = el.querySelector<HTMLElement>('.stats-body');
  if (!winValue || !tieValue || !body) return;

  body.replaceChildren();

  // Between hands the hero has no cards; equityVsRandom would happily report a
  // meaningless number for an empty hand, so show nothing instead.
  if (opts.hole.length === 0) {
    winValue.textContent = '—';
    tieValue.textContent = '—';
    return;
  }

  const eq = equityVsRandom(opts.hole, opts.board, opts.opponents, ITERATIONS, opts.seed);

  winValue.textContent = `${Math.round(eq.win * 100)}%`;
  tieValue.textContent = `${Math.round(eq.tie * 100)}%`;

  const categories = Object.entries(eq.categoryChances)
    .filter(([, chance]) => chance >= MIN_SHOWN_CHANCE)
    .sort((a, b) => b[1] - a[1]);

  for (const [name, chance] of categories) {
    body.appendChild(categoryRow(name, chance));
  }
}

export function toggleStatsSheet(el: HTMLElement, open?: boolean): void {
  const next = open ?? el.dataset.open !== 'true';
  el.dataset.open = String(next);
}

function categoryRow(name: string, chance: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'stats-cat';

  const label = document.createElement('span');
  label.className = 'stat-label';
  label.textContent = name;
  row.appendChild(label);

  const pct = document.createElement('span');
  pct.className = 'stats-cat-pct';
  pct.textContent = `${Math.round(chance * 100)}%`;
  row.appendChild(pct);

  return row;
}
