import type { Grade } from '../../core/coach.js';
import type { ReasonAdjustedGrade } from '../../core/reasonGrade.js';

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

  // G4's separate reason verdict (story 14). Its own element so it renders independently of the EV
  // grade above: a decision can be EV-free yet "right for the wrong reason", which is precisely the
  // case the panel must be able to show when the severity line is silent.
  const reasonNote = document.createElement('div');
  reasonNote.className = 'coach-reason-note';
  reasonNote.dataset.testid = 'coach-reason-note';
  reasonNote.textContent = '';
  reasonNote.hidden = true;
  root.appendChild(reasonNote);

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

/**
 * G4's reason verdict, rendered separately from the EV grade (story 14: "graded separately from my
 * action"). Called AFTER showGrade so it can reveal the panel even when the EV grade was free and
 * silent — a correct-EV action with a hand-strength/none reason is "right for the wrong reason", and
 * the escalated case (an explicit guess) is the whole point of surfacing it. Passing an adjusted with
 * rightForWrongReason false clears the note without touching the EV grade line.
 */
export function showReasonNote(el: HTMLElement, adjusted: ReasonAdjustedGrade): void {
  const note = el.querySelector<HTMLElement>('[data-testid="coach-reason-note"]');
  if (!note) return;
  if (!adjusted.rightForWrongReason) {
    note.hidden = true;
    note.textContent = '';
    return;
  }
  note.hidden = false;
  note.textContent = adjusted.escalated
    ? 'Right action, but the reason was a guess — study this one.'
    : 'Right action, but not for the reason given. Name the mechanism.';
  // A free EV grade leaves the root hidden; the reason verdict is real feedback, so show the panel.
  el.hidden = false;
}

export function clearCoach(el: HTMLElement): void {
  const message = el.querySelector<HTMLElement>('[data-testid="coach-message"]');
  const principle = el.querySelector<HTMLElement>('.coach-principle');
  const reasonNote = el.querySelector<HTMLElement>('[data-testid="coach-reason-note"]');
  if (message) message.textContent = '';
  if (principle) principle.textContent = '';
  if (reasonNote) {
    reasonNote.textContent = '';
    reasonNote.hidden = true;
  }
  el.dataset.severity = 'none';
  el.hidden = true;
}
