import type { DeePose } from '../../core/dee/types.js';

/**
 * Dee's mark: Two lights (owner D8), ported from the vision rig (demo/vision/dee.js, `face`). A bone-ceramic
 * dealer button with two engraved ink lights; the lights carry every expression (shape, height, gap) and the
 * posture adds tilt, lift and lying flat. No mouth, no limbs. The rim tints only for serious (coral) and the
 * gate / a notable verdict (amber); never mint.
 *
 * Sizes: at 24px and under (the perch, the nav) the mark is drawn in device pixels (pixelSvg) so the lights stay
 * two crisp dots; from 25 to 29px the button darkens, keeps an inset rim ring and scales the lights ×1.55. At 80px
 * and up the rim is micro-engraved DEALER.
 *
 * The art is decoration: every mark is aria-hidden, and Dee's words are real DOM text beside it. Character off
 * (`html[data-character='off']`) hides every mark through one CSS rule (styles-dee.css).
 *
 * Motion (styles-dee.css): a pose change morphs in 220ms, the Price held hop is 320ms, a blink is 120ms; nothing
 * runs longer than 480ms and prefers-reduced-motion swaps poses instantly. Only transform and opacity animate.
 */

/** A pose plus the rig-only blink. */
export type RigPose = DeePose | 'blink';

const INK = '#1C1F24';
const RIM = { amber: '#E6B866', coral: '#F08A7A' } as const;

type Eye = [cx: number, cy: number, w: number, h: number];
const EYES: Record<RigPose, Eye[] | 'arc' | 'brow'> = {
  rest: [[39, 47, 7, 13], [61, 47, 7, 13]],
  listening: [[39, 45, 7.6, 15.5], [61, 45, 7.6, 15.5]],
  blink: [[39, 50, 8, 2.6], [61, 50, 8, 2.6]],
  glance: [[55, 48, 6.6, 12], [75, 48, 6.6, 12]],
  thinking: [[41, 39, 6.6, 11], [63, 40.5, 9, 3.6]],
  'price-held': 'arc',
  serious: 'brow',
  gate: [[42, 42, 6.6, 11], [64, 42, 6.6, 11]],
  asleep: [[39, 54, 8, 2.2], [61, 54, 8, 2.2]],
};

interface Posture {
  rot?: number;
  lift?: number;
  flat?: boolean;
  rim?: keyof typeof RIM;
}
const POSTURE: Record<RigPose, Posture> = {
  rest: {},
  listening: { rot: -10, lift: -3 },
  blink: {},
  glance: { rot: 6 },
  thinking: { rot: -4, lift: -2 },
  'price-held': { rot: -4, lift: -5 },
  serious: { rim: 'coral' },
  gate: { rot: 3, rim: 'amber' },
  asleep: { flat: true },
};

let uid = 0;

function defs(id: string): string {
  return `<defs>
    <radialGradient id="${id}-c" cx="38%" cy="30%" r="78%"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".38" stop-color="#F3F0E8"/><stop offset=".82" stop-color="#DAD5C9"/><stop offset="1" stop-color="#BEB8AB"/></radialGradient>
    <radialGradient id="${id}-cs" cx="38%" cy="30%" r="78%"><stop offset="0" stop-color="#F1EEE7"/><stop offset=".6" stop-color="#D9D4C8"/><stop offset="1" stop-color="#B5AFA2"/></radialGradient>
    <linearGradient id="${id}-bev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".95"/><stop offset=".5" stop-color="#E4E0D6" stop-opacity=".15"/><stop offset="1" stop-color="#8E897E" stop-opacity=".9"/></linearGradient>
    <radialGradient id="${id}-dish" cx="62%" cy="68%" r="72%"><stop offset=".72" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="1" stop-color="#9C978B" stop-opacity=".38"/></radialGradient>
    <linearGradient id="${id}-side" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C9C3B6"/><stop offset="1" stop-color="#8F897D"/></linearGradient>
    <filter id="${id}-sh" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="2.6"/></filter>
  </defs>`;
}

function eyes(pose: RigPose, small: boolean, tiny: boolean): string {
  const e = EYES[pose];
  if (e === 'brow') {
    // Serious: the tops of both lights cut flat and slanting inward, a frown made only of the lights.
    const s = small ? 1.5 : 1;
    return ([[39, 1], [61, -1]] as const)
      .map(([x, dir]) => {
        const w = (7.6 * s) / 2;
        const top = 45;
        const low = 47.5;
        const bot = 54.5 + (small ? 1 : 0);
        const tl = dir > 0 ? top : low;
        const tr = dir > 0 ? low : top;
        const d = `M${x - w} ${tl} L${x + w} ${tr} L${x + w} ${bot - w} Q${x + w} ${bot} ${x} ${bot} Q${x - w} ${bot} ${x - w} ${bot - w} Z`;
        return (small ? '' : `<path d="${d}" fill="#FFFFFF" fill-opacity=".7" transform="translate(0 .8)"/>`) + `<path d="${d}" fill="${INK}"/>`;
      })
      .join('');
  }
  if (e === 'arc') {
    // Price held: the lights smile. There is still no mouth.
    const w = small ? 5.2 : 3.6;
    const peak = small ? 40 : 42;
    return [39, 61]
      .map((x) => {
        const d = `M${x - 6.5} 51.5 Q${x} ${peak} ${x + 6.5} 51.5`;
        return `<path d="${d}" fill="none" stroke="#FFFFFF" stroke-opacity=".7" stroke-width="${w}" stroke-linecap="round" transform="translate(0 .8)"/><path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round"/>`;
      })
      .join('');
  }
  return e
    .map(([cx, cy, w, h]) => {
      const k = tiny ? 1.9 : 1.55;
      const W = small ? w * k : w;
      const H = small ? Math.max(h * (tiny ? 1.35 : 1.25), 4.5) : h;
      const r = Math.min(W, H) / 2;
      const glint =
        !small && H > 6
          ? `<circle cx="${(cx - W * 0.14).toFixed(2)}" cy="${(cy - H * 0.27).toFixed(2)}" r="${Math.min(1.25, W * 0.18).toFixed(2)}" fill="#FFFFFF" fill-opacity=".6"/>`
          : '';
      return (
        (small ? '' : `<rect x="${cx - W / 2}" y="${cy - H / 2 + 0.8}" width="${W}" height="${H}" rx="${r}" fill="#FFFFFF" fill-opacity=".75"/>`) +
        `<rect x="${cx - W / 2}" y="${cy - H / 2}" width="${W}" height="${H}" rx="${r}" fill="${INK}"/>` +
        glint
      );
    })
    .join('');
}

function ceramic(id: string, size: number, p: Posture, inner: string): string {
  const small = size < 30;
  const tiny = size < 20;
  const rim = p.rim
    ? `<circle cx="50" cy="50" r="48.4" fill="none" stroke="${RIM[p.rim]}" stroke-width="${tiny ? 6 : small ? 4.5 : 2.6}" ${p.rim === 'amber' && !small ? 'stroke-dasharray="160 400" stroke-dashoffset="-30" stroke-linecap="round"' : ''}/>`
    : '';
  const micro =
    size >= 80
      ? `<path id="${id}-tp" d="M50 50 m-42.6 0 a42.6 42.6 0 1 1 85.2 0 a42.6 42.6 0 1 1 -85.2 0" fill="none"/><text font-family="-apple-system, 'SF Pro Text', sans-serif" font-size="4.1" font-weight="600" letter-spacing="2.4" fill="#8D877B" fill-opacity=".8"><textPath href="#${id}-tp" textLength="262" lengthAdjust="spacing">DEALER · DEALER · DEALER · DEALER · DEALER · DEALER ·</textPath></text>`
      : '';
  const face = tiny
    ? ''
    : small
      ? `<circle cx="50" cy="50" r="36" fill="none" stroke="#8D877B" stroke-opacity=".75" stroke-width="3.4"/>`
      : `<circle cx="50" cy="50" r="37.5" fill="url(#${id}-dish)"/><circle cx="50" cy="50" r="37.5" fill="none" stroke="#9A9488" stroke-opacity=".5" stroke-width=".8"/><circle cx="50" cy="50.9" r="37.5" fill="none" stroke="#FFFFFF" stroke-opacity=".75" stroke-width=".6"/>`;
  const shadow = small || p.flat ? '' : `<ellipse cx="50" cy="${97 - (p.lift ?? 0)}" rx="34" ry="3.6" fill="#000" fill-opacity=".6" filter="url(#${id}-sh)"/>`;
  return `${shadow}<g class="dee-body" transform="translate(0 ${p.lift ?? 0}) rotate(${p.rot ?? 0} 50 50)">
    <circle cx="50" cy="50" r="49" fill="url(#${id}-c${small ? 's' : ''})"/>
    ${tiny ? '' : `<circle cx="50" cy="50" r="48" fill="none" stroke="url(#${id}-bev)" stroke-width="2.2"/>`}
    ${face}${micro}${inner}
    <circle cx="50" cy="50" r="${tiny ? 47 : 49}" fill="none" stroke="${tiny ? '#7A7468' : '#000'}" stroke-opacity="${tiny ? 1 : 0.4}" stroke-width="${tiny ? 6 : 0.9}"/>
    ${rim}</g>`;
}

/**
 * The 16 and 20px mark (the perch, the nav): drawn in device pixels, not scaled down from the 100-unit art, so
 * the two lights land on whole pixels and stay two crisp dots (dee-marks.html: "at 16px it is still a button
 * with two dots"). A flat bone disc with a 1px darker edge, no gradient, bevel or engraved ring (each blurred to
 * grey at this size), no tilt or lift (a tilt resamples the lights). The rim role colour is a 1.5px ring.
 */
function pixelSvg(pose: RigPose, size: number): string {
  const c = size / 2;
  const w = 2;
  const h = size >= 20 ? 5 : 4;
  const gap = size >= 20 ? 4 : 2;
  const lx = c - gap / 2 - w;
  const rx = c + gap / 2;
  const top = Math.round(c - h / 2 - 0.5);
  const rect = (x: number, y: number, ww: number, hh: number): string =>
    `<rect x="${x}" y="${y}" width="${ww}" height="${hh}" rx="${Math.min(ww, hh) / 2}" fill="${INK}"/>`;
  let lights: string;
  switch (pose) {
    case 'listening':
      lights = rect(lx, top - 1, w, h + 1) + rect(rx, top - 1, w, h + 1);
      break;
    case 'blink':
      lights = rect(lx - 0.5, top + h - 2, w + 1, 1.2) + rect(rx - 0.5, top + h - 2, w + 1, 1.2);
      break;
    case 'glance':
      lights = rect(lx + 2, top, w, h - 1) + rect(rx + 2, top, w, h - 1);
      break;
    case 'thinking':
      lights = rect(lx, top - 1, w, h - 1) + rect(rx - 0.5, top + 1, w + 1, 1.6);
      break;
    case 'gate':
      lights = rect(lx + 1, top - 1, w, h - 1) + rect(rx + 1, top - 1, w, h - 1);
      break;
    case 'asleep':
      lights = rect(lx - 0.5, top + h - 1, w + 1, 1.2) + rect(rx - 0.5, top + h - 1, w + 1, 1.2);
      break;
    case 'price-held': {
      // The lights smile: two arcs, still no mouth.
      const arc = (x: number): string =>
        `<path d="M${x - 0.6} ${top + h - 1} Q${x + w / 2} ${top - 0.6} ${x + w + 0.6} ${top + h - 1}" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>`;
      lights = arc(lx - 0.5) + arc(rx + 0.5);
      break;
    }
    case 'serious': {
      // A frown made only of the lights: each top cut flat, slanting in toward the centre.
      const cut = (x: number, inward: 1 | -1): string => {
        const hi = top;
        const lo = top + 1.5;
        const [tl, tr] = inward > 0 ? [hi, lo] : [lo, hi];
        return `<path d="M${x} ${tl} L${x + w} ${tr} L${x + w} ${top + h} L${x} ${top + h} Z" fill="${INK}"/>`;
      };
      lights = cut(lx, 1) + cut(rx, -1);
      break;
    }
    default:
      lights = rect(lx, top, w, h) + rect(rx, top, w, h);
  }
  const role = POSTURE[pose].rim;
  const rim = role ? `<circle cx="${c}" cy="${c}" r="${c - 0.75}" fill="none" stroke="${RIM[role]}" stroke-width="1.5"/>` : '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true" focusable="false" shape-rendering="geometricPrecision">
    <circle cx="${c}" cy="${c}" r="${c - 0.5}" fill="#EEEAE1"/>
    <circle cx="${c}" cy="${c}" r="${c - 0.5}" fill="none" stroke="#5F5A50" stroke-width="1"/>
    ${rim}${lights}</svg>`;
}

/** The SVG markup for one pose at one pixel size. Static strings only: no learner text ever enters it. */
export function deeSvg(pose: RigPose, size: number): string {
  if (size <= 24) return pixelSvg(pose, size);
  const id = `dee${++uid}`;
  const p = POSTURE[pose];
  const body = ceramic(id, size, p, eyes(pose, size < 30, size < 20));
  // Lying flat (asleep): the disc squashes into a 3/4 view and shows its edge.
  const g = p.flat
    ? `<ellipse cx="50" cy="83" rx="50" ry="10" fill="#000" fill-opacity=".55" filter="url(#${id}-sh)"/><g transform="translate(0 44) scale(1 .44)"><path d="M1 50 v20 a49 49 0 0 0 98 0 v-20" fill="url(#${id}-side)"/>${body}</g>`
    : body;
  return `<svg width="${size}" height="${size}" viewBox="-3 -6 106 110" aria-hidden="true" focusable="false">${defs(id)}${g}</svg>`;
}

/** A Dee mark element. `data-pose` and `data-size` are the test and CSS contract. */
export function renderDee(pose: DeePose, size: number): HTMLElement {
  const el = document.createElement('span');
  el.className = 'dee';
  el.dataset.testid = 'dee-mark';
  el.setAttribute('aria-hidden', 'true');
  el.dataset.size = String(size);
  el.style.setProperty('--dee-size', `${size}px`);
  paint(el, pose);
  return el;
}

function paint(el: HTMLElement, pose: RigPose): void {
  el.dataset.pose = pose;
  el.innerHTML = deeSvg(pose, Number(el.dataset.size ?? 20));
}

/** Change pose. The fresh paint carries the morph animation (none under reduced motion). */
export function setDeePose(el: HTMLElement, pose: DeePose): void {
  if (el.dataset.pose === pose) return;
  paint(el, pose);
  el.classList.remove('dee-morph');
  void el.offsetWidth;
  el.classList.add('dee-morph');
}

/** A blink: lights to lines for 120ms, then back. Never while the hero is to act (the perch decides). */
export function blinkDee(el: HTMLElement): void {
  const pose = el.dataset.pose as DeePose | undefined;
  if (pose === undefined || pose === 'asleep' || pose === 'price-held' || pose === 'serious') return;
  el.innerHTML = deeSvg('blink', Number(el.dataset.size ?? 20));
  window.setTimeout(() => {
    if (el.dataset.pose === pose) el.innerHTML = deeSvg(pose, Number(el.dataset.size ?? 20));
  }, 120);
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
