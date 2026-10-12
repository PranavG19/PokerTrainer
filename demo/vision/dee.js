// Mock-only: Dee, round 2. One rig, five mark directions (demo/vision/dee-marks.html compares them).
//   face     — recommended: a bone-ceramic dealer button with two engraved lights. Expression lives in the two lights
//              (shape, height, gap) and the posture (tilt, lift, lying flat). No mouth, no beak, no brow, no limbs.
//   button   — the object alone: the same ceramic button with a smoked-glass jewel; expression is posture + glint.
//   orbit    — an abstract glyph: the button's path round the table, a ring with one bead.
//   pebble   — a soft character: a domed smoked-glass pebble with one bone visor of light.
//   monogram — a product mark: a lowercase d whose bowl is the button, on a glass tile.
// Rim colour follows the role map: hairline at rest, amber = the gate / notable, coral = serious. Never mint.
// Usage: <span class="dee" data-mark="face" data-pose="rest" data-size="64"></span> (hydrated on load), or Dee.svg(mark, pose, size).
(() => {
  let uid = 0;
  const RIM = { amber: '#E6B866', coral: '#F08A7A' };
  const INK = '#1C1F24', BONE = '#F4F2EC';

  function defs(id) {
    return `<defs>
      <radialGradient id="${id}-c" cx="38%" cy="30%" r="78%"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".38" stop-color="#F3F0E8"/><stop offset=".82" stop-color="#DAD5C9"/><stop offset="1" stop-color="#BEB8AB"/></radialGradient>
      <radialGradient id="${id}-cs" cx="38%" cy="30%" r="78%"><stop offset="0" stop-color="#F1EEE7"/><stop offset=".6" stop-color="#D9D4C8"/><stop offset="1" stop-color="#B5AFA2"/></radialGradient>
      <linearGradient id="${id}-bev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".95"/><stop offset=".5" stop-color="#E4E0D6" stop-opacity=".15"/><stop offset="1" stop-color="#8E897E" stop-opacity=".9"/></linearGradient>
      <radialGradient id="${id}-dish" cx="62%" cy="68%" r="72%"><stop offset=".72" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="1" stop-color="#9C978B" stop-opacity=".38"/></radialGradient>
      <linearGradient id="${id}-side" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C9C3B6"/><stop offset="1" stop-color="#8F897D"/></linearGradient>
      <radialGradient id="${id}-jewel" cx="40%" cy="32%" r="70%"><stop offset="0" stop-color="#5B626C"/><stop offset=".55" stop-color="#252A31"/><stop offset="1" stop-color="#0E1013"/></radialGradient>
      <radialGradient id="${id}-glass" cx="36%" cy="24%" r="85%"><stop offset="0" stop-color="#6C7480"/><stop offset=".5" stop-color="#2A3038"/><stop offset="1" stop-color="#101318"/></radialGradient>
      <filter id="${id}-sh" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="2.6"/></filter>
    </defs>`;
  }

  // The two engraved lights: [cx, cy, w, h] per eye, or 'arc' (the eyes smile; there is still no mouth).
  const EYES = {
    rest:      [[39, 47, 7, 13], [61, 47, 7, 13]],
    attentive: [[39, 45, 7.6, 15.5], [61, 45, 7.6, 15.5]],
    blink:     [[39, 50, 8, 2.6], [61, 50, 8, 2.6]],
    glance:    [[55, 48, 6.6, 12], [75, 48, 6.6, 12]],
    thinking:  [[41, 39, 6.6, 11], [63, 40.5, 9, 3.6]],
    curious:   [[39, 47, 6.4, 12.5], [61, 48.5, 6.4, 8]],
    pleased:   'arc',
    serious:   'brow',
    notable:   [[42, 42, 6.6, 11], [64, 42, 6.6, 11]],
    asleep:    [[39, 54, 8, 2.2], [61, 54, 8, 2.2]],
    proud:     'arc',
  };
  // Posture: rotation (deg), lift (in 100-space), lying flat (3/4 view), rim role, a light sweep across the bevel.
  const POSTURE = {
    rest: {}, attentive: { rot: -10, lift: -3 }, blink: {}, glance: { rot: 6 }, thinking: { rot: -4, lift: -2 }, curious: { rot: 9 },
    pleased: { rot: -4, lift: -5 }, serious: { rim: 'coral' }, notable: { rot: 3, rim: 'amber' }, asleep: { flat: true }, proud: { rot: -6, lift: -7, sweep: true },
  };

  function eyes(pose, small, tiny) {
    const e = EYES[pose] || EYES.rest;
    if (e === 'brow') {   // serious: the tops of both lights cut flat and slanting inward, a frown made only of the lights
      const s = small ? 1.5 : 1;
      return [[39, 1], [61, -1]].map(([x, dir]) => { const w = 7.6 * s / 2, top = 45, low = 47.5, bot = 54.5 + (small ? 1 : 0);
        const tl = dir > 0 ? top : low, tr = dir > 0 ? low : top;
        const d = `M${x - w} ${tl} L${x + w} ${tr} L${x + w} ${bot - w} Q${x + w} ${bot} ${x} ${bot} Q${x - w} ${bot} ${x - w} ${bot - w} Z`;
        return (small ? '' : `<path d="${d}" fill="#FFFFFF" fill-opacity=".7" transform="translate(0 .8)"/>`) + `<path d="${d}" fill="${INK}"/>`; }).join('');
    }
    if (e === 'arc') {
      const w = small ? 5.2 : 3.6;
      return [39, 61].map((x) => `<path d="M${x - 6.5} 51.5 Q${x} ${small ? 40 : 42} ${x + 6.5} 51.5" fill="none" stroke="#FFFFFF" stroke-opacity=".7" stroke-width="${w}" stroke-linecap="round" transform="translate(0 .8)"/><path d="M${x - 6.5} 51.5 Q${x} ${small ? 40 : 42} ${x + 6.5} 51.5" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round"/>`).join('');
    }
    return e.map(([cx, cy, w, h]) => {
      const k = tiny ? 1.9 : 1.55, W = small ? w * k : w, H = small ? Math.max(h * (tiny ? 1.35 : 1.25), 4.5) : h, r = Math.min(W, H) / 2;
      const glint = !small && H > 6 ? `<circle cx="${(cx - W * 0.14).toFixed(2)}" cy="${(cy - H * 0.27).toFixed(2)}" r="${Math.min(1.25, W * 0.18).toFixed(2)}" fill="#FFFFFF" fill-opacity=".6"/>` : '';
      // engraved: a light lip below the cut, then the ink fill
      return (small ? '' : `<rect x="${cx - W / 2}" y="${cy - H / 2 + 0.8}" width="${W}" height="${H}" rx="${r}" fill="#FFFFFF" fill-opacity=".75"/>`) +
        `<rect x="${cx - W / 2}" y="${cy - H / 2}" width="${W}" height="${H}" rx="${r}" fill="${INK}"/>` + glint;
    }).join('');
  }

  function ceramic(id, size, p, inner) {
    const small = size < 30, tiny = size < 20;
    const rim = p.rim ? `<circle cx="50" cy="50" r="48.4" fill="none" stroke="${RIM[p.rim]}" stroke-width="${tiny ? 6 : small ? 4.5 : 2.6}" ${p.rim === 'amber' && !small ? 'stroke-dasharray="160 400" stroke-dashoffset="-30" stroke-linecap="round"' : ''}/>` : '';
    const micro = size >= 80 ? `<path id="${id}-tp" d="M50 50 m-42.6 0 a42.6 42.6 0 1 1 85.2 0 a42.6 42.6 0 1 1 -85.2 0" fill="none"/>
      <text font-family="-apple-system, 'SF Pro Text', sans-serif" font-size="4.1" font-weight="600" letter-spacing="2.4" fill="#8D877B" fill-opacity=".8"><textPath href="#${id}-tp" textLength="262" lengthAdjust="spacing">DEALER · DEALER · DEALER · DEALER · DEALER · DEALER ·</textPath></text>` : '';
    const sweep = p.sweep && !small ? `<path d="M19 30 A35 35 0 0 1 58 13" fill="none" stroke="#FFFFFF" stroke-width="3.2" stroke-linecap="round"/>` : '';
    return `
      ${small || p.flat ? '' : `<ellipse cx="50" cy="${97 - (p.lift || 0)}" rx="34" ry="3.6" fill="#000" fill-opacity=".6" filter="url(#${id}-sh)"/>`}
      <g transform="translate(0 ${p.lift || 0}) rotate(${p.rot || 0} 50 50)">
      <circle cx="50" cy="50" r="49" fill="url(#${id}-c${small ? 's' : ''})"/>
      ${tiny ? '' : `<circle cx="50" cy="50" r="48" fill="none" stroke="url(#${id}-bev)" stroke-width="2.2"/>`}
      ${tiny ? '' : small ? `<circle cx="50" cy="50" r="36" fill="none" stroke="#8D877B" stroke-opacity=".75" stroke-width="3.4"/>` : `<circle cx="50" cy="50" r="37.5" fill="url(#${id}-dish)"/><circle cx="50" cy="50" r="37.5" fill="none" stroke="#9A9488" stroke-opacity=".5" stroke-width=".8"/><circle cx="50" cy="50.9" r="37.5" fill="none" stroke="#FFFFFF" stroke-opacity=".75" stroke-width=".6"/>`}
      ${micro}${inner}${sweep}
      <circle cx="50" cy="50" r="${tiny ? 47 : 49}" fill="none" stroke="${tiny ? '#7A7468' : '#000'}" stroke-opacity="${tiny ? 1 : 0.4}" stroke-width="${tiny ? 6 : 0.9}"/>
      ${rim}</g>`;
  }

  function frame(size, id, body, flat) {
    // Lying flat: the disc squashes into a 3/4 view and shows its edge (the side band).
    const g = flat ? `<ellipse cx="50" cy="83" rx="50" ry="10" fill="#000" fill-opacity=".55" filter="url(#${id}-sh)"/><g transform="translate(0 44) scale(1 .44)"><path d="M1 50 v20 a49 49 0 0 0 98 0 v-20" fill="url(#${id}-side)"/>${body}</g>` : body;
    return `<svg width="${size}" height="${size}" viewBox="-3 -6 106 110" aria-hidden="true" style="overflow:visible;display:block">${defs(id)}${g}</svg>`;
  }

  const MARKS = {
    face(pose, size) {
      const id = `d${++uid}`, p = POSTURE[pose] || {};
      return frame(size, id, ceramic(id, size, p, eyes(pose, size < 30, size < 20)), p.flat);
    },
    button(pose, size) {
      const id = `d${++uid}`, p = POSTURE[pose] || {};
      const gl = { attentive: [46, 44], thinking: [55, 43], glance: [56, 47], curious: [44, 51], pleased: [45, 42], proud: [45, 42], serious: [50, 50], notable: [53, 46], asleep: [50, 54] }[pose] || [46, 45];
      const r = size < 30 ? 15 : 11, lit = pose === 'asleep' ? 0.2 : pose === 'serious' ? 0.3 : 0.92;
      const inner = (size < 30 ? '' : `<circle cx="50" cy="50.8" r="${r + 1.2}" fill="#FFFFFF" fill-opacity=".8"/>`) + `<circle cx="50" cy="50" r="${r}" fill="url(#${id}-jewel)"/>` +
        (size >= 30 ? `<ellipse cx="${gl[0]}" cy="${gl[1]}" rx="3.8" ry="2.4" fill="#FFFFFF" fill-opacity="${lit}" transform="rotate(-24 ${gl[0]} ${gl[1]})"/>` : '');
      return frame(size, id, ceramic(id, size, p, inner), p.flat);
    },
    orbit(pose, size) {
      // the bead's angle on the ring (deg, 0 = 3 o'clock), how much ring is drawn, a lift, a rim role, dimmed
      const S = { attentive: [-90, 300], thinking: [-20, 250], glance: [-10, 300], curious: [-135, 300], pleased: [-90, 320, 1], proud: [-90, 330, 1], notable: [-45, 300, 0, 'amber'], asleep: [90, 300, 0, 0, 1], blink: [-45, 300] }[pose] || [-45, 300];
      const [deg, sweep, lift, role, dim] = S, small = size < 30;
      const sw = small ? 14 : 9, R = 36, a = deg * Math.PI / 180, bx = 50 + R * Math.cos(a), by = 50 + R * Math.sin(a) - (lift ? 10 : 0);
      const gap = 360 - sweep, a0 = (deg + gap / 2) * Math.PI / 180, a1 = (deg + gap / 2 + sweep) * Math.PI / 180;
      const P = (t) => `${(50 + R * Math.cos(t)).toFixed(2)} ${(50 + R * Math.sin(t)).toFixed(2)}`;
      const stroke = role ? RIM[role] : BONE, op = dim ? 0.4 : 1;
      if (pose === 'serious') return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true" style="display:block"><circle cx="50" cy="50" r="${R}" fill="none" stroke="${RIM.coral}" stroke-width="${sw}"/><circle cx="50" cy="50" r="${small ? 12 : 9}" fill="${BONE}"/></svg>`;
      return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true" style="display:block">
        <path d="M${P(a0)} A${R} ${R} 0 ${sweep > 180 ? 1 : 0} 1 ${P(a1)}" fill="none" stroke="${stroke}" stroke-opacity="${op}" stroke-width="${sw}" stroke-linecap="round"/>
        <circle cx="${bx.toFixed(2)}" cy="${by.toFixed(2)}" r="${small ? 12 : 9}" fill="${BONE}" fill-opacity="${op}"/>
        ${small ? '' : `<circle cx="${(bx - 2.6).toFixed(2)}" cy="${(by - 2.8).toFixed(2)}" r="2.6" fill="#FFFFFF" fill-opacity="${op}"/>`}</svg>`;
    },
    pebble(pose, size) {
      const id = `d${++uid}`, p = POSTURE[pose] || {}, small = size < 30;
      const V = { attentive: [50, 44, 36, 11], thinking: [55, 41, 28, 8], glance: [57, 47, 30, 9], curious: [50, 46, 34, 9, 8], pleased: 'arc', proud: 'arc', serious: [50, 50, 34, 4], notable: [50, 46, 34, 7], asleep: [50, 58, 30, 2.6], blink: [50, 48, 34, 3] }[pose] || [50, 46, 34, 9];
      const path = 'M50 6C80 6 95 20 95 53S79 95 50 95 5 85 5 53 20 6 50 6Z';
      let light;
      if (V === 'arc') light = `<path d="M31 52 Q50 35 69 52" fill="none" stroke="${BONE}" stroke-width="${small ? 12 : 8}" stroke-linecap="round"/>`;
      else {
        const h = small ? Math.max(V[3], 9) : V[3], t = V[4] ? ` transform="rotate(${V[4]} 50 46)"` : '';
        light = `<rect x="${V[0] - V[2] / 2}" y="${V[1] - h / 2}" width="${V[2]}" height="${h}" rx="${h / 2}" fill="${BONE}"${t}/>` +
          (small ? '' : `<rect x="${V[0] - V[2] / 2 + 3}" y="${V[1] - h / 2 + 0.8}" width="${(V[2] * 0.42).toFixed(1)}" height="${Math.max(1, h * 0.28).toFixed(1)}" rx=".8" fill="#FFFFFF" fill-opacity=".9"${t}/>`);
      }
      const rim = p.rim ? `<path d="${path}" fill="none" stroke="${RIM[p.rim]}" stroke-width="${small ? 6 : 2.6}"/>` : '';
      const body = `${small ? '' : `<ellipse cx="50" cy="${97 - (p.lift || 0)}" rx="32" ry="3.6" fill="#000" fill-opacity=".6" filter="url(#${id}-sh)"/>`}
        <g transform="translate(0 ${p.lift || 0}) rotate(${p.rot || 0} 50 50)">
        <path d="${path}" fill="url(#${id}-glass)"/>
        <path d="${path}" fill="none" stroke="#FFFFFF" stroke-opacity="${small ? 0.4 : 0.24}" stroke-width="${small ? 3 : 1}"/>
        ${small ? '' : '<path d="M21 28C29 14 43 11 57 12" fill="none" stroke="#FFFFFF" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/>'}
        ${light}${rim}</g>`;
      return frame(size, id, body, false);
    },
    monogram(pose, size) {
      const id = `d${++uid}`, small = size < 30;
      const role = pose === 'serious' ? RIM.coral : pose === 'notable' ? RIM.amber : null;
      const tile = small ? '' : `<rect x="2" y="2" width="96" height="96" rx="23" fill="url(#${id}-glass)"/><rect x="2.5" y="2.5" width="95" height="95" rx="22.5" fill="none" stroke="#FFFFFF" stroke-opacity=".22"/>
        <path d="M13 24C17 13 27 8 39 8" fill="none" stroke="#FFFFFF" stroke-opacity=".38" stroke-width="1.6" stroke-linecap="round"/>`;
      const s = small ? 1.1 : 0.74, o = small ? -5 : 13;
      const counter = pose === 'pleased' || pose === 'proud' ? 11 : pose === 'asleep' ? 3.5 : 8;
      const mark = `<g transform="translate(${o} ${o}) scale(${s})"><circle cx="42" cy="58" r="26" fill="${BONE}"/><rect x="58" y="12" width="10" height="72" rx="5" fill="${BONE}"/>
        <circle cx="42" cy="58" r="${counter}" fill="${small ? '#16181B' : '#272C34'}"/>${role ? `<circle cx="42" cy="58" r="31" fill="none" stroke="${role}" stroke-width="2.6"/>` : ''}</g>`;
      return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true" style="display:block">${defs(id)}${tile}${mark}</svg>`;
    },
  };

  const svg = (mark, pose = 'rest', size = 64) => (MARKS[mark] || MARKS.face)(pose, size);
  function hydrate(root = document) {
    for (const el of root.querySelectorAll('.dee[data-pose]:not([data-done])')) {
      el.innerHTML = svg(el.dataset.mark || 'face', el.dataset.pose, Number(el.dataset.size || 64));
      el.dataset.done = '1';
    }
  }
  window.Dee = { svg, hydrate, MARKS: Object.keys(MARKS), POSES: Object.keys(POSTURE) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => hydrate()); else hydrate();
})();
