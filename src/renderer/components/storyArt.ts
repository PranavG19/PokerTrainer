import type { ChapterId, Rival } from '../../core/story/cast.js';

/**
 * The Long Orbit's art: each venue drawn in bone line on a dark tile (demo/vision/story.html), and each rival
 * as a glass medallion carrying their keepsake glyph (VISION §2.1). A masked medallion shows the glyph behind
 * frosted glass and a question mark; unmasked, the glyph and the rival's initial. Static strings only: no
 * learner text ever enters the markup. Every piece is decoration (aria-hidden); the words beside it are DOM.
 */

const L = 'fill="none" stroke="#F4F2EC" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"';
const S = 'fill="none" stroke="#D9D4C8" stroke-opacity=".45" stroke-width="1" stroke-linecap="round"';

const VENUE_ART: Readonly<Record<ChapterId, string>> = {
  // A tower and the beam it sends out over the water.
  lighthouse: `<path ${L} d="M24 46l2-26h4l2 26z"/><path ${L} d="M23 20h10M25 16h6v4h-6z"/><path d="M31 18l19-6v12z" fill="#F4F2EC" fill-opacity=".12"/><path ${S} d="M25 32h6M24.5 39h7"/><path ${S} d="M8 48c6-2 12 2 18 0s14 2 22 0"/>`,
  // A diner counter under a neon sign, and the road running off.
  diner: `<rect x="10" y="10" width="36" height="10" rx="3" ${L}/><path ${S} d="M15 15h26"/><path ${L} d="M12 30h32M14 30v12M42 30v12"/><path ${L} d="M22 26c0-2 1.5-3 3.5-3s3.5 1 3.5 3"/><path ${S} d="M20 48l8-6 8 6M28 42v8" stroke-dasharray="2 2"/>`,
  // An arched reading-room window over a shelf of books.
  library: `<path ${L} d="M16 30V18c0-6 5.4-10 12-10s12 4 12 10v12"/><path ${S} d="M28 8v22M16 19h24"/><path ${L} d="M10 36h36"/><path ${L} d="M13 36v10M18 36v10M23 37v9M29 36v10M34 38l3 8M41 36v10"/><path ${S} d="M10 47h36"/>`,
  // A carriage window, the line of lamps going by.
  'night-train': `<rect x="9" y="12" width="38" height="26" rx="6" ${L}/><path ${S} d="M9 25h38"/><g fill="#F4F2EC"><circle cx="17" cy="19" r="1.2" fill-opacity=".8"/><circle cx="26" cy="19" r="1.2" fill-opacity=".5"/><circle cx="35" cy="19" r="1.2" fill-opacity=".3"/></g><path ${S} d="M6 44h10M20 44h22M46 44h4"/><path ${L} d="M14 32h10"/>`,
  // A pier on its posts, one rocket bursting over it.
  pier: `<path ${L} d="M6 36h44M12 36v10M24 36v10M36 36v10M46 36v10"/><path ${S} d="M6 48c6-2 12 2 18 0s14 2 26 0"/><path ${L} d="M30 32l4-14"/><g ${S}><path d="M34 14l0-6M34 14l5-3M34 14l5 3M34 14l-5-3M34 14l-5 3M34 14l0 6"/></g><circle cx="34" cy="14" r="1.6" fill="#F4F2EC"/>`,
  // A dome with its slit open and three stars.
  observatory: `<path ${L} d="M12 40c0-10 7-17 16-17s16 7 16 17z"/><path ${L} d="M10 40h36v6H10z"/><path ${L} d="M26 23.2 28 40M30 23.2 28 40" stroke-opacity=".7"/><path ${S} d="M34 22l8-10"/><g fill="#F4F2EC"><circle cx="44" cy="9" r="1.3"/><circle cx="15" cy="12" r="1"/><circle cx="24" cy="7" r=".8" fill-opacity=".6"/></g>`,
};

const KEEPSAKE: Readonly<Record<Rival['keepsake'], string>> = {
  wick: `<path ${L} d="M20 30c0-5 4-7 4-12 3 3 4 6 4 9a4 4 0 0 1-8 3z"/><path ${S} d="M24 30v6"/>`,
  ticket: `<path ${L} d="M13 18h22v4a2 2 0 0 0 0 4v4H13v-4a2 2 0 0 0 0-4z"/><path ${S} d="M27 18v12" stroke-dasharray="1.5 2"/>`,
  bookmark: `<path ${L} d="M18 12h12v24l-6-5-6 5z"/>`,
  punch: `<rect x="13" y="16" width="22" height="16" rx="2" ${L}/><circle cx="20" cy="24" r="2" ${S}/><circle cx="28" cy="24" r="2" ${S}/>`,
  fuse: `<path ${L} d="M14 34c6 0 6-8 12-8s4-8 8-10"/><circle cx="35" cy="15" r="1.8" fill="#F4F2EC"/>`,
  fork: `<path ${L} d="M20 12v10a4 4 0 0 0 8 0V12M24 26v10"/>`,
};

export function venueArt(id: ChapterId, size: number): SVGSVGElement {
  return svg(`0 0 56 56`, VENUE_ART[id], size);
}

/** A rival's medallion. Masked: the keepsake behind frosted glass and a question mark; unmasked: the initial. */
export function rivalMedallion(rival: Rival, masked: boolean, size: number): SVGSVGElement {
  const initial = rival.short[0];
  // The keepsake sits small under the letter, so the two never overlap.
  const glyph = (opacity: number): string => `<g opacity="${opacity}" transform="translate(16 25) scale(.34)">${KEEPSAKE[rival.keepsake]}</g>`;
  const letter = (ch: string, fill: string, weight: number): string =>
    `<text x="24" y="25" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="14" font-weight="${weight}" fill="${fill}">${ch}</text>`;
  const face = masked ? glyph(0.35) + letter('?', '#C0C6CD', 600) : glyph(0.8) + letter(initial, '#F4F2EC', 700);
  const body =
    `<circle cx="24" cy="24" r="22" fill="#1C2026"/>` +
    `<circle cx="24" cy="24" r="22" fill="none" stroke="#FFFFFF" stroke-opacity="${masked ? 0.18 : 0.34}" stroke-width="1"/>` +
    `<circle cx="24" cy="24" r="18.5" fill="none" stroke="#D9D4C8" stroke-opacity=".35" stroke-width="1.2" stroke-dasharray="1.6 3.2"/>` +
    face;
  return svg('0 0 48 48', body, size);
}

function svg(viewBox: string, inner: string, size: number): SVGSVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  el.innerHTML = inner;
  return el;
}
