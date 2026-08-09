import type { Confidence, PredictOutcome, PredictedAction, Prediction } from '../../core/predict.js';
import { PREDICTED_ACTIONS } from '../../core/predict.js';

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

  const result = document.createElement('div');
  result.className = 'predict-result';
  result.dataset.testid = 'predict-result';
  result.hidden = true;
  root.appendChild(result);

  syncSelection(root);
  return root;
}

/** Null until BOTH halves are committed — the gate the action buttons hang off. */
export function committedPrediction(root: HTMLElement): Prediction | null {
  const action = root.dataset.predictAction;
  const confidence = root.dataset.predictConfidence;
  if (!isPredictedAction(action)) return null;
  if (confidence !== 'sure' && confidence !== 'guess') return null;
  return { action, confidence };
}

export function showPredictResult(root: HTMLElement, outcome: PredictOutcome, text: string): void {
  const result = resultEl(root);
  if (!result) return;
  result.hidden = false;
  result.dataset.outcome = outcome;
  result.textContent = text;
}

/** Drop the commitment so the next decision needs a fresh one. The result line survives on purpose. */
export function resetCommit(root: HTMLElement): void {
  delete root.dataset.predictAction;
  delete root.dataset.predictConfidence;
  syncSelection(root);
}

/** Full reset for a new hand: last hand's verdict is stale advice. */
export function clearPredictPanel(root: HTMLElement): void {
  resetCommit(root);
  const result = resultEl(root);
  if (!result) return;
  result.hidden = true;
  delete result.dataset.outcome;
  result.textContent = '';
}

function resultEl(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>('[data-testid="predict-result"]');
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
