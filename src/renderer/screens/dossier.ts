import '../styles-dossier.css';

import {
  CALIBRATION_RELEASE_FORECASTS,
  COUNTER_ACTIONS_TO_BASELINE,
  COUNTER_ACTIONS_TO_HALVE,
  CONTRARY_OBSERVATIONS_TO_CLOSE,
  DEVIATION_THRESHOLD_POINTS,
  MAX_ACTIVE_DEVIATIONS,
  MAX_DEVIATION_NODES,
  MIN_OBSERVATIONS,
  SHRINKAGE_PRIOR,
  appliedDeviation,
  expireSession,
  falseReadProbability,
  gates,
  nodeValue,
  planDeviations,
  rankNodes,
  readAccuracy,
  revertState,
  shrinkageWeight,
  type ExploitNode,
  type Forecast,
  type Read,
} from '../../core/reads.js';

/**
 * THE DOSSIER — PRODUCT-SPEC N5's fifth surface, over src/core/reads.ts. R1, R2, R3, R4, R6 and O4.
 *
 * A PURE READER over core/reads.ts. Every gate verdict, weight, applied bb, plan, revert trigger and
 * Brier figure on screen is the return value of a function in that module; this file counts
 * observations and paints. It contains no gating arithmetic of its own.
 *
 * WHY THE STREAM IS DELIVERED ONE OBSERVATION PER CLICK (R6, and the spec's own open question 8):
 * R6 replaces 1,000 live hands with a generated observation set, and the spec's stated mitigation is
 * that the observations must arrive SEQUENTIALLY, never as a table, so data scarcity is felt rather
 * than summarised. So there is no "observe 20" button and the past observations are never listed:
 * the learner sees the last one, the running count, and what the gates say about it so far. Reaching
 * n = 20 costs twenty clicks, which is the point.
 *
 * WHY A FORECAST IS THE PRICE OF AN OBSERVATION (O4): true frequencies are known here, so every
 * observation can be graded. The forecast pills are the only way to advance the stream, which means
 * the learner commits a probability BEFORE seeing the outcome — the one ordering under which a Brier
 * score means anything. Graded against the node base rate, not against uniform, and both are shown
 * so the gap can be read off the screen.
 *
 * WHAT THIS SCREEN IS FOR, above all: R1's trap. The shrinkage weight is displayed at every n,
 * including every n at which nothing is licensed, because a learner who thinks a small w makes a bad
 * read safe holds exactly the misconception this surface exists to remove. w = 0.66 at n = 19 sits on
 * screen beside a shut gate and a licensed deviation of 0.00 bb.
 */

/**
 * R2's cap, which core does NOT encode: reads.ts carries a `preRegistered` flag per read and leaves
 * the count to the caller, so the "at most two" lives here beside the button that enforces it.
 */
const PRE_REGISTRATION_CAP = 2;

/** R2's rationale figures: a ten-stat scan, and the same scan gated and pre-registered. */
const SCANNED_OBSERVABLES = 10;
const SCANNED_N = 10;

/** The forecast ladder. Coarse on purpose: a probability box invites false precision at n < 20. */
const FORECAST_PROBABILITIES = [0.1, 0.3, 0.5, 0.7, 0.9] as const;

interface Tendency {
  readonly id: string;
  /** R3: named, because "play looser against him" is on the ban list. */
  readonly label: string;
  readonly baselineFrequency: number;
  /** O4: known, which is what makes a forecast at this node gradeable. */
  readonly trueFrequency: number;
  readonly fullExploitBb: number;
}

/**
 * One unlabelled villain (O3 keeps the archetype hidden) and the five tendencies a learner might
 * think they see. Two of them are worth a deviation, one is inside the 15-point band and is the
 * commonest false read, and the ordering is fixed so the surface is identical on every launch.
 */
const VILLAIN = 'Seat 4';

const TENDENCIES: readonly Tendency[] = [
  {
    id: 'folds-to-turn-probe',
    label: 'folds to a turn probe',
    baselineFrequency: 0.5,
    trueFrequency: 0.75,
    fullExploitBb: 2,
  },
  {
    id: 'calls-river-overbet',
    label: 'calls a river overbet',
    baselineFrequency: 0.4,
    trueFrequency: 0.45,
    fullExploitBb: 1.6,
  },
  {
    id: 'three-bets-blind-vs-blind',
    label: 'three-bets blind versus blind',
    baselineFrequency: 0.1,
    trueFrequency: 0.35,
    fullExploitBb: 2.5,
  },
  {
    id: 'checks-back-flop-ip',
    label: 'checks back the flop in position',
    baselineFrequency: 0.55,
    trueFrequency: 0.8,
    fullExploitBb: 1.2,
  },
  {
    id: 'jams-river-with-air',
    label: 'jams the river with air',
    baselineFrequency: 0.05,
    trueFrequency: 0.3,
    fullExploitBb: 3,
  },
];

/** R3's ledger of nodes. `reach x bb per occurrence` is core's ranking key, not this file's. */
const NODES: readonly ExploitNode[] = [
  { id: 'bb-vs-btn-cbet', reach: 0.22, bbPerOccurrence: 1.5 },
  { id: 'sb-turn-probe', reach: 0.06, bbPerOccurrence: 4 },
  { id: 'co-river-jam', reach: 0.01, bbPerOccurrence: 12 },
  { id: 'utg-open-fold', reach: 0.5, bbPerOccurrence: 0.1 },
];

interface TrackState {
  n: number;
  hits: number;
  preRegistered: boolean;
  inNotebook: boolean;
  counterActions: number;
  contraryObservations: number;
}

/**
 * The stream is a quota pattern rather than a coin flip: observation i is a hit exactly when the
 * running quota `floor(n x p)` steps up. Deterministic, so the e2e suite can pin it without a seed,
 * and the observed frequency is within 1/n of the true frequency at EVERY prefix — which matters,
 * because a Bernoulli draw can wander 15 points off its own generator by n = 20 and would then teach
 * the learner that the gate opened on a tendency the villain does not have.
 */
function hitsAfter(count: number, probability: number): number {
  return Math.floor(count * probability + 1e-9);
}

function isHit(index: number, probability: number): boolean {
  return hitsAfter(index + 1, probability) > hitsAfter(index, probability);
}

export function renderDossier(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'dossier-screen';
  root.dataset.testid = 'dossier-screen';

  const tracks = new Map<string, TrackState>(
    TENDENCIES.map((t) => [
      t.id,
      { n: 0, hits: 0, preRegistered: false, inNotebook: false, counterActions: 0, contraryObservations: 0 },
    ]),
  );

  let selected = TENDENCIES[0].id;
  let forecasts: Forecast[] = [];
  /** Monotonic counters: the e2e sync oracle. Nothing on this screen is async, nothing sleeps. */
  let observations = 0;
  let sessionsEnded = 0;
  /** The last refusal, so the cap explains itself at the moment it bites rather than in a tooltip. */
  let refusal: { tendencyId: string; message: string } | null = null;
  let lastObservation: { tendencyId: string; occurred: boolean; index: number } | null = null;

  const tendencyOf = (id: string): Tendency =>
    TENDENCIES.find((t) => t.id === id) ?? TENDENCIES[0];

  const trackOf = (id: string): TrackState =>
    tracks.get(id) ?? {
      n: 0,
      hits: 0,
      preRegistered: false,
      inNotebook: false,
      counterActions: 0,
      contraryObservations: 0,
    };

  /**
   * With no observations at all the honest frequency is the baseline, not zero: `observedFrequency: 0`
   * against a 50% baseline would publish a 50-point deviation before anything had been seen, which is
   * the loudest possible lie on a screen whose subject is not deviating on noise. It is also what the
   * `+10` in `w = n/(n+10)` already assumes — ten pseudo-observations of "he is baseline".
   */
  const readOf = (tendency: Tendency): Read => {
    const track = trackOf(tendency.id);
    return {
      id: tendency.id,
      n: track.n,
      observedFrequency: track.n === 0 ? tendency.baselineFrequency : track.hits / track.n,
      baselineFrequency: tendency.baselineFrequency,
      preRegistered: track.preRegistered,
      counterActions: track.counterActions,
      contraryObservations: track.contraryObservations,
      fullExploitBb: tendency.fullExploitBb,
    };
  };

  function preRegister(id: string): void {
    const track = trackOf(id);
    if (track.preRegistered) return;
    const registered = [...tracks.values()].filter((t) => t.preRegistered).length;
    // R2: the cap refuses, and the refused tendency is not lost — it becomes next session's
    // hypothesis in the notebook, with fresh data.
    if (registered >= PRE_REGISTRATION_CAP) {
      track.inNotebook = true;
      refusal = {
        tendencyId: id,
        message: `${PRE_REGISTRATION_CAP} tendencies are already pre-registered, so this one cannot license a deviation this session. It is in the notebook as next session's hypothesis, with fresh data.`,
      };
      paint();
      return;
    }
    track.preRegistered = true;
    track.inNotebook = false;
    refusal = null;
    paint();
  }

  function sendToNotebook(id: string): void {
    const track = trackOf(id);
    track.inNotebook = true;
    track.preRegistered = false;
    paint();
  }

  function select(id: string): void {
    if (id === selected) return;
    selected = id;
    refusal = null;
    paint();
  }

  /** One forecast, then one observation. The order is the whole reason the score is meaningful. */
  function forecastAndObserve(probability: number): void {
    const tendency = tendencyOf(selected);
    const track = trackOf(selected);
    const occurred = isHit(track.n, tendency.trueFrequency);

    forecasts = [
      ...forecasts,
      {
        nodeId: tendency.id,
        forecast: probability,
        nodeBaseRate: tendency.trueFrequency,
        occurred,
      },
    ];
    lastObservation = { tendencyId: tendency.id, occurred, index: track.n + 1 };
    track.n += 1;
    if (occurred) track.hits += 1;
    observations += 1;
    paint();
  }

  function countCounterAction(): void {
    trackOf(selected).counterActions += 1;
    paint();
  }

  function countContrary(): void {
    trackOf(selected).contraryObservations += 1;
    paint();
  }

  /**
   * R4's session end. The written hypothesis survives — core's `expireSession` keeps `preRegistered`
   * — and every count of evidence goes back to zero, so nothing carries a licence into next session.
   */
  function endSession(): void {
    const expired = expireSession(TENDENCIES.map(readOf));
    for (const read of expired) {
      const track = trackOf(read.id);
      track.n = read.n;
      track.hits = 0;
      track.counterActions = read.counterActions;
      track.contraryObservations = read.contraryObservations;
      track.preRegistered = read.preRegistered;
    }
    lastObservation = null;
    refusal = null;
    sessionsEnded += 1;
    paint();
  }

  function paint(): void {
    const tendency = tendencyOf(selected);
    const read = readOf(tendency);
    const g = gates(read);
    const revert = revertState(read);
    const plan = planDeviations(TENDENCIES.map(readOf), NODES);
    const accuracy = readAccuracy(forecasts);
    const registered = [...tracks.values()].filter((t) => t.preRegistered).length;

    // The sync oracle. Every e2e wait keys off these; nothing here is timed.
    root.dataset.tendency = selected;
    root.dataset.n = String(read.n);
    root.dataset.licensed = String(g.licensed);
    root.dataset.registered = String(registered);
    root.dataset.observations = String(observations);
    root.dataset.forecasts = String(forecasts.length);
    root.dataset.sessionsEnded = String(sessionsEnded);

    root.replaceChildren(
      renderRegistration({
        registered,
        refusal,
        selected,
        tracks,
        onPreRegister: preRegister,
        onNotebook: sendToNotebook,
        onSelect: select,
      }),
      renderStream({
        tendency,
        read,
        gates: g,
        revert,
        lastObservation,
        onForecast: forecastAndObserve,
        onCounterAction: countCounterAction,
        onContrary: countContrary,
        onEndSession: endSession,
      }),
      renderPlan({ plan, accuracy, registered }),
    );
  }

  paint();
  return root;
}

// ---------------------------------------------------------------------------
// Column 1 — R2: pre-registration, the notebook, and why the cap exists
// ---------------------------------------------------------------------------

function renderRegistration(opts: {
  registered: number;
  refusal: { tendencyId: string; message: string } | null;
  selected: string;
  tracks: ReadonlyMap<string, TrackState>;
  onPreRegister: (id: string) => void;
  onNotebook: (id: string) => void;
  onSelect: (id: string) => void;
}): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'dossier-panel dossier-registration';
  panel.dataset.testid = 'registration-panel';

  panel.appendChild(text('div', 'stat-label', `Dossier — ${VILLAIN}`));
  const villain = text('div', 'dossier-villain', VILLAIN);
  villain.dataset.testid = 'villain-name';
  panel.appendChild(villain);

  const count = text(
    'div',
    'dossier-prereg-count',
    `${opts.registered} of ${PRE_REGISTRATION_CAP} pre-registered`,
  );
  count.dataset.testid = 'prereg-count';
  count.dataset.registered = String(opts.registered);
  count.dataset.cap = String(PRE_REGISTRATION_CAP);
  panel.appendChild(count);

  panel.appendChild(text('div', 'stat-label', 'Tendencies you might think you see'));

  const list = document.createElement('ul');
  list.className = 'dossier-tendency-list';
  list.dataset.testid = 'tendency-list';

  for (const tendency of TENDENCIES) {
    const track = opts.tracks.get(tendency.id);
    const row = document.createElement('li');
    row.className = 'dossier-tendency-row';
    row.dataset.testid = 'tendency-row';
    row.dataset.tendency = tendency.id;
    row.dataset.registered = String(track?.preRegistered === true);
    row.dataset.notebook = String(track?.inNotebook === true);
    row.dataset.n = String(track?.n ?? 0);
    row.dataset.selected = String(tendency.id === opts.selected);

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'dossier-tendency-name';
    name.dataset.testid = 'track-btn';
    name.dataset.tendency = tendency.id;
    name.textContent = tendency.label;
    name.addEventListener('click', () => opts.onSelect(tendency.id));
    row.appendChild(name);

    const actions = document.createElement('div');
    actions.className = 'dossier-tendency-actions';

    const register = document.createElement('button');
    register.type = 'button';
    register.className = 'pill dossier-mini';
    register.dataset.testid = 'prereg-btn';
    register.dataset.tendency = tendency.id;
    register.textContent = track?.preRegistered === true ? 'pre-registered' : 'pre-register';
    register.addEventListener('click', () => opts.onPreRegister(tendency.id));
    actions.appendChild(register);

    const notebook = document.createElement('button');
    notebook.type = 'button';
    notebook.className = 'pill dossier-mini';
    notebook.dataset.testid = 'notebook-btn';
    notebook.dataset.tendency = tendency.id;
    notebook.textContent = 'notebook';
    notebook.addEventListener('click', () => opts.onNotebook(tendency.id));
    actions.appendChild(notebook);

    row.appendChild(actions);
    list.appendChild(row);
  }
  panel.appendChild(list);

  if (opts.refusal !== null) {
    const refused = text('p', 'dossier-refusal', opts.refusal.message);
    refused.dataset.testid = 'prereg-refusal';
    refused.dataset.tendency = opts.refusal.tendencyId;
    panel.appendChild(refused);
  }

  panel.appendChild(text('div', 'stat-label', "Notebook — next session's hypotheses"));
  const notebookList = document.createElement('ul');
  notebookList.className = 'dossier-notebook';
  notebookList.dataset.testid = 'notebook-list';
  const noted = TENDENCIES.filter((t) => opts.tracks.get(t.id)?.inNotebook === true);
  if (noted.length === 0) {
    const empty = text('li', 'dossier-notebook-empty', 'Empty. Nothing has been noticed off-plan yet.');
    empty.dataset.testid = 'notebook-empty';
    notebookList.appendChild(empty);
  }
  for (const tendency of noted) {
    const row = text('li', 'dossier-notebook-row', tendency.label);
    row.dataset.testid = 'notebook-row';
    row.dataset.tendency = tendency.id;
    notebookList.appendChild(row);
  }
  panel.appendChild(notebookList);

  panel.appendChild(text('div', 'stat-label', 'Why two, and why n ≥ 20'));
  panel.appendChild(renderFalseReadArithmetic());

  return panel;
}

/**
 * R2's rationale, computed by core rather than quoted: a baseline opponent looks exploitable on at
 * least one of ten stats at n=10 almost always, and the gate plus the cap is what cuts that down.
 */
function renderFalseReadArithmetic(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'dossier-falseread';
  wrap.dataset.testid = 'false-read-panel';

  const scanned = falseReadProbability(SCANNED_OBSERVABLES, SCANNED_N);
  const oneGated = falseReadProbability(1, MIN_OBSERVATIONS);
  const twoGated = falseReadProbability(PRE_REGISTRATION_CAP, MIN_OBSERVATIONS);

  wrap.appendChild(
    rateRow(
      'false-read-ten-stats',
      scanned.atLeastOne,
      `${SCANNED_OBSERVABLES} stats at n=${SCANNED_N}, baseline villain`,
    ),
  );
  wrap.appendChild(
    rateRow('false-read-one-gated', oneGated.atLeastOne, `1 pre-registered stat at n=${MIN_OBSERVATIONS}`),
  );
  wrap.appendChild(
    rateRow(
      'false-read-two-gated',
      twoGated.atLeastOne,
      `${PRE_REGISTRATION_CAP} pre-registered stats at n=${MIN_OBSERVATIONS}`,
    ),
  );

  const note = text(
    'p',
    'dossier-note',
    'Each number is the chance a villain with no leak at all shows one. It is why the cap is two rather than ten, and it is why the second pre-registration nearly doubles the risk.',
  );
  note.dataset.testid = 'false-read-note';
  wrap.appendChild(note);

  return wrap;
}

function rateRow(testid: string, rate: number, label: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'dossier-rate-row';
  row.dataset.testid = testid;
  row.dataset.rate = rate.toFixed(6);

  const value = text('span', 'dossier-rate-value', percent(rate));
  row.appendChild(value);
  row.appendChild(text('span', 'dossier-rate-label', label));
  return row;
}

// ---------------------------------------------------------------------------
// Column 2 — R6's stream, R1's gates, and the shrinkage trap
// ---------------------------------------------------------------------------

function renderStream(opts: {
  tendency: Tendency;
  read: Read;
  gates: ReturnType<typeof gates>;
  revert: ReturnType<typeof revertState>;
  lastObservation: { tendencyId: string; occurred: boolean; index: number } | null;
  onForecast: (probability: number) => void;
  onCounterAction: () => void;
  onContrary: () => void;
  onEndSession: () => void;
}): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'dossier-panel dossier-stream';
  panel.dataset.testid = 'stream-panel';

  panel.appendChild(text('div', 'stat-label', 'Observing'));
  const subject = text('div', 'dossier-subject', opts.tendency.label);
  subject.dataset.testid = 'stream-subject';
  subject.dataset.tendency = opts.tendency.id;
  panel.appendChild(subject);

  const count = text(
    'div',
    'dossier-observation-count',
    `${opts.read.n} observation${opts.read.n === 1 ? '' : 's'}`,
  );
  count.dataset.testid = 'observation-count';
  count.dataset.n = String(opts.read.n);
  panel.appendChild(count);

  // One at a time, and never a list of what came before: R6's felt scarcity.
  const last = document.createElement('div');
  last.className = 'dossier-last';
  last.dataset.testid = 'last-observation';
  if (opts.lastObservation === null || opts.lastObservation.tendencyId !== opts.tendency.id) {
    last.dataset.occurred = '';
    last.dataset.index = '0';
    last.textContent = 'No observation yet. Forecast to draw the next one.';
  } else {
    last.dataset.occurred = String(opts.lastObservation.occurred);
    last.dataset.index = String(opts.lastObservation.index);
    last.textContent = `#${opts.lastObservation.index}: ${
      opts.lastObservation.occurred ? 'it happened' : 'it did not happen'
    }`;
  }
  panel.appendChild(last);

  panel.appendChild(text('div', 'stat-label', 'Forecast, then the next observation lands'));
  const ladder = document.createElement('div');
  ladder.className = 'dossier-forecast-row';
  ladder.dataset.testid = 'forecast-ladder';
  for (const probability of FORECAST_PROBABILITIES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pill dossier-forecast';
    button.dataset.testid = 'forecast-btn';
    button.dataset.p = String(Math.round(probability * 100));
    button.textContent = `${Math.round(probability * 100)}%`;
    button.addEventListener('click', () => opts.onForecast(probability));
    ladder.appendChild(button);
  }
  panel.appendChild(ladder);

  panel.appendChild(text('div', 'stat-label', 'R1 — two gates, and they are independent'));
  panel.appendChild(renderGates(opts.read, opts.gates));
  panel.appendChild(renderShrinkage(opts.tendency, opts.read, opts.gates, opts.revert));
  panel.appendChild(renderRevert(opts.read, opts.revert, opts.onCounterAction, opts.onContrary, opts.onEndSession));

  return panel;
}

function renderGates(read: Read, g: ReturnType<typeof gates>): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'dossier-gates';

  const sample = gateRow(
    'gate-sample',
    g.sampleGate,
    `sample: n = ${read.n} of ${MIN_OBSERVATIONS} needed`,
  );
  sample.dataset.n = String(read.n);
  sample.dataset.required = String(MIN_OBSERVATIONS);
  wrap.appendChild(sample);

  const deviation = gateRow(
    'gate-deviation',
    g.deviationGate,
    `frequency: ${percent(read.observedFrequency)} observed against a ${percent(
      read.baselineFrequency,
    )} baseline — ${signedPoints(g.deviationPoints)} of ${DEVIATION_THRESHOLD_POINTS} needed`,
  );
  deviation.dataset.points = g.deviationPoints.toFixed(6);
  deviation.dataset.threshold = String(DEVIATION_THRESHOLD_POINTS);
  wrap.appendChild(deviation);

  const licensed = document.createElement('div');
  licensed.className = 'dossier-licensed';
  licensed.dataset.testid = 'gate-licensed';
  licensed.dataset.licensed = String(g.licensed);
  licensed.textContent = g.licensed
    ? 'Both gates open. This tendency may license a deviation.'
    : 'Not licensed. Both gates must be open, and neither one alone is enough.';
  wrap.appendChild(licensed);

  return wrap;
}

function gateRow(testid: string, pass: boolean, label: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'dossier-gate-row';
  row.dataset.testid = testid;
  row.dataset.pass = String(pass);

  const mark = text('span', 'dossier-gate-mark', pass ? 'open' : 'shut');
  row.appendChild(mark);
  row.appendChild(text('span', 'dossier-gate-label', label));
  return row;
}

/**
 * R1's trap, on screen at every n. The weight and the licence are printed side by side precisely so
 * that the case where w is large and the licence is absent is visible rather than inferred.
 */
function renderShrinkage(
  tendency: Tendency,
  read: Read,
  g: ReturnType<typeof gates>,
  revert: ReturnType<typeof revertState>,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'dossier-shrinkage';
  wrap.dataset.testid = 'shrinkage-panel';

  const weight = shrinkageWeight(read.n);
  const magnitude = appliedDeviation(tendency.fullExploitBb, read.n);
  // The licence is the gates', never the weight's. A shut gate deviates by nothing at all.
  const licensedBb = g.licensed ? revert.effectiveWeight * tendency.fullExploitBb : 0;

  wrap.appendChild(text('div', 'stat-label', `Magnitude — w = n/(n+${SHRINKAGE_PRIOR})`));

  const w = figure('shrinkage-weight', weight.toFixed(3), `w at n = ${read.n}`);
  w.dataset.weight = weight.toFixed(6);
  w.dataset.n = String(read.n);
  wrap.appendChild(w);

  const full = figure('full-exploit', `${tendency.fullExploitBb.toFixed(2)} bb`, 'full exploit');
  full.dataset.bb = tendency.fullExploitBb.toFixed(6);
  wrap.appendChild(full);

  const applied = figure('applied-deviation', `${magnitude.toFixed(2)} bb`, 'w × full exploit');
  applied.dataset.bb = magnitude.toFixed(6);
  wrap.appendChild(applied);

  const permitted = figure(
    'licensed-deviation',
    `${licensedBb.toFixed(2)} bb`,
    'what you may actually deviate by',
  );
  permitted.dataset.bb = licensedBb.toFixed(6);
  permitted.dataset.licensed = String(g.licensed);
  wrap.appendChild(permitted);

  const trap = text(
    'p',
    'dossier-trap',
    'Shrinkage is sign-preserving: it scales a deviation but never turns it around, so it is a magnitude control and NEVER a go/no-go control. w is never zero for n > 0 — at n = 3 it is already 0.23, which is a real deviation in whichever direction the read points, including the wrong one. Safety comes from the two gates above, and from nothing else.',
  );
  trap.dataset.testid = 'shrinkage-trap';
  trap.dataset.weight = weight.toFixed(6);
  trap.dataset.licensed = String(g.licensed);
  wrap.appendChild(trap);

  return wrap;
}

/** R4. Every trigger here is a count crossing a constant — no judgment call on this screen. */
function renderRevert(
  read: Read,
  revert: ReturnType<typeof revertState>,
  onCounterAction: () => void,
  onContrary: () => void,
  onEndSession: () => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'dossier-revert';
  wrap.dataset.testid = 'revert-panel';

  wrap.appendChild(text('div', 'stat-label', 'R4 — revert triggers, fired by counting'));

  const multiplier = figure(
    'revert-multiplier',
    `× ${revert.weightMultiplier}`,
    'on top of w',
  );
  multiplier.dataset.multiplier = String(revert.weightMultiplier);
  multiplier.dataset.effectiveWeight = revert.effectiveWeight.toFixed(6);
  wrap.appendChild(multiplier);

  const controls = document.createElement('div');
  controls.className = 'dossier-revert-controls';

  controls.appendChild(
    counter(
      'counter-action-btn',
      'counter-count',
      `counter-actions: ${read.counterActions}`,
      read.counterActions,
      onCounterAction,
    ),
  );
  controls.appendChild(
    counter(
      'contrary-btn',
      'contrary-count',
      `contrary observations: ${read.contraryObservations}`,
      read.contraryObservations,
      onContrary,
    ),
  );

  const end = document.createElement('button');
  end.type = 'button';
  end.className = 'pill dossier-mini';
  end.dataset.testid = 'end-session-btn';
  end.textContent = 'end session';
  end.addEventListener('click', onEndSession);
  controls.appendChild(end);
  wrap.appendChild(controls);

  const triggers = document.createElement('ul');
  triggers.className = 'dossier-triggers';
  triggers.dataset.testid = 'revert-triggers';
  if (revert.triggers.length === 0) {
    const none = text(
      'li',
      'dossier-trigger-row',
      `Nothing has fired. ${COUNTER_ACTIONS_TO_HALVE} counter-actions halve w, ${COUNTER_ACTIONS_TO_BASELINE} drop it to baseline, ${CONTRARY_OBSERVATIONS_TO_CLOSE} contrary observations re-close the gate, and session end expires every read.`,
    );
    none.dataset.testid = 'revert-trigger-none';
    triggers.appendChild(none);
  }
  for (const trigger of revert.triggers) {
    const row = text('li', 'dossier-trigger-row', trigger);
    row.dataset.testid = 'revert-trigger';
    row.dataset.trigger = trigger;
    triggers.appendChild(row);
  }
  wrap.appendChild(triggers);

  return wrap;
}

function counter(
  buttonTestid: string,
  valueTestid: string,
  label: string,
  value: number,
  onClick: () => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'dossier-counter';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pill dossier-mini';
  button.dataset.testid = buttonTestid;
  button.textContent = label;
  button.addEventListener('click', onClick);
  wrap.appendChild(button);

  const readout = text('span', 'dossier-counter-value', String(value));
  readout.dataset.testid = valueTestid;
  readout.dataset.count = String(value);
  wrap.appendChild(readout);

  return wrap;
}

// ---------------------------------------------------------------------------
// Column 3 — R3's plan and O4's grading
// ---------------------------------------------------------------------------

function renderPlan(opts: {
  plan: ReturnType<typeof planDeviations>;
  accuracy: ReturnType<typeof readAccuracy>;
  registered: number;
}): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'dossier-panel dossier-plan';
  panel.dataset.testid = 'plan-panel';

  panel.appendChild(text('div', 'stat-label', 'R3 — the ledger, ranked by reach × bb'));

  const nodeList = document.createElement('ul');
  nodeList.className = 'dossier-node-list';
  nodeList.dataset.testid = 'node-list';
  for (const node of rankNodes(NODES)) {
    const row = document.createElement('li');
    row.className = 'dossier-node-row';
    row.dataset.testid = 'node-row';
    row.dataset.node = node.id;
    row.dataset.value = nodeValue(node).toFixed(6);
    row.dataset.selected = String(opts.plan.nodeIds.includes(node.id));

    row.appendChild(text('span', 'dossier-node-name', node.id));
    row.appendChild(
      text(
        'span',
        'dossier-node-value',
        `${node.reach.toFixed(2)} × ${node.bbPerOccurrence.toFixed(2)} = ${nodeValue(node).toFixed(3)}`,
      ),
    );
    nodeList.appendChild(row);
  }
  panel.appendChild(nodeList);

  const nodeNote = text(
    'p',
    'dossier-note',
    `The top ${MAX_DEVIATION_NODES} nodes carry every deviation and nowhere else does. Spreading it over the whole ledger is the random-node-selection policy: it spends the entire budget and captures almost none of the gain, which is why "play looser against him" is on the ban list and is not available on this screen.`,
  );
  nodeNote.dataset.testid = 'ban-list-note';
  panel.appendChild(nodeNote);

  panel.appendChild(text('div', 'stat-label', `Active deviations — at most ${MAX_ACTIVE_DEVIATIONS}`));

  const active = document.createElement('ul');
  active.className = 'dossier-plan-list';
  active.dataset.testid = 'plan-active';
  if (opts.plan.active.length === 0) {
    const none = text('li', 'dossier-plan-empty', 'None. Baseline everywhere, which is the default and not a failure.');
    none.dataset.testid = 'plan-active-empty';
    active.appendChild(none);
  }
  for (const deviation of opts.plan.active) {
    const row = document.createElement('li');
    row.className = 'dossier-plan-row';
    row.dataset.testid = 'plan-active-row';
    row.dataset.read = deviation.readId;
    row.dataset.weight = deviation.weight.toFixed(6);
    row.dataset.appliedBb = deviation.appliedBb.toFixed(6);
    row.dataset.nodes = deviation.nodeIds.join(',');
    row.appendChild(text('span', 'dossier-plan-name', labelOf(deviation.readId)));
    row.appendChild(
      text(
        'span',
        'dossier-plan-value',
        `${deviation.appliedBb.toFixed(2)} bb at ${deviation.nodeIds.join(' and ')}`,
      ),
    );
    active.appendChild(row);
  }
  panel.appendChild(active);

  panel.appendChild(text('div', 'stat-label', 'Dropped, and why'));
  const dropped = document.createElement('ul');
  dropped.className = 'dossier-plan-list';
  dropped.dataset.testid = 'plan-dropped';
  for (const drop of opts.plan.dropped) {
    const row = document.createElement('li');
    row.className = 'dossier-plan-row';
    row.dataset.testid = 'plan-dropped-row';
    row.dataset.read = drop.readId;
    row.dataset.reason = drop.reason;
    row.appendChild(text('span', 'dossier-plan-name', labelOf(drop.readId)));
    row.appendChild(text('span', 'dossier-plan-value', drop.reason));
    dropped.appendChild(row);
  }
  panel.appendChild(dropped);

  const bindingNote = text(
    'p',
    'dossier-note',
    `Breadth is capped at ${MAX_ACTIVE_DEVIATIONS}, but pre-registration is capped at ${PRE_REGISTRATION_CAP}, so ${PRE_REGISTRATION_CAP} is the cap that actually binds: the third slot cannot be filled by anything you noticed after the session started.`,
  );
  bindingNote.dataset.testid = 'binding-cap-note';
  bindingNote.dataset.registered = String(opts.registered);
  panel.appendChild(bindingNote);

  panel.appendChild(renderAccuracy(opts.accuracy));
  return panel;
}

/** O4. The base-rate benchmark is the one that means something; uniform sits beside it to show why. */
function renderAccuracy(accuracy: ReturnType<typeof readAccuracy>): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'dossier-accuracy';
  wrap.dataset.testid = 'accuracy-panel';

  wrap.appendChild(text('div', 'stat-label', 'O4 — your forecasts, graded'));

  const brier = figure('brier', accuracy.brier.toFixed(4), `Brier over ${accuracy.forecasts} forecasts`);
  brier.dataset.value = accuracy.brier.toFixed(6);
  brier.dataset.forecasts = String(accuracy.forecasts);
  wrap.appendChild(brier);

  const base = figure('base-rate-brier', accuracy.baseRateBrier.toFixed(4), 'node base rate');
  base.dataset.value = accuracy.baseRateBrier.toFixed(6);
  wrap.appendChild(base);

  const uniform = figure('uniform-brier', accuracy.uniformBrier.toFixed(4), 'uniform 50%');
  uniform.dataset.value = accuracy.uniformBrier.toFixed(6);
  wrap.appendChild(uniform);

  const skillBase = figure('skill-vs-base-rate', skillText(accuracy.skillVsBaseRate), 'skill vs base rate');
  skillBase.dataset.value = String(accuracy.skillVsBaseRate);
  wrap.appendChild(skillBase);

  const skillUniform = figure('skill-vs-uniform', skillText(accuracy.skillVsUniform), 'skill vs uniform');
  skillUniform.dataset.value = String(accuracy.skillVsUniform);
  wrap.appendChild(skillUniform);

  const note = text(
    'p',
    'dossier-note',
    'Beating uniform is arithmetic — any node whose true frequency is far from 50% pays you for knowing nothing about this villain. Only beating the node base rate is a read.',
  );
  note.dataset.testid = 'accuracy-note';
  wrap.appendChild(note);

  const lock = text(
    'p',
    'dossier-note',
    accuracy.calibrationReleasable
      ? 'Calibration curve released.'
      : `Calibration curve withheld until ${CALIBRATION_RELEASE_FORECASTS} forecasts. ${accuracy.forecasts} so far.`,
  );
  lock.dataset.testid = 'calibration-lock';
  lock.dataset.releasable = String(accuracy.calibrationReleasable);
  lock.dataset.forecasts = String(accuracy.forecasts);
  lock.dataset.required = String(CALIBRATION_RELEASE_FORECASTS);
  wrap.appendChild(lock);

  return wrap;
}

// ---------------------------------------------------------------------------
// Small shared builders
// ---------------------------------------------------------------------------

function labelOf(tendencyId: string): string {
  return TENDENCIES.find((t) => t.id === tendencyId)?.label ?? tendencyId;
}

function text(tag: string, className: string, content: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = content;
  return el;
}

function figure(testid: string, value: string, label: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'dossier-figure';
  row.dataset.testid = testid;
  row.appendChild(text('span', 'dossier-figure-value', value));
  row.appendChild(text('span', 'dossier-figure-label', label));
  return row;
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function signedPoints(points: number): string {
  const rounded = points.toFixed(1);
  return `${points > 0 ? '+' : ''}${rounded} points`;
}

/** −∞ is a real value here (a base rate that is already perfect), and it must not print as NaN. */
function skillText(value: number): string {
  if (!Number.isFinite(value)) return value < 0 ? '−∞' : '∞';
  return `${(value * 100).toFixed(1)}%`;
}
