import type { Grade } from '../../core/coach.js';

/**
 * The coach panel. The silence rule is the feature: a 'free' grade (<0.5bb) produces no output at
 * all. Flagging harmless deviations would teach a beginner that every decision carries equal
 * weight, which is exactly the habit that makes losing players.
 *
 * The message element always exists in the DOM; when silent its text is empty and the panel root
 * is hidden. One line of guidance only — a beginner reading a paragraph mid-hand reads nothing.
 */
export function renderCoachPanel(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'coach';
  root.dataset.severity = 'none';
  root.hidden = true;

  const message = document.createElement('div');
  message.className = 'coach-message';
  message.dataset.testid = 'coach-message';
  message.textContent = '';
  root.appendChild(message);

  const principle = document.createElement('div');
  principle.className = 'coach-principle';
  principle.textContent = '';
  root.appendChild(principle);

  return root;
}

export function showGrade(el: HTMLElement, grade: Grade): void {
  if (grade.severity === 'free' || grade.message === null) {
    clearCoach(el);
    return;
  }

  const message = el.querySelector<HTMLElement>('[data-testid="coach-message"]');
  const principle = el.querySelector<HTMLElement>('.coach-principle');
  if (!message || !principle) return;

  el.dataset.severity = grade.severity;
  el.hidden = false;
  message.textContent = grade.message;
  principle.textContent = grade.principle
    ? `${grade.principle} · ${grade.evLossBb.toFixed(1)} bb`
    : `${grade.evLossBb.toFixed(1)} bb`;
}

export function clearCoach(el: HTMLElement): void {
  const message = el.querySelector<HTMLElement>('[data-testid="coach-message"]');
  const principle = el.querySelector<HTMLElement>('.coach-principle');
  if (message) message.textContent = '';
  if (principle) principle.textContent = '';
  el.dataset.severity = 'none';
  el.hidden = true;
}
