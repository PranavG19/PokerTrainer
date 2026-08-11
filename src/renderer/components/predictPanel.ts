import type { Confidence, PredictOutcome, PredictedAction, Prediction } from '../../core/predict.js';
import { PREDICTED_ACTIONS } from '../../core/predict.js';
import type { ConfidenceRoute, SupportLevel } from '../../core/confidence.js';

/**
 * The commit half of the coaching loop. The panel holds its own state in `dataset` — the same
 * DOM-as-state style the stats sheet uses — so the table screen reads the commitment back instead
 * of shadowing it in a second variable that could disagree with what the player can see.
 *
 * All four actions stay enabled even when one is illegal in the spot: the hero is committing to
 * what they *believe*, and a commitment they then cannot play is honest information (it reveals
 * itself as 'deviated' at the reveal), not an input error to be prevented.
 */
export function renderPredictPanel(onCommit: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'predict';
  root.dataset.testid = 'predict-panel';

  const prompt = document.createElement('div');
  prompt.className = 'predict-prompt';
  prompt.textContent = 'Commit first: which action, and how sure are you?';
  root.appendChild(prompt);

  // One row, not two: the table has no vertical slack at the documented 900x640 minimum, and a
  // second row of pills pushed the document into a scrollbar.
  const row = document.createElement('div');
  row.className = 'predict-row';
  for (const action of PREDICTED_ACTIONS) {
    row.appendChild(
      choice(label(action), `predict-${action}`, () => {
        root.dataset.predictAction = action;
        onCommit();
      }),
    );
  }
  for (const confidence of ['sure', 'guess'] as Confidence[]) {
    const button = choice(confidence.toUpperCase(), `confidence-${confidence}`, () => {
      root.dataset.predictConfidence = confidence;
      onCommit();
    });
    button.classList.add('predict-confidence');
    row.appendChild(button);
  }
  root.appendChild(row);

  // G4's reason (story 14): a one-line "why", graded SEPARATELY from the action. Optional — it does
  // not gate the action buttons (committedPrediction ignores it), so an empty box behaves exactly as
  // before the feature. Part of the commit half, so setCommitVisible hides it at handover with the rest.
  const reason = document.createElement('textarea');
  reason.className = 'predict-reason lesson-input';
  reason.dataset.testid = 'reason-input';
  reason.rows = 1;
  reason.placeholder = 'Why? (optional — graded separately)';
  root.appendChild(reason);

  const result = document.createElement('div');
  result.className = 'predict-result';
  result.dataset.testid = 'predict-result';
  result.hidden = true;
  root.appendChild(result);

  // G8's differential support, as a SIBLING of the verdict so the verdict's own text/attribute stay
  // byte-for-byte what they were: the four cells each render a structurally distinct line here.
  const support = document.createElement('div');
  support.className = 'predict-support';
  support.dataset.testid = 'predict-support';
  support.hidden = true;
  root.appendChild(support);

  syncSelection(root);
  return root;
}

/**
 * Show or hide the commit half. The verdict line is untouched — it is the one thing still true
 * about a finished hand.
 *
 * At handover there is no decision to commit to: nextHand() wipes any commitment made there, so
 * the prompt and pills are a live-looking control that cannot do anything. They also cost 74px in
 * a column that at the documented 900x640 minimum had none to spare — with a graded coach message
 * up as well, they pushed "Next hand", the only usable control at handover, 27px below the fold.
 */
export function setCommitVisible(root: HTMLElement, visible: boolean): void {
  const prompt = root.querySelector<HTMLElement>('.predict-prompt');
  const row = root.querySelector<HTMLElement>('.predict-row');
  const reason = reasonEl(root);
  if (prompt) prompt.hidden = !visible;
  if (row) row.hidden = !visible;
  if (reason) reason.hidden = !visible;
}

/** Null until BOTH halves are committed — the gate the action buttons hang off. */
export function committedPrediction(root: HTMLElement): Prediction | null {
  const action = root.dataset.predictAction;
  const confidence = root.dataset.predictConfidence;
  if (!isPredictedAction(action)) return null;
  if (confidence !== 'sure' && confidence !== 'guess') return null;
  return { action, confidence };
}

/**
 * The reason the learner typed, trimmed, or '' when they left it blank. Optional by design (G4 story
 * 14): an empty string is the signal to the caller that no reason was given and none should be graded.
 */
export function committedReason(root: HTMLElement): string {
  const reason = reasonEl(root);
  return reason instanceof HTMLTextAreaElement ? reason.value.trim() : '';
}

export function showPredictResult(
  root: HTMLElement,
  outcome: PredictOutcome,
  text: string,
  route: ConfidenceRoute | null,
): void {
  const result = resultEl(root);
  if (!result) return;
  result.hidden = false;
  result.dataset.outcome = outcome;
  result.textContent = text;

  const support = supportEl(root);
  if (!support) return;
  if (route) {
    support.hidden = false;
    support.textContent = predictSupportText(route);
  } else {
    // 'deviated' routes to null: nothing was tested, so no support is owed.
    support.hidden = true;
    support.textContent = '';
  }
}

/** How much explanation each of G8's four support levels carries, in G8's own words. */
function supportPhrase(support: SupportLevel): string {
  switch (support) {
    case 'principle-name-only':
      return 'Support: principle name only.';
    case 'full-causal-chain':
      return 'Support: the full causal chain.';
    case 'full-elaboration':
      return 'Support: full elaboration.';
    case 'terse-correction-plus-worked-example':
      return 'Support: terse correction plus a worked example.';
  }
}

/**
 * The differential support line for one cell, composed from the route's fields in a fixed order so
 * the four cells render four structurally distinct strings. Pure: no DOM, so it is unit-testable in
 * vitest's node env.
 */
export function predictSupportText(route: ConfidenceRoute): string {
  const parts: string[] = [supportPhrase(route.support)];
  if (route.immediateReserve && route.schedule.length > 0) {
    const spacedDays = route.schedule
      .map((rep) => rep.day)
      .filter((day) => day > 0)
      .map((day) => `day ${day}`);
    parts.push(`This spot returns now, then on ${spacedDays.join(' and ')}.`);
  }
  if (route.workedExample) parts.push('A worked example is owed.');
  if (route.repetition === 'higher') parts.push('Repetition steps up.');
  if (route.highestValue) parts.push('This is the highest-value miss in the system.');
  parts.push(route.rationale);
  return parts.join(' ');
}

/** Drop the commitment so the next decision needs a fresh one. The result line survives on purpose. */
export function resetCommit(root: HTMLElement): void {
  delete root.dataset.predictAction;
  delete root.dataset.predictConfidence;
  // The reason belongs to the decision just made, not the next one: clear it so the next street's
  // commitment starts from a blank box rather than inheriting last street's stale "why".
  const reason = reasonEl(root);
  if (reason instanceof HTMLTextAreaElement) reason.value = '';
  syncSelection(root);
}

/** Full reset for a new hand: last hand's verdict is stale advice. */
export function clearPredictPanel(root: HTMLElement): void {
  resetCommit(root);
  const result = resultEl(root);
  if (result) {
    result.hidden = true;
    delete result.dataset.outcome;
    result.textContent = '';
  }
  const support = supportEl(root);
  if (support) {
    support.hidden = true;
    support.textContent = '';
  }
}

function resultEl(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>('[data-testid="predict-result"]');
}

function supportEl(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>('[data-testid="predict-support"]');
}

function reasonEl(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>('[data-testid="reason-input"]');
}

function syncSelection(root: HTMLElement): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('.predict-choice')) {
    const id = button.dataset.testid ?? '';
    const selected =
      id === `predict-${root.dataset.predictAction ?? ''}` ||
      id === `confidence-${root.dataset.predictConfidence ?? ''}`;
    button.dataset.selected = String(selected);
  }
}

function choice(text: string, testid: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pill predict-choice';
  b.dataset.testid = testid;
  b.textContent = text;
  b.addEventListener('click', () => {
    onClick();
    const root = b.closest<HTMLElement>('.predict');
    if (root) syncSelection(root);
  });
  return b;
}

function label(action: PredictedAction): string {
  return action[0].toUpperCase() + action.slice(1);
}

function isPredictedAction(value: string | undefined): value is PredictedAction {
  return PREDICTED_ACTIONS.includes(value as PredictedAction);
}
