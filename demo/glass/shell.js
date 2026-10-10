// Mock-only shell: the window chrome (traffic lights, wordmark, the real 11 tabs from src/renderer/main.ts TABS),
// the simulated desktop behind the coat, the grain layer, segmented/switch behaviour and the slider fill.
// No app logic. ?still=1 freezes the gate drain for captures.
(() => {
  const params = new URLSearchParams(location.search);
  if (params.get('still') === '1') document.documentElement.classList.add('still');

  // The real 11 tabs, grouped into play / study / you so the strip has a hierarchy without hiding anything.
  const GROUPS = [['Play', 'Learn', 'Train', 'Charts'], ['Bank', 'Equity', 'Ranges', 'Dossier'], ['Progress', 'Profile', 'Settings']];
  const active = document.body.dataset.tab;
  const nav = document.querySelector('[data-nav]');
  const SPADE = '<svg viewBox="0 0 14 14" aria-hidden="true"><path fill="currentColor" d="M7 .8C5.4 3 1.6 5.2 1.6 8.1c0 1.6 1.2 2.7 2.6 2.7.9 0 1.6-.4 2.1-1-.2 1.3-.7 2.3-1.6 3.4h4.6c-.9-1.1-1.4-2.1-1.6-3.4.5.6 1.2 1 2.1 1 1.4 0 2.6-1.1 2.6-2.7C12.4 5.2 8.6 3 7 .8Z"/></svg>';
  if (nav) {
    nav.className = 'nav';
    nav.setAttribute('aria-label', 'Sections');
    nav.innerHTML =
      '<div class="lights" aria-hidden="true"><i></i><i></i><i></i></div>' +
      `<div class="brand">${SPADE}<span>Offsuit</span></div><div class="tabs"><span class="tab-thumb" aria-hidden="true"></span>` +
      GROUPS.map((g) => g.map((t) => `<button class="tab"${t === active ? ' aria-current="page"' : ''}>${t}</button>`).join('')).join('<span class="div" aria-hidden="true"></span>') +
      '</div><div class="nav-spacer" aria-hidden="true"></div>';
    // One shared selected thumb that slides between tabs (no slide under reduced motion: transition is 1ms).
    const tabs = nav.querySelector('.tabs'), thumb = nav.querySelector('.tab-thumb');
    const place = (btn) => { if (!btn) { thumb.style.display = 'none'; return; } thumb.style.left = btn.offsetLeft + 'px'; thumb.style.width = btn.offsetWidth + 'px'; };
    place(tabs.querySelector('[aria-current]'));
    tabs.addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (!b) return; tabs.querySelector('[aria-current]')?.removeAttribute('aria-current'); b.setAttribute('aria-current', 'page'); place(b); });
    addEventListener('resize', () => place(tabs.querySelector('[aria-current]')));
  }
  // Grain sits on its own top layer (on .shell::after it disabled the coat's backdrop-filter).
  const grain = document.createElement('div'); grain.className = 'grain'; grain.setAttribute('aria-hidden', 'true'); document.body.append(grain);

  // Segmented radio groups and single-select lists: one sliding thumb, real radio behaviour.
  for (const seg of document.querySelectorAll('.seg[role="radiogroup"]')) {   // presets (role=group) are one-shot actions, not selections
    const thumb = document.createElement('span'); thumb.className = 'thumb'; thumb.setAttribute('aria-hidden', 'true'); seg.prepend(thumb);
    const place = () => { const on = seg.querySelector('[aria-checked="true"]'); thumb.style.display = on ? '' : 'none'; if (on) { thumb.style.left = on.offsetLeft + 'px'; thumb.style.width = on.offsetWidth + 'px'; } };
    place(); requestAnimationFrame(place); document.fonts?.ready.then(place);
    new ResizeObserver(place).observe(seg);   // re-measure when a hidden tray is shown
    seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b))); place(); });
  }
  for (const list of document.querySelectorAll('.list-sel[role="radiogroup"]')) {
    list.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; list.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b))); });
  }
  for (const sw of document.querySelectorAll('.switch')) sw.addEventListener('click', () => sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true')));

  // The "desktop" behind the window: low-chroma dune bands with fine contour lines, so the coat has
  // mid-frequency detail to frost (a flat gradient behind blur reads as a wash, not glass).
  const desk = document.createElement('div');
  desk.className = 'desk';
  desk.innerHTML = `<svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="1600" height="1000" fill="var(--desk-0)"/>
    <path d="M0 160 C 300 60 520 260 820 180 S 1300 40 1600 140 V0 H0Z" fill="var(--desk-1)"/>
    <path d="M0 330 C 260 220 560 420 900 300 S 1380 200 1600 300 V140 C1300 40 1100 220 820 180 S 300 60 0 160Z" fill="var(--desk-2)"/>
    <path d="M0 520 C 320 420 620 600 980 480 S 1400 420 1600 500 V300 C1380 200 1240 420 900 300 S 260 220 0 330Z" fill="var(--desk-3)"/>
    <path d="M0 720 C 360 600 700 800 1040 680 S 1420 620 1600 700 V500 C1400 420 1340 600 980 480 S 320 420 0 520Z" fill="var(--desk-4)"/>
    <path d="M0 1000 V720 C 360 600 700 800 1040 680 S 1420 620 1600 700 V1000Z" fill="var(--desk-5)"/>
    <g fill="none" stroke="#FFFFFF" stroke-opacity=".07" stroke-width="1.2">
      ${Array.from({ length: 22 }, (_, i) => `<path d="M0 ${90 + i * 42} C 320 ${30 + i * 42} 620 ${190 + i * 42} 960 ${100 + i * 42} S 1420 ${20 + i * 42} 1600 ${110 + i * 42}"/>`).join('')}
    </g></svg>`;
  document.body.prepend(desk);

  for (const r of document.querySelectorAll('input.range')) {
    const out = document.querySelector(r.dataset.out);
    const sync = () => {
      r.style.setProperty('--f', String((r.value - r.min) / (r.max - r.min)));
      if (out) out.textContent = r.value;
    };
    r.addEventListener('input', sync);
    sync();
  }
})();
