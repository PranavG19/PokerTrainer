import {
  CONSECUTIVE_DECLINES_TO_ASK,
  SOURCES,
  type Source,
  type Suggestion,
} from '../../core/recommend.js';

/**
 * THE RECOMMENDATION CARD — PRODUCT-SPEC N2 on the Home launcher, and N4's ask-once conversation.
 *
 * A PURE READER over core/recommend.ts. It renders a `Suggestion` and nothing else: no ranking, no
 * scoring, no second opinion of its own. That matters more here than on most screens, because N2's rule
 * is a rule about what the LEARNER SEES — "it never shows a ranked list" — so if the ranking lived here
 * the constraint would be one careless `map` away from being broken.
 *
 * WHY THE "N OTHERS" LINE IS A COUNT AND NOT A DISCLOSURE. A learner deserves to know the suggestion is
 * a choice rather than the only thing owed, otherwise the single card reads as the whole truth. But
 * naming the others would be the queue the spec forbids. A count is the honest middle: it says "there is
 * more" without ordering it into a to-do list.
 *
 * DECLINING IS FIRST-CLASS (N1). The card carries a Skip control, always enabled, because a
 * recommendation that can only be accepted is a soft lock wearing a suggestion's clothes. Every decline
 * goes to N4's override log through core.
 */

export interface RecommendationHandlers {
  /** The learner took the suggestion. The subject routes them wherever it belongs. */
  readonly onAccept: (suggestion: Suggestion) => void;
  /** Declined. `chosen` is left empty when they did not name an alternative — see core's decline(). */
  readonly onDecline: (suggestion: Suggestion) => void;
  /** N4's ask-once answer: what they would rather work on. */
  readonly onPrefer: (source: Source) => void;
}

/** Human labels for the four input families. The ids are for the log, not for a learner to read. */
const SOURCE_LABELS: Record<Source, string> = {
  'spacing-debt': 'Concepts coming due',
  'fluency-gate': 'Drills I have not passed',
  mastery: 'Finishing what I nearly know',
  'error-tag': 'My most expensive leaks',
};

/**
 * The empty state, which is a real state rather than a fallback: a fresh profile has nothing to
 * recommend, and saying so plainly is more honest than a fabricated first task. It deliberately does
 * NOT nag — N1 forbids a locked door, and it equally forbids a screen that insists on one path.
 */
function renderNothingDue(): HTMLElement {
  const card = document.createElement('div');
  card.className = 'recommendation recommendation-empty';
  card.dataset.testid = 'recommendation';
  card.dataset.source = 'none';

  const action = document.createElement('div');
  action.className = 'recommendation-action';
  action.dataset.testid = 'recommendation-action';
  action.textContent = 'Nothing is owed yet';
  card.appendChild(action);

  const reason = document.createElement('div');
  reason.className = 'recommendation-reason';
  reason.dataset.testid = 'recommendation-reason';
  reason.textContent = 'Play a hand or open any drill — every surface is available from the start.';
  card.appendChild(reason);

  return card;
}

/**
 * N4's question, asked once after five consecutive declines: "it asks once what you'd rather work on
 * and adjusts weighting." One button per family, so the answer is a choice among what the recommender
 * actually weighs rather than a free-text wish it cannot act on.
 */
function renderPreferenceAsk(handlers: RecommendationHandlers): HTMLElement {
  const block = document.createElement('div');
  block.className = 'recommendation-ask';
  block.dataset.testid = 'recommendation-ask';

  const prompt = document.createElement('div');
  prompt.className = 'recommendation-ask-prompt';
  prompt.dataset.testid = 'recommendation-ask-prompt';
  prompt.textContent = `That is ${CONSECUTIVE_DECLINES_TO_ASK} skips in a row — what would you rather work on?`;
  block.appendChild(prompt);

  const options = document.createElement('div');
  options.className = 'recommendation-ask-options';
  for (const source of SOURCES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recommendation-ask-option';
    button.dataset.testid = `prefer-${source}`;
    button.textContent = SOURCE_LABELS[source];
    button.addEventListener('click', () => handlers.onPrefer(source));
    options.appendChild(button);
  }
  block.appendChild(options);

  return block;
}

export function renderRecommendation(opts: {
  readonly suggestion: Suggestion | null;
  /** True when core says N4's threshold has been reached. Never computed here. */
  readonly askPreference: boolean;
  readonly handlers: RecommendationHandlers;
}): HTMLElement {
  if (opts.suggestion === null) {
    const empty = renderNothingDue();
    // The ask can still be owed with nothing due, so it is appended independently of the suggestion.
    if (opts.askPreference) empty.appendChild(renderPreferenceAsk(opts.handlers));
    return empty;
  }

  const suggestion = opts.suggestion;
  const card = document.createElement('div');
  card.className = 'recommendation';
  card.dataset.testid = 'recommendation';
  // The source is published so a test can assert WHICH family won, not merely that something rendered.
  card.dataset.source = suggestion.source;
  card.dataset.subject = suggestion.subject;
  card.dataset.others = String(suggestion.otherCandidates);

  const heading = document.createElement('div');
  heading.className = 'recommendation-heading';
  heading.textContent = 'Suggested next';
  card.appendChild(heading);

  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'recommendation-action';
  action.dataset.testid = 'recommendation-action';
  action.textContent = suggestion.action;
  action.addEventListener('click', () => opts.handlers.onAccept(suggestion));
  card.appendChild(action);

  // N2: one line, and it carries the numbers. Rendered from core's string so the screen cannot
  // paraphrase away the figures that make it a reason rather than a slogan.
  const reason = document.createElement('div');
  reason.className = 'recommendation-reason';
  reason.dataset.testid = 'recommendation-reason';
  reason.textContent = suggestion.reason;
  card.appendChild(reason);

  const controls = document.createElement('div');
  controls.className = 'recommendation-controls';

  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'recommendation-skip';
  skip.dataset.testid = 'recommendation-skip';
  skip.textContent = 'Skip this';
  skip.addEventListener('click', () => opts.handlers.onDecline(suggestion));
  controls.appendChild(skip);

  /*
   * The count, only when there is something to count. Phrased as availability rather than as a backlog:
   * "3 other things are also due" invites a queue in the reader's head, while naming it as choice does
   * not. Zero others renders nothing at all rather than "0 others", which would read as a bug.
   */
  if (suggestion.otherCandidates > 0) {
    const others = document.createElement('span');
    others.className = 'recommendation-others';
    others.dataset.testid = 'recommendation-others';
    others.textContent = `${suggestion.otherCandidates} other option${suggestion.otherCandidates === 1 ? '' : 's'} if you would rather`;
    controls.appendChild(others);
  }

  card.appendChild(controls);

  if (opts.askPreference) card.appendChild(renderPreferenceAsk(opts.handlers));

  return card;
}
