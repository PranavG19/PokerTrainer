/* Offsuit · seat layout (mock). table.html?seats=4|6|9 (default 4).
 * Seats are placed by rule, never by hand:
 *   ring  (glass and other ovals): villains sit on the slab's rim ellipse, spread evenly over an arc
 *         that widens with the count; the hero holds the bottom of the rim.
 *   rows  (sports): a scoreboard U. One or two seats per side column, the rest in one top row.
 * Order is clockwise from the hero (the button), so the small blind is always the first seat on the left.
 * Density compacts the seat card as the count grows: full (≤4), mid (≤6), compact (≥7).
 * Mock-only probes: &bets=all puts a bet in front of every villain, &dealer=N moves the button to seat N. */
(() => {
  const q = new URLSearchParams(location.search);
  const felt = document.documentElement.dataset.felt;
  const n = Math.max(2, Math.min(9, Number(q.get('seats')) || 4));
  const LAYOUT = { glass: 'ring', sports: 'rows' }[felt] || (n === 4 ? null : 'ring');
  if (!LAYOUT) return; // every other felt at 4 seats keeps the round-4 hand-placed markup

  // The hand (table.html header): hero on the button, Bo bets 75 on the flop, Ada checked, the rest folded.
  // Quips are the engine's pick, tableTalk.ts IN_HAND_LINES[action][(seat.id + board.length) % 6].
  const LINES = {
    fold: ['I’ll let this one go.', 'Not this time.', 'Too rich for me here.', 'You can have it.', 'I’m out.', 'Nope, done with this one.'],
    check: ['Check.', 'I’ll see a card.', 'Tap tap.', 'Nothing from me.', 'I’ll wait.', 'Over to you.'],
  };
  const CAST = [
    { name: 'Ada', stack: 4950, act: 'check' },
    { name: 'Bo', stack: 4875, act: 'bet', bet: 75, quip: 'Let’s make it interesting.' },
    { name: 'Cy', stack: 5000, act: 'fold' },
    { name: 'Dee', stack: 7320, act: 'fold' },
    { name: 'Gus', stack: 12480, act: 'fold' },
    { name: 'Eli', stack: 0, act: 'out' },
    { name: 'Fay', stack: 3610, act: 'fold' },
    { name: 'Hal', stack: 5000, act: 'fold' },
  ];
  // 9-max seats Eli (busted) between Dee and Fay; smaller tables simply drop the later chairs.
  const order = n === 9 ? ['Ada', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal'] : CAST.slice(0, n - 1).filter((c) => c.act !== 'out').map((c) => c.name);
  const villains = order.slice(0, n - 1).map((name, i) => ({ ...CAST.find((c) => c.name === name), id: i + 1 }));
  const allBets = q.get('bets') === 'all';
  const dealerAt = Number(q.get('dealer')) || 0;

  const stage = document.getElementById('stage');
  const density = n <= 4 ? 'full' : n <= 6 ? 'mid' : 'compact';
  stage.dataset.seats = String(n); stage.dataset.density = density; stage.dataset.layout = LAYOUT;
  stage.querySelectorAll('.seat, .bet').forEach((el) => el.remove());
  const hero = document.getElementById('hero');
  if (dealerAt) hero.querySelector('.dealer').remove();

  const seats = villains.map((v) => {
    const el = document.createElement('div');
    const folded = v.act === 'fold', out = v.act === 'out';
    el.className = 'seat' + (folded ? ' folded' : '') + (out ? ' out' : '') + (v.act === 'bet' ? ' live' : '');
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', `${v.name}${folded ? ', folded' : out ? ', sitting out' : ''}`);
    const quip = v.quip || (LINES[v.act] ? LINES[v.act][(v.id + 3) % 6] : '');
    el.innerHTML = out
      ? `<div class="who"><div class="name">${v.name}</div><div class="status">Sitting out</div></div>`
      : `<div class="cards tight"><div class="card back" style="--i:${v.id}"></div><div class="card back" style="--i:${v.id + n}"></div></div>` +
        `<div class="who"><div class="name">${v.name}<span class="arch">Unknown</span></div><div class="stackval num">${v.stack}</div>` +
        `<div class="quip">${quip}</div></div>`;
    if (dealerAt === v.id) el.insertAdjacentHTML('beforeend', '<span class="dealer" role="img" aria-label="dealer button">D</span>');
    stage.insertBefore(el, hero);
    let bet = null;
    if (v.bet || (allBets && !out)) {
      const amt = v.bet || 50 + v.id * 25;
      bet = document.createElement('div');
      bet.className = 'bet num'; bet.setAttribute('aria-label', `${v.name} bets ${amt}`);
      bet.innerHTML = `<span class="chips" aria-hidden="true"><svg class="c2"><use href="#chip"/></svg><svg class="c1"><use href="#chip"/></svg></span>${amt}`;
      stage.insertBefore(bet, hero);
    }
    return { v, el, bet };
  });

  // Distance from a box's centre to its edge along unit direction (dx, dy).
  const reach = (w, h, dx, dy) => Math.min(Math.abs(dx) > 1e-6 ? w / 2 / Math.abs(dx) : 1e9, Math.abs(dy) > 1e-6 ? h / 2 / Math.abs(dy) : 1e9);
  const put = (el, x, y) => { el.style.left = `${x}px`; el.style.top = `${y}px`; };

  function layout() {
    const S = stage.getBoundingClientRect();
    const W = S.width, H = S.height, k = seats.length;
    const center = stage.querySelector('.center');
    let cx = W / 2, cy;
    const pts = [];
    if (LAYOUT === 'ring') {
      const R = stage.querySelector('.rail').getBoundingClientRect();
      const rx = R.width / 2, ry = R.height / 2; cy = R.top - S.top + ry;
      // Arc half-width (degrees from 12 o'clock) grows with the count so the extra seats wrap down the sides.
      const spread = k <= 3 ? 90 : k <= 5 ? 112 : 124;
      // Equal spacing by arc length, not by angle: a wide ellipse would otherwise bunch seats at the ends.
      const N = 720, arc = [0], rad = (t) => (t * Math.PI) / 180;
      for (let j = 1; j <= N; j++) {
        const a0 = rad(-spread + (2 * spread * (j - 1)) / N), a1 = rad(-spread + (2 * spread * j) / N);
        arc.push(arc[j - 1] + Math.hypot(rx * (Math.sin(a1) - Math.sin(a0)), ry * (Math.cos(a1) - Math.cos(a0))));
      }
      const atLength = (f) => { const L = f * arc[N]; let j = 1; while (j < N && arc[j] < L) j++; return -spread + (2 * spread * j) / N; };
      seats.forEach((s, i) => {
        const t = k === 1 ? 0 : atLength(i / (k - 1));
        const a = rad(t), w = s.el.offsetWidth;
        const x = Math.min(W - w / 2 - 12, Math.max(w / 2 + 12, cx + rx * Math.sin(a)));
        pts.push([x, cy - ry * Math.cos(a), t]);
      });
      center.style.top = `${cy + ry * 0.04}px`;
      // The refined glass slab is sized so the hero sits on its bottom rim; other ovals keep the hero above the dock.
      if (felt === 'glass') { hero.style.top = `${R.bottom - S.top - hero.offsetHeight / 2}px`; hero.style.bottom = 'auto'; }
    } else {
      cy = H * 0.47;
      const side = Math.max(1, Math.round(k / 4)), top = k - 2 * side;
      const h0 = Math.max(...seats.map((s) => s.el.offsetHeight));
      const rowY = 52 + h0 / 2;
      const heroTop = hero.getBoundingClientRect().top - S.top;
      const band = [rowY + h0 / 2 + 20, heroTop - 12];
      const colY = (j) => (side === 1 ? H * 0.42 : band[0] + ((j + 0.5) * (band[1] - band[0])) / side);
      const inset = W * (k > 5 ? 0.05 : 0.08);
      seats.forEach((s, i) => {
        const w = s.el.offsetWidth;
        if (i < side) pts.push([inset + w / 2, colY(side - 1 - i), -90]);                                    // left column, bottom → top
        else if (i < side + top) { const j = i - side; pts.push([top === 1 ? W / 2 : W * (0.27 + (0.46 * j) / (top - 1)), rowY, 0]); }
        else pts.push([W - inset - w / 2, colY(i - side - top), 90]);                                     // right column, top → bottom
      });
    }
    seats.forEach((s, i) => {
      const [x, y, t] = pts[i];
      s.el.classList.toggle('r', t > 20);                 // right half: cards on the outer edge
      s.el.style.transform = 'translate(-50%, -50%)';
      put(s.el, x, y);
      s.el.querySelectorAll('.card').forEach((c) => { c.style.setProperty('--fx', `${cx - x}px`); c.style.setProperty('--fy', `${cy - y}px`); });
    });
    // Bets: just inside the seat, on the line from the seat to the pot. If that spot hits the board, a seat or
    // another bet, try straight across toward the middle, then straight up or down, stepping outward.
    const rel = (el) => { const r = el.getBoundingClientRect(); return { l: r.left - S.left, t: r.top - S.top, r: r.right - S.left, b: r.bottom - S.top }; };
    const blocks = [...stage.querySelectorAll('.seat, .hero-plate, .pot, .board, .price')].map(rel);
    const hit = (a) => blocks.some((o) => a.l < o.r + 4 && o.l < a.r + 4 && a.t < o.b + 4 && o.t < a.b + 4);
    seats.forEach((s, i) => {
      if (!s.bet) return;
      const [x, y] = pts[i], bw = s.bet.offsetWidth, bh = s.bet.offsetHeight, sw = s.el.offsetWidth, sh = s.el.offsetHeight;
      const L = Math.hypot(cx - x, cy - y) || 1;
      const ray = [(cx - x) / L, (cy - y) / L], across = [Math.sign(cx - x) || 1, 0], down = [0, Math.sign(cy - y) || 1];
      // Rows: a top-row seat bets straight down and a column seat straight across, so ownership reads by alignment.
      const dirs = LAYOUT === 'rows' ? (Math.abs(pts[i][2]) < 20 ? [down, ray, across] : [across, ray, down]) : [ray, across, down];
      let spot = null;
      for (const [dx, dy] of dirs) {
        for (let extra = 0; extra <= 48 && !spot; extra += 4) {
          const d = reach(sw, sh, dx, dy) + reach(bw, bh, dx, dy) + 8 + extra;
          const bx = x + dx * d, by = y + dy * d, a = { l: bx - bw / 2, t: by - bh / 2, r: bx + bw / 2, b: by + bh / 2 };
          if (!hit(a) && a.l > 0 && a.r < W) spot = [bx, by, a];
        }
        if (spot) break;
      }
      if (!spot) { const d = reach(sw, sh, dirs[0][0], dirs[0][1]) + reach(bw, bh, dirs[0][0], dirs[0][1]) + 8; spot = [x + dirs[0][0] * d, y + dirs[0][1] * d]; s.bet.dataset.unplaced = ''; }
      s.bet.style.transform = 'translate(-50%, -50%)';
      put(s.bet, spot[0], spot[1]);
      if (spot[2]) blocks.push(spot[2]);
    });
  }
  layout();
  addEventListener('resize', layout);
  document.fonts.ready.then(layout);   // the condensed figures change seat widths once SF loads
})();
