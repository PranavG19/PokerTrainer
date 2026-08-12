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
export function renderCoachPanel(onGateSubmit: () => void = () => {}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'coach';
  root.dataset.severity = 'none';
  root.dataset.gate = 'closed';
  root.hidden = true;

  // State 4 GATE — the pre-reveal self-explanation, borrowing the coach box so it adds no vertical
  // budget (the 900x640 column has none to spare). Hidden until a gate fires; while open it shows a
  // draining budget bar, the fixed mechanism prompt, an attempt counter, a one-line input and a
  // submit. It deliberately does NOT set data-severity — the tier is withheld until the reveal.
  const gate = document.createElement('div');
  gate.className = 'coach-gate';
  gate.dataset.testid = 'coach-gate';
  gate.hidden = true;

  const bar = document.createElement('div');
  bar.className = 'coach-gate-bar';
  bar.dataset.testid = 'gate-budget';
  const barFill = document.createElement('div');
  barFill.className = 'coach-gate-bar-fill';
  bar.appendChild(barFill);
  gate.appendChild(bar);

  const gatePrompt = document.createElement('div');
  gatePrompt.className = 'coach-gate-prompt';
  gatePrompt.dataset.testid = 'gate-prompt';
  gate.appendChild(gatePrompt);

  const gateCount = document.createElement('div');
  gateCount.className = 'coach-gate-count';
  gateCount.dataset.testid = 'gate-count';
  gate.appendChild(gateCount);

  const gateInput = document.createElement('textarea');
  gateInput.className = 'coach-gate-input lesson-input';
  gateInput.dataset.testid = 'gate-input';
  gateInput.rows = 1;
  gateInput.placeholder = 'One line — name the range or the price.';
  // Enter (without Shift) submits, like a chat box; Shift+Enter is a newline. Matches the predict rail.
  gateInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onGateSubmit();
    }
  });
  gate.appendChild(gateInput);

  const gateNote = document.createElement('div');
  gateNote.className = 'coach-gate-note';
  gateNote.dataset.testid = 'gate-note';
  gateNote.hidden = true;
  gate.appendChild(gateNote);

  const gateSubmit = document.createElement('button');
  gateSubmit.type = 'button';
  gateSubmit.className = 'pill coach-gate-submit';
  gateSubmit.dataset.testid = 'gate-submit';
  gateSubmit.textContent = 'Submit';
  gateSubmit.addEventListener('click', () => onGateSubmit());
  gate.appendChild(gateSubmit);

  root.appendChild(gate);

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

/**
 * Open the GATE: reveal the panel with the mechanism prompt and start the budget-bar drain. The
 * severity tier stays 'none' on purpose — the whole point is to withhold the verdict until the learner
 * has tried to retrieve the mechanism. The budget bar restarts its CSS drain by re-triggering the
 * animation (void offsetWidth reflow) so a second gate in the same hand animates from full.
 */
export function showGate(el: HTMLElement, prompt: string, budgetMs: number, maxAttempts: number): void {
  const gate = el.querySelector<HTMLElement>('[data-testid="coach-gate"]');
  const promptEl = el.querySelector<HTMLElement>('[data-testid="gate-prompt"]');
  const count = el.querySelector<HTMLElement>('[data-testid="gate-count"]');
  const input = el.querySelector<HTMLTextAreaElement>('[data-testid="gate-input"]');
  const note = el.querySelector<HTMLElement>('[data-testid="gate-note"]');
  const barFill = el.querySelector<HTMLElement>('.coach-gate-bar-fill');
  if (!gate || !promptEl || !count || !input || !note) return;

  el.hidden = false;
  el.dataset.gate = 'open';
  el.dataset.gateAttempts = '0';
  gate.hidden = false;
  promptEl.textContent = prompt;
  count.textContent = `Attempt 1 of ${maxAttempts}`;
  note.hidden = true;
  note.textContent = '';
  input.value = '';
  input.focus();
  if (barFill) {
    // The drain animation is declared in CSS (so the reduced-motion media query can disable it — an
    // inline animation here would override that guard). Its duration reads the --gate-budget CSS var,
    // kept in sync with the timer's budget (table.ts owns the real deadline). Restart the drain from
    // full on a repeat gate with the standard remove-reflow-restore: clearing the inline `none` reverts
    // to the stylesheet rule, re-triggering it.
    barFill.style.animation = 'none';
    void barFill.offsetWidth;
    barFill.style.animation = '';
    void budgetMs; // the bar reads --gate-budget; the ms value is the timer's, not the bar's.
  }
}

/** Record how many gate attempts have been made, on the panel root, so a test can read it at reveal.
 *  The single writer for data-gate-attempts across both the retry and the resolve paths. */
export function recordGateAttempts(el: HTMLElement, attempts: number): void {
  el.dataset.gateAttempts = String(attempts);
}

/** After a missed first attempt: keep the gate open for the last attempt, name the miss, refocus. The
 *  budget bar keeps draining (single per-gate budget), so it is not restarted here. */
export function showGateRetry(el: HTMLElement, attemptsUsed: number, maxAttempts: number): void {
  const count = el.querySelector<HTMLElement>('[data-testid="gate-count"]');
  const input = el.querySelector<HTMLTextAreaElement>('[data-testid="gate-input"]');
  const note = el.querySelector<HTMLElement>('[data-testid="gate-note"]');
  if (!count || !input || !note) return;
  el.dataset.gateAttempts = String(attemptsUsed);
  count.textContent = `Attempt ${attemptsUsed + 1} of ${maxAttempts}`;
  note.hidden = false;
  note.textContent = 'Name the range or the price — not just the hand.';
  input.value = '';
  input.focus();
}

/** The current gate input text, trimmed. */
export function readGateInput(el: HTMLElement): string {
  const input = el.querySelector<HTMLTextAreaElement>('[data-testid="gate-input"]');
  return input ? input.value.trim() : '';
}

/**
 * Close the gate box without touching the verdict lines — the very next call is showGrade, which paints
 * into the same panel. data-gate returns to 'closed'; data-gate-attempts is LEFT in place so a test can
 * read how many attempts the just-resolved gate took at reveal time.
 */
export function clearGate(el: HTMLElement): void {
  const gate = el.querySelector<HTMLElement>('[data-testid="coach-gate"]');
  const input = el.querySelector<HTMLTextAreaElement>('[data-testid="gate-input"]');
  const note = el.querySelector<HTMLElement>('[data-testid="gate-note"]');
  if (gate) gate.hidden = true;
  if (input) input.value = '';
  if (note) {
    note.hidden = true;
    note.textContent = '';
  }
  el.dataset.gate = 'closed';
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
  // A stray open gate is wiped too (tab-switch mid-gate), and its attempt count reset — unlike
  // clearGate, this is a full reset, so the next hand starts with no gate residue.
  clearGate(el);
  delete el.dataset.gateAttempts;
  el.dataset.severity = 'none';
  el.hidden = true;
}
