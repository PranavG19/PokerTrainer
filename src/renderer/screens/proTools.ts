import '../styles-pro-tools.css';

/**
 * THE PRO TAB: two tools behind the one gate (pro.ts proGate), switched by a segmented control.
 *   Hands  hand-history import and the leak finder   (feature 'leak-finder')
 *   ICM    ICM, bubble factor and push-fold          (feature 'icm-tools')
 * Without Pro each view is the honest locked card that opens the upgrade sheet; the work itself is
 * refused in main whatever this file draws (gated() in main.ts).
 */

import type { Feature } from '../../core/entitlements/features.js';
import type { Position } from '../../core/preflop.js';
import { attachThumb } from '../components/thumb.js';
import { proGate, type ProClient } from '../pro.js';
import { renderProHands, type HandsBridge } from './proHands.js';
import { renderProIcm, type IcmBridge } from './proIcm.js';

export type ProView = 'hands' | 'icm';

export interface ProToolsProps {
  readonly pro: ProClient;
  readonly bridge: HandsBridge & IcmBridge;
  readonly openSheet: (feature: Feature) => void;
  readonly onPractise: (position: Position) => void;
}

let view: ProView = 'hands';

export function renderProTools(props: ProToolsProps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'pro-tools-screen';
  root.dataset.testid = 'pro-tools-screen';

  const seg = document.createElement('div');
  seg.className = 'g-seg pro-switch';
  seg.setAttribute('role', 'tablist');
  seg.setAttribute('aria-label', 'Pro tools');
  const body = document.createElement('div');
  body.className = 'pro-body';

  const show = (): void => {
    root.dataset.view = view;
    for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.view === view));
    for (const b of seg.querySelectorAll('button')) b.dataset.active = String(b.dataset.view === view);
    body.replaceChildren(
      view === 'hands'
        ? proGate(props.pro, 'leak-finder', () => renderProHands({ bridge: props.bridge, onPractise: props.onPractise }), props.openSheet)
        : proGate(props.pro, 'icm-tools', () => renderProIcm({ bridge: props.bridge }), props.openSheet),
    );
  };
  for (const [id, label] of [['hands', 'Hands and leaks'], ['icm', 'ICM and push-fold']] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.view = id;
    b.dataset.testid = `pro-view-${id}`;
    b.setAttribute('role', 'tab');
    b.textContent = label;
    b.addEventListener('click', () => {
      view = id;
      show();
    });
    seg.appendChild(b);
  }
  root.append(seg, body);
  show();
  attachThumb(seg);
  return root;
}
