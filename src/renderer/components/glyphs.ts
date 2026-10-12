/**
 * The small shared glyphs of the glass kit (styles-glass.css, "Shared primitives"): the row chevron,
 * the icon-tile icons, the severity mark and the trailing keycap. SVG built with createElementNS so no
 * markup string ever reaches innerHTML.
 */
const NS = 'http://www.w3.org/2000/svg';

type Shape = { d: string; fill?: boolean; width?: number } | { circle: [number, number, number]; fill?: boolean };

function svg(viewBox: string, className: string, shapes: readonly Shape[]): SVGSVGElement {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('class', className);
  for (const shape of shapes) {
    const node =
      'd' in shape ? document.createElementNS(NS, 'path') : document.createElementNS(NS, 'circle');
    if ('d' in shape) node.setAttribute('d', shape.d);
    else {
      node.setAttribute('cx', String(shape.circle[0]));
      node.setAttribute('cy', String(shape.circle[1]));
      node.setAttribute('r', String(shape.circle[2]));
    }
    if (shape.fill) node.setAttribute('fill', 'currentColor');
    else {
      node.setAttribute('fill', 'none');
      node.setAttribute('stroke', 'currentColor');
      node.setAttribute('stroke-width', String(('width' in shape && shape.width) || 1.5));
      node.setAttribute('stroke-linecap', 'round');
      node.setAttribute('stroke-linejoin', 'round');
    }
    el.appendChild(node);
  }
  return el;
}

export const SPADE_PATH =
  'M7 .8C5.4 3 1.6 5.2 1.6 8.1c0 1.6 1.2 2.7 2.6 2.7.9 0 1.6-.4 2.1-1-.2 1.3-.7 2.3-1.6 3.4h4.6c-.9-1.1-1.4-2.1-1.6-3.4.5.6 1.2 1 2.1 1 1.4 0 2.6-1.1 2.6-2.7C12.4 5.2 8.6 3 7 .8Z';

export function chevron(): SVGSVGElement {
  return svg('0 0 7 12', 'g-chev', [{ d: 'M1 1l5 5-5 5' }]);
}

export function spadeIcon(className = ''): SVGSVGElement {
  return svg('0 0 14 14', className, [{ d: SPADE_PATH, fill: true }]);
}

export function peopleIcon(): SVGSVGElement {
  return svg('0 0 16 14', '', [
    { circle: [5.5, 4, 2.4], width: 1.4 },
    { circle: [11.5, 4.6, 2], width: 1.4 },
    { d: 'M1.2 12.5c.4-2.4 2.2-3.8 4.3-3.8s3.9 1.4 4.3 3.8M10.4 8.8c2 .1 3.6 1.4 4 3.7', width: 1.4 },
  ]);
}

/** The 13px warning mark beside a severity word, so severity is never colour alone. */
export function warningIcon(): SVGSVGElement {
  return svg('0 0 13 13', 'g-warn', [
    { d: 'M6.5 1.2 12.2 11.3H.8Z', width: 1.3 },
    { d: 'M6.5 5v3', width: 1.3 },
    { circle: [6.5, 9.6, 0.75], fill: true },
  ]);
}

/** An icon tile: the 28px rounded square that leads a launcher row. */
export function iconTile(icon: SVGSVGElement): HTMLElement {
  const tile = document.createElement('span');
  tile.className = 'g-icon';
  tile.appendChild(icon);
  return tile;
}

/**
 * A trailing keycap. aria-hidden: the shortcut is announced through the control's own aria-keyshortcuts
 * (or title), so a screen reader does not read "Fold F".
 */
export function keycap(key: string): HTMLElement {
  const cap = document.createElement('kbd');
  cap.className = 'g-kbd';
  cap.setAttribute('aria-hidden', 'true');
  cap.textContent = key;
  return cap;
}
