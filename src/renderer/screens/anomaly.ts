import '../styles-anomaly.css';

import {
  ANOMALY_RATE,
  MIN_ANOMALY_TRIALS,
  MIN_TRIALS,
  PASS_RATE,
  RT_THRESHOLD_MS,
  TRAINED_DEPTHS_BB,
  TRAINED_SIZINGS_PCT,
  TRAINED_TEXTURES,
  TRIGGER_CATEGORIES,
  drawStimulus,
  fluencyGate,
  scoreResponse,
  type AnomalyStimulus,
  type ErrorTag,
  type Response,
  type ScoredResponse,
  type TriggerCategory,
} from '../../core/anomaly.js';

/**
 * THE ANOMALY TRIGGER DRILL — PRODUCT-SPEC O8, and gate A of P5.
 *
 * A PURE READER over src/core/anomaly.ts. Every stimulus comes back out of drawStimulus, every
 * verdict out of scoreResponse, every aggregate out of fluencyGate, and every "trained range"
 * printed in the trigger list is that module's own exported constant. There is no poker in this
 * file and no arithmetic beyond dividing a count by a count for the observed-rate readout.
 *
 * Four decisions worth stating, because each looks arbitrary and is not:
 *
 * IT IS ITS OWN TAB, not a fifth kind on the Drill tab. The Drill tab's selector is typed over
 * core/arithmetic's DrillKind and drill.spec.ts pins the button count at exactly four, so a fifth
 * kind there would fail an existing test — and this drill shares no control with it anyway: there
 * is no number to type, the answer is one of two keys, and the measurement is a clock rather than a
 * tolerance band.
 *
 * THE SEED IS THE TRIAL'S IDENTITY and the category is round-robin over TRIGGER_CATEGORIES, so the
 * sequence is fixed at BASE_SEED on every launch and all four triggers get drilled rather than one
 * being sampled to death. Round-robin also matches core's seen-set, which is per category.
 *
 * RESPONSE TIME IS THE OTHER HALF OF THE GRADE. P5 gate A is correct AND under the threshold, so
 * the clock starts on the paint that puts an unanswered prompt on screen and stops on the keystroke.
 * A correct-but-slow answer is shown as a fail, with core's own wording, because slow-and-correct is
 * the deliberation habit O8 exists to remove.
 *
 * THE ORACLE IS NEVER IN THE DOM BEFORE THE ANSWER. The root publishes data-* state for the e2e
 * suite, but nothing that says whether the live slot is anomalous — that only appears after the
 * commit, or the drill would be a lookup rather than a perceptual judgment.
 */

/** Fixed base: the sequence must be identical on every launch for the e2e suite to pin it. */
const BASE_SEED = 811;

const seedFor = (index: number): number => BASE_SEED + index;

/** Round-robin, so the drilled trigger is a function of position alone and every trigger is drilled. */
const categoryFor = (index: number): TriggerCategory =>
  TRIGGER_CATEGORIES[index % TRIGGER_CATEGORIES.length];

/**
 * O8's explicit trigger list. The wording of the four is the spec's, in the spec's order; what to
 * watch is built out of core's trained ranges rather than retyped, so the list cannot drift away
 * from the stimuli it describes. Keyed by TriggerCategory so a new category is a build error rather
 * than a silently unlabelled row.
 */
const TRIGGERS: Record<TriggerCategory, { label: string; watch: string }> = {
  'off-tree-sizing': {
    label: 'Off-tree sizing',
    watch: `anything but ${TRAINED_SIZINGS_PCT.join('%, ')}% of pot`,
  },
  'unfamiliar-texture': {
    label: 'Unfamiliar texture class',
    watch: `a board outside ${TRAINED_TEXTURES.join(', ')}`,
  },
  'stack-depth-outside-range': {
    label: 'Stack depth outside the trained range',
    watch: `a stack that is not ${TRAINED_DEPTHS_BB.join(', ')} bb`,
  },
  'read-contradicts-frame': {
    label: 'A read that contradicts the frame',
    watch: 'a read the frame does not already predict',
  },
};

const TAG_LABELS: Record<ErrorTag, string> = {
  'missed-anomaly': 'missed anomaly',
  'false-alarm': 'false alarm',
  slow: 'correct but slow',
};

/** Anomalies met and anomalies caught, per trigger. G7: the aggregate names the mistake, not the person. */
interface TriggerTally {
  met: number;
  caught: number;
}

interface Graded {
  readonly stimulus: AnomalyStimulus;
  readonly answeredStandard: boolean;
  readonly rtMs: number;
  readonly scored: ScoredResponse;
}

export function renderAnomalyScreen(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'anomaly-screen';
  root.dataset.testid = 'anomaly-screen';

  const seen = new Map<TriggerCategory, Set<string>>(
    TRIGGER_CATEGORIES.map((category) => [category, new Set<string>()]),
  );
  const tallies = new Map<TriggerCategory, TriggerTally>(
    TRIGGER_CATEGORIES.map((category) => [category, { met: 0, caught: 0 }]),
  );
  const responses: Response[] = [];

  let index = 0;
  let draw = drawStimulus(seedFor(index), categoryFor(index), seen.get(categoryFor(index)));
  /** When the live prompt went on screen. The RT is measured from here, never from a timer. */
  let shownAt = now();
  let graded: Graded | null = null;

  function commit(answeredStandard: boolean): void {
    const stimulus = draw.stimulus;
    if (graded !== null || stimulus === null) return;

    const response: Response = {
      stimulusId: stimulus.id,
      answeredStandard,
      wasStandard: !stimulus.anomalous,
      rtMs: Math.round(now() - shownAt),
    };
    const scored = scoreResponse(response);

    responses.push(response);
    seen.get(stimulus.category)?.add(stimulus.id);
    if (stimulus.anomalous) {
      const tally = tallies.get(stimulus.category);
      if (tally) {
        tally.met += 1;
        if (scored.correct) tally.caught += 1;
      }
    }

    graded = { stimulus, answeredStandard, rtMs: response.rtMs, scored };
    paint();
  }

  function advance(): void {
    if (graded === null) return;
    index += 1;
    const category = categoryFor(index);
    draw = drawStimulus(seedFor(index), category, seen.get(category));
    graded = null;
    shownAt = now();
    paint();
  }

  /**
   * Y and N answer; Enter advances. Keyed off `document` so a press works without the screen having
   * focus, and self-removing once the root is detached — main.ts's renderTab has no teardown hook,
   * so the listener has to clean itself up or it outlives every visit to this tab. This is the
   * pattern screens/charts.ts and screens/drill.ts already use, and anomaly.spec.ts test 9 proves
   * a press on another tab cannot move this screen.
   */
  function onKey(event: KeyboardEvent): void {
    if (!root.isConnected) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'y') commit(true);
    else if (key === 'n') commit(false);
    else if (key === 'enter') advance();
  }
  document.addEventListener('keydown', onKey);

  function paint(): void {
    const gate = fluencyGate(responses);

    // The screen's sync oracle: every e2e wait keys off these attributes, never a sleep. Nothing
    // here describes the LIVE slot's answer — only the one already committed.
    root.dataset.index = String(index);
    root.dataset.seed = String(seedFor(index));
    root.dataset.category = categoryFor(index);
    root.dataset.phase = graded === null ? 'answer' : 'graded';
    root.dataset.answered = String(responses.length);
    root.dataset.anomalies = String(gate.anomalyTrials);
    root.dataset.disabled = String(draw.disabled);
    root.dataset.verdict = graded === null ? '' : graded.scored.pass ? 'pass' : 'fail';
    root.dataset.lastTag = graded?.scored.tag ?? '';
    root.dataset.lastRt = graded === null ? '' : String(graded.rtMs);
    root.dataset.lastAnomalous = graded === null ? '' : String(graded.stimulus.anomalous);
    root.dataset.gate = gate.passed ? 'pass' : 'fail';

    root.replaceChildren(
      renderSide({ gate, tallies, firedBy: graded }),
      renderWork({ draw, graded, onCommit: commit, onNext: advance }),
    );
  }

  paint();
  return root;
}

/** performance.now() where it exists; Date.now() is the fallback and is accurate enough for a 2 s gate. */
function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

// ---------------------------------------------------------------------------
// The trigger list and the gate — the instructional payload
// ---------------------------------------------------------------------------

function renderSide(opts: {
  gate: ReturnType<typeof fluencyGate>;
  tallies: ReadonlyMap<TriggerCategory, TriggerTally>;
  firedBy: Graded | null;
}): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'anomaly-side';
  panel.dataset.testid = 'anomaly-side';

  panel.appendChild(text('div', 'stat-label', 'Two speeds'));
  panel.appendChild(
    text(
      'p',
      'anomaly-note anomaly-speeds',
      'Default: recognise node, texture and role, and play the trained line. Deliberate: engage only when a slot is anomalous. This drill installs the switch — it does not explain it.',
    ),
  );

  panel.appendChild(text('div', 'stat-label', 'The four triggers'));
  panel.appendChild(renderTriggerList(opts.tallies, opts.firedBy));
  panel.appendChild(renderGate(opts.gate));

  return panel;
}

/**
 * O8's list, on screen, always — this drill teaches recognition of these four, so naming them is
 * the payload rather than decoration. The row of the trigger that just fired is marked so a caught
 * or missed anomaly is attached to the dimension it deviated on, which is the whole point of core's
 * one-feature-off rule.
 */
function renderTriggerList(
  tallies: ReadonlyMap<TriggerCategory, TriggerTally>,
  firedBy: Graded | null,
): HTMLElement {
  const list = document.createElement('ol');
  list.className = 'trigger-list';
  list.dataset.testid = 'trigger-list';

  for (const category of TRIGGER_CATEGORIES) {
    const tally = tallies.get(category) ?? { met: 0, caught: 0 };

    const row = document.createElement('li');
    row.className = 'trigger-row';
    row.dataset.testid = 'trigger-row';
    row.dataset.category = category;
    row.dataset.met = String(tally.met);
    row.dataset.caught = String(tally.caught);
    row.dataset.fired = String(firedBy?.stimulus.trigger === category);

    row.appendChild(text('span', 'trigger-label', TRIGGERS[category].label));
    row.appendChild(text('span', 'trigger-watch', TRIGGERS[category].watch));

    const score = text(
      'span',
      'trigger-score',
      tally.met === 0 ? 'none met yet' : `${tally.caught} of ${tally.met} caught`,
    );
    score.dataset.testid = 'trigger-score';
    score.dataset.category = category;
    row.appendChild(score);

    list.appendChild(row);
  }

  return list;
}

/**
 * Gate A, stated as core computes it: correct AND fast, both, always. V2 permits mint here and
 * nowhere else on this screen — win% and a fluency-gate pass are the only two things it marks.
 */
function renderGate(gate: ReturnType<typeof fluencyGate>): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'anomaly-gate';
  wrap.dataset.testid = 'anomaly-gate';
  wrap.dataset.passed = String(gate.passed);
  wrap.dataset.attempts = String(gate.attempts);
  wrap.dataset.correct = String(gate.correct);
  wrap.dataset.passes = String(gate.passes);
  wrap.dataset.anomalyTrials = String(gate.anomalyTrials);
  wrap.dataset.medianRt = String(gate.medianRtMs);
  wrap.dataset.passRate = gate.passRate.toFixed(4);

  wrap.appendChild(
    text('div', 'stat-label', `Fluency gate — correct and under ${seconds(RT_THRESHOLD_MS)}`),
  );

  const headline = text(
    'div',
    'anomaly-gate-headline',
    gate.attempts === 0 ? '—' : `${gate.passes} of ${gate.attempts}`,
  );
  headline.dataset.testid = 'anomaly-gate-headline';
  wrap.appendChild(headline);

  const reason = text('p', 'anomaly-note', gate.reason);
  reason.dataset.testid = 'anomaly-gate-reason';
  wrap.appendChild(reason);

  const median = text(
    'div',
    'anomaly-stat',
    gate.attempts === 0 ? 'median response time —' : `median response time ${seconds(gate.medianRtMs)}`,
  );
  median.dataset.testid = 'anomaly-median-rt';
  wrap.appendChild(median);

  wrap.appendChild(renderObservedRate(gate.attempts, gate.anomalyTrials));
  wrap.appendChild(renderTags(gate.errorsByTag));

  wrap.appendChild(
    text(
      'p',
      'anomaly-note',
      `The gate needs ${MIN_TRIALS} trials with at least ${MIN_ANOMALY_TRIALS} anomalous ones, and ${Math.round(
        PASS_RATE * 100,
      )}% of them correct and fast. Answering "standard" every time scores about ${Math.round(
        (1 - ANOMALY_RATE) * 100,
      )}% by base rate alone, which is why the bar sits above it.`,
    ),
  );

  return wrap;
}

/** The seeded rate, checkable on screen rather than asserted in a comment. */
function renderObservedRate(attempts: number, anomalyTrials: number): HTMLElement {
  const observed = attempts === 0 ? 0 : anomalyTrials / attempts;

  const row = text(
    'div',
    'anomaly-stat',
    attempts === 0
      ? `anomalies so far — of a seeded ${percent(ANOMALY_RATE)}`
      : `${anomalyTrials} ${anomalyTrials === 1 ? 'anomaly' : 'anomalies'} in ${attempts} — ${percent(observed)} against a seeded ${percent(ANOMALY_RATE)}`,
  );
  row.dataset.testid = 'anomaly-rate';
  row.dataset.observed = observed.toFixed(4);
  row.dataset.target = ANOMALY_RATE.toFixed(4);
  row.dataset.anomalies = String(anomalyTrials);
  row.dataset.attempts = String(attempts);
  return row;
}

/** G7: aggregated by error tag, never by trait. Zero rows stay, so a clean tag reads as measured. */
function renderTags(errorsByTag: Readonly<Record<ErrorTag, number>>): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'tag-list';
  list.dataset.testid = 'tag-list';

  for (const tag of Object.keys(TAG_LABELS) as ErrorTag[]) {
    const row = document.createElement('li');
    row.className = 'tag-row';
    row.dataset.testid = 'tag-row';
    row.dataset.tag = tag;
    row.dataset.count = String(errorsByTag[tag]);
    row.appendChild(text('span', 'tag-label', TAG_LABELS[tag]));
    row.appendChild(text('span', 'tag-count', String(errorsByTag[tag])));
    list.appendChild(row);
  }

  return list;
}

// ---------------------------------------------------------------------------
// The slot, the two keys, and the verdict
// ---------------------------------------------------------------------------

function renderWork(opts: {
  draw: ReturnType<typeof drawStimulus>;
  graded: Graded | null;
  onCommit: (answeredStandard: boolean) => void;
  onNext: () => void;
}): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'anomaly-work';
  panel.dataset.testid = 'anomaly-work';

  // An exhausted pool is system state, not grading, so G3's silence does not cover it.
  if (opts.draw.message !== null) {
    const notice = text('p', 'anomaly-notice', opts.draw.message);
    notice.dataset.testid = 'anomaly-notice';
    panel.appendChild(notice);
  }

  const stimulus = opts.draw.stimulus;
  if (stimulus === null) return panel;

  const prompt = text('p', 'anomaly-prompt', stimulus.prompt);
  prompt.dataset.testid = 'anomaly-prompt';
  panel.appendChild(prompt);

  if (opts.graded === null) {
    panel.appendChild(renderKeys(opts.onCommit));
    const hint = text(
      'p',
      'anomaly-note',
      'One judgment, as fast as you can read it. The clock is running from the moment this appeared.',
    );
    hint.dataset.testid = 'anomaly-hint';
    panel.appendChild(hint);
    return panel;
  }

  panel.appendChild(renderVerdict(opts.graded));

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'pill anomaly-next';
  next.dataset.testid = 'anomaly-next';
  next.textContent = 'Next slot — Enter';
  next.addEventListener('click', opts.onNext);
  panel.appendChild(next);

  return panel;
}

function renderKeys(onCommit: (answeredStandard: boolean) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'anomaly-keys';
  row.dataset.testid = 'anomaly-keys';
  row.appendChild(answerKey('Y standard', 'anomaly-yes', true, onCommit));
  row.appendChild(answerKey('N anomalous', 'anomaly-no', false, onCommit));
  return row;
}

function answerKey(
  label: string,
  testid: string,
  answeredStandard: boolean,
  onCommit: (answeredStandard: boolean) => void,
): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pill anomaly-key';
  button.dataset.testid = testid;
  button.textContent = label;
  button.addEventListener('click', () => onCommit(answeredStandard));
  return button;
}

/**
 * The verdict, in core's words.
 *
 * V2: no colour on a miss. Right and wrong are told apart by wording and type weight, and both
 * carry the same three facts in the same layout — what the slot was, what the trigger was, and how
 * long the judgment took — so a miss is a comparison rather than a rebuke. A pass says only that,
 * with no praise (G3), because a correct and fast answer is the baseline this drill assumes.
 */
function renderVerdict(graded: Graded): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'anomaly-verdict';
  wrap.dataset.testid = 'anomaly-verdict';
  wrap.dataset.verdict = graded.scored.pass ? 'pass' : 'fail';
  wrap.dataset.tag = graded.scored.tag ?? '';
  wrap.dataset.correct = String(graded.scored.correct);
  wrap.dataset.fast = String(graded.scored.fast);
  wrap.dataset.anomalous = String(graded.stimulus.anomalous);
  wrap.dataset.rt = String(graded.rtMs);

  const truth = text(
    'div',
    'anomaly-truth',
    graded.stimulus.anomalous ? 'That slot was anomalous.' : 'That slot was standard.',
  );
  truth.dataset.testid = 'anomaly-truth';
  wrap.appendChild(truth);

  // The trigger is named only after the commit: before it, it is the answer.
  const trigger = text(
    'div',
    'anomaly-trigger',
    graded.stimulus.trigger === null
      ? 'Every feature was inside the trained ranges.'
      : `Trigger: ${TRIGGERS[graded.stimulus.trigger].label.toLowerCase()} — ${TRIGGERS[graded.stimulus.trigger].watch}.`,
  );
  trigger.dataset.testid = 'anomaly-trigger';
  trigger.dataset.category = graded.stimulus.trigger ?? '';
  wrap.appendChild(trigger);

  const rt = text(
    'div',
    'anomaly-rt',
    `${seconds(graded.rtMs)} — ${graded.scored.fast ? `inside the ${seconds(RT_THRESHOLD_MS)} gate` : `over the ${seconds(RT_THRESHOLD_MS)} gate`}`,
  );
  rt.dataset.testid = 'anomaly-rt';
  rt.dataset.rt = String(graded.rtMs);
  rt.dataset.fast = String(graded.scored.fast);
  wrap.appendChild(rt);

  // core supplies the comment, including its silence on a pass.
  if (graded.scored.comment !== null) {
    const comment = text('p', 'anomaly-comment', graded.scored.comment);
    comment.dataset.testid = 'anomaly-comment';
    wrap.appendChild(comment);
  }

  const tag = text(
    'span',
    'anomaly-tag',
    graded.scored.tag === null ? 'no tag' : TAG_LABELS[graded.scored.tag],
  );
  tag.dataset.testid = 'anomaly-verdict-tag';
  tag.dataset.tag = graded.scored.tag ?? '';
  wrap.appendChild(tag);

  return wrap;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function text(tag: string, className: string, content: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = content;
  return el;
}
