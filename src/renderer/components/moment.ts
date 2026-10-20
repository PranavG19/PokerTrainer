import type { FinishedSession } from '../../core/progression/streak.js';

/**
 * THE CELEBRATION MOMENT (1.10): a session ended, so the equipped celebration plays once.
 *
 * - **Session end only.** The host calls it with the sessions a save just finished (`applyProgress` → `finished`): the
 *   whole Ticket, an assessment block, a story table played to its end, or the day's twelfth hand. Never a verdict,
 *   a pot, a win or a grade.
 * - **Never over a verdict.** While a verdict is on screen (the table's sheet, or the coach panel holding a costly
 *   verdict) the moment waits, and plays the moment it closes (often as the next hand deals; it is click-through and
 *   covers no control). If one is still up after WAIT_MS the moment is dropped.
 * - **At most 1600 ms** (`--dur-moment`), transform and opacity only, click-through, factual copy, no confetti, coins,
 *   gold or count-ups. Reduced motion: the words show, still, for the same time.
 * - **Sound only behind the switch:** the host passes `sound` only when the learner turned sound on.
 * - The look is the equipped celebration's tokens (`html[data-celebration]`, styles-cosmetics.css); nothing here
 *   chooses one.
 */

export const MOMENT_MS = 1600;
/** How long a moment waits for a verdict to close before it is dropped. */
export const WAIT_MS = 30_000;
const POLL_MS = 250;

const WHAT: Record<FinishedSession, string> = {
  ticket: 'Today’s Ticket, done',
  assessment: 'An assessment block, done',
  'story-table': 'A story table, played to the end',
  'table-hands': 'Twelve hands today',
};

/** A verdict the learner is reading: the table's sheet, or a costly verdict in the coach panel. */
export function verdictOnScreen(doc: Document = document): boolean {
  if (doc.querySelector('[data-sheet="verdict"]')) return true;
  const coach = doc.querySelector<HTMLElement>('.table-screen .coach[data-severity="notable"], .table-screen .coach[data-severity="serious"]');
  return coach !== null && !coach.hidden && coach.offsetParent !== null;
}

let pending: number | null = null;

/**
 * Play the moment for what just finished, once. A second call while one waits or plays replaces it (two sessions
 * ending in one save are one moment).
 */
export function playMoment(opts: { readonly finished: readonly FinishedSession[]; readonly streak: number; readonly sound?: () => void }): void {
  if (opts.finished.length === 0) return;
  if (pending !== null) window.clearTimeout(pending);
  const started = Date.now();
  const tryShow = (): void => {
    pending = null;
    if (verdictOnScreen()) {
      if (Date.now() - started < WAIT_MS) pending = window.setTimeout(tryShow, POLL_MS);
      return;
    }
    show(opts);
  };
  tryShow();
}

function show(opts: { readonly finished: readonly FinishedSession[]; readonly streak: number; readonly sound?: () => void }): void {
  document.querySelector('[data-testid="moment"]')?.remove();
  const root = document.createElement('div');
  root.className = 'moment';
  root.dataset.testid = 'moment';
  root.dataset.finished = opts.finished.join(' ');
  root.setAttribute('role', 'status');
  const title = document.createElement('div');
  title.className = 'moment-title';
  title.textContent = 'Session done';
  const line = document.createElement('div');
  line.className = 'moment-line';
  line.textContent = [WHAT[opts.finished[0]], opts.streak > 0 ? `${opts.streak}-day streak` : null].filter(Boolean).join(' · ');
  const mark = document.createElement('span');
  mark.className = 'moment-mark';
  mark.setAttribute('aria-hidden', 'true');
  root.append(title, mark, line);
  document.body.appendChild(root);
  opts.sound?.();
  window.setTimeout(() => root.remove(), MOMENT_MS);
}
