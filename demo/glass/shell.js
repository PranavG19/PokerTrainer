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
  const desk = document.createElement('div');
  desk.className = 'desk';
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
