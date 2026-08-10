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
import { renderCard, renderCardRow } from '../components/card.js';

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

interface ContrastScreenOpts {
  /** The persisted hand log. T2 grades in it are what fire a repair (G1's T2 row). */
  readonly hands: readonly HandRecord[];
}

export function renderContrastScreen(opts: ContrastScreenOpts): HTMLElement {
  const queue = remediationQueue(opts.hands);

  const root = document.createElement('div');
  root.className = 'repair-screen';
  root.dataset.testid = 'repair-screen';
  root.dataset.queueLength = String(queue.length);

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

  const selectConcept = (index: number): void => {
    selected = index;
    axis = null;
    view = 'concept';
    paint();
    root.scrollTop = 0;
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
    if (queue.length === 0) {
      root.dataset.kind = 'empty';
      delete root.dataset.conceptId;
      delete root.dataset.axis;
      root.replaceChildren(
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
      root.replaceChildren(heading(), renderQueue());
      return;
    }

    const item = queue[selected];
    const remediation = remediate(item.entry, SEED);
    const showing = axisToShow(remediation);

    root.dataset.conceptId = item.entry.conceptId;
    root.dataset.kind = remediation.kind;
    if (showing === null) delete root.dataset.axis;
    else root.dataset.axis = showing;

    root.replaceChildren(renderConcept(item, remediation, showing));
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
    header.appendChild(text('div', 'repair-title', 'Repair'));
    header.appendChild(
      text(
        'div',
        'repair-hint',
        'A leak worth 0.5 to 2 bb is corrected at the end of a block, not mid-hand: it fires a set of near-identical positions where exactly one variable moves, and it comes back on a spacing schedule.',
      ),
    );
    return header;
  }

  function renderQueue(): HTMLElement {
    const list = document.createElement('div');
    list.className = 'repair-queue';
    list.dataset.testid = 'repair-queue';

    for (const [index, item] of queue.entries()) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'list-row repair-row';
      row.dataset.testid = 'repair-row';
      row.dataset.conceptId = item.entry.conceptId;
      row.dataset.fired = String(item.firedBy !== null);
      row.dataset.selected = String(index === selected);
      row.addEventListener('click', () => selectConcept(index));

      row.appendChild(text('span', 'repair-row-title', item.entry.title));
      row.appendChild(text('span', 'repair-row-family', item.entry.nodeFamily));

      const trigger = text(
        'span',
        'repair-row-trigger',
        item.firedBy === null
          ? `Not fired yet · repairs ${item.entry.repairs}`
          : `${item.firedBy.costBb.toFixed(1)} bb across ${item.firedBy.count} ${item.firedBy.count === 1 ? 'decision' : 'decisions'} · ${item.entry.repairs}`,
      );
      trigger.dataset.testid = 'repair-trigger';
      row.appendChild(trigger);
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
    back.className = 'pill repair-back';
    back.dataset.testid = 'repair-back';
    back.textContent = 'All repairs';
    back.addEventListener('click', showQueue);
    panel.appendChild(back);

    const title = text('h1', 'repair-concept-title', item.entry.title);
    title.dataset.testid = 'repair-concept-title';
    panel.appendChild(title);
    panel.appendChild(
      text('div', 'stat-label', `${item.entry.nodeFamily} · repairs ${item.entry.repairs}`),
    );

    const queued = text(
      'p',
      'repair-queued',
      `This repair returns on day ${remediation.repairDays.join(', day ')} after the miss.`,
    );
    queued.dataset.testid = 'repair-days';
    queued.dataset.days = remediation.repairDays.join(',');
    panel.appendChild(queued);

    panel.appendChild(renderAxisOffers(remediation, showing));

    if (showing === null) {
      panel.appendChild(renderFallback(remediation));
      return panel;
    }
    const offer = remediation.offers.find((o) => o.axis === showing);
    if (offer?.set != null) panel.appendChild(renderSet(offer));
    return panel;
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
      cell.className = available ? 'pill axis-offer' : 'axis-offer axis-offer-absent';
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
      'contrast-claim',
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
      'stat-label',
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
      text('div', 'stat-label', 'No one-variable neighbour exists here, so this is the worked example'),
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

function inBb(chips: number, bb: number): string {
  const value = chips / bb;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function group(label: string, cards: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'contrast-group';
  wrap.appendChild(cards);
  wrap.appendChild(text('div', 'stat-label', label));
  return wrap;
}

function text(tag: string, className: string, content: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = content;
  return el;
}

function emptyState(title: string, body: string): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.dataset.testid = 'repair-empty';
  empty.appendChild(text('div', 'empty-state-title', title));
  empty.appendChild(text('div', 'empty-state-body', body));
  return empty;
}
