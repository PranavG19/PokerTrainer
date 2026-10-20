import type { Leaf, SubNavItem } from '../nav.js';
import { attachThumb } from './thumb.js';

/**
 * A section's sub-nav (Study, You): a title on the left and the kit's segmented control on the right, as the
 * mock draws You (demo/vision/profile.html). Each button carries the testid the destination had as a tab, so a
 * spec reaches it with one extra click on the section. The screen below gets the height that is left: the host
 * lowers `--screen-h` by the bar, so a screen that sizes itself to the window still fits with no page scroll.
 */
export function renderSubNav(opts: {
  readonly title: string;
  readonly note?: string;
  readonly items: readonly SubNavItem[];
  readonly lit: Leaf;
  readonly onPick: (leaf: Leaf) => void;
  readonly body: HTMLElement;
  readonly testid: string;
}): HTMLElement {
  const host = document.createElement('div');
  host.className = 'subnav-host';
  host.dataset.testid = opts.testid;

  const bar = document.createElement('div');
  bar.className = 'subnav-bar';
  const head = document.createElement('div');
  head.className = 'subnav-head';
  const h = document.createElement('h1');
  h.className = 't-t2 habit-flush';
  h.textContent = opts.title;
  head.appendChild(h);
  if (opts.note) {
    const n = document.createElement('span');
    n.className = 'g-caption';
    n.textContent = opts.note;
    head.appendChild(n);
  }
  // Plain buttons with aria-current, like the section bar: each opens a destination, not a tab panel.
  const seg = document.createElement('div');
  seg.className = 'g-seg subnav-seg';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', `${opts.title} sections`);
  for (const item of opts.items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'subnav-item';
    b.dataset.testid = item.testid;
    b.textContent = item.label;
    const on = item.leaf === opts.lit;
    b.dataset.active = String(on);
    if (on) b.setAttribute('aria-current', 'page');
    b.addEventListener('click', () => opts.onPick(item.leaf));
    seg.appendChild(b);
  }
  attachThumb(seg, 'button.subnav-item');
  bar.append(head, seg);

  const body = document.createElement('div');
  body.className = 'subnav-body';
  body.appendChild(opts.body);
  host.append(bar, body);
  return host;
}
