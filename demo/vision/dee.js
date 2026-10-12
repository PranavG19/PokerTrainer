// Mock-only: Dee, the dealer button (panel/character-designer.md §1, §7), as one SVG rig.
// A smoked-graphite glass disc with an engraved bone "D". Its only feature is the D's counter (the hole in the
// letter): every expression is a new counter shape, a transform and a rim colour. No eyes, no beak, no limbs.
// Rim colours follow the role map: neutral at rest, amber = notable / the gate, coral = serious,
// one mint shimmer only for a mastery inlay (a real positive delta). Never mint as decoration.
// Usage: <span class="dee" data-pose="seated" data-size="120"></span>, hydrated on load; or Dee.svg(pose, size).
(() => {
  // Counter shapes, in the 100×100 face space. The D's outer edge is fixed; only this changes.
  const COUNTER = {
    neutral: '<path d="M45 37h6c8.4 0 14 5.6 14 13s-5.6 13-14 13h-6z"/>',
    tall: '<ellipse cx="53" cy="50" rx="6.4" ry="13.5"/>',
    brow: '<path d="M44 51c3-9 18-11 22-1-6-3-15-3-22 1z"/>',
    bar: '<rect x="44" y="47" width="22" height="6" rx="3"/>',
    hook: '<path d="M47 43c0-5 4-8 8-8s8 3 8 7.5c0 4-3 5.6-5.4 7-1.6 1-2.1 2-2.1 3.6v1.6" fill="none" stroke-width="5" stroke-linecap="round"/><circle cx="55.6" cy="62.6" r="2.9"/>',
    quote: '<path d="M46 44a4 4 0 1 1 3.6 5.8c-.4 3-1.8 5-4.2 6.2 1-2 1.3-3.6 1.2-5.4A4 4 0 0 1 46 44zM57 44a4 4 0 1 1 3.6 5.8c-.4 3-1.8 5-4.2 6.2 1-2 1.3-3.6 1.2-5.4A4 4 0 0 1 57 44z"/>',
    lids: '<path d="M44 52c6 5 16 5 22 0-2 7-7 10-11 10s-9-3-11-10z"/>',
    smile: '<path d="M44 47c4 12 18 12 22 0-6 5-16 5-22 0z"/>',
    wide: '<path d="M45 35h6.5c9 0 15.5 6.4 15.5 15s-6.5 15-15.5 15H45z"/>',
  };
  // pose → transform of the disc, squash (3/4 view), side-band offset, counter, rim, extras.
  const POSES = {
    seated:   { rot: 0,   sx: 1,    sy: 0.46, band: [0, 9],  counter: 'neutral', rim: 'rest' },
    hello:    { rot: -14, sx: 0.97, sy: 0.97, band: [5, 3],  counter: 'smile',   rim: 'rest', lift: true },
    listening:{ rot: -20, sx: 0.93, sy: 0.93, band: [6, 3],  counter: 'tall',    rim: 'amber-arc', lift: true },
    wobble:   { rot: 12,  sx: 0.96, sy: 0.9,  band: [-4, 5], counter: 'brow',    rim: 'amber', lift: true },
    serious:  { rot: 0,   sx: 1,    sy: 1,    band: [6, 0],  counter: 'bar',     rim: 'coral', edge: true },
    thinking: { rot: -28, sx: 0.95, sy: 0.95, band: [6, 2],  counter: 'hook',    rim: 'rest', roll: true, lift: true },
    quoting:  { rot: 6,   sx: 0.97, sy: 0.97, band: [5, 2],  counter: 'quote',   rim: 'rest', folio: true, lift: true },
    resting:  { rot: 0,   sx: 1,    sy: 0.42, band: [0, 8],  counter: 'lids',    rim: 'rest', dim: true, lamp: true },
    glint:    { rot: -6,  sx: 0.98, sy: 0.98, band: [5, 2],  counter: 'smile',   rim: 'bright', sparkle: true, lift: true },
    engraving:{ rot: -10, sx: 0.98, sy: 0.98, band: [6, 3],  counter: 'wide',    rim: 'rest', inlay: true, lift: true },
  };
  const RIM = { rest: 'oklch(1 0 0 / .26)', bright: 'oklch(1 0 0 / .62)', amber: '#E6B866', 'amber-arc': '#E6B866', coral: '#F08A7A' };
  let uid = 0;

  function face(id, p) {
    const rim = RIM[p.rim];
    const coloured = p.rim === 'amber' || p.rim === 'coral' || p.rim === 'amber-arc';
    const arc = p.rim === 'amber-arc' ? ' stroke-dasharray="190 400" stroke-dashoffset="-40"' : '';
    // the rim inlays: twelve engraved ticks; one lit mint on mastery
    const ticks = Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2, x1 = 50 + Math.cos(a) * 44.5, y1 = 50 + Math.sin(a) * 44.5, x2 = 50 + Math.cos(a) * 47.5, y2 = 50 + Math.sin(a) * 47.5;
      const lit = p.inlay && i < 7;
      const now = p.inlay && i === 6;
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${now ? '#3DDC97' : lit ? '#F4F2EC' : 'oklch(1 0 0 / .14)'}" stroke-width="${now ? 3.4 : 1.8}" stroke-linecap="round"${now ? ` filter="url(#${id}-glow)"` : ''}/>`;
    }).join('');
    return `
      <circle cx="50" cy="50" r="49" fill="url(#${id}-body)"/>
      <circle cx="50" cy="50" r="49" fill="url(#${id}-depth)"/>
      <ellipse cx="38" cy="28" rx="30" ry="17" fill="url(#${id}-spec)" transform="rotate(-24 38 28)"/>
      <circle cx="50" cy="50" r="41.5" fill="none" stroke="oklch(1 0 0 / .07)" stroke-width="1"/>
      ${ticks}
      <g opacity="${p.dim ? 0.55 : 1}">
        <path d="M33.5 25.5h18.5c15 0 26 10.6 26 24.5s-11 24.5-26 24.5H33.5z" fill="oklch(0 0 0 / .55)" transform="translate(0 1.2)"/>
        <path d="M33.5 25.5h18.5c15 0 26 10.6 26 24.5s-11 24.5-26 24.5H33.5z" fill="url(#${id}-bone)"/>
        <g fill="url(#${id}-body)" stroke="url(#${id}-body)">${COUNTER[p.counter]}</g>
        <g fill="none" stroke="oklch(0 0 0 / .35)" stroke-width="1" transform="translate(0 -.6)" opacity=".7">${COUNTER[p.counter].replace(/fill="none" /, '')}</g>
      </g>
      <circle cx="50" cy="50" r="49" fill="none" stroke="${rim}" stroke-width="${coloured ? 2.2 : 1.1}"${arc}${coloured ? ` filter="url(#${id}-glow)"` : ''}/>
      <path d="M14 34a40 40 0 0 1 30-26" fill="none" stroke="oklch(1 0 0 / .45)" stroke-width="1.2" stroke-linecap="round"/>`;
  }

  function svg(pose = 'seated', size = 120, label) {
    const p = POSES[pose] || POSES.seated;
    const id = `dee${++uid}`;
    const cx = 80, cy = p.lift ? 72 : 80;
    const [bx, by] = p.band;
    const R = 50;
    const extras = [];
    // contact shadow: soft for floating poses, sharp for standing on edge
    const shadow = p.edge
      ? `<ellipse cx="${cx + 3}" cy="${cy + R + 3}" rx="38" ry="4.5" fill="oklch(0 0 0 / .55)" filter="url(#${id}-soft)"/>`
      : `<ellipse cx="${cx}" cy="${p.sy < 0.6 ? cy + 32 : 146}" rx="${p.sy < 0.6 ? 54 : 34}" ry="${p.sy < 0.6 ? 10 : 6}" fill="oklch(0 0 0 / ${p.sy < 0.6 ? 0.45 : 0.28})" filter="url(#${id}-blur)"/>`;
    if (p.roll) extras.push(`<g stroke="oklch(1 0 0 / .16)" stroke-width="2" stroke-linecap="round"><path d="M10 66h16M4 80h20M12 94h14"/></g>`);
    if (p.sparkle) extras.push(`<path d="M128 26l2.2 6.3 6.3 2.2-6.3 2.2-2.2 6.3-2.2-6.3-6.3-2.2 6.3-2.2z" fill="#FFFFFF" opacity=".9"/><path d="M140 52l1.2 3.4 3.4 1.2-3.4 1.2-1.2 3.4-1.2-3.4-3.4-1.2 3.4-1.2z" fill="#FFFFFF" opacity=".6"/>`);
    if (p.folio) extras.push(`<g transform="translate(118 64) rotate(10)"><rect width="30" height="40" rx="3" fill="#2A2F37" stroke="oklch(1 0 0 / .18)"/><rect x="3" y="3" width="24" height="34" rx="2" fill="#F4F2EC"/><path d="M7 11h16M7 16h14M7 21h16M7 26h10" stroke="#9AA0A8" stroke-width="1.4" stroke-linecap="round"/></g>`);
    if (p.lamp) extras.push(`<g transform="translate(140 96)"><circle r="11" fill="oklch(0.96 0.03 85 / .16)" filter="url(#${id}-blur)"/><circle r="3.4" fill="#F4F2EC"/><path d="M-4 9h8" stroke="oklch(1 0 0 / .3)" stroke-width="2" stroke-linecap="round"/></g>`);
    const sxR = R * p.sx, syR = R * p.sy;
    // the side band: the disc's thickness, a darker copy of the outline offset behind the face
    const band = `<ellipse cx="${bx}" cy="${by}" rx="${sxR}" ry="${syR}" fill="#0E1013"/>
      <ellipse cx="${bx}" cy="${by}" rx="${sxR}" ry="${syR}" fill="none" stroke="oklch(1 0 0 / .10)" stroke-width="1"/>
      ${p.sy < 0.6 ? `<rect x="${-sxR}" y="0" width="${sxR * 2}" height="${by}" fill="#0E1013"/>` : ''}`;
    return `<svg viewBox="0 0 160 160" width="${size}" height="${size}" role="img" aria-label="${label || `Dee, ${pose}`}" class="dee-svg dee-${pose}">
      <defs>
        <radialGradient id="${id}-body" cx="36%" cy="28%" r="80%" gradientUnits="objectBoundingBox"><stop offset="0" stop-color="#4C535C"/><stop offset=".55" stop-color="#262A30"/><stop offset="1" stop-color="#15171B"/></radialGradient>
        <radialGradient id="${id}-depth" cx="50%" cy="50%" r="50%"><stop offset=".78" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient>
        <radialGradient id="${id}-spec"><stop offset="0" stop-color="#FFF" stop-opacity=".22"/><stop offset="1" stop-color="#FFF" stop-opacity="0"/></radialGradient>
        <linearGradient id="${id}-bone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".5" stop-color="#F4F2EC"/><stop offset="1" stop-color="#DCD8CE"/></linearGradient>
        <filter id="${id}-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <filter id="${id}-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>
        <filter id="${id}-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.4"/></filter>
      </defs>
      ${shadow}
      ${extras.join('')}
      <g transform="translate(${cx} ${cy}) rotate(${p.rot})">
        ${band}
        <g transform="scale(${p.sx} ${p.sy}) translate(-50 -50)">${face(id, p)}</g>
      </g>
    </svg>`;
  }

  // Rival medallions (panel/character-designer.md §3): glass tokens with a keepsake glyph, masked until beaten.
  const KEEPSAKE = {
    wick: '<path d="M0-9c3 4 4 6 4 8.5a4 4 0 0 1-8 0C-4-3-3-5 0-9z" fill="currentColor"/><path d="M0 4v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    ticket: '<path d="M-9-6h18v3.5a2.5 2.5 0 0 0 0 5V6H-9V2.5a2.5 2.5 0 0 0 0-5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M-2-6v12" stroke="currentColor" stroke-width="1.2" stroke-dasharray="1.6 1.6"/>',
    bookmark: '<path d="M-5-9h10v18l-5-4-5 4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    punch: '<rect x="-9" y="-6" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="-3" cy="0" r="1.6" fill="currentColor"/><circle cx="3" cy="0" r="1.6" fill="currentColor"/>',
    fuse: '<path d="M-8 6c4-1 6-4 6-8s3-6 6-6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M6-10l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" fill="currentColor"/>',
    fork: '<path d="M-4-9v8a4 4 0 0 0 8 0v-8M0 3v7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  };
  function rival(glyph, size = 44, masked = false, label = '') {
    const id = `rv${++uid}`;
    return `<svg viewBox="-24 -24 48 48" width="${size}" height="${size}" role="img" aria-label="${label}" class="rival-svg">
      <defs><radialGradient id="${id}" cx="35%" cy="25%" r="85%"><stop offset="0" stop-color="${masked ? '#3A3F47' : '#565D67'}"/><stop offset="1" stop-color="#16181C"/></radialGradient></defs>
      <circle r="22" fill="url(#${id})"/><circle r="22" fill="none" stroke="oklch(1 0 0 / .22)"/><circle r="17.5" fill="none" stroke="oklch(1 0 0 / .08)"/>
      <path d="M-15-9a18 18 0 0 1 14-10" fill="none" stroke="oklch(1 0 0 / .4)" stroke-linecap="round"/>
      <g color="${masked ? 'oklch(1 0 0 / .38)' : '#F4F2EC'}">${masked ? '<path d="M-10-2c3-3 7-3 10 0 3-3 7-3 10 0-1 4-4 6-6 6-2 0-3-1.6-4-3-1 1.4-2 3-4 3-2 0-5-2-6-6z" fill="currentColor"/>' : KEEPSAKE[glyph]}</g>
    </svg>`;
  }

  function hydrate(root = document) {
    for (const el of root.querySelectorAll('.dee[data-pose]')) el.innerHTML = svg(el.dataset.pose, Number(el.dataset.size || 120), el.dataset.label);
    for (const el of root.querySelectorAll('.rival[data-glyph]')) el.innerHTML = rival(el.dataset.glyph, Number(el.dataset.size || 44), el.hasAttribute('data-masked'), el.dataset.label || '');
  }
  window.Dee = { svg, rival, hydrate, POSES: Object.keys(POSES) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => hydrate()); else hydrate();
})();
