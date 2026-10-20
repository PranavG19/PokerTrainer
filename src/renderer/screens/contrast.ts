import '../styles-contrast.css';

import {
  AXIS_AVAILABILITY,
  differingAxes,
  hammingDistance,
  type ContrastAxis,
  type ContrastVariant,
} from '../../core/contrast.js';
import {
  remediate,
  remediationQueue,
  type AxisOffer,
  type QueueEntry,
  type Remediation,
} from '../../core/contrastManifest.js';
import { legalActions } from '../../core/table.js';
import type { HandRecord } from '../../core/session.js';
import {
  createLexicon,
  feedbackOpening,
  type AcceptedSentence,
  type LexiconAttempt,
  type MechanismFrame,
} from '../../core/lexicon.js';
import { renderCard, renderCardRow } from '../components/card.js';
import { text } from '../components/dom.js';
import { chevron } from '../components/glyphs.js';
import { renderDee } from '../components/dee.js';
import { attachThumb } from '../components/thumb.js';
import type { FolioCard } from '../../core/folio.js';
import type { TaughtSet } from '../../core/progression/types.js';
import type { Tone } from '../../core/dee/types.js';
import {
  AXIS_NAMES,
  DIAGNOSIS_OPTIONS,
  FINDING_TITLES,
  MOVES,
  MOVE_LABELS,
  MOVE_WORDS,
  baseLabel,
  buildTeachSet,
  deeMove,
  defaultBaseFor,
  detectRepair,
  findingOf,
  latestSets,
  levelLabel,
  levelOf,
  oppositeOf,
  readingFor,
  suggestReading,
  teachLine,
  teachSeed,
  teachableBases,
  type Finding,
  type Move,
  type Repair,
  type RuleReading,
  type TeachBase,
  type TeachEvent,
  type TeachFacts,
  type TeachSpot,
} from '../../core/teachDee.js';

/**
 * THE REPAIR TAB — contrast-set remediation. PRODUCT-SPEC B6, S2, and G1's T2 row.
 *
 * A PURE READER over src/core/contrast.ts and src/core/contrastManifest.ts. Every fact on this
 * screen — which spots differ, what differs between them, how many spots an axis can honestly fill,
 * why an axis cannot be built, which leak fired the repair, when the repair is due again — comes
 * back out of core. This file contains no poker and no arithmetic of its own; the only numbers it
 * writes are chips divided by the big blind for display.
 *
 * THE SINGLE TOGGLED DIMENSION IS THE WHOLE INSTRUCTIONAL DEVICE (B6), so it is not merely implied
 * by the cards. Each variant prints the axis that moved and the value it moved to, prints every axis
 * held fixed beside it, and publishes `data-differs` / `data-hamming` straight from core's
 * differingAxes / hammingDistance. If two variables ever moved, the screen would say so rather than
 * label the pair as a one-variable contrast.
 *
 * HONESTY ABOUT AXES THAT DO NOT EXIST HERE (B6). Board texture and stack depth need a separately
 * solved tree and this build has no solver; range asymmetry needs the two ranges at the node. A
 * manifested axis that cannot be built is rendered as a row carrying core's stated reason — never
 * omitted, and never a control that looks operable. It is not a button, because a disabled button
 * reads as something withheld and N1 withholds nothing: the axis is absent from the world, not from
 * the learner.
 *
 * S2's FLOOR IS VISIBLE, NOT IMPLICIT. When no manifested axis can be built the screen shows the
 * worked example (B6's rare runtime fallback) together with the reason every axis failed, because a
 * T2 that reaches the spacing queue with no repair is worse than one that was never graded.
 */

/** Fixed: the sequence of neighbours must be identical on every launch for the e2e suite to pin it. */
const SEED = 19;

/**
 * Every axis in B6's vector gets a display name, keyed by ContrastAxis so this fails to compile the
 * day core adds one. An unlabelled axis rendering as its identifier would be a silent content gap.
 */
const AXIS_LABELS: Record<ContrastAxis, string> = {
  suitedness: 'Suitedness',
  kickerGap: 'Kicker / gap',
  position: 'Position',
  playersBehind: 'Players behind',
  rangeAsymmetry: 'Range asymmetry',
  boardTexture: 'Board texture',
  stackDepth: 'Stack depth',
};

/** L2's three mechanism framings, spelled for display — the sentence the learner is asked to write in. */
const FRAME_LABELS: Record<MechanismFrame, string> = {
  'domination-risk': 'domination risk',
  'equity-realisation': 'equity realisation',
  'range-asymmetry': 'range asymmetry',
};

interface ContrastScreenOpts {
  /** The persisted hand log. T2 grades in it are what fire a repair (G1's T2 row). */
  readonly hands: readonly HandRecord[];
  /**
   * L1/L3: the persisted lexicon log, rehydrated so an accepted mechanism sentence keeps naming its
   * concept across sittings. Absent → an empty lexicon (nothing quoted yet).
   */
  readonly lexicon?: readonly LexiconAttempt[];
  /** Persist one recorded attempt. Called once per commit; main.ts appends it to the session and saves. */
  readonly onLexiconAttempt?: (attempt: LexiconAttempt) => void;
  /** Teach Dee: play a contrast set from one of the learner's own rules (renderTeachDee). Absent hides the row. */
  readonly onTeach?: () => void;
  /** Rules in the Folio, for the Teach Dee row's caption. */
  readonly rules?: number;
}

export function renderContrastScreen(opts: ContrastScreenOpts): HTMLElement {
  const queue = remediationQueue(opts.hands);

  const root = document.createElement('div');
  root.className = 'repair-screen';
  root.dataset.testid = 'repair-screen';
  root.dataset.queueLength = String(queue.length);

  // The verdict on a committed sentence updates in place, so a screen-reader user gets no feedback
  // without a live region. This always-present polite region mirrors renderLexiconFeedback's wording;
  // it is kept as the root's first child in every paint branch so it survives replaceChildren, and is
  // visually hidden + absolute-positioned so it takes no space in the flex column. Empty until a commit
  // and cleared on a concept/view switch (lastAttempt resets there).
  const verdictAnnouncer = document.createElement('div');
  verdictAnnouncer.className = 'visually-hidden';
  verdictAnnouncer.dataset.testid = 'lexicon-announcer';
  verdictAnnouncer.setAttribute('role', 'status');
  verdictAnnouncer.setAttribute('aria-live', 'polite');
  root.appendChild(verdictAnnouncer);

  /**
   * The queue and one concept are separate views rather than one column, for the same reason
   * lesson.ts splits its list from its lesson: at the documented 900x640 minimum the queue alone
   * fills the viewport, so a concept rendered beneath it would open with its own title scrolled off
   * the top edge — the learner would land on a repair they cannot see.
   */
  let view: 'queue' | 'concept' = 'queue';
  let selected = 0;
  /** `null` means "show whichever axis core could build first" — see `axisToShow`. */
  let axis: ContrastAxis | null = null;

  /**
   * The learner's lexicon (L1/L2/L3), rehydrated from the persisted log. Built once per mount and
   * appended to locally; every accepted/rejected attempt is also handed up to `onLexiconAttempt` so the
   * session log and this one never diverge (the same seed-plus-callback shape charts.ts uses for mastery).
   */
  const lexicon = createLexicon(opts.lexicon ?? []);
  /** The most recent attempt, shown as feedback under the input. Cleared on a concept switch. */
  let lastAttempt: LexiconAttempt | null = null;

  const selectConcept = (index: number): void => {
    selected = index;
    axis = null;
    lastAttempt = null;
    view = 'concept';
    paint();
    root.scrollTop = 0;
  };

  /**
   * L1: the learner's sentence naming the concept. An empty box is not an attempt (core throws on it by
   * design), so it is a no-op here rather than a recorded blank. The verdict — accepted with its frame,
   * or rejected with L2's reason — comes straight back out of the store; this screen classifies nothing.
   */
  const commitSentence = (conceptId: string, flippingAxis: ContrastAxis, sentence: string): void => {
    if (sentence.trim() === '') return;
    const attempt = lexicon.record({ conceptId, sentence, at: Date.now(), flippingAxis });
    opts.onLexiconAttempt?.(attempt);
    lastAttempt = attempt;
    paint();
  };

  const showQueue = (): void => {
    view = 'queue';
    paint();
    root.scrollTop = 0;
  };

  const selectAxis = (next: ContrastAxis): void => {
    axis = next;
    paint();
  };

  function paint(): void {
    root.dataset.view = view;
    // Mirror the last verdict into the live region — same wording as renderLexiconFeedback — only in the
    // concept view (the queue and empty views have no verdict). Empty otherwise.
    verdictAnnouncer.textContent =
      view === 'concept' && lastAttempt !== null ? lexiconVerdictAnnouncement(lastAttempt) : '';

    if (queue.length === 0) {
      root.dataset.kind = 'empty';
      delete root.dataset.conceptId;
      delete root.dataset.axis;
      root.replaceChildren(
        verdictAnnouncer,
        heading(),
        emptyState(
          'No repairs in this build',
          'The contrast-axis manifest is empty, so there is nothing to repair yet. Nothing is locked — the tab stays open.',
        ),
      );
      return;
    }

    if (view === 'queue') {
      delete root.dataset.conceptId;
      delete root.dataset.axis;
      delete root.dataset.kind;
      root.replaceChildren(verdictAnnouncer, heading(), ...(opts.onTeach ? [renderTeachEntry(opts.onTeach, opts.rules ?? 0)] : []), renderQueue());
      return;
    }

    const item = queue[selected];
    const remediation = remediate(item.entry, SEED);
    const showing = axisToShow(remediation);

    root.dataset.conceptId = item.entry.conceptId;
    root.dataset.kind = remediation.kind;
    if (showing === null) delete root.dataset.axis;
    else root.dataset.axis = showing;

    root.replaceChildren(verdictAnnouncer, renderConcept(item, remediation, showing));
  }

  /** The axis whose set is on screen: the learner's pick when it built, else the first that did. */
  function axisToShow(remediation: Remediation): ContrastAxis | null {
    const picked = remediation.offers.find((offer) => offer.axis === axis && offer.set !== null);
    if (picked !== undefined) return picked.axis;
    return remediation.offers.find((offer) => offer.set !== null)?.axis ?? null;
  }

  function heading(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'repair-heading';
    header.appendChild(text('div', 'repair-title t-t2', 'Repair'));
    header.appendChild(
      text(
        'div',
        'repair-hint g-sub',
        'A leak worth 0.5 to 2 bb is corrected at the end of a block, not mid-hand: it fires a set of near-identical positions where exactly one variable moves, and it comes back on a spacing schedule.',
      ),
    );
    return header;
  }

  function renderQueue(): HTMLElement {
    const list = document.createElement('div');
    // Every row opens a concept, so the queue is one inset group of rows.
    list.className = 'repair-queue g-group';
    list.dataset.testid = 'repair-queue';

    for (const [index, item] of queue.entries()) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'repair-row g-row';
      row.dataset.testid = 'repair-row';
      row.dataset.conceptId = item.entry.conceptId;
      row.dataset.fired = String(item.firedBy !== null);
      row.dataset.selected = String(index === selected);
      row.addEventListener('click', () => selectConcept(index));

      const body = document.createElement('span');
      body.className = 'repair-row-body';
      body.appendChild(text('span', 'repair-row-title', item.entry.title));
      body.appendChild(text('span', 'repair-row-family', item.entry.nodeFamily));

      const trigger = text(
        'span',
        'repair-row-trigger',
        item.firedBy === null
          ? `Not fired yet · repairs ${item.entry.repairs}`
          : `${item.firedBy.costBb.toFixed(1)} bb across ${item.firedBy.count} ${item.firedBy.count === 1 ? 'decision' : 'decisions'} · ${item.entry.repairs}`,
      );
      trigger.dataset.testid = 'repair-trigger';
      body.appendChild(trigger);
      row.appendChild(body);
      row.appendChild(chevron());
      list.appendChild(row);
    }
    return list;
  }

  function renderConcept(
    item: QueueEntry,
    remediation: Remediation,
    showing: ContrastAxis | null,
  ): HTMLElement {
    const panel = document.createElement('section');
    panel.className = 'repair-concept';
    panel.dataset.testid = 'repair-concept';
    panel.dataset.conceptId = item.entry.conceptId;

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'pill quiet sm repair-back';
    back.dataset.testid = 'repair-back';
    back.textContent = 'All repairs';
    back.addEventListener('click', showQueue);
    panel.appendChild(back);

    const title = text('h1', 'repair-concept-title t-t2', item.entry.title);
    title.dataset.testid = 'repair-concept-title';
    panel.appendChild(title);
    panel.appendChild(
      text('div', 'stat-label g-label', `${item.entry.nodeFamily} · repairs ${item.entry.repairs}`),
    );

    const queued = text(
      'p',
      'repair-queued',
      `This repair returns on day ${remediation.repairDays.join(', day ')} after the miss.`,
    );
    queued.dataset.testid = 'repair-days';
    queued.dataset.days = remediation.repairDays.join(',');
    panel.appendChild(queued);

    // L1: once a sentence is adopted for this concept, its feedback OPENS by quoting it.
    const opening = feedbackOpening(lexicon, item.entry.conceptId);
    if (opening !== null) {
      const quote = text('p', 'lexicon-quote', opening);
      quote.dataset.testid = 'lexicon-quote';
      panel.appendChild(quote);
    }

    panel.appendChild(renderAxisOffers(remediation, showing));

    if (showing === null) {
      panel.appendChild(renderFallback(remediation));
      return panel;
    }
    const offer = remediation.offers.find((o) => o.axis === showing);
    if (offer?.set != null) {
      panel.appendChild(renderSet(offer));
      // The set is the resolved contrast; naming it in one mechanism sentence is L1's whole device.
      panel.appendChild(renderLexiconPanel(item.entry.conceptId, showing));
    }
    return panel;
  }

  /**
   * L1/L2/L3 in one panel: the prompt to name the concept, the input, the verdict on the last attempt,
   * and the accepted history. A closure so it can reach `lexicon`, `commitSentence` and `lastAttempt`.
   */
  function renderLexiconPanel(conceptId: string, flippingAxis: ContrastAxis): HTMLElement {
    const section = document.createElement('section');
    section.className = 'lexicon-panel';
    section.dataset.testid = 'lexicon-panel';
    section.dataset.conceptId = conceptId;
    section.dataset.axis = flippingAxis;

    section.appendChild(text('div', 'stat-label g-label', 'Name the concept in your own words'));
    section.appendChild(
      text(
        'p',
        'lexicon-prompt',
        'Which variable flipped the answer here, and why? Say it as a mechanism — domination risk, equity realisation or range asymmetry — not as a chart cell.',
      ),
    );

    const box = document.createElement('textarea');
    box.className = 'lexicon-input';
    box.dataset.testid = 'lexicon-input';
    box.rows = 2;
    box.placeholder = 'e.g. the worse kicker is dominated when it pairs, so it makes second best…';
    // The "Name the concept…" prompt above is not associated; name the textarea itself.
    box.setAttribute('aria-label', 'Name the concept in your own words');
    section.appendChild(box);

    const submit = document.createElement('button');
    submit.type = 'button';
    // The one committing action on a concept, so it is the bone primary.
    submit.className = 'pill primary lexicon-submit';
    submit.dataset.testid = 'lexicon-submit';
    submit.textContent = 'Adopt this sentence';
    submit.addEventListener('click', () => commitSentence(conceptId, flippingAxis, box.value));
    section.appendChild(submit);

    // The verdict on the last attempt for THIS concept (a switch clears it, so no stale carry-over).
    if (lastAttempt !== null && lastAttempt.conceptId === conceptId) {
      section.appendChild(renderLexiconFeedback(lastAttempt));
    }

    // L3: earlier accepted sentences stay visible, oldest first.
    const history = lexicon.historyFor(conceptId);
    if (history.length > 0) section.appendChild(renderLexiconHistory(history));

    return section;
  }

  /**
   * Every manifested axis, in manifest order. A buildable one is a control carrying the number of
   * spots it can honestly fill; an unbuildable one is a row carrying core's reason — B6's honest
   * per-concept coverage, rendered rather than filtered.
   */
  function renderAxisOffers(remediation: Remediation, showing: ContrastAxis | null): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'axis-offers';
    wrap.dataset.testid = 'axis-offers';

    for (const offer of remediation.offers) {
      const available = offer.set !== null;
      const cell = document.createElement(available ? 'button' : 'div');
      cell.className = available ? 'axis-offer' : 'axis-offer axis-offer-absent';
      cell.dataset.testid = 'axis-offer';
      cell.dataset.axis = offer.axis;
      cell.dataset.available = String(available);
      cell.dataset.spots = String(offer.spots);
      cell.dataset.selected = String(offer.axis === showing);

      cell.appendChild(text('span', 'axis-offer-name', AXIS_LABELS[offer.axis]));
      /*
       * TWO DIFFERENT REASONS AN AXIS CAN BE UNOFFERED, and they used to print the same label.
       * "not in this build" was shown for every empty offer, including axes core declares
       * AVAILABLE — playersBehind is `available: true`, and on a BTN-postflop base it yields no
       * set only because hero has nobody behind. Calling that "not in this build" tells the
       * learner the app lacks the axis when the truth is that this NODE cannot vary it, which
       * B6's honest-coverage requirement rules out. The reason line beneath was already correct,
       * so the headline was contradicting the sentence under it.
       */
      const inBuild = AXIS_AVAILABILITY[offer.axis].available;
      cell.dataset.inBuild = String(inBuild);
      const meta = available
        ? `${offer.spots} positions`
        : inBuild
          ? 'not on this spot'
          : 'not in this build';
      const metaCell = text('span', 'axis-offer-meta', meta);
      metaCell.dataset.testid = 'axis-meta';
      cell.appendChild(metaCell);

      if (available && cell instanceof HTMLButtonElement) {
        cell.type = 'button';
        cell.addEventListener('click', () => selectAxis(offer.axis));
      } else {
        const why = text('span', 'axis-offer-reason', offer.reason);
        why.dataset.testid = 'axis-reason';
        cell.appendChild(why);
      }
      wrap.appendChild(cell);
    }
    return wrap;
  }

  function renderSet(offer: AxisOffer): HTMLElement {
    const set = offer.set;
    if (set === null) throw new Error('renderSet called without a set');

    const section = document.createElement('section');
    section.className = 'contrast-set';
    section.dataset.testid = 'contrast-set';
    section.dataset.axis = set.axis;
    section.dataset.spots = String(set.variants.length + 1);

    const claim = text(
      'p',
      'contrast-claim t-head',
      `Only ${AXIS_LABELS[set.axis].toLowerCase()} moves across these ${set.variants.length + 1} positions. Everything else is held.`,
    );
    claim.dataset.testid = 'contrast-claim';
    section.appendChild(claim);

    const spots = document.createElement('div');
    spots.className = 'contrast-spots';
    spots.appendChild(renderVariant(set.base, set.axis, 'base', set.base));
    for (const variant of set.variants) {
      spots.appendChild(renderVariant(variant, set.axis, 'variant', set.base));
    }
    section.appendChild(spots);
    return section;
  }

  /**
   * One spot. `data-differs` and `data-hamming` come from core's own comparison of the feature
   * vectors, so the claim "exactly one thing differs" is readable off the DOM without trusting this
   * file's prose — and if core ever emitted a two-variable pair, that is what the attributes would
   * say.
   */
  function renderVariant(
    variant: ContrastVariant,
    axis: ContrastAxis,
    role: 'base' | 'variant',
    base: ContrastVariant,
  ): HTMLElement {
    const moved = differingAxes(base.features, variant.features);

    const card = document.createElement('article');
    card.className = 'contrast-spot';
    card.dataset.testid = 'contrast-spot';
    card.dataset.role = role;
    card.dataset.differs = moved.join(',');
    card.dataset.hamming = String(hammingDistance(base.features, variant.features));

    const label = text(
      'div',
      'stat-label g-label',
      role === 'base' ? 'The position you missed' : `${AXIS_LABELS[axis]} moved`,
    );
    card.appendChild(label);

    const cards = document.createElement('div');
    cards.className = 'contrast-cards';
    const hole = document.createElement('div');
    hole.className = 'contrast-hole';
    hole.dataset.testid = 'contrast-hole';
    for (const held of variant.spot.hole) hole.appendChild(renderCard(held, { small: true }));
    cards.appendChild(group('Your hand', hole));

    const board = document.createElement('div');
    board.className = 'contrast-board';
    board.dataset.testid = 'contrast-board';
    if (variant.spot.board.length === 0) {
      board.appendChild(text('span', 'contrast-noboard', 'No board yet'));
    } else {
      board.appendChild(renderCardRow([...variant.spot.board], { small: true }));
    }
    cards.appendChild(group('Board', board));
    card.appendChild(cards);

    // The moved axis, named and valued. This is the sentence the whole device rests on.
    const toggled = text(
      'div',
      'contrast-toggled',
      role === 'base'
        ? `${AXIS_LABELS[axis]}: ${axisValue(variant, axis)} — the baseline`
        : `${AXIS_LABELS[axis]}: ${axisValue(base, axis)} → ${axisValue(variant, axis)}`,
    );
    toggled.dataset.testid = 'contrast-toggled';
    toggled.dataset.axis = axis;
    card.appendChild(toggled);

    card.appendChild(renderHeld(variant, axis));

    const spot = variant.spot;
    const facts = text(
      'div',
      'contrast-facts',
      [
        `Pot ${inBb(variant.state.pot, spot.bb)} bb`,
        `${spot.effectiveStackBb} bb deep`,
        `vs ${spot.villainPositions.join(', ')}`,
        // Straight off the engine: a spot nobody can act in would not be a decision.
        `you can ${legalActions(variant.state).join(' / ')}`,
      ].join(' · '),
    );
    facts.dataset.testid = 'contrast-facts';
    card.appendChild(facts);

    return card;
  }

  /** Every axis except the toggled one, with its held value. The other half of the one-variable claim. */
  function renderHeld(variant: ContrastVariant, axis: ContrastAxis): HTMLElement {
    const held = document.createElement('div');
    held.className = 'contrast-held';
    held.dataset.testid = 'contrast-held';

    for (const other of Object.keys(AXIS_LABELS) as ContrastAxis[]) {
      if (other === axis) continue;
      const cell = text('span', 'contrast-held-cell', `${AXIS_LABELS[other]} ${axisValue(variant, other)}`);
      cell.dataset.axis = other;
      cell.dataset.value = axisValue(variant, other);
      held.appendChild(cell);
    }
    return held;
  }

  function renderFallback(remediation: Remediation): HTMLElement {
    const section = document.createElement('section');
    section.className = 'worked-example';
    section.dataset.testid = 'worked-example';

    section.appendChild(
      text('div', 'stat-label g-label', 'No one-variable neighbour exists here, so this is the worked example'),
    );

    const steps = document.createElement('ol');
    steps.className = 'worked-steps';
    for (const step of remediation.fallback?.steps ?? []) {
      const item = document.createElement('li');
      item.className = 'worked-step';
      item.dataset.testid = 'worked-step';
      item.textContent = step;
      steps.appendChild(item);
    }
    section.appendChild(steps);

    // S2: the repair is not cut, it is substituted — and the substitution says why, per axis.
    const why = text(
      'p',
      'worked-reason',
      `Why no set: ${remediation.fallback?.reason ?? 'unstated'}`,
    );
    why.dataset.testid = 'fallback-reason';
    section.appendChild(why);

    const floor = text(
      'p',
      'worked-floor',
      'Remediation is never dropped: a leak that reaches the spacing schedule with no repair would be re-taught at every rep.',
    );
    floor.dataset.testid = 'remediation-floor';
    section.appendChild(floor);

    return section;
  }

  paint();
  return root;
}

/** Reads one axis off core's feature vector. Every value shown on screen comes through here. */
function axisValue(variant: ContrastVariant, axis: ContrastAxis): string {
  return String(variant.features[axis]);
}

/**
 * The verdict on the last sentence, told apart by WEIGHT and WORDING, never colour (V2 parity with the
 * drills). An accepted sentence gets a quiet confirmation — silence is not praise, so it is not
 * celebrated; a rejected one states L2's correction in full-contrast medium type, and the first
 * rejection per concept invites a reframe (the "pushes back once" flag). Both are recorded either way.
 */
/**
 * The verdict as one spoken line for the screen-reader live region, mirroring renderLexiconFeedback's
 * wording: the adopted confirmation and its frame label, or the rejection reason and its pushback note.
 * Same strings as the DOM feedback so the two cannot drift.
 */
function lexiconVerdictAnnouncement(attempt: LexiconAttempt): string {
  if (attempt.outcome === 'accepted') {
    return `Adopted — this now opens your feedback on this concept. ${FRAME_LABELS[attempt.frame]}`;
  }
  const pushback = attempt.pushback
    ? ' Reframe it and try again — the sentence is kept either way.'
    : '';
  return `${attempt.reasonText}${pushback}`;
}

function renderLexiconFeedback(attempt: LexiconAttempt): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'lexicon-feedback';
  wrap.dataset.testid = 'lexicon-feedback';
  wrap.dataset.verdict = attempt.outcome;

  if (attempt.outcome === 'accepted') {
    wrap.dataset.frame = attempt.frame;
    const verdict = text('span', 'lexicon-verdict', 'Adopted — this now opens your feedback on this concept.');
    verdict.dataset.testid = 'lexicon-verdict';
    wrap.appendChild(verdict);
    const frame = text('span', 'lexicon-frame', FRAME_LABELS[attempt.frame]);
    frame.dataset.testid = 'lexicon-frame';
    wrap.appendChild(frame);
    return wrap;
  }

  wrap.dataset.reason = attempt.reason;
  const verdict = text('span', 'lexicon-verdict', attempt.reasonText);
  verdict.dataset.testid = 'lexicon-verdict';
  wrap.appendChild(verdict);
  if (attempt.pushback) {
    const note = text('span', 'lexicon-pushback', 'Reframe it and try again — the sentence is kept either way.');
    note.dataset.testid = 'lexicon-pushback';
    wrap.appendChild(note);
  }
  return wrap;
}

/** L3's "earlier ones are visible": every accepted sentence for the concept, oldest first. */
function renderLexiconHistory(history: readonly AcceptedSentence[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'lexicon-adopted';
  // `lexicon-adopted`, not `lexicon-history`: the latter is lesson.ts's own hand-rolled store, and
  // keeping the testids distinct stops a future cross-screen helper conflating the two.
  wrap.dataset.testid = 'lexicon-adopted';
  wrap.dataset.count = String(history.length);
  wrap.appendChild(text('div', 'stat-label g-label', 'Your sentences for this concept'));
  for (const entry of history) {
    const row = text('p', 'lexicon-adopted-row', `“${entry.sentence}”`);
    row.dataset.testid = 'lexicon-adopted-row';
    wrap.appendChild(row);
  }
  return wrap;
}

/** The Repair tab's way into Teach Dee: one openable row above the queue. */
function renderTeachEntry(onTeach: () => void, rules: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'g-group';
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'repair-row g-row';
  row.dataset.testid = 'teach-entry';
  const body = document.createElement('span');
  body.className = 'repair-row-body';
  body.appendChild(text('span', 'repair-row-title', 'Teach Dee one of your rules'));
  body.appendChild(
    text(
      'span',
      'repair-row-family',
      rules === 0 ? 'Write a rule in a lesson first; then Dee plays a contrast set from it' : `${rules} ${rules === 1 ? 'rule' : 'rules'} in your Rulebook · Dee plays a contrast set from the one you pick`,
    ),
  );
  row.append(body, chevron());
  row.addEventListener('click', onTeach);
  wrap.appendChild(row);
  return wrap;
}

function inBb(chips: number, bb: number): string {
  const value = chips / bb;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function group(label: string, cards: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'contrast-group';
  wrap.appendChild(cards);
  wrap.appendChild(text('div', 'stat-label g-label', label));
  return wrap;
}


function emptyState(title: string, body: string): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.dataset.testid = 'repair-empty';
  empty.appendChild(text('div', 'empty-state-title', title));
  empty.appendChild(text('div', 'empty-state-body', body));
  return empty;
}

// ── TEACH DEE: contrast sets played from the learner's own rules (BUILD-PLAN 2.4) ──────────────────

/**
 * TEACH DEE. The learner hands Dee one of their Folio rules, says how to read it (the variable, the value it
 * applies at, the play there and the play everywhere else), and Dee plays a contrast set from it: pairs of real
 * deals that differ in exactly that variable. The learner commits their own play on each spot first; then Dee's
 * play and the engine's verdict are shown. At the end, repair detection (core/teachDee.ts) reads Dee's misses
 * off the verdicts. When the rule is wrong, the learner names what went wrong BEFORE the reveal, then rewrites
 * the sentence, which the lexicon appends (L3).
 *
 * A PURE READER, like the Repair tab: every verdict is gradeSpot's and every fact is the engine's state. Dee's
 * lines come from core's bank (linted in tests/unit/teachDee.test.ts) and carry no number of their own. With
 * Character off, the same facts read "the rule plays …" and Dee's mark and lines are not shown.
 */

export interface TeachDeeProps {
  /** The Folio, newest and tarnished first: the rules that can be taught. */
  readonly cards: readonly FolioCard[];
  readonly label: (conceptId: string) => string;
  /** Open on this rule's reading; null opens on the rule list. */
  readonly initialConcept: string | null;
  /** Every set taught so far: its count per rule seeds the next deal, its newest finding labels the list. */
  readonly taught: readonly TaughtSet[];
  /** Rules whose newest set asked for a rewrite that is not written yet. */
  readonly rewritesDue: readonly string[];
  readonly lexicon: readonly LexiconAttempt[];
  /** Dee's tone and whether Character is on (off hides Dee's mark and lines). */
  readonly dee: { readonly tone: Tone; readonly character: boolean };
  /** The rule's coach principle, for the default spot. */
  readonly principleOf: (conceptId: string) => string | null;
  /** A set was played to its end. Called once per set. */
  readonly onFinished: (set: TaughtSet) => void;
  /** A rewrite was recorded (accepted or not). */
  readonly onLexiconAttempt: (attempt: LexiconAttempt) => void;
  readonly onBack: () => void;
  readonly backLabel: string;
  /** No rules yet: where one is written. */
  readonly onWriteRule: () => void;
  readonly now: () => number;
}

type TeachPhase = 'pick' | 'read' | 'play' | 'repair';

const TEACH_AXIS_LABELS: Partial<Record<ContrastAxis, string>> = {
  suitedness: 'Suitedness',
  kickerGap: 'Gap',
  position: 'Seat',
  playersBehind: 'Behind',
};

/** Short chip labels for a level. The long form (levelLabel) is what Dee and the tag line say. */
function levelChip(axis: ContrastAxis, value: string): string {
  if (axis === 'kickerGap') {
    const chips: Record<string, string> = { pair: 'Pair', connected: 'Connected', 'one-gap': 'Gapped', 'two-gap': 'Wider gap', wide: 'Far apart' };
    return chips[value] ?? value;
  }
  if (axis === 'playersBehind') return `${value} behind`;
  if (axis === 'suitedness') return value === 'suited' ? 'Suited' : 'Offsuit';
  return value;
}

export function renderTeachDee(props: TeachDeeProps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'teach-screen';
  root.dataset.testid = 'teach-screen';

  const announcer = document.createElement('div');
  announcer.className = 'visually-hidden';
  announcer.dataset.testid = 'teach-announcer';
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-live', 'polite');

  const lexicon = createLexicon(props.lexicon);
  const sets = [...props.taught];
  const latest = latestSets(sets);
  /**
   * The rule list and the rewrite flags, kept current by this screen: the host mounts it once per visit, so a rewrite
   * made here must show here (and be what is taught next) without a remount.
   */
  let cards: FolioCard[] = [...props.cards];
  const due = new Set(props.rewritesDue);

  let phase: TeachPhase = 'pick';
  let card: FolioCard | null = null;
  /** The sentence being taught: the card's, or a rewrite just accepted. */
  let sentence = '';
  let base: TeachBase | null = null;
  let reading: RuleReading | null = null;
  let seed = 0;
  let spots: readonly TeachSpot[] = [];
  let buildError: string | null = null;
  let at = 0;
  const learner: Record<string, Move> = {};
  let repair: Repair | null = null;
  let diagnosis: Finding | null = null;
  let rewrite: LexiconAttempt | null = null;
  let recorded = false;

  const deeOn = props.dee.character;
  const who = deeOn ? 'Dee' : 'The rule';

  function openRule(c: FolioCard, text = c.text): void {
    card = c;
    sentence = text;
    base = defaultBaseFor(c.conceptId, props.principleOf(c.conceptId));
    reading = base === null ? null : readingFor(base, suggestReading(text));
    buildError = null;
    repair = null;
    diagnosis = null;
    rewrite = null;
    phase = 'read';
    paint('.teach-title');
  }

  function toPick(): void {
    phase = 'pick';
    repair = null;
    paint('.teach-title');
  }

  function deal(): void {
    if (card === null || base === null || reading === null) return;
    seed = teachSeed(card.conceptId, sentence, sets.filter((s) => s.conceptId === card!.conceptId).length);
    const result = buildTeachSet(base.entry.base, reading, seed);
    buildError = result.ok ? null : result.reason;
    if (!result.ok) {
      paint('[data-testid="teach-build-error"]');
      return;
    }
    spots = result.spots;
    at = 0;
    for (const k of Object.keys(learner)) delete learner[k];
    repair = null;
    diagnosis = null;
    rewrite = null;
    recorded = false;
    phase = 'play';
    paint('[data-testid="teach-move"]');
  }

  function finish(): void {
    if (card === null || base === null || reading === null) return;
    repair = detectRepair(spots, reading, learner);
    phase = 'repair';
    if (!recorded) {
      recorded = true;
      const set: TaughtSet = {
        at: props.now(),
        conceptId: card.conceptId,
        text: sentence,
        base: base.entry.conceptId,
        axis: reading.axis,
        value: reading.value,
        action: reading.action,
        otherwise: reading.otherwise,
        finding: repair.finding,
        spots: spots.length,
        misses: repair.misses.length,
      };
      sets.push(set);
      latest.set(set.conceptId, set);
      if (repair.needsRewrite) due.add(set.conceptId);
      else due.delete(set.conceptId);
      props.onFinished(set);
    }
    paint('.teach-title');
  }

  /** Repaint the phase, then put focus where the learner's next step is (a repaint replaces every node). */
  function paint(focus?: string): void {
    root.dataset.phase = phase;
    if (card === null) delete root.dataset.concept;
    else root.dataset.concept = card.conceptId;
    if (repair === null) delete root.dataset.finding;
    else root.dataset.finding = repair.finding;
    const body =
      phase === 'pick' ? renderPick() : phase === 'read' ? renderRead() : phase === 'play' ? renderPlay() : renderRepairPhase();
    root.replaceChildren(announcer, body);
    root.scrollTop = 0;
    if (focus !== undefined) root.querySelector<HTMLElement>(focus)?.focus();
  }

  function head(title: string, back: () => void, backText: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'teach-head';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pill quiet sm teach-back';
    b.dataset.testid = 'teach-back';
    b.textContent = backText;
    b.addEventListener('click', back);
    const h = text('h1', 'teach-title t-t2', title);
    h.tabIndex = -1;
    wrap.append(b, h);
    return wrap;
  }

  function deeSays(event: TeachEvent, facts: TeachFacts, salt: number): HTMLElement | null {
    if (!deeOn) return null;
    const line = teachLine(event, props.dee.tone, facts, seed + salt);
    if (line === null) return null;
    const wrap = document.createElement('div');
    wrap.className = 'teach-dee';
    wrap.dataset.testid = 'teach-dee-line';
    wrap.dataset.lineId = line.lineId;
    wrap.dataset.pose = line.pose;
    wrap.appendChild(renderDee(line.pose, 36));
    wrap.appendChild(text('p', 'teach-dee-say', line.text));
    return wrap;
  }

  function quote(): HTMLElement {
    const q = text('p', 'teach-quote', `“${sentence}”`);
    q.dataset.testid = 'teach-quote';
    return q;
  }

  // ── pick ──
  function renderPick(): HTMLElement {
    const panel = document.createElement('section');
    panel.className = 'teach-panel';
    panel.appendChild(head('Teach Dee', props.onBack, props.backLabel));
    panel.appendChild(
      text(
        'p',
        'g-sub',
        'Pick a rule from your Rulebook. Dee plays a contrast set from it, spots where it applies beside near-misses where it does not, and the engine judges every play.',
      ),
    );
    if (cards.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.dataset.testid = 'teach-empty';
      empty.appendChild(text('div', 'empty-state-title', 'No rules yet'));
      empty.appendChild(text('div', 'empty-state-body', 'Write a rule in your own words at the end of a lesson, then teach it here.'));
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'pill';
      go.dataset.testid = 'teach-write';
      go.textContent = 'Open the lessons';
      go.addEventListener('click', props.onWriteRule);
      empty.appendChild(go);
      panel.appendChild(empty);
      return panel;
    }
    const list = document.createElement('div');
    list.className = 'teach-rules g-group';
    for (const c of cards) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'teach-rule g-row';
      row.dataset.testid = 'teach-rule';
      row.dataset.concept = c.conceptId;
      const body = document.createElement('span');
      body.className = 'repair-row-body';
      body.appendChild(text('span', 'teach-rule-text', `“${c.text}”`));
      const last = latest.get(c.conceptId);
      const finding = last === undefined ? null : findingOf(last.finding);
      const meta = text(
        'span',
        'g-caption',
        `${props.label(c.conceptId)}${finding === null ? ' · not taught yet' : ` · last set: ${FINDING_TITLES[finding].toLowerCase()}`}${due.has(c.conceptId) ? ' · rewrite it' : ''}`,
      );
      meta.dataset.testid = 'teach-rule-meta';
      body.appendChild(meta);
      row.append(body, chevron());
      row.addEventListener('click', () => openRule(c));
      list.appendChild(row);
    }
    panel.appendChild(list);
    return panel;
  }

  // ── read ──
  function renderRead(): HTMLElement {
    const panel = document.createElement('section');
    panel.className = 'teach-panel';
    panel.appendChild(head('Teach Dee', toPick, 'All rules'));
    panel.appendChild(quote());
    if (base === null || reading === null) {
      panel.appendChild(text('p', 'g-sub', 'No spot in this build can be dealt as a contrast set, so there is nothing to play this rule on yet.'));
      return panel;
    }
    const r = reading;
    const b = base;
    const line = deeSays('read', { value: levelLabel(r.axis, r.value), action: MOVE_WORDS[r.action], otherwise: MOVE_WORDS[r.otherwise] }, 0);
    if (line) panel.appendChild(line);
    panel.appendChild(
      text('p', 'g-caption teach-read-hint', `${deeOn ? 'Dee’s first reading of the sentence' : 'A first reading of the sentence'}. Fix anything it got wrong: this is what gets played.`),
    );

    const grid = document.createElement('div');
    grid.className = 'teach-reading';
    grid.dataset.testid = 'teach-reading';
    grid.dataset.axis = r.axis;
    grid.dataset.value = r.value;
    grid.dataset.action = r.action;
    grid.dataset.otherwise = r.otherwise;

    const select = document.createElement('select');
    select.className = 'teach-base';
    select.dataset.testid = 'teach-base';
    select.setAttribute('aria-label', 'Spot to play it on');
    for (const tb of teachableBases()) {
      const o = document.createElement('option');
      o.value = tb.entry.conceptId;
      o.textContent = baseLabel(tb.entry.base);
      o.selected = tb.entry.conceptId === b.entry.conceptId;
      select.appendChild(o);
    }
    select.addEventListener('change', () => {
      const next = teachableBases().find((tb) => tb.entry.conceptId === select.value);
      if (next === undefined) return;
      base = next;
      reading = readingFor(next, r);
      buildError = null;
      paint('[data-testid="teach-base"]');
    });
    grid.appendChild(field('Spot', select));

    const axis = b.axes.find((a) => a.axis === r.axis)!;
    grid.appendChild(
      field(
        'The rule turns on',
        seg('teach-axis', 'The rule turns on', b.axes.map((a) => [a.axis, TEACH_AXIS_LABELS[a.axis] ?? a.axis] as const), r.axis, (v) => {
          reading = readingFor(b, { ...r, axis: v, value: undefined });
          buildError = null;
          paint(`[data-testid="teach-axis"] [data-value="${v}"]`);
        }),
      ),
    );
    grid.appendChild(
      field(
        'It applies at',
        seg('teach-value', 'It applies at', axis.values.map((v) => [v, levelChip(r.axis, v)] as const), r.value, (v) => {
          reading = { ...r, value: v };
          buildError = null;
          paint(`[data-testid="teach-value"] [data-value="${v}"]`);
        }),
      ),
    );
    const moves = MOVES.map((m) => [m, MOVE_LABELS[m]] as const);
    grid.appendChild(
      field(`There, ${deeOn ? 'Dee' : 'the rule'} plays`, seg('teach-action', 'Play where the rule applies', moves, r.action, (v) => {
        reading = { ...r, action: v, otherwise: v === r.otherwise ? oppositeOf(v) : r.otherwise };
        paint(`[data-testid="teach-action"] [data-value="${v}"]`);
      })),
    );
    grid.appendChild(
      // "Everywhere else" is a different play by definition: the same play on both sides is not a contrast.
      field('Everywhere else', seg('teach-otherwise', 'Play everywhere else', moves.filter(([m]) => m !== r.action), r.otherwise, (v) => {
        reading = { ...r, otherwise: v };
        paint(`[data-testid="teach-otherwise"] [data-value="${v}"]`);
      })),
    );
    panel.appendChild(grid);

    if (buildError !== null) {
      const err = text('p', 'teach-error', `This reading cannot be dealt here: ${buildError}. Pick another value or spot.`);
      err.tabIndex = -1;
      err.dataset.testid = 'teach-build-error';
      panel.appendChild(err);
    }
    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'pill primary teach-start';
    start.dataset.testid = 'teach-start';
    start.textContent = 'Deal the contrast set';
    start.addEventListener('click', deal);
    panel.appendChild(start);
    return panel;
  }

  // ── play ──
  function renderPlay(): HTMLElement {
    const r = reading!;
    const spot = spots[at];
    const panel = document.createElement('section');
    panel.className = 'teach-panel teach-play';
    panel.dataset.testid = 'teach-play';
    panel.dataset.spot = spot.id;
    panel.dataset.applies = String(spot.applies);
    panel.dataset.index = String(at);
    panel.dataset.total = String(spots.length);

    const top = head('Teach Dee', () => ((phase = 'read'), paint('.teach-title')), 'Reading');
    const progress = text('span', 'g-label teach-progress', `Spot ${at + 1} of ${spots.length}`);
    progress.dataset.testid = 'teach-progress';
    top.appendChild(progress);
    panel.appendChild(top);
    panel.appendChild(quote());

    const strip = document.createElement('div');
    strip.className = 'teach-strip';
    strip.setAttribute('aria-hidden', 'true');
    for (const [i, s] of spots.entries()) {
      const dot = document.createElement('span');
      dot.className = 'teach-dot';
      dot.dataset.applies = String(s.applies);
      dot.dataset.state = i < at ? 'done' : i === at ? 'now' : 'next';
      strip.appendChild(dot);
    }
    panel.appendChild(strip);

    const level = levelOf(spot.variant.features, r.axis);
    const tag = text(
      'p',
      'teach-tag t-head',
      `${TEACH_AXIS_LABELS[r.axis] ?? r.axis}: ${levelLabel(r.axis, level)} · ${spot.applies ? 'the rule applies here' : 'a near-miss: the rule does not apply'}`,
    );
    tag.dataset.testid = 'teach-tag';
    tag.dataset.applies = String(spot.applies);
    panel.appendChild(tag);

    const deal = document.createElement('div');
    deal.className = 'teach-deal contrast-cards';
    const hole = document.createElement('div');
    hole.className = 'contrast-hole';
    hole.dataset.testid = 'teach-hole';
    for (const c of spot.variant.spot.hole) hole.appendChild(renderCard(c, { small: true }));
    deal.appendChild(group('Your hand', hole));
    const board = document.createElement('div');
    board.className = 'contrast-board';
    if (spot.variant.spot.board.length === 0) board.appendChild(text('span', 'contrast-noboard', 'No board yet'));
    else board.appendChild(renderCardRow([...spot.variant.spot.board], { small: true }));
    deal.appendChild(group('Board', board));
    panel.appendChild(deal);

    const s = spot.variant.spot;
    const facts = text(
      'p',
      'contrast-facts',
      [
        `${s.street[0].toUpperCase()}${s.street.slice(1)}`,
        `${s.position}`,
        `Pot ${inBb(spot.variant.state.pot, s.bb)} bb`,
        `${s.effectiveStackBb} bb deep`,
        `vs ${s.villainPositions.join(', ')}`,
        `you can ${legalActions(spot.variant.state).join(' / ')}`,
      ].join(' · '),
    );
    facts.dataset.testid = 'teach-facts';
    panel.appendChild(facts);

    const mine = learner[spot.id];
    if (mine === undefined) {
      panel.appendChild(text('div', 'g-label', `Your play first, then ${deeOn ? 'Dee’s' : 'the rule’s'}`));
      const row = document.createElement('div');
      row.className = 'teach-moves';
      for (const m of MOVES) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pill teach-move';
        btn.dataset.testid = 'teach-move';
        btn.dataset.move = m;
        btn.textContent = MOVE_LABELS[m];
        btn.addEventListener('click', () => {
          learner[spot.id] = m;
          paint('[data-testid="teach-next"]');
        });
        row.appendChild(btn);
      }
      panel.appendChild(row);
      return panel;
    }

    const dee = deeMove(spot, r);
    const holdsWord = (m: Move): string => (spot.verdict.holds.includes(m) ? 'holds up' : 'does not hold up');
    const reveal = document.createElement('div');
    reveal.className = 'teach-reveal g-flat';
    reveal.dataset.testid = 'teach-reveal';

    const you = text('p', 'teach-reveal-row', `You: ${MOVE_LABELS[mine]} · ${spot.verdict.decisive ? holdsWord(mine) : 'no verdict'}`);
    you.dataset.testid = 'teach-you';
    you.dataset.holds = String(spot.verdict.holds.includes(mine));
    reveal.appendChild(you);

    const deeRow = text('p', 'teach-reveal-row', `${who}: ${MOVE_LABELS[dee]} · ${spot.verdict.decisive ? holdsWord(dee) : 'no verdict'}`);
    deeRow.dataset.testid = 'teach-dee-move';
    deeRow.dataset.move = dee;
    deeRow.dataset.holds = String(spot.verdict.holds.includes(dee));
    reveal.appendChild(deeRow);

    const engine = text(
      'p',
      'teach-reveal-row teach-engine',
      spot.verdict.decisive
        ? `Holds up here: ${spot.verdict.holds.map((m) => MOVE_LABELS[m]).join(', ') || 'no play'}`
        : 'Every play holds up here: the engine has no verdict on this spot',
    );
    engine.dataset.testid = 'teach-engine';
    engine.dataset.holds = spot.verdict.holds.join(',');
    reveal.appendChild(engine);

    // The grader's own sentence on Dee's play, when it has one: every number in it is the engine's.
    const message = spot.verdict.grades[dee]?.message;
    if (spot.verdict.decisive && !spot.verdict.holds.includes(dee) && message) {
      const why = text('p', 'g-caption teach-why', message);
      why.dataset.testid = 'teach-why';
      reveal.appendChild(why);
    }
    panel.appendChild(reveal);

    const enginePlays = spot.verdict.holds.map((m) => MOVE_WORDS[m]).join(' or ');
    const event: TeachEvent = !spot.verdict.decisive ? 'no-verdict' : spot.verdict.holds.includes(dee) ? 'agree' : 'disagree';
    const line = deeSays(event, { dee: MOVE_WORDS[dee], engine: enginePlays || 'something else' }, at + 1);
    if (line) panel.appendChild(line);
    announcer.textContent = `${deeRow.textContent}. ${engine.textContent}.`;

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'pill primary teach-next';
    next.dataset.testid = 'teach-next';
    next.textContent = at + 1 < spots.length ? 'Next spot' : `See what ${deeOn ? 'Dee' : 'the set'} found`;
    next.addEventListener('click', () => {
      if (at + 1 < spots.length) {
        at += 1;
        paint('[data-testid="teach-move"]');
      } else finish();
    });
    panel.appendChild(next);
    return panel;
  }

  // ── repair ──
  function renderRepairPhase(): HTMLElement {
    const r = reading!;
    const rep = repair!;
    const panel = document.createElement('section');
    panel.className = 'teach-panel teach-repair';
    panel.dataset.testid = 'teach-repair';
    panel.appendChild(head('Teach Dee', toPick, 'All rules'));
    panel.appendChild(quote());

    const held = rep.judged - rep.misses.length;
    const summary = text(
      'p',
      'g-sub teach-summary',
      `${deeOn ? 'Dee’s play from the rule' : 'The rule’s play'} held up on ${held} of ${rep.judged} ${rep.judged === 1 ? 'spot' : 'spots'} with a verdict${rep.offRule > 0 ? `. Your own play left the rule on ${rep.offRule} ${rep.offRule === 1 ? 'spot' : 'spots'}` : ''}.`,
    );
    summary.dataset.testid = 'teach-summary';
    summary.dataset.judged = String(rep.judged);
    summary.dataset.misses = String(rep.misses.length);
    summary.dataset.offRule = String(rep.offRule);
    panel.appendChild(summary);

    if (rep.misses.length > 0) panel.appendChild(renderMisses(r, rep));

    const reveal = !rep.needsRewrite || diagnosis !== null;
    if (!reveal) {
      const q = deeSays('diagnose', {}, 50);
      if (q) panel.appendChild(q);
      else panel.appendChild(text('p', 't-head', 'What went wrong with the rule?'));
      const opts = document.createElement('div');
      opts.className = 'teach-diagnose';
      opts.dataset.testid = 'teach-diagnose';
      opts.setAttribute('role', 'group');
      opts.setAttribute('aria-label', 'What went wrong with the rule');
      for (const [f, label] of DIAGNOSIS_OPTIONS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pill teach-diagnose-option';
        b.dataset.testid = 'teach-diagnose-option';
        b.dataset.finding = f;
        b.textContent = label;
        b.addEventListener('click', () => {
          diagnosis = f;
          paint('[data-testid="teach-finding"]');
        });
        opts.appendChild(b);
      }
      panel.appendChild(opts);
      return panel;
    }

    const title = text('h2', 'teach-finding t-t3', FINDING_TITLES[rep.finding]);
    title.tabIndex = -1;
    title.dataset.testid = 'teach-finding';
    title.dataset.finding = rep.finding;
    panel.appendChild(title);
    if (diagnosis !== null) {
      const match = diagnosis === rep.finding;
      const said = DIAGNOSIS_OPTIONS.find(([f]) => f === diagnosis)?.[1] ?? '';
      const d = text('p', 'g-caption teach-diagnosis', match ? `Your diagnosis matches: ${said.toLowerCase()}.` : `Your diagnosis: ${said.toLowerCase()}. The spots say otherwise.`);
      d.dataset.testid = 'teach-diagnosis';
      d.dataset.match = String(match);
      panel.appendChild(d);
    }
    const facts: TeachFacts = {
      action: MOVE_WORDS[r.action],
      otherwise: MOVE_WORDS[r.otherwise],
      engine: rep.enginePlays.map((m) => MOVE_WORDS[m]).join(' or ') || 'something else',
      variable: AXIS_NAMES[rep.variable ?? r.axis],
    };
    const line = deeSays(`finding-${rep.finding}`, facts, 60);
    if (line) panel.appendChild(line);
    if (rep.finding === 'too-broad') {
      const v = text(
        'p',
        'teach-variable',
        rep.variable === null
          ? 'The spots it got wrong and the ones it got right differ in more than one variable here; the rule needs a second condition.'
          : `The spots it got wrong differ from the ones it got right in ${AXIS_NAMES[rep.variable]}. That is the variable the rule leaves out.`,
      );
      v.dataset.testid = 'teach-variable';
      v.dataset.axis = rep.variable ?? '';
      panel.appendChild(v);
    }
    announcer.textContent = FINDING_TITLES[rep.finding];

    if (rep.needsRewrite) {
      panel.appendChild(renderRewrite(r, rep));
      return panel;
    }
    const again = document.createElement('div');
    again.className = 'teach-moves';
    const other = document.createElement('button');
    other.type = 'button';
    other.className = 'pill primary';
    other.dataset.testid = 'teach-again';
    other.textContent = 'Try it on another spot';
    other.addEventListener('click', () => {
      phase = 'read';
      repair = null;
      paint('.teach-title');
    });
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'pill quiet';
    done.dataset.testid = 'teach-done';
    done.textContent = props.backLabel;
    done.addEventListener('click', props.onBack);
    again.append(other, done);
    panel.appendChild(again);
    return panel;
  }

  function renderMisses(r: RuleReading, rep: Repair): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'teach-misses g-flat';
    wrap.dataset.testid = 'teach-misses';
    wrap.appendChild(text('div', 'g-label', `Where ${who === 'Dee' ? 'Dee' : 'the rule'} went wrong`));
    for (const id of rep.misses) {
      const spot = spots.find((s) => s.id === id)!;
      const row = document.createElement('div');
      row.className = 'teach-miss';
      row.dataset.testid = 'teach-miss';
      row.dataset.spot = id;
      row.dataset.applies = String(spot.applies);
      const hole = document.createElement('div');
      hole.className = 'contrast-hole';
      for (const c of spot.variant.spot.hole) hole.appendChild(renderCard(c, { small: true }));
      row.appendChild(hole);
      const level = levelOf(spot.variant.features, r.axis);
      row.appendChild(
        text(
          'span',
          'teach-miss-text',
          `${levelLabel(r.axis, level)}${spot.applies ? '' : ' (near-miss)'} · ${who}: ${MOVE_LABELS[deeMove(spot, r)]} · holds up: ${spot.verdict.holds.map((m) => MOVE_LABELS[m]).join(', ') || 'no play'}`,
        ),
      );
      wrap.appendChild(row);
    }
    return wrap;
  }

  function renderRewrite(r: RuleReading, rep: Repair): HTMLElement {
    const section = document.createElement('section');
    section.className = 'teach-rewrite';
    section.dataset.testid = 'teach-rewrite';
    const ask = deeSays('rewrite', {}, 70);
    if (ask) section.appendChild(ask);
    else section.appendChild(text('p', 't-head', 'Rewrite it so these spots play right, and name the variable that moved the answer.'));
    const box = document.createElement('textarea');
    box.className = 'lexicon-input';
    box.dataset.testid = 'teach-rewrite-input';
    box.rows = 2;
    box.setAttribute('aria-label', 'Rewrite the rule in your own words');
    box.placeholder = 'Say it as a mechanism: domination risk, equity realisation or range asymmetry';
    box.value = rewrite !== null && rewrite.outcome === 'rejected' ? rewrite.sentence : '';
    section.appendChild(box);
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'pill primary';
    submit.dataset.testid = 'teach-rewrite-submit';
    submit.textContent = 'Rewrite the rule';
    submit.addEventListener('click', () => {
      if (card === null || box.value.trim() === '') return;
      const attempt = lexicon.record({ conceptId: card.conceptId, sentence: box.value, at: props.now(), flippingAxis: rep.variable ?? r.axis });
      rewrite = attempt;
      props.onLexiconAttempt(attempt);
      if (attempt.outcome === 'accepted') {
        // The rewrite is now the card's rule, and the rewrite it asked for is written.
        const prior = card;
        card = { ...prior, text: attempt.sentence, earlier: [...prior.earlier, prior.text] };
        const updated = card;
        cards = [updated, ...cards.filter((c) => c.conceptId !== updated.conceptId)];
        due.delete(updated.conceptId);
      }
      paint(attempt.outcome === 'accepted' ? '[data-testid="teach-again"]' : '[data-testid="teach-rewrite-input"]');
    });
    if (rewrite === null || rewrite.outcome === 'rejected') section.appendChild(submit);
    if (rewrite !== null) {
      const fb = document.createElement('div');
      fb.className = 'lexicon-feedback';
      fb.dataset.testid = 'teach-rewrite-feedback';
      fb.dataset.verdict = rewrite.outcome;
      if (rewrite.outcome === 'accepted') {
        fb.appendChild(text('span', 'lexicon-verdict', 'Kept. The new sentence is now the rule on its card; the earlier one stays in its history.'));
        fb.appendChild(text('span', 'lexicon-frame', FRAME_LABELS[rewrite.frame]));
        const accepted = rewrite;
        const again = document.createElement('button');
        again.type = 'button';
        again.className = 'pill';
        again.dataset.testid = 'teach-again';
        again.textContent = `Teach ${deeOn ? 'Dee' : 'it'} the new version`;
        again.addEventListener('click', () => {
          if (card === null) return;
          openRule(card, accepted.sentence);
        });
        section.append(fb, again);
      } else {
        fb.appendChild(text('span', 'lexicon-verdict', rewrite.reasonText));
        if (rewrite.pushback) fb.appendChild(text('span', 'lexicon-pushback', 'Reframe it and try again; the attempt is kept either way.'));
        section.appendChild(fb);
      }
      announcer.textContent = fb.textContent ?? '';
    }
    return section;
  }

  if (props.initialConcept !== null) {
    const c = props.cards.find((x) => x.conceptId === props.initialConcept);
    if (c !== undefined) {
      openRule(c);
      return root;
    }
  }
  paint();
  return root;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'teach-field';
  wrap.appendChild(text('span', 'g-label', label));
  wrap.appendChild(control);
  return wrap;
}

/** A .g-seg radio group with the sliding thumb; each click hands the value up and the screen repaints. */
function seg<T extends string>(testid: string, label: string, items: readonly (readonly [T, string])[], current: T, set: (value: T) => void): HTMLElement {
  const s = document.createElement('div');
  s.className = 'g-seg g-seg-sm';
  s.dataset.testid = testid;
  s.setAttribute('role', 'radiogroup');
  s.setAttribute('aria-label', label);
  for (const [value, name] of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.value = value;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(value === current));
    b.textContent = name;
    b.addEventListener('click', () => set(value));
    s.appendChild(b);
  }
  attachThumb(s);
  return s;
}
