/**
 * A QR code as one inline SVG path, drawn from core/qr.ts's modules. Nothing is fetched and no image is
 * built: the dark modules are unit squares in a viewBox with the standard 4-module quiet zone, so the code
 * scales crisply to any size the sheet gives it (`shape-rendering: crispEdges`).
 *
 * Bone ground, dark ink: the QR reads as a printed object (the colour role map's bone), and dark-on-light
 * is the polarity every phone reader expects.
 */

import { encodeQr, type Ecl } from '../../core/qr.js';

const SVG = 'http://www.w3.org/2000/svg';
const QUIET = 4;

export function renderQrCode(text: string, opts: { label: string; ecl?: Ecl; testid?: string }): SVGSVGElement {
  const qr = encodeQr(text, { ecl: opts.ecl ?? 'M' });
  const side = qr.size + QUIET * 2;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${side} ${side}`);
  svg.setAttribute('class', 'qr-code');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', opts.label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.dataset.testid = opts.testid ?? 'qr-code';
  svg.dataset.version = String(qr.version);
  svg.dataset.size = String(qr.size);
  svg.dataset.text = text;

  const ground = document.createElementNS(SVG, 'rect');
  ground.setAttribute('width', String(side));
  ground.setAttribute('height', String(side));
  ground.setAttribute('class', 'qr-ground');
  svg.appendChild(ground);

  let d = '';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) if (qr.modules[y][x]) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
  }
  const ink = document.createElementNS(SVG, 'path');
  ink.setAttribute('d', d);
  ink.setAttribute('class', 'qr-ink');
  svg.appendChild(ink);
  return svg;
}
