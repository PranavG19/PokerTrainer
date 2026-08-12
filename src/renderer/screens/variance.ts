import '../styles-variance.css';
import { riskOfLosing, SIGMA_BB_PER_100, type VarianceRisk } from '../../core/arithmetic.js';

/**
 * VARIANCE EXPLAINER — where the results-graph refusal (progress.ts) sends a learner who wants a graph.
 * The spec withholds the win rate below 2,000 hands and refuses the results graph below 10,000 (P1/P3);
 * this surface says WHY, with the actual arithmetic rather than a slogan. Every number here comes from
 * core/arithmetic.ts riskOfLosing — the same function the spec's "~8% of 200-hand sessions lose two or
 * more buy-ins at zero strategic error" is computed from — so nothing is asserted or fabricated: change
 * sigma or the sample and the figures move. It teaches the mechanism (a bb/100 estimate's error shrinks
 * only with the square root of the sample) rather than a memorised cutoff.
 *
 * Sync for e2e: the root publishes data-testid on each computed row, so a test reads the real numbers.
 */

/** The standard deviation the whole explainer is built on, stated once so the page cannot drift from it. */
const SIGMA = SIGMA_BB_PER_100;

/**
 * The sample sizes worth showing, each with the buy-in loss whose odds make the point at that scale, and
 * a fixed 5 bb/100 "solid winner" rate so the reader sees that even a real edge loses over a short sample.
 * The three sizes are the two spec thresholds bracketed by a single session, so the page maps to the exact
 * cutoffs it is explaining.
 */
const WIN_RATE = 5;
const SAMPLES: readonly { readonly hands: number; readonly buyIns: number; readonly frame: string }[] = [
  { hands: 200, buyIns: 2, frame: 'one session' },
  { hands: 2_000, buyIns: 5, frame: 'where the win rate is first shown' },
  { hands: 10_000, buyIns: 10, frame: 'where a results graph is allowed' },
];

export interface VarianceOptions {
  /** Leave the explainer and return to where the caller mounted it (the Progress screen route). */
  readonly onExit?: () => void;
}

export function renderVarianceScreen(options: VarianceOptions = {}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'variance-screen';
  root.dataset.testid = 'variance-screen';

  root.appendChild(text('h2', 'variance-title', 'Why there is no results graph yet'));

  const lede = text(
    'p',
    'variance-lede',
    `A win rate is an estimate, and its error shrinks only with the square root of the sample. At a standard deviation of ${SIGMA} bb per 100 hands, a solid ${WIN_RATE} bb/100 winner still finishes a short stretch in the red often enough that the number would say more about the run than the play. That is why the graph waits.`,
  );
  lede.dataset.testid = 'variance-lede';
  root.appendChild(lede);

  const table = document.createElement('div');
  table.className = 'variance-table';
  table.dataset.testid = 'variance-table';
  for (const sample of SAMPLES) {
    const risk = riskOfLosing({ hands: sample.hands, winRateBbPer100: WIN_RATE, buyIns: sample.buyIns });
    table.appendChild(renderRow(sample.hands, sample.buyIns, sample.frame, risk));
  }
  root.appendChild(table);

  const close = text(
    'p',
    'variance-close',
    'The estimate does not get luckier with more hands — it gets more certain. The band around a win rate only tightens as the sample grows, which is the whole reason the number is withheld until there are enough hands to mean something.',
  );
  close.dataset.testid = 'variance-close';
  root.appendChild(close);

  if (options.onExit) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'pill variance-back';
    back.dataset.testid = 'variance-back';
    back.textContent = 'Back to progress';
    back.addEventListener('click', options.onExit);
    root.appendChild(back);
  }

  return root;
}

/** One sample-size row: the frame, the honest odds of a losing stretch, and its natural-frequency form. */
function renderRow(hands: number, buyIns: number, frame: string, risk: VarianceRisk): HTMLElement {
  const row = document.createElement('div');
  row.className = 'variance-row';
  row.dataset.testid = 'variance-row';
  row.dataset.hands = String(hands);
  // The computed probability, exposed for the e2e so the test reads core's real number, not the prose.
  row.dataset.probability = risk.probability.toFixed(4);

  const scale = text('div', 'variance-scale', `${hands.toLocaleString()} hands`);
  scale.className = 'variance-scale';
  row.appendChild(scale);

  const frameLine = text('div', 'variance-frame stat-label', frame);
  row.appendChild(frameLine);

  // The odds of finishing this sample down `buyIns`+ buy-ins, in the natural-frequency form the app
  // prefers over a percentage — the same rendering potOdds uses.
  const odds = text(
    'div',
    'variance-odds',
    `A ${WIN_RATE} bb/100 winner still finishes down ${buyIns}+ buy-ins ${risk.frequency.text}.`,
  );
  odds.dataset.testid = 'variance-odds';
  odds.dataset.frequency = risk.frequency.text;
  row.appendChild(odds);

  return row;
}

function text(tag: string, className: string, content: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = content;
  return el;
}
