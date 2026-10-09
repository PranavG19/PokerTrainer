// Mock-only shell: the real 11-tab nav (labels from src/renderer/main.ts TABS), the simulated desktop
// behind the window's coat, and the slider fill. No app logic. ?still=1 freezes the gate drain for captures.
(() => {
  const params = new URLSearchParams(location.search);
  if (params.get('still') === '1') document.documentElement.classList.add('still');

  const TABS = ['Play', 'Learn', 'Train', 'Charts', 'Bank', 'Equity', 'Ranges', 'Dossier', 'Progress', 'Profile', 'Settings'];
  const active = document.body.dataset.tab;
  const nav = document.querySelector('[data-nav]');
  if (nav) {
    nav.className = 'nav';
    nav.setAttribute('aria-label', 'Sections');
    nav.innerHTML =
      '<div class="brand"><i aria-hidden="true">♠</i>Offsuit</div><div class="tabs">' +
      TABS.map((t) => `<button class="tab"${t === active ? ' aria-current="page"' : ''}>${t}</button>`).join('') +
      '</div><div class="nav-spacer" aria-hidden="true"></div>';
  }
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
      r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min)) * 100 + '%');
      if (out) out.textContent = r.value;
    };
    r.addEventListener('input', sync);
    sync();
  }
})();
